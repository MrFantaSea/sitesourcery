# Abracadabra commerce v2

This directory is an isolated, server-only contract for the action-based Spark
offers. It does not replace or reinterpret `server/commerce` v1.

The private catalog contains exactly:

| Offer | Server price | Entitlement |
| --- | --- | --- |
| `spark_download` | owner-accepted one-time USD 5 | non-consuming, non-expiring download and self-host use for one editor project |

The current owner ruling places Alakazam hosting at USD 25, USD 35, and USD 50
per month for a `sitesourcery.me` address. The $25 level keeps the three base
looks; $35 adds a photo header, expanded fonts, section toggles, a three-version
history, and modest care; $50 adds richer customization including Cash
App/Venmo links, a menu, further font/border controls, and more care. Exact care
quantities and several operational policies are still owner-open. Paid value
carries forward on upgrades: the $5 Download leaves $20 to enter $25, $25 to
$35 costs the $10 difference, and $35 to $50 costs the $15 difference. The
three levels now live in a separate private held tier catalog in
`alakazam.mjs`; obsolete draft $15/$30 subscription prices have been removed.
The calculation and entitlement contract is proven independently while tax,
care quantities, cancellation wording, provider effects, and fulfillment
remain held. The complete provider/database sequence and remaining release
holds are recorded in `ops/ALAKAZAM-BILLING-CONTRACT-2026-08-02.md`.

The owner-approved tier-change direction is immediate, difference-only paid
upgrades and renewal-boundary downgrades. A customer requesting a downgrade
keeps the already-paid higher entitlement through its current period, receives
no mid-period downgrade refund/proration, and renews at the full lower monthly
price. Higher-tier configuration is retained without granting higher-tier
capabilities after the scheduled downgrade takes effect.

Assisted Launch is quote/invoice work and is intentionally absent from the
self-service catalog.

Every offer and checkout preparation remains private and held. The quote
boundary itself has no Stripe identifier, secret, network path, or dispatch
authority. A checkout preparation is only a durable, idempotent statement of
the exact server purpose that a separately reviewed dispatcher needs.

The shared reviewed Stripe adapter now has an optional Alakazam provider
contract, still uncomposed in the hosted customer runtime. It fails closed
unless one Product, the exact $25/$35/$50 monthly Prices, an unrestricted-count
but one-invoice $5 Coupon, and a restricted Billing Portal configuration all
read back exactly. Its contract-test surface proves first-subscription
Checkout, fixed-difference upgrade Checkout, provider payment readback,
one-item/no-proration Price replacement with an unchanged billing boundary,
and renewal-boundary downgrade scheduling. Provider uncertainty never creates
a second payment or Schedule. Production composition deliberately does not yet
accept these Alakazam capabilities or provider identifiers, so this checkpoint
does not open Checkout or grant an entitlement.

The internal Alakazam quote, direct Customer-provisioning, start/upgrade
Checkout, payment-settlement, start-activation, and paid-upgrade provider
application transactions are now implemented but uncomposed. The
held-by-default services open them only when release and provider tax/readiness
facts match. The PostgreSQL repository locks
the active project, binds the current subscription revision or one unused
project Download credit, writes one immutable 30-minute quote per UUID
idempotency key, and replays that exact snapshot. A direct start reserves and
confirms one metadata-only organization Stripe Customer. Checkout then
reserves one exact quote-bound effect under a two-minute lease before the
provider call, persists only exact provider result evidence, replays a durable
destination, and fences ambiguous, expired, or interrupted work without
submitting a second payment effect.

A verified `checkout.session.completed` event is only a wake-up signal. The
payment service resolves the durable Session, requires exact read-only Stripe
payment evidence, and commits one event, receipt, and optional Download-credit
application atomically. Start creates only a pending local subscription;
upgrade records one `provider_change_pending` handoff while preserving the
current tier. Durable settlement replays without another provider read or new
IDs. A later verified Subscription event is also only a wake-up signal: exact
Stripe readback must match the paid pending start before one atomic transaction
records the event and revision evidence, activates the local period, and
applies the quote. Active replay performs no Stripe read. Browser money and
provider authority, pending changes, changed billing ownership, stale projects,
changed retry purposes, and digest drift all fail closed.

After an upgrade difference settles, migration 028 commits one exact
application before the existing Subscription Item can change Price. The held
upgrade service uses one durable idempotency key, quantity 1, no proration, an
unchanged billing anchor, and exact receipt-bound target readback. It explicitly
clears stale first-subscription credit metadata. A crashed or ambiguous worker
is fenced; later recovery reads the Subscription only and never submits another
mutation. The provider-confirmed application deliberately leaves the old local
tier active for the separate verified-event revision transaction.

Migration 029 completes that local transaction without widening provider
authority. One exactly bound verified `customer.subscription.updated` event
causes a read-only Subscription check; then one atomic repository transaction
records the processed event and `upgrade_applied` revision evidence, advances
the existing local subscription to the paid target tier without changing its
period, and applies the quote and provider application together. A deferred
database trigger proves the complete binding at commit. Applied replay uses
durable activation evidence without another Stripe read or new identity, even
after a later tier revision.

Migration 030 adds the separate downgrade Schedule transaction. Before Stripe,
the held service commits one exact current-revision application and stable
idempotency key. It keeps the current Price through the paid period, schedules
the lower Price afterward with no proration, and atomically stores exact
provider facts, the scheduled quote, and one pending tier event without
changing current access. Provider uncertainty is no-retry: a known Schedule
can only be retrieved and confirmed read-only; an unknown Schedule identity
requires owner reconciliation. Renewal-boundary activation, webhook/HTTP
composition, customer controls, and fulfillment remain held.

Quotes bind the catalog and terms versions, exact server price, tenant,
customer, editor project, accepted project version, version content digest,
entitlement kind, and full customer disclosure. Both the disclosure and the
complete quote snapshot have canonical SHA-256 digests.

The customer boundary accepts identifiers and an accepted disclosure digest
only. It recursively rejects money, provider fields, entitlement authority, and
all v1 tenure fields or IDs.

`authorizeProjectEntitlement` consumes no entitlement state. A valid
`spark_download` entitlement can therefore authorize repeated download clicks,
later accepted versions belonging to the same editor project, and downstream
self-hosting without another purchase. Cross-project use is indistinguishable
from a missing entitlement.

The hosted test boundary exposes only:

- `POST /api/v1/projects/{projectId}/download-quotes`
- `POST /api/v1/projects/{projectId}/download-quotes/{quoteId}/checkout-command`

The first route fixes the offer to `spark_download`; it does not accept an offer
ID. The second returns only the held checkout-command preparation. There is no
v2 customer catalog, publish-offer, provider-dispatch, or settlement route.
Without an explicitly injected project-scoped v2 boundary, both routes return
the production-safe `DOWNLOAD_COMMERCE_HELD` response.
