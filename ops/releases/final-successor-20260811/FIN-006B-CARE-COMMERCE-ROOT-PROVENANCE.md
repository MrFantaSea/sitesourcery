# FIN-006B Care commerce root provenance

Date: 2026-08-14
State: proved subcohort; FIN-006 remains active
Candidate branch: `integration/final-successor-20260811`

Proved implementation commit:
`10fe35eafa20ae97e53003650379e3ec4cb1c852`

Proved tree: `0c0f004f95092c656a26507d93c18d633342aaad`

## Authority and source

- FIN-006B closes one composition gap over the already integrated canonical
  Care commerce service, PostgreSQL eligibility/repository, migration 124, and
  held mail-reservation interface. It imports no donor branch and adds no
  migration.
- The production root previously mounted Care tickets and usage surfaces but
  did not construct or expose Care quotes, held invoice reservations,
  cancellation, ambiguity review, reversal hold, or commercial readback.
  `/capabilities` could therefore report `care=true` for an incomplete Care
  product.
- This subcohort mounts only the existing held-local authority. It does not
  install or call Stripe, send mail, release tax/commercial authority, start a
  new worker, or authorize any provider or customer effect.

## Changed paths

- `server/hosted/bin/server.mjs`
- `server/hosted/care-commerce.mjs`
- `server/hosted/care-commerce-http.mjs`
- `server/hosted/http.mjs`
- `server/data-plane/tests/care-commerce-postgres-proof.mjs`
- `server/hosted/test/care-commerce-http.test.mjs`
- `server/hosted/test/care-commerce.test.mjs`
- `server/hosted/test/care-production-composition.test.mjs`
- `server/hosted/test/http-capabilities-snapshot.test.mjs`
- `server/hosted/test/http-care-composition.test.mjs`
- `server/hosted/test/http-commerce-v2.test.mjs`
- `server/hosted/test/responder-production-composition.test.mjs`
- this provenance record and `BUILD-LEDGER.md`

## Composition and routes

The production hosted root now constructs `createHeldCareCommerceService`
with the canonical PostgreSQL eligibility and repository ports, the existing
runtime UUID/clock authority, and the shared digest-only held mail lifecycle.
Startup fails unless durable state and mail reservation are ready and verified
while commercial, tax, customer, mail-delivery, payment, and provider effects
remain false.

The new authenticated boundary mounts eight exact routes:

- customer catalog and held reservation reads;
- operator catalog read;
- operator held quote and invoice-reservation commands;
- operator cancellation and ambiguity commands; and
- an explicit reversal request that remains unavailable until authoritative
  payment evidence exists.

All route scope is derived from UUID path parameters. Customer organization
selection uses the verified active organization roster; operator scope uses
the target organization in the operator route. Writes require same-origin
CSRF and an idempotency key, accept exact bounded JSON keys, and expose no
provider route or raw private identifier.

The shared identity service returns session metadata in production. The Care
commerce adapter now narrows that result to exactly frozen `userId` and
`organizationId` before it reaches the strict Care authority. A
production-shaped regression proves session ID/digest, reauthentication time,
and user PII do not enter the service.

## Readiness and capability truth

The core Care commerce readiness contract now requires the mail reservation
dependency to be both ready and verified. A ready-but-unverified mail boundary
sets aggregate verification and `mailReservationReady` false.

`/api/v1/capabilities` now exposes a bounded `careCommerce` projection and
reports the overall `care` capability true only when both the existing Care
support surface and durable Care commerce are mounted, verified, and
effect-held. Missing commerce or unverified mail fails the public capability
closed.

## Focused, adversarial, and PostgreSQL proof

- Syntax, staged diff hygiene, and exact production composition checks passed.
- The final focused Care/root/capability/commerce set reported 46/46 passes.
- A bounded independent review found two production blockers: expanded
  authenticated actor shape and unverified mail readiness. Both were corrected
  and independently re-reviewed as resolved; no other material blocker was
  found.
- A disposable PostgreSQL 16 database applied all 87 migrations. The joined
  Care commerce proof passed 12/12, including real customer/operator HTTP
  catalog reads, cross-organization denial, exact quote/reservation replay,
  cancellation/reversal fencing, ambiguity handling, forced RLS, append-only
  evidence, and terminal cleanup rollback.
- The same verifier reported Care core 16/16 and zero Care provider, payment,
  mail-delivery, or customer effects. The disposable database reported absent
  after cleanup.

## Clean cumulative proof

The first clean-tree run was constrained by the workspace sandbox: six local
browser fixtures received `listen EPERM` while 871 other Node tests passed.
No product assertion failed and no source changed. The exact same committed
tree was rerun with loopback fixture permission and completed `npm test` with
exit zero:

- canonical Node 24.18.0 checks passed;
- canonical Node matrix passed 877/877;
- hosted/service reported 1,018 tests: 1,004 passed, zero failed, and 14
  intentional PostgreSQL skips;
- operations reported 205/205 passes;
- Pages rebuilt and verified 90 explicitly reviewed files;
- the hosted artifact rebuilt and passed HTML validation; and
- the current browser audit passed 15 hosted routes at 320x720, 390x844, and
  1440x1000.

## Effects and remaining work

- Public placeholder, DNS, Cloudflare, Pages, providers, HQ, Dell, protected
  databases, deployment, and cutover were untouched.
- Care commercial/tax authority, Stripe payment, mail delivery, and all
  customer/provider effects remain explicitly held.
- FIN-006 remains open and retains zero denominator points until every
  mandatory capability row is composition-proved. The next row must be chosen
  from actual current root/process evidence without remapping the sealed Domain
  or Care rows.
- FIN-007 through FIN-010 remain unchanged and owner-gated where specified.
