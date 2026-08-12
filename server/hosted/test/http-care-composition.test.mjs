import assert from "node:assert/strict";
import test from "node:test";

import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION = "care-session-token-000000000000000000000000";
const USER = "10000000-0000-4000-8000-000000000001";
const ORG_A = "20000000-0000-4000-8000-000000000001";
const ORG_B = "20000000-0000-4000-8000-000000000002";
const TARGET_ORG = "20000000-0000-4000-8000-000000000099";

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

function careSurfaces() {
  const calls = [];
  const service = {
    calls,
    kind: "care-surfaces",
    mode: "held-local",
    customerEffects: false,
    mailDeliveryEffects: false,
    paymentEffects: false,
    providerEffects: false,
    async readiness() {
      return {
        ready: true,
        verified: true,
        customerEffects: false,
        mailReservation: {
          deliveryEffects: false,
          providerEffects: false
        },
        paymentEffects: false,
        providerEffects: false
      };
    }
  };
  for (const method of [
    "allocateCapacity", "closePeriod", "openPeriod", "openTicket",
    "readCustomer", "readOperator", "requestCustomerTicket",
    "reserveTicketMail", "transitionTicket"
  ]) {
    service[method] = async (...args) => {
      calls.push([method, ...args]);
      return { method, providerEffects: false };
    };
  }
  return service;
}

function get(path, { organizationId = null, signedIn = true } = {}) {
  return new Request(`${ORIGIN}${path}`, {
    headers: {
      ...(signedIn ? { Cookie: `ss_session=${SESSION}` } : {}),
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
      "Idempotency-Key": "care.root.command.0001",
      ...(csrf ? { "X-CSRF-Token": token } : {}),
      ...(organizationId === null
        ? {}
        : { "X-SiteSourcery-Organization-Id": organizationId })
    },
    body: JSON.stringify(body)
  });
}

test("Care root derives a single customer organization and preserves root headers", async () => {
  const canonical = canonicalService();
  const care = careSurfaces();
  const api = createHostedApi(canonical, { careSurfaces: care });
  const response = await api.fetch(get("/api/v1/care"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-request-id"), /^req_/u);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(care.calls, [[
    "readCustomer",
    { userId: USER, organizationId: ORG_A }
  ]]);
});

test("Care root requires and verifies explicit tenant selection for multi-org customers", async () => {
  const canonical = canonicalService([ORG_A, ORG_B]);
  const care = careSurfaces();
  const api = createHostedApi(canonical, { careSurfaces: care });

  const ambiguous = await api.fetch(get("/api/v1/care"));
  assert.equal(ambiguous.status, 409);
  assert.equal(
    (await ambiguous.json()).error.code,
    "CARE_ORGANIZATION_SELECTION_REQUIRED"
  );

  const selected = await api.fetch(get("/api/v1/care", {
    organizationId: ORG_B
  }));
  assert.equal(selected.status, 200);
  assert.deepEqual(care.calls, [[
    "readCustomer",
    { userId: USER, organizationId: ORG_B }
  ]]);

  const forged = await api.fetch(get("/api/v1/care", {
    organizationId: TARGET_ORG
  }));
  assert.equal(forged.status, 404);
  assert.equal((await forged.json()).error.code, "NOT_FOUND");
  assert.equal(care.calls.length, 1);
});

test("Care root enforces same-origin, CSRF, idempotency, and one body consumer", async () => {
  const canonical = canonicalService();
  const care = careSurfaces();
  const api = createHostedApi(canonical, { careSurfaces: care });

  const crossOrigin = await api.fetch(post(
    "/api/v1/care/tickets",
    {},
    { origin: "https://attacker.test" }
  ));
  assert.equal(crossOrigin.status, 403);
  assert.equal(
    (await crossOrigin.json()).error.code,
    "CROSS_ORIGIN_REQUEST_REJECTED"
  );

  const missingCsrf = await api.fetch(post(
    "/api/v1/care/tickets",
    {},
    { csrf: false }
  ));
  assert.equal(missingCsrf.status, 403);
  assert.equal((await missingCsrf.json()).error.code, "CSRF_TOKEN_REQUIRED");

  const accepted = await api.fetch(post(
    "/api/v1/care/tickets",
    { noteDigest: "d".repeat(64) }
  ));
  assert.equal(accepted.status, 201);
  assert.deepEqual(care.calls, [[
    "requestCustomerTicket",
    { userId: USER, organizationId: ORG_A },
    {
      organizationId: ORG_A,
      commandId: "care.root.command.0001",
      body: { noteDigest: "d".repeat(64) }
    }
  ]]);
});

test("Care operator paths supply only the target organization to capability authority", async () => {
  const canonical = canonicalService([ORG_A, ORG_B]);
  const care = careSurfaces();
  const api = createHostedApi(canonical, { careSurfaces: care });
  const response = await api.fetch(get(
    `/api/v1/operator/care/organizations/${TARGET_ORG}`
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(care.calls, [[
    "readOperator",
    { userId: USER, organizationId: TARGET_ORG },
    TARGET_ORG
  ]]);
  assert.equal(
    canonical.calls.some(([method]) => method === "listOrganizations"),
    false
  );
});

test("Care root rejects any composition that can claim external effects", () => {
  const unsafe = careSurfaces();
  unsafe.providerEffects = true;
  assert.throws(
    () => createHostedApi(canonicalService(), { careSurfaces: unsafe }),
    (error) => error?.code === "RUNTIME_CONFIGURATION_ERROR"
  );
});
