import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION_TOKEN = "session_alakazam_account";
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

function request(projectId = PROJECT_ID, signedIn = true) {
  return new Request(
    `${ORIGIN}/api/v1/projects/${projectId}/alakazam`,
    {
      headers: signedIn
        ? { Cookie: `ss_session=${SESSION_TOKEN}` }
        : {}
    }
  );
}

test("the hosted Alakazam account route is authenticated, project-bound, and read-only", async () => {
  const calls = [];
  const snapshot = {
    schema: "sitesourcery.alakazam-account/v1",
    projectId: PROJECT_ID,
    state: "available"
  };
  const api = createHostedApi(service(), {
    alakazamAccount: {
      async getSnapshot(actor, projectId) {
        calls.push({
          actor: structuredClone(actor),
          projectId
        });
        return structuredClone(snapshot);
      }
    },
    requestIds: {
      next() {
        return "request_alakazam_account_1";
      }
    }
  });
  const response = await api.fetch(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), snapshot);
  assert.deepEqual(calls, [
    {
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID
    }
  ]);
  assert.equal(
    response.headers.get("x-request-id"),
    "request_alakazam_account_1"
  );

  const signedOut = await api.fetch(
    request(PROJECT_ID, false)
  );
  assert.equal(signedOut.status, 401);
  assert.equal(
    (await signedOut.json()).error.code,
    "AUTHENTICATION_REQUIRED"
  );
  assert.equal(calls.length, 1);
});

test("the default hosted runtime keeps the Alakazam account route explicitly held", async () => {
  const api = createHostedApi(service());
  const response = await api.fetch(request());
  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).error.code,
    "ALAKAZAM_ACCOUNT_HELD"
  );
});

test("the production executable composes the account route from canonical project and PostgreSQL authority", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /const alakazamRepository\s*=\s*createPostgresAlakazamRepository\(\{ authority \}\)/u
  );
  assert.match(
    source,
    /account:\s*createAlakazamAccountService\(\{\s*repository:\s*alakazamRepository\s*\}\)/u
  );
  assert.match(
    source,
    /resolveSession:\s*commerceV2\.resolveSession/u
  );
  assert.match(
    source,
    /createHostedApi\(service,\s*\{\s*downloadCommerce,\s*alakazamAccount,/u
  );
});
