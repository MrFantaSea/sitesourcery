import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createAlakazamPublicationCommand,
  createAlakazamPublicationService,
  createHostedAlakazamPublication,
  projectAlakazamPublication
} from "../../commerce-v2/index.mjs";
import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION_TOKEN = "session_alakazam_publication";
const CSRF = "c".repeat(40);
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const RELEASE_ID =
  "40000000-0000-4000-8000-000000000001";
const PRIOR_VERSION_ID =
  "60000000-0000-4000-8000-000000000002";
const COMMAND_ID =
  "50000000-0000-4000-8000-000000000001";
const SNAPSHOT_DIGEST = "d".repeat(64);

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

function readRequest(path, signedIn = true) {
  return new Request(`${ORIGIN}${path}`, {
    headers: signedIn
      ? { Cookie: `ss_session=${SESSION_TOKEN}` }
      : {}
  });
}

function writeRequest(path, body, overrides = {}) {
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
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

test("the default publication boundary authenticates and stays explicitly held", async () => {
  const api = createHostedApi(service());
  const path =
    `/api/v1/projects/${PROJECT_ID}/alakazam/publication`;
  const held = await api.fetch(readRequest(path));
  assert.equal(held.status, 503);
  assert.equal(
    (await held.json()).error.code,
    "ALAKAZAM_PUBLICATION_HELD"
  );
  const signedOut = await api.fetch(readRequest(path, false));
  assert.equal(signedOut.status, 401);
  assert.equal(
    (await signedOut.json()).error.code,
    "AUTHENTICATION_REQUIRED"
  );
  const capabilities = await api.fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(
    (await capabilities.json()).alakazamPublication,
    false
  );
});

test("publication routes preserve authenticated project, exact body, and command identity", async () => {
  const calls = [];
  const snapshot = {
    schema: "sitesourcery.alakazam-publication/v1",
    projectId: PROJECT_ID,
    state: "held",
    snapshotDigest: SNAPSHOT_DIGEST
  };
  const api = createHostedApi(service(), {
    alakazamPublication: {
      async readiness() {
        return {
          ready: true,
          authorization: true,
          providerEffects: false,
          state: "held"
        };
      },
      async getSnapshot(actor, projectId) {
        calls.push(["read", structuredClone(actor), projectId]);
        return structuredClone(snapshot);
      },
      async requestCommand(actor, projectId, command) {
        calls.push([
          "command",
          structuredClone(actor),
          projectId,
          structuredClone(command)
        ]);
        return {
          command: {
            commandId: command.commandId,
            state: "held"
          },
          publication: structuredClone(snapshot)
        };
      }
    }
  });
  const path =
    `/api/v1/projects/${PROJECT_ID}/alakazam/publication`;
  const read = await api.fetch(readRequest(path));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), snapshot);

  const commandPath = `${path}-commands`;
  const body = {
    action: "rollback",
    snapshotDigest: SNAPSHOT_DIGEST,
    targetReleaseId: RELEASE_ID
  };
  const command = await api.fetch(
    writeRequest(commandPath, body)
  );
  assert.equal(command.status, 202);
  assert.equal(
    (await command.json()).command.commandId,
    COMMAND_ID
  );
  assert.deepEqual(calls, [
    ["read", { userId: CUSTOMER_ID }, PROJECT_ID],
    [
      "command",
      { userId: CUSTOMER_ID },
      PROJECT_ID,
      { ...body, commandId: COMMAND_ID }
    ]
  ]);

  for (const request of [
    readRequest(`${path}?extra=true`),
    writeRequest(commandPath, { ...body, extra: true }),
    writeRequest(commandPath, {
      action: body.action,
      snapshotDigest: body.snapshotDigest
    }),
    writeRequest(`${commandPath}?extra=true`, body)
  ]) {
    const rejected = await api.fetch(request);
    assert.equal(rejected.status, 400);
    assert.equal(
      (await rejected.json()).error.code,
      "ALAKAZAM_PUBLICATION_ROUTE_BINDING_REJECTED"
    );
  }
  assert.equal(calls.length, 2);

  const signedOut = await api.fetch(
    writeRequest(commandPath, body, { signedIn: false })
  );
  assert.equal(signedOut.status, 401);
  assert.equal(
    (await signedOut.json()).error.code,
    "AUTHENTICATION_REQUIRED"
  );
  const noCsrf = await api.fetch(
    writeRequest(commandPath, body, { csrf: false })
  );
  assert.equal(noCsrf.status, 403);
  assert.equal(
    (await noCsrf.json()).error.code,
    "CSRF_TOKEN_REQUIRED"
  );
  const noCommandId = await api.fetch(
    writeRequest(commandPath, body, { idempotency: false })
  );
  assert.equal(noCommandId.status, 400);
  assert.equal(
    (await noCommandId.json()).error.code,
    "IDEMPOTENCY_KEY_REQUIRED"
  );
  assert.equal(calls.length, 2);
});

test("publication HTTP rejects malformed, stale, and rogue authority before recording a command", async () => {
  const stored = {
    projectId: PROJECT_ID,
    subscription: {
      subscriptionId:
        "70000000-0000-4000-8000-000000000001",
      revision: 4,
      tierId: "alakazam_35",
      status: "active"
    },
    site: {
      hostname: "cedar-workshop.sitesourcery.me",
      state: "live",
      acceptedVersionId:
        "60000000-0000-4000-8000-000000000001",
      acceptedArtifactDigest: "a".repeat(64),
      currentReleaseId: RELEASE_ID,
      currentVersionId:
        "60000000-0000-4000-8000-000000000001",
      updatedAt: "2026-08-08T13:30:00.000Z"
    },
    history: [
      {
        releaseId: RELEASE_ID,
        versionId:
          "60000000-0000-4000-8000-000000000001",
        artifactDigest: "a".repeat(64),
        releasedAt: "2026-08-08T13:30:00.000Z",
        isCurrent: true
      },
      {
        releaseId:
          "40000000-0000-4000-8000-000000000002",
        versionId: PRIOR_VERSION_ID,
        artifactDigest: "b".repeat(64),
        releasedAt: "2026-08-01T13:30:00.000Z",
        isCurrent: false
      }
    ],
    lastCommand: null
  };
  let records = 0;
  const publication = createAlakazamPublicationService({
    repository: {
      async readiness() {
        return {
          ready: true,
          authorization: true,
          providerEffects: false,
          state: "held"
        };
      },
      async readCustomerPublication() {
        return structuredClone(stored);
      },
      async recordCustomerPublicationCommand(input) {
        createAlakazamPublicationCommand({
          scope: {
            tenantId: input.tenantId,
            customerId: input.customerId,
            actorId: input.actorId,
            projectId: input.projectId
          },
          publication: stored,
          request: {
            commandId: input.commandId,
            action: input.action,
            snapshotDigest: input.snapshotDigest,
            targetReleaseId: input.targetReleaseId
          },
          requestedAt: input.requestedAt
        });
        records += 1;
        throw new Error("invalid command passed canonical authority");
      }
    },
    clock: {
      now: () => new Date("2026-08-08T14:00:00.000Z")
    }
  });
  const boundary = createHostedAlakazamPublication({
    publication,
    async resolveSession({ actor, projectId }) {
      return {
        tenantId:
          "10000000-0000-4000-8000-000000000001",
        customerId: actor.userId,
        actorId: actor.userId,
        projectId
      };
    }
  });
  const api = createHostedApi(service(), {
    alakazamPublication: boundary
  });
  const commandPath =
    `/api/v1/projects/${PROJECT_ID}` +
    "/alakazam/publication-commands";
  const snapshot = projectAlakazamPublication(stored);
  const cases = [
    {
      request: writeRequest(
        commandPath,
        {
          action: "rollback",
          snapshotDigest: snapshot.snapshotDigest,
          targetReleaseId:
            "40000000-0000-4000-8000-000000000002"
        },
        { idempotencyKey: "not-a-command-id" }
      ),
      status: 400,
      code: "ALAKAZAM_INVALID_INPUT"
    },
    {
      request: writeRequest(commandPath, {
        action: "rollback",
        snapshotDigest: "f".repeat(64),
        targetReleaseId:
          "40000000-0000-4000-8000-000000000002"
      }),
      status: 409,
      code: "ALAKAZAM_PUBLICATION_AUTHORITY_CHANGED"
    },
    {
      request: writeRequest(commandPath, {
        action: "rollback",
        snapshotDigest: snapshot.snapshotDigest,
        targetReleaseId:
          "40000000-0000-4000-8000-000000000003"
      }),
      status: 409,
      code: "ALAKAZAM_PUBLICATION_AUTHORITY_CHANGED"
    }
  ];
  for (const item of cases) {
    const response = await api.fetch(item.request);
    const payload = await response.json();
    assert.equal(
      response.status,
      item.status,
      `${item.code}: ${JSON.stringify(payload)}`
    );
    assert.equal(payload.error.code, item.code);
  }
  assert.equal(records, 0);
});

test("publication capability reports authorization without provider effects", async () => {
  const boundary = {
    async readiness() {
      return {
        ready: true,
        authorization: true,
        providerEffects: false,
        state: "held"
      };
    },
    async getSnapshot() {
      throw new Error("unused");
    },
    async requestCommand() {
      throw new Error("unused");
    }
  };
  const api = createHostedApi(service(), {
    alakazamPublication: boundary
  });
  const response = await api.fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).alakazamPublication,
    true
  );
  boundary.readiness = async () => ({
    authorization: true,
    providerEffects: true
  });
  const providerEnabled = await api.fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(
    (await providerEnabled.json()).alakazamPublication,
    false
  );
});

test("the production executable composes publication authorization without a provider port", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /createAlakazamPublicationComposition\(\{\s*authority,\s*resolveSession:\s*commerceV2\.resolveSession,\s*clock:\s*commerceV2\.clock\s*\}\)/u
  );
  assert.match(source, /await alakazamPublication\.readiness\(\)/u);
  assert.match(
    source,
    /createHostedApi\(service,\s*\{\s*downloadCommerce,\s*alakazamAccount,\s*alakazamPublication,/u
  );
  const composition = source.match(
    /createAlakazamPublicationComposition\(\{[\s\S]*?\}\);/u
  )?.[0];
  assert.ok(composition);
  assert.doesNotMatch(
    composition,
    /\b(?:provider|stripe|tenantRuntime)\s*:/u
  );
});
