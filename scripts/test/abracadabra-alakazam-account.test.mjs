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
      start: false,
      changeTier: false,
      manageBilling: false,
      cancel: false,
      reason: "customer_commands_not_composed",
    },
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
      actions: { ...source.actions, start: true },
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

test("the panel source declares the responsive, accessible, read-only, and retry-safe contract", async () => {
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
    "function createAlakazamAccountPanel"
  );
  const panelEnd = source.indexOf(
    "function fragmentToken",
    panelStart
  );
  const panelSource = source.slice(panelStart, panelEnd);

  assert.ok(panelStart >= 0 && panelEnd > panelStart);
  assert.match(source, /client\s*\.getAlakazamAccount\(selectedProjectId\)/u);
  assert.match(source, /sequence === alakazamReadSequence/u);
  assert.match(source, /idOf\(lastState\.project\) === projectId/u);
  assert.match(panelSource, /aria-labelledby/u);
  assert.match(panelSource, /aria-live/u);
  assert.match(panelSource, /aria-busy/u);
  assert.match(panelSource, /data-alakazam-retry/u);
  assert.match(panelSource, /No account, payment, or plan data was changed/u);
  assert.match(source, /Plan changes and billing management are not available/u);
  assert.doesNotMatch(
    panelSource,
    /billingPortal|cancelSubscription|createCommerceCheckout|prepareDownloadCheckout/u
  );
  assert.equal(
    panelSource.match(/accountElement\(\s*documentRef,\s*"button"/gu)?.length,
    1,
    "the only Alakazam panel button is the safe GET retry"
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
});
