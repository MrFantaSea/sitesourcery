import { invariant } from "./errors.mjs";
import {
  createPostgresProviderReconciliationRepository
} from "./provider-reconciliation-postgres.mjs";
import {
  createProviderReconciliationWorker,
  providerReconciliationWorkerOptionsFromEnvironment
} from "./provider-reconciliation-worker.mjs";
import {
  configuredTwilioResponderReadback
} from "./twilio-responder-readback.mjs";
import { WORKER_PURPOSES } from "./worker-config.mjs";

const PURPOSE = "provider-reconciliation";
const MODE_ENVIRONMENT =
  "SITESOURCERY_PROVIDER_RECONCILIATION_WORKER_MODE";
const LOOP_ENVIRONMENT = Object.freeze({
  intervalMs:
    "SITESOURCERY_PROVIDER_RECONCILIATION_WORKER_INTERVAL_MS",
  errorBackoffMs:
    "SITESOURCERY_PROVIDER_RECONCILIATION_WORKER_ERROR_BACKOFF_MS",
  maximumBackoffMs:
    "SITESOURCERY_PROVIDER_RECONCILIATION_WORKER_MAXIMUM_BACKOFF_MS"
});

function selectedPurpose(purposes) {
  invariant(
    Array.isArray(purposes) &&
      purposes.length >= 1 &&
      purposes.length <= WORKER_PURPOSES.length &&
      purposes.every((purpose) => WORKER_PURPOSES.includes(purpose)) &&
      new Set(purposes).size === purposes.length &&
      JSON.stringify(purposes) === JSON.stringify(
        WORKER_PURPOSES.filter((purpose) => purposes.includes(purpose))
      ),
    "WORKER_CONFIGURATION_INVALID",
    "Provider reconciliation worker purposes are invalid.",
    { status: 500 }
  );
  return purposes.includes(PURPOSE);
}

function mode(environment) {
  const value = environment?.[MODE_ENVIRONMENT];
  const selected = typeof value === "string" && value.length > 0
    ? value
    : "held";
  invariant(
    selected === "held" || selected === "approved_live",
    "WORKER_CONFIGURATION_INVALID",
    `${MODE_ENVIRONMENT} must be held or approved_live.`,
    { status: 500 }
  );
  return selected;
}

function exactLoop(environment, configured, options) {
  invariant(
    configured &&
      typeof configured === "object" &&
      !Array.isArray(configured) &&
      Object.keys(configured).length === 3 &&
      Object.keys(LOOP_ENVIRONMENT).every((field) =>
        Number.isSafeInteger(configured[field]) &&
        (
          environment?.[LOOP_ENVIRONMENT[field]] === undefined ||
          environment[LOOP_ENVIRONMENT[field]] === "" ||
          configured[field] === options[field]
        )
      ) &&
      configured.intervalMs >= 1_000 &&
      configured.intervalMs <= 300_000 &&
      configured.errorBackoffMs >= 100 &&
      configured.errorBackoffMs <= 300_000 &&
      configured.maximumBackoffMs >= configured.errorBackoffMs &&
      configured.maximumBackoffMs <= 900_000,
    "WORKER_CONFIGURATION_INVALID",
    "Provider reconciliation loop conflicts with process configuration.",
    { status: 500 }
  );
  return Object.freeze({
    intervalMs: configured.intervalMs,
    errorBackoffMs: configured.errorBackoffMs,
    maximumBackoffMs: configured.maximumBackoffMs
  });
}

export function createReconciliationWorkerFactories({
  authority,
  purposes,
  environment = process.env,
  log = () => {},
  repositoryFactory = createPostgresProviderReconciliationRepository,
  readbackFactory = configuredTwilioResponderReadback,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const selected = selectedPurpose(purposes);
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.readiness === "function" &&
      typeof log === "function" &&
      typeof repositoryFactory === "function" &&
      typeof readbackFactory === "function" &&
      typeof clock?.now === "function",
    "WORKER_CONFIGURATION_INVALID",
    "Reconciliation worker composition dependencies are invalid.",
    { status: 500 }
  );
  if (!selected) return Object.freeze({});

  let compositionPromise = null;
  async function factory({ loop }) {
    if (!compositionPromise) {
      compositionPromise = Promise.resolve().then(async () => {
        const selectedMode = mode(environment);
        const enabled = selectedMode === "approved_live";
        const options =
          providerReconciliationWorkerOptionsFromEnvironment(environment);
        const selectedLoop = exactLoop(environment, loop, options);
        const repository = repositoryFactory({ authority });
        invariant(
          repository?.kind === "provider-reconciliation-postgres" &&
            repository.providerEffects === false,
          "WORKER_CONFIGURATION_INVALID",
          "The reconciliation repository composition is invalid.",
          { status: 500 }
        );
        // Readback is independently held: the reconciliation loop runs its
        // read-only detection, idempotent self-heal, and operator projection
        // whether or not the provider readback credential is verified.
        const readback = readbackFactory({ environment, clock });
        invariant(
          readback?.providerEffects === false && readback.readOnly === true,
          "WORKER_CONFIGURATION_INVALID",
          "The reconciliation readback composition is invalid.",
          { status: 500 }
        );
        const composedReadback = readback.mode === "held" ? null : readback;
        return Object.freeze({
          worker: createProviderReconciliationWorker({
            repository,
            readback: composedReadback,
            clock,
            enabled,
            ...selectedLoop,
            log
          }),
          async readiness() {
            const storage = await repository.readiness();
            const storageReady =
              storage?.ready === true && storage?.verified === true;
            if (!enabled) {
              return Object.freeze({
                schema:
                  "sitesourcery.reconciliation-worker-composition-readiness/v1",
                ready: false,
                verified: false,
                purpose: PURPOSE,
                mode: "held",
                code: "PROVIDER_RECONCILIATION_WORKER_HELD",
                storageReady,
                readback: composedReadback === null ? "held" : "verified",
                providerEffects: false
              });
            }
            return Object.freeze({
              schema:
                "sitesourcery.reconciliation-worker-composition-readiness/v1",
              ready: storageReady,
              verified: storageReady,
              purpose: PURPOSE,
              mode: "approved_live",
              code: storageReady
                ? null
                : "PROVIDER_RECONCILIATION_WORKER_NOT_READY",
              storageReady,
              readback: composedReadback === null ? "held" : "verified",
              providerEffects: false
            });
          }
        });
      });
    }
    return compositionPromise;
  }

  return Object.freeze({ [PURPOSE]: factory });
}
