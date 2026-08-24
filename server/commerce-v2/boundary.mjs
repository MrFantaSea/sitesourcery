import {
  invariant,
  requiredText
} from "./canonical.mjs";

const MONEY_OR_PROVIDER_KEYS = new Set([
  "amount",
  "amountMinor",
  "billing",
  "currency",
  "entitlement",
  "entitlementKind",
  "grants",
  "interval",
  "lineItems",
  "price",
  "priceId",
  "prices",
  "provider",
  "stripePriceId",
  "stripePriceRef",
  "stripePriceRefs",
  "totals"
]);

const LEGACY_KEYS = new Set(["tenure", "tenureId"]);
const LEGACY_VALUES = new Set([
  "rent",
  "own",
  "owned_managed"
]);

function inspectClientValue(value) {
  if (Array.isArray(value)) {
    for (const child of value) inspectClientValue(child);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    invariant(
      !LEGACY_KEYS.has(key),
      "legacy_tenure_rejected",
      "v1 tenure fields are not accepted by commerce v2"
    );
    invariant(
      !MONEY_OR_PROVIDER_KEYS.has(key),
      "client_commerce_authority_rejected",
      "client money, entitlement, and provider authority are rejected"
    );
    inspectClientValue(child);
  }
}

function exactBody(body, allowed) {
  invariant(
    body &&
      typeof body === "object" &&
      !Array.isArray(body),
    "invalid_input",
    "request body is invalid"
  );
  inspectClientValue(body);
  const keys = Object.keys(body).sort();
  invariant(
    keys.join(",") === [...allowed].sort().join(","),
    "invalid_input",
    "request fields do not match the v2 contract"
  );
  for (const value of Object.values(body)) {
    invariant(
      !LEGACY_VALUES.has(value),
      "legacy_tenure_rejected",
      "v1 tenure identifiers are not valid v2 offers"
    );
  }
  return body;
}

function sessionIdentity(session) {
  return {
    tenantId: requiredText(
      session?.tenantId,
      "session.tenantId"
    ),
    customerId: requiredText(
      session?.customerId,
      "session.customerId"
    ),
    actorId: requiredText(
      session?.actorId,
      "session.actorId"
    )
  };
}

export function createCommerceV2Boundary(service) {
  invariant(
    service &&
      typeof service.createQuote === "function" &&
      typeof service.prepareCheckout === "function",
    "invalid_configuration",
    "commerce v2 service is incomplete",
    { status: 500 }
  );

  return Object.freeze({
    async execute({ session, action, body }) {
      const actor = sessionIdentity(session);
      if (action === "quote") {
        const input = exactBody(body, [
          "commandId",
          "offerId",
          "projectId",
          "versionId"
        ]);
        return service.createQuote({
          ...actor,
          ...input
        });
      }
      if (action === "prepare_checkout") {
        const input = exactBody(body, [
          "acceptedDisclosureDigest",
          "clientAddress",
          "commandId",
          "projectId",
          "purchaseTermsAccepted",
          "quoteId",
          "requestId",
          "taxMode",
          "userAgentDigest"
        ]);
        return service.prepareCheckout({
          ...actor,
          ...input
        });
      }
      invariant(
        false,
        "invalid_action",
        "commerce v2 action is invalid",
        { status: 404 }
      );
    }
  });
}
