import { createHash, randomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

export const CUSTOM_SERVICES_ASSESSMENT_SETTLEMENT_READINESS_SCHEMA =
  "sitesourcery.custom-services-assessment-settlement-readiness/v1";
export const CUSTOM_SERVICES_ASSESSMENT_SETTLEMENT_RESULT_SCHEMA =
  "sitesourcery.custom-services-assessment-settlement/v1";
export const CUSTOM_SERVICES_ASSESSMENT_RECONCILIATION_RESULT_SCHEMA =
  "sitesourcery.custom-services-assessment-reconciliation/v1";
export const CUSTOM_SERVICES_ASSESSMENT_PROVIDER_METADATA_SCHEMA =
  "sitesourcery_service_assessment_checkout_v1";

const PURPOSE_SCHEMA =
  "sitesourcery.custom-services-assessment-checkout-purpose/v1";
const PAYMENT_FACTS_SCHEMA =
  "sitesourcery.stripe-service-assessment-payment-facts/v1";
const LIFECYCLE_SCHEMA =
  "sitesourcery.stripe-service-assessment-checkout-lifecycle/v1";
const EVENT_TYPE = "checkout.session.completed";
const EVENT_ID = /^evt_[A-Za-z0-9_]+$/u;
const CHECKOUT_ID = /^cs_[A-Za-z0-9_]+$/u;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/u;
const STRIPE_CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const INVOICE_NUMBER = /^SSA-[0-9A-F]{32}$/u;
const SAFE_CODE = /^[A-Za-z0-9._:-]{1,200}$/u;

function hasExactKeys(value, expected) {
  return Boolean(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort())
  );
}

function exactKeys(value, expected, code, message) {
  invariant(
    hasExactKeys(value, expected),
    code,
    message,
    { status: 400 }
  );
  return value;
}

function exactIso(value, field, code = "ASSESSMENT_SETTLEMENT_CONFLICT") {
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    !Number.isNaN(selected.getTime()),
    code,
    `${field} is unavailable.`,
    { status: 500 }
  );
  return selected.toISOString();
}

function exactUuid(value, field, code = "ASSESSMENT_SETTLEMENT_CONFLICT") {
  invariant(
    typeof value === "string" && UUID.test(value),
    code,
    `${field} is unavailable.`,
    { status: 500 }
  );
  return value;
}

function exactDigest(value, field, code = "ASSESSMENT_SETTLEMENT_CONFLICT") {
  invariant(
    typeof value === "string" && SHA256.test(value),
    code,
    `${field} is unavailable.`,
    { status: 500 }
  );
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Canonical PostgreSQL authority is required for assessment settlement.",
    { status: 500 }
  );
  return value;
}

function validateProvider(value) {
  invariant(
    value &&
      typeof value.retrieveServiceAssessmentPayment === "function" &&
      typeof value.retrieveServiceAssessmentCheckoutLifecycle === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Exact Stripe assessment readback is required.",
    { status: 500 }
  );
  return value;
}

function validateClock(value) {
  invariant(
    value && typeof value.now === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "An assessment settlement clock is required.",
    { status: 500 }
  );
  return value;
}

function validateIds(value) {
  const selected = value ?? { next: () => randomUUID() };
  invariant(
    typeof selected.next === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Assessment settlement IDs are required.",
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
      "42501",
      "55000"
    ].includes(error?.code)
  ) {
    return new HostedError(
      "ASSESSMENT_SETTLEMENT_REPOSITORY_CONFLICT",
      "The assessment settlement record rejected inconsistent evidence.",
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

export function isPotentialCustomServicesAssessmentStripeEvent(event) {
  return (
    event?.type === EVENT_TYPE &&
    event?.data?.object?.metadata?.schema ===
      CUSTOM_SERVICES_ASSESSMENT_PROVIDER_METADATA_SCHEMA
  );
}

function exactVerifiedEvent(value, verifiedAt) {
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
    "The verified assessment Stripe event is invalid.",
    { status: 400 }
  );
  const metadata = clone(value.data.object.metadata);
  exactKeys(
    metadata,
    [
      "accepted_disclosure_digest",
      "customer_id",
      "invoice_digest",
      "invoice_id",
      "invoice_number",
      "project_id",
      "purpose_digest",
      "quote_id",
      "schema",
      "tenant_id"
    ],
    "STRIPE_EVENT_INVALID",
    "The verified assessment Stripe metadata is invalid."
  );
  invariant(
    metadata.schema ===
      CUSTOM_SERVICES_ASSESSMENT_PROVIDER_METADATA_SCHEMA &&
      UUID.test(String(metadata.tenant_id ?? "")) &&
      UUID.test(String(metadata.customer_id ?? "")) &&
      UUID.test(String(metadata.project_id ?? "")) &&
      UUID.test(String(metadata.invoice_id ?? "")) &&
      INVOICE_NUMBER.test(String(metadata.invoice_number ?? "")) &&
      UUID.test(String(metadata.quote_id ?? "")) &&
      SHA256.test(String(metadata.accepted_disclosure_digest ?? "")) &&
      SHA256.test(String(metadata.invoice_digest ?? "")) &&
      SHA256.test(String(metadata.purpose_digest ?? "")),
    "STRIPE_EVENT_INVALID",
    "The verified assessment Stripe metadata is invalid.",
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
    providerCreatedAt: new Date(value.created * 1000).toISOString(),
    signatureVerifiedAt: exactIso(
      verifiedAt,
      "Stripe signature verification time",
      "STRIPE_EVENT_INVALID"
    )
  });
}

function purposeFromRow(row) {
  invariant(
    row &&
      UUID.test(String(row.organization_id ?? "")) &&
      UUID.test(String(row.project_id ?? "")) &&
      UUID.test(String(row.customer_user_id ?? "")) &&
      UUID.test(String(row.invoice_id ?? "")) &&
      UUID.test(String(row.quote_id ?? "")) &&
      INVOICE_NUMBER.test(String(row.invoice_number ?? "")) &&
      SHA256.test(String(row.accepted_disclosure_digest ?? "")) &&
      SHA256.test(String(row.invoice_digest ?? "")),
    "ASSESSMENT_SETTLEMENT_CONFLICT",
    "The durable assessment payment purpose is inconsistent.",
    { status: 500 }
  );
  return deepFreeze({
    schema: PURPOSE_SCHEMA,
    tenantId: row.organization_id,
    customerId: row.customer_user_id,
    projectId: row.project_id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    quoteId: row.quote_id,
    acceptedDisclosureDigest: row.accepted_disclosure_digest,
    invoiceDigest: row.invoice_digest,
    price: {
      amountMinor: 20000,
      currency: "USD",
      billing: "one_time",
      taxBehavior: "automatic_exclusive"
    }
  });
}

function expectedMetadata(resolution) {
  const purpose = resolution.purpose;
  return Object.freeze({
    schema: CUSTOM_SERVICES_ASSESSMENT_PROVIDER_METADATA_SCHEMA,
    tenant_id: purpose.tenantId,
    customer_id: purpose.customerId,
    project_id: purpose.projectId,
    invoice_id: purpose.invoiceId,
    invoice_number: purpose.invoiceNumber,
    quote_id: purpose.quoteId,
    accepted_disclosure_digest: purpose.acceptedDisclosureDigest,
    invoice_digest: purpose.invoiceDigest,
    purpose_digest: resolution.purposeDigest
  });
}

function exactMetadata(value, resolution) {
  const expected = expectedMetadata(resolution);
  invariant(
    hasExactKeys(value, Object.keys(expected)) &&
      Object.entries(expected).every(
        ([key, selected]) => value[key] === selected
      ),
    "STRIPE_EVENT_BINDING_INVALID",
    "The verified Stripe event does not match the retained assessment Checkout.",
    { status: 400 }
  );
  return expected;
}

function exactResult(value, expected = {}) {
  exactKeys(
    value,
    [
      "invoiceId",
      "jobId",
      "next",
      "projectId",
      "receiptId",
      "schema",
      "status"
    ],
    "ASSESSMENT_SETTLEMENT_CONFLICT",
    "The retained assessment settlement result is invalid."
  );
  invariant(
    value.schema ===
      CUSTOM_SERVICES_ASSESSMENT_SETTLEMENT_RESULT_SCHEMA &&
      value.status === "payment_settled" &&
      value.next === "assessment_work" &&
      UUID.test(String(value.projectId ?? "")) &&
      UUID.test(String(value.invoiceId ?? "")) &&
      UUID.test(String(value.receiptId ?? "")) &&
      UUID.test(String(value.jobId ?? "")) &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "ASSESSMENT_SETTLEMENT_CONFLICT",
    "The retained assessment settlement result changed.",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function reconciliationResult(resolution) {
  return deepFreeze({
    schema:
      CUSTOM_SERVICES_ASSESSMENT_RECONCILIATION_RESULT_SCHEMA,
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
    "ASSESSMENT_PAYMENT_EVIDENCE_INVALID",
    "Stripe returned invalid assessment payment evidence."
  );
  const facts = clone(value);
  delete facts.providerFactsDigest;
  const providerPaymentTime = exactIso(
    value.providerPaymentTime,
    "Stripe assessment payment time",
    "ASSESSMENT_PAYMENT_EVIDENCE_INVALID"
  );
  invariant(
    value.schema === PAYMENT_FACTS_SCHEMA &&
      value.provider === "stripe" &&
      value.checkoutSessionId === resolution.checkoutSessionId &&
      CHECKOUT_ID.test(value.checkoutSessionId) &&
      PAYMENT_INTENT_ID.test(String(value.paymentIntentId ?? "")) &&
      STRIPE_CUSTOMER_ID.test(String(value.customerId ?? "")) &&
      value.paymentStatus === "paid" &&
      value.subtotalMinor === 20000 &&
      Number.isSafeInteger(value.taxMinor) &&
      value.taxMinor >= 0 &&
      value.taxMinor <= 99_999_999 &&
      value.totalMinor === 20000 + value.taxMinor &&
      value.taxMode === "automatic" &&
      value.currency === "USD" &&
      value.purposeDigest === resolution.purposeDigest &&
      SHA256.test(String(value.providerFactsDigest ?? "")) &&
      digest(facts) === value.providerFactsDigest,
    "ASSESSMENT_PAYMENT_EVIDENCE_INVALID",
    "Stripe did not prove the exact paid assessment invoice.",
    { status: 502 }
  );
  return deepFreeze({
    ...clone(value),
    providerPaymentTime
  });
}

function exactLifecycle(value, resolution) {
  exactKeys(
    value,
    [
      "checkoutSessionId",
      "provider",
      "purposeDigest",
      "schema",
      "state"
    ],
    "ASSESSMENT_CHECKOUT_LIFECYCLE_INVALID",
    "Stripe returned invalid assessment Checkout lifecycle evidence."
  );
  invariant(
    value.schema === LIFECYCLE_SCHEMA &&
      value.provider === "stripe" &&
      value.checkoutSessionId === resolution.checkoutSessionId &&
      value.purposeDigest === resolution.purposeDigest &&
      ["open", "expired", "paid"].includes(value.state),
    "ASSESSMENT_CHECKOUT_LIFECYCLE_INVALID",
    "Stripe did not prove a safe assessment Checkout lifecycle.",
    { status: 502 }
  );
  return deepFreeze(clone(value));
}

function expiryScope(value) {
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
    "INVALID_ASSESSMENT_CHECKOUT",
    "The assessment Checkout reconciliation scope is invalid."
  );
  const selected = Object.freeze({
    actorId: exactUuid(
      value.actorId,
      "Assessment actor",
      "INVALID_ASSESSMENT_CHECKOUT"
    ),
    customerId: exactUuid(
      value.customerId,
      "Assessment customer",
      "INVALID_ASSESSMENT_CHECKOUT"
    ),
    organizationId: exactUuid(
      value.organizationId,
      "Assessment organization",
      "INVALID_ASSESSMENT_CHECKOUT"
    ),
    projectId: exactUuid(
      value.projectId,
      "Assessment project",
      "INVALID_ASSESSMENT_CHECKOUT"
    ),
    invoiceId: exactUuid(
      value.invoiceId,
      "Assessment invoice",
      "INVALID_ASSESSMENT_CHECKOUT"
    ),
    invoiceDigest: exactDigest(
      value.invoiceDigest,
      "Assessment invoice digest",
      "INVALID_ASSESSMENT_CHECKOUT"
    )
  });
  invariant(
    selected.actorId === selected.customerId,
    "ASSESSMENT_INVOICE_UNAVAILABLE",
    "The assessment invoice is unavailable.",
    { status: 404 }
  );
  return selected;
}

function exactClaimRow(row, event) {
  invariant(
    row &&
      row.checkout_session_id === event.checkoutSessionId &&
      row.attempt_state === "ready" &&
      row.provider === "stripe" &&
      row.provider_effect_certainty === "confirmed" &&
      Number(row.expected_subtotal_minor) === 20000 &&
      row.currency === "USD" &&
      row.tax_mode === "automatic" &&
      row.invoice_state === "tax_calculation_pending" &&
      row.invoice_purpose === "assessment" &&
      Number(row.subtotal_minor) === 20000 &&
      row.tax_state === "calculation_required" &&
      row.tax_minor === null &&
      row.total_minor === null &&
      row.payable === false &&
      row.charge_occurred === false &&
      row.reservation_state === "held" &&
      row.reservation_effect_certainty === "not_submitted" &&
      row.reservation_invoice_digest === row.invoice_digest &&
      row.attempt_invoice_digest === row.invoice_digest &&
      row.attempt_disclosure_digest ===
        row.accepted_disclosure_digest,
    "STRIPE_EVENT_BINDING_INVALID",
    "The verified Stripe event does not identify one retained assessment Checkout.",
    { status: 400 }
  );
  const purpose = purposeFromRow(row);
  const purposeDigest = digest(purpose);
  invariant(
    purposeDigest === row.purpose_digest,
    "ASSESSMENT_SETTLEMENT_CONFLICT",
    "The retained assessment Checkout purpose changed.",
    { status: 500 }
  );
  return deepFreeze({
    attemptId: exactUuid(row.attempt_id, "Checkout attempt"),
    attemptState: row.attempt_state,
    organizationId: purpose.tenantId,
    projectId: purpose.projectId,
    customerId: purpose.customerId,
    caseId: exactUuid(row.case_id, "Assessment case"),
    invoiceId: purpose.invoiceId,
    checkoutSessionId: event.checkoutSessionId,
    purpose,
    purposeDigest
  });
}

function eventMatches(row, event, resolution) {
  return Boolean(
    row &&
      row.id === event.eventId &&
      row.organization_id === resolution.organizationId &&
      row.project_id === resolution.projectId &&
      row.customer_user_id === resolution.customerId &&
      row.invoice_id === resolution.invoiceId &&
      row.checkout_attempt_id === resolution.attemptId &&
      row.event_type === event.eventType &&
      row.livemode === event.livemode &&
      row.api_version === event.apiVersion &&
      row.checkout_session_id === event.checkoutSessionId &&
      row.payload_digest === event.payloadDigest &&
      exactIso(row.provider_created_at, "Provider event time") ===
        event.providerCreatedAt &&
      exactIso(row.signature_verified_at, "Signature verification time") ===
        event.signatureVerifiedAt
  );
}

export function createPostgresCustomServicesAssessmentSettlement({
  authority,
  provider,
  clock,
  ids
} = {}) {
  const database = validateAuthority(authority);
  const paymentProvider = validateProvider(provider);
  const settlementClock = validateClock(clock);
  const settlementIds = validateIds(ids);

  async function claim(event) {
    const organizationId = event.metadata.tenant_id;
    return translated(() =>
      database.service(
        {
          actorKind: "system",
          organizationId
        },
        async (client) => {
          const selected = await client.query(
            `select
               attempt.id as attempt_id,
               attempt.state as attempt_state,
               attempt.provider,
               attempt.provider_effect_certainty,
               attempt.checkout_session_id,
               attempt.purpose_digest,
               attempt.invoice_digest as attempt_invoice_digest,
               attempt.accepted_disclosure_digest
                 as attempt_disclosure_digest,
               attempt.expected_subtotal_minor,
               attempt.currency,
               attempt.tax_mode,
               invoice.organization_id,
               invoice.project_id,
               invoice.case_id,
               invoice.customer_user_id,
               invoice.id as invoice_id,
               invoice.invoice_number,
               invoice.quote_id,
               invoice.invoice_digest,
               invoice.accepted_disclosure_digest,
               invoice.purpose as invoice_purpose,
               invoice.state as invoice_state,
               invoice.subtotal_minor,
               invoice.tax_state,
               invoice.tax_minor,
               invoice.total_minor,
               invoice.payable,
               invoice.charge_occurred,
               reservation.state as reservation_state,
               reservation.provider_effect_certainty
                 as reservation_effect_certainty,
               reservation.invoice_digest as reservation_invoice_digest
             from ss.service_assessment_checkout_attempts attempt
             join ss.service_invoices invoice
               on invoice.organization_id = attempt.organization_id
              and invoice.id = attempt.invoice_id
             join ss.service_payment_reservations reservation
               on reservation.organization_id = invoice.organization_id
              and reservation.invoice_id = invoice.id
            where attempt.organization_id = $1
              and attempt.checkout_session_id = $2
            for update of attempt`,
            [organizationId, event.checkoutSessionId]
          );
          invariant(
            selected.rowCount === 1,
            "STRIPE_EVENT_BINDING_INVALID",
            "The verified Stripe event does not identify one retained assessment Checkout.",
            { status: 400 }
          );
          const resolution = exactClaimRow(
            selected.rows[0],
            event
          );
          exactMetadata(event.metadata, resolution);

          await client.query(
            `insert into ss.service_assessment_stripe_events (
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
              resolution.organizationId,
              resolution.projectId,
              resolution.customerId,
              resolution.invoiceId,
              resolution.attemptId,
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
            `select *
               from ss.service_assessment_stripe_events
              where id = $1
              for update`,
            [event.eventId]
          );
          invariant(
            retained.rowCount === 1 &&
              eventMatches(retained.rows[0], event, resolution),
            "STRIPE_EVENT_CONFLICT",
            "The Stripe event ID was already retained with different evidence.",
            { status: 409 }
          );
          if (retained.rows[0].state === "processed") {
            return {
              status: "processed",
              result: exactResult(retained.rows[0].result, {
                projectId: resolution.projectId,
                invoiceId: resolution.invoiceId
              })
            };
          }
          if (
            retained.rows[0].state ===
            "reconciliation_required"
          ) {
            return {
              status: "reconciliation_required",
              result: reconciliationResult(resolution)
            };
          }
          invariant(
            retained.rows[0].state === "pending",
            "ASSESSMENT_SETTLEMENT_CONFLICT",
            "The assessment Stripe event is in an invalid state.",
            { status: 500 }
          );
          return { status: "pending", resolution };
        }
      )
    );
  }

  async function markReconciliation(
    event,
    resolution,
    providerErrorCode
  ) {
    const selectedCode = SAFE_CODE.test(
      String(providerErrorCode ?? "")
    )
      ? providerErrorCode
      : "stripe_assessment_payment_mismatch";
    return translated(() =>
      database.service(
        {
          actorKind: "system",
          organizationId: resolution.organizationId
        },
        async (client) => {
          const attempt = await client.query(
            `select id
               from ss.service_assessment_checkout_attempts
              where organization_id = $1
                and id = $2
                and state = 'ready'
              for update`,
            [resolution.organizationId, resolution.attemptId]
          );
          invariant(
            attempt.rowCount === 1,
            "ASSESSMENT_SETTLEMENT_CONFLICT",
            "The assessment Checkout changed during reconciliation.",
            { status: 409 }
          );
          const retained = await client.query(
            `select *
               from ss.service_assessment_stripe_events
              where organization_id = $1 and id = $2
              for update`,
            [resolution.organizationId, event.eventId]
          );
          invariant(
            retained.rowCount === 1 &&
              eventMatches(retained.rows[0], event, resolution),
            "STRIPE_EVENT_CONFLICT",
            "The retained assessment Stripe event changed during reconciliation.",
            { status: 409 }
          );
          if (retained.rows[0].state === "processed") {
            return exactResult(retained.rows[0].result, {
              projectId: resolution.projectId,
              invoiceId: resolution.invoiceId
            });
          }
          if (
            retained.rows[0].state ===
            "reconciliation_required"
          ) {
            return reconciliationResult(resolution);
          }
          const marked = await client.query(
            `update ss.service_assessment_stripe_events
                set state = 'reconciliation_required',
                    reconciliation_code = $3,
                    completed_at = clock_timestamp()
              where organization_id = $1
                and id = $2
                and state = 'pending'`,
            [
              resolution.organizationId,
              event.eventId,
              selectedCode
            ]
          );
          invariant(
            marked.rowCount === 1,
            "ASSESSMENT_SETTLEMENT_CONFLICT",
            "The unsafe assessment payment evidence could not be retained.",
            { status: 500 }
          );
          return reconciliationResult(resolution);
        }
      )
    );
  }

  async function settle(event, resolution, payment) {
    return translated(() =>
      database.service(
        {
          actorKind: "system",
          organizationId: resolution.organizationId
        },
        async (client) => {
          const selected = await client.query(
            `select
               attempt.*,
               invoice.case_id,
               invoice.quote_id,
               invoice.quote_revision,
               invoice.quote_revision_id,
               invoice.invoice_number,
               invoice.accepted_quote_digest,
               invoice.invoice_digest as retained_invoice_digest,
               invoice.accepted_disclosure_digest
                 as retained_disclosure_digest,
               revision.policy_id,
               revision.scope_boundary_digest,
               revision.review_targets,
               revision.maximum_websites,
               revision.maximum_representative_pages_or_types,
               revision.maximum_findings,
               revision.desktop_review_included,
               revision.phone_review_included,
               revision.delivery_date
             from ss.service_assessment_checkout_attempts attempt
             join ss.service_invoices invoice
               on invoice.organization_id = attempt.organization_id
              and invoice.id = attempt.invoice_id
             join ss.service_quote_revisions revision
               on revision.organization_id = invoice.organization_id
              and revision.quote_id = invoice.quote_id
              and revision.quote_revision = invoice.quote_revision
              and revision.id = invoice.quote_revision_id
            where attempt.organization_id = $1
              and attempt.id = $2
            for update of attempt`,
            [resolution.organizationId, resolution.attemptId]
          );
          const row = selected.rows[0];
          invariant(
            selected.rowCount === 1 &&
              row.state === "ready" &&
              row.project_id === resolution.projectId &&
              row.customer_user_id === resolution.customerId &&
              row.invoice_id === resolution.invoiceId &&
              row.case_id === resolution.caseId &&
              row.checkout_session_id === resolution.checkoutSessionId &&
              row.purpose_digest === resolution.purposeDigest &&
              row.invoice_digest === resolution.purpose.invoiceDigest &&
              row.accepted_quote_digest &&
              row.retained_invoice_digest ===
                resolution.purpose.invoiceDigest &&
              row.accepted_disclosure_digest ===
                resolution.purpose.acceptedDisclosureDigest &&
              row.retained_disclosure_digest ===
                resolution.purpose.acceptedDisclosureDigest &&
              Number(row.maximum_websites) === 1 &&
              Number(
                row.maximum_representative_pages_or_types
              ) === 5 &&
              Number(row.maximum_findings) === 10 &&
              row.desktop_review_included === true &&
              row.phone_review_included === true &&
              Array.isArray(row.review_targets) &&
              row.review_targets.length >= 1 &&
              row.review_targets.length <= 5,
            "ASSESSMENT_SETTLEMENT_CONFLICT",
            "The assessment Checkout changed before settlement.",
            { status: 409 }
          );

          const eventResult = await client.query(
            `select *
               from ss.service_assessment_stripe_events
              where organization_id = $1 and id = $2
              for update`,
            [resolution.organizationId, event.eventId]
          );
          invariant(
            eventResult.rowCount === 1 &&
              eventMatches(eventResult.rows[0], event, resolution),
            "STRIPE_EVENT_CONFLICT",
            "The retained assessment Stripe event changed before settlement.",
            { status: 409 }
          );
          if (eventResult.rows[0].state === "processed") {
            return exactResult(eventResult.rows[0].result, {
              projectId: resolution.projectId,
              invoiceId: resolution.invoiceId
            });
          }

          const existing = await client.query(
            `select receipt.*,
                    job.id as job_id,
                    job.state as job_state
               from ss.service_assessment_payment_receipts receipt
               join ss.service_assessment_jobs job
                 on job.organization_id = receipt.organization_id
                and job.payment_receipt_id = receipt.id
              where receipt.organization_id = $1
                and receipt.checkout_attempt_id = $2
              `,
            [resolution.organizationId, resolution.attemptId]
          );
          let result;
          if (existing.rowCount === 1) {
            const receipt = existing.rows[0];
            const retainedProviderFacts = clone(
              receipt.provider_facts
            );
            const retainedProviderFactsDigest =
              retainedProviderFacts.providerFactsDigest;
            delete retainedProviderFacts.providerFactsDigest;
            invariant(
              receipt.project_id === resolution.projectId &&
                receipt.case_id === resolution.caseId &&
                receipt.customer_user_id === resolution.customerId &&
                receipt.invoice_id === resolution.invoiceId &&
                receipt.checkout_session_id === payment.checkoutSessionId &&
                receipt.payment_intent_id === payment.paymentIntentId &&
                receipt.stripe_customer_id === payment.customerId &&
                Number(receipt.subtotal_minor) === payment.subtotalMinor &&
                Number(receipt.tax_minor) === payment.taxMinor &&
                Number(receipt.total_minor) === payment.totalMinor &&
                receipt.tax_mode === payment.taxMode &&
                receipt.currency === payment.currency &&
                receipt.purpose_digest === payment.purposeDigest &&
                receipt.provider_facts_digest ===
                  payment.providerFactsDigest &&
                retainedProviderFactsDigest ===
                  payment.providerFactsDigest &&
                digest(retainedProviderFacts) ===
                  payment.providerFactsDigest &&
                receipt.job_state === "open",
              "ASSESSMENT_SETTLEMENT_CONFLICT",
              "The retained assessment payment receipt changed.",
              { status: 409 }
            );
            result = exactResult({
              schema:
                CUSTOM_SERVICES_ASSESSMENT_SETTLEMENT_RESULT_SCHEMA,
              status: "payment_settled",
              projectId: resolution.projectId,
              invoiceId: resolution.invoiceId,
              receiptId: receipt.id,
              jobId: receipt.job_id,
              next: "assessment_work"
            });
          } else {
            invariant(
              existing.rowCount === 0,
              "ASSESSMENT_SETTLEMENT_CONFLICT",
              "The assessment Checkout settlement state is inconsistent.",
              { status: 409 }
            );
            const boundCustomer = await client.query(
              `select stripe_customer_id
                 from ss.stripe_customers
                where organization_id = $1
                for update`,
              [resolution.organizationId]
            );
            if (boundCustomer.rowCount === 0) {
              await client.query(
                `insert into ss.stripe_customers (
                   organization_id, stripe_customer_id,
                   created_from_receipt_id
                 ) values ($1, $2, null)`,
                [resolution.organizationId, payment.customerId]
              );
            } else {
              invariant(
                boundCustomer.rowCount === 1 &&
                  boundCustomer.rows[0].stripe_customer_id ===
                    payment.customerId,
                "ASSESSMENT_STRIPE_CUSTOMER_CONFLICT",
                "The assessment payment Customer does not match this account.",
                { status: 409 }
              );
            }

            const receiptId = exactUuid(
              settlementIds.next("assessment_receipt"),
              "Assessment receipt ID"
            );
            const jobId = exactUuid(
              settlementIds.next("assessment_job"),
              "Assessment job ID"
            );
            const settledAt = exactIso(
              settlementClock.now(),
              "Assessment settlement time"
            );
            invariant(
              Date.parse(settledAt) >=
                Date.parse(payment.providerPaymentTime) &&
                Date.parse(settledAt) >=
                  Date.parse(event.signatureVerifiedAt),
              "ASSESSMENT_SETTLEMENT_CLOCK_INVALID",
              "Assessment settlement time precedes verified payment evidence.",
              { status: 500 }
            );
            await client.query(
              `insert into ss.service_assessment_payment_receipts (
                 id, organization_id, project_id, case_id,
                 customer_user_id, invoice_id, checkout_attempt_id,
                 stripe_event_id, provider, checkout_session_id,
                 payment_intent_id, stripe_customer_id, payment_status,
                 subtotal_minor, tax_minor, total_minor, tax_mode,
                 currency, purpose_digest, invoice_digest,
                 accepted_disclosure_digest, provider_facts,
                 provider_facts_digest, provider_paid_at, settled_at
               ) values (
                 $1, $2, $3, $4, $5, $6, $7, $8,
                 'stripe', $9, $10, $11, 'paid',
                 20000, $12, $13, 'automatic', 'USD',
                 $14, $15, $16, $17::jsonb, $18, $19, $20
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
                payment.checkoutSessionId,
                payment.paymentIntentId,
                payment.customerId,
                payment.taxMinor,
                payment.totalMinor,
                payment.purposeDigest,
                resolution.purpose.invoiceDigest,
                resolution.purpose.acceptedDisclosureDigest,
                JSON.stringify(payment),
                payment.providerFactsDigest,
                payment.providerPaymentTime,
                settledAt
              ]
            );
            await client.query(
              `insert into ss.service_assessment_jobs (
                 id, organization_id, project_id, case_id,
                 customer_user_id, invoice_id, payment_receipt_id,
                 quote_id, quote_revision, quote_revision_id,
                 policy_id, scope_boundary_digest,
                 accepted_quote_digest, accepted_disclosure_digest,
                 review_targets, maximum_websites,
                 maximum_representative_pages_or_types,
                 maximum_findings, desktop_review_included,
                 phone_review_included, delivery_date,
                 purpose, state, opened_at, created_at
               ) values (
                 $1, $2, $3, $4, $5, $6, $7,
                 $8, $9, $10, $11, $12, $13, $14,
                 $15, 1, 5, 10, true, true, $16,
                 'assessment', 'open', $17, $17
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
                row.policy_id,
                row.scope_boundary_digest,
                row.accepted_quote_digest,
                row.retained_disclosure_digest,
                row.review_targets,
                row.delivery_date,
                settledAt
              ]
            );
            result = exactResult({
              schema:
                CUSTOM_SERVICES_ASSESSMENT_SETTLEMENT_RESULT_SCHEMA,
              status: "payment_settled",
              projectId: resolution.projectId,
              invoiceId: resolution.invoiceId,
              receiptId,
              jobId,
              next: "assessment_work"
            });
          }

          const processed = await client.query(
            `update ss.service_assessment_stripe_events
                set state = 'processed',
                    result = $3::jsonb,
                    completed_at = clock_timestamp()
              where organization_id = $1
                and id = $2
                and state = 'pending'`,
            [
              resolution.organizationId,
              event.eventId,
              JSON.stringify(result)
            ]
          );
          invariant(
            processed.rowCount === 1,
            "ASSESSMENT_SETTLEMENT_CONFLICT",
            "The assessment Stripe event could not complete atomically.",
            { status: 500 }
          );
          return result;
        }
      )
    );
  }

  async function prepareExpiredReconciliation(input) {
    return translated(() =>
      database.service(
        {
          actorKind: "customer",
          userId: input.actorId,
          organizationId: input.organizationId
        },
        async (client) => {
          const selected = await client.query(
            `select
               attempt.id as attempt_id,
               attempt.checkout_session_id,
               attempt.purpose_digest,
               attempt.invoice_digest as attempt_invoice_digest,
               attempt.accepted_disclosure_digest
                 as attempt_disclosure_digest,
               attempt.expires_at,
               invoice.organization_id,
               invoice.project_id,
               invoice.case_id,
               invoice.customer_user_id,
               invoice.id as invoice_id,
               invoice.invoice_number,
               invoice.quote_id,
               invoice.invoice_digest,
               invoice.accepted_disclosure_digest,
               receipt.id as payment_receipt_id
             from ss.service_assessment_checkout_attempts attempt
             join ss.service_invoices invoice
               on invoice.organization_id = attempt.organization_id
              and invoice.id = attempt.invoice_id
             left join ss.service_assessment_payment_receipts receipt
               on receipt.organization_id = invoice.organization_id
              and receipt.invoice_id = invoice.id
            where attempt.organization_id = $1
              and attempt.project_id = $2
              and attempt.customer_user_id = $3
              and attempt.invoice_id = $4
              and attempt.state = 'ready'
            order by attempt.created_at desc, attempt.id desc
            limit 2
            for update of attempt`,
            [
              input.organizationId,
              input.projectId,
              input.customerId,
              input.invoiceId
            ]
          );
          invariant(
            selected.rowCount === 1,
            "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
            "One retained assessment payment page could not be identified.",
            { status: 503 }
          );
          const row = selected.rows[0];
          invariant(
            row.invoice_digest === input.invoiceDigest &&
              row.attempt_invoice_digest === input.invoiceDigest &&
              row.attempt_disclosure_digest ===
                row.accepted_disclosure_digest &&
              row.payment_receipt_id === null &&
              CHECKOUT_ID.test(String(row.checkout_session_id ?? "")) &&
              Date.parse(exactIso(row.expires_at, "Checkout expiration")) <=
                Date.parse(
                  exactIso(
                    settlementClock.now(),
                    "Assessment reconciliation time"
                  )
                ),
            "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
            "The assessment payment page is not eligible for expiry reconciliation.",
            { status: 503 }
          );
          const purpose = purposeFromRow(row);
          const purposeDigest = digest(purpose);
          invariant(
            purposeDigest === row.purpose_digest,
            "ASSESSMENT_SETTLEMENT_CONFLICT",
            "The retained assessment Checkout purpose changed.",
            { status: 500 }
          );
          return deepFreeze({
            attemptId: row.attempt_id,
            organizationId: input.organizationId,
            projectId: input.projectId,
            customerId: input.customerId,
            invoiceId: input.invoiceId,
            checkoutSessionId: row.checkout_session_id,
            purpose,
            purposeDigest
          });
        }
      )
    );
  }

  async function expireReconciled(input, resolution) {
    return translated(() =>
      database.service(
        {
          actorKind: "customer",
          userId: input.actorId,
          organizationId: input.organizationId
        },
        async (client) => {
          const updated = await client.query(
            `update ss.service_assessment_checkout_attempts attempt
                set state = 'expired'
              where attempt.organization_id = $1
                and attempt.id = $2
                and attempt.project_id = $3
                and attempt.customer_user_id = $4
                and attempt.invoice_id = $5
                and attempt.checkout_session_id = $6
                and attempt.purpose_digest = $7
                and attempt.state = 'ready'
                and attempt.expires_at <= clock_timestamp()
                and not exists (
                  select 1
                    from ss.service_assessment_payment_receipts receipt
                   where receipt.organization_id = attempt.organization_id
                     and receipt.invoice_id = attempt.invoice_id
                )`,
            [
              input.organizationId,
              resolution.attemptId,
              input.projectId,
              input.customerId,
              input.invoiceId,
              resolution.checkoutSessionId,
              resolution.purposeDigest
            ]
          );
          invariant(
            updated.rowCount === 1,
            "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
            "The expired assessment payment page changed before it could be released.",
            { status: 503 }
          );
          return deepFreeze({
            status: "expired_reconciled",
            invoiceId: input.invoiceId
          });
        }
      )
    );
  }

  return Object.freeze({
    async readiness() {
      return deepFreeze({
        schema:
          CUSTOM_SERVICES_ASSESSMENT_SETTLEMENT_READINESS_SCHEMA,
        ready: true,
        webhookWakeup: true,
        stripeReadback: true,
        atomicSettlement: true
      });
    },

    async ingestStripeEvent(value) {
      invariant(
        isPotentialCustomServicesAssessmentStripeEvent(value),
        "STRIPE_EVENT_INVALID",
        "The Stripe event is not an assessment payment event.",
        { status: 400 }
      );
      const event = exactVerifiedEvent(
        value,
        settlementClock.now()
      );
      const claimed = await claim(event);
      if (
        claimed.status === "processed" ||
        claimed.status === "reconciliation_required"
      ) {
        return claimed.result;
      }
      let payment;
      try {
        payment = exactPaymentFacts(
          await paymentProvider.retrieveServiceAssessmentPayment({
            checkoutSessionId:
              claimed.resolution.checkoutSessionId,
            purpose: claimed.resolution.purpose,
            purposeDigest:
              claimed.resolution.purposeDigest
          }),
          claimed.resolution
        );
      } catch (error) {
        const providerEvidenceRejected =
          error?.status === 502 &&
          typeof error?.code === "string" &&
          error.code.startsWith("stripe_");
        if (
          error?.code ===
            "ASSESSMENT_PAYMENT_EVIDENCE_INVALID" ||
          providerEvidenceRejected
        ) {
          return markReconciliation(
            event,
            claimed.resolution,
            error.code
          );
        }
        throw new HostedError(
          "ASSESSMENT_PAYMENT_RECONCILIATION_UNAVAILABLE",
          "Stripe payment confirmation is temporarily unavailable. The event remains safe to retry.",
          {
            status: 503,
            details: {
              providerErrorCode:
                typeof error?.code === "string"
                  ? error.code
                  : "stripe_assessment_read_unavailable",
              providerEffect: false
            }
          }
        );
      }
      return settle(event, claimed.resolution, payment);
    },

    async reconcileExpiredCheckout(value) {
      const input = expiryScope(value);
      const resolution =
        await prepareExpiredReconciliation(input);
      let lifecycle;
      try {
        lifecycle = exactLifecycle(
          await paymentProvider
            .retrieveServiceAssessmentCheckoutLifecycle({
              checkoutSessionId:
                resolution.checkoutSessionId,
              purpose: resolution.purpose,
              purposeDigest: resolution.purposeDigest
            }),
          resolution
        );
      } catch (error) {
        throw new HostedError(
          "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
          "The expired payment page could not be confirmed safely. No replacement will open yet.",
          {
            status: 503,
            details: {
              providerErrorCode:
                typeof error?.code === "string"
                  ? error.code
                  : "stripe_assessment_lifecycle_unavailable",
              providerEffect: false
            }
          }
        );
      }
      invariant(
        lifecycle.state === "expired",
        "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED",
        lifecycle.state === "paid"
          ? "Stripe reports that this payment page was paid. Settlement must finish before any replacement."
          : "Stripe reports that this payment page is still open. No replacement will be created.",
        { status: 503 }
      );
      return expireReconciled(input, resolution);
    }
  });
}
