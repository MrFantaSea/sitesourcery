import assert from "node:assert/strict";
import test from "node:test";

import {
  RESPONDER_SURFACE_HTTP_ROUTES,
  createResponderSurfacesHttpBoundary,
  matchResponderSurfaceHttpRoute
} from "../responder-surfaces-http.mjs";

const IDS = Object.freeze({
  authority: "10000000-0000-4000-8000-000000000001",
  customer: "20000000-0000-4000-8000-000000000001",
  interaction: "30000000-0000-4000-8000-000000000001",
  organization: "40000000-0000-4000-8000-000000000001"
});

function fixture({ authenticated = true, guarded = true } = {}) {
  const calls = [];
  const service = {
    providerEffects: false,
    billingEffects: false,
    sellable: false,
    readCustomer(...args) {
      calls.push(["readCustomer", ...args]);
      return { audience: "customer", providerEffects: false };
    },
    readOperator(...args) {
      calls.push(["readOperator", ...args]);
      return { audience: "operator", providerEffects: false };
    }
  };
  for (const method of [
    "engageGlobalKill", "recordCustomerConsent", "recordOperatorConsent",
    "requestHandoff", "reserveHeldMessage", "stop"
  ]) {
    service[method] = (...args) => {
      calls.push([method, ...args]);
      return { operation: method, providerEffects: false };
    };
  }
  const actor = {
    userId: IDS.customer,
    organizationId: IDS.organization
  };
  const boundary = createResponderSurfacesHttpBoundary({
    service,
    authenticate: async (request) => {
      calls.push(["authenticate", new URL(request.url).pathname]);
      return authenticated ? actor : null;
    },
    requireWriteGuard: async (request, selected) => {
      calls.push(["writeGuard", request.method, selected.userId]);
      return guarded;
    }
  });
  return { actor, boundary, calls };
}

function request(path, {
  body = undefined,
  headers = {},
  method = body === undefined ? "GET" : "POST"
} = {}) {
  return new Request(`https://hosted.example${path}`, {
    method,
    headers: body === undefined ? headers : {
      "content-type": "application/json",
      "idempotency-key": "responder-http-command-0001",
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

test("route manifest is unique, authenticated, bounded, and has no effect route", () => {
  assert.equal(RESPONDER_SURFACE_HTTP_ROUTES.length, 11);
  assert.equal(new Set(RESPONDER_SURFACE_HTTP_ROUTES.map(
    (route) => `${route.method} ${route.pattern}`
  )).size, 11);
  assert.equal(
    RESPONDER_SURFACE_HTTP_ROUTES.some((route) =>
      /send|deliver|provider|bill|charge|enable/iu.test(route.operation)),
    false
  );
  assert.equal(
    matchResponderSurfaceHttpRoute(
      "POST",
      `/api/v1/responder/contacts/${IDS.authority}/stop`
    ).params.contactAuthorityId,
    IDS.authority
  );
  assert.equal(matchResponderSurfaceHttpRoute(
    "GET", "/api/v1/responder?organization=other"
  ), null);
  assert.equal(matchResponderSurfaceHttpRoute(
    "POST", "/api/v1/responder/contacts/not-a-uuid/stop"
  ), null);
});

test("GET projections authenticate and preserve customer/operator tenant scope", async () => {
  const { actor, boundary, calls } = fixture();
  const customer = await boundary.dispatch(request("/api/v1/responder"));
  assert.equal(customer.status, 200);
  assert.equal(customer.headers.get("cache-control"), "no-store");
  assert.deepEqual(await customer.json(), {
    audience: "customer",
    providerEffects: false
  });
  const operator = await boundary.dispatch(request(
    `/api/v1/operator/responder/organizations/${IDS.organization}`
  ));
  assert.equal(operator.status, 200);
  assert.deepEqual(calls.filter((entry) => entry[0].startsWith("read")), [
    ["readCustomer", actor],
    ["readOperator", actor, IDS.organization]
  ]);
  assert.equal(calls.some((entry) => entry[0] === "writeGuard"), false);
});

test("POST routes require the write guard and bind path/idempotency facts", async () => {
  const { boundary, calls } = fixture();
  const stop = await boundary.dispatch(request(
    `/api/v1/responder/contacts/${IDS.authority}/stop`,
    { body: { opaque: "digest-only-fixture" } }
  ));
  assert.equal(stop.status, 200);
  const selected = calls.find((entry) => entry[0] === "stop");
  assert.equal(selected[2], "customer");
  assert.equal(selected[3], IDS.authority);
  assert.deepEqual(selected[4], {
    organizationId: IDS.organization,
    commandId: "responder-http-command-0001",
    body: { opaque: "digest-only-fixture" }
  });
  assert.equal(calls.filter((entry) => entry[0] === "writeGuard").length, 1);

  const kill = await boundary.dispatch(request(
    `/api/v1/operator/responder/organizations/${IDS.organization}/global-kill`,
    { body: { evidenceDigest: "a".repeat(64) } }
  ));
  assert.equal(kill.status, 200);
  assert.equal(calls.some((entry) => entry[0] === "engageGlobalKill"), true);
});

test("HTTP boundary fails closed on auth, CSRF, idempotency, media, and body bounds", async () => {
  const path = "/api/v1/responder/contacts";
  await assert.rejects(
    fixture({ authenticated: false }).boundary.dispatch(request(path, {
      body: {}
    })),
    (error) => error.code === "AUTHENTICATION_REQUIRED" && error.status === 401
  );
  await assert.rejects(
    fixture({ guarded: false }).boundary.dispatch(request(path, { body: {} })),
    (error) => error.code === "RESPONDER_WRITE_GUARD_REQUIRED" &&
      error.status === 403
  );
  await assert.rejects(
    fixture().boundary.dispatch(request(path, {
      body: {},
      headers: { "idempotency-key": "" }
    })),
    (error) => error.code === "IDEMPOTENCY_KEY_REQUIRED" && error.status === 400
  );
  await assert.rejects(
    fixture().boundary.dispatch(request(path, {
      body: {},
      headers: { "content-type": "text/plain" }
    })),
    (error) => error.code === "RESPONDER_SURFACE_INVALID" && error.status === 415
  );
  await assert.rejects(
    fixture().boundary.dispatch(request(path, {
      body: {},
      headers: { "content-length": "16385" }
    })),
    (error) => error.code === "RESPONDER_SURFACE_INVALID" && error.status === 413
  );
  await assert.rejects(
    fixture().boundary.dispatch(request(path, {
      body: { oversized: "x".repeat(17 * 1024) }
    })),
    (error) => error.code === "RESPONDER_SURFACE_INVALID" && error.status === 413
  );
  assert.equal(await fixture().boundary.dispatch(
    request("/api/v1/responder", { method: "DELETE" })
  ), null);
});

test("effectful or incomplete HTTP compositions are rejected", () => {
  assert.throws(
    () => createResponderSurfacesHttpBoundary({
      service: { providerEffects: true, billingEffects: false, sellable: false },
      authenticate() {},
      requireWriteGuard() {}
    }),
    (error) => error.code === "RESPONDER_SURFACE_CONFIGURATION_REQUIRED"
  );
});
