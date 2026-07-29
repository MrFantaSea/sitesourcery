export const PRODUCT_IDS = Object.freeze(["business", "presence", "spark"]);
export const TENURE_IDS = Object.freeze(["rent", "own", "owned_managed"]);
export const PRODUCT_IMPLEMENTATIONS = Object.freeze({
  business: null,
  presence: null,
  spark: "abracadabra.spark/v1"
});

export const BILLING_SHAPES = Object.freeze({
  rent: Object.freeze({ oneTime: false, recurring: true }),
  own: Object.freeze({ oneTime: true, recurring: false }),
  owned_managed: Object.freeze({ oneTime: true, recurring: true })
});

export const QUOTE_STATES = Object.freeze({
  QUOTED: "quoted",
  CHECKOUT_DISPATCHING: "checkout_dispatching",
  CHECKOUT_READY: "checkout_ready"
});

export const CATALOG_SCHEMA = "sitesourcery.abracadabra-offer-catalog.v1";
export const PUBLIC_CATALOG_SCHEMA = "sitesourcery.abracadabra-public-catalog.v1";
export const QUOTE_SCHEMA = "sitesourcery.abracadabra-customer-quote.v1";
export const QUOTE_TTL_MS = 30 * 60 * 1000;
