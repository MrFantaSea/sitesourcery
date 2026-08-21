#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

import {
  collectFin008DatabaseSnapshot,
  collectFin008MigrationInventory,
  verifyFin008HeldDataInvariants
} from "./fin008-data-convergence.mjs";
import {
  canonicalJson,
  readJsonObject,
  sha256Bytes,
  writeImmutableEvidence
} from "./immutable-evidence.mjs";
import {
  FIN010_DATA_CANDIDATE_COMMIT,
  FIN010_DATA_CANDIDATE_TREE,
  FIN010_PREDECESSOR_COMMIT,
  FIN010_PRODUCTION_ROOT,
  parseFin010EnvironmentFile,
  readFin010EnvironmentValue
} from "./fin010-production-runtime.mjs";

const { Pool } = pg;

export const FIN010_UPGRADE_CONTROL_SCHEMA =
  "sitesourcery.fin010-protected-upgrade-control/v1";
export const FIN010_UPGRADE_RECEIPT_SCHEMA =
  "sitesourcery.fin010-protected-upgrade-receipt/v1";
export const FIN010_PRODUCTION_DATABASE = "sitesourcery_production";
export const FIN010_PREDECESSOR_SCHEMA_SHA256 =
  "e5d1efe881766fc201335e125f26fdb3c9c7cf27de61873b6f0b62201c0231a2";
export const FIN010_SUCCESSOR_SCHEMA_SHA256 =
  "de7a4d476899db85d0d4bf2e93c9f54210f39bc77c416586a8b960cf0e5a397a";
// This is collectFin008MigrationInventory().manifestSha256: the canonical
// byte-inventory digest consumed by this upgrader. The separately retained
// origin file-manifest digest uses a different domain/schema and is 1c19acd….
export const FIN010_MIGRATION_MANIFEST_SHA256 =
  "8e5a5a8b52432335ffb05d7d83bf5e88836af2c9e12149547ff037b4009d9880";
export const FIN010_PREDECESSOR_ARTIFACT_MANIFEST_SHA256 =
  "b28ff784a9205096094a53a0fdbcedc5a20878b2b640e545cacd43ff61fd4359";
export const FIN010_PUBLIC_PLACEHOLDER_SHA256 =
  "672d8ea082208c32c545d1bc7f01a077327a045eac236027531083e382584f9d";
export const FIN010_UPGRADE_RECEIPT_PATH =
  `${FIN010_PRODUCTION_ROOT}/evidence/fin010-protected-upgrade-receipt.json`;

const SHA256 = /^[a-f0-9]{64}$/u;
const CONTROL_WINDOW_MS = 30 * 60 * 1000;
const BACKUP_MAXIMUM_AGE_MS = 60 * 60 * 1000;
const LOCK_CLASS = 1936289138;
const LOCK_OBJECT = 1718579814;

export class Fin010ProtectedUpgradeFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Fin010ProtectedUpgradeFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new Fin010ProtectedUpgradeFailure(code, message);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...keys].sort())
  ) {
    fail(
      "FIN010_UPGRADE_CONTROL_INVALID",
      `${label} must contain only its exact reviewed fields.`
    );
  }
  return value;
}

function exact(value, expected, label) {
  if (value !== expected) {
    fail(
      "FIN010_UPGRADE_CONTROL_INVALID",
      `${label} does not match the exact FIN-010 authority.`
    );
  }
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(
      "FIN010_UPGRADE_CONTROL_INVALID",
      `${label} must be a lowercase SHA-256 digest.`
    );
  }
  return value;
}

function instant(value, label) {
  const selected = Date.parse(value);
  if (!Number.isFinite(selected)) {
    fail(
      "FIN010_UPGRADE_CONTROL_INVALID",
      `${label} must be an ISO instant.`
    );
  }
  return selected;
}

function compactSnapshot(snapshot) {
  return freeze({
    databaseName: snapshot.identity.databaseName,
    postgresMajor: snapshot.identity.postgresMajor,
    tableCounts: snapshot.tableCounts,
    totalTableCount: snapshot.totalTableCount,
    schemaSha256: snapshot.schemaSha256,
    rowCountsSha256: snapshot.rowCountsSha256,
    ownershipSha256: snapshot.ownership.normalizedSha256,
    allRelationsOwnedByDatabaseOwner:
      snapshot.ownership.allRelationsOwnedByDatabaseOwner,
    allRoutinesOwnedByDatabaseOwner:
      snapshot.ownership.allRoutinesOwnedByDatabaseOwner
  });
}

function assertPredecessorSnapshot(snapshot) {
  if (
    snapshot.identity.databaseName !== FIN010_PRODUCTION_DATABASE ||
    snapshot.identity.postgresMajor !== 16 ||
    snapshot.totalTableCount !== 201 ||
    snapshot.tableCounts.ss !== 200 ||
    snapshot.tableCounts.auth !== 1 ||
    snapshot.schemaSha256 !== FIN010_PREDECESSOR_SCHEMA_SHA256
  ) {
    fail(
      "FIN010_PRODUCTION_PREDECESSOR_INVALID",
      "The protected production database is not the exact frozen 201-table predecessor."
    );
  }
  return snapshot;
}

function assertSuccessorSnapshot(snapshot) {
  if (
    snapshot.identity.databaseName !== FIN010_PRODUCTION_DATABASE ||
    snapshot.identity.postgresMajor !== 16 ||
    snapshot.totalTableCount !== 287 ||
    snapshot.tableCounts.ss !== 286 ||
    snapshot.tableCounts.auth !== 1 ||
    snapshot.schemaSha256 !== FIN010_SUCCESSOR_SCHEMA_SHA256
  ) {
    fail(
      "FIN010_PRODUCTION_SUCCESSOR_INVALID",
      "The protected production database did not converge to the exact 287-table successor."
    );
  }
  return snapshot;
}

export async function collectFin010ProductionPreflight(pool) {
  if (!pool || typeof pool.query !== "function") {
    fail("FIN010_DATABASE_CLIENT_INVALID", "A PostgreSQL client is required.");
  }
  const snapshot = assertPredecessorSnapshot(
    await collectFin008DatabaseSnapshot(pool, { requireDisposable: false })
  );
  const inventory = await collectFin008MigrationInventory();
  exact(inventory.count, 95, "Migration count");
  exact(inventory.delta.count, 37, "Migration delta count");
  exact(
    inventory.manifestSha256,
    FIN010_MIGRATION_MANIFEST_SHA256,
    "Migration manifest"
  );
  return freeze({
    schema: "sitesourcery.fin010-production-preflight/v1",
    state: "exact_predecessor_ready_for_control",
    capturedAt: new Date().toISOString(),
    source: {
      predecessorCommitSha: FIN010_PREDECESSOR_COMMIT,
      candidateCommitSha: FIN010_DATA_CANDIDATE_COMMIT,
      candidateTreeSha: FIN010_DATA_CANDIDATE_TREE
    },
    database: compactSnapshot(snapshot),
    migrations: {
      count: inventory.count,
      deltaCount: inventory.delta.count,
      manifestSha256: inventory.manifestSha256,
      deltaManifestSha256: inventory.delta.manifestSha256,
      firstDelta: inventory.delta.first,
      latest: inventory.latest
    },
    providerEffects: false,
    mutationPerformed: false
  });
}

export function validateFin010UpgradeControl(control, {
  now = Date.now()
} = {}) {
  exactObject(control, [
    "schema",
    "state",
    "createdAt",
    "expiresAt",
    "source",
    "database",
    "backup",
    "predecessor",
    "public",
    "operation",
    "authority"
  ], "FIN-010 upgrade control");
  exact(control.schema, FIN010_UPGRADE_CONTROL_SCHEMA, "Control schema");
  exact(control.state, "authorized_held_production_upgrade", "Control state");
  const createdAt = instant(control.createdAt, "Control createdAt");
  const expiresAt = instant(control.expiresAt, "Control expiresAt");
  if (
    createdAt > now + 60_000 ||
    expiresAt <= now ||
    expiresAt - createdAt > CONTROL_WINDOW_MS
  ) {
    fail(
      "FIN010_UPGRADE_CONTROL_EXPIRED",
      "The FIN-010 protected-upgrade control is expired or outside its 30-minute window."
    );
  }

  exactObject(control.source, [
    "predecessorCommitSha",
    "candidateCommitSha",
    "candidateTreeSha"
  ], "Control source");
  exact(control.source.predecessorCommitSha, FIN010_PREDECESSOR_COMMIT, "Predecessor commit");
  exact(
    control.source.candidateCommitSha,
    FIN010_DATA_CANDIDATE_COMMIT,
    "Data candidate commit"
  );
  exact(
    control.source.candidateTreeSha,
    FIN010_DATA_CANDIDATE_TREE,
    "Data candidate tree"
  );

  exactObject(control.database, [
    "name",
    "beforeSchemaSha256",
    "beforeRowCountsSha256",
    "beforeTotalTableCount",
    "afterSchemaSha256",
    "afterTotalTableCount",
    "migrationManifestSha256",
    "migrationDeltaCount"
  ], "Control database");
  exact(control.database.name, FIN010_PRODUCTION_DATABASE, "Database name");
  exact(control.database.beforeSchemaSha256, FIN010_PREDECESSOR_SCHEMA_SHA256, "Predecessor schema");
  digest(control.database.beforeRowCountsSha256, "Predecessor row counts");
  exact(control.database.beforeTotalTableCount, 201, "Predecessor table count");
  exact(control.database.afterSchemaSha256, FIN010_SUCCESSOR_SCHEMA_SHA256, "Successor schema");
  exact(control.database.afterTotalTableCount, 287, "Successor table count");
  exact(control.database.migrationManifestSha256, FIN010_MIGRATION_MANIFEST_SHA256, "Migration manifest");
  exact(control.database.migrationDeltaCount, 37, "Migration delta count");

  exactObject(control.backup, [
    "state",
    "completedAt",
    "manifestSha256",
    "ciphertextSha256",
    "destinationFailureDomainId",
    "plaintextRetained",
    "cleanRecoveryVerified",
    "rollbackPairReady"
  ], "Control backup");
  exact(control.backup.state, "success", "Backup state");
  const backupCompletedAt = instant(control.backup.completedAt, "Backup completedAt");
  if (backupCompletedAt > createdAt || createdAt - backupCompletedAt > BACKUP_MAXIMUM_AGE_MS) {
    fail(
      "FIN010_BACKUP_NOT_FRESH",
      "The encrypted rollback backup is not a fresh pre-control success."
    );
  }
  digest(control.backup.manifestSha256, "Backup manifest");
  digest(control.backup.ciphertextSha256, "Backup ciphertext");
  exact(control.backup.destinationFailureDomainId, "zen-sitesourcery-backup-01", "Backup destination");
  exact(control.backup.plaintextRetained, false, "Backup plaintext retention");
  exact(control.backup.cleanRecoveryVerified, true, "Backup clean recovery");
  exact(control.backup.rollbackPairReady, true, "Backup rollback pair");

  exactObject(control.predecessor, [
    "artifactManifestSha256",
    "runtimeRetained",
    "environmentRetained",
    "unitRollbackRetained"
  ], "Control predecessor");
  exact(control.predecessor.artifactManifestSha256, FIN010_PREDECESSOR_ARTIFACT_MANIFEST_SHA256, "Predecessor artifact");
  exact(control.predecessor.runtimeRetained, true, "Predecessor runtime retention");
  exact(control.predecessor.environmentRetained, true, "Predecessor environment retention");
  exact(control.predecessor.unitRollbackRetained, true, "Predecessor unit rollback retention");

  exactObject(control.public, [
    "placeholderSha256",
    "placeholderStillAuthoritative",
    "cutoverPerformed"
  ], "Control public state");
  exact(control.public.placeholderSha256, FIN010_PUBLIC_PLACEHOLDER_SHA256, "Public placeholder");
  exact(control.public.placeholderStillAuthoritative, true, "Public placeholder authority");
  exact(control.public.cutoverPerformed, false, "Public cutover state");

  exactObject(control.operation, [
    "runtimeStopped",
    "staticStopped",
    "originStopped",
    "workerStopped",
    "monitorPaused",
    "backupTimerPaused",
    "providerEffectsHeld"
  ], "Control operation state");
  for (const [name, value] of Object.entries(control.operation)) {
    exact(value, true, `Operation ${name}`);
  }

  exactObject(control.authority, [
    "ownerInstruction",
    "databaseUpgradeAuthorized",
    "publicCutoverSeparate",
    "retirementAuthorized"
  ], "Control authority");
  exact(control.authority.ownerInstruction, "complete_through_100", "Owner instruction");
  exact(control.authority.databaseUpgradeAuthorized, true, "Database upgrade authority");
  exact(control.authority.publicCutoverSeparate, true, "Separate public cutover");
  exact(control.authority.retirementAuthorized, false, "Retirement authority");
  return freeze(structuredClone(control));
}

function rowMap(snapshot) {
  return new Map(
    snapshot.rowCounts.map((entry) => [entry.relation, BigInt(entry.rowCount)])
  );
}

function verifyNoPredecessorRowLoss(before, after) {
  const prior = rowMap(before);
  const current = rowMap(after);
  let changedRelationCount = 0;
  for (const [relation, count] of prior) {
    const next = current.get(relation);
    if (next === undefined || next < count) {
      fail(
        "FIN010_PRODUCTION_ROW_LOSS",
        `Protected production lost predecessor rows from ${relation}.`
      );
    }
    if (next !== count) changedRelationCount += 1;
  }
  return freeze({
    preservedPredecessorRelations: prior.size,
    changedRelationCount,
    rowLoss: false
  });
}

async function otherConnections(client) {
  const result = await client.query(`
    select count(*)::integer as count
      from pg_stat_activity
     where datname = current_database()
       and pid <> pg_backend_pid()
  `);
  return Number(result.rows[0].count);
}

export async function upgradeFin010ProtectedProduction(pool, {
  control,
  now = Date.now(),
  migrationRoot = new URL(
    "../server/data-plane/supabase/migrations/",
    import.meta.url
  ),
  snapshot = (client) => collectFin008DatabaseSnapshot(
    client,
    { requireDisposable: false }
  ),
  inventory = () => collectFin008MigrationInventory({ migrationRoot }),
  invariantProof = verifyFin008HeldDataInvariants,
  migrationBytes = (name) => readFile(new URL(name, migrationRoot), "utf8")
} = {}) {
  const authorized = validateFin010UpgradeControl(control, { now });
  if (!pool || typeof pool.connect !== "function") {
    fail("FIN010_DATABASE_CLIENT_INVALID", "A PostgreSQL pool is required.");
  }
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("select pg_advisory_lock($1, $2)", [LOCK_CLASS, LOCK_OBJECT]);
    locked = true;
    if (await otherConnections(client) !== 0) {
      fail(
        "FIN010_DATABASE_NOT_QUIESCED",
        "Protected production has another database connection after quiesce."
      );
    }
    const before = assertPredecessorSnapshot(await snapshot(client));
    exact(
      before.rowCountsSha256,
      authorized.database.beforeRowCountsSha256,
      "Authorized predecessor row counts"
    );
    const selectedInventory = await inventory();
    exact(selectedInventory.count, 95, "Migration count");
    exact(selectedInventory.delta.count, 37, "Migration delta count");
    exact(selectedInventory.manifestSha256, FIN010_MIGRATION_MANIFEST_SHA256, "Migration manifest");
    for (const migration of selectedInventory.delta.entries) {
      try {
        await client.query(await migrationBytes(migration.name));
      } catch (error) {
        fail(
          "FIN010_PRODUCTION_MIGRATION_FAILED",
          `Protected migration failed at ${migration.name}; restore the paired backup before predecessor restart. ${error?.code ?? "unknown"}`
        );
      }
    }
    const after = assertSuccessorSnapshot(await snapshot(client));
    const rowPreservation = verifyNoPredecessorRowLoss(before, after);
    const invariants = await invariantProof(client);
    if (await otherConnections(client) !== 0) {
      fail(
        "FIN010_DATABASE_NOT_QUIESCED",
        "A second database connection appeared during the protected upgrade."
      );
    }
    return freeze({
      schema: FIN010_UPGRADE_RECEIPT_SCHEMA,
      state: "upgraded_production_held",
      completedAt: new Date(now).toISOString(),
      controlSha256: sha256Bytes(`${canonicalJson(authorized)}\n`),
      source: structuredClone(authorized.source),
      migrations: {
        count: selectedInventory.count,
        deltaCount: selectedInventory.delta.count,
        manifestSha256: selectedInventory.manifestSha256,
        deltaManifestSha256: selectedInventory.delta.manifestSha256,
        latest: selectedInventory.latest
      },
      before: compactSnapshot(before),
      after: compactSnapshot(after),
      rowPreservation,
      invariants,
      rollback: {
        pairedBackupManifestSha256: authorized.backup.manifestSha256,
        pairedBackupCiphertextSha256: authorized.backup.ciphertextSha256,
        destinationFailureDomainId:
          authorized.backup.destinationFailureDomainId,
        predecessorArtifactManifestSha256:
          authorized.predecessor.artifactManifestSha256,
        predecessorRestartRequiresDatabaseRestore: true,
        retirementAuthorized: false
      },
      effects: {
        provider: false,
        public: false,
        dns: false,
        cutover: false
      }
    });
  } finally {
    if (locked) {
      await client.query("select pg_advisory_unlock($1, $2)", [LOCK_CLASS, LOCK_OBJECT]).catch(() => {});
    }
    client.release();
  }
}

async function connectionStringFromEnvironment(filePath) {
  const values = parseFin010EnvironmentFile(
    await readFile(filePath, "utf8"),
    "FIN-010 hosted EnvironmentFile"
  );
  return readFin010EnvironmentValue(
    values,
    "SITESOURCERY_DATABASE_URL",
    "FIN-010 hosted EnvironmentFile"
  );
}

function cliArguments(argv) {
  const action = argv[0];
  if (!["preflight", "upgrade"].includes(action)) {
    fail(
      "FIN010_ARGUMENTS_INVALID",
      "Action must be preflight or upgrade."
    );
  }
  const values = Object.create(null);
  for (let index = 1; index < argv.length; index += 2) {
    values[argv[index]] = argv[index + 1];
  }
  if (!path.isAbsolute(values["--environment"] ?? "")) {
    fail("FIN010_ARGUMENTS_INVALID", "--environment must be absolute.");
  }
  if (action === "upgrade") {
    if (!path.isAbsolute(values["--control"] ?? "")) {
      fail("FIN010_ARGUMENTS_INVALID", "--control must be absolute.");
    }
    if (path.resolve(values["--receipt"] ?? "") !== FIN010_UPGRADE_RECEIPT_PATH) {
      fail(
        "FIN010_ARGUMENTS_INVALID",
        "--receipt must select the exact FIN-010 evidence path."
      );
    }
  }
  return { action, values };
}

async function main(argv = process.argv.slice(2)) {
  const { action, values } = cliArguments(argv);
  const connectionString = await connectionStringFromEnvironment(
    path.resolve(values["--environment"])
  );
  const pool = new Pool({
    connectionString,
    max: 1,
    application_name: "sitesourcery-fin010-protected-upgrade"
  });
  try {
    if (action === "preflight") {
      process.stdout.write(`${canonicalJson(
        await collectFin010ProductionPreflight(pool)
      )}\n`);
      return;
    }
    const receipt = await upgradeFin010ProtectedProduction(pool, {
      control: await readJsonObject(
        path.resolve(values["--control"]),
        "FIN-010 protected-upgrade control"
      )
    });
    const evidence = await writeImmutableEvidence(
      FIN010_UPGRADE_RECEIPT_PATH,
      receipt,
      { mode: 0o400 }
    );
    process.stdout.write(`${canonicalJson({
      schema: FIN010_UPGRADE_RECEIPT_SCHEMA,
      ok: true,
      state: receipt.state,
      receiptPath: evidence.path,
      receiptSha256: evidence.sha256,
      beforeSchemaSha256: receipt.before.schemaSha256,
      afterSchemaSha256: receipt.after.schemaSha256,
      preservedPredecessorRelations:
        receipt.rowPreservation.preservedPredecessorRelations,
      providerEffects: false,
      publicEffects: false
    })}\n`);
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${canonicalJson({
      schema: FIN010_UPGRADE_RECEIPT_SCHEMA,
      ok: false,
      code: error?.code ?? "FIN010_PROTECTED_UPGRADE_FAILED"
    })}\n`);
    process.exitCode = 1;
  });
}
