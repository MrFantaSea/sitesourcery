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
  error.name = "CustomBuildChangePaymentConfigurationError";
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

export function validateCustomBuildChangePaymentRelease(value) {
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
    value.taxMode !== "automatic"
  ) {
    throw configurationError(
      "CUSTOM_BUILD_CHANGE_PAYMENT_RELEASE_INVALID",
      "Custom-build change payment release must preserve USD automatic tax, gate only new Checkout creation, and continue settlement and reconciliation for existing provider effects."
    );
  }
  return Object.freeze({ ...value });
}

export function createConfiguredCustomBuildChangePaymentRelease({
  environment = process.env
} = {}) {
  const configuredMode =
    environment?.SITESOURCERY_CUSTOM_BUILD_CHANGE_PAYMENT_MODE;
  const mode = configuredMode === undefined
    ? "held"
    : configuredMode;
  if (!MODES.has(mode)) {
    throw configurationError(
      "CUSTOM_BUILD_CHANGE_PAYMENT_MODE_INVALID",
      "SITESOURCERY_CUSTOM_BUILD_CHANGE_PAYMENT_MODE must be exactly held or approved."
    );
  }
  return Object.freeze({
    mode,
    release: validateCustomBuildChangePaymentRelease({
      approved: mode === "approved",
      currency: "USD",
      holdScope: HOLD_SCOPE,
      providerEffectProcessing: PROVIDER_EFFECT_PROCESSING,
      taxMode: "automatic"
    })
  });
}

export function assertApprovedCustomBuildChangePaymentReady(
  composition,
  stripeReadiness,
  customBuildReadiness,
  changePaymentReadiness
) {
  if (
    composition?.mode === "approved" &&
    !(
      stripeReadiness?.ready === true &&
      stripeReadiness?.taxMode === "automatic" &&
      customBuildReadiness?.schema ===
        "sitesourcery.custom-services-custom-build-readiness/v1" &&
      customBuildReadiness?.ready === true &&
      changePaymentReadiness?.schema ===
        "sitesourcery.custom-build-change-payment-readiness/v1" &&
      changePaymentReadiness?.ready === true &&
      changePaymentReadiness?.automaticTax === true &&
      changePaymentReadiness?.webhookWakeup === true &&
      changePaymentReadiness?.stripeReadback === true &&
      changePaymentReadiness?.atomicSettlement === true &&
      changePaymentReadiness?.activatesAcceptedChange === true &&
      changePaymentReadiness?.ownerReconciliation === true &&
      changePaymentReadiness?.holdScope === HOLD_SCOPE &&
      changePaymentReadiness?.providerEffectProcessing ===
        PROVIDER_EFFECT_PROCESSING
    )
  ) {
    throw configurationError(
      "CUSTOM_BUILD_CHANGE_PAYMENT_NOT_READY",
      "Approved Custom-build change payment requires ready Stripe automatic tax, exact provider readback settlement, atomic change activation, and reconciliation that remains active while new Checkout creation is held."
    );
  }
  return stripeReadiness;
}
