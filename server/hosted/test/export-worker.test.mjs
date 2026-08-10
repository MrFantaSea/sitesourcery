import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createExportWorker,
  exportWorkerOptionsFromEnvironment
} from "../export-worker.mjs";

const WORKER_ID = "hosted-export-test-worker-0001";

test("export worker is held by default and causes no export effects", async () => {
  let calls = 0;
  const worker = createExportWorker({
    workerId: WORKER_ID,
    service: {
      async processQueuedExports() {
        calls += 1;
        return [];
      }
    }
  });

  assert.equal(worker.start(), false);
  assert.equal(await worker.stop(), false);
  assert.equal(calls, 0);
  assert.deepEqual(worker.snapshot(), {
    kind: "fenced-export-queue",
    state: "held",
    workerId: WORKER_ID,
    enabled: false,
    batchLimit: 10,
    intervalMs: 5_000,
    errorBackoffMs: 5_000,
    maximumBackoffMs: 60_000,
    cycles: 0,
    consecutiveErrors: 0,
    lastResult: null,
    lastErrorCode: null
  });
});

test("enabled export worker passes one bounded batch and shared abort signal", async () => {
  const shutdown = new AbortController();
  const calls = [];
  const worker = createExportWorker({
    enabled: true,
    workerId: WORKER_ID,
    batchLimit: 2,
    intervalMs: 100,
    service: {
      async processQueuedExports(input) {
        calls.push(input);
        return [
          { export: { status: "ready" } },
          {
            export: { status: "failed" },
            errorCode: "EXPORT_BUILD_FAILED"
          }
        ];
      }
    },
    async wait(_milliseconds, signal) {
      assert.equal(signal, calls[0].signal);
      shutdown.abort();
    }
  });

  assert.equal(
    worker.start({ signal: shutdown.signal }),
    true
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].workerId, WORKER_ID);
  assert.equal(calls[0].limit, 2);
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(worker.snapshot().lastResult, {
    processed: 2,
    ready: 1,
    failed: 1,
    aborted: false
  });
  assert.equal(worker.snapshot().state, "stopped");
});

test("stop aborts an active export batch and waits for graceful release", async () => {
  let startBatch;
  const batchStarted = new Promise((resolve) => {
    startBatch = resolve;
  });
  let observedAbort = false;
  const worker = createExportWorker({
    enabled: true,
    workerId: WORKER_ID,
    intervalMs: 100,
    service: {
      async processQueuedExports({ signal }) {
        startBatch();
        await new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              resolve();
            },
            { once: true }
          );
        });
        return [
          {
            aborted: true,
            export: { status: "queued" }
          }
        ];
      }
    }
  });

  assert.equal(worker.start(), true);
  await batchStarted;
  assert.equal(await worker.stop(), true);
  assert.equal(observedAbort, true);
  assert.equal(worker.snapshot().state, "stopped");
  assert.equal(worker.snapshot().lastResult.aborted, true);
});

test("export worker environment is exact, bounded, and held unless enabled", () => {
  assert.deepEqual(
    exportWorkerOptionsFromEnvironment({}),
    {
      enabled: false,
      batchLimit: 10,
      intervalMs: 5_000,
      errorBackoffMs: 5_000,
      maximumBackoffMs: 60_000
    }
  );
  assert.deepEqual(
    exportWorkerOptionsFromEnvironment({
      SITESOURCERY_EXPORT_WORKER_MODE: "enabled",
      SITESOURCERY_EXPORT_WORKER_BATCH_LIMIT: "3",
      SITESOURCERY_EXPORT_WORKER_INTERVAL_MS: "250",
      SITESOURCERY_EXPORT_WORKER_ERROR_BACKOFF_MS: "400",
      SITESOURCERY_EXPORT_WORKER_MAXIMUM_BACKOFF_MS:
        "1200"
    }),
    {
      enabled: true,
      batchLimit: 3,
      intervalMs: 250,
      errorBackoffMs: 400,
      maximumBackoffMs: 1200
    }
  );
  assert.throws(
    () =>
      exportWorkerOptionsFromEnvironment({
        SITESOURCERY_EXPORT_WORKER_MODE: "true"
      }),
    (error) =>
      error?.code ===
      "EXPORT_WORKER_CONFIGURATION_INVALID"
  );
  assert.throws(
    () =>
      exportWorkerOptionsFromEnvironment({
        SITESOURCERY_EXPORT_WORKER_MODE: "enabled",
        SITESOURCERY_EXPORT_WORKER_BATCH_LIMIT: "101"
      }),
    (error) =>
      error?.code ===
      "EXPORT_WORKER_CONFIGURATION_INVALID"
  );
});

test("API starts no export loop and the worker process owns the held narrow port", async () => {
  const [apiSource, workerSource, runbook] = await Promise.all([
    readFile(new URL("../bin/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../bin/worker.mjs", import.meta.url), "utf8"),
    readFile(
      new URL("../../../ops/SITESOURCERY-WORKERS-01-HELD-RUNBOOK.md", import.meta.url),
      "utf8"
    )
  ]);
  assert.doesNotMatch(apiSource, /createExportWorker|exportWorker\.start/u);
  assert.match(workerSource, /createCoreWorkerFactories/u);
  assert.match(
    runbook,
    /Export remains held unless its\s+exact export mode is enabled/iu
  );
});
