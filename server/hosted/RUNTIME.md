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

## Domain runtime

`domain-postgres-runtime.mjs` supplies the normalized PostgreSQL domain
contract, but its default composition is held. The tested customer sequence is
quote/contact/consent, a separate Stripe Checkout manual authorization, fresh
registrar reprice, one registrar submission, operation/domain/customer-
registrant readback, partial capture of the final registrar amount, active
registration, and verified DNS writes or deletes.

The order response contains only the same-origin
`/api/v1/domain-orders/{id}/payment` route. The server persists a Checkout URL
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

## Recovery delivery modes

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

No recovery token, recipient, or recovery URL is included in public API
responses, startup output, or durable provider-receipt facts.

## Publication authorization

Serving remains held when any configured hold file exists or when the separate
approval file is absent. The source tree intentionally contains
`server/hosted/PUBLICATION_HOLD`; removing or bypassing it is an owner-controlled
launch operation, not a build step.

The database, server compiler, accepted version, screening, paid entitlement,
and verified address form one exact publication proof. See
`PUBLICATION-PORT.md` for the transaction, compensation, and retry contract.
