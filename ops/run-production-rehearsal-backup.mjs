#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  backupProductionRehearsalFromEnvironment
} from "./run-backup.mjs";

async function main() {
  const result =
    await backupProductionRehearsalFromEnvironment();
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      attemptId: result.attemptId,
      completedAt: result.completedAt,
      manifestSha256: result.manifestSha256,
      artifactCount: result.artifactCount
    })}\n`
  );
}

if (
  process.argv[1] &&
  import.meta.url ===
    pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        code:
          typeof error?.code === "string"
            ? error.code
            : "BACKUP_FAILED"
      })}\n`
    );
    process.exitCode = 1;
  });
}
