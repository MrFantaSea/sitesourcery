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
