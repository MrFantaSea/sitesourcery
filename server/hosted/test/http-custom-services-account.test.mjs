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
    async acceptCustomBuildQuote() {
      throw new Error("unexpected Custom build acceptance");
    },
    async getAssessmentReport() {
      throw new Error("unexpected assessment report read");
    },
    async getAssessmentEvidence() {
      throw new Error("unexpected assessment evidence read");
    },
    async getCustomBuildQuote() {
      throw new Error("unexpected Custom build quote read");
    },
    async getCustomBuildInvoice() {
      throw new Error("unexpected Custom build invoice read");
    },
    async getCustomBuildProgress() {
      throw new Error("unexpected Custom build progress read");
    },
    async getCustomBuildChangeCompletion() {
      throw new Error("unexpected Custom build change/completion read");
    },
    async getCustomBuildChangeInvoice() {
      throw new Error("unexpected Custom build change invoice read");
    },
    async getCustomBuildFinalHandoff() {
      throw new Error("unexpected Custom build final handoff read");
    },
    async getCustomBuildHandoffDocument() {
      throw new Error("unexpected Custom build handoff document read");
    },
    async getCustomBuildCompletionEvidence() {
      throw new Error("unexpected Custom build completion evidence read");
    },
    async createCustomBuildCheckout() {
      throw new Error("unexpected Custom build checkout");
    },
    async createCustomBuildChangeCheckout() {
      throw new Error("unexpected Custom build change checkout");
    },
    async createCustomBuildFinalCheckout() {
      throw new Error("unexpected Custom build final checkout");
    },
    async respondToCustomBuildRequest() {
      throw new Error("unexpected Custom build response");
    },
    async acceptCustomBuildChangeOrder() {
      throw new Error("unexpected Custom build change-order acceptance");
    },
    async declineCustomBuildChangeOrder() {
      throw new Error("unexpected Custom build change-order decline");
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
    getCustomBuildQuote: noOp,
    getCustomBuildInvoice: noOp,
    getCustomBuildProgress: noOp,
    getCustomBuildChangeCompletion: noOp,
    getCustomBuildChangeInvoice: noOp,
    getCustomBuildFinalHandoff: noOp,
    getCustomBuildHandoffDocument: noOp,
    getCustomBuildCompletionEvidence: noOp,
    createCustomBuildCheckout: noOp,
    createCustomBuildChangeCheckout: noOp,
    createCustomBuildFinalCheckout: noOp,
    acceptCustomBuildQuote: noOp,
    respondToCustomBuildRequest: noOp,
    acceptCustomBuildChangeOrder: noOp,
    declineCustomBuildChangeOrder: noOp,
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
    headers.Cookie =
      `${headers.Cookie ? `${headers.Cookie}; ` : ""}` +
      `ss_csrf=${"c".repeat(32)}`;
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

test("Custom build quote HTTP routes read and accept the exact project quote without monetary input", async () => {
  const calls = [];
  const current = {
    schema: "sitesourcery.custom-services-custom-build-quote/v1",
    state: "review_required"
  };
  const accepted = { ...current, state: "accepted" };
  const api = createHostedApi(service(), {
    customServicesAccount: completeAccountBoundary({
      async getCustomBuildQuote(actor, projectId) {
        calls.push({ action: "read", actor, projectId });
        return current;
      },
      async acceptCustomBuildQuote(actor, projectId, input) {
        calls.push({ action: "accept", actor, projectId, input });
        return accepted;
      }
    }),
    requestIds: {
      next() {
        return "request_custom_build_quote_1";
      }
    }
  });
  const path =
    `/api/v1/projects/${PROJECT_ID}/custom-services/custom-build-quote`;

  const read = await api.fetch(request({ path }));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), current);

  const body = {
    acceptanceStatement: "accepted_exact_custom_build_quote",
    acceptedDisclosureDigest: "b".repeat(64),
    acceptedQuoteDigest: "a".repeat(64),
    quoteId: "50000000-0000-4000-8000-000000000001",
    quoteRevision: 1
  };
  const acceptance = await api.fetch(request({
    body,
    method: "POST",
    path: `${path}/acceptance`,
    write: true
  }));
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

  const monetary = await api.fetch(request({
    body: { ...body, amountMinor: 20000 },
    method: "POST",
    path: `${path}/acceptance`,
    write: true
  }));
  assert.equal(monetary.status, 400);
  assert.equal(
    (await monetary.json()).error.code,
    "INVALID_CUSTOM_BUILD_QUOTE_ACCEPTANCE"
  );
  assert.equal(calls.length, 2);

  const signedOut = await api.fetch(request({ path, signedIn: false }));
  assert.equal(signedOut.status, 401);
  assert.equal(calls.length, 2);
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

test("Custom build invoice HTTP routes bind exact project and invoice without browser money", async () => {
  const calls = [];
  const invoiceId =
    "60000000-0000-4000-8000-000000000002";
  const invoice = {
    schema: "sitesourcery.custom-build-start-invoice/v1",
    state: "checkout_available"
  };
  const checkout = {
    schema: "sitesourcery.custom-build-start-checkout/v1",
    state: "ready"
  };
  const api = createHostedApi(service(), {
    customServicesAccount: completeAccountBoundary({
      async getCustomBuildInvoice(actor, projectId) {
        calls.push({ action: "read", actor, projectId });
        return invoice;
      },
      async createCustomBuildCheckout(
        actor,
        projectId,
        selectedInvoiceId,
        input
      ) {
        calls.push({
          action: "checkout",
          actor,
          projectId,
          invoiceId: selectedInvoiceId,
          input
        });
        return checkout;
      }
    })
  });
  const root =
    `/api/v1/projects/${PROJECT_ID}/custom-services`;
  const read = await api.fetch(request({
    path: `${root}/custom-build-invoice`
  }));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), invoice);

  const pay = await api.fetch(request({
    method: "POST",
    path:
      `${root}/custom-build-invoices/${invoiceId}/checkout-command`,
    body: { invoiceDigest: "e".repeat(64) },
    write: true
  }));
  assert.equal(pay.status, 201);
  assert.deepEqual(await pay.json(), checkout);
  assert.deepEqual(calls, [
    {
      action: "read",
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID
    },
    {
      action: "checkout",
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID,
      invoiceId,
      input: {
        commandId: "accept-command-1",
        invoiceDigest: "e".repeat(64)
      }
    }
  ]);
});

test("Custom-build change payment HTTP routes are exact, authenticated, and isolated from first payment", async () => {
  const calls = [];
  const invoiceId =
    "60000000-0000-4000-8000-000000000004";
  const invoice = {
    schema: "sitesourcery.custom-build-change-invoice/v1",
    state: "checkout_available"
  };
  const checkout = {
    schema: "sitesourcery.custom-build-change-checkout/v1",
    state: "ready"
  };
  const api = createHostedApi(service(), {
    customServicesAccount: completeAccountBoundary({
      async getCustomBuildChangeInvoice(actor, projectId) {
        calls.push({ action: "change-read", actor, projectId });
        return invoice;
      },
      async createCustomBuildChangeCheckout(
        actor,
        projectId,
        selectedInvoiceId,
        input
      ) {
        calls.push({
          action: "change-checkout",
          actor,
          projectId,
          invoiceId: selectedInvoiceId,
          input
        });
        return checkout;
      },
      async createCustomBuildCheckout() {
        calls.push({ action: "first-payment-crossed" });
        throw new Error("change payment crossed into first payment");
      }
    })
  });
  const root =
    `/api/v1/projects/${PROJECT_ID}/custom-services`;
  const readPath = `${root}/custom-build-change-invoice`;
  const checkoutPath =
    `${root}/custom-build-change-invoices/${invoiceId}/checkout-command`;

  const read = await api.fetch(request({ path: readPath }));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), invoice);

  const paid = await api.fetch(request({
    body: { invoiceDigest: "f".repeat(64) },
    method: "POST",
    path: checkoutPath,
    write: true
  }));
  assert.equal(paid.status, 201);
  assert.deepEqual(await paid.json(), checkout);
  assert.deepEqual(calls, [
    {
      action: "change-read",
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID
    },
    {
      action: "change-checkout",
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID,
      invoiceId,
      input: {
        commandId: "accept-command-1",
        invoiceDigest: "f".repeat(64)
      }
    }
  ]);

  const wrongQuery = await api.fetch(request({
    path: `${readPath}?state=paid`
  }));
  assert.equal(wrongQuery.status, 400);
  assert.equal(
    (await wrongQuery.json()).error.code,
    "INVALID_CUSTOM_BUILD_CHANGE_PAYMENT_INPUT"
  );

  for (const expanded of [
    { amountMinor: 12_500 },
    { taxMinor: 1 },
    { provider: "stripe" },
    { state: "paid" },
    { markPaid: true }
  ]) {
    const response = await api.fetch(request({
      body: { invoiceDigest: "f".repeat(64), ...expanded },
      method: "POST",
      path: checkoutPath,
      write: true
    }));
    assert.equal(response.status, 400);
    assert.equal(
      (await response.json()).error.code,
      "INVALID_CUSTOM_BUILD_CHANGE_PAYMENT_INPUT"
    );
  }

  const signedOutRead = await api.fetch(request({
    path: readPath,
    signedIn: false
  }));
  assert.equal(signedOutRead.status, 401);
  const signedOutWrite = await api.fetch(request({
    body: { invoiceDigest: "f".repeat(64) },
    method: "POST",
    path: checkoutPath,
    signedIn: false,
    write: true
  }));
  assert.equal(signedOutWrite.status, 401);
  assert.equal(calls.length, 2);
});

test("Custom-build final payment HTTP routes are exact, authenticated, and isolated from earlier payment purposes", async () => {
  const calls = [];
  const invoiceId =
    "60000000-0000-4000-8000-000000000005";
  const state = {
    schema: "sitesourcery.custom-build-final-handoff/v1",
    state: "checkout_available",
    invoice: { invoiceId },
    handoff: null
  };
  const checkout = {
    schema: "sitesourcery.custom-build-final-checkout/v1",
    state: "ready"
  };
  const api = createHostedApi(service(), {
    customServicesAccount: completeAccountBoundary({
      async getCustomBuildFinalHandoff(actor, projectId) {
        calls.push({ action: "final-read", actor, projectId });
        return state;
      },
      async createCustomBuildFinalCheckout(
        actor,
        projectId,
        selectedInvoiceId,
        input
      ) {
        calls.push({
          action: "final-checkout",
          actor,
          projectId,
          invoiceId: selectedInvoiceId,
          input
        });
        return checkout;
      },
      async createCustomBuildCheckout() {
        throw new Error("final payment crossed into first payment");
      },
      async createCustomBuildChangeCheckout() {
        throw new Error("final payment crossed into change payment");
      }
    })
  });
  const root =
    `/api/v1/projects/${PROJECT_ID}/custom-services`;
  const readPath = `${root}/custom-build-final-handoff`;
  const checkoutPath =
    `${root}/custom-build-final-invoices/${invoiceId}/checkout-command`;

  const read = await api.fetch(request({ path: readPath }));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), state);

  const paid = await api.fetch(request({
    body: { invoiceDigest: "a".repeat(64) },
    method: "POST",
    path: checkoutPath,
    write: true
  }));
  assert.equal(paid.status, 201);
  assert.deepEqual(await paid.json(), checkout);
  assert.deepEqual(calls, [
    {
      action: "final-read",
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID
    },
    {
      action: "final-checkout",
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID,
      invoiceId,
      input: {
        commandId: "accept-command-1",
        invoiceDigest: "a".repeat(64)
      }
    }
  ]);

  const wrongQuery = await api.fetch(request({
    path: `${readPath}?state=paid`
  }));
  assert.equal(wrongQuery.status, 400);
  assert.equal(
    (await wrongQuery.json()).error.code,
    "INVALID_CUSTOM_BUILD_FINAL_PAYMENT_INPUT"
  );

  for (const expanded of [
    { amountMinor: 50_000 },
    { changeAmountMinor: 12_500 },
    { assessmentCreditMinor: 20_000 },
    { provider: "stripe" },
    { state: "paid" },
    { markPaid: true }
  ]) {
    const response = await api.fetch(request({
      body: { invoiceDigest: "a".repeat(64), ...expanded },
      method: "POST",
      path: checkoutPath,
      write: true
    }));
    assert.equal(response.status, 400);
    assert.equal(
      (await response.json()).error.code,
      "INVALID_CUSTOM_BUILD_FINAL_PAYMENT_INPUT"
    );
  }

  const signedOutRead = await api.fetch(request({
    path: readPath,
    signedIn: false
  }));
  assert.equal(signedOutRead.status, 401);
  const signedOutWrite = await api.fetch(request({
    body: { invoiceDigest: "a".repeat(64) },
    method: "POST",
    path: checkoutPath,
    signedIn: false,
    write: true
  }));
  assert.equal(signedOutWrite.status, 401);
  assert.equal(calls.length, 2);
});

test("Custom-build handoff document HTTP route is authenticated, project-bound, exact, and read-only", async () => {
  const calls = [];
  const documentId =
    "61000000-0000-4000-8000-000000000006";
  const document = {
    schema: "sitesourcery.custom-build-handoff-document/v1",
    documentId,
    contentDigest: "b".repeat(64),
    mediaType: "application/json",
    byteCount: 512,
    payload: { state: "handed_off" }
  };
  const api = createHostedApi(service(), {
    customServicesAccount: completeAccountBoundary({
      async getCustomBuildHandoffDocument(
        actor,
        projectId,
        selectedDocumentId
      ) {
        calls.push({ actor, projectId, documentId: selectedDocumentId });
        return document;
      }
    })
  });
  const path =
    `/api/v1/projects/${PROJECT_ID}/custom-services/`
      + `custom-build-handoff-documents/${documentId}`;

  const opened = await api.fetch(request({ path }));
  assert.equal(opened.status, 200);
  assert.deepEqual(await opened.json(), document);
  assert.deepEqual(calls, [
    {
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID,
      documentId
    }
  ]);

  const expandedQuery = await api.fetch(request({
    path: `${path}?download=true`
  }));
  assert.equal(expandedQuery.status, 400);
  assert.equal(
    (await expandedQuery.json()).error.code,
    "INVALID_CUSTOM_BUILD_HANDOFF_INPUT"
  );
  const signedOut = await api.fetch(request({ path, signedIn: false }));
  assert.equal(signedOut.status, 401);
  const wrongMethod = await api.fetch(request({
    body: {},
    method: "POST",
    path,
    write: true
  }));
  assert.equal(wrongMethod.status, 404);
  assert.equal(calls.length, 1);
});

test("Custom build progress HTTP routes bind the exact project and safe customer response", async () => {
  const calls = [];
  const requestId =
    "60000000-0000-4000-8000-000000000003";
  const current = {
    schema: "sitesourcery.custom-build-progress/v1",
    state: "action_needed",
    revision: 4
  };
  const responded = { ...current, state: "reviewing_response", revision: 5 };
  const api = createHostedApi(service(), {
    customServicesAccount: completeAccountBoundary({
      async getCustomBuildProgress(actor, projectId) {
        calls.push({ action: "read", actor, projectId });
        return current;
      },
      async respondToCustomBuildRequest(actor, projectId, selectedRequestId, input) {
        calls.push({
          action: "respond",
          actor,
          projectId,
          requestId: selectedRequestId,
          input
        });
        return responded;
      }
    })
  });
  const root =
    `/api/v1/projects/${PROJECT_ID}/custom-services`;

  const read = await api.fetch(request({
    path: `${root}/custom-build-progress`
  }));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), current);

  const body = {
    expectedRevision: 4,
    responseKind: "customer_decision",
    responseNote: "Use the approved second About-page paragraph."
  };
  const response = await api.fetch(request({
    body,
    method: "POST",
    path: `${root}/custom-build-requests/${requestId}/response`,
    write: true
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), responded);
  assert.deepEqual(calls, [
    {
      action: "read",
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID
    },
    {
      action: "respond",
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID,
      requestId,
      input: { ...body, commandId: "accept-command-1" }
    }
  ]);

  const expanded = await api.fetch(request({
    body: { ...body, password: "must-not-enter-the-system" },
    method: "POST",
    path: `${root}/custom-build-requests/${requestId}/response`,
    write: true
  }));
  assert.equal(expanded.status, 400);
  assert.equal(
    (await expanded.json()).error.code,
    "INVALID_CUSTOM_BUILD_PROGRESS_INPUT"
  );
  assert.equal(calls.length, 2);
});

test("Custom-build change/completion customer routes bind exact authority and integrity-check evidence", async () => {
  const calls = [];
  const changeOrderId =
    "60000000-0000-4000-8000-000000000004";
  const corruptEvidenceId =
    "50000000-0000-4000-8000-000000000001";
  const bytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ]);
  const contentDigest = createHash("sha256").update(bytes).digest("hex");
  const snapshot = {
    schema: "sitesourcery.custom-build-change-completion/v1",
    state: "change_order_review"
  };
  const api = createHostedApi(service(), {
    customServicesAccount: completeAccountBoundary({
      async getCustomBuildChangeCompletion(actor, projectId) {
        calls.push({ action: "read", actor, projectId });
        return snapshot;
      },
      async getCustomBuildCompletionEvidence(actor, projectId, evidenceId) {
        calls.push({ action: "evidence", actor, projectId, evidenceId });
        return {
          bytes,
          mediaType: "image/png",
          contentDigest:
            evidenceId === EVIDENCE_ID ? contentDigest : "0".repeat(64),
          byteCount: bytes.byteLength,
          accessibleDescription: "Custom-build completion screenshot"
        };
      },
      async acceptCustomBuildChangeOrder(
        actor,
        projectId,
        selectedChangeOrderId,
        input
      ) {
        calls.push({
          action: "accept",
          actor,
          projectId,
          changeOrderId: selectedChangeOrderId,
          input
        });
        return { ...snapshot, state: "accepted_payment_required" };
      },
      async declineCustomBuildChangeOrder(
        actor,
        projectId,
        selectedChangeOrderId,
        input
      ) {
        calls.push({
          action: "decline",
          actor,
          projectId,
          changeOrderId: selectedChangeOrderId,
          input
        });
        return { ...snapshot, state: "declined" };
      }
    })
  });
  const root = `/api/v1/projects/${PROJECT_ID}/custom-services`;

  const read = await api.fetch(request({
    path: `${root}/custom-build-change-completion`
  }));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), snapshot);

  const evidence = await api.fetch(request({
    path: `${root}/custom-build-completion-evidence/${EVIDENCE_ID}`
  }));
  assert.equal(evidence.status, 200);
  assert.equal(evidence.headers.get("cache-control"), "private, no-store");
  assert.equal(evidence.headers.get("content-type"), "image/png");
  assert.equal(
    evidence.headers.get("digest"),
    `sha-256=${Buffer.from(contentDigest, "hex").toString("base64")}`
  );
  assert.deepEqual(Buffer.from(await evidence.arrayBuffer()), bytes);

  const acceptanceBody = {
    acceptanceStatement:
      "accepted_exact_change_order_and_payment_requirement",
    acceptedDisclosureDigest: "b".repeat(64),
    acceptedQuoteDigest: "a".repeat(64)
  };
  const acceptance = await api.fetch(request({
    body: acceptanceBody,
    method: "POST",
    path: `${root}/custom-build-change-orders/${changeOrderId}/acceptance`,
    write: true
  }));
  assert.equal(acceptance.status, 200);
  assert.equal((await acceptance.json()).state, "accepted_payment_required");

  const declineBody = {
    declineStatement: "declined_exact_custom_build_change_quote",
    declinedDisclosureDigest: "d".repeat(64),
    declinedQuoteDigest: "c".repeat(64)
  };
  const decline = await api.fetch(request({
    body: declineBody,
    method: "POST",
    path: `${root}/custom-build-change-orders/${changeOrderId}/decline`,
    write: true
  }));
  assert.equal(decline.status, 200);
  assert.equal((await decline.json()).state, "declined");

  const actor = { userId: CUSTOMER_ID };
  assert.deepEqual(calls.slice(0, 4), [
    { action: "read", actor, projectId: PROJECT_ID },
    {
      action: "evidence",
      actor,
      projectId: PROJECT_ID,
      evidenceId: EVIDENCE_ID
    },
    {
      action: "accept",
      actor,
      projectId: PROJECT_ID,
      changeOrderId,
      input: { ...acceptanceBody, commandId: "accept-command-1" }
    },
    {
      action: "decline",
      actor,
      projectId: PROJECT_ID,
      changeOrderId,
      input: { ...declineBody, commandId: "accept-command-1" }
    }
  ]);

  const signedOut = await api.fetch(request({
    path: `${root}/custom-build-change-completion`,
    signedIn: false
  }));
  assert.equal(signedOut.status, 401);
  assert.equal((await signedOut.json()).error.code, "AUTHENTICATION_REQUIRED");

  const wrongQuery = await api.fetch(request({
    path: `${root}/custom-build-change-completion?organizationId=forbidden`
  }));
  assert.equal(wrongQuery.status, 400);
  assert.equal(
    (await wrongQuery.json()).error.code,
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT"
  );

  const expanded = await api.fetch(request({
    body: { ...acceptanceBody, amountMinor: 1 },
    method: "POST",
    path: `${root}/custom-build-change-orders/${changeOrderId}/acceptance`,
    write: true
  }));
  assert.equal(expanded.status, 400);
  assert.equal(
    (await expanded.json()).error.code,
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT"
  );

  const corrupt = await api.fetch(request({
    path:
      `${root}/custom-build-completion-evidence/${corruptEvidenceId}`
  }));
  assert.equal(corrupt.status, 500);
  assert.equal(
    (await corrupt.json()).error.code,
    "RUNTIME_CONFIGURATION_ERROR"
  );
  assert.equal(calls.length, 5);
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
  const changeCompletion = await api.fetch(request({
    path:
      `/api/v1/projects/${PROJECT_ID}/custom-services/custom-build-change-completion`
  }));
  assert.equal(changeCompletion.status, 503);
  assert.equal(
    (await changeCompletion.json()).error.code,
    "CUSTOM_BUILD_CHANGE_COMPLETION_HELD"
  );
  const changeInvoice = await api.fetch(request({
    path:
      `/api/v1/projects/${PROJECT_ID}/custom-services/custom-build-change-invoice`
  }));
  assert.equal(changeInvoice.status, 503);
  assert.equal(
    (await changeInvoice.json()).error.code,
    "CUSTOM_BUILD_CHANGE_PAYMENT_HELD"
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
    /createPostgresCustomServicesCustomBuild\(\{[\s\S]*authority,[\s\S]*randomUUID:/u
  );
  assert.match(
    source,
    /createConfiguredCustomBuildPaymentRelease\(\)/u
  );
  assert.match(
    source,
    /createPostgresCustomServicesCustomBuildPayment\(\{[\s\S]*provider:\s*stripeComposition\.adapter,[\s\S]*release:\s*customBuildPaymentComposition\.release[\s\S]*\}\)/u
  );
  assert.match(
    source,
    /customBuildPayment,/u
  );
  assert.match(
    source,
    /assertApprovedCustomBuildPaymentReady\([\s\S]*customBuildPaymentComposition,[\s\S]*readiness\.payments,[\s\S]*customServicesCustomBuild\.readiness\(\),[\s\S]*customBuildPayment\.readiness\(\)[\s\S]*\)/u
  );
  assert.match(
    source,
    /customBuildCommerce:\s*customBuildPayment/u
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
    /createPostgresCustomServicesCustomBuildProgress\(\{\s*authority\s*\}\)/u
  );
  assert.match(
    source,
    /customBuildProgress:\s*customServicesCustomBuildProgress/u
  );
  assert.match(
    source,
    /await customServicesCustomBuildProgress\.readiness\(\)/u
  );
  assert.match(
    source,
    /createHostedApi\(service,\s*\{[\s\S]*customServicesAccount,/u
  );
});
