import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createCoreWorkerFactories
} from "../worker-core-composition.mjs";

const LOOP = Object.freeze({
  intervalMs: 100,
  errorBackoffMs: 100,
  maximumBackoffMs: 800
});

function authority() {
  return Object.freeze({
    kind: "canonical-postgres",
    async readiness() {
      return { ready: true };
    }
  });
}

function turn() {
  return new Promise((resolve) =>
    setImmediate(resolve)
  );
}

test("cancellation factory exposes only the narrow port and drains its active loop", async () => {
  const calls = [];
  let received = null;
  const factories = createCoreWorkerFactories({
    authority: authority(),
    purposes: ["cancellation"],
    environment: {},
    stripeFactory() {
      return { adapter: { kind: "fixture-stripe" } };
    },
    workerPortsFactory(input) {
      received = input;
      return Object.freeze({
        schema:
          "sitesourcery.postgres-worker-ports/v1",
        cancellation: Object.freeze({
          async readiness() {
            return {
              ready: true,
              purpose: "cancellation"
            };
          },
          async processPaymentOutbox(input) {
            calls.push(input);
            return {
              processed: 0,
              failed: 0,
              ambiguous: 0,
              held: false,
              provider: "stripe",
              mode: "approved_live"
            };
          }
        })
      });
    }
  });

  assert.deepEqual(Object.keys(factories), [
    "cancellation"
  ]);
  const composition = await factories.cancellation({
    loop: LOOP
  });
  assert.deepEqual(received.purposes, [
    "cancellation"
  ]);
  assert.equal(received.authority.kind, "canonical-postgres");
  assert.equal(
    received.paymentProvider.kind,
    "fixture-stripe"
  );
  assert.equal(
    (await composition.readiness()).ready,
    true
  );
  assert.equal(composition.worker.start(), true);
  await turn();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].limit, 10);
  assert.match(
    calls[0].workerId,
    /^hosted-cancel-/u
  );
  assert.equal(await composition.worker.stop(), true);
  assert.equal(composition.worker.snapshot().state, "stopped");
});

test("held export factory performs no object-store, database-port, or export effect", async () => {
  let stores = 0;
  let ports = 0;
  const factories = createCoreWorkerFactories({
    authority: authority(),
    purposes: ["export"],
    environment: {
      SITESOURCERY_EXPORT_WORKER_MODE: "held"
    },
    exportStoreFactory: async () => {
      stores += 1;
      throw new Error("held export opened a store");
    },
    workerPortsFactory() {
      ports += 1;
      throw new Error("held export opened a port");
    }
  });
  const composition = await factories.export({
    loop: LOOP
  });
  assert.equal(
    (await composition.readiness()).code,
    "EXPORT_WORKER_HELD"
  );
  assert.equal(composition.worker.start(), false);
  assert.equal(stores, 0);
  assert.equal(ports, 0);
});

test("enabled export factory binds one private store and preserves signal-aware fenced batches", async () => {
  const calls = [];
  const store = { kind: "fixture-private-store" };
  let selectedRoot = null;
  const factories = createCoreWorkerFactories({
    authority: authority(),
    purposes: ["export"],
    environment: {
      SITESOURCERY_EXPORT_WORKER_MODE: "enabled",
      SITESOURCERY_DATA_ROOT: "/private/fixture-data"
    },
    async exportStoreFactory({ root }) {
      selectedRoot = root;
      return store;
    },
    workerPortsFactory(input) {
      assert.equal(input.exportStore, store);
      return Object.freeze({
        schema:
          "sitesourcery.postgres-worker-ports/v1",
        export: Object.freeze({
          async readiness() {
            return { ready: true, purpose: "export" };
          },
          async processQueuedExports(input) {
            calls.push(input);
            return [];
          }
        })
      });
    }
  });
  const composition = await factories.export({
    loop: LOOP
  });
  assert.equal(
    selectedRoot,
    "/private/fixture-data/private-exports"
  );
  assert.equal(
    (await composition.readiness()).ready,
    true
  );
  assert.equal(composition.worker.start(), true);
  await turn();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].limit, 10);
  assert.equal(
    typeof calls[0].signal?.aborted,
    "boolean"
  );
  assert.equal(await composition.worker.stop(), true);
  assert.equal(calls[0].signal.aborted, true);
});

test("purpose loop environment cannot drift from the supervisor contract", async () => {
  let stripeFactories = 0;
  const factories = createCoreWorkerFactories({
    authority: authority(),
    purposes: ["cancellation"],
    environment: {
      SITESOURCERY_PAYMENT_WORKER_INTERVAL_MS:
        "200"
    },
    stripeFactory() {
      stripeFactories += 1;
      throw new Error("invalid loop reached Stripe");
    }
  });
  await assert.rejects(
    factories.cancellation({ loop: LOOP }),
    (error) =>
      error?.code === "WORKER_CONFIGURATION_INVALID"
  );
  const invalidFactories = createCoreWorkerFactories({
    authority: authority(),
    purposes: ["cancellation"],
    environment: {},
    stripeFactory() {
      stripeFactories += 1;
      throw new Error("invalid loop reached Stripe");
    }
  });
  await assert.rejects(
    invalidFactories.cancellation({
      loop: {
        ...LOOP,
        intervalMs: 99
      }
    }),
    (error) =>
      error?.code === "WORKER_CONFIGURATION_INVALID"
  );
  assert.equal(stripeFactories, 0);
});

test("worker composition remains identity blind while the API remains loop-free", async () => {
  const [composition, worker, api] = await Promise.all([
    readFile(
      new URL(
        "../worker-core-composition.mjs",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(
      new URL("../bin/worker.mjs", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../bin/server.mjs", import.meta.url),
      "utf8"
    )
  ]);
  assert.doesNotMatch(
    `${composition}\n${worker}`,
    /identity-postgres|identity-pepper|registrationMail|recoveryMail/iu
  );
  assert.match(worker, /createCoreWorkerFactories/u);
  assert.match(worker, /createNotificationMailWorkerFactories/u);
  assert.doesNotMatch(
    api,
    /createExportWorker|createCancellationWorker|createCoreWorkerFactories|createNotificationMailWorkerFactories/u
  );
});
