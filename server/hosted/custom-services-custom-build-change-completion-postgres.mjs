import { createHash, randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import {
  SERVICE_IMAGE_EVIDENCE_MEDIA_EXTENSIONS,
  validateServiceImageEvidence
} from "./service-image-evidence.mjs";

export const CUSTOM_BUILD_CHANGE_COMPLETION_SCHEMA =
  "sitesourcery.custom-build-change-completion/v1";

const READINESS_SCHEMA =
  "sitesourcery.custom-build-change-completion-readiness/v1";
const RUNTIME_CONTRACT =
  "canonical-ss-v44-custom-build-change-completion";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const CREDENTIAL =
  /(password|passcode|secret|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|recovery[ _-]?code|private[ _-]?key|seed[ _-]?phrase)/iu;
const CHANGE_STATES = new Set([
  "issued",
  "accepted_payment_required",
  "effective",
  "declined",
  "voided"
]);
const COMPLETION_STATES = new Set([
  "ready_for_final_payment",
  "ready_for_delivery"
]);
const MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);
const CONFLICT_CODES = new Set([
  "22001",
  "22P02",
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "40P01",
  "55000"
]);

function exactKeys(value, expected, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function actorId(value) {
  if (!value || typeof value.userId !== "string" || !UUID.test(value.userId)) {
    throw new HostedError(
      "AUTHENTICATION_REQUIRED",
      "Sign in before opening Custom-build change and completion tools.",
      { status: 401 }
    );
  }
  return value.userId;
}

function customerScope(value) {
  exactKeys(
    value,
    ["actorId", "customerId", "organizationId", "projectId"],
    "customerScope"
  );
  const selected = Object.freeze({
    actorId: uuid(value.actorId, "actorId"),
    customerId: uuid(value.customerId, "customerId"),
    organizationId: uuid(value.organizationId, "organizationId"),
    projectId: uuid(value.projectId, "projectId")
  });
  invariant(
    selected.actorId === selected.customerId,
    "CUSTOM_BUILD_CHANGE_COMPLETION_UNAVAILABLE",
    "That Custom-build project is unavailable.",
    { status: 404 }
  );
  return selected;
}

function safeText(value, field, minimum, maximum) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      value.length >= minimum &&
      value.length <= maximum &&
      !CONTROL.test(value) &&
      !CREDENTIAL.test(value),
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
    `${field} is invalid. Do not include passwords, codes, keys, or tokens.`,
    { status: 400 }
  );
  return value;
}

function commandId(value) {
  return safeText(value, "commandId", 8, 200);
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function exactIso(value, field) {
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function exactDate(value, field) {
  const selected = typeof value === "string"
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(Number.NaN);
  invariant(
    typeof value === "string" &&
      DATE.test(value) &&
      !Number.isNaN(selected.getTime()) &&
      selected.toISOString().slice(0, 10) === value,
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function organizationInput(value) {
  return uuid(value, "organizationId");
}

function acceptanceInput(value) {
  exactKeys(
    value,
    [
      "acceptanceStatement",
      "acceptedDisclosureDigest",
      "acceptedQuoteDigest",
      "commandId"
    ],
    "changeOrderAcceptance"
  );
  invariant(
    value.acceptanceStatement ===
      "accepted_exact_change_order_and_payment_requirement",
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
    "acceptanceStatement is invalid.",
    { status: 400 }
  );
  return Object.freeze({
    acceptanceStatement: value.acceptanceStatement,
    acceptedDisclosureDigest: sha256(
      value.acceptedDisclosureDigest,
      "acceptedDisclosureDigest"
    ),
    acceptedQuoteDigest: sha256(
      value.acceptedQuoteDigest,
      "acceptedQuoteDigest"
    ),
    commandId: commandId(value.commandId)
  });
}

function declineInput(value) {
  exactKeys(
    value,
    [
      "commandId",
      "declineStatement",
      "declinedDisclosureDigest",
      "declinedQuoteDigest"
    ],
    "changeOrderDecline"
  );
  invariant(
    value.declineStatement === "declined_exact_custom_build_change_quote",
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
    "declineStatement is invalid.",
    { status: 400 }
  );
  return Object.freeze({
    commandId: commandId(value.commandId),
    declineStatement: value.declineStatement,
    declinedDisclosureDigest: sha256(
      value.declinedDisclosureDigest,
      "declinedDisclosureDigest"
    ),
    declinedQuoteDigest: sha256(
      value.declinedQuoteDigest,
      "declinedQuoteDigest"
    )
  });
}

function issueInput(value) {
  exactKeys(
    value,
    [
      "addedScope",
      "commandId",
      "expiresAt",
      "organizationId",
      "targetCompletionDate",
      "unitCount"
    ],
    "changeOrderIssue"
  );
  const selected = {
    addedScope: safeText(value.addedScope, "addedScope", 20, 2000),
    commandId: commandId(value.commandId),
    expiresAt: exactIso(value.expiresAt, "expiresAt"),
    organizationId: organizationInput(value.organizationId),
    targetCompletionDate: exactDate(
      value.targetCompletionDate,
      "targetCompletionDate"
    ),
    unitCount: value.unitCount
  };
  invariant(
    Number.isSafeInteger(value.unitCount) &&
      value.unitCount >= 1 &&
      value.unitCount <= 40,
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
    "unitCount is invalid.",
    { status: 400 }
  );
  return Object.freeze(selected);
}

function voidInput(value) {
  exactKeys(
    value,
    ["commandId", "expectedQuoteDigest", "organizationId", "reason"],
    "changeOrderVoid"
  );
  return Object.freeze({
    commandId: commandId(value.commandId),
    expectedQuoteDigest: sha256(
      value.expectedQuoteDigest,
      "expectedQuoteDigest"
    ),
    organizationId: organizationInput(value.organizationId),
    reason: safeText(value.reason, "reason", 20, 500)
  });
}

function evidenceInput(value) {
  exactKeys(
    value,
    [
      "accessibleDescription",
      "commandId",
      "dataBase64",
      "mediaType",
      "organizationId",
      "viewport"
    ],
    "completionEvidence"
  );
  const accessibleDescription = safeText(
    value.accessibleDescription,
    "accessibleDescription",
    10,
    500
  );
  const selectedCommandId = commandId(value.commandId);
  const organizationId = organizationInput(value.organizationId);
  invariant(
    value.viewport === "desktop" || value.viewport === "phone",
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
    "viewport is invalid.",
    { status: 400 }
  );
  const image = validateServiceImageEvidence({
    bytesBase64: value.dataBase64,
    mediaType: value.mediaType
  });
  return Object.freeze({
    accessibleDescription,
    bytes: image.bytes,
    commandId: selectedCommandId,
    mediaType: image.mediaType,
    organizationId,
    viewport: value.viewport
  });
}

function completionEvidenceIds(value) {
  invariant(
    Array.isArray(value) && value.length >= 2 && value.length <= 12,
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
    "evidenceIds are invalid.",
    { status: 400 }
  );
  const selected = value.map((id) => uuid(id, "evidenceId"));
  const canonical = [...new Set(selected)].sort();
  invariant(
    canonical.length === selected.length &&
      JSON.stringify(canonical) === JSON.stringify(selected),
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
    "evidenceIds must be unique and canonically ordered.",
    { status: 400 }
  );
  return Object.freeze(canonical);
}

function completionInput(value) {
  exactKeys(
    value,
    ["checks", "commandId", "customerSummary", "evidenceIds", "organizationId"],
    "completion"
  );
  exactKeys(
    value.checks,
    ["accessibilityBasics", "contactActions", "desktop", "links", "phone", "scope"],
    "completionChecks"
  );
  invariant(
    Object.values(value.checks).every((check) => check === true),
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
    "Every completion check must be confirmed.",
    { status: 400 }
  );
  return deepFreeze({
    checks: {
      accessibilityBasics: true,
      contactActions: true,
      desktop: true,
      links: true,
      phone: true,
      scope: true
    },
    commandId: commandId(value.commandId),
    customerSummary: safeText(
      value.customerSummary,
      "customerSummary",
      20,
      1000
    ),
    evidenceIds: completionEvidenceIds(value.evidenceIds),
    organizationId: organizationInput(value.organizationId)
  });
}

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Canonical PostgreSQL authority is required for Custom-build change and completion tools.",
    { status: 500 }
  );
  return value;
}

function validateSources(clock, randomUUID) {
  invariant(
    clock && typeof clock.now === "function" &&
      typeof randomUUID === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Custom-build change and completion time and ID sources are required.",
    { status: 500 }
  );
}

function generatedId(randomUUID) {
  const value = randomUUID();
  invariant(
    typeof value === "string" && UUID.test(value),
    "RUNTIME_CONFIGURATION_ERROR",
    "Custom-build change and completion generated an invalid ID.",
    { status: 500 }
  );
  return value;
}

function capturedAt(clock) {
  const value = clock.now();
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    !Number.isNaN(selected.getTime()),
    "RUNTIME_CONFIGURATION_ERROR",
    "Custom-build change and completion generated an invalid time.",
    { status: 500 }
  );
  return selected.toISOString();
}

function rows(result, field, maximum = Number.MAX_SAFE_INTEGER) {
  invariant(
    result &&
      Array.isArray(result.rows) &&
      Number.isSafeInteger(result.rowCount) &&
      result.rowCount === result.rows.length &&
      result.rowCount <= maximum,
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return result.rows;
}

function one(result, field, { optional = false } = {}) {
  const selected = rows(result, field, 1);
  if (selected.length === 0) {
    invariant(
      optional,
      "CUSTOM_BUILD_CHANGE_COMPLETION_UNAVAILABLE",
      "That Custom-build project is unavailable.",
      { status: 404 }
    );
    return null;
  }
  return selected[0];
}

function storedUuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function storedDigest(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function storedInteger(value, field, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const selected = typeof value === "number" ? value : Number(value);
  invariant(
    Number.isSafeInteger(selected) &&
      selected >= minimum &&
      selected <= maximum,
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function storedText(value, field, minimum, maximum) {
  invariant(
    typeof value === "string" &&
      value.length >= minimum &&
      value.length <= maximum &&
      !CONTROL.test(value),
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function storedIso(value, field) {
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    !Number.isNaN(selected.getTime()),
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected.toISOString();
}

function storedDate(value, field) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  invariant(
    typeof value === "string" && DATE.test(value),
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function storedState(value, allowed, field) {
  invariant(
    typeof value === "string" && allowed.has(value),
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function storedOptionalIso(value, field) {
  return value === null || value === undefined ? null : storedIso(value, field);
}

function storedDigestArray(value, field) {
  invariant(
    Array.isArray(value),
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return Object.freeze(value.map((entry, index) =>
    storedDigest(entry, `${field}[${index}]`)
  ));
}

function storedUuidArray(value, field) {
  invariant(
    Array.isArray(value) && value.length >= 2 && value.length <= 12,
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  const selected = value.map((entry, index) =>
    storedUuid(entry, `${field}[${index}]`)
  );
  invariant(
    JSON.stringify(selected) === JSON.stringify([...new Set(selected)].sort()),
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    `${field} is not canonical.`,
    { status: 500 }
  );
  return Object.freeze(selected);
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function requireOperator(client, operatorUserId, capability) {
  const selected = one(
    await client.query(
      `select ss.service_operator_has_capability(
         $1, $2, clock_timestamp()
       ) as authorized`,
      [operatorUserId, capability]
    ),
    "Custom-build change/completion operator"
  );
  invariant(
    selected.authorized === true,
    "OPERATOR_ACCESS_REQUIRED",
    "Custom-build change and completion tools are unavailable for this account.",
    { status: 403 }
  );
}

async function lockJob(client, jobId) {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`ss-custom-build-h1m:${jobId}`]
  );
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42P01" || error?.code === "42883") {
    return new HostedError(
      "CUSTOM_BUILD_CHANGE_COMPLETION_HELD",
      "Custom-build change and completion storage is not ready.",
      { status: 503 }
    );
  }
  if (
    error?.code === "42501" &&
    /(operator|quote-author|capability|document|job manage)/iu.test(
      String(error.message ?? "")
    )
  ) {
    return new HostedError(
      "OPERATOR_ACCESS_REQUIRED",
      "Custom-build change and completion tools are unavailable for this account.",
      { status: 403 }
    );
  }
  if (error?.code === "42501") {
    return new HostedError(
      "CUSTOM_BUILD_CHANGE_COMPLETION_UNAVAILABLE",
      "That Custom-build project is unavailable.",
      { status: 404 }
    );
  }
  if (CONFLICT_CODES.has(error?.code)) {
    return new HostedError(
      "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED",
      "That Custom-build project changed. Refresh before trying again.",
      { status: 409 }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw databaseError(error);
  }
}

function changeOrderProjection(row, { owner = false } = {}) {
  const state = storedState(row.state, CHANGE_STATES, "change-order state");
  const unitCount = storedInteger(row.unit_count, "unit count", 1, 40);
  const unitAmountMinor = storedInteger(
    row.unit_amount_minor,
    "unit amount",
    12500,
    12500
  );
  const subtotalMinor = storedInteger(row.subtotal_minor, "subtotal", 12500);
  const currency = storedText(row.currency, "currency", 3, 3);
  const taxState = storedText(row.tax_state, "tax state", 1, 80);
  const paymentRequirement = storedText(
    row.payment_requirement,
    "payment requirement",
    1,
    80
  );
  invariant(
    subtotalMinor === unitCount * unitAmountMinor &&
      currency === "USD" &&
      taxState === "automatic_tax_pending" &&
      paymentRequirement === "due_before_changed_work",
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    "Change-order commercial authority is invalid.",
    { status: 500 }
  );
  const projection = {
    changeOrderId: storedUuid(row.id, "change-order ID"),
    changeNumber: storedInteger(row.change_number, "change number", 1),
    state,
    addedScope: storedText(row.added_scope, "added scope", 20, 2000),
    pricing: {
      unitCount,
      unitAmountMinor,
      subtotalMinor,
      currency,
      taxState,
      paymentRequirement
    },
    targetCompletionDate: storedDate(
      row.target_completion_date,
      "target completion date"
    ),
    quoteDigest: storedDigest(row.quote_digest, "quote digest"),
    disclosureDigest: storedDigest(
      row.disclosure_digest,
      "disclosure digest"
    ),
    issuedAt: storedIso(row.issued_at, "issued time"),
    expiresAt: storedIso(row.expires_at, "expiration time"),
    acceptedAt: storedOptionalIso(row.accepted_at, "acceptance time"),
    declinedAt: storedOptionalIso(row.declined_at, "decline time"),
    void: row.voided_at === null || row.voided_at === undefined
      ? null
      : {
          reason: storedText(row.void_reason, "void reason", 20, 500),
          voidedAt: storedIso(row.voided_at, "void time")
        }
  };
  if (owner) {
    projection.createdByOperatorUserId = storedUuid(
      row.created_by_operator_user_id,
      "change-order operator ID"
    );
  }
  return projection;
}

function evidenceProjection(row, { owner = false } = {}) {
  const mediaType = storedState(row.media_type, MEDIA_TYPES, "evidence media type");
  const projection = {
    evidenceId: storedUuid(row.id, "evidence ID"),
    viewport: storedState(
      row.viewport,
      new Set(["desktop", "phone"]),
      "evidence viewport"
    ),
    accessibleDescription: storedText(
      row.accessible_description,
      "evidence description",
      10,
      500
    ),
    mediaType,
    byteCount: storedInteger(
      row.byte_count,
      "evidence byte count",
      1,
      700 * 1024
    ),
    contentDigest: storedDigest(row.content_digest, "evidence content digest"),
    capturedAt: storedIso(row.captured_at, "evidence capture time")
  };
  if (owner) {
    projection.createdByOperatorUserId = storedUuid(
      row.created_by_operator_user_id,
      "evidence operator ID"
    );
  }
  return projection;
}

function completionProjection(row, evidence, { owner = false } = {}) {
  if (row === null) return null;
  const evidenceIds = storedUuidArray(row.evidence_ids, "completion evidence IDs");
  const checks = {
    scope: row.scope_check_passed,
    desktop: row.desktop_check_passed,
    phone: row.phone_check_passed,
    links: row.links_check_passed,
    contactActions: row.contact_actions_check_passed,
    accessibilityBasics: row.accessibility_basics_check_passed
  };
  invariant(
    Object.values(checks).every((check) => check === true),
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    "Completion checks are invalid.",
    { status: 500 }
  );
  const projection = {
    state: storedState(row.state, COMPLETION_STATES, "completion state"),
    customerSummary: storedText(
      row.customer_summary,
      "completion customer summary",
      20,
      1000
    ),
    checks,
    preparedAt: storedIso(row.prepared_at, "completion prepared time")
  };
  const selectedEvidence = new Map(
    evidence.map((entry) => [entry.evidenceId, entry])
  );
  for (const id of evidenceIds) {
    invariant(
      selectedEvidence.has(id),
      "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
      "Completion evidence is incomplete.",
      { status: 500 }
    );
  }
  if (owner) {
    projection.completionId = storedUuid(row.id, "completion ID");
    projection.progressRevision = storedInteger(
      row.progress_revision,
      "completion progress revision",
      1
    );
    projection.evidenceIds = evidenceIds;
    projection.baseScopeDigest = storedDigest(
      row.base_scope_digest,
      "base scope digest"
    );
    projection.effectiveChangeOrderDigests = storedDigestArray(
      row.effective_change_order_digests,
      "effective change-order digests"
    );
    projection.effectiveScopeDigest = storedDigest(
      row.effective_scope_digest,
      "effective scope digest"
    );
    projection.packageDigest = storedDigest(
      row.package_digest,
      "completion package digest"
    );
    projection.createdByOperatorUserId = storedUuid(
      row.created_by_operator_user_id,
      "completion operator ID"
    );
  } else {
    projection.evidence = evidenceIds.map((id) => selectedEvidence.get(id));
  }
  return projection;
}

const CHANGE_ORDER_SELECT = `
  select
    change_order.id,
    change_order.change_number,
    change_order.state,
    change_order.added_scope,
    change_order.unit_count,
    change_order.unit_amount_minor,
    change_order.subtotal_minor,
    change_order.currency,
    change_order.tax_state,
    change_order.payment_requirement,
    change_order.target_completion_date::text as target_completion_date,
    change_order.quote_digest,
    change_order.disclosure_digest,
    change_order.created_by_operator_user_id,
    change_order.issued_at,
    change_order.expires_at,
    acceptance.accepted_at,
    decline.declined_at,
    quote_void.reason as void_reason,
    quote_void.voided_at
  from ss.service_custom_build_change_orders change_order
  left join ss.service_custom_build_change_acceptances acceptance
    on acceptance.organization_id = change_order.organization_id
   and acceptance.change_order_id = change_order.id
  left join ss.service_custom_build_change_declines decline
    on decline.organization_id = change_order.organization_id
   and decline.change_order_id = change_order.id
  left join ss.service_custom_build_change_voids quote_void
    on quote_void.organization_id = change_order.organization_id
   and quote_void.change_order_id = change_order.id`;

const EVIDENCE_SELECT = `
  select
    evidence.id,
    evidence.viewport,
    evidence.accessible_description,
    evidence.created_by_operator_user_id,
    evidence.captured_at,
    document.media_type,
    document.byte_count,
    document.content_digest
  from ss.service_custom_build_completion_evidence evidence
  join ss.service_documents document
    on document.organization_id = evidence.organization_id
   and document.id = evidence.document_id`;

const COMPLETION_SELECT = `
  select
    package.id,
    package.progress_revision,
    package.base_scope_digest,
    package.effective_change_order_digests::text[]
      as effective_change_order_digests,
    package.effective_scope_digest,
    package.evidence_ids,
    package.scope_check_passed,
    package.desktop_check_passed,
    package.phone_check_passed,
    package.links_check_passed,
    package.contact_actions_check_passed,
    package.accessibility_basics_check_passed,
    package.customer_summary,
    package.state,
    package.created_by_operator_user_id,
    package.package_digest,
    package.prepared_at
  from ss.service_custom_build_completion_packages package`;

async function relatedRows(client, organizationId, jobId, { owner }) {
  const changeOrders = rows(
    await client.query(
      `${CHANGE_ORDER_SELECT}
       where change_order.organization_id = $1
         and change_order.job_id = $2
       order by change_order.change_number asc, change_order.id asc`,
      [organizationId, jobId]
    ),
    "Custom-build change orders"
  ).map((row) => changeOrderProjection(row, { owner }));
  const evidence = rows(
    await client.query(
      `${EVIDENCE_SELECT}
       where evidence.organization_id = $1
         and evidence.job_id = $2
       order by evidence.captured_at asc, evidence.id asc`,
      [organizationId, jobId]
    ),
    "Custom-build completion evidence",
    12
  ).map((row) => evidenceProjection(row, { owner }));
  const completionRow = one(
    await client.query(
      `${COMPLETION_SELECT}
       where package.organization_id = $1
         and package.job_id = $2`,
      [organizationId, jobId]
    ),
    "Custom-build completion package",
    { optional: true }
  );
  return { changeOrders, evidence, completionRow };
}

function customerState(activeChangeOrder, completion) {
  if (completion !== null) return completion.state;
  if (activeChangeOrder?.state === "issued") return "change_order_review";
  if (activeChangeOrder?.state === "accepted_payment_required") {
    return "change_order_payment_required";
  }
  return "building";
}

async function customerSnapshot(client, scope) {
  const jobs = rows(
    await client.query(
      `select
         job.id as job_id
       from ss.service_custom_build_jobs job
       where job.organization_id = $1
         and job.project_id = $2
         and job.customer_user_id = $3
         and job.state = 'open'
       order by job.opened_at desc, job.id desc
       limit 1`,
      [scope.organizationId, scope.projectId, scope.customerId]
    ),
    "customer Custom-build paid job",
    1
  );
  if (jobs.length === 0) {
    return deepFreeze({
      schema: CUSTOM_BUILD_CHANGE_COMPLETION_SCHEMA,
      state: "not_available",
      changeOrders: { active: null, history: [] },
      completion: null
    });
  }
  const jobId = storedUuid(jobs[0].job_id, "customer paid-job ID");
  const selected = await relatedRows(
    client,
    scope.organizationId,
    jobId,
    { owner: false }
  );
  const activeIndex = selected.changeOrders.findIndex((change) =>
    change.state === "issued" ||
      change.state === "accepted_payment_required"
  );
  invariant(
    selected.changeOrders.filter((change) =>
      change.state === "issued" ||
        change.state === "accepted_payment_required"
    ).length <= 1,
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    "Custom-build active change-order authority is invalid.",
    { status: 500 }
  );
  const active = activeIndex === -1
    ? null
    : selected.changeOrders[activeIndex];
  const history = selected.changeOrders.filter((_, index) =>
    index !== activeIndex
  );
  const completion = completionProjection(
    selected.completionRow,
    selected.evidence,
    { owner: false }
  );
  return deepFreeze({
    schema: CUSTOM_BUILD_CHANGE_COMPLETION_SCHEMA,
    state: customerState(active, completion),
    changeOrders: { active, history },
    completion
  });
}

async function ownerSnapshot(client, organizationId, jobId) {
  const job = one(
    await client.query(
      `select
         job.id as job_id,
         job.organization_id,
         job.project_id,
         job.case_id,
         job.customer_user_id,
         job.state,
         job.target_completion_date::text as target_completion_date,
         job.final_due_minor,
         job.currency,
         job.opened_at
       from ss.service_custom_build_jobs job
       where job.organization_id = $1
         and job.id = $2
         and job.state = 'open'`,
      [organizationId, jobId]
    ),
    "owner Custom-build paid job"
  );
  const selected = await relatedRows(client, organizationId, jobId, {
    owner: true
  });
  const completion = completionProjection(
    selected.completionRow,
    selected.evidence,
    { owner: true }
  );
  const active = selected.changeOrders.find((change) =>
    change.state === "issued" ||
      change.state === "accepted_payment_required"
  ) ?? null;
  invariant(
    selected.changeOrders.filter((change) =>
      change.state === "issued" ||
        change.state === "accepted_payment_required"
    ).length <= 1,
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    "Custom-build active change-order authority is invalid.",
    { status: 500 }
  );
  const currency = storedText(job.currency, "paid-job currency", 3, 3);
  invariant(
    currency === "USD",
    "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
    "Paid-job currency is invalid.",
    { status: 500 }
  );
  return deepFreeze({
    schema: CUSTOM_BUILD_CHANGE_COMPLETION_SCHEMA,
    state: customerState(active, completion),
    job: {
      jobId: storedUuid(job.job_id, "job ID"),
      organizationId: storedUuid(job.organization_id, "organization ID"),
      projectId: storedUuid(job.project_id, "project ID"),
      caseId: storedUuid(job.case_id, "case ID"),
      customerId: storedUuid(job.customer_user_id, "customer ID"),
      state: storedState(job.state, new Set(["open"]), "paid-job state"),
      targetCompletionDate: storedDate(
        job.target_completion_date,
        "paid-job target date"
      ),
      finalDueMinor: storedInteger(job.final_due_minor, "final due amount"),
      currency,
      openedAt: storedIso(job.opened_at, "paid-job opened time")
    },
    changeOrders: selected.changeOrders,
    evidence: selected.evidence,
    completion
  });
}

async function jobContext(client, organizationId, jobId) {
  return one(
    await client.query(
      `select organization_id, project_id, case_id, customer_user_id
       from ss.service_custom_build_jobs
       where organization_id = $1 and id = $2 and state = 'open'`,
      [organizationId, jobId]
    ),
    "Custom-build paid job"
  );
}

function sameIssue(row, input) {
  return row.added_scope === input.addedScope &&
    Number(row.unit_count) === input.unitCount &&
    storedDate(row.target_completion_date, "replayed target date") ===
      input.targetCompletionDate &&
    storedIso(row.expires_at, "replayed expiration") === input.expiresAt;
}

function sameAcceptance(row, changeOrderId, input) {
  return row.change_order_id === changeOrderId &&
    row.acceptance_statement === input.acceptanceStatement &&
    row.accepted_quote_digest === input.acceptedQuoteDigest &&
    row.accepted_disclosure_digest === input.acceptedDisclosureDigest;
}

function sameDecline(row, changeOrderId, input) {
  return row.change_order_id === changeOrderId &&
    row.decline_statement === input.declineStatement &&
    row.declined_quote_digest === input.declinedQuoteDigest &&
    row.declined_disclosure_digest === input.declinedDisclosureDigest;
}

function sameEvidence(row, input, contentDigest) {
  return row.viewport === input.viewport &&
    row.accessible_description === input.accessibleDescription &&
    row.media_type === input.mediaType &&
    Number(row.byte_count) === input.bytes.byteLength &&
    row.content_digest === contentDigest;
}

function sameCompletion(row, input) {
  return row.customer_summary === input.customerSummary &&
    Array.isArray(row.evidence_ids) &&
    JSON.stringify(row.evidence_ids) === JSON.stringify(input.evidenceIds) &&
    row.scope_check_passed === true &&
    row.desktop_check_passed === true &&
    row.phone_check_passed === true &&
    row.links_check_passed === true &&
    row.contact_actions_check_passed === true &&
    row.accessibility_basics_check_passed === true;
}

function held() {
  throw new HostedError(
    "CUSTOM_BUILD_CHANGE_COMPLETION_HELD",
    "Custom-build change and completion tools are held in this runtime.",
    { status: 503 }
  );
}

export function createHeldCustomServicesCustomBuildChangeCompletion() {
  return Object.freeze({
    async readiness() {
      return deepFreeze({
        schema: READINESS_SCHEMA,
        ready: false,
        state: "held"
      });
    },
    async readCustomer(scope) {
      customerScope(scope);
      return held();
    },
    async readCustomerEvidence(scope, evidenceId) {
      customerScope(scope);
      uuid(evidenceId, "evidenceId");
      return held();
    },
    async acceptChangeOrder(scope, changeOrderId, input) {
      customerScope(scope);
      uuid(changeOrderId, "changeOrderId");
      acceptanceInput(input);
      return held();
    },
    async declineChangeOrder(scope, changeOrderId, input) {
      customerScope(scope);
      uuid(changeOrderId, "changeOrderId");
      declineInput(input);
      return held();
    },
    async readOwner(actor, jobId, organizationId) {
      actorId(actor);
      uuid(jobId, "jobId");
      organizationInput(organizationId);
      return held();
    },
    async issueChangeOrder(actor, jobId, input) {
      actorId(actor);
      uuid(jobId, "jobId");
      issueInput(input);
      return held();
    },
    async voidChangeOrder(actor, jobId, changeOrderId, input) {
      actorId(actor);
      uuid(jobId, "jobId");
      uuid(changeOrderId, "changeOrderId");
      voidInput(input);
      return held();
    },
    async uploadEvidence(actor, jobId, input) {
      actorId(actor);
      uuid(jobId, "jobId");
      evidenceInput(input);
      return held();
    },
    async recordCompletion(actor, jobId, input) {
      actorId(actor);
      uuid(jobId, "jobId");
      completionInput(input);
      return held();
    }
  });
}

export function createPostgresCustomServicesCustomBuildChangeCompletion({
  authority,
  clock = { now: () => new Date().toISOString() },
  randomUUID = systemRandomUUID
} = {}) {
  const database = validateAuthority(authority);
  validateSources(clock, randomUUID);

  return Object.freeze({
    async readiness() {
      return translated(() => database.service(
        { readOnly: true },
        async (client) => {
          const row = one(
            await client.query(
              "select ss.hosted_runtime_contract_v44() as runtime_contract"
            ),
            "Custom-build change/completion runtime contract"
          );
          invariant(
            row.runtime_contract === RUNTIME_CONTRACT,
            "CUSTOM_BUILD_CHANGE_COMPLETION_HELD",
            "Custom-build change and completion storage is not ready.",
            { status: 503 }
          );
          return deepFreeze({
            schema: READINESS_SCHEMA,
            ready: true,
            state: "ready",
            runtimeContract: RUNTIME_CONTRACT
          });
        }
      ));
    },

    async readCustomer(value) {
      const scope = customerScope(value);
      return translated(() => database.service(
        {
          actorKind: "customer",
          userId: scope.customerId,
          organizationId: scope.organizationId,
          readOnly: true
        },
        (client) => customerSnapshot(client, scope)
      ));
    },

    async readCustomerEvidence(value, evidenceIdInput) {
      const scope = customerScope(value);
      const evidenceId = uuid(evidenceIdInput, "evidenceId");
      return translated(() => database.service(
        {
          actorKind: "customer",
          userId: scope.customerId,
          organizationId: scope.organizationId,
          readOnly: true
        },
        async (client) => {
          const row = one(
            await client.query(
              `select
                 evidence.accessible_description,
                 document.media_type,
                 document.content_digest,
                 document.byte_count,
                 payload.payload
               from ss.service_custom_build_completion_packages package
               join ss.service_custom_build_jobs job
                 on job.organization_id = package.organization_id
                and job.id = package.job_id
               join ss.service_custom_build_completion_evidence evidence
                 on evidence.organization_id = package.organization_id
                and evidence.job_id = package.job_id
                and evidence.id = any(package.evidence_ids)
               join ss.service_documents document
                 on document.organization_id = evidence.organization_id
                and document.id = evidence.document_id
               join ss.service_document_payloads payload
                 on payload.organization_id = document.organization_id
                and payload.document_id = document.id
               where package.organization_id = $1
                 and package.project_id = $2
                 and package.customer_user_id = $3
                 and evidence.id = $4
                 and job.state = 'open'
                 and document.document_kind = 'job_evidence'
                 and document.visibility = 'customer'
                 and document.retention_class = 'project'`,
              [
                scope.organizationId,
                scope.projectId,
                scope.customerId,
                evidenceId
              ]
            ),
            "customer Custom-build completion evidence"
          );
          invariant(
            row.payload instanceof Uint8Array,
            "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
            "Completion evidence payload is invalid.",
            { status: 500 }
          );
          const bytes = Buffer.from(row.payload);
          const byteCount = storedInteger(
            row.byte_count,
            "completion evidence byte count",
            1
          );
          const contentDigest = storedDigest(
            row.content_digest,
            "completion evidence content digest"
          );
          invariant(
            bytes.byteLength === byteCount &&
              sha256Bytes(bytes) === contentDigest,
            "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT",
            "Completion evidence failed integrity verification.",
            { status: 500 }
          );
          return deepFreeze({
            bytes,
            mediaType: storedState(
              row.media_type,
              MEDIA_TYPES,
              "completion evidence media type"
            ),
            contentDigest,
            byteCount,
            accessibleDescription: storedText(
              row.accessible_description,
              "completion evidence description",
              10,
              500
            )
          });
        }
      ));
    },

    async acceptChangeOrder(value, changeOrderIdInput, inputValue) {
      const scope = customerScope(value);
      const changeOrderId = uuid(changeOrderIdInput, "changeOrderId");
      const input = acceptanceInput(inputValue);
      return translated(() => database.service(
        {
          actorKind: "customer",
          userId: scope.customerId,
          organizationId: scope.organizationId
        },
        async (client) => {
          const context = one(
            await client.query(
              `select change_order.job_id
               from ss.service_custom_build_change_orders change_order
               where change_order.organization_id = $1
                 and change_order.project_id = $2
                 and change_order.customer_user_id = $3
                 and change_order.id = $4`,
              [
                scope.organizationId,
                scope.projectId,
                scope.customerId,
                changeOrderId
              ]
            ),
            "customer Custom-build change order"
          );
          const jobId = storedUuid(context.job_id, "change-order job ID");
          await lockJob(client, jobId);
          const replay = one(
            await client.query(
              `select
                 acceptance.change_order_id,
                 acceptance.acceptance_statement,
                 acceptance.accepted_quote_digest,
                 acceptance.accepted_disclosure_digest
               from ss.service_custom_build_change_acceptances acceptance
               where acceptance.organization_id = $1
                 and acceptance.customer_user_id = $2
                 and acceptance.job_id = $3
                 and acceptance.command_id = $4`,
              [
                scope.organizationId,
                scope.customerId,
                jobId,
                input.commandId
              ]
            ),
            "Custom-build change acceptance replay",
            { optional: true }
          );
          if (replay !== null) {
            invariant(
              sameAcceptance(replay, changeOrderId, input),
              "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED",
              "That command ID already belongs to another change-order response.",
              { status: 409 }
            );
            return customerSnapshot(client, scope);
          }
          const current = one(
            await client.query(
              `select state, quote_digest, disclosure_digest
               from ss.service_custom_build_change_orders
               where organization_id = $1
                 and project_id = $2
                 and customer_user_id = $3
                 and job_id = $4
                 and id = $5
               for update`,
              [
                scope.organizationId,
                scope.projectId,
                scope.customerId,
                jobId,
                changeOrderId
              ]
            ),
            "current customer Custom-build change order"
          );
          invariant(
            current.state === "issued" &&
              current.quote_digest === input.acceptedQuoteDigest &&
              current.disclosure_digest === input.acceptedDisclosureDigest,
            "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED",
            "That change order changed. Refresh before accepting it.",
            { status: 409 }
          );
          one(
            await client.query(
              `insert into ss.service_custom_build_change_acceptances (
                 id,
                 change_order_id,
                 acceptance_statement,
                 accepted_quote_digest,
                 accepted_disclosure_digest,
                 command_id
               ) values ($1, $2, $3, $4, $5, $6)
               returning id`,
              [
                generatedId(randomUUID),
                changeOrderId,
                input.acceptanceStatement,
                input.acceptedQuoteDigest,
                input.acceptedDisclosureDigest,
                input.commandId
              ]
            ),
            "new Custom-build change acceptance"
          );
          return customerSnapshot(client, scope);
        }
      ));
    },

    async declineChangeOrder(value, changeOrderIdInput, inputValue) {
      const scope = customerScope(value);
      const changeOrderId = uuid(changeOrderIdInput, "changeOrderId");
      const input = declineInput(inputValue);
      return translated(() => database.service(
        {
          actorKind: "customer",
          userId: scope.customerId,
          organizationId: scope.organizationId
        },
        async (client) => {
          const context = one(
            await client.query(
              `select change_order.job_id
               from ss.service_custom_build_change_orders change_order
               where change_order.organization_id = $1
                 and change_order.project_id = $2
                 and change_order.customer_user_id = $3
                 and change_order.id = $4`,
              [
                scope.organizationId,
                scope.projectId,
                scope.customerId,
                changeOrderId
              ]
            ),
            "customer Custom-build change order"
          );
          const jobId = storedUuid(context.job_id, "change-order job ID");
          await lockJob(client, jobId);
          const replay = one(
            await client.query(
              `select
                 decline.change_order_id,
                 decline.decline_statement,
                 decline.declined_quote_digest,
                 decline.declined_disclosure_digest
               from ss.service_custom_build_change_declines decline
               where decline.organization_id = $1
                 and decline.customer_user_id = $2
                 and decline.job_id = $3
                 and decline.command_id = $4`,
              [
                scope.organizationId,
                scope.customerId,
                jobId,
                input.commandId
              ]
            ),
            "Custom-build change decline replay",
            { optional: true }
          );
          if (replay !== null) {
            invariant(
              sameDecline(replay, changeOrderId, input),
              "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED",
              "That command ID already belongs to another change-order response.",
              { status: 409 }
            );
            return customerSnapshot(client, scope);
          }
          const current = one(
            await client.query(
              `select state, quote_digest, disclosure_digest
               from ss.service_custom_build_change_orders
               where organization_id = $1
                 and project_id = $2
                 and customer_user_id = $3
                 and job_id = $4
                 and id = $5
               for update`,
              [
                scope.organizationId,
                scope.projectId,
                scope.customerId,
                jobId,
                changeOrderId
              ]
            ),
            "current customer Custom-build change order"
          );
          invariant(
            current.state === "issued" &&
              current.quote_digest === input.declinedQuoteDigest &&
              current.disclosure_digest === input.declinedDisclosureDigest,
            "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED",
            "That change order changed. Refresh before declining it.",
            { status: 409 }
          );
          one(
            await client.query(
              `insert into ss.service_custom_build_change_declines (
                 id,
                 change_order_id,
                 decline_statement,
                 declined_quote_digest,
                 declined_disclosure_digest,
                 command_id
               ) values ($1, $2, $3, $4, $5, $6)
               returning id`,
              [
                generatedId(randomUUID),
                changeOrderId,
                input.declineStatement,
                input.declinedQuoteDigest,
                input.declinedDisclosureDigest,
                input.commandId
              ]
            ),
            "new Custom-build change decline"
          );
          return customerSnapshot(client, scope);
        }
      ));
    },

    async readOwner(actor, jobIdInput, organizationIdInput) {
      const operatorUserId = actorId(actor);
      const jobId = uuid(jobIdInput, "jobId");
      const organizationId = organizationInput(organizationIdInput);
      return translated(() => database.service(
        {
          actorKind: "operator",
          userId: operatorUserId,
          organizationId,
          readOnly: true
        },
        async (client) => {
          await requireOperator(client, operatorUserId, "service_job_manage");
          return ownerSnapshot(client, organizationId, jobId);
        }
      ));
    },

    async issueChangeOrder(actor, jobIdInput, inputValue) {
      const operatorUserId = actorId(actor);
      const jobId = uuid(jobIdInput, "jobId");
      const input = issueInput(inputValue);
      return translated(() => database.service(
        {
          actorKind: "operator",
          userId: operatorUserId,
          organizationId: input.organizationId
        },
        async (client) => {
          await requireOperator(client, operatorUserId, "service_quote_author");
          await lockJob(client, jobId);
          const replay = one(
            await client.query(
              `select added_scope, unit_count,
                      target_completion_date::text as target_completion_date,
                      expires_at
               from ss.service_custom_build_change_orders
               where organization_id = $1
                 and job_id = $2
                 and created_by_operator_user_id = $3
                 and issue_command_id = $4`,
              [
                input.organizationId,
                jobId,
                operatorUserId,
                input.commandId
              ]
            ),
            "Custom-build change issue replay",
            { optional: true }
          );
          if (replay !== null) {
            invariant(
              sameIssue(replay, input),
              "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED",
              "That command ID already belongs to another change order.",
              { status: 409 }
            );
            return ownerSnapshot(client, input.organizationId, jobId);
          }
          one(
            await client.query(
              `insert into ss.service_custom_build_change_orders (
                 id,
                 job_id,
                 added_scope,
                 unit_count,
                 target_completion_date,
                 issue_command_id,
                 expires_at
               ) values ($1, $2, $3, $4, $5::date, $6, $7::timestamptz)
               returning id`,
              [
                generatedId(randomUUID),
                jobId,
                input.addedScope,
                input.unitCount,
                input.targetCompletionDate,
                input.commandId,
                input.expiresAt
              ]
            ),
            "new Custom-build change order"
          );
          return ownerSnapshot(client, input.organizationId, jobId);
        }
      ));
    },

    async voidChangeOrder(
      actor,
      jobIdInput,
      changeOrderIdInput,
      inputValue
    ) {
      const operatorUserId = actorId(actor);
      const jobId = uuid(jobIdInput, "jobId");
      const changeOrderId = uuid(changeOrderIdInput, "changeOrderId");
      const input = voidInput(inputValue);
      return translated(() => database.service(
        {
          actorKind: "operator",
          userId: operatorUserId,
          organizationId: input.organizationId
        },
        async (client) => {
          await requireOperator(client, operatorUserId, "service_quote_author");
          await lockJob(client, jobId);
          const replay = one(
            await client.query(
              `select change_order_id, reason, voided_quote_digest
               from ss.service_custom_build_change_voids
               where organization_id = $1
                 and job_id = $2
                 and quote_author_operator_user_id = $3
                 and command_id = $4`,
              [
                input.organizationId,
                jobId,
                operatorUserId,
                input.commandId
              ]
            ),
            "Custom-build change void replay",
            { optional: true }
          );
          if (replay !== null) {
            invariant(
              replay.change_order_id === changeOrderId &&
                replay.reason === input.reason &&
                replay.voided_quote_digest === input.expectedQuoteDigest,
              "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED",
              "That command ID already belongs to another change-order void.",
              { status: 409 }
            );
            return ownerSnapshot(client, input.organizationId, jobId);
          }
          const current = one(
            await client.query(
              `select state, quote_digest
               from ss.service_custom_build_change_orders
               where organization_id = $1
                 and job_id = $2
                 and id = $3
               for update`,
              [input.organizationId, jobId, changeOrderId]
            ),
            "current owner Custom-build change order"
          );
          invariant(
            ["issued", "accepted_payment_required"].includes(current.state) &&
              current.quote_digest === input.expectedQuoteDigest,
            "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED",
            "That change order changed. Refresh before voiding it.",
            { status: 409 }
          );
          one(
            await client.query(
              `insert into ss.service_custom_build_change_voids (
                 id,
                 job_id,
                 change_order_id,
                 command_id,
                 reason,
                 voided_quote_digest
               ) values ($1, $2, $3, $4, $5, $6)
               returning id`,
              [
                generatedId(randomUUID),
                jobId,
                changeOrderId,
                input.commandId,
                input.reason,
                input.expectedQuoteDigest
              ]
            ),
            "new Custom-build change void"
          );
          return ownerSnapshot(client, input.organizationId, jobId);
        }
      ));
    },

    async uploadEvidence(actor, jobIdInput, inputValue) {
      const operatorUserId = actorId(actor);
      const jobId = uuid(jobIdInput, "jobId");
      const input = evidenceInput(inputValue);
      const contentDigest = sha256Bytes(input.bytes);
      return translated(() => database.service(
        {
          actorKind: "operator",
          userId: operatorUserId,
          organizationId: input.organizationId
        },
        async (client) => {
          await requireOperator(client, operatorUserId, "service_job_manage");
          await requireOperator(
            client,
            operatorUserId,
            "service_document_manage"
          );
          await lockJob(client, jobId);
          const replay = one(
            await client.query(
              `select
                 evidence.viewport,
                 evidence.accessible_description,
                 document.media_type,
                 document.byte_count,
                 document.content_digest
               from ss.service_custom_build_completion_evidence evidence
               join ss.service_documents document
                 on document.organization_id = evidence.organization_id
                and document.id = evidence.document_id
               where evidence.organization_id = $1
                 and evidence.job_id = $2
                 and evidence.created_by_operator_user_id = $3
                 and evidence.command_id = $4`,
              [
                input.organizationId,
                jobId,
                operatorUserId,
                input.commandId
              ]
            ),
            "Custom-build completion evidence replay",
            { optional: true }
          );
          if (replay !== null) {
            invariant(
              sameEvidence(replay, input, contentDigest),
              "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED",
              "That command ID already belongs to different completion evidence.",
              { status: 409 }
            );
            return ownerSnapshot(client, input.organizationId, jobId);
          }
          const job = await jobContext(client, input.organizationId, jobId);
          const evidenceId = generatedId(randomUUID);
          const documentId = generatedId(randomUUID);
          const recordedAt = capturedAt(clock);
          const objectKey = [
            "service-documents",
            input.organizationId,
            job.project_id,
            "custom-build-jobs",
            jobId,
            "evidence",
            `${documentId}.${SERVICE_IMAGE_EVIDENCE_MEDIA_EXTENSIONS[input.mediaType]}`
          ].join("/");
          await client.query(
            `insert into ss.service_documents (
               id,
               organization_id,
               project_id,
               case_id,
               document_kind,
               object_key,
               content_digest,
               media_type,
               byte_count,
               visibility,
               retention_class,
               created_by_kind,
               created_by_user_id,
               created_at
             ) values (
               $1, $2, $3, $4, 'job_evidence', $5, $6, $7, $8,
               'customer', 'project', 'operator', $9, $10::timestamptz
             )`,
            [
              documentId,
              input.organizationId,
              job.project_id,
              job.case_id,
              objectKey,
              contentDigest,
              input.mediaType,
              input.bytes.byteLength,
              operatorUserId,
              recordedAt
            ]
          );
          await client.query(
            `insert into ss.service_document_payloads (
               organization_id,
               document_id,
               media_type,
               payload,
               created_at
             ) values ($1, $2, $3, $4, $5::timestamptz)`,
            [
              input.organizationId,
              documentId,
              input.mediaType,
              input.bytes,
              recordedAt
            ]
          );
          one(
            await client.query(
              `insert into ss.service_custom_build_completion_evidence (
                 id,
                 job_id,
                 document_id,
                 viewport,
                 accessible_description,
                 command_id,
                 captured_at
               ) values ($1, $2, $3, $4, $5, $6, $7::timestamptz)
               returning id`,
              [
                evidenceId,
                jobId,
                documentId,
                input.viewport,
                input.accessibleDescription,
                input.commandId,
                recordedAt
              ]
            ),
            "new Custom-build completion evidence"
          );
          return ownerSnapshot(client, input.organizationId, jobId);
        }
      ));
    },

    async recordCompletion(actor, jobIdInput, inputValue) {
      const operatorUserId = actorId(actor);
      const jobId = uuid(jobIdInput, "jobId");
      const input = completionInput(inputValue);
      return translated(() => database.service(
        {
          actorKind: "operator",
          userId: operatorUserId,
          organizationId: input.organizationId
        },
        async (client) => {
          await requireOperator(client, operatorUserId, "service_job_manage");
          await lockJob(client, jobId);
          const replay = one(
            await client.query(
              `select
                 customer_summary,
                 evidence_ids,
                 scope_check_passed,
                 desktop_check_passed,
                 phone_check_passed,
                 links_check_passed,
                 contact_actions_check_passed,
                 accessibility_basics_check_passed
               from ss.service_custom_build_completion_packages
               where organization_id = $1
                 and job_id = $2
                 and created_by_operator_user_id = $3
                 and command_id = $4`,
              [
                input.organizationId,
                jobId,
                operatorUserId,
                input.commandId
              ]
            ),
            "Custom-build completion replay",
            { optional: true }
          );
          if (replay !== null) {
            invariant(
              sameCompletion(replay, input),
              "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED",
              "That command ID already belongs to another completion package.",
              { status: 409 }
            );
            return ownerSnapshot(client, input.organizationId, jobId);
          }
          const context = one(
            await client.query(
              `select progress.revision as progress_revision
               from ss.service_custom_build_jobs job
               left join lateral (
                 select candidate.revision
                 from ss.service_custom_build_progress_updates candidate
                 where candidate.organization_id = job.organization_id
                   and candidate.job_id = job.id
                 order by candidate.revision desc
                 limit 1
               ) progress on true
               where job.organization_id = $1
                 and job.id = $2
                 and job.state = 'open'`,
              [input.organizationId, jobId]
            ),
            "Custom-build completion progress"
          );
          invariant(
            context.progress_revision !== null &&
              context.progress_revision !== undefined,
            "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED",
            "The project does not yet have completion-ready progress.",
            { status: 409 }
          );
          const progressRevision = storedInteger(
            context.progress_revision,
            "latest progress revision",
            1
          );
          one(
            await client.query(
              `insert into ss.service_custom_build_completion_packages (
                 id,
                 job_id,
                 progress_revision,
                 evidence_ids,
                 scope_check_passed,
                 desktop_check_passed,
                 phone_check_passed,
                 links_check_passed,
                 contact_actions_check_passed,
                 accessibility_basics_check_passed,
                 customer_summary,
                 command_id
               ) values (
                 $1, $2, $3, $4::uuid[], true, true, true, true, true, true,
                 $5, $6
               )
               returning id`,
              [
                generatedId(randomUUID),
                jobId,
                progressRevision,
                [...input.evidenceIds],
                input.customerSummary,
                input.commandId
              ]
            ),
            "new Custom-build completion package"
          );
          return ownerSnapshot(client, input.organizationId, jobId);
        }
      ));
    }
  });
}
