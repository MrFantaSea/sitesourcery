# Abracadabra commerce contract (held by default)

This module defines the server-owned catalog, quote, and checkout boundary for
Abracadabra. It now includes a production-shaped official Stripe adapter, but
the default composition is still held and no production catalog, credentials,
approval, or provider capability is embedded here. `PUBLICATION_HOLD` remains
the release truth.

## Commercial model

Product and tenure are independent axes:

- products: `business`, `presence`, `spark`
- tenures: `rent`, `own`, `owned_managed`
- offers: an explicit owner-approved subset of product × tenure pairs

The only currently implemented product contract is
`abracadabra.spark/v1`. Business and Presence remain known but held; adding a
price cannot make them sellable. An approved catalog contains only explicit
pairs whose product implementation contract is approved. Every offer has exact
USD amounts plus server-held Stripe Price references matching its tenure:

- `rent`: recurring only
- `own`: one-time only
- `owned_managed`: one-time plus recurring

The catalog is versioned and requires `state: "approved"`, `approvedBy`,
`approvedAt`, and `termsVersion`. Missing, duplicate, held, unresolved, or
unimplemented offers fail closed. The included fake catalog approves only Spark
× three tenures and is test-only; the held adapter has no production prices.

## Browser-safe contract

Suggested route mapping (the module itself installs no routes):

| Route | Account-boundary action | Browser body |
| --- | --- | --- |
| `GET /api/abracadabra/catalog` | `catalog` | `{}` |
| `POST /api/projects/:projectId/abracadabra/quotes` | `quote` | `{ projectId, offerId, domainQuoteId?, commandId }` |
| `POST /api/projects/:projectId/abracadabra/checkouts` | `checkout` | `{ projectId, quoteId, acceptedDisclosureDigest, commandId }` |
| `GET /api/projects/:projectId/abracadabra/quotes/:quoteId` | `get_quote` | `{ projectId, quoteId }` |

The route should derive `projectId` from its path and require any duplicate body
value to match. The boundary shown here accepts it as a field so the contract can
be tested without an HTTP framework. The service still requires the project
authority port to resolve a current, purchasable project for the trusted
tenant/customer tuple at quote and checkout time.

The public catalog filters out every product and tenure not referenced by an
approved offer. Its schema is:

```json
{
  "schema": "sitesourcery.abracadabra-public-catalog.v1",
  "catalogVersion": "owner-approved-version",
  "currency": "USD",
  "termsVersion": "owner-approved-terms-version",
  "products": [
    {
      "productId": "spark",
      "name": "...",
      "description": "...",
      "implementationContract": "abracadabra.spark/v1"
    }
  ],
  "tenures": [
    {
      "tenureId": "rent",
      "name": "...",
      "billingShape": { "oneTime": false, "recurring": true }
    }
  ],
  "offers": [
    {
      "offerId": "opaque-owner-approved-id",
      "productId": "spark",
      "tenureId": "rent"
    }
  ]
}
```

It contains neither amounts nor Stripe references. The browser submits an
`offerId`; it never chooses a price.

The authoritative quote schema is
`sitesourcery.abracadabra-customer-quote.v1`. It returns `projectId`, the
selected product and tenure, exact line-level one-time/recurring amounts,
currency, renewal/cancellation/ownership/hosting/grace/export terms, separate
receipt groups, exact one-time and per-interval recurring totals, issue/expiry
times, and `disclosureDigest`.

Checkout requires the same project, the server quote ID, and the exact
`disclosureDigest` the customer reviewed. The digest binds project, offer,
catalog/terms versions, all public line items, totals, and expiration. Client
money, totals, line items, currency, Price IDs, and Stripe references are
recursively rejected.

## Domains remain a separate commercial and payment unit

`domainQuoteId` is optional. The domain quote port resolves its exact amount and
terms using trusted tenant/customer/project authority. Registration and renewal
are distinct line kinds. The domain gets a receipt group separate from the
website. The quote records the server-resolved domain price data, never a
browser-provided amount.

The official Stripe Checkout adapter rejects dynamic domain money. Domain
procurement must use the existing purpose-bound manual-authorization sequence:
authorize the exact quote, register, verify registrar ownership/readback, then
capture. A registrar failure cancels the authorization, and any ambiguous
provider response stops for reconciliation. Website Checkout and domain
procurement therefore cannot be collapsed into one charge.

The customer still stays inside Site Sourcery. The server creates a dedicated
Stripe-hosted domain authorization Checkout and returns it through an
order-bound same-origin relay. It then reads the expanded Checkout Session and
PaymentIntent from Stripe; a webhook payload alone cannot establish the amount
or payment state. Only a current `requires_capture` authorization can fund a
registrar attempt. Only verified domain and registrant readback can trigger
capture. Cancellation releases an uncaptured hold, while refunds reconcile the
remaining captured balance and retain operator evidence.

## Stripe construction

`createStripeProviderAdapter()` defaults to `held`. `contract_test` accepts only
an injected, no-network test client with Stripe test mode. `approved_live`
requires all of the following before construction:

- an exact staging or production owner approval bound to provider, livemode,
  pinned API version, timestamp, approval ID, and explicit capabilities;
- a matching `sk_test_` or `sk_live_` server secret;
- the pinned official Stripe SDK and API version;
- exact HTTPS return origins, tax decision, webhook secret, and owner-approved
  Price expectations;
- exact order-bound domain success/cancel templates and the manual-authorization
  disclosure when domain capabilities are approved.

Readiness retrieves every Price and compares ID, active state, livemode,
currency, amount, and recurrence. Checkout derives a provider idempotency key
from the durable command and purpose digest. Provider timeouts and unsafe
post-effect responses remain ambiguous for operator reconciliation. Domain
readback expands the PaymentIntent, latest Charge, authorization expiry, balance
transaction, and refunds before projecting any settlement state. Webhooks accept
raw bytes only and verify `Stripe-Signature` before returning an event.

## Compatibility

Legacy browser calls that send `priceId` must be migrated to the quote flow.
There is deliberately no compatibility shim that accepts a browser Price ID,
amount, flat `variant`, or a combined product/tenure value. Those inputs would
restore client price authority or collapse the two independent axes.

Run the contract suite with the repository-pinned runtime:

```sh
node server/domain/assert-runtime.mjs
node --test server/commerce/test/offer-contract.test.mjs \
  server/commerce/test/stripe-provider.test.mjs
```
