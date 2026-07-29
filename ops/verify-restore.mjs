#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createProductionRestorePorts
} from "./restore-ports.mjs";
import {
  verifyCleanRoomRestore
} from "./restore-runtime.mjs";

function required(environment, field) {
  const value = environment[field];
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    throw new Error(`${field} is required.`);
  }
  return value;
}

function absolute(environment, field) {
  const value = required(environment, field);
  if (!path.isAbsolute(value)) {
    throw new Error(`${field} must be absolute.`);
  }
  return path.resolve(value);
}

function heldState(environment) {
  return {
    stripeMode:
      environment.SITESOURCERY_STRIPE_MODE,
    recoveryMailMode:
      environment
        .SITESOURCERY_RECOVERY_MAIL_MODE,
    publication:
      environment
        .SITESOURCERY_EXPECT_PUBLICATION,
    domainRuntime:
      environment
        .SITESOURCERY_EXPECT_DOMAIN_RUNTIME,
    dns:
      environment.SITESOURCERY_EXPECT_DNS
  };
}

export async function restoreFromEnvironment(
  environment = process.env
) {
  const attemptRoot = absolute(
    environment,
    "SITESOURCERY_RESTORE_BACKUP_ATTEMPT"
  );
  const stagingRoot = absolute(
    environment,
    "SITESOURCERY_RESTORE_STAGING_ROOT"
  );
  const evidenceRoot = absolute(
    environment,
    "SITESOURCERY_RESTORE_EVIDENCE_ROOT"
  );
  const appRestoreRoot = absolute(
    environment,
    "SITESOURCERY_RESTORE_APP_ROOT"
  );
  await Promise.all([
    mkdir(stagingRoot, {
      recursive: true,
      mode: 0o700
    }),
    mkdir(evidenceRoot, {
      recursive: true,
      mode: 0o700
    })
  ]);
  const targetDatabaseName = required(
    environment,
    "SITESOURCERY_RESTORE_DATABASE_NAME"
  );
  const ports = createProductionRestorePorts({
    ageIdentityFile: absolute(
      environment,
      "SITESOURCERY_RESTORE_AGE_IDENTITY_FILE"
    ),
    adminDatabaseUrl: required(
      environment,
      "SITESOURCERY_RESTORE_ADMIN_DATABASE_URL"
    ),
    targetDatabaseName,
    appRestoreRoot,
    environment
  });
  return verifyCleanRoomRestore({
    attemptRoot,
    stagingRoot,
    evidenceRoot,
    heldState: heldState(environment),
    restoreTarget: {
      databaseName: targetDatabaseName,
      appRoot: appRestoreRoot,
      networkExposure: "none"
    },
    ports
  });
}

async function main() {
  const result = await restoreFromEnvironment();
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      restoreId: result.restoreId,
      backupAttemptId:
        result.backupAttemptId,
      evidenceSha256:
        result.evidenceSha256,
      cleanRoom: true
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
            : "RESTORE_FAILED"
      })}\n`
    );
    process.exitCode = 1;
  });
}
