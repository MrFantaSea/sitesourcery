import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  FIN008_EXPECTED_LATEST_MIGRATION,
  FIN008_EXPECTED_MIGRATION_COUNT,
  FIN008_PREDECESSOR_COMMIT,
  FIN008_PREDECESSOR_LATEST_MIGRATION,
  FIN008_PREDECESSOR_MIGRATION_COUNT,
  Fin008ConvergenceFailure,
  assertFin008DisposableDatabaseName,
  collectFin008MigrationInventory
} from "../fin008-data-convergence.mjs";

test("FIN-008 freezes the exact predecessor, delta, and candidate migration bytes", async () => {
  const inventory = await collectFin008MigrationInventory();
  assert.equal(inventory.count, FIN008_EXPECTED_MIGRATION_COUNT);
  assert.equal(inventory.latest, FIN008_EXPECTED_LATEST_MIGRATION);
  assert.equal(
    inventory.predecessor.commitSha,
    FIN008_PREDECESSOR_COMMIT
  );
  assert.equal(
    inventory.predecessor.count,
    FIN008_PREDECESSOR_MIGRATION_COUNT
  );
  assert.equal(
    inventory.predecessor.latest,
    FIN008_PREDECESSOR_LATEST_MIGRATION
  );
  assert.equal(inventory.delta.count, 36);
  assert.equal(
    inventory.predecessor.count + inventory.delta.count,
    inventory.count
  );
  for (const value of [
    inventory.manifestSha256,
    inventory.predecessor.manifestSha256,
    inventory.delta.manifestSha256
  ]) {
    assert.match(value, /^[a-f0-9]{64}$/u);
  }
  assert.deepEqual(
    inventory.entries.slice(0, FIN008_PREDECESSOR_MIGRATION_COUNT),
    inventory.predecessor.entries
  );
  assert.deepEqual(
    inventory.entries.slice(FIN008_PREDECESSOR_MIGRATION_COUNT),
    inventory.delta.entries
  );
});

test("FIN-008 receipt binds the exact converged data epoch with every effect held", async () => {
  const receipt = JSON.parse(await readFile(new URL(
    "../releases/final-successor-20260811/fin008-data-epoch-receipt.json",
    import.meta.url
  ), "utf8"));
  const inventory = await collectFin008MigrationInventory();
  assert.equal(
    receipt.schema,
    "sitesourcery.fin008-data-epoch-receipt/v1"
  );
  assert.equal(receipt.state, "proved");
  assert.equal(
    receipt.source.predecessorCommitSha,
    FIN008_PREDECESSOR_COMMIT
  );
  assert.equal(receipt.migrations.count, inventory.count);
  assert.equal(
    receipt.migrations.manifestSha256,
    inventory.manifestSha256
  );
  assert.equal(
    receipt.migrations.predecessorManifestSha256,
    inventory.predecessor.manifestSha256
  );
  assert.equal(
    receipt.migrations.deltaManifestSha256,
    inventory.delta.manifestSha256
  );
  assert.deepEqual(receipt.protectedPredecessor.tableCounts, {
    auth: 1,
    ss: 200
  });
  assert.equal(receipt.protectedPredecessor.databaseMutated, false);
  assert.deepEqual(receipt.successor.tableCounts, { auth: 1, ss: 286 });
  assert.equal(receipt.successor.totalTableCount, 287);
  assert.equal(receipt.successor.freshAndUpgradeConverged, true);
  assert.equal(receipt.successor.preservedPredecessorRelations, 201);
  assert.equal(receipt.successor.providerEffects, false);
  assert.notEqual(
    receipt.candidateBackup.sourceFailureDomainId,
    receipt.candidateBackup.destinationFailureDomainId
  );
  assert.equal(receipt.candidateBackup.ciphertextFormat, "age");
  assert.equal(receipt.candidateBackup.plaintextFileCreated, false);
  assert.equal(receipt.candidateBackup.providerEgress, "held");
  assert.equal(receipt.cleanRoomRestore.freshDatabase, true);
  assert.equal(
    receipt.cleanRoomRestore.schemaSha256,
    receipt.successor.schemaSha256
  );
  assert.equal(
    receipt.cleanRoomRestore.rowCountsSha256,
    receipt.successor.rowCountsSha256
  );
  assert.equal(receipt.cleanRoomRestore.plaintextFileCreated, false);
  assert.equal(receipt.rollback.predecessorReadyOnPredecessor, true);
  assert.equal(receipt.rollback.predecessorWritableOnSuccessor, false);
  assert.equal(receipt.rollback.destructiveSql, false);
  assert.equal(receipt.cleanup.localDisposableDatabaseCount, 0);
  assert.equal(receipt.cleanup.zenRestoreRootAbsent, true);
  assert.equal(receipt.cleanup.zenCiphertextRetained, true);
  assert.deepEqual(
    Object.values(receipt.effects),
    Object.values(receipt.effects).map(() => false)
  );
  assert.equal(receipt.legal.published, false);
  assert.equal(receipt.legal.deploymentAuthorized, false);
});

test("FIN-008 permits only exact disposable database names", () => {
  assert.equal(
    assertFin008DisposableDatabaseName(
      "ss_fin008_predecessor_rehearsal_20260820_01"
    ),
    "ss_fin008_predecessor_rehearsal_20260820_01"
  );
  for (const value of [
    "sitesourcery_production",
    "postgres",
    "ss_staging_20260801",
    "ss_fin008_short",
    "SS_FIN008_PREDECESSOR_REHEARSAL"
  ]) {
    assert.throws(
      () => assertFin008DisposableDatabaseName(value),
      (error) =>
        error instanceof Fin008ConvergenceFailure &&
        error.code === "FIN008_DATABASE_NOT_DISPOSABLE"
    );
  }
});
