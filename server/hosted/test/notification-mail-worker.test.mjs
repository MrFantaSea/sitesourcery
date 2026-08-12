import assert from "node:assert/strict";
import test from "node:test";

import {
  createNotificationMailWorker,
  notificationMailWorkerOptionsFromEnvironment
} from "../notification-mail-worker.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((selected) => { resolve = selected; });
  return { promise, resolve };
}

function turn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function result(selected = 1) {
  return {
    selected,
    accepted: selected,
    alreadyRecorded: 0,
    busy: 0,
    expired: 0
  };
}

test("held notification mail worker starts no loop", async () => {
  let calls = 0;
  const worker = createNotificationMailWorker({
    service: {
      async processBatch() { calls += 1; }
    }
  });
  assert.equal(worker.start(), false);
  assert.equal(worker.snapshot().state, "held");
  assert.equal(await worker.stop(), false);
  assert.equal(calls, 0);
});

test("notification mail loop is single-flight and drains its active batch", async () => {
  const active = deferred();
  let calls = 0;
  const worker = createNotificationMailWorker({
    enabled: true,
    workerId: "hosted-notification-mail-no-overlap",
    service: {
      async processBatch(input) {
        calls += 1;
        assert.equal(input.limit, 4);
        assert.equal(input.signal.aborted, false);
        await active.promise;
        return result();
      }
    },
    batchLimit: 4,
    intervalMs: 100,
    errorBackoffMs: 100,
    maximumBackoffMs: 800
  });
  assert.equal(worker.start(), true);
  assert.equal(worker.start(), false);
  await turn();
  assert.equal(calls, 1);
  const stopping = worker.stop();
  await turn();
  assert.equal(worker.snapshot().state, "stopping");
  active.resolve();
  assert.equal(await stopping, true);
  assert.equal(calls, 1);
  assert.equal(worker.snapshot().state, "stopped");
});

test("notification mail loop applies bounded backoff and logs aggregate facts only", async () => {
  const waits = [];
  const logs = [];
  let calls = 0;
  const worker = createNotificationMailWorker({
    enabled: true,
    workerId: "hosted-notification-mail-backoff-test",
    service: {
      async processBatch() {
        calls += 1;
        if (calls < 3) {
          const error = new Error("customer@example.test whsec_private");
          error.code = calls === 1
            ? "DATABASE_UNAVAILABLE"
            : "whsec_private";
          throw error;
        }
        return { ...result(0), secret: "re_private" };
      }
    },
    intervalMs: 150,
    errorBackoffMs: 100,
    maximumBackoffMs: 175,
    wait(milliseconds, signal) {
      const gate = deferred();
      const finish = () => gate.resolve();
      signal.addEventListener("abort", finish, { once: true });
      waits.push({ milliseconds, release: finish });
      return gate.promise;
    },
    log: (entry) => logs.push(entry)
  });
  worker.start();
  await turn();
  assert.equal(waits[0].milliseconds, 100);
  waits.shift().release();
  await turn();
  assert.equal(waits[0].milliseconds, 175);
  waits.shift().release();
  await turn();
  assert.equal(waits[0].milliseconds, 150);
  assert.equal(worker.snapshot().consecutiveErrors, 0);
  const output = JSON.stringify(logs);
  assert.match(output, /DATABASE_UNAVAILABLE/u);
  assert.match(output, /NOTIFICATION_MAIL_WORKER_CYCLE_FAILED/u);
  assert.doesNotMatch(output, /customer@example|whsec_|re_private/u);
  await worker.stop();
});

test("notification mail worker environment is held by default and bounded", () => {
  assert.deepEqual(notificationMailWorkerOptionsFromEnvironment({}), {
    enabled: false,
    mode: "held",
    batchLimit: 10,
    leaseMs: 120_000,
    intervalMs: 5_000,
    errorBackoffMs: 5_000,
    maximumBackoffMs: 60_000
  });
  const enabled = notificationMailWorkerOptionsFromEnvironment({
    SITESOURCERY_NOTIFICATION_MAIL_WORKER_MODE: "approved_live",
    SITESOURCERY_NOTIFICATION_MAIL_WORKER_BATCH_LIMIT: "25",
    SITESOURCERY_NOTIFICATION_MAIL_WORKER_LEASE_MS: "30000"
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.batchLimit, 25);
  assert.equal(enabled.leaseMs, 30_000);
  for (const environment of [
    { SITESOURCERY_NOTIFICATION_MAIL_WORKER_MODE: "enabled" },
    { SITESOURCERY_NOTIFICATION_MAIL_WORKER_BATCH_LIMIT: "26" },
    { SITESOURCERY_NOTIFICATION_MAIL_WORKER_LEASE_MS: "29999" },
    { SITESOURCERY_NOTIFICATION_MAIL_WORKER_INTERVAL_MS: "99" },
    {
      SITESOURCERY_NOTIFICATION_MAIL_WORKER_ERROR_BACKOFF_MS: "1000",
      SITESOURCERY_NOTIFICATION_MAIL_WORKER_MAXIMUM_BACKOFF_MS: "999"
    }
  ]) {
    assert.throws(
      () => notificationMailWorkerOptionsFromEnvironment(environment),
      (error) =>
        error?.code === "NOTIFICATION_MAIL_WORKER_CONFIGURATION_INVALID"
    );
  }
});
