import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createHeldBackupRestoreContract
} from "../backup-restore-contract.mjs";
import {
  OFF_MACHINE_DESTINATION_SCHEMA,
  QUIESCE_SCHEMA,
  loadVerifiedBackupAttempt,
  runBackupAttempt
} from "../backup-runtime.mjs";
import {
  CURRENT_BACKUP_RESTORE_HOLDS,
  CurrentBackupRestoreFailure,
  createCurrentBackupRestoreIntegration,
  createCurrentCleanupReceipt,
  createCurrentRollbackBinding,
  createRatifiedCurrentRtoDecision,
  currentBackupCiphertextManifestSha256,
  currentBackupRestoreReceiptDigest,
  currentCleanupReceiptDigest,
  currentRestoreTargetFreshnessSha256,
  currentRollbackBindingDigest,
  validateHeldCurrentBackupRestoreReceipt,
  verifyHeldCurrentBackupRestore
} from "../backup-restore-current.mjs";
import {
  FINAL_RELEASE_EPOCH_V2_SCHEMA,
  finalReleaseEpochV2Digest,
  validateFinalReleaseEpochV2
} from "../final-release-epoch-v2.mjs";
import {
  canonicalJson,
  sha256Bytes
} from "../immutable-evidence.mjs";
import {
  DEFAULT_HELD_OPERATIONS_STATE,
  HELD_PROVIDER_EGRESS_STATE
} from "../operations-state.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_LOOPBACK_EXPECTATIONS,
  ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
  compareOriginInstalledReadback,
  createOriginInstalledReadback,
  createOriginReleaseInput,
  createOriginSeal,
  expectedOriginInstalledIdentity,
  expectedOriginInstalledWorker
} from "../origin-seal-runtime.mjs";
import {
  collectOriginRepositorySnapshot
} from "../origin-seal-repository.mjs";
import {
  verifyCleanRoomRestore
} from "../restore-runtime.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const layout = Object.freeze({
  artifactRoot:
    "ops/releases/joint-legal-v4-2026-08-09T214211Z/hosted",
  migrationRoot: "server/data-plane/supabase/migrations",
  legalConstantsPath:
    "ops/releases/joint-legal-v4-2026-08-09T214211Z/joint-legal-v4-release-constants.json"
});
const SOURCE_COMMIT = "a".repeat(40);
const SOURCE_TREE = "b".repeat(40);
const PREDECESSOR_COMMIT = "c".repeat(40);
const PREDECESSOR_TREE = "d".repeat(40);
const PREDECESSOR_ARTIFACT = "e".repeat(64);
const BACKUP_AT = "2026-08-11T20:00:00.000Z";
const RESTORE_STARTED_AT = "2026-08-11T20:10:00.000Z";
const RESTORE_COMPLETED_AT = "2026-08-11T20:10:02.500Z";
const CLEANUP_AT = "2026-08-11T20:11:00.000Z";
const DATABASE_NAME = "ss_restore_current_20260811";
const DESTINATION_MARKER = Object.freeze({
  schema: OFF_MACHINE_DESTINATION_SCHEMA,
  storageClass: "off_machine",
  immutableAttempts: true,
  failureDomainId: "offhost-vault-fixture"
});
const DATABASE_MANIFEST = Object.freeze({
  schema: "sitesourcery.postgresql-invariants/v1",
  runtimeContractV13: true,
  runtimeContractV14: true,
  runtimeContractV15: true,
  shadowSchemaAbsent: true,
  domainHeld: true,
  serviceRoleBypassRls: true,
  authenticatedRoleNoBypassRls: true,
  serviceRoleSchemaUsage: true,
  tableCount: "71",
  rowCounts: {
    organizations: "2",
    projects: "3",
    auditEvents: "11",
    exportRequests: "1",
    outbox: "4"
  }
});
const APP_MANIFEST = Object.freeze({
  schema: "sitesourcery.app-state-inventory/v1",
  treeSha256: "6".repeat(64),
  entries: [
    {
      root: "tenant_runtime",
      path: ".",
      type: "directory",
      mode: "0700"
    },
    {
      root: "tenant_runtime",
      path: "control/current.json",
      type: "file",
      mode: "0600",
      bytes: 18,
      sha256: "7".repeat(64)
    }
  ]
});
const snapshot = await collectOriginRepositorySnapshot({
  projectRoot,
  layout
});

let fixture;

function clone(value) {
  return structuredClone(value);
}

function digest(character) {
  return character.repeat(64);
}

function epochFromSnapshot() {
  return {
    schema: ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
    epochId: "backup-restore-current-fixture",
    supersedes: {
      epochId: "shape-epoch-20260810",
      bindingSha256:
        "50e1bb83a8e2258d35c27e8d33d69757efd2eb9331c312283ae08d99c56c1bc6"
    },
    basis: {
      unionBaseCommitSha:
        "5458d9641fd42c9a1b436c6af6bb6600b60bce74"
    },
    layout: clone(layout),
    source: {
      commitSha: SOURCE_COMMIT,
      treeSha: SOURCE_TREE
    },
    artifact: { manifestSha256: snapshot.artifact.sha256 },
    units: { manifestSha256: snapshot.units.sha256 },
    environmentSchema: {
      manifestSha256: snapshot.environmentSchema.sha256,
      classificationSha256:
        snapshot.environmentSchema.classificationSha256
    },
    worker: {
      manifestSha256: snapshot.worker.sha256,
      contractSha256: snapshot.worker.contractSha256
    },
    migration: {
      count: snapshot.migration.count,
      latest: snapshot.migration.latest,
      manifestSha256: snapshot.migration.sha256
    },
    legal: {
      authorityDigest: snapshot.legal.authorityDigest,
      privacyVersion: snapshot.legal.privacyVersion,
      privacySha256: snapshot.legal.privacySha256,
      privacyByteCount: snapshot.legal.privacyByteCount,
      websiteTermsVersion: snapshot.legal.websiteTermsVersion,
      websiteTermsSha256: snapshot.legal.websiteTermsSha256,
      websiteTermsByteCount: snapshot.legal.websiteTermsByteCount,
      manifestSha256: snapshot.legal.sha256
    },
    ingress: { manifestSha256: snapshot.ingress.sha256 },
    rollback: {
      predecessorCommitSha: PREDECESSOR_COMMIT,
      predecessorTreeSha: PREDECESSOR_TREE,
      predecessorArtifactManifestSha256: PREDECESSOR_ARTIFACT
    },
    authority: clone(ORIGIN_HELD_AUTHORITY)
  };
}

function releaseChain() {
  const input = createOriginReleaseInput({
    releaseId: "backup-restore-current-fixture",
    epoch: epochFromSnapshot()
  });
  const seal = createOriginSeal({
    releaseInput: input,
    observed: {
      source: clone(input.epoch.source),
      ...clone(snapshot)
    }
  });
  const readback = createOriginInstalledReadback({
    seal,
    observedAt: BACKUP_AT,
    identity: expectedOriginInstalledIdentity(seal),
    worker: expectedOriginInstalledWorker(seal),
    listeners: clone(ORIGIN_LOOPBACK_EXPECTATIONS),
    authority: clone(ORIGIN_HELD_AUTHORITY)
  });
  const readbackReceipt = compareOriginInstalledReadback({
    seal,
    readback
  });
  const value = {
    schema: FINAL_RELEASE_EPOCH_V2_SCHEMA,
    epochId: input.epoch.epochId,
    state: "verified_held",
    bindingSha256: digest("8"),
    evidence: {
      originReleaseInputDigest: input.digest,
      originSuccessorBindingSha256: input.epoch.bindingSha256,
      ciFinalReceiptDigest: digest("9"),
      originSealSha256: seal.sealSha256,
      originInstalledReadbackDigest: readback.digest,
      originInstalledReadbackReceiptSha256:
        readbackReceipt.receiptSha256
    },
    identity: expectedOriginInstalledIdentity(seal),
    legalV4Pages: {
      fileCount: 7,
      manifestSha256: digest("f")
    },
    privacyArtifact: {
      version: seal.legal.privacyVersion,
      sha256: seal.legal.privacySha256,
      byteCount: seal.legal.privacyByteCount
    },
    rollback: clone(seal.rollback),
    authority: clone(ORIGIN_HELD_AUTHORITY)
  };
  const finalReleaseEpoch = validateFinalReleaseEpochV2({
    ...value,
    digest: finalReleaseEpochV2Digest(value)
  });
  return { finalReleaseEpoch, seal, readback };
}

function quiesce() {
  return {
    schema: QUIESCE_SCHEMA,
    runtimeUnit: "sitesourcery-hosted.service",
    runtimeState: "inactive",
    writerFence: "engaged",
    databaseWriterCount: 0,
    filesystemSnapshotStable: true,
    sourceFailureDomainId: "current-origin-fixture",
    snapshotId: "current-release-snapshot",
    fenceDigest: digest("a"),
    observedAt: BACKUP_AT,
    expiresAt: "2026-08-11T20:30:00.000Z"
  };
}

async function createFixture() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "sitesourcery-current-backup-")
  );
  const destinationRoot = path.join(root, "off-machine");
  const stagingRoot = path.join(root, "staging");
  const evidenceRoot = path.join(root, "restore-evidence");
  await Promise.all([
    mkdir(destinationRoot),
    mkdir(stagingRoot),
    mkdir(evidenceRoot)
  ]);
  const backupResult = await runBackupAttempt({
    destinationRoot,
    destinationMarker: DESTINATION_MARKER,
    sourceFailureDomainId: "current-origin-fixture",
    stagingRoot,
    ageRecipient:
      "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    sourceOperationsState: DEFAULT_HELD_OPERATIONS_STATE,
    providerEgress: "held",
    ports: {
      async assertQuiesced() {
        return quiesce();
      },
      async inspectAppState() {
        return APP_MANIFEST;
      },
      async createDatabaseDump({ outputPath }) {
        await writeFile(outputPath, "POSTGRESQL-CURRENT-FIXTURE");
        return {
          kind: "postgresql",
          path: outputPath,
          manifest: DATABASE_MANIFEST
        };
      },
      async createAppArchive({ outputPath }) {
        await writeFile(outputPath, "APP-STATE-CURRENT-FIXTURE");
        return {
          kind: "app_state",
          path: outputPath,
          manifest: APP_MANIFEST
        };
      },
      async encrypt({ inputPath, outputPath }) {
        const plaintext = await readFile(inputPath);
        await writeFile(
          outputPath,
          Buffer.concat([
            Buffer.from("age-encrypted:"),
            plaintext
          ])
        );
      }
    },
    now: () => new Date(BACKUP_AT),
    attemptIdFactory: () => "current-attempt-001"
  });
  const backup = await loadVerifiedBackupAttempt(
    backupResult.attemptRoot
  );
  const restoreClock = [
    RESTORE_STARTED_AT,
    RESTORE_COMPLETED_AT
  ];
  let restoreClockIndex = 0;
  const restored = await verifyCleanRoomRestore({
    attemptRoot: backupResult.attemptRoot,
    stagingRoot,
    evidenceRoot,
    providerEgressState: HELD_PROVIDER_EGRESS_STATE,
    restoreTarget: {
      databaseName: DATABASE_NAME,
      networkExposure: "none"
    },
    ports: {
      async decrypt({ inputPath, outputPath }) {
        const encrypted = await readFile(inputPath);
        await writeFile(
          outputPath,
          encrypted.subarray(Buffer.byteLength("age-encrypted:"))
        );
      },
      async restoreFreshDatabase({ expected }) {
        return {
          freshDatabase: true,
          databaseName: DATABASE_NAME,
          ...expected
        };
      },
      async restoreFreshAppState({ expected }) {
        return {
          freshRoot: true,
          treeSha256: expected.treeSha256
        };
      }
    },
    now: () =>
      new Date(
        restoreClock[
          Math.min(restoreClockIndex++, restoreClock.length - 1)
        ]
      ),
    restoreIdFactory: () => "current-restore-001"
  });
  const chain = releaseChain();
  const migrationFiles = chain.seal.migration.files.map(
    (entry) => path.posix.basename(entry.path)
  );
  const integration = createCurrentBackupRestoreIntegration({
    finalReleaseEpoch: chain.finalReleaseEpoch,
    originSeal: chain.seal,
    installedReadback: chain.readback,
    migrationFiles
  });
  const cleanupReceipt = createCurrentCleanupReceipt({
    restoreReceiptSha256: restored.evidenceSha256,
    databaseNameSha256: sha256Bytes(
      Buffer.from(DATABASE_NAME, "utf8")
    ),
    databaseAbsent: true,
    plaintextAbsent: true,
    appStateAbsent: true,
    observedAt: CLEANUP_AT
  });
  const rollbackBinding = createCurrentRollbackBinding({
    finalReleaseEpochDigest: chain.finalReleaseEpoch.digest,
    restoreReceiptSha256: restored.evidenceSha256,
    predecessor: clone(chain.finalReleaseEpoch.rollback)
  });
  const readinessProofSha256 = digest("1");
  const journeyProofSha256 = digest("2");
  const contract = createHeldBackupRestoreContract({
    integration,
    rpoDecision: {
      maximumAgeMs: 60 * 60 * 1000,
      evidenceSha256: digest("3")
    },
    retentionDecision: {
      maximumAgeMs: 30 * 24 * 60 * 60 * 1000,
      minimumSuccessfulAttempts: 7,
      evidenceSha256: digest("4")
    },
    keyCustodyDecision: {
      recipientFingerprintSha256:
        backup.manifest.ageRecipientFingerprint,
      custodyEvidenceSha256: digest("5"),
      recoveryAccessEvidenceSha256: digest("6")
    },
    backupEvidence: {
      receiptSha256: backup.manifestSha256,
      quiescenceEvidenceSha256:
        backup.manifest.consistency.fenceDigest,
      destinationMarkerSha256:
        backup.manifest.destinationMarkerSha256,
      ciphertextManifestSha256:
        currentBackupCiphertextManifestSha256(backup.manifest),
      recipientFingerprintSha256:
        backup.manifest.ageRecipientFingerprint,
      keyCustodyEvidenceSha256: digest("5"),
      recoveryAccessEvidenceSha256: digest("6"),
      completedAt: backup.manifest.completedAt
    },
    restoreEvidence: {
      receiptSha256: restored.evidenceSha256,
      backupReceiptSha256: backup.manifestSha256,
      backupCompletedAt: backup.manifest.completedAt,
      startedAt: restored.report.startedAt,
      targetFreshnessEvidenceSha256:
        currentRestoreTargetFreshnessSha256(restored.report),
      readinessProofSha256,
      journeyProofSha256,
      cleanupProofSha256: cleanupReceipt.digest,
      rollbackProofSha256: rollbackBinding.digest,
      completedAt: restored.report.completedAt
    }
  });
  const rtoDecision = createRatifiedCurrentRtoDecision({
    maximumDurationMs: 60_000,
    evidenceSha256: digest("7")
  });
  const args = {
    finalReleaseEpoch: chain.finalReleaseEpoch,
    originSeal: chain.seal,
    installedReadback: chain.readback,
    contract,
    integration,
    migrationFiles,
    backupAttemptRoot: backupResult.attemptRoot,
    destinationMarker: DESTINATION_MARKER,
    restoreReceipt: restored.report,
    restoreReceiptSha256: restored.evidenceSha256,
    readinessProofSha256,
    journeyProofSha256,
    cleanupReceipt,
    rollbackBinding,
    rtoDecision
  };
  return {
    root,
    args,
    receipt: await verifyHeldCurrentBackupRestore(args)
  };
}

before(async () => {
  fixture = await createFixture();
});

after(async () => {
  if (fixture?.root) {
    await chmod(fixture.root, 0o700).catch(() => {});
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function rejects(args, code) {
  await assert.rejects(
    () => verifyHeldCurrentBackupRestore(args),
    (error) =>
      error instanceof CurrentBackupRestoreFailure &&
      error.code === code
  );
}

test("projects the exact installed V2 epoch into the sealed backup contract", () => {
  const { args } = fixture;
  assert.equal(
    args.integration.releaseEpoch.receiptSha256,
    args.finalReleaseEpoch.digest
  );
  assert.equal(
    args.integration.installedIdentity.receiptSha256,
    args.finalReleaseEpoch.evidence
      .originInstalledReadbackReceiptSha256
  );
  assert.equal(
    args.integration.database.migrationCount,
    args.finalReleaseEpoch.identity.migrationCount
  );
  assert.equal(
    args.finalReleaseEpoch.identity.migrationManifestSha256,
    args.originSeal.migration.sha256
  );
  assert.throws(
    () => createCurrentBackupRestoreIntegration({
      finalReleaseEpoch: args.finalReleaseEpoch,
      originSeal: args.originSeal,
      installedReadback: args.installedReadback,
      migrationFiles: args.migrationFiles.slice(0, -1)
    }),
    (error) =>
      error instanceof CurrentBackupRestoreFailure &&
      error.code === "CURRENT_BACKUP_RESTORE_MIGRATION_MISMATCH"
  );
});

test("binds one non-empty off-host backup and clean-room restore into a held receipt", async () => {
  const receipt = await verifyHeldCurrentBackupRestore(fixture.args);
  assert.deepEqual(receipt, fixture.receipt);
  assert.equal(receipt.backup.encryptedBytes > 0, true);
  assert.notEqual(
    receipt.backup.sourceFailureDomainId,
    receipt.backup.destinationFailureDomainId
  );
  assert.equal(receipt.cleanup.databaseAbsent, true);
  assert.equal(receipt.cleanup.plaintextAbsent, true);
  assert.equal(receipt.cleanup.appStateAbsent, true);
  assert.deepEqual(receipt.holds, CURRENT_BACKUP_RESTORE_HOLDS);
  assert.equal(
    Object.entries(receipt.holds)
      .filter(([field]) => field.startsWith("allows"))
      .every(([, selected]) => selected === false),
    true
  );
  assert.equal(Object.isFrozen(receipt), true);
  assert.doesNotMatch(JSON.stringify(receipt), new RegExp(DATABASE_NAME, "u"));
});

test("fails closed on empty ciphertext or same-failure-domain destination", async () => {
  const empty = clone(fixture.receipt);
  empty.backup.encryptedBytes = 0;
  empty.digest = currentBackupRestoreReceiptDigest(empty);
  assert.throws(
    () => validateHeldCurrentBackupRestoreReceipt(empty),
    (error) =>
      error instanceof CurrentBackupRestoreFailure &&
      error.code === "CURRENT_BACKUP_RESTORE_INVALID"
  );
  const local = clone(fixture.receipt);
  local.backup.destinationFailureDomainId =
    local.backup.sourceFailureDomainId;
  local.digest = currentBackupRestoreReceiptDigest(local);
  assert.throws(
    () => validateHeldCurrentBackupRestoreReceipt(local),
    (error) =>
      error instanceof CurrentBackupRestoreFailure &&
      error.code === "CURRENT_BACKUP_RESTORE_DESTINATION_INVALID"
  );
  await rejects(
    {
      ...fixture.args,
      destinationMarker: {
        ...DESTINATION_MARKER,
        failureDomainId: "another-vault-fixture"
      }
    },
    "CURRENT_BACKUP_RESTORE_DESTINATION_INVALID"
  );
});

test("rejects stale release and migration-union authority", async () => {
  const staleIntegration = clone(fixture.args.integration);
  staleIntegration.releaseEpoch.receiptSha256 = digest("0");
  await rejects(
    { ...fixture.args, integration: staleIntegration },
    "CURRENT_BACKUP_RESTORE_RELEASE_MISMATCH"
  );
  await rejects(
    {
      ...fixture.args,
      migrationFiles: fixture.args.migrationFiles.slice(0, -1)
    },
    "CURRENT_BACKUP_RESTORE_MIGRATION_MISMATCH"
  );
});

test("rejects restore receipt drift and an exceeded ratified RTO", async () => {
  const driftedRestore = clone(fixture.args.restoreReceipt);
  driftedRestore.backupManifestSha256 = digest("0");
  await rejects(
    { ...fixture.args, restoreReceipt: driftedRestore },
    "CURRENT_BACKUP_RESTORE_RESTORE_MISMATCH"
  );
  await rejects(
    {
      ...fixture.args,
      rtoDecision: createRatifiedCurrentRtoDecision({
        maximumDurationMs: 1,
        evidenceSha256: digest("7")
      })
    },
    "CURRENT_BACKUP_RESTORE_RTO_EXCEEDED"
  );
});

test("rejects residual database plaintext or restored app state", async () => {
  for (const field of [
    "databaseAbsent",
    "plaintextAbsent",
    "appStateAbsent"
  ]) {
    const cleanupReceipt = clone(fixture.args.cleanupReceipt);
    cleanupReceipt[field] = false;
    cleanupReceipt.digest = currentCleanupReceiptDigest(cleanupReceipt);
    await rejects(
      { ...fixture.args, cleanupReceipt },
      "CURRENT_BACKUP_RESTORE_CLEANUP_INCOMPLETE"
    );
  }
});

test("rejects unratified policy and a different rollback predecessor", async () => {
  const rtoDecision = clone(fixture.args.rtoDecision);
  rtoDecision.state = "required";
  await rejects(
    { ...fixture.args, rtoDecision },
    "CURRENT_BACKUP_RESTORE_POLICY_UNRATIFIED"
  );

  const unratifiedContract = clone(fixture.args.contract);
  unratifiedContract.decisions.retention = {
    state: "required",
    maximumAgeMs: null,
    minimumSuccessfulAttempts: null,
    evidenceSha256: null
  };
  unratifiedContract.holds.blockers = [
    "owner_retention_decision",
    "execution_not_authorized"
  ];
  await rejects(
    { ...fixture.args, contract: unratifiedContract },
    "CURRENT_BACKUP_RESTORE_POLICY_UNRATIFIED"
  );

  const rollbackBinding = clone(fixture.args.rollbackBinding);
  rollbackBinding.predecessor.predecessorCommitSha = "f".repeat(40);
  rollbackBinding.digest = currentRollbackBindingDigest(rollbackBinding);
  await rejects(
    { ...fixture.args, rollbackBinding },
    "CURRENT_BACKUP_RESTORE_EVIDENCE_MISMATCH"
  );
});

test("receipt validation rejects added fields changed holds and digest drift", () => {
  const added = clone(fixture.receipt);
  added.email = "not-allowed@example.test";
  assert.throws(
    () => validateHeldCurrentBackupRestoreReceipt(added),
    (error) =>
      error instanceof CurrentBackupRestoreFailure &&
      error.code === "CURRENT_BACKUP_RESTORE_INVALID"
  );
  const enabled = clone(fixture.receipt);
  enabled.holds.allowsProviderEffects = true;
  assert.throws(
    () => validateHeldCurrentBackupRestoreReceipt(enabled),
    (error) =>
      error instanceof CurrentBackupRestoreFailure &&
      error.code === "CURRENT_BACKUP_RESTORE_EFFECTS_NOT_HELD"
  );
  const drifted = clone(fixture.receipt);
  drifted.backup.encryptedBytes += 1;
  assert.throws(
    () => validateHeldCurrentBackupRestoreReceipt(drifted),
    (error) =>
      error instanceof CurrentBackupRestoreFailure &&
      error.code === "CURRENT_BACKUP_RESTORE_DIGEST_MISMATCH"
  );
  assert.equal(
    canonicalJson(Object.keys(fixture.receipt).sort()),
    canonicalJson([
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
    ].sort())
  );
});
