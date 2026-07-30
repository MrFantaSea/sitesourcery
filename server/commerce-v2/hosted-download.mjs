import {
  CommerceV2Error,
  clone,
  invariant,
  requiredText
} from "./canonical.mjs";
import { HostedError } from "../hosted/errors.mjs";

function requireActor(actor) {
  if (
    !actor ||
    typeof actor.userId !== "string" ||
    actor.userId.length === 0
  ) {
    throw new HostedError(
      "AUTHENTICATION_REQUIRED",
      "Sign in before using Download.",
      { status: 401 }
    );
  }
  return actor;
}

function translate(error) {
  if (error instanceof HostedError) return error;
  if (error instanceof CommerceV2Error) {
    return new HostedError(
      `COMMERCE_V2_${error.code.toUpperCase()}`,
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

function publicQuote(quote) {
  return Object.freeze({
    schema: quote.schema,
    quoteId: quote.quoteId,
    catalogVersion: quote.catalogVersion,
    termsVersion: quote.termsVersion,
    state: quote.state,
    dispatchAuthorized: quote.dispatchAuthorized,
    project: clone(quote.project),
    version: clone(quote.version),
    offerId: quote.offerId,
    entitlementKind: quote.entitlementKind,
    price: clone(quote.price),
    issuedAt: quote.issuedAt,
    expiresAt: quote.expiresAt,
    disclosure: clone(quote.disclosure),
    disclosureDigest: quote.disclosureDigest,
    snapshotDigest: quote.snapshotDigest
  });
}

function publicPreparation(preparation) {
  return Object.freeze({
    schema: preparation.schema,
    commandId: preparation.commandId,
    quoteId: preparation.quoteId,
    projectId: preparation.projectId,
    versionId: preparation.versionId,
    offerId: preparation.offerId,
    entitlementKind: preparation.entitlementKind,
    state: preparation.state,
    holdReason: preparation.holdReason,
    dispatchAuthorized:
      preparation.dispatchAuthorized,
    provider: preparation.provider,
    preparedAt: preparation.preparedAt,
    purposeDigest: preparation.purposeDigest
  });
}

function validateScopedSession(value, actor, projectId) {
  invariant(
    value &&
      value.projectId === projectId &&
      value.actorId === actor.userId,
    "project_unavailable",
    "the editor project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    tenantId: requiredText(
      value.tenantId,
      "scope.tenantId"
    ),
    customerId: requiredText(
      value.customerId,
      "scope.customerId"
    ),
    actorId: requiredText(
      value.actorId,
      "scope.actorId"
    )
  });
}

export function createHeldHostedDownloadCommerce() {
  function held(actor) {
    requireActor(actor);
    throw new HostedError(
      "DOWNLOAD_COMMERCE_HELD",
      "Download purchasing is held in this runtime.",
      { status: 503 }
    );
  }
  return Object.freeze({
    async readiness() {
      return {
        quote: false,
        payment: false,
        state: "held"
      };
    },
    createQuote: held,
    prepareCheckout: held
  });
}

export function createHostedDownloadCommerce({
  boundary,
  resolveSession
}) {
  invariant(
    boundary &&
      typeof boundary.execute === "function",
    "invalid_configuration",
    "commerce v2 customer boundary is required",
    { status: 500 }
  );
  invariant(
    typeof resolveSession === "function",
    "invalid_configuration",
    "commerce v2 project scope resolver is required",
    { status: 500 }
  );

  async function sessionFor(actor, projectId) {
    const authenticated = requireActor(actor);
    const selectedProjectId = requiredText(
      projectId,
      "projectId"
    );
    return validateScopedSession(
      await resolveSession({
        actor: authenticated,
        projectId: selectedProjectId
      }),
      authenticated,
      selectedProjectId
    );
  }

  return Object.freeze({
    async readiness() {
      return {
        quote: true,
        payment: false,
        state: "quote_only"
      };
    },
    async createQuote(actor, projectId, input) {
      return translated(async () => {
        invariant(
          !["offerId", "projectId", "quoteId"].some(
            (field) =>
              Object.hasOwn(input ?? {}, field)
          ),
          Object.hasOwn(input ?? {}, "offerId")
            ? "provisional_offer_not_available"
            : "route_binding_rejected",
          Object.hasOwn(input ?? {}, "offerId")
            ? "The customer Download route does not accept another offer."
            : "Project and quote identity come only from the Download route."
        );
        const session = await sessionFor(
          actor,
          projectId
        );
        const quote = await boundary.execute({
          session,
          action: "quote",
          body: {
            ...(input ?? {}),
            projectId,
            offerId: "spark_download"
          }
        });
        return publicQuote(quote);
      });
    },

    async prepareCheckout(
      actor,
      projectId,
      quoteId,
      input
    ) {
      return translated(async () => {
        invariant(
          !["offerId", "projectId", "quoteId"].some(
            (field) =>
              Object.hasOwn(input ?? {}, field)
          ),
          Object.hasOwn(input ?? {}, "offerId")
            ? "provisional_offer_not_available"
            : "route_binding_rejected",
          Object.hasOwn(input ?? {}, "offerId")
            ? "The customer Download route does not accept another offer."
            : "Project and quote identity come only from the Download route."
        );
        const session = await sessionFor(
          actor,
          projectId
        );
        const preparation = await boundary.execute({
          session,
          action: "prepare_checkout",
          body: {
            ...(input ?? {}),
            projectId,
            quoteId
          }
        });
        return publicPreparation(preparation);
      });
    }
  });
}
