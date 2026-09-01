#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

import {
  collectFin008DatabaseSnapshot,
  verifyFin008HeldDataInvariants
} from "./fin008-data-convergence.mjs";
import {
  validateCiReleaseFinalReceipt,
  validateCiReleaseSuccessorInput
} from "./ci-release-proof-runtime.mjs";
import {
  canonicalJson,
  parseJsonObject,
  readJsonObject,
  sha256Bytes,
  writeImmutableEvidence
} from "./immutable-evidence.mjs";
import { collectOriginMigrationInventory } from "./origin-seal-repository.mjs";
import {
  parseFin010EnvironmentFile,
  readFin010EnvironmentValue
} from "./fin010-production-runtime.mjs";

const { Pool } = pg;

export const FIN015_UPGRADE_CONTROL_SCHEMA =
  "sitesourcery.fin015-protected-upgrade-control/v1";
export const FIN015_UPGRADE_RECEIPT_SCHEMA =
  "sitesourcery.fin015-protected-upgrade-receipt/v1";
export const FIN015_PRODUCTION_DATABASE = "sitesourcery_production";
export const FIN015_INSTALLED_COMMIT =
  "420bd8a424da3331514723d40b5be9fb5131dfe3";
export const FIN015_INSTALLED_TREE =
  "b118539b060254c663cb55325a8ec4a12d8ed24c";
export const FIN015_INSTALLED_EPOCH =
  "fin012-installed-truth-420bd8a-20260825";
export const FIN015_CANDIDATE_COMMIT =
  "8e59f2e9d776dbebbb705d11fcc938beadd7b9cd";
export const FIN015_CANDIDATE_TREE =
  "fe60dcd949ccc1a5004d1d0a5184ee000a7542b4";
export const FIN015_HELD_CONTROL_COMMIT =
  "961107c823d492457596c4f1830ddcf88b355676";
export const FIN015_HELD_CONTROL_TREE =
  "525a71b1d8d305fcfe83fb876238a591cf090b1e";
export const FIN015_SUCCESSOR_INPUT_SHA256 =
  "8b19c2037baa3c0f1e0f61e55c4b9c0e5d6ac6379e34d9af3736fe66faa27c3d";
export const FIN015_SUCCESSOR_INPUT_DIGEST =
  "73aa814666e3aef44f6e1f9ef99035094ac722a1b7051a3a21d224af93a1e20e";
export const FIN015_CI_FINAL_RECEIPT_FILE_SHA256 =
  "38d818dc7cb10855f92dbf4440ebff27ab28abefb2e8b6c40239dbe92b212158";
export const FIN015_CI_FINAL_RECEIPT_DIGEST =
  "04a614a7c2fa9c50912cafbe01692013bde062a8f8ba912973d62ec84a256faa";
export const FIN015_PREDECESSOR_SCHEMA_SHA256 =
  "2b1034e6e9ef99e27d6941b07b1fb29f8dd4ecead3637ef498850ad877ce2189";
export const FIN015_SUCCESSOR_SCHEMA_SHA256 =
  "63e9c1d2066fa461d65244773465becf4719610b911afacddaf3bddf3e7095f0";
export const FIN015_PREDECESSOR_MIGRATION_MANIFEST_SHA256 =
  "20c34dc420109ebdb752539cf0acbd12d1319875f565db9b7b5290039bee3f2b";
export const FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256 =
  "c6e7b001884c263b9b4d011333d547d2177e68ea9d300e1134a12b2c67bafa56";
export const FIN015_INSTALLED_ARTIFACT_MANIFEST_SHA256 =
  "dfff4b9b34553abe78c0d5bdc441d9264ab23883f94bdbadd2bee347285f34f3";
export const FIN015_ROLLBACK_ARTIFACT_MANIFEST_SHA256 =
  "b4cd31821d8755c8c7ea444f3b175e89f5072a7183aa42385034ef2aa3a55be0";
export const FIN015_PREDECESSOR_MIGRATION_COUNT = 98;
export const FIN015_SUCCESSOR_MIGRATION_COUNT = 102;
export const FIN015_PREDECESSOR_TABLE_COUNT = 294;
export const FIN015_SUCCESSOR_TABLE_COUNT = 299;
export const FIN015_UPGRADE_RECEIPT_PATH =
  "/home/simtech/sitesourcery-production/evidence/fin015-protected-upgrade-receipt.json";

export const FIN015_MIGRATIONS = Object.freeze([
  Object.freeze({
    name: "202608260146_responder_twilio_isv_provider_topology.sql",
    byteCount: 20037,
    sha256: "044afa6a2964941ac6169c4802ce3a1493ffffd2f399b199c362b4c2975033a6"
  }),
  Object.freeze({
    name: "202608310147_alakazam_released_policy_authority.sql",
    byteCount: 9646,
    sha256: "f91f4a54b3332a1f42fbd477f077f27c96f9bddd10280822310b6fa5ff5b04e4"
  }),
  Object.freeze({
    name: "202608310148_alakazam_publication_execution_v2.sql",
    byteCount: 11224,
    sha256: "8cfbb88bbc55d91da5f11f1cb98de430e30def1c66d72bec1fa3a1abed8d0b9e"
  }),
  Object.freeze({
    name: "202608310149_hosted_joint_legal_v7_authority.sql",
    byteCount: 20824,
    sha256: "ceece2a05ae21bf2027847f585ea54c86617fce23fe97cb7a01a18a949a14906"
  })
]);

const SHA256 = /^[a-f0-9]{64}$/u;
const CONTROL_WINDOW_MS = 30 * 60 * 1000;
const BACKUP_MAXIMUM_AGE_MS = 60 * 60 * 1000;
const LOCK_CLASS = 1936289138;
const LOCK_OBJECT = 1718579816;
const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const MIGRATION_ROOT = new URL(
  "../server/data-plane/supabase/migrations/",
  import.meta.url
);
const SUCCESSOR_INPUT_PATH =
  "ops/releases/ci-successor-inputs/8e59f2e9d776dbebbb705d11fcc938beadd7b9cd.json";
const CI_RECEIPT_PATH =
  "ops/releases/fin015-production-upgrade-control/ci-held-final-receipt.json";
const SUCCESSOR_TABLES = Object.freeze([
  "responder_twilio_provider_topologies",
  "alakazam_policy_releases",
  "publication_control_releases",
  "publication_control_worker_jobs",
  "publication_control_execution_receipts"
]);

export class Fin015ProtectedUpgradeFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Fin015ProtectedUpgradeFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new Fin015ProtectedUpgradeFailure(code, message);
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
      "FIN015_UPGRADE_CONTROL_INVALID",
      `${label} must contain only its exact reviewed fields.`
    );
  }
  return value;
}

function exact(value, expected, label) {
  if (value !== expected) {
    fail(
      "FIN015_UPGRADE_CONTROL_INVALID",
      `${label} does not match the exact FIN-015 production authority.`
    );
  }
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(
      "FIN015_UPGRADE_CONTROL_INVALID",
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
    fail("FIN015_UPGRADE_CONTROL_INVALID", `${label} must be an ISO instant.`);
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

function assertSnapshot(snapshot, { successor = false } = {}) {
  const expected = successor
    ? {
        tableCount: FIN015_SUCCESSOR_TABLE_COUNT,
        ssTableCount: 298,
        schemaSha256: FIN015_SUCCESSOR_SCHEMA_SHA256,
        label: "299-table FIN-015 successor",
        code: "FIN015_PRODUCTION_SUCCESSOR_INVALID"
      }
    : {
        tableCount: FIN015_PREDECESSOR_TABLE_COUNT,
        ssTableCount: 293,
        schemaSha256: FIN015_PREDECESSOR_SCHEMA_SHA256,
        label: "294-table installed predecessor",
        code: "FIN015_PRODUCTION_PREDECESSOR_INVALID"
      };
  if (
    snapshot.identity.databaseName !== FIN015_PRODUCTION_DATABASE ||
    snapshot.identity.postgresMajor !== 16 ||
    snapshot.totalTableCount !== expected.tableCount ||
    snapshot.tableCounts.ss !== expected.ssTableCount ||
    snapshot.tableCounts.auth !== 1 ||
    snapshot.schemaSha256 !== expected.schemaSha256 ||
    snapshot.ownership.allRelationsOwnedByDatabaseOwner !== true ||
    snapshot.ownership.allRoutinesOwnedByDatabaseOwner !== true
  ) {
    fail(expected.code, `Protected production is not the exact ${expected.label} database shape.`);
  }
  return snapshot;
}

async function readExactJson(projectRoot, relativePath, expectedSha256, label) {
  const bytes = await readFile(path.join(projectRoot, relativePath));
  exact(sha256Bytes(bytes), expectedSha256, `${label} file digest`);
  return parseJsonObject(bytes.toString("utf8"), label);
}

export async function collectFin015ReleaseAuthority({
  projectRoot = PROJECT_ROOT
} = {}) {
  const successorInput = validateCiReleaseSuccessorInput(
    await readExactJson(
      projectRoot,
      SUCCESSOR_INPUT_PATH,
      FIN015_SUCCESSOR_INPUT_SHA256,
      "FIN-015 successor input"
    )
  );
  const ciFinalReceipt = validateCiReleaseFinalReceipt(
    await readExactJson(
      projectRoot,
      CI_RECEIPT_PATH,
      FIN015_CI_FINAL_RECEIPT_FILE_SHA256,
      "FIN-015 held CI final receipt"
    )
  );
  exact(successorInput.digest, FIN015_SUCCESSOR_INPUT_DIGEST, "Successor input");
  exact(ciFinalReceipt.digest, FIN015_CI_FINAL_RECEIPT_DIGEST, "Held CI receipt");
  exact(ciFinalReceipt.candidateSha, FIN015_CANDIDATE_COMMIT, "Held candidate");
  exact(ciFinalReceipt.workflowSha, FIN015_HELD_CONTROL_COMMIT, "Held control");
  exact(
    successorInput.originReleaseInput.epoch.source.treeSha,
    FIN015_CANDIDATE_TREE,
    "Candidate tree"
  );
  exact(
    successorInput.originReleaseInput.epoch.rollback.predecessorCommitSha,
    FIN015_INSTALLED_COMMIT,
    "Installed rollback commit"
  );
  exact(
    successorInput.originReleaseInput.epoch.rollback.predecessorTreeSha,
    FIN015_INSTALLED_TREE,
    "Installed rollback tree"
  );
  exact(
    successorInput.originReleaseInput.epoch.rollback
      .predecessorArtifactManifestSha256,
    FIN015_ROLLBACK_ARTIFACT_MANIFEST_SHA256,
    "Deterministic rollback artifact"
  );
  return freeze({ successorInput, ciFinalReceipt });
}

export async function collectFin015MigrationInventory({
  projectRoot = PROJECT_ROOT
} = {}) {
  const successor = await collectOriginMigrationInventory({
    projectRoot,
    migrationRoot: "server/data-plane/supabase/migrations"
  });
  exact(successor.count, FIN015_SUCCESSOR_MIGRATION_COUNT, "Successor migration count");
  exact(successor.latest, FIN015_MIGRATIONS.at(-1).name, "Successor latest migration");
  exact(
    successor.sha256,
    FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256,
    "Successor migration manifest"
  );
  const selected = successor.files.slice(FIN015_PREDECESSOR_MIGRATION_COUNT);
  exact(
    canonicalJson(
      selected.map((entry) => ({
        name: path.posix.basename(entry.path),
        byteCount: entry.byteCount,
        sha256: entry.sha256
      }))
    ),
    canonicalJson(FIN015_MIGRATIONS),
    "FIN-015 four-file migration delta"
  );
  return freeze({
    predecessor: {
      count: FIN015_PREDECESSOR_MIGRATION_COUNT,
      latest: "202608240145_stripe_checkout_fragment_authority.sql",
      manifestSha256: FIN015_PREDECESSOR_MIGRATION_MANIFEST_SHA256
    },
    successor,
    selected
  });
}

export async function collectFin015ProductionPreflight(pool, options = {}) {
  if (!pool || typeof pool.query !== "function") {
    fail("FIN015_DATABASE_CLIENT_INVALID", "A PostgreSQL client is required.");
  }
  const [authority, inventory] = await Promise.all([
    collectFin015ReleaseAuthority(options),
    collectFin015MigrationInventory(options)
  ]);
  const snapshot = assertSnapshot(
    await collectFin008DatabaseSnapshot(pool, { requireDisposable: false })
  );
  const invariants = await verifyFin008HeldDataInvariants(pool);
  return freeze({
    schema: "sitesourcery.fin015-production-preflight/v1",
    state: "exact_installed_predecessor_ready_for_separate_control",
    capturedAt: new Date().toISOString(),
    source: {
      installedCommitSha: FIN015_INSTALLED_COMMIT,
      installedEpoch: FIN015_INSTALLED_EPOCH,
      candidateCommitSha: FIN015_CANDIDATE_COMMIT,
      candidateTreeSha: FIN015_CANDIDATE_TREE,
      heldControlCommitSha: FIN015_HELD_CONTROL_COMMIT,
      successorInputDigest: authority.successorInput.digest,
      heldCiReceiptDigest: authority.ciFinalReceipt.digest
    },
    database: compactSnapshot(snapshot),
    migrations: {
      beforeCount: inventory.predecessor.count,
      beforeManifestSha256: inventory.predecessor.manifestSha256,
      afterCount: inventory.successor.count,
      afterManifestSha256: inventory.successor.sha256,
      selected: structuredClone(FIN015_MIGRATIONS)
    },
    invariants,
    providerEffects: false,
    paymentEffects: false,
    publicEffects: false,
    mutationPerformed: false
  });
}

export function validateFin015UpgradeControl(control, { now = Date.now() } = {}) {
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
  ], "FIN-015 upgrade control");
  exact(control.schema, FIN015_UPGRADE_CONTROL_SCHEMA, "Control schema");
  exact(control.state, "authorized_held_production_database_upgrade", "Control state");
  const createdAt = instant(control.createdAt, "Control createdAt");
  const expiresAt = instant(control.expiresAt, "Control expiresAt");
  if (
    createdAt > now + 60_000 ||
    expiresAt <= now ||
    expiresAt - createdAt > CONTROL_WINDOW_MS
  ) {
    fail(
      "FIN015_UPGRADE_CONTROL_EXPIRED",
      "The FIN-015 control is expired or outside its 30-minute window."
    );
  }

  exactObject(control.source, [
    "installedCommitSha",
    "installedTreeSha",
    "installedEpoch",
    "candidateCommitSha",
    "candidateTreeSha",
    "heldControlCommitSha",
    "heldControlTreeSha",
    "successorInputSha256",
    "successorInputDigest",
    "heldCiReceiptFileSha256",
    "heldCiReceiptDigest"
  ], "Control source");
  for (const [field, expected] of Object.entries({
    installedCommitSha: FIN015_INSTALLED_COMMIT,
    installedTreeSha: FIN015_INSTALLED_TREE,
    installedEpoch: FIN015_INSTALLED_EPOCH,
    candidateCommitSha: FIN015_CANDIDATE_COMMIT,
    candidateTreeSha: FIN015_CANDIDATE_TREE,
    heldControlCommitSha: FIN015_HELD_CONTROL_COMMIT,
    heldControlTreeSha: FIN015_HELD_CONTROL_TREE,
    successorInputSha256: FIN015_SUCCESSOR_INPUT_SHA256,
    successorInputDigest: FIN015_SUCCESSOR_INPUT_DIGEST,
    heldCiReceiptFileSha256: FIN015_CI_FINAL_RECEIPT_FILE_SHA256,
    heldCiReceiptDigest: FIN015_CI_FINAL_RECEIPT_DIGEST
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
    "migrations"
  ], "Control database");
  exact(control.database.name, FIN015_PRODUCTION_DATABASE, "Database name");
  exact(control.database.beforeSchemaSha256, FIN015_PREDECESSOR_SCHEMA_SHA256, "Before schema");
  digest(control.database.beforeRowCountsSha256, "Before row counts");
  exact(control.database.beforeTotalTableCount, FIN015_PREDECESSOR_TABLE_COUNT, "Before table count");
  exact(control.database.afterSchemaSha256, FIN015_SUCCESSOR_SCHEMA_SHA256, "After schema");
  exact(control.database.afterTotalTableCount, FIN015_SUCCESSOR_TABLE_COUNT, "After table count");
  exact(control.database.beforeMigrationManifestSha256, FIN015_PREDECESSOR_MIGRATION_MANIFEST_SHA256, "Before migrations");
  exact(control.database.afterMigrationManifestSha256, FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256, "After migrations");
  exact(control.database.migrationDeltaCount, FIN015_MIGRATIONS.length, "Migration delta count");
  exact(
    canonicalJson(control.database.migrations),
    canonicalJson(FIN015_MIGRATIONS),
    "Migration delta"
  );

  exactObject(control.backup, [
    "state",
    "completedAt",
    "manifestSha256",
    "databaseCiphertextSha256",
    "appStateCiphertextSha256",
    "destinationFailureDomainId",
    "plaintextRetained",
    "cleanRecoveryVerified",
    "rollbackPairReady",
    "dellZenHashesMatch",
    "providerEgressHeld"
  ], "Control backup");
  exact(control.backup.state, "success", "Backup state");
  const completedAt = instant(control.backup.completedAt, "Backup completedAt");
  if (completedAt > createdAt || createdAt - completedAt > BACKUP_MAXIMUM_AGE_MS) {
    fail("FIN015_BACKUP_NOT_FRESH", "The encrypted rollback backup is not a fresh pre-control success.");
  }
  for (const field of [
    "manifestSha256",
    "databaseCiphertextSha256",
    "appStateCiphertextSha256"
  ]) digest(control.backup[field], `Backup ${field}`);
  exact(control.backup.destinationFailureDomainId, "zen-sitesourcery-backup-01", "Backup destination");
  exact(control.backup.plaintextRetained, false, "Backup plaintext retention");
  for (const field of [
    "cleanRecoveryVerified",
    "rollbackPairReady",
    "dellZenHashesMatch",
    "providerEgressHeld"
  ]) exact(control.backup[field], true, `Backup ${field}`);

  exactObject(control.predecessor, [
    "installedArtifactManifestSha256",
    "rollbackArtifactManifestSha256",
    "runtimeRetained",
    "environmentRetained",
    "evidenceRetained",
    "unitRollbackRetained"
  ], "Control predecessor");
  exact(
    control.predecessor.installedArtifactManifestSha256,
    FIN015_INSTALLED_ARTIFACT_MANIFEST_SHA256,
    "Installed predecessor artifact"
  );
  exact(
    control.predecessor.rollbackArtifactManifestSha256,
    FIN015_ROLLBACK_ARTIFACT_MANIFEST_SHA256,
    "Deterministic rollback artifact"
  );
  for (const field of [
    "runtimeRetained",
    "environmentRetained",
    "evidenceRetained",
    "unitRollbackRetained"
  ]) exact(control.predecessor[field], true, `Predecessor ${field}`);

  exactObject(control.public, [
    "installedCommitSha",
    "installedEpoch",
    "installedStillAuthoritative",
    "cutoverPerformed"
  ], "Control public state");
  exact(control.public.installedCommitSha, FIN015_INSTALLED_COMMIT, "Public installed commit");
  exact(control.public.installedEpoch, FIN015_INSTALLED_EPOCH, "Public installed epoch");
  exact(control.public.installedStillAuthoritative, true, "Public installed authority");
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
    "runtimeInstallSeparate",
    "publicCutoverSeparate",
    "providerEffectsAuthorized",
    "paymentEffectsAuthorized",
    "dnsEffectsAuthorized",
    "customerEffectsAuthorized",
    "legalAcceptanceAuthorized",
    "publicationEffectsAuthorized",
    "retirementAuthorized"
  ], "Control authority");
  exact(
    control.authority.ownerInstruction,
    "owner_exact_fin015_database_upgrade",
    "Owner instruction"
  );
  exact(control.authority.databaseUpgradeAuthorized, true, "Database upgrade authority");
  exact(control.authority.runtimeInstallSeparate, true, "Separate runtime install");
  exact(control.authority.publicCutoverSeparate, true, "Separate public cutover");
  for (const field of [
    "providerEffectsAuthorized",
    "paymentEffectsAuthorized",
    "dnsEffectsAuthorized",
    "customerEffectsAuthorized",
    "legalAcceptanceAuthorized",
    "publicationEffectsAuthorized",
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
      fail("FIN015_PRODUCTION_ROW_LOSS", `Protected production lost predecessor rows from ${relation}.`);
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

export async function verifyFin015SuccessorInvariants(client) {
  const result = await client.query(`
    select
      ss.hosted_responder_twilio_isv_topology_contract_v1() as twilio_contract,
      ss.hosted_alakazam_policy_authority_contract_v2() as alakazam_contract,
      ss.hosted_publication_control_contract_v2() as publication_contract,
      ss.hosted_joint_legal_v7_contract() as legal_contract,
      (select count(*)::integer
         from pg_class relation
         join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'ss'
          and relation.relname = any($1::text[])
          and relation.relkind in ('r', 'p')
          and relation.relrowsecurity
          and relation.relforcerowsecurity) as protected_rls_tables
  `, [SUCCESSOR_TABLES]);
  const facts = result.rows[0];
  const expected = {
    twilioContract: "canonical-responder-twilio-isv-topology-v1-customer-subaccount",
    alakazamContract: "canonical-alakazam-policy-authority-v2-released",
    publicationContract: "canonical-publication-control-v2-released-leased",
    legalContract: "canonical-hosted-joint-legal-v7-authority"
  };
  if (
    facts.twilio_contract !== expected.twilioContract ||
    facts.alakazam_contract !== expected.alakazamContract ||
    facts.publication_contract !== expected.publicationContract ||
    facts.legal_contract !== expected.legalContract ||
    Number(facts.protected_rls_tables) !== SUCCESSOR_TABLES.length
  ) {
    fail(
      "FIN015_SUCCESSOR_INVARIANTS_INVALID",
      "The exact four-migration FIN-015 held successor contract is incomplete."
    );
  }
  return freeze({
    ...expected,
    protectedRlsTables: Number(facts.protected_rls_tables)
  });
}

export async function upgradeFin015ProtectedProduction(pool, {
  control,
  now = Date.now(),
  migrationRoot = MIGRATION_ROOT,
  projectRoot = PROJECT_ROOT,
  snapshot = (client) =>
    collectFin008DatabaseSnapshot(client, { requireDisposable: false }),
  inventory = () => collectFin015MigrationInventory({ projectRoot }),
  releaseAuthority = () => collectFin015ReleaseAuthority({ projectRoot }),
  heldInvariantProof = verifyFin008HeldDataInvariants,
  successorInvariantProof = verifyFin015SuccessorInvariants,
  migrationBytes = (name) => readFile(new URL(name, migrationRoot), "utf8")
} = {}) {
  const authorized = validateFin015UpgradeControl(control, { now });
  if (!pool || typeof pool.connect !== "function") {
    fail("FIN015_DATABASE_CLIENT_INVALID", "A PostgreSQL pool is required.");
  }
  await releaseAuthority();
  const selectedInventory = await inventory();
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("select pg_advisory_lock($1, $2)", [LOCK_CLASS, LOCK_OBJECT]);
    locked = true;
    if (await otherConnections(client) !== 0) {
      fail("FIN015_DATABASE_NOT_QUIESCED", "Protected production has another database connection after quiesce.");
    }
    const before = assertSnapshot(await snapshot(client));
    exact(
      before.rowCountsSha256,
      authorized.database.beforeRowCountsSha256,
      "Authorized predecessor row counts"
    );
    exact(
      selectedInventory.successor.count - selectedInventory.predecessor.count,
      FIN015_MIGRATIONS.length,
      "Migration inventory delta"
    );
    const applied = [];
    for (const migration of FIN015_MIGRATIONS) {
      const bytes = await migrationBytes(migration.name);
      exact(Buffer.byteLength(bytes), migration.byteCount, `${migration.name} byte count`);
      exact(sha256Bytes(bytes), migration.sha256, `${migration.name} digest`);
      try {
        await client.query(bytes);
        applied.push(migration.name);
      } catch (error) {
        await client.query("rollback").catch(() => {});
        fail(
          "FIN015_PRODUCTION_MIGRATION_FAILED",
          `Protected migration failed at ${migration.name} after ${applied.length} completed file(s); restore the paired backup before any predecessor restart. ${error?.code ?? "unknown"}`
        );
      }
    }
    const after = assertSnapshot(await snapshot(client), { successor: true });
    const rowPreservation = verifyNoPredecessorRowLoss(before, after);
    const heldInvariants = await heldInvariantProof(client);
    const successorInvariants = await successorInvariantProof(client);
    if (await otherConnections(client) !== 0) {
      fail("FIN015_DATABASE_NOT_QUIESCED", "A second database connection appeared during the protected upgrade.");
    }
    return freeze({
      schema: FIN015_UPGRADE_RECEIPT_SCHEMA,
      state: "database_upgraded_held_for_separate_runtime_install",
      completedAt: new Date(now).toISOString(),
      controlSha256: sha256Bytes(`${canonicalJson(authorized)}\n`),
      source: structuredClone(authorized.source),
      migrations: {
        beforeCount: selectedInventory.predecessor.count,
        afterCount: selectedInventory.successor.count,
        deltaCount: FIN015_MIGRATIONS.length,
        beforeManifestSha256: selectedInventory.predecessor.manifestSha256,
        afterManifestSha256: selectedInventory.successor.sha256,
        applied: structuredClone(FIN015_MIGRATIONS)
      },
      before: compactSnapshot(before),
      after: compactSnapshot(after),
      rowPreservation,
      invariants: {
        held: heldInvariants,
        successor: successorInvariants
      },
      rollback: {
        pairedBackupManifestSha256: authorized.backup.manifestSha256,
        databaseCiphertextSha256:
          authorized.backup.databaseCiphertextSha256,
        appStateCiphertextSha256:
          authorized.backup.appStateCiphertextSha256,
        destinationFailureDomainId:
          authorized.backup.destinationFailureDomainId,
        installedArtifactManifestSha256:
          authorized.predecessor.installedArtifactManifestSha256,
        rollbackArtifactManifestSha256:
          authorized.predecessor.rollbackArtifactManifestSha256,
        predecessorRestartRequiresDatabaseRestore: true,
        retirementAuthorized: false
      },
      effects: {
        provider: false,
        payment: false,
        public: false,
        dns: false,
        customer: false,
        legalAcceptance: false,
        publication: false,
        runtimeInstall: false,
        runtimeCutover: false
      }
    });
  } finally {
    if (locked) {
      await client.query(
        "select pg_advisory_unlock($1, $2)",
        [LOCK_CLASS, LOCK_OBJECT]
      ).catch(() => {});
    }
    client.release();
  }
}

async function connectionStringFromEnvironment(filePath) {
  const values = parseFin010EnvironmentFile(
    await readFile(filePath, "utf8"),
    "FIN-015 hosted EnvironmentFile"
  );
  return readFin010EnvironmentValue(
    values,
    "SITESOURCERY_DATABASE_URL",
    "FIN-015 hosted EnvironmentFile"
  );
}

function cliArguments(argv) {
  const action = argv[0];
  if (!["preflight", "upgrade"].includes(action)) {
    fail("FIN015_ARGUMENTS_INVALID", "Action must be preflight or upgrade.");
  }
  const values = Object.create(null);
  for (let index = 1; index < argv.length; index += 2) {
    if (values[argv[index]] !== undefined) {
      fail("FIN015_ARGUMENTS_INVALID", "FIN-015 arguments cannot repeat.");
    }
    values[argv[index]] = argv[index + 1];
  }
  if (!path.isAbsolute(values["--environment"] ?? "")) {
    fail("FIN015_ARGUMENTS_INVALID", "--environment must be absolute.");
  }
  if (action === "upgrade") {
    if (!path.isAbsolute(values["--control"] ?? "")) {
      fail("FIN015_ARGUMENTS_INVALID", "--control must be absolute.");
    }
    if (path.resolve(values["--receipt"] ?? "") !== FIN015_UPGRADE_RECEIPT_PATH) {
      fail("FIN015_ARGUMENTS_INVALID", "--receipt must select the exact FIN-015 evidence path.");
    }
  }
  const expected = action === "preflight"
    ? ["--environment"]
    : ["--control", "--environment", "--receipt"];
  if (
    canonicalJson(Object.keys(values).sort()) !== canonicalJson(expected)
  ) {
    fail(
      "FIN015_ARGUMENTS_INVALID",
      "FIN-015 arguments are incomplete or unexpected."
    );
  }
  return { action, values };
}

async function main(argv = process.argv.slice(2)) {
  const { action, values } = cliArguments(argv);
  const pool = new Pool({
    connectionString: await connectionStringFromEnvironment(
      path.resolve(values["--environment"])
    ),
    max: 1,
    application_name: "sitesourcery-fin015-protected-upgrade"
  });
  try {
    if (action === "preflight") {
      process.stdout.write(
        `${canonicalJson(await collectFin015ProductionPreflight(pool))}\n`
      );
      return;
    }
    const receipt = await upgradeFin015ProtectedProduction(pool, {
      control: await readJsonObject(
        path.resolve(values["--control"]),
        "FIN-015 protected-upgrade control"
      )
    });
    const evidence = await writeImmutableEvidence(
      FIN015_UPGRADE_RECEIPT_PATH,
      receipt,
      { mode: 0o400 }
    );
    process.stdout.write(`${canonicalJson({
      schema: FIN015_UPGRADE_RECEIPT_SCHEMA,
      ok: true,
      state: receipt.state,
      receiptPath: evidence.path,
      receiptSha256: evidence.sha256,
      beforeSchemaSha256: receipt.before.schemaSha256,
      afterSchemaSha256: receipt.after.schemaSha256,
      preservedPredecessorRelations:
        receipt.rowPreservation.preservedPredecessorRelations,
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
      schema: FIN015_UPGRADE_RECEIPT_SCHEMA,
      ok: false,
      code: error?.code ?? "FIN015_PROTECTED_UPGRADE_FAILED"
    })}\n`);
    process.exitCode = 1;
  });
}
