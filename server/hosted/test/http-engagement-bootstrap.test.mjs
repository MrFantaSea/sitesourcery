import assert from "node:assert/strict";
import test from "node:test";

import { createHostedApi } from "../http.mjs";
import { digest } from "../security.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION_TOKEN = "session_engagement_operator";
const OPERATOR_ID = "10000000-0000-4000-8000-000000000001";
const CLAIM_SESSION = "s".repeat(43);

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
  idempotencyKey = "engagement-http-command-001",
  path,
  signedIn = false,
  userAgent = "Engagement Contract Browser/1.0"
}) {
  const cookies = [
    signedIn ? `ss_session=${SESSION_TOKEN}` : null,
    `ss_csrf=${"c".repeat(32)}`
  ].filter(Boolean).join("; ");
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      Cookie: cookies,
      Origin: ORIGIN,
      "X-CSRF-Token": "c".repeat(32),
      "Idempotency-Key": idempotencyKey,
      "Content-Type": "application/json",
      "User-Agent": userAgent
    },
    body: JSON.stringify(body)
  });
}

function issueBody() {
  return {
    customerEmail: "customer@example.test",
    customerName: "Customer Person",
    organizationId: null,
    organizationName: "Customer Company",
    projectName: "Canonical Customer Site",
    provenance: "direct_custom_inquiry",
    site: { kind: "new_site" },
    sourceAssessmentReportId: null
  };
}

function claimBody() {
  return {
    legalAcceptance: {
      schema: "sitesourcery.project-legal-acceptance/v5",
      acceptanceStatement:
        "accepted_exact_project_terms_and_acknowledged_privacy",
      authorityDigest: "a".repeat(64),
      documents: []
    },
    password: "correct horse battery staple",
    token: "t".repeat(43)
  };
}

test("operator issue and sessionless claim routes bind exact transport authority", async () => {
  const calls = [];
  const api = createHostedApi(service(), {
    engagementBootstrap: {
      async issueInvitation(actor, input) {
        calls.push({ action: "issue", actor, input });
        return {
          schema: "sitesourcery.customer-engagement-invitation/v1",
          invitationId: "invitation-1",
          claimToken: "t".repeat(43)
        };
      },
      async claimInvitation(input) {
        calls.push({ action: "claim", input });
        return {
          schema: "sitesourcery.customer-engagement-claim/v1",
          engagementId: "engagement-1",
          sessionToken: CLAIM_SESSION,
          session: { tokenDigest: "private" }
        };
      }
    },
    requestIds: {
      next() {
        return "request_engagement_http_1";
      }
    }
  });

  const issued = await api.fetch(request({
    body: issueBody(),
    path: "/api/v1/operator/engagement-invitations",
    signedIn: true
  }));
  assert.equal(issued.status, 201);
  assert.deepEqual(await issued.json(), {
    schema: "sitesourcery.customer-engagement-invitation/v1",
    invitationId: "invitation-1",
    claimToken: "t".repeat(43)
  });

  const claimed = await api.fetch(request({
    body: claimBody(),
    path: "/api/v1/auth/engagement-claim"
  }));
  assert.equal(claimed.status, 201);
  assert.deepEqual(await claimed.json(), {
    schema: "sitesourcery.customer-engagement-claim/v1",
    engagementId: "engagement-1"
  });
  assert.match(
    claimed.headers.get("set-cookie"),
    new RegExp(`^ss_session=${CLAIM_SESSION};`, "u")
  );
  assert.deepEqual(calls, [
    {
      action: "issue",
      actor: { userId: OPERATOR_ID },
      input: {
        ...issueBody(),
        commandId: "engagement-http-command-001"
      }
    },
    {
      action: "claim",
      input: {
        ...claimBody(),
        commandId: "engagement-http-command-001",
        userAgentDigest: digest("Engagement Contract Browser/1.0")
      }
    }
  ]);
});

test("operator issue requires authentication and claim rejects client-authored evidence", async () => {
  let calls = 0;
  const api = createHostedApi(service(), {
    engagementBootstrap: {
      issueInvitation() {
        calls += 1;
      },
      claimInvitation() {
        calls += 1;
      }
    }
  });
  const signedOut = await api.fetch(request({
    body: issueBody(),
    path: "/api/v1/operator/engagement-invitations"
  }));
  assert.equal(signedOut.status, 401);
  assert.equal((await signedOut.json()).error.code, "AUTHENTICATION_REQUIRED");

  const forged = await api.fetch(request({
    body: { ...claimBody(), userAgentDigest: "f".repeat(64) },
    path: "/api/v1/auth/engagement-claim"
  }));
  assert.equal(forged.status, 400);
  assert.equal((await forged.json()).error.code, "INVALID_ENGAGEMENT_CLAIM");
  assert.equal(calls, 0);
});

test("uncomposed engagement routes fail closed without provider effects", async () => {
  const api = createHostedApi(service());
  const issued = await api.fetch(request({
    body: issueBody(),
    path: "/api/v1/operator/engagement-invitations",
    signedIn: true
  }));
  assert.equal(issued.status, 503);
  assert.equal((await issued.json()).error.code, "ENGAGEMENT_BOOTSTRAP_HELD");

  const claimed = await api.fetch(request({
    body: claimBody(),
    path: "/api/v1/auth/engagement-claim"
  }));
  assert.equal(claimed.status, 503);
  assert.equal((await claimed.json()).error.code, "ENGAGEMENT_BOOTSTRAP_HELD");
});
