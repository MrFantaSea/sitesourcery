import { deepFreeze } from "../commerce-v2/canonical.mjs";
import {
  validateCustomServicesAssessmentPaymentRelease
} from "./custom-services-assessment-payment-config.mjs";
import { HostedError, invariant } from "./errors.mjs";

export const CUSTOM_SERVICES_ASSESSMENT_INVOICE_SCHEMA =
  "sitesourcery.custom-services-assessment-invoice/v2";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const INVOICE_NUMBER = /^SSA-[0-9A-F]{32}$/u;

function exactKeys(value, expected, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return value;
}

function digest(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "invoice_repository_conflict",
    `${field} is unavailable`,
    { status: 500 }
  );
  return value;
}

function iso(value, field) {
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    !Number.isNaN(selected.getTime()),
    "invoice_repository_conflict",
    `${field} is unavailable`,
    { status: 500 }
  );
  return selected.toISOString();
}

function scope(value) {
  exactKeys(
    value,
    ["actorId", "customerId", "organizationId", "projectId"],
    "assessmentInvoiceScope"
  );
  const selected = Object.freeze({
    actorId: uuid(value.actorId, "actorId"),
    customerId: uuid(value.customerId, "customerId"),
    organizationId: uuid(value.organizationId, "organizationId"),
    projectId: uuid(value.projectId, "projectId")
  });
  invariant(
    selected.actorId === selected.customerId,
    "assessment_invoice_unavailable",
    "The assessment invoice is unavailable.",
    { status: 404 }
  );
  return selected;
}

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "invalid_configuration",
    "canonical PostgreSQL authority is required",
    { status: 500 }
  );
  return value;
}

function rows(result) {
  invariant(
    result &&
      Array.isArray(result.rows) &&
      Number.isSafeInteger(result.rowCount) &&
      result.rowCount === result.rows.length &&
      result.rowCount <= 1,
    "invoice_repository_conflict",
    "The assessment invoice projection is inconsistent.",
    { status: 500 }
  );
  return result.rows;
}

function amount(value, field) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) && selected >= 0,
    "invoice_repository_conflict",
    `${field} is unavailable`,
    { status: 500 }
  );
  return selected;
}

function usd(value) {
  return `$${(value / 100).toFixed(2)}`;
}

function project(row, input, paymentRelease) {
  if (!row) {
    return deepFreeze({
      schema: CUSTOM_SERVICES_ASSESSMENT_INVOICE_SCHEMA,
      state: "not_available",
      invoice: null,
      job: null,
      actions: {
        checkout: {
          available: false,
          reason: "accepted_quote_required",
          message: "Accept the current assessment quote before an invoice exists."
        }
      }
    });
  }

  exactKeys(
    row,
    [
      "accepted_at",
      "accepted_disclosure_digest",
      "accepted_quote_digest",
      "assessment_job_delivery_date",
      "assessment_job_id",
      "assessment_job_opened_at",
      "assessment_job_state",
      "charge_occurred",
      "checkout_attempt_id",
      "checkout_attempt_state",
      "checkout_expires_at",
      "checkout_provider_effect_certainty",
      "checkout_session_id",
      "component_key",
      "created_at",
      "currency",
      "customer_user_id",
      "dispatch_authorized",
      "display_name",
      "expected_subtotal_minor",
      "expected_tax_minor",
      "expected_total_minor",
      "hold_reason",
      "installment_number",
      "invoice_digest",
      "invoice_id",
      "invoice_number",
      "invoice_state",
      "issued_at",
      "line_number",
      "organization_id",
      "payable",
      "payment_state",
      "payment_receipt_id",
      "project_id",
      "provider_effect_certainty",
      "purpose",
      "quantity",
      "quote_id",
      "quote_revision",
      "recomputed_invoice_digest",
      "reservation_invoice_digest",
      "receipt_checkout_attempt_id",
      "receipt_currency",
      "receipt_payment_status",
      "receipt_provider_facts_digest",
      "receipt_provider_paid_at",
      "receipt_settled_at",
      "receipt_subtotal_minor",
      "receipt_tax_minor",
      "receipt_total_minor",
      "settlement_event_state",
      "settlement_reconciliation_code",
      "subtotal_minor",
      "tax_minor",
      "tax_state",
      "total_minor",
      "unit_amount_minor",
      "unit_label"
    ],
    "assessmentInvoiceRow"
  );

  invariant(
    row.organization_id === input.organizationId &&
      row.project_id === input.projectId &&
      row.customer_user_id === input.customerId &&
      row.purpose === "assessment" &&
      row.invoice_state === "tax_calculation_pending" &&
      row.tax_state === "calculation_required" &&
      row.tax_minor === null &&
      row.total_minor === null &&
      row.payable === false &&
      row.charge_occurred === false &&
      row.payment_state === "held" &&
      row.hold_reason === "tax_calculation_required" &&
      row.dispatch_authorized === false &&
      row.provider_effect_certainty === "not_submitted" &&
      row.expected_tax_minor === null &&
      row.expected_total_minor === null &&
      (
        row.checkout_attempt_state === null ||
        [
          "provider_pending",
          "ready",
          "failed",
          "persistence_unknown",
          "expired"
        ].includes(row.checkout_attempt_state)
      ) &&
      Number(row.installment_number) === 1 &&
      Number(row.line_number) === 1 &&
      row.component_key === "website_assessment_standard" &&
      row.display_name === "Website assessment" &&
      Number(row.quantity) === 1 &&
      row.unit_label === "assessment" &&
      row.currency === "USD",
    "invoice_repository_conflict",
    "The held assessment invoice changed unexpectedly.",
    { status: 500 }
  );

  const subtotalMinor = amount(row.subtotal_minor, "invoice.subtotal");
  invariant(
    subtotalMinor === 20000 &&
      amount(row.unit_amount_minor, "invoice.unitAmount") === 20000 &&
      amount(row.expected_subtotal_minor, "payment.subtotal") === 20000,
    "invoice_repository_conflict",
    "The held assessment invoice amount changed unexpectedly.",
    { status: 500 }
  );
  const invoiceDigest = digest(row.invoice_digest, "invoice.digest");
  invariant(
    invoiceDigest === digest(
      row.recomputed_invoice_digest,
      "invoice.recomputedDigest"
    ) &&
      invoiceDigest === digest(
        row.reservation_invoice_digest,
        "payment.invoiceDigest"
      ),
    "invoice_repository_conflict",
    "The held assessment invoice digest does not match its reservation.",
    { status: 500 }
  );
  invariant(
    INVOICE_NUMBER.test(String(row.invoice_number)) &&
      Number(row.quote_revision) > 0,
    "invoice_repository_conflict",
    "The assessment invoice reference is unavailable.",
    { status: 500 }
  );

  const hasReceipt = row.payment_receipt_id !== null;
  let receipt = null;
  let job = null;
  if (hasReceipt) {
    const taxMinor = amount(
      row.receipt_tax_minor,
      "receipt.tax"
    );
    const totalMinor = amount(
      row.receipt_total_minor,
      "receipt.total"
    );
    invariant(
      UUID.test(String(row.payment_receipt_id ?? "")) &&
        row.receipt_checkout_attempt_id ===
          row.checkout_attempt_id &&
        row.receipt_payment_status === "paid" &&
        amount(
          row.receipt_subtotal_minor,
          "receipt.subtotal"
        ) === 20000 &&
        totalMinor === 20000 + taxMinor &&
        row.receipt_currency === "USD" &&
        SHA256.test(
          String(row.receipt_provider_facts_digest ?? "")
        ) &&
        UUID.test(String(row.assessment_job_id ?? "")) &&
        row.assessment_job_state === "open" &&
        Number.isFinite(
          Date.parse(row.assessment_job_delivery_date)
        ),
      "invoice_repository_conflict",
      "The settled assessment invoice changed unexpectedly.",
      { status: 500 }
    );
    receipt = {
      receiptId: row.payment_receipt_id,
      paidAt: iso(
        row.receipt_provider_paid_at,
        "receipt.paidAt"
      ),
      settledAt: iso(
        row.receipt_settled_at,
        "receipt.settledAt"
      ),
      taxMinor,
      totalMinor
    };
    job = {
      jobId: row.assessment_job_id,
      state: "open",
      openedAt: iso(
        row.assessment_job_opened_at,
        "job.openedAt"
      ),
      deliveryDate: String(
        row.assessment_job_delivery_date
      ).slice(0, 10)
    };
  } else {
    invariant(
      row.receipt_checkout_attempt_id === null &&
        row.receipt_payment_status === null &&
        row.receipt_subtotal_minor === null &&
        row.receipt_tax_minor === null &&
        row.receipt_total_minor === null &&
        row.receipt_currency === null &&
        row.receipt_provider_facts_digest === null &&
        row.receipt_provider_paid_at === null &&
        row.receipt_settled_at === null &&
        row.assessment_job_id === null &&
        row.assessment_job_state === null &&
        row.assessment_job_opened_at === null &&
        row.assessment_job_delivery_date === null,
      "invoice_repository_conflict",
      "The assessment settlement projection is incomplete.",
      { status: 500 }
    );
  }

  const paymentVerifying =
    !hasReceipt && row.settlement_event_state === "pending";
  const paymentAttention =
    !hasReceipt &&
    row.settlement_event_state ===
      "reconciliation_required";
  invariant(
    [null, "pending", "processed", "reconciliation_required"].includes(
      row.settlement_event_state
    ) &&
      (
        row.settlement_event_state !== "processed" ||
        hasReceipt
      ) &&
      (
        row.settlement_event_state ===
          "reconciliation_required"
          ? typeof row.settlement_reconciliation_code === "string" &&
            row.settlement_reconciliation_code.length > 0
          : row.settlement_reconciliation_code === null
      ),
    "invoice_repository_conflict",
    "The assessment payment-verification state is inconsistent.",
    { status: 500 }
  );

  let liveReadyCheckout = false;
  if (row.checkout_attempt_state === "ready") {
    invariant(
      row.checkout_provider_effect_certainty === "confirmed" &&
        /^cs_[A-Za-z0-9_]+$/u.test(
          String(row.checkout_session_id ?? "")
        ) &&
        Number.isFinite(
          Date.parse(row.checkout_expires_at)
        ),
      "invoice_repository_conflict",
      "The retained assessment Checkout is inconsistent.",
      { status: 500 }
    );
    liveReadyCheckout =
      Date.parse(row.checkout_expires_at) > Date.now();
  }
  const checkoutRequiresReconciliation =
    paymentVerifying ||
    paymentAttention ||
    row.checkout_attempt_state === "persistence_unknown" ||
    (
      row.checkout_attempt_state === "ready" &&
      !liveReadyCheckout
    );
  const checkoutAvailable =
    !hasReceipt &&
    !paymentVerifying &&
    !paymentAttention &&
    paymentRelease.approved &&
    (
      row.checkout_attempt_state === null ||
      row.checkout_attempt_state === "failed" ||
      row.checkout_attempt_state === "expired" ||
      liveReadyCheckout
    );

  const projectionState = hasReceipt
    ? "paid_job_open"
    : paymentVerifying
      ? "payment_verifying"
      : paymentAttention
        ? "payment_attention"
        : checkoutAvailable
          ? "checkout_available"
          : "tax_calculation_pending";
  const paymentState = hasReceipt
    ? "paid"
    : paymentVerifying
      ? "verifying"
      : paymentAttention
        ? "attention"
        : checkoutAvailable
          ? "checkout_available"
          : "held";

  return deepFreeze({
    schema: CUSTOM_SERVICES_ASSESSMENT_INVOICE_SCHEMA,
    state: projectionState,
    invoice: {
      invoiceId: uuid(row.invoice_id, "invoice.invoiceId"),
      invoiceNumber: row.invoice_number,
      purpose: "assessment",
      quote: {
        quoteId: uuid(row.quote_id, "invoice.quoteId"),
        quoteRevision: Number(row.quote_revision),
        acceptedAt: iso(row.accepted_at, "invoice.acceptedAt"),
        acceptedQuoteDigest: digest(
          row.accepted_quote_digest,
          "invoice.acceptedQuoteDigest"
        ),
        acceptedDisclosureDigest: digest(
          row.accepted_disclosure_digest,
          "invoice.acceptedDisclosureDigest"
        )
      },
      line: {
        name: "Website assessment",
        quantity: 1,
        unit: "assessment",
        unitAmount: {
          amountMinor: 20000,
          currency: "USD",
          formatted: "$200.00"
        }
      },
      subtotal: {
        amountMinor: subtotalMinor,
        currency: "USD",
        formatted: "$200.00"
      },
      tax: {
        state: hasReceipt ? "calculated" : "calculation_required",
        amountMinor: receipt?.taxMinor ?? null,
        message: hasReceipt
          ? `Tax confirmed at ${usd(receipt.taxMinor)}.`
          : "Stripe calculates tax at secure checkout, if applicable."
      },
      total: {
        state: hasReceipt ? "final" : "pending_tax",
        amountMinor: receipt?.totalMinor ?? null,
        currency: "USD",
        formatted: hasReceipt
          ? usd(receipt.totalMinor)
          : null
      },
      payment: {
        state: paymentState,
        checkoutAvailable,
        chargeOccurred: hasReceipt
          ? true
          : paymentVerifying || paymentAttention
            ? null
            : false,
        receiptId: receipt?.receiptId ?? null,
        paidAt: receipt?.paidAt ?? null,
        settledAt: receipt?.settledAt ?? null,
        message: hasReceipt
          ? "Payment is confirmed and the assessment job is open."
          : paymentVerifying
            ? "Payment verification is in progress. Do not pay again."
            : paymentAttention
              ? "Payment needs manual review. Do not submit another payment."
              : checkoutAvailable
                ? "Secure checkout is available. No charge occurred."
                : "No payment has been requested and no charge occurred."
      },
      invoiceDigest,
      issuedAt: iso(row.issued_at, "invoice.issuedAt"),
      createdAt: iso(row.created_at, "invoice.createdAt")
    },
    job,
    actions: {
      checkout: {
        available: checkoutAvailable,
        reason: checkoutAvailable
          ? null
          : hasReceipt
            ? "already_paid"
            : paymentVerifying
              ? "payment_verifying"
              : paymentAttention
                ? "payment_attention"
            : checkoutRequiresReconciliation
            ? "reconciliation_required"
            : !paymentRelease.approved
              ? "payment_release_held"
            : "checkout_not_available",
        message: checkoutAvailable
          ? "Stripe shows tax, if applicable, and the exact total before payment."
          : hasReceipt
            ? "Payment is complete and assessment work is queued."
            : paymentVerifying
              ? "Payment verification is in progress. Do not pay again."
              : paymentAttention
                ? "Payment needs manual review before any further action."
            : checkoutRequiresReconciliation
            ? "The earlier payment-page request is being reconciled before another can open."
            : !paymentRelease.approved
              ? "Secure assessment payment is held in this runtime."
            : "Secure payment is not available yet."
      }
    }
  });
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (["22P02", "23503", "23514", "42501", "55000"].includes(error?.code)) {
    return new HostedError(
      "invoice_repository_conflict",
      "The assessment invoice is temporarily unavailable.",
      { status: 500 }
    );
  }
  return error;
}

export function createPostgresCustomServicesInvoiceRepository({
  authority,
  release
} = {}) {
  const database = validateAuthority(authority);
  const paymentRelease =
    validateCustomServicesAssessmentPaymentRelease(release);
  return Object.freeze({
    async readCurrentInvoice(value) {
      const input = scope(value);
      try {
        return await database.service(
          {
            actorKind: "customer",
            userId: input.actorId,
            organizationId: input.organizationId,
            readOnly: true
          },
          async (client) => {
            const selected = rows(await client.query(
              `select
                 invoice.id as invoice_id,
                 invoice.organization_id,
                 invoice.project_id,
                 invoice.customer_user_id,
                 invoice.purpose,
                 invoice.invoice_number,
                 invoice.quote_id,
                 invoice.quote_revision,
                 invoice.accepted_quote_digest,
                 invoice.accepted_disclosure_digest,
                 invoice.installment_number,
                 invoice.subtotal_minor,
                 invoice.tax_state,
                 invoice.tax_minor,
                 invoice.total_minor,
                 invoice.currency,
                 invoice.state as invoice_state,
                 invoice.payable,
                 invoice.charge_occurred,
                 invoice.issued_at,
                 invoice.created_at,
                 invoice.invoice_digest,
                 ss.service_invoice_digest(
                   invoice.organization_id,
                   invoice.project_id,
                   invoice.customer_user_id,
                   invoice.id,
                   invoice.invoice_number,
                   invoice.quote_id,
                   invoice.quote_revision,
                   invoice.quote_revision_id,
                   invoice.quote_acceptance_id,
                   invoice.quote_installment_id,
                   invoice.accepted_quote_digest,
                   invoice.accepted_disclosure_digest,
                   invoice.legal_document_id,
                   invoice.subtotal_minor,
                   invoice.tax_state,
                   invoice.tax_minor,
                   invoice.total_minor,
                   invoice.currency,
                   invoice.state,
                   invoice.payable,
                   invoice.charge_occurred,
                   invoice.issued_at
                 ) as recomputed_invoice_digest,
                 acceptance.accepted_at,
                 line.line_number,
                 line.component_key,
                 line.display_name,
                 line.quantity,
                 line.unit_label,
                 line.unit_amount_minor,
                 reservation.state as payment_state,
                 reservation.hold_reason,
                 reservation.dispatch_authorized,
                 reservation.provider_effect_certainty,
                 reservation.expected_subtotal_minor,
                 reservation.expected_tax_minor,
                 reservation.expected_total_minor,
                 reservation.invoice_digest as reservation_invoice_digest,
                 checkout_attempt.state as checkout_attempt_state,
                 checkout_attempt.id as checkout_attempt_id,
                 checkout_attempt.provider_effect_certainty
                   as checkout_provider_effect_certainty,
                 checkout_attempt.checkout_session_id,
                 checkout_attempt.expires_at as checkout_expires_at,
                 settlement_event.state as settlement_event_state,
                 settlement_event.reconciliation_code
                   as settlement_reconciliation_code,
                 receipt.id as payment_receipt_id,
                 receipt.checkout_attempt_id
                   as receipt_checkout_attempt_id,
                 receipt.payment_status as receipt_payment_status,
                 receipt.subtotal_minor as receipt_subtotal_minor,
                 receipt.tax_minor as receipt_tax_minor,
                 receipt.total_minor as receipt_total_minor,
                 receipt.currency as receipt_currency,
                 receipt.provider_facts_digest
                   as receipt_provider_facts_digest,
                 receipt.provider_paid_at
                   as receipt_provider_paid_at,
                 receipt.settled_at as receipt_settled_at,
                 assessment_job.id as assessment_job_id,
                 assessment_job.state as assessment_job_state,
                 assessment_job.opened_at
                   as assessment_job_opened_at,
                 assessment_job.delivery_date
                   as assessment_job_delivery_date
               from ss.service_invoices invoice
               join ss.service_quote_acceptances acceptance
                 on acceptance.organization_id = invoice.organization_id
                and acceptance.id = invoice.quote_acceptance_id
                and acceptance.quote_id = invoice.quote_id
                and acceptance.quote_revision = invoice.quote_revision
                and acceptance.customer_user_id = invoice.customer_user_id
               join ss.service_invoice_lines line
                 on line.organization_id = invoice.organization_id
                and line.invoice_id = invoice.id
                and line.line_number = 1
               join ss.service_payment_reservations reservation
                 on reservation.organization_id = invoice.organization_id
                and reservation.project_id = invoice.project_id
                and reservation.customer_user_id = invoice.customer_user_id
                and reservation.invoice_id = invoice.id
               join ss.organizations organization
                 on organization.id = invoice.organization_id
                and organization.state = 'active'
               join ss.projects project
                 on project.organization_id = invoice.organization_id
                and project.id = invoice.project_id
                and project.lifecycle = 'active'
               join ss.organization_memberships membership
                 on membership.organization_id = invoice.organization_id
                and membership.user_id = invoice.customer_user_id
                and membership.state = 'active'
                and membership.role in ('owner', 'admin')
               join auth.users account_user
                 on account_user.id = invoice.customer_user_id
                and account_user.disabled_at is null
               join ss.hosted_account_profiles account_profile
                 on account_profile.user_id = invoice.customer_user_id
                and account_profile.state = 'active'
               left join lateral (
                 select attempt.*
                   from ss.service_assessment_checkout_attempts attempt
                  where attempt.organization_id = invoice.organization_id
                    and attempt.invoice_id = invoice.id
                  order by attempt.created_at desc, attempt.id desc
                  limit 1
               ) checkout_attempt on true
               left join lateral (
                 select event.state,
                        event.reconciliation_code
                   from ss.service_assessment_stripe_events event
                  where event.organization_id = invoice.organization_id
                    and event.invoice_id = invoice.id
                  order by event.created_at desc, event.id desc
                  limit 1
               ) settlement_event on true
               left join ss.service_assessment_payment_receipts receipt
                 on receipt.organization_id = invoice.organization_id
                and receipt.invoice_id = invoice.id
               left join ss.service_assessment_jobs assessment_job
                 on assessment_job.organization_id = receipt.organization_id
                and assessment_job.payment_receipt_id = receipt.id
              where invoice.organization_id = $1
                and invoice.project_id = $2
                and invoice.customer_user_id = $3
              order by invoice.created_at desc, invoice.id desc
              limit 2`,
              [input.organizationId, input.projectId, input.customerId]
            ));
            return project(
              selected[0] ?? null,
              input,
              paymentRelease
            );
          }
        );
      } catch (error) {
        throw databaseError(error);
      }
    }
  });
}
