import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";

const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MAX_BODY_BYTES = 32 * 1024;

export const CARE_SURFACE_HTTP_ROUTES = deepFreeze([
  { method: "GET", pattern: "/api/v1/care", audience: "customer", operation: "readCustomer" },
  { method: "POST", pattern: "/api/v1/care/tickets", audience: "customer", operation: "requestCustomerTicket" },
  { method: "GET", pattern: "/api/v1/operator/care/organizations/:organizationId", audience: "operator", operation: "readOperator" },
  { method: "POST", pattern: "/api/v1/operator/care/organizations/:organizationId/periods", audience: "operator", operation: "openPeriod" },
  { method: "POST", pattern: "/api/v1/operator/care/organizations/:organizationId/periods/:periodId/closure", audience: "operator", operation: "closePeriod" },
  { method: "POST", pattern: "/api/v1/operator/care/organizations/:organizationId/tickets", audience: "operator", operation: "openTicket" },
  { method: "POST", pattern: "/api/v1/operator/care/organizations/:organizationId/tickets/:ticketId/transitions", audience: "operator", operation: "transitionTicket" },
  { method: "POST", pattern: "/api/v1/operator/care/organizations/:organizationId/periods/:periodId/capacity", audience: "operator", operation: "allocateCapacity" },
  { method: "POST", pattern: "/api/v1/operator/care/organizations/:organizationId/tickets/:ticketId/mail-reservations", audience: "operator", operation: "reserveTicketMail" }
]);

const MATCHERS = CARE_SURFACE_HTTP_ROUTES.map((route) => {
  const names = [];
  const source = route.pattern.replace(/:([A-Za-z][A-Za-z0-9]*)/gu, (_, name) => {
    names.push(name);
    return `(${UUID_SOURCE})`;
  });
  return { route, names, expression: new RegExp(`^${source}$`, "u") };
});

export function matchCareSurfaceHttpRoute(method, pathname) {
  if (
    typeof method !== "string" ||
    typeof pathname !== "string" ||
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
    "CARE_SURFACE_INVALID",
    "Care commands require JSON.",
    { status: 415 }
  );
  const declared = request.headers.get("content-length");
  invariant(
    declared === null ||
      (/^\d{1,8}$/u.test(declared) && Number(declared) <= MAX_BODY_BYTES),
    "CARE_SURFACE_INVALID",
    "The Care command body is too large.",
    { status: 413 }
  );
  const text = await request.text();
  invariant(
    Buffer.byteLength(text, "utf8") <= MAX_BODY_BYTES,
    "CARE_SURFACE_INVALID",
    "The Care command body is too large.",
    { status: 413 }
  );
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  invariant(
    parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.getPrototypeOf(parsed) === Object.prototype,
    "CARE_SURFACE_INVALID",
    "The Care command body is invalid.",
    { status: 400 }
  );
  return parsed;
}

function validate(service, authenticate, requireWriteGuard) {
  const methods = [
    "allocateCapacity", "closePeriod", "openPeriod", "openTicket",
    "readCustomer", "readOperator", "requestCustomerTicket",
    "reserveTicketMail", "transitionTicket"
  ];
  invariant(
    service && methods.every((method) => typeof service[method] === "function"),
    "CARE_SURFACE_CONFIGURATION_REQUIRED",
    "The Care surface service is required.",
    { status: 500 }
  );
  invariant(
    typeof authenticate === "function" && typeof requireWriteGuard === "function",
    "CARE_SURFACE_CONFIGURATION_REQUIRED",
    "Care authentication and write-safety boundaries are required.",
    { status: 500 }
  );
}

export function createCareSurfacesHttpBoundary({
  service,
  authenticate,
  requireWriteGuard
} = {}) {
  validate(service, authenticate, requireWriteGuard);
  return Object.freeze({
    kind: "care-surfaces-http",
    mode: "held-local",
    customerEffects: false,
    mailDeliveryEffects: false,
    paymentEffects: false,
    providerEffects: false,
    manifest: CARE_SURFACE_HTTP_ROUTES,
    match: matchCareSurfaceHttpRoute,
    async dispatch(request) {
      let url;
      try {
        url = new URL(request?.url);
      } catch {
        return null;
      }
      if (url.search || url.hash) return null;
      const route = matchCareSurfaceHttpRoute(request.method, url.pathname);
      if (!route) return null;
      const actor = await authenticate(request, route);
      invariant(
        actor !== null && actor !== undefined,
        "AUTHENTICATION_REQUIRED",
        "Sign in to continue.",
        { status: 401 }
      );
      if (route.method === "GET") {
        const result = route.operation === "readCustomer"
          ? await service.readCustomer(actor)
          : await service.readOperator(actor, route.params.organizationId);
        return json(result);
      }

      const guard = await requireWriteGuard(request, actor);
      invariant(
        guard === true,
        "CARE_WRITE_GUARD_REQUIRED",
        "Care write safety could not be verified.",
        { status: 403 }
      );
      const commandId = request.headers.get("idempotency-key");
      invariant(
        typeof commandId === "string" && commandId.length > 0,
        "IDEMPOTENCY_KEY_REQUIRED",
        "An idempotency key is required.",
        { status: 400 }
      );
      const input = {
        organizationId: route.params.organizationId ?? actor.organizationId,
        commandId,
        body: await body(request)
      };
      let result;
      switch (route.operation) {
        case "requestCustomerTicket":
          result = await service.requestCustomerTicket(actor, input);
          break;
        case "openPeriod":
          result = await service.openPeriod(actor, input);
          break;
        case "closePeriod":
          result = await service.closePeriod(actor, route.params.periodId, input);
          break;
        case "openTicket":
          result = await service.openTicket(actor, input);
          break;
        case "transitionTicket":
          result = await service.transitionTicket(
            actor,
            route.params.ticketId,
            input
          );
          break;
        case "allocateCapacity":
          result = await service.allocateCapacity(
            actor,
            route.params.periodId,
            input
          );
          break;
        case "reserveTicketMail":
          result = await service.reserveTicketMail(
            actor,
            route.params.ticketId,
            input
          );
          break;
        default:
          return null;
      }
      return json(result, 201);
    }
  });
}
