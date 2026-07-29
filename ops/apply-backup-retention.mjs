#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  applyBackupRetention
} from "./backup-runtime.mjs";
import {
  parseJsonObject
} from "./immutable-evidence.mjs";

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

function positiveInteger(
  environment,
  field
) {
  const value = Number(required(environment, field));
  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(`${field} must be positive.`);
  }
  return value;
}

export async function retentionFromEnvironment(
  environment = process.env
) {
  const configuredDestination = required(
    environment,
    "SITESOURCERY_BACKUP_DESTINATION_ROOT"
  );
  if (!path.isAbsolute(configuredDestination)) {
    throw new Error(
      "SITESOURCERY_BACKUP_DESTINATION_ROOT must be absolute."
    );
  }
  const destinationRoot = path.resolve(
    configuredDestination
  );
  const marker = parseJsonObject(
    await readFile(
      path.join(
        destinationRoot,
        ".sitesourcery-off-machine.json"
      ),
      "utf8"
    ),
    "Off-machine destination marker"
  );
  const apply =
    environment
      .SITESOURCERY_BACKUP_RETENTION_APPLY ===
    "true";
  if (
    !["true", "false"].includes(
      environment
        .SITESOURCERY_BACKUP_RETENTION_APPLY
    )
  ) {
    throw new Error(
      "SITESOURCERY_BACKUP_RETENTION_APPLY must be true or false."
    );
  }
  return applyBackupRetention({
    destinationRoot,
    destinationMarker: marker,
    sourceFailureDomainId: required(
      environment,
      "SITESOURCERY_SOURCE_FAILURE_DOMAIN"
    ),
    maxAgeMs: positiveInteger(
      environment,
      "SITESOURCERY_BACKUP_RETENTION_MAX_AGE_MS"
    ),
    minimumSuccessful: positiveInteger(
      environment,
      "SITESOURCERY_BACKUP_RETENTION_MINIMUM_SUCCESSFUL"
    ),
    apply
  });
}

async function main() {
  const result = await retentionFromEnvironment();
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      applied: result.applied,
      keep: result.keep,
      remove: result.remove
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
            : "BACKUP_RETENTION_FAILED"
      })}\n`
    );
    process.exitCode = 1;
  });
}
