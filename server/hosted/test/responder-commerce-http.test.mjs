import assert from "node:assert/strict";
import test from "node:test";

import {
  createResponderCommerceHttpBoundary,
  matchResponderCommerceHttpRoute,
  RESPONDER_COMMERCE_HTTP_ROUTES
} from "../responder-commerce-http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const USER = "10000000-0000-4000-8000-000000000001";
const SESSION_ORG = "20000000-0000-4000-8000-000000000001";
const TARGET_ORG = "20000000-0000-4000-8000-000000000099";
const PROJECT = "30000000-0000-4000-8000-000000000001";
const CUSTOMER = "40000000-0000-4000-8000-000000000001";
const QUOTE = "50000000-0000-4000-8000-000000000001";
const RESERVATION = "60000000-0000-4000-8000-000000000001";
const DIGEST = "d".repeat(64);
const CUSTOMER_BASE = `/api/v1/responder/projects/${PROJECT}/commerce`;
const OPERATOR_BASE =
  `/api/v1/operator/responder/organizations/${TARGET_ORG}` +
  `/projects/${PROJECT}/customers/${CUSTOMER}/commerce`;

function service() {
  const calls = [];
  const selected = {
    calls,
    kind: "responder-commerce",
    mode: "held-local",
    commercialEffects: false,
    customerEffects: false,
    mailDeliveryEffects: false,
    paymentEffects: false,
    providerEffects: false,
    async readiness() {
      return { ready: true, verified: true };
    }
  };
  for (const method of [
    "cancelHeldReservation",
    "createHeldQuote",
    "markReservationAmbiguous",
    "readCustomerQuote",
    "readCustomerReservation",
    "readOperatorCatalog",
    "requestReversal",
    "reserveHeldBilling"
  ]) {
    selected[method] = async (...args) => {
      calls.push([method, ...args]);
      return { method, providerEffects: false };
    };
  }
  return selected;
}

function fixture({ signedIn = true, guarded = true } = {}) {
  const selected = service();
  const guardCalls = [];
  return {
    service: selected,
    guardCalls,
    boundary: createResponderCommerceHttpBoundary({
      service: selected,
      async authenticate(_request, route) {
        return signedIn
          ? {
              userId: USER,
              organizationId: route.audience === "operator"
                ? TARGET_ORG
                : SESSION_ORG
            }
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
  idempotencyKey = "responder.commerce.http.0001",
  method = "POST"
} = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: method === "POST"
      ? {
          "Content-Type": "application/json",
          ...(idempotencyKey === null
            ? {}
            : { "Idempotency-Key": idempotencyKey })
        }
      : {},
    body: method === "POST" ? JSON.stringify(body) : undefined
  });
}

test("Responder commerce HTTP manifest is an exact eight-route boundary", () => {
  assert.equal(RESPONDER_COMMERCE_HTTP_ROUTES.length, 8);
  assert.equal(new Set(RESPONDER_COMMERCE_HTTP_ROUTES.map(
    ({ method, pattern }) => `${method} ${pattern}`
  )).size, 8);
  const matched = matchResponderCommerceHttpRoute(
    "POST",
    `${OPERATOR_BASE}/reservations/${RESERVATION}/cancellation`
  );
  assert.equal(matched.operation, "cancelHeldReservation");
  assert.deepEqual(matched.params, {
    organizationId: TARGET_ORG,
    projectId: PROJECT,
    customerUserId: CUSTOMER,
    reservationId: RESERVATION
  });
  assert.equal(
    matchResponderCommerceHttpRoute(
      "GET",
      `${CUSTOMER_BASE}/quotes/${QUOTE}?forged=1`
    ),
    null
  );
});

test("customer and operator reads keep tenant and customer authority in paths", async () => {
  const selected = fixture();
  assert.equal((await selected.boundary.dispatch(request(
    `${CUSTOMER_BASE}/quotes/${QUOTE}`,
    { method: "GET" }
  ))).status, 200);
  assert.equal((await selected.boundary.dispatch(request(
    `${CUSTOMER_BASE}/reservations/${RESERVATION}`,
    { method: "GET" }
  ))).status, 200);
  assert.equal((await selected.boundary.dispatch(request(
    `${OPERATOR_BASE}/catalog`,
    { method: "GET" }
  ))).status, 200);
  assert.deepEqual(selected.service.calls, [
    [
      "readCustomerQuote",
      { userId: USER, organizationId: SESSION_ORG },
      { projectId: PROJECT, quoteId: QUOTE }
    ],
    [
      "readCustomerReservation",
      { userId: USER, organizationId: SESSION_ORG },
      { projectId: PROJECT, reservationId: RESERVATION }
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
});

test("operator commands derive all identity scope and accept only operation facts", async () => {
  const selected = fixture();
  const commands = [
    ["createHeldQuote", `${OPERATOR_BASE}/quotes`, {}],
    [
      "reserveHeldBilling",
      `${OPERATOR_BASE}/reservations`,
      { quoteId: QUOTE, acceptedQuoteDigest: DIGEST }
    ],
    [
      "cancelHeldReservation",
      `${OPERATOR_BASE}/reservations/${RESERVATION}/cancellation`,
      { expectedRevision: 1, cancellationEvidenceDigest: DIGEST }
    ],
    [
      "markReservationAmbiguous",
      `${OPERATOR_BASE}/reservations/${RESERVATION}/ambiguity`,
      { expectedRevision: 1, ambiguityEvidenceDigest: DIGEST }
    ],
    [
      "requestReversal",
      `${OPERATOR_BASE}/reservations/${RESERVATION}/reversal`,
      {}
    ]
  ];
  for (const [index, [method, path, body]] of commands.entries()) {
    const key = `responder.commerce.http.000${index + 1}`;
    const response = await selected.boundary.dispatch(request(path, {
      body,
      idempotencyKey: key
    }));
    assert.equal(response.status, 201);
    const call = selected.service.calls[index];
    assert.equal(call[0], method);
    assert.deepEqual(call[1], {
      userId: USER,
      organizationId: TARGET_ORG
    });
    assert.equal(call[2].organizationId, TARGET_ORG);
    assert.equal(call[2].projectId, PROJECT);
    assert.equal(call[2].customerUserId, CUSTOMER);
    if (method === "requestReversal") {
      assert.equal(Object.hasOwn(call[2], "commandId"), false);
    } else {
      assert.equal(call[2].commandId, key);
    }
  }
  assert.equal(selected.guardCalls.length, commands.length);
});

test("authentication, write guard, idempotency, and exact body fail before service dispatch", async () => {
  const signedOut = fixture({ signedIn: false });
  await assert.rejects(
    signedOut.boundary.dispatch(request(`${CUSTOMER_BASE}/quotes/${QUOTE}`, {
      method: "GET"
    })),
    (error) => error?.code === "AUTHENTICATION_REQUIRED"
  );
  const unguarded = fixture({ guarded: false });
  await assert.rejects(
    unguarded.boundary.dispatch(request(`${OPERATOR_BASE}/quotes`)),
    (error) => error?.code === "RESPONDER_COMMERCE_WRITE_GUARD_REQUIRED"
  );
  const invalid = fixture();
  await assert.rejects(
    invalid.boundary.dispatch(request(`${OPERATOR_BASE}/quotes`, {
      body: { amountMinor: 1 }
    })),
    (error) => error?.code === "RESPONDER_COMMERCE_INVALID"
  );
  await assert.rejects(
    invalid.boundary.dispatch(request(`${OPERATOR_BASE}/quotes`, {
      idempotencyKey: null
    })),
    (error) => error?.code === "IDEMPOTENCY_KEY_REQUIRED"
  );
  assert.equal(invalid.service.calls.length, 0);
});

test("effectful Responder commerce cannot be mounted", () => {
  const unsafe = service();
  unsafe.paymentEffects = true;
  assert.throws(
    () => createResponderCommerceHttpBoundary({
      service: unsafe,
      authenticate: async () => ({}),
      requireWriteGuard: async () => true
    }),
    (error) => error?.code === "RESPONDER_COMMERCE_CONFIGURATION_REQUIRED"
  );
});
