# MAIL-HOSTED-WIRING-03 held wiring — 2026-08-11

This local integration composes the sealed operator/support and mail lanes. It
does not contain a credential, activate a worker, call Resend, register a
webhook, expose a public origin, or change provider/DNS/production state.

## Hosted provider-event route

The canonical hosted API now owns `POST /api/v1/webhooks/resend` before its
session/CSRF routes. It accepts the original request `Buffer` only, enforces the
exact method and JSON media type, caps the body at the lower of the ingress
webhook limit and 64 KiB, and rejects a declared/actual Content-Length mismatch.
The adapter can return 200 only for a durable MAIL-01 `applied`, `pending`, or
`conflict` receipt, including a known replay. Public errors and startup output
contain no raw body, signature, provider ID, recipient, or secret.

`SITESOURCERY_RESEND_WEBHOOK_MODE` defaults to `held`. Verified mode requires a
separate valid `SITESOURCERY_RESEND_WEBHOOK_SIGNING_SECRET` and ready MAIL-01
storage. Supplying the secret while held or enabling without it fails startup.
The public capability projection exposes one boolean `mailProviderEvents`; it
does not expose secret or provider-event details.

## Notification dispatch worker

The API remains loop-free. The separate worker registry adds the canonical
`notification-mail` purpose. Its dedicated mode defaults to `held`, in which
the factory opens neither a renderer nor a provider port.

`approved_live` requires all of the following before provider construction:

- exact configured Resend API key and domain identity; provider readiness then
  verifies that exact domain before the supervisor can start the loop;
- an absolute `/etc/sitesourcery/mail/*.mjs` private-renderer path;
- the exact reviewed SHA-256 for that bounded regular, final-component
  non-symlink module.

The worker lists only pending support/commerce MAIL-01 identities that have no
active claim, processes at most 25 sequentially, uses 30-second through
five-minute leases, and preserves one provider idempotency key across fencing
and crash recovery. It never overlaps cycles, applies bounded exponential
backoff, logs aggregate counts and safe error codes only, forwards supervisor
abort, and awaits its active batch during shutdown.

## Remaining external gates

- Owner-controlled Resend API and webhook signing credentials, verified sender
  domain/from authority, disabled tracking readback, and provider webhook
  registration.
- Install the reviewed `ops/notification-mail-private-renderer.mjs` as
  root-owned bytes and bind its exact module digest, registry digest, and
  private operator recipient. Care remains reservation-only until its durable
  dispatch-source lane is separately reviewed.
- Exact hosted/worker installation, database migration 118 application,
  worker approval file, public ingress/DNS/TLS, operational alerts, and live
  accepted/delivered/failed/bounced/complained/suppressed recovery evidence.
