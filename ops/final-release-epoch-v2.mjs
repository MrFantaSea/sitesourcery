import { constants as filesystemConstants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";

import {
  canonicalJson,
  parseJsonObject,
  safeIdentifier,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  validateCiReleaseFinalReceipt,
  validateCiReleaseSuccessorInput
} from "./ci-release-proof-runtime.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  compareOriginInstalledReadback,
  createOriginSeal,
  expectedOriginInstalledIdentity,
  validateOriginInstalledReadback,
  validateOriginSeal
} from "./origin-seal-runtime.mjs";

export const FINAL_RELEASE_EPOCH_V2_SCHEMA =
  "sitesourcery.final-release-epoch/v2";
export const FINAL_RELEASE_EPOCH_V2_JSON_SCHEMA_ID =
  "https://sitesourcery.com/schemas/final-release-epoch-v2.json";
export const HOSTED_RELEASE_IDENTITY_V2_SCHEMA =
  "sitesourcery.hosted-release-identity/v2";
export const FINAL_RELEASE_EPOCH_V2_INSTALLED_PATH =
  "/etc/sitesourcery/final-release-epoch-v2.json";
export const ORIGIN_SEAL_INSTALLED_PATH =
  "/etc/sitesourcery/origin-seal.json";
export const ORIGIN_INSTALLED_READBACK_PATH =
  "/etc/sitesourcery/origin-installed-readback.json";
export const RELEASE_EVIDENCE_PARENT_PATH = "/etc/sitesourcery";

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const MIGRATION = /^[0-9]{12}_[a-z0-9_]+\.sql$/u;
const MAXIMUM_EPOCH_BYTES = 256 * 1024;
const IDENTITY_FIELDS = Object.freeze([
  "sourceCommitSha",
  "sourceTreeSha",
  "artifactManifestSha256",
  "unitManifestSha256",
  "environmentSchemaManifestSha256",
  "environmentClassificationSha256",
  "workerManifestSha256",
  "workerContractSha256",
  "migrationCount",
  "latestMigration",
  "migrationManifestSha256",
  "legalAuthorityDigest",
  "legalManifestSha256",
  "ingressManifestSha256"
]);

export class FinalReleaseEpochV2Failure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FinalReleaseEpochV2Failure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new FinalReleaseEpochV2Failure(code, message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...keys].sort())
  ) {
    fail(
      "FINAL_RELEASE_EPOCH_INVALID",
      `${label} must contain only its exact reviewed fields.`
    );
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(
      "FINAL_RELEASE_EPOCH_INVALID",
      `${label} must be an exact lowercase SHA-256 digest.`
    );
  }
  return value;
}

function commit(value, label) {
  if (typeof value !== "string" || !COMMIT_SHA.test(value)) {
    fail(
      "FINAL_RELEASE_EPOCH_INVALID",
      `${label} must be an exact lowercase Git commit SHA.`
    );
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(
      "FINAL_RELEASE_EPOCH_INVALID",
      `${label} must be a positive safe integer.`
    );
  }
  return value;
}

function exactHeldAuthority(value) {
  exactObject(
    value,
    [
      "state",
      "allowsCapabilities",
      "allowsCustomerEffects",
      "allowsProviderEffects",
      "allowsDnsMutation",
      "allowsDeployment",
      "enabledCapabilities"
    ],
    "Final release authority"
  );
  if (canonicalJson(value) !== canonicalJson(ORIGIN_HELD_AUTHORITY)) {
    fail(
      "FINAL_RELEASE_EFFECTS_NOT_HELD",
      "Final release authority must remain exactly held."
    );
  }
  return value;
}

function validateIdentity(value) {
  exactObject(value, IDENTITY_FIELDS, "Final installed identity");
  commit(value.sourceCommitSha, "Final source commit");
  commit(value.sourceTreeSha, "Final source tree");
  positiveInteger(value.migrationCount, "Final migration count");
  if (
    typeof value.latestMigration !== "string" ||
    !MIGRATION.test(value.latestMigration)
  ) {
    fail(
      "FINAL_RELEASE_EPOCH_INVALID",
      "Final latest migration is invalid."
    );
  }
  for (const field of IDENTITY_FIELDS) {
    if (
      field !== "sourceCommitSha" &&
      field !== "sourceTreeSha" &&
      field !== "migrationCount" &&
      field !== "latestMigration"
    ) {
      digest(value[field], `Final ${field}`);
    }
  }
  return value;
}

function validateLegalV4Pages(value) {
  exactObject(
    value,
    ["fileCount", "manifestSha256"],
    "Final Legal V4 Pages authority"
  );
  positiveInteger(value.fileCount, "Final Legal V4 Pages file count");
  digest(
    value.manifestSha256,
    "Final Legal V4 Pages manifest"
  );
  return value;
}

function validatePrivacyArtifact(value) {
  exactObject(
    value,
    ["version", "sha256", "byteCount"],
    "Final privacy artifact"
  );
  if (
    typeof value.version !== "string" ||
    !/^[A-Z0-9][A-Z0-9-]{2,127}$/u.test(value.version)
  ) {
    fail(
      "FINAL_RELEASE_EPOCH_INVALID",
      "Final privacy artifact version is invalid."
    );
  }
  digest(value.sha256, "Final privacy artifact digest");
  positiveInteger(value.byteCount, "Final privacy artifact byte count");
  return value;
}

function validateRollback(value) {
  exactObject(
    value,
    [
      "predecessorCommitSha",
      "predecessorTreeSha",
      "predecessorArtifactManifestSha256"
    ],
    "Final rollback authority"
  );
  commit(value.predecessorCommitSha, "Final rollback predecessor");
  commit(value.predecessorTreeSha, "Final rollback tree");
  digest(
    value.predecessorArtifactManifestSha256,
    "Final rollback artifact manifest"
  );
  return value;
}

function receiptPayload(value) {
  return {
    schema: value.schema,
    epochId: value.epochId,
    state: value.state,
    bindingSha256: value.bindingSha256,
    evidence: value.evidence,
    identity: value.identity,
    legalV4Pages: value.legalV4Pages,
    privacyArtifact: value.privacyArtifact,
    rollback: value.rollback,
    authority: value.authority
  };
}

export function finalReleaseEpochV2Digest(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(receiptPayload(value))}\n`, "utf8")
  );
}

function observedFromSeal(seal) {
  const { expectations: _expectations, ...ingress } = seal.ingress;
  return {
    source: structuredClone(seal.source),
    artifact: structuredClone(seal.artifact),
    units: structuredClone(seal.units),
    environmentSchema: structuredClone(seal.environmentSchema),
    worker: structuredClone(seal.worker),
    migration: structuredClone(seal.migration),
    legal: structuredClone(seal.legal),
    ingress: structuredClone(ingress)
  };
}

export function createHeldFinalReleaseEpochV2({
  successorInput,
  ciFinalReceipt,
  originSeal,
  installedReadback
}) {
  const input = validateCiReleaseSuccessorInput(successorInput);
  const ciReceipt = validateCiReleaseFinalReceipt(ciFinalReceipt);
  const seal = validateOriginSeal(originSeal);
  const readback = validateOriginInstalledReadback(installedReadback);
  const originInput = input.originReleaseInput;
  const reconstructedSeal = createOriginSeal({
    releaseInput: originInput,
    observed: observedFromSeal(seal)
  });
  if (canonicalJson(reconstructedSeal) !== canonicalJson(seal)) {
    fail(
      "FINAL_RELEASE_ORIGIN_MISMATCH",
      "Origin seal drifted from the exact successor authority."
    );
  }
  if (
    ciReceipt.candidateSha !== originInput.epoch.source.commitSha ||
    ciReceipt.successorInputDigest !== input.digest
  ) {
    fail(
      "FINAL_RELEASE_CI_MISMATCH",
      "CI final receipt drifted from the exact successor authority."
    );
  }
  const readbackReceipt = compareOriginInstalledReadback({
    seal,
    readback
  });
  if (readbackReceipt.state !== "verified") {
    fail(
      "FINAL_RELEASE_INSTALL_MISMATCH",
      "Installed origin identity does not match the exact origin seal."
    );
  }
  const value = {
    schema: FINAL_RELEASE_EPOCH_V2_SCHEMA,
    epochId: originInput.epoch.epochId,
    state: "verified_held",
    bindingSha256: input.digest,
    evidence: {
      originReleaseInputDigest: originInput.digest,
      originSuccessorBindingSha256:
        originInput.epoch.bindingSha256,
      ciFinalReceiptDigest: ciReceipt.digest,
      originSealSha256: seal.sealSha256,
      originInstalledReadbackDigest: readback.digest,
      originInstalledReadbackReceiptSha256:
        readbackReceipt.receiptSha256
    },
    identity: expectedOriginInstalledIdentity(seal),
    legalV4Pages: structuredClone(input.legalV4Pages),
    privacyArtifact: {
      version: seal.legal.privacyVersion,
      sha256: seal.legal.privacySha256,
      byteCount: seal.legal.privacyByteCount
    },
    rollback: structuredClone(seal.rollback),
    authority: structuredClone(ORIGIN_HELD_AUTHORITY)
  };
  return validateFinalReleaseEpochV2({
    ...value,
    digest: finalReleaseEpochV2Digest(value)
  });
}

export function validateFinalReleaseEpochV2(value) {
  exactObject(
    value,
    [
      "schema",
      "epochId",
      "state",
      "bindingSha256",
      "evidence",
      "identity",
      "legalV4Pages",
      "privacyArtifact",
      "rollback",
      "authority",
      "digest"
    ],
    "Final release epoch"
  );
  if (
    value.schema !== FINAL_RELEASE_EPOCH_V2_SCHEMA ||
    value.state !== "verified_held"
  ) {
    fail(
      "FINAL_RELEASE_EPOCH_INVALID",
      "Final release epoch schema or held state is invalid."
    );
  }
  safeIdentifier(value.epochId, "Final release epoch ID");
  digest(value.bindingSha256, "Final release binding");
  exactObject(
    value.evidence,
    [
      "originReleaseInputDigest",
      "originSuccessorBindingSha256",
      "ciFinalReceiptDigest",
      "originSealSha256",
      "originInstalledReadbackDigest",
      "originInstalledReadbackReceiptSha256"
    ],
    "Final release evidence"
  );
  for (const [field, selected] of Object.entries(value.evidence)) {
    digest(selected, `Final release evidence ${field}`);
  }
  const identity = validateIdentity(value.identity);
  if (
    identity.sourceCommitSha ===
      value.rollback?.predecessorCommitSha
  ) {
    fail(
      "FINAL_RELEASE_EPOCH_INVALID",
      "Final release candidate and rollback predecessor must differ."
    );
  }
  validateLegalV4Pages(value.legalV4Pages);
  validatePrivacyArtifact(value.privacyArtifact);
  validateRollback(value.rollback);
  exactHeldAuthority(value.authority);
  digest(value.digest, "Final release receipt");
  if (value.digest !== finalReleaseEpochV2Digest(value)) {
    fail(
      "FINAL_RELEASE_EPOCH_DIGEST_MISMATCH",
      "Final release epoch digest does not match its exact receipt."
    );
  }
  return deepFreeze(structuredClone(value));
}

function exactInstalledPath(value, expected, label) {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    path.resolve(value) !== expected
  ) {
    fail(
      "FINAL_RELEASE_EPOCH_FILE_INVALID",
      `${label} must use its exact installed path.`
    );
  }
  return expected;
}

export async function readAnchoredJsonFile(
  filePath,
  {
    expectedSha256,
    expectedOwnerUid = 0,
    expectedPath = filePath,
    expectedParentPath = path.dirname(expectedPath),
    maximumBytes = MAXIMUM_EPOCH_BYTES,
    afterOpen = null
  } = {}
) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    fail(
      "FINAL_RELEASE_EPOCH_FILE_INVALID",
      "Final release epoch file must be an absolute path."
    );
  }
  digest(expectedSha256, "Expected installed evidence file");
  if (
    !Number.isSafeInteger(expectedOwnerUid) ||
    expectedOwnerUid < 0 ||
    typeof expectedPath !== "string" ||
    !path.isAbsolute(expectedPath) ||
    path.resolve(filePath) !== path.resolve(expectedPath) ||
    typeof expectedParentPath !== "string" ||
    !path.isAbsolute(expectedParentPath) ||
    path.dirname(path.resolve(expectedPath)) !==
      path.resolve(expectedParentPath) ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 2 ||
    maximumBytes > MAXIMUM_EPOCH_BYTES ||
    (afterOpen !== null && typeof afterOpen !== "function")
  ) {
    fail(
      "FINAL_RELEASE_EPOCH_FILE_INVALID",
      "Installed evidence file policy is invalid."
    );
  }
  let parentHandle;
  let handle;
  let bytes;
  try {
    const [actualParent, requiredParent] = await Promise.all([
      realpath(path.dirname(filePath)),
      realpath(expectedParentPath)
    ]);
    if (
      actualParent !== requiredParent
    ) {
      throw new Error("installed evidence parent drift");
    }
    parentHandle = await open(
      expectedParentPath,
      filesystemConstants.O_RDONLY |
        filesystemConstants.O_DIRECTORY |
        filesystemConstants.O_NOFOLLOW
    );
    const parentMetadata = await parentHandle.stat();
    if (
      !parentMetadata.isDirectory() ||
      parentMetadata.uid !== expectedOwnerUid ||
      (parentMetadata.mode & 0o022) !== 0
    ) {
      throw new Error("installed evidence parent policy drift");
    }
    handle = await open(
      filePath,
      filesystemConstants.O_RDONLY |
        filesystemConstants.O_NOFOLLOW
    );
    if (afterOpen) await afterOpen();
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== expectedOwnerUid ||
      (metadata.mode & 0o022) !== 0 ||
      metadata.size < 2 ||
      metadata.size > maximumBytes
    ) {
      throw new Error("installed evidence metadata drift");
    }
    bytes = await handle.readFile();
    if (
      bytes.length !== metadata.size ||
      sha256Bytes(bytes) !== expectedSha256
    ) {
      throw new Error("installed evidence digest drift");
    }
  } catch {
    fail(
      "FINAL_RELEASE_EPOCH_FILE_UNAVAILABLE",
      "Final release epoch file is unavailable or unsafe."
    );
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (parentHandle) await parentHandle.close().catch(() => {});
  }
  try {
    return parseJsonObject(bytes.toString("utf8"), "Installed evidence");
  } catch {
    fail(
      "FINAL_RELEASE_EPOCH_FILE_INVALID",
      "Installed evidence file is not an exact JSON object."
    );
  }
}

export async function readFinalReleaseEpochV2File(
  filePath,
  options
) {
  let parsed;
  try {
    parsed = await readAnchoredJsonFile(filePath, options);
    return validateFinalReleaseEpochV2(parsed);
  } catch (error) {
    if (error instanceof FinalReleaseEpochV2Failure) throw error;
    fail(
      "FINAL_RELEASE_EPOCH_FILE_INVALID",
      "Final release epoch file failed closed validation."
    );
  }
}

export async function readInstalledFinalReleaseEpochV2({
  epochPath,
  expectedEpochFileSha256,
  originSealPath,
  expectedOriginSealFileSha256,
  installedReadbackPath,
  expectedInstalledReadbackFileSha256
}) {
  const selectedEpochPath = exactInstalledPath(
    epochPath,
    FINAL_RELEASE_EPOCH_V2_INSTALLED_PATH,
    "Final release epoch"
  );
  const selectedSealPath = exactInstalledPath(
    originSealPath,
    ORIGIN_SEAL_INSTALLED_PATH,
    "Origin seal"
  );
  const selectedReadbackPath = exactInstalledPath(
    installedReadbackPath,
    ORIGIN_INSTALLED_READBACK_PATH,
    "Origin installed readback"
  );
  const common = {
    expectedOwnerUid: 0,
    expectedParentPath: RELEASE_EVIDENCE_PARENT_PATH
  };
  const [epoch, sealValue, readbackValue] = await Promise.all([
    readFinalReleaseEpochV2File(selectedEpochPath, {
      ...common,
      expectedPath: FINAL_RELEASE_EPOCH_V2_INSTALLED_PATH,
      expectedSha256: expectedEpochFileSha256
    }),
    readAnchoredJsonFile(selectedSealPath, {
      ...common,
      expectedPath: ORIGIN_SEAL_INSTALLED_PATH,
      expectedSha256: expectedOriginSealFileSha256
    }),
    readAnchoredJsonFile(selectedReadbackPath, {
      ...common,
      expectedPath: ORIGIN_INSTALLED_READBACK_PATH,
      expectedSha256: expectedInstalledReadbackFileSha256
    })
  ]);
  return validateInstalledFinalReleaseEpochV2Chain({
    epoch,
    originSeal: sealValue,
    installedReadback: readbackValue
  });
}

export function validateInstalledFinalReleaseEpochV2Chain({
  epoch: epochValue,
  originSeal,
  installedReadback
}) {
  const epoch = validateFinalReleaseEpochV2(epochValue);
  const seal = validateOriginSeal(originSeal);
  const readback = validateOriginInstalledReadback(installedReadback);
  const receipt = compareOriginInstalledReadback({ seal, readback });
  const expectedIdentity = expectedOriginInstalledIdentity(seal);
  if (
    receipt.state !== "verified" ||
    epoch.epochId !== seal.successorEpochId ||
    epoch.evidence.originSuccessorBindingSha256 !==
      seal.successorEpochBindingSha256 ||
    epoch.evidence.originReleaseInputDigest !==
      seal.releaseInputDigest ||
    epoch.evidence.originSealSha256 !== seal.sealSha256 ||
    epoch.evidence.originInstalledReadbackDigest !== readback.digest ||
    epoch.evidence.originInstalledReadbackReceiptSha256 !==
      receipt.receiptSha256 ||
    canonicalJson(epoch.identity) !== canonicalJson(expectedIdentity) ||
    canonicalJson(epoch.rollback) !== canonicalJson(seal.rollback) ||
    canonicalJson(epoch.privacyArtifact) !== canonicalJson({
      version: seal.legal.privacyVersion,
      sha256: seal.legal.privacySha256,
      byteCount: seal.legal.privacyByteCount
    })
  ) {
    fail(
      "FINAL_RELEASE_INSTALL_MISMATCH",
      "Installed final release chain does not match its external anchors."
    );
  }
  return epoch;
}

export function releaseIdentityFromFinalEpochV2(value) {
  const epoch = validateFinalReleaseEpochV2(value);
  return deepFreeze({
    schema: HOSTED_RELEASE_IDENTITY_V2_SCHEMA,
    state: "verified_held",
    epochId: epoch.epochId,
    bindingSha256: epoch.bindingSha256,
    candidateCommitSha: epoch.identity.sourceCommitSha,
    candidateTreeSha: epoch.identity.sourceTreeSha,
    migrationCount: epoch.identity.migrationCount,
    latestMigration: epoch.identity.latestMigration
  });
}
