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
- Batch 3B is the latest reviewed local checkpoint represented by this ledger;
  use `git log -1` for its eventual checkpoint commit rather than copying a
  hash into the commit that creates it.
- Public production remains the July 22 predecessor.
- No push, deploy, DNS change, provider write, credential capture, or release
  approval is authorized by this run.
- Batch 1 is verified, local, and held. It changes no public or provider state.

## Current objective

Start one narrow Batch 3C tier-transition fulfillment slice: after an upgrade
or renewal-boundary downgrade becomes authoritative, derive and publish the
exact new tier policy before another tier change is offered. Preserve retained
premium configuration without exposing unresolved `$35/$50` editors. Portal,
cancellation, lifecycle policy, owner invoicing, domains, and release remain
separate lanes.

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

## Batch 2C in-flight ledger

- The canonical roadmap now freezes the customer upgrade contract. Upgrade is
  eligible only for an active, paid, non-cancelling `$25` or `$35`
  subscription with a current period and no pending change. Only higher tiers
  may be offered; `$50`, attention, pending, scheduled, cancelling, cancelled,
  and ended states expose no upgrade action.
- Server account truth implements that exact `actions.changeTier` projection;
  start, Portal, and cancellation remain false for subscribed accounts.
- The public `noMidPeriodRefundOrProration` field remains the existing
  downgrade-only paid-period-retention rule (false for starts/upgrades, true
  for downgrades). Upgrade truth is the fixed target-minus-current payment,
  disclosure `providerProration: false`, and the provider adapter's unchanged
  billing boundary/no-proration contract. No schema or historical quote digest
  was changed merely to rename that established rule.
- A critical composition gap found by the read-only audit is repaired in the
  worktree: verified upgrade payment settlement now enters the existing
  durable `applyPaidUpgrade()` service. Production creates one upgrade service
  instance for both paid application and later Subscription-event activation.
  Starts never enter upgrade application; impossible Checkout change kinds
  stop before settlement. Existing application leases, confirmation state, and
  read-only ambiguity recovery remain the duplicate-provider-mutation fences.
- Backend focused proof currently passes: 33/33 webhook/quote/production
  composition tests and 77/77 account/billing/payment/upgrade/HTTP/PostgreSQL
  projection tests. The integrated browser contract is 8/8 green. Syntax and
  `git diff --check` pass. These are in-flight results, not a sealed
  checkpoint; broad suites, artifact proof, and browser proof still remain.
- Browser worker Banach (`019fcf0e-07ad-7511-b9ce-20f431d4b125`) changed only
  `abracadabra/app/abracadabra-customer-control-dom.js` and
  `scripts/test/abracadabra-alakazam-account.test.mjs`. Its result was reviewed,
  independently rerun at 8/8, and the worker is closed.
- Fresh database `ss_alakazam_upgrade_batch2c_20260804_1` replayed all 31
  migrations. Its first 5-test journey exposed one stale assertion that still
  expected every customer command disabled after a completed downgrade to an
  active paid `$25` tier. The assertion now checks the exact new action object;
  the authoritative final rerun passes 5/5. It also proves a competing direct
  `$25→$50` quote cannot claim a Checkout after the first payment settles,
  while a later legitimate upgrade can claim after atomic activation. The
  database had 0 active sessions, was dropped, and has 0 remaining matches.
- Post-integration broad proof passes: core Node 434/434; hosted service 140
  pass with 2 intentional environment skips; operations 52/52; self-host
  19/19; migration structure 23/23; runtime assertion; current site check (18
  live pages, 20 redirects, 28 prices, 5 rails); held hosted build plus HTML;
  and the rebuilt 78-file public artifact with exact source bytes. The first
  public-artifact check correctly reported a stale derived `_site`; rebuilding
  before verification produced the authoritative pass.
- The reviewed customer-control source SHA-256 is
  `5445e65e2f1b500f14fd90e44ea381f85a04910b919e4cdec47b8c94c9ba4417`.
  Its hosted-truth manifest now binds that exact digest, and both the temporary
  browser artifact and ordinary `_hosted` artifact build and verify.
- Browser verifier Dalton (`019fcf18-8f2e-7fe1-b380-ed14f165fca6`) passed
  27/27 proofs and is closed. Chrome for Testing 149 covered 1440×1000 and
  320×720, 25 screenshots, exact `$25→$50` and `$35→$50` money, eligibility,
  held zero-write states, retries, acceptance, expiry, destination rejection,
  intercepted safe redirect, accessibility, no overflow, and server-only tier
  authority. There were 177 API requests (162 GET, 15 POST), 0 external
  responses, and 0 unexpected browser errors. Evidence is under
  `/private/tmp/sitesourcery-alakazam-upgrade-browser.FSe1PL/`; results JSON
  SHA-256 is
  `f7204667d2a4736239467e139defd19d6ce87525151f08e2252f948c7ea92c40`.
- Volta's completed read-only review found one real blocker before seal: the
  old Checkout claim query stopped considering a dispatch after settlement,
  while the local subscription remained on its old tier until the later
  Subscription event. A stale second quote could therefore attempt another
  difference payment. The repaired claim joins dispatch and quote state under
  the existing project lock, blocks settled/provider-pending or reconciliation
  states, and passes both sides of the PostgreSQL proof. Volta found no other
  Batch 2C blocker and is closed.

## Batch 2D sealed checkpoint evidence

- Account eligibility now exposes every different canonical tier only for an
  active, paid, non-cancelling subscription with a current period and no
  pending change. `$35` offers one lower and one higher direction; `$50`
  offers both lower tiers. Direction is derived from the verified tier ranks.
- The browser uses the existing quote route and a distinct authenticated
  downgrade Schedule route/capability. It submits only the target tier, exact
  quote and disclosure digests, CSRF proof, and stable UUID identities. A
  downgrade cannot enter Checkout.
- The review and accepted command prove `$0` charged now, `$0` refunded now,
  no provider proration, the current tier through the paid boundary, and the
  full lower-tier renewal at that boundary. The safe response contains no
  provider ID. Refresh keeps the current tier authoritative while separately
  projecting the pending downgrade and lower renewal.
- Existing durable Schedule claim/lease, ambiguity readback, provider
  confirmation, account projection, and boundary activation remain unchanged.
  Production composes the authenticated route while all provider/release gates
  remain held.
- Focused browser/API/account/backend/HTTP/provider proof passes 101/101. Fresh
  database `ss_alakazam_downgrade_batch2d_20260804_1` replayed all 31
  migrations and passed the full 5/5 Alakazam PostgreSQL journey. It had zero
  active sessions, was dropped, and is verified absent; no customer or
  production data was touched.
- Chrome for Testing 149 passes 10/10 isolated proofs at 1440×1000 and 320×720:
  mixed upgrade/downgrade choices, exact review money/dates, acceptance gate,
  held zero-write state, stable Schedule retry identity, safe account refresh,
  invalid confirmation rejection, accessibility, no overflow, no Checkout
  writes, no external HTTP, no missing files, and no unexpected browser error.
  It also forces a confirmed Schedule followed by a failed account refresh:
  success remains announced and focused, stale tier controls are disabled, and
  the recovery retry performs only a GET with no second Schedule. Eleven
  screenshots and the report are under
  `/private/tmp/sitesourcery-alakazam-downgrade-browser.lctWsN/`; results JSON
  SHA-256 is
  `447e29b2cb0f8a1b9cd194dc653cccdc96a0427ef17d5a26fc4bb8e08d1d72a6`.
- Post-fix broad proof passes: core Node 439/439; hosted service 140 pass with
  2 intentional environment skips; operations 52/52; self-host 19/19; current
  site checks; hosted build/HTML validation; and rebuilt public artifact with
  78 allowlisted files and exact source bytes. The broad pass caught one stale
  pre-downgrade capability expectation; both expected shapes were corrected
  and the focused HTTP file passes 9/9 before the clean broad rerun. The final
  customer-control regression passes 11/11 after the refresh-state repair.
- Read-only backend auditor Avicenna
  (`019fcf2f-a5bd-7f52-9ece-72ae5520eb21`) found no missing migration,
  provider, activation, duplicate-charge, or duplicate-schedule work and is
  closed. Hosted worker Confucius
  (`019fcf37-8889-7d92-baf8-815625bd660e`) completed its exclusive five-file
  route/composition write set; the lead reviewed and reran it, and it is
  closed.
- Read-only polish auditor Gauss
  (`019fcf45-ca9e-7ca0-a303-28930452b35e`) found one real UI completion
  blocker: confirmed scheduling was discarded by the immediate refresh, so a
  failed read could falsely claim nothing changed and lose accessible focus.
  The repair preserves verified Schedule truth, announces/focuses every
  completion state, disables stale actions, and retries only the account GET.
  Gauss's three non-blocking follow-ups are preserved in the roadmap polish
  queue; the worker is closed.

Batch 2D sealed checkpoint gates:

- [x] Frozen contract matches the latest owner tier and no-refund rulings.
- [x] Focused, fresh-PostgreSQL, real-Chrome, broad, and artifact proofs pass.
- [x] The named disposable database is dropped and verified absent.
- [x] Customer response and browser state expose no provider identifiers.
- [x] Release, provider, DNS, push, and deployment holds remain unchanged.
- [x] Durable evidence and the next action are recorded before the local
  checkpoint commit.

## Batch 3A fulfillment backend sealed checkpoint evidence

- Migration 32 adds service-only fulfillment intents, operations, and a
  durable fulfillment projection. A start intent freezes the exact quote, accepted
  source version, licensed platform address, and selected look before any
  provider effect. The queued operation later freezes the exact active
  subscription revision, tier, effective policy, and capability.
- Fulfillment proof keeps the customer-accepted source version separate from
  the deterministic policy-derived publication artifact. Both byte digests,
  compiler identities, screening evidence, address authority, and active
  subscription revision must agree; a stale, cross-project, forged, or
  browser-expanded claim fails closed.
- Crystal, Hearth, and Midnight are three distinct canonical base looks. The
  `$25` and `$35` policies mask unresolved premium rendering without deleting
  configured facts. Only canonical `$50` authority enables the currently
  implemented Cash App and Venmo output; unimplemented premium controls remain
  held.
- Start activation enqueues one semantic fulfillment operation. Replay returns
  the same operation instead of compiling or publishing twice. The held-by-
  default worker claims, compiles, stages, screens, binds, self-hosts, and
  finalizes one exact release only when both Alakazam and publication release
  gates permit it.
- The self-host adapter serves the exact compiled bytes at the licensed
  `label.sitesourcery.me` address. A finalization failure compensates by
  unpublishing and recording durable dark/retry truth rather than claiming the
  site is live.
- A definitely pre-effect Checkout failure supersedes its prepared fulfillment
  intent and now proves that the temporary projection is removed, preventing a
  failed payment attempt from leaving a ghost pending-site state.
- Fresh database `ss_alakazam_fulfillment_f3_20260804_1` replayed all 32
  migrations and passed the complete 5/5 PostgreSQL journey: payment
  settlement, start activation, queue, real compilation, real self-host
  publication, exact served bytes, replay, upgrade, and renewal-boundary
  downgrade. After the final failure-path repair, the same journey again
  passed 5/5.
- Authoritative Node 24 proof passes: final focused fulfillment/repository/
  publication set 34/34; core Node 446/446; hosted service 151 pass with 2
  intentional environment skips; operations 52/52; self-host 19/19; current
  site 18 live pages, 20 redirects, 28 catalog prices, and 5 sellable rails;
  hosted HTML and the exact 78-file public artifact verify.
- The disposable proof database had zero active sessions, was dropped by exact
  name, and is verified absent. No customer or production data was touched.
- This checkpoint proves the backend vertical contract, not the customer UI.
  Platform-label/look controls, account fulfillment projection, authenticated
  browser proof, and launch polish remain the next slice.
- No push, deployment, DNS change, provider release, or production mutation
  occurred. The July 22 public fallback remains untouched.

Batch 3A sealed checkpoint gates:

- [x] Exact accepted-source and policy-derived-artifact authority is frozen.
- [x] Migration 32 replays from zero and the real PostgreSQL/self-host journey
  passes.
- [x] Replay, stale authority, failed Checkout, and post-publication
  compensation paths fail safely.
- [x] Focused, broad, site, hosted, and public-artifact regressions pass under
  the required Node 24 runtime.
- [x] The named disposable database is dropped and verified absent.
- [x] Release, provider, DNS, push, and deployment holds remain unchanged.
- [x] Customer controls are explicitly still open rather than misreported as
  complete.

## Batch 3B customer fulfillment sealed checkpoint evidence

- Reuse the accepted Maker version for content and look. Public labels are
  Crystal, Hearth, and Midnight; `clear`, `warm`, and `arcane` remain internal
  compiler values and never become billing authority.
- Reuse the existing authenticated, project-scoped, idempotent licensed-address
  command for `label.sitesourcery.me`. Do not create a second address table,
  reservation service, or competing project control.
- Bump the exact account projection to v2 with one `site` object containing the
  accepted version, public look, licensed label/hostname, setup digest,
  setup/publication state, safe live URL, and update time. No artifact bytes,
  provider identifiers, release IDs, worker leases, or raw failure evidence may
  cross the boundary.
- Site states are exactly `setup_required`, `ready_for_checkout`,
  `payment_pending`, `publishing`, `live`, or `attention_required`. Durable
  fulfillment `prepared/pending/live/dark/failed` maps to those customer terms;
  absence of a projection is derived from the exact accepted version and
  configured licensed address.
- `actions.configureSite` is true only before a subscription or in-flight
  payment exists. `actions.start` additionally requires exact setup readiness.
  Tier change requires the existing paid/active eligibility and a live site;
  every direct API write independently rederives the same prerequisite.
- The setup digest binds project, accepted version and artifact, internal look,
  licensed address, and hostname. Start Checkout requires the current digest;
  a stale or cross-project digest fails before Stripe. Upgrades carry no setup
  digest and cannot substitute one.
- The account panel shows the accepted look, asks only for the platform label
  when setup is incomplete, resets stale billing review after a setup change,
  and shows pending/live/attention truth after payment. Publication remains
  automatic; this slice adds no casual manual publish, rollback, or unpublish
  button.
- Setup freshness remains separate from provider purpose. Start Checkout
  rejects a stale setup before Customer creation and again under the locked
  project/quote claim; upgrades require an exact null setup digest.
- Generic command identity now includes organization and project scope.
  Accepted-version and licensed-address writes lock the project and stop once
  Alakazam Customer, Checkout, subscription, or fulfillment authority exists.
  A real competing Checkout wins one setup race while both later edits fail,
  with exactly one provider Customer and one Checkout call.
- The account browser retries one failed initial read only when accepted-version
  identity changed while that read was in flight. A persistent failure remains
  stopped behind the visible retry control. Chrome 149's `v`-mode HTML pattern
  parsing exposed an unescaped address-label hyphen; the shipped pattern is now
  valid in both Chrome validation and the existing JavaScript validator.
- Fresh database `ss_b3b_20260804_codex1` replayed all 32 migrations and passed
  the complete 5/5 Alakazam lifecycle, including setup, settlement, activation,
  publication, upgrade, downgrade, and customer account truth.
- Fresh database `ss_b3b_service_20260804_codex11` passed the canonical service
  journey 12/12. It proves cross-project idempotency, the Checkout/setup race,
  export recovery, same-origin browser API behavior, and the shipped account
  journey. The real page creates and activates an account, creates a project,
  accepts its version, saves a unique platform label from a 390x844 mobile
  viewport, receives `ready_for_checkout` plus a SHA-256 setup digest, and
  confirms the exact configured address in PostgreSQL. The account panel also
  fits and remains labelled at 1440x1000 with no horizontal overflow.
- Final focused browser/API proof passes 36/36. Final broad Node 24 proof passes:
  core Node 459/459; self-host 19/19; hosted service 154 pass with 2 intentional
  environment skips; operations 52/52; current site 18 live pages, 20
  redirects, 28 catalog prices, and 5 sellable rails; exact 78-file public
  artifact; held hosted build plus HTML; and the current browser audit across
  15 hosted routes at three viewports.
- All named Batch 3B disposable databases, including the superseded
  `ss_b3b_service_20260804_codex10` and final `codex11`, had zero active
  sessions before exact deletion and are verified absent. No customer or
  production data was touched.
- No push, deployment, DNS change, provider release, or production mutation
  occurred. The July 22 public fallback remains untouched.

Batch 3B sealed checkpoint gates:

- [x] Account schema v2 and exact customer-safe site states are implemented.
- [x] Setup changes, stale proof, cross-project replay, and Checkout races are
  fenced before duplicate provider or publication effects.
- [x] Focused, all-migration PostgreSQL, shipped-browser, broad, artifact, and
  responsive-layout proofs pass under the required Node 24 runtime.
- [x] Named disposable databases are dropped and verified absent.
- [x] Release, provider, DNS, push, and deployment holds remain unchanged.

## Live resources and workers

- No Batch 3B browser verifier, local evidence server, or worker remains
  running. All Batch 3B disposable PostgreSQL databases are absent.
- The existing HQ PostgreSQL loopback tunnel remains an intentionally shared
  test resource. Public production remains untouched.

## Next action

Freeze and implement Batch 3C as one vertical tier-transition fulfillment
slice. A verified upgrade or boundary downgrade must queue one operation bound
to the new subscription revision, compile the new effective tier policy,
republish exact bytes at the existing licensed address, and expose pending/live
or attention truth. Another tier change stays unavailable until that operation
is live. Keep unresolved premium editors, lifecycle policy, invoicing, domains,
provider release, push, deployment, and public cutover outside this slice.

## Batch 3B write scope

Twenty-two reviewed implementation, test, and ledger files cover account
schema v2, setup freshness, project/Checkout fencing, customer controls,
PostgreSQL authority, production composition, and exact unit/integration proof.
No migration, public copy, provider credential, lifecycle rule, invoice,
registrar, push, deploy, DNS, or production state is changed by this checkpoint.
