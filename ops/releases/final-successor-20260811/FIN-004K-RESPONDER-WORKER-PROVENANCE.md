# FIN-004K Responder fulfillment worker provenance

Date: 2026-08-12
State: proved
Candidate branch: `integration/final-successor-20260811`

Proved implementation commit:
`1d352a91843065040576bd6dd08e4488bed2c83e`

Proved tree: `318e54879492575e3f8fd683b66369d9d94d8af3`

## Authority and source

- Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`.
- Preserved union donor: `a81d1438fd57e62e44b917c803988301945ef2ef`.
- Responder core and root authorities: FIN-004C, FIN-004I, and FIN-004J.
- A complete all-ref path audit found no preserved Responder fulfillment
  worker to import. The implementation is therefore new root-owned code, not
  an omitted or renamed donor path.
- No migration, route, capability, provider adapter, process allowlist, public
  artifact, or adjacent-system source changed in this slice.

## Changed paths

- `server/hosted/responder-fulfillment-worker.mjs`
- `server/hosted/test/responder-fulfillment-worker.test.mjs`
- this provenance record and `BUILD-LEDGER.md`

## Worker contract

The coordinator is single-flight and accepts only one exact digest-only
delivery claim at a time. Each claim is bound to:

- one leased operation, worker identity, and attempt number;
- one organization, project, interaction, and consent authority;
- one approved Responder message kind;
- opaque route and content digests only; and
- one stable provider-enforced idempotency key.

The worker has bounded lease and loop durations, bounded exponential error
backoff, an external abort bridge, graceful drain, fixed safe logging, and an
independent `held` or `approved_live` environment control. Held mode cannot
claim storage or call a provider, including through the public `runOnce`
test seam.

Only a provider error explicitly classified `retryable` may enter the retry
transition. Every unclassified, terminal, or ambiguous pre-acceptance failure
enters manual review. If the provider accepts but durable finalization becomes
uncertain, the worker records neither retry nor a second effect instruction;
the stable provider idempotency key remains the reconciliation fence.

The provider port must explicitly declare provider effects and
provider-enforced idempotency. Its narrow request contains digests and durable
identities, never raw contact information or message content.

## Focused and cumulative proof

- Responder fulfillment worker: 6/6 passed.
- Cumulative hosted-service ladder: 816 tests, 806 passed, zero failed, and 10
  intentional database integration skips.
- Syntax checks and `git diff --check` passed.

The complete clean-tree `npm test` ladder ran at the exact implementation
commit and tree above and exited `0`:

- cumulative Node ladder: 863/863 passed;
- hosted-service ladder: 806 passed, zero failed, 10 intentional skips;
- operations ladder: 205/205 passed;
- Pages artifact: 90 explicitly reviewed files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 hosted routes at 320x720, 390x844, and 1440x1000.

No provider, network, public route, database, credential, predecessor, or
adjacent-system mutation occurred.

## Remaining blockers

- Responder PostgreSQL delivery-operation, lease, retry, dead-letter, and
  operator-review authority.
- Held production worker factory and process-purpose composition.
- Phone-bridge fulfillment adapter/readback contract and owner-gated provider
  release.
- The other mandatory worker purposes and hosted Care/Responder UI shell.
- FIN-005 through FIN-010 outside-lane, integration, catalog, database,
  staging, acceptance, and owner-approved cutover work.
