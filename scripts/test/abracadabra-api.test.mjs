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

test("verified registration stages the account before activation creates the session", async () => {
  const calls = [];
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        return response(200, {
          csrfToken: "csrf_registration"
        });
      }
      return response(
        url.endsWith("/complete") ? 201 : 202,
        url.endsWith("/complete")
          ? { user: { id: "user_1" } }
          : {
              accepted: true,
              verificationRequired: true,
              delivery: "email",
              emailSent: true
            }
      );
    },
    idempotencyFactory: () =>
      "registration-idempotency-key"
  });

  await client.register({
    name: "Customer Owner",
    organizationName: "Customer Business",
    email: "owner@example.test",
    password: "correct horse battery staple"
  });
  await client.completeRegistration({
    token: "activation_token_12345678901234567890"
  });

  const writes = calls.filter(
    ({ url }) => url !== "/api/v1/csrf"
  );
  assert.equal(
    writes[0].url,
    "/api/v1/auth/register"
  );
  assert.equal(
    writes[1].url,
    "/api/v1/auth/register/complete"
  );
  assert.deepEqual(JSON.parse(writes[1].options.body), {
    token: "activation_token_12345678901234567890"
  });
  assert.equal(
    writes[0].options.headers["X-CSRF-Token"],
    "csrf_registration"
  );
  assert.equal(
    writes[1].options.headers["Idempotency-Key"],
    "registration-idempotency-key"
  );
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

test("Download commerce sends only the accepted version and the reviewed server digest", async () => {
  const calls = [];
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        return response(200, { csrfToken: "csrf_download" });
      }
      return response(201, url.endsWith("/download-quotes")
        ? {
            quoteId: "download_quote_1",
            offerId: "spark_download",
            disclosureDigest: "d".repeat(64),
          }
        : {
            quoteId: "download_quote_1",
            state: "held",
            dispatchAuthorized: false,
          });
    },
    idempotencyFactory: () => "download-idempotency-key"
  });

  await client.createDownloadQuote("project_1", {
    versionId: "version_1"
  });
  await client.prepareDownloadCheckout(
    "project_1",
    "download_quote_1",
    { acceptedDisclosureDigest: "d".repeat(64) }
  );

  const writes = calls.filter(({ url }) => url !== "/api/v1/csrf");
  assert.equal(
    writes[0].url,
    "/api/v1/projects/project_1/download-quotes"
  );
  assert.deepEqual(JSON.parse(writes[0].options.body), {
    versionId: "version_1"
  });
  assert.equal(
    writes[1].url,
    "/api/v1/projects/project_1/download-quotes/download_quote_1/checkout-command"
  );
  assert.deepEqual(JSON.parse(writes[1].options.body), {
    acceptedDisclosureDigest: "d".repeat(64)
  });
  for (const call of writes) {
    assert.equal(
      call.options.headers["Idempotency-Key"],
      "download-idempotency-key"
    );
    const body = JSON.parse(call.options.body);
    for (const forbidden of [
      "amount",
      "amountMinor",
      "currency",
      "offerId",
      "priceId",
      "provider",
      "tenureId"
    ]) {
      assert.equal(Object.hasOwn(body, forbidden), false, forbidden);
    }
  }
});

test("Alakazam tier commerce sends only target or accepted quote truth through the protected browser boundary", async () => {
  const calls = [];
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        return response(200, { csrfToken: "csrf_alakazam" });
      }
      return response(201, url.endsWith("/alakazam-quotes")
        ? {
            quoteId: "alakazam_quote_1",
            disclosureDigest: "a".repeat(64),
          }
        : {
            quoteId: "alakazam_quote_1",
            state: "ready",
            checkoutUrl: "https://checkout.stripe.com/c/pay/test",
          });
    },
    idempotencyFactory: () => {
      assert.fail("caller-supplied Alakazam idempotency keys must be preserved");
    },
  });

  await client.createAlakazamQuote(
    "project_1",
    {
      targetTierId: "alakazam_25",
      ignoredPresentation: { label: "Hosted" },
    },
    { idempotencyKey: "alakazam-quote-command-1" },
  );
  await client.createAlakazamCheckout(
    "project_1",
    "alakazam_quote_1",
    {
      acceptedDisclosureDigest: "a".repeat(64),
      siteSetupDigest: "e".repeat(64),
      ignoredPresentation: { buttonLabel: "Continue" },
    },
    { idempotencyKey: "alakazam-checkout-command-1" },
  );
  await client.scheduleAlakazamDowngrade(
    "project_1",
    "alakazam_quote_2",
    {
      acceptedDisclosureDigest: "b".repeat(64),
      quoteDigest: "c".repeat(64),
      ignoredPresentation: { refundLabel: "$0" },
    },
    { idempotencyKey: "alakazam-downgrade-command-1" },
  );

  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, "/api/v1/csrf");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "include");

  const quote = calls[1];
  assert.equal(quote.url, "/api/v1/projects/project_1/alakazam-quotes");
  assert.equal(quote.options.method, "POST");
  assert.equal(quote.options.credentials, "include");
  assert.equal(quote.options.headers["X-CSRF-Token"], "csrf_alakazam");
  assert.equal(
    quote.options.headers["Idempotency-Key"],
    "alakazam-quote-command-1",
  );
  assert.deepEqual(JSON.parse(quote.options.body), {
    targetTierId: "alakazam_25",
  });

  const checkout = calls[2];
  assert.equal(
    checkout.url,
    "/api/v1/projects/project_1/alakazam-quotes/alakazam_quote_1/checkout-command",
  );
  assert.equal(checkout.options.method, "POST");
  assert.equal(checkout.options.credentials, "include");
  assert.equal(checkout.options.headers["X-CSRF-Token"], "csrf_alakazam");
  assert.equal(
    checkout.options.headers["Idempotency-Key"],
    "alakazam-checkout-command-1",
  );
  assert.deepEqual(JSON.parse(checkout.options.body), {
    acceptedDisclosureDigest: "a".repeat(64),
    siteSetupDigest: "e".repeat(64),
  });

  const downgrade = calls[3];
  assert.equal(
    downgrade.url,
    "/api/v1/projects/project_1/alakazam-quotes/alakazam_quote_2/downgrade-schedule-command",
  );
  assert.equal(downgrade.options.method, "POST");
  assert.equal(downgrade.options.credentials, "include");
  assert.equal(
    downgrade.options.headers["X-CSRF-Token"],
    "csrf_alakazam",
  );
  assert.equal(
    downgrade.options.headers["Idempotency-Key"],
    "alakazam-downgrade-command-1",
  );
  assert.deepEqual(JSON.parse(downgrade.options.body), {
    acceptedDisclosureDigest: "b".repeat(64),
    quoteDigest: "c".repeat(64),
  });
});

test("Alakazam tier commerce recursively rejects claimed authority before fetch", () => {
  let fetchCalls = 0;
  const client = createClient({
    fetch: async () => {
      fetchCalls += 1;
      return response(200, { csrfToken: "must_not_be_requested" });
    },
    idempotencyFactory: () => "must-not-be-generated",
  });

  assert.throws(
    () => client.createAlakazamQuote(
      "project_1",
      {
        targetTierId: "alakazam_25",
        forged: { billing: [{ amountMinor: 2000 }] },
      },
      { idempotencyKey: "forged-quote-command" },
    ),
    (error) => error instanceof APIError && error.code === "OWNER_AUTHORITY_REJECTED",
  );
  assert.throws(
    () => client.scheduleAlakazamDowngrade(
      "project_1",
      "alakazam_quote_2",
      {
        acceptedDisclosureDigest: "b".repeat(64),
        quoteDigest: "c".repeat(64),
        forged: {
          amountMinor: 0,
          providerReference: "sub_sched_private",
        },
      },
      { idempotencyKey: "forged-downgrade-command" },
    ),
    (error) => error instanceof APIError && error.code === "OWNER_AUTHORITY_REJECTED",
  );
  assert.throws(
    () => client.createAlakazamCheckout(
      "project_1",
      "alakazam_quote_1",
      {
        acceptedDisclosureDigest: "a".repeat(64),
        siteSetupDigest: "e".repeat(64),
        forged: [{ nested: { providerReference: "checkout_provider_1" } }],
      },
      { idempotencyKey: "forged-checkout-command" },
    ),
    (error) => error instanceof APIError && error.code === "OWNER_AUTHORITY_REJECTED",
  );
  assert.equal(fetchCalls, 0);
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

test("custom-service assessment requests and quote acceptance use exact project routes without browser price authority", async () => {
  const calls = [];
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        return response(200, { csrfToken: "csrf_assessment" });
      }
      return response(200, { ok: true });
    },
    idempotencyFactory: () => "assessment-command-key"
  });

  await client.getCustomServicesAssessmentRequest("project_1");
  await client.saveCustomServicesAssessmentRequest("project_1", {
    approximatePublicSize: "one_to_ten",
    businessName: "Customer Business",
    complexityFlags: ["forms", "commerce", "forms"],
    customerObservation: "The phone layout feels crowded.",
    customerOwnershipAffirmed: true,
    expectedDraftRevision: 0,
    importantDate: null,
    platformFamily: "wordpress",
    primaryGoal: "Make services easier to understand.",
    publicUrl: "https://customer.example.com/",
    siteDisplayName: "Customer Website"
  });
  await client.submitCustomServicesAssessmentRequest(
    "project_1",
    1
  );
  await client.withdrawCustomServicesAssessmentRequest("project_1");
  await client.getCustomServicesAssessmentQuote("project_1");
  await client.getCustomServicesAssessmentInvoice("project_1");
  await client.acceptCustomServicesAssessmentQuote("project_1", {
    acceptanceStatement: "accepted_exact_quote_and_delivery_date",
    acceptedDisclosureDigest: "b".repeat(64),
    acceptedQuoteDigest: "a".repeat(64),
    quoteId: "50000000-0000-4000-8000-000000000001",
    quoteRevision: 2
  });

  const serviceCalls = calls.filter(({ url }) => url !== "/api/v1/csrf");
  assert.deepEqual(
    serviceCalls.map(({ url, options }) => [options.method, url]),
    [
      ["GET", "/api/v1/projects/project_1/custom-services/assessment-request"],
      ["PUT", "/api/v1/projects/project_1/custom-services/assessment-request"],
      ["POST", "/api/v1/projects/project_1/custom-services/assessment-request/submission"],
      ["POST", "/api/v1/projects/project_1/custom-services/assessment-request/withdrawal"],
      ["GET", "/api/v1/projects/project_1/custom-services/assessment-quote"],
      ["GET", "/api/v1/projects/project_1/custom-services/assessment-invoice"],
      ["POST", "/api/v1/projects/project_1/custom-services/assessment-quote/acceptance"]
    ]
  );
  assert.deepEqual(JSON.parse(serviceCalls[1].options.body), {
    approximatePublicSize: "one_to_ten",
    businessName: "Customer Business",
    complexityFlags: ["commerce", "forms"],
    customerObservation: "The phone layout feels crowded.",
    customerOwnershipAffirmed: true,
    expectedDraftRevision: 0,
    importantDate: null,
    platformFamily: "wordpress",
    primaryGoal: "Make services easier to understand.",
    publicUrl: "https://customer.example.com/",
    siteDisplayName: "Customer Website"
  });
  assert.deepEqual(JSON.parse(serviceCalls[2].options.body), {
    draftRevision: 1
  });
  assert.deepEqual(JSON.parse(serviceCalls[3].options.body), {});
  assert.deepEqual(JSON.parse(serviceCalls[6].options.body), {
    acceptanceStatement: "accepted_exact_quote_and_delivery_date",
    acceptedDisclosureDigest: "b".repeat(64),
    acceptedQuoteDigest: "a".repeat(64),
    quoteId: "50000000-0000-4000-8000-000000000001",
    quoteRevision: 2
  });
  for (const call of serviceCalls.filter(
    ({ options }) => ["PUT", "POST"].includes(options.method)
  )) {
    assert.equal(
      call.options.headers["X-CSRF-Token"],
      "csrf_assessment"
    );
    assert.equal(
      call.options.headers["Idempotency-Key"],
      "assessment-command-key"
    );
    const body = JSON.parse(call.options.body);
    assert.equal(Object.hasOwn(body, "amountMinor"), false);
    assert.equal(Object.hasOwn(body, "price"), false);
  }
});

test("assessment-backed Custom build commands use exact routes, bodies, and command identity without browser money authority", async () => {
  const calls = [];
  const commandIds = {
    issue: "10000000-0000-4000-8000-000000000001",
    void: "10000000-0000-4000-8000-000000000002",
    accept: "10000000-0000-4000-8000-000000000003"
  };
  const organizationId =
    "20000000-0000-4000-8000-000000000001";
  const jobId =
    "80000000-0000-4000-8000-000000000001";
  const quoteId =
    "50000000-0000-4000-8000-000000000001";
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        return response(200, { csrfToken: "csrf_custom_build" });
      }
      return response(200, { ok: true });
    },
    idempotencyFactory: () => {
      assert.fail("the body command ID must also fence the write header");
    }
  });

  await client.listOwnerCustomBuildOpportunities();
  await client.issueOwnerCustomBuildQuote(jobId, {
    commandId: commandIds.issue,
    organizationId,
    tierId: "scale",
    craftedPages: 16,
    sections: 64,
    uniqueLayouts: 16,
    contentWords: 7500,
    suppliedMedia: 64,
    scopeStatement:
      "Build the exact approved pages and sections in this bounded scope.",
    targetCompletionDate: "2026-09-15",
    expiresAt: "2026-08-19T16:00:00.000Z"
  });
  await client.voidOwnerCustomBuildQuote(quoteId, {
    commandId: commandIds.void,
    organizationId,
    reason: "The customer requested a corrected replacement scope."
  });
  await client.getCustomServicesCustomBuildQuote(
    "project_1"
  );
  await client.acceptCustomServicesCustomBuildQuote(
    "project_1",
    {
      acceptanceStatement: "accepted_exact_custom_build_quote",
      acceptedDisclosureDigest: "b".repeat(64),
      acceptedQuoteDigest: "a".repeat(64),
      commandId: commandIds.accept,
      quoteId,
      quoteRevision: 2
    }
  );

  const serviceCalls = calls.filter(
    ({ url }) => url !== "/api/v1/csrf"
  );
  assert.deepEqual(
    serviceCalls.map(({ url, options }) => [options.method, url]),
    [
      [
        "GET",
        "/api/v1/operator/custom-services/custom-build-opportunities"
      ],
      [
        "POST",
        `/api/v1/operator/custom-services/assessment-jobs/${jobId}/custom-build-quote`
      ],
      [
        "POST",
        `/api/v1/operator/custom-services/custom-build-quotes/${quoteId}/void`
      ],
      [
        "GET",
        "/api/v1/projects/project_1/custom-services/custom-build-quote"
      ],
      [
        "POST",
        "/api/v1/projects/project_1/custom-services/custom-build-quote/acceptance"
      ]
    ]
  );
  assert.deepEqual(JSON.parse(serviceCalls[1].options.body), {
    commandId: commandIds.issue,
    organizationId,
    tierId: "scale",
    craftedPages: 16,
    sections: 64,
    uniqueLayouts: 16,
    contentWords: 7500,
    suppliedMedia: 64,
    scopeStatement:
      "Build the exact approved pages and sections in this bounded scope.",
    targetCompletionDate: "2026-09-15",
    expiresAt: "2026-08-19T16:00:00.000Z"
  });
  assert.deepEqual(JSON.parse(serviceCalls[2].options.body), {
    commandId: commandIds.void,
    organizationId,
    reason: "The customer requested a corrected replacement scope."
  });
  assert.deepEqual(JSON.parse(serviceCalls[4].options.body), {
    acceptanceStatement: "accepted_exact_custom_build_quote",
    acceptedDisclosureDigest: "b".repeat(64),
    acceptedQuoteDigest: "a".repeat(64),
    commandId: commandIds.accept,
    quoteId,
    quoteRevision: 2
  });
  for (const [index, commandId] of [
    [1, commandIds.issue],
    [2, commandIds.void],
    [4, commandIds.accept]
  ]) {
    assert.equal(
      serviceCalls[index].options.headers["X-CSRF-Token"],
      "csrf_custom_build"
    );
    assert.equal(
      serviceCalls[index].options.headers["Idempotency-Key"],
      commandId
    );
    assert.doesNotMatch(
      serviceCalls[index].options.body,
      /amountMinor|currency|price|scaleUnits|taxState/u
    );
  }
});

test("Custom build API rejects unsupported authority and out-of-band footprint claims before fetch", () => {
  let calls = 0;
  const client = createClient({
    fetch: async () => {
      calls += 1;
      return response(200, { ok: true });
    }
  });
  const base = {
    commandId: "10000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
    tierId: "card",
    craftedPages: 1,
    sections: 5,
    uniqueLayouts: 1,
    contentWords: 500,
    suppliedMedia: 2,
    scopeStatement:
      "Build one exact card page inside the approved boundary.",
    targetCompletionDate: "2026-09-15",
    expiresAt: "2026-08-19T16:00:00.000Z"
  };
  assert.throws(
    () => client.issueOwnerCustomBuildQuote(
      "80000000-0000-4000-8000-000000000001",
      { ...base, amountMinor: 1 }
    ),
    (error) => error.code === "INVALID_INPUT"
  );
  assert.throws(
    () => client.issueOwnerCustomBuildQuote(
      "80000000-0000-4000-8000-000000000001",
      { ...base, craftedPages: 2 }
    ),
    (error) => error.code === "INVALID_INPUT"
  );
  assert.throws(
    () => client.issueOwnerCustomBuildQuote(
      "80000000-0000-4000-8000-000000000001",
      {
        ...base,
        tierId: "scale",
        craftedPages: 15,
        sections: 60,
        uniqueLayouts: 15,
        contentWords: 7000,
        suppliedMedia: 60
      }
    ),
    (error) => error.code === "INVALID_INPUT"
  );
  assert.equal(calls, 0);
});

test("assessment invoice checkout sends only the invoice digest with the caller's idempotency key", async () => {
  const calls = [];
  const invoiceId =
    "60000000-0000-4000-8000-000000000001";
  const checkoutResponse = {
    schema:
      "sitesourcery.custom-services-assessment-checkout/v1",
    state: "ready",
    checkout: {
      invoiceId,
      invoiceNumber:
        "SSA-60000000000040008000000000000001",
      url: "https://checkout.stripe.com/c/pay/assessment_test",
      expiresAt: "2026-08-05T18:00:00.000Z",
      subtotal: {
        amountMinor: 20000,
        currency: "USD",
        formatted: "$200.00"
      },
      tax: {
        state: "calculated_at_checkout",
        amountMinor: null
      },
      total: {
        state: "shown_at_checkout",
        amountMinor: null,
        currency: "USD"
      },
      chargeOccurred: false
    }
  };
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        return response(200, {
          csrfToken: "csrf_assessment_checkout"
        });
      }
      return response(200, checkoutResponse);
    },
    idempotencyFactory: () => {
      assert.fail("the explicit assessment checkout key must be preserved");
    }
  });

  const result =
    await client.createCustomServicesAssessmentCheckout(
      "project_1",
      invoiceId,
      { invoiceDigest: "c".repeat(64) },
      { idempotencyKey: "assessment-checkout-command-1" }
    );

  assert.deepEqual(result, checkoutResponse);
  assert.equal(calls.length, 2);
  const checkout = calls[1];
  assert.equal(
    checkout.url,
    "/api/v1/projects/project_1/custom-services/assessment-invoices/"
      + invoiceId
      + "/checkout-command"
  );
  assert.equal(checkout.options.method, "POST");
  assert.equal(checkout.options.credentials, "include");
  assert.equal(
    checkout.options.headers["X-CSRF-Token"],
    "csrf_assessment_checkout"
  );
  assert.equal(
    checkout.options.headers["Idempotency-Key"],
    "assessment-checkout-command-1"
  );
  assert.deepEqual(JSON.parse(checkout.options.body), {
    invoiceDigest: "c".repeat(64)
  });
  assert.throws(
    () => client.createCustomServicesAssessmentCheckout(
      "project_1",
      invoiceId,
      { invoiceDigest: "not-a-digest" },
      { idempotencyKey: "invalid-checkout-command" }
    ),
    (error) => error.code === "INVALID_INPUT"
  );
  assert.equal(calls.length, 2);
});

test("owner quote commands send only scope, delivery date, and review targets", async () => {
  const calls = [];
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/csrf") {
        return response(200, { csrfToken: "csrf_owner_quote" });
      }
      return response(200, { state: "issued" });
    },
    idempotencyFactory: () => "owner-quote-command-key"
  });

  await client.listOwnerAssessmentRequests();
  await client.issueOwnerAssessmentQuote(
    "30000000-0000-4000-8000-000000000001",
    {
      organizationId:
        "20000000-0000-4000-8000-000000000001",
      deliveryDate: "2026-08-20",
      reviewTargets: [
        { kind: "page", value: "/" },
        { kind: "page_type", value: "product" }
      ]
    }
  );

  const serviceCalls = calls.filter(
    ({ url }) => url !== "/api/v1/csrf"
  );
  assert.deepEqual(
    serviceCalls.map(({ url, options }) => [options.method, url]),
    [
      [
        "GET",
        "/api/v1/operator/custom-services/assessment-requests"
      ],
      [
        "POST",
        "/api/v1/operator/custom-services/assessment-requests/30000000-0000-4000-8000-000000000001/quote"
      ]
    ]
  );
  assert.deepEqual(JSON.parse(serviceCalls[1].options.body), {
    organizationId:
      "20000000-0000-4000-8000-000000000001",
    deliveryDate: "2026-08-20",
    reviewTargets: [
      { kind: "page", value: "/" },
      { kind: "page_type", value: "product" }
    ]
  });
  assert.equal(
    serviceCalls[1].options.headers["X-CSRF-Token"],
    "csrf_owner_quote"
  );
  assert.equal(
    serviceCalls[1].options.headers["Idempotency-Key"],
    "owner-quote-command-key"
  );
  assert.doesNotMatch(
    serviceCalls[1].options.body,
    /amount|currency|price|tax/iu
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
  await client.createDomainQuote(
    "project_1",
    { hostname: "Example.COM", years: 2 },
  );
  await client.saveRegistrantContact("org_1", "project_1", {
    name: "Customer Owner",
    email: "owner@example.com",
    phone: "+1 856 555 0100",
    addressLine1: "1 Main Street",
    city: "Camden",
    region: "NJ",
    postalCode: "08102",
    countryCode: "US",
  });
  await client.acceptDomainConsent("project_1", "quote_1", {
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
  await client.getDomainOrder("project_1", "order_1");
  await client.listDomainOrders("project_1");
  await client.refreshDomainPrice("project_1", "order_1");
  await client.requestDomainRegistration("project_1", "order_1", {
    priceCheckId: "price_check_1",
    irreversibleRegistrationAccepted: true,
  });
  await client.listDomains("org_1", "project_1");
  await client.getDomain("project_1", "domain_1");
  await client.listDnsRecords("project_1", "domain_1");
  await client.upsertDnsRecord("project_1", "domain_1", {
    type: "A",
    name: "@",
    content: "192.0.2.44",
    ttl: 3600,
  });
  await client.deleteDnsRecord(
    "project_1",
    "domain_1",
    "record_1",
  );

  const quote = calls.find((call) => call.url === "/api/v1/domain-quotes");
  assert.deepEqual(JSON.parse(quote.options.body), {
    projectId: "project_1",
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
    projectId: "project_1",
    priceCheckId: "price_check_1",
    irreversibleRegistrationAccepted: true,
  });
  for (const call of calls.slice(1)) {
    assert.equal(call.options.credentials, "include");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(call.options.method)) {
      assert.equal(call.options.headers["X-CSRF-Token"], "csrf_domain");
    }
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
  for (const call of calls.filter((candidate) =>
    /domain-orders|registrant-contacts|domain-quotes|domains/u.test(candidate.url)
  )) {
    const body = call.options.body
      ? JSON.parse(call.options.body)
      : null;
    assert.ok(
      call.url.includes("project_1")
        || body?.projectId === "project_1",
      call.url,
    );
  }
});
