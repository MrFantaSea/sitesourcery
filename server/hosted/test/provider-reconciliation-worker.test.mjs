import assert from "node:assert/strict";
import test from "node:test";

import {
  createProviderReconciliationWorker,
  providerReconciliationWorkerOptionsFromEnvironment
} from "../provider-reconciliation-worker.mjs";

const NOW = "2026-08-12T18:00:00.000Z";
const WORKER_ID = "provider-reconciliation-test000001";
const CASE = "10000000-0000-4000-8000-0000000000a5";

function fixture({
  enabled = true,
  detection = {
    schema: "sitesourcery.provider-reconciliation-detection/v1",
    observedAt: NOW,
    providerEffects: false,
    openedCases: 0,
    counters: { selfHealedProjections: 0 }
  },
  openCases = [],
  readbackCandidates = [],
  escalateResult = { status: "escalated" },
  readback = null,
  detectionError = null
} = {}) {
  const calls = {
    detection: [], escalations: [], lists: 0,
    candidateLists: 0, readbackRecords: []
  };
  const repository = {
    kind: "provider-reconciliation-postgres",
    providerEffects: false,
    async runDetection(input) {
      calls.detection.push(input);
      if (detectionError) throw detectionError;
      return detection;
    },
    async listOpenCases() {
      calls.lists += 1;
      return { cases: openCases };
    },
    async escalateAbandonedClaim(input) {
      calls.escalations.push(input);
      return escalateResult;
    },
    async listReadbackCandidates() {
      calls.candidateLists += 1;
      return { candidates: readbackCandidates };
    },
    async recordReadback(input) {
      calls.readbackRecords.push(input);
      return { status: "recorded" };
    }
  };
  const worker = createProviderReconciliationWorker({
    repository,
    readback,
    clock: { now: () => NOW },
    enabled,
    workerId: WORKER_ID,
    log: () => {}
  });
  return { calls, worker };
}

test("one detection pass escalates only abandoned claims and reports counts", async () => {
  const { calls, worker } = fixture({
    detection: {
      schema: "sitesourcery.provider-reconciliation-detection/v1",
      observedAt: NOW,
      providerEffects: false,
      openedCases: 2,
      counters: { selfHealedProjections: 1 }
    },
    openCases: [
      { id: CASE, caseKind: "abandoned_claim" },
      { id: "other", caseKind: "stale_delivery_status" }
    ]
  });
  const result = await worker.runOnce();
  assert.equal(result.status, "swept");
  assert.equal(result.openedCases, 2);
  assert.equal(result.selfHealedProjections, 1);
  assert.equal(result.escalatedClaims, 1);
  assert.equal(calls.detection.length, 1);
  assert.equal(calls.detection[0].workerId, WORKER_ID);
  assert.equal(calls.escalations.length, 1);
  assert.equal(calls.escalations[0].caseId, CASE);
});

test("the worker runs detection with readback held and reports it as not ready", async () => {
  const { calls, worker } = fixture({ readback: null });
  const result = await worker.runOnce();
  assert.equal(result.readbackReady, false);
  assert.equal(calls.detection.length, 1);
});

test("verified readback is executed and its exact evidence is recorded", async () => {
  const targetDigest = "d".repeat(64);
  const providerMessageIdDigest = "e".repeat(64);
  const evidenceDigest = "f".repeat(64);
  const readbackCalls = [];
  const readback = {
    providerEffects: false,
    readOnly: true,
    async readiness() { return { ready: true, verified: true }; },
    async findMessages(input) {
      readbackCalls.push(input);
      return {
        results: [{
          targetDigest,
          state: "single_candidate",
          matchCount: 1,
          providerMessageIdDigest,
          readbackEvidenceDigest: evidenceDigest
        }]
      };
    }
  };
  const { calls, worker } = fixture({
    readback,
    readbackCandidates: [{
      caseId: CASE,
      caseKind: "ambiguous_message_create",
      target: {
        kind: "responder_message_shape",
        routeDigest: "a".repeat(64),
        contentDigest: "b".repeat(64)
      },
      targetDigest,
      attemptAt: "2026-08-12T17:59:00.000Z",
      openedAt: NOW
    }]
  });
  const result = await worker.runOnce();
  assert.equal(result.readbackReady, true);
  assert.equal(result.readbacksRecorded, 1);
  assert.equal(result.readbackMatches, 1);
  assert.equal(readbackCalls.length, 1);
  assert.deepEqual(calls.readbackRecords, [{
    caseId: CASE,
    readbackState: "single_candidate",
    readbackEvidenceDigest: evidenceDigest,
    matchedProviderMessageIdDigest: providerMessageIdDigest,
    matchCount: 1,
    observedAt: NOW
  }]);
});

test("a held worker performs no work", async () => {
  const { calls, worker } = fixture({ enabled: false });
  assert.deepEqual(await worker.runOnce(), { status: "held" });
  assert.equal(calls.detection.length, 0);
  assert.equal(worker.snapshot().state, "held");
});

test("detection failure surfaces an allowlisted code and never leaks detail", async () => {
  const error = new Error("private detail +15555550123");
  error.code = "PROVIDER_RECONCILIATION_UNAVAILABLE";
  const logs = [];
  const { worker } = (() => {
    const repository = {
      kind: "provider-reconciliation-postgres",
      providerEffects: false,
      async runDetection() { throw error; },
      async listOpenCases() { return { cases: [] }; },
      async escalateAbandonedClaim() { return { status: "escalated" }; },
      async listReadbackCandidates() { return { candidates: [] }; },
      async recordReadback() { throw new Error("unused"); }
    };
    return {
      worker: createProviderReconciliationWorker({
        repository,
        readback: null,
        clock: { now: () => NOW },
        enabled: true,
        workerId: WORKER_ID,
        log: (entry) => logs.push(entry)
      })
    };
  })();
  await assert.rejects(worker.runOnce());
  const controller = new AbortController();
  const started = worker.start({ signal: controller.signal });
  assert.equal(started, true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await worker.stop();
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes("+15555550123"), false);
  assert.equal(serialized.includes("private detail"), false);
  assert.match(serialized, /PROVIDER_RECONCILIATION_UNAVAILABLE/u);
});

test("environment options are bounded and default sensibly", () => {
  assert.deepEqual(
    providerReconciliationWorkerOptionsFromEnvironment({}),
    {
      intervalMs: 60_000,
      errorBackoffMs: 5_000,
      maximumBackoffMs: 300_000,
      maximumReadbacksPerCycle: 8
    }
  );
  assert.throws(
    () => providerReconciliationWorkerOptionsFromEnvironment({
      SITESOURCERY_PROVIDER_RECONCILIATION_WORKER_INTERVAL_MS: "0"
    }),
    (error) =>
      error?.code === "PROVIDER_RECONCILIATION_WORKER_CONFIGURATION_INVALID"
  );
  assert.throws(
    () => createProviderReconciliationWorker({
      repository: {
        kind: "wrong", providerEffects: false, runDetection() {},
        escalateAbandonedClaim() {}, recordReadback() {},
        listReadbackCandidates() {}, listOpenCases() {}
      },
      clock: { now: () => NOW }
    }),
    (error) =>
      error?.code === "PROVIDER_RECONCILIATION_WORKER_CONFIGURATION_INVALID"
  );
});
