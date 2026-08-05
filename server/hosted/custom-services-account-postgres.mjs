import { deepFreeze } from "../commerce-v2/canonical.mjs";
import {
  CUSTOM_SERVICES_FOUNDATION_SNAPSHOT_SCHEMA,
  projectCustomServicesAccount
} from "./custom-services-account.mjs";
import { HostedError, invariant } from "./errors.mjs";

const FOUNDATION_CONTRACT =
  "canonical-ss-v34-custom-services-foundation";
const CATALOG_VERSION = "SS-PROFESSIONAL-2026.1";
const SERVICE_KEY = "website_assessment_standard";
const LEGAL_VERSION = "SS-CUSTOM-SERVICES-2026-08-05.1";
const LEGAL_DIGEST =
  "9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8";
const ASSESSMENT_POLICY_ID =
  "00000000-0000-4000-8000-000000000341";
const HELD = "held";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATABASE_CONFLICT_CODES = new Set([
  "22001",
  "22P02",
  "23502",
  "23503",
  "23505",
  "23514",
  "42501",
  "42P01",
  "42883",
  "55000"
]);

function exactKeys(value, expected, field, options = {}) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    options.code ?? "repository_conflict",
    `${field} is invalid`,
    { status: options.status ?? 500 }
  );
  return value;
}

function exactUuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return value;
}

function exactInput(value) {
  exactKeys(
    value,
    ["actorId", "customerId", "organizationId", "projectId"],
    "customServicesFoundationReadInput",
    { code: "invalid_input", status: 400 }
  );
  const actorId = exactUuid(value.actorId, "actorId");
  const customerId = exactUuid(value.customerId, "customerId");
  invariant(
    actorId === customerId,
    "project_unavailable",
    "the customer service project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    actorId,
    customerId,
    organizationId: exactUuid(
      value.organizationId,
      "organizationId"
    ),
    projectId: exactUuid(value.projectId, "projectId")
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

function rows(result, field) {
  invariant(
    result !== null &&
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
  const selected = rows(result, field);
  invariant(
    selected.length <= 1,
    "repository_conflict",
    `${field} conflicts`,
    { status: 500 }
  );
  return selected[0] ?? null;
}

function requiredSingle(result, field, { unavailable = false } = {}) {
  const selected = rows(result, field);
  invariant(
    selected.length <= 1,
    "repository_conflict",
    `${field} conflicts`,
    { status: 500 }
  );
  invariant(
    selected.length === 1,
    unavailable ? "project_unavailable" : "repository_conflict",
    unavailable
      ? "the customer service project is unavailable"
      : `${field} is unavailable`,
    { status: unavailable ? 404 : 500 }
  );
  return selected[0];
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

function nullableIso(value, field) {
  return value === null ? null : exactIso(value, field);
}

function exactDate(value, field) {
  if (value === null) return null;
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

function exactInteger(value, field) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) && selected > 0,
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function accountSnapshot(row) {
  exactKeys(
    row,
    [
      "account_state",
      "customer_user_id",
      "display_name",
      "email",
      "membership_state",
      "organization_display_name",
      "organization_id",
      "project_id",
      "project_state",
      "runtime_contract"
    ],
    "customServicesAccountRow"
  );
  return {
    runtimeContract: row.runtime_contract,
    account: {
      organizationId: row.organization_id,
      projectId: row.project_id,
      customerId: row.customer_user_id,
      displayName: row.display_name,
      email: row.email,
      organizationDisplayName: row.organization_display_name,
      accountState: row.account_state,
      membershipState: row.membership_state,
      projectState: row.project_state
    }
  };
}

function policySnapshot(row) {
  exactKeys(
    row,
    [
      "catalog_version",
      "legal_version",
      "publication_state",
      "service_key"
    ],
    "customServicesPolicyRow"
  );
  return {
    catalogVersion: row.catalog_version,
    serviceKey: row.service_key,
    legalVersion: row.legal_version,
    publicationState: row.publication_state
  };
}

function profileSnapshot(row) {
  if (row === null) return null;
  exactKeys(
    row,
    [
      "created_at",
      "customer_user_id",
      "delegated_access_state",
      "observed_at",
      "observed_hostname",
      "organization_id",
      "origin",
      "ownership_state",
      "platform_family",
      "project_id",
      "revision",
      "supportability_state",
      "takeover_required",
      "takeover_state",
      "updated_at"
    ],
    "customServicesProfileRow"
  );
  return {
    organizationId: row.organization_id,
    projectId: row.project_id,
    customerId: row.customer_user_id,
    origin: row.origin,
    observedHostname: row.observed_hostname,
    observedAt: nullableIso(
      row.observed_at,
      "customServicesProfileRow.observedAt"
    ),
    platformFamily: row.platform_family,
    ownershipState: row.ownership_state,
    takeoverRequired: row.takeover_required,
    takeoverState: row.takeover_state,
    supportabilityState: row.supportability_state,
    delegatedAccessState: row.delegated_access_state,
    revision: exactInteger(
      row.revision,
      "customServicesProfileRow.revision"
    ),
    createdAt: exactIso(
      row.created_at,
      "customServicesProfileRow.createdAt"
    ),
    updatedAt: exactIso(
      row.updated_at,
      "customServicesProfileRow.updatedAt"
    )
  };
}

function caseSnapshot(row) {
  if (row === null) return null;
  exactKeys(
    row,
    [
      "created_at",
      "created_by_user_id",
      "customer_user_id",
      "id",
      "organization_id",
      "project_id",
      "revision",
      "source",
      "state",
      "title",
      "updated_at",
      "withdrawn_at"
    ],
    "customServicesCaseRow"
  );
  return {
    organizationId: row.organization_id,
    projectId: row.project_id,
    customerId: row.customer_user_id,
    caseId: row.id,
    createdByCustomerId: row.created_by_user_id,
    source: row.source,
    state: row.state,
    title: row.title,
    withdrawnAt: nullableIso(
      row.withdrawn_at,
      "customServicesCaseRow.withdrawnAt"
    ),
    revision: exactInteger(
      row.revision,
      "customServicesCaseRow.revision"
    ),
    createdAt: exactIso(
      row.created_at,
      "customServicesCaseRow.createdAt"
    ),
    updatedAt: exactIso(
      row.updated_at,
      "customServicesCaseRow.updatedAt"
    )
  };
}

function offeringSnapshot(row) {
  if (row === null) return null;
  exactKeys(
    row,
    [
      "case_id",
      "customer_user_id",
      "organization_id",
      "policy_publication_state",
      "project_id",
      "removed_at",
      "requested_at",
      "requested_by_user_id",
      "service_key",
      "state",
      "updated_at"
    ],
    "customServicesOfferingRow"
  );
  return {
    organizationId: row.organization_id,
    projectId: row.project_id,
    customerId: row.customer_user_id,
    caseId: row.case_id,
    requestedByCustomerId: row.requested_by_user_id,
    serviceKey: row.service_key,
    policyPublicationState: row.policy_publication_state,
    state: row.state,
    requestedAt: exactIso(
      row.requested_at,
      "customServicesOfferingRow.requestedAt"
    ),
    removedAt: nullableIso(
      row.removed_at,
      "customServicesOfferingRow.removedAt"
    ),
    updatedAt: exactIso(
      row.updated_at,
      "customServicesOfferingRow.updatedAt"
    )
  };
}

function intakeSnapshot(row) {
  if (row === null) return null;
  exactKeys(
    row,
    [
      "approximate_public_size",
      "business_name",
      "case_id",
      "complexity_flags",
      "created_at",
      "created_by_user_id",
      "customer_observation",
      "customer_ownership_affirmed",
      "customer_user_id",
      "important_date",
      "organization_id",
      "platform_family",
      "primary_goal",
      "project_id",
      "public_hostname",
      "public_scheme",
      "revision",
      "site_display_name",
      "source",
      "state",
      "submitted_at"
    ],
    "customServicesIntakeRow"
  );
  invariant(
    Array.isArray(row.complexity_flags),
    "repository_conflict",
    "customServicesIntakeRow.complexityFlags is invalid",
    { status: 500 }
  );
  return {
    organizationId: row.organization_id,
    projectId: row.project_id,
    customerId: row.customer_user_id,
    caseId: row.case_id,
    createdByCustomerId: row.created_by_user_id,
    source: row.source,
    revision: exactInteger(
      row.revision,
      "customServicesIntakeRow.revision"
    ),
    state: row.state,
    siteDisplayName: row.site_display_name,
    publicScheme: row.public_scheme,
    publicHostname: row.public_hostname,
    businessName: row.business_name,
    primaryGoal: row.primary_goal,
    customerObservation: row.customer_observation,
    platformFamily: row.platform_family,
    approximatePublicSize: row.approximate_public_size,
    complexityFlags: [...row.complexity_flags],
    importantDate: exactDate(
      row.important_date,
      "customServicesIntakeRow.importantDate"
    ),
    customerOwnershipAffirmed:
      row.customer_ownership_affirmed,
    submittedAt: exactIso(
      row.submitted_at,
      "customServicesIntakeRow.submittedAt"
    ),
    createdAt: exactIso(
      row.created_at,
      "customServicesIntakeRow.createdAt"
    )
  };
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (DATABASE_CONFLICT_CODES.has(error?.code)) {
    return new HostedError(
      "repository_conflict",
      "the custom-services foundation repository rejected inconsistent truth",
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

async function readCurrentCase(client, input) {
  const open = await client.query(
    `select
       service_case.id,
       service_case.organization_id,
       service_case.project_id,
       service_case.customer_user_id,
       service_case.created_by_user_id,
       service_case.source,
       service_case.state,
       service_case.title,
       service_case.withdrawn_at,
       service_case.revision,
       service_case.created_at,
       service_case.updated_at
     from ss.service_cases service_case
    where service_case.organization_id = $1
      and service_case.project_id = $2
      and service_case.customer_user_id = $3
      and service_case.state <> 'withdrawn'
    order by service_case.updated_at desc, service_case.id desc
    limit 2`,
    [input.organizationId, input.projectId, input.customerId]
  );
  const openRows = rows(open, "customServicesOpenCases");
  invariant(
    openRows.length <= 1,
    "repository_conflict",
    "the customer has conflicting current service cases",
    { status: 500 }
  );
  if (openRows.length === 1) return caseSnapshot(openRows[0]);

  const withdrawn = await client.query(
    `select
       service_case.id,
       service_case.organization_id,
       service_case.project_id,
       service_case.customer_user_id,
       service_case.created_by_user_id,
       service_case.source,
       service_case.state,
       service_case.title,
       service_case.withdrawn_at,
       service_case.revision,
       service_case.created_at,
       service_case.updated_at
     from ss.service_cases service_case
    where service_case.organization_id = $1
      and service_case.project_id = $2
      and service_case.customer_user_id = $3
      and service_case.state = 'withdrawn'
    order by
      service_case.withdrawn_at desc,
      service_case.updated_at desc,
      service_case.id desc
    limit 1`,
    [input.organizationId, input.projectId, input.customerId]
  );
  return caseSnapshot(
    optionalSingle(withdrawn, "customServicesWithdrawnCase")
  );
}

async function readCaseOffering(client, input, serviceCase) {
  if (serviceCase === null) return null;
  const selected = await client.query(
    `select
       offering.organization_id,
       offering.project_id,
       offering.case_id,
       offering.customer_user_id,
       offering.requested_by_user_id,
       policy.service_key,
       policy.publication_state as policy_publication_state,
       offering.state,
       offering.requested_at,
       offering.removed_at,
       offering.updated_at
     from ss.service_case_offerings offering
     join ss.service_catalog_policies policy
       on policy.id = offering.policy_id
    where offering.organization_id = $1
      and offering.project_id = $2
      and offering.case_id = $3
      and offering.customer_user_id = $4
      and offering.policy_id = $5
    order by offering.requested_at desc, offering.id desc
    limit 2`,
    [
      input.organizationId,
      input.projectId,
      serviceCase.caseId,
      input.customerId,
      ASSESSMENT_POLICY_ID
    ]
  );
  return offeringSnapshot(
    optionalSingle(selected, "customServicesCaseOffering")
  );
}

async function readLatestIntake(client, input, serviceCase) {
  if (serviceCase === null) return null;
  const selected = await client.query(
    `select
       intake.organization_id,
       intake.project_id,
       intake.case_id,
       intake.customer_user_id,
       intake.created_by_user_id,
       intake.source,
       intake.revision,
       intake.state,
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
       intake.customer_ownership_affirmed,
       intake.submitted_at,
       intake.created_at
     from ss.service_intakes intake
    where intake.organization_id = $1
      and intake.project_id = $2
      and intake.case_id = $3
      and intake.customer_user_id = $4
    order by intake.revision desc
    limit 1`,
    [
      input.organizationId,
      input.projectId,
      serviceCase.caseId,
      input.customerId
    ]
  );
  return intakeSnapshot(
    optionalSingle(selected, "customServicesLatestIntake")
  );
}

/**
 * Read-only migration-34 adapter. It deliberately owns no pool or route; the
 * supplied canonical authority provides the one actor-bound transaction.
 */
export function createPostgresCustomServicesAccountRepository({
  authority
} = {}) {
  const database = validateAuthority(authority);

  return Object.freeze({
    async readFoundationSnapshot(value) {
      const input = exactInput(value);
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

            const accountResult = await client.query(
              `select
                 ss.hosted_runtime_contract_v34()
                   as runtime_contract,
                 account_user.id as customer_user_id,
                 account_user.email,
                 account_profile.display_name,
                 account_profile.state as account_state,
                 membership.organization_id,
                 membership.state as membership_state,
                 organization.name as organization_display_name,
                 project.id as project_id,
                 project.lifecycle as project_state
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
              [
                input.customerId,
                input.organizationId,
                input.projectId
              ]
            );
            const account = accountSnapshot(
              requiredSingle(accountResult, "customServicesAccount", {
                unavailable: true
              })
            );

            const policyResult = await client.query(
              `select
                 policy.catalog_version,
                 policy.service_key,
                 document.version as legal_version,
                 policy.publication_state
               from ss.service_catalog_policies policy
               join ss.legal_documents document
                 on document.id = policy.legal_document_id
                and document.content_digest =
                    policy.commercial_contract_digest
              where policy.id = $1
                and policy.catalog_version = $2
                and policy.service_key = $3
                and policy.publication_state = $4
                and document.version = $5
                and document.content_digest = $6
                and document.kind = 'custom_services'
                and document.retired_at is null
                and policy.pricing_mode = 'fixed'
                and policy.billing_cadence = 'one_time'
                and policy.currency = 'USD'
                and policy.unit_amount_minor = 20000
                and policy.minimum_quantity = 1
                and policy.maximum_quantity = 1
                and policy.scope_boundary = jsonb_build_object(
                  'expandedAssessmentState', 'separately_quoted',
                  'maximumFindings', 10,
                  'maximumRepresentativePagesOrTypes', 5,
                  'maximumWebsites', 1,
                  'requiredViewports', jsonb_build_array('desktop', 'phone')
                )
                and policy.scope_boundary_digest =
                    ss.service_json_digest(policy.scope_boundary)
                and policy.active_from <= clock_timestamp()
                and (
                  policy.active_until is null
                  or policy.active_until >= clock_timestamp()
                )
              limit 2`,
              [
                ASSESSMENT_POLICY_ID,
                CATALOG_VERSION,
                SERVICE_KEY,
                HELD,
                LEGAL_VERSION,
                LEGAL_DIGEST
              ]
            );
            const policy = policySnapshot(
              requiredSingle(policyResult, "customServicesPolicy")
            );

            const profileResult = await client.query(
              `select
                 profile.organization_id,
                 profile.project_id,
                 profile.customer_user_id,
                 profile.origin,
                 profile.observed_hostname,
                 profile.observed_at,
                 profile.platform_family,
                 profile.ownership_state,
                 profile.takeover_required,
                 profile.takeover_state,
                 profile.supportability_state,
                 profile.delegated_access_state,
                 profile.revision,
                 profile.created_at,
                 profile.updated_at
               from ss.service_project_profiles profile
              where profile.organization_id = $1
                and profile.project_id = $2
              limit 2`,
              [
                input.organizationId,
                input.projectId
              ]
            );
            const profile = profileSnapshot(
              optionalSingle(profileResult, "customServicesProjectProfile")
            );
            const serviceCase = await readCurrentCase(
              client,
              input
            );
            const offering = await readCaseOffering(
              client,
              input,
              serviceCase
            );
            const intake = await readLatestIntake(
              client,
              input,
              serviceCase
            );

            const scope = {
              actorId: input.actorId,
              customerId: input.customerId,
              organizationId: input.organizationId,
              projectId: input.projectId
            };
            const snapshot = {
              schema: CUSTOM_SERVICES_FOUNDATION_SNAPSHOT_SCHEMA,
              runtimeContract: account.runtimeContract,
              account: account.account,
              policy,
              profile,
              serviceCase,
              offering,
              intake
            };

            // Reuse the customer projector as the sole exact migration-34
            // schema, chronology, safe-text, and cross-binding validator.
            projectCustomServicesAccount({ scope, snapshot });
            invariant(
              snapshot.runtimeContract === FOUNDATION_CONTRACT,
              "repository_conflict",
              "the custom-services foundation contract changed",
              { status: 500 }
            );
            return deepFreeze(snapshot);
          }
        )
      );
    }
  });
}
