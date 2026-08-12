# FIN-004L Responder fulfillment queue provenance

Date: 2026-08-12
State: proved
Candidate branch: `integration/final-successor-20260811`

Proved implementation commit:
`933a26572842abb164a625c5245abc694f5aa9ef`

Proved tree: `4752e616579fbbd69cb570794abfa67de62ad96b`

## Authority and source

- Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`.
- Preserved union donor: `a81d1438fd57e62e44b917c803988301945ef2ef`.
- Responder core, root, surface, and coordinator authorities: FIN-004C,
  FIN-004I, FIN-004J, and FIN-004K.
- The prior all-ref audit found no preserved durable Responder fulfillment
  queue or repository to import. This is new root-owned code joined to the
  already-proved Responder core.
- No route, public artifact, provider adapter, process allowlist, credential,
  adjacent-system source, or live environment changed in this slice.

## Changed paths

- `server/data-plane/supabase/migrations/202608120125_responder_fulfillment_queue.sql`
- `server/data-plane/tests/migration-verification-inventory.mjs`
- `server/hosted/responder-core-postgres.mjs`
- `server/hosted/responder-fulfillment-postgres.mjs`
- `server/hosted/test/responder-core-postgres.integration.test.mjs`
- `server/hosted/test/responder-fulfillment-migration.test.mjs`
- `server/hosted/test/responder-fulfillment-postgres.test.mjs`
- this provenance record and `BUILD-LEDGER.md`

## Database and authority contract

Migration 125 adds one held-default, forced-RLS delivery-operation queue and
its immutable event history. Each operation has a stable internal delivery
and reconciliation identity and contains only durable identities plus
route/content digests. Raw
contact information and message content are not stored in the queue.

The Responder runtime control may enter `approved_live` only through an
operator-capability-gated, evidence-bound update. The migration itself cannot
lift the hold. The release evidence is immutable, global kill remains
available after release, and a claim is rejected unless runtime authority,
contact consent, and an open interaction all remain current.

The PostgreSQL repository claims with `FOR UPDATE ... SKIP LOCKED`, binds each
claim to a bounded lease and worker identity, and records exact provider
acceptance. Only explicitly retryable pre-acceptance failures enter bounded
backoff. The fifth failure dead-letters for operator review. Ambiguous results
enter manual review immediately, and stale lease ownership cannot mutate an
operation.

Every held-message reservation now creates its delivery operation in the same
transaction. A current global kill creates a held operation; released and
eligible authority creates a queued operation; ineligible authority creates a
cancelled operation. Replays preserve the original result and safely repair a
pre-migration message only into a non-effectful state. Engaging global kill
updates the runtime control before recording the command.

## Focused, PostgreSQL, and cumulative proof

- Migration, repository, core, and coordinator focused ladder: 79/79 passed.
- A disposable PostgreSQL 16 database applied all 78 canonical migrations.
- The migration verifier passed the complete inventory and contract checks.
- The real PostgreSQL journey proved held reservation, immutable event
  history, evidence-bound test release, queued reservation, leased claim,
  digest-only simulated provider acceptance, replay, STOP, handoff, global kill,
  cross-tenant denial, and customer/operator projections.
- Cumulative hosted-service ladder: 823 tests, 813 passed, zero failed, and 10
  intentional database integration skips.
- Syntax checks and `git diff --check` passed.

The complete clean-tree `npm test` ladder ran at the exact implementation
commit and tree above and exited `0`:

- cumulative Node ladder: 863/863 passed;
- hosted-service ladder: 813 passed, zero failed, 10 intentional skips;
- operations ladder: 205/205 passed;
- Pages artifact: 90 explicitly reviewed files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 hosted routes at 320x720, 390x844, and 1440x1000.

No live provider, network, public route, DNS, credential, predecessor, or
adjacent-system mutation occurred.

## Remaining blockers

- Held production Responder worker factory and process-purpose composition.
- Twilio fulfillment adapter/readback contract and owner-gated provider
  release. The separately mapped HQ phone bridge remains an adjacent operator
  integration, not the SMS provider.
- The other mandatory worker purposes and hosted Care/Responder UI shell.
- FIN-005 through FIN-010 outside-lane, integration, catalog, database,
  staging, acceptance, and owner-approved cutover work.
