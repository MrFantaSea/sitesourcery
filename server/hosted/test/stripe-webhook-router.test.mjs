import assert from "node:assert/strict";
import test from "node:test";

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
  { downloadResult = { status: "download" } } = {}
) {
  const calls = {
    verify: [],
    canonical: [],
    download: []
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
  assert.equal(context.calls.canonical.length, 0);
  assert.deepEqual(context.calls.download[0], selected);
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
