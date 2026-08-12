import {
  createHmac,
  timingSafeEqual
} from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;
const PROVIDER = "resend";
const SAFE_PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const TERMINAL_EVENTS = new Map([
  ["email.delivered", "delivered"],
  ["email.bounced", "bounced"],
  // Resend's generic permanent delivery failure has the same durable
  // lifecycle consequences as a bounce: terminal failure + owner exception,
  // without the complaint/suppression authority of a complaint event.
  ["email.failed", "bounced"],
  ["email.complained", "complained"],
  ["email.suppressed", "suppressed"]
]);

function invalid(message = "The Resend webhook is invalid.") {
  return new HostedError("RESEND_WEBHOOK_INVALID", message, {
    status: 400,
    details: { providerEffects: false }
  });
}

function held() {
  return new HostedError(
    "RESEND_WEBHOOK_HELD",
    "Resend provider-event ingestion is held.",
    { status: 503, details: { providerEffects: false } }
  );
}

function currentTime(clock) {
  const value = typeof clock === "function" ? clock() : clock?.now?.();
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "RESEND_WEBHOOK_CONFIGURATION_REQUIRED",
    "The Resend webhook clock is invalid.",
    { status: 500 }
  );
  return value;
}

function header(headers, name) {
  let value;
  if (headers && typeof headers.get === "function") {
    value = headers.get(name);
  } else if (
    headers !== null &&
    typeof headers === "object" &&
    !Array.isArray(headers)
  ) {
    const selected = Object.keys(headers).filter(
      (key) => key.toLowerCase() === name
    );
    if (selected.length !== 1) throw invalid();
    value = headers[selected[0]];
  }
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    throw invalid();
  }
  return value;
}

function signingKey(signingSecret) {
  invariant(
    typeof signingSecret === "string" &&
      signingSecret.startsWith("whsec_") &&
      signingSecret.length <= 200,
    "RESEND_WEBHOOK_CONFIGURATION_REQUIRED",
    "A valid Resend webhook signing secret is required.",
    { status: 500 }
  );
  const encoded = signingSecret.slice("whsec_".length);
  invariant(
    /^[A-Za-z0-9+/]+={0,2}$/u.test(encoded),
    "RESEND_WEBHOOK_CONFIGURATION_REQUIRED",
    "A valid Resend webhook signing secret is required.",
    { status: 500 }
  );
  const unpadded = encoded.replace(/=+$/u, "");
  let key;
  try {
    key = Buffer.from(
      `${unpadded}${"=".repeat((4 - (unpadded.length % 4)) % 4)}`,
      "base64"
    );
  } catch {
    key = Buffer.alloc(0);
  }
  invariant(
    key.length >= 16 &&
      key.length <= 64 &&
      key.toString("base64").replace(/=+$/u, "") === unpadded,
    "RESEND_WEBHOOK_CONFIGURATION_REQUIRED",
    "A valid Resend webhook signing secret is required.",
    { status: 500 }
  );
  return key;
}

function signatures(value) {
  const selected = value.trim().split(/\s+/u);
  if (selected.length < 1 || selected.length > 8) throw invalid();
  return selected.map((entry) => {
    const match = /^v1,([A-Za-z0-9+/]+={0,2})$/u.exec(entry);
    if (!match) throw invalid();
    const encoded = match[1];
    let bytes;
    try {
      bytes = Buffer.from(encoded, "base64");
    } catch {
      bytes = Buffer.alloc(0);
    }
    if (
      bytes.length !== 32 ||
      bytes.toString("base64").replace(/=+$/u, "") !==
        encoded.replace(/=+$/u, "")
    ) {
      throw invalid();
    }
    return bytes;
  });
}

function verify({ rawBody, headers, key, now }) {
  if (
    !Buffer.isBuffer(rawBody) ||
    rawBody.length === 0 ||
    rawBody.length > MAX_BODY_BYTES
  ) {
    throw invalid("The Resend webhook requires bounded raw request bytes.");
  }
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(
    header(headers, "content-type").trim()
  )) {
    throw invalid();
  }
  const webhookId = header(headers, "svix-id");
  if (!SAFE_PROVIDER_ID.test(webhookId)) throw invalid();
  const timestamp = header(headers, "svix-timestamp");
  if (!/^[0-9]{1,12}$/u.test(timestamp)) throw invalid();
  const seconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.parse(now) / 1000);
  if (
    !Number.isSafeInteger(seconds) ||
    Math.abs(nowSeconds - seconds) > MAX_SIGNATURE_AGE_SECONDS
  ) {
    throw invalid("The Resend webhook timestamp is outside the accepted window.");
  }
  const candidates = signatures(header(headers, "svix-signature"));
  const expected = createHmac("sha256", key)
    .update(Buffer.from(`${webhookId}.${timestamp}.`, "utf8"))
    .update(rawBody)
    .digest();
  let verified = false;
  let matched = null;
  for (const candidate of candidates) {
    if (timingSafeEqual(expected, candidate)) {
      verified = true;
      matched = candidate;
    }
  }
  if (!verified || matched === null) {
    throw new HostedError(
      "RESEND_WEBHOOK_SIGNATURE_INVALID",
      "Resend webhook signature verification failed.",
      { status: 400, details: { providerEffects: false } }
    );
  }
  return deepFreeze({
    webhookIdDigest: digest(webhookId),
    signatureTimestamp: timestamp,
    signatureDigest: digest(matched),
    rawBodyDigest: digest(rawBody)
  });
}

function payload(rawBody, now) {
  let text;
  let selected;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
    selected = JSON.parse(text);
  } catch {
    throw invalid("The Resend webhook body is not valid UTF-8 JSON.");
  }
  if (
    selected === null ||
    typeof selected !== "object" ||
    Array.isArray(selected) ||
    Object.getPrototypeOf(selected) !== Object.prototype ||
    typeof selected.type !== "string" ||
    selected.type.length > 80 ||
    typeof selected.created_at !== "string" ||
    selected.data === null ||
    typeof selected.data !== "object" ||
    Array.isArray(selected.data) ||
    Object.getPrototypeOf(selected.data) !== Object.prototype
  ) {
    throw invalid();
  }
  const occurredMilliseconds = Date.parse(selected.created_at);
  if (
    !Number.isFinite(occurredMilliseconds) ||
    occurredMilliseconds > Date.parse(now)
  ) {
    throw invalid("The Resend webhook event time is invalid.");
  }
  const occurredAt = new Date(occurredMilliseconds).toISOString();
  const eventKind = TERMINAL_EVENTS.get(selected.type) ?? null;
  if (eventKind === null) {
    throw invalid("The Resend webhook event type is not authorized.");
  }
  const providerMessageId = selected.data.email_id;
  if (
    typeof providerMessageId !== "string" ||
    !SAFE_PROVIDER_ID.test(providerMessageId)
  ) {
    throw invalid();
  }
  return deepFreeze({
    ignored: false,
    providerType: selected.type,
    providerMessageIdDigest: digest(providerMessageId),
    eventKind,
    occurredAt
  });
}

function lifecycleBoundary(value) {
  invariant(
    value &&
      value.providerEffects === false &&
      typeof value.readiness === "function" &&
      typeof value.ingestProviderEvent === "function",
    "RESEND_WEBHOOK_CONFIGURATION_REQUIRED",
    "A held durable mail lifecycle is required for Resend events.",
    { status: 500 }
  );
  return value;
}

export function createHeldResendMailEventWebhook() {
  return Object.freeze({
    kind: "resend-mail-event-webhook",
    mode: "held",
    providerEffects: false,
    async readiness() {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "resend-mail-event-webhook",
        mode: "held",
        providerEffects: false,
        code: "RESEND_WEBHOOK_HELD"
      });
    },
    async ingest() { throw held(); }
  });
}

export function createResendMailEventWebhook({
  signingSecret,
  lifecycle,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const key = signingKey(signingSecret);
  const durable = lifecycleBoundary(lifecycle);
  return Object.freeze({
    kind: "resend-mail-event-webhook",
    mode: "verified-held-ingress",
    providerEffects: false,
    async readiness() {
      const status = typeof durable.readiness === "function"
        ? await durable.readiness()
        : { ready: true, verified: true };
      const ready = status?.ready === true && status?.verified === true;
      return deepFreeze({
        ready,
        verified: ready,
        kind: "resend-mail-event-webhook",
        mode: "verified-held-ingress",
        providerEffects: false,
        code: ready ? null : status?.code ?? "MAIL_LIFECYCLE_NOT_READY"
      });
    },
    async ingest({ rawBody, headers } = {}) {
      const now = currentTime(clock);
      const proof = verify({ rawBody, headers, key, now });
      const event = payload(rawBody, now);
      const signatureVerificationDigest = digest({
        schema: "sitesourcery.resend-signature-verification/v1",
        provider: PROVIDER,
        webhookIdDigest: proof.webhookIdDigest,
        signatureTimestamp: proof.signatureTimestamp,
        signatureDigest: proof.signatureDigest,
        rawBodyDigest: proof.rawBodyDigest
      });
      const evidenceDigest = digest({
        schema: "sitesourcery.resend-mail-event-evidence/v1",
        provider: PROVIDER,
        providerType: event.providerType,
        webhookIdDigest: proof.webhookIdDigest,
        providerMessageIdDigest: event.providerMessageIdDigest,
        eventKind: event.eventKind,
        occurredAt: event.occurredAt,
        rawBodyDigest: proof.rawBodyDigest
      });
      const receipt = await durable.ingestProviderEvent({
        provider: PROVIDER,
        providerEventIdDigest: proof.webhookIdDigest,
        providerMessageIdDigest: event.providerMessageIdDigest,
        eventKind: event.eventKind,
        signatureVerificationDigest,
        evidenceDigest,
        occurredAt: event.occurredAt
      });
      invariant(
        receipt !== null &&
          typeof receipt === "object" &&
          ["applied", "pending", "conflict"].includes(receipt.eventState) &&
          receipt.eventKind === event.eventKind &&
          (receipt.currentState === null ||
            [
              "pending",
              "expired",
              "provider_accepted",
              "delivered",
              "bounced",
              "complained",
              "suppressed"
            ].includes(receipt.currentState)),
        "RESEND_WEBHOOK_DURABLE_RECEIPT_INVALID",
        "The durable mail lifecycle did not accept the Resend event.",
        { status: 503, details: { providerEffects: false } }
      );
      return deepFreeze({
        schema: "sitesourcery.resend-mail-event-receipt/v1",
        httpStatus: 200,
        eventState: receipt.eventState,
        eventKind: event.eventKind,
        currentState: receipt.currentState,
        providerEffects: false
      });
    }
  });
}
