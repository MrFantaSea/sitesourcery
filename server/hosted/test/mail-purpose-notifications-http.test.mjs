import assert from "node:assert/strict";
import test from "node:test";

import { createHostedApi } from "../http.mjs";
import {
  createMailPurposeNotificationHttpBoundary,
  matchMailPurposeNotificationHttpRoute
} from "../mail-purpose-notifications-http.mjs";
import { SUPPORT_CASE_HTTP_ROUTES } from "../support-cases-http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION = "mail-purpose-operator-session";
const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const SOURCE = "30000000-0000-4000-8000-000000000001";
const CASE = "40000000-0000-4000-8000-000000000001";
const CSRF = "c".repeat(32);

function body() {
  return {
    contentDigest: "1".repeat(64),
    expiresAt: "2026-08-18T19:00:00.000Z",
    notificationKind: "domain_lifecycle_updated",
    operatorOrganizationId: ORG,
    purposeKind: "publication_domain",
    recipientDigest: "2".repeat(64),
    source: {
      table: "ss.domain_provider_lifecycle_states",
      id: SOURCE,
      revision: 2,
      digest: "3".repeat(64),
      state: "active"
    },
    subjectReferenceDigest: "4".repeat(64),
    templateVersion: "domain-lifecycle-updated.v1"
  };
}

function post(path, value, commandId) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      Cookie: `ss_session=${SESSION}; ss_csrf=${CSRF}`,
      Origin: ORIGIN,
      "X-CSRF-Token": CSRF,
      "Idempotency-Key": commandId,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(value)
  });
}

function support(calls) {
  const service = { providerEffects: false };
  for (const { operation } of SUPPORT_CASE_HTTP_ROUTES) {
    service[operation] ??= async (input) => {
      calls.push([operation, input]);
      return { schema: `support-${operation}` };
    };
  }
  return service;
}

test("mail-purpose boundary is exact, authenticated, and injects actor and command authority", async () => {
  const calls = [];
  const boundary = createMailPurposeNotificationHttpBoundary({
    service: {
      mode: "repository",
      providerEffects: false,
      deliveryClaimed: false,
      async reserveOperator(input) {
        calls.push(input);
        return { schema: "mail-purpose-receipt" };
      }
    }
  });
  assert.deepEqual(
    matchMailPurposeNotificationHttpRoute(
      "POST", "/api/v1/operator/mail-purpose-reservations"
    ),
    { operation: "reserveOperator", params: {} }
  );
  assert.equal(
    matchMailPurposeNotificationHttpRoute(
      "GET", "/api/v1/operator/mail-purpose-reservations"
    ),
    null
  );
  const result = await boundary.dispatch({
    method: "POST",
    pathname: "/api/v1/operator/mail-purpose-reservations",
    actor: { userId: USER },
    body: body(),
    commandId: "mail-purpose-http-0001"
  });
  assert.deepEqual(result, {
    status: 201,
    result: { schema: "mail-purpose-receipt" }
  });
  assert.equal(calls[0].actorId, USER);
  assert.equal(calls[0].commandId, "mail-purpose-http-0001");
  await assert.rejects(
    boundary.dispatch({
      method: "POST",
      pathname: "/api/v1/operator/mail-purpose-reservations",
      actor: null,
      body: body(),
      commandId: "mail-purpose-http-0002"
    }),
    (error) => error?.code === "AUTHENTICATION_REQUIRED"
  );
});

test("configured purpose and support boundaries coexist without route shadowing", async () => {
  const purposeCalls = [];
  const supportCalls = [];
  const api = createHostedApi({
    async authenticate(token) {
      return token === SESSION ? { userId: USER } : null;
    }
  }, {
    mailPurposeNotifications: {
      mode: "repository",
      providerEffects: false,
      deliveryClaimed: false,
      async reserveOperator(input) {
        purposeCalls.push(input);
        return { schema: "mail-purpose-receipt" };
      }
    },
    supportCases: support(supportCalls)
  });

  const purposeResponse = await api.fetch(post(
    "/api/v1/operator/mail-purpose-reservations",
    body(),
    "mail-purpose-http-0003"
  ));
  assert.equal(purposeResponse.status, 201);
  assert.deepEqual(await purposeResponse.json(), {
    schema: "mail-purpose-receipt"
  });

  const supportResponse = await api.fetch(post(
    `/api/v1/operator/support-cases/${CASE}/response`,
    {
      expectedRevision: 2,
      operatorOrganizationId: ORG,
      responseDigest: "5".repeat(64)
    },
    "support-response-http-0001"
  ));
  assert.equal(supportResponse.status, 200);
  assert.deepEqual(await supportResponse.json(), {
    schema: "support-respond"
  });
  assert.equal(purposeCalls.length, 1);
  assert.equal(supportCalls.length, 1);
  assert.equal(supportCalls[0][0], "respond");
});
