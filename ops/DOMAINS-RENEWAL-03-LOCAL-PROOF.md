# DOMAINS-RENEWAL-03 local proof

Status: provider-neutral held contract only. No provider, payment, refund, DNS,
credential, publication, deployment, or production authority.

## Implemented boundary

- `server/domain/provider-lifecycle.mjs` validates authoritative lifecycle
  readback against the immutable provider pin and retains exact expiration,
  lifecycle, transfer eligibility/lock/status, observation, and digest-only
  provider-reference evidence.
- Renewal uses a current no-charge exact quote, fresh expiry, exact amount and
  price class. Reservation becomes durable in the repository port before any
  possible worker effect, but the returned reservation explicitly says both
  provider and payment effects are unauthorized.
- Renewal/transfer outcomes are classified as `not_submitted`, `submitted`, or
  `uncertain`; no outcome can claim success directly. Success requires later
  authoritative provider readback with the matching operation digest.
- Same command/input replays exactly; a command ID reused with different input
  conflicts. Ambiguous attempts cannot be automatically re-reserved.
- Expiry can never move backwards. Financial renewal reversal retains the
  provider-observed term and custody. Transfer cancellation requires matching
  provider readback, completed transfer cannot be locally reversed, and the old
  provider pin remains historical evidence.
- Unrecognized provider-side pending/completed transfer state becomes an
  operator review rather than a local provider switch.
- Customer/operator projections omit raw provider domain, quote, and operation
  references. They expose only digests and keep provider/payment/DNS effect
  flags false.
- `server/domain/adapters/memory-lifecycle-repository.mjs` proves the repository
  contract locally and reports `canonicalPersistence: false`. Its canonical
  persistence successor is documented in
  `DOMAINS-LIFECYCLE-PERSISTENCE-04-LOCAL-PROOF.md`.

## Deterministic proof

```sh
/private/tmp/node-v24.18.0-darwin-arm64/bin/node --test \
  server/domain/test/provider-lifecycle.test.mjs \
  server/domain/test/provider-contingency.test.mjs \
  server/domain/test/service-provider-contingency.test.mjs \
  server/hosted/test/domain-price-charge-boundary.test.mjs \
  server/data-plane/tests/postgres-migration-structure.test.mjs
```

The proof uses only deterministic memory/fake read ports. It makes no network
or external provider call.

## Remaining gates

- Canonical migration 123 and its held PostgreSQL repository are now locally
  proven; hosted composition and provider effects remain separate gates.
- Implement approved registrar readback, renewal quote, renewal effect, and
  transfer effect/reconciliation adapters with exact scopes and staging proof.
- Wire authenticated customer/operator HTTP, consent, notification, worker,
  manual-payment authorization/capture, ambiguity, refund/dispute, and support
  journeys to the canonical lifecycle state.
- Obtain written reseller/agency authority, approved secondary provider,
  restricted credential/contact vaults, and versioned TLD/renewal/transfer/
  privacy/WHOIS/irreversible-effect consent.
- Complete provider-fee and customer-price tax classification and Stripe Tax
  registrations/settings.
- Prove real expiry notices, grace/redemption, renewal, failed/ambiguous
  renewal, reversal/refund, outbound transfer cancellation/completion, custody,
  DNS continuity, and retained provider evidence.

Automatic renewal remains absent and fail-closed.
