import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createConfiguredCustomBuildFinalPaymentRelease
} from "../custom-services-custom-build-final-payment-config.mjs";

test("production composes v46 final payment separately while H1M completion remains held", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );

  assert.match(
    source,
    /const customBuildFinalPaymentComposition\s*=\s*createConfiguredCustomBuildFinalPaymentRelease\(\)/u
  );
  assert.match(
    source,
    /const customBuildFinalPayment\s*=\s*createPostgresCustomServicesCustomBuildFinalPayment\(\{\s*authority,\s*provider:\s*stripeComposition\.adapter,\s*release:\s*customBuildFinalPaymentComposition\.release,\s*clock:\s*commerceV2\.clock,\s*ids:\s*commerceV2\.ids\s*\}\)/u
  );
  assert.match(
    source,
    /const customServicesCustomBuildChangeCompletion\s*=\s*createHeldCustomServicesCustomBuildChangeCompletion\(\)/u
  );
  assert.match(
    source,
    /assertApprovedCustomBuildFinalPaymentReady\(\s*customBuildFinalPaymentComposition,\s*readiness\.payments,\s*await customServicesCustomBuild\.readiness\(\),\s*await customBuildFinalPayment\.readiness\(\)\s*\)/u
  );
  assert.match(
    source,
    /createHostedCustomServicesAccount\(\{[\s\S]*?customBuildFinalPayment,[\s\S]*?customBuildPayment,/u
  );
  assert.match(
    source,
    /createHostedApi\(service, \{[\s\S]*?customServicesCustomBuildFinalPayment:\s*customBuildFinalPayment,/u
  );
  assert.match(
    source,
    /customBuildChangeCommerce:\s*customBuildChangePayment,\s*customBuildFinalCommerce:\s*customBuildFinalPayment/u
  );
  assert.doesNotMatch(
    source,
    /createHeldCustomServicesCustomBuildFinalPayment/u
  );
});

test("the default production release holds only new v46 final Checkout creation", () => {
  const composition =
    createConfiguredCustomBuildFinalPaymentRelease({
      environment: {}
    });

  assert.deepEqual(composition, {
    mode: "held",
    release: {
      approved: false,
      currency: "USD",
      holdScope: "new_checkout_creation_only",
      providerEffectProcessing:
        "settlement_and_reconciliation_continue",
      taxMode: "automatic"
    }
  });
});
