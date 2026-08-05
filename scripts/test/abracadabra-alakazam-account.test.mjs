import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createClient } = require(
  "../../abracadabra/app/abracadabra-api.js"
);
const customerControl = require(
  "../../abracadabra/app/abracadabra-customer-control-dom.js"
);

const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID =
  "30000000-0000-4000-8000-000000000002";

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type"
          ? "application/json"
          : null;
      },
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function tier(number, rank, capabilities = []) {
  return {
    tierId: `alakazam_${number}`,
    rank,
    name: `Alakazam ${number}`,
    price: {
      amountMinor: number * 100,
      currency: "USD",
      billing: "recurring",
      interval: "month",
    },
    capabilities,
    limits: {
      careClass:
        number === 25 ? "none" : number === 35 ? "modest" : "more",
      versionHistory: number === 25 ? 0 : 3,
      fontControls:
        number === 25 ? "base" : number === 35 ? "expanded" : "extended",
      borderControls: number === 50 ? "extended" : "base",
    },
  };
}

function catalog() {
  return {
    schema: "sitesourcery.alakazam-public-tier-catalog.v1",
    catalogVersion: "alakazam_catalog_2026_08_04",
    termsVersion: "alakazam_terms_2026_08_04",
    state: "held",
    product: {
      productId: "alakazam_hosting",
      name: "Alakazam",
      scope: "one_editor_project",
    },
    ladder: {
      downloadCreditMinor: 500,
      upgradeRule: "fixed_target_minus_current_tier",
      downgradeRule: "renewal_boundary_no_refund_or_proration",
      premiumConfiguration: "preserved_when_inactive",
    },
    tiers: [
      tier(25, 1, ["hosted_site"]),
      tier(35, 2, ["hosted_site", "photo_header"]),
      tier(50, 3, ["hosted_site", "cash_app_link", "venmo_link"]),
    ],
  };
}

function subscription(
  selectedTier,
  overrides = {}
) {
  return {
    tier: structuredClone(selectedTier),
    status: "active",
    paymentState: "paid",
    price: structuredClone(selectedTier.price),
    revision: 4,
    currentPeriod: {
      startsAt: "2026-08-02T12:00:00.000Z",
      endsAt: "2026-09-02T12:00:00.000Z",
    },
    cancelAtPeriodEnd: false,
    firstFailedAt: null,
    graceEndsAt: null,
    ...overrides,
  };
}

function account(overrides = {}) {
  const hasSubscription = overrides.subscription !== undefined
    && overrides.subscription !== null;
  return {
    schema: "sitesourcery.alakazam-account/v1",
    projectId: PROJECT_ID,
    state: "available",
    catalog: catalog(),
    downloadCredit: {
      available: !hasSubscription,
      amountMinor: hasSubscription ? 0 : 500,
      currency: "USD",
    },
    subscription: null,
    pendingChange: null,
    nextRenewal: null,
    receipts: [],
    actions: {
      start: !hasSubscription,
      changeTier: false,
      manageBilling: false,
      cancel: false,
      reason: hasSubscription
        ? "customer_commands_not_composed"
        : "only_start_composed",
    },
    ...overrides,
  };
}

function subscribedAccount(
  selectedTierId,
  options = {}
) {
  const {
    actions: suppliedActions,
    nextRenewal: suppliedRenewal,
    pendingChange = null,
    state: suppliedState,
    subscriptionOverrides = {},
    ...accountOverrides
  } = options;
  const snapshotCatalog = catalog();
  const selectedTier = snapshotCatalog.tiers.find(
    (candidate) => candidate.tierId === selectedTierId
  );
  assert.ok(selectedTier, "fixture tier must be canonical");
  const selectedSubscription = subscription(
    selectedTier,
    subscriptionOverrides
  );
  const inferredState = {
    pending: "activation_pending",
    active: "active",
    grace: "attention_required",
    suspended: "attention_required",
    cancelled: "ended",
    ended: "ended",
  }[selectedSubscription.status];
  const hasDifferentTier = snapshotCatalog.tiers.some(
    (candidate) => candidate.rank !== selectedTier.rank
  );
  const changeTier =
    selectedSubscription.status === "active"
    && selectedSubscription.paymentState === "paid"
    && selectedSubscription.currentPeriod !== null
    && selectedSubscription.cancelAtPeriodEnd === false
    && pendingChange === null
    && hasDifferentTier;
  const actions = suppliedActions || {
    start: false,
    changeTier,
    manageBilling: false,
    cancel: false,
    reason: changeTier
      ? "only_tier_change_composed"
      : "customer_commands_not_composed",
  };
  let nextRenewal = suppliedRenewal;
  if (nextRenewal === undefined) {
    const renewalUnavailable =
      selectedSubscription.currentPeriod === null
      || selectedSubscription.cancelAtPeriodEnd
      || ["cancelled", "ended"].includes(
        selectedSubscription.status
      );
    if (renewalUnavailable) {
      nextRenewal = null;
    } else {
      const renewalTier =
        pendingChange
        && pendingChange.changeKind === "downgrade"
        && pendingChange.state === "scheduled"
          ? pendingChange.targetTier
          : selectedTier;
      nextRenewal = {
        tierId: renewalTier.tierId,
        amountMinor: renewalTier.price.amountMinor,
        currency: "USD",
        dueAt: selectedSubscription.currentPeriod.endsAt,
        state: ["grace", "suspended"].includes(
          selectedSubscription.status
        )
          ? "attention_required"
          : "scheduled",
      };
    }
  }
  return account({
    ...accountOverrides,
    state: suppliedState || inferredState,
    catalog: snapshotCatalog,
    subscription: selectedSubscription,
    pendingChange: structuredClone(pendingChange),
    nextRenewal: structuredClone(nextRenewal),
    actions,
  });
}

function changed(source, mutate) {
  const copy = structuredClone(source);
  mutate(copy);
  return copy;
}

function startQuote(
  snapshot,
  targetTierId = "alakazam_25",
  overrides = {}
) {
  const targetTier = snapshot.catalog.tiers.find(
    (candidate) => candidate.tierId === targetTierId
  );
  const appliedValue = snapshot.downloadCredit.available
    ? { kind: "download_purchase", amountMinor: 500 }
    : { kind: "none", amountMinor: 0 };
  const dueNow = {
    subtotalMinor:
      targetTier.price.amountMinor -
      appliedValue.amountMinor,
    currency: "USD",
    taxMinor: 0,
    totalMinor:
      targetTier.price.amountMinor -
      appliedValue.amountMinor,
    taxState: "disabled_by_owner",
  };
  const renewal = {
    tierId: targetTierId,
    amountMinor: targetTier.price.amountMinor,
    currency: "USD",
    interval: "month",
  };
  return {
    schema:
      "sitesourcery.alakazam-tier-change-quote.v1",
    quoteId:
      "40000000-0000-4000-8000-000000000010",
    projectId: PROJECT_ID,
    catalogVersion: snapshot.catalog.catalogVersion,
    termsVersion: snapshot.catalog.termsVersion,
    state: "quoted",
    changeKind: "start",
    targetTier: structuredClone(targetTier),
    dueNow,
    appliedValue,
    effectiveAt:
      "after_payment_and_provider_confirmation",
    nextRenewal: renewal,
    noMidPeriodRefundOrProration: false,
    premiumConfiguration: "preserved_when_inactive",
    issuedAt: "2026-08-04T18:00:00.000Z",
    expiresAt: "2026-08-04T18:30:00.000Z",
    disclosure: {
      schema:
        "sitesourcery.alakazam-tier-change-disclosure.v1",
      changeKind: "start",
      currentTierId: null,
      targetTierId,
      dueNow: structuredClone(dueNow),
      appliedValue: structuredClone(appliedValue),
      effectiveAt:
        "after_payment_and_provider_confirmation",
      renewal: structuredClone(renewal),
      downgrade: {
        cashRefundMinor: 0,
        providerProration: false,
        currentTierKeptThroughPeriod: false,
      },
      premiumConfiguration:
        "preserved_when_inactive",
      cancellationPolicy:
        "owner_review_required_before_release",
    },
    disclosureDigest: "a".repeat(64),
    quoteDigest: "b".repeat(64),
    ...overrides,
  };
}

function upgradeQuote(
  snapshot,
  targetTierId,
  overrides = {}
) {
  const targetTier = snapshot.catalog.tiers.find(
    (candidate) => candidate.tierId === targetTierId
  );
  assert.ok(targetTier, "upgrade target must be canonical");
  const currentTier = snapshot.subscription.tier;
  const appliedValue = {
    kind: "current_paid_tier",
    amountMinor: currentTier.price.amountMinor,
  };
  const dueNow = {
    subtotalMinor:
      targetTier.price.amountMinor
      - currentTier.price.amountMinor,
    currency: "USD",
    taxMinor: 0,
    totalMinor:
      targetTier.price.amountMinor
      - currentTier.price.amountMinor,
    taxState: "disabled_by_owner",
  };
  const renewal = {
    tierId: targetTierId,
    amountMinor: targetTier.price.amountMinor,
    currency: "USD",
    interval: "month",
  };
  return {
    schema:
      "sitesourcery.alakazam-tier-change-quote.v1",
    quoteId:
      "40000000-0000-4000-8000-000000000011",
    projectId: PROJECT_ID,
    catalogVersion: snapshot.catalog.catalogVersion,
    termsVersion: snapshot.catalog.termsVersion,
    state: "quoted",
    changeKind: "upgrade",
    targetTier: structuredClone(targetTier),
    dueNow,
    appliedValue,
    effectiveAt:
      "after_payment_and_provider_confirmation",
    nextRenewal: renewal,
    noMidPeriodRefundOrProration: false,
    premiumConfiguration: "preserved_when_inactive",
    issuedAt: "2026-08-04T18:00:00.000Z",
    expiresAt: "2026-08-04T18:30:00.000Z",
    disclosure: {
      schema:
        "sitesourcery.alakazam-tier-change-disclosure.v1",
      changeKind: "upgrade",
      currentTierId: currentTier.tierId,
      targetTierId,
      dueNow: structuredClone(dueNow),
      appliedValue: structuredClone(appliedValue),
      effectiveAt:
        "after_payment_and_provider_confirmation",
      renewal: structuredClone(renewal),
      downgrade: {
        cashRefundMinor: 0,
        providerProration: false,
        currentTierKeptThroughPeriod: false,
      },
      premiumConfiguration:
        "preserved_when_inactive",
      cancellationPolicy:
        "owner_review_required_before_release",
    },
    disclosureDigest: "d".repeat(64),
    quoteDigest: "e".repeat(64),
    ...overrides,
  };
}

function downgradeQuote(
  snapshot,
  targetTierId,
  overrides = {}
) {
  const targetTier = snapshot.catalog.tiers.find(
    (candidate) => candidate.tierId === targetTierId
  );
  assert.ok(targetTier, "downgrade target must be canonical");
  const currentTier = snapshot.subscription.tier;
  const appliedValue = { kind: "none", amountMinor: 0 };
  const dueNow = {
    subtotalMinor: 0,
    currency: "USD",
    taxMinor: 0,
    totalMinor: 0,
    taxState: "disabled_by_owner",
  };
  const renewal = {
    tierId: targetTierId,
    amountMinor: targetTier.price.amountMinor,
    currency: "USD",
    interval: "month",
  };
  const effectiveAt =
    snapshot.subscription.currentPeriod.endsAt;
  return {
    schema:
      "sitesourcery.alakazam-tier-change-quote.v1",
    quoteId:
      "40000000-0000-4000-8000-000000000013",
    projectId: PROJECT_ID,
    catalogVersion: snapshot.catalog.catalogVersion,
    termsVersion: snapshot.catalog.termsVersion,
    state: "quoted",
    changeKind: "downgrade",
    targetTier: structuredClone(targetTier),
    dueNow,
    appliedValue,
    effectiveAt,
    nextRenewal: renewal,
    noMidPeriodRefundOrProration: true,
    premiumConfiguration: "preserved_when_inactive",
    issuedAt: "2026-08-04T18:00:00.000Z",
    expiresAt: "2026-08-04T18:30:00.000Z",
    disclosure: {
      schema:
        "sitesourcery.alakazam-tier-change-disclosure.v1",
      changeKind: "downgrade",
      currentTierId: currentTier.tierId,
      targetTierId,
      dueNow: structuredClone(dueNow),
      appliedValue: structuredClone(appliedValue),
      effectiveAt,
      renewal: structuredClone(renewal),
      downgrade: {
        cashRefundMinor: 0,
        providerProration: false,
        currentTierKeptThroughPeriod: true,
      },
      premiumConfiguration:
        "preserved_when_inactive",
      cancellationPolicy:
        "owner_review_required_before_release",
    },
    disclosureDigest: "f".repeat(64),
    quoteDigest: "1".repeat(64),
    ...overrides,
  };
}

function scheduledDowngrade(
  quote,
  commandId =
    "50000000-0000-4000-8000-000000000013",
  overrides = {}
) {
  return {
    schema:
      "sitesourcery.alakazam-downgrade-scheduled/v1",
    commandId,
    projectId: PROJECT_ID,
    quoteId: quote.quoteId,
    state: "scheduled",
    priorTierId: quote.disclosure.currentTierId,
    targetTierId: quote.targetTier.tierId,
    effectiveAt: quote.effectiveAt,
    chargeNowMinor: 0,
    cashRefundMinor: 0,
    providerProration: false,
    currentTierKeptThroughPeriod: true,
    ...overrides,
  };
}

function checkout(quote, overrides = {}) {
  return {
    schema:
      "sitesourcery.alakazam-checkout-ready/v1",
    commandId:
      "50000000-0000-4000-8000-000000000010",
    projectId: PROJECT_ID,
    quoteId: quote.quoteId,
    state: "ready",
    purposeDigest: "c".repeat(64),
    checkoutUrl:
      "https://checkout.stripe.com/c/pay/alakazam-safe",
    expiresAt: "2026-08-04T19:00:00.000Z",
    ...overrides,
  };
}

test("the Abracadabra client reads only the selected project's Alakazam route", async () => {
  const calls = [];
  const expected = account();
  const controller = new AbortController();
  const client = createClient({
    baseUrl: "/api/v1",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response(200, expected);
    },
  });

  assert.deepEqual(
    await client.getAlakazamAccount(PROJECT_ID, {
      signal: controller.signal,
    }),
    expected
  );
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `/api/v1/projects/${PROJECT_ID}/alakazam`
  );
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(calls[0].options.body, undefined);
  assert.equal(
    calls[0].options.headers["Idempotency-Key"],
    undefined
  );
  assert.equal(
    calls[0].options.headers["X-CSRF-Token"],
    undefined
  );
});

test("the Alakazam quote client sends only the target tier with CSRF and a stable command identity", async () => {
  const calls = [];
  const commandId =
    "50000000-0000-4000-8000-000000000012";
  const client = createClient({
    baseUrl: "/api/v1",
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        return response(200, { csrfToken: "csrf-proof" });
      }
      return response(200, { state: "quoted" });
    },
  });

  await client.createAlakazamQuote(
    PROJECT_ID,
    { targetTierId: "alakazam_50" },
    { idempotencyKey: commandId }
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/v1/csrf");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(
    calls[1].url,
    `/api/v1/projects/${PROJECT_ID}/alakazam-quotes`
  );
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(
    JSON.parse(calls[1].options.body),
    { targetTierId: "alakazam_50" }
  );
  assert.equal(
    calls[1].options.headers["Idempotency-Key"],
    commandId
  );
  assert.equal(
    calls[1].options.headers["X-CSRF-Token"],
    "csrf-proof"
  );
  assert.equal(calls[1].options.credentials, "include");
  assert.equal(calls[1].options.redirect, "error");
});

test("the downgrade client sends only accepted quote truth with CSRF and stable command identity", async () => {
  const calls = [];
  const commandId =
    "50000000-0000-4000-8000-000000000013";
  const quoteId =
    "40000000-0000-4000-8000-000000000013";
  const acceptedDisclosureDigest = "f".repeat(64);
  const quoteDigest = "1".repeat(64);
  const client = createClient({
    baseUrl: "/api/v1",
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        return response(200, { csrfToken: "csrf-proof" });
      }
      return response(201, { state: "scheduled" });
    },
  });

  await client.scheduleAlakazamDowngrade(
    PROJECT_ID,
    quoteId,
    { acceptedDisclosureDigest, quoteDigest },
    { idempotencyKey: commandId }
  );

  assert.equal(calls.length, 2);
  assert.equal(
    calls[1].url,
    `/api/v1/projects/${PROJECT_ID}/alakazam-quotes/`
      + `${quoteId}/downgrade-schedule-command`
  );
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    acceptedDisclosureDigest,
    quoteDigest,
  });
  assert.equal(
    calls[1].options.headers["Idempotency-Key"],
    commandId
  );
  assert.equal(
    calls[1].options.headers["X-CSRF-Token"],
    "csrf-proof"
  );
});

test("start quotes and Checkout destinations are exact, credit-aware, and project-bound", () => {
  const snapshot = account();
  const observedAt = "2026-08-04T18:10:00.000Z";
  for (const [tierId, dueNowMinor] of [
    ["alakazam_25", 2000],
    ["alakazam_35", 3000],
    ["alakazam_50", 4500],
  ]) {
    const quote = startQuote(snapshot, tierId);
    const verified =
      customerControl.verifiedAlakazamQuote(
        quote,
        PROJECT_ID,
        snapshot,
        tierId,
        observedAt
      );
    assert.equal(verified.targetTier.tierId, tierId);
    assert.equal(
      verified.appliedValue.amountMinor,
      500
    );
    assert.equal(
      verified.dueNow.subtotalMinor,
      dueNowMinor
    );
  }

  const noCredit = account({
    downloadCredit: {
      available: false,
      amountMinor: 0,
      currency: "USD",
    },
  });
  const fullPrice = startQuote(noCredit);
  assert.equal(
    customerControl.verifiedAlakazamQuote(
      fullPrice,
      PROJECT_ID,
      noCredit,
      "alakazam_25",
      observedAt
    ).dueNow.subtotalMinor,
    2500
  );

  const quote = startQuote(snapshot);
  const commandId =
    "50000000-0000-4000-8000-000000000010";
  const checkoutResult = checkout(quote);
  assert.deepEqual(
    customerControl.verifiedAlakazamCheckout(
      checkoutResult,
      PROJECT_ID,
      quote.quoteId,
      commandId,
      observedAt
    ),
    checkoutResult
  );
  assert.equal(
    customerControl.safeCheckoutDestination(
      checkoutResult
    ),
    checkoutResult.checkoutUrl
  );

  for (const invalid of [
    changed(quote, (value) => {
      value.projectId = OTHER_PROJECT_ID;
    }),
    changed(quote, (value) => {
      value.changeKind = "upgrade";
    }),
    changed(quote, (value) => {
      value.dueNow.subtotalMinor = 1;
      value.dueNow.totalMinor = 1;
    }),
    changed(quote, (value) => {
      value.appliedValue.sourceId = "private-credit";
    }),
    changed(quote, (value) => {
      value.disclosureDigest = "not-a-digest";
    }),
    changed(quote, (value) => {
      value.expiresAt = observedAt;
    }),
    changed(quote, (value) => {
      value.provider = "stripe";
    }),
    changed(quote, (value) => {
      value.noMidPeriodRefundOrProration = true;
    }),
  ]) {
    assert.equal(
      customerControl.verifiedAlakazamQuote(
        invalid,
        PROJECT_ID,
        snapshot,
        "alakazam_25",
        observedAt
      ),
      null
    );
  }

  for (const invalid of [
    checkout(quote, { projectId: OTHER_PROJECT_ID }),
    checkout(quote, { commandId: OTHER_PROJECT_ID }),
    checkout(quote, {
      checkoutUrl:
        "https://checkout.stripe.com/c/pay/safe#leak",
    }),
    checkout(quote, { expiresAt: observedAt }),
    checkout(quote, { checkoutId: "cs_private" }),
  ]) {
    assert.equal(
      customerControl.verifiedAlakazamCheckout(
        invalid,
        PROJECT_ID,
        quote.quoteId,
        commandId,
        observedAt
      ),
      null
    );
  }
});

test("tier-change eligibility exposes every different canonical tier for exact active paid accounts", () => {
  const cases = [
    ["alakazam_25", ["alakazam_35", "alakazam_50"]],
    ["alakazam_35", ["alakazam_25", "alakazam_50"]],
    ["alakazam_50", ["alakazam_25", "alakazam_35"]],
  ];
  for (const [currentTierId, expectedTargets] of cases) {
    const snapshot = subscribedAccount(currentTierId);
    const verified = customerControl.verifiedAlakazamAccount(
      snapshot,
      PROJECT_ID
    );
    assert.ok(verified);
    assert.equal(
      verified.actions.changeTier,
      true
    );
    assert.equal(verified.actions.start, false);
    assert.deepEqual(
      verified.catalog.tiers
        .filter((candidate) => (
          customerControl.expectedAlakazamQuoteChange(
            verified,
            candidate.tierId
          )
        ))
        .map((candidate) => candidate.tierId),
      expectedTargets
    );
  }

  const pending = subscribedAccount("alakazam_25", {
    pendingChange: {
      changeKind: "upgrade",
      targetTier: catalog().tiers[1],
      effectiveAt: null,
      state: "payment_pending",
    },
  });
  const cancelling = subscribedAccount("alakazam_25", {
    subscriptionOverrides: {
      cancelAtPeriodEnd: true,
    },
    pendingChange: {
      changeKind: "cancellation",
      targetTier: null,
      effectiveAt: "2026-09-02T12:00:00.000Z",
      state: "cancellation_scheduled",
    },
  });
  const grace = subscribedAccount("alakazam_25", {
    subscriptionOverrides: {
      status: "grace",
      paymentState: "attention_required",
      firstFailedAt: "2026-08-05T12:00:00.000Z",
      graceEndsAt: "2026-08-19T12:00:00.000Z",
    },
  });
  const suspended = subscribedAccount("alakazam_25", {
    subscriptionOverrides: {
      status: "suspended",
      paymentState: "suspended",
    },
  });
  const ended = subscribedAccount("alakazam_25", {
    subscriptionOverrides: {
      status: "ended",
      paymentState: "ended",
    },
  });
  const pendingView =
    customerControl.alakazamAccountPresentation(
      pending,
      PROJECT_ID
    );
  assert.equal(
    pendingView.account.subscription.tier.tierId,
    "alakazam_25"
  );
  assert.equal(
    pendingView.account.pendingChange.targetTier.tierId,
    "alakazam_35"
  );
  assert.equal(
    pendingView.account.pendingChange.state,
    "payment_pending"
  );
  for (const snapshot of [
    pending,
    cancelling,
    grace,
    suspended,
    ended,
  ]) {
    const verified = customerControl.verifiedAlakazamAccount(
      snapshot,
      PROJECT_ID
    );
    assert.ok(verified);
    assert.equal(verified.actions.changeTier, false);
    assert.equal(
      customerControl.expectedAlakazamQuoteChange(
        verified,
        "alakazam_50"
      ),
      null
    );
  }

  assert.equal(
    customerControl.verifiedAlakazamAccount(
      changed(subscribedAccount("alakazam_25"), (value) => {
        value.actions.changeTier = false;
        value.actions.reason =
          "customer_commands_not_composed";
      }),
      PROJECT_ID
    ),
    null
  );
  assert.equal(
    customerControl.verifiedAlakazamAccount(
      changed(subscribedAccount("alakazam_50"), (value) => {
        value.actions.changeTier = false;
        value.actions.reason =
          "customer_commands_not_composed";
      }),
      PROJECT_ID
    ),
    null
  );
});

test("upgrade quotes require exact fixed differences, current-tier value, renewal truth, and no provider proration", () => {
  const observedAt = "2026-08-04T18:10:00.000Z";
  for (const [currentTierId, targetTierId, dueNowMinor] of [
    ["alakazam_25", "alakazam_35", 1000],
    ["alakazam_35", "alakazam_50", 1500],
    ["alakazam_25", "alakazam_50", 2500],
  ]) {
    const snapshot = subscribedAccount(currentTierId);
    const quote = upgradeQuote(snapshot, targetTierId);
    const verified = customerControl.verifiedAlakazamQuote(
      quote,
      PROJECT_ID,
      snapshot,
      targetTierId,
      observedAt
    );
    assert.ok(verified);
    assert.equal(verified.changeKind, "upgrade");
    assert.equal(
      verified.disclosure.currentTierId,
      currentTierId
    );
    assert.equal(
      verified.appliedValue.kind,
      "current_paid_tier"
    );
    assert.equal(
      verified.appliedValue.amountMinor,
      snapshot.subscription.price.amountMinor
    );
    assert.equal(
      verified.dueNow.subtotalMinor,
      dueNowMinor
    );
    assert.equal(
      verified.nextRenewal.amountMinor,
      verified.targetTier.price.amountMinor
    );
    assert.equal(
      verified.noMidPeriodRefundOrProration,
      false
    );
    assert.equal(
      verified.disclosure.downgrade.providerProration,
      false
    );
    assert.equal(snapshot.downloadCredit.available, false);
    assert.equal(snapshot.downloadCredit.amountMinor, 0);
  }

  const current35 = subscribedAccount("alakazam_35");
  assert.equal(
    customerControl.expectedAlakazamQuoteChange(
      current35,
      "alakazam_25"
    ).changeKind,
    "downgrade"
  );
  assert.equal(
    customerControl.verifiedAlakazamQuote(
      upgradeQuote(current35, "alakazam_25"),
      PROJECT_ID,
      current35,
      "alakazam_25",
      observedAt
    ),
    null
  );
  assert.equal(
    customerControl.expectedAlakazamQuoteChange(
      current35,
      "alakazam_35"
    ),
    null
  );

  const current25 = subscribedAccount("alakazam_25");
  const valid = upgradeQuote(current25, "alakazam_35");
  for (const invalid of [
    changed(valid, (value) => {
      value.disclosure.currentTierId = "alakazam_35";
    }),
    changed(valid, (value) => {
      value.appliedValue.kind = "download_purchase";
      value.disclosure.appliedValue.kind =
        "download_purchase";
    }),
    changed(valid, (value) => {
      value.appliedValue.amountMinor = 500;
      value.dueNow.subtotalMinor = 3000;
      value.dueNow.totalMinor = 3000;
      value.disclosure.appliedValue.amountMinor = 500;
      value.disclosure.dueNow =
        structuredClone(value.dueNow);
    }),
    changed(valid, (value) => {
      value.dueNow.subtotalMinor = 999;
      value.dueNow.totalMinor = 999;
      value.disclosure.dueNow =
        structuredClone(value.dueNow);
    }),
    changed(valid, (value) => {
      value.nextRenewal.amountMinor = 2500;
      value.disclosure.renewal =
        structuredClone(value.nextRenewal);
    }),
    changed(valid, (value) => {
      value.noMidPeriodRefundOrProration = true;
    }),
    changed(valid, (value) => {
      value.disclosure.downgrade.providerProration = true;
    }),
    changed(valid, (value) => {
      value.disclosureDigest = "not-a-digest";
    }),
    changed(valid, (value) => {
      value.expiresAt = observedAt;
    }),
  ]) {
    assert.equal(
      customerControl.verifiedAlakazamQuote(
        invalid,
        PROJECT_ID,
        current25,
        "alakazam_35",
        observedAt
      ),
      null
    );
  }

  assert.equal(
    customerControl.verifiedAlakazamQuote(
      valid,
      PROJECT_ID,
      subscribedAccount("alakazam_35"),
      "alakazam_35",
      observedAt
    ),
    null
  );
});

test("downgrade quotes and schedule confirmations preserve the paid boundary with zero charge and refund", () => {
  const observedAt = "2026-08-04T18:10:00.000Z";
  for (const [currentTierId, targetTierId] of [
    ["alakazam_35", "alakazam_25"],
    ["alakazam_50", "alakazam_35"],
    ["alakazam_50", "alakazam_25"],
  ]) {
    const snapshot = subscribedAccount(currentTierId);
    const quote = downgradeQuote(snapshot, targetTierId);
    const verified = customerControl.verifiedAlakazamQuote(
      quote,
      PROJECT_ID,
      snapshot,
      targetTierId,
      observedAt
    );
    assert.ok(verified);
    assert.equal(verified.changeKind, "downgrade");
    assert.deepEqual(verified.appliedValue, {
      kind: "none",
      amountMinor: 0,
    });
    assert.equal(verified.dueNow.subtotalMinor, 0);
    assert.equal(verified.dueNow.totalMinor, 0);
    assert.equal(
      verified.effectiveAt,
      snapshot.subscription.currentPeriod.endsAt
    );
    assert.equal(
      verified.nextRenewal.amountMinor,
      verified.targetTier.price.amountMinor
    );
    assert.equal(
      verified.noMidPeriodRefundOrProration,
      true
    );
    assert.deepEqual(verified.disclosure.downgrade, {
      cashRefundMinor: 0,
      providerProration: false,
      currentTierKeptThroughPeriod: true,
    });

    const commandId =
      "50000000-0000-4000-8000-000000000013";
    const scheduled = scheduledDowngrade(
      quote,
      commandId
    );
    assert.deepEqual(
      customerControl.verifiedAlakazamDowngrade(
        scheduled,
        PROJECT_ID,
        quote,
        commandId
      ),
      scheduled
    );
  }

  const snapshot = subscribedAccount("alakazam_50");
  const valid = downgradeQuote(snapshot, "alakazam_25");
  for (const invalid of [
    changed(valid, (value) => {
      value.dueNow.subtotalMinor = 1;
      value.dueNow.totalMinor = 1;
      value.disclosure.dueNow =
        structuredClone(value.dueNow);
    }),
    changed(valid, (value) => {
      value.appliedValue.kind = "current_paid_tier";
      value.disclosure.appliedValue.kind =
        "current_paid_tier";
    }),
    changed(valid, (value) => {
      value.effectiveAt = "2026-09-03T12:00:00.000Z";
      value.disclosure.effectiveAt = value.effectiveAt;
    }),
    changed(valid, (value) => {
      value.noMidPeriodRefundOrProration = false;
    }),
    changed(valid, (value) => {
      value.disclosure.downgrade.cashRefundMinor = 1;
    }),
    changed(valid, (value) => {
      value.disclosure.downgrade.providerProration = true;
    }),
    changed(valid, (value) => {
      value.disclosure.downgrade
        .currentTierKeptThroughPeriod = false;
    }),
  ]) {
    assert.equal(
      customerControl.verifiedAlakazamQuote(
        invalid,
        PROJECT_ID,
        snapshot,
        "alakazam_25",
        observedAt
      ),
      null
    );
  }

  const commandId =
    "50000000-0000-4000-8000-000000000013";
  for (const invalid of [
    scheduledDowngrade(valid, commandId, {
      projectId: OTHER_PROJECT_ID,
    }),
    scheduledDowngrade(valid, commandId, {
      priorTierId: "alakazam_35",
    }),
    scheduledDowngrade(valid, commandId, {
      chargeNowMinor: 1,
    }),
    scheduledDowngrade(valid, commandId, {
      providerProration: true,
    }),
    scheduledDowngrade(valid, commandId, {
      stripeScheduleId: "sub_sched_private",
    }),
  ]) {
    assert.equal(
      customerControl.verifiedAlakazamDowngrade(
        invalid,
        PROJECT_ID,
        valid,
        commandId
      ),
      null
    );
  }
});

test("a refreshed account must confirm the exact scheduled downgrade without changing the current tier early", () => {
  const before = subscribedAccount("alakazam_50");
  const quote = downgradeQuote(before, "alakazam_25");
  const scheduled = scheduledDowngrade(
    quote,
    "50000000-0000-4000-8000-000000000013"
  );
  const targetTier = catalog().tiers[0];
  const refreshed = subscribedAccount(
    "alakazam_50",
    {
      pendingChange: {
        changeKind: "downgrade",
        targetTier: structuredClone(targetTier),
        effectiveAt: scheduled.effectiveAt,
        state: "scheduled",
      },
    }
  );
  assert.equal(
    customerControl
      .confirmedAlakazamDowngradeProjection(
        refreshed,
        scheduled
      ),
    true
  );

  for (const invalid of [
    changed(refreshed, (value) => {
      value.subscription.tier =
        structuredClone(targetTier);
      value.subscription.price =
        structuredClone(targetTier.price);
    }),
    changed(refreshed, (value) => {
      value.subscription.currentPeriod.endsAt =
        "2026-09-03T12:00:00.000Z";
    }),
    changed(refreshed, (value) => {
      value.pendingChange.effectiveAt =
        "2026-09-03T12:00:00.000Z";
    }),
    changed(refreshed, (value) => {
      value.pendingChange.targetTier =
        structuredClone(catalog().tiers[1]);
    }),
    changed(refreshed, (value) => {
      value.nextRenewal.dueAt =
        "2026-09-03T12:00:00.000Z";
    }),
    changed(refreshed, (value) => {
      value.actions.changeTier = true;
    }),
  ]) {
    assert.equal(
      customerControl
        .confirmedAlakazamDowngradeProjection(
          invalid,
          scheduled
        ),
      false
    );
  }
});

test("the customer projection preserves active, pending, attention, ended, renewal, credit, and receipt facts", () => {
  const tiers = catalog().tiers;
  const receipt = {
    receiptId:
      "40000000-0000-4000-8000-000000000001",
    kind: "upgrade_difference",
    subtotalMinor: 1000,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 1000,
    currency: "USD",
    settledAt: "2026-08-02T12:03:00.000Z",
    invoiceAvailable: true,
  };
  const active = account({
    state: "active",
    subscription: subscription(tiers[1]),
    pendingChange: {
      changeKind: "downgrade",
      targetTier: structuredClone(tiers[0]),
      effectiveAt: "2026-09-02T12:00:00.000Z",
      state: "scheduled",
    },
    nextRenewal: {
      tierId: "alakazam_25",
      amountMinor: 2500,
      currency: "USD",
      dueAt: "2026-09-02T12:00:00.000Z",
      state: "scheduled",
    },
    receipts: [receipt],
  });
  const activeView =
    customerControl.alakazamAccountPresentation(
      active,
      PROJECT_ID
    );
  assert.equal(activeView.heading, "Alakazam is active.");
  assert.equal(
    activeView.account.subscription.tier.name,
    "Alakazam 35"
  );
  assert.equal(
    activeView.account.nextRenewal.amountMinor,
    2500
  );
  assert.equal(
    activeView.account.pendingChange.targetTier.tierId,
    "alakazam_25"
  );
  assert.equal(activeView.account.downloadCredit.amountMinor, 0);
  assert.equal(activeView.account.receipts[0].totalMinor, 1000);
  assert.equal(
    customerControl.accountReceiptMoney(
      activeView.account.receipts[0]
    ),
    "$10.00 USD"
  );

  const pending = account({
    state: "activation_pending",
    subscription: subscription(tiers[0], {
      status: "pending",
      paymentState: "pending",
      currentPeriod: null,
    }),
    pendingChange: {
      changeKind: "start",
      targetTier: structuredClone(tiers[0]),
      effectiveAt: null,
      state: "activation_pending",
    },
  });
  assert.match(
    customerControl.alakazamAccountPresentation(
      pending,
      PROJECT_ID
    ).heading,
    /activation is in progress/u
  );

  const attention = account({
    state: "attention_required",
    subscription: subscription(tiers[2], {
      status: "grace",
      paymentState: "attention_required",
      firstFailedAt: "2026-08-05T12:00:00.000Z",
      graceEndsAt: "2026-08-19T12:00:00.000Z",
    }),
    nextRenewal: {
      tierId: "alakazam_50",
      amountMinor: 5000,
      currency: "USD",
      dueAt: "2026-09-02T12:00:00.000Z",
      state: "attention_required",
    },
  });
  assert.match(
    customerControl.alakazamAccountPresentation(
      attention,
      PROJECT_ID
    ).heading,
    /needs attention/u
  );

  const ended = account({
    state: "ended",
    subscription: subscription(tiers[0], {
      status: "ended",
      paymentState: "ended",
    }),
  });
  assert.match(
    customerControl.alakazamAccountPresentation(
      ended,
      PROJECT_ID
    ).heading,
    /has ended/u
  );
});

test("the customer projection fails closed on cross-project, schema, action, money, and provider-shaped drift", () => {
  const source = account();
  assert.equal(
    customerControl.verifiedAlakazamAccount(
      source,
      PROJECT_ID
    ).projectId,
    PROJECT_ID
  );
  assert.equal(
    customerControl.verifiedAlakazamAccount(
      account({
        state: "active",
        subscription: subscription(catalog().tiers[1]),
        downloadCredit: {
          available: true,
          amountMinor: 500,
          currency: "USD",
        },
      }),
      PROJECT_ID
    ),
    null
  );
  for (const changed of [
    { ...source, projectId: OTHER_PROJECT_ID },
    { ...source, schema: "sitesourcery.alakazam-account/v2" },
    {
      ...source,
      actions: { ...source.actions, start: false },
    },
    {
      ...source,
      downloadCredit: {
        ...source.downloadCredit,
        amountMinor: -1,
      },
    },
    {
      ...source,
      downloadCredit: {
        available: false,
        amountMinor: 500,
        currency: "USD",
      },
    },
    account({
      state: "active",
      subscription: subscription(catalog().tiers[0], {
        paymentState: "suspended",
      }),
      nextRenewal: {
        tierId: "alakazam_25",
        amountMinor: 2500,
        currency: "USD",
        dueAt: "2026-09-02T12:00:00.000Z",
        state: "scheduled",
      },
    }),
    account({
      state: "active",
      subscription: subscription(catalog().tiers[0], {
        currentPeriod: {
          startsAt: "2026-08-02",
          endsAt: "2026-09-02T12:00:00.000Z",
        },
      }),
      nextRenewal: {
        tierId: "alakazam_25",
        amountMinor: 2500,
        currency: "USD",
        dueAt: "2026-09-02T12:00:00.000Z",
        state: "scheduled",
      },
    }),
    account({
      receipts: [{
        receiptId: "in_provider_identity",
        kind: "start_payment",
        subtotalMinor: 2500,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 2500,
        currency: "USD",
        settledAt: "2026-08-02T12:03:00.000Z",
        invoiceAvailable: true,
      }],
    }),
    {
      ...source,
      receipts: [{
        receiptId:
          "40000000-0000-4000-8000-000000000001",
        kind: "start_payment",
        subtotalMinor: 2500,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 2500,
        currency: "USD",
        settledAt: "2026-08-02T12:03:00.000Z",
        invoiceAvailable: true,
        providerId: "in_should_not_reach_the_panel",
      }],
    },
  ]) {
    assert.equal(
      customerControl.verifiedAlakazamAccount(
        changed,
        PROJECT_ID
      ),
      null
    );
  }
});

test("the panel source declares the responsive, accessible, retry-safe quote acceptance contract", async () => {
  const source = await readFile(
    new URL(
      "../../abracadabra/app/abracadabra-customer-control-dom.js",
      import.meta.url
    ),
    "utf8"
  );
  const css = await readFile(
    new URL(
      "../../abracadabra/app/abracadabra-app.css",
      import.meta.url
    ),
    "utf8"
  );
  const panelStart = source.indexOf(
    "function renderAlakazamQuoteReview"
  );
  const panelEnd = source.indexOf(
    "function fragmentToken",
    panelStart
  );
  const panelSource = source.slice(panelStart, panelEnd);
  const quoteRequestStart = source.indexOf(
    "function requestAlakazamQuote"
  );
  const checkoutRequestStart = source.indexOf(
    "function requestAlakazamCheckout",
    quoteRequestStart
  );
  const downgradeRequestStart = source.indexOf(
    "function requestAlakazamDowngrade",
    checkoutRequestStart
  );
  const accountRenderStart = source.indexOf(
    "function renderAlakazamAccount",
    downgradeRequestStart
  );
  const quoteRequestSource = source.slice(
    quoteRequestStart,
    checkoutRequestStart
  );
  const checkoutRequestSource = source.slice(
    checkoutRequestStart,
    downgradeRequestStart
  );
  const downgradeRequestSource = source.slice(
    downgradeRequestStart,
    accountRenderStart
  );

  assert.ok(panelStart >= 0 && panelEnd > panelStart);
  assert.ok(
    quoteRequestStart >= 0
      && checkoutRequestStart > quoteRequestStart
      && downgradeRequestStart > checkoutRequestStart
      && accountRenderStart > checkoutRequestStart
  );
  assert.match(source, /client\s*\.getAlakazamAccount\(selectedProjectId\)/u);
  assert.match(source, /sequence === alakazamReadSequence/u);
  assert.match(source, /sequence === alakazamCommandSequence/u);
  assert.match(source, /idOf\(lastState\.project\) === projectId/u);
  assert.match(source, /client\.createAlakazamQuote\(/u);
  assert.match(source, /client\.createAlakazamCheckout\(/u);
  assert.match(source, /client\.scheduleAlakazamDowngrade\(/u);
  assert.match(source, /acceptedDisclosureDigest:\s*quote\.disclosureDigest/u);
  assert.match(source, /idempotencyKey:\s*commandId/u);
  assert.match(panelSource, /aria-labelledby/u);
  assert.match(panelSource, /aria-live/u);
  assert.match(panelSource, /aria-busy/u);
  assert.match(panelSource, /data-alakazam-retry/u);
  assert.match(panelSource, /data-alakazam-quote-tier/u);
  assert.match(panelSource, /data-alakazam-quote-review/u);
  assert.match(panelSource, /data-alakazam-accept/u);
  assert.match(panelSource, /data-alakazam-checkout/u);
  assert.match(panelSource, /data-alakazam-schedule-downgrade/u);
  assert.match(
    panelSource,
    /data-alakazam-downgrade-confirmation/u
  );
  assert.match(panelSource, /focusStatus/u);
  assert.match(
    panelSource,
    /Downgrade scheduled\. Updated billing details could not be loaded\./u
  );
  assert.match(panelSource, /checkbox\.checked === true/u);
  assert.match(
    panelSource,
    /quoteButton\.disabled\s*=[\s\S]*capabilities\.alakazamQuote !== true/u
  );
  assert.match(
    panelSource,
    /command\.phase === "scheduled"/u
  );
  assert.match(panelSource, /No account, payment, or plan data was changed/u);
  assert.match(panelSource, /Change tier options/u);
  assert.match(panelSource, /Available Alakazam tier changes/u);
  assert.match(panelSource, /Review the exact upgrade quote/u);
  assert.match(panelSource, /Current plan credit/u);
  assert.match(panelSource, /difference due now and the new monthly renewal/u);
  assert.match(
    panelSource,
    /After difference payment and subscription confirmation/u
  );
  assert.match(panelSource, /Review the exact downgrade schedule/u);
  assert.match(panelSource, /Cash refund now/u);
  assert.match(panelSource, /no charge and no proration/u);
  assert.match(panelSource, /current tier stays active until then/u);
  assert.match(panelSource, /\$0 charged now, \$0 refunded now/u);
  assert.match(
    panelSource,
    /scheduling is not open yet/u
  );
  assert.match(source, /Tier changes and billing management are not available/u);
  assert.match(source, /Subscription checkout is not open yet\. Nothing can be charged/u);
  assert.match(
    source,
    /alakazamQuote:\s*false,\s*alakazamCheckout:\s*false,\s*alakazamDowngrade:\s*false/u
  );
  assert.match(source, /windowRef\.location\.assign\(destination\)/u);
  assert.match(
    source,
    /No second Schedule request was sent\./u
  );
  assert.match(
    source,
    /subscription quote expired[\s\S]*Request a fresh quote/iu
  );
  assert.match(
    quoteRequestSource,
    /expectedAlakazamQuoteChange\(\s*account,\s*tierId\s*\)/u
  );
  assert.match(
    quoteRequestSource,
    /capabilities\.alakazamQuote !== true/u
  );
  assert.match(
    quoteRequestSource,
    /\{ targetTierId: tierId \}/u
  );
  assert.ok(
    quoteRequestSource.indexOf(
      "capabilities.alakazamQuote !== true"
    ) < quoteRequestSource.indexOf(
      "client.createAlakazamQuote("
    )
  );
  assert.ok(
    checkoutRequestSource.indexOf(
      "capabilities.alakazamCheckout !== true"
    ) < checkoutRequestSource.indexOf(
      "client.createAlakazamCheckout("
    )
  );
  assert.ok(
    downgradeRequestSource.indexOf(
      "capabilities.alakazamDowngrade !== true"
    ) < downgradeRequestSource.indexOf(
      "client.scheduleAlakazamDowngrade("
    )
  );
  assert.match(
    downgradeRequestSource,
    /refreshAlakazamAccountAfterDowngrade\(/u
  );
  assert.match(
    downgradeRequestSource,
    /alakazamPanel\.focusStatus\(\)/u
  );
  assert.doesNotMatch(
    downgradeRequestSource,
    /return requestAlakazamAccount\(projectId\)/u
  );
  assert.doesNotMatch(
    quoteRequestSource.slice(
      quoteRequestSource.indexOf(
        "client.createAlakazamQuote("
      ),
      quoteRequestSource.indexOf(").then")
    ),
    /currentTierId|amountMinor|renewal|subscription|provider|effectiveAt/u
  );
  assert.doesNotMatch(
    checkoutRequestSource,
    /alakazamRead\s*=|presentation\.account\s*=|subscription\s*=/u
  );
  assert.doesNotMatch(
    downgradeRequestSource.slice(
      downgradeRequestSource.indexOf(
        "client.scheduleAlakazamDowngrade("
      ),
      downgradeRequestSource.indexOf(").then")
    ),
    /amountMinor|currentTierId|targetTierId|subscriptionId|provider|effectiveAt|refund|proration/iu
  );
  assert.doesNotMatch(
    downgradeRequestSource,
    /createAlakazamCheckout|location\.assign/u
  );
  assert.doesNotMatch(
    panelSource,
    /billingPortal|cancelSubscription|createCommerceCheckout|prepareDownloadCheckout/u
  );
  assert.doesNotMatch(
    source,
    /(?:localStorage|sessionStorage).*alakazam|alakazam.*(?:localStorage|sessionStorage)/iu
  );
  assert.match(css, /\.customer-alakazam-account/u);
  assert.match(
    css,
    /customer-alakazam-facts[^}]*grid-template-columns:1fr/u
  );
  assert.match(css, /customer-alakazam-quote-review/u);
  assert.match(css, /customer-alakazam-acceptance/u);
});
