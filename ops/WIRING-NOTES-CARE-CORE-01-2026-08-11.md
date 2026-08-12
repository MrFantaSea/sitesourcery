# CARE-CORE-01 held wiring and non-duplication notes — 2026-08-11

CARE-CORE-01 is an additive held foundation. It does not authorize a public
Care offer, customer contract, payment, mail, worker, provider action, or
fulfillment. L4/root must preserve that default.

## Existing authorities deliberately reused

- `service_catalog_policies`, `service_catalog_coverage`, project profiles,
  cases, and intakes remain the professional-service catalog/intake spine from
  migration 34.
- Quote acceptance, invoices, assessment settlement/findings, Custom build
  payment/jobs/handoff, professional reversals, and accounting remain owned by
  migrations 35–47 and 108/115/117. CARE-CORE-01 does not project money.
- `support_tickets` remains the customer conversation identity. A Care ticket
  links it exactly; it does not duplicate messages. Migration 110 remains the
  separate support/privacy/DSAR authority.
- Engagement, operator queue/support, billing surfaces, mail, and supervised
  workers keep their existing ownership. No route, composition root, customer
  DOM, mail call site, or worker purpose was changed here.
- Existing Alakazam $35/$50 records remain tier authority. The shared Care
  period uniqueness fence prevents two allowances for the same exact provider
  scope and period, but no Alakazam release is implied.

## Integration

1. Apply reserved migration
   `server/data-plane/supabase/migrations/202608110121_care_core.sql` after the
   separately owned migrations 118 (mail), 119 (domains), and 120 (Responder).
   Union `migration-verification-inventory.mjs` and the structure-test count
   mechanically; never renumber or reuse 121.
2. Keep `createHeldCareCoreService` as the only production-facing boundary.
   `createPostgresCareCoreRepository` is internal durable authority and must
   not be composed into HTTP or workers until all gates below have independent
   release evidence.
3. Any future route must use the existing canonical PostgreSQL authority,
   exact transaction-local organization/actor identity, and the constructors
   in `server/hosted/care-core.mjs`. Browser amounts, entitlement, capacity,
   payment success, provider identity, and lifecycle state are never authority.

## Invariants to retain

- All four normalized identities are held. Custom Care and Alakazam Care keep
  `owner_redline_required`; no historical price or allowance is inferred.
- Customer/payment/provider/mail effect flags can only be false in this
  migration. Every table is tenant-scoped, forced-RLS, and default-deny.
- One provider-scope period can own capacity for one exact month. Primary
  coverage overlaps collide; an included claim must reference the matching
  primary claim.
- Carried units come only from unused *included* units in the immediately
  preceding closed period. Carried capacity is consumed first and cannot roll
  into a third period.
- A Care ticket links one exact support ticket. An assessment-finding basis
  must match the immutable finding digest for the same organization/project.
  Ticket work-scope overlap and command reuse fail closed.

## Residual release gates

- Owner redline and released Legal/catalog authority for exact Custom Care and
  Alakazam Care responsibilities, prices, capacity, timing, cancellation, and
  support promises.
- A separately implemented exact Care quote/acceptance source, invoice/payment
  settlement/readback, reversal handling, and accounting projection. Current
  contract identities remain held evidence only.
- Released customer/operator routes and projections, accessibility/browser
  proof, notification reservations, and an allowlisted supervised worker
  purpose. No such wiring exists in this packet.
- Exact fulfillment adapters, monitoring/backup receipts, provider readiness,
  and owner release authority. Provider, mail, payment, customer, and
  commercial effects remain false.
