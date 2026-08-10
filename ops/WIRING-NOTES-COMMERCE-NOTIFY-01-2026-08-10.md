# COMMERCE-NOTIFY-01 held wiring notes

Status: held. This packet creates durable, source-authoritative transition
notification reservations. PRO-LIFECYCLE-COMPOSE-02 now constructs the narrow
repository/domain boundary in the hosted root and requires its exact held
readiness for professional payment approval. It still does not compose a
transition hook, HTTP route, template renderer, provider adapter, worker,
customer UI, operator UI, delivery claim, or live alert.

## Exact authority

- A notification can be reserved only when the exact committed source appears
  in `ss.commerce_transition_notification_sources` with matching table, ID,
  revision, digest, state, audience, kind, and occurrence time.
- The outbox insert and its MAIL-01 `pending` reservation are one PostgreSQL
  transaction. Either both exist or neither exists.
- The outbox remains `held`, `provider_effects_authorized = false`, and
  `delivery_claimed = false`. A pending MAIL row means reserved only. Provider
  acceptance still does not mean delivered; only MAIL-01's exact `delivered`
  event can establish that later.
- Customer kinds use `commerce_customer_notification` and bind the exact
  source customer, active membership, organization, and project. Operator
  kinds use `commerce_operator_notification`, no customer identity, and may be
  globally scoped only for digest-only `invoice.finalization_failed` evidence.
- No body, subject, email address, phone number, token, checkout URL, raw
  provider identifier, provider payload, or provider error is stored in the
  outbox. MAIL-01 retains only the existing recipient, subject-reference, and
  content digests.
- Stripe reconciliation source keys are deterministic digests of the exact
  source table plus provider-event identity. Transition hooks must select that
  opaque key from the registry; they must not copy a raw `evt_` identifier into
  the outbox request or logs.

## Bounded transition registry

Customer reservations cover committed assessment quote, invoice preparation,
payment settlement, and report delivery; committed Custom quote, initial
invoice/payment, change quote/invoice/payment, completion, final invoice/payment,
and handoff; and verified professional reversal evidence.

Operator reservations cover assessment and all three Custom payment
reconciliation-required states, ambiguous professional reversal evidence, and
the queue's durable digest-only `invoice.finalization_failed` evidence.

Domain, Care, Alakazam, Download, support/privacy cases, account activation,
and account recovery are deliberately outside this registry. Their existing
authorities remain unchanged.

## Later composition

1. Preserve the current canonical PostgreSQL repository/domain construction.
2. After and only after a listed authoritative transition commits, pass its
   exact source reference and reviewed routing/content digests to `reserve`.
   Never reconstruct money or state from a browser request or provider payload.
3. Keep rendering and delivery separate. A reviewed template registry must
   bind `templateVersion` to the exact `contentDigest` before any future
   dispatcher may select these pending MAIL rows. This packet grants no such
   dispatcher.
4. Customer and operator read surfaces may consume the narrow read models
   later. Do not expose a public notification-creation HTTP endpoint.
5. MAIL-01 delivery exceptions already project into the integrated operator
   queue. Do not create a second notification-failure queue or mark an outbox
   reservation delivered from application code.

## Migration union

The current integration successor includes the additive union through
migration 117 and totals 70 migrations. PRO-LIFECYCLE-COMPOSE-02 adds none.
