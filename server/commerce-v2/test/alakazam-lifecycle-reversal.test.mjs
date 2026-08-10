import assert from "node:assert/strict";
import test from "node:test";

import {
  createAlakazamBillingRelease
} from "../alakazam-billing.mjs";
import {
  createAlakazamLifecyclePolicy
} from "../alakazam-lifecycle-policy.mjs";
import {
  ALAKAZAM_REVERSAL_DECISION_SCHEMA,
  ALAKAZAM_REVERSAL_EVENT_TYPES,
  ALAKAZAM_REVERSAL_FACTS_SCHEMA,
  ALAKAZAM_REVERSAL_SEVERITY,
  ALAKAZAM_REVERSAL_SUBSCRIPTION_SCHEMA,
  createAlakazamReversalService,
  decideAlakazamReversalConsequence,
  isAlakazamReversalEvent
} from "../alakazam-lifecycle-reversal.mjs";
import { digest } from "../canonical.mjs";

const TENANT_ID = "a0000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "a0000000-0000-4000-8000-000000000002";
const PROJECT_ID = "a0000000-0000-4000-8000-000000000003";
const SUBSCRIPTION_ID = "a0000000-0000-4000-8000-000000000004";
const RECEIPT_ID = "a0000000-0000-4000-8000-000000000005";
const EVENT_ROW_ID = "b0000000-0000-4000-8000-000000000001";
const REVERSAL_ID = "b0000000-0000-4000-8000-000000000002";
const TIER_EVENT_ID = "b0000000-0000-4000-8000-000000000003";

const OCCURRED_AT = "2026-08-20T10:00:00.000Z";
const VERIFIED_AT = "2026-08-20T10:00:05.000Z";
const OBSERVED_AT = "2026-08-20T10:00:09.000Z";
const CHARGE_ID = "ch_alakazam_reversal_1";
const PAYMENT_INTENT_ID = "pi_alakazam_reversal_1";

const APPROVED_RELEASE = createAlakazamBillingRelease({
  approved: true,
  taxMode: "disabled_by_owner"
});

// Hypothetical. The owner has not made this ruling.
const EXAMPLE_POLICY = createAlakazamLifecyclePolicy({
  approved: true,
  policyVersion: "alakazam-lifecycle.2026-08-08.v1",
  graceHours: 72,
  suspendAfterGraceHours: 0,
  retentionHours: 720,
  exportWindowHours: 336,
  graceConsequence: "restrict_publication",
  suspensionConsequence: "suspend_service",
  refundConsequence: "suspend_service",
  disputeConsequence: "suspend_service"
});

function reversalSubscription(overrides = {}) {
  return {
    schema: ALAKAZAM_REVERSAL_SUBSCRIPTION_SCHEMA,
    localSubscriptionId: SUBSCRIPTION_ID,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    revision: 6,
    tierId: "alakazam_25",
    status: "active",
    currency: "USD",
    paymentReceiptId: RECEIPT_ID,
    receiptTotalMinor: 2500,
    stripePaymentIntentId: PAYMENT_INTENT_ID,
    creditApplicationId: null,
    ...overrides
  };
}

function reversalFacts(overrides = {}) {
  const facts = {
    schema: ALAKAZAM_REVERSAL_FACTS_SCHEMA,
    provider: "stripe",
    reversalKind: "refund",
    outcome: "refund_full",
    stripeChargeId: CHARGE_ID,
    stripePaymentIntentId: PAYMENT_INTENT_ID,
    stripeRefundId: "re_alakazam_reversal_1",
    stripeDisputeId: null,
    amountChargedMinor: 2500,
    amountReversedMinor: 2500,
    currency: "USD",
    providerObservedAt: OBSERVED_AT,
    ...overrides
  };
  return { ...facts, providerFactsDigest: digest(facts) };
}

function reversalEvent(overrides = {}) {
  return {
    id: "evt_alakazam_reversal_1",
    type: "charge.refunded",
    livemode: false,
    api_version: "2026-07-30.basil",
    created: Math.floor(Date.parse(OCCURRED_AT) / 1000),
    data: {
      object: {
        id: CHARGE_ID,
        object: "charge",
        payment_intent: PAYMENT_INTENT_ID
      }
    },
    ...overrides
  };
}

function harness({
  resolved,
  facts,
  result,
  policy = createAlakazamLifecyclePolicy(),
  release = APPROVED_RELEASE,
  extraRepository = {},
  extraProvider = {}
} = {}) {
  const calls = { lookups: [], readbacks: [], writes: [], ids: [] };
  const service = createAlakazamReversalService({
    repository: {
      async findReversalPaymentByCharge(input) {
        calls.lookups.push(input);
        return resolved;
      },
      async recordReversal(input) {
        calls.writes.push(input);
        return result;
      },
      ...extraRepository
    },
    provider: {
      async readiness() {
        return {
          ready: true,
          provider: "stripe",
          alakazam: true,
          taxModes: { alakazam: "disabled_by_owner" },
          livemode: false
        };
      },
      async retrieveAlakazamReversal(input) {
        calls.readbacks.push(input);
        return facts;
      },
      ...extraProvider
    },
    clock: { now: () => VERIFIED_AT },
    ids: {
      next(label) {
        calls.ids.push(label);
        return {
          alakazam_reversal_event: EVENT_ROW_ID,
          alakazam_reversal: REVERSAL_ID,
          alakazam_reversal_tier_event: TIER_EVENT_ID
        }[label];
      }
    },
    release,
    policy
  });
  return { service, calls };
}

function reversalResult(overrides = {}) {
  const decision = decideAlakazamReversalConsequence({
    policy: createAlakazamLifecyclePolicy(),
    outcome: "refund_full",
    subscriptionStatus: "active"
  });
  return {
    status: "reversal_recorded",
    provider: "stripe",
    reversalId: REVERSAL_ID,
    subscriptionId: SUBSCRIPTION_ID,
    projectId: PROJECT_ID,
    stripeChargeId: CHARGE_ID,
    severity: decision.severity,
    subscriptionStatus: "active",
    consequenceApplied: false,
    ownerReviewRequired: true,
    decision,
    next: "owner_reconciliation",
    ...overrides
  };
}

test(
  "an unruled policy sends every reversal to owner review only",
  () => {
    for (const outcome of Object.keys(
      ALAKAZAM_REVERSAL_SEVERITY
    )) {
      const decision = decideAlakazamReversalConsequence({
        policy: createAlakazamLifecyclePolicy(),
        outcome,
        subscriptionStatus: "active"
      });
      assert.equal(
        decision.schema,
        ALAKAZAM_REVERSAL_DECISION_SCHEMA
      );
      assert.equal(decision.to, "active");
      assert.equal(decision.tierEventKind, null);
      assert.equal(decision.consequence, "owner_review");
      assert.equal(decision.serviceState, "unchanged");
      assert.equal(decision.ownerReviewRequired, true);
      assert.equal(decision.policyVersion, null);
      assert.equal(decision.customerRefundOffered, false);
      assert.equal(
        decision.reason,
        "policy_decision_required"
      );
    }
  }
);

test(
  "reversal severity is monotonic and never restores service",
  () => {
    const lost = decideAlakazamReversalConsequence({
      policy: EXAMPLE_POLICY,
      outcome: "dispute_lost",
      subscriptionStatus: "active"
    });
    assert.equal(lost.severity, 80);
    assert.equal(lost.to, "suspended");
    assert.equal(lost.tierEventKind, "suspended");

    // Funds coming back does not lower the record and does not
    // restore anything.
    const reinstated = decideAlakazamReversalConsequence({
      policy: EXAMPLE_POLICY,
      outcome: "dispute_funds_reinstated",
      subscriptionStatus: "suspended",
      currentSeverity: 80
    });
    assert.equal(reinstated.severity, 80);
    assert.equal(reinstated.to, "suspended");
    assert.equal(reinstated.tierEventKind, null);

    // Winning a dispute is recorded, never a restoration.
    const won = decideAlakazamReversalConsequence({
      policy: EXAMPLE_POLICY,
      outcome: "dispute_won",
      subscriptionStatus: "suspended",
      currentSeverity: 70
    });
    assert.equal(won.severity, 70);
    assert.equal(won.to, "suspended");
    assert.equal(won.tierEventKind, null);
  }
);

test(
  "a failed refund moves no money and carries no consequence",
  () => {
    const failed = decideAlakazamReversalConsequence({
      policy: EXAMPLE_POLICY,
      outcome: "refund_failed",
      subscriptionStatus: "active"
    });
    assert.equal(failed.to, "active");
    assert.equal(failed.tierEventKind, null);
    assert.equal(failed.consequence, "record_only");
    assert.equal(failed.serviceState, "unchanged");
    assert.equal(failed.ownerReviewRequired, false);
  }
);

test(
  "an approved ruling suspends only from a suspendable state",
  () => {
    for (const from of ["active", "grace"]) {
      const decision = decideAlakazamReversalConsequence({
        policy: EXAMPLE_POLICY,
        outcome: "refund_full",
        subscriptionStatus: from
      });
      assert.equal(decision.to, "suspended");
      assert.equal(decision.tierEventKind, "suspended");
    }
    for (const from of ["suspended", "cancelled", "ended"]) {
      const decision = decideAlakazamReversalConsequence({
        policy: EXAMPLE_POLICY,
        outcome: "refund_full",
        subscriptionStatus: from
      });
      assert.equal(decision.to, from);
      assert.equal(decision.tierEventKind, null);
    }
  }
);

test(
  "reversal events need a Charge and a PaymentIntent to be ours",
  () => {
    assert.equal(isAlakazamReversalEvent(reversalEvent()), true);
    for (const type of ALAKAZAM_REVERSAL_EVENT_TYPES) {
      assert.equal(
        isAlakazamReversalEvent(reversalEvent({ type })),
        true,
        type
      );
    }
    assert.equal(
      isAlakazamReversalEvent(
        reversalEvent({ type: "invoice.paid" })
      ),
      false
    );
    assert.equal(
      isAlakazamReversalEvent(
        reversalEvent({
          data: { object: { id: CHARGE_ID, object: "charge" } }
        })
      ),
      false
    );
  }
);

test(
  "an unowned charge is left entirely alone",
  async () => {
    const { service, calls } = harness({
      resolved: { status: "not_alakazam" }
    });
    assert.deepEqual(
      await service.ingestStripeEvent(reversalEvent()),
      { status: "not_alakazam_reversal" }
    );
    assert.deepEqual(calls.readbacks, []);
    assert.deepEqual(calls.writes, []);
    assert.deepEqual(calls.ids, []);
    assert.deepEqual(calls.lookups, [
      {
        stripeEventId: "evt_alakazam_reversal_1",
        stripeChargeId: CHARGE_ID,
        stripePaymentIntentId: PAYMENT_INTENT_ID
      }
    ]);
  }
);

test(
  "an owned reversal is recorded defensively with no refund offer",
  async () => {
    const { service, calls } = harness({
      resolved: {
        status: "current",
        provider: "stripe",
        stripeChargeId: CHARGE_ID,
        subscription: reversalSubscription(),
        currentSeverity: 0
      },
      facts: reversalFacts(),
      result: reversalResult()
    });
    const ready = await service.readiness();
    assert.equal(ready.customerRefundOffered, false);
    assert.equal(ready.state, "reversal_evidence_only");

    const result = await service.ingestStripeEvent(
      reversalEvent()
    );
    assert.equal(result.status, "reversal_recorded");
    assert.equal(result.consequenceApplied, false);
    assert.equal(result.ownerReviewRequired, true);
    assert.equal(result.decision.customerRefundOffered, false);
    assert.equal(result.next, "owner_reconciliation");
    // No tier-event id is minted while the ruling is missing.
    assert.deepEqual(calls.ids, [
      "alakazam_reversal_event",
      "alakazam_reversal"
    ]);
  }
);

test(
  "incoherent provider reversal evidence commits nothing",
  async () => {
    for (const override of [
      // A full refund that did not return the full charge.
      { outcome: "refund_full", amountReversedMinor: 100 },
      // A dispute outcome carrying a refund identifier.
      {
        reversalKind: "dispute",
        outcome: "dispute_lost",
        stripeRefundId: "re_alakazam_reversal_1",
        stripeDisputeId: "dp_alakazam_reversal_1"
      },
      // Money reversed beyond what was ever charged.
      {
        outcome: "refund_partial",
        amountReversedMinor: 9900
      }
    ]) {
      const { service, calls } = harness({
        resolved: {
          status: "current",
          provider: "stripe",
          stripeChargeId: CHARGE_ID,
          subscription: reversalSubscription(),
          currentSeverity: 0
        },
        facts: reversalFacts(override)
      });
      await assert.rejects(
        () => service.ingestStripeEvent(reversalEvent()),
        { code: "stripe_alakazam_reversal_mismatch" }
      );
      assert.deepEqual(calls.writes, []);
    }
  }
);

test(
  "the reversal lane cannot be wired to anything that issues a refund",
  () => {
    assert.throws(
      () =>
        createAlakazamReversalService({
          repository: {
            async findReversalPaymentByCharge() {},
            async recordReversal() {},
            async issueRefund() {}
          },
          provider: {
            async readiness() {},
            async retrieveAlakazamReversal() {}
          },
          clock: { now: () => VERIFIED_AT },
          ids: { next: () => REVERSAL_ID },
          release: APPROVED_RELEASE
        }),
      { code: "invalid_configuration" }
    );
    assert.throws(
      () =>
        createAlakazamReversalService({
          repository: {
            async findReversalPaymentByCharge() {},
            async recordReversal() {}
          },
          provider: {
            async readiness() {},
            async retrieveAlakazamReversal() {},
            async createRefund() {}
          },
          clock: { now: () => VERIFIED_AT },
          ids: { next: () => REVERSAL_ID },
          release: APPROVED_RELEASE
        }),
      { code: "invalid_configuration" }
    );
  }
);

test(
  "a repository that restores service from a reversal is refused",
  async () => {
    const { service } = harness({
      policy: EXAMPLE_POLICY,
      resolved: {
        status: "current",
        provider: "stripe",
        stripeChargeId: CHARGE_ID,
        subscription: reversalSubscription({
          status: "suspended"
        }),
        currentSeverity: 70
      },
      facts: reversalFacts({
        reversalKind: "dispute",
        outcome: "dispute_won",
        stripeRefundId: null,
        stripeDisputeId: "dp_alakazam_reversal_1",
        amountReversedMinor: 0
      }),
      result: reversalResult({
        subscriptionStatus: "active",
        consequenceApplied: true,
        decision: decideAlakazamReversalConsequence({
          policy: EXAMPLE_POLICY,
          outcome: "dispute_won",
          subscriptionStatus: "suspended",
          currentSeverity: 70
        })
      })
    });
    await assert.rejects(
      () => service.ingestStripeEvent(reversalEvent()),
      { code: "repository_conflict" }
    );
  }
);

test(
  "a held release records nothing at all",
  async () => {
    const { service, calls } = harness({
      release: createAlakazamBillingRelease(),
      resolved: {
        status: "current",
        provider: "stripe",
        stripeChargeId: CHARGE_ID,
        subscription: reversalSubscription(),
        currentSeverity: 0
      }
    });
    const ready = await service.readiness();
    assert.equal(ready.ready, false);
    assert.equal(ready.state, "held");
    assert.equal(ready.customerRefundOffered, false);
    await assert.rejects(
      () => service.ingestStripeEvent(reversalEvent()),
      { code: "alakazam_reversal_reconciliation_unavailable" }
    );
    assert.deepEqual(calls.lookups, []);
    assert.deepEqual(calls.writes, []);
  }
);
