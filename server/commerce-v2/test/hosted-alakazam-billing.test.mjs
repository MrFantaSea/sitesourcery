import assert from "node:assert/strict";
import test from "node:test";

import { CommerceV2Error } from "../canonical.mjs";
import {
  createHeldHostedAlakazamBilling,
  createHostedAlakazamBilling
} from "../hosted-alakazam-billing.mjs";
import { HostedError } from "../../hosted/errors.mjs";

const TENANT_ID =
  "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const OTHER_CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000002";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID =
  "30000000-0000-4000-8000-000000000002";
const QUOTE_ID =
  "40000000-0000-4000-8000-000000000001";
const COMMAND_ID =
  "50000000-0000-4000-8000-000000000001";
const DOWNGRADE_COMMAND_ID =
  "60000000-0000-4000-8000-000000000001";
const SCHEDULE_ID =
  "70000000-0000-4000-8000-000000000001";
const SUBSCRIPTION_ID =
  "80000000-0000-4000-8000-000000000001";
const DISCLOSURE_DIGEST = "d".repeat(64);
const SITE_SETUP_DIGEST = "c".repeat(64);
const QUOTE_DIGEST = "e".repeat(64);
const PURPOSE_DIGEST = "p".repeat(64);
const PROVIDER_FACTS_DIGEST = "f".repeat(64);
const ISSUED_AT = "2026-08-04T18:00:00.000Z";
const EXPIRES_AT = "2026-08-04T18:30:00.000Z";
const EFFECTIVE_AT = "2026-09-04T18:00:00.000Z";

const ACTOR = Object.freeze({ userId: CUSTOMER_ID });

function scope(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    actorId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    ...overrides
  };
}

function appliedValue() {
  return {
    kind: "download_purchase",
    sourceId: "download-entitlement-private-1",
    amountMinor: 500
  };
}

function dueNow() {
  return {
    subtotalMinor: 2000,
    currency: "USD",
    taxMinor: 0,
    totalMinor: 2000,
    taxState: "disabled_by_owner"
  };
}

function renewal() {
  return {
    tierId: "alakazam_25",
    amountMinor: 2500,
    currency: "USD",
    interval: "month"
  };
}

function quoteResult(overrides = {}) {
  return {
    schema:
      "sitesourcery.alakazam-tier-change-quote.v1",
    quoteId: QUOTE_ID,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    catalogVersion: "alakazam.2026-08-02.v1",
    termsVersion:
      "alakazam-owner-contract.2026-08-02.v1",
    state: "quoted",
    providerEffectsAuthorized: true,
    changeKind: "start",
    currentSubscriptionBinding: {
      subscriptionId: "sub_private_1",
      tierId: "alakazam_25",
      revision: 1
    },
    targetTier: {
      tierId: "alakazam_25",
      rank: 1,
      name: "Alakazam 25",
      price: {
        amountMinor: 2500,
        currency: "USD",
        billing: "recurring",
        interval: "month",
        stripePriceId: "price_private_nested"
      },
      capabilities: ["host_at_sitesourcery_me"],
      limits: {
        careClass: "none",
        versionHistory: 0,
        fontControls: "base",
        borderControls: "base",
        providerProductId: "prod_private_nested"
      },
      providerPriceId: "price_private_tier"
    },
    dueNow: dueNow(),
    appliedValue: appliedValue(),
    effectiveAt:
      "after_payment_and_provider_confirmation",
    nextRenewal: renewal(),
    noMidPeriodRefundOrProration: false,
    premiumConfiguration: "preserved_when_inactive",
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    disclosure: {
      schema:
        "sitesourcery.alakazam-tier-change-disclosure.v1",
      changeKind: "start",
      currentTierId: null,
      targetTierId: "alakazam_25",
      dueNow: dueNow(),
      appliedValue: appliedValue(),
      effectiveAt:
        "after_payment_and_provider_confirmation",
      renewal: renewal(),
      downgrade: {
        cashRefundMinor: 0,
        providerProration: false,
        currentTierKeptThroughPeriod: false
      },
      premiumConfiguration:
        "preserved_when_inactive",
      cancellationPolicy:
        "owner_review_required_before_release",
      providerEvidence: "private_nested_evidence"
    },
    disclosureDigest: DISCLOSURE_DIGEST,
    quoteDigest: QUOTE_DIGEST,
    providerFacts: {
      customerId: "cus_private_1",
      priceId: "price_private_1"
    },
    ...overrides
  };
}

function checkoutResult(overrides = {}) {
  return {
    status: "ready",
    provider: "stripe",
    dispatchId: COMMAND_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    purposeDigest: PURPOSE_DIGEST,
    checkout: {
      checkoutId: "cs_private_checkout_1",
      url:
        "https://checkout.stripe.com/c/pay/customer-safe",
      expiresAt: EXPIRES_AT,
      customerId: "cus_private_1"
    },
    internalPurpose: {
      organizationId: TENANT_ID
    },
    ...overrides
  };
}

function downgradeResult(overrides = {}) {
  return {
    status: "scheduled",
    provider: "stripe",
    scheduleId: SCHEDULE_ID,
    stripeScheduleId: "sub_sched_private_1",
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    subscriptionId: SUBSCRIPTION_ID,
    priorTierId: "alakazam_50",
    targetTierId: "alakazam_25",
    currentRevision: 4,
    effectiveAt: EFFECTIVE_AT,
    providerFactsDigest: PROVIDER_FACTS_DIGEST,
    reconciliation: "confirmed",
    next: "boundary_confirmation",
    ...overrides
  };
}

function context({
  resolvedScope = scope(),
  quote = quoteResult(),
  checkout = checkoutResult(),
  downgrade = downgradeResult(),
  readiness = {
    ready: true,
    quote: true,
    checkout: true,
    customerProvisioning: true,
    payment: false,
    state: "quote_ready",
    provider: "stripe",
    livemode: true,
    taxMode: "disabled_by_owner"
  },
  downgradeReadiness = {
    ready: true,
    downgrade: true,
    state: "downgrade_schedule_ready",
    provider: "stripe",
    livemode: true,
    taxMode: "disabled_by_owner"
  }
} = {}) {
  const calls = {
    resolve: [],
    readiness: 0,
    downgradeReadiness: 0,
    quotes: [],
    checkouts: [],
    downgrades: []
  };
  const hosted = createHostedAlakazamBilling({
    billing: {
      async readiness() {
        calls.readiness += 1;
        return structuredClone(readiness);
      },
      async createQuote(input) {
        calls.quotes.push(structuredClone(input));
        return structuredClone(quote);
      },
      async createCheckout(input) {
        calls.checkouts.push(structuredClone(input));
        return structuredClone(checkout);
      }
    },
    downgrade: {
      async readiness() {
        calls.downgradeReadiness += 1;
        return structuredClone(downgradeReadiness);
      },
      async scheduleDowngrade(input) {
        calls.downgrades.push(structuredClone(input));
        return structuredClone(downgrade);
      }
    },
    async resolveSession(input) {
      calls.resolve.push(structuredClone(input));
      return structuredClone(resolvedScope);
    }
  });
  return { calls, hosted };
}

test("held Alakazam billing authenticates first and remains effect-free", async () => {
  const held = createHeldHostedAlakazamBilling();
  assert.deepEqual(await held.readiness(), {
    ready: false,
    quote: false,
    checkout: false,
    downgrade: false,
    state: "held"
  });
  for (const invoke of [
    () => held.createQuote(ACTOR, PROJECT_ID, {}),
    () =>
      held.createCheckout(
        ACTOR,
        PROJECT_ID,
        QUOTE_ID,
        {}
      ),
    () =>
      held.scheduleDowngrade(
        ACTOR,
        PROJECT_ID,
        QUOTE_ID,
        {}
      )
  ]) {
    await assert.rejects(
      async () => invoke(),
      (error) =>
        error.code === "ALAKAZAM_BILLING_HELD" &&
        error.status === 503
    );
  }
  await assert.rejects(
    async () =>
      held.createQuote(null, PROJECT_ID, {}),
    (error) =>
      error.code === "AUTHENTICATION_REQUIRED" &&
      error.status === 401
  );
});

test("hosted quote maps idempotency identity and returns only customer-safe truth", async () => {
  const { calls, hosted } = context();
  const result = await hosted.createQuote(
    ACTOR,
    PROJECT_ID,
    {
      commandId: QUOTE_ID,
      targetTierId: "alakazam_25"
    }
  );
  assert.deepEqual(calls.resolve, [
    { actor: ACTOR, projectId: PROJECT_ID }
  ]);
  assert.deepEqual(calls.quotes, [
    {
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      projectId: PROJECT_ID,
      quoteId: QUOTE_ID,
      targetTierId: "alakazam_25"
    }
  ]);
  assert.equal(result.quoteId, QUOTE_ID);
  assert.equal(result.projectId, PROJECT_ID);
  assert.deepEqual(result.appliedValue, {
    kind: "download_purchase",
    amountMinor: 500
  });
  assert.deepEqual(result.disclosure.appliedValue, {
    kind: "download_purchase",
    amountMinor: 500
  });
  assert.equal(result.disclosureDigest, DISCLOSURE_DIGEST);
  assert.equal(result.quoteDigest, QUOTE_DIGEST);
  assert.deepEqual(Object.keys(result).sort(), [
    "appliedValue",
    "catalogVersion",
    "changeKind",
    "disclosure",
    "disclosureDigest",
    "dueNow",
    "effectiveAt",
    "expiresAt",
    "issuedAt",
    "nextRenewal",
    "noMidPeriodRefundOrProration",
    "premiumConfiguration",
    "projectId",
    "quoteDigest",
    "quoteId",
    "schema",
    "state",
    "targetTier",
    "termsVersion"
  ]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /sourceId|tenantId|customerId|providerEffectsAuthorized|currentSubscriptionBinding|providerFacts|providerEvidence|stripePriceId|providerProductId|sub_private|cus_private|price_private/u
  );
  assert.equal(Object.isFrozen(result), true);
});

test("hosted Checkout maps one exact replay identity without provider leakage", async () => {
  const { calls, hosted } = context();
  const input = {
    acceptedDisclosureDigest: DISCLOSURE_DIGEST,
    commandId: COMMAND_ID,
    siteSetupDigest: SITE_SETUP_DIGEST
  };
  const first = await hosted.createCheckout(
    ACTOR,
    PROJECT_ID,
    QUOTE_ID,
    input
  );
  const replay = await hosted.createCheckout(
    ACTOR,
    PROJECT_ID,
    QUOTE_ID,
    input
  );
  assert.deepEqual(first, {
    schema:
      "sitesourcery.alakazam-checkout-ready/v1",
    commandId: COMMAND_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    state: "ready",
    purposeDigest: PURPOSE_DIGEST,
    checkoutUrl:
      "https://checkout.stripe.com/c/pay/customer-safe",
    expiresAt: EXPIRES_AT
  });
  assert.deepEqual(replay, first);
  assert.deepEqual(calls.checkouts, [
    {
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      projectId: PROJECT_ID,
      quoteId: QUOTE_ID,
      commandId: COMMAND_ID,
      acceptedDisclosureDigest: DISCLOSURE_DIGEST,
      siteSetupDigest: SITE_SETUP_DIGEST
    },
    {
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      projectId: PROJECT_ID,
      quoteId: QUOTE_ID,
      commandId: COMMAND_ID,
      acceptedDisclosureDigest: DISCLOSURE_DIGEST,
      siteSetupDigest: SITE_SETUP_DIGEST
    }
  ]);
  assert.doesNotMatch(
    JSON.stringify(first),
    /"provider"|checkoutId|cs_private|cus_private|internalPurpose/u
  );
});

test("hosted downgrade scheduling binds the authenticated quote and exposes only renewal-boundary truth", async () => {
  const { calls, hosted } = context();
  const input = {
    acceptedDisclosureDigest: DISCLOSURE_DIGEST,
    quoteDigest: QUOTE_DIGEST,
    commandId: DOWNGRADE_COMMAND_ID
  };
  const first = await hosted.scheduleDowngrade(
    ACTOR,
    PROJECT_ID,
    QUOTE_ID,
    input
  );
  const replay = await hosted.scheduleDowngrade(
    ACTOR,
    PROJECT_ID,
    QUOTE_ID,
    input
  );
  assert.deepEqual(first, {
    schema:
      "sitesourcery.alakazam-downgrade-scheduled/v1",
    commandId: DOWNGRADE_COMMAND_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    state: "scheduled",
    priorTierId: "alakazam_50",
    targetTierId: "alakazam_25",
    effectiveAt: EFFECTIVE_AT,
    chargeNowMinor: 0,
    cashRefundMinor: 0,
    providerProration: false,
    currentTierKeptThroughPeriod: true
  });
  assert.deepEqual(replay, first);
  assert.deepEqual(calls.downgrades, [
    {
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      projectId: PROJECT_ID,
      quoteId: QUOTE_ID,
      acceptedDisclosureDigest: DISCLOSURE_DIGEST,
      quoteDigest: QUOTE_DIGEST
    },
    {
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      projectId: PROJECT_ID,
      quoteId: QUOTE_ID,
      acceptedDisclosureDigest: DISCLOSURE_DIGEST,
      quoteDigest: QUOTE_DIGEST
    }
  ]);
  assert.equal(calls.checkouts.length, 0);
  assert.doesNotMatch(
    JSON.stringify(first),
    /tenantId|customerId|subscriptionId|scheduleId|stripeScheduleId|providerFactsDigest|reconciliation|sub_private|sub_sched_private/u
  );
  assert.equal(Object.isFrozen(first), true);
});

test("hosted downgrade scheduling rejects malformed or mismatched durable confirmation", async () => {
  for (const downgrade of [
    downgradeResult({ status: "ready" }),
    downgradeResult({ projectId: OTHER_PROJECT_ID }),
    downgradeResult({ targetTierId: "alakazam_50" }),
    downgradeResult({ providerFactsDigest: "not-a-digest" }),
    downgradeResult({ privateLeak: "must-not-pass" })
  ]) {
    const { hosted } = context({ downgrade });
    await assert.rejects(
      hosted.scheduleDowngrade(
        ACTOR,
        PROJECT_ID,
        QUOTE_ID,
        {
          acceptedDisclosureDigest:
            DISCLOSURE_DIGEST,
          quoteDigest: QUOTE_DIGEST,
          commandId: DOWNGRADE_COMMAND_ID
        }
      ),
      (error) =>
        error.code === "ALAKAZAM_REPOSITORY_CONFLICT" &&
        error.status === 500
    );
  }
});

test("cross-project or cross-customer scope fails closed before billing", async () => {
  for (const resolvedScope of [
    scope({ projectId: OTHER_PROJECT_ID }),
    scope({
      customerId: OTHER_CUSTOMER_ID,
      actorId: OTHER_CUSTOMER_ID
    })
  ]) {
    const { calls, hosted } = context({ resolvedScope });
    await assert.rejects(
      hosted.createQuote(ACTOR, PROJECT_ID, {
        commandId: QUOTE_ID,
        targetTierId: "alakazam_25"
      }),
      (error) =>
        error.code === "ALAKAZAM_PROJECT_UNAVAILABLE" &&
        error.status === 404
    );
    await assert.rejects(
      hosted.scheduleDowngrade(
        ACTOR,
        PROJECT_ID,
        QUOTE_ID,
        {
          acceptedDisclosureDigest:
            DISCLOSURE_DIGEST,
          quoteDigest: QUOTE_DIGEST,
          commandId: DOWNGRADE_COMMAND_ID
        }
      ),
      (error) =>
        error.code === "ALAKAZAM_PROJECT_UNAVAILABLE" &&
        error.status === 404
    );
    assert.equal(calls.quotes.length, 0);
    assert.equal(calls.checkouts.length, 0);
    assert.equal(calls.downgrades.length, 0);
  }
});

test("forged bodies and malformed route identity fail before billing", async () => {
  const { calls, hosted } = context();
  const forbidden = [
    { projectId: OTHER_PROJECT_ID },
    { quoteId: QUOTE_ID },
    { customerId: OTHER_CUSTOMER_ID },
    { tenantId: TENANT_ID },
    { amountMinor: 1 },
    { credit: { amountMinor: 500 } },
    { subscription: { tierId: "alakazam_50" } },
    { tax: { mode: "forged" } },
    { provider: "stripe" },
    { effectiveAt: ISSUED_AT },
    { unknown: true }
  ];
  for (const extra of forbidden) {
    await assert.rejects(
      hosted.createQuote(ACTOR, PROJECT_ID, {
        commandId: QUOTE_ID,
        targetTierId: "alakazam_25",
        ...extra
      }),
      (error) =>
        error.code === "ALAKAZAM_ROUTE_BINDING_REJECTED"
    );
  }
  await assert.rejects(
    hosted.createCheckout(
      ACTOR,
      PROJECT_ID,
      QUOTE_ID,
      {
        acceptedDisclosureDigest: DISCLOSURE_DIGEST,
        commandId: COMMAND_ID,
        siteSetupDigest: SITE_SETUP_DIGEST,
        quoteId: QUOTE_ID
      }
    ),
    (error) =>
      error.code === "ALAKAZAM_ROUTE_BINDING_REJECTED"
  );
  for (const extra of forbidden) {
    await assert.rejects(
      hosted.scheduleDowngrade(
        ACTOR,
        PROJECT_ID,
        QUOTE_ID,
        {
          acceptedDisclosureDigest:
            DISCLOSURE_DIGEST,
          quoteDigest: QUOTE_DIGEST,
          commandId: DOWNGRADE_COMMAND_ID,
          ...extra
        }
      ),
      (error) =>
        error.code === "ALAKAZAM_ROUTE_BINDING_REJECTED"
    );
  }
  for (const invoke of [
    () =>
      hosted.createQuote(ACTOR, "not-a-project", {
        commandId: QUOTE_ID,
        targetTierId: "alakazam_25"
      }),
    () =>
      hosted.createCheckout(
        ACTOR,
        PROJECT_ID,
        "not-a-quote",
        {
          acceptedDisclosureDigest:
            DISCLOSURE_DIGEST,
          commandId: COMMAND_ID,
          siteSetupDigest: SITE_SETUP_DIGEST
        }
      ),
    () =>
      hosted.createCheckout(
        ACTOR,
        PROJECT_ID,
        QUOTE_ID,
        {
          acceptedDisclosureDigest: "not-a-digest",
          commandId: COMMAND_ID,
          siteSetupDigest: SITE_SETUP_DIGEST
        }
      ),
    () =>
      hosted.scheduleDowngrade(
        ACTOR,
        PROJECT_ID,
        "not-a-quote",
        {
          acceptedDisclosureDigest:
            DISCLOSURE_DIGEST,
          quoteDigest: QUOTE_DIGEST,
          commandId: DOWNGRADE_COMMAND_ID
        }
      ),
    () =>
      hosted.scheduleDowngrade(
        ACTOR,
        PROJECT_ID,
        QUOTE_ID,
        {
          acceptedDisclosureDigest: "not-a-digest",
          quoteDigest: QUOTE_DIGEST,
          commandId: DOWNGRADE_COMMAND_ID
        }
      ),
    () =>
      hosted.scheduleDowngrade(
        ACTOR,
        PROJECT_ID,
        QUOTE_ID,
        {
          acceptedDisclosureDigest:
            DISCLOSURE_DIGEST,
          quoteDigest: "not-a-digest",
          commandId: DOWNGRADE_COMMAND_ID
        }
      )
  ]) {
    await assert.rejects(
      invoke(),
      (error) => error.code === "ALAKAZAM_INVALID_INPUT"
    );
  }
  assert.equal(calls.quotes.length, 0);
  assert.equal(calls.checkouts.length, 0);
  assert.equal(calls.downgrades.length, 0);
});

test("readiness is safely projected and service errors retain hosted status", async () => {
  const { hosted } = context();
  assert.deepEqual(await hosted.readiness(), {
    ready: true,
    quote: true,
    checkout: true,
    downgrade: true,
    state: "quote_ready"
  });
  assert.doesNotMatch(
    JSON.stringify(await hosted.readiness()),
    /stripe|livemode|taxMode|customerProvisioning/u
  );

  const heldDowngrade = context({
    downgradeReadiness: {
      ready: false,
      downgrade: false,
      state: "held",
      code: "alakazam_billing_release_held"
    }
  });
  assert.deepEqual(await heldDowngrade.hosted.readiness(), {
    ready: true,
    quote: true,
    checkout: true,
    downgrade: false,
    state: "quote_ready"
  });

  const translated = createHostedAlakazamBilling({
    billing: {
      async readiness() {
        return {
          ready: false,
          quote: false,
          checkout: false,
          state: "held"
        };
      },
      async createQuote() {
        throw new CommerceV2Error(
          "billing_unavailable",
          "Billing is unavailable.",
          { status: 503 }
        );
      },
      async createCheckout() {
        throw new Error("unused");
      }
    },
    downgrade: {
      async readiness() {
        return {
          ready: false,
          downgrade: false,
          state: "held"
        };
      },
      async scheduleDowngrade() {
        throw new Error("unused");
      }
    },
    async resolveSession() {
      return scope();
    }
  });
  await assert.rejects(
    translated.createQuote(ACTOR, PROJECT_ID, {
      commandId: QUOTE_ID,
      targetTierId: "alakazam_25"
    }),
    (error) =>
      error instanceof HostedError &&
      error.code === "ALAKAZAM_BILLING_UNAVAILABLE" &&
      error.status === 503
  );
});
