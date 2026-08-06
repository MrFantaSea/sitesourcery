import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOM_BUILD_PROGRESS_SCHEMA,
  createHeldCustomServicesCustomBuildProgress,
  createPostgresCustomServicesCustomBuildProgress
} from "../custom-services-custom-build-progress-postgres.mjs";

const OPERATOR_ID = "10000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const CASE_ID = "40000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "50000000-0000-4000-8000-000000000001";
const JOB_ID = "60000000-0000-4000-8000-000000000001";
const REQUEST_ID = "70000000-0000-4000-8000-000000000001";
const ACCESS_ID = "80000000-0000-4000-8000-000000000001";

function result(rows) {
  return { rows, rowCount: rows.length };
}

function snapshotRow(overrides = {}) {
  return {
    job_id: JOB_ID,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    case_id: CASE_ID,
    customer_user_id: CUSTOMER_ID,
    job_state: "open",
    opened_at: "2026-08-06T14:30:00.000Z",
    target_completion_date: "2026-09-15",
    progress_revision: null,
    progress_stage: null,
    structure_milestone: null,
    content_milestone: null,
    responsive_milestone: null,
    quality_milestone: null,
    customer_summary: null,
    next_step: null,
    progress_recorded_at: null,
    request_id: null,
    request_kind: null,
    request_title: null,
    customer_message: null,
    safe_instructions: null,
    target_date_impact: null,
    response_required: null,
    request_state: null,
    request_revision: null,
    response_kind: null,
    response_note: null,
    answered_at: null,
    request_created_at: null,
    request_updated_at: null,
    provider_label: null,
    account_label: null,
    delegated_role: null,
    access_expires_at: null,
    ...overrides
  };
}

function customerScope() {
  return {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID
  };
}

function authority(query) {
  const contexts = [];
  const queries = [];
  return {
    contexts,
    queries,
    value: {
      async service(context, work) {
        contexts.push(structuredClone(context));
        return work({
          async query(text, values = []) {
            queries.push({ text, values: structuredClone(values) });
            return query(text, values);
          }
        });
      }
    }
  };
}

function deeplyFrozen(value) {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) deeplyFrozen(child);
}

test("held Custom-build progress validates callers and fails closed", async () => {
  const held = createHeldCustomServicesCustomBuildProgress();
  assert.deepEqual(Object.keys(held).sort(), [
    "openRequest",
    "readCustomerProgress",
    "readOwnerProgress",
    "readiness",
    "recordProgress",
    "resolveRequest",
    "respondToRequest"
  ]);
  assert.deepEqual(await held.readiness(), {
    schema: "sitesourcery.custom-build-progress-readiness/v1",
    ready: false,
    state: "held"
  });
  await assert.rejects(
    () => held.readCustomerProgress(customerScope()),
    (error) => error.code === "CUSTOM_BUILD_PROGRESS_HELD"
  );
  await assert.rejects(
    () => held.readOwnerProgress(null, JOB_ID, ORGANIZATION_ID),
    (error) => error.code === "AUTHENTICATION_REQUIRED"
  );
});

test("readiness requires the exact migration-43 marker", async () => {
  const database = authority((text) => {
    assert.match(text, /hosted_runtime_contract_v43/u);
    return result([{ runtime_contract: "canonical-ss-v43-custom-build-progress" }]);
  });
  const boundary = createPostgresCustomServicesCustomBuildProgress({
    authority: database.value
  });
  const readiness = await boundary.readiness();
  assert.deepEqual(readiness, {
    schema: "sitesourcery.custom-build-progress-readiness/v1",
    ready: true,
    state: "ready",
    runtimeContract: "canonical-ss-v43-custom-build-progress"
  });
  assert.deepEqual(database.contexts, [{ readOnly: true }]);
  deeplyFrozen(readiness);
});

test("customer reads a calm default before the first owner update", async () => {
  const database = authority((text, values) => {
    assert.match(text, /from ss\.service_custom_build_jobs job/u);
    assert.match(text, /service_custom_build_progress_updates/u);
    assert.match(text, /service_custom_build_work_requests/u);
    assert.deepEqual(values, [ORGANIZATION_ID, PROJECT_ID, CUSTOMER_ID]);
    return result([snapshotRow()]);
  });
  const boundary = createPostgresCustomServicesCustomBuildProgress({
    authority: database.value
  });
  const projection = await boundary.readCustomerProgress(customerScope());
  assert.deepEqual(projection, {
    schema: CUSTOM_BUILD_PROGRESS_SCHEMA,
    state: "active",
    jobId: JOB_ID,
    targetCompletionDate: "2026-09-15",
    targetDateUnderReview: false,
    status: { kind: "preparing", label: "Preparing" },
    progress: {
      revision: 0,
      stage: "preparing",
      stageLabel: "Preparing",
      summary: "Your paid project is prepared for its first work update.",
      nextStep: "Site Sourcery will post the next project update here.",
      updatedAt: "2026-08-06T14:30:00.000Z",
      milestones: [
        { key: "structure", label: "Plan and structure", state: "pending" },
        { key: "content", label: "Pages and content", state: "pending" },
        {
          key: "responsive",
          label: "Phone and accessibility",
          state: "pending"
        },
        { key: "quality", label: "Final checks", state: "pending" }
      ]
    },
    activeRequest: null
  });
  assert.deepEqual(database.contexts, [{
    actorKind: "customer",
    userId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    readOnly: true
  }]);
  deeplyFrozen(projection);
});

test("customer projection derives action-needed and retains only safe access labels", async () => {
  const row = snapshotRow({
    progress_revision: "2",
    progress_stage: "building",
    structure_milestone: "done",
    content_milestone: "in_progress",
    responsive_milestone: "pending",
    quality_milestone: "pending",
    customer_summary: "The approved structure is in place and pages are being built.",
    next_step: "Add the supplied page copy and images.",
    progress_recorded_at: "2026-08-07T10:00:00.000Z",
    request_id: REQUEST_ID,
    request_kind: "delegated_access",
    request_title: "Connect the existing domain",
    customer_message: "Please authorize bounded DNS access for this project.",
    safe_instructions:
      "Use the provider delegation screen. Never send a password, code, key, or token.",
    target_date_impact: "under_review",
    response_required: true,
    request_state: "open",
    request_revision: "1",
    request_created_at: "2026-08-07T10:05:00.000Z",
    request_updated_at: "2026-08-07T10:05:00.000Z",
    provider_label: "Spaceship",
    account_label: "Avery Studio domain account",
    delegated_role: "DNS manager",
    access_expires_at: "2026-08-20T10:05:00.000Z"
  });
  const database = authority(() => result([row]));
  const boundary = createPostgresCustomServicesCustomBuildProgress({
    authority: database.value
  });
  const projection = await boundary.readCustomerProgress(customerScope());
  assert.equal(projection.status.kind, "action_needed");
  assert.equal(projection.status.label, "Action needed from you");
  assert.equal(projection.targetDateUnderReview, true);
  assert.deepEqual(projection.activeRequest.access, {
    providerLabel: "Spaceship",
    accountLabel: "Avery Studio domain account",
    delegatedRole: "DNS manager",
    expiresAt: "2026-08-20T10:05:00.000Z"
  });
  const serialized = JSON.stringify(projection);
  for (const forbidden of [
    "created_by_operator_user_id",
    "create_digest",
    "response_digest",
    "access_request_id"
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("owner progress update uses exact actor scope and server-owned job facts", async () => {
  let current = snapshotRow();
  const database = authority((text, values) => {
    if (/service_operator_has_capability/u.test(text)) {
      return result([{ authorized: true }]);
    }
    if (/from ss\.service_custom_build_jobs\s+where/u.test(text)) {
      return result([{
        organization_id: ORGANIZATION_ID,
        project_id: PROJECT_ID,
        case_id: CASE_ID,
        customer_user_id: CUSTOMER_ID
      }]);
    }
    if (/select \*\s+from ss\.service_custom_build_progress_updates/u.test(text)) {
      return result([]);
    }
    if (/insert into ss\.service_custom_build_progress_updates/u.test(text)) {
      current = snapshotRow({
        progress_revision: "1",
        progress_stage: values[6],
        structure_milestone: values[7],
        content_milestone: values[8],
        responsive_milestone: values[9],
        quality_milestone: values[10],
        customer_summary: values[11],
        next_step: values[12],
        progress_recorded_at: "2026-08-07T11:00:00.000Z"
      });
      return result([]);
    }
    if (/from ss\.service_custom_build_jobs job/u.test(text)) {
      return result([current]);
    }
    throw new Error(`Unexpected query: ${text}`);
  });
  const boundary = createPostgresCustomServicesCustomBuildProgress({
    authority: database.value
  });
  const projection = await boundary.recordProgress(
    { userId: OPERATOR_ID },
    JOB_ID,
    {
      commandId: "progress-command-001",
      customerSummary: "The approved structure is ready for page construction.",
      expectedRevision: 0,
      milestones: {
        structure: "done",
        content: "in_progress",
        responsive: "pending",
        quality: "pending"
      },
      nextStep: "Build the approved pages and supplied content.",
      organizationId: ORGANIZATION_ID,
      stage: "building"
    }
  );
  assert.equal(projection.progress.revision, 1);
  assert.equal(projection.progress.stage, "building");
  assert.deepEqual(database.contexts, [{
    actorKind: "operator",
    userId: OPERATOR_ID,
    organizationId: ORGANIZATION_ID
  }]);
  const insert = database.queries.find(({ text }) =>
    /insert into ss\.service_custom_build_progress_updates/u.test(text)
  );
  assert.ok(insert);
  assert.match(insert.text, /\$6::bigint, \$6::bigint \+ 1/u);
  const jobRead = database.queries.find(({ text }) =>
    /from ss\.service_custom_build_jobs\s+where/u.test(text)
  );
  assert.ok(jobRead);
  assert.doesNotMatch(jobRead.text, /for update/iu);
  assert.deepEqual(insert.values.slice(0, 6), [
    ORGANIZATION_ID,
    PROJECT_ID,
    CASE_ID,
    CUSTOMER_ID,
    JOB_ID,
    0
  ]);
});

test("progress and response inputs reject credential collection", async () => {
  const boundary = createHeldCustomServicesCustomBuildProgress();
  await assert.rejects(
    () => boundary.recordProgress({ userId: OPERATOR_ID }, JOB_ID, {
      commandId: "progress-command-002",
      customerSummary: "Send your password so this project can continue.",
      expectedRevision: 0,
      milestones: {
        structure: "pending",
        content: "pending",
        responsive: "pending",
        quality: "pending"
      },
      nextStep: "Wait for a safe update.",
      organizationId: ORGANIZATION_ID,
      stage: "preparing"
    }),
    (error) =>
      error.code === "INVALID_CUSTOM_BUILD_PROGRESS_INPUT" &&
      error.status === 400
  );
  await assert.rejects(
    () => boundary.respondToRequest(customerScope(), REQUEST_ID, {
      commandId: "response-command-001",
      expectedRevision: 1,
      responseKind: "provided",
      responseNote: "My access token is pasted here"
    }),
    (error) => error.code === "INVALID_CUSTOM_BUILD_PROGRESS_INPUT"
  );
});

test("database conflicts become a refreshable project conflict", async () => {
  const database = authority(() => {
    throw Object.assign(new Error("stale"), { code: "40001" });
  });
  const boundary = createPostgresCustomServicesCustomBuildProgress({
    authority: database.value
  });
  await assert.rejects(
    () => boundary.readCustomerProgress(customerScope()),
    (error) =>
      error.code === "CUSTOM_BUILD_PROGRESS_CHANGED" && error.status === 409
  );
});
