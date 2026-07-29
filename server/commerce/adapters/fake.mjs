import { ExternalEffectError, invariant } from "../../domain/errors.mjs";
import { CATALOG_SCHEMA, PRODUCT_IDS, TENURE_IDS } from "../constants.mjs";

const PRODUCT_NAMES = Object.freeze({
  business: "Abracadabra Business",
  presence: "Abracadabra Presence",
  spark: "Abracadabra Spark"
});

const TENURE_NAMES = Object.freeze({
  rent: "Rent",
  own: "Own",
  owned_managed: "Owned + Managed"
});

const TERMS = Object.freeze({
  rent: Object.freeze({
    renewal: "Renews monthly until canceled.",
    cancellation: "Cancel anytime; cancellation stops the next renewal.",
    ownership: "Licensed for use while the subscription remains active.",
    hosting: "Site Sourcery managed hosting is included while active.",
    paymentGraceDays: 14,
    retentionAndExportDays: 90
  }),
  own: Object.freeze({
    renewal: "The website purchase does not renew.",
    cancellation: "One-time purchases cannot be canceled after delivery begins.",
    ownership: "Website ownership transfers after the one-time payment is complete.",
    hosting: "Ongoing Site Sourcery hosting is not included.",
    paymentGraceDays: null,
    retentionAndExportDays: 90
  }),
  owned_managed: Object.freeze({
    renewal: "Managed hosting renews monthly until canceled; the website purchase does not renew.",
    cancellation: "Cancel managed hosting anytime; website ownership is not canceled.",
    ownership: "Website ownership transfers after the one-time payment is complete.",
    hosting: "Site Sourcery managed hosting is included while the hosting subscription remains active.",
    paymentGraceDays: 14,
    retentionAndExportDays: 90
  })
});

export function createFakeApprovedCatalog(overrides = {}) {
  const products = PRODUCT_IDS.map((productId) => ({
    productId,
    name: PRODUCT_NAMES[productId],
    description: `${PRODUCT_NAMES[productId]} test fixture.`,
    releaseState: productId === "spark" ? "implemented" : "held",
    implementationContract: productId === "spark" ? "abracadabra.spark/v1" : null
  }));
  const tenures = TENURE_IDS.map((tenureId) => ({
    tenureId,
    name: TENURE_NAMES[tenureId],
    terms: TERMS[tenureId]
  }));
  const offers = [];
  let ordinal = 0;
  for (const productId of ["spark"]) {
    for (const tenureId of TENURE_IDS) {
      ordinal += 1;
      const base = ordinal * 10_000;
      const amounts =
        tenureId === "rent"
          ? { recurring: { amountMinor: base + 2500, currency: "USD", interval: "month" } }
          : tenureId === "own"
            ? { oneTime: { amountMinor: base + 5000, currency: "USD" } }
            : {
                oneTime: { amountMinor: base + 5000, currency: "USD" },
                recurring: { amountMinor: base + 2500, currency: "USD", interval: "month" }
              };
      offers.push({
        offerId: `${productId}.${tenureId}.2026-test`,
        productId,
        tenureId,
        state: "approved",
        amounts,
        stripePriceRefs: Object.fromEntries(
          Object.keys(amounts).map((key) => [key, `price_fake_${productId}_${tenureId}_${key}`])
        )
      });
    }
  }
  return {
    schema: CATALOG_SCHEMA,
    catalogVersion: "2026-test.1",
    state: "approved",
    currency: "USD",
    approvedAt: "2026-07-28T12:00:00.000Z",
    approvedBy: "owner-test-fixture",
    termsVersion: "2026-test.1",
    products,
    tenures,
    offers,
    ...structuredClone(overrides)
  };
}

export function createFakeCatalogPort(catalog = createFakeApprovedCatalog()) {
  return Object.freeze({
    async current() {
      return structuredClone(catalog);
    }
  });
}

export function createFakeDomainQuotePort(rows = []) {
  const quotes = new Map(rows.map((row) => [row.id, structuredClone(row)]));
  return Object.freeze({
    async resolveForCommerce({ domainQuoteId }) {
      return structuredClone(quotes.get(domainQuoteId) ?? null);
    }
  });
}

export function createFakeProjectPort(
  rows = [
    {
      tenantId: "tenant_a",
      customerId: "customer_a",
      projectId: "project_a",
      purchasable: true
    }
  ]
) {
  return Object.freeze({
    async resolveForCommerce({ tenantId, customerId, projectId }) {
      const row = rows.find(
        (candidate) =>
          candidate.tenantId === tenantId &&
          candidate.customerId === customerId &&
          candidate.projectId === projectId
      );
      return structuredClone(row ?? null);
    }
  });
}

export function createFakeStripeAdapter({ ambiguous = false } = {}) {
  const calls = [];
  const outcomes = new Map();
  return Object.freeze({
    async readiness() {
      return { ready: true, mode: "fake" };
    },
    async createCheckout(request) {
      calls.push(structuredClone(request));
      if (ambiguous) {
        throw new ExternalEffectError("fake_timeout", "fake Stripe outcome is unknown", {
          certainty: "ambiguous"
        });
      }
      const previous = outcomes.get(request.idempotencyKey);
      if (previous) {
        invariant(
          previous.purposeDigest === request.purposeDigest,
          "fake_idempotency_conflict",
          "fake Stripe idempotency purpose changed",
          { status: 500 }
        );
        return structuredClone(previous.result);
      }
      const result = {
        checkoutId: `cs_fake_${outcomes.size + 1}`,
        url: `https://checkout.example.invalid/session/${outcomes.size + 1}`,
        expiresAt: "2026-07-28T13:00:00.000Z"
      };
      outcomes.set(request.idempotencyKey, { purposeDigest: request.purposeDigest, result });
      return structuredClone(result);
    },
    inspectCalls() {
      return structuredClone(calls);
    }
  });
}

export function createFakeClock(start = "2026-07-28T12:00:00.000Z") {
  let current = start;
  return Object.freeze({
    now() {
      return current;
    },
    set(next) {
      current = next;
    }
  });
}

export function createFakeIds() {
  let next = 0;
  return Object.freeze({
    next(prefix) {
      next += 1;
      return `${prefix}_${next}`;
    }
  });
}
