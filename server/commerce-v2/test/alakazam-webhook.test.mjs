import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_PROVIDER_METADATA_SCHEMA,
  createAlakazamStripeEventRouter,
  isPotentialAlakazamStripeEvent
} from "../index.mjs";

function selectedEvent(
  type,
  changeKind,
  schema = ALAKAZAM_PROVIDER_METADATA_SCHEMA
) {
  return {
    id: "evt_alakazam_router_1",
    type,
    livemode: false,
    api_version: "2026-07-29.preview",
    created: 1785672300,
    data: {
      object: {
        id:
          type === "checkout.session.completed"
            ? "cs_test_alakazam_router_1"
            : "sub_alakazam_router_1",
        metadata: {
          schema,
          change_kind: changeKind
        }
      }
    }
  };
}

function paymentSettlement(changeKind) {
  return {
    status: "payment_settled",
    provider: "stripe",
    changeKind,
    dispatchId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    quoteId: "33333333-3333-4333-8333-333333333333",
    subscriptionId: "44444444-4444-4444-8444-444444444444",
    receiptId: "55555555-5555-4555-8555-555555555555",
    paymentProviderFactsDigest: "a".repeat(64),
    next:
      changeKind === "upgrade"
        ? "provider_change"
        : "subscription_confirmation"
  };
}

function fixture({
  paymentResult = paymentSettlement("start"),
  upgradeApplicationResult = {
    status: "provider_confirmed"
  }
} = {}) {
  const calls = {
    payment: [],
    start: [],
    upgrade: [],
    upgradeApplication: [],
    downgrade: []
  };
  function service(name, status) {
    return {
      async ingestStripeEvent(event) {
        calls[name].push(structuredClone(event));
        return { status };
      }
    };
  }
  return {
    calls,
    router: createAlakazamStripeEventRouter({
      payment: {
        async ingestStripeEvent(event) {
          calls.payment.push(structuredClone(event));
          return structuredClone(paymentResult);
        }
      },
      startActivation: service("start", "start"),
      upgradeActivation: service(
        "upgrade",
        "upgrade"
      ),
      upgradeApplication: {
        async applyPaidUpgrade(settlement) {
          calls.upgradeApplication.push(
            structuredClone(settlement)
          );
          return structuredClone(
            upgradeApplicationResult
          );
        }
      },
      downgradeActivation: service(
        "downgrade",
        "downgrade"
      )
    })
  };
}

function callCounts(calls) {
  return Object.fromEntries(
    Object.entries(calls).map(([name, values]) => [
      name,
      values.length
    ])
  );
}

test("Alakazam Checkout payment routes to one exact handler", async () => {
  const context = fixture();
  const event = selectedEvent(
    "checkout.session.completed",
    "start"
  );
  assert.equal(isPotentialAlakazamStripeEvent(event), true);
  assert.deepEqual(
    await context.router.ingestStripeEvent(event),
    paymentSettlement("start")
  );
  assert.deepEqual(callCounts(context.calls), {
    payment: 1,
    start: 0,
    upgrade: 0,
    upgradeApplication: 0,
    downgrade: 0
  });
});

test("a paid Alakazam upgrade is handed directly to durable provider application", async () => {
  const settlement = paymentSettlement("upgrade");
  const context = fixture({
    paymentResult: settlement,
    upgradeApplicationResult: {
      status: "provider_confirmed",
      next: "subscription_event"
    }
  });
  assert.deepEqual(
    await context.router.ingestStripeEvent(
      selectedEvent(
        "checkout.session.completed",
        "upgrade"
      )
    ),
    {
      status: "provider_confirmed",
      next: "subscription_event"
    }
  );
  assert.deepEqual(context.calls.upgradeApplication, [
    settlement
  ]);
  assert.deepEqual(callCounts(context.calls), {
    payment: 1,
    start: 0,
    upgrade: 0,
    upgradeApplication: 1,
    downgrade: 0
  });
});

test("an impossible Checkout change kind stops before payment settlement", async () => {
  const context = fixture();
  await assert.rejects(
    context.router.ingestStripeEvent(
      selectedEvent(
        "checkout.session.completed",
        "downgrade"
      )
    ),
    (error) =>
      error.code === "stripe_event_invalid" &&
      error.status === 400
  );
  assert.deepEqual(callCounts(context.calls), {
    payment: 0,
    start: 0,
    upgrade: 0,
    upgradeApplication: 0,
    downgrade: 0
  });
});

test("Alakazam Subscription events route only by exact change kind", async () => {
  for (const [type, changeKind, expected] of [
    ["customer.subscription.created", "start", "start"],
    ["customer.subscription.updated", "start", "start"],
    [
      "customer.subscription.updated",
      "upgrade",
      "upgrade"
    ],
    [
      "customer.subscription.updated",
      "downgrade",
      "downgrade"
    ]
  ]) {
    const context = fixture();
    assert.deepEqual(
      await context.router.ingestStripeEvent(
        selectedEvent(type, changeKind)
      ),
      { status: expected }
    );
    assert.deepEqual(callCounts(context.calls), {
      payment: 0,
      start: expected === "start" ? 1 : 0,
      upgrade: expected === "upgrade" ? 1 : 0,
      upgradeApplication: 0,
      downgrade: expected === "downgrade" ? 1 : 0
    });
  }
});

test("unrelated Stripe events perform no Alakazam work", async () => {
  const context = fixture();
  const unrelated = selectedEvent(
    "invoice.paid",
    "start",
    "another_schema"
  );
  assert.equal(
    isPotentialAlakazamStripeEvent(unrelated),
    false
  );
  assert.deepEqual(
    await context.router.ingestStripeEvent(unrelated),
    { status: "not_alakazam" }
  );
  assert.deepEqual(callCounts(context.calls), {
    payment: 0,
    start: 0,
    upgrade: 0,
    upgradeApplication: 0,
    downgrade: 0
  });
});

test("an Alakazam marker with an impossible event transition fails closed", async () => {
  for (const event of [
    selectedEvent(
      "customer.subscription.updated",
      "invented"
    ),
    selectedEvent(
      "customer.subscription.created",
      "downgrade"
    )
  ]) {
    const context = fixture();
    await assert.rejects(
      context.router.ingestStripeEvent(event),
      (error) =>
        error.code === "stripe_event_invalid" &&
        error.status === 400
    );
    assert.deepEqual(callCounts(context.calls), {
      payment: 0,
      start: 0,
      upgrade: 0,
      upgradeApplication: 0,
      downgrade: 0
    });
  }
});
