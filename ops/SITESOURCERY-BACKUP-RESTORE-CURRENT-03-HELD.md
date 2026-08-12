# BACKUP-RESTORE-CURRENT-03 held current-release composition

## Status

This packet adds a local, held-only composition contract. It does not perform
or authorize a backup, decryption, restore, cleanup, database operation,
service action, provider call, deployment, release action, DNS change, or
customer effect.

The retained receipt schema is
`sitesourcery.current-backup-restore-held/v1`. A structurally valid receipt is
always `verified_held`; every effect switch remains false. The fixture proof
does not claim that a current production backup or independent restore exists.

## Reused authority

The composition calls the existing validators rather than replacing them:

- `validateInstalledFinalReleaseEpochV2Chain` binds the exact final release
  epoch, origin seal, installed readback, source tree, artifact manifests,
  migration manifest, held authority, and rollback predecessor.
- `validateHeldBackupRestoreContract` and
  `verifyHeldBackupRestoreContract` preserve the sealed RPO, retention,
  key-custody, quiescence, ciphertext, freshness, readiness, journey, cleanup,
  rollback, dynamic migration-inventory, and held-execution invariants.
- `loadVerifiedBackupAttempt` verifies the immutable attempt ledger, exact two
  ciphertext artifacts, positive byte counts, digests, permissions, writer
  fence, stable snapshot, and provider-egress hold.
- The clean-room receipt is checked against the exact report emitted by
  `verifyCleanRoomRestore`, including fresh database and app roots, restored
  row and tree invariants, no network exposure, and held provider egress.

No backup, restore, epoch, monitor, or dead-man primitive changes in this
packet.

## Current release binding

`createCurrentBackupRestoreIntegration` projects the installed V2 epoch into
the existing `sitesourcery.backup-restore-integration-input/v1` boundary. It
requires one exact tuple:

1. final release epoch ID, binding digest, and receipt digest;
2. source commit and source tree;
3. public/hosted artifact manifest;
4. origin seal and matching installed-readback receipt;
5. migration count, latest filename, full byte-and-digest manifest, and the
   exact sorted filename inventory;
6. held release authority and the distinct rollback predecessor already bound
   by the installed V2 chain.

An added, missing, renamed, or stale migration, a different epoch, a changed
artifact, or an installed-readback mismatch fails before backup evidence is
composed.

## Required retained evidence

A later separately authorized evidence run must supply all of the following.
The values must be immutable non-secret receipts; paths, credentials, key
material, customer data, and operator PII do not belong in the composition.

### Backup attempt

- An immutable `sitesourcery.backup-attempt-succeeded/v2` ledger accepted by
  `loadVerifiedBackupAttempt`.
- Exactly one PostgreSQL and one app-state ciphertext artifact, each non-empty.
- A source failure-domain identity and a distinct off-host destination
  failure-domain identity.
- The exact destination marker, recipient fingerprint, writer-fence,
  ciphertext-manifest, completion, and receipt digests already named by the
  sealed backup contract.
- The source operations state and all provider egress wholly held.

An empty attempt, a local or same-failure-domain destination, a mutable or
drifted artifact, or an approved live operation state fails closed.

### Clean-room restore

- The exact immutable `sitesourcery.clean-room-restore/v2` report and its
  canonical receipt SHA-256.
- Exact backup attempt and manifest identity.
- Fresh database and app-state identities reproducing the backup's row and
  tree invariants.
- Network exposure `none` and all provider egress held.
- Exact target-freshness, readiness, and bounded held-journey proof digests.
- Monotonic start and completion timestamps with a positive measured duration.

The measured duration must not exceed a separately ratified positive RTO. The
existing owner-approved RPO still limits backup age when restore begins.

### Owner decisions

The existing contract must contain approved, digest-bound RPO, retention, and
key-custody decisions. The current composition additionally requires
`sitesourcery.current-restore-rto-decision/v1` with state `ratified`, a
positive maximum duration, and the immutable owner-decision evidence digest.

The final receipt retains only these non-secret references:

- RPO decision digest;
- RTO decision digest and maximum duration;
- retention decision digest;
- recipient fingerprint;
- key-custody decision digest;
- recovery-access decision digest.

Missing or unratified policy leaves the composition rejected. This packet
does not invent RPO, RTO, retention, recipient, or key-custody values.

### Cleanup and rollback

`sitesourcery.current-clean-room-cleanup/v1` must bind the exact restore
receipt and hashed database identity, and must prove all three facts true:

- the exact disposable database is absent;
- decrypted/plaintext staging is absent;
- the restored app-state root is absent.

The cleanup observation must follow restore completion. Any false, missing,
stale, or differently bound absence fact fails closed.

`sitesourcery.current-restore-rollback-binding/v1` binds the exact final epoch,
restore receipt, and the epoch's exact predecessor commit, tree, and artifact
manifest. It proves only that production was not promoted and provider effects
did not occur. It does not claim that a real rollback rehearsal ran.

## Retained receipt

On success, `verifyHeldCurrentBackupRestore` returns one canonical digest-bound
receipt containing:

- exact current release and installed-readback identity;
- exact migration union;
- non-empty backup attempt and off-host destination identity;
- clean-room restore identity, duration, readiness, and journey references;
- RPO/RTO/retention/key-custody decision references;
- cleanup absence evidence;
- rollback predecessor binding;
- an exact all-false effect hold.

The receipt intentionally omits the restore database name, filesystem paths,
destination paths, credentials, keys, secrets, customer values, and PII.

## Local deterministic acceptance

Run only the pinned local fixture proof:

```text
/private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node \
  --test ops/test/backup-restore-current.test.mjs
```

The fixture uses the existing backup and clean-room restore runtimes with
provider-neutral in-process ports and temporary local files. It creates no
database, opens no network connection, reads no secret, and invokes no
provider. Mutation coverage rejects empty ciphertext, same-domain storage,
stale epoch or migration union, restore drift, exceeded RTO, residual database
or plaintext, unratified policy, wrong rollback predecessor, added fields,
enabled effects, and digest drift.

## Real acceptance sequence remains open

Under a later exact authorization, the release operator must:

1. install and read back the exact final held release epoch on the origin;
2. ratify non-secret RPO, RTO, retention, and key-custody decision evidence;
3. create a non-empty encrypted attempt at an independently verified off-host
   destination using the existing fenced backup cycle;
4. restore that exact attempt in a fresh independent clean room with no network
   or provider egress;
5. capture exact readiness and bounded held-journey receipts;
6. remove only the exact disposable database, plaintext staging, and restored
   app root, then prove each exact target absent;
7. bind the installed epoch's exact rollback predecessor;
8. retain the canonical receipt through the existing immutable-evidence writer.

Those actions require separate installation, destination, database, cleanup,
and operator authority. This packet supplies no command that performs them.

## Residual gates

- No final current release epoch is installed or read back by this packet.
- No owner RPO, RTO, retention, or key-custody decision is ratified here.
- No current-union ciphertext attempt exists from this packet.
- No independent clean-room restore, readiness journey, or cleanup-absence
  observation is claimed.
- No real rollback rehearsal is claimed.
- No off-host destination, key, credential, database, service, or production
  system is accessed.
