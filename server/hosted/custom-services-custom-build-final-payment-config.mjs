const MODES = new Set(["held", "approved"]);
const RELEASE_KEYS = Object.freeze([
  "approved",
  "currency",
  "holdScope",
  "providerEffectProcessing",
  "taxMode"
]);

const HOLD_SCOPE = "new_checkout_creation_only";
const PROVIDER_EFFECT_PROCESSING =
  "settlement_and_reconciliation_continue";

function configurationError(code, message) {
  const error = new Error(message);
  error.name = "CustomBuildFinalPaymentConfigurationError";
  error.code = code;
  return error;
}

function isPlainRecord(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
  );
}

export function validateCustomBuildFinalPaymentRelease(value) {
  const keys = isPlainRecord(value)
    ? Object.keys(value).sort()
    : [];
  if (
    JSON.stringify(keys) !==
      JSON.stringify([...RELEASE_KEYS].sort()) ||
    typeof value?.approved !== "boolean" ||
    value.currency !== "USD" ||
    value.holdScope !== HOLD_SCOPE ||
    value.providerEffectProcessing !==
      PROVIDER_EFFECT_PROCESSING ||
    value.taxMode !== "disabled_by_owner"
  ) {
    throw configurationError(
      "CUSTOM_BUILD_FINAL_PAYMENT_RELEASE_INVALID",
      "Custom-build final payment release must preserve the pre-effective disabled tax decision, gate only new Checkout creation, and continue settlement and reconciliation for existing provider effects."
    );
  }
  return Object.freeze({ ...value });
}

export function createConfiguredCustomBuildFinalPaymentRelease({
  environment = process.env
} = {}) {
  const configuredMode =
    environment?.SITESOURCERY_CUSTOM_BUILD_FINAL_PAYMENT_MODE;
  const mode = configuredMode === undefined
    ? "held"
    : configuredMode;
  if (!MODES.has(mode)) {
    throw configurationError(
      "CUSTOM_BUILD_FINAL_PAYMENT_MODE_INVALID",
      "SITESOURCERY_CUSTOM_BUILD_FINAL_PAYMENT_MODE must be exactly held or approved."
    );
  }
  return Object.freeze({
    mode,
    release: validateCustomBuildFinalPaymentRelease({
      approved: mode === "approved",
      currency: "USD",
      holdScope: HOLD_SCOPE,
      providerEffectProcessing: PROVIDER_EFFECT_PROCESSING,
      taxMode: "disabled_by_owner"
    })
  });
}

export function assertApprovedCustomBuildFinalPaymentReady(
  composition,
  stripeReadiness,
  customBuildReadiness,
  finalPaymentReadiness
) {
  if (
    composition?.mode === "approved" &&
    !(
      composition?.release?.approved === true &&
      composition.release.currency === "USD" &&
      composition.release.holdScope === HOLD_SCOPE &&
      composition.release.providerEffectProcessing ===
        PROVIDER_EFFECT_PROCESSING &&
      composition.release.taxMode === "disabled_by_owner" &&
      stripeReadiness?.ready === true &&
      stripeReadiness?.taxModes?.customBuildFinal ===
        composition.release.taxMode &&
      customBuildReadiness?.schema ===
        "sitesourcery.custom-services-custom-build-readiness/v1" &&
      customBuildReadiness?.ready === true &&
      finalPaymentReadiness?.schema ===
        "sitesourcery.custom-build-final-payment-readiness/v1" &&
      finalPaymentReadiness?.ready === true &&
      finalPaymentReadiness?.completionBoundObligation === true &&
      finalPaymentReadiness?.exactFinalInstallment === true &&
      finalPaymentReadiness?.acceptedChangesExcluded === true &&
      finalPaymentReadiness?.assessmentCreditExcluded === true &&
      finalPaymentReadiness?.zeroBalanceClearance === true &&
      finalPaymentReadiness?.globalProviderEffectFence === true &&
      finalPaymentReadiness?.taxMode ===
        composition.release.taxMode &&
      finalPaymentReadiness?.exclusiveTaxBehavior === true &&
      finalPaymentReadiness?.webhookWakeup === true &&
      finalPaymentReadiness?.stripeReadback === true &&
      finalPaymentReadiness?.atomicSettlement === true &&
      finalPaymentReadiness?.ownerReconciliation === true &&
      finalPaymentReadiness?.holdScope === HOLD_SCOPE &&
      finalPaymentReadiness?.providerEffectProcessing ===
        PROVIDER_EFFECT_PROCESSING
    )
  ) {
    throw configurationError(
      "CUSTOM_BUILD_FINAL_PAYMENT_NOT_READY",
      "Approved Custom-build final payment requires a completion-bound second installment, cross-purpose provider fencing, exact Stripe readback settlement, zero-balance clearance, and reconciliation that remains active while new Checkout creation is held."
    );
  }
  return stripeReadiness;
}
