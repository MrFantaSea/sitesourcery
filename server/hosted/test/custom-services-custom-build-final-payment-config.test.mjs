import assert from "node:assert/strict";
import test from "node:test";

import {
  assertApprovedCustomBuildFinalPaymentReady,
  createConfiguredCustomBuildFinalPaymentRelease,
  validateCustomBuildFinalPaymentRelease
} from "../custom-services-custom-build-final-payment-config.mjs";

const STRIPE_READY = Object.freeze({
  ready: true,
  taxModes: Object.freeze({
    customBuildFinal: "disabled_by_owner"
  })
});
const CUSTOM_BUILD_READY = Object.freeze({
  schema: "sitesourcery.custom-services-custom-build-readiness/v1",
  ready: true
});
const FINAL_PAYMENT_READY = Object.freeze({
  schema: "sitesourcery.custom-build-final-payment-readiness/v1",
  ready: true,
  completionBoundObligation: true,
  exactFinalInstallment: true,
  acceptedChangesExcluded: true,
  assessmentCreditExcluded: true,
  zeroBalanceClearance: true,
  globalProviderEffectFence: true,
  taxMode: "disabled_by_owner",
  exclusiveTaxBehavior: true,
  webhookWakeup: true,
  stripeReadback: true,
  atomicSettlement: true,
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
  taxMode: "disabled_by_owner"
});

test("Custom-build final payment defaults held for new Checkout creation only", () => {
  const held = createConfiguredCustomBuildFinalPaymentRelease({
    environment: {}
  });
  assert.deepEqual(held, {
    mode: "held",
    release: EXACT_HELD_RELEASE
  });
  assert.equal(Object.isFrozen(held), true);
  assert.equal(Object.isFrozen(held.release), true);
  assert.equal("amountMinor" in held.release, false);
  assert.equal("paymentDeadline" in held.release, false);
  assert.equal("handoff" in held.release, false);
  assert.equal(
    held.release.providerEffectProcessing,
    "settlement_and_reconciliation_continue"
  );
  assert.doesNotThrow(() =>
    assertApprovedCustomBuildFinalPaymentReady(held)
  );
});

test("Custom-build final payment mode accepts only exact held or approved values", () => {
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
        createConfiguredCustomBuildFinalPaymentRelease({
          environment: {
            SITESOURCERY_CUSTOM_BUILD_FINAL_PAYMENT_MODE:
              mode
          }
        }),
      (error) =>
        error.name ===
          "CustomBuildFinalPaymentConfigurationError" &&
        error.code ===
          "CUSTOM_BUILD_FINAL_PAYMENT_MODE_INVALID"
    );
  }
});

test("Custom-build final payment release rejects drift and extra financial authority", () => {
  const invalidReleases = [
    null,
    [],
    { ...EXACT_HELD_RELEASE, amountMinor: 32500 },
    { ...EXACT_HELD_RELEASE, acceptedChangeMinor: 12500 },
    { ...EXACT_HELD_RELEASE, assessmentCreditMinor: 20000 },
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
      taxMode: "disabled_by_owner"
    },
    Object.create(EXACT_HELD_RELEASE)
  ];
  for (const release of invalidReleases) {
    assert.throws(
      () => validateCustomBuildFinalPaymentRelease(release),
      (error) =>
        error.name ===
          "CustomBuildFinalPaymentConfigurationError" &&
        error.code ===
          "CUSTOM_BUILD_FINAL_PAYMENT_RELEASE_INVALID"
    );
  }
});

test("approved Custom-build final payment preserves the exact v46 purpose contract", () => {
  const approved =
    createConfiguredCustomBuildFinalPaymentRelease({
      environment: {
        SITESOURCERY_CUSTOM_BUILD_FINAL_PAYMENT_MODE:
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
    assertApprovedCustomBuildFinalPaymentReady(
      approved,
      STRIPE_READY,
      CUSTOM_BUILD_READY,
      FINAL_PAYMENT_READY
    ),
    STRIPE_READY
  );
});

test("approved Custom-build final payment rejects every readiness mismatch", () => {
  const approved =
    createConfiguredCustomBuildFinalPaymentRelease({
      environment: {
        SITESOURCERY_CUSTOM_BUILD_FINAL_PAYMENT_MODE:
          "approved"
      }
    });
  const mismatches = [
    [{ ...STRIPE_READY, ready: false }, CUSTOM_BUILD_READY, FINAL_PAYMENT_READY],
    [
      {
        ...STRIPE_READY,
        taxModes: { customBuildFinal: "automatic" }
      },
      CUSTOM_BUILD_READY,
      FINAL_PAYMENT_READY
    ],
    [STRIPE_READY, { ...CUSTOM_BUILD_READY, schema: "wrong" }, FINAL_PAYMENT_READY],
    [STRIPE_READY, { ...CUSTOM_BUILD_READY, ready: false }, FINAL_PAYMENT_READY],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, schema: "wrong" }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, ready: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, completionBoundObligation: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, exactFinalInstallment: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, acceptedChangesExcluded: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, assessmentCreditExcluded: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, zeroBalanceClearance: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, globalProviderEffectFence: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, exclusiveTaxBehavior: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, webhookWakeup: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, stripeReadback: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, atomicSettlement: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, ownerReconciliation: false }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, holdScope: "all_payment_work" }],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...FINAL_PAYMENT_READY, providerEffectProcessing: "held" }]
  ];
  for (const [stripe, customBuild, finalPayment] of mismatches) {
    assert.throws(
      () =>
        assertApprovedCustomBuildFinalPaymentReady(
          approved,
          stripe,
          customBuild,
          finalPayment
        ),
      (error) =>
        error.code ===
          "CUSTOM_BUILD_FINAL_PAYMENT_NOT_READY"
    );
  }

  assert.throws(
    () =>
      assertApprovedCustomBuildFinalPaymentReady(
        {
          ...approved,
          release: {
            ...approved.release,
            approved: false
          }
        },
        STRIPE_READY,
        CUSTOM_BUILD_READY,
        FINAL_PAYMENT_READY
      ),
    (error) =>
      error.code ===
        "CUSTOM_BUILD_FINAL_PAYMENT_NOT_READY"
  );
});
