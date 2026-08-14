import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";

const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MAX_BODY_BYTES = 16 * 1024;

const CUSTOMER_BASE = "/api/v1/responder/projects/:projectId/commerce";
const OPERATOR_BASE =
  "/api/v1/operator/responder/organizations/:organizationId/projects/:projectId/customers/:customerUserId/commerce";

export const RESPONDER_COMMERCE_HTTP_ROUTES = deepFreeze([
  {
    method: "GET",
    pattern: `${CUSTOMER_BASE}/quotes/:quoteId`,
    audience: "customer",
    operation: "readCustomerQuote"
  },
  {
    method: "GET",
    pattern: `${CUSTOMER_BASE}/reservations/:reservationId`,
    audience: "customer",
    operation: "readCustomerReservation"
  },
  {
    method: "GET",
    pattern: `${OPERATOR_BASE}/catalog`,
    audience: "operator",
    operation: "readOperatorCatalog"
  },
  {
    method: "POST",
    pattern: `${OPERATOR_BASE}/quotes`,
    audience: "operator",
    operation: "createHeldQuote"
  },
  {
    method: "POST",
    pattern: `${OPERATOR_BASE}/reservations`,
    audience: "operator",
    operation: "reserveHeldBilling"
  },
  {
    method: "POST",
    pattern: `${OPERATOR_BASE}/reservations/:reservationId/cancellation`,
    audience: "operator",
    operation: "cancelHeldReservation"
  },
  {
    method: "POST",
    pattern: `${OPERATOR_BASE}/reservations/:reservationId/ambiguity`,
    audience: "operator",
    operation: "markReservationAmbiguous"
  },
  {
    method: "POST",
    pattern: `${OPERATOR_BASE}/reservations/:reservationId/reversal`,
    audience: "operator",
    operation: "requestReversal"
  }
]);

const MATCHERS = RESPONDER_COMMERCE_HTTP_ROUTES.map((route) => {
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

export function matchResponderCommerceHttpRoute(method, pathname) {
  if (
    typeof method !== "string" ||
    typeof pathname !== "string" ||
    pathname.includes("?")
  ) {
    return null;
  }
  for (const { route, names, expression } of MATCHERS) {
    if (method !== route.method) continue;
    const match = expression.exec(pathname);
    if (!match) continue;
    return deepFreeze({
      ...route,
      params: Object.fromEntries(
        names.map((name, index) => [name, match[index + 1]])
      )
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

function exactObject(value, keys) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...keys].sort()),
    "RESPONDER_COMMERCE_INVALID",
    "The Responder commerce command body is invalid.",
    { status: 400 }
  );
  return value;
}

async function body(request, keys) {
  invariant(
    String(request.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("application/json"),
    "RESPONDER_COMMERCE_INVALID",
    "Responder commerce commands require JSON.",
    { status: 415 }
  );
  const declared = request.headers.get("content-length");
  invariant(
    declared === null ||
      (/^\d{1,8}$/u.test(declared) && Number(declared) <= MAX_BODY_BYTES),
    "RESPONDER_COMMERCE_INVALID",
    "The Responder commerce command body is too large.",
    { status: 413 }
  );
  const text = await request.text();
  invariant(
    Buffer.byteLength(text, "utf8") <= MAX_BODY_BYTES,
    "RESPONDER_COMMERCE_INVALID",
    "The Responder commerce command body is too large.",
    { status: 413 }
  );
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return exactObject(parsed, keys);
}

function validate(service, authenticate, requireWriteGuard) {
  const methods = [
    "cancelHeldReservation",
    "createHeldQuote",
    "markReservationAmbiguous",
    "readCustomerQuote",
    "readCustomerReservation",
    "readOperatorCatalog",
    "requestReversal",
    "reserveHeldBilling"
  ];
  invariant(
    service?.kind === "responder-commerce" &&
      service.mode === "held-local" &&
      service.commercialEffects === false &&
      service.customerEffects === false &&
      service.mailDeliveryEffects === false &&
      service.paymentEffects === false &&
      service.providerEffects === false &&
      typeof service.readiness === "function" &&
      methods.every((method) => typeof service[method] === "function"),
    "RESPONDER_COMMERCE_CONFIGURATION_REQUIRED",
    "The verified held Responder commerce service is required.",
    { status: 500 }
  );
  invariant(
    typeof authenticate === "function" &&
      typeof requireWriteGuard === "function",
    "RESPONDER_COMMERCE_CONFIGURATION_REQUIRED",
    "Responder commerce authentication and write safety are required.",
    { status: 500 }
  );
}

function scope(route) {
  return {
    ...(route.audience === "operator"
      ? {
          customerUserId: route.params.customerUserId,
          organizationId: route.params.organizationId
        }
      : {}),
    projectId: route.params.projectId
  };
}

export function createResponderCommerceHttpBoundary({
  service,
  authenticate,
  requireWriteGuard
} = {}) {
  validate(service, authenticate, requireWriteGuard);
  return Object.freeze({
    kind: "responder-commerce-http",
    mode: "held-local",
    commercialEffects: false,
    customerEffects: false,
    mailDeliveryEffects: false,
    paymentEffects: false,
    providerEffects: false,
    manifest: RESPONDER_COMMERCE_HTTP_ROUTES,
    match: matchResponderCommerceHttpRoute,
    async dispatch(request) {
      let url;
      try {
        url = new URL(request?.url);
      } catch {
        return null;
      }
      if (url.search || url.hash) return null;
      const route = matchResponderCommerceHttpRoute(request.method, url.pathname);
      if (!route) return null;
      const authenticated = await authenticate(request, route);
      invariant(
        authenticated !== null && authenticated !== undefined,
        "AUTHENTICATION_REQUIRED",
        "Sign in to continue.",
        { status: 401 }
      );
      const selectedScope = scope(route);
      if (route.method === "GET") {
        const result = route.operation === "readOperatorCatalog"
          ? await service.readOperatorCatalog(authenticated, selectedScope)
          : await service[route.operation](authenticated, {
              ...selectedScope,
              ...(route.params.quoteId ? { quoteId: route.params.quoteId } : {}),
              ...(route.params.reservationId
                ? { reservationId: route.params.reservationId }
                : {})
            });
        return json(result);
      }

      const guarded = await requireWriteGuard(request, authenticated);
      invariant(
        guarded === true,
        "RESPONDER_COMMERCE_WRITE_GUARD_REQUIRED",
        "Responder commerce write safety could not be verified.",
        { status: 403 }
      );
      const commandId = request.headers.get("idempotency-key");
      invariant(
        typeof commandId === "string" && commandId.length > 0,
        "IDEMPOTENCY_KEY_REQUIRED",
        "An idempotency key is required.",
        { status: 400 }
      );

      let input;
      switch (route.operation) {
        case "createHeldQuote":
          await body(request, []);
          input = { ...selectedScope, commandId };
          break;
        case "reserveHeldBilling": {
          const payload = await body(request, ["acceptedQuoteDigest", "quoteId"]);
          input = { ...selectedScope, commandId, ...payload };
          break;
        }
        case "cancelHeldReservation": {
          const payload = await body(request, [
            "cancellationEvidenceDigest",
            "expectedRevision"
          ]);
          input = {
            ...selectedScope,
            reservationId: route.params.reservationId,
            commandId,
            ...payload
          };
          break;
        }
        case "markReservationAmbiguous": {
          const payload = await body(request, [
            "ambiguityEvidenceDigest",
            "expectedRevision"
          ]);
          input = {
            ...selectedScope,
            reservationId: route.params.reservationId,
            commandId,
            ...payload
          };
          break;
        }
        case "requestReversal":
          await body(request, []);
          input = {
            ...selectedScope,
            reservationId: route.params.reservationId
          };
          break;
        default:
          return null;
      }
      return json(await service[route.operation](authenticated, input), 201);
    }
  });
}
