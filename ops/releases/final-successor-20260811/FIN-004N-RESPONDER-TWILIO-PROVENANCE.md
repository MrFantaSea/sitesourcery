# FIN-004N Responder Twilio transport provenance

Date: 2026-08-12
State: proved
Candidate branch: `integration/final-successor-20260811`

Proved implementation commit:
`0a6adcaaf385c67b5e46568fb647a699f0718177`

Proved tree: `21b340a35317326628de717e3bbb238750b9fe92`

## Authority and source

- Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`.
- Preserved union donor: `a81d1438fd57e62e44b917c803988301945ef2ef`.
- Responder worker, queue, and process authorities: FIN-004K, FIN-004L, and
  FIN-004M.
- The preserved Responder preflight, setup, and walkthrough records identify
  Twilio Programmable Messaging as the intended communications provider.
- Current provider semantics were checked against Twilio's official Message,
  Messaging Service, Account, A2P Brand/Campaign, and webhook-security
  documentation. Ordinary Message creation exposes no provider idempotency
  contract.
- A read-only HQ inspection proved that port 8789 is a loopback-only proxy
  from the authenticated Pixel SSH path to the read-only command deck on port
  8788. It is not a telephony or SMS adapter. No HQ file, process, service,
  repository, or tunnel was changed or restarted.
- The public placeholder, DNS, provider state, credentials, database, and live
  deployment remained unchanged.

## Changed paths

- `server/hosted/twilio-responder-transport.mjs`
- `server/hosted/responder-fulfillment-worker.mjs`
- `server/hosted/worker-responder-composition.mjs`
- `server/hosted/test/twilio-responder-transport.test.mjs`
- four existing Responder worker/repository/composition test files
- `ops/workers.env.example`
- `ops/SITESOURCERY-WORKERS-01-HELD-RUNBOOK.md`
- FIN-004K, FIN-004L, and FIN-004M correction records
- this provenance record and `BUILD-LEDGER.md`

## Transport contract

The new provider boundary uses Twilio API-key Basic authentication and one
exact Messaging Service. Readiness fails closed unless provider readback
proves all of the following together:

- an active Full account;
- the exact account-bound `Responder` Messaging Service;
- an approved, verified, standard, non-mock A2P Brand;
- a verified `CUSTOMER_CARE` campaign bound to that Brand and Service; and
- a separately injected, read-only private delivery-material resolver.

Each send accepts only durable Responder identities plus route/content
digests. The private resolver must return one matching US E.164 SMS route and
one bounded ASCII body containing the fixed STOP notice. The provider request
contains only `To`, `MessagingServiceSid`, `Body`, the exact production status
callback, and a five-minute validity period. The returned durable receipt is
digest-only and contains no phone number, body, or Twilio Message SID.

Twilio's ordinary Message-create endpoint does not accept an idempotency key.
The adapter therefore declares `provider-unsupported` idempotency and a
`receipt-or-manual-review` certainty contract. Network uncertainty, an
ambiguous provider result, or post-effect validation drift cannot acquire
automatic retry authority. The worker retries only an explicitly retryable
failure that also proves the provider effect did not occur.

The transport is intentionally not production-root-composed yet. Held mode
still constructs no provider and cannot read credentials or private message
material. Composition requires the next separately proved private resolver
and callback/reconciliation authorities.

## Focused and cumulative proof

- Focused transport, worker, queue, composition, process, and repository
  ladder: 25 tests; 24 passed, zero failed, one intentional PostgreSQL skip.
- Cumulative hosted-service ladder: 835 tests; 825 passed, zero failed, and 10
  intentional database integration skips.
- Syntax checks and `git diff --check` passed.

The complete clean-tree `npm test` ladder ran at the exact implementation
commit and tree above and exited `0`:

- cumulative Node ladder: 863/863 passed;
- hosted-service ladder: 825 passed, zero failed, 10 intentional skips;
- operations ladder: 205/205 passed;
- Pages artifact: 90 explicitly reviewed files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 hosted routes at 320x720, 390x844, and 1440x1000.

The first managed-sandbox run was stopped only because its browser fixture
could not bind loopback (`listen EPERM 127.0.0.1`). The unchanged exact commit
then passed the full ladder under the approved loopback-capable test boundary.

No provider request, live SMS, public route, credential read, HQ mutation,
network write, DNS change, or public-placeholder change occurred.

## Remaining blockers

- Private Responder delivery-material resolver and production composition.
- Authenticated Twilio status-callback ingestion, durable provider-event
  reconciliation, and delivery/suppression projections.
- Owner-evidence-bound test and live provider activation.
- Separate full integration contract for the retained HQ phone bridge.
- The other mandatory worker purposes and hosted Care/Responder UI closure.
- FIN-005 through FIN-010 outside-lane, integration, catalog, database,
  staging, acceptance, and owner-approved cutover work.
