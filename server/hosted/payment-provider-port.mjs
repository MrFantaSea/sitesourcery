import { HostedError, invariant } from "./errors.mjs";

const METHODS = Object.freeze([
  "readiness",
  "createCheckout",
  "createBillingPortal",
  "scheduleCancellation",
  "verifyWebhook"
]);

function held(capability) {
  return async () => {
    throw new HostedError(
      "PAYMENT_PROVIDER_HELD",
      `${capability} is held until an exact payment-provider approval is installed.`,
      {
        status: 503,
        details: {
          certainty: "not_submitted",
          providerEffect: false
        }
      }
    );
  };
}

export function createHeldHostedPaymentProvider() {
  return Object.freeze({
    mode: "held",
    async readiness() {
      return Object.freeze({
        ready: false,
        provider: "stripe",
        mode: "held",
        code: "PAYMENT_PROVIDER_HELD"
      });
    },
    createCheckout: held("Checkout"),
    createBillingPortal: held("Billing portal access"),
    scheduleCancellation: held("Subscription cancellation dispatch"),
    verifyWebhook: held("Stripe webhook verification")
  });
}

export function validateHostedPaymentProvider(value) {
  const provider = value ?? createHeldHostedPaymentProvider();
  invariant(
    provider &&
      METHODS.every(
        (method) => typeof provider[method] === "function"
      ),
    "RUNTIME_CONFIGURATION_ERROR",
    "The hosted payment provider must implement readiness, Checkout, billing portal, cancellation, and webhook verification.",
    { status: 500 }
  );
  return provider;
}

export function providerEffectCertainty(error) {
  const selected =
    error?.certainty ?? error?.details?.certainty ?? null;
  if (
    selected === "not_submitted" ||
    selected === "no_effect"
  ) {
    return "not_submitted";
  }
  return "ambiguous";
}

export function providerErrorCode(error) {
  const value = String(
    error?.code ?? "PAYMENT_PROVIDER_ERROR"
  );
  return value.slice(0, 200) || "PAYMENT_PROVIDER_ERROR";
}
