# Domain review runbook

No item below authorizes a provider mutation.

## `payment_authorization_failed_or_ambiguous`

Do not create a second authorization. Query the payment provider by the exact
idempotency key and purpose metadata. Resume only after proving whether an
authorization exists and recording operator evidence.

A persisted `payment_authorizing` state after restart receives the same
treatment. The absence of a stored authorization ID does not prove the provider
received nothing.

## `confirm_dispatching` after restart or `confirm_unknown`

Do not retry registration.

1. Search the registrar portfolio for the exact domain.
2. Inspect any known async operation.
3. Verify registrar billing.
4. Read the domain's registrant contact ID and compare it with the order.
5. If registered to the customer, protect the domain and reconcile capture.
6. If authoritative evidence proves not registered and not billed, void the
   authorization.
7. If evidence conflicts, keep the case open and escalate to registrar support.

Domain deletion is never a recovery mechanism.

## `active_payment_review`

The registrar may own an active customer domain while customer settlement is
unresolved. Never delete, transfer, darken, or substitute the domain. Reconcile
the provider charge, registrant contact mapping, and idempotent payment capture.

A persisted `active_payment_pending` state after restart is also a manual stop.
Query the capture idempotency key before any payment action.

## `refund_unknown`

Query the payment provider by refund idempotency key and capture ID. Do not
blindly issue another refund. The domain remains the customer's property
regardless of refund state.

A persisted `refund_dispatching` state after restart is treated as unknown until
the payment provider proves the effect.

## `transfer_review`

First read the current registrar transfer lock and one-time delivery receipt.
Do not blindly toggle the lock or copy an auth code into chat, email, logs, or a
ticket. Reissue only through the one-time secret channel after current state is
known.

A persisted `transfer_dispatching` state after restart follows the same rule:
inspect lock and delivery state first.

## Renewal review

Do not call a billed renewal endpoint. Current public documentation lacks the
safe exact no-charge standard renewal preview required by the orchestration.
Ensure the customer receives expiration notices and registrar registrant
messages. Any manual exception needs exact-price customer consent, payment
evidence, provider billing evidence, and owner approval.

## Shared registrar-account incident

Spaceship customer portfolio subaccounts/tenant isolation are not publicly
documented. Treat a shared account as portfolio-wide blast radius.

1. Stop new registrar mutations.
2. Preserve orders, audit, outbox, contact-vault references, and custody
   exports.
3. Reconcile expirations and transfer deadlines first.
4. Notify affected registrants through verified channels.
5. Engage provider support without initiating a chargeback as a first response.
