import { createHash } from "node:crypto";

import {
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
  resolveAlakazamTier
} from "./alakazam.mjs";
import { createAlakazamBillingRelease } from "./alakazam-billing.mjs";
import {
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

export const ALAKAZAM_FINALIZATION_INVOICE_FACTS_SCHEMA =
  "sitesourcery.stripe-alakazam-finalization-invoice/v1";
export const ALAKAZAM_FINALIZATION_SUBSCRIPTION_SCHEMA =
  "sitesourcery.alakazam-finalization-subscription/v1";
export const ALAKAZAM_FINALIZATION_CUSTOMER_SCHEMA =
  "sitesourcery.alakazam-finalization-customer/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_]+$/u;
const INVOICE_ID = /^in_[A-Za-z0-9_]+$/u;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]+$/u;
const CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;
const EVENT_TYPES = new Set([
  "invoice.finalization_failed",
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_succeeded"
]);
const PASSTHROUGH_TYPES = new Set([
  "invoice.paid",
  "invoice.payment_succeeded"
]);
const STATES = new Set(["failed", "recovered"]);
const REASONS = new Set([
  "automatic_tax",
  "invoice_settings",
  "provider_rejected",
  "unknown_review"
]);

function exactKeys(value, expected, code, message) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    code,
    message
  );
  return value;
}

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(UUID.test(selected), "invalid_input", `${field} is invalid`);
  return selected;
}

function exactClock(clock) {
  const value = clock.now();
  return requiredIso(
    value instanceof Date ? value.toISOString() : String(value ?? ""),
    "clock.now"
  );
}

function invoiceSubscriptionId(invoice) {
  for (const candidate of [
    invoice?.parent?.subscription_details?.subscription,
    invoice?.subscription
  ]) {
    const selected = typeof candidate === "string" ? candidate : candidate?.id;
    if (typeof selected === "string" && SUBSCRIPTION_ID.test(selected)) {
      return selected;
    }
  }
  return null;
}

export function isAlakazamInvoiceFinalizationEvent(event) {
  const invoice = event?.data?.object;
  return Boolean(
    EVENT_TYPES.has(event?.type) &&
      invoice && typeof invoice === "object" && !Array.isArray(invoice) &&
      invoice.object === "invoice" && INVOICE_ID.test(invoice.id ?? "") &&
      invoiceSubscriptionId(invoice) !== null
  );
}

function exactEvent(value, verifiedAt) {
  invariant(
    value && EVENT_ID.test(value.id ?? "") && EVENT_TYPES.has(value.type) &&
      typeof value.livemode === "boolean" &&
      typeof value.api_version === "string" && value.api_version.length >= 3 &&
      value.api_version.length <= 100 && Number.isSafeInteger(value.created) &&
      value.created > 0,
    "stripe_event_invalid",
    "The verified Alakazam invoice finalization event is invalid",
    { status: 400 }
  );
  const stripeInvoiceId = requiredText(value.data?.object?.id, "event.invoiceId", 255);
  const stripeSubscriptionId = invoiceSubscriptionId(value.data.object);
  invariant(
    INVOICE_ID.test(stripeInvoiceId) && stripeSubscriptionId !== null,
    "stripe_event_invalid",
    "The verified finalization event has no invoiced Subscription",
    { status: 400 }
  );
  return deepFreeze({
    stripeEventId: value.id,
    eventType: value.type,
    livemode: value.livemode,
    apiVersion: value.api_version,
    stripeInvoiceId,
    stripeSubscriptionId,
    payloadDigest: createHash("sha256")
      .update(JSON.stringify(value), "utf8")
      .digest("hex"),
    signatureVerifiedAt: verifiedAt,
    occurredAt: new Date(value.created * 1000).toISOString()
  });
}

function exactSubscription(value, event) {
  exactKeys(value, [
    "customerId", "localSubscriptionId", "projectId", "revision", "schema",
    "status", "stripeCustomerId", "stripeSubscriptionId", "tenantId", "tierId"
  ], "repository_conflict", "the durable finalization subscription is invalid");
  resolveAlakazamTier(value.tierId);
  invariant(
    value.schema === ALAKAZAM_FINALIZATION_SUBSCRIPTION_SCHEMA &&
      UUID.test(value.customerId) && UUID.test(value.localSubscriptionId) &&
      UUID.test(value.projectId) && UUID.test(value.tenantId) &&
      Number.isSafeInteger(value.revision) && value.revision > 0 &&
      CUSTOMER_ID.test(value.stripeCustomerId) &&
      value.stripeSubscriptionId === event.stripeSubscriptionId &&
      ["active", "grace", "suspended", "cancelled"].includes(value.status),
    "repository_conflict",
    "the durable finalization subscription changed",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactResolved(value, event) {
  invariant(value && typeof value === "object" && !Array.isArray(value),
    "repository_conflict", "the Alakazam finalization binding is invalid", { status: 500 });
  if (value.status === "not_alakazam") {
    exactKeys(value, ["status"], "repository_conflict",
      "the Alakazam finalization binding is invalid");
    return Object.freeze({ status: "not_alakazam" });
  }
  exactKeys(value, value.status === "recorded"
    ? ["result", "status", "subscription"]
    : ["status", "subscription"], "repository_conflict",
  "the Alakazam finalization binding is invalid");
  invariant(["current", "recorded"].includes(value.status), "repository_conflict",
    "the Alakazam finalization binding is invalid", { status: 500 });
  return Object.freeze({
    status: value.status,
    subscription: exactSubscription(value.subscription, event),
    result: value.status === "recorded" ? exactResult(value.result, event) : null
  });
}

function exactFacts(value, resolved, event) {
  exactKeys(value, [
    "amountDueMinor", "billingReason", "collectionMethod", "currency",
    "finalizationState", "provider", "providerFactsDigest", "providerObservedAt",
    "reasonCode", "schema", "status", "stripeCustomerId", "stripeInvoiceId",
    "stripeSubscriptionId", "subscription", "tierId"
  ], "stripe_alakazam_finalization_mismatch",
  "Stripe returned invalid Alakazam finalization evidence");
  const facts = clone(value);
  delete facts.providerFactsDigest;
  const local = resolved.subscription;
  invariant(
    value.schema === ALAKAZAM_FINALIZATION_INVOICE_FACTS_SCHEMA &&
      value.provider === "stripe" && value.stripeInvoiceId === event.stripeInvoiceId &&
      value.stripeSubscriptionId === local.stripeSubscriptionId &&
      value.stripeCustomerId === local.stripeCustomerId &&
      value.tierId === local.tierId && ["draft", "open", "paid", "uncollectible", "void"].includes(value.status) &&
      STATES.has(value.finalizationState) &&
      ((value.finalizationState === "failed" && value.status === "draft" && REASONS.has(value.reasonCode)) ||
        (value.finalizationState === "recovered" && value.status !== "draft" && value.reasonCode === null)) &&
      value.billingReason === "subscription_cycle" &&
      value.collectionMethod === "charge_automatically" && value.currency === "USD" &&
      Number.isSafeInteger(value.amountDueMinor) && value.amountDueMinor > 0 &&
      value.subscription?.schema === ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA &&
      value.subscription.stripeSubscriptionId === local.stripeSubscriptionId &&
      value.subscription.stripeCustomerId === local.stripeCustomerId &&
      requiredIso(value.providerObservedAt, "finalization.providerObservedAt") &&
      requiredDigest(value.providerFactsDigest, "finalization.providerFactsDigest") === digest(facts),
    "stripe_alakazam_finalization_mismatch",
    "Stripe did not confirm the exact Alakazam invoice finalization state",
    { status: 502 }
  );
  return deepFreeze(clone(value));
}

function exactResult(value, event) {
  exactKeys(value, [
    "customer", "fulfillmentHeld", "incidentId", "next", "operator",
    "projectId", "provider", "renewalHeld", "revision", "state", "status",
    "subscriptionId"
  ], "repository_conflict", "the durable Alakazam finalization result is invalid");
  invariant(
    value.status === "finalization_recorded" && value.provider === "stripe" &&
      UUID.test(value.incidentId) && UUID.test(value.subscriptionId) && UUID.test(value.projectId) &&
      Number.isSafeInteger(value.revision) && value.revision > 0 && STATES.has(value.state) &&
      value.renewalHeld === (value.state === "failed") &&
      value.fulfillmentHeld === (value.state === "failed") &&
      value.next === (PASSTHROUGH_TYPES.has(event.eventType) ? "continue" : "complete"),
    "repository_conflict", "the durable Alakazam finalization result changed", { status: 500 }
  );
  exactCustomerProjection(value.customer, value.state);
  exactOperatorProjection(value.operator, value.state);
  return deepFreeze(clone(value));
}

export function exactCustomerProjection(value, state) {
  exactKeys(value, [
    "attentionRequired", "fulfillmentHeld", "messageCode", "renewalHeld", "schema", "state"
  ], "repository_conflict", "the customer finalization projection is invalid");
  invariant(
    value.schema === ALAKAZAM_FINALIZATION_CUSTOMER_SCHEMA && value.state === state &&
      value.attentionRequired === (state === "failed") &&
      value.fulfillmentHeld === (state === "failed") && value.renewalHeld === (state === "failed") &&
      value.messageCode === (state === "failed"
        ? "alakazam_invoice_preparation_attention"
        : "alakazam_invoice_preparation_current"),
    "repository_conflict", "the customer finalization projection changed", { status: 500 }
  );
  return value;
}

function exactOperatorProjection(value, state) {
  exactKeys(value, [
    "attentionRequired", "evidenceDigest", "invoiceIdDigest", "severity", "state"
  ], "repository_conflict", "the operator finalization projection is invalid");
  invariant(
    value.state === state && value.attentionRequired === (state === "failed") &&
      value.severity === (state === "failed" ? "high" : "resolved") &&
      /^[a-f0-9]{64}$/u.test(value.evidenceDigest) && /^[a-f0-9]{64}$/u.test(value.invoiceIdDigest),
    "repository_conflict", "the operator finalization projection changed", { status: 500 }
  );
  return value;
}

function nextUuid(ids, label) {
  return exactUuid(ids.next(label), label);
}

export function createAlakazamInvoiceFinalizationService({
  repository,
  provider,
  clock,
  ids,
  release = createAlakazamBillingRelease()
} = {}) {
  for (const [name, value, methods] of [
    ["repository", repository, [
      "readiness", "findFinalizationSubscriptionByInvoice",
      "recordInvoiceFinalization"
    ]],
    ["provider", provider, ["readiness", "retrieveAlakazamFinalizationInvoice"]],
    ["clock", clock, ["now"]],
    ["ids", ids, ["next"]]
  ]) {
    invariant(value && methods.every((method) => typeof value[method] === "function"),
      "invalid_configuration", `${name} port is incomplete`, { status: 500 });
  }
  const authority = createAlakazamBillingRelease({
    approved: release?.approved,
    taxMode: release?.taxMode ?? null
  });
  invariant(JSON.stringify(release) === JSON.stringify(authority), "invalid_configuration",
    "Alakazam finalization release does not match the reviewed billing contract", { status: 500 });

  async function readiness() {
    if (!authority.approved) return deepFreeze({
      ready: false, finalization: false, state: "held", code: "alakazam_billing_release_held"
    });
    let status;
    let storage;
    try {
      [status, storage] = await Promise.all([
        provider.readiness(), repository.readiness()
      ]);
    } catch {
      status = null;
      storage = null;
    }
    const ready = status?.ready === true && status.provider === "stripe" &&
      status.alakazam === true && status.taxModes?.alakazam === authority.taxMode &&
      typeof status.livemode === "boolean" && storage?.ready === true &&
      storage.verified === true && storage.providerEffects === false &&
      storage.fulfillmentEffects === false && storage.renewalEffects === false;
    return deepFreeze(ready ? {
      ready: true, finalization: true, state: "evidence_ready", provider: "stripe",
      livemode: status.livemode, taxMode: authority.taxMode,
      providerEffects: false, fulfillmentEffects: false, renewalEffects: false
    } : {
      ready: false, finalization: false, state: "unavailable",
      code: status?.code ?? "stripe_alakazam_not_ready"
    });
  }

  return Object.freeze({
    readiness,
    async ingestStripeEvent(input) {
      if (!isAlakazamInvoiceFinalizationEvent(input)) {
        return deepFreeze({ status: "not_alakazam_finalization" });
      }
      const status = await readiness();
      invariant(status.ready === true, "alakazam_finalization_reconciliation_unavailable",
        "Alakazam invoice preparation reconciliation is temporarily unavailable.", { status: 503 });
      const event = exactEvent(input, exactClock(clock));
      invariant(event.livemode === status.livemode, "stripe_event_invalid",
        "The Alakazam finalization event mode is invalid", { status: 400 });
      const resolved = exactResolved(
        await repository.findFinalizationSubscriptionByInvoice({
          stripeEventId: event.stripeEventId,
          stripeInvoiceId: event.stripeInvoiceId,
          stripeSubscriptionId: event.stripeSubscriptionId
        }), event
      );
      if (resolved.status === "not_alakazam") {
        return deepFreeze({ status: "not_alakazam_finalization" });
      }
      if (resolved.status === "recorded") return resolved.result;
      let readback;
      try {
        readback = await provider.retrieveAlakazamFinalizationInvoice({
          stripeInvoiceId: event.stripeInvoiceId,
          stripeSubscriptionId: resolved.subscription.stripeSubscriptionId,
          stripeCustomerId: resolved.subscription.stripeCustomerId
        });
      } catch {
        invariant(false, "alakazam_finalization_reconciliation_unavailable",
          "Alakazam invoice preparation reconciliation is temporarily unavailable.", { status: 503 });
      }
      const facts = exactFacts(readback, resolved, event);
      return exactResult(await repository.recordInvoiceFinalization({
        subscription: clone(resolved.subscription),
        event,
        invoice: clone(facts),
        observationId: nextUuid(ids, "alakazam_finalization_observation"),
        incidentId: nextUuid(ids, "alakazam_finalization_incident")
      }), event);
    }
  });
}
