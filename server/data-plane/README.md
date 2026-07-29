# Site Sourcery data plane

Executable SQLite/D1 launch data plane plus a PostgreSQL/Supabase portability
schema for the hosted Abracadabra control plane.

This package is intentionally isolated from the website repository. It performs
no deployment, Stripe, DNS, email, or hosting-provider calls.

## Launch posture

- Checkout is seeded disabled.
- Domain purchasing is independently seeded disabled, with no active registrar
  adapter or legal-document selection.
- No catalog price, Stripe customer, Stripe price, product, subscription, or
  provider object identifier is seeded.
- SQLite tenant boundaries use composite tenant foreign keys and repository
  predicates; PostgreSQL tenant data uses forced row-level security.
- Customer-authored content is immutable after version creation and can only be
  removed through the terminal-purge boundary.
- Serving only becomes live after an immutable release and provider receipt
  exist.
- Domain registration cannot reach a provider operation until an unexpired
  exact quote, encrypted customer-as-registrant snapshot, exact agent/terms
  consent, captured Stripe allocation, and separate irreversible confirmation
  all agree.
- Stripe customer payment and registrar debit are separate immutable receipts.
- Registrar integration is provider-neutral. No registrar or infrastructure
  vendor is selected or called by these artifacts.

## Layout

- `d1/migrations/` — launch-primary portable SQLite/D1 migrations.
- `d1/src/repository.mjs` — tenant-scoped transactional repository boundaries.
- `d1/tests/` — clean-room SQLite schema and behavioral tests.
- `supabase/migrations/` — ordered PostgreSQL portability migrations.
- `supabase/migrations/202607280007_hosted_api_edges.sql` — additive
  same-origin API edges for opaque sessions, exact offer/address quote
  bindings, immutable cancellation evidence, and one-time export downloads.
- `tests/postgres-bootstrap.sql` — minimal Supabase `auth.users` stand-in for disposable
  PostgreSQL validation only.
- `tests/postgres-invariants.sql` — PostgreSQL schema and launch assertions.
- `scripts/test-postgres.sh` — applies all migrations and runs the SQL tests
  against `DATABASE_URL`.

## Validate

Primary clean-room validation:

```sh
npm test
```

This executes every SQLite migration, 12 SQL invariants, repository behavior,
and a structural parity check over the 17-table PostgreSQL domain migration.

Optional validation against an empty disposable PostgreSQL database:

```sh
DATABASE_URL=postgresql://... ./scripts/test-postgres.sh
```

Do not run `tests/postgres-bootstrap.sql` against Supabase. The harness only applies it
when `auth.users` is absent.

## Hosted identity boundary

`auth.users` remains the identity authority. The hosted API migration never
creates or shadows it. Supabase Auth, or a reviewed self-host identity bridge,
must create the `auth.users` row before the API writes
`ss.hosted_account_profiles` and credential/session material. Direct browser
access to password verifiers, session digests, and recovery digests is denied;
only the server-side service role may use those tables.

PostgreSQL is the production system of record. The D1/SQLite lane is retained
for portability and emulator tests only.
