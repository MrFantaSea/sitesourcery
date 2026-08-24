# FIN-012 browser customer correction provenance

Recorded: 2026-08-24T14:03:18-0400 EDT
State: implementation proved; not pushed, reviewed, installed, or deployed

## Discovery

The supported Browser bridge opened the existing signed-in Download acceptance
project read-only. The exact `$20` control was not pressed and no Checkout
Session was created. Two customer presentation defects were visible:

1. the canonical Custom-build `completion_required` projection has
   `obligation:null`, but the refresh path dereferenced
   `snapshot.obligation.amount` before hiding the irrelevant final-payment
   panel; and
2. retained-premium controls mounted for an ordinary project with no Alakazam
   subscription, causing the held retained-premium endpoint to be presented as
   an error.

## Exact implementation identity

- Parent: `dd7efcb3c19a65b83561abf5bfc8f77a10f943c8`
- Implementation: `f56ea55ae70f984213df2672af025399ef3b0056`
- Tree: `b7aab3890ff9d49af97e5cfe2edfe8dc7c7e759a`
- Binary Git diff SHA-256:
  `ff1284955a0648e09398f5b3b134cb1d9c7d4e47620e7bb134abb8045a61dc7b`
- Machine-readable implementation receipt SHA-256:
  `25ab08a4226e0b58f3a8aedc33fbcc8b3fb3e74993427e8cfbe7f066e1d72ec2`

The implementation has exactly four changed paths:

| Path | SHA-256 | Purpose |
|---|---|---|
| `abracadabra/app/abracadabra-customer-control-dom.js` | `fec69c6174482ac42749317312c8f01437688f3ba8ad833d955521971c697257` | Null-safe zero-balance classification and subscription-relevant retained-premium mounting |
| `scripts/test/abracadabra-customer-controls.test.mjs` | `7db7e94a8f74a701d71b8088f0d3f25d9cf0d64bfa591f568e89c4b9976eed86` | Focused behavioral and wiring regression |
| `scripts/build-hosted.mjs` | `d5f74028773d82efb12050de06b2408e90f4f0b27dc1b82f77cfd99003808e02` | Exact reviewed hosted-staging asset digest |
| `scripts/hosted-truth/manifest.mjs` | `bfd684195358c2b4689645b22f50f6441dd5ca1a458782210d106561713935a4` | Exact canonical hosted asset digest |

No server route, database object, payment authority, provider adapter,
deployment control, public gateway, DNS record, publication path, service unit,
or retained rollback asset changed.

## Proof

- Focused exact Node 24.18.0 customer/API/retained-premium/hosted-control proof:
  105/105 passed.
- Deterministic hosted artifact built and verified; related customer, Alakazam,
  hosted-control, and hosted-artifact proof: 91/91 passed.
- Complete exact Node 24.18.0 product/client suite: all 889 cases passed. Its
  sandboxed launch passed 883 and denied six browser-layout cases only because
  temporary `127.0.0.1` listeners were forbidden with `listen EPERM`; the
  complete two-file loopback suite then passed 8/8 outside that restriction.
- `git diff --check`: clean.
- Generated `_hosted` output remained untracked and introduced no additional
  repository path.

## Effect posture and next gate

Checkout Session creation, Stripe mutation, payment, spend, database mutation,
customer data mutation, provider effect, deployment, public-byte change, DNS,
publication, and service mutation are all false.

This evidence does not authorize an install or deployment. The next step is a
provenance-only commit and protected review. After an independently authorized
install, the same live journey must be inspected read-only and both defects must
be absent before requesting fresh action-time confirmation for exactly one
unpaid `$20` Download Checkout Session. Card entry and completed payment remain
unauthorized.
