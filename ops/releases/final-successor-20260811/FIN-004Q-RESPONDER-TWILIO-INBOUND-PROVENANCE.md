# FIN-004Q Responder Twilio inbound provenance

Date: 2026-08-12
State: proved
Candidate branch: `integration/final-successor-20260811`

Proved implementation commit:
`f5d2b0b0c2e49bde09082be14ba02cc34e12e5e4`

Proved tree: `38e9840b3ac3c363206e76ea6594d1c65e6f1a81`

## Authority and source

- Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`.
- Preserved union donor: `a81d1438fd57e62e44b917c803988301945ef2ef`.
- Responder core, surfaces, queue, material, transport, and delivery-event
  authorities: FIN-004C, FIN-004I, and FIN-004K through FIN-004P.
- The provider-neutral core (RESPONDER-CORE-01) accepts a real provider
  through its verified-event contract. This cohort widens the exact provider
  constraint from `'fake'` to `('fake','twilio')` with the same
  guard-evolution pattern migration 125 applied to migration 120, and feeds
  the proved `ingestVerifiedEvent` machinery through two additive exports
  instead of creating a parallel consent authority.
- Current provider semantics were checked against Twilio's official
  webhook-request, webhook security and connection-override, Advanced
  Opt-Out (error 21610), TwiML `<Reject>`/`<Dial action>`, voice webhook,
  Messaging Service inbound routing, IncomingPhoneNumber/PhoneNumber, and
  A2P 10DLC documentation. Load-bearing provider facts: MessageSid/CallSid
  are the stable inbound identities; webhook delivery is at-least-once;
  incoming message and call webhooks require a TwiML response, and an empty
  `<Response/>` receives a message without replying; Advanced Opt-Out
  answers STOP/HELP/START itself, forwards the keyword message with
  `OptOutType`, and blocks later sends to opted-out recipients with error
  21610; signatures are HMAC-SHA1 under the Account Auth Token for
  Messaging and Voice alike; A2P registration governs sending only.
- An owner course correction during this cohort mandated keyed/versioned
  phone-derived lookup digests bound into contract and readiness, exact PN
  SID plus provider-readback binding authority, an explicitly held Voice
  arrival route never described as an operational missed-call path, a
  claimed/pre-effect cancellation transition with worker/resolver
  revalidation immediately before the provider call proved in both lock
  orders on real PostgreSQL, org-null evidence restricted to exact unbound
  states, and an adversarial review of those areas before commit. All are
  implemented and proved below.
- The owner-approved field flow (`ops/RESPONDER-SETUP.md`) decides
  missed-versus-answered by `DialCallStatus` on the `<Dial action>`
  callback with strictly separated branches; this cohort models evidence
  identically and never fabricates a missed call from `CallStatus` or from
  arrival.
- The public placeholder, DNS, provider state, credentials, live databases,
  HQ processes, and deployed services remained unchanged.

## Changed paths

New:

- `server/data-plane/supabase/migrations/202608120128_responder_twilio_inbound.sql`
- `server/hosted/responder-lookup-digests.mjs`
- `server/hosted/responder-inbound-material-vault.mjs`
- `server/hosted/twilio-responder-inbound.mjs`
- `server/hosted/twilio-responder-inbound-postgres.mjs`
- `server/hosted/twilio-responder-inbound-http.mjs`
- `server/hosted/twilio-responder-inbound-config.mjs`
- `server/hosted/responder-number-bindings-postgres.mjs`
- `server/hosted/responder-number-bindings-http.mjs`
- eight focused test files and one real-PostgreSQL integration journey

Modified:

- `server/hosted/responder-core.mjs` and `responder-core-postgres.mjs`
  (additive exports of the proved event normalizer and verified-event
  writer)
- `server/hosted/responder-fulfillment-postgres.mjs` (the claim locks the
  contact authority `for share ... skip locked`; suppression-cancelled
  operations return `already_cancelled` from retry/manual-review and raise
  `RESPONDER_DELIVERY_SUPPRESSION_CONFLICT` on post-effect acceptance)
- `server/hosted/responder-private-material-postgres.mjs` (resolution now
  requires the caller's own unexpired lease and re-validates the exact
  claim, active consent, open interaction, and disengaged kill immediately
  before any provider call)
- `server/hosted/twilio-responder-transport.mjs` and
  `server/hosted/responder-fulfillment-worker.mjs` (leaseOwner threading
  and benign handling of suppression-cancelled operations)
- `server/hosted/http.mjs` and `server/hosted/bin/server.mjs` (three
  inbound routes with byte-exact TwiML acknowledgements, the operator
  number-binding surface, capability/readiness projection, startup gates,
  and digest-only startup diagnostics)
- `server/data-plane/tests/migration-verification-inventory.mjs`,
  `ops/hosted.env.example`, `ops/SITESOURCERY-WORKERS-01-HELD-RUNBOOK.md`
- five existing test files extended for the strengthened contracts; no
  assertion was weakened

## Verified inbound contract

The hosted API owns three exact provider-authenticated routes:
`POST /api/v1/provider-events/twilio/inbound-messages`,
`POST /api/v1/provider-events/twilio/voice`, and
`POST /api/v1/provider-events/twilio/voice/dial-result`. Each validates the
signature with Twilio's maintained SDK over its exact pinned production URL
and every received form field, accepts only bounded raw
`application/x-www-form-urlencoded` bytes, and answers a byte-pinned TwiML
acknowledgement (`<Response/>`, `<Reject reason="busy"/>`, `<Hangup/>`)
that commands no provider effect. Held mode constructs no validator, reads
no secret, and fails startup if any Responder material key is staged.

Tenant resolution uses operator-provisioned number bindings mapping one
provider number to one organization/project Responder authority. Every
phone-derived lookup identity is a purpose-bound, versioned HMAC composed
from the approved identity pepper; readiness in both repositories fails
closed when any active binding's key version leaves the configured keyring,
and lookups query every keyring candidate. Bindings retain the exact
IncomingPhoneNumber SID digest and a structured provider-readback digest;
one active binding per number and per provider resource is enforced by
partial unique indexes plus a cross-version candidate pre-check at
provisioning. The apply transaction re-verifies the exact still-active
binding so a concurrent retire/re-provision re-resolves instead of
misattributing evidence. Unknown, retired, account-mismatched, and
service-mismatched numbers quarantine as digest-only `unbound` evidence
with no tenant columns — the only tenantless states the CHECK constraints
and trigger permit.

Event identity: the exact authenticated raw-form digest is the ledger
identity; the provider resource SID digest is the single-application key
into the shared core evidence, enforced by a partial unique index on
applied rows. Exact replays return the recorded receipt; distinct payloads
for an already-applied resource land as `superseded` without core effect.
Keyed columns are excluded from replay identity so pepper rotation cannot
corrupt provider retries, and sealed inbound material validates its caller
route against every keyring candidate so rotation cannot strand evidence.

STOP classification uses `OptOutType` plus Twilio's exact default keyword
set. The system records durable suppression and never replies. Application
runs through the proved consent transition, then a global-system sweep
cancels queued, waiting, and claimed deliveries for the opted-out contact,
revoking leases. START and HELP never mutate consent.

Voice: arrivals and answered dial results are evidence only; a missed call
exists solely as a dial-result with `DialCallStatus` in
{busy, no-answer, failed, canceled}, structurally enforced by the applied
CHECK. The arrival route rejects payloads carrying `DialCallStatus`. The
private `<Dial action>` plan is deliberately not composed: readiness
reports `voiceOperational:false` and `voiceDialPlan:"blocked-fin-004t"`,
and Voice missed-call handling is not operationally reachable until
FIN-004T/U supplies the dial plan.

Raw caller numbers, forwarded lines, and message bodies exist only as
AES-256-GCM ciphertext sealed in the API process, bound by AAD to the
exact inbound event, tenant, project, channel, keyed caller-route digest,
and payload digest. The guard accepts material only for an exactly
matching applied event and permits only zeroing destruction. Material keys
share the established Responder keyring and rotation contract.

## The no-send boundary

After a durable STOP, no operation retains provider-dispatch authority:
deliveries for an inactive authority are born cancelled; claims re-check
consent under a contact-authority row lock and skip locked rows; queued,
waiting, and claimed operations are swept to cancelled with leases
revoked; and the material resolver — the last gate before the provider
call — re-validates the exact claim, the caller's own unexpired lease,
active consent, the open interaction, and the disengaged kill switch in
one consistent read. An effect completing inside the residual
network-flight window cannot be recorded as ordinary acceptance: it raises
`RESPONDER_DELIVERY_SUPPRESSION_CONFLICT` for operator reconciliation, and
Twilio's opted-out blocklist (error 21610) backstops the same window at
the provider edge. Both lock orders and the concurrent race were proved on
real PostgreSQL.

## Adversarial review

A read-only adversarial review before commit attacked the four mandated
areas — phone/number privacy and provider identity, Voice arrival versus
missed-call result, STOP/outbound concurrency, and unbound/private
evidence — and returned HELD on all four with zero blocker or material
findings. Its three minor findings and two hardening notes were all fixed
in this cohort rather than deferred: apply-transaction binding
re-verification, the cross-version provisioning pre-check, candidate-based
caller-route validation after pepper rotation, the applied-state CHECK
tightening, and the held-mode prior-key staging gate. A second read-only
verification confirmed each fix closed its finding with no regression,
leaving one LOW fail-closed residual: provisioners running skewed keyrings
could still create two active bindings for one number, which inbound
resolution surfaces as an explicit ambiguity conflict and readiness
coverage flags — an operational precondition, not a silent path.

## Focused, database, dependency, and cumulative proof

- Focused inbound ladder (migration structure, lookup digests, inbound
  vault, domain, repository, config, HTTP ingress, number bindings):
  51/51 passed after the review fixes.
- Existing Responder-lane ladder under the strengthened contracts: 50/50.
- Cumulative hosted-service ladder: 911 tests; 900 passed, zero failed,
  and 11 intentional PostgreSQL skips (the new inbound journey is the
  eleventh).
- Cumulative Node ladder: 863/863 passed.
- Operations ladder: 201/205 before the implementation commit — only the
  four deliberate clean-Git origin-install checks rejected the uncommitted
  tree — and 205/205 at the exact clean implementation commit.
- Syntax checks and `git diff --check` passed.

PostgreSQL 16.14 was exercised only through disposable local databases in
a private cluster on a Unix socket. Fresh databases accepted all 81
ordered migrations through migration 128 and passed the complete canonical
migration, RLS, service, and subsystem verification; the existing
responder-core journey passed on the same epoch, proving the strengthened
claim locking and resolver gates against real locks. The definitive fresh
database then passed the new inbound journey end to end: keyed-binding
tenancy with single ownership and cross-version conflict, unknown/retired/
service-mismatch quarantine with no tenant authority, trigger rejection of
forged tenantless applied rows, arrival/answered/anonymous evidence never
fabricating a missed call, a missed dial-result producing the core event
plus sealed caller material that refuses to open under another tenant, no
raw number or body in any durable row, STOP-before-claim leaving nothing
claimable, claim-before-STOP revoking the claimed operation's lease with
resolver refusal, post-effect acceptance latching the suppression
conflict, benign already-cancelled manual review, a concurrent STOP/claim
race converging to cancelled with no surviving dispatch authority, exact
replay re-running suppression, and superseded variants without a second
core event. Every disposable database and the private cluster were
destroyed after the proof. No live database was touched.

The complete clean-tree `npm test` ladder ran at the exact implementation
commit and tree above and exited `0`:

- cumulative Node ladder: 863/863 passed;
- hosted-service ladder: 900 passed, zero failed, 11 intentional skips;
- operations ladder: 205/205 passed;
- Pages artifact: 90 explicitly reviewed files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 hosted routes at 320x720, 390x844, and 1440x1000.

No provider request, live SMS or call, public route, credential
disclosure, live database mutation, HQ mutation, network write, DNS
change, or public-placeholder change occurred.

## Remaining blockers

- The private `<Dial action>` plan that makes Voice missed-call handling
  operationally reachable, including its release-gated TwiML and
  per-tenant dial-target material (FIN-004T/U).
- Provider readback/reconciliation for unbound-event re-application after
  late provisioning, missing callbacks, mixed-keyring binding ambiguity,
  and post-suppression effect reconciliation (FIN-004R).
- Retention-driven inbound-ciphertext destruction (FIN-004S).
- The inbound-follow-up worker that turns missed-call core evidence into
  queued deliveries, plus the remaining worker closure (FIN-004T).
- Authenticated Care/Responder customer and operator surface closure,
  including number-binding management UI (FIN-004U).
- Owner-evidence-bound test and live Twilio activation. The proved core
  route-digest family remains unkeyed by design of FIN-004C-P; migrating
  it to the keyed scheme re-proves those contracts and is recommended for
  owner review alongside a later cohort.
- FIN-005 through FIN-010 as ordered.
