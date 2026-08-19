import path from "node:path";

import {
  createCareLifecycleExecutor,
  createPostgresCareLifecycleWorkerRepository
} from "./care-lifecycle-worker-postgres.mjs";
import { createPostgresCareCoreRepository } from "./care-core-postgres.mjs";
import {
  createConfiguredDomainLifecycleExecutor
} from "./domain-lifecycle-worker-executor.mjs";
import {
  createPostgresDomainLifecycleWorkerRepository
} from "./domain-lifecycle-worker-postgres.mjs";
import { invariant } from "./errors.mjs";
import { createPrivateExportObjectStore } from "./export-object-store.mjs";
import {
  createLeasedLifecycleWorker,
  lifecycleWorkerOptionsFromEnvironment
} from "./leased-lifecycle-worker.mjs";
import {
  createPostgresProjectLifecycleRepository,
  createProjectLifecycleExecutor
} from "./project-lifecycle-postgres.mjs";
import { WORKER_PURPOSES } from "./worker-config.mjs";

const PURPOSES = Object.freeze([
  "project-lifecycle",
  "domain-lifecycle",
  "care-lifecycle"
]);
const PREFIX = Object.freeze({
  "project-lifecycle": "SITESOURCERY_PROJECT_LIFECYCLE_WORKER",
  "domain-lifecycle": "SITESOURCERY_DOMAIN_LIFECYCLE_WORKER",
  "care-lifecycle": "SITESOURCERY_CARE_LIFECYCLE_WORKER"
});

function selectedPurposes(purposes) {
  invariant(
    Array.isArray(purposes) && purposes.length >= 1 &&
      purposes.length <= WORKER_PURPOSES.length &&
      purposes.every((purpose) => WORKER_PURPOSES.includes(purpose)) &&
      new Set(purposes).size === purposes.length &&
      JSON.stringify(purposes) === JSON.stringify(
        WORKER_PURPOSES.filter((purpose) => purposes.includes(purpose))
      ),
    "WORKER_CONFIGURATION_INVALID",
    "Lifecycle worker purposes are invalid.",
    { status: 500 }
  );
  return PURPOSES.filter((purpose) => purposes.includes(purpose));
}

function heldExecutor(purpose) {
  return Object.freeze({
    kind: `${purpose}-executor`,
    async readiness() {
      return Object.freeze({ ready: false, verified: false, mode: "held" });
    },
    async execute() {
      const error = new Error(`${purpose} remains held.`);
      error.code = "LIFECYCLE_WORKER_HELD";
      throw error;
    }
  });
}

export function createLifecycleWorkerFactories({
  authority,
  publicationPort = null,
  purposes,
  environment = process.env,
  log = () => {},
  clock = { now: () => new Date().toISOString() },
  projectRepositoryFactory = createPostgresProjectLifecycleRepository,
  domainRepositoryFactory = createPostgresDomainLifecycleWorkerRepository,
  careRepositoryFactory = createPostgresCareLifecycleWorkerRepository,
  careCoreRepositoryFactory = createPostgresCareCoreRepository,
  domainExecutorFactory = createConfiguredDomainLifecycleExecutor,
  exportStoreFactory = createPrivateExportObjectStore
} = {}) {
  const selected = selectedPurposes(purposes);
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.readiness === "function" && typeof log === "function" &&
      typeof clock?.now === "function",
    "WORKER_CONFIGURATION_INVALID",
    "Lifecycle worker composition dependencies are invalid.",
    { status: 500 }
  );
  const promises = new Map();

  function factoryFor(purpose) {
    return async function factory({ loop }) {
      if (!promises.has(purpose)) {
        promises.set(purpose, Promise.resolve().then(async () => {
          const options = lifecycleWorkerOptionsFromEnvironment(environment, {
            prefix: PREFIX[purpose],
            intervalMs: loop.intervalMs,
            errorBackoffMs: loop.errorBackoffMs,
            maximumBackoffMs: loop.maximumBackoffMs
          });
          let repository;
          let executor;
          if (purpose === "project-lifecycle") {
            repository = projectRepositoryFactory({ authority });
            if (options.enabled) {
              invariant(
                publicationPort &&
                  typeof publicationPort.readiness === "function" &&
                  typeof publicationPort.unpublish === "function",
                "WORKER_DEPENDENCY_NOT_READY",
                "The private publication command client is required.",
                { status: 503 }
              );
              const dataRoot = path.resolve(
                environment.SITESOURCERY_DATA_ROOT ?? "/var/lib/sitesourcery"
              );
              const objectStore = await exportStoreFactory({
                root: path.resolve(
                  environment.SITESOURCERY_EXPORT_ROOT ??
                    path.join(dataRoot, "private-exports")
                )
              });
              executor = createProjectLifecycleExecutor({
                objectStore,
                publicationPort
              });
            } else {
              executor = heldExecutor(purpose);
            }
          } else if (purpose === "domain-lifecycle") {
            repository = domainRepositoryFactory({ authority });
            executor = await domainExecutorFactory({
              authority,
              environment,
              clock
            });
          } else {
            repository = careRepositoryFactory({ authority });
            executor = options.enabled
              ? createCareLifecycleExecutor({
                  careRepository: careCoreRepositoryFactory({ authority })
                })
              : heldExecutor(purpose);
          }
          const worker = createLeasedLifecycleWorker({
            purpose,
            repository,
            executor,
            clock,
            enabled: options.enabled,
            intervalMs: options.intervalMs,
            errorBackoffMs: options.errorBackoffMs,
            maximumBackoffMs: options.maximumBackoffMs,
            batchLimit: options.batchLimit,
            leaseSeconds: options.leaseSeconds,
            log
          });
          return Object.freeze({
            worker,
            async readiness() {
              const [storage, dependency, publication] = await Promise.all([
                repository.readiness(),
                executor.readiness(),
                purpose === "project-lifecycle" && options.enabled
                  ? publicationPort.readiness()
                  : Promise.resolve(null)
              ]);
              const externalReplicaReady =
                purpose !== "project-lifecycle" ||
                Number(storage?.externalReplicas ?? 0) === 0;
              const publicationTransportReady =
                purpose !== "project-lifecycle" ||
                options.enabled !== true || publication?.ready === true;
              const ready = options.enabled && storage?.ready === true &&
                storage?.verified === true && dependency?.ready === true &&
                dependency?.verified === true && externalReplicaReady &&
                publicationTransportReady;
              return Object.freeze({
                schema: "sitesourcery.lifecycle-worker-composition-readiness/v1",
                ready,
                verified: ready,
                purpose,
                mode: options.mode,
                storageReady: storage?.ready === true,
                dependencyReady: dependency?.ready === true,
                externalReplicaReady,
                publicationTransportReady,
                providerEffects: false,
                code: ready ? null : `${purpose.toUpperCase().replaceAll("-", "_")}_HELD`
              });
            }
          });
        }));
      }
      return promises.get(purpose);
    };
  }

  return Object.freeze(Object.fromEntries(
    selected.map((purpose) => [purpose, factoryFor(purpose)])
  ));
}
