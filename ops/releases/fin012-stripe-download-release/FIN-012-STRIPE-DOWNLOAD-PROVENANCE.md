# FIN-012 Stripe Download activation-stability provenance

Recorded: 2026-08-22T19:14:15-0400 EDT

## Input and bounded correction

- Protected-main input: `38232df3df6c82e8a50e64537fc7a88f0dd055e3`,
  tree `ea6f82ca721e1b29f01e718cca1355df31429207`.
- Branch: `fin012/stripe-download-activation-stability-20260822`.
- Implementation: `7321d1d190d0ace46100b15d1b8feeec6aeb5bb7`,
  tree `82afbfc4208902ae2890bec98f970d08b8afcc01`.
- Finding: approved-live Stripe construction correctly required runtime-key scope
  evidence no older than 15 minutes, but recurring readiness reapplied that age
  limit to the fixed process-activation evidence. A valid long-running process
  would therefore become not ready after 15 minutes.

The correction creates one immutable readiness lease only after a fresh exact
activation proof succeeds. Later readiness retains all identity, environment,
livemode, fingerprint, chronology, purpose, and future-evidence checks while
refusing clock rollback. It does not re-expire the already verified activation
proof. Live Product, Price, Coupon, Billing Portal configuration, and Webhook
Endpoint readbacks remain recurring provider readiness requirements.

Changed implementation paths are exactly:

- `ops/credential-topology.mjs`
- `server/commerce/adapters/stripe.mjs`
- `ops/test/stripe-restricted-key-topology.test.mjs`
- `server/hosted/test/stripe-production-config.test.mjs`

The hosted test change replaces one stale fixed runtime-scope timestamp with the
test-start instant. It does not change production policy.

## Local proof

- Focused Stripe/Download proof: 137 tests, 137 passed, zero failed.
- Clean repository install-integrity proof: 4 tests, 4 passed, zero failed.
- Complete canonical `npm test` under Node 24.18.0: exit zero.
- Product Node suite: 887 tests, zero failed.
- Hosted-service suite: 1,102 tests, 1,087 passed, 15 intentional PostgreSQL
  integration skips, zero failed.
- Operations suite: 239 tests, 239 passed, zero failed.
- Final pinned-browser audit: 24 hosted routes across six required width modes,
  including 720 pixels at 200% reflow, passed with exact-width layout and 44-pixel
  controls.
- The complete proof ran only after the implementation commit made the repository
  clean; all four release-install self-verification tests then passed.

## Effect and rollout boundary

No Stripe Customer, Checkout Session, PaymentIntent, Charge, Refund, Dispute,
subscription, or other provider mutation occurred during this correction. The
public runtime remained FIN-012 `14ca61bd0991c0d326699311e380c29c621931df`,
epoch `fin012-14ca61b-20260822`, with Stripe and Download held.

This correction alone grants no payment authority. Deployment must first install
the exact protected-main successor in held mode with retained rollback. Only then
may the separately owner-approved `$20` Download purpose load a freshly verified
restricted live Stripe topology. Assessment, Custom initial/change/final,
Alakazam, Domains, Twilio, publication, workers, and native distribution remain
held. Activation still requires an unpaid live Checkout proof and a public
readiness proof after the 15-minute boundary. No self-purchase or completed charge
is authorized by this record.

## Protected-main browser-audit correction

Recorded: 2026-08-22T19:42:45-0400 EDT

The protected-main Site quality run for merge commit
`4097d153ffd17586e91fe77eb9e2a75e91299204` reached the final browser gate after
all product, hosted-service, and operations tests passed. The browser gate then
reported one unauthenticated `404` for the paid-fixture change-invoice read. The
same commit's Controlled Pages deployment passed.

The failed request was an audit teardown race, not a product or Stripe failure.
Each paid journey deleted its fixture cookie while its page was still live. A
page's final asynchronous read could therefore arrive after authentication was
removed and fall through the fixture server's deliberate unknown-route `404`.
The correction in implementation commit
`029f7ea653e2ae6a8c78c35db42c8278ce9094ae`, tree
`fa364b9055e6fac43fe7bb343ab06e23e36ed473`, moves the browser to
`about:blank` and waits for completion before deleting the paid-fixture cookie.
It intentionally does not allowlist `404`, so a real missing route remains a
release failure.

The corrected exact commit passed a standalone 24-route by six-width browser
audit and then the complete clean Node 24.18.0 `npm test` ladder: 887 product
tests with zero failures; 1,087 hosted-service passes, 15 intentional PostgreSQL
skips, and zero failures; 239/239 operations tests; deterministic Pages and
hosted builds; and a second complete 24-route by six-width browser audit. No
provider, customer, payment, deployment, DNS, or production effect occurred.
