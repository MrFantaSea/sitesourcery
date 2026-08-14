import assert from "node:assert/strict";
import test from "node:test";

import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION = "responder-session-token-000000000000000000";
const USER = "10000000-0000-4000-8000-000000000001";
const ORG_A = "20000000-0000-4000-8000-000000000001";
const ORG_B = "20000000-0000-4000-8000-000000000002";
const TARGET_ORG = "20000000-0000-4000-8000-000000000099";
const PROJECT = "30000000-0000-4000-8000-000000000001";
const CUSTOMER = "40000000-0000-4000-8000-000000000001";
const QUOTE = "50000000-0000-4000-8000-000000000001";

function canonicalService(organizationIds = [ORG_A]) {
  const calls = [];
  return {
    calls,
    async authenticate(token) {
      calls.push(["authenticate", token]);
      return token === SESSION ? { userId: USER } : null;
    },
    async listOrganizations(actor) {
      calls.push(["listOrganizations", actor]);
      return {
        organizations: organizationIds.map((id) => ({ id, state: "active" }))
      };
    }
  };
}

function responderSurfaces() {
  const calls = [];
  const service = {
    calls,
    kind: "responder-surfaces",
    mode: "held",
    providerEffects: false,
    billingEffects: false,
    sellable: false,
    async readiness() {
      return {
        ready: true,
        verified: true,
        providerEffects: false,
        billingEffects: false,
        sellable: false
      };
    }
  };
  for (const method of [
    "engageGlobalKill", "readCustomer", "readOperator",
    "recordCustomerConsent", "recordOperatorConsent", "requestHandoff",
    "reserveHeldMessage", "stop"
  ]) {
    service[method] = async (...args) => {
      calls.push([method, ...args]);
      return { method, providerEffects: false };
    };
  }
  return service;
}

function responderCommerce() {
  const calls = [];
  const service = {
    calls,
    kind: "responder-commerce",
    mode: "held-local",
    commercialEffects: false,
    customerEffects: false,
    mailDeliveryEffects: false,
    paymentEffects: false,
    providerEffects: false,
    async readiness() {
      return {
        ready: true,
        verified: true,
        durableCommercialState: true,
        catalogAuthorityVerified: true,
        taxPurposeReleased: false,
        sellable: false,
        commercialEffects: false,
        customerEffects: false,
        mailDeliveryEffects: false,
        paymentEffects: false,
        providerEffects: false
      };
    }
  };
  for (const method of [
    "cancelHeldReservation", "createHeldQuote", "markReservationAmbiguous",
    "readCustomerQuote", "readCustomerReservation", "readOperatorCatalog",
    "requestReversal", "reserveHeldBilling"
  ]) {
    service[method] = async (...args) => {
      calls.push([method, ...args]);
      return { method, providerEffects: false };
    };
  }
  return service;
}

function get(path, { organizationId = null } = {}) {
  return new Request(`${ORIGIN}${path}`, {
    headers: {
      Cookie: `ss_session=${SESSION}`,
      ...(organizationId === null
        ? {}
        : { "X-SiteSourcery-Organization-Id": organizationId })
    }
  });
}

function post(path, body, {
  csrf = true,
  origin = ORIGIN,
  organizationId = null
} = {}) {
  const token = "c".repeat(32);
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      Cookie: `ss_session=${SESSION}; ss_csrf=${token}`,
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": "responder.root.command.0001",
      ...(csrf ? { "X-CSRF-Token": token } : {}),
      ...(organizationId === null
        ? {}
        : { "X-SiteSourcery-Organization-Id": organizationId })
    },
    body: JSON.stringify(body)
  });
}

test("Responder root derives one customer organization and preserves root headers", async () => {
  const canonical = canonicalService();
  const responder = responderSurfaces();
  const api = createHostedApi(canonical, { responderSurfaces: responder });
  const response = await api.fetch(get("/api/v1/responder"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-request-id"), /^req_/u);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(responder.calls, [[
    "readCustomer",
    { userId: USER, organizationId: ORG_A }
  ]]);
});

test("Responder root requires and verifies explicit multi-org selection", async () => {
  const responder = responderSurfaces();
  const api = createHostedApi(canonicalService([ORG_A, ORG_B]), {
    responderSurfaces: responder
  });
  const ambiguous = await api.fetch(get("/api/v1/responder"));
  assert.equal(ambiguous.status, 409);
  assert.equal(
    (await ambiguous.json()).error.code,
    "RESPONDER_ORGANIZATION_SELECTION_REQUIRED"
  );
  const selected = await api.fetch(get("/api/v1/responder", {
    organizationId: ORG_B
  }));
  assert.equal(selected.status, 200);
  assert.deepEqual(responder.calls, [[
    "readCustomer",
    { userId: USER, organizationId: ORG_B }
  ]]);
  const forged = await api.fetch(get("/api/v1/responder", {
    organizationId: TARGET_ORG
  }));
  assert.equal(forged.status, 404);
  assert.equal((await forged.json()).error.code, "NOT_FOUND");
  assert.equal(responder.calls.length, 1);
});

test("Responder root enforces same-origin, CSRF, idempotency, and one body consumer", async () => {
  const responder = responderSurfaces();
  const api = createHostedApi(canonicalService(), {
    responderSurfaces: responder
  });
  const path = "/api/v1/responder/contacts";
  const crossOrigin = await api.fetch(post(path, {}, {
    origin: "https://attacker.test"
  }));
  assert.equal(crossOrigin.status, 403);
  assert.equal(
    (await crossOrigin.json()).error.code,
    "CROSS_ORIGIN_REQUEST_REJECTED"
  );
  const missingCsrf = await api.fetch(post(path, {}, { csrf: false }));
  assert.equal(missingCsrf.status, 403);
  assert.equal((await missingCsrf.json()).error.code, "CSRF_TOKEN_REQUIRED");
  const accepted = await api.fetch(post(path, {
    projectId: "30000000-0000-4000-8000-000000000001",
    routeDigest: "a".repeat(64)
  }));
  assert.equal(accepted.status, 200);
  assert.deepEqual(responder.calls, [[
    "recordCustomerConsent",
    { userId: USER, organizationId: ORG_A },
    {
      organizationId: ORG_A,
      commandId: "responder.root.command.0001",
      body: {
        projectId: "30000000-0000-4000-8000-000000000001",
        routeDigest: "a".repeat(64)
      }
    }
  ]]);
});

test("Responder operator paths preserve route organization for capability checks", async () => {
  const canonical = canonicalService([ORG_A, ORG_B]);
  const responder = responderSurfaces();
  const api = createHostedApi(canonical, { responderSurfaces: responder });
  const response = await api.fetch(get(
    `/api/v1/operator/responder/organizations/${TARGET_ORG}`
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(responder.calls, [[
    "readOperator",
    { userId: USER, organizationId: TARGET_ORG },
    TARGET_ORG
  ]]);
  assert.equal(
    canonical.calls.some(([method]) => method === "listOrganizations"),
    false
  );
});

test("Responder commerce narrows production authentication metadata to exact tenant authority", async () => {
  const canonical = canonicalService();
  canonical.authenticate = async () => ({
    userId: USER,
    sessionId: "70000000-0000-4000-8000-000000000001",
    sessionDigest: "s".repeat(64),
    expiresAt: "2026-08-15T00:00:00.000Z",
    reauthenticatedAt: "2026-08-14T18:00:00.000Z",
    user: { email: "private@example.test" }
  });
  const commerce = responderCommerce();
  const api = createHostedApi(canonical, { responderCommerce: commerce });
  const customerResponse = await api.fetch(get(
    `/api/v1/responder/projects/${PROJECT}/commerce/quotes/${QUOTE}`
  ));
  assert.equal(customerResponse.status, 200);
  const operatorResponse = await api.fetch(get(
    `/api/v1/operator/responder/organizations/${TARGET_ORG}` +
      `/projects/${PROJECT}/customers/${CUSTOMER}/commerce/catalog`
  ));
  assert.equal(operatorResponse.status, 200);
  assert.deepEqual(commerce.calls, [
    [
      "readCustomerQuote",
      { userId: USER, organizationId: ORG_A },
      { projectId: PROJECT, quoteId: QUOTE }
    ],
    [
      "readOperatorCatalog",
      { userId: USER, organizationId: TARGET_ORG },
      {
        customerUserId: CUSTOMER,
        organizationId: TARGET_ORG,
        projectId: PROJECT
      }
    ]
  ]);
  assert.equal(JSON.stringify(commerce.calls).includes("private@example.test"), false);
  assert.equal(JSON.stringify(commerce.calls).includes("sessionDigest"), false);
});

test("Responder root rejects any composition claiming external effects", () => {
  const unsafe = responderSurfaces();
  unsafe.billingEffects = true;
  assert.throws(
    () => createHostedApi(canonicalService(), {
      responderSurfaces: unsafe
    }),
    (error) => error?.code === "RUNTIME_CONFIGURATION_ERROR"
  );
});
