import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_PAYMENT_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
  createAlakazamCheckoutDispatch,
  createAlakazamProviderMetadata
} from "../alakazam.mjs";
import {
  createAlakazamBillingRelease
} from "../alakazam-billing.mjs";
import {
  createAlakazamPaymentService,
  isAlakazamCheckoutPaymentEvent
} from "../alakazam-payment.mjs";
import { digest } from "../canonical.mjs";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "10000000-0000-4000-8000-000000000002";
const PROJECT_ID = "10000000-0000-4000-8000-000000000003";
const QUOTE_ID = "10000000-0000-4000-8000-000000000004";
const DISPATCH_ID = "10000000-0000-4000-8000-000000000005";
const LOCAL_SUBSCRIPTION_ID =
  "10000000-0000-4000-8000-000000000006";
const DOWNLOAD_ENTITLEMENT_ID =
  "10000000-0000-4000-8000-000000000007";
const EVENT_ROW_ID = "20000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "20000000-0000-4000-8000-000000000002";
const NEW_SUBSCRIPTION_ID =
  "20000000-0000-4000-8000-000000000003";
const CREDIT_APPLICATION_ID =
  "20000000-0000-4000-8000-000000000004";
const TIER_EVENT_ID = "20000000-0000-4000-8000-000000000005";
const CLAIMED_AT = "2026-08-02T12:00:00.000Z";
const VERIFIED_AT = "2026-08-02T12:05:00.000Z";
const PAYMENT_AT = "2026-08-02T12:04:00.000Z";
const PERIOD_START = "2026-08-02T12:04:00.000Z";
const PERIOD_END = "2026-09-02T12:04:00.000Z";
const CHECKOUT_ID = "cs_alakazam_payment_1";

function reservation({ changeKind = "start" } = {}) {
  return createAlakazamCheckoutDispatch({
    dispatchId: DISPATCH_ID,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    stripeCustomerId: "cus_alakazam_payment_1",
    acceptedDisclosureDigest: digest("accepted disclosure"),
    quoteDigest: digest("quote"),
    changeKind,
    currentSubscription:
      changeKind === "upgrade"
        ? {
            localSubscriptionId: LOCAL_SUBSCRIPTION_ID,
            revision: 3,
            tierId: "alakazam_25",
            amountMinor: 2500,
            stripeSubscriptionId: "sub_alakazam_payment_1",
            stripeSubscriptionItemId: "si_alakazam_payment_1",
            stripePriceId: "price_alakazam_25",
            currentPeriodStartsAt: PERIOD_START,
            currentPeriodEndsAt: PERIOD_END,
            providerFactsDigest: digest("current provider facts")
          }
        : null,
    targetTierId:
      changeKind === "upgrade"
        ? "alakazam_35"
        : "alakazam_25",
    dueNowSubtotalMinor:
      changeKind === "upgrade" ? 1000 : 2000,
    taxMode: "disabled_by_owner",
    downloadCredit:
      changeKind === "start"
        ? {
            entitlementId: DOWNLOAD_ENTITLEMENT_ID,
            amountMinor: 500
          }
        : null,
    claimedAt: CLAIMED_AT
  });
}

function checkout() {
  return {
    checkoutId: CHECKOUT_ID,
    url: "https://checkout.stripe.com/c/pay/alakazam_payment_1",
    expiresAt: "2026-08-02T12:30:00.000Z"
  };
}

function subscriptionFacts(selected) {
  const facts = {
    schema: ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
    stripeSubscriptionId: "sub_alakazam_payment_1",
    stripeSubscriptionItemId: "si_alakazam_payment_1",
    stripeCustomerId: selected.stripeCustomerId,
    stripePriceId: "price_alakazam_25",
    stripeScheduleId: null,
    tierId: "alakazam_25",
    amountMinor: 2500,
    currency: "USD",
    providerStatus: "active",
    cancelAtPeriodEnd: false,
    currentPeriodStartsAt: PERIOD_START,
    currentPeriodEndsAt: PERIOD_END,
    billingCycleAnchor: PERIOD_START,
    providerObservedAt: PAYMENT_AT,
    metadata: createAlakazamProviderMetadata({
      purpose: selected.purpose,
      purposeDigest: selected.purposeDigest
    })
  };
  return {
    ...facts,
    providerFactsDigest: digest(facts)
  };
}

function paymentFacts(selected) {
  const start = selected.purpose.changeKind === "start";
  const subscription = start
    ? subscriptionFacts(selected)
    : null;
  const facts = {
    schema: ALAKAZAM_PAYMENT_PROVIDER_FACTS_SCHEMA,
    provider: "stripe",
    changeKind: selected.purpose.changeKind,
    checkoutSessionId: CHECKOUT_ID,
    stripeCustomerId: selected.stripeCustomerId,
    stripeSubscriptionId:
      subscription?.stripeSubscriptionId ??
      selected.purpose.currentSubscription.stripeSubscriptionId,
    stripeSubscriptionItemId:
      subscription?.stripeSubscriptionItemId ??
      selected.purpose.currentSubscription
        .stripeSubscriptionItemId,
    stripePriceId:
      subscription?.stripePriceId ?? "price_alakazam_35",
    stripeInvoiceId: start ? "in_alakazam_payment_1" : null,
    stripePaymentIntentId: "pi_alakazam_payment_1",
    targetTierId: selected.purpose.targetTierId,
    listSubtotalMinor: start ? 2500 : 1000,
    providerDiscountMinor: start ? 500 : 0,
    netSubtotalMinor: selected.purpose.dueNowSubtotalMinor,
    taxMinor: 0,
    totalMinor: selected.purpose.dueNowSubtotalMinor,
    taxMode: "disabled_by_owner",
    currency: "USD",
    paymentStatus: "paid",
    purposeDigest: selected.purposeDigest,
    providerPaymentTime: PAYMENT_AT,
    subscription
  };
  return {
    ...facts,
    providerFactsDigest: digest(facts)
  };
}

function stripeEvent(selected) {
  return {
    id: "evt_alakazam_payment_1",
    type: "checkout.session.completed",
    livemode: false,
    api_version: "2026-06-24.dahlia",
    created: Date.parse(PAYMENT_AT) / 1000,
    data: {
      object: {
        id: CHECKOUT_ID,
        metadata: createAlakazamProviderMetadata({
          purpose: selected.purpose,
          purposeDigest: selected.purposeDigest
        })
      }
    }
  };
}

function settledResult(selected, {
  subscriptionId =
    selected.purpose.changeKind === "start"
      ? NEW_SUBSCRIPTION_ID
      : LOCAL_SUBSCRIPTION_ID,
  receiptId = RECEIPT_ID
} = {}) {
  return {
    status: "payment_settled",
    provider: "stripe",
    changeKind: selected.purpose.changeKind,
    dispatchId: selected.dispatchId,
    projectId: selected.projectId,
    quoteId: selected.quoteId,
    subscriptionId,
    receiptId,
    paymentProviderFactsDigest:
      paymentFacts(selected).providerFactsDigest,
    next:
      selected.purpose.changeKind === "start"
        ? "subscription_confirmation"
        : "provider_change"
  };
}

function fixture({
  changeKind = "start",
  releaseApproved = true,
  resolvedStatus = "ready",
  payment = undefined,
  settleResult = undefined
} = {}) {
  const selected = reservation({ changeKind });
  const calls = {
    readiness: 0,
    finds: [],
    reads: [],
    settles: [],
    ids: []
  };
  const durableResult = settledResult(selected);
  const resolved = {
    status: resolvedStatus,
    provider: "stripe",
    reservation: selected,
    checkout: checkout(),
    ...(resolvedStatus === "settled"
      ? { settlement: durableResult }
      : {})
  };
  const idValues = {
    alakazam_payment_event: EVENT_ROW_ID,
    alakazam_payment_receipt: RECEIPT_ID,
    alakazam_subscription: NEW_SUBSCRIPTION_ID,
    alakazam_credit_application: CREDIT_APPLICATION_ID,
    alakazam_tier_event: TIER_EVENT_ID
  };
  const service = createAlakazamPaymentService({
    repository: {
      async findCheckoutDispatchBySession(input) {
        calls.finds.push(structuredClone(input));
        return structuredClone(resolved);
      },
      async settleCheckoutPayment(input) {
        calls.settles.push(structuredClone(input));
        return structuredClone(
          settleResult ?? durableResult
        );
      }
    },
    provider: {
      async readiness() {
        calls.readiness += 1;
        return {
          ready: true,
          provider: "stripe",
          alakazam: true,
          taxModes: { alakazam: "disabled_by_owner" },
          livemode: false
        };
      },
      async retrieveAlakazamPayment(input) {
        calls.reads.push(structuredClone(input));
        return structuredClone(
          payment ?? paymentFacts(selected)
        );
      }
    },
    clock: { now: () => VERIFIED_AT },
    ids: {
      next(label) {
        calls.ids.push(label);
        return idValues[label];
      }
    },
    release: createAlakazamBillingRelease({
      approved: releaseApproved,
      taxMode: releaseApproved
        ? "disabled_by_owner"
        : null
    })
  });
  return {
    service,
    calls,
    selected,
    event: stripeEvent(selected),
    durableResult
  };
}

test("Alakazam payment remains held before repository or provider work", async () => {
  const { service, calls, event } = fixture({
    releaseApproved: false
  });
  await assert.rejects(
    service.ingestStripeEvent(event),
    (error) =>
      error.code ===
      "alakazam_payment_reconciliation_unavailable"
  );
  assert.equal(calls.readiness, 0);
  assert.equal(calls.finds.length, 0);
  assert.equal(calls.reads.length, 0);
  assert.equal(calls.settles.length, 0);
});

test("Alakazam start payment binds exact event, provider readback, and durable IDs", async () => {
  const { service, calls, selected, event, durableResult } =
    fixture();
  assert.equal(isAlakazamCheckoutPaymentEvent(event), true);
  assert.deepEqual(
    await service.ingestStripeEvent(event),
    durableResult
  );
  assert.equal(calls.readiness, 1);
  assert.deepEqual(calls.finds, [
    { checkoutSessionId: CHECKOUT_ID }
  ]);
  assert.deepEqual(calls.reads, [
    {
      checkoutSessionId: CHECKOUT_ID,
      purpose: selected.purpose,
      purposeDigest: selected.purposeDigest
    }
  ]);
  assert.equal(calls.settles.length, 1);
  const [settlement] = calls.settles;
  assert.equal(settlement.eventRowId, EVENT_ROW_ID);
  assert.equal(settlement.receiptId, RECEIPT_ID);
  assert.equal(
    settlement.subscriptionId,
    NEW_SUBSCRIPTION_ID
  );
  assert.equal(
    settlement.creditApplicationId,
    CREDIT_APPLICATION_ID
  );
  assert.equal(settlement.tierEventId, null);
  assert.equal(settlement.event.stripeEventId, event.id);
  assert.equal(
    settlement.payment.providerDiscountMinor,
    500
  );
  assert.deepEqual(calls.ids, [
    "alakazam_payment_event",
    "alakazam_payment_receipt",
    "alakazam_subscription",
    "alakazam_credit_application"
  ]);
});

test("Alakazam upgrade payment keeps the current subscription and stages one tier event", async () => {
  const { service, calls, event, durableResult } = fixture({
    changeKind: "upgrade"
  });
  assert.deepEqual(
    await service.ingestStripeEvent(event),
    durableResult
  );
  const [settlement] = calls.settles;
  assert.equal(
    settlement.subscriptionId,
    LOCAL_SUBSCRIPTION_ID
  );
  assert.equal(settlement.creditApplicationId, null);
  assert.equal(settlement.tierEventId, TIER_EVENT_ID);
  assert.equal(settlement.payment.netSubtotalMinor, 1000);
  assert.deepEqual(calls.ids, [
    "alakazam_payment_event",
    "alakazam_payment_receipt",
    "alakazam_tier_event"
  ]);
});

test("a settled Alakazam payment event replays without provider readback or new IDs", async () => {
  const { service, calls, event, durableResult } = fixture({
    resolvedStatus: "settled"
  });
  assert.deepEqual(
    await service.ingestStripeEvent(event),
    durableResult
  );
  assert.equal(calls.reads.length, 0);
  assert.equal(calls.settles.length, 0);
  assert.equal(calls.ids.length, 0);
});

test("non-payment Stripe events do not touch Alakazam authority", async () => {
  const { service, calls, event } = fixture();
  event.type = "customer.subscription.created";
  assert.deepEqual(await service.ingestStripeEvent(event), {
    status: "not_alakazam_payment"
  });
  assert.equal(calls.readiness, 0);
  assert.equal(calls.finds.length, 0);
});

test("changed event metadata stops before Stripe payment readback", async () => {
  const { service, calls, event } = fixture();
  event.data.object.metadata = {
    ...event.data.object.metadata,
    target_tier_id: "alakazam_50"
  };
  await assert.rejects(
    service.ingestStripeEvent(event),
    (error) => error.code === "stripe_event_binding_invalid"
  );
  assert.equal(calls.reads.length, 0);
  assert.equal(calls.settles.length, 0);
  assert.equal(calls.ids.length, 0);
});

test("changed Stripe money grants no durable Alakazam payment state", async () => {
  const selected = reservation();
  const changed = paymentFacts(selected);
  changed.totalMinor = 1;
  const { service, calls, event } = fixture({
    payment: changed
  });
  await assert.rejects(
    service.ingestStripeEvent(event),
    (error) =>
      error.code ===
      "alakazam_payment_reconciliation_unavailable"
  );
  assert.equal(calls.settles.length, 0);
  assert.equal(calls.ids.length, 0);
});
