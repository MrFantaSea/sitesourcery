import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOM_BUILD_CHANGE_PAYMENT_METADATA_SCHEMA,
  createHeldCustomServicesCustomBuildChangePayment,
  createPostgresCustomServicesCustomBuildChangePayment,
  isPotentialCustomBuildChangePaymentStripeEvent
} from "../custom-services-custom-build-change-payment-postgres.mjs";
import { digest } from "../security.mjs";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "30000000-0000-4000-8000-000000000001";
const JOB_ID = "40000000-0000-4000-8000-000000000001";
const CHANGE_ID = "50000000-0000-4000-8000-000000000001";
const ACCEPTANCE_ID = "60000000-0000-4000-8000-000000000001";
const INVOICE_ID = "70000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "80000000-0000-4000-8000-000000000001";
const OPERATOR_ID = "a0000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "b0000000-0000-4000-8000-000000000001";
const COMMAND_ROW_ID = "c0000000-0000-4000-8000-000000000001";
const OWNER_COMMAND_ROW_ID = "d0000000-0000-4000-8000-000000000001";
const CHECKOUT_ID = "cs_custom_build_change_order_1";
const CHECKOUT_URL =
  "https://checkout.stripe.com/c/pay/cs_custom_build_change_order_1";
const STRIPE_CUSTOMER_ID = "cus_custom_build_change_1";
const PAYMENT_INTENT_ID = "pi_custom_build_change_1";
const CLOCK_NOW = "2026-08-06T18:30:00.000Z";

const HELD_RELEASE = Object.freeze({
  approved: false,
  currency: "USD",
  holdScope: "new_checkout_creation_only",
  providerEffectProcessing:
    "settlement_and_reconciliation_continue",
  taxMode: "automatic"
});

function provider() {
  return {
    async createCustomBuildChangeCheckout() {},
    async retrieveCustomBuildChangePayment() {},
    async retrieveCustomBuildChangeCheckoutLifecycle() {}
  };
}

function scope() {
  return {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID
  };
}

function invoiceRow(overrides = {}) {
  return {
    invoice_id: INVOICE_ID,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    case_id: "90000000-0000-4000-8000-000000000001",
    customer_user_id: CUSTOMER_ID,
    job_id: JOB_ID,
    change_order_id: CHANGE_ID,
    change_acceptance_id: ACCEPTANCE_ID,
    change_number: 2,
    invoice_number:
      "SSCB-CHG-70000000000040008000000000000001",
    policy_id: "a0000000-0000-4000-8000-000000000001",
    scope_boundary_digest: "1".repeat(64),
    accepted_quote_digest: "2".repeat(64),
    accepted_disclosure_digest: "3".repeat(64),
    prior_effective_scope_digest: "4".repeat(64),
    target_completion_date: "2026-10-01",
    subtotal_minor: "25000",
    currency: "USD",
    tax_mode: "automatic",
    invoice_digest: "5".repeat(64),
    issued_at: "2026-08-06T18:00:00.000Z",
    unit_count: 2,
    change_state: "accepted_payment_required",
    checkout_attempt_id: null,
    checkout_command_id: null,
    checkout_state: null,
    provider_effect_certainty: null,
    provider_error_code: null,
    purpose_digest: null,
    checkout_session_id: null,
    checkout_url: null,
    checkout_expires_at: null,
    event_id: null,
    event_state: null,
    reconciliation_code: null,
    receipt_id: null,
    tax_minor: null,
    total_minor: null,
    settled_at: null,
    receipt_linkage_valid: false,
    lines: [{
      lineNumber: 1,
      componentKey: "custom_build_change_units",
      displayName: "Custom build change #2 — added-work units",
      quantity: 2,
      unitAmountMinor: 12500,
      amountMinor: 25000
    }],
    ...overrides
  };
}

function projectionBoundary(row, release = HELD_RELEASE) {
  const queries = [];
  const payment = createPostgresCustomServicesCustomBuildChangePayment({
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
    provider: provider(),
    release
  });
  return { payment, queries };
}

function createServiceProofHarness({
  createMode = "success",
  paymentMode = "success",
  lifecycleState = "expired"
} = {}) {
  const state = {
    now: CLOCK_NOW,
    createMode,
    paymentMode,
    lifecycleState,
    invoice: invoiceRow(),
    attempt: null,
    customerCommand: null,
    ownerCommand: null,
    event: null,
    receipt: null,
    stripeCustomerId: null,
    labels: [],
    transactions: [],
    providerCalls: {
      create: 0,
      lifecycle: 0,
      payment: 0
    },
    lastPurpose: null,
    lastPurposeDigest: null
  };

  function rows(selected) {
    const values = selected == null
      ? []
      : Array.isArray(selected)
        ? selected
        : [selected];
    return { rows: values, rowCount: values.length };
  }

  function attemptRow() {
    const attempt = state.attempt;
    assert.ok(attempt, "the proof harness requires one retained attempt");
    return {
      ...state.invoice,
      id: attempt.id,
      attempt_id: attempt.id,
      checkout_attempt_id: attempt.id,
      organization_id: ORGANIZATION_ID,
      project_id: PROJECT_ID,
      customer_user_id: CUSTOMER_ID,
      job_id: JOB_ID,
      change_order_id: CHANGE_ID,
      change_acceptance_id: ACCEPTANCE_ID,
      invoice_id: INVOICE_ID,
      command_id: attempt.command_id,
      state: attempt.state,
      attempt_state: attempt.state,
      provider_effect_certainty: attempt.provider_effect_certainty,
      provider_error_code: attempt.provider_error_code,
      provider_request_expires_at: attempt.provider_request_expires_at,
      purpose_digest: attempt.purpose_digest,
      expected_subtotal_minor: "25000",
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
      receipt_customer_id: state.receipt?.stripe_customer_id ?? null,
      receipt_subtotal_minor: state.receipt?.subtotal_minor ?? null,
      receipt_tax_minor: state.receipt?.tax_minor ?? null,
      receipt_total_minor: state.receipt?.total_minor ?? null,
      receipt_facts_digest:
        state.receipt?.provider_facts_digest ?? null,
      event_id: state.event?.id ?? null,
      event_state: state.event?.state ?? null,
      event_verified_at:
        state.event?.signature_verified_at ?? null,
      reconciliation_code: state.event?.reconciliation_code ?? null,
      change_state: state.receipt
        ? "effective"
        : "accepted_payment_required"
    };
  }

  function paymentFacts() {
    const facts = {
      schema: "sitesourcery.stripe-custom-build-change-payment-facts/v1",
      provider: "stripe",
      checkoutSessionId: CHECKOUT_ID,
      paymentIntentId: PAYMENT_INTENT_ID,
      customerId: STRIPE_CUSTOMER_ID,
      paymentStatus: "paid",
      subtotalMinor: 25000,
      taxMinor: 1656,
      totalMinor: 26656,
      taxMode: "automatic",
      currency: "USD",
      purposeDigest: state.attempt.purpose_digest,
      providerPaymentTime: "2026-08-06T18:20:00.000Z"
    };
    return {
      ...facts,
      providerFactsDigest: digest(facts)
    };
  }

  async function query(transaction, sourceText, values = []) {
    const sql = sourceText.replace(/\s+/gu, " ").trim();
    const lower = sql.toLowerCase();
    transaction.queries.push({ sql, values });

    if (lower.startsWith("select job_id from ")) {
      return rows({ job_id: JOB_ID });
    }
    if (lower.includes("pg_advisory_xact_lock")) return rows({ locked: null });
    if (lower.includes("service_operator_has_capability")) {
      return rows({ allowed: true });
    }
    if (lower.includes("custom_build_change_reconciliation_request_digest")) {
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
      lower.startsWith("select * from ss.service_custom_build_change_reconciliation_commands")
      && lower.includes("where command_id = $1")
    ) {
      return rows(
        state.ownerCommand?.command_id === values[0]
          ? state.ownerCommand
          : null
      );
    }
    if (
      lower.startsWith("select * from ss.service_custom_build_change_reconciliation_commands")
      && lower.includes("where organization_id = $1 and id = $2")
    ) {
      return rows(
        state.ownerCommand?.id === values[1]
          ? state.ownerCommand
          : null
      );
    }
    if (
      lower.startsWith("select id from ss.service_custom_build_change_reconciliation_commands")
    ) {
      return rows(
        state.ownerCommand?.command_id === values[0]
          ? { id: state.ownerCommand.id }
          : null
      );
    }
    if (
      lower.startsWith("insert into ss.service_custom_build_change_reconciliation_commands")
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
      lower.startsWith("update ss.service_custom_build_change_reconciliation_commands")
    ) {
      assert.equal(state.ownerCommand?.id, values[1]);
      state.ownerCommand.state = "completed";
      state.ownerCommand.result = JSON.parse(values[2]);
      return rows({ updated: true });
    }

    if (lower.startsWith("select * from ss.idempotency_keys")) {
      return rows(
        state.customerCommand?.idempotency_key === values[2]
          ? state.customerCommand
          : null
      );
    }
    if (lower.startsWith("insert into ss.idempotency_keys")) {
      state.customerCommand = {
        id: values[0],
        organization_id: values[1],
        principal_id: values[2],
        route_key: values[3],
        idempotency_key: values[4],
        request_digest: values[5],
        state: lower.includes("'completed'") ? "completed" : "running",
        response_body: lower.includes("'completed'")
          ? JSON.parse(values[6])
          : null
      };
      return rows({ inserted: true });
    }
    if (lower.startsWith("update ss.idempotency_keys")) {
      assert.ok(state.customerCommand);
      if (lower.includes("where id = $1")) {
        state.customerCommand.state = lower.includes("state = 'completed'")
          ? "completed"
          : values[1];
        state.customerCommand.response_body = JSON.parse(
          lower.includes("state = 'completed'") ? values[1] : values[2]
        );
      } else {
        state.customerCommand.state = "completed";
        state.customerCommand.response_body = JSON.parse(values[3]);
      }
      return rows({ updated: true });
    }

    if (
      lower.includes("select invoice.*, change_order.state as change_state")
      && lower.includes("customer.stripe_customer_id")
      && !lower.includes("attempt.state as attempt_state")
    ) {
      return rows({
        ...state.invoice,
        stripe_customer_id: state.stripeCustomerId,
        receipt_id: state.receipt?.id ?? null
      });
    }
    if (
      lower.startsWith("select attempt.*, invoice.invoice_number")
      && lower.includes("attempt.invoice_id = $2")
    ) {
      return rows(state.attempt ? attemptRow() : null);
    }
    if (
      lower.startsWith("insert into ss.service_custom_build_change_checkout_attempts")
    ) {
      state.attempt = {
        id: values[0],
        command_id: values[8],
        purpose_digest: values[9],
        invoice_digest: values[10],
        accepted_quote_digest: values[11],
        accepted_disclosure_digest: values[12],
        tax_mode: values[14],
        provider_request_expires_at: values[15],
        state: "provider_pending",
        provider_effect_certainty: "ambiguous",
        provider_error_code: null,
        checkout_session_id: null,
        checkout_url: null,
        expires_at: null
      };
      return rows({ inserted: true });
    }
    if (
      lower.startsWith("select attempt.id as attempt_id")
      && lower.includes("for update of attempt")
    ) {
      return rows(attemptRow());
    }
    if (
      lower.startsWith("select attempt.*, attempt.id as attempt_id")
    ) {
      return rows(attemptRow());
    }
    if (
      lower.startsWith("select invoice.*, change_order.state as change_state")
      && lower.includes("attempt.state as attempt_state")
    ) {
      return rows(attemptRow());
    }
    if (
      lower.startsWith("select attempt.*, invoice.invoice_number")
    ) {
      return rows(attemptRow());
    }
    if (lower.startsWith("update ss.service_custom_build_change_checkout_attempts")) {
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
      } else {
        state.attempt.state = values[2];
        state.attempt.provider_effect_certainty = values[3];
        state.attempt.provider_error_code = values[4];
      }
      return rows({ updated: true });
    }

    if (
      lower.startsWith("select * from ss.service_custom_build_change_stripe_events")
    ) {
      return rows(
        state.event?.id === values[1] ? state.event : null
      );
    }
    if (
      lower.startsWith("insert into ss.service_custom_build_change_stripe_events")
    ) {
      state.event = {
        id: values[0],
        organization_id: values[1],
        project_id: values[2],
        customer_user_id: values[3],
        job_id: values[4],
        change_order_id: values[5],
        change_acceptance_id: values[6],
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
      lower.startsWith("update ss.service_custom_build_change_stripe_events")
    ) {
      assert.ok(state.event);
      if (lower.includes("reconciliation_required")) {
        state.event.state = "reconciliation_required";
        state.event.reconciliation_code = values[2];
      } else {
        state.event.state = "processed";
        state.event.reconciliation_code = null;
        state.event.result = JSON.parse(values[2]);
      }
      return rows({ updated: true });
    }
    if (
      lower.startsWith("select result from ss.service_custom_build_change_stripe_events")
    ) return rows({ result: state.event?.result ?? null });

    if (
      lower.startsWith("select stripe_customer_id from ss.stripe_customers")
    ) {
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
      lower.startsWith("insert into ss.service_custom_build_change_payment_receipts")
    ) {
      state.receipt = {
        id: values[0],
        receipt_source: values[10],
        checkout_session_id: values[13],
        payment_intent_id: values[14],
        stripe_customer_id: values[15],
        subtotal_minor: values[16],
        tax_minor: values[17],
        total_minor: values[18],
        tax_mode: values[19],
        provider_facts_digest: values[25]
      };
      state.attempt.state = "paid";
      if (state.event) {
        state.event.state = "processed";
        state.event.reconciliation_code = null;
        state.event.result = {
          schema: "sitesourcery.custom-build-change-settlement/v1",
          status: "payment_settled",
          projectId: PROJECT_ID,
          changeOrderId: CHANGE_ID,
          invoiceId: INVOICE_ID,
          receiptId: values[0],
          next: "custom_build_changed_work"
        };
      }
      return rows({ inserted: true });
    }

    throw new Error(
      `Unhandled ${transaction.label} proof query: ${sql}`
    );
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

  const paymentProvider = {
    async createCustomBuildChangeCheckout(input) {
      state.providerCalls.create += 1;
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
    async retrieveCustomBuildChangePayment() {
      state.providerCalls.payment += 1;
      const facts = paymentFacts();
      return state.paymentMode === "invalid"
        ? { ...facts, totalMinor: facts.totalMinor + 1 }
        : facts;
    },
    async retrieveCustomBuildChangeCheckoutLifecycle() {
      state.providerCalls.lifecycle += 1;
      return {
        schema:
          "sitesourcery.stripe-custom-build-change-checkout-lifecycle/v1",
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
        custom_build_change_checkout: ATTEMPT_ID,
        custom_build_change_checkout_command: COMMAND_ROW_ID,
        custom_build_change_reconciliation_command: OWNER_COMMAND_ROW_ID,
        custom_build_change_receipt: RECEIPT_ID,
        change_checkout_replay_command:
          "e0000000-0000-4000-8000-000000000001"
      }[kind] ?? assert.fail(`unexpected proof ID kind ${kind}`);
    }
  };

  const payment = createPostgresCustomServicesCustomBuildChangePayment({
    authority,
    provider: paymentProvider,
    release: { ...HELD_RELEASE, approved: true },
    clock: { now: () => state.now },
    ids
  });

  function checkoutInput(commandId) {
    return {
      ...scope(),
      commandId,
      invoiceId: INVOICE_ID,
      invoiceDigest: state.invoice.invoice_digest
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
            schema: CUSTOM_BUILD_CHANGE_PAYMENT_METADATA_SCHEMA,
            tenant_id: purpose.tenantId,
            customer_id: purpose.customerId,
            project_id: purpose.projectId,
            job_id: purpose.jobId,
            change_order_id: purpose.changeOrderId,
            change_acceptance_id: purpose.changeAcceptanceId,
            invoice_id: purpose.invoiceId,
            invoice_number: purpose.invoiceNumber,
            change_number: String(purpose.changeNumber),
            scope_boundary_digest: purpose.scopeBoundaryDigest,
            prior_effective_scope_digest:
              purpose.priorEffectiveScopeDigest,
            target_completion_date: purpose.targetCompletionDate,
            accepted_quote_digest: purpose.acceptedQuoteDigest,
            accepted_disclosure_digest:
              purpose.acceptedDisclosureDigest,
            invoice_digest: purpose.invoiceDigest,
            purpose_digest: state.lastPurposeDigest
          }
        }
      }
    };
  }

  async function run(labels, work) {
    assert.equal(state.labels.length, 0);
    state.labels.push(...labels);
    const first = state.transactions.length;
    let workError = null;
    let result;
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
    stripeEvent
  };
}

function assertH1mLockPrecedesMutableAuthority(transaction) {
  const advisory = transaction.queries.findIndex(({ sql }) =>
    sql.includes("pg_advisory_xact_lock")
  );
  assert.equal(
    advisory,
    1,
    `${transaction.label} must discover immutable job then take the shared lock`
  );
  assert.match(transaction.queries[0].sql, /^select job_id from /iu);
  assert.deepEqual(
    transaction.queries[advisory].values,
    [`ss-custom-build-h1m:${JOB_ID}`],
    `${transaction.label} must use the H1M job lock namespace`
  );
  transaction.queries.forEach(({ sql }, index) => {
    if (
      /\bfor update\b/iu.test(sql)
      || /^(?:insert into|update|delete from)\b/iu.test(sql)
    ) {
      assert.ok(
        index > advisory,
        `${transaction.label} touched mutable authority before the shared H1M lock: ${sql}`
      );
    }
  });
}

function transactionNamed(state, label) {
  const matches = state.transactions.filter(
    (transaction) => transaction.label === label
  );
  assert.equal(matches.length, 1, `one ${label} transaction is required`);
  return matches[0];
}

async function createReadyCheckout(harness, prefix) {
  const commandId = `${prefix}-customer-checkout-command`;
  const result = await harness.run(
    [`${prefix} stage`, `${prefix} finish`],
    () => harness.payment.createCheckout(harness.checkoutInput(commandId))
  );
  assert.equal(result.state, "ready");
  return result;
}

test("every v45 payment mutation discovers the immutable job and takes the shared H1M lock first", async () => {
  const settled = createServiceProofHarness();
  await createReadyCheckout(settled, "settled");
  const settlement = await settled.run(
    ["event claim", "settlement"],
    () => settled.payment.ingestStripeEvent(
      settled.stripeEvent("evt_custom_build_change_settlement_1")
    )
  );
  assert.equal(settlement.status, "payment_settled");

  const rejected = createServiceProofHarness({ paymentMode: "invalid" });
  await createReadyCheckout(rejected, "rejected");
  const reconciliation = await rejected.run(
    ["event claim reconcile", "event reconcile"],
    () => rejected.payment.ingestStripeEvent(
      rejected.stripeEvent("evt_custom_build_change_reconcile_1")
    )
  );
  assert.equal(reconciliation.status, "reconciliation_required");

  const uncertain = createServiceProofHarness({ createMode: "ambiguous" });
  await assert.rejects(
    uncertain.run(
      ["failure stage", "failure"],
      () => uncertain.payment.createCheckout(
        uncertain.checkoutInput("failure-customer-checkout-command")
      )
    ),
    (error) =>
      error.code ===
        "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED" &&
      error.status === 503
  );
  uncertain.state.createMode = "success";
  const ownerResult = await uncertain.run(
    ["owner claim", "owner second"],
    () => uncertain.payment.reconcileCheckoutCreation(
      { userId: OPERATOR_ID },
      JOB_ID,
      {
        attemptId: ATTEMPT_ID,
        commandId: "owner-create-reconciliation-command",
        organizationId: ORGANIZATION_ID
      }
    )
  );
  assert.equal(ownerResult.status, "checkout_ready");

  const ownerSettled = createServiceProofHarness({
    lifecycleState: "paid"
  });
  await createReadyCheckout(ownerSettled, "owner-settled");
  const ownerSettlement = await ownerSettled.run(
    ["owner settlement claim", "owner settlement"],
    () => ownerSettled.payment.reconcileCheckoutCreation(
      { userId: OPERATOR_ID },
      JOB_ID,
      {
        attemptId: ATTEMPT_ID,
        commandId: "owner-settlement-reconciliation-command",
        organizationId: ORGANIZATION_ID
      }
    )
  );
  assert.equal(ownerSettlement.status, "payment_settled");

  const expired = createServiceProofHarness();
  await createReadyCheckout(expired, "expiry");
  expired.state.now = "2026-08-08T18:31:00.000Z";
  const expiryResult = await expired.run(
    ["expiry read", "customer expiry"],
    () => expired.payment.reconcileExpiredCheckout(
      expired.checkoutInput("expiry-reconciliation-command")
    )
  );
  assert.deepEqual(expiryResult, {
    status: "expired_reconciled",
    invoiceId: INVOICE_ID
  });

  for (const [state, labels] of [
    [settled.state, ["settled stage", "settled finish", "event claim", "settlement"]],
    [rejected.state, ["rejected stage", "rejected finish", "event claim reconcile", "event reconcile"]],
    [uncertain.state, ["failure stage", "failure", "owner claim", "owner second"]],
    [ownerSettled.state, [
      "owner-settled stage",
      "owner-settled finish",
      "owner settlement claim",
      "owner settlement"
    ]],
    [expired.state, ["expiry stage", "expiry finish", "customer expiry"]]
  ]) {
    for (const label of labels) {
      assertH1mLockPrecedesMutableAuthority(
        transactionNamed(state, label)
      );
    }
  }
});

test("owner reconciliation command replays exactly and rejects digest drift without another provider effect", async () => {
  const harness = createServiceProofHarness({ createMode: "ambiguous" });
  await assert.rejects(
    harness.run(
      ["durable stage", "durable failure"],
      () => harness.payment.createCheckout(
        harness.checkoutInput("durable-customer-checkout-command")
      )
    ),
    (error) =>
      error.code ===
        "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED"
  );
  harness.state.createMode = "success";
  const command = {
    attemptId: ATTEMPT_ID,
    commandId: "durable-owner-reconciliation-command",
    organizationId: ORGANIZATION_ID
  };
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

  const differentJobId = "40000000-0000-4000-8000-000000000002";
  await assert.rejects(
    harness.run(
      ["owner conflict claim"],
      () => harness.payment.reconcileCheckoutCreation(
        { userId: OPERATOR_ID },
        differentJobId,
        command
      )
    ),
    (error) =>
      error.code ===
        "CUSTOM_BUILD_CHANGE_PAYMENT_RECONCILIATION_IDEMPOTENCY_CONFLICT" &&
      error.status === 409
  );
  assert.equal(harness.state.providerCalls.create, providerEffects);

  for (const label of [
    "durable stage",
    "durable failure",
    "durable owner claim",
    "durable owner second",
    "owner replay claim",
    "owner conflict claim"
  ]) {
    assertH1mLockPrecedesMutableAuthority(
      transactionNamed(harness.state, label)
    );
  }
  for (const label of ["owner replay claim", "owner conflict claim"]) {
    assert.equal(
      transactionNamed(harness.state, label).queries.some(({ sql }) =>
        /^(?:insert into|update|delete from)\b/iu.test(sql)
      ),
      false,
      `${label} must not repeat a storage effect`
    );
  }
  assert.equal(harness.state.ownerCommand.state, "completed");
  assert.deepEqual(harness.state.ownerCommand.result, first);
});

test("change-payment Stripe routing requires its exact metadata schema", () => {
  assert.equal(
    isPotentialCustomBuildChangePaymentStripeEvent({
      type: "checkout.session.completed",
      data: { object: { metadata: {
        schema: CUSTOM_BUILD_CHANGE_PAYMENT_METADATA_SCHEMA
      } } }
    }),
    true
  );
  for (const schema of [
    "sitesourcery_custom_build_start_checkout_v1",
    "sitesourcery_service_assessment_checkout_v1",
    undefined
  ]) {
    assert.equal(
      isPotentialCustomBuildChangePaymentStripeEvent({
        type: "checkout.session.completed",
        data: { object: { metadata: { schema } } }
      }),
      false
    );
  }
});

test("held fallback rejects money-shaped browser input before its hold response", async () => {
  const held = createHeldCustomServicesCustomBuildChangePayment();
  assert.deepEqual(await held.readiness(), {
    schema: "sitesourcery.custom-build-change-payment-readiness/v1",
    ready: false,
    state: "held"
  });
  await assert.rejects(
    held.createCheckout({
      ...scope(),
      commandId: "change-checkout-command-1",
      invoiceId: INVOICE_ID,
      invoiceDigest: "5".repeat(64),
      amountMinor: 1
    }),
    (error) => error.code === "invalid_input" && error.status === 400
  );
  await assert.rejects(
    held.createCheckout({
      ...scope(),
      commandId: "change-checkout-command-1",
      invoiceId: INVOICE_ID,
      invoiceDigest: "5".repeat(64)
    }),
    (error) =>
      error.code === "CUSTOM_BUILD_CHANGE_PAYMENT_HELD" &&
      error.status === 503
  );
});

test("owner reconciliation retains and validates its transport command before the hold boundary", async () => {
  const held = createHeldCustomServicesCustomBuildChangePayment();
  const exact = {
    attemptId: "b0000000-0000-4000-8000-000000000001",
    commandId: "owner-change-reconciliation-command-1",
    organizationId: ORGANIZATION_ID
  };
  await assert.rejects(
    held.reconcileCheckoutCreation(
      { userId: OPERATOR_ID },
      JOB_ID,
      exact
    ),
    (error) =>
      error.code === "CUSTOM_BUILD_CHANGE_PAYMENT_HELD" &&
      error.status === 503
  );
  for (const drift of [
    { ...exact, commandId: "short" },
    { ...exact, commandId: "owner-command\nforged" },
    { attemptId: exact.attemptId, organizationId: ORGANIZATION_ID },
    { ...exact, amountMinor: 12500 }
  ]) {
    await assert.rejects(
      held.reconcileCheckoutCreation(
        { userId: OPERATOR_ID },
        JOB_ID,
        drift
      ),
      (error) => error.code === "invalid_input" && error.status === 400
    );
  }
});

test("customer projection exposes one exact positive change invoice while Checkout is held", async () => {
  const context = projectionBoundary(invoiceRow());
  const projection = await context.payment.readCurrentInvoice(scope());
  assert.equal(projection.state, "payment_held");
  assert.equal(projection.action.available, false);
  assert.equal(projection.invoice.changeOrderId, CHANGE_ID);
  assert.equal(projection.invoice.changeAcceptanceId, ACCEPTANCE_ID);
  assert.deepEqual(projection.invoice.lines, [{
    lineNumber: 1,
    componentKey: "custom_build_change_units",
    displayName: "Custom build change #2 — added-work units",
    quantity: 2,
    unitAmountMinor: 12500,
    amountMinor: 25000,
    currency: "USD"
  }]);
  assert.equal("paymentDeadline" in projection.invoice, false);
  assert.equal("credit" in projection.invoice, false);
  assert.equal(context.queries.length, 1);
  for (const evidence of [
    "service_custom_build_change_payment_receipts",
    "receipt_linkage_valid",
    "receipt.change_acceptance_id = invoice.change_acceptance_id",
    "service_custom_build_change_invoice_lines"
  ]) {
    assert.ok(context.queries[0].text.includes(evidence), evidence);
  }
});

test("approved projection permits Checkout without accepting browser money", async () => {
  const context = projectionBoundary(invoiceRow(), {
    ...HELD_RELEASE,
    approved: true
  });
  const projection = await context.payment.readCurrentInvoice(scope());
  assert.equal(projection.state, "checkout_available");
  assert.deepEqual(projection.action, {
    available: true,
    reason: null
  });
});

test("paid projection requires receipt, paid attempt, and effective scope atomically", async (t) => {
  const paid = invoiceRow({
    change_state: "effective",
    checkout_attempt_id:
      "b0000000-0000-4000-8000-000000000001",
    checkout_state: "paid",
    provider_effect_certainty: "confirmed",
    checkout_session_id: "cs_custom_build_change_paid_1",
    event_id: "evt_custom_build_change_paid_1",
    event_state: "processed",
    receipt_id: RECEIPT_ID,
    tax_minor: "1656",
    total_minor: "26656",
    settled_at: "2026-08-06T18:10:00.000Z",
    receipt_linkage_valid: true
  });
  const projection = await projectionBoundary(paid)
    .payment.readCurrentInvoice(scope());
  assert.equal(projection.state, "paid");
  assert.equal(projection.invoice.payment.chargeOccurred, true);
  assert.equal(projection.invoice.tax.amountMinor, 1656);
  assert.equal(projection.invoice.total.amountMinor, 26656);

  for (const [name, drift] of [
    ["receipt linkage", { receipt_linkage_valid: false }],
    ["change state", { change_state: "accepted_payment_required" }],
    ["attempt state", { checkout_state: "ready" }],
    ["line amount", {
      lines: [{ ...paid.lines[0], amountMinor: 24999 }]
    }]
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        projectionBoundary(invoiceRow({ ...paid, ...drift }))
          .payment.readCurrentInvoice(scope()),
        (error) =>
          error.code === "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT" &&
          error.status === 500
      );
    });
  }
});
