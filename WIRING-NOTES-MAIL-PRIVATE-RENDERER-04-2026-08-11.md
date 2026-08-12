# MAIL-PRIVATE-RENDERER-04 held wiring — 2026-08-11

This local packet adds no credential, real recipient, provider call, mail send,
HTTP route, migration, installation, approval, or production authority.

## Reviewed standalone renderer

`ops/notification-mail-private-renderer.mjs` is a standalone Node module that
can be installed later as one root-owned regular file under
`/etc/sitesourcery/mail/`. The worker already opens the configured file with a
no-follow final component, bounds and stably reads it, verifies its exact
SHA-256, and imports only those verified bytes.

The module defaults to `held`. Reviewed mode requires the independently
configured template-registry digest
`7d9d2c440484930d30fc0440c8976f5447463c0c2d81bae332832924498e4b57`
and one private canonical operator recipient. The worker compares the module's
registry digest, complete ordered version allowlist, and no-log/no-arbitrary-
content policy before constructing any provider port.

## Templates and private resolution

The registry contains exactly five support-case, 21 committed commerce-
transition, and three current Care template versions. Every version has a
separate template digest, exact audience/message/source authority, typed bounded
variables, fixed subject, and canonical text and HTML. Preview output also
contains the exact recipient, subject-reference, and content digests required
by the durable reservation; no caller can supply body or subject text.

The private resolver performs bounded read-only system queries. Customer mail
resolves only the active account tied to the exact support/commerce reservation.
Operator mail resolves only the configured canonical address when that account
has current `service_payment_reconcile` authority. Recipient, reservation,
event kind, state, revision, template version, registry, and all output digests
are rechecked before provider access. Source and tests contain no logging or
transport interface.

Care already reserves the existing `support_notification` lifecycle type, but
its current surface is explicitly reservation-only and has no migration-118
claim source. Its three templates therefore support deterministic preview and
digest reservation now while renderer dispatch remains fail-closed.

## Remaining external gates

- Install the reviewed renderer bytes with root ownership and bind their exact
  file digest plus the pinned registry digest.
- Configure one real authorized operator recipient privately.
- Install owner-controlled Resend credentials and verified sender/domain/from
  authority with tracking disabled, then register the signed webhook.
- Separately review Care's durable claim source before enabling Care delivery.
- Prove accepted, delivered, failed, bounced, complained, suppressed, replay,
  recovery, alerting, and rollback on the exact installed release.
