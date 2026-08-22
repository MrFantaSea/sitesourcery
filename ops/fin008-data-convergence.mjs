#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import pg from "pg";

import {
  canonicalJson,
  sha256Bytes
} from "./immutable-evidence.mjs";

const { Pool } = pg;

export const FIN008_CONVERGENCE_SCHEMA =
  "sitesourcery.fin008-data-convergence/v1";
export const FIN008_PREDECESSOR_COMMIT =
  "84aca6b757a806b428ae0cce8115c12dcc6486cd";
export const FIN008_PREDECESSOR_MIGRATION_COUNT = 58;
export const FIN008_PREDECESSOR_LATEST_MIGRATION =
  "202608090105_hosted_joint_legal_v4_authority.sql";
export const FIN008_EXPECTED_MIGRATION_COUNT = 95;
export const FIN008_EXPECTED_LATEST_MIGRATION =
  "202608200142_hosted_joint_legal_v5_authority.sql";

const MIGRATIONS = new URL(
  "../server/data-plane/supabase/migrations/",
  import.meta.url
);
const MIGRATION_NAME = /^[0-9]{12}_[a-z0-9_]+\.sql$/u;
const DISPOSABLE_DATABASE =
  /^ss_fin008_[a-z0-9][a-z0-9_]{7,95}$/u;
const SYSTEM_SCHEMAS = Object.freeze([
  "information_schema",
  "pg_catalog",
  "pg_toast"
]);

export class Fin008ConvergenceFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Fin008ConvergenceFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new Fin008ConvergenceFailure(code, message);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

function digest(value) {
  return sha256Bytes(canonicalJson(value));
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sortedRows(rows) {
  return [...rows].sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right), "en")
  );
}

export function assertFin008DisposableDatabaseName(value) {
  if (typeof value !== "string" || !DISPOSABLE_DATABASE.test(value)) {
    fail(
      "FIN008_DATABASE_NOT_DISPOSABLE",
      "FIN-008 may mutate only an explicitly named ss_fin008_* disposable database."
    );
  }
  return value;
}

export async function collectFin008MigrationInventory({
  migrationRoot = MIGRATIONS
} = {}) {
  const observedNames = (await readdir(migrationRoot))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (
    observedNames.length < FIN008_EXPECTED_MIGRATION_COUNT ||
    observedNames[FIN008_EXPECTED_MIGRATION_COUNT - 1] !==
      FIN008_EXPECTED_LATEST_MIGRATION ||
    observedNames.some((name) => !MIGRATION_NAME.test(name))
  ) {
    fail(
      "FIN008_MIGRATION_INVENTORY_DRIFT",
      "The candidate migration inventory does not match the frozen FIN-008 denominator."
    );
  }
  const names = observedNames.slice(
    0,
    FIN008_EXPECTED_MIGRATION_COUNT
  );
  const entries = [];
  for (const name of names) {
    const bytes = await readFile(new URL(name, migrationRoot));
    entries.push(freeze({
      name,
      byteCount: bytes.byteLength,
      sha256: sha256Bytes(bytes)
    }));
  }
  const predecessor = entries.slice(
    0,
    FIN008_PREDECESSOR_MIGRATION_COUNT
  );
  if (
    predecessor.length !== FIN008_PREDECESSOR_MIGRATION_COUNT ||
    predecessor.at(-1)?.name !== FIN008_PREDECESSOR_LATEST_MIGRATION
  ) {
    fail(
      "FIN008_PREDECESSOR_PREFIX_DRIFT",
      "The immutable predecessor is not the frozen 58-migration prefix."
    );
  }
  const delta = entries.slice(FIN008_PREDECESSOR_MIGRATION_COUNT);
  return freeze({
    count: entries.length,
    latest: entries.at(-1).name,
    manifestSha256: digest(entries),
    entries,
    predecessor: {
      commitSha: FIN008_PREDECESSOR_COMMIT,
      count: predecessor.length,
      latest: predecessor.at(-1).name,
      manifestSha256: digest(predecessor),
      entries: predecessor
    },
    delta: {
      count: delta.length,
      first: delta.at(0).name,
      latest: delta.at(-1).name,
      manifestSha256: digest(delta),
      entries: delta
    }
  });
}

async function databaseIdentity(pool) {
  const result = await pool.query(`
    select
      current_database() as database_name,
      current_user as current_user,
      current_setting('server_version_num')::integer as server_version_num
  `);
  const row = result.rows[0];
  const major = Math.floor(Number(row.server_version_num) / 10_000);
  if (major !== 16) {
    fail(
      "FIN008_POSTGRES_VERSION_INVALID",
      "FIN-008 requires PostgreSQL 16."
    );
  }
  return freeze({
    databaseName: row.database_name,
    currentUser: row.current_user,
    postgresMajor: major,
    serverVersionNumber: Number(row.server_version_num)
  });
}

async function exactTableRows(pool, relations) {
  const entries = [];
  for (const relation of relations) {
    const result = await pool.query(
      `select count(*)::text as row_count from ` +
      `${quoteIdentifier(relation.schemaName)}.` +
      `${quoteIdentifier(relation.relationName)}`
    );
    entries.push({
      relation: `${relation.schemaName}.${relation.relationName}`,
      rowCount: result.rows[0].row_count
    });
  }
  return sortedRows(entries);
}

async function collectMetadata(pool) {
  const excluded = SYSTEM_SCHEMAS;
  const relations = sortedRows((await pool.query(`
    select
      namespace.nspname as "schemaName",
      relation.relname as "relationName",
      relation.relkind as "relationKind",
      owner.rolname as "ownerName",
      relation.relpersistence as persistence,
      relation.relrowsecurity as "rowSecurity",
      relation.relforcerowsecurity as "forceRowSecurity"
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_roles owner on owner.oid = relation.relowner
    where relation.relkind in ('r', 'p', 'S', 'v', 'm')
      and namespace.nspname <> all($1::text[])
      and namespace.nspname not like 'pg_temp_%'
      and namespace.nspname not like 'pg_toast_temp_%'
    order by namespace.nspname, relation.relname, relation.relkind
  `, [excluded])).rows);
  const columns = sortedRows((await pool.query(`
    select
      namespace.nspname as "schemaName",
      relation.relname as "relationName",
      attribute.attnum as position,
      attribute.attname as "columnName",
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as "dataType",
      attribute.attnotnull as "notNull",
      attribute.attidentity as identity,
      attribute.attgenerated as generated,
      pg_get_expr(default_value.adbin, default_value.adrelid) as "defaultExpression"
    from pg_attribute attribute
    join pg_class relation on relation.oid = attribute.attrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    left join pg_attrdef default_value
      on default_value.adrelid = attribute.attrelid
     and default_value.adnum = attribute.attnum
    where attribute.attnum > 0
      and not attribute.attisdropped
      and relation.relkind in ('r', 'p', 'v', 'm')
      and namespace.nspname <> all($1::text[])
      and namespace.nspname not like 'pg_temp_%'
      and namespace.nspname not like 'pg_toast_temp_%'
    order by namespace.nspname, relation.relname, attribute.attnum
  `, [excluded])).rows);
  const constraints = sortedRows((await pool.query(`
    select
      namespace.nspname as "schemaName",
      relation.relname as "relationName",
      constraint_value.conname as "constraintName",
      constraint_value.contype as "constraintType",
      constraint_value.condeferrable as deferrable,
      constraint_value.condeferred as deferred,
      constraint_value.convalidated as validated,
      pg_get_constraintdef(constraint_value.oid, true) as definition
    from pg_constraint constraint_value
    join pg_class relation on relation.oid = constraint_value.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname <> all($1::text[])
      and namespace.nspname not like 'pg_temp_%'
    order by namespace.nspname, relation.relname, constraint_value.conname
  `, [excluded])).rows);
  const indexes = sortedRows((await pool.query(`
    select
      schemaname as "schemaName",
      tablename as "relationName",
      indexname as "indexName",
      indexdef as definition
    from pg_indexes
    where schemaname <> all($1::text[])
      and schemaname not like 'pg_temp_%'
    order by schemaname, tablename, indexname
  `, [excluded])).rows);
  const triggers = sortedRows((await pool.query(`
    select
      namespace.nspname as "schemaName",
      relation.relname as "relationName",
      trigger_value.tgname as "triggerName",
      trigger_value.tgenabled as enabled,
      pg_get_triggerdef(trigger_value.oid, true) as definition
    from pg_trigger trigger_value
    join pg_class relation on relation.oid = trigger_value.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where not trigger_value.tgisinternal
      and namespace.nspname <> all($1::text[])
      and namespace.nspname not like 'pg_temp_%'
    order by namespace.nspname, relation.relname, trigger_value.tgname
  `, [excluded])).rows);
  const policies = sortedRows((await pool.query(`
    select
      schemaname as "schemaName",
      tablename as "relationName",
      policyname as "policyName",
      permissive,
      roles,
      cmd,
      qual,
      with_check as "withCheck"
    from pg_policies
    where schemaname <> all($1::text[])
    order by schemaname, tablename, policyname
  `, [excluded])).rows);
  const routines = sortedRows((await pool.query(`
    select
      namespace.nspname as "schemaName",
      procedure_value.oid::regprocedure::text as signature,
      owner.rolname as "ownerName",
      language.lanname as language,
      procedure_value.prosecdef as "securityDefiner",
      procedure_value.provolatile as volatility,
      procedure_value.proisstrict as strict,
      procedure_value.proparallel as parallel,
      procedure_value.proconfig as configuration,
      pg_get_functiondef(procedure_value.oid) as definition
    from pg_proc procedure_value
    join pg_namespace namespace on namespace.oid = procedure_value.pronamespace
    join pg_roles owner on owner.oid = procedure_value.proowner
    join pg_language language on language.oid = procedure_value.prolang
    where namespace.nspname <> all($1::text[])
      and namespace.nspname not like 'pg_temp_%'
    order by namespace.nspname, procedure_value.oid::regprocedure::text
  `, [excluded])).rows);
  const enums = sortedRows((await pool.query(`
    select
      namespace.nspname as "schemaName",
      type_value.typname as "typeName",
      enum_value.enumsortorder::text as "sortOrder",
      enum_value.enumlabel as label
    from pg_enum enum_value
    join pg_type type_value on type_value.oid = enum_value.enumtypid
    join pg_namespace namespace on namespace.oid = type_value.typnamespace
    where namespace.nspname <> all($1::text[])
    order by namespace.nspname, type_value.typname, enum_value.enumsortorder
  `, [excluded])).rows);
  const tablePrivileges = sortedRows((await pool.query(`
    select
      grantee,
      table_schema as "schemaName",
      table_name as "relationName",
      privilege_type as privilege,
      is_grantable as "isGrantable"
    from information_schema.table_privileges
    where table_schema <> all($1::text[])
    order by grantee, table_schema, table_name, privilege_type
  `, [excluded])).rows);
  return freeze({
    relations,
    columns,
    constraints,
    indexes,
    triggers,
    policies,
    routines,
    enums,
    tablePrivileges
  });
}

export async function collectFin008DatabaseSnapshot(pool, {
  requireDisposable = true
} = {}) {
  const identity = await databaseIdentity(pool);
  if (requireDisposable) {
    assertFin008DisposableDatabaseName(identity.databaseName);
  }
  const metadata = await collectMetadata(pool);
  const normalizedMetadata = structuredClone(metadata);
  for (const entry of [
    ...normalizedMetadata.relations,
    ...normalizedMetadata.routines
  ]) {
    if (entry.ownerName === identity.currentUser) {
      entry.ownerName = "database_owner";
    }
  }
  for (const entry of normalizedMetadata.tablePrivileges) {
    if (entry.grantee === identity.currentUser) {
      entry.grantee = "database_owner";
    }
  }
  normalizedMetadata.tablePrivileges = sortedRows(
    normalizedMetadata.tablePrivileges
  );
  const ownership = freeze({
    databaseOwner: identity.currentUser,
    relationCount: metadata.relations.length,
    routineCount: metadata.routines.length,
    allRelationsOwnedByDatabaseOwner: metadata.relations.every(
      (entry) => entry.ownerName === identity.currentUser
    ),
    allRoutinesOwnedByDatabaseOwner: metadata.routines.every(
      (entry) => entry.ownerName === identity.currentUser
    ),
    normalizedSha256: digest({
      relations: normalizedMetadata.relations.map((entry) => ({
        schemaName: entry.schemaName,
        relationName: entry.relationName,
        relationKind: entry.relationKind,
        ownerName: entry.ownerName
      })),
      routines: normalizedMetadata.routines.map((entry) => ({
        schemaName: entry.schemaName,
        signature: entry.signature,
        ownerName: entry.ownerName
      }))
    })
  });
  if (
    !ownership.allRelationsOwnedByDatabaseOwner ||
    !ownership.allRoutinesOwnedByDatabaseOwner
  ) {
    fail(
      "FIN008_OBJECT_OWNERSHIP_INVALID",
      "Every restored application object must be owned by the clean-room database owner."
    );
  }
  const baseRelations = metadata.relations.filter((entry) =>
    entry.relationKind === "r" || entry.relationKind === "p"
  );
  const rowCounts = await exactTableRows(pool, baseRelations);
  const tableCounts = Object.fromEntries(
    [...new Set(baseRelations.map((entry) => entry.schemaName))]
      .sort()
      .map((schemaName) => [
        schemaName,
        baseRelations.filter((entry) => entry.schemaName === schemaName).length
      ])
  );
  return freeze({
    schema: FIN008_CONVERGENCE_SCHEMA,
    identity,
    ownership,
    tableCounts,
    totalTableCount: baseRelations.length,
    schemaSha256: digest(normalizedMetadata),
    metadataSha256: Object.fromEntries(
      Object.entries(normalizedMetadata).map(([key, value]) => [
        key,
        digest(value)
      ])
    ),
    rowCountsSha256: digest(rowCounts),
    rowCounts,
    metadataCounts: Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, value.length])
    )
  });
}

export async function verifyFin008HeldDataInvariants(pool) {
  const result = await pool.query(`
    select
      exists (
        select 1 from pg_roles
         where rolname = 'service_role' and rolbypassrls
      ) as service_role_bypass_rls,
      exists (
        select 1 from pg_roles
         where rolname = 'authenticated' and not rolbypassrls
      ) as authenticated_no_bypass_rls,
      to_regclass('ss.adjacent_integration_crosswalks') is not null
        as identity_crosswalks_present,
      to_regclass('ss.domain_provider_lifecycle_states') is not null
        as lifecycle_state_present,
      to_regclass('ss.domain_provider_lifecycle_commands') is not null
        as lifecycle_commands_present,
      not exists (
        select 1 from ss.domain_provider_lifecycle_states
         where state_document @? '$.**.providerEffectsAuthorized ? (@ == true)'
            or state_document @? '$.**.paymentEffectsAuthorized ? (@ == true)'
            or state_document @? '$.**.dnsEffectsAuthorized ? (@ == true)'
      ) as lifecycle_state_held,
      not exists (
        select 1 from ss.domain_provider_lifecycle_commands
         where jsonb_path_exists(result_document, '$.**.providerReference')
            or jsonb_path_exists(result_document, '$.**.providerQuoteRef')
            or jsonb_path_exists(result_document, '$.**.operationId')
            or result_document @? '$.**.providerEffectsAuthorized ? (@ == true)'
            or result_document @? '$.**.paymentEffectsAuthorized ? (@ == true)'
            or result_document @? '$.**.dnsEffectsAuthorized ? (@ == true)'
      ) as lifecycle_commands_held,
      not exists (
        select 1
          from pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relkind in ('r', 'p')
           and relation.relrowsecurity
           and not relation.relforcerowsecurity
      ) as every_rls_table_forced
  `);
  const facts = result.rows[0];
  for (const [name, value] of Object.entries(facts)) {
    if (value !== true) {
      fail(
        "FIN008_HELD_DATA_INVARIANT_FAILED",
        `FIN-008 held data invariant failed: ${name}.`
      );
    }
  }
  return freeze(facts);
}

export async function upgradeFin008Predecessor(pool, {
  migrationRoot = MIGRATIONS,
  expectedPredecessorSchemaSha256 = null
} = {}) {
  const identity = await databaseIdentity(pool);
  assertFin008DisposableDatabaseName(identity.databaseName);
  const before = await collectFin008DatabaseSnapshot(pool);
  if (
    before.totalTableCount !== 201 ||
    before.tableCounts.ss !== 200 ||
    before.tableCounts.auth !== 1
  ) {
    fail(
      "FIN008_PREDECESSOR_SCHEMA_INVALID",
      "The restored predecessor is not the exact protected 201-table shape."
    );
  }
  if (
    expectedPredecessorSchemaSha256 !== null &&
    before.schemaSha256 !== expectedPredecessorSchemaSha256
  ) {
    fail(
      "FIN008_PREDECESSOR_FINGERPRINT_DRIFT",
      "The restored predecessor schema fingerprint changed before upgrade."
    );
  }
  const inventory = await collectFin008MigrationInventory({ migrationRoot });
  for (const migration of inventory.delta.entries) {
    try {
      await pool.query(
        await readFile(new URL(migration.name, migrationRoot), "utf8")
      );
    } catch (error) {
      error.message = `${migration.name}: ${error.message}`;
      throw error;
    }
  }
  const after = await collectFin008DatabaseSnapshot(pool);
  const beforeRows = new Map(
    before.rowCounts.map((entry) => [entry.relation, BigInt(entry.rowCount)])
  );
  const afterRows = new Map(
    after.rowCounts.map((entry) => [entry.relation, BigInt(entry.rowCount)])
  );
  const rowChanges = [];
  for (const [relation, rowCount] of beforeRows) {
    const next = afterRows.get(relation);
    if (next === undefined || next < rowCount) {
      fail(
        "FIN008_PREDECESSOR_ROW_LOSS",
        `The upgraded rehearsal lost rows from ${relation}.`
      );
    }
    if (next !== rowCount) {
      rowChanges.push({
        relation,
        before: rowCount.toString(),
        after: next.toString()
      });
    }
  }
  const invariants = await verifyFin008HeldDataInvariants(pool);
  return freeze({
    schema: FIN008_CONVERGENCE_SCHEMA,
    mode: "predecessor_upgrade",
    databaseName: identity.databaseName,
    inventory: {
      count: inventory.count,
      latest: inventory.latest,
      manifestSha256: inventory.manifestSha256,
      predecessorCount: inventory.predecessor.count,
      predecessorManifestSha256:
        inventory.predecessor.manifestSha256,
      deltaCount: inventory.delta.count,
      deltaManifestSha256: inventory.delta.manifestSha256
    },
    before,
    after,
    preservedPredecessorRelations: before.rowCounts.length,
    predecessorRowChanges: sortedRows(rowChanges),
    invariants,
    providerEffects: false,
    sourceDatabaseMutated: false
  });
}

export async function compareFin008SchemaConvergence({
  freshPool,
  upgradedPool
}) {
  const fresh = await collectFin008DatabaseSnapshot(freshPool);
  const upgraded = await collectFin008DatabaseSnapshot(upgradedPool);
  if (fresh.schemaSha256 !== upgraded.schemaSha256) {
    const drift = Object.keys(fresh.metadataSha256).filter(
      (key) =>
        fresh.metadataSha256[key] !== upgraded.metadataSha256[key]
    );
    fail(
      "FIN008_SCHEMA_DID_NOT_CONVERGE",
      "Fresh and predecessor-upgraded schemas do not have the same canonical identity" +
        `; drift: ${drift.join(", ")}.`
    );
  }
  return freeze({
    schema: FIN008_CONVERGENCE_SCHEMA,
    mode: "schema_convergence",
    schemaSha256: fresh.schemaSha256,
    freshDatabaseName: fresh.identity.databaseName,
    upgradedDatabaseName: upgraded.identity.databaseName,
    totalTableCount: fresh.totalTableCount,
    tableCounts: fresh.tableCounts,
    metadataCounts: fresh.metadataCounts,
    converged: true,
    providerEffects: false
  });
}

function requiredEnvironment(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    fail("FIN008_ENVIRONMENT_MISSING", `${name} is required.`);
  }
  return value;
}

async function withPool(connectionString, callback) {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

async function main({
  argv = process.argv.slice(2),
  environment = process.env,
  writeOutput = (value) => process.stdout.write(value)
} = {}) {
  const action = argv[0] ?? "inventory";
  let result;
  if (action === "inventory") {
    result = await collectFin008MigrationInventory();
  } else if (action === "snapshot") {
    result = await withPool(
      requiredEnvironment(environment, "SITESOURCERY_FIN008_DATABASE_URL"),
      (pool) => collectFin008DatabaseSnapshot(pool)
    );
  } else if (action === "upgrade") {
    result = await withPool(
      requiredEnvironment(environment, "SITESOURCERY_FIN008_DATABASE_URL"),
      (pool) => upgradeFin008Predecessor(pool, {
        expectedPredecessorSchemaSha256:
          environment.SITESOURCERY_FIN008_PREDECESSOR_SCHEMA_SHA256 ?? null
      })
    );
  } else if (action === "verify") {
    result = await withPool(
      requiredEnvironment(environment, "SITESOURCERY_FIN008_DATABASE_URL"),
      async (pool) => ({
        snapshot: await collectFin008DatabaseSnapshot(pool),
        invariants: await verifyFin008HeldDataInvariants(pool),
        providerEffects: false
      })
    );
  } else if (action === "compare") {
    const freshUrl = requiredEnvironment(
      environment,
      "SITESOURCERY_FIN008_FRESH_DATABASE_URL"
    );
    const upgradedUrl = requiredEnvironment(
      environment,
      "SITESOURCERY_FIN008_UPGRADED_DATABASE_URL"
    );
    const freshPool = new Pool({ connectionString: freshUrl, max: 1 });
    const upgradedPool = new Pool({ connectionString: upgradedUrl, max: 1 });
    try {
      result = await compareFin008SchemaConvergence({
        freshPool,
        upgradedPool
      });
    } finally {
      await Promise.all([freshPool.end(), upgradedPool.end()]);
    }
  } else {
    fail(
      "FIN008_ACTION_INVALID",
      "FIN-008 action must be inventory, snapshot, upgrade, verify, or compare."
    );
  }
  const compactSnapshot = (snapshot) => ({
    identity: snapshot.identity,
    ownership: snapshot.ownership,
    tableCounts: snapshot.tableCounts,
    totalTableCount: snapshot.totalTableCount,
    schemaSha256: snapshot.schemaSha256,
    metadataSha256: snapshot.metadataSha256,
    rowCountsSha256: snapshot.rowCountsSha256,
    metadataCounts: snapshot.metadataCounts
  });
  let output = result;
  if (action === "inventory") {
    output = {
      count: result.count,
      latest: result.latest,
      manifestSha256: result.manifestSha256,
      predecessor: {
        commitSha: result.predecessor.commitSha,
        count: result.predecessor.count,
        latest: result.predecessor.latest,
        manifestSha256: result.predecessor.manifestSha256
      },
      delta: {
        count: result.delta.count,
        first: result.delta.first,
        latest: result.delta.latest,
        manifestSha256: result.delta.manifestSha256
      }
    };
  } else if (action === "snapshot") {
    output = compactSnapshot(result);
  } else if (action === "verify") {
    output = {
      snapshot: compactSnapshot(result.snapshot),
      invariants: result.invariants,
      providerEffects: result.providerEffects
    };
  } else if (action === "upgrade") {
    output = {
      schema: result.schema,
      mode: result.mode,
      databaseName: result.databaseName,
      inventory: result.inventory,
      before: compactSnapshot(result.before),
      after: compactSnapshot(result.after),
      preservedPredecessorRelations:
        result.preservedPredecessorRelations,
      predecessorRowChanges: result.predecessorRowChanges,
      invariants: result.invariants,
      providerEffects: result.providerEffects,
      sourceDatabaseMutated: result.sourceDatabaseMutated
    };
  }
  writeOutput(`${canonicalJson(output)}\n`);
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${canonicalJson({
      ok: false,
      code: error?.code ?? "FIN008_CONVERGENCE_FAILED",
      message: error?.message ?? "FIN-008 convergence failed."
    })}\n`);
    process.exitCode = 1;
  });
}
