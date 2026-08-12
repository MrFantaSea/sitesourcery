import { createHash } from "node:crypto";

import { invariant } from "../domain/errors.mjs";

export const STRIPE_WEBHOOK_ROTATION_SCHEMA =
  "sitesourcery.stripe-webhook-rotation/v1";
export const STRIPE_WEBHOOK_ROTATION_METADATA_SCHEMA =
  "sitesourcery.stripe-webhook-rotation-metadata/v1";
export const STRIPE_WEBHOOK_ROTATION_READINESS_SCHEMA =
  "sitesourcery.stripe-webhook-rotation-readiness/v1";
export const STRIPE_WEBHOOK_VERIFICATION_SCHEMA =
  "sitesourcery.stripe-webhook-verification/v1";
export const STRIPE_WEBHOOK_RECEIPT_SCHEMA =
  "sitesourcery.stripe-webhook-receipt/v1";

const VERSION = /^[A-Za-z0-9._:-]{1,100}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const MINIMUM_OVERLAP_SECONDS = 300;
const MAXIMUM_OVERLAP_SECONDS = 86_400;

function hash(...parts) {
  const value = createHash("sha256");
  for (const part of parts) {
    value.update(part);
    value.update("\0");
  }
  return value.digest("hex");
}

function exactObject(
  value,
  fields,
  code,
  status = 500
) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...fields].sort()),
    code,
    "Stripe webhook rotation configuration is invalid",
    { status }
  );
  return value;
}

function timestamp(value, field, nullable = false) {
  if (nullable && value === null) return null;
  const parsed =
    typeof value === "string" ? Date.parse(value) : NaN;
  invariant(
    typeof value === "string" &&
      Number.isFinite(parsed) &&
      new Date(parsed).toISOString() === value,
    "stripe_webhook_rotation_invalid",
    `Stripe webhook rotation ${field} is invalid`,
    { status: 500 }
  );
  return value;
}

function secret(value) {
  invariant(
    typeof value === "string" &&
      value.startsWith("whsec_") &&
      value.length <= 500,
    "stripe_webhook_rotation_invalid",
    "Stripe webhook rotation secret is invalid",
    { status: 500 }
  );
  return value;
}

function slot(value, name) {
  const suppliedFingerprint =
    Object.prototype.hasOwnProperty.call(
      value ?? {},
      "fingerprint"
    );
  exactObject(
    value,
    [
      "activatedAt",
      ...(suppliedFingerprint ? ["fingerprint"] : []),
      "retiresAt",
      "secret",
      "version"
    ],
    "stripe_webhook_rotation_invalid"
  );
  invariant(
    VERSION.test(value.version),
    "stripe_webhook_rotation_invalid",
    `Stripe webhook rotation ${name} version is invalid`,
    { status: 500 }
  );
  const selectedSecret = secret(value.secret);
  const selectedFingerprint = hash(
    "sitesourcery:stripe-webhook-key:v1",
    value.version,
    selectedSecret
  );
  invariant(
    !suppliedFingerprint ||
      value.fingerprint === selectedFingerprint,
    "stripe_webhook_rotation_invalid",
    `Stripe webhook rotation ${name} fingerprint is invalid`,
    { status: 500 }
  );
  return Object.freeze({
    version: value.version,
    secret: selectedSecret,
    fingerprint: selectedFingerprint,
    activatedAt: timestamp(
      value.activatedAt,
      `${name}.activatedAt`
    ),
    retiresAt: timestamp(
      value.retiresAt,
      `${name}.retiresAt`,
      true
    )
  });
}

export function normalizeStripeWebhookRotation(value) {
  exactObject(
    value,
    ["current", "next", "overlapSeconds", "schema"],
    "stripe_webhook_rotation_invalid"
  );
  invariant(
    value.schema === STRIPE_WEBHOOK_ROTATION_SCHEMA &&
      Number.isSafeInteger(value.overlapSeconds) &&
      value.overlapSeconds >= 0,
    "stripe_webhook_rotation_invalid",
    "Stripe webhook rotation contract is invalid",
    { status: 500 }
  );
  const current = slot(value.current, "current");
  if (value.next === null) {
    invariant(
      current.retiresAt === null &&
        value.overlapSeconds === 0,
      "stripe_webhook_rotation_invalid",
      "A sole Stripe webhook key cannot have a pending retirement",
      { status: 500 }
    );
    return Object.freeze({
      schema: STRIPE_WEBHOOK_ROTATION_SCHEMA,
      current,
      next: null,
      overlapSeconds: 0
    });
  }
  const next = slot(value.next, "next");
  const currentActivated = Date.parse(current.activatedAt);
  const nextActivated = Date.parse(next.activatedAt);
  const currentRetires = Date.parse(current.retiresAt);
  const exactOverlap =
    (currentRetires - nextActivated) / 1000;
  invariant(
    current.retiresAt !== null &&
      next.retiresAt === null &&
      currentActivated < nextActivated &&
      nextActivated < currentRetires &&
      Number.isSafeInteger(exactOverlap) &&
      exactOverlap === value.overlapSeconds &&
      exactOverlap >= MINIMUM_OVERLAP_SECONDS &&
      exactOverlap <= MAXIMUM_OVERLAP_SECONDS &&
      current.version !== next.version &&
      current.secret !== next.secret &&
      current.fingerprint !== next.fingerprint,
    "stripe_webhook_rotation_invalid",
    "Stripe webhook key chronology or overlap is invalid",
    { status: 500 }
  );
  return Object.freeze({
    schema: STRIPE_WEBHOOK_ROTATION_SCHEMA,
    current,
    next,
    overlapSeconds: exactOverlap
  });
}

export function composeStripeWebhookRotation({
  metadata,
  currentSecret,
  nextSecret = null
} = {}) {
  exactObject(
    metadata,
    ["current", "next", "overlapSeconds", "schema"],
    "stripe_webhook_rotation_invalid"
  );
  invariant(
    metadata.schema ===
      STRIPE_WEBHOOK_ROTATION_METADATA_SCHEMA,
    "stripe_webhook_rotation_invalid",
    "Stripe webhook rotation metadata schema is invalid",
    { status: 500 }
  );
  const metadataSlot = (value, name) => {
    exactObject(
      value,
      ["activatedAt", "retiresAt", "version"],
      "stripe_webhook_rotation_invalid"
    );
    return {
      ...value,
      secret: name === "current"
        ? currentSecret
        : nextSecret
    };
  };
  invariant(
    (metadata.next === null && nextSecret === null) ||
      (metadata.next !== null && nextSecret !== null),
    "stripe_webhook_rotation_invalid",
    "Stripe webhook next-key metadata and secret must be configured together",
    { status: 500 }
  );
  return normalizeStripeWebhookRotation({
    schema: STRIPE_WEBHOOK_ROTATION_SCHEMA,
    current: metadataSlot(metadata.current, "current"),
    next:
      metadata.next === null
        ? null
        : metadataSlot(metadata.next, "next"),
    overlapSeconds: metadata.overlapSeconds
  });
}

function active(slotValue, nowMs) {
  return Date.parse(slotValue.activatedAt) <= nowMs &&
    (slotValue.retiresAt === null ||
      nowMs < Date.parse(slotValue.retiresAt));
}

function rotationFacts(rotation, now) {
  const normalized = normalizeStripeWebhookRotation(rotation);
  const nowMs = Date.parse(now);
  invariant(
    Number.isFinite(nowMs) && new Date(nowMs).toISOString() === now,
    "stripe_webhook_clock_invalid",
    "Stripe webhook verifier clock is invalid",
    { status: 500 }
  );
  const currentActive = active(normalized.current, nowMs);
  const nextActive =
    normalized.next !== null && active(normalized.next, nowMs);
  const state = currentActive && nextActive
    ? "overlap"
    : currentActive
      ? "current_only"
      : nextActive
        ? "promotion_required"
        : "inactive";
  return {
    rotation: normalized,
    activeSlots: [
      ...(currentActive ? [normalized.current] : []),
      ...(nextActive ? [normalized.next] : [])
    ],
    state
  };
}

export function stripeWebhookRotationReadiness(
  rotation,
  now
) {
  const facts = rotationFacts(rotation, now);
  return Object.freeze({
    schema: STRIPE_WEBHOOK_ROTATION_READINESS_SCHEMA,
    ready:
      facts.state === "current_only" ||
      facts.state === "overlap",
    state: facts.state,
    activeKeyCount: facts.activeSlots.length,
    currentVersion: facts.rotation.current.version,
    currentFingerprint:
      facts.rotation.current.fingerprint,
    nextConfigured: facts.rotation.next !== null,
    nextVersion: facts.rotation.next?.version ?? null,
    nextFingerprint:
      facts.rotation.next?.fingerprint ?? null,
    overlapSeconds: facts.rotation.overlapSeconds
  });
}

function receiptDigest(receipt) {
  return hash(
    "sitesourcery:stripe-webhook-receipt:v1",
    JSON.stringify(receipt)
  );
}

export function verifyStripeWebhookWithRotation({
  rotation,
  now,
  constructEvent,
  rawBody,
  signature
} = {}) {
  invariant(
    Buffer.isBuffer(rawBody) || typeof rawBody === "string",
    "stripe_webhook_body_required",
    "Stripe webhook verification requires the exact raw body",
    { status: 400 }
  );
  invariant(
    typeof signature === "string" &&
      signature.length > 0 &&
      signature.length <= 4000,
    "stripe_webhook_signature_required",
    "Stripe-Signature is required",
    { status: 400 }
  );
  invariant(
    typeof constructEvent === "function",
    "stripe_webhook_verifier_invalid",
    "Stripe webhook verifier is unavailable",
    { status: 503 }
  );
  const facts = rotationFacts(rotation, now);
  invariant(
    facts.activeSlots.length > 0,
    "stripe_webhook_rotation_inactive",
    "Stripe webhook verification has no active key",
    { status: 503 }
  );
  const matches = [];
  for (const selected of facts.activeSlots) {
    try {
      matches.push({
        selected,
        event: constructEvent(
          rawBody,
          signature,
          selected.secret
        )
      });
    } catch {
      // Provider verification errors are deliberately collapsed below.
    }
  }
  invariant(
    matches.length > 0,
    "stripe_webhook_signature_invalid",
    "Stripe webhook signature is invalid",
    { status: 400 }
  );
  invariant(
    matches.length === 1,
    "stripe_webhook_signature_ambiguous",
    "Stripe webhook signature matched more than one active key",
    { status: 400 }
  );
  const [{ selected, event }] = matches;
  invariant(
    event &&
      typeof event.id === "string" &&
      typeof event.type === "string",
    "stripe_webhook_event_invalid",
    "Stripe webhook event is invalid",
    { status: 400 }
  );
  const rawBytes = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(rawBody, "utf8");
  const publicReceipt = Object.freeze({
    schema: STRIPE_WEBHOOK_RECEIPT_SCHEMA,
    eventId: event.id,
    eventType: event.type,
    keyVersion: selected.version,
    keyFingerprint: selected.fingerprint,
    rawBodyDigest: hash(
      "sitesourcery:stripe-webhook-body:v1",
      rawBytes
    ),
    signatureDigest: hash(
      "sitesourcery:stripe-webhook-signature:v1",
      signature
    ),
    verifiedAt: now
  });
  return Object.freeze({
    schema: STRIPE_WEBHOOK_VERIFICATION_SCHEMA,
    event,
    receipt: Object.freeze({
      ...publicReceipt,
      receiptDigest: receiptDigest(publicReceipt)
    })
  });
}

export function exactStripeWebhookVerification(
  value,
  { rawBody, signature, allowLegacyEvent = true } = {}
) {
  if (value?.schema !== STRIPE_WEBHOOK_VERIFICATION_SCHEMA) {
    invariant(
      allowLegacyEvent &&
        value &&
        typeof value.id === "string" &&
        typeof value.type === "string",
      "stripe_webhook_verification_invalid",
      "Stripe webhook verification receipt is invalid",
      { status: 400 }
    );
    return Object.freeze({ event: value, receipt: null });
  }
  exactObject(
    value,
    ["event", "receipt", "schema"],
    "stripe_webhook_verification_invalid",
    400
  );
  const receipt = exactObject(
    value.receipt,
    [
      "eventId",
      "eventType",
      "keyFingerprint",
      "keyVersion",
      "rawBodyDigest",
      "receiptDigest",
      "schema",
      "signatureDigest",
      "verifiedAt"
    ],
    "stripe_webhook_verification_invalid",
    400
  );
  const { receiptDigest: suppliedDigest, ...publicReceipt } =
    receipt;
  const rawBytes = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(rawBody ?? "", "utf8");
  invariant(
    receipt.schema === STRIPE_WEBHOOK_RECEIPT_SCHEMA &&
      value.event?.id === receipt.eventId &&
      value.event?.type === receipt.eventType &&
      VERSION.test(receipt.keyVersion) &&
      DIGEST.test(receipt.keyFingerprint) &&
      DIGEST.test(receipt.rawBodyDigest) &&
      DIGEST.test(receipt.signatureDigest) &&
      DIGEST.test(suppliedDigest) &&
      receipt.rawBodyDigest === hash(
        "sitesourcery:stripe-webhook-body:v1",
        rawBytes
      ) &&
      receipt.signatureDigest === hash(
        "sitesourcery:stripe-webhook-signature:v1",
        signature ?? ""
      ) &&
      suppliedDigest === receiptDigest(publicReceipt),
    "stripe_webhook_verification_invalid",
    "Stripe webhook verification receipt is invalid",
    { status: 400 }
  );
  return Object.freeze({
    event: value.event,
    receipt: Object.freeze({ ...receipt })
  });
}
