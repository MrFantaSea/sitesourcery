import {
  clone,
  CommerceV2Error,
  deepFreeze,
  invariant,
  requiredDigest,
  requiredText
} from "./canonical.mjs";
import { HostedError } from "../hosted/errors.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CHECKOUT_READY_SCHEMA =
  "sitesourcery.alakazam-checkout-ready/v1";

function requireActor(actor) {
  if (
    !actor ||
    typeof actor.userId !== "string" ||
    actor.userId.length === 0
  ) {
    throw new HostedError(
      "AUTHENTICATION_REQUIRED",
      "Sign in before using Alakazam billing.",
      { status: 401 }
    );
  }
  return actor;
}

function translate(error) {
  if (error instanceof HostedError) return error;
  if (error instanceof CommerceV2Error) {
    return new HostedError(
      `ALAKAZAM_${error.code.toUpperCase()}`,
      error.message,
      { status: error.status }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw translate(error);
  }
}

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function exactInput(value, expected, message) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "route_binding_rejected",
    message
  );
  return value;
}

function validateScope(value, actor, projectId) {
  invariant(
    value &&
      typeof value === "object" &&
      UUID.test(value.tenantId ?? "") &&
      value.projectId === projectId &&
      value.actorId === actor.userId &&
      value.customerId === actor.userId,
    "project_unavailable",
    "the customer billing project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    tenantId: value.tenantId,
    customerId: value.customerId,
    actorId: value.actorId,
    projectId
  });
}

function publicAppliedValue(value) {
  return Object.freeze({
    kind: value?.kind,
    amountMinor: value?.amountMinor
  });
}

function publicDueNow(value) {
  return Object.freeze({
    subtotalMinor: value?.subtotalMinor,
    currency: value?.currency,
    taxMinor: value?.taxMinor,
    totalMinor: value?.totalMinor,
    taxState: value?.taxState
  });
}

function publicRenewal(value) {
  return Object.freeze({
    tierId: value?.tierId,
    amountMinor: value?.amountMinor,
    currency: value?.currency,
    interval: value?.interval
  });
}

function publicTier(value) {
  return Object.freeze({
    tierId: value?.tierId,
    rank: value?.rank,
    name: value?.name,
    price: Object.freeze({
      amountMinor: value?.price?.amountMinor,
      currency: value?.price?.currency,
      billing: value?.price?.billing,
      interval: value?.price?.interval
    }),
    capabilities: clone(value?.capabilities),
    limits: Object.freeze({
      careClass: value?.limits?.careClass,
      versionHistory: value?.limits?.versionHistory,
      fontControls: value?.limits?.fontControls,
      borderControls: value?.limits?.borderControls
    })
  });
}

function publicDisclosure(value) {
  return Object.freeze({
    schema: value?.schema,
    changeKind: value?.changeKind,
    currentTierId: value?.currentTierId,
    targetTierId: value?.targetTierId,
    dueNow: publicDueNow(value?.dueNow),
    appliedValue: publicAppliedValue(
      value?.appliedValue
    ),
    effectiveAt: value?.effectiveAt,
    renewal: publicRenewal(value?.renewal),
    downgrade: Object.freeze({
      cashRefundMinor:
        value?.downgrade?.cashRefundMinor,
      providerProration:
        value?.downgrade?.providerProration,
      currentTierKeptThroughPeriod:
        value?.downgrade
          ?.currentTierKeptThroughPeriod
    }),
    premiumConfiguration:
      value?.premiumConfiguration,
    cancellationPolicy: value?.cancellationPolicy
  });
}

function publicQuote(quote) {
  return deepFreeze({
    schema: quote?.schema,
    quoteId: quote?.quoteId,
    projectId: quote?.projectId,
    catalogVersion: quote?.catalogVersion,
    termsVersion: quote?.termsVersion,
    state: quote?.state,
    changeKind: quote?.changeKind,
    targetTier: publicTier(quote?.targetTier),
    dueNow: publicDueNow(quote?.dueNow),
    appliedValue: publicAppliedValue(
      quote?.appliedValue
    ),
    effectiveAt: quote?.effectiveAt,
    nextRenewal: publicRenewal(quote?.nextRenewal),
    noMidPeriodRefundOrProration:
      quote?.noMidPeriodRefundOrProration,
    premiumConfiguration:
      quote?.premiumConfiguration,
    issuedAt: quote?.issuedAt,
    expiresAt: quote?.expiresAt,
    disclosure: publicDisclosure(quote?.disclosure),
    disclosureDigest: quote?.disclosureDigest,
    quoteDigest: quote?.quoteDigest
  });
}

function publicCheckout(value) {
  invariant(
    value?.status === "ready",
    "repository_conflict",
    "the Alakazam Checkout result is unavailable",
    { status: 500 }
  );
  return deepFreeze({
    schema: CHECKOUT_READY_SCHEMA,
    commandId: value.dispatchId,
    projectId: value.projectId,
    quoteId: value.quoteId,
    state: "ready",
    purposeDigest: value.purposeDigest,
    checkoutUrl: value.checkout?.url,
    expiresAt: value.checkout?.expiresAt
  });
}

function publicReadiness(value) {
  return deepFreeze({
    ready: value?.ready === true,
    quote: value?.quote === true,
    checkout: value?.checkout === true,
    state: requiredText(
      value?.state,
      "billing.readiness.state",
      50
    )
  });
}

export function createHeldHostedAlakazamBilling() {
  function held(actor) {
    requireActor(actor);
    throw new HostedError(
      "ALAKAZAM_BILLING_HELD",
      "Alakazam billing is held in this runtime.",
      { status: 503 }
    );
  }
  return Object.freeze({
    async readiness() {
      return deepFreeze({
        ready: false,
        quote: false,
        checkout: false,
        state: "held"
      });
    },
    createQuote: held,
    createCheckout: held
  });
}

export function createHostedAlakazamBilling({
  billing,
  resolveSession
} = {}) {
  invariant(
    billing &&
      typeof billing.readiness === "function" &&
      typeof billing.createQuote === "function" &&
      typeof billing.createCheckout === "function",
    "invalid_configuration",
    "the Alakazam billing service is required",
    { status: 500 }
  );
  invariant(
    typeof resolveSession === "function",
    "invalid_configuration",
    "the Alakazam project scope resolver is required",
    { status: 500 }
  );

  async function sessionFor(actorInput, projectIdInput) {
    const actor = requireActor(actorInput);
    const projectId = exactUuid(
      projectIdInput,
      "projectId"
    );
    const scope = validateScope(
      await resolveSession({ actor, projectId }),
      actor,
      projectId
    );
    return { actor, scope };
  }

  return Object.freeze({
    async readiness() {
      return translated(async () =>
        publicReadiness(await billing.readiness())
      );
    },

    async createQuote(actorInput, routeProjectId, input) {
      return translated(async () => {
        const actor = requireActor(actorInput);
        const selected = exactInput(
          input,
          ["commandId", "targetTierId"],
          "Alakazam quote accepts only the target tier and idempotency identity."
        );
        const quoteId = exactUuid(
          selected.commandId,
          "commandId"
        );
        const targetTierId = requiredText(
          selected.targetTierId,
          "targetTierId",
          100
        );
        const { scope } = await sessionFor(
          actor,
          routeProjectId
        );
        return publicQuote(
          await billing.createQuote({
            tenantId: scope.tenantId,
            customerId: scope.customerId,
            projectId: scope.projectId,
            quoteId,
            targetTierId
          })
        );
      });
    },

    async createCheckout(
      actorInput,
      routeProjectId,
      routeQuoteId,
      input
    ) {
      return translated(async () => {
        const actor = requireActor(actorInput);
        const selected = exactInput(
          input,
          ["acceptedDisclosureDigest", "commandId"],
          "Alakazam Checkout accepts only the accepted disclosure and idempotency identity."
        );
        const commandId = exactUuid(
          selected.commandId,
          "commandId"
        );
        const acceptedDisclosureDigest =
          requiredDigest(
            selected.acceptedDisclosureDigest,
            "acceptedDisclosureDigest"
          );
        const quoteId = exactUuid(
          routeQuoteId,
          "quoteId"
        );
        const { scope } = await sessionFor(
          actor,
          routeProjectId
        );
        return publicCheckout(
          await billing.createCheckout({
            tenantId: scope.tenantId,
            customerId: scope.customerId,
            projectId: scope.projectId,
            quoteId,
            commandId,
            acceptedDisclosureDigest
          })
        );
      });
    }
  });
}
