import assert from "node:assert/strict";
import test from "node:test";

import {
  assertApprovedAlakazamReady,
  createConfiguredAlakazamRelease
} from "../alakazam-release-config.mjs";

test("Alakazam defaults held without latent tax authority", () => {
  const held = createConfiguredAlakazamRelease({
    environment: {}
  });
  assert.equal(held.mode, "held");
  assert.equal(held.release.approved, false);
  assert.equal(held.release.taxMode, null);
  assert.throws(
    () =>
      createConfiguredAlakazamRelease({
        environment: {
          SITESOURCERY_ALAKAZAM_MODE: "held",
          SITESOURCERY_ALAKAZAM_TAX_MODE:
            "disabled_by_owner"
        }
      }),
    (error) =>
      error.code ===
      "ALAKAZAM_TAX_MODE_WITHOUT_APPROVAL"
  );
});

test("approved Alakazam requires one exact tax ruling", () => {
  for (const taxMode of [
    "automatic",
    "disabled_by_owner"
  ]) {
    const approved = createConfiguredAlakazamRelease({
      environment: {
        SITESOURCERY_ALAKAZAM_MODE: "approved",
        SITESOURCERY_ALAKAZAM_TAX_MODE: taxMode
      }
    });
    assert.equal(approved.mode, "approved");
    assert.equal(approved.release.approved, true);
    assert.equal(approved.release.taxMode, taxMode);
  }
  assert.throws(
    () =>
      createConfiguredAlakazamRelease({
        environment: {
          SITESOURCERY_ALAKAZAM_MODE: "approved"
        }
      }),
    (error) =>
      error.code === "ALAKAZAM_TAX_MODE_INVALID"
  );
});

test("approved Alakazam refuses startup until matching Stripe readiness", () => {
  const approved = createConfiguredAlakazamRelease({
    environment: {
      SITESOURCERY_ALAKAZAM_MODE: "approved",
      SITESOURCERY_ALAKAZAM_TAX_MODE:
        "disabled_by_owner"
    }
  });
  assert.throws(
    () =>
      assertApprovedAlakazamReady(approved, {
        ready: true,
        provider: "stripe",
        alakazam: true,
        taxMode: "automatic",
        livemode: false
      }),
    (error) => error.code === "ALAKAZAM_NOT_READY"
  );
  const ready = {
    ready: true,
    provider: "stripe",
    alakazam: true,
    taxMode: "disabled_by_owner",
    livemode: false
  };
  assert.deepEqual(
    assertApprovedAlakazamReady(approved, ready),
    ready
  );
  assert.doesNotThrow(() =>
    assertApprovedAlakazamReady(
      createConfiguredAlakazamRelease({
        environment: {}
      }),
      { ready: false }
    )
  );
});
