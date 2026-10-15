#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  recoverHqBackupCycle,
  runHqBackupCycle
} from "./hq-backup-cycle.mjs";
import {
  backupHqFromEnvironment
} from "./run-backup.mjs";

function safeCode(error) {
  return typeof error?.code === "string"
    ? error.code
    : "BACKUP_CYCLE_FAILED";
}

async function main() {
  process.umask(0o077);
  const action = process.argv[2] ?? "run";
  if (action === "recover") {
    const result =
      await recoverHqBackupCycle();
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        action,
        recovered: result.recovered,
        plaintextStagingRemoved:
          result.plaintextStagingRemoved
      })}\n`
    );
    return;
  }
  if (action !== "run") {
    const error = new Error(
      "Backup-cycle action must be run or recover."
    );
    error.code = "BACKUP_CYCLE_ACTION_INVALID";
    throw error;
  }
  const result =
    await runHqBackupCycle({
      backup: () =>
        backupHqFromEnvironment()
    });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      action,
      snapshotId: result.snapshotId,
      attemptId: result.backup.attemptId,
      completedAt: result.backup.completedAt,
      manifestSha256:
        result.backup.manifestSha256,
      artifactCount:
        result.backup.artifactCount
    })}\n`
  );
}

let isMain = false;
try {
  isMain = Boolean(process.argv[1]) &&
    realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
} catch {
  // An imported module may have a non-file entry argument (for example --eval).
}
if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        code: safeCode(error)
      })}\n`
    );
    process.exitCode = 1;
  });
}
