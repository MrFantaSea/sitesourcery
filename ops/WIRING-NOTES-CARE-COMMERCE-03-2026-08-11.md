# CARE-COMMERCE-03 held wiring and authority notes — 2026-08-11

This packet is one additive held boundary on CARE-CORE-01 and
CARE-SURFACES-02. It adds no migration and edits no production composition,
HTTP, asset, worker, provider, or release root. It must not be composed as a
sellable production path from its in-memory proof repository.

## Reused authority

- Migration 121 remains the only durable Care catalog identity, customer
  contract, period, capacity, and ticket authority. The read-only PostgreSQL
  adapter requires one exact active project, active owner/admin customer,
  contract, open period, and held effect flags.
- Website Rescue and Outside Management prices come only from
  `SS-CUSTOM-SERVICES-2026-08-05.1`, digest
  `9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8`.
  Custom Care and Alakazam Care retain migration 121's
  `owner_redline_required` state and have no price.
- Operator scope reuses the existing `service_invoice_manage` and
  `service_management_manage` capabilities. Customer scope is the exact
  authenticated organization/customer/project relation.
- Canonical JSON, SHA-256, immutable projection, command-claim/replay, and
  held reservation patterns are reused from commerce v2. The mail adapter
  calls only the existing durable mail lifecycle `reserve` method with
  digest-only evidence and has no send, dispatch, acceptance, or event method.
- Existing professional invoice, tax-purpose, accounting, and professional
  reversal authorities were inspected but are purpose-locked. Assessment
  invoice tables accept only assessment; migrations 109/115/117 enumerate
  non-Care purposes. This packet does not mislabel Care as another product or
  weaken those fences.

## New held contracts

- `sitesourcery.care-commerce-catalog/v1` is server-owned, versioned, and
  globally non-sellable. Exact-held prices can produce an operator draft, not
  a released offer.
- `sitesourcery.care-commerce-eligibility/v1` binds actor, organization,
  customer, project, migration-121 catalog identity, contract, open period,
  acceptance/scope/provider-scope digests, and every false effect flag.
- `sitesourcery.care-commerce-quote/v1` binds one selected server price to the
  eligibility and catalog digests. It is held, non-payable, short-lived, and
  carries explicit null/held tax evidence.
- `sitesourcery.care-commerce-invoice-reservation/v1` is a local proof of a
  professional-invoice reservation only. Provider request is null, provider
  certainty is `not_submitted`, and dispatch/payment/provider effects are
  false. One quote can own at most one reservation.
- Cancellation is allowed only before provider submission and requires an
  exact revision plus evidence digest. Ambiguity moves monotonically to manual
  review and prevents cancellation. Reversal is unavailable until an exact
  settled Care receipt authority exists.
- Customer projections remove actor/customer identities; both customer and
  operator projections expose only typed IDs, amounts, states, and opaque
  digests—never scope prose, provider identifiers, mail addresses, or PII.

## Later composition

1. Do not use `createMemoryCareCommerceRepository` outside deterministic
   local proof. A durable command/quote/reservation/cancellation/ambiguity
   ledger is genuinely missing. Request the currently reserved-next migration
   suffix 124 before creating it; do not reuse 118–123.
2. After that migration is separately reviewed, build a repository behind the
   same service interface and require its `durable: true` readiness. Preserve
   transaction-local actor/org identity, forced RLS, exact command replay,
   one-reservation-per-quote, revision, and ambiguity fences.
3. Add Care as its own explicit Stripe Tax and accounting purpose. Until then,
   `taxMode`, tax, total, payable, and commercial readiness stay null/false.
4. Preserve the professional-invoice reservation shape. Do not call Stripe or
   create a provider mutation port until separate owner release and provider
   readiness are installed. Checkout is not silently substituted.
5. Reuse `createCareCommerceMailReservationInterface` only through the
   canonical mail lifecycle. A separately supervised mail worker and owner
   release must remain necessary for delivery.
6. Mount any future authenticated HTTP/UI routes only behind the existing
   ingress, session, CSRF, idempotency, and capability boundaries. No public
   Pages offer is authorized by this packet.

## Residual gates

- Owner redline and legal/catalog release for Custom Care, Alakazam Care, and
  every complex/unknown outside-management quote.
- Durable migration-124 commercial state plus PostgreSQL replay, overlap,
  cancellation, ambiguity, RLS, and cleanup proof.
- Explicit evidence that the $200 supportability review completed and the
  site was accepted before reserving an onboarding balance or monthly period.
- Care-specific tax-purpose, invoice settlement/readback, accounting,
  refund/reversal, cancellation confirmation, and provider reconciliation.
- Customer/operator HTTP and UI wiring, accessibility/browser proof,
  fulfillment workers, mail delivery, monitoring, owner approval, and live
  provider/commercial release.
