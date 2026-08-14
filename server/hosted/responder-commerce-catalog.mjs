import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { digest } from "./security.mjs";

export const RESPONDER_COMMERCE_CATALOG_SCHEMA =
  "sitesourcery.responder-commerce-catalog/v1";
export const RESPONDER_COMMERCE_CATALOG_VERSION =
  "SS-RESPONDER-COMMERCE-2026.1";
export const RESPONDER_COMMERCE_SOURCE_AUTHORITY_DIGEST =
  "b62255bdcea5f04882ac1b6bbb415069410c915858bb6a4b26fb3598fa28613c";
export const RESPONDER_COMMERCE_CATALOG_ID =
  "00000000-0000-4000-8000-000000001351";

const HELD = deepFreeze({
  sellable: false,
  customerAcceptanceAuthorized: false,
  invoiceDispatchAuthorized: false,
  mailDeliveryAuthorized: false,
  paymentEffectsAuthorized: false,
  providerEffectsAuthorized: false
});

const CATALOG = deepFreeze({
  schema: RESPONDER_COMMERCE_CATALOG_SCHEMA,
  catalogId: RESPONDER_COMMERCE_CATALOG_ID,
  catalogVersion: RESPONDER_COMMERCE_CATALOG_VERSION,
  sourceAuthorityDigest: RESPONDER_COMMERCE_SOURCE_AUTHORITY_DIGEST,
  productKey: "responder",
  displayName: "The Responder",
  currency: "USD",
  state: "held",
  taxState: "disabled_by_owner",
  quotePreparationAllowed: true,
  prices: {
    setup: {
      purpose: "responder_setup",
      amountMinor: 30_000,
      cadence: "one_time"
    },
    recurring: {
      purpose: "responder_monthly",
      amountMinor: 25_000,
      cadence: "month",
      intervalCount: 1
    },
    initialSubtotalMinor: 55_000
  },
  disclosure: {
    authority:
      "This private held preparation uses the owner-approved build-plan price. It is not a public offer or provider release.",
    activation:
      "Customer acceptance, legal publication, tax review, Stripe configuration, telephony purpose release, and owner activation remain separate gates.",
    recurrence:
      "The recurring monthly charge is represented independently from the one-time setup charge and is not submitted while held."
  },
  effects: HELD
});

export const RESPONDER_COMMERCE_CATALOG_DIGEST = digest(CATALOG);

export function getHeldResponderCommerceCatalog() {
  return deepFreeze({
    ...structuredClone(CATALOG),
    catalogDigest: RESPONDER_COMMERCE_CATALOG_DIGEST
  });
}
