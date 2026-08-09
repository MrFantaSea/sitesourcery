import {
  invariant
} from "../commerce-v2/canonical.mjs";

export const ALAKAZAM_50_CLAIM_BINDING = Symbol.for(
  "sitesourcery.alakazam-50-claim-binding/v1"
);

const REPOSITORY_METHODS = Object.freeze([
  "bindFulfillmentDecision",
  "claimNextFulfillment",
  "finalizeFulfillmentPublication",
  "markFulfillmentDark",
  "stageFulfillmentPublication"
]);

function copyConfiguredFacts(value) {
  const selected = {};
  Object.defineProperties(
    selected,
    Object.getOwnPropertyDescriptors(value)
  );
  return selected;
}

export function createAlakazam50FulfillmentRepository({
  baseRepository,
  tierRepository
} = {}) {
  invariant(
    baseRepository &&
      REPOSITORY_METHODS.every(
        (method) => typeof baseRepository[method] === "function"
      ) &&
      tierRepository &&
      typeof tierRepository.readCompilationBinding === "function",
    "FULFILLMENT_WORKER_INVALID",
    "The Alakazam $50 fulfillment repository is incomplete.",
    { status: 500 }
  );
  return Object.freeze({
    ...baseRepository,
    async claimNextFulfillment(input) {
      const claimed = await baseRepository.claimNextFulfillment(input);
      if (
        claimed?.status !== "claimed" ||
        claimed.authority?.policy?.tierId !== "alakazam_50"
      ) {
        return claimed;
      }
      invariant(
        claimed.configuredFacts &&
          typeof claimed.configuredFacts === "object" &&
          !Array.isArray(claimed.configuredFacts) &&
          !Object.prototype.hasOwnProperty.call(
            claimed.configuredFacts,
            ALAKAZAM_50_CLAIM_BINDING
          ),
        "ALAKAZAM_50_COMPILER_INPUT_INVALID",
        "The accepted Alakazam facts contain an invalid internal binding.",
        { status: 409 }
      );
      const binding = await tierRepository.readCompilationBinding({
        tenantId: claimed.tenantId,
        customerId: claimed.customerId,
        actorId: claimed.customerId,
        projectId: claimed.projectId,
        expectedSubscriptionRevision: claimed.subscriptionRevision
      });
      const configuredFacts = copyConfiguredFacts(claimed.configuredFacts);
      Object.defineProperty(
        configuredFacts,
        ALAKAZAM_50_CLAIM_BINDING,
        {
          configurable: false,
          enumerable: false,
          writable: false,
          value: binding
        }
      );
      Object.freeze(configuredFacts);
      return Object.freeze({
        ...claimed,
        configuredFacts
      });
    }
  });
}

export function createAlakazam50TierCompiler({
  baseCompiler,
  alakazam50Compiler
} = {}) {
  invariant(
    baseCompiler &&
      typeof baseCompiler.compileAlakazam === "function" &&
      alakazam50Compiler &&
      typeof alakazam50Compiler.compile === "function",
    "ALAKAZAM_50_COMPILER_UNAVAILABLE",
    "The tier-aware Alakazam $50 compiler is incomplete.",
    { status: 503 }
  );
  return Object.freeze({
    compileAlakazam(input) {
      if (input?.authority?.policy?.tierId !== "alakazam_50") {
        return baseCompiler.compileAlakazam(input);
      }
      const binding = input?.configuredFacts?.[
        ALAKAZAM_50_CLAIM_BINDING
      ];
      invariant(
        binding &&
          Object.keys(binding).length === 1 &&
          "configuration" in binding,
        "ALAKAZAM_50_CONFIGURATION_REQUIRED",
        "The exact Alakazam $50 configuration is required before fulfillment.",
        { status: 409 }
      );
      return alakazam50Compiler.compile({
        authority: input.authority,
        configuredFacts: input.configuredFacts,
        configuration: binding.configuration
      });
    }
  });
}
