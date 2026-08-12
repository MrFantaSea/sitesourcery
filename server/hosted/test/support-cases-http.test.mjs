import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPPORT_CASE_HTTP_ROUTES,
  createHeldSupportCaseHttpBoundary,
  createSupportCaseHttpBoundary,
  matchSupportCaseHttpRoute
} from "../support-cases-http.mjs";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";

test("HTTP manifest separates customer/operator routes and has no external execution", () => {
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

function supportService(calls) {
  const service = {
    providerEffects: false
  };
  for (const { operation } of SUPPORT_CASE_HTTP_ROUTES) {
    service[operation] ??= async (input) => {
      calls.push([operation, input]);
      return { operation };
    };
  }
  return service;
}

test("live support HTTP binds customer scope and session identity", async () => {
  const calls = [];
  const boundary = createSupportCaseHttpBoundary({
    supportCases: supportService(calls)
  });
  const actor = { userId: USER };
  assert.deepEqual(await boundary.dispatch({
    method: "GET",
    pathname: "/api/v1/support-cases",
    actor,
    query: new URLSearchParams({ organizationId: ORG })
  }), { status: 200, result: { operation: "listCustomerCases" } });
  const body = {
    evidenceDigests: ["a".repeat(64)],
    organizationId: ORG,
    parentCaseId: null,
    projectId: null,
    requestKind: "support",
    requesterReferenceDigest: "b".repeat(64),
    scopeKind: "account"
  };
  assert.deepEqual(await boundary.dispatch({
    method: "POST",
    pathname: "/api/v1/support-cases",
    actor,
    body,
    commandId: "support-open-command-001"
  }), { status: 201, result: { operation: "openAuthenticated" } });
  assert.deepEqual(calls, [
    ["listCustomerCases", { actorId: USER, organizationId: ORG }],
    ["openAuthenticated", {
      ...body,
      actorId: USER,
      commandId: "support-open-command-001",
      requesterUserId: USER
    }]
  ]);
});

test("operator case mutations bind route ID, actor, organization, and command", async () => {
  const calls = [];
  const boundary = createSupportCaseHttpBoundary({
    supportCases: supportService(calls)
  });
  const body = {
    expectedRevision: 3,
    operatorOrganizationId: ORG,
    responseDigest: "c".repeat(64)
  };
  assert.deepEqual(await boundary.dispatch({
    method: "POST",
    pathname: `/api/v1/operator/support-cases/${CASE}/response`,
    actor: { userId: USER },
    body,
    commandId: "support-response-command-001"
  }), { status: 200, result: { operation: "respond" } });
  assert.deepEqual(calls, [["respond", {
    ...body,
    actorId: USER,
    caseId: CASE,
    commandId: "support-response-command-001"
  }]]);
  await assert.rejects(boundary.dispatch({
    method: "POST",
    pathname: `/api/v1/operator/support-cases/${CASE}/response`,
    actor: { userId: USER },
    body: { ...body, actorId: USER },
    commandId: "support-response-command-002"
  }), { code: "SUPPORT_CASE_INVALID" });
});

test("held case HTTP authenticates and preserves no-provider-effect hold", async () => {
  const boundary = createHeldSupportCaseHttpBoundary();
  await assert.rejects(
    boundary.dispatch({ method: "GET", pathname: "/api/v1/support-cases", actor: null }),
    (error) => error.code === "AUTHENTICATION_REQUIRED"
  );
  await assert.rejects(
    boundary.dispatch({
      method: "POST",
      pathname: `/api/v1/operator/support-cases/${CASE}/response`,
      actor: { userId: USER }
    }),
    (error) => error.code === "SUPPORT_CASES_HELD" &&
      error.details.operation === "respond" &&
      error.details.providerEffects === false
  );
  assert.equal(await boundary.dispatch({
    method: "DELETE",
    pathname: `/api/v1/operator/support-cases/${CASE}`,
    actor: { userId: USER }
  }), null);
});
