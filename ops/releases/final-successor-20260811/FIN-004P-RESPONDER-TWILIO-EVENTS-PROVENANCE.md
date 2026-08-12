# FIN-004P Responder Twilio delivery-event provenance

Date: 2026-08-12
State: proved
Candidate branch: `integration/final-successor-20260811`

Proved implementation commit:
`6bf74b72a5b3cdfe2dbbf9b01992a55ac2748730`

Proved tree: `7aee333554a9d907d6ce3d2adf4093399ba53ff2`

## Authority and source

- Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`.
- Preserved union donor: `a81d1438fd57e62e44b917c803988301945ef2ef`.
- Responder queue, process, Twilio transport, and private-material authorities:
  FIN-004L through FIN-004O.
- Current signature and delivery-status semantics were checked against
  Twilio's official [webhook-security](https://www.twilio.com/docs/usage/webhooks/webhooks-security),
  [outbound status-callback](https://www.twilio.com/docs/messaging/guides/outbound-message-status-in-status-callbacks),
  and [message-status tracking](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status)
  documentation. Verification uses Twilio's maintained SDK rather than a
  locally reimplemented signature algorithm.
- No adjacent HQ system was excluded or changed. The retained phone bridge,
  command deck, private messenger, Client Profile Hub, marketing desk, and
  Dell commercial engine remain separately mapped integration targets.
- The public placeholder, DNS, provider state, credentials, live database,
  HQ processes, and deployed services remained unchanged.

## Changed paths

- `server/data-plane/supabase/migrations/202608120127_responder_twilio_delivery_events.sql`
- `server/data-plane/tests/migration-verification-inventory.mjs`
- `server/hosted/twilio-responder-events.mjs`
- `server/hosted/twilio-responder-events-postgres.mjs`
- `server/hosted/twilio-responder-events-http.mjs`
- `server/hosted/twilio-responder-events-config.mjs`
- `server/hosted/twilio-responder-transport.mjs`
- Responder fulfillment worker and PostgreSQL repository composition
- hosted API root, capability/readiness projection, and startup diagnostics
- held API/worker environment examples and worker runbook
- the exact `twilio@6.1.0` dependency and lockfile
- focused migration, signature, repository, HTTP, configuration, transport,
  worker, capability, and real-PostgreSQL integration tests
- the FIN-004O migration-count correction, this provenance record, and
  `BUILD-LEDGER.md`

## Verified event and reconciliation contract

The hosted API now owns one exact unauthenticated-by-browser but
provider-authenticated route:
`POST /api/v1/provider-events/twilio`. It accepts only bounded raw
`application/x-www-form-urlencoded` bytes. Verified mode requires the exact
production URL, expected Account SID, and an independent root-owned Account
Auth Token. It validates the signature over the exact URL and every received
form field, including future fields added by Twilio. Held mode forbids staging
the Auth Token and performs no provider or storage effect.

The callback Account Auth Token is isolated from the worker's restricted
outbound API key. Successful HTTP acknowledgement requires an exact durable
repository receipt. Raw phone numbers, message bodies, Account SID, Message
SID, error code, signature, and request payload are never stored or logged.
Only SHA-256 digests, the bounded status, receipt time, reconciliation state,
and internal operation/organization binding cross the storage boundary.

Migration 127 adds a digest-only provider Message mapping to accepted delivery
operations, an immutable callback-event ledger, and one monotonic delivery
status projection. The exact authenticated raw-form digest is the event
identity because Twilio delivery callbacks have no independent event ID. The
contract is
`canonical-responder-twilio-delivery-events-v1-digest-only-race-safe`.

Reconciliation is race-safe in both directions: a callback received before
the worker records provider acceptance stays pending and is applied by the
acceptance trigger; a callback received afterward reconciles on insert.
Duplicate payloads replay exactly. Older nonterminal states cannot regress a
newer state, terminal states cannot regress, and contradictory terminal
evidence latches `attention_required` for operator review. Forced row-level
security and trigger guards keep the tables system-only.

The worker now durably records the provider Message SID digest alongside the
existing receipt digest at the exact accepted transition. The raw SID remains
inside the provider adapter. Hosted readiness exposes only the boolean
`responderProviderEvents` capability and bounded held/ready diagnostics.

## Focused, database, dependency, and cumulative proof

- Focused callback, migration, repository, HTTP, configuration, transport,
  worker, and fulfillment ladder: 33/33 passed.
- Cumulative hosted-service ladder: 859 tests; 849 passed, zero failed, and 10
  intentional PostgreSQL skips.
- Cumulative operations pre-commit ladder under Node 24.18.0: 201/205 passed;
  only the four deliberate clean-Git origin-install checks rejected the
  uncommitted tree. The exact implementation commit then passed 205/205.
- Syntax checks and `git diff --check` passed.
- The exact official `twilio@6.1.0` dependency audit reported zero known
  vulnerabilities.

PostgreSQL 16.14 was exercised only through disposable local databases. The
final fresh database accepted all 80 ordered migrations through migration 127
and passed the complete canonical migration, RLS, service, and subsystem
verification. The corrected one-case Responder journey passed callback before
acceptance, acceptance-triggered reconciliation, exact replay, stale late
status handling, contradictory terminal evidence, and the durable attention
latch. Both disposable databases used during development were dropped; the
first exposed and helped correct a JavaScript/`jsonb` canonicalization
mismatch before this commit. No live database was touched.

The complete clean-tree `npm test` ladder ran at the exact implementation
commit and tree above and exited `0`:

- cumulative Node ladder: 863/863 passed;
- hosted-service ladder: 849 passed, zero failed, 10 intentional skips;
- operations ladder: 205/205 passed;
- Pages artifact: 90 explicitly reviewed files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 hosted routes at 320x720, 390x844, and 1440x1000.

The first sandboxed complete run reached 860/863 Node assertions and stopped
only because three browser fixtures could not bind loopback (`listen EPERM
127.0.0.1`). The unchanged exact commit passed the complete ladder under the
approved loopback-capable test boundary.

No callback was published to Twilio, no provider request or live SMS occurred,
and no public route, credential, live database, HQ system, DNS record, deployed
service, or public-placeholder byte changed.

## Remaining blockers

- Authenticated Twilio inbound-SMS and missed-call event ingestion, including
  exact provider-number-to-tenant routing and private inbound material.
- Provider readback/reconciliation for missing callbacks and ambiguous Message
  creation, plus retention-driven private-ciphertext destruction.
- Owner-evidence-bound test and live Twilio activation.
- Remaining lifecycle, cancellation, export, domain, Care, Responder,
  provider-reconciliation, and monitoring worker closure.
- Complete authenticated Care/Responder customer and operator surfaces.
- Controlled integration contracts for every retained adjacent HQ and Dell
  system; none is excluded from the system map.
- FIN-005 through FIN-010 outside-lane, integration, catalog, database,
  staging, acceptance, and explicitly owner-approved cutover work.
