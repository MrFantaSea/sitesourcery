import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOM_SERVICES_ACCOUNT_SCHEMA,
  CUSTOM_SERVICES_FOUNDATION_SNAPSHOT_SCHEMA,
  projectCustomServicesAccount
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
const CASE_WITHDRAWN_AT = "2026-08-05T12:06:00.000Z";

function scope(overrides = {}) {
  return {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    ...overrides
  };
}

function account(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    customerId: CUSTOMER_ID,
    displayName: "Avery Customer",
    email: "avery@example.test",
    organizationDisplayName: "Avery Studio",
    accountState: "active",
    membershipState: "active",
    projectState: "active",
    ...overrides
  };
}

function profile(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    customerId: CUSTOMER_ID,
    origin: "external",
    observedHostname: "avery.example.com",
    observedAt: PROFILE_UPDATED_AT,
    platformFamily: "unknown",
    ownershipState: "customer_stated",
    takeoverRequired: true,
    takeoverState: "review_required",
    supportabilityState: "not_reviewed",
    delegatedAccessState: "not_requested",
    revision: 1,
    createdAt: PROFILE_CREATED_AT,
    updatedAt: PROFILE_UPDATED_AT,
    ...overrides
  };
}

function serviceCase(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    customerId: CUSTOMER_ID,
    caseId: CASE_ID,
    createdByCustomerId: CUSTOMER_ID,
    source: "account",
    state: "draft",
    title: "Bounded website assessment",
    withdrawnAt: null,
    revision: 1,
    createdAt: CASE_CREATED_AT,
    updatedAt: CASE_CREATED_AT,
    ...overrides
  };
}

function offering(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    customerId: CUSTOMER_ID,
    caseId: CASE_ID,
    requestedByCustomerId: CUSTOMER_ID,
    serviceKey: "website_assessment_standard",
    policyPublicationState: "held",
    state: "requested",
    requestedAt: OFFERING_REQUESTED_AT,
    removedAt: null,
    updatedAt: OFFERING_REQUESTED_AT,
    ...overrides
  };
}

function intake(overrides = {}) {
  return {
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
    createdAt: INTAKE_SUBMITTED_AT,
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    schema: CUSTOM_SERVICES_FOUNDATION_SNAPSHOT_SCHEMA,
    runtimeContract: "canonical-ss-v34-custom-services-foundation",
    account: account(),
    policy: {
      catalogVersion: "SS-PROFESSIONAL-2026.1",
      serviceKey: "website_assessment_standard",
      legalVersion: "SS-CUSTOM-SERVICES-2026-08-05.1",
      publicationState: "held"
    },
    profile: null,
    serviceCase: null,
    offering: null,
    intake: null,
    ...overrides
  };
}

function input(overrides = {}) {
  return {
    scope: scope(),
    snapshot: snapshot(),
    ...overrides
  };
}

function submittedSnapshot(overrides = {}) {
  return snapshot({
    profile: profile(),
    serviceCase: serviceCase({
      state: "submitted",
      revision: 2,
      updatedAt: CASE_SUBMITTED_AT
    }),
    offering: offering(),
    intake: intake(),
    ...overrides
  });
}

function assertError(action, code, status) {
  assert.throws(
    action,
    (error) => error?.code === code && error?.status === status
  );
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

test("empty foundation projects only an active account and held customer actions", () => {
  const projection = projectCustomServicesAccount(input());

  assert.deepEqual(projection, {
    schema: CUSTOM_SERVICES_ACCOUNT_SCHEMA,
    account: {
      displayName: "Avery Customer",
      email: "avery@example.test",
      organizationDisplayName: "Avery Studio",
      state: "active"
    },
    website: null,
    assessment: {
      state: "not_started",
      title: null,
      submittedAt: null,
      withdrawnAt: null,
      facts: null
    },
    capabilities: {
      customerRequestWrites: {
        available: false,
        state: "held",
        reason: "customer_request_capability_held",
        message: "This customer request surface is not open yet."
      }
    },
    actions: {
      saveWebsite: {
        available: false,
        reason: "customer_request_capability_held",
        message: "This customer request surface is not open yet."
      },
      submitAssessmentRequest: {
        available: false,
        reason: "assessment_draft_required",
        message: "Save a website assessment draft first."
      },
      withdrawAssessmentRequest: {
        available: false,
        reason: "assessment_request_not_submitted",
        message: "There is no current assessment request to withdraw."
      }
    }
  });
  assertDeeplyFrozen(projection);
});

test("draft foundation projects safe website state without inventing submitted facts", () => {
  const projection = projectCustomServicesAccount(
    input({
      snapshot: snapshot({
        profile: profile(),
        serviceCase: serviceCase()
      })
    })
  );

  assert.deepEqual(projection.website, {
    state: "details_required",
    displayName: null,
    publicUrl: null,
    platform: {
      key: "unknown",
      label: "I do not know"
    },
    origin: "external",
    customerOwnershipAffirmed: false,
    updatedAt: PROFILE_UPDATED_AT
  });
  assert.deepEqual(projection.assessment, {
    state: "draft",
    title: "Bounded website assessment",
    submittedAt: null,
    withdrawnAt: null,
    facts: null
  });
  for (const action of Object.values(projection.actions)) {
    assert.equal(action.available, false);
    assert.equal(
      action.reason,
      "customer_request_capability_held"
    );
  }
});

test("submitted foundation projects bounded customer-stated website and assessment facts", () => {
  const projection = projectCustomServicesAccount(
    input({ snapshot: submittedSnapshot() })
  );

  assert.deepEqual(projection.website, {
    state: "saved",
    displayName: "Avery Studio website",
    publicUrl: "https://avery.example.com/",
    platform: {
      key: "unknown",
      label: "I do not know"
    },
    origin: "external",
    customerOwnershipAffirmed: true,
    updatedAt: INTAKE_SUBMITTED_AT
  });
  assert.deepEqual(projection.assessment, {
    state: "submitted",
    title: "Bounded website assessment",
    submittedAt: INTAKE_SUBMITTED_AT,
    withdrawnAt: null,
    facts: {
      businessName: "Avery Studio",
      primaryGoal: "Make the services easier to understand.",
      customerObservation: "The phone layout feels crowded.",
      approximatePublicSize: {
        key: "one_to_ten",
        label: "1–10 public pages"
      },
      complexity: [
        { key: "commerce", label: "Ecommerce" },
        { key: "forms", label: "Forms" }
      ],
      importantDate: "2026-10-01"
    }
  });
  assert.equal(
    projection.actions.saveWebsite.reason,
    "submitted_request_locks_website"
  );
  assert.equal(
    projection.actions.submitAssessmentRequest.reason,
    "assessment_request_already_submitted"
  );
  assert.equal(
    projection.actions.withdrawAssessmentRequest.reason,
    "customer_request_capability_held"
  );
});

test("withdrawn foundation preserves safe submitted history without reopening authority", () => {
  const projection = projectCustomServicesAccount(
    input({
      snapshot: submittedSnapshot({
        serviceCase: serviceCase({
          state: "withdrawn",
          revision: 3,
          withdrawnAt: CASE_WITHDRAWN_AT,
          updatedAt: CASE_WITHDRAWN_AT
        }),
        offering: offering({
          state: "removed",
          removedAt: "2026-08-05T12:05:30.000Z",
          updatedAt: "2026-08-05T12:05:30.000Z"
        })
      })
    })
  );

  assert.equal(projection.assessment.state, "withdrawn");
  assert.equal(
    projection.assessment.withdrawnAt,
    CASE_WITHDRAWN_AT
  );
  assert.equal(projection.website.state, "saved");
  assert.equal(
    projection.actions.saveWebsite.reason,
    "customer_request_capability_held"
  );
  assert.equal(
    projection.actions.submitAssessmentRequest.reason,
    "assessment_request_withdrawn"
  );
  assert.equal(
    projection.actions.withdrawAssessmentRequest.reason,
    "assessment_request_withdrawn"
  );
  assert.equal(
    Object.values(projection.actions).some(
      (action) => action.available
    ),
    false
  );
});

test("held policy is exact and cannot be turned into a runtime capability", () => {
  const projection = projectCustomServicesAccount(
    input({
      snapshot: snapshot({
        profile: profile(),
        serviceCase: serviceCase()
      })
    })
  );
  assert.deepEqual(projection.capabilities, {
    customerRequestWrites: {
      available: false,
      state: "held",
      reason: "customer_request_capability_held",
      message: "This customer request surface is not open yet."
    }
  });

  for (const policyDrift of [
    { publicationState: "published" },
    { serviceKey: "website_assessment_expanded" },
    { catalogVersion: "SS-PROFESSIONAL-2026.2" },
    { legalVersion: "SS-CUSTOM-SERVICES-2026-08-05.2" }
  ]) {
    assertError(
      () =>
        projectCustomServicesAccount(
          input({
            snapshot: snapshot({
              policy: {
                ...snapshot().policy,
                ...policyDrift
              }
            })
          })
        ),
      "repository_conflict",
      500
    );
  }
});

test("stale and internally inconsistent foundation combinations fail closed", () => {
  const staleSnapshots = [
    submittedSnapshot({ intake: null }),
    submittedSnapshot({
      offering: offering({
        state: "removed",
        removedAt: "2026-08-05T12:04:30.000Z",
        updatedAt: "2026-08-05T12:04:30.000Z"
      })
    }),
    submittedSnapshot({
      profile: profile({
        revision: 2,
        updatedAt: "2026-08-05T12:05:30.000Z"
      })
    }),
    submittedSnapshot({
      intake: intake({ publicHostname: "other.example.com" })
    }),
    snapshot({
      profile: profile(),
      serviceCase: serviceCase(),
      offering: offering(),
      intake: intake()
    })
  ];

  for (const selected of staleSnapshots) {
    assertError(
      () =>
        projectCustomServicesAccount(
          input({ snapshot: selected })
        ),
      "repository_conflict",
      500
    );
  }
});

test("actor, tenant, project, customer, and case substitutions fail without a leak", () => {
  const crossBoundInputs = [
    input({ scope: scope({ actorId: OTHER_ID }) }),
    input({
      snapshot: snapshot({
        account: account({ organizationId: OTHER_ID })
      })
    }),
    input({
      snapshot: snapshot({
        profile: profile({ projectId: OTHER_ID }),
        serviceCase: serviceCase()
      })
    }),
    input({
      snapshot: snapshot({
        profile: profile(),
        serviceCase: serviceCase({
          createdByCustomerId: OTHER_ID
        })
      })
    }),
    input({
      snapshot: submittedSnapshot({
        intake: intake({ customerId: OTHER_ID })
      })
    }),
    input({
      snapshot: submittedSnapshot({
        offering: offering({ caseId: OTHER_ID })
      })
    })
  ];

  for (const selected of crossBoundInputs) {
    assertError(
      () => projectCustomServicesAccount(selected),
      "project_unavailable",
      404
    );
  }
});

test("malformed schemas, fields, states, dates, flags, and unsafe prose fail closed", () => {
  const extraTopLevel = input();
  extraTopLevel.browserAuthority = true;
  assertError(
    () => projectCustomServicesAccount(extraTopLevel),
    "invalid_input",
    400
  );

  const malformedSnapshots = [
    snapshot({ schema: "sitesourcery.custom-services-foundation/v0" }),
    {
      ...snapshot(),
      stripePaymentIntentId: "pi_should_never_be_accepted"
    },
    snapshot({
      profile: profile(),
      serviceCase: serviceCase({ state: "quoted" })
    }),
    submittedSnapshot({
      intake: intake({ complexityFlags: ["forms", "commerce"] })
    }),
    submittedSnapshot({
      intake: intake({ importantDate: "2026-02-30" })
    }),
    submittedSnapshot({
      intake: intake({
        primaryGoal: "Use my API key sk_live_not_customer_safe."
      })
    })
  ];

  for (const selected of malformedSnapshots) {
    assertError(
      () =>
        projectCustomServicesAccount(
          input({ snapshot: selected })
        ),
      "repository_conflict",
      500
    );
  }
});

test("customer projection contains no commercial, provider, operator, internal ID, or authority surface", () => {
  const source = input({ snapshot: submittedSnapshot() });
  const sourceBefore = structuredClone(source);
  const projection = projectCustomServicesAccount(source);
  const keys = allKeys(projection);

  assert.deepEqual(source, sourceBefore);
  for (const key of keys) {
    assert.doesNotMatch(
      key,
      /(?:quote|invoice|payment|provider|operator|authority|tenant|digest|policy|catalog|contract|customerId|organizationId|projectId|caseId|actorId)/iu
    );
  }
  const serialized = JSON.stringify(projection);
  for (const internalId of [
    ORGANIZATION_ID,
    CUSTOMER_ID,
    PROJECT_ID,
    CASE_ID
  ]) {
    assert.equal(serialized.includes(internalId), false);
  }
  for (const forbidden of [
    "stripe",
    "checkout",
    "invoice",
    "payment",
    "operator",
    "20000",
    "USD"
  ]) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
  assertDeeplyFrozen(projection);
  assert.throws(() => {
    projection.account.displayName = "Changed";
  }, TypeError);
});
