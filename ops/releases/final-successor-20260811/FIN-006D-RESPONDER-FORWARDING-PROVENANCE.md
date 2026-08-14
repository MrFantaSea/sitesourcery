# FIN-006D Responder forwarding provenance

Date: 2026-08-14
State: proved subcohort; FIN-006 remains active
Candidate branch: `integration/final-successor-20260811`

Proved implementation commit:
`963002c9560b12878d9153760cc9d52bf7f3b138`

Implementation tree: `96324ca405f5b0e11522ebd2a2607475305d14d5`

## Authority and scope

- Customers retain their existing carrier and business number. The launch
  contract is conditional no-answer forwarding to a managed destination;
  carrier setup and removal remain human-executed and evidence-recorded.
- Twilio is the initial replaceable transport adapter. The provider-neutral
  onboarding boundary does not grant Twilio, carrier, message-send, payment,
  public, deployment, or phone-control effects.
- The existing Responder core, encrypted inbound material, STOP controls,
  fulfillment, reconciliation, and managed-front-door Voice path were reused.
  No parallel Responder stack was created.
- Native iPhone and Android clients were deliberately not mixed into this
  backend cohort. They must reuse this exact hosted authority and remain a
  separately proved FIN-006 client slice.

## Implementation

- Migration 136 adds organization-scoped, forced-RLS forwarding commands,
  onboardings, and append-only observations with canonical database digests,
  exact actor/tenant authority, semantic replay, monotonic transitions, and
  four independently false effect columns.
- Number bindings now carry an immutable Voice ingress role. A
  `conditional_forward_destination` remains no-Dial before onboarding, while
  setup is incomplete, during manual review, and after onboarding retirement.
  Only an explicit `managed_front_door` can use the pre-existing private Dial
  plan.
- The PostgreSQL repository and authenticated customer/operator HTTP boundary
  support local onboarding, evidence, cancellation, and digest-only readback.
  Customer and operator actor contexts are distinct; customers cannot record
  verification observations or use operator-only retirement reasons.
- A verified conditional-forward arrival with exact forwarded-source evidence
  becomes one existing `missed_call` event and one existing held follow-up job.
  Missing, mismatched, ambiguous, pending, absent, or retired onboarding state
  records evidence with zero core/follow-up effect.
- The operator desk now records the binding Voice role explicitly and renders
  it in the digest-only binding projection.
- Root readiness and capabilities expose `responderForwarding` separately and
  count overall Responder complete only when surfaces, commerce, and forwarding
  are all mounted and verified locally.

## Changed paths

- `operator/operator.js`
- `scripts/test/operator-service-surfaces-browser.test.mjs`
- `scripts/test/operator-support-ui.test.mjs`
- `server/data-plane/supabase/migrations/202608140136_responder_forwarding_onboarding.sql`
- `server/data-plane/tests/migration-verification-inventory.mjs`
- `server/data-plane/tests/postgres-migration-structure.test.mjs`
- `server/data-plane/tests/responder-forwarding-postgres-proof.mjs`
- `server/data-plane/tests/verify-empty-postgres-migrations.mjs`
- `server/hosted/bin/server.mjs`
- `server/hosted/http.mjs`
- `server/hosted/responder-forwarding-contract.mjs`
- `server/hosted/responder-forwarding-http.mjs`
- `server/hosted/responder-forwarding-postgres.mjs`
- `server/hosted/responder-number-bindings-http.mjs`
- `server/hosted/responder-number-bindings-postgres.mjs`
- `server/hosted/twilio-responder-inbound-http.mjs`
- `server/hosted/twilio-responder-inbound-postgres.mjs`
- `server/hosted/twilio-responder-inbound.mjs`
- the exact focused/root/UI tests changed or added by commit `963002c`
- this provenance record and `BUILD-LEDGER.md`

## Adversarial and PostgreSQL proof

- Final focused service, HTTP, root, capability, operator UI, browser, and
  migration checks passed with zero failures.
- Bounded review found and closed lifecycle no-loop, missing forwarded-source,
  self-forwarding, SQL customer/operator authority, cross-tenant command-ID,
  and non-tautological proof-denominator defects. Final review state is
  `CLEAR`.
- A fresh disposable PostgreSQL 16 verifier applied all 89 migrations.
- The real forwarding journey passed its frozen 17/17 gates: exact ACL/RLS and
  held readiness; JavaScript and database self-loop rejection; customer creator
  ownership; concurrent replay and semantic deduplication; the same command ID
  independently valid in two organizations; direct customer observation and
  retirement denial with rollback; cross-tenant denial; five-evidence
  `ready_held`; missing/mismatched source handling; one exact missed-call and
  follow-up; ambiguity demotion; append-only cancellation; digest-only rows;
  and a held manual-review worker terminal state.
- Signed pre-onboarding and post-retirement Voice webhook replays returned the
  fixed Hangup TwiML, called the Dial plan zero times, and created zero core or
  follow-up effects.
- The pre-existing real-PostgreSQL Twilio tenancy, STOP-versus-claim in both
  orders, replay, and private-isolation integration still passed on the exact
  89-migration epoch.
- The disposable database `ss_fin006d_dev_20260814` was removed and its absence
  verified after proof.

## Clean cumulative proof

The clean implementation commit `963002c...` completed `npm test` with exit
zero under canonical Node 24.18.0:

- Node/product matrix: 1,025 passed, 14 intentional no-database skips, zero
  failures;
- operations matrix: 205/205 passed;
- Pages artifact: 90 explicitly reviewed files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 current hosted routes at 320x720, 390x844, and 1440x1000,
  including keyboard, focus, overflow, and 44px controls.

The operations clean-repository gate first rejected the uncommitted tree, as
designed. It passed without modification after the single implementation
commit; this failure was not counted as proof.

## Effects and remaining work

- Public placeholder, DNS, Cloudflare, Pages publication, carrier settings,
  Twilio API, live phone numbers, messages, Stripe, mail, HQ, Dell, protected
  databases, deployment, App Store, Play Store, and cutover were untouched.
- FIN-006D is complete in held-local form. Provider credentials, managed-number
  provisioning, carrier instructions, test calls, outbound messaging, and app
  distribution retain their separate activation gates.
- FIN-006 remains open and retains zero new denominator points until every
  mandatory capability/process row is composition-proved.
- The next bounded Responder slice is the native client contract and iPhone
  application against this exact backend, followed by the Android client and
  final unified-composition closure. No second backend is authorized.
