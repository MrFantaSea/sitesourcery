# OPS-BACKUP-01 wiring notes

## Packet ownership

This packet is additive and owns only:

- `ops/backup-restore-contract.mjs`
- `ops/backup-restore-contract.schema.json`
- `ops/verify-backup-restore-contract.mjs`
- `ops/test/backup-restore-contract.test.mjs`
- `ops/OPS-BACKUP-01-HELD-CLEAN-ROOM-RUNBOOK-2026-08-10.md`
- `WIRING-NOTES-OPS-BACKUP-01.md`

The existing `ops/*.mjs` syntax glob and `ops/test/*.test.mjs` test glob already
discover the new module, verifier, and focused test. No package-script or
production composition edit is required.

## Release integration seam

Do not commit a guessed current contract. After the final release epoch,
artifact, installed identity, and migration set are sealed, the release lane
must create two immutable non-secret inputs:

1. `sitesourcery.backup-restore-integration-input/v1`, populated from the exact
   sealed epoch and installed-identity receipts; and
2. `sitesourcery.backup-restore-contract/v1`, created with
   `createHeldBackupRestoreContract` from that integration input and the exact
   owner decisions available at that time.

The final migration count is required data, never a module constant. Populate
it together with the latest migration filename and the digest returned by
`backupRestoreMigrationInventory` over the complete final filename list. Run
`verify-backup-restore-contract.mjs` against that same final migration root.

## Excluded composition

Do not wire this contract into backup timers, backup services, restore units,
mount units, hosted HTTP, provider adapters, deployment controls, or release
switches in this packet. A valid contract remains held and cannot authorize any
effect.

Any future service preflight must consume an explicit absolute contract path,
an explicit absolute integration-input path, and the sealed release migration
root. It must treat `effectsAllowed: false` as a hard stop, not readiness to run.

## Promotion boundary

Owner RPO, retention, and key-custody decisions are immutable digest-bound
inputs, not environment defaults. Backup and restore proof references may be
added only by a separately authorized evidence packet. This v1 contract always
retains `execution_not_authorized`; enabling an effect requires a successor
schema and separate review rather than editing the held receipt in place.
