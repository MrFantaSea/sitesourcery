import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createClient } = require(
  "../../abracadabra/app/abracadabra-api.js"
);
const {
  customerAlakazamRetainedPremiumIsRelevant,
  customerCustomBuildFinalIsZeroBalance,
  customerCustomBuildCompletionEvidenceUrl,
  currentOwnerCustomBuildCompletionEvidence,
  prepareCustomBuildCompletionEvidenceFile,
  projectLegalEvidencePresentation,
  verifiedCustomerCustomBuildChangeCheckout,
  verifiedCustomerCustomBuildChangeCompletion,
  verifiedCustomerCustomBuildChangeInvoice,
  verifiedCustomBuildProgress,
  verifiedCustomerCustomBuildCheckout,
  verifiedCustomerCustomBuildInvoice,
  verifiedOwnerCustomBuildChangeCompletion,
  verifiedOwnerCustomBuildChangePaymentReconciliation,
  verifiedOwnerCustomBuildChangePayments
} = require(
  "../../abracadabra/app/abracadabra-customer-control-dom.js"
);

test("irrelevant final-payment and retained-premium controls stay hidden without errors", async () => {
  assert.equal(
    customerCustomBuildFinalIsZeroBalance({
      state: "completion_required",
      obligation: null
    }),
    false
  );
  assert.equal(
    customerCustomBuildFinalIsZeroBalance({
      state: "cleared_no_balance_handoff_pending",
      obligation: { amount: { amountMinor: 0, currency: "USD" } }
    }),
    true
  );
  assert.equal(customerAlakazamRetainedPremiumIsRelevant(null), false);
  assert.equal(
    customerAlakazamRetainedPremiumIsRelevant({
      revision: 1,
      status: "pending",
      tier: { tierId: "alakazam_50" }
    }),
    false
  );
  for (const status of [
    "active",
    "grace",
    "suspended",
    "cancelled",
    "ended"
  ]) {
    assert.equal(
      customerAlakazamRetainedPremiumIsRelevant({
        revision: 1,
        status,
        tier: { tierId: "alakazam_50" }
      }),
      true,
      status
    );
  }

  const source = await readFile(
    new URL(
      "../../abracadabra/app/abracadabra-customer-control-dom.js",
      import.meta.url
    ),
    "utf8"
  );
  const finalRefresh = source.slice(
    source.indexOf("function requestCustomerCustomBuildFinal"),
    source.indexOf("function requestCustomerCustomBuildFinalCheckout")
  );
  assert.match(
    finalRefresh,
    /customerCustomBuildFinalIsZeroBalance\(snapshot\)/u
  );
  assert.doesNotMatch(
    finalRefresh,
    /snapshot\.obligation\.amount\.amountMinor/u
  );
  const retainedMount = source.slice(
    source.indexOf("function syncAlakazamRetainedPremiumPanel"),
    source.indexOf("function resetAlakazamCommand")
  );
  assert.match(
    retainedMount,
    /!customerAlakazamRetainedPremiumIsRelevant\(\s*subscription\s*\)/u
  );
});

test("legacy project evidence stays visibly linked as accepted privacy V2", () => {
  const evidence = projectLegalEvidencePresentation({
    legal: {
      current: [{
        kind: "privacy",
        version: "SS-HOSTED-PRIVACY-2026-07-30-V2",
        contentDigest:
          "b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b",
        evidenceUri:
          "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/",
        acceptedAt: "2026-08-01T12:00:00.000Z",
      }],
      history: [],
    },
  });
  assert.equal(evidence.current.length, 1);
  assert.equal(evidence.current[0].label, "Accepted privacy V2");
  assert.equal(
    evidence.current[0].evidenceUri,
    "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/",
  );
  assert.doesNotMatch(evidence.current[0].label, /V3/u);

  assert.deepEqual(
    projectLegalEvidencePresentation({
      legal: {
        current: [{
          ...evidence.current[0],
          contentDigest: "b".repeat(64),
          evidenceUri: "https://attacker.test/privacy-v2/",
        }],
        history: [],
      },
    }).current,
    [],
  );
});

const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const QUOTE_ID = "50000000-0000-4000-8000-000000000001";
const INVOICE_ID = "60000000-0000-4000-8000-000000000001";
const JOB_ID = "80000000-0000-4000-8000-000000000001";
const INVOICE_NUMBER = "SSCB-60000000000040008000000000000001";
const ISSUED_AT = "2026-08-05T14:00:00.000Z";
const PAYMENT_DEADLINE = "2026-08-12T14:00:00.000Z";
const CHECKOUT_EXPIRES_AT = "2026-08-06T14:00:00.000Z";
const INVOICE_DIGEST = "c".repeat(64);
const QUOTE_DIGEST = "a".repeat(64);
const DISCLOSURE_DIGEST = "b".repeat(64);
const CHANGE_ORDER_ID = "81000000-0000-4000-8000-000000000001";
const CHANGE_ACCEPTANCE_ID = "81000000-0000-4000-8000-000000000002";
const CHANGE_INVOICE_ID = "81000000-0000-4000-8000-000000000003";
const CHANGE_ATTEMPT_ID = "81000000-0000-4000-8000-000000000004";
const CHANGE_RECEIPT_ID = "81000000-0000-4000-8000-000000000005";
const CHANGE_INVOICE_NUMBER = "SSCB-CHG-81000000000040008000000000000003";
const DESKTOP_EVIDENCE_ID = "82000000-0000-4000-8000-000000000001";
const PHONE_EVIDENCE_ID = "82000000-0000-4000-8000-000000000002";
const COMPLETION_ID = "83000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const CASE_ID = "84000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "10000000-0000-4000-8000-000000000001";
const OPERATOR_ID = "85000000-0000-4000-8000-000000000001";

test("account access tabs implement the complete automatic-activation keyboard pattern", async () => {
  const source = await readFile(
    new URL(
      "../../abracadabra/app/abracadabra-customer-control-dom.js",
      import.meta.url
    ),
    "utf8"
  );
  const keyboard = source.slice(
    source.indexOf("function moveAuthTab"),
    source.indexOf("function setStage")
  );
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
    assert.ok(keyboard.includes(`event.key === "${key}"`), key);
  }
  assert.match(keyboard, /event\.preventDefault\(\)/u);
  assert.match(keyboard, /setAuthMode\([\s\S]*?tabs\[next\]\.focus\(\)/u);
  assert.match(
    source,
    /button\.addEventListener\(\s*"keydown",\s*function \(event\) \{\s*moveAuthTab\(event, button\);/u
  );
});

const expectation = Object.freeze({
  acceptedDisclosureDigest: DISCLOSURE_DIGEST,
  acceptedQuoteDigest: QUOTE_DIGEST,
  creditMinor: 20000,
  finalHandoffMinor: 60000,
  grossStartMinor: 60000,
  issuedAt: ISSUED_AT,
  quoteId: QUOTE_ID,
  subtotalMinor: 40000,
  tierId: "site"
});

function projection(state = "checkout_available") {
  if (state === "not_available") {
    return {
      schema: "sitesourcery.custom-build-start-invoice/v1",
      state,
      invoice: null,
      action: { available: false, reason: "invoice_not_available" },
      job: null
    };
  }
  const paid = state === "paid";
  const ready = state === "checkout_ready";
  return {
    schema: "sitesourcery.custom-build-start-invoice/v1",
    state,
    invoice: {
      invoiceId: INVOICE_ID,
      invoiceNumber: INVOICE_NUMBER,
      invoiceDigest: INVOICE_DIGEST,
      quoteId: QUOTE_ID,
      tierId: "site",
      acceptedQuoteDigest: QUOTE_DIGEST,
      acceptedDisclosureDigest: DISCLOSURE_DIGEST,
      issuedAt: ISSUED_AT,
      paymentDeadline: PAYMENT_DEADLINE,
      lines: [
        {
          lineNumber: 1,
          componentKey: "custom_build_start",
          displayName: "Site first installment",
          amountMinor: 60000,
          currency: "USD"
        },
        {
          lineNumber: 2,
          componentKey: "assessment_build_credit",
          displayName: "Website assessment build credit",
          amountMinor: -20000,
          currency: "USD"
        }
      ],
      subtotal: { amountMinor: 40000, currency: "USD" },
      tax: { amountMinor: null, state: "calculated_at_checkout" },
      total: {
        amountMinor: null,
        currency: "USD",
        state: "shown_at_checkout"
      },
      credit: {
        amountMinor: 20000,
        state: paid
          ? "settled"
          : state === "reconciliation_required"
            ? "reconciliation_required"
            : "reserved"
      },
      finalHandoff: {
        amountMinor: 60000,
        state: "due_before_handoff"
      },
      payment: {
        chargeOccurred: paid,
        checkoutUrl: ready
          ? "https://checkout.stripe.com/c/pay/custom_build_test"
          : null,
        checkoutExpiresAt: ready ? CHECKOUT_EXPIRES_AT : null
      }
    },
    action: {
      available: state === "checkout_available",
      reason: state === "checkout_available" ? null : state
    },
    job: paid
      ? {
          jobId: JOB_ID,
          state: "open",
          openedAt: "2026-08-05T14:05:00.000Z",
          tierId: "site",
          scopeStatement:
            "Build the approved four-page Custom website from the accepted exact scope.",
          footprint: {
            craftedPages: 4,
            sections: 16,
            uniqueLayouts: 4,
            contentWords: 1800,
            suppliedMedia: 12
          },
          targetCompletionDate: "2026-09-15",
          firstPayment: {
            grossMinor: 60000,
            creditMinor: 20000,
            paidSubtotalMinor: 40000,
            currency: "USD"
          },
          finalHandoff: {
            amountMinor: 60000,
            currency: "USD",
            state: "unpaid"
          }
        }
      : null
  };
}

function checkout() {
  return {
    schema: "sitesourcery.custom-build-start-checkout/v1",
    state: "ready",
    checkout: {
      invoiceId: INVOICE_ID,
      invoiceNumber: INVOICE_NUMBER,
      url: "https://checkout.stripe.com/c/pay/custom_build_test",
      expiresAt: CHECKOUT_EXPIRES_AT,
      subtotal: { amountMinor: 40000, currency: "USD" },
      tax: { amountMinor: null, state: "calculated_at_checkout" },
      total: {
        amountMinor: null,
        currency: "USD",
        state: "shown_at_checkout"
      },
      chargeOccurred: false
    }
  };
}

function progressProjection(activeRequest = null) {
  const progress = {
    revision: 2,
    stage: "building",
    stageLabel: "Building",
    summary:
      "The approved structure is ready and the content pass is underway.",
    nextStep: "Complete the supplied page content.",
    updatedAt: "2026-08-06T15:00:00.000Z",
    milestones: [
      { key: "structure", label: "Plan and structure", state: "done" },
      { key: "content", label: "Pages and content", state: "in_progress" },
      {
        key: "responsive",
        label: "Phone and accessibility",
        state: "pending"
      },
      { key: "quality", label: "Final checks", state: "pending" }
    ]
  };
  let status = { kind: "building", label: "Building" };
  if (activeRequest?.kind === "outside_dependency") {
    status = {
      kind: "waiting_on_dependency",
      label: "Waiting on an outside dependency"
    };
  } else if (activeRequest?.state === "answered") {
    status = {
      kind: "reviewing_response",
      label: "Site Sourcery is reviewing your response"
    };
  } else if (activeRequest) {
    status = {
      kind: "action_needed",
      label: "Action needed from you"
    };
  }
  return {
    schema: "sitesourcery.custom-build-progress/v1",
    state: "active",
    jobId: JOB_ID,
    targetCompletionDate: "2026-09-15",
    targetDateUnderReview:
      activeRequest?.targetDateImpact === "under_review",
    status,
    progress,
    activeRequest
  };
}

function workRequest(overrides = {}) {
  return {
    requestId: "90000000-0000-4000-8000-000000000001",
    revision: 1,
    kind: "customer_decision",
    title: "Choose the approved contact wording",
    message:
      "Please choose which approved contact wording should appear on the site.",
    safeInstructions:
      "Reply with the wording choice and any customer-safe context.",
    targetDateImpact: "none",
    responseRequired: true,
    state: "open",
    response: null,
    access: null,
    createdAt: "2026-08-06T15:05:00.000Z",
    updatedAt: "2026-08-06T15:05:00.000Z",
    ...overrides
  };
}

function changeOrder(state = "issued", owner = false, overrides = {}) {
  const value = {
    changeOrderId: CHANGE_ORDER_ID,
    changeNumber: 1,
    state,
    addedScope:
      "Add the approved events page and its matching navigation link.",
    pricing: {
      unitCount: 2,
      unitAmountMinor: 12500,
      subtotalMinor: 25000,
      currency: "USD",
      taxState: "automatic_tax_pending",
      paymentRequirement: "due_before_changed_work"
    },
    targetCompletionDate: "2026-09-22",
    quoteDigest: "d".repeat(64),
    disclosureDigest: "e".repeat(64),
    issuedAt: "2026-08-06T15:00:00.000Z",
    expiresAt: "2026-08-13T15:00:00.000Z",
    expiredAt: state === "expired"
      ? "2026-08-13T15:05:00.000Z"
      : null,
    acceptedAt: state === "accepted_payment_required"
      || state === "effective"
      ? "2026-08-07T15:00:00.000Z"
      : null,
    declinedAt: state === "declined"
      ? "2026-08-07T15:00:00.000Z"
      : null,
    void: state === "voided"
      ? {
          reason:
            "The customer requested a corrected replacement change order.",
          voidedAt: "2026-08-07T15:00:00.000Z"
        }
      : null,
    ...overrides
  };
  if (owner) {
    value.createdByOperatorUserId = OPERATOR_ID;
  }
  return value;
}

function completionEvidence(id, viewport, owner = false, overrides = {}) {
  const value = {
    evidenceId: id,
    viewport,
    accessibleDescription:
      `${viewport} view of the completed approved homepage and contact action.`,
    mediaType: "image/png",
    byteCount: 2048,
    contentDigest: viewport === "desktop"
      ? "f".repeat(64)
      : "1".repeat(64),
    imageWidth: viewport === "desktop" ? 1440 : 390,
    imageHeight: viewport === "desktop" ? 1000 : 844,
    capturedAt: "2026-08-08T15:00:00.000Z",
    ...overrides
  };
  if (owner) {
    value.progressRevision = 3;
    value.effectiveScopeDigest = "3".repeat(64);
    value.createdByOperatorUserId = OPERATOR_ID;
  }
  return value;
}

const completionChecks = Object.freeze({
  scope: true,
  desktop: true,
  phone: true,
  links: true,
  contactActions: true,
  accessibilityBasics: true
});

function customerCompletion(state = "ready_for_final_payment") {
  return {
    state,
    customerSummary:
      "The approved scope is complete and every documented customer-visible check passed.",
    checks: completionChecks,
    preparedAt: "2026-08-08T16:00:00.000Z",
    evidence: [
      completionEvidence(DESKTOP_EVIDENCE_ID, "desktop"),
      completionEvidence(PHONE_EVIDENCE_ID, "phone")
    ]
  };
}

function customerChangeCompletion(state = "change_order_review") {
  if (state === "not_available") {
    return {
      schema: "sitesourcery.custom-build-change-completion/v1",
      state,
      changeOrders: { active: null, history: [] },
      completion: null
    };
  }
  if (["ready_for_final_payment", "ready_for_delivery"].includes(state)) {
    return {
      schema: "sitesourcery.custom-build-change-completion/v1",
      state,
      changeOrders: {
        active: null,
        history: [changeOrder("effective")]
      },
      completion: customerCompletion(state)
    };
  }
  if (state === "building") {
    return {
      schema: "sitesourcery.custom-build-change-completion/v1",
      state,
      changeOrders: {
        active: null,
        history: [changeOrder("expired")]
      },
      completion: null
    };
  }
  return {
    schema: "sitesourcery.custom-build-change-completion/v1",
    state,
    changeOrders: {
      active: changeOrder(
        state === "change_order_review"
          ? "issued"
          : "accepted_payment_required"
      ),
      history: []
    },
    completion: null
  };
}

function customerChangePaymentSnapshot(invoiceState) {
  if (invoiceState === "paid") {
    return {
      schema: "sitesourcery.custom-build-change-completion/v1",
      state: "building",
      changeOrders: {
        active: null,
        history: [changeOrder("effective")]
      },
      completion: null
    };
  }
  if (invoiceState === "voided") {
    return {
      schema: "sitesourcery.custom-build-change-completion/v1",
      state: "building",
      changeOrders: {
        active: null,
        history: [changeOrder("voided", false, {
          acceptedAt: "2026-08-07T15:00:00.000Z"
        })]
      },
      completion: null
    };
  }
  return customerChangeCompletion("change_order_payment_required");
}

function customerChangeInvoice(state = "checkout_available") {
  if (state === "not_available") {
    return {
      schema: "sitesourcery.custom-build-change-invoice/v1",
      state,
      invoice: null,
      action: { available: false, reason: "invoice_not_available" }
    };
  }
  const paid = state === "paid";
  const ready = state === "checkout_ready";
  return {
    schema: "sitesourcery.custom-build-change-invoice/v1",
    state,
    invoice: {
      invoiceId: CHANGE_INVOICE_ID,
      invoiceNumber: CHANGE_INVOICE_NUMBER,
      invoiceDigest: "7".repeat(64),
      changeOrderId: CHANGE_ORDER_ID,
      changeAcceptanceId: CHANGE_ACCEPTANCE_ID,
      changeNumber: 1,
      acceptedQuoteDigest: "d".repeat(64),
      acceptedDisclosureDigest: "e".repeat(64),
      issuedAt: "2026-08-07T15:01:00.000Z",
      targetCompletionDate: "2026-09-22",
      lines: [{
        lineNumber: 1,
        componentKey: "custom_build_change_units",
        displayName: "Custom build change #1 — added-work units",
        quantity: 2,
        unitAmountMinor: 12500,
        amountMinor: 25000,
        currency: "USD"
      }],
      subtotal: { amountMinor: 25000, currency: "USD" },
      tax: paid
        ? { amountMinor: 1800, state: "settled" }
        : { amountMinor: null, state: "calculated_at_checkout" },
      total: paid
        ? { amountMinor: 26800, currency: "USD", state: "settled" }
        : { amountMinor: null, currency: "USD", state: "shown_at_checkout" },
      payment: {
        chargeOccurred: paid,
        checkoutUrl: ready
          ? "https://checkout.stripe.com/c/pay/change_1"
          : null,
        checkoutExpiresAt: ready
          ? "2099-08-07T16:00:00.000Z"
          : null,
        settledAt: paid ? "2026-08-07T15:30:00.000Z" : null
      }
    },
    action: {
      available: state === "checkout_available",
      reason: state === "checkout_available" ? null : state
    }
  };
}

function customerChangeCheckout(invoiceState) {
  const invoice = invoiceState.invoice;
  return {
    schema: "sitesourcery.custom-build-change-checkout/v1",
    state: "ready",
    checkout: {
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      changeOrderId: invoice.changeOrderId,
      url: "https://checkout.stripe.com/c/pay/change_1",
      expiresAt: "2099-08-07T16:00:00.000Z",
      subtotal: { ...invoice.subtotal },
      tax: { amountMinor: null, state: "calculated_at_checkout" },
      total: { amountMinor: null, currency: "USD", state: "shown_at_checkout" },
      chargeOccurred: false
    }
  };
}

function ownerChangePaymentCompletion(invoiceState) {
  if (invoiceState === "paid") return ownerChangeCompletion();
  const value = ownerChangeCompletion();
  value.state = "change_order_payment_required";
  value.changeOrders = [changeOrder("accepted_payment_required", true)];
  value.evidence = [];
  value.completion = null;
  return value;
}

function ownerChangePayments(
  invoiceState = "reconciliation_required",
  ownerOverrides = {}
) {
  const defaults = invoiceState === "paid"
    ? {
        attemptState: "paid",
        providerEffectCertainty: "confirmed",
        providerErrorCode: null,
        receiptSource: "provider_readback",
        canReconcileCreation: false,
        canReconcileSettlement: false
      }
    : invoiceState === "checkout_ready"
      ? {
          attemptState: "ready",
          providerEffectCertainty: "confirmed",
          providerErrorCode: null,
          receiptSource: null,
          canReconcileCreation: false,
          canReconcileSettlement: true
        }
      : {
          attemptState: "persistence_unknown",
          providerEffectCertainty: "ambiguous",
          providerErrorCode: "checkout_persistence_unknown",
          receiptSource: null,
          canReconcileCreation: true,
          canReconcileSettlement: false
        };
  return {
    schema: "sitesourcery.custom-build-change-payments-owner/v1",
    organizationId: ORGANIZATION_ID,
    jobId: JOB_ID,
    payments: [{
      ...customerChangeInvoice(invoiceState),
      owner: {
        attemptId: CHANGE_ATTEMPT_ID,
        ...defaults,
        providerRequestExpiresAt: "2099-08-07T16:00:00.000Z",
        eventId: null,
        eventState: null,
        reconciliationCode: null,
        ...ownerOverrides
      }
    }]
  };
}

function ownerChangeReconciliation(
  payment,
  status = "checkout_ready"
) {
  const state = {
    checkout_ready: ["creation_reconciled", "customer_checkout"],
    payment_settled: [
      "settlement_reconciled",
      "custom_build_changed_work"
    ],
    checkout_expired: ["attempt_expired", "new_checkout_command"],
    reconciliation_required: ["retry_required", "owner_retry"]
  }[status];
  return {
    schema:
      "sitesourcery.custom-build-change-payment-reconciliation-command/v1",
    status,
    organizationId: ORGANIZATION_ID,
    jobId: JOB_ID,
    attemptId: CHANGE_ATTEMPT_ID,
    invoiceId: CHANGE_INVOICE_ID,
    changeOrderId: CHANGE_ORDER_ID,
    action: state[0],
    next: state[1],
    reason: null,
    checkout: status === "checkout_ready"
      ? customerChangeCheckout(payment)
      : null,
    settlement: status === "payment_settled"
      ? {
          schema: "sitesourcery.custom-build-change-settlement/v1",
          status: "payment_settled",
          projectId: PROJECT_ID,
          changeOrderId: CHANGE_ORDER_ID,
          invoiceId: CHANGE_INVOICE_ID,
          receiptId: CHANGE_RECEIPT_ID,
          next: "custom_build_changed_work"
        }
      : null
  };
}

function ownerEntry() {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    caseId: CASE_ID,
    customer: { customerId: CUSTOMER_ID },
    job: {
      jobId: JOB_ID,
      targetCompletionDate: "2026-09-15"
    }
  };
}

function ownerChangeCompletion(state = "ready_for_final_payment") {
  const evidence = [
    completionEvidence(DESKTOP_EVIDENCE_ID, "desktop", true),
    completionEvidence(PHONE_EVIDENCE_ID, "phone", true)
  ];
  return {
    schema: "sitesourcery.custom-build-change-completion/v1",
    state,
    job: {
      jobId: JOB_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      caseId: CASE_ID,
      customerId: CUSTOMER_ID,
      state: "open",
      targetCompletionDate: "2026-09-15",
      finalDueMinor: 60000,
      currency: "USD",
      openedAt: "2026-08-06T14:00:00.000Z"
    },
    proofBinding: {
      progressRevision: 3,
      effectiveScopeDigest: "3".repeat(64)
    },
    changeOrders: [changeOrder("effective", true)],
    evidence,
    completion: {
      state,
      customerSummary:
        "The approved scope is complete and every documented customer-visible check passed.",
      checks: completionChecks,
      preparedAt: "2026-08-08T16:00:00.000Z",
      completionId: COMPLETION_ID,
      progressRevision: 3,
      evidenceIds: [DESKTOP_EVIDENCE_ID, PHONE_EVIDENCE_ID],
      baseScopeDigest: "2".repeat(64),
      effectiveChangeOrderDigests: ["d".repeat(64)],
      effectiveScopeDigest: "3".repeat(64),
      packageDigest: "4".repeat(64),
      createdByOperatorUserId: OPERATOR_ID
    }
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type"
          ? "application/json"
          : null;
      }
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test("Custom build first-payment invoice accepts every frozen customer state", () => {
  for (const state of [
    "not_available",
    "checkout_available",
    "checkout_ready",
    "payment_held",
    "payment_window_expired",
    "reconciliation_required",
    "paid"
  ]) {
    const candidate = projection(state);
    assert.equal(
      verifiedCustomerCustomBuildInvoice(candidate, expectation),
      candidate,
      state
    );
  }
});

test("Custom build invoice rejects amount, credit, deadline, and provider-ID tampering", () => {
  const valid = projection();
  assert.equal(
    verifiedCustomerCustomBuildInvoice({
      ...valid,
      invoice: {
        ...valid.invoice,
        lines: [
          { ...valid.invoice.lines[0], amountMinor: 65000 },
          valid.invoice.lines[1]
        ],
        subtotal: { amountMinor: 45000, currency: "USD" }
      }
    }, expectation),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildInvoice({
      ...valid,
      invoice: {
        ...valid.invoice,
        credit: { amountMinor: 1, state: "reserved" }
      }
    }, expectation),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildInvoice({
      ...valid,
      invoice: {
        ...valid.invoice,
        paymentDeadline: "2026-08-13T14:00:00.000Z"
      }
    }, expectation),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildInvoice({
      ...projection("checkout_ready"),
      invoice: {
        ...projection("checkout_ready").invoice,
        payment: {
          ...projection("checkout_ready").invoice.payment,
          checkoutSessionId: "cs_test_must_stay_server_side"
        }
      }
    }, expectation),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildInvoice({
      ...projection("paid"),
      job: {
        ...projection("paid").job,
        paymentIntentId: "pi_test_must_stay_server_side"
      }
    }, expectation),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildInvoice({
      ...projection("paid"),
      job: {
        ...projection("paid").job,
        firstPayment: {
          ...projection("paid").job.firstPayment,
          paidSubtotalMinor: 1
        }
      }
    }, expectation),
    null
  );
});

test("Custom build Checkout exposes only the retained Stripe URL and exact invoice facts", () => {
  const invoice = projection().invoice;
  const valid = checkout();
  assert.equal(
    verifiedCustomerCustomBuildCheckout(
      valid,
      invoice,
      ISSUED_AT
    ),
    valid
  );
  assert.equal(
    verifiedCustomerCustomBuildCheckout({
      ...valid,
      checkout: {
        ...valid.checkout,
        checkoutSessionId: "cs_test_must_stay_server_side"
      }
    }, invoice, ISSUED_AT),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildCheckout({
      ...valid,
      checkout: {
        ...valid.checkout,
        subtotal: { amountMinor: 1, currency: "USD" }
      }
    }, invoice, ISSUED_AT),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildCheckout({
      ...valid,
      checkout: {
        ...valid.checkout,
        url: "https://checkout.stripe.com.evil.test/c/pay/fake"
      }
    }, invoice, ISSUED_AT),
    null
  );
});

test("Custom build payment API mirrors assessment routes and sends only the digest", async () => {
  const calls = [];
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(
        200,
        url === "/api/v1/csrf"
          ? { csrfToken: "csrf_custom_build" }
          : { ok: true }
      );
    },
    idempotencyFactory: () => {
      assert.fail("Custom build Checkout must preserve its command ID");
    }
  });

  await client.getCustomServicesCustomBuildInvoice(PROJECT_ID);
  await client.createCustomServicesCustomBuildCheckout(
    PROJECT_ID,
    INVOICE_ID,
    { invoiceDigest: INVOICE_DIGEST },
    { idempotencyKey: "custom-build-checkout-command" }
  );

  assert.equal(
    calls[0].url,
    `/api/v1/projects/${PROJECT_ID}/custom-services/custom-build-invoice`
  );
  assert.equal(calls[1].url, "/api/v1/csrf");
  assert.equal(
    calls[2].url,
    `/api/v1/projects/${PROJECT_ID}/custom-services/custom-build-invoices/${INVOICE_ID}/checkout-command`
  );
  assert.equal(calls[2].options.method, "POST");
  assert.equal(
    calls[2].options.headers["Idempotency-Key"],
    "custom-build-checkout-command"
  );
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    invoiceDigest: INVOICE_DIGEST
  });

  for (const claimed of [
    { commandId: "browser-command" },
    { amountMinor: 40000 },
    { taxMinor: 1 },
    { creditMinor: 20000 },
    { tierId: "site" },
    { jobState: "open" }
  ]) {
    assert.throws(
      () => client.createCustomServicesCustomBuildCheckout(
        PROJECT_ID,
        INVOICE_ID,
        { invoiceDigest: INVOICE_DIGEST, ...claimed },
        { idempotencyKey: "custom-build-checkout-command" }
      ),
      /unsupported fields/iu
    );
  }
});

test("Custom build customer panel keeps all payment states plain and phone-friendly", async () => {
  const [source, css] = await Promise.all([
    readFile(
      new URL(
        "../../abracadabra/app/abracadabra-customer-control-dom.js",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(
      new URL(
        "../../abracadabra/app/abracadabra-app.css",
        import.meta.url
      ),
      "utf8"
    )
  ]);
  for (const copy of [
    "Gross first installment",
    "Assessment credit",
    "Net subtotal",
    "Calculated securely at Checkout",
    "Payment deadline",
    "Final handoff amount",
    "Continue to secure payment",
    "Open retained secure payment page",
    "Secure payment is not open yet",
    "The seven-day payment window ended",
    "Please do not try another payment",
    "Your Custom website project is open",
    "First payment verified; the $200 assessment credit was applied",
    "USD before Checkout tax",
    "First payment subtotal",
    "Scope",
    "Bound footprint"
  ]) assert.ok(source.includes(copy), copy);
  assert.match(
    source,
    /selected\.state === "checkout_available"[\s\S]*?"Continue to secure payment"/u
  );
  assert.ok(source.includes("data-custom-build-invoice"));
  assert.match(
    css,
    /\.customer-owner-custom-build-card>dl,\.customer-custom-build-owner-review>dl\{grid-template-columns:1fr\}/u
  );
  assert.match(
    css,
    /\.customer-owner-assessment-job-summary\{[^}]*min-height:44px/u
  );
});

test("Custom-build progress verifies calm stages, milestones, and each bounded request state", () => {
  const active = progressProjection();
  assert.equal(verifiedCustomBuildProgress(active), active);

  const actionNeeded = progressProjection(workRequest());
  assert.equal(
    verifiedCustomBuildProgress(actionNeeded),
    actionNeeded
  );

  const answeredRequest = workRequest({
    revision: 2,
    state: "answered",
    response: {
      kind: "provided",
      note: "Use the shorter approved contact wording.",
      answeredAt: "2026-08-06T15:10:00.000Z"
    },
    updatedAt: "2026-08-06T15:10:00.000Z"
  });
  const reviewing = progressProjection(answeredRequest);
  assert.equal(verifiedCustomBuildProgress(reviewing), reviewing);

  const waitingRequest = workRequest({
    kind: "outside_dependency",
    title: "Waiting for the provider maintenance window",
    message:
      "The provider maintenance window must end before final checks continue.",
    safeInstructions:
      "No customer response is needed while Site Sourcery monitors the provider.",
    targetDateImpact: "under_review",
    responseRequired: false
  });
  const waiting = progressProjection(waitingRequest);
  assert.equal(verifiedCustomBuildProgress(waiting), waiting);

  const delegatedRequest = workRequest({
    kind: "delegated_access",
    title: "Share a delegated editor role",
    message:
      "Please use the provider sharing screen to add the requested editor role.",
    safeInstructions:
      "Use delegated sharing only and reply after the invitation is sent.",
    targetDateImpact: "under_review",
    access: {
      providerLabel: "Example CMS",
      accountLabel: "Marketing website",
      delegatedRole: "Site editor",
      expiresAt: "2026-08-20T17:00:00.000Z"
    }
  });
  const delegated = progressProjection(delegatedRequest);
  assert.equal(verifiedCustomBuildProgress(delegated), delegated);

  const notAvailable = {
    schema: "sitesourcery.custom-build-progress/v1",
    state: "not_available",
    jobId: null,
    targetCompletionDate: null,
    targetDateUnderReview: false,
    status: null,
    progress: null,
    activeRequest: null
  };
  assert.equal(verifiedCustomBuildProgress(notAvailable), notAvailable);
});

test("Custom-build progress rejects status, milestone, credential, and access-verification claims", () => {
  const valid = progressProjection(workRequest());
  assert.equal(
    verifiedCustomBuildProgress({
      ...valid,
      status: { kind: "checking", label: "Checking the work" }
    }),
    null
  );
  assert.equal(
    verifiedCustomBuildProgress({
      ...valid,
      progress: {
        ...valid.progress,
        milestones: valid.progress.milestones.map((milestone, index) =>
          index === 0 ? { ...milestone, completion: 100 } : milestone
        )
      }
    }),
    null
  );
  assert.equal(
    verifiedCustomBuildProgress({
      ...valid,
      progress: {
        ...valid.progress,
        summary: "The API key is available in this unsafe update."
      }
    }),
    null
  );
  const delegated = progressProjection(workRequest({
    kind: "delegated_access",
    title: "Share a delegated editor role",
    message:
      "Please use the provider sharing screen to add the requested editor role.",
    safeInstructions:
      "Use delegated sharing only and reply after the invitation is sent.",
    access: {
      providerLabel: "Example CMS",
      accountLabel: "Marketing website",
      delegatedRole: "Site editor",
      expiresAt: "2026-08-20T17:00:00.000Z",
      verified: true
    }
  }));
  assert.equal(verifiedCustomBuildProgress(delegated), null);
  assert.equal(
    verifiedCustomBuildProgress({
      ...valid,
      targetDateUnderReview: true
    }),
    null
  );
});

test("Custom-build progress surfaces remain bounded, credential-safe, and responsive", async () => {
  const [source, css] = await Promise.all([
    readFile(
      new URL(
        "../../abracadabra/app/abracadabra-customer-control-dom.js",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(
      new URL(
        "../../abracadabra/app/abracadabra-app.css",
        import.meta.url
      ),
      "utf8"
    )
  ]);
  for (const copy of [
    "Preparing",
    "Building",
    "Checking the work",
    "Action needed from you",
    "Site Sourcery is reviewing your response",
    "Waiting on an outside dependency",
    "Safe response note — no credentials",
    "A response does not by itself confirm that provider access works.",
    "A customer response does not verify provider access.",
    "Post a progress update",
    "Open one customer request",
    "Resolved after review",
    "Withdrawn"
  ]) assert.ok(source.includes(copy), copy);
  for (const control of [
    "data-customer-custom-build-progress",
    "data-custom-build-response-form",
    "data-owner-progress-form",
    "data-owner-request-form",
    "data-owner-resolution-form"
  ]) assert.ok(source.includes(control), control);
  const progressUi = source.slice(
    source.indexOf("function customBuildMilestoneStateLabel"),
    source.indexOf("function customBuildLocalDateTime")
  );
  assert.doesNotMatch(progressUi, /percentage/iu);
  assert.doesNotMatch(
    progressUi,
    /assessmentField\([\s\S]{0,120}"(?:password|passcode|token|apiKey|verificationCode)"/iu
  );
  assert.match(
    source,
    /customBuildCommandId\([\s\S]*?"respond"[\s\S]*?request\.requestId/u
  );
  assert.match(
    source,
    /customBuildCommandId\([\s\S]*?operation[\s\S]*?subjectId/u
  );
  assert.match(
    css,
    /\.customer-custom-build-progress-response input,[^{]+\{min-height:44px\}/u
  );
  assert.match(
    css,
    /@media\(max-width:44rem\)[\s\S]*?\.customer-custom-build-progress-facts,[^{]+\{grid-template-columns:1fr\}/u
  );
});

test("Custom-build change and completion customer projections keep exact commercial truth", () => {
  for (const state of [
    "not_available",
    "building",
    "change_order_review",
    "change_order_payment_required",
    "ready_for_final_payment",
    "ready_for_delivery"
  ]) {
    const value = customerChangeCompletion(state);
    assert.equal(
      verifiedCustomerCustomBuildChangeCompletion(value),
      value,
      state
    );
  }

  const issued = customerChangeCompletion();
  assert.equal(
    verifiedCustomerCustomBuildChangeCompletion({
      ...issued,
      changeOrders: {
        ...issued.changeOrders,
        active: {
          ...issued.changeOrders.active,
          pricing: {
            ...issued.changeOrders.active.pricing,
            unitAmountMinor: 10000
          }
        }
      }
    }),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildChangeCompletion({
      ...issued,
      jobId: JOB_ID
    }),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildChangeCompletion({
      ...issued,
      changeOrders: {
        ...issued.changeOrders,
        active: {
          ...issued.changeOrders.active,
          addedScope: "Use the API key from the private account."
        }
      }
    }),
    null
  );
});

test("accepted-change invoice and Checkout projections bind exact units, order, tax, and provider destination", () => {
  for (const state of [
    "not_available",
    "checkout_available",
    "checkout_ready",
    "checkout_expired",
    "payment_held",
    "reconciliation_required",
    "paid",
    "voided"
  ]) {
    const invoice = customerChangeInvoice(state);
    assert.equal(
      verifiedCustomerCustomBuildChangeInvoice(
        invoice,
        customerChangePaymentSnapshot(state)
      ),
      invoice,
      state
    );
  }

  const available = customerChangeInvoice();
  const snapshot = customerChangePaymentSnapshot("checkout_available");
  const checkout = customerChangeCheckout(available);
  assert.equal(
    verifiedCustomerCustomBuildChangeCheckout(
      checkout,
      available,
      "2026-08-07T15:10:00.000Z"
    ),
    checkout
  );
  assert.equal(
    verifiedCustomerCustomBuildChangeCheckout(
      checkout,
      available,
      checkout.checkout.expiresAt
    ),
    null,
    "a Checkout projection is invalid at its exact expiration instant"
  );
  assert.equal(
    verifiedCustomerCustomBuildChangeCheckout(
      checkout,
      available,
      "2100-01-01T00:00:00.000Z"
    ),
    null,
    "a Checkout projection remains invalid after expiration"
  );
  assert.equal(
    verifiedCustomerCustomBuildChangeInvoice({
      ...available,
      invoice: {
        ...available.invoice,
        lines: [{ ...available.invoice.lines[0], quantity: 3 }]
      }
    }, snapshot),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildChangeInvoice({
      ...available,
      action: { available: false, reason: "checkout_available" }
    }, snapshot),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildChangeInvoice({
      ...available,
      invoice: {
        ...available.invoice,
        acceptedQuoteDigest: "0".repeat(64)
      }
    }, snapshot),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildChangeCheckout({
      ...checkout,
      checkout: {
        ...checkout.checkout,
        url: "https://example.test/pay/change_1"
      }
    }, available, "2026-08-07T15:10:00.000Z"),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildChangeCheckout({
      ...checkout,
      checkout: {
        ...checkout.checkout,
        subtotal: { amountMinor: 1, currency: "USD" }
      }
    }, available, "2026-08-07T15:10:00.000Z"),
    null
  );
});

test("owner accepted-change payments expose only exact reconciliation authority", () => {
  const uncertain = ownerChangePayments();
  const accepted = ownerChangePaymentCompletion(
    "reconciliation_required"
  );
  assert.equal(
    verifiedOwnerCustomBuildChangePayments(
      uncertain,
      ownerEntry(),
      accepted
    ),
    uncertain
  );

  const ready = ownerChangePayments("checkout_ready");
  assert.equal(
    verifiedOwnerCustomBuildChangePayments(
      ready,
      ownerEntry(),
      ownerChangePaymentCompletion("checkout_ready")
    ),
    ready
  );

  const paid = ownerChangePayments("paid");
  assert.equal(
    verifiedOwnerCustomBuildChangePayments(
      paid,
      ownerEntry(),
      ownerChangePaymentCompletion("paid")
    ),
    paid
  );

  assert.equal(
    verifiedOwnerCustomBuildChangePayments({
      ...uncertain,
      payments: [{
        ...uncertain.payments[0],
        owner: {
          ...uncertain.payments[0].owner,
          canReconcileCreation: false
        }
      }]
    }, ownerEntry(), accepted),
    null
  );
  assert.equal(
    verifiedOwnerCustomBuildChangePayments({
      ...uncertain,
      payments: [{
        ...uncertain.payments[0],
        owner: {
          ...uncertain.payments[0].owner,
          providerRequestExpiresAt: null
        }
      }]
    }, ownerEntry(), accepted),
    null
  );
});

test("owner reconciliation result binds command outcome to one attempt and invoice", () => {
  const now = "2026-08-07T15:10:00.000Z";
  const payments = ownerChangePayments();
  const payment = payments.payments[0];
  const checkoutReady = ownerChangeReconciliation(payment);
  assert.equal(
    verifiedOwnerCustomBuildChangePaymentReconciliation(
      checkoutReady,
      ownerEntry(),
      payment,
      now
    ),
    checkoutReady
  );

  const settledPayment = ownerChangePayments("paid").payments[0];
  const settled = ownerChangeReconciliation(
    settledPayment,
    "payment_settled"
  );
  assert.equal(
    verifiedOwnerCustomBuildChangePaymentReconciliation(
      settled,
      ownerEntry(),
      settledPayment,
      now
    ),
    settled
  );
  assert.equal(
    verifiedOwnerCustomBuildChangePaymentReconciliation(
      { ...checkoutReady, jobId: PROJECT_ID },
      ownerEntry(),
      payment,
      now
    ),
    null
  );
  assert.equal(
    verifiedOwnerCustomBuildChangePaymentReconciliation(
      { ...checkoutReady, settlement: settled.settlement },
      ownerEntry(),
      payment,
      now
    ),
    null
  );
});

test("expired change orders and required verified image dimensions stay display-safe", () => {
  const expired = customerChangeCompletion("building");
  assert.equal(
    expired.changeOrders.history[0].state,
    "expired"
  );
  assert.equal(
    verifiedCustomerCustomBuildChangeCompletion(expired),
    expired
  );

  const ready = customerChangeCompletion("ready_for_final_payment");
  const withoutDimensions = {
    ...ready,
    completion: {
      ...ready.completion,
      evidence: ready.completion.evidence.map((entry) => {
        const { imageHeight, imageWidth, ...rest } = entry;
        assert.ok(imageHeight && imageWidth);
        return rest;
      })
    }
  };
  assert.equal(
    verifiedCustomerCustomBuildChangeCompletion(withoutDimensions),
    null
  );
  const malformed = structuredClone(ready);
  malformed.completion.evidence[0].imageWidth = 0;
  assert.equal(
    verifiedCustomerCustomBuildChangeCompletion(malformed),
    null
  );
});

test("owner change/completion projection is bound to the exact paid job and organization", () => {
  const value = ownerChangeCompletion();
  assert.equal(
    verifiedOwnerCustomBuildChangeCompletion(value, ownerEntry()),
    value
  );
  assert.equal(
    verifiedOwnerCustomBuildChangeCompletion(
      value,
      {
        ...ownerEntry(),
        organizationId: "20000000-0000-4000-8000-000000000099"
      }
    ),
    null
  );
  assert.equal(
    verifiedOwnerCustomBuildChangeCompletion({
      ...value,
      completion: {
        ...value.completion,
        evidenceIds: [PHONE_EVIDENCE_ID, DESKTOP_EVIDENCE_ID]
      }
    }, ownerEntry()),
    null
  );
  assert.equal(
    verifiedOwnerCustomBuildChangeCompletion({
      ...value,
      evidence: value.evidence.map((entry, index) => index === 0
        ? { ...entry, providerReference: "must-not-leak" }
        : entry)
    }, ownerEntry()),
    null
  );
});

test("owner completion selection excludes stale progress and scope evidence", () => {
  const value = ownerChangeCompletion();
  value.state = "building";
  value.changeOrders = [];
  value.completion = null;
  const staleDesktop = {
    ...completionEvidence(
      "82000000-0000-4000-8000-000000000003",
      "desktop",
      true,
      { contentDigest: "5".repeat(64) }
    ),
    progressRevision: 2,
    effectiveScopeDigest: "2".repeat(64)
  };
  const stalePhone = {
    ...completionEvidence(
      "82000000-0000-4000-8000-000000000004",
      "phone",
      true,
      { contentDigest: "6".repeat(64) }
    ),
    progressRevision: 2,
    effectiveScopeDigest: "2".repeat(64)
  };
  value.evidence = [staleDesktop, stalePhone, ...value.evidence];
  assert.equal(
    verifiedOwnerCustomBuildChangeCompletion(value, ownerEntry()),
    value
  );
  const progress = progressProjection();
  progress.status = { kind: "checking", label: "Checking the work" };
  progress.progress = {
    ...progress.progress,
    revision: 3,
    stage: "checking",
    stageLabel: "Checking the work",
    milestones: progress.progress.milestones.map((milestone) => ({
      ...milestone,
      state: "done"
    }))
  };
  assert.deepEqual(
    currentOwnerCustomBuildCompletionEvidence(
      value,
      { snapshot: progress }
    ).map((entry) => entry.evidenceId),
    [DESKTOP_EVIDENCE_ID, PHONE_EVIDENCE_ID]
  );
  assert.deepEqual(
    currentOwnerCustomBuildCompletionEvidence(
      value,
      {
        snapshot: {
          ...progress,
          progress: { ...progress.progress, revision: 2 }
        }
      }
    ),
    []
  );
});

test("completion evidence FileReader preparation is bounded and base64-only", async () => {
  class TestFileReader {
    readAsDataURL(file) {
      this.result = `data:${file.type};base64,iVBORw0KGgo=`;
      this.onload();
    }
  }
  const prepared = await prepareCustomBuildCompletionEvidenceFile(
    { type: "image/png", size: 8 },
    { FileReader: TestFileReader }
  );
  assert.deepEqual(prepared, {
    dataBase64: "iVBORw0KGgo=",
    mediaType: "image/png"
  });
  await assert.rejects(
    prepareCustomBuildCompletionEvidenceFile(
      { type: "image/svg+xml", size: 8 },
      { FileReader: TestFileReader }
    ),
    /JPEG, PNG, or WebP/u
  );
  await assert.rejects(
    prepareCustomBuildCompletionEvidenceFile(
      { type: "image/png", size: 700 * 1024 + 1 },
      { FileReader: TestFileReader }
    ),
    /700 KiB/u
  );
});

test("completion evidence URL is exact, authenticated, and same-origin", () => {
  assert.equal(
    customerCustomBuildCompletionEvidenceUrl(
      PROJECT_ID,
      DESKTOP_EVIDENCE_ID
    ),
    `/api/v1/projects/${PROJECT_ID}/custom-services/`
      + `custom-build-completion-evidence/${DESKTOP_EVIDENCE_ID}`
  );
  assert.equal(
    customerCustomBuildCompletionEvidenceUrl(
      PROJECT_ID,
      "../outside"
    ),
    null
  );
});

test("change-order and completion UI is bounded, responsive, held-safe, and authority-free", async () => {
  const [source, css] = await Promise.all([
    readFile(
      new URL(
        "../../abracadabra/app/abracadabra-customer-control-dom.js",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(
      new URL(
        "../../abracadabra/app/abracadabra-app.css",
        import.meta.url
      ),
      "utf8"
    )
  ]);
  for (const copy of [
    "Your original approved scope remains in place.",
    "Due before changed work begins",
    "Calculated before payment",
    "Completion proof is prepared",
    "Added-work payments",
    "Reconcile uncertain payment page",
    "Provider-confirmed payment is retained",
    "It is not payment, delivery, launch",
    "Record this change as expired",
    "Nothing changed and no action is available.",
    "pixels"
  ]) assert.ok(source.includes(copy), copy);
  for (const method of [
    "getCustomServicesCustomBuildChangeCompletion",
    "getCustomServicesCustomBuildCompletionEvidence",
    "acceptCustomServicesCustomBuildChangeOrder",
    "declineCustomServicesCustomBuildChangeOrder",
    "getOwnerCustomBuildChangeCompletion",
    "getOwnerCustomBuildChangePayments",
    "reconcileOwnerCustomBuildChangeCheckout",
    "issueOwnerCustomBuildChangeOrder",
    "voidOwnerCustomBuildChangeOrder",
    "expireOwnerCustomBuildChangeOrder",
    "uploadOwnerCustomBuildCompletionEvidence",
    "recordOwnerCustomBuildCompletion"
  ]) assert.ok(source.includes(method), method);
  for (const control of [
    "data-customer-custom-build-change-completion",
    "data-customer-change-order",
    "data-customer-expired-change-order",
    "data-owner-job-change-completion",
    "data-owner-custom-build-change-payments",
    "data-owner-custom-build-change-payment-reconcile",
    "data-owner-change-order-form",
    "data-owner-change-order-expire",
    "data-owner-completion-evidence-form",
    "data-owner-completion-form"
  ]) assert.ok(source.includes(control), control);

  const customerUi = source.slice(
    source.indexOf("function createCustomerCustomBuildChangeCompletionPanel"),
    source.indexOf("function customBuildLocalDateTime")
  );
  assert.doesNotMatch(
    customerUi,
    /(?:Job|Operator|Document|Provider) ID/u
  );
  assert.doesNotMatch(
    customerUi,
    /assessmentField\([\s\S]{0,120}"(?:amount|price|tax|refund|credit|password|token|secret)"/iu
  );
  assert.match(
    source,
    /body = \{\s*addedScope: source\.addedScope,\s*expiresAt: source\.expiresAt,\s*organizationId: entry\.organizationId,\s*targetCompletionDate: source\.targetCompletionDate,\s*unitCount: source\.unitCount\s*\}/u
  );
  assert.match(
    source,
    /operation === "expire-change"[\s\S]*?Date\.parse\(order\.expiresAt\) > Date\.now\(\)/u
  );
  assert.match(
    css,
    /\.customer-custom-build-change-issue-form input,[^{]+\{min-height:44px\}/u
  );
  assert.match(
    css,
    /\.customer-custom-build-evidence-link\{[^}]*min-height:44px/u
  );
  assert.match(
    css,
    /@media\(max-width:44rem\)[\s\S]*?\.customer-custom-build-change-facts,[^{]+\{grid-template-columns:1fr\}/u
  );
});
