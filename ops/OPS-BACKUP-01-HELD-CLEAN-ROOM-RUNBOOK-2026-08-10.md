# OPS-BACKUP-01 held backup and clean-room restore runbook

## Status

This packet is planning and evidence validation only. It does not authorize a
backup, decryption, restore, database or mount mutation, cleanup, service
action, provider call, deployment, or customer effect. Every switch remains
held even when fixture evidence is structurally complete.

The contract is `sitesourcery.backup-restore-contract/v1`. The only accepted
mode is `held`. A later execution packet requires separate authorization and a
new exact contract input; this runbook is not that authorization.

## Existing invariants preserved

The contract references rather than replaces the existing production-rehearsal
implementation:

- successful backup evidence remains
  `sitesourcery.backup-attempt-succeeded/v2`;
- quiescence remains `sitesourcery.backup-quiesce/v1` for
  `sitesourcery-hosted.service` with the runtime inactive, the writer fence
  engaged, zero database writers, and a stable filesystem snapshot;
- the destination remains an immutable attempt in a different failure domain
  carrying `sitesourcery.off-machine-destination/v1`;
- destination artifacts remain age ciphertext, with plaintext forbidden at the
  destination;
- clean-room restore evidence remains `sitesourcery.clean-room-restore/v2`;
- the restore target must be fresh, non-production, network-isolated, and held
  for every provider egress purpose;
- readiness, journey, cleanup, and rollback each require their own immutable
  proof reference.

The operational implementations remain in `ops/backup-runtime.mjs`,
`ops/backup-cycle.mjs`, and `ops/restore-runtime.mjs`. This packet does not
modify or invoke them.

## Exact integration input

The release integrator must provide one explicit
`sitesourcery.backup-restore-integration-input/v1` object after the final
integration tree is known. It must bind:

1. the exact release-epoch schema, epoch ID, binding digest, and receipt digest;
2. the exact source commit represented by that epoch;
3. the exact public/hosted artifact-manifest digest represented by that epoch;
4. a verified installed-identity receipt with the same release-epoch binding,
   release commit, artifact manifest, and migration count;
5. the final migration count, lexically latest migration filename, and digest
   of the complete sorted migration-filename inventory.

The migration count has no repository default or frozen value in this packet.
It must be supplied after every integration migration has landed. The verifier
recomputes the inventory from the selected migration root and rejects an added,
missing, duplicated, renamed, or reordered identity mismatch.

The committed packet contains no production integration input and therefore
claims no current installed release, artifact, migration count, or readiness.

## Owner decisions

Three owner decisions are mandatory inputs and have no defaults:

### Recovery point objective

The RPO decision supplies a positive maximum recovery-point age in milliseconds
and an immutable decision-evidence digest. Until supplied, the contract reports
`owner_rpo_decision` and remains held. A verified restore whose start is later
than the approved age relative to the bound backup fails closed.

### Retention

The retention decision supplies a positive maximum backup age, a positive
minimum count of successful attempts to preserve, and an immutable
decision-evidence digest. Until supplied, the contract reports
`owner_retention_decision` and remains held.

This contract does not authorize retention deletion. Any future retention
application needs its own reviewed effect packet and must preserve the existing
immutable-attempt and minimum-successful invariants.

### Key custody

The key-custody decision supplies only non-secret SHA-256 references: the
recipient fingerprint, custody evidence, and recovery-access evidence. It does
not contain an age identity, key material, credential, operator name, storage
path, or recovery secret. Until supplied, the contract reports
`owner_key_custody_decision` and refuses verified backup or restore evidence.

## Future backup evidence sequence

This sequence describes evidence dependencies; it is not permission to run
them.

1. Validate the exact integration input against the final migration inventory.
2. Prove every provider and customer effect remains held.
3. Acquire the existing exclusive cycle lock and reviewed recovery state.
4. Engage the exact writer fence, stop the bound runtime, and prove inactive
   runtime, zero database writers, and stable app-state bytes.
5. Verify the immutable off-machine marker belongs to a different failure
   domain.
6. Capture only through the existing backup implementation and write only age
   ciphertext plus immutable evidence to the destination.
7. Bind the backup receipt, quiescence evidence, destination marker,
   ciphertext manifest, approved key-custody reference, release binding, and
   completion time.
8. Use the existing recovery path to remove only its matching writer fence and
   recovery state. Do not treat a backup receipt as permission to restart,
   publish, deploy, or enable a provider.

Failure before complete immutable evidence leaves `backup_evidence` blocked.
No partial or locally observed file is promoted to verified evidence.

## Future clean-room restore evidence sequence

This sequence also requires a separately authorized execution packet.

1. Select a target proven fresh and distinct from every production database,
   data root, mount, and service identity.
2. Preserve network exposure `none` and all provider egress `held`.
3. Reverify the exact backup receipt, ciphertext manifest, key-custody
   references, and release binding before any decrypt operation.
4. Restore only into the exact fresh target and verify the installed migration
   identity and existing database/app-state invariants.
5. Capture an immutable target-freshness proof.
6. Capture a readiness proof bound to the restored release and migration
   inventory.
7. Capture a bounded journey proof selected by the release integrator. It must
   not call a live provider, grant customer capability, publish, send mail, or
   change commercial state.
8. Capture rollback proof showing that a failed validation cannot promote or
   route the restored target.
9. Under separate cleanup authority, remove only the exact generated restore
   target and plaintext staging, then capture proof that each exact target is
   absent. Never broaden cleanup by prefix, parent directory, mount, service,
   database server, or production identity.

The restore receipt must bind the exact backup receipt and monotonic backup,
restore-start, and restore-completion timestamps. Missing freshness,
readiness, journey, cleanup, or rollback evidence leaves the restore
`not_proven`.

## Read-only verification

The verifier accepts no default contract or integration file. A future release
integrator may run the read-only verifier only after creating both immutable
non-secret inputs:

```text
node ops/verify-backup-restore-contract.mjs \
  --contract /absolute/path/to/held-contract.json \
  --integration /absolute/path/to/integration-input.json \
  --migration-root /absolute/path/to/final/migrations
```

The verifier reads JSON and migration filenames only. A successful result still
reports `mode: held` and `effectsAllowed: false`.

## Rollback boundary

Validation failure causes no state transition because this packet performs no
effects. In a future authorized drill:

- backup-cycle recovery may act only on its exact matching lock, recovery
  state, writer fence, and dedicated staging root;
- restore rollback may act only on the exact generated clean-room target;
- failed evidence remains immutable for diagnosis;
- no rollback may target the source database, production data root, provider,
  DNS, deployment, or release control;
- a technically verified drill still does not remove
  `execution_not_authorized` from this v1 contract.

## Unresolved owner and release inputs

- final release epoch and receipt;
- final source and artifact identity;
- verified installed identity;
- final migration inventory after all integration migrations land;
- owner-approved RPO;
- owner-approved retention policy;
- owner-approved key-custody and recovery-access references;
- separate authority for any live backup, decrypt, restore, cleanup, service,
  provider, deployment, or customer effect.
