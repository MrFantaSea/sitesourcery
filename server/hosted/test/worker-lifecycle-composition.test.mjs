import assert from "node:assert/strict";
import test from "node:test";

import { createLifecycleWorkerFactories } from
  "../worker-lifecycle-composition.mjs";
import { WORKER_PURPOSES } from "../worker-config.mjs";

const LOOP = Object.freeze({
  intervalMs: 5_000,
  errorBackoffMs: 5_000,
  maximumBackoffMs: 60_000
});
const authority = Object.freeze({
  kind: "canonical-postgres",
  async readiness() { return { ready: true }; }
});

function repository(purpose, overrides = {}) {
  return {
    kind: `${purpose}-postgres`,
    async readiness() {
      return {
        ready: true,
        verified: true,
        externalReplicas: 0,
        ...overrides
      };
    },
    async claimNext() { return null; },
    async completeClaim() { return { status: "completed" }; },
    async releaseClaim() { return { status: "released" }; }
  };
}

function executor(purpose, ready = true) {
  return {
    kind: `${purpose}-executor`,
    providerEffects: false,
    readOnly: purpose === "domain-lifecycle",
    async readiness() { return { ready, verified: ready }; },
    async execute() { throw new Error("no claim"); }
  };
}

function dependencies(overrides = {}) {
  return {
    authority,
    publicationPort: {
      async readiness() {
        return { ready: true, held: true };
      },
      async unpublish() {
        return { published: false, status: "unpublished" };
      }
    },
    projectRepositoryFactory: () => repository("project-lifecycle"),
    domainRepositoryFactory: () => repository("domain-lifecycle"),
    careRepositoryFactory: () => repository("care-lifecycle"),
    domainExecutorFactory: async () => executor("domain-lifecycle", false),
    ...overrides
  };
}

test("three lifecycle purposes are canonical and independently selectable", () => {
  for (const purpose of [
    "project-lifecycle", "domain-lifecycle", "care-lifecycle"
  ]) {
    assert.equal(WORKER_PURPOSES.includes(purpose), true);
  }
  const factories = createLifecycleWorkerFactories({
    ...dependencies(),
    purposes: ["project-lifecycle"]
  });
  assert.deepEqual(Object.keys(factories), ["project-lifecycle"]);
});

test("held lifecycle composition constructs no filesystem runtime", async () => {
  let effects = 0;
  const factories = createLifecycleWorkerFactories({
    ...dependencies({
      exportStoreFactory: async () => { effects += 1; }
    }),
    purposes: [...WORKER_PURPOSES]
  });
  for (const purpose of [
    "project-lifecycle", "domain-lifecycle", "care-lifecycle"
  ]) {
    const composed = await factories[purpose]({ loop: LOOP });
    assert.equal((await composed.readiness()).ready, false);
    assert.equal(composed.worker.snapshot().state, "held");
  }
  assert.equal(effects, 0);
});

test("approved read-only Domain lifecycle requires exact storage and adapter readiness", async () => {
  const factories = createLifecycleWorkerFactories({
    ...dependencies({
      domainExecutorFactory: async () => executor("domain-lifecycle", true)
    }),
    purposes: ["domain-lifecycle"],
    environment: {
      SITESOURCERY_DOMAIN_LIFECYCLE_WORKER_MODE: "approved_live"
    }
  });
  const composed = await factories["domain-lifecycle"]({ loop: LOOP });
  assert.equal((await composed.readiness()).ready, true);
  assert.equal(composed.worker.snapshot().enabled, true);
});

test("project lifecycle refuses activation while external replicas lack a deleter", async () => {
  const factories = createLifecycleWorkerFactories({
    ...dependencies({
      projectRepositoryFactory: () => repository("project-lifecycle", {
        externalReplicas: 1
      }),
      exportStoreFactory: async () => ({ delete() {} }),
      publicationPort: {
        async readiness() { return { ready: true, held: true }; },
        async unpublish() { return { published: false }; }
      }
    }),
    purposes: ["project-lifecycle"],
    environment: {
      SITESOURCERY_PROJECT_LIFECYCLE_WORKER_MODE: "approved_live",
      SITESOURCERY_DATA_ROOT: "/private/tmp/sitesourcery-worker-test",
      SITESOURCERY_EXPORT_ROOT: "/private/tmp/sitesourcery-worker-test/exports"
    }
  });
  const composed = await factories["project-lifecycle"]({ loop: LOOP });
  const readiness = await composed.readiness();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.externalReplicaReady, false);
});
