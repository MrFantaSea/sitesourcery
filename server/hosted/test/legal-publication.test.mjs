import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_LEGAL_V4_SCHEMA,
  UNSEALED_PRIVACY_V4_CONSTANTS,
  createProjectLegalAuthorityV4Fixture,
  v2ContinuityDocuments
} from "../project-legal-authority.mjs";
import { canonicalJson, digest } from "../security.mjs";
import {
  JOINT_LEGAL_V4_RELEASE
} from "../../../scripts/hosted-truth/joint-legal-v4-artifacts.mjs";
import {
  LEGAL_PUBLICATION_BASIS_SCHEMA,
  LEGAL_PUBLICATION_SCHEMA,
  PUBLICATION_MODE,
  UNSEALED_PUBLICATION_SENTINELS,
  V2_PUBLICATION_ALIASES,
  createHeldPublication,
  describePublicationMode,
  isUnsealedPublicationVersion,
  requirePublicationMode,
  sealPublicationBasis
} from "../legal-publication.mjs";
import {
  applyOwnerPublicationReceipt,
  createOwnerPublicationReceipt,
  createPublicationControlLedger
} from "../legal-publication-control.mjs";
import {
  verifyOwnerPublicationReceipt,
  verifyPublicationBasis,
  verifyPublicationRecord
} from "../legal-publication-verify.mjs";

// The exact sealed effective basis, referenced from the one owner-approved V4
// finalization tuple. Bytes/aliases/digests are never altered here.
const EFFECTIVE_AT = JOINT_LEGAL_V4_RELEASE.effectiveAt; // 2026-08-09T21:42:11.000Z
// The operational Pages-publish instant is a SEPARATE fact from the sealed
// effective instant above. They are deliberately different values.
const PUBLISHED_AT = "2026-08-10T13:05:00.000Z";
const OWNER = Object.freeze({
  ownerId: "owner-zack",
  authorization: "owner-approved-legal-publish-01"
});

function realPrivacyBasisInput() {
  return {
    kind: "privacy",
    version: JOINT_LEGAL_V4_RELEASE.privacyVersion,
    effectiveAt: JOINT_LEGAL_V4_RELEASE.effectiveAt,
    contentDigest: JOINT_LEGAL_V4_RELEASE.privacySha256,
    byteCount: JOINT_LEGAL_V4_RELEASE.privacyByteCount,
    authorityDigest: JOINT_LEGAL_V4_RELEASE.authorityDigest,
    artifactUri: JOINT_LEGAL_V4_RELEASE.privacyArtifactUri
  };
}

function realWebsiteBasisInput() {
  return {
    kind: "website",
    version: JOINT_LEGAL_V4_RELEASE.websiteTermsVersion,
    effectiveAt: JOINT_LEGAL_V4_RELEASE.effectiveAt,
    contentDigest: JOINT_LEGAL_V4_RELEASE.websiteTermsSha256,
    byteCount: JOINT_LEGAL_V4_RELEASE.websiteTermsByteCount,
    authorityDigest: JOINT_LEGAL_V4_RELEASE.authorityDigest,
    artifactUri: JOINT_LEGAL_V4_RELEASE.websiteTermsArtifactUri
  };
}

// ---------------------------------------------------------------------------
// 1. Basis / publishedAt separation
// ---------------------------------------------------------------------------

test("sealed basis carries the effective instant, not publishedAt", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  assert.equal(basis.sealed, true);
  assert.equal(basis.schema, LEGAL_PUBLICATION_BASIS_SCHEMA);
  assert.equal(basis.effectiveAt, EFFECTIVE_AT);
  assert.equal("publishedAt" in basis, false);
  assert.match(basis.basisDigest, /^[a-f0-9]{64}$/u);
});

test("held publication keeps basis.effectiveAt and publishedAt distinct", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  const record = createHeldPublication({
    basis,
    mode: PUBLICATION_MODE.PAGES_FALLBACK,
    publishedAt: PUBLISHED_AT
  });
  assert.equal(record.state, "held");
  assert.equal(record.published, false);
  assert.equal(record.effect, null);
  // Two separate facts, never collapsed.
  assert.equal(record.basis.effectiveAt, EFFECTIVE_AT);
  assert.equal(record.publishedAt, PUBLISHED_AT);
  assert.notEqual(record.basis.effectiveAt, record.publishedAt);
});

test("held publication is held by default with no publishedAt", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  const record = createHeldPublication({
    basis,
    mode: PUBLICATION_MODE.HOSTED_BACKEND
  });
  assert.equal(record.state, "held");
  assert.equal(record.published, false);
  assert.equal(record.effect, null);
  assert.equal(record.publishedAt, null);
});

test("held publication references an already-sealed basis by identity", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  const record = createHeldPublication({
    basis,
    mode: PUBLICATION_MODE.PAGES_FALLBACK
  });
  // Not re-derived or mutated: the same frozen basis object flows through.
  assert.equal(record.basis, basis);
  assert.equal(Object.isFrozen(record), true);
});

function v4FixtureAuthority() {
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
  const authorityDigest = digest(canonicalJson({
    documents,
    schema: PROJECT_LEGAL_V4_SCHEMA
  }));
  return createProjectLegalAuthorityV4Fixture({
    privacyV4,
    websiteTermsV4,
    authorityDigest
  });
}

test("a basis can be built from a real V4 legal authority document + binding", () => {
  const authority = v4FixtureAuthority();
  const document = authority.documents[0];
  const binding = authority.artifactBindings[0];
  const basis = sealPublicationBasis({
    kind: document.kind,
    version: document.version,
    effectiveAt: document.effectiveAt,
    contentDigest: document.contentDigest,
    byteCount: binding.byteCount,
    authorityDigest: authority.authorityDigest,
    artifactUri: binding.artifactUri
  });
  assert.equal(basis.version, "SS-HOSTED-PRIVACY-TEST-V4");
  assert.equal(basis.byteCount, 2222);
  assert.equal(basis.effectiveAt, "2026-08-09T18:00:00.000Z");
});

// ---------------------------------------------------------------------------
// 2. Alias / byte preservation
// ---------------------------------------------------------------------------

test("real V4 privacy alias, digest, and byte count are preserved exactly", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  assert.equal(basis.version, "SS-HOSTED-PRIVACY-2026-08-09-V4");
  assert.equal(
    basis.contentDigest,
    "2f9edca746f9bffc1dc4b6745613ae42c04813a3ac94cd2e8432e964cfa36e99"
  );
  assert.equal(basis.byteCount, 31451);
});

test("real V4 website-terms alias, digest, and byte count are preserved exactly", () => {
  const basis = sealPublicationBasis(realWebsiteBasisInput());
  assert.equal(basis.version, "SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4");
  assert.equal(
    basis.contentDigest,
    "4c937f54ae5805a15a9ae835d0266973fb8e8117065dbfce2030ff3f189ff642"
  );
  assert.equal(basis.byteCount, 26215);
});

test("V2 aliases are referenced exactly from the legal authority", () => {
  const v2 = v2ContinuityDocuments();
  assert.deepEqual(
    [...V2_PUBLICATION_ALIASES].sort(),
    [v2.privacy.version, v2.website.version].sort()
  );
  assert.ok(V2_PUBLICATION_ALIASES.includes("SS-HOSTED-PRIVACY-2026-07-30-V2"));
  assert.ok(
    V2_PUBLICATION_ALIASES.includes("SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2")
  );
});

test("unsealed sentinels are the exact legal-authority sentinels", () => {
  assert.deepEqual([...UNSEALED_PUBLICATION_SENTINELS].sort(), [
    "SS-HOSTED-PRIVACY-V3-UNSEALED",
    "SS-HOSTED-PRIVACY-V4-UNSEALED",
    "SS-HOSTED-WEBSITE-TERMS-V3-UNSEALED",
    "SS-HOSTED-WEBSITE-TERMS-V4-UNSEALED"
  ]);
  assert.equal(
    isUnsealedPublicationVersion(UNSEALED_PRIVACY_V4_CONSTANTS.version),
    true
  );
});

// ---------------------------------------------------------------------------
// 3. One-shot idempotency of the owner receipt / control
// ---------------------------------------------------------------------------

test("owner receipt construction is idempotent over the same basis", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  const first = createOwnerPublicationReceipt({
    basis,
    mode: PUBLICATION_MODE.PAGES_FALLBACK,
    owner: OWNER,
    effectiveAt: EFFECTIVE_AT,
    publishedAt: PUBLISHED_AT
  });
  const second = createOwnerPublicationReceipt({
    basis,
    mode: PUBLICATION_MODE.PAGES_FALLBACK,
    owner: OWNER,
    effectiveAt: EFFECTIVE_AT,
    publishedAt: PUBLISHED_AT
  });
  assert.equal(first.receiptId, second.receiptId);
  assert.equal(first.effectDigest, second.effectDigest);
  assert.equal(first.singleUse, true);
  assert.equal(first.effect.published, true);
  assert.equal(first.effect.publishedAt, PUBLISHED_AT);
  assert.equal(first.effectiveAt, EFFECTIVE_AT);
});

test("ledger records one effect, replays the same, refuses a different one", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  const receipt = createOwnerPublicationReceipt({
    basis,
    mode: PUBLICATION_MODE.PAGES_FALLBACK,
    owner: OWNER,
    effectiveAt: EFFECTIVE_AT,
    publishedAt: PUBLISHED_AT
  });
  const ledger = createPublicationControlLedger();
  const applied = ledger.apply(receipt);
  assert.equal(applied.applied, true);
  assert.equal(applied.replay, false);
  const replay = ledger.apply(receipt);
  assert.equal(replay.applied, false);
  assert.equal(replay.replay, true);
  assert.equal(ledger.controlled(basis.basisDigest), true);

  const differentEffect = createOwnerPublicationReceipt({
    basis,
    mode: PUBLICATION_MODE.PAGES_FALLBACK,
    owner: OWNER,
    effectiveAt: EFFECTIVE_AT,
    publishedAt: "2026-08-11T09:00:00.000Z"
  });
  assert.throws(
    () => ledger.apply(differentEffect),
    (error) =>
      error.code === "PUBLICATION_ALREADY_CONTROLLED" && error.status === 409
  );
});

test("applying a receipt yields the published record idempotently", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  const held = createHeldPublication({
    basis,
    mode: PUBLICATION_MODE.PAGES_FALLBACK,
    publishedAt: PUBLISHED_AT
  });
  const receipt = createOwnerPublicationReceipt({
    basis,
    mode: PUBLICATION_MODE.PAGES_FALLBACK,
    owner: OWNER,
    effectiveAt: EFFECTIVE_AT,
    publishedAt: PUBLISHED_AT
  });
  const first = applyOwnerPublicationReceipt(held, receipt);
  const second = applyOwnerPublicationReceipt(held, receipt);
  assert.equal(first.state, "published");
  assert.equal(first.published, true);
  assert.equal(first.publishedAt, PUBLISHED_AT);
  assert.equal(first.receiptId, receipt.receiptId);
  assert.equal(first.receiptId, second.receiptId);
  assert.equal(first.basis.effectiveAt, EFFECTIVE_AT);
  // The published record round-trips through the fail-closed verifier.
  const verified = verifyPublicationRecord(first);
  assert.equal(verified.state, "published");
  assert.equal(verified.published, true);
  assert.equal(verified.effectiveAt, EFFECTIVE_AT);
  assert.equal(verified.publishedAt, PUBLISHED_AT);
});

test("owner receipt fails closed when owner facts are absent", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  assert.throws(
    () =>
      createOwnerPublicationReceipt({
        basis,
        mode: PUBLICATION_MODE.PAGES_FALLBACK,
        owner: null,
        effectiveAt: EFFECTIVE_AT,
        publishedAt: PUBLISHED_AT
      }),
    (error) => error.code === "PUBLICATION_OWNER_FACT_REQUIRED"
  );
});

test("owner receipt fails closed when publishedAt is absent", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  assert.throws(
    () =>
      createOwnerPublicationReceipt({
        basis,
        mode: PUBLICATION_MODE.PAGES_FALLBACK,
        owner: OWNER,
        effectiveAt: EFFECTIVE_AT,
        publishedAt: undefined
      }),
    (error) => error.code === "PUBLICATION_OWNER_FACT_REQUIRED"
  );
});

test("owner receipt fails closed when effectiveAt is absent", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  assert.throws(
    () =>
      createOwnerPublicationReceipt({
        basis,
        mode: PUBLICATION_MODE.PAGES_FALLBACK,
        owner: OWNER,
        effectiveAt: undefined,
        publishedAt: PUBLISHED_AT
      }),
    (error) => error.code === "PUBLICATION_OWNER_FACT_REQUIRED"
  );
});

test("owner receipt rejects an effectiveAt that is not the sealed instant", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  assert.throws(
    () =>
      createOwnerPublicationReceipt({
        basis,
        mode: PUBLICATION_MODE.PAGES_FALLBACK,
        owner: OWNER,
        effectiveAt: "2026-08-09T21:42:12.000Z",
        publishedAt: PUBLISHED_AT
      }),
    (error) => error.code === "PUBLICATION_BASIS_MISMATCH"
  );
});

// ---------------------------------------------------------------------------
// 4. Fail-closed verifier
// ---------------------------------------------------------------------------

test("verifier accepts a well-formed held record and receipt", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  const held = createHeldPublication({
    basis,
    mode: PUBLICATION_MODE.PAGES_FALLBACK,
    publishedAt: PUBLISHED_AT
  });
  const receipt = createOwnerPublicationReceipt({
    basis,
    mode: PUBLICATION_MODE.PAGES_FALLBACK,
    owner: OWNER,
    effectiveAt: EFFECTIVE_AT,
    publishedAt: PUBLISHED_AT
  });
  const record = verifyPublicationRecord(held);
  assert.equal(record.state, "held");
  assert.equal(record.effectiveAt, EFFECTIVE_AT);
  assert.equal(record.publishedAt, PUBLISHED_AT);
  const verified = verifyOwnerPublicationReceipt(receipt);
  assert.equal(verified.receiptId, receipt.receiptId);
  assert.equal(verified.singleUse, true);
});

test("verifier rejects an unsealed sentinel basis", () => {
  const sentinelBasis = {
    schema: LEGAL_PUBLICATION_BASIS_SCHEMA,
    sealed: true,
    kind: "privacy",
    version: UNSEALED_PRIVACY_V4_CONSTANTS.version,
    effectiveAt: EFFECTIVE_AT,
    contentDigest: "a".repeat(64),
    byteCount: 100,
    authorityDigest: null,
    artifactUri: null
  };
  assert.throws(
    () => verifyPublicationBasis(sentinelBasis),
    (error) =>
      error.code === "PUBLICATION_BASIS_UNSEALED" && error.status === 409
  );
});

test("sealing rejects the unsealed sentinel exactly as legal authority does", () => {
  assert.throws(
    () =>
      sealPublicationBasis({
        kind: "privacy",
        version: UNSEALED_PRIVACY_V4_CONSTANTS.version,
        effectiveAt: null,
        contentDigest: null,
        byteCount: null,
        artifactUri: null
      }),
    (error) => error.code === "PUBLICATION_BASIS_UNSEALED"
  );
});

test("verifier rejects a record with a missing basis", () => {
  const record = {
    schema: LEGAL_PUBLICATION_SCHEMA,
    state: "held",
    published: false,
    effect: null,
    mode: describePublicationMode(PUBLICATION_MODE.HOSTED_BACKEND),
    basis: null,
    basisDigest: "0".repeat(64),
    publishedAt: null
  };
  assert.throws(
    () => verifyPublicationRecord(record),
    (error) => error.code === "PUBLICATION_BASIS_MISSING"
  );
});

test("verifier rejects a tampered basis digest as a mismatch", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  const held = createHeldPublication({
    basis,
    mode: PUBLICATION_MODE.HOSTED_BACKEND
  });
  const tampered = { ...held, basisDigest: "0".repeat(64) };
  assert.throws(
    () => verifyPublicationRecord(tampered),
    (error) => error.code === "PUBLICATION_BASIS_MISMATCH"
  );
});

test("verifier rejects publishedAt asserted without a sealed effective basis", () => {
  const record = {
    schema: LEGAL_PUBLICATION_SCHEMA,
    state: "held",
    published: false,
    effect: null,
    mode: describePublicationMode(PUBLICATION_MODE.PAGES_FALLBACK),
    basis: null,
    basisDigest: "0".repeat(64),
    publishedAt: PUBLISHED_AT
  };
  assert.throws(
    () => verifyPublicationRecord(record),
    (error) =>
      error.code === "PUBLICATION_EFFECT_WITHOUT_BASIS" && error.status === 409
  );
});

test("verifier rejects publishedAt over an unsealed sentinel basis", () => {
  const record = {
    schema: LEGAL_PUBLICATION_SCHEMA,
    state: "held",
    published: false,
    effect: null,
    mode: describePublicationMode(PUBLICATION_MODE.PAGES_FALLBACK),
    basis: {
      schema: LEGAL_PUBLICATION_BASIS_SCHEMA,
      sealed: true,
      kind: "privacy",
      version: UNSEALED_PRIVACY_V4_CONSTANTS.version,
      effectiveAt: EFFECTIVE_AT,
      contentDigest: "a".repeat(64),
      byteCount: 100,
      authorityDigest: null,
      artifactUri: null
    },
    basisDigest: "0".repeat(64),
    publishedAt: PUBLISHED_AT
  };
  assert.throws(
    () => verifyPublicationRecord(record),
    (error) => error.code === "PUBLICATION_EFFECT_WITHOUT_BASIS"
  );
});

test("verifier rejects a tampered owner receipt", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  const receipt = createOwnerPublicationReceipt({
    basis,
    mode: PUBLICATION_MODE.PAGES_FALLBACK,
    owner: OWNER,
    effectiveAt: EFFECTIVE_AT,
    publishedAt: PUBLISHED_AT
  });
  const tampered = { ...receipt, publishedAt: "2026-08-11T00:00:00.000Z" };
  assert.throws(
    () => verifyOwnerPublicationReceipt(tampered),
    (error) => error.code === "PUBLICATION_RECEIPT_INVALID"
  );
});

// ---------------------------------------------------------------------------
// 5. Explicit GitHub Pages fallback mode
// ---------------------------------------------------------------------------

test("pages-fallback mode is explicit and distinct from hosted-backend", () => {
  const pages = describePublicationMode(PUBLICATION_MODE.PAGES_FALLBACK);
  const hosted = describePublicationMode(PUBLICATION_MODE.HOSTED_BACKEND);
  assert.equal(pages.mode, "pages-fallback");
  assert.equal(pages.servedBy, "github-pages");
  assert.equal(pages.apexServedByPages, true);
  assert.equal(pages.backendPresent, false);
  assert.equal(pages.backendHeld, true);
  assert.equal(hosted.mode, "hosted-backend");
  assert.equal(hosted.apexServedByPages, false);
  assert.equal(hosted.backendPresent, true);
  assert.equal(hosted.backendHeld, false);
  assert.notDeepEqual(pages, hosted);
});

test("an unknown publication mode is rejected", () => {
  assert.throws(
    () => requirePublicationMode("edge-cdn"),
    (error) => error.code === "PUBLICATION_MODE_INVALID"
  );
});

test("a held pages-fallback record verifies and reports the fallback facts", () => {
  const basis = sealPublicationBasis(realWebsiteBasisInput());
  const held = createHeldPublication({
    basis,
    mode: PUBLICATION_MODE.PAGES_FALLBACK,
    publishedAt: PUBLISHED_AT
  });
  const verified = verifyPublicationRecord(held);
  assert.equal(verified.mode.mode, "pages-fallback");
  assert.equal(verified.mode.apexServedByPages, true);
  assert.equal(verified.mode.backendHeld, true);
  assert.equal(verified.published, false);
});

test("verifier rejects a tampered pages-fallback mode descriptor", () => {
  const basis = sealPublicationBasis(realPrivacyBasisInput());
  const held = createHeldPublication({
    basis,
    mode: PUBLICATION_MODE.PAGES_FALLBACK
  });
  const tampered = {
    ...held,
    mode: {
      mode: "pages-fallback",
      servedBy: "github-pages",
      apexServedByPages: true,
      backendPresent: true,
      backendHeld: false
    }
  };
  assert.throws(
    () => verifyPublicationRecord(tampered),
    (error) => error.code === "PUBLICATION_MODE_INVALID"
  );
});
