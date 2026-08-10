# Site Sourcery PostgreSQL budgets — held operator notes

This is an offline measurement and configuration procedure. It grants no
database, deploy, provider, customer, or commercial authority.

## Invariants

- The versioned config is mandatory and exact; unknown, missing, fractional,
  negative, or out-of-range values stop startup.
- `apiConnections + workerReservedConnections` equals `totalConnections`.
- The physical pool does not exceed ten unless an exact held request is
  present, and can never exceed the conservative hard ceiling of 24.
- API admission cannot consume the worker reserve. Until WORKERS-01 supplies a
  separate worker process and pool, the reserve remains protected but unused.
- Every canonical transaction sets `statement_timeout`, `lock_timeout`, and
  `idle_in_transaction_session_timeout` locally in the same parameterized
  setup projection as the transaction-local principals. Commit or rollback
  removes every setting.
- Acquisition timeout errors expose only a stable code and generic message.
  Telemetry is aggregate counts and milliseconds only.

## Held measurement plan

1. In a disposable, non-production fixture, record p50/p95/p99 pool wait and
   transaction duration for read, write, compile, and worker-shaped fixtures.
2. Increase concurrency until the eight-transaction API admission ceiling
   saturates. Confirm queued work either acquires within 5 seconds or returns
   `DATABASE_ACQUISITION_TIMEOUT`, and confirm late clients are released.
3. Exercise a statement beyond 15 seconds, a lock wait beyond 3 seconds, and an
   idle transaction beyond 30 seconds. Confirm only the transaction fails and
   rollback/release returns active and queued counts to zero.
4. Repeat at steady state for at least twice the longest timeout. Assert pool
   total never exceeds the configured total and the public readiness response
   remains boolean-only.
5. Record only aggregate latency, saturation, timeout, and connection counts.
   Do not record SQL, parameters, URLs, principals, tenant IDs, request bodies,
   connection strings, or provider payloads.

## Tuning rule

Prefer lowering work concurrency or shortening transactions before raising the
physical pool. A proposed increase requires a new exact held config, explicit
capacity evidence for PostgreSQL and the reverse proxy, and separate release
approval. This packet itself neither applies nor approves such a change.

## Rollback

Restore the preceding exact config and restart only through the separately
approved release procedure. Because this packet adds no migration or persisted
state, rollback is configuration/code-only. If saturation remains elevated,
keep customer-effecting capabilities held and diagnose offline.
