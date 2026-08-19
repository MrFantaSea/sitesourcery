import assert from "node:assert/strict";
import test from "node:test";

import {
  createLeasedLifecycleWorker,
  lifecycleWorkerOptionsFromEnvironment
} from "../leased-lifecycle-worker.mjs";

const PURPOSE = "project-lifecycle";
const NOW = "2026-08-13T12:00:00.000Z";

function fixture({ enabled = true, execute = async () => ({
  receiptKind: "blob_deleted"
}) } = {}) {
  const calls = [];
  const claims = [{
    jobId: "10000000-0000-4000-8000-000000000001",
    attemptCount: 1,
    fence: 1
  }];
  const repository = {
    kind: `${PURPOSE}-postgres`,
    async readiness() { return { ready: true, verified: true }; },
    async claimNext(input) {
      calls.push(["claim", input]);
      return claims.shift() ?? null;
    },
    async completeClaim(input) {
      calls.push(["complete", input]);
      return { status: "succeeded" };
    },
    async releaseClaim(input) {
      calls.push(["release", input]);
      return { status: "released" };
    }
  };
  const executor = {
    kind: `${PURPOSE}-executor`,
    async readiness() { return { ready: true, verified: true }; },
    async execute(claim, context) {
      calls.push(["execute", claim]);
      return execute(claim, context);
    }
  };
  const worker = createLeasedLifecycleWorker({
    purpose: PURPOSE,
    repository,
    executor,
    clock: { now: () => NOW },
    enabled,
    workerId: "project-lifecycle-test-worker",
    intervalMs: 1_000,
    errorBackoffMs: 100,
    maximumBackoffMs: 1_000,
    batchLimit: 2,
    leaseSeconds: 60
  });
  return { worker, calls };
}

test("held lifecycle worker claims nothing", async () => {
  const selected = fixture({ enabled: false });
  assert.deepEqual(await selected.worker.runOnce(), { status: "held" });
  assert.deepEqual(selected.calls, []);
  assert.equal(selected.worker.start(), false);
});

test("one cycle claims, executes, and completes one fenced job", async () => {
  const selected = fixture();
  const result = await selected.worker.runOnce();
  assert.equal(result.claimed, 1);
  assert.equal(result.completed, 1);
  assert.deepEqual(
    selected.calls.map(([kind]) => kind),
    ["claim", "execute", "complete", "claim"]
  );
  assert.equal(selected.calls[2][1].fence, 1);
  assert.equal(selected.calls[2][1].workerId, "project-lifecycle-test-worker");
});

test("failed execution releases only its fenced claim with a safe retry", async () => {
  const error = new Error("failed");
  error.code = "PROJECT_OBJECT_DELETE_RETRY";
  const selected = fixture({ execute: async () => { throw error; } });
  const result = await selected.worker.runOnce();
  assert.equal(result.released, 1);
  const release = selected.calls.find(([kind]) => kind === "release")[1];
  assert.equal(release.failureCode, "PROJECT_OBJECT_DELETE_RETRY");
  assert.equal(release.retryAt, "2026-08-13T12:00:00.100Z");
});

test("stop aborts an enabled lifecycle loop and drains its active execution", async () => {
  let entered;
  let release;
  const started = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const selected = fixture({
    execute: async (_claim, { signal }) => {
      assert.equal(signal.aborted, false);
      entered();
      await blocked;
      assert.equal(signal.aborted, true);
      return { receiptKind: "blob_deleted" };
    }
  });
  assert.equal(selected.worker.start(), true);
  await started;
  let stopped = false;
  const stopping = selected.worker.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);
  release();
  await stopping;
  assert.equal(selected.worker.snapshot().state, "stopped");
  assert.equal(
    selected.calls.filter(([kind]) => kind === "complete").length,
    1
  );
});

test("lifecycle environment options are held, exact, and bounded", () => {
  assert.equal(lifecycleWorkerOptionsFromEnvironment({}, {
    prefix: "SITESOURCERY_PROJECT_LIFECYCLE_WORKER"
  }).enabled, false);
  assert.equal(lifecycleWorkerOptionsFromEnvironment({
    SITESOURCERY_PROJECT_LIFECYCLE_WORKER_MODE: "approved_live",
    SITESOURCERY_PROJECT_LIFECYCLE_WORKER_BATCH_LIMIT: "4",
    SITESOURCERY_PROJECT_LIFECYCLE_WORKER_LEASE_SECONDS: "90"
  }, {
    prefix: "SITESOURCERY_PROJECT_LIFECYCLE_WORKER"
  }).batchLimit, 4);
  assert.throws(() => lifecycleWorkerOptionsFromEnvironment({
    SITESOURCERY_PROJECT_LIFECYCLE_WORKER_MODE: "enabled"
  }, {
    prefix: "SITESOURCERY_PROJECT_LIFECYCLE_WORKER"
  }), (error) => error?.code === "LIFECYCLE_WORKER_CONFIGURATION_INVALID");
});
