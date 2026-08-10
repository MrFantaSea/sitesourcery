# PG-OPS-01 wiring notes

## Production composition completed here

`server/hosted/bin/server.mjs` parses exactly one required
`SITESOURCERY_POSTGRES_BUDGET_CONFIG` v1 document before creating the pool. Its
validated API budget becomes the API `pg.Pool.max`, its acquisition deadline becomes
`connectionTimeoutMillis`, and the timeout values also bound the pool's direct
readiness queries. The same immutable policy is passed to the canonical
PostgreSQL authority, which reapplies the three PostgreSQL limits locally for
each business transaction. No connection string or credential enters the
configuration or readiness evidence.

The canonical authority owns the API admission ceiling, the end-to-end pool
acquisition deadline, transaction-local PostgreSQL timeouts, transaction-local
role and principal setup, rollback, release, and PII-free counters. Each
transaction uses three setup round trips: `BEGIN` with isolation/read-only,
`SET LOCAL ROLE`, and one parameterized `set_config` projection containing all
timeouts and principals. Forced RLS and the existing role/principal meanings
are unchanged.

## Held operator wiring

1. Copy the exact contents of
   `ops/postgres-budget-config.held.example.json` into the root-owned hosted
   environment as `SITESOURCERY_POSTGRES_BUDGET_CONFIG`.
2. Keep `connectionIncrease` at `none` for a total of ten or fewer. A value
   above ten is rejected unless the same exact config says `held-request`, and
   every value remains capped at 24. The presence of `held-request` is not
   deploy or owner-cutover authority.
3. Read private startup evidence only. The public readiness route remains a
   boolean and receives no pool counts, timing, database address, query, actor,
   tenant, or customer data.
4. Rehearse load and tune only with the held process in
   `ops/SITESOURCERY-PG-OPS-BUDGETS-HELD.md`; do not infer limits from a live
   database.

## WORKERS-01 process split

WORKERS-01 binds the configured API and worker budgets to separate process-owned
pools whose maxima sum to the unchanged total. The API starts no loops and the
worker authority reports `workerScope: dedicated-process`. Export and
cancellation narrow production ports remain fail-closed until the separately
documented MAIL-COMPOSE-FINAL-03 residual is resolved.

No migration, provider action, database mutation, deployment, or commercial
authority is included.
