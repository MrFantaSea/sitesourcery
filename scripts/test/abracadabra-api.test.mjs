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

test("checkout accepts an approved price identifier, never a browser-supplied amount", async () => {
  const calls = [];
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response(201, { id: "checkout_1", url: "https://checkout.stripe.test/session" });
    },
    idempotencyFactory: () => "checkout-idempotency-key"
  });

  await client.checkout("project_1", "price_approved_1");
  assert.equal(calls[0].url, "/api/v1/projects/project_1/checkout-intents");
  assert.deepEqual(JSON.parse(calls[0].options.body), { priceId: "price_approved_1" });
  assert.equal(calls[0].options.headers["Idempotency-Key"], "checkout-idempotency-key");
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
    { published: true }
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
});

test("draft writes carry optimistic-concurrency revision", async () => {
  let call;
  const client = createClient({
    fetch: async (url, options) => {
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
    fetch: async () => response(409, {
      error: {
        code: "REVISION_CONFLICT",
        message: "This project changed in another tab."
      }
    }, "req_conflict"),
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
