import assert from "node:assert/strict";
import test from "node:test";

import {
  CARE_SURFACE_HTTP_ROUTES,
  createCareSurfacesHttpBoundary,
  matchCareSurfaceHttpRoute
} from "../care-surfaces-http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const USER = "10000000-0000-4000-8000-000000000001";
const SESSION_ORG = "20000000-0000-4000-8000-000000000001";
const TARGET_ORG = "20000000-0000-4000-8000-000000000099";
const PERIOD = "30000000-0000-4000-8000-000000000001";
const TICKET = "40000000-0000-4000-8000-000000000001";

function service() {
  const calls = [];
  const selected = { calls };
  for (const method of [
    "allocateCapacity", "closePeriod", "openPeriod", "openTicket",
    "readCustomer", "readOperator", "requestCustomerTicket",
    "reserveTicketMail", "transitionTicket"
  ]) {
    selected[method] = async (...args) => {
      calls.push([method, ...args]);
      return { method, providerEffects: false };
    };
  }
  return selected;
}

function boundary({ signedIn = true, guarded = true } = {}) {
  const selected = service();
  const guardCalls = [];
  return {
    guardCalls,
    service: selected,
    boundary: createCareSurfacesHttpBoundary({
      service: selected,
      async authenticate() {
        return signedIn
          ? { userId: USER, organizationId: SESSION_ORG }
          : null;
      },
      async requireWriteGuard(request, actor) {
        guardCalls.push({ request, actor });
        return guarded;
      }
    })
  };
}

function request(path, {
  body = {},
  csrf = true,
  idempotencyKey = "care.http.command.0001",
  method = "POST"
} = {}) {
  const headers = {};
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    if (csrf) headers["X-CSRF-Token"] = "c".repeat(32);
    if (idempotencyKey !== null) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
  }
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body) : undefined
  });
}

test("Care HTTP manifest is closed, distinct, and contains no release route", () => {
  assert.equal(CARE_SURFACE_HTTP_ROUTES.length, 9);
  assert.equal(new Set(CARE_SURFACE_HTTP_ROUTES.map(
    (route) => `${route.method} ${route.pattern}`
  )).size, 9);
  assert.equal(
    CARE_SURFACE_HTTP_ROUTES.some((route) =>
      /quote|payment|provider|send|publish|release/u.test(route.operation)
    ),
    false
  );
  assert.deepEqual(
    matchCareSurfaceHttpRoute(
      "POST",
      `/api/v1/operator/care/organizations/${TARGET_ORG}/periods/${PERIOD}/capacity`
    ).params,
    { organizationId: TARGET_ORG, periodId: PERIOD }
  );
  assert.equal(
    matchCareSurfaceHttpRoute("GET", "/api/v1/care?organizationId=forged"),
    null
  );
});

test("customer and operator reads authenticate and preserve separate org authority", async () => {
  const fixture = boundary();
  const customer = await fixture.boundary.dispatch(request(
    "/api/v1/care",
    { method: "GET" }
  ));
  assert.equal(customer.status, 200);
  assert.deepEqual(fixture.service.calls[0], [
    "readCustomer",
    { userId: USER, organizationId: SESSION_ORG }
  ]);
  const operator = await fixture.boundary.dispatch(request(
    `/api/v1/operator/care/organizations/${TARGET_ORG}`,
    { method: "GET" }
  ));
  assert.equal(operator.status, 200);
  assert.deepEqual(fixture.service.calls[1], [
    "readOperator",
    { userId: USER, organizationId: SESSION_ORG },
    TARGET_ORG
  ]);
  assert.equal(operator.headers.get("cache-control"), "no-store");

  const signedOut = boundary({ signedIn: false });
  await assert.rejects(
    signedOut.boundary.dispatch(request("/api/v1/care", { method: "GET" })),
    (error) => error.code === "AUTHENTICATION_REQUIRED" && error.status === 401
  );
  assert.equal(signedOut.service.calls.length, 0);
});

test("every write requires the injected CSRF/write guard and idempotency key", async () => {
  const denied = boundary({ guarded: false });
  await assert.rejects(
    denied.boundary.dispatch(request(
      `/api/v1/operator/care/organizations/${TARGET_ORG}/tickets`
    )),
    (error) => error.code === "CARE_WRITE_GUARD_REQUIRED" && error.status === 403
  );
  assert.equal(denied.service.calls.length, 0);

  const missingKey = boundary();
  await assert.rejects(
    missingKey.boundary.dispatch(request(
      `/api/v1/operator/care/organizations/${TARGET_ORG}/tickets`,
      { idempotencyKey: null }
    )),
    (error) => error.code === "IDEMPOTENCY_KEY_REQUIRED"
  );
  assert.equal(missingKey.service.calls.length, 0);
});

test("operator command routing derives org and resource IDs only from the path", async () => {
  const fixture = boundary();
  const routes = [
    {
      method: "openPeriod",
      path: `/api/v1/operator/care/organizations/${TARGET_ORG}/periods`,
      args: 2
    },
    {
      method: "closePeriod",
      path: `/api/v1/operator/care/organizations/${TARGET_ORG}/periods/${PERIOD}/closure`,
      resource: PERIOD,
      args: 3
    },
    {
      method: "openTicket",
      path: `/api/v1/operator/care/organizations/${TARGET_ORG}/tickets`,
      args: 2
    },
    {
      method: "transitionTicket",
      path: `/api/v1/operator/care/organizations/${TARGET_ORG}/tickets/${TICKET}/transitions`,
      resource: TICKET,
      args: 3
    },
    {
      method: "allocateCapacity",
      path: `/api/v1/operator/care/organizations/${TARGET_ORG}/periods/${PERIOD}/capacity`,
      resource: PERIOD,
      args: 3
    },
    {
      method: "reserveTicketMail",
      path: `/api/v1/operator/care/organizations/${TARGET_ORG}/tickets/${TICKET}/mail-reservations`,
      resource: TICKET,
      args: 3
    }
  ];
  for (const [index, route] of routes.entries()) {
    const response = await fixture.boundary.dispatch(request(route.path, {
      body: { localEvidence: index },
      idempotencyKey: `care.http.command.000${index + 1}`
    }));
    assert.equal(response.status, 201);
    const call = fixture.service.calls[index];
    assert.equal(call[0], route.method);
    assert.equal(call.length, route.args + 1);
    assert.deepEqual(call[1], {
      userId: USER,
      organizationId: SESSION_ORG
    });
    if (route.resource) assert.equal(call[2], route.resource);
    const input = call.at(-1);
    assert.equal(input.organizationId, TARGET_ORG);
    assert.equal(input.commandId, `care.http.command.000${index + 1}`);
    assert.deepEqual(input.body, { localEvidence: index });
  }
});

test("customer ticket route stays behind the same authenticated write fence", async () => {
  const fixture = boundary();
  const response = await fixture.boundary.dispatch(request(
    "/api/v1/care/tickets",
    { body: {} }
  ));
  assert.equal(response.status, 201);
  assert.deepEqual(fixture.service.calls[0].slice(0, 2), [
    "requestCustomerTicket",
    { userId: USER, organizationId: SESSION_ORG }
  ]);
  assert.deepEqual(fixture.service.calls[0][2], {
    organizationId: SESSION_ORG,
    commandId: "care.http.command.0001",
    body: {}
  });
});

test("unknown, queried, malformed, and over-limit bodies fail before service dispatch", async () => {
  const fixture = boundary();
  assert.equal(
    await fixture.boundary.dispatch(request("/api/v1/not-care", { method: "GET" })),
    null
  );
  assert.equal(
    await fixture.boundary.dispatch(request("/api/v1/care?organizationId=x", {
      method: "GET"
    })),
    null
  );
  const oversized = request(
    `/api/v1/operator/care/organizations/${TARGET_ORG}/tickets`,
    { body: { value: "x".repeat(33 * 1024) } }
  );
  await assert.rejects(
    fixture.boundary.dispatch(oversized),
    (error) => error.code === "CARE_SURFACE_INVALID" && error.status === 413
  );
  assert.equal(fixture.service.calls.length, 0);
});
