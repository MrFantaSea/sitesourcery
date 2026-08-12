# FIN-004I Responder surfaces provenance

Date: 2026-08-12
State: implementation sealed; exact clean-tree cumulative proof pending
Candidate branch: `integration/final-successor-20260811`

## Donor and three-way reconciliation

- Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`.
- Current Responder core source before this cohort: FIN-004C on the preserved
  union lineage `a81d1438fd57e62e44b917c803988301945ef2ef`.
- Preserved surface donor:
  `b40334fc25e6ced632800adbba6673d039d638e4`.
- The current two Responder core files were byte-equivalent to the surface
  donor's parent for every overlapping line. The donor's core changes were
  therefore additive rather than an overwrite of newer work.
- No unrelated deletion or older branch content from the cleanup snapshot was
  imported.

Exact donor path allowlist:

- `abracadabra/app/abracadabra-responder-surfaces.css`
- `abracadabra/app/abracadabra-responder-surfaces.js`
- `scripts/test/abracadabra-responder-surfaces.test.mjs`
- `server/hosted/responder-core-postgres.mjs`
- `server/hosted/responder-core.mjs`
- `server/hosted/responder-surfaces-http.mjs`
- `server/hosted/responder-surfaces-postgres.mjs`
- `server/hosted/responder-surfaces.mjs`
- `server/hosted/test/responder-core-postgres.integration.test.mjs`
- `server/hosted/test/responder-core.test.mjs`
- `server/hosted/test/responder-surfaces-http.test.mjs`
- `server/hosted/test/responder-surfaces-postgres.test.mjs`
- `server/hosted/test/responder-surfaces.test.mjs`

`package.json` was changed only to add the hosted Responder UI test to the
canonical `test:node` ladder.

## Imported capability

The cohort adds held, tenant-scoped customer/operator projections and eleven
authenticated routes for:

- customer and operator reads;
- explicit digest-only consent evidence;
- authenticated digest-only STOP evidence;
- human handoff requests;
- held acknowledgment reservation;
- reasserting the already-engaged global kill.

The projection intentionally omits phone numbers, message bodies, provider
event IDs, payload/evidence/signature digests, content digests, billing
authority, and any delivery claim. The UI is hosted-only, text-only,
network-free, and not yet added to the hosted artifact or authenticated shell;
that belongs to the following root composition cohort.

## Donor repairs

Two defects were found by proof and repaired without expanding authority:

1. The donor UI renders its global consent action before contact actions, but
   its test selected the first button positionally and expected STOP. The test
   now selects the semantic `Record STOP` label.
2. The donor actor-scoped STOP repository attempted the verified provider
   mutation inside a customer/operator transaction. Migration 120 correctly
   requires provider evidence and opt-out mutation to run as the system actor,
   so real PostgreSQL rejected it. The repaired repository first performs a
   read-only actor/tenant/contact/capability authorization transaction and then
   performs the still-fake, still-held mutation through a separate
   serializable system transaction. Both stages independently fail closed;
   the system stage rechecks active contact state and exact tenant scope.

No migration was changed. The migration-120 trigger authority remains the
enforcement source.

## Effects and excluded scope

- Provider, telephony, message delivery, billing, and sale effects remain
  false.
- Global kill remains engaged by default.
- The fake provider accepts only digests and deterministic classification.
- No phone bridge, messenger, command deck, Client Profile Hub, marketing
  desk, or Dell contract was added or excluded; all remain retained for the
  later adjacent-integration cohort.
- No worker purpose, credential, production process, public placeholder, DNS,
  Cloudflare route, predecessor, or protected database was changed.

## Proof

- Focused service/core/repository/HTTP/UI/migration tests: 22/22 passed.
- Canonical cumulative `test:node`: 863/863 passed.
- Canonical hosted-service ladder: 804 tests, 794 passed, zero failed, 10
  intentional integration skips.
- Empty PostgreSQL 16 migration proof: all 77 migrations applied and the
  cumulative mail/support/operator/accounting/domain/Care proofs passed.
- Fresh real PostgreSQL Responder journey: 1/1 passed, covering consent,
  replay, actor-scoped STOP, global kill, handoff, held messages, customer
  isolation, operator capability, and projections.
- Both caller-owned disposable databases were dropped, the temporary cluster
  was stopped and removed, and port 55450 was closed.
- `git diff --check` passed.

The complete clean-tree `npm test` ladder is required immediately after the
implementation commit.

## Remaining blockers

- FIN-004J: mount the held Responder service/HTTP boundary through the
  production root and expose truthful capability/readiness.
- Responder fulfillment worker and the other explicit worker purposes.
- FIN-005 outside-lane disposition closure.
- FIN-006 root/cross-system contracts, including every retained adjacent HQ
  and Dell system.
- FIN-007 through FIN-010 catalog/public/legal, database epoch, clean candidate,
  staging, acceptance, and owner-approved cutover.
