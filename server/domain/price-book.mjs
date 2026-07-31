/**
 * Site Sourcery's domain pricing.
 *
 * WHAT THE OWNER ASKED FOR
 *
 * "Our prices need to be live reflections of the current Spaceship price PLUS
 * our markup." So this module deliberately does NOT hold retail prices. It holds
 * two separable things:
 *
 *   1. COSTS  — what the registrar currently charges us, synced from Spaceship
 *               and stamped with when it was observed.
 *   2. A RULE — the markup, floor, and handling fee that turn a cost into the
 *               figure a customer is quoted.
 *
 * Retail is always computed, never stored. Resync the costs and every quote
 * moves with them; change the rule and every ending reprices at once. Nobody
 * ever hand-types a customer-facing number, which is how price tables rot.
 *
 * THE PART THAT IS STILL BLOCKED, STATED PLAINLY
 *
 * Spaceship's ordinary availability response carries a price only for PREMIUM
 * names. There is no documented no-charge endpoint for a standard `.com` cost,
 * and the MCP tool that has one publishes no server-to-server auth contract.
 * So the cost feed is not automatic yet. Until it is, costs are entered from
 * Spaceship's published rates and carry `observedAt`; anything older than
 * `maxCostAgeMs` refuses to quote rather than sell at a stale number.
 *
 * That staleness guard is the whole safety property. A middleman who quotes from
 * a cost he has not checked is not running a margin, he is running a lottery.
 *
 * PREMIUM NAMES ARE NEVER PRICED HERE
 *
 * Registries price them individually, into the thousands. They ARE detectable —
 * availability returns their price — so they are refused and sent to a manual
 * quote. Guessing at a premium name is the exact failure this module prevents.
 */

import { ExternalEffectError, invariant } from "./errors.mjs";
import { normalizeDomain } from "./canonical.mjs";

/** Provenance for a Site Sourcery computed price. Deliberately NOT the MCP source. */
export const PRICE_BOOK_SOURCE = "sitesourcery.price-book/v1";

function refuse(code, message) {
  throw new ExternalEffectError(code, message, { certainty: "not_submitted" });
}

/**
 * The markup, in one place.
 *
 * retail = max(cost × multiplier, floor) + handling
 *
 * The floor is what stops a cheap ending being sold for pocket change: a $3
 * ending at 2× is $6, which does not pay for the minutes spent registering it.
 * The handling fee is charged per year and is the part that reads as labour
 * rather than resale — which matters, because billing for the work is what keeps
 * this an agency arrangement rather than reselling Spaceship's service.
 */
export function createPricingRule({ multiplier, floorMinor, handlingMinor }) {
  invariant(typeof multiplier === "number" && multiplier >= 1,
    "pricing_rule_invalid", "multiplier must be at least 1", { status: 500 });
  invariant(Number.isSafeInteger(floorMinor) && floorMinor >= 0,
    "pricing_rule_invalid", "floor must be exact minor units", { status: 500 });
  invariant(Number.isSafeInteger(handlingMinor) && handlingMinor >= 0,
    "pricing_rule_invalid", "handling fee must be exact minor units", { status: 500 });

  return Object.freeze({
    multiplier,
    floorMinor,
    handlingMinor,
    describe() {
      return `cost x${multiplier}, floor $${(floorMinor / 100).toFixed(2)}, `
        + `handling $${(handlingMinor / 100).toFixed(2)}/yr`;
    },
    /** Exact integer minor units. Rounding happens once, here, never downstream. */
    retailMinor(costMinor) {
      invariant(Number.isSafeInteger(costMinor) && costMinor >= 0,
        "pricing_rule_invalid_cost", "cost must be exact minor units", { status: 500 });
      return Math.max(Math.round(costMinor * multiplier), floorMinor) + handlingMinor;
    }
  });
}

/**
 * @param costs         { [tld]: { registerCostMinor, renewCostMinor, observedAt } }
 * @param rule          from createPricingRule()
 * @param clock         injectable now()
 * @param bookVersion   opaque label recorded on every quote for traceability
 * @param maxCostAgeMs  how stale a synced cost may be before quoting is refused
 */
export function createPriceBook({ costs, rule, clock, bookVersion, maxCostAgeMs }) {
  invariant(costs && typeof costs === "object", "price_book_invalid",
    "a price book requires a cost table", { status: 500 });
  invariant(typeof rule?.retailMinor === "function", "price_book_invalid",
    "a price book requires a pricing rule", { status: 500 });
  invariant(typeof clock?.now === "function", "price_book_invalid",
    "a price book requires an injectable clock", { status: 500 });
  invariant(typeof bookVersion === "string" && bookVersion.length > 0,
    "price_book_invalid", "a price book requires a version label", { status: 500 });
  invariant(Number.isSafeInteger(maxCostAgeMs) && maxCostAgeMs > 0,
    "price_book_invalid", "a maximum cost age is required", { status: 500 });

  const table = new Map();
  for (const [rawTld, entry] of Object.entries(costs)) {
    const tld = rawTld.toLowerCase().replace(/^\./u, "");
    invariant(
      Number.isSafeInteger(entry?.registerCostMinor) && entry.registerCostMinor >= 0
      && Number.isSafeInteger(entry?.renewCostMinor) && entry.renewCostMinor >= 0,
      "price_book_invalid",
      `cost entry for .${tld} must carry exact minor-unit amounts`,
      { status: 500 }
    );
    const observedMs = Date.parse(entry?.observedAt ?? "");
    invariant(Number.isFinite(observedMs), "price_book_invalid",
      `cost entry for .${tld} must record when it was observed`, { status: 500 });
    table.set(tld, Object.freeze({ ...entry, observedMs }));
  }

  function tldOf(domain) {
    const parts = domain.split(".");
    invariant(parts.length >= 2, "price_book_invalid_domain",
      `${domain} has no ending to price`, { status: 400 });
    return parts.slice(1).join(".").toLowerCase();
  }

  return Object.freeze({
    source: PRICE_BOOK_SOURCE,
    bookVersion,
    rule,

    covered() {
      return [...table.keys()].sort();
    },

    /** What a customer would pay today, per ending. For the public page. */
    quoteSheet() {
      return [...table.entries()].map(([tld, e]) => Object.freeze({
        tld,
        firstYearMinor: rule.retailMinor(e.registerCostMinor),
        renewalMinor: rule.retailMinor(e.renewCostMinor),
        costObservedAt: e.observedAt
      })).sort((a, b) => a.tld.localeCompare(b.tld));
    },

    async previewRegistration({ domain, years = 1, premium = false } = {}) {
      const name = normalizeDomain(domain);
      invariant(Number.isSafeInteger(years) && years >= 1 && years <= 10,
        "price_book_invalid_years", "registration years must be 1 to 10", { status: 400 });

      if (premium) {
        refuse("price_book_premium_refused",
          `${name} is a premium name; registries price these individually and the `
          + "book must not guess. Quote it by hand from the registrar's own figure.");
      }

      const tld = tldOf(name);
      const entry = table.get(tld);
      if (!entry) {
        refuse("price_book_no_entry",
          `no synced Spaceship cost for .${tld}; sync it or quote by hand`);
      }

      const ageMs = clock.now() - entry.observedMs;
      if (ageMs > maxCostAgeMs) {
        refuse("price_book_cost_stale",
          `the .${tld} cost was last observed ${Math.round(ageMs / 3600000)}h ago, `
          + `beyond the ${Math.round(maxCostAgeMs / 3600000)}h limit. Resync before quoting.`);
      }

      // First year and renewals are priced separately because registries charge
      // differently for them; using the first-year rate for every year is how a
      // multi-year sale quietly loses money.
      const amountMinor =
        rule.retailMinor(entry.registerCostMinor)
        + rule.retailMinor(entry.renewCostMinor) * (years - 1);
      const expectedCostMinor =
        entry.registerCostMinor + entry.renewCostMinor * (years - 1);

      invariant(amountMinor > expectedCostMinor, "price_book_below_cost",
        `computed retail for ${name} does not exceed expected cost`, { status: 500 });

      return Object.freeze({
        source: PRICE_BOOK_SOURCE,
        bookVersion,
        status: "confirmation_required",
        noCharge: true,
        domain: name,
        years,
        price: Object.freeze({ amountMinor, currency: "USD" }),
        // Carried so reconciliation can prove the sale was profitable. This is
        // Site Sourcery's own expectation, not anything the registrar promised.
        expectedCost: Object.freeze({ amountMinor: expectedCostMinor, currency: "USD" }),
        priceIsSelfPublished: true,
        pricingRule: rule.describe(),
        costObservedAt: entry.observedAt,
        observedAt: new Date(clock.now()).toISOString(),
        evidenceId: `price-book:${bookVersion}:${tld}:${years}y`
      });
    }
  });
}
