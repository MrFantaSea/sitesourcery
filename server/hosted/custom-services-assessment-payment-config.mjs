import {
  isExactProfessionalLifecycleReadiness
} from "./professional-lifecycle-production-composition.mjs";

const MODES = new Set(["held", "approved"]);

function configurationError(code, message) {
  const error = new Error(message);
  error.name = "CustomServicesAssessmentPaymentConfigurationError";
  error.code = code;
  return error;
}

export function validateCustomServicesAssessmentPaymentRelease(value) {
  const keys =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
      ? Object.keys(value).sort()
      : [];
  if (
    JSON.stringify(keys) !==
      JSON.stringify([
        "amountMinor",
        "approved",
        "currency",
        "taxMode"
      ]) ||
    typeof value.approved !== "boolean" ||
    value.amountMinor !== 20000 ||
    value.currency !== "USD" ||
    value.taxMode !== "disabled_by_owner"
  ) {
    throw configurationError(
      "CUSTOM_SERVICES_ASSESSMENT_PAYMENT_RELEASE_INVALID",
      "Assessment payment release must preserve the exact $200 pre-effective disabled-tax contract."
    );
  }
  return Object.freeze({ ...value });
}

export function createConfiguredCustomServicesAssessmentPaymentRelease({
  environment = process.env
} = {}) {
  const mode =
    environment?.SITESOURCERY_CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE ??
    "held";
  if (!MODES.has(mode)) {
    throw configurationError(
      "CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE_INVALID",
      "SITESOURCERY_CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE must be exactly held or approved."
    );
  }
  return Object.freeze({
    mode,
    release: validateCustomServicesAssessmentPaymentRelease({
      approved: mode === "approved",
      amountMinor: 20000,
      currency: "USD",
      taxMode: "disabled_by_owner"
    })
  });
}

export function assertApprovedCustomServicesAssessmentPaymentReady(
  composition,
  readiness,
  settlementReadiness = null,
  professionalLifecycleReadiness = null
) {
  if (
    composition?.mode === "approved" &&
    !(
      readiness?.ready === true &&
      readiness?.taxModes?.serviceAssessment ===
        composition.release.taxMode &&
      settlementReadiness?.schema ===
        "sitesourcery.custom-services-assessment-settlement-readiness/v1" &&
      settlementReadiness?.ready === true &&
      settlementReadiness?.webhookWakeup === true &&
      settlementReadiness?.stripeReadback === true &&
      settlementReadiness?.atomicSettlement === true &&
      isExactProfessionalLifecycleReadiness(
        professionalLifecycleReadiness
      )
    )
  ) {
    throw configurationError(
      "CUSTOM_SERVICES_ASSESSMENT_PAYMENT_NOT_READY",
      "Approved assessment payment requires the exact purpose-bound Stripe tax decision, assessment settlement, and held professional lifecycle contracts."
    );
  }
  return readiness;
}
