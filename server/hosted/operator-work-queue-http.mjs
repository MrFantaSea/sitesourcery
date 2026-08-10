import { HostedError, invariant } from "./errors.mjs";

const QUEUE_REPAIR_PATH =
  /^\/api\/owner\/work-queue\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/repairs\/professional-reversal$/u;

export const HELD_OPERATOR_WORK_QUEUE_HTTP_MANIFEST = Object.freeze([
  Object.freeze({ method: "GET", path: "/api/owner/work-queue", action: "list" }),
  Object.freeze({ method: "POST", path: "/api/owner/work-queue/refresh", action: "refresh" }),
  Object.freeze({
    method: "POST",
    path: "/api/owner/work-queue/:queueItemId/repairs/professional-reversal",
    action: "dispatchProfessionalReversalRepair"
  })
]);

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

function route(method, pathname) {
  if (method === "GET" && pathname === "/api/owner/work-queue") {
    return "list";
  }
  if (method === "POST" && pathname === "/api/owner/work-queue/refresh") {
    return "refresh";
  }
  if (
    method === "POST" &&
    QUEUE_REPAIR_PATH.test(pathname)
  ) {
    return "dispatchProfessionalReversalRepair";
  }
  return null;
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
    manifest: HELD_OPERATOR_WORK_QUEUE_HTTP_MANIFEST,
    async dispatch(request) {
      const selected = route(request?.method, request?.pathname);
      if (selected === null) return null;
      await authenticate(request);
      return held();
    }
  });
}
