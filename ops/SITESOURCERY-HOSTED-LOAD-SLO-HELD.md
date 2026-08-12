# Hosted load and SLO acceptance — held

Status: local fixture only; no production or release authority

This packet adds the missing composition-level acceptance harness and retained
receipt contract. It does not replace the existing runtime tests and it cannot
claim an installed deployment meets an owner-approved production SLO.

## Existing proof retained

- INGRESS-01 already bounds body size, concurrent requests, request deadlines,
  and fixed `503`/`504` responses in `server/hosted/node-handler.mjs` and
  `server/hosted/ingress-policy.mjs`.
- PG-OPS-01 already separates the API and external-worker PostgreSQL budgets,
  bounds acquisition, and exposes PII-free saturation counters in
  `server/hosted/repository-postgres.mjs` and
  `server/hosted/postgres-budget-config.mjs`.
- READINESS-01 already caches and singleflights a bounded dependency snapshot in
  `server/hosted/readiness-snapshot.mjs`.
- WORKERS-01/02 already enforce purpose allowlists, serial cycles, bounded
  backoff, reverse shutdown, and a shutdown deadline in
  `server/hosted/worker-supervisor.mjs` and the purpose workers.

The missing proof was one local acceptance that composes those boundaries and
emits one exact held receipt without touching a runtime, database, provider,
listener, or network. Existing production modules expose no complete queue
depth, oldest-age, and admission-backpressure boundary, so this packet does not
simulate one or claim that gate is closed.

## Local acceptance

Run with pinned Node 24.18.0 after the exact source commit and tree are known:

```sh
node ops/hosted-load-slo.mjs run \
  --output /absolute/retained-evidence/hosted-load-slo.json \
  --run-id load-slo-local-20260811 \
  --observed-at 2026-08-11T18:00:00.000Z \
  --source-commit <exact-40-hex-commit> \
  --source-tree <exact-40-hex-tree>
```

The output path must be absent under a real directory. The writer uses an
exclusive immutable-evidence write and refuses overwrite. The receipt binds:

- ingress admission, overload rejection, retry guidance, and deadline abort;
- exact API and worker PostgreSQL process budgets, one saturated acquisition,
  bounded timeout, and zero active or queued work afterward;
- one dependency read for twenty concurrent readiness reads plus a cache hit;
- reverse graceful worker stop, idempotent repeated stop, and fail-closed
  shutdown-deadline enforcement;
- caller-supplied local-fixture commit/tree labels, exact Node version, local
  profile, held authority, OPEN production queue gates, and a canonical digest.

The CLI does not independently verify Git. Its source SHAs are classified only
as `caller_supplied_local_fixture_identity` and are not installed-release or
repository-cleanliness evidence.

Expected receipt truth remains `productionReady: false`. Customer, payment,
mail, DNS, provider, and publication capabilities remain held. No network,
database, listener, credential, approval, provider, publication, or production
effect occurs.

The receipt keeps `productionQueueDepth`, `productionQueueOldestAge`, and
`productionQueueBackpressure` explicitly `open`. Those OPEN gates require real
repository/runtime telemetry and are never inferred from an in-memory array or
invented error code.

## Production blockers

This receipt closes only the local contract gap. Production acceptance still
requires all of the following as separate reviewed inputs and retained proof:

1. An owner-approved production SLO and traffic profile; the fixture numbers
   are test mechanics, not business or capacity authority.
2. The exact deployed release identity, artifact identity, migration inventory,
   listener topology, and held operations-state readback.
3. Conservative load from an approved private staging source against that exact
   deployment, including latency distributions and error budgets.
4. Real queue-depth and oldest-age telemetry for every enabled worker purpose,
   with alert thresholds and a controlled backpressure/failure drill.
5. Graceful API and worker drain under the real service manager, followed by
   readiness, data-integrity, and restart proof.
6. Independent monitor, alert delivery, dead-man, rollback, and replacement-host
   evidence. None is inferred from this local receipt.
