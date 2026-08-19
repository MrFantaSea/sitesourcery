import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const MAIL_PURPOSE_NOTIFICATION_SCHEMA =
  "sitesourcery.mail-purpose-notification/v1";

export const MAIL_PURPOSE_NOTIFICATION_AUTHORITIES = deepFreeze({
  custom_progress_updated: authority(
    "project_progress",
    "ss.service_custom_build_progress_updates",
    ["preparing", "building", "checking"],
    "custom-build-progress-updated.v1"
  ),
  publication_state_changed: authority(
    "publication_domain",
    "ss.publication_control_commands",
    ["publish", "rollback", "unpublish"],
    "publication-state-changed.v1"
  ),
  domain_lifecycle_updated: authority(
    "publication_domain", "ss.domain_provider_lifecycle_states",
    ["active", "grace", "redemption", "expired", "transferred_out"],
    "domain-lifecycle-updated.v1"
  ),
  care_ticket_acknowledgment: authority(
    "care", "ss.care_commands", ["ticket_open"],
    "care-ticket-acknowledgment.v1"
  ),
  care_ticket_update: authority(
    "care", "ss.care_commands",
    ["ticket_start", "ticket_wait", "ticket_resume", "ticket_reopen"],
    "care-ticket-update.v1"
  ),
  care_ticket_resolved: authority(
    "care", "ss.care_commands", ["ticket_resolve", "ticket_close"],
    "care-ticket-resolved.v1"
  ),
  care_commerce_quote_held: authority(
    "care", "ss.care_commerce_quotes", ["held"],
    "care-commerce-quote-held.v1"
  ),
  care_commerce_reservation_held: authority(
    "care", "ss.care_commerce_reservation_events", ["held"],
    "care-commerce-reservation-held.v1"
  ),
  care_commerce_reservation_cancelled: authority(
    "care", "ss.care_commerce_reservation_events", ["cancelled"],
    "care-commerce-reservation-cancelled.v1"
  ),
  responder_commerce_quote_held: authority(
    "responder", "ss.responder_commerce_quotes", ["held"],
    "responder-commerce-quote-held.v1"
  ),
  responder_commerce_reservation_held: authority(
    "responder", "ss.responder_commerce_reservation_events", ["held"],
    "responder-commerce-reservation-held.v1"
  ),
  responder_commerce_reservation_cancelled: authority(
    "responder", "ss.responder_commerce_reservation_events", ["cancelled"],
    "responder-commerce-reservation-cancelled.v1"
  ),
  responder_forwarding_updated: authority(
    "responder", "ss.responder_forwarding_commands",
    ["setup_pending", "ready_held", "manual_review", "retired"],
    "responder-forwarding-state-changed.v1"
  ),
  engagement_followup_ready: authority(
    "marketing_followup", "ss.customer_engagements", ["claimed"],
    "engagement-followup-ready.v1"
  )
});

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

function authority(purposeKind, table, states, templateVersion) {
  return Object.freeze({
    purposeKind,
    table,
    states: Object.freeze([...states]),
    templateVersion
  });
}

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    "MAIL_PURPOSE_NOTIFICATION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "MAIL_PURPOSE_NOTIFICATION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "MAIL_PURPOSE_NOTIFICATION_INVALID",
    `${field} must be an opaque lowercase SHA-256 or HMAC digest.`,
    { status: 400 }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "MAIL_PURPOSE_NOTIFICATION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function currentTime(clock) {
  const selected = typeof clock === "function" ? clock() : clock?.now?.();
  invariant(
    typeof selected === "string" &&
      Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "MAIL_PURPOSE_NOTIFICATION_CONFIGURATION_REQUIRED",
    "The mail-purpose notification clock is invalid.",
    { status: 500 }
  );
  return selected;
}

function readScope(value, audience) {
  const keys = audience === "customer"
    ? ["actorId", "organizationId", "projectId"]
    : ["actorId", "operatorOrganizationId"];
  exactObject(value, keys, `${audience} mail-purpose query`);
  return deepFreeze(audience === "customer" ? {
    actorId: uuid(value.actorId, "Customer actor ID"),
    organizationId: uuid(value.organizationId, "Organization ID"),
    projectId: uuid(value.projectId, "Project ID")
  } : {
    actorId: uuid(value.actorId, "Operator actor ID"),
    operatorOrganizationId: uuid(
      value.operatorOrganizationId,
      "Operator organization ID"
    )
  });
}

export function normalizeMailPurposeNotification(input, requestedAt) {
  exactObject(
    input,
    [
      "actorId",
      "commandId",
      "contentDigest",
      "expiresAt",
      "notificationKind",
      "operatorOrganizationId",
      "purposeKind",
      "recipientDigest",
      "source",
      "subjectReferenceDigest",
      "templateVersion"
    ],
    "Mail-purpose notification"
  );
  exactObject(
    input.source,
    ["digest", "id", "revision", "state", "table"],
    "Mail-purpose notification source"
  );
  const selectedAuthority =
    MAIL_PURPOSE_NOTIFICATION_AUTHORITIES[input.notificationKind];
  invariant(
    selectedAuthority &&
      selectedAuthority.purposeKind === input.purposeKind &&
      selectedAuthority.table === input.source.table &&
      selectedAuthority.states.includes(input.source.state) &&
      selectedAuthority.templateVersion === input.templateVersion,
    "MAIL_PURPOSE_NOTIFICATION_INVALID",
    "The notification kind does not match its committed source authority.",
    { status: 400 }
  );
  invariant(
    typeof input.commandId === "string" && SAFE_ID.test(input.commandId) &&
      typeof input.source.id === "string" &&
      SOURCE_ID.test(input.source.id) &&
      Number.isSafeInteger(input.source.revision) &&
      input.source.revision >= 0,
    "MAIL_PURPOSE_NOTIFICATION_INVALID",
    "The notification source identity is invalid.",
    { status: 400 }
  );
  const selected = {
    schema: MAIL_PURPOSE_NOTIFICATION_SCHEMA,
    actorId: uuid(input.actorId, "Operator actor ID"),
    operatorOrganizationId: uuid(
      input.operatorOrganizationId,
      "Operator organization ID"
    ),
    commandId: input.commandId,
    purposeKind: input.purposeKind,
    notificationKind: input.notificationKind,
    source: {
      table: input.source.table,
      id: input.source.id,
      revision: input.source.revision,
      digest: sha256(input.source.digest, "Source digest"),
      state: input.source.state
    },
    recipientDigest: sha256(input.recipientDigest, "Recipient digest"),
    subjectReferenceDigest: sha256(
      input.subjectReferenceDigest,
      "Subject reference digest"
    ),
    contentDigest: sha256(input.contentDigest, "Content digest"),
    templateVersion: input.templateVersion,
    expiresAt: instant(input.expiresAt, "Notification expiry")
  };
  const selectedRequestedAt = instant(
    requestedAt,
    "Notification request time"
  );
  invariant(
    Date.parse(selected.expiresAt) > Date.parse(selectedRequestedAt),
    "MAIL_PURPOSE_NOTIFICATION_INVALID",
    "The notification reservation must expire after it is recorded.",
    { status: 400 }
  );
  return deepFreeze({
    ...selected,
    requestedAt: selectedRequestedAt,
    requestDigest: digest(selected)
  });
}

function heldError() {
  return new HostedError(
    "MAIL_PURPOSE_NOTIFICATION_HELD",
    "Purpose notifications are not connected to durable held composition.",
    {
      status: 503,
      details: {
        providerEffects: false,
        deliveryClaimed: false,
        sourceAuthoritative: true
      }
    }
  );
}

export function createHeldMailPurposeNotifications() {
  return Object.freeze({
    kind: "mail-purpose-notifications",
    mode: "held",
    providerEffects: false,
    deliveryClaimed: false,
    async readiness() {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "mail-purpose-notifications",
        code: "MAIL_PURPOSE_NOTIFICATION_HELD",
        purposeCount: 5,
        sourceCount: 14,
        providerEffects: false,
        deliveryClaimed: false,
        sourceAuthoritative: true
      });
    },
    async reserveOperator() { throw heldError(); },
    async listCustomer() { throw heldError(); },
    async listOperator() { throw heldError(); }
  });
}

export function createMailPurposeNotifications({ repository, clock } = {}) {
  invariant(
    repository &&
      ["readiness", "reserveOperator", "listCustomer", "listOperator"]
        .every((method) => typeof repository[method] === "function"),
    "MAIL_PURPOSE_NOTIFICATION_CONFIGURATION_REQUIRED",
    "A complete mail-purpose notification repository is required.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "mail-purpose-notifications",
    mode: "repository",
    providerEffects: false,
    deliveryClaimed: false,
    readiness: () => repository.readiness(),
    reserveOperator(input) {
      return repository.reserveOperator(
        normalizeMailPurposeNotification(input, currentTime(clock))
      );
    },
    listCustomer(input) {
      return repository.listCustomer(readScope(input, "customer"));
    },
    listOperator(input) {
      return repository.listOperator(readScope(input, "operator"));
    }
  });
}
