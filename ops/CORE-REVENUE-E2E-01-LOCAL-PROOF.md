# CORE-REVENUE-E2E-01 local proof

This proof closes the local first-dollar linkage gap without contacting Stripe
or any other provider. It composes the shipped browser, hosted HTTP boundary,
canonical PostgreSQL repositories, released joint Legal V4 authority, the
contract-test payment provider, and the Download reversal path.

## Run

Use exact Node 24.18.0, the reviewed Chrome for Testing
149.0.7827.55 binary, and a local PostgreSQL 16 admin database. The harness
accepts only a loopback or local-socket PostgreSQL URL.

```sh
SITESOURCERY_PG_CORE_REVENUE_ADMIN_URL=postgresql:///postgres \
  /private/tmp/node-v24.18.0-darwin-arm64/bin/node \
  scripts/core-revenue-e2e.mjs
```

`npm run test:core-revenue-e2e` is the equivalent entry point when `node` on
`PATH` is already exactly 24.18.0.

The harness creates a uniquely named `ss_core_revenue_e2e_*` database from
`template0`, runs the proof, verifies that no sessions remain, drops only that
exact database, and proves its absence. It never terminates a database session.
An existing target name, a non-local URL, PostgreSQL other than major 16, a
failed test, or an occupied cleanup target stops the run.

## Evidence covered

- The reviewed browser reads the public Custom price and direct contact route.
- An authenticated operator with an append-only `service_case_manage` grant
  issues the exact direct-inquiry invitation through hosted HTTP.
- Before claim, no account, project, or engagement exists for the reservation.
- The browser fetches released Legal V4, claims the invitation without a prior
  session, receives only the secure HttpOnly session cookie, and opens the
  reserved account, organization, project, legal receipt, engagement, and
  direct Custom opportunity in PostgreSQL.
- That account saves a draft, binds the locally compiled preview digest,
  creates and accepts a version, obtains the exact $5 Download quote, and opens
  one contract-test Checkout. No price, entitlement, provider reference, or
  settlement fact comes from the browser.
- A verified fake webhook is only a wake-up signal. Provider readback occurs
  once; webhook replay is idempotent; PostgreSQL retains the settled dispatch,
  paid receipt, and active entitlement; and the browser downloads the exact
  entitled HTML.
- A partial refund suspends the entitlement and removes it from customer
  readback. A full refund revokes it, replay is idempotent, operator/database
  readback preserves the paid receipt and settled dispatch, and artifact
  resolution fails closed.
- The focused command also runs the isolated ambiguous-Checkout test: an
  uncertain provider response is terminal, records `effect_unknown`, and is
  never automatically submitted a second time.
- Browser resource inspection proves no cross-origin request, missing shipped
  file, or browser console error during the journey.

All provider credential and URL environment variables are removed before the
child test starts. The only injected database URL names the disposable local
database. The JSON result reports `providerEffects: false` and
`databaseAbsent: true` only after cleanup succeeds.

## Not proved here

This is not production activation evidence. Keep commerce held until the owner
and provider evidence separately proves all of the following:

- Stripe account ownership, Standard and restricted key placement, and key
  rotation/revocation;
- real Stripe test-mode Checkout creation, webhook endpoint delivery and
  signature verification, event replay, provider readback, refund, dispute,
  and ambiguous-response reconciliation;
- owner-approved Tax registrations/settings and the purpose-specific tax mode;
- immutable live products/prices, Customer Portal configuration, production
  database migration/restore evidence, alerting, and operator runbooks; and
- release authority, deployment, DNS, production secrets, and first-live-dollar
  approval.

Invitation delivery is also outside this proof: the operator receives the
one-time claim token from the held local issue edge. Any email delivery must
use the separately durable, provider-reconciled mail lane before production.
