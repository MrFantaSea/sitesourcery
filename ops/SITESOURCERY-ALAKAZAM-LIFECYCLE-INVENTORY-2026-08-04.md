# Site Sourcery Alakazam Lifecycle and Reconciliation Inventory

Date: 2026-08-04

Baseline: `build/sitesourcery-v2-20260730` at `671e094` (`Compose held Alakazam account truth`)

Purpose: Batch 2 lifecycle mapping only

Release status: inventory, not release authorization

## 1. Scope and conclusion

This document maps the smallest safe path from the existing Alakazam Stripe/PostgreSQL billing spine to truthful customer and owner lifecycle states. It does not approve cancellation, grace, suspension, retention, refund, dispute, or support policy.

The short conclusion is:

- Start, activation, fixed-difference upgrade, renewal-boundary downgrade, and a read-only customer account projection have concrete Alakazam services and tests.
- Migration `023` deliberately names most later lifecycle states and event kinds, but those names are safeguards and schema capacity, not proof that the lifecycle exists.
- At the checkpoint, ordinary renewal, failed-payment, cancellation, and terminal subscription events do not reach an Alakazam lifecycle service. Some fall into the older canonical commerce processor; recurring `customer.subscription.updated` events can be mistaken for replay of an already-completed start, upgrade, or downgrade.
- The older canonical lifecycle and the defensive Download reversal processor contain useful patterns, but they operate on different tables and include policy that the owner has not approved for Alakazam. They cannot be copied as product truth.
- Renewal success is the first largely policy-neutral vertical slice. Failure consequences, grace, suspension, period-end cancellation, retention/export limits, and reversal consequences require explicit owner rulings before customer-visible behavior is enabled.
- No Alakazam lifecycle release gate should open until routing is ownership-aware, provider facts are read back, each transition commits atomically, customer truth is proven in a browser, and owner-only reconciliation has bounded repair actions.

Concurrent uncommitted work after `671e094` is not counted as proof in this inventory. At the time this file was created, other workers owned changes in the active run and Alakazam billing/PostgreSQL files; this mapper did not inspect or modify those changes.

## 2. Authorities and non-authorities

The inventory uses these sources in this order:

1. Newest owner rulings in `ops/CONTINUITY.md`.
2. The release and ownership rules in `ops/SITESOURCERY-MULTI-AGENT-ROADMAP-2026-08-04.md` and `ops/SITESOURCERY-ACTIVE-RUN.md`.
3. The held billing contract in `ops/ALAKAZAM-BILLING-CONTRACT-2026-08-02.md`.
4. Executable constraints in migrations `023` through `031`, current services, adapters, routing, and tests.
5. Older canonical commerce code only as an engineering-pattern reference.
6. Stripe documentation only for external event and object semantics, never for Site Sourcery policy.

Important exclusions:

- `ops/OPERATOR-BACKEND-SPEC.md` identifies itself as simulated and fictional. It is not authority for marking invoices paid, granting tiers, comping service, issuing refunds, or choosing retention.
- `server/hosted/constants.mjs` defines the older system's `RETENTION_DAYS = 90`. That is not an approved Alakazam retention rule.
- The older billing migration's 14-day grace and 90-day retention behavior are not approved Alakazam rules.
- The current public July 22 site is not evidence that the held Alakazam backend is released.
- A Stripe status name does not by itself decide what Site Sourcery publishes, serves, retains, or tells a customer.

### 2.1 Audited source set

The checkpoint audit covered:

- Roadmap/run truth: `ops/SITESOURCERY-MULTI-AGENT-ROADMAP-2026-08-04.md`, `ops/SITESOURCERY-ACTIVE-RUN.md`, `ops/CONTINUITY.md`, and `ops/ALAKAZAM-BILLING-CONTRACT-2026-08-02.md`.
- Customer projection: `server/commerce-v2/alakazam-account.mjs`, `server/commerce-v2/hosted-alakazam-account.mjs`, `server/hosted/alakazam-postgres.mjs`, and the matching account/HTTP tests.
- Webhook composition: `server/commerce-v2/alakazam-webhook.mjs`, `server/hosted/stripe-webhook-router.mjs`, `server/commerce-v2/index.mjs`, `server/hosted/bin/server.mjs`, and their routing tests.
- Alakazam contract and services: migrations `202608020023` through `202608040031`, every `server/commerce-v2/alakazam-*.mjs` transition module, the Stripe adapter, focused unit tests, hosted repository tests, and `server/data-plane/tests/alakazam-postgres-contract.integration.test.mjs`.
- Older canonical lifecycle: `server/hosted/postgres-service.mjs`, `server/hosted/cancellation-worker.mjs`, `server/hosted/export-worker.mjs`, `server/hosted/export-object-store.mjs`, `server/hosted/RUNTIME.md`, and their integration/worker tests.
- Defensive reversal reference: `server/commerce-v2/payment.mjs` and `server/commerce-v2/test/payment.test.mjs`.
- Operations/owner material: `ops/monitor-ports.mjs`, `ops/ACCEPTANCE.md`, `ops/PRODUCTION-MONITOR-2026-08-02.md`, and the explicitly non-authoritative `ops/OPERATOR-BACKEND-SPEC.md`.

## 3. Current architecture at the checkpoint

### 3.1 Proven Alakazam spine

The following behavior has dedicated Alakazam code and focused tests:

- Customer/account provisioning and one current subscription contract.
- A `$5` Abracadabra credit can be consumed once in an eligible Alakazam start or upgrade path.
- `$25`, `$35`, and `$50` are the only held subscription tiers.
- Start checkout dispatch and payment settlement are fenced.
- Start activation reads the Stripe subscription back and applies one atomic local activation.
- Upgrades charge the exact tier difference, apply one Stripe item change with no proration, and confirm the local tier from provider readback.
- Downgrades are scheduled for the renewal boundary, with no downgrade refund or proration, and activate locally only after provider confirmation at the boundary.
- Replayed or uncertain transition work is fenced to avoid duplicate provider effects.
- The customer account route projects local subscription, period, pending change, and receipt facts without exposing provider identifiers.
- Every account write action is still `false`; the account page is observational, not a working control surface.
- The hosted webhook composition is held behind an explicit release gate.

These facts are evidenced by migrations `024` through `031`, the corresponding modules under `server/commerce-v2/`, `server/hosted/alakazam-postgres.mjs`, and their unit/PostgreSQL journey tests.

### 3.2 Schema capacity that is not an implementation

Migration `202608020023_alakazam_subscription_contract.sql` already permits:

- Subscription statuses `pending`, `active`, `grace`, `suspended`, `cancelled`, and `ended`.
- `cancel_at_period_end`, `first_failed_at`, `grace_ends_at`, `suspended_at`, `cancelled_at`, and `ended_at`.
- Receipt kind `renewal_payment`.
- Tier event kinds `renewal_paid`, `payment_failed`, `payment_recovered`, `suspended`, `cancellation_scheduled`, `cancelled`, `ended`, `credit_source_reversed`, and `provider_synced`.
- A transition trigger that requires matching immutable evidence for several of those event kinds.

No Alakazam service at the checkpoint produces the broader lifecycle transitions above. There are no focused Alakazam PostgreSQL journeys proving them. The schema should therefore be described as prepared, not working.

Four schema details require an explicit decision or fence before lifecycle code lands:

- The “one current subscription” uniqueness predicate excludes only `ended`; a `cancelled` row still blocks creation of another current subscription. The distinction between `cancelled` and `ended`, and whether/how a customer restarts, is not frozen.
- Alakazam subscriptions have no approved `retention_ends_at` equivalent, so retained export cannot be derived from the older tables.
- Renewal receipts accept paid-invoice evidence, but `stripe_invoice_id` is not yet a one-invoice/one-receipt uniqueness key. Enabling both `invoice.paid` and `invoice.payment_succeeded` without that fence risks duplicate renewal evidence.
- `credit_source_reversed` is validated as an event kind, but no service propagates a reversed Download credit into the Alakazam lifecycle.

### 3.3 Routing gap that must be fixed before release

`server/commerce-v2/alakazam-webhook.mjs` recognizes only:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`

It also requires matching top-level Alakazam metadata and dispatches by persistent `change_kind` metadata (`start`, `upgrade`, or `downgrade`). The shared router then sends everything else to the older canonical processor.

That produces three unsafe gaps:

1. A normal Alakazam `invoice.paid` or `invoice.payment_failed` generally does not carry the required top-level subscription metadata. It is treated as non-Alakazam and reaches the legacy processor, which looks in the legacy `ss.stripe_subscriptions` table rather than `ss.alakazam_subscriptions`.
2. A later `customer.subscription.updated` can still carry the original `change_kind`. It can be consumed as replay of a completed start/upgrade/downgrade instead of becoming a new lifecycle observation.
3. `customer.subscription.deleted` is not in the Alakazam event set and therefore cannot terminate or reconcile an Alakazam subscription.

The current tests explicitly classify `invoice.paid` as unrelated to the Alakazam webhook handler. This is test proof of the current boundary, not proof of renewal handling.

Routing must be based on durable ownership, not metadata alone:

- Invoice event: derive the Stripe subscription identifier from the current invoice shape, then look it up in `ss.alakazam_subscriptions` before choosing a processor.
- Subscription event: look up the Stripe subscription identifier locally. Use the specialized transition processor only when there is a matching unresolved start/upgrade/downgrade transaction; otherwise use the lifecycle processor.
- Reversal event: preserve the existing Download defensive evaluation, then independently bind PaymentIntent/charge/refund/dispute evidence to any associated Alakazam receipt or consumed Download credit before falling through to legacy commerce. A Download match must not short-circuit Alakazam credit-integrity evaluation.
- Unknown ownership: make no mutation, preserve evidence, and return to the canonical route only when the event is demonstrably not Alakazam.

## 4. Proven-versus-missing lifecycle matrix

| Lifecycle area | Proven at `671e094` | Missing or unsafe | Policy dependency |
| --- | --- | --- | --- |
| Renewal success | Schema has `renewal_payment` receipts and `renewal_paid`; account projection can display renewal receipts. | No Alakazam invoice router, invoice provider readback, renewal service, invoice uniqueness fence, period advance, integration journey, or browser proof. | None for recording a genuinely paid renewal and advancing the confirmed period. Customer wording still needs review. |
| Payment failure | Schema has failure timestamps, `grace`, and `payment_failed`; legacy commerce handles its own subscriptions. | No Alakazam event ownership, invoice readback, failure evidence service, customer-safe issue projection, notification, or test. | Consequence, timing, retry messaging, access, and notice policy are open. |
| Past due / grace | Schema and pure entitlement code understand `grace`; pure authorization permits access through `graceEndsAt`. | No approved duration, no transition service, no scheduling worker, no fulfillment composition, and no customer/browser proof. | Grace may be zero or nonzero; access and publication behavior are owner-open. Existing pure behavior is not approval. |
| Suspension | Schema has `suspended` and `suspended_at`; pure authorization denies suspended subscriptions. | No rule selecting suspension, no idempotent suspension job, no publication/domain action, no recovery path, no monitor, and no journey. | Trigger, timing, service visibility, notices, and support handling are open. |
| Restoration | Schema has `payment_recovered` and can require a renewal receipt. | No reconciliation rule proving all required invoices current, no restoration service, no republish/serving action, and no out-of-order tests. | Whether restoration is automatic, and what content/domain state returns, are open. |
| Period-end cancellation | Schema and account projection have `cancel_at_period_end`; pure entitlement code stops access at the boundary. | No Alakazam cancellation preview/acceptance, Stripe mutation fence, lifecycle handling, undo path, boundary worker, terminal semantics, or browser controls. | Cancellation timing, refund treatment, outstanding balance, undo window, notices, and post-end service are open. |
| Retained export | Generic export object store/worker and legacy retention machinery exist. | Alakazam has no approved retention field/window, export eligibility binding, cancellation handoff, deletion job, customer projection, or proof. The legacy export check reads legacy subscriptions, not Alakazam truth. | Retention length, export availability, deletion timing, domain behavior, and restart rules are open. |
| Refunds / disputes | Download's defensive processor has idempotent, monotonic handling for full/partial refunds and dispute events. | No Alakazam receipt binding, reversal ledger, provider readback, entitlement rule, customer projection, owner queue, or tests. A reversed `$5` credit is not propagated into an Alakazam subscription. | Defensive consequence and restoration policy are open. There must be no refund offer, button, or customer refund API. |
| Operator reconciliation | Alakazam event/application rows, provider digests, revisions, and uncertain transition fences exist. The legacy cancellation worker demonstrates a bounded no-retry pattern. | No lifecycle incident queue, desired-vs-observed view, known-ID readback command, safe repair API, periodic drift scan, Alakazam monitor signals, or operator journey. | Owner may select notification/escalation wording; operators must not be allowed to invent payment or entitlement facts. |

### 4.1 What can and cannot be reused from canonical commerce

Reusable engineering patterns include idempotent event claims, leased local work, bounded backoff, a terminal no-retry state after an uncertain provider mutation, immutable audit evidence, and monotonic defensive reversal severity.

The following canonical behavior must not be copied into Alakazam as-is:

- Directly trusting a signed webhook object's amount/status instead of reading the relevant Stripe objects back.
- Writing legacy `ss.stripe_subscriptions` or applying legacy project cancellation to an Alakazam subscription.
- The older 14-day grace or 90-day retention values.
- Immediate project darkening, deletion, or export eligibility inferred from legacy cancellation state.
- Any simulated owner control that marks paid, grants a tier, comps service, or initiates a refund.

The canonical tests prove those older services against their own contract. They are pattern evidence, not Alakazam lifecycle proof.

## 5. Engineering facts versus owner-open decisions

### 5.1 Engineering facts that can be designed now

These rules follow from the existing contract and should remain invariant:

- A webhook is a signed wake signal. Provider readback plus local immutable evidence is the authority for money, price, subscription item, period, and status.
- One provider event can be claimed once; duplicate and out-of-order delivery must be harmless.
- One provider invoice can create at most one Alakazam renewal receipt. The present schema needs an explicit uniqueness fence for `stripe_invoice_id` before accepting more than one paid-invoice event alias.
- A read-only provider request may be retried. A timed-out provider mutation must not be blindly repeated.
- One lifecycle transition, its receipt/evidence, subscription revision, tier event, and event completion must commit in one PostgreSQL transaction.
- A local status must never become healthier than the confirmed provider and payment evidence supports.
- Restoration must prove current subscription and invoice facts; a dispute win or funds reinstatement alone is not proof that the recurring account is current.
- Customer projections expose customer facts and safe message codes, never Stripe customer, subscription, item, Price, invoice, PaymentIntent, charge, dispute, event, schedule, payload, or digest identifiers.
- Owner views may expose provider identifiers and immutable evidence, but an owner action cannot synthesize `paid`, overwrite a period, grant a tier, or bypass a provider effect.
- The Stripe customer portal, if used for payment-method maintenance, must not expose tier switching or cancellation outside Site Sourcery's fenced flows.
- Downgrade's existing zero-refund/no-proration rule applies only to downgrade. It must not be generalized into a cancellation or dispute policy.
- No lifecycle work authorizes a refund offer, refund button, or customer refund API.

### 5.2 Owner decisions that block customer-visible behavior

The owner must redline and version these decisions before the corresponding slice is enabled:

| Decision | Minimum exact ruling required |
| --- | --- |
| Failed payment | Does access change immediately? What customer state/message appears? Which Stripe retry configuration is accepted? What notice channels are required? |
| Grace | Is there a grace period? If so, its exact duration and boundary semantics; whether editing, publication, hosted domain, support, and export remain available. |
| Suspension | Exact transition condition; what becomes unavailable; what remains visible; whether domains remain attached; notification and restoration expectations. |
| Restoration | Exact evidence required; automatic versus owner-reviewed; republish/domain behavior; handling of multiple unpaid invoices or open disputes. |
| Cancellation | Period-end versus immediate; whether it can be undone; treatment of a just-paid period and outstanding balance; customer wording and confirmation. |
| Retention/export | Exact retention duration, export window, deletion boundary, backup treatment, customer notices, domain/subdomain behavior, and restart semantics. |
| Refund/dispute defense | Consequences of partial refund, full refund, open/lost/won dispute, failed refund, and funds reinstatement; whether owner review is mandatory. |
| Support/care | What `$35` and `$50` support actually promise, including channels and response expectations. This cannot be inferred from tier names. |

Until ruled, the safe customer state is a factual billing-attention or owner-review message with no invented deadline or promised outcome. The safe owner state is `policy_decision_required`, not an automatic transition.

## 6. Exact external event inventory

The event list below is the smallest complete inventory for this product shape. Events wake local work; they do not directly authorize customer truth.

### 6.1 Required release events

| Stripe event | Local classification and required action | Provider facts that must be read back | Idempotency key |
| --- | --- | --- | --- |
| `invoice.paid` | Renewal success or payment recovery candidate. Resolve Alakazam ownership, reject non-subscription/manual/proration surprises, create one renewal receipt, advance period, and reconcile status. | Invoice, owning subscription, exact subscription item/Price, invoice period/lines, amount/currency/paid state, PaymentIntent/charge facts when present. | Stripe invoice ID, with event ID retained as evidence. |
| `invoice.payment_succeeded` | Optional wake alias only. It must converge on exactly the same invoice operation as `invoice.paid`, never create a second receipt. If not subscribed, document that choice and test it. | Same as `invoice.paid`. | Stripe invoice ID. |
| `invoice.payment_failed` | Record a confirmed payment incident and reconcile provider status. Apply no grace/suspension consequence until policy is approved. | Invoice, subscription, attempt state, next attempt when available, amount/currency, PaymentIntent status and actionable failure category. | Invoice ID plus provider attempt identity/evidence version. |
| `customer.subscription.updated` | Reconcile period, status, exact item/Price, `cancel_at_period_end`, and pending schedule. Route to start/upgrade/downgrade only when an unresolved matching local transition exists. | Subscription and schedule when referenced. | Event ID for observation; subscription ID/revision for state application. |
| `customer.subscription.deleted` | Terminal provider observation. Record it and enter the approved cancellation/end path; never guess retention or deletion. | Retrieve subscription if available; otherwise use the signed terminal snapshot and last known provider observation with an explicit certainty marker. | Event ID plus subscription ID. |

`invoice.paid` is the preferred canonical renewal wake because Stripe presents it as the paid-invoice lifecycle signal. Readback must distinguish a collected payment from an invoice manually marked paid or paid out of band; the latter is owner review under the current no-fabricated-payment rule, not an automatic renewal receipt. If both paid-event aliases are enabled, invoice uniqueness is a release blocker.

### 6.2 Required attention and drift events

| Stripe event | Handling |
| --- | --- |
| `invoice.payment_action_required` | Record customer attention evidence and reconcile the invoice/PaymentIntent. Do not independently suspend or restore service. |
| `invoice.finalization_failed` | Owner alert and reconciliation only. No entitlement mutation because no payable, paid renewal has been proven. |
| `customer.subscription.paused` | Treat as unexpected drift because Alakazam does not intentionally offer pause. Preserve evidence and require reconciliation/policy review. |
| `customer.subscription.resumed` | Reconcile full subscription and invoice state. Do not restore solely because this event arrived. |
| `subscription_schedule.updated` | Verify the held renewal-boundary downgrade schedule, phase, Price, and effective date against the local accepted quote. |
| `subscription_schedule.completed` | Reconcile subscription item/Price and complete a pending downgrade only from confirmed subscription facts. |
| `subscription_schedule.released` | Owner alert if a local downgrade is pending; reconcile, do not recreate a schedule automatically. |
| `subscription_schedule.canceled` | Owner alert if a local downgrade is pending; reconcile, do not silently abandon or recreate it. |
| `subscription_schedule.aborted` | Owner alert and operator-only reconciliation. No automatic second provider mutation. |

Schedule events are evidence about orchestration. The Stripe subscription readback remains tier and period authority.

### 6.3 Defensive refund and dispute events

These events exist to protect access and surface evidence. They are not a refund product:

| Stripe event | Handling |
| --- | --- |
| `charge.refunded` | Bind the charge/PaymentIntent to local receipts, read back aggregate refunded amount and currency, record immutable reversal evidence, and enter the owner-approved defensive outcome. |
| `refund.created` | Record the specific refund and reconcile aggregate charge state. No customer refund control is implied. |
| `refund.updated` | Update immutable/append-only refund observation and reconcile aggregate charge state. |
| `refund.failed` | Record failure and reconcile; do not restore access merely because a refund failed. |
| `charge.dispute.created` | Read back dispute, charge, and PaymentIntent; enter at least owner review and the approved safety state. |
| `charge.dispute.updated` | Reconcile monotonic severity and evidence. |
| `charge.dispute.closed` | Reconcile the outcome and all current subscription/invoice facts before any restoration. |
| `charge.dispute.funds_withdrawn` | Record defensive financial exposure and reconcile. |
| `charge.dispute.funds_reinstated` | Record recovery evidence; do not independently prove the subscription current. |

A reversal connected to the `$5` Download credit and a later Alakazam purchase needs two separate, idempotent evaluations: Download entitlement defense and Alakazam credit-integrity defense. Router short-circuiting must not make one invisible to the other.

### 6.4 Events intentionally not used as direct authority

- `invoice.created`, `invoice.finalized`, and `invoice.updated` may support diagnostics, but they do not prove payment.
- `payment_intent.succeeded` does not by itself prove a valid recurring renewal period or exact subscription Price.
- `customer.subscription.trial_will_end` is not part of the product because Alakazam does not offer a trial.
- Any event with an unknown local owner is preserved/observed and passed to the correct existing processor; it must not create an Alakazam subscription.

External semantics should be checked against current Stripe primary documentation during implementation:

- <https://docs.stripe.com/billing/subscriptions/webhooks>
- <https://docs.stripe.com/billing/subscriptions/overview>
- <https://docs.stripe.com/api/invoices/object>
- <https://docs.stripe.com/refunds>

## 7. Required routing and transaction shape

Every event should follow this dependency order:

1. Verify the raw Stripe signature and construct the event once.
2. Classify potential Download reversal handling without consuming all downstream ownership checks.
3. Resolve Alakazam ownership from durable local identifiers:
   - subscription ID for subscription/schedule events;
   - invoice parent subscription ID for invoice events;
   - PaymentIntent/charge linkage for reversal events.
4. Claim the provider event idempotently in `ss.alakazam_stripe_events` only after ownership is established.
5. Read the relevant provider objects back through an allowlisted adapter method.
6. Validate environment, currency, amount, exact Price/tier, exact one-item subscription shape, period, customer binding, and local pending transition.
7. Commit evidence, receipt/incident, subscription revision, tier event, projection facts, and event completion atomically.
8. If a read or database commit fails, retry safely from the event claim. If a provider write may have happened but its response was lost, stop repeating the write and move to operator-only reconciliation.
9. If ownership is disproven, release/record the classification and pass the original event to the canonical processor exactly once.

No metadata-only branch may bypass local lookup. No broad Stripe list call is needed for a normal event; read back known IDs.

## 8. Customer-safe account projection

### 8.1 What v1 truthfully exposes now

`server/commerce-v2/alakazam-account.mjs` currently projects:

- held account state;
- subscription tier, price, revision, current period, cancellation flag, failure/grace timestamps;
- a pending start/upgrade/downgrade/cancellation descriptor;
- next-renewal summary;
- start/upgrade/renewal receipts;
- all write actions disabled.

It anticipates `grace`, `suspended`, `cancelled`, and `ended`, but those values are not currently produced by a complete Alakazam lifecycle.

### 8.2 Smallest safe v2 changes

Do not silently add lifecycle fields to the exact v1 validator. Introduce a coordinated `alakazam.account.v2` only when API, validator, UI, and browser tests land together. The smallest useful additions are:

```json
{
  "billingIssue": null,
  "service": {
    "state": "available",
    "effectiveAt": null,
    "messageCode": null
  },
  "cancellation": null,
  "export": {
    "state": "unavailable",
    "availableUntil": null
  },
  "reconciliation": {
    "state": "settled",
    "messageCode": null
  }
}
```

Allowed customer values must be derived from committed facts:

- `billingIssue.state`: `payment_failed`, `action_required`, or `past_due`; include only approved `firstObservedAt`, `nextReviewAt`, and `graceEndsAt` facts. Do not expose decline text, raw failure codes, or provider identifiers.
- `service.state`: `available`, `limited`, `suspended`, or `ended`; source this from the actual fulfillment/publication state, not merely a billing status name.
- `cancellation`: `scheduled` or `effective`, with a confirmed `effectiveAt`; add `availableUntil` only after retention policy and implementation exist.
- `export.state`: factual `unavailable`, `preparing`, `ready`, `expired`, or `failed`; never promise an export window that is not enforced.
- `reconciliation.state`: `settled`, `checking`, or `owner_attention`; pair it with a reviewed generic message code, not internal failure data.
- `actions`: an action becomes `true` only when its authenticated command route, eligibility preview, CSRF/idempotency rules, provider fence, PostgreSQL journey, and browser journey all pass. A visually disabled button is not an implementation.

The projection must distinguish billing state from delivered service state. Otherwise a delayed publication worker can make the page say “available” while the site is dark, or say “suspended” while it remains publicly served.

## 9. Owner-only evidence and bounded repair

The owner view should present a joined evidence bundle, not a second source of truth.

### 9.1 Evidence to show

- Organization, project, authenticated customer, local subscription ID, revision, tier, local status, period, cancellation flag, and actual service/publication state.
- Owner-only Stripe customer, subscription, item, Price, schedule, invoice, PaymentIntent, charge, refund, dispute, and event identifiers.
- Event type, event ID, provider creation time, receipt time, livemode/API-version checks, payload digest, processing state, attempt count, and last safe error code.
- Provider readback time and digest; desired-versus-observed Price, period, status, schedule, paid amount, currency, and cancellation facts.
- Quote, receipt, transition application, outbox/lease, lifecycle incident, and idempotency references.
- Certainty classification: `confirmed`, `awaiting_readback`, `provider_effect_uncertain`, `policy_decision_required`, or `manual_external_action_required`.
- The one next bounded action, why it is safe, and why a repeated provider mutation is or is not allowed.
- Export generation/expiry and actual publication/domain state when those systems are composed.
- Immutable audit records for every owner view and repair request.

### 9.2 Allowed operator actions

- Re-read a known Stripe subscription, invoice, schedule, PaymentIntent, charge, refund, or dispute.
- Re-run a failed local event application when the external operation is read-only or already confirmed.
- Resume a known leased local job when no uncertain provider write exists.
- Request/re-ingest one exact signed Stripe event or reconcile one exact known provider object.
- Acknowledge an alert or attach an owner policy decision without changing payment facts.

### 9.3 Forbidden operator actions

- “Mark paid,” fabricate a receipt, or overwrite a provider period/status.
- Grant a tier, amount, credit, or entitlement without the normal accepted transaction and provider proof.
- Retry an ambiguous cancellation, schedule, or item mutation merely because a timeout occurred.
- Create a second checkout to repair an uncertain first checkout.
- Fabricate a webhook/provider identifier or weaken a digest/revision check.
- Issue a refund from this lifecycle/reconciliation surface.
- Restore service solely because a dispute closed or funds were reinstated.

The older cancellation worker's terminal `available_at = infinity`/operator-attention approach is a useful no-double-effect pattern. Its old cancellation/retention policy is not reusable.

## 10. Monitoring and reconciliation inventory

`ops/monitor-ports.mjs` currently observes legacy cancellation/export queues, not the complete Alakazam lifecycle. Before release, an Alakazam monitor must report privacy-safe counts, oldest age, and stable reason codes for:

- Stripe events stuck `processing`, repeatedly `failed`, or unowned after the routing budget.
- Customer/start/upgrade/downgrade/lifecycle applications in `reconciliation_required` or equivalent terminal uncertainty.
- A provider period advanced without exactly one local renewal receipt and revision.
- A local renewal receipt whose invoice/provider readback no longer supports it.
- An active local subscription whose provider status/Price/item/period differs.
- A failed payment with no approved next state, or a policy deadline passed without the idempotent local action.
- A scheduled downgrade whose Stripe schedule was released, canceled, aborted, changed, or passed without confirmation.
- A cancellation effective boundary passed while local service/subscription/export state disagrees.
- Refund/dispute evidence awaiting defensive policy or owner review.
- Export generation/expiry/deletion work overdue after an approved retention policy exists.
- Billing state and actual publication/domain state disagreeing.

Each alert runbook must identify exactly one safe first action and the no-retry boundary. Alert messages must omit email addresses, provider IDs, payloads, and secrets.

Periodic reconciliation should operate on known local subscriptions in bounded batches. It should compare provider observation with local revision and write evidence; it should not “heal” by performing unapproved provider mutations.

## 11. Dependency-ordered vertical slices

The following sequence minimizes policy invention and limits shared-file collisions.

### G0 — Owner policy redline and version stamp

Dependency: none.

Output: one versioned decision record covering the open rows in section 5.2.

Release effect: none by itself.

Engineering may build policy-neutral evidence capture before G0 completes. It must not turn policy-shaped schema fields into customer-visible promises.

### G1 — Ownership-aware lifecycle event foundation

Dependencies: current held webhook composition.

Build:

- durable invoice/subscription/reversal ownership resolution;
- provider readback methods for known invoice, PaymentIntent/charge, refund/dispute, and subscription/schedule objects;
- one-invoice/one-renewal-receipt uniqueness;
- lifecycle event claim/retry/failure evidence;
- specialized transition dispatch only for an unresolved matching transition.

Proof: unit routing permutations, unknown fallthrough, duplicate events, both paid aliases, stale/out-of-order subscription updates, wrong environment/customer/Price/item/currency, provider read failure, and no mutation on unknown ownership.

### G2 — Renewal success vertical slice

Dependencies: G1.

Build: `invoice.paid` readback, one renewal receipt, period advance, `renewal_paid` tier event, account receipt/next-renewal update, owner evidence, and renewal monitor signal.

Proof: fresh all-migrations PostgreSQL journey plus real Stripe test-mode renewal; duplicate and alias delivery create exactly one receipt and one revision.

Policy: does not need grace/cancellation policy.

### G3 — Failure evidence and truthful attention state

Dependencies: G1 and approved customer wording from G0.

Build: confirmed failure incident, provider status reconciliation, factual account attention state, owner evidence, and alert. Do not yet suspend or promise a grace deadline unless approved.

Proof: failed invoice, repeated attempt, action-required, out-of-order later success, and unknown invoice journeys.

### G4 — Approved grace, suspension, and restoration

Dependencies: G2, G3, G0 payment/grace/suspension/restoration rulings, and fulfillment composition.

Build: explicit policy version on each decision, deterministic deadline job, idempotent service/publication transition, recovery only from complete provider proof, customer notification/projection, owner repair, and monitor.

Proof: exact-boundary clock tests, crash/retry, delayed/out-of-order webhook, multiple invoice state, provider still past due, actual publication/serving behavior, and browser journey.

### G5 — Period-end cancellation

Dependencies: G1, G0 cancellation ruling, and a proven subscription-mutation fence.

Build: eligibility preview, accepted disclosure hash, one cancel-at-period-end provider mutation, ambiguity fence, provider confirmation, customer projection, optional undo only if approved, boundary reconciliation, and owner evidence.

Proof: duplicate request, timeout-before/after provider effect, updated/deleted events, cancel revoked if supported, boundary with unpaid invoice, and no immediate loss before the approved boundary.

### G6 — Retained export and terminal service state

Dependencies: G5, G0 retention/export ruling, and the broader fulfillment/domain lane.

Build: Alakazam retention fact, export eligibility, generation/expiry, terminal publication/domain behavior, deletion job if approved, customer projection, owner evidence, and monitor.

Proof: exact retention boundary, export before/after expiry, cancellation without export, backup/deletion treatment, restart semantics, and browser journey.

### G7 — Defensive refunds and disputes

Dependencies: G1, G2, and G0 reversal rulings.

Build: Alakazam reversal ledger, receipt binding, monotonic severity, provider readback, owner review, policy-versioned service consequence, and restoration reconciliation. Include the Download-credit-to-Alakazam propagation case.

Proof: partial/full refund, duplicate aggregate/refund events, open/lost/won dispute, funds withdrawn/reinstated, refund failure, unrelated PaymentIntent fallthrough, and no refund UI/API.

### G8 — Operator-only reconciliation completion

Dependencies: G2 through every lifecycle slice intended for release.

Build: desired-versus-observed owner view, known-ID readback, bounded local replay, explicit uncertainty terminal, audited actions, periodic bounded scanner, alerts, and runbooks.

Proof: each mismatch class is detected; every offered action is idempotent; forbidden mark-paid/grant-tier/repeat-unknown-mutation paths do not exist.

Release order can stop after any sealed slice, but a later slice cannot be advertised or enabled before its dependencies pass.

## 12. Disjoint implementation packets

These are proposed ownership packets, not permission to edit them during this mapper task. Migration numbers must be reserved by the lead before work starts; `032` below is valid only if it remains unallocated.

| Packet | Exclusive production files | Exclusive tests | Dependency / integration owner |
| --- | --- | --- | --- |
| P0 — Contract/schema | `server/data-plane/supabase/migrations/202608040032_alakazam_lifecycle_reconciliation.sql` (or next lead-reserved number), billing contract addendum | `server/data-plane/tests/alakazam-lifecycle-contract.integration.test.mjs` | Lead only; lands first. Must add invoice uniqueness and only the minimal lifecycle/reconciliation evidence required by approved slices. |
| P1 — Pure lifecycle | New `server/commerce-v2/alakazam-lifecycle.mjs` | New `server/commerce-v2/test/alakazam-lifecycle.test.mjs` | Depends P0. No router, adapter, or PostgreSQL edits. Owns pure validation/decision results, not policy constants. |
| P2 — Stripe readback | `server/commerce/adapters/stripe.mjs` | `server/commerce/test/stripe-provider.test.mjs` | Depends event inventory. One worker only because these are shared adapter files. Adds known-ID reads, no broad mutation. |
| P3 — PostgreSQL lifecycle repository | New `server/hosted/alakazam-lifecycle-postgres.mjs` | New `server/hosted/test/alakazam-lifecycle-postgres.test.mjs` and new `server/data-plane/tests/alakazam-lifecycle-postgres.integration.test.mjs` | Depends P0/P1. Keep lifecycle SQL out of concurrently owned `alakazam-postgres.mjs` until lead composes it. |
| P4 — Router/composition | `server/commerce-v2/alakazam-webhook.mjs`, `server/hosted/stripe-webhook-router.mjs`, `server/commerce-v2/index.mjs`, `server/hosted/bin/server.mjs` | Existing matching webhook/router tests plus a new hosted composition test | Lead integration only; depends P1/P2/P3. These are shared choke points and must not be parallel-edited. |
| P5 — Account projection | `server/commerce-v2/alakazam-account.mjs`, `server/commerce-v2/hosted-alakazam-account.mjs`, account UI/controller files | Existing account unit/hosted/browser tests | One exclusive worker after lifecycle response is stable. Coordinate `v2` schema in one commit. |
| P6 — Timed lifecycle work | New `server/hosted/alakazam-lifecycle-worker.mjs` and its unit file; composition belongs to lead | New `server/hosted/test/alakazam-lifecycle-worker.test.mjs` | Only after G0 and G3. Handles local deadlines/leases; never invents a provider retry. |
| P7 — Cancellation | New `server/commerce-v2/alakazam-cancellation.mjs` and new `server/hosted/alakazam-cancellation-postgres.mjs` | New matching unit and integration tests | Only after cancellation policy. Lead owns any shared HTTP/router/composition edits. |
| P8 — Reversals | New `server/commerce-v2/alakazam-reversal.mjs` and new `server/hosted/alakazam-reversal-postgres.mjs` | New matching unit/integration tests | Reuse patterns, not state, from `payment.mjs`. Lead owns shared webhook-router changes. |
| P9 — Monitor/runbooks | `ops/monitor-ports.mjs` plus new Alakazam lifecycle runbook | Existing/new monitor tests | One worker after database states stabilize; lead integrates production service configuration. |

Do not assign two workers to any row or let a worker “help” by editing a shared composition file. The lead owns migration order, shared exports, shared webhook dispatch, hosted server composition, broad regression, commits, and release gates.

## 13. Proof gates for every lifecycle slice

A slice is not complete merely because a service returns a plausible object. It needs:

1. Focused pure unit tests for validation, duplicate, stale, and out-of-order cases.
2. Provider-adapter tests proving exact allowlisted reads and no accidental mutation.
3. A fresh disposable PostgreSQL database with every migration replayed from the beginning.
4. A real repository journey proving one atomic revision, receipt/evidence linkage, and event completion.
5. Crash/timeout tests on both sides of every external-effect boundary.
6. Shared-router tests proving Alakazam ownership, Download defensive handling, legacy fallthrough, and no double processing.
7. Broad regression suites after integration.
8. Real Stripe test-mode evidence for provider-dependent behavior; use controlled clocks for renewals/boundaries where practical.
9. Authenticated customer browser proof showing only committed facts at required viewport widths.
10. Owner-view proof showing immutable evidence and only bounded repair actions.
11. Monitor alert and recovery-runbook rehearsal for the slice's terminal uncertainty.
12. Release gate remains off until all required slices and public claims match.

## 14. Immediate lead recommendations

1. Keep the Alakazam webhook release gate closed.
2. Reserve the next migration number and fix lifecycle ownership/idempotency before adding more customer controls.
3. Land renewal success first; it connects the existing subscription to its next real billing period without deciding grace or cancellation policy.
4. Treat payment failures as evidence-only until the owner approves consequences and wording.
5. Request one compact owner redline for grace, suspension/restoration, cancellation, retention/export, and defensive reversal outcomes. Do not inherit 14-day/90-day legacy values.
6. Keep owner reconciliation readback-first. Do not implement “mark paid,” “grant tier,” refund actions, or automatic repetition of uncertain provider writes.
7. Compose lifecycle state with actual fulfillment/publication before telling customers service is available, limited, suspended, or ended.
8. Preserve this inventory, the active run, checkpoint hashes, test evidence, owner rulings, and file ownership as durable repo artifacts so chat compaction cannot become project memory.

## 15. Batch 2 completion checklist

- [ ] G0 owner policy record is explicit, dated, versioned, and linked from continuity.
- [ ] Event routing resolves durable Alakazam ownership for invoice, subscription, schedule, refund, and dispute events.
- [ ] Persistent `change_kind` metadata cannot swallow ordinary lifecycle updates.
- [ ] One invoice can produce at most one renewal receipt across duplicate/alias events.
- [ ] Renewal success has unit, fresh-PostgreSQL, real Stripe test-mode, account, owner, and monitor proof.
- [ ] Payment failure is recorded truthfully without an invented consequence.
- [ ] Approved grace/suspension/restoration rules are policy-versioned and composed with actual service state.
- [ ] Period-end cancellation is fenced, confirmed, and tested under provider uncertainty.
- [ ] Retained export and deletion/domain behavior match the approved policy and actual fulfillment.
- [ ] Refund/dispute behavior is defensive only, monotonic, provider-confirmed, and has no refund offer/API.
- [ ] Owner reconciliation exposes evidence and bounded repair, never fabricated commerce state.
- [ ] Privacy-safe lifecycle alerts and one-action runbooks are rehearsed.
- [ ] Customer account v2 and actions are browser-proven; no disabled placeholder is described as working.
- [ ] Public claims match only the released, proven slices.
- [ ] Broad regressions pass from a clean integration checkpoint.
- [ ] No push, deploy, DNS, provider-production write, or release-gate change occurs without the lead's explicit release step.
