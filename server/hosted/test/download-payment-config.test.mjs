import assert from "node:assert/strict";
import test from "node:test";

import {
  assertApprovedDownloadPaymentReady,
  createConfiguredDownloadPaymentRelease
} from "../download-payment-config.mjs";

test("Download payment defaults held and requires one exact approval mode", () => {
  const held = createConfiguredDownloadPaymentRelease({
    environment: {}
  });
  assert.equal(held.mode, "held");
  assert.equal(held.release.approved, false);
  assert.equal(held.release.amountMinor, 2000);
  assert.equal(held.release.currency, "USD");
  assert.throws(
    () =>
      createConfiguredDownloadPaymentRelease({
        environment: {
          SITESOURCERY_DOWNLOAD_PAYMENT_MODE:
            "true"
        }
      }),
    (error) =>
      error.code === "DOWNLOAD_PAYMENT_MODE_INVALID"
  );
});

test("approved Download mode refuses startup until the exact path is ready", () => {
  const approved =
    createConfiguredDownloadPaymentRelease({
      environment: {
        SITESOURCERY_DOWNLOAD_PAYMENT_MODE:
          "approved"
      }
    });
  assert.equal(approved.release.approved, true);
  assert.throws(
    () =>
      assertApprovedDownloadPaymentReady(
        approved,
        { ready: false }
      ),
    (error) =>
      error.code === "DOWNLOAD_PAYMENT_NOT_READY"
  );
  assert.deepEqual(
    assertApprovedDownloadPaymentReady(
      approved,
      { ready: true, payment: true }
    ),
    { ready: true, payment: true }
  );
  assert.doesNotThrow(() =>
    assertApprovedDownloadPaymentReady(
      createConfiguredDownloadPaymentRelease({
        environment: {}
      }),
      { ready: false }
    )
  );
});
