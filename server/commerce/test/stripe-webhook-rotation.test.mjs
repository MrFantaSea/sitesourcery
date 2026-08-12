import assert from "node:assert/strict";
import test from "node:test";

import {
  STRIPE_WEBHOOK_ROTATION_METADATA_SCHEMA,
  STRIPE_WEBHOOK_ROTATION_SCHEMA,
  composeStripeWebhookRotation,
  exactStripeWebhookVerification,
  stripeWebhookRotationReadiness,
  verifyStripeWebhookWithRotation
} from "../stripe-webhook-rotation.mjs";

const CURRENT_SECRET = "whsec_current-never-log";
const NEXT_SECRET = "whsec_next-never-log";
const RAW_BODY = Buffer.from(
  '{"id":"evt_rotation_1","object":"event"}',
  "utf8"
);
const SIGNATURE = "t=1786464000,v1=contract-signature";
const EVENT = Object.freeze({
  id: "evt_rotation_1",
  type: "invoice.paid"
});

function rotation() {
  return composeStripeWebhookRotation({
    metadata: {
      schema: STRIPE_WEBHOOK_ROTATION_METADATA_SCHEMA,
      current: {
        version: "webhook-2026-08-current",
        activatedAt: "2026-08-10T00:00:00.000Z",
        retiresAt: "2026-08-11T12:10:00.000Z"
      },
      next: {
        version: "webhook-2026-08-next",
        activatedAt: "2026-08-11T12:00:00.000Z",
        retiresAt: null
      },
      overlapSeconds: 600
    },
    currentSecret: CURRENT_SECRET,
    nextSecret: NEXT_SECRET
  });
}

function verifier({
  now = "2026-08-11T12:05:00.000Z",
  accepted = new Set([NEXT_SECRET]),
  selectedRotation = rotation()
} = {}) {
  const calls = [];
  const verification = () =>
    verifyStripeWebhookWithRotation({
      rotation: selectedRotation,
      now,
      rawBody: RAW_BODY,
      signature: SIGNATURE,
      constructEvent(rawBody, signature, secret) {
        calls.push({
          rawBody: Buffer.from(rawBody).toString("utf8"),
          signature,
          secret
        });
        if (!accepted.has(secret)) {
          throw new Error(
            `unsafe ${secret} ${rawBody.toString("utf8")}`
          );
        }
        return EVENT;
      }
    });
  return { calls, verification };
}

test("rotation metadata composes exact slots without exposing secrets in readiness", () => {
  const selected = rotation();
  assert.equal(selected.schema, STRIPE_WEBHOOK_ROTATION_SCHEMA);
  const before = stripeWebhookRotationReadiness(
    selected,
    "2026-08-11T11:59:59.999Z"
  );
  assert.deepEqual(
    {
      ready: before.ready,
      state: before.state,
      activeKeyCount: before.activeKeyCount,
      nextConfigured: before.nextConfigured,
      overlapSeconds: before.overlapSeconds
    },
    {
      ready: true,
      state: "current_only",
      activeKeyCount: 1,
      nextConfigured: true,
      overlapSeconds: 600
    }
  );
  const overlap = stripeWebhookRotationReadiness(
    selected,
    "2026-08-11T12:05:00.000Z"
  );
  assert.equal(overlap.state, "overlap");
  assert.equal(overlap.activeKeyCount, 2);
  assert.match(overlap.currentFingerprint, /^[a-f0-9]{64}$/u);
  assert.match(overlap.nextFingerprint, /^[a-f0-9]{64}$/u);
  assert.notEqual(
    overlap.currentFingerprint,
    overlap.nextFingerprint
  );
  assert.doesNotMatch(
    JSON.stringify(overlap),
    /whsec_|never-log/u
  );
  const after = stripeWebhookRotationReadiness(
    selected,
    "2026-08-11T12:10:00.000Z"
  );
  assert.deepEqual(
    {
      ready: after.ready,
      state: after.state,
      activeKeyCount: after.activeKeyCount
    },
    {
      ready: false,
      state: "promotion_required",
      activeKeyCount: 1
    }
  );
});

test("verification binds the event to the one matching non-secret key receipt", () => {
  const { calls, verification } = verifier();
  const result = verification();
  assert.deepEqual(
    calls.map(({ secret }) => secret),
    [CURRENT_SECRET, NEXT_SECRET]
  );
  assert.equal(result.event, EVENT);
  assert.equal(
    result.receipt.keyVersion,
    "webhook-2026-08-next"
  );
  assert.equal(result.receipt.eventId, EVENT.id);
  assert.equal(result.receipt.eventType, EVENT.type);
  for (const field of [
    "keyFingerprint",
    "rawBodyDigest",
    "signatureDigest",
    "receiptDigest"
  ]) {
    assert.match(result.receipt[field], /^[a-f0-9]{64}$/u);
  }
  assert.doesNotMatch(
    JSON.stringify(result.receipt),
    /whsec_|never-log|contract-signature|evt_rotation_1.*object/u
  );
  assert.equal(
    exactStripeWebhookVerification(result, {
      rawBody: RAW_BODY,
      signature: SIGNATURE
    }).event,
    EVENT
  );
  assert.throws(
    () =>
      exactStripeWebhookVerification(result, {
        rawBody: Buffer.from("{}"),
        signature: SIGNATURE
      }),
    (error) =>
      error.code === "stripe_webhook_verification_invalid"
  );
});

test("wrong and retired keys fail closed without secret, signature, or body disclosure", () => {
  const wrong = verifier({ accepted: new Set() });
  assert.throws(wrong.verification, (error) => {
    assert.equal(
      error.code,
      "stripe_webhook_signature_invalid"
    );
    assert.doesNotMatch(
      JSON.stringify(error),
      /whsec_|never-log|contract-signature|evt_rotation_1/u
    );
    return true;
  });

  const retired = verifier({
    now: "2026-08-11T12:10:00.000Z",
    accepted: new Set([CURRENT_SECRET])
  });
  assert.throws(
    retired.verification,
    (error) =>
      error.code === "stripe_webhook_signature_invalid"
  );
  assert.deepEqual(
    retired.calls.map(({ secret }) => secret),
    [NEXT_SECRET]
  );

  const premature = verifier({
    now: "2026-08-11T11:59:59.999Z",
    accepted: new Set([NEXT_SECRET])
  });
  assert.throws(
    premature.verification,
    (error) =>
      error.code === "stripe_webhook_signature_invalid"
  );
  assert.deepEqual(
    premature.calls.map(({ secret }) => secret),
    [CURRENT_SECRET]
  );
});

test("duplicate delivery receipts are deterministic and multi-key matches are ambiguous", () => {
  const repeated = verifier();
  assert.deepEqual(
    repeated.verification(),
    repeated.verification()
  );
  const ambiguous = verifier({
    accepted: new Set([CURRENT_SECRET, NEXT_SECRET])
  });
  assert.throws(
    ambiguous.verification,
    (error) =>
      error.code ===
      "stripe_webhook_signature_ambiguous"
  );
});

test("rotation chronology, bounded overlap, and secret-slot pairing are exact", () => {
  const base = {
    schema: STRIPE_WEBHOOK_ROTATION_METADATA_SCHEMA,
    current: {
      version: "current",
      activatedAt: "2026-08-10T00:00:00.000Z",
      retiresAt: "2026-08-11T12:01:00.000Z"
    },
    next: {
      version: "next",
      activatedAt: "2026-08-11T12:00:00.000Z",
      retiresAt: null
    },
    overlapSeconds: 60
  };
  for (const candidate of [
    { metadata: base, nextSecret: NEXT_SECRET },
    {
      metadata: { ...base, overlapSeconds: 600 },
      nextSecret: NEXT_SECRET
    },
    {
      metadata: {
        ...base,
        next: null,
        overlapSeconds: 0,
        current: { ...base.current, retiresAt: null }
      },
      nextSecret: NEXT_SECRET
    },
    {
      metadata: {
        ...base,
        current: {
          ...base.current,
          retiresAt: "2026-08-11T12:10:00.000Z"
        },
        next: {
          ...base.next,
          version: base.current.version
        },
        overlapSeconds: 600
      },
      nextSecret: NEXT_SECRET
    },
    {
      metadata: {
        ...base,
        current: {
          ...base.current,
          retiresAt: "2026-08-11T12:10:00.000Z"
        },
        overlapSeconds: 600
      },
      nextSecret: CURRENT_SECRET
    }
  ]) {
    assert.throws(
      () =>
        composeStripeWebhookRotation({
          metadata: candidate.metadata,
          currentSecret: CURRENT_SECRET,
          nextSecret: candidate.nextSecret
        }),
      (error) =>
        error.code === "stripe_webhook_rotation_invalid"
    );
  }
});
