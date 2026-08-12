# Site Sourcery Held Rollback Rehearsal 04

Status: local composition proof only. This runbook does not authorize or execute an install, service action, network request, Pages change, database mutation, deployment, or production rollback.

## Bound evidence

`ops/rollback-rehearsal.mjs` requires all of these inputs to agree before invoking a fake port:

- one distinct held predecessor and installed held successor `final-release-epoch/v2` pair;
- the successor origin seal and exact installed readback chain;
- exact loopback listener, hosted API, and external worker contracts for both epochs;
- a verified-held database compatibility receipt requiring no destructive downgrade and no database mutation;
- the current verified-held non-empty backup and clean-room restore receipt for the successor and its rollback predecessor;
- one exact effect-free Pages fallback observation; and
- process, network, and Pages ports whose exact contracts declare `externalEffects: false`.

The retained receipt binds all evidence by immutable digest and keeps customer, service, network, Pages, database, provider, DNS, deployment, and authority effects held.

## Deterministic rehearsal

The successful local sequence is:

1. Observe the active successor and Pages fallback.
2. Stop successor worker, then successor API.
3. Re-observe the unchanged Pages fallback.
4. Select the predecessor; start API, then worker.
5. Check predecessor live, ready, and exact topology.
6. Stop predecessor worker, then API.
7. Select the successor; start API, then worker.
8. Check successor live, ready, exact topology, and final process state.

Any partial result starts a deterministic recovery sequence that stops both selected components, reselects the successor, restarts API then worker, and rechecks live, ready, topology, and final state. A proven recovery produces an immutable `aborted_recovered` receipt and still throws. An unproven recovery produces an immutable `ambiguous_held` receipt, claims no final process-state digest, and throws.

## Local acceptance

Use pinned Node 24.18.0 from the repository root:

```sh
/private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node --check ops/rollback-rehearsal.mjs
/private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node --check ops/test/rollback-rehearsal.test.mjs
/private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node --test ops/test/rollback-rehearsal.test.mjs ops/test/backup-restore-current.test.mjs ops/test/final-release-epoch-v2.test.mjs ops/test/origin-seal.test.mjs
git diff --check
```

The tests use injected in-memory fake process, network, and Pages ports. They neither open a listener nor invoke a service manager, database, provider, or remote endpoint.

## Still open

Before a real rollback rehearsal, the release owner must separately approve and retain evidence for:

- the exact installed successor and available predecessor release directories;
- current production database compatibility and current backup/restore evidence;
- a current Pages fallback deployment observation;
- operator and on-call ownership, stop/abort criteria, and a maintenance window;
- real service stop/start and loopback live/readiness checks on the installed origin; and
- post-rehearsal recovery, installed readback, monitoring, and rollback receipt retention.

Those external gates remain open. This module must not be wired to production process, network, Pages, database, or provider adapters until those gates are explicitly approved.
