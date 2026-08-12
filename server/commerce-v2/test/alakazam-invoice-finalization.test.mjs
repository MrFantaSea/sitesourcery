import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA
} from "../alakazam.mjs";
import { createAlakazamBillingRelease } from "../alakazam-billing.mjs";
import {
  ALAKAZAM_FINALIZATION_CUSTOMER_SCHEMA,
  ALAKAZAM_FINALIZATION_INVOICE_FACTS_SCHEMA,
  ALAKAZAM_FINALIZATION_SUBSCRIPTION_SCHEMA,
  createAlakazamInvoiceFinalizationService,
  isAlakazamInvoiceFinalizationEvent
} from "../alakazam-invoice-finalization.mjs";
import { digest } from "../canonical.mjs";

const TENANT_ID = "51000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "51000000-0000-4000-8000-000000000002";
const PROJECT_ID = "51000000-0000-4000-8000-000000000003";
const SUBSCRIPTION_ID = "51000000-0000-4000-8000-000000000004";
const OBSERVATION_ID = "52000000-0000-4000-8000-000000000001";
const INCIDENT_ID = "52000000-0000-4000-8000-000000000002";
const VERIFIED_AT = "2026-09-02T12:00:11.000Z";
const OBSERVED_AT = "2026-09-02T12:00:14.000Z";
const INVOICE_ID = "in_alakazam_finalization_1";
const STRIPE_SUBSCRIPTION_ID = "sub_alakazam_finalization_1";
const STRIPE_CUSTOMER_ID = "cus_alakazam_finalization_1";
const SHA = "a".repeat(64);

const RELEASE = createAlakazamBillingRelease({
  approved: true,
  taxMode: "disabled_by_owner"
});

function event(overrides = {}) {
  return {
    id: "evt_alakazam_finalization_1",
    type: "invoice.finalization_failed",
    livemode: false,
    api_version: "2026-06-24.dahlia",
    created: 1788350406,
    data: {
      object: {
        object: "invoice",
        id: INVOICE_ID,
        parent: {
          subscription_details: {
            subscription: STRIPE_SUBSCRIPTION_ID
          }
        }
      }
    },
    ...overrides
  };
}

function subscription() {
  return {
    schema: ALAKAZAM_FINALIZATION_SUBSCRIPTION_SCHEMA,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    localSubscriptionId: SUBSCRIPTION_ID,
    revision: 5,
    tierId: "alakazam_25",
    status: "active",
    stripeCustomerId: STRIPE_CUSTOMER_ID,
    stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID
  };
}

function providerSubscription() {
  return {
    schema: ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
    stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
    stripeCustomerId: STRIPE_CUSTOMER_ID
  };
}

function invoice(overrides = {}) {
  const facts = {
    schema: ALAKAZAM_FINALIZATION_INVOICE_FACTS_SCHEMA,
    provider: "stripe",
    stripeInvoiceId: INVOICE_ID,
    stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
    stripeCustomerId: STRIPE_CUSTOMER_ID,
    tierId: "alakazam_25",
    status: "draft",
    finalizationState: "failed",
    reasonCode: "automatic_tax",
    billingReason: "subscription_cycle",
    collectionMethod: "charge_automatically",
    amountDueMinor: 2500,
    currency: "USD",
    providerObservedAt: OBSERVED_AT,
    subscription: providerSubscription(),
    ...overrides
  };
  return { ...facts, providerFactsDigest: digest(facts) };
}

function durableResult(state, next = "complete") {
  const failed = state === "failed";
  return {
    status: "finalization_recorded",
    provider: "stripe",
    incidentId: INCIDENT_ID,
    subscriptionId: SUBSCRIPTION_ID,
    projectId: PROJECT_ID,
    state,
    renewalHeld: failed,
    fulfillmentHeld: failed,
    revision: state === "failed" ? 1 : 2,
    customer: {
      schema: ALAKAZAM_FINALIZATION_CUSTOMER_SCHEMA,
      state,
      attentionRequired: failed,
      renewalHeld: failed,
      fulfillmentHeld: failed,
      messageCode: failed
        ? "alakazam_invoice_preparation_attention"
        : "alakazam_invoice_preparation_current"
    },
    operator: {
      state,
      attentionRequired: failed,
      severity: failed ? "high" : "resolved",
      invoiceIdDigest: SHA,
      evidenceDigest: SHA
    },
    next
  };
}

function harness({ readback = invoice(), recorded = null, storageReady = true } = {}) {
  const calls = { find: [], readback: [], record: [] };
  const service = createAlakazamInvoiceFinalizationService({
    repository: {
      async readiness() {
        return {
          ready: storageReady,
          verified: storageReady,
          providerEffects: false,
          fulfillmentEffects: false,
          renewalEffects: false
        };
      },
      async findFinalizationSubscriptionByInvoice(input) {
        calls.find.push(structuredClone(input));
        return recorded ? {
          status: "recorded",
          subscription: subscription(),
          result: structuredClone(recorded)
        } : { status: "current", subscription: subscription() };
      },
      async recordInvoiceFinalization(input) {
        calls.record.push(structuredClone(input));
        return durableResult(
          input.invoice.finalizationState,
          ["invoice.paid", "invoice.payment_succeeded"].includes(input.event.eventType)
            ? "continue" : "complete"
        );
      }
    },
    provider: {
      async readiness() {
        return {
          ready: true,
          provider: "stripe",
          alakazam: true,
          taxModes: { alakazam: "disabled_by_owner" },
          livemode: false
        };
      },
      async retrieveAlakazamFinalizationInvoice(input) {
        calls.readback.push(structuredClone(input));
        return structuredClone(readback);
      }
    },
    clock: { now: () => VERIFIED_AT },
    ids: {
      next(label) {
        return label === "alakazam_finalization_observation"
          ? OBSERVATION_ID : INCIDENT_ID;
      }
    },
    release: RELEASE
  });
  return { calls, service };
}

test("only exact subscription invoice finalization signals enter the service", () => {
  assert.equal(isAlakazamInvoiceFinalizationEvent(event()), true);
  assert.equal(isAlakazamInvoiceFinalizationEvent(event({ type: "invoice.updated" })), false);
  assert.equal(isAlakazamInvoiceFinalizationEvent({ ...event(), data: { object: { object: "invoice", id: INVOICE_ID } } }), false);
});

test("a verified failure is rebound to provider truth and durably holds renewal and fulfillment", async () => {
  const context = harness();
  const result = await context.service.ingestStripeEvent(event());
  assert.equal(result.state, "failed");
  assert.equal(result.customer.attentionRequired, true);
  assert.equal(result.customer.messageCode, "alakazam_invoice_preparation_attention");
  assert.equal(result.operator.severity, "high");
  assert.equal(JSON.stringify(result).includes(INVOICE_ID), false);
  assert.deepEqual(context.calls.readback, [{
    stripeInvoiceId: INVOICE_ID,
    stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
    stripeCustomerId: STRIPE_CUSTOMER_ID
  }]);
  assert.equal(context.calls.record.length, 1);
  assert.equal(context.calls.record[0].invoice.providerFactsDigest,
    invoice().providerFactsDigest);
});

test("a later authoritative paid state clears only the matching hold then continues renewal", async () => {
  const recovered = invoice({
    status: "paid",
    finalizationState: "recovered",
    reasonCode: null,
    providerObservedAt: "2026-09-02T12:10:00.000Z"
  });
  const context = harness({ readback: recovered });
  const result = await context.service.ingestStripeEvent(event({
    id: "evt_alakazam_finalization_2",
    type: "invoice.paid",
    created: 1788351000
  }));
  assert.equal(result.state, "recovered");
  assert.equal(result.renewalHeld, false);
  assert.equal(result.fulfillmentHeld, false);
  assert.equal(result.next, "continue");
  assert.equal(result.customer.attentionRequired, false);
});

test("replay returns the exact durable result without another provider read", async () => {
  const prior = durableResult("failed");
  const context = harness({ recorded: prior });
  assert.deepEqual(await context.service.ingestStripeEvent(event()), prior);
  assert.equal(context.calls.readback.length, 0);
  assert.equal(context.calls.record.length, 0);
});

test("mismatched provider identity fails closed before durable state", async () => {
  const context = harness({
    readback: invoice({ stripeCustomerId: "cus_wrong_customer" })
  });
  await assert.rejects(
    context.service.ingestStripeEvent(event()),
    (error) => error.code === "stripe_alakazam_finalization_mismatch" && error.status === 502
  );
  assert.equal(context.calls.record.length, 0);
});

test("missing durable storage readiness stops before provider readback", async () => {
  const context = harness({ storageReady: false });
  await assert.rejects(
    context.service.ingestStripeEvent(event()),
    (error) => error.code === "alakazam_finalization_reconciliation_unavailable"
  );
  assert.equal(context.calls.find.length, 0);
  assert.equal(context.calls.readback.length, 0);
  assert.equal(context.calls.record.length, 0);
});

test("held release emits no provider or repository effect", async () => {
  let effects = 0;
  const held = createAlakazamInvoiceFinalizationService({
    repository: {
      async readiness() { effects += 1; },
      async findFinalizationSubscriptionByInvoice() { effects += 1; },
      async recordInvoiceFinalization() { effects += 1; }
    },
    provider: {
      async readiness() { effects += 1; },
      async retrieveAlakazamFinalizationInvoice() { effects += 1; }
    },
    clock: { now: () => VERIFIED_AT },
    ids: { next: () => OBSERVATION_ID }
  });
  await assert.rejects(
    held.ingestStripeEvent(event()),
    (error) => error.code === "alakazam_finalization_reconciliation_unavailable"
  );
  assert.equal(effects, 0);
});
