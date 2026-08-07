import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createConfiguredCustomBuildChangePaymentRelease
} from "../custom-services-custom-build-change-payment-config.mjs";

test("production composes Purpose-1 PostgreSQL payment separately while H1M completion remains held", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );

  assert.match(
    source,
    /const customBuildChangePaymentComposition\s*=\s*createConfiguredCustomBuildChangePaymentRelease\(\)/u
  );
  assert.match(
    source,
    /const customBuildChangePayment\s*=\s*createPostgresCustomServicesCustomBuildChangePayment\(\{\s*authority,\s*provider:\s*stripeComposition\.adapter,\s*release:\s*customBuildChangePaymentComposition\.release,\s*clock:\s*commerceV2\.clock,\s*ids:\s*commerceV2\.ids\s*\}\)/u
  );
  assert.match(
    source,
    /const customServicesCustomBuildChangeCompletion\s*=\s*createHeldCustomServicesCustomBuildChangeCompletion\(\)/u
  );
  assert.match(
    source,
    /assertApprovedCustomBuildChangePaymentReady\(\s*customBuildChangePaymentComposition,\s*readiness\.payments,\s*await customServicesCustomBuild\.readiness\(\),\s*await customBuildChangePayment\.readiness\(\)\s*\)/u
  );
  assert.match(
    source,
    /createHostedCustomServicesAccount\(\{[\s\S]*?customBuildChangePayment,[\s\S]*?customBuildPayment,/u
  );
  assert.match(
    source,
    /createHostedApi\(service, \{[\s\S]*?customServicesCustomBuildChangePayment:\s*customBuildChangePayment,/u
  );
  assert.match(
    source,
    /customBuildCommerce:\s*customBuildPayment,\s*alakazamCommerce,\s*customBuildChangeCommerce:\s*customBuildChangePayment/u
  );
  assert.doesNotMatch(
    source,
    /createHeldCustomServicesCustomBuildChangePayment/u
  );
});

test("the default production release holds only new Purpose-1 Checkout creation", () => {
  const composition =
    createConfiguredCustomBuildChangePaymentRelease({
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
