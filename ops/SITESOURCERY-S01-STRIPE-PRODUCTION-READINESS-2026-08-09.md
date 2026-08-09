# S-01 Stripe production-readiness packet

Status: code sealed locally; provider release remains held.

This packet describes the Stripe objects and account decisions required by the
runtime at API version `2026-06-24.dahlia`. It is an idempotent provisioning and
readback plan, not authorization to create live objects, replace credentials,
deploy, or lift a purpose release switch.

Official references:

- [API authentication and restricted keys](https://docs.stripe.com/api/authentication)
- [Stripe key-management best practices](https://docs.stripe.com/keys-best-practices)
- [Checkout inline product tax codes and tax behavior](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior)
- [Stripe Tax setup and registrations](https://docs.stripe.com/tax/set-up)
- [Tax Settings API](https://docs.stripe.com/api/tax/settings)
- [Webhook Endpoint readback](https://docs.stripe.com/api/webhook_endpoints/retrieve)
- [Billing Portal configurations](https://docs.stripe.com/api/customer_portal/configurations)
- [Invoice object](https://docs.stripe.com/api/invoices/object)
- [Refund object](https://docs.stripe.com/api/refunds/object)
- [Dispute object](https://docs.stripe.com/api/disputes/object)

## Stop conditions

Keep all of these held until their listed evidence exists:

- `SITESOURCERY_DOWNLOAD_PAYMENT_MODE=held`
- `SITESOURCERY_CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE=held`
- `SITESOURCERY_CUSTOM_BUILD_PAYMENT_MODE=held`
- `SITESOURCERY_CUSTOM_BUILD_CHANGE_PAYMENT_MODE=held`
- `SITESOURCERY_CUSTOM_BUILD_FINAL_PAYMENT_MODE=held`
- `SITESOURCERY_ALAKAZAM_MODE=held`
- `SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE=held`
- omit every domain capability and every
  `SITESOURCERY_STRIPE_DOMAIN_*` field
- keep `taxCodes.domainRegistration=null`

`SITESOURCERY_STRIPE_MODE=approved_live` means only that the shared adapter may
perform its configured operations. It does not approve any purpose above,
publication, DNS, or deployment.

Stripe Tax remains a hard startup gate. The test account currently requires the
full US head-office address; a country-only update was rejected. Do not invent
the missing address, registration, or `none_registered` decision, and do not
construct the attestation until exact account readback is complete.

## Required Stripe object contract

### Catalog

Create one active Product named `Alakazam` with:

- tax code `txcd_10701100` (Website Hosting);
- metadata schema and environment markers;
- no unrelated Prices attached.

Create exactly three active recurring Prices on that Product:

| Tier | Amount | Currency | Recurrence | Tax behavior |
| --- | ---: | --- | --- | --- |
| `alakazam_25` | 2500 | `usd` | monthly, interval count 1 | `exclusive` |
| `alakazam_35` | 3500 | `usd` | monthly, interval count 1 | `exclusive` |
| `alakazam_50` | 5000 | `usd` | monthly, interval count 1 | `exclusive` |

Create one Coupon with a stable explicit ID, recommended
`ss_alakazam_download_credit_v1`:

- `amount_off=500`, `currency=usd`, `duration=once`;
- no percent discount, redemption deadline, duration months, or maximum
  redemptions;
- `applies_to.products` contains only the Alakazam Product.

The test-mode proof objects are examples only and must never become source
defaults:

- Product `prod_V2b5nABAASQuTi`;
- $25 `price_1U2VtePi1bfFonRcUyDNYdxM`;
- $35 `price_1U2VtePi1bfFonRcU3RYA7CJ`;
- $50 `price_1U2VtfPi1bfFonRcVkNO5aQS`;
- Coupon `ss_alakazam_download_credit_v1`;
- Portal configuration `bpc_1U2VyoPi1bfFonRch0FtABwz`;
- Webhook Endpoint `we_1U2W95Pi1bfFonRcibl1S2UR`, bound to
  `https://simbiotechzen.tail85d878.ts.net/api/v1/webhooks/stripe` with the
  exact 17-event set below and API version `2026-06-24.dahlia`.

The Product, Prices, Coupon, Portal, and Webhook Endpoint above were provisioned
in test mode and read back for their stated fields. They are not live release
evidence. The test webhook signing secret remains outside source control and is
not part of this packet.

### Inline prices by purpose

Every server-created inline Price sends `tax_behavior=exclusive`. Every inline
`product_data` sends an explicit purpose tax code:

| Purpose | Tax code | State |
| --- | --- | --- |
| $5 Abracadabra Download | `txcd_10701200` Website Design | code-ready, held |
| $200 assessment | `txcd_10701200` Website Design | code-ready, held |
| Custom first installment | `txcd_10701200` Website Design | code-ready, held |
| Custom change order | `txcd_10701200` Website Design | code-ready, held |
| Custom final installment | `txcd_10701200` Website Design | code-ready, held |
| generic website service | `txcd_10701200` Website Design | code-ready, held |
| Alakazam recurring and upgrade | `txcd_10701100` Website Hosting | code-ready, held |
| domain registration | unresolved | held; no guess permitted |

The runtime refuses construction when an enabled purpose lacks its exact tax
code. Domain authorization additionally remains outside the production
capability approval until its Stripe Tax classification is approved.

### Billing Portal

Create one active configuration and bind its exact `bpc_` ID. Readiness
requires:

- exact default return URL;
- exact Privacy Policy URL;
- exact Terms URL;
- direct Portal login disabled, with login URL `null`;
- payment-method updates enabled;
- invoice history enabled;
- customer profile updates disabled;
- subscription updates disabled;
- subscription cancellation disabled.

The current canonical URL contract is:

- return: `https://sitesourcery.com/abracadabra/app/`;
- privacy: `https://sitesourcery.com/legal/privacy/`;
- terms: `https://sitesourcery.com/legal/website-terms/`.

Do not provision or approve the live Portal until those final deployed legal
artifacts and their release hash have been verified at those URLs.

### Webhook Endpoint

Provision one account-owned endpoint only after the final public ingress URL is
deployed and signature-preserving HTTP proof passes. Bind both its exact `we_`
ID and exact URL. Readiness requires:

- `livemode` equals the deployment mode;
- status `enabled`;
- API version `2026-06-24.dahlia`;
- `application=null`;
- exact URL, expected
  `https://sitesourcery.com/api/v1/webhooks/stripe`;
- the exact sorted event set below, with no missing or extra events.

```text
charge.dispute.closed
charge.dispute.created
charge.dispute.funds_reinstated
charge.dispute.funds_withdrawn
charge.dispute.updated
charge.refunded
checkout.session.completed
customer.subscription.created
customer.subscription.deleted
customer.subscription.updated
invoice.paid
invoice.payment_action_required
invoice.payment_failed
invoice.payment_succeeded
refund.created
refund.failed
refund.updated
```

`invoice.finalization_failed` is intentionally not subscribed yet. The source
inventory requires owner alert and reconciliation only, but no durable
finalization-failure service, owner-alert projection, or L4 router branch exists.
Adding the event now would make startup attest delivery without a consumer. The
follow-on must add a no-entitlement-mutation evidence service, durable owner
alert, shared-router branch, production construction, and replay/readback tests;
only then add the event to this exact set.

The `whsec_` value is separate from the endpoint ID. Signature verification is
local and needs no Stripe API permission.

### Stripe Tax attestation

S-01 uses sealed account attestation rather than giving the runtime Tax API
permissions. After an authenticated operator completes exact account setup:

1. read Tax Settings and the complete registration list in the same mode;
2. verify the full head-office address, default `exclusive` behavior, and the
   account's registration decision;
3. record either every exact `taxreg_` ID with `registrationDecision=registered`
   or an owner-approved empty list with
   `registrationDecision=none_registered`;
4. seal `sitesourcery.stripe-tax-attestation/v1` with approval ID, approval time,
   livemode, tax mode, country, and those registration IDs;
5. store it only in `SITESOURCERY_STRIPE_TAX_ATTESTATION_JSON`.

This is configuration evidence, not tax or legal advice. It cannot be inferred
from the absence of registrations.

## Least-privilege keys

Create two different restricted keys. Store each only in the deployment secret
manager. Apply an IP restriction when the runtime has a stable egress address.
Do not place either key in a command transcript, repository, approval JSON, or
runbook.

### Runtime restricted key

Grant only these Stripe Dashboard resource permissions. `Write` is required
where the runtime invokes create/update/cancel; otherwise use `Read`.

| Stripe resource permission | Level | Runtime API operations |
| --- | --- | --- |
| Checkout Sessions | Write | create Checkout for Download, assessment, Custom, Alakazam, and approved site service; retrieve settlement/lifecycle Sessions |
| Customers | Write | create and retrieve the Alakazam Stripe Customer |
| Customer/Billing Portal Sessions | Write | create an authenticated Portal session |
| Customer/Billing Portal Configurations | Read | exact startup readback of the bound `bpc_` object |
| Products | Read | Alakazam Product and expanded inline Product tax-code readback |
| Prices | Read | all configured Price and settlement readbacks |
| Coupons | Read | exact $5 Coupon readiness readback |
| Subscriptions | Write | retrieve, upgrade, schedule period-end cancellation |
| Subscription Schedules | Write | create, retrieve, and update renewal-boundary downgrades |
| Invoices | Read | renewal and billing-incident Invoice readback |
| Charges | Read | payment and reversal binding |
| Refunds | Read | defensive reversal readback only; no Alakazam refund creation |
| Disputes | Read | defensive dispute readback |
| Webhook Endpoints | Read | exact startup readback of URL/status/version/events |

Set all other permissions to `None`, including Tax Settings, Tax
Registrations, Accounts, Files, Transfers, Payouts, Balance, and Connect.
Automatic Tax inside a Checkout Session does not make a direct Tax API call in
this runtime. Webhook signature verification also makes no provider call.

Domain remains excluded. A later, separately approved domain key expansion
would require Payment Intents `Write` for read/capture/cancel and Refunds
`Write` for owner-commanded refunds. Do not grant those permissions now.

The adapter accepts mode-matched `rk_test_` and `rk_live_` keys. Matching
`sk_test_` and `sk_live_` keys remain supported for one-time bootstrap or an
emergency rotation, but are not the steady-state recommendation.

### One-time provisioning restricted key

Use a different, short-lived restricted key for the idempotent provisioning
sequence. Grant:

| Stripe resource permission | Level | Provisioning work |
| --- | --- | --- |
| Products | Write | create/read the Alakazam Product and tax code |
| Prices | Write | create/read the three immutable recurring Prices |
| Coupons | Write | create/read the one product-restricted Coupon |
| Customer/Billing Portal Configurations | Write | create/read the restricted Portal configuration |
| Webhook Endpoints | Write | create/read/update the exact endpoint |
| Tax Settings | Write | complete/read default tax behavior and head-office address |
| Tax Registrations | Write | create/list only exact owner-authorized registrations |

Set Customers, Checkout Sessions, Subscriptions, Subscription Schedules,
Invoices, Charges, Refunds, Disputes, Payment Intents, Transfers, Payouts, and
Connect to `None`. Revoke the provisioning key after readback evidence is
sealed. It must never be installed as `SITESOURCERY_STRIPE_SECRET_KEY`.

## Idempotent live provisioning sequence

Every POST uses a stable idempotency key scoped to mode, object, contract
version, and date. Before a POST, list/retrieve by explicit ID, lookup key, or
metadata schema; if an object exists, compare every immutable field and stop on
drift. Never create a replacement merely because readback differs.

1. Confirm authenticated account ID, live mode, US/default USD, account
   requirements, charges, and payouts. Stop on account mismatch or requirements.
2. Complete and read back Stripe Tax Settings with the full head-office address
   and default `exclusive` behavior. Complete only owner-authorized tax
   registrations, list them all, then seal the attestation.
3. Create/read the live Alakazam Product with Website Hosting tax code using
   `ss:stripe:live:alakazam:product:v1:20260809`.
4. Create/read the $25, $35, and $50 monthly exclusive Prices with distinct
   lookup keys and idempotency keys ending `:25`, `:35`, and `:50`.
5. Create/read the explicit-ID $5 once Coupon, restricted only to that Product,
   using `ss:stripe:live:alakazam:coupon:v1:20260809`.
6. After final legal URL/hash proof, create/read the restricted Portal using
   `ss:stripe:live:alakazam:portal:v1:20260809`.
7. After the final public ingress is deployed, create/read the Webhook Endpoint
   using `ss:stripe:live:webhook:v1:20260809`; capture its `we_` ID and signing
   secret once through the secret manager.
8. Create the runtime restricted key with the exact matrix above, apply an IP
   restriction if available, and revoke the provisioning key.
9. Bind exact live IDs, tax codes/attestation, final return/legal/webhook URLs,
   `whsec_`, and the `rk_live_` key in the deployment secret manager. Seal the
   environment-bound approval JSON with the exact capability list.
10. Start once with every purpose release switch still held. Approved Stripe
    startup must read back Prices, Product, Coupon, Portal, and Webhook Endpoint
    and emit only the redacted readiness projection.
11. Run signature, duplicate-event, delayed-event, return-polling, provider
    readback, and rollback rehearsal in staging. Production purpose release is a
    separate owner operation, one purpose at a time.

## What can be created when

Can be provisioned before the final release URL/hash, without lifting a hold:

- live Alakazam Product;
- live $25/$35/$50 Prices;
- live product-restricted $5 Coupon;
- runtime and provisioning restricted keys, although creating the runtime key
  last reduces unnecessary credential lifetime.

Blocked on account/user action rather than a release hash:

- Tax Settings: exact full head-office address;
- Tax registration decision and any exact registrations;
- sealed Tax attestation;
- domain classification, which remains entirely held.

Create only after final deployed URL/hash verification:

- live Billing Portal configuration with final legal and return URLs;
- live Webhook Endpoint with reachable raw-body ingress;
- production approval JSON and return-origin bindings;
- any purpose-specific switch from `held` to `approved`.

## L4 wiring note

No `bin/server.mjs` edit is required for the new ports. The current production
composition already passes the same `stripeComposition.adapter` into renewal,
incident, recovery, cancellation, and reversal service constructors and the
shared webhook router. S-01 adds the missing methods to that adapter and proves
both held and approved construction against all five lifecycle contracts.

The remaining L4 follow-on is the `invoice.finalization_failed` evidence/alert
branch described above. Do not work around it by subscribing the endpoint to an
event that the router cannot own.
