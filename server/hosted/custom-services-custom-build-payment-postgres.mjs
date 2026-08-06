import { createHash, randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { ExternalEffectError } from "../domain/errors.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

export const CUSTOM_BUILD_PAYMENT_INVOICE_SCHEMA =
  "sitesourcery.custom-build-start-invoice/v1";
export const CUSTOM_BUILD_PAYMENT_CHECKOUT_SCHEMA =
  "sitesourcery.custom-build-start-checkout/v1";
export const CUSTOM_BUILD_PAYMENT_PURPOSE_SCHEMA =
  "sitesourcery.custom-build-start-checkout-purpose/v1";
export const CUSTOM_BUILD_PAYMENT_METADATA_SCHEMA =
  "sitesourcery_custom_build_start_checkout_v1";
export const CUSTOM_BUILD_PAYMENT_SETTLEMENT_SCHEMA =
  "sitesourcery.custom-build-start-settlement/v1";

const PAYMENT_FACTS_SCHEMA =
  "sitesourcery.stripe-custom-build-start-payment-facts/v1";
const LIFECYCLE_SCHEMA =
  "sitesourcery.stripe-custom-build-start-checkout-lifecycle/v1";
const RUNTIME_CONTRACT =
  "canonical-ss-v42-custom-build-start-payment";
const CHECKOUT_ROUTE = "custom-services.custom-build-start-checkout";
const EVENT_TYPE = "checkout.session.completed";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const INVOICE_NUMBER = /^SSCB-[0-9A-F]{32}$/u;
const CHECKOUT_ID = /^cs_[A-Za-z0-9_]+$/u;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/u;
const STRIPE_CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_]+$/u;
const SAFE_CODE = /^[A-Za-z0-9._:-]{1,200}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

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
    `${field} is invalid`,
    { status }
  );
  return value;
}

function sha(value, field, code = "invalid_input", status = 400) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    code,
    `${field} is invalid`,
    { status }
  );
  return value;
}

function integer(value, field, { zero = false, maximum = 99_999_999 } = {}) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) &&
      selected >= (zero ? 0 : 1) &&
      selected <= maximum,
    "CUSTOM_BUILD_PAYMENT_CONFLICT",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function iso(value, field, code = "CUSTOM_BUILD_PAYMENT_CONFLICT") {
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    !Number.isNaN(selected.getTime()),
    code,
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected.toISOString();
}

function commandId(value) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      value.length >= 8 &&
      value.length <= 200 &&
      !CONTROL_CHARACTER.test(value),
    "invalid_input",
    "commandId is invalid",
    { status: 400 }
  );
  return value;
}

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Canonical PostgreSQL authority is required for Custom build payment.",
    { status: 500 }
  );
  return value;
}

function validateProvider(value) {
  invariant(
    value &&
      typeof value.createCustomBuildStartCheckout === "function" &&
      typeof value.retrieveCustomBuildStartPayment === "function" &&
      typeof value.retrieveCustomBuildStartCheckoutLifecycle === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Exact Stripe Custom build Checkout and readback are required.",
    { status: 500 }
  );
  return value;
}

function validateRelease(value) {
  exactKeys(
    value,
    ["approved", "currency", "paymentWindowDays", "taxMode"],
    "RUNTIME_CONFIGURATION_ERROR",
    "Custom build payment release is invalid.",
    500
  );
  invariant(
    typeof value.approved === "boolean" &&
      value.currency === "USD" &&
      value.paymentWindowDays === 7 &&
      value.taxMode === "automatic",
    "RUNTIME_CONFIGURATION_ERROR",
    "Custom build payment release must preserve the seven-day automatic-tax contract.",
    { status: 500 }
  );
  return Object.freeze({ ...value });
}

function validateClock(value) {
  const selected = value ?? { now: () => new Date().toISOString() };
  invariant(
    typeof selected.now === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "A Custom build payment clock is required.",
    { status: 500 }
  );
  return selected;
}

function validateIds(value) {
  const selected = value ?? { next: () => systemRandomUUID() };
  invariant(
    typeof selected.next === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Custom build payment IDs are required.",
    { status: 500 }
  );
  return selected;
}

function customerScope(value) {
  exactKeys(
    value,
    ["actorId", "customerId", "organizationId", "projectId"],
    "invalid_input",
    "Custom build payment scope is invalid."
  );
  const customerId = uuid(value.customerId, "customerId");
  invariant(
    uuid(value.actorId, "actorId") === customerId,
    "project_unavailable",
    "the Custom build project is unavailable",
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
    "Custom build Checkout request is invalid."
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
      "42501",
      "55000"
    ].includes(error?.code)
  ) {
    return new HostedError(
      "CUSTOM_BUILD_PAYMENT_REPOSITORY_CONFLICT",
      "The Custom build payment record rejected inconsistent evidence.",
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

function purposeFromRow(row) {
  invariant(
    row &&
      UUID.test(String(row.organization_id ?? "")) &&
      UUID.test(String(row.customer_user_id ?? "")) &&
      UUID.test(String(row.project_id ?? "")) &&
      UUID.test(String(row.quote_id ?? "")) &&
      UUID.test(String(row.quote_revision_id ?? "")) &&
      UUID.test(String(row.quote_acceptance_id ?? "")) &&
      UUID.test(String(row.credit_application_id ?? "")) &&
      UUID.test(String(row.invoice_id ?? row.id ?? "")) &&
      INVOICE_NUMBER.test(String(row.invoice_number ?? "")) &&
      SHA256.test(String(row.accepted_quote_digest ?? "")) &&
      SHA256.test(String(row.accepted_disclosure_digest ?? "")) &&
      SHA256.test(String(row.invoice_digest ?? "")),
    "CUSTOM_BUILD_PAYMENT_CONFLICT",
    "The retained Custom build invoice purpose is incomplete.",
    { status: 500 }
  );
  return deepFreeze({
    schema: CUSTOM_BUILD_PAYMENT_PURPOSE_SCHEMA,
    tenantId: row.organization_id,
    customerId: row.customer_user_id,
    projectId: row.project_id,
    quoteId: row.quote_id,
    quoteRevisionId: row.quote_revision_id,
    quoteAcceptanceId: row.quote_acceptance_id,
    creditApplicationId: row.credit_application_id,
    invoiceId: row.invoice_id ?? row.id,
    invoiceNumber: row.invoice_number,
    acceptedQuoteDigest: row.accepted_quote_digest,
    acceptedDisclosureDigest: row.accepted_disclosure_digest,
    invoiceDigest: row.invoice_digest,
    price: {
      amountMinor: integer(row.subtotal_minor, "invoice subtotal"),
      currency: "USD",
      billing: "one_time",
      taxBehavior: "automatic_exclusive"
    }
  });
}

function expectedMetadata(purpose, purposeDigest) {
  return Object.freeze({
    schema: CUSTOM_BUILD_PAYMENT_METADATA_SCHEMA,
    tenant_id: purpose.tenantId,
    customer_id: purpose.customerId,
    project_id: purpose.projectId,
    quote_id: purpose.quoteId,
    quote_revision_id: purpose.quoteRevisionId,
    quote_acceptance_id: purpose.quoteAcceptanceId,
    credit_application_id: purpose.creditApplicationId,
    invoice_id: purpose.invoiceId,
    invoice_number: purpose.invoiceNumber,
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
    "The verified Stripe metadata does not match the retained Custom build invoice."
  );
  invariant(
    Object.entries(expected).every(([key, selected]) => value[key] === selected),
    code,
    "The verified Stripe metadata does not match the retained Custom build invoice.",
    { status: 400 }
  );
  return expected;
}

function checkoutEvidence(value) {
  invariant(
    value &&
      CHECKOUT_ID.test(String(value.checkoutId ?? "")) &&
      typeof value.url === "string" &&
      value.url.length <= 2000 &&
      Number.isFinite(Date.parse(value.expiresAt)),
    "CUSTOM_BUILD_CHECKOUT_PROVIDER_RESPONSE_INVALID",
    "Stripe returned unsafe Custom build Checkout evidence.",
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
      Date.parse(value.expiresAt) > Date.now(),
    "CUSTOM_BUILD_CHECKOUT_PROVIDER_RESPONSE_INVALID",
    "Stripe returned unsafe Custom build Checkout evidence.",
    { status: 502 }
  );
  return Object.freeze({
    checkoutId: value.checkoutId,
    url: parsed.toString(),
    expiresAt: new Date(value.expiresAt).toISOString()
  });
}

function checkoutResponse(row) {
  invariant(
    row &&
      row.state === "ready" &&
      CHECKOUT_ID.test(String(row.checkout_session_id ?? "")) &&
      typeof row.checkout_url === "string" &&
      Number.isFinite(Date.parse(row.expires_at)),
    "CUSTOM_BUILD_PAYMENT_CONFLICT",
    "The retained Custom build Checkout is incomplete.",
    { status: 500 }
  );
  return deepFreeze({
    schema: CUSTOM_BUILD_PAYMENT_CHECKOUT_SCHEMA,
    state: "ready",
    checkout: {
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
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
      schema: CUSTOM_BUILD_PAYMENT_INVOICE_SCHEMA,
      state: "not_available",
      invoice: null,
      job: null,
      action: { available: false, reason: "invoice_not_available" }
    });
  }
  const paid = row.receipt_id !== null;
  const reconciliation =
    row.credit_state === "reconciliation_required" ||
    row.event_state === "reconciliation_required" ||
    row.checkout_state === "persistence_unknown";
  const ready = row.checkout_state === "ready" &&
    Date.parse(iso(row.checkout_expires_at, "Checkout expiration")) > Date.now();
  const deadlinePassed = Date.parse(iso(row.payment_deadline, "Payment deadline")) <= Date.now();
  const state = paid
    ? "paid"
    : reconciliation
      ? "reconciliation_required"
      : ready
        ? "checkout_ready"
        : deadlinePassed
          ? "payment_window_expired"
          : release.approved
            ? "checkout_available"
            : "payment_held";
  const lines = Array.isArray(row.lines) ? row.lines : [];
  invariant(
    INVOICE_NUMBER.test(String(row.invoice_number ?? "")) &&
      SHA256.test(String(row.invoice_digest ?? "")) &&
      SHA256.test(String(row.accepted_quote_digest ?? "")) &&
      SHA256.test(String(row.accepted_disclosure_digest ?? "")) &&
      lines.length === 2 &&
      lines.reduce((sum, line) => sum + Number(line.amountMinor), 0) ===
        Number(row.subtotal_minor),
    "CUSTOM_BUILD_PAYMENT_CONFLICT",
    "The retained Custom build invoice is inconsistent.",
    { status: 500 }
  );
  return deepFreeze({
    schema: CUSTOM_BUILD_PAYMENT_INVOICE_SCHEMA,
    state,
    invoice: {
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      invoiceDigest: row.invoice_digest,
      quoteId: row.quote_id,
      tierId: row.tier_id,
      acceptedQuoteDigest: row.accepted_quote_digest,
      acceptedDisclosureDigest: row.accepted_disclosure_digest,
      issuedAt: iso(row.issued_at, "Invoice issue time"),
      paymentDeadline: iso(row.payment_deadline, "Payment deadline"),
      lines: lines.map((line) => Object.freeze({
        lineNumber: Number(line.lineNumber),
        componentKey: line.componentKey,
        displayName: line.displayName,
        amountMinor: Number(line.amountMinor),
        currency: "USD"
      })),
      subtotal: {
        amountMinor: integer(row.subtotal_minor, "Invoice subtotal"),
        currency: "USD"
      },
      tax: { amountMinor: null, state: "calculated_at_checkout" },
      total: { amountMinor: null, currency: "USD", state: "shown_at_checkout" },
      credit: {
        amountMinor: integer(row.credit_minor, "Invoice credit"),
        state: row.credit_state
      },
      finalHandoff: {
        amountMinor: integer(row.final_due_minor, "Final amount", { zero: true }),
        state: Number(row.final_due_minor) === 0 ? "not_required" : "due_before_handoff"
      },
      payment: {
        chargeOccurred: paid,
        checkoutUrl: ready ? row.checkout_url : null,
        checkoutExpiresAt: ready
          ? iso(row.checkout_expires_at, "Checkout expiration")
          : null
      }
    },
    action: {
      available: state === "checkout_available",
      reason: state === "checkout_available" ? null : state
    },
    job: row.job_id === null
      ? null
      : {
          jobId: row.job_id,
          state: row.job_state,
          finalPaymentState: row.final_payment_state
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
    invoice.invoice_number,
    invoice.quote_id,
    invoice.quote_revision,
    invoice.quote_revision_id,
    invoice.quote_acceptance_id,
    invoice.credit_application_id,
    invoice.policy_id,
    invoice.scope_boundary_digest,
    invoice.tier_id,
    invoice.accepted_quote_digest,
    invoice.accepted_disclosure_digest,
    invoice.gross_start_minor,
    invoice.credit_minor,
    invoice.subtotal_minor,
    invoice.final_due_minor,
    invoice.currency,
    invoice.invoice_digest,
    invoice.issued_at,
    invoice.payment_deadline,
    application.state as credit_state,
    attempt.id as checkout_attempt_id,
    attempt.state as checkout_state,
    attempt.checkout_session_id,
    attempt.checkout_url,
    attempt.expires_at as checkout_expires_at,
    event.state as event_state,
    receipt.id as receipt_id,
    job.id as job_id,
    job.state as job_state,
    job.final_payment_state,
    coalesce(line_rows.items, '[]'::jsonb) as lines
  from ss.service_custom_build_invoices invoice
  join ss.service_credit_applications application
    on application.organization_id = invoice.organization_id
   and application.id = invoice.credit_application_id
  left join lateral (
    select candidate.*
    from ss.service_custom_build_checkout_attempts candidate
    where candidate.organization_id = invoice.organization_id
      and candidate.invoice_id = invoice.id
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) attempt on true
  left join lateral (
    select candidate.state
    from ss.service_custom_build_stripe_events candidate
    where candidate.organization_id = invoice.organization_id
      and candidate.invoice_id = invoice.id
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) event on true
  left join ss.service_custom_build_payment_receipts receipt
    on receipt.organization_id = invoice.organization_id
   and receipt.invoice_id = invoice.id
  left join ss.service_custom_build_jobs job
    on job.organization_id = invoice.organization_id
   and job.invoice_id = invoice.id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'amountMinor', line.amount_minor,
      'componentKey', line.component_key,
      'displayName', line.display_name,
      'lineNumber', line.line_number
    ) order by line.line_number) as items
    from ss.service_custom_build_invoice_lines line
    where line.organization_id = invoice.organization_id
      and line.invoice_id = invoice.id
  ) line_rows on true`;

function requestDigest(input) {
  return digest({ route: CHECKOUT_ROUTE, ...input });
}

function providerCode(error, fallback) {
  const selected = String(error?.code ?? "");
  return SAFE_CODE.test(selected) ? selected : fallback;
}

export function isPotentialCustomBuildPaymentStripeEvent(event) {
  return event?.type === EVENT_TYPE &&
    event?.data?.object?.metadata?.schema ===
      CUSTOM_BUILD_PAYMENT_METADATA_SCHEMA;
}

export function createHeldCustomServicesCustomBuildPayment() {
  const held = () => {
    throw new HostedError(
      "CUSTOM_BUILD_PAYMENT_HELD",
      "Custom build payment is held in this runtime.",
      { status: 503 }
    );
  };
  return Object.freeze({
    async readiness() {
      return deepFreeze({
        schema: "sitesourcery.custom-build-payment-readiness/v1",
        ready: false,
        state: "held"
      });
    },
    async readCurrentInvoice(value) {
      customerScope(value);
      return held();
    },
    async createCheckout(value) {
      checkoutInput(value);
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

export function createPostgresCustomServicesCustomBuildPayment({
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
           order by invoice.issued_at desc
           limit 1`,
          [scope.organizationId, scope.projectId, scope.customerId]
        );
        invariant(
          selected.rowCount <= 1,
          "CUSTOM_BUILD_PAYMENT_CONFLICT",
          "The Custom build invoice conflicts.",
          { status: 500 }
        );
        return invoiceProjection(selected.rows[0] ?? null, paymentRelease);
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
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`custom-build-checkout:${input.organizationId}:${input.invoiceId}`]
        );
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
            "That Custom build payment command was already used differently.",
            { status: 409 }
          );
          if (prior.rows[0].state === "completed") {
            return {
              status: "replay",
              result: deepFreeze(structuredClone(prior.rows[0].response_body))
            };
          }
          throw new HostedError(
            "CUSTOM_BUILD_CHECKOUT_RECONCILIATION_REQUIRED",
            "An earlier Custom build payment command has not reached a safe final state.",
            { status: 503 }
          );
        }
        invariant(
          prior.rowCount === 0,
          "CUSTOM_BUILD_PAYMENT_CONFLICT",
          "The Custom build payment command conflicts.",
          { status: 500 }
        );

        const invoiceResult = await client.query(
          `select invoice.*,
                  application.state as credit_state,
                  customer.stripe_customer_id,
                  receipt.id as receipt_id
           from ss.service_custom_build_invoices invoice
           join ss.service_credit_applications application
             on application.organization_id = invoice.organization_id
            and application.id = invoice.credit_application_id
           join ss.service_custom_build_quotes quote
             on quote.organization_id = invoice.organization_id
            and quote.id = invoice.quote_id
           left join ss.stripe_customers customer
             on customer.organization_id = invoice.organization_id
           left join ss.service_custom_build_payment_receipts receipt
             on receipt.organization_id = invoice.organization_id
            and receipt.invoice_id = invoice.id
           where invoice.organization_id = $1
             and invoice.project_id = $2
             and invoice.customer_user_id = $3
             and invoice.id = $4
             and quote.state = 'accepted'
           for update of application`,
          [
            input.organizationId,
            input.projectId,
            input.customerId,
            input.invoiceId
          ]
        );
        invariant(
          invoiceResult.rowCount === 1,
          "CUSTOM_BUILD_INVOICE_UNAVAILABLE",
          "The Custom build invoice is unavailable.",
          { status: 404 }
        );
        const invoice = invoiceResult.rows[0];
        invariant(
          invoice.invoice_digest === input.invoiceDigest &&
            invoice.credit_state === "reserved" &&
            invoice.receipt_id === null &&
            Date.parse(iso(invoice.payment_deadline, "Payment deadline")) >
              Date.parse(iso(paymentClock.now(), "Payment clock")),
          "CUSTOM_BUILD_INVOICE_CHANGED",
          "The Custom build invoice is no longer payable.",
          { status: 409 }
        );

        const active = await client.query(
          `select attempt.*, invoice.invoice_number
           from ss.service_custom_build_checkout_attempts attempt
           join ss.service_custom_build_invoices invoice
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
          "CUSTOM_BUILD_PAYMENT_CONFLICT",
          "More than one Custom build Checkout is active.",
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
                 201, $7::jsonb, 'custom_build_start_checkout',
                 $8, clock_timestamp(), clock_timestamp() + interval '24 hours'
               )`,
              [
                uuid(paymentIds.next("checkout_replay_command"), "command ID", "RUNTIME_CONFIGURATION_ERROR", 500),
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
            "CUSTOM_BUILD_CHECKOUT_RECONCILIATION_REQUIRED",
            "The earlier Custom build payment page must be reconciled before another can open.",
            { status: 503 }
          );
        }

        const purpose = purposeFromRow(invoice);
        const purposeDigest = digest(purpose);
        const attemptId = uuid(
          paymentIds.next("custom_build_checkout"),
          "Checkout attempt ID",
          "RUNTIME_CONFIGURATION_ERROR",
          500
        );
        const commandRowId = uuid(
          paymentIds.next("custom_build_checkout_command"),
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
             'custom_build_start_checkout', $7,
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
          `insert into ss.service_custom_build_checkout_attempts (
             id, organization_id, project_id, customer_user_id,
             invoice_id, command_id, provider, purpose_digest,
             invoice_digest, accepted_quote_digest,
             accepted_disclosure_digest, expected_subtotal_minor,
             currency, tax_mode, state, provider_effect_certainty
           ) values (
             $1, $2, $3, $4, $5, $6, 'stripe', $7,
             $8, $9, $10, $11, 'USD', 'automatic',
             'provider_pending', 'not_submitted'
           )`,
          [
            attemptId,
            input.organizationId,
            input.projectId,
            input.customerId,
            input.invoiceId,
            input.commandId,
            purposeDigest,
            input.invoiceDigest,
            invoice.accepted_quote_digest,
            invoice.accepted_disclosure_digest,
            invoice.subtotal_minor
          ]
        );
        return {
          status: "claimed",
          attemptId,
          commandRowId,
          purpose,
          purposeDigest,
          stripeCustomerId: invoice.stripe_customer_id
        };
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
        const selected = await client.query(
          `select attempt.*, invoice.invoice_number
           from ss.service_custom_build_checkout_attempts attempt
           join ss.service_custom_build_invoices invoice
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
            selected.rows[0].invoice_digest === input.invoiceDigest,
          "CUSTOM_BUILD_CHECKOUT_RECONCILIATION_REQUIRED",
          "The Custom build payment authority changed during Checkout.",
          { status: 503 }
        );
        await client.query(
          `update ss.service_custom_build_checkout_attempts
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
           from ss.service_custom_build_checkout_attempts attempt
           join ss.service_custom_build_invoices invoice
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
          "CUSTOM_BUILD_CHECKOUT_RECONCILIATION_REQUIRED",
          "The Custom build payment command could not be completed.",
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
          await client.query(
            `update ss.service_custom_build_checkout_attempts
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
              JSON.stringify({ error: { code, certainty: ambiguous ? "ambiguous" : "not_submitted" } })
            ]
          );
        }
      ));
    } catch {
      // A post-provider persistence failure remains reconciliation work. It is
      // never permission to submit another payment effect automatically.
    }
  }

  // Settlement and expiry reconciliation are defined below so Checkout,
  // webhook wakeup, and exact Stripe readback share one retained purpose.

  function exactVerifiedEvent(value) {
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
      "The verified Custom build Stripe event is invalid.",
      { status: 400 }
    );
    const metadata = structuredClone(value.data.object.metadata);
    exactKeys(
      metadata,
      [
        "accepted_disclosure_digest",
        "accepted_quote_digest",
        "credit_application_id",
        "customer_id",
        "invoice_digest",
        "invoice_id",
        "invoice_number",
        "project_id",
        "purpose_digest",
        "quote_acceptance_id",
        "quote_id",
        "quote_revision_id",
        "schema",
        "tenant_id"
      ],
      "STRIPE_EVENT_INVALID",
      "The verified Custom build Stripe metadata is invalid."
    );
    invariant(
      metadata.schema === CUSTOM_BUILD_PAYMENT_METADATA_SCHEMA &&
        [
          metadata.tenant_id,
          metadata.customer_id,
          metadata.project_id,
          metadata.quote_id,
          metadata.quote_revision_id,
          metadata.quote_acceptance_id,
          metadata.credit_application_id,
          metadata.invoice_id
        ].every((entry) => UUID.test(String(entry ?? ""))) &&
        INVOICE_NUMBER.test(String(metadata.invoice_number ?? "")) &&
        [
          metadata.accepted_quote_digest,
          metadata.accepted_disclosure_digest,
          metadata.invoice_digest,
          metadata.purpose_digest
        ].every((entry) => SHA256.test(String(entry ?? ""))),
      "STRIPE_EVENT_INVALID",
      "The verified Custom build Stripe metadata is invalid.",
      { status: 400 }
    );
    const signatureVerifiedAt = iso(
      paymentClock.now(),
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
      ["invoiceId", "jobId", "next", "projectId", "receiptId", "schema", "status"],
      "CUSTOM_BUILD_PAYMENT_CONFLICT",
      "The retained Custom build settlement result is invalid.",
      500
    );
    invariant(
      value.schema === CUSTOM_BUILD_PAYMENT_SETTLEMENT_SCHEMA &&
        value.status === "payment_settled" &&
        value.next === "custom_build_work" &&
        [value.projectId, value.invoiceId, value.receiptId, value.jobId]
          .every((entry) => UUID.test(String(entry ?? ""))) &&
        Object.entries(expected).every(([field, selected]) => value[field] === selected),
      "CUSTOM_BUILD_PAYMENT_CONFLICT",
      "The retained Custom build settlement result changed.",
      { status: 500 }
    );
    return deepFreeze(structuredClone(value));
  }

  function reconciliationResult(resolution) {
    return deepFreeze({
      schema: "sitesourcery.custom-build-start-reconciliation/v1",
      status: "reconciliation_required",
      projectId: resolution.projectId,
      invoiceId: resolution.invoiceId,
      next: "manual_review"
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
      "CUSTOM_BUILD_PAYMENT_EVIDENCE_INVALID",
      "Stripe Custom build payment evidence is invalid.",
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
      "CUSTOM_BUILD_PAYMENT_EVIDENCE_INVALID",
      "Stripe did not confirm the exact Custom build first payment.",
      { status: 502 }
    );
    return deepFreeze(structuredClone(value));
  }

  function exactLifecycle(value, resolution) {
    exactKeys(
      value,
      ["checkoutSessionId", "provider", "purposeDigest", "schema", "state"],
      "CUSTOM_BUILD_CHECKOUT_LIFECYCLE_INVALID",
      "Stripe Custom build Checkout lifecycle is invalid.",
      502
    );
    invariant(
      value.schema === LIFECYCLE_SCHEMA &&
        value.provider === "stripe" &&
        value.checkoutSessionId === resolution.checkoutSessionId &&
        value.purposeDigest === resolution.purposeDigest &&
        ["open", "expired", "paid"].includes(value.state),
      "CUSTOM_BUILD_CHECKOUT_LIFECYCLE_INVALID",
      "Stripe Custom build Checkout lifecycle changed.",
      { status: 502 }
    );
    return deepFreeze(structuredClone(value));
  }

  async function claimEvent(event) {
    return translated(() => database.service(
      {
        actorKind: "system",
        organizationId: event.metadata.tenant_id
      },
      async (client) => {
        const selected = await client.query(
          `select
             attempt.id as attempt_id,
             attempt.organization_id,
             attempt.project_id,
             attempt.customer_user_id,
             attempt.invoice_id,
             attempt.checkout_session_id,
             attempt.purpose_digest,
             attempt.state as attempt_state,
             invoice.invoice_number,
             invoice.quote_id,
             invoice.quote_revision_id,
             invoice.quote_acceptance_id,
             invoice.credit_application_id,
             invoice.accepted_quote_digest,
             invoice.accepted_disclosure_digest,
             invoice.invoice_digest,
             invoice.subtotal_minor,
             invoice.case_id
           from ss.service_custom_build_checkout_attempts attempt
           join ss.service_custom_build_invoices invoice
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
          "The Stripe event does not identify one retained Custom build Checkout.",
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
          "The retained Custom build Checkout changed before settlement.",
          { status: 400 }
        );
        exactMetadata(
          event.metadata,
          purpose,
          purposeDigest,
          "STRIPE_EVENT_BINDING_INVALID"
        );
        await client.query(
          `insert into ss.service_custom_build_stripe_events (
             id, organization_id, project_id, customer_user_id,
             invoice_id, checkout_attempt_id, event_type, livemode,
             api_version, checkout_session_id, payload_digest,
             provider_created_at, signature_verified_at, state
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8,
             $9, $10, $11, $12, $13, 'pending'
           ) on conflict (id) do nothing`,
          [
            event.eventId,
            row.organization_id,
            row.project_id,
            row.customer_user_id,
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
          `select * from ss.service_custom_build_stripe_events
           where organization_id = $1 and id = $2
           for update`,
          [row.organization_id, event.eventId]
        );
        invariant(
          retained.rowCount === 1 &&
            retained.rows[0].checkout_session_id === event.checkoutSessionId &&
            retained.rows[0].payload_digest === event.payloadDigest &&
            retained.rows[0].invoice_id === row.invoice_id,
          "STRIPE_EVENT_CONFLICT",
          "The Stripe event ID was retained with different Custom build evidence.",
          { status: 409 }
        );
        const resolution = deepFreeze({
          organizationId: row.organization_id,
          projectId: row.project_id,
          caseId: row.case_id,
          customerId: row.customer_user_id,
          invoiceId: row.invoice_id,
          attemptId: row.attempt_id,
          checkoutSessionId: row.checkout_session_id,
          creditApplicationId: row.credit_application_id,
          purpose,
          purposeDigest
        });
        if (retained.rows[0].state === "processed") {
          return {
            status: "processed",
            result: settlementResult(retained.rows[0].result, {
              projectId: row.project_id,
              invoiceId: row.invoice_id
            })
          };
        }
        if (retained.rows[0].state === "reconciliation_required") {
          return { status: "reconciliation_required", result: reconciliationResult(resolution) };
        }
        invariant(
          retained.rows[0].state === "pending",
          "CUSTOM_BUILD_PAYMENT_CONFLICT",
          "The retained Custom build Stripe event is invalid.",
          { status: 500 }
        );
        return { status: "pending", resolution };
      }
    ));
  }

  async function markReconciliation(event, resolution, errorCode) {
    const selectedCode = providerCode(
      { code: errorCode },
      "stripe_custom_build_payment_mismatch"
    );
    return translated(() => database.service(
      { actorKind: "system", organizationId: resolution.organizationId },
      async (client) => {
        const eventUpdate = await client.query(
          `update ss.service_custom_build_stripe_events
           set state = 'reconciliation_required',
               reconciliation_code = $3,
               completed_at = clock_timestamp()
           where organization_id = $1 and id = $2 and state = 'pending'`,
          [resolution.organizationId, event.eventId, selectedCode]
        );
        invariant(
          eventUpdate.rowCount === 1,
          "CUSTOM_BUILD_PAYMENT_CONFLICT",
          "Unsafe Custom build payment evidence could not be retained.",
          { status: 500 }
        );
        const creditUpdate = await client.query(
          `update ss.service_credit_applications
           set state = 'reconciliation_required'
           where organization_id = $1 and id = $2 and state = 'reserved'`,
          [resolution.organizationId, resolution.creditApplicationId]
        );
        invariant(
          creditUpdate.rowCount === 1,
          "CUSTOM_BUILD_PAYMENT_CONFLICT",
          "The uncertain Custom build credit could not be fenced.",
          { status: 500 }
        );
        return reconciliationResult(resolution);
      }
    ));
  }

  async function settle(event, resolution, payment) {
    return translated(() => database.service(
      { actorKind: "system", organizationId: resolution.organizationId },
      async (client) => {
        const selected = await client.query(
          `select
             attempt.state as attempt_state,
             attempt.checkout_session_id,
             attempt.purpose_digest,
             invoice.*,
             application.state as credit_state,
             revision.scope_statement,
             revision.crafted_pages,
             revision.sections,
             revision.unique_layouts,
             revision.content_words,
             revision.supplied_media,
             revision.target_completion_date,
             event.state as event_state,
             event.payload_digest
           from ss.service_custom_build_checkout_attempts attempt
           join ss.service_custom_build_invoices invoice
             on invoice.organization_id = attempt.organization_id
            and invoice.id = attempt.invoice_id
           join ss.service_credit_applications application
             on application.organization_id = invoice.organization_id
            and application.id = invoice.credit_application_id
           join ss.service_custom_build_quote_revisions revision
             on revision.organization_id = invoice.organization_id
            and revision.quote_id = invoice.quote_id
            and revision.quote_revision = invoice.quote_revision
            and revision.id = invoice.quote_revision_id
           join ss.service_custom_build_stripe_events event
             on event.organization_id = attempt.organization_id
            and event.id = $3
           where attempt.organization_id = $1 and attempt.id = $2
           for update of attempt, application, event`,
          [resolution.organizationId, resolution.attemptId, event.eventId]
        );
        invariant(
          selected.rowCount === 1,
          "CUSTOM_BUILD_PAYMENT_CONFLICT",
          "The Custom build payment state is unavailable.",
          { status: 409 }
        );
        const row = selected.rows[0];
        invariant(
          ["ready", "paid"].includes(row.attempt_state) &&
            row.checkout_session_id === resolution.checkoutSessionId &&
            row.purpose_digest === resolution.purposeDigest &&
            row.invoice_digest === resolution.purpose.invoiceDigest &&
            row.accepted_quote_digest === resolution.purpose.acceptedQuoteDigest &&
            row.accepted_disclosure_digest === resolution.purpose.acceptedDisclosureDigest &&
            row.event_state === "pending" &&
            row.payload_digest === event.payloadDigest,
          "CUSTOM_BUILD_PAYMENT_CONFLICT",
          "The Custom build invoice changed before settlement.",
          { status: 409 }
        );

        const existing = await client.query(
          `select receipt.*, job.id as job_id, job.state as job_state,
                  job.final_payment_state
           from ss.service_custom_build_payment_receipts receipt
           join ss.service_custom_build_jobs job
             on job.organization_id = receipt.organization_id
            and job.payment_receipt_id = receipt.id
           where receipt.organization_id = $1 and receipt.invoice_id = $2`,
          [resolution.organizationId, resolution.invoiceId]
        );
        let result;
        if (existing.rowCount === 1) {
          const receipt = existing.rows[0];
          invariant(
            row.attempt_state === "paid" &&
              row.credit_state === "settled" &&
              receipt.checkout_session_id === payment.checkoutSessionId &&
              receipt.payment_intent_id === payment.paymentIntentId &&
              receipt.stripe_customer_id === payment.customerId &&
              Number(receipt.subtotal_minor) === payment.subtotalMinor &&
              Number(receipt.tax_minor) === payment.taxMinor &&
              Number(receipt.total_minor) === payment.totalMinor &&
              receipt.provider_facts_digest === payment.providerFactsDigest &&
              receipt.job_state === "open",
            "CUSTOM_BUILD_PAYMENT_CONFLICT",
            "The retained Custom build payment receipt changed.",
            { status: 409 }
          );
          result = settlementResult({
            schema: CUSTOM_BUILD_PAYMENT_SETTLEMENT_SCHEMA,
            status: "payment_settled",
            projectId: resolution.projectId,
            invoiceId: resolution.invoiceId,
            receiptId: receipt.id,
            jobId: receipt.job_id,
            next: "custom_build_work"
          });
        } else {
          invariant(
            existing.rowCount === 0 &&
              row.attempt_state === "ready" &&
              row.credit_state === "reserved",
            "CUSTOM_BUILD_PAYMENT_CONFLICT",
            "The Custom build settlement state is inconsistent.",
            { status: 409 }
          );
          const boundCustomer = await client.query(
            `select stripe_customer_id from ss.stripe_customers
             where organization_id = $1 for update`,
            [resolution.organizationId]
          );
          if (boundCustomer.rowCount === 0) {
            await client.query(
              `insert into ss.stripe_customers (
                 organization_id, stripe_customer_id, created_from_receipt_id
               ) values ($1, $2, null)`,
              [resolution.organizationId, payment.customerId]
            );
          } else {
            invariant(
              boundCustomer.rowCount === 1 &&
                boundCustomer.rows[0].stripe_customer_id === payment.customerId,
              "CUSTOM_BUILD_STRIPE_CUSTOMER_CONFLICT",
              "The Custom build payment Customer does not match this account.",
              { status: 409 }
            );
          }
          const receiptId = uuid(
            paymentIds.next("custom_build_receipt"),
            "Payment receipt ID",
            "RUNTIME_CONFIGURATION_ERROR",
            500
          );
          const jobId = uuid(
            paymentIds.next("custom_build_job"),
            "Custom build job ID",
            "RUNTIME_CONFIGURATION_ERROR",
            500
          );
          const settledAt = iso(
            paymentClock.now(),
            "Custom build settlement time"
          );
          invariant(
            Date.parse(settledAt) >= Date.parse(payment.providerPaymentTime) &&
              Date.parse(settledAt) >= Date.parse(event.signatureVerifiedAt),
            "CUSTOM_BUILD_SETTLEMENT_CLOCK_INVALID",
            "Custom build settlement time precedes verified payment evidence.",
            { status: 500 }
          );
          await client.query(
            `insert into ss.service_custom_build_payment_receipts (
               id, organization_id, project_id, case_id,
               customer_user_id, invoice_id, checkout_attempt_id,
               stripe_event_id, credit_application_id, provider,
               checkout_session_id, payment_intent_id,
               stripe_customer_id, payment_status, subtotal_minor,
               tax_minor, total_minor, tax_mode, currency,
               purpose_digest, invoice_digest, accepted_quote_digest,
               accepted_disclosure_digest, provider_facts,
               provider_facts_digest, provider_paid_at, settled_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, 'stripe',
               $10, $11, $12, 'paid', $13, $14, $15,
               'automatic', 'USD', $16, $17, $18, $19,
               $20::jsonb, $21, $22, $23
             )`,
            [
              receiptId,
              resolution.organizationId,
              resolution.projectId,
              resolution.caseId,
              resolution.customerId,
              resolution.invoiceId,
              resolution.attemptId,
              event.eventId,
              resolution.creditApplicationId,
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
          await client.query(
            `insert into ss.service_custom_build_jobs (
               id, organization_id, project_id, case_id,
               customer_user_id, invoice_id, payment_receipt_id,
               quote_id, quote_revision, quote_revision_id,
               quote_acceptance_id, policy_id, scope_boundary_digest,
               tier_id, scope_statement, crafted_pages, sections,
               unique_layouts, content_words, supplied_media,
               target_completion_date, accepted_quote_digest,
               accepted_disclosure_digest, start_gross_minor,
               start_credit_minor, start_paid_subtotal_minor,
               final_due_minor, final_payment_state, currency,
               purpose, state, opened_at, created_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7,
               $8, $9, $10, $11, $12, $13, $14, $15,
               $16, $17, $18, $19, $20, $21, $22, $23,
               $24, $25, $26, $27::bigint,
               case when $27::bigint = 0 then 'not_required' else 'unpaid' end,
               'USD', 'custom_build', 'open', $28, $28
             )`,
            [
              jobId,
              resolution.organizationId,
              resolution.projectId,
              resolution.caseId,
              resolution.customerId,
              resolution.invoiceId,
              receiptId,
              row.quote_id,
              Number(row.quote_revision),
              row.quote_revision_id,
              row.quote_acceptance_id,
              row.policy_id,
              row.scope_boundary_digest,
              row.tier_id,
              row.scope_statement,
              Number(row.crafted_pages),
              Number(row.sections),
              Number(row.unique_layouts),
              Number(row.content_words),
              Number(row.supplied_media),
              row.target_completion_date,
              row.accepted_quote_digest,
              row.accepted_disclosure_digest,
              Number(row.gross_start_minor),
              Number(row.credit_minor),
              Number(row.subtotal_minor),
              Number(row.final_due_minor),
              settledAt
            ]
          );
          const creditSettled = await client.query(
            `update ss.service_credit_applications
             set state = 'settled', settled_at = $3
             where organization_id = $1 and id = $2 and state = 'reserved'`,
            [resolution.organizationId, resolution.creditApplicationId, settledAt]
          );
          invariant(
            creditSettled.rowCount === 1,
            "CUSTOM_BUILD_PAYMENT_CONFLICT",
            "The assessment build credit could not be settled with payment.",
            { status: 500 }
          );
          const checkoutPaid = await client.query(
            `update ss.service_custom_build_checkout_attempts
             set state = 'paid'
             where organization_id = $1 and id = $2 and state = 'ready'`,
            [resolution.organizationId, resolution.attemptId]
          );
          invariant(
            checkoutPaid.rowCount === 1,
            "CUSTOM_BUILD_PAYMENT_CONFLICT",
            "The paid Custom build Checkout could not be sealed.",
            { status: 500 }
          );
          result = settlementResult({
            schema: CUSTOM_BUILD_PAYMENT_SETTLEMENT_SCHEMA,
            status: "payment_settled",
            projectId: resolution.projectId,
            invoiceId: resolution.invoiceId,
            receiptId,
            jobId,
            next: "custom_build_work"
          });
        }
        const processed = await client.query(
          `update ss.service_custom_build_stripe_events
           set state = 'processed', result = $3::jsonb,
               completed_at = clock_timestamp()
           where organization_id = $1 and id = $2 and state = 'pending'`,
          [resolution.organizationId, event.eventId, JSON.stringify(result)]
        );
        invariant(
          processed.rowCount === 1,
          "CUSTOM_BUILD_PAYMENT_CONFLICT",
          "The Custom build Stripe event could not be completed.",
          { status: 500 }
        );
        return result;
      }
    ));
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
             attempt.invoice_id,
             attempt.checkout_session_id,
             attempt.purpose_digest,
             attempt.expires_at,
             invoice.invoice_number,
             invoice.quote_id,
             invoice.quote_revision_id,
             invoice.quote_acceptance_id,
             invoice.credit_application_id,
             invoice.accepted_quote_digest,
             invoice.accepted_disclosure_digest,
             invoice.invoice_digest,
             invoice.subtotal_minor
           from ss.service_custom_build_checkout_attempts attempt
           join ss.service_custom_build_invoices invoice
             on invoice.organization_id = attempt.organization_id
            and invoice.id = attempt.invoice_id
           left join ss.service_custom_build_payment_receipts receipt
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
          "CUSTOM_BUILD_CHECKOUT_RECONCILIATION_REQUIRED",
          "The Custom build payment page is not eligible for expiry reconciliation.",
          { status: 503 }
        );
        const row = selected.rows[0];
        const purpose = purposeFromRow(row);
        const purposeDigest = digest(purpose);
        invariant(
          row.purpose_digest === purposeDigest,
          "CUSTOM_BUILD_PAYMENT_CONFLICT",
          "The retained Custom build Checkout purpose changed.",
          { status: 500 }
        );
        return deepFreeze({
          organizationId: input.organizationId,
          projectId: input.projectId,
          customerId: input.customerId,
          invoiceId: input.invoiceId,
          attemptId: row.attempt_id,
          checkoutSessionId: row.checkout_session_id,
          purpose,
          purposeDigest
        });
      }
    ));
    let lifecycle;
    try {
      lifecycle = exactLifecycle(
        await paymentProvider.retrieveCustomBuildStartCheckoutLifecycle({
          checkoutSessionId: resolution.checkoutSessionId,
          purpose: resolution.purpose,
          purposeDigest: resolution.purposeDigest
        }),
        resolution
      );
    } catch (error) {
      throw new HostedError(
        "CUSTOM_BUILD_CHECKOUT_RECONCILIATION_REQUIRED",
        "The expired Custom build payment page could not be confirmed safely.",
        {
          status: 503,
          details: {
            providerErrorCode: providerCode(error, "stripe_custom_build_lifecycle_unavailable"),
            providerEffect: false
          }
        }
      );
    }
    invariant(
      lifecycle.state === "expired",
      "CUSTOM_BUILD_CHECKOUT_RECONCILIATION_REQUIRED",
      lifecycle.state === "paid"
        ? "Stripe reports this page was paid. Settlement must finish first."
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
        const updated = await client.query(
          `update ss.service_custom_build_checkout_attempts
           set state = 'expired'
           where organization_id = $1 and id = $2
             and state = 'ready' and expires_at <= clock_timestamp()
             and not exists (
               select 1 from ss.service_custom_build_payment_receipts receipt
               where receipt.organization_id = $1
                 and receipt.invoice_id = $3
             )`,
          [input.organizationId, resolution.attemptId, input.invoiceId]
        );
        invariant(
          updated.rowCount === 1,
          "CUSTOM_BUILD_CHECKOUT_RECONCILIATION_REQUIRED",
          "The expired Custom build payment page changed before release.",
          { status: 503 }
        );
        return deepFreeze({ status: "expired_reconciled", invoiceId: input.invoiceId });
      }
    ));
  }

  return Object.freeze({
    async readiness() {
      return translated(() => database.service(
        { readOnly: true },
        async (client) => {
          const selected = await client.query(
            `select ss.hosted_runtime_contract_v42() as runtime_contract`
          );
          invariant(
            selected.rowCount === 1 &&
              selected.rows[0].runtime_contract === RUNTIME_CONTRACT,
            "CUSTOM_BUILD_PAYMENT_HELD",
            "Custom build payment storage is not ready.",
            { status: 503 }
          );
          return deepFreeze({
            schema: "sitesourcery.custom-build-payment-readiness/v1",
            ready: paymentRelease.approved,
            state: paymentRelease.approved ? "approved" : "held",
            runtimeContract: RUNTIME_CONTRACT,
            automaticTax: true,
            stripeReadback: true,
            atomicCreditSettlement: true,
            opensBuildJob: true
          });
        }
      ));
    },

    readCurrentInvoice,

    async createCheckout(value) {
      const input = checkoutInput(value);
      invariant(
        paymentRelease.approved,
        "CUSTOM_BUILD_PAYMENT_HELD",
        "Custom build payment is held in this runtime.",
        { status: 503 }
      );
      const claim = await stageCheckout(input);
      if (claim.status === "replay") return claim.result;
      if (claim.status === "expired") {
        await reconcileExpiredCheckout(value);
        throw new HostedError(
          "CUSTOM_BUILD_CHECKOUT_REQUIRES_NEW_COMMAND",
          "The expired payment page is safely closed. Refresh before opening one replacement.",
          { status: 409 }
        );
      }
      let providerReturned = false;
      try {
        const returned = await paymentProvider.createCustomBuildStartCheckout({
          idempotencyKey: input.commandId,
          purpose: claim.purpose,
          purposeDigest: claim.purposeDigest,
          ...(claim.stripeCustomerId
            ? { stripeCustomerId: claim.stripeCustomerId }
            : {})
        });
        providerReturned = true;
        return await finishCheckout(input, claim, checkoutEvidence(returned));
      } catch (error) {
        const definitelyNotSubmitted =
          error instanceof ExternalEffectError &&
          error.certainty === "not_submitted";
        const ambiguous = providerReturned || !definitelyNotSubmitted;
        const code = providerCode(
          error,
          ambiguous
            ? "custom_build_checkout_effect_unknown"
            : "custom_build_checkout_not_submitted"
        );
        await markCheckoutFailure(input, claim, ambiguous, code);
        throw new HostedError(
          ambiguous
            ? "CUSTOM_BUILD_CHECKOUT_RECONCILIATION_REQUIRED"
            : "CUSTOM_BUILD_PAYMENT_UNAVAILABLE",
          ambiguous
            ? "The payment page could not be confirmed and will not be submitted again automatically."
            : "Secure Custom build payment is temporarily unavailable. Nothing was charged.",
          { status: 503 }
        );
      }
    },

    reconcileExpiredCheckout,

    async ingestStripeEvent(value) {
      invariant(
        isPotentialCustomBuildPaymentStripeEvent(value),
        "STRIPE_EVENT_INVALID",
        "The Stripe event is not a Custom build payment event.",
        { status: 400 }
      );
      const event = exactVerifiedEvent(value);
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
          await paymentProvider.retrieveCustomBuildStartPayment({
            checkoutSessionId: claimed.resolution.checkoutSessionId,
            purpose: claimed.resolution.purpose,
            purposeDigest: claimed.resolution.purposeDigest
          }),
          claimed.resolution
        );
      } catch (error) {
        const rejectedEvidence =
          error?.status === 502 ||
          error?.code === "CUSTOM_BUILD_PAYMENT_EVIDENCE_INVALID";
        if (rejectedEvidence) {
          return markReconciliation(
            event,
            claimed.resolution,
            error.code
          );
        }
        throw new HostedError(
          "CUSTOM_BUILD_PAYMENT_RECONCILIATION_UNAVAILABLE",
          "Stripe payment confirmation is temporarily unavailable. The event remains safe to retry.",
          {
            status: 503,
            details: {
              providerErrorCode: providerCode(error, "stripe_custom_build_read_unavailable"),
              providerEffect: false
            }
          }
        );
      }
      return settle(event, claimed.resolution, payment);
    }
  });
}
