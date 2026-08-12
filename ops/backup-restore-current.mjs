import path from "node:path";

import {
  BACKUP_RESTORE_INTEGRATION_SCHEMA,
  backupRestoreMigrationInventory,
  validateBackupRestoreIntegrationInput,
  validateHeldBackupRestoreContract,
  verifyHeldBackupRestoreContract
} from "./backup-restore-contract.mjs";
import {
  BACKUP_SUCCEEDED_SCHEMA,
  loadVerifiedBackupAttempt,
  validateDestinationMarker
} from "./backup-runtime.mjs";
import {
  validateInstalledFinalReleaseEpochV2Chain
} from "./final-release-epoch-v2.mjs";
import {
  canonicalJson,
  safeIdentifier,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  DEFAULT_HELD_OPERATIONS_STATE,
  assertHeldProviderEgressState,
  validateOperationsStateEvidence
} from "./operations-state.mjs";
import {
  compareOriginInstalledReadback,
  validateOriginInstalledReadback,
  validateOriginSeal
} from "./origin-seal-runtime.mjs";
import {
  RESTORE_VERIFIED_SCHEMA
} from "./restore-runtime.mjs";

export const CURRENT_BACKUP_RESTORE_SCHEMA =
  "sitesourcery.current-backup-restore-held/v1";
export const CURRENT_BACKUP_RESTORE_CLEANUP_SCHEMA =
  "sitesourcery.current-clean-room-cleanup/v1";
export const CURRENT_BACKUP_RESTORE_ROLLBACK_SCHEMA =
  "sitesourcery.current-restore-rollback-binding/v1";
export const CURRENT_BACKUP_RESTORE_RTO_SCHEMA =
  "sitesourcery.current-restore-rto-decision/v1";

export const CURRENT_BACKUP_RESTORE_HOLDS = freeze({
  state: "held",
  allowsBackup: false,
  allowsRestore: false,
  allowsCleanup: false,
  allowsCustomerEffects: false,
  allowsProviderEffects: false,
  allowsPublication: false,
  allowsDnsMutation: false,
  allowsDeployment: false,
  allowsAuthority: false
});

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const DATABASE_NAME = /^[a-z][a-z0-9_]{2,62}$/u;
const MIGRATION_FILE = /^[0-9]{12}_[a-z0-9_]+\.sql$/u;

export class CurrentBackupRestoreFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CurrentBackupRestoreFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CurrentBackupRestoreFailure(code, message);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
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
      "CURRENT_BACKUP_RESTORE_INVALID",
      `${label} must contain only its exact reviewed fields.`
    );
  }
  return value;
}

function exactExpected(value, expected, code, message) {
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail(code, message);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(
      "CURRENT_BACKUP_RESTORE_INVALID",
      `${label} must be an exact lowercase SHA-256 digest.`
    );
  }
  return value;
}

function commit(value, label) {
  if (typeof value !== "string" || !COMMIT_SHA.test(value)) {
    fail(
      "CURRENT_BACKUP_RESTORE_INVALID",
      `${label} must be an exact lowercase commit SHA.`
    );
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(
      "CURRENT_BACKUP_RESTORE_INVALID",
      `${label} must be a positive safe integer.`
    );
  }
  return value;
}

function instant(value, label) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_INVALID",
      `${label} must be an exact ISO timestamp.`
    );
  }
  return selected;
}

function immutableDigest(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(value)}\n`, "utf8")
  );
}

function exactMigrationUnion(seal, migrationFiles) {
  const expectedFiles = seal.migration.files
    .map((entry) => path.posix.basename(entry.path))
    .sort();
  const actualFiles = Array.isArray(migrationFiles)
    ? [...migrationFiles].sort()
    : [];
  if (canonicalJson(actualFiles) !== canonicalJson(expectedFiles)) {
    fail(
      "CURRENT_BACKUP_RESTORE_MIGRATION_MISMATCH",
      "The supplied migration inventory does not match the exact installed release union."
    );
  }
  const inventory = backupRestoreMigrationInventory(actualFiles);
  if (
    inventory.migrationCount !== seal.migration.count ||
    inventory.latestMigration !== seal.migration.latest
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_MIGRATION_MISMATCH",
      "The migration count or latest migration drifted from the installed release union."
    );
  }
  return inventory;
}

export function createCurrentBackupRestoreIntegration({
  finalReleaseEpoch,
  originSeal,
  installedReadback,
  migrationFiles
}) {
  const seal = validateOriginSeal(originSeal);
  const readback = validateOriginInstalledReadback(installedReadback);
  const epoch = validateInstalledFinalReleaseEpochV2Chain({
    epoch: finalReleaseEpoch,
    originSeal: seal,
    installedReadback: readback
  });
  const readbackReceipt = compareOriginInstalledReadback({
    seal,
    readback
  });
  if (readbackReceipt.state !== "verified") {
    fail(
      "CURRENT_BACKUP_RESTORE_INSTALL_MISMATCH",
      "The installed readback does not match the exact current release epoch."
    );
  }
  const database = exactMigrationUnion(seal, migrationFiles);
  return validateBackupRestoreIntegrationInput({
    schema: BACKUP_RESTORE_INTEGRATION_SCHEMA,
    releaseEpoch: {
      schema: "sitesourcery.release-epoch/v1",
      epochId: epoch.epochId,
      bindingSha256: epoch.bindingSha256,
      receiptSha256: epoch.digest,
      sourceCommitSha: epoch.identity.sourceCommitSha,
      artifactManifestSha256:
        epoch.identity.artifactManifestSha256,
      migrationCount: database.migrationCount,
      latestMigration: database.latestMigration,
      migrationInventorySha256: database.inventorySha256
    },
    source: {
      commitSha: epoch.identity.sourceCommitSha
    },
    artifact: {
      manifestSha256: epoch.identity.artifactManifestSha256
    },
    installedIdentity: {
      state: "verified",
      releaseEpochBindingSha256: epoch.bindingSha256,
      releaseCommitSha: epoch.identity.sourceCommitSha,
      artifactManifestSha256:
        epoch.identity.artifactManifestSha256,
      migrationCount: database.migrationCount,
      receiptSha256: readbackReceipt.receiptSha256,
      observedAt: readback.observedAt
    },
    database
  });
}

export function currentBackupCiphertextManifestSha256(manifest) {
  if (
    manifest?.schema !== BACKUP_SUCCEEDED_SCHEMA ||
    !Array.isArray(manifest.artifacts)
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_BACKUP_INVALID",
      "The backup attempt manifest is invalid."
    );
  }
  const projection = manifest.artifacts
    .map((artifact) => ({
      kind: artifact.kind,
      file: artifact.file,
      encryptedBytes: artifact.encryptedBytes,
      encryptedSha256: artifact.encryptedSha256,
      plaintextBytes: artifact.plaintextBytes,
      plaintextSha256: artifact.plaintextSha256
    }))
    .sort((left, right) => left.kind.localeCompare(right.kind));
  return immutableDigest(projection);
}

export function currentRestoreTargetFreshnessSha256(report) {
  return immutableDigest({
    cleanRoom: report?.cleanRoom,
    restoreExecution: report?.restoreExecution,
    database: report?.database,
    appState: report?.appState
  });
}

function cleanupPayload(value) {
  return {
    schema: value.schema,
    restoreReceiptSha256: value.restoreReceiptSha256,
    databaseNameSha256: value.databaseNameSha256,
    databaseAbsent: value.databaseAbsent,
    plaintextAbsent: value.plaintextAbsent,
    appStateAbsent: value.appStateAbsent,
    observedAt: value.observedAt
  };
}

export function currentCleanupReceiptDigest(value) {
  return immutableDigest(cleanupPayload(value));
}

export function createCurrentCleanupReceipt({
  restoreReceiptSha256,
  databaseNameSha256,
  databaseAbsent,
  plaintextAbsent,
  appStateAbsent,
  observedAt
}) {
  const value = {
    schema: CURRENT_BACKUP_RESTORE_CLEANUP_SCHEMA,
    restoreReceiptSha256,
    databaseNameSha256,
    databaseAbsent,
    plaintextAbsent,
    appStateAbsent,
    observedAt
  };
  return validateCurrentCleanupReceipt({
    ...value,
    digest: currentCleanupReceiptDigest(value)
  });
}

export function validateCurrentCleanupReceipt(value) {
  exactObject(
    value,
    [
      "schema",
      "restoreReceiptSha256",
      "databaseNameSha256",
      "databaseAbsent",
      "plaintextAbsent",
      "appStateAbsent",
      "observedAt",
      "digest"
    ],
    "Current clean-room cleanup receipt"
  );
  if (
    value.schema !== CURRENT_BACKUP_RESTORE_CLEANUP_SCHEMA ||
    value.databaseAbsent !== true ||
    value.plaintextAbsent !== true ||
    value.appStateAbsent !== true
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_CLEANUP_INCOMPLETE",
      "Cleanup must prove the exact database, plaintext, and restored app state are absent."
    );
  }
  digest(value.restoreReceiptSha256, "Cleanup restore receipt");
  digest(value.databaseNameSha256, "Cleanup database identity");
  instant(value.observedAt, "Cleanup observation");
  digest(value.digest, "Cleanup receipt");
  if (value.digest !== currentCleanupReceiptDigest(value)) {
    fail(
      "CURRENT_BACKUP_RESTORE_CLEANUP_INVALID",
      "The cleanup receipt digest is invalid."
    );
  }
  return freeze(structuredClone(value));
}

function rollbackPayload(value) {
  return {
    schema: value.schema,
    state: value.state,
    finalReleaseEpochDigest: value.finalReleaseEpochDigest,
    restoreReceiptSha256: value.restoreReceiptSha256,
    predecessor: value.predecessor,
    productionPromoted: value.productionPromoted,
    providerEffects: value.providerEffects
  };
}

export function currentRollbackBindingDigest(value) {
  return immutableDigest(rollbackPayload(value));
}

export function createCurrentRollbackBinding({
  finalReleaseEpochDigest,
  restoreReceiptSha256,
  predecessor
}) {
  const value = {
    schema: CURRENT_BACKUP_RESTORE_ROLLBACK_SCHEMA,
    state: "verified_held",
    finalReleaseEpochDigest,
    restoreReceiptSha256,
    predecessor,
    productionPromoted: false,
    providerEffects: false
  };
  return validateCurrentRollbackBinding({
    ...value,
    digest: currentRollbackBindingDigest(value)
  });
}

export function validateCurrentRollbackBinding(value) {
  exactObject(
    value,
    [
      "schema",
      "state",
      "finalReleaseEpochDigest",
      "restoreReceiptSha256",
      "predecessor",
      "productionPromoted",
      "providerEffects",
      "digest"
    ],
    "Current restore rollback binding"
  );
  exactObject(
    value.predecessor,
    [
      "predecessorCommitSha",
      "predecessorTreeSha",
      "predecessorArtifactManifestSha256"
    ],
    "Current restore rollback predecessor"
  );
  if (
    value.schema !== CURRENT_BACKUP_RESTORE_ROLLBACK_SCHEMA ||
    value.state !== "verified_held" ||
    value.productionPromoted !== false ||
    value.providerEffects !== false
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_ROLLBACK_INVALID",
      "The rollback binding must remain verified-held without promotion or provider effects."
    );
  }
  digest(value.finalReleaseEpochDigest, "Rollback release epoch");
  digest(value.restoreReceiptSha256, "Rollback restore receipt");
  commit(
    value.predecessor.predecessorCommitSha,
    "Rollback predecessor commit"
  );
  commit(
    value.predecessor.predecessorTreeSha,
    "Rollback predecessor tree"
  );
  digest(
    value.predecessor.predecessorArtifactManifestSha256,
    "Rollback predecessor artifact"
  );
  digest(value.digest, "Rollback binding");
  if (value.digest !== currentRollbackBindingDigest(value)) {
    fail(
      "CURRENT_BACKUP_RESTORE_ROLLBACK_INVALID",
      "The rollback binding digest is invalid."
    );
  }
  return freeze(structuredClone(value));
}

export function createRatifiedCurrentRtoDecision({
  maximumDurationMs,
  evidenceSha256
}) {
  return validateRatifiedCurrentRtoDecision({
    schema: CURRENT_BACKUP_RESTORE_RTO_SCHEMA,
    state: "ratified",
    maximumDurationMs,
    evidenceSha256
  });
}

export function validateRatifiedCurrentRtoDecision(value) {
  exactObject(
    value,
    [
      "schema",
      "state",
      "maximumDurationMs",
      "evidenceSha256"
    ],
    "Current restore RTO decision"
  );
  if (
    value.schema !== CURRENT_BACKUP_RESTORE_RTO_SCHEMA ||
    value.state !== "ratified"
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_POLICY_UNRATIFIED",
      "The owner RTO decision is not ratified."
    );
  }
  positiveInteger(value.maximumDurationMs, "RTO maximum duration");
  digest(value.evidenceSha256, "RTO decision evidence");
  return freeze(structuredClone(value));
}

function validateRestoreReport(report, backup) {
  exactObject(
    report,
    [
      "schema",
      "restoreId",
      "backupAttemptId",
      "backupManifestSha256",
      "startedAt",
      "completedAt",
      "cleanRoom",
      "sourceOperations",
      "restoreExecution",
      "database",
      "appState"
    ],
    "Clean-room restore receipt"
  );
  if (
    report.schema !== RESTORE_VERIFIED_SCHEMA ||
    report.cleanRoom !== true ||
    report.backupAttemptId !== backup.manifest.attemptId ||
    report.backupManifestSha256 !== backup.manifestSha256
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_RESTORE_MISMATCH",
      "The clean-room restore receipt does not match the exact backup attempt."
    );
  }
  safeIdentifier(report.restoreId, "Clean-room restore ID");
  const startedAt = instant(report.startedAt, "Restore start");
  const completedAt = instant(report.completedAt, "Restore completion");
  if (completedAt < startedAt) {
    fail(
      "CURRENT_BACKUP_RESTORE_RESTORE_MISMATCH",
      "Restore receipt timestamps are not monotonic."
    );
  }
  const sourceOperations = validateOperationsStateEvidence(
    report.sourceOperations,
    {
      sourceFailureDomainId:
        backup.manifest.sourceFailureDomainId,
      consumer: "backup"
    }
  );
  exactExpected(
    sourceOperations,
    backup.manifest.sourceOperations,
    "CURRENT_BACKUP_RESTORE_RESTORE_MISMATCH",
    "The restore receipt changed the backup source operations state."
  );
  exactObject(
    report.restoreExecution,
    ["networkExposure", "providerEgress"],
    "Clean-room restore execution"
  );
  if (report.restoreExecution.networkExposure !== "none") {
    fail(
      "CURRENT_BACKUP_RESTORE_RESTORE_MISMATCH",
      "The clean-room restore must have no network exposure."
    );
  }
  assertHeldProviderEgressState(
    report.restoreExecution.providerEgress
  );

  const databaseArtifact = backup.manifest.artifacts.find(
    (artifact) => artifact.kind === "postgresql"
  );
  const appArtifact = backup.manifest.artifacts.find(
    (artifact) => artifact.kind === "app_state"
  );
  const databaseManifest = databaseArtifact?.databaseManifest;
  const appManifest = appArtifact?.appStateManifest;
  exactObject(
    report.database,
    [
      "freshDatabase",
      "databaseName",
      "runtimeContractV13",
      "runtimeContractV14",
      "runtimeContractV15",
      "shadowSchemaAbsent",
      "domainHeld",
      "serviceRoleBypassRls",
      "authenticatedRoleNoBypassRls",
      "serviceRoleSchemaUsage",
      "tableCount",
      "rowCounts"
    ],
    "Clean-room restored database"
  );
  if (
    typeof report.database.databaseName !== "string" ||
    !DATABASE_NAME.test(report.database.databaseName)
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_RESTORE_MISMATCH",
      "The clean-room database identity is invalid."
    );
  }
  const expectedDatabase = {
    freshDatabase: true,
    databaseName: report.database.databaseName,
    runtimeContractV13: databaseManifest?.runtimeContractV13,
    runtimeContractV14: databaseManifest?.runtimeContractV14,
    runtimeContractV15: databaseManifest?.runtimeContractV15,
    shadowSchemaAbsent: databaseManifest?.shadowSchemaAbsent,
    domainHeld: databaseManifest?.domainHeld,
    serviceRoleBypassRls: databaseManifest?.serviceRoleBypassRls,
    authenticatedRoleNoBypassRls:
      databaseManifest?.authenticatedRoleNoBypassRls,
    serviceRoleSchemaUsage:
      databaseManifest?.serviceRoleSchemaUsage,
    tableCount: databaseManifest?.tableCount,
    rowCounts: databaseManifest?.rowCounts
  };
  exactExpected(
    report.database,
    expectedDatabase,
    "CURRENT_BACKUP_RESTORE_RESTORE_MISMATCH",
    "The restored database does not reproduce the exact backup invariants."
  );
  exactObject(
    report.appState,
    ["freshRoot", "treeSha256", "entryCount"],
    "Clean-room restored app state"
  );
  exactExpected(
    report.appState,
    {
      freshRoot: true,
      treeSha256: appManifest?.treeSha256,
      entryCount: appManifest?.entries?.length
    },
    "CURRENT_BACKUP_RESTORE_RESTORE_MISMATCH",
    "The restored app state does not reproduce the exact backup inventory."
  );
  return freeze(structuredClone(report));
}

function validateBackupAttempt(backup, contract) {
  if (
    backup?.manifest?.schema !== BACKUP_SUCCEEDED_SCHEMA ||
    !SHA256.test(backup.manifestSha256 ?? "")
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_BACKUP_INVALID",
      "The verified backup attempt result is invalid."
    );
  }
  const sourceFailureDomainId = safeIdentifier(
    backup.manifest.sourceFailureDomainId,
    "Backup source failure domain"
  );
  const destinationFailureDomainId = safeIdentifier(
    backup.manifest.destinationFailureDomainId,
    "Backup destination failure domain"
  );
  if (sourceFailureDomainId === destinationFailureDomainId) {
    fail(
      "CURRENT_BACKUP_RESTORE_DESTINATION_INVALID",
      "The backup destination must be in a different failure domain."
    );
  }
  const sourceOperations = validateOperationsStateEvidence(
    backup.manifest.sourceOperations,
    { sourceFailureDomainId, consumer: "backup" }
  );
  exactExpected(
    sourceOperations.operationsState,
    DEFAULT_HELD_OPERATIONS_STATE,
    "CURRENT_BACKUP_RESTORE_EFFECTS_NOT_HELD",
    "The backup source operations state must remain wholly held."
  );
  if (backup.manifest.providerEgress !== "held") {
    fail(
      "CURRENT_BACKUP_RESTORE_EFFECTS_NOT_HELD",
      "The backup attempt must keep provider egress held."
    );
  }
  const encryptedBytes = backup.manifest.artifacts.reduce(
    (sum, artifact) => sum + artifact.encryptedBytes,
    0
  );
  if (!Number.isSafeInteger(encryptedBytes) || encryptedBytes < 1) {
    fail(
      "CURRENT_BACKUP_RESTORE_BACKUP_EMPTY",
      "The current backup attempt contains no ciphertext bytes."
    );
  }
  const evidence = contract.evidence.backup;
  const expectedEvidence = {
    receiptSha256: backup.manifestSha256,
    quiescenceEvidenceSha256:
      backup.manifest.consistency.fenceDigest,
    destinationMarkerSha256:
      backup.manifest.destinationMarkerSha256,
    ciphertextManifestSha256:
      currentBackupCiphertextManifestSha256(backup.manifest),
    recipientFingerprintSha256:
      backup.manifest.ageRecipientFingerprint,
    completedAt: backup.manifest.completedAt
  };
  for (const [field, expected] of Object.entries(expectedEvidence)) {
    if (evidence[field] !== expected) {
      fail(
        "CURRENT_BACKUP_RESTORE_BACKUP_MISMATCH",
        `The current backup ${field} does not match the retained contract evidence.`
      );
    }
  }
  return {
    sourceFailureDomainId,
    destinationFailureDomainId,
    encryptedBytes
  };
}

function receiptPayload(value) {
  return {
    schema: value.schema,
    state: value.state,
    release: value.release,
    backup: value.backup,
    restore: value.restore,
    policy: value.policy,
    cleanup: value.cleanup,
    rollback: value.rollback,
    holds: value.holds
  };
}

export function currentBackupRestoreReceiptDigest(value) {
  return immutableDigest(receiptPayload(value));
}

export function validateHeldCurrentBackupRestoreReceipt(value) {
  exactObject(
    value,
    [
      "schema",
      "state",
      "release",
      "backup",
      "restore",
      "policy",
      "cleanup",
      "rollback",
      "holds",
      "digest"
    ],
    "Current backup and restore receipt"
  );
  if (
    value.schema !== CURRENT_BACKUP_RESTORE_SCHEMA ||
    value.state !== "verified_held"
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_INVALID",
      "The current backup and restore receipt must remain verified-held."
    );
  }
  exactObject(
    value.release,
    [
      "epochId",
      "bindingSha256",
      "epochDigest",
      "sourceCommitSha",
      "sourceTreeSha",
      "artifactManifestSha256",
      "migrationCount",
      "latestMigration",
      "migrationManifestSha256",
      "installedReadbackDigest",
      "installedReadbackReceiptSha256"
    ],
    "Current backup release identity"
  );
  safeIdentifier(value.release.epochId, "Current backup release epoch");
  commit(value.release.sourceCommitSha, "Current backup source commit");
  commit(value.release.sourceTreeSha, "Current backup source tree");
  positiveInteger(value.release.migrationCount, "Current migration count");
  if (!MIGRATION_FILE.test(value.release.latestMigration)) {
    fail(
      "CURRENT_BACKUP_RESTORE_INVALID",
      "Current latest migration is invalid."
    );
  }
  for (const field of [
    "bindingSha256",
    "epochDigest",
    "artifactManifestSha256",
    "migrationManifestSha256",
    "installedReadbackDigest",
    "installedReadbackReceiptSha256"
  ]) digest(value.release[field], `Current release ${field}`);

  exactObject(
    value.backup,
    [
      "attemptId",
      "receiptSha256",
      "sourceFailureDomainId",
      "destinationFailureDomainId",
      "destinationMarkerSha256",
      "ciphertextManifestSha256",
      "encryptedBytes",
      "completedAt"
    ],
    "Current backup evidence"
  );
  if (
    typeof value.backup.attemptId !== "string" ||
    value.backup.attemptId.length < 3 ||
    value.backup.attemptId.length > 255
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_INVALID",
      "Current backup attempt identity is invalid."
    );
  }
  if (
    value.backup.sourceFailureDomainId ===
      value.backup.destinationFailureDomainId
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_DESTINATION_INVALID",
      "Current backup failure domains must differ."
    );
  }
  safeIdentifier(
    value.backup.sourceFailureDomainId,
    "Current backup source failure domain"
  );
  safeIdentifier(
    value.backup.destinationFailureDomainId,
    "Current backup destination failure domain"
  );
  positiveInteger(value.backup.encryptedBytes, "Current ciphertext bytes");
  for (const field of [
    "receiptSha256",
    "destinationMarkerSha256",
    "ciphertextManifestSha256"
  ]) digest(value.backup[field], `Current backup ${field}`);
  const backupCompletedAt = instant(
    value.backup.completedAt,
    "Current backup completion"
  );

  exactObject(
    value.restore,
    [
      "restoreId",
      "receiptSha256",
      "backupReceiptSha256",
      "startedAt",
      "completedAt",
      "durationMs",
      "targetFreshnessEvidenceSha256",
      "readinessProofSha256",
      "journeyProofSha256"
    ],
    "Current restore evidence"
  );
  safeIdentifier(value.restore.restoreId, "Current restore ID");
  for (const field of [
    "receiptSha256",
    "backupReceiptSha256",
    "targetFreshnessEvidenceSha256",
    "readinessProofSha256",
    "journeyProofSha256"
  ]) digest(value.restore[field], `Current restore ${field}`);
  if (value.restore.backupReceiptSha256 !== value.backup.receiptSha256) {
    fail(
      "CURRENT_BACKUP_RESTORE_RESTORE_MISMATCH",
      "Current restore evidence does not reference the exact backup."
    );
  }
  const restoreStartedAt = instant(
    value.restore.startedAt,
    "Current restore start"
  );
  const restoreCompletedAt = instant(
    value.restore.completedAt,
    "Current restore completion"
  );
  positiveInteger(
    value.restore.durationMs,
    "Current restore duration"
  );
  if (
    restoreStartedAt < backupCompletedAt ||
    restoreCompletedAt < restoreStartedAt ||
    value.restore.durationMs !==
      restoreCompletedAt.valueOf() - restoreStartedAt.valueOf()
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_RESTORE_MISMATCH",
      "Current restore timing is not exact and monotonic."
    );
  }

  exactObject(
    value.policy,
    [
      "rpoDecisionSha256",
      "rtoDecisionSha256",
      "rtoMaximumDurationMs",
      "retentionDecisionSha256",
      "recipientFingerprintSha256",
      "keyCustodyDecisionSha256",
      "recoveryAccessDecisionSha256"
    ],
    "Current backup policy decisions"
  );
  positiveInteger(
    value.policy.rtoMaximumDurationMs,
    "Current RTO maximum duration"
  );
  for (const [field, selected] of Object.entries(value.policy)) {
    if (field !== "rtoMaximumDurationMs") {
      digest(selected, `Current policy ${field}`);
    }
  }
  if (value.restore.durationMs > value.policy.rtoMaximumDurationMs) {
    fail(
      "CURRENT_BACKUP_RESTORE_RTO_EXCEEDED",
      "The clean-room restore exceeded the ratified RTO."
    );
  }

  exactObject(
    value.cleanup,
    [
      "receiptSha256",
      "restoreReceiptSha256",
      "databaseNameSha256",
      "databaseAbsent",
      "plaintextAbsent",
      "appStateAbsent",
      "observedAt"
    ],
    "Current restore cleanup evidence"
  );
  for (const field of [
    "receiptSha256",
    "restoreReceiptSha256",
    "databaseNameSha256"
  ]) digest(value.cleanup[field], `Current cleanup ${field}`);
  if (
    value.cleanup.restoreReceiptSha256 !== value.restore.receiptSha256 ||
    value.cleanup.databaseAbsent !== true ||
    value.cleanup.plaintextAbsent !== true ||
    value.cleanup.appStateAbsent !== true ||
    instant(value.cleanup.observedAt, "Current cleanup observation") <
      restoreCompletedAt
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_CLEANUP_INCOMPLETE",
      "Current cleanup evidence is incomplete or belongs to another restore."
    );
  }

  exactObject(
    value.rollback,
    [
      "proofSha256",
      "predecessorCommitSha",
      "predecessorTreeSha",
      "predecessorArtifactManifestSha256",
      "productionPromoted"
    ],
    "Current restore rollback evidence"
  );
  digest(value.rollback.proofSha256, "Current rollback proof");
  commit(
    value.rollback.predecessorCommitSha,
    "Current rollback predecessor commit"
  );
  commit(
    value.rollback.predecessorTreeSha,
    "Current rollback predecessor tree"
  );
  digest(
    value.rollback.predecessorArtifactManifestSha256,
    "Current rollback predecessor artifact"
  );
  if (
    value.rollback.productionPromoted !== false ||
    value.rollback.predecessorCommitSha === value.release.sourceCommitSha
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_ROLLBACK_INVALID",
      "Current rollback evidence must bind a distinct held predecessor."
    );
  }
  exactExpected(
    value.holds,
    CURRENT_BACKUP_RESTORE_HOLDS,
    "CURRENT_BACKUP_RESTORE_EFFECTS_NOT_HELD",
    "Current backup and restore effects must remain wholly held."
  );
  digest(value.digest, "Current backup and restore receipt");
  if (value.digest !== currentBackupRestoreReceiptDigest(value)) {
    fail(
      "CURRENT_BACKUP_RESTORE_DIGEST_MISMATCH",
      "The current backup and restore receipt digest is invalid."
    );
  }
  return freeze(structuredClone(value));
}

export async function verifyHeldCurrentBackupRestore({
  finalReleaseEpoch,
  originSeal,
  installedReadback,
  contract,
  integration,
  migrationFiles,
  backupAttemptRoot,
  destinationMarker,
  restoreReceipt,
  restoreReceiptSha256,
  readinessProofSha256,
  journeyProofSha256,
  cleanupReceipt,
  rollbackBinding,
  rtoDecision
}) {
  const seal = validateOriginSeal(originSeal);
  const readback = validateOriginInstalledReadback(installedReadback);
  const epoch = validateInstalledFinalReleaseEpochV2Chain({
    epoch: finalReleaseEpoch,
    originSeal: seal,
    installedReadback: readback
  });
  const expectedIntegration = createCurrentBackupRestoreIntegration({
    finalReleaseEpoch: epoch,
    originSeal: seal,
    installedReadback: readback,
    migrationFiles
  });
  const selectedIntegration = validateBackupRestoreIntegrationInput(
    integration
  );
  exactExpected(
    selectedIntegration,
    expectedIntegration,
    "CURRENT_BACKUP_RESTORE_RELEASE_MISMATCH",
    "The backup contract input does not describe the exact installed current release."
  );
  const selectedContract = validateHeldBackupRestoreContract(contract);
  verifyHeldBackupRestoreContract({
    contract: selectedContract,
    integration: selectedIntegration,
    migrationFiles
  });
  if (
    canonicalJson(selectedContract.holds.blockers) !==
      canonicalJson(["execution_not_authorized"]) ||
    selectedContract.evidence.backup.state !== "verified" ||
    selectedContract.evidence.restore.state !== "verified"
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_POLICY_UNRATIFIED",
      "RPO, retention, key custody, backup, and restore evidence must be complete while execution remains held."
    );
  }

  const backup = await loadVerifiedBackupAttempt(backupAttemptRoot);
  const backupBinding = validateBackupAttempt(backup, selectedContract);
  const selectedDestination = validateDestinationMarker(
    destinationMarker,
    backupBinding.sourceFailureDomainId
  );
  if (
    selectedDestination.failureDomainId !==
      backupBinding.destinationFailureDomainId ||
    selectedDestination.markerSha256 !==
      backup.manifest.destinationMarkerSha256
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_DESTINATION_INVALID",
      "The off-host destination marker does not match the exact backup attempt."
    );
  }
  const selectedRestore = validateRestoreReport(restoreReceipt, backup);
  digest(restoreReceiptSha256, "Clean-room restore receipt");
  if (
    restoreReceiptSha256 !== immutableDigest(selectedRestore) ||
    selectedContract.evidence.restore.receiptSha256 !==
      restoreReceiptSha256 ||
    selectedContract.evidence.restore.backupReceiptSha256 !==
      backup.manifestSha256 ||
    selectedContract.evidence.restore.backupCompletedAt !==
      backup.manifest.completedAt ||
    selectedContract.evidence.restore.startedAt !==
      selectedRestore.startedAt ||
    selectedContract.evidence.restore.completedAt !==
      selectedRestore.completedAt ||
    selectedContract.evidence.restore.targetFreshnessEvidenceSha256 !==
      currentRestoreTargetFreshnessSha256(selectedRestore)
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_RESTORE_MISMATCH",
      "The clean-room restore receipt does not match the retained contract evidence."
    );
  }
  digest(readinessProofSha256, "Restore readiness proof");
  digest(journeyProofSha256, "Restore journey proof");
  if (
    selectedContract.evidence.restore.readinessProofSha256 !==
      readinessProofSha256 ||
    selectedContract.evidence.restore.journeyProofSha256 !==
      journeyProofSha256
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_RESTORE_MISMATCH",
      "Readiness or journey proof drifted from the clean-room restore contract."
    );
  }

  const selectedCleanup = validateCurrentCleanupReceipt(cleanupReceipt);
  const selectedRollback = validateCurrentRollbackBinding(rollbackBinding);
  const selectedRto = validateRatifiedCurrentRtoDecision(rtoDecision);
  const databaseNameSha256 = sha256Bytes(
    Buffer.from(selectedRestore.database.databaseName, "utf8")
  );
  if (
    selectedCleanup.restoreReceiptSha256 !== restoreReceiptSha256 ||
    selectedCleanup.databaseNameSha256 !== databaseNameSha256 ||
    selectedContract.evidence.restore.cleanupProofSha256 !==
      selectedCleanup.digest ||
    selectedRollback.finalReleaseEpochDigest !== epoch.digest ||
    selectedRollback.restoreReceiptSha256 !== restoreReceiptSha256 ||
    canonicalJson(selectedRollback.predecessor) !==
      canonicalJson(epoch.rollback) ||
    selectedContract.evidence.restore.rollbackProofSha256 !==
      selectedRollback.digest
  ) {
    fail(
      "CURRENT_BACKUP_RESTORE_EVIDENCE_MISMATCH",
      "Cleanup or rollback evidence does not match the exact release and restore."
    );
  }
  const restoreStartedAt = instant(
    selectedRestore.startedAt,
    "Restore start"
  );
  const restoreCompletedAt = instant(
    selectedRestore.completedAt,
    "Restore completion"
  );
  const durationMs =
    restoreCompletedAt.valueOf() - restoreStartedAt.valueOf();
  if (durationMs < 1) {
    fail(
      "CURRENT_BACKUP_RESTORE_RESTORE_MISMATCH",
      "The clean-room restore duration must be measured and non-zero."
    );
  }
  if (durationMs > selectedRto.maximumDurationMs) {
    fail(
      "CURRENT_BACKUP_RESTORE_RTO_EXCEEDED",
      "The clean-room restore exceeded the ratified RTO."
    );
  }
  if (instant(selectedCleanup.observedAt, "Cleanup observation") < restoreCompletedAt) {
    fail(
      "CURRENT_BACKUP_RESTORE_CLEANUP_INCOMPLETE",
      "Cleanup evidence predates the completed clean-room restore."
    );
  }
  const readbackReceipt = compareOriginInstalledReadback({
    seal,
    readback
  });
  const value = {
    schema: CURRENT_BACKUP_RESTORE_SCHEMA,
    state: "verified_held",
    release: {
      epochId: epoch.epochId,
      bindingSha256: epoch.bindingSha256,
      epochDigest: epoch.digest,
      sourceCommitSha: epoch.identity.sourceCommitSha,
      sourceTreeSha: epoch.identity.sourceTreeSha,
      artifactManifestSha256:
        epoch.identity.artifactManifestSha256,
      migrationCount: epoch.identity.migrationCount,
      latestMigration: epoch.identity.latestMigration,
      migrationManifestSha256:
        epoch.identity.migrationManifestSha256,
      installedReadbackDigest: readback.digest,
      installedReadbackReceiptSha256:
        readbackReceipt.receiptSha256
    },
    backup: {
      attemptId: backup.manifest.attemptId,
      receiptSha256: backup.manifestSha256,
      sourceFailureDomainId:
        backupBinding.sourceFailureDomainId,
      destinationFailureDomainId:
        backupBinding.destinationFailureDomainId,
      destinationMarkerSha256:
        backup.manifest.destinationMarkerSha256,
      ciphertextManifestSha256:
        currentBackupCiphertextManifestSha256(backup.manifest),
      encryptedBytes: backupBinding.encryptedBytes,
      completedAt: backup.manifest.completedAt
    },
    restore: {
      restoreId: selectedRestore.restoreId,
      receiptSha256: restoreReceiptSha256,
      backupReceiptSha256: backup.manifestSha256,
      startedAt: selectedRestore.startedAt,
      completedAt: selectedRestore.completedAt,
      durationMs,
      targetFreshnessEvidenceSha256:
        currentRestoreTargetFreshnessSha256(selectedRestore),
      readinessProofSha256,
      journeyProofSha256
    },
    policy: {
      rpoDecisionSha256:
        selectedContract.decisions.rpo.evidenceSha256,
      rtoDecisionSha256: selectedRto.evidenceSha256,
      rtoMaximumDurationMs: selectedRto.maximumDurationMs,
      retentionDecisionSha256:
        selectedContract.decisions.retention.evidenceSha256,
      recipientFingerprintSha256:
        selectedContract.decisions.keyCustody
          .recipientFingerprintSha256,
      keyCustodyDecisionSha256:
        selectedContract.decisions.keyCustody
          .custodyEvidenceSha256,
      recoveryAccessDecisionSha256:
        selectedContract.decisions.keyCustody
          .recoveryAccessEvidenceSha256
    },
    cleanup: {
      receiptSha256: selectedCleanup.digest,
      restoreReceiptSha256:
        selectedCleanup.restoreReceiptSha256,
      databaseNameSha256:
        selectedCleanup.databaseNameSha256,
      databaseAbsent: true,
      plaintextAbsent: true,
      appStateAbsent: true,
      observedAt: selectedCleanup.observedAt
    },
    rollback: {
      proofSha256: selectedRollback.digest,
      ...structuredClone(selectedRollback.predecessor),
      productionPromoted: false
    },
    holds: structuredClone(CURRENT_BACKUP_RESTORE_HOLDS)
  };
  return validateHeldCurrentBackupRestoreReceipt({
    ...value,
    digest: currentBackupRestoreReceiptDigest(value)
  });
}
