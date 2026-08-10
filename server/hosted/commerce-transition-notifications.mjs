import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const COMMERCE_NOTIFICATION_SCHEMA =
  "sitesourcery.commerce-transition-notification/v1";

export const COMMERCE_NOTIFICATION_AUTHORITIES = deepFreeze({
  assessment_quote_issued: {
    audience: "customer",
    table: "ss.service_quote_revisions",
    states: ["issued"]
  },
  assessment_invoice_prepared: {
    audience: "customer",
    table: "ss.service_invoices",
    states: ["tax_calculation_pending"]
  },
  assessment_payment_settled: {
    audience: "customer",
    table: "ss.service_assessment_payment_receipts",
    states: ["paid"]
  },
  assessment_report_delivered: {
    audience: "customer",
    table: "ss.service_assessment_reports",
    states: ["delivered"]
  },
  custom_quote_issued: {
    audience: "customer",
    table: "ss.service_custom_build_quote_revisions",
    states: ["issued"]
  },
  custom_initial_invoice_prepared: {
    audience: "customer",
    table: "ss.service_custom_build_invoices",
    states: ["tax_calculation_pending"]
  },
  custom_initial_payment_settled: {
    audience: "customer",
    table: "ss.service_custom_build_payment_receipts",
    states: ["paid"]
  },
  custom_change_quote_issued: {
    audience: "customer",
    table: "ss.service_custom_build_change_orders",
    states: ["issued"]
  },
  custom_change_invoice_prepared: {
    audience: "customer",
    table: "ss.service_custom_build_change_invoices",
    states: ["tax_calculation_pending"]
  },
  custom_change_payment_settled: {
    audience: "customer",
    table: "ss.service_custom_build_change_payment_receipts",
    states: ["paid"]
  },
  custom_completion_ready: {
    audience: "customer",
    table: "ss.service_custom_build_completion_packages",
    states: ["ready_for_final_payment", "ready_for_delivery"]
  },
  custom_final_invoice_prepared: {
    audience: "customer",
    table: "ss.service_custom_build_final_invoices",
    states: ["tax_calculation_pending"]
  },
  custom_final_payment_settled: {
    audience: "customer",
    table: "ss.service_custom_build_final_payment_receipts",
    states: ["paid"]
  },
  custom_handoff_completed: {
    audience: "customer",
    table: "ss.service_custom_build_handoff_receipts",
    states: ["handed_off"]
  },
  professional_reversal_recorded: {
    audience: "customer",
    table: "ss.service_professional_payment_lifecycles",
    states: ["active", "held", "terminated"]
  },
  assessment_payment_reconciliation_required: {
    audience: "operator",
    table: "ss.service_assessment_stripe_events",
    states: ["reconciliation_required"]
  },
  custom_initial_payment_reconciliation_required: {
    audience: "operator",
    table: "ss.service_custom_build_stripe_events",
    states: ["reconciliation_required"]
  },
  custom_change_payment_reconciliation_required: {
    audience: "operator",
    table: "ss.service_custom_build_change_stripe_events",
    states: ["reconciliation_required"]
  },
  custom_final_payment_reconciliation_required: {
    audience: "operator",
    table: "ss.service_custom_build_final_stripe_events",
    states: ["reconciliation_required"]
  },
  professional_reversal_review_required: {
    audience: "operator",
    table: "ss.service_professional_payment_lifecycles",
    states: ["active", "held", "terminated"]
  },
  invoice_finalization_failed: {
    audience: "operator",
    table: "ss.stripe_invoice_finalization_failures",
    states: ["open"]
  }
});

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const TEMPLATE = /^[a-z0-9][a-z0-9._:-]{1,79}$/u;

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    "COMMERCE_NOTIFICATION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "COMMERCE_NOTIFICATION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "COMMERCE_NOTIFICATION_INVALID",
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
    "COMMERCE_NOTIFICATION_INVALID",
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
    "COMMERCE_NOTIFICATION_CONFIGURATION_REQUIRED",
    "The commerce notification clock is invalid.",
    { status: 500 }
  );
  return selected;
}

function actorScope(value, kind) {
  const fields = kind === "customer"
    ? ["actorId", "organizationId", "projectId"]
    : ["actorId", "operatorOrganizationId"];
  exactObject(value, fields, `${kind} notification read`);
  return deepFreeze(kind === "customer" ? {
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

export function normalizeCommerceNotification(input, requestedAt) {
  exactObject(
    input,
    [
      "audienceKind",
      "commandId",
      "contentDigest",
      "expiresAt",
      "notificationKind",
      "recipientDigest",
      "source",
      "subjectReferenceDigest",
      "templateVersion"
    ],
    "Commerce transition notification"
  );
  exactObject(
    input.source,
    ["digest", "id", "revision", "state", "table"],
    "Commerce notification source"
  );
  const authority = COMMERCE_NOTIFICATION_AUTHORITIES[input.notificationKind];
  invariant(
    authority &&
      authority.audience === input.audienceKind &&
      authority.table === input.source.table &&
      authority.states.includes(input.source.state),
    "COMMERCE_NOTIFICATION_INVALID",
    "The notification kind does not match its committed source authority.",
    { status: 400 }
  );
  invariant(
    typeof input.commandId === "string" && SAFE_ID.test(input.commandId) &&
      typeof input.source.id === "string" &&
      SOURCE_ID.test(input.source.id) &&
      Number.isSafeInteger(input.source.revision) &&
      input.source.revision >= 0 &&
      typeof input.templateVersion === "string" &&
      TEMPLATE.test(input.templateVersion),
    "COMMERCE_NOTIFICATION_INVALID",
    "The notification identity or template is invalid.",
    { status: 400 }
  );
  const selected = {
    schema: COMMERCE_NOTIFICATION_SCHEMA,
    commandId: input.commandId,
    audienceKind: input.audienceKind,
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
  const selectedRequestedAt = instant(requestedAt, "Notification request time");
  invariant(
    Date.parse(selected.expiresAt) > Date.parse(selectedRequestedAt),
    "COMMERCE_NOTIFICATION_INVALID",
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
    "COMMERCE_NOTIFICATION_HELD",
    "Commerce transition notifications are not connected to production composition.",
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

export function createHeldCommerceTransitionNotifications() {
  const service = {
    kind: "commerce-transition-notifications",
    mode: "held",
    providerEffects: false,
    deliveryClaimed: false,
    async readiness() {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "commerce-transition-notifications",
        mode: "held",
        code: "COMMERCE_NOTIFICATION_HELD",
        providerEffects: false,
        deliveryClaimed: false,
        sourceAuthoritative: true
      });
    },
    async reserve() { throw heldError(); },
    async listCustomer() { throw heldError(); },
    async listOperator() { throw heldError(); }
  };
  return Object.freeze(service);
}

export function createCommerceTransitionNotifications({ repository, clock } = {}) {
  invariant(
    repository && ["readiness", "reserve", "listCustomer", "listOperator"]
      .every((method) => typeof repository[method] === "function"),
    "COMMERCE_NOTIFICATION_CONFIGURATION_REQUIRED",
    "A complete commerce transition notification repository is required.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "commerce-transition-notifications",
    mode: "repository",
    providerEffects: false,
    deliveryClaimed: false,
    readiness: () => repository.readiness(),
    reserve(input) {
      return repository.reserve(
        normalizeCommerceNotification(input, now(clock))
      );
    },
    listCustomer(input) {
      return repository.listCustomer(actorScope(input, "customer"));
    },
    listOperator(input) {
      return repository.listOperator(actorScope(input, "operator"));
    }
  });
}
