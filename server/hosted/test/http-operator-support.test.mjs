import assert from "node:assert/strict";
import test from "node:test";

import { createHostedApi } from "../http.mjs";
import { SUPPORT_CASE_HTTP_ROUTES } from "../support-cases-http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION = "operator-session-token";
const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";

function canonicalService() {
  return {
    async authenticate(token) {
      return token === SESSION ? { userId: USER } : null;
    }
  };
}

function queue(calls) {
  return {
    providerEffects: false,
    alertEffects: false,
    genericRepair: false,
    async list(input) {
      calls.push(["queue-list", input]);
      return { schema: "queue-list", items: [] };
    },
    async refresh(input) {
      calls.push(["queue-refresh", input]);
      return { schema: "queue-list", items: [] };
    },
    async dispatchProfessionalReversalRepair(input) {
      calls.push(["queue-repair", input]);
      return { schema: "queue-repair" };
    }
  };
}

function support(calls) {
  const service = { providerEffects: false };
  for (const { operation } of SUPPORT_CASE_HTTP_ROUTES) {
    service[operation] ??= async (input) => {
      calls.push([operation, input]);
      return { schema: operation };
    };
  }
  return service;
}

function get(path, { signedIn = true } = {}) {
  return new Request(`${ORIGIN}${path}`, {
    headers: signedIn ? { Cookie: `ss_session=${SESSION}` } : {}
  });
}

function post(path, body, {
  signedIn = true,
  origin = ORIGIN,
  command = "operator-http-command-001"
} = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      ...(signedIn ? { Cookie: `ss_session=${SESSION}; ss_csrf=${"c".repeat(32)}` } : {
        Cookie: `ss_csrf=${"c".repeat(32)}`
      }),
      Origin: origin,
      "X-CSRF-Token": "c".repeat(32),
      "Idempotency-Key": command,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

test("canonical root serves source-authoritative operator queue and support routes", async () => {
  const calls = [];
  const api = createHostedApi(canonicalService(), {
    operatorWorkQueue: queue(calls),
    supportCases: support(calls)
  });
  const listed = await api.fetch(get(
    `/api/v1/operator/work-queue?operatorOrganizationId=${ORG}`
  ));
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { schema: "queue-list", items: [] });

  const responded = await api.fetch(post(
    `/api/v1/operator/support-cases/${CASE}/response`,
    {
      expectedRevision: 2,
      operatorOrganizationId: ORG,
      responseDigest: "d".repeat(64)
    }
  ));
  assert.equal(responded.status, 200);
  assert.deepEqual(await responded.json(), { schema: "respond" });
  assert.deepEqual(calls, [
    ["queue-list", { actorId: USER, operatorOrganizationId: ORG }],
    ["respond", {
      actorId: USER,
      caseId: CASE,
      commandId: "operator-http-command-001",
      expectedRevision: 2,
      operatorOrganizationId: ORG,
      responseDigest: "d".repeat(64)
    }]
  ]);
});

test("canonical root enforces session, same-origin, CSRF, and exact bodies", async () => {
  const calls = [];
  const api = createHostedApi(canonicalService(), {
    operatorWorkQueue: queue(calls),
    supportCases: support(calls)
  });
  const signedOut = await api.fetch(get(
    `/api/v1/operator/work-queue?operatorOrganizationId=${ORG}`,
    { signedIn: false }
  ));
  assert.equal(signedOut.status, 401);

  const crossOrigin = await api.fetch(post(
    "/api/v1/operator/work-queue/refresh",
    { operatorOrganizationId: ORG },
    { origin: "https://attacker.test" }
  ));
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error.code, "CROSS_ORIGIN_REQUEST_REJECTED");

  const forged = await api.fetch(post(
    "/api/v1/operator/work-queue/refresh",
    { operatorOrganizationId: ORG, actorId: USER }
  ));
  assert.equal(forged.status, 400);
  assert.equal((await forged.json()).error.code, "OPERATOR_QUEUE_INVALID");
  assert.equal(calls.length, 0);
});

test("uncomposed operator support routes remain held", async () => {
  const api = createHostedApi(canonicalService());
  const queueResponse = await api.fetch(get(
    `/api/v1/operator/work-queue?operatorOrganizationId=${ORG}`
  ));
  assert.equal(queueResponse.status, 503);
  assert.equal((await queueResponse.json()).error.code, "OPERATOR_QUEUE_HELD");

  const supportResponse = await api.fetch(get(
    `/api/v1/operator/support-cases?operatorOrganizationId=${ORG}`
  ));
  assert.equal(supportResponse.status, 503);
  assert.equal((await supportResponse.json()).error.code, "SUPPORT_CASES_HELD");
});
