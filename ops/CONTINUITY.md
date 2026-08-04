# CONTINUITY — the session ledger (updated 2026-08-04, production continuity proven)

Written so no ruling, promise, or open thread is lost when the working
conversation is condensed. If you are an assistant reading this fresh:
these are OWNER RULINGS and open work, not suggestions.

## TECHNICAL-LEAD CHECKPOINT (2026-08-01)

- Today remains Site Sourcery only. DAARX, System Sourcery, HQ app
  weaving, and field-Mac integration are parked until the website and
  its existing hosted backend are complete.
- Exact verified application checkpoint: `d7c33c7e4ec7623f63249e0dc5b3d2951e781212`
  (`Install reviewed hosted legal authority`). The branch is pushed Mac to
  Dell to GitHub and is deployed as an immutable release on Zen at
  `https://simbiotechzen.tail85d878.ts.net`. Production
  `sitesourcery.com` remains on the prior GitHub Pages deployment.
- The shipped maker now uses the existing `server/hosted` account and
  project authority instead of treating the browser bridge as final.
  Account creation precedes payment, hosted session authority stays in
  secure cookies, and the release gate proves the shipped account and
  project journey. Checkpoints: `c4bf090`, `d276753`, `c5c2178`, and
  `4c14270`.
- The current release gate is green: 263 current Node tests, 19 self-host
  tests, 106 hosted-service passes plus two expected PostgreSQL-env skips,
  21 ops tests, exact public and hosted artifacts, and all 15 hosted routes
  at 320/390/1440 widths. Migration 000 through 021 executed and verified on
  a fresh disposable PostgreSQL database before that database was removed.
- The real HTTPS staging customer journey is complete. An owner-controlled
  Proton plus-alias received delivered registration and recovery messages;
  activation, password reset, secure-cookie sign-in, project creation, draft
  persistence, two accepted versions, sign-out/sign-in, project reopen, and
  the exact held `$5.00 USD` quote all passed with zero browser errors and no
  payment, domain, or publication request. Canonical PostgreSQL contains one
  user, one organization, one project, two accepted versions, all three exact
  legal acceptances, one held Download quote, and one active session. See
  `ops/HOSTED-STAGING-VERIFICATION-2026-08-01.md`.
- A post-proof infrastructure audit found that staging PostgreSQL and its
  HQ-to-Zen SSH tunnel were manually running from `/tmp`. That omission is
  closed: HQ PostgreSQL 16.14, the Zen tunnel, the hosted API, and static
  artifact are enabled user services with lingering; the API requires the
  tunnel; persistent paths and the pinned known-hosts file replace temporary
  paths. A clean logical restore matched the source contract, exact legal
  hashes, and customer row counts. Controlled PostgreSQL and tunnel restarts
  preserved the complete journey and returned public readiness `200`. The old
  processes were stopped, old database files retained, and a private mode-0600
  rollback dump recorded. Exact units and evidence live in `ops/staging/` and
  `ops/HOSTED-STAGING-VERIFICATION-2026-08-01.md`.
- The production-host review caught a separate address-authority drift before
  deployment: customer copy and commercial control promise
  `label.sitesourcery.me`, while three backend defaults still inserted an extra
  `sites.` label. The self-host runtime and hosted service now share one
  `DEFAULT_PLATFORM_BASE_DOMAIN = "sitesourcery.me"`; a cross-layer regression
  pins it to the public commercial contract. The complete Node 24.18.0 gate
  passed with 264 current Node tests, 19 self-host tests, 106 hosted-service
  passes plus two expected PostgreSQL-env skips, 22 ops tests, both artifacts,
  and the 15-route by 3-viewport browser audit. Staging's explicit invalid test
  domain meant no existing customer/project row required migration.
- Held production rehearsal is now installed from exact commit
  `be7cc3781c3e9354ecb017c7df7f090afe556f32`. HQ has a separate persistent,
  checksummed PostgreSQL 16.14 cluster and empty `sitesourcery_production`
  database with all 21 migrations, v21, and exact legal authority. Dell has the
  official Node 24.18.0 toolchain, immutable built release, enabled database
  tunnel/API/static user services, private independent runtime secrets, and
  only loopback listeners. Independent PostgreSQL/tunnel/runtime restarts
  passed. The approved Resend authority was then transferred privately into
  Dell's mode-0600 production environment; both temporary transfer files were
  removed, startup readiness passed without a send, and both action bases are
  exact production URLs. Capabilities are now registration-mail true,
  recovery-mail true,
  Download quote true, payment false, domain purchase false, publication false.
  The pinned official Caddy 2.11.4 archive/version/format/config validation also
  passed, but Caddy is not installed as a service or running. Exact units and
  evidence: `ops/production-rehearsal/README.md`.
- The production continuity gap is closed without a public cutover. Dell now
  has an enabled reboot-safe Zen backup mount, a supervised persistent daily
  backup timer, startup recovery, and a five-minute operations monitor. A live
  encrypted backup cycle quiesced and automatically restored the runtime; a
  distinct-host clean-room restore reproduced the exact database and app-state
  invariants. The confirmed owner Proton inbox then received one explicitly
  labeled test warning and recovery through the reviewed Resend adapter, and
  Resend reported both delivered. The real monitor returned all six checks
  green and sent nothing. Alert release:
  `62e0b9ba70301ce7e79bf8e55e2a78e626fa13c9`; approval expires
  `2027-08-02T11:15:40.000Z`. Public `main`, GitHub Pages, and DNS remain on
  the July 22 predecessor. Exact evidence:
  `ops/PRODUCTION-BACKUP-RESTORE-2026-08-02.md`,
  `ops/PRODUCTION-BACKUP-CADENCE-2026-08-02.md`, and
  `ops/PRODUCTION-MONITOR-2026-08-02.md`.
- Recovery delivery is now durably reserved before any mail-provider
  effect. Delivered requests replay without another send; interrupted or
  ambiguous sends stop in a terminal reconciliation state. The fence
  stores no recipient, token, or action URL and has passed a fresh 10/10
  disposable-PostgreSQL proof plus the full local gate.
- Zack approved Resend, `accounts@sitesourcery.com`, and the bounded sending
  DNS scope. The reviewed local adapter now covers registration and recovery,
  verifies live domain/SPF/DKIM/tracking state, uses provider idempotency, and
  rejects off-site action links. Its mocked provider suite and the complete
  repository gate are green (`106` hosted passes plus two expected PostgreSQL
  skips). `ops/RESEND-SETUP.md` is the one activation checklist.
- Public production account mail remains operationally held by the uncut public
  edge; isolated HTTPS staging account mail is active and proven. The
  owner-controlled Resend account,
  exact sending DNS, verified domain, and dedicated owner-approved API key now
  exist. The exact domain UUID is
  `b7de4950-b5dc-43d2-8a29-847685dd41d6`; an earlier scratch note omitted its
  final `6`, and the adapter's UUID check stopped before any provider request.
  Live readiness now passes for the exact verified domain, SPF/DKIM, sending
  capability, and disabled open/click tracking. The key now exists only in
  Zen's private staging environment and Dell's private production environment,
  both mode `0600`; it was transferred without output and the temporary copies
  were removed. Inspection found no corresponding Mac Keychain item, so the
  earlier Keychain note was inaccurate. The first
  public-link attempt did hit the old GitHub Pages 404, but the later isolated
  staging proof completed both customer actions. Dell's loopback production
  runtime now independently passes Resend readiness with both exact production
  action bases and advertises registration/recovery capability; no message was
  sent. Public same-origin routing and a post-cutover delivery/action proof
  remain. `ops/RESEND-VERIFICATION-2026-08-01.md` records the sequence.
- Claude remains a non-writing reviewer unless Zack or Codex gives one
  explicit bounded assignment. This prevents parallel edits and duplicate
  work.

## $5 DOWNLOAD IMPLEMENTATION CHECKPOINT (2026-08-02)

- The private branch now has the complete account-bound one-time Download
  implementation: exact server quote, one idempotent Stripe Checkout dispatch,
  Stripe readback rather than webhook money trust, durable receipt and
  project-wide non-consuming entitlement, repeated accepted-version HTML
  downloads, and canonical Stripe Customer binding for the later Alakazam
  credit ladder.
- A Checkout return carries only the authenticated project selector. The
  shipped page removes Checkout identifiers from the address bar, reopens the
  project, polls bounded authenticated project state, and reveals the Download
  after settlement. The return query cannot settle money or grant access and
  cannot initiate another charge.
- Verified payment-reversal events only tighten access: a partial reversal or
  open dispute suspends future downloads; a full reversal or lost dispute
  revokes them. There is no customer refund button, refund offer, or refund
  creation API in this slice.
- Exact Node 24 focused gates pass (`47/47` for the final payment
  state-machine/Stripe-provider set; `32/32` hosted-artifact/customer-control
  checks). The permanent repository gate now includes both Commerce V2 suites
  and passes with `298/298` core tests, `19/19` self-host tests, `116/116`
  runnable hosted-service tests (`2` PostgreSQL-only skips in the generic
  no-database gate), and `52/52` operations tests, followed by exact artifact
  checks and the `15`-route x `3`-viewport browser audit. Migration 022 and the
  complete shipped browser/API/PostgreSQL journey also pass on a fresh
  disposable database (`10/10`): account, project, accepted version, quote,
  Checkout, provider-confirmed unpaid expiry replacement, verified
  webhook/readback, entitlement, return polling, reversal evidence, and exact
  downloaded HTML bytes.
- This is an implementation checkpoint, not a public activation. The payment
  release remains held by default; production still serves the July 22 site.
  The later release pass still needs the owner tax choice, a real Stripe test
  payment on private staging, owner walkthrough, and reviewed public cutover.

## ALAKAZAM CONTRACT/DATABASE CHECKPOINT (2026-08-02)

- The owner-approved ladder is now one frozen held contract: only $25, $35,
  and $50 monthly tiers; the exact upward-inherited capabilities; no invented
  care quantities; $5 Download value applied once on first entry; fixed
  difference-only upgrades; and renewal-boundary downgrades with no mid-period
  refund or provider proration. Obsolete $15/$30 values have no path back into
  the private catalog.
- Additive migration 023 gives Alakazam its own service-role-only authority
  instead of reusing the obsolete generic subscription records. It stores one
  current project subscription, immutable quotes and receipts, fenced Checkout
  dispatch, verified Stripe events, one-use Download credit evidence, one open
  downgrade schedule, and immutable tier/status events bound to the exact
  resulting subscription revision. Browser roles have no direct table access.
- Subscription identity is immutable. A tier/status/period change must advance
  the provider observation and match one exact immutable event/revision.
  Unproved mutation and early downgrade fail closed. A reversed source
  Download can only tighten Alakazam access with the exact reversal,
  entitlement, subscription state, and tier-event evidence; there is still no
  refund button, refund offer, or refund-creation API.
- Proof completed on disposable HQ PostgreSQL databases that were removed
  afterward: all migrations 001–023 replayed cleanly; the focused journey
  passed $25 start, exactly $10 for $25 -> $35, rejection of an unproved tier
  mutation, retention of $35 through the paid period, rejection of an early
  downgrade, and $25 activation at the exact renewal boundary for $0 with no
  proration. The separate full canonical hosted-service PostgreSQL suite then
  passed 10/10, including the shipped browser account journey. Current local
  gates also pass 310/310 core and 116/116 runnable hosted tests, with the two
  expected environment-only skips.
- This database checkpoint did not make Alakazam usable. The next provider-only
  checkpoint is recorded directly below. Real provider configuration,
  service/API/webhook composition, customer billing controls, automatic
  `sitesourcery.me` publication, tier-feature enforcement, owner workbench,
  real Stripe test-mode journeys, care/cancellation decisions, owner walk, and
  cutover remain. Public production remains the July 22 predecessor.

## ALAKAZAM STRIPE PROVIDER CONTRACT CHECKPOINT (2026-08-02)

- The existing reviewed Stripe adapter now has one optional Alakazam surface;
  no second Stripe client or payment stack was created. Held mode exposes and
  refuses every operation. Contract mode requires one exact active Alakazam
  Product, three distinct Product-bound monthly Prices at $25/$35/$50, a USD
  $5 duration-once Coupon with no global redemption/expiry limit and only that
  Product in scope, and a pinned Billing Portal configuration that allows
  payment-method and invoice history but not customer, subscription, or
  cancellation changes.
- A first subscription Checkout contains exactly one selected recurring Price
  and, only with the project Download credit, the pinned Coupon. Promotion-code
  entry is never enabled. Direct starts at any tier and the $20/$30/$45 credit
  results are server-bound. Upgrade Checkout is a one-time Product-bound line
  for only the fixed difference; it cannot create another subscription.
- Webhooks remain wake-up signals. Settlement reads Checkout back and requires
  matching account/project/quote metadata, exact subtotal/discount/tax/total,
  a succeeded PaymentIntent, for upgrades one exact captured and unrefunded
  Charge, and for starts one paid Invoice plus one active quantity-one
  Subscription item on the selected Price. A signed event cannot substitute
  provider money evidence.
- After an upgrade payment, the adapter changes the existing Subscription Item
  to the target Price with quantity one, `proration_behavior=none`, and
  `billing_cycle_anchor=unchanged`, then reads the Subscription back and proves
  the same item and paid boundary before returning confirmation. A downgrade
  attaches one Schedule, preserves the current Price through the exact period
  end, enters one lower-Price monthly phase with no proration, and releases the
  continuing lower subscription afterward.
- Ambiguous effects do not repeat. Checkout submits once; a Price mutation is
  reconciled before any retry and can never collect another difference; an
  uncertain Schedule attachment stops before phase mutation; a known attached
  Schedule is reconciled by exact ID instead of creating a duplicate.
- Exact Stripe adapter tests pass 53/53 and the wider Node gate passes 330/330.
  The implementation remains local and unpushed. Production composition still
  does not accept Alakazam provider identifiers/capabilities, no real $35/$50
  Prices or Coupon were invented, no HTTP/service/webhook path calls this
  surface, and no entitlement or public site changed. Next is the separate
  PostgreSQL service/repository transaction layer, then webhook and customer
  API composition.

## ALAKAZAM QUOTE TRANSACTION CHECKPOINT (2026-08-02)

- A new held-by-default Alakazam billing service authorizes quote creation only
  when the reviewed release and the existing Stripe adapter agree on exact
  Alakazam readiness and tax mode. Customer input contains only authenticated
  project identity, one of the three tier IDs, and a UUID idempotency key;
  browser money, credit, subscription, and provider fields are rejected before
  provider readiness or PostgreSQL access.
- The PostgreSQL repository locks the active project, replays one immutable
  quote per UUID, and reads the current subscription revision or one active,
  unused project Download entitlement inside that transaction. The resulting
  30-minute disclosure binds $25/$35/$50 server money, the one-time $5 entry
  credit, fixed upgrade difference, renewal-boundary downgrade, no mid-period
  refund/proration, and the reviewed tax mode. A pending downgrade, changed
  billing owner, stale project, changed idempotency purpose, or digest drift
  fails closed.
- Focused pure/service/repository tests pass 23/23. All 23 migrations replayed
  into a fresh disposable database, then the new quote transaction and the
  existing start/upgrade/downgrade contract passed 2/2 against PostgreSQL; the
  disposable database was removed. Wider gates pass 336/336 core and 121/121
  runnable hosted tests with the same two expected environment-only skips.
- This checkpoint creates no Checkout, charge, subscription, Schedule,
  entitlement, HTTP route, webhook route, UI control, or public capability.
  Production composition remains held and the public site remains unchanged.
  Next is durable Checkout/Schedule reservation and provider-result
  persistence, followed by separately proven event reconciliation.

## ALAKAZAM DIRECT CUSTOMER PROVISIONING CHECKPOINT (2026-08-02)

- A brand-new customer can now enter the internal Alakazam payment flow
  without first buying the $5 Download. Before any provider call, additive
  migration 024 commits one organization-scoped, quote-bound Customer
  reservation with a two-minute worker lease, exact purpose digest, and stable
  provider idempotency input. It stores no email, name, phone, or address.
- The existing Stripe adapter creates one metadata-only Customer and requires
  exact Customer readback before use. A known organization binding bypasses
  creation. A pre-effect failure may release only the untouched reservation;
  transport, readback, interrupted-worker, or post-effect persistence
  uncertainty becomes durable reconciliation-required state and never
  authorizes an automatic second Customer.
- The PostgreSQL repository validates the current quote, project, active
  membership, and billing identity even when a Customer is already bound. On
  confirmation it inserts the canonical `ss.stripe_customers` binding and the
  exact provider facts in one transaction. A new $5 Download Checkout cannot
  open while Customer creation is pending or ambiguous, closing the direct
  cross-flow duplicate-Customer race.
- All 24 migrations replay cleanly on a fresh disposable HQ database. The real
  PostgreSQL contract passes 4/4 for quote replay, direct Customer creation,
  safe no-effect release, pending replay, ambiguity, exact confirmation,
  interrupted-worker fencing, and the existing start/upgrade/downgrade
  journey. Focused gates pass 55/55 Stripe adapter, 26/26 Alakazam
  pure/service, 10/10 repository/readiness, and 16/16 migration structure.
  Wider gates pass 346/346 core and 121/121 runnable hosted tests with the same
  two intentional environment-only skips.
- This is still an internal held checkpoint. No Alakazam Checkout/Schedule
  dispatch service, payment-event persistence, HTTP/customer route, UI
  control, entitlement activation, hosted publication, real provider
  configuration, or public capability was activated. Production still serves
  the July 22 predecessor. Next is the separate durable Checkout/Schedule
  dispatch and provider-result transaction.

## ALAKAZAM CHECKOUT DISPATCH CHECKPOINT (2026-08-02)

- Start and fixed-difference upgrade Checkout now have one internal durable
  transaction boundary. Additive migration 025 leases a quote-bound dispatch
  for exactly two minutes before Stripe, reconstructs its purpose from the
  immutable quote, canonical organization Customer, and current subscription,
  and permits only one open dispatch for the project.
- The held billing service first ensures the same canonical Customer, claims
  the dispatch, and selects exactly one provider operation: subscription start
  or fixed-difference upgrade. It sends no browser money or provider authority.
  A ready Checkout URL replays without another effect; expired ready work,
  interrupted workers, and ambiguous provider/persistence results enter
  reconciliation and cannot automatically call Stripe again. A proved
  pre-effect failure alone closes the quote safely.
- All 25 migrations replayed cleanly on a fresh disposable HQ database. The
  real PostgreSQL Alakazam contract passes 5/5, including pending replay,
  ambiguity fencing, reconciliation to a committed destination, safe
  pre-effect failure, stale-worker fencing, and the full start/upgrade/
  downgrade evidence journey. Focused gates pass 55/55 Stripe adapter, 34/34
  Alakazam pure/service, 10/10 repository/readiness, and 17/17 migration
  structure. Wider gates pass 354/354 core and 121/121 runnable hosted tests
  with the same two intentional environment-only skips.
- This remains internal and uncomposed. No payment was settled, subscription
  activated or changed, downgrade Schedule dispatched, HTTP/customer route
  opened, feature granted, site published, provider configuration invented, or
  production surface changed. Next is payment/webhook settlement and exact
  subscription activation for start/upgrade; Schedule dispatch remains a later
  separate slice. Public production remains the July 22 predecessor.

## ALAKAZAM PAYMENT SETTLEMENT CHECKPOINT (2026-08-02)

- A verified Stripe `checkout.session.completed` event can now wake one
  internal held payment service. It resolves the exact durable Checkout and
  requires read-only Stripe confirmation of Customer, Subscription identity,
  Price, Invoice/PaymentIntent, money, tax, discount, status, and bound purpose
  before it can write payment state. Event metadata or provider-money drift
  writes nothing.
- Additive migration 026 and one PostgreSQL transaction permit only one
  logical Checkout-completion event, one quote receipt, and one PaymentIntent
  receipt. A start records the receipt, applies the project Download credit if
  present, and creates a `pending` local subscription without activating it.
  An upgrade records one immutable `upgrade_payment_settled` tier event, moves
  the quote to `provider_change_pending`, and leaves the current local tier and
  Stripe Subscription unchanged. A settled replay returns the durable receipt
  without another Stripe read or new IDs.
- All 26 migrations replayed cleanly on the disposable HQ database. The real
  PostgreSQL Alakazam contract passes 5/5 and now proves pending start,
  difference-only upgrade handoff, durable settlement replay, later exact
  activation/application evidence, and renewal-boundary downgrade. Focused
  gates pass 7/7 payment service, 15/15 pure Alakazam, 55/55 Stripe adapter,
  18/18 migration structure, and 5/5 repository readiness. Wider gates pass
  361/361 core and 121/121 runnable hosted tests with the same two intentional
  environment-only skips.
- This remains internal, held, local, and unpushed. No start was activated by
  payment alone, no upgrade Price or local tier was changed by payment alone,
  no downgrade Schedule was dispatched, and no HTTP/customer/webhook runtime
  route or production capability opened. Next is exact start activation and
  upgrade provider-mutation confirmation; Schedule dispatch remains a later
  separate slice. Public production remains the July 22 predecessor.

## ALAKAZAM START ACTIVATION CHECKPOINT (2026-08-04)

- A verified `customer.subscription.created` or `.updated` event can now wake
  one internal held start-activation service. It resolves the exact durable
  pending start and performs read-only Stripe Subscription reconciliation.
  Customer, Subscription, item, Price, tier, status, cancellation flag,
  schedule absence, period, metadata, and provider digest must all match; stale
  or changed evidence activates nothing.
- Additive migration 027 permits one `start_applied` transition per local
  Subscription. One PostgreSQL transaction records and processes the verified
  provider event, writes the revision-2 tier event, binds the exact paid
  receipt, activates the local Subscription and period, and moves the start
  quote to `applied`. An already-active replay returns the durable activation
  without another Stripe read or new IDs.
- All 27 migrations replayed cleanly on a fresh disposable HQ database. The
  real PostgreSQL Alakazam contract passes 5/5 and the old manual start
  activation shortcut is gone. Focused gates pass 8/8 activation service,
  19/19 migration structure, and 5/5 repository readiness. Wider gates pass
  369/369 core and 121/121 runnable hosted tests with the same two intentional
  environment-only skips.
- This remains internal, held, local, and unpushed. No upgrade Price or local
  tier was changed, no downgrade Schedule was dispatched, and no HTTP/customer
  webhook composition, feature grant, publication effect, real provider
  configuration, or production capability opened. Next is the separately
  fenced paid-upgrade provider mutation and local confirmation. Public
  production remains the July 22 predecessor.

## ALAKAZAM UPGRADE PROVIDER CHECKPOINT (2026-08-04)

- The already-paid upgrade now enters one service-role-only, migration-backed
  application before Stripe can change the recurring Price. It binds the exact
  quote, settled receipt, current subscription revision, existing Subscription
  Item, paid period, target tier, and one durable provider idempotency key.
- The held upgrade service replaces only the existing item at quantity 1, with
  no proration and an unchanged billing anchor. It clears stale first-start
  Download-credit metadata and requires exact target Price, Customer, item,
  period, status, schedule absence, paid receipt metadata, and provider digest
  readback. The old local tier remains active after provider confirmation.
- An interrupted or ambiguous worker moves both application and quote to
  reconciliation. Recovery is read-only: exact target readback may confirm the
  durable application, but no automatic second Price mutation or difference
  Checkout is permitted.
- All 28 migrations replayed cleanly on a fresh disposable HQ database. The
  real PostgreSQL journey passes 5/5, including expired-worker fencing and
  service-plus-repository read-only recovery. Focused gates pass 9/9 upgrade
  service, 56/56 Stripe adapter, 20/20 migration structure, and 5/5 repository
  readiness. Wider gates pass 379/379 core and 121/121 runnable hosted tests
  with the same two intentional environment-only skips.
- This remains internal, held, local, and unpushed. No verified Subscription
  event has committed the local upgrade revision, no downgrade Schedule was
  dispatched, and no HTTP/customer route, feature grant, publication effect,
  real provider configuration, or production capability opened. Next is the
  separately atomic verified-event local tier confirmation. Public production
  remains the July 22 predecessor.

## ALAKAZAM UPGRADE ACTIVATION CHECKPOINT (2026-08-04)

- A verified `customer.subscription.updated` event can now wake the internal
  held upgrade-activation boundary only when its Subscription, local
  subscription, quote, paid receipt, purpose, and complete provider metadata
  identify one provider-confirmed application. It performs read-only Stripe
  reconciliation and never repeats the Price mutation or difference payment.
- Additive migration 029 permits one `upgrade_applied` event per quote and adds
  a deferred database proof tying the applied application, processed Stripe
  event, exact paid receipt, target Price facts, tier event, quote, and new
  local revision together. One transaction records those facts, advances the
  existing subscription from revision 2 to 3, and leaves the paid billing
  period unchanged. Replays use immutable activation evidence without another
  Stripe read or new IDs, including after a later downgrade revision.
- All 29 migrations replayed cleanly on a fresh disposable HQ database. The
  real PostgreSQL journey passes 5/5 with service-driven activation replacing
  the old manual test edits. Focused gates pass 15/15 upgrade service, 21/21
  migration structure, and 5/5 repository readiness. Wider gates pass 385/385
  core and 121/121 runnable hosted tests with the same two intentional
  environment-only skips.
- This remains internal, held, local, and unpushed. No downgrade Schedule was
  dispatched through the customer runtime, and no HTTP/customer route, tier
  feature grant, publication effect, real provider configuration, or
  production capability opened. Next is the separately fenced
  renewal-boundary downgrade transaction and customer tier controls. Public
  production remains the July 22 predecessor.

## ALAKAZAM DOWNGRADE SCHEDULE DISPATCH CHECKPOINT (2026-08-04)

- An accepted zero-dollar downgrade now enters one durable application before
  Stripe can attach or change a Subscription Schedule. It binds the exact
  customer, project, quote, active subscription revision, existing item and
  Price, paid period end, lower target tier, disclosure, and one stable
  provider idempotency key. The current local tier and revision remain
  unchanged.
- The held downgrade service schedules the current Price through the exact
  renewal boundary and the lower Price afterward, with no proration and
  release behavior. A provider response loss is fenced in PostgreSQL. If the
  exact Schedule ID is known, recovery can only retrieve that Schedule; it
  cannot submit another create, attachment, or phase mutation. If the ID is
  unknown, only owner reconciliation can continue.
- Additive migration 030 makes provider confirmation, the quote's `scheduled`
  state, and one `downgrade_scheduled` tier event a single transaction. A
  deferred trigger proves the exact purpose, current revision, Schedule facts,
  lower Price, effective boundary, and unchanged current entitlement agree at
  commit. Durable replay performs no Stripe work and allocates no identity.
- All 30 migrations replayed cleanly on a fresh disposable HQ database. The
  real PostgreSQL journey passes 5/5, including an ambiguous known Schedule,
  strict read-only recovery, atomic confirmation, local replay, rejection of
  an early tier switch, and the later boundary transition. Focused gates pass
  11/11 downgrade service, 57/57 Stripe adapter, 22/22 migration structure,
  and 5/5 repository readiness. Wider gates pass 397/397 core and 121/121
  runnable hosted tests with the same two intentional environment-only skips.
- This remains internal, held, local, and unpushed. Migration 030 schedules
  the provider change but does not activate the lower local tier early. The
  separate renewal-boundary webhook transaction, HTTP/customer controls,
  feature rendering, publication effects, real provider configuration, and
  production capability remain closed. Public production remains the July 22
  predecessor.

## ALAKAZAM DOWNGRADE ACTIVATION CHECKPOINT (2026-08-04)

- A verified `customer.subscription.updated` event can now wake the internal
  held downgrade-activation boundary only at or after the scheduled renewal
  instant. It reconstructs the immutable downgrade purpose and requires
  read-only Stripe confirmation of the same Subscription, item, Customer,
  attached Schedule, lower Price, active status, and exact new billing period.
  The event metadata, mode, timing, and provider digest must all agree.
- Additive migration 031 makes the processed Stripe event, one
  `downgrade_applied` tier event, the lower local tier revision, applied
  Schedule, and applied quote one transaction. Its deferred database trigger
  proves the exact scheduled purpose, provider readback, boundary, and new
  period agree at commit. An applied replay uses immutable evidence without
  another Stripe read or new IDs, including after a later local revision.
- All 31 migrations replayed cleanly on a fresh disposable HQ database. The
  real PostgreSQL journey passes 5/5 with service-driven boundary activation
  and a negative proof that the Schedule cannot be marked applied alone.
  Focused gates pass 7/7 downgrade-activation service, 23/23 migration
  structure, and 5/5 repository readiness. Wider gates pass 404/404 core,
  121/121 runnable hosted tests with the same two intentional environment-only
  skips, and 52/52 operations tests.
- This remains internal, held, local, and unpushed. No HTTP/customer/webhook
  runtime composition, tier feature rendering, publication effect, real
  provider configuration, or production capability opened. Next is the
  customer/runtime composition and broader renewal/status reconciliation.
  Public production remains the July 22 predecessor.

## ALAKAZAM HELD WEBHOOK COMPOSITION CHECKPOINT (2026-08-04)

- The hosted Stripe ingress now verifies raw webhook bytes exactly once and
  routes exact Alakazam metadata to one of four already-proven handlers:
  Checkout payment settlement, start activation, upgrade activation, or
  renewal-boundary downgrade activation. Download and older canonical events
  retain their existing branches. An Alakazam marker with an impossible event
  type/change-kind pairing is rejected instead of silently falling through.
- The production executable composes those handlers with the canonical
  PostgreSQL Alakazam repository, the one reviewed Stripe adapter, and the
  shared clock/identity ports. `SITESOURCERY_ALAKAZAM_MODE` defaults to `held`;
  an `approved` mode requires one exact reviewed tax mode and matching provider
  readiness at startup. Held mode carries no latent tax authority.
- Focused composition gates pass 21/21. Wider gates pass 408/408 core,
  125/125 runnable hosted tests with the same two intentional environment-only
  skips, 52/52 operations tests, and the hosted runtime assertion. This slice
  changes no persistence contract; migration 031 and its fresh 5/5 PostgreSQL
  proof remain authoritative.
- This is wired but still not customer-usable. The production Stripe loader
  does not yet accept the reviewed Alakazam Product/Price/Coupon/Portal
  bindings, no customer quote/change routes or controls exist, and no tier
  feature or publication fulfillment opened. Nothing was pushed or deployed;
  public production remains the July 22 predecessor.

## MULTI-AGENT BATCH 1 ACCOUNT AND PROVIDER CHECKPOINT (2026-08-04)

- `ops/SITESOURCERY-MULTI-AGENT-ROADMAP-2026-08-04.md` is now the canonical
  completion and dependency map. Batch 1 used disjoint lead, customer-UI,
  Stripe-configuration, and read-only public-truth lanes. The lead retained
  shared contracts, PostgreSQL/HTTP integration, review, tests, documentation,
  and the checkpoint commit. Live execution state is now checkpointed in
  `ops/SITESOURCERY-ACTIVE-RUN.md`; chat context is not authoritative for a
  running test, worker, disposable resource, or next action.
- A signed-in customer can now read one canonical project-scoped Alakazam
  snapshot through `GET /api/v1/projects/{projectId}/alakazam`. PostgreSQL
  supplies the eligible first-payment Download credit, current local tier and
  payment state, paid period, pending change, next renewal, and up to 50 local
  receipts. The service emits no Stripe IDs or raw provider facts. HTTP,
  application, membership, tenant, customer, and project boundaries all fail
  closed. A project member who is not the current billing owner receives the
  same generic denial instead of a false empty account; every billing write
  action remains false.
- The hosted Abracadabra customer room now fetches and renders that frozen v1
  snapshot, including useful available, pending, active, attention, ended,
  loading, error, and safe GET-retry states. It drops late responses after a
  project switch, rejects schema/money/status/date/provider drift, and adds no
  start, tier-change, Portal, cancellation, payment, or browser-storage
  authority. Receipt money is rendered from the exact local receipt total.
- The production Stripe loader now accepts an Alakazam configuration only with
  one complete approved capability set and exact bindings for one Product,
  the three $25/$35/$50 monthly Prices, the one-invoice $5 Download Coupon,
  and the restricted Billing Portal configuration. Partial, extra, duplicate,
  cross-mode, or mismatched approved configuration fails before adapter
  construction. Held mode ignores every supplied value and forwards none. No
  real provider IDs, keys, network effects, or release change were added.
- The accepted public-truth audit is preserved in
  `ops/SITESOURCERY-PUBLIC-TRUTH-AUDIT-2026-08-04.md`. Launch-critical work now
  explicitly includes removing legacy direct Payment Links and domain refund
  claims, publishing the complete tier ladder, correcting feature placement
  and platform-address language, approving lifecycle/legal truth, building the
  minimum Custom invoice/job workbench, and holding domains and Responder until
  their fulfillment is real.
- Focused proof passes 11/11 account/HTTP, 76/76 relevant customer UI, 69/69
  Stripe adapter/configuration, and 4/4 hosted-artifact tests. Broad proof
  passes 417/417 core, 135/135 runnable hosted tests with two intentional
  environment-only skips, 52/52 operations, 23/23 migration structure, and
  19/19 self-host tests. Source/site, held hosted artifact, and rebuilt public
  artifact checks pass.
- An isolated Chrome runtime pass at 1440×1000 and 320×720 proves every account
  state, hidden signed-out/no-project behavior, safe retry, stale-project
  response rejection, named accessibility-tree semantics, GET-only traffic,
  no ready-state mutation control, no horizontal overflow, and the corrected
  `$10.00 USD` receipt at both widths. Contract-valid fixtures also prove the
  $5 credit only when no subscription exists; pending, active, attention, and
  ended states cannot claim it. This is real runtime evidence, not a source-
  regex accessibility claim; full assistive-technology and keyboard/contrast
  audits remain part of the later release gate.
- All 31 migrations replayed on a fresh named disposable HQ database. The real
  5/5 Alakazam journey now proves the account snapshot at the scheduled higher
  tier, the lower renewal, the post-boundary lower tier, receipt history, no
  provider identity, and real cross-tenant/cross-project denial. The database
  had zero sessions, was dropped, and was verified absent.
- Batch 1 remains local, held, unpushed, and undeployed. It makes billing truth
  visible but not yet customer-actionable. Next is Batch 2: exact customer
  start/upgrade/downgrade/Portal/cancellation commands in parallel with tier
  fulfillment and broader lifecycle reconciliation. Public production remains
  the July 22 predecessor.

## MULTI-AGENT BATCH 2 CUSTOMER START AND UPGRADE CHECKPOINT (2026-08-04)

- The held customer room now completes two distinct, evidence-gated billing
  journeys. A project with no subscription may choose `$25/$35/$50`, apply its
  one-use `$5` Download credit, review exact first payment and renewal, freshly
  accept the disclosure, and receive only a safe Stripe Checkout destination.
  An active paid `$25`/`$35` project with no pending change may choose only a
  higher tier and review the exact fixed difference (`$10`, `$15`, or `$25`)
  plus the full target renewal. `$50`, pending, attention, cancelling, ended,
  and scheduled-change accounts expose no upgrade action.
- The browser sends only target tier, accepted disclosure digest, route
  identity, CSRF proof, and stable command UUIDs. It rejects changed money,
  current-tier identity, renewal, tax, expiry, schema, provider-shaped fields,
  unsafe destinations, and stale project/account truth. A success URL or
  Checkout response never mutates local tier authority; only a refreshed
  server account after verified Subscription-event readback and atomic local
  activation may show the higher tier.
- The production Stripe event composition now hands an exact paid upgrade
  settlement into the already-proven durable `applyPaidUpgrade()` service, then
  routes the later Subscription update into the same service instance for
  activation. Existing leases, one idempotent Price mutation, unchanged billing
  boundary, no provider proration, and read-only ambiguity recovery remain the
  no-double-effect fences.
- An independent review caught and closed a second-payment window before the
  checkpoint: after one dispatch became `settled`, a stale second quote could
  previously reach Checkout while the local tier still awaited activation.
  Checkout claim now serializes on the project and joins dispatch with quote
  state, blocking Checkout-pending, payment-settled, provider-change-pending,
  and reconciliation-required work. A settled dispatch stops blocking only
  after its quote is atomically `applied`.
- The established `noMidPeriodRefundOrProration` quote field remains the
  downgrade-only paid-period-retention rule (false for starts/upgrades, true
  for downgrades). Upgrade no-proration truth is separately fixed by exact
  target-minus-current money, disclosure `providerProration: false`, and the
  provider adapter contract. No historical quote schema or digest was rewritten
  to relabel that field.
- Final proof passes: browser/API contract 8/8; core 434/434; hosted service
  140 pass with 2 intentional environment skips; operations 52/52; self-host
  19/19; migration structure 23/23; site, held hosted artifact, and exact
  78-file public artifact checks. A fresh all-31-migration PostgreSQL journey
  passes 5/5, proving both rejection of a competing direct `$25→$50` Checkout
  while the first upgrade is pending and acceptance of a later upgrade after
  activation. Its named database had 0 sessions, was dropped, and is absent.
- Isolated Chrome for Testing 149 passes 27/27 proofs at 1440×1000 and 320×720
  with exact `$25→$50` and `$35→$50` reviews, 25 screenshots, stable quote and
  Checkout retries, explicit acceptance, expiry and malicious-destination
  rejection, intercepted safe Stripe navigation, server-only tier authority,
  accessibility regions, and zero overflow. It recorded 177 API requests,
  0 external responses, and 0 unexpected browser errors. Evidence lives at
  `/private/tmp/sitesourcery-alakazam-upgrade-browser.FSe1PL/`; results SHA-256
  is `f7204667d2a4736239467e139defd19d6ce87525151f08e2252f948c7ea92c40`.
- Start and upgrade remain local, held, unpushed, and undeployed. Public
  production remains the July 22 predecessor. The next single billing slice is
  customer-safe renewal-boundary downgrade scheduling; Portal, cancellation,
  fulfillment, lifecycle policy, owner invoicing, release, and provider
  configuration remain separate gates.

## OWNER PRODUCT CONTRACT (2026-08-02 — newest ruling wins)

When dated owner statements conflict, the newest explicit owner statement is
canonical. Older notes remain useful history, but they do not override a later
price, tier, or feature ruling.

- **Abracadabra Download — $5 once.** The customer may make and preview for
  free. An account is required immediately before the first payment. The $5
  buys a reusable, non-expiring download entitlement for that editor project;
  it does not activate hosting.
- **Alakazam — three monthly levels, all hosted.** The base service keeps the
  customer's site live at `label.sitesourcery.me`. The $5 Download purchase is
  still credited toward the first Alakazam payment. Each paid rung also credits
  toward the next rung instead of charging two full tier prices: Download to
  $25 means $20 remains, $25 to $35 means $10 remains, and $35 to $50 means
  $15 remains. A normal renewal at the selected level is its full monthly
  price; the exact mid-cycle timing/proration implementation must preserve this
  difference-only upgrade rule.
  - **$25/month:** hosting at the Site Sourcery address and the three base
    looks (Crystal, Hearth, and Midnight).
  - **$35/month:** everything in $25, plus a photo header, expanded font
    choices, section toggles, version history limited to three saved versions,
    and a modest amount of support/care.
  - **$50/month:** everything in $35, plus the richer customization bundle,
    explicitly including Cash App/Venmo links, a menu, further font/border
    controls, and a larger amount of support/care.
- **Alakazam tier changes.** Upgrades take effect immediately after the exact
  difference is paid. A downgrade requested during a paid month is scheduled
  for the current renewal boundary: the customer keeps the higher tier through
  the period already paid for, receives no mid-period cash refund or proration,
  and is charged the full lower monthly price at the next cycle. Premium
  configuration data is preserved rather than destroyed when the lower tier
  begins, but premium controls are unavailable unless the matching entitlement
  is active.
- The exact support/care quantities, response promise, edit accounting, and
  final fine-grained font/border boundary are **not decided yet**. Do not invent
  minutes, edit counts, turnaround times, or cancellation/refund policy. Those
  details must be redlined before the subscription rails open.
- There is **no $15 or $30 published tier**. Those were obsolete drafts and
  have been removed from the private v2 catalog. The prior `$35 gets ____`
  placeholder is also superseded by the three-level ruling above.
- Only the old $25 Stripe Payment Link exists today. $35 and $50 provider
  prices/links have not been created, and none of the three subscriptions may
  be represented as end-to-end operational until entitlement, billing,
  publication, support, and cancellation behavior pass their customer walk.


## Owner test keys (no card needed)

The paid states are session flags set by Stripe's redirect - the same doors
can be opened by hand for testing (each applies to that TAB until closed):
- Simulate the $5 download tier:  /abracadabra/app/?paid=1
- Simulate Alakazam active:       /abracadabra/app/?alakazam=1
- Forget the browser account:     /abracadabra/app/?account=reset
Honor-gates by design; the machinery (accounts, then the platform) is the
real product - the owner is the backstop, not the mechanism.

## GOVERNANCE (2026-08-01) — read before touching anything

- **Codex is technical lead; Zack is product owner.** The prior
  assistant's standing order: do NOT write to this worktree except on
  one explicit, bounded assignment from Codex or Zack. Clean checkpoint
  = commit tagged "handoff" + ops/HANDOFF-2026-08-01.md.
- Corrections that bind: the browser account is a PROTOTYPE BRIDGE, not
  the real-account requirement; server/hosted holds the real held
  Node/Postgres platform (accounts/projects/billing/support/domains/
  publication) - AUDIT AND INTEGRATE it, never build a parallel backend;
  ops/OPERATOR-BACKEND-SPEC.md is a SIMULATED DRAFT (fictional customers
  and policies, banner on file); headless/structural checks are not
  visual proof; nothing is done before Zack's customer walk; never
  invent prices/cancellation/domain policies/product boundaries; no
  push, deploy, or payment path for anything unfulfillable; setup is
  autonomous, Zack is the backstop.
- Edges redline closed: soft = look's own rounding; sharp = square +
  2px; ornate = double page frame + 3px double accent card frames +
  ringed action. Owner has not yet walked them.

## Standing rulings (never drift)

- **Spellings**: Abracadabra (C). **Alakazam with a K** — the early build's
  "Alacazam" is retired everywhere incl. Stripe. Routes/code hooks keep
  lowercase c-aliases; never "correct" the K back.
- **No account = no persistence.** The maker runs on sessionStorage only.
  Close the tab, everything is gone, and the copy says so. Never add silent
  cross-visit memory. WITHIN the tab, made versions now DO survive
  navigation (abracadabra.tabwork key) - required so paying at Stripe
  does not destroy the page being paid for. Same-tab restore is not
  cross-visit memory; a new tab always starts cold.
- **ACCOUNT BEFORE PAY (2026-08-01)**: "you have to make an account right
  before you pay... or in the same sweep. No way should you be able to
  download without having an account." The $5 press opens the account
  panel (email -> Create my account & pay $5, one sweep) and goes on to
  Stripe; the download button refuses without an account and offers the
  claim panel. Browser account v1: localStorage abracadabra.account +
  .account.work - work and unlock ride the account across tabs in this
  browser; abracadabra-account.js loads BEFORE the app and seeds the tab.
  Free with no account stays tab-only (the original ruling). Server
  accounts + operator back end = task #21; the sim workflow feeds it.
- **The gate ladder**: FREE = make + preview (Crystal/Hearth/Midnight).
  **$5 Download** = the file (the browser prototype currently uses
  `?paid=1`) + the style kit (6 accents, type pairing, edges) + it UNLOCKS the
  Go-live door and doubles as the $5 credit toward Alakazam. **$25/month** =
  the hosted `sitesourcery.me` address + three base looks. **$35/month** adds
  photo header, expanded fonts, section toggles, three-version history, and
  modest care. **$50/month** adds the richer customization bundle including
  Cash App/Venmo links, a menu, further font/border controls, and more care.
  Upgrades are difference-only: $5 -> $25 costs the remaining $20, $25 -> $35
  costs $10, and $35 -> $50 costs $15; never stack two full tier charges.
  Locked options may ONLY be shown as a teaser — and only if that exact paid
  entitlement makes them genuinely render. Browser redirect flags are test
  bridges, not subscription authority.
- **Looks**: labels Crystal / Hearth / Midnight (values clear/warm/arcane
  stay internal). The sample loader must NEVER override the chosen look.
- **Nav (all pages)**: ABRACADABRA · ALAKAZAM / SORCERY / THE RESPONDER /
  SPELL BOOK / ABOUT + phone pill. Menu words are the brand system.
- **Voice**: first person always (no "Zack does X"), US spelling
  (customize), centered text, minimalist, nothing explained twice, every
  card demos itself where possible. House style = home-hero frost pools,
  gold coins/rings, glass panels, storm background.
- **Responder**: $300 + $250/mo, in person only, never a site checkout.
- **AUTONOMY RULING (2026-08-01, supersedes the personal-setup copy)**:
  "They're not supposed to have to reach me to set everything up
  personally... Things are supposed to be done almost autonomously."
  Abracadabra and Alakazam run themselves: pay -> account -> page live ->
  address wired. Zack is the one-call-away BACKSTOP for snags, never the
  stated mechanism. All "I set you up personally" mechanism lines are
  purged from the app; the lane page, FAQ, and includes-adjacent copy get
  the same sweep during their walks. The provisioning pipeline (rent
  subdomain auto-live, buy-domain auto-DNS, bring-your-own wizard) is
  task #21 scope alongside accounts + operator back end.
- **The hero names the room**: /abracadabra/app/ shows "Abracadabra"
  during the ritual and "Alakazam" in the kept room (mint-metal title,
  mint chamber cast via .ss-keep-room). Only the LANE page (/abracadabra/)
  wears "Abracadabra Alakazam". A paid/live tab with no work lands in the
  EMPTY Alakazam room (vessel panel + one door into the ritual), never on
  the wizard.
- **Push gate**: owner will push only a "real, working, comprehensible,
  logical" site. The exact candidate branch is now pushed and its explicit
  hosted artifact allowlist is proven on isolated HTTPS staging. Live
  `sitesourcery.com` still runs the old GitHub Pages build; production cutover
  has not happened. Static deployment must still publish only the generated
  artifact, never `/server/`, `/scripts/`, `/ops/`, `BUILD.md`, or
  `node_modules`.

## Money rails (all live, count pinned at 5 by the checker)

- $5 Abracadabra download — buy.stripe.com/8x2cN7e9y0wu6OW4fO7kc00 →
  redirects to /abracadabra/app/?paid=1 (live domain).
- $25/mo Alakazam hosting — buy.stripe.com/9B65kF0iIgvseho9A87kc01 →
  redirects to /abracadabra/app/?alakazam=1.
- $35/mo and $50/mo Alakazam — owner-approved product levels, but no Stripe
  Price/Payment Link or operational rail exists yet. Keep held until the exact
  support limits and the complete backend/customer behavior are reviewed.
- $200 assessment — bJe4gB8Pe5QOb5cdQo7kc02.
- $40/yr .com — dRm9AV0iIfroddk5jS7kc03. $45/yr .net/.org —
  cNi7sN8Pegvs7T07s07kc04 (price_1TzP2pPi1bfFonRcLOug1Xnb).
- Credits ($5 and $200) are applied BY HAND — site says so; webhook later.

## Open decisions (OWNER's — ask, don't assume)

1. **Production deploy target**: isolated staging is resolved on Zen. The
   Dell/HQ now hold the exact immutable production rehearsal, separate clean
   database, restart-proof services, and validated pinned Caddy binary/config.
   Public ingress remains blocked: Dell's ordinary user cannot bind 443, UFW is
   active, and an external IPv4/IPv6 probe could not reach an empty high-port
   listener. One reviewed root/network pass must install the Caddy system unit,
   allow 80/443, and establish/prove router IPv4 forwarding plus the IPv6
   firewall path before any DNS change. Encrypted off-machine backup/restore,
   daily scheduling, recovery supervision, and reviewed owner alert delivery
   are now proven and must not be repeated as open work. The remaining
   production-target blocker is the public ingress/TLS path and its later
   same-origin customer journey, not continuity. This blocks replacing GitHub
   Pages, not branch or rehearsal work.
2. **Homepage favicon**: every page has the gold-star favicon EXCEPT home
   (his design-lock); needs his one-line ok.
3. **Alakazam care boundaries and final control matrix**: prices and the main
   feature ladder are decided at $25/$35/$50. Still owner-open: exact support
   minutes or edit counts, response promise, what consumes care, cancellation
   and refund handling, and the final fine-grained font/border difference.
4. **Customer-owned/custom-domain treatment in Alakazam**: $25 now resolves
   the hosted `label.sitesourcery.me` price. Still decide whether bringing or
   buying a separate domain changes setup price, monthly level, ownership, or
   care; do not silently treat those as the same product.
5. **/custom/scope/ + /custom/process/ fold into /custom/** — proposed,
   approved in spirit, executes during the Sorcery walk.
6. **Accounts: DECIDED, staged, not open** (2026-08-01). Founder order, his words:
   "Clients need accounts, and we need a client account back end created
   also because we are the site provider... if they call me for help...
   Accounts are needed." And: "The point is to make the account part
   real. We're trying to be in business here." The canonical Node/PostgreSQL
   account, organization, project, draft, version, recovery, and held-quote
   path is now real and proven on HTTPS staging. Remaining task #21 scope is
   production operation, payment-backed entitlements, and the operator/HQ
   client-services view; do not rebuild those as another backend. Lesson
   recorded: when he dictates copy naming something unbuilt, that is a
   BUILD ORDER for the thing, not a wording problem - build the closest
   true version immediately and say what remains, never water down his
   words with disclaimers.
7. Homepage nits he may or may not want: lede spacing ("$5-Custom"),
   no name/face/proof on page (review nits; homepage is HIS locked design).

## Owner's own errands (remind, don't nag)

- Verify Spaceship wholesale costs (price book keeps costsConfirmed:false).
- Start Twilio A2P 10DLC registration (3–6 week clock; Responder blocked
  on it).
- After push: make one real $5 self-purchase as the first production test
  (self-refund; Stripe keeps ~fixed fee only).

## Walk state (task #17)

DONE and owner-approved: homepage (locked), /abracadabra/ lane page
(incantation home-hero certified zero-diff by computed-style tool; altar
vessel; medallion CLICK TO CONJURE; whole box clickable), the maker
(4 steps Look-first, gate ladder, blob previews so in-page links work,
sessions only, Crystal/Hearth/Midnight, includes-modal, versions panel
hidden — engine kept for tier era).
NEXT: Sorcery (/custom/) with the same knife, then Responder, Spell book
(/work/), About, Contact, FAQ, Legal, Domains-page polish. CLOSED since
first writing: /abracadabra/how/ stubbed; maker phone-swept clean at
320/390/480 (rail folds 2x2); Open-working-preview verified post-blob;
Midnight recolored navy; post-pay round done (owner: extras were
pick-blind on Look, post-pay looked identical to free): style kit moved
to the Preview room with an Apply-the-style press, attestation digest
covers claims only (accent/type/edges stripped; payment handles stay),
makePreview compiles the attested facts DRESSED with current garments
(was compiling frozen reviewedRaw - style could never change post-review),
paid/live state chips under the title (frosted), gate intro swaps per
state, ss-paid/ss-live root classes. THEN the KEEP ROOM (owner: "the
Alakazam should not look like the abracadabra... why would we go back
through steps 1-4"): made versions persist per-tab and survive the
Stripe round-trip (they previously did NOT - a payer returned to an
empty step 1); with work + paid the room drops the wizard rail and
lands on "Your page." (live: "Your page — Alakazam keeps it."),
restore re-arms the attestation so the style kit works post-return,
boot toast yields to the welcome-back status, edit doors bring the
rail back only inside the ritual, and THE ADDRESS hunt (the /domains/
checker script + markup, one truth, absolute paths) sits in the gate
between Go-live and the includes modal, paid-gated with a teaser.
Entitlement script announces abracadabra:entitlements; the app
re-dresses on it (script-order race otherwise). Still open by design: the three base looks'
DEPTH pass ("samples are basic and lame"). Base-look quality belongs to all
three Alakazam levels; paid tier controls must not be used to excuse a weak
base design. The additional $35/$50 controls remain task #20 work.

## Tooling (all in scratchpad, session-portable patterns)

- snap.mjs URL W H scrollY — CDP frames (port 9223).
- hero-diff.mjs — computed-style diff between two pages' heroes; zero
  output = certified match.
- sweep-widths.mjs — every route × 320/390/480, overflow + menu button.
- reseal-v2.mjs — truth-slot manifest reseal; the checker VERIFIES seals,
  so run it after editing sealed regions (app hero/save-gate, legal).
- scripts/check-site.mjs — routes, nav, links, anchors, prices vs catalog,
  canonicals, resource resolution, og assets, rails===5, seals, sitemap.
- Headless gotchas learned: window.confirm freezes headless (stub it);
  /json/new?URL + heavy multi-tab probes flake — single tab + race guards;
  srcdoc iframes mispaint on reassignment and mishandle anchors (hence
  blob previews).

## Incident ledger (so mistakes stay learned)

- Fabricated Stripe ID (caught, replaced) — never invent identifiers.
- K-sweep missed metas and .js strings first pass — sweeps must include
  meta content and scripts.
- "Cache" blamed twice for real bugs (boot setStep, validation trap) —
  verify server-side truth before blaming the owner's browser.
- Room landing relied on an inter-script event; headless probes won the
  race every run, the owner's real Chrome lost it (wizard + live chip).
  Handshakes may re-dress a room, never decide a landing - each script
  reads durable truth (URL params + sessionStorage) itself.
- The plain python http.server let Chrome heuristically cache stale JS
  during walks - the dev server is now serve-nocache.py (scratchpad),
  Cache-Control: no-store on 127.0.0.1:8899. Restart THAT one, not
  http.server, after reboots.
- text-wrap is half of white-space shorthand; !important archaeology bit
  three times — prune, don't stack.
- A probe hex must be unique to the claim: #275bd6 is BOTH the ocean
  accent AND Clear's baseline --accent, so the first Apply test passed
  vacuously. Plum #7a4fc0 exists only in the kit - probe with that.
- sessionStorage.clear() + navigate is NOT a cold-tab test once
  beforeunload resaves - only a genuinely new tab is cold.
- drive-keeproom.mjs (scratchpad) drives the whole pay journey:
  build, pay-return, refine, edit door, alakazam, cold tab, account
  guard/carry/pay-sweep.
- Chrome fieldset quirk: display:none on the FIRST block after a
  <legend> zeroes the next sibling's width (toolbar collapsed to 0,
  status text went vertical). Collapse in flow instead
  (visibility:hidden;block-size:0). Found by git-bisecting the burst.
- Author CSS `display` on an element DEFEATS the [hidden] attribute
  (UA display:none loses) - the no-page panel rendered above a real
  page. Always pair a panel's display rule with [hidden]{display:none},
  and assert PAINTED state (computed display), never the attribute.
- ROOMS RULING (owner, same night): the $5 payer is still in
  ABRACADABRA's room (gold, PAID coin). Only ?alakazam=1 wears the
  ALAKAZAM emerald-metal hero + green ACTIVE coin (.ss-keep-room is
  live-only). Kit applies IN PLACE (styleOnly replaces the current
  version; no stack, no form refill, no focus jump). Gate has ONE
  heading (kicker deleted). ops/OPERATOR-BACKEND-SPEC.md = the
  6-call simulation's draft spec for task #21.
