import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";

const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MAX_BODY_BYTES = 16 * 1024;

export const RESPONDER_SURFACE_HTTP_ROUTES = deepFreeze([
  { method: "GET", pattern: "/api/v1/responder", audience: "customer", operation: "readCustomer" },
  { method: "POST", pattern: "/api/v1/responder/contacts", audience: "customer", operation: "recordCustomerConsent" },
  { method: "POST", pattern: "/api/v1/responder/contacts/:contactAuthorityId/stop", audience: "customer", operation: "stop" },
  { method: "POST", pattern: "/api/v1/responder/interactions/:interactionId/handoff", audience: "customer", operation: "requestHandoff" },
  { method: "POST", pattern: "/api/v1/responder/interactions/:interactionId/held-messages", audience: "customer", operation: "reserveHeldMessage" },
  { method: "GET", pattern: "/api/v1/operator/responder/organizations/:organizationId", audience: "operator", operation: "readOperator" },
  { method: "POST", pattern: "/api/v1/operator/responder/organizations/:organizationId/contacts", audience: "operator", operation: "recordOperatorConsent" },
  { method: "POST", pattern: "/api/v1/operator/responder/organizations/:organizationId/contacts/:contactAuthorityId/stop", audience: "operator", operation: "stop" },
  { method: "POST", pattern: "/api/v1/operator/responder/organizations/:organizationId/interactions/:interactionId/handoff", audience: "operator", operation: "requestHandoff" },
  { method: "POST", pattern: "/api/v1/operator/responder/organizations/:organizationId/interactions/:interactionId/held-messages", audience: "operator", operation: "reserveHeldMessage" },
  { method: "POST", pattern: "/api/v1/operator/responder/organizations/:organizationId/global-kill", audience: "operator", operation: "engageGlobalKill" }
]);

const MATCHERS = RESPONDER_SURFACE_HTTP_ROUTES.map((route) => {
  const names = [];
  const source = route.pattern.replace(
    /:([A-Za-z][A-Za-z0-9]*)/gu,
    (_, name) => {
      names.push(name);
      return `(${UUID_SOURCE})`;
    }
  );
  return {
    route,
    names,
    expression: new RegExp(`^${source}$`, "u")
  };
});

export function matchResponderSurfaceHttpRoute(method, pathname) {
  if (
    typeof method !== "string" || typeof pathname !== "string" ||
    pathname.includes("?")
  ) return null;
  for (const { route, names, expression } of MATCHERS) {
    if (method !== route.method) continue;
    const match = expression.exec(pathname);
    if (!match) continue;
    return deepFreeze({
      ...route,
      params: Object.fromEntries(names.map((name, index) => [
        name,
        match[index + 1]
      ]))
    });
  }
  return null;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    }
  });
}

async function body(request) {
  invariant(
    String(request.headers.get("content-type") ?? "")
      .toLowerCase().startsWith("application/json"),
    "RESPONDER_SURFACE_INVALID",
    "Responder commands require JSON.",
    { status: 415 }
  );
  const declared = request.headers.get("content-length");
  invariant(
    declared === null ||
      (/^\d{1,8}$/u.test(declared) && Number(declared) <= MAX_BODY_BYTES),
    "RESPONDER_SURFACE_INVALID",
    "The Responder command body is too large.",
    { status: 413 }
  );
  const text = await request.text();
  invariant(
    Buffer.byteLength(text, "utf8") <= MAX_BODY_BYTES,
    "RESPONDER_SURFACE_INVALID",
    "The Responder command body is too large.",
    { status: 413 }
  );
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  invariant(
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) &&
      Object.getPrototypeOf(parsed) === Object.prototype,
    "RESPONDER_SURFACE_INVALID",
    "The Responder command body is invalid.",
    { status: 400 }
  );
  return parsed;
}

function validate(service, authenticate, requireWriteGuard) {
  invariant(
    service && [
      "engageGlobalKill", "readCustomer", "readOperator",
      "recordCustomerConsent", "recordOperatorConsent", "requestHandoff",
      "reserveHeldMessage", "stop"
    ].every((method) => typeof service[method] === "function") &&
      service.providerEffects === false && service.billingEffects === false &&
      service.sellable === false &&
      typeof authenticate === "function" &&
      typeof requireWriteGuard === "function",
    "RESPONDER_SURFACE_CONFIGURATION_REQUIRED",
    "Responder authentication and held service boundaries are required.",
    { status: 500 }
  );
}

export function createResponderSurfacesHttpBoundary({
  service,
  authenticate,
  requireWriteGuard
} = {}) {
  validate(service, authenticate, requireWriteGuard);
  return Object.freeze({
    kind: "responder-surfaces-http",
    mode: "held",
    providerEffects: false,
    billingEffects: false,
    sellable: false,
    manifest: RESPONDER_SURFACE_HTTP_ROUTES,
    match: matchResponderSurfaceHttpRoute,
    async dispatch(request) {
      let url;
      try {
        url = new URL(request?.url);
      } catch {
        return null;
      }
      if (url.search || url.hash) return null;
      const route = matchResponderSurfaceHttpRoute(request.method, url.pathname);
      if (!route) return null;
      const authenticated = await authenticate(request);
      invariant(
        authenticated !== null && authenticated !== undefined,
        "AUTHENTICATION_REQUIRED",
        "Sign in to continue.",
        { status: 401 }
      );
      if (route.method === "GET") {
        const result = route.operation === "readCustomer"
          ? await service.readCustomer(authenticated)
          : await service.readOperator(
              authenticated,
              route.params.organizationId
            );
        return json(result);
      }
      invariant(
        await requireWriteGuard(request, authenticated) === true,
        "RESPONDER_WRITE_GUARD_REQUIRED",
        "Responder write safety could not be verified.",
        { status: 403 }
      );
      const idempotencyKey = request.headers.get("idempotency-key");
      invariant(
        typeof idempotencyKey === "string" && idempotencyKey.length > 0,
        "IDEMPOTENCY_KEY_REQUIRED",
        "An idempotency key is required.",
        { status: 400 }
      );
      const input = {
        organizationId:
          route.params.organizationId ?? authenticated.organizationId,
        commandId: idempotencyKey,
        body: await body(request)
      };
      let result;
      switch (route.operation) {
        case "recordCustomerConsent":
          result = await service.recordCustomerConsent(authenticated, input);
          break;
        case "recordOperatorConsent":
          result = await service.recordOperatorConsent(authenticated, input);
          break;
        case "stop":
          result = await service.stop(
            authenticated,
            route.audience,
            route.params.contactAuthorityId,
            input
          );
          break;
        case "requestHandoff":
          result = await service.requestHandoff(
            authenticated,
            route.audience,
            route.params.interactionId,
            input
          );
          break;
        case "reserveHeldMessage":
          result = await service.reserveHeldMessage(
            authenticated,
            route.audience,
            route.params.interactionId,
            input
          );
          break;
        case "engageGlobalKill":
          result = await service.engageGlobalKill(authenticated, input);
          break;
        default:
          return null;
      }
      return json(result, 200);
    }
  });
}
