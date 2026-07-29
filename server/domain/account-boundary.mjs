import { DomainError, invariant } from "./errors.mjs";

const ACTIONS = Object.freeze({
  create: "createOrder",
  consent: "recordAgencyConsent",
  quote: "prepareQuote",
  accept_quote: "acceptQuote",
  authorize_payment: "authorizePayment",
  revalidate: "revalidateBeforeConfirm",
  confirm: "submitRegistration",
  poll_registration: "pollRegistration",
  renewal_review: "requestRenewalReview",
  refund: "refundPayment",
  transfer_out: "requestTransferOut",
  export: "exportCustody",
  get: "getOrder"
});

export function createDomainAccountBoundary(orchestrator) {
  invariant(orchestrator && typeof orchestrator === "object", "invalid_boundary", "orchestrator required", {
    status: 500
  });
  return Object.freeze({
    async execute({ session, action, body = {} } = {}) {
      invariant(session?.tenantId && session?.actorId, "authentication_required", "session required", {
        status: 401
      });
      const method = ACTIONS[action];
      invariant(method && typeof orchestrator[method] === "function", "action_not_found", "action not found", {
        status: 404
      });
      invariant(body && typeof body === "object" && !Array.isArray(body), "invalid_input", "body invalid", {
        status: 400
      });
      // Trusted session authority is assigned last. Body-supplied tenant,
      // customer, actor, and role values can never widen access.
      return orchestrator[method]({
        ...body,
        tenantId: session.tenantId,
        customerId: session.customerId ?? null,
        actorId: session.actorId,
        roles: Array.isArray(session.roles) ? [...session.roles] : []
      });
    }
  });
}

export function publicDomainError(error) {
  if (!(error instanceof DomainError)) {
    return { status: 500, body: { error: "internal_error" } };
  }
  return {
    status: error.status,
    body: {
      error: error.code,
      message:
        error.code === "order_not_found" ? "Domain order not found." : error.message
    }
  };
}
