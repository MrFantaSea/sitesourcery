import { createHash, randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { ExternalEffectError } from "../domain/errors.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

export const CUSTOM_BUILD_CHANGE_PAYMENT_INVOICE_SCHEMA =
  "sitesourcery.custom-build-change-invoice/v1";
export const CUSTOM_BUILD_CHANGE_PAYMENT_CHECKOUT_SCHEMA =
  "sitesourcery.custom-build-change-checkout/v1";
export const CUSTOM_BUILD_CHANGE_PAYMENT_PURPOSE_SCHEMA =
  "sitesourcery.custom-build-change-checkout-purpose/v1";
export const CUSTOM_BUILD_CHANGE_PAYMENT_METADATA_SCHEMA =
  "sitesourcery_custom_build_change_checkout_v1";
export const CUSTOM_BUILD_CHANGE_PAYMENT_SETTLEMENT_SCHEMA =
  "sitesourcery.custom-build-change-settlement/v1";

const PAYMENT_FACTS_SCHEMA =
  "sitesourcery.stripe-custom-build-change-payment-facts/v1";
const LIFECYCLE_SCHEMA =
  "sitesourcery.stripe-custom-build-change-checkout-lifecycle/v1";
const READINESS_SCHEMA =
  "sitesourcery.custom-build-change-payment-readiness/v1";
const OWNER_SCHEMA =
  "sitesourcery.custom-build-change-payments-owner/v1";
const OWNER_RECONCILIATION_SCHEMA =
  "sitesourcery.custom-build-change-payment-reconciliation-command/v1";
const RUNTIME_CONTRACT =
  "canonical-ss-v45-custom-build-change-payment";
const CHECKOUT_ROUTE =
  "custom-services.custom-build-change-checkout";
const EVENT_TYPE = "checkout.session.completed";
// Stripe measures its 30-minute minimum from provider-side creation time.
// Retain one minute of submission margin while keeping a short-lived page.
const CHECKOUT_TTL_MILLISECONDS = 31 * 60 * 1000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const INVOICE_NUMBER = /^SSCB-CHG-[0-9A-F]{32}$/u;
const CHECKOUT_ID = /^cs_[A-Za-z0-9_]+$/u;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/u;
const STRIPE_CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_]+$/u;
const SAFE_CODE = /^[A-Za-z0-9._:-]{1,200}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

function exactKeys(value, expected, code, message, status = 400) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    code,
    message,
    { status }
  );
  return value;
}

function uuid(value, field, code = "invalid_input", status = 400) {
  invariant(
    typeof value === "string" && UUID.test(value),
    code,
    `${field} is invalid.`,
    { status }
  );
  return value;
}

function sha(value, field, code = "invalid_input", status = 400) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    code,
    `${field} is invalid.`,
    { status }
  );
  return value;
}

function integer(
  value,
  field,
  { zero = false, maximum = 99_999_999 } = {}
) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) &&
      selected >= (zero ? 0 : 1) &&
      selected <= maximum,
    "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function iso(value, field, code = "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT") {
  const selected = value instanceof Date
    ? value.toISOString()
    : value;
  invariant(
    typeof selected === "string" &&
      Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    code,
    `${field} is invalid.`,
    { status: code === "invalid_input" ? 400 : 500 }
  );
  return selected;
}

function date(value, field) {
  const selected = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value;
  invariant(
    typeof selected === "string" &&
      /^\d{4}-\d{2}-\d{2}$/u.test(selected) &&
      new Date(`${selected}T00:00:00.000Z`).toISOString().slice(0, 10) ===
        selected,
    "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function commandId(value) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      value.length >= 8 &&
      value.length <= 200 &&
      !CONTROL.test(value),
    "invalid_input",
    "commandId is invalid.",
    { status: 400 }
  );
  return value;
}

function actorId(value) {
  if (!value || !UUID.test(String(value.userId ?? ""))) {
    throw new HostedError(
      "AUTHENTICATION_REQUIRED",
      "Sign in before opening Custom-build change payment tools.",
      { status: 401 }
    );
  }
  return value.userId;
}

function customerScope(value) {
  exactKeys(
    value,
    ["actorId", "customerId", "organizationId", "projectId"],
    "invalid_input",
    "Custom-build change payment scope is invalid."
  );
  const customerId = uuid(value.customerId, "customerId");
  invariant(
    uuid(value.actorId, "actorId") === customerId,
    "project_unavailable",
    "That Custom-build project is unavailable.",
    { status: 404 }
  );
  return Object.freeze({
    actorId: customerId,
    customerId,
    organizationId: uuid(value.organizationId, "organizationId"),
    projectId: uuid(value.projectId, "projectId")
  });
}

function checkoutInput(value) {
  exactKeys(
    value,
    [
      "actorId",
      "commandId",
      "customerId",
      "invoiceDigest",
      "invoiceId",
      "organizationId",
      "projectId"
    ],
    "invalid_input",
    "Custom-build change Checkout request is invalid."
  );
  return Object.freeze({
    ...customerScope({
      actorId: value.actorId,
      customerId: value.customerId,
      organizationId: value.organizationId,
      projectId: value.projectId
    }),
    commandId: commandId(value.commandId),
    invoiceId: uuid(value.invoiceId, "invoiceId"),
    invoiceDigest: sha(value.invoiceDigest, "invoiceDigest")
  });
}

function ownerInput(actor, jobIdValue, value) {
  exactKeys(
    value,
    ["attemptId", "commandId", "organizationId"],
    "invalid_input",
    "Custom-build change reconciliation request is invalid."
  );
  return Object.freeze({
    operatorId: actorId(actor),
    jobId: uuid(jobIdValue, "jobId"),
    organizationId: uuid(value.organizationId, "organizationId"),
    attemptId: uuid(value.attemptId, "attemptId"),
    commandId: commandId(value.commandId)
  });
}

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Canonical PostgreSQL authority is required for Custom-build change payment.",
    { status: 500 }
  );
  return value;
}

function validateProvider(value) {
  invariant(
    value &&
      typeof value.createCustomBuildChangeCheckout === "function" &&
      typeof value.retrieveCustomBuildChangePayment === "function" &&
      typeof value.retrieveCustomBuildChangeCheckoutLifecycle === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Exact Stripe Custom-build change Checkout and readback are required.",
    { status: 500 }
  );
  return value;
}

function validateRelease(value) {
  exactKeys(
    value,
    [
      "approved",
      "currency",
      "holdScope",
      "providerEffectProcessing",
      "taxMode"
    ],
    "RUNTIME_CONFIGURATION_ERROR",
    "Custom-build change payment release is invalid.",
    500
  );
  invariant(
    typeof value.approved === "boolean" &&
      value.currency === "USD" &&
      value.holdScope === "new_checkout_creation_only" &&
      value.providerEffectProcessing ===
        "settlement_and_reconciliation_continue" &&
      value.taxMode === "automatic",
    "RUNTIME_CONFIGURATION_ERROR",
    "Custom-build change payment release must preserve automatic-tax USD billing.",
    { status: 500 }
  );
  return Object.freeze({ ...value });
}

function validateClock(value) {
  const selected = value ?? { now: () => new Date().toISOString() };
  invariant(
    typeof selected.now === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "A Custom-build change payment clock is required.",
    { status: 500 }
  );
  return selected;
}

function validateIds(value) {
  const selected = value ?? { next: () => systemRandomUUID() };
  invariant(
    typeof selected.next === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Custom-build change payment IDs are required.",
    { status: 500 }
  );
  return selected;
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (
    [
      "22001",
      "22P02",
      "23502",
      "23503",
      "23505",
      "23514",
      "40001",
      "40P01",
      "42501",
      "55000"
    ].includes(error?.code)
  ) {
    return new HostedError(
      "CUSTOM_BUILD_CHANGE_PAYMENT_REPOSITORY_CONFLICT",
      "The Custom-build change payment record rejected inconsistent evidence.",
      { status: 500 }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw databaseError(error);
  }
}

function providerCode(error, fallback) {
  const selected = String(error?.code ?? "");
  return SAFE_CODE.test(selected) ? selected : fallback;
}

function requestDigest(input) {
  return digest({ route: CHECKOUT_ROUTE, ...input });
}

function checkoutRequestExpiration(clock) {
  const now = iso(clock.now(), "Payment clock");
  const expiresAt = new Date(
    Math.floor(Date.parse(now) / 1000) * 1000 +
      CHECKOUT_TTL_MILLISECONDS
  ).toISOString();
  invariant(
    Date.parse(expiresAt) > Date.parse(now),
    "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
    "The Custom-build change Checkout expiration is invalid.",
    { status: 500 }
  );
  return expiresAt;
}

async function discoverAndLockJob(
  client,
  { text, values, expectedJobId = null, code, message, status }
) {
  const discovered = await client.query(text, values);
  invariant(
    discovered.rowCount === 1 &&
      UUID.test(String(discovered.rows[0].job_id ?? "")) &&
      (expectedJobId === null ||
        discovered.rows[0].job_id === expectedJobId),
    code,
    message,
    { status }
  );
  const jobId = discovered.rows[0].job_id;
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`ss-custom-build-h1m:${jobId}`]
  );
  return jobId;
}

function purposeFromRow(row) {
  invariant(
    row &&
      UUID.test(String(row.organization_id ?? "")) &&
      UUID.test(String(row.customer_user_id ?? "")) &&
      UUID.test(String(row.project_id ?? "")) &&
      UUID.test(String(row.job_id ?? "")) &&
      UUID.test(String(row.change_order_id ?? "")) &&
      UUID.test(String(row.change_acceptance_id ?? "")) &&
      UUID.test(String(row.invoice_id ?? row.id ?? "")) &&
      INVOICE_NUMBER.test(String(row.invoice_number ?? "")) &&
      SHA256.test(String(row.scope_boundary_digest ?? "")) &&
      SHA256.test(String(row.prior_effective_scope_digest ?? "")) &&
      SHA256.test(String(row.accepted_quote_digest ?? "")) &&
      SHA256.test(String(row.accepted_disclosure_digest ?? "")) &&
      SHA256.test(String(row.invoice_digest ?? "")),
    "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
    "The retained Custom-build change invoice purpose is incomplete.",
    { status: 500 }
  );
  const amountMinor = integer(row.subtotal_minor, "invoice subtotal");
  invariant(
    amountMinor % 12500 === 0,
    "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
    "The retained Custom-build change invoice quantity is invalid.",
    { status: 500 }
  );
  const quantity = integer(
    amountMinor / 12500,
    "invoice quantity",
    { maximum: 40 }
  );
  return deepFreeze({
    schema: CUSTOM_BUILD_CHANGE_PAYMENT_PURPOSE_SCHEMA,
    tenantId: row.organization_id,
    customerId: row.customer_user_id,
    projectId: row.project_id,
    jobId: row.job_id,
    changeOrderId: row.change_order_id,
    changeAcceptanceId: row.change_acceptance_id,
    changeNumber: integer(row.change_number, "change number", { maximum: 100000 }),
    invoiceId: row.invoice_id ?? row.id,
    invoiceNumber: row.invoice_number,
    scopeBoundaryDigest: row.scope_boundary_digest,
    priorEffectiveScopeDigest: row.prior_effective_scope_digest,
    targetCompletionDate: date(
      row.target_completion_date,
      "target completion date"
    ),
    acceptedQuoteDigest: row.accepted_quote_digest,
    acceptedDisclosureDigest: row.accepted_disclosure_digest,
    invoiceDigest: row.invoice_digest,
    price: {
      amountMinor,
      unitAmountMinor: 12500,
      quantity,
      currency: "USD",
      billing: "one_time",
      taxBehavior: "automatic_exclusive"
    }
  });
}

function expectedMetadata(purpose, purposeDigest) {
  return Object.freeze({
    schema: CUSTOM_BUILD_CHANGE_PAYMENT_METADATA_SCHEMA,
    tenant_id: purpose.tenantId,
    customer_id: purpose.customerId,
    project_id: purpose.projectId,
    job_id: purpose.jobId,
    change_order_id: purpose.changeOrderId,
    change_acceptance_id: purpose.changeAcceptanceId,
    change_number: String(purpose.changeNumber),
    invoice_id: purpose.invoiceId,
    invoice_number: purpose.invoiceNumber,
    scope_boundary_digest: purpose.scopeBoundaryDigest,
    prior_effective_scope_digest: purpose.priorEffectiveScopeDigest,
    target_completion_date: purpose.targetCompletionDate,
    accepted_quote_digest: purpose.acceptedQuoteDigest,
    accepted_disclosure_digest: purpose.acceptedDisclosureDigest,
    invoice_digest: purpose.invoiceDigest,
    purpose_digest: purposeDigest
  });
}

function exactMetadata(value, purpose, purposeDigest, code) {
  const expected = expectedMetadata(purpose, purposeDigest);
  exactKeys(
    value,
    Object.keys(expected),
    code,
    "The verified Stripe metadata does not match the retained Custom-build change invoice."
  );
  invariant(
    Object.entries(expected).every(([key, selected]) => value[key] === selected),
    code,
    "The verified Stripe metadata does not match the retained Custom-build change invoice.",
    { status: 400 }
  );
  return expected;
}

function checkoutEvidence(value, expectedExpiresAt, clock) {
  const retainedExpiration = iso(
    expectedExpiresAt,
    "Retained Checkout expiration"
  );
  const observedExpiration = iso(
    value?.expiresAt,
    "Stripe Checkout expiration",
    "CUSTOM_BUILD_CHANGE_CHECKOUT_PROVIDER_RESPONSE_INVALID"
  );
  invariant(
    value &&
      CHECKOUT_ID.test(String(value.checkoutId ?? "")) &&
      typeof value.url === "string" &&
      value.url.length <= 2000 &&
      observedExpiration === retainedExpiration,
    "CUSTOM_BUILD_CHANGE_CHECKOUT_PROVIDER_RESPONSE_INVALID",
    "Stripe returned unsafe Custom-build change Checkout evidence.",
    { status: 502 }
  );
  let parsed;
  try {
    parsed = new URL(value.url);
  } catch {
    parsed = null;
  }
  invariant(
    parsed?.protocol === "https:" &&
      parsed.hostname === "checkout.stripe.com" &&
      !parsed.username &&
      !parsed.password &&
      Date.parse(observedExpiration) >
        Date.parse(iso(clock.now(), "Payment clock")),
    "CUSTOM_BUILD_CHANGE_CHECKOUT_PROVIDER_RESPONSE_INVALID",
    "Stripe returned unsafe Custom-build change Checkout evidence.",
    { status: 502 }
  );
  return Object.freeze({
    checkoutId: value.checkoutId,
    url: parsed.toString(),
    expiresAt: observedExpiration
  });
}

function checkoutResponse(row) {
  invariant(
    row &&
      row.state === "ready" &&
      CHECKOUT_ID.test(String(row.checkout_session_id ?? "")) &&
      typeof row.checkout_url === "string" &&
      Number.isFinite(Date.parse(row.expires_at)),
    "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
    "The retained Custom-build change Checkout is incomplete.",
    { status: 500 }
  );
  return deepFreeze({
    schema: CUSTOM_BUILD_CHANGE_PAYMENT_CHECKOUT_SCHEMA,
    state: "ready",
    checkout: {
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      changeOrderId: row.change_order_id,
      url: row.checkout_url,
      expiresAt: iso(row.expires_at, "Checkout expiration"),
      subtotal: {
        amountMinor: integer(row.expected_subtotal_minor, "Checkout subtotal"),
        currency: "USD"
      },
      tax: { amountMinor: null, state: "calculated_at_checkout" },
      total: { amountMinor: null, currency: "USD", state: "shown_at_checkout" },
      chargeOccurred: false
    }
  });
}

function invoiceProjection(row, release) {
  if (!row) {
    return deepFreeze({
      schema: CUSTOM_BUILD_CHANGE_PAYMENT_INVOICE_SCHEMA,
      state: "not_available",
      invoice: null,
      action: { available: false, reason: "invoice_not_available" }
    });
  }
  const lines = Array.isArray(row.lines) ? row.lines : [];
  const paid = row.receipt_id !== null;
  const ready = row.checkout_state === "ready" &&
    Date.parse(iso(row.checkout_expires_at, "Checkout expiration")) > Date.now();
  const reconciliation =
    ["provider_pending", "persistence_unknown"].includes(
      row.checkout_state
    ) ||
    row.event_state === "reconciliation_required";
  invariant(
    INVOICE_NUMBER.test(String(row.invoice_number ?? "")) &&
      SHA256.test(String(row.invoice_digest ?? "")) &&
      SHA256.test(String(row.accepted_quote_digest ?? "")) &&
      SHA256.test(String(row.accepted_disclosure_digest ?? "")) &&
      UUID.test(String(row.change_acceptance_id ?? "")) &&
      lines.length === 1 &&
      lines[0].lineNumber === 1 &&
      lines[0].componentKey === "custom_build_change_units" &&
      Number(lines[0].quantity) === Number(row.unit_count) &&
      Number(lines[0].unitAmountMinor) === 12500 &&
      Number(lines[0].amountMinor) === Number(row.subtotal_minor) &&
      (!paid || (
        row.receipt_linkage_valid === true &&
        row.change_state === "effective" &&
        row.checkout_state === "paid"
      )),
    "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
    "The retained Custom-build change invoice is inconsistent.",
    { status: 500 }
  );
  const state = paid
    ? "paid"
    : row.change_state === "voided"
      ? "voided"
      : reconciliation
        ? "reconciliation_required"
        : ready
          ? "checkout_ready"
          : row.checkout_state === "ready"
            ? "checkout_expired"
            : release.approved
              ? "checkout_available"
              : "payment_held";
  return deepFreeze({
    schema: CUSTOM_BUILD_CHANGE_PAYMENT_INVOICE_SCHEMA,
    state,
    invoice: {
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      invoiceDigest: row.invoice_digest,
      changeOrderId: row.change_order_id,
      changeAcceptanceId: row.change_acceptance_id,
      changeNumber: Number(row.change_number),
      acceptedQuoteDigest: row.accepted_quote_digest,
      acceptedDisclosureDigest: row.accepted_disclosure_digest,
      issuedAt: iso(row.issued_at, "Invoice issue time"),
      targetCompletionDate: date(
        row.target_completion_date,
        "target completion date"
      ),
      lines: lines.map((line) => Object.freeze({
        lineNumber: Number(line.lineNumber),
        componentKey: line.componentKey,
        displayName: line.displayName,
        quantity: Number(line.quantity),
        unitAmountMinor: Number(line.unitAmountMinor),
        amountMinor: Number(line.amountMinor),
        currency: "USD"
      })),
      subtotal: {
        amountMinor: integer(row.subtotal_minor, "Invoice subtotal"),
        currency: "USD"
      },
      tax: paid
        ? {
            amountMinor: integer(row.tax_minor, "Receipt tax", { zero: true }),
            state: "settled"
          }
        : { amountMinor: null, state: "calculated_at_checkout" },
      total: paid
        ? {
            amountMinor: integer(row.total_minor, "Receipt total"),
            currency: "USD",
            state: "settled"
          }
        : { amountMinor: null, currency: "USD", state: "shown_at_checkout" },
      payment: {
        chargeOccurred: paid,
        checkoutUrl: ready ? row.checkout_url : null,
        checkoutExpiresAt: ready
          ? iso(row.checkout_expires_at, "Checkout expiration")
          : null,
        settledAt: paid ? iso(row.settled_at, "Settlement time") : null
      }
    },
    action: {
      available: state === "checkout_available",
      reason: state === "checkout_available" ? null : state
    }
  });
}

const INVOICE_SELECT = `
  select
    invoice.id as invoice_id,
    invoice.organization_id,
    invoice.project_id,
    invoice.case_id,
    invoice.customer_user_id,
    invoice.job_id,
    invoice.change_order_id,
    invoice.change_acceptance_id,
    invoice.change_number,
    invoice.invoice_number,
    invoice.policy_id,
    invoice.scope_boundary_digest,
    invoice.accepted_quote_digest,
    invoice.accepted_disclosure_digest,
    invoice.prior_effective_scope_digest,
    invoice.target_completion_date::text,
    invoice.subtotal_minor,
    invoice.currency,
    invoice.invoice_digest,
    invoice.issued_at,
    change_order.unit_count,
    change_order.state as change_state,
    attempt.id as checkout_attempt_id,
    attempt.command_id as checkout_command_id,
    attempt.state as checkout_state,
    attempt.provider_effect_certainty,
    attempt.provider_error_code,
    attempt.provider_request_expires_at,
    attempt.purpose_digest,
    attempt.checkout_session_id,
    attempt.checkout_url,
    attempt.expires_at as checkout_expires_at,
    event.id as event_id,
    event.state as event_state,
    event.reconciliation_code,
    receipt.id as receipt_id,
    receipt.receipt_source,
    receipt.tax_minor,
    receipt.total_minor,
    receipt.settled_at,
    (
      receipt.id is not null
      and receipt.project_id = invoice.project_id
      and receipt.case_id = invoice.case_id
      and receipt.customer_user_id = invoice.customer_user_id
      and receipt.job_id = invoice.job_id
      and receipt.change_order_id = invoice.change_order_id
      and receipt.change_acceptance_id = invoice.change_acceptance_id
      and receipt.invoice_id = invoice.id
      and receipt.checkout_attempt_id = attempt.id
      and receipt.provider = 'stripe'
      and receipt.receipt_source in ('stripe_event', 'provider_readback')
      and receipt.checkout_session_id = attempt.checkout_session_id
      and receipt.payment_status = 'paid'
      and receipt.subtotal_minor = invoice.subtotal_minor
      and receipt.currency = invoice.currency
      and receipt.purpose_digest = attempt.purpose_digest
      and receipt.invoice_digest = invoice.invoice_digest
      and receipt.accepted_quote_digest = invoice.accepted_quote_digest
      and receipt.accepted_disclosure_digest =
        invoice.accepted_disclosure_digest
    ) as receipt_linkage_valid,
    coalesce(line_rows.items, '[]'::jsonb) as lines
  from ss.service_custom_build_change_invoices invoice
  join ss.service_custom_build_change_orders change_order
    on change_order.organization_id = invoice.organization_id
   and change_order.id = invoice.change_order_id
  left join lateral (
    select candidate.*
    from ss.service_custom_build_change_checkout_attempts candidate
    where candidate.organization_id = invoice.organization_id
      and candidate.invoice_id = invoice.id
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) attempt on true
  left join lateral (
    select candidate.*
    from ss.service_custom_build_change_stripe_events candidate
    where candidate.organization_id = invoice.organization_id
      and candidate.invoice_id = invoice.id
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) event on true
  left join ss.service_custom_build_change_payment_receipts receipt
    on receipt.organization_id = invoice.organization_id
   and receipt.invoice_id = invoice.id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'amountMinor', line.amount_minor,
      'componentKey', line.component_key,
      'displayName', line.display_name,
      'lineNumber', line.line_number,
      'quantity', line.quantity,
      'unitAmountMinor', line.unit_amount_minor
    ) order by line.line_number) as items
    from ss.service_custom_build_change_invoice_lines line
    where line.organization_id = invoice.organization_id
      and line.invoice_id = invoice.id
  ) line_rows on true`;

function exactVerifiedEvent(value, clock) {
  invariant(
    value &&
      EVENT_ID.test(String(value.id ?? "")) &&
      value.type === EVENT_TYPE &&
      typeof value.livemode === "boolean" &&
      typeof value.api_version === "string" &&
      value.api_version.length >= 3 &&
      value.api_version.length <= 100 &&
      Number.isSafeInteger(value.created) &&
      value.created > 0 &&
      value.data?.object &&
      typeof value.data.object === "object" &&
      !Array.isArray(value.data.object) &&
      CHECKOUT_ID.test(String(value.data.object.id ?? "")),
    "STRIPE_EVENT_INVALID",
    "The verified Custom-build change Stripe event is invalid.",
    { status: 400 }
  );
  const metadata = structuredClone(value.data.object.metadata);
  const expectedKeys = [
    "accepted_disclosure_digest",
    "accepted_quote_digest",
    "change_acceptance_id",
    "change_number",
    "change_order_id",
    "customer_id",
    "invoice_digest",
    "invoice_id",
    "invoice_number",
    "job_id",
    "prior_effective_scope_digest",
    "project_id",
    "purpose_digest",
    "schema",
    "scope_boundary_digest",
    "target_completion_date",
    "tenant_id"
  ];
  exactKeys(
    metadata,
    expectedKeys,
    "STRIPE_EVENT_INVALID",
    "The verified Custom-build change Stripe metadata is invalid."
  );
  invariant(
    metadata.schema === CUSTOM_BUILD_CHANGE_PAYMENT_METADATA_SCHEMA &&
      [
        metadata.tenant_id,
        metadata.customer_id,
        metadata.project_id,
        metadata.job_id,
        metadata.change_order_id,
        metadata.change_acceptance_id,
        metadata.invoice_id
      ].every((entry) => UUID.test(String(entry ?? ""))) &&
      /^\d{1,6}$/u.test(String(metadata.change_number ?? "")) &&
      INVOICE_NUMBER.test(String(metadata.invoice_number ?? "")) &&
      /^\d{4}-\d{2}-\d{2}$/u.test(
        String(metadata.target_completion_date ?? "")
      ) &&
      [
        metadata.scope_boundary_digest,
        metadata.prior_effective_scope_digest,
        metadata.accepted_quote_digest,
        metadata.accepted_disclosure_digest,
        metadata.invoice_digest,
        metadata.purpose_digest
      ].every((entry) => SHA256.test(String(entry ?? ""))),
    "STRIPE_EVENT_INVALID",
    "The verified Custom-build change Stripe metadata is invalid.",
    { status: 400 }
  );
  const signatureVerifiedAt = iso(
    clock.now(),
    "Stripe signature verification time",
    "STRIPE_EVENT_INVALID"
  );
  const providerCreatedAt = new Date(value.created * 1000).toISOString();
  invariant(
    Date.parse(signatureVerifiedAt) >= Date.parse(providerCreatedAt),
    "STRIPE_EVENT_INVALID",
    "Stripe signature verification time precedes the event.",
    { status: 400 }
  );
  return deepFreeze({
    eventId: value.id,
    eventType: value.type,
    livemode: value.livemode,
    apiVersion: value.api_version,
    checkoutSessionId: value.data.object.id,
    metadata,
    payloadDigest: createHash("sha256")
      .update(JSON.stringify(value), "utf8")
      .digest("hex"),
    providerCreatedAt,
    signatureVerifiedAt
  });
}

function settlementResult(value, expected = {}) {
  exactKeys(
    value,
    [
      "changeOrderId",
      "invoiceId",
      "next",
      "projectId",
      "receiptId",
      "schema",
      "status"
    ],
    "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
    "The retained Custom-build change settlement result is invalid.",
    500
  );
  invariant(
    value.schema === CUSTOM_BUILD_CHANGE_PAYMENT_SETTLEMENT_SCHEMA &&
      value.status === "payment_settled" &&
      value.next === "custom_build_changed_work" &&
      [
        value.projectId,
        value.changeOrderId,
        value.invoiceId,
        value.receiptId
      ].every((entry) => UUID.test(String(entry ?? ""))) &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
    "The retained Custom-build change settlement result changed.",
    { status: 500 }
  );
  return deepFreeze(structuredClone(value));
}

function reconciliationResult(resolution) {
  return deepFreeze({
    schema: "sitesourcery.custom-build-change-reconciliation/v1",
    status: "reconciliation_required",
    projectId: resolution.projectId,
    changeOrderId: resolution.changeOrderId,
    invoiceId: resolution.invoiceId,
    next: "owner_review"
  });
}

const OWNER_RECONCILIATION_STATES = Object.freeze({
  checkout_ready: Object.freeze({
    action: "creation_reconciled",
    next: "customer_checkout"
  }),
  payment_settled: Object.freeze({
    action: "settlement_reconciled",
    next: "custom_build_changed_work"
  }),
  checkout_expired: Object.freeze({
    action: "attempt_expired",
    next: "new_checkout_command"
  }),
  reconciliation_required: Object.freeze({
    action: "retry_required",
    next: "owner_retry"
  })
});

function ownerReconciliationResult({
  status,
  resolution,
  checkout = null,
  settlement = null,
  reason = null
}) {
  const state = OWNER_RECONCILIATION_STATES[status];
  invariant(
    state &&
      resolution &&
      [
        resolution.organizationId,
        resolution.jobId,
        resolution.attemptId,
        resolution.invoiceId,
        resolution.changeOrderId
      ].every((entry) => UUID.test(String(entry ?? ""))) &&
      (reason === null || SAFE_CODE.test(reason)) &&
      (status === "checkout_ready"
        ? checkout?.schema === CUSTOM_BUILD_CHANGE_PAYMENT_CHECKOUT_SCHEMA &&
          checkout?.state === "ready" && settlement === null
        : checkout === null) &&
      (status === "payment_settled"
        ? settlement?.schema ===
            CUSTOM_BUILD_CHANGE_PAYMENT_SETTLEMENT_SCHEMA &&
          settlement?.status === "payment_settled"
        : settlement === null),
    "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
    "The Custom-build change reconciliation result is invalid.",
    { status: 500 }
  );
  return deepFreeze({
    schema: OWNER_RECONCILIATION_SCHEMA,
    status,
    organizationId: resolution.organizationId,
    jobId: resolution.jobId,
    attemptId: resolution.attemptId,
    invoiceId: resolution.invoiceId,
    changeOrderId: resolution.changeOrderId,
    action: state.action,
    next: state.next,
    reason,
    checkout,
    settlement
  });
}

function retainedOwnerReconciliationResult(value, expected) {
  exactKeys(
    value,
    [
      "action",
      "attemptId",
      "changeOrderId",
      "checkout",
      "invoiceId",
      "jobId",
      "next",
      "organizationId",
      "reason",
      "schema",
      "settlement",
      "status"
    ],
    "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
    "The retained Custom-build change reconciliation result is invalid.",
    500
  );
  invariant(
    value.schema === OWNER_RECONCILIATION_SCHEMA &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
    "The retained Custom-build change reconciliation result changed.",
    { status: 500 }
  );
  return ownerReconciliationResult({
    status: value.status,
    resolution: value,
    checkout: value.checkout,
    settlement: value.settlement,
    reason: value.reason
  });
}

function exactPaymentFacts(value, resolution) {
  exactKeys(
    value,
    [
      "checkoutSessionId",
      "currency",
      "customerId",
      "paymentIntentId",
      "paymentStatus",
      "provider",
      "providerFactsDigest",
      "providerPaymentTime",
      "purposeDigest",
      "schema",
      "subtotalMinor",
      "taxMinor",
      "taxMode",
      "totalMinor"
    ],
    "CUSTOM_BUILD_CHANGE_PAYMENT_EVIDENCE_INVALID",
    "Stripe Custom-build change payment evidence is invalid.",
    502
  );
  const facts = structuredClone(value);
  const retainedDigest = facts.providerFactsDigest;
  delete facts.providerFactsDigest;
  invariant(
    value.schema === PAYMENT_FACTS_SCHEMA &&
      value.provider === "stripe" &&
      value.checkoutSessionId === resolution.checkoutSessionId &&
      CHECKOUT_ID.test(value.checkoutSessionId) &&
      PAYMENT_INTENT_ID.test(String(value.paymentIntentId ?? "")) &&
      STRIPE_CUSTOMER_ID.test(String(value.customerId ?? "")) &&
      value.paymentStatus === "paid" &&
      value.subtotalMinor === resolution.purpose.price.amountMinor &&
      Number.isSafeInteger(value.taxMinor) &&
      value.taxMinor >= 0 &&
      value.totalMinor === value.subtotalMinor + value.taxMinor &&
      value.taxMode === "automatic" &&
      value.currency === "USD" &&
      value.purposeDigest === resolution.purposeDigest &&
      SHA256.test(String(retainedDigest ?? "")) &&
      digest(facts) === retainedDigest &&
      Number.isFinite(Date.parse(value.providerPaymentTime)),
    "CUSTOM_BUILD_CHANGE_PAYMENT_EVIDENCE_INVALID",
    "Stripe did not confirm the exact Custom-build change payment.",
    { status: 502 }
  );
  return deepFreeze(structuredClone(value));
}

function exactLifecycle(value, resolution) {
  exactKeys(
    value,
    ["checkoutSessionId", "provider", "purposeDigest", "schema", "state"],
    "CUSTOM_BUILD_CHANGE_CHECKOUT_LIFECYCLE_INVALID",
    "Stripe Custom-build change Checkout lifecycle is invalid.",
    502
  );
  invariant(
    value.schema === LIFECYCLE_SCHEMA &&
      value.provider === "stripe" &&
      value.checkoutSessionId === resolution.checkoutSessionId &&
      value.purposeDigest === resolution.purposeDigest &&
      ["open", "expired", "paid"].includes(value.state),
    "CUSTOM_BUILD_CHANGE_CHECKOUT_LIFECYCLE_INVALID",
    "Stripe Custom-build change Checkout lifecycle changed.",
    { status: 502 }
  );
  return deepFreeze(structuredClone(value));
}

function paymentResolutionFromRow(row) {
  const purpose = purposeFromRow(row);
  const purposeDigest = digest(purpose);
  const attemptId = row.attempt_id ?? row.checkout_attempt_id;
  invariant(
    row.purpose_digest === purposeDigest &&
      [
        row.organization_id,
        row.project_id,
        row.case_id,
        row.customer_user_id,
        row.job_id,
        row.change_order_id,
        row.change_acceptance_id,
        row.invoice_id,
        attemptId
      ].every((entry) => UUID.test(String(entry ?? ""))) &&
      CHECKOUT_ID.test(String(row.checkout_session_id ?? "")),
    "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
    "The retained Custom-build change payment resolution is invalid.",
    { status: 500 }
  );
  return deepFreeze({
    organizationId: row.organization_id,
    projectId: row.project_id,
    caseId: row.case_id,
    customerId: row.customer_user_id,
    jobId: row.job_id,
    changeOrderId: row.change_order_id,
    changeAcceptanceId: row.change_acceptance_id,
    invoiceId: row.invoice_id,
    attemptId,
    checkoutSessionId: row.checkout_session_id,
    purpose,
    purposeDigest
  });
}

export function isPotentialCustomBuildChangePaymentStripeEvent(event) {
  return event?.type === EVENT_TYPE &&
    event?.data?.object?.metadata?.schema ===
      CUSTOM_BUILD_CHANGE_PAYMENT_METADATA_SCHEMA;
}

function held() {
  throw new HostedError(
    "CUSTOM_BUILD_CHANGE_PAYMENT_HELD",
    "Custom-build change payment is held in this runtime.",
    { status: 503 }
  );
}

export function createHeldCustomServicesCustomBuildChangePayment() {
  return Object.freeze({
    async readiness() {
      return deepFreeze({
        schema: READINESS_SCHEMA,
        ready: false,
        state: "held"
      });
    },
    async readCurrentInvoice(value) {
      customerScope(value);
      return held();
    },
    async readOwnerPayments(actor, jobIdValue, organizationIdValue) {
      actorId(actor);
      uuid(jobIdValue, "jobId");
      uuid(organizationIdValue, "organizationId");
      return held();
    },
    async createCheckout(value) {
      checkoutInput(value);
      return held();
    },
    async reconcileCheckoutCreation(actor, jobIdValue, value) {
      ownerInput(actor, jobIdValue, value);
      return held();
    },
    async reconcileExpiredCheckout(value) {
      checkoutInput(value);
      return held();
    },
    async ingestStripeEvent() {
      return held();
    }
  });
}

export function createPostgresCustomServicesCustomBuildChangePayment({
  authority,
  provider,
  release,
  clock,
  ids
} = {}) {
  const database = validateAuthority(authority);
  const paymentProvider = validateProvider(provider);
  const paymentRelease = validateRelease(release);
  const paymentClock = validateClock(clock);
  const paymentIds = validateIds(ids);

  async function readCurrentInvoice(value) {
    const scope = customerScope(value);
    return translated(() => database.service(
      {
        actorKind: "customer",
        userId: scope.customerId,
        organizationId: scope.organizationId,
        readOnly: true
      },
      async (client) => {
        const selected = await client.query(
          `${INVOICE_SELECT}
           where invoice.organization_id = $1
             and invoice.project_id = $2
             and invoice.customer_user_id = $3
           order by invoice.issued_at desc, invoice.id desc
           limit 1`,
          [scope.organizationId, scope.projectId, scope.customerId]
        );
        invariant(
          selected.rowCount <= 1,
          "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
          "The Custom-build change invoice conflicts.",
          { status: 500 }
        );
        return invoiceProjection(
          selected.rows[0] ?? null,
          paymentRelease
        );
      }
    ));
  }

  async function readOwnerPayments(
    actor,
    jobIdValue,
    organizationIdValue
  ) {
    const operatorId = actorId(actor);
    const jobId = uuid(jobIdValue, "jobId");
    const organizationId = uuid(
      organizationIdValue,
      "organizationId"
    );
    return translated(() => database.service(
      {
        actorKind: "operator",
        userId: operatorId,
        organizationId,
        readOnly: true
      },
      async (client) => {
        const capability = await client.query(
          `select ss.service_operator_has_capability(
             $1, 'service_payment_reconcile', clock_timestamp()
           ) as allowed`,
          [operatorId]
        );
        invariant(
          capability.rows[0]?.allowed === true,
          "CUSTOM_BUILD_CHANGE_PAYMENT_UNAVAILABLE",
          "That Custom-build change payment is unavailable.",
          { status: 404 }
        );
        const selected = await client.query(
          `${INVOICE_SELECT}
           where invoice.organization_id = $1
             and invoice.job_id = $2
           order by invoice.change_number, invoice.id`,
          [organizationId, jobId]
        );
        return deepFreeze({
          schema: OWNER_SCHEMA,
          organizationId,
          jobId,
          payments: selected.rows.map((row) => ({
            ...invoiceProjection(row, paymentRelease),
            owner: {
              attemptId: row.checkout_attempt_id,
              attemptState: row.checkout_state,
              providerEffectCertainty:
                row.provider_effect_certainty,
              providerErrorCode: row.provider_error_code,
              providerRequestExpiresAt:
                row.provider_request_expires_at === null
                  ? null
                  : iso(
                      row.provider_request_expires_at,
                      "Provider-request expiration"
                    ),
              eventId: row.event_id,
              eventState: row.event_state,
              reconciliationCode: row.reconciliation_code,
              receiptSource: row.receipt_source,
              canReconcileCreation:
                ["provider_pending", "persistence_unknown"].includes(
                  row.checkout_state
                ),
              canReconcileSettlement:
                row.checkout_state === "ready" && row.receipt_id === null
            }
          }))
        });
      }
    ));
  }

  async function stageCheckout(input) {
    return translated(() => database.service(
      {
        actorKind: "customer",
        userId: input.customerId,
        organizationId: input.organizationId
      },
      async (client) => {
        const jobId = await discoverAndLockJob(client, {
          text: `select job_id
                 from ss.service_custom_build_change_invoices
                 where organization_id = $1
                   and project_id = $2
                   and customer_user_id = $3
                   and id = $4`,
          values: [
            input.organizationId,
            input.projectId,
            input.customerId,
            input.invoiceId
          ],
          code: "CUSTOM_BUILD_CHANGE_INVOICE_UNAVAILABLE",
          message: "The Custom-build change invoice is unavailable.",
          status: 404
        });
        const selectedDigest = requestDigest(input);
        const prior = await client.query(
          `select * from ss.idempotency_keys
           where principal_id = $1
             and route_key = $2
             and idempotency_key = $3
           for update`,
          [input.customerId, CHECKOUT_ROUTE, input.commandId]
        );
        if (prior.rowCount === 1) {
          invariant(
            prior.rows[0].request_digest === selectedDigest,
            "idempotency_conflict",
            "That Custom-build change payment command was already used differently.",
            { status: 409 }
          );
          if (prior.rows[0].state === "completed") {
            return {
              status: "replay",
              result: deepFreeze(
                structuredClone(prior.rows[0].response_body)
              )
            };
          }
          throw new HostedError(
            "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
            "An earlier Custom-build change payment command has not reached a safe final state.",
            { status: 503 }
          );
        }
        invariant(
          prior.rowCount === 0,
          "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
          "The Custom-build change payment command conflicts.",
          { status: 500 }
        );

        const invoiceResult = await client.query(
          `select invoice.*, change_order.state as change_state,
                  customer.stripe_customer_id,
                  receipt.id as receipt_id
           from ss.service_custom_build_change_invoices invoice
           join ss.service_custom_build_change_orders change_order
             on change_order.organization_id = invoice.organization_id
            and change_order.id = invoice.change_order_id
           left join ss.stripe_customers customer
             on customer.organization_id = invoice.organization_id
           left join ss.service_custom_build_change_payment_receipts receipt
             on receipt.organization_id = invoice.organization_id
            and receipt.invoice_id = invoice.id
           where invoice.organization_id = $1
             and invoice.project_id = $2
             and invoice.customer_user_id = $3
             and invoice.id = $4
           for update of change_order`,
          [
            input.organizationId,
            input.projectId,
            input.customerId,
            input.invoiceId
          ]
        );
        invariant(
          invoiceResult.rowCount === 1,
          "CUSTOM_BUILD_CHANGE_INVOICE_UNAVAILABLE",
          "The Custom-build change invoice is unavailable.",
          { status: 404 }
        );
        const invoice = invoiceResult.rows[0];
        invariant(
          invoice.invoice_digest === input.invoiceDigest &&
            invoice.change_state === "accepted_payment_required" &&
            invoice.receipt_id === null,
          "CUSTOM_BUILD_CHANGE_INVOICE_CHANGED",
          "The Custom-build change invoice is no longer payable.",
          { status: 409 }
        );

        const active = await client.query(
          `select attempt.*, invoice.invoice_number
           from ss.service_custom_build_change_checkout_attempts attempt
           join ss.service_custom_build_change_invoices invoice
             on invoice.organization_id = attempt.organization_id
            and invoice.id = attempt.invoice_id
           where attempt.organization_id = $1
             and attempt.invoice_id = $2
             and attempt.state in (
               'provider_pending', 'ready', 'persistence_unknown', 'paid'
             )
           for update of attempt`,
          [input.organizationId, input.invoiceId]
        );
        invariant(
          active.rowCount <= 1,
          "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
          "More than one Custom-build change Checkout is active.",
          { status: 500 }
        );
        if (active.rowCount === 1) {
          const attempt = active.rows[0];
          if (
            attempt.state === "ready" &&
            Date.parse(iso(attempt.expires_at, "Checkout expiration")) >
              Date.parse(iso(paymentClock.now(), "Payment clock"))
          ) {
            const result = checkoutResponse(attempt);
            await client.query(
              `insert into ss.idempotency_keys (
                 id, organization_id, principal_id, route_key,
                 idempotency_key, request_digest, state,
                 response_status, response_body, resource_type,
                 resource_id, created_at, expires_at
               ) values (
                 $1, $2, $3, $4, $5, $6, 'completed',
                 201, $7::jsonb, 'custom_build_change_checkout',
                 $8, clock_timestamp(), clock_timestamp() + interval '24 hours'
               )`,
              [
                uuid(
                  paymentIds.next("change_checkout_replay_command"),
                  "command ID",
                  "RUNTIME_CONFIGURATION_ERROR",
                  500
                ),
                input.organizationId,
                input.customerId,
                CHECKOUT_ROUTE,
                input.commandId,
                selectedDigest,
                JSON.stringify(result),
                attempt.id
              ]
            );
            return { status: "replay", result };
          }
          if (
            attempt.state === "ready" &&
            Date.parse(iso(attempt.expires_at, "Checkout expiration")) <=
              Date.parse(iso(paymentClock.now(), "Payment clock"))
          ) {
            return { status: "expired", attempt };
          }
          throw new HostedError(
            "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
            "The earlier Custom-build change payment page must be reconciled before another can open.",
            { status: 503 }
          );
        }

        const purpose = purposeFromRow(invoice);
        const purposeDigest = digest(purpose);
        const providerRequestExpiresAt =
          checkoutRequestExpiration(paymentClock);
        const attemptId = uuid(
          paymentIds.next("custom_build_change_checkout"),
          "Checkout attempt ID",
          "RUNTIME_CONFIGURATION_ERROR",
          500
        );
        const commandRowId = uuid(
          paymentIds.next("custom_build_change_checkout_command"),
          "Checkout command ID",
          "RUNTIME_CONFIGURATION_ERROR",
          500
        );
        await client.query(
          `insert into ss.idempotency_keys (
             id, organization_id, principal_id, route_key,
             idempotency_key, request_digest, state,
             resource_type, resource_id, created_at, expires_at
           ) values (
             $1, $2, $3, $4, $5, $6, 'running',
             'custom_build_change_checkout', $7,
             clock_timestamp(), clock_timestamp() + interval '24 hours'
           )`,
          [
            commandRowId,
            input.organizationId,
            input.customerId,
            CHECKOUT_ROUTE,
            input.commandId,
            selectedDigest,
            attemptId
          ]
        );
        await client.query(
          `insert into ss.service_custom_build_change_checkout_attempts (
             id, organization_id, project_id, customer_user_id,
             job_id, change_order_id, change_acceptance_id,
             invoice_id, command_id, provider, purpose_digest,
             invoice_digest, accepted_quote_digest,
             accepted_disclosure_digest, expected_subtotal_minor,
             currency, tax_mode, provider_request_expires_at,
             state, provider_effect_certainty
           ) values (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, 'stripe', $10, $11, $12, $13, $14,
             'USD', 'automatic', $15, 'provider_pending', 'ambiguous'
           )`,
          [
            attemptId,
            input.organizationId,
            input.projectId,
            input.customerId,
            invoice.job_id,
            invoice.change_order_id,
            invoice.change_acceptance_id,
            input.invoiceId,
            input.commandId,
            purposeDigest,
            input.invoiceDigest,
            invoice.accepted_quote_digest,
            invoice.accepted_disclosure_digest,
            invoice.subtotal_minor,
            providerRequestExpiresAt
          ]
        );
        return deepFreeze({
          status: "claimed",
          attemptId,
          commandRowId,
          purpose,
          purposeDigest,
          providerRequestExpiresAt,
          jobId,
          stripeCustomerId: invoice.stripe_customer_id
        });
      }
    ));
  }

  async function finishCheckout(input, claim, evidence) {
    return translated(() => database.service(
      {
        actorKind: "customer",
        userId: input.customerId,
        organizationId: input.organizationId
      },
      async (client) => {
        await discoverAndLockJob(client, {
          text: `select job_id
                 from ss.service_custom_build_change_checkout_attempts
                 where organization_id = $1 and id = $2`,
          values: [input.organizationId, claim.attemptId],
          expectedJobId: claim.jobId,
          code: "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
          message:
            "The Custom-build change payment authority changed during Checkout.",
          status: 503
        });
        const selected = await client.query(
          `select attempt.*, invoice.invoice_number
           from ss.service_custom_build_change_checkout_attempts attempt
           join ss.service_custom_build_change_invoices invoice
             on invoice.organization_id = attempt.organization_id
            and invoice.id = attempt.invoice_id
           where attempt.organization_id = $1 and attempt.id = $2
           for update of attempt`,
          [input.organizationId, claim.attemptId]
        );
        invariant(
          selected.rowCount === 1 &&
            selected.rows[0].state === "provider_pending" &&
            selected.rows[0].invoice_id === input.invoiceId &&
            selected.rows[0].purpose_digest === claim.purposeDigest &&
            selected.rows[0].invoice_digest === input.invoiceDigest &&
            iso(
              selected.rows[0].provider_request_expires_at,
              "Provider-request expiration"
            ) === claim.providerRequestExpiresAt,
          "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
          "The Custom-build change payment authority changed during Checkout.",
          { status: 503 }
        );
        await client.query(
          `update ss.service_custom_build_change_checkout_attempts
           set state = 'ready',
               provider_effect_certainty = 'confirmed',
               checkout_session_id = $3,
               checkout_url = $4,
               expires_at = $5
           where organization_id = $1 and id = $2`,
          [
            input.organizationId,
            claim.attemptId,
            evidence.checkoutId,
            evidence.url,
            evidence.expiresAt
          ]
        );
        const finalized = await client.query(
          `select attempt.*, invoice.invoice_number
           from ss.service_custom_build_change_checkout_attempts attempt
           join ss.service_custom_build_change_invoices invoice
             on invoice.organization_id = attempt.organization_id
            and invoice.id = attempt.invoice_id
           where attempt.organization_id = $1 and attempt.id = $2`,
          [input.organizationId, claim.attemptId]
        );
        const result = checkoutResponse(finalized.rows[0]);
        const completed = await client.query(
          `update ss.idempotency_keys
           set state = 'completed', response_status = 201,
               response_body = $2::jsonb
           where id = $1 and state = 'running'`,
          [claim.commandRowId, JSON.stringify(result)]
        );
        invariant(
          completed.rowCount === 1,
          "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
          "The Custom-build change payment command could not be completed.",
          { status: 503 }
        );
        return result;
      }
    ));
  }

  async function markCheckoutFailure(input, claim, ambiguous, code) {
    try {
      await translated(() => database.service(
        {
          actorKind: "customer",
          userId: input.customerId,
          organizationId: input.organizationId
        },
        async (client) => {
          await discoverAndLockJob(client, {
            text: `select job_id
                   from ss.service_custom_build_change_checkout_attempts
                   where organization_id = $1 and id = $2`,
            values: [input.organizationId, claim.attemptId],
            expectedJobId: claim.jobId,
            code: "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
            message:
              "The Custom-build change payment authority changed while retaining provider certainty.",
            status: 503
          });
          await client.query(
            `update ss.service_custom_build_change_checkout_attempts
             set state = $3,
                 provider_effect_certainty = $4,
                 provider_error_code = $5
             where organization_id = $1 and id = $2
               and state = 'provider_pending'`,
            [
              input.organizationId,
              claim.attemptId,
              ambiguous ? "persistence_unknown" : "failed",
              ambiguous ? "ambiguous" : "not_submitted",
              code
            ]
          );
          await client.query(
            `update ss.idempotency_keys
             set state = $2, response_status = 503,
                 response_body = $3::jsonb
             where id = $1 and state = 'running'`,
            [
              claim.commandRowId,
              ambiguous ? "running" : "failed",
              JSON.stringify({
                error: {
                  code,
                  certainty: ambiguous ? "ambiguous" : "not_submitted"
                }
              })
            ]
          );
        }
      ));
    } catch {
      // The retained provider-pending row still fences automatic replay and
      // voiding when failure persistence itself is uncertain.
    }
  }

  async function claimEvent(event) {
    return translated(() => database.service(
      {
        actorKind: "system",
        organizationId: event.metadata.tenant_id
      },
      async (client) => {
        await discoverAndLockJob(client, {
          text: `select job_id
                 from ss.service_custom_build_change_checkout_attempts
                 where organization_id = $1
                   and checkout_session_id = $2`,
          values: [event.metadata.tenant_id, event.checkoutSessionId],
          expectedJobId: event.metadata.job_id,
          code: "STRIPE_EVENT_BINDING_INVALID",
          message:
            "The Stripe event does not identify one retained Custom-build change Checkout.",
          status: 400
        });
        const selected = await client.query(
          `select
             attempt.id as attempt_id,
             attempt.organization_id,
             attempt.project_id,
             attempt.customer_user_id,
             attempt.job_id,
             attempt.change_order_id,
             attempt.change_acceptance_id,
             attempt.invoice_id,
             attempt.checkout_session_id,
             attempt.purpose_digest,
             attempt.state as attempt_state,
             invoice.invoice_number,
             invoice.scope_boundary_digest,
             invoice.prior_effective_scope_digest,
             invoice.target_completion_date::text,
             invoice.change_number,
             invoice.accepted_quote_digest,
             invoice.accepted_disclosure_digest,
             invoice.invoice_digest,
             invoice.subtotal_minor,
             invoice.case_id
           from ss.service_custom_build_change_checkout_attempts attempt
           join ss.service_custom_build_change_invoices invoice
             on invoice.organization_id = attempt.organization_id
            and invoice.id = attempt.invoice_id
           where attempt.organization_id = $1
             and attempt.checkout_session_id = $2
           for update of attempt`,
          [event.metadata.tenant_id, event.checkoutSessionId]
        );
        invariant(
          selected.rowCount === 1,
          "STRIPE_EVENT_BINDING_INVALID",
          "The Stripe event does not identify one retained Custom-build change Checkout.",
          { status: 400 }
        );
        const row = selected.rows[0];
        const purpose = purposeFromRow(row);
        const purposeDigest = digest(purpose);
        invariant(
          row.purpose_digest === purposeDigest &&
            row.checkout_session_id === event.checkoutSessionId &&
            ["ready", "paid"].includes(row.attempt_state),
          "STRIPE_EVENT_BINDING_INVALID",
          "The retained Custom-build change Checkout changed before settlement.",
          { status: 400 }
        );
        exactMetadata(
          event.metadata,
          purpose,
          purposeDigest,
          "STRIPE_EVENT_BINDING_INVALID"
        );
        await client.query(
          `insert into ss.service_custom_build_change_stripe_events (
             id, organization_id, project_id, customer_user_id,
             job_id, change_order_id, change_acceptance_id,
             invoice_id, checkout_attempt_id, event_type, livemode,
             api_version, checkout_session_id, payload_digest,
             provider_created_at, signature_verified_at, state
           ) values (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11, $12, $13, $14, $15, $16, 'pending'
           ) on conflict (id) do nothing`,
          [
            event.eventId,
            row.organization_id,
            row.project_id,
            row.customer_user_id,
            row.job_id,
            row.change_order_id,
            row.change_acceptance_id,
            row.invoice_id,
            row.attempt_id,
            event.eventType,
            event.livemode,
            event.apiVersion,
            event.checkoutSessionId,
            event.payloadDigest,
            event.providerCreatedAt,
            event.signatureVerifiedAt
          ]
        );
        const retained = await client.query(
          `select * from ss.service_custom_build_change_stripe_events
           where organization_id = $1 and id = $2
           for update`,
          [row.organization_id, event.eventId]
        );
        invariant(
          retained.rowCount === 1 &&
            retained.rows[0].checkout_session_id === event.checkoutSessionId &&
            retained.rows[0].payload_digest === event.payloadDigest &&
            retained.rows[0].invoice_id === row.invoice_id &&
            retained.rows[0].change_acceptance_id ===
              row.change_acceptance_id,
          "STRIPE_EVENT_CONFLICT",
          "The Stripe event ID was retained with different Custom-build change evidence.",
          { status: 409 }
        );
        const resolution = deepFreeze({
          organizationId: row.organization_id,
          projectId: row.project_id,
          caseId: row.case_id,
          customerId: row.customer_user_id,
          jobId: row.job_id,
          changeOrderId: row.change_order_id,
          changeAcceptanceId: row.change_acceptance_id,
          invoiceId: row.invoice_id,
          attemptId: row.attempt_id,
          checkoutSessionId: row.checkout_session_id,
          purpose,
          purposeDigest
        });
        if (retained.rows[0].state === "processed") {
          return {
            status: "processed",
            result: settlementResult(retained.rows[0].result, {
              projectId: row.project_id,
              changeOrderId: row.change_order_id,
              invoiceId: row.invoice_id
            })
          };
        }
        if (retained.rows[0].state === "reconciliation_required") {
          return {
            status: "reconciliation_required",
            result: reconciliationResult(resolution)
          };
        }
        invariant(
          retained.rows[0].state === "pending",
          "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
          "The retained Custom-build change Stripe event is invalid.",
          { status: 500 }
        );
        return { status: "pending", resolution };
      }
    ));
  }

  async function markReconciliation(event, resolution, errorCode) {
    const selectedCode = providerCode(
      { code: errorCode },
      "stripe_custom_build_change_payment_mismatch"
    );
    return translated(() => database.service(
      {
        actorKind: "system",
        organizationId: resolution.organizationId
      },
      async (client) => {
        await discoverAndLockJob(client, {
          text: `select job_id
                 from ss.service_custom_build_change_stripe_events
                 where organization_id = $1 and id = $2`,
          values: [resolution.organizationId, event.eventId],
          expectedJobId: resolution.jobId,
          code: "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
          message:
            "Unsafe Custom-build change payment evidence could not be retained.",
          status: 500
        });
        const eventUpdate = await client.query(
          `update ss.service_custom_build_change_stripe_events
           set state = 'reconciliation_required',
               reconciliation_code = $3,
               completed_at = clock_timestamp()
           where organization_id = $1 and id = $2 and state = 'pending'`,
          [resolution.organizationId, event.eventId, selectedCode]
        );
        invariant(
          eventUpdate.rowCount === 1,
          "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
          "Unsafe Custom-build change payment evidence could not be retained.",
          { status: 500 }
        );
        return reconciliationResult(resolution);
      }
    ));
  }

  async function settle(evidence, resolution, payment, ownerCommand = null) {
    const actorKind = ownerCommand === null ? "system" : "operator";
    const eventId = evidence.eventId ?? null;
    const verifiedAt = iso(
      evidence.verifiedAt,
      "Provider evidence verification time"
    );
    return translated(() => database.service(
      {
        actorKind,
        ...(ownerCommand === null
          ? {}
          : { userId: ownerCommand.operatorId }),
        organizationId: resolution.organizationId
      },
      async (client) => {
        await discoverAndLockJob(client, {
          text: `select job_id
                 from ss.service_custom_build_change_checkout_attempts
                 where organization_id = $1 and id = $2`,
          values: [resolution.organizationId, resolution.attemptId],
          expectedJobId: resolution.jobId,
          code: "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
          message:
            "The Custom-build change settlement authority is unavailable.",
          status: 409
        });

        if (ownerCommand !== null) {
          const command = await client.query(
            `select *
             from ss.service_custom_build_change_reconciliation_commands
             where organization_id = $1 and id = $2
             for update`,
            [resolution.organizationId, ownerCommand.commandRowId]
          );
          invariant(
            command.rowCount === 1 &&
              command.rows[0].operator_user_id === ownerCommand.operatorId &&
              command.rows[0].checkout_attempt_id === resolution.attemptId,
            "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
            "The owner reconciliation command changed before settlement.",
            { status: 409 }
          );
          if (command.rows[0].state === "completed") {
            return retainedOwnerReconciliationResult(
              command.rows[0].result,
              {
                organizationId: resolution.organizationId,
                jobId: resolution.jobId,
                attemptId: resolution.attemptId
              }
            );
          }
        }

        const selected = await client.query(
          `select
             invoice.*,
             change_order.state as change_state,
             attempt.state as attempt_state,
             attempt.checkout_session_id,
             attempt.purpose_digest,
             receipt.id as receipt_id,
             receipt.checkout_session_id as receipt_checkout_session_id,
             receipt.payment_intent_id as receipt_payment_intent_id,
             receipt.stripe_customer_id as receipt_customer_id,
             receipt.subtotal_minor as receipt_subtotal_minor,
             receipt.tax_minor as receipt_tax_minor,
             receipt.total_minor as receipt_total_minor,
             receipt.provider_facts_digest as receipt_facts_digest
           from ss.service_custom_build_change_invoices invoice
           join ss.service_custom_build_change_orders change_order
             on change_order.organization_id = invoice.organization_id
            and change_order.id = invoice.change_order_id
           join ss.service_custom_build_change_checkout_attempts attempt
             on attempt.organization_id = invoice.organization_id
            and attempt.id = $3
           left join ss.service_custom_build_change_payment_receipts receipt
             on receipt.organization_id = invoice.organization_id
            and receipt.invoice_id = invoice.id
           where invoice.organization_id = $1 and invoice.id = $2
           for update of change_order, attempt`,
          [
            resolution.organizationId,
            resolution.invoiceId,
            resolution.attemptId
          ]
        );
        invariant(
          selected.rowCount === 1,
          "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
          "The Custom-build change settlement authority is unavailable.",
          { status: 409 }
        );
        const row = selected.rows[0];

        let eventRow = null;
        if (eventId !== null) {
          const selectedEvent = await client.query(
            `select *
             from ss.service_custom_build_change_stripe_events
             where organization_id = $1 and id = $2
             for update`,
            [resolution.organizationId, eventId]
          );
          invariant(
            selectedEvent.rowCount === 1 &&
              selectedEvent.rows[0].checkout_attempt_id ===
                resolution.attemptId &&
              selectedEvent.rows[0].checkout_session_id ===
                resolution.checkoutSessionId,
            "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
            "The retained Stripe event changed before settlement.",
            { status: 409 }
          );
          eventRow = selectedEvent.rows[0];
        }

        const existingCustomer = await client.query(
          `select stripe_customer_id
           from ss.stripe_customers
           where organization_id = $1
           for update`,
          [resolution.organizationId]
        );
        if (existingCustomer.rowCount === 0) {
          await client.query(
            `insert into ss.stripe_customers (
               organization_id, stripe_customer_id,
               created_from_receipt_id
             ) values ($1, $2, null)`,
            [resolution.organizationId, payment.customerId]
          );
        } else {
          invariant(
            existingCustomer.rowCount === 1 &&
              existingCustomer.rows[0].stripe_customer_id ===
                payment.customerId,
            "CUSTOM_BUILD_CHANGE_STRIPE_CUSTOMER_CONFLICT",
            "The Custom-build change payment Customer does not match this account.",
            { status: 409 }
          );
        }

        let result;
        if (row.receipt_id !== null) {
          invariant(
            row.attempt_state === "paid" &&
              row.change_state === "effective" &&
              row.receipt_checkout_session_id === payment.checkoutSessionId &&
              row.receipt_payment_intent_id === payment.paymentIntentId &&
              row.receipt_customer_id === payment.customerId &&
              Number(row.receipt_subtotal_minor) === payment.subtotalMinor &&
              Number(row.receipt_tax_minor) === payment.taxMinor &&
              Number(row.receipt_total_minor) === payment.totalMinor &&
              row.receipt_facts_digest === payment.providerFactsDigest,
            "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
            "The retained Custom-build change payment receipt changed.",
            { status: 409 }
          );
          result = settlementResult({
            schema: CUSTOM_BUILD_CHANGE_PAYMENT_SETTLEMENT_SCHEMA,
            status: "payment_settled",
            projectId: resolution.projectId,
            changeOrderId: resolution.changeOrderId,
            invoiceId: resolution.invoiceId,
            receiptId: row.receipt_id,
            next: "custom_build_changed_work"
          });
          if (eventRow !== null && eventRow.state !== "processed") {
            const alias = await client.query(
              `update ss.service_custom_build_change_stripe_events
               set state = 'processed', reconciliation_code = null,
                   result = $3::jsonb, completed_at = clock_timestamp()
               where organization_id = $1 and id = $2
                 and state in ('pending', 'reconciliation_required')`,
              [resolution.organizationId, eventId, JSON.stringify(result)]
            );
            invariant(
              alias.rowCount === 1,
              "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
              "The duplicate Custom-build change Stripe event could not be sealed.",
              { status: 500 }
            );
          }
        } else {
          invariant(
            row.attempt_state === "ready" &&
              row.change_state === "accepted_payment_required" &&
              (eventRow === null ||
                ["pending", "reconciliation_required"].includes(
                  eventRow.state
                )) &&
              row.checkout_session_id === payment.checkoutSessionId &&
              row.purpose_digest === payment.purposeDigest &&
              row.invoice_digest === resolution.purpose.invoiceDigest &&
              row.accepted_quote_digest ===
                resolution.purpose.acceptedQuoteDigest &&
              row.accepted_disclosure_digest ===
                resolution.purpose.acceptedDisclosureDigest &&
              Number(row.subtotal_minor) === payment.subtotalMinor,
            "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
            "The Custom-build change settlement state is inconsistent.",
            { status: 409 }
          );
          const receiptId = uuid(
            paymentIds.next("custom_build_change_receipt"),
            "Payment receipt ID",
            "RUNTIME_CONFIGURATION_ERROR",
            500
          );
          const settledAt = iso(
            paymentClock.now(),
            "Custom-build change settlement time"
          );
          invariant(
            Date.parse(settledAt) >= Date.parse(payment.providerPaymentTime) &&
              Date.parse(settledAt) >= Date.parse(verifiedAt),
            "CUSTOM_BUILD_CHANGE_SETTLEMENT_CLOCK_INVALID",
            "Custom-build change settlement time precedes verified payment evidence.",
            { status: 500 }
          );
          await client.query(
            `insert into ss.service_custom_build_change_payment_receipts (
               id, organization_id, project_id, case_id,
               customer_user_id, job_id, change_order_id,
               change_acceptance_id, invoice_id, checkout_attempt_id,
               receipt_source, stripe_event_id,
               reconciled_by_operator_user_id, provider,
               checkout_session_id, payment_intent_id,
               stripe_customer_id, payment_status, subtotal_minor,
               tax_minor, total_minor, tax_mode, currency,
               purpose_digest, invoice_digest, accepted_quote_digest,
               accepted_disclosure_digest, provider_facts,
               provider_facts_digest, provider_paid_at, settled_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, 'stripe', $14, $15, $16, 'paid',
               $17, $18, $19, 'automatic', 'USD', $20, $21, $22,
               $23, $24::jsonb, $25, $26, $27
             )`,
            [
              receiptId,
              resolution.organizationId,
              resolution.projectId,
              resolution.caseId,
              resolution.customerId,
              resolution.jobId,
              resolution.changeOrderId,
              resolution.changeAcceptanceId,
              resolution.invoiceId,
              resolution.attemptId,
              eventId === null ? "provider_readback" : "stripe_event",
              eventId,
              ownerCommand?.operatorId ?? null,
              payment.checkoutSessionId,
              payment.paymentIntentId,
              payment.customerId,
              payment.subtotalMinor,
              payment.taxMinor,
              payment.totalMinor,
              payment.purposeDigest,
              row.invoice_digest,
              row.accepted_quote_digest,
              row.accepted_disclosure_digest,
              JSON.stringify(payment),
              payment.providerFactsDigest,
              payment.providerPaymentTime,
              settledAt
            ]
          );
          result = settlementResult(
            eventId === null
              ? {
                  schema: CUSTOM_BUILD_CHANGE_PAYMENT_SETTLEMENT_SCHEMA,
                  status: "payment_settled",
                  projectId: resolution.projectId,
                  changeOrderId: resolution.changeOrderId,
                  invoiceId: resolution.invoiceId,
                  receiptId,
                  next: "custom_build_changed_work"
                }
              : (await client.query(
                  `select result
                   from ss.service_custom_build_change_stripe_events
                   where organization_id = $1 and id = $2`,
                  [resolution.organizationId, eventId]
                )).rows[0]?.result,
            {
              receiptId,
              projectId: resolution.projectId,
              changeOrderId: resolution.changeOrderId,
              invoiceId: resolution.invoiceId
            }
          );
        }

        if (ownerCommand === null) return result;
        const response = ownerReconciliationResult({
          status: "payment_settled",
          resolution,
          settlement: result
        });
        const completed = await client.query(
          `update ss.service_custom_build_change_reconciliation_commands
           set state = 'completed', result = $3::jsonb,
               result_digest = ss.service_json_digest($3::jsonb),
               completed_at = clock_timestamp()
           where organization_id = $1 and id = $2 and state = 'running'`,
          [
            resolution.organizationId,
            ownerCommand.commandRowId,
            JSON.stringify(response)
          ]
        );
        invariant(
          completed.rowCount === 1,
          "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
          "The owner reconciliation command could not be sealed.",
          { status: 500 }
        );
        return response;
      }
    ));
  }

  async function reconcileCheckoutCreation(
    actor,
    jobIdValue,
    value
  ) {
    const input = ownerInput(actor, jobIdValue, value);
    const claim = await translated(() => database.service(
      {
        actorKind: "operator",
        userId: input.operatorId,
        organizationId: input.organizationId
      },
      async (client) => {
        const discoveredJobId = await discoverAndLockJob(client, {
          text: `select job_id
                 from ss.service_custom_build_change_checkout_attempts
                 where id = $1`,
          values: [input.attemptId],
          code: "CUSTOM_BUILD_CHANGE_PAYMENT_UNAVAILABLE",
          message: "That Custom-build change payment is unavailable.",
          status: 404
        });
        const capability = await client.query(
          `select ss.service_operator_has_capability(
             $1, 'service_payment_reconcile', clock_timestamp()
           ) as allowed`,
          [input.operatorId]
        );
        invariant(
          capability.rows[0]?.allowed === true,
          "CUSTOM_BUILD_CHANGE_PAYMENT_UNAVAILABLE",
          "That Custom-build change payment is unavailable.",
          { status: 404 }
        );
        const request = await client.query(
          `select ss.custom_build_change_reconciliation_request_digest(
             $1, $2, $3, $4, $5
           ) as request_digest`,
          [
            input.operatorId,
            input.organizationId,
            input.jobId,
            input.attemptId,
            input.commandId
          ]
        );
        const requestDigest = request.rows[0]?.request_digest;
        invariant(
          SHA256.test(String(requestDigest ?? "")),
          "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
          "The owner reconciliation command digest is unavailable.",
          { status: 500 }
        );
        const prior = await client.query(
          `select *
           from ss.service_custom_build_change_reconciliation_commands
           where command_id = $1
           for update`,
          [input.commandId]
        );
        if (prior.rowCount === 1) {
          const row = prior.rows[0];
          invariant(
            row.organization_id === input.organizationId &&
              row.job_id === input.jobId &&
              row.checkout_attempt_id === input.attemptId &&
              row.operator_user_id === input.operatorId &&
              row.request_digest === requestDigest,
            "CUSTOM_BUILD_CHANGE_PAYMENT_RECONCILIATION_IDEMPOTENCY_CONFLICT",
            "That owner reconciliation command was already used differently.",
            { status: 409 }
          );
          if (row.state === "completed") {
            return {
              status: "replay",
              result: retainedOwnerReconciliationResult(row.result, {
                organizationId: input.organizationId,
                jobId: input.jobId,
                attemptId: input.attemptId
              })
            };
          }
        } else {
          invariant(
            prior.rowCount === 0,
            "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
            "The owner reconciliation command conflicts.",
            { status: 500 }
          );
          invariant(
            discoveredJobId === input.jobId,
            "CUSTOM_BUILD_CHANGE_PAYMENT_UNAVAILABLE",
            "That Custom-build change payment is unavailable.",
            { status: 404 }
          );
          await client.query(
            `insert into ss.service_custom_build_change_reconciliation_commands (
               id, organization_id, job_id, checkout_attempt_id,
               operator_user_id, command_id, request_digest, state
             ) values ($1, $2, $3, $4, $5, $6, $7, 'running')`,
            [
              uuid(
                paymentIds.next("custom_build_change_reconciliation_command"),
                "Owner reconciliation command ID",
                "RUNTIME_CONFIGURATION_ERROR",
                500
              ),
              input.organizationId,
              input.jobId,
              input.attemptId,
              input.operatorId,
              input.commandId,
              requestDigest
            ]
          );
        }
        const selected = await client.query(
          `select
             attempt.*,
             attempt.id as attempt_id,
             invoice.case_id,
             invoice.invoice_number,
             invoice.scope_boundary_digest,
             invoice.prior_effective_scope_digest,
             invoice.target_completion_date::text,
             invoice.change_number,
             invoice.accepted_quote_digest,
             invoice.accepted_disclosure_digest,
             invoice.invoice_digest,
             invoice.subtotal_minor,
             receipt.id as receipt_id,
             receipt.receipt_source,
             receipt.checkout_session_id as receipt_checkout_session_id,
             receipt.payment_intent_id as receipt_payment_intent_id,
             receipt.stripe_customer_id as receipt_customer_id,
             receipt.subtotal_minor as receipt_subtotal_minor,
             receipt.tax_minor as receipt_tax_minor,
             receipt.total_minor as receipt_total_minor,
             receipt.provider_facts_digest as receipt_facts_digest,
             event.id as event_id,
             event.state as event_state,
             event.signature_verified_at as event_verified_at,
             event.reconciliation_code,
             customer.stripe_customer_id
           from ss.service_custom_build_change_checkout_attempts attempt
           join ss.service_custom_build_change_invoices invoice
             on invoice.organization_id = attempt.organization_id
            and invoice.id = attempt.invoice_id
           left join ss.stripe_customers customer
             on customer.organization_id = invoice.organization_id
           left join ss.service_custom_build_change_payment_receipts receipt
             on receipt.organization_id = invoice.organization_id
            and receipt.invoice_id = invoice.id
           left join lateral (
             select candidate.*
             from ss.service_custom_build_change_stripe_events candidate
             where candidate.organization_id = attempt.organization_id
               and candidate.checkout_attempt_id = attempt.id
             order by candidate.created_at desc, candidate.id desc
             limit 1
           ) event on true
           where attempt.organization_id = $1
             and attempt.job_id = $2
             and attempt.id = $3
           for update of attempt`,
          [input.organizationId, input.jobId, input.attemptId]
        );
        invariant(
          selected.rowCount === 1 &&
            [
              "provider_pending",
              "persistence_unknown",
              "ready",
              "expired",
              "paid"
            ].includes(
              selected.rows[0].state
            ),
          "CUSTOM_BUILD_CHANGE_PAYMENT_UNAVAILABLE",
          "That uncertain Checkout creation is unavailable.",
          { status: 404 }
        );
        const row = selected.rows[0];
        const purpose = purposeFromRow(row);
        const purposeDigest = digest(purpose);
        invariant(
          row.purpose_digest === purposeDigest,
          "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
          "The retained uncertain Checkout purpose changed.",
          { status: 500 }
        );
        const command = await client.query(
          `select id
           from ss.service_custom_build_change_reconciliation_commands
           where command_id = $1`,
          [input.commandId]
        );
        invariant(
          command.rowCount === 1,
          "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
          "The durable owner reconciliation command is unavailable.",
          { status: 500 }
        );
        return deepFreeze({
          status: "claimed",
          commandRowId: command.rows[0].id,
          input,
          row: structuredClone(row),
          purpose,
          purposeDigest
        });
      }
    ));
    if (claim.status === "replay") return claim.result;

    const baseResolution = deepFreeze({
      organizationId: claim.row.organization_id,
      jobId: claim.row.job_id,
      attemptId: claim.row.attempt_id,
      invoiceId: claim.row.invoice_id,
      changeOrderId: claim.row.change_order_id
    });
    const ownerCommand = Object.freeze({
      commandRowId: claim.commandRowId,
      operatorId: input.operatorId
    });

    const withLockedCommand = async (work) => translated(() =>
      database.service(
        {
          actorKind: "operator",
          userId: input.operatorId,
          organizationId: input.organizationId
        },
        async (client) => {
          await discoverAndLockJob(client, {
            text: `select job_id
                   from ss.service_custom_build_change_checkout_attempts
                   where organization_id = $1 and id = $2`,
            values: [input.organizationId, input.attemptId],
            expectedJobId: input.jobId,
            code: "CUSTOM_BUILD_CHANGE_PAYMENT_UNAVAILABLE",
            message: "That Custom-build change payment is unavailable.",
            status: 404
          });
          const command = await client.query(
            `select *
             from ss.service_custom_build_change_reconciliation_commands
             where organization_id = $1 and id = $2
             for update`,
            [input.organizationId, claim.commandRowId]
          );
          invariant(
            command.rowCount === 1 &&
              command.rows[0].operator_user_id === input.operatorId &&
              command.rows[0].checkout_attempt_id === input.attemptId,
            "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
            "The owner reconciliation command changed.",
            { status: 409 }
          );
          if (command.rows[0].state === "completed") {
            return retainedOwnerReconciliationResult(
              command.rows[0].result,
              {
                organizationId: input.organizationId,
                jobId: input.jobId,
                attemptId: input.attemptId
              }
            );
          }
          return work(client);
        }
      )
    );

    const sealCommand = async (client, response) => {
      const completed = await client.query(
        `update ss.service_custom_build_change_reconciliation_commands
         set state = 'completed', result = $3::jsonb,
             result_digest = ss.service_json_digest($3::jsonb),
             completed_at = clock_timestamp()
         where organization_id = $1 and id = $2 and state = 'running'`,
        [
          input.organizationId,
          claim.commandRowId,
          JSON.stringify(response)
        ]
      );
      invariant(
        completed.rowCount === 1,
        "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
        "The owner reconciliation command could not be sealed.",
        { status: 500 }
      );
      return response;
    };

    const finishWithStatus = (status, reason = null) => withLockedCommand(
      async (client) => sealCommand(
        client,
        ownerReconciliationResult({
          status,
          resolution: baseResolution,
          reason
        })
      )
    );

    const expireAttempt = (reason) => withLockedCommand(async (client) => {
      const updated = await client.query(
        `update ss.service_custom_build_change_checkout_attempts attempt
         set state = 'expired',
             provider_error_code = coalesce(
               attempt.provider_error_code,
               'custom_build_change_checkout_expired_without_delivery'
             )
         where attempt.organization_id = $1
           and attempt.job_id = $2
           and attempt.id = $3
           and attempt.state in (
             'provider_pending', 'persistence_unknown', 'ready'
           )
           and attempt.provider_request_expires_at <= $4::timestamptz
           and not exists (
             select 1
             from ss.service_custom_build_change_payment_receipts receipt
             where receipt.organization_id = attempt.organization_id
               and receipt.checkout_attempt_id = attempt.id
           )
           and not exists (
             select 1
             from ss.service_custom_build_change_stripe_events event
             where event.organization_id = attempt.organization_id
               and event.checkout_attempt_id = attempt.id
           )`,
        [
          input.organizationId,
          input.jobId,
          input.attemptId,
          iso(paymentClock.now(), "Payment clock")
        ]
      );
      invariant(
        updated.rowCount === 1,
        "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
        "The uncertain payment page changed before safe expiration.",
        { status: 503 }
      );
      await client.query(
        `update ss.idempotency_keys
         set state = 'failed', response_status = 409,
             response_body = $4::jsonb
         where organization_id = $1
           and principal_id = $2
           and route_key = $3
           and idempotency_key = $5
           and state = 'running'`,
        [
          input.organizationId,
          claim.row.customer_user_id,
          CHECKOUT_ROUTE,
          JSON.stringify({
            error: {
              code: "CUSTOM_BUILD_CHANGE_CHECKOUT_REQUIRES_NEW_COMMAND",
              certainty: "expired_without_delivery"
            }
          }),
          claim.row.command_id
        ]
      );
      return sealCommand(
        client,
        ownerReconciliationResult({
          status: "checkout_expired",
          resolution: baseResolution,
          reason
        })
      );
    });

    if (claim.row.receipt_id !== null) {
      const settlement = settlementResult({
        schema: CUSTOM_BUILD_CHANGE_PAYMENT_SETTLEMENT_SCHEMA,
        status: "payment_settled",
        projectId: claim.row.project_id,
        changeOrderId: claim.row.change_order_id,
        invoiceId: claim.row.invoice_id,
        receiptId: claim.row.receipt_id,
        next: "custom_build_changed_work"
      });
      return withLockedCommand((client) => sealCommand(
        client,
        ownerReconciliationResult({
          status: "payment_settled",
          resolution: baseResolution,
          settlement
        })
      ));
    }

    if (["provider_pending", "persistence_unknown"].includes(
      claim.row.state
    )) {
      const retainedExpiration = iso(
        claim.row.provider_request_expires_at,
        "Provider-request expiration"
      );
      if (
        Date.parse(retainedExpiration) <=
          Date.parse(iso(paymentClock.now(), "Payment clock"))
      ) {
        return expireAttempt("creation_request_expired");
      }
      let evidence;
      try {
        evidence = checkoutEvidence(
          await paymentProvider.createCustomBuildChangeCheckout({
            idempotencyKey: claim.row.command_id,
            checkoutExpiresAt: retainedExpiration,
            purpose: claim.purpose,
            purposeDigest: claim.purposeDigest,
            ...(claim.row.stripe_customer_id
              ? { stripeCustomerId: claim.row.stripe_customer_id }
              : {})
          }),
          retainedExpiration,
          paymentClock
        );
      } catch (error) {
        const reason = providerCode(
          error,
          "stripe_custom_build_change_creation_reconcile_unavailable"
        );
        return withLockedCommand(async (client) => {
          if (claim.row.state === "provider_pending") {
            await client.query(
              `update ss.service_custom_build_change_checkout_attempts
               set state = 'persistence_unknown',
                   provider_effect_certainty = 'ambiguous',
                   provider_error_code = $3
               where organization_id = $1 and id = $2
                 and state = 'provider_pending'`,
              [input.organizationId, input.attemptId, reason]
            );
          }
          return sealCommand(
            client,
            ownerReconciliationResult({
              status: "reconciliation_required",
              resolution: baseResolution,
              reason
            })
          );
        });
      }

      return withLockedCommand(async (client) => {
        const selected = await client.query(
          `select attempt.*, invoice.invoice_number
           from ss.service_custom_build_change_checkout_attempts attempt
           join ss.service_custom_build_change_invoices invoice
             on invoice.organization_id = attempt.organization_id
            and invoice.id = attempt.invoice_id
           where attempt.organization_id = $1 and attempt.id = $2
           for update of attempt`,
          [input.organizationId, input.attemptId]
        );
        invariant(
          selected.rowCount === 1 &&
            ["provider_pending", "persistence_unknown"].includes(
              selected.rows[0].state
            ) &&
            selected.rows[0].purpose_digest === claim.purposeDigest &&
            iso(
              selected.rows[0].provider_request_expires_at,
              "Provider-request expiration"
            ) === retainedExpiration,
          "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
          "The uncertain payment page changed before reconciliation.",
          { status: 503 }
        );
        const updated = await client.query(
          `update ss.service_custom_build_change_checkout_attempts
           set state = 'ready',
               provider_effect_certainty = 'confirmed',
               checkout_session_id = $3,
               checkout_url = $4,
               expires_at = $5,
               provider_error_code = null
           where organization_id = $1 and id = $2
             and state in ('provider_pending', 'persistence_unknown')`,
          [
            input.organizationId,
            input.attemptId,
            evidence.checkoutId,
            evidence.url,
            evidence.expiresAt
          ]
        );
        invariant(
          updated.rowCount === 1,
          "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
          "The uncertain payment page could not be reconciled.",
          { status: 503 }
        );
        const finalized = await client.query(
          `select attempt.*, invoice.invoice_number
           from ss.service_custom_build_change_checkout_attempts attempt
           join ss.service_custom_build_change_invoices invoice
             on invoice.organization_id = attempt.organization_id
            and invoice.id = attempt.invoice_id
           where attempt.organization_id = $1 and attempt.id = $2`,
          [input.organizationId, input.attemptId]
        );
        const checkout = checkoutResponse(finalized.rows[0]);
        const customerCommand = await client.query(
          `update ss.idempotency_keys
           set state = 'completed', response_status = 201,
               response_body = $4::jsonb
           where organization_id = $1
             and principal_id = $2
             and route_key = $3
             and idempotency_key = $5
             and state = 'running'`,
          [
            input.organizationId,
            claim.row.customer_user_id,
            CHECKOUT_ROUTE,
            JSON.stringify(checkout),
            claim.row.command_id
          ]
        );
        invariant(
          customerCommand.rowCount === 1,
          "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
          "The reconciled customer payment command could not be sealed.",
          { status: 503 }
        );
        return sealCommand(
          client,
          ownerReconciliationResult({
            status: "checkout_ready",
            resolution: baseResolution,
            checkout
          })
        );
      });
    }

    if (claim.row.state === "expired") {
      return finishWithStatus("checkout_expired", "attempt_already_expired");
    }
    invariant(
      claim.row.state === "ready",
      "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
      "The owner reconciliation attempt state is invalid.",
      { status: 409 }
    );
    const resolution = paymentResolutionFromRow(claim.row);
    let lifecycle;
    try {
      lifecycle = exactLifecycle(
        await paymentProvider.retrieveCustomBuildChangeCheckoutLifecycle({
          checkoutSessionId: resolution.checkoutSessionId,
          purpose: resolution.purpose,
          purposeDigest: resolution.purposeDigest
        }),
        resolution
      );
    } catch (error) {
      return finishWithStatus(
        "reconciliation_required",
        providerCode(
          error,
          "stripe_custom_build_change_lifecycle_reconcile_unavailable"
        )
      );
    }
    if (lifecycle.state === "open") {
      return finishWithStatus(
        "reconciliation_required",
        "checkout_still_open"
      );
    }
    if (lifecycle.state === "expired") {
      return claim.row.event_id === null
        ? expireAttempt("provider_confirmed_expired")
        : finishWithStatus(
            "reconciliation_required",
            "stripe_event_requires_review"
          );
    }

    let payment;
    try {
      payment = exactPaymentFacts(
        await paymentProvider.retrieveCustomBuildChangePayment({
          checkoutSessionId: resolution.checkoutSessionId,
          purpose: resolution.purpose,
          purposeDigest: resolution.purposeDigest
        }),
        resolution
      );
    } catch (error) {
      return finishWithStatus(
        "reconciliation_required",
        providerCode(
          error,
          "stripe_custom_build_change_payment_reconcile_unavailable"
        )
      );
    }
    return settle(
      {
        eventId: claim.row.event_id,
        verifiedAt: iso(paymentClock.now(), "Provider readback time")
      },
      resolution,
      payment,
      ownerCommand
    );
  }

  async function reconcileExpiredCheckout(value) {
    const input = checkoutInput(value);
    const resolution = await translated(() => database.service(
      {
        actorKind: "customer",
        userId: input.customerId,
        organizationId: input.organizationId,
        readOnly: true
      },
      async (client) => {
        const selected = await client.query(
          `select
             attempt.*,
             invoice.invoice_number,
             invoice.scope_boundary_digest,
             invoice.prior_effective_scope_digest,
             invoice.target_completion_date::text,
             invoice.change_number,
             invoice.accepted_quote_digest,
             invoice.accepted_disclosure_digest,
             invoice.invoice_digest,
             invoice.subtotal_minor
           from ss.service_custom_build_change_checkout_attempts attempt
           join ss.service_custom_build_change_invoices invoice
             on invoice.organization_id = attempt.organization_id
            and invoice.id = attempt.invoice_id
           left join ss.service_custom_build_change_payment_receipts receipt
             on receipt.organization_id = invoice.organization_id
            and receipt.invoice_id = invoice.id
           where attempt.organization_id = $1
             and attempt.project_id = $2
             and attempt.customer_user_id = $3
             and attempt.invoice_id = $4
             and invoice.invoice_digest = $5
             and attempt.state = 'ready'
             and attempt.expires_at <= clock_timestamp()
             and receipt.id is null
             and not exists (
               select 1
               from ss.service_custom_build_change_stripe_events event
               where event.organization_id = attempt.organization_id
                 and event.checkout_attempt_id = attempt.id
             )
           order by attempt.created_at desc
           limit 1`,
          [
            input.organizationId,
            input.projectId,
            input.customerId,
            input.invoiceId,
            input.invoiceDigest
          ]
        );
        invariant(
          selected.rowCount === 1,
          "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
          "The Custom-build change payment page is not eligible for expiry reconciliation.",
          { status: 503 }
        );
        const row = selected.rows[0];
        const purpose = purposeFromRow(row);
        const purposeDigest = digest(purpose);
        invariant(
          row.purpose_digest === purposeDigest,
          "CUSTOM_BUILD_CHANGE_PAYMENT_CONFLICT",
          "The retained Custom-build change Checkout purpose changed.",
          { status: 500 }
        );
        return deepFreeze({
          organizationId: input.organizationId,
          projectId: input.projectId,
          customerId: input.customerId,
          jobId: row.job_id,
          invoiceId: input.invoiceId,
          attemptId: row.id,
          checkoutSessionId: row.checkout_session_id,
          purpose,
          purposeDigest
        });
      }
    ));
    let lifecycle;
    try {
      lifecycle = exactLifecycle(
        await paymentProvider.retrieveCustomBuildChangeCheckoutLifecycle({
          checkoutSessionId: resolution.checkoutSessionId,
          purpose: resolution.purpose,
          purposeDigest: resolution.purposeDigest
        }),
        resolution
      );
    } catch (error) {
      throw new HostedError(
        "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
        "The expired Custom-build change payment page could not be confirmed safely.",
        {
          status: 503,
          details: {
            providerErrorCode: providerCode(
              error,
              "stripe_custom_build_change_lifecycle_unavailable"
            ),
            providerEffect: false
          }
        }
      );
    }
    invariant(
      lifecycle.state === "expired",
      "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
      lifecycle.state === "paid"
        ? "Stripe reports this page was paid. Owner provider-readback reconciliation must finish first."
        : "Stripe reports this payment page is still open.",
      { status: 503 }
    );
    return translated(() => database.service(
      {
        actorKind: "customer",
        userId: input.customerId,
        organizationId: input.organizationId
      },
      async (client) => {
        await discoverAndLockJob(client, {
          text: `select job_id
                 from ss.service_custom_build_change_checkout_attempts
                 where organization_id = $1 and id = $2`,
          values: [input.organizationId, resolution.attemptId],
          expectedJobId: resolution.jobId,
          code: "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
          message:
            "The expired Custom-build change payment page changed before release.",
          status: 503
        });
        const updated = await client.query(
          `update ss.service_custom_build_change_checkout_attempts
           set state = 'expired'
           where organization_id = $1 and id = $2
             and state = 'ready' and expires_at <= clock_timestamp()
             and not exists (
               select 1
               from ss.service_custom_build_change_payment_receipts receipt
               where receipt.organization_id = $1
                 and receipt.invoice_id = $3
             )
             and not exists (
               select 1
               from ss.service_custom_build_change_stripe_events event
               where event.organization_id = $1
                 and event.checkout_attempt_id = $2
             )`,
          [input.organizationId, resolution.attemptId, input.invoiceId]
        );
        invariant(
          updated.rowCount === 1,
          "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
          "The expired Custom-build change payment page changed before release.",
          { status: 503 }
        );
        return deepFreeze({
          status: "expired_reconciled",
          invoiceId: input.invoiceId
        });
      }
    ));
  }

  return Object.freeze({
    async readiness() {
      return translated(() => database.service(
        { readOnly: true },
        async (client) => {
          const selected = await client.query(
            "select ss.hosted_runtime_contract_v45() as runtime_contract"
          );
          invariant(
            selected.rowCount === 1 &&
              selected.rows[0].runtime_contract === RUNTIME_CONTRACT,
            "CUSTOM_BUILD_CHANGE_PAYMENT_HELD",
            "Custom-build change payment storage is not ready.",
            { status: 503 }
          );
          return deepFreeze({
            schema: READINESS_SCHEMA,
            ready: paymentRelease.approved,
            state: paymentRelease.approved ? "approved" : "held",
            runtimeContract: RUNTIME_CONTRACT,
            automaticTax: true,
            webhookWakeup: true,
            stripeReadback: true,
            atomicSettlement: true,
            activatesAcceptedChange: true,
            ownerReconciliation: true,
            holdScope: paymentRelease.holdScope,
            providerEffectProcessing:
              paymentRelease.providerEffectProcessing
          });
        }
      ));
    },

    readCurrentInvoice,
    readOwnerPayments,

    async createCheckout(value) {
      const input = checkoutInput(value);
      invariant(
        paymentRelease.approved,
        "CUSTOM_BUILD_CHANGE_PAYMENT_HELD",
        "Custom-build change payment is held for new Checkout creation.",
        { status: 503 }
      );
      const claim = await stageCheckout(input);
      if (claim.status === "replay") return claim.result;
      if (claim.status === "expired") {
        await reconcileExpiredCheckout(value);
        throw new HostedError(
          "CUSTOM_BUILD_CHANGE_CHECKOUT_REQUIRES_NEW_COMMAND",
          "The expired payment page is safely closed. Refresh before opening one replacement.",
          { status: 409 }
        );
      }
      let providerReturned = false;
      try {
        const returned =
          await paymentProvider.createCustomBuildChangeCheckout({
            idempotencyKey: input.commandId,
            checkoutExpiresAt: claim.providerRequestExpiresAt,
            purpose: claim.purpose,
            purposeDigest: claim.purposeDigest,
            ...(claim.stripeCustomerId
              ? { stripeCustomerId: claim.stripeCustomerId }
              : {})
          });
        providerReturned = true;
        return await finishCheckout(
          input,
          claim,
          checkoutEvidence(
            returned,
            claim.providerRequestExpiresAt,
            paymentClock
          )
        );
      } catch (error) {
        const definitelyNotSubmitted =
          error instanceof ExternalEffectError &&
          error.certainty === "not_submitted";
        const ambiguous = providerReturned || !definitelyNotSubmitted;
        const code = providerCode(
          error,
          ambiguous
            ? "custom_build_change_checkout_effect_unknown"
            : "custom_build_change_checkout_not_submitted"
        );
        await markCheckoutFailure(input, claim, ambiguous, code);
        throw new HostedError(
          ambiguous
            ? "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED"
            : "CUSTOM_BUILD_CHANGE_PAYMENT_UNAVAILABLE",
          ambiguous
            ? "The payment page could not be confirmed and will not be submitted again automatically."
            : "Secure Custom-build change payment is temporarily unavailable. Nothing was charged.",
          { status: 503 }
        );
      }
    },

    reconcileCheckoutCreation,
    reconcileExpiredCheckout,

    async ingestStripeEvent(value) {
      invariant(
        isPotentialCustomBuildChangePaymentStripeEvent(value),
        "STRIPE_EVENT_INVALID",
        "The Stripe event is not a Custom-build change payment event.",
        { status: 400 }
      );
      const event = exactVerifiedEvent(value, paymentClock);
      const claimed = await claimEvent(event);
      if (
        claimed.status === "processed" ||
        claimed.status === "reconciliation_required"
      ) {
        return claimed.result;
      }
      let payment;
      try {
        payment = exactPaymentFacts(
          await paymentProvider.retrieveCustomBuildChangePayment({
            checkoutSessionId: claimed.resolution.checkoutSessionId,
            purpose: claimed.resolution.purpose,
            purposeDigest: claimed.resolution.purposeDigest
          }),
          claimed.resolution
        );
      } catch (error) {
        const rejectedEvidence =
          error?.status === 502 ||
          error?.code ===
            "CUSTOM_BUILD_CHANGE_PAYMENT_EVIDENCE_INVALID";
        if (rejectedEvidence) {
          return markReconciliation(
            event,
            claimed.resolution,
            error.code
          );
        }
        throw new HostedError(
          "CUSTOM_BUILD_CHANGE_PAYMENT_RECONCILIATION_UNAVAILABLE",
          "Stripe payment confirmation is temporarily unavailable. The event remains safe to retry.",
          {
            status: 503,
            details: {
              providerErrorCode: providerCode(
                error,
                "stripe_custom_build_change_read_unavailable"
              ),
              providerEffect: false
            }
          }
        );
      }
      return settle(
        {
          eventId: event.eventId,
          verifiedAt: event.signatureVerifiedAt
        },
        claimed.resolution,
        payment
      );
    }
  });
}
