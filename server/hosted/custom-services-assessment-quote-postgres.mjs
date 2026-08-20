import { createHash, randomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import {
  CUSTOM_SERVICES_ASSESSMENT_QUOTE_SNAPSHOT_SCHEMA,
  projectCustomServicesAssessmentQuote
} from "./custom-services-assessment-quote.mjs";
import { HostedError, invariant } from "./errors.mjs";

export const CUSTOM_SERVICES_QUOTE_ACCEPTANCE_RECEIPT_SCHEMA =
  "sitesourcery.custom-services-quote-acceptance-receipt/v1";

const ASSESSMENT_POLICY_ID =
  "00000000-0000-4000-8000-000000001411";
const ACCEPTANCE_STATEMENT =
  "accepted_exact_quote_and_delivery_date";
const ACCEPT_ROUTE = "custom_services.assessment_quote.accept";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

function exactKeys(value, expected, field, { code = "repository_conflict", status = 500 } = {}) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    code,
    `${field} is invalid`,
    { status }
  );
  return value;
}

function exactUuid(value, field, options = {}) {
  invariant(
    typeof value === "string" && UUID.test(value),
    options.code ?? "repository_conflict",
    `${field} is invalid`,
    { status: options.status ?? 500 }
  );
  return value;
}

function exactDigest(value, field, options = {}) {
  invariant(
    typeof value === "string" && DIGEST.test(value),
    options.code ?? "repository_conflict",
    `${field} is invalid`,
    { status: options.status ?? 500 }
  );
  return value;
}

function exactPositiveInteger(value, field, options = {}) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) && selected > 0,
    options.code ?? "repository_conflict",
    `${field} is invalid`,
    { status: options.status ?? 500 }
  );
  return selected;
}

function exactIso(value, field) {
  const selected =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "string"
        ? value
        : "";
  invariant(
    Number.isFinite(Date.parse(selected)),
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return new Date(selected).toISOString();
}

function exactDate(value, field) {
  const selected =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : typeof value === "string"
        ? value
        : "";
  invariant(
    /^\d{4}-\d{2}-\d{2}$/u.test(selected) &&
      new Date(`${selected}T00:00:00.000Z`)
        .toISOString()
        .slice(0, 10) === selected,
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function exactScope(value) {
  exactKeys(
    value,
    ["actorId", "customerId", "organizationId", "projectId"],
    "customServicesQuoteScope",
    { code: "invalid_input", status: 400 }
  );
  const actorId = exactUuid(value.actorId, "actorId", {
    code: "invalid_input",
    status: 400
  });
  const customerId = exactUuid(value.customerId, "customerId", {
    code: "invalid_input",
    status: 400
  });
  invariant(
    actorId === customerId,
    "project_unavailable",
    "the customer assessment quote is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    actorId,
    customerId,
    organizationId: exactUuid(value.organizationId, "organizationId", {
      code: "invalid_input",
      status: 400
    }),
    projectId: exactUuid(value.projectId, "projectId", {
      code: "invalid_input",
      status: 400
    })
  });
}

function exactReadInput(value) {
  return exactScope(value);
}

function exactAcceptanceInput(value) {
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
    "customServicesQuoteAcceptanceInput",
    { code: "invalid_input", status: 400 }
  );
  const scope = exactScope({
    actorId: value.actorId,
    customerId: value.customerId,
    organizationId: value.organizationId,
    projectId: value.projectId
  });
  invariant(
    typeof value.commandId === "string" &&
      value.commandId === value.commandId.trim() &&
      value.commandId.length >= 8 &&
      value.commandId.length <= 200 &&
      !CONTROL_CHARACTER.test(value.commandId) &&
      value.acceptanceStatement === ACCEPTANCE_STATEMENT,
    "invalid_input",
    "the assessment quote acceptance is invalid",
    { status: 400 }
  );
  return Object.freeze({
    ...scope,
    commandId: value.commandId,
    quoteId: exactUuid(value.quoteId, "quoteId", {
      code: "invalid_input",
      status: 400
    }),
    quoteRevision: exactPositiveInteger(value.quoteRevision, "quoteRevision", {
      code: "invalid_input",
      status: 400
    }),
    acceptedQuoteDigest: exactDigest(
      value.acceptedQuoteDigest,
      "acceptedQuoteDigest",
      { code: "invalid_input", status: 400 }
    ),
    acceptedDisclosureDigest: exactDigest(
      value.acceptedDisclosureDigest,
      "acceptedDisclosureDigest",
      { code: "invalid_input", status: 400 }
    ),
    acceptanceStatement: ACCEPTANCE_STATEMENT
  });
}

function validateAuthority(authority) {
  invariant(
    authority && typeof authority.service === "function",
    "invalid_configuration",
    "canonical PostgreSQL authority is required",
    { status: 500 }
  );
  return authority;
}

function resultRows(result, field) {
  invariant(
    result &&
      typeof result === "object" &&
      Array.isArray(result.rows) &&
      Number.isSafeInteger(result.rowCount) &&
      result.rowCount === result.rows.length,
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return result.rows;
}

function optionalSingle(result, field) {
  const rows = resultRows(result, field);
  invariant(
    rows.length <= 1,
    "repository_conflict",
    `${field} conflicts`,
    { status: 500 }
  );
  return rows[0] ?? null;
}

function requiredSingle(result, field, { unavailable = false } = {}) {
  const row = optionalSingle(result, field);
  invariant(
    row !== null,
    unavailable ? "project_unavailable" : "repository_conflict",
    unavailable
      ? "the customer assessment quote is unavailable"
      : `${field} is unavailable`,
    { status: unavailable ? 404 : 500 }
  );
  return row;
}

function exactRowKeys(row, expected, field) {
  return exactKeys(row, expected, field);
}

function binding(row, input, field) {
  const organizationId = exactUuid(row.organization_id, `${field}.organizationId`);
  const projectId = exactUuid(row.project_id, `${field}.projectId`);
  const customerId = exactUuid(row.customer_user_id, `${field}.customerId`);
  invariant(
    organizationId === input.organizationId &&
      projectId === input.projectId &&
      customerId === input.customerId,
    "project_unavailable",
    "the customer assessment quote is unavailable",
    { status: 404 }
  );
  return { organizationId, projectId, customerId };
}

function profileSnapshot(row, input) {
  if (row === null) return null;
  exactRowKeys(
    row,
    ["customer_user_id", "organization_id", "project_id", "revision"],
    "customServicesQuoteProfileRow"
  );
  return {
    ...binding(row, input, "currentProfile"),
    revision: exactPositiveInteger(row.revision, "currentProfile.revision"),
    verifiedCurrent: true
  };
}

function intakeSnapshot(row, input) {
  if (row === null) return null;
  exactRowKeys(
    row,
    [
      "case_id",
      "customer_user_id",
      "facts_digest",
      "id",
      "organization_id",
      "project_id",
      "revision",
      "state",
      "verified_latest"
    ],
    "customServicesQuoteIntakeRow"
  );
  invariant(
    row.state === "submitted" && row.verified_latest === true,
    "repository_conflict",
    "the current assessment intake is stale",
    { status: 500 }
  );
  return {
    ...binding(row, input, "currentIntake"),
    caseId: exactUuid(row.case_id, "currentIntake.caseId"),
    intakeId: exactUuid(row.id, "currentIntake.intakeId"),
    revision: exactPositiveInteger(row.revision, "currentIntake.revision"),
    factsDigest: exactDigest(row.facts_digest, "currentIntake.factsDigest"),
    state: "submitted",
    verifiedLatest: true
  };
}

function acceptanceSnapshot(row, input) {
  if (row.acceptance_id === null) return null;
  invariant(
    row.acceptance_organization_id === row.organization_id &&
      row.acceptance_project_id === row.project_id &&
      row.acceptance_customer_user_id === row.customer_user_id,
    "project_unavailable",
    "the customer assessment quote is unavailable",
    { status: 404 }
  );
  return {
    organizationId: input.organizationId,
    projectId: input.projectId,
    customerId: input.customerId,
    caseId: row.acceptance_case_id,
    quoteId: row.acceptance_quote_id,
    revisionId: row.acceptance_quote_revision_id,
    quoteRevision: Number(row.acceptance_quote_revision),
    acceptedByCustomerId: row.accepted_by_user_id,
    source: row.acceptance_source,
    acceptanceStatement: row.acceptance_statement,
    acceptedQuoteDigest: row.accepted_quote_digest,
    acceptedDisclosureDigest: row.accepted_disclosure_digest,
    legalDocumentId: row.acceptance_legal_document_id,
    acceptedAt: exactIso(row.accepted_at, "quote.acceptance.acceptedAt")
  };
}

const QUOTE_ROW_KEYS = Object.freeze([
  "acceptance_case_id",
  "acceptance_id",
  "acceptance_legal_document_id",
  "acceptance_organization_id",
  "acceptance_project_id",
  "acceptance_quote_id",
  "acceptance_quote_revision",
  "acceptance_quote_revision_id",
  "acceptance_source",
  "acceptance_statement",
  "acceptance_customer_user_id",
  "accepted_at",
  "accepted_by_user_id",
  "accepted_disclosure_digest",
  "accepted_quote_digest",
  "case_id",
  "commercial_contract_digest",
  "commercial_contract_id",
  "created_at",
  "credit_amount_minor",
  "currency",
  "current_revision",
  "customer_user_id",
  "delivery_date",
  "desktop_review_included",
  "disclosure_digest",
  "expanded_assessment_state",
  "expires_at",
  "intake_facts_digest",
  "intake_id",
  "intake_revision",
  "legal_document_id",
  "materialization_valid",
  "maximum_findings",
  "maximum_representative_pages_or_types",
  "maximum_websites",
  "offering_id",
  "organization_id",
  "payment_schedule",
  "phone_review_included",
  "policy_id",
  "policy_scope_boundary_digest",
  "project_id",
  "project_profile_revision",
  "provider_direct_amount_minor",
  "purpose",
  "quote_digest",
  "quote_id",
  "quote_revision",
  "recomputed_disclosure_digest",
  "recomputed_quote_digest",
  "revision_created_at",
  "revision_id",
  "review_targets",
  "scope_boundary_digest",
  "service_amount_minor",
  "subtotal_minor",
  "tax_state",
  "updated_at"
]);

function quoteSnapshot(row, input) {
  if (row === null) return null;
  exactRowKeys(row, QUOTE_ROW_KEYS, "customServicesAssessmentQuoteRow");
  const bound = binding(row, input, "quote");
  invariant(
    row.materialization_valid === true,
    "repository_conflict",
    "the assessment quote materialization changed",
    { status: 500 }
  );
  const quoteId = exactUuid(row.quote_id, "quote.quoteId");
  const caseId = exactUuid(row.case_id, "quote.caseId");
  const offeringId = exactUuid(row.offering_id, "quote.offeringId");
  const quoteRevision = exactPositiveInteger(row.quote_revision, "quote.revision");
  return {
    ...bound,
    caseId,
    offeringId,
    quoteId,
    purpose: row.purpose,
    currentRevision: exactPositiveInteger(row.current_revision, "quote.currentRevision"),
    revision: {
      ...bound,
      caseId,
      quoteId,
      revisionId: exactUuid(row.revision_id, "quote.revisionId"),
      quoteRevision,
      offeringId,
      intakeId: exactUuid(row.intake_id, "quote.intakeId"),
      projectProfileRevision: Number(row.project_profile_revision),
      intakeRevision: Number(row.intake_revision),
      intakeFactsDigest: row.intake_facts_digest,
      reviewTargets: row.review_targets,
      policyId: row.policy_id,
      scopeBoundaryDigest: row.scope_boundary_digest,
      policyScopeBoundaryDigest: row.policy_scope_boundary_digest,
      serviceAmountMinor: Number(row.service_amount_minor),
      providerDirectAmountMinor: Number(row.provider_direct_amount_minor),
      creditAmountMinor: Number(row.credit_amount_minor),
      subtotalMinor: Number(row.subtotal_minor),
      currency: row.currency,
      taxState: row.tax_state,
      paymentSchedule: row.payment_schedule,
      maximumWebsites: Number(row.maximum_websites),
      maximumRepresentativePagesOrTypes:
        Number(row.maximum_representative_pages_or_types),
      maximumFindings: Number(row.maximum_findings),
      desktopReviewIncluded: row.desktop_review_included,
      phoneReviewIncluded: row.phone_review_included,
      expandedAssessmentState: row.expanded_assessment_state,
      commercialContractId: row.commercial_contract_id,
      commercialContractDigest: row.commercial_contract_digest,
      legalDocumentId: row.legal_document_id,
      deliveryDate: exactDate(row.delivery_date, "quote.deliveryDate"),
      issuedAt: exactIso(row.revision_created_at, "quote.issuedAt"),
      expiresAt: exactIso(row.expires_at, "quote.expiresAt"),
      quoteDigest: row.quote_digest,
      disclosureDigest: row.disclosure_digest,
      recomputedQuoteDigest: row.recomputed_quote_digest,
      recomputedDisclosureDigest: row.recomputed_disclosure_digest,
      createdAt: exactIso(row.revision_created_at, "quote.revisionCreatedAt")
    },
    acceptance: acceptanceSnapshot(row, input),
    createdAt: exactIso(row.created_at, "quote.createdAt"),
    updatedAt: exactIso(row.updated_at, "quote.updatedAt")
  };
}

function acceptanceReceipt(row) {
  exactRowKeys(
    row,
    [
      "accepted_at",
      "accepted_disclosure_digest",
      "accepted_quote_digest",
      "quote_id",
      "quote_revision"
    ],
    "customServicesAcceptanceReceiptRow"
  );
  return deepFreeze({
    schema: CUSTOM_SERVICES_QUOTE_ACCEPTANCE_RECEIPT_SCHEMA,
    state: "accepted",
    quoteId: exactUuid(row.quote_id, "acceptanceReceipt.quoteId"),
    quoteRevision: exactPositiveInteger(
      row.quote_revision,
      "acceptanceReceipt.quoteRevision"
    ),
    acceptedQuoteDigest: exactDigest(
      row.accepted_quote_digest,
      "acceptanceReceipt.acceptedQuoteDigest"
    ),
    acceptedDisclosureDigest: exactDigest(
      row.accepted_disclosure_digest,
      "acceptanceReceipt.acceptedDisclosureDigest"
    ),
    acceptedAt: exactIso(row.accepted_at, "acceptanceReceipt.acceptedAt")
  });
}

function storedReceipt(value) {
  exactKeys(
    value,
    [
      "acceptedAt",
      "acceptedDisclosureDigest",
      "acceptedQuoteDigest",
      "quoteId",
      "quoteRevision",
      "schema",
      "state"
    ],
    "storedAcceptanceReceipt"
  );
  invariant(
    value.schema === CUSTOM_SERVICES_QUOTE_ACCEPTANCE_RECEIPT_SCHEMA &&
      value.state === "accepted",
    "repository_conflict",
    "the stored assessment acceptance receipt changed",
    { status: 500 }
  );
  return deepFreeze({
    schema: value.schema,
    state: value.state,
    quoteId: exactUuid(value.quoteId, "storedReceipt.quoteId"),
    quoteRevision: exactPositiveInteger(
      value.quoteRevision,
      "storedReceipt.quoteRevision"
    ),
    acceptedQuoteDigest: exactDigest(
      value.acceptedQuoteDigest,
      "storedReceipt.acceptedQuoteDigest"
    ),
    acceptedDisclosureDigest: exactDigest(
      value.acceptedDisclosureDigest,
      "storedReceipt.acceptedDisclosureDigest"
    ),
    acceptedAt: exactIso(value.acceptedAt, "storedReceipt.acceptedAt")
  });
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (["23505", "40001", "40P01"].includes(error?.code)) {
    return new HostedError(
      "assessment_quote_retry_required",
      "The assessment quote changed while this action was being saved. Refresh before retrying.",
      { status: 409 }
    );
  }
  if (["22001", "22P02", "23502", "23503", "23514", "42501", "55000"].includes(error?.code)) {
    return new HostedError(
      "assessment_quote_changed",
      "This assessment quote is no longer available for acceptance. Refresh the current quote.",
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

async function requireCustomerAccount(client, input) {
  const account = await client.query(
    `select account_user.id
       from auth.users account_user
       join ss.hosted_account_profiles account_profile
         on account_profile.user_id = account_user.id
       join ss.organization_memberships membership
         on membership.user_id = account_user.id
       join ss.organizations organization
         on organization.id = membership.organization_id
       join ss.projects project
         on project.organization_id = organization.id
      where account_user.id = $1
        and membership.organization_id = $2
        and project.id = $3
        and account_user.disabled_at is null
        and account_profile.state = 'active'
        and membership.state = 'active'
        and membership.role in ('owner', 'admin')
        and organization.state = 'active'
        and project.lifecycle = 'active'
      limit 2`,
    [input.customerId, input.organizationId, input.projectId]
  );
  requiredSingle(account, "customServicesQuoteAccount", {
    unavailable: true
  });
}

const QUOTE_SELECT = `select
  quote.organization_id,
  quote.project_id,
  quote.customer_user_id,
  quote.case_id,
  quote.offering_id,
  quote.id as quote_id,
  quote.purpose,
  quote.current_revision,
  quote.created_at,
  quote.updated_at,
  revision.id as revision_id,
  revision.quote_revision,
  revision.intake_id,
  revision.project_profile_revision,
  revision.intake_revision,
  revision.intake_facts_digest,
  revision.review_targets,
  revision.policy_id,
  revision.scope_boundary_digest,
  policy.scope_boundary_digest as policy_scope_boundary_digest,
  revision.service_amount_minor,
  revision.provider_direct_amount_minor,
  revision.credit_amount_minor,
  revision.subtotal_minor,
  revision.currency,
  revision.tax_state,
  revision.payment_schedule,
  revision.maximum_websites,
  revision.maximum_representative_pages_or_types,
  revision.maximum_findings,
  revision.desktop_review_included,
  revision.phone_review_included,
  revision.expanded_assessment_state,
  revision.commercial_contract_id,
  revision.commercial_contract_digest,
  revision.legal_document_id,
  revision.delivery_date,
  revision.expires_at,
  revision.quote_digest,
  revision.disclosure_digest,
  revision.created_at as revision_created_at,
  ss.service_quote_digest(
    'snapshot', revision.organization_id, revision.project_id,
    revision.case_id, revision.customer_user_id, revision.quote_id,
    revision.quote_revision, revision.offering_id, revision.policy_id,
    revision.scope_boundary_digest, revision.project_profile_revision,
    revision.intake_id, revision.intake_revision,
    revision.intake_facts_digest, revision.review_targets,
    revision.service_amount_minor, revision.currency,
    revision.tax_state, revision.payment_schedule,
    revision.delivery_date, revision.commercial_contract_id,
    revision.commercial_contract_digest, revision.created_at,
    revision.expires_at
  ) as recomputed_quote_digest,
  ss.service_quote_digest(
    'customer_disclosure', revision.organization_id, revision.project_id,
    revision.case_id, revision.customer_user_id, revision.quote_id,
    revision.quote_revision, revision.offering_id, revision.policy_id,
    revision.scope_boundary_digest, revision.project_profile_revision,
    revision.intake_id, revision.intake_revision,
    revision.intake_facts_digest, revision.review_targets,
    revision.service_amount_minor, revision.currency,
    revision.tax_state, revision.payment_schedule,
    revision.delivery_date, revision.commercial_contract_id,
    revision.commercial_contract_digest, revision.created_at,
    revision.expires_at
  ) as recomputed_disclosure_digest,
  (
    (select count(*) = 1 from ss.service_quote_lines line
      where line.quote_revision_id = revision.id
        and line.customer_amount_minor = 35000)
    and (select count(*) = 3 from ss.service_quote_line_coverages coverage
      where coverage.quote_revision_id = revision.id)
    and (select count(*) = cardinality(revision.review_targets)
      from ss.service_quote_review_targets target
      where target.quote_revision_id = revision.id)
    and (select count(*) = 1 from ss.service_quote_installments installment
      where installment.quote_revision_id = revision.id
        and installment.amount_minor = 35000
        and installment.currency = 'USD'
        and installment.due_trigger = 'before_work')
  ) as materialization_valid,
  acceptance.id as acceptance_id,
  acceptance.organization_id as acceptance_organization_id,
  acceptance.project_id as acceptance_project_id,
  acceptance.case_id as acceptance_case_id,
  acceptance.customer_user_id as acceptance_customer_user_id,
  acceptance.quote_id as acceptance_quote_id,
  acceptance.quote_revision_id as acceptance_quote_revision_id,
  acceptance.quote_revision as acceptance_quote_revision,
  acceptance.accepted_by_user_id,
  acceptance.source as acceptance_source,
  acceptance.acceptance_statement,
  acceptance.accepted_quote_digest,
  acceptance.accepted_disclosure_digest,
  acceptance.legal_document_id as acceptance_legal_document_id,
  acceptance.accepted_at
from ss.service_quotes quote
join ss.service_quote_revisions revision
  on revision.quote_id = quote.id
 and revision.quote_revision = quote.current_revision
join ss.service_catalog_policies policy
  on policy.id = revision.policy_id
 and policy.id = '${ASSESSMENT_POLICY_ID}'
 and policy.scope_boundary_digest = revision.scope_boundary_digest
join ss.service_cases service_case
  on service_case.organization_id = quote.organization_id
 and service_case.project_id = quote.project_id
 and service_case.customer_user_id = quote.customer_user_id
 and service_case.id = quote.case_id
 and service_case.state = 'submitted'
join ss.service_case_offerings offering
  on offering.organization_id = quote.organization_id
 and offering.project_id = quote.project_id
 and offering.customer_user_id = quote.customer_user_id
 and offering.case_id = quote.case_id
 and offering.id = quote.offering_id
 and offering.policy_id = '${ASSESSMENT_POLICY_ID}'
 and offering.state = 'requested'
left join ss.service_quote_acceptances acceptance
  on acceptance.organization_id = quote.organization_id
 and acceptance.quote_id = quote.id
where quote.organization_id = $1
  and quote.project_id = $2
  and quote.customer_user_id = $3
  and quote.case_id = $4
  and quote.offering_id = $5
  and quote.current_revision > 0
limit 2`;

export function createPostgresCustomServicesAssessmentQuoteRepository({
  authority
} = {}) {
  const database = validateAuthority(authority);

  return Object.freeze({
    async readCurrentQuote(value) {
      const input = exactReadInput(value);
      return translated(() =>
        database.service(
          {
            actorKind: "customer",
            userId: input.actorId,
            organizationId: input.organizationId,
            readOnly: true
          },
          async (client) => {
            invariant(
              client && typeof client.query === "function",
              "invalid_configuration",
              "canonical PostgreSQL query authority is required",
              { status: 500 }
            );
            await requireCustomerAccount(client, input);

            const profileRow = optionalSingle(
              await client.query(
                `select organization_id, project_id, customer_user_id, revision
                   from ss.service_project_profiles
                  where organization_id = $1 and project_id = $2
                  limit 2`,
                [input.organizationId, input.projectId]
              ),
              "customServicesQuoteProfile"
            );
            const currentProfile = profileSnapshot(profileRow, input);

            let currentIntake = null;
            let quote = null;
            if (currentProfile !== null) {
              const intakeRow = optionalSingle(
                await client.query(
                  `select
                     intake.id, intake.organization_id, intake.project_id,
                     intake.case_id, intake.customer_user_id, intake.revision,
                     intake.facts_digest, intake.state,
                     not exists (
                       select 1 from ss.service_intakes later
                        where later.case_id = intake.case_id
                          and later.revision > intake.revision
                     ) as verified_latest
                   from ss.service_cases service_case
                   join ss.service_case_offerings offering
                     on offering.organization_id = service_case.organization_id
                    and offering.project_id = service_case.project_id
                    and offering.customer_user_id = service_case.customer_user_id
                    and offering.case_id = service_case.id
                    and offering.policy_id = $4
                    and offering.state = 'requested'
                   join ss.service_intakes intake
                     on intake.organization_id = service_case.organization_id
                    and intake.project_id = service_case.project_id
                    and intake.customer_user_id = service_case.customer_user_id
                    and intake.case_id = service_case.id
                  where service_case.organization_id = $1
                    and service_case.project_id = $2
                    and service_case.customer_user_id = $3
                    and service_case.state = 'submitted'
                  order by intake.revision desc
                  limit 1`,
                  [
                    input.organizationId,
                    input.projectId,
                    input.customerId,
                    ASSESSMENT_POLICY_ID
                  ]
                ),
                "customServicesQuoteCurrentIntake"
              );
              currentIntake = intakeSnapshot(intakeRow, input);
              if (currentIntake !== null) {
                const offering = requiredSingle(
                  await client.query(
                    `select id
                       from ss.service_case_offerings
                      where organization_id = $1
                        and project_id = $2
                        and customer_user_id = $3
                        and case_id = $4
                        and policy_id = $5
                        and state = 'requested'
                      limit 2`,
                    [
                      input.organizationId,
                      input.projectId,
                      input.customerId,
                      currentIntake.caseId,
                      ASSESSMENT_POLICY_ID
                    ]
                  ),
                  "customServicesQuoteOffering"
                );
                const quoteRow = optionalSingle(
                  await client.query(QUOTE_SELECT, [
                    input.organizationId,
                    input.projectId,
                    input.customerId,
                    currentIntake.caseId,
                    offering.id
                  ]),
                  "customServicesCurrentAssessmentQuote"
                );
                quote = quoteSnapshot(quoteRow, input);
              }
            }

            const observed = requiredSingle(
              await client.query(
                "select clock_timestamp() as observed_at"
              ),
              "customServicesQuoteObservedAt"
            );
            const snapshot = {
              schema: CUSTOM_SERVICES_ASSESSMENT_QUOTE_SNAPSHOT_SCHEMA,
              observedAt: exactIso(
                observed.observed_at,
                "customServicesQuoteObservedAt"
              ),
              currentProfile,
              currentIntake,
              quote
            };
            projectCustomServicesAssessmentQuote({ scope: input, snapshot });
            return deepFreeze(snapshot);
          }
        )
      );
    },

    async acceptCurrentQuote(value) {
      const input = exactAcceptanceInput(value);
      const requestDigest = digest({
        route: ACCEPT_ROUTE,
        organizationId: input.organizationId,
        projectId: input.projectId,
        customerId: input.customerId,
        quoteId: input.quoteId,
        quoteRevision: input.quoteRevision,
        acceptedQuoteDigest: input.acceptedQuoteDigest,
        acceptedDisclosureDigest: input.acceptedDisclosureDigest,
        acceptanceStatement: input.acceptanceStatement
      });
      return translated(() =>
        database.service(
          {
            actorKind: "customer",
            userId: input.actorId,
            organizationId: input.organizationId
          },
          async (client) => {
            await requireCustomerAccount(client, input);
            await client.query(
              "select pg_advisory_xact_lock(hashtextextended($1, 0))",
              [`custom-services-quote:${input.organizationId}:${input.projectId}`]
            );

            const priorCommand = optionalSingle(
              await client.query(
                `select request_digest, state, response_body
                   from ss.idempotency_keys
                  where principal_id = $1
                    and route_key = $2
                    and idempotency_key = $3
                  for update`,
                [input.customerId, ACCEPT_ROUTE, input.commandId]
              ),
              "customServicesQuoteAcceptanceCommand"
            );
            if (priorCommand !== null) {
              invariant(
                priorCommand.request_digest === requestDigest,
                "idempotency_conflict",
                "That idempotency key was already used for another action.",
                { status: 409 }
              );
              invariant(
                priorCommand.state === "completed",
                "command_in_progress",
                "That assessment quote action has not reached a safe final state.",
                { status: 409 }
              );
              return storedReceipt(priorCommand.response_body);
            }

            const commandRowId = randomUUID();
            await client.query(
              `insert into ss.idempotency_keys (
                 id, organization_id, principal_id, route_key,
                 idempotency_key, request_digest, state, expires_at
               ) values (
                 $1, $2, $3, $4, $5, $6, 'running',
                 clock_timestamp() + interval '24 hours'
               )`,
              [
                commandRowId,
                input.organizationId,
                input.customerId,
                ACCEPT_ROUTE,
                input.commandId,
                requestDigest
              ]
            );

            let acceptance = optionalSingle(
              await client.query(
                `select
                   acceptance.quote_id,
                   acceptance.quote_revision,
                   acceptance.accepted_quote_digest,
                   acceptance.accepted_disclosure_digest,
                   acceptance.accepted_at
                 from ss.service_quote_acceptances acceptance
                where acceptance.organization_id = $1
                  and acceptance.project_id = $2
                  and acceptance.customer_user_id = $3
                  and acceptance.quote_id = $4
                limit 2`,
                [
                  input.organizationId,
                  input.projectId,
                  input.customerId,
                  input.quoteId
                ]
              ),
              "customServicesExistingQuoteAcceptance"
            );
            if (acceptance === null) {
              acceptance = requiredSingle(
                await client.query(
                  `insert into ss.service_quote_acceptances (
                     quote_id, acceptance_statement,
                     accepted_quote_digest, accepted_disclosure_digest,
                     request_id
                   ) values ($1, $2, $3, $4, $5)
                   returning
                     quote_id, quote_revision,
                     accepted_quote_digest, accepted_disclosure_digest,
                     accepted_at`,
                  [
                    input.quoteId,
                    input.acceptanceStatement,
                    input.acceptedQuoteDigest,
                    input.acceptedDisclosureDigest,
                    commandRowId
                  ]
                ),
                "customServicesNewQuoteAcceptance"
              );
            }
            const receipt = acceptanceReceipt(acceptance);
            invariant(
              receipt.quoteId === input.quoteId &&
                receipt.quoteRevision === input.quoteRevision &&
                receipt.acceptedQuoteDigest === input.acceptedQuoteDigest &&
                receipt.acceptedDisclosureDigest ===
                  input.acceptedDisclosureDigest,
              "assessment_quote_changed",
              "This assessment quote is no longer available for acceptance. Refresh the current quote.",
              { status: 409 }
            );
            await client.query(
              `update ss.idempotency_keys
                  set state = 'completed',
                      response_status = 200,
                      response_body = $2::jsonb
                where id = $1`,
              [commandRowId, JSON.stringify(receipt)]
            );
            return receipt;
          }
        )
      );
    }
  });
}
