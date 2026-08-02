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
| Alakazam $25 | Public copy and an old Stripe Payment Link exist | Generic subscriptions, cancellation, publication, address, and billing-portal primitives exist; no exact $25 product entitlement or automatic customer journey | Missing end to end | Exact subscription contract; automatic $5 credit so entry costs the remaining $20; active/cancelled/past-due behavior; automatic `sitesourcery.me` address publication; customer controls |
| Alakazam $35 | Some candidate style controls exist in the browser prototype | No exact offer, Stripe price, entitlement set, three-version retention rule, care ledger, or difference-only upgrade rail | Missing | Complete reviewed contract and provider price; $25-to-$35 upgrade charges the $10 difference; feature gates; retention enforcement; modest-care accounting |
| Alakazam $50 | Cash App/Venmo and customization ideas exist in old prototype notes | No exact offer, Stripe price, entitlement set, menu/control implementation, care ledger, or difference-only upgrade rail | Missing | Complete reviewed contract and provider price; $35-to-$50 upgrade charges the $15 difference; richer controls render in generated output; higher-care accounting |
| Customer account | Hosted registration, activation, sign-in, recovery, organization, project, draft, and accepted versions exist | PostgreSQL authority and secure cookies are proven on isolated HTTPS staging; Resend delivery is proven | Real on staging, not public | Public same-origin deployment and post-cutover registration/recovery/project proof |
| Customer billing controls | A narrow account/project/$5 control fragment exists | Billing portal, cancellation, subscription/webhook primitives exist | Partial | Controls expose the customer's actual tier, payment state, invoices/receipts, immediate difference-only upgrades, renewal-boundary downgrades, change/cancel actions, and consequences |
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

Present as substantial code but not a finished product journey:

- Stripe subscription reconciliation, billing portal, cancellation, release,
  publish/rollback/unpublish, addresses, support tickets, and domain
  procurement.

Absent today:

- Exact $25/$35/$50 Alakazam offers and entitlements.
- Difference-only ladder credit automation: $5 -> $25 ($20 remaining), $25 ->
  $35 ($10 remaining), and $35 -> $50 ($15 remaining).
- Alakazam customer subscription/provisioning controls.
- Owner back office and custom estimate/invoice/job workflow.
- Care accounting and bounded owner repair actions.

## Checkpoint order

1. Finish and prove the current $5 path; record one clean commit. **Complete in
   the 2026-08-02 implementation checkpoint; public activation stays in the
   final release pass.**
2. Redline and implement all three Alakazam contracts without invented care
   quantities; keep activation held where an owner policy is still required.
3. Wire automatic hosted-address publication and customer billing controls.
4. Build the responsive owner client/invoice/support workbench.
5. Reconcile domains, assessment, separate Custom care, and Responder.
6. Run complete release and customer/operator journeys, then stage the owner
   walk and production cutover.

An item is not “working” because a page, table, or handler exists. It is working
only when the customer action, provider effect, durable state, owner visibility,
failure/retry behavior, and tested recovery path all agree.
