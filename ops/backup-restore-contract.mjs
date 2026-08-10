import {
  canonicalJson,
  sha256Bytes
} from "./immutable-evidence.mjs";

export const BACKUP_RESTORE_CONTRACT_SCHEMA =
  "sitesourcery.backup-restore-contract/v1";
export const BACKUP_RESTORE_INTEGRATION_SCHEMA =
  "sitesourcery.backup-restore-integration-input/v1";
export const BACKUP_RESTORE_JSON_SCHEMA_ID =
  "https://sitesourcery.com/schemas/backup-restore-contract-v1.json";

const RELEASE_EPOCH_SCHEMA =
  "sitesourcery.release-epoch/v1";
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/u;
const MIGRATION_FILE = /^[0-9]{12}_[a-z0-9_]+\.sql$/u;

const BACKUP_EVIDENCE_FIELDS = Object.freeze([
  "state",
  "bindingSha256",
  "receiptSha256",
  "quiescenceEvidenceSha256",
  "destinationMarkerSha256",
  "ciphertextManifestSha256",
  "recipientFingerprintSha256",
  "keyCustodyEvidenceSha256",
  "recoveryAccessEvidenceSha256",
  "completedAt"
]);
const RESTORE_EVIDENCE_FIELDS = Object.freeze([
  "state",
  "bindingSha256",
  "receiptSha256",
  "backupReceiptSha256",
  "backupCompletedAt",
  "startedAt",
  "targetFreshnessEvidenceSha256",
  "readinessProofSha256",
  "journeyProofSha256",
  "cleanupProofSha256",
  "rollbackProofSha256",
  "completedAt"
]);

export const BACKUP_RESTORE_REQUIREMENTS = deepFreeze({
  backup: {
    attemptEvidenceSchema:
      "sitesourcery.backup-attempt-succeeded/v2",
    quiescenceSchema:
      "sitesourcery.backup-quiesce/v1",
    runtimeUnit: "sitesourcery-hosted.service",
    runtimeState: "inactive",
    writerFence: "engaged",
    databaseWriterCount: 0,
    filesystemSnapshotStable: true,
    destinationMarkerSchema:
      "sitesourcery.off-machine-destination/v1",
    destinationStorageClass: "off_machine",
    immutableAttempts: true,
    ciphertextFormat: "age",
    plaintextDestinationForbidden: true
  },
  restore: {
    evidenceSchema:
      "sitesourcery.clean-room-restore/v2",
    targetFreshness: "fresh_only",
    productionTargetForbidden: true,
    networkExposure: "none",
    providerEgress: "held",
    requiresReadinessProof: true,
    requiresJourneyProof: true,
    cleanupScope: "exact_restore_target_only",
    requiresCleanupProof: true,
    requiresRollbackProof: true
  }
});

export class BackupRestoreContractFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BackupRestoreContractFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new BackupRestoreContractFailure(code, message);
}

function deepFreeze(value) {
  if (
    value &&
    typeof value === "object" &&
    !Object.isFrozen(value)
  ) {
    for (const entry of Object.values(value)) {
      deepFreeze(entry);
    }
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value, expected, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...expected].sort())
  ) {
    fail(
      "BACKUP_RESTORE_CONTRACT_INVALID",
      `${label} must contain only its exact reviewed fields.`
    );
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(
      "BACKUP_RESTORE_CONTRACT_INVALID",
      `${label} must be an exact lowercase SHA-256 digest.`
    );
  }
  return value;
}

function commitSha(value, label) {
  if (
    typeof value !== "string" ||
    !COMMIT_SHA.test(value)
  ) {
    fail(
      "BACKUP_RESTORE_CONTRACT_INVALID",
      `${label} must be an exact lowercase Git commit SHA.`
    );
  }
  return value;
}

function safeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    fail(
      "BACKUP_RESTORE_CONTRACT_INVALID",
      `${label} must be a lowercase safe identifier.`
    );
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(
      "BACKUP_RESTORE_CONTRACT_INVALID",
      `${label} must be a positive safe integer.`
    );
  }
  return value;
}

function exactIso(value, label) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    fail(
      "BACKUP_RESTORE_CONTRACT_INVALID",
      `${label} must be an exact ISO timestamp.`
    );
  }
  return value;
}

function exactExpected(value, expected, label, code) {
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail(
      code,
      `${label} does not match the exact integration input.`
    );
  }
  return value;
}

function migrationName(value, label) {
  if (
    typeof value !== "string" ||
    !MIGRATION_FILE.test(value)
  ) {
    fail(
      "BACKUP_RESTORE_MIGRATION_INPUT_INVALID",
      `${label} must be an exact migration filename.`
    );
  }
  return value;
}

export function backupRestoreMigrationInventory(
  migrationFiles
) {
  if (
    !Array.isArray(migrationFiles) ||
    migrationFiles.length < 1
  ) {
    fail(
      "BACKUP_RESTORE_MIGRATION_INPUT_INVALID",
      "Migration inventory must contain at least one filename."
    );
  }
  const files = migrationFiles.map((file) =>
    migrationName(file, "Migration inventory entry")
  ).sort();
  if (new Set(files).size !== files.length) {
    fail(
      "BACKUP_RESTORE_MIGRATION_INPUT_INVALID",
      "Migration inventory must not contain duplicate filenames."
    );
  }
  return deepFreeze({
    migrationCount: files.length,
    latestMigration: files.at(-1),
    inventorySha256: sha256Bytes(
      Buffer.from(`${canonicalJson(files)}\n`, "utf8")
    )
  });
}

function validateDatabase(value, label) {
  exactKeys(
    value,
    [
      "migrationCount",
      "latestMigration",
      "inventorySha256"
    ],
    label
  );
  return deepFreeze({
    migrationCount: positiveInteger(
      value.migrationCount,
      `${label} migrationCount`
    ),
    latestMigration: migrationName(
      value.latestMigration,
      `${label} latestMigration`
    ),
    inventorySha256: digest(
      value.inventorySha256,
      `${label} inventorySha256`
    )
  });
}

function validateReleaseEpochProjection(value) {
  exactKeys(
    value,
    [
      "schema",
      "epochId",
      "bindingSha256",
      "receiptSha256",
      "sourceCommitSha",
      "artifactManifestSha256",
      "migrationCount",
      "latestMigration",
      "migrationInventorySha256"
    ],
    "Release epoch projection"
  );
  if (value.schema !== RELEASE_EPOCH_SCHEMA) {
    fail(
      "BACKUP_RESTORE_INTEGRATION_INVALID",
      "Release epoch projection schema is invalid."
    );
  }
  return deepFreeze({
    schema: RELEASE_EPOCH_SCHEMA,
    epochId: safeId(
      value.epochId,
      "Release epoch ID"
    ),
    bindingSha256: digest(
      value.bindingSha256,
      "Release epoch binding"
    ),
    receiptSha256: digest(
      value.receiptSha256,
      "Release epoch receipt"
    ),
    sourceCommitSha: commitSha(
      value.sourceCommitSha,
      "Release epoch source commit"
    ),
    artifactManifestSha256: digest(
      value.artifactManifestSha256,
      "Release epoch artifact manifest"
    ),
    migrationCount: positiveInteger(
      value.migrationCount,
      "Release epoch migration count"
    ),
    latestMigration: migrationName(
      value.latestMigration,
      "Release epoch latest migration"
    ),
    migrationInventorySha256: digest(
      value.migrationInventorySha256,
      "Release epoch migration inventory"
    )
  });
}

function validateSource(value) {
  exactKeys(value, ["commitSha"], "Source identity");
  return deepFreeze({
    commitSha: commitSha(
      value.commitSha,
      "Source identity commit"
    )
  });
}

function validateArtifact(value) {
  exactKeys(
    value,
    ["manifestSha256"],
    "Artifact identity"
  );
  return deepFreeze({
    manifestSha256: digest(
      value.manifestSha256,
      "Artifact manifest"
    )
  });
}

function validateInstalledIdentity(value) {
  exactKeys(
    value,
    [
      "state",
      "releaseEpochBindingSha256",
      "releaseCommitSha",
      "artifactManifestSha256",
      "migrationCount",
      "receiptSha256",
      "observedAt"
    ],
    "Installed identity"
  );
  if (value.state !== "verified") {
    fail(
      "BACKUP_RESTORE_INSTALLED_IDENTITY_REQUIRED",
      "Installed identity must be explicitly verified before planning a bound backup."
    );
  }
  return deepFreeze({
    state: "verified",
    releaseEpochBindingSha256: digest(
      value.releaseEpochBindingSha256,
      "Installed release epoch binding"
    ),
    releaseCommitSha: commitSha(
      value.releaseCommitSha,
      "Installed release commit"
    ),
    artifactManifestSha256: digest(
      value.artifactManifestSha256,
      "Installed artifact manifest"
    ),
    migrationCount: positiveInteger(
      value.migrationCount,
      "Installed migration count"
    ),
    receiptSha256: digest(
      value.receiptSha256,
      "Installed identity receipt"
    ),
    observedAt: exactIso(
      value.observedAt,
      "Installed identity observation"
    )
  });
}

export function validateBackupRestoreIntegrationInput(
  value
) {
  exactKeys(
    value,
    [
      "schema",
      "releaseEpoch",
      "source",
      "artifact",
      "installedIdentity",
      "database"
    ],
    "Backup and restore integration input"
  );
  if (value.schema !== BACKUP_RESTORE_INTEGRATION_SCHEMA) {
    fail(
      "BACKUP_RESTORE_INTEGRATION_INVALID",
      "Backup and restore integration schema is invalid."
    );
  }
  const releaseEpoch = validateReleaseEpochProjection(
    value.releaseEpoch
  );
  const source = validateSource(value.source);
  const artifact = validateArtifact(value.artifact);
  const installedIdentity = validateInstalledIdentity(
    value.installedIdentity
  );
  const database = validateDatabase(
    value.database,
    "Integration database identity"
  );
  if (
    releaseEpoch.sourceCommitSha !== source.commitSha ||
    source.commitSha !== installedIdentity.releaseCommitSha ||
    releaseEpoch.bindingSha256 !==
      installedIdentity.releaseEpochBindingSha256 ||
    releaseEpoch.artifactManifestSha256 !==
      artifact.manifestSha256 ||
    artifact.manifestSha256 !==
      installedIdentity.artifactManifestSha256 ||
    releaseEpoch.migrationCount !==
      database.migrationCount ||
    database.migrationCount !==
      installedIdentity.migrationCount ||
    releaseEpoch.latestMigration !==
      database.latestMigration ||
    releaseEpoch.migrationInventorySha256 !==
      database.inventorySha256
  ) {
    fail(
      "BACKUP_RESTORE_INTEGRATION_MISMATCH",
      "Release epoch, source, artifact, installed identity, and database inventory must describe one exact release."
    );
  }
  return deepFreeze({
    schema: BACKUP_RESTORE_INTEGRATION_SCHEMA,
    releaseEpoch,
    source,
    artifact,
    installedIdentity,
    database
  });
}

function integrationDigest(integration) {
  return sha256Bytes(
    Buffer.from(
      `${canonicalJson(integration)}\n`,
      "utf8"
    )
  );
}

export function backupRestoreIntegrationSha256(
  integration
) {
  return integrationDigest(
    validateBackupRestoreIntegrationInput(integration)
  );
}

function bindingFromIntegration(integration) {
  return deepFreeze({
    releaseEpoch: integration.releaseEpoch,
    source: integration.source,
    artifact: integration.artifact,
    installedIdentity: integration.installedIdentity,
    database: integration.database,
    sha256: integrationDigest(integration)
  });
}

function validateBinding(value) {
  exactKeys(
    value,
    [
      "releaseEpoch",
      "source",
      "artifact",
      "installedIdentity",
      "database",
      "sha256"
    ],
    "Backup and restore binding"
  );
  const integration = validateBackupRestoreIntegrationInput({
    schema: BACKUP_RESTORE_INTEGRATION_SCHEMA,
    releaseEpoch: value.releaseEpoch,
    source: value.source,
    artifact: value.artifact,
    installedIdentity: value.installedIdentity,
    database: value.database
  });
  const expected = bindingFromIntegration(integration);
  digest(value.sha256, "Backup and restore binding");
  return exactExpected(
    value,
    expected,
    "Backup and restore binding",
    "BACKUP_RESTORE_BINDING_MISMATCH"
  );
}

function requiredRpoDecision() {
  return {
    state: "required",
    maximumAgeMs: null,
    evidenceSha256: null
  };
}

function approvedRpoDecision(value) {
  exactKeys(
    value,
    ["maximumAgeMs", "evidenceSha256"],
    "RPO decision input"
  );
  return {
    state: "approved",
    maximumAgeMs: positiveInteger(
      value.maximumAgeMs,
      "RPO maximum age"
    ),
    evidenceSha256: digest(
      value.evidenceSha256,
      "RPO decision evidence"
    )
  };
}

function requiredRetentionDecision() {
  return {
    state: "required",
    maximumAgeMs: null,
    minimumSuccessfulAttempts: null,
    evidenceSha256: null
  };
}

function approvedRetentionDecision(value) {
  exactKeys(
    value,
    [
      "maximumAgeMs",
      "minimumSuccessfulAttempts",
      "evidenceSha256"
    ],
    "Retention decision input"
  );
  return {
    state: "approved",
    maximumAgeMs: positiveInteger(
      value.maximumAgeMs,
      "Retention maximum age"
    ),
    minimumSuccessfulAttempts: positiveInteger(
      value.minimumSuccessfulAttempts,
      "Retention minimum successful attempts"
    ),
    evidenceSha256: digest(
      value.evidenceSha256,
      "Retention decision evidence"
    )
  };
}

function requiredKeyCustodyDecision() {
  return {
    state: "required",
    recipientFingerprintSha256: null,
    custodyEvidenceSha256: null,
    recoveryAccessEvidenceSha256: null
  };
}

function approvedKeyCustodyDecision(value) {
  exactKeys(
    value,
    [
      "recipientFingerprintSha256",
      "custodyEvidenceSha256",
      "recoveryAccessEvidenceSha256"
    ],
    "Key-custody decision input"
  );
  return {
    state: "approved",
    recipientFingerprintSha256: digest(
      value.recipientFingerprintSha256,
      "Recipient fingerprint"
    ),
    custodyEvidenceSha256: digest(
      value.custodyEvidenceSha256,
      "Key-custody evidence"
    ),
    recoveryAccessEvidenceSha256: digest(
      value.recoveryAccessEvidenceSha256,
      "Recovery-access evidence"
    )
  };
}

function validateRpoDecision(value) {
  exactKeys(
    value,
    ["state", "maximumAgeMs", "evidenceSha256"],
    "RPO decision"
  );
  if (value.state === "required") {
    return exactExpected(
      value,
      requiredRpoDecision(),
      "RPO decision",
      "BACKUP_RESTORE_OWNER_DECISION_INVALID"
    );
  }
  if (value.state === "approved") {
    return exactExpected(
      value,
      approvedRpoDecision({
        maximumAgeMs: value.maximumAgeMs,
        evidenceSha256: value.evidenceSha256
      }),
      "RPO decision",
      "BACKUP_RESTORE_OWNER_DECISION_INVALID"
    );
  }
  fail(
    "BACKUP_RESTORE_OWNER_DECISION_INVALID",
    "RPO decision state is invalid."
  );
}

function validateRetentionDecision(value) {
  exactKeys(
    value,
    [
      "state",
      "maximumAgeMs",
      "minimumSuccessfulAttempts",
      "evidenceSha256"
    ],
    "Retention decision"
  );
  if (value.state === "required") {
    return exactExpected(
      value,
      requiredRetentionDecision(),
      "Retention decision",
      "BACKUP_RESTORE_OWNER_DECISION_INVALID"
    );
  }
  if (value.state === "approved") {
    return exactExpected(
      value,
      approvedRetentionDecision({
        maximumAgeMs: value.maximumAgeMs,
        minimumSuccessfulAttempts:
          value.minimumSuccessfulAttempts,
        evidenceSha256: value.evidenceSha256
      }),
      "Retention decision",
      "BACKUP_RESTORE_OWNER_DECISION_INVALID"
    );
  }
  fail(
    "BACKUP_RESTORE_OWNER_DECISION_INVALID",
    "Retention decision state is invalid."
  );
}

function validateKeyCustodyDecision(value) {
  exactKeys(
    value,
    [
      "state",
      "recipientFingerprintSha256",
      "custodyEvidenceSha256",
      "recoveryAccessEvidenceSha256"
    ],
    "Key-custody decision"
  );
  if (value.state === "required") {
    return exactExpected(
      value,
      requiredKeyCustodyDecision(),
      "Key-custody decision",
      "BACKUP_RESTORE_OWNER_DECISION_INVALID"
    );
  }
  if (value.state === "approved") {
    return exactExpected(
      value,
      approvedKeyCustodyDecision({
        recipientFingerprintSha256:
          value.recipientFingerprintSha256,
        custodyEvidenceSha256:
          value.custodyEvidenceSha256,
        recoveryAccessEvidenceSha256:
          value.recoveryAccessEvidenceSha256
      }),
      "Key-custody decision",
      "BACKUP_RESTORE_OWNER_DECISION_INVALID"
    );
  }
  fail(
    "BACKUP_RESTORE_OWNER_DECISION_INVALID",
    "Key-custody decision state is invalid."
  );
}

function notProvenEvidence(fields, bindingSha256) {
  return Object.fromEntries(
    fields.map((field) => [
      field,
      field === "state"
        ? "not_proven"
        : field === "bindingSha256"
          ? bindingSha256
          : null
    ])
  );
}

function verifiedBackupEvidence(
  value,
  bindingSha256,
  keyCustody
) {
  exactKeys(
    value,
    BACKUP_EVIDENCE_FIELDS.filter(
      (field) => !["state", "bindingSha256"].includes(field)
    ),
    "Backup evidence input"
  );
  if (keyCustody.state !== "approved") {
    fail(
      "BACKUP_RESTORE_KEY_CUSTODY_REQUIRED",
      "Verified backup evidence requires an approved key-custody decision."
    );
  }
  if (
    value.recipientFingerprintSha256 !==
      keyCustody.recipientFingerprintSha256 ||
    value.keyCustodyEvidenceSha256 !==
      keyCustody.custodyEvidenceSha256 ||
    value.recoveryAccessEvidenceSha256 !==
      keyCustody.recoveryAccessEvidenceSha256
  ) {
    fail(
      "BACKUP_RESTORE_KEY_CUSTODY_MISMATCH",
      "Backup evidence does not use the approved key-custody reference."
    );
  }
  return {
    state: "verified",
    bindingSha256,
    receiptSha256: digest(
      value.receiptSha256,
      "Backup receipt"
    ),
    quiescenceEvidenceSha256: digest(
      value.quiescenceEvidenceSha256,
      "Backup quiescence evidence"
    ),
    destinationMarkerSha256: digest(
      value.destinationMarkerSha256,
      "Off-machine destination marker"
    ),
    ciphertextManifestSha256: digest(
      value.ciphertextManifestSha256,
      "Ciphertext manifest"
    ),
    recipientFingerprintSha256: digest(
      value.recipientFingerprintSha256,
      "Backup recipient fingerprint"
    ),
    keyCustodyEvidenceSha256: digest(
      value.keyCustodyEvidenceSha256,
      "Backup key-custody evidence"
    ),
    recoveryAccessEvidenceSha256: digest(
      value.recoveryAccessEvidenceSha256,
      "Backup recovery-access evidence"
    ),
    completedAt: exactIso(
      value.completedAt,
      "Backup completion"
    )
  };
}

function validateBackupEvidence(
  value,
  bindingSha256,
  keyCustody
) {
  exactKeys(
    value,
    BACKUP_EVIDENCE_FIELDS,
    "Backup evidence"
  );
  if (value.bindingSha256 !== bindingSha256) {
    fail(
      "BACKUP_RESTORE_EVIDENCE_INVALID",
      "Backup evidence does not match the exact integration binding."
    );
  }
  if (
    value.state === "not_proven" &&
    canonicalJson(value) === canonicalJson(
      notProvenEvidence(
        BACKUP_EVIDENCE_FIELDS,
        bindingSha256
      )
    )
  ) return deepFreeze({ ...value });
  if (value.state !== "verified") {
    fail(
      "BACKUP_RESTORE_EVIDENCE_INVALID",
      "Backup evidence must be exactly not_proven or verified."
    );
  }
  return deepFreeze(verifiedBackupEvidence(
    Object.fromEntries(
      BACKUP_EVIDENCE_FIELDS
        .filter((field) =>
          !["state", "bindingSha256"].includes(field)
        )
        .map((field) => [field, value[field]])
    ),
    bindingSha256,
    keyCustody
  ));
}

function verifiedRestoreEvidence(
  value,
  bindingSha256,
  backup,
  rpo,
  keyCustody
) {
  exactKeys(
    value,
    RESTORE_EVIDENCE_FIELDS.filter(
      (field) => !["state", "bindingSha256"].includes(field)
    ),
    "Restore evidence input"
  );
  if (
    backup.state !== "verified" ||
    keyCustody.state !== "approved"
  ) {
    fail(
      "BACKUP_RESTORE_PREREQUISITE_INVALID",
      "Verified restore evidence requires the bound backup and approved key custody."
    );
  }
  if (
    value.backupReceiptSha256 !== backup.receiptSha256 ||
    value.backupCompletedAt !== backup.completedAt
  ) {
    fail(
      "BACKUP_RESTORE_EVIDENCE_MISMATCH",
      "Restore evidence does not bind the exact verified backup."
    );
  }
  const backupCompletedAt = Date.parse(
    exactIso(
      value.backupCompletedAt,
      "Restore backup completion"
    )
  );
  const startedAt = Date.parse(
    exactIso(value.startedAt, "Restore start")
  );
  const completedAt = Date.parse(
    exactIso(value.completedAt, "Restore completion")
  );
  if (
    startedAt < backupCompletedAt ||
    completedAt < startedAt
  ) {
    fail(
      "BACKUP_RESTORE_EVIDENCE_INVALID",
      "Restore evidence timestamps are not monotonic."
    );
  }
  if (
    rpo.state === "approved" &&
    startedAt - backupCompletedAt > rpo.maximumAgeMs
  ) {
    fail(
      "BACKUP_RESTORE_RPO_EXCEEDED",
      "The clean-room restore began outside the owner-approved RPO."
    );
  }
  const selected = {
    state: "verified",
    bindingSha256,
    receiptSha256: digest(
      value.receiptSha256,
      "Restore receipt"
    ),
    backupReceiptSha256: digest(
      value.backupReceiptSha256,
      "Restore backup receipt"
    ),
    backupCompletedAt: value.backupCompletedAt,
    startedAt: value.startedAt,
    targetFreshnessEvidenceSha256: digest(
      value.targetFreshnessEvidenceSha256,
      "Restore target freshness evidence"
    ),
    readinessProofSha256: digest(
      value.readinessProofSha256,
      "Restore readiness proof"
    ),
    journeyProofSha256: digest(
      value.journeyProofSha256,
      "Restore journey proof"
    ),
    cleanupProofSha256: digest(
      value.cleanupProofSha256,
      "Restore cleanup proof"
    ),
    rollbackProofSha256: digest(
      value.rollbackProofSha256,
      "Restore rollback proof"
    ),
    completedAt: value.completedAt
  };
  return selected;
}

function validateRestoreEvidence(
  value,
  bindingSha256,
  backup,
  rpo,
  keyCustody
) {
  exactKeys(
    value,
    RESTORE_EVIDENCE_FIELDS,
    "Restore evidence"
  );
  if (value.bindingSha256 !== bindingSha256) {
    fail(
      "BACKUP_RESTORE_EVIDENCE_INVALID",
      "Restore evidence does not match the exact integration binding."
    );
  }
  if (
    value.state === "not_proven" &&
    canonicalJson(value) === canonicalJson(
      notProvenEvidence(
        RESTORE_EVIDENCE_FIELDS,
        bindingSha256
      )
    )
  ) return deepFreeze({ ...value });
  if (value.state !== "verified") {
    fail(
      "BACKUP_RESTORE_EVIDENCE_INVALID",
      "Restore evidence must be exactly not_proven or verified."
    );
  }
  return deepFreeze(verifiedRestoreEvidence(
    Object.fromEntries(
      RESTORE_EVIDENCE_FIELDS
        .filter((field) =>
          !["state", "bindingSha256"].includes(field)
        )
        .map((field) => [field, value[field]])
    ),
    bindingSha256,
    backup,
    rpo,
    keyCustody
  ));
}

function expectedBlockers(decisions, evidence) {
  const blockers = [];
  if (decisions.rpo.state !== "approved") {
    blockers.push("owner_rpo_decision");
  }
  if (decisions.retention.state !== "approved") {
    blockers.push("owner_retention_decision");
  }
  if (decisions.keyCustody.state !== "approved") {
    blockers.push("owner_key_custody_decision");
  }
  if (evidence.backup.state !== "verified") {
    blockers.push("backup_evidence");
  }
  if (evidence.restore.state !== "verified") {
    blockers.push("clean_room_restore_evidence");
  }
  blockers.push("execution_not_authorized");
  return blockers;
}

function heldState(blockers) {
  return deepFreeze({
    state: "held",
    allowsBackup: false,
    allowsDecrypt: false,
    allowsDatabaseMutation: false,
    allowsMountMutation: false,
    allowsProviderEffects: false,
    allowsCustomerEffects: false,
    allowsCleanup: false,
    blockers
  });
}

function validateRequirements(value) {
  return exactExpected(
    value,
    BACKUP_RESTORE_REQUIREMENTS,
    "Backup and restore requirements",
    "BACKUP_RESTORE_REQUIREMENTS_INVALID"
  );
}

function validateHolds(value, decisions, evidence) {
  exactKeys(
    value,
    [
      "state",
      "allowsBackup",
      "allowsDecrypt",
      "allowsDatabaseMutation",
      "allowsMountMutation",
      "allowsProviderEffects",
      "allowsCustomerEffects",
      "allowsCleanup",
      "blockers"
    ],
    "Backup and restore holds"
  );
  return exactExpected(
    value,
    heldState(expectedBlockers(decisions, evidence)),
    "Backup and restore holds",
    "BACKUP_RESTORE_HOLD_INVALID"
  );
}

export function createHeldBackupRestoreContract({
  integration,
  rpoDecision = null,
  retentionDecision = null,
  keyCustodyDecision = null,
  backupEvidence = null,
  restoreEvidence = null
} = {}) {
  const selectedIntegration =
    validateBackupRestoreIntegrationInput(integration);
  const binding = bindingFromIntegration(
    selectedIntegration
  );
  const decisions = {
    rpo: rpoDecision === null
      ? requiredRpoDecision()
      : approvedRpoDecision(rpoDecision),
    retention: retentionDecision === null
      ? requiredRetentionDecision()
      : approvedRetentionDecision(retentionDecision),
    keyCustody: keyCustodyDecision === null
      ? requiredKeyCustodyDecision()
      : approvedKeyCustodyDecision(keyCustodyDecision)
  };
  const backup = backupEvidence === null
    ? notProvenEvidence(
        BACKUP_EVIDENCE_FIELDS,
        binding.sha256
      )
    : verifiedBackupEvidence(
        backupEvidence,
        binding.sha256,
        decisions.keyCustody
      );
  const restore = restoreEvidence === null
    ? notProvenEvidence(
        RESTORE_EVIDENCE_FIELDS,
        binding.sha256
      )
    : verifiedRestoreEvidence(
        restoreEvidence,
        binding.sha256,
        backup,
        decisions.rpo,
        decisions.keyCustody
      );
  const evidence = { backup, restore };
  return validateHeldBackupRestoreContract({
    schema: BACKUP_RESTORE_CONTRACT_SCHEMA,
    mode: "held",
    binding,
    decisions,
    requirements: BACKUP_RESTORE_REQUIREMENTS,
    evidence,
    holds: heldState(
      expectedBlockers(decisions, evidence)
    )
  });
}

export function validateHeldBackupRestoreContract(value) {
  exactKeys(
    value,
    [
      "schema",
      "mode",
      "binding",
      "decisions",
      "requirements",
      "evidence",
      "holds"
    ],
    "Backup and restore contract"
  );
  if (
    value.schema !== BACKUP_RESTORE_CONTRACT_SCHEMA ||
    value.mode !== "held"
  ) {
    fail(
      "BACKUP_RESTORE_CONTRACT_INVALID",
      "Backup and restore contract must remain exactly held."
    );
  }
  const binding = validateBinding(value.binding);
  exactKeys(
    value.decisions,
    ["rpo", "retention", "keyCustody"],
    "Backup and restore decisions"
  );
  const decisions = deepFreeze({
    rpo: validateRpoDecision(value.decisions.rpo),
    retention: validateRetentionDecision(
      value.decisions.retention
    ),
    keyCustody: validateKeyCustodyDecision(
      value.decisions.keyCustody
    )
  });
  const requirements = validateRequirements(
    value.requirements
  );
  exactKeys(
    value.evidence,
    ["backup", "restore"],
    "Backup and restore evidence"
  );
  const backup = validateBackupEvidence(
    value.evidence.backup,
    binding.sha256,
    decisions.keyCustody
  );
  const restore = validateRestoreEvidence(
    value.evidence.restore,
    binding.sha256,
    backup,
    decisions.rpo,
    decisions.keyCustody
  );
  const evidence = deepFreeze({ backup, restore });
  const holds = validateHolds(
    value.holds,
    decisions,
    evidence
  );
  return deepFreeze({
    schema: BACKUP_RESTORE_CONTRACT_SCHEMA,
    mode: "held",
    binding,
    decisions,
    requirements,
    evidence,
    holds
  });
}

export function verifyHeldBackupRestoreContract({
  contract,
  integration,
  migrationFiles
}) {
  const selectedContract =
    validateHeldBackupRestoreContract(contract);
  const selectedIntegration =
    validateBackupRestoreIntegrationInput(integration);
  const expectedBinding = bindingFromIntegration(
    selectedIntegration
  );
  exactExpected(
    selectedContract.binding,
    expectedBinding,
    "Backup and restore integration binding",
    "BACKUP_RESTORE_BINDING_MISMATCH"
  );
  const observedInventory =
    backupRestoreMigrationInventory(migrationFiles);
  exactExpected(
    observedInventory,
    selectedIntegration.database,
    "Migration inventory",
    "BACKUP_RESTORE_MIGRATION_MISMATCH"
  );
  return deepFreeze({
    valid: true,
    mode: "held",
    releaseEpochId:
      selectedContract.binding.releaseEpoch.epochId,
    bindingSha256: selectedContract.binding.sha256,
    migrationCount: observedInventory.migrationCount,
    latestMigration: observedInventory.latestMigration,
    rpoDecision: selectedContract.decisions.rpo.state,
    retentionDecision:
      selectedContract.decisions.retention.state,
    keyCustodyDecision:
      selectedContract.decisions.keyCustody.state,
    backupEvidence:
      selectedContract.evidence.backup.state,
    restoreEvidence:
      selectedContract.evidence.restore.state,
    blockerCount: selectedContract.holds.blockers.length,
    effectsAllowed: false
  });
}
