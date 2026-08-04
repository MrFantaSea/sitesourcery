# Alakazam billing and entitlement contract — 2026-08-02

This is the implementation contract for the owner-approved Alakazam ladder.
It is deliberately separate from the obsolete generic Spark tenure draft and
from the one-time Abracadabra Download settlement.

## Product truth

| Tier | Monthly renewal | Included product boundary |
| --- | ---: | --- |
| `alakazam_25` | $25 | Hosting at one `sitesourcery.me` project address and Crystal, Hearth, and Midnight |
| `alakazam_35` | $35 | $25 plus photo header, expanded fonts, section toggles, three-version history, and modest care |
| `alakazam_50` | $50 | $35 plus Cash App/Venmo links, a menu, extended font/border controls, and more care |

There is no $15 or $30 tier. “Modest” and “more” are classes, not invented
minute, edit, or response-time promises. Care fulfillment remains release-held
until the owner approves those quantities and accounting rules.

All three levels include use of the accepted project version, so a hosted
customer is not separately charged $5 merely to retrieve the project that is
being hosted. A separately purchased, active $5 Download entitlement remains
non-consuming and non-expiring; applying its value to the first subscription
does not revoke the Download entitlement.

## Exact money rules

- A customer may start at any of the three published levels. Without a prior
  Download purchase, the first invoice is the full selected tier. With an
  unused active project Download credit, the first invoice is reduced once by
  exactly $5: $20, $30, or $45. Every ordinary renewal is the full selected
  $25, $35, or $50.
- An active paid upgrade charges exactly `target monthly price - current
  monthly price`, independent of the day of the month. Thus $25 -> $35 is $10,
  $35 -> $50 is $15, and $25 -> $50 is $25. The new entitlement activates
  only after the difference payment and exact provider price change are both
  confirmed.
- A downgrade charges and refunds $0 when requested. The current higher tier
  remains active through its paid period. At the existing renewal boundary the
  lower tier takes effect and renews at its full monthly price. Stripe must not
  create a mid-period credit or proration.
- Premium configuration is retained when its entitlement becomes inactive.
  Retention is not permission: lower-tier rendering and controls must ignore
  premium data until the matching tier is active again.
- One project can have at most one live Alakazam subscription and one pending
  tier change. A delinquent, cancelling, or already-changing subscription must
  be reconciled before another tier change opens.

## Provider sequence

### Start

1. Create an immutable server quote bound to account, organization, project,
   selected tier, accepted disclosure, tax mode, and any active unused Download
   credit.
2. Commit one exact quote-bound Checkout reservation before the provider call,
   then create Stripe subscription Checkout for exactly one approved monthly
   Price and the project's canonical Stripe Customer. If the quote includes
   the $5 credit, apply one pinned USD 5, `duration=once` Coupon restricted to
   the Alakazam Product. Do not expose a customer-entered promotion-code field.
3. Treat the webhook as a wake-up signal. Retrieve Checkout, its first Invoice,
   PaymentIntent, Subscription, Subscription Item, Price, Customer, discount,
   tax, subtotal, and total from Stripe.
4. In one database transaction, record the verified event and exact provider
   payment evidence, consume the credit application exactly once, settle the
   Checkout, and create a pending local subscription projection. Keep that
   projection pending until the separate subscription-confirmation transaction
   records exact activation evidence; only then activate the tier. An
   incomplete or ambiguous result grants no entitlement and permits no second
   Checkout.

### Upgrade

1. Bind the quote to the exact current local revision and a fresh Stripe
   Subscription readback.
2. Collect the fixed difference in one-time Checkout. This avoids Stripe's
   elapsed-time proration changing the owner-approved $10/$15 ladder.
3. After exact payment settlement, replace the existing Subscription Item's
   Price with the target Price using quantity 1, `proration_behavior=none`, and
   the unchanged monthly billing anchor.
4. Read the Subscription back. Only then activate the target tier. If payment
   succeeded but the provider price swap or local commit is uncertain, retain
   the old entitlement while the quote remains `provider_change_pending`;
   reconcile only the price swap and never create another difference
   Checkout.

### Downgrade

1. Bind the accepted no-charge quote to the current subscription, item, Price,
   revision, and period end.
2. Create or update a Stripe Subscription Schedule whose current phase keeps
   the current Price through that exact period end and whose next phase uses
   the lower Price with no proration. The schedule releases the continuing
   lower-tier subscription after the transition.
3. Record the schedule only after exact readback. Keep the current tier until
   the boundary. At and after the boundary, capability checks fail closed to
   the lower tier even if webhook delivery is late; provider reconciliation
   must still confirm the recurring Price.

## Current implementation checkpoint

The internal start/upgrade Checkout dispatch and payment-settlement boundaries
are complete and composed only behind the held webhook runtime; customer
start/change command routes remain uncomposed. Additive migration 025 gives
every dispatch a two-minute lease and reconstructs its exact purpose from the
durable quote, current subscription, and canonical Stripe Customer binding. A
ready destination replays without another provider effect; interrupted or
ambiguous creation is never automatically retried.

Additive migration 026 permits only one logical Checkout-completion event,
one quote receipt, and one PaymentIntent receipt. The held payment service
treats a verified `checkout.session.completed` event only as a wake-up signal,
resolves the durable Session, and requires exact read-only Stripe payment and
Subscription evidence before one atomic settlement transaction. A start
creates a pending local subscription and optional one-use Download-credit
application without granting the tier. An upgrade records an immutable
`upgrade_payment_settled` handoff, moves the quote to
`provider_change_pending`, and leaves the current subscription and tier
unchanged. A settled replay returns durable receipt identity without another
Stripe read or new database identity.

Additive migration 027 permits one `start_applied` transition per
Subscription. The held start-activation service treats verified
`customer.subscription.created` or `.updated` only as a wake-up signal,
resolves the durable pending start, and requires exact read-only Stripe
Subscription evidence. One atomic transaction records the processed event and
revision-bound tier event, activates the paid local Subscription with its exact
period and provider facts, and applies the start quote. An active replay uses
durable state without another Stripe read or new identity.

Additive migration 028 fences the already-paid upgrade Price mutation in one
service-role-only application row before Stripe is called. The held upgrade
service binds the exact settled receipt and current subscription revision,
uses one durable provider idempotency key, replaces only the existing item,
clears stale first-subscription credit metadata, disables proration, preserves
the billing anchor, and stores only exact target readback. An interrupted or
ambiguous worker moves the application and quote to reconciliation; recovery
is read-only and never submits another Price mutation. Provider confirmation
still leaves the old local tier active until the separate verified
Subscription-event transaction commits the revision change.

Additive migration 029 completes that separate local transaction. The held
upgrade service accepts only an exactly bound verified
`customer.subscription.updated` event, reads the existing Subscription without
mutating it, and requires the same target item, Price, Customer, period,
receipt metadata, and provider facts already confirmed by the application.
One serializable repository transaction records and processes the provider
event, writes one `upgrade_applied` revision event, advances the existing local
subscription to the paid target tier without changing its billing period, and
applies both quote and provider application. A deferred database trigger proves
those facts agree at commit. An applied replay, including after a later tier
revision, performs no Stripe read and allocates no identity.

Additive migration 030 fences a zero-dollar downgrade before Stripe can attach
or change a Subscription Schedule. The application binds the accepted quote,
current subscription revision, item, Price, paid boundary, and lower target to
one durable idempotency key. Exact confirmation atomically records the
Schedule, advances the quote to `scheduled`, and writes one
`downgrade_scheduled` tier event while leaving the current local tier and
revision untouched. Provider uncertainty can never cause a second write: a
known Schedule ID permits only exact read-only recovery, while an unknown ID
requires owner reconciliation. A deferred database trigger proves the
Schedule facts, current entitlement, quote, and tier event agree at commit.

Additive migration 031 completes the separate renewal-boundary local
transaction. The held downgrade-activation service accepts only an exactly
bound verified `customer.subscription.updated` event at or after the scheduled
instant. It performs one read-only Subscription check and requires the same
Subscription, item, Customer, attached Schedule, lower Price, active state, and
new provider period. One serializable repository transaction records and
processes the provider event, writes one `downgrade_applied` revision event,
advances the existing local subscription to the lower tier and new period, and
applies both Schedule and quote. A deferred database trigger proves the exact
scheduled purpose, event, provider readback, boundary, and revision agree at
commit. Applied replay performs no Stripe read and allocates no identity.

The shared hosted webhook runtime now verifies Stripe's raw body once and
routes exact Alakazam metadata to payment settlement, start activation,
upgrade activation, or downgrade activation without disturbing Download or
canonical commerce events. The composed branch defaults held. An explicit
Alakazam approval requires one reviewed tax mode and matching provider
readiness at startup; impossible Alakazam event/change-kind combinations fail
closed. The production Stripe loader now accepts only one complete approved
Alakazam capability set and exact environment-only Product, three-Price,
Coupon, and restricted Portal bindings. No real provider objects or IDs have
been reviewed into the runtime, and the separate release remains held, so this
composition cannot open a real provider path yet.

The customer runtime now composes one authenticated project-scoped read route
from canonical PostgreSQL authority. Its v1 snapshot contains the held catalog,
eligible first-payment Download credit, current local tier/payment/period,
pending change, next renewal, and bounded local receipts, but no provider IDs.
A Download credit is exposed as available only when no subscription record is
projected; the browser rejects a subscription-plus-available-credit response.
A project member cannot see another member's billing facts or receive a false
empty state for a project with a different current billing owner. The hosted
panel is read-only; every billing action remains disabled until its exact
command boundary exists.

This checkpoint does not yet expose customer quote/change controls, reconcile
the broader renewal and status event set, grant rendered tier features,
publish a site, or open production Checkout. Those remain separate
evidence-gated slices below the same release holds.

Stripe's current documentation supports a one-invoice fixed Coupon for
subscription Checkout, recommends Subscription Schedules for end-of-period
price changes, and warns that changing a Price without the Subscription Item
ID adds a second item. The adapter must therefore verify one item, quantity 1,
the exact Price, and the exact unchanged billing boundary on every transition.

## Customer and owner boundaries

- Browser requests carry identifiers and accepted disclosure digests only.
  They never submit amounts, discounts, tier capabilities, Stripe references,
  period dates, or entitlement state.
- The Stripe Billing Portal, if exposed, must use a pinned configuration that
  permits payment-method and invoice management but cannot bypass Site
  Sourcery's fixed upgrade/downgrade rules with arbitrary product changes.
- The customer account must show current tier, payment state, next renewal
  amount/date, pending change and effective date, receipts/invoices, and safe
  retry state.
- The owner workbench later needs the same facts plus immutable provider
  evidence and bounded reconciliation actions. It must not provide a casual
  “mark paid” or “grant tier” button.

## Release holds that remain real

The backend can be implemented and proven with contract Stripe and fresh
PostgreSQL while public effects remain held. Opening real Checkout still
requires all of the following:

- owner tax treatment;
- exact Stripe Price readback for $25/$35/$50 and the fixed $5 Coupon;
- exact Billing Portal configuration;
- owner-approved cancellation wording and payment-failure/grace consequences;
- care quantities/accounting before $35 or $50 can promise care;
- automatic publication and tier-feature proof;
- a real Stripe test-mode start, upgrade, downgrade, failed-payment, and
  renewal journey;
- owner walkthrough and reviewed cutover.

No refund button, refund offer, or customer-created refund API belongs in this
contract. Payment reversals are a separate defensive access-control concern.
