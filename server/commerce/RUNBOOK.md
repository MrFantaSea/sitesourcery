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
   current, project-bound units with their own receipt groups and terms.
6. Stripe adapter verifies every configured Price, uses purpose-bound
   idempotency, preserves receipt-group metadata, and accepts no browser money.
7. Signed webhooks and a settlement ledger issue the separate website/domain
   receipts. Combined checkout alone is not evidence that receipt fulfillment
   exists.
8. Recovery tooling reconciles `checkout_dispatching` using the provider
   idempotency key without automatic retry.
9. HTTP routes derive trusted tenant/customer/project identity and enforce CSRF,
   origin, authorization, rate-limit, redirect-allowlist, and audit controls.
10. Exact Node 24.18.0 tests pass locally and on Dell. Staging completes a Stripe
    test-mode quote, disclosure, checkout, webhook, receipt, cancel, renewal, and
    refund rehearsal.
11. A reviewer confirms no Abracadabra browser code submits `priceId`, amount,
    currency, totals, line items, or a flat combined variant.
12. Only then remove `PUBLICATION_HOLD` in a dedicated, owner-approved release.
