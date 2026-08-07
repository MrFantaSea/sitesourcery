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
- The H1M Custom-build change/completion correction has complete local proof
  and an independent `BLOCKER: NO`. Its exact backend/Abracadabra/integration
  files are separated from the aesthetic lane; use `git log -1` for the local
  checkpoint hash rather than copying a hash into the commit that creates it.
- Public production remains the July 22 predecessor.
- No push, deploy, DNS change, provider write, credential capture, or release
  approval is authorized by this run.
- Batch 1 is verified, local, and held. It changes no public or provider state.

## Current objective

Continue H1 from the sealed change/completion boundary. H1N first invoices and
settles each accepted change order into `effective`, then derives and settles
the separate completion-bound final obligation before immutable handoff and
the database-derived 30-day workmanship window. All real provider effects and
public-service release gates remain held until each preceding local boundary
is proven.

## Owner visual rulings captured 2026-08-06

- `/domains/` must use `site-sourcery-main-street-v2.webp` as that page's
  background instead of showing the same global wizard/storm background plus
  a separate floating copy of the address graphic.
- The opening “Four ways to have an address” copy must use the homepage's
  soft champagne/frosted readability treatment so white words survive bright
  background detail without dimming the entire image.
- Each major public page should ultimately have its own memorable background
  in the same Site Sourcery visual universe. Treat this as a deliberate visual
  inventory and polish lane, not permission to swap every page at once or use
  unrelated art. Domains is the first page-specific conversion.

## Active lane ownership captured 2026-08-06

- Build owns server code, data-plane migrations and PostgreSQL tests, hosted
  composition, Abracadabra customer runtime and controls, backend operations,
  this active-run ledger, and backend-only commits.
- The aesthetic lead owns `vnext.css`, visual assets, and public presentation
  for Domains, Custom/Sorcery, Responder, Work/Spell Book, About, Contact, FAQ,
  and Legal. The homepage is design-locked. Build must not edit those files.
- The preserved aesthetic handoff is currently dirty and uncommitted:
  `domains/index.html` plus `vnext.css` make
  `site-sourcery-main-street-v2.webp` the Domains background, remove its
  floating hero image, and add a frosted intro; `responder/index.html` removes
  its floating hero and interactive ten-minute picker in favor of one visible
  five-step flow; `work/index.html` and `work/work.css` contain the preserved
  in-flight portfolio simplification. Do not discard or mix any of those files
  into a backend checkpoint.
- Completion reporting now comes only from
  `ops/SITESOURCERY-100-PERCENT-COMPLETION-MATRIX-2026-08-06.md`, with Core
  Launch and Expansion calculated separately. Do not report an informal
  percentage.

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

## Batch 3C frozen tier-transition fulfillment contract

- Reuse the completed start fulfillment intent as the immutable accepted
  version, configured-facts, licensed-address, and hostname anchor. A tier
  change must not create a second site, address, or customer setup intent.
- Migration 33 may widen the existing fulfillment operation kind only to one
  server-only `tier_transition` value. Its deferred database proof must require
  the exact active subscription revision and tier plus one matching
  `upgrade_applied` or `downgrade_applied` tier event. Start-operation proof
  remains unchanged.
- Upgrade and downgrade activation handlers enqueue after the atomic local tier
  activation and do the same on an already-applied webhook replay. The semantic
  identity is subscription + result revision + operation kind, so a lost
  response or duplicate event cannot queue a second publication.
- A transition enqueue requires the prior fulfillment projection to be live on
  the immediately preceding subscription revision and exact prior tier. It
  moves that projection to pending for the new tier/revision while retaining
  the prior release reference until replacement succeeds.
- The existing worker compiles the retained configured facts under the new
  effective policy and replaces the bytes at the same licensed hostname. A
  downgrade masks higher-tier output without deleting retained configuration;
  a later eligible upgrade may re-enable it from the same facts.
- Another quote or tier command remains unavailable until fulfillment is live
  on the exact current subscription tier and revision. If local activation
  commits but enqueue fails, account truth becomes attention-required rather
  than falsely offering another change; webhook replay may safely retry only
  the missing enqueue.
- Finalization advances both serving and fulfillment projections to the exact
  new release. A post-publication persistence failure follows the existing
  compensation contract: unpublish, record dark truth, and require safe retry
  instead of claiming the old or new policy is live.
- This slice adds no new customer configuration editor, care quantity,
  lifecycle policy, Billing Portal, cancellation, invoice, registrar, provider
  release, push, deployment, DNS, or production cutover behavior.

## Batch 3C sealed checkpoint evidence

- Migration 33 adds only the server-side `tier_transition` operation kind and
  requires exact applied upgrade/downgrade event, subscription tier/revision,
  prior live projection, and immediately preceding revision evidence.
- Upgrade and renewal-boundary downgrade activation each queue one semantic
  publication operation. Duplicate verified webhooks allocate retry IDs but
  replay the existing subscription+revision operation and perform no second
  provider mutation or publication.
- The existing worker republishes the retained accepted version at the same
  licensed hostname under revision 3 `$35` policy and later revision 4 `$25`
  policy. While either replacement is pending, the account says `publishing`
  and a competing tier Checkout is rejected; the action returns only after the
  exact new release is live.
- If subscription activation outruns fulfillment enqueue, the customer account
  now fails closed to attention-required instead of falsely presenting the old
  release as current or offering another tier change.
- Fresh disposable database `ss_b3c_tier_20260805_codex1` replayed all 33
  migrations and passed the complete 5/5 PostgreSQL journey, including start,
  real self-host publication, upgrade republish, renewal downgrade republish,
  replay, and write fencing.
- Authoritative Node 24 broad proof passes: core 459/459; self-host 19/19;
  hosted service 157 pass with 2 intentional environment skips; operations
  52/52; runtime, HTML, and current-site checks; held hosted artifact; and the
  exact 78-file public artifact.
- The disposable database had zero active sessions, was dropped by exact name,
  and is verified absent. No customer or production data was touched.
- No public/browser source, provider setting, credential, push, deployment,
  DNS, or production state changed. The July 22 public fallback remains
  untouched.

Batch 3C sealed checkpoint gates:

- [x] Exact tier-transition authority and semantic replay are implemented.
- [x] Upgrade and downgrade both recompile and republish the same site.
- [x] Pending, failed-enqueue, and live customer/write truth fail closed.
- [x] All 33 migrations, real PostgreSQL journey, focused, broad, and artifact
  proof pass under Node 24.
- [x] The named disposable database is dropped and verified absent.
- [x] Release, provider, DNS, push, and deployment holds remain unchanged.

## H0 Custom/existing-site two-lane checkpoint

- The canonical commercial contract, continuity ruling, and master roadmap now
  require an activated Site Sourcery account before quote acceptance or
  payment, while preserving an anonymous no-diagnosis inquiry.
- Paid outside-site onboarding is staged: the first `$200` buys the written
  supportability/takeover result; only accepted sites can owe the remaining
  onboarding balance or begin monthly management.
- The Build inventory and Polish audit are complete. Both identify the same P0
  split-brain: the public catalog charges `$200` for assessment but can grant a
  `$350` credit, while the old pricing checker demands a `$350` assessment.
- The direct public assessment Payment Link remains a REMOVE/HOLD until the
  account-bound assessment, quote, invoice, payment, report, and credit journey
  exists. No new service copy or payment was published.
- Proposed five-business-day assessment delivery and two-business-day outside
  management acknowledgement promises are explicitly held for owner approval;
  they are not silently frozen into customer or legal truth.

## H1 assessment catalog authority checkpoint

- The candidate catalog now binds the standard assessment to the exact reviewed
  Custom-services contract digest and records one website, five representative
  public pages/page types, desktop plus phone, at most ten findings, and a
  separately quoted expanded-assessment boundary.
- Assessment money is now one exact relationship: `$200` charged and no more
  than one `$200` noncash Custom base-build credit for the same organization and
  project, accepted within 90 days, Card through Scale only. The obsolete
  `$350` credit and `$350` checker expectation are gone.
- The catalog projection digest was independently recomputed. A maintained
  focused test recomputes the reviewed contract-file digest and fails on price,
  scope, eligibility, window, or maximum-credit drift.
- The stale pricing checker now validates every displayed dollar amount against
  the catalog instead of demanding that the whole new site show only `$5`.
  Catalog, HTML, route, hosted-artifact, and 460/460 core Node checks pass.
- The unbounded Custom assessment Payment Link and the maker's legacy direct
  `$5`/`$25` Payment Links were removed from candidate source. The maker now
  enters the existing account-bound save/quote journey; assessment remains an
  inquiry until H1 invoice/payment authority is implemented. Obsolete exact
  Care prices were also removed from the print candidate.
- No payment provider, public deployment, push, DNS, or production state was
  changed.

## H1 pre-commerce foundation sealed checkpoint evidence

- Migration 34 adds one additive custom-services namespace over the canonical
  organization, project, account, catalog, and legal authority. It creates ten
  retained tables for held catalog policy, scope coverage, customer-owned site
  profiles, held operator authority, customer cases, requested offerings,
  typed intake snapshots, held documents, and held delegated-access requests.
- The first policy is exactly `$200 USD` one time, one website, up to five
  representative public pages or page types, desktop and phone, up to ten
  findings, with larger assessments separately quoted. It is bound to one
  exact immutable Custom-services legal document and remains `held`.
- Migration 34 is intentionally pre-commerce. Customer cases can only be
  `draft`, `submitted`, or `withdrawn`; requested offerings can only be
  `requested` or `removed`; access authority can only be schema-held as
  `drafted`. No quoted, payable, paid, active-job, completed, customer-confirmed,
  or operator-verified state exists in this slice.
- Every customer insert or update is tied to transaction-local customer,
  organization, active account, active membership, active organization, and
  active project truth. The canonical PostgreSQL repository now sets that
  exact actor context and rejects partial customer/operator contexts before a
  database connection is opened.
- Customer intake is bounded typed data rather than open JSON. PostgreSQL owns
  revision, submission timestamps, and the generated SHA-256 facts digest.
  Credential-shaped prose and credentialed URLs are rejected; the browser
  cannot claim its own digest or submit an arbitrary diagnosis object.
- `service_role` receives only SELECT on all ten tables, INSERT/UPDATE on the
  three mutable customer request tables, and INSERT on immutable intake
  snapshots. It receives no DELETE or TRUNCATE anywhere and no mutation right
  on operators, documents, access requests, or held catalog authority. No new
  service foreign key cascades deletion.
- Repository readiness now verifies all ten objects, the exact marker, exact
  held `$200` policy/legal/scope relationship, forced RLS, browser-role denial,
  and the minimal service-role privilege matrix instead of accepting table
  names alone.
- The H1 Polish lane is frozen in
  `SITESOURCERY-H1-ASSESSMENT-POLISH-MATRIX-2026-08-05.md`: six customer steps,
  exact no-free-diagnosis and actual-delivery-date copy, customer-safe
  projection, Mac/Pixel owner states, accessibility, retries, replay, and no
  invented refund benefit.
- Fresh disposable database `ss_h1_foundation_20260805_codex1` replayed all 34
  migrations and passed the hardened platform verifier. The real adversarial
  PostgreSQL journey passes 1/1, including missing/mismatched actor, suspended
  account, direct state-jump, caller digest, credential text, self-appointed
  operator, destructive privilege, browser-role read, and retention checks.
- Authoritative Node 24 regressions pass: core 486/486; hosted service 159 pass
  with 2 intentional environment skips; self-host 19/19; operations 52/52;
  current site 18 live pages and 20 redirects with 27 catalog prices and five
  sellable rails. Migration structure passes 26/26 and repository-focused
  proof passes 7/7.
- The disposable database had zero active sessions, was dropped by exact name,
  and is verified absent. `git diff --check` is clean. No customer or
  production data was touched.
- No push, deployment, DNS change, provider effect, credential, or release
  mutation occurred. The July 22 production fallback remains untouched.

## H1 quote and acceptance sealed checkpoint evidence

- Migration 35 adds eight retained `service_*` tables for deployment-controlled
  operator authority, one quote envelope, immutable quote revisions, exact
  materialized lines and scope coverage, one-to-five named review targets, one
  full-before-work installment, and exact customer acceptance. It does not add
  an invoice, payment, Stripe Session, provider event, receipt, job, report, or
  credit.
- The standard assessment revision is database-owned `$200.00 USD`, one site,
  up to five canonical public pages/page types, desktop and phone, up to ten
  findings, expanded scope separately quoted, an operator-selected actual
  delivery date, and `tax_state=calculation_required`. Caller-supplied money,
  tax, credit, contract, scope limit, digest, timestamps, and author fields are
  overwritten by canonical authority.
- Quote and disclosure digests bind organization, project, customer, case,
  offering, policy/scope, current site-profile revision, latest intake revision
  and facts digest, named review targets, exact money/tax/schedule, actual
  delivery date, expiry, and the reviewed legal contract. Material changes
  require a new immutable revision.
- A first-party account cannot appoint an operator. The append-only grant/revoke
  chain is deployment-controlled, generated-digest-backed, expiry-bounded, and
  not insertable by `service_role`. Quote work requires a current
  `service_quote_author` grant. The quote remains organization-owned so a
  revoked operator cannot strand it; each revision records its actual current
  authorized author.
- Acceptance is allowed only for the exact current, unexpired revision and
  exact quote/disclosure digests by the transaction-local customer and
  organization with current account, membership, site-profile, and latest
  intake truth. It is unique and immutable. The adversarial journey caught a
  real row-lock privilege defect; the guarded acceptance trigger now takes the
  lock under database-owned authority without granting runtime UPDATE rights.
- `service_role` can SELECT all eight tables and INSERT only quote envelopes,
  revisions, and acceptances. It cannot directly insert operator events or
  materialized line/scope/installment rows and has no UPDATE, DELETE, or
  TRUNCATE privilege. Browser roles cannot read or write the tables, forced RLS
  is active, and no new foreign key cascades deletion.
- A strict customer-safe migration-34 account projection covers empty, draft,
  submitted, withdrawn, stale, cross-tenant, malformed, credential-shaped, and
  forbidden-authority states. All customer writes remain explicitly held; the
  projection is not yet a route or public promise.
- Fresh disposable database `ss_h1_quotes_20260805_codex2` replayed all 35
  migrations with the complete production-readiness contract. The maintained
  foundation and quote adversarial PostgreSQL journeys pass 2/2, including
  forged money, invalid/six-target scope, stale profile/intake, cross-customer
  acceptance, operator revoke/handoff, immutable derived rows, and destructive
  privilege checks.
- Authoritative Node 24 proof passes: core 418/418; hosted service 168 pass with
  2 intentional environment skips; self-host 19/19; operations 52/52;
  migration structure 27/27; customer projection 9/9; repository/readiness
  7/7. `git diff --check` and changed-file syntax checks pass.
- The authoritative and interrupted-worker disposable databases each had zero
  active sessions, were dropped by exact name, and all three tracked H1 test
  database names are verified absent. No customer or production data was
  touched.
- No push, deployment, DNS change, provider effect, credential, public copy,
  or release mutation occurred. The July 22 production fallback remains
  untouched.

## H1 customer account read sealed checkpoint evidence

- The production hosted service now composes one canonical PostgreSQL
  custom-services account repository and one authenticated account boundary.
  `GET /api/v1/projects/{projectId}/custom-services` resolves the signed-in
  actor and selected project through the existing session authority; the
  default boundary remains explicitly held with no latent database read.
- The repository uses one exact customer-bound read-only transaction and reads
  only the canonical active account, organization, membership, project, exact
  held assessment policy, customer-owned website profile, current service case,
  requested offering, and latest intake. Every profile, case, offering, and
  intake query repeats the exact customer identity instead of relying only on
  organization or project binding.
- The customer projector remains the sole schema, chronology, safe-text, and
  cross-binding validator. Its response contains no internal IDs, policy or
  legal digests, operator/provider authority, money, invoice, payment, job,
  report, credit, or credential-shaped text. Customer writes, quote display,
  and quote acceptance remain held by this read-only slice.
- Real PostgreSQL proof caught and repaired a false chronology assumption:
  a website observation may legitimately predate the database row created when
  the customer later saves it, but it still cannot postdate the row's latest
  update. Maintained tests cover both the accepted and rejected chronology.
- Focused account, repository, boundary, and HTTP proof passes 45/45. The
  migration-34 foundation journey and migration-35 quote journey each pass
  against the same clean 35-migration PostgreSQL database; the quote journey
  now also exercises the real account repository over the seeded customer
  request.
- Authoritative Node 24 regressions pass: core 487/487; hosted service 204 pass
  with 2 intentional environment skips; runtime and changed hosted-source
  syntax pass; `git diff --check` is clean.
- Disposable database `ss_h1_account_20260805_codex1` had zero active sessions,
  was dropped by exact name, and is verified absent. No customer or production
  data was touched.
- No worker remains open. No push, deployment, DNS change, provider effect,
  credential, public copy, or release mutation occurred. The July 22 production
  fallback remains untouched.

## H1 customer request and quote surface checkpoint evidence

- Migration 36 adds one retained typed intake draft, one-current-request
  uniqueness, database-managed draft revision/digest authority, and deferred
  terminal-state fences. A withdrawn request cannot retain an open offering;
  an accepted quote cannot be withdrawn or detached from its submitted
  request. No migration 37 was added.
- Authenticated project routes now support reading and saving a bounded
  assessment draft, exact-revision submission, withdrawal, current quote read,
  and exact-digest quote acceptance. Every write reuses the existing CSRF and
  idempotency boundary, resolves customer/project scope from the signed-in
  session, and rejects browser money or provider authority.
- The PostgreSQL request repository proves create, safe command replay,
  stale-edit rejection, revision, submit, safe submit replay, withdrawal, safe
  withdrawal replay, and a new post-withdrawal request. The quote repository
  proves the current `$200` projection, exact acceptance, safe replay, and the
  accepted customer state.
- The hosted customer dashboard now renders the external-site form, ownership
  affirmation, bounded `$200` scope, submit/withdraw status, separate-invoice
  and full-before-work disclosure, quote expiry/delivery date, and exact
  acceptance control. The browser sends no price, tax result, invoice total,
  provider ID, or payment claim.
- Production composition wires the canonical account, request, and quote
  repositories into the same authenticated custom-services boundary. The
  held/default runtime remains effect-free.
- Focused HTTP, hosted-boundary, quote-projector, browser API, and artifact
  tests pass. The maintained real PostgreSQL foundation/request journey passes
  2/2 and the real quote read/acceptance journey passes 1/1 against a clean
  replay of all 36 migrations.
- Post-integration Node 24 proof passes: core 489/489; the complete hosted
  service suite passes; the hosted artifact builds and verifies; relevant
  browser/control suites and `git diff --check` pass.
- Disposable database `ss_h1_commands_20260805_codex1` had zero active
  sessions, was dropped by exact name, and is verified absent. No customer or
  production data was touched.
- The owner quote-authoring gap recorded by this checkpoint is closed by the
  immediately following owner-operation checkpoint. No second quote system or
  migration 37 was introduced.
- No push, deployment, DNS change, provider effect, credential, public-copy
  release, or production mutation occurred. The July 22 fallback remains
  untouched.

## H1 held assessment-invoice checkpoint evidence

- Migration 37 adds only three retained `service_*` tables: one immutable
  account-bound invoice, its exact assessment line, and one non-dispatchable
  payment reservation. It introduces no general billing framework, Checkout
  Session, provider URL, tax claim, receipt, job, report, or credit.
- Exact customer quote acceptance automatically materializes one invoice from
  the accepted quote revision and its sole full-before-work installment. The
  database fixes subtotal at `$200.00 USD`, keeps tax and total null with
  `tax_state=calculation_required`, fixes `payable=false` and
  `charge_occurred=false`, and holds provider certainty at `not_submitted`.
- Acceptance replay returns the existing accepted result and leaves exactly
  one invoice, one line, and one reservation. Existing accepted rows are
  idempotently backfilled when migration 37 is applied.
- The authenticated project route
  `GET /api/v1/projects/{projectId}/custom-services/assessment-invoice` reads
  only the exact active customer/account/organization/project binding. The
  browser verifies the bounded projection and plainly renders tax pending,
  payment not open, and no charge occurred; it exposes no checkout control.
- Production readiness now requires migration 37, all three forced-RLS tables,
  read-only service-role access, no direct materialization privilege, retained
  foreign keys, and the exact v37 marker.
- Focused migration, browser/API, hosted-boundary, and readiness proof passes
  79/79. The maintained real PostgreSQL quote-to-invoice journey passes 1/1.
  Post-integration Node 24 proof passes: core 495/495; hosted service 233 pass
  with 2 intentional environment skips; the hosted artifact builds and
  verifies; syntax and `git diff --check` pass.
- Disposable database `ss_h1_invoice_20260805_codex1` replayed all 37
  migrations from zero, proved the exact quote-to-invoice journey, had zero
  active sessions, was dropped by exact name, and is verified absent. It held
  no customer or production data and is not recoverable because it was a
  disposable test database.
- No Stripe/provider call, push, deployment, DNS change, credential handling,
  or production mutation occurred. Public production remains the July 22
  predecessor.

## H1 owner assessment quote operation sealed checkpoint evidence

- The production hosted runtime now composes one PostgreSQL owner boundary over
  the existing migration-35 quote tables and operator grant chain. It adds no
  migration 37, alternate quote store, general administration framework, or
  browser price authority.
- `GET /api/v1/operator/custom-services/assessment-requests` lists at most 100
  submitted, unaccepted assessment requests only after the signed-in account
  has a current database-controlled `service_quote_author` grant. The private
  projection includes the customer, organization, site, intake facts, and any
  current quote needed for owner review.
- `POST /api/v1/operator/custom-services/assessment-requests/{caseId}/quote`
  accepts only organization scope, an actual delivery date, one-to-five safe
  page/page-type targets, CSRF proof, and an idempotency key. PostgreSQL fixes
  the price at `$200`, USD, later tax calculation, full payment before work,
  one website, at most five targets, at most ten findings, desktop and phone
  review, the exact legal contract, and a 14-day quote expiry.
- Exact command replay returns one stored receipt. A second command with the
  same current intake, profile, date, and targets reuses the same revision;
  changed current intake/profile truth or changed owner scope requires a new
  immutable revision. An accepted quote cannot be revised.
- The hosted account interface now contains a compact responsive owner quote
  desk. It stays hidden for ordinary customers and held runtimes; an authorized
  owner can review the request and issue or update the quote from Mac or Pixel
  by choosing only delivery date and review targets. The browser sends no
  amount, currency, tax result, invoice total, payment claim, or provider ID.
- Focused browser/API/owner-boundary proof passes 30/30. The maintained real
  PostgreSQL quote journey passes 1/1 with queue read, exact issue, exact replay,
  fresh-command duplicate suppression, customer projection compatibility, and
  the existing adversarial quote/acceptance checks.
- Post-integration Node 24 proof passes: core 493/493; hosted service 231 pass
  with 2 intentional environment skips; the hosted artifact builds and
  verifies; changed-source syntax and `git diff --check` pass.
- Disposable database `ss_h1_owner_20260805_codex1` replayed all 36 migrations,
  had zero active sessions, was dropped by exact name, and is verified absent.
  It contained no customer or production data and is not recoverable because it
  was a disposable test database.
- Production activation still requires one deliberate deployment-control grant
  for the owner's existing Site Sourcery account. No customer account can grant
  itself owner tools, and this launch configuration must be proven before
  deployment rather than weakened in application code.
- No push, deployment, DNS change, provider effect, credential, public-copy
  release, or production mutation occurred. The July 22 fallback remains
  untouched.

## H1 assessment Checkout dispatch checkpoint evidence

- Migration 38 adds one retained
  `ss.service_assessment_checkout_attempts` table. An exact invoice-bound
  attempt is durably reserved before Stripe is contacted, only one active
  attempt can exist per invoice, and one Stripe Checkout Session identity can
  belong to only one retained attempt. The guarded state machine distinguishes
  definitely unsubmitted failure from provider/persistence uncertainty. Both
  browser roles have no table privilege; the service role has no DELETE or
  TRUNCATE authority; both required triggers, forced RLS, the active-attempt
  index, and the unique Session constraint are startup-readiness requirements.
  All retained invoice relationships remain intact.
- The authenticated command
  `POST /api/v1/projects/{projectId}/custom-services/assessment-invoices/{invoiceId}/checkout-command`
  accepts only the immutable invoice digest plus the existing CSRF and stable
  idempotency identity. Customer, organization, project, invoice, quote,
  disclosure, currency, and `$200.00` subtotal authority are reconstructed
  from PostgreSQL; the browser cannot submit tax, total, address, money,
  provider, or payment state.
- Stripe Checkout collects the billing address and calculates jurisdictional
  tax. The one-time line remains exactly `$200.00 USD` with automatic tax;
  customer copy says tax and the final total are shown before payment and does
  not claim a charge before verified settlement. An existing bound Stripe
  Customer is reused; otherwise Stripe creates one through the narrow provider
  adapter. Provider output is accepted only when the returned Session preserves
  the exact invoice identity, purpose metadata, payment mode, USD subtotal,
  automatic-tax setting, open state, and unpaid state.
- Assessment payment has a separate exact release configuration that defaults
  held. The production invoice projection and payment command consume that same
  release object; after ordinary account/project authentication, held mode
  stops before the payment claim or Stripe and exposes no pay button. The
  customer-safe response contains only the retained invoice, verified HTTPS
  Stripe destination, expiry, and pre-payment money states. It never exposes
  the Checkout Session ID or another raw provider identifier. Production
  `approved` mode remains startup-impossible until the next slice composes an
  exact assessment webhook, Stripe readback, and atomic-settlement readiness
  boundary.
- Safe command replay returns the same verified HTTPS Stripe destination
  without another provider call. Ambiguous transport or post-provider
  persistence outcomes enter a no-automatic-retry state. A stale or expired
  Checkout is rejected by the browser and remains held for the next readback/
  reconciliation slice rather than opening a duplicate payment page.
- Focused adapter, migration, repository, hosted-boundary, HTTP, browser, and
  readiness proof passes 148/148. Fresh database
  `ss_h1_assessment_checkout_20260805_codex4` replayed all 38 migrations,
  reported canonical runtime readiness, and passed the real PostgreSQL
  accepted-quote-to-invoice-to-Checkout journey 1/1. That journey proves exact
  replay, foreign-scope denial before provider work, one-active-command
  concurrency, stored-response tamper rejection, transport and post-provider
  persistence ambiguity without a second provider call, stale-ready Checkout
  hold behavior, and two-connection command-before-attempt lock order while
  provider completion races a replay lock. Returned-Session nondefault ports
  are rejected, pre-Stripe preparation failures are explicitly not submitted,
  and runtime readiness verifies exact trigger functions and active-index
  structure rather than names alone.
- Authoritative Node 24 regressions pass: core 502/502; hosted service 238 pass
  with 2 intentional environment skips; self-host 19/19; operations 52/52;
  current site 18 live pages and 20 redirects with 27 catalog prices and five
  sellable rails. The hosted artifact builds and validates; the public artifact
  verifies all 78 allowlisted files with exact source bytes.
- The stale `codex2`, interim `codex3`, and final `codex4` databases each had
  zero active sessions before exact-name removal and are verified absent. No
  real Stripe call, customer/production-data write, push, deployment, DNS
  change, credential handling, or release mutation occurred. Public production
  remains the July 22 predecessor.

## H1 assessment settlement and job-open checkpoint evidence

- Migration 39 adds three narrow retained authorities:
  `ss.service_assessment_stripe_events`,
  `ss.service_assessment_payment_receipts`, and
  `ss.service_assessment_jobs`. A signed webhook is only a durable wake-up;
  receipt and job authority require exact provider readback. Receipts and jobs
  are immutable, forced-RLS, service-role-only, non-deletable records. The
  event transition distinguishes pending, processed, and permanent
  reconciliation-required evidence, and runtime readiness verifies all three
  tables, exact privileges, guards, retention, and the v39 marker.
- The Stripe adapter now performs read-only assessment Session lifecycle and
  paid-payment reads. Settlement accepts only the exact retained purpose,
  metadata, test/live mode, `$200.00` subtotal, automatic tax, USD final total,
  paid PaymentIntent, fully captured and unrefunded Charge, bound Customer, and
  provider payment time. Returned facts are digest-bound and contain no secret
  or customer-facing provider authority.
- The shared Stripe webhook verifies raw bytes once and routes only the exact
  assessment metadata schema to the assessment settlement service. Permanent
  paid-evidence drift creates one manual-review state; transient provider-read
  failure leaves the event safely retryable. Same-event replay and a second
  event ID for the same Session return the original receipt/job without a
  second local or provider effect.
- One atomic settlement binds or verifies the organization's Stripe Customer,
  writes the final subtotal/tax/total receipt, opens exactly one job frozen to
  the accepted one-site, five-target, desktop/phone, ten-finding scope and
  delivery date, and marks the event processed. The original Checkout attempt
  remains retained dispatch evidence. A paid invoice now blocks both a new
  Checkout command and replay of an old Checkout destination.
- A locally expired ready Checkout is not replaced from the browser clock
  alone. Exact read-only Stripe lifecycle proof must show `expired`; `open`,
  `paid`, transport uncertainty, or changed purpose keeps replacement held.
  Once exact expiry is recorded, the caller must use one fresh command for the
  single replacement.
- The customer invoice projection is now v2. It exposes exact safe
  `checkout_available`, `payment_verifying`, `payment_attention`, and
  `paid_job_open` states, final tax/total, local receipt, and bounded job dates,
  while rejecting extra/provider-shaped fields. The Stripe return parser binds
  the exact project and invoice, removes payment query fields, polls only the
  same-origin account projection, announces paid/review/pending truth, and
  never starts another payment.
- Fresh database `ss_h1_assessment_settlement_20260805_codex1` replayed all 39
  migrations from empty state. The maintained foundation journey passes 2/2
  and the accepted-quote through Checkout, expiry reconciliation, mismatch,
  transient retry, tax-positive settlement, replay/alias, paid projection,
  duplicate-payment denial, job, and cross-tenant journey passes 1/1. It had
  zero active sessions, was dropped by exact name, and is verified absent.
- Authoritative Node 24 proof passes: core 510/510; hosted service 239 pass
  with 2 intentional environment skips and 0 failures; self-host 19/19;
  operations 52/52; current site checks for 18 live pages, 20 redirects, 27
  catalog prices, and five sellable rails; exact 78-file public artifact;
  hosted build and HTML validation; and the current browser audit across 15
  hosted routes at 320px, 390px, and 1440px. The reviewed customer-control
  source digest is
  `e68d70303100744a2729e86251d099cede900024d89908e00087843eedefde16`.
- Provider and architecture sidecars completed their bounded reviews and are
  closed. No real Stripe call, customer/production-data write, push,
  deployment, DNS change, credential handling, or release mutation occurred.
  At the H1G boundary, findings, report delivery, credit, and the production
  grant remained held; H1H below completes the first three locally.

## H1 paid assessment work, delivery, and credit checkpoint evidence

- Migration 40 adds forced-RLS, service-role-only private document payloads,
  immutable screenshot evidence, revision-fenced finding drafts, immutable
  delivered reports and finding snapshots, and one database-materialized
  `$200` same-project Custom base-build credit. Delivery and credit are one
  transaction; the grant is non-cash, one-use, and expires at the exact
  PostgreSQL `delivered_at + interval '90 days'` boundary.
- The private owner workbench works from Mac or Pixel. It lists paid jobs,
  transcodes every JPEG/PNG/WebP upload through canvas to strip metadata,
  bounds decoded dimensions and bytes, persists uncertain-upload command
  identity for the browser session, binds finding evidence to the selected
  target and every affected viewport, and lazily opens one job rather than
  eagerly constructing up to one thousand finding forms.
- Final delivery carries the digest of the exact evidence/finding work the
  operator reviewed. The repository serializes all job mutations, recomputes
  that digest after locking, rejects stale concurrent work, and permits a
  truthful replay only when the immutable work and summary match. A second
  summary cannot receive the first operator's success receipt.
- The customer account read is fenced by both authenticated account and
  project. Draft findings remain private; after delivery the customer can
  refresh an already-open page, read the immutable report, load only its
  integrity-checked evidence, and see exact available/expired credit truth.
- Fresh database `ss_h1h_delivery_20260805_codex5` replayed all 40 migrations
  from empty state and passed the complete real PostgreSQL journey 1/1:
  request, quote, acceptance, invoice, Checkout, settlement/job, desktop and
  phone evidence, finding revision/replay, stale-delivery rejection,
  immutable report, exactly one credit, customer report/evidence,
  cross-tenant and pre-delivery denial, and post-delivery immutability. The
  database had zero active sessions before exact-name deletion and is verified
  absent; the preceding disposable `codex4` database was likewise removed.
- Authoritative Node 24 proof passes: the focused UI/HTTP/migration set 97/97;
  hosted service 242 pass with 2 intentional environment skips and 0 failures;
  and the complete Node suite 517/517. The hosted staging manifest now binds
  API digest `ee85542e568cf3ffd8f500ebfc01d73ee53bb0987b60f2bf7d54c82e3234111f`
  and customer-control digest
  `024559504427f26f275116b51db7a912dba0047697af29155c8a942e0cd316ee`.
- The browser implementer and independent redline reviewer are closed. No real
  Stripe call, customer/production-data write, push, deployment, DNS change,
  credential handling, or release mutation occurred. Credit issuance is now
  complete; credit reservation/redemption and the Custom build commercial
  lifecycle remain held.

## H1I Custom build quote and credit-reservation checkpoint evidence

- Migration 41 adds one assessment-backed Card-through-Scale base-build quote
  ledger. PostgreSQL derives every fixed price and Scale capacity price,
  materializes the immutable base line and exact full-before-work or 50/50
  installments, binds the delivered report/customer/organization/project, and
  exposes no browser authority over money, credit, tax, or payment state.
- Customer acceptance atomically reserves the same report's available `$200`
  grant once and only for the Custom base build. Repeated or simultaneous
  commands cannot double-use it. An owner void can release only an unsettled
  reservation; settled or reconciliation-required credit can never become
  reusable, transferable, cash, or a refund offer.
- The private owner desk lists delivered assessment opportunities and can
  issue or safely void one exact quote from Mac or Pixel. The customer account
  reads and accepts that same immutable quote, shows gross value, credit,
  remaining start/final amounts, reviewable contract terms, tax-pending truth,
  and a retained acceptance receipt. Assessment-report and quote panels now
  agree on available/reserved/settled/reconciliation credit truth, and an
  acceptance replay after a later void returns the fresh void/release state.
  Production keeps the entire Custom build boundary explicitly held until its
  invoice/payment deadline exists; canonical PostgreSQL startup readiness
  still proves the v41 storage boundary.
- Fresh database `ss_h1i_custom_build_20260805_codex8` replayed all 41
  migrations from empty state, reported canonical runtime readiness, and
  passed the complete real PostgreSQL assessment-through-report-through-Custom
  quote journey 1/1. The journey proves exact Site pricing and installments,
  replay and conflicting-command rejection, stale-revision rejection,
  customer acceptance/receipt, account-wide reserved-credit consistency, one
  credit reservation, safe void/release, fresh replay after void, and a
  replacement quote reusing only the released grant.
- Focused browser/API/HTTP/readiness/migration proof passes 109/109.
  Authoritative Node 24 proof passes: core 526/526; hosted service 245 pass
  with 2 intentional environment skips and 0 failures. The hosted artifact
  builds and validates.
  Canonical runtime readiness passes against the fresh v41 database. The
  hosted staging manifest binds API digest
  `a2fa0c48594bb85c6e774dfae97ed12c7da2f9a3cd04841ed6540540f1c26943`
  and customer-control digest
  `456a43db95efb63a9435f57c1de1d87fa2c673690f839847aee5261d35fcb872`.
- Independent redline review found and rechecked five integration risks:
  account-wide credit-state consistency, inspectable terms/receipt, fresh
  replay after void, the production hold, and indefinite pre-payment
  reservation. The first four are repaired; the fifth is safely impossible in
  production under the explicit hold and moves with the payment deadline into
  the next invoice/Checkout slice. The final recheck reports no local H1I seal
  blocker.
- Disposable databases `ss_h1i_custom_build_20260805_codex1` through `codex8`
  each had zero active sessions before exact-name deletion and are verified
  absent. No real Stripe call, customer/production-data write, push,
  deployment, DNS change, credential handling, or release mutation occurred.
  The Custom invoice, payment settlement, build job/handoff, provider release,
  and public release remain held.

## H1J Custom build first-payment and job-open checkpoint evidence

- Migration 42 materializes exactly one invoice from an accepted migration-41
  quote. Its two immutable lines are the quoted gross first installment and
  the negative `$200` assessment credit; subtotal, seven-day deadline, quote /
  disclosure digests, and final handoff amount remain server authority.
- Checkout is reserved before any provider effect, permits one active Session,
  uses variable server-owned subtotal with Stripe automatic tax, safely replays
  one retained destination, and never retries ambiguous provider or persistence
  outcomes automatically. The browser submits only the invoice digest through
  the authenticated project route and sees no raw provider identity.
- A signed webhook is only a wake-up. Settlement reads back the exact Stripe
  Session, PaymentIntent, captured/unrefunded Charge, Customer, subtotal, tax,
  total, metadata, and purpose. One transaction writes the receipt, settles the
  reserved credit, marks the Checkout paid, and opens one build job carrying
  the exact accepted scope and final handoff amount. Replay cannot open another
  charge, credit application, receipt, or job.
- Production now composes the PostgreSQL quote/payment boundaries and shared
  webhook router behind `SITESOURCERY_CUSTOM_BUILD_PAYMENT_MODE`, which defaults
  to `held`. Approved startup requires exact Stripe, quote-storage, settlement,
  credit, and job readiness; it does not authorize push, deploy, DNS, or provider
  credentials by itself.
- Customer controls cover not available, checkout available, retained Checkout,
  held, expired, reconciliation, and paid/job-open truth. Independent redline
  review found one reload blocker: accepted-quote verification still required a
  reserved credit after the backend had moved it to reconciliation or settled.
  The validator and focused regressions now accept only the three valid accepted
  states (`reserved`, `reconciliation_required`, `settled`); recheck reports no
  remaining blocker.
- Fresh empty database `ss_h1j_migrations_20260805_codex8` replayed all 42
  migrations and reported the canonical platform schema. Fresh cloned database
  `ss_h1j_payment_20260805_codex7` passed the full assessment-through-report,
  replacement Custom quote, `$450` first-payment invoice, Checkout, verified
  settlement, settled credit, one open job, replay, and post-payment void-denial
  journey 1/1.
- Authoritative Node 24 proof passes: core 536/536; hosted service 250 pass with
  2 intentional environment skips and 0 failures; focused responsive customer /
  owner controls 20/20; operations 52/52; current site 18 live pages and 20
  redirects; exact hosted build and HTML validation; all 42 migrations from
  empty; and the real PostgreSQL journey 1/1. The hosted staging manifest binds
  API digest `6f6be27acd421a1520cff801fd26135e9cfbc5b44a9b6f9e9f3c480f1ed32eaf`
  and customer-control digest
  `912f9c6406045ca734791d544bca556c151d11d8cf3ce1c7ad716cc9d5ce8ece`.
- No real Stripe call, customer/production-data write, push, deployment, DNS
  change, credential handling, or release mutation occurred. Owner build-work,
  final handoff invoice/payment, delivery, provider release, and public release
  remain held.

## H1K paid Custom-build visibility checkpoint evidence

- The accepted paid migration-42 job now has one exact customer-safe
  projection and one separate private owner projection. Both bind the retained
  quote revision, acceptance, invoice, payment receipt, scope digest, tier,
  footprint, first-payment values, `$200` settled credit, currency, target
  date, and final handoff amount before exposing the job. Provider identifiers,
  internal payment evidence, and customer-side mutation authority remain
  absent.
- `GET /api/v1/operator/custom-services/custom-build-jobs` is read-only,
  requires an authenticated operator with `service_job_manage`, and runs
  through the canonical transaction-local PostgreSQL authority. Results are
  ordered by target date, opened time, and job ID; each response exposes at
  most 100 jobs and an exact opaque seek cursor only when another page exists.
  The held runtime authenticates first and remains unavailable without touching
  PostgreSQL.
- The customer account shows the paid build, exact scope and footprint, target
  completion date, opened time, and pre-tax first-payment truth without an
  internal job ID. The private Mac/Pixel panel adds customer/project identity,
  the first-payment subtotal, final-handoff balance, and job ID. It stays hidden
  until verified owner data arrives, keeps previously verified jobs visible
  during an invalid refresh, focuses the live error status, and makes every
  page reachable without unbounded eager rendering.
- A real headless Chrome audit passes the authenticated customer and owner
  journeys at `390x844` and `1440x1000`, including 44-pixel controls and
  summaries, exact-width layout, no customer job-ID leakage, no browser errors,
  and retained verified data after a malformed refresh. The complete audit
  also passes 15 hosted routes at 320, 390, and 1440 pixels plus the maker
  journey.
- Focused work-repository proof passes 19/19; the combined owner HTTP/UI set
  passes 23/23; customer paid-projection/control proof passes 11/11; and hosted
  composition/control proof passes 29/29. Authoritative Node 24.18.0 proof
  passes the complete core suite, 276 hosted tests with two intentional
  environment skips, operations 52/52, current site checks for 18 live pages,
  20 redirects, 27 catalog prices, and five sellable rails, plus the exact
  hosted build and HTML validation.
- Fresh database `ss_h1k_cursor_20260806_codex4` replayed all 42 migrations
  from empty state and passed the complete real PostgreSQL assessment-through-
  paid-Custom-job journey 1/1 after the stable cursor SQL was finalized. It had
  zero active sessions before exact-name deletion and is verified absent.
  The hosted staging manifest binds API digest
  `5ea0eed3ee53a3a4a5aa1adc8f2fd56a3a4f11ead830e60fcecaca79de50b0a4`
  and customer-control digest
  `d9b3627d23733a68070abaed35b38693ea0550ce7a914b94e51fe746dcd7111b`.
- Independent backend and Polish rechecks both report `BLOCKER: NO`: the
  authorization, exact linkage, customer privacy, stable cursor, retained
  refresh state, responsive controls, and authenticated browser evidence all
  match the H1K boundary. Both reviewers are closed.
- No real Stripe call, customer/production-data write, push, deployment, DNS
  change, credential handling, or release mutation occurred. Build-progress
  writes, access/dependency/evidence state, change orders, the final handoff
  invoice/payment, delivery, provider release, and public release remain held.

## H1L bounded Custom-build progress and customer-request checkpoint evidence

- Migration 43 adds append-only, service-role-only paid-job progress with three
  calm stages (`Preparing`, `Building`, and `Checking the work`), four fixed
  milestones, monotonic revisions, and no percentage or invented completion
  claim. It permits exactly one active bounded request per paid job:
  customer content, customer decision, delegated access, or an outside
  dependency.
- Customer responses are revision-fenced and credential-safe. A response can
  say provided or cannot provide, but never proves that delegated access
  works. Only the owner can separately resolve or withdraw the request after
  review. Delegated access reuses the existing 30-day-limited access-request
  authority and stores only provider/account/role labels, never a password,
  token, API key, or verification code.
- Customer and owner PostgreSQL services, hosted composition, readiness, and
  exact same-origin routes are complete. The customer sees only the selected
  project's safe status and response control. The private owner workbench can
  post one revision-fenced progress update, open one bounded request, and
  resolve or withdraw it; no browser field carries money, billing, payment,
  provider-effect, or mark-complete authority.
- The hosted account UI validates exact response schemas before rendering,
  keeps stale and cross-project responses out, uses stable command identities,
  and remains usable at Pixel and Mac sizes. The maintained Chrome 149 audit
  passes the customer and owner progress views at `390x844` and `1440x1000`,
  including all four milestones, the action-needed request, 44-pixel controls,
  exact-width layout, no customer job/request ID leakage, no credential-entry
  fields, and no browser errors. Its complete 15-route, three-viewport and
  maker journey also passes.
- Fresh database `ss_h1l_progress_20260806_codex1` replayed all 43 migrations
  and passed the full real PostgreSQL assessment-through-paid-Custom-job plus
  progress/request lifecycle 1/1. It proves progress replay/stale rejection,
  non-regression, one-active-request fencing, wrong-project denial, credential
  rejection, customer response/replay, owner resolution, exact delegated
  access, cannot-provide, and withdrawal without false verification. The test
  uses fixed fake provider IDs and therefore must run on a fresh database; an
  attempted repeat on populated fixture state was discarded, the database was
  recreated, and the authoritative fresh run passed. It had zero active
  sessions before exact-name deletion and is verified absent.
- Authoritative Node 24.18.0 proof passes: core 544/544; hosted service 286
  pass with 2 intentional environment skips and 0 failures; operations 52/52;
  self-host 19/19; current site 18 live pages and 20 redirects; exact hosted
  build and HTML validation; and the exact 78-file public artifact. The hosted
  staging manifest binds API digest
  `9adec54093ae53065d5e91cd7119bb1a914251068728e50ed71ba7a6a5948484`
  and customer-control digest
  `1339f1fd87d59260ba4d5a5386bd40a115828204392146520ff514604149f3f5`.
- No real Stripe or registrar call, customer/production-data write, push,
  deployment, DNS change, credential handling, or public release mutation
  occurred. Change orders, completion evidence, final handoff invoice/payment,
  delivery, provider release, and public release remain held.

## Domain provider-contingency sidecar checkpoint

- The provider-neutral domain core now accepts exactly two registrar slots.
  Side-effect-free availability/pricing preflight may use either healthy slot,
  but provider-specific contact preparation locks the quote cycle to one.
  Registration, renewal, DNS, and transfer mutations never jump providers;
  uncertainty remains held for readback against the attempted registrar.
- Successful domain/registrant readback creates a durable registrar-of-record
  pin. Existing-domain reads and mutations route only by that stable provider
  code; the pin preserves the historical registrar name even if its later
  display/legal name changes. A registrar change remains an explicit transfer.
- The core orchestrator persists provider route, contact binding, accepted
  quote, attempt state, operation ID, and safe pin evidence before each next
  transition. Compatibility composition keeps the present Spaceship adapter
  primary and an unavailable held secondary until a reviewed reseller-capable
  adapter exists.
- Focused deterministic proof passes 67/67 across the contingency boundary,
  integrated orchestration, legacy domain safety, and the Spaceship adapter.
  No live provider, network, DNS, payment, or credential effect occurred.
- The written commercial-consent request was sent to Spaceship support from
  Desiderata Labs on 2026-08-06. Hosted PostgreSQL composition, one real
  secondary adapter, provider-aware customer disclosure, pinned hosted DNS /
  renewal / transfer, and fresh-quote acceptance remain unfinished and must
  not be represented as automatic live fallback yet.

## H1M redline correction sealed locally

- Independent reviewer Averroes initially returned `BLOCKER: YES`. Every named
  code and proof defect is now corrected: hosted/browser exact schemas,
  current-progress/current-scope owner evidence selection, complete image
  decoding with real and adversarial fixtures, a real two-session completion
  race, and delegated-access finality denial. A fresh independent reviewer
  inspected the resulting code, test evidence, cleanup, manifest, production
  hold, and lane split and returned `BLOCKER: NO`.

- A change order can add work only. The owner selects 1-40 bounded work units;
  storage derives `$125` per unit and never accepts a browser-supplied price,
  discount, refund, assessment credit, negative amount, or rewrite of the
  originally accepted scope. Only one unresolved change order may exist per
  paid job.
- The owner must state the added scope, a same-or-later target date, and an
  expiration no more than 14 days away. The customer may accept or decline the
  exact digest. Acceptance makes payment required; it does not authorize the
  added work until later provider-confirmed settlement makes the order
  effective. No uncertain payment may be treated as effective.
- Completion requires the latest progress stage to be `checking`, all four
  milestones done, no active customer request, and no issued or accepted-but-
  unpaid change order. It binds 2-12 immutable customer-visible JPEG, PNG, or
  WebP records, including desktop and phone proof, to six explicit checks:
  scope, desktop, phone, links, contact actions, and accessibility basics.
- The immutable completion snapshot derives effective scope from the original
  scope plus later paid/effective changes. It can become
  `ready_for_final_payment` or `ready_for_delivery`; it is not itself payment,
  launch, delivery, job completion, or authority to start the 30-day
  workmanship clock.
- An independent redline found four launch blockers in the first checkpoint:
  progress or request writes could race completion, screenshot proof could be
  stale or unrelated to the latest verified scope, an elapsed issued change
  could strand the job, and production exposed H1M before final-payment H1N
  existed. All four are corrected at the storage and composition boundaries,
  not merely hidden in the browser.
- Change-order expiration is now an append-only, digest-bound owner command
  that uses the database clock and the same paid-job lock as issue, decision,
  evidence, and completion. An elapsed issued order becomes `expired`, replay
  is stable, and a different command or quote digest cannot inherit it.
- Every completion image stores validated width, height, media type, byte
  digest, latest progress revision, and current effective-scope digest.
  Desktop and phone dimensions are enforced separately; proof captured before
  the latest Checking revision, proof from another scope, and identical image
  bytes for both viewports cannot complete the job.
- JPEG, PNG, and WebP acceptance now includes a complete server-side pixel
  decode through pinned `sharp@0.35.3` with strict warning failure and bounded
  input pixels. The existing format/metadata scanner remains in front of that
  decoder. Adversarial tests prove that structurally plausible garbage JPEG
  and VP8 streams are rejected; a production-dependency audit reports zero
  known vulnerabilities.
- Completion and all later progress, work-request, and delegated-access writes
  share one transaction lock. Once the immutable completion package exists,
  those writes fail instead of racing or silently reopening the work. The
  customer can read only package-selected authenticated evidence.
- The responsive customer and owner controls now cover issue, accept, decline,
  void, expiration, evidence upload, completion proof, malformed refresh,
  held state, and exact `$125`-unit arithmetic. Browser input still cannot
  claim price, tax, credit, payment, provider, progress, scope, or completion
  state. Production deliberately composes the H1M boundary as held until H1N
  has provider-confirmed final settlement or exact zero-balance clearance.
- Disposable databases `ss_h1m_redline_final_20260806_codex11` and `codex12`
  each replayed all 44 migrations and reached the real queued race, but the
  observer transaction retained one PostgreSQL statistics snapshot and could
  not see the second waiter. Both runs left the correct product state — one
  immutable package and progress revision 3 — and both databases had zero
  sessions before exact-name deletion and are verified absent. The observer
  now calls `pg_stat_clear_snapshot()` before each `pg_stat_activity` read.
- Fresh database `ss_h1m_redline_final_20260806_codex13` replayed all 44
  migrations and passed the complete assessment-through-report, `$200` credit,
  paid Card Plus job, progress/request/access, `$125`-unit change lifecycle,
  stale-proof rejection, real desktop/phone evidence, actual queued completion
  versus progress race, package-bound customer evidence, and all
  post-completion progress/request/delegated-access denials 1/1. It had zero
  active sessions before exact-name deletion and is verified absent.
- Authoritative Node 24.18.0 proof passes: focused H1M set 146/146 and one
  uninterrupted `npm test` release run. That run passed runtime, source HTML,
  18 live pages and 20 redirects, core tests, self-host, hosted service,
  operations 52/52, exact 78-file artifact, hosted build and HTML, and Chrome
  149 across 15 routes at three widths. Its issued-change and
  ready-completion customer/owner journeys use real `390x844` and `1440x1000`
  image evidence, malformed-refresh retention, exact-width layout, and no
  browser failures.
- The hosted staging manifest binds API digest
  `23777c44f9d4a175269f49282489a7e0d655ad715acce42dc0fc646146e61b88`
  and customer-control digest
  `64d2e1227130503725a8356d72c3d6c01a7998358440156172b40cc9a7aec80e`.
  No real Stripe or registrar call, production/customer-data write, push,
  deployment, DNS change, credential handling, or release mutation occurred.

## H1N change-payment, final-payment, and handoff inventory

- Reuse the accepted quote/installments, payment receipt, immutable paid job,
  progress/request history, `service_documents`, digest-bound document
  payloads, advisory/idempotency fences, retained Checkout attempts, append-
  only Stripe events, and readback reconciliation patterns already present.
- H1N has two ordered financial purposes. First, every accepted change order
  deliberately left at `accepted_payment_required` by migration 44 needs an
  exact change-order invoice and lines, its own Checkout/Stripe purpose and
  append-only event ledger, provider-confirmed receipt, and an atomic
  transition to `effective`. Changed work cannot start before that transition.
- Only after every accepted change is effective may completion derive the
  exact final obligation, final invoice and lines, separate final Checkout /
  Stripe purpose and event ledger, provider-confirmed final receipt or
  explicit zero-balance clearance, immutable handoff receipt, customer and
  owner projections, and a database-derived 30-day workmanship start/end
  clock.
- Final state must remain derived from append-only records because the paid job
  itself is immutable. Handoff must also close later progress/request writes.
  The current document guard must be narrowed to permit matching paid-job
  evidence now and matching handoff documents only in the later handoff slice.
- Safe sequence is accepted-change invoice, verified change settlement,
  effective change, completion snapshot, exact final obligation, verified
  final payment or zero-balance clearance, immutable handoff, then
  customer/owner projections. The workmanship clock starts from evidenced
  final handoff, not merely from an owner progress update or an unverified
  launch claim.
- `npm test` does not currently create a fresh PostgreSQL database or run the
  migration/custom-services integration journeys. Before Core Launch can be
  100%, one exact release command must provision an exact disposable database,
  replay every migration, run the launch-critical PostgreSQL journeys, verify
  zero sessions, delete that exact database, verify absence, and then run the
  existing Node/browser/artifact gates.

## Live resources and workers

- No H1M worker remains open. All exact H1M and prior H1 disposable PostgreSQL
  databases, including the H1L database, are absent.
- The existing HQ PostgreSQL loopback tunnel remains an intentionally shared
  test resource. Public production remains untouched.

## Next action

Begin H1N with the accepted-change-order invoice and verified settlement
boundary before the separate completion-bound final obligation. Preserve the
H1M backend checkpoint, leave every aesthetic file to its owner, and keep
provider release, push, deployment, and DNS held.

## Batch 3B write scope

Twenty-two reviewed implementation, test, and ledger files cover account
schema v2, setup freshness, project/Checkout fencing, customer controls,
PostgreSQL authority, production composition, and exact unit/integration proof.
No migration, public copy, provider credential, lifecycle rule, invoice,
registrar, push, deploy, DNS, or production state is changed by this checkpoint.

## H1N Purpose 1 — accepted-change payment checkpoint

Checkpoint time: 2026-08-06T20:58:42-0400 (EDT)

This checkpoint implements only the first H1N financial purpose. It does not
start the completion-bound final obligation, final invoice, final-payment or
zero-balance path, immutable handoff, final projections, or 30-day workmanship
window.

### Implemented authority

- Additive migration `202608060045_custom_build_change_payment.sql`
  materializes one immutable invoice and exact `$125`-unit line set for each
  accepted-payment-required change, retains dedicated Checkout attempts and
  Stripe events, stores immutable provider-confirmed receipts, and permits the
  exact accepted change to become `effective` only through receipt insertion.
- The migration retains a separate durable owner reconciliation-command row
  with a database-derived request digest, exact completed-result replay, and a
  same-command/different-digest conflict. Receipt triggers bind every provider
  fact, its recomputed digest, invoice, attempt, acceptance, event/readback
  source, customer, money, tax, currency, and paid time before scope changes.
- `custom-services-custom-build-change-payment-postgres.mjs` reserves authority
  before Stripe, retains ambiguous effects for owner-only readback, accepts no
  browser money or mark-paid authority, and composes separate customer invoice,
  Checkout, webhook-settlement, owner-read, and owner-reconciliation paths.
- Every mutating v45 transaction now follows one executable order: discover the
  immutable job, acquire `ss-custom-build-h1m:<job>` with a transaction advisory
  lock, and only then lock or write idempotency/context/payment rows. Covered
  paths are stage, finish, failure, event claim, event reconciliation, event
  settlement, owner claim, owner creation completion, owner settlement, and
  customer expiry.
- The Stripe adapter retains one exact `$125 × quantity` automatic-tax purpose
  and its original expiration across same-key recovery. Production composition
  injects the same payment service into the account, API, and webhook router.
- HTTP transports owner `commandId` without dropping it. Abracadabra API and
  owner controls bind reconciliation to both `expectedPayment` and
  `expectedProjectId`, retain the last verified customer invoice across
  malformed or uncertain refreshes, and expose no provider or monetary owner
  override.

### Purpose-1 proof

- Final focused service/config/migration command: **54/54 passed**. Its
  executable in-memory PostgreSQL-service harness proves query ordering on
  every mutation named above, exact owner replay, digest conflict, zero repeat
  provider calls, and zero replay/conflict `INSERT`/`UPDATE`/`DELETE` effects.
- Broader H1N API/control/HTTP/composition/Stripe/webhook command:
  **186/186 passed**.
- The exact Git index was exported to isolated tree
  `/private/tmp/sitesourcery-h1n-purpose1-index-20260806` after path-limited
  staging. That commit candidate independently reran **54/54**, **186/186**,
  both staged Abracadabra SHA-256 values, and the full maintained browser audit
  successfully. Concurrent public worktree edits were therefore absent from
  the final Purpose-1 proof.
- Maintained browser audit completed successfully on the current Purpose-1
  source. It exercises accepted-change held, malformed, Checkout, customer
  uncertain, owner uncertain/reconciled, and paid/effective states at exact
  `320×720`, `390×844`, and `1440×1000`, including keyboard activation, focus
  retention, 44px controls, no horizontal overflow, no leaked money/mark-paid
  input, and no collision with first-payment or completion controls.
- The independent reviewer found no backend defect and independently confirmed
  the 54/54 service/config/migration result. Its forced timebox verdict was
  `BLOCKER: YES` only because its own three-viewport browser command had not
  finished before interruption. The exact maintained browser command then
  completed successfully locally. A final local read-only adversarial checklist
  rechecked all lock, replay, provider-fact, receipt, production-injection,
  HTTP, project-binding, browser, and Purpose-2-separation obligations:
  `BLOCKER: NO`. The reviewer timeout is recorded rather than misreported as an
  independent `BLOCKER: NO`.
- A provisional combined-tree Core command created disposable database
  `ss_core_release_20260807t005515078z_967701591355`, replayed all 45 migrations,
  passed all three launch-critical Custom-services PostgreSQL journeys, removed
  that exact database with verified absence, and then reached the broad
  candidate suite. The moving public-truth lane caused the candidate suite to
  fail 1 of 587 tests at `scripts/test/hosted-artifact.test.mjs:353` while
  forbidding a public `$25` value. This run is explicitly **not** a deterministic
  final release seal and is not used to absorb or certify the concurrent public
  files.
- `git diff --check` is clean. No live Stripe/registrar effect, production or
  customer-data mutation, credential handling, push, deployment, DNS change,
  or Purpose-2 implementation occurred.

### Seal boundary and next action

The Purpose-1 commit is path-limited to its migration, backend/API/control,
focused tests, browser fixture, two staged Abracadabra asset hashes, and these
durable evidence documents. Concurrent public, legal, landing, checker, and
shared-manifest truth hunks remain unstaged. After this commit, pause and report
its hash. Begin H1N Purpose 2 only from a fresh continuation and the technical
lead's exact blueprint.
