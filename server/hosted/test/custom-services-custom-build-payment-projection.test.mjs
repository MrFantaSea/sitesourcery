import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresCustomServicesCustomBuildPayment } from
  "../custom-services-custom-build-payment-postgres.mjs";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "30000000-0000-4000-8000-000000000001";
const INVOICE_ID = "40000000-0000-4000-8000-000000000001";
const JOB_ID = "50000000-0000-4000-8000-000000000001";

function paidInvoiceRow(overrides = {}) {
  return {
    invoice_id: INVOICE_ID,
    invoice_number: "SSCB-40000000000040008000000000000001",
    quote_id: "60000000-0000-4000-8000-000000000001",
    tier_id: "site-plus",
    accepted_quote_digest: "a".repeat(64),
    accepted_disclosure_digest: "b".repeat(64),
    gross_start_minor: "90000",
    credit_minor: "20000",
    subtotal_minor: "70000",
    final_due_minor: "90000",
    currency: "USD",
    invoice_digest: "c".repeat(64),
    issued_at: "2026-08-06T14:00:00.000Z",
    payment_deadline: "2026-08-13T14:00:00.000Z",
    credit_state: "settled",
    checkout_state: "paid",
    checkout_session_id: "cs_paid_projection_1",
    checkout_url: null,
    checkout_expires_at: null,
    event_state: "processed",
    receipt_id: "70000000-0000-4000-8000-000000000001",
    receipt_linkage_valid: true,
    job_id: JOB_ID,
    job_linkage_valid: true,
    job_state: "open",
    job_opened_at: "2026-08-06T14:30:00.000Z",
    job_tier_id: "site-plus",
    job_scope_statement:
      "Craft the approved Site Plus scope and prepare it for final handoff.",
    job_crafted_pages: 7,
    job_sections: 28,
    job_unique_layouts: 7,
    job_content_words: 3000,
    job_supplied_media: 24,
    job_target_completion_date: "2026-09-15",
    job_start_gross_minor: "90000",
    job_start_credit_minor: "20000",
    job_start_paid_subtotal_minor: "70000",
    job_final_due_minor: "90000",
    job_currency: "USD",
    final_payment_state: "unpaid",
    lines: [
      {
        lineNumber: 1,
        componentKey: "custom_build_start",
        displayName: "Site Plus first installment",
        amountMinor: 90000
      },
      {
        lineNumber: 2,
        componentKey: "assessment_build_credit",
        displayName: "Website assessment credit",
        amountMinor: -20000
      }
    ],
    ...overrides
  };
}

function boundary(row) {
  const queries = [];
  const payment = createPostgresCustomServicesCustomBuildPayment({
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
            return { rows: [row], rowCount: 1 };
          }
        });
      }
    },
    provider: {
      async createCustomBuildStartCheckout() {},
      async retrieveCustomBuildStartPayment() {},
      async retrieveCustomBuildStartCheckoutLifecycle() {}
    },
    release: {
      approved: false,
      currency: "USD",
      paymentWindowDays: 7,
      taxMode: "automatic"
    }
  });
  return { payment, queries };
}

function scope() {
  return {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID
  };
}

test("paid invoice projection requires exact receipt, job, quote, and money linkage", async () => {
  const context = boundary(paidInvoiceRow());

  const projection = await context.payment.readCurrentInvoice(scope());

  assert.equal(projection.state, "paid");
  assert.equal(projection.job.jobId, JOB_ID);
  assert.equal(projection.job.targetCompletionDate, "2026-09-15");
  assert.equal(projection.job.firstPayment.paidSubtotalMinor, 70000);
  assert.equal(context.queries.length, 1);
  assert.deepEqual(context.queries[0].values, [
    ORGANIZATION_ID,
    PROJECT_ID,
    CUSTOMER_ID
  ]);
  for (const evidence of [
    "receipt_linkage_valid",
    "job_linkage_valid",
    "job.payment_receipt_id = receipt.id",
    "job.start_gross_minor = invoice.gross_start_minor",
    "job.target_completion_date::text as job_target_completion_date",
    "join ss.service_custom_build_quote_revisions revision"
  ]) assert.ok(context.queries[0].text.includes(evidence), evidence);
});

test("paid invoice projection fails closed on mismatched linkage, money, or date", async (t) => {
  for (const [name, override] of [
    ["receipt linkage", { receipt_linkage_valid: false }],
    ["job linkage", { job_linkage_valid: false }],
    ["invoice money", { job_start_gross_minor: "89999" }],
    ["canonical date", {
      job_target_completion_date: new Date("2026-09-15T00:00:00.000Z")
    }]
  ]) {
    await t.test(name, async () => {
      const context = boundary(paidInvoiceRow(override));
      await assert.rejects(
        () => context.payment.readCurrentInvoice(scope()),
        (error) =>
          error.code === "CUSTOM_BUILD_PAYMENT_CONFLICT" &&
          error.status === 500
      );
    });
  }
});
