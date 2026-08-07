import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const CUSTOM_BUILD_HANDOFF_STATE_SCHEMA =
  "sitesourcery.custom-build-handoff-state/v1";
export const CUSTOM_BUILD_HANDOFF_DOCUMENT_SCHEMA =
  "sitesourcery.custom-build-handoff-document/v1";
export const CUSTOM_BUILD_HANDOFF_COMMAND_SCHEMA =
  "sitesourcery.custom-build-handoff-command/v1";

const READINESS_SCHEMA = "sitesourcery.custom-build-handoff-readiness/v1";
const RUNTIME_CONTRACT = "canonical-ss-v47-custom-build-handoff";
const COMMAND_ROUTE = "custom-services.custom-build-handoff";
const DOCUMENT_MEDIA_TYPE = "application/json";
const MAX_DOCUMENT_BYTES = 64 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const CREDENTIAL =
  /(password|passcode|secret|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|recovery[ _-]?code|private[ _-]?key|seed[ _-]?phrase|bearer\s+[a-z0-9._~-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|:\/\/[^/\s:@]+:[^@\s]+@|[?&](?:token|key|secret|password)=)/iu;
const RAW_PROVIDER_IDENTIFIER =
  /(^|[^a-z0-9_])(?:cs|pi|ch|cus|evt|pm|seti|src|tok|sub|price|prod|re)_[a-z0-9][a-z0-9_-]{5,}($|[^a-z0-9_])/iu;

function exactKeys(
  value,
  expected,
  field,
  {
    code = "INVALID_CUSTOM_BUILD_HANDOFF_INPUT",
    status = 400
  } = {}
) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    code,
    `${field} is invalid.`,
    { status }
  );
  return value;
}

function storedExactKeys(value, expected, field) {
  return exactKeys(value, expected, field, {
    code: "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    status: 500
  });
}

function uuid(value, field, code = "INVALID_CUSTOM_BUILD_HANDOFF_INPUT", status = 400) {
  invariant(
    typeof value === "string" && UUID.test(value),
    code,
    `${field} is invalid.`,
    { status }
  );
  return value;
}

function sha256(value, field, code = "INVALID_CUSTOM_BUILD_HANDOFF_INPUT", status = 400) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    code,
    `${field} is invalid.`,
    { status }
  );
  return value;
}

function safeText(
  value,
  field,
  minimum,
  maximum,
  {
    code = "INVALID_CUSTOM_BUILD_HANDOFF_INPUT",
    status = 400
  } = {}
) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      Array.from(value).length >= minimum &&
      Array.from(value).length <= maximum &&
      !CONTROL.test(value) &&
      !CREDENTIAL.test(value) &&
      !RAW_PROVIDER_IDENTIFIER.test(value),
    code,
    `${field} is invalid. Do not include passwords, codes, keys, or tokens.`,
    { status }
  );
  return value;
}

function portableManifestLabelKey(value) {
  return value.replace(/[A-Z]/gu, (character) =>
    character.toLowerCase()
  );
}

function commandId(value) {
  return safeText(value, "commandId", 8, 200);
}

function actorId(value) {
  if (!value || !UUID.test(String(value.userId ?? ""))) {
    throw new HostedError(
      "AUTHENTICATION_REQUIRED",
      "Sign in before opening Custom-build handoff tools.",
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
  const customerId = uuid(value.customerId, "customerId");
  invariant(
    uuid(value.actorId, "actorId") === customerId,
    "CUSTOM_BUILD_HANDOFF_UNAVAILABLE",
    "That Custom-build handoff is unavailable.",
    { status: 404 }
  );
  return Object.freeze({
    actorId: customerId,
    customerId,
    organizationId: uuid(value.organizationId, "organizationId"),
    projectId: uuid(value.projectId, "projectId")
  });
}

function deliveryManifest(
  value,
  {
    code = "INVALID_CUSTOM_BUILD_HANDOFF_INPUT",
    status = 400
  } = {}
) {
  invariant(
    Array.isArray(value) && value.length >= 1 && value.length <= 40,
    code,
    "deliveryManifest is invalid.",
    { status }
  );
  const selected = value.map((entry, index) => {
    exactKeys(
      entry,
      ["description", "label"],
      `deliveryManifest[${index}]`,
      { code, status }
    );
    return Object.freeze({
      description: safeText(
        entry.description,
        `deliveryManifest[${index}].description`,
        2,
        500,
        { code, status }
      ),
      label: safeText(
        entry.label,
        `deliveryManifest[${index}].label`,
        2,
        120,
        { code, status }
      )
    });
  });
  invariant(
    new Set(selected.map(({ label }) => portableManifestLabelKey(label))).size ===
      selected.length &&
      Buffer.byteLength(canonicalJson({ items: selected }), "utf8") <=
        30 * 1024,
    code,
    "deliveryManifest is too large or contains duplicate labels.",
    { status }
  );
  return Object.freeze(selected);
}

function databaseDeliveryManifest(value) {
  return Object.freeze({ items: value.map((entry) => ({ ...entry })) });
}

function handoffInput(actor, jobIdValue, value) {
  exactKeys(
    value,
    [
      "commandId",
      "customerSummary",
      "deliveryManifest",
      "expectedCompletionPackageDigest",
      "expectedFinalObligationDigest",
      "organizationId"
    ],
    "handoff"
  );
  return Object.freeze({
    commandId: commandId(value.commandId),
    customerSummary: safeText(
      value.customerSummary,
      "customerSummary",
      20,
      2000
    ),
    deliveryManifest: deliveryManifest(value.deliveryManifest),
    expectedCompletionPackageDigest: sha256(
      value.expectedCompletionPackageDigest,
      "expectedCompletionPackageDigest"
    ),
    expectedFinalObligationDigest: sha256(
      value.expectedFinalObligationDigest,
      "expectedFinalObligationDigest"
    ),
    jobId: uuid(jobIdValue, "jobId"),
    operatorId: actorId(actor),
    organizationId: uuid(value.organizationId, "organizationId")
  });
}

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Canonical PostgreSQL authority is required for Custom-build handoff.",
    { status: 500 }
  );
  return value;
}

function validateIds(value) {
  const selected = value ?? { next: () => systemRandomUUID() };
  invariant(
    typeof selected.next === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Custom-build handoff IDs are required.",
    { status: 500 }
  );
  return selected;
}

function generatedId(ids, purpose) {
  return uuid(
    ids.next(purpose),
    `${purpose} ID`,
    "RUNTIME_CONFIGURATION_ERROR",
    500
  );
}

function rows(result, field, maximum = Number.MAX_SAFE_INTEGER) {
  invariant(
    result &&
      Array.isArray(result.rows) &&
      Number.isSafeInteger(result.rowCount) &&
      result.rowCount === result.rows.length &&
      result.rowCount <= maximum,
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
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
      "CUSTOM_BUILD_HANDOFF_UNAVAILABLE",
      "That Custom-build handoff is unavailable.",
      { status: 404 }
    );
    return null;
  }
  return selected[0];
}

function storedUuid(value, field) {
  return uuid(
    value,
    field,
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    500
  );
}

function storedDigest(value, field) {
  return sha256(
    value,
    field,
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    500
  );
}

function storedIso(value, field) {
  const selected = value instanceof Date ? value.toISOString() : value;
  invariant(
    typeof selected === "string" &&
      Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function storedJsonIso(value, field) {
  const selected = typeof value === "string" ? new Date(value) : null;
  invariant(
    selected !== null && !Number.isNaN(selected.getTime()),
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected.toISOString();
}

function storedInteger(value, field, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) &&
      selected >= minimum &&
      selected <= maximum,
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function storedBoolean(value, field) {
  invariant(
    value === true || value === false,
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42P01" || error?.code === "42883") {
    return new HostedError(
      "CUSTOM_BUILD_HANDOFF_HELD",
      "Custom-build handoff storage is not ready.",
      { status: 503 }
    );
  }
  if (error?.code === "42501") {
    return new HostedError(
      "OPERATOR_ACCESS_REQUIRED",
      "Custom-build handoff tools are unavailable for this account.",
      { status: 403 }
    );
  }
  if (["23505", "40001", "40P01"].includes(error?.code)) {
    return new HostedError(
      "CUSTOM_BUILD_HANDOFF_CHANGED",
      "That Custom-build handoff changed. Refresh before trying again.",
      { status: 409 }
    );
  }
  if (["22001", "22P02", "23502", "23503", "23514", "55000"].includes(error?.code)) {
    return new HostedError(
      "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
      "The Custom-build handoff rejected inconsistent evidence.",
      { status: 500 }
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

function requestDigest(input) {
  return digest({
    schema: CUSTOM_BUILD_HANDOFF_COMMAND_SCHEMA,
    route: COMMAND_ROUTE,
    commandId: input.commandId,
    operatorId: input.operatorId,
    organizationId: input.organizationId,
    jobId: input.jobId,
    expectedCompletionPackageDigest: input.expectedCompletionPackageDigest,
    expectedFinalObligationDigest: input.expectedFinalObligationDigest,
    customerSummary: input.customerSummary,
    deliveryManifest: input.deliveryManifest
  });
}

async function requireOperator(client, operatorId) {
  const selected = one(
    await client.query(
      `/* handoff:capability */
       select
         ss.service_operator_has_capability(
           $1, 'service_job_manage', clock_timestamp()
         ) as job_manage,
         ss.service_operator_has_capability(
           $1, 'service_document_manage', clock_timestamp()
         ) as document_manage`,
      [operatorId]
    ),
    "Custom-build handoff operator capability"
  );
  invariant(
    selected.job_manage === true && selected.document_manage === true,
    "OPERATOR_ACCESS_REQUIRED",
    "Custom-build handoff tools are unavailable for this account.",
    { status: 403 }
  );
}

async function discoverAndLockJob(client, organizationId, jobId) {
  const discovered = one(
    await client.query(
      `/* handoff:discover */
       select job.id as job_id
       from ss.service_custom_build_jobs job
       where job.organization_id = $1
         and job.id = $2`,
      [organizationId, jobId]
    ),
    "Custom-build handoff job"
  );
  invariant(
    storedUuid(discovered.job_id, "Custom-build handoff job ID") === jobId,
    "CUSTOM_BUILD_HANDOFF_UNAVAILABLE",
    "That Custom-build handoff is unavailable.",
    { status: 404 }
  );
  await client.query(
    `/* handoff:lock */
     select pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`ss-custom-build-h1m:${jobId}`]
  );
}

const HANDOFF_CONTEXT_SELECT = `
  select
    obligation.organization_id,
    obligation.project_id,
    obligation.case_id,
    obligation.customer_user_id,
    obligation.job_id,
    obligation.id as obligation_id,
    obligation.obligation_digest,
    obligation.completion_package_id,
    obligation.completion_package_digest,
    obligation.final_due_minor,
    obligation.currency,
    obligation.workmanship_correction_days,
    package.prepared_at as completion_prepared_at,
    payment.id as final_payment_receipt_id,
    payment.obligation_digest as payment_obligation_digest,
    payment.completion_package_digest as payment_completion_package_digest,
    payment.provider_facts_digest as payment_clearance_digest,
    payment.provider_paid_at as final_payment_provider_paid_at,
    payment.settled_at as final_payment_cleared_at,
    payment.subtotal_minor as final_payment_subtotal_minor,
    payment.tax_minor as final_payment_tax_minor,
    payment.total_minor as final_payment_total_minor,
    payment.currency as final_payment_currency,
    clearance.id as zero_balance_clearance_id,
    clearance.obligation_digest as clearance_obligation_digest,
    clearance.completion_package_digest as clearance_completion_package_digest,
    clearance.clearance_digest as zero_balance_clearance_digest,
    clearance.reason as zero_balance_clearance_reason,
    clearance.cleared_at as zero_balance_cleared_at,
    invoice.id as final_invoice_id,
    invoice.invoice_number as final_invoice_number,
    invoice.invoice_digest as final_invoice_digest,
    handoff.id as handoff_receipt_id,
    handoff.handoff_digest,
    handoff.document_id as handoff_document_id,
    handoff.command_id as handoff_command_id,
    handoff.request_digest as handoff_request_digest,
    handoff.completion_package_digest as handoff_completion_package_digest,
    handoff.final_obligation_digest as handoff_obligation_digest,
    handoff.final_payment_receipt_id as handoff_final_payment_receipt_id,
    handoff.zero_balance_clearance_id as handoff_zero_balance_clearance_id,
    handoff.financial_clearance_kind as handoff_clearance_kind,
    handoff.financial_clearance_digest as handoff_clearance_digest,
    handoff.financial_cleared_at as handoff_financial_cleared_at,
    handoff.customer_summary as handoff_customer_summary,
    handoff.delivery_manifest as handoff_delivery_manifest,
    handoff.document_content_digest as handoff_document_content_digest,
    handoff.document_byte_count as handoff_document_byte_count,
    handoff.document_media_type as handoff_document_media_type,
    handoff.handed_off_at,
    handoff.workmanship_starts_at,
    handoff.workmanship_ends_at,
    document.object_key as handoff_object_key,
    document.content_digest as handoff_content_digest,
    document.media_type as handoff_media_type,
    document.byte_count as handoff_byte_count,
    payload.payload as handoff_payload,
    exists (
      select 1
      from ss.service_custom_build_final_checkout_attempts attempt
      where attempt.organization_id = obligation.organization_id
        and attempt.obligation_id = obligation.id
        and attempt.state in ('provider_pending', 'ready', 'persistence_unknown')
    ) as has_unsettled_attempt,
    exists (
      select 1
      from ss.service_custom_build_final_stripe_events event
      where event.organization_id = obligation.organization_id
        and event.obligation_id = obligation.id
        and event.state in ('pending', 'reconciliation_required')
    ) as has_unsettled_event,
    exists (
      select 1
      from ss.service_custom_build_final_reconciliation_commands command
      where command.organization_id = obligation.organization_id
        and command.job_id = obligation.job_id
        and command.state = 'running'
    ) as has_running_reconciliation_command
  from ss.service_custom_build_final_obligations obligation
  join ss.service_custom_build_completion_packages package
    on package.organization_id = obligation.organization_id
   and package.id = obligation.completion_package_id
  left join ss.service_custom_build_final_payment_receipts payment
    on payment.organization_id = obligation.organization_id
   and payment.obligation_id = obligation.id
  left join ss.service_custom_build_final_zero_balance_clearances clearance
    on clearance.organization_id = obligation.organization_id
   and clearance.obligation_id = obligation.id
  left join ss.service_custom_build_final_invoices invoice
    on invoice.organization_id = obligation.organization_id
   and invoice.obligation_id = obligation.id
  left join ss.service_custom_build_handoff_receipts handoff
    on handoff.organization_id = obligation.organization_id
   and handoff.final_obligation_id = obligation.id
  left join ss.service_documents document
    on document.organization_id = handoff.organization_id
   and document.id = handoff.document_id
  left join ss.service_document_payloads payload
    on payload.organization_id = document.organization_id
   and payload.document_id = document.id`;

function clearanceFromRow(row, { requireCleared = false } = {}) {
  const finalDueMinor = storedInteger(
    row.final_due_minor,
    "Custom-build final obligation amount"
  );
  invariant(
    row.currency === "USD" && Number(row.workmanship_correction_days) === 30,
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    "The retained final obligation is invalid.",
    { status: 500 }
  );
  const paymentPresent = row.final_payment_receipt_id !== null &&
    row.final_payment_receipt_id !== undefined;
  const zeroPresent = row.zero_balance_clearance_id !== null &&
    row.zero_balance_clearance_id !== undefined;
  invariant(
    !(paymentPresent && zeroPresent),
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    "The retained final obligation has conflicting clearance paths.",
    { status: 500 }
  );
  if (finalDueMinor > 0 && paymentPresent && !zeroPresent) {
    const referenceId = storedUuid(
      row.final_payment_receipt_id,
      "final-payment receipt ID"
    );
    invariant(
      row.payment_obligation_digest === row.obligation_digest &&
        row.payment_completion_package_digest ===
          row.completion_package_digest,
      "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
      "The final-payment receipt does not clear the retained obligation.",
      { status: 500 }
    );
    return Object.freeze({
      kind: "provider_confirmed_final_payment",
      referenceId,
      clearedAt: storedIso(
        row.final_payment_cleared_at,
        "final-payment settlement time"
      )
    });
  }
  if (finalDueMinor === 0 && zeroPresent && !paymentPresent) {
    const referenceId = storedUuid(
      row.zero_balance_clearance_id,
      "zero-balance clearance ID"
    );
    invariant(
      row.clearance_obligation_digest === row.obligation_digest &&
        row.clearance_completion_package_digest ===
          row.completion_package_digest &&
        SHA256.test(String(row.zero_balance_clearance_digest ?? "")),
      "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
      "The zero-balance clearance does not clear the retained obligation.",
      { status: 500 }
    );
    return Object.freeze({
      kind: "zero_balance_clearance",
      referenceId,
      clearedAt: storedIso(
        row.zero_balance_cleared_at,
        "zero-balance clearance time"
      )
    });
  }
  invariant(
    !requireCleared && finalDueMinor > 0 && !paymentPresent && !zeroPresent,
    "CUSTOM_BUILD_HANDOFF_NOT_CLEARED",
    "The exact final obligation is not financially cleared.",
    { status: 409 }
  );
  return null;
}

function baseContext(row) {
  invariant(
    row &&
      [
        row.organization_id,
        row.project_id,
        row.case_id,
        row.customer_user_id,
        row.job_id,
        row.obligation_id,
        row.completion_package_id
      ].every((entry) => UUID.test(String(entry ?? ""))) &&
      [row.obligation_digest, row.completion_package_digest].every((entry) =>
        SHA256.test(String(entry ?? ""))
      ),
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    "The retained Custom-build handoff authority is incomplete.",
    { status: 500 }
  );
  return Object.freeze({
    organizationId: row.organization_id,
    projectId: row.project_id,
    caseId: row.case_id,
    customerId: row.customer_user_id,
    jobId: row.job_id,
    obligationId: row.obligation_id,
    obligationDigest: row.obligation_digest,
    completionPackageId: row.completion_package_id,
    completionPackageDigest: row.completion_package_digest,
    completionPreparedAt: storedIso(
      row.completion_prepared_at,
      "completion-package time"
    ),
    hasUnsettledAttempt: storedBoolean(
      row.has_unsettled_attempt,
      "unsettled-attempt state"
    ),
    hasUnsettledEvent: storedBoolean(
      row.has_unsettled_event,
      "unsettled-event state"
    ),
    hasRunningReconciliationCommand: storedBoolean(
      row.has_running_reconciliation_command,
      "running-reconciliation-command state"
    )
  });
}

function workmanship(value) {
  invariant(
    value.startsAt === value.handedOffAt &&
      Date.parse(value.endsAt) - Date.parse(value.startsAt) ===
        30 * 24 * 60 * 60 * 1000,
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    "The workmanship interval is invalid.",
    { status: 500 }
  );
  return Object.freeze({
    coverage: "[start,end)",
    termDays: 30,
    startsAt: value.startsAt,
    endsAt: value.endsAt
  });
}

function exactCanonicalDocument(value, row) {
  storedExactKeys(value, [
    "completion",
    "customerSummary",
    "deliveryManifest",
    "finalObligation",
    "financialClearance",
    "handoff",
    "jobId",
    "projectId",
    "schema",
    "state"
  ], "handoff document");
  storedExactKeys(
    value.completion,
    ["packageDigest", "packageId"],
    "handoff completion"
  );
  storedExactKeys(
    value.finalObligation,
    ["obligationDigest", "obligationId"],
    "handoff final obligation"
  );
  storedExactKeys(value.financialClearance, [
    "clearedAt",
    "kind",
    "referenceId"
  ], "handoff financial clearance");
  storedExactKeys(value.handoff, [
    "documentId",
    "handedOffAt",
    "receiptId",
    "workmanship"
  ], "handoff identity");
  storedExactKeys(value.handoff.workmanship, [
    "coverage",
    "endsAt",
    "startsAt",
    "termDays"
  ], "handoff workmanship");
  const clearance = clearanceFromRow(row, { requireCleared: true });
  const storedValidation = {
    code: "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    status: 500
  };
  const manifest = deliveryManifest(
    value.deliveryManifest,
    storedValidation
  );
  safeText(
    value.customerSummary,
    "customerSummary",
    20,
    2000,
    storedValidation
  );
  const handedOffAt = storedIso(row.handed_off_at, "handoff time");
  const workmanshipStartsAt = storedIso(
    row.workmanship_starts_at,
    "workmanship start"
  );
  const workmanshipEndsAt = storedIso(
    row.workmanship_ends_at,
    "workmanship end"
  );
  const financial = value.financialClearance;
  invariant(
    value.schema === CUSTOM_BUILD_HANDOFF_DOCUMENT_SCHEMA &&
      value.state === "handed_off" &&
      value.projectId === row.project_id &&
      value.jobId === row.job_id &&
      value.completion.packageId === row.completion_package_id &&
      value.completion.packageDigest === row.completion_package_digest &&
      value.finalObligation.obligationId === row.obligation_id &&
      value.finalObligation.obligationDigest === row.obligation_digest &&
      financial.kind === clearance.kind &&
      financial.referenceId === clearance.referenceId &&
      storedJsonIso(financial.clearedAt, "financial clearance time") ===
        clearance.clearedAt &&
      value.handoff.receiptId === row.handoff_receipt_id &&
      value.handoff.documentId === row.handoff_document_id &&
      storedJsonIso(value.handoff.handedOffAt, "document handoff time") ===
        handedOffAt &&
      value.handoff.workmanship.coverage === "[start,end)" &&
      Number(value.handoff.workmanship.termDays) === 30 &&
      storedJsonIso(
        value.handoff.workmanship.startsAt,
        "document workmanship start"
      ) ===
        workmanshipStartsAt &&
      storedJsonIso(
        value.handoff.workmanship.endsAt,
        "document workmanship end"
      ) ===
        workmanshipEndsAt &&
      value.customerSummary === row.handoff_customer_summary &&
      canonicalJson({ items: value.deliveryManifest }) ===
        canonicalJson(row.handoff_delivery_manifest),
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    "The retained handoff document changed.",
    { status: 500 }
  );
  workmanship({
    handedOffAt,
    startsAt: workmanshipStartsAt,
    endsAt: workmanshipEndsAt
  });
  invariant(
    canonicalJson(value.deliveryManifest) === canonicalJson(manifest),
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    "The retained handoff manifest changed.",
    { status: 500 }
  );
  return deepFreeze(structuredClone(value));
}

function retainedDocument(row) {
  const context = baseContext(row);
  invariant(
    row.handoff_receipt_id !== null &&
      row.handoff_receipt_id !== undefined &&
      row.handoff_document_id !== null &&
      row.handoff_document_id !== undefined,
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    "The retained handoff lacks its document.",
    { status: 500 }
  );
  const receiptId = storedUuid(row.handoff_receipt_id, "handoff receipt ID");
  const documentId = storedUuid(row.handoff_document_id, "handoff document ID");
  safeText(row.handoff_command_id, "handoff command ID", 8, 200, {
    code: "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    status: 500
  });
  storedDigest(row.handoff_request_digest, "handoff request digest");
  const contentDigest = storedDigest(
    row.handoff_content_digest,
    "handoff content digest"
  );
  const byteCount = storedInteger(row.handoff_byte_count, "handoff byte count", 1, MAX_DOCUMENT_BYTES);
  invariant(
    row.handoff_media_type === DOCUMENT_MEDIA_TYPE &&
      row.handoff_document_media_type === DOCUMENT_MEDIA_TYPE &&
      row.handoff_document_content_digest === contentDigest &&
      Number(row.handoff_document_byte_count) === byteCount &&
      SHA256.test(String(row.handoff_digest ?? "")) &&
      typeof row.handoff_object_key === "string" &&
      row.handoff_object_key ===
        `service-documents/${context.organizationId}/${context.projectId}/custom-build-jobs/${context.jobId}/handoff/${documentId}.json` &&
      row.handoff_completion_package_digest === context.completionPackageDigest &&
      row.handoff_obligation_digest === context.obligationDigest,
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    "The retained handoff document identity changed.",
    { status: 500 }
  );
  const clearance = clearanceFromRow(row, { requireCleared: true });
  invariant(
    row.handoff_clearance_kind === clearance.kind &&
      storedIso(
        row.handoff_financial_cleared_at,
        "handoff financial clearance time"
      ) === clearance.clearedAt &&
      ((clearance.kind === "provider_confirmed_final_payment" &&
        row.handoff_final_payment_receipt_id === clearance.referenceId &&
        row.handoff_zero_balance_clearance_id === null &&
        row.handoff_clearance_digest === row.payment_clearance_digest) ||
        (clearance.kind === "zero_balance_clearance" &&
          row.handoff_zero_balance_clearance_id === clearance.referenceId &&
          row.handoff_final_payment_receipt_id === null &&
          row.handoff_clearance_digest ===
            row.zero_balance_clearance_digest)),
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    "The retained handoff clearance changed.",
    { status: 500 }
  );
  invariant(
    row.handoff_payload instanceof Uint8Array,
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    "The retained handoff payload is invalid.",
    { status: 500 }
  );
  const bytes = Buffer.from(row.handoff_payload);
  invariant(
    bytes.byteLength === byteCount && digest(bytes) === contentDigest,
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    "The retained handoff payload digest changed.",
    { status: 500 }
  );
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    parsed = null;
  }
  invariant(
    parsed && typeof parsed === "object" && !Array.isArray(parsed),
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    "The retained handoff payload is not decodable JSON.",
    { status: 500 }
  );
  const customerBytes = Buffer.from(canonicalJson(parsed), "utf8");
  invariant(
    customerBytes.equals(bytes) &&
      customerBytes.byteLength === byteCount &&
      digest(customerBytes) === contentDigest,
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    "The retained handoff payload does not match its customer document identity.",
    { status: 500 }
  );
  const payload = exactCanonicalDocument(parsed, row);
  return deepFreeze({
    receiptId,
    documentId,
    contentDigest,
    byteCount,
    mediaType: DOCUMENT_MEDIA_TYPE,
    objectKey: row.handoff_object_key,
    handedOffAt: payload.handoff.handedOffAt,
    workmanship: payload.handoff.workmanship,
    payload
  });
}

function emptyCustomerProjection(scope) {
  return deepFreeze({
    schema: CUSTOM_BUILD_HANDOFF_STATE_SCHEMA,
    state: "completion_required",
    projectId: scope.projectId,
    jobId: null,
    completion: null,
    finalObligation: null,
    financialClearance: null,
    handoff: null,
    action: {
      handoffAvailable: false,
      reason: "completion_required"
    }
  });
}

function stateProjection(row, { owner = false, scope = null } = {}) {
  if (!row) return emptyCustomerProjection(scope);
  const context = baseContext(row);
  const hasHandoff = row.handoff_receipt_id !== null &&
    row.handoff_receipt_id !== undefined;
  const clearance = clearanceFromRow(row);
  let state;
  let document = null;
  if (hasHandoff) {
    document = retainedDocument(row);
    state = "handed_off";
  } else if (clearance?.kind === "provider_confirmed_final_payment") {
    state = "paid_handoff_pending";
  } else if (clearance?.kind === "zero_balance_clearance") {
    state = "cleared_no_balance_handoff_pending";
  } else if (
    context.hasUnsettledAttempt ||
    context.hasUnsettledEvent ||
    context.hasRunningReconciliationCommand
  ) {
    state = "payment_reconciliation_required";
  } else {
    state = "checkout_available";
  }
  const projection = {
    schema: CUSTOM_BUILD_HANDOFF_STATE_SCHEMA,
    state,
    projectId: context.projectId,
    jobId: context.jobId,
    completion: {
      packageId: context.completionPackageId,
      packageDigest: context.completionPackageDigest,
      completedAt: context.completionPreparedAt
    },
    finalObligation: {
      obligationId: context.obligationId,
      obligationDigest: context.obligationDigest
    },
    financialClearance: clearance,
    handoff: document === null
      ? null
      : {
          receiptId: document.receiptId,
          documentId: document.documentId,
          contentDigest: document.contentDigest,
          handedOffAt: document.handedOffAt,
          workmanship: document.workmanship
        },
    action: {
      handoffAvailable:
        owner &&
        !hasHandoff &&
        clearance !== null &&
        !context.hasUnsettledAttempt &&
        !context.hasUnsettledEvent &&
        !context.hasRunningReconciliationCommand,
      reason: hasHandoff ? "handed_off" : state
    }
  };
  if (owner) projection.organizationId = context.organizationId;
  return deepFreeze(projection);
}

function documentProjection(row) {
  const document = retainedDocument(row);
  return deepFreeze({
    schema: CUSTOM_BUILD_HANDOFF_DOCUMENT_SCHEMA,
    documentId: document.documentId,
    contentDigest: document.contentDigest,
    mediaType: document.mediaType,
    byteCount: document.byteCount,
    payload: document.payload
  });
}

function handoffResult(value, expected = {}) {
  exactKeys(
    value,
    [
      "completionPackageDigest",
      "documentDigest",
      "documentId",
      "financialClearance",
      "finalObligationDigest",
      "handedOffAt",
      "jobId",
      "organizationId",
      "projectId",
      "receiptId",
      "schema",
      "state",
      "workmanship"
    ],
    "handoff result"
  );
  exactKeys(
    value.financialClearance,
    ["clearedAt", "kind", "referenceId"],
    "financialClearance"
  );
  exactKeys(
    value.workmanship,
    ["coverage", "endsAt", "startsAt", "termDays"],
    "workmanship"
  );
  invariant(
    value.schema === CUSTOM_BUILD_HANDOFF_COMMAND_SCHEMA &&
      value.state === "handed_off" &&
      [
        value.organizationId,
        value.projectId,
        value.jobId,
        value.receiptId,
        value.documentId,
        value.financialClearance.referenceId
      ].every((entry) => UUID.test(String(entry ?? ""))) &&
      [
        value.completionPackageDigest,
        value.finalObligationDigest,
        value.documentDigest
      ].every((entry) => SHA256.test(String(entry ?? ""))) &&
      ["provider_confirmed_final_payment", "zero_balance_clearance"].includes(
        value.financialClearance.kind
      ) &&
      Number.isFinite(Date.parse(value.financialClearance.clearedAt)) &&
      value.workmanship.coverage === "[start,end)" &&
      value.workmanship.termDays === 30 &&
      value.workmanship.startsAt === value.handedOffAt &&
      Date.parse(value.workmanship.endsAt) -
        Date.parse(value.workmanship.startsAt) ===
        30 * 24 * 60 * 60 * 1000 &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
    "The retained Custom-build handoff result changed.",
    { status: 500 }
  );
  return deepFreeze(structuredClone(value));
}

function resultFromDocument(context, clearance, document) {
  return handoffResult({
    schema: CUSTOM_BUILD_HANDOFF_COMMAND_SCHEMA,
    state: "handed_off",
    organizationId: context.organizationId,
    projectId: context.projectId,
    jobId: context.jobId,
    receiptId: document.receiptId,
    documentId: document.documentId,
    documentDigest: document.contentDigest,
    completionPackageDigest: context.completionPackageDigest,
    finalObligationDigest: context.obligationDigest,
    financialClearance: clearance,
    handedOffAt: document.handedOffAt,
    workmanship: document.workmanship
  });
}

function held() {
  throw new HostedError(
    "CUSTOM_BUILD_HANDOFF_HELD",
    "Custom-build handoff is held in this runtime.",
    { status: 503 }
  );
}

export function createHeldCustomServicesCustomBuildHandoff() {
  return Object.freeze({
    async readiness() {
      return deepFreeze({
        schema: READINESS_SCHEMA,
        ready: false,
        state: "held"
      });
    },
    async readCustomer(value) {
      customerScope(value);
      return held();
    },
    async readCustomerDocument(value, documentIdValue) {
      customerScope(value);
      uuid(documentIdValue, "documentId");
      return held();
    },
    async readOwner(actor, jobIdValue, organizationIdValue) {
      actorId(actor);
      uuid(jobIdValue, "jobId");
      uuid(organizationIdValue, "organizationId");
      return held();
    },
    async createHandoff(actor, jobIdValue, value) {
      handoffInput(actor, jobIdValue, value);
      return held();
    }
  });
}

export function createPostgresCustomServicesCustomBuildHandoff({
  authority,
  ids
} = {}) {
  const database = validateAuthority(authority);
  const handoffIds = validateIds(ids);

  async function readCustomer(value) {
    const scope = customerScope(value);
    return translated(() => database.service(
      {
        actorKind: "customer",
        userId: scope.customerId,
        organizationId: scope.organizationId,
        readOnly: true
      },
      async (client) => {
        const selected = await client.query(
          `/* handoff:customer-read */
           ${HANDOFF_CONTEXT_SELECT}
           where obligation.organization_id = $1
             and obligation.project_id = $2
             and obligation.customer_user_id = $3
           order by obligation.bound_at desc, obligation.id desc
           limit 1`,
          [scope.organizationId, scope.projectId, scope.customerId]
        );
        return stateProjection(
          one(selected, "customer Custom-build handoff", { optional: true }),
          { scope }
        );
      }
    ));
  }

  async function readCustomerDocument(value, documentIdValue) {
    const scope = customerScope(value);
    const documentId = uuid(documentIdValue, "documentId");
    return translated(() => database.service(
      {
        actorKind: "customer",
        userId: scope.customerId,
        organizationId: scope.organizationId,
        readOnly: true
      },
      async (client) => documentProjection(one(
        await client.query(
          `/* handoff:document-read */
           ${HANDOFF_CONTEXT_SELECT}
           where obligation.organization_id = $1
             and obligation.project_id = $2
             and obligation.customer_user_id = $3
             and handoff.document_id = $4`,
          [
            scope.organizationId,
            scope.projectId,
            scope.customerId,
            documentId
          ]
        ),
        "customer Custom-build handoff document"
      ))
    ));
  }

  async function readOwner(actor, jobIdValue, organizationIdValue) {
    const operatorId = actorId(actor);
    const jobId = uuid(jobIdValue, "jobId");
    const organizationId = uuid(organizationIdValue, "organizationId");
    return translated(() => database.service(
      {
        actorKind: "operator",
        userId: operatorId,
        organizationId,
        readOnly: true
      },
      async (client) => {
        await requireOperator(client, operatorId);
        const selected = one(
          await client.query(
            `/* handoff:owner-read */
             ${HANDOFF_CONTEXT_SELECT}
             where obligation.organization_id = $1
               and obligation.job_id = $2`,
            [organizationId, jobId]
          ),
          "owner Custom-build handoff"
        );
        return stateProjection(selected, { owner: true });
      }
    ));
  }

  async function createHandoff(actor, jobIdValue, value) {
    const input = handoffInput(actor, jobIdValue, value);
    const selectedRequestDigest = requestDigest(input);
    return translated(() => database.service(
      {
        actorKind: "operator",
        userId: input.operatorId,
        organizationId: input.organizationId
      },
      async (client) => {
        await discoverAndLockJob(
          client,
          input.organizationId,
          input.jobId
        );
        const prior = await client.query(
          `/* handoff:command */
           select *
           from ss.idempotency_keys
           where principal_id = $1
             and route_key = $2
             and idempotency_key = $3
           for update`,
          [input.operatorId, COMMAND_ROUTE, input.commandId]
        );
        rows(prior, "Custom-build handoff command", 1);
        await requireOperator(client, input.operatorId);
        if (prior.rowCount === 1) {
          const command = prior.rows[0];
          invariant(
            command.organization_id === input.organizationId &&
              command.request_digest === selectedRequestDigest,
            "CUSTOM_BUILD_HANDOFF_COMMAND_CONFLICT",
            "That command ID already belongs to a different handoff request.",
            { status: 409 }
          );
          invariant(
            command.state === "completed" && command.response_status === 201,
            "CUSTOM_BUILD_HANDOFF_CHANGED",
            "That handoff command has not reached a safe final state.",
            { status: 409 }
          );
          const replay = handoffResult(command.response_body, {
            organizationId: input.organizationId,
            jobId: input.jobId,
            completionPackageDigest:
              input.expectedCompletionPackageDigest,
            finalObligationDigest: input.expectedFinalObligationDigest
          });
          const retained = one(
            await client.query(
              `/* handoff:context */
               ${HANDOFF_CONTEXT_SELECT}
               where obligation.organization_id = $1
                 and obligation.job_id = $2
               for update of obligation, package`,
              [input.organizationId, input.jobId]
            ),
            "replayed Custom-build handoff"
          );
          const context = baseContext(retained);
          const clearance = clearanceFromRow(retained, {
            requireCleared: true
          });
          const canonical = resultFromDocument(
            context,
            clearance,
            retainedDocument(retained)
          );
          invariant(
            canonical.documentId === replay.documentId &&
              canonical.receiptId === replay.receiptId &&
              canonical.documentDigest === replay.documentDigest &&
              canonical.handedOffAt === replay.handedOffAt,
            "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
            "The replayed handoff result no longer matches its document.",
            { status: 500 }
          );
          return replay;
        }

        const commandRowId = generatedId(
          handoffIds,
          "custom_build_handoff_command"
        );
        await client.query(
          `/* handoff:command-insert */
           insert into ss.idempotency_keys (
             id, organization_id, principal_id, route_key,
             idempotency_key, request_digest, state,
             resource_type, created_at, expires_at
           ) values (
             $1, $2, $3, $4, $5, $6, 'running',
             'custom_build_handoff', clock_timestamp(),
             clock_timestamp() + interval '30 days'
           )`,
          [
            commandRowId,
            input.organizationId,
            input.operatorId,
            COMMAND_ROUTE,
            input.commandId,
            selectedRequestDigest
          ]
        );

        const selected = one(
          await client.query(
            `/* handoff:context */
             ${HANDOFF_CONTEXT_SELECT}
             where obligation.organization_id = $1
               and obligation.job_id = $2
             for update of obligation, package`,
            [input.organizationId, input.jobId]
          ),
          "Custom-build handoff authority"
        );
        const context = baseContext(selected);
        invariant(
          context.completionPackageDigest ===
            input.expectedCompletionPackageDigest &&
            context.obligationDigest ===
              input.expectedFinalObligationDigest,
          "CUSTOM_BUILD_HANDOFF_CHANGED",
          "The completion package or final obligation changed. Refresh before handing off.",
          { status: 409 }
        );
        invariant(
          !context.hasUnsettledAttempt &&
            !context.hasUnsettledEvent &&
            !context.hasRunningReconciliationCommand,
          "CUSTOM_BUILD_HANDOFF_PAYMENT_RECONCILIATION_REQUIRED",
          "Final-payment reconciliation must finish before handoff.",
          { status: 409 }
        );
        const clearance = clearanceFromRow(selected, {
          requireCleared: true
        });
        const created = one(
          await client.query(
            `/* handoff:create */
             select *
             from ss.create_service_custom_build_handoff(
               $1, $2, $3, $4::ss.sha256_hex, $5::ss.sha256_hex,
               $6, $7::jsonb
             )`,
            [
              input.jobId,
              input.commandId,
              input.organizationId,
              input.expectedCompletionPackageDigest,
              input.expectedFinalObligationDigest,
              input.customerSummary,
              JSON.stringify(databaseDeliveryManifest(input.deliveryManifest))
            ]
          ),
          "database-created Custom-build handoff"
        );
        const receiptId = storedUuid(created.receipt_id, "handoff receipt ID");
        const documentId = storedUuid(created.document_id, "handoff document ID");
        storedDigest(created.handoff_digest, "handoff receipt digest");
        const handedOffAt = storedIso(created.handed_off_at, "handoff time");
        const workmanshipStartsAt = storedIso(
          created.workmanship_starts_at,
          "workmanship start"
        );
        const workmanshipEndsAt = storedIso(
          created.workmanship_ends_at,
          "workmanship end"
        );
        workmanship({
          handedOffAt,
          startsAt: workmanshipStartsAt,
          endsAt: workmanshipEndsAt
        });
        const retained = one(
          await client.query(
            `/* handoff:created-context */
             ${HANDOFF_CONTEXT_SELECT}
             where obligation.organization_id = $1
               and obligation.job_id = $2
             for update of obligation, package`,
            [input.organizationId, input.jobId]
          ),
          "created Custom-build handoff"
        );
        const retainedContext = baseContext(retained);
        const retainedClearance = clearanceFromRow(retained, {
          requireCleared: true
        });
        const document = retainedDocument(retained);
        invariant(
          retainedContext.jobId === context.jobId &&
            retainedContext.completionPackageDigest ===
              context.completionPackageDigest &&
            retainedContext.obligationDigest === context.obligationDigest &&
            retainedClearance.kind === clearance.kind &&
            retainedClearance.referenceId === clearance.referenceId &&
            document.receiptId === receiptId &&
            document.documentId === documentId &&
            retained.handoff_digest === created.handoff_digest &&
            document.handedOffAt === handedOffAt &&
            document.workmanship.startsAt === workmanshipStartsAt &&
            document.workmanship.endsAt === workmanshipEndsAt,
          "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
          "The retained handoff receipt changed.",
          { status: 500 }
        );
        const result = handoffResult({
          schema: CUSTOM_BUILD_HANDOFF_COMMAND_SCHEMA,
          state: "handed_off",
          organizationId: context.organizationId,
          projectId: context.projectId,
          jobId: context.jobId,
          receiptId,
          documentId,
          documentDigest: document.contentDigest,
          completionPackageDigest: context.completionPackageDigest,
          finalObligationDigest: context.obligationDigest,
          financialClearance: clearance,
          handedOffAt,
          workmanship: document.workmanship
        });
        const completed = await client.query(
          `/* handoff:command-complete */
           update ss.idempotency_keys
           set
             state = 'completed',
             response_status = 201,
             response_body = $4::jsonb,
             resource_id = $5
           where principal_id = $1
             and route_key = $2
             and idempotency_key = $3
             and state = 'running'`,
          [
            input.operatorId,
            COMMAND_ROUTE,
            input.commandId,
            JSON.stringify(result),
            receiptId
          ]
        );
        invariant(
          completed.rowCount === 1,
          "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT",
          "The handoff command could not be sealed.",
          { status: 500 }
        );
        return result;
      }
    ));
  }

  return Object.freeze({
    async readiness() {
      return translated(() => database.service(
        { readOnly: true },
        async (client) => {
          const selected = one(
            await client.query(
              `/* handoff:readiness */
               select ss.hosted_runtime_contract_v47() as runtime_contract`
            ),
            "Custom-build handoff runtime contract"
          );
          invariant(
            selected.runtime_contract === RUNTIME_CONTRACT,
            "CUSTOM_BUILD_HANDOFF_HELD",
            "Custom-build handoff storage is not ready.",
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
    readCustomer,
    readCustomerDocument,
    readOwner,
    createHandoff
  });
}
