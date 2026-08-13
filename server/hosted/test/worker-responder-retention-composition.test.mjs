import assert from "node:assert/strict";
import test from "node:test";

import { WORKER_PURPOSES } from "../worker-config.mjs";
import {
  createResponderRetentionWorkerFactories
} from "../worker-responder-retention-composition.mjs";

const PURPOSE = "responder-retention";
const LOOP = Object.freeze({
  intervalMs: 5_000,
  errorBackoffMs: 5_000,
  maximumBackoffMs: 60_000
});

const authority = Object.freeze({
  kind: "canonical-postgres",
  async readiness() {
    return { ready: true };
  }
});

function repository({ ready = true } = {}) {
  return {
    kind: "responder-private-material-retention-postgres",
    providerEffects: false,
    decryptsMaterial: false,
    async readiness() {
      return {
        ready,
        verified: ready,
        providerEffects: false,
        decryptsMaterial: false
      };
    },
    async discoverEligible() { return { discovered: 0 }; },
    async claimNext() { return null; },
    async destroyClaim() { throw new Error("no claim"); },
    async releaseClaim() { return { status: "released" }; }
  };
}

test("the retention purpose is canonical and unselected composition creates nothing", () => {
  assert.equal(WORKER_PURPOSES.includes(PURPOSE), true);
  assert.deepEqual(createResponderRetentionWorkerFactories({
    authority,
    purposes: ["export"],
    repositoryFactory: () => repository()
  }), {});
});

test("held composition proves storage but refuses worker activation", async () => {
  const factories = createResponderRetentionWorkerFactories({
    authority,
    purposes: [PURPOSE],
    environment: {},
    repositoryFactory: () => repository()
  });
  const composition = await factories[PURPOSE]({ loop: LOOP });
  assert.deepEqual(await composition.readiness(), {
    schema:
      "sitesourcery.responder-retention-worker-composition-readiness/v1",
    ready: false,
    verified: false,
    purpose: PURPOSE,
    mode: "held",
    code: "RESPONDER_RETENTION_WORKER_HELD",
    storageReady: true,
    providerEffects: false,
    decryptsMaterial: false
  });
  assert.equal(composition.worker.start(), false);
  assert.equal(composition.worker.snapshot().state, "held");
});

test("approved composition requires exact storage readback and no decryption port", async () => {
  const factories = createResponderRetentionWorkerFactories({
    authority,
    purposes: [...WORKER_PURPOSES],
    environment: {
      SITESOURCERY_RESPONDER_RETENTION_WORKER_MODE: "approved_live"
    },
    repositoryFactory: () => repository()
  });
  const composition = await factories[PURPOSE]({ loop: LOOP });
  const readiness = await composition.readiness();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.verified, true);
  assert.equal(readiness.decryptsMaterial, false);
  assert.equal(composition.worker.snapshot().enabled, true);

  const unavailable = createResponderRetentionWorkerFactories({
    authority,
    purposes: [PURPOSE],
    environment: {
      SITESOURCERY_RESPONDER_RETENTION_WORKER_MODE: "approved_live"
    },
    repositoryFactory: () => repository({ ready: false })
  });
  const blocked = await unavailable[PURPOSE]({ loop: LOOP });
  assert.equal((await blocked.readiness()).ready, false);
});

test("purpose order, loop drift, and expanded repository authority fail closed", async () => {
  assert.throws(
    () => createResponderRetentionWorkerFactories({
      authority,
      purposes: [PURPOSE, "export"],
      repositoryFactory: () => repository()
    }),
    (error) => error?.code === "WORKER_CONFIGURATION_INVALID"
  );
  const drifted = createResponderRetentionWorkerFactories({
    authority,
    purposes: [PURPOSE],
    environment: {
      SITESOURCERY_RESPONDER_RETENTION_WORKER_INTERVAL_MS: "6000"
    },
    repositoryFactory: () => repository()
  });
  await assert.rejects(
    drifted[PURPOSE]({ loop: LOOP }),
    (error) => error?.code === "WORKER_CONFIGURATION_INVALID"
  );
  const decrypting = createResponderRetentionWorkerFactories({
    authority,
    purposes: [PURPOSE],
    repositoryFactory: () => ({ ...repository(), decryptsMaterial: true })
  });
  await assert.rejects(
    decrypting[PURPOSE]({ loop: LOOP }),
    (error) => error?.code === "WORKER_CONFIGURATION_INVALID"
  );
});
