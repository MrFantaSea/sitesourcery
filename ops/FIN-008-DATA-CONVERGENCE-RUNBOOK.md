# FIN-008 data convergence runbook

## Scope

This runbook proves the exact successor database epoch without changing the
protected predecessor. It permits mutations only in explicitly named
`ss_fin008_*` disposable databases and in one exact encrypted attempt directory
on the marked Zen failure domain. Public routing, provider effects, HQ/Dell
service changes, and protected-database writes remain outside this runbook.

The verifier refuses any mutable database name that does not begin with the
exact `ss_fin008_` disposable prefix. Database URLs belong in environment
variables and must not be placed in committed evidence.

## Frozen inputs

- Candidate input commit: `b2aafdd9a873007069780e4a9d890217802fa4c0`
- Candidate input tree: `4d182564c0158e19e8809bc38ccfb9ec17d65034`
- Predecessor: `84aca6b757a806b428ae0cce8115c12dcc6486cd`
- Predecessor migrations: exact unchanged 58-file prefix through
  `202608090105_hosted_joint_legal_v4_authority.sql`
- Candidate migrations: 95 files through
  `202608200142_hosted_joint_legal_v5_authority.sql`
- PostgreSQL: major 16
- Protected predecessor shape: 201 base tables (`auth=1`, `ss=200`)
- Successor shape: 287 base tables (`auth=1`, `ss=286`)

The exact byte manifests, artifact/catalog/legal bindings, data fingerprints,
encrypted attempt, restore, rollback, cleanup, and effect holds are recorded in
`ops/releases/final-successor-20260811/fin008-data-epoch-receipt.json`.

## Read-only inventory

```text
node ops/fin008-data-convergence.mjs inventory
```

The result must report the exact 58/37/95 partition and all three frozen
manifest digests before any disposable database is created.

## Empty install

Create one explicit empty PostgreSQL 16 database whose name begins
`ss_fin008_`, then run the retained full verifier as the caller-owned target:

```text
SITESOURCERY_PG_MIGRATION_TEST_URL=<secret-or-local-url> \
  node server/data-plane/tests/verify-empty-postgres-migrations.mjs
```

The verifier applies all 95 migrations, exercises its composed PostgreSQL
journeys, and retains only the caller-owned disposable target for comparison.

## Predecessor copy and upgrade

Take a transactionally consistent logical stream from the protected source or
decrypt an already-fenced canonical backup. Restore it only into a new local
`ss_fin008_*` database. Preserve ACLs; omitting privileges creates a different
schema identity and must fail convergence.

Fingerprint before upgrade:

```text
SITESOURCERY_FIN008_DATABASE_URL=<disposable-url> \
  node ops/fin008-data-convergence.mjs snapshot
```

Apply only the frozen 37-file delta, binding the exact observed predecessor
fingerprint:

```text
SITESOURCERY_FIN008_DATABASE_URL=<disposable-url> \
SITESOURCERY_FIN008_PREDECESSOR_SCHEMA_SHA256=<observed-sha256> \
  node ops/fin008-data-convergence.mjs upgrade
```

Compare fresh and upgraded targets:

```text
SITESOURCERY_FIN008_FRESH_DATABASE_URL=<fresh-url> \
SITESOURCERY_FIN008_UPGRADED_DATABASE_URL=<upgraded-url> \
  node ops/fin008-data-convergence.mjs compare
```

The canonical schema digest normalizes only the host-local database-owner role
name. Object ownership is checked separately: every application relation and
routine must belong to that database owner, while canonical role grants remain
byte-comparable. Every predecessor relation must remain present with no row
loss. Expected successor backfills are listed explicitly in the receipt.

## Encrypted distinct-domain backup and clean-room restore

Stream `pg_dump --format=custom --no-owner` directly through age using the
existing Zen custody recipient. Do not write a plaintext dump. Copy only the
ciphertext to a new exact directory beneath the marked Zen FIN-008 attempt
root, verify its size and SHA-256 on both sides, and set the ciphertext mode to
`0400`.

On Zen, initialize one new data-checksummed PostgreSQL 16 cluster in the exact
FIN-008 restore root. Start it with `listen_addresses=` and a mode-0700 Unix
socket. Create only `anon`, `authenticated`, `service_role`, and one exact
`ss_fin008_*` database. Stream age decryption directly into `pg_restore`; no
decrypted file or staging directory is permitted.

Use a temporary private SSH tunnel only for read-only verification. Run
`verify` and `compare` against the restored database. The schema, row-count,
grant, ownership, RLS, identity-crosswalk, lifecycle, and provider-hold facts
must match the upgraded source.

## Rollback evidence

Use immutable predecessor code only in read-only transactions:

1. Against a restored predecessor copy, readiness must be true and tenant
   isolation must return zero cross-tenant rows.
2. Against the successor schema, the predecessor must fail closed on the known
   commercial terms identity rather than serving old prices against new data.
   Its explicit read-only tenant/service transactions must still prove RLS and
   predecessor-contract visibility.

This is deliberate rollback safety. Operational rollback selects the retained
predecessor runtime and retained predecessor database together. It never runs
old commerce code writable against the successor epoch.

## Exact cleanup

After evidence is captured:

- stop the temporary tunnel and exact clean-room cluster;
- remove only its exact Zen restore and socket roots;
- drop only the explicitly named local `ss_fin008_*` databases;
- remove the exact local ciphertext duplicate and disposable predecessor-code
  worktree;
- retain the Zen ciphertext and immutable non-secret evidence; and
- prove all disposable targets absent while the protected predecessor and
  public placeholder remain unchanged.
