# Hosted runtime boundary

`bin/server.mjs` is the production composition root for the first-party hosted
API and the private customer-site runtime. It requires exactly Node 24.18.0,
binds both listeners to `127.0.0.1`, verifies the canonical PostgreSQL
migrations, and refuses startup when a configured production dependency is not
ready.

The entry point does not turn on payments, registrar operations, DNS changes,
email, publication, or public deployment. Checkout, registrar, and DNS remain
explicit held provider boundaries. Repository and system publication holds
remain in force, and no code removes them.

`GET /api/v1/health` and `GET /api/v1/ready` are the only sessionless probe
routes. They run before authentication and CSRF, return only the service name
and one boolean, and never expose dependency configuration or diagnostics.
Stripe webhooks remain the separate raw-body, signature-authenticated route.

## Domain runtime

`domain-postgres-runtime.mjs` supplies the normalized PostgreSQL domain
contract, but its default composition is held. The tested customer sequence is
quote/contact/consent, a separate Stripe Checkout manual authorization, fresh
registrar reprice, one registrar submission, operation/domain/customer-
registrant readback, partial capture of the final registrar amount, active
registration, and verified DNS writes or deletes.

The order response contains only the same-origin
`/api/v1/domain-orders/{id}/payment?projectId={projectId}` route. The server persists a Checkout URL
only after accepting an exact `https://checkout.stripe.com` response from
Checkout creation. Before returning a `303`, the relay rechecks tenant
ownership, local expiry, and a fresh pending Stripe readback bound to the exact
session, amount, currency, manual-capture mode, and purpose digest. Browser
input and webhook payloads are never payment authority.

Approved-live composition still requires explicit environment-scoped owner
approval, Stripe and Spaceship credentials, the reviewed legal documents,
encrypted contact-vault wiring, and authoritative registrar final-charge
evidence. The current Spaceship REST response does not itself prove that final
charge, so the live adapter deliberately stops before capture without an
approved billing bridge. Auto-renew, billed renewal, and transfer-out remain
held. The browser must also send the selected `projectId` for quote and
registrant-contact commands before the customer journey is complete.

## Required configuration

- `SITESOURCERY_DATABASE_URL`
- `SITESOURCERY_IDENTITY_PEPPER`, base64 for at least 32 bytes
- `SITESOURCERY_CONTACT_VAULT_KEY`, base64 for exactly 32 bytes
- `SITESOURCERY_SPARK_COMPILER_SHA256`, the reviewed compiler source digest
- `SITESOURCERY_OFFER_CATALOG_PATH`, the reviewed catalog JSON file

The data, export, port, base-domain, and PostgreSQL TLS environment variables
have fail-closed defaults in `bin/server.mjs`. Both HTTP ports must be distinct,
unprivileged loopback ports behind a reviewed reverse proxy.

## Account-email delivery modes

`SITESOURCERY_REGISTRATION_MAIL_MODE` accepts exactly:

- `production` (the default): startup readiness requires a verified transport;
- `held`: account creation stays unavailable and sends no email;
- `dev-sink`: an in-memory test sink, rejected when `NODE_ENV=production`.

Production registration transport code is loaded only from the absolute path in
`SITESOURCERY_REGISTRATION_TRANSPORT_MODULE`. That reviewed module must export
`createRegistrationTransport()` and return an object with `readiness()` and
`sendRegistration()` methods matching `registration-mail-port.mjs`.

`SITESOURCERY_RECOVERY_MAIL_MODE` accepts exactly:

- `production` (the default): startup readiness requires a verified transport;
- `held`: recovery returns the manual-operator customer state and sends no
  email;
- `dev-sink`: an in-memory test sink, rejected when `NODE_ENV=production`.

Production transport code is loaded only from the absolute path in
`SITESOURCERY_RECOVERY_TRANSPORT_MODULE`. That reviewed module must export
`createRecoveryTransport()` and return the narrow transport contract documented
by `recovery-mail-port.mjs`. Merely naming a module does not make it ready: its
readiness result must be both `ready` and `verified`.

No registration or recovery token, recipient, or action URL is included in
public API responses, startup output, or durable provider-receipt facts.

## Publication authorization

Serving remains held when any configured hold file exists or when the separate
approval file is absent. The source tree intentionally contains
`server/hosted/PUBLICATION_HOLD`; removing or bypassing it is an owner-controlled
launch operation, not a build step.

The database, server compiler, accepted version, screening, paid entitlement,
and verified address form one exact publication proof. See
`PUBLICATION-PORT.md` for the transaction, compensation, and retry contract.

## Stripe production composition

`bin/server.mjs` constructs exactly one Stripe adapter and injects that same
instance into the hosted service. Checkout, Billing Portal, cancellation, and
the raw `/api/v1/webhooks/stripe` signature-verification path therefore cannot
silently use different credentials or modes.

`SITESOURCERY_STRIPE_MODE` defaults to `held`. Production composition accepts
only `held` or `approved_live`; it rejects `contract_test` even though the
provider adapter retains that mode for isolated no-network contract tests.
Selecting `approved_live` does not remove the publication hold and is not itself
owner authorization.

Approved composition requires every item below:

- `SITESOURCERY_DEPLOYMENT_ENVIRONMENT`: exactly `staging` or `production`.
  Staging is pinned to Stripe test mode; production is pinned to live mode.
- `SITESOURCERY_STRIPE_API_VERSION`: exactly `2026-06-24.dahlia`.
- `SITESOURCERY_STRIPE_LIVEMODE`: exactly `false` for staging or `true` for
  production.
- `SITESOURCERY_STRIPE_APPROVAL_JSON`: the exact JSON approval object, with no
  extra fields. It contains `provider`, `approved`, `environment`, `livemode`,
  `apiVersion`, `approvalId`, `approvedAt`, and `capabilities`.
- `SITESOURCERY_STRIPE_SECRET_KEY`: a server-only `sk_test_` or `sk_live_` key
  matching the bound environment and livemode.
- `SITESOURCERY_STRIPE_WEBHOOK_SECRET`: the server-only `whsec_` signing secret
  for the same Stripe endpoint.
- `SITESOURCERY_STRIPE_PRICE_EXPECTATIONS_JSON`: a non-empty JSON array of exact
  Price ID, livemode, USD amount, and recurrence expectations.
- `SITESOURCERY_STRIPE_APPROVED_RETURN_ORIGINS_JSON`: a non-empty JSON array of
  exact HTTPS origins.
- `SITESOURCERY_STRIPE_CHECKOUT_SUCCESS_URL`,
  `SITESOURCERY_STRIPE_CHECKOUT_CANCEL_URL`, and
  `SITESOURCERY_STRIPE_PORTAL_RETURN_URL`, all on an approved origin.
- `SITESOURCERY_STRIPE_TAX_MODE`: exactly `automatic` or
  `disabled_by_owner`.

The approval must include all hosted capabilities: `checkout:create`,
`billing_portal:create`, `prices:read`, `subscriptions:cancel`, and
`webhooks:verify`. Domain capabilities are all-or-none. If approved, they also
require:

- `SITESOURCERY_STRIPE_DOMAIN_SUCCESS_URL_TEMPLATE`;
- `SITESOURCERY_STRIPE_DOMAIN_CANCEL_URL_TEMPLATE`;
- `SITESOURCERY_STRIPE_DOMAIN_AUTHORIZATION_DISCLOSURE`.

Both templates contain the exact `{ORDER_ID}` placeholder, and the success
template also contains `{CHECKOUT_SESSION_ID}`. Configuring domain templates
without the complete manual-authorization capability set fails startup.

`SITESOURCERY_STRIPE_CHECKOUT_TTL_SECONDS` is optional and remains bounded by the
adapter. Approved startup calls Stripe readiness, including exact Price
readback, and refuses startup if readiness is not exact. Startup and worker logs
emit only an allowlisted readiness projection; secret keys, webhook secrets,
Price IDs, approval IDs, and return URLs are never serialized.

## Durable worker inventory

Only a durable job with an implemented lease and exact effect-certainty contract
may be started automatically.

| Work | Production behavior | Recovery truth |
| --- | --- | --- |
| Subscription cancellation | A bounded, non-overlapping worker calls `processPaymentOutbox()` only in `approved_live` mode. It uses the existing `FOR UPDATE SKIP LOCKED` lease. | Confirmed effects settle once. Known no-effect failures become eligible after the service-owned five-minute delay. Ambiguous effects are held at PostgreSQL `infinity` and require separately reviewed operator reconciliation; the worker cannot retry them. |
| Project export | A bounded, non-overlapping worker starts only when `SITESOURCERY_EXPORT_WORKER_MODE=enabled`. Every claim carries the v15 attempt number, expiring lease, worker identity, and monotonic fence token. | A worker may reclaim only an expired lease. Immutable object keys include the attempt and fence; stale workers cannot overwrite or finalize a newer claim. Ambiguous object facts become bounded failed/manual-retry evidence rather than an automatic replay. |
| Publication/release | No background worker is started. | Publication is synchronous through the private in-process port. A local finalization failure is recovered only by replaying the exact idempotent customer command; the audit outbox row is not treated as deployment authority. |

Cancellation worker polling is bounded by these optional settings:

- `SITESOURCERY_PAYMENT_WORKER_BATCH_LIMIT` (default `10`, maximum `100`);
- `SITESOURCERY_PAYMENT_WORKER_INTERVAL_MS` (default `5000`);
- `SITESOURCERY_PAYMENT_WORKER_ERROR_BACKOFF_MS` (default `5000`);
- `SITESOURCERY_PAYMENT_WORKER_MAXIMUM_BACKOFF_MS` (default `60000`).

Cycles run serially, cycle failures use capped exponential backoff, and shutdown
aborts the wait then awaits any active leased cycle before closing PostgreSQL.
The worker does not define provider retry policy; durable row eligibility and
effect certainty remain owned by the service transaction.

The export worker is independently held unless
`SITESOURCERY_EXPORT_WORKER_MODE=enabled`. Its batch, interval, and capped
backoff settings are bounded by `export-worker.mjs`. Shutdown aborts work before
an object write when possible, then awaits any active fenced cycle before
closing PostgreSQL; once object bytes exist, the exact attempt/fence key is
reconciled instead of blindly repeated.
