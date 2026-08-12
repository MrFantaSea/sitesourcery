# MAIL-EVENTS-01 held wiring note — 2026-08-11

This change adds reusable local boundaries; it does not enable a public route,
provider credential, delivery worker, or customer email.

## Provider-event ingress

`server/hosted/resend-mail-events.mjs` verifies the Resend/Svix signature over
the exact bounded raw request bytes using `svix-id`, `svix-timestamp`, and every
offered `v1` signature. It rejects stale/future timestamps, malformed headers,
non-JSON content types, invalid UTF-8/JSON, unknown event types, and unbounded
bodies before calling the durable mail lifecycle. Secrets, raw provider IDs,
addresses, and payloads are not passed to or stored by the lifecycle.

Reviewed terminal mappings are:

- `email.delivered` -> `delivered`
- `email.bounced` -> `bounced`
- `email.failed` -> `bounced` (the existing durable terminal-delivery-failure
  equivalent: owner exception, but no complaint-derived suppression)
- `email.complained` -> `complained`
- `email.suppressed` -> `suppressed`

Nonterminal delivery/tracking events and unknown event types fail closed. The
event endpoint must be subscribed only to the reviewed terminal inventory, so a
provider inventory or subscription change cannot silently gain authority or
receive a success response without durable acceptance.

The `svix-id` digest is the durable event identity. At-least-once replay and
out-of-order monotonicity remain owned by
`mail-lifecycle-postgres.mjs`: an identical replay returns the recorded inbox
state; different evidence under one identity conflicts; and a late event cannot
roll a terminal state backward. Complaint and suppression events durably create
recipient suppression rows. Bounce/failed events create an owner exception but
do not automatically assert complaint authority.

No HTTP route is wired here. A later authorized route must preserve the raw
body before JSON middleware, pass its headers and raw `Buffer` to `ingest()`,
and return HTTP 200 only from the returned `httpStatus` after an explicit
durable lifecycle receipt (`applied`, `pending`, or `conflict`, including a
known replay). Verification, unauthorized event types, lifecycle, or receipt
errors must not return 200.

## Support/commerce dispatcher

`server/hosted/notification-mail-dispatcher.mjs` provides one boundary for the
already-reserved `support_notification`, `commerce_customer_notification`,
`commerce_operator_notification` message types. It loads the durable
reservation, renders private content through an injected renderer, recomputes
recipient/subject-reference/content digests, uses a stable message-ID provider
idempotency key, and records provider acceptance through the existing mail
lifecycle. Acceptance remains distinct from delivery. Terminal reservations
never call a renderer or provider. The default dispatcher is held.

## Remaining production gates

- Owner-controlled Resend API and webhook-signing secrets must be supplied by
  the canonical secret/config authority; neither is present here.
- The exact sending domain/from-address must be provider-verified, with the
  required DNS/TLS and tracking/privacy decisions proven in the target runtime.
- An authorized public raw-body route must be registered with Resend and proven
  against exact deployed bytes.
- A durable source lease/claim implementation, private recipient resolver,
  reviewed template registry, and bounded retry worker must connect the
  support/commerce outboxes to the dispatcher. Provider idempotency is defense
  in depth, not a replacement for that lease.
- Exact-runtime evidence must separately prove provider acceptance, delivery,
  bounce/failed exception handling, complaint/suppression, replay, and
  out-of-order behavior. None is claimed by these local fakes.
