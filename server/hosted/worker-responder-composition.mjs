import { invariant } from "./errors.mjs";
import {
  createPostgresResponderFulfillmentRepository
} from "./responder-fulfillment-postgres.mjs";
import {
  createResponderFulfillmentWorker,
  responderFulfillmentWorkerOptionsFromEnvironment
} from "./responder-fulfillment-worker.mjs";
import { WORKER_PURPOSES } from "./worker-config.mjs";

const PURPOSE = "responder-fulfillment";
const LOOP_ENVIRONMENT = Object.freeze({
  intervalMs:
    "SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_INTERVAL_MS",
  errorBackoffMs:
    "SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_ERROR_BACKOFF_MS",
  maximumBackoffMs:
    "SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MAXIMUM_BACKOFF_MS"
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
    "Responder worker purposes are invalid.",
    { status: 500 }
  );
  return purposes.includes(PURPOSE);
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
      configured.intervalMs >= 100 &&
      configured.intervalMs <= 300_000 &&
      configured.errorBackoffMs >= 100 &&
      configured.errorBackoffMs <= 300_000 &&
      configured.maximumBackoffMs >= configured.errorBackoffMs &&
      configured.maximumBackoffMs <= 900_000,
    "WORKER_CONFIGURATION_INVALID",
    "Responder worker loop conflicts with process configuration.",
    { status: 500 }
  );
  return Object.freeze({
    intervalMs: configured.intervalMs,
    errorBackoffMs: configured.errorBackoffMs,
    maximumBackoffMs: configured.maximumBackoffMs
  });
}

function heldProvider() {
  return Object.freeze({
    kind: "responder-fulfillment-held-provider",
    providerEffects: false,
    idempotency: "none",
    effectCertainty: "none",
    async sendMessage() {
      throw new Error("Held Responder fulfillment cannot call a provider.");
    }
  });
}

function unavailableProviderFactory() {
  const error = new Error(
    "The reviewed Twilio fulfillment adapter is unavailable."
  );
  error.code = "WORKER_DEPENDENCY_NOT_READY";
  throw error;
}

function validateRepository(repository) {
  invariant(
    repository?.kind === "responder-fulfillment-postgres" &&
      repository.providerEffects === false &&
      typeof repository.readiness === "function" &&
      [
        "claimNextDelivery",
        "recordDeliveryAccepted",
        "recordDeliveryManualReview",
        "recordDeliveryRetry"
      ].every((name) => typeof repository[name] === "function"),
    "WORKER_DEPENDENCY_NOT_READY",
    "The durable Responder fulfillment queue is unavailable.",
    { status: 503 }
  );
  return repository;
}

function validateProvider(provider) {
  invariant(
    provider?.kind === "responder-fulfillment-provider" &&
      provider.providerEffects === true &&
      provider.idempotency === "provider-unsupported" &&
      provider.effectCertainty === "receipt-or-manual-review" &&
      typeof provider.sendMessage === "function" &&
      typeof provider.readiness === "function",
    "WORKER_DEPENDENCY_NOT_READY",
    "The reviewed Responder fulfillment provider is unavailable.",
    { status: 503 }
  );
  return provider;
}

export function createResponderWorkerFactories({
  authority,
  purposes,
  environment = process.env,
  log = () => {},
  repositoryFactory = createPostgresResponderFulfillmentRepository,
  providerFactory = unavailableProviderFactory,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const selected = selectedPurpose(purposes);
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.readiness === "function" &&
      typeof log === "function" &&
      typeof repositoryFactory === "function" &&
      typeof providerFactory === "function" &&
      typeof clock?.now === "function",
    "WORKER_CONFIGURATION_INVALID",
    "Responder worker composition dependencies are invalid.",
    { status: 500 }
  );
  if (!selected) return Object.freeze({});

  let compositionPromise = null;
  async function factory({ loop }) {
    if (!compositionPromise) {
      compositionPromise = Promise.resolve().then(async () => {
        const options =
          responderFulfillmentWorkerOptionsFromEnvironment(environment);
        const selectedLoop = exactLoop(
          environment,
          loop,
          options
        );
        const repository = validateRepository(
          repositoryFactory({ authority })
        );
        const provider = options.enabled
          ? validateProvider(await providerFactory({
              authority,
              environment,
              clock
            }))
          : heldProvider();
        return Object.freeze({
          worker: createResponderFulfillmentWorker({
            repository,
            fulfillmentPort: provider,
            clock,
            enabled: options.enabled,
            leaseMs: options.leaseMs,
            ...selectedLoop,
            log
          }),
          async readiness() {
            const queue = await repository.readiness();
            if (!options.enabled) {
              return Object.freeze({
                schema:
                  "sitesourcery.responder-worker-composition-readiness/v1",
                ready: false,
                verified: false,
                purpose: PURPOSE,
                mode: "held",
                code: "RESPONDER_FULFILLMENT_WORKER_HELD",
                queueReady:
                  queue?.ready === true && queue?.verified === true,
                provider: "uncomposed",
                providerEffects: false
              });
            }
            const providerStatus = await provider.readiness();
            const ready =
              queue?.ready === true &&
              queue?.verified === true &&
              providerStatus?.ready === true &&
              providerStatus?.verified === true;
            return Object.freeze({
              schema:
                "sitesourcery.responder-worker-composition-readiness/v1",
              ready,
              verified: ready,
              purpose: PURPOSE,
              mode: "approved_live",
              code: ready
                ? null
                : "RESPONDER_FULFILLMENT_WORKER_NOT_READY",
              queueReady:
                queue?.ready === true && queue?.verified === true,
              provider: providerStatus?.provider ?? "unverified",
              providerEffects: ready
            });
          }
        });
      });
    }
    return compositionPromise;
  }

  return Object.freeze({ [PURPOSE]: factory });
}
