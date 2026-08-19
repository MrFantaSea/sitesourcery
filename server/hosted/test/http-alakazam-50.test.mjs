import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION_TOKEN = "session_alakazam_50";
const CSRF = "c".repeat(40);
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const COMMAND_ID =
  "50000000-0000-4000-8000-000000000001";

function service() {
  return {
    async readiness() {
      return {};
    },
    async authenticate(token) {
      return token === SESSION_TOKEN
        ? { userId: CUSTOMER_ID }
        : null;
    }
  };
}

function readRequest(route, signedIn = true) {
  return new Request(`${ORIGIN}${route}`, {
    headers: signedIn
      ? { Cookie: `ss_session=${SESSION_TOKEN}` }
      : {}
  });
}

function writeRequest(route, body, overrides = {}) {
  const signedIn = overrides.signedIn !== false;
  const headers = {
    "Content-Type": "application/json",
    Origin: ORIGIN,
    Cookie:
      `${signedIn ? `ss_session=${SESSION_TOKEN}; ` : ""}` +
      `ss_csrf=${CSRF}`
  };
  if (overrides.csrf !== false) {
    headers["X-CSRF-Token"] = CSRF;
  }
  if (overrides.idempotency !== false) {
    headers["Idempotency-Key"] =
      overrides.idempotencyKey ?? COMMAND_ID;
  }
  return new Request(`${ORIGIN}${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

function boundary(calls) {
  return {
    async readiness() {
      return {
        ready: true,
        authorization: true,
        providerEffects: false,
        state: "held"
      };
    },
    async getSnapshot(actor, projectId) {
      calls.push(["read", actor, projectId]);
      return { projectId, state: "held" };
    },
    async saveConfiguration(actor, projectId, input) {
      calls.push(["configuration", actor, projectId, input]);
      return { projectId, state: "held", commandId: input.commandId };
    },
    async requestCare(actor, projectId, input) {
      calls.push(["care", actor, projectId, input]);
      return { projectId, state: "held", commandId: input.commandId };
    }
  };
}

test("default F04 HTTP boundary authenticates and remains commercially held", async () => {
  const api = createHostedApi(service());
  const route = `/api/v1/projects/${PROJECT_ID}/alakazam/50`;
  const held = await api.fetch(readRequest(route));
  assert.equal(held.status, 503);
  assert.equal((await held.json()).error.code, "ALAKAZAM_50_HELD");

  const signedOut = await api.fetch(readRequest(route, false));
  assert.equal(signedOut.status, 401);
  assert.equal(
    (await signedOut.json()).error.code,
    "AUTHENTICATION_REQUIRED"
  );

  const capabilities = await api.fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(capabilities.status, 200);
  assert.equal((await capabilities.json()).alakazam50, false);
});

test("F04 HTTP routes preserve project, exact bodies, and idempotent command identity", async () => {
  const calls = [];
  const api = createHostedApi(service(), {
    alakazam50: boundary(calls)
  });
  const route = `/api/v1/projects/${PROJECT_ID}/alakazam/50`;

  const read = await api.fetch(readRequest(route));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), {
    projectId: PROJECT_ID,
    state: "held"
  });

  const configurationBody = {
    borderChoiceId: "double",
    cashAppHandle: "SiteSourcery",
    expectedCurrentRevision: 3,
    fontChoiceId: "display",
    menu: [
      { target: "home", label: "Home", enabled: true },
      { target: "about", label: "Story", enabled: true },
      { target: "offerings", label: "Menu", enabled: true },
      { target: "contact", label: "Pay", enabled: true }
    ],
    venmoHandle: "SiteSourcery"
  };
  const careBody = {
    message: "Please review the premium menu."
  };
  for (const [suffix, body] of [
    ["configurations", configurationBody],
    ["care-requests", careBody]
  ]) {
    const response = await api.fetch(
      writeRequest(`${route}/${suffix}`, body)
    );
    assert.equal(response.status, 202);
    assert.equal((await response.json()).commandId, COMMAND_ID);
  }

  assert.deepEqual(calls, [
    ["read", { userId: CUSTOMER_ID }, PROJECT_ID],
    [
      "configuration",
      { userId: CUSTOMER_ID },
      PROJECT_ID,
      { ...configurationBody, commandId: COMMAND_ID }
    ],
    [
      "care",
      { userId: CUSTOMER_ID },
      PROJECT_ID,
      { ...careBody, commandId: COMMAND_ID }
    ]
  ]);

  const capabilities = await api.fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal((await capabilities.json()).alakazam50, true);
});

test("F04 HTTP rejects query, authentication, CSRF, idempotency, and body drift before the boundary", async () => {
  const calls = [];
  const api = createHostedApi(service(), {
    alakazam50: boundary(calls)
  });
  const route = `/api/v1/projects/${PROJECT_ID}/alakazam/50`;
  const careRoute = `${route}/care-requests`;
  const careBody = { message: "Please review the menu." };

  const queryRead = await api.fetch(readRequest(`${route}?extra=true`));
  assert.equal(queryRead.status, 400);
  assert.equal(
    (await queryRead.json()).error.code,
    "ALAKAZAM_50_ROUTE_BINDING_REJECTED"
  );

  const cases = [
    {
      request: writeRequest(careRoute, careBody, { signedIn: false }),
      status: 401,
      code: "AUTHENTICATION_REQUIRED"
    },
    {
      request: writeRequest(careRoute, careBody, { csrf: false }),
      status: 403,
      code: "CSRF_TOKEN_REQUIRED"
    },
    {
      request: writeRequest(careRoute, careBody, { idempotency: false }),
      status: 400,
      code: "IDEMPOTENCY_KEY_REQUIRED"
    },
    {
      request: writeRequest(`${careRoute}?extra=true`, careBody),
      status: 400,
      code: "ALAKAZAM_50_ROUTE_BINDING_REJECTED"
    },
    {
      request: writeRequest(careRoute, { ...careBody, extra: true }),
      status: 400,
      code: "ALAKAZAM_50_ROUTE_BINDING_REJECTED"
    },
    {
      request: writeRequest(careRoute, {}),
      status: 400,
      code: "ALAKAZAM_50_ROUTE_BINDING_REJECTED"
    }
  ];
  for (const item of cases) {
    const response = await api.fetch(item.request);
    assert.equal(response.status, item.status);
    assert.equal((await response.json()).error.code, item.code);
  }
  assert.deepEqual(calls, []);
});

test("production F04 composition wraps F03 and preserves the commercial enable predicate", async () => {
  const apiSource = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  const workerSource = await readFile(
    new URL("../worker-alakazam-composition.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    workerSource,
    /createAlakazam50FulfillmentRepository\(\{\s*baseRepository: createAlakazam35FulfillmentRepository\(\{[\s\S]*?tierRepository: tier35Repository\s*\}\),\s*tierRepository: tier50Repository\s*\}\)/u
  );
  assert.match(
    workerSource,
    /createAlakazam50TierCompiler\(\{\s*baseCompiler: tier35Compiler,\s*alakazam50Compiler: createAlakazam50Compiler\(\{\s*baseCompiler: tier35Compiler\s*\}\)\s*\}\)/u
  );
  assert.match(
    workerSource,
    /const publication = await publicationPort\.readiness\(\);[\s\S]*?const enabled =\s*shared\.release\.mode === "approved" &&\s*shared\.workerPolicy\.ready === true &&\s*publication\?\.ready === true && publication\?\.held === false;[\s\S]*?createAlakazamFulfillmentWorker\(\{\s*repository,\s*compiler: tier50Compiler,\s*publicationPort,[\s\S]*?enabled,/u
  );
  assert.doesNotMatch(
    workerSource,
    /SelfHostRuntime|createAlakazam35PublicationPort/u
  );
  assert.match(workerSource, /tier35Repository\.readiness\(\)[\s\S]*?tier50Repository\.readiness\(\)/u);
  assert.doesNotMatch(
    apiSource.match(/createAlakazam50Composition\(\{[\s\S]*?\}\);/u)?.[0] ?? "",
    /\b(?:provider|stripe|tenantRuntime|publicationPort)\s*:/u
  );
});
