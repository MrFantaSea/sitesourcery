import {
  createAlakazamBillingRelease
} from "../commerce-v2/index.mjs";

const MODES = new Set(["held", "approved"]);
const TAX_MODES = new Set([
  "automatic",
  "disabled_by_owner"
]);

function configurationError(code, message) {
  const error = new Error(message);
  error.name = "AlakazamReleaseConfigurationError";
  error.code = code;
  return error;
}

export function createConfiguredAlakazamRelease({
  environment = process.env
} = {}) {
  const mode =
    environment?.SITESOURCERY_ALAKAZAM_MODE ??
    "held";
  if (!MODES.has(mode)) {
    throw configurationError(
      "ALAKAZAM_MODE_INVALID",
      "SITESOURCERY_ALAKAZAM_MODE must be exactly held or approved."
    );
  }
  const suppliedTaxMode =
    environment?.SITESOURCERY_ALAKAZAM_TAX_MODE;
  if (mode === "held") {
    if (
      suppliedTaxMode !== undefined &&
      suppliedTaxMode !== ""
    ) {
      throw configurationError(
        "ALAKAZAM_TAX_MODE_WITHOUT_APPROVAL",
        "Alakazam tax mode cannot be configured while the release is held."
      );
    }
    return Object.freeze({
      mode,
      release: createAlakazamBillingRelease()
    });
  }
  if (!TAX_MODES.has(suppliedTaxMode)) {
    throw configurationError(
      "ALAKAZAM_TAX_MODE_INVALID",
      "Approved Alakazam requires an exact reviewed tax mode."
    );
  }
  return Object.freeze({
    mode,
    release: createAlakazamBillingRelease({
      approved: true,
      taxMode: suppliedTaxMode
    })
  });
}

export function isReleasedAlakazamPolicyReadiness(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.schema ===
        "sitesourcery.alakazam-policy-readiness/v1" &&
      value.ready === true &&
      value.verified === true &&
      value.state === "released" &&
      value.commercialEffects === true &&
      value.providerEffects === true &&
      value.publicationEffects === true &&
      value.automaticRecoveryFromReversalEvidence === false
  );
}

export function assertApprovedAlakazamReady(
  composition,
  readiness,
  policyReadiness
) {
  if (
    composition?.mode === "approved" &&
    !(
      readiness?.ready === true &&
      readiness.provider === "stripe" &&
      readiness.alakazam === true &&
      readiness.taxModes?.alakazam ===
        composition.release.taxMode &&
      typeof readiness.livemode === "boolean" &&
      isReleasedAlakazamPolicyReadiness(policyReadiness)
    )
  ) {
    throw configurationError(
      "ALAKAZAM_NOT_READY",
      "Approved Alakazam is not ready; inspect the canonical released policy plus the private Stripe Product, Price, Coupon, Portal, tax, and release configuration."
    );
  }
  return readiness;
}
