import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

export const CARE_COMMERCE_CATALOG_SCHEMA =
  "sitesourcery.care-commerce-catalog/v1";
export const CARE_COMMERCE_CATALOG_VERSION =
  "SS-CARE-COMMERCE-2026.1";
export const CARE_COMMERCE_PRICE_VERSION =
  "SS-CUSTOM-SERVICES-2026-08-05.1";
export const CARE_CORE_CATALOG_VERSION = "SS-CARE-CORE-2026.1";
export const CARE_COMMERCIAL_CONTRACT_DIGEST =
  "9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8";

const CATALOG_IDENTITIES = Object.freeze({
  website_rescue: "00000000-0000-4000-8000-000000001211",
  outside_management: "00000000-0000-4000-8000-000000001212",
  custom_care: "00000000-0000-4000-8000-000000001213",
  alakazam_care: "00000000-0000-4000-8000-000000001214"
});

const HELD = deepFreeze({
  sellable: false,
  quoteDispatchAuthorized: false,
  paymentEffectsAuthorized: false,
  providerEffectsAuthorized: false
});

const CATALOG = deepFreeze({
  schema: CARE_COMMERCE_CATALOG_SCHEMA,
  catalogVersion: CARE_COMMERCE_CATALOG_VERSION,
  careCoreCatalogVersion: CARE_CORE_CATALOG_VERSION,
  priceVersion: CARE_COMMERCE_PRICE_VERSION,
  commercialContractDigest: CARE_COMMERCIAL_CONTRACT_DIGEST,
  state: "held",
  effects: HELD,
  offers: [
    {
      serviceKey: "website_rescue",
      catalogIdentityId: CATALOG_IDENTITIES.website_rescue,
      contractKind: "rescue",
      commercialAuthorityState: "exact_held",
      billingCadence: "one_time",
      quotePreparationAllowed: true,
      price: {
        mode: "unit",
        currency: "USD",
        unitAmountMinor: 12_500,
        unitLabel: "repair_unit",
        minimumQuantity: 2,
        maximumQuantity: 8,
        minimumAmountMinor: 25_000
      },
      disclosure: {
        assessment:
          "A current adequate assessment is normally required unless the request is already mechanically exact.",
        selection:
          "Only the accepted safe findings and their disclosed dependencies are included.",
        largerScope:
          "Work above eight repair units requires a separately written repair-versus-rebuild comparison."
      },
      effects: HELD
    },
    {
      serviceKey: "outside_management",
      catalogIdentityId: CATALOG_IDENTITIES.outside_management,
      contractKind: "outside_management",
      commercialAuthorityState: "exact_held",
      billingCadence: "month",
      quotePreparationAllowed: true,
      price: {
        mode: "banded",
        currency: "USD",
        supportabilityReviewMinor: 20_000,
        simple: {
          onboardingTotalMinor: 30_000,
          onboardingBalanceMinor: 10_000,
          monthlyBaseMinor: 12_500
        },
        supportedCms: {
          onboardingTotalMinor: 60_000,
          onboardingBalanceMinor: 40_000,
          monthlyBaseMinor: 22_500
        },
        complex: {
          onboardingFromMinor: 90_000,
          monthlyFromMinor: 40_000,
          ownerRedlineRequired: true
        },
        optionalCapacity: [
          { repairUnits: 2, monthlyAmountMinor: 25_000 },
          { repairUnits: 4, monthlyAmountMinor: 50_000 }
        ]
      },
      disclosure: {
        onboarding:
          "The $200 supportability review must finish before any accepted-site onboarding balance or monthly management reservation.",
        responsibility:
          "Monthly management covers only the responsibilities in the accepted plan and does not include ordinary repair labor or provider fees.",
        rollover:
          "Unused included capacity may roll into only the immediately following monthly period."
      },
      effects: HELD
    },
    {
      serviceKey: "custom_care",
      catalogIdentityId: CATALOG_IDENTITIES.custom_care,
      contractKind: "custom_care",
      commercialAuthorityState: "owner_redline_required",
      billingCadence: "month",
      quotePreparationAllowed: false,
      price: null,
      disclosure: null,
      effects: HELD
    },
    {
      serviceKey: "alakazam_care",
      catalogIdentityId: CATALOG_IDENTITIES.alakazam_care,
      contractKind: "alakazam_care",
      commercialAuthorityState: "owner_redline_required",
      billingCadence: "month",
      quotePreparationAllowed: false,
      price: null,
      disclosure: null,
      effects: HELD
    }
  ]
});

const CATALOG_DIGEST = digest(CATALOG);

function clone(value) {
  return structuredClone(value);
}

export function getHeldCareCommerceCatalog() {
  return deepFreeze({ ...clone(CATALOG), catalogDigest: CATALOG_DIGEST });
}

export function resolveHeldCareOffer(serviceKey) {
  invariant(
    typeof serviceKey === "string" &&
      /^[a-z][a-z0-9_]{2,79}$/u.test(serviceKey),
    "CARE_COMMERCE_INVALID",
    "Care service key is invalid.",
    { status: 400 }
  );
  const selected = CATALOG.offers.find(
    (offer) => offer.serviceKey === serviceKey
  );
  invariant(
    selected,
    "CARE_COMMERCE_UNAVAILABLE",
    "The Care offer is unavailable.",
    { status: 404 }
  );
  return deepFreeze(clone(selected));
}

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...keys].sort()),
    "CARE_COMMERCE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function selectionLine(input, componentKey, description, amountMinor, cadence) {
  return deepFreeze({
    componentKey,
    description,
    quantity: 1,
    unitAmountMinor: amountMinor,
    subtotalMinor: amountMinor,
    currency: "USD",
    billingCadence: cadence,
    selection: clone(input)
  });
}

export function priceHeldCareSelection(serviceKey, input) {
  const offer = resolveHeldCareOffer(serviceKey);
  invariant(
    offer.quotePreparationAllowed === true &&
      offer.commercialAuthorityState === "exact_held",
    "CARE_COMMERCE_OWNER_REDLINE_REQUIRED",
    "This Care offer has no owner-approved price and cannot be quoted.",
    { status: 409 }
  );
  if (serviceKey === "website_rescue") {
    exactObject(input, ["kind", "repairUnits"], "Care price selection");
    invariant(
      input.kind === "repair_units" &&
        Number.isSafeInteger(input.repairUnits) &&
        input.repairUnits >= offer.price.minimumQuantity &&
        input.repairUnits <= offer.price.maximumQuantity,
      "CARE_COMMERCE_PRICE_SELECTION_INVALID",
      "Website Rescue requires between two and eight repair units.",
      { status: 400 }
    );
    const amount = input.repairUnits * offer.price.unitAmountMinor;
    return deepFreeze({
      componentKey: "website_rescue_repair_unit",
      description: "Website Rescue and Tune-Up",
      quantity: input.repairUnits,
      unitAmountMinor: offer.price.unitAmountMinor,
      subtotalMinor: amount,
      currency: "USD",
      billingCadence: "one_time",
      selection: clone(input)
    });
  }

  if (input?.kind === "optional_capacity") {
    exactObject(input, ["kind", "repairUnits"], "Care price selection");
    const capacity = offer.price.optionalCapacity.find(
      (candidate) => candidate.repairUnits === input.repairUnits
    );
    invariant(
      capacity,
      "CARE_COMMERCE_PRICE_SELECTION_INVALID",
      "Outside Management optional capacity must be exactly two or four repair units.",
      { status: 400 }
    );
    return selectionLine(
      input,
      `outside_management_capacity_${input.repairUnits}`,
      `Outside Management ${input.repairUnits}-unit monthly capacity`,
      capacity.monthlyAmountMinor,
      "month"
    );
  }
  exactObject(input, ["kind", "siteClass"], "Care price selection");
  invariant(
    ["simple", "supported_cms"].includes(input.siteClass),
    "CARE_COMMERCE_OWNER_REDLINE_REQUIRED",
    "Complex or unknown outside sites require an owner-redlined quote.",
    { status: 409 }
  );
  const band = input.siteClass === "simple"
    ? offer.price.simple
    : offer.price.supportedCms;
  if (input.kind === "supportability_review") {
    return selectionLine(
      input,
      "outside_management_supportability_review",
      "Outside Management supportability review",
      offer.price.supportabilityReviewMinor,
      "one_time"
    );
  }
  if (input.kind === "onboarding_balance") {
    return selectionLine(
      input,
      `outside_management_${input.siteClass}_onboarding_balance`,
      "Outside Management accepted-site onboarding balance",
      band.onboardingBalanceMinor,
      "one_time"
    );
  }
  if (input.kind === "monthly_base") {
    return selectionLine(
      input,
      `outside_management_${input.siteClass}_monthly_base`,
      "Outside Management monthly base",
      band.monthlyBaseMinor,
      "month"
    );
  }
  invariant(
    false,
    "CARE_COMMERCE_PRICE_SELECTION_INVALID",
    "Outside Management price selection is invalid.",
    { status: 400 }
  );
}
