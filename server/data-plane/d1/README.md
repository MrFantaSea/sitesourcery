# SQLite/D1 launch data plane

This is the launch-primary Site Sourcery/Abracadabra SQLite contract. It can run
on Cloudflare D1, but Cloudflare remains a deployment candidate rather than a
schema dependency. The PostgreSQL schema in `../supabase/` is an executable
portability and future-scale reference.

No migration or test in this directory calls Cloudflare, Stripe, DNS, email, or
any hosting provider.

## Apply

For a configured development D1 database:

```sh
wrangler d1 migrations apply DATABASE_NAME --local
```

Do not apply remotely until the database binding, Worker repository, legal
document rows, approved catalog, Stripe webhook verifier, and release authority
are reviewed together.

## Enforced launch posture

- `commerce_control.checkout_enabled = 0`.
- `commerce_control.live_mode = 0`.
- `domain_procurement_control.purchasing_enabled = 0`.
- `domain_procurement_control.live_mode = 0`.
- No active registrar adapter or domain legal-document version is selected.
- No catalog plan, variant, entitlement, price, Stripe ID, or provider object is
  seeded.
- The only commercial/lifecycle seed is the reviewed 14-day grace / 90-day
  retention policy.
- A checkout intent cannot be inserted while checkout is disabled.
- Checkout currency and amount must exactly equal an approved active catalog
  price when a later migration enables checkout.
- Stripe subscription state requires a matching immutable Stripe provider
  receipt.
- Stripe event IDs, external provider objects, hostnames, release requests,
  outbox dedupe keys, and idempotency keys are unique in the database.

## Provider-neutral domain procurement

`0005_domain_procurement.sql` models Site Sourcery as the storefront and
authorized registration agent while the customer remains the registrant:

- `domain_quotes` binds the registration or renewal domain, currency, customer
  price, registrar cost, renewal price/disclosure, expiry, and quote digest to
  an immutable provider receipt.
- `domain_registrant_snapshots` stores only an encrypted contact envelope, its
  digest, algorithm, and key version.
- `domain_agent_consents` binds the exact quote, registrant snapshot, legal
  document, term acceptance, authorization statement, and irreversible warning.
- `domain_payment_allocations` accepts only exact captured Stripe evidence.
- `domain_registration_intents` consumes each quote, consent, and payment once
  and enforces an organization-scoped idempotency key.
- `domain_irreversible_confirmations` is a separate, immutable last-click
  barrier. An expired quote cannot cross it.
- `domain_provider_operations` and their immutable events are asynchronous and
  provider-neutral. A register operation is rejected until the barrier exists.
- `domain_registrar_debits` records the registrar-side debit separately and
  explicitly rejects Stripe as the registrar.
- `domain_registrations` proves the successful provider result while retaining
  `customer_is_registrant = 1` and `site_sourcery_role = 'authorized_agent'`.
- DNS change sets, renewal intents with fresh terms/payment/disclosure,
  transfer-out requests and encrypted authorization-code exports, and manual
  review records complete the lifecycle.

The repository exposes transactional boundaries for intent creation,
irreversible confirmation, provider-operation enqueueing, and verified
registration success. Outbox and audit rows commit in the same D1 `batch()`.
Provider requests contain IDs/digests; registrant plaintext is not placed in
outbox payloads.

Project terminal purge deliberately does not erase an active customer-owned
domain or its transfer rights. Domain ownership, transfer, financial, and legal
retention have a separate lifecycle; the encrypted registrant envelope can be
cryptographically retired by key version after that lifecycle allows it.

## D1 differences from PostgreSQL

### No row-level security

The D1 binding must only be available to the Worker. It is never exposed to a
browser. Every tenant-owned table repeats `organization_id`, and child rows use
composite foreign keys such as:

```sql
FOREIGN KEY (organization_id, project_id)
  REFERENCES projects(organization_id, id)
```

Every repository read or mutation takes `organizationId`, uses
`WHERE organization_id = ? AND id = ?`, and checks an active membership. Tests
exercise cross-tenant IDs and prove they do not resolve or mutate.

### No advisory locks or server stored procedures

Critical mutations are expressed as D1 `batch()` transactions, uniqueness
constraints, state-gate triggers, and optimistic `revision` predicates.
Terminal deletion is owned by `beginTerminalPurge()` and
`finalizeTerminalPurge()` in `src/repository.mjs`.

Every destructive statement also requires a matching `deletion_requests` row in
the `purging` state. Immutable artifacts, versions, releases, and support
content have delete guards that reject deletion outside this boundary.

### No generated cryptographic digest

D1 stores artifact bytes as `BLOB`, plus a separately supplied SHA-256 and exact
byte count. The repository computes the SHA-256 with Web Crypto and does not
accept a caller-provided artifact digest. Database checks enforce digest shape,
artifact bounds, and exact byte count. Deployment receipts must repeat the
exact digest and release tuple.

PostgreSQL instead generates the artifact digest from `bytea` using `pgcrypto`.

### No interval type

Billing policy durations use integer seconds:

- grace: `1,209,600` seconds (14 days)
- retention: `7,776,000` seconds (90 days)

### External object deletion

Database bytes are removed during the seal transaction. R2/export object keys
enter `deletion_object_queue`; the tombstone trigger rejects finalization until
every queued object reports `succeeded`.

## Test

From the package root:

```sh
npm test
```

This applies every migration to a fresh SQLite database, runs plain SQL schema
assertions, and exercises repository behavior through a D1-compatible adapter.
