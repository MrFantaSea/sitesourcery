import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldHostedCustomServicesAccount,
  createHostedCustomServicesAccount
} from "../custom-services-account-hosted.mjs";
import {
  CUSTOM_SERVICES_FOUNDATION_SNAPSHOT_SCHEMA
} from "../custom-services-account.mjs";

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const OTHER_ID =
  "40000000-0000-4000-8000-000000000001";

function actor() {
  return { userId: CUSTOMER_ID };
}

function foundationSnapshot() {
  return {
    schema: CUSTOM_SERVICES_FOUNDATION_SNAPSHOT_SCHEMA,
    runtimeContract: "canonical-ss-v34-custom-services-foundation",
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
  };
}

function context({ scope, snapshot } = {}) {
  const calls = { repository: [], resolver: [] };
  const service = createHostedCustomServicesAccount({
    repository: {
      async readFoundationSnapshot(value) {
        calls.repository.push(structuredClone(value));
        return structuredClone(snapshot ?? foundationSnapshot());
      }
    },
    async resolveSession(value) {
      calls.resolver.push(structuredClone(value));
      return structuredClone(
        scope === undefined
          ? {
              actorId: CUSTOMER_ID,
              customerId: CUSTOMER_ID,
              tenantId: ORGANIZATION_ID,
              projectId: PROJECT_ID
            }
          : scope
      );
    }
  });
  return { calls, service };
}

function isError(code, status) {
  return (error) => error?.code === code && error?.status === status;
}

test("hosted custom-services account resolves one project and returns only the customer projection", async () => {
  const selected = context();
  const result = await selected.service.getSnapshot(actor(), PROJECT_ID);

  assert.deepEqual(result, {
    schema: "sitesourcery.custom-services-account/v1",
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
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(selected.calls.resolver, [
    { actor: actor(), projectId: PROJECT_ID }
  ]);
  assert.deepEqual(selected.calls.repository, [
    {
      actorId: CUSTOMER_ID,
      customerId: CUSTOMER_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID
    }
  ]);
});

test("hosted custom-services account authenticates and validates before repository access", async () => {
  const selected = context();
  await assert.rejects(
    selected.service.getSnapshot(null, PROJECT_ID),
    isError("AUTHENTICATION_REQUIRED", 401)
  );
  await assert.rejects(
    selected.service.getSnapshot(actor(), "not-a-project"),
    isError("INVALID_PROJECT_ID", 400)
  );
  assert.deepEqual(selected.calls.resolver, []);
  assert.deepEqual(selected.calls.repository, []);
});

test("hosted custom-services account rejects missing, foreign, and expanded resolver scope", async (t) => {
  for (const [name, scope] of [
    ["missing", null],
    [
      "foreign customer",
      {
        actorId: OTHER_ID,
        customerId: OTHER_ID,
        tenantId: ORGANIZATION_ID,
        projectId: PROJECT_ID
      }
    ],
    [
      "foreign organization",
      {
        actorId: CUSTOMER_ID,
        customerId: CUSTOMER_ID,
        tenantId: "not-a-uuid",
        projectId: PROJECT_ID
      }
    ],
    [
      "extra authority",
      {
        actorId: CUSTOMER_ID,
        customerId: CUSTOMER_ID,
        tenantId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        role: "owner"
      }
    ]
  ]) {
    await t.test(name, async () => {
      const selected = context({ scope });
      await assert.rejects(
        selected.service.getSnapshot(actor(), PROJECT_ID),
        isError("project_unavailable", 404)
      );
      assert.deepEqual(selected.calls.repository, []);
    });
  }
});

test("hosted custom-services account requires exact ports and a canonical snapshot", async () => {
  for (const options of [
    undefined,
    {},
    { repository: {} },
    { repository: { readFoundationSnapshot() {} } }
  ]) {
    assert.throws(
      () => createHostedCustomServicesAccount(options),
      isError("invalid_configuration", 500)
    );
  }

  const selected = context({
    snapshot: {
      ...foundationSnapshot(),
      providerCustomerId: "cus_forbidden"
    }
  });
  await assert.rejects(
    selected.service.getSnapshot(actor(), PROJECT_ID),
    isError("repository_conflict", 500)
  );
});

test("held custom-services account authenticates but exposes no read", async () => {
  const held = createHeldHostedCustomServicesAccount();
  await assert.rejects(
    held.getSnapshot(null, PROJECT_ID),
    isError("AUTHENTICATION_REQUIRED", 401)
  );
  await assert.rejects(
    held.getSnapshot(actor(), PROJECT_ID),
    isError("CUSTOM_SERVICES_ACCOUNT_HELD", 503)
  );
});
