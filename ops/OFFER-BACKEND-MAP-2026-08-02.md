# Site Sourcery offer-to-backend map — 2026-08-02

This is the execution ledger for finishing Site Sourcery as a business, not
just as a set of pages. It reconciles the owner's newest rulings, Claude's
2026-08-01 handoff, the public source, and the real `server/hosted` platform.

## Conflict rule

The newest explicit dated owner ruling wins when older drafts conflict. The
current self-service ladder is:

1. Free make and preview.
2. $5 once: account first, then Download for that editor project; no hosting.
3. $25/month: Alakazam hosting at `label.sitesourcery.me`, with three base
   looks.
4. $35/month: $25 plus photo header, expanded fonts, section toggles, three
   saved versions, and modest support/care.
5. $50/month: $35 plus richer customization including Cash App/Venmo links, a
   menu, further font/border controls, and more support/care.

The paid ladder carries value forward. A customer who already paid $5 owes the
remaining $20 to enter $25; moving from $25 to $35 costs the $10 difference;
moving from $35 to $50 costs the $15 difference. The implementation must never
charge two full levels for one upgrade. Upgrades activate after that difference
is paid. Downgrades are scheduled at the current paid period's renewal boundary:
the higher tier remains active until then, no mid-period downgrade refund or
proration is issued, and the next invoice uses the full lower monthly price.
Premium configuration is retained but cannot authorize premium controls after
the lower tier takes effect.

There is no $15 or $30 tier. Exact care quantities, response promises,
cancellation/refund rules, and the last font/border boundary are still owner
decisions; implementation must keep those controls held instead of guessing.

## What exists and what does not

| Customer promise | Customer surface now | Backend/provider now | Exact status | Completion condition |
| --- | --- | --- | --- | --- |
| Free Abracadabra make/preview | Four-step maker and three looks exist | Browser session prototype plus real hosted account/project/version contracts | Partial | One clean unauthenticated preview journey; account handoff preserves the accepted work |
| $5 Download | Hosted account, exact quote, Stripe destination, automatic return confirmation, and entitlement-gated HTML Download are implemented | V2 Checkout dispatch, provider readback, receipt, Stripe Customer binding, project entitlement, artifact verification, and monotonic reversal handling pass fresh PostgreSQL proof | Implementation checkpoint complete; release held | Owner tax choice; real Stripe test payment on private staging; owner walk; reviewed activation/cutover |
| Alakazam $25 | Public copy and an old Stripe Payment Link exist | Held catalog, $5-entry-credit rule, direct Stripe Customer reservation, project-locked quote, no-retry Checkout dispatch, exact payment readback/receipt, and exact Subscription-confirmed local activation now exist; no real three-Price/Coupon configuration or composed customer journey exists | Internal start activation complete; customer fulfillment missing | Real Stripe test Product/Price/Coupon readback; customer composition; automatic `sitesourcery.me` publication; active/cancelled/past-due proof |
| Alakazam $35 | Some candidate style controls exist in the browser prototype | The $25-to-$35 $10-only upgrade is revision-bound, settled once, changes only the existing Stripe item, and now commits its verified-event local tier revision atomically | Internal upgrade activation complete; fulfillment missing | Real provider Price; service/UI rail; feature gates; three-version retention; modest-care accounting |
| Alakazam $50 | Cash App/Venmo and customization ideas exist in old prototype notes | Direct start, fixed-difference upgrade, durable zero-dollar renewal-boundary Schedule dispatch, and exact verified-event lower-tier activation are implemented | Internal downgrade activation complete; fulfillment missing | Real provider Price; service/UI rail; richer controls in generated output; higher-care accounting |
| Customer account | Hosted registration, activation, sign-in, recovery, organization, project, draft, and accepted versions exist | PostgreSQL authority and secure cookies are proven on isolated HTTPS staging; Resend delivery is proven | Real on staging, not public | Public same-origin deployment and post-cutover registration/recovery/project proof |
| Customer billing controls | A narrow account/project/$5 control fragment exists | Billing portal and cancellation primitives exist; exact Alakazam payment/start/upgrade/downgrade webhooks are composed behind a held release | Partial | Controls expose the customer's actual tier, payment state, invoices/receipts, immediate difference-only upgrades, renewal-boundary downgrades, change/cancel actions, and consequences |
| Owner client support | No real owner workbench | Ticket creation and data primitives exist; `ops/OPERATOR-BACKEND-SPEC.md` is explicitly a simulation draft | Missing | Responsive Mac/Pixel owner login; client search; account/project/version/payment/tier/ticket view; audited bounded repair actions |
| Custom Sorcery builds | Public $400–$4,000 ladder and written-quote path exist | `invoice` means Zack manually uses Stripe Dashboard; no invoice composer, estimate acceptance, job, milestone, balance, or client ledger exists | Missing business backend | Owner creates scope/estimate/invoice from Mac or Pixel; customer pays securely; webhook/readback settles deposit and balance; job and audit state remain visible |
| $200 assessment | Public direct Stripe Payment Link exists; report is manually produced | No assessment job queue, customer status, delivery record, or automated $200 build-credit ledger | Sellable manually, not managed | Intake attaches to customer/job; owner queue and delivery; payment/credit/status ledger |
| Domains | Public availability widget and $40/$45 payment links exist; old copy promises a post-charge refund if a name is gone | Extensive authorize-before-register/capture-after-confirmation, order, registration, DNS, renewal, and transfer code exists but provider authority and live cost evidence remain held | Manual/partial, not autonomous; copy/rail conflict | Registrar/cost authority; exact availability recheck before capture; remove obsolete take-money-then-refund promise; registration/DNS/renewal/transfer proof; owner exception queue |
| Separate Custom care plans | Older catalog data contains Host/Care Lite/Care/Care Plus/Partner prices; current Custom page scopes care in writing | No unified care ledger/operator workflow | Product conflict | Decide whether these remain separate custom-site care or are replaced; never merge them silently with Alakazam $35/$50 care |
| The Responder | Publicly described at $300 setup + $250/month | No operational phone/A2P/forwarding fulfillment; deliberately no sellable Stripe price/link | Not fulfillable | Keep checkout closed and make public copy truthful until telephony setup and full customer proof exist |
| Production website | `sitesourcery.com` still shows the July 22 GitHub Pages predecessor | New hosted platform is rehearsed behind held ingress | Not cut over | All public promises reconciled; full customer and owner walks; ingress/TLS/DNS proof; reviewed production cutover |

## Backend truth

Real and staging-proven today:

- Registration, activation, secure sign-in, recovery, organizations, projects,
  drafts, accepted versions, account mail, and the complete held-release $5
  Checkout/settlement/entitlement/return/download path.
- Persistent PostgreSQL services, encrypted backup/restore, monitoring, and
  owner alert delivery for the held production rehearsal.
- The held Alakazam $25/$35/$50 calculation and PostgreSQL evidence contract:
  all 31 migrations replay on a fresh database; one verified Checkout event
  atomically settles a receipt and pending start or provider-change handoff;
  one exact Subscription readback then atomically activates the pending start;
  one paid upgrade application then fences the existing-item Price mutation
  and exact readback without changing the old local tier; one separately
  verified Subscription event then atomically commits the exact target tier,
  revision, quote, application, receipt, and provider evidence; one accepted
  downgrade is durably fenced before Stripe, recovers a known ambiguous
  Schedule by read-only lookup, and atomically records the exact Schedule and
  pending tier event without changing the current entitlement; one later
  verified boundary event and exact read-only Subscription check atomically
  apply the lower tier, new period, Schedule, quote, and revision evidence;
  $25 start, exact $10 $25-to-$35 upgrade, rejection of an unproved mutation,
  paid-period retention, rejection of an early downgrade, and $0/no-proration
  renewal-boundary downgrade pass one focused transaction proof. This is
  local/HQ test proof, not a live provider journey.

Present as substantial code but not a finished product journey:

- Stripe subscription reconciliation, billing portal, cancellation, release,
  publish/rollback/unpublish, addresses, support tickets, and domain
  procurement.
- Exact Alakazam tier/capability/quote calculations and service-only database
  records for subscriptions, Checkout dispatch, provider events, receipts,
  Download credit, downgrade schedules, and revision-bound tier events.
- An optional contract-test Alakazam surface in the existing reviewed Stripe
  adapter. It verifies one active Product, three Product-bound monthly Prices,
  the exact duration-once $5 Coupon, and a Portal configuration that cannot
  change or cancel subscriptions. It creates start/difference Checkouts,
  reconciles provider money, swaps one existing subscription item with no
  proration, and schedules downgrades at renewal without duplicating effects.
- A held-by-default Alakazam billing service plus PostgreSQL quote repository.
  One transaction locks the active project and binds either the current paid
  subscription revision or one unused project Download credit; UUID retries
  replay the first immutable quote and changed purposes fail closed.
- A durable direct-start Stripe Customer transaction. It reserves one
  metadata-only effect before the provider call, reuses an existing
  organization binding, confirms exact provider readback and binding in one
  transaction, and fences interrupted or ambiguous effects without retry.
- A durable start/upgrade Checkout dispatch transaction. It reconstructs one
  exact purpose from the quote, Customer binding, and current subscription,
  leases before Stripe, persists and replays one exact destination, separates
  no-effect failure from ambiguous persistence, and never authorizes an
  automatic second provider effect.
- A held payment-settlement service and atomic PostgreSQL transaction. A
  verified webhook is only a wake-up signal; exact Stripe readback binds one
  Session, PaymentIntent, receipt, and optional Download credit. Start remains
  pending for subscription confirmation; upgrade records one immutable paid
  handoff and leaves the old tier active for the separate provider mutation.
- A held start-activation service and atomic PostgreSQL transaction. A
  Subscription webhook is only a wake-up signal; exact readback must match the
  paid start before one processed provider event, one revision event, the
  active local period, and the applied quote commit together. Active replay
  performs no provider read.
- A held paid-upgrade service and migration-backed provider application. It
  commits one durable idempotency key before mutation, binds the settled
  receipt, existing item, current revision, target tier, and paid period, then
  stores exact target readback. Interrupted or ambiguous work can perform only
  read-only reconciliation; it cannot submit a second Price change.
- A separate held upgrade-activation service and atomic PostgreSQL transaction.
  The verified Subscription event is only a wake-up signal; exact readback
  must still match the paid application before one processed event, one
  revision event, the target local tier, quote, and application commit
  together. Applied replays perform no provider work, including after a later
  tier revision.
- A held downgrade-Schedule service and atomic PostgreSQL transaction. It
  reserves one current-revision purpose before Stripe, keeps the paid Price
  through the exact period end, schedules the lower Price with no proration,
  and records one pending tier event without changing current access.
  Interrupted or ambiguous work cannot submit a second provider mutation;
  only a known Schedule can be reconciled, and that path is strictly read-only.
- A separate held downgrade-activation service and atomic PostgreSQL
  transaction. The verified Subscription event is only a wake-up signal at or
  after the scheduled instant; exact readback must match the Subscription,
  item, Customer, attached Schedule, lower Price, and new period before the
  processed event, lower-tier revision, applied Schedule, and quote commit
  together. Applied replay performs no provider work or identity allocation.
- A single-verification hosted webhook branch. Exact Alakazam metadata routes
  to payment, start, upgrade, or downgrade handling while Download and
  canonical events retain their existing paths. Production composes the real
  repository and provider ports, but the Alakazam release defaults held and an
  approved mode refuses startup without matching tax and provider readiness.

Absent today:

- Pinned live/test Stripe $25/$35/$50 Price authority and the restricted
  one-invoice $5 Coupon.
- Real Stripe test/live Product, $25/$35/$50 Prices, duration-once $5 Coupon,
  restricted Portal configuration, and their reviewed environment bindings.
- Renewal and status-event reconciliation, customer quote/change HTTP
  boundaries, and reviewed production Stripe Alakazam Product/Price/Coupon/
  Portal environment bindings.
- Alakazam customer subscription controls and public provisioning UI/API.
- Owner back office and custom estimate/invoice/job workflow.
- Care accounting and bounded owner repair actions.

## Checkpoint order

1. Finish and prove the current $5 path; record one clean commit. **Complete in
   the 2026-08-02 implementation checkpoint; public activation stays in the
   final release pass.**
2. Redline and implement all three Alakazam contracts without invented care
   quantities; keep activation held where an owner policy is still required.
   **Pure contract, migration 023, revision/evidence guards, fresh migration,
   focused tier journey, full hosted PostgreSQL regression, the held Stripe
   provider contract, the project-locked quote transaction, migration 024's
   one-call direct Customer provisioning transaction, migration 025's
   no-retry start/upgrade Checkout dispatch, and migration 026's verified-event
   payment settlement, migration 027's exact start activation, and migration
   028's no-retry paid-upgrade provider application, migration 029's atomic
   verified-event local upgrade activation, and migration 030's no-retry
   renewal-boundary downgrade Schedule dispatch, and migration 031's atomic
   boundary-event local downgrade activation, plus the held single-verification
   hosted webhook composition, are complete. Customer controls, approved
   provider bindings, broader renewal/status reconciliation, and fulfillment
   remain.**
3. Wire automatic hosted-address publication and customer billing controls.
4. Build the responsive owner client/invoice/support workbench.
5. Reconcile domains, assessment, separate Custom care, and Responder.
6. Run complete release and customer/operator journeys, then stage the owner
   walk and production cutover.

An item is not “working” because a page, table, or handler exists. It is working
only when the customer action, provider effect, durable state, owner visibility,
failure/retry behavior, and tested recovery path all agree.
