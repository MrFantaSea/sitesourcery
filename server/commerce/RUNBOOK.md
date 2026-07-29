# Abracadabra commerce release runbook

Keep `PUBLICATION_HOLD` until every item is evidenced.

1. Owner signs an immutable catalog version containing only explicitly sellable
   implemented product × tenure offers, exact USD amounts, Stripe Price
   references, and a terms version. Business and Presence require separately
   implemented contracts before any offer may reference them.
2. Product counsel/owner approves renewal, cancellation, ownership, hosting,
   payment-grace, and retention/export wording for each tenure.
3. Production catalog storage keeps Stripe references server-only. A response
   capture proves the public catalog cannot expose them.
4. Production repository applies `001_abracadabra_commerce.sql` and passes
   concurrency, rollback, tenant/customer/project isolation, and restore drills.
5. Domain quote integration proves registration and renewal are separate,
   current, project-bound units with their own receipt groups and terms. Domain
   money uses authorize → registrar submit/readback → capture, never ordinary
   website Checkout. The customer uses an order-bound Site Sourcery route that
   relays to the dedicated Stripe-hosted authorization session; no registrar
   redirect is exposed as a purchase path.
6. Stripe composition uses the pinned official SDK/API version, exact
   environment/livemode approval, matching server key, approved return origins,
   explicit tax mode, explicit capabilities, and zero automatic network retries.
   The adapter verifies every configured Price, uses purpose-bound idempotency,
   preserves receipt-group identity, accepts no browser money, and requires exact
   domain success/cancel templates plus the reviewed authorization disclosure.
7. Signed webhooks and a settlement ledger issue the separate website/domain
   receipts. Combined checkout alone is not evidence that receipt fulfillment
   exists.
8. Recovery tooling reconciles `checkout_dispatching` using the provider
   idempotency key without automatic retry.
9. HTTP routes derive trusted tenant/customer/project identity and enforce CSRF,
   origin, authorization, rate-limit, redirect-allowlist, and audit controls.
10. Exact Node 24.18.0 tests pass locally and on Dell. Staging completes a Stripe
    test-mode quote, disclosure, checkout, webhook, receipt, cancel, renewal, and
    refund rehearsal. Domain staging separately proves authorization readback,
    authorization expiry, registrar failure/void, verified registration/capture,
    partial capture, refund, and every ambiguous-response recovery path.
11. A reviewer confirms no Abracadabra browser code submits `priceId`, amount,
    currency, totals, line items, or a flat combined variant.
12. Only then remove `PUBLICATION_HOLD` in a dedicated, owner-approved release.

Provider activation is a separate switch from publication. Do not select
`approved_live` merely because tests pass. Record the exact approval object and
environment secret references, run readiness, capture Stripe test-mode evidence,
and retain held composition until the owner separately authorizes the switch.
Never settle domain money from a webhook body. Wake the worker, then reconcile
the exact Checkout Session, PaymentIntent, Charge, balance transaction, and
refund state from Stripe before advancing the durable order.
