import assert from "node:assert/strict";
import test from "node:test";

import { createHeldCatalogPort } from "../../commerce/adapters/held.mjs";
import { createCanonicalPostgresService } from "../postgres-service.mjs";
import {
  createProjectLegalAuthority,
  createProjectLegalAuthorityFromEnvironment,
  createProjectLegalAuthorityFixture,
  createProjectLegalAuthorityV4,
  createProjectLegalAuthorityV4Fixture,
  publicProjectLegalAuthority,
  PROJECT_LEGAL_ACCEPTANCE_SCHEMA,
  PROJECT_LEGAL_ACCEPTANCE_STATEMENT,
  PROJECT_LEGAL_V4_ACCEPTANCE_SCHEMA,
  validateProjectLegalAcceptance
} from "../project-legal-authority.mjs";
import { canonicalJson, digest } from "../security.mjs";

const ACTOR = Object.freeze({
  userId: "00000000-0000-4000-8000-000000000001"
});
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000002";
const NOW = "2026-08-07T12:00:00.000Z";

function fixture() {
  const privacyV3 = {
    version: "SS-HOSTED-PRIVACY-TEST-V3",
    contentDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    contentUri: "https://example.test/privacy/v3",
    effectiveAt: "2026-08-07T00:00:00.000Z",
    byteCount: 1234,
    artifactUri: "https://example.test/privacy/v3.html"
  };
  const websiteTermsV3 = {
    version: "SS-HOSTED-WEBSITE-TERMS-TEST-V3",
    contentDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    contentUri: "https://example.test/terms/v3",
    effectiveAt: privacyV3.effectiveAt,
    byteCount: 4321,
    artifactUri: "https://example.test/terms/v3.html"
  };
  const documents = [
    {
      kind: "privacy",
      version: privacyV3.version,
      contentDigest: privacyV3.contentDigest,
      contentUri: privacyV3.contentUri,
      effectiveAt: privacyV3.effectiveAt
    },
    {
      kind: "product",
      version: websiteTermsV3.version,
      contentDigest: websiteTermsV3.contentDigest,
      contentUri: "https://sitesourcery.com/legal/website-terms/#self-service",
      effectiveAt: privacyV3.effectiveAt
    },
    {
      kind: "website",
      version: websiteTermsV3.version,
      contentDigest: websiteTermsV3.contentDigest,
      contentUri: "https://sitesourcery.com/legal/website-terms/",
      effectiveAt: privacyV3.effectiveAt
    }
  ];
  const authorityDigest = digest(canonicalJson({
    documents,
    schema: "sitesourcery.project-legal-authority/v3"
  }));
  return createProjectLegalAuthorityFixture({
    privacyV3,
    websiteTermsV3,
    authorityDigest
  });
}

function acceptanceFor(authority) {
  return {
    schema: authority.acceptanceSchema,
    acceptanceStatement: PROJECT_LEGAL_ACCEPTANCE_STATEMENT,
    authorityDigest: authority.authorityDigest,
    documents: authority.documents.map((document) => ({ ...document }))
  };
}

function v4Fixture() {
  const privacyV4 = {
    version: "SS-HOSTED-PRIVACY-TEST-V4",
    contentDigest: "c".repeat(64),
    contentUri: "https://example.test/privacy/v4",
    effectiveAt: "2026-08-09T18:00:00.000Z",
    byteCount: 2222,
    artifactUri: "https://example.test/privacy/v4.html"
  };
  const websiteTermsV4 = {
    version: "SS-HOSTED-WEBSITE-TERMS-TEST-V4",
    contentDigest: "d".repeat(64),
    contentUri: "https://example.test/terms/v4",
    effectiveAt: privacyV4.effectiveAt,
    byteCount: 3333,
    artifactUri: "https://example.test/terms/v4.html"
  };
  const documents = [
    {
      kind: "privacy",
      version: privacyV4.version,
      contentDigest: privacyV4.contentDigest,
      contentUri: privacyV4.contentUri,
      effectiveAt: privacyV4.effectiveAt
    },
    {
      kind: "product",
      version: websiteTermsV4.version,
      contentDigest: websiteTermsV4.contentDigest,
      contentUri: "https://sitesourcery.com/legal/website-terms/#self-service",
      effectiveAt: privacyV4.effectiveAt
    },
    {
      kind: "website",
      version: websiteTermsV4.version,
      contentDigest: websiteTermsV4.contentDigest,
      contentUri: "https://sitesourcery.com/legal/website-terms/",
      effectiveAt: privacyV4.effectiveAt
    }
  ];
  return createProjectLegalAuthorityV4Fixture({
    privacyV4,
    websiteTermsV4,
    authorityDigest: digest(canonicalJson({
      documents,
      schema: "sitesourcery.project-legal-authority/v4"
    }))
  });
}

function createLegalService({
  projectLegalAuthority = null,
  projectLegalAuthorityDiagnostic = null,
  projectLegalArtifactsReady = projectLegalAuthority !== null,
  query = async (text) => {
    throw new Error(`Unexpected query: ${text}`);
  }
} = {}) {
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      return query(text, values);
    }
  };
  const service = createCanonicalPostgresService({
    authority: {
      kind: "canonical-postgres",
      async readiness() {
        return {
          ready: true,
          database: "test",
          projectCreationLegal: {
            ready: projectLegalAuthority !== null,
            v2Artifact: projectLegalArtifactsReady
          }
        };
      },
      async projectLegalAuthorityMatches(expected) {
        return expected === projectLegalAuthority;
      },
      async service(_options, work) {
        return work(client);
      }
    },
    identity: {
      authenticate() {},
      register() {},
      completeRegistration() {},
      async registrationReadiness() {
        return { ready: true, verified: true, mode: "production" };
      },
      signIn() {},
      signOut() {},
      issueRecoveryForDelivery() {},
      completeRecovery() {},
      requireRecentReauthentication() {}
    },
    compiler: {
      schema: "sitesourcery.spark-compiler/v1",
      revision: "privacy-v3-test",
      compile() {}
    },
    catalogPort: createHeldCatalogPort(),
    publicationPort: {
      request() {},
      rollback() {},
      unpublish() {},
      async readiness() {
        return { ready: true, held: true };
      }
    },
    exportStore: {
      kind: "test-exports",
      key() {},
      put() {},
      get() {},
      delete() {}
    },
    recoveryMailPort: {
      async readiness() {
        return { ready: true, verified: true, mode: "production" };
      },
      deliver() {}
    },
    projectLegalAuthority,
    projectLegalAuthorityDiagnostic,
    clock: { now: () => NOW }
  });
  return { calls, service };
}

test("production authority fails closed until the explicit sealed digest handoff", () => {
  assert.throws(
    () => createProjectLegalAuthority(),
    (error) => error.code === "LEGAL_CONFIGURATION_REQUIRED" && error.status === 503
  );
  assert.throws(
    () => createProjectLegalAuthority({
      privacyV3: {
        version: "SS-HOSTED-PRIVACY-V3-UNSEALED",
        contentDigest: "a".repeat(64),
        contentUri: "https://example.test/privacy/v3",
        effectiveAt: "2026-08-07T00:00:00.000Z",
        byteCount: 1234,
        artifactUri: "https://example.test/privacy/v3.html",
        authorityDigest: "b".repeat(64)
      }
    }),
    (error) => error.code === "LEGAL_CONFIGURATION_REQUIRED"
  );
  assert.throws(
    () => createProjectLegalAuthorityV4(),
    (error) => error.code === "LEGAL_CONFIGURATION_REQUIRED" && error.status === 503
  );
});

test("production bootstrap stays held without constants", () => {
  const result = createProjectLegalAuthorityFromEnvironment({});
  assert.equal(result.authority, null);
  assert.deepEqual(result.diagnostic, {
    state: "held",
    code: "LEGAL_CONFIGURATION_REQUIRED",
    reason: "Joint Privacy V3 and Website Terms V3 constants are not sealed."
  });
});

test("malformed partial bootstrap is held instead of throwing", () => {
  const result = createProjectLegalAuthorityFromEnvironment({
    SITESOURCERY_HOSTED_PRIVACY_V3_VERSION: "SS-HOSTED-PRIVACY-V3-UNSEALED"
  });
  assert.equal(result.authority, null);
  assert.equal(result.diagnostic.code, "LEGAL_CONFIGURATION_REQUIRED");
});

test("any V4 bootstrap input takes precedence and cannot fall back to complete V3", () => {
  const existingV3 = {
    SITESOURCERY_HOSTED_PRIVACY_V3_VERSION:
      "SS-HOSTED-PRIVACY-2026-08-09-V3",
    SITESOURCERY_HOSTED_PRIVACY_V3_SHA256: "a".repeat(64),
    SITESOURCERY_HOSTED_PRIVACY_V3_URI:
      "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V3/",
    SITESOURCERY_HOSTED_PRIVACY_V3_EFFECTIVE_AT:
      "2026-08-09T15:25:59.000Z",
    SITESOURCERY_HOSTED_PRIVACY_V3_BYTE_COUNT: "1",
    SITESOURCERY_HOSTED_PRIVACY_V3_ARTIFACT_URI:
      "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V3/",
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_VERSION:
      "SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3",
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_SHA256: "b".repeat(64),
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_URI:
      "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3/",
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_EFFECTIVE_AT:
      "2026-08-09T15:25:59.000Z",
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_BYTE_COUNT: "1",
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_ARTIFACT_URI:
      "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3/",
    SITESOURCERY_HOSTED_LEGAL_V3_AUTHORITY_SHA256: "c".repeat(64)
  };
  const result = createProjectLegalAuthorityFromEnvironment({
    ...existingV3,
    SITESOURCERY_HOSTED_PRIVACY_V4_VERSION:
      ""
  });
  assert.equal(result.authority, null);
  assert.equal(result.diagnostic.reason,
    "Joint legal V4 constants are incomplete or invalid.");
});

test("V4 fixture binds the new paired schema, receipt schema, and immutable IDs", () => {
  const authority = v4Fixture();
  assert.equal(authority.schema, "sitesourcery.project-legal-authority/v4");
  assert.equal(authority.acceptanceSchema, PROJECT_LEGAL_V4_ACCEPTANCE_SCHEMA);
  assert.deepEqual(
    authority.documentBindings.map(({ id }) => id),
    [
      "00000000-0000-4000-8000-000000000049",
      "00000000-0000-4000-8000-000000000105",
      "00000000-0000-4000-8000-000000000106"
    ]
  );
  assert.equal(
    validateProjectLegalAcceptance(acceptanceFor(authority), authority).schema,
    PROJECT_LEGAL_V4_ACCEPTANCE_SCHEMA
  );
  assert.throws(
    () => validateProjectLegalAcceptance({
      ...acceptanceFor(authority),
      schema: PROJECT_LEGAL_ACCEPTANCE_SCHEMA
    }, authority),
    (error) => error.code === "LEGAL_ACCEPTANCE_INVALID"
  );
});

test("production bootstrap requires and binds the exact joint V3 tuple", () => {
  const effectiveAt = "2099-12-31T00:00:00.000Z";
  const documents = [
    {
      kind: "privacy",
      version: "SS-HOSTED-PRIVACY-2099-12-31-V3",
      contentDigest: "a".repeat(64),
      contentUri: "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2099-12-31-V3/",
      effectiveAt
    },
    {
      kind: "product",
      version: "SS-HOSTED-WEBSITE-TERMS-2099-12-31-V3",
      contentDigest: "b".repeat(64),
      contentUri: "https://sitesourcery.com/legal/website-terms/#self-service",
      effectiveAt
    },
    {
      kind: "website",
      version: "SS-HOSTED-WEBSITE-TERMS-2099-12-31-V3",
      contentDigest: "b".repeat(64),
      contentUri: "https://sitesourcery.com/legal/website-terms/",
      effectiveAt
    }
  ];
  const authorityDigest = digest(canonicalJson({
    documents,
    schema: "sitesourcery.project-legal-authority/v3"
  }));
  const configured = createProjectLegalAuthorityFromEnvironment({
    SITESOURCERY_HOSTED_PRIVACY_V3_VERSION: documents[0].version,
    SITESOURCERY_HOSTED_PRIVACY_V3_SHA256: documents[0].contentDigest,
    SITESOURCERY_HOSTED_PRIVACY_V3_URI: documents[0].contentUri,
    SITESOURCERY_HOSTED_PRIVACY_V3_EFFECTIVE_AT: effectiveAt,
    SITESOURCERY_HOSTED_PRIVACY_V3_BYTE_COUNT: "100",
    SITESOURCERY_HOSTED_PRIVACY_V3_ARTIFACT_URI: documents[0].contentUri,
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_VERSION: documents[2].version,
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_SHA256: documents[2].contentDigest,
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_URI:
      "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2099-12-31-V3/",
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_EFFECTIVE_AT: effectiveAt,
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_BYTE_COUNT: "200",
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_ARTIFACT_URI:
      "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2099-12-31-V3/",
    SITESOURCERY_HOSTED_LEGAL_V3_AUTHORITY_SHA256: authorityDigest
  });
  assert.equal(configured.diagnostic, null);
  assert.deepEqual(configured.authority.documents, documents);
  assert.equal(configured.authority.artifactBindings[1].artifactUri, null);
  assert.equal(
    configured.authority.artifactBindings[2].artifactUri,
    "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2099-12-31-V3/"
  );
});

test("malformed bootstrap keeps runtime reads live while legal writes stay held", async () => {
  const configured = createProjectLegalAuthorityFromEnvironment({
    SITESOURCERY_HOSTED_PRIVACY_V3_VERSION:
      "SS-HOSTED-PRIVACY-V3-UNSEALED"
  });
  const context = createLegalService({
    projectLegalAuthority: configured.authority,
    projectLegalAuthorityDiagnostic: configured.diagnostic
  });

  const readiness = await context.service.readiness();
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.projectCreationLegal, {
    ready: false,
    diagnostic: configured.diagnostic
  });
  await assert.rejects(
    context.service.getProjectLegalAuthority(),
    (error) =>
      error?.code === "LEGAL_CONFIGURATION_REQUIRED" &&
      error?.status === 503
  );
  assert.equal(context.calls.length, 0);
});

test("malformed bootstrap preserves immutable V2 evidence without mutable fallback", async () => {
  const configured = createProjectLegalAuthorityFromEnvironment({
    SITESOURCERY_HOSTED_PRIVACY_V3_VERSION:
      "SS-HOSTED-PRIVACY-V3-UNSEALED"
  });
  const projectId = "00000000-0000-4000-8000-000000000101";
  const v2DocumentId = "00000000-0000-4000-8000-000000000022";
  const immutableUri =
    "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/";
  function query({ artifactsReady }) {
    return async (text, values) => {
      if (text.includes("select project.organization_id")) {
        return {
          rows: [{ organization_id: ORGANIZATION_ID }],
          rowCount: 1
        };
      }
      if (text.includes("select\n         project.*")) {
        return {
          rows: [{
            id: values[0],
            organization_id: ORGANIZATION_ID,
            name: "Held legal read",
            lifecycle: "active",
            revision: 1,
            visibility: "public",
            created_at: NOW,
            updated_at: NOW,
            raw_facts: {},
            draft_revision: 1,
            draft_updated_at: NOW,
            serving_state: "unpublished",
            current_release_id: null,
            previous_release_id: null
          }],
          rowCount: 1
        };
      }
      if (text.includes("from ss.site_versions version")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("select acceptance.document_id")) {
        return {
          rows: [{
            document_id: v2DocumentId,
            kind: "privacy",
            version: "SS-HOSTED-PRIVACY-2026-07-30-V2",
            content_digest:
              "b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b",
            accepted_at: "2026-07-31T00:00:00.000Z",
            is_current: true
          }],
          rowCount: 1
        };
      }
      if (text.includes("from ss.legal_document_artifacts")) {
        assert.equal(artifactsReady, true);
        return {
          rows: [{ document_id: v2DocumentId, artifact_uri: immutableUri }],
          rowCount: 1
        };
      }
      throw new Error(`Unexpected query: ${text}`);
    };
  }

  const readyContext = createLegalService({
    projectLegalAuthorityDiagnostic: configured.diagnostic,
    projectLegalArtifactsReady: true,
    query: query({ artifactsReady: true })
  });
  const ready = await readyContext.service.getProject(ACTOR, projectId);
  assert.equal(ready.project.legal.current[0].evidenceUri, immutableUri);

  const heldContext = createLegalService({
    projectLegalAuthorityDiagnostic: configured.diagnostic,
    projectLegalArtifactsReady: false,
    query: query({ artifactsReady: false })
  });
  const held = await heldContext.service.getProject(ACTOR, projectId);
  assert.equal(held.project.legal.current[0].evidenceUri, null);
  assert.equal(
    heldContext.calls.some(({ text }) =>
      text.includes("from ss.legal_document_artifacts")
    ),
    false
  );
});

test("authority digest is canonical and acceptance requires the exact three-document bundle", () => {
  const authority = fixture();
  const publicAuthority = publicProjectLegalAuthority(authority);
  assert.deepEqual(Object.keys(publicAuthority).sort(), [
    "acceptanceStatement",
    "authorityDigest",
    "documents",
    "schema"
  ]);
  assert.equal("privacyV3" in publicAuthority, false);
  assert.equal("artifactBindings" in publicAuthority, false);
  const acceptance = acceptanceFor(authority);
  assert.deepEqual(
    validateProjectLegalAcceptance(acceptance, authority),
    acceptance
  );
  assert.throws(
    () => validateProjectLegalAcceptance({ ...acceptance, acceptedTerms: true }, authority),
    (error) => error.code === "LEGAL_ACCEPTANCE_INVALID"
  );
  assert.throws(
    () => validateProjectLegalAcceptance({
      ...acceptance,
      documents: [...acceptance.documents].reverse()
    }, authority),
    (error) => error.code === "LEGAL_AUTHORITY_CHANGED"
  );
});

test("project creation rejects rogue product and website artifact mappings", async () => {
  const authority = fixture();
  for (const rogueIndex of [1, 2]) {
    const documents = authority.documents.map((document, index) => ({
      id: authority.documentBindings[index].id,
      kind: document.kind,
      version: document.version,
      content_digest: document.contentDigest,
      content_uri: document.contentUri,
      effective_at: document.effectiveAt,
      artifact_uri: authority.artifactBindings[index].artifactUri,
      artifact_sha256: authority.artifactBindings[index].artifactSha256 ?? null,
      byte_count: authority.artifactBindings[index].byteCount ?? null,
      media_type: authority.artifactBindings[index].mediaType ?? null
    }));
    Object.assign(documents[rogueIndex], {
      artifact_uri: "https://rogue.example.test/legal.html",
      artifact_sha256: documents[rogueIndex].content_digest,
      byte_count: 321,
      media_type: "text/html; charset=utf-8"
    });
    const context = createLegalService({
      projectLegalAuthority: authority,
      async query(text) {
        if (text.includes("pg_advisory_xact_lock")) {
          return { rows: [{ locked: true }], rowCount: 1 };
        }
        if (text.includes("select count(*)::integer as count")) {
          return { rows: [{ count: 1 }], rowCount: 1 };
        }
        if (text.includes("from ss.organization_memberships membership")) {
          return {
            rows: [{ role: "owner", state: "active" }],
            rowCount: 1
          };
        }
        if (text.includes("from ss.idempotency_keys")) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes("insert into ss.idempotency_keys")) {
          return { rows: [], rowCount: 1 };
        }
        if (text.includes("from ss.legal_documents document")) {
          return { rows: documents, rowCount: documents.length };
        }
        throw new Error(`Unexpected query: ${text}`);
      }
    });

    await assert.rejects(
      context.service.createProject(ACTOR, ORGANIZATION_ID, {
        name: `Rogue ${documents[rogueIndex].kind} artifact`,
        commandId: `rogue-artifact-${rogueIndex}`,
        legalAcceptance: acceptanceFor(authority)
      }),
      (error) =>
        error?.code === "LEGAL_AUTHORITY_CHANGED" &&
        error?.status === 409
    );
    assert.equal(
      context.calls.some(({ text }) => text.includes("insert into ss.projects")),
      false
    );
  }
});

test("legacy V2 remains current until a later acceptance moves it to history", async () => {
  const authority = fixture();
  const v2 = {
    document_id: "00000000-0000-4000-8000-000000000022",
    kind: "privacy",
    version: "SS-HOSTED-PRIVACY-2026-07-30-V2",
    content_digest:
      "b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b",
    evidence_uri: "https://sitesourcery.com/legal/privacy/",
    accepted_at: "2026-07-31T00:00:00.000Z",
    is_current: true
  };
  const v3 = {
    document_id: authority.documentBindings[0].id,
    kind: "privacy",
    version: authority.documents[0].version,
    content_digest: authority.documents[0].contentDigest,
    evidence_uri: authority.documents[0].contentUri,
    accepted_at: "2026-08-08T00:00:00.000Z",
    is_current: true
  };
  let legalRows = [v2];
  const context = createLegalService({
    projectLegalAuthority: authority,
    async query(text, values) {
      if (text.includes("select project.organization_id")) {
        return {
          rows: [{ organization_id: ORGANIZATION_ID }],
          rowCount: 1
        };
      }
      if (text.includes("select\n         project.*")) {
        return {
          rows: [{
            id: values[0],
            organization_id: ORGANIZATION_ID,
            name: "Legal continuity",
            lifecycle: "active",
            revision: 1,
            visibility: "public",
            created_at: NOW,
            updated_at: NOW,
            raw_facts: {},
            draft_revision: 1,
            draft_updated_at: NOW,
            serving_state: "unpublished",
            current_release_id: null,
            previous_release_id: null
          }],
          rowCount: 1
        };
      }
      if (text.includes("from ss.site_versions version")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("select acceptance.document_id")) {
        return { rows: legalRows, rowCount: legalRows.length };
      }
      if (text.includes("from ss.legal_document_artifacts")) {
        return {
          rows: [
            {
              document_id: v2.document_id,
              artifact_uri:
                "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/"
            },
            {
              document_id: v3.document_id,
              artifact_uri: authority.artifactBindings[0].artifactUri
            }
          ],
          rowCount: 2
        };
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  });

  const legacy = await context.service.getProject(
    ACTOR,
    "00000000-0000-4000-8000-000000000101"
  );
  assert.equal(legacy.project.legal.current[0].version, v2.version);
  assert.equal(legacy.project.legal.history.length, 0);
  assert.match(legacy.project.legal.current[0].evidenceUri, /versions/u);

  legalRows = [{ ...v3 }, { ...v2, is_current: false }];
  const advanced = await context.service.getProject(
    ACTOR,
    "00000000-0000-4000-8000-000000000102"
  );
  assert.equal(advanced.project.legal.current[0].version, v3.version);
  assert.equal(advanced.project.legal.history[0].version, v2.version);
  assert.match(advanced.project.legal.history[0].evidenceUri, /versions/u);
});
