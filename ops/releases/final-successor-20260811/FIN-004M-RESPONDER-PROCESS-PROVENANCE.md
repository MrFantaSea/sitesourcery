# FIN-004M Responder worker-process provenance

Date: 2026-08-12
State: proved
Candidate branch: `integration/final-successor-20260811`

Proved implementation commit:
`8c1734b687cde279024b4aae2cc8d628b68b08c3`

Proved tree: `4d4e4328025c55e34b7282cfef5f6b59a5705ab4`

## Authority and source

- Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`.
- Preserved union donor: `a81d1438fd57e62e44b917c803988301945ef2ef`.
- Responder coordinator and durable queue authorities: FIN-004K and FIN-004L.
- No preserved Responder process-purpose factory existed in the all-ref audit;
  this is new root-owned composition over the proved worker and repository.
- No provider adapter, credential, database migration, public artifact, route,
  deployment state, or adjacent-system source changed in this slice.

## Changed paths

- `server/hosted/worker-config.mjs`
- `server/hosted/worker-responder-composition.mjs`
- `server/hosted/responder-fulfillment-worker.mjs`
- `server/hosted/bin/worker.mjs`
- `server/hosted/test/worker-responder-composition.test.mjs`
- `server/hosted/test/responder-fulfillment-worker.test.mjs`
- `server/hosted/test/worker-process.test.mjs`
- `ops/origin-seal-runtime.mjs`
- `ops/origin-seal-repository.mjs`
- `ops/workers.env.example`
- `ops/SITESOURCERY-WORKERS-01-HELD-RUNBOOK.md`
- this provenance record and `BUILD-LEDGER.md`

## Process contract

`responder-fulfillment` is now a canonical supervised purpose in the separate
worker process. It shares the bounded process loop contract, dedicated worker
PostgreSQL allocation, owner-approval file fence, all-dependencies-before-any-
start rule, reverse graceful shutdown, and immutable held origin evidence.
The API process still owns zero worker loops.

Held Responder composition constructs the durable queue repository and a
non-effectful held provider boundary only. It does not load a provider module,
credential, contact route, or message content, and the worker cannot claim a
queue row. Its readiness is deliberately false even when the held-capable
queue is verified.

`approved_live` construction requires an injected provider port with exact
provider-effect and provider-enforced-idempotency declarations plus verified
readiness. The production default supplies no such adapter and fails with
`WORKER_DEPENDENCY_NOT_READY`. Therefore a process approval file or environment
mode alone cannot activate Responder delivery.

The worker's held contract now requires a distinct effect-free port shape,
rather than an effect-capable provider object that happens not to run. The
held environment template and origin seal both bind the new purpose and
`SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MODE=held`.

## Focused and cumulative proof

- Process composition, held/approved provider boundary, source separation,
  configuration, and origin seal: 32/32 passed.
- Cumulative hosted-service ladder: 828 tests, 818 passed, zero failed, and 10
  intentional database integration skips.
- Syntax checks and `git diff --check` passed.

The complete clean-tree `npm test` ladder ran at the exact implementation
commit and tree above and exited `0`:

- cumulative Node ladder: 863/863 passed;
- hosted-service ladder: 818 passed, zero failed, 10 intentional skips;
- operations ladder: 205/205 passed;
- Pages artifact: 90 explicitly reviewed files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 hosted routes at 320x720, 390x844, and 1440x1000.

No live provider, network, public route, DNS, credential, predecessor, or
adjacent-system mutation occurred.

## Remaining blockers

- Phone-bridge fulfillment adapter/readback contract and owner-gated provider
  release.
- The other mandatory worker purposes and hosted Care/Responder UI shell.
- FIN-005 through FIN-010 outside-lane, integration, catalog, database,
  staging, acceptance, and owner-approved cutover work.
