import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_ACCOUNT_SCHEMA,
  createAlakazamAccountService,
  createHeldHostedAlakazamAccount,
  createHostedAlakazamAccount
} from "../index.mjs";

const TENANT_ID =
  "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const RECEIPT_ID =
  "40000000-0000-4000-8000-000000000001";
const PERIOD_START = "2026-08-02T12:00:00.000Z";
const PERIOD_END = "2026-09-02T12:00:00.000Z";

function scope(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    actorId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    ...overrides
  };
}

function stored(overrides = {}) {
  return {
    projectId: PROJECT_ID,
    downloadCreditAvailable: false,
    subscription: null,
    pendingChange: null,
    receipts: [],
    ...overrides
  };
}

function activeSubscription(overrides = {}) {
  return {
    tierId: "alakazam_35",
    status: "active",
    amountMinor: 3500,
    currency: "USD",
    currentPeriodStartsAt: PERIOD_START,
    currentPeriodEndsAt: PERIOD_END,
    cancelAtPeriodEnd: false,
    firstFailedAt: null,
    graceEndsAt: null,
    revision: 3,
    ...overrides
  };
}

function service(snapshot) {
  const calls = [];
  return {
    calls,
    account: createAlakazamAccountService({
      repository: {
        async readCustomerAccount(input) {
          calls.push(structuredClone(input));
          return structuredClone(snapshot);
        }
      }
    })
  };
}

test("an account without Alakazam exposes only the held catalog and available Download credit", async () => {
  const context = service(
    stored({ downloadCreditAvailable: true })
  );
  const result = await context.account.read(scope());
  assert.equal(result.schema, ALAKAZAM_ACCOUNT_SCHEMA);
  assert.equal(result.projectId, PROJECT_ID);
  assert.equal(result.state, "available");
  assert.equal(result.catalog.state, "held");
  assert.deepEqual(
    result.catalog.tiers.map((tier) => [
      tier.tierId,
      tier.price.amountMinor
    ]),
    [
      ["alakazam_25", 2500],
      ["alakazam_35", 3500],
      ["alakazam_50", 5000]
    ]
  );
  assert.deepEqual(result.downloadCredit, {
    available: true,
    amountMinor: 500,
    currency: "USD"
  });
  assert.equal(result.subscription, null);
  assert.equal(result.nextRenewal, null);
  assert.deepEqual(result.actions, {
    start: true,
    changeTier: false,
    manageBilling: false,
    cancel: false,
    reason: "only_start_composed"
  });
  assert.deepEqual(context.calls, [scope()]);
});

test("an active account projects a scheduled lower renewal and bounded receipt without provider identity", async () => {
  const context = service(
    stored({
      downloadCreditAvailable: true,
      subscription: activeSubscription(),
      pendingChange: {
        changeKind: "downgrade",
        targetTierId: "alakazam_25",
        effectiveAt: PERIOD_END,
        state: "scheduled"
      },
      receipts: [
        {
          receiptId: RECEIPT_ID,
          kind: "upgrade_difference",
          subtotalMinor: 1000,
          discountMinor: 0,
          taxMinor: 0,
          totalMinor: 1000,
          settledAt: "2026-08-02T12:03:00.000Z",
          invoiceAvailable: true
        }
      ]
    })
  );
  const result = await context.account.read(scope());
  assert.equal(result.state, "active");
  assert.equal(result.subscription.tier.tierId, "alakazam_35");
  assert.equal(result.subscription.paymentState, "paid");
  assert.deepEqual(result.downloadCredit, {
    available: false,
    amountMinor: 0,
    currency: "USD"
  });
  assert.equal(
    result.subscription.tier.limits.versionHistory,
    3
  );
  assert.deepEqual(result.pendingChange, {
    changeKind: "downgrade",
    targetTier: result.catalog.tiers[0],
    effectiveAt: PERIOD_END,
    state: "scheduled"
  });
  assert.deepEqual(result.nextRenewal, {
    tierId: "alakazam_25",
    amountMinor: 2500,
    currency: "USD",
    dueAt: PERIOD_END,
    state: "scheduled"
  });
  assert.deepEqual(result.receipts, [
    {
      receiptId: RECEIPT_ID,
      kind: "upgrade_difference",
      subtotalMinor: 1000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 1000,
      currency: "USD",
      settledAt: "2026-08-02T12:03:00.000Z",
      invoiceAvailable: true
    }
  ]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /stripe_(?:customer|price|subscription)|cus_|price_|sub_/u
  );
  assert.equal(Object.isFrozen(result), true);
});

test("billing attention and cancellation suppress an invented renewal", async () => {
  const context = service(
    stored({
      subscription: activeSubscription({
        status: "grace",
        cancelAtPeriodEnd: true,
        firstFailedAt: "2026-08-05T12:00:00.000Z",
        graceEndsAt: "2026-08-19T12:00:00.000Z"
      }),
      pendingChange: {
        changeKind: "cancellation",
        targetTierId: null,
        effectiveAt: PERIOD_END,
        state: "cancellation_scheduled"
      }
    })
  );
  const result = await context.account.read(scope());
  assert.equal(result.state, "attention_required");
  assert.equal(
    result.subscription.paymentState,
    "attention_required"
  );
  assert.equal(result.pendingChange.targetTier, null);
  assert.equal(result.nextRenewal, null);
});

test("account projection rejects cross-customer scope and malformed durable money", async () => {
  const context = service(
    stored({ subscription: activeSubscription() })
  );
  await assert.rejects(
    context.account.read(
      scope({
        actorId:
          "20000000-0000-4000-8000-000000000002"
      })
    ),
    (error) => error.code === "project_unavailable"
  );
  const changed = service(
    stored({
      subscription: activeSubscription({
        amountMinor: 3499
      })
    })
  );
  await assert.rejects(
    changed.account.read(scope()),
    (error) => error.code === "repository_conflict"
  );
});

test("the hosted account boundary resolves one authenticated project scope", async () => {
  const context = service(stored());
  const calls = [];
  const hosted = createHostedAlakazamAccount({
    account: context.account,
    async resolveSession(input) {
      calls.push(structuredClone(input));
      return scope();
    }
  });
  const result = await hosted.getSnapshot(
    { userId: CUSTOMER_ID },
    PROJECT_ID
  );
  assert.equal(result.projectId, PROJECT_ID);
  assert.deepEqual(calls, [
    {
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID
    }
  ]);
  await assert.rejects(
    hosted.getSnapshot(null, PROJECT_ID),
    (error) =>
      error.code === "AUTHENTICATION_REQUIRED" &&
      error.status === 401
  );
  const wrongProject = createHostedAlakazamAccount({
    account: context.account,
    async resolveSession() {
      return scope({
        projectId:
          "30000000-0000-4000-8000-000000000002"
      });
    }
  });
  await assert.rejects(
    wrongProject.getSnapshot(
      { userId: CUSTOMER_ID },
      PROJECT_ID
    ),
    (error) =>
      error.code === "ALAKAZAM_PROJECT_UNAVAILABLE" &&
      error.status === 404
  );
  await assert.rejects(
    createHeldHostedAlakazamAccount().getSnapshot(
      { userId: CUSTOMER_ID },
      PROJECT_ID
    ),
    (error) =>
      error.code === "ALAKAZAM_ACCOUNT_HELD" &&
      error.status === 503
  );
});
