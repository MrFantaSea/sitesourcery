#!/usr/bin/env node

import {
  readdir
} from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath,
  pathToFileURL
} from "node:url";

import {
  canonicalJson,
  readJsonObject
} from "./immutable-evidence.mjs";
import {
  BACKUP_RESTORE_CONTRACT_SCHEMA,
  BACKUP_RESTORE_INTEGRATION_SCHEMA,
  BACKUP_RESTORE_JSON_SCHEMA_ID,
  BackupRestoreContractFailure,
  verifyHeldBackupRestoreContract
} from "./backup-restore-contract.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const DEFAULT_SCHEMA_PATH = path.join(
  PROJECT_ROOT,
  "ops/backup-restore-contract.schema.json"
);
const DEFAULT_MIGRATION_ROOT = path.join(
  PROJECT_ROOT,
  "server/data-plane/supabase/migrations"
);

export class BackupRestoreVerificationFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BackupRestoreVerificationFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new BackupRestoreVerificationFailure(
    code,
    message
  );
}

function exactKeys(value, expected, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...expected].sort())
  ) {
    fail(
      "BACKUP_RESTORE_SCHEMA_INVALID",
      `${label} must contain its exact reviewed fields.`
    );
  }
}

function validateSchemaDocument(schema) {
  exactKeys(
    schema,
    [
      "$schema",
      "$id",
      "title",
      "type",
      "additionalProperties",
      "required",
      "properties",
      "$defs"
    ],
    "Backup and restore JSON Schema"
  );
  if (
    schema.$id !== BACKUP_RESTORE_JSON_SCHEMA_ID ||
    schema.type !== "object" ||
    schema.additionalProperties !== false ||
    schema.properties?.schema?.const !==
      BACKUP_RESTORE_CONTRACT_SCHEMA ||
    schema.properties?.mode?.const !== "held" ||
    schema.$defs?.integrationInput?.properties
      ?.schema?.const !==
        BACKUP_RESTORE_INTEGRATION_SCHEMA ||
    schema.$defs?.database?.properties
      ?.migrationCount?.type !== "integer" ||
    schema.$defs.database.properties
      .migrationCount.minimum !== 1 ||
    Object.hasOwn(
      schema.$defs.database.properties.migrationCount,
      "const"
    ) ||
    schema.$defs?.backupEvidence
      ?.additionalProperties !== false ||
    schema.$defs?.restoreEvidence
      ?.additionalProperties !== false ||
    schema.$defs?.holds?.properties
      ?.allowsProviderEffects?.const !== false ||
    schema.$defs.holds.properties
      .allowsCustomerEffects.const !== false
  ) {
    fail(
      "BACKUP_RESTORE_SCHEMA_INVALID",
      "Backup and restore JSON Schema does not preserve the dynamic migration input and held-only evidence boundary."
    );
  }
  return schema;
}

async function migrationFilesFromRoot(
  migrationRoot,
  readDirectory
) {
  const entries = await readDirectory(
    migrationRoot,
    { withFileTypes: true }
  );
  const sqlEntries = entries.filter((entry) =>
    entry.name.endsWith(".sql")
  );
  if (sqlEntries.some((entry) => !entry.isFile())) {
    fail(
      "BACKUP_RESTORE_MIGRATION_ENTRY_INVALID",
      "Migration inventory contains a non-regular SQL entry."
    );
  }
  return sqlEntries.map((entry) => entry.name);
}

export async function verifyBackupRestoreRepository({
  contractPath,
  integrationPath,
  schemaPath = DEFAULT_SCHEMA_PATH,
  migrationRoot = DEFAULT_MIGRATION_ROOT,
  readJson = readJsonObject,
  readDirectory = readdir
} = {}) {
  for (const [label, selectedPath] of [
    ["contract", contractPath],
    ["integration input", integrationPath],
    ["schema", schemaPath],
    ["migration root", migrationRoot]
  ]) {
    if (
      typeof selectedPath !== "string" ||
      !path.isAbsolute(selectedPath)
    ) {
      fail(
        "BACKUP_RESTORE_ARGUMENT_INVALID",
        `Backup and restore ${label} path must be explicit and absolute.`
      );
    }
  }
  const [contract, integration, schema, migrationFiles] =
    await Promise.all([
      readJson(contractPath, "Backup and restore contract"),
      readJson(
        integrationPath,
        "Backup and restore integration input"
      ),
      readJson(
        schemaPath,
        "Backup and restore JSON Schema"
      ),
      migrationFilesFromRoot(
        migrationRoot,
        readDirectory
      )
    ]);
  validateSchemaDocument(schema);
  return verifyHeldBackupRestoreContract({
    contract,
    integration,
    migrationFiles
  });
}

function argumentsFrom(argv) {
  const selected = {
    contractPath: null,
    integrationPath: null,
    schemaPath: DEFAULT_SCHEMA_PATH,
    migrationRoot: DEFAULT_MIGRATION_ROOT
  };
  const seen = new Set();
  if (argv.length < 4 || argv.length % 2 !== 0) {
    fail(
      "BACKUP_RESTORE_ARGUMENT_INVALID",
      "Usage: verify-backup-restore-contract.mjs --contract /absolute/path --integration /absolute/path [--schema /absolute/path] [--migration-root /absolute/path]."
    );
  }
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const selectedPath = argv[index + 1];
    const field = {
      "--contract": "contractPath",
      "--integration": "integrationPath",
      "--schema": "schemaPath",
      "--migration-root": "migrationRoot"
    }[flag];
    if (
      !field ||
      seen.has(field) ||
      !path.isAbsolute(selectedPath)
    ) {
      fail(
        "BACKUP_RESTORE_ARGUMENT_INVALID",
        "Backup and restore verifier arguments are invalid or duplicated."
      );
    }
    seen.add(field);
    selected[field] = path.resolve(selectedPath);
  }
  if (!selected.contractPath || !selected.integrationPath) {
    fail(
      "BACKUP_RESTORE_ARGUMENT_INVALID",
      "Both contract and integration input paths are required."
    );
  }
  return selected;
}

async function main() {
  const result = await verifyBackupRestoreRepository(
    argumentsFrom(process.argv.slice(2))
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        valid: false,
        code:
          error instanceof BackupRestoreContractFailure ||
          error instanceof BackupRestoreVerificationFailure
            ? error.code
            : "BACKUP_RESTORE_VERIFICATION_FAILED"
      })}\n`
    );
    process.exitCode = 1;
  });
}
