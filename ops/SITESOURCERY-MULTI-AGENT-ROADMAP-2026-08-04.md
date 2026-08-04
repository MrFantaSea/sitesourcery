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

- [ ] Start quote and one-use $5 credit.
- [ ] Checkout dispatch and safe return.
- [ ] Fixed-difference upgrade quote and application.
- [ ] Renewal-boundary downgrade quote and scheduling.
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
| 2 | Billing commands | Assigned after Batch 1 contract | disjoint service/HTTP/UI packets | pending |
| 2 | Fulfillment feature matrix | Assigned after projection | compiler/control feature files | pending |
| 2 | Lifecycle projection | Assigned after event inventory | provider event service/tests | pending |

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
- Every customer write action remains `false` with reason
  `customer_commands_not_composed` until Lane E supplies its exact command.
- Proof: 11/11 focused account/HTTP tests and 5/5 real PostgreSQL lifecycle
  tests after a fresh replay of all 31 migrations. The named disposable test
  database was idle, dropped, and verified absent after proof.

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
