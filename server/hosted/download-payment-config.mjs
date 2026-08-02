import {
  createDownloadPaymentRelease
} from "../commerce-v2/index.mjs";

const MODES = new Set(["held", "approved"]);

function configurationError(code, message) {
  const error = new Error(message);
  error.name = "DownloadPaymentConfigurationError";
  error.code = code;
  return error;
}

export function createConfiguredDownloadPaymentRelease({
  environment = process.env
} = {}) {
  const mode =
    environment?.SITESOURCERY_DOWNLOAD_PAYMENT_MODE ??
    "held";
  if (!MODES.has(mode)) {
    throw configurationError(
      "DOWNLOAD_PAYMENT_MODE_INVALID",
      "SITESOURCERY_DOWNLOAD_PAYMENT_MODE must be exactly held or approved."
    );
  }
  return Object.freeze({
    mode,
    release: createDownloadPaymentRelease({
      approved: mode === "approved"
    })
  });
}

export function assertApprovedDownloadPaymentReady(
  composition,
  readiness
) {
  if (
    composition?.mode === "approved" &&
    readiness?.ready !== true
  ) {
    throw configurationError(
      "DOWNLOAD_PAYMENT_NOT_READY",
      "Approved $5 Download payment is not ready; inspect the private payment configuration."
    );
  }
  return readiness;
}
