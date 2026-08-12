import twilio from "twilio";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const PROVIDER = "twilio";
const MAXIMUM_BYTES = 32 * 1024;
const MAXIMUM_FIELDS = 128;
const MAXIMUM_VALUES = 256;
const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/u;
const MESSAGE_SID = /^(?:SM|MM)[0-9a-fA-F]{32}$/u;
const PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_]{0,99}$/u;
const STATUSES = new Set([
  "queued", "sending", "sent", "delivered",
  "undelivered", "failed", "canceled"
]);

function invalid(message = "The Twilio Responder callback is invalid.") {
  return new HostedError("TWILIO_RESPONDER_EVENT_INVALID", message, {
    status: 400,
    details: { providerEffects: false }
  });
}

function configuration(message) {
  return new HostedError(
    "TWILIO_RESPONDER_EVENT_CONFIGURATION_REQUIRED",
    message,
    { status: 500, details: { providerEffects: false } }
  );
}

function header(headers, selectedName) {
  let selected;
  if (headers && typeof headers.get === "function") {
    selected = headers.get(selectedName);
  } else if (
    headers && typeof headers === "object" && !Array.isArray(headers)
  ) {
    const matching = Object.keys(headers).filter(
      (name) => name.toLowerCase() === selectedName
    );
    if (matching.length !== 1) throw invalid();
    selected = headers[matching[0]];
  }
  if (
    typeof selected !== "string" || selected.length < 1 ||
    selected.length > 2048 || /[\r\n]/u.test(selected)
  ) {
    throw invalid();
  }
  return selected;
}

function exactCallbackUrl(value) {
  let selected;
  try {
    selected = new URL(value);
  } catch {
    selected = null;
  }
  if (
    !selected || selected.href !==
      "https://sitesourcery.com/api/v1/provider-events/twilio"
  ) {
    throw configuration(
      "The exact production Twilio callback URL is required."
    );
  }
  return selected.href;
}

function exactAccountSid(value) {
  if (typeof value !== "string" || !ACCOUNT_SID.test(value)) {
    throw configuration("The Twilio account SID is invalid.");
  }
  return value;
}

function authToken(value) {
  if (
    typeof value !== "string" || value.length < 32 || value.length > 128 ||
    !/^[A-Za-z0-9]+$/u.test(value)
  ) {
    throw configuration("The Twilio webhook Auth Token is invalid.");
  }
  return value;
}

function currentTime(clock) {
  const value = clock?.now?.();
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "TWILIO_RESPONDER_EVENT_CONFIGURATION_REQUIRED",
    "The Twilio Responder callback clock is invalid.",
    { status: 500 }
  );
  return value;
}

function parsedForm(rawBody) {
  if (
    !Buffer.isBuffer(rawBody) || rawBody.length < 1 ||
    rawBody.length > MAXIMUM_BYTES
  ) {
    throw invalid("The Twilio callback requires bounded raw request bytes.");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
  } catch {
    throw invalid("The Twilio callback is not valid UTF-8.");
  }
  const search = new URLSearchParams(text);
  const entries = [...search.entries()];
  if (
    entries.length < 1 || entries.length > MAXIMUM_VALUES ||
    new Set(entries.map(([name]) => name)).size > MAXIMUM_FIELDS
  ) {
    throw invalid();
  }
  const params = Object.create(null);
  for (const [name, value] of entries) {
    if (
      !PARAMETER_NAME.test(name) || value.length > 4096 ||
      value.includes("\u0000") || value.includes("\ufffd")
    ) {
      throw invalid();
    }
    if (!Object.hasOwn(params, name)) params[name] = value;
    else if (Array.isArray(params[name])) params[name].push(value);
    else params[name] = [params[name], value];
  }
  return { params, entries };
}

function one(params, name, { optional = false } = {}) {
  const value = params[name];
  if (value === undefined && optional) return null;
  if (value === "" && optional) return null;
  if (typeof value !== "string" || value.length < 1) throw invalid();
  return value;
}

function repositoryBoundary(value) {
  invariant(
    value?.kind === "twilio-responder-events-postgres" &&
      value.providerEffects === false &&
      typeof value.readiness === "function" &&
      typeof value.ingestDeliveryStatus === "function",
    "TWILIO_RESPONDER_EVENT_CONFIGURATION_REQUIRED",
    "Twilio Responder callbacks require the exact durable repository.",
    { status: 500 }
  );
  return value;
}

export function createHeldTwilioResponderEvents() {
  return Object.freeze({
    kind: "twilio-responder-events",
    mode: "held",
    providerEffects: false,
    async readiness() {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "twilio-responder-events",
        mode: "held",
        providerEffects: false,
        code: "TWILIO_RESPONDER_EVENTS_HELD"
      });
    },
    async ingest() {
      throw new HostedError(
        "TWILIO_RESPONDER_EVENTS_HELD",
        "Twilio Responder callback ingestion is held.",
        { status: 503, details: { providerEffects: false } }
      );
    }
  });
}

export function createTwilioResponderEvents({
  accountSid,
  callbackUrl,
  webhookAuthToken,
  repository,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const selectedAccountSid = exactAccountSid(accountSid);
  const selectedCallbackUrl = exactCallbackUrl(callbackUrl);
  const selectedAuthToken = authToken(webhookAuthToken);
  const durable = repositoryBoundary(repository);
  invariant(
    typeof twilio?.validateRequest === "function" &&
      typeof clock?.now === "function",
    "TWILIO_RESPONDER_EVENT_CONFIGURATION_REQUIRED",
    "The official Twilio validator and callback clock are required.",
    { status: 500 }
  );

  return Object.freeze({
    kind: "twilio-responder-events",
    mode: "verified-status-callback",
    providerEffects: false,
    async readiness() {
      const storage = await durable.readiness();
      const ready = storage?.ready === true && storage?.verified === true;
      return deepFreeze({
        ready,
        verified: ready,
        kind: "twilio-responder-events",
        mode: "verified-status-callback",
        providerEffects: false,
        code: ready ? null : storage?.code ??
          "TWILIO_RESPONDER_EVENT_STORAGE_NOT_READY"
      });
    },
    async ingest({ rawBody, headers } = {}) {
      if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/iu
        .test(header(headers, "content-type").trim())) {
        throw invalid();
      }
      const signature = header(headers, "x-twilio-signature");
      if (!/^[A-Za-z0-9+/]{27}=$/u.test(signature)) throw invalid();
      const { params } = parsedForm(rawBody);
      if (!twilio.validateRequest(
        selectedAuthToken,
        signature,
        selectedCallbackUrl,
        params
      )) {
        throw new HostedError(
          "TWILIO_RESPONDER_EVENT_SIGNATURE_INVALID",
          "Twilio Responder callback signature verification failed.",
          { status: 400, details: { providerEffects: false } }
        );
      }

      const receivedAt = currentTime(clock);
      const callbackAccountSid = one(params, "AccountSid");
      const messageSid = one(params, "MessageSid");
      const messageStatus = one(params, "MessageStatus");
      const smsSid = one(params, "SmsSid", { optional: true });
      const smsStatus = one(params, "SmsStatus", { optional: true });
      const errorCode = one(params, "ErrorCode", { optional: true });
      if (
        callbackAccountSid !== selectedAccountSid ||
        !MESSAGE_SID.test(messageSid) || !STATUSES.has(messageStatus) ||
        (smsSid !== null && smsSid !== messageSid) ||
        (smsStatus !== null && smsStatus !== messageStatus) ||
        (errorCode !== null && !/^[0-9]{3,7}$/u.test(errorCode))
      ) {
        throw invalid();
      }

      const providerMessageIdDigest = digest(messageSid);
      const accountSidDigest = digest(callbackAccountSid);
      const errorCodeDigest = errorCode === null ? null : digest({
        provider: PROVIDER,
        errorCode
      });
      const payloadDigest = digest(rawBody);
      const signatureVerificationDigest = digest({
        schema: "sitesourcery.twilio-signature-verification/v1",
        provider: PROVIDER,
        callbackUrl: selectedCallbackUrl,
        signatureDigest: digest(signature),
        payloadDigest
      });
      const providerEventDigest = payloadDigest;
      const receipt = await durable.ingestDeliveryStatus({
        provider: PROVIDER,
        providerEventDigest,
        providerMessageIdDigest,
        accountSidDigest,
        messageStatus,
        errorCodeDigest,
        signatureVerificationDigest,
        payloadDigest,
        receivedAt
      });
      invariant(
        receipt?.schema ===
          "sitesourcery.responder-twilio-delivery-event-receipt/v1" &&
          ["pending", "applied", "stale", "conflict"]
            .includes(receipt.eventState) &&
          receipt.messageStatus === messageStatus &&
          receipt.providerEffects === false &&
          typeof receipt.replayed === "boolean",
        "TWILIO_RESPONDER_EVENT_DURABILITY_REQUIRED",
        "Twilio callback success requires an exact durable receipt.",
        { status: 503, details: { providerEffects: false } }
      );
      return receipt;
    }
  });
}

export const TWILIO_RESPONDER_EVENT_MAXIMUM_BYTES = MAXIMUM_BYTES;
