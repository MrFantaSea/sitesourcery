import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  configureHostedAbracadabraHtml,
  hostedStagingAssets,
} from "../configure-abracadabra-hosted-staging.mjs";

const require = createRequire(import.meta.url);
const modeModule = require("../../abracadabra/app/abracadabra-control-mode.js");
const { APIError, createClient } = require("../../abracadabra/app/abracadabra-api.js");
const {
  ControlError,
  createHostedControl,
} = require("../../abracadabra/app/abracadabra-hosted-control.js");
const {
  recoveryRequestOutcome,
} = require("../../abracadabra/app/abracadabra-hosted-control-dom.js");

function response(status, payload, requestId = "req_hosted") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (name.toLowerCase() === "content-type") return "application/json";
        if (name.toLowerCase() === "x-request-id") return requestId;
        return null;
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

function documentFixture(mode, catalog = {}) {
  return {
    querySelector(selector) {
      if (selector !== 'meta[name="sitesourcery-abracadabra-control-mode"]') return null;
      if (mode == null) return null;
      return { getAttribute: () => mode };
    },
    getElementById(id) {
      if (id !== "abracadabra-hosted-catalog") return null;
      return { textContent: JSON.stringify(catalog) };
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function baseApi(overrides = {}) {
  const project = {
    id: "project_1",
    name: "Hosted project",
    draft: { revision: 4, rawFacts: {} },
    versions: [],
  };
  return {
    me: async () => ({ user: { id: "user_1", email: "owner@example.com" } }),
    listOrganizations: async () => ({ organizations: [{ id: "org_1", name: "Owner org" }] }),
    listProjects: async () => ({ projects: [project] }),
    getProject: async (id) => ({ project: { ...project, id } }),
    subscription: async () => ({ subscription: { id: "sub_1", status: "inactive" } }),
    ...overrides,
  };
}

async function selectedControl(overrides = {}, options = {}) {
  const control = createHostedControl({
    api: baseApi(overrides),
    idempotencyFactory: options.idempotencyFactory || (() => "idem_test"),
    catalog: options.catalog,
  });
  await control.boot();
  await control.selectProject("project_1");
  return control;
}

test("control mode is server-configured, invalid or absent configuration holds, and catalog prices fail closed", () => {
  assert.equal(modeModule.resolve(documentFixture(null)).mode, "hold");
  assert.equal(modeModule.resolve(documentFixture("HOSTED")).mode, "hosted");
  assert.equal(modeModule.resolve(documentFixture("local-rehearsal")).localRehearsal, true);
  assert.equal(modeModule.resolve(documentFixture("query-string-hosted")).held, true);

  const configured = modeModule.resolve(documentFixture("hosted", {
    schema: "sitesourcery.abracadabra-public-catalog.v1",
    catalogVersion: "catalog_7",
    termsVersion: "terms_7",
    domainTermsVersion: "domain-terms-2026-07",
    products: {
      spark: {
        label: "Spark",
        summary: "One-page business site.",
        implementationContract: "abracadabra.spark/v1",
      },
      business: {
        label: "Business",
        summary: "Held because no compiler exists.",
        implementationContract: "abracadabra.business/v1",
      },
    },
    tenures: {
      rent: { label: "Rent", summary: "Monthly service." },
      own: { label: "Own", summary: "Customer owns the finished site." },
    },
    offers: {
      "spark.rent": {
        productId: "spark",
        tenureId: "rent",
        eligibleAddressModes: ["licensed", "customer_owned"],
      },
      "spark.own": {
        productId: "spark",
        tenureId: "own",
        eligibleAddressModes: ["customer_owned"],
      },
      "business.rent": {
        productId: "business",
        tenureId: "rent",
        eligibleAddressModes: ["licensed"],
      },
    },
  }));
  assert.equal(configured.catalog.catalogVersion, "catalog_7");
  assert.equal(configured.catalog.termsVersion, "terms_7");
  assert.equal(configured.catalog.domainTermsVersion, "domain-terms-2026-07");
  assert.deepEqual(Object.keys(configured.catalog.products), ["spark"]);
  assert.equal(
    configured.catalog.products.spark.implementationContract,
    "abracadabra.spark/v1",
  );
  assert.deepEqual(Object.keys(configured.catalog.tenures), ["rent", "own"]);
  assert.deepEqual(
    Object.keys(configured.catalog.offers),
    ["spark.rent", "spark.own"],
  );
  assert.equal(Object.hasOwn(configured.catalog.offers["spark.rent"], "priceId"), false);
  assert.deepEqual(
    configured.catalog.offers["spark.own"].eligibleAddressModes,
    ["customer_owned"],
  );
});

test("private staging injection selects hosted mode in strict script order without changing the held public artifact", async () => {
  const publicHtml = await readFile(
    new URL("../../abracadabra/app/index.html", import.meta.url),
    "utf8",
  );
  assert.match(
    publicHtml,
    /<meta name="sitesourcery-abracadabra-control-mode" content="hold">/u,
  );
  assert.match(publicHtml, /abracadabra-control-mode\.js/u);
  for (const asset of hostedStagingAssets) {
    if (asset.endsWith("abracadabra-control-mode.js")) continue;
    assert.doesNotMatch(publicHtml, new RegExp(asset, "u"));
  }

  const hosted = configureHostedAbracadabraHtml(publicHtml, {
    catalog: {
      schema: "sitesourcery.abracadabra-public-catalog.v1",
      catalogVersion: "catalog_staging_1",
      termsVersion: "terms-staging-1",
      domainTermsVersion: "domain-terms-staging-1",
      products: [
        {
          productId: "spark",
          name: "Spark",
          description: "One-page business site.",
          implementationContract: "abracadabra.spark/v1",
        },
      ],
      tenures: [
        { tenureId: "rent", name: "Rent", billingShape: { recurring: true } },
      ],
      offers: [
        {
          offerId: "spark.rent",
          productId: "spark",
          tenureId: "rent",
          eligibleAddressModes: ["licensed", "customer_owned"],
        },
      ],
    },
  });
  assert.match(
    hosted,
    /<meta name="sitesourcery-abracadabra-control-mode" content="hosted">/u,
  );
  assert.doesNotMatch(
    hosted,
    /<meta name="sitesourcery-abracadabra-control-mode" content="hold">/u,
  );
  const ordered = [
    "/abracadabra/app/abracadabra-control-mode.js",
    "/abracadabra/app/abracadabra-api.js",
    'id="abracadabra-hosted-catalog"',
    "/abracadabra/app/abracadabra-hosted-control.js",
    "/abracadabra/app/abracadabra-app.js",
    "/abracadabra/app/abracadabra-hosted-control-dom.js",
  ];
  let cursor = -1;
  for (const marker of ordered) {
    const next = hosted.indexOf(marker);
    assert.ok(next > cursor, marker);
    cursor = next;
  }
  assert.doesNotMatch(
    hosted,
    /\/abracadabra\/app\/abracadabra-control\.js/u,
    "the reviewed hosted fragment, not the generic configurator, adds the progressive control",
  );
  assert.match(hosted, /"domainTermsVersion":"domain-terms-staging-1"/u);
  const catalogJson = hosted.match(
    /<script id="abracadabra-hosted-catalog" type="application\/json">([^<]+)<\/script>/u,
  )[1];
  const browserCatalog = JSON.parse(catalogJson);
  assert.equal(browserCatalog.catalogVersion, "catalog_staging_1");
  assert.equal(
    browserCatalog.products.spark.implementationContract,
    "abracadabra.spark/v1",
  );
  assert.deepEqual(browserCatalog.offers["spark.rent"], {
    productId: "spark",
    tenureId: "rent",
    eligibleAddressModes: ["customer_owned", "licensed"],
  });
  assert.equal(Object.hasOwn(browserCatalog.offers["spark.rent"], "priceId"), false);
  assert.equal(Object.hasOwn(browserCatalog.offers["spark.rent"], "amountMinor"), false);
  assert.deepEqual(hostedStagingAssets, [...hostedStagingAssets].sort());
});

test("staging catalog configuration rejects every private price authority field", async () => {
  const publicHtml = await readFile(
    new URL("../../abracadabra/app/index.html", import.meta.url),
    "utf8",
  );
  assert.throws(
    () => configureHostedAbracadabraHtml(publicHtml, {
      catalog: {
        products: [{
          productId: "spark",
          name: "Spark",
          implementationContract: "abracadabra.spark/v1",
        }],
        tenures: [{ tenureId: "rent", name: "Rent" }],
        offers: [{
          offerId: "spark.rent",
          productId: "spark",
          tenureId: "rent",
          eligibleAddressModes: ["licensed"],
          stripePriceRefs: { recurring: "price_private" },
        }],
      },
    }),
    /private server price authority/u,
  );
});

test("hosted DOM copy is plain, benefit-led, and free of internal launch jargon", async () => {
  const source = await readFile(
    new URL("../../abracadabra/app/abracadabra-hosted-control-dom.js", import.meta.url),
    "utf8",
  );
  for (const copy of [
    "Buy a domain without leaving Site Sourcery.",
    "Finish one step to open the next.",
    "You are the owner.",
    "Payment is not available until prices are set.",
    "Choose the website, then choose how to keep it.",
    "A domain is priced separately.",
    "Nothing is charged on this screen.",
    "Accept quote and continue to secure payment",
    "We’ll check again right before registration.",
    "Payment is authorized first.",
    "Register this domain",
    "We got your publish request. This page will show when the site is live.",
    "Save projects to your account, manage billing and domains, and choose exactly what goes live.",
  ]) {
    assert.ok(source.includes(copy), copy);
  }
  assert.match(
    source,
    /href: "\/legal\/website-terms\/#customer-domains"/u,
  );
  assert.doesNotMatch(source, /website-terms\/#domains/u);
  assert.match(source, /moneyCopy\(totals\.oneTime\)/u);
  assert.doesNotMatch(source, /totals\.dueNow/u);
  for (const jargon of [
    "Hosted staging boundary",
    "server-verified",
    "provider authority",
    "owner approval",
    "processing asynchronously",
    "exact accepted version",
    "legal registrant",
    "non-transactional",
    "state-machine",
  ]) {
    assert.doesNotMatch(source, new RegExp(jargon, "iu"), jargon);
  }
  const quoteAt = source.indexOf("control.quoteOffer(offerId)");
  const acceptanceAt = source.indexOf("acceptance.checked !== true");
  const checkoutAt = source.indexOf("control.checkoutQuotedOffer(reviewedOfferId)");
  assert.ok(quoteAt >= 0, "server quote call");
  assert.ok(acceptanceAt > quoteAt, "explicit quote acceptance follows disclosure");
  assert.ok(checkoutAt > acceptanceAt, "checkout follows explicit acceptance");
  assert.doesNotMatch(source, /control\.checkout\s*\(/u);
  assert.doesNotMatch(source, /priceId|stripePrice/u);
});

test("async actions expose pending and safe retry state while reusing the original idempotency key", async () => {
  const requestKeys = [];
  let attempt = 0;
  const control = createHostedControl({
    api: baseApi({
      requestRecovery: async (_input, options) => {
        requestKeys.push(options.idempotencyKey);
        attempt += 1;
        if (attempt === 1) {
          throw Object.assign(new Error("Temporary service failure"), {
            code: "TEMPORARY",
            retryable: true,
            requestId: "req_retry",
          });
        }
        return { accepted: true };
      },
    }),
    idempotencyFactory: () => "idem_recovery_stable",
  });

  const first = control.requestRecovery({ email: "owner@example.com" });
  assert.equal(control.getState().operations.requestRecovery.status, "pending");
  assert.equal(control.localFallbackAllowed(), false);
  await assert.rejects(first, /Temporary service failure/u);
  assert.deepEqual(control.getState().operations.requestRecovery, {
    status: "error",
    attempt: 1,
    error: {
      code: "TEMPORARY",
      message: "Temporary service failure",
      retryable: true,
      requestId: "req_retry",
    },
  });

  await control.retry("requestRecovery");
  assert.equal(control.getState().operations.requestRecovery.status, "success");
  assert.equal(control.getState().operations.requestRecovery.attempt, 2);
  assert.deepEqual(requestKeys, ["idem_recovery_stable", "idem_recovery_stable"]);
});

test("recovery copy claims email only from exact delivery evidence", () => {
  assert.deepEqual(
    recoveryRequestOutcome({ delivery: "email", emailSent: true }),
    {
      emailSent: true,
      message: "If that account exists, a recovery email was sent.",
      supportRequired: false,
    },
  );
  for (const held of [
    { delivery: "manual_operator", emailSent: false },
    { delivery: "held", emailSent: false },
  ]) {
    assert.deepEqual(
      recoveryRequestOutcome(held),
      {
        emailSent: false,
        message: "No recovery email was sent. Use the Contact page below for account recovery.",
        supportRequired: true,
      },
    );
  }
  for (const unproven of [
    undefined,
    {},
    { accepted: true },
    { delivery: "email" },
    { delivery: "manual_operator", emailSent: true },
  ]) {
    const outcome = recoveryRequestOutcome(unproven);
    assert.equal(outcome.emailSent, false);
    assert.equal(outcome.supportRequired, true);
    assert.match(outcome.message, /^We could not confirm/u);
    assert.doesNotMatch(outcome.message, /instructions have been sent/iu);
  }
});

test("same-origin session boot propagates CSRF, idempotency, cookie credentials, and draft revision", async () => {
  const calls = [];
  const project = {
    id: "project_1",
    name: "Revision project",
    draft: { revision: 7, rawFacts: {} },
    versions: [],
  };
  const client = createClient({
    baseUrl: "/api/v1",
    idempotencyFactory: () => {
      assert.fail("the hosted controller must provide every write idempotency key");
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/me") {
        return response(200, { user: { id: "user_1" }, csrfToken: "csrf_session_1" });
      }
      if (url === "/api/v1/organizations") {
        return response(200, { organizations: [{ id: "org_1" }] });
      }
      if (url === "/api/v1/organizations/org_1/projects") {
        return response(200, { projects: [project] });
      }
      if (url === "/api/v1/projects/project_1" && options.method === "GET") {
        return response(200, { project });
      }
      if (url === "/api/v1/projects/project_1/subscription") {
        return response(200, { subscription: { id: "sub_1", status: "current" } });
      }
      if (url === "/api/v1/projects/project_1/draft") {
        return response(200, { revision: 8 });
      }
      return response(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    },
  });
  const control = createHostedControl({
    api: client,
    idempotencyFactory: () => "idem_draft_1",
  });

  await control.boot();
  await control.selectProject("project_1");
  await control.saveDraft({ businessName: "Server saved" });

  const write = calls.find((call) => call.url.endsWith("/draft"));
  assert.ok(write);
  assert.equal(write.options.credentials, "include");
  assert.equal(write.options.headers["X-CSRF-Token"], "csrf_session_1");
  assert.equal(write.options.headers["Idempotency-Key"], "idem_draft_1");
  assert.equal(write.options.headers["If-Match"], "7");
  assert.deepEqual(JSON.parse(write.options.body), {
    rawFacts: { businessName: "Server saved" },
  });
  assert.equal(control.getState().project.draft.revision, 8);
});

test("a late project response cannot replace the newer selection or its operation state", async () => {
  const projectA = deferred();
  const projectB = deferred();
  const control = createHostedControl({
    api: baseApi({
      getProject: async (id) => (id === "project_a" ? projectA.promise : projectB.promise),
      subscription: async (id) => ({ subscription: { id: `sub_${id}` } }),
    }),
    idempotencyFactory: () => "idem_stale",
  });

  const openingA = control.selectProject("project_a");
  const openingB = control.selectProject("project_b");
  await Promise.resolve();
  projectB.resolve({ project: { id: "project_b", draft: { revision: 1 } } });
  await openingB;
  projectA.resolve({ project: { id: "project_a", draft: { revision: 1 } } });
  await openingA;

  assert.equal(control.getState().project.id, "project_b");
  assert.equal(control.getState().subscription.id, "sub_project_b");
  assert.equal(control.getState().operations.project.status, "success");
});

test("hosted mode never falls back to local authority after its first mutation", async () => {
  const pending = deferred();
  const control = createHostedControl({
    api: baseApi({
      requestRecovery: async () => pending.promise,
    }),
    idempotencyFactory: () => "idem_lock",
  });
  assert.equal(control.localFallbackAllowed(), true);
  const request = control.requestRecovery({ email: "owner@example.com" });
  assert.equal(control.localFallbackAllowed(), false);
  pending.resolve({ accepted: true });
  await request;
  assert.equal(control.localFallbackAllowed(), false);
  assert.equal(control.getState().hostedMutationStarted, true);
});

test("checkout is held without an offer, then requires an exact server quote and matching disclosure acceptance", async () => {
  let quoteCall = null;
  let checkoutCall = null;
  const unresolved = await selectedControl({
    createCommerceQuote: async () => {
      assert.fail("held quoting must not reach the API");
    },
    createCommerceCheckout: async () => {
      assert.fail("held checkout must not reach the API");
    },
  });
  assert.equal(unresolved.getState().checkoutEnabled, false);
  await assert.rejects(
    () => unresolved.quoteOffer("spark.rent"),
    (error) => error instanceof ControlError && error.code === "CHECKOUT_HELD",
  );
  await assert.rejects(
    () => unresolved.checkoutQuotedOffer(),
    (error) => error instanceof ControlError && error.code === "QUOTE_REVIEW_REQUIRED",
  );

  const ownOnLicensedAddress = await selectedControl({
    getProject: async () => ({
      project: {
        id: "project_1",
        draft: { revision: 1 },
        address: {
          kind: "licensed",
          label: "example",
          revision: "address_rev_licensed",
        },
        versions: [],
      },
    }),
    createCommerceQuote: async () => {
      assert.fail("an Own quote on a licensed address must not reach the API");
    },
    createCommerceCheckout: async () => {
      assert.fail("an Own checkout on a licensed address must not reach the API");
    },
  }, {
    catalog: {
      catalogVersion: "catalog_1",
      products: {
        spark: {
          label: "Spark",
          implementationContract: "abracadabra.spark/v1",
        },
      },
      tenures: {
        own: { label: "Own" },
      },
      offers: {
        "spark.own": {
          productId: "spark",
          tenureId: "own",
          eligibleAddressModes: ["customer_owned"],
        },
      },
    },
  });
  await assert.rejects(
    () => ownOnLicensedAddress.quoteOffer("spark.own"),
    (error) => error instanceof ControlError && error.code === "OFFER_ADDRESS_INELIGIBLE",
  );

  const resolved = await selectedControl({
    createCommerceQuote: async (projectId, input, options) => {
      quoteCall = { projectId, input, options };
      return {
        quote: {
          quoteId: "commerce_quote_1",
          projectId,
          offerId: input.offerId,
          disclosureDigest: "d".repeat(64),
          addressBinding: {
            mode: "customer_owned",
            revision: "address_rev_1",
          },
          lineItems: [{
            label: "Spark — Own",
            oneTime: { amountMinor: 10000, currency: "USD" },
            terms: {},
          }],
          totals: {
            oneTime: { amountMinor: 10000, currency: "USD" },
            recurring: [],
          },
          expiresAt: "2099-08-01T00:00:00.000Z",
        },
      };
    },
    createCommerceCheckout: async (projectId, quoteId, input, options) => {
      checkoutCall = { projectId, quoteId, input, options };
      return {
        quoteId,
        checkout: { url: "https://checkout.stripe.com/c/pay/test" },
      };
    },
    getProject: async () => ({
      project: {
        id: "project_1",
        draft: { revision: 1 },
        address: {
          kind: "custom",
          hostname: "example.com",
          state: "verified",
          revision: "address_rev_1",
        },
        versions: [],
      },
    }),
  }, {
    catalog: {
      catalogVersion: "catalog_1",
      products: {
        spark: {
          label: "Spark",
          implementationContract: "abracadabra.spark/v1",
        },
      },
      tenures: {
        own: { label: "Own" },
      },
      offers: {
        "spark.own": {
          productId: "spark",
          tenureId: "own",
          eligibleAddressModes: ["customer_owned"],
        },
      },
    },
    idempotencyFactory: () => "idem_checkout",
  });
  assert.equal(resolved.getState().checkoutEnabled, true);
  await assert.rejects(
    () => resolved.checkoutQuotedOffer(),
    (error) => error instanceof ControlError && error.code === "QUOTE_REVIEW_REQUIRED",
  );
  await resolved.quoteOffer("spark.own");
  assert.deepEqual(quoteCall, {
    projectId: "project_1",
    input: { offerId: "spark.own", domainQuoteId: null },
    options: { idempotencyKey: "idem_checkout" },
  });
  assert.equal(Object.hasOwn(quoteCall.input, "amount"), false);
  assert.equal(Object.hasOwn(quoteCall.input, "currency"), false);
  assert.equal(Object.hasOwn(quoteCall.input, "priceId"), false);
  assert.equal(resolved.getState().commerceQuote.quoteId, "commerce_quote_1");

  await resolved.checkoutQuotedOffer();
  assert.deepEqual(checkoutCall, {
    projectId: "project_1",
    quoteId: "commerce_quote_1",
    input: { acceptedDisclosureDigest: "d".repeat(64) },
    options: { idempotencyKey: "idem_checkout" },
  });
  assert.equal(Object.hasOwn(checkoutCall, "amount"), false);
  assert.equal(Object.hasOwn(checkoutCall, "currency"), false);
  assert.equal(Object.hasOwn(checkoutCall, "priceId"), false);
});

test("publication stays disabled without both paid entitlement and a verified address", async () => {
  const unpaid = await selectedControl({
    requestRelease: async () => {
      assert.fail("unpaid publication must not reach the API");
    },
  });
  await assert.rejects(
    () => unpaid.requestRelease("version_1"),
    (error) => error instanceof ControlError && error.code === "PAID_ENTITLEMENT_REQUIRED",
  );

  const unverified = await selectedControl({
    getProject: async () => ({
      project: {
        id: "project_1",
        draft: { revision: 1 },
        address: { kind: "custom", state: "pending" },
        versions: [],
      },
    }),
    subscription: async () => ({ subscription: { status: "current" } }),
    requestRelease: async () => {
      assert.fail("unverified publication must not reach the API");
    },
  });
  await assert.rejects(
    () => unverified.requestRelease("version_1"),
    (error) => error instanceof ControlError && error.code === "VERIFIED_ADDRESS_REQUIRED",
  );
});

test("reviewed versions, addresses, verification, release, billing, support, export, and deletion delegate asynchronously", async () => {
  const calls = [];
  const cancellationDigest = "c".repeat(64);
  const project = {
    id: "project_1",
    draft: { revision: 1 },
    address: { kind: "licensed", state: "configured" },
    versions: [],
  };
  const methods = {
    createVersion: async (input, options) => {
      calls.push(["createVersion", input, options]);
      return { version: { id: "version_1" } };
    },
    markVersionReady: async (...args) => {
      calls.push(["markVersionReady", ...args]);
      return { version: { id: "version_1", state: "ready" } };
    },
    acceptVersion: async (...args) => {
      calls.push(["acceptVersion", ...args]);
      return { version: { id: "version_1", state: "accepted" } };
    },
    selectAddress: async (...args) => {
      calls.push(["selectAddress", ...args]);
      return { accepted: true };
    },
    requestDomainVerification: async (...args) => {
      calls.push(["requestDomainVerification", ...args]);
      return { accepted: true };
    },
    billingPortal: async (...args) => {
      calls.push(["billingPortal", ...args]);
      return { url: "https://billing.example.test/" };
    },
    cancellationPreview: async (...args) => {
      calls.push(["cancellationPreview", ...args]);
      return {
        preview: {
          previewId: "cancel_preview_1",
          projectId: "project_1",
          effectiveAt: "2026-08-01T00:00:00.000Z",
          retentionEndsAt: "2026-10-30T00:00:00.000Z",
          disclosureDigest: cancellationDigest,
        },
      };
    },
    cancelSubscription: async (...args) => {
      calls.push(["cancelSubscription", ...args]);
      return { accepted: true };
    },
    requestRelease: async (...args) => {
      calls.push(["requestRelease", ...args]);
      return { accepted: true };
    },
    unpublish: async (...args) => {
      calls.push(["unpublish", ...args]);
      return { accepted: true };
    },
    setVisibility: async (...args) => {
      calls.push(["setVisibility", ...args]);
      return { accepted: true };
    },
    createSupportTicket: async (...args) => {
      calls.push(["createSupportTicket", ...args]);
      return { accepted: true };
    },
    requestExport: async (...args) => {
      calls.push(["requestExport", ...args]);
      return {
        export: {
          exportId: "export_1",
          projectId: "project_1",
          status: "queued",
          createdAt: "2026-07-28T12:00:00.000Z",
          updatedAt: "2026-07-28T12:00:00.000Z",
        },
      };
    },
    deleteProject: async (...args) => {
      calls.push(["deleteProject", ...args]);
      return { deleted: true };
    },
  };
  const control = await selectedControl({
    ...methods,
    getProject: async () => ({ project }),
    subscription: async () => ({ subscription: { status: "current" } }),
  }, {
    idempotencyFactory: (() => {
      let value = 0;
      return () => `idem_${++value}`;
    })(),
  });

  await control.acceptMadeVersion({
    raw: { businessName: "Reviewed" },
    result: { artifactDigest: "a".repeat(64) },
    reviewAttested: true,
  });
  await control.selectAddress({ kind: "custom", path: "connect", hostname: "example.com" });
  await control.requestDomainVerification({
    addressId: "address_1",
    method: "dns_challenge",
    reference: "proof_1",
  });
  await control.billingPortal();
  await control.previewCancellation();
  await control.cancelSubscription();
  await control.requestRelease("version_1");
  await control.unpublish();
  await control.setVisibility({ visibility: "private", accessPassword: "long private phrase" });
  await control.createSupportTicket({ subject: "Help", message: "Please help." });
  await control.requestExport();
  await control.deleteProject();

  const names = calls.map(([name]) => name);
  for (const expected of [
    "createVersion",
    "markVersionReady",
    "acceptVersion",
    "selectAddress",
    "requestDomainVerification",
    "billingPortal",
    "cancellationPreview",
    "cancelSubscription",
    "requestRelease",
    "unpublish",
    "setVisibility",
    "createSupportTicket",
    "requestExport",
    "deleteProject",
  ]) {
    assert.ok(names.includes(expected), expected);
  }
  const cancelCall = calls.find(([name]) => name === "cancelSubscription");
  assert.deepEqual(cancelCall.slice(1, 3), [
    "project_1",
    {
      previewId: "cancel_preview_1",
      acceptedDisclosureDigest: cancellationDigest,
    },
  ]);
  assert.equal(control.getState().project, null);
});

test("cancellation cannot mutate a subscription before the exact server dates are reviewed", async () => {
  const control = await selectedControl({
    cancelSubscription: async () => {
      assert.fail("cancellation without a reviewed preview must not reach the API");
    },
  });

  await assert.rejects(
    () => control.cancelSubscription(),
    (error) => error instanceof ControlError
      && error.code === "CANCELLATION_PREVIEW_REQUIRED",
  );
});

test("hosted export progresses to a one-time download and can regenerate after use", async () => {
  const calls = [];
  let statusRead = 0;
  const timestamps = {
    createdAt: "2026-07-28T12:00:00.000Z",
    updatedAt: "2026-07-28T12:00:01.000Z",
  };
  const control = await selectedControl({
    requestExport: async (...args) => {
      calls.push(["requestExport", ...args]);
      return {
        export: {
          exportId: "export_1",
          projectId: "project_1",
          status: "queued",
          ...timestamps,
        },
      };
    },
    getExport: async (...args) => {
      calls.push(["getExport", ...args]);
      statusRead += 1;
      return {
        export: statusRead === 1
          ? {
              exportId: "export_1",
              projectId: "project_1",
              status: "working",
              ...timestamps,
            }
          : {
              exportId: "export_1",
              projectId: "project_1",
              status: "ready",
              ...timestamps,
              filename: "sitesourcery-project-1.zip",
              download: {
                token: "download_token_1",
                expiresAt: "2099-07-28T12:05:00.000Z",
              },
            },
      };
    },
    downloadExport: async (...args) => {
      calls.push(["downloadExport", ...args]);
      return { blob: { size: 128 }, filename: "sitesourcery-project-1.zip" };
    },
    retryExport: async (...args) => {
      calls.push(["retryExport", ...args]);
      return {
        export: {
          exportId: "export_2",
          projectId: "project_1",
          status: "queued",
          ...timestamps,
        },
      };
    },
  }, {
    idempotencyFactory: (() => {
      let value = 0;
      return () => `export_idem_${++value}`;
    })(),
  });

  await assert.rejects(
    () => control.downloadExport(),
    (error) => error.code === "EXPORT_DOWNLOAD_UNAVAILABLE",
  );
  await control.requestExport();
  assert.equal(control.getState().exportJob.status, "queued");
  await control.getExport();
  assert.equal(control.getState().exportJob.status, "working");
  await control.getExport();
  assert.equal(control.getState().exportJob.status, "ready");
  const download = await control.downloadExport();
  assert.equal(download.filename, "sitesourcery-project-1.zip");
  assert.equal(control.getState().exportJob.status, "expired");
  await control.retryExport();
  assert.equal(control.getState().exportJob.exportId, "export_2");
  assert.deepEqual(
    calls.find(([name]) => name === "downloadExport").slice(1),
    ["project_1", "export_1", "download_token_1"],
  );
});

test("domain storefront preserves quote, registrant, payment, fresh-price, registration, DNS, renewal, and transfer authority boundaries", async () => {
  const calls = [];
  const domainApi = {
    searchDomains: async (query) => {
      calls.push(["searchDomains", query]);
      return { results: [{ hostname: "cedar.example" }] };
    },
    createDomainQuote: async (input, options) => {
      calls.push(["createDomainQuote", input, options]);
      return {
        quote: {
          id: "quote_1",
          hostname: input.hostname,
          amountMinor: 1900,
          currency: "USD",
          years: input.years,
          registrar: "Spaceship",
          termsVersion: "domain-terms-2026-07",
          terms: {
            registrar: "Spaceship",
            renewal: "Renewal is quoted before charge.",
            cancellation: "A completed registration cannot be canceled.",
            ownership: "The customer is the registrant.",
          },
        },
      };
    },
    saveRegistrantContact: async (organizationId, input, options) => {
      calls.push(["saveRegistrantContact", organizationId, input, options]);
      return { registrantContact: { id: "contact_1", name: input.name } };
    },
    acceptDomainConsent: async (quoteId, input, options) => {
      calls.push(["acceptDomainConsent", quoteId, input, options]);
      return { consent: { id: "consent_1" } };
    },
    createDomainOrder: async (projectId, input, options) => {
      calls.push(["createDomainOrder", projectId, input, options]);
      return { domainOrder: { id: "order_1", status: "payment_pending" } };
    },
    listDomainOrders: async () => ({
      domainOrders: [{ id: "order_1", status: "paid" }],
    }),
    getDomainOrder: async (orderId) => ({
      domainOrder: { id: orderId, status: "registration_processing" },
    }),
    refreshDomainPrice: async (orderId, options) => {
      calls.push(["refreshDomainPrice", orderId, options]);
      return {
        priceCheck: {
          priceCheckId: "price_check_1",
          orderId,
          status: "ready_to_confirm",
          hostname: "cedar.example",
          available: true,
          finalPrice: { amountMinor: 1900, currency: "USD" },
          checkedAt: "2026-07-28T12:00:00.000Z",
          expiresAt: "2099-07-28T12:05:00.000Z",
        },
      };
    },
    requestDomainRegistration: async (orderId, input, options) => {
      calls.push(["requestDomainRegistration", orderId, input, options]);
      return { domainOrder: { id: orderId, status: "registration_processing" } };
    },
    listDomains: async () => ({ domains: [{ id: "domain_1", hostname: "cedar.example" }] }),
    getDomain: async (domainId) => ({ domain: { id: domainId, hostname: "cedar.example" } }),
    listDnsRecords: async () => ({ records: [{ id: "record_1", type: "A" }] }),
    upsertDnsRecord: async (...args) => {
      calls.push(["upsertDnsRecord", ...args]);
      return { accepted: true };
    },
    deleteDnsRecord: async (...args) => {
      calls.push(["deleteDnsRecord", ...args]);
      return { accepted: true };
    },
    setDomainAutoRenew: async (...args) => {
      calls.push(["setDomainAutoRenew", ...args]);
      return { accepted: true };
    },
    requestDomainRenewalQuote: async (...args) => {
      calls.push(["requestDomainRenewalQuote", ...args]);
      return { quote: { id: "renew_quote_1" } };
    },
    requestDomainTransferOut: async (...args) => {
      calls.push(["requestDomainTransferOut", ...args]);
      return { request: { id: "transfer_1" } };
    },
  };
  const control = await selectedControl(domainApi, {
    idempotencyFactory: (() => {
      let value = 0;
      return () => `domain_idem_${++value}`;
    })(),
  });

  await control.searchDomains("cedar");
  await control.createDomainQuote({ hostname: "cedar.example", years: 1 });
  assert.equal(control.getState().domainQuote.amountMinor, 1900);
  await control.saveRegistrantContact({
    name: "Customer Owner",
    email: "owner@example.com",
    phone: "+1 856 555 0100",
    addressLine1: "1 Main Street",
    city: "Camden",
    region: "NJ",
    postalCode: "08102",
    countryCode: "US",
  });
  await control.restartDomainPurchase("owner");
  assert.equal(control.getState().domainQuote.id, "quote_1");
  assert.equal(control.getState().registrantContact, null);
  await control.saveRegistrantContact({
    name: "Customer Owner",
    email: "owner@example.com",
    phone: "+1 856 555 0100",
    addressLine1: "1 Main Street",
    city: "Camden",
    region: "NJ",
    postalCode: "08102",
    countryCode: "US",
  });
  await control.acceptDomainConsent({
    termsVersion: "domain-terms-2026-07",
    registrationAgreementAccepted: true,
    registrantCertificationAccepted: true,
    autoRenewRequested: true,
  });
  await control.restartDomainPurchase("review");
  assert.equal(control.getState().domainConsent, null);
  assert.equal(control.getState().registrantContact.id, "contact_1");
  await control.acceptDomainConsent({
    termsVersion: "domain-terms-2026-07",
    registrationAgreementAccepted: true,
    registrantCertificationAccepted: true,
    autoRenewRequested: true,
  });
  await control.createDomainOrder();
  await assert.rejects(
    () => control.restartDomainPurchase("search"),
    (error) => error.code === "DOMAIN_ORDER_LOCKED",
  );
  await assert.rejects(
    () => control.requestDomainRegistration({ irreversibleRegistrationAccepted: true }),
    (error) => error.code === "FRESH_DOMAIN_PRICE_REQUIRED",
  );
  await control.listDomainOrders();
  await control.refreshDomainPrice();
  assert.deepEqual(control.getState().domainPriceCheck.finalPrice, {
    amountMinor: 1900,
    currency: "USD",
  });
  await assert.rejects(
    () => control.requestDomainRegistration({ irreversibleRegistrationAccepted: false }),
    (error) => error.code === "IRREVERSIBLE_REGISTRATION_CONSENT_REQUIRED",
  );
  await control.requestDomainRegistration({ irreversibleRegistrationAccepted: true });
  await control.pollDomainOrder();
  await control.listDomains();
  await control.selectDomain("domain_1");
  await control.upsertDnsRecord({
    type: "A",
    name: "@",
    content: "192.0.2.1",
    ttl: 3600,
  });
  await control.deleteDnsRecord("record_1");
  await control.setDomainAutoRenew(true);
  await control.requestDomainRenewalQuote(1);
  await control.requestDomainTransferOut();

  const quoteInput = calls.find(([name]) => name === "createDomainQuote")[1];
  assert.deepEqual(quoteInput, {
    hostname: "cedar.example",
    years: 1,
    purpose: undefined,
  });
  assert.equal(Object.hasOwn(quoteInput, "amount"), false);
  assert.equal(Object.hasOwn(quoteInput, "currency"), false);
  const registration = calls.find(([name]) => name === "requestDomainRegistration");
  assert.deepEqual(registration[2], {
    priceCheckId: "price_check_1",
    irreversibleRegistrationAccepted: true,
  });
  for (const expected of [
    "upsertDnsRecord",
    "deleteDnsRecord",
    "setDomainAutoRenew",
    "requestDomainRenewalQuote",
    "requestDomainTransferOut",
  ]) {
    assert.ok(calls.some(([name]) => name === expected), expected);
  }
});

test("a changed final domain price voids the reviewed purchase path and cannot register", async () => {
  const control = await selectedControl({
    createDomainQuote: async (input) => ({
      quote: {
        id: "quote_changed",
        hostname: input.hostname,
        amountMinor: 1900,
        currency: "USD",
        years: 1,
        registrar: "Spaceship",
        termsVersion: "domain-terms-2026-07",
        terms: {
          registrar: "Spaceship",
          renewal: "Renewal is quoted before charge.",
          cancellation: "A completed registration cannot be canceled.",
          ownership: "The customer is the registrant.",
        },
      },
    }),
    saveRegistrantContact: async () => ({
      registrantContact: { id: "contact_changed", name: "Customer Owner" },
    }),
    acceptDomainConsent: async () => ({ consent: { id: "consent_changed" } }),
    createDomainOrder: async () => ({
      domainOrder: { id: "order_changed", status: "payment_pending" },
    }),
    listDomainOrders: async () => ({
      domainOrders: [{ id: "order_changed", status: "paid" }],
    }),
    refreshDomainPrice: async (orderId) => ({
      priceCheck: {
        priceCheckId: "price_check_changed",
        orderId,
        status: "changed",
        hostname: "cedar.example",
        available: true,
        finalPrice: { amountMinor: 2400, currency: "USD" },
        checkedAt: "2026-07-28T12:00:00.000Z",
        expiresAt: "2099-07-28T12:05:00.000Z",
      },
    }),
    requestDomainRegistration: async () => {
      assert.fail("a changed price must not reach registration");
    },
  });

  await control.createDomainQuote({ hostname: "cedar.example", years: 1 });
  await control.saveRegistrantContact({
    name: "Customer Owner",
    email: "owner@example.com",
    phone: "+1 856 555 0100",
    addressLine1: "1 Main Street",
    city: "Camden",
    region: "NJ",
    postalCode: "08102",
    countryCode: "US",
  });
  await control.acceptDomainConsent({
    termsVersion: "domain-terms-2026-07",
    registrationAgreementAccepted: true,
    registrantCertificationAccepted: true,
  });
  await control.createDomainOrder();
  await control.listDomainOrders();
  await control.refreshDomainPrice();

  const state = control.getState();
  assert.equal(state.domainPriceCheck.status, "changed");
  assert.equal(state.domainQuote, null);
  assert.equal(state.domainConsent, null);
  assert.equal(state.domainOrder, null);
  await assert.rejects(
    () => control.requestDomainRegistration({ irreversibleRegistrationAccepted: true }),
    (error) => error.code === "FRESH_DOMAIN_PRICE_REQUIRED",
  );
});

test("browser API rejects nested domain authority claims before network access", () => {
  const client = createClient({
    fetch: async () => {
      assert.fail("forged nested authority must not reach the API");
    },
    idempotencyFactory: () => "idem_forged_domain",
  });

  assert.throws(
    () => client.createProject({
      organizationId: "org_1",
      name: "Forged domain project",
      acceptedTerms: true,
      address: {
        kind: "custom",
        hostname: "example.com",
        registrationState: "registered",
      },
    }),
    (error) => error instanceof APIError && error.code === "OWNER_AUTHORITY_REJECTED",
  );
  assert.throws(
    () => client.createDomainQuote({
      hostname: "example.com",
      years: 1,
      currency: "USD",
    }),
    (error) => error instanceof APIError && error.code === "OWNER_AUTHORITY_REJECTED",
  );
});
