import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
  createAlakazamCheckoutDispatch,
  createAlakazamProviderMetadata
} from "../alakazam.mjs";
import {
  createAlakazamStartActivationService,
  isAlakazamStartActivationEvent
} from "../alakazam-activation.mjs";
import {
  createAlakazamBillingRelease
} from "../alakazam-billing.mjs";
import { digest } from "../canonical.mjs";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "10000000-0000-4000-8000-000000000002";
const PROJECT_ID = "10000000-0000-4000-8000-000000000003";
const QUOTE_ID = "10000000-0000-4000-8000-000000000004";
const DISPATCH_ID = "10000000-0000-4000-8000-000000000005";
const SUBSCRIPTION_ID =
  "10000000-0000-4000-8000-000000000006";
const RECEIPT_ID = "10000000-0000-4000-8000-000000000007";
const EVENT_ROW_ID = "20000000-0000-4000-8000-000000000001";
const TIER_EVENT_ID = "20000000-0000-4000-8000-000000000002";
const STRIPE_SUBSCRIPTION_ID = "sub_alakazam_activation_1";
const CLAIMED_AT = "2026-08-04T12:00:00.000Z";
const PAYMENT_AT = "2026-08-04T12:04:00.000Z";
const VERIFIED_AT = "2026-08-04T12:06:00.000Z";
const PERIOD_START = "2026-08-04T12:04:00.000Z";
const PERIOD_END = "2026-09-04T12:04:00.000Z";

function reservation() {
  return createAlakazamCheckoutDispatch({
    dispatchId: DISPATCH_ID,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    stripeCustomerId: "cus_alakazam_activation_1",
    acceptedDisclosureDigest: digest("accepted disclosure"),
    quoteDigest: digest("quote"),
    changeKind: "start",
    currentSubscription: null,
    targetTierId: "alakazam_25",
    dueNowSubtotalMinor: 2500,
    taxMode: "disabled_by_owner",
    downloadCredit: null,
    claimedAt: CLAIMED_AT
  });
}

function pending(selected) {
  return {
    subscriptionId: SUBSCRIPTION_ID,
    receiptId: RECEIPT_ID,
    revision: 1,
    stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
    stripeSubscriptionItemId: "si_alakazam_activation_1",
    stripePriceId: "price_alakazam_25",
    tierId: "alakazam_25",
    amountMinor: 2500,
    providerObservedAt: PAYMENT_AT,
    providerFactsDigest: digest("pending subscription facts"),
    paymentProviderFactsDigest: digest({
      purposeDigest: selected.purposeDigest,
      payment: "settled"
    })
  };
}

function subscriptionFacts(selected) {
  const facts = {
    schema: ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
    stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
    stripeSubscriptionItemId: "si_alakazam_activation_1",
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
    providerObservedAt: VERIFIED_AT,
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

function stripeEvent(selected) {
  return {
    id: "evt_alakazam_activation_1",
    type: "customer.subscription.created",
    livemode: false,
    api_version: "2026-06-24.dahlia",
    created: Date.parse(VERIFIED_AT) / 1000,
    data: {
      object: {
        id: STRIPE_SUBSCRIPTION_ID,
        metadata: structuredClone(
          createAlakazamProviderMetadata({
            purpose: selected.purpose,
            purposeDigest: selected.purposeDigest
          })
        )
      }
    }
  };
}

function activeResult(selected, facts = subscriptionFacts(selected)) {
  return {
    status: "active",
    provider: "stripe",
    changeKind: "start",
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    subscriptionId: SUBSCRIPTION_ID,
    receiptId: RECEIPT_ID,
    tierId: "alakazam_25",
    revision: 2,
    currentPeriodStartsAt: PERIOD_START,
    currentPeriodEndsAt: PERIOD_END,
    subscriptionProviderFactsDigest:
      facts.providerFactsDigest
  };
}

function fixture({
  releaseApproved = true,
  resolvedStatus = "pending",
  resolvedStripeSubscriptionId = STRIPE_SUBSCRIPTION_ID,
  providerFacts = undefined,
  activationResult = undefined
} = {}) {
  const selected = reservation();
  const facts = providerFacts ?? subscriptionFacts(selected);
  const result = activationResult ?? activeResult(selected, facts);
  const calls = {
    readiness: 0,
    finds: [],
    reads: [],
    activations: [],
    ids: []
  };
  const resolved = {
    status: resolvedStatus,
    provider: "stripe",
    reservation: selected,
    ...(resolvedStatus === "active"
      ? {
          activation: result,
          stripeSubscriptionId:
            resolvedStripeSubscriptionId
        }
      : { pending: pending(selected) })
  };
  const idValues = {
    alakazam_subscription_event: EVENT_ROW_ID,
    alakazam_tier_event: TIER_EVENT_ID
  };
  const service = createAlakazamStartActivationService({
    repository: {
      async findStartActivationBySubscription(input) {
        calls.finds.push(structuredClone(input));
        return structuredClone(resolved);
      },
      async activateStartSubscription(input) {
        calls.activations.push(structuredClone(input));
        return structuredClone(result);
      }
    },
    provider: {
      async readiness() {
        calls.readiness += 1;
        return {
          ready: true,
          provider: "stripe",
          alakazam: true,
          taxMode: "disabled_by_owner",
          livemode: false
        };
      },
      async retrieveAlakazamSubscription(input) {
        calls.reads.push(structuredClone(input));
        return structuredClone(facts);
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
    calls,
    event: stripeEvent(selected),
    facts,
    result,
    selected,
    service
  };
}

test("Alakazam start activation remains held before repository or provider work", async () => {
  const { calls, event, service } = fixture({
    releaseApproved: false
  });
  assert.deepEqual(await service.readiness(), {
    ready: false,
    activation: false,
    state: "held",
    code: "alakazam_billing_release_held"
  });
  await assert.rejects(
    service.ingestStripeEvent(event),
    (error) =>
      error.code ===
        "alakazam_activation_reconciliation_unavailable" &&
      error.status === 503
  );
  assert.deepEqual(calls, {
    readiness: 0,
    finds: [],
    reads: [],
    activations: [],
    ids: []
  });
});

test("Alakazam start activates only after exact Subscription readback", async () => {
  const { calls, event, facts, result, selected, service } =
    fixture();
  assert.equal(isAlakazamStartActivationEvent(event), true);
  assert.deepEqual(
    await service.ingestStripeEvent(event),
    result
  );
  assert.deepEqual(calls.finds, [
    { stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID }
  ]);
  assert.deepEqual(calls.reads, [
    {
      stripeCustomerId: selected.stripeCustomerId,
      stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID
    }
  ]);
  assert.deepEqual(calls.ids, [
    "alakazam_subscription_event",
    "alakazam_tier_event"
  ]);
  assert.equal(calls.activations.length, 1);
  assert.deepEqual(
    {
      subscriptionId:
        calls.activations[0].subscriptionId,
      receiptId: calls.activations[0].receiptId,
      eventRowId: calls.activations[0].eventRowId,
      tierEventId: calls.activations[0].tierEventId,
      providerFactsDigest:
        calls.activations[0].subscription
          .providerFactsDigest
    },
    {
      subscriptionId: SUBSCRIPTION_ID,
      receiptId: RECEIPT_ID,
      eventRowId: EVENT_ROW_ID,
      tierEventId: TIER_EVENT_ID,
      providerFactsDigest: facts.providerFactsDigest
    }
  );
});

test("an active Alakazam start replays without provider readback or new IDs", async () => {
  const { calls, event, result, service } = fixture({
    resolvedStatus: "active"
  });
  assert.deepEqual(
    await service.ingestStripeEvent(event),
    result
  );
  assert.equal(calls.readiness, 1);
  assert.equal(calls.finds.length, 1);
  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.activations, []);
  assert.deepEqual(calls.ids, []);
});

test("an active replay cannot cross its durable Stripe Subscription", async () => {
  const { calls, event, service } = fixture({
    resolvedStatus: "active",
    resolvedStripeSubscriptionId:
      "sub_alakazam_activation_other"
  });
  await assert.rejects(
    service.ingestStripeEvent(event),
    (error) =>
      error.code === "stripe_event_binding_invalid" &&
      error.status === 400
  );
  assert.equal(calls.finds.length, 1);
  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.activations, []);
  assert.deepEqual(calls.ids, []);
});

test("non-start Subscription events do not touch Alakazam activation authority", async () => {
  const { calls, event, service } = fixture();
  event.data.object.metadata.change_kind = "upgrade";
  assert.equal(isAlakazamStartActivationEvent(event), false);
  assert.deepEqual(await service.ingestStripeEvent(event), {
    status: "not_alakazam_start_activation"
  });
  assert.deepEqual(calls, {
    readiness: 0,
    finds: [],
    reads: [],
    activations: [],
    ids: []
  });
});

test("changed start metadata stops before Stripe Subscription readback", async () => {
  const { calls, event, service } = fixture();
  event.data.object.metadata.quote_id = QUOTE_ID.replace(
    /4$/u,
    "9"
  );
  await assert.rejects(
    service.ingestStripeEvent(event),
    (error) =>
      error.code === "stripe_event_binding_invalid" &&
      error.status === 400
  );
  assert.equal(calls.finds.length, 1);
  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.activations, []);
  assert.deepEqual(calls.ids, []);
});

test("changed Subscription evidence grants no Alakazam activation", async () => {
  const selected = reservation();
  const changed = subscriptionFacts(selected);
  changed.providerStatus = "past_due";
  const facts = structuredClone(changed);
  delete facts.providerFactsDigest;
  changed.providerFactsDigest = digest(facts);
  const { calls, event, service } = fixture({
    providerFacts: changed
  });
  await assert.rejects(
    service.ingestStripeEvent(event),
    (error) =>
      error.code ===
        "alakazam_activation_reconciliation_unavailable" &&
      error.status === 503
  );
  assert.equal(calls.reads.length, 1);
  assert.deepEqual(calls.activations, []);
  assert.deepEqual(calls.ids, []);
});

test("a Subscription event cannot cross the durable pending Stripe identity", async () => {
  const { calls, event, service } = fixture();
  event.data.object.id = "sub_alakazam_activation_other";
  await assert.rejects(
    service.ingestStripeEvent(event),
    (error) =>
      error.code === "stripe_event_binding_invalid" &&
      error.status === 400
  );
  assert.deepEqual(calls.finds, [
    {
      stripeSubscriptionId:
        "sub_alakazam_activation_other"
    }
  ]);
  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.activations, []);
  assert.deepEqual(calls.ids, []);
});
