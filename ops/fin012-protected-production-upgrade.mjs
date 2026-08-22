#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

import {
  collectFin008DatabaseSnapshot,
  collectFin008MigrationInventory,
  verifyFin008HeldDataInvariants
} from "./fin008-data-convergence.mjs";
import {
  FIN012_CANDIDATE_COMMIT,
  FIN012_CANDIDATE_TREE,
  FIN012_CI_FINAL_RECEIPT_DIGEST,
  FIN012_HELD_CONTROL_COMMIT,
  FIN012_PREDECESSOR_COMMIT,
  FIN012_PRODUCTION_ROOT
} from "./fin012-production-runtime.mjs";
import {
  canonicalJson,
  readJsonObject,
  sha256Bytes,
  writeImmutableEvidence
} from "./immutable-evidence.mjs";
import {
  collectOriginMigrationInventory
} from "./origin-seal-repository.mjs";
import {
  parseFin010EnvironmentFile,
  readFin010EnvironmentValue
} from "./fin010-production-runtime.mjs";

const { Pool } = pg;

export const FIN012_UPGRADE_CONTROL_SCHEMA =
  "sitesourcery.fin012-protected-upgrade-control/v1";
export const FIN012_UPGRADE_RECEIPT_SCHEMA =
  "sitesourcery.fin012-protected-upgrade-receipt/v1";
export const FIN012_PRODUCTION_DATABASE = "sitesourcery_production";
export const FIN012_PREDECESSOR_SCHEMA_SHA256 =
  "de7a4d476899db85d0d4bf2e93c9f54210f39bc77c416586a8b960cf0e5a397a";
export const FIN012_SUCCESSOR_SCHEMA_SHA256 =
  "c6531a8817870b1dbbe4b488948e8513a3a07fd64b6076597a102316ca68d3e3";
export const FIN012_PREDECESSOR_TABLE_COUNT = 287;
export const FIN012_SUCCESSOR_TABLE_COUNT = 294;
export const FIN012_PREDECESSOR_MIGRATION_COUNT = 95;
export const FIN012_SUCCESSOR_MIGRATION_COUNT = 96;
export const FIN012_PREDECESSOR_MIGRATION_MANIFEST_SHA256 =
  "8e5a5a8b52432335ffb05d7d83bf5e88836af2c9e12149547ff037b4009d9880";
export const FIN012_SUCCESSOR_MIGRATION_MANIFEST_SHA256 =
  "2589e3a259b24739b5c4b1c05a0cfb74d15f051d7ab58a9fcc5d580d429b9a62";
export const FIN012_MIGRATION_NAME =
  "202608220143_download_protection_v1.sql";
export const FIN012_MIGRATION_BYTE_COUNT = 32483;
export const FIN012_MIGRATION_SHA256 =
  "c1fec8ada5d393b1e7cecef03e7b6de674f75d64251e91ef8c2ff325e75b3d5c";
export const FIN012_PREDECESSOR_ARTIFACT_MANIFEST_SHA256 =
  "ffb5c97d8e2231a58f0199f9250ef2ce77dae38b4df0ff2532a50ee9bc92aead";
export const FIN012_UPGRADE_RECEIPT_PATH =
  `${FIN012_PRODUCTION_ROOT}/evidence/fin012-protected-upgrade-receipt.json`;
export const FIN012_DOWNLOAD_PROTECTION_CONTRACT =
  "fin012-download-2000-credit-2000-verified-billing-3ds-requested-velocity-6h-12h-120x5m-real-signal-gate-private-dossier";

const SHA256 = /^[a-f0-9]{64}$/u;
const CONTROL_WINDOW_MS = 30 * 60 * 1000;
const BACKUP_MAXIMUM_AGE_MS = 60 * 60 * 1000;
const LOCK_CLASS = 1936289138;
const LOCK_OBJECT = 1718579815;
const MIGRATION_ROOT = new URL(
  "../server/data-plane/supabase/migrations/",
  import.meta.url
);
const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const PROTECTION_TABLES = Object.freeze([
  "commerce_v2_download_access_events",
  "commerce_v2_download_checkout_attempts",
  "commerce_v2_download_checkout_gate",
  "commerce_v2_download_dispute_dossiers",
  "commerce_v2_download_fraud_warning_events",
  "commerce_v2_download_gate_review_decisions",
  "commerce_v2_download_gate_transitions"
]);

export class Fin012ProtectedUpgradeFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Fin012ProtectedUpgradeFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new Fin012ProtectedUpgradeFailure(code, message);
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
    canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())
  ) {
    fail(
      "FIN012_UPGRADE_CONTROL_INVALID",
      `${label} must contain only its exact reviewed fields.`
    );
  }
  return value;
}

function exact(value, expected, label) {
  if (value !== expected) {
    fail(
      "FIN012_UPGRADE_CONTROL_INVALID",
      `${label} does not match the exact FIN-012 production authority.`
    );
  }
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(
      "FIN012_UPGRADE_CONTROL_INVALID",
      `${label} must be a lowercase SHA-256 digest.`
    );
  }
  return value;
}

function instant(value, label) {
  const parsed = new Date(value);
  const selected = parsed.valueOf();
  if (
    typeof value !== "string" ||
    !Number.isFinite(selected) ||
    parsed.toISOString() !== value
  ) {
    fail("FIN012_UPGRADE_CONTROL_INVALID", `${label} must be an ISO instant.`);
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

function assertSnapshot(snapshot, {
  tableCount,
  ssTableCount,
  schemaSha256,
  label,
  code
}) {
  if (
    snapshot.identity.databaseName !== FIN012_PRODUCTION_DATABASE ||
    snapshot.identity.postgresMajor !== 16 ||
    snapshot.totalTableCount !== tableCount ||
    snapshot.tableCounts.ss !== ssTableCount ||
    snapshot.tableCounts.auth !== 1 ||
    snapshot.schemaSha256 !== schemaSha256
  ) {
    fail(code, `Protected production is not the exact ${label} database shape.`);
  }
  return snapshot;
}

function assertPredecessorSnapshot(snapshot) {
  return assertSnapshot(snapshot, {
    tableCount: FIN012_PREDECESSOR_TABLE_COUNT,
    ssTableCount: 286,
    schemaSha256: FIN012_PREDECESSOR_SCHEMA_SHA256,
    label: "287-table FIN-010 predecessor",
    code: "FIN012_PRODUCTION_PREDECESSOR_INVALID"
  });
}

function assertSuccessorSnapshot(snapshot) {
  return assertSnapshot(snapshot, {
    tableCount: FIN012_SUCCESSOR_TABLE_COUNT,
    ssTableCount: 293,
    schemaSha256: FIN012_SUCCESSOR_SCHEMA_SHA256,
    label: "294-table FIN-012 successor",
    code: "FIN012_PRODUCTION_SUCCESSOR_INVALID"
  });
}

export async function collectFin012MigrationInventory({
  projectRoot = PROJECT_ROOT,
  migrationRoot = MIGRATION_ROOT
} = {}) {
  const predecessor = await collectFin008MigrationInventory({ migrationRoot });
  exact(
    predecessor.count,
    FIN012_PREDECESSOR_MIGRATION_COUNT,
    "Predecessor migration count"
  );
  exact(
    predecessor.manifestSha256,
    FIN012_PREDECESSOR_MIGRATION_MANIFEST_SHA256,
    "Predecessor migration manifest"
  );
  const successor = await collectOriginMigrationInventory({
    projectRoot,
    migrationRoot: "server/data-plane/supabase/migrations"
  });
  exact(successor.count, FIN012_SUCCESSOR_MIGRATION_COUNT, "Successor migration count");
  exact(successor.latest, FIN012_MIGRATION_NAME, "Successor latest migration");
  exact(
    successor.sha256,
    FIN012_SUCCESSOR_MIGRATION_MANIFEST_SHA256,
    "Successor migration manifest"
  );
  const selected = successor.files.at(-1);
  exact(selected.path, `server/data-plane/supabase/migrations/${FIN012_MIGRATION_NAME}`, "Migration path");
  exact(selected.byteCount, FIN012_MIGRATION_BYTE_COUNT, "Migration byte count");
  exact(selected.sha256, FIN012_MIGRATION_SHA256, "Migration file digest");
  return freeze({ predecessor, successor, selected });
}

export async function collectFin012ProductionPreflight(pool, options = {}) {
  if (!pool || typeof pool.query !== "function") {
    fail("FIN012_DATABASE_CLIENT_INVALID", "A PostgreSQL client is required.");
  }
  const snapshot = assertPredecessorSnapshot(
    await collectFin008DatabaseSnapshot(pool, { requireDisposable: false })
  );
  const inventory = await collectFin012MigrationInventory(options);
  const invariants = await verifyFin008HeldDataInvariants(pool);
  return freeze({
    schema: "sitesourcery.fin012-production-preflight/v1",
    state: "exact_predecessor_ready_for_control",
    capturedAt: new Date().toISOString(),
    source: {
      predecessorCommitSha: FIN012_PREDECESSOR_COMMIT,
      candidateCommitSha: FIN012_CANDIDATE_COMMIT,
      candidateTreeSha: FIN012_CANDIDATE_TREE,
      heldControlCommitSha: FIN012_HELD_CONTROL_COMMIT,
      heldCiReceiptDigest: FIN012_CI_FINAL_RECEIPT_DIGEST
    },
    database: compactSnapshot(snapshot),
    migrations: {
      beforeCount: inventory.predecessor.count,
      beforeManifestSha256: inventory.predecessor.manifestSha256,
      afterCount: inventory.successor.count,
      afterManifestSha256: inventory.successor.sha256,
      selectedName: FIN012_MIGRATION_NAME,
      selectedSha256: FIN012_MIGRATION_SHA256
    },
    invariants,
    providerEffects: false,
    paymentEffects: false,
    mutationPerformed: false
  });
}

export function validateFin012UpgradeControl(control, { now = Date.now() } = {}) {
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
  ], "FIN-012 upgrade control");
  exact(control.schema, FIN012_UPGRADE_CONTROL_SCHEMA, "Control schema");
  exact(control.state, "authorized_held_production_upgrade", "Control state");
  const createdAt = instant(control.createdAt, "Control createdAt");
  const expiresAt = instant(control.expiresAt, "Control expiresAt");
  if (
    createdAt > now + 60_000 ||
    expiresAt <= now ||
    expiresAt - createdAt > CONTROL_WINDOW_MS
  ) {
    fail(
      "FIN012_UPGRADE_CONTROL_EXPIRED",
      "The FIN-012 protected-upgrade control is expired or outside its 30-minute window."
    );
  }

  exactObject(control.source, [
    "predecessorCommitSha",
    "candidateCommitSha",
    "candidateTreeSha",
    "heldControlCommitSha",
    "heldCiReceiptDigest"
  ], "Control source");
  for (const [field, expected] of Object.entries({
    predecessorCommitSha: FIN012_PREDECESSOR_COMMIT,
    candidateCommitSha: FIN012_CANDIDATE_COMMIT,
    candidateTreeSha: FIN012_CANDIDATE_TREE,
    heldControlCommitSha: FIN012_HELD_CONTROL_COMMIT,
    heldCiReceiptDigest: FIN012_CI_FINAL_RECEIPT_DIGEST
  })) exact(control.source[field], expected, `Control source ${field}`);

  exactObject(control.database, [
    "name",
    "beforeSchemaSha256",
    "beforeRowCountsSha256",
    "beforeTotalTableCount",
    "afterSchemaSha256",
    "afterTotalTableCount",
    "beforeMigrationManifestSha256",
    "afterMigrationManifestSha256",
    "migrationDeltaCount",
    "migrationName",
    "migrationSha256"
  ], "Control database");
  exact(control.database.name, FIN012_PRODUCTION_DATABASE, "Database name");
  exact(control.database.beforeSchemaSha256, FIN012_PREDECESSOR_SCHEMA_SHA256, "Before schema");
  digest(control.database.beforeRowCountsSha256, "Before row counts");
  exact(control.database.beforeTotalTableCount, FIN012_PREDECESSOR_TABLE_COUNT, "Before table count");
  exact(control.database.afterSchemaSha256, FIN012_SUCCESSOR_SCHEMA_SHA256, "After schema");
  exact(control.database.afterTotalTableCount, FIN012_SUCCESSOR_TABLE_COUNT, "After table count");
  exact(control.database.beforeMigrationManifestSha256, FIN012_PREDECESSOR_MIGRATION_MANIFEST_SHA256, "Before migrations");
  exact(control.database.afterMigrationManifestSha256, FIN012_SUCCESSOR_MIGRATION_MANIFEST_SHA256, "After migrations");
  exact(control.database.migrationDeltaCount, 1, "Migration delta count");
  exact(control.database.migrationName, FIN012_MIGRATION_NAME, "Migration name");
  exact(control.database.migrationSha256, FIN012_MIGRATION_SHA256, "Migration digest");

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
  const completedAt = instant(control.backup.completedAt, "Backup completedAt");
  if (completedAt > createdAt || createdAt - completedAt > BACKUP_MAXIMUM_AGE_MS) {
    fail("FIN012_BACKUP_NOT_FRESH", "The encrypted rollback backup is not a fresh pre-control success.");
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
    "evidenceRetained",
    "unitRollbackRetained"
  ], "Control predecessor");
  exact(control.predecessor.artifactManifestSha256, FIN012_PREDECESSOR_ARTIFACT_MANIFEST_SHA256, "Predecessor artifact");
  for (const field of ["runtimeRetained", "environmentRetained", "evidenceRetained", "unitRollbackRetained"]) {
    exact(control.predecessor[field], true, `Predecessor ${field}`);
  }

  exactObject(control.public, [
    "predecessorCommitSha",
    "predecessorStillAuthoritative",
    "cutoverPerformed"
  ], "Control public state");
  exact(control.public.predecessorCommitSha, FIN012_PREDECESSOR_COMMIT, "Public predecessor");
  exact(control.public.predecessorStillAuthoritative, true, "Public predecessor authority");
  exact(control.public.cutoverPerformed, false, "Public cutover state");

  exactObject(control.operation, [
    "runtimeStopped",
    "staticStopped",
    "originStopped",
    "tunnelStopped",
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
    "runtimeCutoverSeparate",
    "providerEffectsAuthorized",
    "paymentEffectsAuthorized",
    "dnsEffectsAuthorized",
    "retirementAuthorized"
  ], "Control authority");
  exact(control.authority.ownerInstruction, "complete_through_100", "Owner instruction");
  exact(control.authority.databaseUpgradeAuthorized, true, "Database upgrade authority");
  exact(control.authority.runtimeCutoverSeparate, true, "Separate runtime cutover");
  for (const field of [
    "providerEffectsAuthorized",
    "paymentEffectsAuthorized",
    "dnsEffectsAuthorized",
    "retirementAuthorized"
  ]) exact(control.authority[field], false, `Authority ${field}`);
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
      fail("FIN012_PRODUCTION_ROW_LOSS", `Protected production lost predecessor rows from ${relation}.`);
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

export async function verifyFin012DownloadProtectionInvariants(client) {
  const result = await client.query(`
    select
      ss.download_protection_contract_v1() as contract,
      (select state from ss.commerce_v2_download_checkout_gate where singleton) as gate_state,
      (select reason from ss.commerce_v2_download_checkout_gate where singleton) as gate_reason,
      (select revision from ss.commerce_v2_download_checkout_gate where singleton) as gate_revision,
      (select count(*)::integer from ss.commerce_v2_download_checkout_gate) as gate_rows,
      (select count(*)::integer
         from pg_class relation
         join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'ss'
          and relation.relname = any($1::text[])
          and relation.relkind in ('r', 'p')
          and relation.relrowsecurity
          and relation.relforcerowsecurity) as protected_rls_tables,
      (select count(*)::integer
         from pg_trigger trigger_value
         join pg_class relation on relation.oid = trigger_value.tgrelid
         join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'ss'
          and relation.relname = any($1::text[])
          and not trigger_value.tgisinternal) as protection_triggers
  `, [PROTECTION_TABLES]);
  const facts = result.rows[0];
  if (
    facts.contract !== FIN012_DOWNLOAD_PROTECTION_CONTRACT ||
    facts.gate_state !== "open" ||
    facts.gate_reason !== "owner_approved_protected_launch" ||
    BigInt(facts.gate_revision) !== 1n ||
    Number(facts.gate_rows) !== 1 ||
    Number(facts.protected_rls_tables) !== PROTECTION_TABLES.length ||
    Number(facts.protection_triggers) !== PROTECTION_TABLES.length
  ) {
    fail("FIN012_DOWNLOAD_PROTECTION_INVALID", "The exact FIN-012 Download protection contract is incomplete.");
  }
  return freeze({
    contract: facts.contract,
    gateState: facts.gate_state,
    gateReason: facts.gate_reason,
    gateRevision: String(facts.gate_revision),
    gateRows: Number(facts.gate_rows),
    protectedRlsTables: Number(facts.protected_rls_tables),
    protectionTriggers: Number(facts.protection_triggers)
  });
}

export async function upgradeFin012ProtectedProduction(pool, {
  control,
  now = Date.now(),
  migrationRoot = MIGRATION_ROOT,
  projectRoot = PROJECT_ROOT,
  snapshot = (client) => collectFin008DatabaseSnapshot(client, { requireDisposable: false }),
  inventory = () => collectFin012MigrationInventory({ projectRoot, migrationRoot }),
  heldInvariantProof = verifyFin008HeldDataInvariants,
  protectionInvariantProof = verifyFin012DownloadProtectionInvariants,
  migrationBytes = () => readFile(new URL(FIN012_MIGRATION_NAME, migrationRoot), "utf8")
} = {}) {
  const authorized = validateFin012UpgradeControl(control, { now });
  if (!pool || typeof pool.connect !== "function") {
    fail("FIN012_DATABASE_CLIENT_INVALID", "A PostgreSQL pool is required.");
  }
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("select pg_advisory_lock($1, $2)", [LOCK_CLASS, LOCK_OBJECT]);
    locked = true;
    if (await otherConnections(client) !== 0) {
      fail("FIN012_DATABASE_NOT_QUIESCED", "Protected production has another database connection after quiesce.");
    }
    const before = assertPredecessorSnapshot(await snapshot(client));
    exact(before.rowCountsSha256, authorized.database.beforeRowCountsSha256, "Authorized predecessor row counts");
    const selectedInventory = await inventory();
    exact(selectedInventory.successor.count - selectedInventory.predecessor.count, 1, "Migration inventory delta");
    try {
      await client.query(await migrationBytes());
    } catch (error) {
      await client.query("rollback").catch(() => {});
      fail(
        "FIN012_PRODUCTION_MIGRATION_FAILED",
        `Protected migration failed at ${FIN012_MIGRATION_NAME}; restore the paired backup before predecessor restart. ${error?.code ?? "unknown"}`
      );
    }
    const after = assertSuccessorSnapshot(await snapshot(client));
    const rowPreservation = verifyNoPredecessorRowLoss(before, after);
    const heldInvariants = await heldInvariantProof(client);
    const downloadProtection = await protectionInvariantProof(client);
    if (await otherConnections(client) !== 0) {
      fail("FIN012_DATABASE_NOT_QUIESCED", "A second database connection appeared during the protected upgrade.");
    }
    return freeze({
      schema: FIN012_UPGRADE_RECEIPT_SCHEMA,
      state: "database_upgraded_held_for_runtime_cutover",
      completedAt: new Date(now).toISOString(),
      controlSha256: sha256Bytes(`${canonicalJson(authorized)}\n`),
      source: structuredClone(authorized.source),
      migrations: {
        beforeCount: selectedInventory.predecessor.count,
        afterCount: selectedInventory.successor.count,
        deltaCount: 1,
        beforeManifestSha256: selectedInventory.predecessor.manifestSha256,
        afterManifestSha256: selectedInventory.successor.sha256,
        name: FIN012_MIGRATION_NAME,
        sha256: FIN012_MIGRATION_SHA256
      },
      before: compactSnapshot(before),
      after: compactSnapshot(after),
      rowPreservation,
      invariants: { held: heldInvariants, downloadProtection },
      rollback: {
        pairedBackupManifestSha256: authorized.backup.manifestSha256,
        pairedBackupCiphertextSha256: authorized.backup.ciphertextSha256,
        destinationFailureDomainId: authorized.backup.destinationFailureDomainId,
        predecessorArtifactManifestSha256: authorized.predecessor.artifactManifestSha256,
        predecessorRestartRequiresDatabaseRestore: true,
        retirementAuthorized: false
      },
      effects: {
        provider: false,
        payment: false,
        public: false,
        dns: false,
        runtimeCutover: false
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
    "FIN-012 hosted EnvironmentFile"
  );
  return readFin010EnvironmentValue(
    values,
    "SITESOURCERY_DATABASE_URL",
    "FIN-012 hosted EnvironmentFile"
  );
}

function cliArguments(argv) {
  const action = argv[0];
  if (!["preflight", "upgrade"].includes(action)) {
    fail("FIN012_ARGUMENTS_INVALID", "Action must be preflight or upgrade.");
  }
  const values = Object.create(null);
  for (let index = 1; index < argv.length; index += 2) {
    values[argv[index]] = argv[index + 1];
  }
  if (!path.isAbsolute(values["--environment"] ?? "")) {
    fail("FIN012_ARGUMENTS_INVALID", "--environment must be absolute.");
  }
  if (action === "upgrade") {
    if (!path.isAbsolute(values["--control"] ?? "")) {
      fail("FIN012_ARGUMENTS_INVALID", "--control must be absolute.");
    }
    if (path.resolve(values["--receipt"] ?? "") !== FIN012_UPGRADE_RECEIPT_PATH) {
      fail("FIN012_ARGUMENTS_INVALID", "--receipt must select the exact FIN-012 evidence path.");
    }
  }
  return { action, values };
}

async function main(argv = process.argv.slice(2)) {
  const { action, values } = cliArguments(argv);
  const pool = new Pool({
    connectionString: await connectionStringFromEnvironment(path.resolve(values["--environment"])),
    max: 1,
    application_name: "sitesourcery-fin012-protected-upgrade"
  });
  try {
    if (action === "preflight") {
      process.stdout.write(`${canonicalJson(await collectFin012ProductionPreflight(pool))}\n`);
      return;
    }
    const receipt = await upgradeFin012ProtectedProduction(pool, {
      control: await readJsonObject(path.resolve(values["--control"]), "FIN-012 protected-upgrade control")
    });
    const evidence = await writeImmutableEvidence(
      FIN012_UPGRADE_RECEIPT_PATH,
      receipt,
      { mode: 0o400 }
    );
    process.stdout.write(`${canonicalJson({
      schema: FIN012_UPGRADE_RECEIPT_SCHEMA,
      ok: true,
      state: receipt.state,
      receiptPath: evidence.path,
      receiptSha256: evidence.sha256,
      beforeSchemaSha256: receipt.before.schemaSha256,
      afterSchemaSha256: receipt.after.schemaSha256,
      preservedPredecessorRelations: receipt.rowPreservation.preservedPredecessorRelations,
      providerEffects: false,
      paymentEffects: false,
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
      schema: FIN012_UPGRADE_RECEIPT_SCHEMA,
      ok: false,
      code: error?.code ?? "FIN012_PROTECTED_UPGRADE_FAILED"
    })}\n`);
    process.exitCode = 1;
  });
}
