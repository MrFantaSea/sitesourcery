# MAIL-WIRING-02 — held bridge from the legacy account-mail contracts onto the MAIL-01 ledger

Status: **held**. This packet adds an internal representation and a held bridge.
It opens no socket, reads no secret, constructs no transport, and performs no
provider or email effect. The production composition roots are **not** edited by
this packet. Moving any live flow onto the bridge is a later, separately
authorized composer step (a founder decision), described below.

## What this packet fixes

The legacy ports turn a transport `{ accepted: true }` answer (Resend returns
200 the instant it *accepts* a message for its own queue) into a public receipt
whose `state` is `"delivered"`. A later hard bounce is never reconciled, so a
bounced recovery mail reads as delivered and the account owner is silently
locked out.

The bridge represents the same two contracts with the honest lifecycle the
MAIL-01 ledger already models:

| State | Meaning | Who may set it |
| --- | --- | --- |
| `reserved` (`pending` in the ledger) | a send is durably reserved BEFORE any dispatch | `reserve` |
| `accepted-by-provider` (`provider_accepted`) | the provider accepted the message for its queue | `recordProviderAcceptance` |
| `delivered` / `bounced` / `complained` / `suppressed` | a real, signature-verified provider delivery/bounce signal arrived | `ingestProviderEvent` only |

**Acceptance is never delivery.** `deliver()` records a reservation and then a
held acceptance and returns `state: "accepted-by-provider"`. It never emits
`"delivered"`, and there is no code path from acceptance to a terminal delivery
state. `delivered`/`bounced` stay unreached because no provider-event signal is
wired yet.

## Canonical components (added by this packet)

- Bridge + held composition/readiness helper: `server/hosted/mail-delivery-bridge.mjs`
  - `createHeldMailDeliveryBridge({ lifecycle, registrationBaseUrl, recoveryBaseUrl, clock })` → `{ registration, recovery }` ports (`kind`, `mode: "held-bridge"`, `providerEffects: false`, `readiness()`, `deliver()`).
  - `createHeldBridgedMailComposition({ lifecycle?, ..., clock? })` → held-by-default readiness/composition helper. With no `lifecycle` it uses `createHeldMailLifecycle()` so every `deliver()` fails closed. It accepts **no transport** and throws `MAIL_BRIDGE_SWITCH_LIFT_FORBIDDEN` if asked to lift the switch (`allowProviderEffects` or `transport`).
- Tests: `server/hosted/test/mail-delivery-bridge.test.mjs`
- Reused MAIL-01 canon (unchanged): `server/hosted/mail-lifecycle.mjs`, `server/hosted/mail-lifecycle-postgres.mjs`, migration `202608100107_durable_mail_lifecycle.sql`, runtime marker `canonical-ss-v54-durable-mail-lifecycle`.

The bridged receipt is a new contract:

```
{ schema, contract, mode: "held", providerEffects: false,
  state: "accepted-by-provider", provider: "held",
  messageId, idempotencyKey, payloadDigest, acceptedAt, expiresAt, receiptId }
```

Note it carries the durable `messageId` and **no** `providerMessageId`; the held
provider message id exists only as a digest inside the ledger.

## Migration decision — NO new migration

**No `202608100111_*.sql` is added.** The MAIL-01 `…107` schema already
distinguishes `pending` (reserved), `provider_accepted` (accepted-by-provider),
and `delivered`/`bounced`/… as separate states, and its trigger already makes
`delivered` reachable only from a provider event — never from acceptance. The
bridge records reservation and held acceptance using the existing columns and
states, so the reservation/acceptance distinction needs no schema change. The
`…111` slot is intentionally left unreserved.

## What a composer must add, and where (NOT done in this packet)

These are composition-root edits. This packet deliberately does not make them
(hard boundary: no root edits, no cross-scope customer-API change). They are the
cutover checklist.

### 1. Build a durable lifecycle and the held bridge composition

The bridge only records once a durable repository is present; until then keep it
held. In `server/hosted/bin/server.mjs`:

```js
// add to the import block (near the other hosted composition imports)
import { createHeldBridgedMailComposition } from "../mail-delivery-bridge.mjs";
import { createMailLifecycle } from "../mail-lifecycle.mjs";
import { createPostgresMailLifecycleRepository } from "../mail-lifecycle-postgres.mjs";

// where the mail ports are constructed today (registration ~L667-668,
// recovery ~L740-741), build ONE held bridge composition instead:
const mailLifecycle = createMailLifecycle({
  repository: createPostgresMailLifecycleRepository({ authority }),
  clock: commerceV2.clock
});
const bridgedMail = createHeldBridgedMailComposition({ lifecycle: mailLifecycle });
// registration port  -> bridgedMail.registration
// recovery port      -> bridgedMail.recovery
```

- To stay fully held during cutover, pass no `lifecycle` (or
  `createHeldMailLifecycle()`); `deliver()` then rejects with
  `MAIL_LIFECYCLE_HELD` and readiness reports not-ready — a safe default.
- Registration port is passed to `createPostgresIdentityBridge({ ...,
  registrationMailPort })` (`bin/server.mjs` ~L669-677). Recovery port is passed
  to `createCanonicalPostgresService({ ..., recoveryMailPort })` (~L744-753).
  Substitute `bridgedMail.registration` / `bridgedMail.recovery` there.

### 2. Update the two receipt gates to accept acceptance (the cross-scope step)

Both callers currently *require the receipt to claim delivery*. That predicate is
the bug surface. When the bridge is adopted, change acceptance-as-delivery to
acceptance-as-acceptance:

- **Recovery** — `server/hosted/postgres-service.mjs` ~L5860-5880. The gate
  `receipt?.state === "delivered"` must become `receipt?.state ===
  "accepted-by-provider"`. The sibling checks `receipt.mode === recoveryReadiness.mode`
  and `receipt.provider === recoveryReadiness.provider` must be reconciled to the
  bridge's held vocabulary (`mode` held, `provider === "held"`), and the
  `receiptFacts`/`provider_receipts` row (already keyed `recovery_delivery_accepted`)
  must use `messageId` in place of `providerMessageId`. Recovery must NOT be
  treated as complete on acceptance; it is accepted, delivery unknown.
- **Registration** — `server/hosted/identity-postgres.mjs` ~L727-737 gate
  `receipt?.state === "delivered"`, and the durable write
  `ss.hosted_registration_requests.state = 'delivered'` (~L775-777). On mere
  acceptance the request is accepted, not delivered; persist an acceptance state
  and only mark delivered/activated on a real signal. The `receiptFacts` block
  (~L738-749) must adopt `messageId` and drop `providerMessageId`.

This step changes durable caller semantics and is intentionally out of this
packet's scope. It requires its own review (and likely a small additive change
to the `hosted_registration_requests` / recovery request state vocabulary), and
must re-prove enumeration-safe responses and idempotency end to end.

### 3. Recovery needs a resolved customer account, and enumeration safety stays in the caller

`account_recovery` reservations require a `customerUserId` (UUID). The bridged
recovery `deliver()` therefore takes `customerUserId` in its input. The caller
must resolve email → account id **before** calling the bridge and must keep
returning the existing generic/decoy response for unknown accounts (do not
reserve, do not reveal existence). The bridge itself branches on nothing
account-specific and adds no oracle; held `deliver()` rejects identically for any
recipient.

### 4. Provider events / real send remain future work

A real cutover still needs (a) a durable lifecycle repository wired to a
Postgres authority, then (b) a separately authorized, signature-verifying
webhook adapter calling `ingestProviderEvent` to reach `delivered`/`bounced`,
and (c) a fenced real transport that reserves first and records
`provider_accepted` only from a genuine provider receipt. None of that is in this
packet. Do not configure a Resend secret, enable a webhook, or move any producer
off held here.

## Logging and observability boundary

Unchanged from MAIL-01: logs may carry a correlation id, operation name, safe
error code, and outcome only — never recipients or their digests, subjects,
bodies, action URLs, tokens, provider message/event identifiers or their
digests, or signature material. The bridged receipt and the ledger records hold
digests only.
