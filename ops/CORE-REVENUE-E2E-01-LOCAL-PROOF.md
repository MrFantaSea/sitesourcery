# CORE-REVENUE-E2E-01 local proof

This proof closes the local first-dollar linkage gap without contacting Stripe
or any other provider. It composes the shipped browser, hosted HTTP boundary,
canonical PostgreSQL repositories, released joint Legal V7 authority, the
contract-test payment provider, the support-case lifecycle and Download reversals.
Browser commands use the shipped API client and same-origin fetch in real Chrome;
this is automated browser/HTTP evidence, not a claim that every UI button was clicked.

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
- The same browser registers a synthetic customer and completes the real email-
  possession activation endpoint using a token from the development mailbox.
- An authenticated operator with an append-only `service_case_manage` grant
  issues the exact direct-inquiry invitation through hosted HTTP.
- Before invitation claim, the verified account exists; the reserved project and
  engagement do not. The invitation binds that existing customer organization.
- The browser fetches released Legal V7 and claims the invitation with the
  customer credential. The secure HttpOnly session identifies the same verified
  account, organization, project, legal receipt, engagement and direct Custom
  opportunity in PostgreSQL. Invitation possession alone is not substituted for
  the separate registration email-possession evidence required by Download.
- That account saves a draft, binds the locally compiled preview digest,
  creates and accepts a version, obtains the exact $20 Download quote, and opens
  one contract-test Checkout after explicit acceptance of the current purchase
  terms. Fake provider readback binds the verified account, billing identity and
  requested 3DS evidence. No price, entitlement, provider reference, or
  settlement fact comes from the browser.
- A verified fake webhook is only a wake-up signal. Provider readback occurs
  once; webhook replay is idempotent; PostgreSQL retains the settled dispatch,
  paid receipt, and active entitlement; and the browser downloads the exact
  entitled HTML.
- The same customer opens a project support case over real HTTP. A separately
  authorized operator reads the queue, assigns the case, sets its deadline,
  records review and a response digest, and closes it. Opening and response
  replay create no duplicate events. A customer cannot use the operator queue;
  another tenant cannot read the case through customer routes.
- A fresh page reload recovers the same paid receipt, identical downloadable
  HTML and closed support case without another Checkout.
- A partial refund suspends the entitlement and removes it from customer
  readback. A full refund revokes it, replay is idempotent, operator/database
  readback preserves the paid receipt and settled dispatch, and artifact
  resolution fails closed.
- A dispute delivered after the gate was created holds new Checkouts once,
  preserves its original provider timestamp, and cannot restore a refunded
  entitlement. The gate transition uses database observation time so an older
  event cannot roll back the hold. This global hold is tested after purchases.
- The focused command also runs the isolated ambiguous-Checkout test: an
  uncertain provider response is terminal, records `effect_unknown`, and is
  never automatically submitted a second time.
- Browser resource inspection proves no cross-origin request, missing shipped
  file, or unexpected browser console error during the journey. Reload probes of
  six specifically enumerated adjacent endpoints are asserted separately: Custom
  operator jobs/opportunities are held (503), customer operator access is denied
  (403), and Care/Responder are unmounted in this narrow composition (404). Those
  products are not accepted by this proof.

All provider credential and URL environment variables are removed before the
child test starts. The only injected database URL names the disposable local
database. The JSON result reports `providerEffects: false` and
`databaseAbsent: true` only after cleanup succeeds.

## Known separate failures and limits

The original September 21 paid-project deletion FK failure is corrected by
migration 150. The focused command now includes the named `paid-project deletion
removes content and retains payment evidence` case. It proves SQL content
removal, real local export removal, dark publication, terminal receipts, replay,
and retained Download payment/risk evidence. Eleven independent cases remain
explicitly skipped; this does not accept the entire PostgreSQL suite.

Complete erasure is still open: `selfhost-publication-port.mjs` unpublishes by
making the hostname dark, while `ReleaseStore` retains immutable release files.
Those files are not tracked by this export-store deletion proof. A separate
project-scoped erase operation and finalization fence are required before a
customer's final deletion can truthfully mean all eligible stored copies are
gone. Other product-specific financial retention is also outside this Download
correction. Do not treat SQL `completed` alone as full system erasure evidence.

The support path proves case state, response digests and authorization. It does
not prove correspondence text storage, email notification delivery or the HQ
support UI. No support notification is sent. The browser uses a disposable
loopback HTTP origin with the reviewed secure-cookie test configuration; this
is not public TLS or installed-production acceptance.

Fixture timestamps are relative to one captured current epoch because session
and operator authorization SQL use the actual database clock. Security checks
are unchanged. Synthetic provider and mailbox fixtures remain explicit.

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

## September 21, 2026 local milestone provenance

Implementation `7390a0707713d4913e0422869b7ea43797bdb076`, tree
`e52e61785bbf5b95986190fc6a93934fefcf4a32`, from retained private base
`d16d3b22befa2620944fa590f05531865f14633d`. Sole writer/reviewer: `/root`.

The connected real-browser/HTTP/PostgreSQL proof passed 4 tests with 12 explicit
independent-case skips. The complete clean pinned-Node `npm test` ladder passed
2,428 tests with 20 existing skips, both builds and 144 browser views. The latter
routine ladder skips environment-gated PostgreSQL suites; it does not override
the separately reproduced paid-project deletion failure at that milestone.
The later correction below supersedes that failure, not the broader limits.

Runtime changes are confined to `download-payment-postgres.mjs`: select the
receipt amount for artifact resolution, and stamp locked risk-gate transitions
with monotonic database observation time. Original provider event timestamps
remain in event records. Self-review preserved tenant/member predicates,
immutable audit checks, replay safety and current purchase/verification rules.

Safe evidence is retained under the Mac directory
`SITESOURCERY-CUSTOMER-JOURNEY-2026-09-21`:

- `acceptance-v2.log`: SHA-256 `df84dd38c0022451e3593451ad12665da24300a4cefc8156773c949044c4c2c8`.
- `regression.log`: SHA-256 `20670540906d1ffadee9dbc9f2d9c24fdb3a3a396c1ec187008bc60344488dcf`.
- `proof.json`: SHA-256 `2dde7692a60dc1d4f8094abec87f00cce0ce0ee6dc51219002a92c7dd66f4265`.
- `CLEANUP.json`: SHA-256 `d1c70d68dd2af1f41fb8ef864e80add49a861e261a14484f1ca846591abe72f0`.

Every disposable database was dropped; the owned cluster was stopped. Its
1,542 temporary files (75,232,082 bytes) were removed after zero-client/process
checks; 69 read-only test directories needed owner write permission for cleanup.
The active C2 source worktree and verified incremental bundle remain preserved.
No provider call, production installation, GitHub CI/push/merge or whole-system
completion is claimed. C2 remained open; the next single repair at that checkpoint was paid-project
deletion. This entry is a historical local milestone, not a release acceptance.

## Paid Download deletion correction (migration 150)

The purge keeps the existing Download command/quote/preparation/payment/risk
lineage when an attempt, dispatch or receipt exists. It purges unused quotes
normally. The final receipt separates removed counts from
`retainedDownloadEvidence`, an inventory at sealing time; later financial events
may append evidence without changing that historical inventory. Content rows
are erased and the project remains as a nameless deleted tombstone.

Exactly three direct version FKs (quote, preparation, receipt) are replaced by
live-version checks with key-share locks, plus a referenced-version guard that
allows deletion only inside the actual sealed terminal boundary. Tenant,
project, payment and evidence FKs and evidence immutability remain intact.
Ordinary version deletion, forged setting without a seal, and version-key
rewriting are rejected. Transactions retain canonical serializable isolation.
Unresolved `dispatching`, `ready` and `effect_unknown` Checkouts reject deletion
before side effects with `PROJECT_PAYMENT_RECONCILIATION_REQUIRED` (HTTP 409).
There is no implicit provider cancellation or reconciliation.

The local proof covers a paid/refunded/disputed project, an attempt-only
risk-held project, and an unpaid quote-only custom-domain project. Seven
lifecycle jobs finish using the real local object/publication ports; at least
one export exists before removal. Stale completion is fenced, deletion command
replay is stable, deleted downloads/new quotes are denied, and a new dispute
closure after deletion can append its dossier without restoring access.

For a populated upgrade, set `SITESOURCERY_DELETION_UPGRADE_PROOF=1` with the same
owned local runner. The test withholds migration 150, proves the new runtime
rejects that 102-file schema, and builds synthetic fixtures with an explicit
adapter for the prior runtime's readiness contract. No service transactions or
financial results are mocked. It then applies migration 150, removes that
adapter, asserts current readiness and compares all twelve financial/risk
tables before and after the upgrade and deletion. Run without the flag to
prove fresh 103-file installation with the unadapted current runtime.

Deployment remains separate. Migration 150 must precede this runtime, which
requires its marker for readiness. After content has been erased, reverting to
the old FK/purge contract is not a safe rollback; recovery requires a coordinated
backup/restore and payment reconciliation plan. This local migration proof is
not a production restore or rollout authorization.

## Paid-deletion local provenance — September 21, 2026

Final local implementation `191a198ffe810d07b25b04d3bde1b83f27fccf91`, tree
`9ab14c1b85eadb3e9d32e840f9d184788103360b`, includes core fix `068c93a` and
exact migration inventory update `856c322`. Sole writer/reviewer: `/root`.
Historical FIN-015 production authority is unchanged. Its fixture now uses
exact retained 102-file bytes and also proves the current tree is rejected.

Populated-upgrade and fresh-install PG16/browser runs each pass 5 tests with
11 explicit skips and complete 7 local lifecycle jobs. Canonical stage coverage
is 2,430 passed tests, 20 existing skips, both builds and 144 browser views.
To avoid redundant work, unchanged stages through hosted-service are retained
from clean `856c322`; only the historical ops fixture changed afterward.
`check:ops` and every remaining build/artifact/hosted/browser stage passed on
clean `191a198`. This is combined exact-stage coverage, not a claim that one
full `npm test` invocation passed at the final hash. Runtime/PG/migration bytes
are identical across the passing focused proof and final application source.

Evidence directory: `SITESOURCERY-PAID-DELETION-2026-09-21` on the Mac.

- `upgrade-v8.log`: `b9cca6ba92b24c255bafc0f3b6d9b015be58003fd6b9eeec88bf977f52f50d1d`.
- `fresh-v1.log`: `9b09276645fc399cef8c77a1a8f2e8add10ae0c2fc849759875b76973f27bb9a`.
- `regression-final.log` (passed earlier stages, historical ops failure retained): `5631821c9370ffa965662b0f8547345a970e4149a1f7df5f7aca2f5072932dbf`.
- `regression-remaining.log`: `5fda52a4bd5e092c00364b418dc4a3e2f852fbf25e5c31fe5830444dde7d2c75`.
- `proof.json`: `ffdfb111c2315d791d210e28492fbc3671f8e2dccfe198d3f2ddef63ccea7a9a`.
- `CLEANUP.json`: `ae1262713f6d6798b916ebc317d1b6bd698b08de00024c0a8540f5755595e095`.

All disposable databases are absent, PG stopped, owned processes gone; removed
1523 temporary files (75179163 bytes). Evidence and active source remain.
The selfhost release-copy erasure gap above is the next single deletion item.
No production migration, deployment, external provider effect, GitHub release
or whole-system completion is claimed. C2 remains open.
