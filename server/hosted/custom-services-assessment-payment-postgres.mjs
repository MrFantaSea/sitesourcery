import { randomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { ExternalEffectError } from "../domain/errors.mjs";
import {
  validateCustomServicesAssessmentPaymentRelease
} from "./custom-services-assessment-payment-config.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

export const CUSTOM_SERVICES_ASSESSMENT_CHECKOUT_SCHEMA =
  "sitesourcery.custom-services-assessment-checkout/v1";
export const CUSTOM_SERVICES_ASSESSMENT_CHECKOUT_PURPOSE_SCHEMA =
  "sitesourcery.custom-services-assessment-checkout-purpose/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const INVOICE_NUMBER = /^SSA-[0-9A-F]{32}$/u;
const CHECKOUT_ID = /^cs_[A-Za-z0-9_]+$/u;
const STRIPE_CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;
const SAFE_CODE = /^[A-Za-z0-9._:-]{1,200}$/u;
const CHECKOUT_HOST = "checkout.stripe.com";
const ROUTE_KEY = "custom-services.assessment-checkout";

function exactKeys(value, expected, field) {
  invariant(
    hasExactKeys(value, expected),
    "INVALID_ASSESSMENT_CHECKOUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function hasExactKeys(value, expected) {
  return Boolean(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort())
  );
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "INVALID_ASSESSMENT_CHECKOUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "INVALID_ASSESSMENT_CHECKOUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function commandId(value) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      value.length >= 8 &&
      value.length <= 200,
    "IDEMPOTENCY_KEY_REQUIRED",
    "A valid idempotency key is required.",
    { status: 400 }
  );
  return value;
}

function iso(value, field) {
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    !Number.isNaN(selected.getTime()),
    "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
    `${field} is unavailable.`,
    { status: 503 }
  );
  return selected.toISOString();
}

function scope(value) {
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
    "assessmentCheckout"
  );
  const selected = Object.freeze({
    actorId: uuid(value.actorId, "Customer"),
    commandId: commandId(value.commandId),
    customerId: uuid(value.customerId, "Customer"),
    invoiceDigest: sha(value.invoiceDigest, "Invoice digest"),
    invoiceId: uuid(value.invoiceId, "Invoice"),
    organizationId: uuid(value.organizationId, "Organization"),
    projectId: uuid(value.projectId, "Project")
  });
  invariant(
    selected.actorId === selected.customerId,
    "ASSESSMENT_INVOICE_UNAVAILABLE",
    "The assessment invoice is unavailable.",
    { status: 404 }
  );
  return selected;
}

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Canonical PostgreSQL authority is required.",
    { status: 500 }
  );
  return value;
}

function validateProvider(value) {
  invariant(
    value &&
      typeof value.createServiceAssessmentCheckout === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "The assessment payment provider is required.",
    { status: 500 }
  );
  return value;
}

function validateReconciliation(value) {
  if (value === null || value === undefined) return null;
  invariant(
    typeof value.reconcileExpiredCheckout === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Assessment Checkout reconciliation is incomplete.",
    { status: 500 }
  );
  return value;
}

function expiredReady(row) {
  return Boolean(
    row?.state === "ready" &&
      Number.isFinite(Date.parse(row.expires_at)) &&
      Date.parse(row.expires_at) <= Date.now()
  );
}

function exactCheckout(value) {
  exactKeys(
    value,
    ["checkoutId", "expiresAt", "url"],
    "Stripe assessment Checkout"
  );
  invariant(
    CHECKOUT_ID.test(String(value.checkoutId ?? "")),
    "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
    "Stripe returned an invalid assessment Checkout identity.",
    { status: 503 }
  );
  let url;
  try {
    url = new URL(value.url);
  } catch {
    invariant(
      false,
      "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
      "Stripe returned an invalid assessment payment address.",
      { status: 503 }
    );
  }
  invariant(
    url.protocol === "https:" &&
      url.hostname === CHECKOUT_HOST &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash,
    "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
    "Stripe returned an unapproved assessment payment address.",
    { status: 503 }
  );
  const expiresAt = iso(value.expiresAt, "Checkout expiration");
  return Object.freeze({
    checkoutId: value.checkoutId,
    url: url.toString(),
    expiresAt
  });
}

function purpose(row, taxMode = row?.tax_mode) {
  invariant(
    row &&
      UUID.test(String(row.organization_id ?? "")) &&
      UUID.test(String(row.project_id ?? "")) &&
      UUID.test(String(row.customer_user_id ?? "")) &&
      UUID.test(String(row.invoice_id ?? "")) &&
      UUID.test(String(row.quote_id ?? "")) &&
      INVOICE_NUMBER.test(String(row.invoice_number ?? "")) &&
      SHA256.test(String(row.invoice_digest ?? "")) &&
      SHA256.test(String(row.accepted_disclosure_digest ?? "")) &&
      ["automatic", "disabled_by_owner"].includes(taxMode),
    "ASSESSMENT_INVOICE_CONFLICT",
    "The retained assessment invoice is inconsistent.",
    { status: 500 }
  );
  return deepFreeze({
    schema: CUSTOM_SERVICES_ASSESSMENT_CHECKOUT_PURPOSE_SCHEMA,
    tenantId: row.organization_id,
    customerId: row.customer_user_id,
    projectId: row.project_id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    quoteId: row.quote_id,
    acceptedDisclosureDigest:
      row.accepted_disclosure_digest,
    invoiceDigest: row.invoice_digest,
    taxMode,
    price: {
      amountMinor: 35000,
      currency: "USD",
      billing: "one_time",
      taxBehavior: "exclusive"
    }
  });
}

function response(row, input) {
  const checkout = exactCheckout({
    checkoutId: row.checkout_session_id,
    url: row.checkout_url,
    expiresAt: row.expires_at
  });
  invariant(
    UUID.test(String(row.invoice_id ?? "")) &&
      INVOICE_NUMBER.test(String(row.invoice_number ?? "")) &&
      Number(row.expected_subtotal_minor) === 35000 &&
      row.currency === "USD" &&
      ["automatic", "disabled_by_owner"].includes(
        row.tax_mode
      ) &&
      row.state === "ready" &&
      row.provider_effect_certainty === "confirmed",
    "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
    "The retained assessment Checkout is inconsistent.",
    { status: 503 }
  );
  invariant(
    row.organization_id === input.organizationId &&
      row.project_id === input.projectId &&
      row.customer_user_id === input.customerId &&
      row.invoice_id === input.invoiceId &&
      row.invoice_digest === input.invoiceDigest &&
      Date.parse(checkout.expiresAt) > Date.now(),
    "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
    "The retained assessment Checkout must be reconciled before use.",
    { status: 503 }
  );
  return deepFreeze({
    schema: CUSTOM_SERVICES_ASSESSMENT_CHECKOUT_SCHEMA,
    state: "ready",
    checkout: {
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      url: checkout.url,
      expiresAt: checkout.expiresAt,
      subtotal: {
        amountMinor: 35000,
        currency: "USD",
        formatted: "$350.00"
      },
      tax: {
        state: "calculated_at_checkout",
        amountMinor: null
      },
      total: {
        state: "shown_at_checkout",
        amountMinor: null,
        currency: "USD"
      },
      chargeOccurred: false
    }
  });
}

function safeResponse(value, input) {
  const checkout = value?.checkout;
  invariant(
    hasExactKeys(value, ["checkout", "schema", "state"]) &&
      value.schema === CUSTOM_SERVICES_ASSESSMENT_CHECKOUT_SCHEMA &&
      value.state === "ready" &&
      hasExactKeys(checkout, [
        "chargeOccurred",
        "expiresAt",
        "invoiceId",
        "invoiceNumber",
        "subtotal",
        "tax",
        "total",
        "url"
      ]) &&
      UUID.test(String(checkout.invoiceId ?? "")) &&
      INVOICE_NUMBER.test(String(checkout.invoiceNumber ?? "")) &&
      hasExactKeys(checkout.subtotal, [
        "amountMinor",
        "currency",
        "formatted"
      ]) &&
      checkout.subtotal.amountMinor === 35000 &&
      checkout.subtotal.currency === "USD" &&
      checkout.subtotal.formatted === "$350.00" &&
      hasExactKeys(checkout.tax, ["amountMinor", "state"]) &&
      checkout.tax.state === "calculated_at_checkout" &&
      checkout.tax.amountMinor === null &&
      hasExactKeys(checkout.total, [
        "amountMinor",
        "currency",
        "state"
      ]) &&
      checkout.total.state === "shown_at_checkout" &&
      checkout.total.amountMinor === null &&
      checkout.total.currency === "USD" &&
      checkout.chargeOccurred === false &&
      checkout.invoiceId === input.invoiceId,
    "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
    "The retained assessment Checkout response is invalid.",
    { status: 503 }
  );
  let url;
  try {
    url = new URL(checkout.url);
  } catch {
    url = null;
  }
  invariant(
    url &&
      url.protocol === "https:" &&
      url.hostname === CHECKOUT_HOST &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash,
    "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
    "The retained assessment payment address is invalid.",
    { status: 503 }
  );
  const expiresAt = iso(
    checkout.expiresAt,
    "Checkout expiration"
  );
  invariant(
    Date.parse(expiresAt) > Date.now(),
    "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
    "The retained assessment Checkout expired and must be reconciled.",
    { status: 503 }
  );
  return deepFreeze({
    schema: CUSTOM_SERVICES_ASSESSMENT_CHECKOUT_SCHEMA,
    state: "ready",
    checkout: {
      invoiceId: checkout.invoiceId,
      invoiceNumber: checkout.invoiceNumber,
      url: url.toString(),
      expiresAt,
      subtotal: {
        amountMinor: 35000,
        currency: "USD",
        formatted: "$350.00"
      },
      tax: {
        state: "calculated_at_checkout",
        amountMinor: null
      },
      total: {
        state: "shown_at_checkout",
        amountMinor: null,
        currency: "USD"
      },
      chargeOccurred: false
    }
  });
}

function providerCode(error, fallback) {
  const selected = String(error?.code ?? "");
  return SAFE_CODE.test(selected) ? selected : fallback;
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
    const translated = new HostedError(
      "ASSESSMENT_CHECKOUT_REPOSITORY_CONFLICT",
      "The assessment payment record rejected inconsistent evidence.",
      { status: 500 }
    );
    return translated;
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

function exactRequestDigest(input) {
  return digest({
    routeKey: ROUTE_KEY,
    organizationId: input.organizationId,
    projectId: input.projectId,
    invoiceId: input.invoiceId,
    invoiceDigest: input.invoiceDigest
  });
}

function attemptSelect() {
  return `select attempt.*,
                 invoice.invoice_number,
                 invoice.quote_id
            from ss.service_assessment_checkout_attempts attempt
            join ss.service_invoices invoice
              on invoice.organization_id = attempt.organization_id
             and invoice.id = attempt.invoice_id
           where attempt.organization_id = $1
             and attempt.id = $2`;
}

async function assertInvoiceUnpaid(client, input, invoiceId) {
  const receipt = await client.query(
    `select id
       from ss.service_assessment_payment_receipts
      where organization_id = $1
        and invoice_id = $2`,
    [input.organizationId, invoiceId]
  );
  invariant(
    receipt.rowCount === 0,
    "ASSESSMENT_INVOICE_ALREADY_PAID",
    "This assessment invoice is already paid. No payment page will be opened again.",
    { status: 409 }
  );
}

export function createPostgresCustomServicesAssessmentPayment({
  authority,
  provider,
  release,
  reconciliation = null
} = {}) {
  const database = validateAuthority(authority);
  const paymentProvider = validateProvider(provider);
  const paymentRelease =
    validateCustomServicesAssessmentPaymentRelease(release);
  const checkoutReconciliation =
    validateReconciliation(reconciliation);

  async function stage(input) {
    const requestDigest = exactRequestDigest(input);
    return translated(() =>
      database.service(
        {
          actorKind: "customer",
          userId: input.actorId,
          organizationId: input.organizationId
        },
        async (client) => {
          const prior = await client.query(
            `select *
               from ss.idempotency_keys
              where principal_id = $1
                and route_key = $2
                and idempotency_key = $3
              for update`,
            [input.actorId, ROUTE_KEY, input.commandId]
          );
          if (prior.rows[0]) {
            const command = prior.rows[0];
            invariant(
              command.request_digest === requestDigest,
              "IDEMPOTENCY_CONFLICT",
              "That idempotency key was already used for another action.",
              { status: 409 }
            );
            if (command.state === "completed") {
              invariant(
                command.organization_id === input.organizationId &&
                  command.response_status === 201 &&
                  command.resource_type ===
                    "service_assessment_checkout" &&
                  UUID.test(String(command.resource_id ?? "")),
                "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
                "The retained assessment payment response is incomplete.",
                { status: 503 }
              );
              const existing = await client.query(
                `${attemptSelect()} for update of attempt`,
                [input.organizationId, command.resource_id]
              );
              invariant(
                existing.rowCount === 1,
                "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
                "The retained assessment payment response is incomplete.",
                { status: 503 }
              );
              await assertInvoiceUnpaid(
                client,
                input,
                existing.rows[0].invoice_id
              );
              if (expiredReady(existing.rows[0])) {
                return { status: "reconcile" };
              }
              const canonical = response(
                existing.rows[0],
                input
              );
              const stored = safeResponse(
                command.response_body,
                input
              );
              invariant(
                digest(stored) === digest(canonical),
                "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
                "The retained assessment payment response changed.",
                { status: 503 }
              );
              return {
                status: "replay",
                result: canonical
              };
            }
            invariant(
              command.state === "running" &&
                command.resource_type ===
                  "service_assessment_checkout" &&
                UUID.test(String(command.resource_id ?? "")),
              "ASSESSMENT_CHECKOUT_REQUIRES_NEW_COMMAND",
              "That payment-page request already reached a final failure. Use a new request.",
              { status: 409 }
            );
            const existing = await client.query(
              `${attemptSelect()} for update of attempt`,
              [input.organizationId, command.resource_id]
            );
            invariant(
              existing.rowCount === 1,
              "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
              "The earlier assessment payment request is incomplete.",
              { status: 503 }
            );
            const row = existing.rows[0];
            await assertInvoiceUnpaid(
              client,
              input,
              row.invoice_id
            );
            if (expiredReady(row)) {
              return { status: "reconcile" };
            }
            if (row.state === "ready") {
              const result = response(row, input);
              await client.query(
                `update ss.idempotency_keys
                    set state = 'completed',
                        response_status = 201,
                        response_body = $2::jsonb
                  where id = $1 and state = 'running'`,
                [command.id, JSON.stringify(result)]
              );
              return { status: "replay", result };
            }
            invariant(
              row.state !== "persistence_unknown",
              "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
              "The earlier payment page needs reconciliation before another attempt. Nothing will be charged twice.",
              { status: 503 }
            );
            invariant(
              row.state !== "provider_pending",
              "ASSESSMENT_CHECKOUT_IN_PROGRESS",
              "The secure assessment payment page is still being prepared.",
              { status: 409 }
            );
            invariant(
              false,
              "ASSESSMENT_CHECKOUT_REQUIRES_NEW_COMMAND",
              "Use a new payment-page request.",
              { status: 409 }
            );
          }

          const invoiceResult = await client.query(
            `select
               invoice.id as invoice_id,
               invoice.organization_id,
               invoice.project_id,
               invoice.customer_user_id,
               invoice.invoice_number,
               invoice.quote_id,
               invoice.invoice_digest,
               invoice.accepted_disclosure_digest,
               invoice.subtotal_minor,
               invoice.tax_state,
               invoice.tax_minor,
               invoice.total_minor,
               invoice.currency,
               invoice.state as invoice_state,
               invoice.payable,
               invoice.charge_occurred,
               reservation.state as reservation_state,
               reservation.provider_effect_certainty
                 as reservation_effect_certainty,
               reservation.invoice_digest as reservation_invoice_digest,
               receipt.id as payment_receipt_id,
               customer.stripe_customer_id
             from ss.service_invoices invoice
             join ss.service_payment_reservations reservation
               on reservation.organization_id = invoice.organization_id
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
             left join ss.stripe_customers customer
               on customer.organization_id = invoice.organization_id
             left join ss.service_assessment_payment_receipts receipt
               on receipt.organization_id = invoice.organization_id
              and receipt.invoice_id = invoice.id
            where invoice.organization_id = $1
              and invoice.project_id = $2
              and invoice.customer_user_id = $3
              and invoice.id = $4`,
            [
              input.organizationId,
              input.projectId,
              input.customerId,
              input.invoiceId
            ]
          );
          invariant(
            invoiceResult.rowCount === 1,
            "ASSESSMENT_INVOICE_UNAVAILABLE",
            "The assessment invoice is unavailable.",
            { status: 404 }
          );
          const invoice = invoiceResult.rows[0];
          invariant(
            invoice.payment_receipt_id === null,
            "ASSESSMENT_INVOICE_ALREADY_PAID",
            "This assessment invoice is already paid. No payment page will be opened again.",
            { status: 409 }
          );
          invariant(
            invoice.invoice_digest === input.invoiceDigest &&
              invoice.reservation_invoice_digest ===
                input.invoiceDigest &&
              Number(invoice.subtotal_minor) === 35000 &&
              invoice.tax_state === "disabled_by_owner" &&
              invoice.tax_minor === null &&
              invoice.total_minor === null &&
              invoice.currency === "USD" &&
              invoice.invoice_state === "tax_calculation_pending" &&
              invoice.payable === false &&
              invoice.charge_occurred === false &&
              invoice.reservation_state === "held" &&
              invoice.reservation_effect_certainty ===
                "not_submitted" &&
              (
                invoice.stripe_customer_id === null ||
                STRIPE_CUSTOMER_ID.test(
                  invoice.stripe_customer_id
                )
              ),
            "ASSESSMENT_INVOICE_CONFLICT",
            "The assessment invoice changed before payment.",
            { status: 409 }
          );

          const active = await client.query(
            `select attempt.*,
                    invoice.invoice_number,
                    invoice.quote_id
               from ss.service_assessment_checkout_attempts attempt
               join ss.service_invoices invoice
                 on invoice.organization_id = attempt.organization_id
                and invoice.id = attempt.invoice_id
              where attempt.organization_id = $1
                and attempt.invoice_id = $2
                and attempt.state in (
                  'provider_pending', 'ready', 'persistence_unknown'
                )
              for update of attempt`,
            [input.organizationId, input.invoiceId]
          );
          if (active.rowCount === 1) {
            const row = active.rows[0];
            await assertInvoiceUnpaid(
              client,
              input,
              row.invoice_id
            );
            if (expiredReady(row)) {
              return { status: "reconcile" };
            }
            if (
              row.state === "ready" &&
              Date.parse(iso(row.expires_at, "Checkout expiration")) >
                Date.now()
            ) {
              const result = response(row, input);
              await client.query(
                `insert into ss.idempotency_keys (
                   id, organization_id, principal_id, route_key,
                   idempotency_key, request_digest, state,
                   response_status, response_body,
                   resource_type, resource_id, created_at, expires_at
                 ) values (
                   $1, $2, $3, $4, $5, $6, 'completed',
                   201, $7::jsonb,
                   'service_assessment_checkout', $8,
                   clock_timestamp(), clock_timestamp() + interval '24 hours'
                 )`,
                [
                  randomUUID(),
                  input.organizationId,
                  input.actorId,
                  ROUTE_KEY,
                  input.commandId,
                  requestDigest,
                  JSON.stringify(result),
                  row.id
                ]
              );
              return { status: "replay", result };
            }
            invariant(
              row.state !== "provider_pending",
              "ASSESSMENT_CHECKOUT_IN_PROGRESS",
              "A secure assessment payment page is still being prepared.",
              { status: 409 }
            );
            invariant(
              row.state !== "persistence_unknown",
              "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
              "An earlier payment page needs reconciliation. Nothing will be charged twice.",
              { status: 503 }
            );
            invariant(
              false,
              "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
              "The earlier payment page must be reconciled before a replacement opens.",
              { status: 503 }
            );
          }

          const checkoutPurpose = purpose(
            invoice,
            paymentRelease.taxMode
          );
          const purposeDigest = digest(checkoutPurpose);
          const attemptId = randomUUID();
          const commandRowId = randomUUID();
          await client.query(
            `insert into ss.idempotency_keys (
               id, organization_id, principal_id, route_key,
               idempotency_key, request_digest, state,
               resource_type, resource_id, created_at, expires_at
             ) values (
               $1, $2, $3, $4, $5, $6, 'running',
               'service_assessment_checkout', $7,
               clock_timestamp(), clock_timestamp() + interval '24 hours'
             )`,
            [
              commandRowId,
              input.organizationId,
              input.actorId,
              ROUTE_KEY,
              input.commandId,
              requestDigest,
              attemptId
            ]
          );
          await client.query(
            `insert into ss.service_assessment_checkout_attempts (
               id, organization_id, project_id, customer_user_id,
               invoice_id, command_id, provider, purpose_digest,
               invoice_digest, accepted_disclosure_digest,
               expected_subtotal_minor, currency, tax_mode,
               state, provider_effect_certainty
             ) values (
               $1, $2, $3, $4, $5, $6, 'stripe', $7,
               $8, $9, 35000, 'USD', $10,
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
              invoice.accepted_disclosure_digest,
              paymentRelease.taxMode
            ]
          );
          return {
            status: "claimed",
            attemptId,
            commandRowId,
            purpose: checkoutPurpose,
            purposeDigest,
            stripeCustomerId: invoice.stripe_customer_id
          };
        }
      )
    );
  }

  async function finish(input, claim, checkout) {
    return translated(() =>
      database.service(
        {
          actorKind: "customer",
          userId: input.actorId,
          organizationId: input.organizationId
        },
        async (client) => {
          const commandResult = await client.query(
            `select *
               from ss.idempotency_keys
              where organization_id = $1 and id = $2
              for update`,
            [input.organizationId, claim.commandRowId]
          );
          invariant(
            commandResult.rowCount === 1 &&
              commandResult.rows[0].principal_id ===
                input.actorId &&
              commandResult.rows[0].route_key === ROUTE_KEY &&
              commandResult.rows[0].idempotency_key ===
                input.commandId &&
              commandResult.rows[0].request_digest ===
                exactRequestDigest(input) &&
              commandResult.rows[0].state === "running" &&
              commandResult.rows[0].resource_type ===
                "service_assessment_checkout" &&
              commandResult.rows[0].resource_id ===
                claim.attemptId,
            "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
            "The assessment payment command changed during Checkout.",
            { status: 503 }
          );
          const selected = await client.query(
            `${attemptSelect()} for update of attempt`,
            [input.organizationId, claim.attemptId]
          );
          invariant(
            selected.rowCount === 1,
            "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
            "The assessment payment page could not be retained.",
            { status: 503 }
          );
          const row = selected.rows[0];
          invariant(
            row.invoice_id === input.invoiceId &&
              row.command_id === input.commandId &&
              row.purpose_digest === claim.purposeDigest &&
              row.invoice_digest === input.invoiceDigest,
            "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
            "The assessment payment authority changed during Checkout.",
            { status: 503 }
          );
          if (row.state === "ready") {
            invariant(
              row.checkout_session_id === checkout.checkoutId &&
                row.checkout_url === checkout.url &&
                iso(row.expires_at, "Checkout expiration") ===
                  checkout.expiresAt,
              "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
              "Stripe returned conflicting assessment Checkout evidence.",
              { status: 503 }
            );
          } else {
            invariant(
              row.state === "provider_pending",
              "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
              "The assessment payment page cannot be finalized.",
              { status: 503 }
            );
            await client.query(
              `update ss.service_assessment_checkout_attempts
                  set state = 'ready',
                      provider_effect_certainty = 'confirmed',
                      checkout_session_id = $3,
                      checkout_url = $4,
                      expires_at = $5,
                      provider_error_code = null
                where organization_id = $1 and id = $2`,
              [
                input.organizationId,
                claim.attemptId,
                checkout.checkoutId,
                checkout.url,
                checkout.expiresAt
              ]
            );
          }
          const finalized = await client.query(
            attemptSelect(),
            [input.organizationId, claim.attemptId]
          );
          invariant(
            finalized.rowCount === 1,
            "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
            "The assessment payment page could not be read back.",
            { status: 503 }
          );
          const result = response(
            finalized.rows[0],
            input
          );
          const completed = await client.query(
            `update ss.idempotency_keys
                set state = 'completed',
                    response_status = 201,
                    response_body = $2::jsonb
              where id = $1 and state = 'running'`,
            [claim.commandRowId, JSON.stringify(result)]
          );
          invariant(
            completed.rowCount === 1,
            "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
            "The assessment payment command could not be completed.",
            { status: 503 }
          );
          return result;
        }
      )
    );
  }

  async function mark(input, claim, state, certainty, code) {
    try {
      await translated(() =>
        database.service(
          {
            actorKind: "customer",
            userId: input.actorId,
            organizationId: input.organizationId
          },
          async (client) => {
            const commandResult = await client.query(
              `select *
                 from ss.idempotency_keys
                where organization_id = $1 and id = $2
                for update`,
              [input.organizationId, claim.commandRowId]
            );
            invariant(
              commandResult.rowCount === 1 &&
                commandResult.rows[0].principal_id ===
                  input.actorId &&
                commandResult.rows[0].route_key === ROUTE_KEY &&
                commandResult.rows[0].idempotency_key ===
                  input.commandId &&
                commandResult.rows[0].request_digest ===
                  exactRequestDigest(input) &&
                commandResult.rows[0].state === "running" &&
                commandResult.rows[0].resource_type ===
                  "service_assessment_checkout" &&
                commandResult.rows[0].resource_id ===
                  claim.attemptId,
              "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
              "The assessment payment command could not record its outcome.",
              { status: 503 }
            );
            const marked = await client.query(
              `update ss.service_assessment_checkout_attempts
                  set state = $3,
                      provider_effect_certainty = $4,
                      provider_error_code = $5
                where organization_id = $1
                  and id = $2
                  and state = 'provider_pending'`,
              [
                input.organizationId,
                claim.attemptId,
                state,
                certainty,
                code
              ]
            );
            invariant(
              marked.rowCount === 1,
              "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
              "The assessment payment attempt could not record its outcome.",
              { status: 503 }
            );
            const commandMarked = await client.query(
              `update ss.idempotency_keys
                  set state = case
                        when $3 = 'persistence_unknown'
                          then 'running'
                        else 'failed'
                      end,
                      response_status = 503,
                      response_body = $2::jsonb
                where id = $1 and state = 'running'`,
              [
                claim.commandRowId,
                JSON.stringify({
                  error: { code, certainty }
                }),
                state
              ]
            );
            invariant(
              commandMarked.rowCount === 1,
              "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
              "The assessment payment command could not retain its outcome.",
              { status: 503 }
            );
          }
        )
      );
    } catch {
      // The caller still fails closed. An unrecorded post-provider failure is
      // operational reconciliation work, never permission to retry a charge.
    }
  }

  return Object.freeze({
    async readiness() {
      return deepFreeze({
        ready: paymentRelease.approved,
        checkout: paymentRelease.approved,
        state: paymentRelease.approved
          ? "approved"
          : "held"
      });
    },

    async createCheckout(value) {
      const input = scope(value);
      invariant(
        paymentRelease.approved,
        "CUSTOM_SERVICES_ASSESSMENT_PAYMENT_HELD",
        "Assessment payment is held in this runtime.",
        { status: 503 }
      );
      const claim = await stage(input);
      if (claim.status === "replay") return claim.result;
      if (claim.status === "reconcile") {
        invariant(
          checkoutReconciliation,
          "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
          "The earlier payment page must be reconciled before a replacement opens.",
          { status: 503 }
        );
        await checkoutReconciliation
          .reconcileExpiredCheckout(value);
        throw new HostedError(
          "ASSESSMENT_CHECKOUT_REQUIRES_NEW_COMMAND",
          "The expired payment page is safely closed. Refresh before opening one replacement.",
          { status: 409 }
        );
      }

      let providerReturned = false;
      try {
        const providerResult = await paymentProvider
          .createServiceAssessmentCheckout({
            idempotencyKey: input.commandId,
            purpose: claim.purpose,
            purposeDigest: claim.purposeDigest,
            ...(claim.stripeCustomerId
              ? {
                  stripeCustomerId:
                    claim.stripeCustomerId
                }
              : {})
          });
        providerReturned = true;
        const checkout = exactCheckout(providerResult);
        return await finish(input, claim, checkout);
      } catch (error) {
        const definitelyNotSubmitted =
          error instanceof ExternalEffectError &&
          error.certainty === "not_submitted";
        const ambiguous =
          providerReturned || !definitelyNotSubmitted;
        const code = providerCode(
          error,
          ambiguous
            ? "assessment_checkout_effect_unknown"
            : "assessment_checkout_not_submitted"
        );
        await mark(
          input,
          claim,
          ambiguous ? "persistence_unknown" : "failed",
          ambiguous ? "ambiguous" : "not_submitted",
          code
        );
        throw new HostedError(
          ambiguous
            ? "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED"
            : "ASSESSMENT_PAYMENT_UNAVAILABLE",
          ambiguous
            ? "The payment page could not be confirmed and will not be retried automatically. Nothing should be paid twice."
            : "Secure assessment payment is temporarily unavailable. Nothing was charged.",
          { status: 503 }
        );
      }
    }
  });
}
