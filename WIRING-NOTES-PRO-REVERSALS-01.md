# PRO-REVERSALS-01 L4 wiring notes

PRO-LIFECYCLE-COMPOSE-02 status: the repository/domain boundary and its exact
v108 plus direct-normalization-v117 readiness are now constructed in the
hosted production root through the held professional-lifecycle aggregate. It
is available only to the existing bounded operator-queue reconciliation port.
The shared Stripe-router registration, customer capability, and mutation gates
described below remain held; no raw Stripe event is routed to this service.
This supersedes only the earlier constructor residual.

This packet intentionally does not edit the shared HTTP, server-composition,
Stripe-router, account-projection, or Custom-work roots. Migration 108 and the
new modules remain inert until L4 applies every gate below. No provider method
in this packet creates a refund, dispute, charge, Checkout Session, or
PaymentIntent.

## Server composition

`server/hosted/bin/server.mjs` now constructs the local evidence boundary only
through `createProfessionalLifecycleProductionComposition`. Preserve that one
aggregate owner rather than constructing a duplicate reversal service.

Do not pass `stripeComposition.adapter` to this constructor. The absence of a
provider port is the no-refund/no-charge invariant.

Professional dependency readiness requires `ss.hosted_runtime_contract_v108()`,
the three forced-RLS migration-108 tables, their exact grants, and the held
`ss.direct_custom_reversal_normalization_contract_v1()` marker from migration
117. Liveness does not depend on these checks. Customer reversal capability
remains false until all access/credit/quote gates below are integrated.

## Verified Stripe evidence

`server/hosted/stripe-webhook-router.mjs` currently verifies exact raw bytes at
lines 94-130 and dispatches existing payment purposes at lines 132-229. L4 must
add one argument named `professionalServicesReversal` and validate only
`recordEvidence` and `reconcileEvidence`; it must not add a provider port.

Do not pass a raw Stripe object directly to `recordEvidence`. Add an L4-owned
pure normalizer before registration that emits the exact
`professionalReversalEvidence` input and satisfies these rules:

- Resolve one professional receipt by its PaymentIntent before choosing an
  organization. Reject zero or multiple matches as `not_professional_services`
  or reconciliation-required; never guess from customer-controlled metadata.
- Treat `charge.refunded` as verified only when Charge amount, cumulative
  `amount_refunded`, currency, PaymentIntent, and local receipt total agree.
- Treat `refund.failed` as verified zero reversal. Treat a Refund object without
  cumulative Charge readback as ambiguous, not as a partial or full refund.
- Treat dispute funds-withdrawn/reinstated and closed won/lost as verified only
  when PaymentIntent, dispute amount, currency, and local receipt total agree.
  All incomplete or conflicting events are ambiguous evidence.
- Persist a bounded non-secret facts projection and its canonical digest; do
  not persist the whole webhook payload, billing address, email, or card data.
- Return any result other than `not_professional_services` before the existing
  canonical fallback at current lines 230-232. Replay the same provider event
  through the same function; never retry or initiate money movement.

Pass the composed service into `createStripeWebhookRouter` near current
`server/hosted/bin/server.mjs` lines 847-855 only after the normalizer tests are
green. Until then, keep professional reversal capability held rather than
silently routing unnormalized events.

## Operator reconciliation HTTP

In `server/hosted/http.mjs`, add an operator-only boundary argument named
`professionalServicesReversal` next to the Custom payment boundaries currently
validated around lines 548-568. Register exactly one route beside the existing
operator payment-reconciliation routes at current lines 1224-1309:

```text
POST /api/v1/operator/custom-services/payment-reversals/:evidenceId/reconciliation
```

Pass the authenticated operator object and an exact body containing
`organizationId`, `commandId`, `expectedLifecycleRevision`, `resolution`,
`confirmedOutcome`, `verifiedFacts`, `verifiedFactsDigest`, and
`verifiedObservedAt`. Do not expose a customer refund route. Map stale revision
to 409, unavailable evidence to 404, and repository conflict to 500. The DB
function independently requires `service_payment_reconcile` and one exact
revision.

## Access, credit, and quote gates

All existing immutable reports, invoices, receipts, progress records, and
handoff documents remain readable. No migration-108 consequence deletes or
rewrites customer evidence. L4 must add one lifecycle lookup to each mutation
transaction and apply the following exact behavior:

| Lifecycle | Existing records | New assessment/Custom work | Credit | Quote authority |
| --- | --- | --- | --- | --- |
| `active` | readable | unchanged | unchanged | unchanged |
| `held` | readable | reject 409 | block unapplied; freeze reserved; never reissue settled | reject 409 |
| `terminated` | readable | reject 409 | block unapplied; freeze reserved; never reissue settled | reject 409 permanently |

Required integration seams:

- `server/hosted/custom-services-assessment-work-postgres.mjs`: keep
  `readCustomerReport` at current lines 1531-1625 readable, but mask its credit
  as unavailable when the assessment receipt lifecycle is held or terminated.
  Gate every owner mutation/delivery transaction on active lifecycle.
- `server/hosted/custom-services-custom-build-postgres.mjs`: extend the source
  query at current lines 1034-1051 and every issue/accept/void mutation with a
  `not exists` active-lifecycle failure for the source assessment receipt and
  the accepted Custom initial receipt. Never release or create another credit
  because of a reversal.
- `server/hosted/custom-services-custom-build-work-postgres.mjs`,
  `server/hosted/custom-services-custom-build-progress-postgres.mjs`, and
  `server/hosted/custom-services-custom-build-change-completion-postgres.mjs`:
  reject all writes unless every payment lifecycle bound to that job is
  `active` and not reconciliation-required.
- `server/hosted/custom-services-custom-build-change-payment-postgres.mjs` and
  `server/hosted/custom-services-custom-build-final-payment-postgres.mjs`:
  reject new Checkout reservation/provider dispatch when any job payment is
  held, terminated, or ambiguous. Continue evidence ingestion only; never
  retry an uncertain provider effect.
- `server/hosted/custom-services-custom-build-handoff-postgres.mjs`: preserve
  customer read access and the `handed_off` projection at current lines
  943-989. Reject new handoff mutation unless all bound payment lifecycles are
  active. A reversal never claws back or deletes an already delivered document.
- `server/hosted/custom-services-account-postgres.mjs` and
  `server/hosted/custom-services-account-hosted.mjs`: project a non-secret
  account-attention state and the exact access/credit/quote consequences. Do
  not change the hot customer DOM in this packet.

Use `payment_purpose` plus `payment_receipt_id` for every join. Never join on a
provider object alone, and never infer a Custom job consequence from an
assessment receipt without following the stored credit/application/quote/job
FK chain represented by `ss.service_professional_payment_bindings`.

## Release hold

Keep the customer and operator capability switches held until:

1. the pure verified-event normalizer is implemented and proven for all four
   payment purposes;
2. all mutation gates above are applied atomically by L4;
3. readiness distinguishes liveness, dependency readiness, and customer
   capability; and
4. owner-approved customer communication and operator runbook copy exists.

These are composition dependencies, not permission to change Stripe, release,
DNS, deployment, or production state.
