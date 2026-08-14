# FIN-006A Domain root provenance

Date: 2026-08-14  
State: proved subcohort; FIN-006 remains active  
Candidate branch: `integration/final-successor-20260811`

Proved implementation commit:
`19ee68452f34d35e80cb667c50b4670cf2891842`

Proved tree: `17c24f68212da12eb3ba022fdd282cfb8ef6def7`

## Authority and source

- FIN-006A is a root-composition repair over the already integrated canonical
  PostgreSQL Domain runtime. It imports no donor branch and adds no migration.
- The production hosted root previously constructed `createHeldDomainRuntime`,
  an unmounted no-database stub, although the complete PostgreSQL runtime and
  HTTP routes already existed.
- This subcohort mounts that existing implementation in an explicit
  PostgreSQL-backed held mode. It does not install Spaceship or Domain Stripe
  credentials, release a provider purpose, start a worker, or authorize a
  customer purchase.

## Changed paths

- `server/hosted/bin/server.mjs`
- `server/hosted/domain-postgres-runtime.mjs`
- `server/hosted/http.mjs`
- `server/hosted/test/domain-postgres-runtime.integration.test.mjs`
- `server/hosted/test/http-capabilities-snapshot.test.mjs`
- `server/hosted/test/http-commerce-v2.test.mjs`
- `server/hosted/test/stripe-production-config.test.mjs`
- this provenance record and `BUILD-LEDGER.md`

## Composition and authority

The production root now constructs `createPostgresHeldDomainRuntime` from the
canonical PostgreSQL authority and the configured contact vault. Its provider
ports are local held adapters whose every method fails with exact
`not_submitted` certainty. Startup fails unless the Domain runtime proves:

- PostgreSQL readiness and mounted implementation;
- `mode=held` and `purchaseReady=false`;
- registrar, payment, and DNS purposes held; and
- provider effects, remote writes, and automatic commands false.

The mounted held runtime allows only tenant-scoped PostgreSQL reads. Search,
quote, registrant-contact storage, legal consent, payment, provider readback,
registration, reconciliation, and DNS mutations stop behind explicit held
gates. The stub constructor remains available for incomplete test fixtures and
reports `mounted=false` rather than masquerading as an implemented capability.

`getDomainOrder` now requires an active `owner`, `admin`, or `billing`
membership. An active editor receives the same not-found result as an
unauthorized tenant and cannot read Domain billing state.

Runtime readiness separates authority from transient health. Registrar,
payment, and DNS readiness are derived independently and require a ready
database, approved control state, a non-held mode, and the corresponding
adapter. Approved-live effect authority remains visible even when a provider
is temporarily unhealthy; held mode cannot be mislabeled ready even if a
caller injects ready-looking ports.

## Capability and routes

The existing Domain HTTP routes remain mounted. `/api/v1/capabilities` now
projects a bounded `domains` object containing mounted/verified state, runtime
mode, independent registrar/payment/DNS state, purchase readiness, and exact
effect posture. `domainPurchase` is true only when the runtime itself reports
`purchaseReady=true`; a mounted held implementation reports ready for local
service while purchase remains false.

## Focused and PostgreSQL proof

- Syntax and `git diff --check` passed.
- The final focused Domain/root/HTTP/configuration set reported 40 passes,
  zero failures, and the one expected PostgreSQL skip when no database URL was
  supplied.
- A disposable PostgreSQL 16 database applied all 87 migrations and reported
  2/2 passing tests: the approved-live partial-outage readiness contract and
  the full normalized Domain purchase/readback journey.
- The PostgreSQL proof includes owner-positive and active-editor-negative
  order reads. It also proves held contact/consent/search/quote/payment calls
  leave registrant snapshots, term acceptances, consents, provider calls, and
  contact-vault calls unchanged.
- The exact disposable database `ss_fin006a_domain_20260814` was dropped and
  its absence was verified.
- A bounded adversarial review finished `CLEAR` after all authority and
  readiness findings were corrected.

## Clean cumulative proof

The first full run deliberately reached the release-control clean-tree gate;
four operations assertions rejected the dirty implementation tree as designed.
After the implementation commit above, the exact clean tree completed
`npm test` with exit zero:

- canonical Node 24.18.0 checks passed;
- hosted/service reported 1,006 tests: 992 passed, zero failed, and 14
  intentional PostgreSQL skips;
- operations reported 205/205 passes;
- Pages rebuilt and verified 90 explicitly reviewed files;
- the hosted artifact rebuilt and passed HTML validation; and
- the current browser audit passed 15 hosted routes at 320x720, 390x844, and
  1440x1000.

## Effects and remaining work

- Public placeholder, DNS, Cloudflare, Pages, providers, HQ, Dell, protected
  databases, deployment, and cutover were untouched.
- No provider credential or live adapter is present in this Domain root.
- FIN-006 remains open. The remaining capability rows must be reconciled
  against actual root/process composition with positive HTTP, negative
  role/tenant, persistence, readiness, and held-effect evidence before the
  unified composition cohort can be sealed.
- FIN-007 through FIN-010 remain unchanged and owner-gated where specified.
