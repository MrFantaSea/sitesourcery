# FIN-006C Responder commerce root provenance

Date: 2026-08-14
State: proved subcohort; FIN-006 remains active
Candidate branch: `integration/final-successor-20260811`

Proved implementation commit:
`d6103d820e37332410d3520337b1facfabde6b13`

Implementation tree: `13d55a93300261ec16a100d0d78f3e50d1aa6ce2`

Exact proof-candidate commit:
`c1e3d50e0a1307e0af5c5d43a92310693797a740`

Proof-candidate tree: `a263ddd9794bdf4bb579ceb108d2b02ebd784c99`

## Authority and scope

- FIN-006C closes the missing durable commercial boundary for the already
  integrated provider-neutral Responder core, customer/operator surfaces,
  fulfillment queue, encrypted private material, held Twilio composition,
  reconciliation, and workers.
- The exact held catalog is `$300` setup plus `$250` monthly, stored as integer
  USD minor units. Tax remains `disabled_by_owner`; no sell, payment, mail,
  customer, provider, phone, or public effect is released.
- Owner decisions R1 and R2 authorize the next separately bounded architecture:
  customers retain their carrier and number, conditional no-answer forwarding
  is the universal launch path, Twilio is the initial replaceable managed
  transport, and native iPhone/Android clients reuse this backend. Those future
  transport/client changes were not mixed into this commerce cohort.
- Governing owner-decision SHA-256 is now
  `0373767c2c600097588d71d06a8787a28e499e76faae1fb382f9ac7c3c2cb458`.

## Implementation and correction commits

- `d6103d820e37332410d3520337b1facfabde6b13` adds migration 135,
  repository, held service, eight-route HTTP boundary, production-root mount,
  capability truth, focused tests, and real-PostgreSQL proof.
- `ccaa52995f32d5dd4eabfe82d988d0a7a6c30cd3` updates the older production
  composition assertion to require both Responder surfaces and commerce.
- `36583f81fa4cc2db77c384a7e985a95129a4d69e` updates the older public
  capability snapshots to require the exact all-false held commerce posture.
- `c1e3d50e0a1307e0af5c5d43a92310693797a740` gives every browser protocol
  command a ten-second fail-closed deadline, eliminating an observed
  indefinite mocked-Checkout handoff wait.

## Changed paths

- `server/data-plane/supabase/migrations/202608140135_responder_commerce_persistence.sql`
- `server/data-plane/tests/migration-verification-inventory.mjs`
- `server/data-plane/tests/postgres-migration-structure.test.mjs`
- `server/data-plane/tests/responder-commerce-postgres-proof.mjs`
- `server/data-plane/tests/verify-empty-postgres-migrations.mjs`
- `server/hosted/bin/server.mjs`
- `server/hosted/http.mjs`
- `server/hosted/responder-commerce-catalog.mjs`
- `server/hosted/responder-commerce-http.mjs`
- `server/hosted/responder-commerce-postgres.mjs`
- `server/hosted/responder-commerce.mjs`
- `server/hosted/test/http-capabilities-snapshot.test.mjs`
- `server/hosted/test/http-commerce-v2.test.mjs`
- `server/hosted/test/http-responder-composition.test.mjs`
- `server/hosted/test/responder-commerce-http.test.mjs`
- `server/hosted/test/responder-commerce-production-composition.test.mjs`
- `server/hosted/test/responder-commerce.test.mjs`
- `server/hosted/test/responder-production-composition.test.mjs`
- `scripts/browser-audit-current.mjs`
- this provenance record and `BUILD-LEDGER.md`

## Persistence, routes, and capability truth

Migration 135 creates five forced-RLS, service-controlled Responder commerce
tables for catalog authority, quote evidence, reservations, append-only events,
and replay/fencing commands. Exact database guards bind document contents,
evidence digests, setup/monthly purpose, amount, cadence, interval, tenant, and
actor authority. Purge remains sealed and effect-free.

The production root now constructs the PostgreSQL repository and held service,
fails startup unless the exact catalog and durable boundary verify, and mounts
eight authenticated customer/operator routes for catalog and reservation
reads, held quotes, setup-plus-monthly reservations, cancellation, ambiguity,
and an explicitly held scoped reversal request. Writes require same-origin
CSRF, exact idempotency, bounded bodies, and tenant/resource authority.

`/api/v1/capabilities` reports the overall Responder capability true only when
both the existing Responder surfaces and durable commerce are present and
verified. Its `responderCommerce` projection is explicit about mounted local
readiness while every commercial/customer/mail/payment/provider effect and
sellability flag remains false.

## Adversarial and PostgreSQL proof

- Final focused service, HTTP, root, capability, and migration proof passed
  86/86.
- Bounded review found and closed four material seams: nullable JSON guard
  bypass, missing evidence/cadence bindings, reversal authorization before the
  universal hold, and concurrent same-key fencing proof. Final review state is
  `CLEAR`.
- A fresh disposable PostgreSQL 16 verifier applied all 88 migrations.
- The real Responder commerce journey passed 14/14 across owner/operator
  positive paths, cross-organization denial, forced RLS and ACLs, sequential
  and concurrent replay/fencing, stripped self-digested document rejection,
  cancellation, ambiguity, held reversal, exact zero-effect rows, and purge.
- The verifier reported `databaseAbsent true` after cleanup.

## Clean cumulative proof

The exact proof candidate `c1e3d50...` completed `npm test` with exit zero and
no ambient Node or Git override:

- canonical Node 24.18.0 and the Node matrix passed 878/878;
- hosted/service passed with zero failures and only its 14 intentional
  no-database PostgreSQL skips;
- operations passed 205/205;
- Pages rebuilt and verified 90 explicitly reviewed files;
- the hosted artifact rebuilt and passed HTML validation; and
- the bounded current browser audit passed 15 hosted routes at 320x720,
  390x844, and 1440x1000, including the real account, payment, immutable
  handoff, keyboard, focus, overflow, and 44px-control journeys.

Two useful fail-closed gates were observed before that final pass. The sandbox
denied six loopback fixtures until the already-reviewed local permission was
used, and the operations proof rejected an attempted `NODE_OPTIONS` output
override. Neither was treated as product proof or bypassed. The final run used
the canonical environment.

## Effects and remaining work

- Public placeholder, DNS, Cloudflare, Pages publication, Stripe, Twilio,
  carrier systems, mail delivery, HQ, Dell, protected databases, deployment,
  App Store/Play Store, and cutover were untouched.
- Responder commerce is complete in held-local form; external payment, tax,
  provider, carrier, and messaging releases retain their separate gates.
- FIN-006 remains open and retains zero new denominator points until every
  mandatory capability/process row is composition-proved.
- The next bounded slice is the carrier-preserving forwarding/onboarding and
  provider-neutral transport contract, reusing the existing Twilio core rather
  than rebuilding it. Native clients follow the same authority boundary.
