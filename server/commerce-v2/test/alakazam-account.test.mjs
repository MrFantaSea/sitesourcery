import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_ACCOUNT_SCHEMA,
  createAlakazamSiteSetupDigest,
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
const VERSION_ID =
  "50000000-0000-4000-8000-000000000001";
const ADDRESS_ID =
  "60000000-0000-4000-8000-000000000001";
const ARTIFACT_DIGEST = "a".repeat(64);
const SITE_UPDATED_AT = "2026-08-02T12:04:00.000Z";
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

function siteSnapshot({
  state = null,
  tierId = null,
  revision = null,
  ...overrides
} = {}) {
  return {
    acceptedVersionId: VERSION_ID,
    artifactDigest: ARTIFACT_DIGEST,
    configuredLook: "clear",
    addressId: ADDRESS_ID,
    addressLabel: "cedar-workshop",
    hostname: "cedar-workshop.sitesourcery.me",
    fulfillmentState: state,
    fulfillmentTierId: tierId,
    fulfillmentSubscriptionRevision: revision,
    updatedAt: SITE_UPDATED_AT,
    ...overrides
  };
}

function siteForSubscription(subscription) {
  if (!subscription) return siteSnapshot();
  if (subscription.status === "pending") {
    return siteSnapshot({ state: "prepared" });
  }
  return siteSnapshot({
    state: "live",
    tierId: subscription.tierId,
    revision: subscription.revision
  });
}

function stored(overrides = {}) {
  const snapshot = {
    projectId: PROJECT_ID,
    downloadCreditAvailable: false,
    invoiceFinalization: null,
    subscription: null,
    pendingChange: null,
    receipts: [],
    ...overrides
  };
  snapshot.site = Object.hasOwn(overrides, "site")
    ? overrides.site
    : siteForSubscription(snapshot.subscription);
  return snapshot;
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
    amountMinor: 2000,
    currency: "USD"
  });
  assert.equal(result.subscription, null);
  assert.equal(result.nextRenewal, null);
  assert.deepEqual(result.site, {
    acceptedVersionId: VERSION_ID,
    addressLabel: "cedar-workshop",
    hostname: "cedar-workshop.sitesourcery.me",
    look: {
      lookId: "look_crystal",
      label: "Crystal"
    },
    setupDigest: createAlakazamSiteSetupDigest({
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      projectId: PROJECT_ID,
      acceptedVersionId: VERSION_ID,
      artifactDigest: ARTIFACT_DIGEST,
      configuredLook: "clear",
      addressId: ADDRESS_ID,
      addressLabel: "cedar-workshop",
      hostname: "cedar-workshop.sitesourcery.me"
    }),
    state: "ready_for_checkout",
    updatedAt: SITE_UPDATED_AT,
    url: null
  });
  assert.deepEqual(result.actions, {
    configureSite: true,
    start: true,
    changeTier: false,
    manageBilling: false,
    cancel: false,
    reason: "only_start_composed"
  });
  assert.deepEqual(context.calls, [scope()]);
});

test("site setup stays configurable but cannot start until both an accepted look and platform address exist", async () => {
  const cases = [
    siteSnapshot({
      acceptedVersionId: null,
      artifactDigest: null,
      configuredLook: null,
      addressId: null,
      addressLabel: null,
      hostname: null,
      updatedAt: null
    }),
    siteSnapshot({
      addressId: null,
      addressLabel: null,
      hostname: null
    })
  ];
  for (const site of cases) {
    const result = await service(stored({ site }))
      .account.read(scope());
    assert.equal(result.site.state, "setup_required");
    assert.equal(result.site.setupDigest, null);
    assert.equal(result.site.url, null);
    assert.deepEqual(result.actions, {
      configureSite: true,
      start: false,
      changeTier: false,
      manageBilling: false,
      cancel: false,
      reason: "site_setup_required"
    });
  }
});

test("the three internal Maker looks project only their stable public labels", async () => {
  for (const [configuredLook, look] of [
    ["clear", { lookId: "look_crystal", label: "Crystal" }],
    ["warm", { lookId: "look_hearth", label: "Hearth" }],
    ["arcane", { lookId: "look_midnight", label: "Midnight" }]
  ]) {
    const result = await service(
      stored({ site: siteSnapshot({ configuredLook }) })
    ).account.read(scope());
    assert.deepEqual(result.site.look, look);
  }
});

test("fulfillment states project payment, publication, live, and attention truth without inventing a live URL", async () => {
  for (const entry of [
    {
      internal: "prepared",
      customer: "payment_pending",
      reason: "site_payment_pending",
      subscription: null
    },
    {
      internal: "pending",
      customer: "publishing",
      reason: "site_publishing",
      subscription: activeSubscription()
    },
    {
      internal: "live",
      customer: "live",
      reason: "only_tier_change_composed",
      subscription: activeSubscription()
    },
    {
      internal: "dark",
      customer: "attention_required",
      reason: "site_attention_required",
      subscription: activeSubscription()
    },
    {
      internal: "failed",
      customer: "attention_required",
      reason: "site_attention_required",
      subscription: activeSubscription()
    }
  ]) {
    const site = entry.internal === "prepared"
      ? siteSnapshot({ state: entry.internal })
      : siteSnapshot({
          state: entry.internal,
          tierId: "alakazam_35",
          revision: 3
        });
    const result = await service(
      stored({ subscription: entry.subscription, site })
    ).account.read(scope());
    assert.equal(result.site.state, entry.customer);
    assert.equal(result.actions.reason, entry.reason);
    assert.equal(
      result.site.url,
      entry.internal === "live"
        ? "https://cedar-workshop.sitesourcery.me/"
        : null
    );
  }
});

test("a paid subscription with missing website projection fails closed as attention instead of looking checkout-ready", async () => {
  const subscription = activeSubscription();
  const result = await service(
    stored({
      subscription,
      site: siteSnapshot({
        acceptedVersionId: null,
        artifactDigest: null,
        configuredLook: null,
        addressId: null,
        addressLabel: null,
        hostname: null,
        state: "failed",
        tierId: subscription.tierId,
        revision: subscription.revision
      })
    })
  ).account.read(scope());
  assert.equal(result.site.state, "attention_required");
  assert.equal(result.site.setupDigest, null);
  assert.equal(result.site.url, null);
  assert.equal(result.actions.reason, "site_attention_required");
  assert.equal(result.actions.start, false);
  assert.equal(result.actions.changeTier, false);
});

test("an ambiguous pre-payment Checkout fails closed as attention without inventing paid fulfillment authority", async () => {
  const result = await service(
    stored({
      site: siteSnapshot({
        state: "failed",
        tierId: null,
        revision: null
      })
    })
  ).account.read(scope());
  assert.equal(result.state, "available");
  assert.equal(result.site.state, "attention_required");
  assert.equal(result.site.setupDigest.length, 64);
  assert.equal(result.site.url, null);
  assert.deepEqual(result.actions, {
    configureSite: false,
    start: false,
    changeTier: false,
    manageBilling: false,
    cancel: false,
    reason: "site_attention_required"
  });
});

test("account projection fails closed when durable site bindings drift", async () => {
  const malformed = [
    siteSnapshot({ artifactDigest: null }),
    siteSnapshot({ configuredLook: "unknown" }),
    siteSnapshot({
      hostname: "cedar-workshop.example.test"
    }),
    siteSnapshot({ state: "pending" }),
    siteSnapshot({
      state: "prepared",
      tierId: "alakazam_25",
      revision: 1
    }),
    siteSnapshot({ updatedAt: null })
  ];
  for (const site of malformed) {
    await assert.rejects(
      service(stored({ site })).account.read(scope()),
      (error) => [
        "invalid_input",
        "repository_conflict"
      ].includes(error.code)
    );
  }
});

test("every active paid tier exposes the composed tier-change action", async () => {
  for (const [tierId, amountMinor] of [
    ["alakazam_25", 2500],
    ["alakazam_35", 3500],
    ["alakazam_50", 5000]
  ]) {
    const context = service(
      stored({
        subscription: activeSubscription({
          tierId,
          amountMinor
        })
      })
    );
    const result = await context.account.read(scope());
    assert.deepEqual(result.actions, {
      configureSite: false,
      start: false,
      changeTier: true,
      manageBilling: false,
      cancel: false,
      reason: "only_tier_change_composed"
    });
  }
});

test("unsettled state, pending change, attention, and cancellation keep tier changes held", async () => {
  const cases = [
    {
      name: "activation pending",
      subscription: activeSubscription({
        tierId: "alakazam_25",
        amountMinor: 2500,
        status: "pending",
        currentPeriodStartsAt: null,
        currentPeriodEndsAt: null
      }),
      pendingChange: {
        changeKind: "start",
        targetTierId: "alakazam_25",
        effectiveAt: null,
        state: "activation_pending"
      }
    },
    {
      name: "pending tier change",
      subscription: activeSubscription({
        tierId: "alakazam_25",
        amountMinor: 2500
      }),
      pendingChange: {
        changeKind: "upgrade",
        targetTierId: "alakazam_35",
        effectiveAt: null,
        state: "payment_pending"
      }
    },
    {
      name: "grace attention",
      subscription: activeSubscription({
        tierId: "alakazam_25",
        amountMinor: 2500,
        status: "grace",
        firstFailedAt: "2026-08-05T12:00:00.000Z",
        graceEndsAt: "2026-08-19T12:00:00.000Z"
      }),
      pendingChange: null
    },
    {
      name: "suspended attention",
      subscription: activeSubscription({
        tierId: "alakazam_25",
        amountMinor: 2500,
        status: "suspended",
        firstFailedAt: "2026-08-05T12:00:00.000Z",
        graceEndsAt: "2026-08-19T12:00:00.000Z"
      }),
      pendingChange: null
    },
    {
      name: "cancelling at period end",
      subscription: activeSubscription({
        tierId: "alakazam_25",
        amountMinor: 2500,
        cancelAtPeriodEnd: true
      }),
      pendingChange: {
        changeKind: "cancellation",
        targetTierId: null,
        effectiveAt: PERIOD_END,
        state: "cancellation_scheduled"
      }
    },
    {
      name: "cancelled",
      subscription: activeSubscription({
        tierId: "alakazam_25",
        amountMinor: 2500,
        status: "cancelled"
      }),
      pendingChange: null
    },
    {
      name: "ended",
      subscription: activeSubscription({
        tierId: "alakazam_25",
        amountMinor: 2500,
        status: "ended"
      }),
      pendingChange: null
    }
  ];

  for (const entry of cases) {
    const context = service(
      stored({
        subscription: entry.subscription,
        pendingChange: entry.pendingChange
      })
    );
    const result = await context.account.read(scope());
    assert.deepEqual(
      result.actions,
      {
        configureSite: false,
        start: false,
        changeTier: false,
        manageBilling: false,
        cancel: false,
        reason:
          entry.name === "activation pending"
            ? "site_payment_pending"
            : "customer_commands_not_composed"
      },
      entry.name
    );
  }
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

test("an open invoice preparation hold is customer-safe and blocks renewal and tier change", async () => {
  const context = service(stored({
    subscription: activeSubscription(),
    invoiceFinalization: {
      state: "failed",
      attentionRequired: true,
      renewalHeld: true,
      fulfillmentHeld: true,
      messageCode: "alakazam_invoice_preparation_attention"
    }
  }));
  const result = await context.account.read(scope());
  assert.equal(result.state, "attention_required");
  assert.deepEqual(result.invoiceFinalization, {
    state: "failed",
    attentionRequired: true,
    renewalHeld: true,
    fulfillmentHeld: true,
    messageCode: "alakazam_invoice_preparation_attention"
  });
  assert.equal(result.nextRenewal.state, "attention_required");
  assert.equal(result.actions.changeTier, false);
  assert.doesNotMatch(
    JSON.stringify(result.invoiceFinalization),
    /stripe|invoiceId|digest|provider/iu
  );
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
