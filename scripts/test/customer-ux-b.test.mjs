import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  APIError,
  createClient
} = require("../../abracadabra/app/abracadabra-api.js");
const {
  createHostedControl
} = require("../../abracadabra/app/abracadabra-hosted-control.js");
const customer = require(
  "../../abracadabra/app/abracadabra-customer-control-dom.js"
);

const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const OBSERVED_AT = "2026-08-10T16:00:00.000Z";

function authority() {
  return {
    schema: "sitesourcery.project-legal-authority/v4",
    acceptanceStatement:
      "accepted_exact_project_terms_and_acknowledged_privacy",
    authorityDigest: "a".repeat(64),
    documents: []
  };
}

function project(revision = 1) {
  return {
    id: PROJECT_ID,
    projectId: PROJECT_ID,
    name: "Customer project",
    revision,
    draft: { revision, rawFacts: {} },
    versions: []
  };
}

function baseApi(overrides = {}) {
  return {
    me: async () => ({
      user: {
        id: "10000000-0000-4000-8000-000000000001",
        email: "customer@example.test"
      }
    }),
    getProjectLegalAuthority: async () => authority(),
    listOrganizations: async () => ({
      organizations: [{
        id: "20000000-0000-4000-8000-000000000001",
        name: "Customer organization"
      }]
    }),
    listProjects: async () => ({ projects: [project()] }),
    getProject: async () => ({ project: project() }),
    ...overrides
  };
}

test("Checkout context accepts only a fresh exact non-secret project projection", () => {
  const context = customer.createCustomerCheckoutContext(
    "download",
    PROJECT_ID,
    "2026-08-10T15:30:00.000Z"
  );
  assert.deepEqual(context, {
    schema: "sitesourcery.customer-checkout-context/v1",
    kind: "download",
    projectId: PROJECT_ID,
    createdAt: "2026-08-10T15:30:00.000Z"
  });
  assert.deepEqual(
    customer.customerCheckoutContext(context, OBSERVED_AT),
    context
  );
  for (const invalid of [
    { ...context, providerId: "cs_test_forbidden" },
    { ...context, kind: "alakazam" },
    { ...context, projectId: "project_1" },
    { ...context, createdAt: "2026-08-08T15:30:00.000Z" }
  ]) {
    assert.equal(
      customer.customerCheckoutContext(invalid, OBSERVED_AT),
      null
    );
  }
});

test("cancel returns are contextual only from exact local context and reject mixed success identity", () => {
  const context = customer.createCustomerCheckoutContext(
    "assessment",
    PROJECT_ID,
    "2026-08-10T15:30:00.000Z"
  );
  assert.deepEqual(
    customer.customerCheckoutCancellationFromLocation(
      { search: "?keep=1&checkout=cancelled" },
      context,
      OBSERVED_AT
    ),
    {
      kind: "assessment",
      projectId: PROJECT_ID,
      state: "cancelled"
    }
  );
  assert.deepEqual(
    customer.customerCheckoutCancellationFromLocation(
      { search: "?domainPayment=cancelled" },
      null,
      OBSERVED_AT
    ),
    { kind: "domain", projectId: "", state: "cancelled" }
  );
  for (const search of [
    "?checkout=cancelled&checkout=cancelled",
    "?checkout=cancelled&download_project=" + PROJECT_ID,
    "?checkout=cancelled&domainPayment=cancelled",
    "?checkout=cs_test_return_1"
  ]) {
    assert.equal(
      customer.customerCheckoutCancellationFromLocation(
        { search },
        context,
        OBSERVED_AT
      ),
      null
    );
  }
  assert.equal(
    customer.locationWithoutCustomerCheckoutState({
      pathname: "/abracadabra/app/",
      search: "?keep=1&checkout=cancelled",
      hash: "#account"
    }),
    "/abracadabra/app/?keep=1#account"
  );
});

test("success-return recognition is exact and never treats cancel as payment evidence", () => {
  assert.equal(
    customer.customerCheckoutSuccessFromLocation({
      search:
        "?checkout=cs_test_download_1&download_project=" +
        PROJECT_ID
    }),
    true
  );
  assert.equal(
    customer.customerCheckoutSuccessFromLocation({
      search:
        "?checkout=cs_test_custom_1&custom_build_project=" +
        PROJECT_ID
    }),
    true
  );
  for (const search of [
    "?checkout=cancelled",
    "?checkout=cs_test_1",
    "?checkout=cs_test_1&download_project=" + PROJECT_ID +
      "&custom_build_project=" + PROJECT_ID,
    "?checkout=cs_test_1&download_project=" + PROJECT_ID +
      "&download_project=" + PROJECT_ID,
    "?checkout=cs_test_1&download_project=project_1",
    "?checkout=cs_test_1&checkout=cs_test_2&download_project=" +
      PROJECT_ID
  ]) {
    assert.equal(
      customer.customerCheckoutSuccessFromLocation({ search }),
      false
    );
  }
});

test("cancel, decline, abandon, and no-charge presentations preserve server authority", () => {
  const expectations = {
    cancelled: /did not confirm a payment or start fulfillment/u,
    declined: /exact added-work decision was confirmed declined/u,
    abandoned: /did not return with a verified result/u,
    no_charge: /verified project record shows a zero balance/u
  };
  for (const [state, pattern] of Object.entries(expectations)) {
    const shown = customer.customerCheckoutExperiencePresentation(
      state,
      state === "declined"
        ? "custom_build_change"
        : state === "no_charge"
          ? "custom_build_final"
          : "download"
    );
    assert.equal(shown.state, state);
    assert.match(shown.message, pattern);
    assert.doesNotMatch(
      shown.message,
      /payment succeeded|access granted|provider confirmed/u
    );
  }
});

test("binary project export requests use the bounded retryable deadline", async () => {
  let signal = null;
  const client = createClient({
    fetch: async (_url, options) =>
      new Promise((_resolve, reject) => {
        signal = options.signal;
        options.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), {
            name: "AbortError"
          }));
        }, { once: true });
      }),
    setTimeout(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {}
  });
  await assert.rejects(
    () => client.downloadExport(
      PROJECT_ID,
      "40000000-0000-4000-8000-000000000001",
      "bounded-download-token"
    ),
    (error) => error instanceof APIError
      && error.code === "REQUEST_TIMEOUT"
      && error.retryable === true
  );
  assert.equal(signal.aborted, true);
});

test("binary project export body reads cannot outlive the request deadline", async () => {
  let expire = null;
  const client = createClient({
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: {
        get(name) {
          if (name.toLowerCase() === "content-type") {
            return "application/zip";
          }
          if (name.toLowerCase() === "content-length") {
            return "128";
          }
          return null;
        }
      },
      async blob() {
        expire();
        throw Object.assign(new Error("aborted"), {
          name: "AbortError"
        });
      }
    }),
    setTimeout(callback) {
      expire = callback;
      return 1;
    },
    clearTimeout() {}
  });
  await assert.rejects(
    () => client.downloadExport(
      PROJECT_ID,
      "40000000-0000-4000-8000-000000000002",
      "bounded-body-token"
    ),
    (error) => error instanceof APIError
      && error.code === "REQUEST_TIMEOUT"
      && error.retryable === true
  );
});

test("refreshSession reopens only the still-authorized selected project with fresh truth", async () => {
  let remoteRevision = 1;
  const control = createHostedControl({
    api: baseApi({
      listProjects: async () => ({
        projects: [project(remoteRevision)]
      }),
      getProject: async () => ({
        project: project(remoteRevision)
      })
    }),
    idempotencyFactory: () =>
      "50000000-0000-4000-8000-000000000001"
  });
  await control.boot();
  await control.selectProject(PROJECT_ID);
  remoteRevision = 2;
  const refreshed = await control.refreshSession();
  assert.equal(refreshed.project.id, PROJECT_ID);
  assert.equal(refreshed.project.revision, 2);
  assert.equal(refreshed.phase, "ready");
});

test("refreshSession drops a project removed on another device", async () => {
  let available = true;
  const control = createHostedControl({
    api: baseApi({
      listProjects: async () => ({
        projects: available ? [project()] : []
      })
    }),
    idempotencyFactory: () =>
      "50000000-0000-4000-8000-000000000002"
  });
  await control.boot();
  await control.selectProject(PROJECT_ID);
  available = false;
  const refreshed = await control.refreshSession();
  assert.equal(refreshed.project, null);
  assert.equal(refreshed.selectedVersionId, null);
  assert.deepEqual(refreshed.projects, []);
});

test("an authenticated 401 clears stale project authority and requires sign-in", async () => {
  const control = createHostedControl({
    api: baseApi({
      createSupportTicket: async () => {
        throw Object.assign(new Error("Sign in to continue."), {
          code: "AUTHENTICATION_REQUIRED",
          status: 401,
          retryable: false
        });
      }
    }),
    idempotencyFactory: () =>
      "50000000-0000-4000-8000-000000000003"
  });
  await control.boot();
  await control.selectProject(PROJECT_ID);
  await assert.rejects(
    () => control.createSupportTicket({
      subject: "Project help",
      message: "Please help with this project."
    }),
    (error) => error.code === "AUTHENTICATION_REQUIRED"
  );
  const state = control.getState();
  assert.equal(state.phase, "signed-out");
  assert.equal(state.account, null);
  assert.equal(state.project, null);
  assert.deepEqual(state.projects, []);
  assert.equal(
    state.operations.createSupportTicket.error.code,
    "AUTHENTICATION_REQUIRED"
  );
});

test("customer routes use only existing support/export APIs and reviewed manual contact", async () => {
  const [domSource, controlSource, apiSource] = await Promise.all([
    readFile(new URL(
      "../../abracadabra/app/abracadabra-customer-control-dom.js",
      import.meta.url
    ), "utf8"),
    readFile(new URL(
      "../../abracadabra/app/abracadabra-hosted-control.js",
      import.meta.url
    ), "utf8"),
    readFile(new URL(
      "../../abracadabra/app/abracadabra-api.js",
      import.meta.url
    ), "utf8")
  ]);
  for (const marker of [
    "data-customer-create-support-ticket",
    "data-customer-request-export",
    "data-customer-refresh-export",
    "data-customer-download-export",
    "data-customer-retry-export",
    "data-customer-account-delete-route",
    "data-customer-privacy-request-route"
  ]) {
    assert.ok(domSource.includes(marker), marker);
  }
  assert.match(domSource, /\/legal\/privacy\/#contact/u);
  assert.match(domSource, /\/contact\/#direct-contact/u);
  assert.doesNotMatch(
    domSource,
    /client\.(?:deleteAccount|createPrivacyRequest)\(/u
  );
  assert.match(controlSource, /api\.createSupportTicket\(/u);
  assert.match(controlSource, /api\.requestExport\(/u);
  assert.match(apiSource, /\/support-tickets/u);
  assert.match(apiSource, /\/exports/u);
});
