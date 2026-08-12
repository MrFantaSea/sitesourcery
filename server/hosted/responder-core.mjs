import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const RESPONDER_CORE_SCHEMA = "sitesourcery.responder-core/v1";
export const RESPONDER_PROVIDER_EVENT_SCHEMA =
  "sitesourcery.responder-provider-event/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const CONSENT_BASES = new Set([
  "inbound_call",
  "inbound_message",
  "explicit_service_request"
]);
const EVENT_KINDS = new Set(["missed_call", "message_received"]);
const MESSAGE_INTENTS = new Set(["not_applicable", "message", "stop", "handoff"]);
const MESSAGE_KINDS = new Set(["missed_call_ack", "human_handoff_ack"]);

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort()),
    "RESPONDER_CORE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "RESPONDER_CORE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "RESPONDER_CORE_INVALID",
    `${field} must be an opaque lowercase SHA-256 or HMAC digest.`,
    { status: 400 }
  );
  return value;
}

function commandId(value) {
  invariant(
    typeof value === "string" && SAFE_ID.test(value),
    "RESPONDER_CORE_INVALID",
    "Responder command ID is invalid.",
    { status: 400 }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "RESPONDER_CORE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function currentTime(clock) {
  const value = typeof clock === "function" ? clock() : clock?.now?.();
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "RESPONDER_CORE_CONFIGURATION_REQUIRED",
    "The Responder clock is invalid.",
    { status: 500 }
  );
  return value;
}

function actor(value, kinds = ["customer", "operator"]) {
  exactObject(value, ["kind", "organizationId", "userId"], "Responder actor");
  invariant(
    kinds.includes(value.kind),
    "RESPONDER_CORE_UNAVAILABLE",
    "Responder authority is unavailable.",
    { status: 404 }
  );
  return deepFreeze({
    kind: value.kind,
    organizationId: uuid(value.organizationId, "Actor organization ID"),
    userId: uuid(value.userId, "Actor user ID")
  });
}

function requestFact(value, recordedAt) {
  const selected = { ...value, recordedAt };
  const fact = { ...selected };
  delete fact.recordedAt;
  return deepFreeze({ ...selected, requestDigest: digest(fact) });
}

function normalizeConsent(input, recordedAt) {
  exactObject(input, [
    "commandId", "consentBasis", "consentEvidenceDigest", "consentedAt",
    "customerUserId", "organizationId", "projectId", "routeDigest"
  ], "Responder contact authority");
  invariant(
    CONSENT_BASES.has(input.consentBasis),
    "RESPONDER_CORE_INVALID",
    "Responder consent basis is invalid.",
    { status: 400 }
  );
  const selected = {
    schema: "sitesourcery.responder-contact-authority/v1",
    commandId: commandId(input.commandId),
    organizationId: uuid(input.organizationId, "Organization ID"),
    projectId: uuid(input.projectId, "Project ID"),
    customerUserId: uuid(input.customerUserId, "Customer user ID"),
    routeKind: "sms",
    routeDigest: sha256(input.routeDigest, "Contact route digest"),
    purpose: "missed_call_response",
    consentBasis: input.consentBasis,
    consentEvidenceDigest: sha256(
      input.consentEvidenceDigest,
      "Consent evidence digest"
    ),
    consentedAt: instant(input.consentedAt, "Consent time")
  };
  invariant(
    Date.parse(recordedAt) >= Date.parse(selected.consentedAt),
    "RESPONDER_CORE_INVALID",
    "Responder consent cannot be recorded before it occurred.",
    { status: 400 }
  );
  return requestFact(selected, recordedAt);
}

function normalizeEvent(input, verified, recordedAt) {
  exactObject(input, [
    "commandId", "eventKind", "occurredAt", "organizationId",
    "payloadDigest", "projectId", "providerEventIdDigest", "routeDigest"
  ], "Responder provider event");
  invariant(
    EVENT_KINDS.has(input.eventKind),
    "RESPONDER_CORE_INVALID",
    "Responder provider event kind is invalid.",
    { status: 400 }
  );
  const intent = verified.messageIntent;
  invariant(
    MESSAGE_INTENTS.has(intent) &&
      ((input.eventKind === "missed_call" && intent === "not_applicable") ||
        (input.eventKind === "message_received" && intent !== "not_applicable")),
    "RESPONDER_CORE_INVALID",
    "Responder provider event intent is invalid.",
    { status: 400 }
  );
  const selected = {
    schema: RESPONDER_PROVIDER_EVENT_SCHEMA,
    commandId: commandId(input.commandId),
    organizationId: uuid(input.organizationId, "Organization ID"),
    projectId: uuid(input.projectId, "Project ID"),
    provider: verified.provider,
    providerEventIdDigest: sha256(
      input.providerEventIdDigest,
      "Provider event ID digest"
    ),
    routeDigest: sha256(input.routeDigest, "Contact route digest"),
    eventKind: input.eventKind,
    messageIntent: intent,
    payloadDigest: sha256(input.payloadDigest, "Provider payload digest"),
    signatureVerificationDigest: sha256(
      verified.signatureVerificationDigest,
      "Signature verification digest"
    ),
    evidenceDigest: sha256(verified.evidenceDigest, "Provider evidence digest"),
    occurredAt: instant(input.occurredAt, "Provider event time")
  };
  invariant(
    Date.parse(recordedAt) >= Date.parse(selected.occurredAt),
    "RESPONDER_CORE_INVALID",
    "Responder provider event is from the future.",
    { status: 400 }
  );
  return requestFact(selected, recordedAt);
}

function normalizeHeldMessage(input, recordedAt) {
  exactObject(input, [
    "commandId", "contactAuthorityId", "contentDigest", "interactionId",
    "messageKind", "organizationId", "projectId"
  ], "Responder held message");
  invariant(
    MESSAGE_KINDS.has(input.messageKind),
    "RESPONDER_CORE_INVALID",
    "Responder message kind is invalid.",
    { status: 400 }
  );
  return requestFact({
    schema: "sitesourcery.responder-held-message-command/v1",
    commandId: commandId(input.commandId),
    organizationId: uuid(input.organizationId, "Organization ID"),
    projectId: uuid(input.projectId, "Project ID"),
    interactionId: uuid(input.interactionId, "Interaction ID"),
    contactAuthorityId: uuid(
      input.contactAuthorityId,
      "Contact authority ID"
    ),
    messageKind: input.messageKind,
    contentDigest: sha256(input.contentDigest, "Message content digest")
  }, recordedAt);
}

function normalizeHandoff(input, recordedAt) {
  exactObject(input, [
    "commandId", "evidenceDigest", "expectedRevision", "interactionId",
    "organizationId", "projectId", "reason"
  ], "Responder handoff");
  invariant(
    ["customer_request", "uncertain_intent", "urgent", "operator_review"]
      .includes(input.reason) &&
      Number.isSafeInteger(input.expectedRevision) &&
      input.expectedRevision > 0,
    "RESPONDER_CORE_INVALID",
    "Responder handoff reason or revision is invalid.",
    { status: 400 }
  );
  return requestFact({
    schema: "sitesourcery.responder-human-handoff/v1",
    commandId: commandId(input.commandId),
    organizationId: uuid(input.organizationId, "Organization ID"),
    projectId: uuid(input.projectId, "Project ID"),
    interactionId: uuid(input.interactionId, "Interaction ID"),
    expectedRevision: input.expectedRevision,
    reason: input.reason,
    evidenceDigest: sha256(input.evidenceDigest, "Handoff evidence digest")
  }, recordedAt);
}

function normalizeKill(input, recordedAt) {
  exactObject(input, ["commandId", "evidenceDigest", "organizationId"],
    "Responder global kill command");
  return requestFact({
    schema: "sitesourcery.responder-global-kill/v1",
    commandId: commandId(input.commandId),
    organizationId: uuid(input.organizationId, "Organization ID"),
    evidenceDigest: sha256(input.evidenceDigest, "Kill-switch evidence digest")
  }, recordedAt);
}

export function createFakeResponderProvider({
  provider = "fake",
  signatureVerificationDigest = "f".repeat(64),
  evidenceDigest = "e".repeat(64),
  classifyMessage = () => "message"
} = {}) {
  invariant(
    provider === "fake" &&
      SHA256.test(signatureVerificationDigest) &&
      SHA256.test(evidenceDigest) &&
      typeof classifyMessage === "function",
    "RESPONDER_CORE_CONFIGURATION_REQUIRED",
    "The deterministic fake Responder provider is invalid.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "responder-fake-provider",
    effects: false,
    verifyEvent(input) {
      const messageIntent = input.eventKind === "missed_call"
        ? "not_applicable"
        : classifyMessage(input);
      return deepFreeze({
        provider,
        messageIntent,
        signatureVerificationDigest,
        evidenceDigest
      });
    }
  });
}

export function createResponderCore({ repository, provider, clock } = {}) {
  invariant(
    repository && [
      "readiness", "recordConsent", "ingestProviderEvent",
      "reserveHeldMessage", "requestHandoff", "engageGlobalKill",
      "accountProjection", "operatorProjection"
    ].every((name) => typeof repository[name] === "function") &&
      provider?.kind === "responder-fake-provider" &&
      provider.effects === false,
    "RESPONDER_CORE_CONFIGURATION_REQUIRED",
    "Responder requires durable storage and the deterministic fake provider.",
    { status: 500 }
  );

  return Object.freeze({
    kind: "responder-core",
    mode: "held",
    providerEffects: false,
    sellable: false,
    billingEffects: false,
    async readiness() {
      const storage = await repository.readiness();
      return deepFreeze({
        schema: RESPONDER_CORE_SCHEMA,
        ready: storage.ready === true,
        verified: storage.verified === true,
        mode: "held",
        providerEffects: false,
        sellable: false,
        billingEffects: false,
        globalKillEngagedByDefault: true
      });
    },
    recordConsent(selectedActor, input) {
      return repository.recordConsent(
        actor(selectedActor),
        normalizeConsent(input, currentTime(clock))
      );
    },
    ingestProviderEvent(input) {
      const verified = provider.verifyEvent(input);
      return repository.ingestProviderEvent(
        normalizeEvent(input, verified, currentTime(clock))
      );
    },
    reserveHeldMessage(selectedActor, input) {
      return repository.reserveHeldMessage(
        actor(selectedActor),
        normalizeHeldMessage(input, currentTime(clock))
      );
    },
    requestHandoff(selectedActor, input) {
      return repository.requestHandoff(
        actor(selectedActor),
        normalizeHandoff(input, currentTime(clock))
      );
    },
    engageGlobalKill(selectedActor, input) {
      return repository.engageGlobalKill(
        actor(selectedActor, ["operator"]),
        normalizeKill(input, currentTime(clock))
      );
    },
    accountProjection(selectedActor) {
      return repository.accountProjection(actor(selectedActor, ["customer"]));
    },
    operatorProjection(selectedActor) {
      return repository.operatorProjection(actor(selectedActor, ["operator"]));
    }
  });
}

export function createHeldResponderCore() {
  const held = () => {
    throw new HostedError(
      "RESPONDER_CORE_HELD",
      "The Responder runtime is held and has no provider effects.",
      { status: 503, details: { providerEffects: false, sellable: false } }
    );
  };
  return Object.freeze({
    kind: "responder-core",
    mode: "held",
    providerEffects: false,
    sellable: false,
    billingEffects: false,
    readiness: async () => deepFreeze({
      schema: RESPONDER_CORE_SCHEMA,
      ready: false,
      verified: false,
      mode: "held",
      providerEffects: false,
      sellable: false,
      billingEffects: false,
      globalKillEngagedByDefault: true
    }),
    recordConsent: held,
    ingestProviderEvent: held,
    reserveHeldMessage: held,
    requestHandoff: held,
    engageGlobalKill: held,
    accountProjection: held,
    operatorProjection: held
  });
}
