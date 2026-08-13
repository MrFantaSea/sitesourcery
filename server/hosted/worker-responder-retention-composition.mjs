import { invariant } from "./errors.mjs";
import {
  createPostgresResponderPrivateMaterialRetentionRepository
} from "./responder-private-material-retention-postgres.mjs";
import {
  createResponderPrivateMaterialRetentionWorker,
  responderRetentionWorkerOptionsFromEnvironment
} from "./responder-private-material-retention-worker.mjs";
import { WORKER_PURPOSES } from "./worker-config.mjs";

const PURPOSE = "responder-retention";
const MODE_ENVIRONMENT = "SITESOURCERY_RESPONDER_RETENTION_WORKER_MODE";
const LOOP_ENVIRONMENT = Object.freeze({
  intervalMs: "SITESOURCERY_RESPONDER_RETENTION_WORKER_INTERVAL_MS",
  errorBackoffMs:
    "SITESOURCERY_RESPONDER_RETENTION_WORKER_ERROR_BACKOFF_MS",
  maximumBackoffMs:
    "SITESOURCERY_RESPONDER_RETENTION_WORKER_MAXIMUM_BACKOFF_MS"
});

function selectedPurpose(purposes) {
  invariant(
    Array.isArray(purposes) && purposes.length >= 1 &&
      purposes.length <= WORKER_PURPOSES.length &&
      purposes.every((purpose) => WORKER_PURPOSES.includes(purpose)) &&
      new Set(purposes).size === purposes.length &&
      JSON.stringify(purposes) === JSON.stringify(
        WORKER_PURPOSES.filter((purpose) => purposes.includes(purpose))
      ),
    "WORKER_CONFIGURATION_INVALID",
    "Responder retention worker purposes are invalid.",
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
    configured && typeof configured === "object" &&
      !Array.isArray(configured) && Object.keys(configured).length === 3 &&
      Object.keys(LOOP_ENVIRONMENT).every((field) =>
        Number.isSafeInteger(configured[field]) &&
        (environment?.[LOOP_ENVIRONMENT[field]] === undefined ||
          environment[LOOP_ENVIRONMENT[field]] === "" ||
          configured[field] === options[field])
      ) &&
      configured.intervalMs >= 1_000 && configured.intervalMs <= 300_000 &&
      configured.errorBackoffMs >= 100 &&
      configured.errorBackoffMs <= 300_000 &&
      configured.maximumBackoffMs >= configured.errorBackoffMs &&
      configured.maximumBackoffMs <= 900_000,
    "WORKER_CONFIGURATION_INVALID",
    "Responder retention loop conflicts with process configuration.",
    { status: 500 }
  );
  return Object.freeze({
    intervalMs: configured.intervalMs,
    errorBackoffMs: configured.errorBackoffMs,
    maximumBackoffMs: configured.maximumBackoffMs
  });
}

export function createResponderRetentionWorkerFactories({
  authority,
  purposes,
  environment = process.env,
  log = () => {},
  repositoryFactory =
    createPostgresResponderPrivateMaterialRetentionRepository,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const selected = selectedPurpose(purposes);
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.readiness === "function" &&
      typeof log === "function" && typeof repositoryFactory === "function" &&
      typeof clock?.now === "function",
    "WORKER_CONFIGURATION_INVALID",
    "Responder retention worker dependencies are invalid.",
    { status: 500 }
  );
  if (!selected) return Object.freeze({});

  let compositionPromise = null;
  async function factory({ loop }) {
    if (!compositionPromise) {
      compositionPromise = Promise.resolve().then(() => {
        const selectedMode = mode(environment);
        const enabled = selectedMode === "approved_live";
        const options = responderRetentionWorkerOptionsFromEnvironment(
          environment
        );
        const selectedLoop = exactLoop(environment, loop, options);
        const repository = repositoryFactory({ authority });
        invariant(
          repository?.kind ===
            "responder-private-material-retention-postgres" &&
            repository.providerEffects === false &&
            repository.decryptsMaterial === false,
          "WORKER_CONFIGURATION_INVALID",
          "Responder retention repository composition is invalid.",
          { status: 500 }
        );
        return Object.freeze({
          worker: createResponderPrivateMaterialRetentionWorker({
            repository,
            clock,
            enabled,
            ...selectedLoop,
            maximumDiscoveriesPerCycle:
              options.maximumDiscoveriesPerCycle,
            maximumDestructionsPerCycle:
              options.maximumDestructionsPerCycle,
            leaseSeconds: options.leaseSeconds,
            log
          }),
          async readiness() {
            const storage = await repository.readiness();
            const storageReady = storage?.ready === true &&
              storage?.verified === true &&
              storage?.providerEffects === false &&
              storage?.decryptsMaterial === false;
            return Object.freeze({
              schema:
                "sitesourcery.responder-retention-worker-composition-readiness/v1",
              ready: enabled && storageReady,
              verified: enabled && storageReady,
              purpose: PURPOSE,
              mode: enabled ? "approved_live" : "held",
              code: enabled
                ? storageReady
                  ? null
                  : "RESPONDER_RETENTION_WORKER_NOT_READY"
                : "RESPONDER_RETENTION_WORKER_HELD",
              storageReady,
              providerEffects: false,
              decryptsMaterial: false
            });
          }
        });
      });
    }
    return compositionPromise;
  }

  return Object.freeze({ [PURPOSE]: factory });
}
