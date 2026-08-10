import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

export const CUSTOM_BUILD_OWNER_OPPORTUNITIES_SCHEMA =
  "sitesourcery.custom-services-owner-custom-build-opportunities/v1";
export const CUSTOM_BUILD_OWNER_QUOTE_SCHEMA =
  "sitesourcery.custom-services-owner-custom-build-quote/v1";
export const CUSTOM_BUILD_CUSTOMER_QUOTE_SCHEMA =
  "sitesourcery.custom-services-custom-build-quote/v1";

const RUNTIME_CONTRACT =
  "canonical-ss-v41-custom-build-quote-credit";
const DIRECT_CONTRACT =
  "canonical-custom-direct-v1-engagement-optional-credit";
const COMMERCIAL_CONTRACT_ID = "SS-CUSTOM-SERVICES-2026-08-05.1";
const COMMERCIAL_CONTRACT_DIGEST =
  "9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8";
const LEGAL_DOCUMENT_ID = "00000000-0000-4000-8000-000000000342";
const ISSUE_ROUTE = "custom-services.custom-build-quote.issue";
const ISSUE_DIRECT_ROUTE = "custom-services.custom-build-quote.issue-direct";
const ACCEPT_ROUTE = "custom-services.custom-build-quote.accept";
const VOID_ROUTE = "custom-services.custom-build-quote.void";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const TIERS = new Set([
  "card",
  "card-plus",
  "site",
  "site-plus",
  "signature",
  "flagship",
  "scale"
]);

function exactKeys(value, expected, field, options = {}) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    options.code ?? "invalid_input",
    `${field} is invalid`,
    { status: options.status ?? 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return value;
}

function sha(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return value;
}

function actorId(value, message) {
  if (!value || typeof value.userId !== "string" || !UUID.test(value.userId)) {
    throw new HostedError(
      "AUTHENTICATION_REQUIRED",
      message,
      { status: 401 }
    );
  }
  return value.userId;
}

function commandId(value) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      value.length >= 8 &&
      value.length <= 200 &&
      !CONTROL_CHARACTER.test(value),
    "invalid_input",
    "commandId is invalid",
    { status: 400 }
  );
  return value;
}

function text(value, field, minimum, maximum) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      value.length >= minimum &&
      value.length <= maximum &&
      !CONTROL_CHARACTER.test(value),
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return value;
}

function integer(value, field, minimum, maximum) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) &&
      selected >= minimum &&
      selected <= maximum,
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return selected;
}

function tier(value) {
  invariant(
    typeof value === "string" && TIERS.has(value),
    "invalid_input",
    "tierId is invalid",
    { status: 400 }
  );
  return value;
}

function canonicalDate(value, field, { future = false } = {}) {
  let selected = null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    try {
      selected = new Date(`${value}T00:00:00.000Z`)
        .toISOString()
        .slice(0, 10);
    } catch {
      selected = null;
    }
  }
  invariant(
    selected === value && (!future || Date.parse(`${value}T23:59:59.999Z`) > Date.now()),
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return value;
}

function futureIso(value, field) {
  const milliseconds = typeof value === "string" ? Date.parse(value) : NaN;
  invariant(
    Number.isFinite(milliseconds) &&
      new Date(milliseconds).toISOString() === value &&
      milliseconds > Date.now(),
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return value;
}

function issueInput(value) {
  exactKeys(
    value,
    [
      "commandId",
      "contentWords",
      "creditSelection",
      "craftedPages",
      "expiresAt",
      "organizationId",
      "scopeStatement",
      "sections",
      "suppliedMedia",
      "targetCompletionDate",
      "tierId",
      "uniqueLayouts"
    ],
    "customBuildQuoteIssueInput"
  );
  return Object.freeze({
    commandId: commandId(value.commandId),
    contentWords: integer(value.contentWords, "contentWords", 0, 14500),
    creditSelection: (() => {
      invariant(
        value.creditSelection === "no_credit" ||
          value.creditSelection === "apply_assessment_credit",
        "invalid_input",
        "creditSelection is invalid",
        { status: 400 }
      );
      return value.creditSelection;
    })(),
    craftedPages: integer(value.craftedPages, "craftedPages", 1, 30),
    expiresAt: futureIso(value.expiresAt, "expiresAt"),
    organizationId: uuid(value.organizationId, "organizationId"),
    scopeStatement: text(value.scopeStatement, "scopeStatement", 20, 2000),
    sections: integer(value.sections, "sections", 1, 120),
    suppliedMedia: integer(value.suppliedMedia, "suppliedMedia", 0, 120),
    targetCompletionDate: canonicalDate(
      value.targetCompletionDate,
      "targetCompletionDate",
      { future: true }
    ),
    tierId: tier(value.tierId),
    uniqueLayouts: integer(value.uniqueLayouts, "uniqueLayouts", 1, 30)
  });
}

function voidInput(value) {
  exactKeys(
    value,
    ["commandId", "organizationId", "reason"],
    "customBuildQuoteVoidInput"
  );
  return Object.freeze({
    commandId: commandId(value.commandId),
    organizationId: uuid(value.organizationId, "organizationId"),
    reason: text(value.reason, "reason", 10, 500)
  });
}

function customerScope(value) {
  exactKeys(
    value,
    ["actorId", "customerId", "organizationId", "projectId"],
    "customBuildCustomerScope"
  );
  const customerId = uuid(value.customerId, "customerId");
  invariant(
    uuid(value.actorId, "actorId") === customerId,
    "project_unavailable",
    "the Custom build project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    actorId: customerId,
    customerId,
    organizationId: uuid(value.organizationId, "organizationId"),
    projectId: uuid(value.projectId, "projectId")
  });
}

function acceptanceInput(value) {
  exactKeys(
    value,
    [
      "acceptanceStatement",
      "acceptedDisclosureDigest",
      "acceptedQuoteDigest",
      "actorId",
      "commandId",
      "customerId",
      "organizationId",
      "projectId",
      "quoteId",
      "quoteRevision"
    ],
    "customBuildQuoteAcceptanceInput"
  );
  const scope = customerScope({
    actorId: value.actorId,
    customerId: value.customerId,
    organizationId: value.organizationId,
    projectId: value.projectId
  });
  invariant(
    value.acceptanceStatement === "accepted_exact_custom_build_quote",
    "invalid_input",
    "acceptanceStatement is invalid",
    { status: 400 }
  );
  return Object.freeze({
    ...scope,
    acceptanceStatement: value.acceptanceStatement,
    acceptedDisclosureDigest: sha(
      value.acceptedDisclosureDigest,
      "acceptedDisclosureDigest"
    ),
    acceptedQuoteDigest: sha(value.acceptedQuoteDigest, "acceptedQuoteDigest"),
    commandId: commandId(value.commandId),
    quoteId: uuid(value.quoteId, "quoteId"),
    quoteRevision: integer(value.quoteRevision, "quoteRevision", 1, 1_000_000)
  });
}

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "invalid_configuration",
    "canonical PostgreSQL authority is required",
    { status: 500 }
  );
  return value;
}

function rows(result, field) {
  invariant(
    result &&
      Array.isArray(result.rows) &&
      Number.isSafeInteger(result.rowCount) &&
      result.rowCount === result.rows.length,
    "custom_build_repository_conflict",
    `${field} is unavailable`,
    { status: 500 }
  );
  return result.rows;
}

function one(result, field, { optional = false } = {}) {
  const selected = rows(result, field);
  invariant(
    selected.length <= 1,
    "custom_build_repository_conflict",
    `${field} conflicts`,
    { status: 500 }
  );
  if (selected.length === 0) {
    invariant(
      optional,
      "custom_build_changed",
      "That Custom build opportunity is no longer available.",
      { status: 409 }
    );
    return null;
  }
  return selected[0];
}

function iso(value, field) {
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    !Number.isNaN(selected.getTime()),
    "custom_build_repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected.toISOString();
}

function storedReceipt(value, expectedSchema) {
  invariant(
    value &&
      typeof value === "object" &&
      value.schema === expectedSchema,
    "custom_build_repository_conflict",
    "The stored Custom build receipt is invalid.",
    { status: 500 }
  );
  return deepFreeze(structuredClone(value));
}

function number(value, field, { zero = false } = {}) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) && selected >= (zero ? 0 : 1),
    "custom_build_repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function storedCanonicalDate(value, field) {
  invariant(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value),
    "custom_build_repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  const selected = new Date(`${value}T00:00:00.000Z`);
  invariant(
    !Number.isNaN(selected.getTime()) &&
      selected.toISOString().slice(0, 10) === value,
    "custom_build_repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return value;
}

function quoteProjection(row) {
  if (row.quote_id === null || row.quote_id === undefined) return null;
  invariant(
    ["issued", "accepted", "voided"].includes(row.quote_state) &&
      TIERS.has(row.tier_id) &&
      SHA256.test(String(row.quote_digest ?? "")) &&
      SHA256.test(String(row.disclosure_digest ?? "")) &&
      row.commercial_contract_id === COMMERCIAL_CONTRACT_ID &&
      row.commercial_contract_digest === COMMERCIAL_CONTRACT_DIGEST &&
      row.legal_document_id === LEGAL_DOCUMENT_ID &&
      ["direct", "assessment_successor"].includes(row.origin) &&
      ["no_credit", "apply_assessment_credit"].includes(
        row.credit_selection
      ) &&
      (row.credit_selection === "apply_assessment_credit"
        ? Number(row.credit_amount_minor) === 20_000
        : Number(row.credit_amount_minor) === 0) &&
      Array.isArray(row.installments),
    "custom_build_repository_conflict",
    "The stored Custom build quote is incomplete.",
    { status: 500 }
  );
  const paymentRule = row.payment_schedule === "full_before_work"
    ? "The remaining balance is due before build work begins."
    : "The remaining first installment is due before build work begins; the final installment is due before final launch or handoff.";
  const acceptance = row.accepted_at === null || row.accepted_at === undefined
    ? null
    : Object.freeze({
        schema: "sitesourcery.custom-build-quote-acceptance-receipt/v1",
        acceptedAt: iso(row.accepted_at, "acceptedAt"),
        acceptedQuoteDigest: row.accepted_quote_digest,
        acceptedDisclosureDigest: row.accepted_disclosure_digest,
        commercialContractId: row.commercial_contract_id,
        commercialContractDigest: row.commercial_contract_digest,
        legalDocumentId: row.legal_document_id
      });
  invariant(
    acceptance === null ||
      (SHA256.test(String(acceptance.acceptedQuoteDigest ?? "")) &&
        SHA256.test(String(acceptance.acceptedDisclosureDigest ?? "")) &&
        acceptance.acceptedQuoteDigest === row.quote_digest &&
        acceptance.acceptedDisclosureDigest === row.disclosure_digest),
    "custom_build_repository_conflict",
    "The stored Custom build acceptance receipt changed.",
    { status: 500 }
  );
  invariant(
    (row.quote_state !== "accepted" || acceptance !== null) &&
      (row.quote_state !== "issued" || acceptance === null),
    "custom_build_repository_conflict",
    "The stored Custom build acceptance state is incomplete.",
    { status: 500 }
  );
  return deepFreeze({
    quoteId: row.quote_id,
    quoteRevision: number(row.quote_revision, "quoteRevision"),
    quoteDigest: row.quote_digest,
    disclosureDigest: row.disclosure_digest,
    state: row.quote_state,
    origin: row.origin,
    creditSelection: row.credit_selection,
    tier: {
      id: row.tier_id,
      label: row.tier_label,
      scaleUnits:
        row.scale_units === null ? null : number(row.scale_units, "scaleUnits"),
      footprint: {
        craftedPages: number(row.crafted_pages, "craftedPages"),
        sections: number(row.sections, "sections"),
        uniqueLayouts: number(row.unique_layouts, "uniqueLayouts"),
        contentWords: number(row.content_words, "contentWords", { zero: true }),
        suppliedMedia: number(row.supplied_media, "suppliedMedia", { zero: true })
      }
    },
    scopeStatement: row.scope_statement,
    terms: {
      schema: "sitesourcery.custom-build-quote-terms/v1",
      commercialContractId: row.commercial_contract_id,
      commercialContractDigest: row.commercial_contract_digest,
      legalDocumentId: row.legal_document_id,
      rules: [
        "This quote covers only the scope and footprint shown here. Added or changed work requires a separate written change order.",
        Number(row.credit_amount_minor) === 0
          ? "No assessment credit is applied to this quote."
          : "The assessment credit is non-cash, same-project, one-use value applied only to this Custom base build's first required installment.",
        paymentRule,
        "Tax and any separately stated third-party provider charges are not included in the base price and are shown before payment.",
        "Build work does not begin until the required first payment is verified.",
        "The 30-day workmanship correction covers reproducible defects in the accepted deliverables, not new content, features, changed decisions, third-party changes, or ongoing management."
      ]
    },
    pricing: {
      serviceAmountMinor: number(row.service_amount_minor, "serviceAmountMinor"),
      creditAmountMinor: number(
        row.credit_amount_minor,
        "creditAmountMinor",
        { zero: true }
      ),
      customerAmountMinor: number(row.customer_amount_minor, "customerAmountMinor"),
      currency: row.currency,
      taxState: row.tax_state,
      paymentSchedule: row.payment_schedule,
      startValueMinor: number(row.start_value_minor, "startValueMinor"),
      startCreditMinor: number(
        row.start_credit_minor,
        "startCreditMinor",
        { zero: true }
      ),
      startDueMinor: number(row.start_due_minor, "startDueMinor", { zero: true }),
      finalDueMinor: number(row.final_due_minor, "finalDueMinor", { zero: true }),
      installments: row.installments.map((entry) => Object.freeze({
        number: number(entry.number, "installment.number"),
        kind: entry.kind,
        grossValueMinor: number(entry.grossValueMinor, "installment.grossValueMinor"),
        creditAmountMinor: number(
          entry.creditAmountMinor,
          "installment.creditAmountMinor",
          { zero: true }
        ),
        amountDueMinor: number(
          entry.amountDueMinor,
          "installment.amountDueMinor",
          { zero: true }
        ),
        dueTrigger: entry.dueTrigger
      }))
    },
    workmanshipCorrectionDays: number(
      row.workmanship_correction_days,
      "workmanshipCorrectionDays"
    ),
    targetCompletionDate: storedCanonicalDate(
      row.target_completion_date,
      "targetCompletionDate"
    ),
    issuedAt: iso(row.issued_at, "issuedAt"),
    expiresAt: iso(row.expires_at, "expiresAt"),
    creditAcceptanceCutoff: row.credit_acceptance_cutoff === null
      ? null
      : iso(row.credit_acceptance_cutoff, "creditAcceptanceCutoff"),
    acceptance
  });
}

function creditProjection(row) {
  if (row.credit_id === null || row.credit_id === undefined) return null;
  const state = row.credit_application_state ?? (
    Date.parse(iso(row.credit_cutoff, "creditCutoff")) > Date.now()
      ? "available"
      : "expired"
  );
  return Object.freeze({
    creditId: row.credit_id,
    amountMinor: number(row.credit_amount, "creditAmount"),
    currency: row.credit_currency,
    state,
    acceptanceCutoff: iso(row.credit_cutoff, "creditCutoff")
  });
}

function customerSnapshot(row, scope) {
  const quote = row === null ? null : quoteProjection(row);
  return deepFreeze({
    schema: CUSTOM_BUILD_CUSTOMER_QUOTE_SCHEMA,
    state: quote?.state ?? "not_available",
    projectId: scope.projectId,
    customerId: scope.customerId,
    credit: row === null ? null : creditProjection(row),
    quote
  });
}

const QUOTE_COLUMNS = `
  quote.id as quote_id,
  quote.state as quote_state,
  quote.origin,
  quote.credit_selection,
  revision.quote_revision,
  revision.quote_digest,
  revision.disclosure_digest,
  revision.commercial_contract_id,
  revision.commercial_contract_digest,
  revision.legal_document_id,
  revision.tier_id,
  ss.custom_build_tier_label(revision.tier_id) as tier_label,
  revision.scale_units,
  revision.crafted_pages,
  revision.sections,
  revision.unique_layouts,
  revision.content_words,
  revision.supplied_media,
  revision.scope_statement,
  revision.service_amount_minor,
  revision.credit_amount_minor,
  revision.customer_amount_minor,
  revision.currency,
  revision.tax_state,
  revision.payment_schedule,
  revision.start_value_minor,
  revision.start_credit_minor,
  revision.start_due_minor,
  revision.final_due_minor,
  revision.workmanship_correction_days,
  revision.target_completion_date::text as target_completion_date,
  revision.issued_at,
  revision.expires_at,
  revision.credit_acceptance_cutoff,
  acceptance.accepted_quote_digest,
  acceptance.accepted_disclosure_digest,
  acceptance.accepted_at,
  coalesce(installment_rows.items, '[]'::jsonb) as installments`;

const QUOTE_JOINS = `
  left join ss.service_custom_build_quote_revisions revision
    on revision.organization_id = quote.organization_id
   and revision.quote_id = quote.id
   and revision.quote_revision = quote.current_revision
  left join ss.service_custom_build_quote_acceptances acceptance
    on acceptance.organization_id = quote.organization_id
   and acceptance.quote_id = quote.id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'amountDueMinor', installment.amount_due_minor,
        'creditAmountMinor', installment.credit_amount_minor,
        'dueTrigger', installment.due_trigger,
        'grossValueMinor', installment.gross_value_minor,
        'kind', installment.installment_kind,
        'number', installment.installment_number
      ) order by installment.installment_number
    ) as items
    from ss.service_custom_build_quote_installments installment
    where installment.organization_id = revision.organization_id
      and installment.quote_revision_id = revision.id
  ) installment_rows on true`;

async function selectQuoteById(client, quoteId) {
  return one(
    await client.query(
      `select
         ${QUOTE_COLUMNS},
         credit.id as credit_id,
         credit.amount_minor as credit_amount,
         credit.currency as credit_currency,
         credit.acceptance_cutoff as credit_cutoff,
         application.state as credit_application_state,
         quote.organization_id,
         quote.project_id,
         quote.case_id,
         quote.customer_user_id,
         quote.direct_opportunity_id,
         quote.source_job_id,
         quote.source_report_id
       from ss.service_custom_build_quotes quote
       ${QUOTE_JOINS}
       left join ss.service_credit_grants credit
         on credit.organization_id = revision.organization_id
        and credit.id = revision.credit_grant_id
        and credit.credit_digest = revision.credit_digest
       left join ss.service_credit_applications application
         on application.organization_id = quote.organization_id
        and application.quote_id = quote.id
      where quote.id = $1`,
      [quoteId]
    ),
    "customBuildQuote"
  );
}

function ownerReceipt(row) {
  return deepFreeze({
    schema: CUSTOM_BUILD_OWNER_QUOTE_SCHEMA,
    state: row.quote_state,
    organizationId: row.organization_id,
    projectId: row.project_id,
    caseId: row.case_id,
    customerId: row.customer_user_id,
    origin: row.origin,
    directOpportunityId: row.direct_opportunity_id,
    jobId: row.source_job_id,
    reportId: row.source_report_id,
    credit: creditProjection(row),
    quote: quoteProjection(row)
  });
}

function opportunity(row) {
  return deepFreeze({
    origin: row.opportunity_origin,
    engagementId: row.engagement_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    projectId: row.project_id,
    projectName: row.project_name,
    caseId: row.case_id,
    customer: {
      customerId: row.customer_user_id,
      name: row.customer_name,
      email: row.customer_email
    },
    assessment: row.report_id === null
      ? null
      : {
          jobId: row.job_id,
          reportId: row.report_id,
          deliveredAt: iso(row.delivered_at, "deliveredAt")
        },
    credit: creditProjection(row),
    currentQuote: quoteProjection(row)
  });
}

async function requireOperator(client, operatorUserId) {
  const selected = one(
    await client.query(
      `select ss.service_operator_has_capability(
         $1, 'service_quote_author', clock_timestamp()
       ) as authorized`,
      [operatorUserId]
    ),
    "customBuildOperator"
  );
  invariant(
    selected.authorized === true,
    "OPERATOR_ACCESS_REQUIRED",
    "Custom build quote tools are unavailable for this account.",
    { status: 403 }
  );
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (
    error?.code === "42501" &&
    /operator|capability/iu.test(String(error.message ?? ""))
  ) {
    return new HostedError(
      "OPERATOR_ACCESS_REQUIRED",
      "Custom build quote tools are unavailable for this account.",
      { status: 403 }
    );
  }
  if (error?.code === "42501") {
    return new HostedError(
      "custom_build_unavailable",
      "That Custom build opportunity is unavailable.",
      { status: 404 }
    );
  }
  if (
    [
      "22001",
      "22P02",
      "23502",
      "23503",
      "23505",
      "23514",
      "40001",
      "40P01",
      "55000"
    ].includes(error?.code)
  ) {
    return new HostedError(
      "custom_build_changed",
      "That Custom build quote changed. Refresh before trying again.",
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

async function priorCommand(
  client,
  {
    principalId,
    routeKey,
    commandId: selectedCommandId,
    requestDigest,
    responseSchema
  }
) {
  const prior = one(
    await client.query(
      `select request_digest, state, response_body
         from ss.idempotency_keys
        where principal_id = $1
          and route_key = $2
          and idempotency_key = $3
        for update`,
      [principalId, routeKey, selectedCommandId]
    ),
    "customBuildCommand",
    { optional: true }
  );
  if (prior === null) return null;
  invariant(
    prior.request_digest === requestDigest,
    "idempotency_conflict",
    "That command ID was already used for a different action.",
    { status: 409 }
  );
  invariant(
    prior.state === "completed",
    "command_in_progress",
    "That Custom build action has not reached a safe final state.",
    { status: 409 }
  );
  return storedReceipt(prior.response_body, responseSchema);
}

async function openCommand(
  client,
  {
    organizationId,
    principalId,
    routeKey,
    commandId: selectedCommandId,
    requestDigest
  }
) {
  await client.query(
    `insert into ss.idempotency_keys (
       organization_id,
       principal_id,
       route_key,
       idempotency_key,
       request_digest,
       state,
       expires_at
     ) values (
       $1, $2, $3, $4, $5, 'running',
       clock_timestamp() + interval '24 hours'
     )`,
    [
      organizationId,
      principalId,
      routeKey,
      selectedCommandId,
      requestDigest
    ]
  );
}

async function completeCommand(
  client,
  {
    organizationId,
    principalId,
    routeKey,
    commandId: selectedCommandId,
    receipt
  }
) {
  const completed = await client.query(
    `update ss.idempotency_keys
        set state = 'completed',
            response_status = 200,
            response_body = $5::jsonb,
            resource_type = 'custom_service_custom_build_quote',
            resource_id = $6
      where organization_id = $1
        and principal_id = $2
        and route_key = $3
        and idempotency_key = $4
        and state = 'running'`,
    [
      organizationId,
      principalId,
      routeKey,
      selectedCommandId,
      JSON.stringify(receipt),
      receipt.quote.quoteId
    ]
  );
  invariant(
    completed.rowCount === 1,
    "custom_build_repository_conflict",
    "The Custom build command could not be completed.",
    { status: 500 }
  );
}

export function createHeldCustomServicesCustomBuild() {
  const held = (actor) => {
    actorId(actor, "Sign in before opening Custom build quotes.");
    throw new HostedError(
      "CUSTOM_BUILD_HELD",
      "Custom build quote tools are held in this runtime.",
      { status: 503 }
    );
  };
  return Object.freeze({
    async listOpportunities(actor) {
      return held(actor);
    },
    async issueQuote(actor) {
      return held(actor);
    },
    async issueDirectQuote(actor) {
      return held(actor);
    },
    async voidQuote(actor) {
      return held(actor);
    },
    async readCurrentQuote(scope) {
      customerScope(scope);
      throw new HostedError(
        "CUSTOM_BUILD_HELD",
        "Custom build quote tools are held in this runtime.",
        { status: 503 }
      );
    },
    async acceptCurrentQuote(value) {
      acceptanceInput(value);
      throw new HostedError(
        "CUSTOM_BUILD_HELD",
        "Custom build quote tools are held in this runtime.",
        { status: 503 }
      );
    }
  });
}

export function createPostgresCustomServicesCustomBuild({
  authority,
  randomUUID = systemRandomUUID
} = {}) {
  const database = validateAuthority(authority);
  invariant(
    typeof randomUUID === "function",
    "invalid_configuration",
    "Custom build ID generator is required",
    { status: 500 }
  );

  return Object.freeze({
    async readiness() {
      return translated(() =>
        database.service(
          { readOnly: true },
          async (client) => {
            const selected = one(
              await client.query(
                `select
                   ss.hosted_runtime_contract_v41() as runtime_contract,
                   ss.custom_build_direct_contract_v1() as direct_contract,
                   (
                     select count(*) = 7
                     from ss.service_catalog_policies policy
                     where policy.catalog_version = 'SS-PROFESSIONAL-2026.2'
                       and policy.service_key like 'custom_build_%'
                       and policy.publication_state = 'held'
                   ) as exact_catalog`
              ),
              "customBuildReadiness"
            );
            invariant(
              selected.runtime_contract === RUNTIME_CONTRACT &&
                selected.direct_contract === DIRECT_CONTRACT &&
                selected.exact_catalog === true,
              "CUSTOM_BUILD_HELD",
              "Custom build quote storage is not ready.",
              { status: 503 }
            );
            return deepFreeze({
              schema: "sitesourcery.custom-services-custom-build-readiness/v1",
              ready: true,
              runtimeContract: selected.runtime_contract,
              directContract: selected.direct_contract
            });
          }
        )
      );
    },

    async listOpportunities(actor) {
      const operatorUserId = actorId(
        actor,
        "Sign in before opening Custom build quote tools."
      );
      return translated(() =>
        database.service(
          { userId: operatorUserId, readOnly: true },
          async (client) => {
            await requireOperator(client, operatorUserId);
            const selected = await client.query(
              `select
                 'assessment_successor'::text as opportunity_origin,
                 null::uuid as engagement_id,
                 report.organization_id,
                 organization.name as organization_name,
                 report.project_id,
                 project.name as project_name,
                 report.case_id,
                 report.customer_user_id,
                 account_profile.display_name as customer_name,
                 account_user.email as customer_email,
                 report.job_id,
                 report.id as report_id,
                 report.delivered_at,
                 credit.id as credit_id,
                 credit.amount_minor as credit_amount,
                 credit.currency as credit_currency,
                 credit.acceptance_cutoff as credit_cutoff,
                 application.state as credit_application_state,
                 ${QUOTE_COLUMNS}
               from ss.service_assessment_reports report
               join ss.service_credit_grants credit
                 on credit.organization_id = report.organization_id
                and credit.source_report_id = report.id
               join ss.organizations organization
                 on organization.id = report.organization_id
                and organization.state = 'active'
               join ss.projects project
                 on project.organization_id = report.organization_id
                and project.id = report.project_id
                and project.lifecycle = 'active'
               join auth.users account_user
                 on account_user.id = report.customer_user_id
                and account_user.disabled_at is null
               join ss.hosted_account_profiles account_profile
                 on account_profile.user_id = report.customer_user_id
                and account_profile.state = 'active'
               left join lateral (
                 select candidate.*
                 from ss.service_custom_build_quotes candidate
                 where candidate.organization_id = report.organization_id
                   and candidate.project_id = report.project_id
                   and candidate.source_report_id = report.id
                 order by candidate.created_at desc, candidate.id desc
                 limit 1
               ) quote on true
               ${QUOTE_JOINS}
               left join ss.service_credit_applications application
                 on application.organization_id = report.organization_id
                and application.quote_id = quote.id
              union all
              select
                 'direct'::text as opportunity_origin,
                 engagement.id as engagement_id,
                 opportunity.organization_id,
                 organization.name as organization_name,
                 opportunity.project_id,
                 project.name as project_name,
                 opportunity.case_id,
                 opportunity.customer_user_id,
                 account_profile.display_name as customer_name,
                 account_user.email as customer_email,
                 null::uuid as job_id,
                 null::uuid as report_id,
                 null::timestamptz as delivered_at,
                 null::uuid as credit_id,
                 null::bigint as credit_amount,
                 null::text as credit_currency,
                 null::timestamptz as credit_cutoff,
                 null::text as credit_application_state,
                 ${QUOTE_COLUMNS}
               from ss.service_custom_build_direct_opportunities opportunity
               join ss.customer_engagements engagement
                 on engagement.id = opportunity.engagement_id
                and engagement.engagement_digest = opportunity.engagement_digest
                and engagement.provenance = 'direct_custom_inquiry'
               join ss.organizations organization
                 on organization.id = opportunity.organization_id
                and organization.state = 'active'
               join ss.projects project
                 on project.organization_id = opportunity.organization_id
                and project.id = opportunity.project_id
                and project.lifecycle = 'active'
               join auth.users account_user
                 on account_user.id = opportunity.customer_user_id
                and account_user.disabled_at is null
               join ss.hosted_account_profiles account_profile
                 on account_profile.user_id = opportunity.customer_user_id
                and account_profile.state = 'active'
               left join lateral (
                 select candidate.*
                   from ss.service_custom_build_quotes candidate
                  where candidate.organization_id = opportunity.organization_id
                    and candidate.project_id = opportunity.project_id
                    and candidate.direct_opportunity_id = opportunity.id
                  order by candidate.created_at desc, candidate.id desc
                  limit 1
               ) quote on true
               ${QUOTE_JOINS}
               left join ss.service_credit_applications application
                 on false
              order by delivered_at asc nulls first, project_id asc
              limit 100`
            );
            return deepFreeze({
              schema: CUSTOM_BUILD_OWNER_OPPORTUNITIES_SCHEMA,
              opportunities: selected.rows.map(opportunity)
            });
          }
        )
      );
    },

    async issueQuote(actor, jobIdInput, value) {
      const operatorUserId = actorId(
        actor,
        "Sign in before issuing a Custom build quote."
      );
      const jobId = uuid(jobIdInput, "jobId");
      const input = issueInput(value);
      const requestDigest = digest({
        route: ISSUE_ROUTE,
        operatorUserId,
        jobId,
        ...input
      });
      return translated(() =>
        database.service(
          {
            actorKind: "operator",
            userId: operatorUserId,
            organizationId: input.organizationId
          },
          async (client) => {
            await requireOperator(client, operatorUserId);
            await client.query(
              "select pg_advisory_xact_lock(hashtextextended($1, 0))",
              [`custom-build-issue:${input.organizationId}:${jobId}`]
            );
            const prior = await priorCommand(client, {
              principalId: operatorUserId,
              routeKey: ISSUE_ROUTE,
              commandId: input.commandId,
              requestDigest,
              responseSchema: CUSTOM_BUILD_OWNER_QUOTE_SCHEMA
            });
            if (prior !== null) return prior;

            const source = one(
              await client.query(
                `select report.id as report_id
                 from ss.service_assessment_reports report
                 join ss.service_credit_grants credit
                   on credit.organization_id = report.organization_id
                  and credit.source_report_id = report.id
                 where report.organization_id = $1
                   and report.job_id = $2
                   and (
                     $3 = 'no_credit'
                     or (
                       credit.acceptance_cutoff > clock_timestamp()
                       and not exists (
                         select 1
                         from ss.service_credit_applications application
                         where application.credit_grant_id = credit.id
                           and application.state in (
                             'reserved', 'settled', 'reconciliation_required'
                           )
                       )
                     )
                   )`,
                [input.organizationId, jobId, input.creditSelection]
              ),
              "customBuildOpportunity"
            );
            await openCommand(client, {
              organizationId: input.organizationId,
              principalId: operatorUserId,
              routeKey: ISSUE_ROUTE,
              commandId: input.commandId,
              requestDigest
            });

            const quoteId = uuid(randomUUID(), "generated quoteId");
            const revisionId = uuid(randomUUID(), "generated revisionId");
            await client.query(
              `insert into ss.service_custom_build_quotes (
                 id, origin, source_report_id, credit_selection,
                 created_by_operator_user_id
               ) values ($1, 'assessment_successor', $2, $3, $4)`,
              [
                quoteId,
                source.report_id,
                input.creditSelection,
                operatorUserId
              ]
            );
            await client.query(
              `insert into ss.service_custom_build_quote_revisions (
                 id,
                 quote_id,
                 tier_id,
                 crafted_pages,
                 sections,
                 unique_layouts,
                 content_words,
                 supplied_media,
                 scope_statement,
                 target_completion_date,
                 expires_at
               ) values (
                 $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
               )`,
              [
                revisionId,
                quoteId,
                input.tierId,
                input.craftedPages,
                input.sections,
                input.uniqueLayouts,
                input.contentWords,
                input.suppliedMedia,
                input.scopeStatement,
                input.targetCompletionDate,
                input.expiresAt
              ]
            );
            await client.query(
              `insert into ss.service_custom_build_quote_commands (
                 quote_id, command_id
               ) values ($1, $2)`,
              [quoteId, input.commandId]
            );
            const receipt = ownerReceipt(
              await selectQuoteById(client, quoteId)
            );
            await completeCommand(client, {
              organizationId: input.organizationId,
              principalId: operatorUserId,
              routeKey: ISSUE_ROUTE,
              commandId: input.commandId,
              receipt
            });
            return receipt;
          }
        )
      );
    },

    async issueDirectQuote(actor, projectIdInput, value) {
      const operatorUserId = actorId(
        actor,
        "Sign in before issuing a direct Custom build quote."
      );
      const projectId = uuid(projectIdInput, "projectId");
      const input = issueInput(value);
      invariant(
        input.creditSelection === "no_credit",
        "invalid_input",
        "A direct Custom opportunity cannot apply an assessment credit.",
        { status: 400 }
      );
      const requestDigest = digest({
        route: ISSUE_DIRECT_ROUTE,
        operatorUserId,
        projectId,
        ...input
      });
      return translated(() =>
        database.service(
          {
            actorKind: "operator",
            userId: operatorUserId,
            organizationId: input.organizationId
          },
          async (client) => {
            await requireOperator(client, operatorUserId);
            await client.query(
              "select pg_advisory_xact_lock(hashtextextended($1, 0))",
              [`custom-build-issue:${input.organizationId}:${projectId}`]
            );
            const prior = await priorCommand(client, {
              principalId: operatorUserId,
              routeKey: ISSUE_DIRECT_ROUTE,
              commandId: input.commandId,
              requestDigest,
              responseSchema: CUSTOM_BUILD_OWNER_QUOTE_SCHEMA
            });
            if (prior !== null) return prior;

            const source = one(
              await client.query(
                `select opportunity.id
                   from ss.service_custom_build_direct_opportunities opportunity
                   join ss.customer_engagements engagement
                     on engagement.id = opportunity.engagement_id
                    and engagement.engagement_digest = opportunity.engagement_digest
                    and engagement.provenance = 'direct_custom_inquiry'
                  where opportunity.organization_id = $1
                    and opportunity.project_id = $2
                    and opportunity.state = 'available'`,
                [input.organizationId, projectId]
              ),
              "customBuildDirectOpportunity"
            );
            await openCommand(client, {
              organizationId: input.organizationId,
              principalId: operatorUserId,
              routeKey: ISSUE_DIRECT_ROUTE,
              commandId: input.commandId,
              requestDigest
            });

            const quoteId = uuid(randomUUID(), "generated quoteId");
            const revisionId = uuid(randomUUID(), "generated revisionId");
            await client.query(
              `insert into ss.service_custom_build_quotes (
                 id, origin, direct_opportunity_id, credit_selection,
                 created_by_operator_user_id
               ) values ($1, 'direct', $2, 'no_credit', $3)`,
              [quoteId, source.id, operatorUserId]
            );
            await client.query(
              `insert into ss.service_custom_build_quote_revisions (
                 id, quote_id, tier_id, crafted_pages, sections,
                 unique_layouts, content_words, supplied_media,
                 scope_statement, target_completion_date, expires_at
               ) values (
                 $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
               )`,
              [
                revisionId,
                quoteId,
                input.tierId,
                input.craftedPages,
                input.sections,
                input.uniqueLayouts,
                input.contentWords,
                input.suppliedMedia,
                input.scopeStatement,
                input.targetCompletionDate,
                input.expiresAt
              ]
            );
            await client.query(
              `insert into ss.service_custom_build_quote_commands (
                 quote_id, command_id
               ) values ($1, $2)`,
              [quoteId, input.commandId]
            );
            const receipt = ownerReceipt(
              await selectQuoteById(client, quoteId)
            );
            await completeCommand(client, {
              organizationId: input.organizationId,
              principalId: operatorUserId,
              routeKey: ISSUE_DIRECT_ROUTE,
              commandId: input.commandId,
              receipt
            });
            return receipt;
          }
        )
      );
    },

    async voidQuote(actor, quoteIdInput, value) {
      const operatorUserId = actorId(
        actor,
        "Sign in before voiding a Custom build quote."
      );
      const quoteId = uuid(quoteIdInput, "quoteId");
      const input = voidInput(value);
      const requestDigest = digest({
        route: VOID_ROUTE,
        operatorUserId,
        quoteId,
        ...input
      });
      return translated(() =>
        database.service(
          {
            actorKind: "operator",
            userId: operatorUserId,
            organizationId: input.organizationId
          },
          async (client) => {
            await requireOperator(client, operatorUserId);
            await client.query(
              "select pg_advisory_xact_lock(hashtextextended($1, 0))",
              [`custom-build-void:${input.organizationId}:${quoteId}`]
            );
            const prior = await priorCommand(client, {
              principalId: operatorUserId,
              routeKey: VOID_ROUTE,
              commandId: input.commandId,
              requestDigest,
              responseSchema: CUSTOM_BUILD_OWNER_QUOTE_SCHEMA
            });
            if (prior !== null) return prior;
            await openCommand(client, {
              organizationId: input.organizationId,
              principalId: operatorUserId,
              routeKey: VOID_ROUTE,
              commandId: input.commandId,
              requestDigest
            });
            await client.query(
              `insert into ss.service_custom_build_quote_voids (
                 quote_id, command_id, reason
               ) values ($1, $2, $3)`,
              [quoteId, input.commandId, input.reason]
            );
            const receipt = ownerReceipt(
              await selectQuoteById(client, quoteId)
            );
            invariant(
              receipt.state === "voided",
              "custom_build_repository_conflict",
              "The Custom build quote was not safely voided.",
              { status: 500 }
            );
            await completeCommand(client, {
              organizationId: input.organizationId,
              principalId: operatorUserId,
              routeKey: VOID_ROUTE,
              commandId: input.commandId,
              receipt
            });
            return receipt;
          }
        )
      );
    },

    async readCurrentQuote(scopeInput) {
      const scope = customerScope(scopeInput);
      return translated(() =>
        database.service(
          { userId: scope.customerId, readOnly: true },
          async (client) => {
            const selected = one(
              await client.query(
                `select
                   credit.id as credit_id,
                   credit.amount_minor as credit_amount,
                   credit.currency as credit_currency,
                   credit.acceptance_cutoff as credit_cutoff,
                   application.state as credit_application_state,
                   ${QUOTE_COLUMNS}
                 from ss.service_custom_build_quotes quote
                 ${QUOTE_JOINS}
                 left join ss.service_credit_grants credit
                   on credit.organization_id = revision.organization_id
                  and credit.id = revision.credit_grant_id
                  and credit.credit_digest = revision.credit_digest
                 left join ss.service_credit_applications application
                   on application.organization_id = quote.organization_id
                  and application.quote_id = quote.id
                where quote.organization_id = $1
                  and quote.project_id = $2
                  and quote.customer_user_id = $3
                order by quote.created_at desc, quote.id desc
                limit 1`,
                [scope.organizationId, scope.projectId, scope.customerId]
              ),
              "customerCustomBuildQuote",
              { optional: true }
            );
            return customerSnapshot(selected, scope);
          }
        )
      );
    },

    async acceptCurrentQuote(value) {
      const input = acceptanceInput(value);
      const requestDigest = digest({
        route: ACCEPT_ROUTE,
        ...input
      });
      return translated(() =>
        database.service(
          {
            actorKind: "customer",
            userId: input.customerId,
            organizationId: input.organizationId
          },
          async (client) => {
            await client.query(
              "select pg_advisory_xact_lock(hashtextextended($1, 0))",
              [`custom-build-accept:${input.organizationId}:${input.projectId}`]
            );
            const prior = await priorCommand(client, {
              principalId: input.customerId,
              routeKey: ACCEPT_ROUTE,
              commandId: input.commandId,
              requestDigest,
              responseSchema: CUSTOM_BUILD_CUSTOMER_QUOTE_SCHEMA
            });
            if (prior !== null) {
              const currentRow = await selectQuoteById(
                client,
                input.quoteId
              );
              invariant(
                currentRow.organization_id === input.organizationId &&
                  currentRow.project_id === input.projectId &&
                  currentRow.customer_user_id === input.customerId,
                "project_unavailable",
                "the Custom build project is unavailable",
                { status: 404 }
              );
              return customerSnapshot(currentRow, input);
            }
            await openCommand(client, {
              organizationId: input.organizationId,
              principalId: input.customerId,
              routeKey: ACCEPT_ROUTE,
              commandId: input.commandId,
              requestDigest
            });
            await client.query(
              `insert into ss.service_custom_build_quote_acceptances (
                 quote_id,
                 quote_revision,
                 acceptance_statement,
                 accepted_quote_digest,
                 accepted_disclosure_digest,
                 command_id
               ) values ($1, $2, $3, $4, $5, $6)`,
              [
                input.quoteId,
                input.quoteRevision,
                input.acceptanceStatement,
                input.acceptedQuoteDigest,
                input.acceptedDisclosureDigest,
                input.commandId
              ]
            );
            const row = await selectQuoteById(client, input.quoteId);
            invariant(
              row.organization_id === input.organizationId &&
                row.project_id === input.projectId &&
                row.customer_user_id === input.customerId,
              "project_unavailable",
              "the Custom build project is unavailable",
              { status: 404 }
            );
            const receipt = ownerReceipt(row);
            invariant(
              receipt.state === "accepted" &&
                (receipt.quote.pricing.creditAmountMinor === 0
                  ? receipt.credit === null
                  : receipt.credit?.state === "reserved"),
              "custom_build_repository_conflict",
              "The Custom build acceptance did not retain its exact credit selection.",
              { status: 500 }
            );
            const snapshot = customerSnapshot(row, input);
            await completeCommand(client, {
              organizationId: input.organizationId,
              principalId: input.customerId,
              routeKey: ACCEPT_ROUTE,
              commandId: input.commandId,
              receipt: snapshot
            });
            return snapshot;
          }
        )
      );
    }
  });
}
