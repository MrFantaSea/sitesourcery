import assert from "node:assert/strict";
import test from "node:test";

import {
  createReconciliationWorkerFactories
} from "../worker-reconciliation-composition.mjs";
import { WORKER_PURPOSES } from "../worker-config.mjs";

const PURPOSE = "provider-reconciliation";
const LOOP = { intervalMs: 60_000, errorBackoffMs: 5_000, maximumBackoffMs: 300_000 };

function authority() {
  return {
    kind: "canonical-postgres",
    async readiness() {
      return { ready: true };
    },
    async service() {
      throw new Error("not invoked in composition test");
    }
  };
}

function repositoryFactory() {
  return {
    kind: "provider-reconciliation-postgres",
    providerEffects: false,
    async readiness() {
      return { ready: true, verified: true };
    },
    runDetection() {},
    escalateAbandonedClaim() {},
    recordReadback() {},
    listReadbackCandidates() {},
    listOpenCases() {}
  };
}

function readbackFactory({ mode = "held" } = {}) {
  return {
    kind: "twilio-responder-readback",
    mode,
    providerEffects: false,
    readOnly: true,
    async readiness() {
      return { ready: mode !== "held", verified: mode !== "held" };
    },
    findMessages() {}
  };
}

test("the composition only activates when its purpose is selected", () => {
  assert.deepEqual(
    createReconciliationWorkerFactories({
      authority: authority(),
      purposes: ["export"],
      environment: {},
      repositoryFactory,
      readbackFactory: () => readbackFactory()
    }),
    Object.freeze({})
  );
  const factories = createReconciliationWorkerFactories({
    authority: authority(),
    purposes: [...WORKER_PURPOSES],
    environment: {},
    repositoryFactory,
    readbackFactory: () => readbackFactory()
  });
  assert.equal(typeof factories[PURPOSE], "function");
});

test("held mode composes a disabled worker with held readback and truthful readiness", async () => {
  const factories = createReconciliationWorkerFactories({
    authority: authority(),
    purposes: [PURPOSE],
    environment: {},
    repositoryFactory,
    readbackFactory: () => readbackFactory({ mode: "held" })
  });
  const composed = await factories[PURPOSE]({ loop: LOOP });
  assert.equal(composed.worker.snapshot().enabled, false);
  assert.equal(composed.worker.snapshot().readbackComposed, false);
  const readiness = await composed.readiness();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.mode, "held");
  assert.equal(readiness.readback, "held");
  assert.equal(readiness.providerEffects, false);
});

test("approved_live mode enables the worker and reflects verified readback", async () => {
  const factories = createReconciliationWorkerFactories({
    authority: authority(),
    purposes: [PURPOSE],
    environment: {
      SITESOURCERY_PROVIDER_RECONCILIATION_WORKER_MODE: "approved_live",
      SITESOURCERY_TWILIO_READBACK_MODE: "verified"
    },
    repositoryFactory,
    readbackFactory: () => readbackFactory({ mode: "verified-read-only" })
  });
  const composed = await factories[PURPOSE]({ loop: LOOP });
  assert.equal(composed.worker.snapshot().enabled, true);
  assert.equal(composed.worker.snapshot().readbackComposed, true);
  const readiness = await composed.readiness();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.mode, "approved_live");
  assert.equal(readiness.readback, "verified");
  assert.equal(readiness.providerEffects, false);
});

test("an out-of-order purpose list is rejected", () => {
  assert.throws(
    () => createReconciliationWorkerFactories({
      authority: authority(),
      purposes: [PURPOSE, "export"],
      environment: {},
      repositoryFactory,
      readbackFactory: () => readbackFactory()
    }),
    (error) => error?.code === "WORKER_CONFIGURATION_INVALID"
  );
});
