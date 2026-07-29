import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  stat
} from "node:fs/promises";
import path from "node:path";

import {
  BackupFailure,
  assertHeldOperationsState,
  loadVerifiedBackupAttempt
} from "./backup-runtime.mjs";
import {
  canonicalJson,
  safeIdentifier,
  sha256File,
  writeImmutableEvidence
} from "./immutable-evidence.mjs";

export const RESTORE_VERIFIED_SCHEMA =
  "sitesourcery.clean-room-restore/v1";
export const RESTORE_FAILED_SCHEMA =
  "sitesourcery.clean-room-restore-failed/v1";

function restoreFailure(code, message) {
  throw new BackupFailure(code, message);
}

function validateDatabaseRestore(
  restored,
  expected
) {
  if (
    restored?.freshDatabase !== true ||
    restored.runtimeContractV13 !== true ||
    restored.runtimeContractV14 !== true ||
    restored.runtimeContractV15 !== true ||
    restored.shadowSchemaAbsent !== true ||
    restored.domainHeld !== true ||
    restored.serviceRoleBypassRls !== true ||
    restored.authenticatedRoleNoBypassRls !==
      true ||
    restored.serviceRoleSchemaUsage !== true ||
    typeof restored.tableCount !== "string" ||
    !restored.rowCounts ||
    restored.tableCount !== expected.tableCount ||
    canonicalJson(restored.rowCounts) !==
      canonicalJson(expected.rowCounts)
  ) {
    restoreFailure(
      "RESTORE_DATABASE_INVARIANT_FAILED",
      "The fresh database did not reproduce migrations, row invariants, and held domain state."
    );
  }
  return restored;
}

function validateAppRestore(restored, expected) {
  if (
    restored?.freshRoot !== true ||
    restored.treeSha256 !==
      expected.treeSha256
  ) {
    restoreFailure(
      "RESTORE_APP_STATE_INVARIANT_FAILED",
      "The clean app-state root did not reproduce the backup manifest."
    );
  }
  return restored;
}

function safeFailureCode(error) {
  return error instanceof BackupFailure
    ? error.code
    : "RESTORE_FAILED";
}

async function writeRestoreEvidence(
  restoreRoot,
  name,
  value
) {
  const evidence = await writeImmutableEvidence(
    path.join(restoreRoot, `${name}.json`),
    value
  );
  await writeImmutableEvidence(
    path.join(
      restoreRoot,
      `${name}.digest.json`
    ),
    {
      schema:
        "sitesourcery.immutable-evidence-digest/v1",
      file: `${name}.json`,
      sha256: evidence.sha256,
      bytes: evidence.bytes
    }
  );
  return evidence;
}

export async function verifyCleanRoomRestore({
  attemptRoot,
  stagingRoot,
  evidenceRoot,
  heldState,
  restoreTarget,
  ports,
  now = () => new Date(),
  restoreIdFactory = randomUUID
}) {
  if (
    typeof attemptRoot !== "string" ||
    !path.isAbsolute(attemptRoot) ||
    typeof stagingRoot !== "string" ||
    !path.isAbsolute(stagingRoot) ||
    typeof evidenceRoot !== "string" ||
    !path.isAbsolute(evidenceRoot)
  ) {
    restoreFailure(
      "RESTORE_CONFIGURATION_INVALID",
      "Restore roots must be absolute paths."
    );
  }
  const holds = assertHeldOperationsState(
    heldState
  );
  for (const capability of [
    "decrypt",
    "restoreFreshDatabase",
    "restoreFreshAppState"
  ]) {
    if (typeof ports?.[capability] !== "function") {
      restoreFailure(
        "RESTORE_CONFIGURATION_INVALID",
        `Restore port ${capability} is required.`
      );
    }
  }
  const verified = await loadVerifiedBackupAttempt(
    attemptRoot
  );
  if (
    canonicalJson(verified.manifest.holds) !==
    canonicalJson(holds)
  ) {
    restoreFailure(
      "RESTORE_HOLD_DRIFT",
      "The backup and restore held-state contracts differ."
    );
  }
  const restoreId = safeIdentifier(
    String(restoreIdFactory()),
    "Restore ID"
  );
  const restoreRoot = path.join(
    evidenceRoot,
    `${verified.manifest.attemptId}-${restoreId}`
  );
  await mkdir(restoreRoot, {
    recursive: false,
    mode: 0o700
  });
  const workspace = await mkdtemp(
    path.join(
      stagingRoot,
      "sitesourcery-restore-"
    )
  );
  const startedAt = now();
  if (
    !(startedAt instanceof Date) ||
    Number.isNaN(startedAt.valueOf())
  ) {
    restoreFailure(
      "RESTORE_CLOCK_INVALID",
      "Restore clock is invalid."
    );
  }

  try {
    const decrypted = new Map();
    for (const artifact of verified.manifest
      .artifacts) {
      const outputPath = path.join(
        workspace,
        artifact.kind === "postgresql"
          ? "postgresql.dump"
          : "app-state.tar"
      );
      await ports.decrypt({
        inputPath: path.join(
          attemptRoot,
          artifact.file
        ),
        outputPath,
        artifactKind: artifact.kind
      });
      const metadata = await stat(outputPath);
      if (
        !metadata.isFile() ||
        metadata.size !==
          artifact.plaintextBytes ||
        (await sha256File(outputPath)) !==
          artifact.plaintextSha256
      ) {
        restoreFailure(
          "RESTORE_DECRYPTED_ARTIFACT_INVALID",
          "Decrypted backup bytes do not match the immutable manifest."
        );
      }
      decrypted.set(artifact.kind, {
        ...artifact,
        path: outputPath
      });
    }
    const databaseArtifact =
      decrypted.get("postgresql");
    const appArtifact = decrypted.get("app_state");
    if (!databaseArtifact || !appArtifact) {
      restoreFailure(
        "RESTORE_MANIFEST_INCOMPLETE",
        "Both PostgreSQL and app-state artifacts are required."
      );
    }

    const database = validateDatabaseRestore(
      await ports.restoreFreshDatabase({
        dumpPath: databaseArtifact.path,
        expected:
          databaseArtifact.databaseManifest,
        restoreTarget
      }),
      databaseArtifact.databaseManifest
    );
    const appState = validateAppRestore(
      await ports.restoreFreshAppState({
        archivePath: appArtifact.path,
        expected:
          appArtifact.appStateManifest,
        restoreTarget
      }),
      appArtifact.appStateManifest
    );
    const completedAt = now();
    const report = {
      schema: RESTORE_VERIFIED_SCHEMA,
      restoreId,
      backupAttemptId:
        verified.manifest.attemptId,
      backupManifestSha256:
        verified.manifestSha256,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      cleanRoom: true,
      holds,
      database: {
        freshDatabase: true,
        databaseName:
          database.databaseName ?? null,
        runtimeContractV13: true,
        runtimeContractV14: true,
        runtimeContractV15: true,
        shadowSchemaAbsent: true,
        domainHeld: true,
        serviceRoleBypassRls: true,
        authenticatedRoleNoBypassRls: true,
        serviceRoleSchemaUsage: true,
        tableCount: database.tableCount,
        rowCounts: database.rowCounts
      },
      appState: {
        freshRoot: true,
        treeSha256: appState.treeSha256,
        entryCount:
          appArtifact.appStateManifest
            .entries.length
      }
    };
    const evidence = await writeRestoreEvidence(
      restoreRoot,
      "restore.verified",
      report
    );
    return Object.freeze({
      ok: true,
      restoreRoot,
      restoreId,
      backupAttemptId:
        verified.manifest.attemptId,
      evidenceSha256: evidence.sha256,
      report
    });
  } catch (error) {
    await writeRestoreEvidence(
      restoreRoot,
      "restore.failed",
      {
        schema: RESTORE_FAILED_SCHEMA,
        restoreId,
        backupAttemptId:
          verified.manifest.attemptId,
        startedAt: startedAt.toISOString(),
        failedAt: now().toISOString(),
        code: safeFailureCode(error),
        holds
      }
    ).catch(() => {});
    throw error;
  } finally {
    await rm(workspace, {
      recursive: true,
      force: true
    });
  }
}
