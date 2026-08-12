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

const OPERATOR_BODY_KEYS = Object.freeze({
  assign: ["assignedOperatorId", "expectedRevision", "operatorOrganizationId"],
  updateIdentity: ["evidenceDigest", "expectedRevision", "identityState", "operatorOrganizationId"],
  setDeadline: ["basisDigest", "expectedRevision", "operatorOrganizationId", "responseDueAt"],
  startReview: ["expectedRevision", "operatorOrganizationId"],
  respond: ["expectedRevision", "operatorOrganizationId", "responseDigest"],
  deny: [
    "appealAvailable", "appealBasisDigest", "appealDueAt",
    "denialExplanationDigest", "denialReasonCode", "expectedRevision",
    "operatorOrganizationId"
  ],
  close: ["closureEvidenceDigest", "closureReasonCode", "expectedRevision", "operatorOrganizationId"],
  addEvidence: ["evidenceDigest", "evidenceKind", "expectedRevision", "operatorOrganizationId"],
  reserveNotification: [
    "contentDigest", "customerUserId", "expectedRevision", "expiresAt",
    "mailCommandId", "notificationKind", "operatorOrganizationId", "projectId",
    "recipientDigest", "subjectReferenceDigest", "templateVersion"
  ]
});

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

function actorId(actor) {
  invariant(
    actor && typeof actor === "object" && UUID.test(actor.userId),
    "AUTHENTICATION_REQUIRED",
    "Sign in to use support and privacy case tools.",
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
    "SUPPORT_CASE_INVALID",
    "The support case request is invalid.",
    { status: 400 }
  );
  return value;
}

function exactQuery(value, keys) {
  invariant(
    value instanceof URLSearchParams &&
      [...value.keys()].length === keys.length &&
      keys.every((key) => value.getAll(key).length === 1),
    "SUPPORT_CASE_INVALID",
    "The support case query is invalid.",
    { status: 400 }
  );
  return Object.fromEntries(keys.map((key) => [key, value.get(key)]));
}

export function createSupportCaseHttpBoundary({ supportCases } = {}) {
  invariant(
    supportCases &&
      SUPPORT_CASE_HTTP_ROUTES.every(
        ({ operation }) => typeof supportCases[operation] === "function"
      ) &&
      supportCases.providerEffects === false,
    "SUPPORT_CASE_CONFIGURATION_REQUIRED",
    "A complete no-provider-effect support case lifecycle is required.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "support-case-http",
    mode: "repository",
    providerEffects: false,
    deletionExecution: false,
    exportExecution: false,
    match: matchSupportCaseHttpRoute,
    async dispatch({ method, pathname, actor, query, body, commandId } = {}) {
      const route = matchSupportCaseHttpRoute(method, pathname);
      if (!route) return null;
      const userId = actorId(actor);
      if (route.operation === "listCustomerCases") {
        const selected = exactQuery(query, ["organizationId"]);
        return Object.freeze({
          status: 200,
          result: await supportCases.listCustomerCases({
            actorId: userId,
            organizationId: selected.organizationId
          })
        });
      }
      if (route.operation === "readCustomerCase") {
        const selected = exactQuery(query, ["organizationId"]);
        return Object.freeze({
          status: 200,
          result: await supportCases.readCustomerCase({
            actorId: userId,
            caseId: route.params.caseId,
            organizationId: selected.organizationId
          })
        });
      }
      if (route.operation === "openAuthenticated") {
        const selected = exactBody(body, [
          "evidenceDigests", "organizationId", "parentCaseId", "projectId",
          "requestKind", "requesterReferenceDigest", "scopeKind"
        ]);
        return Object.freeze({
          status: 201,
          result: await supportCases.openAuthenticated({
            ...selected,
            actorId: userId,
            commandId,
            requesterUserId: userId
          })
        });
      }
      if (route.operation === "listOperatorCases") {
        const selected = exactQuery(query, ["operatorOrganizationId"]);
        return Object.freeze({
          status: 200,
          result: await supportCases.listOperatorCases({
            actorId: userId,
            operatorOrganizationId: selected.operatorOrganizationId
          })
        });
      }
      if (route.operation === "readOperatorCase") {
        const selected = exactQuery(query, ["operatorOrganizationId"]);
        return Object.freeze({
          status: 200,
          result: await supportCases.readOperatorCase({
            actorId: userId,
            caseId: route.params.caseId,
            operatorOrganizationId: selected.operatorOrganizationId
          })
        });
      }
      const selected = exactBody(body, OPERATOR_BODY_KEYS[route.operation]);
      return Object.freeze({
        status: route.operation === "reserveNotification" ? 202 : 200,
        result: await supportCases[route.operation]({
          ...selected,
          actorId: userId,
          caseId: route.params.caseId,
          commandId
        })
      });
    }
  });
}

export function createHeldSupportCaseHttpBoundary() {
  return Object.freeze({
    kind: "support-case-http",
    mode: "held",
    providerEffects: false,
    deletionExecution: false,
    exportExecution: false,
    match: matchSupportCaseHttpRoute,
    async dispatch({ method, pathname, actor } = {}) {
      const route = matchSupportCaseHttpRoute(method, pathname);
      if (!route) return null;
      actorId(actor);
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
