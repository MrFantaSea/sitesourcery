# Commerce adapter contract

No adapter in this directory performs a live payment or domain operation.

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
- website receipt group with server-held Stripe Price references;
- optional separate domain receipt group with server-resolved price data.

The adapter must bind its provider idempotency key to `purposeDigest`, reject
reuse for a different purpose, preserve receipt-group metadata, and return
`checkoutId`, an allowlisted Checkout URL, and `expiresAt`.

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
