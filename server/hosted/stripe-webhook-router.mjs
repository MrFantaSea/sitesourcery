import {
  isPotentialAlakazamStripeEvent,
  isDownloadStripeEvent,
  isPotentialDownloadReversalEvent
} from "../commerce-v2/index.mjs";
import {
  isAlakazamCancellationConfirmationEvent
} from "../commerce-v2/alakazam-lifecycle-cancellation.mjs";
import {
  isAlakazamRenewalInvoiceEvent
} from "../commerce-v2/alakazam-lifecycle-renewal.mjs";
import {
  isAlakazamReversalEvent
} from "../commerce-v2/alakazam-lifecycle-reversal.mjs";
import {
  isAlakazamPaymentIncidentEvent,
  isAlakazamPaymentRecoveryEvent
} from "../commerce-v2/alakazam-lifecycle-state.mjs";
import {
  isAlakazamInvoiceFinalizationEvent
} from "../commerce-v2/alakazam-invoice-finalization.mjs";
import {
  isPotentialProfessionalServicesReversalEvent
} from "../commerce-v2/professional-services-reversal.mjs";
import {
  exactStripeWebhookVerification
} from "../commerce/stripe-webhook-rotation.mjs";
import {
  isPotentialCustomServicesAssessmentStripeEvent
} from "./custom-services-assessment-settlement-postgres.mjs";
import {
  isPotentialCustomBuildPaymentStripeEvent
} from "./custom-services-custom-build-payment-postgres.mjs";
import {
  isPotentialCustomBuildChangePaymentStripeEvent
} from "./custom-services-custom-build-change-payment-postgres.mjs";
import {
  isPotentialCustomBuildFinalPaymentStripeEvent
} from "./custom-services-custom-build-final-payment-postgres.mjs";
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
  customBuildChangeCommerce,
  customBuildFinalCommerce,
  professionalReversal,
  alakazamCommerce,
  alakazamLifecycle
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
      customBuildChangeCommerce &&
      typeof customBuildChangeCommerce.ingestStripeEvent ===
        "function" &&
      customBuildFinalCommerce &&
      typeof customBuildFinalCommerce.ingestStripeEvent ===
        "function" &&
      professionalReversal &&
      typeof professionalReversal.ingestStripeEvent === "function" &&
      alakazamCommerce &&
      typeof alakazamCommerce.ingestStripeEvent ===
        "function" &&
      alakazamLifecycle &&
      typeof alakazamLifecycle.finalization
        ?.ingestStripeEvent === "function" &&
      typeof alakazamLifecycle.renewal
        ?.ingestStripeEvent === "function" &&
      typeof alakazamLifecycle.incident
        ?.ingestStripeEvent === "function" &&
      typeof alakazamLifecycle.recovery
        ?.ingestStripeEvent === "function" &&
      typeof alakazamLifecycle.cancellation
        ?.ingestStripeEvent === "function" &&
      typeof alakazamLifecycle.reversal
        ?.ingestStripeEvent === "function",
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
        const verified = await provider.verifyWebhook({
          rawBody,
          signature
        });
        event = exactStripeWebhookVerification(
          verified,
          { rawBody, signature }
        ).event;
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
      if (
        isPotentialCustomBuildFinalPaymentStripeEvent(
          event
        )
      ) {
        return customBuildFinalCommerce.ingestStripeEvent(
          event
        );
      }
      if (
        isPotentialCustomBuildChangePaymentStripeEvent(
          event
        )
      ) {
        return customBuildChangeCommerce.ingestStripeEvent(
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
      if (isAlakazamReversalEvent(event)) {
        const result =
          await alakazamLifecycle.reversal
            .ingestStripeEvent(event);
        if (result?.status !==
          "not_alakazam_reversal") {
          return result;
        }
      }
      if (isAlakazamInvoiceFinalizationEvent(event)) {
        const result =
          await alakazamLifecycle.finalization
            .ingestStripeEvent(event);
        if (
          result?.status !== "not_alakazam_finalization" &&
          result?.next !== "continue"
        ) {
          return result;
        }
      }
      if (isAlakazamPaymentIncidentEvent(event)) {
        const result =
          await alakazamLifecycle.incident
            .ingestStripeEvent(event);
        if (result?.status !==
          "not_alakazam_incident") {
          return result;
        }
      }
      if (isAlakazamRenewalInvoiceEvent(event)) {
        const renewed =
          await alakazamLifecycle.renewal
            .ingestStripeEvent(event);
        if (renewed?.status !==
          "not_alakazam_renewal") {
          return renewed;
        }
      }
      if (isAlakazamPaymentRecoveryEvent(event)) {
        const recovered =
          await alakazamLifecycle.recovery
            .ingestStripeEvent(event);
        if (recovered?.status !==
          "not_alakazam_recovery") {
          return recovered;
        }
      }
      if (
        isAlakazamCancellationConfirmationEvent(
          event
        )
      ) {
        const result =
          await alakazamLifecycle.cancellation
            .ingestStripeEvent(event);
        if (result?.status !==
          "not_alakazam_cancellation") {
          return result;
        }
      }
      if (isPotentialProfessionalServicesReversalEvent(event)) {
        const result =
          await professionalReversal.ingestStripeEvent(event);
        if (result?.status !== "not_professional_reversal") {
          return result;
        }
      }
      return canonicalService.ingestVerifiedStripeEvent(
        event
      );
    }
  });
}
