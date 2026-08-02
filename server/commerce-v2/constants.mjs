import { deepFreeze } from "./canonical.mjs";

export const PRIVATE_CATALOG_SCHEMA =
  "sitesourcery.abracadabra-private-offer-catalog.v2";
export const QUOTE_DISCLOSURE_SCHEMA =
  "sitesourcery.abracadabra-quote-disclosure.v2";
export const QUOTE_SNAPSHOT_SCHEMA =
  "sitesourcery.abracadabra-quote-snapshot.v2";
export const CHECKOUT_PURPOSE_SCHEMA =
  "sitesourcery.abracadabra-checkout-purpose.v2";
export const CHECKOUT_COMMAND_SCHEMA =
  "sitesourcery.abracadabra-checkout-command.v2";
export const DOWNLOAD_PAYMENT_RELEASE_SCHEMA =
  "sitesourcery.abracadabra-download-payment-release.v2";
export const CHECKOUT_DISPATCH_SCHEMA =
  "sitesourcery.abracadabra-checkout-dispatch.v2";
export const PAYMENT_RECEIPT_SCHEMA =
  "sitesourcery.abracadabra-payment-receipt.v2";
export const ENTITLEMENT_SCHEMA =
  "sitesourcery.abracadabra-project-entitlement.v2";

export const CATALOG_VERSION = "spark-actions.2026-07-30.v1";
export const TERMS_VERSION = "spark-actions-held.2026-07-30.v1";
export const QUOTE_TTL_MS = 30 * 60 * 1000;

export const OFFER_IDS = Object.freeze([
  "spark_download"
]);

export const LEGACY_TENURE_IDS = Object.freeze([
  "rent",
  "own",
  "owned_managed"
]);

const HELD_EFFECTS = deepFreeze({
  state: "held",
  dispatchAuthorized: false,
  provider: null,
  providerEffectsAuthorized: false
});

export const OFFER_DEFINITIONS = deepFreeze({
  spark_download: {
    offerId: "spark_download",
    name: "Download",
    summary:
      "Download the accepted Spark website for this editor project.",
    commercialStatus: "owner_accepted",
    price: {
      amountMinor: 500,
      currency: "USD",
      billing: "one_time",
      interval: null
    },
    entitlement: {
      kind: "spark_download",
      scope: "editor_project",
      acceptanceCadence: "once_per_editor_project",
      consumable: false,
      expires: false,
      grants: [
        "download_accepted_project_version",
        "self_host_accepted_project_version"
      ]
    },
    disclosure: {
      renewal:
        "The Download purchase is charged once and does not renew.",
      projectScope:
        "One Download entitlement applies to this editor project and is not consumed by another click.",
      versionScope:
        "Each download or self-host action must use an accepted version that still belongs to this editor project.",
      hosting:
        "Site Sourcery hosting is not included. The customer may self-host the downloaded website.",
      release:
        "This offer remains private and held until a separately reviewed release opens it."
    },
    effects: HELD_EFFECTS
  }
});
