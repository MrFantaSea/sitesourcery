import assert from "node:assert/strict";
import test from "node:test";

import {
  PROFESSIONAL_PAYMENT_PURPOSES,
  PROFESSIONAL_REVERSAL_DECISION_SCHEMA,
  PROFESSIONAL_REVERSAL_OUTCOMES,
  createProfessionalServicesReversalService,
  decideProfessionalReversalConsequence
} from "../professional-services-reversal.mjs";
import { digest } from "../canonical.mjs";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "30000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "40000000-0000-4000-8000-000000000001";
const EVIDENCE_ID = "50000000-0000-4000-8000-000000000001";
const LIFECYCLE_ID = "60000000-0000-4000-8000-000000000001";
const RECONCILIATION_ID = "70000000-0000-4000-8000-000000000001";
const OPERATOR_ID = "80000000-0000-4000-8000-000000000001";
const NOW = "2026-08-10T16:00:00.000Z";

function payment(overrides = {}) {
  return {
    paymentPurpose: "assessment",
    receiptId: RECEIPT_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    customerId: CUSTOMER_ID,
    paymentIntentId: "pi_professional_reversal_1",
    totalMinor: 21400,
    currency: "USD",
    currentState: "active",
    currentSeverity: 0,
    lifecycleRevision: 0,
    creditState: "none",
    quoteState: "none",
    ...overrides
  };
}

function providerFacts(overrides = {}) {
  return {
    schema: "sitesourcery.stripe-professional-reversal-facts/v1",
    paymentIntentId: "pi_professional_reversal_1",
    amountChargedMinor: 21400,
    amountReversedMinor: 21400,
    currency: "USD",
    ...overrides
  };
}

function evidence(overrides = {}) {
  const facts = providerFacts();
  return {
    organizationId: ORGANIZATION_ID,
    providerEventId: "evt_professional_reversal_1",
    providerEventType: "charge.refunded",
    paymentIntentId: "pi_professional_reversal_1",
    providerObjectId: "ch_professional_reversal_1",
    evidenceCertainty: "verified",
    outcome: "refund_full",
    amountChargedMinor: 21400,
    amountReversedMinor: 21400,
    currency: "USD",
    providerFacts: facts,
    providerFactsDigest: digest(facts),
    providerObservedAt: NOW,
    ...overrides
  };
}

test("all professional payment purposes share the bounded reversal contract", () => {
  assert.deepEqual(PROFESSIONAL_PAYMENT_PURPOSES, [
    "assessment",
    "custom_build_initial",
    "custom_build_change",
    "custom_build_final"
  ]);
});

test("verified outcomes move only up the active-held-terminated ladder", () => {
  const held = decideProfessionalReversalConsequence({
    outcome: "refund_partial",
    payment: payment({ creditState: "reserved", quoteState: "accepted" })
  });
  assert.equal(held.schema, PROFESSIONAL_REVERSAL_DECISION_SCHEMA);
  assert.equal(held.toState, "held");
  assert.equal(held.accessConsequence, "preserve_records_hold_new_work");
  assert.equal(held.creditConsequence, "freeze_reserved_credit_no_reissue");
  assert.equal(held.quoteConsequence, "hold_effective_quote_authority");

  const recovered = decideProfessionalReversalConsequence({
    outcome: "dispute_won",
    payment: payment({
      currentState: "terminated",
      currentSeverity: 80,
      lifecycleRevision: 5,
      creditState: "settled",
      quoteState: "accepted"
    })
  });
  assert.equal(recovered.toState, "terminated");
  assert.equal(recovered.resultingSeverity, 80);
  assert.equal(
    recovered.accessConsequence,
    "preserve_records_terminate_new_work"
  );
  assert.equal(
    recovered.creditConsequence,
    "preserve_settled_credit_no_reissue"
  );
  assert.equal(recovered.automaticRestorationAuthorized, false);
  assert.equal(recovered.providerEffectAuthorized, false);
  assert.equal(recovered.customerRefundOffered, false);
});

test("failed refunds record evidence without changing access, credit, or quote", () => {
  const decision = decideProfessionalReversalConsequence({
    outcome: "refund_failed",
    payment: payment()
  });
  assert.equal(decision.toState, "active");
  assert.equal(decision.accessConsequence, "unchanged");
  assert.equal(decision.creditConsequence, "unchanged");
  assert.equal(decision.quoteConsequence, "unchanged");
  assert.equal(decision.ownerReviewRequired, false);
});

test("full refunds and lost disputes terminate future work but preserve records", () => {
  for (const outcome of ["refund_full", "dispute_lost"]) {
    const decision = decideProfessionalReversalConsequence({
      outcome,
      payment: payment({ creditState: "settled", quoteState: "accepted" })
    });
    assert.equal(decision.toState, "terminated", outcome);
    assert.equal(
      decision.accessConsequence,
      "preserve_records_terminate_new_work",
      outcome
    );
    assert.equal(
      decision.creditConsequence,
      "preserve_settled_credit_no_reissue",
      outcome
    );
  }
});

test("the service binds verified evidence to one exact paid receipt", async () => {
  const calls = [];
  const service = createProfessionalServicesReversalService({
    repository: {
      async findPaymentByIntent(input) {
        calls.push(["find", input]);
        return payment();
      },
      async recordEvidence(input) {
        calls.push(["record", input]);
        return {
          status: "recorded",
          evidenceId: input.evidenceId,
          lifecycleState: input.decision.toState
        };
      },
      async reconcileEvidence() {
        throw new Error("not reached");
      }
    },
    clock: { now: () => NOW },
    ids: {
      next(label) {
        return {
          professional_reversal_evidence: EVIDENCE_ID,
          professional_payment_lifecycle: LIFECYCLE_ID
        }[label];
      }
    }
  });
  const result = await service.recordEvidence(evidence());
  assert.deepEqual(result, {
    status: "recorded",
    evidenceId: EVIDENCE_ID,
    lifecycleState: "terminated"
  });
  assert.deepEqual(calls[0], ["find", {
    organizationId: ORGANIZATION_ID,
    paymentIntentId: "pi_professional_reversal_1"
  }]);
  assert.equal(calls[1][1].decision.toState, "terminated");
  assert.equal(calls[1][1].recordedAt, NOW);
});

test("unknown payment intents are ignored and mismatched amounts fail closed", async () => {
  const base = {
    clock: { now: () => NOW },
    ids: { next: () => EVIDENCE_ID }
  };
  const missing = createProfessionalServicesReversalService({
    ...base,
    repository: {
      async findPaymentByIntent() { return null; },
      async recordEvidence() { throw new Error("not reached"); },
      async reconcileEvidence() { throw new Error("not reached"); }
    }
  });
  assert.deepEqual(await missing.recordEvidence(evidence()), {
    status: "not_professional_services"
  });

  const mismatch = createProfessionalServicesReversalService({
    ...base,
    repository: {
      async findPaymentByIntent() { return payment({ totalMinor: 20000 }); },
      async recordEvidence() { throw new Error("not reached"); },
      async reconcileEvidence() { throw new Error("not reached"); }
    }
  });
  await assert.rejects(
    mismatch.recordEvidence(evidence()),
    (error) => error.code === "reversal_binding_invalid"
  );

  const malformed = createProfessionalServicesReversalService({
    ...base,
    repository: {
      async findPaymentByIntent() {
        return payment({ paymentIntentId: "not-a-payment-intent" });
      },
      async recordEvidence() { throw new Error("not reached"); },
      async reconcileEvidence() { throw new Error("not reached"); }
    }
  });
  await assert.rejects(
    malformed.recordEvidence(evidence()),
    (error) =>
      error.code === "repository_conflict" && error.status === 500
  );
});

test("ambiguous evidence has no guessed outcome and requires reconciliation", async () => {
  let recorded;
  const service = createProfessionalServicesReversalService({
    repository: {
      async findPaymentByIntent() { return payment(); },
      async recordEvidence(input) {
        recorded = input;
        return { status: "reconciliation_required" };
      },
      async reconcileEvidence() { throw new Error("not reached"); }
    },
    clock: { now: () => NOW },
    ids: {
      next(label) {
        return label === "professional_reversal_evidence"
          ? EVIDENCE_ID
          : LIFECYCLE_ID;
      }
    }
  });
  const result = await service.recordEvidence(evidence({
    evidenceCertainty: "ambiguous",
    outcome: null,
    amountReversedMinor: null
  }));
  assert.deepEqual(result, { status: "reconciliation_required" });
  assert.equal(recorded.decision, null);
});

test("operator reconciliation is exact-revision fenced and provider-effect free", async () => {
  let received;
  const service = createProfessionalServicesReversalService({
    repository: {
      async findPaymentByIntent() { throw new Error("not reached"); },
      async recordEvidence() { throw new Error("not reached"); },
      async reconcileEvidence(input) {
        received = input;
        return { status: "reconciled", lifecycleState: "terminated" };
      }
    },
    clock: { now: () => NOW },
    ids: { next: () => RECONCILIATION_ID }
  });
  const facts = { readback: "verified", providerEffectAuthorized: false };
  const result = await service.reconcileEvidence(
    { userId: OPERATOR_ID },
    {
      organizationId: ORGANIZATION_ID,
      evidenceId: EVIDENCE_ID,
      commandId: "pro-reversal-reconcile-1",
      expectedLifecycleRevision: 3,
      resolution: "confirmed",
      confirmedOutcome: "dispute_lost",
      verifiedFacts: facts,
      verifiedFactsDigest: digest(facts),
      verifiedObservedAt: NOW
    }
  );
  assert.deepEqual(result, {
    status: "reconciled",
    lifecycleState: "terminated"
  });
  assert.equal(received.operatorId, OPERATOR_ID);
  assert.equal(received.expectedLifecycleRevision, 3);
  assert.equal(received.reconciliationId, RECONCILIATION_ID);
  assert.equal(received.reconciledAt, NOW);
  assert.equal(received.verifiedFacts.providerEffectAuthorized, false);
});

test("every declared outcome has a monotonic severity and target", () => {
  let previous = 0;
  for (const { severity, targetState } of Object.values(
    PROFESSIONAL_REVERSAL_OUTCOMES
  )) {
    assert.ok(severity > previous);
    assert.ok(["active", "held", "terminated"].includes(targetState));
    previous = severity;
  }
});
