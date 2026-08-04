import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_SCHEDULE_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
  createAlakazamDowngradeApplication,
  createAlakazamProviderMetadata
} from "../alakazam.mjs";
import {
  createAlakazamBillingRelease
} from "../alakazam-billing.mjs";
import {
  createAlakazamDowngradeActivationService
} from "../alakazam-downgrade-activation.mjs";
import { digest } from "../canonical.mjs";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "10000000-0000-4000-8000-000000000002";
const PROJECT_ID = "10000000-0000-4000-8000-000000000003";
const QUOTE_ID = "10000000-0000-4000-8000-000000000004";
const SUBSCRIPTION_ID =
  "10000000-0000-4000-8000-000000000005";
const APPLICATION_ID =
  "20000000-0000-4000-8000-000000000001";
const EVENT_ROW_ID =
  "20000000-0000-4000-8000-000000000002";
const TIER_EVENT_ID =
  "20000000-0000-4000-8000-000000000003";
const PERIOD_START = "2026-08-02T12:03:00.000Z";
const EFFECTIVE_AT = "2026-09-02T12:03:00.000Z";
const TARGET_PERIOD_END = "2026-10-02T12:03:00.000Z";
const VERIFIED_AT = "2026-09-02T12:03:05.000Z";
const OBSERVED_AT = "2026-09-02T12:03:06.000Z";
const STRIPE_SUBSCRIPTION_ID =
  "sub_alakazam_downgrade_1";
const STRIPE_SCHEDULE_ID = "sub_sched_alakazam_35_25";

function application() {
  return createAlakazamDowngradeApplication({
    scheduleId: APPLICATION_ID,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    stripeCustomerId: "cus_alakazam_downgrade_1",
    acceptedDisclosureDigest: digest("accepted downgrade disclosure"),
    quoteDigest: digest("downgrade quote"),
    currentSubscription: {
      localSubscriptionId: SUBSCRIPTION_ID,
      revision: 3,
      tierId: "alakazam_35",
      amountMinor: 3500,
      stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
      stripeSubscriptionItemId: "si_alakazam_downgrade_1",
      stripePriceId: "price_alakazam_35",
      currentPeriodStartsAt: PERIOD_START,
      currentPeriodEndsAt: EFFECTIVE_AT,
      providerFactsDigest: digest("active 35 provider facts")
    },
    targetTierId: "alakazam_25",
    taxMode: "disabled_by_owner",
    claimedAt: "2026-08-02T12:21:00.000Z"
  });
}

function scheduleFacts(selected = application()) {
  const facts = {
    schema: ALAKAZAM_SCHEDULE_PROVIDER_FACTS_SCHEMA,
    stripeScheduleId: STRIPE_SCHEDULE_ID,
    stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
    stripeCustomerId: selected.stripeCustomerId,
    currentTierId: "alakazam_35",
    targetTierId: "alakazam_25",
    currentPriceId: "price_alakazam_35",
    targetPriceId: "price_alakazam_25",
    effectiveAt: EFFECTIVE_AT,
    endBehavior: "release",
    providerProration: false,
    providerObservedAt: "2026-08-02T12:21:02.000Z"
  };
  return {
    ...facts,
    providerFactsDigest: digest(facts)
  };
}

function confirmation(
  selected = application(),
  schedule = scheduleFacts(selected)
) {
  return {
    status: "scheduled",
    provider: "stripe",
    scheduleId: selected.scheduleId,
    stripeScheduleId: schedule.stripeScheduleId,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    subscriptionId: SUBSCRIPTION_ID,
    priorTierId: "alakazam_35",
    targetTierId: "alakazam_25",
    currentRevision: 3,
    effectiveAt: EFFECTIVE_AT,
    providerFactsDigest: schedule.providerFactsDigest,
    reconciliation: "readback_after_ambiguity",
    next: "boundary_confirmation"
  };
}

function subscriptionFacts(
  selected = application(),
  schedule = scheduleFacts(selected),
  overrides = {}
) {
  const facts = {
    schema: ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
    stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
    stripeSubscriptionItemId: "si_alakazam_downgrade_1",
    stripeCustomerId: selected.stripeCustomerId,
    stripePriceId: schedule.targetPriceId,
    stripeScheduleId: STRIPE_SCHEDULE_ID,
    tierId: "alakazam_25",
    amountMinor: 2500,
    currency: "USD",
    providerStatus: "active",
    cancelAtPeriodEnd: false,
    currentPeriodStartsAt: EFFECTIVE_AT,
    currentPeriodEndsAt: TARGET_PERIOD_END,
    billingCycleAnchor: PERIOD_START,
    providerObservedAt: OBSERVED_AT,
    metadata: createAlakazamProviderMetadata({
      purpose: selected.purpose,
      purposeDigest: selected.purposeDigest
    }),
    ...overrides
  };
  return {
    ...facts,
    providerFactsDigest: digest(facts)
  };
}

function activation(
  selected = application(),
  schedule = scheduleFacts(selected),
  subscription = subscriptionFacts(selected, schedule)
) {
  return {
    status: "active",
    provider: "stripe",
    changeKind: "downgrade",
    scheduleId: selected.scheduleId,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    subscriptionId: SUBSCRIPTION_ID,
    priorTierId: "alakazam_35",
    targetTierId: "alakazam_25",
    revision: 4,
    currentPeriodStartsAt: EFFECTIVE_AT,
    currentPeriodEndsAt: TARGET_PERIOD_END,
    scheduleProviderFactsDigest:
      schedule.providerFactsDigest,
    subscriptionProviderFactsDigest:
      subscription.providerFactsDigest,
    next: "complete"
  };
}

function resolved(
  status,
  selected = application(),
  schedule = scheduleFacts(selected),
  subscription = subscriptionFacts(selected, schedule)
) {
  return {
    status,
    provider: "stripe",
    application: selected,
    schedule,
    confirmation: confirmation(selected, schedule),
    stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
    ...(status === "applied"
      ? {
          activation: activation(
            selected,
            schedule,
            subscription
          )
        }
      : {})
  };
}

function downgradeEvent(selected = application(), overrides = {}) {
  return {
    id: "evt_alakazam_downgrade_activation_1",
    type: "customer.subscription.updated",
    livemode: false,
    api_version: "2026-07-29.preview",
    created: Date.parse(EFFECTIVE_AT) / 1000,
    data: {
      object: {
        id: STRIPE_SUBSCRIPTION_ID,
        metadata: {
          ...createAlakazamProviderMetadata({
            purpose: selected.purpose,
            purposeDigest: selected.purposeDigest
          }),
          ...overrides
        }
      }
    }
  };
}

function fixture({
  releaseApproved = true,
  existingStatus = "scheduled",
  readFacts = subscriptionFacts(),
  readError = null
} = {}) {
  const selected = application();
  const schedule = scheduleFacts(selected);
  const calls = {
    readiness: 0,
    finds: [],
    reads: [],
    activations: [],
    ids: []
  };
  const service = createAlakazamDowngradeActivationService({
    repository: {
      async findDowngradeActivationBySubscription(input) {
        calls.finds.push(structuredClone(input));
        return structuredClone(
          resolved(
            existingStatus,
            selected,
            schedule,
            readFacts
          )
        );
      },
      async activateDowngradeSubscription(input) {
        calls.activations.push(structuredClone(input));
        return activation(
          selected,
          schedule,
          input.subscription
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
          taxMode: "disabled_by_owner",
          livemode: false
        };
      },
      async retrieveAlakazamSubscription(input) {
        calls.reads.push(structuredClone(input));
        if (readError) throw readError;
        return structuredClone(readFacts);
      }
    },
    clock: { now: () => VERIFIED_AT },
    ids: {
      next(label) {
        calls.ids.push(label);
        return {
          alakazam_downgrade_subscription_event:
            EVENT_ROW_ID,
          alakazam_downgrade_activation_tier_event:
            TIER_EVENT_ID
        }[label];
      }
    },
    release: createAlakazamBillingRelease({
      approved: releaseApproved,
      taxMode: releaseApproved
        ? "disabled_by_owner"
        : null
    })
  });
  return { calls, selected, service };
}

test("Alakazam downgrade activation remains held before repository or provider work", async () => {
  const { calls, selected, service } = fixture({
    releaseApproved: false
  });
  await assert.rejects(
    service.ingestStripeEvent(downgradeEvent(selected)),
    (error) =>
      error.code ===
        "alakazam_downgrade_activation_reconciliation_unavailable" &&
      error.status === 503
  );
  assert.equal(calls.readiness, 0);
  assert.deepEqual(calls.finds, []);
  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.ids, []);
});

test("a verified boundary event performs one read-only check and one local activation", async () => {
  const { calls, selected, service } = fixture();
  const result = await service.ingestStripeEvent(
    downgradeEvent(selected)
  );
  assert.equal(result.status, "active");
  assert.equal(result.revision, 4);
  assert.equal(calls.reads.length, 1);
  assert.equal(calls.activations.length, 1);
  assert.deepEqual(calls.ids, [
    "alakazam_downgrade_subscription_event",
    "alakazam_downgrade_activation_tier_event"
  ]);
});

test("an applied downgrade event replay performs no provider work and allocates no ID", async () => {
  const { calls, selected, service } = fixture({
    existingStatus: "applied"
  });
  const result = await service.ingestStripeEvent(
    downgradeEvent(selected)
  );
  assert.equal(result.status, "active");
  assert.equal(calls.reads.length, 0);
  assert.equal(calls.activations.length, 0);
  assert.deepEqual(calls.ids, []);
});

test("an unrelated Stripe event performs no downgrade activation work", async () => {
  const { calls, service } = fixture();
  assert.deepEqual(
    await service.ingestStripeEvent({
      type: "invoice.paid"
    }),
    { status: "not_alakazam_downgrade_activation" }
  );
  assert.equal(calls.readiness, 0);
  assert.deepEqual(calls.finds, []);
  assert.deepEqual(calls.reads, []);
});

test("changed downgrade event metadata stops before Stripe readback", async () => {
  const { calls, selected, service } = fixture();
  await assert.rejects(
    service.ingestStripeEvent(
      downgradeEvent(selected, {
        target_tier_id: "alakazam_50"
      })
    ),
    (error) =>
      error.code === "stripe_event_binding_invalid" &&
      error.status === 400
  );
  assert.equal(calls.finds.length, 1);
  assert.equal(calls.reads.length, 0);
  assert.deepEqual(calls.ids, []);
});

test("changed lower-tier provider readback grants no activation", async () => {
  const changed = subscriptionFacts(
    application(),
    scheduleFacts(),
    {
      tierId: "alakazam_50",
      amountMinor: 5000,
      stripePriceId: "price_alakazam_50"
    }
  );
  const { calls, selected, service } = fixture({
    readFacts: changed
  });
  await assert.rejects(
    service.ingestStripeEvent(downgradeEvent(selected)),
    (error) =>
      error.code ===
        "alakazam_downgrade_activation_reconciliation_unavailable" &&
      error.status === 503
  );
  assert.equal(calls.reads.length, 1);
  assert.equal(calls.activations.length, 0);
  assert.deepEqual(calls.ids, []);
});

test("a live-mode downgrade event cannot cross test-mode authority", async () => {
  const { calls, selected, service } = fixture();
  const event = downgradeEvent(selected);
  event.livemode = true;
  await assert.rejects(
    service.ingestStripeEvent(event),
    (error) =>
      error.code === "stripe_event_invalid" &&
      error.status === 400
  );
  assert.deepEqual(calls.finds, []);
  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.ids, []);
});
