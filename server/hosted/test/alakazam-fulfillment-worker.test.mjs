import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createAlakazamFulfillmentAuthority
} from "../../commerce-v2/alakazam-fulfillment.mjs";
import {
  createAlakazamFulfillmentWorker
} from "../alakazam-fulfillment-worker.mjs";

const IDS = Object.freeze({
  tenantId: "10000000-0000-4000-8000-000000000001",
  customerId: "10000000-0000-4000-8000-000000000002",
  projectId: "10000000-0000-4000-8000-000000000003",
  subscriptionId: "10000000-0000-4000-8000-000000000004",
  operationId: "10000000-0000-4000-8000-000000000005",
  versionId: "10000000-0000-4000-8000-000000000006",
  addressId: "10000000-0000-4000-8000-000000000007",
  artifactId: "10000000-0000-4000-8000-000000000008",
  screeningId: "10000000-0000-4000-8000-000000000009",
  requestId: "10000000-0000-4000-8000-00000000000a",
  receiptId: "10000000-0000-4000-8000-00000000000b",
  releaseId: "10000000-0000-4000-8000-00000000000c"
});
const NOW = "2026-08-04T19:00:00.000Z";
const COMPILER_REVISION = `sha256:${"a".repeat(64)}`;

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function authority() {
  return createAlakazamFulfillmentAuthority({
    tenantId: IDS.tenantId,
    customerId: IDS.customerId,
    projectId: IDS.projectId,
    subscription: {
      tenantId: IDS.tenantId,
      customerId: IDS.customerId,
      projectId: IDS.projectId,
      subscriptionId: IDS.subscriptionId,
      tierId: "alakazam_25",
      status: "active",
      revision: 2,
      currentPeriodStartsAt: "2026-08-01T00:00:00.000Z",
      currentPeriodEndsAt: "2026-09-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      graceEndsAt: null,
      scheduledTierId: null,
      scheduledEffectiveAt: null
    },
    expectedSubscriptionRevision: 2,
    now: NOW
  });
}

function fixture({
  finalizeFails = false,
  claimFailures = 0,
  workerOptions = {}
} = {}) {
  const htmlBytes = Buffer.from(
    "<!doctype html><html><body>worker artifact</body></html>",
    "utf8"
  );
  const artifactDigest = sha(htmlBytes);
  const selectedAuthority = authority();
  const calls = {
    claims: [],
    compiles: [],
    stages: [],
    binds: [],
    publishes: [],
    unpublishes: [],
    finalizes: [],
    darks: [],
    ids: []
  };
  const claim = {
    status: "claimed",
    operationId: IDS.operationId,
    attemptCount: 1,
    workerId: "worker-one",
    tenantId: IDS.tenantId,
    customerId: IDS.customerId,
    projectId: IDS.projectId,
    subscriptionId: IDS.subscriptionId,
    subscriptionRevision: 2,
    authority: selectedAuthority,
    configuredFacts: { theme: "clear" },
    sourceVersion: {
      versionId: IDS.versionId,
      state: "accepted_release",
      artifactDigest: sha("accepted source artifact"),
      compilerSchema: "abracadabra.spark/v1",
      compilerRevision: COMPILER_REVISION
    },
    address: {
      tenantId: IDS.tenantId,
      projectId: IDS.projectId,
      addressId: IDS.addressId,
      kind: "licensed",
      state: "configured",
      hostname: "worker.sitesourcery.me"
    },
    project: {
      id: IDS.projectId,
      organizationId: IDS.tenantId,
      lifecycle: "active",
      safetyState: "clear"
    },
    servingRevision: 0,
    staged: null
  };
  let boundProof = null;
  const repository = {
    async claimNextFulfillment(input) {
      calls.claims.push(structuredClone(input));
      if (claimFailures > 0) {
        claimFailures -= 1;
        const error = new Error("injected fulfillment failure");
        error.code = "DATABASE_UNAVAILABLE";
        throw error;
      }
      return structuredClone(claim);
    },
    async stageFulfillmentPublication(input) {
      calls.stages.push({
        ...structuredClone(input),
        compiled: {
          ...structuredClone(input.compiled),
          htmlBytes: Buffer.from(input.compiled.htmlBytes)
        }
      });
      return {
        operationId: IDS.operationId,
        attemptCount: 1,
        workerId: "worker-one",
        tenantId: IDS.tenantId,
        customerId: IDS.customerId,
        projectId: IDS.projectId,
        subscriptionId: IDS.subscriptionId,
        subscriptionRevision: 2,
        policyDigest: selectedAuthority.policyDigest,
        servingRevision: 0,
        versionId: IDS.versionId,
        addressId: IDS.addressId,
        hostname: "worker.sitesourcery.me",
        artifactId: IDS.artifactId,
        artifactDigest,
        htmlBytes,
        compilerSchema: "abracadabra.spark/v1",
        compilerRevision: COMPILER_REVISION,
        screeningId: IDS.screeningId,
        releaseRequestId: IDS.requestId,
        requestedAt: NOW
      };
    },
    async bindFulfillmentDecision(input) {
      calls.binds.push(structuredClone(input));
      boundProof = {
        organizationId: IDS.tenantId,
        projectId: IDS.projectId,
        releaseId: IDS.operationId
      };
      return boundProof;
    },
    async finalizeFulfillmentPublication(input) {
      calls.finalizes.push(structuredClone(input));
      if (finalizeFails) {
        const error = new Error("injected finalization failure");
        error.code = "repository_conflict";
        throw error;
      }
      return {
        status: "live",
        operationId: IDS.operationId,
        hostname: "worker.sitesourcery.me"
      };
    },
    async markFulfillmentDark(input) {
      calls.darks.push(structuredClone(input));
      return {
        status: "dark",
        operationId: IDS.operationId,
        retrySafe: true
      };
    }
  };
  const idValues = {
    alakazam_fulfillment_artifact: IDS.artifactId,
    alakazam_fulfillment_screening: IDS.screeningId,
    alakazam_fulfillment_release_request: IDS.requestId,
    alakazam_fulfillment_receipt: IDS.receiptId,
    alakazam_fulfillment_release: IDS.releaseId
  };
  const worker = createAlakazamFulfillmentWorker({
    repository,
    compiler: {
      compileAlakazam(input) {
        calls.compiles.push(structuredClone(input));
        return {
          schema: "abracadabra.spark/v1",
          compilerRevision: COMPILER_REVISION,
          policyDigest: selectedAuthority.policyDigest,
          artifactDigest,
          htmlBytes
        };
      }
    },
    publicationPort: {
      async request(input) {
        calls.publishes.push(input);
        assert.equal(input, boundProof);
        return {
          providerRequestId: `selfhost:publish:${IDS.requestId}`,
          status: "released",
          published: true,
          replay: false,
          releaseId: IDS.operationId,
          manifestDigest: sha("manifest"),
          bindingRevision: 3
        };
      },
      async unpublish(input) {
        calls.unpublishes.push(structuredClone(input));
        return {
          status: "unpublished",
          published: false
        };
      }
    },
    clock: { now: () => NOW },
    ids: {
      next(label) {
        calls.ids.push(label);
        return idValues[label];
      }
    },
    workerId: "worker-one",
    enabled: true,
    ...workerOptions
  });
  return { calls, worker };
}

test("held fulfillment runOnce performs no claim or publication effect", async () => {
  const { calls, worker } = fixture({ workerOptions: { enabled: false } });
  assert.deepEqual(await worker.runOnce(), { status: "held" });
  assert.deepEqual(calls.claims, []);
  assert.deepEqual(calls.publishes, []);
  assert.deepEqual(calls.unpublishes, []);
});

test("the fulfillment worker compiles, binds, publishes, and finalizes one exact operation", async () => {
  const { calls, worker } = fixture();
  assert.deepEqual(await worker.runOnce(), {
    status: "live",
    operationId: IDS.operationId,
    hostname: "worker.sitesourcery.me"
  });
  assert.equal(calls.claims.length, 1);
  assert.equal(calls.compiles.length, 1);
  assert.equal(calls.stages.length, 1);
  assert.equal(calls.binds.length, 1);
  assert.equal(calls.publishes.length, 1);
  assert.equal(calls.finalizes.length, 1);
  assert.deepEqual(calls.unpublishes, []);
  assert.deepEqual(calls.darks, []);
  assert.deepEqual(calls.ids, [
    "alakazam_fulfillment_artifact",
    "alakazam_fulfillment_screening",
    "alakazam_fulfillment_release_request",
    "alakazam_fulfillment_receipt",
    "alakazam_fulfillment_release"
  ]);
});

test("fulfillment loop uses bounded error backoff and resets after success", async () => {
  const waits = [];
  const pending = [];
  const { worker } = fixture({
    claimFailures: 2,
    workerOptions: {
      enabled: true,
      intervalMs: 150,
      errorBackoffMs: 100,
      maximumBackoffMs: 175,
      wait(milliseconds, signal) {
        waits.push(milliseconds);
        return new Promise((resolve) => {
          pending.push(() => {
            if (!signal.aborted) resolve();
            else resolve();
          });
        });
      }
    }
  });
  worker.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waits[0], 100);
  pending.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waits[1], 175);
  pending.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waits[2], 150);
  assert.equal(worker.snapshot().consecutiveErrors, 0);
  const stopping = worker.stop();
  pending.shift()();
  await stopping;
});

test("a finalization failure is unpublished and durably marked dark for retry", async () => {
  const { calls, worker } = fixture({ finalizeFails: true });
  assert.deepEqual(await worker.runOnce(), {
    status: "dark",
    operationId: IDS.operationId,
    retrySafe: true
  });
  assert.deepEqual(calls.unpublishes, [
    {
      projectId: IDS.projectId,
      hostname: "worker.sitesourcery.me"
    }
  ]);
  assert.equal(calls.darks.length, 1);
  assert.equal(
    calls.darks[0].failureCode,
    "repository_conflict"
  );
});
