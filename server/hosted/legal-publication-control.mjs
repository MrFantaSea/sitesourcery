// One-shot, owner-authorized publication receipt/control constructors.
//
// A receipt is the single-use control record that authorizes exactly one
// hosted publish effect for one sealed basis. It ACCEPTS the effective and
// published timestamps and the owner facts as inputs; it NEVER generates,
// guesses, or defaults them. If any is absent the constructor fails closed and
// the caller must report it as an owner-fact dependency.
//
// Idempotency is by content address: the receipt identity is a deterministic
// digest of (sealed basis, effective instant, published instant, mode, owner
// facts). A second construction over the same basis and the same owner facts
// yields the byte-identical receipt and therefore no second effect. The ledger
// makes single-use explicit: a re-applied identical receipt is a replay, and a
// different effect for an already-controlled basis is refused.

import { invariant } from "./errors.mjs";
import { constantTimeDigestEqual } from "./project-legal-authority.mjs";
import {
  LEGAL_PUBLICATION_SCHEMA,
  OWNER_PUBLICATION_RECEIPT_SCHEMA,
  computeOwnerEffectDigest,
  describePublicationMode,
  ensureSealedBasis,
  isCanonicalUtc,
  ownerReceiptId,
  requirePublicationMode
} from "./legal-publication.mjs";
import {
  verifyOwnerPublicationReceipt,
  verifyPublicationRecord
} from "./legal-publication-verify.mjs";

function requireOwnerFacts(owner) {
  invariant(
    owner && typeof owner === "object" && !Array.isArray(owner),
    "PUBLICATION_OWNER_FACT_REQUIRED",
    "Owner authorization facts must be supplied; they are never invented.",
    { status: 409 }
  );
  const ownerId = owner.ownerId;
  const authorization = owner.authorization;
  invariant(
    typeof ownerId === "string" && ownerId.trim().length > 0 &&
      typeof authorization === "string" && authorization.trim().length > 0,
    "PUBLICATION_OWNER_FACT_REQUIRED",
    "The owner id and authorization must be supplied; they are never defaulted.",
    { status: 409 }
  );
  return Object.freeze({ ownerId, authorization });
}

// Build a single-use owner publication receipt. Every timestamp and owner fact
// is a required input. `effectiveAt` must equal the sealed basis's effective
// instant (the receipt binds the sealed basis, not a fresh clock); `publishedAt`
// is the owner-supplied operational instant of the publish effect.
export function createOwnerPublicationReceipt({
  basis,
  mode,
  owner,
  effectiveAt,
  publishedAt
} = {}) {
  const sealedBasis = ensureSealedBasis(basis);
  const modeName = requirePublicationMode(mode);
  const modeDescriptor = describePublicationMode(modeName);
  const ownerFacts = requireOwnerFacts(owner);

  invariant(
    isCanonicalUtc(effectiveAt),
    "PUBLICATION_OWNER_FACT_REQUIRED",
    "The sealed effective instant must be supplied as a canonical UTC time; it is never defaulted.",
    { status: 409 }
  );
  invariant(
    effectiveAt === sealedBasis.effectiveAt,
    "PUBLICATION_BASIS_MISMATCH",
    "The supplied effective instant does not match the sealed basis.",
    { status: 409 }
  );
  invariant(
    isCanonicalUtc(publishedAt),
    "PUBLICATION_OWNER_FACT_REQUIRED",
    "The publication instant (publishedAt) must be supplied as a canonical UTC time; it is never generated or defaulted.",
    { status: 409 }
  );

  const effectDigest = computeOwnerEffectDigest({
    basisDigest: sealedBasis.basisDigest,
    effectiveAt,
    publishedAt,
    mode: modeName,
    ownerId: ownerFacts.ownerId,
    authorization: ownerFacts.authorization
  });
  const effect = Object.freeze({
    published: true,
    publishedAt,
    mode: modeDescriptor,
    basisDigest: sealedBasis.basisDigest
  });

  const receipt = Object.freeze({
    schema: OWNER_PUBLICATION_RECEIPT_SCHEMA,
    receiptId: ownerReceiptId(effectDigest),
    effectDigest,
    singleUse: true,
    owner: ownerFacts,
    basis: sealedBasis,
    basisDigest: sealedBasis.basisDigest,
    effectiveAt,
    publishedAt,
    mode: modeDescriptor,
    effect
  });
  // Never hand back a receipt that would not survive verification.
  verifyOwnerPublicationReceipt(receipt);
  return receipt;
}

// Apply a verified single-use receipt to a held publication record of the same
// basis and mode, producing the one published record. Applying the same receipt
// again reproduces the identical published record (idempotent), because the
// receipt identity and effect are content-addressed.
export function applyOwnerPublicationReceipt(heldRecord, receipt) {
  const verifiedReceipt = verifyOwnerPublicationReceipt(receipt);
  const verifiedRecord = verifyPublicationRecord(heldRecord);
  invariant(
    verifiedRecord.state === "held",
    "PUBLICATION_RECORD_INVALID",
    "Only a held publication record can receive an owner receipt.",
    { status: 409 }
  );
  invariant(
    constantTimeDigestEqual(
      verifiedRecord.basisDigest,
      verifiedReceipt.basisDigest
    ),
    "PUBLICATION_BASIS_MISMATCH",
    "The owner receipt is not bound to this record's basis.",
    { status: 409 }
  );
  invariant(
    verifiedRecord.mode.mode === verifiedReceipt.mode.mode,
    "PUBLICATION_MODE_INVALID",
    "The owner receipt mode does not match the record mode.",
    { status: 409 }
  );
  return Object.freeze({
    schema: LEGAL_PUBLICATION_SCHEMA,
    state: "published",
    published: true,
    effect: receipt.effect,
    mode: heldRecord.mode,
    basis: heldRecord.basis,
    basisDigest: heldRecord.basisDigest,
    publishedAt: receipt.publishedAt,
    receiptId: receipt.receiptId
  });
}

// A single-use ledger for publication effects. It records at most one effect
// per sealed basis. Re-applying the identical receipt is an idempotent replay;
// a different effect for an already-controlled basis fails closed.
export function createPublicationControlLedger() {
  const receiptByBasis = new Map();
  const receiptById = new Map();
  return Object.freeze({
    apply(receipt) {
      const verified = verifyOwnerPublicationReceipt(receipt);
      const existing = receiptByBasis.get(verified.basisDigest);
      if (existing === undefined) {
        receiptByBasis.set(verified.basisDigest, verified.receiptId);
        receiptById.set(verified.receiptId, receipt);
        return Object.freeze({
          applied: true,
          replay: false,
          receiptId: verified.receiptId,
          basisDigest: verified.basisDigest
        });
      }
      if (existing === verified.receiptId) {
        return Object.freeze({
          applied: false,
          replay: true,
          receiptId: verified.receiptId,
          basisDigest: verified.basisDigest
        });
      }
      invariant(
        false,
        "PUBLICATION_ALREADY_CONTROLLED",
        "This basis already has a sealed single-use publication effect.",
        { status: 409 }
      );
      return undefined;
    },
    controlled(basisDigest) {
      return receiptByBasis.has(basisDigest);
    },
    receipt(receiptId) {
      return receiptById.get(receiptId) ?? null;
    }
  });
}
