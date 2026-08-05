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
    value.taxMode !== "automatic"
  ) {
    throw configurationError(
      "CUSTOM_SERVICES_ASSESSMENT_PAYMENT_RELEASE_INVALID",
      "Assessment payment release must preserve the exact $200 automatic-tax contract."
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
      taxMode: "automatic"
    })
  });
}

export function assertApprovedCustomServicesAssessmentPaymentReady(
  composition,
  readiness,
  settlementReadiness = null
) {
  if (
    composition?.mode === "approved" &&
    !(
      readiness?.ready === true &&
      readiness?.taxMode === "automatic" &&
      settlementReadiness?.schema ===
        "sitesourcery.custom-services-assessment-settlement-readiness/v1" &&
      settlementReadiness?.ready === true &&
      settlementReadiness?.webhookWakeup === true &&
      settlementReadiness?.stripeReadback === true &&
      settlementReadiness?.atomicSettlement === true
    )
  ) {
    throw configurationError(
      "CUSTOM_SERVICES_ASSESSMENT_PAYMENT_NOT_READY",
      "Approved assessment payment requires ready Stripe automatic tax and exact assessment settlement."
    );
  }
  return readiness;
}
