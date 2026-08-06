import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import * as customBuildWorkModule from
  "../custom-services-custom-build-work-postgres.mjs";

const require = createRequire(import.meta.url);
const { verifiedOwnerCustomBuildJobs } = require(
  "../../../abracadabra/app/abracadabra-customer-control-dom.js"
);

const {
  CUSTOM_BUILD_OWNER_JOBS_SCHEMA,
  createHeldCustomServicesCustomBuildWork,
  createPostgresCustomServicesCustomBuildWork
} = customBuildWorkModule;

const RUNTIME_CONTRACT =
  "canonical-ss-v42-custom-build-start-payment";
const OPERATOR_ID = "10000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const CASE_ID = "40000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "50000000-0000-4000-8000-000000000001";
const JOB_ID = "60000000-0000-4000-8000-000000000001";

function queryResult(rows) {
  return { rows, rowCount: rows.length };
}

function postgresError(code) {
  return Object.assign(new Error(`PostgreSQL ${code}`), { code });
}

function jobRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    organization_name: "Avery Studio",
    project_id: PROJECT_ID,
    project_name: "Avery Studio website",
    case_id: CASE_ID,
    customer_user_id: CUSTOMER_ID,
    customer_name: "Avery Morgan",
    customer_email: "avery@example.com",
    job_id: JOB_ID,
    state: "open",
    opened_at: "2026-08-06 14:30:00+00",
    tier_id: "site-plus",
    scope_statement:
      "Craft the approved website scope and prepare it for final handoff.",
    crafted_pages: 7,
    sections: 28,
    unique_layouts: 7,
    content_words: 3000,
    supplied_media: 24,
    target_completion_date: "2026-09-15",
    start_gross_minor: "90000",
    start_credit_minor: "20000",
    start_paid_subtotal_minor: "70000",
    final_due_minor: "90000",
    final_payment_state: "unpaid",
    currency: "USD",
    linkage_valid: true,
    invoice_id: "70000000-0000-4000-8000-000000000001",
    payment_receipt_id: "80000000-0000-4000-8000-000000000001",
    policy_id: "90000000-0000-4000-8000-000000000001",
    accepted_quote_digest: "a".repeat(64),
    accepted_disclosure_digest: "b".repeat(64),
    scope_boundary_digest: "c".repeat(64),
    provider: "stripe",
    checkout_session_id: "cs_private_custom_build_1",
    payment_intent_id: "pi_private_custom_build_1",
    stripe_customer_id: "cus_private_custom_build_1",
    ...overrides
  };
}

function harness({
  contract = RUNTIME_CONTRACT,
  authorized = true,
  jobs = [jobRow()],
  capabilityError = null,
  jobsError = null
} = {}) {
  const contexts = [];
  const queries = [];
  const authority = {
    async service(context, work) {
      contexts.push(structuredClone(context));
      return work({
        async query(text, values) {
          queries.push({ text, values });
          if (/hosted_runtime_contract_v42/u.test(text)) {
            return queryResult([{ runtime_contract: contract }]);
          }
          if (/service_operator_has_capability/u.test(text)) {
            if (capabilityError) throw capabilityError;
            return queryResult([{ authorized }]);
          }
          if (/from ss\.service_custom_build_jobs job/u.test(text)) {
            if (jobsError) throw jobsError;
            return queryResult(jobs);
          }
          throw new Error(`Unexpected query: ${text}`);
        }
      });
    }
  };
  return {
    boundary: createPostgresCustomServicesCustomBuildWork({ authority }),
    contexts,
    queries
  };
}

function assertDeeplyFrozen(value) {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeeplyFrozen(child);
}

test("owner-only held boundary reports held and fails closed", async () => {
  const held = createHeldCustomServicesCustomBuildWork();

  assert.deepEqual(Object.keys(held).sort(), ["listJobs", "readiness"]);
  assert.equal(
    "CUSTOM_BUILD_CUSTOMER_JOB_SCHEMA" in customBuildWorkModule,
    false
  );
  assert.equal("readCustomerJob" in held, false);

  const readiness = await held.readiness();
  assert.deepEqual(readiness, {
    schema: "sitesourcery.custom-build-work-readiness/v1",
    ready: false,
    state: "held"
  });
  assertDeeplyFrozen(readiness);

  await assert.rejects(
    () => held.listJobs({ userId: OPERATOR_ID }),
    (error) =>
      error.code === "CUSTOM_BUILD_WORK_HELD" && error.status === 503
  );
  await assert.rejects(
    () => held.listJobs(null),
    (error) =>
      error.code === "AUTHENTICATION_REQUIRED" && error.status === 401
  );
});

test("PostgreSQL readiness verifies the exact migration-42 contract read-only", async () => {
  const context = harness();

  const readiness = await context.boundary.readiness();

  assert.deepEqual(readiness, {
    schema: "sitesourcery.custom-build-work-readiness/v1",
    ready: true,
    state: "ready",
    runtimeContract: RUNTIME_CONTRACT,
    readOnly: true
  });
  assert.deepEqual(context.contexts, [{ readOnly: true }]);
  assert.equal(context.queries.length, 1);
  assert.match(
    context.queries[0].text,
    /select ss\.hosted_runtime_contract_v42\(\) as runtime_contract/u
  );
  assertDeeplyFrozen(readiness);
});

test("PostgreSQL readiness holds when the migration-42 contract is not exact", async () => {
  const context = harness({ contract: "canonical-ss-v41-custom-build-quote-credit" });

  await assert.rejects(
    () => context.boundary.readiness(),
    (error) =>
      error.code === "CUSTOM_BUILD_WORK_HELD" && error.status === 503
  );
});

test("owner jobs require an authenticated UUID and database capability", async () => {
  const context = harness({ authorized: false });

  await assert.rejects(
    () => context.boundary.listJobs({ userId: "not-a-uuid" }),
    (error) =>
      error.code === "AUTHENTICATION_REQUIRED" && error.status === 401
  );
  assert.equal(context.contexts.length, 0);

  await assert.rejects(
    () => context.boundary.listJobs({ userId: OPERATOR_ID }),
    (error) =>
      error.code === "OPERATOR_ACCESS_REQUIRED" && error.status === 403
  );
  assert.deepEqual(context.contexts, [
    { userId: OPERATOR_ID, readOnly: true }
  ]);
  assert.equal(context.queries.length, 1);
  assert.match(
    context.queries[0].text,
    /service_operator_has_capability/u
  );
  assert.deepEqual(context.queries[0].values, [
    OPERATOR_ID,
    "service_job_manage"
  ]);
});

test("owner jobs expose the exact safe projection in target/open order", async () => {
  const context = harness();

  const projection = await context.boundary.listJobs({ userId: OPERATOR_ID });

  assert.deepEqual(projection, {
    schema: CUSTOM_BUILD_OWNER_JOBS_SCHEMA,
    hasMore: false,
    nextCursor: null,
    jobs: [
      {
        organizationId: ORGANIZATION_ID,
        organizationName: "Avery Studio",
        projectId: PROJECT_ID,
        projectName: "Avery Studio website",
        caseId: CASE_ID,
        customer: {
          customerId: CUSTOMER_ID,
          name: "Avery Morgan",
          email: "avery@example.com"
        },
        job: {
          jobId: JOB_ID,
          state: "open",
          openedAt: "2026-08-06T14:30:00.000Z",
          tierId: "site-plus",
          scopeStatement:
            "Craft the approved website scope and prepare it for final handoff.",
          footprint: {
            craftedPages: 7,
            sections: 28,
            uniqueLayouts: 7,
            contentWords: 3000,
            suppliedMedia: 24
          },
          targetCompletionDate: "2026-09-15",
          firstPayment: {
            grossMinor: 90000,
            creditMinor: 20000,
            paidSubtotalMinor: 70000,
            currency: "USD"
          },
          finalHandoff: {
            amountMinor: 90000,
            currency: "USD",
            state: "unpaid"
          }
        }
      }
    ]
  });
  assert.deepEqual(context.contexts, [
    { userId: OPERATOR_ID, readOnly: true }
  ]);
  assert.equal(context.queries.length, 2);
  assert.equal(
    context.queries.every(({ text }) => /^\s*select\b/u.test(text)),
    true
  );

  const jobsQuery = context.queries[1].text;
  assert.match(jobsQuery, /from ss\.service_custom_build_jobs job/u);
  assert.match(jobsQuery, /join ss\.organizations organization/u);
  assert.match(jobsQuery, /join ss\.service_custom_build_invoices invoice/u);
  assert.match(
    jobsQuery,
    /join ss\.service_custom_build_payment_receipts receipt/u
  );
  assert.match(
    jobsQuery,
    /join ss\.service_custom_build_quote_revisions revision/u
  );
  assert.match(jobsQuery, /job\.payment_receipt_id = receipt\.id/u);
  assert.match(jobsQuery, /job\.start_gross_minor = invoice\.gross_start_minor/u);
  assert.match(jobsQuery, /join ss\.projects project/u);
  assert.match(jobsQuery, /join auth\.users account_user/u);
  assert.match(jobsQuery, /join ss\.hosted_account_profiles account_profile/u);
  assert.match(
    jobsQuery,
    /order by[\s\S]*job\.target_completion_date asc,[\s\S]*job\.opened_at asc,[\s\S]*job\.id asc/u
  );
  assert.match(
    jobsQuery,
    /revision\.quote_revision = job\.quote_revision/u
  );
  assert.match(jobsQuery, /job\.id asc[\s\S]*limit 101/u);
  assert.match(jobsQuery, /limit 101/u);
  assert.deepEqual(context.queries[1].values, [null, null, null]);

  const serialized = JSON.stringify(projection);
  for (const forbidden of [
    "invoice_id",
    "payment_receipt_id",
    "policy_id",
    "accepted_quote_digest",
    "accepted_disclosure_digest",
    "scope_boundary_digest",
    "stripe",
    "cs_private_custom_build_1",
    "pi_private_custom_build_1",
    "cus_private_custom_build_1"
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(verifiedOwnerCustomBuildJobs(projection), projection);
  assertDeeplyFrozen(projection);
});

test("owner job list returns one frozen empty schema projection", async () => {
  const context = harness({ jobs: [] });

  const projection = await context.boundary.listJobs({ userId: OPERATOR_ID });

  assert.deepEqual(projection, {
    schema: CUSTOM_BUILD_OWNER_JOBS_SCHEMA,
    hasMore: false,
    nextCursor: null,
    jobs: []
  });
  assertDeeplyFrozen(projection);
});

test("owner projection rejects invalid migration-42 row invariants", async (t) => {
  const cases = [
    ["state", { state: "delivered" }],
    ["tier", { tier_id: "enterprise" }],
    ["currency", { currency: "EUR" }],
    ["linkage", { linkage_valid: false }],
    ["opened time", { opened_at: "not-a-time" }],
    ["target date", { target_completion_date: "2026-02-30" }],
    ["integer", { crafted_pages: "1.5" }],
    ["first payment", { start_paid_subtotal_minor: "64000" }],
    ["final handoff", { final_due_minor: "0", final_payment_state: "unpaid" }]
  ];

  for (const [name, override] of cases) {
    await t.test(name, async () => {
      const context = harness({ jobs: [jobRow(override)] });
      await assert.rejects(
        () => context.boundary.listJobs({ userId: OPERATOR_ID }),
        (error) =>
          error.code === "CUSTOM_BUILD_WORK_REPOSITORY_CONFLICT" &&
          error.status === 500
      );
    });
  }
});

test("PostgreSQL authorization and consistency errors are translated", async () => {
  const denied = harness({ capabilityError: postgresError("42501") });
  await assert.rejects(
    () => denied.boundary.listJobs({ userId: OPERATOR_ID }),
    (error) =>
      error.code === "OPERATOR_ACCESS_REQUIRED" && error.status === 403
  );

  const changed = harness({ jobsError: postgresError("23514") });
  await assert.rejects(
    () => changed.boundary.listJobs({ userId: OPERATOR_ID }),
    (error) =>
      error.code === "CUSTOM_BUILD_WORK_CHANGED" && error.status === 409
  );

  const forbidden = harness({ jobsError: postgresError("42501") });
  await assert.rejects(
    () => forbidden.boundary.listJobs({ userId: OPERATOR_ID }),
    (error) =>
      error.code === "CUSTOM_BUILD_WORK_REPOSITORY_CONFLICT" &&
      error.status === 500
  );
});

test("owner job pagination reports a bounded first page without lying about the count", async () => {
  const context = harness({
    jobs: Array.from({ length: 101 }, (_, index) => jobRow({
      job_id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    }))
  });

  const projection = await context.boundary.listJobs({ userId: OPERATOR_ID });

  assert.equal(projection.hasMore, true);
  assert.equal(projection.jobs.length, 100);
  assert.equal(
    projection.nextCursor,
    "2026-09-15|2026-08-06T14:30:00.000Z|" +
      "60000000-0000-4000-8000-000000000100"
  );
  assert.equal(verifiedOwnerCustomBuildJobs(projection), projection);
  assertDeeplyFrozen(projection);
});

test("owner job cursor is exact and binds the stable three-column seek", async () => {
  const context = harness({ jobs: [] });
  const cursor =
    "2026-09-15|2026-08-06T14:30:00.000Z|" + JOB_ID;

  await context.boundary.listJobs({ userId: OPERATOR_ID }, cursor);

  assert.deepEqual(context.queries[1].values, [
    "2026-09-15",
    "2026-08-06T14:30:00.000Z",
    JOB_ID
  ]);
  assert.match(
    context.queries[1].text,
    /\(job\.target_completion_date, job\.opened_at, job\.id\) >/u
  );

  const rejected = harness();
  await assert.rejects(
    () => rejected.boundary.listJobs(
      { userId: OPERATOR_ID },
      "2026-09-15|not-an-iso|not-a-job"
    ),
    (error) =>
      error.code === "INVALID_CUSTOM_BUILD_WORK_CURSOR" &&
      error.status === 400
  );
  assert.equal(rejected.contexts.length, 0);
});
