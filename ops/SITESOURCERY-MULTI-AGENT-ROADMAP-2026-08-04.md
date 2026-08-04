# Site Sourcery completion roadmap and multi-agent workflow — 2026-08-04

This is the canonical execution map for finishing Site Sourcery. It replaces
an isolated-component sequence with coordinated vertical workstreams while
preserving one source of truth, disjoint file ownership, and one integration
lead. Dated owner rulings in `ops/CONTINUITY.md` remain product authority.
Live command, test, worker, and disposable-resource state is checkpointed in
`ops/SITESOURCERY-ACTIVE-RUN.md` so chat compaction cannot become project
memory loss or duplicated work.

## Finish-line definition

Site Sourcery is complete only when every visible promise has one tested
customer journey, matching durable state, owner visibility, truthful failure
and recovery behavior, and a verified production deployment. Historical ideas
that are not fulfillable must be removed, held, or described as quote-only.

The July 22 public release remains the production fallback until the new build
passes the private customer and owner walks. Agents must not push, deploy,
change DNS, open provider effects, or place credentials in source or chat.

## Architecture

```text
Customer web app
  -> same-origin HTTP boundary
    -> project-scoped application services
      -> canonical PostgreSQL authority
      -> reviewed Stripe / Resend / registrar ports
      -> leased workers and reconciliation
  -> customer-safe account projection

Owner Mac / Pixel workbench
  -> owner-authenticated bounded operations
    -> the same canonical PostgreSQL authority
    -> immutable audit and provider evidence
```

Rules:

- The browser sends identity, route-bound IDs, accepted disclosures, and
  idempotency keys. It never supplies money, tier authority, provider IDs,
  entitlement state, or billing dates.
- PostgreSQL is authoritative for customer, project, quote, payment,
  subscription, publication, invoice, and support state.
- Stripe, Resend, and registrar adapters are external rails. Site Sourcery
  owns the business rules, durable ledger, customer experience, and recovery.
- Webhooks are wake-up signals. Provider readback plus one atomic local commit
  establishes authority.
- One customer-safe read projection feeds the browser, Pixel owner view, and
  later HQ integration. No surface re-derives billing truth independently.

## Agent operating model

The lead agent owns shared contracts, database migrations, HTTP route names,
production composition, integration tests, the execution ledger, and commits.
Worker agents receive one bounded packet with an exclusive write set. They do
not edit shared contracts, migrations, release holds, or another lane's files
unless the lead explicitly reassigns ownership.

Each work packet contains:

1. Exact objective and customer outcome.
2. Inputs and frozen contract assumptions.
3. Allowed files and forbidden overlaps.
4. Required focused tests.
5. Completion evidence and changed-file list.

Integration order:

1. Lead publishes or freezes the shared contract locally.
2. Independent lanes work concurrently in disjoint files.
3. Lead reviews each result against the contract and current owner rulings.
4. Focused tests run first; broad core, hosted, operations, and PostgreSQL
   journeys run in proportion to the changed boundary.
5. Ledgers are updated once, then one clean local checkpoint is committed.
6. No next batch starts from a dirty or unexplained integration state.

## Workstreams

### Lane A — customer billing truth and API (lead)

- [x] Define one bounded customer-safe subscription projection.
- [x] Read current tier, status, paid period, renewal amount/date, pending
  change, cancellation state, and receipts from PostgreSQL.
- [ ] Add customer invoice retrieval. The v1 projection exposes only safe
  receipt totals and whether an invoice was recorded; retrieval belongs to a
  later command/read boundary.
- [x] Bind every read to the authenticated organization and selected project.
- [x] Expose the projection through a same-origin read-only route.
- [x] Prove cross-project and cross-tenant denial.
- [x] Add real PostgreSQL and HTTP contract tests.

### Lane B — customer account experience (parallel)

- [x] Add a client adapter for the frozen billing projection.
- [x] Render current tier, renewal, payment state, and pending change.
- [x] Preserve useful held/empty/error states without inventing authority.
- [x] Keep controls disabled until their exact server commands exist.
- [x] Prove responsive and accessible DOM behavior in isolated Chrome at
  1440px and 320px, including every state, retry, stale-response rejection,
  accessibility-tree semantics, GET-only traffic, and zero overflow using
  contract-valid credit/subscription fixtures.

### Lane C — Stripe Alakazam production bindings (parallel)

- [x] Add held-by-default environment parsing for one Product, three monthly
  Prices, the duration-once $5 Coupon, and restricted Portal configuration.
- [x] Require the complete Alakazam capability set in explicit approvals.
- [x] Bind deployment, livemode, API version, tax mode, return routes, and
  provider IDs exactly.
- [x] In approved mode, reject partial, extra, duplicate, or cross-mode
  configuration. In held mode, ignore every supplied value and forward none.
- [x] Do not add real IDs, keys, network calls, or open a release.

### Lane D — public truth and journey audit (parallel, read-only first)

- [x] Map every visible offer, price, payment link, refund statement, domain
  promise, care promise, and support path to current backend truth.
- [x] Produce an exact keep/change/remove/hold list with file locations.
- [x] Separate launch-critical corrections from later expansion.
- [x] Make no customer-copy edits until the lead accepts the audit packet.

### Lane E — customer billing commands

- [x] Bind exact customer disclosure acceptance into Customer provisioning and
  Checkout reservations before any provider effect; prove it after a fresh
  replay of all 31 migrations.
- [x] Start quote and one-use $5 credit through the held hosted route and
  customer UI, with exact desktop/mobile browser proof.
- [x] Checkout dispatch, accepted-disclosure gate, safe Stripe handoff, and
  refreshed-account return authority.
- [x] Fixed-difference upgrade quote, paid settlement, provider mutation, and
  atomic local application backend.
- [x] Customer-safe fixed-difference upgrade action, quote review, Checkout,
  pending state, and post-application account refresh.
- [x] Renewal-boundary downgrade quote, Schedule dispatch, and atomic
  boundary activation backend.
- [ ] Customer-safe downgrade scheduling action and renewal review.
- [ ] Billing Portal and exact cancellation preview/confirmation.
- [ ] Stable retry, replay, and reconciliation states in the account UI.

### Lane F — tier fulfillment and publication

- [ ] `$25`: `sitesourcery.me` hosting and three base looks.
- [ ] `$35`: photo header, expanded fonts, section toggles, three-version
  history, and owner-defined modest care.
- [ ] `$50`: Cash App/Venmo, menu, extended font/border controls, and
  owner-defined additional care.
- [ ] Retain premium configuration while lower tiers cannot render or edit it.
- [ ] Publish the accepted version, then prove rollback and unpublish.

### Lane G — lifecycle and reconciliation

- [x] Inventory current event routing, schema capacity, missing transitions,
  unsafe legacy-policy inheritance, owner-open decisions, and disjoint slices.
- [ ] Renewal success and new period projection.
- [ ] Payment failure, past-due, grace, suspension, and restoration.
- [ ] Period-end cancellation and retained export.
- [ ] Defensive refunds/disputes without a customer refund offer.
- [ ] Owner-only reconciliation for genuinely uncertain provider effects.

### Lane H — custom services and owner workbench

- [ ] Custom-site intake, client, scope, estimate, and acceptance.
- [ ] Invoice, deposit, milestone, balance, receipt, and job ledger.
- [ ] `$200` assessment delivery and later build-credit tracking.
- [ ] Mac/Pixel client search and account/project/payment/tier/ticket views.
- [ ] Bounded audited repair actions; no casual mark-paid or grant-tier button.
- [ ] Later expose the same contracts to Fantasealand Desiderata Labs HQ.

### Lane I — domains and deferred offers

- [ ] Finish registrar authority, availability recheck, capture-after-
  registration, DNS, renewal, and transfer proof.
- [ ] Remove the obsolete charge-then-refund promise.
- [ ] Reconcile separate Custom care plans.
- [ ] Keep The Responder unsellable until telephony fulfillment is real.
- [ ] Do not let these expansion items block platform-subdomain launch.

### Lane J — release and proof

- [ ] Reconcile all public copy, links, legal text, support, and pricing.
- [ ] Complete mobile, desktop, accessibility, performance, and security audits.
- [ ] Run new and returning customer journeys in private staging.
- [ ] Run owner Mac and Pixel operations journeys.
- [ ] Prove email, Stripe test payments, hosting, support, invoice, backup,
  restore, monitoring, alerting, and rollback.
- [ ] Conduct owner walkthrough and reviewed production cutover.
- [ ] Verify DNS/TLS and post-cutover behavior; retain the old release rollback.

## Dependency map

```text
Lane A billing truth ─┬─> Lane B account UI ─> Lane E commands
                     └─> Lane H owner view

Lane C Stripe bindings ───────────────┐
Lane E billing commands ──────────────┼─> private Stripe journey
Lane F fulfillment/publication ───────┘

Lane D truth audit ─> public corrections ─┐
Lane G lifecycle ─────────────────────────┼─> Lane J release proof
Lane H minimum owner tools ───────────────┤
Lane I launch-critical domain truth only ─┘
```

## Parallel batch ledger

| Batch | Lane | Owner | Write scope | State |
| --- | --- | --- | --- | --- |
| 1 | Architecture and billing projection | Lead | roadmap, hosted read model/API, integration tests | reviewed; real PostgreSQL and broad regressions green |
| 1 | Customer account surface | UI worker | `abracadabra/app` client/DOM/tests only | receipt/credit drift corrected; final browser runtime green |
| 1 | Stripe configuration boundary | Provider worker | hosted Stripe configuration/tests only | reviewed; 12/12 focused green; release held |
| 1 | Public truth audit | Audit worker | read-only report to lead | accepted; launch gates recorded below |
| 2 | Billing commands | Lead plus bounded workers | start backend and customer flow reviewed; browser and broad regressions green; release held |
| 2 | Fulfillment feature matrix | Fulfillment mapper | inventory complete; implementation held behind billing route slice |
| 2 | Lifecycle projection | Lifecycle mapper | inventory complete; renewal-success implementation waits for current route slice |

## Immediate integration target

Batch 1 ends when a signed-in customer can request one project-scoped,
customer-safe billing snapshot; the account UI can render it without browser
authority; approved Stripe configuration has a complete but still secret-free
environment contract; and the public-truth corrections are prioritized. The
checkpoint remains local and held. All Batch 1 gates are green; the commit
containing this roadmap is its sealed local integration checkpoint.

## Frozen Batch 1 account contract

- Route: `GET /api/v1/projects/{projectId}/alakazam`.
- Authentication and project membership are mandatory at both HTTP and
  application boundaries.
- Schema: `sitesourcery.alakazam-account/v1`.
- Safe fields: held catalog, Download credit availability, current tier and
  price, local subscription/payment state, paid period, scheduled change,
  next renewal, and at most 50 local receipts. Available credit and a projected
  subscription are mutually exclusive.
- Forbidden fields: Stripe Customer, Subscription, item, Price, Checkout,
  PaymentIntent, Invoice, event, and Schedule IDs; raw provider facts; owner
  repair state; credentials.
- At the sealed Batch 1 checkpoint every customer write action remained
  `false`. Batch 2B supersedes only `actions.start` for a project with no
  subscription or pending change; every other action remains false.
- Proof: 11/11 focused account/HTTP tests and 5/5 real PostgreSQL lifecycle
  tests after a fresh replay of all 31 migrations. The named disposable test
  database was idle, dropped, and verified absent after proof.

## Frozen Batch 2A quote and Checkout route contract

- Routes:
  `POST /api/v1/projects/{projectId}/alakazam-quotes` and
  `POST /api/v1/projects/{projectId}/alakazam-quotes/{quoteId}/checkout-command`.
- Both routes require the existing same-origin CSRF proof, authenticated
  session, exact project/customer scope, and UUID `Idempotency-Key` header.
- Quote body accepts only `targetTierId`; the HTTP idempotency key is the
  server-owned `quoteId`. Checkout body accepts only
  `acceptedDisclosureDigest`; its idempotency key is the dispatch command ID.
  Project, quote, customer, organization, money, credit, subscription, tax,
  provider, and billing-date authority never come from the browser body.
- The quote response keeps project/quote identity, catalog and terms versions,
  computed change kind, customer-safe target tier, due-now amount, redacted
  applied value, effective timing, next renewal, downgrade semantics,
  disclosure and both digests. It removes organization/customer identity,
  current local subscription identity, credit entitlement/source IDs,
  provider authorization, and all provider facts.
- The Checkout response exposes only command/project/quote identity, `ready`
  state, purpose digest, HTTPS Stripe Checkout destination, and expiry. It
  removes provider name, Checkout Session ID, Customer ID, and internal
  purpose/provider evidence.
- The default hosted boundary remains an authenticated explicit 503 hold. The
  production composition may wire the real boundary, but the existing
  Alakazam release and provider readiness gates remain authoritative and held.
- The first browser slice uses this contract for starting any canonical
  `$25/$35/$50` tier and displaying the exact `$5` credit result. Upgrade and
  downgrade controls remain disabled until their separate route/UI proofs.
- Backend proof at the connected checkpoint: 26/26 billing/boundary tests,
  7/7 account/HTTP tests, 424/424 broad core tests, and 139 hosted tests with
  2 intentional environment skips and no failures. Provider and public release
  effects remain held.

## Frozen Batch 2B customer start-flow contract

- Account truth exposes `actions.start: true` only for an available project
  with no subscription or pending change. Upgrade, downgrade, Portal, and
  cancellation actions remain false. Runtime capability truth separately
  exposes `alakazamQuote` and `alakazamCheckout` from the hosted billing
  boundary readiness projection.
- Browser API methods send only canonical `targetTierId` or the accepted
  `disclosureDigest`, plus route IDs and a stable UUID idempotency header. No
  browser amount, credit, tax, renewal, customer, subscription, or provider
  authority is accepted.
- The customer panel enables start controls only when both account eligibility
  and quote capability are true. Held mode still shows all three canonical
  tiers but clearly says subscription checkout is not open and nothing can be
  charged.
- A quote is usable only when its exact schema/keys, project, unexpired window,
  catalog/terms versions, `start` change kind, canonical target tier, due-now
  arithmetic, `$5` credit result, renewal, disclosure, and digests agree with
  the latest verified account snapshot. Project/tier/account changes invalidate
  it. No quote or command authority is stored in browser persistence.
- Review shows the selected tier, standard monthly price, applied `$5` credit
  or no credit, amount due now, tax state, next monthly renewal, effective
  timing, and expiry. Checkout requires a fresh explicit acceptance control;
  viewing a quote is not acceptance.
- Checkout reuses one stable command ID across safe retries, must return an
  exact customer-safe result bound to the same project/quote/command, and may
  redirect only to uncredentialed HTTPS `checkout.stripe.com`. Provider IDs and
  raw purpose/evidence never render or persist.
- The first slice accepts only `start` quotes. Upgrade/downgrade responses fail
  closed in this UI until their distinct controls and proofs land. Return,
  settlement, and activation truth comes from refreshed account state, never
  from a success URL alone.
- Completion proof: 24/24 focused browser/API tests and 19/19 focused
  account/HTTP tests pass; the reviewed hosted artifact builds and validates.
  Isolated Chrome 149 passes at 1440×1000 and 320×720 with exact
  `$35 - $5 = $30` first-payment display, `$35` renewal, explicit
  acceptance, stable quote/Checkout retries, malicious-destination rejection,
  quote-expiry rejection before Checkout, safe Stripe redirect interception,
  held-capability zero-write behavior, accessibility semantics, and zero
  overflow. Post-browser regressions are
  427/427 core and 140 hosted pass with 2 intentional environment skips.
  Evidence is preserved in
  `/private/tmp/sitesourcery-alakazam-start-browser.pJSraR/`.

## Frozen Batch 2C customer upgrade contract

- Upgrade eligibility is projected separately from runtime capability.
  `actions.changeTier: true` means only the customer upgrade slice is
  composed: the selected project has one active, paid, non-cancelling
  subscription, no pending change, and at least one higher canonical tier.
  `actions.start`, Portal, and cancellation remain false. A `$50` account,
  pending/attention/ended account, or any account with a scheduled change is
  ineligible.
- The existing quote and Checkout routes remain unchanged. The browser sends
  only the higher canonical `targetTierId`, accepted disclosure digest,
  route IDs, CSRF proof, and stable UUID idempotency keys. It never sends
  current-tier money, difference money, renewal money, subscription identity,
  provider identity, or effective dates.
- The panel offers only higher-ranked tiers: `$25` may review `$35` or
  `$50`; `$35` may review `$50`; `$50` has no upgrade control. No lower
  tier is rendered as an actionable choice in this slice.
- An upgrade quote is usable only when its exact customer-safe schema agrees
  with the latest account and catalog: `changeKind: upgrade`, disclosure
  current tier equals the active account tier, target rank is higher,
  `appliedValue.kind: current_paid_tier`, applied amount equals the full
  current-tier monthly price, due-now subtotal is exactly target minus
  current, no Download credit is present, effective timing is after payment
  and provider confirmation, and the next renewal is the full target monthly
  amount. Expiry, tax, disclosure, digest, project, and command fences remain
  identical to the start flow.
- Review copy names the current paid-tier credit rather than a Download
  credit. It shows the current tier, selected higher tier, exact difference
  due now, tax state, full next renewal, effective timing, and expiry. The
  customer must freshly accept both the difference due now and the new monthly
  renewal before Checkout.
- A paid Checkout or success URL never grants the higher tier. The old tier
  stays authoritative while payment settlement or provider application is
  pending. Refreshed account state may show the pending target; only verified
  Subscription-event readback plus the atomic local upgrade activation changes
  the current tier.
- The existing `noMidPeriodRefundOrProration` field remains the downgrade-only
  paid-period-retention rule: it is false for starts and upgrades and true for
  downgrades. Upgrade no-proration truth is instead bound by the exact fixed
  target-minus-current amount, `disclosure.downgrade.providerProration: false`,
  and the provider adapter's no-proration/unchanged-boundary contract. Customer
  copy says the customer pays only the fixed difference, never a second full
  tier charge; it does not mislabel the downgrade-only field.
- A verified upgrade Checkout settlement is handed directly to the existing
  durable `applyPaidUpgrade()` service by the composed Stripe event router.
  Start settlements never enter that service. Replayed settlement events may
  re-enter the durable application lookup, but an existing application lease,
  provider confirmation, or completed activation prevents a second provider
  Price mutation; uncertain results remain readback-only reconciliation.
- Network uncertainty reuses the same command identity. Invalid or expired
  quote truth requires a fresh quote identity. Provider-effect uncertainty
  remains reconciliation-only and cannot open a second difference payment or
  repeat the Price mutation.
- Checkout claim serializes on the project and rejects every other open quote
  whose dispatch/quote pair is still Checkout-pending, payment-settled,
  provider-change-pending, or reconciliation-required. A settled dispatch
  stops blocking only after its quote is atomically `applied`; therefore a
  stale tab cannot collect a second difference while the old local tier is
  still authoritative.
- This slice adds no lower-tier action, Billing Portal, cancellation/refund
  promise, feature grant, publication effect, provider release, or live
  configuration. Tier fulfillment remains Lane F.
- Completion proof: browser/API contract 8/8; backend focused composition
  110/110; core 434/434; hosted 140 pass with 2 intentional skips; fresh
  31-migration PostgreSQL journey 5/5, including the settled-payment
  second-Checkout fence and later post-activation release; Chrome 149 runtime
  27/27 at 1440×1000 and 320×720 with 0 external responses and 0 unexpected
  errors. Browser evidence is under
  `/private/tmp/sitesourcery-alakazam-upgrade-browser.FSe1PL/` with results
  SHA-256
  `f7204667d2a4736239467e139defd19d6ce87525151f08e2252f948c7ea92c40`.

## Accepted launch-truth gates from Batch 1 audit

The exact accepted source locations and disposition are preserved in
`ops/SITESOURCERY-PUBLIC-TRUTH-AUDIT-2026-08-04.md`.

Keep the real Free → $5 Download account journey, the one-use Alakazam credit,
the inquiry-and-written-quote Custom model, approved Custom starting prices,
the $200 assessment concept with later-build credit, the Proton support path,
and the domain principle that a search reserves nothing.

Before launch:

- [ ] Publish the complete $25/$35/$50 Alakazam ladder and exact
  $20/$30/$45 first-payment credit outcomes.
- [ ] Put Cash App/Venmo only at $50 and limit three-version history to $35+.
- [ ] Replace the `$25 = your own .com` claim with the approved
  `label.sitesourcery.me` platform address.
- [ ] Remove invented cancellation, grace, suspension, retention, deletion,
  and refund language until the owner approves one lifecycle policy.
- [ ] Canonicalize legal/privacy text around real accounts, billing changes,
  publication, support, and all three tiers.
- [ ] Remove five legacy direct Stripe Payment Links and use only
  account-bound server quotes and Checkout dispatch.
- [ ] Replace assessment direct-payment sequencing with intake, written offer,
  account-bound invoice, and payment.
- [ ] Build the minimum Custom estimate/invoice/deposit/milestone/job ledger
  before calling the advertised Custom service fully operational.
- [ ] Hold the domain storefront and remove charge-then-refund language until
  registrar costs and capture-after-registration fulfillment are proven.
- [ ] Hold active Responder sales language until telephony/A2P fulfillment is
  real; do not let it block the platform-subdomain Alakazam launch.
- [ ] Keep browser `localStorage` account and honor-gate prototypes out of the
  production publication artifact.
