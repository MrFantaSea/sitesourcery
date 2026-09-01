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
 * inquiry-only offers are retained only for unreleased work, held offers cannot be sold, and
 * only a public-checkout offer may place a Checkout link on the public artifact.
 *
 * THE PUBLIC-PAGE CONSTRAINT
 *
 * Public marketing HTML contains no provider secret or price authority. A
 * stored provider reference therefore cannot silently turn an offer on. The
 * public catalog has no payment links, so this ledger releases zero direct
 * public Checkout rails. Exact self-serve quotes use the authenticated server;
 * assisted services use a contact-to-start path.
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
      + "The full $20 becomes a one-use credit toward the same project's first "
      + "eligible Alakazam invoice."
  }),
  rail({
    id: "alacazam.hosting",
    label: "Alakazam hosting",
    rail: "checkout_session",
    amountCents: null,
    displayAmountsCents: [2_500, 3_500, 5_000],
    availability: OFFER_AVAILABILITY.ACCOUNT_ONLY,
    taxTreatment: "review_required",
    note:
      "ACCOUNT ONLY. The authenticated server quotes and starts the exact "
      + "$25, $35, or $50 monthly plan, applies the same-project Download "
      + "credit once, and retains provider-confirmed settlement. The public "
      + "site has no direct Checkout link."
  }),
  rail({
    id: "domain.purchase",
    label: "Domain bought on the customer's behalf",
    rail: "billing",
    amountCents: null,
    availability: OFFER_AVAILABILITY.CONTACT_TO_START,
    taxTreatment: "review_required",
    note:
      "CONTACT TO START. Site Sourcery can check, register, connect, and help "
      + "manage a customer-owned domain. Public DNS is only a quick preflight; "
      + "the customer approves a fresh registrar result, exact price, terms, "
      + "and registrant details before purchase. No public Checkout exists."
  }),
  rail({
    id: "domain.purchase.plus",
    label: "Domain bought on the customer's behalf - .net/.org band",
    rail: "billing",
    amountCents: null,
    availability: OFFER_AVAILABILITY.CONTACT_TO_START,
    taxTreatment: "review_required",
    note:
      "CONTACT TO START. The ending does not change the customer-owned model. "
      + "A fresh registrar result, exact price, terms, registrant details, and "
      + "written approval are required before purchase. No public Checkout exists."
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
    id: "care",
    label: "Website Care",
    rail: "billing",
    amountCents: null,
    displayAmountsCents: [2_500, 6_900, 11_900, 19_900, 34_900],
    availability: OFFER_AVAILABILITY.CONTACT_TO_START,
    taxTreatment: "review_required",
    note:
      "CONTACT TO START. The public monthly plans are $25, $69, $119, $199, "
      + "and $349. The customer receives the exact plan, included work, start "
      + "date, and billing terms before subscription. No public Checkout exists."
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
    availability: OFFER_AVAILABILITY.CONTACT_TO_START,
    taxTreatment: "review_required",
    note:
      "CONTACT TO START. Quoted per job, $350 to $3,600 before art direction and migration. Card "
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
