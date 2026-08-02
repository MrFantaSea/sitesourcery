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
4. In one database transaction, record provider evidence, consume the credit
   application exactly once, create the local subscription projection, and
   activate the exact tier. An incomplete or ambiguous provider result grants
   no entitlement and permits no second Checkout.

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
   the old entitlement in `paid_change_pending`; retry only the price swap and
   never create another difference Checkout.

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

The internal start/upgrade Checkout dispatch boundary is complete and remains
uncomposed. Additive migration 025 gives every dispatch a two-minute lease and
reconstructs its exact purpose from the durable quote, current subscription,
and canonical Stripe Customer binding. One project can have only one open
dispatch. A ready destination replays without another provider effect; an
expired ready destination requires reconciliation; interrupted or ambiguous
creation becomes persistence-unknown and is never automatically retried; and a
proved pre-effect failure closes the quote safely. The held billing service
selects only subscription-start or fixed-difference upgrade Checkout and
rejects browser money before readiness, Customer work, or provider access.

This checkpoint does not settle a payment, create or mutate a local
subscription, apply a tier, schedule a downgrade, expose an HTTP route, or open
production Checkout. Those are separate evidence-gated slices below the same
release holds.

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
