import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const SUPPORT_CASE_HTTP_ROUTES = deepFreeze([
  { method: "GET", pattern: "/api/v1/support-cases", audience: "customer", operation: "listCustomerCases" },
  { method: "POST", pattern: "/api/v1/support-cases", audience: "customer", operation: "openAuthenticated" },
  { method: "GET", pattern: "/api/v1/support-cases/:caseId", audience: "customer", operation: "readCustomerCase" },
  { method: "GET", pattern: "/api/v1/operator/support-cases", audience: "operator", operation: "listOperatorCases" },
  { method: "GET", pattern: "/api/v1/operator/support-cases/:caseId", audience: "operator", operation: "readOperatorCase" },
  { method: "POST", pattern: "/api/v1/operator/support-cases/:caseId/assignment", audience: "operator", operation: "assign" },
  { method: "POST", pattern: "/api/v1/operator/support-cases/:caseId/identity", audience: "operator", operation: "updateIdentity" },
  { method: "POST", pattern: "/api/v1/operator/support-cases/:caseId/deadline", audience: "operator", operation: "setDeadline" },
  { method: "POST", pattern: "/api/v1/operator/support-cases/:caseId/review", audience: "operator", operation: "startReview" },
  { method: "POST", pattern: "/api/v1/operator/support-cases/:caseId/response", audience: "operator", operation: "respond" },
  { method: "POST", pattern: "/api/v1/operator/support-cases/:caseId/denial", audience: "operator", operation: "deny" },
  { method: "POST", pattern: "/api/v1/operator/support-cases/:caseId/closure", audience: "operator", operation: "close" },
  { method: "POST", pattern: "/api/v1/operator/support-cases/:caseId/evidence", audience: "operator", operation: "addEvidence" },
  { method: "POST", pattern: "/api/v1/operator/support-cases/:caseId/notification-reservation", audience: "operator", operation: "reserveNotification" }
]);

function matchPattern(pattern, pathname) {
  if (!pattern.includes(":caseId")) return pattern === pathname ? {} : null;
  const prefix = pattern.slice(0, pattern.indexOf(":caseId"));
  const suffix = pattern.slice(pattern.indexOf(":caseId") + 7);
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;
  const value = pathname.slice(prefix.length, pathname.length - suffix.length);
  return UUID.test(value) ? { caseId: value } : null;
}

export function matchSupportCaseHttpRoute(method, pathname) {
  if (typeof method !== "string" || typeof pathname !== "string" || pathname.includes("?")) {
    return null;
  }
  for (const route of SUPPORT_CASE_HTTP_ROUTES) {
    if (route.method !== method) continue;
    const params = matchPattern(route.pattern, pathname);
    if (params) return deepFreeze({ ...route, params });
  }
  return null;
}

export function createHeldSupportCaseHttpBoundary() {
  return Object.freeze({
    kind: "support-case-http",
    mode: "held",
    providerEffects: false,
    match: matchSupportCaseHttpRoute,
    async dispatch({ method, pathname, actor } = {}) {
      const route = matchSupportCaseHttpRoute(method, pathname);
      if (!route) return null;
      invariant(
        actor && typeof actor === "object" &&
          UUID.test(actor.userId) && UUID.test(actor.organizationId),
        "AUTHENTICATION_REQUIRED",
        "Sign in to continue.",
        { status: 401 }
      );
      throw new HostedError(
        "SUPPORT_CASES_HELD",
        "The auditable support and privacy case HTTP interface is not open yet.",
        {
          status: 503,
          details: {
            audience: route.audience,
            operation: route.operation,
            providerEffects: false,
            deletionExecution: false,
            exportExecution: false
          }
        }
      );
    }
  });
}
