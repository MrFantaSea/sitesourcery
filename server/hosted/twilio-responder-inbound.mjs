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
const CALL_SID = /^CA[0-9a-fA-F]{32}$/u;
const MESSAGING_SERVICE_SID = /^MG[0-9a-fA-F]{32}$/u;
const E164 = /^\+[1-9][0-9]{1,14}$/u;
const PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_]{0,99}$/u;
const COUNT = /^[0-9]{1,4}$/u;
const CALL_STATUSES = new Set([
  "queued", "initiated", "ringing", "in-progress", "completed",
  "busy", "failed", "no-answer", "canceled"
]);
const DIAL_CALL_STATUSES = new Set([
  "completed", "busy", "no-answer", "failed", "canceled"
]);
const MISSED_DIAL_STATUSES = new Set([
  "busy", "no-answer", "failed", "canceled"
]);
const OPT_OUT_TYPES = new Set(["START", "STOP", "HELP"]);
// Twilio's default long-code opt-out keyword set. Advanced Opt-Out answers
// these itself and blocks later sends with error 21610; this classifier only
// records the durable suppression truth and never generates a reply.
const STOP_KEYWORDS = new Set([
  "STOP", "UNSUBSCRIBE", "END", "QUIT", "STOPALL", "REVOKE",
  "OPTOUT", "CANCEL"
]);
const RECEIPT_SCHEMA = "sitesourcery.responder-twilio-inbound-receipt/v1";
const RECEIPT_STATES = new Set([
  "applied", "recorded", "unbound", "superseded"
]);

export const TWILIO_RESPONDER_INBOUND_MAXIMUM_BYTES = MAXIMUM_BYTES;

// The consent, delivery, and material contracts proved in RESPONDER-CORE-01
// through FIN-004P join on this exact digest family. It is computed
// transiently for that join and is never stored in the inbound ledger,
// binding, or material tables, whose phone-derived columns are keyed.
export function inboundContactRouteDigest(address) {
  return digest({ routeKind: "sms", address });
}

function invalid(message = "The Twilio Responder inbound event is invalid.") {
  return new HostedError("TWILIO_RESPONDER_INBOUND_INVALID", message, {
    status: 400,
    details: { providerEffects: false }
  });
}

function configuration(message) {
  return new HostedError(
    "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED",
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

function exactUrl(value, expected, field) {
  let selected;
  try {
    selected = new URL(value);
  } catch {
    selected = null;
  }
  if (!selected || selected.href !== expected) {
    throw configuration(`${field} must be the exact production URL.`);
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
    "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED",
    "The Twilio Responder inbound clock is invalid.",
    { status: 500 }
  );
  return value;
}

function parsedForm(rawBody) {
  if (
    !Buffer.isBuffer(rawBody) || rawBody.length < 1 ||
    rawBody.length > MAXIMUM_BYTES
  ) {
    throw invalid("The Twilio inbound event requires bounded raw bytes.");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
  } catch {
    throw invalid("The Twilio inbound event is not valid UTF-8.");
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
    else throw invalid("Twilio inbound fields cannot repeat.");
  }
  return params;
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
    value?.kind === "twilio-responder-inbound-postgres" &&
      value.providerEffects === false &&
      typeof value.readiness === "function" &&
      typeof value.ingestInboundEvent === "function",
    "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED",
    "Twilio inbound ingress requires the exact durable repository.",
    { status: 500 }
  );
  return value;
}

function vaultBoundary(value) {
  invariant(
    value?.kind === "responder-inbound-material-vault" &&
      value.providerEffects === false &&
      typeof value.readiness === "function" &&
      typeof value.sealInboundMaterial === "function",
    "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED",
    "Twilio inbound ingress requires the inbound material vault.",
    { status: 500 }
  );
  return value;
}

function lookupDigestsBoundary(value) {
  invariant(
    value?.kind === "responder-lookup-digests" &&
      value.providerEffects === false &&
      typeof value.readiness === "function" &&
      typeof value.numberLookupDigest === "function" &&
      typeof value.numberLookupCandidates === "function" &&
      typeof value.callerRouteDigest === "function",
    "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED",
    "Twilio inbound ingress requires the keyed lookup digests.",
    { status: 500 }
  );
  return value;
}

function exactReceipt(receipt) {
  invariant(
    receipt?.schema === RECEIPT_SCHEMA &&
      RECEIPT_STATES.has(receipt.eventState) &&
      typeof receipt.replayed === "boolean" &&
      typeof receipt.coreApplied === "boolean" &&
      receipt.providerEffects === false,
    "TWILIO_RESPONDER_INBOUND_DURABILITY_REQUIRED",
    "Twilio inbound success requires an exact durable receipt.",
    { status: 503, details: { providerEffects: false } }
  );
  return receipt;
}

function classifyMessageIntent(body, optOutType) {
  if (optOutType === "STOP") return "stop";
  if (
    typeof body === "string" &&
    STOP_KEYWORDS.has(body.trim().toUpperCase())
  ) {
    return "stop";
  }
  return "message";
}

export function createHeldTwilioResponderInbound() {
  const held = async () => {
    throw new HostedError(
      "TWILIO_RESPONDER_INBOUND_HELD",
      "Twilio Responder inbound ingestion is held.",
      { status: 503, details: { providerEffects: false } }
    );
  };
  return Object.freeze({
    kind: "twilio-responder-inbound",
    mode: "held",
    providerEffects: false,
    async readiness() {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "twilio-responder-inbound",
        mode: "held",
        providerEffects: false,
        code: "TWILIO_RESPONDER_INBOUND_HELD"
      });
    },
    ingestInboundMessage: held,
    ingestVoiceCall: held,
    ingestDialResult: held
  });
}

export function createTwilioResponderInbound({
  accountSid,
  webhookAuthToken,
  inboundMessageUrl,
  voiceUrl,
  dialResultUrl,
  repository,
  vault,
  lookupDigests,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const selectedAccountSid = exactAccountSid(accountSid);
  const selectedAuthToken = authToken(webhookAuthToken);
  const selectedMessageUrl = exactUrl(
    inboundMessageUrl,
    "https://sitesourcery.com/api/v1/provider-events/twilio/inbound-messages",
    "The Twilio inbound-message webhook URL"
  );
  const selectedVoiceUrl = exactUrl(
    voiceUrl,
    "https://sitesourcery.com/api/v1/provider-events/twilio/voice",
    "The Twilio voice webhook URL"
  );
  const selectedDialResultUrl = exactUrl(
    dialResultUrl,
    "https://sitesourcery.com/api/v1/provider-events/twilio/voice/dial-result",
    "The Twilio dial-result webhook URL"
  );
  const durable = repositoryBoundary(repository);
  const materialVault = vaultBoundary(vault);
  const keyedLookups = lookupDigestsBoundary(lookupDigests);
  invariant(
    typeof twilio?.validateRequest === "function" &&
      typeof clock?.now === "function",
    "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED",
    "The official Twilio validator and inbound clock are required.",
    { status: 500 }
  );

  function verifiedParams(url, { rawBody, headers } = {}) {
    if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/iu
      .test(header(headers, "content-type").trim())) {
      throw invalid();
    }
    const signature = header(headers, "x-twilio-signature");
    if (!/^[A-Za-z0-9+/]{27}=$/u.test(signature)) throw invalid();
    const params = parsedForm(rawBody);
    if (!twilio.validateRequest(
      selectedAuthToken,
      signature,
      url,
      params
    )) {
      throw new HostedError(
        "TWILIO_RESPONDER_INBOUND_SIGNATURE_INVALID",
        "Twilio inbound signature verification failed.",
        { status: 400, details: { providerEffects: false } }
      );
    }
    const callbackAccountSid = one(params, "AccountSid");
    if (callbackAccountSid !== selectedAccountSid) throw invalid();
    const payloadDigest = digest(rawBody);
    return {
      params,
      payloadDigest,
      accountSidDigest: digest(callbackAccountSid),
      signatureVerificationDigest: digest({
        schema: "sitesourcery.twilio-signature-verification/v1",
        provider: PROVIDER,
        callbackUrl: url,
        signatureDigest: digest(signature),
        payloadDigest
      })
    };
  }

  function callerRoute(from) {
    if (typeof from !== "string" || !E164.test(from)) {
      return {
        eligible: false,
        lookupDigest: null,
        lookupKeyVersion: null,
        contactRouteDigest: null
      };
    }
    const keyed = keyedLookups.callerRouteDigest(from);
    return {
      eligible: true,
      lookupDigest: keyed.digest,
      lookupKeyVersion: keyed.keyVersion,
      contactRouteDigest: inboundContactRouteDigest(from)
    };
  }

  function numberLookup(to) {
    const candidates = keyedLookups.numberLookupCandidates(to);
    return {
      digest: candidates[0].digest,
      keyVersion: candidates[0].keyVersion,
      candidateDigests: candidates.map((entry) => entry.digest)
    };
  }

  function evidenceDigest(channel, eventKind, verified) {
    return digest({
      schema: "sitesourcery.responder-twilio-inbound-evidence/v1",
      provider: PROVIDER,
      channel,
      eventKind,
      payloadDigest: verified.payloadDigest,
      signatureVerificationDigest: verified.signatureVerificationDigest
    });
  }

  async function ingest(fact) {
    const receipt = await durable.ingestInboundEvent(fact);
    return exactReceipt(receipt);
  }

  return Object.freeze({
    kind: "twilio-responder-inbound",
    mode: "verified-inbound",
    providerEffects: false,
    async readiness() {
      const [storage, sealing, lookups] = await Promise.all([
        durable.readiness(),
        materialVault.readiness(),
        keyedLookups.readiness()
      ]);
      const ready = storage?.ready === true && storage?.verified === true &&
        sealing?.ready === true && sealing?.verified === true &&
        lookups?.ready === true && lookups?.verified === true;
      return deepFreeze({
        ready,
        verified: ready,
        kind: "twilio-responder-inbound",
        mode: "verified-inbound",
        providerEffects: false,
        lookupWriterVersion: lookups?.writerVersion ?? null,
        // Ingress owns only verified evidence. The HTTP boundary independently
        // composes either the held Reject response or the private Dial plan.
        voiceOperational: false,
        voiceDialPlan: "http-boundary-required",
        code: ready
          ? null
          : storage?.ready !== true
            ? storage?.code ?? "TWILIO_RESPONDER_INBOUND_STORAGE_NOT_READY"
            : sealing?.ready !== true
              ? "TWILIO_RESPONDER_INBOUND_VAULT_NOT_READY"
              : "TWILIO_RESPONDER_INBOUND_LOOKUP_KEYS_NOT_READY"
      });
    },

    async ingestInboundMessage(input = {}) {
      const verified = verifiedParams(selectedMessageUrl, input);
      const { params } = verified;
      const receivedAt = currentTime(clock);
      const messageSid = one(params, "MessageSid");
      const from = one(params, "From");
      const to = one(params, "To");
      const body = params.Body === undefined ? "" : String(params.Body);
      const messagingServiceSid = one(
        params, "MessagingServiceSid", { optional: true }
      );
      const optOutType = one(params, "OptOutType", { optional: true });
      const numMedia = one(params, "NumMedia", { optional: true });
      const numSegments = one(params, "NumSegments", { optional: true });
      if (
        !MESSAGE_SID.test(messageSid) ||
        body.length > 1600 ||
        body.includes("\u0000") ||
        (messagingServiceSid !== null &&
          !MESSAGING_SERVICE_SID.test(messagingServiceSid)) ||
        (optOutType !== null && !OPT_OUT_TYPES.has(optOutType)) ||
        (numMedia !== null && !COUNT.test(numMedia)) ||
        (numSegments !== null && !COUNT.test(numSegments))
      ) {
        throw invalid();
      }
      const route = callerRoute(from);
      const toLookup = numberLookup(to);
      const classifiedIntent = classifyMessageIntent(body, optOutType);
      return ingest({
        channel: "sms",
        eventKind: "message_received",
        providerEventIdDigest: digest(messageSid),
        providerEventDigest: verified.payloadDigest,
        payloadDigest: verified.payloadDigest,
        accountSidDigest: verified.accountSidDigest,
        messagingServiceSidDigest: messagingServiceSid === null
          ? null
          : digest(messagingServiceSid),
        toNumberLookupDigest: toLookup.digest,
        toNumberKeyVersion: toLookup.keyVersion,
        toNumberLookupCandidateDigests: toLookup.candidateDigests,
        forwardedFromLookupCandidateDigests: [],
        fromRouteDigest: route.lookupDigest,
        fromRouteKeyVersion: route.lookupKeyVersion,
        contactRouteDigest: route.contactRouteDigest,
        fromRouteEligible: route.eligible,
        classifiedIntent,
        dialCallStatus: null,
        optOutType,
        signatureVerificationDigest: verified.signatureVerificationDigest,
        evidenceDigest: evidenceDigest("sms", "message_received", verified),
        receivedAt,
        material: route.eligible
          ? { from, body }
          : null,
        sealMaterial: (materialAuthority, value) =>
          materialVault.sealInboundMaterial(materialAuthority, value)
      });
    },

    async ingestVoiceCall(input = {}) {
      const verified = verifiedParams(selectedVoiceUrl, input);
      const { params } = verified;
      const receivedAt = currentTime(clock);
      const callSid = one(params, "CallSid");
      const from = one(params, "From");
      const to = one(params, "To");
      const callStatus = one(params, "CallStatus", { optional: true });
      const direction = one(params, "Direction", { optional: true });
      const forwardedFrom = one(
        params, "ForwardedFrom", { optional: true }
      );
      if (
        !CALL_SID.test(callSid) ||
        (callStatus !== null && !CALL_STATUSES.has(callStatus)) ||
        (direction !== null && direction !== "inbound") ||
        (forwardedFrom !== null && !E164.test(forwardedFrom)) ||
        // A payload carrying DialCallStatus is a dial result. Recording it
        // as call arrival would mislabel the only evidence that decides
        // missed versus answered, so it is refused outright.
        params.DialCallStatus !== undefined
      ) {
        throw invalid();
      }
      const route = callerRoute(from);
      const toLookup = numberLookup(to);
      const forwardedFromCandidates = forwardedFrom === null
        ? []
        : keyedLookups.numberLookupCandidates(forwardedFrom)
          .map((entry) => entry.digest);
      return ingest({
        channel: "voice",
        eventKind: "call_received",
        providerEventIdDigest: digest(callSid),
        providerEventDigest: verified.payloadDigest,
        payloadDigest: verified.payloadDigest,
        accountSidDigest: verified.accountSidDigest,
        messagingServiceSidDigest: null,
        toNumberLookupDigest: toLookup.digest,
        toNumberKeyVersion: toLookup.keyVersion,
        toNumberLookupCandidateDigests: toLookup.candidateDigests,
        forwardedFromLookupCandidateDigests: forwardedFromCandidates,
        fromRouteDigest: route.lookupDigest,
        fromRouteKeyVersion: route.lookupKeyVersion,
        contactRouteDigest: route.contactRouteDigest,
        fromRouteEligible: route.eligible,
        classifiedIntent: "not_applicable",
        dialCallStatus: null,
        optOutType: null,
        signatureVerificationDigest: verified.signatureVerificationDigest,
        evidenceDigest: evidenceDigest("voice", "call_received", verified),
        receivedAt,
        material: route.eligible
          ? { from, forwardedFrom }
          : null,
        sealMaterial: (materialAuthority, value) =>
          materialVault.sealInboundMaterial(materialAuthority, value)
      });
    },

    async ingestDialResult(input = {}) {
      const verified = verifiedParams(selectedDialResultUrl, input);
      const { params } = verified;
      const receivedAt = currentTime(clock);
      const callSid = one(params, "CallSid");
      const from = one(params, "From");
      const to = one(params, "To");
      const dialCallStatus = one(params, "DialCallStatus");
      const dialCallSid = one(params, "DialCallSid", { optional: true });
      const forwardedFrom = one(params, "ForwardedFrom", { optional: true });
      if (
        !CALL_SID.test(callSid) ||
        !DIAL_CALL_STATUSES.has(dialCallStatus) ||
        (dialCallSid !== null && !CALL_SID.test(dialCallSid))
      ) {
        throw invalid();
      }
      const route = callerRoute(from);
      const toLookup = numberLookup(to);
      const missed = MISSED_DIAL_STATUSES.has(dialCallStatus);
      return ingest({
        channel: "voice",
        eventKind: "dial_result",
        providerEventIdDigest: digest(callSid),
        providerEventDigest: verified.payloadDigest,
        payloadDigest: verified.payloadDigest,
        accountSidDigest: verified.accountSidDigest,
        messagingServiceSidDigest: null,
        toNumberLookupDigest: toLookup.digest,
        toNumberKeyVersion: toLookup.keyVersion,
        toNumberLookupCandidateDigests: toLookup.candidateDigests,
        forwardedFromLookupCandidateDigests: [],
        fromRouteDigest: route.lookupDigest,
        fromRouteKeyVersion: route.lookupKeyVersion,
        contactRouteDigest: route.contactRouteDigest,
        fromRouteEligible: route.eligible,
        classifiedIntent: missed ? "not_applicable" : null,
        dialCallStatus,
        optOutType: null,
        signatureVerificationDigest: verified.signatureVerificationDigest,
        evidenceDigest: evidenceDigest("voice", "dial_result", verified),
        receivedAt,
        material: missed && route.eligible
          ? {
              from,
              forwardedFrom: forwardedFrom !== null && E164.test(forwardedFrom)
                ? forwardedFrom
                : null
            }
          : null,
        sealMaterial: (materialAuthority, value) =>
          materialVault.sealInboundMaterial(materialAuthority, value)
      });
    }
  });
}
