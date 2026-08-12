# FIN-004J Responder root provenance

Date: 2026-08-12
State: implementation sealed; exact clean-tree cumulative proof pending
Candidate branch: `integration/final-successor-20260811`

## Authority and source

- Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`.
- Preserved union donor: `a81d1438fd57e62e44b917c803988301945ef2ef`.
- Reconciled Responder surface implementation: FIN-004I commit
  `dfc0ceae10074c2d387bec2ebfadcb94ea39609d`.
- FIN-004J is root-owned composition. It adds no migration and imports no
  additional branch content.

## Changed paths

- `server/hosted/responder-surfaces-http.mjs`
- `server/hosted/http.mjs`
- `server/hosted/bin/server.mjs`
- `server/hosted/test/http-responder-composition.test.mjs`
- `server/hosted/test/responder-production-composition.test.mjs`
- `server/hosted/test/http-capabilities-snapshot.test.mjs`
- `server/hosted/test/http-commerce-v2.test.mjs`
- this provenance record and `BUILD-LEDGER.md`

## Production composition

The production API process now constructs:

1. the migration-120 PostgreSQL Responder core repository;
2. the deterministic digest-only fake provider with effects false;
3. the held Responder core;
4. the PostgreSQL customer/operator projection repository; and
5. the held Responder surface service.

Startup fails unless core and projections are both ready and verified, global
kill is engaged by default, and provider, billing, and sale authority remain
false. The service is then mounted through the existing eleven-route Responder
HTTP boundary.

The raw boundary dispatches after same-origin and webhook handling but before
the generic JSON reader, preserving exactly one bounded command-body consumer.
Responses retain canonical root request IDs and security headers.

## Tenant and authorization contract

FIN-004J factors the already-proved Care organization selection into one
root-owned product-neutral helper and applies the same rule to Responder:

- one active customer organization selects automatically;
- multiple organizations require `X-SiteSourcery-Organization-Id`;
- the selected organization must be present and active in the authenticated
  membership roster;
- operator target organization comes only from the exact route;
- repository-level operator capability and customer/tenant checks remain the
  final authority.

The factor preserves the Care behavior and error codes proved by FIN-004H.

## Capability, effects, and excluded scope

`/api/v1/capabilities` now reports `responder` only when the mounted
composition is ready, verified, held, provider-effect-free, billing-free, and
not sellable. Missing composition reports false.

- No live communications provider or phone bridge is composed.
- No message, call, billing, sale, publication, or external worker effect is
  enabled.
- The public `/responder/` placeholder remains inquiry-only.
- Hosted UI asset/shell composition is still separate from this backend root
  cohort.
- No credential, listener, public placeholder, DNS, Cloudflare route, Dell/HQ
  adjacent system, predecessor, or database was mutated.

## Focused and cumulative proof

- Root/leaf HTTP, security, tenant-selection, production composition,
  capabilities, Care regression, and commerce regression: 28/28 passed.
- Cumulative hosted-service ladder: 810 tests, 800 passed, zero failed, and 10
  intentional database integration skips.
- Syntax checks and `git diff --check` passed.

FIN-004I already supplies the fresh real PostgreSQL journey for the exact core
and surface repositories now mounted here. The complete clean-tree `npm test`
ladder remains required immediately after this implementation commit.

## Remaining blockers

- Held Responder fulfillment worker and the remaining explicit worker
  purposes.
- Hosted authenticated Care and Responder UI asset/shell composition.
- FIN-005 outside-lane disposition closure.
- FIN-006 adjacent integration contracts for all six retained systems.
- FIN-007 through FIN-010 catalog/public/legal, database epoch, clean candidate,
  staging, acceptance, and owner-approved cutover.
