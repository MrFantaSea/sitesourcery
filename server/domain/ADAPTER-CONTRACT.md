# Adapter contract

## Repository

Production persistence must implement the same semantics as the memory adapter:

1. `claimCommand` durably inserts a tenant-scoped pending fingerprint.
2. A command replay with the same fingerprint returns the stored public result.
3. A changed fingerprint conflicts.
4. `commit` performs order CAS, audit append, outbox append, and optional command
   completion in one transaction.
5. A pending command or `*_dispatching` order is a stop sign after restart.
6. `getOrder`, audit, and outbox queries require `tenant_id` in the key and
   predicate. Filtering after an unscoped read is forbidden.

`migrations/001_domain_orchestration.sql` is the storage contract. It deliberately
contains no PII, card data, API credentials, raw EPP codes, or delivery tokens.

## Payment

The production payment adapter must use server-side manual capture.

- Authorization metadata must contain the exact `purposeDigest`, tenant,
  customer, order, domain, and purpose kind.
- The adapter must return the provider's observed amount, currency, capture
  mode, purpose digest, and authorization expiry; it must not merely echo
  caller input without provider verification.
- Authorization, void, capture, and refund idempotency keys must reach the
  provider unchanged and must be checked during reconciliation.
- Capture happens only after verified registered-domain and registrant-contact
  readback.
- Capture never exceeds customer consent. If the provider amount is lower,
  customer capture is lower.
- Refund response amount, currency, and purpose must be verified. An ambiguous
  refund is not retried until provider reconciliation proves the prior effect.
- The domain remains customer-owned after a capture/refund failure.

## Registrar

The launch adapter must map only capabilities proven by dated official provider
documentation:

| Port | Required behavior |
| --- | --- |
| `ensureContacts` | Idempotently save/read encrypted-vault-derived customer contact data; return opaque IDs |
| `previewRegistration` | No-charge confirmation preview with exact integer USD price or fail closed |
| `confirmRegistration` | Irreversible billed call; one dispatch after durable attempt |
| `getOperation` | Read async pending/success/failed state |
| `getDomain` | Read lifecycle, dates, verification, and contact IDs |
| `assessTransferOut` | Read current provider/registry eligibility, including transfer locks |
| `setTransferLock` | Explicit mutation; never blindly toggle |
| `getAuthCode` | Return raw secret only to the orchestration call stack |

Every failed billed registrar call must be classified:

- `not_submitted`: authoritative evidence proves no billed provider effect;
- `ambiguous`: timeout, reset, malformed accepted response, crash, missing
  operation ID, or any result where acceptance cannot be excluded.

Unknown failures are ambiguous. Spaceship does not publicly document an atomic
maximum-price guard or registration idempotency key, so local idempotency is not
permission to repeat an ambiguous confirmation.

`adapters/spaceship.mjs` implements these REST capabilities with a fixed
official origin and injected transport/clock/vault. Its ordinary REST
availability check is not price authority for standard domains. The
`pricePreview` dependency must return a current exact integer USD result from
the dated, documented no-charge preview contract or registration stays held.
The adapter does not implement or assume a generic MCP OAuth/token transport.

The documented REST HTTP 202 registration response provides an async operation
ID but not a final provider charge. The adapter therefore returns no
provider-observed price at confirmation. Payment capture remains in review
until separate authoritative registrar billing evidence exists.

There is intentionally no renewal mutation port. Current public Spaceship
documentation does not provide a safe general exact standard-domain renewal
preview. Notices/manual review may be added, but automatic billed renewal stays
absent until the provider contract changes and is re-reviewed.

## Contacts and one-time secrets

Full registrant PII belongs in a dedicated encrypted contact vault. Orders hold
only an opaque profile reference/digest and provider contact IDs.

Raw EPP/auth codes must move directly from the registrar adapter to an
authenticated, short-lived, single-use delivery service. The secret adapter
returns only a receipt. Logs, errors, traces, audit, outbox, command replay,
support tickets, and exports must never contain the raw code.

## Held state

Held remains the default external composition. It returns authoritative
`not_submitted` refusals and never plausible provider data. Constructing the
Spaceship adapter in live mode requires explicit environment-bound owner
approval, a provider written-consent reference, exact capabilities, injected
vaults, and an exact-price source. This repository supplies none of those.
`adapters/fake.mjs` is test-only and requires `mutationMode: "fake"` plus an
order-, tenant-, domain-, quote-, and environment-scoped execution approval.
