# FIN-005 preserved-source provenance

Date: 2026-08-14

State: proved

Implementation: `59ee0dd76ee6b56eca888b23e2f52b573a80e880`

Implementation tree: `7f2fed8b8729e077b321e0c87e1c31bccdc3c3fb`

## Inventory closure

`FIN-005-SOURCE-DISPOSITION.json` is the machine-readable denominator. It
classifies all 117 local heads not merged into the frozen successor, including
all eight cleanup archive heads and all 18 refs in the 17 named recent lanes.
It also records the three worktrees, detached baseline, preservation bundles,
standalone repositories, dirty overlays, and non-Git prototypes. No source,
archive, worktree, predecessor, or preservation object was deleted.

The inventory prevented one redundant import. Archive `bc8eed7925d1e1e4a7b33ec5c0088cdb4d280f7a`
contains an older, unmounted Domain UI and parallel ten-route backend. Its
browser proof renders fixtures without calling that backend, and its tax
authority conflicts with the later `disabled_by_owner` decision. The current
successor already contains the fuller customer, API, PostgreSQL, worker, and
operator Domain system. Its truthful root-composition gate remains FIN-006.

## Bounded donor adaptation

Donor: `25d1026a4abbe1a6c43e3d33f6e996cd7045ef2e`.

The donor's useful joined Assessment/Custom lifecycle was adapted to the
current 87-migration epoch. The donor's unrelated cross-tenant operator-mail
row and caller-authored browser step collage were deliberately excluded. The
browser claim is limited to a reviewed render of three actual Abracadabra
artifact validators; mounted installed application journeys remain FIN-009.

Implementation allowlist and SHA-256:

| Path | SHA-256 |
|---|---|
| `server/hosted/commerce-transition-notifications-postgres.mjs` | `70486a6a6eb5cf52ddad6b10bc6f7106095b5afcc82473fb142aa936f7da2550` |
| `server/hosted/test/commerce-transition-notifications-postgres.integration.test.mjs` | `7079e0da91fa3ab9000d711a125ccd2d56f37ef7a872fe5d20c8783d3723e8ec` |
| `server/data-plane/tests/custom-service-quotes-postgres.integration.test.mjs` | `3480bbcc00a32d5c4df348928cde10eeca31f05186f86e71a1202bc45cf7a6d5` |
| `server/data-plane/tests/assessment-custom-artifact-contract-browser.mjs` | `e71e5ee579b42f260e032b27b6cd271a4bfcf758118e0c5c6ccb8227bcdce413` |

## Production correction

The joined journey found that a PostgreSQL `timestamptz` with microseconds was
being read through JavaScript `Date` and written back with millisecond
precision. The exact source-bound outbox trigger could therefore reject a
valid held notification reservation.

The repository now:

- compares `source_occurred_at <= requestedAt` inside PostgreSQL;
- inserts the authoritative organization, project, customer, and source time
  directly from `ss.commerce_transition_notification_sources`;
- requires the `INSERT ... SELECT` to return exactly one row; and
- keeps mail and outbox insertion in the same serializable transaction.

The regression creates a source later within the same JavaScript millisecond,
expects `COMMERCE_NOTIFICATION_SOURCE_UNAVAILABLE`, and proves that zero mail
rows are created. Normal reservations remain held, pending, provider-effect
false, delivery-unclaimed, and without dispatch claims.

## Proof record

- syntax and diff checks: passed;
- commerce notification unit/static: 8 passed, 0 failed;
- PostgreSQL 16 empty epoch: 87 migrations applied and all embedded proofs
  passed;
- commerce notification PostgreSQL regression: 1 passed, 0 failed;
- joined Assessment-to-Custom PostgreSQL proof: 1 passed, 0 failed, including
  the 390x844 three-artifact reviewed browser contract render;
- cumulative `npm test` under exact Node 24.18.0: passed;
  - Node matrix: 877 passed, 0 failed;
  - hosted/service matrix: 990 passed, 14 intentional real-PostgreSQL skips,
    0 failed;
  - operations matrix: 205 passed, 0 failed;
  - public and hosted artifacts rebuilt and verified;
  - browser audit: 15 hosted routes at 320x720, 390x844, and 1440x1000;
- disposable databases `ss_fin005b_review_20260814` and
  `ss_fin005b_seal_20260814`: removed;
- residual proof browser processes: none.

The first cumulative invocation stopped before tests because a child shell
selected Node 26. A canonical-Node invocation then reached the browser tests
but the sandbox denied six loopback listeners. No assertion failed and no code
changed. The exact canonical command was rerun with loopback permission and
completed successfully.

## Retained assignments

- FIN-006: compose and prove the existing Domain and all other root
  capabilities; do not import the obsolete parallel Domain donor.
- FIN-007: use retained UX, catalog, route, and legal donors only through its
  approved reconciliation.
- FIN-009/010: port owner-signature, graph-drift, no-follow, inode, fsync,
  atomic-write, and crash-resume invariants from `6a9dc923...` into the current
  exact-candidate finalizer; do not revive the obsolete V3 Pages workflow.

## Effect state

No public, provider, DNS, mail-delivery, payment, domain, HQ, Dell, protected
database, deployment, cutover, retirement, or deletion effect was authorized
or performed. The public placeholder remains intentional and unchanged.
