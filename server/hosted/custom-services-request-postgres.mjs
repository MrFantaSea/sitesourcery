import { createHash, randomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

export const CUSTOM_SERVICES_ASSESSMENT_REQUEST_SCHEMA =
  "sitesourcery.custom-services-assessment-request/v1";

const POLICY_ID = "00000000-0000-4000-8000-000000000341";
const COMMAND_RECEIPT_SCHEMA =
  "sitesourcery.custom-services-assessment-request-command/v1";
const ROUTES = Object.freeze({
  save: "custom_services.assessment_request.save",
  submit: "custom_services.assessment_request.submit",
  withdraw: "custom_services.assessment_request.withdraw"
});
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HOSTNAME =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const CREDENTIAL_MATERIAL =
  /(?:password|passcode|secret|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|seed[ _-]?phrase|card[ _-]?(?:number|details)|cvv|cvc|sk_(?:live|test)_|gh[pousr]_|-----BEGIN [A-Z ]*PRIVATE KEY-----)/iu;
const PLATFORM_FAMILIES = new Set([
  "custom",
  "other",
  "shopify",
  "squarespace",
  "unknown",
  "wix",
  "wordpress"
]);
const PUBLIC_SIZES = new Set([
  "application_or_unknown",
  "eleven_to_fifty",
  "more_than_fifty",
  "one_to_ten"
]);
const COMPLEXITY_FLAGS = new Set([
  "authenticated_area",
  "commerce",
  "forms",
  "large_content_set",
  "multilingual",
  "regulated_content",
  "third_party_integrations",
  "unknown_platform"
]);

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

function text(value, field, minimum, maximum) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      value.length >= minimum &&
      value.length <= maximum &&
      !CONTROL_CHARACTER.test(value) &&
      !CREDENTIAL_MATERIAL.test(value),
    "invalid_input",
    `${field} is invalid or contains private credential material`,
    { status: 400 }
  );
  return value;
}

function nullableText(value, field, minimum, maximum) {
  return value === null ? null : text(value, field, minimum, maximum);
}

function commandId(value) {
  return text(value, "commandId", 8, 200);
}

function nonnegativeInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return value;
}

function positiveInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return value;
}

function scope(value) {
  exactKeys(
    value,
    ["actorId", "customerId", "organizationId", "projectId"],
    "assessmentRequestScope"
  );
  const actorId = uuid(value.actorId, "actorId");
  const customerId = uuid(value.customerId, "customerId");
  invariant(
    actorId === customerId,
    "project_unavailable",
    "the customer assessment request is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    actorId,
    customerId,
    organizationId: uuid(value.organizationId, "organizationId"),
    projectId: uuid(value.projectId, "projectId")
  });
}

function publicUrl(value) {
  const selected = text(value, "publicUrl", 8, 2048);
  let parsed;
  try {
    parsed = new URL(selected);
  } catch {
    parsed = null;
  }
  invariant(
    parsed !== null &&
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.port === "" &&
      (parsed.pathname === "" || parsed.pathname === "/") &&
      parsed.search === "" &&
      parsed.hash === "" &&
      HOSTNAME.test(parsed.hostname.toLowerCase()),
    "invalid_input",
    "publicUrl must be the public website root, such as https://example.com/",
    { status: 400 }
  );
  return Object.freeze({
    scheme: parsed.protocol.slice(0, -1),
    hostname: parsed.hostname.toLowerCase(),
    url: `${parsed.protocol}//${parsed.hostname.toLowerCase()}/`
  });
}

function date(value) {
  if (value === null) return null;
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
    "importantDate is invalid",
    { status: 400 }
  );
  return value;
}

function saveInput(value) {
  exactKeys(
    value,
    [
      "actorId",
      "approximatePublicSize",
      "businessName",
      "commandId",
      "complexityFlags",
      "customerId",
      "customerObservation",
      "customerOwnershipAffirmed",
      "expectedDraftRevision",
      "importantDate",
      "organizationId",
      "platformFamily",
      "primaryGoal",
      "projectId",
      "publicUrl",
      "siteDisplayName"
    ],
    "assessmentRequestSaveInput"
  );
  const selectedScope = scope({
    actorId: value.actorId,
    customerId: value.customerId,
    organizationId: value.organizationId,
    projectId: value.projectId
  });
  invariant(
    value.platformFamily === null ||
      PLATFORM_FAMILIES.has(value.platformFamily),
    "invalid_input",
    "platformFamily is invalid",
    { status: 400 }
  );
  invariant(
    PUBLIC_SIZES.has(value.approximatePublicSize),
    "invalid_input",
    "approximatePublicSize is invalid",
    { status: 400 }
  );
  invariant(
    Array.isArray(value.complexityFlags) &&
      value.complexityFlags.length <= 8 &&
      value.complexityFlags.every((flag) => COMPLEXITY_FLAGS.has(flag)) &&
      new Set(value.complexityFlags).size === value.complexityFlags.length &&
      JSON.stringify([...value.complexityFlags].sort()) ===
        JSON.stringify(value.complexityFlags),
    "invalid_input",
    "complexityFlags must be unique and alphabetized",
    { status: 400 }
  );
  invariant(
    typeof value.customerOwnershipAffirmed === "boolean",
    "invalid_input",
    "customerOwnershipAffirmed is invalid",
    { status: 400 }
  );
  return deepFreeze({
    ...selectedScope,
    commandId: commandId(value.commandId),
    expectedDraftRevision: nonnegativeInteger(
      value.expectedDraftRevision,
      "expectedDraftRevision"
    ),
    siteDisplayName: text(value.siteDisplayName, "siteDisplayName", 2, 120),
    publicUrl: publicUrl(value.publicUrl),
    businessName: nullableText(value.businessName, "businessName", 2, 120),
    primaryGoal: text(value.primaryGoal, "primaryGoal", 2, 500),
    customerObservation: nullableText(
      value.customerObservation,
      "customerObservation",
      2,
      1000
    ),
    platformFamily: value.platformFamily,
    approximatePublicSize: value.approximatePublicSize,
    complexityFlags: [...value.complexityFlags],
    importantDate: date(value.importantDate),
    customerOwnershipAffirmed: value.customerOwnershipAffirmed
  });
}

function submitInput(value) {
  exactKeys(
    value,
    [
      "actorId",
      "commandId",
      "customerId",
      "draftRevision",
      "organizationId",
      "projectId"
    ],
    "assessmentRequestSubmitInput"
  );
  return Object.freeze({
    ...scope({
      actorId: value.actorId,
      customerId: value.customerId,
      organizationId: value.organizationId,
      projectId: value.projectId
    }),
    commandId: commandId(value.commandId),
    draftRevision: positiveInteger(value.draftRevision, "draftRevision")
  });
}

function withdrawInput(value) {
  exactKeys(
    value,
    ["actorId", "commandId", "customerId", "organizationId", "projectId"],
    "assessmentRequestWithdrawInput"
  );
  return Object.freeze({
    ...scope({
      actorId: value.actorId,
      customerId: value.customerId,
      organizationId: value.organizationId,
      projectId: value.projectId
    }),
    commandId: commandId(value.commandId)
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

function one(result, field, { optional = false } = {}) {
  invariant(
    result &&
      Array.isArray(result.rows) &&
      result.rows.length === result.rowCount &&
      result.rows.length <= 1,
    "repository_conflict",
    `${field} conflicts`,
    { status: 500 }
  );
  const row = result.rows[0] ?? null;
  invariant(
    optional || row !== null,
    "repository_conflict",
    `${field} is unavailable`,
    { status: 500 }
  );
  return row;
}

async function requireAccount(client, input) {
  const selected = await client.query(
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
  invariant(
    selected.rowCount === 1,
    "project_unavailable",
    "the customer assessment request is unavailable",
    { status: 404 }
  );
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function beginCommand(client, input, action, requestBody) {
  const route = ROUTES[action];
  const requestDigest = hash({ route, ...requestBody });
  const prior = one(
    await client.query(
      `select request_digest, state, response_body
         from ss.idempotency_keys
        where principal_id = $1
          and route_key = $2
          and idempotency_key = $3
        for update`,
      [input.customerId, route, input.commandId]
    ),
    "assessmentRequestCommand",
    { optional: true }
  );
  if (prior !== null) {
    invariant(
      prior.request_digest === requestDigest,
      "idempotency_conflict",
      "That idempotency key was already used for another action.",
      { status: 409 }
    );
    invariant(
      prior.state === "completed",
      "command_in_progress",
      "That assessment request action has not reached a safe final state.",
      { status: 409 }
    );
    return Object.freeze({ replay: true, receipt: prior.response_body });
  }
  const id = randomUUID();
  await client.query(
    `insert into ss.idempotency_keys (
       id, organization_id, principal_id, route_key,
       idempotency_key, request_digest, state, expires_at
     ) values (
       $1, $2, $3, $4, $5, $6, 'running',
       clock_timestamp() + interval '24 hours'
     )`,
    [
      id,
      input.organizationId,
      input.customerId,
      route,
      input.commandId,
      requestDigest
    ]
  );
  return Object.freeze({ id, replay: false });
}

async function finishCommand(client, command, input, action, resourceId) {
  const receipt = {
    schema: COMMAND_RECEIPT_SCHEMA,
    action,
    projectId: input.projectId,
    resourceId,
    state: "completed"
  };
  await client.query(
    `update ss.idempotency_keys
        set state = 'completed',
            response_status = 200,
            response_body = $2::jsonb,
            resource_type = 'custom_service_assessment_request',
            resource_id = $3
      where id = $1`,
    [command.id, JSON.stringify(receipt), resourceId]
  );
  return deepFreeze(receipt);
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "project_unavailable",
      "the customer assessment request is unavailable",
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
      "assessment_request_changed",
      "The assessment request changed. Refresh it before trying again.",
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

async function currentCase(client, input, { lock = false } = {}) {
  const selected = await client.query(
    `select id, state, title, revision, withdrawn_at, created_at, updated_at
       from ss.service_cases
      where organization_id = $1
        and project_id = $2
        and customer_user_id = $3
        and state in ('draft', 'submitted')
      order by updated_at desc, id desc
      limit 2${lock ? " for update" : ""}`,
    [input.organizationId, input.projectId, input.customerId]
  );
  invariant(
    selected.rowCount <= 1,
    "repository_conflict",
    "the customer has conflicting current assessment requests",
    { status: 500 }
  );
  if (selected.rowCount === 1) return selected.rows[0];
  if (lock) return null;
  return one(
    await client.query(
      `select id, state, title, revision, withdrawn_at, created_at, updated_at
         from ss.service_cases
        where organization_id = $1
          and project_id = $2
          and customer_user_id = $3
          and state = 'withdrawn'
        order by withdrawn_at desc, updated_at desc, id desc
        limit 1`,
      [input.organizationId, input.projectId, input.customerId]
    ),
    "assessmentRequestWithdrawnCase",
    { optional: true }
  );
}

const FACT_COLUMNS = `
  site_display_name, public_scheme, public_hostname, business_name,
  primary_goal, customer_observation, platform_family,
  approximate_public_size, complexity_flags, important_date,
  customer_ownership_affirmed`;

async function readState(client, input) {
  const profile = one(
    await client.query(
      `select customer_user_id, origin, observed_hostname, platform_family,
              revision, updated_at
         from ss.service_project_profiles
        where organization_id = $1 and project_id = $2
        limit 2`,
      [input.organizationId, input.projectId]
    ),
    "assessmentRequestProfile",
    { optional: true }
  );
  invariant(
    profile === null || profile.customer_user_id === input.customerId,
    "project_unavailable",
    "the customer assessment request is unavailable",
    { status: 404 }
  );
  const serviceCase = await currentCase(client, input);
  let draft = null;
  let intake = null;
  let offering = null;
  let accepted = false;
  if (serviceCase !== null) {
    draft = one(
      await client.query(
        `select revision, created_at, updated_at, ${FACT_COLUMNS}
           from ss.service_intake_drafts
          where organization_id = $1
            and project_id = $2
            and customer_user_id = $3
            and case_id = $4
          limit 2`,
        [
          input.organizationId,
          input.projectId,
          input.customerId,
          serviceCase.id
        ]
      ),
      "assessmentRequestDraft",
      { optional: true }
    );
    intake = one(
      await client.query(
        `select revision, submitted_at, created_at, ${FACT_COLUMNS}
           from ss.service_intakes
          where organization_id = $1
            and project_id = $2
            and customer_user_id = $3
            and case_id = $4
          order by revision desc
          limit 1`,
        [
          input.organizationId,
          input.projectId,
          input.customerId,
          serviceCase.id
        ]
      ),
      "assessmentRequestIntake",
      { optional: true }
    );
    offering = one(
      await client.query(
        `select id, state, requested_at, removed_at
           from ss.service_case_offerings
          where organization_id = $1
            and project_id = $2
            and customer_user_id = $3
            and case_id = $4
            and policy_id = $5
          limit 2`,
        [
          input.organizationId,
          input.projectId,
          input.customerId,
          serviceCase.id,
          POLICY_ID
        ]
      ),
      "assessmentRequestOffering",
      { optional: true }
    );
    const acceptance = one(
      await client.query(
        `select exists (
           select 1
             from ss.service_quotes quote
             join ss.service_quote_acceptances acceptance
               on acceptance.organization_id = quote.organization_id
              and acceptance.quote_id = quote.id
            where quote.organization_id = $1
              and quote.project_id = $2
              and quote.customer_user_id = $3
              and quote.case_id = $4
         ) as accepted`,
        [
          input.organizationId,
          input.projectId,
          input.customerId,
          serviceCase.id
        ]
      ),
      "assessmentRequestAcceptance"
    );
    accepted = acceptance.accepted === true;
  }
  return { accepted, draft, intake, offering, profile, serviceCase };
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function requestProjection(value) {
  const { accepted, draft, intake, offering, profile, serviceCase } = value;
  const state = serviceCase?.state ?? "not_started";
  invariant(
    ["not_started", "draft", "submitted", "withdrawn"].includes(state) &&
      (state !== "draft" || (draft !== null && intake === null && offering === null)) &&
      (state !== "submitted" ||
        (intake !== null && offering?.state === "requested")) &&
      (state !== "withdrawn" || offering === null || offering.state === "removed"),
    "repository_conflict",
    "the assessment request state is incomplete",
    { status: 500 }
  );
  const facts = intake ?? draft;
  const website = facts
    ? {
        displayName: facts.site_display_name,
        publicUrl: `${facts.public_scheme}://${facts.public_hostname}/`,
        platformFamily: facts.platform_family,
        customerOwnershipAffirmed: facts.customer_ownership_affirmed
      }
    : profile?.observed_hostname
      ? {
          displayName: null,
          publicUrl: `https://${profile.observed_hostname}/`,
          platformFamily: profile.platform_family,
          customerOwnershipAffirmed: false
        }
      : null;
  return deepFreeze({
    schema: CUSTOM_SERVICES_ASSESSMENT_REQUEST_SCHEMA,
    state,
    caseId: serviceCase?.id ?? null,
    caseRevision: serviceCase ? Number(serviceCase.revision) : null,
    draftRevision: state === "draft" ? Number(draft.revision) : null,
    title: serviceCase?.title ?? null,
    website,
    facts: facts
      ? {
          businessName: facts.business_name,
          primaryGoal: facts.primary_goal,
          customerObservation: facts.customer_observation,
          approximatePublicSize: facts.approximate_public_size,
          complexityFlags: [...facts.complexity_flags],
          importantDate:
            facts.important_date instanceof Date
              ? facts.important_date.toISOString().slice(0, 10)
              : facts.important_date,
          updatedAt: iso(
            intake?.submitted_at ?? draft?.updated_at ?? draft?.created_at
          )
        }
      : null,
    submittedAt: intake ? iso(intake.submitted_at) : null,
    withdrawnAt: serviceCase?.withdrawn_at
      ? iso(serviceCase.withdrawn_at)
      : null,
    actions: {
      save: {
        available: ["not_started", "draft", "withdrawn"].includes(state)
      },
      submit: {
        available:
          state === "draft" && draft.customer_ownership_affirmed === true
      },
      withdraw: {
        available:
          ["draft", "submitted"].includes(state) && accepted === false,
        reason: accepted ? "accepted_quote_locks_request" : null
      }
    }
  });
}

async function lockProject(client, input) {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`custom-services-request:${input.organizationId}:${input.projectId}`]
  );
}

export function createPostgresCustomServicesRequestRepository({
  authority
} = {}) {
  const database = validateAuthority(authority);
  const context = (input, readOnly = false) => ({
    actorKind: "customer",
    userId: input.actorId,
    organizationId: input.organizationId,
    ...(readOnly ? { readOnly: true } : {})
  });

  return Object.freeze({
    async readCurrentRequest(value) {
      const input = scope(value);
      return translated(() =>
        database.service(context(input, true), async (client) => {
          await requireAccount(client, input);
          return requestProjection(await readState(client, input));
        })
      );
    },

    async saveDraft(value) {
      const input = saveInput(value);
      return translated(() =>
        database.service(context(input), async (client) => {
          await requireAccount(client, input);
          await lockProject(client, input);
          const command = await beginCommand(client, input, "save", {
            organizationId: input.organizationId,
            projectId: input.projectId,
            customerId: input.customerId,
            expectedDraftRevision: input.expectedDraftRevision,
            siteDisplayName: input.siteDisplayName,
            publicUrl: input.publicUrl.url,
            businessName: input.businessName,
            primaryGoal: input.primaryGoal,
            customerObservation: input.customerObservation,
            platformFamily: input.platformFamily,
            approximatePublicSize: input.approximatePublicSize,
            complexityFlags: input.complexityFlags,
            importantDate: input.importantDate,
            customerOwnershipAffirmed: input.customerOwnershipAffirmed
          });
          if (command.replay) return command.receipt;

          let selectedCase = await currentCase(client, input, { lock: true });
          invariant(
            selectedCase?.state !== "submitted",
            "assessment_request_submitted",
            "Withdraw the submitted assessment request before changing it.",
            { status: 409 }
          );
          const profile = one(
            await client.query(
              `select customer_user_id, origin
                 from ss.service_project_profiles
                where organization_id = $1 and project_id = $2
                limit 2
                for update`,
              [input.organizationId, input.projectId]
            ),
            "assessmentRequestProfile",
            { optional: true }
          );
          invariant(
            profile === null ||
              (profile.customer_user_id === input.customerId &&
                profile.origin === "external"),
            "project_unavailable",
            "the customer assessment request is unavailable",
            { status: 404 }
          );
          if (profile === null) {
            await client.query(
              `insert into ss.service_project_profiles (
                 organization_id, project_id, customer_user_id, origin,
                 observed_hostname, observed_at, platform_family,
                 ownership_state, takeover_required, takeover_state,
                 supportability_state
               ) values (
                 $1, $2, $3, 'external', $4, clock_timestamp(), $5,
                 'customer_stated', true, 'review_required', 'not_reviewed'
               )`,
              [
                input.organizationId,
                input.projectId,
                input.customerId,
                input.publicUrl.hostname,
                input.platformFamily ?? "unknown"
              ]
            );
          } else {
            await client.query(
              `update ss.service_project_profiles
                  set observed_hostname = $2,
                      observed_at = clock_timestamp(),
                      platform_family = $3
                where project_id = $1`,
              [
                input.projectId,
                input.publicUrl.hostname,
                input.platformFamily ?? "unknown"
              ]
            );
          }

          if (selectedCase === null) {
            invariant(
              input.expectedDraftRevision === 0,
              "assessment_request_changed",
              "Refresh the assessment request before saving it.",
              { status: 409 }
            );
            selectedCase = one(
              await client.query(
                `insert into ss.service_cases (
                   organization_id, project_id, customer_user_id,
                   created_by_user_id, source, title
                 ) values ($1, $2, $3, $3, 'account', $4)
                 returning id, state, title, revision,
                           withdrawn_at, created_at, updated_at`,
                [
                  input.organizationId,
                  input.projectId,
                  input.customerId,
                  `Website assessment: ${input.siteDisplayName}`
                ]
              ),
              "assessmentRequestNewCase"
            );
          } else {
            await client.query(
              `update ss.service_cases
                  set title = $2
                where id = $1 and title is distinct from $2`,
              [selectedCase.id, `Website assessment: ${input.siteDisplayName}`]
            );
          }

          const existingDraft = one(
            await client.query(
              `select revision
                 from ss.service_intake_drafts
                where case_id = $1
                for update`,
              [selectedCase.id]
            ),
            "assessmentRequestExistingDraft",
            { optional: true }
          );
          if (existingDraft === null) {
            invariant(
              input.expectedDraftRevision === 0,
              "assessment_request_changed",
              "Refresh the assessment request before saving it.",
              { status: 409 }
            );
            await client.query(
              `insert into ss.service_intake_drafts (
                 organization_id, project_id, case_id, customer_user_id,
                 created_by_user_id, source, ${FACT_COLUMNS}
               ) values (
                 $1, $2, $3, $4, $4, 'account',
                 $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
               )`,
              [
                input.organizationId,
                input.projectId,
                selectedCase.id,
                input.customerId,
                input.siteDisplayName,
                input.publicUrl.scheme,
                input.publicUrl.hostname,
                input.businessName,
                input.primaryGoal,
                input.customerObservation,
                input.platformFamily,
                input.approximatePublicSize,
                input.complexityFlags,
                input.importantDate,
                input.customerOwnershipAffirmed
              ]
            );
          } else {
            invariant(
              Number(existingDraft.revision) === input.expectedDraftRevision,
              "assessment_request_changed",
              "Refresh the assessment request before saving it.",
              { status: 409 }
            );
            await client.query(
              `update ss.service_intake_drafts
                  set site_display_name = $2,
                      public_scheme = $3,
                      public_hostname = $4,
                      business_name = $5,
                      primary_goal = $6,
                      customer_observation = $7,
                      platform_family = $8,
                      approximate_public_size = $9,
                      complexity_flags = $10,
                      important_date = $11,
                      customer_ownership_affirmed = $12
                where case_id = $1`,
              [
                selectedCase.id,
                input.siteDisplayName,
                input.publicUrl.scheme,
                input.publicUrl.hostname,
                input.businessName,
                input.primaryGoal,
                input.customerObservation,
                input.platformFamily,
                input.approximatePublicSize,
                input.complexityFlags,
                input.importantDate,
                input.customerOwnershipAffirmed
              ]
            );
          }
          return finishCommand(
            client,
            command,
            input,
            "save",
            selectedCase.id
          );
        })
      );
    },

    async submitCurrentRequest(value) {
      const input = submitInput(value);
      return translated(() =>
        database.service(context(input), async (client) => {
          await requireAccount(client, input);
          await lockProject(client, input);
          const command = await beginCommand(client, input, "submit", {
            organizationId: input.organizationId,
            projectId: input.projectId,
            customerId: input.customerId,
            draftRevision: input.draftRevision
          });
          if (command.replay) return command.receipt;
          const selectedCase = await currentCase(client, input, { lock: true });
          invariant(
            selectedCase?.state === "draft",
            "assessment_draft_required",
            "Save an assessment request draft before submitting it.",
            { status: 409 }
          );
          const draft = one(
            await client.query(
              `select revision, ${FACT_COLUMNS}
                 from ss.service_intake_drafts
                where case_id = $1
                for update`,
              [selectedCase.id]
            ),
            "assessmentRequestDraft"
          );
          invariant(
            Number(draft.revision) === input.draftRevision &&
              draft.customer_ownership_affirmed === true,
            "assessment_request_changed",
            "Save the current request and affirm website authority before submitting.",
            { status: 409 }
          );
          await client.query(
            "update ss.service_cases set state = 'submitted' where id = $1",
            [selectedCase.id]
          );
          await client.query(
            `insert into ss.service_case_offerings (
               organization_id, project_id, case_id, customer_user_id,
               requested_by_user_id, policy_id
             ) values ($1, $2, $3, $4, $4, $5)`,
            [
              input.organizationId,
              input.projectId,
              selectedCase.id,
              input.customerId,
              POLICY_ID
            ]
          );
          await client.query(
            `insert into ss.service_intakes (
               organization_id, project_id, case_id, customer_user_id,
               created_by_user_id, source, ${FACT_COLUMNS}
             ) values (
               $1, $2, $3, $4, $4, 'account',
               $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
             )`,
            [
              input.organizationId,
              input.projectId,
              selectedCase.id,
              input.customerId,
              draft.site_display_name,
              draft.public_scheme,
              draft.public_hostname,
              draft.business_name,
              draft.primary_goal,
              draft.customer_observation,
              draft.platform_family,
              draft.approximate_public_size,
              draft.complexity_flags,
              draft.important_date,
              draft.customer_ownership_affirmed
            ]
          );
          await client.query("set constraints all immediate");
          return finishCommand(
            client,
            command,
            input,
            "submit",
            selectedCase.id
          );
        })
      );
    },

    async withdrawCurrentRequest(value) {
      const input = withdrawInput(value);
      return translated(() =>
        database.service(context(input), async (client) => {
          await requireAccount(client, input);
          await lockProject(client, input);
          const command = await beginCommand(client, input, "withdraw", {
            organizationId: input.organizationId,
            projectId: input.projectId,
            customerId: input.customerId
          });
          if (command.replay) return command.receipt;
          const selectedCase = await currentCase(client, input, { lock: true });
          invariant(
            selectedCase !== null,
            "assessment_request_unavailable",
            "There is no current assessment request to withdraw.",
            { status: 409 }
          );
          if (selectedCase.state === "submitted") {
            const removed = await client.query(
              `update ss.service_case_offerings
                  set state = 'removed'
                where case_id = $1
                  and policy_id = $2
                  and state = 'requested'`,
              [selectedCase.id, POLICY_ID]
            );
            invariant(
              removed.rowCount === 1,
              "repository_conflict",
              "the submitted assessment offering is unavailable",
              { status: 500 }
            );
          }
          await client.query(
            "update ss.service_cases set state = 'withdrawn' where id = $1",
            [selectedCase.id]
          );
          await client.query("set constraints all immediate");
          return finishCommand(
            client,
            command,
            input,
            "withdraw",
            selectedCase.id
          );
        })
      );
    }
  });
}
