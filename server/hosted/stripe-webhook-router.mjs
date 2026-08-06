import {
  isPotentialAlakazamStripeEvent,
  isDownloadStripeEvent,
  isPotentialDownloadReversalEvent
} from "../commerce-v2/index.mjs";
import {
  isPotentialCustomServicesAssessmentStripeEvent
} from "./custom-services-assessment-settlement-postgres.mjs";
import {
  isPotentialCustomBuildPaymentStripeEvent
} from "./custom-services-custom-build-payment-postgres.mjs";
import { HostedError, invariant } from "./errors.mjs";

const SAFE_CODE = /^[A-Za-z0-9._:-]{1,200}$/u;

function providerCode(error) {
  const value = String(error?.code ?? "");
  return SAFE_CODE.test(value)
    ? value
    : "stripe_provider_error";
}

export function createStripeWebhookRouter({
  provider,
  canonicalService,
  downloadCommerce,
  assessmentCommerce,
  customBuildCommerce,
  alakazamCommerce
} = {}) {
  invariant(
    provider &&
      typeof provider.verifyWebhook === "function" &&
      canonicalService &&
      typeof canonicalService.ingestVerifiedStripeEvent ===
        "function" &&
      downloadCommerce &&
      typeof downloadCommerce.ingestStripeEvent ===
        "function" &&
      assessmentCommerce &&
      typeof assessmentCommerce.ingestStripeEvent ===
        "function" &&
      customBuildCommerce &&
      typeof customBuildCommerce.ingestStripeEvent ===
        "function" &&
      alakazamCommerce &&
      typeof alakazamCommerce.ingestStripeEvent ===
        "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "The shared Stripe webhook router is incomplete.",
    { status: 500 }
  );

  return Object.freeze({
    async ingestStripeWebhook({
      rawBody,
      signature
    } = {}) {
      invariant(
        Buffer.isBuffer(rawBody),
        "STRIPE_WEBHOOK_BODY_REQUIRED",
        "Stripe webhook verification requires the exact raw request bytes.",
        { status: 400 }
      );
      let event;
      try {
        event = await provider.verifyWebhook({
          rawBody,
          signature
        });
      } catch (error) {
        if (error instanceof HostedError) throw error;
        const code = String(error?.code ?? "");
        const invalid =
          code.includes("webhook") ||
          code.includes("signature");
        throw new HostedError(
          invalid
            ? "STRIPE_WEBHOOK_SIGNATURE_INVALID"
            : "STRIPE_WEBHOOK_UNAVAILABLE",
          invalid
            ? "Stripe webhook signature verification failed."
            : "Stripe webhook verification is unavailable.",
          {
            status: invalid ? 400 : 503,
            details: {
              providerErrorCode: providerCode(error),
              providerEffect: false
            }
          }
        );
      }
      if (isDownloadStripeEvent(event)) {
        return downloadCommerce.ingestStripeEvent(
          event
        );
      }
      if (isPotentialDownloadReversalEvent(event)) {
        const result =
          await downloadCommerce.ingestStripeEvent(
            event
          );
        if (result?.status !== "not_download") {
          return result;
        }
      }
      if (
        isPotentialCustomServicesAssessmentStripeEvent(
          event
        )
      ) {
        return assessmentCommerce.ingestStripeEvent(
          event
        );
      }
      if (isPotentialCustomBuildPaymentStripeEvent(event)) {
        return customBuildCommerce.ingestStripeEvent(event);
      }
      if (isPotentialAlakazamStripeEvent(event)) {
        return alakazamCommerce.ingestStripeEvent(
          event
        );
      }
      return canonicalService.ingestVerifiedStripeEvent(
        event
      );
    }
  });
}
