import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION_TOKEN = "session_alakazam_retained_premium";
const CSRF = "c".repeat(40);
const CUSTOMER_ID = "20000000-0000-4000-8000-000000000001";
const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const COMMAND_ID = "50000000-0000-4000-8000-000000000001";

function service() {
  return {
    async readiness() { return {}; },
    async authenticate(token) {
      return token === SESSION_TOKEN ? { userId: CUSTOMER_ID } : null;
    }
  };
}

function readRequest(route) {
  return new Request(`${ORIGIN}${route}`, {
    headers: { Cookie: `ss_session=${SESSION_TOKEN}` }
  });
}

function restoreRequest(route, body) {
  return new Request(`${ORIGIN}${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      Cookie: `ss_session=${SESSION_TOKEN}; ss_csrf=${CSRF}`,
      "X-CSRF-Token": CSRF,
      "Idempotency-Key": COMMAND_ID
    },
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
      calls.push(["snapshot", actor, projectId]);
      return { projectId, state: "held" };
    },
    async getExport(actor, projectId) {
      calls.push(["export", actor, projectId]);
      return { projectId, state: "held", providerEffects: false };
    },
    async restoreConfiguration(actor, projectId, input) {
      calls.push(["restore", actor, projectId, input]);
      return { projectId, state: "held", commandId: input.commandId };
    }
  };
}

test("retained-premium HTTP routes expose only held reads, export, and exact restoration", async () => {
  const calls = [];
  const api = createHostedApi(service(), {
    alakazamRetainedPremium: boundary(calls)
  });
  const route = `/api/v1/projects/${PROJECT_ID}/alakazam/premium`;
  const snapshot = await api.fetch(readRequest(route));
  const exported = await api.fetch(readRequest(`${route}/export`));
  const restoreBody = {
    expectedSourceConfigurationDigest: "a".repeat(64),
    expectedSubscriptionRevision: 9
  };
  const restored = await api.fetch(
    restoreRequest(`${route}/restorations`, restoreBody)
  );
  assert.equal(snapshot.status, 200);
  assert.equal(exported.status, 200);
  assert.equal(restored.status, 202);
  assert.deepEqual(calls, [
    ["snapshot", { userId: CUSTOMER_ID }, PROJECT_ID],
    ["export", { userId: CUSTOMER_ID }, PROJECT_ID],
    [
      "restore",
      { userId: CUSTOMER_ID },
      PROJECT_ID,
      { ...restoreBody, commandId: COMMAND_ID }
    ]
  ]);
  const capabilities = await api.fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(
    (await capabilities.json()).alakazamRetainedPremium,
    true
  );
});

test("retained-premium HTTP default and request drift fail closed", async () => {
  const route = `/api/v1/projects/${PROJECT_ID}/alakazam/premium`;
  const held = await createHostedApi(service()).fetch(readRequest(route));
  assert.equal(held.status, 503);
  assert.equal(
    (await held.json()).error.code,
    "ALAKAZAM_RETAINED_PREMIUM_HELD"
  );
  const calls = [];
  const api = createHostedApi(service(), {
    alakazamRetainedPremium: boundary(calls)
  });
  const query = await api.fetch(readRequest(`${route}?extra=true`));
  assert.equal(query.status, 400);
  assert.equal(
    (await query.json()).error.code,
    "ALAKAZAM_RETAINED_PREMIUM_ROUTE_BINDING_REJECTED"
  );
  const extra = await api.fetch(restoreRequest(
    `${route}/restorations`,
    {
      expectedSourceConfigurationDigest: "a".repeat(64),
      expectedSubscriptionRevision: 9,
      extra: true
    }
  ));
  assert.equal(extra.status, 400);
  assert.equal(
    (await extra.json()).error.code,
    "ALAKAZAM_RETAINED_PREMIUM_ROUTE_BINDING_REJECTED"
  );
  assert.deepEqual(calls, []);
});

test("production composes retained premium and generic publication without provider ports", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  const retained = source.match(
    /createAlakazamRetainedPremiumComposition\(\{[\s\S]*?\}\);/u
  )?.[0] ?? "";
  assert.match(retained, /repository: alakazamRetainedPremiumRepository/u);
  assert.doesNotMatch(
    retained,
    /\b(?:provider|stripe|publicationPort|tenantRuntime)\s*:/u
  );
  const publication = source.match(
    /createPublicationControlComposition\(\{[\s\S]*?\}\);/u
  )?.[0] ?? "";
  assert.match(publication, /authority/u);
  assert.doesNotMatch(
    publication,
    /\b(?:provider|publicationPort|runtimePublisher|stripe)\s*:/u
  );
});
