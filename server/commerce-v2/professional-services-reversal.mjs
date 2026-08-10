import {
  clone,
  deepFreeze,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

export const PROFESSIONAL_REVERSAL_DECISION_SCHEMA =
  "sitesourcery.professional-services-reversal-decision/v1";
export const PROFESSIONAL_REVERSAL_EVIDENCE_SCHEMA =
  "sitesourcery.professional-services-reversal-evidence/v1";
export const PROFESSIONAL_REVERSAL_RECONCILIATION_SCHEMA =
  "sitesourcery.professional-services-reversal-reconciliation/v1";

export const PROFESSIONAL_PAYMENT_PURPOSES = Object.freeze([
  "assessment",
  "custom_build_initial",
  "custom_build_change",
  "custom_build_final"
]);

export const PROFESSIONAL_REVERSAL_OUTCOMES = Object.freeze({
  refund_failed: Object.freeze({ severity: 10, targetState: "active" }),
  dispute_won: Object.freeze({ severity: 20, targetState: "active" }),
  dispute_funds_reinstated: Object.freeze({
    severity: 30,
    targetState: "active"
  }),
  dispute_open: Object.freeze({ severity: 40, targetState: "held" }),
  refund_partial: Object.freeze({ severity: 50, targetState: "held" }),
  dispute_funds_withdrawn: Object.freeze({
    severity: 60,
    targetState: "held"
  }),
  refund_full: Object.freeze({ severity: 70, targetState: "terminated" }),
  dispute_lost: Object.freeze({ severity: 80, targetState: "terminated" })
});

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/u;
const PROVIDER_EVENT_ID = /^evt_[A-Za-z0-9_]+$/u;
const PROVIDER_OBJECT_ID = /^(?:ch|re|dp)_[A-Za-z0-9_]+$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const PURPOSES = new Set(PROFESSIONAL_PAYMENT_PURPOSES);
const LIFECYCLE_STATES = Object.freeze({ active: 0, held: 1, terminated: 2 });
const CREDIT_STATES = new Set([
  "none",
  "reserved",
  "settled",
  "released",
  "reconciliation_required"
]);
const QUOTE_STATES = new Set(["none", "issued", "accepted", "voided"]);
const EVIDENCE_CERTAINTIES = new Set(["verified", "ambiguous"]);

function exactKeys(value, expected, field, { status = 400 } = {}) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    status === 400 ? "invalid_input" : "repository_conflict",
    `${field} is invalid`,
    { status }
  );
  return value;
}

function exactUuid(value, field, { status = 400 } = {}) {
  invariant(
    typeof value === "string" && UUID.test(value),
    status === 400 ? "invalid_input" : "repository_conflict",
    `${field} is invalid`,
    { status }
  );
  return value;
}

function exactChoice(value, choices, field, { status = 400 } = {}) {
  invariant(
    choices.has(value),
    status === 400 ? "invalid_input" : "repository_conflict",
    `${field} is invalid`,
    { status }
  );
  return value;
}

function exactInteger(value, field, { minimum = 0, status = 400 } = {}) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) && selected >= minimum,
    status === 400 ? "invalid_input" : "repository_conflict",
    `${field} is invalid`,
    { status }
  );
  return selected;
}

function exactCommandId(value) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      value.length >= 8 &&
      value.length <= 200 &&
      !CONTROL.test(value),
    "invalid_input",
    "commandId is invalid",
    { status: 400 }
  );
  return value;
}

function exactProviderId(value, pattern, field, { status = 400 } = {}) {
  const selected = typeof value === "string" ? value : "";
  invariant(
    selected === selected.trim() &&
      selected.length > 0 &&
      selected.length <= 200 &&
      pattern.test(selected),
    status === 400 ? "invalid_input" : "repository_conflict",
    `${field} is invalid`,
    { status }
  );
  return selected;
}

function consequences(state, creditState) {
  if (state === "active") {
    return Object.freeze({
      access: "unchanged",
      credit: "unchanged",
      quote: "unchanged"
    });
  }
  const credit = creditState === "settled"
    ? "preserve_settled_credit_no_reissue"
    : ["reserved", "reconciliation_required"].includes(creditState)
      ? "freeze_reserved_credit_no_reissue"
      : "block_unapplied_credit";
  return Object.freeze({
    access: state === "held"
      ? "preserve_records_hold_new_work"
      : "preserve_records_terminate_new_work",
    credit,
    quote: state === "held"
      ? "hold_effective_quote_authority"
      : "terminate_effective_quote_authority"
  });
}

export function exactProfessionalPayment(value) {
  exactKeys(
    value,
    [
      "creditState",
      "currency",
      "currentSeverity",
      "currentState",
      "customerId",
      "lifecycleRevision",
      "organizationId",
      "paymentIntentId",
      "paymentPurpose",
      "projectId",
      "quoteState",
      "receiptId",
      "totalMinor"
    ],
    "professionalPayment",
    { status: 500 }
  );
  const currentState = exactChoice(
    value.currentState,
    new Set(Object.keys(LIFECYCLE_STATES)),
    "professionalPayment.currentState",
    { status: 500 }
  );
  return deepFreeze({
    paymentPurpose: exactChoice(
      value.paymentPurpose,
      PURPOSES,
      "professionalPayment.paymentPurpose",
      { status: 500 }
    ),
    receiptId: exactUuid(value.receiptId, "professionalPayment.receiptId", {
      status: 500
    }),
    organizationId: exactUuid(
      value.organizationId,
      "professionalPayment.organizationId",
      { status: 500 }
    ),
    projectId: exactUuid(value.projectId, "professionalPayment.projectId", {
      status: 500
    }),
    customerId: exactUuid(value.customerId, "professionalPayment.customerId", {
      status: 500
    }),
    paymentIntentId: exactProviderId(
      value.paymentIntentId,
      PAYMENT_INTENT_ID,
      "professionalPayment.paymentIntentId",
      { status: 500 }
    ),
    totalMinor: exactInteger(value.totalMinor, "professionalPayment.totalMinor", {
      minimum: 1,
      status: 500
    }),
    currency: exactChoice(
      value.currency,
      new Set(["USD"]),
      "professionalPayment.currency",
      { status: 500 }
    ),
    currentState,
    currentSeverity: exactInteger(
      value.currentSeverity,
      "professionalPayment.currentSeverity",
      { status: 500 }
    ),
    lifecycleRevision: exactInteger(
      value.lifecycleRevision,
      "professionalPayment.lifecycleRevision",
      { status: 500 }
    ),
    creditState: exactChoice(
      value.creditState,
      CREDIT_STATES,
      "professionalPayment.creditState",
      { status: 500 }
    ),
    quoteState: exactChoice(
      value.quoteState,
      QUOTE_STATES,
      "professionalPayment.quoteState",
      { status: 500 }
    )
  });
}

export function decideProfessionalReversalConsequence({
  outcome,
  payment
} = {}) {
  const selectedPayment = exactProfessionalPayment(payment);
  const observed = PROFESSIONAL_REVERSAL_OUTCOMES[outcome];
  invariant(
    observed,
    "invalid_input",
    "outcome is invalid",
    { status: 400 }
  );
  const resultingState = LIFECYCLE_STATES[observed.targetState] >
      LIFECYCLE_STATES[selectedPayment.currentState]
    ? observed.targetState
    : selectedPayment.currentState;
  const selectedConsequences = consequences(
    resultingState,
    selectedPayment.creditState
  );
  return deepFreeze({
    schema: PROFESSIONAL_REVERSAL_DECISION_SCHEMA,
    outcome,
    observedSeverity: observed.severity,
    resultingSeverity: Math.max(
      selectedPayment.currentSeverity,
      observed.severity
    ),
    fromState: selectedPayment.currentState,
    toState: resultingState,
    accessConsequence: selectedConsequences.access,
    creditConsequence: selectedConsequences.credit,
    quoteConsequence: selectedConsequences.quote,
    ownerReviewRequired: outcome !== "refund_failed",
    customerRefundOffered: false,
    providerEffectAuthorized: false,
    automaticRestorationAuthorized: false
  });
}

function exactRecordInput(value) {
  exactKeys(
    value,
    [
      "amountChargedMinor",
      "amountReversedMinor",
      "currency",
      "evidenceCertainty",
      "organizationId",
      "outcome",
      "paymentIntentId",
      "providerEventId",
      "providerEventType",
      "providerFacts",
      "providerFactsDigest",
      "providerObjectId",
      "providerObservedAt"
    ],
    "professionalReversalEvidence"
  );
  const evidenceCertainty = exactChoice(
    value.evidenceCertainty,
    EVIDENCE_CERTAINTIES,
    "evidenceCertainty"
  );
  const amountReversedMinor = value.amountReversedMinor === null
    ? null
    : exactInteger(value.amountReversedMinor, "amountReversedMinor");
  invariant(
    (evidenceCertainty === "verified" &&
      PROFESSIONAL_REVERSAL_OUTCOMES[value.outcome] &&
      amountReversedMinor !== null) ||
      (evidenceCertainty === "ambiguous" &&
        value.outcome === null &&
        amountReversedMinor === null),
    "invalid_input",
    "reversal certainty, outcome, and amount do not agree",
    { status: 400 }
  );
  const providerFacts = exactKeys(
    value.providerFacts,
    Object.keys(value.providerFacts ?? {}),
    "providerFacts"
  );
  return Object.freeze({
    organizationId: exactUuid(value.organizationId, "organizationId"),
    providerEventId: exactProviderId(
      value.providerEventId,
      PROVIDER_EVENT_ID,
      "providerEventId"
    ),
    providerEventType: requiredText(
      value.providerEventType,
      "providerEventType",
      120
    ),
    paymentIntentId: exactProviderId(
      value.paymentIntentId,
      PAYMENT_INTENT_ID,
      "paymentIntentId"
    ),
    providerObjectId: exactProviderId(
      value.providerObjectId,
      PROVIDER_OBJECT_ID,
      "providerObjectId"
    ),
    evidenceCertainty,
    outcome: value.outcome,
    amountChargedMinor: exactInteger(
      value.amountChargedMinor,
      "amountChargedMinor",
      { minimum: 1 }
    ),
    amountReversedMinor,
    currency: exactChoice(value.currency, new Set(["USD"]), "currency"),
    providerFacts: clone(providerFacts),
    providerFactsDigest: requiredDigest(
      value.providerFactsDigest,
      "providerFactsDigest"
    ),
    providerObservedAt: requiredIso(
      value.providerObservedAt,
      "providerObservedAt"
    )
  });
}

function exactReconciliationInput(value) {
  exactKeys(
    value,
    [
      "commandId",
      "confirmedOutcome",
      "evidenceId",
      "expectedLifecycleRevision",
      "organizationId",
      "resolution",
      "verifiedFacts",
      "verifiedFactsDigest",
      "verifiedObservedAt"
    ],
    "professionalReversalReconciliation"
  );
  const resolution = exactChoice(
    value.resolution,
    new Set(["confirmed", "not_effective"]),
    "resolution"
  );
  invariant(
    (resolution === "confirmed" &&
      PROFESSIONAL_REVERSAL_OUTCOMES[value.confirmedOutcome]) ||
      (resolution === "not_effective" && value.confirmedOutcome === null),
    "invalid_input",
    "resolution and confirmedOutcome do not agree",
    { status: 400 }
  );
  return Object.freeze({
    organizationId: exactUuid(value.organizationId, "organizationId"),
    evidenceId: exactUuid(value.evidenceId, "evidenceId"),
    commandId: exactCommandId(value.commandId),
    expectedLifecycleRevision: exactInteger(
      value.expectedLifecycleRevision,
      "expectedLifecycleRevision",
      { minimum: 1 }
    ),
    resolution,
    confirmedOutcome: value.confirmedOutcome,
    verifiedFacts: clone(exactKeys(
      value.verifiedFacts,
      Object.keys(value.verifiedFacts ?? {}),
      "verifiedFacts"
    )),
    verifiedFactsDigest: requiredDigest(
      value.verifiedFactsDigest,
      "verifiedFactsDigest"
    ),
    verifiedObservedAt: requiredIso(
      value.verifiedObservedAt,
      "verifiedObservedAt"
    )
  });
}

function exactPorts({ repository, clock, ids } = {}) {
  invariant(
    repository &&
      typeof repository.findPaymentByIntent === "function" &&
      typeof repository.recordEvidence === "function" &&
      typeof repository.reconcileEvidence === "function",
    "invalid_configuration",
    "professional reversal repository is required",
    { status: 500 }
  );
  invariant(
    clock && typeof clock.now === "function",
    "invalid_configuration",
    "professional reversal clock is required",
    { status: 500 }
  );
  invariant(
    ids && typeof ids.next === "function",
    "invalid_configuration",
    "professional reversal IDs are required",
    { status: 500 }
  );
  return { repository, clock, ids };
}

export function createProfessionalServicesReversalService(options = {}) {
  const ports = exactPorts(options);
  return Object.freeze({
    async recordEvidence(value) {
      const input = exactRecordInput(value);
      const payment = await ports.repository.findPaymentByIntent({
        organizationId: input.organizationId,
        paymentIntentId: input.paymentIntentId
      });
      if (payment === null) {
        return deepFreeze({ status: "not_professional_services" });
      }
      const selectedPayment = exactProfessionalPayment(payment);
      invariant(
        selectedPayment.totalMinor === input.amountChargedMinor &&
          selectedPayment.currency === input.currency,
        "reversal_binding_invalid",
        "provider reversal evidence does not match the paid receipt",
        { status: 409 }
      );
      const decision = input.evidenceCertainty === "verified"
        ? decideProfessionalReversalConsequence({
            outcome: input.outcome,
            payment: selectedPayment
          })
        : null;
      return deepFreeze(clone(await ports.repository.recordEvidence({
        ...input,
        evidenceId: exactUuid(
          ports.ids.next("professional_reversal_evidence"),
          "evidenceId",
          { status: 500 }
        ),
        lifecycleId: exactUuid(
          ports.ids.next("professional_payment_lifecycle"),
          "lifecycleId",
          { status: 500 }
        ),
        payment: selectedPayment,
        decision,
        recordedAt: requiredIso(ports.clock.now(), "clock.now")
      })));
    },

    async reconcileEvidence(actor, value) {
      const input = exactReconciliationInput(value);
      const operatorId = exactUuid(actor?.userId, "operatorId");
      return deepFreeze(clone(await ports.repository.reconcileEvidence({
        ...input,
        operatorId,
        reconciliationId: exactUuid(
          ports.ids.next("professional_reversal_reconciliation"),
          "reconciliationId",
          { status: 500 }
        ),
        reconciledAt: requiredIso(ports.clock.now(), "clock.now")
      })));
    }
  });
}
