// Held legal publication semantics.
//
// This module makes explicit the separation between two concepts that the
// release pipeline currently conflates:
//
//   * the immutable approved/effective BASIS — the sealed legal-authority tuple
//     (approved version alias + effective UTC instant + content digest + byte
//     count). It is owner-sealed and byte-preserved. It is REFERENCED here,
//     never re-derived, defaulted, or mutated; and
//   * the public `publishedAt` — the operational fact of when a Pages artifact
//     was actually published.
//
// These are separately represented and never collapsed. A publication is HELD
// by default: carrying a sealed basis (and even recording that a Pages artifact
// was served) produces no hosted publish effect. A publish effect only exists
// once a single-use, owner-authorized receipt is minted and verified
// (see legal-publication-control.mjs / legal-publication-verify.mjs).
//
// This packet is additive. It wires nothing into a composition root and grants
// no capability. It does not alter any legal content, hash, alias string, or
// sealed artifact; the V2/V3/V4 aliases and unsealed sentinels below are
// REFERENCED from the existing project legal authority, not re-declared.

import { invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";
import {
  UNSEALED_PRIVACY_V3_CONSTANTS,
  UNSEALED_WEBSITE_TERMS_V3_CONSTANTS,
  UNSEALED_PRIVACY_V4_CONSTANTS,
  UNSEALED_WEBSITE_TERMS_V4_CONSTANTS,
  constantTimeDigestEqual,
  v2ContinuityDocuments
} from "./project-legal-authority.mjs";

export const LEGAL_PUBLICATION_SCHEMA =
  "sitesourcery.legal-publication/v1";
export const LEGAL_PUBLICATION_BASIS_SCHEMA =
  "sitesourcery.legal-publication-basis/v1";
export const OWNER_PUBLICATION_RECEIPT_SCHEMA =
  "sitesourcery.owner-publication-receipt/v1";

// The two explicit, mutually distinct serving modes. The Pages-only fallback
// (apex served by GitHub Pages, hosted backend absent/held) is a first-class
// named mode, never implied by the absence of a hosted backend.
export const PUBLICATION_MODE = Object.freeze({
  HOSTED_BACKEND: "hosted-backend",
  PAGES_FALLBACK: "pages-fallback"
});

// The exact unsealed sentinels, referenced from the legal authority. A basis
// carrying any of these version aliases is unsealed and must fail closed —
// exactly as project-legal-authority rejects them.
export const UNSEALED_PUBLICATION_SENTINELS = Object.freeze([
  UNSEALED_PRIVACY_V3_CONSTANTS.version,
  UNSEALED_WEBSITE_TERMS_V3_CONSTANTS.version,
  UNSEALED_PRIVACY_V4_CONSTANTS.version,
  UNSEALED_WEBSITE_TERMS_V4_CONSTANTS.version
]);

// The exact V2 continuity aliases, referenced (never re-typed) from the legal
// authority's frozen continuity documents.
const V2_CONTINUITY = v2ContinuityDocuments();
export const V2_PUBLICATION_ALIASES = Object.freeze([
  V2_CONTINUITY.privacy.version,
  V2_CONTINUITY.website.version
]);

const SHA256 = /^[a-f0-9]{64}$/u;
// A sealed legal-authority alias: SS-HOSTED-PRIVACY or -WEBSITE-TERMS, a
// date-stamped (or TEST-fixture) body, sealed at V2/V3/V4. The four UNSEALED
// sentinels never match this pattern, and are additionally rejected by list.
const SEALED_ALIAS =
  /^SS-HOSTED-(?:PRIVACY|WEBSITE-TERMS)-(?:[0-9]{4}-[0-9]{2}-[0-9]{2}|TEST)-V[234]$/u;
const HTTPS_URI = /^https:\/\/[^\s]+$/u;
const RECEIPT_ID_PREFIX = "ss-legal-pub";

export function isCanonicalUtc(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    new Date(Date.parse(value)).toISOString() === value;
}

export function isUnsealedPublicationVersion(version) {
  return UNSEALED_PUBLICATION_SENTINELS.includes(version);
}

function isSealedAlias(version) {
  return typeof version === "string" &&
    !isUnsealedPublicationVersion(version) &&
    SEALED_ALIAS.test(version);
}

// The immutable digest OF the referenced basis tuple. This digests the sealed
// tuple; it does not re-derive or replace any legal content.
export function publicationBasisDigest(basis) {
  return digest(canonicalJson({
    schema: LEGAL_PUBLICATION_BASIS_SCHEMA,
    kind: basis?.kind ?? null,
    version: basis?.version ?? null,
    effectiveAt: basis?.effectiveAt ?? null,
    contentDigest: basis?.contentDigest ?? null,
    byteCount: basis?.byteCount ?? null,
    authorityDigest: basis?.authorityDigest ?? null,
    artifactUri: basis?.artifactUri ?? null
  }));
}

// Validate that a supplied legal-authority tuple is sealed, then freeze it as a
// referenceable publication basis. Fails closed on the unsealed sentinel, a
// non-sealed alias, or any absent/invalid tuple field. Nothing is defaulted.
export function sealPublicationBasis(input) {
  invariant(
    input && typeof input === "object" && !Array.isArray(input),
    "PUBLICATION_BASIS_MISSING",
    "A publication basis tuple is required.",
    { status: 400 }
  );
  invariant(
    !isUnsealedPublicationVersion(input.version),
    "PUBLICATION_BASIS_UNSEALED",
    "The publication basis is the unsealed sentinel and cannot be published.",
    { status: 409 }
  );
  invariant(
    isSealedAlias(input.version),
    "PUBLICATION_BASIS_UNSEALED",
    "The publication basis version is not a sealed legal-authority alias.",
    { status: 409 }
  );
  invariant(
    typeof input.contentDigest === "string" && SHA256.test(input.contentDigest),
    "PUBLICATION_BASIS_UNSEALED",
    "The publication basis content digest is not sealed.",
    { status: 409 }
  );
  invariant(
    Number.isSafeInteger(input.byteCount) && input.byteCount > 0,
    "PUBLICATION_BASIS_UNSEALED",
    "The publication basis byte count is not sealed.",
    { status: 409 }
  );
  invariant(
    isCanonicalUtc(input.effectiveAt),
    "PUBLICATION_BASIS_UNSEALED",
    "The publication basis effective instant is not a sealed UTC time.",
    { status: 409 }
  );
  const authorityDigest = input.authorityDigest ?? null;
  invariant(
    authorityDigest === null ||
      (typeof authorityDigest === "string" && SHA256.test(authorityDigest)),
    "PUBLICATION_BASIS_UNSEALED",
    "The publication basis authority digest is invalid.",
    { status: 409 }
  );
  const artifactUri = input.artifactUri ?? null;
  invariant(
    artifactUri === null ||
      (typeof artifactUri === "string" && HTTPS_URI.test(artifactUri)),
    "PUBLICATION_BASIS_UNSEALED",
    "The publication basis artifact URI is invalid.",
    { status: 409 }
  );
  const kind = input.kind ?? null;
  invariant(
    kind === null ||
      kind === "privacy" || kind === "website" || kind === "product",
    "PUBLICATION_BASIS_UNSEALED",
    "The publication basis kind is invalid.",
    { status: 409 }
  );
  const tuple = {
    schema: LEGAL_PUBLICATION_BASIS_SCHEMA,
    sealed: true,
    kind,
    version: input.version,
    effectiveAt: input.effectiveAt,
    contentDigest: input.contentDigest,
    byteCount: input.byteCount,
    authorityDigest,
    artifactUri
  };
  return Object.freeze({
    ...tuple,
    basisDigest: publicationBasisDigest(tuple)
  });
}

// Reference an already-sealed basis without re-deriving it: verify its digest
// integrity and return the same frozen object. Fall back to sealing a raw
// tuple. This is how a held publication and an owner receipt share one basis.
export function ensureSealedBasis(basis) {
  if (
    basis && typeof basis === "object" &&
    basis.schema === LEGAL_PUBLICATION_BASIS_SCHEMA &&
    typeof basis.basisDigest === "string"
  ) {
    invariant(
      basis.sealed === true &&
        !isUnsealedPublicationVersion(basis.version) &&
        constantTimeDigestEqual(
          basis.basisDigest,
          publicationBasisDigest(basis)
        ),
      "PUBLICATION_BASIS_MISMATCH",
      "The supplied sealed basis failed integrity verification.",
      { status: 409 }
    );
    return basis;
  }
  return sealPublicationBasis(basis);
}

export function requirePublicationMode(mode) {
  invariant(
    mode === PUBLICATION_MODE.HOSTED_BACKEND ||
      mode === PUBLICATION_MODE.PAGES_FALLBACK,
    "PUBLICATION_MODE_INVALID",
    "The publication mode must be the hosted-backend or the pages-fallback mode.",
    { status: 400 }
  );
  return mode;
}

// The explicit facts of each mode. The pages-fallback mode is the apex served
// by GitHub Pages with the hosted backend absent and held; it is distinct from
// the hosted-backend mode in every field, not merely by name.
export function describePublicationMode(mode) {
  requirePublicationMode(mode);
  if (mode === PUBLICATION_MODE.PAGES_FALLBACK) {
    return Object.freeze({
      mode: PUBLICATION_MODE.PAGES_FALLBACK,
      servedBy: "github-pages",
      apexServedByPages: true,
      backendPresent: false,
      backendHeld: true
    });
  }
  return Object.freeze({
    mode: PUBLICATION_MODE.HOSTED_BACKEND,
    servedBy: "hosted-selfhost",
    apexServedByPages: false,
    backendPresent: true,
    backendHeld: false
  });
}

export function verifyModeDescriptor(descriptor) {
  invariant(
    descriptor && typeof descriptor === "object" && !Array.isArray(descriptor),
    "PUBLICATION_MODE_INVALID",
    "A publication mode descriptor is required.",
    { status: 409 }
  );
  requirePublicationMode(descriptor.mode);
  invariant(
    canonicalJson(descriptor) ===
      canonicalJson(describePublicationMode(descriptor.mode)),
    "PUBLICATION_MODE_INVALID",
    "The publication mode descriptor is inconsistent.",
    { status: 409 }
  );
  return descriptor;
}

// Deterministic effect digest for an owner receipt. Both the constructor and
// the verifier compute it here so they can never drift. The sealed basis's
// effectiveAt and the operational publishedAt are separate inputs — they are
// bound together in one tuple but never collapsed into one value.
export function computeOwnerEffectDigest({
  basisDigest,
  effectiveAt,
  publishedAt,
  mode,
  ownerId,
  authorization
}) {
  return digest(canonicalJson({
    schema: OWNER_PUBLICATION_RECEIPT_SCHEMA,
    basisDigest,
    effectiveAt,
    publishedAt,
    mode,
    ownerId,
    authorization
  }));
}

export function ownerReceiptId(effectDigest) {
  return `${RECEIPT_ID_PREFIX}:${effectDigest}`;
}

// A publication state that carries the immutable basis (referenced) alongside
// an optional `publishedAt`, and is HELD by default. It never carries a publish
// effect: `state` is "held", `published` is false, `effect` is null. The
// optional `publishedAt` records the operational fact that a Pages artifact was
// served (relevant in pages-fallback mode) — it is never generated or defaulted
// here, and it never turns a held record into a hosted publish effect.
export function createHeldPublication({
  basis,
  mode,
  publishedAt = null
} = {}) {
  const sealedBasis = ensureSealedBasis(basis);
  const modeDescriptor = describePublicationMode(requirePublicationMode(mode));
  invariant(
    publishedAt === null || isCanonicalUtc(publishedAt),
    "PUBLICATION_OWNER_FACT_REQUIRED",
    "publishedAt must be a supplied canonical UTC instant or null; it is never generated.",
    { status: 400 }
  );
  return Object.freeze({
    schema: LEGAL_PUBLICATION_SCHEMA,
    state: "held",
    published: false,
    effect: null,
    mode: modeDescriptor,
    basis: sealedBasis,
    basisDigest: sealedBasis.basisDigest,
    publishedAt
  });
}
