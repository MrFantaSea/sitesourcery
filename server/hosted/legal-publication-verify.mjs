// Fail-closed verifier for held legal publication records and owner receipts.
//
// Every check rejects (throws a HostedError) rather than tolerating a doubtful
// state. It fails closed when the basis is unsealed, missing, or mismatched,
// and when a `publishedAt` operational fact is asserted without a sealed
// effective basis. The unsealed sentinel is rejected exactly as the existing
// project legal authority rejects it (by identity against the sealed sentinels).

import { invariant } from "./errors.mjs";
import { canonicalJson } from "./security.mjs";
import { constantTimeDigestEqual } from "./project-legal-authority.mjs";
import {
  LEGAL_PUBLICATION_SCHEMA,
  LEGAL_PUBLICATION_BASIS_SCHEMA,
  OWNER_PUBLICATION_RECEIPT_SCHEMA,
  computeOwnerEffectDigest,
  isCanonicalUtc,
  isUnsealedPublicationVersion,
  ownerReceiptId,
  publicationBasisDigest,
  verifyModeDescriptor
} from "./legal-publication.mjs";

// Reject an unsealed, missing, or mismatched basis. This is the single gate the
// whole verifier funnels through, so no record or receipt can be trusted past a
// basis that is not a byte-preserved, digest-consistent sealed tuple.
export function verifyPublicationBasis(basis) {
  invariant(
    basis && typeof basis === "object" && !Array.isArray(basis),
    "PUBLICATION_BASIS_MISSING",
    "A publication basis is required.",
    { status: 409 }
  );
  invariant(
    basis.schema === LEGAL_PUBLICATION_BASIS_SCHEMA && basis.sealed === true,
    "PUBLICATION_BASIS_UNSEALED",
    "The publication basis is not sealed.",
    { status: 409 }
  );
  invariant(
    !isUnsealedPublicationVersion(basis.version),
    "PUBLICATION_BASIS_UNSEALED",
    "The publication basis is the unsealed sentinel.",
    { status: 409 }
  );
  invariant(
    isCanonicalUtc(basis.effectiveAt),
    "PUBLICATION_BASIS_UNSEALED",
    "The publication basis has no sealed effective instant.",
    { status: 409 }
  );
  invariant(
    typeof basis.basisDigest === "string" &&
      constantTimeDigestEqual(basis.basisDigest, publicationBasisDigest(basis)),
    "PUBLICATION_BASIS_MISMATCH",
    "The publication basis digest does not match its sealed tuple.",
    { status: 409 }
  );
  return basis;
}

// True only when a basis is shaped as a sealed effective basis. Used to fire
// the dedicated publishedAt-without-basis rejection before the generic basis
// gate, so that reason is distinctly reachable.
function looksSealedEffective(basis) {
  return Boolean(
    basis && typeof basis === "object" && !Array.isArray(basis) &&
      basis.schema === LEGAL_PUBLICATION_BASIS_SCHEMA &&
      basis.sealed === true &&
      !isUnsealedPublicationVersion(basis.version) &&
      isCanonicalUtc(basis.effectiveAt)
  );
}

// Verify a held (or applied) publication record against its own basis.
export function verifyPublicationRecord(record) {
  invariant(
    record && typeof record === "object" && !Array.isArray(record) &&
      record.schema === LEGAL_PUBLICATION_SCHEMA,
    "PUBLICATION_RECORD_INVALID",
    "A legal publication record is required.",
    { status: 409 }
  );

  const asserted =
    record.publishedAt !== null && record.publishedAt !== undefined;
  // A publishedAt operational fact cannot be asserted without a sealed
  // effective basis. This reason is checked first so it is not masked by the
  // generic basis gate below.
  invariant(
    !asserted || (isCanonicalUtc(record.publishedAt) &&
      looksSealedEffective(record.basis)),
    "PUBLICATION_EFFECT_WITHOUT_BASIS",
    "publishedAt cannot be asserted without a sealed effective basis.",
    { status: 409 }
  );

  const basis = verifyPublicationBasis(record.basis);
  invariant(
    constantTimeDigestEqual(record.basisDigest, basis.basisDigest),
    "PUBLICATION_BASIS_MISMATCH",
    "The record basis digest does not match its basis.",
    { status: 409 }
  );
  verifyModeDescriptor(record.mode);

  if (record.state === "held") {
    invariant(
      record.published === false && record.effect === null,
      "PUBLICATION_RECORD_INVALID",
      "A held publication record must not carry a publish effect.",
      { status: 409 }
    );
  } else if (record.state === "published") {
    invariant(
      record.published === true &&
        record.effect && typeof record.effect === "object" &&
        isCanonicalUtc(record.publishedAt),
      "PUBLICATION_RECORD_INVALID",
      "A published record must carry an effect and a publication instant.",
      { status: 409 }
    );
    invariant(
      constantTimeDigestEqual(record.effect.basisDigest, basis.basisDigest) &&
        record.effect.publishedAt === record.publishedAt,
      "PUBLICATION_BASIS_MISMATCH",
      "The publish effect is not bound to this record's basis and instant.",
      { status: 409 }
    );
  } else {
    invariant(
      false,
      "PUBLICATION_RECORD_INVALID",
      "The publication record state is unknown.",
      { status: 409 }
    );
  }

  return Object.freeze({
    schema: record.schema,
    state: record.state,
    published: record.published,
    mode: record.mode,
    basisDigest: basis.basisDigest,
    effectiveAt: basis.effectiveAt,
    publishedAt: record.publishedAt ?? null
  });
}

// Verify a one-shot owner publication receipt against its sealed basis and its
// own recomputed effect digest. Fails closed on unsealed/missing/mismatched
// basis, on a publishedAt effect without a sealed basis, on absent owner facts,
// and on any tampering that breaks the deterministic receipt identity.
export function verifyOwnerPublicationReceipt(receipt) {
  invariant(
    receipt && typeof receipt === "object" && !Array.isArray(receipt) &&
      receipt.schema === OWNER_PUBLICATION_RECEIPT_SCHEMA,
    "PUBLICATION_RECEIPT_INVALID",
    "An owner publication receipt is required.",
    { status: 409 }
  );

  invariant(
    isCanonicalUtc(receipt.publishedAt) && looksSealedEffective(receipt.basis),
    "PUBLICATION_EFFECT_WITHOUT_BASIS",
    "The receipt asserts a publication instant without a sealed effective basis.",
    { status: 409 }
  );

  const basis = verifyPublicationBasis(receipt.basis);
  invariant(
    constantTimeDigestEqual(receipt.basisDigest, basis.basisDigest),
    "PUBLICATION_BASIS_MISMATCH",
    "The receipt basis digest does not match its basis.",
    { status: 409 }
  );
  // The receipt binds the SEALED effective instant, never the operational one.
  invariant(
    receipt.effectiveAt === basis.effectiveAt,
    "PUBLICATION_BASIS_MISMATCH",
    "The receipt effective instant does not match the sealed basis.",
    { status: 409 }
  );
  const mode = verifyModeDescriptor(receipt.mode);

  invariant(
    receipt.owner && typeof receipt.owner === "object" &&
      !Array.isArray(receipt.owner) &&
      typeof receipt.owner.ownerId === "string" &&
      receipt.owner.ownerId.trim().length > 0 &&
      typeof receipt.owner.authorization === "string" &&
      receipt.owner.authorization.trim().length > 0,
    "PUBLICATION_OWNER_FACT_REQUIRED",
    "The receipt is missing supplied owner authorization facts.",
    { status: 409 }
  );

  const effectDigest = computeOwnerEffectDigest({
    basisDigest: basis.basisDigest,
    effectiveAt: receipt.effectiveAt,
    publishedAt: receipt.publishedAt,
    mode: mode.mode,
    ownerId: receipt.owner.ownerId,
    authorization: receipt.owner.authorization
  });
  invariant(
    typeof receipt.effectDigest === "string" &&
      constantTimeDigestEqual(receipt.effectDigest, effectDigest) &&
      receipt.receiptId === ownerReceiptId(effectDigest),
    "PUBLICATION_RECEIPT_INVALID",
    "The receipt effect digest or identity is inconsistent.",
    { status: 409 }
  );
  invariant(
    receipt.singleUse === true &&
      receipt.effect && typeof receipt.effect === "object" &&
      receipt.effect.published === true &&
      receipt.effect.publishedAt === receipt.publishedAt &&
      canonicalJson(receipt.effect.mode) === canonicalJson(mode) &&
      constantTimeDigestEqual(receipt.effect.basisDigest, basis.basisDigest),
    "PUBLICATION_RECEIPT_INVALID",
    "The receipt effect is not a single-use effect bound to this basis.",
    { status: 409 }
  );

  return Object.freeze({
    receiptId: receipt.receiptId,
    effectDigest: receipt.effectDigest,
    basisDigest: basis.basisDigest,
    effectiveAt: receipt.effectiveAt,
    publishedAt: receipt.publishedAt,
    mode,
    singleUse: true
  });
}
