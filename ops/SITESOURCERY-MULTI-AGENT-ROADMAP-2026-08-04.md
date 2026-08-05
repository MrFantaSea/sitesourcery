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

## Two-lane completion mode

From August 5 forward, unfinished Site Sourcery work moves through two
coordinated lanes instead of one long serial queue:

### Build lane

The Build lane owns durable authority: account identity, PostgreSQL state,
quotes, invoices, provider-confirmed payments, jobs, subscriptions, publication,
monitoring, recovery, owner operations, migrations, routes, and integration
tests. It works in vertical customer outcomes, not disconnected tables or UI
stubs.

### Polish lane

The Polish lane owns customer comprehension and proof: offer hierarchy, copy,
scope boundaries, legal consistency, responsive/account/owner interfaces,
accessibility, failure language, device walks, and launch evidence. It may audit
or design ahead of the Build lane, but it cannot publish, enable, or imply a
promise until the matching durable journey is green.

Both lanes share one commercial contract, catalog lineage, route/state names,
and finish line. Each batch closes only when Build truth and Polish truth agree.
The lanes never implement competing pricing, account, invoice, job, care,
domain, or publication systems.

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
- [x] Complete the Custom/existing-site CHANGE / REMOVE / HOLD / KEEP audit
  against the August 5 commercial contract.
- [x] Map one comprehensible account-first customer journey across assessment,
  onboarding, quote, invoice, job, management, and receipts.
- [ ] Identify and remove every duplicate service name or double-charge path
  before public copy is changed.

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
- [x] Customer-safe downgrade scheduling action and renewal review.
- [ ] Billing Portal and exact cancellation preview/confirmation.
- [ ] Stable retry, replay, and reconciliation states in the account UI.

### Lane F — tier fulfillment and publication

- [x] `$25` backend authority: exact accepted source, active subscription
  revision, licensed `sitesourcery.me` address, three base looks, deterministic
  compilation, queue, screening, publication, replay, and dark compensation.
- [x] `$25` held customer path: choose the platform label and base look, expose
  fulfillment status in the account, and prove the authenticated desktop/mobile
  browser journey. Provider release and production cutover remain Lane J.
- [ ] `$35`: photo header, expanded fonts, section toggles, three-version
  history, and owner-defined modest care.
- [ ] `$50`: Cash App/Venmo, menu, extended font/border controls, and
  owner-defined additional care.
- [x] Backend compiler policy preserves configured facts while lower tiers
  cannot render premium output; canonical `$50` authority alone enables the
  currently implemented Cash App/Venmo fields.
- [ ] Prove customer read/edit behavior for retained premium configuration as
  the `$35/$50` controls are implemented.
- [x] Publish an exact policy-derived artifact bound to the accepted source;
  prove exact-byte replay, rollback, unpublish, and dark compensation at the
  publication boundary.
- [ ] Expose only the safe customer-authorized publication/rollback/unpublish
  controls selected for launch.

### Lane G — lifecycle and reconciliation

- [x] Inventory current event routing, schema capacity, missing transitions,
  unsafe legacy-policy inheritance, owner-open decisions, and disjoint slices.
- [ ] Renewal success and new period projection.
- [ ] Payment failure, past-due, grace, suspension, and restoration.
- [ ] Period-end cancellation and retained export.
- [ ] Defensive refunds/disputes without a customer refund offer.
- [ ] Owner-only reconciliation for genuinely uncertain provider effects.

### Lane H — custom services and owner workbench

- [x] Freeze the August 5 Custom/existing-site commercial contract, including
  paid outside-site onboarding, account-before-pay, pricing, stacking, and
  held decisions.
- [x] Reconcile stale catalog authority: the assessment is `$200`, its maximum
  build credit cannot remain `$350`, and obsolete exact Custom Care prices must
  not become public or payable.

Account and site authority:

- [ ] Require a Site Sourcery account before quote acceptance, payable invoice,
  payment, private access request, job, or support ticket; keep a simple
  anonymous inquiry path.
- [ ] Add one customer-owned site asset with origin `alakazam`,
  `sitesourcery_custom`, or `external`, plus platform, public URL, ownership,
  supportability, and delegated-access state.
- [ ] Prove cross-tenant/site denial and browser inability to claim price,
  payment, credit, unit, job, or provider authority.

H1 pre-commerce foundation checkpoint:

- [x] Add migration 34 as an additive, retained custom-services namespace;
  preserve the canonical account, organization, project, catalog, and legal
  roots instead of creating a parallel customer system.
- [x] Bind every customer request write to an exact transaction-local customer
  and organization plus active account, membership, organization, and project
  truth; prove missing, stale, cross-user, and cross-tenant denial.
- [x] Store external-site request facts in bounded typed fields with
  database-owned revision, timestamps, and digest; accept no open customer JSON
  or caller-authored digest authority.
- [x] Keep operator, document, delegated-access, quote, invoice, payment, job,
  report, and credit authority held; grant no service-role DELETE/TRUNCATE and
  use no cascading deletion for the new retained records.
- [x] Verify the exact held `$200` assessment policy, legal digest, scope,
  forced RLS, minimal privileges, and runtime marker during production
  readiness—not merely the existence of table names.
- [x] Replay all 34 migrations from zero and pass maintained structural,
  repository, real-PostgreSQL adversarial, core, hosted, self-host, operations,
  and site regressions; drop and verify the disposable database absent.
- [ ] Connect anonymous inquiry/claim and the customer account request surface
  to this authority.
- [x] Add exact versioned standard-assessment quote and account-bound
  acceptance authority with immutable scope/money/legal digests, current
  profile/intake binding, operator grant/revoke evidence, minimal privileges,
  fresh-PostgreSQL adversarial proof, and no provider effect.
- [x] Connect one authenticated, project-bound, held-by-default customer read
  route to the canonical PostgreSQL account, site profile, case, offering, and
  latest-intake authority; expose no commercial or operator authority.
- [ ] Add invoice, held payment reservation, tax/provider dispatch,
  settlement, job/report, and one-use `$200` credit migrations and services
  before any payment or public release.

Assessment and findings:

- [ ] Implement the bounded `$200` assessment: one site, up to five
  representative public pages/page types, phone and desktop, up to ten
  prioritized findings, evidence, delivery, and expanded-assessment hold.
- [ ] Implement one-use, same-project, 90-day Custom base-build credit and
  separately record reused scope so overlapping work is not billed twice.
- [ ] Let the customer read the delivered report and select safe findings for a
  later fixed Rescue quote; do not turn report findings into automatic charges.

Paid outside-site onboarding and management:

- [ ] Implement mandatory staged onboarding: `$200` supportability/takeover
  review first; charge the remaining `$100` simple/static or `$400` ordinary
  CMS onboarding balance only after acceptance; complex onboarding is quoted
  from `$900`.
- [ ] If Site Sourcery declines the outside site, deliver the paid written
  result and safer next options without starting or charging monthly service.
- [ ] Establish client-owned/delegated access, supportability, baseline backup
  where possible, monitoring, critical-backlog gate, and first monthly record.
- [ ] Implement monthly bases of `$125` simple/static, `$225` ordinary CMS, and
  custom from `$400` for commerce/membership/custom systems, billed in advance.
- [ ] Implement optional two-unit `$250` and four-unit `$500` monthly capacity,
  usage, one-cycle rollover cap, tickets, an explicitly owner-approved response
  promise (currently held), renewal-bound plan changes, and no implied 24/7
  emergency response.
- [ ] Keep Outside Website Management, Custom Care, and Alakazam tier care
  commercially distinct while reusing one ticket/capacity/receipt engine.

Quotes, invoices, and jobs:

- [ ] Add a versioned service catalog with fixed, banded, custom, recurring,
  prerequisite, exclusion, provider-cost, and overlap-key rules.
- [ ] Implement internal `$125` repair units with a `$250` Rescue minimum,
  shared-root-cause deduplication, selected findings, fixed customer-facing
  line items, and repair-versus-rebuild review above eight units.
- [ ] Implement versioned estimate/quote, disclosure, expiry, acceptance,
  assessment credit, scope reuse, and change-order authority.
- [ ] Implement invoice, deposit/milestone/balance, provider-confirmed payment,
  receipt, retry, replay, and uncertain-payment reconciliation.
- [ ] Implement job, checklist, dependency, safe access request, evidence,
  deliverable, completion, 30-day workmanship correction, and final handoff.

Five existing-site revenue lanes:

- [ ] Website Rescue and Tune-Up from selected paid findings.
- [ ] Outside Website Management after mandatory paid onboarding.
- [ ] Business Email and Domain Connect `$200`, Move from `$500`, and Rescue
  investigation `$300`, reusing the existing connection component.
- [ ] Website Move / Platform Escape as assessment + `$500` transition base +
  existing build/redirect/migration/connection components.
- [ ] Local Presence: `$400` Website Visibility Foundation, `$300` Google
  Business Profile setup/cleanup, `$650` combined, plus reviewed page/location
  bands and no ranking/indexing/lead guarantee.

Customer and owner surfaces:

- [ ] Add customer account views for assessment/onboarding result, quote,
  acceptance, invoice, payment, job, access request, change order, handoff,
  management plan, capacity, ticket, monthly receipt, and safe recovery state.
- [ ] Add Mac/Pixel owner search and bounded operations for client/site,
  findings, quote composition, invoice, payment evidence, job, access,
  management, monitoring, backup, ticket, and reconciliation; no casual
  mark-paid or grant-service button.
- [ ] Prove every journey against fresh PostgreSQL, provider test mode where
  applicable, authenticated desktop/mobile browser, replay/race/failure cases,
  and exact customer-safe projections.
- [ ] Later expose these same contracts to Fantasealand Desiderata Labs HQ;
  HQ must not become a second authority.

### Lane I — domains and deferred offers

- [ ] Finish registrar authority, availability recheck, capture-after-
  registration, DNS, renewal, and transfer proof.
- [ ] Remove the obsolete charge-then-refund promise.
- [ ] Reconcile separate Custom care plans.
- [ ] Keep the held domain storefront separate from paid email/domain
  configuration, migration, and recovery work.
- [ ] Keep The Responder unsellable until telephony fulfillment is real.
- [ ] Do not let these expansion items block platform-subdomain launch.

### Lane J — release and proof

- [ ] Reconcile all public copy, links, legal text, support, and pricing.
- [ ] Replace direct assessment payment with account-bound offer, invoice, and
  payment; show its exact five-page/ten-finding boundary and expanded hold.
- [ ] Add one restrained "Have a website already?" section for the five
  existing-site lanes instead of five or ten competing top-level navigation
  entries.
- [ ] Publish only approved starting prices and plain exclusions; explain that
  services stack without charging the same inventory, DNS, backup, redirect,
  search, or onboarding work twice.
- [ ] Reconcile public terms for paid onboarding, payment milestones,
  workmanship corrections, outside management, plan changes, provider costs,
  and lawful cancellation without advertising a blanket refund promise.
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

Account + site asset
  -> paid assessment or outside-site review
    -> findings/supportability
      -> deduplicated quote + acceptance
        -> invoice + provider-confirmed payment
          -> job/onboarding + evidence
            -> handoff or monthly management
              -> customer/owner receipt + recovery

Lane H Build truth ───────────────┐
                                  ├─> private end-to-end service walks
Lane D/J Polish truth ────────────┘
```

## Parallel batch ledger

| Batch | Lane | Owner | Write scope | State |
| --- | --- | --- | --- | --- |
| 1 | Architecture and billing projection | Lead | roadmap, hosted read model/API, integration tests | reviewed; real PostgreSQL and broad regressions green |
| 1 | Customer account surface | UI worker | `abracadabra/app` client/DOM/tests only | receipt/credit drift corrected; final browser runtime green |
| 1 | Stripe configuration boundary | Provider worker | hosted Stripe configuration/tests only | reviewed; 12/12 focused green; release held |
| 1 | Public truth audit | Audit worker | read-only report to lead | accepted; launch gates recorded below |
| 2 | Billing commands | Lead plus bounded workers | start, upgrade, and downgrade customer flows reviewed; browser and broad regressions green; release held |
| 2 | Fulfillment feature matrix | Fulfillment mapper | inventory complete; implementation held behind billing route slice |
| 2 | Lifecycle projection | Lifecycle mapper | inventory complete; renewal-success implementation waits for current route slice |
| 3A | Fulfillment backend | Lead plus bounded compiler worker | migration 32, exact tier authority, three looks, queue, compilation, self-host publication, replay, and compensation reviewed; fresh PostgreSQL and broad regressions green; release held |
| 3B | Customer fulfillment path | Lead owns account/repository/HTTP contracts; UI worker owns browser files; read-only auditor checks stale/race truth | platform-label/look controls, account status, authenticated browser journey | reviewed and sealed locally; fresh PostgreSQL, shipped-browser, and broad proof green; release held |
| 3C | Tier-transition fulfillment | Lead | migration 33, upgrade/downgrade enqueue, exact-revision republish, account/write fencing, replay, fresh PostgreSQL, and broad proof | reviewed and sealed locally; release held |
| H0 | Custom/existing-site commercial freeze | Lead | canonical contract, master roadmap, continuity ruling, catalog-conflict list | reviewed; no public or provider effect |
| H0 | Build-lane backend inventory | Bounded build worker | one new read-only-derived backend inventory report | completed and reviewed; no implementation-file writes |
| H0 | Polish-lane public audit | Bounded polish worker | one new CHANGE/REMOVE/HOLD/KEEP report | completed and reviewed; no public-copy writes |
| H1A | Custom-services pre-commerce foundation | Lead plus bounded read-only review and Polish lane | migration 34, exact held assessment policy, actor-bound request state, typed intake, minimal grants, readiness, clean-room PostgreSQL and broad proof | reviewed and sealed locally; payment and release held |
| H1B | Assessment quote and acceptance authority | Lead plus bounded readiness and customer-projection workers | migration 35, deployment-controlled operator grants, immutable exact `$200` revisions, named scope, account-bound acceptance, clean-room PostgreSQL and broad proof | reviewed and sealed locally; invoice, payment, job, report, credit, and release held |
| H1C | Authenticated custom-services account read | Lead plus bounded PostgreSQL adapter worker | exact customer/project scope, read-only canonical repository, customer-safe projection, same-origin GET, production composition, real PostgreSQL and broad proof | reviewed and sealed locally; writes, commerce, public copy, and release held |

## Immediate integration target

Batch 3C, H0, H1A, H1B, and H1C are sealed. Continue Lane H1 as one vertical
customer outcome: anonymous inquiry/claim + activated account + a
customer-owned external-site request + exact accepted `$200` assessment quote
+ held invoice/reservation + provider-confirmed payment + job/report delivery
+ exact one-use `$200` Custom build credit. Migrations 34 and 35 supply the
safe request and accepted-quote authority only; they deliberately supply no
invoice, payable tax total, provider dispatch, payment, job, report, or credit.
Do not widen legacy Download, Alakazam, domain, or old Spark billing tables
into a pretend generic commerce system.

The Polish lane may prepare private copy and responsive-state matrices in
parallel, but no new service becomes publicly payable until the matching
account, quote, invoice, provider-confirmed payment, job/report, credit, owner
operation, and fresh-PostgreSQL/browser proof are green.

## Frozen Batch 3A fulfillment backend contract

- A start Checkout freezes one prepared intent only after an accepted source
  version and configured platform address exist. A definitely unsubmitted
  Checkout failure supersedes that intent and removes its prepared projection;
  ambiguous provider effects remain reconciliation-only.
- Activation queues one semantic operation bound to the exact active
  subscription revision. Worker replay returns the same operation and cannot
  publish a second release.
- The customer-accepted source and deterministic policy-derived artifact are
  separate evidence. Publication requires exact digests and compiler
  identities for both, exact screening and release-request bindings, the
  licensed address, and current effective tier authority.
- Crystal, Hearth, and Midnight are the three canonical base looks. `$25` and
  `$35` mask unresolved premium output while preserving configured facts.
  Canonical `$50` authority enables only the implemented Cash App/Venmo output;
  no policy invents an unimplemented feature.
- The worker and Alakazam webhook composition remain held by explicit release
  capability. If publication succeeds but durable finalization fails, the
  runtime unpublishes and records dark/retry truth.
- Completion proof: all 32 migrations replay from zero; real PostgreSQL plus
  real self-host journey 5/5; final focused proof 34/34; core 446/446; hosted
  151 pass with 2 intentional environment skips; operations 52/52; self-host
  19/19; current-site, hosted HTML, and exact 78-file public artifact checks
  pass under Node 24. The named disposable database was idle, dropped, and
  verified absent.
- Not included: customer label/look controls, fulfillment account projection,
  browser proof, unresolved `$35/$50` controls, provider release, public copy,
  push, deploy, DNS, or production cutover.

## Frozen Batch 3B customer fulfillment contract

- Existing primitives are mandatory reuse: the Maker creates and accepts the
  exact content/look version; the generic authenticated project command selects
  one licensed `label.sitesourcery.me` address; Batch 3A automatically compiles
  and publishes after payment-backed activation. No shadow project, address,
  version, or publication system may be added.
- Account schema v2 adds one exact customer-safe `site` projection:
  `acceptedVersionId`, `addressLabel`, `hostname`, public `look`, `setupDigest`,
  `state`, `updatedAt`, and `url`. Public looks are `look_crystal` / Crystal,
  `look_hearth` / Hearth, and `look_midnight` / Midnight. Internal theme values,
  artifact bytes/digests, provider IDs, release IDs, leases, and raw worker
  evidence remain server-only.
- Customer site state is exactly `setup_required`, `ready_for_checkout`,
  `payment_pending`, `publishing`, `live`, or `attention_required`.
  Fulfillment `prepared`, `pending`, `live`, `dark`, and `failed` maps to the
  final four states. Without a fulfillment row, readiness is rederived from one
  accepted version plus the current configured licensed address.
- `actions.configureSite` is true only with no subscription and no in-flight
  payment. `actions.start` additionally requires `ready_for_checkout`.
  `actions.changeTier` retains all existing paid/active/no-pending checks and
  additionally requires `site.state === "live"`. The write repository rechecks
  these facts; browser action flags are never authority.
- The browser supplies a setup digest only as freshness proof. The server
  computes it from tenant/customer/project, accepted version and artifact,
  internal look, licensed address, and hostname. A start Checkout requires an
  exact current digest before Stripe; a stale/cross-project digest fails.
  Upgrade Checkout requires `null` and cannot reuse setup proof as tier
  authority.
- The UI displays the already accepted look, lets the customer choose only the
  licensed platform label when needed, refreshes exact account truth after the
  idempotent address command, and discards stale quote/Checkout review when the
  setup digest changes. It shows safe pending/live/attention status and only a
  verified `https://{hostname}/` link when live.
- Publication is automatic. This slice adds no manual publish, rollback,
  unpublish, custom-domain, `$35/$50` feature editor, Portal, cancellation,
  lifecycle, invoice, provider release, push, deploy, DNS, or production
  cutover behavior.
- Completion proof: all 32 migrations replay from zero; the real Alakazam
  lifecycle passes 5/5; the canonical service and shipped-page journey pass
  12/12 on a fresh database; focused browser/API contracts pass 36/36; core
  Node passes 459/459; hosted service passes 154 with 2 intentional skips;
  self-host passes 19/19; operations pass 52/52; exact public/hosted artifacts
  verify; and the browser audit passes 15 routes at three viewports. The real
  account panel saves a unique platform label at 390x844, projects exact
  PostgreSQL address truth and setup readiness, and fits again at 1440x1000.
  All named disposable databases are dropped and verified absent. Provider,
  release, push, deploy, DNS, and production state remain held.

## Frozen Batch 3C tier-transition fulfillment contract

- The completed start fulfillment intent remains the one immutable anchor for
  accepted version, retained configured facts, licensed address, and hostname.
  Upgrade and downgrade fulfillment create no second customer setup authority.
- The existing operation ledger gains only one `tier_transition` kind. Database
  validation requires an exact active subscription revision/tier and a matching
  `upgrade_applied` or `downgrade_applied` event; the existing start contract is
  not loosened.
- Both activation handlers enqueue the transition after atomic local tier
  activation and again on safe applied-event replay. Subscription + result
  revision + operation kind is the semantic identity, independent of newly
  allocated retry IDs.
- Enqueue accepts only a live prior projection bound to the immediately
  preceding revision and prior tier. It records pending truth for the new
  tier/revision while retaining the old release reference until exact
  replacement succeeds.
- The existing worker recompiles the same retained facts under the new policy
  and republishes at the same hostname. Lower-tier compilation masks premium
  output without deleting configuration. Successful finalization advances the
  release and fulfillment projections together.
- Account and write boundaries offer no further tier change until the live
  fulfillment projection exactly matches the current subscription. An
  activation/enqueue interruption projects attention and is repaired by safe
  webhook replay, never by a second billing or publication effect.
- Existing dark compensation remains authoritative after a publication effect
  whose final local commit fails. Premium editors, lifecycle, Portal,
  cancellation, invoicing, domains, provider release, push, deploy, DNS, and
  production cutover stay outside Batch 3C.

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

## Frozen Batch 2D customer downgrade contract

- Batch 2D expands the existing `actions.changeTier` meaning from the sealed
  upgrade-only slice to every now-composed tier direction. It is true only for
  one active, paid, non-cancelling subscription with a current period and no
  pending change, when at least one different canonical tier exists. `$25`
  offers higher tiers, `$35` offers lower and higher tiers, and `$50` offers
  lower tiers. Start, Portal, and cancellation remain separate actions.
- Runtime authority remains separate from account eligibility. The quote route
  may be available while Checkout or downgrade scheduling is held. The browser
  requires `alakazamCheckout` for start/upgrade and a distinct
  `alakazamDowngrade` capability for a downgrade Schedule command; it never
  substitutes one effect for the other.
- The existing quote route accepts only a lower canonical `targetTierId` plus
  route, CSRF, and stable UUID command identity. A valid downgrade quote must
  match the latest account and catalog exactly: `changeKind: downgrade`, lower
  rank, current-tier disclosure binding, `appliedValue: none/$0`, `$0` due now,
  `$0` cash refund, no provider proration, current tier kept through the full
  paid period, effective time equal to that period's end, and full lower-tier
  monthly renewal at that same boundary.
- The review must plainly show the current tier and paid-through date, selected
  lower tier, `$0` charged now, `$0` refunded now, no mid-period proration, the
  exact lower monthly renewal, boundary date, and quote expiry. The customer
  must freshly accept those exact terms before scheduling. No payment page is
  opened for a downgrade.
- The schedule route accepts only the route quote identity, exact quote digest,
  accepted disclosure digest, CSRF proof, and stable UUID idempotency key. The
  hosted response exposes only customer-safe command, project, quote, current
  tier, target tier, effective time, and scheduled state; provider Customer,
  Subscription, Price, and Schedule identifiers stay server-only.
- A retry with the same quote remains one durable scheduling effect. Repository
  claim and lease state prevent a second provider Schedule. Provider ambiguity
  is readback-only; absent exact readback it becomes reconciliation-required,
  never an invented success and never a fresh Schedule mutation.
- Scheduling does not change current entitlement. The refreshed account must
  continue to show the current tier through `currentPeriod.endsAt`, project the
  pending lower tier and lower next renewal, and expose no second tier action.
  Only the already-proven boundary Subscription event/readback plus atomic
  local activation changes tier authority.
- This slice adds no cash refund control, immediate downgrade, cancellation,
  Billing Portal, feature grant, provider release, publication effect, or live
  configuration. Historical receipts remain unchanged because a downgrade has
  no payment now. Tier fulfillment remains Lane F.
- Completion proof: focused customer/backend boundaries pass 101/101; the
  fresh 31-migration PostgreSQL journey passes 5/5; core passes 439/439;
  hosted service passes 140 tests with 2 intentional environment skips;
  operations pass 52/52; self-host passes 19/19; hosted and 78-file public
  artifacts verify. Chrome 149 passes 10/10 proofs at 1440×1000 and 320×720,
  including a confirmed Schedule followed by a failed account refresh: the
  success remains announced and focused, stale tier controls remain disabled,
  and the recovery retry performs no second write. Eleven screenshots are
  under `/private/tmp/sitesourcery-alakazam-downgrade-browser.lctWsN/`; results
  SHA-256 is
  `447e29b2cb0f8a1b9cd194dc653cccdc96a0427ef17d5a26fc4bb8e08d1d72a6`.

### Deferred Batch 2D polish — non-blocking

- [ ] Decide whether the HTTP command identity should also be passed into the
  quote-bound durable scheduler. Current effect idempotence is already durable
  and quote/application-bound; do not change it casually.
- [ ] Add an application-layer defense-in-depth assertion that a projected
  scheduled downgrade's effective time equals the current-period boundary;
  PostgreSQL already enforces the relationship.
- [ ] Move the successful-schedule/failed-refresh/focus Chrome scenario from
  temporary evidence into a maintained browser harness when that harness is
  standardized. The current source contract, pure projection regression, and
  real-Chrome proof are green.

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
