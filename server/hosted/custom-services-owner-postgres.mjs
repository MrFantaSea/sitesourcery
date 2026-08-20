import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

export const CUSTOM_SERVICES_OWNER_QUEUE_SCHEMA =
  "sitesourcery.custom-services-owner-assessment-queue/v1";
export const CUSTOM_SERVICES_OWNER_QUOTE_RECEIPT_SCHEMA =
  "sitesourcery.custom-services-owner-assessment-quote/v1";

const ASSESSMENT_POLICY_ID =
  "00000000-0000-4000-8000-000000001411";
const QUOTE_ROUTE =
  "custom_services.owner.assessment_quote.issue";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const PAGE_PATH =
  /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/u;
const PAGE_TYPE = /^[a-z][a-z0-9_]{1,79}$/u;

function exactKeys(value, expected, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
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

function actorId(value) {
  if (!value || typeof value.userId !== "string" || !UUID.test(value.userId)) {
    throw new HostedError(
      "AUTHENTICATION_REQUIRED",
      "Sign in before opening owner quote tools.",
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

function date(value) {
  let canonical = null;
  try {
    canonical = new Date(`${value}T00:00:00.000Z`)
      .toISOString()
      .slice(0, 10);
  } catch {
    canonical = null;
  }
  invariant(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
      canonical === value,
    "invalid_input",
    "deliveryDate is invalid",
    { status: 400 }
  );
  return value;
}

function reviewTarget(value) {
  exactKeys(value, ["kind", "value"], "reviewTarget");
  invariant(
    typeof value.value === "string" && value.value === value.value.trim(),
    "invalid_input",
    "reviewTarget is invalid",
    { status: 400 }
  );
  if (value.kind === "page") {
    invariant(
      value.value.length <= 154 &&
        PAGE_PATH.test(value.value) &&
        !/(^|\/)\.\.?($|\/)/u.test(value.value),
      "invalid_input",
      "Each page target must be a safe path beginning with /.",
      { status: 400 }
    );
    return `page:${value.value}`;
  }
  invariant(
    value.kind === "page_type" && PAGE_TYPE.test(value.value),
    "invalid_input",
    "Each page type must use lowercase letters, numbers, or underscores.",
    { status: 400 }
  );
  return `type:${value.value}`;
}

function targets(value) {
  invariant(
    Array.isArray(value) && value.length >= 1 && value.length <= 5,
    "invalid_input",
    "Choose between one and five representative pages or page types.",
    { status: 400 }
  );
  const selected = value.map(reviewTarget).sort();
  invariant(
    new Set(selected).size === selected.length,
    "invalid_input",
    "Review targets must be unique.",
    { status: 400 }
  );
  return Object.freeze(selected);
}

function issueInput(value) {
  exactKeys(
    value,
    ["commandId", "deliveryDate", "organizationId", "reviewTargets"],
    "assessmentQuoteIssueInput"
  );
  return Object.freeze({
    commandId: commandId(value.commandId),
    deliveryDate: date(value.deliveryDate),
    organizationId: uuid(value.organizationId, "organizationId"),
    reviewTargets: targets(value.reviewTargets)
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

function one(result, field, { optional = false } = {}) {
  invariant(
    result &&
      Array.isArray(result.rows) &&
      Number.isSafeInteger(result.rowCount) &&
      result.rowCount === result.rows.length &&
      result.rowCount <= 1,
    "owner_quote_repository_conflict",
    `${field} is unavailable`,
    { status: 500 }
  );
  if (result.rowCount === 0) {
    invariant(
      optional,
      "assessment_request_changed",
      "That assessment request is no longer ready for a quote.",
      { status: 409 }
    );
    return null;
  }
  return result.rows[0];
}

function iso(value) {
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    !Number.isNaN(selected.getTime()),
    "owner_quote_repository_conflict",
    "Owner quote timing is unavailable",
    { status: 500 }
  );
  return selected.toISOString();
}

function canonicalDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return value;
  }
  return iso(value).slice(0, 10);
}

function publicTarget(value) {
  invariant(
    typeof value === "string" &&
      (value.startsWith("page:") || value.startsWith("type:")),
    "owner_quote_repository_conflict",
    "Owner quote target is unavailable",
    { status: 500 }
  );
  return value.startsWith("page:")
    ? Object.freeze({ kind: "page", value: value.slice(5) })
    : Object.freeze({ kind: "page_type", value: value.slice(5) });
}

function currentQuote(row) {
  if (row.quote_id === null || row.quote_revision === null) return null;
  invariant(
    Number(row.quote_revision) > 0 &&
      Array.isArray(row.quote_review_targets),
    "owner_quote_repository_conflict",
    "The current owner quote is incomplete",
    { status: 500 }
  );
  return Object.freeze({
    quoteId: row.quote_id,
    quoteRevision: Number(row.quote_revision),
    deliveryDate: canonicalDate(row.quote_delivery_date),
    expiresAt: iso(row.quote_expires_at),
    issuedAt: iso(row.quote_issued_at),
    reviewTargets: Object.freeze(
      row.quote_review_targets.map(publicTarget)
    )
  });
}

function queueEntry(row) {
  return Object.freeze({
    caseId: row.case_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    projectId: row.project_id,
    projectName: row.project_name,
    submittedAt: iso(row.submitted_at),
    customer: Object.freeze({
      customerId: row.customer_user_id,
      name: row.customer_name,
      email: row.customer_email
    }),
    website: Object.freeze({
      displayName: row.site_display_name,
      publicUrl: `${row.public_scheme}://${row.public_hostname}/`,
      businessName: row.business_name,
      platformFamily: row.platform_family,
      approximatePublicSize: row.approximate_public_size,
      complexityFlags: Object.freeze([...(row.complexity_flags ?? [])]),
      importantDate:
        row.important_date === null
          ? null
          : canonicalDate(row.important_date)
    }),
    request: Object.freeze({
      primaryGoal: row.primary_goal,
      customerObservation: row.customer_observation,
      intakeRevision: Number(row.intake_revision)
    }),
    currentQuote: currentQuote(row)
  });
}

function quoteReceipt(row) {
  return deepFreeze({
    schema: CUSTOM_SERVICES_OWNER_QUOTE_RECEIPT_SCHEMA,
    state: "issued",
    caseId: row.case_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    customerId: row.customer_user_id,
    quoteId: row.quote_id,
    quoteRevision: Number(row.quote_revision),
    price: {
      amountMinor: 35000,
      currency: "USD"
    },
    deliveryDate: canonicalDate(row.delivery_date),
    issuedAt: iso(row.issued_at),
    expiresAt: iso(row.expires_at),
    reviewTargets: row.review_targets.map(publicTarget)
  });
}

function storedReceipt(value) {
  invariant(
    value &&
      typeof value === "object" &&
      value.schema === CUSTOM_SERVICES_OWNER_QUOTE_RECEIPT_SCHEMA &&
      value.state === "issued" &&
      UUID.test(String(value.quoteId ?? "")),
    "owner_quote_repository_conflict",
    "The stored owner quote receipt is invalid",
    { status: 500 }
  );
  return deepFreeze(structuredClone(value));
}

async function requireOperator(client, operatorUserId) {
  const row = one(
    await client.query(
      `select ss.service_operator_has_capability(
         $1, 'service_quote_author', clock_timestamp()
       ) as authorized`,
      [operatorUserId]
    ),
    "serviceQuoteOperator"
  );
  invariant(
    row.authorized === true,
    "OPERATOR_ACCESS_REQUIRED",
    "Owner quote tools are unavailable for this account.",
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
      "Owner quote tools are unavailable for this account.",
      { status: 403 }
    );
  }
  if (error?.code === "42501") {
    return new HostedError(
      "owner_quote_repository_conflict",
      "Owner quote storage is not configured correctly.",
      { status: 500 }
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
      "assessment_request_changed",
      "That assessment request changed. Refresh the owner queue before issuing its quote.",
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

export function createHeldCustomServicesOwner() {
  return Object.freeze({
    async listAssessmentRequests(actor) {
      actorId(actor);
      throw new HostedError(
        "CUSTOM_SERVICES_OWNER_HELD",
        "Owner custom-service tools are held in this runtime.",
        { status: 503 }
      );
    },
    async issueAssessmentQuote(actor) {
      actorId(actor);
      throw new HostedError(
        "CUSTOM_SERVICES_OWNER_HELD",
        "Owner custom-service tools are held in this runtime.",
        { status: 503 }
      );
    }
  });
}

export function createPostgresCustomServicesOwner({
  authority,
  randomUUID = systemRandomUUID
} = {}) {
  const database = validateAuthority(authority);
  invariant(
    typeof randomUUID === "function",
    "invalid_configuration",
    "owner quote ID generator is required",
    { status: 500 }
  );

  return Object.freeze({
    async listAssessmentRequests(actor) {
      const operatorUserId = actorId(actor);
      return translated(() =>
        database.service(
          { userId: operatorUserId, readOnly: true },
          async (client) => {
            await requireOperator(client, operatorUserId);
            const selected = await client.query(
              `select
                 service_case.id as case_id,
                 service_case.organization_id,
                 organization.name as organization_name,
                 service_case.project_id,
                 project.name as project_name,
                 service_case.customer_user_id,
                 account_profile.display_name as customer_name,
                 account_user.email as customer_email,
                 intake.submitted_at,
                 intake.revision as intake_revision,
                 intake.site_display_name,
                 intake.public_scheme,
                 intake.public_hostname,
                 intake.business_name,
                 intake.primary_goal,
                 intake.customer_observation,
                 intake.platform_family,
                 intake.approximate_public_size,
                 intake.complexity_flags,
                 intake.important_date,
                 quote.id as quote_id,
                 revision.quote_revision,
                 revision.delivery_date as quote_delivery_date,
                 revision.expires_at as quote_expires_at,
                 revision.issued_at as quote_issued_at,
                 revision.review_targets as quote_review_targets
               from ss.service_cases service_case
               join ss.organizations organization
                 on organization.id = service_case.organization_id
                and organization.state = 'active'
               join ss.projects project
                 on project.organization_id = service_case.organization_id
                and project.id = service_case.project_id
                and project.lifecycle = 'active'
               join auth.users account_user
                 on account_user.id = service_case.customer_user_id
                and account_user.disabled_at is null
               join ss.hosted_account_profiles account_profile
                 on account_profile.user_id = account_user.id
                and account_profile.state = 'active'
               join ss.organization_memberships membership
                 on membership.organization_id = service_case.organization_id
                and membership.user_id = service_case.customer_user_id
                and membership.state = 'active'
                and membership.role in ('owner', 'admin')
               join ss.service_case_offerings offering
                 on offering.organization_id = service_case.organization_id
                and offering.case_id = service_case.id
                and offering.customer_user_id = service_case.customer_user_id
                and offering.policy_id = $1
                and offering.state = 'requested'
               join lateral (
                 select candidate.*
                   from ss.service_intakes candidate
                  where candidate.organization_id = service_case.organization_id
                    and candidate.case_id = service_case.id
                    and candidate.customer_user_id = service_case.customer_user_id
                    and candidate.state = 'submitted'
                  order by candidate.revision desc
                  limit 1
               ) intake on true
               left join ss.service_quotes quote
                 on quote.organization_id = service_case.organization_id
                and quote.case_id = service_case.id
                and quote.purpose = 'assessment'
               left join ss.service_quote_revisions revision
                 on revision.organization_id = quote.organization_id
                and revision.quote_id = quote.id
                and revision.quote_revision = quote.current_revision
               left join ss.service_quote_acceptances acceptance
                 on acceptance.organization_id = quote.organization_id
                and acceptance.quote_id = quote.id
              where service_case.state = 'submitted'
                and acceptance.id is null
              order by intake.submitted_at asc, service_case.id asc
              limit 100`,
              [ASSESSMENT_POLICY_ID]
            );
            return deepFreeze({
              schema: CUSTOM_SERVICES_OWNER_QUEUE_SCHEMA,
              requests: selected.rows.map(queueEntry)
            });
          }
        )
      );
    },

    async issueAssessmentQuote(actor, caseIdInput, value) {
      const operatorUserId = actorId(actor);
      const caseId = uuid(caseIdInput, "caseId");
      const input = issueInput(value);
      const requestDigest = digest({
        route: QUOTE_ROUTE,
        operatorUserId,
        organizationId: input.organizationId,
        caseId,
        deliveryDate: input.deliveryDate,
        reviewTargets: input.reviewTargets
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
              [`custom-services-owner-quote:${input.organizationId}:${caseId}`]
            );

            const prior = one(
              await client.query(
                `select request_digest, state, response_body
                   from ss.idempotency_keys
                  where principal_id = $1
                    and route_key = $2
                    and idempotency_key = $3
                  for update`,
                [operatorUserId, QUOTE_ROUTE, input.commandId]
              ),
              "ownerQuoteCommand",
              { optional: true }
            );
            if (prior !== null) {
              invariant(
                prior.request_digest === requestDigest,
                "idempotency_conflict",
                "That idempotency key was already used for another owner action.",
                { status: 409 }
              );
              invariant(
                prior.state === "completed",
                "command_in_progress",
                "That owner quote action has not reached a safe final state.",
                { status: 409 }
              );
              return storedReceipt(prior.response_body);
            }

            const request = one(
              await client.query(
                `select
                   service_case.organization_id,
                   service_case.project_id,
                   service_case.customer_user_id,
                   offering.id as offering_id,
                   intake.id as intake_id,
                   intake.revision as intake_revision,
                   intake.facts_digest,
                   profile.revision as project_profile_revision,
                   policy.id as policy_id,
                   policy.scope_boundary_digest,
                   policy.commercial_contract_id,
                   policy.commercial_contract_digest,
                   document.id as legal_document_id
                 from ss.service_cases service_case
                 join ss.service_project_profiles profile
                   on profile.organization_id = service_case.organization_id
                  and profile.project_id = service_case.project_id
                  and profile.customer_user_id = service_case.customer_user_id
                 join ss.service_case_offerings offering
                   on offering.organization_id = service_case.organization_id
                  and offering.case_id = service_case.id
                  and offering.customer_user_id = service_case.customer_user_id
                  and offering.policy_id = $3
                  and offering.state = 'requested'
                 join ss.service_catalog_policies policy
                   on policy.id = offering.policy_id
                  and policy.service_key = 'website_assessment_standard'
                  and policy.unit_amount_minor = 35000
                  and policy.currency = 'USD'
                  and policy.publication_state = 'held'
                 join ss.legal_documents document
                   on document.id = policy.legal_document_id
                  and document.kind = 'custom_services'
                  and document.version = policy.commercial_contract_id
                  and document.content_digest = policy.commercial_contract_digest
                  and document.retired_at is null
                 join lateral (
                   select candidate.*
                     from ss.service_intakes candidate
                    where candidate.organization_id = service_case.organization_id
                      and candidate.case_id = service_case.id
                      and candidate.customer_user_id = service_case.customer_user_id
                      and candidate.state = 'submitted'
                    order by candidate.revision desc
                    limit 1
                 ) intake on true
                 join ss.organizations organization
                   on organization.id = service_case.organization_id
                  and organization.state = 'active'
                 join ss.projects project
                   on project.organization_id = service_case.organization_id
                  and project.id = service_case.project_id
                  and project.lifecycle = 'active'
                 join ss.organization_memberships membership
                   on membership.organization_id = service_case.organization_id
                  and membership.user_id = service_case.customer_user_id
                  and membership.state = 'active'
                  and membership.role in ('owner', 'admin')
                 join auth.users account_user
                   on account_user.id = service_case.customer_user_id
                  and account_user.disabled_at is null
                 join ss.hosted_account_profiles account_profile
                   on account_profile.user_id = account_user.id
                  and account_profile.state = 'active'
                where service_case.organization_id = $1
                  and service_case.id = $2
                  and service_case.state = 'submitted'
                limit 2`,
                [input.organizationId, caseId, ASSESSMENT_POLICY_ID]
              ),
              "submittedAssessmentRequest"
            );

            const commandRowId = randomUUID();
            uuid(commandRowId, "generated command ID");
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
                operatorUserId,
                QUOTE_ROUTE,
                input.commandId,
                requestDigest
              ]
            );

            let quote = one(
              await client.query(
                `select
                   quote.id,
                   quote.current_revision,
                   acceptance.id as acceptance_id,
                   revision.delivery_date,
                   revision.review_targets,
                   revision.expires_at,
                   revision.issued_at,
                   revision.organization_id,
                   revision.project_id,
                   revision.case_id,
                   revision.customer_user_id,
                   revision.quote_id,
                   revision.quote_revision,
                   revision.intake_id,
                   revision.project_profile_revision
                 from ss.service_quotes quote
                 left join ss.service_quote_acceptances acceptance
                   on acceptance.organization_id = quote.organization_id
                  and acceptance.quote_id = quote.id
                 left join ss.service_quote_revisions revision
                   on revision.organization_id = quote.organization_id
                  and revision.quote_id = quote.id
                  and revision.quote_revision = quote.current_revision
                where quote.organization_id = $1
                  and quote.case_id = $2
                  and quote.purpose = 'assessment'`,
                [input.organizationId, caseId]
              ),
              "assessmentQuoteEnvelope",
              { optional: true }
            );
            invariant(
              quote?.acceptance_id == null,
              "assessment_quote_already_accepted",
              "The customer already accepted this assessment quote.",
              { status: 409 }
            );

            if (quote === null) {
              const quoteId = randomUUID();
              uuid(quoteId, "generated quote ID");
              quote = one(
                await client.query(
                  `insert into ss.service_quotes (
                     id, organization_id, project_id, case_id,
                     offering_id, customer_user_id, purpose,
                     current_revision, created_by_operator_user_id,
                     created_at, updated_at
                   ) values (
                     $1, $2, $3, $4, $5, $6, 'assessment', 0,
                     $7, clock_timestamp(), clock_timestamp()
                   )
                   returning id, current_revision`,
                  [
                    quoteId,
                    request.organization_id,
                    request.project_id,
                    caseId,
                    request.offering_id,
                    request.customer_user_id,
                    operatorUserId
                  ]
                ),
                "newAssessmentQuoteEnvelope"
              );
            }

            const sameCurrentRevision =
              Number(quote.current_revision) > 0 &&
              quote.acceptance_id == null &&
              quote.intake_id === request.intake_id &&
              Number(quote.project_profile_revision) ===
                Number(request.project_profile_revision) &&
              canonicalDate(quote.delivery_date) === input.deliveryDate &&
              Array.isArray(quote.review_targets) &&
              JSON.stringify(quote.review_targets) ===
                JSON.stringify(input.reviewTargets) &&
              Date.parse(quote.expires_at) > Date.now();

            let revision;
            if (sameCurrentRevision) {
              revision = quote;
            } else {
              const revisionId = randomUUID();
              uuid(revisionId, "generated quote revision ID");
              revision = one(
                await client.query(
                  `insert into ss.service_quote_revisions (
                     id, organization_id, project_id, case_id,
                     quote_id, quote_revision, customer_user_id,
                     offering_id, intake_id, project_profile_revision,
                     intake_revision, intake_facts_digest, review_targets,
                     policy_id, scope_boundary_digest,
                     service_amount_minor, provider_direct_amount_minor,
                     credit_amount_minor, subtotal_minor, currency,
                     tax_state, payment_schedule, maximum_websites,
                     maximum_representative_pages_or_types,
                     maximum_findings, desktop_review_included,
                     phone_review_included, expanded_assessment_state,
                     commercial_contract_id, commercial_contract_digest,
                     legal_document_id, delivery_date, issued_at,
                     expires_at, created_by_operator_user_id, created_at
                   ) values (
                     $1, $2, $3, $4, $5, 1, $6, $7, $8, $9,
                     $10, $11, $12::text[], $13, $14,
                     35000, 0, 0, 35000, 'USD',
                     'disabled_by_owner', 'full_before_work', 1, 5, 10,
                     true, true, 'separately_quoted', $15, $16, $17,
                     $18::date, clock_timestamp(),
                     clock_timestamp() + interval '14 days', $19,
                     clock_timestamp()
                   )
                   returning
                     organization_id, project_id, case_id, customer_user_id,
                     quote_id, quote_revision, delivery_date, issued_at,
                     expires_at, review_targets`,
                  [
                    revisionId,
                    request.organization_id,
                    request.project_id,
                    caseId,
                    quote.id,
                    request.customer_user_id,
                    request.offering_id,
                    request.intake_id,
                    Number(request.project_profile_revision),
                    Number(request.intake_revision),
                    request.facts_digest,
                    [...input.reviewTargets],
                    request.policy_id,
                    request.scope_boundary_digest,
                    request.commercial_contract_id,
                    request.commercial_contract_digest,
                    request.legal_document_id,
                    input.deliveryDate,
                    operatorUserId
                  ]
                ),
                "newAssessmentQuoteRevision"
              );
            }

            const receipt = quoteReceipt(revision);
            await client.query(
              `update ss.idempotency_keys
                  set state = 'completed',
                      response_status = 201,
                      response_body = $2::jsonb,
                      resource_type = 'custom_service_assessment_quote',
                      resource_id = $3
                where id = $1`,
              [commandRowId, JSON.stringify(receipt), receipt.quoteId]
            );
            return receipt;
          }
        )
      );
    }
  });
}
