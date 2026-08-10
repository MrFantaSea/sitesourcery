import path from "node:path";

import {
  cancellationWorkerOptionsFromEnvironment,
  createCancellationWorker
} from "./cancellation-worker.mjs";
import { invariant } from "./errors.mjs";
import { createPrivateExportObjectStore } from "./export-object-store.mjs";
import {
  createExportWorker,
  exportWorkerOptionsFromEnvironment
} from "./export-worker.mjs";
import {
  createCanonicalPostgresWorkerPorts
} from "./postgres-service.mjs";
import {
  createConfiguredStripeProvider
} from "./stripe-production-config.mjs";
import { WORKER_PURPOSES } from "./worker-config.mjs";

const CORE_PURPOSES = Object.freeze([
  "export",
  "cancellation"
]);

const LOOP_ENVIRONMENT = Object.freeze({
  cancellation: Object.freeze({
    intervalMs:
      "SITESOURCERY_PAYMENT_WORKER_INTERVAL_MS",
    errorBackoffMs:
      "SITESOURCERY_PAYMENT_WORKER_ERROR_BACKOFF_MS",
    maximumBackoffMs:
      "SITESOURCERY_PAYMENT_WORKER_MAXIMUM_BACKOFF_MS"
  }),
  export: Object.freeze({
    intervalMs:
      "SITESOURCERY_EXPORT_WORKER_INTERVAL_MS",
    errorBackoffMs:
      "SITESOURCERY_EXPORT_WORKER_ERROR_BACKOFF_MS",
    maximumBackoffMs:
      "SITESOURCERY_EXPORT_WORKER_MAXIMUM_BACKOFF_MS"
  })
});

function selectedPurposes(purposes) {
  invariant(
    Array.isArray(purposes) &&
      purposes.length >= 1 &&
      purposes.length <= WORKER_PURPOSES.length &&
      purposes.every((purpose) =>
        WORKER_PURPOSES.includes(purpose)
      ) &&
      new Set(purposes).size === purposes.length &&
      JSON.stringify(purposes) === JSON.stringify(
        WORKER_PURPOSES.filter((purpose) =>
          purposes.includes(purpose)
        )
      ),
    "WORKER_CONFIGURATION_INVALID",
    "Core worker purposes are invalid.",
    { status: 500 }
  );
  return CORE_PURPOSES.filter((purpose) =>
    purposes.includes(purpose)
  );
}

function exactLoop(
  purpose,
  environment,
  configured,
  purposeOptions
) {
  invariant(
    configured &&
      typeof configured === "object" &&
      Object.keys(configured).length === 3 &&
      [
        "intervalMs",
        "errorBackoffMs",
        "maximumBackoffMs"
      ].every((field) =>
        Number.isSafeInteger(configured[field])
      ) &&
      configured.intervalMs >= 100 &&
      configured.intervalMs <= 300_000 &&
      configured.errorBackoffMs >= 100 &&
      configured.errorBackoffMs <= 300_000 &&
      configured.maximumBackoffMs >=
        configured.errorBackoffMs &&
      configured.maximumBackoffMs <= 900_000,
    "WORKER_CONFIGURATION_INVALID",
    `The ${purpose} worker loop is invalid.`,
    { status: 500 }
  );
  for (const [field, variable] of Object.entries(
    LOOP_ENVIRONMENT[purpose]
  )) {
    const value = environment?.[variable];
    invariant(
      value === undefined ||
        value === "" ||
        purposeOptions[field] === configured[field],
      "WORKER_CONFIGURATION_INVALID",
      `The ${purpose} worker loop conflicts with its process configuration.`,
      { status: 500 }
    );
  }
  return Object.freeze({
    intervalMs: configured.intervalMs,
    errorBackoffMs: configured.errorBackoffMs,
    maximumBackoffMs:
      configured.maximumBackoffMs
  });
}

export function createCoreWorkerFactories({
  authority,
  purposes,
  environment = process.env,
  log = () => {},
  workerPortsFactory =
    createCanonicalPostgresWorkerPorts,
  stripeFactory = createConfiguredStripeProvider,
  exportStoreFactory = createPrivateExportObjectStore
} = {}) {
  const corePurposes = selectedPurposes(purposes);
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.readiness === "function" &&
      typeof log === "function" &&
      typeof workerPortsFactory === "function" &&
      typeof stripeFactory === "function" &&
      typeof exportStoreFactory === "function",
    "WORKER_CONFIGURATION_INVALID",
    "Core worker composition dependencies are invalid.",
    { status: 500 }
  );

  let cancellationPromise = null;
  let exportPromise = null;

  async function cancellation({ loop }) {
    if (!cancellationPromise) {
      cancellationPromise = Promise.resolve().then(() => {
        const options =
          cancellationWorkerOptionsFromEnvironment(
            environment
          );
        const selectedLoop = exactLoop(
          "cancellation",
          environment,
          loop,
          options
        );
        const stripe = stripeFactory({ environment });
        const ports = workerPortsFactory({
          purposes: ["cancellation"],
          authority,
          paymentProvider: stripe.adapter
        });
        invariant(
          ports?.schema ===
              "sitesourcery.postgres-worker-ports/v1" &&
            ports.cancellation &&
            typeof ports.cancellation.readiness ===
              "function" &&
            typeof ports.cancellation
              .processPaymentOutbox === "function",
          "WORKER_DEPENDENCY_NOT_READY",
          "Cancellation worker port is unavailable.",
          { status: 503 }
        );
        return Object.freeze({
          worker: createCancellationWorker({
            service: ports.cancellation,
            batchLimit: options.batchLimit,
            ...selectedLoop,
            log
          }),
          readiness() {
            return ports.cancellation.readiness();
          }
        });
      });
    }
    return cancellationPromise;
  }

  async function exportFactory({ loop }) {
    if (!exportPromise) {
      exportPromise = (async () => {
        const options =
          exportWorkerOptionsFromEnvironment(
            environment
          );
        const selectedLoop = exactLoop(
          "export",
          environment,
          loop,
          options
        );
        if (!options.enabled) {
          const service = Object.freeze({
            async processQueuedExports() {
              throw new Error(
                "Held export worker cannot process exports."
              );
            }
          });
          return Object.freeze({
            worker: createExportWorker({
              service,
              enabled: false,
              batchLimit: options.batchLimit,
              ...selectedLoop,
              log
            }),
            async readiness() {
              return Object.freeze({
                schema:
                  "sitesourcery.export-worker-composition-readiness/v1",
                ready: false,
                purpose: "export",
                state: "held",
                code: "EXPORT_WORKER_HELD",
                providerEffects: "none"
              });
            }
          });
        }
        const dataRoot = path.resolve(
          environment.SITESOURCERY_DATA_ROOT ??
            "/var/lib/sitesourcery"
        );
        const exportStore = await exportStoreFactory({
          root: path.resolve(
            environment.SITESOURCERY_EXPORT_ROOT ??
              path.join(dataRoot, "private-exports")
          )
        });
        const ports = workerPortsFactory({
          purposes: ["export"],
          authority,
          exportStore
        });
        invariant(
          ports?.schema ===
              "sitesourcery.postgres-worker-ports/v1" &&
            ports.export &&
            typeof ports.export.readiness ===
              "function" &&
            typeof ports.export.processQueuedExports ===
              "function",
          "WORKER_DEPENDENCY_NOT_READY",
          "Export worker port is unavailable.",
          { status: 503 }
        );
        return Object.freeze({
          worker: createExportWorker({
            service: ports.export,
            enabled: true,
            batchLimit: options.batchLimit,
            ...selectedLoop,
            log
          }),
          readiness() {
            return ports.export.readiness();
          }
        });
      })();
    }
    return exportPromise;
  }

  return Object.freeze(Object.fromEntries(
    corePurposes.map((purpose) => [
      purpose,
      purpose === "export"
        ? exportFactory
        : cancellation
    ])
  ));
}
