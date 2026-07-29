import assert from "node:assert/strict";
import test from "node:test";

import {
  createAbracadabraCommerceService,
  createCommerceAccountBoundary,
  createFakeApprovedCatalog,
  createFakeCatalogPort,
  createFakeClock,
  createFakeDomainQuotePort,
  createFakeIds,
  createFakeProjectPort,
  createFakeStripeAdapter,
  createHeldCatalogPort,
  createHeldStripeAdapter,
  createMemoryCommerceRepository,
  validateOfferCatalog
} from "../index.mjs";

const DOMAIN_QUOTE = Object.freeze({
  id: "domain_quote_1",
  tenantId: "tenant_a",
  customerId: "customer_a",
  projectId: "project_a",
  kind: "registration",
  domain: "example.com",
  label: "example.com registration — first year",
  amount: { amountMinor: 1499, currency: "USD" },
  expiresAt: "2026-07-28T12:45:00.000Z",
  terms: {
    renewal: "Domain renewal is a separate annual charge shown before renewal.",
    cancellation: "Registration cannot be canceled after registrar submission.",
    ownership: "The customer is the registrant and beneficial owner.",
    hosting: "Domain registration does not include website hosting."
  },
  stripePriceData: {
    currency: "usd",
    unitAmount: 1499,
    productKey: "domain_registration"
  }
});

function fixture({
  catalog = createFakeApprovedCatalog(),
  stripe = createFakeStripeAdapter(),
  domains = [DOMAIN_QUOTE]
} = {}) {
  const repository = createMemoryCommerceRepository();
  const clock = createFakeClock();
  const ids = createFakeIds();
  const service = createAbracadabraCommerceService({
    catalog: createFakeCatalogPort(catalog),
    projects: createFakeProjectPort(),
    repository,
    domainQuotes: createFakeDomainQuotePort(domains),
    stripe,
    clock,
    ids
  });
  const boundary = createCommerceAccountBoundary(service);
  const session = {
    tenantId: "tenant_a",
    customerId: "customer_a",
    actorId: "actor_a"
  };
  return { boundary, clock, ids, repository, service, session, stripe };
}

async function quote(context, body = {}) {
  return context.boundary.execute({
    session: context.session,
    action: "quote",
    body: {
      offerId: "spark.owned_managed.2026-test",
      projectId: "project_a",
      commandId: "quote-command-1",
      ...body
    }
  });
}

test("approved catalog keeps two independent axes but sells only implemented explicit pairs", () => {
  const catalog = validateOfferCatalog(createFakeApprovedCatalog());
  assert.deepEqual(catalog.products.map((row) => row.productId), ["business", "presence", "spark"]);
  assert.deepEqual(catalog.tenures.map((row) => row.tenureId), ["rent", "own", "owned_managed"]);
  assert.equal(catalog.offers.length, 3);
  assert.equal(
    new Set(catalog.offers.map((row) => `${row.productId}:${row.tenureId}`)).size,
    3
  );
  assert.deepEqual([...new Set(catalog.offers.map((row) => row.productId))], ["spark"]);
  assert.equal(
    catalog.products.find((row) => row.productId === "spark").implementationContract,
    "abracadabra.spark/v1"
  );
});

test("approved catalog allows a subset but rejects held or unimplemented products", () => {
  const subset = createFakeApprovedCatalog();
  subset.offers.pop();
  assert.equal(validateOfferCatalog(subset).offers.length, 2);
  const unimplemented = createFakeApprovedCatalog();
  unimplemented.offers.push({
    ...unimplemented.offers[0],
    offerId: "business.rent.attacker",
    productId: "business"
  });
  assert.throws(
    () => validateOfferCatalog(unimplemented),
    (error) => error.code === "invalid_catalog" && /unimplemented product/.test(error.message)
  );
  assert.throws(
    () => validateOfferCatalog({ ...createFakeApprovedCatalog(), state: "hold" }),
    (error) => error.code === "catalog_unavailable" && error.status === 503
  );
});

test("browser-safe catalog exposes pair IDs but no prices, amounts, terms, or Stripe references", async () => {
  const { boundary, session } = fixture();
  const result = await boundary.execute({ session, action: "catalog", body: {} });
  assert.equal(result.offers.length, 3);
  assert.deepEqual(result.products.map((row) => row.productId), ["spark"]);
  assert.equal(result.products[0].implementationContract, "abracadabra.spark/v1");
  assert.deepEqual(Object.keys(result.offers[0]).sort(), ["offerId", "productId", "tenureId"]);
  assert.equal(JSON.stringify(result).includes("stripe"), false);
  assert.equal(JSON.stringify(result).includes("amountMinor"), false);
  assert.equal(JSON.stringify(result).includes("price_fake"), false);
});

test("held catalog prevents quote publication", async () => {
  const context = fixture();
  const service = createAbracadabraCommerceService({
    catalog: createHeldCatalogPort(),
    projects: createFakeProjectPort(),
    repository: context.repository,
    domainQuotes: createFakeDomainQuotePort(),
    stripe: context.stripe,
    clock: context.clock,
    ids: context.ids
  });
  await assert.rejects(service.getCatalog(), (error) => error.code === "catalog_unavailable");
});

test("known but unimplemented Business and Presence products cannot be quoted", async () => {
  const context = fixture();
  for (const offerId of ["business.rent.2026-test", "presence.own.2026-test"]) {
    await assert.rejects(
      quote(context, { offerId, commandId: `held-${offerId}` }),
      (error) => error.code === "offer_unavailable"
    );
  }
  assert.equal(context.stripe.inspectCalls().length, 0);
});

test("authoritative quote discloses exact one-time and recurring amounts and tenure terms", async () => {
  const context = fixture();
  const result = await quote(context);
  assert.equal(result.offerId, "spark.owned_managed.2026-test");
  assert.equal(result.projectId, "project_a");
  assert.equal(result.product.productId, "spark");
  assert.equal(result.tenure.tenureId, "owned_managed");
  assert.deepEqual(result.lineItems[0].oneTime, { amountMinor: 35000, currency: "USD" });
  assert.deepEqual(result.lineItems[0].recurring, {
    amountMinor: 32500,
    currency: "USD",
    interval: "month"
  });
  assert.match(result.lineItems[0].terms.ownership, /ownership transfers/u);
  assert.match(result.lineItems[0].terms.hosting, /managed hosting/u);
  assert.equal(result.lineItems[0].terms.paymentGraceDays, 14);
  assert.equal(result.lineItems[0].terms.retentionAndExportDays, 90);
  assert.equal(typeof result.disclosureDigest, "string");
  assert.equal(JSON.stringify(result).includes("price_fake"), false);
  assert.equal(JSON.stringify(result).includes("checkoutAuthority"), false);
});

test("optional domain is a separate line and receipt group in one quote", async () => {
  const context = fixture();
  const result = await quote(context, { domainQuoteId: "domain_quote_1" });
  assert.equal(result.lineItems.length, 2);
  assert.deepEqual(result.lineItems.map((row) => row.kind), [
    "abracadabra_product",
    "domain_registration"
  ]);
  assert.equal(result.receiptGroups.length, 2);
  assert.notEqual(result.receiptGroups[0].receiptGroupId, result.receiptGroups[1].receiptGroupId);
  assert.deepEqual(result.lineItems[1].oneTime, { amountMinor: 1499, currency: "USD" });
  assert.equal(result.lineItems[1].domain, "example.com");
  assert.equal(result.totals.oneTime.amountMinor, 36499);
  assert.deepEqual(result.totals.recurring, [
    { amountMinor: 32500, currency: "USD", interval: "month" }
  ]);
});

test("expired and cross-tenant domain quote resolution fails closed without leaking it", async () => {
  const context = fixture();
  context.clock.set("2026-07-28T12:50:00.000Z");
  await assert.rejects(
    quote(context, { domainQuoteId: "domain_quote_1" }),
    (error) => error.code === "domain_quote_expired"
  );
  const crossTenant = fixture({
    domains: [{ ...DOMAIN_QUOTE, tenantId: "tenant_b" }]
  });
  await assert.rejects(
    quote(crossTenant, { domainQuoteId: "domain_quote_1" }),
    (error) => error.code === "domain_quote_unavailable"
  );
});

test("domain checkout authority must exactly match the disclosed domain amount", async () => {
  const context = fixture({
    domains: [
      {
        ...DOMAIN_QUOTE,
        stripePriceData: { ...DOMAIN_QUOTE.stripePriceData, unitAmount: 1 }
      }
    ]
  });
  await assert.rejects(
    quote(context, { domainQuoteId: "domain_quote_1" }),
    (error) => error.code === "domain_quote_unavailable"
  );
});

test("browser boundary recursively rejects client money and price authority", async () => {
  const context = fixture();
  for (const injected of [
    { priceId: "price_attacker" },
    { amountMinor: 1 },
    { currency: "USD" },
    { lineItems: [] },
    { metadata: { stripePriceRefs: { recurring: "price_attacker" } } }
  ]) {
    await assert.rejects(
      context.boundary.execute({
        session: context.session,
        action: "quote",
        body: {
          offerId: "spark.rent.2026-test",
          commandId: `attack-${Object.keys(injected)[0]}`,
          ...injected
        }
      }),
      (error) =>
        error.code === "client_price_authority_rejected" ||
        (Object.keys(injected)[0] === "metadata" && error.code === "client_price_authority_rejected")
    );
  }
});

test("trusted session tenant/customer authority overrides nothing because authority fields are rejected", async () => {
  const context = fixture();
  await assert.rejects(
    context.boundary.execute({
      session: context.session,
      action: "quote",
      body: {
        offerId: "spark.rent.2026-test",
        commandId: "tenant-attack",
        tenantId: "tenant_b"
      }
    }),
    (error) => error.code === "invalid_input"
  );
});

test("quote idempotency replays same purpose and rejects command reuse for another offer", async () => {
  const context = fixture();
  const first = await quote(context);
  const replay = await quote(context);
  assert.deepEqual(replay, first);
  await assert.rejects(
    quote(context, { offerId: "spark.rent.2026-test" }),
    (error) => error.code === "idempotency_conflict"
  );
});

test("checkout consumes only quote identity and accepted disclosure, while Stripe gets server authority", async () => {
  const context = fixture();
  const authoritative = await quote(context, { domainQuoteId: "domain_quote_1" });
  const result = await context.boundary.execute({
    session: context.session,
    action: "checkout",
    body: {
      quoteId: authoritative.quoteId,
      projectId: "project_a",
      acceptedDisclosureDigest: authoritative.disclosureDigest,
      commandId: "checkout-command-1"
    }
  });
  assert.equal(result.status, "checkout_ready");
  assert.match(result.checkout.url, /^https:\/\/checkout\.example\.invalid/u);
  const [call] = context.stripe.inspectCalls();
  assert.equal(call.purpose.offerId, authoritative.offerId);
  assert.deepEqual(call.purpose.lines[0].authority.refs, {
    oneTime: "price_fake_spark_owned_managed_oneTime",
    recurring: "price_fake_spark_owned_managed_recurring"
  });
  assert.equal(call.purpose.lines[1].authority.type, "server_price_data");
  assert.equal(call.purpose.lines[1].authority.priceData.unitAmount, 1499);
  assert.deepEqual(call.purpose.lines[1].amounts.oneTime, {
    amountMinor: 1499,
    currency: "USD"
  });
  assert.equal(JSON.stringify(result).includes("price_fake"), false);
  assert.equal(JSON.stringify(result).includes("stripePrice"), false);
});

test("checkout requires exact disclosed digest and a ready payment adapter before durable dispatch", async () => {
  const context = fixture({ stripe: createHeldStripeAdapter() });
  const authoritative = await quote(context);
  await assert.rejects(
    context.boundary.execute({
      session: context.session,
      action: "checkout",
      body: {
        quoteId: authoritative.quoteId,
        projectId: "project_a",
        acceptedDisclosureDigest: "wrong",
        commandId: "checkout-wrong-digest"
      }
    }),
    (error) => error.code === "quote_acceptance_mismatch"
  );
  await assert.rejects(
    context.boundary.execute({
      session: context.session,
      action: "checkout",
      body: {
        quoteId: authoritative.quoteId,
        projectId: "project_a",
        acceptedDisclosureDigest: authoritative.disclosureDigest,
        commandId: "checkout-held"
      }
    }),
    (error) => error.code === "checkout_unavailable" && error.status === 503
  );
  const stored = await context.repository.inspect({
    tenantId: context.session.tenantId,
    quoteId: authoritative.quoteId
  });
  assert.equal(stored.state, "quoted");
});

test("checkout is purpose-bound, idempotent, and produces atomic audit/outbox state", async () => {
  const context = fixture();
  const authoritative = await quote(context);
  const request = {
    session: context.session,
    action: "checkout",
    body: {
      quoteId: authoritative.quoteId,
      projectId: "project_a",
      acceptedDisclosureDigest: authoritative.disclosureDigest,
      commandId: "checkout-replay"
    }
  };
  const first = await context.boundary.execute(request);
  const replay = await context.boundary.execute(request);
  assert.deepEqual(replay, first);
  assert.equal(context.stripe.inspectCalls().length, 1);
  const audit = await context.repository.listAudit({
    tenantId: context.session.tenantId,
    quoteId: authoritative.quoteId
  });
  const outbox = await context.repository.listOutbox({ tenantId: context.session.tenantId });
  assert.deepEqual(audit.map((row) => row.eventType), [
    "commerce.quote_created",
    "commerce.checkout_dispatching",
    "commerce.checkout_ready"
  ]);
  assert.deepEqual(
    outbox.map((row) => row.outboxId).sort(),
    audit.map((row) => row.eventId).sort()
  );
});

test("ambiguous Stripe outcome stays dispatching and is never automatically retried", async () => {
  const stripe = createFakeStripeAdapter({ ambiguous: true });
  const context = fixture({ stripe });
  const authoritative = await quote(context);
  const request = {
    session: context.session,
    action: "checkout",
    body: {
      quoteId: authoritative.quoteId,
      projectId: "project_a",
      acceptedDisclosureDigest: authoritative.disclosureDigest,
      commandId: "checkout-ambiguous"
    }
  };
  await assert.rejects(context.boundary.execute(request), (error) => error.code === "fake_timeout");
  await assert.rejects(context.boundary.execute(request), (error) => error.code === "command_in_progress");
  assert.equal(stripe.inspectCalls().length, 1);
  const stored = await context.repository.inspect({
    tenantId: context.session.tenantId,
    quoteId: authoritative.quoteId
  });
  assert.equal(stored.state, "checkout_dispatching");
});

test("tenant isolation hides another customer's quote", async () => {
  const context = fixture();
  const authoritative = await quote(context);
  await assert.rejects(
    context.boundary.execute({
      session: { ...context.session, customerId: "customer_b" },
      action: "get_quote",
      body: { projectId: "project_a", quoteId: authoritative.quoteId }
    }),
    (error) => error.code === "quote_not_found" && error.status === 404
  );
  await assert.rejects(
    context.boundary.execute({
      session: { ...context.session, tenantId: "tenant_b" },
      action: "get_quote",
      body: { projectId: "project_a", quoteId: authoritative.quoteId }
    }),
    (error) => error.code === "quote_not_found" && error.status === 404
  );
});

test("quote and checkout cannot cross project boundaries", async () => {
  const context = fixture();
  const authoritative = await quote(context);
  await assert.rejects(
    context.boundary.execute({
      session: context.session,
      action: "get_quote",
      body: { projectId: "project_b", quoteId: authoritative.quoteId }
    }),
    (error) => error.code === "quote_not_found"
  );
  await assert.rejects(
    context.boundary.execute({
      session: context.session,
      action: "checkout",
      body: {
        projectId: "project_b",
        quoteId: authoritative.quoteId,
        acceptedDisclosureDigest: authoritative.disclosureDigest,
        commandId: "wrong-project-checkout"
      }
    }),
    (error) => error.code === "quote_not_found"
  );
});

test("quote creation requires a real purchasable project owned by the session customer", async () => {
  const context = fixture();
  await assert.rejects(
    quote(context, { projectId: "project_missing", commandId: "missing-project" }),
    (error) => error.code === "project_not_found" && error.status === 404
  );
});
