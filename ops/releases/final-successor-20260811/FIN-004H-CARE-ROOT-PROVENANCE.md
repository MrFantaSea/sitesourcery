# FIN-004H Care root provenance

Date: 2026-08-12  
State: implementation sealed; exact clean-tree cumulative proof pending  
Candidate branch: `integration/final-successor-20260811`

## Authority and source

- Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`.
- Preserved union donor: `a81d1438fd57e62e44b917c803988301945ef2ef`.
- Care leaf implementation already integrated and proved by FIN-004D at
  `167c575`.
- FIN-004H is a root-owned composition repair. It does not import another
  branch, add a migration, alter provider configuration, or lift an effect.
- The preserved `responder-surfaces` lane `b40334fc` was inspected but remains
  deliberately outside this Care-only commit. It is the next separate cohort.

## Changed paths

- `server/hosted/care-surfaces-http.mjs`
- `server/hosted/http.mjs`
- `server/hosted/bin/server.mjs`
- `server/hosted/test/http-care-composition.test.mjs`
- `server/hosted/test/care-production-composition.test.mjs`
- `server/hosted/test/http-capabilities-snapshot.test.mjs`
- `server/hosted/test/http-commerce-v2.test.mjs`
- this provenance record and `BUILD-LEDGER.md`

## Composition and authority

The production process now constructs exactly one PostgreSQL Care core
repository, passes that same instance to the Care surface repository, wraps
the existing durable mail lifecycle through its reservation-only interface,
and constructs the held-local Care service. Startup requires ready and
verified core/mail-reservation state and rejects any claimed customer,
delivery, payment, or provider effect.

The canonical HTTP root mounts the existing nine-route Care boundary without
copying Care command behavior into the root router. Care dispatch occurs after
same-origin and webhook handling but before the generic JSON consumer, so a
Care command body has exactly one bounded reader. Root request IDs and security
headers are retained on the boundary response.

The isolated Care lane assumed an authenticated actor already contained an
organization ID, while the production identity session contains only the user
and session. FIN-004H resolves that mismatch without guessing:

- a customer with exactly one active organization selects it automatically;
- a multi-organization customer must provide
  `X-SiteSourcery-Organization-Id`;
- the selected value must match an active organization returned by the
  authenticated organization authority;
- operator routes derive the target organization only from the exact route and
  remain subject to the existing PostgreSQL capability checks.

## Routes and capability

Mounted routes are the nine exact entries in `CARE_SURFACE_HTTP_ROUTES`:

- customer read and held ticket request;
- operator dashboard, period open/close, ticket open/transition, capacity
  allocation, and mail reservation.

`/api/v1/capabilities` now reports `care` from actual composed readiness. A
missing Care composition reports `false`; only ready, verified, effect-held
Care reports `true`.

## Effects, workers, and providers

- Customer Care creation remains held.
- Mail is reservation-only; there is no send or delivery authority.
- Payment, publication, and provider effects remain false.
- No worker purpose or worker allowlist changed.
- No credential, external listener, public placeholder, DNS, Cloudflare,
  GitHub Pages, Dell runtime, HQ listener, or database was mutated.

## Focused proof

Node `24.18.0` focused run:

- 38 tests passed across Care service, PostgreSQL adapter, leaf HTTP, root HTTP,
  production composition, capability snapshot, and commerce capability
  regression suites;
- syntax checks and `git diff --check` passed.

The pre-commit complete `npm test` run proved all 792 application tests with
782 passes and 10 intentional skips. Operations proved 201/205; the four
remaining install dry-run assertions rejected only because the implementation
worktree was intentionally dirty. That is the expected release-control
behavior. The exact clean-tree run is required immediately after this commit
and will replace this pending state with its final evidence.

## Remaining blockers

- FIN-004I: reconcile and mount the preserved Responder surfaces over the
  newer union core.
- Responder fulfillment and the remaining explicit worker purposes.
- FIN-005 outside-lane disposition closure.
- FIN-006 root/cross-system contract closure, including all six retained HQ and
  Dell adjacent systems.
- FIN-007 through FIN-010 catalog/public/legal, database epoch, clean candidate,
  staging, acceptance, and owner-approved cutover.
