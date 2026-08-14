import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BASE = "/api/v1/operator/adjacent-integrations";

export const ADJACENT_INTEGRATION_HTTP_ROUTES = deepFreeze([
  { method: "GET", path: `${BASE}/contracts`, action: "listContracts" },
  { method: "GET", path: `${BASE}/trace`, action: "listTrace" },
  { method: "POST", path: `${BASE}/snapshots`, action: "recordGlobalSnapshot" },
  { method: "POST", path: `${BASE}/crosswalks`, action: "recordCrosswalk" },
  { method: "POST", path: `${BASE}/observations`, action: "recordObservation" },
  { method: "POST", path: `${BASE}/resolutions`, action: "resolveCrosswalk" }
]);

function actorId(actor) {
  invariant(
    actor && typeof actor === "object" && UUID.test(actor.userId),
    "AUTHENTICATION_REQUIRED",
    "Sign in to use adjacent integration tools.",
    { status: 401 }
  );
  return actor.userId;
}

function exactBody(value, keys) {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...keys].sort()),
    "ADJACENT_INTEGRATION_INVALID",
    "Adjacent integration request body is invalid.",
    { status: 400 }
  );
  return value;
}

function exactQuery(query, required, optional = []) {
  invariant(
    query instanceof URLSearchParams &&
      required.every((key) => query.getAll(key).length === 1) &&
      optional.every((key) => query.getAll(key).length <= 1) &&
      [...query.keys()].every((key) =>
        required.includes(key) || optional.includes(key)
      ) &&
      [...query.keys()].length === new Set(query.keys()).size,
    "ADJACENT_INTEGRATION_INVALID",
    "Adjacent integration query is invalid.",
    { status: 400 }
  );
  return Object.fromEntries(
    [...required, ...optional].map((key) => [key, query.get(key)])
  );
}

export function matchAdjacentIntegrationHttpRoute(method, pathname) {
  const selected = ADJACENT_INTEGRATION_HTTP_ROUTES.find(
    (route) => route.method === method && route.path === pathname
  );
  return selected ? deepFreeze({ action: selected.action, params: {} }) : null;
}

export function createAdjacentIntegrationHttpBoundary({ service } = {}) {
  invariant(
    service && [
      "listContracts", "listTrace", "recordGlobalSnapshot",
      "recordCrosswalk", "recordObservation", "resolveCrosswalk"
    ].every((method) => typeof service[method] === "function") &&
      service.remoteWrites === false && service.providerEffects === false &&
      service.automaticCommands === false,
    "ADJACENT_INTEGRATION_CONFIGURATION_REQUIRED",
    "A no-effect adjacent integration service is required.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "adjacent-integration-http",
    mode: service.mode,
    remoteWrites: false,
    providerEffects: false,
    automaticCommands: false,
    manifest: ADJACENT_INTEGRATION_HTTP_ROUTES,
    match: matchAdjacentIntegrationHttpRoute,
    async dispatch({ method, pathname, actor, query, body, commandId } = {}) {
      const route = matchAdjacentIntegrationHttpRoute(method, pathname);
      if (route === null) return null;
      const selectedActorId = actorId(actor);
      if (route.action === "listContracts") {
        const selected = exactQuery(query, ["operatorOrganizationId"]);
        return Object.freeze({
          status: 200,
          result: await service.listContracts({
            actorId: selectedActorId,
            operatorOrganizationId: selected.operatorOrganizationId
          })
        });
      }
      if (route.action === "listTrace") {
        const selected = exactQuery(
          query,
          ["operatorOrganizationId"],
          ["crosswalkId", "projectId", "systemKey"]
        );
        return Object.freeze({
          status: 200,
          result: await service.listTrace({
            actorId: selectedActorId,
            crosswalkId: selected.crosswalkId,
            operatorOrganizationId: selected.operatorOrganizationId,
            projectId: selected.projectId,
            systemKey: selected.systemKey
          })
        });
      }
      const specifications = {
        recordGlobalSnapshot: [
          "observationKind", "observationState", "operatorOrganizationId",
          "remoteEntityKind", "remoteReference", "sourceObservedAt",
          "sourcePayloadDigest", "sourceRevision", "systemKey"
        ],
        recordCrosswalk: [
          "localEntityId", "localEntityKind", "operatorOrganizationId",
          "projectId", "referencePolicy", "remoteEntityKind",
          "remoteReference", "sourceEvidenceDigest", "sourceRevision",
          "sourceSnapshotId", "state", "supersedesCrosswalkId", "systemKey"
        ],
        recordObservation: [
          "crosswalkId", "observationKind", "observationState",
          "operatorOrganizationId", "projectId", "sourceObservedAt",
          "sourcePayloadDigest", "sourceRevision", "sourceSnapshotId",
          "systemKey"
        ],
        resolveCrosswalk: [
          "crosswalkId", "expectedCrosswalkRequestDigest",
          "expectedCrosswalkRevision", "operatorOrganizationId", "priorState",
          "resolutionEvidenceDigest", "resolutionKind", "resultingState",
          "systemKey"
        ]
      };
      const selected = exactBody(body, specifications[route.action]);
      const result = await service[route.action]({
        ...selected,
        actorId: selectedActorId,
        commandId
      });
      return Object.freeze({ status: 201, result });
    }
  });
}
