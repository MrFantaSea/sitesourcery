import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION_TOKEN = "session_custom_services_account";
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const EVIDENCE_ID =
  "40000000-0000-4000-8000-000000000001";

function service() {
  return {
    async authenticate(token) {
      return token === SESSION_TOKEN
        ? { userId: CUSTOMER_ID }
        : null;
    }
  };
}

function assessmentWorkMethods() {
  return {
    async getAssessmentReport() {
      throw new Error("unexpected assessment report read");
    },
    async getAssessmentEvidence() {
      throw new Error("unexpected assessment evidence read");
    }
  };
}

function completeAccountBoundary(overrides = {}) {
  const noOp = async () => undefined;
  return {
    getSnapshot: noOp,
    getAssessmentQuote: noOp,
    getAssessmentInvoice: noOp,
    getAssessmentReport: noOp,
    getAssessmentEvidence: noOp,
    createAssessmentCheckout: noOp,
    getAssessmentRequest: noOp,
    saveAssessmentRequest: noOp,
    submitAssessmentRequest: noOp,
    withdrawAssessmentRequest: noOp,
    acceptAssessmentQuote: noOp,
    ...overrides
  };
}

function request({
  body,
  method = "GET",
  path = `/api/v1/projects/${PROJECT_ID}/custom-services`,
  signedIn = true,
  write = false
} = {}) {
  const headers = signedIn
    ? { Cookie: `ss_session=${SESSION_TOKEN}` }
    : {};
  if (write) {
    headers.Cookie += `${headers.Cookie ? "; " : ""}ss_csrf=${"c".repeat(32)}`;
    headers.Origin = ORIGIN;
    headers["X-CSRF-Token"] = "c".repeat(32);
    headers["Idempotency-Key"] = "accept-command-1";
    headers["Content-Type"] = "application/json";
  }
  return new Request(
    `${ORIGIN}${path}`,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }
  );
}

test("custom-services account HTTP route is authenticated, project-bound, and GET-only", async () => {
  const calls = [];
  const snapshot = {
    schema: "sitesourcery.custom-services-account/v1",
    state: "held"
  };
  const api = createHostedApi(service(), {
    customServicesAccount: {
      ...assessmentWorkMethods(),
      async acceptAssessmentQuote() {
        throw new Error("unexpected quote acceptance");
      },
      async getAssessmentQuote() {
        throw new Error("unexpected quote read");
      },
      async getAssessmentInvoice() {
        throw new Error("unexpected invoice read");
      },
      async createAssessmentCheckout() {
        throw new Error("unexpected assessment checkout");
      },
      async getAssessmentRequest() {
        throw new Error("unexpected request read");
      },
      async saveAssessmentRequest() {
        throw new Error("unexpected request save");
      },
      async submitAssessmentRequest() {
        throw new Error("unexpected request submission");
      },
      async withdrawAssessmentRequest() {
        throw new Error("unexpected request withdrawal");
      },
      async getSnapshot(actor, projectId) {
        calls.push({ actor: structuredClone(actor), projectId });
        return structuredClone(snapshot);
      }
    },
    requestIds: {
      next() {
        return "request_custom_services_account_1";
      }
    }
  });

  const response = await api.fetch(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), snapshot);
  assert.deepEqual(calls, [
    { actor: { userId: CUSTOMER_ID }, projectId: PROJECT_ID }
  ]);
  assert.equal(
    response.headers.get("x-request-id"),
    "request_custom_services_account_1"
  );

  const signedOut = await api.fetch(request({ signedIn: false }));
  assert.equal(signedOut.status, 401);
  assert.equal(
    (await signedOut.json()).error.code,
    "AUTHENTICATION_REQUIRED"
  );

  const write = await api.fetch(request({ method: "POST" }));
  assert.equal(write.status, 403);
  assert.equal((await write.json()).error.code, "CSRF_TOKEN_REQUIRED");
  assert.equal(calls.length, 1);
});

test("assessment quote HTTP routes read and accept the exact customer quote", async () => {
  const calls = [];
  const current = {
    schema: "sitesourcery.custom-services-assessment-quote/v1",
    state: "review_required"
  };
  const accepted = { ...current, state: "accepted" };
  const api = createHostedApi(service(), {
    customServicesAccount: {
      ...assessmentWorkMethods(),
      async getSnapshot() {
        throw new Error("unexpected account read");
      },
      async getAssessmentQuote(actor, projectId) {
        calls.push({ action: "read", actor, projectId });
        return current;
      },
      async getAssessmentInvoice() {
        throw new Error("unexpected invoice read");
      },
      async createAssessmentCheckout() {
        throw new Error("unexpected assessment checkout");
      },
      async acceptAssessmentQuote(actor, projectId, input) {
        calls.push({ action: "accept", actor, projectId, input });
        return accepted;
      },
      async getAssessmentRequest() {
        throw new Error("unexpected request read");
      },
      async saveAssessmentRequest() {
        throw new Error("unexpected request save");
      },
      async submitAssessmentRequest() {
        throw new Error("unexpected request submission");
      },
      async withdrawAssessmentRequest() {
        throw new Error("unexpected request withdrawal");
      }
    },
    requestIds: {
      next() {
        return "request_custom_services_quote_1";
      }
    }
  });
  const path =
    `/api/v1/projects/${PROJECT_ID}/custom-services/assessment-quote`;
  const read = await api.fetch(request({ path }));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), current);

  const body = {
    acceptanceStatement: "accepted_exact_quote_and_delivery_date",
    acceptedDisclosureDigest: "b".repeat(64),
    acceptedQuoteDigest: "a".repeat(64),
    quoteId: "50000000-0000-4000-8000-000000000001",
    quoteRevision: 1
  };
  const acceptance = await api.fetch(
    request({
      body,
      method: "POST",
      path: `${path}/acceptance`,
      write: true
    })
  );
  assert.equal(acceptance.status, 200);
  assert.deepEqual(await acceptance.json(), accepted);
  assert.deepEqual(calls, [
    {
      action: "read",
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID
    },
    {
      action: "accept",
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID,
      input: { ...body, commandId: "accept-command-1" }
    }
  ]);
});

test("assessment request HTTP routes read, save, submit, and withdraw", async () => {
  const calls = [];
  const api = createHostedApi(service(), {
    customServicesAccount: {
      ...assessmentWorkMethods(),
      async getSnapshot() {
        throw new Error("unexpected account read");
      },
      async getAssessmentQuote() {
        throw new Error("unexpected quote read");
      },
      async getAssessmentInvoice() {
        throw new Error("unexpected invoice read");
      },
      async createAssessmentCheckout() {
        throw new Error("unexpected assessment checkout");
      },
      async acceptAssessmentQuote() {
        throw new Error("unexpected quote acceptance");
      },
      async getAssessmentRequest(actor, projectId) {
        calls.push({ action: "read", actor, projectId });
        return { state: "not_started" };
      },
      async saveAssessmentRequest(actor, projectId, input) {
        calls.push({ action: "save", actor, projectId, input });
        return { state: "draft" };
      },
      async submitAssessmentRequest(actor, projectId, input) {
        calls.push({ action: "submit", actor, projectId, input });
        return { state: "submitted" };
      },
      async withdrawAssessmentRequest(actor, projectId, input) {
        calls.push({ action: "withdraw", actor, projectId, input });
        return { state: "withdrawn" };
      }
    }
  });
  const path =
    `/api/v1/projects/${PROJECT_ID}/custom-services/assessment-request`;
  assert.deepEqual(await (await api.fetch(request({ path }))).json(), {
    state: "not_started"
  });
  const saveBody = {
    approximatePublicSize: "one_to_ten",
    businessName: "Customer Business",
    complexityFlags: ["forms"],
    customerObservation: "The phone layout is crowded.",
    customerOwnershipAffirmed: true,
    expectedDraftRevision: 0,
    importantDate: null,
    platformFamily: "wordpress",
    primaryGoal: "Make services easier to understand.",
    publicUrl: "https://customer.example.com/",
    siteDisplayName: "Customer Website"
  };
  assert.deepEqual(
    await (
      await api.fetch(
        request({ body: saveBody, method: "PUT", path, write: true })
      )
    ).json(),
    { state: "draft" }
  );
  assert.deepEqual(
    await (
      await api.fetch(
        request({
          body: { draftRevision: 1 },
          method: "POST",
          path: `${path}/submission`,
          write: true
        })
      )
    ).json(),
    { state: "submitted" }
  );
  assert.deepEqual(
    await (
      await api.fetch(
        request({
          body: {},
          method: "POST",
          path: `${path}/withdrawal`,
          write: true
        })
      )
    ).json(),
    { state: "withdrawn" }
  );
  assert.deepEqual(
    calls.map(({ action, input }) => ({ action, input })),
    [
      { action: "read", input: undefined },
      { action: "save", input: { ...saveBody, commandId: "accept-command-1" } },
      {
        action: "submit",
        input: { draftRevision: 1, commandId: "accept-command-1" }
      },
      { action: "withdraw", input: { commandId: "accept-command-1" } }
    ]
  );
});

test("assessment invoice HTTP route reads the exact customer project", async () => {
  const calls = [];
  const invoice = {
    schema: "sitesourcery.custom-services-assessment-invoice/v2",
    state: "tax_calculation_pending"
  };
  const api = createHostedApi(service(), {
    customServicesAccount: {
      ...assessmentWorkMethods(),
      async getSnapshot() {},
      async getAssessmentQuote() {},
      async getAssessmentInvoice(actor, projectId) {
        calls.push({ actor, projectId });
        return invoice;
      },
      async createAssessmentCheckout() {
        throw new Error("unexpected assessment checkout");
      },
      async acceptAssessmentQuote() {},
      async getAssessmentRequest() {},
      async saveAssessmentRequest() {},
      async submitAssessmentRequest() {},
      async withdrawAssessmentRequest() {}
    }
  });
  const path =
    `/api/v1/projects/${PROJECT_ID}/custom-services/assessment-invoice`;
  const response = await api.fetch(request({ path }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), invoice);
  assert.deepEqual(calls, [
    { actor: { userId: CUSTOMER_ID }, projectId: PROJECT_ID }
  ]);
});

test("assessment checkout HTTP route binds project, invoice, digest, and command", async () => {
  const calls = [];
  const invoiceId =
    "60000000-0000-4000-8000-000000000001";
  const result = {
    schema:
      "sitesourcery.custom-services-assessment-checkout/v1",
    state: "ready"
  };
  const api = createHostedApi(service(), {
    customServicesAccount: {
      ...assessmentWorkMethods(),
      async getSnapshot() {},
      async getAssessmentQuote() {},
      async getAssessmentInvoice() {},
      async createAssessmentCheckout(
        actor,
        projectId,
        selectedInvoiceId,
        input
      ) {
        calls.push({
          actor,
          projectId,
          invoiceId: selectedInvoiceId,
          input
        });
        return result;
      },
      async acceptAssessmentQuote() {},
      async getAssessmentRequest() {},
      async saveAssessmentRequest() {},
      async submitAssessmentRequest() {},
      async withdrawAssessmentRequest() {}
    }
  });
  const response = await api.fetch(request({
    method: "POST",
    path:
      `/api/v1/projects/${PROJECT_ID}/custom-services/assessment-invoices/${invoiceId}/checkout-command`,
    body: { invoiceDigest: "d".repeat(64) },
    write: true
  }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), result);
  assert.deepEqual(calls, [
    {
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID,
      invoiceId,
      input: {
        commandId: "accept-command-1",
        invoiceDigest: "d".repeat(64)
      }
    }
  ]);
});

test("assessment report and evidence routes stay customer-bound and integrity checked", async () => {
  const calls = [];
  const bytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ]);
  const contentDigest = createHash("sha256")
    .update(bytes)
    .digest("hex");
  const report = {
    schema: "sitesourcery.custom-services-assessment-report/v1",
    state: "delivered"
  };
  const api = createHostedApi(service(), {
    customServicesAccount: completeAccountBoundary({
      async getAssessmentReport(actor, projectId) {
        calls.push({ action: "report", actor, projectId });
        return report;
      },
      async getAssessmentEvidence(actor, projectId, evidenceId) {
        calls.push({ action: "evidence", actor, projectId, evidenceId });
        return {
          bytes,
          mediaType: "image/png",
          contentDigest:
            evidenceId === EVIDENCE_ID
              ? contentDigest
              : "0".repeat(64),
          byteCount: bytes.byteLength,
          accessibleDescription: "Customer assessment screenshot"
        };
      }
    }),
    requestIds: {
      next() {
        return "request_customer_assessment_work_1";
      }
    }
  });

  const reportResponse = await api.fetch(request({
    path:
      `/api/v1/projects/${PROJECT_ID}/custom-services/assessment-report`
  }));
  assert.equal(reportResponse.status, 200);
  assert.deepEqual(await reportResponse.json(), report);

  const evidenceResponse = await api.fetch(request({
    path:
      `/api/v1/projects/${PROJECT_ID}/custom-services/assessment-evidence/${EVIDENCE_ID}`
  }));
  assert.equal(evidenceResponse.status, 200);
  assert.equal(
    evidenceResponse.headers.get("cache-control"),
    "private, no-store"
  );
  assert.equal(evidenceResponse.headers.get("content-type"), "image/png");
  assert.equal(
    evidenceResponse.headers.get("digest"),
    `sha-256=${Buffer.from(contentDigest, "hex").toString("base64")}`
  );
  assert.deepEqual(
    Buffer.from(await evidenceResponse.arrayBuffer()),
    bytes
  );
  assert.deepEqual(calls, [
    {
      action: "report",
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID
    },
    {
      action: "evidence",
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID,
      evidenceId: EVIDENCE_ID
    }
  ]);

  const corruptId =
    "50000000-0000-4000-8000-000000000001";
  const corrupt = await api.fetch(request({
    path:
      `/api/v1/projects/${PROJECT_ID}/custom-services/assessment-evidence/${corruptId}`
  }));
  assert.equal(corrupt.status, 500);
  assert.equal(
    (await corrupt.json()).error.code,
    "RUNTIME_CONFIGURATION_ERROR"
  );
});

test("default hosted runtime keeps custom-services account reading held", async () => {
  const api = createHostedApi(service());
  const response = await api.fetch(request());
  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).error.code,
    "CUSTOM_SERVICES_ACCOUNT_HELD"
  );
});

test("production composes custom-services account from canonical project and PostgreSQL authority", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /createPostgresCustomServicesAccountRepository\(\{\s*authority\s*\}\)/u
  );
  assert.match(
    source,
    /createHostedCustomServicesAccount\(\{[\s\S]*repository:\s*customServicesAccountRepository,[\s\S]*resolveSession:\s*commerceV2\.resolveSession/u
  );
  assert.match(
    source,
    /createPostgresCustomServicesAssessmentQuoteRepository\(\{\s*authority\s*\}\)/u
  );
  assert.match(
    source,
    /quoteRepository:\s*customServicesAssessmentQuoteRepository/u
  );
  assert.match(
    source,
    /createConfiguredCustomServicesAssessmentPaymentRelease\(\)/u
  );
  assert.match(
    source,
    /createPostgresCustomServicesInvoiceRepository\(\{[\s\S]*authority,[\s\S]*release:\s*customServicesAssessmentPaymentComposition\.release[\s\S]*\}\)/u
  );
  assert.match(
    source,
    /invoiceRepository:\s*customServicesInvoiceRepository/u
  );
  assert.match(
    source,
    /createPostgresCustomServicesAssessmentPayment\(\{[\s\S]*provider:\s*stripeComposition\.adapter,[\s\S]*release:\s*customServicesAssessmentPaymentComposition\.release[\s\S]*\}\)/u
  );
  assert.match(
    source,
    /createPostgresCustomServicesAssessmentSettlement\(\{[\s\S]*authority,[\s\S]*provider:\s*stripeComposition\.adapter,[\s\S]*clock:\s*commerceV2\.clock,[\s\S]*ids:\s*commerceV2\.ids[\s\S]*\}\)/u
  );
  assert.match(
    source,
    /reconciliation:\s*customServicesAssessmentSettlement/u
  );
  assert.match(
    source,
    /payment:\s*customServicesAssessmentPayment/u
  );
  assert.match(
    source,
    /assertApprovedCustomServicesAssessmentPaymentReady\([\s\S]*customServicesAssessmentPaymentComposition,[\s\S]*readiness\.payments,[\s\S]*customServicesAssessmentSettlement\.readiness\(\)[\s\S]*\)/u
  );
  assert.match(
    source,
    /assessmentCommerce:\s*customServicesAssessmentSettlement/u
  );
  assert.match(
    source,
    /assessmentWork:\s*customServicesAssessmentWork/u
  );
  assert.match(
    source,
    /createPostgresCustomServicesRequestRepository\(\{\s*authority\s*\}\)/u
  );
  assert.match(
    source,
    /requestRepository:\s*customServicesRequestRepository/u
  );
  assert.match(
    source,
    /createHostedApi\(service,\s*\{[\s\S]*customServicesAccount,/u
  );
});
