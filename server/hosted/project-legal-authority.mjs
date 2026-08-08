import { timingSafeEqual } from "node:crypto";

import { invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const PROJECT_LEGAL_SCHEMA =
  "sitesourcery.project-legal-authority/v3";
export const PROJECT_LEGAL_ACCEPTANCE_SCHEMA =
  "sitesourcery.project-legal-acceptance/v3";
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
const SEALED_V3_VERSION =
  /^SS-HOSTED-PRIVACY-[0-9]{4}-[0-9]{2}-[0-9]{2}-V3$/u;
const FIXTURE_V3_VERSION =
  /^SS-HOSTED-PRIVACY-(?:[0-9]{4}-[0-9]{2}-[0-9]{2}|TEST)-V3$/u;

// This is the only production constants handoff. The legal lane replaces the
// null V3 fields with the reviewed bytes/date before cutover. No caller may
// infer or synthesize them.
export const UNSEALED_PRIVACY_V3_CONSTANTS = Object.freeze({
  version: V3_PRIVACY_VERSION,
  contentDigest: null,
  contentUri: null,
  effectiveAt: null,
  byteCount: null,
  artifactUri: null,
  authorityDigest: null
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

function resolvedV3(constants, fixture) {
  const versionPattern = fixture ? FIXTURE_V3_VERSION : SEALED_V3_VERSION;
  return constants?.version !== V3_PRIVACY_VERSION &&
    versionPattern.test(String(constants?.version ?? "")) &&
    validDigest(constants?.contentDigest) &&
    validUri(constants?.contentUri) &&
    Number.isSafeInteger(constants?.byteCount) &&
    constants.byteCount > 0 &&
    validUri(constants?.artifactUri) &&
    typeof constants.effectiveAt === "string" &&
    Number.isFinite(Date.parse(constants.effectiveAt));
}

function buildProjectLegalAuthority(privacyV3, fixture) {
  invariant(
    resolvedV3(privacyV3, fixture),
    "LEGAL_CONFIGURATION_REQUIRED",
    "The reviewed Privacy V3 artifact constants are not configured.",
    { status: 503 }
  );
  const documents = Object.freeze([
    Object.freeze({
      kind: "privacy",
      version: privacyV3.version,
      contentDigest: privacyV3.contentDigest,
      contentUri: privacyV3.contentUri,
      effectiveAt: privacyV3.effectiveAt
    }),
    Object.freeze({
      kind: "product",
      version: V2_PRODUCT_VERSION,
      contentDigest: V2_PRODUCT_DIGEST,
      contentUri:
        "https://sitesourcery.com/legal/website-terms/#self-service",
      effectiveAt: "2026-07-30T00:00:00.000Z"
    }),
    Object.freeze({
      kind: "website",
      version: V2_PRODUCT_VERSION,
      contentDigest: V2_PRODUCT_DIGEST,
      contentUri: "https://sitesourcery.com/legal/website-terms/",
      effectiveAt: "2026-07-30T00:00:00.000Z"
    })
  ]);
  const authorityDigest = privacyV3.authorityDigest;
  invariant(
    validDigest(authorityDigest) &&
      sameDigest(
        authorityDigest,
        digest(canonicalJson({
          documents,
          schema: PROJECT_LEGAL_SCHEMA
        }))
      ),
    "LEGAL_CONFIGURATION_REQUIRED",
    "The reviewed Privacy V3 authority digest is not configured.",
    { status: 503 }
  );
  const artifactBindings = Object.freeze([
    Object.freeze({
      kind: "privacy",
      artifactUri: privacyV3.artifactUri,
      artifactSha256: privacyV3.contentDigest,
      byteCount: privacyV3.byteCount,
      mediaType: "text/html; charset=utf-8"
    }),
    Object.freeze({ kind: "product", artifactUri: null }),
    Object.freeze({ kind: "website", artifactUri: null })
  ]);
  const documentBindings = Object.freeze([
    Object.freeze({ kind: "privacy", id: "00000000-0000-4000-8000-000000000048" }),
    Object.freeze({ kind: "product", id: "00000000-0000-4000-8000-000000000021" }),
    Object.freeze({ kind: "website", id: "00000000-0000-4000-8000-000000000023" })
  ]);
  return Object.freeze({
    schema: PROJECT_LEGAL_SCHEMA,
    acceptanceStatement: PROJECT_LEGAL_ACCEPTANCE_STATEMENT,
    authorityDigest,
    documents,
    artifactBindings,
    documentBindings
  });
}

export function createProjectLegalAuthority({
  privacyV3 = UNSEALED_PRIVACY_V3_CONSTANTS
} = {}) {
  return buildProjectLegalAuthority(privacyV3, false);
}

export function createProjectLegalAuthorityFromEnvironment(
  environment = process.env
) {
  const names = [
    "SITESOURCERY_HOSTED_PRIVACY_V3_VERSION",
    "SITESOURCERY_HOSTED_PRIVACY_V3_SHA256",
    "SITESOURCERY_HOSTED_PRIVACY_V3_URI",
    "SITESOURCERY_HOSTED_PRIVACY_V3_EFFECTIVE_AT",
    "SITESOURCERY_HOSTED_PRIVACY_V3_BYTE_COUNT",
    "SITESOURCERY_HOSTED_PRIVACY_V3_ARTIFACT_URI",
    "SITESOURCERY_HOSTED_PRIVACY_V3_AUTHORITY_SHA256"
  ];
  const supplied = names.map((name) => environment[name]);
  if (supplied.every((value) => value === undefined || value === "")) {
    return Object.freeze({
      authority: null,
      diagnostic: Object.freeze({
        state: "held",
        code: "LEGAL_CONFIGURATION_REQUIRED",
        reason: "Privacy V3 constants are not sealed."
      })
    });
  }
  try {
    return Object.freeze({
      authority: createProjectLegalAuthority({
        privacyV3: {
          version: environment.SITESOURCERY_HOSTED_PRIVACY_V3_VERSION,
          contentDigest: environment.SITESOURCERY_HOSTED_PRIVACY_V3_SHA256,
          contentUri: environment.SITESOURCERY_HOSTED_PRIVACY_V3_URI,
          effectiveAt: environment.SITESOURCERY_HOSTED_PRIVACY_V3_EFFECTIVE_AT,
          byteCount: Number(environment.SITESOURCERY_HOSTED_PRIVACY_V3_BYTE_COUNT),
          artifactUri: environment.SITESOURCERY_HOSTED_PRIVACY_V3_ARTIFACT_URI,
          authorityDigest:
            environment.SITESOURCERY_HOSTED_PRIVACY_V3_AUTHORITY_SHA256
        }
      }),
      diagnostic: null
    });
  } catch (error) {
    return Object.freeze({
      authority: null,
      diagnostic: Object.freeze({
        state: "held",
        code: "LEGAL_CONFIGURATION_REQUIRED",
        reason: "Privacy V3 constants are incomplete or invalid.",
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
export function createProjectLegalAuthorityFixture({ privacyV3 } = {}) {
  invariant(
    privacyV3 && privacyV3.version !== V3_PRIVACY_VERSION,
    "LEGAL_CONFIGURATION_REQUIRED",
    "A distinct sealed test fixture is required.",
    { status: 503 }
  );
  return buildProjectLegalAuthority(privacyV3, true);
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
    input.schema === PROJECT_LEGAL_ACCEPTANCE_SCHEMA &&
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
