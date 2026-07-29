import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  cancellationWorkerOptionsFromEnvironment,
  createCancellationWorker
} from "../cancellation-worker.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((selectedResolve) => {
    resolve = selectedResolve;
  });
  return { promise, resolve };
}

function manualWait() {
  const pending = [];
  return {
    pending,
    wait(milliseconds, signal) {
      const gate = deferred();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", finish);
        gate.resolve();
      };
      signal.addEventListener("abort", finish, {
        once: true
      });
      pending.push({
        milliseconds,
        release: finish
      });
      return gate.promise;
    }
  };
}

function turn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("cancellation worker never overlaps and graceful stop waits for the active leased cycle", async () => {
  const activeCycle = deferred();
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  const worker = createCancellationWorker({
    service: {
      async processPaymentOutbox() {
        calls += 1;
        active += 1;
        maximumActive = Math.max(
          maximumActive,
          active
        );
        await activeCycle.promise;
        active -= 1;
        return {
          processed: 1,
          failed: 0,
          ambiguous: 0,
          held: false,
          provider: "stripe",
          mode: "approved_live"
        };
      }
    },
    workerId: "hosted-cancel-no-overlap",
    intervalMs: 100,
    errorBackoffMs: 100,
    maximumBackoffMs: 800
  });
  assert.equal(worker.start(), true);
  assert.equal(worker.start(), false);
  await turn();
  assert.equal(calls, 1);
  assert.equal(maximumActive, 1);
  const stopping = worker.stop();
  assert.equal(worker.snapshot().state, "stopping");
  let stopped = false;
  stopping.then(() => {
    stopped = true;
  });
  await turn();
  assert.equal(stopped, false);
  activeCycle.resolve();
  assert.equal(await stopping, true);
  assert.equal(calls, 1);
  assert.equal(maximumActive, 1);
  assert.equal(worker.snapshot().state, "stopped");
  assert.equal(await worker.stop(), false);
});

test("cancellation worker applies bounded exponential cycle backoff and resets after success", async () => {
  const scheduler = manualWait();
  const logs = [];
  let calls = 0;
  const worker = createCancellationWorker({
    service: {
      async processPaymentOutbox() {
        calls += 1;
        if (calls <= 2) {
          const error = new Error(
            "contains sk_live_never-log"
          );
          error.code =
            calls === 1
              ? "DATABASE_UNAVAILABLE"
              : "sk_live_never-log";
          throw error;
        }
        return {
          processed: 0,
          failed: 0,
          ambiguous: 0,
          held: false,
          provider: "stripe",
          mode: "approved_live",
          secret: "whsec_never-log"
        };
      }
    },
    workerId: "hosted-cancel-backoff-test",
    intervalMs: 150,
    errorBackoffMs: 100,
    maximumBackoffMs: 175,
    wait: scheduler.wait,
    log(entry) {
      logs.push(entry);
    }
  });
  worker.start();
  await turn();
  assert.equal(
    scheduler.pending[0].milliseconds,
    100
  );
  scheduler.pending.shift().release();
  await turn();
  assert.equal(
    scheduler.pending[0].milliseconds,
    175
  );
  scheduler.pending.shift().release();
  await turn();
  assert.equal(calls, 3);
  assert.equal(
    scheduler.pending[0].milliseconds,
    150
  );
  assert.equal(
    worker.snapshot().consecutiveErrors,
    0
  );
  const output = JSON.stringify(logs);
  assert.doesNotMatch(
    output,
    /sk_live_never-log|whsec_never-log/u
  );
  assert.match(output, /DATABASE_UNAVAILABLE/u);
  assert.match(
    output,
    /CANCELLATION_WORKER_CYCLE_FAILED/u
  );
  await worker.stop();
});

test("worker environment configuration is bounded and exact", () => {
  assert.deepEqual(
    cancellationWorkerOptionsFromEnvironment({}),
    {
      batchLimit: 10,
      intervalMs: 5_000,
      errorBackoffMs: 5_000,
      maximumBackoffMs: 60_000
    }
  );
  assert.deepEqual(
    cancellationWorkerOptionsFromEnvironment({
      SITESOURCERY_PAYMENT_WORKER_BATCH_LIMIT:
        "25",
      SITESOURCERY_PAYMENT_WORKER_INTERVAL_MS:
        "1000",
      SITESOURCERY_PAYMENT_WORKER_ERROR_BACKOFF_MS:
        "2000",
      SITESOURCERY_PAYMENT_WORKER_MAXIMUM_BACKOFF_MS:
        "120000"
    }),
    {
      batchLimit: 25,
      intervalMs: 1_000,
      errorBackoffMs: 2_000,
      maximumBackoffMs: 120_000
    }
  );
  for (const environment of [
    {
      SITESOURCERY_PAYMENT_WORKER_BATCH_LIMIT:
        "0"
    },
    {
      SITESOURCERY_PAYMENT_WORKER_INTERVAL_MS:
        "99"
    },
    {
      SITESOURCERY_PAYMENT_WORKER_ERROR_BACKOFF_MS:
        "not-a-number"
    },
    {
      SITESOURCERY_PAYMENT_WORKER_ERROR_BACKOFF_MS:
        "10000",
      SITESOURCERY_PAYMENT_WORKER_MAXIMUM_BACKOFF_MS:
        "5000"
    }
  ]) {
    assert.throws(
      () =>
        cancellationWorkerOptionsFromEnvironment(
          environment
        ),
      (error) =>
        error?.code ===
        "CANCELLATION_WORKER_CONFIGURATION_INVALID"
    );
  }
});

test("ambiguous cancellation effects enter operator-only reconciliation and cannot be polled again", async () => {
  const source = await readFile(
    new URL("../postgres-service.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /when \$4 = 'ambiguous'\s+then 'infinity'::timestamptz/u
  );
  assert.match(
    source,
    /last_error = \$3/u
  );
  assert.match(
    source,
    /when \$4 = 'ambiguous'\s+then 'infinity'::timestamptz\s+else \$5::timestamptz \+ interval '5 minutes'/u
  );
});

test("the production entrypoint starts only the leased cancellation worker and stops it before database close", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /stripeComposition\.mode === "approved_live"/u
  );
  assert.match(
    source,
    /createCancellationWorker\(\{/u
  );
  assert.doesNotMatch(
    source,
    /processQueuedExports/u
  );
  assert.ok(
    source.indexOf("cancellationWorker.stop()") <
      source.indexOf("authority.close()")
  );
  assert.doesNotMatch(
    source,
    /setTimeout\(\(\) => process\.exit/u
  );
});
