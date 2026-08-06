import assert from "node:assert/strict";
import test from "node:test";

import {
  assertApprovedCustomBuildPaymentReady,
  createConfiguredCustomBuildPaymentRelease
} from "../custom-services-custom-build-payment-config.mjs";

const STRIPE_READY = Object.freeze({
  ready: true,
  taxMode: "automatic"
});
const CUSTOM_BUILD_READY = Object.freeze({
  schema: "sitesourcery.custom-services-custom-build-readiness/v1",
  ready: true
});
const PAYMENT_READY = Object.freeze({
  schema: "sitesourcery.custom-build-payment-readiness/v1",
  ready: true,
  automaticTax: true,
  stripeReadback: true,
  atomicCreditSettlement: true,
  opensBuildJob: true
});

test("Custom-build payment defaults held behind one exact release", () => {
  assert.deepEqual(
    createConfiguredCustomBuildPaymentRelease({ environment: {} }),
    {
      mode: "held",
      release: {
        approved: false,
        currency: "USD",
        paymentWindowDays: 7,
        taxMode: "automatic"
      }
    }
  );
  assert.throws(
    () =>
      createConfiguredCustomBuildPaymentRelease({
        environment: {
          SITESOURCERY_CUSTOM_BUILD_PAYMENT_MODE: "true"
        }
      }),
    (error) => error.code === "CUSTOM_BUILD_PAYMENT_MODE_INVALID"
  );
});

test("approved Custom-build payment requires every exact readiness", () => {
  const approved = createConfiguredCustomBuildPaymentRelease({
    environment: {
      SITESOURCERY_CUSTOM_BUILD_PAYMENT_MODE: "approved"
    }
  });
  assert.equal(approved.release.approved, true);
  assert.deepEqual(
    assertApprovedCustomBuildPaymentReady(
      approved,
      STRIPE_READY,
      CUSTOM_BUILD_READY,
      PAYMENT_READY
    ),
    STRIPE_READY
  );

  for (const readiness of [
    [{ ready: false, taxMode: "automatic" }, CUSTOM_BUILD_READY, PAYMENT_READY],
    [STRIPE_READY, { ...CUSTOM_BUILD_READY, schema: "wrong" }, PAYMENT_READY],
    [STRIPE_READY, CUSTOM_BUILD_READY, { ...PAYMENT_READY, opensBuildJob: false }]
  ]) {
    assert.throws(
      () =>
        assertApprovedCustomBuildPaymentReady(
          approved,
          readiness[0],
          readiness[1],
          readiness[2]
        ),
      (error) => error.code === "CUSTOM_BUILD_PAYMENT_NOT_READY"
    );
  }

  assert.doesNotThrow(() =>
    assertApprovedCustomBuildPaymentReady(
      createConfiguredCustomBuildPaymentRelease({ environment: {} })
    )
  );
});
