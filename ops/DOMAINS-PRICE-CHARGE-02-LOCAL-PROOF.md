# DOMAINS-PRICE-CHARGE-02 local proof

This slice is held. It adds no registrar, Stripe, refund, DNS, renewal,
publication, or deployment authority.

## Implemented boundary

- `server/hosted/domain-price-charge-boundary.mjs` authenticates an exact
  customer/project scope before any provider price preview.
- The same read-only route selection handles provider-classified `standard`
  and `premium` prices and persists the exact USD amount, provider route,
  quote expiry, price class, and fingerprint in migration 119 state.
- Final-charge preparation begins from one durable registration attempt. It
  verifies successful provider operation and customer-registrant readback,
  then requires a separate read-only final-charge response bound to the exact
  provider, domain, operation, quote, amount, currency, route expiry, and a
  fresh evidence expiry.
- Amount, currency, domain, provider, quote, operation, route-expiry,
  evidence-expiry, or ambiguity drift fails before the provider pin or final
  charge evidence can be persisted.
- Raw provider quote, operation, and registrar-charge references appear in
  customer/operator projections only as SHA-256 digests. Both projections say
  `captureAuthorized: false` and `refundAuthorized: false`.
- The boundary exports only quote and evidence-preparation methods. It accepts
  no payment adapter and cannot capture or refund.

## Deterministic proof

Use the repository's exact Node 24 runtime:

```sh
/private/tmp/node-v24.18.0-darwin-arm64/bin/node --test \
  server/hosted/test/domain-price-charge-boundary.test.mjs \
  server/domain/test/provider-contingency.test.mjs \
  server/domain/test/service-provider-contingency.test.mjs \
  server/data-plane/tests/postgres-migration-structure.test.mjs
```

Fresh PostgreSQL 16 proof:

```sh
SITESOURCERY_PG_CORE_RELEASE_ADMIN_URL=postgresql:///postgres \
  /private/tmp/node-v24.18.0-darwin-arm64/bin/node \
  server/data-plane/tests/verify-empty-postgres-migrations.mjs
```

Expected evidence includes:

```text
Applied 71 migrations with the exact joint legal V3 production tuple.
domainProviderRoutePersistencePostgresProof true
domainPriceChargeHeldPostgresProof true
databaseAbsent true
```

## Remaining gates

- Bind the held route/quote/charge boundary into the hosted customer and
  operator HTTP runtime, consent, manual-authorization, and capture workflow.
- Implement and contract-review the standard/premium price and final-charge
  read methods for an approved registrar; the current Spaceship adapter still
  fails closed because its public contract cannot prove either fact.
- Obtain written resale/agency authority and an approved secondary provider;
  install restricted credentials and registrant PII in approved vaults.
- Approve versioned provider-aware agency, registration, privacy/WHOIS, TLD,
  transfer, irreversible-purchase, and renewal disclosures and record exact
  customer consent.
- Complete provider-fee and customer-price tax classification and the required
  Stripe Tax registrations/settings.
- Prove real-provider registration, operation/domain/ownership/charge readback,
  Stripe manual capture, ambiguity/refund, DNS, transfer, expiration notices,
  and renewal in a held test environment.

Automatic renewal remains absent and fail-closed.
