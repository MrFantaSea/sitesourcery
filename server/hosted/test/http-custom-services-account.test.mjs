import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION_TOKEN = "session_custom_services_account";
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";

function service() {
  return {
    async authenticate(token) {
      return token === SESSION_TOKEN
        ? { userId: CUSTOMER_ID }
        : null;
    }
  };
}

function request({ method = "GET", signedIn = true } = {}) {
  return new Request(
    `${ORIGIN}/api/v1/projects/${PROJECT_ID}/custom-services`,
    {
      method,
      headers: signedIn
        ? { Cookie: `ss_session=${SESSION_TOKEN}` }
        : {}
    }
  );
}

test("custom-services account HTTP route is authenticated, project-bound, and GET-only", async () => {
  const calls = [];
  const snapshot = {
    schema: "sitesourcery.custom-services-account/v1",
    state: "held"
  };
  const api = createHostedApi(service(), {
    customServicesAccount: {
      async getSnapshot(actor, projectId) {
        calls.push({ actor: structuredClone(actor), projectId });
        return structuredClone(snapshot);
      }
    },
    requestIds: {
      next() {
        return "request_custom_services_account_1";
      }
    }
  });

  const response = await api.fetch(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), snapshot);
  assert.deepEqual(calls, [
    { actor: { userId: CUSTOMER_ID }, projectId: PROJECT_ID }
  ]);
  assert.equal(
    response.headers.get("x-request-id"),
    "request_custom_services_account_1"
  );

  const signedOut = await api.fetch(request({ signedIn: false }));
  assert.equal(signedOut.status, 401);
  assert.equal(
    (await signedOut.json()).error.code,
    "AUTHENTICATION_REQUIRED"
  );

  const write = await api.fetch(request({ method: "POST" }));
  assert.equal(write.status, 403);
  assert.equal((await write.json()).error.code, "CSRF_TOKEN_REQUIRED");
  assert.equal(calls.length, 1);
});

test("default hosted runtime keeps custom-services account reading held", async () => {
  const api = createHostedApi(service());
  const response = await api.fetch(request());
  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).error.code,
    "CUSTOM_SERVICES_ACCOUNT_HELD"
  );
});

test("production composes custom-services account from canonical project and PostgreSQL authority", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /createPostgresCustomServicesAccountRepository\(\{\s*authority\s*\}\)/u
  );
  assert.match(
    source,
    /createHostedCustomServicesAccount\(\{[\s\S]*repository:\s*customServicesAccountRepository,[\s\S]*resolveSession:\s*commerceV2\.resolveSession/u
  );
  assert.match(
    source,
    /createHostedApi\(service,\s*\{[\s\S]*customServicesAccount,/u
  );
});
