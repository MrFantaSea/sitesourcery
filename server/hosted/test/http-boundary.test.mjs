import assert from "node:assert/strict";
import test from "node:test";

import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const CSRF = "c".repeat(43);
const SESSION = "session_customer_1";
const ACTOR = Object.freeze({
  userId: "00000000-0000-4000-8000-000000000001"
});

function jsonBody(response) {
  return response.json();
}

function createContext({
  readiness = {
    ready: true,
    persistence: {
      ready: true,
      database:
        "postgresql://private-database"
    },
    payments: {
      ready: false,
      secretKey: "sk_live_never-public",
      webhookSecret:
        "whsec_never-public"
    }
  }
} = {}) {
  let requestSequence = 0;
  let csrfIssues = 0;
  const calls = {
    register: [],
    recovery: [],
    rollback: [],
    webhook: [],
    authenticate: [],
    readiness: []
  };
  const service = {
    async authenticate(token) {
      calls.authenticate.push(token);
      return token === SESSION ? ACTOR : null;
    },
    async readiness() {
      calls.readiness.push(true);
      return structuredClone(readiness);
    },
    async register(input) {
      calls.register.push(input);
      return {
        sessionToken: "new_session_token",
        user: { userId: ACTOR.userId }
      };
    },
    async requestRecovery(input) {
      calls.recovery.push(input);
      return {
        accepted: true,
        delivery: "manual_operator",
        emailSent: false
      };
    },
    async me(actor) {
      return { user: actor };
    },
    async rollbackRelease(actor, projectId, versionId, input) {
      calls.rollback.push({ actor, projectId, versionId, input });
      return { release: { projectId, versionId, state: "active" } };
    },
    async ingestStripeWebhook(input) {
      calls.webhook.push(input);
      return {
        received: true,
        eventId: "evt_contract_1",
        status: "processed"
      };
    },
    async downloadExport(actor, projectId, exportId, token) {
      assert.equal(actor, ACTOR);
      assert.equal(projectId, "project_1");
      assert.equal(exportId, "export_1");
      assert.equal(token, "download-token");
      return {
        bytes: Buffer.from("zip-proof"),
        filename: "customer export.zip",
        sha256:
          "09478158e26b658dc71c4d3f978caff6d6ee9418353d0ce29d36db96e8b0b5fe"
      };
    }
  };
  const api = createHostedApi(service, {
    requestIds: {
      next() {
        requestSequence += 1;
        return `req_${requestSequence}`;
      }
    },
    csrfTokens() {
      csrfIssues += 1;
      return CSRF;
    }
  });
  return {
    api,
    calls,
    csrfIssueCount: () => csrfIssues
  };
}

function writeRequest(path, {
  body,
  cookie,
  csrf = CSRF,
  idempotencyKey = "command-customer-1",
  method = "POST",
  origin = ORIGIN
} = {}) {
  const headers = {
    Origin: origin
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie !== undefined) headers.Cookie = cookie;
  if (csrf !== null) headers["X-CSRF-Token"] = csrf;
  if (idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

test("CSRF bootstrap is same-origin, stable across tabs, and required before writes", async () => {
  const context = createContext();
  const first = await context.api.fetch(
    new Request(`${ORIGIN}/api/v1/csrf`, {
      headers: { Origin: ORIGIN }
    })
  );
  assert.equal(first.status, 200);
  assert.equal((await jsonBody(first)).csrfToken, CSRF);
  const csrfCookie = first.headers.get("set-cookie").split(";", 1)[0];
  assert.equal(csrfCookie, `ss_csrf=${CSRF}`);

  const second = await context.api.fetch(
    new Request(`${ORIGIN}/api/v1/me`, {
      headers: {
        Cookie: csrfCookie,
        Origin: ORIGIN
      }
    })
  );
  assert.equal(second.status, 200);
  assert.equal((await jsonBody(second)).csrfToken, CSRF);
  assert.equal(context.csrfIssueCount(), 1);

  const missing = await context.api.fetch(
    writeRequest("/api/v1/auth/register", {
      body: { email: "owner@example.test" },
      cookie: csrfCookie,
      csrf: null
    })
  );
  assert.equal(missing.status, 403);
  assert.equal((await jsonBody(missing)).error.code, "CSRF_TOKEN_REQUIRED");
  assert.equal(context.calls.register.length, 0);

  const crossOrigin = await context.api.fetch(
    writeRequest("/api/v1/auth/register", {
      body: { email: "owner@example.test" },
      cookie: csrfCookie,
      origin: "https://attacker.example"
    })
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal(
    (await jsonBody(crossOrigin)).error.code,
    "CROSS_ORIGIN_REQUEST_REJECTED"
  );
  assert.equal(context.calls.register.length, 0);

  const valid = await context.api.fetch(
    writeRequest("/api/v1/auth/register", {
      body: { email: "owner@example.test" },
      cookie: csrfCookie
    })
  );
  assert.equal(valid.status, 201);
  assert.match(valid.headers.get("set-cookie"), /^ss_session=new_session_token;/u);
  assert.equal(context.calls.register.length, 1);
  assert.equal(
    context.calls.register[0].commandId,
    "command-customer-1"
  );
});

test("health and readiness probes are sessionless, bounded, and nonsecret", async () => {
  const context = createContext();
  const health = await context.api.fetch(
    new Request(`${ORIGIN}/api/v1/health`)
  );
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    service: "sitesourcery-hosted-runtime"
  });
  assert.equal(
    health.headers.get("cache-control"),
    "no-store"
  );
  assert.equal(
    health.headers.get("x-request-id"),
    "req_1"
  );

  const ready = await context.api.fetch(
    new Request(`${ORIGIN}/api/v1/ready`)
  );
  assert.equal(ready.status, 200);
  const readyPayload = await ready.json();
  assert.deepEqual(readyPayload, {
    ready: true,
    service: "sitesourcery-hosted-runtime"
  });
  assert.deepEqual(context.calls.authenticate, []);
  assert.equal(context.calls.readiness.length, 1);
  assert.doesNotMatch(
    JSON.stringify(readyPayload),
    /postgresql|sk_live|whsec|payments|database/iu
  );

  const held = createContext({
    readiness: {
      ready: false,
      reason:
        "private dependency diagnostic"
    }
  });
  const unavailable = await held.api.fetch(
    new Request(`${ORIGIN}/api/v1/ready`)
  );
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    ready: false,
    service: "sitesourcery-hosted-runtime"
  });
  assert.deepEqual(held.calls.authenticate, []);
});

test("HTTP boundary routes exact rollback intent and emits a valid export digest", async () => {
  const context = createContext();
  const cookie = `ss_csrf=${CSRF}; ss_session=${SESSION}`;
  const rollback = await context.api.fetch(
    writeRequest(
      "/api/v1/projects/project_1/versions/version_7/rollback",
      { cookie, idempotencyKey: "rollback-command-1" }
    )
  );
  assert.equal(rollback.status, 202);
  assert.deepEqual(context.calls.rollback, [
    {
      actor: ACTOR,
      projectId: "project_1",
      versionId: "version_7",
      input: { commandId: "rollback-command-1" }
    }
  ]);

  const download = await context.api.fetch(
    new Request(
      `${ORIGIN}/api/v1/projects/project_1/exports/export_1/download?token=download-token`,
      {
        headers: {
          Cookie: `ss_session=${SESSION}`,
          Origin: ORIGIN
        }
      }
    )
  );
  assert.equal(download.status, 200);
  assert.equal(
    download.headers.get("digest"),
    "sha-256=CUeBWOJrZY3HHE0/l4yv9tbulBg1PQzinTbbluiwtf4="
  );
  assert.equal(await download.text(), "zip-proof");
  assert.match(
    download.headers.get("content-disposition"),
    /filename="customer_export\.zip"/u
  );
});

test("recovery response states manual delivery without exposing a token", async () => {
  const context = createContext();
  const response = await context.api.fetch(
    writeRequest("/api/v1/auth/recovery", {
      body: { email: "owner@example.test" },
      cookie: `ss_csrf=${CSRF}`,
      idempotencyKey: "recovery-command-1"
    })
  );
  assert.equal(response.status, 202);
  const payload = await jsonBody(response);
  assert.deepEqual(payload, {
    accepted: true,
    delivery: "manual_operator",
    emailSent: false
  });
  assert.doesNotMatch(JSON.stringify(payload), /token|owner@/iu);
  assert.deepEqual(context.calls.recovery, [
    {
      email: "owner@example.test",
      commandId: "recovery-command-1"
    }
  ]);
});

test("Stripe webhook route preserves exact raw bytes and relies on signature instead of browser CSRF", async () => {
  const context = createContext();
  const raw =
    '{ "id": "evt_contract_1", "exact": "\\u2603" }\n';
  const response = await context.api.fetch(
    new Request(
      `${ORIGIN}/api/v1/webhooks/stripe`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature":
            "t=1785268800,v1=signature-proof"
        },
        body: raw
      }
    )
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    received: true,
    eventId: "evt_contract_1",
    status: "processed"
  });
  assert.equal(context.calls.webhook.length, 1);
  assert.ok(
    Buffer.isBuffer(
      context.calls.webhook[0].rawBody
    )
  );
  assert.equal(
    context.calls.webhook[0].rawBody.toString("utf8"),
    raw
  );
  assert.equal(
    context.calls.webhook[0].signature,
    "t=1785268800,v1=signature-proof"
  );
  assert.deepEqual(context.calls.authenticate, []);
});
