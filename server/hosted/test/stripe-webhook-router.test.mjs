import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_PROVIDER_METADATA_SCHEMA
} from "../../commerce-v2/index.mjs";
import {
  CUSTOM_BUILD_CHANGE_PAYMENT_METADATA_SCHEMA
} from "../custom-services-custom-build-change-payment-postgres.mjs";
import {
  CUSTOM_BUILD_FINAL_PAYMENT_METADATA_SCHEMA
} from "../custom-services-custom-build-final-payment-postgres.mjs";
import { createStripeWebhookRouter } from "../stripe-webhook-router.mjs";

function event(metadata = {}) {
  return {
    id: "evt_router_1",
    type: "checkout.session.completed",
    livemode: false,
    api_version: "2026-06-24.dahlia",
    created: 1785672300,
    data: {
      object: {
        id: "cs_test_router_1",
        metadata
      }
    }
  };
}

function fixture(
  selectedEvent,
  {
    downloadResult = { status: "download" },
    assessmentResult = { status: "assessment" },
    customBuildResult = { status: "custom_build" },
    customBuildChangeResult = {
      status: "custom_build_change"
    },
    customBuildFinalResult = {
      status: "custom_build_final"
    },
    alakazamResult = { status: "alakazam" }
  } = {}
) {
  const calls = {
    verify: [],
    canonical: [],
    download: [],
    assessment: [],
    customBuild: [],
    customBuildChange: [],
    customBuildFinal: [],
    alakazam: []
  };
  const router = createStripeWebhookRouter({
    provider: {
      async verifyWebhook(input) {
        calls.verify.push(input);
        return structuredClone(selectedEvent);
      }
    },
    canonicalService: {
      async ingestVerifiedStripeEvent(input) {
        calls.canonical.push(structuredClone(input));
        return { status: "canonical" };
      }
    },
    downloadCommerce: {
      async ingestStripeEvent(input) {
        calls.download.push(structuredClone(input));
        return structuredClone(downloadResult);
      }
    },
    assessmentCommerce: {
      async ingestStripeEvent(input) {
        calls.assessment.push(structuredClone(input));
        return structuredClone(assessmentResult);
      }
    },
    customBuildCommerce: {
      async ingestStripeEvent(input) {
        calls.customBuild.push(structuredClone(input));
        return structuredClone(customBuildResult);
      }
    },
    customBuildChangeCommerce: {
      async ingestStripeEvent(input) {
        calls.customBuildChange.push(
          structuredClone(input)
        );
        return structuredClone(customBuildChangeResult);
      }
    },
    customBuildFinalCommerce: {
      async ingestStripeEvent(input) {
        calls.customBuildFinal.push(
          structuredClone(input)
        );
        return structuredClone(customBuildFinalResult);
      }
    },
    alakazamCommerce: {
      async ingestStripeEvent(input) {
        calls.alakazam.push(structuredClone(input));
        return structuredClone(alakazamResult);
      }
    }
  });
  return { calls, router };
}

test("shared webhook router verifies raw bytes once and sends Download metadata only to v2", async () => {
  const selected = event({
    schema: "sitesourcery_download_checkout_v2"
  });
  const context = fixture(selected);
  assert.deepEqual(
    await context.router.ingestStripeWebhook({
      rawBody: Buffer.from("download-event"),
      signature: "stripe-signature"
    }),
    { status: "download" }
  );
  assert.equal(context.calls.verify.length, 1);
  assert.equal(context.calls.download.length, 1);
  assert.equal(context.calls.assessment.length, 0);
  assert.equal(context.calls.customBuildChange.length, 0);
  assert.equal(context.calls.alakazam.length, 0);
  assert.equal(context.calls.canonical.length, 0);
  assert.deepEqual(context.calls.download[0], selected);
});

test("shared webhook router sends assessment Checkout events to exact settlement", async () => {
  const selected = event({
    schema: "sitesourcery_service_assessment_checkout_v1"
  });
  const context = fixture(selected);
  assert.deepEqual(
    await context.router.ingestStripeWebhook({
      rawBody: Buffer.from("assessment-event"),
      signature: "stripe-signature"
    }),
    { status: "assessment" }
  );
  assert.equal(context.calls.verify.length, 1);
  assert.equal(context.calls.assessment.length, 1);
  assert.equal(context.calls.download.length, 0);
  assert.equal(context.calls.customBuildChange.length, 0);
  assert.equal(context.calls.alakazam.length, 0);
  assert.equal(context.calls.canonical.length, 0);
  assert.deepEqual(context.calls.assessment[0], selected);
});

test("shared webhook router sends Custom build Checkout events to exact settlement", async () => {
  const selected = event({
    schema: "sitesourcery_custom_build_start_checkout_v1"
  });
  const context = fixture(selected);
  assert.deepEqual(
    await context.router.ingestStripeWebhook({
      rawBody: Buffer.from("custom-build-event"),
      signature: "stripe-signature"
    }),
    { status: "custom_build" }
  );
  assert.equal(context.calls.verify.length, 1);
  assert.equal(context.calls.customBuild.length, 1);
  assert.equal(context.calls.download.length, 0);
  assert.equal(context.calls.assessment.length, 0);
  assert.equal(context.calls.customBuildChange.length, 0);
  assert.equal(context.calls.alakazam.length, 0);
  assert.equal(context.calls.canonical.length, 0);
  assert.deepEqual(context.calls.customBuild[0], selected);
});

test("shared webhook router sends only exact Custom-build change metadata to Purpose-1 settlement even while new Checkout creation is held", async () => {
  const selected = event({
    schema: CUSTOM_BUILD_CHANGE_PAYMENT_METADATA_SCHEMA
  });
  const context = fixture(selected);
  assert.deepEqual(
    await context.router.ingestStripeWebhook({
      rawBody: Buffer.from("custom-build-change-event"),
      signature: "stripe-signature"
    }),
    { status: "custom_build_change" }
  );
  assert.equal(context.calls.verify.length, 1);
  assert.equal(context.calls.customBuildChange.length, 1);
  assert.equal(context.calls.customBuild.length, 0);
  assert.equal(context.calls.assessment.length, 0);
  assert.equal(context.calls.download.length, 0);
  assert.equal(context.calls.alakazam.length, 0);
  assert.equal(context.calls.canonical.length, 0);
  assert.deepEqual(
    context.calls.customBuildChange[0],
    selected
  );
});

test("shared webhook router sends only exact Custom-build final metadata to final settlement even while new Checkout creation is held", async () => {
  const selected = event({
    schema: CUSTOM_BUILD_FINAL_PAYMENT_METADATA_SCHEMA
  });
  const context = fixture(selected);
  assert.deepEqual(
    await context.router.ingestStripeWebhook({
      rawBody: Buffer.from("custom-build-final-event"),
      signature: "stripe-signature"
    }),
    { status: "custom_build_final" }
  );
  assert.equal(context.calls.verify.length, 1);
  assert.equal(context.calls.customBuildFinal.length, 1);
  assert.equal(context.calls.customBuildChange.length, 0);
  assert.equal(context.calls.customBuild.length, 0);
  assert.equal(context.calls.assessment.length, 0);
  assert.equal(context.calls.download.length, 0);
  assert.equal(context.calls.alakazam.length, 0);
  assert.equal(context.calls.canonical.length, 0);
  assert.deepEqual(
    context.calls.customBuildFinal[0],
    selected
  );
});

test("nearby payment schemas never enter Custom-build change settlement", async () => {
  for (const schema of [
    "sitesourcery_custom_build_start_checkout_v1",
    "sitesourcery_service_assessment_checkout_v1",
    "sitesourcery_download_checkout_v2",
    ALAKAZAM_PROVIDER_METADATA_SCHEMA,
    CUSTOM_BUILD_FINAL_PAYMENT_METADATA_SCHEMA,
    `${CUSTOM_BUILD_CHANGE_PAYMENT_METADATA_SCHEMA}_drift`
  ]) {
    const context = fixture(event({ schema }));
    await context.router.ingestStripeWebhook({
      rawBody: Buffer.from(schema),
      signature: "stripe-signature"
    });
    assert.equal(
      context.calls.customBuildChange.length,
      0,
      schema
    );
  }
});

test("nearby payment schemas never enter Custom-build final settlement", async () => {
  for (const schema of [
    "sitesourcery_custom_build_start_checkout_v1",
    "sitesourcery_service_assessment_checkout_v1",
    "sitesourcery_download_checkout_v2",
    ALAKAZAM_PROVIDER_METADATA_SCHEMA,
    CUSTOM_BUILD_CHANGE_PAYMENT_METADATA_SCHEMA,
    `${CUSTOM_BUILD_FINAL_PAYMENT_METADATA_SCHEMA}_drift`
  ]) {
    const context = fixture(event({ schema }));
    await context.router.ingestStripeWebhook({
      rawBody: Buffer.from(schema),
      signature: "stripe-signature"
    });
    assert.equal(
      context.calls.customBuildFinal.length,
      0,
      schema
    );
  }
});

test("shared webhook router sends verified Alakazam events to one held runtime branch", async () => {
  const selected = event({
    schema: ALAKAZAM_PROVIDER_METADATA_SCHEMA,
    change_kind: "start"
  });
  const context = fixture(selected);
  assert.deepEqual(
    await context.router.ingestStripeWebhook({
      rawBody: Buffer.from("alakazam-event"),
      signature: "stripe-signature"
    }),
    { status: "alakazam" }
  );
  assert.equal(context.calls.verify.length, 1);
  assert.equal(context.calls.alakazam.length, 1);
  assert.equal(context.calls.download.length, 0);
  assert.equal(context.calls.assessment.length, 0);
  assert.equal(context.calls.customBuildChange.length, 0);
  assert.equal(context.calls.canonical.length, 0);
  assert.deepEqual(context.calls.alakazam[0], selected);
});

test("shared webhook router offers refund and dispute events to Download before canonical commerce", async () => {
  for (const [type, object] of [
    [
      "charge.refunded",
      {
        id: "ch_router_1",
        payment_intent: "pi_router_1"
      }
    ],
    [
      "charge.dispute.created",
      {
        id: "du_router_1",
        payment_intent: "pi_router_1"
      }
    ]
  ]) {
    const selected = {
      ...event(),
      type,
      data: { object }
    };
    const context = fixture(selected, {
      downloadResult: {
        status: "processed",
        entitlementState: "suspended"
      }
    });
    assert.equal(
      (
        await context.router.ingestStripeWebhook({
          rawBody: Buffer.from(type),
          signature: "stripe-signature"
        })
      ).entitlementState,
      "suspended"
    );
    assert.equal(context.calls.download.length, 1);
    assert.equal(context.calls.assessment.length, 0);
    assert.equal(context.calls.customBuildChange.length, 0);
    assert.equal(context.calls.alakazam.length, 0);
    assert.equal(context.calls.canonical.length, 0);
  }
});

test("non-Download reversal continues to canonical commerce", async () => {
  const selected = {
    ...event(),
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_router_other_1",
        payment_intent: "pi_router_other_1"
      }
    }
  };
  const context = fixture(selected, {
    downloadResult: { status: "not_download" }
  });
  assert.deepEqual(
    await context.router.ingestStripeWebhook({
      rawBody: Buffer.from("other-refund"),
      signature: "stripe-signature"
    }),
    { status: "canonical" }
  );
  assert.equal(context.calls.download.length, 1);
  assert.equal(context.calls.assessment.length, 0);
  assert.equal(context.calls.customBuildChange.length, 0);
  assert.equal(context.calls.alakazam.length, 0);
  assert.equal(context.calls.canonical.length, 1);
});

test("shared webhook router preserves canonical Stripe events without double verification", async () => {
  const selected = event({
    schema: "sitesourcery_checkout_v1"
  });
  const context = fixture(selected);
  assert.deepEqual(
    await context.router.ingestStripeWebhook({
      rawBody: Buffer.from("canonical-event"),
      signature: "stripe-signature"
    }),
    { status: "canonical" }
  );
  assert.equal(context.calls.verify.length, 1);
  assert.equal(context.calls.canonical.length, 1);
  assert.equal(context.calls.download.length, 0);
  assert.equal(context.calls.assessment.length, 0);
  assert.equal(context.calls.customBuildChange.length, 0);
  assert.equal(context.calls.alakazam.length, 0);
});

test("shared webhook router rejects missing raw bytes before provider verification", async () => {
  const context = fixture(event());
  await assert.rejects(
    context.router.ingestStripeWebhook({
      rawBody: "not-a-buffer",
      signature: "stripe-signature"
    }),
    (error) =>
      error.code === "STRIPE_WEBHOOK_BODY_REQUIRED"
  );
  assert.equal(context.calls.verify.length, 0);
});
