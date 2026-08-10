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

`GET /api/v1/health` remains the retained minimal compatibility probe.
`GET /api/v1/live` reports only process liveness, the fixed service identity,
and a validated PII-free release identity; it performs no database, provider,
or filesystem-wide work. `GET /api/v1/ready` uses a bounded short-TTL,
singleflight dependency snapshot and reports only fixed states, codes, age, and
latency buckets. It retains the `ready` and `service` fields consumed by the
origin and independent monitors. Dependency configuration and diagnostics are
never returned. Customer capabilities remain a separate fail-closed route and
are not granted by either probe. Stripe webhooks remain the separate raw-body,
signature-authenticated route.

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
- `SITESOURCERY_POSTGRES_BUDGET_CONFIG`, the exact non-secret v1 timeout and
  pool budget. Startup fails closed when it is missing or malformed. Statement,
  lock, and idle-transaction limits are transaction-local; canonical
  acquisition is deadline-bound. The default held example preserves the
  existing ten-connection ceiling and admits at most eight API transactions so
  two physical slots remain reserved for the external worker process.
- `SITESOURCERY_IDENTITY_PEPPER`, base64 for at least 32 bytes
- `SITESOURCERY_ENGAGEMENT_TOKEN_SECRET`, independent base64 for at least 32 bytes
- `SITESOURCERY_IDENTITY_PEPPER_CONFIG`, the exact versioned v1 metadata
  contract naming the current writer and zero to three prior verifier-only
  versions. It contains no secret material; startup fails closed when the
  contract or any referenced root-owned secret variable is incomplete.
- `SITESOURCERY_CONTACT_VAULT_KEY`, base64 for exactly 32 bytes
- `SITESOURCERY_SPARK_COMPILER_SHA256`, the reviewed compiler source digest
- `SITESOURCERY_OFFER_CATALOG_PATH`, the reviewed approved catalog JSON file,
  when commerce is enabled. Leave it unset to keep catalog publication, quotes,
  and Checkout explicitly held while the account and project runtime operates.

`SITESOURCERY_LICENSED_BASE_DOMAIN` defaults to the owner-approved
`sitesourcery.me`, so a platform address is exactly
`label.sitesourcery.me`. The self-host runtime, hosted service, and public
commercial control import or test the same authority; do not introduce an
extra subdomain layer that would change the address sold to the customer.

The data, export, port, base-domain, and PostgreSQL TLS environment variables
have fail-closed defaults in `bin/server.mjs`. Both HTTP ports must be distinct,
unprivileged loopback ports behind a reviewed reverse proxy.

Migration 021 installs the exact V2 product, privacy, and website document
authority used by project creation. Readiness verifies those versions and the
SHA-256 digests of the reviewed hosted legal artifacts before the runtime can
claim that saved projects are available.

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

The approved production adapter is `resend-mail-transport.mjs`; the same
absolute module path is used for registration and recovery. It sends from
`Site Sourcery <accounts@sitesourcery.com>` with replies directed to
`sitesourcery@proton.me`. It requires `SITESOURCERY_RESEND_API_KEY` and the
exact `SITESOURCERY_RESEND_DOMAIN_ID`. Readiness fails closed unless Resend's
live domain response identifies `sitesourcery.com`, reports sending enabled,
reports the domain and all SPF/DKIM records verified, and reports both open and
click tracking disabled. Provider errors and response bodies are never copied
into public errors.

`SITESOURCERY_REGISTRATION_BASE_URL` and
`SITESOURCERY_RECOVERY_BASE_URL` default to the production Abracadabra page.
An isolated staging runtime may set both to its exact HTTPS Abracadabra page;
the adapter then accepts only links on that configured page. Production keeps
both values at `https://sitesourcery.com/abracadabra/app/`.

Activation remains a separate operator step. Follow `ops/RESEND-SETUP.md`; do
not change either mail mode from `held` until its DNS and private end-to-end
proof are complete.

No registration or recovery token, recipient, or action URL is included in
public API responses, startup output, or durable provider-receipt facts.

Every ready recovery delivery is reserved in PostgreSQL before the mail
provider is called. A provider error, invalid receipt, or interrupted
finalization leaves a terminal reconciliation state; automatic replay never
risks sending the same security message twice. The reservation stores no
recipient, token, or action URL.

## Isolated shipped-page account proof

When `SITESOURCERY_PG_SERVICE_TEST_URL` names a new disposable PostgreSQL
database, the service integration suite applies the ordered migrations and
drives the reviewed `_hosted` page in the pinned browser through account
creation, activation, project/version save, sign-out, and sign-in. It inspects
the real cookie flags and PostgreSQL rows and refuses any payment, domain,
publication, or rollback request during that browser journey.

```sh
SITESOURCERY_PG_SERVICE_TEST_URL=postgresql://test-role@127.0.0.1:5432/disposable_database \
  node --test --test-concurrency=1 server/hosted/test/postgres-service.integration.test.mjs
```

The command mutates the supplied database. The caller must prove the database
is disposable before the run and remove it afterward; the test never creates,
drops, or substitutes a database on its own.

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
- `SITESOURCERY_STRIPE_SECRET_KEY`: preferably a least-privilege server-only
  `rk_test_` or `rk_live_` restricted key matching the bound environment and
  livemode. Matching `sk_test_`/`sk_live_` keys remain accepted only for
  bootstrap and emergency rotation.
- `SITESOURCERY_STRIPE_WEBHOOK_SECRET`: the server-only `whsec_` signing secret
  for the same Stripe endpoint.
- `SITESOURCERY_STRIPE_WEBHOOK_ENDPOINT_ID` and
  `SITESOURCERY_STRIPE_WEBHOOK_ENDPOINT_URL`: the exact mode-matched `we_` ID
  and public HTTPS ingress URL. Startup reads the endpoint back and requires it
  to be enabled, pinned to `2026-06-24.dahlia`, application-unowned, and bound
  to the exact reviewed event set.
- `SITESOURCERY_STRIPE_PRICE_EXPECTATIONS_JSON`: a non-empty JSON array of exact
  Price ID, livemode, USD amount, recurrence, and `exclusive` tax-behavior
  expectations.
- `SITESOURCERY_STRIPE_APPROVED_RETURN_ORIGINS_JSON`: a non-empty JSON array of
  exact HTTPS origins.
- `SITESOURCERY_STRIPE_CHECKOUT_SUCCESS_URL`,
  `SITESOURCERY_STRIPE_CHECKOUT_CANCEL_URL`, and
  `SITESOURCERY_STRIPE_PORTAL_RETURN_URL`, all on an approved origin.
- `SITESOURCERY_STRIPE_PORTAL_PRIVACY_POLICY_URL` and
  `SITESOURCERY_STRIPE_PORTAL_TERMS_OF_SERVICE_URL`. Alakazam readiness reads
  the Portal configuration back and requires both exact legal URLs plus the
  direct Portal login page disabled.
- `SITESOURCERY_STRIPE_TAX_PURPOSE_AUTHORITY_JSON`: one exact approved
  `sitesourcery.stripe-tax-purpose-authority/v1` object. Its `purposes` map has
  exactly `download`, `serviceAssessment`, `customBuildStart`,
  `customBuildChange`, `customBuildFinal`, `alakazam`, `siteService`, and
  `domainRegistration`. Each enabled purpose is independently
  `automatic` or `disabled_by_owner`; Domain is exactly `null` while Domain
  payment remains held. The current pre-effective website-service decision is
  `disabled_by_owner`. `defaultTaxBehavior` remains `exclusive` in either
  mode, so collection mode cannot weaken Price tax behavior.
- `automaticActivation` in that authority is exactly `null` while no purpose
  collects automatically. Any future `automatic` purpose requires a separate
  approved `sitesourcery.stripe-automatic-tax-activation/v1` object whose
  purpose set and `taxreg_` IDs match exactly and whose `effectiveAt` has
  arrived. A scheduled registration alone never activates collection.
- `SITESOURCERY_STRIPE_TAX_CODES_JSON`: the exact purpose map. Download,
  assessment, Custom first/change/final payments, and website service use the
  reviewed Website Design code; Alakazam uses the reviewed Website Hosting
  code. Every inline Price carries an explicit `tax_behavior=exclusive` and
  Product tax code. `domainRegistration` must remain `null` while domain
  authorization is held and becomes mandatory before domain capability can be
  approved.
- `SITESOURCERY_STRIPE_TAX_ATTESTATION_JSON`: a dated, authority-matched owner
  attestation of the full Stripe Tax settings/registration readback. Startup
  requires an approved attestation, an exact head-office country, default
  exclusive behavior, and either exact `taxreg_` IDs or an explicit
  `none_registered` decision. An automatic activation must bind the same
  attested registrations. Missing account setup is never inferred.

Integration ordering is append-only: Engagement migration
`202608100106_customer_engagement_bootstrap.sql`, Mail migration
`202608100107_durable_mail_lifecycle.sql`, professional-services reversals
`202608100108_professional_services_reversals.sql`, then TAX-PURPOSE-01
`202608100109_stripe_tax_purpose_authority.sql`. This isolated lane contains
only migration 109; the integration verifier must seal the exact 62-file union.

The approval must include all hosted capabilities: `checkout:create`,
`billing_portal:create`, `prices:read`, `subscriptions:cancel`,
`webhook_endpoints:read`, and `webhooks:verify`. Domain capabilities are
all-or-none. If approved, they also require:

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

The `$200` custom-services assessment has a separate release switch:
`SITESOURCERY_CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE` defaults to `held` and
accepts only `held` or `approved`. `approved` refuses startup unless the shared
Stripe adapter is ready with the exact `serviceAssessment` purpose decision and
the assessment-specific webhook, readback, and atomic-settlement boundary
reports its exact readiness schema.
Approval also requires the held professional-lifecycle readiness contract:
Engagement, v108 plus held v117 direct-reversal normalization, source-bound
notification reservation, MAIL reservation, the bounded operator queue, and
projection-only accounting must all read back exactly. This readiness sends no
mail and grants no provider, automatic-restoration, generic-repair, or
authoritative-accounting effect.
The invoice projection and payment command consume the same immutable release
object, so a held runtime exposes no pay button and performs no provider payment
effect.

The accepted Custom-build first installment has its own release switch:
`SITESOURCERY_CUSTOM_BUILD_PAYMENT_MODE` also defaults to `held` and accepts only
`held` or `approved`. Approved startup requires ready Stripe with the exact
`customBuildStart` purpose decision, Custom-build quote storage, and the exact
payment boundary that verifies Stripe readback, atomically settles the reserved
`$200` assessment credit, and opens one build job. The customer submits only the
retained invoice digest; subtotal, credit, deadline, tax policy, and final
handoff amount remain server-owned.
The same held professional-lifecycle readiness is mandatory for the Custom
initial, accepted-change, and final approval assertions.
Neither switch authorizes a deployment, public release, DNS change, or production
credential change.

## Durable worker inventory

Only a durable job with an implemented lease or exact idempotent lifecycle
fence and effect-certainty contract may be started automatically. The API
process starts no worker loop. The separately held `bin/worker.mjs` process is
the sole production background-loop start authority; its exact purpose
allowlist, narrow ports, and independent PostgreSQL reserve are documented in
the WORKERS-01 and WORKERS-02 notes.

| Work | Production behavior | Recovery truth |
| --- | --- | --- |
| Subscription cancellation | The API starts no polling loop. The external process receives only the exact cancellation readiness and `processPaymentOutbox` port. A held or unverified Stripe readback prevents every worker from starting; its existing `FOR UPDATE SKIP LOCKED` lease is unchanged. | Confirmed effects settle once. Known no-effect failures retain the service-owned delay. Ambiguous effects remain held at PostgreSQL `infinity`; no new retry policy exists. |
| Project export | The API starts no export loop. The external process receives only the exact export readiness and `processQueuedExports` port. `SITESOURCERY_EXPORT_WORKER_MODE` remains held by default. Existing attempt, lease, worker identity, and fence-token authority is unchanged. | A worker may reclaim only an expired lease. Immutable object keys and stale-worker fencing remain authoritative. |
| Alakazam fulfillment/publication | The separate worker process uses the existing leased fulfillment state machine only after exact release, compiler, repository, address, and publication-hold readback. | Publication remains a stage of the fulfillment lease; dark compensation and exact retry evidence are unchanged. There is no generic publication job engine. |
| Alakazam lifecycle/retention | The separate worker process uses the existing exact seven-day grace and retained-expiry state machine only after release, policy, and repository readback. | Retained exit and purge remain exact-evidence, deterministic-idempotency operations. No earlier purge authority is added. |

The existing cancellation worker polling options remain bounded in its
external narrow composition. If an old purpose-specific interval/backoff
variable is present, it must equal the supervisor's versioned loop values:

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
