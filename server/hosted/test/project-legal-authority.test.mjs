import assert from "node:assert/strict";
import test from "node:test";

import {
  createProjectLegalAuthority,
  createProjectLegalAuthorityFixture,
  PROJECT_LEGAL_ACCEPTANCE_SCHEMA,
  PROJECT_LEGAL_ACCEPTANCE_STATEMENT,
  validateProjectLegalAcceptance
} from "../project-legal-authority.mjs";
import { canonicalJson, digest } from "../security.mjs";

function fixture() {
  const privacyV3 = {
    version: "SS-HOSTED-PRIVACY-TEST-V3",
    contentDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    contentUri: "https://example.test/privacy/v3",
    effectiveAt: "2026-08-07T00:00:00.000Z",
    byteCount: 1234,
    artifactUri: "https://example.test/privacy/v3.html"
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
      version: "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2",
      contentDigest: "bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196",
      contentUri: "https://sitesourcery.com/legal/website-terms/#self-service",
      effectiveAt: "2026-07-30T00:00:00.000Z"
    },
    {
      kind: "website",
      version: "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2",
      contentDigest: "bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196",
      contentUri: "https://sitesourcery.com/legal/website-terms/",
      effectiveAt: "2026-07-30T00:00:00.000Z"
    }
  ];
  const authorityDigest = digest(canonicalJson({
    documents,
    schema: "sitesourcery.project-legal-authority/v3"
  }));
  return createProjectLegalAuthorityFixture({
    privacyV3: {
      ...privacyV3,
      authorityDigest
    }
  });
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
});

test("authority digest is canonical and acceptance requires the exact three-document bundle", () => {
  const authority = fixture();
  assert.deepEqual(Object.keys(authority).sort(), [
    "acceptanceStatement",
    "authorityDigest",
    "documents",
    "schema"
  ]);
  assert.equal("privacyV3" in authority, false);
  const acceptance = {
    schema: PROJECT_LEGAL_ACCEPTANCE_SCHEMA,
    acceptanceStatement: PROJECT_LEGAL_ACCEPTANCE_STATEMENT,
    authorityDigest: authority.authorityDigest,
    documents: authority.documents.map((document) => ({ ...document }))
  };
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
