# MAIL-01 durable lifecycle wiring notes

Status: held. This packet adds durable state and performs no provider or email
effect. Production composition must continue to use the held adapter until a
separate, reviewed mail cutover packet is authorized.

## Canonical components

- Migration: `202608100107_durable_mail_lifecycle.sql`
- Runtime marker: `canonical-ss-v54-durable-mail-lifecycle`
- Domain: `server/hosted/mail-lifecycle.mjs`
- PostgreSQL repository: `server/hosted/mail-lifecycle-postgres.mjs`
- Production-safe default: `createHeldMailLifecycle()`

The ledger supports `account_activation`, `account_recovery`, and
`support_notification`. A reservation begins `pending`. A transport's durable
acceptance fact advances it to `provider_accepted`, never `delivered`. Only an
idempotently ingested, signature-verified provider event can produce
`delivered`, `bounced`, `complained`, or `suppressed`; the expiry worker can
produce `expired` after the stored deadline.

## Required future composition

1. Keep `createHeldMailLifecycle()` in the production composition root.
2. A future provider webhook adapter must authenticate the request and validate
   its signature before calling `ingestProviderEvent`. It may pass only the
   normalized event kind, bounded provider key, event/message identifier
   digests, signature-verification digest, evidence digest, and provider time.
3. A future transport adapter must reserve first, perform one separately fenced
   provider effect, and record `provider_accepted` only from the provider's
   acceptance receipt. No body, recipient, subject, action URL, token, raw
   provider identifier, or webhook payload may enter this ledger or logs.
4. A future expiry worker may call `expire` idempotently after `expiresAt`.
5. The operator exception surface must use `listOwnerExceptions` and retain its
   `service_case_manage` capability check. Do not query the tables from a UI.

Do not configure a Resend secret, enable a webhook, or switch an email producer
as part of MAIL-01. The repository has no network dependency and advertises
`providerEffects: false` in readiness.

## Existing-flow migration blocker

`registration-mail-port.mjs` and `recovery-mail-port.mjs` currently turn a
transport `{ accepted: true }` receipt into public state `delivered`. Their
identity callers also persist that older state and, for registration, use it in
the activation sequence. Those flows must not be pointed at MAIL-01 by a simple
adapter substitution. A later account-mail migration must change their durable
schemas and caller semantics together, preserve enumeration-safe responses and
idempotency, and prove that activation/recovery behavior no longer treats
provider acceptance as delivery.

Support notifications likewise have no MAIL-01 producer in this packet. Adding
one is composition work, not a database default.

## Logging and observability boundary

Logs may contain a generated request/correlation ID, lifecycle operation name,
safe error code, and success/failure outcome. They must not contain recipients,
recipient digests, subjects, content/body material, action URLs, tokens,
provider message/event identifiers or their digests, webhook payloads, or
signature material. The owner projection exposes only scope IDs, message type,
exception kind, a non-routing safe-reference digest, time, and revision.
