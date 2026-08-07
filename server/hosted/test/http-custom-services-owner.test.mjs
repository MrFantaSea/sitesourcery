import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION_TOKEN = "session_custom_services_owner";
const OPERATOR_ID =
  "10000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID =
  "20000000-0000-4000-8000-000000000001";
const CASE_ID =
  "30000000-0000-4000-8000-000000000001";
const JOB_ID =
  "40000000-0000-4000-8000-000000000001";
const ATTEMPT_ID =
  "41000000-0000-4000-8000-000000000001";
const EVIDENCE_ID =
  "50000000-0000-4000-8000-000000000001";
const CUSTOM_BUILD_QUOTE_ID =
  "60000000-0000-4000-8000-000000000001";
const CUSTOM_BUILD_REQUEST_ID =
  "70000000-0000-4000-8000-000000000001";
const WORK_DIGEST = "a".repeat(64);

function service() {
  return {
    async authenticate(token) {
      return token === SESSION_TOKEN
        ? { userId: OPERATOR_ID }
        : null;
    }
  };
}

function request({
  body,
  idempotencyKey = "owner-quote-command-1",
  method = "GET",
  path = "/api/v1/operator/custom-services/assessment-requests",
  signedIn = true
} = {}) {
  const headers = signedIn
    ? { Cookie: `ss_session=${SESSION_TOKEN}` }
    : {};
  if (method !== "GET") {
    headers.Cookie =
      `${headers.Cookie ? `${headers.Cookie}; ` : ""}` +
      `ss_csrf=${"c".repeat(32)}`;
    headers.Origin = ORIGIN;
    headers["X-CSRF-Token"] = "c".repeat(32);
    headers["Idempotency-Key"] = idempotencyKey;
    headers["Content-Type"] = "application/json";
  }
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

test("owner assessment routes list submitted requests and issue an exact quote", async () => {
  const calls = [];
  const queue = {
    schema:
      "sitesourcery.custom-services-owner-assessment-queue/v1",
    requests: []
  };
  const receipt = {
    schema:
      "sitesourcery.custom-services-owner-assessment-quote/v1",
    state: "issued",
    quoteId:
      "40000000-0000-4000-8000-000000000001"
  };
  const api = createHostedApi(service(), {
    customServicesOwner: {
      async listAssessmentRequests(actor) {
        calls.push({ action: "list", actor });
        return queue;
      },
      async issueAssessmentQuote(actor, caseId, input) {
        calls.push({ action: "issue", actor, caseId, input });
        return receipt;
      }
    },
    requestIds: {
      next() {
        return "request_custom_services_owner_1";
      }
    }
  });

  const listed = await api.fetch(request());
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), queue);

  const body = {
    organizationId: ORGANIZATION_ID,
    deliveryDate: "2026-08-20",
    reviewTargets: [
      { kind: "page", value: "/" },
      { kind: "page_type", value: "product" }
    ]
  };
  const issued = await api.fetch(
    request({
      body,
      method: "POST",
      path:
        `/api/v1/operator/custom-services/assessment-requests/${CASE_ID}/quote`
    })
  );
  assert.equal(issued.status, 201);
  assert.deepEqual(await issued.json(), receipt);
  assert.deepEqual(calls, [
    {
      action: "list",
      actor: { userId: OPERATOR_ID }
    },
    {
      action: "issue",
      actor: { userId: OPERATOR_ID },
      caseId: CASE_ID,
      input: {
        ...body,
        commandId: "owner-quote-command-1"
      }
    }
  ]);
  assert.equal(
    issued.headers.get("x-request-id"),
    "request_custom_services_owner_1"
  );
});

test("owner assessment routes require login and an exact write body", async () => {
  let calls = 0;
  const api = createHostedApi(service(), {
    customServicesOwner: {
      async listAssessmentRequests() {
        calls += 1;
        return { requests: [] };
      },
      async issueAssessmentQuote() {
        calls += 1;
        return { state: "issued" };
      }
    }
  });

  const signedOut = await api.fetch(
    request({ signedIn: false })
  );
  assert.equal(signedOut.status, 401);
  assert.equal(
    (await signedOut.json()).error.code,
    "AUTHENTICATION_REQUIRED"
  );

  const invalid = await api.fetch(
    request({
      body: {
        organizationId: ORGANIZATION_ID,
        deliveryDate: "2026-08-20",
        reviewTargets: [],
        claimedPrice: 1
      },
      method: "POST",
      path:
        `/api/v1/operator/custom-services/assessment-requests/${CASE_ID}/quote`
    })
  );
  assert.equal(invalid.status, 400);
  assert.equal(
    (await invalid.json()).error.code,
    "INVALID_OWNER_ASSESSMENT_QUOTE"
  );
  assert.equal(calls, 0);
});

test("owner assessment work routes bind exact commands and private evidence", async () => {
  const calls = [];
  const bytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ]);
  const contentDigest = createHash("sha256")
    .update(bytes)
    .digest("hex");
  const jobs = {
    schema: "sitesourcery.custom-services-owner-assessment-jobs/v1",
    jobs: []
  };
  const evidence = {
    schema: "sitesourcery.custom-services-owner-assessment-evidence/v1",
    evidence: { evidenceId: EVIDENCE_ID }
  };
  const finding = {
    schema: "sitesourcery.custom-services-owner-assessment-finding/v1",
    finding: { priority: 1 }
  };
  const delivery = {
    schema: "sitesourcery.custom-services-owner-assessment-delivery/v1",
    state: "delivered"
  };
  const api = createHostedApi(service(), {
    customServicesAssessmentWork: {
      async listJobs(actor) {
        calls.push({ action: "list", actor });
        return jobs;
      },
      async readOwnerEvidence(actor, jobId, evidenceId) {
        calls.push({ action: "read-evidence", actor, jobId, evidenceId });
        return {
          bytes,
          mediaType: "image/png",
          contentDigest,
          byteCount: bytes.byteLength,
          accessibleDescription: "Assessment screenshot"
        };
      },
      async uploadEvidence(actor, jobId, input) {
        calls.push({ action: "upload", actor, jobId, input });
        return evidence;
      },
      async putFinding(actor, jobId, priority, input) {
        calls.push({ action: "finding", actor, jobId, priority, input });
        return finding;
      },
      async deliverReport(actor, jobId, input) {
        calls.push({ action: "delivery", actor, jobId, input });
        return delivery;
      }
    },
    requestIds: {
      next() {
        return "request_custom_services_work_1";
      }
    }
  });

  const listed = await api.fetch(request({
    path: "/api/v1/operator/custom-services/assessment-jobs"
  }));
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), jobs);

  const binary = await api.fetch(request({
    path:
      `/api/v1/operator/custom-services/assessment-jobs/${JOB_ID}` +
      `/evidence/${EVIDENCE_ID}`
  }));
  assert.equal(binary.status, 200);
  assert.equal(binary.headers.get("cache-control"), "private, no-store");
  assert.equal(binary.headers.get("content-type"), "image/png");
  assert.equal(binary.headers.get("content-length"), String(bytes.length));
  assert.equal(
    binary.headers.get("digest"),
    `sha-256=${Buffer.from(contentDigest, "hex").toString("base64")}`
  );
  assert.deepEqual(Buffer.from(await binary.arrayBuffer()), bytes);

  const evidenceBody = {
    accessibleDescription:
      "Phone homepage showing the paid review target.",
    bytesBase64: bytes.toString("base64"),
    mediaType: "image/png",
    organizationId: ORGANIZATION_ID,
    reviewTarget: { kind: "page", value: "/" },
    viewport: "phone"
  };
  const uploaded = await api.fetch(request({
    body: evidenceBody,
    method: "POST",
    path:
      `/api/v1/operator/custom-services/assessment-jobs/${JOB_ID}/evidence`
  }));
  assert.equal(uploaded.status, 201);
  assert.deepEqual(await uploaded.json(), evidence);

  const findingBody = {
    category: "responsive_design",
    evidenceIds: [EVIDENCE_ID],
    expectedRevision: 0,
    included: true,
    organizationId: ORGANIZATION_ID,
    primaryTarget: { kind: "page", value: "/" },
    recommendation: "Make the phone action easier to identify and tap.",
    severity: "moderate",
    summary: "The primary action is difficult to find on phone.",
    viewports: ["phone"]
  };
  const saved = await api.fetch(request({
    body: findingBody,
    method: "PUT",
    path:
      `/api/v1/operator/custom-services/assessment-jobs/${JOB_ID}/findings/1`
  }));
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), finding);

  const deliveryBody = {
    expectedWorkDigest: WORK_DIGEST,
    organizationId: ORGANIZATION_ID,
    overallSummary:
      "The paid review is complete and the report is ready for the customer."
  };
  const delivered = await api.fetch(request({
    body: deliveryBody,
    method: "POST",
    path:
      `/api/v1/operator/custom-services/assessment-jobs/${JOB_ID}/delivery`
  }));
  assert.equal(delivered.status, 201);
  assert.deepEqual(await delivered.json(), delivery);

  assert.deepEqual(calls, [
    { action: "list", actor: { userId: OPERATOR_ID } },
    {
      action: "read-evidence",
      actor: { userId: OPERATOR_ID },
      jobId: JOB_ID,
      evidenceId: EVIDENCE_ID
    },
    {
      action: "upload",
      actor: { userId: OPERATOR_ID },
      jobId: JOB_ID,
      input: { ...evidenceBody, commandId: "owner-quote-command-1" }
    },
    {
      action: "finding",
      actor: { userId: OPERATOR_ID },
      jobId: JOB_ID,
      priority: "1",
      input: { ...findingBody, commandId: "owner-quote-command-1" }
    },
    {
      action: "delivery",
      actor: { userId: OPERATOR_ID },
      jobId: JOB_ID,
      input: { ...deliveryBody, commandId: "owner-quote-command-1" }
    }
  ]);

  const invalid = await api.fetch(request({
    body: { ...evidenceBody, providerObjectKey: "claimed" },
    method: "POST",
    path:
      `/api/v1/operator/custom-services/assessment-jobs/${JOB_ID}/evidence`
  }));
  assert.equal(invalid.status, 400);
  assert.equal(
    (await invalid.json()).error.code,
    "INVALID_ASSESSMENT_EVIDENCE"
  );
  assert.equal(calls.length, 5);
});

test("owner Custom build routes bind exact opportunities, job quotes, and quote voids", async () => {
  const calls = [];
  const opportunities = {
    schema:
      "sitesourcery.custom-services-owner-custom-build-opportunities/v1",
    opportunities: []
  };
  const issuedReceipt = {
    schema: "sitesourcery.custom-services-owner-custom-build-quote/v1",
    state: "issued",
    quoteId: CUSTOM_BUILD_QUOTE_ID
  };
  const voidedReceipt = { ...issuedReceipt, state: "voided" };
  const api = createHostedApi(service(), {
    customServicesCustomBuild: {
      async listOpportunities(actor) {
        calls.push({ action: "list", actor });
        return opportunities;
      },
      async issueQuote(actor, jobId, input) {
        calls.push({ action: "issue", actor, jobId, input });
        return issuedReceipt;
      },
      async voidQuote(actor, quoteId, input) {
        calls.push({ action: "void", actor, quoteId, input });
        return voidedReceipt;
      },
      async readCurrentQuote() {
        throw new Error("unexpected customer Custom build read");
      },
      async acceptCurrentQuote() {
        throw new Error("unexpected customer Custom build acceptance");
      }
    },
    requestIds: {
      next() {
        return "request_custom_build_owner_1";
      }
    }
  });

  const listPath =
    "/api/v1/operator/custom-services/custom-build-opportunities";
  const listed = await api.fetch(request({ path: listPath }));
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), opportunities);

  const issueBody = {
    organizationId: ORGANIZATION_ID,
    tierId: "site-plus",
    craftedPages: 7,
    sections: 28,
    uniqueLayouts: 4,
    contentWords: 2800,
    suppliedMedia: 18,
    scopeStatement:
      "Build the approved seven-page custom website from the delivered assessment.",
    targetCompletionDate: "2026-09-15",
    expiresAt: "2026-08-20T18:00:00.000Z"
  };
  const issued = await api.fetch(request({
    body: issueBody,
    method: "POST",
    path:
      `/api/v1/operator/custom-services/assessment-jobs/${JOB_ID}` +
      "/custom-build-quote"
  }));
  assert.equal(issued.status, 201);
  assert.deepEqual(await issued.json(), issuedReceipt);

  const voidBody = {
    organizationId: ORGANIZATION_ID,
    reason: "Customer requested a corrected project scope before checkout."
  };
  const voided = await api.fetch(request({
    body: voidBody,
    method: "POST",
    path:
      "/api/v1/operator/custom-services/custom-build-quotes/" +
      `${CUSTOM_BUILD_QUOTE_ID}/void`
  }));
  assert.equal(voided.status, 200);
  assert.deepEqual(await voided.json(), voidedReceipt);

  assert.deepEqual(calls, [
    { action: "list", actor: { userId: OPERATOR_ID } },
    {
      action: "issue",
      actor: { userId: OPERATOR_ID },
      jobId: JOB_ID,
      input: {
        ...issueBody,
        commandId: "owner-quote-command-1"
      }
    },
    {
      action: "void",
      actor: { userId: OPERATOR_ID },
      quoteId: CUSTOM_BUILD_QUOTE_ID,
      input: {
        ...voidBody,
        commandId: "owner-quote-command-1"
      }
    }
  ]);

  const monetary = await api.fetch(request({
    body: { ...issueBody, amountMinor: 1 },
    method: "POST",
    path:
      `/api/v1/operator/custom-services/assessment-jobs/${JOB_ID}` +
      "/custom-build-quote"
  }));
  assert.equal(monetary.status, 400);
  assert.equal(
    (await monetary.json()).error.code,
    "INVALID_CUSTOM_BUILD_QUOTE"
  );
  assert.equal(calls.length, 3);

  const signedOut = await api.fetch(request({
    path: listPath,
    signedIn: false
  }));
  assert.equal(signedOut.status, 401);
  assert.equal(calls.length, 3);
});

test("owner paid Custom build jobs are private, authenticated, and read-only", async () => {
  const calls = [];
  const jobs = {
    schema: "sitesourcery.custom-services-owner-custom-build-jobs/v1",
    hasMore: false,
    nextCursor: null,
    jobs: []
  };
  const api = createHostedApi(service(), {
    customServicesCustomBuildWork: {
      async listJobs(actor, cursor) {
        calls.push({ actor: structuredClone(actor), cursor });
        return jobs;
      }
    },
    requestIds: {
      next() {
        return "request_custom_build_work_owner_1";
      }
    }
  });
  const path =
    "/api/v1/operator/custom-services/custom-build-jobs";
  const response = await api.fetch(request({ path }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), jobs);
  assert.deepEqual(calls, [{
    actor: { userId: OPERATOR_ID },
    cursor: null
  }]);

  const cursor =
    "2026-09-15|2026-08-06T14:30:00.000Z|" + JOB_ID;
  const continued = await api.fetch(request({
    path: path + "?cursor=" + encodeURIComponent(cursor)
  }));
  assert.equal(continued.status, 200);
  assert.deepEqual(calls[1], {
    actor: { userId: OPERATOR_ID },
    cursor
  });

  const signedOut = await api.fetch(request({ path, signedIn: false }));
  assert.equal(signedOut.status, 401);
  assert.equal(calls.length, 2);

  const invalidCursor = await api.fetch(request({
    path: path + "?cursor=bad&extra=1"
  }));
  assert.equal(invalidCursor.status, 400);
  assert.equal(calls.length, 2);

  const writeAttempt = await api.fetch(request({
    body: {},
    method: "POST",
    path
  }));
  assert.equal(writeAttempt.status, 404);
  assert.equal(calls.length, 2);
});

test("owner Custom-build change payments expose only exact reads and uncertain-Checkout reconciliation", async () => {
  const calls = [];
  const payments = {
    schema: "sitesourcery.custom-build-change-payments-owner/v1",
    organizationId: ORGANIZATION_ID,
    jobId: JOB_ID,
    payments: []
  };
  const reconciled = {
    schema: "sitesourcery.custom-build-change-checkout/v1",
    state: "ready"
  };
  const api = createHostedApi(service(), {
    customServicesCustomBuildChangePayment: {
      async readOwnerPayments(actor, jobId, organizationId) {
        calls.push({
          action: "read",
          actor,
          jobId,
          organizationId
        });
        return payments;
      },
      async reconcileCheckoutCreation(actor, jobId, input) {
        calls.push({ action: "reconcile", actor, jobId, input });
        return reconciled;
      }
    }
  });
  const root =
    `/api/v1/operator/custom-services/custom-build-jobs/${JOB_ID}`;
  const readPath =
    `${root}/change-payments?organizationId=${ORGANIZATION_ID}`;
  const reconcilePath =
    `${root}/change-payments/${ATTEMPT_ID}/checkout-reconciliation`;

  const read = await api.fetch(request({ path: readPath }));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), payments);

  const reconcile = await api.fetch(request({
    body: {
      commandId: "owner-quote-command-1",
      organizationId: ORGANIZATION_ID
    },
    method: "POST",
    path: reconcilePath
  }));
  assert.equal(reconcile.status, 200);
  assert.deepEqual(await reconcile.json(), reconciled);
  const replay = await api.fetch(request({
    body: {
      commandId: "owner-quote-command-1",
      organizationId: ORGANIZATION_ID
    },
    method: "POST",
    path: reconcilePath
  }));
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), reconciled);
  const actor = { userId: OPERATOR_ID };
  assert.deepEqual(calls, [
    {
      action: "read",
      actor,
      jobId: JOB_ID,
      organizationId: ORGANIZATION_ID
    },
    {
      action: "reconcile",
      actor,
      jobId: JOB_ID,
      input: {
        attemptId: ATTEMPT_ID,
        commandId: "owner-quote-command-1",
        organizationId: ORGANIZATION_ID
      }
    },
    {
      action: "reconcile",
      actor,
      jobId: JOB_ID,
      input: {
        attemptId: ATTEMPT_ID,
        commandId: "owner-quote-command-1",
        organizationId: ORGANIZATION_ID
      }
    }
  ]);

  for (const path of [
    `${root}/change-payments`,
    `${readPath}&organizationId=${ORGANIZATION_ID}`,
    `${readPath}&state=paid`
  ]) {
    const response = await api.fetch(request({ path }));
    assert.equal(response.status, 400);
    assert.equal(
      (await response.json()).error.code,
      "INVALID_CUSTOM_BUILD_CHANGE_PAYMENT_INPUT"
    );
  }

  for (const expanded of [
    { amountMinor: 12_500 },
    { taxMinor: 1 },
    { provider: "stripe" },
    { state: "paid" },
    { markPaid: true },
    { checkoutSessionId: "cs_browser_claim" }
  ]) {
    const response = await api.fetch(request({
      body: {
        commandId: "owner-quote-command-1",
        organizationId: ORGANIZATION_ID,
        ...expanded
      },
      method: "POST",
      path: reconcilePath
    }));
    assert.equal(response.status, 400);
    assert.equal(
      (await response.json()).error.code,
      "INVALID_CUSTOM_BUILD_CHANGE_PAYMENT_INPUT"
    );
  }

  for (const body of [
    { organizationId: ORGANIZATION_ID },
    {
      commandId: "body-command-does-not-match-header",
      organizationId: ORGANIZATION_ID
    }
  ]) {
    const response = await api.fetch(request({
      body,
      idempotencyKey: "owner-quote-command-1",
      method: "POST",
      path: reconcilePath
    }));
    assert.equal(response.status, 400);
    assert.equal(
      (await response.json()).error.code,
      "INVALID_CUSTOM_BUILD_CHANGE_PAYMENT_INPUT"
    );
  }

  const wrongWriteQuery = await api.fetch(request({
    body: {
      commandId: "owner-quote-command-1",
      organizationId: ORGANIZATION_ID
    },
    method: "POST",
    path: `${reconcilePath}?force=true`
  }));
  assert.equal(wrongWriteQuery.status, 400);

  const signedOutRead = await api.fetch(request({
    path: readPath,
    signedIn: false
  }));
  assert.equal(signedOutRead.status, 401);
  const signedOutWrite = await api.fetch(request({
    body: {
      commandId: "owner-quote-command-1",
      organizationId: ORGANIZATION_ID
    },
    method: "POST",
    path: reconcilePath,
    signedIn: false
  }));
  assert.equal(signedOutWrite.status, 401);

  const customerCrossRoute = await api.fetch(request({
    path:
      `/api/v1/projects/${CASE_ID}/custom-services/custom-build-change-invoice`
  }));
  assert.equal(customerCrossRoute.status, 503);
  assert.equal(
    (await customerCrossRoute.json()).error.code,
    "CUSTOM_BUILD_CHANGE_PAYMENT_HELD"
  );
  assert.equal(calls.length, 3);
});

test("owner Custom-build final payments expose exact reads and command-bound uncertain-Checkout reconciliation", async () => {
  const calls = [];
  const payments = {
    schema: "sitesourcery.custom-build-final-payments-owner/v1",
    organizationId: ORGANIZATION_ID,
    jobId: JOB_ID,
    payments: []
  };
  const reconciled = {
    schema: "sitesourcery.custom-build-final-checkout/v1",
    state: "ready"
  };
  const api = createHostedApi(service(), {
    customServicesCustomBuildFinalPayment: {
      async readOwnerFinalPayments(actor, jobId, organizationId) {
        calls.push({ action: "read", actor, jobId, organizationId });
        return payments;
      },
      async reconcileCheckoutCreation(actor, jobId, input) {
        calls.push({ action: "reconcile", actor, jobId, input });
        return reconciled;
      }
    }
  });
  const root =
    `/api/v1/operator/custom-services/custom-build-jobs/${JOB_ID}`;
  const readPath =
    `${root}/final-handoff?organizationId=${ORGANIZATION_ID}`;
  const reconcilePath =
    `${root}/final-payments/${ATTEMPT_ID}/checkout-reconciliation`;

  const read = await api.fetch(request({ path: readPath }));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), payments);

  for (let replay = 0; replay < 2; replay += 1) {
    const response = await api.fetch(request({
      body: {
        commandId: "owner-quote-command-1",
        organizationId: ORGANIZATION_ID
      },
      method: "POST",
      path: reconcilePath
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), reconciled);
  }

  const actor = { userId: OPERATOR_ID };
  assert.deepEqual(calls, [
    {
      action: "read",
      actor,
      jobId: JOB_ID,
      organizationId: ORGANIZATION_ID
    },
    {
      action: "reconcile",
      actor,
      jobId: JOB_ID,
      input: {
        attemptId: ATTEMPT_ID,
        commandId: "owner-quote-command-1",
        organizationId: ORGANIZATION_ID
      }
    },
    {
      action: "reconcile",
      actor,
      jobId: JOB_ID,
      input: {
        attemptId: ATTEMPT_ID,
        commandId: "owner-quote-command-1",
        organizationId: ORGANIZATION_ID
      }
    }
  ]);

  for (const path of [
    `${root}/final-handoff`,
    `${readPath}&organizationId=${ORGANIZATION_ID}`,
    `${readPath}&state=paid`
  ]) {
    const response = await api.fetch(request({ path }));
    assert.equal(response.status, 400);
    assert.equal(
      (await response.json()).error.code,
      "INVALID_CUSTOM_BUILD_FINAL_PAYMENT_INPUT"
    );
  }

  for (const expanded of [
    { amountMinor: 50_000 },
    { changeAmountMinor: 12_500 },
    { assessmentCreditMinor: 20_000 },
    { provider: "stripe" },
    { state: "paid" },
    { markPaid: true },
    { checkoutSessionId: "cs_browser_claim" }
  ]) {
    const response = await api.fetch(request({
      body: {
        commandId: "owner-quote-command-1",
        organizationId: ORGANIZATION_ID,
        ...expanded
      },
      method: "POST",
      path: reconcilePath
    }));
    assert.equal(response.status, 400);
    assert.equal(
      (await response.json()).error.code,
      "INVALID_CUSTOM_BUILD_FINAL_PAYMENT_INPUT"
    );
  }

  for (const body of [
    { organizationId: ORGANIZATION_ID },
    {
      commandId: "body-command-does-not-match-header",
      organizationId: ORGANIZATION_ID
    }
  ]) {
    const response = await api.fetch(request({
      body,
      idempotencyKey: "owner-quote-command-1",
      method: "POST",
      path: reconcilePath
    }));
    assert.equal(response.status, 400);
    assert.equal(
      (await response.json()).error.code,
      "INVALID_CUSTOM_BUILD_FINAL_PAYMENT_INPUT"
    );
  }

  const wrongWriteQuery = await api.fetch(request({
    body: {
      commandId: "owner-quote-command-1",
      organizationId: ORGANIZATION_ID
    },
    method: "POST",
    path: `${reconcilePath}?force=true`
  }));
  assert.equal(wrongWriteQuery.status, 400);

  const signedOutRead = await api.fetch(request({
    path: readPath,
    signedIn: false
  }));
  assert.equal(signedOutRead.status, 401);
  const signedOutWrite = await api.fetch(request({
    body: {
      commandId: "owner-quote-command-1",
      organizationId: ORGANIZATION_ID
    },
    method: "POST",
    path: reconcilePath,
    signedIn: false
  }));
  assert.equal(signedOutWrite.status, 401);

  const customerCrossRoute = await api.fetch(request({
    path:
      `/api/v1/projects/${CASE_ID}/custom-services/custom-build-final-handoff`
  }));
  assert.equal(customerCrossRoute.status, 503);
  assert.equal(
    (await customerCrossRoute.json()).error.code,
    "CUSTOM_BUILD_FINAL_PAYMENT_HELD"
  );
  assert.equal(calls.length, 3);
});

test("owner Custom-build progress routes bind exact job, organization, updates, and requests", async () => {
  const calls = [];
  const progress = {
    schema: "sitesourcery.custom-build-progress/v1",
    state: "building",
    revision: 1
  };
  const api = createHostedApi(service(), {
    customServicesCustomBuildProgress: {
      async readOwnerProgress(actor, jobId, organizationId) {
        calls.push({ action: "read", actor, jobId, organizationId });
        return progress;
      },
      async recordProgress(actor, jobId, input) {
        calls.push({ action: "progress", actor, jobId, input });
        return { ...progress, revision: 2 };
      },
      async openRequest(actor, jobId, input) {
        calls.push({ action: "request", actor, jobId, input });
        return { ...progress, state: "action_needed", revision: 3 };
      },
      async resolveRequest(actor, jobId, requestId, input) {
        calls.push({ action: "resolve", actor, jobId, requestId, input });
        return { ...progress, state: "building", revision: 4 };
      }
    }
  });
  const root =
    `/api/v1/operator/custom-services/custom-build-jobs/${JOB_ID}`;

  const read = await api.fetch(request({
    path: `${root}/progress?organizationId=${ORGANIZATION_ID}`
  }));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), progress);

  const progressBody = {
    customerSummary: "The approved homepage structure is now in place.",
    expectedRevision: 1,
    milestones: {
      content: "in_progress",
      design: "in_progress",
      launch: "not_started",
      structure: "complete"
    },
    nextStep: "Apply the approved copy and check the phone layout.",
    organizationId: ORGANIZATION_ID,
    stage: "building"
  };
  const updated = await api.fetch(request({
    body: progressBody,
    method: "POST",
    path: `${root}/progress`
  }));
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).revision, 2);

  const requestBody = {
    access: null,
    customerMessage: "Choose which approved About-page paragraph should be used.",
    expectedProgressRevision: 2,
    organizationId: ORGANIZATION_ID,
    requestKind: "customer_decision",
    safeInstructions: "Reply with first or second paragraph. Do not send passwords.",
    targetDateImpact: "under_review",
    title: "Choose the About-page paragraph"
  };
  const opened = await api.fetch(request({
    body: requestBody,
    method: "POST",
    path: `${root}/requests`
  }));
  assert.equal(opened.status, 200);
  assert.equal((await opened.json()).state, "action_needed");

  const resolutionBody = {
    expectedRevision: 1,
    organizationId: ORGANIZATION_ID,
    resolutionNote: "Customer selected the second approved paragraph.",
    state: "resolved"
  };
  const resolved = await api.fetch(request({
    body: resolutionBody,
    method: "POST",
    path: `${root}/requests/${CUSTOM_BUILD_REQUEST_ID}/resolution`
  }));
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).revision, 4);

  const actor = { userId: OPERATOR_ID };
  assert.deepEqual(calls, [
    {
      action: "read",
      actor,
      jobId: JOB_ID,
      organizationId: ORGANIZATION_ID
    },
    {
      action: "progress",
      actor,
      jobId: JOB_ID,
      input: { ...progressBody, commandId: "owner-quote-command-1" }
    },
    {
      action: "request",
      actor,
      jobId: JOB_ID,
      input: { ...requestBody, commandId: "owner-quote-command-1" }
    },
    {
      action: "resolve",
      actor,
      jobId: JOB_ID,
      requestId: CUSTOM_BUILD_REQUEST_ID,
      input: { ...resolutionBody, commandId: "owner-quote-command-1" }
    }
  ]);

  const expanded = await api.fetch(request({
    body: { ...progressBody, progressPercent: 80 },
    method: "POST",
    path: `${root}/progress`
  }));
  assert.equal(expanded.status, 400);
  assert.equal(
    (await expanded.json()).error.code,
    "INVALID_CUSTOM_BUILD_PROGRESS_INPUT"
  );
  assert.equal(calls.length, 4);
});

test("owner Custom-build change/completion routes bind exact jobs, commands, and statuses", async () => {
  const calls = [];
  const changeOrderId =
    "60000000-0000-4000-8000-000000000002";
  const secondEvidenceId =
    "50000000-0000-4000-8000-000000000002";
  const snapshot = {
    schema: "sitesourcery.custom-build-change-completion/v1",
    state: "building"
  };
  const api = createHostedApi(service(), {
    customServicesCustomBuildChangeCompletion: {
      async readOwner(actor, jobId, organizationId) {
        calls.push({ action: "read", actor, jobId, organizationId });
        return snapshot;
      },
      async issueChangeOrder(actor, jobId, input) {
        calls.push({ action: "issue", actor, jobId, input });
        return { ...snapshot, state: "change_order_review" };
      },
      async voidChangeOrder(actor, jobId, selectedChangeOrderId, input) {
        calls.push({
          action: "void",
          actor,
          jobId,
          changeOrderId: selectedChangeOrderId,
          input
        });
        return { ...snapshot, state: "building" };
      },
      async expireChangeOrder(actor, jobId, selectedChangeOrderId, input) {
        calls.push({
          action: "expire",
          actor,
          jobId,
          changeOrderId: selectedChangeOrderId,
          input
        });
        return { ...snapshot, state: "building" };
      },
      async uploadEvidence(actor, jobId, input) {
        calls.push({ action: "evidence", actor, jobId, input });
        return { evidenceId: EVIDENCE_ID };
      },
      async recordCompletion(actor, jobId, input) {
        calls.push({ action: "completion", actor, jobId, input });
        return { ...snapshot, state: "ready_for_final_payment" };
      }
    }
  });
  const root =
    `/api/v1/operator/custom-services/custom-build-jobs/${JOB_ID}`;

  const read = await api.fetch(request({
    path: `${root}/change-completion?organizationId=${ORGANIZATION_ID}`
  }));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), snapshot);

  const issueBody = {
    addedScope: "Add the approved events page and matching navigation link.",
    expiresAt: "2026-08-15T12:00:00.000Z",
    organizationId: ORGANIZATION_ID,
    targetCompletionDate: "2026-09-15",
    unitCount: 2
  };
  const issued = await api.fetch(request({
    body: issueBody,
    method: "POST",
    path: `${root}/change-orders`
  }));
  assert.equal(issued.status, 201);
  assert.equal((await issued.json()).state, "change_order_review");

  const voidBody = {
    expectedQuoteDigest: "a".repeat(64),
    organizationId: ORGANIZATION_ID,
    reason: "The customer requested a replacement change order instead."
  };
  const voided = await api.fetch(request({
    body: voidBody,
    method: "POST",
    path: `${root}/change-orders/${changeOrderId}/void`
  }));
  assert.equal(voided.status, 200);

  const expirationBody = {
    expectedQuoteDigest: "a".repeat(64),
    organizationId: ORGANIZATION_ID
  };
  const expired = await api.fetch(request({
    body: expirationBody,
    method: "POST",
    path: `${root}/change-orders/${changeOrderId}/expiration`
  }));
  assert.equal(expired.status, 200);

  const evidenceBody = {
    accessibleDescription: "Desktop completion view of the approved homepage.",
    dataBase64: "cG5n",
    mediaType: "image/png",
    organizationId: ORGANIZATION_ID,
    viewport: "desktop"
  };
  const evidence = await api.fetch(request({
    body: evidenceBody,
    method: "POST",
    path: `${root}/completion-evidence`
  }));
  assert.equal(evidence.status, 201);

  const completionBody = {
    checks: {
      accessibilityBasics: true,
      contactActions: true,
      desktop: true,
      links: true,
      phone: true,
      scope: true
    },
    customerSummary:
      "The approved scope is complete and the documented checks passed.",
    evidenceIds: [EVIDENCE_ID, secondEvidenceId],
    organizationId: ORGANIZATION_ID
  };
  const completion = await api.fetch(request({
    body: completionBody,
    method: "POST",
    path: `${root}/completion`
  }));
  assert.equal(completion.status, 201);
  assert.equal((await completion.json()).state, "ready_for_final_payment");

  const actor = { userId: OPERATOR_ID };
  const commandId = "owner-quote-command-1";
  assert.deepEqual(calls, [
    { action: "read", actor, jobId: JOB_ID, organizationId: ORGANIZATION_ID },
    {
      action: "issue",
      actor,
      jobId: JOB_ID,
      input: { ...issueBody, commandId }
    },
    {
      action: "void",
      actor,
      jobId: JOB_ID,
      changeOrderId,
      input: { ...voidBody, commandId }
    },
    {
      action: "expire",
      actor,
      jobId: JOB_ID,
      changeOrderId,
      input: { ...expirationBody, commandId }
    },
    {
      action: "evidence",
      actor,
      jobId: JOB_ID,
      input: { ...evidenceBody, commandId }
    },
    {
      action: "completion",
      actor,
      jobId: JOB_ID,
      input: { ...completionBody, commandId }
    }
  ]);

  const signedOut = await api.fetch(request({
    path: `${root}/change-completion?organizationId=${ORGANIZATION_ID}`,
    signedIn: false
  }));
  assert.equal(signedOut.status, 401);
  assert.equal((await signedOut.json()).error.code, "AUTHENTICATION_REQUIRED");

  const wrongQuery = await api.fetch(request({
    path:
      `${root}/change-completion?organizationId=${ORGANIZATION_ID}&extra=1`
  }));
  assert.equal(wrongQuery.status, 400);
  assert.equal(
    (await wrongQuery.json()).error.code,
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT"
  );

  const expanded = await api.fetch(request({
    body: { ...issueBody, amountMinor: 1 },
    method: "POST",
    path: `${root}/change-orders`
  }));
  assert.equal(expanded.status, 400);
  assert.equal(
    (await expanded.json()).error.code,
    "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT"
  );
  assert.equal(calls.length, 6);
});

test("default owner Custom-build change/completion routes fail closed", async () => {
  const api = createHostedApi(service());
  const response = await api.fetch(request({
    path:
      `/api/v1/operator/custom-services/custom-build-jobs/${JOB_ID}` +
      `/change-completion?organizationId=${ORGANIZATION_ID}`
  }));
  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).error.code,
    "CUSTOM_BUILD_CHANGE_COMPLETION_HELD"
  );

  const changePayments = await api.fetch(request({
    path:
      `/api/v1/operator/custom-services/custom-build-jobs/${JOB_ID}` +
      `/change-payments?organizationId=${ORGANIZATION_ID}`
  }));
  assert.equal(changePayments.status, 503);
  assert.equal(
    (await changePayments.json()).error.code,
    "CUSTOM_BUILD_CHANGE_PAYMENT_HELD"
  );
});

test("production composes PostgreSQL owner quote, assessment, and paid-build boundaries", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /createPostgresCustomServicesOwner\(\{ authority \}\)/u
  );
  assert.match(
    source,
    /createHostedApi\(service,\s*\{[\s\S]*customServicesOwner,/u
  );
  assert.match(
    source,
    /createPostgresCustomServicesAssessmentWork\(\{[\s\S]*authority,[\s\S]*clock:\s*commerceV2\.clock/u
  );
  assert.match(
    source,
    /createHostedApi\(service,\s*\{[\s\S]*customServicesAssessmentWork,/u
  );
  assert.match(
    source,
    /const customServicesCustomBuild\s*=\s*createPostgresCustomServicesCustomBuild\(\{[\s\S]*authority,[\s\S]*randomUUID:/u
  );
  assert.match(
    source,
    /const customServicesCustomBuildWork\s*=\s*createPostgresCustomServicesCustomBuildWork\(\{ authority \}\)/u
  );
  assert.match(
    source,
    /await customServicesCustomBuildWork\.readiness\(\)/u
  );
  assert.match(
    source,
    /createHostedApi\(service,\s*\{[\s\S]*customServicesCustomBuildWork,/u
  );
  assert.match(
    source,
    /const customServicesCustomBuildProgress\s*=\s*createPostgresCustomServicesCustomBuildProgress\(\{\s*authority\s*\}\)/u
  );
  assert.match(
    source,
    /await customServicesCustomBuildProgress\.readiness\(\)/u
  );
  assert.match(
    source,
    /createHostedApi\(service,\s*\{[\s\S]*customServicesCustomBuildProgress,/u
  );
});
