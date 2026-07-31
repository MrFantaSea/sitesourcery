/**
 * Payment rails — every sellable thing on the public site, and how money for it
 * actually reaches Desiderata Labs LLC.
 *
 * WHY THIS FILE EXISTS
 *
 * Site Sourcery's Stripe account (`acct_1Tx2eoPi1bfFonRc`, configured
 * 2026-07-28) was set up for **Invoicing + ACH**. That is the correct rail for a
 * quoted build or an assessment: a real invoice, net terms, low fee on a large
 * amount. It is the wrong rail for the two self-serve products — ACH on a $5
 * charge costs more than it collects, and Invoicing alone cannot bill $25 every
 * month. Those need Checkout and Billing on the SAME account.
 *
 * STATE, 2026-07-30
 *
 * Three live Stripe Products and Prices now exist in that account: the $5
 * preview, $25/month Alacazam hosting, and the $200 assessment. Their Price IDs
 * are recorded below. Price IDs are NOT secrets — Stripe designs them to appear
 * in client-side integrations — so they belong in the repository. Secret keys
 * never do, and none appear here.
 *
 * The two remaining entries carry `amountCents: null` on purpose. A domain and a
 * custom build are quoted per order, so there is no fixed price to sell them
 * from, and `sellableNow()` refuses both by construction rather than by
 * convention.
 *
 * THE STATIC-HOSTING CONSTRAINT
 *
 * sitesourcery.com is served from GitHub Pages. There is no server, no secret
 * can live in the page, and no endpoint can sign anything. Two consequences:
 *
 *   - Rails marked `payment_link` work today. Stripe hosts the page; the site
 *     only ever contains a plain https link. No backend, no key in the browser.
 *   - Rails marked `invoice` are sent by a person from the Stripe dashboard
 *     after a written quote, which is how quoted work should be billed anyway.
 *   - `checkout_session` would need a server. Nothing uses it yet. It is listed
 *     so that choosing it later is a deliberate decision rather than a drift.
 */

import { invariant } from "../domain/errors.mjs";

/** The Site Sourcery merchant of record. The legal seller is never the DBA. */
export const MERCHANT = Object.freeze({
  stripeAccountId: "acct_1Tx2eoPi1bfFonRc",
  legalName: "Desiderata Labs LLC",
  publicName: "Site Sourcery",
  statementDescriptor: "SITE SOURCERY",
  filedAlternateName: "SITESOURCERY"
});

export const RAILS = Object.freeze([
  "payment_link",     // Stripe-hosted page. Safe from a static site.
  "billing",          // Stripe Billing subscription, started by a payment link.
  "invoice",          // Emailed invoice, ACH or card. Person-initiated.
  "checkout_session"  // Requires a server. Unused; listed to keep it a choice.
]);

/**
 * Whether a rail can be driven from a page with no backend behind it.
 * Anything false here cannot ship while the site is on GitHub Pages.
 */
export const RAIL_NEEDS_SERVER = Object.freeze({
  payment_link: false,
  billing: false,
  invoice: false,
  checkout_session: true
});

function rail({
  id,
  label,
  rail: railId,
  amountCents,
  interval = null,
  creditsForward = null,
  productRef = null,
  priceRef = null,
  checkoutUrl = null,
  taxTreatment,
  note
}) {
  invariant(RAILS.includes(railId), "invalid_rail", `unknown rail ${railId}`, { status: 500 });
  invariant(
    Number.isSafeInteger(amountCents) || amountCents === null,
    "invalid_rail",
    `${id} amount must be exact minor units or null`,
    { status: 500 }
  );
  return Object.freeze({
    id, label, rail: railId, amountCents, interval, creditsForward, productRef, priceRef, checkoutUrl,
    taxTreatment, note
  });
}

export const SELLABLE = Object.freeze([
  rail({
    id: "abracadabra.preview",
    checkoutUrl: "https://buy.stripe.com/8x2cN7e9y0wu6OW4fO7kc00",
    productRef: "prod_Uz2vB8RYudkT7M",
    priceRef: "price_1Tz4piPi1bfFonRcwfrimoka",
    label: "Abracadabra preview",
    rail: "payment_link",
    amountCents: 500,
    creditsForward: "alacazam.hosting",
    taxTreatment: "review_required",
    note:
      "OWNER PIVOT 2026-07-31: seeing the preview is FREE; the $5 buys the "
      + "DOWNLOAD. Still one-time, still credited against the first Alacazam "
      + "payment — a credit applied by hand until it exists as a Stripe "
      + "object. Product renamed to 'Abracadabra download' in the dashboard "
      + "on 2026-07-31; name, description, and site copy now agree."
  }),
  rail({
    id: "alacazam.hosting",
    checkoutUrl: "https://buy.stripe.com/9B65kF0iIgvseho9A87kc01",
    productRef: "prod_Uz2wjAIXX2ILS1",
    priceRef: "price_1Tz4qiPi1bfFonRczx5OBDxo",
    label: "Alacazam hosting",
    rail: "billing",
    amountCents: 2500,
    interval: "month",
    taxTreatment: "review_required",
    note:
      "Recurring. Maps to the catalog's `host` care plan. Cancellation must "
      + "leave the customer's files downloadable, because the site promises "
      + "that leaving costs nothing."
  }),
  rail({
    id: "domain.purchase",
    checkoutUrl: "https://buy.stripe.com/dRm9AV0iIfroddk5jS7kc03",
    productRef: "prod_UzBKS5kuTkx7WL",
    priceRef: "price_1TzCxkPi1bfFonRcJ7oVDMS6",
    label: "Domain bought on the customer's behalf",
    rail: "billing",
    amountCents: 4000,
    interval: "year",
    taxTreatment: "review_required",
    note:
      "Flat $40/year for common endings, from the price-book rule (cost x2, "
      + "floor $25, +$15 handling). The checkout collects registrant name, "
      + "business, address and phone because a registrar requires all four, "
      + "plus the domain itself as a custom field. Availability is confirmed "
      + "with the registrar BEFORE the card is charged; if the name has gone, "
      + "the customer is refunded in full. Unusual endings and premium names "
      + "are refused by the price book and quoted by hand."
  }),
  rail({
    id: "domain.purchase.plus",
    checkoutUrl: "https://buy.stripe.com/cNi7sN8Pegvs7T07s07kc04",
    productRef: "prod_UzBKS5kuTkx7WL",
    priceRef: "price_1TzP2pPi1bfFonRcLOug1Xnb",
    label: "Domain bought on the customer's behalf - .net/.org band",
    rail: "billing",
    amountCents: 4500,
    interval: "year",
    taxTreatment: "review_required",
    note:
      "The plus band (.net/.org retail $45/yr). Same manual middleman "
      + "fulfilment as domain.purchase: charged today, confirmed with the "
      + "registrar same day, refunded in full if the name is gone. Wholesale "
      + "cost still unverified against Spaceship - price book keeps "
      + "costsConfirmed false until the owner checks."
  }),
  rail({
    id: "assessment",
    checkoutUrl: "https://buy.stripe.com/bJe4gB8Pe5QOb5cdQo7kc02",
    productRef: "prod_Uz2x2mb55EFk37",
    priceRef: "price_1Tz4rcPi1bfFonRczydNAVKX",
    label: "Website assessment",
    rail: "payment_link",
    amountCents: 20000,
    creditsForward: "custom.build",
    taxTreatment: "review_required",
    note:
      "Small enough to buy without a conversation, and the best route from "
      + "stranger to customer. The full amount is credited to a later accepted "
      + "build, which is a refund-or-coupon decision, not a copy decision."
  }),
  rail({
    id: "responder",
    productRef: "prod_UzBnwZbrqPQqjR",
    label: "The Responder",
    rail: "billing",
    amountCents: 25000,
    interval: "month",
    taxTreatment: "review_required",
    note:
      "NOT SELLABLE YET, ON PURPOSE. A Stripe product exists but has no price "
      + "reference and no payment link, so sellableNow() refuses it. There is no "
      + "working responder behind it: missed-call-to-text needs a telephony "
      + "number, call forwarding, and a no-answer trigger. Twilio Studio can do "
      + "all three with no server, but the account is the owner's to open. "
      + "Selling this before it exists is the same failure as charging for a "
      + "preview the maker cannot make. Setup is a further $300 one-time."
  }),
  rail({
    id: "custom.build",
    label: "Custom build",
    rail: "invoice",
    amountCents: null,
    taxTreatment: "review_required",
    note:
      "Quoted per job, $400 to $4,000 before art direction and migration. Card "
      + "and Card Plus invoice in full up front; Site and above split half "
      + "before and half on completion — two invoices, not one."
  })
]);

/**
 * Nothing may be sold until an owner supplies a real Stripe Price for it, and
 * amounts that depend on a per-order quote are never sellable from a fixed
 * price at all. This is the gate, not the copy on the page.
 */
export function sellableNow() {
  return SELLABLE.filter((item) => item.priceRef !== null && item.amountCents !== null);
}

export function readiness() {
  return Object.freeze({
    merchant: MERCHANT.stripeAccountId,
    total: SELLABLE.length,
    sellableNow: sellableNow().length,
    awaitingPriceRef: SELLABLE.filter((i) => i.priceRef === null && i.amountCents !== null)
      .map((i) => i.id),
    quotedPerOrder: SELLABLE.filter((i) => i.amountCents === null).map((i) => i.id),
    needsServer: SELLABLE.filter((i) => RAIL_NEEDS_SERVER[i.rail]).map((i) => i.id),
    creditsToHonour: SELLABLE.filter((i) => i.creditsForward)
      .map((i) => `${i.id} -> ${i.creditsForward}`),
    taxUnreviewed: SELLABLE.filter((i) => i.taxTreatment === "review_required").map((i) => i.id)
  });
}
