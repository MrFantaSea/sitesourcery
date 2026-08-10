import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createConfiguredCustomBuildFinalPaymentRelease
} from "../custom-services-custom-build-final-payment-config.mjs";

test("production composes v47 completion, final payment, and handoff as separate boundaries", async () => {
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
    /const customServicesCustomBuildChangeCompletion\s*=\s*createPostgresCustomServicesCustomBuildChangeCompletion\(\{\s*authority,\s*clock:\s*commerceV2\.clock,\s*randomUUID:\s*\(\)\s*=>\s*commerceV2\.ids\.next\("custom_build_change_completion"\)\s*\}\)/u
  );
  assert.match(
    source,
    /const customBuildHandoff\s*=\s*createPostgresCustomServicesCustomBuildHandoff\(\{\s*authority,\s*ids:\s*commerceV2\.ids\s*\}\)/u
  );
  assert.match(
    source,
    /assertApprovedCustomBuildFinalPaymentReady\(\s*customBuildFinalPaymentComposition,\s*readiness\.payments,\s*await customServicesCustomBuild\.readiness\(\),\s*await customBuildFinalPayment\.readiness\(\),\s*professionalLifecycleReadiness\s*\)/u
  );
  assert.match(
    source,
    /createHostedCustomServicesAccount\(\{[\s\S]*?customBuildFinalPayment,[\s\S]*?customBuildHandoff,[\s\S]*?customBuildPayment,/u
  );
  assert.match(
    source,
    /createHostedApi\(service, \{[\s\S]*?customServicesCustomBuildFinalPayment:\s*customBuildFinalPayment,[\s\S]*?customServicesCustomBuildHandoff:\s*customBuildHandoff,/u
  );
  assert.match(
    source,
    /await customServicesCustomBuildChangeCompletion\.readiness\(\);\s*await customBuildHandoff\.readiness\(\);/u
  );
  assert.match(
    source,
    /customBuildChangeCommerce:\s*customBuildChangePayment,\s*customBuildFinalCommerce:\s*customBuildFinalPayment/u
  );
  assert.doesNotMatch(
    source,
    /createHeldCustomServicesCustomBuildFinalPayment/u
  );
  assert.doesNotMatch(
    source,
    /createHeldCustomServicesCustomBuildChangeCompletion/u
  );
  assert.doesNotMatch(
    source,
    /createHeldCustomServicesCustomBuildHandoff/u
  );
});

test("owner v47 HTTP composition keeps payment lifecycle and handoff readiness on separate authorities", async () => {
  const [httpSource, accountSource] = await Promise.all([
    readFile(new URL("../http.mjs", import.meta.url), "utf8"),
    readFile(
      new URL("../custom-services-account-hosted.mjs", import.meta.url),
      "utf8"
    )
  ]);

  assert.match(
    accountSource,
    /export const CUSTOM_BUILD_OWNER_HANDOFF_READINESS_SCHEMA\s*=\s*"sitesourcery\.custom-build-handoff-owner-readiness\/v1"/u
  );
  assert.match(
    accountSource,
    /createHostedCustomServicesCustomBuildHandoffOwner[\s\S]*?readOwnerState[\s\S]*?boundary\.readOwner/u
  );
  assert.match(
    httpSource,
    /custom-build-jobs\\\/\(\[\^\/\]\+\)\\\/final-payments\$[\s\S]*?readOwnerFinalPayments/u
  );
  assert.match(
    httpSource,
    /custom-build-jobs\\\/\(\[\^\/\]\+\)\\\/final-handoff\$[\s\S]*?customServicesCustomBuildHandoffOwnerBoundary[\s\S]*?\.readOwnerState/u
  );
  assert.match(
    httpSource,
    /custom-build-jobs\\\/\(\[\^\/\]\+\)\\\/handoff\$[\s\S]*?customServicesCustomBuildHandoffOwnerBoundary[\s\S]*?\.createHandoff/u
  );
  assert.doesNotMatch(
    httpSource,
    /ownerCustomBuildFinalHandoffProjection/u
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
      taxMode: "disabled_by_owner"
    }
  });
});
