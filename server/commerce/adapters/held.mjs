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
  return Object.freeze({
    async readiness() {
      return { ready: false, reason: "stripe_not_configured" };
    },
    async createCheckout() {
      throw new ExternalEffectError("stripe_not_configured", "Stripe adapter is held", {
        certainty: "no_effect"
      });
    }
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
