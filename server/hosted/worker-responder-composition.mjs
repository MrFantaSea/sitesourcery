import { invariant } from "./errors.mjs";
import {
  createPostgresResponderFulfillmentRepository
} from "./responder-fulfillment-postgres.mjs";
import {
  createResponderFulfillmentWorker,
  responderFulfillmentWorkerOptionsFromEnvironment
} from "./responder-fulfillment-worker.mjs";
import {
  createPostgresResponderPrivateMaterialResolver
} from "./responder-private-material-postgres.mjs";
import {
  responderPrivateMaterialVaultFromEnvironment
} from "./responder-private-material-vault.mjs";
import {
  createPostgresResponderInboundFollowupRepository,
  createResponderInboundFollowupExecutor
} from "./responder-inbound-followup-worker-postgres.mjs";
import {
  responderInboundMaterialVaultFromEnvironment
} from "./responder-inbound-material-vault.mjs";
import {
  createLeasedLifecycleWorker
} from "./leased-lifecycle-worker.mjs";
import {
  createTwilioResponderTransport
} from "./twilio-responder-transport.mjs";
import {
  twilioIsvProviderRegistryFromEnvironment
} from "./responder-twilio-provider-registry.mjs";
import {
  createPostgresResponderTwilioProviderTopologyRepository
} from "./responder-twilio-provider-topology-postgres.mjs";
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

function configuredProviderFactory({ authority, environment, clock }) {
  const materialResolver =
    createPostgresResponderPrivateMaterialResolver({
      authority,
      vault: responderPrivateMaterialVaultFromEnvironment(environment)
    });
  return createTwilioResponderTransport({
    environment,
    providerRegistry: twilioIsvProviderRegistryFromEnvironment(environment),
    providerTopologyRepository:
      createPostgresResponderTwilioProviderTopologyRepository({ authority }),
    materialResolver,
    clock
  });
}

function configuredFollowupExecutorFactory({ environment }) {
  return createResponderInboundFollowupExecutor({
    inboundVault: responderInboundMaterialVaultFromEnvironment(
      environment,
      {
        // The API already bound this exact digest into the AES-GCM AAD after
        // keyed caller validation. The follow-up executor independently
        // compares the opened caller with the active consent route before it
        // can seal outbound material, so the worker needs no lookup keyring.
        fromRouteDigestCandidates: (_address, authenticatedDigest) =>
          [authenticatedDigest]
      }
    ),
    deliveryVault: responderPrivateMaterialVaultFromEnvironment(environment)
  });
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

function validateFollowupRepository(repository) {
  invariant(
    repository?.kind === "responder-inbound-followup-postgres" &&
      ["readiness", "claimNext", "completeClaim", "releaseClaim"]
        .every((name) => typeof repository[name] === "function"),
    "WORKER_DEPENDENCY_NOT_READY",
    "The durable Responder inbound follow-up queue is unavailable.",
    { status: 503 }
  );
  return repository;
}

function heldFollowupExecutor() {
  return Object.freeze({
    kind: "responder-inbound-followup-executor",
    async readiness() {
      return Object.freeze({ ready: false, verified: false, mode: "held" });
    },
    async execute() {
      throw new Error("Held Responder inbound follow-up cannot open material.");
    }
  });
}

function compositeWorker(deliveryWorker, followupWorker, enabled) {
  return Object.freeze({
    kind: "responder-fulfillment-composite-worker",
    async runOnce({ signal = null } = {}) {
      if (!enabled) return Object.freeze({ status: "held" });
      const followup = await followupWorker.runOnce({ signal });
      const delivery = await deliveryWorker.runOnce({ signal });
      return Object.freeze({ status: "processed", followup, delivery });
    },
    start({ signal = null } = {}) {
      if (!enabled) return false;
      const followupStarted = followupWorker.start({ signal });
      const deliveryStarted = deliveryWorker.start({ signal });
      if (followupStarted !== true || deliveryStarted !== true) {
        void followupWorker.stop();
        void deliveryWorker.stop();
        return false;
      }
      return true;
    },
    async stop() {
      const results = await Promise.allSettled([
        deliveryWorker.stop(),
        followupWorker.stop()
      ]);
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
      return results.some(
        (result) => result.status === "fulfilled" && result.value === true
      );
    },
    snapshot() {
      return Object.freeze({
        kind: "responder-fulfillment-composite-worker-state/v1",
        enabled,
        delivery: deliveryWorker.snapshot(),
        inboundFollowup: followupWorker.snapshot()
      });
    }
  });
}

export function createResponderWorkerFactories({
  authority,
  purposes,
  environment = process.env,
  log = () => {},
  repositoryFactory = createPostgresResponderFulfillmentRepository,
  followupRepositoryFactory =
    createPostgresResponderInboundFollowupRepository,
  followupExecutorFactory = configuredFollowupExecutorFactory,
  providerFactory = configuredProviderFactory,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const selected = selectedPurpose(purposes);
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.readiness === "function" &&
      typeof log === "function" &&
      typeof repositoryFactory === "function" &&
      typeof followupRepositoryFactory === "function" &&
      typeof followupExecutorFactory === "function" &&
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
        const followupRepository = validateFollowupRepository(
          followupRepositoryFactory({ authority })
        );
        const provider = options.enabled
          ? validateProvider(await providerFactory({
              authority,
              environment,
              clock
            }))
          : heldProvider();
        let followupExecutor = heldFollowupExecutor();
        if (options.enabled) {
          followupExecutor = await followupExecutorFactory({
            authority,
            environment,
            clock
          });
        }
        const deliveryWorker = createResponderFulfillmentWorker({
            repository,
            fulfillmentPort: provider,
            clock,
            enabled: options.enabled,
            leaseMs: options.leaseMs,
            ...selectedLoop,
            log
          });
        const followupWorker = createLeasedLifecycleWorker({
          purpose: "responder-inbound-followup",
          repository: followupRepository,
          executor: followupExecutor,
          clock,
          enabled: options.enabled,
          intervalMs: Math.max(selectedLoop.intervalMs, 1_000),
          errorBackoffMs: selectedLoop.errorBackoffMs,
          maximumBackoffMs: selectedLoop.maximumBackoffMs,
          batchLimit: 10,
          leaseSeconds: Math.min(Math.floor(options.leaseMs / 1_000), 300),
          log
        });
        return Object.freeze({
          worker: compositeWorker(
            deliveryWorker,
            followupWorker,
            options.enabled
          ),
          async readiness() {
            const [queue, followupQueue, followupDependency] =
              await Promise.all([
                repository.readiness(),
                followupRepository.readiness(),
                followupExecutor.readiness()
              ]);
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
                followupQueueReady:
                  followupQueue?.ready === true &&
                  followupQueue?.verified === true,
                followupReady: false,
                provider: "uncomposed",
                providerEffects: false
              });
            }
            const providerStatus = await provider.readiness();
            const ready =
              queue?.ready === true &&
              queue?.verified === true &&
              followupQueue?.ready === true &&
              followupQueue?.verified === true &&
              followupDependency?.ready === true &&
              followupDependency?.verified === true &&
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
              followupQueueReady:
                followupQueue?.ready === true &&
                followupQueue?.verified === true,
              followupReady:
                followupDependency?.ready === true &&
                followupDependency?.verified === true,
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
