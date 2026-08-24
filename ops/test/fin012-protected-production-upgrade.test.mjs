import assert from "node:assert/strict";
import {
  fileURLToPath,
  pathToFileURL
} from "node:url";
import path from "node:path";
import { test } from "node:test";

import {
  FIN012_CANDIDATE_COMMIT,
  FIN012_CANDIDATE_TREE,
  FIN012_CI_FINAL_RECEIPT_DIGEST,
  FIN012_HELD_CONTROL_COMMIT,
  FIN012_PREDECESSOR_COMMIT
} from "../fin012-production-runtime.mjs";
import {
  FIN012_DOWNLOAD_PROTECTION_CONTRACT,
  FIN012_MIGRATION_NAME,
  FIN012_MIGRATION_SHA256,
  FIN012_PREDECESSOR_ARTIFACT_MANIFEST_SHA256,
  FIN012_PREDECESSOR_MIGRATION_MANIFEST_SHA256,
  FIN012_PREDECESSOR_SCHEMA_SHA256,
  FIN012_PRODUCTION_DATABASE,
  FIN012_SUCCESSOR_MIGRATION_MANIFEST_SHA256,
  FIN012_SUCCESSOR_SCHEMA_SHA256,
  FIN012_UPGRADE_CONTROL_SCHEMA,
  Fin012ProtectedUpgradeFailure,
  collectFin012MigrationInventory,
  upgradeFin012ProtectedProduction,
  validateFin012UpgradeControl,
  verifyFin012DownloadProtectionInvariants
} from "../fin012-protected-production-upgrade.mjs";
import {
  materializeHistoricalCandidate
} from "./historical-candidate-fixture.mjs";

const NOW = Date.parse("2026-08-22T20:00:00.000Z");
const BEFORE_ROWS = "1".repeat(64);
const AFTER_ROWS = "2".repeat(64);

function control(overrides = {}) {
  const value = {
    schema: FIN012_UPGRADE_CONTROL_SCHEMA,
    state: "authorized_held_production_upgrade",
    createdAt: "2026-08-22T19:59:00.000Z",
    expiresAt: "2026-08-22T20:20:00.000Z",
    source: {
      predecessorCommitSha: FIN012_PREDECESSOR_COMMIT,
      candidateCommitSha: FIN012_CANDIDATE_COMMIT,
      candidateTreeSha: FIN012_CANDIDATE_TREE,
      heldControlCommitSha: FIN012_HELD_CONTROL_COMMIT,
      heldCiReceiptDigest: FIN012_CI_FINAL_RECEIPT_DIGEST
    },
    database: {
      name: FIN012_PRODUCTION_DATABASE,
      beforeSchemaSha256: FIN012_PREDECESSOR_SCHEMA_SHA256,
      beforeRowCountsSha256: BEFORE_ROWS,
      beforeTotalTableCount: 287,
      afterSchemaSha256: FIN012_SUCCESSOR_SCHEMA_SHA256,
      afterTotalTableCount: 294,
      beforeMigrationManifestSha256: FIN012_PREDECESSOR_MIGRATION_MANIFEST_SHA256,
      afterMigrationManifestSha256: FIN012_SUCCESSOR_MIGRATION_MANIFEST_SHA256,
      migrationDeltaCount: 1,
      migrationName: FIN012_MIGRATION_NAME,
      migrationSha256: FIN012_MIGRATION_SHA256
    },
    backup: {
      state: "success",
      completedAt: "2026-08-22T19:50:00.000Z",
      manifestSha256: "3".repeat(64),
      ciphertextSha256: "4".repeat(64),
      destinationFailureDomainId: "zen-sitesourcery-backup-01",
      plaintextRetained: false,
      cleanRecoveryVerified: true,
      rollbackPairReady: true
    },
    predecessor: {
      artifactManifestSha256: FIN012_PREDECESSOR_ARTIFACT_MANIFEST_SHA256,
      runtimeRetained: true,
      environmentRetained: true,
      evidenceRetained: true,
      unitRollbackRetained: true
    },
    public: {
      predecessorCommitSha: FIN012_PREDECESSOR_COMMIT,
      predecessorStillAuthoritative: true,
      cutoverPerformed: false
    },
    operation: {
      runtimeStopped: true,
      staticStopped: true,
      originStopped: true,
      tunnelStopped: true,
      monitorPaused: true,
      backupTimerPaused: true,
      providerEffectsHeld: true
    },
    authority: {
      ownerInstruction: "complete_through_100",
      databaseUpgradeAuthorized: true,
      runtimeCutoverSeparate: true,
      providerEffectsAuthorized: false,
      paymentEffectsAuthorized: false,
      dnsEffectsAuthorized: false,
      retirementAuthorized: false
    }
  };
  for (const [name, entry] of Object.entries(overrides)) {
    if (
      entry && typeof entry === "object" && !Array.isArray(entry) &&
      value[name] && typeof value[name] === "object"
    ) value[name] = { ...value[name], ...entry };
    else value[name] = entry;
  }
  return value;
}

function snapshot({ successor = false } = {}) {
  const relationCount = successor ? 294 : 287;
  return {
    identity: {
      databaseName: FIN012_PRODUCTION_DATABASE,
      currentUser: "sitesourcery_owner",
      postgresMajor: 16,
      serverVersionNumber: 160014
    },
    ownership: {
      normalizedSha256: (successor ? "6" : "5").repeat(64),
      allRelationsOwnedByDatabaseOwner: true,
      allRoutinesOwnedByDatabaseOwner: true
    },
    tableCounts: successor ? { auth: 1, ss: 293 } : { auth: 1, ss: 286 },
    totalTableCount: relationCount,
    schemaSha256: successor ? FIN012_SUCCESSOR_SCHEMA_SHA256 : FIN012_PREDECESSOR_SCHEMA_SHA256,
    rowCountsSha256: successor ? AFTER_ROWS : BEFORE_ROWS,
    rowCounts: Array.from({ length: relationCount }, (_, index) => ({
      relation: index === 0 ? "auth.users" : `ss.table_${index}`,
      rowCount: "3"
    }))
  };
}

function inventory() {
  return {
    predecessor: {
      count: 95,
      manifestSha256: FIN012_PREDECESSOR_MIGRATION_MANIFEST_SHA256
    },
    successor: {
      count: 96,
      sha256: FIN012_SUCCESSOR_MIGRATION_MANIFEST_SHA256
    },
    selected: {
      path: `server/data-plane/supabase/migrations/${FIN012_MIGRATION_NAME}`,
      sha256: FIN012_MIGRATION_SHA256
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
    release() { queries.push({ sql: "release" }); }
  };
  return {
    queries,
    async connect() { return client; }
  };
}

test("FIN-012 binds the exact 95-to-96 one-file migration inventory", async () => {
  const fixture = await materializeHistoricalCandidate({
    projectRoot: fileURLToPath(
      new URL("../..", import.meta.url)
    ),
    commitSha: FIN012_CANDIDATE_COMMIT,
    treeSha: FIN012_CANDIDATE_TREE,
    label: "fin012-protected-upgrade"
  });
  try {
    const actual = await collectFin012MigrationInventory({
      projectRoot: fixture.candidateRoot,
      migrationRoot: pathToFileURL(
        `${path.join(
          fixture.candidateRoot,
          "server/data-plane/supabase/migrations"
        )}${path.sep}`
      )
    });
    assert.equal(actual.predecessor.count, 95);
    assert.equal(actual.successor.count, 96);
    assert.equal(
      actual.successor.sha256,
      FIN012_SUCCESSOR_MIGRATION_MANIFEST_SHA256
    );
    assert.equal(
      actual.selected.sha256,
      FIN012_MIGRATION_SHA256
    );
  } finally {
    await fixture.cleanup();
  }
});

test("FIN-012 upgrade control binds fresh backup, quiesced services, held providers, and no retirement", () => {
  const value = validateFin012UpgradeControl(control(), { now: NOW });
  assert.equal(value.database.beforeSchemaSha256, FIN012_PREDECESSOR_SCHEMA_SHA256);
  assert.equal(value.database.afterSchemaSha256, FIN012_SUCCESSOR_SCHEMA_SHA256);
  assert.equal(value.database.migrationDeltaCount, 1);
  assert.equal(value.operation.tunnelStopped, true);
  assert.equal(value.authority.paymentEffectsAuthorized, false);
  assert.equal(value.authority.retirementAuthorized, false);
});

test("FIN-012 rejects stale backup, expired authority, live services, and lifted payment authority", () => {
  for (const [value, code] of [
    [control({ expiresAt: "2026-08-22T19:59:59.000Z" }), "FIN012_UPGRADE_CONTROL_EXPIRED"],
    [control({ backup: { completedAt: "2026-08-22T18:00:00.000Z" } }), "FIN012_BACKUP_NOT_FRESH"],
    [control({ operation: { runtimeStopped: false } }), "FIN012_UPGRADE_CONTROL_INVALID"],
    [control({ authority: { paymentEffectsAuthorized: true } }), "FIN012_UPGRADE_CONTROL_INVALID"]
  ]) {
    assert.throws(
      () => validateFin012UpgradeControl(value, { now: NOW }),
      (error) => error instanceof Fin012ProtectedUpgradeFailure && error.code === code
    );
  }
});

test("FIN-012 applies only migration 143 under lock and proves predecessor row preservation", async () => {
  const pool = fakePool();
  let snapshots = 0;
  const receipt = await upgradeFin012ProtectedProduction(pool, {
    control: control(),
    now: NOW,
    snapshot: async () => snapshot({ successor: snapshots++ > 0 }),
    inventory: async () => inventory(),
    heldInvariantProof: async () => ({ lifecycle_state_held: true }),
    protectionInvariantProof: async () => ({
      contract: FIN012_DOWNLOAD_PROTECTION_CONTRACT,
      protectedRlsTables: 7,
      protectionTriggers: 7
    }),
    migrationBytes: async () => "-- exact migration 143"
  });
  assert.equal(receipt.state, "database_upgraded_held_for_runtime_cutover");
  assert.equal(receipt.migrations.deltaCount, 1);
  assert.equal(receipt.before.totalTableCount, 287);
  assert.equal(receipt.after.totalTableCount, 294);
  assert.equal(receipt.rowPreservation.preservedPredecessorRelations, 287);
  assert.equal(receipt.rowPreservation.rowLoss, false);
  assert.deepEqual(Object.values(receipt.effects), [false, false, false, false, false]);
  assert.equal(
    pool.queries.filter((entry) => entry.sql === "-- exact migration 143").length,
    1
  );
  assert.equal(pool.queries.some((entry) => String(entry.sql).includes("pg_advisory_lock")), true);
  assert.equal(pool.queries.some((entry) => String(entry.sql).includes("pg_advisory_unlock")), true);
  assert.equal(pool.queries.at(-1).sql, "release");
});

test("FIN-012 refuses migration while another protected-database connection exists", async () => {
  const pool = fakePool({ otherConnectionCount: 1 });
  await assert.rejects(
    () => upgradeFin012ProtectedProduction(pool, {
      control: control(),
      now: NOW,
      snapshot: async () => snapshot(),
      inventory: async () => inventory(),
      heldInvariantProof: async () => ({}),
      protectionInvariantProof: async () => ({}),
      migrationBytes: async () => "select 1"
    }),
    (error) => error instanceof Fin012ProtectedUpgradeFailure && error.code === "FIN012_DATABASE_NOT_QUIESCED"
  );
  assert.equal(pool.queries.at(-1).sql, "release");
});

test("FIN-012 exact Download protection invariant readback is fail closed", async () => {
  const good = {
    async query() {
      return { rows: [{
        contract: FIN012_DOWNLOAD_PROTECTION_CONTRACT,
        gate_state: "open",
        gate_reason: "owner_approved_protected_launch",
        gate_revision: "1",
        gate_rows: 1,
        protected_rls_tables: 7,
        protection_triggers: 7
      }] };
    }
  };
  assert.equal((await verifyFin012DownloadProtectionInvariants(good)).protectedRlsTables, 7);
  const bad = { async query() { return { rows: [{ ...(await good.query()).rows[0], protection_triggers: 6 }] }; } };
  await assert.rejects(
    () => verifyFin012DownloadProtectionInvariants(bad),
    (error) => error instanceof Fin012ProtectedUpgradeFailure && error.code === "FIN012_DOWNLOAD_PROTECTION_INVALID"
  );
});
