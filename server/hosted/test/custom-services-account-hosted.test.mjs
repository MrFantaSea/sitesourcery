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
  const calls = {
    invoiceRead: [],
    quoteAcceptance: [],
    quoteRead: [],
    requestRead: [],
    requestSave: [],
    requestSubmit: [],
    requestWithdraw: [],
    repository: [],
    resolver: []
  };
  const service = createHostedCustomServicesAccount({
    invoiceRepository: {
      async readCurrentInvoice(value) {
        calls.invoiceRead.push(structuredClone(value));
        return {
          schema: "sitesourcery.custom-services-assessment-invoice/v1",
          state: "not_available",
          invoice: null,
          actions: {
            checkout: {
              available: false,
              reason: "accepted_quote_required",
              message: "Accept the current assessment quote before an invoice exists."
            }
          }
        };
      }
    },
    quoteRepository: {
      async acceptCurrentQuote(value) {
        calls.quoteAcceptance.push(structuredClone(value));
        return { accepted: true };
      },
      async readCurrentQuote(value) {
        calls.quoteRead.push(structuredClone(value));
        return {
          schema:
            "sitesourcery.custom-services-assessment-quote-snapshot/v1",
          observedAt: "2026-08-05T18:00:00.000Z",
          currentProfile: null,
          currentIntake: null,
          quote: null
        };
      }
    },
    requestRepository: {
      async readCurrentRequest(value) {
        calls.requestRead.push(structuredClone(value));
        return {
          schema:
            "sitesourcery.custom-services-assessment-request/v1",
          state: "not_started"
        };
      },
      async saveDraft(value) {
        calls.requestSave.push(structuredClone(value));
      },
      async submitCurrentRequest(value) {
        calls.requestSubmit.push(structuredClone(value));
      },
      async withdrawCurrentRequest(value) {
        calls.requestWithdraw.push(structuredClone(value));
      }
    },
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
  const invoiceRepository = { readCurrentInvoice() {} };
  const quoteRepository = {
    acceptCurrentQuote() {},
    readCurrentQuote() {}
  };
  const requestRepository = {
    readCurrentRequest() {},
    saveDraft() {},
    submitCurrentRequest() {},
    withdrawCurrentRequest() {}
  };
  for (const options of [
    undefined,
    {},
    { repository: {} },
    { repository: { readFoundationSnapshot() {} } },
    {
      quoteRepository,
      repository: { readFoundationSnapshot() {} }
    },
    {
      quoteRepository,
      requestRepository,
      repository: { readFoundationSnapshot() {} }
    },
    {
      invoiceRepository,
      quoteRepository,
      requestRepository,
      repository: { readFoundationSnapshot() {} }
    }
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

test("hosted custom-services invoice read stays bound to the resolved customer project", async () => {
  const selected = context();
  const result = await selected.service.getAssessmentInvoice(
    actor(),
    PROJECT_ID
  );
  assert.equal(result.state, "not_available");
  assert.deepEqual(selected.calls.invoiceRead, [
    {
      actorId: CUSTOMER_ID,
      customerId: CUSTOMER_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID
    }
  ]);
});

test("hosted custom-services quote read and acceptance stay bound to the resolved customer project", async () => {
  const selected = context();
  const quote = await selected.service.getAssessmentQuote(
    actor(),
    PROJECT_ID
  );
  assert.deepEqual(quote, {
    schema: "sitesourcery.custom-services-assessment-quote/v1",
    state: "not_available",
    quote: null,
    actions: {
      acceptQuote: {
        available: false,
        reason: "quote_not_available",
        message: "There is no assessment quote to accept yet.",
        acceptanceStatement: null
      }
    }
  });

  const acceptance = {
    acceptanceStatement: "accepted_exact_quote_and_delivery_date",
    acceptedDisclosureDigest: "b".repeat(64),
    acceptedQuoteDigest: "a".repeat(64),
    commandId: "accept-command-1",
    quoteId: "50000000-0000-4000-8000-000000000001",
    quoteRevision: 1
  };
  await selected.service.acceptAssessmentQuote(
    actor(),
    PROJECT_ID,
    acceptance
  );
  const exactScope = {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID
  };
  assert.deepEqual(selected.calls.quoteRead, [exactScope, exactScope]);
  assert.deepEqual(selected.calls.quoteAcceptance, [
    { ...exactScope, ...acceptance }
  ]);
});

test("hosted custom-services request commands return the freshly read customer state", async () => {
  const selected = context();
  const exactScope = {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID
  };
  await selected.service.getAssessmentRequest(actor(), PROJECT_ID);
  await selected.service.saveAssessmentRequest(actor(), PROJECT_ID, {
    commandId: "request-save-1",
    expectedDraftRevision: 0
  });
  await selected.service.submitAssessmentRequest(actor(), PROJECT_ID, {
    commandId: "request-submit-1",
    draftRevision: 1
  });
  await selected.service.withdrawAssessmentRequest(actor(), PROJECT_ID, {
    commandId: "request-withdraw-1"
  });
  assert.deepEqual(selected.calls.requestRead, [
    exactScope,
    exactScope,
    exactScope,
    exactScope
  ]);
  assert.deepEqual(selected.calls.requestSave, [
    {
      commandId: "request-save-1",
      expectedDraftRevision: 0,
      ...exactScope
    }
  ]);
  assert.deepEqual(selected.calls.requestSubmit, [
    {
      commandId: "request-submit-1",
      draftRevision: 1,
      ...exactScope
    }
  ]);
  assert.deepEqual(selected.calls.requestWithdraw, [
    { commandId: "request-withdraw-1", ...exactScope }
  ]);
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
  await assert.rejects(
    held.getAssessmentQuote(actor(), PROJECT_ID),
    isError("CUSTOM_SERVICES_QUOTE_HELD", 503)
  );
  await assert.rejects(
    held.getAssessmentInvoice(actor(), PROJECT_ID),
    isError("CUSTOM_SERVICES_INVOICE_HELD", 503)
  );
  await assert.rejects(
    held.acceptAssessmentQuote(actor(), PROJECT_ID, {}),
    isError("CUSTOM_SERVICES_QUOTE_HELD", 503)
  );
  await assert.rejects(
    held.getAssessmentRequest(actor(), PROJECT_ID),
    isError("CUSTOM_SERVICES_REQUEST_HELD", 503)
  );
  await assert.rejects(
    held.saveAssessmentRequest(actor(), PROJECT_ID, {}),
    isError("CUSTOM_SERVICES_REQUEST_HELD", 503)
  );
});
