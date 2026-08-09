import { ExternalEffectError } from "../../domain/errors.mjs";
import { CATALOG_SCHEMA } from "../constants.mjs";

export function createHeldCatalogPort() {
  return Object.freeze({
    async current() {
      return {
        schema: CATALOG_SCHEMA,
        catalogVersion: "unresolved",
        state: "hold",
        currency: "USD",
        approvedAt: null,
        approvedBy: null,
        termsVersion: "unresolved",
        products: [],
        tenures: [],
        offers: []
      };
    }
  });
}

export function createHeldStripeAdapter() {
  const reject = async () => {
    throw new ExternalEffectError(
      "stripe_not_configured",
      "Stripe adapter is held",
      { certainty: "no_effect" }
    );
  };
  return Object.freeze({
    async readiness() {
      return { ready: false, reason: "stripe_not_configured" };
    },
    createCheckout: reject,
    retrieveAlakazamRenewalInvoice: reject,
    retrieveAlakazamIncidentInvoice: reject,
    retrieveAlakazamCancellation: reject,
    retrieveAlakazamReversal: reject
  });
}

export function createHeldDomainQuotePort() {
  return Object.freeze({
    async resolveForCommerce() {
      return null;
    }
  });
}

export function createHeldProjectPort() {
  return Object.freeze({
    async resolveForCommerce() {
      return null;
    }
  });
}
