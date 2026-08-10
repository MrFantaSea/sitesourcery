import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createHeldHostedPaymentProvider
} from "../payment-provider-port.mjs";
import {
  createCanonicalPostgresWorkerPorts
} from "../postgres-service.mjs";

function authority({ ready = true } = {}) {
  const queries = [];
  return {
    queries,
    port: {
      kind: "canonical-postgres",
      async readiness() {
        return { ready };
      },
      async service(_context, work) {
        return work({
          async query(text, values = []) {
            queries.push({ text, values });
            return { rowCount: 0, rows: [] };
          }
        });
      }
    }
  };
}

function exportStore() {
  return Object.freeze({
    kind: "private-filesystem",
    key() {
      return "unused";
    },
    async put() {
      throw new Error("unexpected export write");
    },
    async get() {
      throw new Error("unexpected export read");
    },
    async delete() {
      throw new Error("unexpected export delete");
    }
  });
}

function readyPaymentProvider() {
  return Object.freeze({
    async readiness() {
      return {
        ready: true,
        provider: "stripe",
        mode: "approved_live"
      };
    },
    async createCheckout() {
      throw new Error("unexpected checkout");
    },
    async createBillingPortal() {
      throw new Error("unexpected portal");
    },
    async scheduleCancellation() {
      throw new Error("no cancellation was leased");
    },
    async verifyWebhook() {
      throw new Error("unexpected webhook");
    }
  });
}

test("cancellation worker port is exact and remains held before any lease or provider effect", async () => {
  const database = authority();
  const ports = createCanonicalPostgresWorkerPorts({
    purposes: ["cancellation"],
    authority: database.port,
    paymentProvider:
      createHeldHostedPaymentProvider()
  });

  assert.deepEqual(Object.keys(ports), [
    "schema",
    "cancellation"
  ]);
  assert.deepEqual(Object.keys(ports.cancellation), [
    "kind",
    "readiness",
    "processPaymentOutbox"
  ]);
  assert.deepEqual(
    await ports.cancellation.readiness(),
    {
      schema:
        "sitesourcery.cancellation-worker-port-readiness/v1",
      ready: false,
      purpose: "cancellation",
      persistence: "ready",
      provider: "stripe",
      mode: "held",
      providerEffects: "held",
      code: "WORKER_PAYMENT_PROVIDER_NOT_READY"
    }
  );
  assert.deepEqual(
    await ports.cancellation.processPaymentOutbox({
      limit: 1,
      workerId: "hosted-cancel-port-held"
    }),
    {
      processed: 0,
      failed: 0,
      held: true,
      provider: "stripe",
      mode: "held"
    }
  );
  assert.equal(database.queries.length, 0);
});

test("ready narrow ports preserve cancellation lease and export fence ownership", async () => {
  const cancellationDatabase = authority();
  const cancellation =
    createCanonicalPostgresWorkerPorts({
      purposes: ["cancellation"],
      authority: cancellationDatabase.port,
      paymentProvider: readyPaymentProvider()
    }).cancellation;
  assert.equal(
    (await cancellation.readiness()).ready,
    true
  );
  assert.deepEqual(
    await cancellation.processPaymentOutbox({
      limit: 1,
      workerId: "hosted-cancel-port-ready"
    }),
    {
      processed: 0,
      failed: 0,
      ambiguous: 0,
      held: false,
      provider: "stripe",
      mode: "approved_live"
    }
  );
  assert.equal(cancellationDatabase.queries.length, 1);
  assert.match(
    cancellationDatabase.queries[0].text,
    /for update of outbox skip locked/u
  );

  const exportDatabase = authority();
  const exported = createCanonicalPostgresWorkerPorts({
    purposes: ["export"],
    authority: exportDatabase.port,
    exportStore: exportStore()
  }).export;
  assert.equal((await exported.readiness()).ready, true);
  assert.deepEqual(
    await exported.processQueuedExports({
      workerId: "hosted-export-port-ready",
      limit: 1
    }),
    []
  );
  assert.equal(exportDatabase.queries.length, 1);
  assert.match(
    exportDatabase.queries[0].text,
    /for update of export skip locked/u
  );
});

test("worker ports reject expanded, duplicate, or reordered purpose authority", () => {
  const database = authority();
  for (const purposes of [
    [],
    ["cancellation", "export"],
    ["export", "export"],
    ["publication"]
  ]) {
    assert.throws(
      () => createCanonicalPostgresWorkerPorts({
        purposes,
        authority: database.port,
        exportStore: exportStore(),
        paymentProvider: readyPaymentProvider()
      }),
      (error) =>
        error?.code ===
        "RUNTIME_CONFIGURATION_ERROR"
    );
  }
});

test("narrow ports retain the existing idempotency, ambiguity, lease, and fence source", async () => {
  const source = await readFile(
    new URL("../postgres-service.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /idempotencyKey:\s*`hosted:cancellation:\$\{dispatch\.dedupe_key\}`/u
  );
  assert.match(
    source,
    /when \$4 = 'ambiguous'\s+then 'infinity'::timestamptz/u
  );
  assert.match(
    source,
    /for update of outbox skip locked/u
  );
  assert.match(
    source,
    /for update of export skip locked/u
  );
  assert.match(
    source,
    /attempt_number = \$3\s+and fence_token = \$4/u
  );
});
