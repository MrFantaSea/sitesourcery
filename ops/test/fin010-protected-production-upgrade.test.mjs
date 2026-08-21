import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIN010_CANDIDATE_COMMIT,
  FIN010_CANDIDATE_TREE,
  FIN010_PREDECESSOR_COMMIT
} from "../fin010-production-runtime.mjs";
import {
  FIN010_MIGRATION_MANIFEST_SHA256,
  FIN010_PREDECESSOR_ARTIFACT_MANIFEST_SHA256,
  FIN010_PREDECESSOR_SCHEMA_SHA256,
  FIN010_PRODUCTION_DATABASE,
  FIN010_PUBLIC_PLACEHOLDER_SHA256,
  FIN010_SUCCESSOR_SCHEMA_SHA256,
  FIN010_UPGRADE_CONTROL_SCHEMA,
  Fin010ProtectedUpgradeFailure,
  upgradeFin010ProtectedProduction,
  validateFin010UpgradeControl
} from "../fin010-protected-production-upgrade.mjs";

const NOW = Date.parse("2026-08-21T12:00:00.000Z");
const BEFORE_ROWS = "1".repeat(64);
const AFTER_ROWS = "2".repeat(64);

function control(overrides = {}) {
  const value = {
    schema: FIN010_UPGRADE_CONTROL_SCHEMA,
    state: "authorized_held_production_upgrade",
    createdAt: "2026-08-21T11:59:00.000Z",
    expiresAt: "2026-08-21T12:20:00.000Z",
    source: {
      predecessorCommitSha: FIN010_PREDECESSOR_COMMIT,
      candidateCommitSha: FIN010_CANDIDATE_COMMIT,
      candidateTreeSha: FIN010_CANDIDATE_TREE
    },
    database: {
      name: FIN010_PRODUCTION_DATABASE,
      beforeSchemaSha256: FIN010_PREDECESSOR_SCHEMA_SHA256,
      beforeRowCountsSha256: BEFORE_ROWS,
      beforeTotalTableCount: 201,
      afterSchemaSha256: FIN010_SUCCESSOR_SCHEMA_SHA256,
      afterTotalTableCount: 287,
      migrationManifestSha256: FIN010_MIGRATION_MANIFEST_SHA256,
      migrationDeltaCount: 37
    },
    backup: {
      state: "success",
      completedAt: "2026-08-21T11:50:00.000Z",
      manifestSha256: "3".repeat(64),
      ciphertextSha256: "4".repeat(64),
      destinationFailureDomainId: "zen-sitesourcery-backup-01",
      plaintextRetained: false,
      cleanRecoveryVerified: true,
      rollbackPairReady: true
    },
    predecessor: {
      artifactManifestSha256:
        FIN010_PREDECESSOR_ARTIFACT_MANIFEST_SHA256,
      runtimeRetained: true,
      environmentRetained: true,
      unitRollbackRetained: true
    },
    public: {
      placeholderSha256: FIN010_PUBLIC_PLACEHOLDER_SHA256,
      placeholderStillAuthoritative: true,
      cutoverPerformed: false
    },
    operation: {
      runtimeStopped: true,
      staticStopped: true,
      originStopped: true,
      workerStopped: true,
      monitorPaused: true,
      backupTimerPaused: true,
      providerEffectsHeld: true
    },
    authority: {
      ownerInstruction: "complete_through_100",
      databaseUpgradeAuthorized: true,
      publicCutoverSeparate: true,
      retirementAuthorized: false
    }
  };
  for (const [name, entry] of Object.entries(overrides)) {
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      value[name] &&
      typeof value[name] === "object"
    ) value[name] = { ...value[name], ...entry };
    else value[name] = entry;
  }
  return value;
}

function snapshot({ successor = false } = {}) {
  const relationCount = successor ? 287 : 201;
  return {
    identity: {
      databaseName: FIN010_PRODUCTION_DATABASE,
      currentUser: "sitesourcery_owner",
      postgresMajor: 16,
      serverVersionNumber: 160014
    },
    ownership: {
      normalizedSha256: (successor ? "6" : "5").repeat(64),
      allRelationsOwnedByDatabaseOwner: true,
      allRoutinesOwnedByDatabaseOwner: true
    },
    tableCounts: successor ? { auth: 1, ss: 286 } : { auth: 1, ss: 200 },
    totalTableCount: relationCount,
    schemaSha256: successor
      ? FIN010_SUCCESSOR_SCHEMA_SHA256
      : FIN010_PREDECESSOR_SCHEMA_SHA256,
    rowCountsSha256: successor ? AFTER_ROWS : BEFORE_ROWS,
    rowCounts: Array.from({ length: relationCount }, (_, index) => ({
      relation: index === 0 ? "auth.users" : `ss.table_${index}`,
      rowCount: index === 1 && successor ? "4" : "3"
    }))
  };
}

function inventory() {
  return {
    count: 95,
    latest: "202608200142_hosted_joint_legal_v5_authority.sql",
    manifestSha256: FIN010_MIGRATION_MANIFEST_SHA256,
    delta: {
      count: 37,
      manifestSha256: "7".repeat(64),
      entries: Array.from({ length: 37 }, (_, index) => ({
        name: `20260820${String(index).padStart(4, "0")}_fixture.sql`
      }))
    }
  };
}

function fakePool({ otherConnectionCount = 0 } = {}) {
  const queries = [];
  const client = {
    async query(sql, parameters) {
      queries.push({ sql, parameters });
      if (String(sql).includes("from pg_stat_activity")) {
        return { rows: [{ count: otherConnectionCount }] };
      }
      return { rows: [] };
    },
    release() {
      queries.push({ sql: "release" });
    }
  };
  return {
    queries,
    async connect() {
      return client;
    }
  };
}

test("FIN-010 protected-upgrade control binds fresh backup, exact data epochs, holds, and no retirement", () => {
  const value = validateFin010UpgradeControl(control(), { now: NOW });
  assert.equal(value.database.name, FIN010_PRODUCTION_DATABASE);
  assert.equal(value.database.beforeSchemaSha256, FIN010_PREDECESSOR_SCHEMA_SHA256);
  assert.equal(value.database.afterSchemaSha256, FIN010_SUCCESSOR_SCHEMA_SHA256);
  assert.equal(value.backup.rollbackPairReady, true);
  assert.equal(value.public.cutoverPerformed, false);
  assert.equal(value.authority.retirementAuthorized, false);
});

test("FIN-010 rejects stale backup, expired authority, unsafe operation, and wrong database", () => {
  for (const [value, code] of [
    [control({ expiresAt: "2026-08-21T11:59:59.000Z" }), "FIN010_UPGRADE_CONTROL_EXPIRED"],
    [control({ backup: { completedAt: "2026-08-21T10:00:00.000Z" } }), "FIN010_BACKUP_NOT_FRESH"],
    [control({ operation: { runtimeStopped: false } }), "FIN010_UPGRADE_CONTROL_INVALID"],
    [control({ database: { name: "postgres" } }), "FIN010_UPGRADE_CONTROL_INVALID"]
  ]) {
    assert.throws(
      () => validateFin010UpgradeControl(value, { now: NOW }),
      (error) =>
        error instanceof Fin010ProtectedUpgradeFailure &&
        error.code === code
    );
  }
});

test("FIN-010 applies only the exact 37-file delta under a database lock and proves row preservation", async () => {
  const pool = fakePool();
  let snapshots = 0;
  const receipt = await upgradeFin010ProtectedProduction(pool, {
    control: control(),
    now: NOW,
    snapshot: async () => snapshot({ successor: snapshots++ > 0 }),
    inventory: async () => inventory(),
    invariantProof: async () => ({
      service_role_bypass_rls: true,
      authenticated_no_bypass_rls: true,
      every_rls_table_forced: true,
      lifecycle_state_held: true,
      lifecycle_commands_held: true
    }),
    migrationBytes: async (name) => `-- ${name}`
  });
  assert.equal(receipt.state, "upgraded_production_held");
  assert.equal(receipt.migrations.deltaCount, 37);
  assert.equal(receipt.before.totalTableCount, 201);
  assert.equal(receipt.after.totalTableCount, 287);
  assert.equal(receipt.rowPreservation.preservedPredecessorRelations, 201);
  assert.equal(receipt.rowPreservation.changedRelationCount, 1);
  assert.equal(receipt.rollback.predecessorRestartRequiresDatabaseRestore, true);
  assert.deepEqual(Object.values(receipt.effects), [false, false, false, false]);
  assert.equal(
    pool.queries.filter((entry) => String(entry.sql).startsWith("-- 20260820")).length,
    37
  );
  assert.equal(
    pool.queries.some((entry) => String(entry.sql).includes("pg_advisory_lock")),
    true
  );
  assert.equal(
    pool.queries.some((entry) => String(entry.sql).includes("pg_advisory_unlock")),
    true
  );
  assert.equal(pool.queries.at(-1).sql, "release");
});

test("FIN-010 refuses migration while another protected-database connection exists", async () => {
  const pool = fakePool({ otherConnectionCount: 1 });
  await assert.rejects(
    () => upgradeFin010ProtectedProduction(pool, {
      control: control(),
      now: NOW,
      snapshot: async () => snapshot(),
      inventory: async () => inventory(),
      invariantProof: async () => ({}),
      migrationBytes: async () => "select 1"
    }),
    (error) =>
      error instanceof Fin010ProtectedUpgradeFailure &&
      error.code === "FIN010_DATABASE_NOT_QUIESCED"
  );
  assert.equal(
    pool.queries.some((entry) => String(entry.sql).includes("pg_advisory_unlock")),
    true
  );
  assert.equal(pool.queries.at(-1).sql, "release");
});
