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
    idempotency: "provider-unsupported",
    effectCertainty: "receipt-or-manual-review",
    async readiness() {
      return {
        ready,
        verified: ready,
        provider: "twilio"
      };
    },
    async sendMessage(input) {
      sends.push(input);
      throw new Error("unexpected provider send");
    }
  });
}

function followupRepository({ ready = true, claims = [] } = {}) {
  return Object.freeze({
    kind: "responder-inbound-followup-postgres",
    async readiness() {
      return { ready, verified: ready, providerEffects: false };
    },
    async claimNext(input) {
      claims.push(input);
      return null;
    },
    async completeClaim() {
      throw new Error("unexpected follow-up completion");
    },
    async releaseClaim() {
      throw new Error("unexpected follow-up release");
    }
  });
}

function followupExecutor({ ready = true } = {}) {
  return Object.freeze({
    kind: "responder-inbound-followup-executor",
    providerEffects: false,
    async readiness() {
      return { ready, verified: ready, providerEffects: false };
    },
    async execute() {
      throw new Error("unexpected follow-up execution");
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
    followupRepositoryFactory: () => followupRepository(),
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
    followupQueueReady: true,
    followupReady: false,
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
    followupRepositoryFactory: () => followupRepository(),
    followupExecutorFactory: () => followupExecutor(),
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
    followupQueueReady: true,
    followupReady: true,
    provider: "twilio",
    providerEffects: true
  });
  assert.deepEqual(await composition.worker.runOnce(), {
    status: "processed",
    followup: {
      status: "processed",
      observedAt: "2026-08-12T20:00:00.000Z",
      claimed: 0,
      completed: 0,
      manualReview: 0,
      released: 0
    },
    delivery: { status: "idle" }
  });
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
    followupRepositoryFactory: () => followupRepository(),
    followupExecutorFactory: () => followupExecutor(),
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
    followupRepositoryFactory: () => followupRepository(),
    followupExecutorFactory: () => followupExecutor(),
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

test("approved Responder mode requires the complete implicit production provider configuration", async () => {
  const factories = createResponderWorkerFactories({
    authority: authority(),
    purposes: ["responder-fulfillment"],
    environment: APPROVED_ENVIRONMENT,
    repositoryFactory: () => repository(),
    followupRepositoryFactory: () => followupRepository()
  });
  await assert.rejects(
    factories["responder-fulfillment"]({ loop: LOOP }),
    (error) => error?.code ===
      "RESPONDER_PRIVATE_MATERIAL_CONFIGURATION_REQUIRED"
  );
});
