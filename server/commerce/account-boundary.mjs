import { DomainError, invariant } from "../domain/errors.mjs";

const ACTIONS = Object.freeze({
  catalog: Object.freeze({ method: "getCatalog", fields: [] }),
  quote: Object.freeze({
    method: "createQuote",
    fields: ["projectId", "offerId", "domainQuoteId", "commandId"]
  }),
  checkout: Object.freeze({
    method: "createCheckout",
    fields: ["projectId", "quoteId", "acceptedDisclosureDigest", "commandId"]
  }),
  get_quote: Object.freeze({ method: "getQuote", fields: ["projectId", "quoteId"] })
});

const FORBIDDEN_AUTHORITY = /^(?:amount|amountMinor|currency|price|priceId|stripePriceId|stripePriceRefs|lineItems|totals)$/iu;

function rejectAuthority(value, path = "body") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    invariant(!FORBIDDEN_AUTHORITY.test(key), "client_price_authority_rejected", `${path}.${key} is server authority`, {
      status: 400
    });
    rejectAuthority(child, `${path}.${key}`);
  }
}

export function createCommerceAccountBoundary(service) {
  invariant(service && typeof service === "object", "invalid_boundary", "commerce service required", { status: 500 });
  return Object.freeze({
    async execute({ session, action, body = {} } = {}) {
      invariant(session?.tenantId && session?.actorId, "authentication_required", "session required", { status: 401 });
      const route = ACTIONS[action];
      invariant(route && typeof service[route.method] === "function", "action_not_found", "action not found", {
        status: 404
      });
      invariant(body && typeof body === "object" && !Array.isArray(body), "invalid_input", "body invalid", {
        status: 400
      });
      rejectAuthority(body);
      const unknown = Object.keys(body).filter((key) => !route.fields.includes(key));
      invariant(unknown.length === 0, "invalid_input", `unsupported field ${unknown[0]}`, { status: 400 });
      return service[route.method]({
        ...body,
        tenantId: session.tenantId,
        customerId: session.customerId ?? null,
        actorId: session.actorId
      });
    }
  });
}

export function publicCommerceError(error) {
  if (!(error instanceof DomainError)) return { status: 500, body: { error: "internal_error" } };
  return {
    status: error.status,
    body: {
      error: error.code,
      message:
        error.code === "quote_not_found" || error.code === "domain_quote_unavailable"
          ? "Quote not found."
          : error.message
    }
  };
}
