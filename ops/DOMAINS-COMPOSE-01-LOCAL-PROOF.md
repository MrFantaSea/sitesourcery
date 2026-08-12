# DOMAINS-COMPOSE-01 local proof

Status: implemented and held. No registrar, payment, DNS, renewal, credential,
deployment, or production authority is created by this work.

## Internal slice closed

The provider-neutral router already supported two provider slots but retained
route and registrar-pin evidence only in its memory orchestration tests. The
hosted PostgreSQL runtime also selected one hard-coded Spaceship adapter.

This lane closes the earliest shared prerequisite without pretending to finish
the customer purchase path:

- migration `202608110119_domain_provider_route_persistence.sql` adds immutable
  provider-route selections, one route-bound registration attempt state
  machine, and immutable registrar-of-record pins;
- every table is tenant scoped with forced RLS, non-cascading foreign keys, and
  least-privilege grants;
- the internal composition persists the selected route before an irreversible
  adapter call, never calls a fallback after selection, and returns a held
  reconciliation result when an existing `dispatching` claim is replayed;
- only an authoritative successful operation plus exact customer-registrant
  readback can create the provider pin; and
- route and pin evidence are append-only. Same-input replay is stable and
  changed reuse conflicts.

The composition has no HTTP route and is not installed in the existing hosted
domain purchase runtime. All proof providers are deterministic local fakes.

## Proof commands

Use exact Node 24.18.0:

```sh
/private/tmp/node-v24.18.0-darwin-arm64/bin/node --test \
  server/data-plane/tests/postgres-migration-structure.test.mjs \
  server/domain/test/provider-contingency.test.mjs \
  server/domain/test/service-provider-contingency.test.mjs
```

For fresh PostgreSQL 16 migration and composed route/pin proof:

```sh
SITESOURCERY_PG_CORE_RELEASE_ADMIN_URL=postgresql:///postgres \
  /private/tmp/node-v24.18.0-darwin-arm64/bin/node \
  server/data-plane/tests/verify-empty-postgres-migrations.mjs
```

The verifier creates one random database, applies the exact migration union,
uses fake providers to prove primary failure and secondary fallback, persists
the attempt before the fake mutation, proves successful readback and pinning,
simulates a post-provider persistence crash, proves replay makes no second
mutation, drops its exact database, and prints both:

```text
domainProviderRoutePersistencePostgresProof true
databaseAbsent true
```

## Remaining gates

This slice must remain held until all of these separate facts exist:

- the existing hosted quote/consent/payment/registration/DNS runtime consumes
  the new persisted route and pin rather than its single-provider facade;
- Spaceship or another acceptable registrar gives written authority for the
  reseller/agency model and an approved secondary adapter exists;
- the successor held price/charge boundary is wired to reviewed real-provider
  methods that supply standard/premium prices without interactive-token
  assumptions;
- the successor final-charge evidence boundary receives real registrar billing
  readback before Stripe capture, including ambiguity and refund reconciliation;
- versioned provider-aware agency, registration, privacy/WHOIS, TLD, renewal,
  transfer, and irreversible-purchase disclosures receive owner/legal approval
  and exact customer acceptance;
- provider fees and the customer-facing Domain price receive explicit tax
  classification and Stripe Tax/registration decisions;
- restricted credentials and registrant PII are installed in approved secret
  and contact vaults with exact scopes and rotation evidence; and
- real provider test proof covers registration, async readback, customer
  ownership, capture, refund, DNS, transfer, expiration notices, and renewal.

Automatic renewal remains absent and fail-closed. No billed renewal may be
added until an exact no-charge renewal-price contract and separate customer
consent/payment/provider evidence exist.
