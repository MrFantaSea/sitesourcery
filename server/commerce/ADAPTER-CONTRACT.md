# Commerce adapter contract

Provider adapters default to held. Contract-test adapters accept only injected
no-network fakes. An adapter can perform a Stripe effect only when production
composition supplies an exact environment-bound owner approval, the pinned
official SDK, matching credentials, and every capability used by that process.
Merging this code does not turn payments on.

## Catalog

`catalog.current()` returns the private owner-approved catalog. `stripePriceRefs`
exist only in this private object. Production composition must obtain them from
server configuration or a protected datastore and must never serialize them
through the account boundary.

Changing an amount, Stripe Price reference, tenure term, or product/tenure
mapping requires a new `catalogVersion`. Changing customer-facing terms requires
a new `termsVersion`. The owner approval record must identify both versions.

## Domain quote resolver

`domainQuotes.resolveForCommerce({ tenantId, customerId, projectId,
domainQuoteId, now })` returns a current authoritative registration or renewal
quote. It must verify all three ownership dimensions and expiration. Its result
contains exact USD money, customer terms, and server-only Stripe price data.

It must not register, renew, mutate DNS, or refresh an expired price as a side
effect. An expired quote requires a new explicit domain quote.

## Project authority

`projects.resolveForCommerce({ tenantId, customerId, projectId, now })` must
resolve a current, purchasable project owned by that tenant/customer tuple. Quote
creation and checkout both revalidate it. An arbitrary project string is not
sufficient authority.

## Stripe

`stripe.readiness()` must return `{ ready: true }` only after server credentials,
webhook verification, redirect allowlists, and every referenced Price are
verified.

`stripe.createCheckout({ idempotencyKey, purposeDigest, purpose })` receives:

- tenant, customer, and project identity;
- quote/catalog/offer/disclosure identity;
- authoritative line and receipt-group identity;
- website receipt groups backed by exact owner-approved Stripe Prices.

The adapter must bind its provider idempotency key to `purposeDigest`, reject
reuse for a different purpose, preserve receipt-group metadata, and return
`checkoutId`, an allowlisted Checkout URL, and `expiresAt`.

Dynamic domain money is deliberately rejected by ordinary Checkout. Domain
procurement uses a separate manual-authorization workflow: authorize the exact
server quote, submit to the registrar, read the registration back, then capture
only the verified amount. Registrar failure cancels the authorization; an
ambiguous provider result enters reconciliation. This prevents a mixed website
subscription Checkout from charging domain money before registrar proof.

The domain payment port is explicit:

- `createDomainAuthorizationCheckout` creates a separate Stripe-hosted
  `payment` Checkout with `capture_method=manual`, exact server price data,
  purpose-bound metadata, and order-bound same-origin return routes;
- `retrieveDomainAuthorization` expands and verifies the Checkout Session,
  PaymentIntent, Charge, balance transaction, refunds, authorization expiry,
  exact money, livemode, and purpose metadata before projecting state;
- `captureDomainAuthorization` reads the current authorization first and
  captures no more than the verified registrar amount with a provider
  idempotency key;
- `voidDomainAuthorization` reads the exact uncaptured PaymentIntent before
  releasing the hold;
- `refundDomainCapture` reads the captured/refunded balance first and binds the
  refund to operator evidence.

Provider webhooks are wake-up signals, not domain-money authority. The durable
orchestrator settles authorization, capture, void, and refund state only from
exact provider readback. Transport failure or an unsafe post-effect response is
ambiguous and must be reconciled before retry.

`createBillingPortal` uses an exact allowlisted return URL.
`scheduleCancellation` sets `cancel_at_period_end` and binds the reviewed
cancellation digest in provider metadata. `verifyWebhook` accepts the exact raw
request bytes and verifies `Stripe-Signature` before any event is trusted.

The pinned official SDK uses Stripe API version `2026-06-24.dahlia`, disables
automatic network retries, and never accepts a test key in live mode or a live
key in test mode.

The service persists `checkout_dispatching` before calling Stripe. An ambiguous
provider result stays in that state and is never automatically retried. An
operator must reconcile the provider idempotency key, then commit the known
result through a separately reviewed recovery path.

## Repository

The production repository must implement the transaction boundaries modeled by
the memory repository and `migrations/001_abracadabra_commerce.sql`:

- tenant-scoped command claim and purpose fingerprint;
- atomic quote + audit + outbox + completed command on quote creation;
- compare-and-swap state transition to `checkout_dispatching`;
- atomic `checkout_ready` + audit + outbox + completed command;
- safe release of a pending command only before durable provider dispatch.

The quote document contains private checkout authority and must never be returned
raw. Only the public projection from the service crosses the account boundary.
