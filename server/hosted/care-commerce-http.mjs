import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";

const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MAX_BODY_BYTES = 16 * 1024;

const CUSTOMER_BASE =
  "/api/v1/care/projects/:projectId/contracts/:contractId/periods/:periodId/commerce";
const OPERATOR_BASE =
  "/api/v1/operator/care/organizations/:organizationId/projects/:projectId/contracts/:contractId/periods/:periodId/commerce";

export const CARE_COMMERCE_HTTP_ROUTES = deepFreeze([
  {
    method: "GET",
    pattern: `${CUSTOMER_BASE}/catalog`,
    audience: "customer",
    operation: "readCustomerCatalog"
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
    operation: "reserveHeldInvoice"
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

const MATCHERS = CARE_COMMERCE_HTTP_ROUTES.map((route) => {
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

export function matchCareCommerceHttpRoute(method, pathname) {
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
    "CARE_COMMERCE_INVALID",
    "The Care commerce command body is invalid.",
    { status: 400 }
  );
  return value;
}

async function body(request, keys) {
  invariant(
    String(request.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("application/json"),
    "CARE_COMMERCE_INVALID",
    "Care commerce commands require JSON.",
    { status: 415 }
  );
  const declared = request.headers.get("content-length");
  invariant(
    declared === null ||
      (/^\d{1,8}$/u.test(declared) && Number(declared) <= MAX_BODY_BYTES),
    "CARE_COMMERCE_INVALID",
    "The Care commerce command body is too large.",
    { status: 413 }
  );
  const text = await request.text();
  invariant(
    Buffer.byteLength(text, "utf8") <= MAX_BODY_BYTES,
    "CARE_COMMERCE_INVALID",
    "The Care commerce command body is too large.",
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
    "readCustomerCatalog",
    "readCustomerReservation",
    "readOperatorCatalog",
    "requestReversal",
    "reserveHeldInvoice"
  ];
  invariant(
    service?.kind === "care-commerce" &&
      service.mode === "held-local" &&
      service.commercialEffects === false &&
      service.customerEffects === false &&
      service.mailDeliveryEffects === false &&
      service.paymentEffects === false &&
      service.providerEffects === false &&
      typeof service.readiness === "function" &&
      methods.every((method) => typeof service[method] === "function"),
    "CARE_COMMERCE_CONFIGURATION_REQUIRED",
    "The verified held Care commerce service is required.",
    { status: 500 }
  );
  invariant(
    typeof authenticate === "function" &&
      typeof requireWriteGuard === "function",
    "CARE_COMMERCE_CONFIGURATION_REQUIRED",
    "Care commerce authentication and write safety are required.",
    { status: 500 }
  );
}

function scope(route) {
  return {
    ...(route.audience === "operator"
      ? { organizationId: route.params.organizationId }
      : {}),
    projectId: route.params.projectId,
    contractId: route.params.contractId,
    periodId: route.params.periodId
  };
}

export function createCareCommerceHttpBoundary({
  service,
  authenticate,
  requireWriteGuard
} = {}) {
  validate(service, authenticate, requireWriteGuard);
  return Object.freeze({
    kind: "care-commerce-http",
    mode: "held-local",
    commercialEffects: false,
    customerEffects: false,
    mailDeliveryEffects: false,
    paymentEffects: false,
    providerEffects: false,
    manifest: CARE_COMMERCE_HTTP_ROUTES,
    match: matchCareCommerceHttpRoute,
    async dispatch(request) {
      let url;
      try {
        url = new URL(request?.url);
      } catch {
        return null;
      }
      if (url.search || url.hash) return null;
      const route = matchCareCommerceHttpRoute(
        request.method,
        url.pathname
      );
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
        const result = route.operation === "readCustomerReservation"
          ? await service.readCustomerReservation(authenticated, {
              ...selectedScope,
              reservationId: route.params.reservationId
            })
          : await service[route.operation](authenticated, selectedScope);
        return json(result);
      }

      const guarded = await requireWriteGuard(request, authenticated);
      invariant(
        guarded === true,
        "CARE_COMMERCE_WRITE_GUARD_REQUIRED",
        "Care commerce write safety could not be verified.",
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
        case "createHeldQuote": {
          const payload = await body(request, ["priceSelection", "serviceKey"]);
          input = { ...selectedScope, commandId, ...payload };
          break;
        }
        case "reserveHeldInvoice": {
          const payload = await body(request, [
            "acceptedQuoteDigest",
            "quoteId"
          ]);
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
      return json(
        await service[route.operation](authenticated, input),
        201
      );
    }
  });
}
