# Hardened domain orchestration

This directory is the provider-neutral, server-side authority for Site
Sourcery's in-app domain flow. It is based on product commit `2ded913` and
integrates the stricter semantics developed in the isolated
`sitesourcery-domain-control` module.

It is under `PUBLICATION_HOLD`. The repository contains:

- an account-scoped command boundary, but no HTTP listener;
- a deterministic in-memory transactional repository for tests;
- deterministic fake registrar, payment, and one-time-secret ports;
- adapters that explicitly refuse every external capability;
- a held-by-default, mock-transport-tested Spaceship registrar adapter;
- a fail-closed exact-price preview interface and zero-call readiness check;
- a relational migration contract;
- orchestration and adversarial tests.

There are no Stripe keys, Spaceship keys, MCP/OAuth tokens, DNS calls, provider
calls, provider SDKs, package additions, installs, or deployment actions.

## Customer path

The rehearsed registration path is:

```text
customer + tenant session
  → agency/registrar/contact consent
  → no-charge registrar preview
  → exact price consent
  → durable payment-authorizing state
  → exact purpose-bound manual authorization
  → fresh no-charge registrar preview
  → durable confirm-dispatching state
  → one irreversible fake confirmation
  → async operation result
  → durable active-payment-pending state
  → domain + registrant-contact readback
  → exact idempotent capture
  → active/reconciliation
```

The caller never supplies authoritative tenant, customer, actor, role, price,
payment purpose, provider charge, contact IDs, or order state. Trusted session
fields overwrite body fields in `account-boundary.mjs`.

## Guarantees implemented

- Exact tenant and customer ownership checks return an opaque `404` across
  boundaries.
- Each command ID is scoped to a tenant and fingerprint. Same input replays;
  changed input conflicts; pending external work is a stop sign.
- Order CAS, audit append, outbox append, and command completion are one
  repository commit.
- Every audit event has a matching outbox record.
- Payment authorization uses manual capture and is bound to a SHA-256 digest of
  tenant, customer, project, order, domain, exact accepted price, fee, and
  consent evidence.
- Authorization, registrar confirmation, post-registration capture, refund,
  and transfer each persist a pre-dispatch state.
- Ambiguous irreversible registration and refund effects are never
  automatically retried.
- Registration success is not enough to capture. The domain must read back as
  registered with the exact prepared customer registrant contact ID.
- Customer capture is never higher than the accepted registrar amount plus the
  disclosed service fee. A lower provider price lowers customer capture.
- Renewal is deliberately manual/fail-closed. There is no billed renewal port.
- Refunds call a purpose-bound, amount-bound, idempotent payment port.
- Transfer eligibility is provider/registry-derived. Raw EPP/auth codes go
  directly to a one-time secret port and are absent from orders, command
  results, audit, outbox, and custody exports.
- Custody export requires the exact authenticated tenant/customer and redacts
  provider contact references.

## Runtime

The exact runtime is Node **24.18.0**, recorded in `.nvmrc`, `package.json`, and
`assert-runtime.mjs`. Node 20 is EOL and is not production-ready.

Node 24.18.0's built-in `node:sqlite` remains a stability-1.2 release-candidate
API. This integration does not import or depend on it. A future local SQLite
adapter requires separate durability, migration, concurrency, backup, and
restore evidence.

The hosted PostgreSQL implementation lives in
`server/hosted/domain-postgres-runtime.mjs` and migration
`202607280014_safe_domain_authorization.sql`. It corrects the original schema's
unsafe capture-before-registrar ordering: a separate, purpose-bound Stripe
manual authorization precedes registration; capture follows only exact
registrar operation, final-price, domain, and customer-registrant readback.
DNS changes use the same durable dispatch/readback pattern. No Cloudflare
registrar or DNS dependency is introduced.

## Verification

From the repository root, using exact Node 24.18.0:

```sh
npm run test:domain
npm run test:spaceship
npm run test:node
```

The domain suite performs no network or filesystem mutation beyond reading the
checked-in migration.

## Production blockers

The migration is a contract, not an installed database. The memory adapter is
not production persistence. The Spaceship implementation is not live
composition: it has no credential vault, contact vault, authenticated exact
price bridge, written reseller consent, or owner release approval. See
`SPACESHIP-PROVIDER.md`, `ADAPTER-CONTRACT.md`, and `RUNBOOK.md` before
considering any live wiring.
