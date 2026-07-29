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
    revision: "catalog_7",
    domainTermsVersion: "domain-terms-2026-07",
    variants: {
      rent: { label: "Rent", priceId: "price_rent" },
      own: { label: "", priceId: "price_own" },
      "INVALID SPACE": { label: "Bad", priceId: "price_bad" },
    },
  }));
  assert.equal(configured.catalog.revision, "catalog_7");
  assert.equal(configured.catalog.domainTermsVersion, "domain-terms-2026-07");
  assert.deepEqual(Object.keys(configured.catalog.variants), ["rent"]);
});

test("private staging injection selects hosted mode in strict script order without changing the held public artifact", async () => {
  const publicHtml = await readFile(
    new URL("../../abracadabra/app/index.html", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(publicHtml, /sitesourcery-abracadabra-control-mode/u);
  for (const asset of hostedStagingAssets) assert.doesNotMatch(publicHtml, new RegExp(asset, "u"));

  const hosted = configureHostedAbracadabraHtml(publicHtml, {
    catalog: {
      revision: "catalog_staging_1",
      domainTermsVersion: "domain-terms-staging-1",
      variants: {
        rent: { label: "Rent", priceId: "price_test_rent" },
      },
    },
  });
  assert.match(
    hosted,
    /<meta name="sitesourcery-abracadabra-control-mode" content="hosted">/u,
  );
  const ordered = [
    "/abracadabra/app/abracadabra-api.js",
    "/abracadabra/app/abracadabra-control-mode.js",
    'id="abracadabra-hosted-catalog"',
    "/abracadabra/app/abracadabra-hosted-control.js",
    "/abracadabra/app/abracadabra-app.js",
    "/abracadabra/app/abracadabra-hosted-control-dom.js",
    "/abracadabra/app/abracadabra-control.js",
  ];
  let cursor = -1;
  for (const marker of ordered) {
    const next = hosted.indexOf(marker);
    assert.ok(next > cursor, marker);
    cursor = next;
  }
  assert.match(hosted, /"domainTermsVersion":"domain-terms-staging-1"/u);
  const catalogJson = hosted.match(
    /<script id="abracadabra-hosted-catalog" type="application\/json">([^<]+)<\/script>/u,
  )[1];
  assert.equal(Object.hasOwn(JSON.parse(catalogJson).variants.rent, "amountMinor"), false);
  assert.equal(Object.hasOwn(JSON.parse(catalogJson).variants.rent, "currency"), false);
  assert.deepEqual(hostedStagingAssets, [...hostedStagingAssets].sort());
});

test("staging catalog configuration rejects browser amount and currency authority", async () => {
  const publicHtml = await readFile(
    new URL("../../abracadabra/app/index.html", import.meta.url),
    "utf8",
  );
  assert.throws(
    () => configureHostedAbracadabraHtml(publicHtml, {
      catalog: {
        variants: {
          rent: {
            label: "Rent",
            priceId: "price_test_rent",
            amountMinor: 2500,
            currency: "USD",
          },
        },
      },
    }),
    /never browser price authority/u,
  );
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

test("checkout is held with unresolved catalog prices and maps a selected variant only to its approved price ID", async () => {
  let checkoutCall = null;
  const unresolved = await selectedControl({
    checkout: async () => {
      assert.fail("held checkout must not reach the API");
    },
  });
  assert.equal(unresolved.getState().checkoutEnabled, false);
  await assert.rejects(
    () => unresolved.checkout("rent"),
    (error) => error instanceof ControlError && error.code === "CHECKOUT_HELD",
  );

  const resolved = await selectedControl({
    checkout: async (projectId, priceId, options) => {
      checkoutCall = { projectId, priceId, options };
      return { url: "https://payments.example.test/session" };
    },
  }, {
    catalog: {
      revision: "catalog_1",
      variants: {
        rent: { label: "Rent", priceId: "price_rent_approved" },
        own: { label: "Own it", priceId: "price_own_approved" },
      },
    },
    idempotencyFactory: () => "idem_checkout",
  });
  assert.equal(resolved.getState().checkoutEnabled, true);
  await resolved.checkout("own");
  assert.deepEqual(checkoutCall, {
    projectId: "project_1",
    priceId: "price_own_approved",
    options: { idempotencyKey: "idem_checkout" },
  });
  assert.equal(Object.hasOwn(checkoutCall, "amount"), false);
  assert.equal(Object.hasOwn(checkoutCall, "currency"), false);
});

test("reviewed versions, addresses, verification, release, billing, support, export, and deletion delegate asynchronously", async () => {
  const calls = [];
  const project = {
    id: "project_1",
    draft: { revision: 1 },
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
      return { accepted: true };
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
  assert.equal(control.getState().project, null);
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
      return { priceCheck: { id: "price_check_1", status: "unchanged" } };
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
  await control.acceptDomainConsent({
    termsVersion: "domain-terms-2026-07",
    registrationAgreementAccepted: true,
    registrantCertificationAccepted: true,
    autoRenewRequested: true,
  });
  await control.createDomainOrder();
  await assert.rejects(
    () => control.requestDomainRegistration({ irreversibleRegistrationAccepted: true }),
    (error) => error.code === "FRESH_DOMAIN_PRICE_REQUIRED",
  );
  await control.refreshDomainPrice();
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
