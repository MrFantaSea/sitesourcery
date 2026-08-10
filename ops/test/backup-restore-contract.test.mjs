import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BACKUP_SUCCEEDED_SCHEMA,
  OFF_MACHINE_DESTINATION_SCHEMA,
  PRODUCTION_BACKUP_RUNTIME_UNIT,
  QUIESCE_SCHEMA
} from "../backup-runtime.mjs";
import {
  BACKUP_RESTORE_CONTRACT_SCHEMA,
  BACKUP_RESTORE_INTEGRATION_SCHEMA,
  BACKUP_RESTORE_REQUIREMENTS,
  BackupRestoreContractFailure,
  backupRestoreMigrationInventory,
  createHeldBackupRestoreContract,
  validateHeldBackupRestoreContract,
  verifyHeldBackupRestoreContract
} from "../backup-restore-contract.mjs";
import {
  RESTORE_VERIFIED_SCHEMA
} from "../restore-runtime.mjs";
import {
  BackupRestoreVerificationFailure,
  verifyBackupRestoreRepository
} from "../verify-backup-restore-contract.mjs";

const MIGRATION_FILES = Object.freeze([
  "202608100108_fixture_foundation.sql",
  "202608100111_fixture_identity.sql",
  "202608100112_fixture_evidence.sql",
  "202608100113_fixture_readiness.sql"
]);
const SOURCE_COMMIT = "a".repeat(40);
const OBSERVED_AT = "2026-08-10T12:00:00.000Z";
const BACKUP_COMPLETED_AT =
  "2026-08-10T12:10:00.000Z";
const RESTORE_STARTED_AT =
  "2026-08-10T12:20:00.000Z";
const RESTORE_COMPLETED_AT =
  "2026-08-10T12:25:00.000Z";

function digest(character) {
  return character.repeat(64);
}

function clone(value) {
  return structuredClone(value);
}

function integrationInput(
  migrationFiles = MIGRATION_FILES
) {
  const database = backupRestoreMigrationInventory(
    migrationFiles
  );
  return {
    schema: BACKUP_RESTORE_INTEGRATION_SCHEMA,
    releaseEpoch: {
      schema: "sitesourcery.release-epoch/v1",
      epochId: "fixture-release-epoch",
      bindingSha256: digest("b"),
      receiptSha256: digest("c"),
      sourceCommitSha: SOURCE_COMMIT,
      artifactManifestSha256: digest("d"),
      migrationCount: database.migrationCount,
      latestMigration: database.latestMigration,
      migrationInventorySha256:
        database.inventorySha256
    },
    source: {
      commitSha: SOURCE_COMMIT
    },
    artifact: {
      manifestSha256: digest("d")
    },
    installedIdentity: {
      state: "verified",
      releaseEpochBindingSha256: digest("b"),
      releaseCommitSha: SOURCE_COMMIT,
      artifactManifestSha256: digest("d"),
      migrationCount: database.migrationCount,
      receiptSha256: digest("e"),
      observedAt: OBSERVED_AT
    },
    database
  };
}

function ownerDecisions() {
  return {
    rpoDecision: {
      maximumAgeMs: 60 * 60 * 1000,
      evidenceSha256: digest("1")
    },
    retentionDecision: {
      maximumAgeMs: 30 * 24 * 60 * 60 * 1000,
      minimumSuccessfulAttempts: 7,
      evidenceSha256: digest("2")
    },
    keyCustodyDecision: {
      recipientFingerprintSha256: digest("3"),
      custodyEvidenceSha256: digest("4"),
      recoveryAccessEvidenceSha256: digest("5")
    }
  };
}

function backupEvidence() {
  return {
    receiptSha256: digest("6"),
    quiescenceEvidenceSha256: digest("7"),
    destinationMarkerSha256: digest("8"),
    ciphertextManifestSha256: digest("9"),
    recipientFingerprintSha256: digest("3"),
    keyCustodyEvidenceSha256: digest("4"),
    recoveryAccessEvidenceSha256: digest("5"),
    completedAt: BACKUP_COMPLETED_AT
  };
}

function restoreEvidence() {
  return {
    receiptSha256: digest("f"),
    backupReceiptSha256: digest("6"),
    backupCompletedAt: BACKUP_COMPLETED_AT,
    startedAt: RESTORE_STARTED_AT,
    targetFreshnessEvidenceSha256: digest("0"),
    readinessProofSha256: digest("a"),
    journeyProofSha256: digest("b"),
    cleanupProofSha256: digest("c"),
    rollbackProofSha256: digest("d"),
    completedAt: RESTORE_COMPLETED_AT
  };
}

function rejects(candidate, code) {
  assert.throws(
    () => validateHeldBackupRestoreContract(candidate),
    (error) =>
      error instanceof BackupRestoreContractFailure &&
      error.code === code
  );
}

test("constructs one dynamic held-only backup and restore contract", () => {
  const contract = createHeldBackupRestoreContract({
    integration: integrationInput()
  });
  assert.equal(
    contract.schema,
    BACKUP_RESTORE_CONTRACT_SCHEMA
  );
  assert.equal(contract.mode, "held");
  assert.equal(contract.binding.database.migrationCount, 4);
  assert.equal(
    contract.binding.database.latestMigration,
    "202608100113_fixture_readiness.sql"
  );
  assert.deepEqual(contract.decisions, {
    rpo: {
      state: "required",
      maximumAgeMs: null,
      evidenceSha256: null
    },
    retention: {
      state: "required",
      maximumAgeMs: null,
      minimumSuccessfulAttempts: null,
      evidenceSha256: null
    },
    keyCustody: {
      state: "required",
      recipientFingerprintSha256: null,
      custodyEvidenceSha256: null,
      recoveryAccessEvidenceSha256: null
    }
  });
  assert.deepEqual(contract.holds.blockers, [
    "owner_rpo_decision",
    "owner_retention_decision",
    "owner_key_custody_decision",
    "backup_evidence",
    "clean_room_restore_evidence",
    "execution_not_authorized"
  ]);
  assert.equal(contract.holds.allowsBackup, false);
  assert.equal(contract.holds.allowsDecrypt, false);
  assert.equal(
    contract.holds.allowsDatabaseMutation,
    false
  );
  assert.equal(contract.holds.allowsMountMutation, false);
  assert.equal(contract.holds.allowsProviderEffects, false);
  assert.equal(contract.holds.allowsCustomerEffects, false);
  assert.equal(contract.holds.allowsCleanup, false);
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.binding.database), true);
});

test("preserves every existing backup and clean-room restore invariant", () => {
  assert.deepEqual(BACKUP_RESTORE_REQUIREMENTS, {
    backup: {
      attemptEvidenceSchema: BACKUP_SUCCEEDED_SCHEMA,
      quiescenceSchema: QUIESCE_SCHEMA,
      runtimeUnit: PRODUCTION_BACKUP_RUNTIME_UNIT,
      runtimeState: "inactive",
      writerFence: "engaged",
      databaseWriterCount: 0,
      filesystemSnapshotStable: true,
      destinationMarkerSchema:
        OFF_MACHINE_DESTINATION_SCHEMA,
      destinationStorageClass: "off_machine",
      immutableAttempts: true,
      ciphertextFormat: "age",
      plaintextDestinationForbidden: true
    },
    restore: {
      evidenceSchema: RESTORE_VERIFIED_SCHEMA,
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
});

test("requires one exact release epoch source artifact installed and migration identity", () => {
  const mutations = [
    (value) => {
      value.releaseEpoch.sourceCommitSha = "0".repeat(40);
    },
    (value) => {
      value.releaseEpoch.artifactManifestSha256 = digest("1");
    },
    (value) => {
      value.installedIdentity.migrationCount += 1;
    },
    (value) => {
      value.installedIdentity.artifactManifestSha256 = digest("2");
    },
    (value) => {
      value.releaseEpoch.latestMigration =
        "202608100114_rogue.sql";
    },
    (value) => {
      value.database.rogue = true;
    }
  ];
  for (const mutate of mutations) {
    const integration = clone(integrationInput());
    mutate(integration);
    assert.throws(
      () => createHeldBackupRestoreContract({ integration }),
      (error) =>
        error instanceof BackupRestoreContractFailure
    );
  }
  const unproven = clone(integrationInput());
  unproven.installedIdentity.state = "not_proven";
  assert.throws(
    () => createHeldBackupRestoreContract({
      integration: unproven
    }),
    (error) =>
      error instanceof BackupRestoreContractFailure &&
      error.code ===
        "BACKUP_RESTORE_INSTALLED_IDENTITY_REQUIRED"
  );
});

test("migration inventory is an explicit verified integration input", () => {
  const integration = integrationInput();
  const contract = createHeldBackupRestoreContract({
    integration
  });
  assert.deepEqual(
    verifyHeldBackupRestoreContract({
      contract,
      integration,
      migrationFiles: [...MIGRATION_FILES].reverse()
    }),
    {
      valid: true,
      mode: "held",
      releaseEpochId: "fixture-release-epoch",
      bindingSha256: contract.binding.sha256,
      migrationCount: 4,
      latestMigration:
        "202608100113_fixture_readiness.sql",
      rpoDecision: "required",
      retentionDecision: "required",
      keyCustodyDecision: "required",
      backupEvidence: "not_proven",
      restoreEvidence: "not_proven",
      blockerCount: 6,
      effectsAllowed: false
    }
  );
  for (const drifted of [
    MIGRATION_FILES.slice(0, -1),
    [...MIGRATION_FILES, "202608100114_fixture_new.sql"]
  ]) {
    assert.throws(
      () => verifyHeldBackupRestoreContract({
        contract,
        integration,
        migrationFiles: drifted
      }),
      (error) =>
        error instanceof BackupRestoreContractFailure &&
        error.code ===
          "BACKUP_RESTORE_MIGRATION_MISMATCH"
    );
  }
});

test("owner decisions remove only their blockers and never authorize effects", () => {
  const contract = createHeldBackupRestoreContract({
    integration: integrationInput(),
    ...ownerDecisions()
  });
  assert.deepEqual(contract.holds.blockers, [
    "backup_evidence",
    "clean_room_restore_evidence",
    "execution_not_authorized"
  ]);
  assert.equal(
    Object.entries(contract.holds)
      .filter(([field]) => field.startsWith("allows"))
      .every(([, value]) => value === false),
    true
  );
  const invented = clone(contract);
  invented.decisions.rpo.state = "approved";
  invented.decisions.rpo.maximumAgeMs = null;
  rejects(
    invented,
    "BACKUP_RESTORE_CONTRACT_INVALID"
  );
});

test("verified fixture evidence binds ciphertext custody quiescence freshness readiness journey cleanup and rollback", () => {
  const contract = createHeldBackupRestoreContract({
    integration: integrationInput(),
    ...ownerDecisions(),
    backupEvidence: backupEvidence(),
    restoreEvidence: restoreEvidence()
  });
  assert.equal(contract.evidence.backup.state, "verified");
  assert.equal(contract.evidence.restore.state, "verified");
  assert.equal(
    contract.evidence.restore.backupReceiptSha256,
    contract.evidence.backup.receiptSha256
  );
  assert.deepEqual(
    contract.holds.blockers,
    ["execution_not_authorized"]
  );
  assert.equal(contract.holds.allowsBackup, false);
  assert.equal(contract.holds.allowsDecrypt, false);
});

test("fixture evidence fails closed on custody RPO proof and binding drift", () => {
  const wrongCustody = backupEvidence();
  wrongCustody.keyCustodyEvidenceSha256 = digest("e");
  assert.throws(
    () => createHeldBackupRestoreContract({
      integration: integrationInput(),
      ...ownerDecisions(),
      backupEvidence: wrongCustody
    }),
    (error) =>
      error instanceof BackupRestoreContractFailure &&
      error.code ===
        "BACKUP_RESTORE_KEY_CUSTODY_MISMATCH"
  );

  const staleRestore = restoreEvidence();
  staleRestore.startedAt = "2026-08-10T14:00:01.000Z";
  staleRestore.completedAt = "2026-08-10T14:05:00.000Z";
  assert.throws(
    () => createHeldBackupRestoreContract({
      integration: integrationInput(),
      ...ownerDecisions(),
      backupEvidence: backupEvidence(),
      restoreEvidence: staleRestore
    }),
    (error) =>
      error instanceof BackupRestoreContractFailure &&
      error.code === "BACKUP_RESTORE_RPO_EXCEEDED"
  );

  const incomplete = restoreEvidence();
  incomplete.readinessProofSha256 = null;
  assert.throws(
    () => createHeldBackupRestoreContract({
      integration: integrationInput(),
      ...ownerDecisions(),
      backupEvidence: backupEvidence(),
      restoreEvidence: incomplete
    }),
    (error) =>
      error instanceof BackupRestoreContractFailure &&
      error.code === "BACKUP_RESTORE_CONTRACT_INVALID"
  );

  const verified = createHeldBackupRestoreContract({
    integration: integrationInput(),
    ...ownerDecisions(),
    backupEvidence: backupEvidence(),
    restoreEvidence: restoreEvidence()
  });
  const leaked = clone(verified);
  leaked.holds.allowsProviderEffects = true;
  rejects(leaked, "BACKUP_RESTORE_HOLD_INVALID");
  const rebound = clone(verified);
  rebound.evidence.restore.bindingSha256 = digest("e");
  rejects(rebound, "BACKUP_RESTORE_EVIDENCE_INVALID");
});

test("schema and repository verifier remain strict and fixture-only", async () => {
  const schemaSource = await readFile(
    new URL(
      "../backup-restore-contract.schema.json",
      import.meta.url
    ),
    "utf8"
  );
  const schema = JSON.parse(schemaSource);
  assert.equal(schema.additionalProperties, false);
  assert.equal(
    schema.$defs.database.properties.migrationCount.minimum,
    1
  );
  assert.equal(
    Object.hasOwn(
      schema.$defs.database.properties.migrationCount,
      "const"
    ),
    false
  );
  assert.equal(
    schema.$defs.backupEvidence.additionalProperties,
    false
  );
  assert.equal(
    schema.$defs.restoreEvidence.additionalProperties,
    false
  );
  assert.equal(
    schema.$defs.holds.properties
      .allowsProviderEffects.const,
    false
  );

  const integration = integrationInput();
  const contract = createHeldBackupRestoreContract({
    integration
  });
  const documents = new Map([
    ["/fixture/contract.json", contract],
    ["/fixture/integration.json", integration],
    ["/fixture/schema.json", schema]
  ]);
  const result = await verifyBackupRestoreRepository({
    contractPath: "/fixture/contract.json",
    integrationPath: "/fixture/integration.json",
    schemaPath: "/fixture/schema.json",
    migrationRoot: "/fixture/migrations",
    readJson: async (selectedPath) =>
      clone(documents.get(selectedPath)),
    readDirectory: async () =>
      MIGRATION_FILES.map((name) => ({
        name,
        isFile: () => true
      }))
  });
  assert.equal(result.valid, true);
  assert.equal(result.migrationCount, 4);
  assert.equal(result.effectsAllowed, false);

  await assert.rejects(
    () => verifyBackupRestoreRepository({
      contractPath: "/fixture/contract.json",
      integrationPath: "/fixture/integration.json",
      schemaPath: "/fixture/schema.json",
      migrationRoot: "/fixture/migrations",
      readJson: async (selectedPath) =>
        clone(documents.get(selectedPath)),
      readDirectory: async () => [
        ...MIGRATION_FILES.map((name) => ({
          name,
          isFile: () => true
        })),
        {
          name: "202608100114_fixture_symlink.sql",
          isFile: () => false
        }
      ]
    }),
    (error) =>
      error instanceof BackupRestoreVerificationFailure &&
      error.code ===
        "BACKUP_RESTORE_MIGRATION_ENTRY_INVALID"
  );

  await assert.rejects(
    () => verifyBackupRestoreRepository({
      contractPath: "relative.json",
      integrationPath: "/fixture/integration.json"
    }),
    (error) =>
      error instanceof BackupRestoreVerificationFailure &&
      error.code === "BACKUP_RESTORE_ARGUMENT_INVALID"
  );
});
