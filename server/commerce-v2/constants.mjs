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
export const ENTITLEMENT_SCHEMA =
  "sitesourcery.abracadabra-project-entitlement.v2";

export const CATALOG_VERSION = "spark-actions.2026-07-30.v1";
export const TERMS_VERSION = "spark-actions-held.2026-07-30.v1";
export const QUOTE_TTL_MS = 30 * 60 * 1000;

export const OFFER_IDS = Object.freeze([
  "spark_download",
  "spark_publish",
  "spark_publish_help"
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
  },
  spark_publish: {
    offerId: "spark_publish",
    name: "Publish",
    summary:
      "Publish and host the accepted Spark website for this editor project.",
    commercialStatus: "provisional",
    price: {
      amountMinor: 1500,
      currency: "USD",
      billing: "recurring",
      interval: "month"
    },
    entitlement: {
      kind: "spark_publish",
      scope: "editor_project",
      acceptanceCadence: "per_subscription_start",
      consumable: false,
      expires: true,
      grants: ["publish_accepted_project_version"]
    },
    disclosure: {
      renewal:
        "Publish is provisionally priced at $15 per month and renews monthly until canceled.",
      projectScope:
        "The publishing entitlement applies only to this editor project.",
      versionScope:
        "Publication must use an accepted version that belongs to this editor project.",
      hosting:
        "Eligible hosting is available only while the publishing entitlement is active.",
      release:
        "This provisional offer remains private and held until price, terms, and release authority are separately accepted."
    },
    effects: HELD_EFFECTS
  },
  spark_publish_help: {
    offerId: "spark_publish_help",
    name: "Publish + help",
    summary:
      "Publish the accepted Spark website with the held help entitlement for this editor project.",
    commercialStatus: "provisional",
    price: {
      amountMinor: 3000,
      currency: "USD",
      billing: "recurring",
      interval: "month"
    },
    entitlement: {
      kind: "spark_publish_help",
      scope: "editor_project",
      acceptanceCadence: "per_subscription_start",
      consumable: false,
      expires: true,
      grants: [
        "publish_accepted_project_version",
        "request_publish_help"
      ]
    },
    disclosure: {
      renewal:
        "Publish + help is provisionally priced at $30 per month and renews monthly until canceled.",
      projectScope:
        "The publishing and help entitlement applies only to this editor project.",
      versionScope:
        "Publication must use an accepted version that belongs to this editor project.",
      hosting:
        "Eligible hosting and the defined help boundary are available only while the entitlement is active.",
      release:
        "This provisional offer remains private and held until price, help scope, terms, and release authority are separately accepted."
    },
    effects: HELD_EFFECTS
  }
});
