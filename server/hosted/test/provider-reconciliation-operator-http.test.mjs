import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldProviderReconciliationOperatorHttp,
  createProviderReconciliationOperatorHttpBoundary,
  matchOperatorProviderReconciliationHttpRoute
} from "../provider-reconciliation-operator-http.mjs";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const COMMAND = "operator-resolution:0001";
const EVIDENCE = "a".repeat(64);
const BASE = `/api/v1/operator/provider-reconciliation/cases/${CASE}`;

test("operator reconciliation matcher recognizes only exact typed routes", () => {
  assert.deepEqual(matchOperatorProviderReconciliationHttpRoute("GET", BASE), {
    action: "readCase", params: { caseId: CASE }
  });
  assert.deepEqual(matchOperatorProviderReconciliationHttpRoute(
    "POST", `${BASE}/resolution`
  ), { action: "resolveCase", params: { caseId: CASE } });
  assert.equal(matchOperatorProviderReconciliationHttpRoute(
    "POST", `${BASE}/retry-provider`
  ), null);
});

test("HTTP boundary forwards exact operator read and resolution inputs", async () => {
  const calls = [];
  const boundary = createProviderReconciliationOperatorHttpBoundary({
    operator: {
      providerEffects: false,
      genericRepair: false,
      async readCase(input) { calls.push(["read", input]); return { id: CASE }; },
      async resolveCase(input) {
        calls.push(["resolve", input]); return { replayed: false };
      }
    }
  });
  assert.deepEqual(await boundary.dispatch({
    method: "GET", pathname: BASE, actor: { userId: USER },
    query: new URLSearchParams({ operatorOrganizationId: ORG })
  }), { status: 200, result: { id: CASE } });
  assert.deepEqual(await boundary.dispatch({
    method: "POST", pathname: `${BASE}/resolution`,
    actor: { userId: USER }, query: new URLSearchParams(), commandId: COMMAND,
    body: {
      operatorOrganizationId: ORG,
      expectedRevision: 2,
      resolutionKind: "operator_confirmed_no_effect",
      evidenceDigest: EVIDENCE
    }
  }), { status: 200, result: { replayed: false } });
  assert.deepEqual(calls, [
    ["read", { actorId: USER, operatorOrganizationId: ORG, caseId: CASE }],
    ["resolve", {
      actorId: USER, operatorOrganizationId: ORG, caseId: CASE,
      commandId: COMMAND, expectedRevision: 2,
      resolutionKind: "operator_confirmed_no_effect",
      evidenceDigest: EVIDENCE
    }]
  ]);
});

test("HTTP boundary rejects extra fields and held boundary fails closed", async () => {
  const boundary = createProviderReconciliationOperatorHttpBoundary({
    operator: {
      providerEffects: false, genericRepair: false,
      async readCase() {}, async resolveCase() {}
    }
  });
  await assert.rejects(boundary.dispatch({
    method: "POST", pathname: `${BASE}/resolution`,
    actor: { userId: USER }, commandId: COMMAND,
    body: {
      operatorOrganizationId: ORG, expectedRevision: 2,
      resolutionKind: "operator_closed", evidenceDigest: EVIDENCE,
      retryProvider: true
    }
  }), { code: "OPERATOR_RECONCILIATION_INVALID", status: 400 });
  await assert.rejects(createHeldProviderReconciliationOperatorHttp().dispatch({
    method: "GET", pathname: BASE, actor: { userId: USER }
  }), { code: "OPERATOR_RECONCILIATION_HELD", status: 503 });
});
