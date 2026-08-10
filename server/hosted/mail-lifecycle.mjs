import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const MAIL_DELIVERY_SCHEMA =
  "sitesourcery.hosted-mail-delivery/v1";
export const MAIL_PROVIDER_EVENT_SCHEMA =
  "sitesourcery.hosted-mail-provider-event/v1";
export const MAIL_EXCEPTION_QUEUE_SCHEMA =
  "sitesourcery.hosted-mail-exception-queue/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const PROVIDER = /^[a-z][a-z0-9_-]{1,39}$/u;
const TEMPLATE = /^[a-z0-9][a-z0-9._:-]{1,79}$/u;
const MESSAGE_TYPES = new Set([
  "account_activation",
  "account_recovery",
  "support_notification",
  "commerce_customer_notification",
  "commerce_operator_notification"
]);
const PROVIDER_EVENTS = new Set([
  "delivered",
  "bounced",
  "complained",
  "suppressed"
]);

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort()),
    "MAIL_LIFECYCLE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function selectedUuid(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  invariant(
    typeof value === "string" && UUID.test(value),
    "MAIL_LIFECYCLE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "MAIL_LIFECYCLE_INVALID",
    `${field} must be a lowercase SHA-256 digest.`,
    { status: 400 }
  );
  return value;
}

function safeId(value, field) {
  invariant(
    typeof value === "string" && SAFE_ID.test(value),
    "MAIL_LIFECYCLE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "MAIL_LIFECYCLE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function now(clock) {
  const selected = typeof clock === "function" ? clock() : clock?.now?.();
  invariant(
    typeof selected === "string" &&
      Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "MAIL_LIFECYCLE_CONFIGURATION_REQUIRED",
    "The mail lifecycle clock is invalid.",
    { status: 500 }
  );
  return selected;
}

export function normalizeMailReservation(input, requestedAt) {
  exactObject(
    input,
    [
      "commandId",
      "contentDigest",
      "customerUserId",
      "expiresAt",
      "messageType",
      "organizationId",
      "projectId",
      "recipientDigest",
      "subjectReferenceDigest",
      "templateVersion"
    ],
    "Mail reservation"
  );
  invariant(
    MESSAGE_TYPES.has(input.messageType),
    "MAIL_LIFECYCLE_INVALID",
    "Mail message type is invalid.",
    { status: 400 }
  );
  const selected = {
    schema: MAIL_DELIVERY_SCHEMA,
    commandId: safeId(input.commandId, "Mail command ID"),
    messageType: input.messageType,
    organizationId: selectedUuid(input.organizationId, "Organization ID", {
      nullable: true
    }),
    projectId: selectedUuid(input.projectId, "Project ID", { nullable: true }),
    customerUserId: selectedUuid(input.customerUserId, "Customer user ID", {
      nullable: true
    }),
    recipientDigest: sha256(input.recipientDigest, "Recipient digest"),
    subjectReferenceDigest: sha256(
      input.subjectReferenceDigest,
      "Subject reference digest"
    ),
    contentDigest: sha256(input.contentDigest, "Content digest"),
    templateVersion: input.templateVersion,
    requestedAt: instant(requestedAt, "Mail request time"),
    expiresAt: instant(input.expiresAt, "Mail expiry")
  };
  invariant(
    TEMPLATE.test(selected.templateVersion) &&
      Date.parse(selected.expiresAt) > Date.parse(selected.requestedAt),
    "MAIL_LIFECYCLE_INVALID",
    "Mail template or expiry is invalid.",
    { status: 400 }
  );
  const scopeMatches =
    (selected.messageType === "account_activation" &&
      selected.organizationId === null &&
      selected.projectId === null &&
      selected.customerUserId === null) ||
    (selected.messageType === "account_recovery" &&
      selected.organizationId === null &&
      selected.projectId === null &&
      selected.customerUserId !== null) ||
    (selected.messageType === "support_notification" &&
      selected.organizationId !== null &&
      selected.projectId !== null &&
      selected.customerUserId !== null) ||
    (selected.messageType === "commerce_customer_notification" &&
      selected.organizationId !== null &&
      selected.projectId !== null &&
      selected.customerUserId !== null) ||
    (selected.messageType === "commerce_operator_notification" &&
      selected.customerUserId === null &&
      ((selected.organizationId === null && selected.projectId === null) ||
        (selected.organizationId !== null && selected.projectId !== null)));
  invariant(
    scopeMatches,
    "MAIL_LIFECYCLE_INVALID",
    "Mail message scope is invalid.",
    { status: 400 }
  );
  const commandFact = { ...selected };
  delete commandFact.requestedAt;
  return deepFreeze({
    ...selected,
    requestDigest: digest(commandFact)
  });
}

export function normalizeProviderAcceptance(input, recordedAt) {
  exactObject(
    input,
    [
      "acceptedAt",
      "commandId",
      "evidenceDigest",
      "messageId",
      "provider",
      "providerMessageIdDigest"
    ],
    "Provider acceptance"
  );
  const selected = {
    schema: "sitesourcery.hosted-mail-provider-acceptance/v1",
    commandId: safeId(input.commandId, "Acceptance command ID"),
    messageId: selectedUuid(input.messageId, "Message ID"),
    provider: input.provider,
    providerMessageIdDigest: sha256(
      input.providerMessageIdDigest,
      "Provider message ID digest"
    ),
    evidenceDigest: sha256(input.evidenceDigest, "Acceptance evidence digest"),
    acceptedAt: instant(input.acceptedAt, "Provider acceptance time"),
    recordedAt: instant(recordedAt, "Provider acceptance record time")
  };
  invariant(
    typeof selected.provider === "string" &&
      PROVIDER.test(selected.provider) &&
      Date.parse(selected.recordedAt) >= Date.parse(selected.acceptedAt),
    "MAIL_LIFECYCLE_INVALID",
    "Mail provider is invalid.",
    { status: 400 }
  );
  const acceptanceFact = { ...selected };
  delete acceptanceFact.recordedAt;
  return deepFreeze({
    ...selected,
    requestDigest: digest(acceptanceFact)
  });
}

export function normalizeProviderEvent(input, ingestedAt) {
  exactObject(
    input,
    [
      "evidenceDigest",
      "eventKind",
      "occurredAt",
      "provider",
      "providerEventIdDigest",
      "providerMessageIdDigest",
      "signatureVerificationDigest"
    ],
    "Provider event"
  );
  const selected = {
    schema: MAIL_PROVIDER_EVENT_SCHEMA,
    provider: input.provider,
    providerEventIdDigest: sha256(
      input.providerEventIdDigest,
      "Provider event ID digest"
    ),
    providerMessageIdDigest: sha256(
      input.providerMessageIdDigest,
      "Provider message ID digest"
    ),
    eventKind: input.eventKind,
    signatureVerificationDigest: sha256(
      input.signatureVerificationDigest,
      "Signature verification digest"
    ),
    evidenceDigest: sha256(input.evidenceDigest, "Provider evidence digest"),
    occurredAt: instant(input.occurredAt, "Provider event time"),
    ingestedAt: instant(ingestedAt, "Provider ingestion time")
  };
  invariant(
    typeof selected.provider === "string" &&
      PROVIDER.test(selected.provider) &&
      PROVIDER_EVENTS.has(selected.eventKind) &&
      Date.parse(selected.ingestedAt) >= Date.parse(selected.occurredAt),
    "MAIL_LIFECYCLE_INVALID",
    "Mail provider event is invalid.",
    { status: 400 }
  );
  const normalizedFact = { ...selected };
  delete normalizedFact.ingestedAt;
  return deepFreeze({
    ...selected,
    normalizedEventDigest: digest(normalizedFact)
  });
}

export function normalizeExpiration(input, expiredAt) {
  exactObject(input, ["commandId", "messageId"], "Mail expiration");
  const selected = {
    schema: "sitesourcery.hosted-mail-expiration/v1",
    commandId: safeId(input.commandId, "Expiration command ID"),
    messageId: selectedUuid(input.messageId, "Message ID"),
    expiredAt: instant(expiredAt, "Mail expiration time")
  };
  const expirationFact = { ...selected };
  delete expirationFact.expiredAt;
  return deepFreeze({
    ...selected,
    requestDigest: digest(expirationFact)
  });
}

function heldError() {
  return new HostedError(
    "MAIL_LIFECYCLE_HELD",
    "The durable mail lifecycle is not connected to production delivery.",
    { status: 503, details: { providerEffects: false } }
  );
}

export function createHeldMailLifecycle() {
  return Object.freeze({
    kind: "durable-mail-lifecycle",
    mode: "held",
    providerEffects: false,
    async readiness() {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "durable-mail-lifecycle",
        mode: "held",
        code: "MAIL_LIFECYCLE_HELD",
        providerEffects: false
      });
    },
    async reserve() { throw heldError(); },
    async recordProviderAcceptance() { throw heldError(); },
    async ingestProviderEvent() { throw heldError(); },
    async expire() { throw heldError(); },
    async listOwnerExceptions() { throw heldError(); }
  });
}

export function createMailLifecycle({ repository, clock } = {}) {
  invariant(
    repository &&
      [
        "readiness",
        "reserve",
        "recordProviderAcceptance",
        "ingestProviderEvent",
        "expire",
        "listOwnerExceptions"
      ].every((method) => typeof repository[method] === "function"),
    "MAIL_LIFECYCLE_CONFIGURATION_REQUIRED",
    "A durable mail lifecycle repository is required.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "durable-mail-lifecycle",
    mode: "repository",
    providerEffects: false,
    readiness: () => repository.readiness(),
    reserve: (input) =>
      repository.reserve(normalizeMailReservation(input, now(clock))),
    recordProviderAcceptance: (input) =>
      repository.recordProviderAcceptance(
        normalizeProviderAcceptance(input, now(clock))
      ),
    ingestProviderEvent: (input) =>
      repository.ingestProviderEvent(normalizeProviderEvent(input, now(clock))),
    expire: (input) => repository.expire(normalizeExpiration(input, now(clock))),
    listOwnerExceptions(input) {
      exactObject(
        input,
        ["actorId", "organizationId"],
        "Mail exception query"
      );
      return repository.listOwnerExceptions({
        actorId: selectedUuid(input.actorId, "Operator actor ID"),
        organizationId: selectedUuid(
          input.organizationId,
          "Operator organization ID"
        ),
        observedAt: now(clock)
      });
    }
  });
}
