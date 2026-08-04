# Site Sourcery active run

This is the durable resume point for the work in progress. It records
execution state that must not live only in chat context. Product scope and the
finish line live in `SITESOURCERY-MULTI-AGENT-ROADMAP-2026-08-04.md`; settled
owner rulings live in `CONTINUITY.md`.

## Recovery rule

After a context compaction, terminal restart, or agent handoff:

1. Read this file, the canonical roadmap, and the latest relevant continuity
   entry before changing code.
2. Inspect the branch, `HEAD`, worktree, running processes, open agents, and
   named disposable resources. Do not infer that an interrupted command
   passed or failed.
3. Resume only the single `Next action` below. Reconcile this file before
   opening another lane or repeating completed work.
4. Record every release-relevant test result here immediately after it
   finishes. Output lost before it is recorded is unverified and must be
   reproduced safely.
5. Before a local commit, replace this in-flight snapshot with the sealed
   checkpoint evidence and the next clean batch.

## Safety holds

- Branch: `build/sitesourcery-v2-20260730`.
- Prior sealed checkpoint: `3ad0911` (`Connect held Alakazam customer
  checkout`). This ledger is sealed with Batch 2B when branch `HEAD` has
  subject `Connect held Alakazam customer start flow`; otherwise treat the
  listed Batch 2B work as in flight and inspect the worktree before resuming.
- Public production remains the July 22 predecessor.
- No push, deploy, DNS change, provider write, credential capture, or release
  approval is authorized by this run.
- Batch 1 is verified, local, and held. It changes no public or provider state.

## Current objective

Batch 2B connects the browser to the proven, still-held Batch 2A backend:
eligible project → canonical tier selection → exact quote and `$5` credit
review → explicit disclosure acceptance → one safe Stripe Checkout redirect.
Project eligibility and runtime quote/Checkout readiness remain separate
truths. Upgrade, downgrade, Portal, and cancellation controls remain out of
scope for this slice.

## Completed and reviewed

- Customer account projection, PostgreSQL repository read, hosted boundary,
  same-origin GET route, and production composition are implemented.
- The read model excludes provider identifiers and denies cross-tenant,
  cross-project, and foreign billing-owner reads with one generic boundary.
- The account panel covers held, empty, pending, active, attention, ended,
  loading, error, and retry states. The narrowly composed start flow now
  enables exact quote review and accepted Checkout only when account
  eligibility and runtime capability are both true; every other billing
  command remains disabled.
- Receipt formatting was corrected to use the receipt total (`$10.00 USD` in
  the focused regression), not a nonexistent money field.
- The browser projection now rejects an impossible subscription-plus-unused-
  first-payment-credit combination instead of rendering contradictory facts.
- Exact held-by-default Stripe Product/Price/Coupon/Portal configuration is
  implemented without real IDs, keys, network effects, or release changes.
- Public promises were classified KEEP / CHANGE / REMOVE / HOLD in
  `SITESOURCERY-PUBLIC-TRUTH-AUDIT-2026-08-04.md`.
- Two integration-review findings were repaired: false empty state for a
  non-owner project member and incorrect receipt rendering.

## Verification ledger

Verified before the two final review repairs:

- Core Node suite: 417/417 pass.
- Hosted service: 135 pass, 2 intentional environment skips, 0 fail.
- Operations: 52/52 pass.
- Migration structure: 23/23 pass.
- Self-host checks: 19/19 pass.
- Site check: 18 live pages and 20 redirects pass.
- Hosted/artifact checks: exact 78-file artifact pass after regeneration.
- Stripe adapter/configuration aggregate: 69/69 pass.

Verified after the relevant repairs:

- Account/repository/HTTP focused tests: 11/11 pass.
- Receipt UI plus hosted-artifact focused tests: 8/8 pass.
- Real PostgreSQL lifecycle journey: 5/5 pass on
  `ss_alakazam_account_batch1_20260804_3` after all 31 migrations, including
  the foreign billing-owner case. The authoritative rerun completed with exit
  0 on 2026-08-04.
- The first isolated Chrome run passed all mechanics but used an impossible
  active-subscription-plus-credit mock. Lead review tightened the validator;
  that visual evidence is superseded.
- The corrected isolated Chrome rerun at 1440×1000 and 320×720 passes every
  state, signed-out/no-project hiding, error/retry, stale-project rejection,
  accessibility-tree semantics, and horizontal bounds. All 94 API requests
  were GETs, no ready-state mutation control or unexpected browser error was
  present, active subscription states show no available Download credit, and
  `$10.00 USD` renders for the receipt. The lead inspected the corrected
  desktop active, mobile active, and mobile available screenshots. Results
  JSON SHA-256:
  `de5990da8eecc14c7a78b0c32c5b5a813f87d20d256a269bc7c0a0fecaf4b78c`.
- Post-review broad rerun: core Node 417/417 pass; hosted service 135 pass,
  2 intentional environment skips, 0 fail; operations 52/52 pass.
- Hosted build plus HTML validation: pass. Public pages artifact: 78
  allowlisted files with exact source bytes, pass.
- Reviewed browser-source SHA-256 values exactly match the hosted-truth
  manifest; final `git diff --check` is clean.
- After the subscription/credit fail-closed tightening: focused UI 4/4 and
  core Node 417/417 pass; the held hosted build validates; the rebuilt public
  artifact contains the exact 78 allowlisted files; both reviewed browser
  source hashes match the manifest; `git diff --check` remains clean.
- Syntax and `git diff --check`: pass after each repair.

## Batch 2A evidence ledger

- Accepted-disclosure digest is now an exact required input to Customer
  provisioning and Checkout claims. PostgreSQL compares it with the durable
  quote before any reservation or provider effect, and replay cannot cross it.
- Focused Alakazam billing service: 20/20 pass after the fence.
- Billing service and PostgreSQL repository syntax: pass; `git diff --check`
  is clean.
- Fresh 31-migration PostgreSQL journey: 5/5 pass, including wrong-digest
  rejection before Customer and Checkout reservations.
- Disposable proof database
  `ss_alakazam_acceptance_batch2a_20260804_1`: 0 active sessions before its
  exact drop and 0 matching databases afterward.
- The exact two-route, browser-input, redacted-output, authentication, CSRF,
  idempotency, and held-default contract is frozen in the canonical roadmap.
- Both HTTP POST routes, global CSRF/idempotency reuse, production composition,
  and lead-owned route tests are written. HTTP, executable, and test syntax
  pass; `git diff --check` remains clean.
- Combined billing-service plus hosted-boundary tests: 26/26 pass. Combined
  Alakazam account/HTTP route tests: 7/7 pass. The route now reaches the exact
  service contract while remaining held by release/provider readiness.
- Post-connection broad regressions: core Node 424/424 pass; hosted service
  139 pass, 2 intentional environment skips, 0 fail. This includes runtime
  assertion and production-composition source checks.
- Fulfillment inventory is complete in
  `SITESOURCERY-ALAKAZAM-FULFILLMENT-INVENTORY-2026-08-04.md`. Its critical
  later gate is to replace legacy publication subscription proof with exact
  `ss.alakazam_subscriptions` revision/capability proof; it does not expand the
  current billing-route slice.
- Lifecycle inventory is complete in
  `SITESOURCERY-ALAKAZAM-LIFECYCLE-INVENTORY-2026-08-04.md`. Renewal success is
  the first safe later slice; grace, suspension, cancellation, retention, and
  reversal consequences remain owner-held and must not inherit legacy policy.

## Batch 2B evidence ledger

- Account projection exposes `actions.start: true` only when the project has
  neither a subscription nor a pending change. Hosted capabilities project
  Alakazam quote and Checkout readiness separately from the billing boundary;
  the default/release-held boundary projects both false.
- The browser adapter sends only `targetTierId` or the accepted disclosure
  digest through the existing cookie, CSRF, and stable UUID idempotency
  boundary. Nested browser claims of payment or provider authority are
  rejected before fetch.
- The customer validator accepts only an unexpired, exact-schema `start`
  quote that agrees with the latest project account, canonical tier, `$5`
  credit, due-now arithmetic, renewal, disclosure, and digests. Checkout
  accepts only the exact bound command and an uncredentialed,
  fragment-free HTTPS `checkout.stripe.com` destination.
- The customer panel renders all three `$25/$35/$50` choices, exact quote
  facts, explicit acceptance, and safe retry state. Upgrade, downgrade,
  Portal, cancellation, and browser persistence remain absent.
- Focused browser/API contract tests: 24/24 pass. Focused account/hosted HTTP
  tests: 19/19 pass. The reviewed source hashes build and verify as one fresh
  hosted artifact.
- Isolated Chrome for Testing 149.0.7827.55 passed at 1440×1000 and 320×720:
  signed-out/no-project hiding, held-capability zero-write behavior, all
  account states, loading/error retry, stale-project rejection, exact
  Alakazam 35 quote (`$35`, minus `$5`, `$30` due now, `$35` renewal),
  acceptance gating, stable quote and Checkout retry identities, CSRF/body
  allowlists, malicious Checkout rejection, expiry during review blocked
  before a Checkout write with a fresh quote identity required, safe Stripe
  redirect, AX semantics, and zero horizontal overflow. The redirect was
  intercepted before external network access. Evidence:
  `/private/tmp/sitesourcery-alakazam-start-browser.pJSraR/`;
  results JSON SHA-256
  `f1cedf756845516983b98887a3740b78e45a164aa5a86f6c999decdaecafad0a`.
- Post-browser broad regressions: core Node 427/427 pass; hosted service
  140 pass, 2 intentional environment skips, 0 fail; hosted runtime and
  syntax pass; hosted HTML validation passes; current site check passes 18
  live pages, 20 redirects, 28 catalog prices, and 5 sellable rails.
- The explicitly legacy `check-abracadabra-v1` still reports four
  old-generation assumptions. A clean `HEAD` archive reports the identical
  four failures, proving no Batch 2B regression; it is not a current release
  gate and must not be “fixed” by removing the hosted account/subscription
  architecture.

Batch 1 sealed checkpoint gates:

- [x] Verify the named PostgreSQL test database is idle, drop it, and verify
  it is absent: 0 active sessions before drop, 0 matching databases after.
- [x] Obtain an actual isolated browser/mobile/accessibility pass for the
  current account panel using contract-valid fixtures.
- [x] Rerun the core/artifact checks invalidated by the final UI tightening.
- [x] Verify the recomputed hosted-truth hash after the final UI tightening.
- [x] Reconcile roadmap and continuity wording with final evidence.
- [x] Review the exact 25-file staged diff for scope, secrets, provider IDs,
  release holds, and whitespace. Secret-like additions are short explicit test
  fixtures; provider-like additions are descriptive test IDs. No real key,
  provider object ID, or release-opening change is present.

## Live resources and workers

- Browser API adapter worker Ampere,
  `019fcee7-6d6f-7d73-bd01-7a2525a764ba`, completed its exclusive
  browser-adapter/test write set with 19/19 focused tests and is closed.
- Fulfillment mapper Nietzsche completed its exclusive inventory document and
  is closed.
- Lifecycle mapper Raman completed its exclusive inventory document and is
  closed.
- Hosted billing boundary worker Aristotle completed its exclusive module and
  focused test (6/6 pass) and is closed.
- Disposable PostgreSQL database
  `ss_alakazam_acceptance_batch2a_20260804_1` completed all 31 migrations and
  the 5/5 acceptance-fence journey, then was dropped with 0 active sessions
  and verified absent.
- Batch 1 runtime visual verifier Ramanujan is closed. Current evidence is
  under `/private/tmp/sitesourcery-alakazam-credit-verify.6NdTyI/`; the earlier
  evidence under `/private/tmp/sitesourcery-alakazam-verify.hSUfUh/` is
  superseded.
- Batch 2B runtime evidence is under
  `/private/tmp/sitesourcery-alakazam-start-browser.pJSraR/`; no verifier
  process or localhost server remains running.
- Disposable PostgreSQL database
  `ss_alakazam_account_batch1_20260804_3` was idle, dropped, and verified
  absent after its passing test.
- No Batch 1 test process was running at the last process inspection.
- A pre-existing unrelated Python server remains on port 4173 for an older
  canonical-email artifact; do not mistake it for this browser harness.

## Next action

Freeze the distinct customer upgrade contract before exposing any upgrade
control. Reconcile the already-proven backend upgrade machinery with the
customer-safe account/action projection, exact quote/acceptance UX, and
post-settlement refresh boundary first. Do not infer downgrade, Portal,
cancellation, fulfillment, lifecycle, owner-tool, release, or provider
authority from the completed start flow.

## Batch 1 write scope

Lead write scope for Batch 2B: account start eligibility, capability projection,
customer-control validation/DOM/CSS, hosted-artifact proof, and focused tests.
The API-adapter worker owns only `abracadabra-api.js` and its existing focused
test. Server billing/repository code, migrations, fulfillment, lifecycle, and
provider configuration are out of scope.
