import assert from "node:assert/strict";
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
});
