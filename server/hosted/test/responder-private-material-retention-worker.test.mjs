import assert from "node:assert/strict";
import test from "node:test";

import {
  createResponderPrivateMaterialRetentionWorker,
  responderRetentionWorkerOptionsFromEnvironment
} from "../responder-private-material-retention-worker.mjs";

const WORKER_ID = "responder-retention-test-worker-0001";
const NOW = "2026-08-13T12:00:00.000Z";

function repository({ claims = [], destroyError = null } = {}) {
  const calls = [];
  return {
    calls,
    kind: "responder-private-material-retention-postgres",
    providerEffects: false,
    decryptsMaterial: false,
    async readiness() {
      return { ready: true, verified: true };
    },
    async discoverEligible(input) {
      calls.push(["discover", input]);
      return { discovered: claims.length };
    },
    async claimNext(input) {
      calls.push(["claim", input]);
      return claims.shift() ?? null;
    },
    async destroyClaim(input) {
      calls.push(["destroy", input]);
      if (destroyError !== null) throw destroyError;
      return { primaryCiphertextZeroed: true };
    },
    async releaseClaim(input) {
      calls.push(["release", input]);
      return { status: "released" };
    }
  };
}

function claim(overrides = {}) {
  return {
    jobId: "10000000-0000-4000-8000-000000000001",
    attemptCount: 1,
    ...overrides
  };
}

test("held retention worker does not inspect storage or material", async () => {
  const port = repository({ claims: [claim()] });
  const worker = createResponderPrivateMaterialRetentionWorker({
    repository: port,
    clock: { now: () => NOW },
    workerId: WORKER_ID
  });
  assert.deepEqual(await worker.runOnce(), { status: "held" });
  assert.deepEqual(port.calls, []);
  assert.equal(worker.start(), false);
  assert.equal(worker.snapshot().decryptsMaterial, false);
});

test("one cycle discovers, leases, and destroys only within exact bounds", async () => {
  const port = repository({ claims: [claim(), claim({
    jobId: "10000000-0000-4000-8000-000000000002"
  })] });
  const worker = createResponderPrivateMaterialRetentionWorker({
    repository: port,
    clock: { now: () => NOW },
    enabled: true,
    workerId: WORKER_ID,
    maximumDiscoveriesPerCycle: 7,
    maximumDestructionsPerCycle: 2,
    leaseSeconds: 90
  });
  assert.deepEqual(await worker.runOnce(), {
    status: "swept",
    observedAt: NOW,
    discovered: 2,
    claimed: 2,
    destroyed: 2,
    released: 0,
    providerEffects: false,
    decryptsMaterial: false
  });
  assert.equal(port.calls.filter(([kind]) => kind === "destroy").length, 2);
  assert.equal(port.calls.filter(([kind]) => kind === "claim").length, 2);
  assert.deepEqual(port.calls[0], ["discover", {
    workerId: WORKER_ID,
    observedAt: NOW,
    limit: 7
  }]);
  assert.equal(port.calls[1][1].leaseSeconds, 90);
});

test("a failed destruction releases its own lease with a safe bounded retry", async () => {
  const failure = Object.assign(new Error("private"), {
    code: "RESPONDER_RETENTION_HELD"
  });
  const port = repository({ claims: [claim()], destroyError: failure });
  const worker = createResponderPrivateMaterialRetentionWorker({
    repository: port,
    clock: { now: () => NOW },
    enabled: true,
    workerId: WORKER_ID,
    errorBackoffMs: 5_000,
    maximumBackoffMs: 60_000
  });
  const result = await worker.runOnce();
  assert.equal(result.released, 1);
  assert.equal(result.destroyed, 0);
  const release = port.calls.find(([kind]) => kind === "release")[1];
  assert.deepEqual(release, {
    jobId: claim().jobId,
    workerId: WORKER_ID,
    failureCode: "RESPONDER_RETENTION_HELD",
    observedAt: NOW,
    retryAt: "2026-08-13T12:00:05.000Z"
  });
  assert.equal(JSON.stringify(port.calls).includes("private"), false);
});

test("worker configuration remains exact and bounded", () => {
  assert.deepEqual(responderRetentionWorkerOptionsFromEnvironment({}), {
    intervalMs: 60_000,
    errorBackoffMs: 5_000,
    maximumBackoffMs: 300_000,
    maximumDiscoveriesPerCycle: 100,
    maximumDestructionsPerCycle: 16,
    leaseSeconds: 120
  });
  assert.throws(
    () => responderRetentionWorkerOptionsFromEnvironment({
      SITESOURCERY_RESPONDER_RETENTION_LEASE_SECONDS: "601"
    }),
    (error) =>
      error?.code === "RESPONDER_RETENTION_WORKER_CONFIGURATION_INVALID"
  );
  assert.throws(
    () => createResponderPrivateMaterialRetentionWorker({
      repository: { ...repository(), decryptsMaterial: true },
      clock: { now: () => NOW }
    }),
    (error) =>
      error?.code === "RESPONDER_RETENTION_WORKER_CONFIGURATION_INVALID"
  );
});
