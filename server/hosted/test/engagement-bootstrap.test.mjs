import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldHostedEngagementBootstrap,
  createHostedEngagementBootstrap,
  ENGAGEMENT_HTTP_ROUTES,
  validateEngagementInvitationIssue
} from "../engagement-bootstrap.mjs";
import {
  createProjectLegalAuthorityV5Fixture
} from "../project-legal-authority.mjs";
import { canonicalJson, digest } from "../security.mjs";

const OPERATOR_ID = "10000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const NOW = "2026-08-10T12:00:00.000Z";

function authority() {
  const privacyV5 = {
    version: "SS-HOSTED-PRIVACY-TEST-V5",
    contentDigest: "a".repeat(64),
    contentUri: "https://example.test/privacy/v5",
    effectiveAt: "2026-08-10T00:00:00.000Z",
    byteCount: 1234,
    artifactUri: "https://example.test/privacy/v5.html"
  };
  const websiteTermsV5 = {
    version: "SS-HOSTED-WEBSITE-TERMS-TEST-V5",
    contentDigest: "b".repeat(64),
    contentUri: "https://example.test/terms/v5",
    effectiveAt: privacyV5.effectiveAt,
    byteCount: 4321,
    artifactUri: "https://example.test/terms/v5.html"
  };
  const documents = [
    {
      kind: "privacy",
      version: privacyV5.version,
      contentDigest: privacyV5.contentDigest,
      contentUri: privacyV5.contentUri,
      effectiveAt: privacyV5.effectiveAt
    },
    {
      kind: "product",
      version: websiteTermsV5.version,
      contentDigest: websiteTermsV5.contentDigest,
      contentUri: "https://sitesourcery.com/legal/website-terms/#self-service",
      effectiveAt: websiteTermsV5.effectiveAt
    },
    {
      kind: "website",
      version: websiteTermsV5.version,
      contentDigest: websiteTermsV5.contentDigest,
      contentUri: "https://sitesourcery.com/legal/website-terms/",
      effectiveAt: websiteTermsV5.effectiveAt
    }
  ];
  return createProjectLegalAuthorityV5Fixture({
    privacyV5,
    websiteTermsV5,
    authorityDigest: digest(canonicalJson({
      documents,
      schema: "sitesourcery.project-legal-authority/v5"
    }))
  });
}

function issue(overrides = {}) {
  return {
    commandId: "engagement-issue-001",
    customerEmail: "customer@example.test",
    customerName: "Customer Person",
    organizationId: null,
    organizationName: "Customer Company",
    projectName: "Canonical Customer Site",
    provenance: "direct_custom_inquiry",
    site: { kind: "new_site" },
    sourceAssessmentReportId: null,
    ...overrides
  };
}

function acceptance(selected) {
  return {
    schema: selected.acceptanceSchema,
    acceptanceStatement: selected.acceptanceStatement,
    authorityDigest: selected.authorityDigest,
    documents: selected.documents.map((document) => ({ ...document }))
  };
}

test("engagement HTTP contracts are exact, sessionless only at claim, and carry no commercial arithmetic", () => {
  assert.deepEqual(ENGAGEMENT_HTTP_ROUTES, {
    issue: {
      method: "POST",
      path: "/api/v1/operator/engagement-invitations",
      session: "operator",
      bodyKeys: [
        "commandId",
        "customerEmail",
        "customerName",
        "organizationId",
        "organizationName",
        "projectName",
        "provenance",
        "site",
        "sourceAssessmentReportId"
      ]
    },
    claim: {
      method: "POST",
      path: "/api/v1/auth/engagement-claim",
      session: "sessionless",
      bodyKeys: [
        "commandId",
        "legalAcceptance",
        "password",
        "token"
      ],
      boundaryInputKeys: [
        "commandId",
        "legalAcceptance",
        "password",
        "token",
        "userAgentDigest"
      ]
    }
  });
  assert.equal(
    JSON.stringify(ENGAGEMENT_HTTP_ROUTES).includes("credit"),
    false
  );
  assert.equal(
    JSON.stringify(ENGAGEMENT_HTTP_ROUTES).includes("amount"),
    false
  );
});

test("issue validation admits direct and delivered-assessment provenance without a preview", () => {
  assert.deepEqual(
    validateEngagementInvitationIssue(issue()).site,
    { kind: "new_site", publicUrl: null, hostname: null }
  );
  const successor = validateEngagementInvitationIssue(issue({
    organizationId: ORGANIZATION_ID,
    organizationName: null,
    provenance: "delivered_assessment_successor",
    site: {
      kind: "external_site",
      publicUrl: "https://customer.example.test/"
    },
    sourceAssessmentReportId:
      "30000000-0000-4000-8000-000000000001"
  }));
  assert.equal(successor.site.hostname, "customer.example.test");
  assert.equal(Object.hasOwn(successor, "previewId"), false);

  assert.throws(
    () => validateEngagementInvitationIssue(issue({
      site: {
        kind: "external_site",
        publicUrl: "https://customer.example.test/path"
      }
    })),
    (error) => error.code === "INVALID_ENGAGEMENT_INPUT"
  );
  assert.throws(
    () => validateEngagementInvitationIssue({ ...issue(), amountMinor: 1 }),
    (error) => error.code === "INVALID_ENGAGEMENT_INPUT"
  );
});

test("invitation and session tokens are deterministic per command while repositories receive only token digests", async () => {
  const selectedAuthority = authority();
  const issueCalls = [];
  const claimCalls = [];
  let uuidSequence = 0;
  const boundary = createHostedEngagementBootstrap({
    repository: {
      async readiness() {
        return { ready: true };
      },
      async issueInvitation(input) {
        issueCalls.push(input);
        return {
          invitationId: input.invitationId,
          expiresAt: input.expiresAt,
          replayed: issueCalls.length > 1
        };
      },
      async claimInvitation(input) {
        claimCalls.push(input);
        return {
          engagementId: input.engagementId,
          invitationId: "invitation",
          replayed: claimCalls.length > 1
        };
      }
    },
    legalAuthority: selectedAuthority,
    tokenSecret: Buffer.alloc(32, 7),
    clock: () => new Date(NOW),
    randomUUID: () => {
      uuidSequence += 1;
      return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, "0")}`;
    }
  });
  assert.equal((await boundary.readiness()).state, "ready");
  const first = await boundary.issueInvitation(
    { userId: OPERATOR_ID },
    issue()
  );
  const second = await boundary.issueInvitation(
    { userId: OPERATOR_ID },
    issue()
  );
  assert.equal(first.claimToken, second.claimToken);
  assert.match(first.claimToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(issueCalls[0].tokenDigest, digest(first.claimToken));
  assert.equal(Object.hasOwn(issueCalls[0], "claimToken"), false);
  assert.equal(issueCalls[0].expiresAt, "2026-08-13T12:00:00.000Z");

  const claimInput = {
    commandId: "engagement-claim-001",
    legalAcceptance: acceptance(selectedAuthority),
    password: "correct horse battery staple",
    token: first.claimToken,
    userAgentDigest: "c".repeat(64)
  };
  const claimed = await boundary.claimInvitation(claimInput);
  const replayed = await boundary.claimInvitation(claimInput);
  assert.equal(claimed.sessionToken, replayed.sessionToken);
  assert.equal(claimCalls[0].tokenDigest, digest(first.claimToken));
  assert.equal(
    claimCalls[0].sessionToken,
    claimed.sessionToken
  );
  assert.equal(Object.hasOwn(claimCalls[0], "token"), false);
});

test("claim failures expose one enumeration-safe public result", async () => {
  const selectedAuthority = authority();
  const boundary = createHostedEngagementBootstrap({
    repository: {
      issueInvitation() {
        throw new Error("unused");
      },
      claimInvitation({ tokenDigest }) {
        throw new (tokenDigest.startsWith("0") ? TypeError : Error)(
          "different internal cause"
        );
      }
    },
    legalAuthority: selectedAuthority,
    tokenSecret: Buffer.alloc(32, 9)
  });
  const base = {
    commandId: "engagement-claim-002",
    legalAcceptance: acceptance(selectedAuthority),
    password: "correct horse battery staple",
    userAgentDigest: null
  };
  for (const token of ["A".repeat(43), "B".repeat(43)]) {
    await assert.rejects(
      boundary.claimInvitation({ ...base, token }),
      (error) =>
        error.code === "ENGAGEMENT_CLAIM_FAILED" &&
        error.status === 409 &&
        error.message ===
          "That engagement invitation is invalid, expired, or already used."
    );
  }
});

test("held engagement boundary is inert and provider-effect free", () => {
  const held = createHeldHostedEngagementBootstrap();
  assert.deepEqual(held.readiness(), {
    state: "held",
    providerEffects: false
  });
  assert.throws(
    () => held.issueInvitation(),
    (error) => error.code === "ENGAGEMENT_BOOTSTRAP_HELD"
  );
});
