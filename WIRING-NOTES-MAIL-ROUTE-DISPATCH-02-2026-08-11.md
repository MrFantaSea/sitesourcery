# MAIL-ROUTE-DISPATCH-02 held wiring note — 2026-08-11

This increment remains local and held by default. It adds no hosted entrypoint,
environment switch, secret lookup, provider registration, worker process, or
provider call.

## Raw-body event adapter

`server/hosted/resend-mail-events-http.mjs` owns the standalone
`POST /api/v1/webhooks/resend` adapter contract. Its caller must provide the
exact request `Buffer` and original headers; parsed or re-serialized JSON is
rejected. The adapter returns HTTP 200 only after signed ingress returns an
explicit durable MAIL-01 receipt in `applied`, `pending`, or `conflict` state.
Unknown/unauthorized event types, invalid signatures, held ingress, lifecycle
failure, and malformed receipts cannot produce a 200 response.

The adapter is not registered in `server/hosted/http.mjs` or
`server/hosted/bin/server.mjs`. Those files remain under separate ownership.

## Durable dispatch claim

Migration `202608110118_hosted_mail_dispatch_claims.sql` adds one forced-RLS,
digest-only claim row per support/commerce MAIL-01 reservation. It stores no
recipient, subject, content, template data, raw provider ID, or provider
credential. Claim inserts must bind an exact held support or commerce
reservation and a pending MAIL-01 message.

`notification-mail-dispatch-postgres.mjs` provides the system-only claim port:

- leases are 30 seconds through five minutes;
- same-worker replay returns the same attempt and fence;
- another worker sees `busy` until lease expiry;
- an expired lease can advance only to the next attempt/fence;
- every retry retains `sitesourcery-notification/<message-id>` as its provider
  idempotency key;
- a MAIL-01 acceptance or terminal state closes and clears the lease before a
  later worker can send again;
- claim rows cannot be deleted.

If a process stops after the provider accepted but before MAIL-01 acceptance,
the higher-fence retry must use that same provider key. If it stops after
MAIL-01 acceptance but before claim completion, the next claim reconciles the
authoritative MAIL-01 evidence and returns `already_recorded` without provider
access.

## Private resolution and composition

`notification-mail-private-resolver.mjs` keeps recipient lookup and template
rendering behind separate no-provider-effect ports. The combined renderer
recomputes recipient, subject-reference, and content digests before the
dispatcher may send. No concrete private data store or production template
registry is selected here.

`mail-route-dispatch-composition.mjs` composes the standalone route, renderer,
and dispatcher. Its default is entirely held. Explicit enablement requires all
three reviewed boundary kinds and still does not register a route or worker.

## Remaining external gates

- Owner-controlled Resend API/webhook secrets and exact verified sending
  domain/from-address authority.
- DNS/TLS, tracking/privacy posture, Resend webhook subscription, and public
  route registration against exact deployed bytes.
- A reviewed private recipient store and template registry for each bounded
  support/commerce notification kind.
- A worker process with explicit enablement, shutdown, batch/backoff limits,
  monitoring, and operational retry policy.
- Exact-runtime provider acceptance, delivery/failure, complaint/suppression,
  lease recovery, and alerting evidence. Local fake/PostgreSQL proof does not
  authorize customer email.
