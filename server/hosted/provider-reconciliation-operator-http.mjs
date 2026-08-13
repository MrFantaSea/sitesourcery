import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const CASE_PATH = new RegExp(
  `^/api/v1/operator/provider-reconciliation/cases/(${UUID_PATTERN})$`,
  "u"
);
const RESOLUTION_PATH = new RegExp(
  `^/api/v1/operator/provider-reconciliation/cases/(${UUID_PATTERN})/resolution$`,
  "u"
);
const UUID = new RegExp(`^${UUID_PATTERN}$`, "u");

export const OPERATOR_PROVIDER_RECONCILIATION_HTTP_ROUTES = deepFreeze([
  {
    method: "GET",
    path: "/api/v1/operator/provider-reconciliation/cases/:caseId",
    action: "readCase"
  },
  {
    method: "POST",
    path: "/api/v1/operator/provider-reconciliation/cases/:caseId/resolution",
    action: "resolveCase"
  }
]);

function actorId(actor) {
  invariant(
    actor && typeof actor === "object" && UUID.test(actor.userId),
    "AUTHENTICATION_REQUIRED",
    "Sign in to use operator reconciliation tools.",
    { status: 401 }
  );
  return actor.userId;
}

function exactBody(value, keys) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...keys].sort()),
    "OPERATOR_RECONCILIATION_INVALID",
    "The operator reconciliation request is invalid.",
    { status: 400 }
  );
  return value;
}

function exactQuery(value, keys) {
  invariant(
    value instanceof URLSearchParams &&
      [...value.keys()].length === keys.length &&
      keys.every((key) => value.getAll(key).length === 1),
    "OPERATOR_RECONCILIATION_INVALID",
    "The operator reconciliation query is invalid.",
    { status: 400 }
  );
  return Object.fromEntries(keys.map((key) => [key, value.get(key)]));
}

export function matchOperatorProviderReconciliationHttpRoute(
  method,
  pathname
) {
  if (method === "GET") {
    const matched = CASE_PATH.exec(pathname);
    if (matched) {
      return deepFreeze({ action: "readCase", params: { caseId: matched[1] } });
    }
  }
  if (method === "POST") {
    const matched = RESOLUTION_PATH.exec(pathname);
    if (matched) {
      return deepFreeze({
        action: "resolveCase",
        params: { caseId: matched[1] }
      });
    }
  }
  return null;
}

export function createProviderReconciliationOperatorHttpBoundary({
  operator
} = {}) {
  invariant(
    operator &&
      typeof operator.readCase === "function" &&
      typeof operator.resolveCase === "function" &&
      operator.providerEffects === false &&
      operator.genericRepair === false,
    "OPERATOR_RECONCILIATION_CONFIGURATION_REQUIRED",
    "A bounded provider reconciliation operator is required.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "provider-reconciliation-operator-http",
    mode: "repository",
    providerEffects: false,
    genericRepair: false,
    manifest: OPERATOR_PROVIDER_RECONCILIATION_HTTP_ROUTES,
    match: matchOperatorProviderReconciliationHttpRoute,
    async dispatch({ method, pathname, actor, query, body, commandId } = {}) {
      const route = matchOperatorProviderReconciliationHttpRoute(
        method, pathname
      );
      if (route === null) return null;
      const selectedActorId = actorId(actor);
      if (route.action === "readCase") {
        const selected = exactQuery(query, ["operatorOrganizationId"]);
        return Object.freeze({
          status: 200,
          result: await operator.readCase({
            actorId: selectedActorId,
            operatorOrganizationId: selected.operatorOrganizationId,
            caseId: route.params.caseId
          })
        });
      }
      const selected = exactBody(body, [
        "evidenceDigest",
        "expectedRevision",
        "operatorOrganizationId",
        "resolutionKind"
      ]);
      return Object.freeze({
        status: 200,
        result: await operator.resolveCase({
          ...selected,
          actorId: selectedActorId,
          caseId: route.params.caseId,
          commandId
        })
      });
    }
  });
}

export function createHeldProviderReconciliationOperatorHttp() {
  return Object.freeze({
    kind: "held-provider-reconciliation-operator-http",
    mode: "held",
    providerEffects: false,
    genericRepair: false,
    manifest: OPERATOR_PROVIDER_RECONCILIATION_HTTP_ROUTES,
    match: matchOperatorProviderReconciliationHttpRoute,
    async dispatch(request = {}) {
      const route = matchOperatorProviderReconciliationHttpRoute(
        request.method, request.pathname
      );
      if (route === null) return null;
      actorId(request.actor);
      throw new HostedError(
        "OPERATOR_RECONCILIATION_HELD",
        "The operator reconciliation interface is held.",
        {
          status: 503,
          details: { providerEffects: false, genericRepair: false }
        }
      );
    }
  });
}
