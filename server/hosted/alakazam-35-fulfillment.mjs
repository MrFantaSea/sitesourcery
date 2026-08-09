import {
  clone,
  deepFreeze,
  invariant
} from "../commerce-v2/canonical.mjs";

export const ALAKAZAM_35_CLAIM_BINDING = Symbol.for(
  "sitesourcery.alakazam-35-claim-binding/v1"
);

const REPOSITORY_METHODS = Object.freeze([
  "bindFulfillmentDecision",
  "claimNextFulfillment",
  "finalizeFulfillmentPublication",
  "markFulfillmentDark",
  "stageFulfillmentPublication"
]);

export function createAlakazam35FulfillmentRepository({
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
    "The Alakazam $35 fulfillment repository is incomplete.",
    { status: 500 }
  );
  return Object.freeze({
    ...baseRepository,
    async claimNextFulfillment(input) {
      const claimed = await baseRepository.claimNextFulfillment(input);
      if (
        claimed?.status !== "claimed" ||
        !["alakazam_35", "alakazam_50"].includes(
          claimed.authority?.policy?.tierId
        )
      ) {
        return claimed;
      }
      invariant(
        claimed.configuredFacts &&
          typeof claimed.configuredFacts === "object" &&
          !Array.isArray(claimed.configuredFacts) &&
          !Object.prototype.hasOwnProperty.call(
            claimed.configuredFacts,
            ALAKAZAM_35_CLAIM_BINDING
          ),
        "ALAKAZAM_35_COMPILER_INPUT_INVALID",
        "The accepted Alakazam facts contain an invalid internal binding.",
        { status: 409 }
      );
      const binding = await tierRepository.readCompilationBinding({
        tenantId: claimed.tenantId,
        customerId: claimed.customerId,
        actorId: claimed.customerId,
        projectId: claimed.projectId,
        expectedSubscriptionRevision:
          claimed.subscriptionRevision
      });
      const configuredFacts = clone(claimed.configuredFacts);
      Object.defineProperty(
        configuredFacts,
        ALAKAZAM_35_CLAIM_BINDING,
        {
          configurable: false,
          enumerable: false,
          writable: false,
          value: binding
        }
      );
      Object.freeze(configuredFacts);
      return deepFreeze({
        ...claimed,
        configuredFacts
      });
    }
  });
}

export function createAlakazam35TierCompiler({
  baseCompiler,
  alakazam35Compiler
} = {}) {
  invariant(
    baseCompiler &&
      typeof baseCompiler.compileAlakazam === "function" &&
      alakazam35Compiler &&
      typeof alakazam35Compiler.compile === "function",
    "ALAKAZAM_35_COMPILER_UNAVAILABLE",
    "The tier-aware Alakazam compiler is incomplete.",
    { status: 503 }
  );
  return Object.freeze({
    compileAlakazam(input) {
      const tierId = input?.authority?.policy?.tierId;
      if (!["alakazam_35", "alakazam_50"].includes(tierId)) {
        return baseCompiler.compileAlakazam(input);
      }
      const binding = input?.configuredFacts?.[
        ALAKAZAM_35_CLAIM_BINDING
      ];
      invariant(
        binding &&
          Object.keys(binding).length === 2 &&
          "configuration" in binding &&
          "mediaAsset" in binding,
        "ALAKAZAM_35_CONFIGURATION_REQUIRED",
        "The exact Alakazam $35 configuration is required before fulfillment.",
        { status: 409 }
      );
      return alakazam35Compiler.compile({
        authority: input.authority,
        configuredFacts: clone(input.configuredFacts),
        configuration: binding.configuration,
        mediaAsset: binding.mediaAsset
      });
    }
  });
}
