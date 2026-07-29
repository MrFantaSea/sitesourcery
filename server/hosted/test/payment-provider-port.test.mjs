import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldHostedPaymentProvider,
  providerEffectCertainty,
  providerErrorCode,
  validateHostedPaymentProvider
} from "../payment-provider-port.mjs";

test("hosted payment provider is fail-closed with explicit no-effect certainty", async () => {
  const held = createHeldHostedPaymentProvider();
  assert.deepEqual(await held.readiness(), {
    ready: false,
    provider: "stripe",
    mode: "held",
    code: "PAYMENT_PROVIDER_HELD"
  });
  for (const method of [
    "createCheckout",
    "createBillingPortal",
    "scheduleCancellation",
    "verifyWebhook"
  ]) {
    await assert.rejects(
      held[method]({}),
      (error) =>
        error?.code === "PAYMENT_PROVIDER_HELD" &&
        error?.status === 503 &&
        error?.details?.certainty ===
          "not_submitted" &&
        error?.details?.providerEffect === false
    );
  }
});

test("hosted payment provider requires every effect and verification method", () => {
  assert.equal(
    validateHostedPaymentProvider(
      createHeldHostedPaymentProvider()
    ).mode,
    "held"
  );
  assert.throws(
    () =>
      validateHostedPaymentProvider({
        readiness() {}
      }),
    (error) =>
      error?.code ===
      "RUNTIME_CONFIGURATION_ERROR"
  );
});

test("provider error classification never upgrades an unknown effect to no-effect", () => {
  assert.equal(
    providerEffectCertainty({
      certainty: "not_submitted"
    }),
    "not_submitted"
  );
  assert.equal(
    providerEffectCertainty({
      certainty: "no_effect"
    }),
    "not_submitted"
  );
  assert.equal(
    providerEffectCertainty(new Error("timeout")),
    "ambiguous"
  );
  assert.equal(
    providerErrorCode({
      code: "stripe_timeout"
    }),
    "stripe_timeout"
  );
});
