import assert from "node:assert/strict";
import test from "node:test";

import {
  CARE_COMMERCE_HTTP_ROUTES,
  createCareCommerceHttpBoundary,
  matchCareCommerceHttpRoute
} from "../care-commerce-http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const USER = "10000000-0000-4000-8000-000000000001";
const SESSION_ORG = "20000000-0000-4000-8000-000000000001";
const TARGET_ORG = "20000000-0000-4000-8000-000000000099";
const PROJECT = "30000000-0000-4000-8000-000000000001";
const CONTRACT = "40000000-0000-4000-8000-000000000001";
const PERIOD = "50000000-0000-4000-8000-000000000001";
const QUOTE = "60000000-0000-4000-8000-000000000001";
const RESERVATION = "70000000-0000-4000-8000-000000000001";
const DIGEST = "d".repeat(64);

const CUSTOMER_BASE =
  `/api/v1/care/projects/${PROJECT}/contracts/${CONTRACT}` +
  `/periods/${PERIOD}/commerce`;
const OPERATOR_BASE =
  `/api/v1/operator/care/organizations/${TARGET_ORG}` +
  `/projects/${PROJECT}/contracts/${CONTRACT}` +
  `/periods/${PERIOD}/commerce`;

function service() {
  const calls = [];
  const selected = {
    calls,
    kind: "care-commerce",
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
    "readCustomerCatalog",
    "readCustomerReservation",
    "readOperatorCatalog",
    "requestReversal",
    "reserveHeldInvoice"
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
    service: selected,
    guardCalls,
    boundary: createCareCommerceHttpBoundary({
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
  idempotencyKey = "care.commerce.http.0001",
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

test("Care commerce HTTP manifest is closed and path-scoped", () => {
  assert.equal(CARE_COMMERCE_HTTP_ROUTES.length, 8);
  assert.equal(
    new Set(CARE_COMMERCE_HTTP_ROUTES.map(
      ({ method, pattern }) => `${method} ${pattern}`
    )).size,
    8
  );
  const matched = matchCareCommerceHttpRoute(
    "POST",
    `${OPERATOR_BASE}/reservations/${RESERVATION}/cancellation`
  );
  assert.equal(matched.operation, "cancelHeldReservation");
  assert.deepEqual(matched.params, {
    organizationId: TARGET_ORG,
    projectId: PROJECT,
    contractId: CONTRACT,
    periodId: PERIOD,
    reservationId: RESERVATION
  });
  assert.equal(
    matchCareCommerceHttpRoute("GET", `${CUSTOMER_BASE}/catalog?forged=1`),
    null
  );
});

test("customer and operator reads retain separate organization authority", async () => {
  const fixture = boundary();
  const catalog = await fixture.boundary.dispatch(request(
    `${CUSTOMER_BASE}/catalog`,
    { method: "GET" }
  ));
  assert.equal(catalog.status, 200);
  const reservation = await fixture.boundary.dispatch(request(
    `${CUSTOMER_BASE}/reservations/${RESERVATION}`,
    { method: "GET" }
  ));
  assert.equal(reservation.status, 200);
  const operator = await fixture.boundary.dispatch(request(
    `${OPERATOR_BASE}/catalog`,
    { method: "GET" }
  ));
  assert.equal(operator.status, 200);
  assert.deepEqual(fixture.service.calls, [
    [
      "readCustomerCatalog",
      { userId: USER, organizationId: SESSION_ORG },
      { projectId: PROJECT, contractId: CONTRACT, periodId: PERIOD }
    ],
    [
      "readCustomerReservation",
      { userId: USER, organizationId: SESSION_ORG },
      {
        projectId: PROJECT,
        contractId: CONTRACT,
        periodId: PERIOD,
        reservationId: RESERVATION
      }
    ],
    [
      "readOperatorCatalog",
      { userId: USER, organizationId: TARGET_ORG },
      {
        organizationId: TARGET_ORG,
        projectId: PROJECT,
        contractId: CONTRACT,
        periodId: PERIOD
      }
    ]
  ]);
  assert.equal(operator.headers.get("cache-control"), "no-store");
});

test("operator commands derive scope from the path and accept only operation facts", async () => {
  const fixture = boundary();
  const commands = [
    {
      method: "createHeldQuote",
      path: `${OPERATOR_BASE}/quotes`,
      body: {
        serviceKey: "website_rescue",
        priceSelection: { kind: "repair_units", repairUnits: 2 }
      }
    },
    {
      method: "reserveHeldInvoice",
      path: `${OPERATOR_BASE}/reservations`,
      body: { quoteId: QUOTE, acceptedQuoteDigest: DIGEST }
    },
    {
      method: "cancelHeldReservation",
      path: `${OPERATOR_BASE}/reservations/${RESERVATION}/cancellation`,
      body: { expectedRevision: 1, cancellationEvidenceDigest: DIGEST }
    },
    {
      method: "markReservationAmbiguous",
      path: `${OPERATOR_BASE}/reservations/${RESERVATION}/ambiguity`,
      body: { expectedRevision: 1, ambiguityEvidenceDigest: DIGEST }
    },
    {
      method: "requestReversal",
      path: `${OPERATOR_BASE}/reservations/${RESERVATION}/reversal`,
      body: {}
    }
  ];
  for (const [index, command] of commands.entries()) {
    const key = `care.commerce.http.000${index + 1}`;
    const response = await fixture.boundary.dispatch(request(command.path, {
      body: command.body,
      idempotencyKey: key
    }));
    assert.equal(response.status, 201);
    const call = fixture.service.calls[index];
    assert.equal(call[0], command.method);
    assert.deepEqual(call[1], {
      userId: USER,
      organizationId: TARGET_ORG
    });
    assert.equal(call[2].organizationId, TARGET_ORG);
    assert.equal(call[2].projectId, PROJECT);
    assert.equal(call[2].contractId, CONTRACT);
    assert.equal(call[2].periodId, PERIOD);
    if (command.method === "requestReversal") {
      assert.equal(Object.hasOwn(call[2], "commandId"), false);
    } else {
      assert.equal(call[2].commandId, key);
    }
  }
  assert.equal(fixture.guardCalls.length, commands.length);
});

test("authentication, write guard, idempotency, and exact body fail before dispatch", async () => {
  const signedOut = boundary({ signedIn: false });
  await assert.rejects(
    signedOut.boundary.dispatch(request(`${CUSTOMER_BASE}/catalog`, {
      method: "GET"
    })),
    (error) => error?.code === "AUTHENTICATION_REQUIRED"
  );
  assert.equal(signedOut.service.calls.length, 0);

  const unguarded = boundary({ guarded: false });
  await assert.rejects(
    unguarded.boundary.dispatch(request(`${OPERATOR_BASE}/quotes`, {
      body: {
        serviceKey: "website_rescue",
        priceSelection: { kind: "repair_units", repairUnits: 2 }
      }
    })),
    (error) => error?.code === "CARE_COMMERCE_WRITE_GUARD_REQUIRED"
  );
  assert.equal(unguarded.service.calls.length, 0);

  const invalid = boundary();
  await assert.rejects(
    invalid.boundary.dispatch(request(`${OPERATOR_BASE}/quotes`, {
      body: {
        serviceKey: "website_rescue",
        priceSelection: {},
        amountMinor: 1
      }
    })),
    (error) => error?.code === "CARE_COMMERCE_INVALID"
  );
  await assert.rejects(
    invalid.boundary.dispatch(request(`${OPERATOR_BASE}/quotes`, {
      body: { serviceKey: "website_rescue", priceSelection: {} },
      idempotencyKey: null
    })),
    (error) => error?.code === "IDEMPOTENCY_KEY_REQUIRED"
  );
  assert.equal(invalid.service.calls.length, 0);
});

test("effectful or incomplete Care commerce cannot be mounted", () => {
  const unsafe = service();
  unsafe.paymentEffects = true;
  assert.throws(
    () => createCareCommerceHttpBoundary({
      service: unsafe,
      authenticate: async () => ({}),
      requireWriteGuard: async () => true
    }),
    (error) => error?.code === "CARE_COMMERCE_CONFIGURATION_REQUIRED"
  );
});
