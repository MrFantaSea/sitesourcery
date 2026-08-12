import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CURRENT_BACKUP_RESTORE_HOLDS,
  CURRENT_BACKUP_RESTORE_SCHEMA,
  currentBackupRestoreReceiptDigest,
  validateHeldCurrentBackupRestoreReceipt
} from "../backup-restore-current.mjs";
import {
  FINAL_RELEASE_EPOCH_V2_SCHEMA,
  finalReleaseEpochV2Digest,
  validateFinalReleaseEpochV2
} from "../final-release-epoch-v2.mjs";
import {
  sha256Bytes
} from "../immutable-evidence.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_LOOPBACK_EXPECTATIONS,
  ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
  compareOriginInstalledReadback,
  createOriginInstalledReadback,
  createOriginReleaseInput,
  createOriginSeal,
  expectedOriginInstalledIdentity,
  expectedOriginInstalledWorker,
  originWorkerContractSha256
} from "../origin-seal-runtime.mjs";
import {
  ROLLBACK_REHEARSAL_HOLDS,
  ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS,
  RollbackRehearsalFailure,
  createRollbackDatabaseCompatibility,
  createRollbackPagesFallback,
  createRollbackProbeReceipt,
  createRollbackProcessState,
  createRollbackRuntimeTopology,
  rollbackDatabaseCompatibilityDigest,
  rollbackPagesFallbackDigest,
  rollbackRehearsalReceiptDigest,
  runHeldRollbackRehearsal,
  validateRollbackRehearsalReceipt,
  validateRollbackRuntimeTopology
} from "../rollback-rehearsal.mjs";
import {
  collectOriginRepositorySnapshot
} from "../origin-seal-repository.mjs";

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
const SUCCESSOR_COMMIT = "a".repeat(40);
const SUCCESSOR_TREE = "b".repeat(40);
const PREDECESSOR_COMMIT = "c".repeat(40);
const PREDECESSOR_TREE = "d".repeat(40);
const PREDECESSOR_ARTIFACT = "e".repeat(64);
const STARTED_AT = "2026-08-11T22:00:00.000Z";
const COMPLETED_AT = "2026-08-11T22:00:01.000Z";
const snapshot = await collectOriginRepositorySnapshot({
  projectRoot,
  layout
});

function clone(value) {
  return structuredClone(value);
}

function digest(character) {
  return character.repeat(64);
}

function successorEpochInput() {
  return {
    schema: ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
    epochId: "rollback-successor-fixture",
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
      commitSha: SUCCESSOR_COMMIT,
      treeSha: SUCCESSOR_TREE
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

function createInstalledSuccessor() {
  const releaseInput = createOriginReleaseInput({
    releaseId: "rollback-successor-fixture",
    epoch: successorEpochInput()
  });
  const seal = createOriginSeal({
    releaseInput,
    observed: {
      source: clone(releaseInput.epoch.source),
      ...clone(snapshot)
    }
  });
  const readback = createOriginInstalledReadback({
    seal,
    observedAt: STARTED_AT,
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
    epochId: releaseInput.epoch.epochId,
    state: "verified_held",
    bindingSha256: digest("2"),
    evidence: {
      originReleaseInputDigest: releaseInput.digest,
      originSuccessorBindingSha256:
        releaseInput.epoch.bindingSha256,
      ciFinalReceiptDigest: digest("3"),
      originSealSha256: seal.sealSha256,
      originInstalledReadbackDigest: readback.digest,
      originInstalledReadbackReceiptSha256:
        readbackReceipt.receiptSha256
    },
    identity: expectedOriginInstalledIdentity(seal),
    legalV4Pages: {
      fileCount: 7,
      manifestSha256: digest("4")
    },
    privacyArtifact: {
      version: seal.legal.privacyVersion,
      sha256: seal.legal.privacySha256,
      byteCount: seal.legal.privacyByteCount
    },
    rollback: clone(seal.rollback),
    authority: clone(ORIGIN_HELD_AUTHORITY)
  };
  return {
    epoch: validateFinalReleaseEpochV2({
      ...value,
      digest: finalReleaseEpochV2Digest(value)
    }),
    seal,
    readback
  };
}

function createPredecessor(successor) {
  const value = {
    ...clone(successor),
    epochId: "rollback-predecessor-fixture",
    bindingSha256: digest("5"),
    evidence: {
      originReleaseInputDigest: digest("6"),
      originSuccessorBindingSha256: digest("7"),
      ciFinalReceiptDigest: digest("8"),
      originSealSha256: digest("9"),
      originInstalledReadbackDigest: digest("0"),
      originInstalledReadbackReceiptSha256: digest("1")
    },
    identity: {
      ...clone(successor.identity),
      sourceCommitSha: successor.rollback.predecessorCommitSha,
      sourceTreeSha: successor.rollback.predecessorTreeSha,
      artifactManifestSha256:
        successor.rollback.predecessorArtifactManifestSha256
    },
    rollback: {
      predecessorCommitSha: "f".repeat(40),
      predecessorTreeSha: "9".repeat(40),
      predecessorArtifactManifestSha256: digest("8")
    }
  };
  delete value.digest;
  return validateFinalReleaseEpochV2({
    ...value,
    digest: finalReleaseEpochV2Digest(value)
  });
}

function createBackupReceipt(successor) {
  const value = {
    schema: CURRENT_BACKUP_RESTORE_SCHEMA,
    state: "verified_held",
    release: {
      epochId: successor.epoch.epochId,
      bindingSha256: successor.epoch.bindingSha256,
      epochDigest: successor.epoch.digest,
      sourceCommitSha: successor.epoch.identity.sourceCommitSha,
      sourceTreeSha: successor.epoch.identity.sourceTreeSha,
      artifactManifestSha256:
        successor.epoch.identity.artifactManifestSha256,
      migrationCount: successor.epoch.identity.migrationCount,
      latestMigration: successor.epoch.identity.latestMigration,
      migrationManifestSha256:
        successor.epoch.identity.migrationManifestSha256,
      installedReadbackDigest: successor.readback.digest,
      installedReadbackReceiptSha256:
        successor.epoch.evidence
          .originInstalledReadbackReceiptSha256
    },
    backup: {
      attemptId: "rollback-backup-fixture",
      receiptSha256: digest("2"),
      sourceFailureDomainId: "dell-origin-fixture",
      destinationFailureDomainId: "off-host-vault-fixture",
      destinationMarkerSha256: digest("3"),
      ciphertextManifestSha256: digest("4"),
      encryptedBytes: 4096,
      completedAt: "2026-08-11T21:00:00.000Z"
    },
    restore: {
      restoreId: "rollback-restore-fixture",
      receiptSha256: digest("5"),
      backupReceiptSha256: digest("2"),
      startedAt: "2026-08-11T21:10:00.000Z",
      completedAt: "2026-08-11T21:10:01.000Z",
      durationMs: 1000,
      targetFreshnessEvidenceSha256: digest("6"),
      readinessProofSha256: digest("7"),
      journeyProofSha256: digest("8")
    },
    policy: {
      rpoDecisionSha256: digest("9"),
      rtoDecisionSha256: digest("0"),
      rtoMaximumDurationMs: 60_000,
      retentionDecisionSha256: digest("1"),
      recipientFingerprintSha256: digest("2"),
      keyCustodyDecisionSha256: digest("3"),
      recoveryAccessDecisionSha256: digest("4")
    },
    cleanup: {
      receiptSha256: digest("5"),
      restoreReceiptSha256: digest("5"),
      databaseNameSha256: digest("6"),
      databaseAbsent: true,
      plaintextAbsent: true,
      appStateAbsent: true,
      observedAt: "2026-08-11T21:11:00.000Z"
    },
    rollback: {
      proofSha256: digest("7"),
      ...clone(successor.epoch.rollback),
      productionPromoted: false
    },
    holds: clone(CURRENT_BACKUP_RESTORE_HOLDS)
  };
  return validateHeldCurrentBackupRestoreReceipt({
    ...value,
    digest: currentBackupRestoreReceiptDigest(value)
  });
}

function createFixture() {
  const successor = createInstalledSuccessor();
  const predecessor = createPredecessor(successor.epoch);
  const predecessorTopology = createRollbackRuntimeTopology({
    epoch: predecessor,
    listeners: clone(ORIGIN_LOOPBACK_EXPECTATIONS),
    workerContract: expectedOriginInstalledWorker(successor.seal)
  });
  const successorTopology = createRollbackRuntimeTopology({
    epoch: successor.epoch,
    listeners: clone(ORIGIN_LOOPBACK_EXPECTATIONS),
    workerContract: expectedOriginInstalledWorker(successor.seal)
  });
  const backup = createBackupReceipt(successor);
  const database = createRollbackDatabaseCompatibility({
    predecessorEpoch: predecessor,
    successorEpoch: successor.epoch,
    backupRestoreReceipt: backup,
    predecessorCanReadSuccessorState: true,
    predecessorCanOperateHeld: true,
    destructiveDowngradeRequired: false,
    databaseMutationPerformed: false,
    proofSha256: digest("8")
  });
  const pages = createRollbackPagesFallback({
    deploymentId: "31492242069",
    commitSha: predecessor.identity.sourceCommitSha,
    artifactManifestSha256: digest("9"),
    routeManifestSha256: digest("0"),
    evidenceSha256: digest("1")
  });
  return {
    predecessor,
    successor,
    predecessorTopology,
    successorTopology,
    backup,
    database,
    pages
  };
}

function makeNow() {
  const values = [STARTED_AT, COMPLETED_AT];
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

function makeFakePorts(
  fixture,
  { failProcess = null, pagesObservation = fixture.pages } = {}
) {
  const state = {
    selectedEpochDigest: fixture.successor.epoch.digest,
    apiState: "running",
    workerState: "running"
  };
  let processActionCount = 0;
  const maybeFail = (action, component = null) => {
    processActionCount += 1;
    if (
      failProcess?.({
        action,
        component,
        selectedEpochDigest: state.selectedEpochDigest,
        processActionCount
      })
    ) {
      throw new Error("fixture process failure");
    }
  };
  const processPort = {
    kind: "local_fake_process",
    externalEffects: false,
    async observe() {
      return createRollbackProcessState(state);
    },
    async stop({ component }) {
      maybeFail("stop", component);
      state[`${component}State`] = "stopped";
    },
    async select({ epochDigest }) {
      maybeFail("select");
      if (state.apiState !== "stopped" || state.workerState !== "stopped") {
        throw new Error("cannot select while a fixture process is running");
      }
      state.selectedEpochDigest = epochDigest;
    },
    async start({ component }) {
      maybeFail("start", component);
      state[`${component}State`] = "running";
    }
  };
  const topologyByEpoch = new Map([
    [fixture.predecessor.digest, fixture.predecessorTopology],
    [fixture.successor.epoch.digest, fixture.successorTopology]
  ]);
  const networkPort = {
    kind: "local_fake_network",
    externalEffects: false,
    async probe({ epochDigest, path: probePath, listener }) {
      if (
        state.selectedEpochDigest !== epochDigest ||
        state.apiState !== "running"
      ) {
        throw new Error("fixture listener is unavailable");
      }
      return createRollbackProbeReceipt({
        epochDigest,
        path: probePath,
        listener,
        statusCode: 200,
        held: true,
        bodySha256: sha256Bytes(
          Buffer.from(`${epochDigest}:${probePath}:held`, "utf8")
        )
      });
    },
    async observeTopology({ epochDigest }) {
      if (
        state.selectedEpochDigest !== epochDigest ||
        state.apiState !== "running" ||
        state.workerState !== "running"
      ) {
        throw new Error("fixture topology is unavailable");
      }
      return topologyByEpoch.get(epochDigest);
    }
  };
  const pagesPort = {
    kind: "local_fake_pages",
    externalEffects: false,
    async observeFallback() {
      return pagesObservation;
    }
  };
  return { processPort, networkPort, pagesPort };
}

function runArgs(fixture, ports = makeFakePorts(fixture)) {
  return {
    predecessorEpoch: fixture.predecessor,
    successorEpoch: fixture.successor.epoch,
    originSeal: fixture.successor.seal,
    installedReadback: fixture.successor.readback,
    predecessorTopology: fixture.predecessorTopology,
    successorTopology: fixture.successorTopology,
    databaseCompatibility: fixture.database,
    backupRestoreReceipt: fixture.backup,
    pagesFallback: fixture.pages,
    ...ports,
    now: makeNow()
  };
}

test("binds exact epochs, installed topology, database proof, backup, and Pages fallback", () => {
  const fixture = createFixture();
  assert.equal(
    fixture.predecessor.identity.sourceCommitSha,
    fixture.successor.epoch.rollback.predecessorCommitSha
  );
  assert.equal(
    originWorkerContractSha256(
      fixture.successorTopology.worker.contract
    ),
    fixture.successor.epoch.identity.workerContractSha256
  );
  assert.equal(
    fixture.database.backupRestoreReceiptDigest,
    fixture.backup.digest
  );
  assert.deepEqual(
    validateRollbackRuntimeTopology(
      fixture.successorTopology,
      fixture.successor.epoch
    ),
    fixture.successorTopology
  );
});

test("runs the exact held rollback and successor restoration order", async () => {
  const fixture = createFixture();
  const receipt = await runHeldRollbackRehearsal(runArgs(fixture));
  assert.equal(receipt.state, "verified_held");
  assert.equal(receipt.outcome, "success");
  assert.deepEqual(
    receipt.operations.map(({ id }) => id),
    ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS
  );
  assert.deepEqual(receipt.holds, ROLLBACK_REHEARSAL_HOLDS);
  assert.equal(
    Object.entries(receipt.holds)
      .filter(([field]) => field.startsWith("allows"))
      .every(([, allowed]) => allowed === false),
    true
  );
  assert.equal(receipt.finalState.state, "successor_active");
  assert.equal(Object.isFrozen(receipt), true);
});

test("rejects stale predecessor and backup authority before port use", async () => {
  const fixture = createFixture();
  const stalePredecessor = clone(fixture.predecessor);
  stalePredecessor.identity.sourceCommitSha = "8".repeat(40);
  stalePredecessor.digest = finalReleaseEpochV2Digest(stalePredecessor);
  await assert.rejects(
    () => runHeldRollbackRehearsal({
      ...runArgs(fixture),
      predecessorEpoch: stalePredecessor
    }),
    (error) =>
      error instanceof RollbackRehearsalFailure &&
      error.code === "ROLLBACK_REHEARSAL_EPOCH_MISMATCH"
  );
  const staleBackup = clone(fixture.backup);
  staleBackup.release.epochDigest = digest("f");
  staleBackup.digest = currentBackupRestoreReceiptDigest(staleBackup);
  await assert.rejects(
    () => runHeldRollbackRehearsal({
      ...runArgs(fixture),
      backupRestoreReceipt: staleBackup
    }),
    (error) =>
      error instanceof RollbackRehearsalFailure &&
      error.code === "ROLLBACK_REHEARSAL_BACKUP_MISMATCH"
  );
});

test("rejects destructive or mutating database compatibility evidence", async () => {
  const fixture = createFixture();
  const incompatible = clone(fixture.database);
  incompatible.destructiveDowngradeRequired = true;
  incompatible.digest = rollbackDatabaseCompatibilityDigest(incompatible);
  await assert.rejects(
    () => runHeldRollbackRehearsal({
      ...runArgs(fixture),
      databaseCompatibility: incompatible
    }),
    (error) =>
      error instanceof RollbackRehearsalFailure &&
      error.code === "ROLLBACK_REHEARSAL_DATABASE_INCOMPATIBLE"
  );
});

test("fails closed and restores the successor after a partial rollback", async () => {
  const fixture = createFixture();
  let failed = false;
  const ports = makeFakePorts(fixture, {
    failProcess({ action, component, selectedEpochDigest }) {
      if (
        !failed &&
        action === "start" &&
        component === "worker" &&
        selectedEpochDigest === fixture.predecessor.digest
      ) {
        failed = true;
        return true;
      }
      return false;
    }
  });
  await assert.rejects(
    () => runHeldRollbackRehearsal(runArgs(fixture, ports)),
    (error) => {
      assert.equal(
        error instanceof RollbackRehearsalFailure,
        true
      );
      assert.equal(error.code, "ROLLBACK_REHEARSAL_ABORTED_RECOVERED");
      assert.equal(error.receipt.outcome, "aborted_recovered");
      assert.equal(
        error.receipt.failure.operationId,
        "start.predecessor.worker"
      );
      assert.equal(error.receipt.failure.recoverySucceeded, true);
      assert.equal(error.receipt.finalState.state, "successor_active");
      assert.equal(
        error.receipt.operations.some(({ id }) =>
          id === "recovery.observe.successor.final"
        ),
        true
      );
      assert.deepEqual(
        error.receipt.operations.slice(0, 7).map(({ id }) => id),
        ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS.slice(0, 7)
      );
      const reordered = clone(error.receipt);
      [reordered.operations[7], reordered.operations[8]] =
        [reordered.operations[8], reordered.operations[7]];
      reordered.operations.forEach((entry, index) => {
        entry.sequence = index + 1;
      });
      reordered.digest = rollbackRehearsalReceiptDigest(reordered);
      assert.throws(
        () => validateRollbackRehearsalReceipt(reordered),
        (receiptError) =>
          receiptError instanceof RollbackRehearsalFailure &&
          receiptError.code ===
            "ROLLBACK_REHEARSAL_RECEIPT_INVALID"
      );
      return true;
    }
  );
});

test("records immutable ambiguity when recovery cannot prove successor state", async () => {
  const fixture = createFixture();
  const driftedPages = clone(fixture.pages);
  driftedPages.routeManifestSha256 = digest("f");
  driftedPages.digest = rollbackPagesFallbackDigest(driftedPages);
  const ports = makeFakePorts(fixture, {
    pagesObservation: driftedPages,
    failProcess({ action, component, selectedEpochDigest }) {
      return (
        action === "start" &&
        component === "api" &&
        selectedEpochDigest === fixture.successor.epoch.digest
      );
    }
  });
  await assert.rejects(
    () => runHeldRollbackRehearsal(runArgs(fixture, ports)),
    (error) => {
      assert.equal(error.code, "ROLLBACK_REHEARSAL_AMBIGUOUS");
      assert.equal(error.receipt.outcome, "ambiguous_held");
      assert.equal(error.receipt.failure.recoverySucceeded, false);
      assert.equal(error.receipt.finalState.state, "ambiguous");
      assert.equal(error.receipt.finalState.processStateSha256, null);
      return true;
    }
  );
});

test("rejects external-effect ports and immutable receipt mutations", async () => {
  const fixture = createFixture();
  const ports = makeFakePorts(fixture);
  await assert.rejects(
    () => runHeldRollbackRehearsal({
      ...runArgs(fixture, ports),
      pagesPort: { ...ports.pagesPort, externalEffects: true }
    }),
    (error) =>
      error instanceof RollbackRehearsalFailure &&
      error.code === "ROLLBACK_REHEARSAL_EXTERNAL_EFFECT_FORBIDDEN"
  );
  const receipt = await runHeldRollbackRehearsal(runArgs(fixture));
  const extra = clone(receipt);
  extra.authority = "invented";
  assert.throws(
    () => validateRollbackRehearsalReceipt(extra),
    (error) =>
      error instanceof RollbackRehearsalFailure &&
      error.code === "ROLLBACK_REHEARSAL_INVALID"
  );
  const wrongPredecessorTree = clone(receipt);
  wrongPredecessorTree.identity.successor
    .rollbackPredecessorTreeSha = "7".repeat(40);
  wrongPredecessorTree.digest = rollbackRehearsalReceiptDigest(
    wrongPredecessorTree
  );
  assert.throws(
    () => validateRollbackRehearsalReceipt(wrongPredecessorTree),
    (error) =>
      error instanceof RollbackRehearsalFailure &&
      error.code === "ROLLBACK_REHEARSAL_RECEIPT_INVALID"
  );
  const reordered = clone(receipt);
  [reordered.operations[0], reordered.operations[1]] =
    [reordered.operations[1], reordered.operations[0]];
  reordered.operations.forEach((entry, index) => {
    entry.sequence = index + 1;
  });
  reordered.digest = rollbackRehearsalReceiptDigest(reordered);
  assert.throws(
    () => validateRollbackRehearsalReceipt(reordered),
    (error) =>
      error instanceof RollbackRehearsalFailure &&
      error.code === "ROLLBACK_REHEARSAL_RECEIPT_INVALID"
  );
});

test("runtime remains an injected local composition with no effect adapter", async () => {
  const source = await readFile(
    path.join(projectRoot, "ops/rollback-rehearsal.mjs"),
    "utf8"
  );
  assert.doesNotMatch(
    source,
    /node:(?:child_process|dns|fs|http|https|net)|\bfetch\s*\(|\bexec(?:File)?\s*\(|\bspawn\s*\(/u
  );
  assert.doesNotMatch(
    source,
    /\b(?:curl|ssh|systemctl|cloudflare|createdb|dropdb|psql)\b/u
  );
});
