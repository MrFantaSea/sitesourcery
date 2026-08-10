# WORKERS-02 wiring notes

WORKERS-02 closes the explicit WORKERS-01 export/cancellation residual without
a migration. It changes no durable schema, provider control, legal authority,
commercial switch, DNS, or deployment state.

## Exact process shape

- `server/hosted/bin/server.mjs` is unchanged and starts zero loops.
- `server/hosted/bin/worker.mjs` remains the sole external loop entrypoint and
  retains the independent `workerReservedConnections` pool.
- `createCanonicalPostgresWorkerPorts` accepts only canonical `export` and/or
  `cancellation` purpose authority. It returns only a schema plus the selected
  exact readiness/process port; it does not require or expose identity,
  registration, recovery-mail, HTTP, customer, or generic service methods.
- The cancellation port calls the existing `processPaymentOutbox` closure, so
  its `FOR UPDATE SKIP LOCKED` lease, provider idempotency key, effect-certainty
  classification, five-minute known-no-effect delay, and PostgreSQL `infinity`
  ambiguous hold are unchanged.
- The export port calls the existing `processQueuedExports` closure, so attempt
  numbers, expiring leases, worker identity, fence tokens, deterministic object
  keys, write reconciliation, and stale-worker rejection are unchanged.

## Fail-closed activation

The checked-in worker configuration remains `activation: held`.
`SITESOURCERY_EXPORT_WORKER_MODE` and `SITESOURCERY_STRIPE_MODE` also remain
`held`. A held export purpose constructs no object store or PostgreSQL worker
port. Cancellation readiness requires both canonical PostgreSQL readiness and
an exact `approved_live` Stripe readback. Export readiness requires canonical
PostgreSQL readiness and its already-validated private object store. All
selected factory/readiness checks finish before the supervisor starts any
worker.

The versioned supervisor loop owns interval/backoff values. Legacy
purpose-specific interval/backoff variables remain accepted only when they
equal those values; drift fails before provider or queue work. Purpose-specific
batch bounds remain unchanged.

## Integration and proof

Cherry-pick the WORKERS-02 commit after the integrated MAIL+WORKERS base
`d84a8d4e128cd731000eedb84b57cd13ad5e781c`. No migration-inventory or release
tuple update is required. Preserve the existing systemd candidate and worker
pool budget. Before any later owner activation, repeat the held runbook's
release, approval, purpose-readiness, lease-recovery, shutdown, and pool-sum
proofs with the installed release. This packet performs none of those live
steps and grants no provider, customer, publication, or deployment effect.
