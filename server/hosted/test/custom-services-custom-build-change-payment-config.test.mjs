import assert from "node:assert/strict";
import test from "node:test";

import {
  assertApprovedCustomBuildChangePaymentReady,
  createConfiguredCustomBuildChangePaymentRelease,
  validateCustomBuildChangePaymentRelease
} from "../custom-services-custom-build-change-payment-config.mjs";

const STRIPE_READY = Object.freeze({
  ready: true,
  taxMode: "automatic"
});
const CUSTOM_BUILD_READY = Object.freeze({
  schema: "sitesourcery.custom-services-custom-build-readiness/v1",
  ready: true
});
const CHANGE_PAYMENT_READY = Object.freeze({
  schema: "sitesourcery.custom-build-change-payment-readiness/v1",
  ready: true,
  automaticTax: true,
  webhookWakeup: true,
  stripeReadback: true,
  atomicSettlement: true,
  activatesAcceptedChange: true,
  ownerReconciliation: true,
  holdScope: "new_checkout_creation_only",
  providerEffectProcessing:
    "settlement_and_reconciliation_continue"
});

const EXACT_HELD_RELEASE = Object.freeze({
  approved: false,
  currency: "USD",
  holdScope: "new_checkout_creation_only",
  providerEffectProcessing:
    "settlement_and_reconciliation_continue",
  taxMode: "automatic"
});

test("Custom-build change payment defaults held for new Checkout creation only", () => {
  const held = createConfiguredCustomBuildChangePaymentRelease({
    environment: {}
  });
  assert.deepEqual(held, {
    mode: "held",
    release: EXACT_HELD_RELEASE
  });
  assert.equal(Object.isFrozen(held), true);
  assert.equal(Object.isFrozen(held.release), true);
  assert.equal("paymentWindowDays" in held.release, false);
  assert.equal("paymentDeadline" in held.release, false);
  assert.equal(
    held.release.providerEffectProcessing,
    "settlement_and_reconciliation_continue"
  );
});

test("Custom-build change payment mode accepts only exact held or approved values", () => {
  for (const mode of [
    "true",
    "APPROVED",
    "approved ",
    "",
    null,
    false
  ]) {
    assert.throws(
      () =>
        createConfiguredCustomBuildChangePaymentRelease({
          environment: {
            SITESOURCERY_CUSTOM_BUILD_CHANGE_PAYMENT_MODE: mode
          }
        }),
      (error) =>
        error.name ===
          "CustomBuildChangePaymentConfigurationError" &&
        error.code ===
          "CUSTOM_BUILD_CHANGE_PAYMENT_MODE_INVALID"
    );
  }
});

test("Custom-build change payment release rejects drift and extra authority", () => {
  const invalidReleases = [
    null,
    [],
    { ...EXACT_HELD_RELEASE, amountMinor: 12500 },
    { ...EXACT_HELD_RELEASE, paymentWindowDays: 7 },
    { ...EXACT_HELD_RELEASE, currency: "usd" },
    { ...EXACT_HELD_RELEASE, taxMode: "manual" },
    { ...EXACT_HELD_RELEASE, holdScope: "all_payment_work" },
    { ...EXACT_HELD_RELEASE, providerEffectProcessing: "held" },
    {
      currency: "USD",
      holdScope: "new_checkout_creation_only",
      providerEffectProcessing:
        "settlement_and_reconciliation_continue",
      taxMode: "automatic"
    },
    Object.create(EXACT_HELD_RELEASE)
  ];
  for (const release of invalidReleases) {
    assert.throws(
      () => validateCustomBuildChangePaymentRelease(release),
      (error) =>
        error.name ===
          "CustomBuildChangePaymentConfigurationError" &&
        error.code ===
          "CUSTOM_BUILD_CHANGE_PAYMENT_RELEASE_INVALID"
    );
  }
});

test("approved Custom-build change payment preserves the exact purpose contract", () => {
  const approved =
    createConfiguredCustomBuildChangePaymentRelease({
      environment: {
        SITESOURCERY_CUSTOM_BUILD_CHANGE_PAYMENT_MODE:
          "approved"
      }
    });
  assert.deepEqual(approved, {
    mode: "approved",
    release: {
      ...EXACT_HELD_RELEASE,
      approved: true
    }
  });
  assert.deepEqual(
    assertApprovedCustomBuildChangePaymentReady(
      approved,
      STRIPE_READY,
      CUSTOM_BUILD_READY,
      CHANGE_PAYMENT_READY
    ),
    STRIPE_READY
  );
});

test("approved Custom-build change payment rejects every readiness mismatch", () => {
  const approved =
    createConfiguredCustomBuildChangePaymentRelease({
      environment: {
        SITESOURCERY_CUSTOM_BUILD_CHANGE_PAYMENT_MODE:
          "approved"
      }
    });
  const mismatches = [
    [{ ...STRIPE_READY, ready: false }, CUSTOM_BUILD_READY, CHANGE_PAYMENT_READY],
    [{ ...STRIPE_READY, taxMode: "manual" }, CUSTOM_BUILD_READY, CHANGE_PAYMENT_READY],
    [STRIPE_READY, { ...CUSTOM_BUILD_READY, schema: "wrong" }, CHANGE_PAYMENT_READY],
    [STRIPE_READY, { ...CUSTOM_BUILD_READY, ready: false }, CHANGE_PAYMENT_READY],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...CHANGE_PAYMENT_READY, schema: "wrong" }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...CHANGE_PAYMENT_READY, ready: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...CHANGE_PAYMENT_READY, automaticTax: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...CHANGE_PAYMENT_READY, webhookWakeup: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...CHANGE_PAYMENT_READY, stripeReadback: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...CHANGE_PAYMENT_READY, atomicSettlement: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...CHANGE_PAYMENT_READY, activatesAcceptedChange: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...CHANGE_PAYMENT_READY, ownerReconciliation: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...CHANGE_PAYMENT_READY, holdScope: "all_payment_work" }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...CHANGE_PAYMENT_READY, providerEffectProcessing: "held" }]
  ];
  for (const [stripe, customBuild, changePayment] of mismatches) {
    assert.throws(
      () =>
        assertApprovedCustomBuildChangePaymentReady(
          approved,
          stripe,
          customBuild,
          changePayment
        ),
      (error) =>
        error.code === "CUSTOM_BUILD_CHANGE_PAYMENT_NOT_READY"
    );
  }

  assert.doesNotThrow(() =>
    assertApprovedCustomBuildChangePaymentReady(
      createConfiguredCustomBuildChangePaymentRelease({
        environment: {}
      })
    )
  );
});
