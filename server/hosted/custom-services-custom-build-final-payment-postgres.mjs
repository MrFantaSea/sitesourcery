import { createHash, randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { ExternalEffectError } from "../domain/errors.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

export const CUSTOM_BUILD_FINAL_STATE_SCHEMA =
  "sitesourcery.custom-build-final-handoff/v1";
export const CUSTOM_BUILD_FINAL_CHECKOUT_SCHEMA =
  "sitesourcery.custom-build-final-checkout/v1";
export const CUSTOM_BUILD_FINAL_PURPOSE_SCHEMA =
  "sitesourcery.custom-build-final-checkout-purpose/v1";
export const CUSTOM_BUILD_FINAL_PAYMENT_METADATA_SCHEMA =
  "sitesourcery_custom_build_final_checkout_v1";
export const CUSTOM_BUILD_FINAL_SETTLEMENT_SCHEMA =
  "sitesourcery.custom-build-final-settlement/v1";

const PAYMENT_FACTS_SCHEMA =
  "sitesourcery.stripe-custom-build-final-payment-facts/v1";
const LIFECYCLE_SCHEMA =
  "sitesourcery.stripe-custom-build-final-checkout-lifecycle/v1";
const READINESS_SCHEMA =
  "sitesourcery.custom-build-final-payment-readiness/v1";
const OWNER_SCHEMA =
  "sitesourcery.custom-build-final-payments-owner/v1";
const OWNER_RECONCILIATION_SCHEMA =
  "sitesourcery.custom-build-final-payment-reconciliation-command/v1";
const EXPIRY_SCHEMA =
  "sitesourcery.custom-build-final-checkout-expiry/v1";
const RUNTIME_CONTRACT = "canonical-ss-v46-custom-build-final-payment";
const CHECKOUT_ROUTE = "custom-services.custom-build-final-checkout";
const EVENT_TYPE = "checkout.session.completed";
// Stripe measures its 30-minute minimum from provider-side creation time.
// Retain one minute of submission margin while keeping a short-lived page.
const CHECKOUT_TTL_MILLISECONDS = 31 * 60 * 1000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const INVOICE_NUMBER = /^SSCB-FINAL-[0-9A-F]{32}$/u;
const CHECKOUT_ID = /^cs_[A-Za-z0-9_]+$/u;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/u;
const CHARGE_ID = /^ch_[A-Za-z0-9_]+$/u;
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

function boundedInteger(
  value,
  field,
  { zero = false, maximum = 99_999_999 } = {}
) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) &&
      selected >= (zero ? 0 : 1) &&
      selected <= maximum,
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function iso(value, field, code = "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT") {
  const selected = value instanceof Date ? value.toISOString() : value;
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

function canonicalDigests(value, field) {
  // Migration 44 canonically orders this immutable sequence by change number,
  // not by the lexical value of each digest. Preserve that semantic order and
  // reject duplicates instead of sorting hashes and changing bound identity.
  invariant(
    Array.isArray(value) &&
      value.length <= 1000 &&
      value.every((entry) => SHA256.test(String(entry ?? ""))) &&
      new Set(value).size === value.length,
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    `${field} is not canonical.`,
    { status: 500 }
  );
  return Object.freeze([...value]);
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
      "Sign in before opening Custom-build final-payment tools.",
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
    "Custom-build final-payment scope is invalid."
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
    "Custom-build final Checkout request is invalid."
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
    "Custom-build final-payment reconciliation request is invalid."
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
    "Canonical PostgreSQL authority is required for Custom-build final payment.",
    { status: 500 }
  );
  return value;
}

function validateProvider(value) {
  invariant(
    value &&
      typeof value.createCustomBuildFinalCheckout === "function" &&
      typeof value.retrieveCustomBuildFinalPayment === "function" &&
      typeof value.retrieveCustomBuildFinalCheckoutLifecycle === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Exact Stripe Custom-build final Checkout and readback are required.",
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
    "Custom-build final-payment release is invalid.",
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
    "Custom-build final payment must preserve automatic-tax USD billing.",
    { status: 500 }
  );
  return Object.freeze({ ...value });
}

function validateClock(value) {
  const selected = value ?? { now: () => new Date().toISOString() };
  invariant(
    typeof selected.now === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "A Custom-build final-payment clock is required.",
    { status: 500 }
  );
  return selected;
}

function validateIds(value) {
  const selected = value ?? { next: () => systemRandomUUID() };
  invariant(
    typeof selected.next === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Custom-build final-payment IDs are required.",
    { status: 500 }
  );
  return selected;
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (
    error?.code === "23505" &&
    /stripe_customers.*stripe_customer_id|stripe_customer_id.*key/iu.test(
      `${error?.message ?? ""} ${error?.constraint ?? ""}`
    )
  ) {
    return new HostedError(
      "CUSTOM_BUILD_FINAL_STRIPE_CUSTOMER_CONFLICT",
      "The verified Stripe Customer belongs to a different account.",
      { status: 409 }
    );
  }
  if (
    error?.code === "23505" &&
    /Custom build Stripe|stripe_payment_claim/iu.test(
      `${error?.message ?? ""} ${error?.constraint ?? ""}`
    )
  ) {
    return new HostedError(
      "CUSTOM_BUILD_FINAL_PROVIDER_EFFECT_CONFLICT",
      "That Stripe effect is already bound to another payment purpose.",
      { status: 409 }
    );
  }
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
      "CUSTOM_BUILD_FINAL_PAYMENT_REPOSITORY_CONFLICT",
      "The Custom-build final-payment record rejected inconsistent evidence.",
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

function checkoutRequestDigest(input) {
  return digest({ route: CHECKOUT_ROUTE, ...input });
}

function checkoutRequestExpiration(clock) {
  const now = iso(clock.now(), "Final-payment clock");
  const expiresAt = new Date(
    Math.floor(Date.parse(now) / 1000) * 1000 +
      CHECKOUT_TTL_MILLISECONDS
  ).toISOString();
  invariant(
    Date.parse(expiresAt) > Date.parse(now),
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    "The Custom-build final Checkout expiration is invalid.",
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

function positivePurposeFromRow(row) {
  invariant(
    row &&
      [
        row.organization_id,
        row.customer_user_id,
        row.project_id,
        row.job_id,
        row.quote_id,
        row.quote_revision_id,
        row.quote_acceptance_id,
        row.completion_package_id,
        row.obligation_id,
        row.invoice_id
      ].every((entry) => UUID.test(String(entry ?? ""))) &&
      INVOICE_NUMBER.test(String(row.invoice_number ?? "")) &&
      [
        row.accepted_disclosure_digest,
        row.accepted_quote_digest,
        row.base_scope_digest,
        row.commercial_contract_digest,
        row.completion_package_digest,
        row.effective_scope_digest,
        row.obligation_digest,
        row.invoice_digest
      ].every((entry) => SHA256.test(String(entry ?? ""))),
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    "The retained Custom-build final invoice purpose is incomplete.",
    { status: 500 }
  );
  const effectiveChangeOrderDigests = canonicalDigests(
    row.effective_change_order_digests,
    "effective change-order digests"
  );
  const amountMinor = boundedInteger(row.final_due_minor, "final amount");
  invariant(
    Number(row.installment_number) === 2 &&
      Number(row.credit_minor) === 0 &&
      Number(row.invoice_subtotal_minor) === amountMinor &&
      Number(row.invoice_credit_minor) === 0 &&
      Number(row.workmanship_correction_days) === 30 &&
      row.currency === "USD",
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    "The final invoice must contain only immutable quote installment 2.",
    { status: 500 }
  );
  return deepFreeze({
    acceptedDisclosureDigest: row.accepted_disclosure_digest,
    acceptedQuoteDigest: row.accepted_quote_digest,
    baseScopeDigest: row.base_scope_digest,
    commercialContractDigest: row.commercial_contract_digest,
    completionPackageDigest: row.completion_package_digest,
    completionPackageId: row.completion_package_id,
    customerId: row.customer_user_id,
    effectiveChangeOrderDigests,
    effectiveScopeDigest: row.effective_scope_digest,
    finalObligationDigest: row.obligation_digest,
    finalObligationId: row.obligation_id,
    installmentNumber: 2,
    invoiceDigest: row.invoice_digest,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    jobId: row.job_id,
    price: {
      amountMinor,
      billing: "one_time",
      currency: "USD",
      taxBehavior: "automatic_exclusive"
    },
    projectId: row.project_id,
    quoteAcceptanceId: row.quote_acceptance_id,
    quoteId: row.quote_id,
    quoteRevisionId: row.quote_revision_id,
    schema: CUSTOM_BUILD_FINAL_PURPOSE_SCHEMA,
    tenantId: row.organization_id,
    workmanshipCorrectionDays: 30
  });
}

function expectedMetadata(purpose, purposeDigest) {
  return Object.freeze({
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
    effective_change_order_digests_digest: digest(
      purpose.effectiveChangeOrderDigests
    ),
    effective_scope_digest: purpose.effectiveScopeDigest,
    completion_package_digest: purpose.completionPackageDigest,
    final_obligation_digest: purpose.finalObligationDigest,
    invoice_digest: purpose.invoiceDigest,
    purpose_digest: purposeDigest
  });
}

function exactMetadata(value, purpose, purposeDigest, code, status = 400) {
  const expected = expectedMetadata(purpose, purposeDigest);
  exactKeys(
    value,
    Object.keys(expected),
    code,
    "The verified Stripe metadata does not match the retained Custom-build final invoice.",
    status
  );
  invariant(
    Object.entries(expected).every(([key, selected]) => value[key] === selected),
    code,
    "The verified Stripe metadata does not match the retained Custom-build final invoice.",
    { status }
  );
  return expected;
}

function checkoutEvidence(value, expectedExpiresAt, clock) {
  const retainedExpiration = iso(
    expectedExpiresAt,
    "Retained final Checkout expiration"
  );
  const observedExpiration = iso(
    value?.expiresAt,
    "Stripe final Checkout expiration",
    "CUSTOM_BUILD_FINAL_CHECKOUT_PROVIDER_RESPONSE_INVALID"
  );
  invariant(
    value &&
      CHECKOUT_ID.test(String(value.checkoutId ?? "")) &&
      typeof value.url === "string" &&
      value.url.length <= 2000 &&
      observedExpiration === retainedExpiration,
    "CUSTOM_BUILD_FINAL_CHECKOUT_PROVIDER_RESPONSE_INVALID",
    "Stripe returned unsafe Custom-build final Checkout evidence.",
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
        Date.parse(iso(clock.now(), "Final-payment clock")),
    "CUSTOM_BUILD_FINAL_CHECKOUT_PROVIDER_RESPONSE_INVALID",
    "Stripe returned unsafe Custom-build final Checkout evidence.",
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
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    "The retained Custom-build final Checkout is incomplete.",
    { status: 500 }
  );
  return deepFreeze({
    schema: CUSTOM_BUILD_FINAL_CHECKOUT_SCHEMA,
    state: "ready",
    checkout: {
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      url: row.checkout_url,
      expiresAt: iso(row.expires_at, "Final Checkout expiration"),
      subtotal: {
        amountMinor: boundedInteger(
          row.expected_subtotal_minor,
          "Final Checkout subtotal"
        ),
        currency: "USD"
      },
      tax: { amountMinor: null, state: "calculated_at_checkout" },
      total: { amountMinor: null, currency: "USD", state: "shown_at_checkout" },
      chargeOccurred: false
    }
  });
}

function emptyCustomerProjection(scope) {
  return deepFreeze({
    schema: CUSTOM_BUILD_FINAL_STATE_SCHEMA,
    state: "completion_required",
    projectId: scope.projectId,
    jobId: null,
    completion: null,
    obligation: null,
    invoice: null,
    payment: null,
    handoff: {
      state: "unavailable",
      documentId: null,
      workmanshipStartsAt: null,
      workmanshipEndsAt: null
    },
    action: {
      checkoutAvailable: false,
      handoffAvailable: false,
      reason: "completion_required"
    }
  });
}

function customerProjection(row, release, clock, scope = null) {
  if (!row) return emptyCustomerProjection(scope);
  const amountMinor = boundedInteger(
    row.final_due_minor,
    "final obligation amount",
    { zero: true }
  );
  invariant(
    [
      row.organization_id,
      row.customer_user_id,
      row.project_id,
      row.job_id,
      row.completion_package_id,
      row.obligation_id,
      row.quote_id,
      row.quote_revision_id,
      row.quote_acceptance_id
    ].every((entry) => UUID.test(String(entry ?? ""))) &&
      [
        row.completion_package_digest,
        row.obligation_digest,
        row.accepted_quote_digest,
        row.accepted_disclosure_digest,
        row.base_scope_digest,
        row.effective_scope_digest,
        row.commercial_contract_digest
      ].every((entry) => SHA256.test(String(entry ?? ""))) &&
      Number(row.credit_minor) === 0 &&
      row.currency === "USD" &&
      Number(row.workmanship_correction_days) === 30,
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    "The retained Custom-build final obligation is inconsistent.",
    { status: 500 }
  );
  canonicalDigests(
    row.effective_change_order_digests,
    "effective change-order digests"
  );
  const completion = Object.freeze({
    packageId: row.completion_package_id,
    packageDigest: row.completion_package_digest,
    completedAt: iso(row.completion_prepared_at, "Completion time")
  });
  const obligation = Object.freeze({
    obligationId: row.obligation_id,
    obligationDigest: row.obligation_digest,
    amount: { amountMinor, currency: "USD" },
    installmentNumber: amountMinor === 0 ? null : 2,
    workmanshipCorrectionDays: 30,
    boundAt: iso(row.bound_at, "Final-obligation binding time")
  });

  if (amountMinor === 0) {
    invariant(
      row.installment_number === null &&
        row.invoice_id === null &&
        row.checkout_attempt_id === null &&
        row.receipt_id === null &&
        UUID.test(String(row.zero_balance_clearance_id ?? "")) &&
        SHA256.test(String(row.zero_balance_clearance_digest ?? "")),
      "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
      "A zero final balance requires one immutable clearance and no invoice.",
      { status: 500 }
    );
    return deepFreeze({
      schema: CUSTOM_BUILD_FINAL_STATE_SCHEMA,
      state: "cleared_no_balance_handoff_pending",
      projectId: row.project_id,
      jobId: row.job_id,
      completion,
      obligation,
      invoice: null,
      payment: {
        state: "cleared_no_balance",
        chargeOccurred: false,
        zeroBalanceClearance: {
          clearanceId: row.zero_balance_clearance_id,
          clearanceDigest: row.zero_balance_clearance_digest,
          clearedAt: iso(
            row.zero_balance_cleared_at,
            "Zero-balance clearance time"
          )
        }
      },
      handoff: {
        state: "pending",
        documentId: null,
        workmanshipStartsAt: null,
        workmanshipEndsAt: null
      },
      action: {
        checkoutAvailable: false,
        handoffAvailable: false,
        reason: "zero_balance_cleared"
      }
    });
  }

  positivePurposeFromRow(row);
  const lines = Array.isArray(row.lines) ? row.lines : [];
  invariant(
    row.zero_balance_clearance_id === null &&
      lines.length === 1 &&
      lines[0].lineNumber === 1 &&
      lines[0].componentKey === "custom_build_final_installment" &&
      lines[0].displayName ===
        "Custom website build final installment" &&
      Number(lines[0].quantity) === 1 &&
      Number(lines[0].unitAmountMinor) === amountMinor &&
      Number(lines[0].creditMinor) === 0 &&
      Number(lines[0].amountMinor) === amountMinor &&
      Number(row.invoice_credit_minor) === 0,
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    "The final invoice must have one exact installment line and no reused credit.",
    { status: 500 }
  );
  const paid = row.receipt_id !== null;
  const now = Date.parse(iso(clock.now(), "Final-payment clock"));
  const ready =
    row.checkout_state === "ready" &&
    Date.parse(iso(row.checkout_expires_at, "Final Checkout expiration")) > now;
  const reconciliation =
    ["provider_pending", "persistence_unknown"].includes(row.checkout_state) ||
    ["pending", "reconciliation_required"].includes(row.event_state);
  invariant(
    !paid ||
      (row.receipt_linkage_valid === true && row.checkout_state === "paid"),
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    "The final-payment receipt is not bound to the immutable obligation.",
    { status: 500 }
  );
  const state = paid
    ? "paid_handoff_pending"
    : reconciliation
      ? "payment_reconciliation_required"
      : ready
        ? "checkout_ready"
        : row.checkout_state === "ready"
          ? "checkout_expired"
          : release.approved
            ? "checkout_available"
            : "checkout_held";
  return deepFreeze({
    schema: CUSTOM_BUILD_FINAL_STATE_SCHEMA,
    state,
    projectId: row.project_id,
    jobId: row.job_id,
    completion,
    obligation,
    invoice: {
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      invoiceDigest: row.invoice_digest,
      purpose: "custom_build_final",
      issuedAt: iso(row.issued_at, "Final invoice issue time"),
      lines: lines.map((line) => Object.freeze({
        lineNumber: Number(line.lineNumber),
        componentKey: line.componentKey,
        displayName: line.displayName,
        quantity: Number(line.quantity),
        unitAmountMinor: Number(line.unitAmountMinor),
        creditMinor: 0,
        amountMinor: Number(line.amountMinor),
        currency: "USD"
      })),
      subtotal: { amountMinor, currency: "USD" },
      credit: { amountMinor: 0, currency: "USD" },
      tax: paid
        ? {
            amountMinor: boundedInteger(row.tax_minor, "Final receipt tax", {
              zero: true
            }),
            state: "settled"
          }
        : { amountMinor: null, state: "calculated_at_checkout" },
      total: paid
        ? {
            amountMinor: boundedInteger(row.total_minor, "Final receipt total"),
            currency: "USD",
            state: "settled"
          }
        : { amountMinor: null, currency: "USD", state: "shown_at_checkout" }
    },
    payment: {
      state: paid
        ? "paid"
        : reconciliation
          ? "reconciliation_required"
          : ready
            ? "checkout_ready"
            : row.checkout_state === "ready"
              ? "checkout_expired"
              : release.approved
                ? "checkout_available"
                : "held",
      chargeOccurred: paid,
      checkoutUrl: ready ? row.checkout_url : null,
      checkoutExpiresAt: ready
        ? iso(row.checkout_expires_at, "Final Checkout expiration")
        : null,
      settledAt: paid ? iso(row.settled_at, "Final settlement time") : null
    },
    handoff: {
      state: paid ? "pending" : "unavailable",
      documentId: null,
      workmanshipStartsAt: null,
      workmanshipEndsAt: null
    },
    action: {
      checkoutAvailable: state === "checkout_available",
      handoffAvailable: false,
      reason: state === "checkout_available" ? null : state
    }
  });
}

const FINAL_STATE_SELECT = `
  select
    obligation.id as obligation_id,
    obligation.organization_id,
    obligation.project_id,
    obligation.case_id,
    obligation.customer_user_id,
    obligation.job_id,
    obligation.quote_id,
    obligation.quote_revision,
    obligation.quote_revision_id,
    obligation.quote_acceptance_id,
    obligation.quote_installment_id,
    obligation.installment_number,
    obligation.completion_package_id,
    obligation.completion_package_digest,
    package.prepared_at as completion_prepared_at,
    obligation.base_scope_digest,
    pg_catalog.to_json(obligation.effective_change_order_digests)
      as effective_change_order_digests,
    obligation.effective_scope_digest,
    obligation.accepted_quote_digest,
    obligation.accepted_disclosure_digest,
    obligation.commercial_contract_digest,
    obligation.final_due_minor,
    obligation.credit_minor,
    obligation.currency,
    obligation.workmanship_correction_days,
    obligation.bound_at,
    obligation.obligation_digest,
    invoice.id as invoice_id,
    invoice.invoice_number,
    invoice.subtotal_minor as invoice_subtotal_minor,
    invoice.credit_minor as invoice_credit_minor,
    invoice.invoice_digest,
    invoice.issued_at,
    clearance.id as zero_balance_clearance_id,
    clearance.clearance_digest as zero_balance_clearance_digest,
    clearance.cleared_at as zero_balance_cleared_at,
    attempt.id as checkout_attempt_id,
    attempt.state as checkout_state,
    attempt.provider_effect_certainty,
    attempt.provider_error_code,
    attempt.provider_request_expires_at,
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
      and receipt.project_id = obligation.project_id
      and receipt.case_id = obligation.case_id
      and receipt.customer_user_id = obligation.customer_user_id
      and receipt.job_id = obligation.job_id
      and receipt.obligation_id = obligation.id
      and receipt.completion_package_id = obligation.completion_package_id
      and receipt.invoice_id = invoice.id
      and receipt.checkout_attempt_id = attempt.id
      and receipt.provider = 'stripe'
      and receipt.receipt_source in ('stripe_event', 'provider_readback')
      and receipt.payment_status = 'paid'
      and receipt.charge_captured
      and receipt.amount_refunded_minor = 0
      and not receipt.disputed
      and receipt.subtotal_minor = obligation.final_due_minor
      and receipt.currency = obligation.currency
      and receipt.purpose_digest = attempt.purpose_digest
      and receipt.completion_package_digest =
        obligation.completion_package_digest
      and receipt.obligation_digest = obligation.obligation_digest
      and receipt.invoice_digest = invoice.invoice_digest
      and receipt.accepted_quote_digest = obligation.accepted_quote_digest
      and receipt.accepted_disclosure_digest =
        obligation.accepted_disclosure_digest
    ) as receipt_linkage_valid,
    coalesce(line_rows.items, '[]'::jsonb) as lines
  from ss.service_custom_build_final_obligations obligation
  join ss.service_custom_build_completion_packages package
    on package.organization_id = obligation.organization_id
   and package.id = obligation.completion_package_id
  left join ss.service_custom_build_final_invoices invoice
    on invoice.organization_id = obligation.organization_id
   and invoice.obligation_id = obligation.id
  left join ss.service_custom_build_final_zero_balance_clearances clearance
    on clearance.organization_id = obligation.organization_id
   and clearance.obligation_id = obligation.id
  left join lateral (
    select candidate.*
    from ss.service_custom_build_final_checkout_attempts candidate
    where candidate.organization_id = obligation.organization_id
      and candidate.obligation_id = obligation.id
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) attempt on true
  left join lateral (
    select candidate.*
    from ss.service_custom_build_final_stripe_events candidate
    where candidate.organization_id = obligation.organization_id
      and candidate.obligation_id = obligation.id
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) event on true
  left join ss.service_custom_build_final_payment_receipts receipt
    on receipt.organization_id = obligation.organization_id
   and receipt.obligation_id = obligation.id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'amountMinor', line.amount_minor,
      'componentKey', line.component_key,
      'creditMinor', line.credit_minor,
      'displayName', line.display_name,
      'lineNumber', line.line_number,
      'quantity', line.quantity,
      'unitAmountMinor', line.unit_amount_minor
    ) order by line.line_number) as items
    from ss.service_custom_build_final_invoice_lines line
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
    "The verified Custom-build final-payment Stripe event is invalid.",
    { status: 400 }
  );
  const metadata = structuredClone(value.data.object.metadata);
  const expectedKeys = [
    "accepted_disclosure_digest",
    "accepted_quote_digest",
    "base_scope_digest",
    "commercial_contract_digest",
    "completion_package_digest",
    "completion_package_id",
    "customer_id",
    "effective_change_order_digests_digest",
    "effective_scope_digest",
    "final_obligation_digest",
    "final_obligation_id",
    "installment_number",
    "invoice_digest",
    "invoice_id",
    "invoice_number",
    "job_id",
    "project_id",
    "purpose_digest",
    "quote_acceptance_id",
    "quote_id",
    "quote_revision_id",
    "schema",
    "tenant_id",
    "workmanship_correction_days"
  ];
  exactKeys(
    metadata,
    expectedKeys,
    "STRIPE_EVENT_INVALID",
    "The verified Custom-build final-payment Stripe metadata is invalid."
  );
  invariant(
    metadata.schema === CUSTOM_BUILD_FINAL_PAYMENT_METADATA_SCHEMA &&
      [
        metadata.tenant_id,
        metadata.customer_id,
        metadata.project_id,
        metadata.job_id,
        metadata.quote_id,
        metadata.quote_revision_id,
        metadata.quote_acceptance_id,
        metadata.completion_package_id,
        metadata.final_obligation_id,
        metadata.invoice_id
      ].every((entry) => UUID.test(String(entry ?? ""))) &&
      INVOICE_NUMBER.test(String(metadata.invoice_number ?? "")) &&
      metadata.installment_number === "2" &&
      metadata.workmanship_correction_days === "30" &&
      [
        metadata.accepted_disclosure_digest,
        metadata.accepted_quote_digest,
        metadata.base_scope_digest,
        metadata.commercial_contract_digest,
        metadata.completion_package_digest,
        metadata.effective_change_order_digests_digest,
        metadata.effective_scope_digest,
        metadata.final_obligation_digest,
        metadata.invoice_digest,
        metadata.purpose_digest
      ].every((entry) => SHA256.test(String(entry ?? ""))),
    "STRIPE_EVENT_INVALID",
    "The verified Custom-build final-payment Stripe metadata is invalid.",
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

function paymentResolutionFromRow(row) {
  const purpose = positivePurposeFromRow(row);
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
        row.completion_package_id,
        row.obligation_id,
        row.invoice_id,
        attemptId
      ].every((entry) => UUID.test(String(entry ?? ""))) &&
      CHECKOUT_ID.test(String(row.checkout_session_id ?? "")),
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    "The retained Custom-build final-payment resolution is invalid.",
    { status: 500 }
  );
  return deepFreeze({
    organizationId: row.organization_id,
    projectId: row.project_id,
    caseId: row.case_id,
    customerId: row.customer_user_id,
    jobId: row.job_id,
    completionPackageId: row.completion_package_id,
    obligationId: row.obligation_id,
    invoiceId: row.invoice_id,
    attemptId,
    checkoutSessionId: row.checkout_session_id,
    purpose,
    purposeDigest
  });
}

function exactPaymentFacts(value, resolution) {
  exactKeys(
    value,
    [
      "amountRefundedMinor",
      "chargeCaptured",
      "chargeId",
      "checkoutSessionId",
      "currency",
      "customerId",
      "disputed",
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
    "CUSTOM_BUILD_FINAL_PAYMENT_EVIDENCE_INVALID",
    "Stripe Custom-build final-payment evidence is invalid.",
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
      CHARGE_ID.test(String(value.chargeId ?? "")) &&
      STRIPE_CUSTOMER_ID.test(String(value.customerId ?? "")) &&
      value.paymentStatus === "paid" &&
      value.chargeCaptured === true &&
      value.amountRefundedMinor === 0 &&
      value.disputed === false &&
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
    "CUSTOM_BUILD_FINAL_PAYMENT_EVIDENCE_INVALID",
    "Stripe did not confirm the exact captured, unrefunded, uncontested final payment.",
    { status: 502 }
  );
  return deepFreeze(structuredClone(value));
}

function exactLifecycle(value, resolution) {
  exactKeys(
    value,
    ["checkoutSessionId", "provider", "purposeDigest", "schema", "state"],
    "CUSTOM_BUILD_FINAL_CHECKOUT_LIFECYCLE_INVALID",
    "Stripe Custom-build final Checkout lifecycle is invalid.",
    502
  );
  invariant(
    value.schema === LIFECYCLE_SCHEMA &&
      value.provider === "stripe" &&
      value.checkoutSessionId === resolution.checkoutSessionId &&
      value.purposeDigest === resolution.purposeDigest &&
      ["open", "expired", "paid"].includes(value.state),
    "CUSTOM_BUILD_FINAL_CHECKOUT_LIFECYCLE_INVALID",
    "Stripe Custom-build final Checkout lifecycle changed.",
    { status: 502 }
  );
  return deepFreeze(structuredClone(value));
}

function settlementResult(value, expected = {}) {
  exactKeys(
    value,
    [
      "completionPackageId",
      "invoiceId",
      "jobId",
      "next",
      "receiptId",
      "schema",
      "status"
    ],
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    "The retained Custom-build final-payment settlement is invalid.",
    500
  );
  invariant(
    value.schema === CUSTOM_BUILD_FINAL_SETTLEMENT_SCHEMA &&
      value.status === "payment_settled" &&
      value.next === "custom_build_handoff" &&
      [
        value.completionPackageId,
        value.invoiceId,
        value.jobId,
        value.receiptId
      ].every((entry) => UUID.test(String(entry ?? ""))) &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    "The retained Custom-build final-payment settlement changed.",
    { status: 500 }
  );
  return deepFreeze(structuredClone(value));
}

const OWNER_RECONCILIATION_STATES = Object.freeze({
  checkout_ready: Object.freeze({
    action: "creation_reconciled",
    next: "customer_checkout"
  }),
  payment_settled: Object.freeze({
    action: "settlement_reconciled",
    next: "custom_build_handoff"
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
        resolution.invoiceId
      ].every((entry) => UUID.test(String(entry ?? ""))) &&
      (reason === null || SAFE_CODE.test(reason)) &&
      (status === "checkout_ready"
        ? checkout?.schema === CUSTOM_BUILD_FINAL_CHECKOUT_SCHEMA &&
          checkout?.state === "ready" &&
          settlement === null
        : checkout === null) &&
      (status === "payment_settled"
        ? settlement?.schema === CUSTOM_BUILD_FINAL_SETTLEMENT_SCHEMA &&
          settlement?.status === "payment_settled"
        : settlement === null),
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    "The Custom-build final-payment reconciliation result is invalid.",
    { status: 500 }
  );
  return deepFreeze({
    schema: OWNER_RECONCILIATION_SCHEMA,
    status,
    organizationId: resolution.organizationId,
    jobId: resolution.jobId,
    attemptId: resolution.attemptId,
    invoiceId: resolution.invoiceId,
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
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    "The retained Custom-build final-payment reconciliation result is invalid.",
    500
  );
  invariant(
    value.schema === OWNER_RECONCILIATION_SCHEMA &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
    "The retained owner final-payment reconciliation result changed.",
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

function reconciliationRequiredResult(resolution) {
  return deepFreeze({
    schema: "sitesourcery.custom-build-final-reconciliation/v1",
    status: "reconciliation_required",
    projectId: resolution.projectId,
    invoiceId: resolution.invoiceId,
    next: "owner_review"
  });
}

export function isPotentialCustomBuildFinalPaymentStripeEvent(event) {
  return event?.type === EVENT_TYPE &&
    event?.data?.object?.metadata?.schema ===
      CUSTOM_BUILD_FINAL_PAYMENT_METADATA_SCHEMA;
}

function held() {
  throw new HostedError(
    "CUSTOM_BUILD_FINAL_PAYMENT_HELD",
    "Custom-build final payment is held in this runtime.",
    { status: 503 }
  );
}

export function createHeldCustomServicesCustomBuildFinalPayment() {
  return Object.freeze({
    async readiness() {
      return deepFreeze({
        schema: READINESS_SCHEMA,
        ready: false,
        state: "held"
      });
    },
    async readCurrentState(value) {
      customerScope(value);
      return held();
    },
    async readOwnerFinalPayments(actor, jobIdValue, organizationIdValue) {
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
    async ingestStripeEvent(value) {
      invariant(
        isPotentialCustomBuildFinalPaymentStripeEvent(value),
        "STRIPE_EVENT_INVALID",
        "The Stripe event is not a Custom-build final-payment event.",
        { status: 400 }
      );
      return held();
    }
  });
}

export function createPostgresCustomServicesCustomBuildFinalPayment({
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

  async function readCurrentState(value) {
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
          `${FINAL_STATE_SELECT}
           where obligation.organization_id = $1
             and obligation.project_id = $2
             and obligation.customer_user_id = $3
           order by obligation.bound_at desc, obligation.id desc
           limit 1`,
          [scope.organizationId, scope.projectId, scope.customerId]
        );
        invariant(
          selected.rowCount <= 1,
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "The Custom-build final-payment state conflicts.",
          { status: 500 }
        );
        return customerProjection(
          selected.rows[0] ?? null,
          paymentRelease,
          paymentClock,
          scope
        );
      }
    ));
  }

  async function readOwnerFinalPayments(
    actor,
    jobIdValue,
    organizationIdValue
  ) {
    const operatorId = actorId(actor);
    const jobId = uuid(jobIdValue, "jobId");
    const organizationId = uuid(organizationIdValue, "organizationId");
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
          "CUSTOM_BUILD_FINAL_PAYMENT_UNAVAILABLE",
          "That Custom-build final payment is unavailable.",
          { status: 404 }
        );
        const selected = await client.query(
          `${FINAL_STATE_SELECT}
           where obligation.organization_id = $1
             and obligation.job_id = $2
           order by obligation.bound_at desc, obligation.id desc
           limit 1`,
          [organizationId, jobId]
        );
        invariant(
          selected.rowCount === 1,
          "CUSTOM_BUILD_FINAL_PAYMENT_UNAVAILABLE",
          "That Custom-build final payment is unavailable.",
          { status: 404 }
        );
        const row = selected.rows[0];
        return deepFreeze({
          schema: OWNER_SCHEMA,
          organizationId,
          jobId,
          finalPayment: customerProjection(
            row,
            paymentRelease,
            paymentClock
          ),
          owner: {
            attemptId: row.checkout_attempt_id,
            attemptState: row.checkout_state,
            providerEffectCertainty: row.provider_effect_certainty,
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
          text: `/* final:stage:discover */
                 select obligation.job_id
                 from ss.service_custom_build_final_invoices invoice
                 join ss.service_custom_build_final_obligations obligation
                   on obligation.organization_id = invoice.organization_id
                  and obligation.id = invoice.obligation_id
                 where invoice.organization_id = $1
                   and obligation.project_id = $2
                   and obligation.customer_user_id = $3
                   and invoice.id = $4`,
          values: [
            input.organizationId,
            input.projectId,
            input.customerId,
            input.invoiceId
          ],
          code: "CUSTOM_BUILD_FINAL_INVOICE_UNAVAILABLE",
          message: "The Custom-build final invoice is unavailable.",
          status: 404
        });
        const requestDigest = checkoutRequestDigest(input);
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
            prior.rows[0].organization_id === input.organizationId &&
              prior.rows[0].request_digest === requestDigest,
            "idempotency_conflict",
            "That Custom-build final-payment command was already used differently.",
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
            "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
            "An earlier final-payment command has not reached a safe final state.",
            { status: 503 }
          );
        }
        invariant(
          prior.rowCount === 0,
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "The Custom-build final-payment command conflicts.",
          { status: 500 }
        );

        const invoiceResult = await client.query(
          `select
             obligation.id as obligation_id,
             obligation.organization_id,
             obligation.project_id,
             obligation.case_id,
             obligation.customer_user_id,
             obligation.job_id,
             obligation.quote_id,
             obligation.quote_revision_id,
             obligation.quote_acceptance_id,
             obligation.quote_installment_id,
             obligation.installment_number,
             obligation.completion_package_id,
             obligation.completion_package_digest,
             obligation.base_scope_digest,
             pg_catalog.to_json(obligation.effective_change_order_digests)
               as effective_change_order_digests,
             obligation.effective_scope_digest,
             obligation.accepted_quote_digest,
             obligation.accepted_disclosure_digest,
             obligation.commercial_contract_digest,
             obligation.final_due_minor,
             obligation.credit_minor,
             obligation.currency,
             obligation.workmanship_correction_days,
             obligation.obligation_digest,
             invoice.id as invoice_id,
             invoice.invoice_number,
             invoice.subtotal_minor as invoice_subtotal_minor,
             invoice.credit_minor as invoice_credit_minor,
             invoice.invoice_digest,
             customer.stripe_customer_id,
             receipt.id as receipt_id,
             line.line_number,
             line.component_key,
             line.quantity,
             line.unit_amount_minor,
             line.credit_minor as line_credit_minor,
             line.amount_minor
           from ss.service_custom_build_final_obligations obligation
           join ss.service_custom_build_final_invoices invoice
             on invoice.organization_id = obligation.organization_id
            and invoice.obligation_id = obligation.id
           join ss.service_custom_build_final_invoice_lines line
             on line.organization_id = invoice.organization_id
            and line.invoice_id = invoice.id
           left join ss.stripe_customers customer
             on customer.organization_id = obligation.organization_id
           left join ss.service_custom_build_final_payment_receipts receipt
             on receipt.organization_id = obligation.organization_id
            and receipt.obligation_id = obligation.id
           where obligation.organization_id = $1
             and obligation.project_id = $2
             and obligation.customer_user_id = $3
             and invoice.id = $4
           for update of obligation, invoice`,
          [
            input.organizationId,
            input.projectId,
            input.customerId,
            input.invoiceId
          ]
        );
        invariant(
          invoiceResult.rowCount === 1,
          "CUSTOM_BUILD_FINAL_INVOICE_UNAVAILABLE",
          "The Custom-build final invoice is unavailable.",
          { status: 404 }
        );
        const invoice = invoiceResult.rows[0];
        invariant(
          invoice.job_id === jobId &&
            invoice.invoice_digest === input.invoiceDigest &&
            Number(invoice.final_due_minor) > 0 &&
            Number(invoice.installment_number) === 2 &&
            Number(invoice.credit_minor) === 0 &&
            Number(invoice.invoice_subtotal_minor) ===
              Number(invoice.final_due_minor) &&
            Number(invoice.invoice_credit_minor) === 0 &&
            invoice.line_number === 1 &&
            invoice.component_key === "custom_build_final_installment" &&
            Number(invoice.quantity) === 1 &&
            Number(invoice.unit_amount_minor) ===
              Number(invoice.final_due_minor) &&
            Number(invoice.line_credit_minor) === 0 &&
            Number(invoice.amount_minor) === Number(invoice.final_due_minor) &&
            invoice.receipt_id === null,
          "CUSTOM_BUILD_FINAL_INVOICE_CHANGED",
          "The Custom-build final invoice is no longer payable.",
          { status: 409 }
        );

        const active = await client.query(
          `select attempt.*, invoice.invoice_number
           from ss.service_custom_build_final_checkout_attempts attempt
           join ss.service_custom_build_final_invoices invoice
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
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "More than one Custom-build final Checkout is active.",
          { status: 500 }
        );
        if (active.rowCount === 1) {
          const attempt = active.rows[0];
          if (
            attempt.state === "ready" &&
            Date.parse(iso(attempt.expires_at, "Final Checkout expiration")) >
              Date.parse(iso(paymentClock.now(), "Final-payment clock"))
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
                 201, $7::jsonb, 'custom_build_final_checkout',
                 $8, clock_timestamp(), clock_timestamp() + interval '24 hours'
               )`,
              [
                uuid(
                  paymentIds.next("final_checkout_replay_command"),
                  "command ID",
                  "RUNTIME_CONFIGURATION_ERROR",
                  500
                ),
                input.organizationId,
                input.customerId,
                CHECKOUT_ROUTE,
                input.commandId,
                requestDigest,
                JSON.stringify(result),
                attempt.id
              ]
            );
            return { status: "replay", result };
          }
          if (
            attempt.state === "ready" &&
            Date.parse(iso(attempt.expires_at, "Final Checkout expiration")) <=
              Date.parse(iso(paymentClock.now(), "Final-payment clock"))
          ) {
            return { status: "expired", attempt };
          }
          throw new HostedError(
            "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
            "The earlier final-payment page must be reconciled before another can open.",
            { status: 503 }
          );
        }

        const purpose = positivePurposeFromRow(invoice);
        const purposeDigest = digest(purpose);
        const providerRequestExpiresAt =
          checkoutRequestExpiration(paymentClock);
        const attemptId = uuid(
          paymentIds.next("custom_build_final_checkout"),
          "Final Checkout attempt ID",
          "RUNTIME_CONFIGURATION_ERROR",
          500
        );
        const commandRowId = uuid(
          paymentIds.next("custom_build_final_checkout_command"),
          "Final Checkout command ID",
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
             'custom_build_final_checkout', $7,
             clock_timestamp(), clock_timestamp() + interval '24 hours'
           )`,
          [
            commandRowId,
            input.organizationId,
            input.customerId,
            CHECKOUT_ROUTE,
            input.commandId,
            requestDigest,
            attemptId
          ]
        );
        await client.query(
          `insert into ss.service_custom_build_final_checkout_attempts (
             id, organization_id, project_id, customer_user_id,
             job_id, obligation_id, completion_package_id, invoice_id,
             command_id, provider, purpose, purpose_digest,
             obligation_digest, completion_package_digest, invoice_digest,
             accepted_quote_digest, accepted_disclosure_digest,
             expected_subtotal_minor, currency, tax_mode,
             provider_request_expires_at, state, provider_effect_certainty
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8, $9,
             'stripe', 'custom_build_final', $10, $11, $12, $13,
             $14, $15, $16, 'USD', 'automatic', $17,
             'provider_pending', 'ambiguous'
           )`,
          [
            attemptId,
            input.organizationId,
            input.projectId,
            input.customerId,
            jobId,
            invoice.obligation_id,
            invoice.completion_package_id,
            input.invoiceId,
            input.commandId,
            purposeDigest,
            invoice.obligation_digest,
            invoice.completion_package_digest,
            input.invoiceDigest,
            invoice.accepted_quote_digest,
            invoice.accepted_disclosure_digest,
            invoice.final_due_minor,
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
          text: `/* final:finish:discover */
                 select job_id
                 from ss.service_custom_build_final_checkout_attempts
                 where organization_id = $1 and id = $2`,
          values: [input.organizationId, claim.attemptId],
          expectedJobId: claim.jobId,
          code: "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
          message: "The final-payment authority changed during Checkout.",
          status: 503
        });
        const selected = await client.query(
          `select attempt.*, invoice.invoice_number
           from ss.service_custom_build_final_checkout_attempts attempt
           join ss.service_custom_build_final_invoices invoice
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
          "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
          "The final-payment authority changed during Checkout.",
          { status: 503 }
        );
        const updated = await client.query(
          `update ss.service_custom_build_final_checkout_attempts
           set state = 'ready', provider_effect_certainty = 'confirmed',
               checkout_session_id = $3, checkout_url = $4, expires_at = $5
           where organization_id = $1 and id = $2
             and state = 'provider_pending'`,
          [
            input.organizationId,
            claim.attemptId,
            evidence.checkoutId,
            evidence.url,
            evidence.expiresAt
          ]
        );
        invariant(
          updated.rowCount === 1,
          "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
          "The final-payment Checkout could not be retained.",
          { status: 503 }
        );
        const finalized = await client.query(
          `select attempt.*, invoice.invoice_number
           from ss.service_custom_build_final_checkout_attempts attempt
           join ss.service_custom_build_final_invoices invoice
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
          "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
          "The final-payment command could not be completed.",
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
            text: `/* final:failure:discover */
                   select job_id
                   from ss.service_custom_build_final_checkout_attempts
                   where organization_id = $1 and id = $2`,
            values: [input.organizationId, claim.attemptId],
            expectedJobId: claim.jobId,
            code: "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
            message:
              "The final-payment authority changed while retaining provider certainty.",
            status: 503
          });
          await client.query(
            `update ss.service_custom_build_final_checkout_attempts
             set state = $3, provider_effect_certainty = $4,
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
      // A provider-pending attempt still fences unsafe automatic replay if
      // writing the provider certainty itself becomes uncertain.
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
          text: `/* final:event_claim:discover */
                 select job_id
                 from ss.service_custom_build_final_checkout_attempts
                 where organization_id = $1
                   and checkout_session_id = $2`,
          values: [event.metadata.tenant_id, event.checkoutSessionId],
          expectedJobId: event.metadata.job_id,
          code: "STRIPE_EVENT_BINDING_INVALID",
          message:
            "The Stripe event does not identify one retained Custom-build final Checkout.",
          status: 400
        });
        const selected = await client.query(
          `select
             attempt.id as attempt_id,
             attempt.organization_id,
             attempt.project_id,
             attempt.customer_user_id,
             attempt.job_id,
             attempt.obligation_id,
             attempt.completion_package_id,
             attempt.invoice_id,
             attempt.checkout_session_id,
             attempt.purpose_digest,
             attempt.state as attempt_state,
             obligation.case_id,
             obligation.quote_id,
             obligation.quote_revision_id,
             obligation.quote_acceptance_id,
             obligation.quote_installment_id,
             obligation.installment_number,
             obligation.completion_package_digest,
             obligation.base_scope_digest,
             pg_catalog.to_json(obligation.effective_change_order_digests)
               as effective_change_order_digests,
             obligation.effective_scope_digest,
             obligation.accepted_quote_digest,
             obligation.accepted_disclosure_digest,
             obligation.commercial_contract_digest,
             obligation.final_due_minor,
             obligation.credit_minor,
             obligation.currency,
             obligation.workmanship_correction_days,
             obligation.obligation_digest,
             invoice.invoice_number,
             invoice.subtotal_minor as invoice_subtotal_minor,
             invoice.credit_minor as invoice_credit_minor,
             invoice.invoice_digest
           from ss.service_custom_build_final_checkout_attempts attempt
           join ss.service_custom_build_final_obligations obligation
             on obligation.organization_id = attempt.organization_id
            and obligation.id = attempt.obligation_id
           join ss.service_custom_build_final_invoices invoice
             on invoice.organization_id = attempt.organization_id
            and invoice.id = attempt.invoice_id
           where attempt.organization_id = $1
             and attempt.checkout_session_id = $2
           for update of attempt`,
          [event.metadata.tenant_id, event.checkoutSessionId]
        );
        invariant(
          selected.rowCount === 1 &&
            ["ready", "paid"].includes(selected.rows[0].attempt_state),
          "STRIPE_EVENT_BINDING_INVALID",
          "The Stripe event does not identify a payable final Checkout.",
          { status: 400 }
        );
        const resolution = paymentResolutionFromRow(selected.rows[0]);
        exactMetadata(
          event.metadata,
          resolution.purpose,
          resolution.purposeDigest,
          "STRIPE_EVENT_BINDING_INVALID"
        );
        const retained = await client.query(
          `select *
           from ss.service_custom_build_final_stripe_events
           where id = $1
           for update`,
          [event.eventId]
        );
        if (retained.rowCount === 0) {
          await client.query(
            `insert into ss.service_custom_build_final_stripe_events (
               id, organization_id, project_id, customer_user_id,
               job_id, obligation_id, completion_package_id, invoice_id,
               checkout_attempt_id, event_type, livemode, api_version,
               checkout_session_id, payload_digest, provider_created_at,
               signature_verified_at, state
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15, $16, 'pending'
             )`,
            [
              event.eventId,
              resolution.organizationId,
              resolution.projectId,
              resolution.customerId,
              resolution.jobId,
              resolution.obligationId,
              resolution.completionPackageId,
              resolution.invoiceId,
              resolution.attemptId,
              event.eventType,
              event.livemode,
              event.apiVersion,
              resolution.checkoutSessionId,
              event.payloadDigest,
              event.providerCreatedAt,
              event.signatureVerifiedAt
            ]
          );
          return { status: "pending", resolution };
        }
        const retainedRow = retained.rows[0];
        invariant(
          retained.rowCount === 1 &&
            retainedRow.organization_id === resolution.organizationId &&
            retainedRow.job_id === resolution.jobId &&
            retainedRow.checkout_attempt_id === resolution.attemptId &&
            retainedRow.checkout_session_id ===
              resolution.checkoutSessionId &&
            retainedRow.payload_digest === event.payloadDigest,
          "STRIPE_EVENT_CONFLICT",
          "The Stripe event ID was retained with different final-payment evidence.",
          { status: 409 }
        );
        if (retainedRow.state === "processed") {
          return {
            status: "processed",
            result: settlementResult(retainedRow.result, {
              completionPackageId: resolution.completionPackageId,
              invoiceId: resolution.invoiceId,
              jobId: resolution.jobId
            })
          };
        }
        if (retainedRow.state === "reconciliation_required") {
          return {
            status: "reconciliation_required",
            result: reconciliationRequiredResult(resolution)
          };
        }
        invariant(
          retainedRow.state === "pending",
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "The retained final-payment Stripe event is invalid.",
          { status: 500 }
        );
        return { status: "pending", resolution };
      }
    ));
  }

  async function markReconciliation(event, resolution, errorCode) {
    const selectedCode = providerCode(
      { code: errorCode },
      "stripe_custom_build_final_payment_mismatch"
    );
    return translated(() => database.service(
      {
        actorKind: "system",
        organizationId: resolution.organizationId
      },
      async (client) => {
        await discoverAndLockJob(client, {
          text: `/* final:event_reconcile:discover */
                 select job_id
                 from ss.service_custom_build_final_stripe_events
                 where organization_id = $1 and id = $2`,
          values: [resolution.organizationId, event.eventId],
          expectedJobId: resolution.jobId,
          code: "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          message: "Unsafe final-payment evidence could not be retained.",
          status: 500
        });
        const eventUpdate = await client.query(
          `update ss.service_custom_build_final_stripe_events
           set state = 'reconciliation_required',
               reconciliation_code = $3,
               completed_at = clock_timestamp()
           where organization_id = $1 and id = $2 and state = 'pending'`,
          [resolution.organizationId, event.eventId, selectedCode]
        );
        invariant(
          eventUpdate.rowCount === 1,
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "Unsafe final-payment evidence could not be retained.",
          { status: 500 }
        );
        return reconciliationRequiredResult(resolution);
      }
    ));
  }

  async function settle(evidence, resolution, payment, ownerCommand = null) {
    const eventId = evidence.eventId ?? null;
    const verifiedAt = iso(
      evidence.verifiedAt,
      "Provider evidence verification time"
    );
    return translated(() => database.service(
      {
        actorKind: ownerCommand === null ? "system" : "operator",
        ...(ownerCommand === null ? {} : { userId: ownerCommand.operatorId }),
        organizationId: resolution.organizationId
      },
      async (client) => {
        await discoverAndLockJob(client, {
          text: `/* final:${ownerCommand === null
            ? "settlement"
            : "owner_settlement"}:discover */
                 select job_id
                 from ss.service_custom_build_final_checkout_attempts
                 where organization_id = $1 and id = $2`,
          values: [resolution.organizationId, resolution.attemptId],
          expectedJobId: resolution.jobId,
          code: "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          message: "The final-payment settlement authority is unavailable.",
          status: 409
        });

        if (ownerCommand !== null) {
          const command = await client.query(
            `select *
             from ss.service_custom_build_final_reconciliation_commands
             where organization_id = $1 and id = $2
             for update`,
            [resolution.organizationId, ownerCommand.commandRowId]
          );
          invariant(
            command.rowCount === 1 &&
              command.rows[0].operator_user_id === ownerCommand.operatorId &&
              command.rows[0].checkout_attempt_id === resolution.attemptId,
            "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
            "The owner final-payment command changed before settlement.",
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
             obligation.id as obligation_id,
             obligation.organization_id,
             obligation.project_id,
             obligation.case_id,
             obligation.customer_user_id,
             obligation.job_id,
             obligation.quote_id,
             obligation.quote_revision_id,
             obligation.quote_acceptance_id,
             obligation.quote_installment_id,
             obligation.installment_number,
             obligation.completion_package_id,
             obligation.completion_package_digest,
             obligation.base_scope_digest,
             pg_catalog.to_json(obligation.effective_change_order_digests)
               as effective_change_order_digests,
             obligation.effective_scope_digest,
             obligation.accepted_quote_digest,
             obligation.accepted_disclosure_digest,
             obligation.commercial_contract_digest,
             obligation.final_due_minor,
             obligation.credit_minor,
             obligation.currency,
             obligation.workmanship_correction_days,
             obligation.obligation_digest,
             invoice.id as invoice_id,
             invoice.invoice_number,
             invoice.subtotal_minor as invoice_subtotal_minor,
             invoice.credit_minor as invoice_credit_minor,
             invoice.invoice_digest,
             attempt.id as attempt_id,
             attempt.state as attempt_state,
             attempt.checkout_session_id,
             attempt.purpose_digest,
             receipt.id as receipt_id,
             receipt.checkout_session_id as receipt_checkout_session_id,
             receipt.payment_intent_id as receipt_payment_intent_id,
             receipt.charge_id as receipt_charge_id,
             receipt.stripe_customer_id as receipt_customer_id,
             receipt.subtotal_minor as receipt_subtotal_minor,
             receipt.tax_minor as receipt_tax_minor,
             receipt.total_minor as receipt_total_minor,
             receipt.provider_facts_digest as receipt_facts_digest
           from ss.service_custom_build_final_obligations obligation
           join ss.service_custom_build_final_invoices invoice
             on invoice.organization_id = obligation.organization_id
            and invoice.id = $2
           join ss.service_custom_build_final_checkout_attempts attempt
             on attempt.organization_id = obligation.organization_id
            and attempt.id = $3
           left join ss.service_custom_build_final_payment_receipts receipt
             on receipt.organization_id = obligation.organization_id
            and receipt.obligation_id = obligation.id
           where obligation.organization_id = $1
             and obligation.id = attempt.obligation_id
           for update of obligation, invoice, attempt`,
          [
            resolution.organizationId,
            resolution.invoiceId,
            resolution.attemptId
          ]
        );
        invariant(
          selected.rowCount === 1,
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "The final-payment settlement authority is unavailable.",
          { status: 409 }
        );
        const row = selected.rows[0];
        let eventRow = null;
        let retainedEventProcessed = false;
        const retainedEventId = eventId ??
          (ownerCommand === null
            ? null
            : resolution.reconciliationEventId ?? null);
        if (retainedEventId !== null) {
          const selectedEvent = await client.query(
            `select *
             from ss.service_custom_build_final_stripe_events
             where organization_id = $1 and id = $2
             for update`,
            [resolution.organizationId, retainedEventId]
          );
          invariant(
            selectedEvent.rowCount === 1 &&
              selectedEvent.rows[0].checkout_attempt_id ===
                resolution.attemptId &&
              selectedEvent.rows[0].checkout_session_id ===
                resolution.checkoutSessionId,
            "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
            "The retained Stripe event changed before settlement.",
            { status: 409 }
          );
          eventRow = selectedEvent.rows[0];
          retainedEventProcessed = eventRow.state === "processed";
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
               organization_id, stripe_customer_id, created_from_receipt_id
             ) values ($1, $2, null)`,
            [resolution.organizationId, payment.customerId]
          );
        } else {
          invariant(
            existingCustomer.rowCount === 1 &&
              existingCustomer.rows[0].stripe_customer_id ===
                payment.customerId,
            "CUSTOM_BUILD_FINAL_STRIPE_CUSTOMER_CONFLICT",
            "The final payment Customer does not match this account.",
            { status: 409 }
          );
        }

        let result;
        if (row.receipt_id !== null) {
          invariant(
            row.attempt_state === "paid" &&
              row.receipt_checkout_session_id === payment.checkoutSessionId &&
              row.receipt_payment_intent_id === payment.paymentIntentId &&
              row.receipt_charge_id === payment.chargeId &&
              row.receipt_customer_id === payment.customerId &&
              Number(row.receipt_subtotal_minor) === payment.subtotalMinor &&
              Number(row.receipt_tax_minor) === payment.taxMinor &&
              Number(row.receipt_total_minor) === payment.totalMinor &&
              row.receipt_facts_digest === payment.providerFactsDigest,
            "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
            "The retained Custom-build final-payment receipt changed.",
            { status: 409 }
          );
          result = settlementResult({
            completionPackageId: resolution.completionPackageId,
            invoiceId: resolution.invoiceId,
            jobId: resolution.jobId,
            next: "custom_build_handoff",
            receiptId: row.receipt_id,
            schema: CUSTOM_BUILD_FINAL_SETTLEMENT_SCHEMA,
            status: "payment_settled"
          });
          if (eventRow !== null && !retainedEventProcessed) {
            const alias = await client.query(
              `update ss.service_custom_build_final_stripe_events
               set state = 'processed', reconciliation_code = null,
                   result = $3::jsonb, completed_at = $4
               where organization_id = $1 and id = $2
                 and state in ('pending', 'reconciliation_required')`,
              [
                resolution.organizationId,
                retainedEventId,
                JSON.stringify(result),
                iso(paymentClock.now(), "Duplicate event completion time")
              ]
            );
            invariant(
              alias.rowCount === 1,
              "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
              "The duplicate final-payment Stripe event could not be sealed.",
              { status: 500 }
            );
            retainedEventProcessed = true;
          }
        } else {
          invariant(
            row.attempt_state === "ready" &&
              (eventRow === null ||
                ["pending", "reconciliation_required"].includes(
                  eventRow.state
                )) &&
              row.checkout_session_id === payment.checkoutSessionId &&
              row.purpose_digest === payment.purposeDigest &&
              row.invoice_digest === resolution.purpose.invoiceDigest &&
              row.completion_package_digest ===
                resolution.purpose.completionPackageDigest &&
              row.obligation_digest ===
                resolution.purpose.finalObligationDigest &&
              row.accepted_quote_digest ===
                resolution.purpose.acceptedQuoteDigest &&
              row.accepted_disclosure_digest ===
                resolution.purpose.acceptedDisclosureDigest &&
              Number(row.final_due_minor) === payment.subtotalMinor &&
              Number(row.installment_number) === 2 &&
              Number(row.credit_minor) === 0 &&
              Number(row.invoice_credit_minor) === 0,
            "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
            "The final-payment settlement state is inconsistent.",
            { status: 409 }
          );
          const receiptId = uuid(
            paymentIds.next("custom_build_final_receipt"),
            "Final-payment receipt ID",
            "RUNTIME_CONFIGURATION_ERROR",
            500
          );
          const settledAt = iso(
            paymentClock.now(),
            "Custom-build final settlement time"
          );
          invariant(
            Date.parse(settledAt) >= Date.parse(payment.providerPaymentTime) &&
              Date.parse(settledAt) >= Date.parse(verifiedAt),
            "CUSTOM_BUILD_FINAL_SETTLEMENT_CLOCK_INVALID",
            "Final settlement time precedes verified payment evidence.",
            { status: 500 }
          );
          await client.query(
            `insert into ss.service_custom_build_final_payment_receipts (
               id, organization_id, project_id, case_id,
               customer_user_id, job_id, obligation_id,
               completion_package_id, invoice_id, checkout_attempt_id,
               receipt_source, stripe_event_id,
               reconciled_by_operator_user_id, provider,
               checkout_session_id, payment_intent_id, charge_id,
               stripe_customer_id, payment_status, charge_captured,
               amount_refunded_minor, disputed, subtotal_minor, tax_minor,
               total_minor, tax_mode, currency, purpose, purpose_digest,
               obligation_digest, completion_package_digest,
               invoice_digest, accepted_quote_digest,
               accepted_disclosure_digest, provider_facts,
               provider_facts_digest, provider_paid_at, settled_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, 'stripe', $14, $15, $16, $17, 'paid',
               true, 0, false, $18, $19, $20, 'automatic', 'USD',
               'custom_build_final', $21, $22, $23, $24, $25, $26,
               $27::jsonb, $28, $29, $30
             )`,
            [
              receiptId,
              resolution.organizationId,
              resolution.projectId,
              resolution.caseId,
              resolution.customerId,
              resolution.jobId,
              resolution.obligationId,
              resolution.completionPackageId,
              resolution.invoiceId,
              resolution.attemptId,
              eventId === null ? "provider_readback" : "stripe_event",
              eventId,
              ownerCommand?.operatorId ?? null,
              payment.checkoutSessionId,
              payment.paymentIntentId,
              payment.chargeId,
              payment.customerId,
              payment.subtotalMinor,
              payment.taxMinor,
              payment.totalMinor,
              payment.purposeDigest,
              row.obligation_digest,
              row.completion_package_digest,
              row.invoice_digest,
              row.accepted_quote_digest,
              row.accepted_disclosure_digest,
              JSON.stringify(payment),
              payment.providerFactsDigest,
              payment.providerPaymentTime,
              settledAt
            ]
          );
          result = settlementResult({
            completionPackageId: resolution.completionPackageId,
            invoiceId: resolution.invoiceId,
            jobId: resolution.jobId,
            next: "custom_build_handoff",
            receiptId,
            schema: CUSTOM_BUILD_FINAL_SETTLEMENT_SCHEMA,
            status: "payment_settled"
          });
        }

        if (
          ownerCommand !== null &&
          eventRow !== null &&
          !retainedEventProcessed
        ) {
          const reconciledEvent = await client.query(
            `update ss.service_custom_build_final_stripe_events
             set state = 'processed', reconciliation_code = null,
                 result = $3::jsonb, completed_at = $4
             where organization_id = $1 and id = $2
               and state in ('pending', 'reconciliation_required')`,
            [
              resolution.organizationId,
              retainedEventId,
              JSON.stringify(result),
              iso(paymentClock.now(), "Owner event reconciliation time")
            ]
          );
          invariant(
            reconciledEvent.rowCount === 1,
            "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
            "The owner-confirmed final-payment event could not be sealed.",
            { status: 500 }
          );
          retainedEventProcessed = true;
        }

        if (ownerCommand === null) return result;
        const response = ownerReconciliationResult({
          status: "payment_settled",
          resolution,
          settlement: result
        });
        const completed = await client.query(
          `update ss.service_custom_build_final_reconciliation_commands
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
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "The owner final-payment command could not be sealed.",
          { status: 500 }
        );
        return response;
      }
    ));
  }

  async function claimOwnerReconciliation(actor, jobIdValue, value) {
    const input = ownerInput(actor, jobIdValue, value);
    const claim = await translated(() => database.service(
      {
        actorKind: "operator",
        userId: input.operatorId,
        organizationId: input.organizationId
      },
      async (client) => {
        const discoveredJobId = await discoverAndLockJob(client, {
          text: `/* final:owner_claim:discover */
                 select job_id
                 from ss.service_custom_build_final_checkout_attempts
                 where id = $1`,
          values: [input.attemptId],
          code: "CUSTOM_BUILD_FINAL_PAYMENT_UNAVAILABLE",
          message: "That Custom-build final payment is unavailable.",
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
          "CUSTOM_BUILD_FINAL_PAYMENT_UNAVAILABLE",
          "That Custom-build final payment is unavailable.",
          { status: 404 }
        );
        const request = await client.query(
          `select ss.custom_build_final_reconciliation_request_digest(
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
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "The owner final-payment command digest is unavailable.",
          { status: 500 }
        );
        const prior = await client.query(
          `select *
           from ss.service_custom_build_final_reconciliation_commands
           where command_id = $1
           for update`,
          [input.commandId]
        );
        let commandRowId;
        if (prior.rowCount === 1) {
          const row = prior.rows[0];
          invariant(
            row.organization_id === input.organizationId &&
              row.job_id === input.jobId &&
              row.checkout_attempt_id === input.attemptId &&
              row.operator_user_id === input.operatorId &&
              row.request_digest === requestDigest,
            "CUSTOM_BUILD_FINAL_PAYMENT_RECONCILIATION_IDEMPOTENCY_CONFLICT",
            "That owner final-payment command was already used differently.",
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
          invariant(
            row.state === "running",
            "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
            "The owner final-payment command state is invalid.",
            { status: 500 }
          );
          commandRowId = row.id;
        } else {
          invariant(
            prior.rowCount === 0 && discoveredJobId === input.jobId,
            "CUSTOM_BUILD_FINAL_PAYMENT_UNAVAILABLE",
            "That Custom-build final payment is unavailable.",
            { status: 404 }
          );
          commandRowId = uuid(
            paymentIds.next("custom_build_final_reconciliation_command"),
            "Owner final-payment command ID",
            "RUNTIME_CONFIGURATION_ERROR",
            500
          );
          await client.query(
            `insert into ss.service_custom_build_final_reconciliation_commands (
               id, organization_id, job_id, checkout_attempt_id,
               operator_user_id, command_id, request_digest, state
             ) values ($1, $2, $3, $4, $5, $6, $7, 'running')`,
            [
              commandRowId,
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
             attempt.id as attempt_id,
             attempt.organization_id,
             attempt.project_id,
             attempt.customer_user_id,
             attempt.job_id,
             attempt.obligation_id,
             attempt.completion_package_id,
             attempt.invoice_id,
             attempt.command_id as customer_command_id,
             attempt.checkout_session_id,
             attempt.purpose_digest,
             attempt.provider_request_expires_at,
             attempt.state as attempt_state,
             obligation.case_id,
             obligation.quote_id,
             obligation.quote_revision_id,
             obligation.quote_acceptance_id,
             obligation.quote_installment_id,
             obligation.installment_number,
             obligation.completion_package_digest,
             obligation.base_scope_digest,
             pg_catalog.to_json(obligation.effective_change_order_digests)
               as effective_change_order_digests,
             obligation.effective_scope_digest,
             obligation.accepted_quote_digest,
             obligation.accepted_disclosure_digest,
             obligation.commercial_contract_digest,
             obligation.final_due_minor,
             obligation.credit_minor,
             obligation.currency,
             obligation.workmanship_correction_days,
             obligation.obligation_digest,
             invoice.invoice_number,
             invoice.subtotal_minor as invoice_subtotal_minor,
             invoice.credit_minor as invoice_credit_minor,
             invoice.invoice_digest,
             receipt.id as receipt_id,
             customer.stripe_customer_id,
             event.id as reconciliation_event_id,
             event.state as reconciliation_event_state
           from ss.service_custom_build_final_checkout_attempts attempt
           join ss.service_custom_build_final_obligations obligation
             on obligation.organization_id = attempt.organization_id
            and obligation.id = attempt.obligation_id
           join ss.service_custom_build_final_invoices invoice
             on invoice.organization_id = attempt.organization_id
            and invoice.id = attempt.invoice_id
           left join ss.service_custom_build_final_payment_receipts receipt
             on receipt.organization_id = attempt.organization_id
            and receipt.invoice_id = attempt.invoice_id
           left join ss.stripe_customers customer
             on customer.organization_id = attempt.organization_id
           left join lateral (
             select candidate.id, candidate.state
             from ss.service_custom_build_final_stripe_events candidate
             where candidate.organization_id = attempt.organization_id
               and candidate.checkout_attempt_id = attempt.id
               and candidate.state in ('pending', 'reconciliation_required')
             order by candidate.created_at desc, candidate.id desc
             limit 1
           ) event on true
           where attempt.organization_id = $1 and attempt.id = $2
           for update of attempt`,
          [input.organizationId, input.attemptId]
        );
        invariant(
          selected.rowCount === 1 &&
            selected.rows[0].job_id === input.jobId &&
            discoveredJobId === input.jobId,
          "CUSTOM_BUILD_FINAL_PAYMENT_UNAVAILABLE",
          "That Custom-build final payment is unavailable.",
          { status: 404 }
        );
        const row = selected.rows[0];
        const purpose = positivePurposeFromRow(row);
        const purposeDigest = digest(purpose);
        invariant(
          row.purpose_digest === purposeDigest,
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "The retained final-payment purpose changed.",
          { status: 500 }
        );
        return deepFreeze({
          status: "claimed",
          input,
          commandRowId,
          resolution: {
            organizationId: row.organization_id,
            projectId: row.project_id,
            caseId: row.case_id,
            customerId: row.customer_user_id,
            jobId: row.job_id,
            completionPackageId: row.completion_package_id,
            obligationId: row.obligation_id,
            invoiceId: row.invoice_id,
            attemptId: row.attempt_id,
            checkoutSessionId: row.checkout_session_id,
            reconciliationEventId: row.reconciliation_event_id,
            purpose,
            purposeDigest
          },
          customerCommandId: row.customer_command_id,
          providerRequestExpiresAt: iso(
            row.provider_request_expires_at,
            "Provider-request expiration"
          ),
          attemptState: row.attempt_state,
          receiptId: row.receipt_id,
          stripeCustomerId: row.stripe_customer_id
        });
      }
    ));
    return claim;
  }

  async function finishOwnerCreation(claim, evidence) {
    const { input, resolution } = claim;
    return translated(() => database.service(
      {
        actorKind: "operator",
        userId: input.operatorId,
        organizationId: input.organizationId
      },
      async (client) => {
        await discoverAndLockJob(client, {
          text: `/* final:owner_creation:discover */
                 select job_id
                 from ss.service_custom_build_final_checkout_attempts
                 where organization_id = $1 and id = $2`,
          values: [input.organizationId, input.attemptId],
          expectedJobId: input.jobId,
          code: "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
          message: "The uncertain final Checkout changed before recovery.",
          status: 503
        });
        const command = await client.query(
          `select *
           from ss.service_custom_build_final_reconciliation_commands
           where organization_id = $1 and id = $2
           for update`,
          [input.organizationId, claim.commandRowId]
        );
        invariant(
          command.rowCount === 1,
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "The owner final-payment command is unavailable.",
          { status: 409 }
        );
        if (command.rows[0].state === "completed") {
          return retainedOwnerReconciliationResult(command.rows[0].result, {
            organizationId: input.organizationId,
            jobId: input.jobId,
            attemptId: input.attemptId
          });
        }
        const customerCommand = await client.query(
          `select * from ss.idempotency_keys
           where principal_id = $1 and route_key = $2
             and idempotency_key = $3
           for update`,
          [resolution.customerId, CHECKOUT_ROUTE, claim.customerCommandId]
        );
        invariant(
          customerCommand.rowCount === 1,
          "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
          "The original customer final-payment command is unavailable.",
          { status: 503 }
        );
        const selected = await client.query(
          `select attempt.*, invoice.invoice_number
           from ss.service_custom_build_final_checkout_attempts attempt
           join ss.service_custom_build_final_invoices invoice
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
            selected.rows[0].purpose_digest === resolution.purposeDigest &&
            iso(
              selected.rows[0].provider_request_expires_at,
              "Provider-request expiration"
            ) === claim.providerRequestExpiresAt,
          "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
          "The uncertain final Checkout changed before recovery.",
          { status: 503 }
        );
        const updated = await client.query(
          `update ss.service_custom_build_final_checkout_attempts
           set state = 'ready', provider_effect_certainty = 'confirmed',
               checkout_session_id = $3, checkout_url = $4,
               expires_at = $5, provider_error_code = null
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
          "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
          "The uncertain final Checkout could not be recovered.",
          { status: 503 }
        );
        const finalized = await client.query(
          `select attempt.*, invoice.invoice_number
           from ss.service_custom_build_final_checkout_attempts attempt
           join ss.service_custom_build_final_invoices invoice
             on invoice.organization_id = attempt.organization_id
            and invoice.id = attempt.invoice_id
           where attempt.organization_id = $1 and attempt.id = $2`,
          [input.organizationId, input.attemptId]
        );
        const checkout = checkoutResponse(finalized.rows[0]);
        const customerCompleted = await client.query(
          `update ss.idempotency_keys
           set state = 'completed', response_status = 201,
               response_body = $4::jsonb
           where organization_id = $1 and principal_id = $2
             and route_key = $3 and idempotency_key = $5
             and state = 'running'`,
          [
            input.organizationId,
            resolution.customerId,
            CHECKOUT_ROUTE,
            JSON.stringify(checkout),
            claim.customerCommandId
          ]
        );
        invariant(
          customerCompleted.rowCount === 1,
          "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
          "The recovered customer final-payment command could not be sealed.",
          { status: 503 }
        );
        const result = ownerReconciliationResult({
          status: "checkout_ready",
          resolution,
          checkout
        });
        const commandCompleted = await client.query(
          `update ss.service_custom_build_final_reconciliation_commands
           set state = 'completed', result = $3::jsonb,
               result_digest = ss.service_json_digest($3::jsonb),
               completed_at = clock_timestamp()
           where organization_id = $1 and id = $2 and state = 'running'`,
          [input.organizationId, claim.commandRowId, JSON.stringify(result)]
        );
        invariant(
          commandCompleted.rowCount === 1,
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "The owner final-payment command could not be sealed.",
          { status: 500 }
        );
        return result;
      }
    ));
  }

  async function finishOwnerStatus(
    claim,
    { status, reason, attemptTransition = null, settlement = null }
  ) {
    const { input, resolution } = claim;
    return translated(() => database.service(
      {
        actorKind: "operator",
        userId: input.operatorId,
        organizationId: input.organizationId
      },
      async (client) => {
        await discoverAndLockJob(client, {
          text: `/* final:owner_status:discover */
                 select job_id
                 from ss.service_custom_build_final_checkout_attempts
                 where organization_id = $1 and id = $2`,
          values: [input.organizationId, input.attemptId],
          expectedJobId: input.jobId,
          code: "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          message: "The owner final-payment authority changed.",
          status: 409
        });
        const command = await client.query(
          `select *
           from ss.service_custom_build_final_reconciliation_commands
           where organization_id = $1 and id = $2
           for update`,
          [input.organizationId, claim.commandRowId]
        );
        invariant(
          command.rowCount === 1,
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "The owner final-payment command is unavailable.",
          { status: 409 }
        );
        if (command.rows[0].state === "completed") {
          return retainedOwnerReconciliationResult(command.rows[0].result, {
            organizationId: input.organizationId,
            jobId: input.jobId,
            attemptId: input.attemptId
          });
        }
        const selected = await client.query(
          `select *
           from ss.service_custom_build_final_checkout_attempts
           where organization_id = $1 and id = $2
           for update`,
          [input.organizationId, input.attemptId]
        );
        invariant(
          selected.rowCount === 1,
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "The final-payment attempt is unavailable.",
          { status: 409 }
        );
        if (
          attemptTransition === "persistence_unknown" &&
          selected.rows[0].state === "provider_pending"
        ) {
          await client.query(
            `update ss.service_custom_build_final_checkout_attempts
             set state = 'persistence_unknown',
                 provider_effect_certainty = 'ambiguous',
                 provider_error_code = $3
             where organization_id = $1 and id = $2
               and state = 'provider_pending'`,
            [input.organizationId, input.attemptId, reason]
          );
        } else if (attemptTransition === "expired") {
          const expired = await client.query(
            `update ss.service_custom_build_final_checkout_attempts
             set state = 'expired'
             where organization_id = $1 and id = $2
               and state in ('provider_pending', 'persistence_unknown', 'ready')`,
            [input.organizationId, input.attemptId]
          );
          invariant(
            expired.rowCount === 1,
            "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
            "The final-payment attempt could not be expired.",
            { status: 409 }
          );
        }
        const result = ownerReconciliationResult({
          status,
          resolution,
          reason,
          settlement
        });
        const completed = await client.query(
          `update ss.service_custom_build_final_reconciliation_commands
           set state = 'completed', result = $3::jsonb,
               result_digest = ss.service_json_digest($3::jsonb),
               completed_at = clock_timestamp()
           where organization_id = $1 and id = $2 and state = 'running'`,
          [input.organizationId, claim.commandRowId, JSON.stringify(result)]
        );
        invariant(
          completed.rowCount === 1,
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "The owner final-payment command could not be sealed.",
          { status: 500 }
        );
        return result;
      }
    ));
  }

  async function reconcileCheckoutCreation(actor, jobIdValue, value) {
    const claim = await claimOwnerReconciliation(actor, jobIdValue, value);
    if (claim.status === "replay") return claim.result;
    const { resolution } = claim;
    if (claim.receiptId !== null) {
      const settlement = settlementResult({
        completionPackageId: resolution.completionPackageId,
        invoiceId: resolution.invoiceId,
        jobId: resolution.jobId,
        next: "custom_build_handoff",
        receiptId: claim.receiptId,
        schema: CUSTOM_BUILD_FINAL_SETTLEMENT_SCHEMA,
        status: "payment_settled"
      });
      return finishOwnerStatus(claim, {
        status: "payment_settled",
        reason: null,
        settlement
      });
    }
    if (["provider_pending", "persistence_unknown"].includes(
      claim.attemptState
    )) {
      if (
        Date.parse(claim.providerRequestExpiresAt) <=
          Date.parse(iso(paymentClock.now(), "Final-payment clock"))
      ) {
        return finishOwnerStatus(claim, {
          status: "checkout_expired",
          reason: "creation_request_expired",
          attemptTransition: "expired"
        });
      }
      let evidence;
      try {
        evidence = checkoutEvidence(
          await paymentProvider.createCustomBuildFinalCheckout({
            idempotencyKey: claim.customerCommandId,
            checkoutExpiresAt: claim.providerRequestExpiresAt,
            purpose: resolution.purpose,
            purposeDigest: resolution.purposeDigest,
            ...(claim.stripeCustomerId
              ? { stripeCustomerId: claim.stripeCustomerId }
              : {})
          }),
          claim.providerRequestExpiresAt,
          paymentClock
        );
      } catch (error) {
        return finishOwnerStatus(claim, {
          status: "reconciliation_required",
          reason: providerCode(
            error,
            "stripe_custom_build_final_creation_reconcile_unavailable"
          ),
          attemptTransition: "persistence_unknown"
        });
      }
      return finishOwnerCreation(claim, evidence);
    }
    if (claim.attemptState === "expired") {
      return finishOwnerStatus(claim, {
        status: "checkout_expired",
        reason: "attempt_already_expired"
      });
    }
    invariant(
      claim.attemptState === "ready",
      "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
      "The owner reconciliation attempt state is invalid.",
      { status: 409 }
    );
    const readyResolution = deepFreeze({
      ...resolution,
      checkoutSessionId: (() => {
        invariant(
          CHECKOUT_ID.test(String(resolution.checkoutSessionId ?? "")),
          "CUSTOM_BUILD_FINAL_PAYMENT_CONFLICT",
          "The retained final Checkout Session is invalid.",
          { status: 500 }
        );
        return resolution.checkoutSessionId;
      })()
    });
    let lifecycle;
    try {
      lifecycle = exactLifecycle(
        await paymentProvider.retrieveCustomBuildFinalCheckoutLifecycle({
          checkoutSessionId: readyResolution.checkoutSessionId,
          purpose: readyResolution.purpose,
          purposeDigest: readyResolution.purposeDigest
        }),
        readyResolution
      );
    } catch (error) {
      return finishOwnerStatus(claim, {
        status: "reconciliation_required",
        reason: providerCode(
          error,
          "stripe_custom_build_final_lifecycle_reconcile_unavailable"
        )
      });
    }
    if (lifecycle.state === "open") {
      return finishOwnerStatus(claim, {
        status: "reconciliation_required",
        reason: "checkout_still_open"
      });
    }
    if (lifecycle.state === "expired") {
      return finishOwnerStatus(claim, {
        status: "checkout_expired",
        reason: "provider_confirmed_expired",
        attemptTransition: "expired"
      });
    }
    let payment;
    try {
      payment = exactPaymentFacts(
        await paymentProvider.retrieveCustomBuildFinalPayment({
          checkoutSessionId: readyResolution.checkoutSessionId,
          purpose: readyResolution.purpose,
          purposeDigest: readyResolution.purposeDigest
        }),
        readyResolution
      );
    } catch (error) {
      return finishOwnerStatus(claim, {
        status: "reconciliation_required",
        reason: providerCode(
          error,
          "stripe_custom_build_final_payment_reconcile_unavailable"
        )
      });
    }
    return settle(
      { eventId: null, verifiedAt: iso(paymentClock.now(), "Readback time") },
      readyResolution,
      payment,
      {
        operatorId: claim.input.operatorId,
        commandRowId: claim.commandRowId
      }
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
             attempt.id as attempt_id,
             attempt.organization_id,
             attempt.project_id,
             attempt.customer_user_id,
             attempt.job_id,
             attempt.obligation_id,
             attempt.completion_package_id,
             attempt.invoice_id,
             attempt.checkout_session_id,
             attempt.purpose_digest,
             obligation.case_id,
             obligation.quote_id,
             obligation.quote_revision_id,
             obligation.quote_acceptance_id,
             obligation.quote_installment_id,
             obligation.installment_number,
             obligation.completion_package_digest,
             obligation.base_scope_digest,
             pg_catalog.to_json(obligation.effective_change_order_digests)
               as effective_change_order_digests,
             obligation.effective_scope_digest,
             obligation.accepted_quote_digest,
             obligation.accepted_disclosure_digest,
             obligation.commercial_contract_digest,
             obligation.final_due_minor,
             obligation.credit_minor,
             obligation.currency,
             obligation.workmanship_correction_days,
             obligation.obligation_digest,
             invoice.invoice_number,
             invoice.subtotal_minor as invoice_subtotal_minor,
             invoice.credit_minor as invoice_credit_minor,
             invoice.invoice_digest
           from ss.service_custom_build_final_checkout_attempts attempt
           join ss.service_custom_build_final_obligations obligation
             on obligation.organization_id = attempt.organization_id
            and obligation.id = attempt.obligation_id
           join ss.service_custom_build_final_invoices invoice
             on invoice.organization_id = attempt.organization_id
            and invoice.id = attempt.invoice_id
           left join ss.service_custom_build_final_payment_receipts receipt
             on receipt.organization_id = attempt.organization_id
            and receipt.invoice_id = attempt.invoice_id
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
               from ss.service_custom_build_final_stripe_events event
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
          "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
          "The final-payment page is not eligible for expiry reconciliation.",
          { status: 503 }
        );
        return paymentResolutionFromRow(selected.rows[0]);
      }
    ));
    let lifecycle;
    try {
      lifecycle = exactLifecycle(
        await paymentProvider.retrieveCustomBuildFinalCheckoutLifecycle({
          checkoutSessionId: resolution.checkoutSessionId,
          purpose: resolution.purpose,
          purposeDigest: resolution.purposeDigest
        }),
        resolution
      );
    } catch (error) {
      throw new HostedError(
        "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
        "The expired final-payment page could not be confirmed safely.",
        {
          status: 503,
          details: {
            providerErrorCode: providerCode(
              error,
              "stripe_custom_build_final_lifecycle_unavailable"
            ),
            providerEffect: false
          }
        }
      );
    }
    invariant(
      lifecycle.state === "expired",
      "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
      lifecycle.state === "paid"
        ? "Stripe reports this page was paid. Owner readback must finish first."
        : "Stripe reports this final-payment page is still open.",
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
          text: `/* final:customer_expiry:discover */
                 select job_id
                 from ss.service_custom_build_final_checkout_attempts
                 where organization_id = $1 and id = $2`,
          values: [input.organizationId, resolution.attemptId],
          expectedJobId: resolution.jobId,
          code: "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
          message: "The expired final-payment page changed before release.",
          status: 503
        });
        const updated = await client.query(
          `update ss.service_custom_build_final_checkout_attempts
           set state = 'expired'
           where organization_id = $1 and id = $2
             and state = 'ready' and expires_at <= clock_timestamp()
             and not exists (
               select 1
               from ss.service_custom_build_final_payment_receipts receipt
               where receipt.organization_id = $1
                 and receipt.invoice_id = $3
             )
             and not exists (
               select 1
               from ss.service_custom_build_final_stripe_events event
               where event.organization_id = $1
                 and event.checkout_attempt_id = $2
             )`,
          [input.organizationId, resolution.attemptId, input.invoiceId]
        );
        invariant(
          updated.rowCount === 1,
          "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED",
          "The expired final-payment page changed before release.",
          { status: 503 }
        );
        return deepFreeze({
          schema: EXPIRY_SCHEMA,
          status: "expired_reconciled",
          projectId: input.projectId,
          invoiceId: input.invoiceId,
          next: "new_checkout_command"
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
            "select ss.hosted_runtime_contract_v46() as runtime_contract"
          );
          invariant(
            selected.rowCount === 1 &&
              selected.rows[0].runtime_contract === RUNTIME_CONTRACT,
            "CUSTOM_BUILD_FINAL_PAYMENT_HELD",
            "Custom-build final-payment storage is not ready.",
            { status: 503 }
          );
          return deepFreeze({
            schema: READINESS_SCHEMA,
            ready: paymentRelease.approved,
            state: paymentRelease.approved ? "approved" : "held",
            runtimeContract: RUNTIME_CONTRACT,
            completionBoundObligation: true,
            exactFinalInstallment: true,
            acceptedChangesExcluded: true,
            assessmentCreditExcluded: true,
            zeroBalanceClearance: true,
            globalProviderEffectFence: true,
            automaticTax: true,
            webhookWakeup: true,
            stripeReadback: true,
            atomicSettlement: true,
            ownerReconciliation: true,
            holdScope: paymentRelease.holdScope,
            providerEffectProcessing:
              paymentRelease.providerEffectProcessing
          });
        }
      ));
    },

    readCurrentState,
    readOwnerFinalPayments,

    async createCheckout(value) {
      const input = checkoutInput(value);
      invariant(
        paymentRelease.approved,
        "CUSTOM_BUILD_FINAL_PAYMENT_HELD",
        "Custom-build final payment is held for new Checkout creation.",
        { status: 503 }
      );
      const claim = await stageCheckout(input);
      if (claim.status === "replay") return claim.result;
      if (claim.status === "expired") {
        await reconcileExpiredCheckout(value);
        throw new HostedError(
          "CUSTOM_BUILD_FINAL_CHECKOUT_REQUIRES_NEW_COMMAND",
          "The expired final-payment page is closed. Refresh before opening a replacement.",
          { status: 409 }
        );
      }
      let providerReturned = false;
      try {
        const returned =
          await paymentProvider.createCustomBuildFinalCheckout({
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
            ? "custom_build_final_checkout_effect_unknown"
            : "custom_build_final_checkout_not_submitted"
        );
        await markCheckoutFailure(input, claim, ambiguous, code);
        throw new HostedError(
          ambiguous
            ? "CUSTOM_BUILD_FINAL_CHECKOUT_RECONCILIATION_REQUIRED"
            : "CUSTOM_BUILD_FINAL_PAYMENT_UNAVAILABLE",
          ambiguous
            ? "The final-payment page could not be confirmed and will not be submitted again automatically."
            : "Secure final payment is temporarily unavailable. Nothing was charged.",
          { status: 503 }
        );
      }
    },

    reconcileCheckoutCreation,
    reconcileExpiredCheckout,

    async ingestStripeEvent(value) {
      invariant(
        isPotentialCustomBuildFinalPaymentStripeEvent(value),
        "STRIPE_EVENT_INVALID",
        "The Stripe event is not a Custom-build final-payment event.",
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
          await paymentProvider.retrieveCustomBuildFinalPayment({
            checkoutSessionId: claimed.resolution.checkoutSessionId,
            purpose: claimed.resolution.purpose,
            purposeDigest: claimed.resolution.purposeDigest
          }),
          claimed.resolution
        );
      } catch (error) {
        const rejectedEvidence =
          error?.status === 502 ||
          error?.code === "CUSTOM_BUILD_FINAL_PAYMENT_EVIDENCE_INVALID";
        if (rejectedEvidence) {
          return markReconciliation(
            event,
            claimed.resolution,
            error.code
          );
        }
        throw new HostedError(
          "CUSTOM_BUILD_FINAL_PAYMENT_RECONCILIATION_UNAVAILABLE",
          "Stripe final-payment confirmation is temporarily unavailable. The event remains safe to retry.",
          {
            status: 503,
            details: {
              providerErrorCode: providerCode(
                error,
                "stripe_custom_build_final_read_unavailable"
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
