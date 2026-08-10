import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldOperatorWorkQueueHttp,
  HELD_OPERATOR_WORK_QUEUE_HTTP_MANIFEST
} from "../operator-work-queue-http.mjs";

test("held queue HTTP manifest has one read, one refresh, and one bounded repair", () => {
  assert.deepEqual(HELD_OPERATOR_WORK_QUEUE_HTTP_MANIFEST, [
    { method: "GET", path: "/api/owner/work-queue", action: "list" },
    {
      method: "POST",
      path: "/api/owner/work-queue/refresh",
      action: "refresh"
    },
    {
      method: "POST",
      path: "/api/owner/work-queue/:queueItemId/repairs/professional-reversal",
      action: "dispatchProfessionalReversalRepair"
    }
  ]);
  assert.equal(
    JSON.stringify(HELD_OPERATOR_WORK_QUEUE_HTTP_MANIFEST).includes("mark-paid"),
    false
  );
});

test("known queue routes authenticate and remain held; unknown routes pass through", async () => {
  const authenticated = [];
  const http = createHeldOperatorWorkQueueHttp({
    authenticate: async (request) => authenticated.push(request.pathname)
  });
  assert.equal(await http.dispatch({ method: "GET", pathname: "/health" }), null);
  assert.equal(await http.dispatch({
    method: "POST",
    pathname: "/api/owner/work-queue/------------------------------------/repairs/professional-reversal"
  }), null);
  for (const request of [
    { method: "GET", pathname: "/api/owner/work-queue" },
    { method: "POST", pathname: "/api/owner/work-queue/refresh" },
    {
      method: "POST",
      pathname: "/api/owner/work-queue/33333333-3333-4333-8333-333333333333/repairs/professional-reversal"
    }
  ]) {
    await assert.rejects(http.dispatch(request), { code: "OPERATOR_QUEUE_HELD" });
  }
  assert.equal(authenticated.length, 3);
});
