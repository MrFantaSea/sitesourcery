import assert from "node:assert/strict";
import test from "node:test";

import {
  ADJACENT_INTEGRATION_HTTP_ROUTES,
  createAdjacentIntegrationHttpBoundary,
  matchAdjacentIntegrationHttpRoute
} from "../adjacent-integration-http.mjs";

const USER = "00000000-0000-4000-8000-000000000001";
const ORG = "00000000-0000-4000-8000-000000000002";
const PROJECT = "00000000-0000-4000-8000-000000000003";

function boundary() {
  const calls = [];
  const service = {
    mode: "manual-read-only",
    remoteWrites: false,
    providerEffects: false,
    automaticCommands: false
  };
  for (const method of [
    "listContracts", "listTrace", "recordGlobalSnapshot",
    "recordCrosswalk", "recordObservation", "resolveCrosswalk"
  ]) {
    service[method] = async (input) => {
      calls.push({ method, input });
      return { method };
    };
  }
  return {
    calls,
    boundary: createAdjacentIntegrationHttpBoundary({ service })
  };
}

test("adjacent HTTP exposes six exact operator routes", () => {
  assert.equal(ADJACENT_INTEGRATION_HTTP_ROUTES.length, 6);
  assert.equal(
    matchAdjacentIntegrationHttpRoute(
      "GET", "/api/v1/operator/adjacent-integrations/contracts"
    ).action,
    "listContracts"
  );
  assert.equal(matchAdjacentIntegrationHttpRoute("GET", "/nope"), null);
});

test("adjacent HTTP lists contract and bounded trace evidence", async () => {
  const selected = boundary();
  const contracts = await selected.boundary.dispatch({
    method: "GET",
    pathname: "/api/v1/operator/adjacent-integrations/contracts",
    actor: { userId: USER },
    query: new URLSearchParams({ operatorOrganizationId: ORG }),
    body: {},
    commandId: null
  });
  const trace = await selected.boundary.dispatch({
    method: "GET",
    pathname: "/api/v1/operator/adjacent-integrations/trace",
    actor: { userId: USER },
    query: new URLSearchParams({
      operatorOrganizationId: ORG,
      projectId: PROJECT,
      systemKey: "client_profile_hub"
    }),
    body: {},
    commandId: null
  });
  assert.equal(contracts.status, 200);
  assert.equal(trace.status, 200);
  assert.deepEqual(selected.calls, [
    {
      method: "listContracts",
      input: { actorId: USER, operatorOrganizationId: ORG }
    },
    {
      method: "listTrace",
      input: {
        actorId: USER,
        crosswalkId: null,
        operatorOrganizationId: ORG,
        projectId: PROJECT,
        systemKey: "client_profile_hub"
      }
    }
  ]);
});

test("adjacent HTTP injects actor and idempotency without accepting extra keys", async () => {
  const selected = boundary();
  const body = {
    observationKind: "availability",
    observationState: "available",
    operatorOrganizationId: ORG,
    remoteEntityKind: "service",
    remoteReference: `sha256:${"a".repeat(64)}`,
    sourceObservedAt: "2026-08-14T13:00:00.000Z",
    sourcePayloadDigest: "b".repeat(64),
    sourceRevision: `git:${"c".repeat(40)}`,
    systemKey: "command_deck"
  };
  const response = await selected.boundary.dispatch({
    method: "POST",
    pathname: "/api/v1/operator/adjacent-integrations/snapshots",
    actor: { userId: USER },
    query: new URLSearchParams(),
    body,
    commandId: "adjacent.http.1"
  });
  assert.equal(response.status, 201);
  assert.deepEqual(selected.calls[0].input, {
    ...body,
    actorId: USER,
    commandId: "adjacent.http.1"
  });
  await assert.rejects(
    selected.boundary.dispatch({
      method: "POST",
      pathname: "/api/v1/operator/adjacent-integrations/snapshots",
      actor: { userId: USER },
      query: new URLSearchParams(),
      body: { ...body, rawMessage: "forbidden" },
      commandId: "adjacent.http.2"
    }),
    { code: "ADJACENT_INTEGRATION_INVALID", status: 400 }
  );
});

test("adjacent HTTP denies missing authentication", async () => {
  const selected = boundary();
  await assert.rejects(
    selected.boundary.dispatch({
      method: "GET",
      pathname: "/api/v1/operator/adjacent-integrations/contracts",
      actor: null,
      query: new URLSearchParams({ operatorOrganizationId: ORG })
    }),
    { code: "AUTHENTICATION_REQUIRED", status: 401 }
  );
});
