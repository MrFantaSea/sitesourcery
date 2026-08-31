/**
 * Payment rails — every commercial offer recorded by the public-site project,
 * its customer-entry state, and how money could reach Desiderata Labs LLC.
 *
 * WHY THIS FILE EXISTS
 *
 * Site Sourcery's Stripe account (`acct_1Tx2eoPi1bfFonRc`, configured
 * 2026-07-28) was set up for **Invoicing + ACH**. That is the correct rail for a
 * quoted build or an assessment: a real invoice, net terms, low fee on a large
 * amount. It is the wrong rail for the two self-serve products — ACH on a $20
 * charge costs more than it collects, and Invoicing alone cannot bill $25 every
 * month. Those need Checkout and Billing on the SAME account.
 *
 * STATE, 2026-07-30
 *
 * Provider objects exist for some offers, but provider configuration is not
 * release authority. `availability` is the explicit customer-entry gate:
 * account-only offers require the authenticated server flow, contact-to-start
 * offers may be advertised and discussed but have no direct checkout,
 * inquiry-only offers require a written quote, held offers cannot be sold, and
 * only a public-checkout offer may place a Checkout link on the public artifact.
 *
 * THE STATIC-HOSTING CONSTRAINT
 *
 * sitesourcery.com is served from GitHub Pages. There is no server, no secret
 * can live in the page, and no endpoint can sign anything. A stored provider
 * reference therefore cannot silently turn an offer on. The public
 * catalog is inquiry-only, so this ledger currently releases zero direct public
 * Checkout rails.
 */

import { invariant } from "../domain/errors.mjs";
import {
  DOWNLOAD_PRICE_MINOR
} from "../commerce-v2/constants.mjs";

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

export const OFFER_AVAILABILITY = Object.freeze({
  PUBLIC_CHECKOUT: "public-checkout",
  ACCOUNT_ONLY: "account-only",
  CONTACT_TO_START: "contact-to-start",
  INQUIRY_ONLY: "inquiry-only",
  HELD: "held"
});

const OFFER_AVAILABILITY_VALUES = new Set(Object.values(OFFER_AVAILABILITY));

function rail({
  id,
  label,
  rail: railId,
  amountCents,
  displayAmountsCents = [],
  interval = null,
  creditsForward = null,
  productRef = null,
  priceRef = null,
  checkoutUrl = null,
  availability,
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
  invariant(
    Array.isArray(displayAmountsCents)
      && displayAmountsCents.every((amount) => Number.isSafeInteger(amount) && amount >= 0),
    "invalid_rail",
    `${id} display amounts must be exact non-negative minor units`,
    { status: 500 }
  );
  invariant(
    OFFER_AVAILABILITY_VALUES.has(availability),
    "invalid_rail",
    `${id} must declare an explicit availability`,
    { status: 500 }
  );
  return Object.freeze({
    id, label, rail: railId, amountCents, displayAmountsCents, interval, creditsForward, productRef, priceRef, checkoutUrl,
    availability, taxTreatment, note
  });
}

export const SELLABLE = Object.freeze([
  rail({
    id: "abracadabra.preview",
    label: "Abracadabra Download",
    rail: "checkout_session",
    amountCents: DOWNLOAD_PRICE_MINOR,
    availability: OFFER_AVAILABILITY.ACCOUNT_ONLY,
    creditsForward: "alacazam.hosting",
    taxTreatment: "review_required",
    note:
      "ACCOUNT ONLY. Seeing the preview is free; $20 buys Download once for "
      + "one retained editor project. The authenticated server creates and "
      + "settles the exact Checkout. No public Payment Link is authorized. "
      + "The approved full $20 one-use credit toward the first eligible Alakazam invoice "
      + "remains dormant while Alakazam is held."
  }),
  rail({
    id: "alacazam.hosting",
    label: "Alakazam hosting",
    rail: "billing",
    amountCents: null,
    availability: OFFER_AVAILABILITY.HELD,
    taxTreatment: "review_required",
    note:
      "HELD. The complete tier, feature, support, billing, publication, "
      + "lifecycle, and customer journey must be released and proven before "
      + "any subscription can be quoted, purchased, activated, or renewed. "
      + "No public Checkout or cancellation policy is authorized."
  }),
  rail({
    id: "domain.purchase",
    label: "Domain bought on the customer's behalf",
    rail: "billing",
    amountCents: null,
    availability: OFFER_AVAILABILITY.INQUIRY_ONLY,
    taxTreatment: "review_required",
    note:
      "INQUIRY ONLY. Public DNS is a preflight signal, not registrar "
      + "availability or a quote. No public Checkout, charge, or refund promise "
      + "is authorized. Release requires an account-bound fresh registrar "
      + "availability and price readback, written terms, recorded customer "
      + "authorization, registration evidence, and capture only afterward."
  }),
  rail({
    id: "domain.purchase.plus",
    label: "Domain bought on the customer's behalf - .net/.org band",
    rail: "billing",
    amountCents: null,
    availability: OFFER_AVAILABILITY.INQUIRY_ONLY,
    taxTreatment: "review_required",
    note:
      "INQUIRY ONLY. The ending does not change the release boundary: no "
      + "public price or Checkout authority exists while registrar cost proof "
      + "is held. The same account-bound fresh readback, written acceptance, "
      + "registration evidence, and post-registration capture gate applies."
  }),
  rail({
    id: "assessment",
    label: "Website assessment",
    rail: "checkout_session",
    amountCents: 35000,
    availability: OFFER_AVAILABILITY.ACCOUNT_ONLY,
    creditsForward: "custom.build",
    taxTreatment: "review_required",
    note:
      "ACCOUNT ONLY. The customer first receives and accepts the exact written "
      + "assessment scope through the authenticated account. The server then "
      + "creates one exact automatic-tax Checkout and retains provider-confirmed "
      + "settlement evidence. No public Payment Link is authorized."
  }),
  rail({
    id: "responder",
    label: "The Responder",
    rail: "billing",
    amountCents: null,
    displayAmountsCents: [30_000, 25_000],
    availability: OFFER_AVAILABILITY.CONTACT_TO_START,
    taxTreatment: "review_required",
    note:
      "CONTACT TO START. The owner-approved public price is $300 setup plus "
      + "$250 monthly. A customer may ask to begin a hands-on setup, but this "
      + "record grants no direct Checkout, payment, phone-number, messaging, "
      + "A2P, or other provider effect. Customer-specific terms, provisioning, "
      + "testing, and approval are required before activation."
  }),
  rail({
    id: "custom.build",
    label: "Custom build",
    rail: "invoice",
    amountCents: null,
    availability: OFFER_AVAILABILITY.INQUIRY_ONLY,
    taxTreatment: "review_required",
    note:
      "Quoted per job, $350 to $3,600 before art direction and migration. Card "
      + "and Card Plus invoice in full up front; Site and above split half "
      + "before work and half only after completion and before final handoff. "
      + "Recording completion does not automatically charge the final half."
  })
]);

/**
 * Direct public sale requires both explicit release authority and a complete
 * fixed-price Checkout configuration. Provider references alone never satisfy
 * the release gate.
 */
export function sellableNow() {
  return SELLABLE.filter((item) =>
    item.availability === OFFER_AVAILABILITY.PUBLIC_CHECKOUT
    && item.checkoutUrl !== null
    && item.productRef !== null
    && item.priceRef !== null
    && item.amountCents !== null
  );
}

export function readiness() {
  return Object.freeze({
    merchant: MERCHANT.stripeAccountId,
    total: SELLABLE.length,
    sellableNow: sellableNow().length,
    availability: Object.freeze(Object.fromEntries(
      Object.values(OFFER_AVAILABILITY).map((state) => [
        state,
        SELLABLE.filter((item) => item.availability === state).map((item) => item.id)
      ])
    )),
    awaitingPriceRef: SELLABLE.filter((i) =>
      i.availability === OFFER_AVAILABILITY.PUBLIC_CHECKOUT
      && i.priceRef === null
      && i.amountCents !== null
    )
      .map((i) => i.id),
    quotedPerOrder: SELLABLE.filter((i) => i.amountCents === null).map((i) => i.id),
    needsServer: SELLABLE.filter((i) => RAIL_NEEDS_SERVER[i.rail]).map((i) => i.id),
    creditsToHonour: SELLABLE.filter((i) => i.creditsForward)
      .map((i) => `${i.id} -> ${i.creditsForward}`),
    taxUnreviewed: SELLABLE.filter((i) => i.taxTreatment === "review_required").map((i) => i.id)
  });
}
