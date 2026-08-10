import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPPORT_CASE_HTTP_ROUTES,
  createHeldSupportCaseHttpBoundary,
  matchSupportCaseHttpRoute
} from "../support-cases-http.mjs";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";

test("held HTTP manifest defines distinct customer/operator routes and no execution route", () => {
  assert.equal(SUPPORT_CASE_HTTP_ROUTES.length, 14);
  assert.equal(new Set(SUPPORT_CASE_HTTP_ROUTES.map(
    (route) => `${route.method} ${route.pattern}`
  )).size, 14);
  assert.equal(
    SUPPORT_CASE_HTTP_ROUTES.some((route) =>
      /execute|erase|download|provider|send/u.test(route.operation)),
    false
  );
  assert.equal(
    matchSupportCaseHttpRoute("GET", `/api/v1/support-cases/${CASE}`).params.caseId,
    CASE
  );
  assert.equal(matchSupportCaseHttpRoute("GET", "/api/v1/support-cases?x=1"), null);
});

test("known HTTP routes authenticate then remain explicitly held", async () => {
  const boundary = createHeldSupportCaseHttpBoundary();
  await assert.rejects(
    boundary.dispatch({ method: "GET", pathname: "/api/v1/support-cases", actor: null }),
    (error) => error.code === "AUTHENTICATION_REQUIRED"
  );
  await assert.rejects(
    boundary.dispatch({
      method: "POST",
      pathname: `/api/v1/operator/support-cases/${CASE}/response`,
      actor: { userId: USER, organizationId: ORG }
    }),
    (error) => error.code === "SUPPORT_CASES_HELD" &&
      error.details.operation === "respond" &&
      error.details.providerEffects === false
  );
  assert.equal(await boundary.dispatch({
    method: "DELETE",
    pathname: `/api/v1/operator/support-cases/${CASE}`,
    actor: { userId: USER, organizationId: ORG }
  }), null);
});
