import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOM_BUILD_FINAL_PAYMENT_METADATA_SCHEMA,
  createPostgresCustomServicesCustomBuildFinalPayment,
  isPotentialCustomBuildFinalPaymentStripeEvent
} from "../custom-services-custom-build-final-payment-postgres.mjs";
import { digest } from "../security.mjs";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "30000000-0000-4000-8000-000000000001";
const JOB_ID = "40000000-0000-4000-8000-000000000001";
const CASE_ID = "50000000-0000-4000-8000-000000000001";
const QUOTE_ID = "60000000-0000-4000-8000-000000000001";
const QUOTE_REVISION_ID = "61000000-0000-4000-8000-000000000001";
const QUOTE_ACCEPTANCE_ID = "62000000-0000-4000-8000-000000000001";
const QUOTE_INSTALLMENT_ID = "63000000-0000-4000-8000-000000000001";
const COMPLETION_PACKAGE_ID = "64000000-0000-4000-8000-000000000001";
const OBLIGATION_ID = "65000000-0000-4000-8000-000000000001";
const INVOICE_ID = "70000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "80000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "90000000-0000-4000-8000-000000000001";
const CUSTOMER_COMMAND_ROW_ID = "a0000000-0000-4000-8000-000000000001";
const OWNER_COMMAND_ROW_ID = "b0000000-0000-4000-8000-000000000001";
const OPERATOR_ID = "c0000000-0000-4000-8000-000000000001";
const CHECKOUT_ID = "cs_custom_build_final_payment_1";
const CHECKOUT_URL =
  "https://checkout.stripe.com/c/pay/cs_custom_build_final_payment_1";
const STRIPE_CUSTOMER_ID = "cus_custom_build_final_1";
const PAYMENT_INTENT_ID = "pi_custom_build_final_1";
const CHARGE_ID = "ch_custom_build_final_1";
const FINAL_DUE_MINOR = 32500;
const CLOCK_NOW = "2026-08-06T18:30:00.000Z";

const RELEASE = Object.freeze({
  approved: true,
  currency: "USD",
  holdScope: "new_checkout_creation_only",
  providerEffectProcessing: "settlement_and_reconciliation_continue",
  taxMode: "automatic"
});

function customerScope() {
  return {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID
  };
}

function finalRow(overrides = {}) {
  return {
    obligation_id: OBLIGATION_ID,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    case_id: CASE_ID,
    customer_user_id: CUSTOMER_ID,
    job_id: JOB_ID,
    quote_id: QUOTE_ID,
    quote_revision: 4,
    quote_revision_id: QUOTE_REVISION_ID,
    quote_acceptance_id: QUOTE_ACCEPTANCE_ID,
    quote_installment_id: QUOTE_INSTALLMENT_ID,
    installment_number: 2,
    completion_package_id: COMPLETION_PACKAGE_ID,
    completion_package_digest: "1".repeat(64),
    completion_prepared_at: "2026-08-06T17:55:00.000Z",
    base_scope_digest: "2".repeat(64),
    effective_change_order_digests: ["3".repeat(64), "4".repeat(64)],
    effective_scope_digest: "5".repeat(64),
    accepted_quote_digest: "6".repeat(64),
    accepted_disclosure_digest: "7".repeat(64),
    commercial_contract_digest: "8".repeat(64),
    final_due_minor: String(FINAL_DUE_MINOR),
    credit_minor: "0",
    currency: "USD",
    workmanship_correction_days: 30,
    bound_at: "2026-08-06T18:00:00.000Z",
    obligation_digest: "9".repeat(64),
    invoice_id: INVOICE_ID,
    invoice_number: "SSCB-FINAL-70000000000040008000000000000001",
    invoice_subtotal_minor: String(FINAL_DUE_MINOR),
    invoice_credit_minor: "0",
    invoice_digest: "a".repeat(64),
    issued_at: "2026-08-06T18:00:00.000Z",
    zero_balance_clearance_id: null,
    zero_balance_clearance_digest: null,
    zero_balance_cleared_at: null,
    checkout_attempt_id: null,
    checkout_state: null,
    provider_effect_certainty: null,
    provider_error_code: null,
    provider_request_expires_at: null,
    checkout_session_id: null,
    checkout_url: null,
    checkout_expires_at: null,
    event_id: null,
    event_state: null,
    reconciliation_code: null,
    receipt_id: null,
    receipt_source: null,
    tax_minor: null,
    total_minor: null,
    settled_at: null,
    receipt_linkage_valid: false,
    lines: [{
      lineNumber: 1,
      componentKey: "custom_build_final_installment",
      displayName: "Custom website build final installment",
      quantity: 1,
      unitAmountMinor: FINAL_DUE_MINOR,
      creditMinor: 0,
      amountMinor: FINAL_DUE_MINOR
    }],
    ...overrides
  };
}

function inertProvider() {
  return {
    async createCustomBuildFinalCheckout() {},
    async retrieveCustomBuildFinalPayment() {},
    async retrieveCustomBuildFinalCheckoutLifecycle() {}
  };
}

function projectionBoundary(row) {
  const queries = [];
  const payment = createPostgresCustomServicesCustomBuildFinalPayment({
    authority: {
      async service(context, work) {
        assert.deepEqual(context, {
          actorKind: "customer",
          userId: CUSTOMER_ID,
          organizationId: ORGANIZATION_ID,
          readOnly: true
        });
        return work({
          async query(text, values) {
            queries.push({ text, values });
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
          }
        });
      }
    },
    provider: inertProvider(),
    release: RELEASE,
    clock: { now: () => CLOCK_NOW }
  });
  return { payment, queries };
}

function createHarness({
  createMode = "success",
  paymentMode = "success",
  lifecycleState = "expired",
  invoiceAvailable = true,
  stripeCustomerId = STRIPE_CUSTOMER_ID,
  concurrentSettlementOnReadback = false
} = {}) {
  const state = {
    now: CLOCK_NOW,
    createMode,
    paymentMode,
    lifecycleState,
    invoiceAvailable,
    concurrentSettlementOnReadback,
    invoice: finalRow(),
    attempt: null,
    customerCommand: null,
    ownerCommand: null,
    event: null,
    receipt: null,
    stripeCustomerId,
    labels: [],
    transactions: [],
    providerCalls: { create: 0, lifecycle: 0, payment: 0 },
    providerCreateInputs: [],
    providerPaymentInputs: [],
    providerLifecycleInputs: [],
    sealedEventIds: [],
    lastPurpose: null,
    lastPurposeDigest: null
  };

  function rows(selected) {
    const selectedRows = selected == null
      ? []
      : Array.isArray(selected)
        ? selected
        : [selected];
    const snapshots = structuredClone(selectedRows);
    return { rows: snapshots, rowCount: snapshots.length };
  }

  function attemptRow() {
    const attempt = state.attempt;
    assert.ok(attempt, "the proof harness requires one retained attempt");
    return {
      ...state.invoice,
      id: attempt.id,
      attempt_id: attempt.id,
      checkout_attempt_id: attempt.id,
      invoice_id: INVOICE_ID,
      command_id: attempt.command_id,
      customer_command_id: attempt.command_id,
      state: attempt.state,
      attempt_state: attempt.state,
      provider_effect_certainty: attempt.provider_effect_certainty,
      provider_error_code: attempt.provider_error_code,
      provider_request_expires_at: attempt.provider_request_expires_at,
      purpose_digest: attempt.purpose_digest,
      expected_subtotal_minor: String(FINAL_DUE_MINOR),
      checkout_session_id: attempt.checkout_session_id,
      checkout_url: attempt.checkout_url,
      expires_at: attempt.expires_at,
      checkout_expires_at: attempt.expires_at,
      stripe_customer_id: state.stripeCustomerId,
      receipt_id: state.receipt?.id ?? null,
      receipt_source: state.receipt?.receipt_source ?? null,
      receipt_checkout_session_id:
        state.receipt?.checkout_session_id ?? null,
      receipt_payment_intent_id:
        state.receipt?.payment_intent_id ?? null,
      receipt_charge_id: state.receipt?.charge_id ?? null,
      receipt_customer_id: state.receipt?.stripe_customer_id ?? null,
      receipt_subtotal_minor: state.receipt?.subtotal_minor ?? null,
      receipt_tax_minor: state.receipt?.tax_minor ?? null,
      receipt_total_minor: state.receipt?.total_minor ?? null,
      receipt_facts_digest: state.receipt?.provider_facts_digest ?? null,
      event_id: state.event?.id ?? null,
      event_state: state.event?.state ?? null,
      event_verified_at: state.event?.signature_verified_at ?? null,
      reconciliation_code: state.event?.reconciliation_code ?? null,
      reconciliation_event_id: state.event?.id ?? null,
      reconciliation_event_state: state.event?.state ?? null
    };
  }

  function paymentFacts() {
    const facts = {
      schema: "sitesourcery.stripe-custom-build-final-payment-facts/v1",
      provider: "stripe",
      checkoutSessionId: CHECKOUT_ID,
      paymentIntentId: PAYMENT_INTENT_ID,
      chargeId: CHARGE_ID,
      customerId: STRIPE_CUSTOMER_ID,
      paymentStatus: "paid",
      chargeCaptured: true,
      amountRefundedMinor: 0,
      disputed: false,
      subtotalMinor: FINAL_DUE_MINOR,
      taxMinor: 2145,
      totalMinor: FINAL_DUE_MINOR + 2145,
      taxMode: "automatic",
      currency: "USD",
      purposeDigest: state.attempt.purpose_digest,
      providerPaymentTime: "2026-08-06T18:20:00.000Z"
    };
    return { ...facts, providerFactsDigest: digest(facts) };
  }

  async function query(transaction, sourceText, values = []) {
    const sql = sourceText.replace(/\s+/gu, " ").trim();
    const lower = sql.toLowerCase();
    transaction.queries.push({ sql, values });

    if (lower.includes("/* final:") && lower.includes(":discover */")) {
      if (lower.includes("final:stage:discover")) {
        const exactInvoice = values[0] === ORGANIZATION_ID &&
          values[1] === PROJECT_ID &&
          values[2] === CUSTOMER_ID &&
          values[3] === INVOICE_ID;
        return rows(state.invoiceAvailable && exactInvoice
          ? { job_id: JOB_ID }
          : null);
      }
      return rows({ job_id: JOB_ID });
    }
    if (lower.includes("pg_advisory_xact_lock")) {
      return rows({ locked: null });
    }
    if (lower.includes("service_operator_has_capability")) {
      return rows({ allowed: true });
    }
    if (lower.includes("custom_build_final_reconciliation_request_digest")) {
      return rows({
        request_digest: digest({
          operatorId: values[0],
          organizationId: values[1],
          jobId: values[2],
          attemptId: values[3],
          commandId: values[4]
        })
      });
    }

    if (
      lower.startsWith(
        "select * from ss.service_custom_build_final_reconciliation_commands"
      ) && lower.includes("where command_id = $1")
    ) {
      return rows(
        state.ownerCommand?.command_id === values[0]
          ? state.ownerCommand
          : null
      );
    }
    if (
      lower.startsWith(
        "select * from ss.service_custom_build_final_reconciliation_commands"
      ) && lower.includes("where organization_id = $1 and id = $2")
    ) {
      return rows(
        state.ownerCommand?.id === values[1] ? state.ownerCommand : null
      );
    }
    if (
      lower.startsWith(
        "insert into ss.service_custom_build_final_reconciliation_commands"
      )
    ) {
      state.ownerCommand = {
        id: values[0],
        organization_id: values[1],
        job_id: values[2],
        checkout_attempt_id: values[3],
        operator_user_id: values[4],
        command_id: values[5],
        request_digest: values[6],
        state: "running",
        result: null
      };
      return rows({ inserted: true });
    }
    if (
      lower.startsWith(
        "update ss.service_custom_build_final_reconciliation_commands"
      )
    ) {
      assert.equal(state.ownerCommand?.id, values[1]);
      state.ownerCommand.state = "completed";
      state.ownerCommand.result = JSON.parse(values[2]);
      return rows({ updated: true });
    }

    if (lower.startsWith("select * from ss.idempotency_keys")) {
      const retainedKey = lower.includes("principal_id = $1")
        ? values[2]
        : values[4];
      return rows(
        state.customerCommand?.idempotency_key === retainedKey
          ? state.customerCommand
          : null
      );
    }
    if (lower.startsWith("insert into ss.idempotency_keys")) {
      const completed = lower.includes("'completed'");
      state.customerCommand = {
        id: values[0],
        organization_id: values[1],
        principal_id: values[2],
        route_key: values[3],
        idempotency_key: values[4],
        request_digest: values[5],
        state: completed ? "completed" : "running",
        response_body: completed ? JSON.parse(values[6]) : null
      };
      return rows({ inserted: true });
    }
    if (lower.startsWith("update ss.idempotency_keys")) {
      assert.ok(state.customerCommand);
      if (lower.includes("where id = $1")) {
        if (lower.includes("state = 'completed'")) {
          state.customerCommand.state = "completed";
          state.customerCommand.response_body = JSON.parse(values[1]);
        } else {
          state.customerCommand.state = values[1];
          state.customerCommand.response_body = JSON.parse(values[2]);
        }
      } else {
        state.customerCommand.state = "completed";
        state.customerCommand.response_body = JSON.parse(values[3]);
      }
      return rows({ updated: true });
    }

    if (
      lower.includes("from ss.service_custom_build_final_obligations obligation") &&
      lower.includes("line.line_number") &&
      lower.includes("customer.stripe_customer_id") &&
      !lower.includes("attempt.id as attempt_id")
    ) {
      const [line] = state.invoice.lines;
      return rows({
        ...state.invoice,
        stripe_customer_id: state.stripeCustomerId,
        receipt_id: state.receipt?.id ?? null,
        line_number: line.lineNumber,
        component_key: line.componentKey,
        quantity: line.quantity,
        unit_amount_minor: line.unitAmountMinor,
        line_credit_minor: line.creditMinor,
        amount_minor: line.amountMinor
      });
    }
    if (
      lower.startsWith("select attempt.*, invoice.invoice_number") &&
      lower.includes("attempt.state in (")
    ) {
      return rows(
        state.attempt && !["expired", "failed"].includes(state.attempt.state)
          ? attemptRow()
          : null
      );
    }
    if (
      lower.startsWith(
        "insert into ss.service_custom_build_final_checkout_attempts"
      )
    ) {
      state.attempt = {
        id: values[0],
        command_id: values[8],
        purpose_digest: values[9],
        obligation_digest: values[10],
        completion_package_digest: values[11],
        invoice_digest: values[12],
        accepted_quote_digest: values[13],
        accepted_disclosure_digest: values[14],
        provider_request_expires_at: values[16],
        state: "provider_pending",
        provider_effect_certainty: "ambiguous",
        provider_error_code: null,
        checkout_session_id: null,
        checkout_url: null,
        expires_at: null
      };
      return rows({ inserted: true });
    }
    if (lower.startsWith("select attempt.*, invoice.invoice_number")) {
      return rows(attemptRow());
    }
    if (
      lower.startsWith("select * from ss.service_custom_build_final_checkout_attempts")
    ) {
      return rows(attemptRow());
    }
    if (
      lower.startsWith("update ss.service_custom_build_final_checkout_attempts")
    ) {
      assert.ok(state.attempt);
      if (lower.includes("set state = 'ready'")) {
        state.attempt.state = "ready";
        state.attempt.provider_effect_certainty = "confirmed";
        state.attempt.provider_error_code = null;
        state.attempt.checkout_session_id = values[2];
        state.attempt.checkout_url = values[3];
        state.attempt.expires_at = values[4];
      } else if (lower.includes("set state = 'expired'")) {
        state.attempt.state = "expired";
      } else if (lower.includes("set state = 'persistence_unknown'")) {
        state.attempt.state = "persistence_unknown";
        state.attempt.provider_effect_certainty = "ambiguous";
        state.attempt.provider_error_code = values[2];
      } else {
        state.attempt.state = values[2];
        state.attempt.provider_effect_certainty = values[3];
        state.attempt.provider_error_code = values[4];
      }
      return rows({ updated: true });
    }

    if (lower.startsWith("select attempt.id as attempt_id")) {
      return rows(attemptRow());
    }
    if (
      lower.startsWith(
        "select obligation.id as obligation_id"
      ) && lower.includes("attempt.id as attempt_id")
    ) {
      return rows(attemptRow());
    }

    if (
      lower.startsWith(
        "select * from ss.service_custom_build_final_stripe_events"
      )
    ) {
      const selectedId = values.at(-1);
      return rows(state.event?.id === selectedId ? state.event : null);
    }
    if (
      lower.startsWith(
        "insert into ss.service_custom_build_final_stripe_events"
      )
    ) {
      state.event = {
        id: values[0],
        organization_id: values[1],
        project_id: values[2],
        customer_user_id: values[3],
        job_id: values[4],
        obligation_id: values[5],
        completion_package_id: values[6],
        invoice_id: values[7],
        checkout_attempt_id: values[8],
        event_type: values[9],
        livemode: values[10],
        api_version: values[11],
        checkout_session_id: values[12],
        payload_digest: values[13],
        provider_created_at: values[14],
        signature_verified_at: values[15],
        state: "pending",
        reconciliation_code: null,
        result: null
      };
      return rows({ inserted: true });
    }
    if (
      lower.startsWith(
        "update ss.service_custom_build_final_stripe_events"
      )
    ) {
      assert.ok(state.event);
      state.sealedEventIds.push(values[1]);
      if (lower.includes("set state = 'reconciliation_required'")) {
        state.event.state = "reconciliation_required";
        state.event.reconciliation_code = values[2];
      } else {
        state.event.state = "processed";
        state.event.reconciliation_code = null;
        state.event.result = JSON.parse(values[2]);
      }
      return rows({ updated: true });
    }

    if (lower.startsWith("select stripe_customer_id from ss.stripe_customers")) {
      return rows(
        state.stripeCustomerId
          ? { stripe_customer_id: state.stripeCustomerId }
          : null
      );
    }
    if (lower.startsWith("insert into ss.stripe_customers")) {
      state.stripeCustomerId = values[1];
      return rows({ inserted: true });
    }
    if (
      lower.startsWith(
        "insert into ss.service_custom_build_final_payment_receipts"
      )
    ) {
      state.receipt = {
        id: values[0],
        receipt_source: values[10],
        checkout_session_id: values[13],
        payment_intent_id: values[14],
        charge_id: values[15],
        stripe_customer_id: values[16],
        subtotal_minor: values[17],
        tax_minor: values[18],
        total_minor: values[19],
        provider_facts_digest: values[27]
      };
      state.attempt.state = "paid";
      if (state.event) {
        state.event.state = "processed";
        state.event.result = {
          schema: "sitesourcery.custom-build-final-settlement/v1",
          status: "payment_settled",
          completionPackageId: COMPLETION_PACKAGE_ID,
          invoiceId: INVOICE_ID,
          jobId: JOB_ID,
          receiptId: RECEIPT_ID,
          next: "custom_build_handoff"
        };
      }
      return rows({ inserted: true });
    }

    throw new Error(`Unhandled ${transaction.label} proof query: ${sql}`);
  }

  const authority = {
    async service(context, work) {
      const label = state.labels.shift();
      assert.ok(label, "each proof transaction must have an explicit label");
      const transaction = { label, context, queries: [] };
      state.transactions.push(transaction);
      return work({
        query(text, values) {
          return query(transaction, text, values);
        }
      });
    }
  };

  const provider = {
    async createCustomBuildFinalCheckout(input) {
      state.providerCalls.create += 1;
      state.providerCreateInputs.push(structuredClone(input));
      state.lastPurpose = input.purpose;
      state.lastPurposeDigest = input.purposeDigest;
      if (state.createMode === "ambiguous") {
        const error = new Error("provider response lost");
        error.code = "stripe_response_lost";
        throw error;
      }
      return {
        checkoutId: CHECKOUT_ID,
        url: CHECKOUT_URL,
        expiresAt: input.checkoutExpiresAt
      };
    },
    async retrieveCustomBuildFinalPayment(input) {
      state.providerCalls.payment += 1;
      state.providerPaymentInputs.push(structuredClone(input));
      const facts = paymentFacts();
      if (state.concurrentSettlementOnReadback) {
        state.receipt = {
          id: RECEIPT_ID,
          receipt_source: "stripe_event",
          checkout_session_id: facts.checkoutSessionId,
          payment_intent_id: facts.paymentIntentId,
          charge_id: facts.chargeId,
          stripe_customer_id: facts.customerId,
          subtotal_minor: facts.subtotalMinor,
          tax_minor: facts.taxMinor,
          total_minor: facts.totalMinor,
          provider_facts_digest: facts.providerFactsDigest
        };
        state.attempt.state = "paid";
      }
      return state.paymentMode === "invalid"
        ? { ...facts, totalMinor: facts.totalMinor + 1 }
        : facts;
    },
    async retrieveCustomBuildFinalCheckoutLifecycle(input) {
      state.providerCalls.lifecycle += 1;
      state.providerLifecycleInputs.push(structuredClone(input));
      return {
        schema:
          "sitesourcery.stripe-custom-build-final-checkout-lifecycle/v1",
        provider: "stripe",
        checkoutSessionId: CHECKOUT_ID,
        purposeDigest: state.attempt.purpose_digest,
        state: state.lifecycleState
      };
    }
  };

  const ids = {
    next(kind) {
      return {
        custom_build_final_checkout: ATTEMPT_ID,
        custom_build_final_checkout_command: CUSTOMER_COMMAND_ROW_ID,
        custom_build_final_reconciliation_command: OWNER_COMMAND_ROW_ID,
        custom_build_final_receipt: RECEIPT_ID,
        final_checkout_replay_command:
          "d0000000-0000-4000-8000-000000000001"
      }[kind] ?? assert.fail(`unexpected proof ID kind ${kind}`);
    }
  };

  const payment = createPostgresCustomServicesCustomBuildFinalPayment({
    authority,
    provider,
    release: RELEASE,
    clock: { now: () => state.now },
    ids
  });

  function checkoutInput(commandId, overrides = {}) {
    return {
      ...customerScope(),
      commandId,
      invoiceId: INVOICE_ID,
      invoiceDigest: state.invoice.invoice_digest,
      ...overrides
    };
  }

  function ownerCommand(commandId) {
    return {
      attemptId: ATTEMPT_ID,
      commandId,
      organizationId: ORGANIZATION_ID
    };
  }

  function stripeEvent(eventId) {
    const purpose = state.lastPurpose;
    assert.ok(purpose && state.lastPurposeDigest);
    return {
      id: eventId,
      type: "checkout.session.completed",
      livemode: false,
      api_version: "2024-06-20",
      created: Math.floor(
        Date.parse("2026-08-06T18:00:00.000Z") / 1000
      ),
      data: {
        object: {
          id: CHECKOUT_ID,
          metadata: {
            schema: CUSTOM_BUILD_FINAL_PAYMENT_METADATA_SCHEMA,
            tenant_id: purpose.tenantId,
            customer_id: purpose.customerId,
            project_id: purpose.projectId,
            job_id: purpose.jobId,
            quote_id: purpose.quoteId,
            quote_revision_id: purpose.quoteRevisionId,
            quote_acceptance_id: purpose.quoteAcceptanceId,
            completion_package_id: purpose.completionPackageId,
            final_obligation_id: purpose.finalObligationId,
            invoice_id: purpose.invoiceId,
            invoice_number: purpose.invoiceNumber,
            installment_number: "2",
            workmanship_correction_days: "30",
            accepted_quote_digest: purpose.acceptedQuoteDigest,
            accepted_disclosure_digest: purpose.acceptedDisclosureDigest,
            commercial_contract_digest: purpose.commercialContractDigest,
            base_scope_digest: purpose.baseScopeDigest,
            effective_change_order_digests_digest:
              digest(purpose.effectiveChangeOrderDigests),
            effective_scope_digest: purpose.effectiveScopeDigest,
            completion_package_digest: purpose.completionPackageDigest,
            final_obligation_digest: purpose.finalObligationDigest,
            invoice_digest: purpose.invoiceDigest,
            purpose_digest: state.lastPurposeDigest
          }
        }
      }
    };
  }

  async function run(labels, work) {
    assert.deepEqual(state.labels, []);
    state.labels.push(...labels);
    const first = state.transactions.length;
    let result;
    let workError = null;
    try {
      result = await work();
    } catch (error) {
      workError = error;
    }
    try {
      assert.deepEqual(
        state.labels,
        [],
        workError
          ? `work failed with ${workError.code ?? workError.name}: ${workError.message}`
          : undefined
      );
      assert.equal(
        state.transactions.length - first,
        labels.length,
        `transaction count for ${labels.join(", ")}`
      );
    } catch (proofError) {
      if (workError !== null) proofError.cause = workError;
      throw proofError;
    }
    if (workError !== null) throw workError;
    return result;
  }

  return {
    payment,
    state,
    run,
    checkoutInput,
    ownerCommand,
    stripeEvent
  };
}

function transactionNamed(state, label) {
  const matches = state.transactions.filter(
    (transaction) => transaction.label === label
  );
  assert.equal(matches.length, 1, `one ${label} transaction is required`);
  return matches[0];
}

function assertH1mLockBeforeMutableAuthority(transaction) {
  const advisory = transaction.queries.findIndex(({ sql }) =>
    sql.includes("pg_advisory_xact_lock")
  );
  assert.equal(
    advisory,
    1,
    `${transaction.label} must discover immutable job then take the shared lock`
  );
  assert.match(transaction.queries[0].sql, /\/\* final:.*:discover \*\//iu);
  assert.deepEqual(
    transaction.queries[advisory].values,
    [`ss-custom-build-h1m:${JOB_ID}`]
  );
  transaction.queries.forEach(({ sql }, index) => {
    if (
      /\bfor update\b/iu.test(sql) ||
      /^(?:insert into|update|delete from)\b/iu.test(sql)
    ) {
      assert.ok(
        index > advisory,
        `${transaction.label} touched mutable authority before the H1M lock: ${sql}`
      );
    }
  });
}

async function createReadyCheckout(harness, prefix) {
  const result = await harness.run(
    [`${prefix} stage`, `${prefix} finish`],
    () => harness.payment.createCheckout(
      harness.checkoutInput(`${prefix}-customer-final-command`)
    )
  );
  assert.equal(result.state, "ready");
  return result;
}

test("every v46 final-payment mutation discovers the immutable job and takes the shared H1M lock first", async () => {
  const settled = createHarness();
  await createReadyCheckout(settled, "settled");
  const settlement = await settled.run(
    ["event claim", "settlement"],
    () => settled.payment.ingestStripeEvent(
      settled.stripeEvent("evt_custom_build_final_settlement_1")
    )
  );
  assert.equal(settlement.status, "payment_settled");

  const rejected = createHarness({ paymentMode: "invalid" });
  await createReadyCheckout(rejected, "rejected");
  const reconciliation = await rejected.run(
    ["event claim reconcile", "event reconciliation"],
    () => rejected.payment.ingestStripeEvent(
      rejected.stripeEvent("evt_custom_build_final_reconcile_1")
    )
  );
  assert.equal(reconciliation.status, "reconciliation_required");

  const uncertain = createHarness({ createMode: "ambiguous" });
  await assert.rejects(
    uncertain.run(
      ["failure stage", "failure"],
      () => uncertain.payment.createCheckout(
        uncertain.checkoutInput("failure-customer-final-command")
      )
    ),
    (error) =>
      error.code ===
        "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED" &&
      error.status === 503
  );
  uncertain.state.createMode = "success";
  const ownerCreation = await uncertain.run(
    ["owner creation claim", "owner creation second"],
    () => uncertain.payment.reconcileCheckoutCreation(
      { userId: OPERATOR_ID },
      JOB_ID,
      uncertain.ownerCommand("owner-final-creation-command")
    )
  );
  assert.equal(ownerCreation.status, "checkout_ready");

  const ownerStatus = createHarness({ lifecycleState: "open" });
  await createReadyCheckout(ownerStatus, "owner-status");
  const statusResult = await ownerStatus.run(
    ["owner status claim", "owner status second"],
    () => ownerStatus.payment.reconcileCheckoutCreation(
      { userId: OPERATOR_ID },
      JOB_ID,
      ownerStatus.ownerCommand("owner-final-status-command")
    )
  );
  assert.equal(statusResult.status, "reconciliation_required");

  const ownerSettled = createHarness({
    lifecycleState: "paid",
    concurrentSettlementOnReadback: true
  });
  await createReadyCheckout(ownerSettled, "owner-settlement");
  const retainedOwnerEventId = "evt_custom_build_final_owner_pending_1";
  ownerSettled.state.event = {
    id: retainedOwnerEventId,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    customer_user_id: CUSTOMER_ID,
    job_id: JOB_ID,
    obligation_id: OBLIGATION_ID,
    completion_package_id: COMPLETION_PACKAGE_ID,
    invoice_id: INVOICE_ID,
    checkout_attempt_id: ATTEMPT_ID,
    checkout_session_id: CHECKOUT_ID,
    state: "pending",
    reconciliation_code: null,
    result: null,
    signature_verified_at: "2026-08-06T18:25:00.000Z"
  };
  const ownerSettlement = await ownerSettled.run(
    ["owner settlement claim", "owner settlement second"],
    () => ownerSettled.payment.reconcileCheckoutCreation(
      { userId: OPERATOR_ID },
      JOB_ID,
      ownerSettled.ownerCommand("owner-final-settlement-command")
    )
  );
  assert.equal(ownerSettlement.status, "payment_settled");
  assert.equal(ownerSettled.state.event.state, "processed");
  assert.deepEqual(ownerSettled.state.sealedEventIds, [retainedOwnerEventId]);
  assert.equal(ownerSettled.state.ownerCommand.state, "completed");
  assert.deepEqual(ownerSettled.state.ownerCommand.result, ownerSettlement);

  const expired = createHarness({ lifecycleState: "expired" });
  await createReadyCheckout(expired, "expiry");
  expired.state.now = "2026-08-06T20:00:00.000Z";
  const expiry = await expired.run(
    ["expiry read", "customer expiry"],
    () => expired.payment.reconcileExpiredCheckout(
      expired.checkoutInput("customer-final-expiry-command")
    )
  );
  assert.equal(expiry.status, "expired_reconciled");
  assert.equal(expiry.invoiceId, INVOICE_ID);

  for (const [state, labels] of [
    [settled.state, [
      "settled stage",
      "settled finish",
      "event claim",
      "settlement"
    ]],
    [rejected.state, [
      "rejected stage",
      "rejected finish",
      "event claim reconcile",
      "event reconciliation"
    ]],
    [uncertain.state, [
      "failure stage",
      "failure",
      "owner creation claim",
      "owner creation second"
    ]],
    [ownerStatus.state, [
      "owner-status stage",
      "owner-status finish",
      "owner status claim",
      "owner status second"
    ]],
    [ownerSettled.state, [
      "owner-settlement stage",
      "owner-settlement finish",
      "owner settlement claim",
      "owner settlement second"
    ]],
    [expired.state, [
      "expiry stage",
      "expiry finish",
      "customer expiry"
    ]]
  ]) {
    for (const label of labels) {
      assertH1mLockBeforeMutableAuthority(transactionNamed(state, label));
    }
  }
});

test("owner final-payment reconciliation replays exactly and rejects command digest drift", async () => {
  const harness = createHarness({ createMode: "ambiguous" });
  await assert.rejects(
    harness.run(
      ["durable stage", "durable failure"],
      () => harness.payment.createCheckout(
        harness.checkoutInput("durable-customer-final-command")
      )
    ),
    (error) =>
      error.code === "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED"
  );

  harness.state.createMode = "success";
  const command = harness.ownerCommand("durable-owner-final-command");
  const first = await harness.run(
    ["durable owner claim", "durable owner second"],
    () => harness.payment.reconcileCheckoutCreation(
      { userId: OPERATOR_ID },
      JOB_ID,
      command
    )
  );
  assert.equal(first.status, "checkout_ready");
  const providerEffects = harness.state.providerCalls.create;

  const replay = await harness.run(
    ["owner replay claim"],
    () => harness.payment.reconcileCheckoutCreation(
      { userId: OPERATOR_ID },
      JOB_ID,
      command
    )
  );
  assert.deepEqual(replay, first);
  assert.equal(harness.state.providerCalls.create, providerEffects);

  await assert.rejects(
    harness.run(
      ["owner digest conflict claim"],
      () => harness.payment.reconcileCheckoutCreation(
        { userId: OPERATOR_ID },
        "40000000-0000-4000-8000-000000000002",
        command
      )
    ),
    (error) =>
      error.code ===
        "CUSTOM_BUILD_FINAL_PAYMENT_RECONCILIATION_IDEMPOTENCY_CONFLICT" &&
      error.status === 409
  );
  assert.equal(harness.state.providerCalls.create, providerEffects);

  for (const label of [
    "durable stage",
    "durable failure",
    "durable owner claim",
    "durable owner second",
    "owner replay claim",
    "owner digest conflict claim"
  ]) {
    assertH1mLockBeforeMutableAuthority(
      transactionNamed(harness.state, label)
    );
  }
  for (const label of ["owner replay claim", "owner digest conflict claim"]) {
    const transaction = transactionNamed(harness.state, label);
    assert.equal(
      transaction.queries.some(({ sql }) =>
        /^(?:insert into|update|delete from)\b/iu.test(sql)
      ),
      false,
      `${label} must not repeat a storage effect`
    );
  }
  assert.equal(harness.state.ownerCommand.state, "completed");
  assert.deepEqual(harness.state.ownerCommand.result, first);
});

test("ambiguous Stripe creation is fenced until explicit same-key owner recovery", async () => {
  const harness = createHarness({ createMode: "ambiguous" });
  const customerCommandId = "ambiguous-customer-final-command";
  await assert.rejects(
    harness.run(
      ["ambiguous stage", "ambiguous failure"],
      () => harness.payment.createCheckout(
        harness.checkoutInput(customerCommandId)
      )
    ),
    (error) =>
      error.code === "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED"
  );
  assert.equal(harness.state.providerCalls.create, 1);

  await assert.rejects(
    harness.run(
      ["automatic replay stage"],
      () => harness.payment.createCheckout(
        harness.checkoutInput(customerCommandId)
      )
    ),
    (error) =>
      error.code === "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED"
  );
  assert.equal(harness.state.providerCalls.create, 1);

  harness.state.createMode = "success";
  const recovered = await harness.run(
    ["explicit owner claim", "explicit owner recovery"],
    () => harness.payment.reconcileCheckoutCreation(
      { userId: OPERATOR_ID },
      JOB_ID,
      harness.ownerCommand("explicit-owner-final-recovery")
    )
  );
  assert.equal(recovered.status, "checkout_ready");
  assert.equal(harness.state.providerCalls.create, 2);

  const [uncertain, ownerRetry] = harness.state.providerCreateInputs;
  assert.equal(uncertain.idempotencyKey, customerCommandId);
  assert.equal(ownerRetry.idempotencyKey, customerCommandId);
  assert.equal(ownerRetry.checkoutExpiresAt, uncertain.checkoutExpiresAt);
  assert.equal(ownerRetry.stripeCustomerId, uncertain.stripeCustomerId);
  assert.equal(ownerRetry.stripeCustomerId, STRIPE_CUSTOMER_ID);
  assert.notEqual(ownerRetry.checkoutExpiresAt, null);

  for (const label of [
    "ambiguous stage",
    "ambiguous failure",
    "automatic replay stage",
    "explicit owner claim",
    "explicit owner recovery"
  ]) {
    assertH1mLockBeforeMutableAuthority(
      transactionNamed(harness.state, label)
    );
  }
});

test("zero-balance and forged customer invoices cannot reach Stripe", async () => {
  const zeroBalance = createHarness({ invoiceAvailable: false });
  await assert.rejects(
    zeroBalance.run(
      ["zero-balance stage"],
      () => zeroBalance.payment.createCheckout(
        zeroBalance.checkoutInput("zero-balance-final-command")
      )
    ),
    (error) =>
      error.code === "CUSTOM_BUILD_FINAL_INVOICE_UNAVAILABLE" &&
      error.status === 404
  );
  assert.equal(zeroBalance.state.providerCalls.create, 0);

  const forged = createHarness();
  await assert.rejects(
    forged.run(
      ["forged-invoice stage"],
      () => forged.payment.createCheckout(
        forged.checkoutInput("forged-customer-final-command", {
          invoiceId: "70000000-0000-4000-8000-000000000002"
        })
      )
    ),
    (error) =>
      error.code === "CUSTOM_BUILD_FINAL_INVOICE_UNAVAILABLE" &&
      error.status === 404
  );
  assert.equal(forged.state.providerCalls.create, 0);
});

test("final Checkout excludes purpose crossover, accepted-change money, and assessment credit", async () => {
  assert.equal(
    isPotentialCustomBuildFinalPaymentStripeEvent({
      type: "checkout.session.completed",
      data: { object: { metadata: {
        schema: "sitesourcery_stripe_custom_build_change_payment_v1"
      } } }
    }),
    false
  );

  const harness = createHarness();
  for (const forbidden of [
    { purpose: "custom_build_change" },
    { acceptedChangeAmountMinor: 12500 },
    { assessmentCreditMinor: 20000 },
    { amountMinor: 1 },
    { creditMinor: 20000 }
  ]) {
    await assert.rejects(
      harness.payment.createCheckout(
        harness.checkoutInput("forged-final-money-command", forbidden)
      ),
      (error) => error.code === "invalid_input" && error.status === 400
    );
  }
  assert.equal(harness.state.transactions.length, 0);
  assert.equal(harness.state.providerCalls.create, 0);

  harness.state.invoice.accepted_change_amount_minor = "999999";
  harness.state.invoice.assessment_credit_minor = "20000";
  await createReadyCheckout(harness, "exact-purpose");
  assert.equal(harness.state.providerCalls.create, 1);
  const purpose = harness.state.providerCreateInputs[0].purpose;
  assert.equal(purpose.price.amountMinor, FINAL_DUE_MINOR);
  assert.equal(purpose.installmentNumber, 2);
  assert.equal(purpose.workmanshipCorrectionDays, 30);
  const serialized = JSON.stringify(purpose);
  for (const forbidden of [
    "custom_build_change",
    "acceptedChangeAmountMinor",
    "accepted_change_amount_minor",
    "assessmentCreditMinor",
    "assessment_credit_minor",
    "creditMinor"
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("customer final-payment projection never exposes raw provider identifiers", async () => {
  const pending = finalRow({
    checkout_attempt_id: ATTEMPT_ID,
    checkout_state: "ready",
    provider_effect_certainty: "confirmed",
    provider_request_expires_at: "2026-08-06T19:01:00.000Z",
    checkout_session_id: CHECKOUT_ID,
    checkout_url: CHECKOUT_URL,
    checkout_expires_at: "2026-08-06T19:01:00.000Z",
    event_id: "evt_custom_build_final_projection_pending_1",
    event_state: "pending"
  });
  const pendingProjection = await projectionBoundary(pending)
    .payment.readCurrentState(customerScope());
  assert.equal(
    pendingProjection.state,
    "payment_reconciliation_required"
  );
  assert.equal(pendingProjection.payment.state, "reconciliation_required");
  assert.equal(pendingProjection.action.checkoutAvailable, false);

  const paid = finalRow({
    checkout_attempt_id: ATTEMPT_ID,
    checkout_state: "paid",
    provider_effect_certainty: "confirmed",
    provider_error_code: null,
    provider_request_expires_at: "2026-08-06T19:01:00.000Z",
    checkout_session_id: CHECKOUT_ID,
    checkout_url: CHECKOUT_URL,
    checkout_expires_at: "2026-08-06T19:01:00.000Z",
    event_id: "evt_custom_build_final_projection_1",
    event_state: "processed",
    reconciliation_code: null,
    receipt_id: RECEIPT_ID,
    receipt_source: "stripe_event",
    payment_intent_id: PAYMENT_INTENT_ID,
    charge_id: CHARGE_ID,
    stripe_customer_id: STRIPE_CUSTOMER_ID,
    tax_minor: "2145",
    total_minor: String(FINAL_DUE_MINOR + 2145),
    settled_at: "2026-08-06T18:30:00.000Z",
    receipt_linkage_valid: true
  });
  const boundary = projectionBoundary(paid);
  const projection = await boundary.payment.readCurrentState(customerScope());
  assert.equal(projection.state, "paid_handoff_pending");
  assert.equal(projection.payment.chargeOccurred, true);
  const customerJson = JSON.stringify(projection);
  for (const raw of [
    CHECKOUT_ID,
    PAYMENT_INTENT_ID,
    CHARGE_ID,
    STRIPE_CUSTOMER_ID,
    paid.event_id,
    "checkoutSessionId",
    "paymentIntentId",
    "chargeId",
    "stripeCustomerId",
    "eventId"
  ]) {
    assert.equal(customerJson.includes(raw), false, raw);
  }
  assert.equal(boundary.queries.length, 1);
});

test("only provider-confirmed exact final payment can create a settlement receipt", async () => {
  const rejected = createHarness({ paymentMode: "invalid" });
  await createReadyCheckout(rejected, "unconfirmed");
  const rejectedResult = await rejected.run(
    ["unconfirmed event claim", "unconfirmed event reconciliation"],
    () => rejected.payment.ingestStripeEvent(
      rejected.stripeEvent("evt_custom_build_final_unconfirmed_1")
    )
  );
  assert.equal(rejectedResult.status, "reconciliation_required");
  assert.equal(rejected.state.providerCalls.payment, 1);
  assert.equal(rejected.state.receipt, null);
  assert.equal(rejected.state.attempt.state, "ready");

  const confirmed = createHarness();
  await createReadyCheckout(confirmed, "confirmed");
  const confirmedResult = await confirmed.run(
    ["confirmed event claim", "confirmed settlement"],
    () => confirmed.payment.ingestStripeEvent(
      confirmed.stripeEvent("evt_custom_build_final_confirmed_1")
    )
  );
  assert.equal(confirmedResult.status, "payment_settled");
  assert.equal(confirmed.state.providerCalls.payment, 1);
  assert.equal(confirmed.state.receipt?.id, RECEIPT_ID);
  assert.equal(confirmed.state.attempt.state, "paid");
  assert.equal(
    confirmed.state.providerPaymentInputs[0].purpose.price.amountMinor,
    FINAL_DUE_MINOR
  );
});
