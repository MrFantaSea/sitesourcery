import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIN015_CANDIDATE_COMMIT,
  FIN015_CANDIDATE_TREE,
  FIN015_CI_FINAL_RECEIPT_DIGEST,
  FIN015_CI_FINAL_RECEIPT_FILE_SHA256,
  FIN015_HELD_CONTROL_COMMIT,
  FIN015_HELD_CONTROL_TREE,
  FIN015_INSTALLED_COMMIT,
  FIN015_INSTALLED_EPOCH,
  FIN015_INSTALLED_TREE,
  FIN015_MIGRATIONS,
  FIN015_INSTALLED_ARTIFACT_MANIFEST_SHA256,
  FIN015_PREDECESSOR_MIGRATION_MANIFEST_SHA256,
  FIN015_PREDECESSOR_SCHEMA_SHA256,
  FIN015_PRODUCTION_DATABASE,
  FIN015_ROLLBACK_ARTIFACT_MANIFEST_SHA256,
  FIN015_SUCCESSOR_INPUT_DIGEST,
  FIN015_SUCCESSOR_INPUT_SHA256,
  FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256,
  FIN015_SUCCESSOR_SCHEMA_SHA256,
  FIN015_UPGRADE_CONTROL_SCHEMA,
  Fin015ProtectedUpgradeFailure,
  collectFin015MigrationInventory,
  collectFin015ReleaseAuthority,
  upgradeFin015ProtectedProduction,
  validateFin015UpgradeControl,
  verifyFin015SuccessorInvariants
} from "../fin015-protected-production-upgrade.mjs";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const BEFORE_ROWS = "1".repeat(64);
const AFTER_ROWS = "2".repeat(64);

function control(overrides = {}) {
  const value = {
    schema: FIN015_UPGRADE_CONTROL_SCHEMA,
    state: "authorized_held_production_database_upgrade",
    createdAt: "2026-09-01T11:59:00.000Z",
    expiresAt: "2026-09-01T12:20:00.000Z",
    source: {
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
    },
    database: {
      name: FIN015_PRODUCTION_DATABASE,
      beforeSchemaSha256: FIN015_PREDECESSOR_SCHEMA_SHA256,
      beforeRowCountsSha256: BEFORE_ROWS,
      beforeTotalTableCount: 294,
      afterSchemaSha256: FIN015_SUCCESSOR_SCHEMA_SHA256,
      afterTotalTableCount: 299,
      beforeMigrationManifestSha256:
        FIN015_PREDECESSOR_MIGRATION_MANIFEST_SHA256,
      afterMigrationManifestSha256:
        FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256,
      migrationDeltaCount: 4,
      migrations: structuredClone(FIN015_MIGRATIONS)
    },
    backup: {
      state: "success",
      completedAt: "2026-09-01T11:50:00.000Z",
      manifestSha256: "3".repeat(64),
      databaseCiphertextSha256: "4".repeat(64),
      appStateCiphertextSha256: "5".repeat(64),
      destinationFailureDomainId: "zen-sitesourcery-backup-01",
      plaintextRetained: false,
      cleanRecoveryVerified: true,
      rollbackPairReady: true,
      dellZenHashesMatch: true,
      providerEgressHeld: true
    },
    predecessor: {
      installedArtifactManifestSha256:
        FIN015_INSTALLED_ARTIFACT_MANIFEST_SHA256,
      rollbackArtifactManifestSha256:
        FIN015_ROLLBACK_ARTIFACT_MANIFEST_SHA256,
      runtimeRetained: true,
      environmentRetained: true,
      evidenceRetained: true,
      unitRollbackRetained: true
    },
    public: {
      installedCommitSha: FIN015_INSTALLED_COMMIT,
      installedEpoch: FIN015_INSTALLED_EPOCH,
      installedStillAuthoritative: true,
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
      ownerInstruction: "owner_exact_fin015_database_upgrade",
      databaseUpgradeAuthorized: true,
      runtimeInstallSeparate: true,
      publicCutoverSeparate: true,
      providerEffectsAuthorized: false,
      paymentEffectsAuthorized: false,
      dnsEffectsAuthorized: false,
      customerEffectsAuthorized: false,
      legalAcceptanceAuthorized: false,
      publicationEffectsAuthorized: false,
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
    ) {
      value[name] = { ...value[name], ...entry };
    } else {
      value[name] = entry;
    }
  }
  return value;
}

function snapshot({ successor = false } = {}) {
  const relationCount = successor ? 299 : 294;
  return {
    identity: {
      databaseName: FIN015_PRODUCTION_DATABASE,
      currentUser: "sitesourcery_owner",
      postgresMajor: 16,
      serverVersionNumber: 160014
    },
    ownership: {
      normalizedSha256: (successor ? "7" : "6").repeat(64),
      allRelationsOwnedByDatabaseOwner: true,
      allRoutinesOwnedByDatabaseOwner: true
    },
    tableCounts: successor ? { auth: 1, ss: 298 } : { auth: 1, ss: 293 },
    totalTableCount: relationCount,
    schemaSha256:
      successor
        ? FIN015_SUCCESSOR_SCHEMA_SHA256
        : FIN015_PREDECESSOR_SCHEMA_SHA256,
    rowCountsSha256: successor ? AFTER_ROWS : BEFORE_ROWS,
    rowCounts: Array.from({ length: relationCount }, (_, index) => ({
      relation: index === 0 ? "auth.users" : `ss.table_${index}`,
      rowCount: "3"
    }))
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

test("FIN-015 validates the exact protected successor input and held CI receipt", async () => {
  const authority = await collectFin015ReleaseAuthority();
  assert.equal(authority.successorInput.digest, FIN015_SUCCESSOR_INPUT_DIGEST);
  assert.equal(authority.ciFinalReceipt.digest, FIN015_CI_FINAL_RECEIPT_DIGEST);
  assert.equal(authority.ciFinalReceipt.candidateSha, FIN015_CANDIDATE_COMMIT);
  assert.equal(authority.ciFinalReceipt.workflowSha, FIN015_HELD_CONTROL_COMMIT);
});

test("FIN-015 binds the exact 98-to-102 four-file migration inventory", async () => {
  const inventory = await collectFin015MigrationInventory();
  assert.equal(inventory.predecessor.count, 98);
  assert.equal(inventory.successor.count, 102);
  assert.equal(
    inventory.predecessor.manifestSha256,
    FIN015_PREDECESSOR_MIGRATION_MANIFEST_SHA256
  );
  assert.equal(
    inventory.successor.sha256,
    FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256
  );
  assert.deepEqual(
    inventory.selected.map((entry) => ({
      name: entry.path.split("/").at(-1),
      byteCount: entry.byteCount,
      sha256: entry.sha256
    })),
    structuredClone(FIN015_MIGRATIONS)
  );
});

test("FIN-015 control requires fresh paired backup, quiesce, exact authority, and separate cutover", () => {
  const value = validateFin015UpgradeControl(control(), { now: NOW });
  assert.equal(
    value.database.beforeSchemaSha256,
    FIN015_PREDECESSOR_SCHEMA_SHA256
  );
  assert.equal(
    value.database.afterSchemaSha256,
    FIN015_SUCCESSOR_SCHEMA_SHA256
  );
  assert.equal(value.database.migrationDeltaCount, 4);
  assert.equal(value.backup.dellZenHashesMatch, true);
  assert.equal(value.authority.runtimeInstallSeparate, true);
  assert.equal(value.authority.publicCutoverSeparate, true);
  assert.equal(value.authority.providerEffectsAuthorized, false);
});

test("FIN-015 rejects stale backup, expired authority, live runtime, or lifted effects", () => {
  for (const [value, code] of [
    [
      control({ expiresAt: "2026-09-01T11:59:59.000Z" }),
      "FIN015_UPGRADE_CONTROL_EXPIRED"
    ],
    [
      control({ backup: { completedAt: "2026-09-01T10:00:00.000Z" } }),
      "FIN015_BACKUP_NOT_FRESH"
    ],
    [
      control({ operation: { runtimeStopped: false } }),
      "FIN015_UPGRADE_CONTROL_INVALID"
    ],
    [
      control({ authority: { publicationEffectsAuthorized: true } }),
      "FIN015_UPGRADE_CONTROL_INVALID"
    ]
  ]) {
    assert.throws(
      () => validateFin015UpgradeControl(value, { now: NOW }),
      (error) =>
        error instanceof Fin015ProtectedUpgradeFailure &&
        error.code === code
    );
  }
});

test("FIN-015 applies only migrations 146-149 under lock and preserves all predecessor rows", async () => {
  const pool = fakePool();
  let snapshots = 0;
  const receipt = await upgradeFin015ProtectedProduction(pool, {
    control: control(),
    now: NOW,
    snapshot: async () => snapshot({ successor: snapshots++ > 0 }),
    heldInvariantProof: async () => ({ lifecycle_state_held: true }),
    successorInvariantProof: async () => ({
      twilioContract:
        "canonical-responder-twilio-isv-topology-v1-customer-subaccount",
      alakazamContract: "canonical-alakazam-policy-authority-v2-released",
      publicationContract:
        "canonical-publication-control-v2-released-leased",
      legalContract: "canonical-hosted-joint-legal-v7-authority",
      protectedRlsTables: 5
    })
  });
  assert.equal(
    receipt.state,
    "database_upgraded_held_for_separate_runtime_install"
  );
  assert.equal(receipt.migrations.deltaCount, 4);
  assert.equal(receipt.before.totalTableCount, 294);
  assert.equal(receipt.after.totalTableCount, 299);
  assert.equal(receipt.rowPreservation.preservedPredecessorRelations, 294);
  assert.equal(receipt.rowPreservation.rowLoss, false);
  assert.deepEqual(Object.values(receipt.effects), [
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false
  ]);
  const applied = pool.queries.filter(
    (entry) =>
      typeof entry.sql === "string" &&
      FIN015_MIGRATIONS.some((migration) =>
        Buffer.byteLength(entry.sql) === migration.byteCount
      )
  );
  assert.equal(applied.length, 4);
  assert.equal(
    pool.queries.some((entry) =>
      String(entry.sql).includes("pg_advisory_lock")
    ),
    true
  );
  assert.equal(
    pool.queries.some((entry) =>
      String(entry.sql).includes("pg_advisory_unlock")
    ),
    true
  );
  assert.equal(pool.queries.at(-1).sql, "release");
});

test("FIN-015 refuses migration while another production database connection exists", async () => {
  const pool = fakePool({ otherConnectionCount: 1 });
  await assert.rejects(
    () =>
      upgradeFin015ProtectedProduction(pool, {
        control: control(),
        now: NOW,
        snapshot: async () => snapshot(),
        heldInvariantProof: async () => ({}),
        successorInvariantProof: async () => ({})
      }),
    (error) =>
      error instanceof Fin015ProtectedUpgradeFailure &&
      error.code === "FIN015_DATABASE_NOT_QUIESCED"
  );
  assert.equal(pool.queries.at(-1).sql, "release");
});

test("FIN-015 exact four-contract and five-table RLS readback is fail closed", async () => {
  const good = {
    async query() {
      return {
        rows: [{
          twilio_contract:
            "canonical-responder-twilio-isv-topology-v1-customer-subaccount",
          alakazam_contract:
            "canonical-alakazam-policy-authority-v2-released",
          publication_contract:
            "canonical-publication-control-v2-released-leased",
          legal_contract: "canonical-hosted-joint-legal-v7-authority",
          protected_rls_tables: 5
        }]
      };
    }
  };
  assert.equal(
    (await verifyFin015SuccessorInvariants(good)).protectedRlsTables,
    5
  );
  const bad = {
    async query() {
      const row = (await good.query()).rows[0];
      return { rows: [{ ...row, protected_rls_tables: 4 }] };
    }
  };
  await assert.rejects(
    () => verifyFin015SuccessorInvariants(bad),
    (error) =>
      error instanceof Fin015ProtectedUpgradeFailure &&
      error.code === "FIN015_SUCCESSOR_INVARIANTS_INVALID"
  );
});
