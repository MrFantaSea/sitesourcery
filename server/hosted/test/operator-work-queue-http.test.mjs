import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldOperatorWorkQueueHttp,
  createOperatorWorkQueueHttpBoundary,
  matchOperatorWorkQueueHttpRoute,
  OPERATOR_WORK_QUEUE_HTTP_ROUTES
} from "../operator-work-queue-http.mjs";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const ITEM = "30000000-0000-4000-8000-000000000001";

test("queue HTTP manifest exposes only read, source refresh, and bounded repair", () => {
  assert.deepEqual(OPERATOR_WORK_QUEUE_HTTP_ROUTES, [
    { method: "GET", path: "/api/v1/operator/work-queue", action: "list" },
    {
      method: "POST",
      path: "/api/v1/operator/work-queue/refresh",
      action: "refresh"
    },
    {
      method: "POST",
      path: "/api/v1/operator/work-queue/:queueItemId/repairs/professional-reversal",
      action: "dispatchProfessionalReversalRepair"
    }
  ]);
  assert.equal(
    JSON.stringify(OPERATOR_WORK_QUEUE_HTTP_ROUTES).includes("mark-paid"),
    false
  );
  assert.equal(
    matchOperatorWorkQueueHttpRoute(
      "POST",
      `/api/v1/operator/work-queue/${ITEM}/repairs/professional-reversal`
    ).params.queueItemId,
    ITEM
  );
});

test("live queue HTTP boundary binds the session actor and transport command", async () => {
  const calls = [];
  const operatorQueue = {
    providerEffects: false,
    alertEffects: false,
    genericRepair: false,
    async list(input) {
      calls.push(["list", input]);
      return { items: [] };
    },
    async refresh(input) {
      calls.push(["refresh", input]);
      return { items: [] };
    },
    async dispatchProfessionalReversalRepair(input) {
      calls.push(["repair", input]);
      return { repaired: true };
    }
  };
  const http = createOperatorWorkQueueHttpBoundary({ operatorQueue });
  const actor = { userId: USER };
  assert.deepEqual(await http.dispatch({
    method: "GET",
    pathname: "/api/v1/operator/work-queue",
    actor,
    query: new URLSearchParams({ operatorOrganizationId: ORG })
  }), { status: 200, result: { items: [] } });
  assert.deepEqual(await http.dispatch({
    method: "POST",
    pathname: "/api/v1/operator/work-queue/refresh",
    actor,
    body: { operatorOrganizationId: ORG },
    commandId: "unused-transport-command"
  }), { status: 200, result: { items: [] } });
  const repairBody = {
    operatorOrganizationId: ORG,
    expectedQueueRevision: 2,
    resolution: "confirmed",
    confirmedOutcome: "refund_full",
    verifiedFacts: { provider: "verified" },
    verifiedFactsDigest: "a".repeat(64),
    verifiedObservedAt: "2026-08-11T12:00:00.000Z"
  };
  assert.deepEqual(await http.dispatch({
    method: "POST",
    pathname: `/api/v1/operator/work-queue/${ITEM}/repairs/professional-reversal`,
    actor,
    body: repairBody,
    commandId: "operator-repair-command-001"
  }), { status: 200, result: { repaired: true } });
  assert.deepEqual(calls, [
    ["list", { actorId: USER, operatorOrganizationId: ORG }],
    ["refresh", { actorId: USER, operatorOrganizationId: ORG }],
    ["repair", {
      ...repairBody,
      actorId: USER,
      commandId: "operator-repair-command-001",
      queueItemId: ITEM
    }]
  ]);
});

test("queue boundary rejects forged fields and held mode authenticates", async () => {
  const boundary = createOperatorWorkQueueHttpBoundary({
    operatorQueue: {
      providerEffects: false,
      alertEffects: false,
      genericRepair: false,
      list() {},
      refresh() {},
      dispatchProfessionalReversalRepair() {}
    }
  });
  await assert.rejects(boundary.dispatch({
    method: "POST",
    pathname: "/api/v1/operator/work-queue/refresh",
    actor: { userId: USER },
    body: { operatorOrganizationId: ORG, actorId: USER }
  }), { code: "OPERATOR_QUEUE_INVALID" });

  const held = createHeldOperatorWorkQueueHttp({
    authenticate: async ({ actor }) => actor
  });
  await assert.rejects(held.dispatch({
    method: "GET",
    pathname: "/api/v1/operator/work-queue",
    actor: null
  }), { code: "AUTHENTICATION_REQUIRED" });
  await assert.rejects(held.dispatch({
    method: "GET",
    pathname: "/api/v1/operator/work-queue",
    actor: { userId: USER }
  }), { code: "OPERATOR_QUEUE_HELD" });
  assert.equal(await held.dispatch({ method: "GET", pathname: "/health" }), null);
});
