import assert from "node:assert/strict";
import test from "node:test";

import {
  PROFESSIONAL_REVERSAL_RESULT_SCHEMA,
  createPostgresProfessionalServicesReversalRepository
} from "../professional-services-reversal-postgres.mjs";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "30000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "40000000-0000-4000-8000-000000000001";
const EVIDENCE_ID = "50000000-0000-4000-8000-000000000001";
const LIFECYCLE_ID = "60000000-0000-4000-8000-000000000001";
const RECONCILIATION_ID = "70000000-0000-4000-8000-000000000001";
const OPERATOR_ID = "80000000-0000-4000-8000-000000000001";

function paymentRow(overrides = {}) {
  return {
    payment_purpose: "assessment",
    receipt_id: RECEIPT_ID,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    customer_user_id: CUSTOMER_ID,
    payment_intent_id: "pi_professional_reversal_1",
    total_minor: "21400",
    currency: "USD",
    current_state: "active",
    current_severity: "0",
    lifecycle_revision: "0",
    credit_state: "none",
    quote_state: "none",
    ...overrides
  };
}

function resultRow(overrides = {}) {
  return {
    result_status: "recorded",
    evidence_id: EVIDENCE_ID,
    lifecycle_id: LIFECYCLE_ID,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    customer_user_id: CUSTOMER_ID,
    payment_purpose: "assessment",
    receipt_id: RECEIPT_ID,
    lifecycle_state: "terminated",
    severity: "70",
    lifecycle_revision: "1",
    access_consequence: "preserve_records_terminate_new_work",
    credit_consequence: "block_unapplied_credit",
    quote_consequence: "terminate_effective_quote_authority",
    reconciliation_required: false,
    ...overrides
  };
}

function harness(handler) {
  const calls = [];
  const repository = createPostgresProfessionalServicesReversalRepository({
    authority: {
      async service(context, work) {
        calls.push({ context });
        return work({
          async query(text, values) {
            calls.push({ text, values });
            return handler(text, values);
          }
        });
      }
    }
  });
  return { repository, calls };
}

test("payment lookup is organization-bound and rejects multiple matches", async () => {
  const { repository, calls } = harness(() => ({
    rows: [paymentRow()],
    rowCount: 1
  }));
  const payment = await repository.findPaymentByIntent({
    organizationId: ORGANIZATION_ID,
    paymentIntentId: "pi_professional_reversal_1"
  });
  assert.equal(payment.paymentPurpose, "assessment");
  assert.equal(payment.totalMinor, 21400);
  assert.deepEqual(calls[0].context, {
    actorKind: "system",
    organizationId: ORGANIZATION_ID,
    readOnly: true
  });
  assert.match(calls[1].text, /service_professional_payment_binding_by_intent/u);
  assert.deepEqual(calls[1].values, [
    ORGANIZATION_ID,
    "pi_professional_reversal_1"
  ]);

  const conflicted = harness(() => ({
    rows: [paymentRow(), paymentRow({ receipt_id: EVIDENCE_ID })],
    rowCount: 2
  })).repository;
  await assert.rejects(
    conflicted.findPaymentByIntent({
      organizationId: ORGANIZATION_ID,
      paymentIntentId: "pi_professional_reversal_1"
    }),
    (error) => error.code === "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT"
  );
});

test("recording calls only the evidence-first database function", async () => {
  const { repository, calls } = harness((text) => {
    assert.match(text, /record_service_professional_reversal/u);
    assert.doesNotMatch(text, /stripe|refunds[.]create|payment_intents[.]create/iu);
    return { rows: [resultRow()], rowCount: 1 };
  });
  const decision = {
    schema: "sitesourcery.professional-services-reversal-decision/v1",
    toState: "terminated",
    resultingSeverity: 70,
    accessConsequence: "preserve_records_terminate_new_work",
    creditConsequence: "block_unapplied_credit",
    quoteConsequence: "terminate_effective_quote_authority"
  };
  const result = await repository.recordEvidence({
    evidenceId: EVIDENCE_ID,
    lifecycleId: LIFECYCLE_ID,
    payment: {
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
      quoteState: "none"
    },
    providerEventId: "evt_professional_reversal_1",
    providerEventType: "charge.refunded",
    paymentIntentId: "pi_professional_reversal_1",
    providerObjectId: "ch_professional_reversal_1",
    evidenceCertainty: "verified",
    outcome: "refund_full",
    amountChargedMinor: 21400,
    amountReversedMinor: 21400,
    currency: "USD",
    providerFacts: { exact: true },
    providerFactsDigest: "1".repeat(64),
    providerObservedAt: "2026-08-10T16:00:00.000Z",
    recordedAt: "2026-08-10T16:00:01.000Z",
    decision
  });
  assert.equal(result.schema, PROFESSIONAL_REVERSAL_RESULT_SCHEMA);
  assert.equal(result.status, "recorded");
  assert.equal(result.lifecycleState, "terminated");
  assert.deepEqual(calls[0].context, {
    actorKind: "system",
    organizationId: ORGANIZATION_ID,
    isolation: "serializable"
  });
  assert.equal(calls[1].values.length, 17);
});

test("a database/domain consequence mismatch fails closed", async () => {
  const { repository } = harness(() => ({
    rows: [resultRow({ lifecycle_state: "held", severity: "50" })],
    rowCount: 1
  }));
  await assert.rejects(
    repository.recordEvidence({
      evidenceId: EVIDENCE_ID,
      lifecycleId: LIFECYCLE_ID,
      payment: {
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
        quoteState: "none"
      },
      providerEventId: "evt_professional_reversal_1",
      providerEventType: "charge.refunded",
      paymentIntentId: "pi_professional_reversal_1",
      providerObjectId: "ch_professional_reversal_1",
      evidenceCertainty: "verified",
      outcome: "refund_full",
      amountChargedMinor: 21400,
      amountReversedMinor: 21400,
      currency: "USD",
      providerFacts: { exact: true },
      providerFactsDigest: "1".repeat(64),
      providerObservedAt: "2026-08-10T16:00:00.000Z",
      recordedAt: "2026-08-10T16:00:01.000Z",
      decision: {
        schema: "sitesourcery.professional-services-reversal-decision/v1",
        toState: "terminated",
        resultingSeverity: 70,
        accessConsequence: "preserve_records_terminate_new_work",
        creditConsequence: "block_unapplied_credit",
        quoteConsequence: "terminate_effective_quote_authority"
      }
    }),
    (error) => error.code === "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT"
  );
});

test("operator reconciliation carries exact identity and revision to one DB function", async () => {
  const { repository, calls } = harness((text) => {
    assert.match(text, /reconcile_service_professional_reversal/u);
    assert.doesNotMatch(text, /stripe|refunds[.]create|charges[.]create/iu);
    return {
      rows: [resultRow({ result_status: "reconciled" })],
      rowCount: 1
    };
  });
  const result = await repository.reconcileEvidence({
    reconciliationId: RECONCILIATION_ID,
    organizationId: ORGANIZATION_ID,
    evidenceId: EVIDENCE_ID,
    operatorId: OPERATOR_ID,
    commandId: "professional-reversal-reconcile-1",
    expectedLifecycleRevision: 3,
    resolution: "confirmed",
    confirmedOutcome: "refund_full",
    verifiedFacts: { readback: "confirmed" },
    verifiedFactsDigest: "2".repeat(64),
    verifiedObservedAt: "2026-08-10T16:05:00.000Z",
    reconciledAt: "2026-08-10T16:05:01.000Z"
  });
  assert.equal(result.status, "reconciled");
  assert.deepEqual(calls[0].context, {
    actorKind: "operator",
    userId: OPERATOR_ID,
    organizationId: ORGANIZATION_ID,
    isolation: "serializable"
  });
  assert.equal(calls[1].values[5], 3);
  assert.equal(calls[1].values[10], "refund_full");
  assert.equal(calls[1].values[11], "2026-08-10T16:05:01.000Z");
});

test("database conflicts are translated without retrying money", async () => {
  const { repository } = harness(() => {
    const error = new Error("stale revision");
    error.code = "40001";
    throw error;
  });
  await assert.rejects(
    repository.findPaymentByIntent({
      organizationId: ORGANIZATION_ID,
      paymentIntentId: "pi_professional_reversal_1"
    }),
    (error) =>
      error.code === "PROFESSIONAL_REVERSAL_CHANGED" &&
      error.status === 409
  );
});
