const MODES = new Set(["held", "approved"]);

function configurationError(code, message) {
  const error = new Error(message);
  error.name = "CustomBuildPaymentConfigurationError";
  error.code = code;
  return error;
}

export function createConfiguredCustomBuildPaymentRelease({
  environment = process.env
} = {}) {
  const mode =
    environment?.SITESOURCERY_CUSTOM_BUILD_PAYMENT_MODE ??
    "held";
  if (!MODES.has(mode)) {
    throw configurationError(
      "CUSTOM_BUILD_PAYMENT_MODE_INVALID",
      "SITESOURCERY_CUSTOM_BUILD_PAYMENT_MODE must be exactly held or approved."
    );
  }
  return Object.freeze({
    mode,
    release: Object.freeze({
      approved: mode === "approved",
      currency: "USD",
      paymentWindowDays: 7,
      taxMode: "disabled_by_owner"
    })
  });
}

export function assertApprovedCustomBuildPaymentReady(
  composition,
  stripeReadiness,
  customBuildReadiness,
  paymentReadiness
) {
  if (
    composition?.mode === "approved" &&
    !(
      stripeReadiness?.ready === true &&
      stripeReadiness?.taxModes?.customBuildStart ===
        composition.release.taxMode &&
      customBuildReadiness?.schema ===
        "sitesourcery.custom-services-custom-build-readiness/v1" &&
      customBuildReadiness?.ready === true &&
      paymentReadiness?.schema ===
        "sitesourcery.custom-build-payment-readiness/v1" &&
      paymentReadiness?.ready === true &&
      paymentReadiness?.taxMode ===
        composition.release.taxMode &&
      paymentReadiness?.exclusiveTaxBehavior === true &&
      paymentReadiness?.stripeReadback === true &&
      paymentReadiness?.atomicCreditSettlement === true &&
      paymentReadiness?.opensBuildJob === true
    )
  ) {
    throw configurationError(
      "CUSTOM_BUILD_PAYMENT_NOT_READY",
      "Approved Custom-build payment requires the exact purpose-bound Stripe tax decision, quote storage, and payment settlement."
    );
  }
  return stripeReadiness;
}
