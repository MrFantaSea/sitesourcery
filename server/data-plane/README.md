# Site Sourcery data plane

Executable PostgreSQL production data plane plus a SQLite/D1 portability
emulator for the hosted Abracadabra control plane.

This is an isolated server module within the canonical Site Sourcery
repository. It performs no deployment, Stripe, registrar, DNS, email, or
hosting-provider calls by itself.

## Launch posture

- Checkout is seeded disabled.
- Domain purchasing is independently seeded disabled, with no active registrar
  adapter or legal-document selection.
- No catalog price, Stripe customer, Stripe price, product, subscription, or
  provider object identifier is seeded.
- PostgreSQL is the production authority and uses transaction-local principals
  plus forced row-level security. SQLite tenant boundaries use composite tenant
  foreign keys and repository predicates in portability tests only.
- Customer-authored content is immutable after version creation and can only be
  removed through the terminal-purge boundary.
- Serving only becomes live after an immutable release and provider receipt
  exist.
- Domain registration cannot reach a provider operation until an unexpired
  exact quote, encrypted customer-as-registrant snapshot, exact agent/terms
  consent, purpose-bound Stripe manual authorization, a fresh registrar
  reprice, and separate irreversible customer confirmation all agree.
- Stripe capture is forbidden before the registrar reports success and exact
  domain/customer-registrant readback succeeds. An active registration requires
  the resulting partial capture to be normalized as captured.
- Stripe customer payment and registrar debit are separate immutable receipts.
- Registrar integration is provider-neutral. No registrar or infrastructure
  vendor is selected or called by these artifacts.

## Layout

- `supabase/migrations/` — ordered production PostgreSQL migrations.
- `supabase/migrations/202607280007_hosted_api_edges.sql` — additive
  same-origin API edges for opaque sessions, exact offer/address quote
  bindings, immutable cancellation evidence, and one-time export downloads.
- `supabase/migrations/202607280009_authenticated_rls_execution.sql` —
  executable forced-RLS helper contract for real authenticated transactions.
- `supabase/migrations/202607280014_safe_domain_authorization.sql` — additive
  correction to the earlier captured-before-registration rule, plus durable
  authorization attempts, registrar reprices, contact bindings, final-price
  evidence, and DNS upsert/delete projections.
- `tests/postgres-bootstrap.sql` — disposable PostgreSQL role/bootstrap
  compatibility harness.
- `tests/postgres-invariants.sql` — PostgreSQL schema and launch assertions.
- `tests/commerce-v2-download-invariants.sql` — held Download persistence,
  accepted-version binding, and terminal-purge assertions.
- `scripts/test-postgres.sh` — applies all migrations and runs the SQL tests
  against `DATABASE_URL`.
- `d1/migrations/`, `d1/src/`, and `d1/tests/` — SQLite/D1 portability and
  emulator lane; never production authority.

## Validate

SQLite portability/emulator validation:

```sh
npm test
```

This executes every SQLite migration, 12 SQL invariants, repository behavior,
and a structural parity check over the 17-table PostgreSQL domain migration.

Required production-contract validation against an empty disposable PostgreSQL
database:

```sh
DATABASE_URL=postgresql://... ./scripts/test-postgres.sh
```

Do not run `tests/postgres-bootstrap.sql` against an existing production
database. It is a clean-room role compatibility harness.

## Hosted identity boundary

Site Sourcery's first-party identity bridge owns principals in `auth.users` and
the password/session/recovery machinery in `ss`. No Supabase Auth or Clerk
service is required. Direct browser access to password verifiers, session
digests, recovery digests, and rate-limit state is denied; only the server-side
service role may use those tables.

PostgreSQL is the production system of record. The D1/SQLite lane is retained
for portability and emulator tests only.
