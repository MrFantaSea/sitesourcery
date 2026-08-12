import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const QUEUE_REPAIR_PATH =
  /^\/api\/v1\/operator\/work-queue\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/repairs\/professional-reversal$/u;

export const OPERATOR_WORK_QUEUE_HTTP_ROUTES = deepFreeze([
  { method: "GET", path: "/api/v1/operator/work-queue", action: "list" },
  { method: "POST", path: "/api/v1/operator/work-queue/refresh", action: "refresh" },
  {
    method: "POST",
    path: "/api/v1/operator/work-queue/:queueItemId/repairs/professional-reversal",
    action: "dispatchProfessionalReversalRepair"
  }
]);

// Retained as a compatibility export for the prior held-only contract.
export const HELD_OPERATOR_WORK_QUEUE_HTTP_MANIFEST =
  OPERATOR_WORK_QUEUE_HTTP_ROUTES;

function held() {
  throw new HostedError(
    "OPERATOR_QUEUE_HELD",
    "The operator work queue HTTP interface is held.",
    {
      status: 503,
      details: {
        providerEffects: false,
        alertEffects: false,
        genericRepair: false
      }
    }
  );
}

function actorId(actor) {
  invariant(
    actor && typeof actor === "object" && UUID.test(actor.userId),
    "AUTHENTICATION_REQUIRED",
    "Sign in to use operator work tools.",
    { status: 401 }
  );
  return actor.userId;
}

function exactBody(value, keys) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...keys].sort()),
    "OPERATOR_QUEUE_INVALID",
    "The operator queue request is invalid.",
    { status: 400 }
  );
  return value;
}

function exactQuery(value, keys) {
  invariant(
    value instanceof URLSearchParams &&
      [...value.keys()].length === keys.length &&
      keys.every((key) => value.getAll(key).length === 1),
    "OPERATOR_QUEUE_INVALID",
    "The operator queue query is invalid.",
    { status: 400 }
  );
  return Object.fromEntries(keys.map((key) => [key, value.get(key)]));
}

export function matchOperatorWorkQueueHttpRoute(method, pathname) {
  if (method === "GET" && pathname === "/api/v1/operator/work-queue") {
    return deepFreeze({ action: "list", params: {} });
  }
  if (method === "POST" && pathname === "/api/v1/operator/work-queue/refresh") {
    return deepFreeze({ action: "refresh", params: {} });
  }
  if (method === "POST") {
    const repair = QUEUE_REPAIR_PATH.exec(pathname);
    if (repair) {
      return deepFreeze({
        action: "dispatchProfessionalReversalRepair",
        params: { queueItemId: repair[1] }
      });
    }
  }
  return null;
}

export function createOperatorWorkQueueHttpBoundary({ operatorQueue } = {}) {
  invariant(
    operatorQueue &&
      ["list", "refresh", "dispatchProfessionalReversalRepair"].every(
        (method) => typeof operatorQueue[method] === "function"
      ) &&
      operatorQueue.providerEffects === false &&
      operatorQueue.alertEffects === false &&
      operatorQueue.genericRepair === false,
    "OPERATOR_QUEUE_CONFIGURATION_REQUIRED",
    "A bounded no-provider-effect operator queue is required.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "operator-work-queue-http",
    mode: "repository",
    providerEffects: false,
    alertEffects: false,
    genericRepair: false,
    manifest: OPERATOR_WORK_QUEUE_HTTP_ROUTES,
    match: matchOperatorWorkQueueHttpRoute,
    async dispatch({ method, pathname, actor, query, body, commandId } = {}) {
      const route = matchOperatorWorkQueueHttpRoute(method, pathname);
      if (!route) return null;
      const userId = actorId(actor);
      if (route.action === "list") {
        const selected = exactQuery(query, ["operatorOrganizationId"]);
        return Object.freeze({
          status: 200,
          result: await operatorQueue.list({
            actorId: userId,
            operatorOrganizationId: selected.operatorOrganizationId
          })
        });
      }
      if (route.action === "refresh") {
        const selected = exactBody(body, ["operatorOrganizationId"]);
        return Object.freeze({
          status: 200,
          result: await operatorQueue.refresh({
            actorId: userId,
            operatorOrganizationId: selected.operatorOrganizationId
          })
        });
      }
      const selected = exactBody(body, [
        "confirmedOutcome",
        "expectedQueueRevision",
        "operatorOrganizationId",
        "resolution",
        "verifiedFacts",
        "verifiedFactsDigest",
        "verifiedObservedAt"
      ]);
      return Object.freeze({
        status: 200,
        result: await operatorQueue.dispatchProfessionalReversalRepair({
          ...selected,
          actorId: userId,
          commandId,
          queueItemId: route.params.queueItemId
        })
      });
    }
  });
}

export function createHeldOperatorWorkQueueHttp({ authenticate } = {}) {
  invariant(
    typeof authenticate === "function",
    "OPERATOR_QUEUE_CONFIGURATION_REQUIRED",
    "Operator authentication is required for the held queue interface.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "held-operator-work-queue-http",
    mode: "held",
    providerEffects: false,
    alertEffects: false,
    genericRepair: false,
    manifest: OPERATOR_WORK_QUEUE_HTTP_ROUTES,
    match: matchOperatorWorkQueueHttpRoute,
    async dispatch(request) {
      const selected = matchOperatorWorkQueueHttpRoute(
        request?.method,
        request?.pathname
      );
      if (selected === null) return null;
      actorId(await authenticate(request));
      return held();
    }
  });
}
