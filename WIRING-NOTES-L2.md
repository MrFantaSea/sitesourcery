# WIRING-NOTES-L2 — Alakazam lifecycle (G-02 … G-05)

Lane: **L2 Lifecycle** · Worktree `/private/tmp/sitesourcery-alakazam-lifecycle-20260808`
· Branch `feat/alakazam-lifecycle-20260808` · Base `a0f024d`

L2 wrote **only new files**. No composition root was edited. L4 applies
everything below during integration.

## 1. Files this lane added

| Path | What it is |
| --- | --- |
| `server/data-plane/supabase/migrations/202608080049_alakazam_lifecycle_renewal.sql` | renewal settlement + one-receipt-per-invoice fence · contract `v49` |
| `server/data-plane/supabase/migrations/202608080050_alakazam_lifecycle_incidents.sql` | payment incident ledger · contract `v50` |
| `server/data-plane/supabase/migrations/202608080051_alakazam_lifecycle_cancellation.sql` | cancellations + export grants · contract `v51` |
| `server/data-plane/supabase/migrations/202608080052_alakazam_lifecycle_reversal.sql` | refund/dispute defence · contract `v52` |
| `server/commerce-v2/alakazam-lifecycle-policy.mjs` | fail-closed owner policy value object |
| `server/commerce-v2/alakazam-lifecycle-renewal.mjs` | G-02 renewal service + next-period projection |
| `server/commerce-v2/alakazam-lifecycle-state.mjs` | G-03 state machine, incident service, recovery service |
| `server/commerce-v2/alakazam-lifecycle-cancellation.mjs` | G-04 preview, export grant, cancellation service |
| `server/commerce-v2/alakazam-lifecycle-reversal.mjs` | G-05 defensive reversal service |
| `server/hosted/alakazam-lifecycle-policy-config.mjs` | environment → policy, held by default |
| `server/hosted/alakazam-lifecycle-postgres.mjs` | all lifecycle PostgreSQL transactions |
| `server/commerce-v2/test/alakazam-lifecycle-*.test.mjs` | focused unit proof (43 tests) |
| `server/hosted/test/alakazam-lifecycle-policy-config.test.mjs` | configuration proof (4 tests) |
| `server/data-plane/tests/alakazam-lifecycle-postgres.integration.test.mjs` | real PostgreSQL journeys (10 tests) |

**Migration numbers reserved: 49, 50, 51, 52.** `48` belongs to
`feat/privacy-v3-backend-20260807` (`202608060048_hosted_privacy_v3.sql`,
contract `v48`). Runtime contract functions `v49`–`v52` are ours; nothing else
in the tree defines them.

Nothing in this lane is auto-discovered. Until L4 applies section 2, none of
these services can be reached by an HTTP route or a webhook, which is the
intended held state.

## 2. Composition-root edits L4 must apply

### 2.1 `server/hosted/bin/server.mjs` — the real webhook composition root

The Stripe webhook router is composed here, not in `http.mjs`.

**(a) imports** — beside the existing `createPostgresAlakazamRepository` import
(currently line 35):

```js
import {
  createPostgresAlakazamLifecycleRepository
} from "../alakazam-lifecycle-postgres.mjs";
import {
  createConfiguredAlakazamLifecyclePolicy
} from "../alakazam-lifecycle-policy-config.mjs";
```

and from `../../commerce-v2/index.mjs` (see 2.3 first):

```js
  createAlakazamRenewalService,
  createAlakazamPaymentIncidentService,
  createAlakazamPaymentRecoveryService,
  createAlakazamCancellationService,
  createAlakazamReversalService,
```

**(b) composition** — immediately after `alakazamServicePorts` (line 452-458):

```js
  const alakazamLifecyclePolicy =
    createConfiguredAlakazamLifecyclePolicy();
  const alakazamLifecyclePorts = {
    repository: createPostgresAlakazamLifecycleRepository({
      authority,
      taxMode: alakazamComposition.release.taxMode ??
        "disabled_by_owner"
    }),
    provider: stripeComposition.adapter,
    clock: commerceV2.clock,
    ids: commerceV2.ids,
    release: alakazamComposition.release,
    policy: alakazamLifecyclePolicy.policy
  };
  const alakazamLifecycle = Object.freeze({
    renewal: createAlakazamRenewalService(
      alakazamLifecyclePorts
    ),
    incident: createAlakazamPaymentIncidentService(
      alakazamLifecyclePorts
    ),
    recovery: createAlakazamPaymentRecoveryService(
      alakazamLifecyclePorts
    ),
    cancellation: createAlakazamCancellationService(
      alakazamLifecyclePorts
    ),
    reversal: createAlakazamReversalService(
      alakazamLifecyclePorts
    )
  });
```

**(c) router argument** — add `alakazamLifecycle` to the
`createStripeWebhookRouter({ … })` call (line ~647).

### 2.2 `server/hosted/stripe-webhook-router.mjs`

Accept and dispatch the lifecycle services. **Order matters**: every lifecycle
branch must sit *after* the existing Download-reversal branch and *after*
`isPotentialAlakazamStripeEvent`, so a start/upgrade/downgrade transition still
reaches its own processor and a Download reversal is still evaluated first.

```js
import {
  isAlakazamRenewalInvoiceEvent
} from "../commerce-v2/alakazam-lifecycle-renewal.mjs";
import {
  isAlakazamPaymentIncidentEvent,
  isAlakazamPaymentRecoveryEvent
} from "../commerce-v2/alakazam-lifecycle-state.mjs";
import {
  isAlakazamCancellationConfirmationEvent
} from "../commerce-v2/alakazam-lifecycle-cancellation.mjs";
import {
  isAlakazamReversalEvent
} from "../commerce-v2/alakazam-lifecycle-reversal.mjs";
```

Inside `ingestStripeWebhook`, after the existing
`if (isPotentialAlakazamStripeEvent(event)) { … }` block:

```js
      if (isAlakazamReversalEvent(event)) {
        const result =
          await alakazamLifecycle.reversal.ingestStripeEvent(
            event
          );
        if (result?.status !== "not_alakazam_reversal") {
          return result;
        }
      }
      if (isAlakazamPaymentIncidentEvent(event)) {
        const result =
          await alakazamLifecycle.incident.ingestStripeEvent(
            event
          );
        if (result?.status !== "not_alakazam_incident") {
          return result;
        }
      }
      if (isAlakazamRenewalInvoiceEvent(event)) {
        // Renewal owns paid invoices for ACTIVE subscriptions;
        // recovery owns them for grace/suspended. They are disjoint
        // by committed local status, so try both and fall through.
        const renewed =
          await alakazamLifecycle.renewal.ingestStripeEvent(
            event
          );
        if (renewed?.status !== "not_alakazam_renewal") {
          return renewed;
        }
        const recovered =
          await alakazamLifecycle.recovery.ingestStripeEvent(
            event
          );
        if (recovered?.status !== "not_alakazam_recovery") {
          return recovered;
        }
      }
      if (isAlakazamCancellationConfirmationEvent(event)) {
        const result =
          await alakazamLifecycle.cancellation
            .ingestStripeEvent(event);
        if (result?.status !== "not_alakazam_cancellation") {
          return result;
        }
      }
```

Add `alakazamLifecycle` to the factory signature and to its `invariant(...)`
completeness check.

**Known ordering hazard.** `isAlakazamCancellationConfirmationEvent` matches
`customer.subscription.updated` with `cancel_at_period_end: true`. It already
excludes events carrying `metadata.schema === "sitesourcery_alakazam_change_v1"`,
so it cannot swallow a start/upgrade/downgrade confirmation. Keep that exclusion
if the branch is ever reordered.

### 2.3 `server/commerce-v2/index.mjs`

Append beside the existing `alakazam-*` re-exports:

```js
export * from "./alakazam-lifecycle-policy.mjs";
export * from "./alakazam-lifecycle-renewal.mjs";
export * from "./alakazam-lifecycle-state.mjs";
export * from "./alakazam-lifecycle-cancellation.mjs";
export * from "./alakazam-lifecycle-reversal.mjs";
```

No name collisions with the existing exports (every symbol is prefixed
`ALAKAZAM_RENEWAL_*`, `ALAKAZAM_INCIDENT_*`, `ALAKAZAM_LIFECYCLE_*`,
`ALAKAZAM_CANCELLATION_*`, `ALAKAZAM_EXPORT_*`, `ALAKAZAM_REVERSAL_*`, or
`createAlakazam…`/`decideAlakazam…`/`projectAlakazam…`).

### 2.4 `server/hosted/http.mjs` — **one optional read-only route**

Only needed when L3's billing surfaces want the cancellation preview. It is
GET-only, session-bound, and exposes no provider identifier:

```js
// beside the existing GET /api/alakazam/account route (~line 1527)
if (method === "GET" && pathname === "/api/alakazam/cancellation-preview") {
  return json(
    await alakazamLifecycle.cancellation.preview({
      tenantId: session.organizationId,
      customerId: session.userId,
      projectId: requiredProjectId(url)
    })
  );
}
```

If L3 does not need it this release, skip it entirely — nothing else in L2
depends on an HTTP route.

### 2.5 `scripts/hosted-truth/manifest.mjs` — no change requested

L2 adds no public page, no customer copy, and no browser surface. If L4's truth
checker enumerates runtime contract functions, add `v49`–`v52`.

### 2.6 `package.json` — test registration

`server/commerce-v2/test/*.test.mjs` and `server/hosted/test/*.test.mjs` are
already globbed, so the 47 unit tests join `test:node` / `test:hosted-service`
automatically. The PostgreSQL journey needs its own script beside
`test:pg:alakazam`:

```json
"test:pg:alakazam-lifecycle": "node --test --test-concurrency=1 server/data-plane/tests/alakazam-lifecycle-postgres.integration.test.mjs"
```

It reads `SITESOURCERY_PG_ALAKAZAM_LIFECYCLE_TEST_URL` and **skips silently**
when that variable is absent, so it is safe in any pipeline.

## 3. What stays held after wiring

Wiring these services does **not** open anything. Every one of them refuses at
`readiness()` while `SITESOURCERY_ALAKAZAM_MODE` is `held` (the default), and
`server/hosted/PUBLICATION_HOLD` is untouched. Two independent gates now exist:

| Gate | Variable | Default | Governs |
| --- | --- | --- | --- |
| Alakazam billing release | `SITESOURCERY_ALAKAZAM_MODE` | `held` | any provider effect at all |
| Alakazam lifecycle policy | `SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE` | `held` | grace, suspension, restoration, retention, reversal consequences |

They are deliberately separate. Turning billing on does **not** turn
consequences on: with the policy still held, a failed payment is recorded as
evidence and nothing happens to the customer's service. Restoration refuses
outright. Both database schemas enforce this independently of the JavaScript —
see the `policy_version is not null or (…)` checks in migrations 050 and 052.

**Do not set any `SITESOURCERY_ALAKAZAM_LIFECYCLE_*` variable until the owner
has ruled.** The config module rejects a partial ruling rather than filling a
gap with a default.

## 4. Not done by L2 — hand-offs

1. **Stripe adapter readback methods** (`server/commerce/adapters/stripe.mjs`,
   P2, single-owner file — L2 did not touch it). Four read-only methods are
   required before any of this can run against Stripe test mode:
   `retrieveAlakazamRenewalInvoice`, `retrieveAlakazamIncidentInvoice`,
   `retrieveAlakazamCancellation`, `retrieveAlakazamReversal`. The exact object
   shape each must return is pinned by the `exact…Facts` validator in the
   matching module, and each shape carries its own `providerFactsDigest`
   (`digest(facts)` over the object minus that field). **No mutating method is
   needed by this lane, and the reversal service refuses to construct if the
   provider exposes `createRefund` or `issueRefund`.**
2. **Account projection v2** (P5 / L3). The lifecycle facts a customer surface
   should read are `billingIssue`, `service.state`, `cancellation`, `export`,
   `reconciliation` — the inventory's §8.2 shape. L2 produces all of them but
   projects none into `alakazam.account.v1`; that schema is untouched.
3. **Deadline worker** (P6). `grace_expired` is implemented as a pure decision
   and is proven, but nothing schedules it. A worker must call
   `decideAlakazamLifecycleTransition({ signal: "grace_expired", … })` on a
   bounded batch once the owner rules a grace duration.
4. **Owner reconciliation queue** (G-06). Two indexes exist for it:
   `alakazam_incidents_awaiting_policy` and
   `alakazam_reversals_awaiting_owner`.
5. **Download-credit-to-Alakazam propagation.** `alakazam_reversal_events`
   carries `credit_application_id` and binds it, but the actual
   `credit_source_reversed` transition needs a
   `commerce_v2_download_reversal_events` row, which the Download lane owns.
