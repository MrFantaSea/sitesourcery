import assert from "node:assert/strict";
import test from "node:test";

import {
  ENTITLEMENT_SCHEMA,
  OFFER_IDS,
  PRIVATE_CATALOG_SCHEMA,
  QUOTE_SNAPSHOT_SCHEMA,
  authorizeProjectEntitlement,
  createCommerceV2Boundary,
  createCommerceV2Service,
  createMemoryCommerceV2Repository,
  digest,
  digestQuoteSnapshot,
  getPrivateHeldCatalog,
  resolveHeldOffer
} from "../index.mjs";

const NOW = "2026-07-30T16:00:00.000Z";
const PROJECT_A = "editor_project_a";
const PROJECT_B = "editor_project_b";
const VERSION_A1 = "version_a_1";
const VERSION_A2 = "version_a_2";
const VERSION_B1 = "version_b_1";
const SESSION = Object.freeze({
  tenantId: "tenant_a",
  customerId: "customer_a",
  actorId: "owner_a"
});

function createClock(initial = NOW) {
  let current = initial;
  return Object.freeze({
    now() {
      return current;
    },
    set(value) {
      current = value;
    }
  });
}

function createIds() {
  let sequence = 0;
  return Object.freeze({
    next(prefix) {
      sequence += 1;
      return `${prefix}_${sequence}`;
    }
  });
}

function fixture() {
  const repository = createMemoryCommerceV2Repository();
  const clock = createClock();
  const projects = [
    {
      ...SESSION,
      projectId: PROJECT_A,
      kind: "editor_project",
      purchaseEligible: true
    },
    {
      ...SESSION,
      projectId: PROJECT_B,
      kind: "editor_project",
      purchaseEligible: true
    }
  ];
  const versions = [
    {
      projectId: PROJECT_A,
      versionId: VERSION_A1,
      state: "accepted",
      contentDigest: "a".repeat(64)
    },
    {
      projectId: PROJECT_A,
      versionId: VERSION_A2,
      state: "accepted",
      contentDigest: "b".repeat(64)
    },
    {
      projectId: PROJECT_B,
      versionId: VERSION_B1,
      state: "accepted",
      contentDigest: "c".repeat(64)
    }
  ];
  const service = createCommerceV2Service({
    projects: {
      async resolveEditorProject({
        tenantId,
        customerId,
        projectId
      }) {
        return structuredClone(
          projects.find(
            (row) =>
              row.tenantId === tenantId &&
              row.customerId === customerId &&
              row.projectId === projectId
          ) ?? null
        );
      }
    },
    versions: {
      async resolveAcceptedVersion({
        projectId,
        versionId
      }) {
        return structuredClone(
          versions.find(
            (row) =>
              row.projectId === projectId &&
              row.versionId === versionId
          ) ?? null
        );
      }
    },
    repository,
    clock,
    ids: createIds()
  });
  return {
    boundary: createCommerceV2Boundary(service),
    clock,
    repository,
    service
  };
}

function quoteBody(overrides = {}) {
  return {
    projectId: PROJECT_A,
    versionId: VERSION_A1,
    offerId: "spark_download",
    commandId: "quote_command_a",
    ...overrides
  };
}

async function createQuote(
  context,
  overrides = {},
  session = SESSION
) {
  return context.boundary.execute({
    session,
    action: "quote",
    body: quoteBody(overrides)
  });
}

async function prepareCheckout(
  context,
  quote,
  overrides = {},
  session = SESSION
) {
  return context.boundary.execute({
    session,
    action: "prepare_checkout",
    body: {
      projectId: quote.project.projectId,
      quoteId: quote.quoteId,
      acceptedDisclosureDigest:
        quote.disclosureDigest,
      commandId: "checkout_command_a",
      ...overrides
    }
  });
}

test("private held catalog defines only the action-based Spark offers", () => {
  const catalog = getPrivateHeldCatalog();
  assert.equal(catalog.schema, PRIVATE_CATALOG_SCHEMA);
  assert.equal(catalog.visibility, "private");
  assert.equal(catalog.state, "held");
  assert.equal(catalog.providerEffectsAuthorized, false);
  assert.deepEqual(
    catalog.offers.map((offer) => offer.offerId),
    OFFER_IDS
  );
  assert.deepEqual(
    catalog.offers.map(
      (offer) => offer.price.amountMinor
    ),
    [500, 1500, 3000]
  );
  assert.deepEqual(
    catalog.offers.map(
      (offer) => offer.price.billing
    ),
    ["one_time", "recurring", "recurring"]
  );
  assert.deepEqual(
    catalog.offers.map(
      (offer) => offer.commercialStatus
    ),
    ["owner_accepted", "provisional", "provisional"]
  );
  assert.equal(
    catalog.offers[0].entitlement.acceptanceCadence,
    "once_per_editor_project"
  );
  assert.equal(
    catalog.offers[0].entitlement.consumable,
    false
  );
  assert.equal(
    catalog.offers[0].entitlement.expires,
    false
  );
  assert.ok(
    catalog.offers.every(
      (offer) =>
        offer.effects.state === "held" &&
        offer.effects.dispatchAuthorized === false &&
        offer.effects.provider === null
    )
  );
  assert.equal(
    JSON.stringify(catalog).includes("assisted"),
    false
  );
  assert.equal(
    JSON.stringify(catalog).toLowerCase().includes("stripe"),
    false
  );
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog.offers[0]), true);
});

test("v2 resolves action IDs without reinterpreting v1 tenures", () => {
  assert.equal(
    resolveHeldOffer("spark_download").entitlement.kind,
    "spark_download"
  );
  for (const legacyId of [
    "rent",
    "own",
    "owned_managed",
    "spark.rent.2026-test",
    "spark.own"
  ]) {
    assert.throws(
      () => resolveHeldOffer(legacyId),
      (error) =>
        error.code === "legacy_tenure_rejected"
    );
  }
  assert.throws(
    () => resolveHeldOffer("assisted_launch"),
    (error) => error.code === "offer_unavailable"
  );
});

test("quote snapshot binds exact server money, project, version, disclosure, and entitlement", async () => {
  const context = fixture();
  const quote = await createQuote(context);
  assert.equal(quote.schema, QUOTE_SNAPSHOT_SCHEMA);
  assert.equal(quote.state, "held");
  assert.equal(quote.dispatchAuthorized, false);
  assert.equal(quote.project.projectId, PROJECT_A);
  assert.equal(quote.version.versionId, VERSION_A1);
  assert.equal(
    quote.version.contentDigest,
    "a".repeat(64)
  );
  assert.equal(quote.offerId, "spark_download");
  assert.equal(
    quote.entitlementKind,
    "spark_download"
  );
  assert.deepEqual(quote.price, {
    amountMinor: 500,
    currency: "USD",
    billing: "one_time",
    interval: null
  });
  assert.equal(
    quote.disclosure.entitlement.scope,
    "editor_project"
  );
  assert.equal(
    quote.disclosure.entitlement.acceptanceCadence,
    "once_per_editor_project"
  );
  assert.equal(
    quote.disclosureDigest,
    digest(quote.disclosure)
  );
  assert.equal(
    quote.snapshotDigest,
    digestQuoteSnapshot(quote)
  );
  assert.equal(
    JSON.stringify(quote).toLowerCase().includes("stripe"),
    false
  );
  assert.equal(Object.isFrozen(quote), true);
  const stored = context.repository.inspect();
  assert.equal(stored.quotes.length, 1);
  assert.equal(stored.commands.length, 1);
});

test("publish quote snapshots retain provisional monthly price and distinct entitlement kinds", async () => {
  for (const [
    offerId,
    amountMinor,
    entitlementKind
  ] of [
    ["spark_publish", 1500, "spark_publish"],
    [
      "spark_publish_help",
      3000,
      "spark_publish_help"
    ]
  ]) {
    const context = fixture();
    const quote = await createQuote(context, {
      offerId,
      commandId: `quote_${offerId}`
    });
    assert.equal(
      quote.disclosure.offer.commercialStatus,
      "provisional"
    );
    assert.deepEqual(quote.price, {
      amountMinor,
      currency: "USD",
      billing: "recurring",
      interval: "month"
    });
    assert.equal(
      quote.entitlementKind,
      entitlementKind
    );
    assert.equal(
      quote.disclosure.release.state,
      "held"
    );
    assert.equal(
      quote.disclosure.release
        .providerEffectsAuthorized,
      false
    );
  }
});

test("quote command replays exactly and conflicts on a changed purpose", async () => {
  const context = fixture();
  const first = await createQuote(context);
  const replay = await createQuote(context);
  assert.deepEqual(replay, first);
  await assert.rejects(
    createQuote(context, {
      offerId: "spark_publish"
    }),
    (error) => error.code === "idempotency_conflict"
  );
  const stored = context.repository.inspect();
  assert.equal(stored.quotes.length, 1);
  assert.equal(stored.commands.length, 1);
});

test("customer boundary recursively rejects client money, provider, and entitlement authority", async () => {
  const context = fixture();
  for (const injected of [
    { amountMinor: 1 },
    { currency: "USD" },
    { price: { amountMinor: 500 } },
    { metadata: { priceId: "price_attacker" } },
    { provider: "stripe" },
    { entitlementKind: "spark_download" }
  ]) {
    await assert.rejects(
      context.boundary.execute({
        session: SESSION,
        action: "quote",
        body: {
          ...quoteBody({
            commandId:
              `client_authority_${Object.keys(injected)[0]}`
          }),
          ...injected
        }
      }),
      (error) =>
        error.code ===
        "client_commerce_authority_rejected"
    );
  }
  assert.equal(
    context.repository.inspect().quotes.length,
    0
  );
});

test("customer boundary rejects old tenure fields and values", async () => {
  const context = fixture();
  for (const body of [
    quoteBody({ offerId: "rent" }),
    quoteBody({ offerId: "spark.rent.2026-test" }),
    {
      ...quoteBody(),
      tenureId: "own"
    },
    {
      ...quoteBody(),
      metadata: { tenure: "owned_managed" }
    }
  ]) {
    await assert.rejects(
      context.boundary.execute({
        session: SESSION,
        action: "quote",
        body
      }),
      (error) =>
        error.code === "legacy_tenure_rejected"
    );
  }
  assert.equal(
    context.repository.inspect().quotes.length,
    0
  );
});

test("quote creation rejects a version from another editor project", async () => {
  const context = fixture();
  await assert.rejects(
    createQuote(context, {
      versionId: VERSION_B1
    }),
    (error) => error.code === "version_unavailable"
  );
  assert.equal(
    context.repository.inspect().quotes.length,
    0
  );
  assert.equal(
    context.repository.inspect().commands.length,
    0
  );
});

test("checkout preparation is exact, idempotent, provider-neutral, and held", async () => {
  const context = fixture();
  const quote = await createQuote(context);
  const first = await prepareCheckout(context, quote);
  const replay = await prepareCheckout(context, quote);
  assert.deepEqual(replay, first);
  assert.equal(first.state, "held");
  assert.equal(first.dispatchAuthorized, false);
  assert.equal(first.provider, null);
  assert.equal(
    first.holdReason,
    "provider_dispatch_not_authorized"
  );
  assert.equal(first.projectId, PROJECT_A);
  assert.equal(first.versionId, VERSION_A1);
  assert.equal(first.offerId, "spark_download");
  assert.equal(
    first.entitlementKind,
    "spark_download"
  );
  assert.deepEqual(first.purpose.price, {
    amountMinor: 500,
    currency: "USD",
    billing: "one_time",
    interval: null
  });
  assert.equal(
    first.purpose.quoteSnapshotDigest,
    quote.snapshotDigest
  );
  assert.equal(
    first.purpose.acceptedDisclosureDigest,
    quote.disclosureDigest
  );
  assert.equal(first.purposeDigest, digest(first.purpose));
  assert.equal(
    JSON.stringify(first).toLowerCase().includes("stripe"),
    false
  );
  const stored = context.repository.inspect();
  assert.equal(stored.checkoutPreparations.length, 1);
  assert.equal(stored.commands.length, 2);
});

test("checkout preparation rejects disclosure drift and expired quotes before command claim", async () => {
  const context = fixture();
  const quote = await createQuote(context);
  await assert.rejects(
    prepareCheckout(context, quote, {
      acceptedDisclosureDigest: "f".repeat(64)
    }),
    (error) => error.code === "disclosure_mismatch"
  );
  context.clock.set("2026-07-30T16:31:00.000Z");
  await assert.rejects(
    prepareCheckout(context, quote, {
      commandId: "checkout_expired"
    }),
    (error) => error.code === "quote_expired"
  );
  const stored = context.repository.inspect();
  assert.equal(stored.checkoutPreparations.length, 0);
  assert.equal(stored.commands.length, 1);
});

test("quotes and checkout command IDs cannot cross editor projects", async () => {
  const context = fixture();
  const quoteA = await createQuote(context);
  await assert.rejects(
    prepareCheckout(context, quoteA, {
      projectId: PROJECT_B
    }),
    (error) => error.code === "quote_unavailable"
  );

  const checkoutA = await prepareCheckout(
    context,
    quoteA
  );
  assert.equal(checkoutA.projectId, PROJECT_A);
  const quoteB = await createQuote(context, {
    projectId: PROJECT_B,
    versionId: VERSION_B1,
    commandId: "quote_command_b"
  });
  await assert.rejects(
    prepareCheckout(context, quoteB, {
      projectId: PROJECT_B,
      commandId: "checkout_command_a"
    }),
    (error) => error.code === "idempotency_conflict"
  );
  assert.equal(
    context.repository.inspect()
      .checkoutPreparations.length,
    1
  );
});

test("download entitlement is non-consuming across repeat clicks and accepted versions in one project", async () => {
  const context = fixture();
  const quote = await createQuote(context);
  const entitlement = Object.freeze({
    schema: ENTITLEMENT_SCHEMA,
    entitlementId: "entitlement_download_a",
    tenantId: SESSION.tenantId,
    customerId: SESSION.customerId,
    projectId: PROJECT_A,
    kind: "spark_download",
    scope: "editor_project",
    state: "active",
    activatedAt: NOW,
    expiresAt: null,
    acceptedDisclosureDigest:
      quote.disclosureDigest
  });
  const request = {
    tenantId: SESSION.tenantId,
    customerId: SESSION.customerId,
    projectId: PROJECT_A,
    versionId: VERSION_A1,
    versionProjectId: PROJECT_A,
    action: "download_accepted_project_version"
  };
  const first = authorizeProjectEntitlement(
    entitlement,
    request
  );
  const repeat = authorizeProjectEntitlement(
    entitlement,
    request
  );
  assert.deepEqual(repeat, first);
  assert.equal(first.authorized, true);
  assert.equal(first.consumed, false);

  const laterVersion =
    authorizeProjectEntitlement(entitlement, {
      ...request,
      versionId: VERSION_A2
    });
  assert.equal(laterVersion.authorized, true);
  assert.equal(laterVersion.consumed, false);

  const selfHost =
    authorizeProjectEntitlement(entitlement, {
      ...request,
      action:
        "self_host_accepted_project_version"
    });
  assert.equal(selfHost.authorized, true);
  assert.equal(selfHost.consumed, false);
});

test("download entitlement hides cross-project and foreign-version reuse", async () => {
  const entitlement = {
    schema: ENTITLEMENT_SCHEMA,
    entitlementId: "entitlement_download_a",
    tenantId: SESSION.tenantId,
    customerId: SESSION.customerId,
    projectId: PROJECT_A,
    kind: "spark_download",
    scope: "editor_project",
    state: "active",
    activatedAt: NOW,
    expiresAt: null,
    acceptedDisclosureDigest: "a".repeat(64)
  };
  const base = {
    tenantId: SESSION.tenantId,
    customerId: SESSION.customerId,
    projectId: PROJECT_A,
    versionId: VERSION_A1,
    versionProjectId: PROJECT_A,
    action: "download_accepted_project_version"
  };
  for (const request of [
    {
      ...base,
      projectId: PROJECT_B,
      versionProjectId: PROJECT_B
    },
    {
      ...base,
      versionId: VERSION_B1,
      versionProjectId: PROJECT_B
    },
    {
      ...base,
      action: "publish_accepted_project_version"
    }
  ]) {
    assert.throws(
      () =>
        authorizeProjectEntitlement(
          entitlement,
          request
        ),
      (error) =>
        error.code === "entitlement_unavailable" &&
        error.status === 404
    );
  }
});
