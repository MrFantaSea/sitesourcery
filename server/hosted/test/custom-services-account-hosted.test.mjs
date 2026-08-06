import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createHeldHostedCustomServicesAccount,
  createHostedCustomServicesAccount
} from "../custom-services-account-hosted.mjs";
import {
  createHeldCustomServicesCustomBuildChangeCompletion
} from "../custom-services-custom-build-change-completion-postgres.mjs";
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
const EVIDENCE_ID =
  "50000000-0000-4000-8000-000000000001";

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
    assessmentEvidence: [],
    assessmentReport: [],
    checkout: [],
    customBuildCheckout: [],
    customBuildChangeAcceptance: [],
    customBuildChangeCompletionRead: [],
    customBuildChangeDecline: [],
    customBuildCompletionEvidenceRead: [],
    customBuildAcceptance: [],
    customBuildInvoiceRead: [],
    customBuildProgressRead: [],
    customBuildProgressResponse: [],
    customBuildRead: [],
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
    assessmentWork: {
      async readCustomerReport(value) {
        calls.assessmentReport.push(structuredClone(value));
        return {
          schema: "sitesourcery.custom-services-assessment-report/v1",
          state: "not_available",
          job: null,
          report: null,
          credit: null
        };
      },
      async readCustomerEvidence(value, evidenceId) {
        calls.assessmentEvidence.push({
          scope: structuredClone(value),
          evidenceId
        });
        return {
          bytes: Buffer.from("evidence"),
          mediaType: "image/png",
          contentDigest: "0".repeat(64),
          byteCount: 8,
          accessibleDescription: "Assessment evidence"
        };
      }
    },
    customBuild: {
      async acceptCurrentQuote(value) {
        calls.customBuildAcceptance.push(structuredClone(value));
        return {
          schema: "sitesourcery.custom-services-custom-build-quote/v1",
          state: "accepted",
          quote: { quoteId: value.quoteId }
        };
      },
      async readCurrentQuote(value) {
        calls.customBuildRead.push(structuredClone(value));
        return {
          schema: "sitesourcery.custom-services-custom-build-quote/v1",
          state: "not_available",
          quote: null
        };
      }
    },
    customBuildPayment: {
      async readCurrentInvoice(value) {
        calls.customBuildInvoiceRead.push(structuredClone(value));
        return {
          schema: "sitesourcery.custom-build-start-invoice/v1",
          state: "not_available",
          invoice: null
        };
      },
      async createCheckout(value) {
        calls.customBuildCheckout.push(structuredClone(value));
        return {
          schema: "sitesourcery.custom-build-start-checkout/v1",
          state: "ready"
        };
      }
    },
    customBuildProgress: {
      async readCustomerProgress(value) {
        calls.customBuildProgressRead.push(structuredClone(value));
        return {
          schema: "sitesourcery.custom-build-progress/v1",
          state: "preparing",
          revision: 0,
          activeRequest: null
        };
      },
      async respondToRequest(value, requestId, input) {
        calls.customBuildProgressResponse.push({
          scope: structuredClone(value),
          requestId,
          input: structuredClone(input)
        });
        return {
          schema: "sitesourcery.custom-build-progress/v1",
          state: "building",
          revision: 1,
          activeRequest: null
        };
      }
    },
    customBuildChangeCompletion: {
      async readCustomer(value) {
        calls.customBuildChangeCompletionRead.push(structuredClone(value));
        return {
          schema: "sitesourcery.custom-build-change-completion/v1",
          state: "building"
        };
      },
      async readCustomerEvidence(value, evidenceId) {
        calls.customBuildCompletionEvidenceRead.push({
          scope: structuredClone(value),
          evidenceId
        });
        return {
          bytes: Buffer.from("completion evidence"),
          mediaType: "image/png",
          contentDigest: "0".repeat(64),
          byteCount: 19,
          accessibleDescription: "Custom-build completion evidence"
        };
      },
      async acceptChangeOrder(value, changeOrderId, input) {
        calls.customBuildChangeAcceptance.push({
          scope: structuredClone(value),
          changeOrderId,
          input: structuredClone(input)
        });
        return { state: "accepted_payment_required" };
      },
      async declineChangeOrder(value, changeOrderId, input) {
        calls.customBuildChangeDecline.push({
          scope: structuredClone(value),
          changeOrderId,
          input: structuredClone(input)
        });
        return { state: "declined" };
      }
    },
    invoiceRepository: {
      async readCurrentInvoice(value) {
        calls.invoiceRead.push(structuredClone(value));
        return {
          schema: "sitesourcery.custom-services-assessment-invoice/v2",
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
    payment: {
      async createCheckout(value) {
        calls.checkout.push(structuredClone(value));
        return {
          schema:
            "sitesourcery.custom-services-assessment-checkout/v1",
          state: "ready"
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

test("hosted assessment report and evidence reads stay bound to the resolved customer project", async () => {
  const selected = context();
  const report = await selected.service.getAssessmentReport(
    actor(),
    PROJECT_ID
  );
  assert.equal(report.state, "not_available");
  const evidence = await selected.service.getAssessmentEvidence(
    actor(),
    PROJECT_ID,
    EVIDENCE_ID
  );
  assert.deepEqual(evidence.bytes, Buffer.from("evidence"));
  const scope = {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID
  };
  assert.deepEqual(selected.calls.assessmentReport, [scope]);
  assert.deepEqual(selected.calls.assessmentEvidence, [
    { scope, evidenceId: EVIDENCE_ID }
  ]);
});

test("hosted assessment checkout sends only resolved customer and invoice authority", async () => {
  const selected = context();
  const invoiceId =
    "60000000-0000-4000-8000-000000000001";
  const result = await selected.service.createAssessmentCheckout(
    actor(),
    PROJECT_ID,
    invoiceId,
    {
      commandId: "assessment-checkout-command-1",
      invoiceDigest: "c".repeat(64)
    }
  );
  assert.equal(result.state, "ready");
  assert.deepEqual(selected.calls.checkout, [
    {
      actorId: CUSTOMER_ID,
      customerId: CUSTOMER_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      commandId: "assessment-checkout-command-1",
      invoiceDigest: "c".repeat(64),
      invoiceId
    }
  ]);
});

test("hosted Custom build invoice and checkout send only resolved customer authority", async () => {
  const selected = context();
  const invoice = await selected.service.getCustomBuildInvoice(
    actor(),
    PROJECT_ID
  );
  assert.equal(invoice.state, "not_available");
  const invoiceId =
    "60000000-0000-4000-8000-000000000002";
  const checkout = await selected.service.createCustomBuildCheckout(
    actor(),
    PROJECT_ID,
    invoiceId,
    {
      commandId: "custom-build-checkout-command-1",
      invoiceDigest: "d".repeat(64)
    }
  );
  assert.equal(checkout.state, "ready");
  const scope = {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID
  };
  assert.deepEqual(selected.calls.customBuildInvoiceRead, [scope]);
  assert.deepEqual(selected.calls.customBuildCheckout, [
    {
      ...scope,
      commandId: "custom-build-checkout-command-1",
      invoiceDigest: "d".repeat(64),
      invoiceId
    }
  ]);
});

test("hosted Custom build progress read and response stay bound to the resolved project", async () => {
  const selected = context();
  const progress = await selected.service.getCustomBuildProgress(
    actor(),
    PROJECT_ID
  );
  assert.equal(progress.state, "preparing");

  const requestId = "60000000-0000-4000-8000-000000000003";
  const input = {
    answer: "The About page should use the second approved paragraph.",
    commandId: "custom-build-response-command-1",
    expectedRevision: 0
  };
  const responded = await selected.service.respondToCustomBuildRequest(
    actor(),
    PROJECT_ID,
    requestId,
    input
  );
  assert.equal(responded.state, "building");

  const scope = {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID
  };
  assert.deepEqual(selected.calls.customBuildProgressRead, [scope]);
  assert.deepEqual(selected.calls.customBuildProgressResponse, [
    { scope, requestId, input }
  ]);
});

test("hosted Custom-build change and completion methods expose only canonical customer scope", async () => {
  const selected = context();
  const changeOrderId =
    "60000000-0000-4000-8000-000000000001";
  const scope = {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID
  };
  const acceptance = {
    acceptanceStatement:
      "accepted_exact_change_order_and_payment_requirement",
    acceptedDisclosureDigest: "b".repeat(64),
    acceptedQuoteDigest: "a".repeat(64),
    commandId: "change-accept-command-1"
  };
  const decline = {
    commandId: "change-decline-command-1",
    declineStatement: "declined_exact_custom_build_change_quote",
    declinedDisclosureDigest: "d".repeat(64),
    declinedQuoteDigest: "c".repeat(64)
  };

  assert.equal(
    (await selected.service.getCustomBuildChangeCompletion(
      actor(),
      PROJECT_ID
    )).state,
    "building"
  );
  assert.deepEqual(
    (
      await selected.service.getCustomBuildCompletionEvidence(
        actor(),
        PROJECT_ID,
        EVIDENCE_ID
      )
    ).bytes,
    Buffer.from("completion evidence")
  );
  assert.equal(
    (
      await selected.service.acceptCustomBuildChangeOrder(
        actor(),
        PROJECT_ID,
        changeOrderId,
        acceptance
      )
    ).state,
    "accepted_payment_required"
  );
  assert.equal(
    (
      await selected.service.declineCustomBuildChangeOrder(
        actor(),
        PROJECT_ID,
        changeOrderId,
        decline
      )
    ).state,
    "declined"
  );

  assert.deepEqual(selected.calls.customBuildChangeCompletionRead, [scope]);
  assert.deepEqual(selected.calls.customBuildCompletionEvidenceRead, [
    { scope, evidenceId: EVIDENCE_ID }
  ]);
  assert.deepEqual(selected.calls.customBuildChangeAcceptance, [
    { scope, changeOrderId, input: acceptance }
  ]);
  assert.deepEqual(selected.calls.customBuildChangeDecline, [
    { scope, changeOrderId, input: decline }
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

test("hosted Custom build read and acceptance use only the resolved customer project", async () => {
  const selected = context();
  const current = await selected.service.getCustomBuildQuote(
    actor(),
    PROJECT_ID
  );
  assert.equal(current.state, "not_available");

  const acceptance = {
    acceptanceStatement: "accepted_exact_custom_build_quote",
    acceptedDisclosureDigest: "b".repeat(64),
    acceptedQuoteDigest: "a".repeat(64),
    commandId: "custom-build-accept-command-1",
    quoteId: "50000000-0000-4000-8000-000000000001",
    quoteRevision: 1
  };
  const accepted = await selected.service.acceptCustomBuildQuote(
    actor(),
    PROJECT_ID,
    acceptance
  );
  assert.equal(accepted.state, "accepted");

  const scope = {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID
  };
  assert.deepEqual(selected.calls.customBuildRead, [scope]);
  assert.deepEqual(selected.calls.customBuildAcceptance, [
    { ...scope, ...acceptance }
  ]);

  await assert.rejects(
    selected.service.acceptCustomBuildQuote(actor(), PROJECT_ID, {
      ...acceptance,
      amountMinor: 20000
    }),
    isError("invalid_input", 400)
  );
  assert.equal(selected.calls.customBuildAcceptance.length, 1);
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
    held.createAssessmentCheckout(actor(), PROJECT_ID, OTHER_ID, {}),
    isError("CUSTOM_SERVICES_PAYMENT_HELD", 503)
  );
  await assert.rejects(
    held.acceptAssessmentQuote(actor(), PROJECT_ID, {}),
    isError("CUSTOM_SERVICES_QUOTE_HELD", 503)
  );
  await assert.rejects(
    held.getCustomBuildQuote(actor(), PROJECT_ID),
    isError("CUSTOM_BUILD_HELD", 503)
  );
  await assert.rejects(
    held.getCustomBuildProgress(actor(), PROJECT_ID),
    isError("CUSTOM_BUILD_PROGRESS_HELD", 503)
  );
  await assert.rejects(
    held.respondToCustomBuildRequest(actor(), PROJECT_ID, OTHER_ID, {}),
    isError("CUSTOM_BUILD_PROGRESS_HELD", 503)
  );
  await assert.rejects(
    held.getCustomBuildChangeCompletion(actor(), PROJECT_ID),
    isError("CUSTOM_BUILD_CHANGE_COMPLETION_HELD", 503)
  );
  await assert.rejects(
    held.getCustomBuildCompletionEvidence(actor(), PROJECT_ID, EVIDENCE_ID),
    isError("CUSTOM_BUILD_CHANGE_COMPLETION_HELD", 503)
  );
  await assert.rejects(
    held.acceptCustomBuildChangeOrder(actor(), PROJECT_ID, OTHER_ID, {}),
    isError("CUSTOM_BUILD_CHANGE_COMPLETION_HELD", 503)
  );
  await assert.rejects(
    held.declineCustomBuildChangeOrder(actor(), PROJECT_ID, OTHER_ID, {}),
    isError("CUSTOM_BUILD_CHANGE_COMPLETION_HELD", 503)
  );
  await assert.rejects(
    held.acceptCustomBuildQuote(actor(), PROJECT_ID, {}),
    isError("CUSTOM_BUILD_HELD", 503)
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

test("held Custom-build change/completion boundary validates exact authority before failing closed", async () => {
  const held = createHeldCustomServicesCustomBuildChangeCompletion();
  const scope = {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID
  };
  const changeOrderId =
    "60000000-0000-4000-8000-000000000001";
  const jobId = "70000000-0000-4000-8000-000000000001";
  const dataBase64 = readFileSync(
    new URL("../../../assets/work-demo-bright-spark.png", import.meta.url)
  ).toString("base64");
  const heldError = isError("CUSTOM_BUILD_CHANGE_COMPLETION_HELD", 503);
  const operations = [
    () => held.readCustomer(scope),
    () => held.readCustomerEvidence(scope, EVIDENCE_ID),
    () => held.acceptChangeOrder(scope, changeOrderId, {
      acceptanceStatement:
        "accepted_exact_change_order_and_payment_requirement",
      acceptedDisclosureDigest: "b".repeat(64),
      acceptedQuoteDigest: "a".repeat(64),
      commandId: "change-accept-command-1"
    }),
    () => held.declineChangeOrder(scope, changeOrderId, {
      commandId: "change-decline-command-1",
      declineStatement: "declined_exact_custom_build_change_quote",
      declinedDisclosureDigest: "d".repeat(64),
      declinedQuoteDigest: "c".repeat(64)
    }),
    () => held.readOwner(actor(), jobId, ORGANIZATION_ID),
    () => held.issueChangeOrder(actor(), jobId, {
      addedScope: "Add the approved events page and matching navigation link.",
      commandId: "change-issue-command-1",
      expiresAt: "2026-08-15T12:00:00.000Z",
      organizationId: ORGANIZATION_ID,
      targetCompletionDate: "2026-09-15",
      unitCount: 2
    }),
    () => held.voidChangeOrder(actor(), jobId, changeOrderId, {
      commandId: "change-void-command-1",
      expectedQuoteDigest: "a".repeat(64),
      organizationId: ORGANIZATION_ID,
      reason: "The customer requested a replacement change order instead."
    }),
    () => held.uploadEvidence(actor(), jobId, {
      accessibleDescription: "Desktop completion view of the approved homepage.",
      commandId: "completion-evidence-command-1",
      dataBase64,
      mediaType: "image/png",
      organizationId: ORGANIZATION_ID,
      viewport: "desktop"
    }),
    () => held.recordCompletion(actor(), jobId, {
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
      evidenceIds: [OTHER_ID, EVIDENCE_ID],
      organizationId: ORGANIZATION_ID
    })
  ];
  for (const operation of operations) {
    await assert.rejects(operation, heldError);
  }

  await assert.rejects(
    held.readOwner(null, jobId, ORGANIZATION_ID),
    isError("AUTHENTICATION_REQUIRED", 401)
  );
  await assert.rejects(
    held.acceptChangeOrder(scope, changeOrderId, {
      acceptanceStatement:
        "accepted_exact_change_order_and_payment_requirement",
      acceptedDisclosureDigest: "b".repeat(64),
      acceptedQuoteDigest: "a".repeat(64),
      commandId: "change-accept-command-1",
      amountMinor: 1
    }),
    isError("INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT", 400)
  );
});
