import { timingSafeEqual } from "node:crypto";

import { invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const PROJECT_LEGAL_SCHEMA =
  "sitesourcery.project-legal-authority/v3";
export const PROJECT_LEGAL_ACCEPTANCE_SCHEMA =
  "sitesourcery.project-legal-acceptance/v3";
export const PROJECT_LEGAL_V4_SCHEMA =
  "sitesourcery.project-legal-authority/v4";
export const PROJECT_LEGAL_V4_ACCEPTANCE_SCHEMA =
  "sitesourcery.project-legal-acceptance/v4";
export const PROJECT_LEGAL_V5_SCHEMA =
  "sitesourcery.project-legal-authority/v5";
export const PROJECT_LEGAL_V5_ACCEPTANCE_SCHEMA =
  "sitesourcery.project-legal-acceptance/v5";
export const PROJECT_LEGAL_ACCEPTANCE_STATEMENT =
  "accepted_exact_project_terms_and_acknowledged_privacy";
export const PROJECT_LEGAL_KINDS = Object.freeze([
  "privacy",
  "product",
  "website"
]);

const V2_PRODUCT_DIGEST =
  "bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196";
const V2_PRIVACY_DIGEST =
  "b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b";
const V2_PRODUCT_VERSION = "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2";
const V2_PRIVACY_VERSION = "SS-HOSTED-PRIVACY-2026-07-30-V2";
const V3_PRIVACY_VERSION = "SS-HOSTED-PRIVACY-V3-UNSEALED";
const V3_WEBSITE_TERMS_VERSION = "SS-HOSTED-WEBSITE-TERMS-V3-UNSEALED";
const SEALED_V3_VERSION =
  /^SS-HOSTED-PRIVACY-([0-9]{4}-[0-9]{2}-[0-9]{2})-V3$/u;
const SEALED_WEBSITE_V3_VERSION =
  /^SS-HOSTED-WEBSITE-TERMS-([0-9]{4}-[0-9]{2}-[0-9]{2})-V3$/u;
const FIXTURE_V3_VERSION =
  /^SS-HOSTED-PRIVACY-(?:([0-9]{4}-[0-9]{2}-[0-9]{2})|TEST)-V3$/u;
const FIXTURE_WEBSITE_V3_VERSION =
  /^SS-HOSTED-WEBSITE-TERMS-(?:([0-9]{4}-[0-9]{2}-[0-9]{2})|TEST)-V3$/u;
const V4_PRIVACY_VERSION = "SS-HOSTED-PRIVACY-V4-UNSEALED";
const V4_WEBSITE_TERMS_VERSION =
  "SS-HOSTED-WEBSITE-TERMS-V4-UNSEALED";
const SEALED_V4_VERSION =
  /^SS-HOSTED-PRIVACY-([0-9]{4}-[0-9]{2}-[0-9]{2})-V4$/u;
const SEALED_WEBSITE_V4_VERSION =
  /^SS-HOSTED-WEBSITE-TERMS-([0-9]{4}-[0-9]{2}-[0-9]{2})-V4$/u;
const FIXTURE_V4_VERSION =
  /^SS-HOSTED-PRIVACY-(?:([0-9]{4}-[0-9]{2}-[0-9]{2})|TEST)-V4$/u;
const FIXTURE_WEBSITE_V4_VERSION =
  /^SS-HOSTED-WEBSITE-TERMS-(?:([0-9]{4}-[0-9]{2}-[0-9]{2})|TEST)-V4$/u;
const V5_PRIVACY_VERSION = "SS-HOSTED-PRIVACY-V5-UNSEALED";
const V5_WEBSITE_TERMS_VERSION =
  "SS-HOSTED-WEBSITE-TERMS-V5-UNSEALED";
const SEALED_V5_VERSION =
  /^SS-HOSTED-PRIVACY-([0-9]{4}-[0-9]{2}-[0-9]{2})-V5$/u;
const SEALED_WEBSITE_V5_VERSION =
  /^SS-HOSTED-WEBSITE-TERMS-([0-9]{4}-[0-9]{2}-[0-9]{2})-V5$/u;
const FIXTURE_V5_VERSION =
  /^SS-HOSTED-PRIVACY-(?:([0-9]{4}-[0-9]{2}-[0-9]{2})|TEST)-V5$/u;
const FIXTURE_WEBSITE_V5_VERSION =
  /^SS-HOSTED-WEBSITE-TERMS-(?:([0-9]{4}-[0-9]{2}-[0-9]{2})|TEST)-V5$/u;

// These sentinels are the only production constants handoff. The joint legal
// finalizer supplies both exact artifacts and one release tuple at cutover. No
// caller may infer or synthesize them.
export const UNSEALED_PRIVACY_V3_CONSTANTS = Object.freeze({
  version: V3_PRIVACY_VERSION,
  contentDigest: null,
  contentUri: null,
  effectiveAt: null,
  byteCount: null,
  artifactUri: null,
  authorityDigest: null
});
export const UNSEALED_WEBSITE_TERMS_V3_CONSTANTS = Object.freeze({
  version: V3_WEBSITE_TERMS_VERSION,
  contentDigest: null,
  contentUri: null,
  effectiveAt: null,
  byteCount: null,
  artifactUri: null
});
export const UNSEALED_PRIVACY_V4_CONSTANTS = Object.freeze({
  version: V4_PRIVACY_VERSION,
  contentDigest: null,
  contentUri: null,
  effectiveAt: null,
  byteCount: null,
  artifactUri: null,
  authorityDigest: null
});
export const UNSEALED_WEBSITE_TERMS_V4_CONSTANTS = Object.freeze({
  version: V4_WEBSITE_TERMS_VERSION,
  contentDigest: null,
  contentUri: null,
  effectiveAt: null,
  byteCount: null,
  artifactUri: null
});
export const UNSEALED_PRIVACY_V5_CONSTANTS = Object.freeze({
  version: V5_PRIVACY_VERSION,
  contentDigest: null,
  contentUri: null,
  effectiveAt: null,
  byteCount: null,
  artifactUri: null,
  authorityDigest: null
});
export const UNSEALED_WEBSITE_TERMS_V5_CONSTANTS = Object.freeze({
  version: V5_WEBSITE_TERMS_VERSION,
  contentDigest: null,
  contentUri: null,
  effectiveAt: null,
  byteCount: null,
  artifactUri: null
});

function validDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function sameDigest(actual, expected) {
  if (!validDigest(actual) || !validDigest(expected)) return false;
  const left = Buffer.from(actual, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function constantTimeDigestEqual(actual, expected) {
  return sameDigest(actual, expected);
}

function validUri(value) {
  return typeof value === "string" &&
    /^https:\/\/[^\s]+$/u.test(value);
}

function canonicalUtc(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    new Date(Date.parse(value)).toISOString() === value;
}

const V3_AUTHORITY = Object.freeze({
  schema: PROJECT_LEGAL_SCHEMA,
  acceptanceSchema: PROJECT_LEGAL_ACCEPTANCE_SCHEMA,
  label: "V3",
  privacySentinel: V3_PRIVACY_VERSION,
  websiteSentinel: V3_WEBSITE_TERMS_VERSION,
  privacyPattern: SEALED_V3_VERSION,
  websitePattern: SEALED_WEBSITE_V3_VERSION,
  fixturePrivacyPattern: FIXTURE_V3_VERSION,
  fixtureWebsitePattern: FIXTURE_WEBSITE_V3_VERSION,
  effectiveDateMustMatchVersion: true,
  documentIds: Object.freeze([
    "00000000-0000-4000-8000-000000000048",
    "00000000-0000-4000-8000-000000000103",
    "00000000-0000-4000-8000-000000000104"
  ])
});
const V4_AUTHORITY = Object.freeze({
  schema: PROJECT_LEGAL_V4_SCHEMA,
  acceptanceSchema: PROJECT_LEGAL_V4_ACCEPTANCE_SCHEMA,
  label: "V4",
  privacySentinel: V4_PRIVACY_VERSION,
  websiteSentinel: V4_WEBSITE_TERMS_VERSION,
  privacyPattern: SEALED_V4_VERSION,
  websitePattern: SEALED_WEBSITE_V4_VERSION,
  fixturePrivacyPattern: FIXTURE_V4_VERSION,
  fixtureWebsitePattern: FIXTURE_WEBSITE_V4_VERSION,
  effectiveDateMustMatchVersion: true,
  documentIds: Object.freeze([
    "00000000-0000-4000-8000-000000000049",
    "00000000-0000-4000-8000-000000000105",
    "00000000-0000-4000-8000-000000000106"
  ])
});
const V5_AUTHORITY = Object.freeze({
  schema: PROJECT_LEGAL_V5_SCHEMA,
  acceptanceSchema: PROJECT_LEGAL_V5_ACCEPTANCE_SCHEMA,
  label: "V5",
  privacySentinel: V5_PRIVACY_VERSION,
  websiteSentinel: V5_WEBSITE_TERMS_VERSION,
  privacyPattern: SEALED_V5_VERSION,
  websitePattern: SEALED_WEBSITE_V5_VERSION,
  fixturePrivacyPattern: FIXTURE_V5_VERSION,
  fixtureWebsitePattern: FIXTURE_WEBSITE_V5_VERSION,
  effectiveDateMustMatchVersion: false,
  documentIds: Object.freeze([
    "00000000-0000-4000-8000-000000000149",
    "00000000-0000-4000-8000-000000000150",
    "00000000-0000-4000-8000-000000000151"
  ])
});

function resolved(constants, fixture, kind, release) {
  const sentinel = kind === "privacy"
    ? release.privacySentinel
    : release.websiteSentinel;
  const versionPattern = kind === "privacy"
    ? (fixture ? release.fixturePrivacyPattern : release.privacyPattern)
    : (fixture ? release.fixtureWebsitePattern : release.websitePattern);
  const version = String(constants?.version ?? "");
  const match = version.match(versionPattern);
  const expectedArtifactUri = kind === "privacy"
    ? `https://sitesourcery.com/legal/privacy/versions/${version}/`
    : `https://sitesourcery.com/legal/website-terms/versions/${version}/`;
  return constants?.version !== sentinel &&
    match !== null &&
    validDigest(constants?.contentDigest) &&
    validUri(constants?.contentUri) &&
    Number.isSafeInteger(constants?.byteCount) &&
    constants.byteCount > 0 &&
    validUri(constants?.artifactUri) &&
    canonicalUtc(constants.effectiveAt) &&
    (!release.effectiveDateMustMatchVersion || (fixture && match[1] === undefined)
      ? true
      : constants.effectiveAt.slice(0, 10) === match[1]) &&
    (fixture
      ? true
      : constants.contentUri === expectedArtifactUri &&
        constants.artifactUri === expectedArtifactUri);
}

function buildProjectLegalAuthority(
  privacy,
  websiteTerms,
  authorityDigest,
  fixture,
  release
) {
  invariant(
    resolved(privacy, fixture, "privacy", release)
      && resolved(websiteTerms, fixture, "website", release)
      && privacy.effectiveAt === websiteTerms.effectiveAt,
    "LEGAL_CONFIGURATION_REQUIRED",
    `The reviewed joint Privacy ${release.label} and Website Terms ${release.label} constants are not configured.`,
    { status: 503 }
  );
  const documents = Object.freeze([
    Object.freeze({
      kind: "privacy",
      version: privacy.version,
      contentDigest: privacy.contentDigest,
      contentUri: privacy.contentUri,
      effectiveAt: privacy.effectiveAt
    }),
    Object.freeze({
      kind: "product",
      version: websiteTerms.version,
      contentDigest: websiteTerms.contentDigest,
      contentUri:
        "https://sitesourcery.com/legal/website-terms/#self-service",
      effectiveAt: websiteTerms.effectiveAt
    }),
    Object.freeze({
      kind: "website",
      version: websiteTerms.version,
      contentDigest: websiteTerms.contentDigest,
      contentUri: "https://sitesourcery.com/legal/website-terms/",
      effectiveAt: websiteTerms.effectiveAt
    })
  ]);
  invariant(
    validDigest(authorityDigest) &&
      sameDigest(
        authorityDigest,
        digest(canonicalJson({
          documents,
          schema: release.schema
        }))
      ),
    "LEGAL_CONFIGURATION_REQUIRED",
    `The reviewed joint legal ${release.label} authority digest is not configured.`,
    { status: 503 }
  );
  const artifactBindings = Object.freeze([
    Object.freeze({
      kind: "privacy",
      artifactUri: privacy.artifactUri,
      artifactSha256: privacy.contentDigest,
      byteCount: privacy.byteCount,
      mediaType: "text/html; charset=utf-8"
    }),
    Object.freeze({ kind: "product", artifactUri: null }),
    Object.freeze({
      kind: "website",
      artifactUri: websiteTerms.artifactUri,
      artifactSha256: websiteTerms.contentDigest,
      byteCount: websiteTerms.byteCount,
      mediaType: "text/html; charset=utf-8"
    })
  ]);
  const documentBindings = Object.freeze(PROJECT_LEGAL_KINDS.map(
    (kind, index) => Object.freeze({ kind, id: release.documentIds[index] })
  ));
  return Object.freeze({
    schema: release.schema,
    acceptanceSchema: release.acceptanceSchema,
    acceptanceStatement: PROJECT_LEGAL_ACCEPTANCE_STATEMENT,
    authorityDigest,
    documents,
    artifactBindings,
    documentBindings
  });
}

export function createProjectLegalAuthority({
  privacyV3 = UNSEALED_PRIVACY_V3_CONSTANTS,
  websiteTermsV3 = UNSEALED_WEBSITE_TERMS_V3_CONSTANTS,
  authorityDigest = privacyV3.authorityDigest
} = {}) {
  return buildProjectLegalAuthority(
    privacyV3,
    websiteTermsV3,
    authorityDigest,
    false,
    V3_AUTHORITY
  );
}

export function createProjectLegalAuthorityV4({
  privacyV4 = UNSEALED_PRIVACY_V4_CONSTANTS,
  websiteTermsV4 = UNSEALED_WEBSITE_TERMS_V4_CONSTANTS,
  authorityDigest = privacyV4.authorityDigest
} = {}) {
  return buildProjectLegalAuthority(
    privacyV4,
    websiteTermsV4,
    authorityDigest,
    false,
    V4_AUTHORITY
  );
}

export function createProjectLegalAuthorityV5({
  privacyV5 = UNSEALED_PRIVACY_V5_CONSTANTS,
  websiteTermsV5 = UNSEALED_WEBSITE_TERMS_V5_CONSTANTS,
  authorityDigest = privacyV5.authorityDigest
} = {}) {
  return buildProjectLegalAuthority(
    privacyV5,
    websiteTermsV5,
    authorityDigest,
    false,
    V5_AUTHORITY
  );
}

export function createProjectLegalAuthorityFromEnvironment(
  environment = process.env
) {
  const v5Names = [
    "SITESOURCERY_HOSTED_PRIVACY_V5_VERSION",
    "SITESOURCERY_HOSTED_PRIVACY_V5_SHA256",
    "SITESOURCERY_HOSTED_PRIVACY_V5_URI",
    "SITESOURCERY_HOSTED_PRIVACY_V5_EFFECTIVE_AT",
    "SITESOURCERY_HOSTED_PRIVACY_V5_BYTE_COUNT",
    "SITESOURCERY_HOSTED_PRIVACY_V5_ARTIFACT_URI",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_VERSION",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_SHA256",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_URI",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_EFFECTIVE_AT",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_BYTE_COUNT",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_ARTIFACT_URI",
    "SITESOURCERY_HOSTED_LEGAL_V5_AUTHORITY_SHA256"
  ];
  const v4Names = [
    "SITESOURCERY_HOSTED_PRIVACY_V4_VERSION",
    "SITESOURCERY_HOSTED_PRIVACY_V4_SHA256",
    "SITESOURCERY_HOSTED_PRIVACY_V4_URI",
    "SITESOURCERY_HOSTED_PRIVACY_V4_EFFECTIVE_AT",
    "SITESOURCERY_HOSTED_PRIVACY_V4_BYTE_COUNT",
    "SITESOURCERY_HOSTED_PRIVACY_V4_ARTIFACT_URI",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_VERSION",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_SHA256",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_URI",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_EFFECTIVE_AT",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_BYTE_COUNT",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_ARTIFACT_URI",
    "SITESOURCERY_HOSTED_LEGAL_V4_AUTHORITY_SHA256"
  ];
  const v3Names = [
    "SITESOURCERY_HOSTED_PRIVACY_V3_VERSION",
    "SITESOURCERY_HOSTED_PRIVACY_V3_SHA256",
    "SITESOURCERY_HOSTED_PRIVACY_V3_URI",
    "SITESOURCERY_HOSTED_PRIVACY_V3_EFFECTIVE_AT",
    "SITESOURCERY_HOSTED_PRIVACY_V3_BYTE_COUNT",
    "SITESOURCERY_HOSTED_PRIVACY_V3_ARTIFACT_URI",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_VERSION",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_SHA256",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_URI",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_EFFECTIVE_AT",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_BYTE_COUNT",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_ARTIFACT_URI",
    "SITESOURCERY_HOSTED_LEGAL_V3_AUTHORITY_SHA256"
  ];
  const anySupplied = (names) => names.some(
    (name) => environment[name] !== undefined
  );
  const v5Supplied = anySupplied(v5Names);
  const v4Supplied = anySupplied(v4Names);
  const v3Supplied = anySupplied(v3Names);
  if (!v5Supplied && !v4Supplied && !v3Supplied) {
    return Object.freeze({
      authority: null,
      diagnostic: Object.freeze({
        state: "held",
        code: "LEGAL_CONFIGURATION_REQUIRED",
        reason: "Joint Privacy V5 and Website Terms V5 constants are not sealed."
      })
    });
  }
  const selected = v5Supplied ? "V5" : (v4Supplied ? "V4" : "V3");
  try {
    if (v5Supplied) {
      return Object.freeze({
        authority: createProjectLegalAuthorityV5({
          privacyV5: {
            version: environment.SITESOURCERY_HOSTED_PRIVACY_V5_VERSION,
            contentDigest: environment.SITESOURCERY_HOSTED_PRIVACY_V5_SHA256,
            contentUri: environment.SITESOURCERY_HOSTED_PRIVACY_V5_URI,
            effectiveAt: environment.SITESOURCERY_HOSTED_PRIVACY_V5_EFFECTIVE_AT,
            byteCount: Number(environment.SITESOURCERY_HOSTED_PRIVACY_V5_BYTE_COUNT),
            artifactUri: environment.SITESOURCERY_HOSTED_PRIVACY_V5_ARTIFACT_URI
          },
          websiteTermsV5: {
            version: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_VERSION,
            contentDigest: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_SHA256,
            contentUri: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_URI,
            effectiveAt: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_EFFECTIVE_AT,
            byteCount: Number(environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_BYTE_COUNT),
            artifactUri: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_ARTIFACT_URI
          },
          authorityDigest:
            environment.SITESOURCERY_HOSTED_LEGAL_V5_AUTHORITY_SHA256
        }),
        diagnostic: null
      });
    }
    if (v4Supplied) {
      return Object.freeze({
        authority: createProjectLegalAuthorityV4({
          privacyV4: {
            version: environment.SITESOURCERY_HOSTED_PRIVACY_V4_VERSION,
            contentDigest: environment.SITESOURCERY_HOSTED_PRIVACY_V4_SHA256,
            contentUri: environment.SITESOURCERY_HOSTED_PRIVACY_V4_URI,
            effectiveAt: environment.SITESOURCERY_HOSTED_PRIVACY_V4_EFFECTIVE_AT,
            byteCount: Number(environment.SITESOURCERY_HOSTED_PRIVACY_V4_BYTE_COUNT),
            artifactUri: environment.SITESOURCERY_HOSTED_PRIVACY_V4_ARTIFACT_URI
          },
          websiteTermsV4: {
            version: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_VERSION,
            contentDigest: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_SHA256,
            contentUri: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_URI,
            effectiveAt: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_EFFECTIVE_AT,
            byteCount: Number(environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_BYTE_COUNT),
            artifactUri: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_ARTIFACT_URI
          },
          authorityDigest:
            environment.SITESOURCERY_HOSTED_LEGAL_V4_AUTHORITY_SHA256
        }),
        diagnostic: null
      });
    }
    return Object.freeze({
      authority: createProjectLegalAuthority({
        privacyV3: {
          version: environment.SITESOURCERY_HOSTED_PRIVACY_V3_VERSION,
          contentDigest: environment.SITESOURCERY_HOSTED_PRIVACY_V3_SHA256,
          contentUri: environment.SITESOURCERY_HOSTED_PRIVACY_V3_URI,
          effectiveAt: environment.SITESOURCERY_HOSTED_PRIVACY_V3_EFFECTIVE_AT,
          byteCount: Number(environment.SITESOURCERY_HOSTED_PRIVACY_V3_BYTE_COUNT),
          artifactUri: environment.SITESOURCERY_HOSTED_PRIVACY_V3_ARTIFACT_URI
        },
        websiteTermsV3: {
          version: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_VERSION,
          contentDigest: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_SHA256,
          contentUri: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_URI,
          effectiveAt: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_EFFECTIVE_AT,
          byteCount: Number(environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_BYTE_COUNT),
          artifactUri: environment.SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_ARTIFACT_URI
        },
        authorityDigest: environment.SITESOURCERY_HOSTED_LEGAL_V3_AUTHORITY_SHA256
      }),
      diagnostic: null
    });
  } catch (error) {
    return Object.freeze({
      authority: null,
      diagnostic: Object.freeze({
        state: "held",
        code: "LEGAL_CONFIGURATION_REQUIRED",
        reason: `Joint legal ${selected} constants are incomplete or invalid.`,
        detail: error?.code ?? null
      })
    });
  }
}

export function publicProjectLegalAuthority(authority) {
  return Object.freeze({
    schema: authority.schema,
    acceptanceStatement: authority.acceptanceStatement,
    authorityDigest: authority.authorityDigest,
    documents: authority.documents
  });
}

// Test-only constructor. Production composition must use
// createProjectLegalAuthority and therefore can never accept a fixture
// version or the unsealed sentinel.
export function createProjectLegalAuthorityFixture({
  privacyV3, websiteTermsV3, authorityDigest = privacyV3?.authorityDigest
} = {}) {
  invariant(
    privacyV3 && privacyV3.version !== V3_PRIVACY_VERSION,
    "LEGAL_CONFIGURATION_REQUIRED",
    "A distinct sealed test fixture is required.",
    { status: 503 }
  );
  return buildProjectLegalAuthority(
    privacyV3,
    websiteTermsV3,
    authorityDigest,
    true,
    V3_AUTHORITY
  );
}

export function createProjectLegalAuthorityV4Fixture({
  privacyV4, websiteTermsV4, authorityDigest = privacyV4?.authorityDigest
} = {}) {
  invariant(
    privacyV4 && privacyV4.version !== V4_PRIVACY_VERSION,
    "LEGAL_CONFIGURATION_REQUIRED",
    "A distinct sealed V4 test fixture is required.",
    { status: 503 }
  );
  return buildProjectLegalAuthority(
    privacyV4,
    websiteTermsV4,
    authorityDigest,
    true,
    V4_AUTHORITY
  );
}

export function createProjectLegalAuthorityV5Fixture({
  privacyV5, websiteTermsV5, authorityDigest = privacyV5?.authorityDigest
} = {}) {
  invariant(
    privacyV5 && privacyV5.version !== V5_PRIVACY_VERSION,
    "LEGAL_CONFIGURATION_REQUIRED",
    "A distinct sealed V5 test fixture is required.",
    { status: 503 }
  );
  return buildProjectLegalAuthority(
    privacyV5,
    websiteTermsV5,
    authorityDigest,
    true,
    V5_AUTHORITY
  );
}

function exactDocument(document) {
  invariant(
    document && typeof document === "object" && !Array.isArray(document) &&
      JSON.stringify(Object.keys(document).sort()) ===
        JSON.stringify([
          "contentDigest",
          "contentUri",
          "effectiveAt",
          "kind",
          "version"
        ]),
    "LEGAL_ACCEPTANCE_INVALID",
    "The legal document bundle is invalid.",
    { status: 400 }
  );
  return Object.freeze({ ...document });
}

export function validateProjectLegalAcceptance(input, authority) {
  invariant(
    input && typeof input === "object" && !Array.isArray(input) &&
      JSON.stringify(Object.keys(input).sort()) ===
        JSON.stringify([
          "acceptanceStatement",
          "authorityDigest",
          "documents",
          "schema"
        ]),
    "LEGAL_ACCEPTANCE_INVALID",
    "The exact legal acceptance object is required.",
    { status: 400 }
  );
  invariant(
    input.schema === authority.acceptanceSchema &&
      input.acceptanceStatement === PROJECT_LEGAL_ACCEPTANCE_STATEMENT,
    "LEGAL_ACCEPTANCE_INVALID",
    "The legal acceptance schema or statement is invalid.",
    { status: 400 }
  );
  invariant(
    Array.isArray(input.documents) && input.documents.length === 3,
    "LEGAL_ACCEPTANCE_INVALID",
    "Exactly three legal documents are required.",
    { status: 400 }
  );
  const documents = input.documents.map(exactDocument);
  invariant(
    documents.every((document, index) =>
      document.kind === authority.documents[index]?.kind &&
      document.version === authority.documents[index]?.version &&
      sameDigest(document.contentDigest, authority.documents[index]?.contentDigest) &&
      document.contentUri === authority.documents[index]?.contentUri &&
      document.effectiveAt === authority.documents[index]?.effectiveAt
    ),
    "LEGAL_AUTHORITY_CHANGED",
    "The reviewed legal authority changed. Refresh and accept the current documents.",
    { status: 409 }
  );
  invariant(
    sameDigest(input.authorityDigest, authority.authorityDigest),
    "LEGAL_AUTHORITY_CHANGED",
    "The reviewed legal authority changed. Refresh and accept the current documents.",
    { status: 409 }
  );
  return Object.freeze({
    schema: input.schema,
    acceptanceStatement: input.acceptanceStatement,
    authorityDigest: input.authorityDigest,
    documents: Object.freeze(documents)
  });
}

export function digestUserAgent(value) {
  return typeof value === "string" && value.length > 0
    ? digest(value)
    : null;
}

export function v2ContinuityDocuments() {
  return Object.freeze({
    product: { version: V2_PRODUCT_VERSION, contentDigest: V2_PRODUCT_DIGEST },
    privacy: { version: V2_PRIVACY_VERSION, contentDigest: V2_PRIVACY_DIGEST },
    website: { version: V2_PRODUCT_VERSION, contentDigest: V2_PRODUCT_DIGEST }
  });
}
