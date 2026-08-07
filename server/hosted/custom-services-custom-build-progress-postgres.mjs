import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

export const CUSTOM_BUILD_PROGRESS_SCHEMA =
  "sitesourcery.custom-build-progress/v1";

const READINESS_SCHEMA =
  "sitesourcery.custom-build-progress-readiness/v1";
const RUNTIME_CONTRACT = "canonical-ss-v43-custom-build-progress";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const CREDENTIAL =
  /(password|passcode|secret|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|recovery[ _-]?code|private[ _-]?key|seed[ _-]?phrase)/iu;
const STAGES = new Set(["preparing", "building", "checking"]);
const MILESTONE_STATES = new Set(["pending", "in_progress", "done"]);
const REQUEST_KINDS = new Set([
  "customer_content",
  "customer_decision",
  "delegated_access",
  "outside_dependency"
]);
const RESPONSE_KINDS = new Set(["provided", "cannot_provide"]);
const RESOLUTION_STATES = new Set(["resolved", "withdrawn"]);
const TARGET_IMPACTS = new Set(["none", "under_review"]);
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
const MILESTONES = Object.freeze([
  ["structure", "Plan and structure", "structure_milestone"],
  ["content", "Pages and content", "content_milestone"],
  ["responsive", "Phone and accessibility", "responsive_milestone"],
  ["quality", "Final checks", "quality_milestone"]
]);

function exactKeys(value, expected, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "INVALID_CUSTOM_BUILD_PROGRESS_INPUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "INVALID_CUSTOM_BUILD_PROGRESS_INPUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function actorId(value) {
  if (!value || typeof value.userId !== "string" || !UUID.test(value.userId)) {
    throw new HostedError(
      "AUTHENTICATION_REQUIRED",
      "Sign in before opening Custom-build project tools.",
      { status: 401 }
    );
  }
  return value.userId;
}

function safeText(value, field, minimum, maximum) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      value.length >= minimum &&
      value.length <= maximum &&
      !CONTROL.test(value) &&
      !CREDENTIAL.test(value),
    "INVALID_CUSTOM_BUILD_PROGRESS_INPUT",
    `${field} is invalid. Do not include passwords, codes, keys, or tokens.`,
    { status: 400 }
  );
  return value;
}

function commandId(value) {
  return safeText(value, "commandId", 8, 200);
}

function revision(value, field) {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    "INVALID_CUSTOM_BUILD_PROGRESS_INPUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function oneOf(value, allowed, field) {
  invariant(
    typeof value === "string" && allowed.has(value),
    "INVALID_CUSTOM_BUILD_PROGRESS_INPUT",
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
    "INVALID_CUSTOM_BUILD_PROGRESS_INPUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function customerScope(value) {
  exactKeys(
    value,
    ["actorId", "customerId", "organizationId", "projectId"],
    "customerScope"
  );
  const scope = {
    actorId: uuid(value.actorId, "actorId"),
    customerId: uuid(value.customerId, "customerId"),
    organizationId: uuid(value.organizationId, "organizationId"),
    projectId: uuid(value.projectId, "projectId")
  };
  invariant(
    scope.actorId === scope.customerId,
    "CUSTOM_BUILD_PROGRESS_UNAVAILABLE",
    "That Custom-build project is unavailable.",
    { status: 404 }
  );
  return Object.freeze(scope);
}

function progressInput(value) {
  exactKeys(
    value,
    [
      "commandId",
      "customerSummary",
      "expectedRevision",
      "milestones",
      "nextStep",
      "organizationId",
      "stage"
    ],
    "progressUpdate"
  );
  exactKeys(
    value.milestones,
    ["content", "quality", "responsive", "structure"],
    "milestones"
  );
  return Object.freeze({
    commandId: commandId(value.commandId),
    customerSummary: safeText(
      value.customerSummary,
      "customerSummary",
      10,
      500
    ),
    expectedRevision: revision(value.expectedRevision, "expectedRevision"),
    milestones: Object.freeze({
      content: oneOf(value.milestones.content, MILESTONE_STATES, "content"),
      quality: oneOf(value.milestones.quality, MILESTONE_STATES, "quality"),
      responsive: oneOf(
        value.milestones.responsive,
        MILESTONE_STATES,
        "responsive"
      ),
      structure: oneOf(
        value.milestones.structure,
        MILESTONE_STATES,
        "structure"
      )
    }),
    nextStep: safeText(value.nextStep, "nextStep", 5, 500),
    organizationId: uuid(value.organizationId, "organizationId"),
    stage: oneOf(value.stage, STAGES, "stage")
  });
}

function accessInput(value, requestKind) {
  if (requestKind !== "delegated_access") {
    invariant(
      value === null,
      "INVALID_CUSTOM_BUILD_PROGRESS_INPUT",
      "access must be empty for this request type.",
      { status: 400 }
    );
    return null;
  }
  exactKeys(
    value,
    ["accountLabel", "delegatedRole", "expiresAt", "providerLabel"],
    "access"
  );
  const expiresAt = exactIso(value.expiresAt, "access.expiresAt");
  invariant(
    Date.parse(expiresAt) > Date.now() &&
      Date.parse(expiresAt) <= Date.now() + 30 * 24 * 60 * 60 * 1000,
    "INVALID_CUSTOM_BUILD_PROGRESS_INPUT",
    "access.expiresAt must be within the next 30 days.",
    { status: 400 }
  );
  return Object.freeze({
    accountLabel: safeText(value.accountLabel, "accountLabel", 1, 254),
    delegatedRole: safeText(value.delegatedRole, "delegatedRole", 1, 254),
    expiresAt,
    providerLabel: safeText(value.providerLabel, "providerLabel", 1, 254)
  });
}

function requestInput(value) {
  exactKeys(
    value,
    [
      "access",
      "commandId",
      "customerMessage",
      "expectedProgressRevision",
      "organizationId",
      "requestKind",
      "safeInstructions",
      "targetDateImpact",
      "title"
    ],
    "workRequest"
  );
  const requestKind = oneOf(value.requestKind, REQUEST_KINDS, "requestKind");
  const targetDateImpact = oneOf(
    value.targetDateImpact,
    TARGET_IMPACTS,
    "targetDateImpact"
  );
  invariant(
    requestKind !== "outside_dependency" ||
      targetDateImpact === "under_review",
    "INVALID_CUSTOM_BUILD_PROGRESS_INPUT",
    "An outside dependency must show that the target date is under review.",
    { status: 400 }
  );
  return Object.freeze({
    access: accessInput(value.access, requestKind),
    commandId: commandId(value.commandId),
    customerMessage: safeText(
      value.customerMessage,
      "customerMessage",
      10,
      1_000
    ),
    expectedProgressRevision: revision(
      value.expectedProgressRevision,
      "expectedProgressRevision"
    ),
    organizationId: uuid(value.organizationId, "organizationId"),
    requestKind,
    safeInstructions: safeText(
      value.safeInstructions,
      "safeInstructions",
      10,
      1_000
    ),
    targetDateImpact,
    title: safeText(value.title, "title", 5, 120)
  });
}

function responseInput(value) {
  exactKeys(
    value,
    ["commandId", "expectedRevision", "responseKind", "responseNote"],
    "workResponse"
  );
  return Object.freeze({
    commandId: commandId(value.commandId),
    expectedRevision: revision(value.expectedRevision, "expectedRevision"),
    responseKind: oneOf(value.responseKind, RESPONSE_KINDS, "responseKind"),
    responseNote: safeText(value.responseNote, "responseNote", 1, 1_000)
  });
}

function resolutionInput(value) {
  exactKeys(
    value,
    [
      "commandId",
      "expectedRevision",
      "organizationId",
      "resolutionNote",
      "state"
    ],
    "workResolution"
  );
  return Object.freeze({
    commandId: commandId(value.commandId),
    expectedRevision: revision(value.expectedRevision, "expectedRevision"),
    organizationId: uuid(value.organizationId, "organizationId"),
    resolutionNote: safeText(
      value.resolutionNote,
      "resolutionNote",
      5,
      500
    ),
    state: oneOf(value.state, RESOLUTION_STATES, "state")
  });
}

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Canonical PostgreSQL authority is required for Custom-build progress.",
    { status: 500 }
  );
  return value;
}

function rows(result, field, maximum = Number.MAX_SAFE_INTEGER) {
  invariant(
    result &&
      Array.isArray(result.rows) &&
      Number.isSafeInteger(result.rowCount) &&
      result.rowCount === result.rows.length &&
      result.rowCount <= maximum,
    "CUSTOM_BUILD_PROGRESS_REPOSITORY_CONFLICT",
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
      "CUSTOM_BUILD_PROGRESS_UNAVAILABLE",
      "That Custom-build project is unavailable.",
      { status: 404 }
    );
    return null;
  }
  return selected[0];
}

function storedInteger(value, field, minimum = 0) {
  const selected = typeof value === "number" ? value : Number(value);
  invariant(
    Number.isSafeInteger(selected) && selected >= minimum,
    "CUSTOM_BUILD_PROGRESS_REPOSITORY_CONFLICT",
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
    "CUSTOM_BUILD_PROGRESS_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function storedIso(value, field) {
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    !Number.isNaN(selected.getTime()),
    "CUSTOM_BUILD_PROGRESS_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected.toISOString();
}

function storedDate(value, field) {
  invariant(
    typeof value === "string" && DATE.test(value),
    "CUSTOM_BUILD_PROGRESS_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function defaultProgress(row) {
  return {
    revision: 0,
    stage: "preparing",
    stageLabel: "Preparing",
    summary: "Your paid project is prepared for its first work update.",
    nextStep: "Site Sourcery will post the next project update here.",
    updatedAt: storedIso(row.opened_at, "job opened time"),
    milestones: MILESTONES.map(([key, label]) => ({
      key,
      label,
      state: "pending"
    }))
  };
}

function progressProjection(row) {
  if (row.progress_revision === null) return defaultProgress(row);
  const stage = oneOfStored(row.progress_stage, STAGES, "progress stage");
  return {
    revision: storedInteger(row.progress_revision, "progress revision", 1),
    stage,
    stageLabel: {
      preparing: "Preparing",
      building: "Building",
      checking: "Checking the work"
    }[stage],
    summary: storedText(row.customer_summary, "progress summary", 10, 500),
    nextStep: storedText(row.next_step, "progress next step", 5, 500),
    updatedAt: storedIso(row.progress_recorded_at, "progress updated time"),
    milestones: MILESTONES.map(([key, label, column]) => ({
      key,
      label,
      state: oneOfStored(row[column], MILESTONE_STATES, `${key} milestone`)
    }))
  };
}

function oneOfStored(value, allowed, field) {
  invariant(
    typeof value === "string" && allowed.has(value),
    "CUSTOM_BUILD_PROGRESS_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function requestProjection(row) {
  if (row.request_id === null) return null;
  const requestKind = oneOfStored(
    row.request_kind,
    REQUEST_KINDS,
    "request kind"
  );
  const state = oneOfStored(
    row.request_state,
    new Set(["open", "answered"]),
    "request state"
  );
  const responseRequired = requestKind !== "outside_dependency";
  invariant(
    row.response_required === responseRequired,
    "CUSTOM_BUILD_PROGRESS_REPOSITORY_CONFLICT",
    "request response boundary is invalid.",
    { status: 500 }
  );
  const response = state === "answered"
    ? {
        kind: oneOfStored(
          row.response_kind,
          RESPONSE_KINDS,
          "response kind"
        ),
        note: storedText(row.response_note, "response note", 1, 1_000),
        answeredAt: storedIso(row.answered_at, "response time")
      }
    : null;
  const access = requestKind === "delegated_access"
    ? {
        providerLabel: storedText(
          row.provider_label,
          "access provider",
          1,
          254
        ),
        accountLabel: storedText(
          row.account_label,
          "access account",
          1,
          254
        ),
        delegatedRole: storedText(
          row.delegated_role,
          "access role",
          1,
          254
        ),
        expiresAt: storedIso(row.access_expires_at, "access expiration")
      }
    : null;
  return {
    requestId: uuidStored(row.request_id, "request ID"),
    revision: storedInteger(row.request_revision, "request revision", 1),
    kind: requestKind,
    title: storedText(row.request_title, "request title", 5, 120),
    message: storedText(row.customer_message, "request message", 10, 1_000),
    safeInstructions: storedText(
      row.safe_instructions,
      "safe instructions",
      10,
      1_000
    ),
    targetDateImpact: oneOfStored(
      row.target_date_impact,
      TARGET_IMPACTS,
      "target-date impact"
    ),
    responseRequired,
    state,
    response,
    access,
    createdAt: storedIso(row.request_created_at, "request created time"),
    updatedAt: storedIso(row.request_updated_at, "request updated time")
  };
}

function uuidStored(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "CUSTOM_BUILD_PROGRESS_REPOSITORY_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function snapshotProjection(row) {
  const progress = progressProjection(row);
  const activeRequest = requestProjection(row);
  let status = {
    kind: progress.stage,
    label: progress.stageLabel
  };
  if (activeRequest?.kind === "outside_dependency") {
    status = {
      kind: "waiting_on_dependency",
      label: "Waiting on an outside dependency"
    };
  } else if (activeRequest?.state === "answered") {
    status = {
      kind: "reviewing_response",
      label: "Site Sourcery is reviewing your response"
    };
  } else if (activeRequest?.responseRequired) {
    status = { kind: "action_needed", label: "Action needed from you" };
  }
  invariant(
    row.job_state === "open",
    "CUSTOM_BUILD_PROGRESS_REPOSITORY_CONFLICT",
    "Custom-build job state is invalid.",
    { status: 500 }
  );
  return deepFreeze({
    schema: CUSTOM_BUILD_PROGRESS_SCHEMA,
    state: "active",
    jobId: uuidStored(row.job_id, "job ID"),
    targetCompletionDate: storedDate(
      row.target_completion_date,
      "target completion date"
    ),
    targetDateUnderReview:
      activeRequest?.targetDateImpact === "under_review",
    status,
    progress,
    activeRequest
  });
}

const SNAPSHOT_SELECT = `
  select
    job.id as job_id,
    job.organization_id,
    job.project_id,
    job.case_id,
    job.customer_user_id,
    job.state as job_state,
    job.opened_at,
    effective_scope.effective_target_completion_date::text
      as target_completion_date,
    progress.revision as progress_revision,
    progress.stage as progress_stage,
    progress.structure_milestone,
    progress.content_milestone,
    progress.responsive_milestone,
    progress.quality_milestone,
    progress.customer_summary,
    progress.next_step,
    progress.recorded_at as progress_recorded_at,
    request.id as request_id,
    request.request_kind,
    request.title as request_title,
    request.customer_message,
    request.safe_instructions,
    request.target_date_impact,
    request.response_required,
    request.state as request_state,
    request.revision as request_revision,
    request.response_kind,
    request.response_note,
    request.answered_at,
    request.created_at as request_created_at,
    request.updated_at as request_updated_at,
    access.provider_label,
    access.account_label,
    access.delegated_role,
    access.expires_at as access_expires_at
  from ss.service_custom_build_jobs job
  cross join lateral ss.service_custom_build_effective_scope_snapshot(
    job.organization_id,
    job.id
  ) effective_scope
  left join lateral (
    select candidate.*
    from ss.service_custom_build_progress_updates candidate
    where candidate.organization_id = job.organization_id
      and candidate.job_id = job.id
    order by candidate.revision desc
    limit 1
  ) progress on true
  left join lateral (
    select candidate.*
    from ss.service_custom_build_work_requests candidate
    where candidate.organization_id = job.organization_id
      and candidate.job_id = job.id
      and candidate.state in ('open', 'answered')
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) request on true
  left join ss.service_access_requests access
    on access.organization_id = request.organization_id
   and access.job_id = request.job_id
   and access.id = request.access_request_id`;

async function requireOperator(client, operatorUserId) {
  const selected = one(
    await client.query(
      `select ss.service_operator_has_capability(
         $1, 'service_job_manage', clock_timestamp()
       ) as authorized`,
      [operatorUserId]
    ),
    "Custom-build progress operator"
  );
  invariant(
    selected.authorized === true,
    "OPERATOR_ACCESS_REQUIRED",
    "Custom-build project tools are unavailable for this account.",
    { status: 403 }
  );
}

async function jobContext(client, organizationId, jobId) {
  return one(
    await client.query(
      `select organization_id, project_id, case_id, customer_user_id
       from ss.service_custom_build_jobs
       where organization_id = $1 and id = $2 and state = 'open'`,
      [organizationId, jobId]
    ),
    "Custom-build job"
  );
}

async function readOwnerSnapshot(client, organizationId, jobId) {
  const row = one(
    await client.query(
      `${SNAPSHOT_SELECT}
       where job.organization_id = $1 and job.id = $2`,
      [organizationId, jobId]
    ),
    "Custom-build progress"
  );
  return snapshotProjection(row);
}

function sameProgress(row, input) {
  return Number(row.expected_revision) === input.expectedRevision &&
    row.stage === input.stage &&
    row.structure_milestone === input.milestones.structure &&
    row.content_milestone === input.milestones.content &&
    row.responsive_milestone === input.milestones.responsive &&
    row.quality_milestone === input.milestones.quality &&
    row.customer_summary === input.customerSummary &&
    row.next_step === input.nextStep;
}

function sameRequest(row, input) {
  return Number(row.expected_progress_revision) ===
      input.expectedProgressRevision &&
    row.request_kind === input.requestKind &&
    row.title === input.title &&
    row.customer_message === input.customerMessage &&
    row.safe_instructions === input.safeInstructions &&
    row.target_date_impact === input.targetDateImpact &&
    (input.access === null || (
      row.provider_label === input.access.providerLabel &&
      row.account_label === input.access.accountLabel &&
      row.delegated_role === input.access.delegatedRole &&
      storedIso(row.access_expires_at, "access expiration") ===
        input.access.expiresAt
    ));
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "CUSTOM_BUILD_PROGRESS_ACCESS_REQUIRED",
      "Custom-build project tools are unavailable for this account.",
      { status: 403 }
    );
  }
  if (CONFLICT_CODES.has(error?.code)) {
    return new HostedError(
      "CUSTOM_BUILD_PROGRESS_CHANGED",
      "This Custom-build project changed. Refresh before trying again.",
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

function held() {
  throw new HostedError(
    "CUSTOM_BUILD_PROGRESS_HELD",
    "Custom-build progress tools are held in this runtime.",
    { status: 503 }
  );
}

export function createHeldCustomServicesCustomBuildProgress() {
  return Object.freeze({
    async readiness() {
      return deepFreeze({ schema: READINESS_SCHEMA, ready: false, state: "held" });
    },
    async readCustomerProgress(value) {
      customerScope(value);
      return held();
    },
    async readOwnerProgress(actor, jobId, organizationId) {
      actorId(actor);
      uuid(jobId, "jobId");
      uuid(organizationId, "organizationId");
      return held();
    },
    async recordProgress(actor, jobId, value) {
      actorId(actor);
      uuid(jobId, "jobId");
      progressInput(value);
      return held();
    },
    async openRequest(actor, jobId, value) {
      actorId(actor);
      uuid(jobId, "jobId");
      requestInput(value);
      return held();
    },
    async respondToRequest(value, requestId, input) {
      customerScope(value);
      uuid(requestId, "requestId");
      responseInput(input);
      return held();
    },
    async resolveRequest(actor, jobId, requestId, value) {
      actorId(actor);
      uuid(jobId, "jobId");
      uuid(requestId, "requestId");
      resolutionInput(value);
      return held();
    }
  });
}

export function createPostgresCustomServicesCustomBuildProgress({ authority } = {}) {
  const database = validateAuthority(authority);

  return Object.freeze({
    async readiness() {
      return translated(() => database.service(
        { readOnly: true },
        async (client) => {
          const row = one(
            await client.query(
              `select ss.hosted_runtime_contract_v43() as runtime_contract`
            ),
            "Custom-build progress runtime contract"
          );
          invariant(
            row.runtime_contract === RUNTIME_CONTRACT,
            "CUSTOM_BUILD_PROGRESS_HELD",
            "Custom-build progress storage is not ready.",
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

    async readCustomerProgress(value) {
      const scope = customerScope(value);
      return translated(() => database.service(
        {
          actorKind: "customer",
          userId: scope.customerId,
          organizationId: scope.organizationId,
          readOnly: true
        },
        async (client) => {
          const selected = rows(
            await client.query(
              `${SNAPSHOT_SELECT}
               where job.organization_id = $1
                 and job.project_id = $2
                 and job.customer_user_id = $3
                 and job.state = 'open'
               order by job.opened_at desc, job.id desc
               limit 1`,
              [scope.organizationId, scope.projectId, scope.customerId]
            ),
            "customer Custom-build progress",
            1
          );
          if (selected.length === 0) {
            return deepFreeze({
              schema: CUSTOM_BUILD_PROGRESS_SCHEMA,
              state: "not_available",
              jobId: null,
              targetCompletionDate: null,
              targetDateUnderReview: false,
              status: null,
              progress: null,
              activeRequest: null
            });
          }
          return snapshotProjection(selected[0]);
        }
      ));
    },

    async readOwnerProgress(actor, jobIdInput, organizationIdInput) {
      const operatorUserId = actorId(actor);
      const jobId = uuid(jobIdInput, "jobId");
      const organizationId = uuid(organizationIdInput, "organizationId");
      return translated(() => database.service(
        {
          actorKind: "operator",
          userId: operatorUserId,
          organizationId,
          readOnly: true
        },
        async (client) => {
          await requireOperator(client, operatorUserId);
          return readOwnerSnapshot(client, organizationId, jobId);
        }
      ));
    },

    async recordProgress(actor, jobIdInput, value) {
      const operatorUserId = actorId(actor);
      const jobId = uuid(jobIdInput, "jobId");
      const input = progressInput(value);
      return translated(() => database.service(
        {
          actorKind: "operator",
          userId: operatorUserId,
          organizationId: input.organizationId
        },
        async (client) => {
          await requireOperator(client, operatorUserId);
          const job = await jobContext(client, input.organizationId, jobId);
          const replay = one(
            await client.query(
              `select *
               from ss.service_custom_build_progress_updates
               where organization_id = $1
                 and job_id = $2
                 and created_by_operator_user_id = $3
                 and command_id = $4`,
              [input.organizationId, jobId, operatorUserId, input.commandId]
            ),
            "Custom-build progress replay",
            { optional: true }
          );
          if (replay !== null) {
            invariant(
              sameProgress(replay, input),
              "CUSTOM_BUILD_PROGRESS_CHANGED",
              "That command ID already belongs to another progress update.",
              { status: 409 }
            );
            return readOwnerSnapshot(client, input.organizationId, jobId);
          }
          await client.query(
            `insert into ss.service_custom_build_progress_updates (
               organization_id,
               project_id,
               case_id,
               customer_user_id,
               job_id,
               expected_revision,
               revision,
               stage,
               structure_milestone,
               content_milestone,
               responsive_milestone,
               quality_milestone,
               customer_summary,
               next_step,
               created_by_operator_user_id,
               command_id,
               request_digest,
               recorded_at
             ) values (
               $1, $2, $3, $4, $5, $6::bigint, $6::bigint + 1, $7,
               $8, $9, $10, $11, $12, $13, $14, $15,
               repeat('0', 64)::ss.sha256_hex, clock_timestamp()
             )`,
            [
              input.organizationId,
              job.project_id,
              job.case_id,
              job.customer_user_id,
              jobId,
              input.expectedRevision,
              input.stage,
              input.milestones.structure,
              input.milestones.content,
              input.milestones.responsive,
              input.milestones.quality,
              input.customerSummary,
              input.nextStep,
              operatorUserId,
              input.commandId
            ]
          );
          return readOwnerSnapshot(client, input.organizationId, jobId);
        }
      ));
    },

    async openRequest(actor, jobIdInput, value) {
      const operatorUserId = actorId(actor);
      const jobId = uuid(jobIdInput, "jobId");
      const input = requestInput(value);
      return translated(() => database.service(
        {
          actorKind: "operator",
          userId: operatorUserId,
          organizationId: input.organizationId
        },
        async (client) => {
          await requireOperator(client, operatorUserId);
          const job = await jobContext(client, input.organizationId, jobId);
          const replay = one(
            await client.query(
              `select request.*, access.provider_label, access.account_label,
                      access.delegated_role, access.expires_at as access_expires_at
               from ss.service_custom_build_work_requests request
               left join ss.service_access_requests access
                 on access.organization_id = request.organization_id
                and access.job_id = request.job_id
                and access.id = request.access_request_id
               where request.organization_id = $1
                 and request.job_id = $2
                 and request.created_by_operator_user_id = $3
                 and request.create_command_id = $4`,
              [input.organizationId, jobId, operatorUserId, input.commandId]
            ),
            "Custom-build request replay",
            { optional: true }
          );
          if (replay !== null) {
            invariant(
              sameRequest(replay, input),
              "CUSTOM_BUILD_PROGRESS_CHANGED",
              "That command ID already belongs to another work request.",
              { status: 409 }
            );
            return readOwnerSnapshot(client, input.organizationId, jobId);
          }

          let accessRequestId = null;
          if (input.access !== null) {
            const access = one(
              await client.query(
                `insert into ss.service_access_requests (
                   organization_id,
                   project_id,
                   case_id,
                   customer_user_id,
                   requested_by_operator_user_id,
                   provider_label,
                   account_label,
                   delegated_role,
                   reason_code,
                   state,
                   expires_at,
                   job_id
                 ) values (
                   $1, $2, $3, $4, $5, $6, $7, $8,
                   'custom_build_execution', 'sent', $9, $10
                 ) returning id`,
                [
                  input.organizationId,
                  job.project_id,
                  job.case_id,
                  job.customer_user_id,
                  operatorUserId,
                  input.access.providerLabel,
                  input.access.accountLabel,
                  input.access.delegatedRole,
                  input.access.expiresAt,
                  jobId
                ]
              ),
              "Custom-build access request"
            );
            accessRequestId = uuidStored(access.id, "access request ID");
          }

          await client.query(
            `insert into ss.service_custom_build_work_requests (
               organization_id,
               project_id,
               case_id,
               customer_user_id,
               job_id,
               access_request_id,
               request_kind,
               title,
               customer_message,
               safe_instructions,
               target_date_impact,
               expected_progress_revision,
               created_by_operator_user_id,
               create_command_id,
               create_digest
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, repeat('0', 64)::ss.sha256_hex
             )`,
            [
              input.organizationId,
              job.project_id,
              job.case_id,
              job.customer_user_id,
              jobId,
              accessRequestId,
              input.requestKind,
              input.title,
              input.customerMessage,
              input.safeInstructions,
              input.targetDateImpact,
              input.expectedProgressRevision,
              operatorUserId,
              input.commandId
            ]
          );
          return readOwnerSnapshot(client, input.organizationId, jobId);
        }
      ));
    },

    async respondToRequest(value, requestIdInput, inputValue) {
      const scope = customerScope(value);
      const requestId = uuid(requestIdInput, "requestId");
      const input = responseInput(inputValue);
      return translated(() => database.service(
        {
          actorKind: "customer",
          userId: scope.customerId,
          organizationId: scope.organizationId
        },
        async (client) => {
          const replay = one(
            await client.query(
              `select request.job_id, request.response_kind,
                      request.response_note
               from ss.service_custom_build_work_requests request
               where request.organization_id = $1
                 and request.project_id = $2
                 and request.customer_user_id = $3
                 and request.response_command_id = $4
                 and request.id = $5`,
              [
                scope.organizationId,
                scope.projectId,
                scope.customerId,
                input.commandId,
                requestId
              ]
            ),
            "Custom-build response replay",
            { optional: true }
          );
          if (replay !== null) {
            invariant(
              replay.response_kind === input.responseKind &&
                replay.response_note === input.responseNote,
              "CUSTOM_BUILD_PROGRESS_CHANGED",
              "That command ID already belongs to another response.",
              { status: 409 }
            );
            return readOwnerSnapshot(
              client,
              scope.organizationId,
              replay.job_id
            );
          }
          const updated = rows(
            await client.query(
              `update ss.service_custom_build_work_requests
               set state = 'answered',
                   revision = revision + 1,
                   response_kind = $6,
                   response_note = $7,
                   response_by_customer_user_id = $3,
                   response_command_id = $8
               where organization_id = $1
                 and project_id = $2
                 and customer_user_id = $3
                 and id = $4
                 and revision = $5
                 and state = 'open'
                 and response_required
               returning job_id`,
              [
                scope.organizationId,
                scope.projectId,
                scope.customerId,
                requestId,
                input.expectedRevision,
                input.responseKind,
                input.responseNote,
                input.commandId
              ]
            ),
            "Custom-build response",
            1
          );
          invariant(
            updated.length === 1,
            "CUSTOM_BUILD_PROGRESS_CHANGED",
            "That request changed. Refresh before responding.",
            { status: 409 }
          );
          return readOwnerSnapshot(
            client,
            scope.organizationId,
            updated[0].job_id
          );
        }
      ));
    },

    async resolveRequest(actor, jobIdInput, requestIdInput, value) {
      const operatorUserId = actorId(actor);
      const jobId = uuid(jobIdInput, "jobId");
      const requestId = uuid(requestIdInput, "requestId");
      const input = resolutionInput(value);
      return translated(() => database.service(
        {
          actorKind: "operator",
          userId: operatorUserId,
          organizationId: input.organizationId
        },
        async (client) => {
          await requireOperator(client, operatorUserId);
          await jobContext(client, input.organizationId, jobId);
          const replay = one(
            await client.query(
              `select state, resolution_note
               from ss.service_custom_build_work_requests
               where organization_id = $1
                 and job_id = $2
                 and resolved_by_operator_user_id = $3
                 and resolution_command_id = $4
                 and id = $5`,
              [
                input.organizationId,
                jobId,
                operatorUserId,
                input.commandId,
                requestId
              ]
            ),
            "Custom-build resolution replay",
            { optional: true }
          );
          if (replay !== null) {
            invariant(
              replay.state === input.state &&
                replay.resolution_note === input.resolutionNote,
              "CUSTOM_BUILD_PROGRESS_CHANGED",
              "That command ID already belongs to another resolution.",
              { status: 409 }
            );
            return readOwnerSnapshot(client, input.organizationId, jobId);
          }
          const updated = rows(
            await client.query(
              `update ss.service_custom_build_work_requests
               set state = $6,
                   revision = revision + 1,
                   resolved_by_operator_user_id = $3,
                   resolution_note = $7,
                   resolution_command_id = $8
               where organization_id = $1
                 and job_id = $2
                 and id = $4
                 and revision = $5
                 and state in ('open', 'answered')
               returning id`,
              [
                input.organizationId,
                jobId,
                operatorUserId,
                requestId,
                input.expectedRevision,
                input.state,
                input.resolutionNote,
                input.commandId
              ]
            ),
            "Custom-build resolution",
            1
          );
          invariant(
            updated.length === 1,
            "CUSTOM_BUILD_PROGRESS_CHANGED",
            "That request changed. Refresh before resolving it.",
            { status: 409 }
          );
          return readOwnerSnapshot(client, input.organizationId, jobId);
        }
      ));
    }
  });
}
