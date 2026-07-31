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

/**
 * How a customer-owned address came to exist.
 *
 * The customer-facing offer is FOUR choices — buy it and run it yourself, buy it
 * and have it looked after, bring your own, or rent a subdomain — but those are
 * not four billing shapes. "Buy it and run it yourself" and "bring your own" are
 * both the `own` tenure: one payment, no recurring care.
 *
 * What separates them is provenance, and it matters for money rather than
 * presentation. A purchased domain means Site Sourcery pays a registrar, carries
 * the cost, and books a margin; a supplied domain means no money moves at all.
 * Reconciliation, refunds, and the registrar's third-party-agent duties all hang
 * off this distinction, so it is recorded explicitly instead of inferred.
 */
export const ADDRESS_SOURCES = Object.freeze([
  "customer_supplied",
  "site_sourcery_purchased"
]);

export const QUOTE_STATES = Object.freeze({
  QUOTED: "quoted",
  CHECKOUT_DISPATCHING: "checkout_dispatching",
  CHECKOUT_READY: "checkout_ready"
});

export const CATALOG_SCHEMA = "sitesourcery.abracadabra-offer-catalog.v1";
export const PUBLIC_CATALOG_SCHEMA = "sitesourcery.abracadabra-public-catalog.v1";
export const QUOTE_SCHEMA = "sitesourcery.abracadabra-customer-quote.v1";
export const QUOTE_TTL_MS = 30 * 60 * 1000;
