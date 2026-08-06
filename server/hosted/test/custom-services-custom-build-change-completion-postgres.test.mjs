import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CUSTOM_BUILD_CHANGE_COMPLETION_SCHEMA,
  createHeldCustomServicesCustomBuildChangeCompletion,
  createPostgresCustomServicesCustomBuildChangeCompletion
} from "../custom-services-custom-build-change-completion-postgres.mjs";

const OPERATOR_ID = "10000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const CASE_ID = "40000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "50000000-0000-4000-8000-000000000001";
const JOB_ID = "60000000-0000-4000-8000-000000000001";
const CHANGE_ID = "70000000-0000-4000-8000-000000000001";
const CHANGE_TWO_ID = "70000000-0000-4000-8000-000000000002";
const EVIDENCE_ID = "80000000-0000-4000-8000-000000000001";
const EVIDENCE_TWO_ID = "80000000-0000-4000-8000-000000000002";
const DOCUMENT_ID = "90000000-0000-4000-8000-000000000001";
const COMPLETION_ID = "a0000000-0000-4000-8000-000000000001";
const COMMAND_RECORD_ID = "b0000000-0000-4000-8000-000000000001";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const DIGEST_D = "d".repeat(64);
const CAPTURED_AT = "2026-08-06T15:00:00.000Z";

function result(rows) {
  return { rows, rowCount: rows.length };
}

function customerScope() {
  return {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID
  };
}

function ownerJob(overrides = {}) {
  return {
    job_id: JOB_ID,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    case_id: CASE_ID,
    customer_user_id: CUSTOMER_ID,
    state: "open",
    target_completion_date: "2026-09-15",
    final_due_minor: "20000",
    currency: "USD",
    opened_at: "2026-08-05T12:00:00.000Z",
    ...overrides
  };
}

function changeOrder(overrides = {}) {
  return {
    id: CHANGE_ID,
    change_number: "1",
    state: "issued",
    added_scope: "Add the approved events page and matching navigation link.",
    unit_count: "2",
    unit_amount_minor: "12500",
    subtotal_minor: "25000",
    currency: "USD",
    tax_state: "automatic_tax_pending",
    payment_requirement: "due_before_changed_work",
    target_completion_date: "2026-09-20",
    quote_digest: DIGEST_A,
    disclosure_digest: DIGEST_B,
    created_by_operator_user_id: OPERATOR_ID,
    issued_at: "2026-08-06T14:00:00.000Z",
    expires_at: "2026-08-15T14:00:00.000Z",
    accepted_at: null,
    declined_at: null,
    void_reason: null,
    voided_at: null,
    issue_request_digest: "f".repeat(64),
    policy_id: "c0000000-0000-4000-8000-000000000001",
    ...overrides
  };
}

function evidence(overrides = {}) {
  return {
    id: EVIDENCE_ID,
    viewport: "desktop",
    accessible_description: "Desktop completion view of the approved homepage.",
    created_by_operator_user_id: OPERATOR_ID,
    captured_at: CAPTURED_AT,
    media_type: "image/png",
    byte_count: "45",
    content_digest: DIGEST_C,
    document_id: DOCUMENT_ID,
    object_key: "must-never-reach-a-public-projection",
    ...overrides
  };
}

function completion(overrides = {}) {
  return {
    id: COMPLETION_ID,
    progress_revision: "4",
    base_scope_digest: DIGEST_A,
    effective_change_order_digests: [DIGEST_B],
    effective_scope_digest: DIGEST_C,
    evidence_ids: [EVIDENCE_ID, EVIDENCE_TWO_ID],
    scope_check_passed: true,
    desktop_check_passed: true,
    phone_check_passed: true,
    links_check_passed: true,
    contact_actions_check_passed: true,
    accessibility_basics_check_passed: true,
    customer_summary:
      "The approved scope is complete and the documented checks passed.",
    state: "ready_for_final_payment",
    created_by_operator_user_id: OPERATOR_ID,
    package_digest: DIGEST_D,
    prepared_at: "2026-08-06T16:00:00.000Z",
    request_digest: "e".repeat(64),
    ...overrides
  };
}

function fixtures(overrides = {}) {
  return {
    customerHasJob: true,
    job: ownerJob(),
    changes: [],
    evidence: [],
    completion: null,
    ...overrides
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

function snapshotQuery(text, values, state, { authorize = true } = {}) {
  if (/service_operator_has_capability/u.test(text)) {
    return { matched: true, value: result([{ authorized: authorize }]) };
  }
  if (
    /select\s+job\.id as job_id\s+from ss\.service_custom_build_jobs job/u
      .test(text)
  ) {
    assert.deepEqual(values, [ORGANIZATION_ID, PROJECT_ID, CUSTOMER_ID]);
    return {
      matched: true,
      value: result(state.customerHasJob ? [{ job_id: JOB_ID }] : [])
    };
  }
  if (
    /job\.final_due_minor/u.test(text) &&
    /from ss\.service_custom_build_jobs job/u.test(text)
  ) {
    assert.deepEqual(values, [ORGANIZATION_ID, JOB_ID]);
    return { matched: true, value: result([state.job]) };
  }
  if (/left join ss\.service_custom_build_change_acceptances/u.test(text)) {
    assert.deepEqual(values, [ORGANIZATION_ID, JOB_ID]);
    return { matched: true, value: result(state.changes) };
  }
  if (
    /from ss\.service_custom_build_completion_evidence evidence/u.test(text) &&
    /order by evidence\.captured_at/u.test(text)
  ) {
    assert.deepEqual(values, [ORGANIZATION_ID, JOB_ID]);
    return { matched: true, value: result(state.evidence) };
  }
  if (
    /package\.progress_revision/u.test(text) &&
    /from ss\.service_custom_build_completion_packages package/u.test(text)
  ) {
    assert.deepEqual(values, [ORGANIZATION_ID, JOB_ID]);
    return {
      matched: true,
      value: result(state.completion === null ? [] : [state.completion])
    };
  }
  return { matched: false, value: null };
}

function snapshotAuthority(state, options) {
  return authority((text, values) => {
    const selected = snapshotQuery(text, values, state, options);
    if (selected.matched) return selected.value;
    throw new Error(`Unexpected query: ${text}`);
  });
}

function deeplyFrozen(value) {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) {
    return;
  }
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) deeplyFrozen(child);
}

function allKeys(value, selected = new Set()) {
  if (value === null || typeof value !== "object") return selected;
  for (const [key, child] of Object.entries(value)) {
    selected.add(key);
    allKeys(child, selected);
  }
  return selected;
}

function png(width = 1, height = 1) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ]);
  const chunk = (type, payload = Buffer.alloc(0)) => {
    const value = Buffer.alloc(12 + payload.length);
    value.writeUInt32BE(payload.length, 0);
    value.write(type, 4, 4, "ascii");
    payload.copy(value, 8);
    return value;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IEND")]);
}

function issueInput(overrides = {}) {
  return {
    addedScope: "Add the approved events page and matching navigation link.",
    commandId: "change-issue-command-1",
    expiresAt: "2026-08-15T14:00:00.000Z",
    organizationId: ORGANIZATION_ID,
    targetCompletionDate: "2026-09-20",
    unitCount: 2,
    ...overrides
  };
}

function acceptanceInput(overrides = {}) {
  return {
    acceptanceStatement:
      "accepted_exact_change_order_and_payment_requirement",
    acceptedDisclosureDigest: DIGEST_B,
    acceptedQuoteDigest: DIGEST_A,
    commandId: "change-accept-command-1",
    ...overrides
  };
}

function declineInput(overrides = {}) {
  return {
    commandId: "change-decline-command-1",
    declineStatement: "declined_exact_custom_build_change_quote",
    declinedDisclosureDigest: DIGEST_B,
    declinedQuoteDigest: DIGEST_A,
    ...overrides
  };
}

function evidenceInput(bytes = png(), overrides = {}) {
  return {
    accessibleDescription: "Desktop completion view of the approved homepage.",
    commandId: "completion-evidence-command-1",
    dataBase64: bytes.toString("base64"),
    mediaType: "image/png",
    organizationId: ORGANIZATION_ID,
    viewport: "desktop",
    ...overrides
  };
}

function completionInput(overrides = {}) {
  return {
    checks: {
      accessibilityBasics: true,
      contactActions: true,
      desktop: true,
      links: true,
      phone: true,
      scope: true
    },
    commandId: "completion-command-1",
    customerSummary:
      "The approved scope is complete and the documented checks passed.",
    evidenceIds: [EVIDENCE_ID, EVIDENCE_TWO_ID],
    organizationId: ORGANIZATION_ID,
    ...overrides
  };
}

test("held boundary validates exact inputs and fails closed", async () => {
  const held = createHeldCustomServicesCustomBuildChangeCompletion();
  assert.deepEqual(await held.readiness(), {
    schema: "sitesourcery.custom-build-change-completion-readiness/v1",
    ready: false,
    state: "held"
  });
  await assert.rejects(
    () => held.readCustomer(customerScope()),
    (error) =>
      error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_HELD" &&
      error.status === 503
  );
  await assert.rejects(
    () => held.readOwner(null, JOB_ID, ORGANIZATION_ID),
    (error) => error.code === "AUTHENTICATION_REQUIRED" && error.status === 401
  );
  await assert.rejects(
    () => held.issueChangeOrder(
      { userId: OPERATOR_ID },
      JOB_ID,
      { ...issueInput(), amountMinor: 1 }
    ),
    (error) =>
      error.code === "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT" &&
      error.status === 400
  );
  await assert.rejects(
    () => held.recordCompletion(
      { userId: OPERATOR_ID },
      JOB_ID,
      completionInput({
        checks: { ...completionInput().checks, links: false }
      })
    ),
    (error) =>
      error.code === "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT"
  );
  await assert.rejects(
    () => held.uploadEvidence(
      { userId: OPERATOR_ID },
      JOB_ID,
      evidenceInput(Buffer.from("not-an-image"))
    ),
    (error) => error.code === "invalid_input" && error.status === 400
  );
});

test("constructor rejects missing authority, time, and ID sources", () => {
  assert.throws(
    () => createPostgresCustomServicesCustomBuildChangeCompletion(),
    (error) => error.code === "RUNTIME_CONFIGURATION_ERROR"
  );
  assert.throws(
    () => createPostgresCustomServicesCustomBuildChangeCompletion({
      authority: { service() {} },
      clock: null
    }),
    (error) => error.code === "RUNTIME_CONFIGURATION_ERROR"
  );
});

test("readiness requires the exact migration-44 marker in a read-only transaction", async () => {
  const database = authority((text) => {
    assert.match(text, /hosted_runtime_contract_v44/u);
    return result([{
      runtime_contract: "canonical-ss-v44-custom-build-change-completion"
    }]);
  });
  const service = createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: database.value
  });
  const readiness = await service.readiness();
  assert.deepEqual(readiness, {
    schema: "sitesourcery.custom-build-change-completion-readiness/v1",
    ready: true,
    state: "ready",
    runtimeContract: "canonical-ss-v44-custom-build-change-completion"
  });
  assert.deepEqual(database.contexts, [{ readOnly: true }]);
  deeplyFrozen(readiness);

  const wrong = authority(() => result([{ runtime_contract: "wrong" }]));
  await assert.rejects(
    () => createPostgresCustomServicesCustomBuildChangeCompletion({
      authority: wrong.value
    }).readiness(),
    (error) =>
      error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_HELD" &&
      error.status === 503
  );
});

test("customer read returns a private not-available projection without a paid job", async () => {
  const database = snapshotAuthority(fixtures({ customerHasJob: false }));
  const service = createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: database.value
  });
  const projection = await service.readCustomer(customerScope());
  assert.deepEqual(projection, {
    schema: CUSTOM_BUILD_CHANGE_COMPLETION_SCHEMA,
    state: "not_available",
    changeOrders: { active: null, history: [] },
    completion: null
  });
  assert.deepEqual(database.contexts, [{
    actorKind: "customer",
    userId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    readOnly: true
  }]);
  deeplyFrozen(projection);
});

test("customer projection exposes active and historical commercial truth without internal IDs", async () => {
  const state = fixtures({
    changes: [
      changeOrder({
        id: CHANGE_TWO_ID,
        change_number: "1",
        state: "declined",
        declined_at: "2026-08-06T13:00:00.000Z"
      }),
      changeOrder({ change_number: "2" })
    ]
  });
  const database = snapshotAuthority(state);
  const projection = await createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: database.value
  }).readCustomer(customerScope());
  assert.equal(projection.state, "change_order_review");
  assert.equal(projection.changeOrders.active.changeOrderId, CHANGE_ID);
  assert.equal(projection.changeOrders.active.pricing.unitAmountMinor, 12500);
  assert.equal(projection.changeOrders.active.pricing.subtotalMinor, 25000);
  assert.equal(projection.changeOrders.history[0].state, "declined");
  assert.equal(projection.changeOrders.active.quoteDigest, DIGEST_A);
  assert.equal(projection.changeOrders.active.disclosureDigest, DIGEST_B);
  const keys = allKeys(projection);
  for (const forbidden of [
    "jobId",
    "organizationId",
    "projectId",
    "customerId",
    "caseId",
    "createdByOperatorUserId",
    "documentId",
    "objectKey",
    "commandId",
    "requestDigest",
    "providerId",
    "paymentIntentId"
  ]) {
    assert.equal(keys.has(forbidden), false, forbidden);
  }
  deeplyFrozen(projection);
});

test("customer completion exposes only evidence selected into the immutable package", async () => {
  const unselected = evidence({
    id: "80000000-0000-4000-8000-000000000003",
    captured_at: "2026-08-06T14:00:00.000Z"
  });
  const state = fixtures({
    changes: [changeOrder({ state: "effective" })],
    evidence: [
      evidence(),
      evidence({
        id: EVIDENCE_TWO_ID,
        viewport: "phone",
        accessible_description: "Phone completion view of the approved homepage.",
        captured_at: "2026-08-06T15:01:00.000Z"
      }),
      unselected
    ],
    completion: completion()
  });
  const projection = await createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: snapshotAuthority(state).value
  }).readCustomer(customerScope());
  assert.equal(projection.state, "ready_for_final_payment");
  assert.deepEqual(
    projection.completion.evidence.map((entry) => entry.evidenceId),
    [EVIDENCE_ID, EVIDENCE_TWO_ID]
  );
  assert.equal(
    JSON.stringify(projection).includes(unselected.id),
    false
  );
  assert.equal(allKeys(projection).has("completionId"), false);
  assert.equal(allKeys(projection).has("packageDigest"), false);
  deeplyFrozen(projection);
});

test("owner projection is capability-gated and includes exact paid-job work authority", async () => {
  const state = fixtures({
    changes: [changeOrder({ state: "effective" })],
    evidence: [
      evidence(),
      evidence({
        id: EVIDENCE_TWO_ID,
        viewport: "phone",
        accessible_description: "Phone completion view of the approved homepage."
      })
    ],
    completion: completion()
  });
  const database = snapshotAuthority(state);
  const projection = await createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: database.value
  }).readOwner({ userId: OPERATOR_ID }, JOB_ID, ORGANIZATION_ID);
  assert.deepEqual(projection.job, {
    jobId: JOB_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    customerId: CUSTOMER_ID,
    state: "open",
    targetCompletionDate: "2026-09-15",
    finalDueMinor: 20000,
    currency: "USD",
    openedAt: "2026-08-05T12:00:00.000Z"
  });
  assert.equal(projection.changeOrders.length, 1);
  assert.equal(projection.evidence.length, 2);
  assert.equal(projection.completion.completionId, COMPLETION_ID);
  assert.equal(projection.completion.packageDigest, DIGEST_D);
  assert.deepEqual(database.contexts, [{
    actorKind: "operator",
    userId: OPERATOR_ID,
    organizationId: ORGANIZATION_ID,
    readOnly: true
  }]);
  const capability = database.queries[0];
  assert.deepEqual(capability.values, [OPERATOR_ID, "service_job_manage"]);
  deeplyFrozen(projection);

  const denied = snapshotAuthority(state, { authorize: false });
  await assert.rejects(
    () => createPostgresCustomServicesCustomBuildChangeCompletion({
      authority: denied.value
    }).readOwner({ userId: OPERATOR_ID }, JOB_ID, ORGANIZATION_ID),
    (error) => error.code === "OPERATOR_ACCESS_REQUIRED" && error.status === 403
  );
});

test("customer evidence read is package-bound and verifies exact bytes", async () => {
  const bytes = png();
  const digest = createHash("sha256").update(bytes).digest("hex");
  const database = authority((text, values) => {
    assert.match(text, /evidence\.id = any\(package\.evidence_ids\)/u);
    assert.doesNotMatch(text, /object_key/u);
    assert.deepEqual(values, [
      ORGANIZATION_ID,
      PROJECT_ID,
      CUSTOMER_ID,
      EVIDENCE_ID
    ]);
    return result([{
      accessible_description:
        "Desktop completion view of the approved homepage.",
      media_type: "image/png",
      content_digest: digest,
      byte_count: bytes.byteLength,
      payload: bytes
    }]);
  });
  const service = createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: database.value
  });
  const selected = await service.readCustomerEvidence(
    customerScope(),
    EVIDENCE_ID
  );
  assert.deepEqual(selected.bytes, bytes);
  assert.equal(selected.contentDigest, digest);
  assert.equal(selected.byteCount, bytes.byteLength);
  assert.deepEqual(database.contexts, [{
    actorKind: "customer",
    userId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    readOnly: true
  }]);
  deeplyFrozen(selected);
});

test("customer evidence read fails closed on absent or corrupt package evidence", async () => {
  const absent = authority(() => result([]));
  await assert.rejects(
    () => createPostgresCustomServicesCustomBuildChangeCompletion({
      authority: absent.value
    }).readCustomerEvidence(customerScope(), EVIDENCE_ID),
    (error) =>
      error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_UNAVAILABLE" &&
      error.status === 404
  );

  const bytes = png();
  const corrupt = authority(() => result([{
    accessible_description:
      "Desktop completion view of the approved homepage.",
    media_type: "image/png",
    content_digest: DIGEST_A,
    byte_count: bytes.byteLength,
    payload: bytes
  }]));
  await assert.rejects(
    () => createPostgresCustomServicesCustomBuildChangeCompletion({
      authority: corrupt.value
    }).readCustomerEvidence(customerScope(), EVIDENCE_ID),
    (error) =>
      error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT" &&
      error.status === 500
  );
});

test("issueChangeOrder inserts only bounded owner input and trigger-derived authority", async () => {
  const state = fixtures();
  const database = authority((text, values) => {
    if (/service_operator_has_capability/u.test(text)) {
      return result([{ authorized: true }]);
    }
    if (/pg_advisory_xact_lock/u.test(text)) return result([{}]);
    if (/issue_command_id = \$4/u.test(text)) return result([]);
    if (/insert into ss\.service_custom_build_change_orders/u.test(text)) {
      state.changes.push(changeOrder({
        id: values[0],
        added_scope: values[2],
        unit_count: String(values[3]),
        target_completion_date: values[4],
        expires_at: values[6]
      }));
      return result([{ id: values[0] }]);
    }
    const selected = snapshotQuery(text, values, state);
    if (selected.matched) return selected.value;
    throw new Error(`Unexpected query: ${text}`);
  });
  const service = createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: database.value,
    randomUUID: () => CHANGE_ID
  });
  const projection = await service.issueChangeOrder(
    { userId: OPERATOR_ID },
    JOB_ID,
    issueInput()
  );
  assert.equal(projection.state, "change_order_review");
  assert.equal(projection.changeOrders[0].pricing.subtotalMinor, 25000);
  assert.deepEqual(database.contexts, [{
    actorKind: "operator",
    userId: OPERATOR_ID,
    organizationId: ORGANIZATION_ID
  }]);
  const capability = database.queries.find(({ text }) =>
    /service_operator_has_capability/u.test(text)
  );
  assert.deepEqual(capability.values, [OPERATOR_ID, "service_quote_author"]);
  const lock = database.queries.find(({ text }) =>
    /pg_advisory_xact_lock/u.test(text)
  );
  assert.deepEqual(lock.values, [`ss-custom-build-h1m:${JOB_ID}`]);
  const inserted = database.queries.find(({ text }) =>
    /insert into ss\.service_custom_build_change_orders/u.test(text)
  );
  assert.ok(inserted);
  for (const forbidden of [
    "unit_amount_minor",
    "subtotal_minor",
    "tax_state",
    "policy_id",
    "scope_boundary_digest",
    "commercial_contract_digest",
    "organization_id",
    "project_id",
    "customer_user_id",
    "state"
  ]) {
    assert.doesNotMatch(inserted.text, new RegExp(`\\b${forbidden}\\b`, "u"));
  }
  assert.deepEqual(inserted.values, [
    CHANGE_ID,
    JOB_ID,
    issueInput().addedScope,
    2,
    "2026-09-20",
    "change-issue-command-1",
    "2026-08-15T14:00:00.000Z"
  ]);
});

test("issueChangeOrder replays the same command and rejects command reuse", async () => {
  const state = fixtures({ changes: [changeOrder()] });
  const replay = {
    added_scope: issueInput().addedScope,
    unit_count: "2",
    target_completion_date: "2026-09-20",
    expires_at: "2026-08-15T14:00:00.000Z"
  };
  function selectedAuthority(prior) {
    return authority((text, values) => {
      if (/service_operator_has_capability/u.test(text)) {
        return result([{ authorized: true }]);
      }
      if (/pg_advisory_xact_lock/u.test(text)) return result([{}]);
      if (/issue_command_id = \$4/u.test(text)) return result([prior]);
      const selected = snapshotQuery(text, values, state);
      if (selected.matched) return selected.value;
      throw new Error(`Unexpected query: ${text}`);
    });
  }
  const same = selectedAuthority(replay);
  const service = createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: same.value,
    randomUUID: () => {
      throw new Error("replay must not allocate an ID");
    }
  });
  assert.equal(
    (await service.issueChangeOrder(
      { userId: OPERATOR_ID },
      JOB_ID,
      issueInput()
    )).changeOrders.length,
    1
  );
  assert.equal(
    same.queries.some(({ text }) =>
      /insert into ss\.service_custom_build_change_orders/u.test(text)
    ),
    false
  );

  const reused = selectedAuthority({ ...replay, unit_count: "3" });
  await assert.rejects(
    () => createPostgresCustomServicesCustomBuildChangeCompletion({
      authority: reused.value
    }).issueChangeOrder(
      { userId: OPERATOR_ID },
      JOB_ID,
      issueInput()
    ),
    (error) =>
      error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED" &&
      error.status === 409
  );
});

test("acceptChangeOrder binds the exact customer project and two accepted digests", async () => {
  const state = fixtures({ changes: [changeOrder()] });
  let accepted = null;
  const database = authority((text, values) => {
    if (/select change_order\.job_id/u.test(text)) {
      assert.deepEqual(values, [
        ORGANIZATION_ID,
        PROJECT_ID,
        CUSTOMER_ID,
        CHANGE_ID
      ]);
      return result([{ job_id: JOB_ID }]);
    }
    if (/pg_advisory_xact_lock/u.test(text)) return result([{}]);
    if (/from ss\.service_custom_build_change_acceptances acceptance/u.test(text) &&
        /acceptance\.command_id/u.test(text)) {
      return result(accepted === null ? [] : [accepted]);
    }
    if (/select state, quote_digest, disclosure_digest/u.test(text)) {
      return result([{
        state: "issued",
        quote_digest: DIGEST_A,
        disclosure_digest: DIGEST_B
      }]);
    }
    if (/insert into ss\.service_custom_build_change_acceptances/u.test(text)) {
      accepted = {
        change_order_id: CHANGE_ID,
        acceptance_statement: values[2],
        accepted_quote_digest: values[3],
        accepted_disclosure_digest: values[4]
      };
      state.changes[0] = changeOrder({
        state: "accepted_payment_required",
        accepted_at: CAPTURED_AT
      });
      return result([{ id: values[0] }]);
    }
    const selected = snapshotQuery(text, values, state);
    if (selected.matched) return selected.value;
    throw new Error(`Unexpected query: ${text}`);
  });
  const service = createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: database.value,
    randomUUID: () => COMMAND_RECORD_ID
  });
  const projection = await service.acceptChangeOrder(
    customerScope(),
    CHANGE_ID,
    acceptanceInput()
  );
  assert.equal(projection.state, "change_order_payment_required");
  assert.deepEqual(database.contexts, [{
    actorKind: "customer",
    userId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID
  }]);
  const inserted = database.queries.find(({ text }) =>
    /insert into ss\.service_custom_build_change_acceptances/u.test(text)
  );
  assert.deepEqual(inserted.values, [
    COMMAND_RECORD_ID,
    CHANGE_ID,
    "accepted_exact_change_order_and_payment_requirement",
    DIGEST_A,
    DIGEST_B,
    "change-accept-command-1"
  ]);
});

test("acceptChangeOrder replays safely and rejects stale quote authority", async () => {
  const state = fixtures({
    changes: [changeOrder({
      state: "accepted_payment_required",
      accepted_at: CAPTURED_AT
    })]
  });
  const database = authority((text, values) => {
    if (/select change_order\.job_id/u.test(text)) {
      return result([{ job_id: JOB_ID }]);
    }
    if (/pg_advisory_xact_lock/u.test(text)) return result([{}]);
    if (/from ss\.service_custom_build_change_acceptances acceptance/u.test(text) &&
        /acceptance\.command_id/u.test(text)) {
      return result([{
        change_order_id: CHANGE_ID,
        acceptance_statement:
          "accepted_exact_change_order_and_payment_requirement",
        accepted_quote_digest: DIGEST_A,
        accepted_disclosure_digest: DIGEST_B
      }]);
    }
    const selected = snapshotQuery(text, values, state);
    if (selected.matched) return selected.value;
    throw new Error(`Unexpected query: ${text}`);
  });
  const service = createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: database.value,
    randomUUID: () => {
      throw new Error("replay must not allocate an ID");
    }
  });
  assert.equal(
    (await service.acceptChangeOrder(
      customerScope(),
      CHANGE_ID,
      acceptanceInput()
    )).state,
    "change_order_payment_required"
  );

  const stale = authority((text) => {
    if (/select change_order\.job_id/u.test(text)) {
      return result([{ job_id: JOB_ID }]);
    }
    if (/pg_advisory_xact_lock/u.test(text)) return result([{}]);
    if (/from ss\.service_custom_build_change_acceptances acceptance/u.test(text)) {
      return result([]);
    }
    if (/select state, quote_digest, disclosure_digest/u.test(text)) {
      return result([{
        state: "issued",
        quote_digest: DIGEST_C,
        disclosure_digest: DIGEST_B
      }]);
    }
    throw new Error(`Unexpected query: ${text}`);
  });
  await assert.rejects(
    () => createPostgresCustomServicesCustomBuildChangeCompletion({
      authority: stale.value
    }).acceptChangeOrder(customerScope(), CHANGE_ID, acceptanceInput()),
    (error) =>
      error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED" &&
      error.status === 409
  );
  assert.equal(
    stale.queries.some(({ text }) =>
      /insert into ss\.service_custom_build_change_acceptances/u.test(text)
    ),
    false
  );
});

test("declineChangeOrder records both declined digests and replays without a second insert", async () => {
  const state = fixtures({ changes: [changeOrder()] });
  let declined = null;
  let allocations = 0;
  const database = authority((text, values) => {
    if (/select change_order\.job_id/u.test(text)) {
      return result([{ job_id: JOB_ID }]);
    }
    if (/pg_advisory_xact_lock/u.test(text)) return result([{}]);
    if (/from ss\.service_custom_build_change_declines decline/u.test(text) &&
        /decline\.command_id/u.test(text)) {
      return result(declined === null ? [] : [declined]);
    }
    if (/select state, quote_digest, disclosure_digest/u.test(text)) {
      return result([{
        state: "issued",
        quote_digest: DIGEST_A,
        disclosure_digest: DIGEST_B
      }]);
    }
    if (/insert into ss\.service_custom_build_change_declines/u.test(text)) {
      declined = {
        change_order_id: CHANGE_ID,
        decline_statement: values[2],
        declined_quote_digest: values[3],
        declined_disclosure_digest: values[4]
      };
      state.changes[0] = changeOrder({
        state: "declined",
        declined_at: CAPTURED_AT
      });
      return result([{ id: values[0] }]);
    }
    const selected = snapshotQuery(text, values, state);
    if (selected.matched) return selected.value;
    throw new Error(`Unexpected query: ${text}`);
  });
  const service = createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: database.value,
    randomUUID: () => {
      allocations += 1;
      return COMMAND_RECORD_ID;
    }
  });
  const first = await service.declineChangeOrder(
    customerScope(),
    CHANGE_ID,
    declineInput()
  );
  const second = await service.declineChangeOrder(
    customerScope(),
    CHANGE_ID,
    declineInput()
  );
  assert.equal(first.changeOrders.history[0].state, "declined");
  assert.equal(second.changeOrders.history[0].state, "declined");
  assert.equal(allocations, 1);
  assert.equal(
    database.queries.filter(({ text }) =>
      /insert into ss\.service_custom_build_change_declines/u.test(text)
    ).length,
    1
  );
  const inserted = database.queries.find(({ text }) =>
    /insert into ss\.service_custom_build_change_declines/u.test(text)
  );
  assert.deepEqual(inserted.values.slice(2, 5), [
    "declined_exact_custom_build_change_quote",
    DIGEST_A,
    DIGEST_B
  ]);
});

test("voidChangeOrder rejects a stale digest and preserves replay authority", async () => {
  const state = fixtures({ changes: [changeOrder()] });
  let quoteVoid = null;
  let allocations = 0;
  const database = authority((text, values) => {
    if (/service_operator_has_capability/u.test(text)) {
      return result([{ authorized: true }]);
    }
    if (/pg_advisory_xact_lock/u.test(text)) return result([{}]);
    if (/from ss\.service_custom_build_change_voids/u.test(text)) {
      return result(quoteVoid === null ? [] : [quoteVoid]);
    }
    if (/select state, quote_digest/u.test(text)) {
      return result([{ state: "issued", quote_digest: DIGEST_A }]);
    }
    if (/insert into ss\.service_custom_build_change_voids/u.test(text)) {
      quoteVoid = {
        change_order_id: CHANGE_ID,
        reason: values[4],
        voided_quote_digest: values[5]
      };
      state.changes[0] = changeOrder({
        state: "voided",
        void_reason: values[4],
        voided_at: CAPTURED_AT
      });
      return result([{ id: values[0] }]);
    }
    const selected = snapshotQuery(text, values, state);
    if (selected.matched) return selected.value;
    throw new Error(`Unexpected query: ${text}`);
  });
  const service = createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: database.value,
    randomUUID: () => {
      allocations += 1;
      return COMMAND_RECORD_ID;
    }
  });
  const input = {
    commandId: "change-void-command-1",
    expectedQuoteDigest: DIGEST_A,
    organizationId: ORGANIZATION_ID,
    reason: "The customer requested a replacement change order instead."
  };
  assert.equal(
    (await service.voidChangeOrder(
      { userId: OPERATOR_ID },
      JOB_ID,
      CHANGE_ID,
      input
    )).changeOrders[0].state,
    "voided"
  );
  await service.voidChangeOrder(
    { userId: OPERATOR_ID },
    JOB_ID,
    CHANGE_ID,
    input
  );
  assert.equal(allocations, 1);
  assert.equal(
    database.queries.filter(({ text }) =>
      /insert into ss\.service_custom_build_change_voids/u.test(text)
    ).length,
    1
  );

  const stale = authority((text) => {
    if (/service_operator_has_capability/u.test(text)) {
      return result([{ authorized: true }]);
    }
    if (/pg_advisory_xact_lock/u.test(text)) return result([{}]);
    if (/from ss\.service_custom_build_change_voids/u.test(text)) return result([]);
    if (/select state, quote_digest/u.test(text)) {
      return result([{ state: "issued", quote_digest: DIGEST_C }]);
    }
    throw new Error(`Unexpected query: ${text}`);
  });
  await assert.rejects(
    () => createPostgresCustomServicesCustomBuildChangeCompletion({
      authority: stale.value
    }).voidChangeOrder(
      { userId: OPERATOR_ID },
      JOB_ID,
      CHANGE_ID,
      input
    ),
    (error) =>
      error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED" &&
      error.status === 409
  );
});

test("uploadEvidence writes exact image bytes and identity in one locked transaction", async () => {
  const bytes = png();
  const digest = createHash("sha256").update(bytes).digest("hex");
  const state = fixtures();
  const generated = [EVIDENCE_ID, DOCUMENT_ID];
  let clockReads = 0;
  const database = authority((text, values) => {
    if (/service_operator_has_capability/u.test(text)) {
      return result([{ authorized: true }]);
    }
    if (/pg_advisory_xact_lock/u.test(text)) return result([{}]);
    if (
      /from ss\.service_custom_build_completion_evidence evidence/u.test(text) &&
      /evidence\.command_id = \$4/u.test(text)
    ) {
      return result([]);
    }
    if (
      /select organization_id, project_id, case_id, customer_user_id/u
        .test(text)
    ) {
      return result([{
        organization_id: ORGANIZATION_ID,
        project_id: PROJECT_ID,
        case_id: CASE_ID,
        customer_user_id: CUSTOMER_ID
      }]);
    }
    if (/insert into ss\.service_documents/u.test(text)) return result([]);
    if (/insert into ss\.service_document_payloads/u.test(text)) return result([]);
    if (/insert into ss\.service_custom_build_completion_evidence/u.test(text)) {
      state.evidence.push(evidence({
        id: values[0],
        viewport: values[3],
        accessible_description: values[4],
        captured_at: values[6],
        media_type: "image/png",
        byte_count: String(bytes.byteLength),
        content_digest: digest
      }));
      return result([{ id: values[0] }]);
    }
    const selected = snapshotQuery(text, values, state);
    if (selected.matched) return selected.value;
    throw new Error(`Unexpected query: ${text}`);
  });
  const service = createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: database.value,
    clock: {
      now() {
        clockReads += 1;
        return CAPTURED_AT;
      }
    },
    randomUUID: () => generated.shift()
  });
  const projection = await service.uploadEvidence(
    { userId: OPERATOR_ID },
    JOB_ID,
    evidenceInput(bytes)
  );
  assert.equal(projection.evidence[0].evidenceId, EVIDENCE_ID);
  assert.equal(projection.evidence[0].contentDigest, digest);
  assert.equal(database.contexts.length, 1);
  assert.deepEqual(database.contexts[0], {
    actorKind: "operator",
    userId: OPERATOR_ID,
    organizationId: ORGANIZATION_ID
  });
  assert.equal(clockReads, 1);
  assert.deepEqual(generated, []);
  const capabilities = database.queries
    .filter(({ text }) => /service_operator_has_capability/u.test(text))
    .map(({ values }) => values[1]);
  assert.deepEqual(capabilities, [
    "service_job_manage",
    "service_document_manage"
  ]);
  const lockIndex = database.queries.findIndex(({ text }) =>
    /pg_advisory_xact_lock/u.test(text)
  );
  const documentIndex = database.queries.findIndex(({ text }) =>
    /insert into ss\.service_documents/u.test(text)
  );
  const payloadIndex = database.queries.findIndex(({ text }) =>
    /insert into ss\.service_document_payloads/u.test(text)
  );
  const evidenceIndex = database.queries.findIndex(({ text }) =>
    /insert into ss\.service_custom_build_completion_evidence/u.test(text)
  );
  assert.ok(lockIndex >= 0 && lockIndex < documentIndex);
  assert.ok(documentIndex < payloadIndex && payloadIndex < evidenceIndex);
  const documentInsert = database.queries[documentIndex];
  assert.match(documentInsert.text, /'job_evidence'/u);
  assert.match(documentInsert.text, /'customer', 'project', 'operator'/u);
  assert.equal(
    documentInsert.values[4],
    `service-documents/${ORGANIZATION_ID}/${PROJECT_ID}/custom-build-jobs/${JOB_ID}/evidence/${DOCUMENT_ID}.png`
  );
  assert.equal(documentInsert.values[5], digest);
  assert.equal(documentInsert.values[7], bytes.byteLength);
  const payloadInsert = database.queries[payloadIndex];
  assert.deepEqual(Buffer.from(payloadInsert.values[3]), bytes);
  assert.equal(payloadInsert.values[4], CAPTURED_AT);
});

test("uploadEvidence replay is stable and conflicting bytes cannot reuse a command", async () => {
  const bytes = png();
  const digest = createHash("sha256").update(bytes).digest("hex");
  const state = fixtures({
    evidence: [evidence({
      byte_count: String(bytes.byteLength),
      content_digest: digest
    })]
  });
  function replayAuthority(prior) {
    return authority((text, values) => {
      if (/service_operator_has_capability/u.test(text)) {
        return result([{ authorized: true }]);
      }
      if (/pg_advisory_xact_lock/u.test(text)) return result([{}]);
      if (
        /from ss\.service_custom_build_completion_evidence evidence/u.test(text) &&
        /evidence\.command_id = \$4/u.test(text)
      ) {
        return result([prior]);
      }
      const selected = snapshotQuery(text, values, state);
      if (selected.matched) return selected.value;
      throw new Error(`Unexpected query: ${text}`);
    });
  }
  const prior = {
    viewport: "desktop",
    accessible_description:
      "Desktop completion view of the approved homepage.",
    media_type: "image/png",
    byte_count: bytes.byteLength,
    content_digest: digest
  };
  const same = replayAuthority(prior);
  const service = createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: same.value,
    clock: { now: () => { throw new Error("replay must not read time"); } },
    randomUUID: () => { throw new Error("replay must not allocate IDs"); }
  });
  assert.equal(
    (await service.uploadEvidence(
      { userId: OPERATOR_ID },
      JOB_ID,
      evidenceInput(bytes)
    )).evidence.length,
    1
  );
  assert.equal(
    same.queries.some(({ text }) =>
      /insert into ss\.service_documents/u.test(text)
    ),
    false
  );

  const differentBytes = png(2, 1);
  const conflict = replayAuthority(prior);
  await assert.rejects(
    () => createPostgresCustomServicesCustomBuildChangeCompletion({
      authority: conflict.value
    }).uploadEvidence(
      { userId: OPERATOR_ID },
      JOB_ID,
      evidenceInput(differentBytes)
    ),
    (error) =>
      error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED" &&
      error.status === 409
  );
});

test("recordCompletion derives the latest progress revision and leaves scope, money, and state to PostgreSQL", async () => {
  const state = fixtures({
    evidence: [
      evidence(),
      evidence({
        id: EVIDENCE_TWO_ID,
        viewport: "phone",
        accessible_description: "Phone completion view of the approved homepage."
      })
    ]
  });
  let replay = null;
  let allocations = 0;
  const database = authority((text, values) => {
    if (/service_operator_has_capability/u.test(text)) {
      return result([{ authorized: true }]);
    }
    if (/pg_advisory_xact_lock/u.test(text)) return result([{}]);
    if (
      /from ss\.service_custom_build_completion_packages/u.test(text) &&
      /command_id = \$4/u.test(text)
    ) {
      return result(replay === null ? [] : [replay]);
    }
    if (/select progress\.revision as progress_revision/u.test(text)) {
      return result([{ progress_revision: "9" }]);
    }
    if (/insert into ss\.service_custom_build_completion_packages/u.test(text)) {
      replay = {
        customer_summary: values[4],
        evidence_ids: values[3],
        scope_check_passed: true,
        desktop_check_passed: true,
        phone_check_passed: true,
        links_check_passed: true,
        contact_actions_check_passed: true,
        accessibility_basics_check_passed: true
      };
      state.completion = completion({
        id: values[0],
        progress_revision: String(values[2]),
        evidence_ids: values[3],
        customer_summary: values[4]
      });
      return result([{ id: values[0] }]);
    }
    const selected = snapshotQuery(text, values, state);
    if (selected.matched) return selected.value;
    throw new Error(`Unexpected query: ${text}`);
  });
  const service = createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: database.value,
    randomUUID: () => {
      allocations += 1;
      return COMPLETION_ID;
    }
  });
  const first = await service.recordCompletion(
    { userId: OPERATOR_ID },
    JOB_ID,
    completionInput()
  );
  const second = await service.recordCompletion(
    { userId: OPERATOR_ID },
    JOB_ID,
    completionInput()
  );
  assert.equal(first.state, "ready_for_final_payment");
  assert.equal(first.completion.progressRevision, 9);
  assert.equal(second.completion.completionId, COMPLETION_ID);
  assert.equal(allocations, 1);
  assert.equal(
    database.queries.filter(({ text }) =>
      /select progress\.revision as progress_revision/u.test(text)
    ).length,
    1
  );
  const inserts = database.queries.filter(({ text }) =>
    /insert into ss\.service_custom_build_completion_packages/u.test(text)
  );
  assert.equal(inserts.length, 1);
  for (const forbidden of [
    "base_scope_digest",
    "effective_change_order_digests",
    "effective_scope_digest",
    "package_digest",
    "state",
    "final_due_minor",
    "amount_minor",
    "tax_state"
  ]) {
    assert.doesNotMatch(inserts[0].text, new RegExp(`\\b${forbidden}\\b`, "u"));
  }
  assert.deepEqual(inserts[0].values, [
    COMPLETION_ID,
    JOB_ID,
    9,
    [EVIDENCE_ID, EVIDENCE_TWO_ID],
    completionInput().customerSummary,
    "completion-command-1"
  ]);
});

test("recordCompletion rejects missing progress and noncanonical evidence before storage authority is claimed", async () => {
  const database = authority((text) => {
    if (/service_operator_has_capability/u.test(text)) {
      return result([{ authorized: true }]);
    }
    if (/pg_advisory_xact_lock/u.test(text)) return result([{}]);
    if (/command_id = \$4/u.test(text)) return result([]);
    if (/select progress\.revision as progress_revision/u.test(text)) {
      return result([{ progress_revision: null }]);
    }
    throw new Error(`Unexpected query: ${text}`);
  });
  const service = createPostgresCustomServicesCustomBuildChangeCompletion({
    authority: database.value
  });
  await assert.rejects(
    () => service.recordCompletion(
      { userId: OPERATOR_ID },
      JOB_ID,
      completionInput()
    ),
    (error) =>
      error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED" &&
      error.status === 409
  );
  await assert.rejects(
    () => service.recordCompletion(
      { userId: OPERATOR_ID },
      JOB_ID,
      completionInput({ evidenceIds: [EVIDENCE_TWO_ID, EVIDENCE_ID] })
    ),
    (error) =>
      error.code === "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT" &&
      error.status === 400
  );
});

test("database authorization, absence, migration, and concurrency errors translate consistently", async (t) => {
  await t.test("operator access", async () => {
    const database = authority(() => {
      throw Object.assign(new Error("operator lacks capability"), {
        code: "42501"
      });
    });
    await assert.rejects(
      () => createPostgresCustomServicesCustomBuildChangeCompletion({
        authority: database.value
      }).readOwner({ userId: OPERATOR_ID }, JOB_ID, ORGANIZATION_ID),
      (error) => error.code === "OPERATOR_ACCESS_REQUIRED" && error.status === 403
    );
  });

  await t.test("private absence", async () => {
    const database = authority(() => {
      throw Object.assign(new Error("customer boundary rejected"), {
        code: "42501"
      });
    });
    await assert.rejects(
      () => createPostgresCustomServicesCustomBuildChangeCompletion({
        authority: database.value
      }).readCustomer(customerScope()),
      (error) =>
        error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_UNAVAILABLE" &&
        error.status === 404
    );
  });

  await t.test("migration held", async () => {
    const database = authority(() => {
      throw Object.assign(new Error("relation absent"), { code: "42P01" });
    });
    await assert.rejects(
      () => createPostgresCustomServicesCustomBuildChangeCompletion({
        authority: database.value
      }).readCustomer(customerScope()),
      (error) =>
        error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_HELD" &&
        error.status === 503
    );
  });

  await t.test("refreshable conflict", async () => {
    const database = authority(() => {
      throw Object.assign(new Error("serialization failure"), {
        code: "40001"
      });
    });
    await assert.rejects(
      () => createPostgresCustomServicesCustomBuildChangeCompletion({
        authority: database.value
      }).readCustomer(customerScope()),
      (error) =>
        error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED" &&
        error.status === 409
    );
  });
});

test("malformed stored commercial authority fails as a storage conflict", async () => {
  const database = snapshotAuthority(fixtures({
    changes: [changeOrder({ unit_amount_minor: "1" })]
  }));
  await assert.rejects(
    () => createPostgresCustomServicesCustomBuildChangeCompletion({
      authority: database.value
    }).readCustomer(customerScope()),
    (error) =>
      error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_REPOSITORY_CONFLICT" &&
      error.status === 500
  );
});
