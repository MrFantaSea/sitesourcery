# CARE-SURFACES-02 wiring notes — 2026-08-11

This lane is an additive, hosted-only held surface over sealed CARE-CORE-01
commit `0f8146f3b8674e197a4f0526847182ed4651a734`. It adds no migration and does
not edit any production composition root.

## Standalone composition

1. Construct the existing migration-121 authority with
   `createPostgresCareCoreRepository`.
2. Pass that exact instance plus the canonical PostgreSQL authority to
   `createPostgresCareSurfaceRepository`.
3. Pass the canonical `createMailLifecycle` instance only through
   `createCareMailReservationInterface`. The resulting port exposes
   `reserve` and `readiness`; it has no acceptance, dispatch, delivery, event,
   retry, or provider method.
4. Construct `createCareSurfacesService`, then
   `createCareSurfacesHttpBoundary` with the canonical session authenticator
   and the existing origin/CSRF/idempotency write guard.
5. Dispatch the nine exact routes in `CARE_SURFACE_HTTP_ROUTES` only after the
   existing ingress body/deadline/concurrency boundary. Do not copy their
   behavior into `server/hosted/http.mjs`.

## Authority invariants

- Customer reads derive both user and organization from the authenticated
  session. PostgreSQL filters both `organization_id` and `customer_user_id`.
- Operator reads and every Care command require the existing
  `service_management_manage` capability for the target organization.
- Durable Care mail reservation independently requires both
  `service_case_manage` and `service_management_manage`.
- Migration 121 remains the only contract/period/ticket/capacity mutation
  authority. Its triggers recheck the operator capability, organization,
  command digest, overlap, revision, and capacity constraints.
- Assessment-finding HTTP and UI contracts accept and return only the exact
  immutable finding digest. The PostgreSQL adapter resolves the internal UUID
  inside the same organization/project/capability boundary; that UUID never
  enters the HTTP or UI projection.
- Customer Care writes, quote creation, payment, publication, provider work,
  mail delivery, and every commercial release remain held.

## Hosted assets

Register these two new immutable assets mechanically in the hosted build and
truth manifest only when the root composition lane wires the Care panel:

- `abracadabra/app/abracadabra-care-surfaces.js`
- `abracadabra/app/abracadabra-care-surfaces.css`

Mount only from the authenticated hosted account/operator shell. Do not add a
public Pages route or public capability. Preserve the module's text-only DOM
construction and do not replace it with raw HTML injection.

## Mail boundary

The port permits only `care-ticket-acknowledgment.v1`,
`care-ticket-update.v1`, or `care-ticket-resolved.v1`, with digest-only
recipient/subject/content evidence and a maximum seven-day reservation life.
Reservation is not sending, provider acceptance, or delivery. A later worker
lane must not activate delivery without separate owner authority and provider
readiness.

## Root-owned changes deliberately not made

- `server/hosted/http.mjs`
- `server/hosted/postgres-service.mjs`
- `scripts/hosted-truth/manifest.mjs`
- authenticated account/operator DOM composition and script tags
- worker purpose allowlists, deployment units, provider configuration

## Remaining gates

1. Owner-redlined Care catalog, price, capacity, cancellation, response-time,
   and fulfillment terms.
2. Quote/acceptance/payment/refund/accounting authority and customer-effect
   release.
3. Root-owned authenticated composition plus complete accessibility and
   release-candidate browser proof.
4. Mail composition/delivery worker authority, provider readiness,
   reconciliation, exception monitoring, and operator runbook.
5. Fulfillment workers/adapters, capacity alerts, backup/readback monitoring,
   and owner-gated deployment/cutover.
