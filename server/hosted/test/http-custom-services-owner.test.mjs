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
const EVIDENCE_ID =
  "50000000-0000-4000-8000-000000000001";
const CUSTOM_BUILD_QUOTE_ID =
  "60000000-0000-4000-8000-000000000001";
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
  method = "GET",
  path = "/api/v1/operator/custom-services/assessment-requests",
  signedIn = true
} = {}) {
  const headers = signedIn
    ? { Cookie: `ss_session=${SESSION_TOKEN}` }
    : {};
  if (method !== "GET") {
    headers.Cookie += `${headers.Cookie ? "; " : ""}ss_csrf=${"c".repeat(32)}`;
    headers.Origin = ORIGIN;
    headers["X-CSRF-Token"] = "c".repeat(32);
    headers["Idempotency-Key"] = "owner-quote-command-1";
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

test("production composes the PostgreSQL owner quote boundary", async () => {
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
    /const customServicesCustomBuild\s*=\s*createHeldCustomServicesCustomBuild\(\)/u
  );
  assert.doesNotMatch(
    source,
    /createPostgresCustomServicesCustomBuild\(/u
  );
});
