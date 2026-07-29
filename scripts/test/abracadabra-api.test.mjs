import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { APIError, createClient } = require("../../abracadabra/app/abracadabra-api.js");

function response(status, payload, requestId = "req_test") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (name.toLowerCase() === "content-type") return "application/json";
        if (name.toLowerCase() === "x-request-id") return requestId;
        return null;
      }
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test("authenticated reads use cookies and never put bearer credentials in browser storage", async () => {
  const calls = [];
  const client = createClient({
    baseUrl: "/api/v1",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response(200, { user: { id: "user_1" }, csrfToken: "csrf_1" });
    },
    idempotencyFactory: () => "idem_read"
  });

  const result = await client.me();
  assert.equal(result.user.id, "user_1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/v1/me");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.body, undefined);
});

test("every browser write carries a stable idempotency key and current CSRF token", async () => {
  const calls = [];
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response(200, calls.length === 1 ? { csrfToken: "csrf_from_server" } : { ok: true });
    },
    idempotencyFactory: () => "generated-idempotency-key"
  });

  await client.me();
  await client.requestExport("project_1", { idempotencyKey: "export-once-1" });
  assert.equal(calls[1].options.headers["Idempotency-Key"], "export-once-1");
  assert.equal(calls[1].options.headers["X-CSRF-Token"], "csrf_from_server");
  assert.equal(calls[1].options.method, "POST");
});

test("concurrent first writes share one CSRF bootstrap", async () => {
  const calls = [];
  let sequence = 0;
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        return response(200, { csrfToken: "csrf_concurrent" });
      }
      return response(202, { accepted: true });
    },
    idempotencyFactory: () => `concurrent-key-${sequence += 1}`
  });

  await Promise.all([
    client.requestExport("project_1"),
    client.requestExport("project_2")
  ]);

  assert.equal(
    calls.filter(({ url }) => url === "/api/v1/csrf").length,
    1
  );
  const writes = calls.filter(({ url }) => url !== "/api/v1/csrf");
  assert.equal(writes.length, 2);
  assert.ok(
    writes.every(
      ({ options }) => options.headers["X-CSRF-Token"] === "csrf_concurrent"
    )
  );
});

test("a rejected stale CSRF token is cleared before the customer's next retry", async () => {
  const calls = [];
  let bootstrap = 0;
  let write = 0;
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        bootstrap += 1;
        return response(200, { csrfToken: `csrf_retry_${bootstrap}` });
      }
      write += 1;
      if (write === 1) {
        return response(403, {
          error: {
            code: "CSRF_TOKEN_REQUIRED",
            message: "Refresh this page before trying that action again."
          }
        });
      }
      return response(202, { accepted: true });
    },
    idempotencyFactory: () => `retry-key-${write + 1}`
  });

  await assert.rejects(
    () => client.requestExport("project_1"),
    (error) => error.code === "CSRF_TOKEN_REQUIRED"
  );
  await client.requestExport("project_1");

  assert.equal(bootstrap, 2);
  assert.equal(
    calls.at(-1).options.headers["X-CSRF-Token"],
    "csrf_retry_2"
  );
});

test("commerce uses only an offer ID, an exact server quote, and its disclosure digest", async () => {
  const calls = [];
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        return response(200, { csrfToken: "csrf_commerce" });
      }
      return response(201, url.endsWith("/commerce-quotes")
        ? {
            quoteId: "quote_1",
            offerId: "business.own",
            disclosureDigest: "d".repeat(64),
          }
        : {
            quoteId: "quote_1",
            checkout: { url: "https://checkout.stripe.com/c/pay/test" },
          });
    },
    idempotencyFactory: () => "checkout-idempotency-key"
  });

  await client.createCommerceQuote("project_1", { offerId: "business.own" });
  await client.createCommerceCheckout("project_1", "quote_1", {
    acceptedDisclosureDigest: "d".repeat(64),
  });
  const commerceCalls = calls.filter(({ url }) => url !== "/api/v1/csrf");
  assert.equal(commerceCalls[0].url, "/api/v1/projects/project_1/commerce-quotes");
  assert.deepEqual(JSON.parse(commerceCalls[0].options.body), { offerId: "business.own" });
  assert.equal(commerceCalls[0].options.headers["Idempotency-Key"], "checkout-idempotency-key");
  assert.equal(
    commerceCalls[1].url,
    "/api/v1/projects/project_1/commerce-quotes/quote_1/checkout",
  );
  assert.deepEqual(JSON.parse(commerceCalls[1].options.body), {
    acceptedDisclosureDigest: "d".repeat(64),
  });
  for (const call of commerceCalls) {
    const body = JSON.parse(call.options.body);
    for (const forbidden of ["amount", "amountMinor", "currency", "price", "priceId", "stripePriceId"]) {
      assert.equal(Object.hasOwn(body, forbidden), false, forbidden);
    }
  }
});

test("cancellation requires a server preview and submits only its accepted disclosure", async () => {
  const calls = [];
  const digest = "c".repeat(64);
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        return response(200, { csrfToken: "csrf_cancellation" });
      }
      if (options.method === "GET") {
        return response(200, {
          preview: {
            previewId: "cancel_preview_1",
            projectId: "project_1",
            effectiveAt: "2026-08-01T00:00:00.000Z",
            retentionEndsAt: "2026-10-30T00:00:00.000Z",
            disclosureDigest: digest,
          },
        });
      }
      return response(202, { accepted: true });
    },
    idempotencyFactory: () => "cancel-idempotency-key",
  });

  await client.cancellationPreview("project_1");
  assert.equal(
    calls[0].url,
    "/api/v1/projects/project_1/subscription/cancellation-preview",
  );
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.body, undefined);

  await client.cancelSubscription("project_1", {
    previewId: "cancel_preview_1",
    acceptedDisclosureDigest: digest,
  });
  const cancellation = calls.find(
    ({ url }) => url.endsWith("/subscription/cancel")
  );
  assert.equal(cancellation.options.method, "POST");
  assert.equal(cancellation.options.headers["Idempotency-Key"], "cancel-idempotency-key");
  assert.deepEqual(JSON.parse(cancellation.options.body), {
    previewId: "cancel_preview_1",
    acceptedDisclosureDigest: digest,
  });
});

test("project exports expose status, retry, and one-time same-origin archive download routes", async () => {
  const calls = [];
  const archive = new Blob(["PK\u0003\u0004export"], { type: "application/zip" });
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        return response(200, { csrfToken: "csrf_export" });
      }
      if (url.includes("/download?token=")) {
        return {
          ok: true,
          status: 200,
          headers: {
            get(name) {
              const key = name.toLowerCase();
              if (key === "content-type") return "application/zip";
              if (key === "content-length") return String(archive.size);
              if (key === "content-disposition") {
                return 'attachment; filename="sitesourcery-project-1.zip"';
              }
              return null;
            },
          },
          async blob() {
            return archive;
          },
        };
      }
      return response(200, {
        export: {
          exportId: "export_1",
          projectId: "project_1",
          status: "queued",
          createdAt: "2026-07-28T12:00:00.000Z",
          updatedAt: "2026-07-28T12:00:00.000Z",
        },
      });
    },
    idempotencyFactory: () => "export-idempotency-key",
  });

  await client.requestExport("project_1");
  await client.getExport("project_1", "export_1");
  await client.retryExport("project_1", "export_1");
  const downloaded = await client.downloadExport(
    "project_1",
    "export_1",
    "one time/token",
  );

  assert.deepEqual(calls.map(({ url }) => url), [
    "/api/v1/csrf",
    "/api/v1/projects/project_1/exports",
    "/api/v1/projects/project_1/exports/export_1",
    "/api/v1/projects/project_1/exports/export_1/retry",
    "/api/v1/projects/project_1/exports/export_1/download?token=one%20time%2Ftoken",
  ]);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[2].options.method, "GET");
  assert.equal(calls[3].options.method, "POST");
  assert.equal(calls[4].options.method, "GET");
  assert.equal(calls[4].options.credentials, "include");
  assert.equal(calls[4].options.redirect, "error");
  assert.equal(downloaded.filename, "sitesourcery-project-1.zip");
  assert.equal(downloaded.blob.size, archive.size);
});

test("owner input cannot claim payment, subscription, domain, or publication authority", async () => {
  const client = createClient({
    fetch: async () => {
      assert.fail("forged authority must fail before a network request");
    },
    idempotencyFactory: () => "forged-authority-key"
  });

  for (const forged of [
    { providerReference: "forged" },
    { paymentReceipt: { outcome: "active" } },
    { subscriptionState: "active" },
    { verified: true },
    { published: true },
    { priceId: "price_forged" },
    { totals: { dueNow: 0 } }
  ]) {
    assert.throws(
      () => client.createProject({
        organizationId: "org_1",
        name: "Forged project",
        acceptedTerms: true,
        ...forged
      }),
      (error) => error instanceof APIError && error.code === "OWNER_AUTHORITY_REJECTED"
    );
  }

  assert.throws(
    () => client.createCommerceQuote("project_1", {
      offerId: "business.own",
      nested: { stripePriceRefs: { oneTime: "price_forged" } },
    }),
    (error) => error instanceof APIError && error.code === "OWNER_AUTHORITY_REJECTED",
  );
});

test("draft writes carry optimistic-concurrency revision", async () => {
  let call;
  const client = createClient({
    fetch: async (url, options) => {
      if (url === "/api/v1/csrf") {
        return response(200, { csrfToken: "csrf_draft" });
      }
      call = { url, options };
      return response(200, { revision: 8 });
    },
    idempotencyFactory: () => "draft-key"
  });

  await client.saveDraft({
    projectId: "project_1",
    revision: 7,
    rawFacts: { businessName: "Cedar & Stone" }
  });
  assert.equal(call.options.headers["If-Match"], "7");
  assert.deepEqual(JSON.parse(call.options.body), {
    rawFacts: { businessName: "Cedar & Stone" }
  });
});

test("server error envelopes retain safe request identifiers for support", async () => {
  const client = createClient({
    fetch: async (url) => {
      if (url === "/api/v1/csrf") {
        return response(200, { csrfToken: "csrf_conflict" });
      }
      return response(409, {
        error: {
          code: "REVISION_CONFLICT",
          message: "This project changed in another tab."
        }
      }, "req_conflict");
    },
    idempotencyFactory: () => "conflict-key"
  });

  await assert.rejects(
    () => client.saveDraft({ projectId: "project_1", revision: 2, rawFacts: {} }),
    (error) => {
      assert.equal(error.code, "REVISION_CONFLICT");
      assert.equal(error.status, 409);
      assert.equal(error.requestId, "req_conflict");
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test("catalog discovery and release rollback use the customer API boundary", async () => {
  const calls = [];
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        return response(200, { csrfToken: "csrf_rollback" });
      }
      return response(
        options.method === "GET" ? 200 : 202,
        options.method === "GET"
          ? { catalogVersion: "catalog_1", offers: [] }
          : { accepted: true }
      );
    },
    idempotencyFactory: () => "rollback-key"
  });

  await client.getOfferCatalog();
  await client.rollbackRelease("project_1", "version_7");
  assert.equal(calls[0].url, "/api/v1/offers");
  assert.equal(
    calls.at(-1).url,
    "/api/v1/projects/project_1/versions/version_7/rollback"
  );
  assert.equal(calls.at(-1).options.headers["Idempotency-Key"], "rollback-key");
  assert.equal(calls.at(-1).options.headers["X-CSRF-Token"], "csrf_rollback");
});

test("network failures do not leak the underlying browser exception", async () => {
  const client = createClient({
    fetch: async () => {
      throw new Error("socket path and secret-bearing diagnostic");
    },
    idempotencyFactory: () => "network-key"
  });

  await assert.rejects(
    () => client.listProjects("org_1"),
    (error) => {
      assert.equal(error.code, "NETWORK_ERROR");
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /secret-bearing/u);
      return true;
    }
  );
});

test("hosted browser client refuses a cross-origin or substituted API base", () => {
  for (const baseUrl of [
    "https://api.example.test/api/v1",
    "//api.example.test/api/v1",
    "/api/v2",
  ]) {
    assert.throws(
      () => createClient({ baseUrl, fetch: async () => response(200, {}) }),
      (error) => error instanceof APIError && error.code === "SAME_ORIGIN_API_REQUIRED",
    );
  }
});

test("non-JSON service and proxy responses are discarded instead of exposed", async () => {
  const client = createClient({
    fetch: async () => ({
      ok: false,
      status: 502,
      headers: {
        get(name) {
          if (name.toLowerCase() === "content-type") return "text/html";
          if (name.toLowerCase() === "x-request-id") return "req_proxy";
          return null;
        },
      },
      async text() {
        return "internal proxy secret and upstream diagnostic";
      },
    }),
  });
  await assert.rejects(
    () => client.me(),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.requestId, "req_proxy");
      assert.doesNotMatch(error.message, /proxy secret|upstream diagnostic/u);
      return true;
    },
  );
});

test("domain storefront requests carry identifiers and customer consent, never browser price or registrar authority", async () => {
  const calls = [];
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response(200, calls.length === 1 ? { csrfToken: "csrf_domain" } : { accepted: true });
    },
    idempotencyFactory: () => "idem_domain",
  });
  await client.me();
  await client.createDomainQuote({ hostname: "Example.COM", years: 2 });
  await client.saveRegistrantContact("org_1", {
    name: "Customer Owner",
    email: "owner@example.com",
    phone: "+1 856 555 0100",
    addressLine1: "1 Main Street",
    city: "Camden",
    region: "NJ",
    postalCode: "08102",
    countryCode: "US",
  });
  await client.acceptDomainConsent("quote_1", {
    registrantContactId: "contact_1",
    termsVersion: "domain-terms-2026-07",
    registrationAgreementAccepted: true,
    registrantCertificationAccepted: true,
    autoRenewRequested: true,
  });
  await client.createDomainOrder("project_1", {
    quoteId: "quote_1",
    consentId: "consent_1",
  });
  await client.refreshDomainPrice("order_1");
  await client.requestDomainRegistration("order_1", {
    priceCheckId: "price_check_1",
    irreversibleRegistrationAccepted: true,
  });

  const quote = calls.find((call) => call.url === "/api/v1/domain-quotes");
  assert.deepEqual(JSON.parse(quote.options.body), {
    hostname: "example.com",
    years: 2,
    purpose: "register",
  });
  const order = calls.find((call) => call.url.endsWith("/projects/project_1/domain-orders"));
  assert.deepEqual(JSON.parse(order.options.body), {
    quoteId: "quote_1",
    consentId: "consent_1",
  });
  const registration = calls.find((call) => call.url.endsWith("/registration-requests"));
  assert.deepEqual(JSON.parse(registration.options.body), {
    priceCheckId: "price_check_1",
    irreversibleRegistrationAccepted: true,
  });
  for (const call of calls.slice(1)) {
    assert.equal(call.options.credentials, "include");
    assert.equal(call.options.headers["X-CSRF-Token"], "csrf_domain");
    const body = call.options.body ? JSON.parse(call.options.body) : {};
    for (const forbidden of [
      "amount",
      "amountMinor",
      "currency",
      "registered",
      "registrarReference",
    ]) {
      assert.equal(Object.hasOwn(body, forbidden), false, forbidden);
    }
  }
});
