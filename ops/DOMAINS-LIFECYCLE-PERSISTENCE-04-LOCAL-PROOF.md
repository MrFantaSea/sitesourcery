# DOMAINS-LIFECYCLE-PERSISTENCE-04 local proof

Status: canonical PostgreSQL persistence is implemented and locally proven.
Registrar, payment, refund, DNS, credential, HTTP, worker, deployment, and
production effects remain held.

## Installed boundary

- Migration `202608110123_domain_lifecycle_persistence.sql` adds one mutable
  canonical lifecycle snapshot and one append-only command/result journal.
- Every state is bound to the exact organization, project, customer, domain,
  provider code, and immutable migration-119 provider-pin fingerprint.
- State and result documents carry canonical SHA-256 digests. Extracted expiry,
  observation, renewal quote/operation/outcome, transfer operation/outcome,
  and review evidence must match the sealed JSON document. Raw provider domain,
  quote, and operation references are rejected from canonical state.
- Database triggers enforce monotonic revision, expiry, provider observation,
  renewal and transfer transitions, transferred-custody finality, and held
  provider/payment/DNS/capture/refund effects.
- Both tables use forced RLS. Only `service_role` receives the minimal
  select/insert/update privileges required by the repository; command evidence
  is append-only and neither table can be deleted through its public contract.
- `server/hosted/domain-lifecycle-postgres.mjs` performs one serializable,
  tenant-scoped transaction under a per-domain advisory lock. State and the
  command result commit together; exact replay returns retained evidence and a
  reused command ID with changed input conflicts.
- This lane intentionally adds no global runtime, HTTP route, provider adapter,
  worker dispatch, or effect-capable port.

## Deterministic proof

With exact Node 24.18.0:

```sh
env PATH=/private/tmp/node-v24.18.0-darwin-arm64/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  npm run test:domain:compose
```

Result: 83 tests passed, 0 failed.

A fresh isolated PostgreSQL 16 cluster ran
`server/data-plane/tests/verify-empty-postgres-migrations.mjs`. It applied the
exact 72-migration inventory, exercised route/pin creation followed by the
canonical lifecycle repository, and proved:

- exact idempotent replay and changed-input conflict;
- exact pin/tenant binding and cross-tenant absence;
- held renewal ambiguity followed only by matching authoritative expiry;
- held transfer ambiguity followed only by matching authoritative cancellation;
- financial/custody reversal review without expiry or custody rollback;
- rejection of direct expiry rollback and state/command effect-flag lifts;
- exact forced-RLS and least-privilege contracts; and
- verifier-owned database cleanup (`databaseAbsent true`).

No network or external provider call was made. The temporary PG16 cluster was
stopped and removed after proof.

## Remaining gates

- Compose authenticated customer/operator HTTP surfaces against this
  repository without exposing raw provider references.
- Implement approved registrar lifecycle readback, exact renewal quote, renewal
  dispatch, and transfer dispatch/reconciliation adapters through restricted
  credentials and provider-specific staging accounts.
- Add durable notices and owner-approved workers that reserve before effects,
  never auto-retry ambiguity, and preserve the same operation evidence.
- Obtain reseller/agency authority, provider contracts, versioned customer
  consent, TLD/WHOIS/privacy rules, transfer disclosures, and support runbooks.
- Finish provider-fee/customer-price tax classification and Stripe Tax
  registrations/settings before any customer payment or registrar charge.
- Prove hosted backup/restore, migration rollout/rollback, alerting, expiry and
  grace/redemption schedules, renewals, reversals/refunds, and transfer custody
  against real provider test accounts before owner release.

Automatic renewal remains absent and fail-closed.
