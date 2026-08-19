import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";

const PATH = "/api/v1/operator/mail-purpose-reservations";
const BODY_KEYS = Object.freeze([
  "contentDigest",
  "expiresAt",
  "notificationKind",
  "operatorOrganizationId",
  "purposeKind",
  "recipientDigest",
  "source",
  "subjectReferenceDigest",
  "templateVersion"
]);

export const MAIL_PURPOSE_NOTIFICATION_HTTP_ROUTES = deepFreeze([
  Object.freeze({
    method: "POST",
    path: PATH,
    audience: "operator",
    operation: "reserveOperator"
  })
]);

function exactBody(value) {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...BODY_KEYS].sort()),
    "MAIL_PURPOSE_NOTIFICATION_INVALID",
    "Mail-purpose notification request body is invalid.",
    { status: 400 }
  );
  return value;
}

export function matchMailPurposeNotificationHttpRoute(method, pathname) {
  return method === "POST" && pathname === PATH
    ? deepFreeze({ operation: "reserveOperator", params: {} })
    : null;
}

export function createMailPurposeNotificationHttpBoundary({ service } = {}) {
  invariant(
    service && typeof service.reserveOperator === "function" &&
      service.providerEffects === false && service.deliveryClaimed === false,
    "MAIL_PURPOSE_NOTIFICATION_CONFIGURATION_REQUIRED",
    "An effect-held mail-purpose notification service is required.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "mail-purpose-notifications-http",
    mode: service.mode,
    providerEffects: false,
    deliveryClaimed: false,
    manifest: MAIL_PURPOSE_NOTIFICATION_HTTP_ROUTES,
    match: matchMailPurposeNotificationHttpRoute,
    async dispatch({ method, pathname, actor, body, commandId } = {}) {
      const route = matchMailPurposeNotificationHttpRoute(method, pathname);
      if (route === null) return null;
      invariant(
        actor && typeof actor.userId === "string",
        "AUTHENTICATION_REQUIRED",
        "Sign in to reserve a mail-purpose notification.",
        { status: 401 }
      );
      invariant(
        typeof commandId === "string" && commandId.length > 0,
        "IDEMPOTENCY_KEY_REQUIRED",
        "An idempotency key is required.",
        { status: 400 }
      );
      const result = await service.reserveOperator({
        ...exactBody(body),
        actorId: actor.userId,
        commandId
      });
      return Object.freeze({ status: 201, result });
    }
  });
}
