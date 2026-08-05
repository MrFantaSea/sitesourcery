import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresCustomServicesAccountRepository
} from "../custom-services-account-postgres.mjs";
import {
  CUSTOM_SERVICES_FOUNDATION_SNAPSHOT_SCHEMA
} from "../custom-services-account.mjs";

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const CASE_ID =
  "40000000-0000-4000-8000-000000000001";
const OTHER_ID =
  "50000000-0000-4000-8000-000000000001";

const PROFILE_CREATED_AT = "2026-08-05T12:00:00.000Z";
const PROFILE_UPDATED_AT = "2026-08-05T12:01:00.000Z";
const CASE_CREATED_AT = "2026-08-05T12:02:00.000Z";
const CASE_SUBMITTED_AT = "2026-08-05T12:03:00.000Z";
const OFFERING_REQUESTED_AT = "2026-08-05T12:04:00.000Z";
const INTAKE_SUBMITTED_AT = "2026-08-05T12:05:00.000Z";

function result(selected = []) {
  const rows = structuredClone(selected);
  return { rows, rowCount: rows.length };
}

function input(overrides = {}) {
  return {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    ...overrides
  };
}

function accountRow(overrides = {}) {
  return {
    runtime_contract:
      "canonical-ss-v34-custom-services-foundation",
    customer_user_id: CUSTOMER_ID,
    email: "avery@example.test",
    display_name: "Avery Customer",
    account_state: "active",
    organization_id: ORGANIZATION_ID,
    membership_state: "active",
    organization_display_name: "Avery Studio",
    project_id: PROJECT_ID,
    project_state: "active",
    ...overrides
  };
}

function policyRow(overrides = {}) {
  return {
    catalog_version: "SS-PROFESSIONAL-2026.1",
    service_key: "website_assessment_standard",
    legal_version: "SS-CUSTOM-SERVICES-2026-08-05.1",
    publication_state: "held",
    ...overrides
  };
}

function profileRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    customer_user_id: CUSTOMER_ID,
    origin: "external",
    observed_hostname: "avery.example.com",
    observed_at: new Date(PROFILE_UPDATED_AT),
    platform_family: "unknown",
    ownership_state: "customer_stated",
    takeover_required: true,
    takeover_state: "review_required",
    supportability_state: "not_reviewed",
    delegated_access_state: "not_requested",
    revision: "1",
    created_at: new Date(PROFILE_CREATED_AT),
    updated_at: new Date(PROFILE_UPDATED_AT),
    ...overrides
  };
}

function caseRow(overrides = {}) {
  return {
    id: CASE_ID,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    customer_user_id: CUSTOMER_ID,
    created_by_user_id: CUSTOMER_ID,
    source: "account",
    state: "draft",
    title: "Bounded website assessment",
    withdrawn_at: null,
    revision: "1",
    created_at: new Date(CASE_CREATED_AT),
    updated_at: new Date(CASE_CREATED_AT),
    ...overrides
  };
}

function submittedCaseRow(overrides = {}) {
  return caseRow({
    state: "submitted",
    revision: "2",
    updated_at: new Date(CASE_SUBMITTED_AT),
    ...overrides
  });
}

function offeringRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    case_id: CASE_ID,
    customer_user_id: CUSTOMER_ID,
    requested_by_user_id: CUSTOMER_ID,
    service_key: "website_assessment_standard",
    policy_publication_state: "held",
    state: "requested",
    requested_at: new Date(OFFERING_REQUESTED_AT),
    removed_at: null,
    updated_at: new Date(OFFERING_REQUESTED_AT),
    ...overrides
  };
}

function intakeRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    case_id: CASE_ID,
    customer_user_id: CUSTOMER_ID,
    created_by_user_id: CUSTOMER_ID,
    source: "account",
    revision: "1",
    state: "submitted",
    site_display_name: "Avery Studio website",
    public_scheme: "https",
    public_hostname: "avery.example.com",
    business_name: "Avery Studio",
    primary_goal: "Make the services easier to understand.",
    customer_observation: "The phone layout feels crowded.",
    platform_family: "unknown",
    approximate_public_size: "one_to_ten",
    complexity_flags: ["commerce", "forms"],
    important_date: "2026-10-01",
    customer_ownership_affirmed: true,
    submitted_at: new Date(INTAKE_SUBMITTED_AT),
    created_at: new Date(INTAKE_SUBMITTED_AT),
    ...overrides
  };
}

function harness({
  accountRows = [accountRow()],
  policyRows = [policyRow()],
  profileRows = [],
  openCaseRows = [],
  withdrawnCaseRows = [],
  offeringRows = [],
  intakeRows = []
} = {}) {
  const calls = [];
  const serviceCalls = [];
  const client = {
    async query(text, values = []) {
      const normalized = text.replace(/\s+/gu, " ").trim();
      calls.push({
        text: normalized,
        values: structuredClone(values)
      });
      assert.match(normalized, /^select\b/iu);
      assert.doesNotMatch(
        normalized,
        /\b(insert|update|delete|truncate|alter|create|drop)\b/iu
      );
      assert.doesNotMatch(normalized, /for\s+update/iu);

      if (normalized.includes("from auth.users account_user")) {
        return result(accountRows);
      }
      if (
        normalized.includes(
          "from ss.service_catalog_policies policy"
        )
      ) {
        return result(policyRows);
      }
      if (
        normalized.includes(
          "from ss.service_project_profiles profile"
        )
      ) {
        return result(profileRows);
      }
      if (
        normalized.includes("from ss.service_cases service_case") &&
        normalized.includes("state <> 'withdrawn'")
      ) {
        return result(openCaseRows);
      }
      if (
        normalized.includes("from ss.service_cases service_case") &&
        normalized.includes("state = 'withdrawn'")
      ) {
        return result(withdrawnCaseRows);
      }
      if (
        normalized.includes(
          "from ss.service_case_offerings offering"
        )
      ) {
        return result(offeringRows);
      }
      if (
        normalized.includes("from ss.service_intakes intake")
      ) {
        return result(intakeRows);
      }
      assert.fail(`Unexpected SQL: ${normalized}`);
    }
  };
  return {
    calls,
    serviceCalls,
    repository: createPostgresCustomServicesAccountRepository({
      authority: {
        async service(context, work) {
          serviceCalls.push(structuredClone(context));
          return work(client);
        }
      }
    })
  };
}

function assertError(error, code, status) {
  return error?.code === code && error?.status === status;
}

function assertDeeplyFrozen(value) {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    assertDeeplyFrozen(child);
  }
}

function allKeys(value, selected = []) {
  if (value === null || typeof value !== "object") return selected;
  for (const [key, child] of Object.entries(value)) {
    selected.push(key);
    allKeys(child, selected);
  }
  return selected;
}

test("PostgreSQL foundation read returns an exact frozen empty snapshot", async () => {
  const context = harness();
  const snapshot =
    await context.repository.readFoundationSnapshot(input());

  assert.deepEqual(snapshot, {
    schema: CUSTOM_SERVICES_FOUNDATION_SNAPSHOT_SCHEMA,
    runtimeContract:
      "canonical-ss-v34-custom-services-foundation",
    account: {
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      customerId: CUSTOMER_ID,
      displayName: "Avery Customer",
      email: "avery@example.test",
      organizationDisplayName: "Avery Studio",
      accountState: "active",
      membershipState: "active",
      projectState: "active"
    },
    policy: {
      catalogVersion: "SS-PROFESSIONAL-2026.1",
      serviceKey: "website_assessment_standard",
      legalVersion: "SS-CUSTOM-SERVICES-2026-08-05.1",
      publicationState: "held"
    },
    profile: null,
    serviceCase: null,
    offering: null,
    intake: null
  });
  assertDeeplyFrozen(snapshot);
});

test("PostgreSQL foundation read returns a draft without stale submitted truth", async () => {
  const context = harness({
    profileRows: [profileRow()],
    openCaseRows: [caseRow()]
  });
  const snapshot =
    await context.repository.readFoundationSnapshot(input());

  assert.equal(snapshot.profile.observedAt, PROFILE_UPDATED_AT);
  assert.equal(snapshot.profile.revision, 1);
  assert.equal(snapshot.serviceCase.state, "draft");
  assert.equal(snapshot.serviceCase.createdAt, CASE_CREATED_AT);
  assert.equal(snapshot.offering, null);
  assert.equal(snapshot.intake, null);
  assert.equal(
    context.calls.some((call) =>
      call.text.includes("state = 'withdrawn'")
    ),
    false
  );
});

test("PostgreSQL foundation read returns the latest submitted bounded intake", async () => {
  const context = harness({
    profileRows: [profileRow()],
    openCaseRows: [submittedCaseRow()],
    offeringRows: [offeringRow()],
    intakeRows: [intakeRow()]
  });
  const snapshot =
    await context.repository.readFoundationSnapshot(input());

  assert.deepEqual(snapshot.intake, {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    customerId: CUSTOMER_ID,
    caseId: CASE_ID,
    createdByCustomerId: CUSTOMER_ID,
    source: "account",
    revision: 1,
    state: "submitted",
    siteDisplayName: "Avery Studio website",
    publicScheme: "https",
    publicHostname: "avery.example.com",
    businessName: "Avery Studio",
    primaryGoal: "Make the services easier to understand.",
    customerObservation: "The phone layout feels crowded.",
    platformFamily: "unknown",
    approximatePublicSize: "one_to_ten",
    complexityFlags: ["commerce", "forms"],
    importantDate: "2026-10-01",
    customerOwnershipAffirmed: true,
    submittedAt: INTAKE_SUBMITTED_AT,
    createdAt: INTAKE_SUBMITTED_AT
  });
  assert.equal(snapshot.offering.serviceKey,
    "website_assessment_standard");
  assert.equal(snapshot.offering.policyPublicationState, "held");
  assertDeeplyFrozen(snapshot);
});

test("PostgreSQL foundation read uses one exact actor-bound read-only transaction and parameterized selects", async () => {
  const context = harness({
    profileRows: [profileRow()],
    openCaseRows: [submittedCaseRow()],
    offeringRows: [offeringRow()],
    intakeRows: [intakeRow()]
  });
  await context.repository.readFoundationSnapshot(input());

  assert.deepEqual(context.serviceCalls, [
    {
      actorKind: "customer",
      userId: CUSTOMER_ID,
      organizationId: ORGANIZATION_ID,
      readOnly: true
    }
  ]);
  assert.deepEqual(
    context.calls.map((call) => call.values),
    [
      [CUSTOMER_ID, ORGANIZATION_ID, PROJECT_ID],
      [
        "00000000-0000-4000-8000-000000000341",
        "SS-PROFESSIONAL-2026.1",
        "website_assessment_standard",
        "held",
        "SS-CUSTOM-SERVICES-2026-08-05.1",
        "9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8"
      ],
      [ORGANIZATION_ID, PROJECT_ID, CUSTOMER_ID],
      [ORGANIZATION_ID, PROJECT_ID, CUSTOMER_ID],
      [ORGANIZATION_ID, PROJECT_ID, CASE_ID, CUSTOMER_ID],
      [ORGANIZATION_ID, PROJECT_ID, CASE_ID, CUSTOMER_ID]
    ]
  );
  for (const call of context.calls.slice(2)) {
    assert.match(call.text, /customer_user_id = \$[34]/u);
  }
  for (const call of context.calls) {
    assert.equal(call.text.includes(CUSTOMER_ID), false);
    assert.equal(call.text.includes(ORGANIZATION_ID), false);
    assert.equal(call.text.includes(PROJECT_ID), false);
  }
});

test("PostgreSQL foundation read requires the exact input allowlist and customer actor", async () => {
  const context = harness();
  await assert.rejects(
    context.repository.readFoundationSnapshot({
      ...input(),
      quoteId: CASE_ID
    }),
    (error) => assertError(error, "invalid_input", 400)
  );
  await assert.rejects(
    context.repository.readFoundationSnapshot(
      input({ actorId: OTHER_ID })
    ),
    (error) => assertError(error, "project_unavailable", 404)
  );
  await assert.rejects(
    context.repository.readFoundationSnapshot(
      input({ projectId: "not-a-uuid" })
    ),
    (error) => assertError(error, "invalid_input", 400)
  );
  assert.deepEqual(context.serviceCalls, []);
  assert.deepEqual(context.calls, []);
});

test("PostgreSQL foundation adapter requires canonical transaction authority", () => {
  for (const authority of [undefined, null, {}, { service: true }]) {
    assert.throws(
      () =>
        createPostgresCustomServicesAccountRepository({ authority }),
      (error) => assertError(error, "invalid_configuration", 500)
    );
  }
});

test("missing or cross-tenant customer authority is always project unavailable", async (t) => {
  for (const [name, configuration] of [
    ["missing account", { accountRows: [] }],
    [
      "cross-bound profile",
      { profileRows: [profileRow({ customer_user_id: OTHER_ID })] }
    ],
    [
      "cross-bound case",
      {
        profileRows: [profileRow()],
        openCaseRows: [caseRow({ organization_id: OTHER_ID })]
      }
    ]
  ]) {
    await t.test(name, async () => {
      const context = harness(configuration);
      await assert.rejects(
        context.repository.readFoundationSnapshot(input()),
        (error) => assertError(error, "project_unavailable", 404)
      );
    });
  }
});

test("duplicate canonical rows fail closed instead of selecting arbitrary truth", async (t) => {
  for (const [name, configuration] of [
    ["accounts", { accountRows: [accountRow(), accountRow()] }],
    ["policies", { policyRows: [policyRow(), policyRow()] }],
    [
      "profiles",
      { profileRows: [profileRow(), profileRow()] }
    ],
    [
      "current cases",
      {
        profileRows: [profileRow()],
        openCaseRows: [caseRow(), caseRow({ id: OTHER_ID })]
      }
    ],
    [
      "offerings",
      {
        profileRows: [profileRow()],
        openCaseRows: [submittedCaseRow()],
        offeringRows: [offeringRow(), offeringRow()]
      }
    ],
    [
      "latest intake result",
      {
        profileRows: [profileRow()],
        openCaseRows: [submittedCaseRow()],
        offeringRows: [offeringRow()],
        intakeRows: [intakeRow(), intakeRow()]
      }
    ]
  ]) {
    await t.test(name, async () => {
      const context = harness(configuration);
      await assert.rejects(
        context.repository.readFoundationSnapshot(input()),
        (error) => assertError(error, "repository_conflict", 500)
      );
    });
  }
});

test("stale chronology and altered migration-34 policy truth fail closed", async (t) => {
  for (const [name, configuration] of [
    [
      "stale intake",
      {
        profileRows: [
          profileRow({
            updated_at: new Date("2026-08-05T12:06:00.000Z")
          })
        ],
        openCaseRows: [submittedCaseRow()],
        offeringRows: [offeringRow()],
        intakeRows: [intakeRow()]
      }
    ],
    [
      "runtime drift",
      {
        accountRows: [
          accountRow({ runtime_contract: "canonical-ss-v35" })
        ]
      }
    ],
    [
      "policy drift",
      {
        policyRows: [policyRow({ publication_state: "published" })]
      }
    ]
  ]) {
    await t.test(name, async () => {
      const context = harness(configuration);
      await assert.rejects(
        context.repository.readFoundationSnapshot(input()),
        (error) => assertError(error, "repository_conflict", 500)
      );
    });
  }
});

test("foundation snapshot and SQL expose no commercial, provider, operator, or credential fields", async () => {
  const context = harness({
    profileRows: [profileRow()],
    openCaseRows: [submittedCaseRow()],
    offeringRows: [offeringRow()],
    intakeRows: [intakeRow()]
  });
  const snapshot =
    await context.repository.readFoundationSnapshot(input());
  const keys = allKeys(snapshot);

  for (const forbidden of [
    "amount",
    "currency",
    "invoice",
    "money",
    "operator",
    "payment",
    "price",
    "provider",
    "quote",
    "secret",
    "stripe",
    "token"
  ]) {
    assert.equal(
      keys.some((key) => key.toLowerCase().includes(forbidden)),
      false,
      `forbidden output key: ${forbidden}`
    );
  }
  const sql = context.calls.map((call) => call.text).join(" ");
  assert.doesNotMatch(
    sql,
    /password_phc|recovery_token|session_token|stripe_|operator_profiles|operator_permissions/iu
  );
});

test("unexpected selected fields are rejected rather than leaked", async () => {
  const context = harness({
    accountRows: [
      accountRow({ password_phc: "must-never-project" })
    ]
  });
  await assert.rejects(
    context.repository.readFoundationSnapshot(input()),
    (error) => assertError(error, "repository_conflict", 500)
  );
});
