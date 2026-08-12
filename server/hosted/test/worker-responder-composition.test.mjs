import assert from "node:assert/strict";
import test from "node:test";

import {
  createResponderWorkerFactories
} from "../worker-responder-composition.mjs";

const LOOP = Object.freeze({
  intervalMs: 100,
  errorBackoffMs: 100,
  maximumBackoffMs: 400
});
const APPROVED_ENVIRONMENT = Object.freeze({
  SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MODE: "approved_live",
  SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_LEASE_MS: "30000",
  SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_INTERVAL_MS: "100",
  SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_ERROR_BACKOFF_MS: "100",
  SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MAXIMUM_BACKOFF_MS: "400"
});

function authority() {
  return Object.freeze({
    kind: "canonical-postgres",
    async readiness() {
      return { ready: true };
    }
  });
}

function repository({ ready = true, claims = [] } = {}) {
  return Object.freeze({
    kind: "responder-fulfillment-postgres",
    providerEffects: false,
    async readiness() {
      return {
        ready,
        verified: ready,
        state: ready ? "held-capable" : "not-ready"
      };
    },
    async claimNextDelivery(input) {
      claims.push(input);
      return { status: "idle" };
    },
    async recordDeliveryAccepted() {
      throw new Error("unexpected acceptance");
    },
    async recordDeliveryManualReview() {
      throw new Error("unexpected manual review");
    },
    async recordDeliveryRetry() {
      throw new Error("unexpected retry");
    }
  });
}

function provider({ ready = true, sends = [] } = {}) {
  return Object.freeze({
    kind: "responder-fulfillment-provider",
    providerEffects: true,
    idempotency: "provider-enforced",
    async readiness() {
      return {
        ready,
        verified: ready,
        provider: "phone_bridge"
      };
    },
    async sendMessage(input) {
      sends.push(input);
      throw new Error("unexpected provider send");
    }
  });
}

test("unselected Responder purpose creates no factory", () => {
  assert.deepEqual(createResponderWorkerFactories({
    authority: authority(),
    purposes: ["export"],
    environment: {}
  }), {});
});

test("held Responder composition proves its queue without constructing a provider", async () => {
  let repositories = 0;
  let providers = 0;
  const factories = createResponderWorkerFactories({
    authority: authority(),
    purposes: ["responder-fulfillment"],
    environment: {
      SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MODE: "held"
    },
    repositoryFactory() {
      repositories += 1;
      return repository();
    },
    providerFactory() {
      providers += 1;
      throw new Error("held composition opened provider");
    }
  });
  assert.deepEqual(Object.keys(factories), ["responder-fulfillment"]);
  const composition = await factories["responder-fulfillment"]({
    loop: {
      intervalMs: 5_000,
      errorBackoffMs: 5_000,
      maximumBackoffMs: 60_000
    }
  });
  assert.deepEqual(await composition.readiness(), {
    schema: "sitesourcery.responder-worker-composition-readiness/v1",
    ready: false,
    verified: false,
    purpose: "responder-fulfillment",
    mode: "held",
    code: "RESPONDER_FULFILLMENT_WORKER_HELD",
    queueReady: true,
    provider: "uncomposed",
    providerEffects: false
  });
  assert.equal(composition.worker.start(), false);
  assert.deepEqual(await composition.worker.runOnce(), { status: "held" });
  assert.equal(repositories, 1);
  assert.equal(providers, 0);
});

test("approved Responder composition binds exact queue and provider readiness", async () => {
  const claims = [];
  const sends = [];
  const factories = createResponderWorkerFactories({
    authority: authority(),
    purposes: ["responder-fulfillment"],
    environment: APPROVED_ENVIRONMENT,
    repositoryFactory() {
      return repository({ claims });
    },
    providerFactory() {
      return provider({ sends });
    },
    clock: { now: () => "2026-08-12T20:00:00.000Z" }
  });
  const composition = await factories["responder-fulfillment"]({
    loop: LOOP
  });
  assert.deepEqual(await composition.readiness(), {
    schema: "sitesourcery.responder-worker-composition-readiness/v1",
    ready: true,
    verified: true,
    purpose: "responder-fulfillment",
    mode: "approved_live",
    code: null,
    queueReady: true,
    provider: "phone_bridge",
    providerEffects: true
  });
  assert.deepEqual(await composition.worker.runOnce(), { status: "idle" });
  assert.equal(claims.length, 1);
  assert.equal(
    Date.parse(claims[0].leaseExpiresAt) - Date.parse(claims[0].claimedAt),
    30_000
  );
  assert.deepEqual(sends, []);
});

test("provider or loop drift fails before Responder activation", async () => {
  let providers = 0;
  const notReady = createResponderWorkerFactories({
    authority: authority(),
    purposes: ["responder-fulfillment"],
    environment: APPROVED_ENVIRONMENT,
    repositoryFactory: () => repository(),
    providerFactory() {
      providers += 1;
      return provider({ ready: false });
    }
  });
  const composition = await notReady["responder-fulfillment"]({ loop: LOOP });
  assert.equal((await composition.readiness()).ready, false);
  assert.equal(providers, 1);

  let repositories = 0;
  const drifted = createResponderWorkerFactories({
    authority: authority(),
    purposes: ["responder-fulfillment"],
    environment: APPROVED_ENVIRONMENT,
    repositoryFactory() {
      repositories += 1;
      return repository();
    },
    providerFactory: () => provider()
  });
  await assert.rejects(
    drifted["responder-fulfillment"]({
      loop: { ...LOOP, intervalMs: 200 }
    }),
    (error) => error?.code === "WORKER_CONFIGURATION_INVALID"
  );
  assert.equal(repositories, 0);
});

test("approved Responder mode has no implicit production provider", async () => {
  const factories = createResponderWorkerFactories({
    authority: authority(),
    purposes: ["responder-fulfillment"],
    environment: APPROVED_ENVIRONMENT,
    repositoryFactory: () => repository()
  });
  await assert.rejects(
    factories["responder-fulfillment"]({ loop: LOOP }),
    (error) => error?.code === "WORKER_DEPENDENCY_NOT_READY"
  );
});
