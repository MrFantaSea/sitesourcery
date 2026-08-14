import { createHash } from "node:crypto";

import { WRITE_METHODS } from "./constants.mjs";
import {
  createCapabilitiesSnapshot
} from "./capabilities-snapshot.mjs";
import { HostedError, invariant, publicError } from "./errors.mjs";
import {
  DEFAULT_INGRESS_POLICY,
  validateIngressPolicy
} from "./ingress-policy.mjs";
import {
  createReadinessSnapshot
} from "./readiness-snapshot.mjs";
import { digest, randomToken } from "./security.mjs";
import {
  createHeldHostedAlakazamAccount
} from "../commerce-v2/hosted-alakazam-account.mjs";
import {
  createHeldHostedAlakazam35
} from "../commerce-v2/hosted-alakazam-35.mjs";
import {
  createHeldHostedAlakazam50
} from "../commerce-v2/hosted-alakazam-50.mjs";
import {
  createHeldHostedAlakazamRetainedPremium
} from "../commerce-v2/hosted-alakazam-retained-premium.mjs";
import {
  createHeldHostedAlakazamBilling
} from "../commerce-v2/hosted-alakazam-billing.mjs";
import {
  createHeldHostedAlakazamPublication
} from "../commerce-v2/hosted-alakazam-publication.mjs";
import {
  createHeldHostedAlakazamBillingSurfaces,
  matchAlakazamBillingSurfaceRoute,
  readAlakazamBillingSurface
} from "./alakazam-billing.mjs";
import {
  createHeldHostedDownloadCommerce
} from "../commerce-v2/hosted-download.mjs";
import {
  createHeldHostedCustomServicesAccount,
  createHostedCustomServicesCustomBuildHandoffOwner
} from "./custom-services-account-hosted.mjs";
import {
  createHeldCustomServicesOwner
} from "./custom-services-owner-postgres.mjs";
import {
  createHeldHostedEngagementBootstrap,
  ENGAGEMENT_HTTP_ROUTES
} from "./engagement-bootstrap.mjs";
import {
  createHeldCustomServicesAssessmentWork
} from "./custom-services-assessment-work-postgres.mjs";
import {
  createHeldCustomServicesCustomBuild
} from "./custom-services-custom-build-postgres.mjs";
import {
  createHeldCustomServicesCustomBuildWork
} from "./custom-services-custom-build-work-postgres.mjs";
import {
  createHeldCustomServicesCustomBuildProgress
} from "./custom-services-custom-build-progress-postgres.mjs";
import {
  createHeldCustomServicesCustomBuildChangeCompletion
} from "./custom-services-custom-build-change-completion-postgres.mjs";
import {
  createHeldCustomServicesCustomBuildChangePayment
} from "./custom-services-custom-build-change-payment-postgres.mjs";
import {
  createHeldCustomServicesCustomBuildFinalPayment
} from "./custom-services-custom-build-final-payment-postgres.mjs";
import {
  createHeldCustomServicesCustomBuildHandoff
} from "./custom-services-custom-build-handoff-postgres.mjs";
import {
  createHeldOperatorWorkQueueHttp,
  createOperatorWorkQueueHttpBoundary
} from "./operator-work-queue-http.mjs";
import {
  createAdjacentIntegrationHttpBoundary
} from "./adjacent-integration-http.mjs";
import {
  createHeldProviderReconciliationOperatorHttp,
  createProviderReconciliationOperatorHttpBoundary
} from "./provider-reconciliation-operator-http.mjs";
import {
  createHeldSupportCaseHttpBoundary,
  createSupportCaseHttpBoundary
} from "./support-cases-http.mjs";
import {
  createHeldResendMailEventHttpAdapter,
  RESEND_MAIL_EVENT_MAXIMUM_BYTES,
  RESEND_MAIL_EVENT_PATH
} from "./resend-mail-events-http.mjs";
import {
  createHeldTwilioResponderEventsHttpAdapter,
  TWILIO_RESPONDER_EVENT_MAXIMUM_BYTES,
  TWILIO_RESPONDER_EVENT_PATH
} from "./twilio-responder-events-http.mjs";
import {
  createHeldTwilioResponderInboundHttpAdapter,
  TWILIO_RESPONDER_INBOUND_DIAL_RESULT_TWIML,
  TWILIO_RESPONDER_INBOUND_DIAL_RESULT_PATH,
  TWILIO_RESPONDER_INBOUND_MAXIMUM_BYTES,
  TWILIO_RESPONDER_INBOUND_MESSAGE_PATH,
  TWILIO_RESPONDER_INBOUND_MESSAGE_TWIML,
  TWILIO_RESPONDER_INBOUND_VOICE_PATH,
  TWILIO_RESPONDER_INBOUND_VOICE_TWIML
} from "./twilio-responder-inbound-http.mjs";
import {
  isExactTwilioResponderVoiceTwiML
} from "./twilio-responder-voice-dial-plan.mjs";
import {
  createResponderNumberBindingsHttpBoundary
} from "./responder-number-bindings-http.mjs";
import {
  createCareSurfacesHttpBoundary
} from "./care-surfaces-http.mjs";
import {
  createCareCommerceHttpBoundary
} from "./care-commerce-http.mjs";
import {
  createResponderSurfacesHttpBoundary
} from "./responder-surfaces-http.mjs";
import { digestUserAgent } from "./project-legal-authority.mjs";

const JSON_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
});
const MAXIMUM_PRIVATE_EVIDENCE_BYTES = 700 * 1024;
const HOSTED_RUNTIME_SERVICE =
  "sitesourcery-hosted-runtime";
const HOSTED_LIVENESS_SCHEMA =
  "sitesourcery.hosted-liveness/v1";
const HOSTED_READINESS_SCHEMA =
  "sitesourcery.hosted-readiness/v1";
const HOSTED_RELEASE_IDENTITY_SCHEMA =
  "sitesourcery.hosted-release-identity/v2";
const SESSIONLESS_IDENTITY_WRITES = new Set([
  "/api/v1/auth/register",
  "/api/v1/auth/register/complete",
  "/api/v1/auth/engagement-claim",
  "/api/v1/auth/sessions",
  "/api/v1/auth/recovery",
  "/api/v1/auth/recovery/complete"
]);
const HOSTED_OPERATIONS_STATE_SCHEMA =
  "sitesourcery.hosted-operations-state/v1";
const HOSTED_OPERATIONS_STATE_VALUES =
  Object.freeze({
    stripeMode: new Set([
      "held",
      "approved_live"
    ]),
    registrationMailMode: new Set([
      "held",
      "production"
    ]),
    recoveryMailMode: new Set([
      "held",
      "production"
    ]),
    publication: new Set(["held", "approved"]),
    domainRuntime: new Set([
      "held",
      "approved_live"
    ]),
    dns: new Set(["held", "approved_live"])
  });

function runtimeReleaseIdentity(input) {
  if (input === null || input === undefined) {
    return Object.freeze({
      schema: HOSTED_RELEASE_IDENTITY_SCHEMA,
      state: "unbound",
      epochId: null,
      bindingSha256: null,
      candidateCommitSha: null,
      candidateTreeSha: null,
      migrationCount: null,
      latestMigration: null
    });
  }
  invariant(
    input &&
      typeof input === "object" &&
      JSON.stringify(
        Object.keys(input).sort()
      ) === JSON.stringify([
        "bindingSha256",
        "candidateCommitSha",
        "candidateTreeSha",
        "epochId",
        "latestMigration",
        "migrationCount",
        "schema",
        "state"
      ]) &&
      input.schema ===
        HOSTED_RELEASE_IDENTITY_SCHEMA &&
      input.state === "verified_held" &&
      /^[A-Za-z0-9._:-]{1,128}$/u.test(
        input.epochId
      ) &&
      /^[a-f0-9]{64}$/u.test(
        input.bindingSha256
      ) &&
      /^[a-f0-9]{40}$/u.test(
        input.candidateCommitSha
      ) &&
      /^[a-f0-9]{40}$/u.test(
        input.candidateTreeSha
      ) &&
      Number.isSafeInteger(input.migrationCount) &&
      input.migrationCount > 0 &&
      typeof input.latestMigration === "string" &&
      /^[0-9]{12}_[a-z0-9_]+\.sql$/u.test(
        input.latestMigration
      ),
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted release identity is invalid.",
    { status: 500 }
  );
  return Object.freeze({
    schema: HOSTED_RELEASE_IDENTITY_SCHEMA,
    state: "verified_held",
    epochId: input.epochId,
    bindingSha256: input.bindingSha256,
    candidateCommitSha: input.candidateCommitSha,
    candidateTreeSha: input.candidateTreeSha,
    migrationCount: input.migrationCount,
    latestMigration: input.latestMigration
  });
}

function operationsStateProjection(readiness) {
  const domains =
    readiness?.providers?.domains ?? {};
  const state = {
    stripeMode: readiness?.payments?.mode,
    registrationMailMode:
      readiness?.registration?.mode,
    recoveryMailMode:
      readiness?.recovery?.mode,
    publication:
      readiness?.publication?.held === true
        ? "held"
        : readiness?.publication?.held === false
          ? "approved"
          : null,
    domainRuntime: domains.mode,
    dns:
      domains.dns === "ready"
        ? "approved_live"
        : domains.dns
  };
  invariant(
    Object.entries(
      HOSTED_OPERATIONS_STATE_VALUES
    ).every(([field, values]) =>
      values.has(state[field])
    ),
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted operations state is incomplete or invalid.",
    { status: 500 }
  );
  return Object.freeze(state);
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...headers }
  });
}

function rootedResponse(response, requestId) {
  const headers = new Headers(JSON_HEADERS);
  for (const [name, value] of response.headers) {
    headers.set(name, value);
  }
  headers.set("X-Request-Id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function privateEvidence(payload, requestId) {
  const bytes = Buffer.from(payload?.bytes ?? []);
  invariant(
    payload &&
      payload.bytes instanceof Uint8Array &&
      ["image/jpeg", "image/png", "image/webp"].includes(
        payload.mediaType
      ) &&
      /^[a-f0-9]{64}$/u.test(payload.contentDigest) &&
      Number.isSafeInteger(Number(payload.byteCount)) &&
      bytes.byteLength >= 1 &&
      bytes.byteLength <= MAXIMUM_PRIVATE_EVIDENCE_BYTES &&
      Number(payload.byteCount) === bytes.byteLength &&
      createHash("sha256").update(bytes).digest("hex") ===
        payload.contentDigest,
    "RUNTIME_CONFIGURATION_ERROR",
    "Assessment evidence response is invalid.",
    { status: 500 }
  );
  return new Response(bytes, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(payload.byteCount),
      "Content-Type": payload.mediaType,
      "Digest":
        `sha-256=${Buffer.from(payload.contentDigest, "hex").toString("base64")}`,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId
    }
  });
}

function publicAuthenticationResult(value) {
  const safe = { ...(value ?? {}) };
  delete safe.sessionToken;
  delete safe.session;
  return safe;
}

function parseCookies(header) {
  const cookies = {};
  for (const pair of String(header ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!key || Object.hasOwn(cookies, key)) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      // Invalid cookies are treated as absent.
    }
  }
  return cookies;
}

function sessionCookie(token) {
  return [
    `ss_session=${encodeURIComponent(token)}`,
    "Path=/api/v1",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=2592000"
  ].join("; ");
}

function clearSessionCookie() {
  return [
    "ss_session=",
    "Path=/api/v1",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0"
  ].join("; ");
}

function csrfCookie(token) {
  return [
    `ss_csrf=${encodeURIComponent(token)}`,
    "Path=/api/v1",
    "Secure",
    "SameSite=Strict",
    "Max-Age=3600"
  ].join("; ");
}

function currentCsrfToken(cookies, nextCsrfToken) {
  const existing = cookies.ss_csrf;
  if (
    typeof existing === "string" &&
    existing.length >= 32 &&
    existing.length <= 256
  ) {
    return existing;
  }
  return nextCsrfToken();
}

function declaredBodyLength(request, maximumBytes) {
  const header = request.headers.get("content-length");
  if (header === null) return null;
  invariant(
    /^(?:0|[1-9][0-9]*)$/u.test(header),
    "INVALID_CONTENT_LENGTH",
    "Content-Length is invalid.",
    { status: 400 }
  );
  const contentLength = Number(header);
  invariant(
    Number.isSafeInteger(contentLength) && contentLength <= maximumBytes,
    "REQUEST_TOO_LARGE",
    "Request body is too large.",
    { status: 413 }
  );
  return contentLength;
}

function requestDeadlineError() {
  return new HostedError(
    "REQUEST_DEADLINE_EXCEEDED",
    "The request took too long. Retry with the same idempotency key.",
    { status: 504 }
  );
}

async function readBoundedBytes(request, maximumBytes) {
  declaredBodyLength(request, maximumBytes);
  if (request.signal.aborted) throw requestDeadlineError();
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks = [];
  let byteCount = 0;
  try {
    while (true) {
      let item;
      try {
        item = await reader.read();
      } catch (error) {
        if (request.signal.aborted) throw requestDeadlineError();
        throw error;
      }
      if (item.done) break;
      const chunk = Buffer.from(item.value);
      byteCount += chunk.byteLength;
      if (byteCount > maximumBytes) {
        await reader.cancel("request body limit exceeded").catch(() => {});
        throw new HostedError(
          "REQUEST_TOO_LARGE",
          "Request body is too large.",
          { status: 413 }
        );
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  if (request.signal.aborted) throw requestDeadlineError();
  return Buffer.concat(chunks, byteCount);
}

async function readJson(request, maximumBytes) {
  const bytes = await readBoundedBytes(request, maximumBytes);
  const text = bytes.toString("utf8");
  invariant(
    bytes.byteLength <= maximumBytes,
    "REQUEST_TOO_LARGE",
    "Request body is too large.",
    { status: 413 }
  );
  if (!text) return {};
  invariant(
    String(request.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("application/json"),
    "UNSUPPORTED_MEDIA_TYPE",
    "JSON is required.",
    { status: 415 }
  );
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HostedError("INVALID_JSON", "Request body is invalid JSON.", { status: 400 });
  }
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "INVALID_JSON",
    "Request body must be a JSON object.",
    { status: 400 }
  );
  return value;
}

async function readRawWebhook(request, maximumBytes) {
  invariant(
    String(
      request.headers.get("content-type") ?? ""
    )
      .toLowerCase()
      .startsWith("application/json"),
    "UNSUPPORTED_MEDIA_TYPE",
    "Stripe webhook JSON is required.",
    { status: 415 }
  );
  const bytes = await readBoundedBytes(request, maximumBytes);
  invariant(
    bytes.byteLength > 0 &&
      bytes.byteLength <= maximumBytes,
    bytes.byteLength === 0
      ? "STRIPE_WEBHOOK_BODY_REQUIRED"
      : "REQUEST_TOO_LARGE",
    bytes.byteLength === 0
      ? "Stripe webhook body is required."
      : "Request body is too large.",
    { status: bytes.byteLength === 0 ? 400 : 413 }
  );
  return bytes;
}

async function readRawResendWebhook(request, maximumBytes) {
  invariant(
    /^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(
      String(request.headers.get("content-type") ?? "").trim()
    ),
    "UNSUPPORTED_MEDIA_TYPE",
    "Resend webhook JSON is required.",
    { status: 415 }
  );
  const declared = declaredBodyLength(request, maximumBytes);
  const bytes = await readBoundedBytes(request, maximumBytes);
  invariant(
    bytes.byteLength > 0 &&
      bytes.byteLength <= maximumBytes &&
      (declared === null || declared === bytes.byteLength),
    bytes.byteLength === 0
      ? "RESEND_WEBHOOK_BODY_REQUIRED"
      : declared !== null && declared !== bytes.byteLength
        ? "INVALID_CONTENT_LENGTH"
        : "REQUEST_TOO_LARGE",
    bytes.byteLength === 0
      ? "Resend webhook body is required."
      : declared !== null && declared !== bytes.byteLength
        ? "Content-Length does not match the request body."
        : "Request body is too large.",
    {
      status: bytes.byteLength === 0 ||
        (declared !== null && declared !== bytes.byteLength)
        ? 400
        : 413
    }
  );
  return bytes;
}

async function readRawTwilioResponderEvent(request, maximumBytes) {
  invariant(
    /^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/iu.test(
      String(request.headers.get("content-type") ?? "").trim()
    ),
    "UNSUPPORTED_MEDIA_TYPE",
    "The Twilio callback requires form-encoded request bytes.",
    { status: 415 }
  );
  const declared = declaredBodyLength(request, maximumBytes);
  const bytes = await readBoundedBytes(request, maximumBytes);
  invariant(
    bytes.byteLength > 0 && bytes.byteLength <= maximumBytes &&
      (declared === null || declared === bytes.byteLength),
    bytes.byteLength === 0
      ? "TWILIO_RESPONDER_EVENT_BODY_REQUIRED"
      : declared !== null && declared !== bytes.byteLength
        ? "INVALID_CONTENT_LENGTH"
        : "REQUEST_TOO_LARGE",
    bytes.byteLength === 0
      ? "The Twilio callback body is required."
      : declared !== null && declared !== bytes.byteLength
        ? "Content-Length does not match the request body."
        : "Request body is too large.",
    {
      status: bytes.byteLength === 0 ||
        (declared !== null && declared !== bytes.byteLength)
        ? 400
        : 413
    }
  );
  return bytes;
}

async function readRawTwilioResponderInbound(request, maximumBytes) {
  invariant(
    /^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/iu.test(
      String(request.headers.get("content-type") ?? "").trim()
    ),
    "UNSUPPORTED_MEDIA_TYPE",
    "The Twilio inbound event requires form-encoded request bytes.",
    { status: 415 }
  );
  const declared = declaredBodyLength(request, maximumBytes);
  const bytes = await readBoundedBytes(request, maximumBytes);
  invariant(
    bytes.byteLength > 0 && bytes.byteLength <= maximumBytes &&
      (declared === null || declared === bytes.byteLength),
    bytes.byteLength === 0
      ? "TWILIO_RESPONDER_INBOUND_BODY_REQUIRED"
      : declared !== null && declared !== bytes.byteLength
        ? "INVALID_CONTENT_LENGTH"
        : "REQUEST_TOO_LARGE",
    bytes.byteLength === 0
      ? "The Twilio inbound event body is required."
      : declared !== null && declared !== bytes.byteLength
        ? "Content-Length does not match the request body."
        : "Request body is too large.",
    {
      status: bytes.byteLength === 0 ||
        (declared !== null && declared !== bytes.byteLength)
        ? 400
        : 413
    }
  );
  return bytes;
}

const TWILIO_RESPONDER_INBOUND_TWIML = Object.freeze({
  [TWILIO_RESPONDER_INBOUND_MESSAGE_PATH]:
    TWILIO_RESPONDER_INBOUND_MESSAGE_TWIML,
  [TWILIO_RESPONDER_INBOUND_VOICE_PATH]:
    TWILIO_RESPONDER_INBOUND_VOICE_TWIML,
  [TWILIO_RESPONDER_INBOUND_DIAL_RESULT_PATH]:
    TWILIO_RESPONDER_INBOUND_DIAL_RESULT_TWIML
});

function exactTwilioResponderInboundAcknowledgement(response, pathname) {
  const exactBody = pathname === TWILIO_RESPONDER_INBOUND_VOICE_PATH
    ? isExactTwilioResponderVoiceTwiML(response?.body)
    : response?.body === TWILIO_RESPONDER_INBOUND_TWIML[pathname];
  invariant(
    response && typeof response === "object" && !Array.isArray(response) &&
      Object.getPrototypeOf(response) === Object.prototype &&
      response.status === 200 &&
      response.headers &&
      typeof response.headers === "object" &&
      response.headers["content-type"] === "text/xml; charset=utf-8" &&
      response.headers["cache-control"] === "no-store" &&
      exactBody,
    "TWILIO_RESPONDER_INBOUND_HTTP_DURABILITY_REQUIRED",
    "HTTP success requires an exact durable Twilio inbound acknowledgement.",
    { status: 503, details: { providerEffects: false } }
  );
  return response;
}

function exactResendWebhookAcknowledgement(response) {
  invariant(
    response !== null &&
      typeof response === "object" &&
      !Array.isArray(response) &&
      Object.getPrototypeOf(response) === Object.prototype &&
      response.status === 200 &&
      response.body !== null &&
      typeof response.body === "object" &&
      !Array.isArray(response.body) &&
      Object.getPrototypeOf(response.body) === Object.prototype &&
      JSON.stringify(Object.keys(response.body).sort()) === JSON.stringify([
        "currentState",
        "eventKind",
        "eventState",
        "received"
      ]) &&
      response.body.received === true &&
      ["applied", "pending", "conflict"].includes(
        response.body.eventState
      ) &&
      ["delivered", "bounced", "complained", "suppressed"].includes(
        response.body.eventKind
      ) &&
      (
        response.body.currentState === null ||
        [
          "accepted",
          "delivered",
          "bounced",
          "complained",
          "suppressed"
        ].includes(response.body.currentState)
      ),
    "RESEND_WEBHOOK_HTTP_DURABILITY_REQUIRED",
    "HTTP success requires an exact durable Resend event acknowledgement.",
    { status: 503, details: { providerEffects: false } }
  );
  return response.body;
}

function exactTwilioResponderEventAcknowledgement(response) {
  invariant(
    response && typeof response === "object" && !Array.isArray(response) &&
      Object.getPrototypeOf(response) === Object.prototype &&
      response.status === 200 &&
      response.body && typeof response.body === "object" &&
      !Array.isArray(response.body) &&
      Object.getPrototypeOf(response.body) === Object.prototype &&
      JSON.stringify(Object.keys(response.body).sort()) === JSON.stringify([
        "attentionRequired", "currentStatus", "eventState",
        "messageStatus", "received"
      ]) &&
      response.body.received === true &&
      ["pending", "applied", "stale", "conflict"]
        .includes(response.body.eventState) &&
      [
        "queued", "sending", "sent", "delivered",
        "undelivered", "failed", "canceled"
      ].includes(response.body.messageStatus) &&
      (
        response.body.currentStatus === null ||
        [
          "accepted", "queued", "sending", "sent", "delivered",
          "undelivered", "failed", "canceled"
        ].includes(response.body.currentStatus)
      ) &&
      typeof response.body.attentionRequired === "boolean",
    "TWILIO_RESPONDER_EVENT_HTTP_DURABILITY_REQUIRED",
    "HTTP success requires an exact durable Twilio callback acknowledgement.",
    { status: 503, details: { providerEffects: false } }
  );
  return response.body;
}

function match(pathname, pattern) {
  const result = pattern.exec(pathname);
  if (!result) return null;
  return result.slice(1).map((value) => decodeURIComponent(value));
}

function exactRouteBody(value, expected, code, message) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    code,
    message,
    { status: 400 }
  );
  return value;
}

function exactProjectCreateBody(value) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every((key) =>
        [
          "accessPassword",
          "address",
          "legalAcceptance",
          "name",
          "visibility"
        ].includes(key)
      ) &&
      Object.prototype.hasOwnProperty.call(value, "name") &&
      Object.prototype.hasOwnProperty.call(value, "legalAcceptance"),
    "LEGAL_ACCEPTANCE_INVALID",
    "Project creation contains an unsupported or missing field.",
    { status: 400 }
  );
  return value;
}

function exactRouteQuery(url, expected, code, message) {
  const keys = [...url.searchParams.keys()];
  invariant(
    keys.length === expected.length &&
      keys.every((key) => expected.includes(key)) &&
      expected.every((key) => url.searchParams.getAll(key).length === 1),
    code,
    message,
    { status: 400 }
  );
  return Object.freeze(
    Object.fromEntries(
      expected.map((key) => [key, url.searchParams.get(key)])
    )
  );
}

function commandId(request) {
  return request.headers.get("idempotency-key");
}

function expectedRevision(request) {
  const value = request.headers.get("if-match");
  return value === null ? Number.NaN : Number(value.replace(/^"|"$/gu, ""));
}

function requireSameOrigin(request, url) {
  const origin = request.headers.get("origin");
  invariant(
    !origin || origin === url.origin,
    "CROSS_ORIGIN_REQUEST_REJECTED",
    "Cross-origin requests are not allowed.",
    { status: 403 }
  );
}

function requireCsrf(request, cookies) {
  const cookie = cookies.ss_csrf;
  const header = request.headers.get("x-csrf-token");
  invariant(
    typeof cookie === "string" &&
      cookie.length >= 32 &&
      typeof header === "string" &&
      digest(cookie) === digest(header),
    "CSRF_TOKEN_REQUIRED",
    "Refresh this page before trying that action again.",
    { status: 403 }
  );
}

async function authenticatedOrganizationActor({
  service,
  request,
  route,
  product,
  selectionCode
}) {
  const selected = await service.authenticate(
    parseCookies(request.headers.get("cookie")).ss_session
  );
  if (selected === null || selected === undefined) return null;
  if (route.audience === "operator") {
    return Object.freeze({
      ...selected,
      organizationId: route.params.organizationId
    });
  }
  invariant(
    typeof service.listOrganizations === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    `Hosted ${product} organization authority is unavailable.`,
    { status: 500 }
  );
  const roster = await service.listOrganizations(selected);
  const organizations = Array.isArray(roster?.organizations)
    ? roster.organizations
    : [];
  const requestedOrganizationId = request.headers.get(
    "x-sitesourcery-organization-id"
  );
  invariant(
    requestedOrganizationId !== null || organizations.length === 1,
    selectionCode,
    `Select the organization whose ${product} account you want to open.`,
    { status: 409 }
  );
  const organizationId = requestedOrganizationId ?? organizations[0].id;
  invariant(
    organizations.some((organization) =>
      organization?.id === organizationId && organization?.state === "active"
    ),
    "NOT_FOUND",
    `The requested ${product} account was not found.`,
    { status: 404 }
  );
  return Object.freeze({ ...selected, organizationId });
}

export function createHostedApi(
  service,
  {
    requestIds,
    csrfTokens,
    downloadCommerce = null,
    alakazamAccount = null,
    alakazam35 = null,
    alakazam50 = null,
    alakazamRetainedPremium = null,
    alakazamPublication = null,
    alakazamBilling = null,
    alakazamBillingSurfaces = null,
    customServicesAccount = null,
    customServicesAssessmentWork = null,
    customServicesCustomBuild = null,
    customServicesCustomBuildChangeCompletion = null,
    customServicesCustomBuildChangePayment = null,
    customServicesCustomBuildFinalPayment = null,
    customServicesCustomBuildHandoff = null,
    customServicesCustomBuildProgress = null,
    customServicesCustomBuildWork = null,
    customServicesOwner = null,
    engagementBootstrap = null,
    careSurfaces = null,
    careCommerce = null,
    responderSurfaces = null,
    operatorWorkQueue = null,
    operatorProviderReconciliation = null,
    adjacentIntegration = null,
    supportCases = null,
    resendMailEvents = null,
    twilioResponderEvents = null,
    twilioResponderInbound = null,
    responderNumberBindings = null,
    stripeWebhook = null,
    capabilitiesPolicy = undefined,
    readinessPolicy = undefined,
    releaseIdentity = null,
    ingressPolicy = DEFAULT_INGRESS_POLICY
  } = {}
) {
  const ingress = validateIngressPolicy(ingressPolicy);
  invariant(service && typeof service.authenticate === "function", "RUNTIME_CONFIGURATION_ERROR", "Hosted service is required.", {
    status: 500
  });
  const release = runtimeReleaseIdentity(
    releaseIdentity
  );
  const readinessBoundary =
    createReadinessSnapshot({
      check: () => service.readiness(),
      ...(readinessPolicy ?? {})
    });
  const downloadBoundary =
    downloadCommerce ??
    createHeldHostedDownloadCommerce();
  invariant(
    typeof downloadBoundary.createQuote ===
      "function" &&
      typeof downloadBoundary.prepareCheckout ===
        "function" &&
      typeof downloadBoundary.download === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Download commerce boundary is invalid.",
    { status: 500 }
  );
  const customServicesOwnerBoundary =
    customServicesOwner ??
    createHeldCustomServicesOwner();
  invariant(
    typeof customServicesOwnerBoundary.listAssessmentRequests ===
      "function" &&
      typeof customServicesOwnerBoundary.issueAssessmentQuote ===
        "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted custom-services owner boundary is invalid.",
    { status: 500 }
  );
  const engagementBootstrapBoundary =
    engagementBootstrap ??
    createHeldHostedEngagementBootstrap();
  invariant(
    typeof engagementBootstrapBoundary.issueInvitation === "function" &&
      typeof engagementBootstrapBoundary.claimInvitation === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted customer engagement bootstrap boundary is invalid.",
    { status: 500 }
  );
  invariant(
    careSurfaces === null ||
      (
        careSurfaces?.kind === "care-surfaces" &&
        careSurfaces.mode === "held-local" &&
        careSurfaces.customerEffects === false &&
        careSurfaces.mailDeliveryEffects === false &&
        careSurfaces.paymentEffects === false &&
        careSurfaces.providerEffects === false &&
        typeof careSurfaces.readiness === "function"
      ),
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Care surfaces must use the verified effect-held composition.",
    { status: 500 }
  );
  const careSurfacesHttpBoundary = careSurfaces === null
    ? null
    : createCareSurfacesHttpBoundary({
        service: careSurfaces,
        authenticate: (request, route) => authenticatedOrganizationActor({
          service,
          request,
          route,
          product: "Care",
          selectionCode: "CARE_ORGANIZATION_SELECTION_REQUIRED"
        }),
        async requireWriteGuard(request) {
          requireCsrf(
            request,
            parseCookies(request.headers.get("cookie"))
          );
          return true;
        }
      });
  invariant(
    careCommerce === null ||
      (
        careCommerce?.kind === "care-commerce" &&
        careCommerce.mode === "held-local" &&
        careCommerce.commercialEffects === false &&
        careCommerce.customerEffects === false &&
        careCommerce.mailDeliveryEffects === false &&
        careCommerce.paymentEffects === false &&
        careCommerce.providerEffects === false &&
        typeof careCommerce.readiness === "function"
      ),
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Care commerce must use the verified effect-held composition.",
    { status: 500 }
  );
  const careCommerceHttpBoundary = careCommerce === null
    ? null
    : createCareCommerceHttpBoundary({
        service: careCommerce,
        async authenticate(request, route) {
          const selected = await authenticatedOrganizationActor({
            service,
            request,
            route,
            product: "Care commerce",
            selectionCode: "CARE_COMMERCE_ORGANIZATION_SELECTION_REQUIRED"
          });
          return selected === null
            ? null
            : Object.freeze({
                userId: selected.userId,
                organizationId: selected.organizationId
              });
        },
        async requireWriteGuard(request) {
          requireCsrf(
            request,
            parseCookies(request.headers.get("cookie"))
          );
          return true;
        }
      });
  invariant(
    responderSurfaces === null ||
      (
        responderSurfaces?.kind === "responder-surfaces" &&
        responderSurfaces.mode === "held" &&
        responderSurfaces.providerEffects === false &&
        responderSurfaces.billingEffects === false &&
        responderSurfaces.sellable === false &&
        typeof responderSurfaces.readiness === "function"
      ),
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Responder surfaces must use the verified effect-held composition.",
    { status: 500 }
  );
  const responderSurfacesHttpBoundary = responderSurfaces === null
    ? null
    : createResponderSurfacesHttpBoundary({
        service: responderSurfaces,
        authenticate: (request, route) => authenticatedOrganizationActor({
          service,
          request,
          route,
          product: "Responder",
          selectionCode: "RESPONDER_ORGANIZATION_SELECTION_REQUIRED"
        }),
        async requireWriteGuard(request) {
          requireCsrf(
            request,
            parseCookies(request.headers.get("cookie"))
          );
          return true;
        }
      });
  invariant(
    responderNumberBindings === null ||
      (
        responderNumberBindings?.repository?.kind ===
          "responder-number-bindings-postgres" &&
        responderNumberBindings.repository.providerEffects === false &&
        responderNumberBindings?.lookupDigests?.kind ===
          "responder-lookup-digests"
      ),
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Responder number bindings must use the keyed lookup composition.",
    { status: 500 }
  );
  const responderNumberBindingsHttpBoundary =
    responderNumberBindings === null
      ? null
      : createResponderNumberBindingsHttpBoundary({
          repository: responderNumberBindings.repository,
          lookupDigests: responderNumberBindings.lookupDigests,
          ...(responderNumberBindings.clock
            ? { clock: responderNumberBindings.clock }
            : {}),
          authenticate: (request, route) => authenticatedOrganizationActor({
            service,
            request,
            route,
            product: "Responder",
            selectionCode: "RESPONDER_ORGANIZATION_SELECTION_REQUIRED"
          }),
          async requireWriteGuard(request) {
            requireCsrf(
              request,
              parseCookies(request.headers.get("cookie"))
            );
            return true;
          }
        });
  const operatorWorkQueueHttpBoundary = operatorWorkQueue === null
    ? createHeldOperatorWorkQueueHttp({
        authenticate: async ({ actor }) => actor
      })
    : createOperatorWorkQueueHttpBoundary({ operatorQueue: operatorWorkQueue });
  const operatorProviderReconciliationHttpBoundary =
    operatorProviderReconciliation === null
      ? createHeldProviderReconciliationOperatorHttp()
      : createProviderReconciliationOperatorHttpBoundary({
          operator: operatorProviderReconciliation
        });
  const adjacentIntegrationHttpBoundary = adjacentIntegration === null
    ? null
    : createAdjacentIntegrationHttpBoundary({ service: adjacentIntegration });
  const supportCaseHttpBoundary = supportCases === null
    ? createHeldSupportCaseHttpBoundary()
    : createSupportCaseHttpBoundary({ supportCases });
  const resendMailEventHttpBoundary = resendMailEvents ??
    createHeldResendMailEventHttpAdapter();
  invariant(
    resendMailEventHttpBoundary?.kind ===
        "resend-mail-event-http-adapter" &&
      resendMailEventHttpBoundary.providerEffects === false &&
      typeof resendMailEventHttpBoundary.readiness === "function" &&
      typeof resendMailEventHttpBoundary.handle === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Resend mail-event ingress is invalid.",
    { status: 500 }
  );
  const twilioResponderEventHttpBoundary = twilioResponderEvents ??
    createHeldTwilioResponderEventsHttpAdapter();
  const twilioResponderInboundHttpBoundary = twilioResponderInbound ??
    createHeldTwilioResponderInboundHttpAdapter();
  invariant(
    twilioResponderInboundHttpBoundary?.kind ===
        "twilio-responder-inbound-http-adapter" &&
      typeof twilioResponderInboundHttpBoundary.providerEffects ===
        "boolean" &&
      typeof twilioResponderInboundHttpBoundary.readiness === "function" &&
      typeof twilioResponderInboundHttpBoundary.handle === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Twilio Responder inbound ingress is invalid.",
    { status: 500 }
  );
  invariant(
    twilioResponderEventHttpBoundary?.kind ===
        "twilio-responder-events-http-adapter" &&
      twilioResponderEventHttpBoundary.providerEffects === false &&
      typeof twilioResponderEventHttpBoundary.readiness === "function" &&
      typeof twilioResponderEventHttpBoundary.handle === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Twilio Responder callback ingress is invalid.",
    { status: 500 }
  );
  const customServicesAssessmentWorkBoundary =
    customServicesAssessmentWork ??
    createHeldCustomServicesAssessmentWork();
  invariant(
    typeof customServicesAssessmentWorkBoundary.listJobs === "function" &&
      typeof customServicesAssessmentWorkBoundary.uploadEvidence ===
        "function" &&
      typeof customServicesAssessmentWorkBoundary.putFinding === "function" &&
      typeof customServicesAssessmentWorkBoundary.deliverReport ===
        "function" &&
      typeof customServicesAssessmentWorkBoundary.readOwnerEvidence ===
        "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted custom-services assessment work boundary is invalid.",
    { status: 500 }
  );
  const customServicesCustomBuildBoundary =
    customServicesCustomBuild ??
    createHeldCustomServicesCustomBuild();
  invariant(
    typeof customServicesCustomBuildBoundary.listOpportunities ===
      "function" &&
      typeof customServicesCustomBuildBoundary.issueQuote === "function" &&
      typeof customServicesCustomBuildBoundary.issueDirectQuote ===
        "function" &&
      typeof customServicesCustomBuildBoundary.voidQuote === "function" &&
      typeof customServicesCustomBuildBoundary.readCurrentQuote ===
        "function" &&
      typeof customServicesCustomBuildBoundary.acceptCurrentQuote ===
        "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Custom build boundary is invalid.",
    { status: 500 }
  );
  const customServicesCustomBuildWorkBoundary =
    customServicesCustomBuildWork ??
    createHeldCustomServicesCustomBuildWork();
  invariant(
    typeof customServicesCustomBuildWorkBoundary.listJobs === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Custom build work boundary is invalid.",
    { status: 500 }
  );
  const customServicesCustomBuildProgressBoundary =
    customServicesCustomBuildProgress ??
    createHeldCustomServicesCustomBuildProgress();
  invariant(
    typeof customServicesCustomBuildProgressBoundary.readOwnerProgress ===
      "function" &&
      typeof customServicesCustomBuildProgressBoundary.recordProgress ===
        "function" &&
      typeof customServicesCustomBuildProgressBoundary.openRequest ===
        "function" &&
      typeof customServicesCustomBuildProgressBoundary.resolveRequest ===
        "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Custom-build progress boundary is invalid.",
    { status: 500 }
  );
  const customServicesCustomBuildChangeCompletionBoundary =
    customServicesCustomBuildChangeCompletion ??
    createHeldCustomServicesCustomBuildChangeCompletion();
  invariant(
    typeof customServicesCustomBuildChangeCompletionBoundary.readOwner ===
      "function" &&
      typeof customServicesCustomBuildChangeCompletionBoundary
        .issueChangeOrder === "function" &&
      typeof customServicesCustomBuildChangeCompletionBoundary
        .voidChangeOrder === "function" &&
      typeof customServicesCustomBuildChangeCompletionBoundary
        .expireChangeOrder === "function" &&
      typeof customServicesCustomBuildChangeCompletionBoundary
        .uploadEvidence === "function" &&
      typeof customServicesCustomBuildChangeCompletionBoundary
        .recordCompletion === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Custom-build change and completion boundary is invalid.",
    { status: 500 }
  );
  const customServicesCustomBuildChangePaymentBoundary =
    customServicesCustomBuildChangePayment ??
    createHeldCustomServicesCustomBuildChangePayment();
  invariant(
    typeof customServicesCustomBuildChangePaymentBoundary
        .readOwnerPayments === "function" &&
      typeof customServicesCustomBuildChangePaymentBoundary
        .reconcileCheckoutCreation === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Custom-build change payment boundary is invalid.",
    { status: 500 }
  );
  const customServicesCustomBuildFinalPaymentBoundary =
    customServicesCustomBuildFinalPayment ??
    createHeldCustomServicesCustomBuildFinalPayment();
  invariant(
    typeof customServicesCustomBuildFinalPaymentBoundary
        .readOwnerFinalPayments === "function" &&
      typeof customServicesCustomBuildFinalPaymentBoundary
        .reconcileCheckoutCreation === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Custom-build final payment boundary is invalid.",
    { status: 500 }
  );
  const customServicesCustomBuildHandoffBoundary =
    customServicesCustomBuildHandoff ??
    createHeldCustomServicesCustomBuildHandoff();
  invariant(
    typeof customServicesCustomBuildHandoffBoundary.readOwner ===
        "function" &&
      typeof customServicesCustomBuildHandoffBoundary.createHandoff ===
        "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Custom-build handoff boundary is invalid.",
    { status: 500 }
  );
  const customServicesCustomBuildHandoffOwnerBoundary =
    createHostedCustomServicesCustomBuildHandoffOwner({
      customBuildHandoff: customServicesCustomBuildHandoffBoundary
    });
  const stripeWebhookBoundary =
    stripeWebhook ?? service;
  const alakazamAccountBoundary =
    alakazamAccount ??
    createHeldHostedAlakazamAccount();
  invariant(
    typeof alakazamAccountBoundary.getSnapshot ===
      "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Alakazam account boundary is invalid.",
    { status: 500 }
  );
  const alakazam35Boundary =
    alakazam35 ?? createHeldHostedAlakazam35();
  invariant(
    [
      "getSnapshot",
      "readiness",
      "requestCare",
      "saveConfiguration",
      "uploadPhoto"
    ].every(
      (method) =>
        typeof alakazam35Boundary[method] === "function"
    ),
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Alakazam $35 boundary is invalid.",
    { status: 500 }
  );
  const alakazam50Boundary =
    alakazam50 ?? createHeldHostedAlakazam50();
  invariant(
    [
      "getSnapshot",
      "readiness",
      "requestCare",
      "saveConfiguration"
    ].every(
      (method) =>
        typeof alakazam50Boundary[method] === "function"
    ),
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Alakazam $50 boundary is invalid.",
    { status: 500 }
  );
  const alakazamRetainedPremiumBoundary =
    alakazamRetainedPremium ??
    createHeldHostedAlakazamRetainedPremium();
  invariant(
    [
      "getSnapshot",
      "getExport",
      "readiness",
      "restoreConfiguration"
    ].every(
      (method) =>
        typeof alakazamRetainedPremiumBoundary[method] ===
          "function"
    ),
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted retained Alakazam premium boundary is invalid.",
    { status: 500 }
  );
  const alakazamPublicationBoundary =
    alakazamPublication ??
    createHeldHostedAlakazamPublication();
  invariant(
    typeof alakazamPublicationBoundary.readiness ===
      "function" &&
      typeof alakazamPublicationBoundary.getSnapshot ===
        "function" &&
      typeof alakazamPublicationBoundary.requestCommand ===
        "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Alakazam publication boundary is invalid.",
    { status: 500 }
  );
  const alakazamBillingBoundary =
    alakazamBilling ??
    createHeldHostedAlakazamBilling();
  invariant(
    typeof alakazamBillingBoundary.readiness ===
      "function" &&
      typeof alakazamBillingBoundary.createQuote ===
      "function" &&
      typeof alakazamBillingBoundary.createCheckout ===
        "function" &&
      typeof alakazamBillingBoundary.scheduleDowngrade ===
        "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Alakazam billing boundary is invalid.",
    { status: 500 }
  );
  const alakazamBillingSurfacesBoundary =
    alakazamBillingSurfaces ??
    createHeldHostedAlakazamBillingSurfaces();
  invariant(
    typeof alakazamBillingSurfacesBoundary.getInvoice ===
      "function" &&
      typeof alakazamBillingSurfacesBoundary
        .getCancellationPreview === "function" &&
      typeof alakazamBillingSurfacesBoundary
        .getBillingStates === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Alakazam billing surfaces boundary is invalid.",
    { status: 500 }
  );
  const customServicesAccountBoundary =
    customServicesAccount ??
    createHeldHostedCustomServicesAccount();
  invariant(
    typeof customServicesAccountBoundary.getSnapshot === "function" &&
      typeof customServicesAccountBoundary.getAssessmentQuote ===
        "function" &&
      typeof customServicesAccountBoundary.getAssessmentInvoice ===
        "function" &&
      typeof customServicesAccountBoundary.getAssessmentReport ===
        "function" &&
      typeof customServicesAccountBoundary.getAssessmentEvidence ===
        "function" &&
      typeof customServicesAccountBoundary.createAssessmentCheckout ===
        "function" &&
      typeof customServicesAccountBoundary.getAssessmentRequest ===
        "function" &&
      typeof customServicesAccountBoundary.saveAssessmentRequest ===
        "function" &&
      typeof customServicesAccountBoundary.submitAssessmentRequest ===
        "function" &&
      typeof customServicesAccountBoundary.withdrawAssessmentRequest ===
        "function" &&
      typeof customServicesAccountBoundary.acceptAssessmentQuote ===
        "function" &&
      typeof customServicesAccountBoundary.getCustomBuildQuote ===
        "function" &&
      typeof customServicesAccountBoundary.getCustomBuildInvoice ===
        "function" &&
      typeof customServicesAccountBoundary.getCustomBuildProgress ===
        "function" &&
      typeof customServicesAccountBoundary.getCustomBuildChangeCompletion ===
        "function" &&
      typeof customServicesAccountBoundary.getCustomBuildChangeInvoice ===
        "function" &&
      typeof customServicesAccountBoundary.getCustomBuildFinalHandoff ===
        "function" &&
      typeof customServicesAccountBoundary.getCustomBuildHandoffDocument ===
        "function" &&
      typeof customServicesAccountBoundary.getCustomBuildCompletionEvidence ===
        "function" &&
      typeof customServicesAccountBoundary.createCustomBuildCheckout ===
        "function" &&
      typeof customServicesAccountBoundary
        .createCustomBuildChangeCheckout === "function" &&
      typeof customServicesAccountBoundary
        .createCustomBuildFinalCheckout === "function" &&
      typeof customServicesAccountBoundary.acceptCustomBuildQuote ===
        "function" &&
      typeof customServicesAccountBoundary.respondToCustomBuildRequest ===
        "function" &&
      typeof customServicesAccountBoundary.acceptCustomBuildChangeOrder ===
        "function" &&
      typeof customServicesAccountBoundary.declineCustomBuildChangeOrder ===
        "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted custom-services account boundary is invalid.",
    { status: 500 }
  );
  const nextRequestId =
    requestIds?.next?.bind(requestIds) ??
    (() => `req_${randomToken(12)}`);
  const nextCsrfToken =
    typeof csrfTokens === "function" ? csrfTokens : () => randomToken(32);
  const capabilitiesBoundary =
    createCapabilitiesSnapshot({
      async load() {
        invariant(
          typeof service.readiness === "function",
          "RUNTIME_CONFIGURATION_ERROR",
          "Hosted capabilities are unavailable.",
          { status: 500 }
        );
        const [
          readiness,
          download,
          alakazam,
          alakazam35Readiness,
          alakazam50Readiness,
          alakazamRetainedPremiumReadiness,
          alakazamPublicationReadiness,
          resendMailEventReadiness,
          twilioResponderEventReadiness,
          twilioResponderInboundReadiness,
          careReadiness,
          careCommerceReadiness,
          responderReadiness,
          adjacentIntegrationReadiness
        ] = await Promise.all([
          service.readiness(),
          typeof downloadBoundary.readiness === "function"
            ? downloadBoundary.readiness()
            : {
                quote: false,
                payment: false
              },
          alakazamBillingBoundary.readiness(),
          alakazam35Boundary.readiness(),
          alakazam50Boundary.readiness(),
          alakazamRetainedPremiumBoundary.readiness(),
          alakazamPublicationBoundary.readiness(),
          resendMailEventHttpBoundary.readiness(),
          twilioResponderEventHttpBoundary.readiness(),
          twilioResponderInboundHttpBoundary.readiness(),
          careSurfaces === null
            ? {
                ready: false,
                verified: false,
                customerEffects: false,
                mailDeliveryEffects: false,
                paymentEffects: false,
                providerEffects: false
              }
            : careSurfaces.readiness(),
          careCommerce === null
            ? {
                ready: false,
                verified: false,
                commercialReady: false,
                durableCommercialState: false,
                taxPurposeReleased: false,
                mailReservationReady: false,
                commercialEffects: false,
                customerEffects: false,
                mailDeliveryEffects: false,
                paymentEffects: false,
                providerEffects: false
              }
            : careCommerce.readiness(),
          responderSurfaces === null
            ? {
                ready: false,
                verified: false,
                providerEffects: false,
                billingEffects: false,
                sellable: false
              }
            : responderSurfaces.readiness(),
          adjacentIntegration === null
            ? {
                ready: false,
                verified: false,
                mode: "held",
                systems: [],
                remoteWrites: false,
                providerEffects: false,
                automaticCommands: false
              }
            : adjacentIntegration.readiness()
        ]);
        const registration =
          readiness?.registration ?? {};
        const recovery =
          readiness?.recovery ?? {};
        const domains =
          readiness?.providers?.domains ?? {};
        return Object.freeze({
          accountRegistration:
            registration.ready === true &&
            registration.verified === true,
          accountRecoveryEmail:
            recovery.ready === true &&
            recovery.verified === true,
          downloadQuote: download.quote === true,
          downloadPayment: download.payment === true,
          alakazamQuote: alakazam.quote === true,
          alakazamCheckout: alakazam.checkout === true,
          alakazamDowngrade: alakazam.downgrade === true,
          alakazam35:
            alakazam35Readiness.authorization === true &&
            alakazam35Readiness.providerEffects === false,
          alakazam50:
            alakazam50Readiness.authorization === true &&
            alakazam50Readiness.providerEffects === false,
          alakazamRetainedPremium:
            alakazamRetainedPremiumReadiness.ready === true &&
            alakazamRetainedPremiumReadiness.authorization === true &&
            alakazamRetainedPremiumReadiness.providerEffects === false &&
            alakazamRetainedPremiumReadiness.state === "held",
          alakazamPublication:
            alakazamPublicationReadiness.authorization === true &&
            alakazamPublicationReadiness.providerEffects === false,
          mailProviderEvents:
            resendMailEventReadiness?.ready === true &&
            resendMailEventReadiness?.verified === true,
          responderProviderEvents:
            twilioResponderEventReadiness?.ready === true &&
            twilioResponderEventReadiness?.verified === true &&
            twilioResponderEventReadiness?.providerEffects === false,
          responderInboundEvents:
            twilioResponderInboundReadiness?.ready === true &&
            twilioResponderInboundReadiness?.verified === true &&
            (twilioResponderInboundReadiness?.ingressProviderEffects ??
              twilioResponderInboundReadiness?.providerEffects) === false,
          care:
            careReadiness?.ready === true &&
            careReadiness?.verified === true &&
            careReadiness?.customerEffects === false &&
            careReadiness?.mailReservation?.deliveryEffects === false &&
            careReadiness?.paymentEffects === false &&
            careReadiness?.providerEffects === false &&
            careCommerceReadiness?.ready === true &&
            careCommerceReadiness?.verified === true &&
            careCommerceReadiness?.commercialReady === false &&
            careCommerceReadiness?.durableCommercialState === true &&
            careCommerceReadiness?.taxPurposeReleased === false &&
            careCommerceReadiness?.mailReservationReady === true &&
            careCommerceReadiness?.commercialEffects === false &&
            careCommerceReadiness?.customerEffects === false &&
            careCommerceReadiness?.mailDeliveryEffects === false &&
            careCommerceReadiness?.paymentEffects === false &&
            careCommerceReadiness?.providerEffects === false,
          careCommerce: Object.freeze({
            ready:
              careCommerceReadiness?.ready === true &&
              careCommerceReadiness?.verified === true &&
              careCommerceReadiness?.commercialReady === false &&
              careCommerceReadiness?.durableCommercialState === true &&
              careCommerceReadiness?.taxPurposeReleased === false &&
              careCommerceReadiness?.mailReservationReady === true &&
              careCommerceReadiness?.commercialEffects === false &&
              careCommerceReadiness?.customerEffects === false &&
              careCommerceReadiness?.mailDeliveryEffects === false &&
              careCommerceReadiness?.paymentEffects === false &&
              careCommerceReadiness?.providerEffects === false,
            mounted: careCommerce !== null,
            mode: "held-local",
            commercialReady:
              careCommerceReadiness?.commercialReady === true,
            taxPurposeReleased:
              careCommerceReadiness?.taxPurposeReleased === true,
            commercialEffects: false,
            customerEffects: false,
            mailDeliveryEffects: false,
            paymentEffects: false,
            providerEffects: false
          }),
          responder:
            responderReadiness?.ready === true &&
            responderReadiness?.verified === true &&
            responderReadiness?.providerEffects === false &&
            responderReadiness?.billingEffects === false &&
            responderReadiness?.sellable === false,
          adjacentIntegrations: Object.freeze({
            ready:
              adjacentIntegrationReadiness?.ready === true &&
              adjacentIntegrationReadiness?.verified === true &&
              adjacentIntegrationReadiness?.systems?.length === 6,
            mode: adjacentIntegrationReadiness?.mode ?? "held",
            systems: Object.freeze([
              ...(adjacentIntegrationReadiness?.systems ?? [])
            ]),
            remoteWrites: false,
            providerEffects: false,
            automaticCommands: false
          }),
          domains: Object.freeze({
            ready:
              domains.ready === true &&
              domains.verified === true &&
              domains.mounted === true,
            verified: domains.verified === true,
            mounted: domains.mounted === true,
            mode: domains.mode ?? "held",
            purchaseReady: domains.purchaseReady === true,
            registrar: domains.registrar ?? "held",
            payments: domains.payments ?? "held",
            dns: domains.dns ?? "held",
            providerEffects: domains.providerEffects === true,
            remoteWrites: domains.remoteWrites === true,
            automaticCommands: false
          }),
          domainPurchase:
            domains.purchaseReady === true,
          publishing:
            readiness?.publication?.ready === true &&
            readiness?.publication?.held === false
        });
      },
      ...(capabilitiesPolicy ?? {})
    });

  return Object.freeze({
    async fetch(request, requestContext = {}) {
      const requestId = nextRequestId("request");
      const identityContext = Object.freeze({
        clientAddress:
          typeof requestContext?.clientAddress === "string" &&
          requestContext.clientAddress.length > 0 &&
          requestContext.clientAddress.length <= 80
            ? requestContext.clientAddress
            : "unavailable"
      });
      try {
        const url = new URL(request.url);
        const method = request.method.toUpperCase();
        const pathname = url.pathname.replace(/\/+$/u, "") || "/";
        const cookies = parseCookies(request.headers.get("cookie"));
        requireSameOrigin(request, url);

        if (
          method === "GET" &&
          pathname === "/api/v1/health"
        ) {
          return json(
            {
              ok: true,
              service: HOSTED_RUNTIME_SERVICE
            },
            200,
            { "X-Request-Id": requestId }
          );
        }

        if (
          method === "GET" &&
          pathname === "/api/v1/live"
        ) {
          return json(
            {
              schema: HOSTED_LIVENESS_SCHEMA,
              live: true,
              service: HOSTED_RUNTIME_SERVICE,
              release
            },
            200,
            { "X-Request-Id": requestId }
          );
        }

        if (
          method === "GET" &&
          pathname ===
            "/_sitesourcery/operations-state"
        ) {
          invariant(
            typeof service.readiness === "function",
            "RUNTIME_CONFIGURATION_ERROR",
            "Hosted operations state is unavailable.",
            { status: 500 }
          );
          const readiness =
            await service.readiness();
          return json(
            {
              schema:
                HOSTED_OPERATIONS_STATE_SCHEMA,
              operationsState:
                operationsStateProjection(
                  readiness
                )
            },
            readiness?.ready === true ? 200 : 503,
            { "X-Request-Id": requestId }
          );
        }

        if (
          method === "GET" &&
          pathname === "/api/v1/ready"
        ) {
          const readiness =
            await readinessBoundary.read();
          return json(
            {
              schema: HOSTED_READINESS_SCHEMA,
              ready: readiness.ready,
              service: HOSTED_RUNTIME_SERVICE,
              release,
              ageMs: readiness.ageMs,
              state: readiness.state,
              code: readiness.code,
              latencyBucket:
                readiness.latencyBucket
            },
            readiness.ready ? 200 : 503,
            { "X-Request-Id": requestId }
          );
        }

        if (
          method === "GET" &&
          pathname === "/api/v1/capabilities"
        ) {
          const capabilities =
            await capabilitiesBoundary.read();
          invariant(
            capabilities.ok === true,
            "CAPABILITIES_UNAVAILABLE",
            "Hosted capabilities are unavailable.",
            { status: 503 }
          );
          return json(
            capabilities.value,
            200,
            { "X-Request-Id": requestId }
          );
        }

        if (method === "GET" && pathname === "/api/v1/csrf") {
          const csrfToken = currentCsrfToken(cookies, nextCsrfToken);
          return json(
            { csrfToken },
            200,
            {
              "Set-Cookie": csrfCookie(csrfToken),
              "X-Request-Id": requestId
            }
          );
        }

        if (
          method === "POST" &&
          pathname === "/api/v1/webhooks/stripe"
        ) {
          invariant(
            typeof stripeWebhookBoundary
              .ingestStripeWebhook ===
              "function",
            "RUNTIME_CONFIGURATION_ERROR",
            "Stripe webhook ingestion is unavailable.",
            { status: 500 }
          );
          const result =
            await stripeWebhookBoundary.ingestStripeWebhook({
              rawBody: await readRawWebhook(
                request,
                ingress.body.webhookBytes
              ),
              signature: request.headers.get(
                "stripe-signature"
              )
            });
          return json(result, 200, {
            "X-Request-Id": requestId
          });
        }

        if (pathname === RESEND_MAIL_EVENT_PATH) {
          invariant(
            method === "POST",
            "METHOD_NOT_ALLOWED",
            "The Resend webhook requires POST.",
            { status: 405 }
          );
          const response = await resendMailEventHttpBoundary.handle({
            method,
            pathname,
            headers: request.headers,
            rawBody: await readRawResendWebhook(
              request,
              Math.min(
                ingress.body.webhookBytes,
                RESEND_MAIL_EVENT_MAXIMUM_BYTES
              )
            )
          });
          return json(exactResendWebhookAcknowledgement(response), 200, {
            "X-Request-Id": requestId
          });
        }

        if (pathname === TWILIO_RESPONDER_EVENT_PATH) {
          invariant(
            method === "POST",
            "METHOD_NOT_ALLOWED",
            "The Twilio Responder callback requires POST.",
            { status: 405 }
          );
          const response = await twilioResponderEventHttpBoundary.handle({
            method,
            pathname,
            headers: request.headers,
            rawBody: await readRawTwilioResponderEvent(
              request,
              Math.min(
                ingress.body.webhookBytes,
                TWILIO_RESPONDER_EVENT_MAXIMUM_BYTES
              )
            )
          });
          return json(
            exactTwilioResponderEventAcknowledgement(response),
            200,
            { "X-Request-Id": requestId }
          );
        }

        if (
          Object.hasOwn(TWILIO_RESPONDER_INBOUND_TWIML, pathname)
        ) {
          invariant(
            method === "POST",
            "METHOD_NOT_ALLOWED",
            "The Twilio inbound event requires POST.",
            { status: 405 }
          );
          const response = exactTwilioResponderInboundAcknowledgement(
            await twilioResponderInboundHttpBoundary.handle({
              method,
              pathname,
              headers: request.headers,
              rawBody: await readRawTwilioResponderInbound(
                request,
                Math.min(
                  ingress.body.webhookBytes,
                  TWILIO_RESPONDER_INBOUND_MAXIMUM_BYTES
                )
              )
            }),
            pathname
          );
          return new Response(response.body, {
            status: 200,
            headers: {
              ...response.headers,
              "Referrer-Policy": "no-referrer",
              "X-Content-Type-Options": "nosniff",
              "X-Frame-Options": "DENY",
              "X-Request-Id": requestId
            }
          });
        }

        if (careSurfacesHttpBoundary !== null) {
          const careResponse =
            await careSurfacesHttpBoundary.dispatch(request);
          if (careResponse !== null) {
            return rootedResponse(careResponse, requestId);
          }
        }

        if (careCommerceHttpBoundary !== null) {
          const commerceResponse =
            await careCommerceHttpBoundary.dispatch(request);
          if (commerceResponse !== null) {
            return rootedResponse(commerceResponse, requestId);
          }
        }

        if (responderSurfacesHttpBoundary !== null) {
          const responderResponse =
            await responderSurfacesHttpBoundary.dispatch(request);
          if (responderResponse !== null) {
            return rootedResponse(responderResponse, requestId);
          }
        }

        if (responderNumberBindingsHttpBoundary !== null) {
          const bindingResponse =
            await responderNumberBindingsHttpBoundary.dispatch(request);
          if (bindingResponse !== null) {
            return rootedResponse(bindingResponse, requestId);
          }
        }

        if (WRITE_METHODS.has(method)) {
          requireCsrf(request, cookies);
          invariant(
            typeof commandId(request) === "string",
            "IDEMPOTENCY_KEY_REQUIRED",
            "An idempotency key is required.",
            { status: 400 }
          );
        }

        const actor =
          method === "POST" &&
          SESSIONLESS_IDENTITY_WRITES.has(pathname)
            ? null
            : await service.authenticate(
                cookies.ss_session
              );
        const body = WRITE_METHODS.has(method)
          ? await readJson(request, ingress.body.jsonBytes)
          : {};
        const write = { ...body, commandId: commandId(request) };
        let route;
        let alakazamBillingSurface;
        let result;
        let status = 200;
        let headers = { "X-Request-Id": requestId };
        const operatorWorkQueueResponse =
          await operatorWorkQueueHttpBoundary.dispatch({
            method,
            pathname,
            actor,
            query: url.searchParams,
            body,
            commandId: write.commandId
          });
        const operatorProviderReconciliationResponse =
          operatorWorkQueueResponse === null
            ? await operatorProviderReconciliationHttpBoundary.dispatch({
                method,
                pathname,
                actor,
                query: url.searchParams,
                body,
                commandId: write.commandId
              })
            : null;
        const adjacentIntegrationResponse =
          operatorWorkQueueResponse === null &&
          operatorProviderReconciliationResponse === null &&
          adjacentIntegrationHttpBoundary !== null
            ? await adjacentIntegrationHttpBoundary.dispatch({
                method,
                pathname,
                actor,
                query: url.searchParams,
                body,
                commandId: write.commandId
              })
            : null;
        const supportCaseResponse = operatorWorkQueueResponse === null &&
          operatorProviderReconciliationResponse === null &&
          adjacentIntegrationResponse === null
          ? await supportCaseHttpBoundary.dispatch({
              method,
              pathname,
              actor,
              query: url.searchParams,
              body,
              commandId: write.commandId
            })
          : null;

        if (operatorWorkQueueResponse !== null) {
          result = operatorWorkQueueResponse.result;
          status = operatorWorkQueueResponse.status;
        } else if (operatorProviderReconciliationResponse !== null) {
          result = operatorProviderReconciliationResponse.result;
          status = operatorProviderReconciliationResponse.status;
        } else if (adjacentIntegrationResponse !== null) {
          result = adjacentIntegrationResponse.result;
          status = adjacentIntegrationResponse.status;
        } else if (supportCaseResponse !== null) {
          result = supportCaseResponse.result;
          status = supportCaseResponse.status;
        } else if (method === "POST" && pathname === "/api/v1/auth/register") {
          const staged = await service.register(
            write,
            identityContext
          );
          const { sessionToken, ...safe } = staged;
          invariant(
            sessionToken === undefined,
            "RUNTIME_CONFIGURATION_ERROR",
            "Unverified registration must not create a session.",
            { status: 500 }
          );
          result = safe;
          status = 202;
        } else if (
          method === "POST" &&
          pathname ===
            "/api/v1/auth/register/complete"
        ) {
          const created =
            await service.completeRegistration(write);
          const sessionToken = created?.sessionToken;
          invariant(
            typeof sessionToken === "string" &&
              sessionToken.length >= 32,
            "RUNTIME_CONFIGURATION_ERROR",
            "Registration activation did not create a valid session.",
            { status: 500 }
          );
          result = publicAuthenticationResult(created);
          status = 201;
          headers["Set-Cookie"] =
            sessionCookie(sessionToken);
        } else if (method === "POST" && pathname === "/api/v1/auth/sessions") {
          const signedIn = await service.signIn(write);
          const sessionToken = signedIn?.sessionToken;
          invariant(
            typeof sessionToken === "string" &&
              sessionToken.length >= 32,
            "RUNTIME_CONFIGURATION_ERROR",
            "Sign-in did not create a valid session.",
            { status: 500 }
          );
          result = publicAuthenticationResult(signedIn);
          status = 201;
          headers["Set-Cookie"] = sessionCookie(sessionToken);
        } else if (
          method === "DELETE" &&
          pathname === "/api/v1/auth/sessions/current"
        ) {
          result = await service.signOut(actor, write.commandId);
          headers["Set-Cookie"] = clearSessionCookie();
        } else if (method === "POST" && pathname === "/api/v1/auth/recovery") {
          result = await service.requestRecovery(
            write,
            identityContext
          );
          status = 202;
        } else if (
          method === "POST" &&
          pathname === "/api/v1/auth/recovery/complete"
        ) {
          result = await service.completeRecovery(write);
        } else if (
          method === "POST" &&
          pathname === ENGAGEMENT_HTTP_ROUTES.claim.path
        ) {
          const claimed =
            await engagementBootstrapBoundary.claimInvitation({
              ...exactRouteBody(
                write,
                ENGAGEMENT_HTTP_ROUTES.claim.bodyKeys,
                "INVALID_ENGAGEMENT_CLAIM",
                "The customer engagement claim is invalid."
              ),
              userAgentDigest: digestUserAgent(
                request.headers.get("user-agent")
              )
            });
          const sessionToken = claimed?.sessionToken;
          invariant(
            typeof sessionToken === "string" &&
              sessionToken.length >= 32,
            "RUNTIME_CONFIGURATION_ERROR",
            "The customer engagement claim did not create a valid session.",
            { status: 500 }
          );
          result = publicAuthenticationResult(claimed);
          status = 201;
          headers["Set-Cookie"] = sessionCookie(sessionToken);
        } else if (method === "GET" && pathname === "/api/v1/me") {
          const csrfToken = currentCsrfToken(cookies, nextCsrfToken);
          result = actor ? await service.me(actor) : { user: null };
          result = { ...result, csrfToken };
          headers["Set-Cookie"] = csrfCookie(csrfToken);
        } else if (method === "GET" && pathname === "/api/v1/organizations") {
          result = await service.listOrganizations(actor);
        } else if (
          method === "POST" &&
          pathname === ENGAGEMENT_HTTP_ROUTES.issue.path
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before issuing a customer engagement invitation.",
            { status: 401 }
          );
          result = await engagementBootstrapBoundary.issueInvitation(
            actor,
            exactRouteBody(
              write,
              ENGAGEMENT_HTTP_ROUTES.issue.bodyKeys,
              "INVALID_ENGAGEMENT_INVITATION",
              "The customer engagement invitation is invalid."
            )
          );
          status = 201;
        } else if (
          method === "GET" &&
          pathname ===
            "/api/v1/operator/custom-services/assessment-requests"
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before opening owner quote tools.",
            { status: 401 }
          );
          result =
            await customServicesOwnerBoundary.listAssessmentRequests(
              actor
            );
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/assessment-requests\/([^/]+)\/quote$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before issuing an assessment quote.",
            { status: 401 }
          );
          result =
            await customServicesOwnerBoundary.issueAssessmentQuote(
              actor,
              route[0],
              exactRouteBody(
                write,
                [
                  "commandId",
                  "deliveryDate",
                  "organizationId",
                  "reviewTargets"
                ],
                "INVALID_OWNER_ASSESSMENT_QUOTE",
                "The owner assessment quote is invalid."
              )
            );
          status = 201;
        } else if (
          method === "GET" &&
          pathname ===
            "/api/v1/operator/custom-services/assessment-jobs"
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before opening assessment work tools.",
            { status: 401 }
          );
          result =
            await customServicesAssessmentWorkBoundary.listJobs(actor);
        } else if (
          method === "GET" &&
          pathname ===
            "/api/v1/operator/custom-services/custom-build-jobs"
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before opening paid Custom build jobs.",
            { status: 401 }
          );
          const cursorValues = url.searchParams.getAll("cursor");
          invariant(
            cursorValues.length <= 1 &&
              [...url.searchParams.keys()].every((key) => key === "cursor"),
            "INVALID_CUSTOM_BUILD_WORK_CURSOR",
            "The paid Custom-build job cursor is invalid.",
            { status: 400 }
          );
          result =
            await customServicesCustomBuildWorkBoundary.listJobs(
              actor,
              cursorValues[0] ?? null
            );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/final-payments$/u
          ))
        ) {
          // Payment lifecycle and reconciliation are a distinct authority.
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before opening Custom-build final payment.",
            { status: 401 }
          );
          const query = exactRouteQuery(
            url,
            ["organizationId"],
            "INVALID_CUSTOM_BUILD_FINAL_PAYMENT_INPUT",
            "The Custom-build final payment query is invalid."
          );
          result = await customServicesCustomBuildFinalPaymentBoundary
            .readOwnerFinalPayments(
              actor,
              route[0],
              query.organizationId
            );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/final-handoff$/u
          ))
        ) {
          // Handoff readiness intentionally uses only the handoff boundary,
          // whose PostgreSQL authority is service_job_manage plus
          // service_document_manage. It must not borrow payment reconciliation.
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before opening Custom-build handoff.",
            { status: 401 }
          );
          const query = exactRouteQuery(
            url,
            ["organizationId"],
            "INVALID_CUSTOM_BUILD_HANDOFF_INPUT",
            "The Custom-build handoff query is invalid."
          );
          result = await customServicesCustomBuildHandoffOwnerBoundary
            .readOwnerState(actor, route[0], query.organizationId);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/handoff$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before handing off a completed Custom build.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_HANDOFF_INPUT",
            "The Custom-build handoff query is invalid."
          );
          const input = exactRouteBody(
            body,
            [
              "commandId",
              "customerSummary",
              "deliveryManifest",
              "expectedCompletionPackageDigest",
              "expectedFinalObligationDigest",
              "organizationId"
            ],
            "INVALID_CUSTOM_BUILD_HANDOFF_INPUT",
            "The Custom-build handoff command is invalid."
          );
          invariant(
            input.commandId === commandId(request),
            "INVALID_CUSTOM_BUILD_HANDOFF_INPUT",
            "The Custom-build handoff command is invalid.",
            { status: 400 }
          );
          result = await customServicesCustomBuildHandoffOwnerBoundary
            .createHandoff(actor, route[0], input);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/final-payments\/([^/]+)\/checkout-reconciliation$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before reconciling an uncertain Custom-build final Checkout.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_FINAL_PAYMENT_INPUT",
            "The Custom-build final payment query is invalid."
          );
          const input = exactRouteBody(
            body,
            ["commandId", "organizationId"],
            "INVALID_CUSTOM_BUILD_FINAL_PAYMENT_INPUT",
            "The Custom-build final payment reconciliation is invalid."
          );
          invariant(
            input.commandId === commandId(request),
            "INVALID_CUSTOM_BUILD_FINAL_PAYMENT_INPUT",
            "The Custom-build final payment reconciliation command is invalid.",
            { status: 400 }
          );
          result = await customServicesCustomBuildFinalPaymentBoundary
            .reconcileCheckoutCreation(actor, route[0], {
              attemptId: route[1],
              commandId: input.commandId,
              organizationId: input.organizationId
            });
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/change-payments$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before opening Custom-build change payments.",
            { status: 401 }
          );
          const query = exactRouteQuery(
            url,
            ["organizationId"],
            "INVALID_CUSTOM_BUILD_CHANGE_PAYMENT_INPUT",
            "The Custom-build change payment query is invalid."
          );
          result = await customServicesCustomBuildChangePaymentBoundary
            .readOwnerPayments(actor, route[0], query.organizationId);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/change-payments\/([^/]+)\/checkout-reconciliation$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before reconciling an uncertain Custom-build change Checkout.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_CHANGE_PAYMENT_INPUT",
            "The Custom-build change payment query is invalid."
          );
          const input = exactRouteBody(
            body,
            ["commandId", "organizationId"],
            "INVALID_CUSTOM_BUILD_CHANGE_PAYMENT_INPUT",
            "The Custom-build change payment reconciliation is invalid."
          );
          invariant(
            input.commandId === commandId(request),
            "INVALID_CUSTOM_BUILD_CHANGE_PAYMENT_INPUT",
            "The Custom-build change payment reconciliation command is invalid.",
            { status: 400 }
          );
          result = await customServicesCustomBuildChangePaymentBoundary
            .reconcileCheckoutCreation(actor, route[0], {
              attemptId: route[1],
              commandId: input.commandId,
              organizationId: input.organizationId
            });
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/progress$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before opening Custom-build project tools.",
            { status: 401 }
          );
          const organizationValues = url.searchParams.getAll("organizationId");
          invariant(
            organizationValues.length === 1 &&
              [...url.searchParams.keys()].every(
                (key) => key === "organizationId"
              ),
            "INVALID_CUSTOM_BUILD_PROGRESS_INPUT",
            "The Custom-build organization is invalid.",
            { status: 400 }
          );
          result = await customServicesCustomBuildProgressBoundary
            .readOwnerProgress(actor, route[0], organizationValues[0]);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/progress$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before updating Custom-build progress.",
            { status: 401 }
          );
          result = await customServicesCustomBuildProgressBoundary
            .recordProgress(
              actor,
              route[0],
              exactRouteBody(
                write,
                [
                  "commandId",
                  "customerSummary",
                  "expectedRevision",
                  "milestones",
                  "nextStep",
                  "organizationId",
                  "stage"
                ],
                "INVALID_CUSTOM_BUILD_PROGRESS_INPUT",
                "The Custom-build progress update is invalid."
              )
            );
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/requests$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before opening a Custom-build request.",
            { status: 401 }
          );
          result = await customServicesCustomBuildProgressBoundary.openRequest(
            actor,
            route[0],
            exactRouteBody(
              write,
              [
                "access",
                "commandId",
                "customerMessage",
                "expectedProgressRevision",
                "organizationId",
                "requestKind",
                "safeInstructions",
                "targetDateImpact",
                "title"
              ],
              "INVALID_CUSTOM_BUILD_PROGRESS_INPUT",
              "The Custom-build request is invalid."
            )
          );
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/requests\/([^/]+)\/resolution$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before resolving a Custom-build request.",
            { status: 401 }
          );
          result = await customServicesCustomBuildProgressBoundary.resolveRequest(
            actor,
            route[0],
            route[1],
            exactRouteBody(
              write,
              [
                "commandId",
                "expectedRevision",
                "organizationId",
                "resolutionNote",
                "state"
              ],
              "INVALID_CUSTOM_BUILD_PROGRESS_INPUT",
              "The Custom-build request resolution is invalid."
            )
          );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/change-completion$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before opening Custom-build change and completion tools.",
            { status: 401 }
          );
          const query = exactRouteQuery(
            url,
            ["organizationId"],
            "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
            "The Custom-build change and completion query is invalid."
          );
          result = await customServicesCustomBuildChangeCompletionBoundary
            .readOwner(actor, route[0], query.organizationId);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/change-orders$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before issuing a Custom-build change order.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
            "The Custom-build change-order query is invalid."
          );
          result = await customServicesCustomBuildChangeCompletionBoundary
            .issueChangeOrder(
              actor,
              route[0],
              exactRouteBody(
                write,
                [
                  "addedScope",
                  "commandId",
                  "expiresAt",
                  "organizationId",
                  "targetCompletionDate",
                  "unitCount"
                ],
                "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
                "The Custom-build change order is invalid."
              )
            );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/change-orders\/([^/]+)\/void$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before voiding a Custom-build change order.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
            "The Custom-build change-order query is invalid."
          );
          result = await customServicesCustomBuildChangeCompletionBoundary
            .voidChangeOrder(
              actor,
              route[0],
              route[1],
              exactRouteBody(
                write,
                [
                  "commandId",
                  "expectedQuoteDigest",
                  "organizationId",
                  "reason"
                ],
                "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
                "The Custom-build change-order void is invalid."
              )
            );
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/change-orders\/([^/]+)\/expiration$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before expiring a Custom-build change order.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
            "The Custom-build change-order expiration query is invalid."
          );
          result = await customServicesCustomBuildChangeCompletionBoundary
            .expireChangeOrder(
              actor,
              route[0],
              route[1],
              exactRouteBody(
                write,
                ["commandId", "expectedQuoteDigest", "organizationId"],
                "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
                "The Custom-build change-order expiration is invalid."
              )
            );
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/completion-evidence$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before uploading Custom-build completion evidence.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
            "The Custom-build completion-evidence query is invalid."
          );
          result = await customServicesCustomBuildChangeCompletionBoundary
            .uploadEvidence(
              actor,
              route[0],
              exactRouteBody(
                write,
                [
                  "accessibleDescription",
                  "commandId",
                  "dataBase64",
                  "mediaType",
                  "organizationId",
                  "viewport"
                ],
                "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
                "The Custom-build completion evidence is invalid."
              )
            );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-jobs\/([^/]+)\/completion$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before recording Custom-build completion.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
            "The Custom-build completion query is invalid."
          );
          result = await customServicesCustomBuildChangeCompletionBoundary
            .recordCompletion(
              actor,
              route[0],
              exactRouteBody(
                write,
                [
                  "checks",
                  "commandId",
                  "customerSummary",
                  "evidenceIds",
                  "organizationId"
                ],
                "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
                "The Custom-build completion is invalid."
              )
            );
          status = 201;
        } else if (
          method === "GET" &&
          pathname ===
            "/api/v1/operator/custom-services/custom-build-opportunities"
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before opening Custom build quote tools.",
            { status: 401 }
          );
          result =
            await customServicesCustomBuildBoundary.listOpportunities(actor);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/assessment-jobs\/([^/]+)\/custom-build-quote$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before issuing a Custom build quote.",
            { status: 401 }
          );
          result =
            await customServicesCustomBuildBoundary.issueQuote(
              actor,
              route[0],
              exactRouteBody(
                write,
                [
                  "commandId",
                  "contentWords",
                  "creditSelection",
                  "craftedPages",
                  "expiresAt",
                  "organizationId",
                  "scopeStatement",
                  "sections",
                  "suppliedMedia",
                  "targetCompletionDate",
                  "tierId",
                  "uniqueLayouts"
                ],
                "INVALID_CUSTOM_BUILD_QUOTE",
                "The Custom build quote is invalid."
              )
            );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-opportunities\/([^/]+)\/quote$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before issuing a direct Custom build quote.",
            { status: 401 }
          );
          result =
            await customServicesCustomBuildBoundary.issueDirectQuote(
              actor,
              route[0],
              exactRouteBody(
                write,
                [
                  "commandId",
                  "contentWords",
                  "craftedPages",
                  "creditSelection",
                  "expiresAt",
                  "organizationId",
                  "scopeStatement",
                  "sections",
                  "suppliedMedia",
                  "targetCompletionDate",
                  "tierId",
                  "uniqueLayouts"
                ],
                "INVALID_CUSTOM_BUILD_QUOTE",
                "The direct Custom build quote is invalid."
              )
            );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/custom-build-quotes\/([^/]+)\/void$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before voiding a Custom build quote.",
            { status: 401 }
          );
          result =
            await customServicesCustomBuildBoundary.voidQuote(
              actor,
              route[0],
              exactRouteBody(
                write,
                ["commandId", "organizationId", "reason"],
                "INVALID_CUSTOM_BUILD_QUOTE_VOID",
                "The Custom build quote void request is invalid."
              )
            );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/assessment-jobs\/([^/]+)\/evidence\/([^/]+)$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing assessment evidence.",
            { status: 401 }
          );
          return privateEvidence(
            await customServicesAssessmentWorkBoundary.readOwnerEvidence(
              actor,
              route[0],
              route[1]
            ),
            requestId
          );
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/assessment-jobs\/([^/]+)\/evidence$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before recording assessment evidence.",
            { status: 401 }
          );
          result =
            await customServicesAssessmentWorkBoundary.uploadEvidence(
              actor,
              route[0],
              exactRouteBody(
                write,
                [
                  "accessibleDescription",
                  "bytesBase64",
                  "commandId",
                  "mediaType",
                  "organizationId",
                  "reviewTarget",
                  "viewport"
                ],
                "INVALID_ASSESSMENT_EVIDENCE",
                "The assessment evidence upload is invalid."
              )
            );
          status = 201;
        } else if (
          method === "PUT" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/assessment-jobs\/([^/]+)\/findings\/([^/]+)$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before recording an assessment finding.",
            { status: 401 }
          );
          result =
            await customServicesAssessmentWorkBoundary.putFinding(
              actor,
              route[0],
              route[1],
              exactRouteBody(
                write,
                [
                  "category",
                  "commandId",
                  "evidenceIds",
                  "expectedRevision",
                  "included",
                  "organizationId",
                  "primaryTarget",
                  "recommendation",
                  "severity",
                  "summary",
                  "viewports"
                ],
                "INVALID_ASSESSMENT_FINDING",
                "The assessment finding is invalid."
              )
            );
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/operator\/custom-services\/assessment-jobs\/([^/]+)\/delivery$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before delivering an assessment report.",
            { status: 401 }
          );
          result =
            await customServicesAssessmentWorkBoundary.deliverReport(
              actor,
              route[0],
              exactRouteBody(
                write,
                [
                  "commandId",
                  "expectedWorkDigest",
                  "organizationId",
                  "overallSummary"
                ],
                "INVALID_ASSESSMENT_DELIVERY",
                "The assessment delivery is invalid."
              )
            );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/assessment-invoices\/([^/]+)\/checkout-command$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before paying an assessment invoice.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary
              .createAssessmentCheckout(
                actor,
                route[0],
                route[1],
                exactRouteBody(
                  write,
                  ["commandId", "invoiceDigest"],
                  "INVALID_ASSESSMENT_CHECKOUT",
                  "The assessment invoice checkout request is invalid."
                )
              );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-invoices\/([^/]+)\/checkout-command$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before paying a Custom build invoice.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary
              .createCustomBuildCheckout(
                actor,
                route[0],
                route[1],
                exactRouteBody(
                  write,
                  ["commandId", "invoiceDigest"],
                  "INVALID_CUSTOM_BUILD_CHECKOUT",
                  "The Custom build invoice checkout request is invalid."
                )
              );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-change-invoices\/([^/]+)\/checkout-command$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before paying a Custom-build change invoice.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_CHANGE_PAYMENT_INPUT",
            "The Custom-build change payment query is invalid."
          );
          result = await customServicesAccountBoundary
            .createCustomBuildChangeCheckout(
              actor,
              route[0],
              route[1],
              exactRouteBody(
                write,
                ["commandId", "invoiceDigest"],
                "INVALID_CUSTOM_BUILD_CHANGE_PAYMENT_INPUT",
                "The Custom-build change invoice checkout request is invalid."
              )
            );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-final-invoices\/([^/]+)\/checkout-command$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before paying a Custom-build final invoice.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_FINAL_PAYMENT_INPUT",
            "The Custom-build final payment query is invalid."
          );
          result = await customServicesAccountBoundary
            .createCustomBuildFinalCheckout(
              actor,
              route[0],
              route[1],
              exactRouteBody(
                write,
                ["commandId", "invoiceDigest"],
                "INVALID_CUSTOM_BUILD_FINAL_PAYMENT_INPUT",
                "The Custom-build final invoice checkout request is invalid."
              )
            );
          status = 201;
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/assessment-evidence\/([^/]+)$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing assessment evidence.",
            { status: 401 }
          );
          return privateEvidence(
            await customServicesAccountBoundary.getAssessmentEvidence(
              actor,
              route[0],
              route[1]
            ),
            requestId
          );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/assessment-report$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing an assessment report.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary.getAssessmentReport(
              actor,
              route[0]
            );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing Alakazam billing.",
            { status: 401 }
          );
          result =
            await alakazamAccountBoundary.getSnapshot(
              actor,
              route[0]
            );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/35$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam $35 controls.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_35_ROUTE_BINDING_REJECTED",
            "Alakazam $35 controls accept no query parameters."
          );
          result = await alakazam35Boundary.getSnapshot(
            actor,
            route[0]
          );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/50$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam $50 controls.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_50_ROUTE_BINDING_REJECTED",
            "Alakazam $50 controls accept no query parameters."
          );
          result = await alakazam50Boundary.getSnapshot(
            actor,
            route[0]
          );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/premium$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing retained Alakazam premium configuration.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_RETAINED_PREMIUM_ROUTE_BINDING_REJECTED",
            "Retained Alakazam premium controls accept no query parameters."
          );
          result =
            await alakazamRetainedPremiumBoundary.getSnapshot(
              actor,
              route[0]
            );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/premium\/export$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before exporting retained Alakazam premium configuration.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_RETAINED_PREMIUM_ROUTE_BINDING_REJECTED",
            "Retained Alakazam premium exports accept no query parameters."
          );
          result =
            await alakazamRetainedPremiumBoundary.getExport(
              actor,
              route[0]
            );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/publication$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing Alakazam publication.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_PUBLICATION_ROUTE_BINDING_REJECTED",
            "Alakazam publication accepts no query parameters."
          );
          result =
            await alakazamPublicationBoundary.getSnapshot(
              actor,
              route[0]
            );
        } else if (
          (alakazamBillingSurface =
            matchAlakazamBillingSurfaceRoute(
              method,
              pathname
            ))
        ) {
          result = await readAlakazamBillingSurface(
            alakazamBillingSurfacesBoundary,
            actor,
            alakazamBillingSurface,
            url
          );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/assessment-request$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing an assessment request.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary.getAssessmentRequest(
              actor,
              route[0]
            );
        } else if (
          method === "PUT" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/assessment-request$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before saving an assessment request.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary.saveAssessmentRequest(
              actor,
              route[0],
              exactRouteBody(
                write,
                [
                  "approximatePublicSize",
                  "businessName",
                  "commandId",
                  "complexityFlags",
                  "customerObservation",
                  "customerOwnershipAffirmed",
                  "expectedDraftRevision",
                  "importantDate",
                  "platformFamily",
                  "primaryGoal",
                  "publicUrl",
                  "siteDisplayName"
                ],
                "INVALID_ASSESSMENT_REQUEST",
                "The assessment request details are invalid."
              )
            );
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/publication-commands$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam publication.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_PUBLICATION_ROUTE_BINDING_REJECTED",
            "Alakazam publication commands accept no query parameters."
          );
          const publicationBody = exactRouteBody(
            body,
            [
              "action",
              "snapshotDigest",
              "targetReleaseId"
            ],
            "ALAKAZAM_PUBLICATION_ROUTE_BINDING_REJECTED",
            "The Alakazam publication command is invalid."
          );
          result =
            await alakazamPublicationBoundary.requestCommand(
              actor,
              route[0],
              {
                ...publicationBody,
                commandId: write.commandId
              }
            );
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/assessment-request\/submission$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before submitting an assessment request.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary.submitAssessmentRequest(
              actor,
              route[0],
              exactRouteBody(
                write,
                ["commandId", "draftRevision"],
                "INVALID_ASSESSMENT_REQUEST_SUBMISSION",
                "The assessment request submission is invalid."
              )
            );
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/assessment-request\/withdrawal$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before withdrawing an assessment request.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary.withdrawAssessmentRequest(
              actor,
              route[0],
              exactRouteBody(
                write,
                ["commandId"],
                "INVALID_ASSESSMENT_REQUEST_WITHDRAWAL",
                "The assessment request withdrawal is invalid."
              )
            );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/assessment-quote$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing an assessment quote.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary.getAssessmentQuote(
              actor,
              route[0]
            );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/assessment-invoice$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing an assessment invoice.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary.getAssessmentInvoice(
              actor,
              route[0]
            );
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/assessment-quote\/acceptance$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before accepting an assessment quote.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary.acceptAssessmentQuote(
              actor,
              route[0],
              exactRouteBody(
                write,
                [
                  "acceptanceStatement",
                  "acceptedDisclosureDigest",
                  "acceptedQuoteDigest",
                  "commandId",
                  "quoteId",
                  "quoteRevision"
                ],
                "INVALID_ASSESSMENT_QUOTE_ACCEPTANCE",
                "The assessment quote acceptance is invalid."
              )
            );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-quote$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing a Custom build quote.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary.getCustomBuildQuote(
              actor,
              route[0]
            );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-invoice$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing a Custom build invoice.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary.getCustomBuildInvoice(
              actor,
              route[0]
            );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-change-invoice$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing a Custom-build change invoice.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_CHANGE_PAYMENT_INPUT",
            "The Custom-build change payment query is invalid."
          );
          result = await customServicesAccountBoundary
            .getCustomBuildChangeInvoice(actor, route[0]);
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-final-handoff$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing Custom-build final payment and handoff.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_FINAL_PAYMENT_INPUT",
            "The Custom-build final payment query is invalid."
          );
          result = await customServicesAccountBoundary
            .getCustomBuildFinalHandoff(actor, route[0]);
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-handoff-documents\/([^/]+)$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before opening a Custom-build handoff document.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_HANDOFF_INPUT",
            "The Custom-build handoff document query is invalid."
          );
          result = await customServicesAccountBoundary
            .getCustomBuildHandoffDocument(actor, route[0], route[1]);
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-progress$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing Custom-build progress.",
            { status: 401 }
          );
          result = await customServicesAccountBoundary.getCustomBuildProgress(
            actor,
            route[0]
          );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-change-completion$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing Custom-build changes and completion.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
            "The Custom-build change and completion query is invalid."
          );
          result = await customServicesAccountBoundary
            .getCustomBuildChangeCompletion(actor, route[0]);
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-completion-evidence\/([^/]+)$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing Custom-build completion evidence.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
            "The Custom-build completion-evidence query is invalid."
          );
          return privateEvidence(
            await customServicesAccountBoundary
              .getCustomBuildCompletionEvidence(
                actor,
                route[0],
                route[1]
              ),
            requestId
          );
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-change-orders\/([^/]+)\/acceptance$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before accepting a Custom-build change order.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
            "The Custom-build change-order query is invalid."
          );
          result = await customServicesAccountBoundary
            .acceptCustomBuildChangeOrder(
              actor,
              route[0],
              route[1],
              exactRouteBody(
                write,
                [
                  "acceptanceStatement",
                  "acceptedDisclosureDigest",
                  "acceptedQuoteDigest",
                  "commandId"
                ],
                "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
                "The Custom-build change-order acceptance is invalid."
              )
            );
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-change-orders\/([^/]+)\/decline$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before declining a Custom-build change order.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
            "The Custom-build change-order query is invalid."
          );
          result = await customServicesAccountBoundary
            .declineCustomBuildChangeOrder(
              actor,
              route[0],
              route[1],
              exactRouteBody(
                write,
                [
                  "commandId",
                  "declineStatement",
                  "declinedDisclosureDigest",
                  "declinedQuoteDigest"
                ],
                "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_INPUT",
                "The Custom-build change-order decline is invalid."
              )
            );
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-requests\/([^/]+)\/response$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before responding to a Custom-build request.",
            { status: 401 }
          );
          result = await customServicesAccountBoundary
            .respondToCustomBuildRequest(
              actor,
              route[0],
              route[1],
              exactRouteBody(
                write,
                [
                  "commandId",
                  "expectedRevision",
                  "responseKind",
                  "responseNote"
                ],
                "INVALID_CUSTOM_BUILD_PROGRESS_INPUT",
                "The Custom-build response is invalid."
              )
            );
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services\/custom-build-quote\/acceptance$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before accepting a Custom build quote.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary.acceptCustomBuildQuote(
              actor,
              route[0],
              exactRouteBody(
                write,
                [
                  "acceptanceStatement",
                  "acceptedDisclosureDigest",
                  "acceptedQuoteDigest",
                  "commandId",
                  "quoteId",
                  "quoteRevision"
                ],
                "INVALID_CUSTOM_BUILD_QUOTE_ACCEPTANCE",
                "The Custom build quote acceptance is invalid."
              )
            );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing custom services.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary.getSnapshot(
              actor,
              route[0]
            );
        } else if (
          method === "GET" &&
          pathname === "/api/v1/legal/project-authority"
        ) {
          invariant(
            typeof service.getProjectLegalAuthority === "function",
            "RUNTIME_CONFIGURATION_ERROR",
            "Project legal authority is unavailable.",
            { status: 500 }
          );
          result = await service.getProjectLegalAuthority();
        } else if (
          method === "GET" &&
          (route = match(pathname, /^\/api\/v1\/organizations\/([^/]+)\/projects$/u))
        ) {
          result = await service.listProjects(actor, route[0]);
        } else if (
          method === "POST" &&
          (route = match(pathname, /^\/api\/v1\/organizations\/([^/]+)\/projects$/u))
        ) {
          invariant(
            typeof service.projectCreationLegalReadiness === "function" &&
              await service.projectCreationLegalReadiness(),
            "LEGAL_CONFIGURATION_REQUIRED",
            "Project creation is held while reviewed legal authority is installed.",
            { status: 503 }
          );
          result = await service.createProject(actor, route[0], {
            ...exactProjectCreateBody(body),
            commandId: commandId(request),
            userAgentDigest: digestUserAgent(
              request.headers.get("user-agent")
            )
          });
          status = 201;
        } else if (
          method === "GET" &&
          (route = match(pathname, /^\/api\/v1\/projects\/([^/]+)$/u))
        ) {
          result = await service.getProject(actor, route[0]);
        } else if (
          method === "PUT" &&
          (route = match(pathname, /^\/api\/v1\/projects\/([^/]+)\/draft$/u))
        ) {
          result = await service.saveDraft(actor, route[0], {
            ...write,
            expectedRevision: expectedRevision(request)
          });
        } else if (
          method === "POST" &&
          (route = match(pathname, /^\/api\/v1\/projects\/([^/]+)\/versions$/u))
        ) {
          result = await service.createVersion(actor, route[0], write);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/versions\/([^/]+)\/ready$/u
          ))
        ) {
          result = await service.markVersionReady(actor, route[0], route[1], write);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/versions\/([^/]+)\/accept$/u
          ))
        ) {
          result = await service.acceptVersion(actor, route[0], route[1], write);
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/versions\/([^/]+)\/download$/u
          ))
        ) {
          const download =
            await downloadBoundary.download(
              actor,
              route[0],
              route[1]
            );
          return new Response(download.bytes, {
            status: 200,
            headers: {
              "Cache-Control": "no-store",
              "Content-Disposition":
                `attachment; filename="${download.filename.replace(/[^A-Za-z0-9._-]/gu, "_")}"`,
              "Content-Type":
                "text/html; charset=utf-8",
              "Digest":
                `sha-256=${Buffer.from(download.sha256, "hex").toString("base64")}`,
              "Referrer-Policy": "no-referrer",
              "X-Content-Type-Options": "nosniff",
              "X-Request-Id": requestId
            }
          });
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/addresses\/(licensed|custom)$/u
          ))
        ) {
          result = await service.selectAddress(actor, route[0], {
            ...write,
            kind: route[1]
          });
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/addresses\/([^/]+)\/verification-requests$/u
          ))
        ) {
          result = await service.requestAddressVerification(
            actor,
            route[0],
            route[1],
            write
          );
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/35\/photos$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam $35 controls.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_35_ROUTE_BINDING_REJECTED",
            "Alakazam $35 photo uploads accept no query parameters."
          );
          const selected = exactRouteBody(
            body,
            ["mediaBase64", "mediaType"],
            "ALAKAZAM_35_ROUTE_BINDING_REJECTED",
            "The Alakazam $35 photo upload is invalid."
          );
          result = await alakazam35Boundary.uploadPhoto(
            actor,
            route[0],
            {
              ...selected,
              commandId: write.commandId
            }
          );
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/35\/configurations$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam $35 controls.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_35_ROUTE_BINDING_REJECTED",
            "Alakazam $35 configurations accept no query parameters."
          );
          const selected = exactRouteBody(
            body,
            [
              "expectedCurrentRevision",
              "fontChoiceId",
              "photoAssetId",
              "sections"
            ],
            "ALAKAZAM_35_ROUTE_BINDING_REJECTED",
            "The Alakazam $35 configuration is invalid."
          );
          result = await alakazam35Boundary.saveConfiguration(
            actor,
            route[0],
            {
              ...selected,
              commandId: write.commandId
            }
          );
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/35\/care-requests$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam $35 controls.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_35_ROUTE_BINDING_REJECTED",
            "Alakazam $35 care requests accept no query parameters."
          );
          const selected = exactRouteBody(
            body,
            ["message"],
            "ALAKAZAM_35_ROUTE_BINDING_REJECTED",
            "The Alakazam $35 care request is invalid."
          );
          result = await alakazam35Boundary.requestCare(
            actor,
            route[0],
            {
              ...selected,
              commandId: write.commandId
            }
          );
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/50\/configurations$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam $50 controls.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_50_ROUTE_BINDING_REJECTED",
            "Alakazam $50 configurations accept no query parameters."
          );
          const selected = exactRouteBody(
            body,
            [
              "borderChoiceId",
              "cashAppHandle",
              "expectedCurrentRevision",
              "fontChoiceId",
              "menu",
              "venmoHandle"
            ],
            "ALAKAZAM_50_ROUTE_BINDING_REJECTED",
            "The Alakazam $50 configuration is invalid."
          );
          result = await alakazam50Boundary.saveConfiguration(
            actor,
            route[0],
            {
              ...selected,
              commandId: write.commandId
            }
          );
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/50\/care-requests$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam $50 controls.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_50_ROUTE_BINDING_REJECTED",
            "Alakazam $50 care requests accept no query parameters."
          );
          const selected = exactRouteBody(
            body,
            ["message"],
            "ALAKAZAM_50_ROUTE_BINDING_REJECTED",
            "The Alakazam $50 care request is invalid."
          );
          result = await alakazam50Boundary.requestCare(
            actor,
            route[0],
            {
              ...selected,
              commandId: write.commandId
            }
          );
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/premium\/restorations$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before restoring retained Alakazam premium configuration.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_RETAINED_PREMIUM_ROUTE_BINDING_REJECTED",
            "Retained Alakazam premium restoration accepts no query parameters."
          );
          const selected = exactRouteBody(
            body,
            [
              "expectedSourceConfigurationDigest",
              "expectedSubscriptionRevision"
            ],
            "ALAKAZAM_RETAINED_PREMIUM_ROUTE_BINDING_REJECTED",
            "The retained Alakazam premium restoration is invalid."
          );
          result =
            await alakazamRetainedPremiumBoundary.restoreConfiguration(
              actor,
              route[0],
              {
                ...selected,
                commandId: write.commandId
              }
            );
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam-quotes$/u
          ))
        ) {
          result = await alakazamBillingBoundary.createQuote(
            actor,
            route[0],
            write
          );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam-quotes\/([^/]+)\/downgrade-schedule-command$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before using Alakazam billing.",
            { status: 401 }
          );
          const downgradeBody = exactRouteBody(
            body,
            [
              "acceptedDisclosureDigest",
              "quoteDigest"
            ],
            "ALAKAZAM_ROUTE_BINDING_REJECTED",
            "Alakazam downgrade scheduling accepts only the accepted disclosure and quote proof."
          );
          result =
            await alakazamBillingBoundary.scheduleDowngrade(
              actor,
              route[0],
              route[1],
              {
                ...downgradeBody,
                commandId: write.commandId
              }
            );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam-quotes\/([^/]+)\/checkout-command$/u
          ))
        ) {
          result =
            await alakazamBillingBoundary.createCheckout(
              actor,
              route[0],
              route[1],
              write
            );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/download-quotes$/u
          ))
        ) {
          result = await downloadBoundary.createQuote(
            actor,
            route[0],
            write
          );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/download-quotes\/([^/]+)\/checkout-command$/u
          ))
        ) {
          result =
            await downloadBoundary.prepareCheckout(
              actor,
              route[0],
              route[1],
              write
            );
          status = 201;
        } else if (
          method === "GET" &&
          (pathname === "/api/v1/offers" || pathname === "/api/v1/offer-catalog")
        ) {
          result = await service.getOfferCatalog();
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/(?:quotes|commerce-quotes)$/u
          ))
        ) {
          result = await service.createCommerceQuote(actor, route[0], write);
          status = 201;
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/(?:quotes|commerce-quotes)\/([^/]+)$/u
          ))
        ) {
          result = await service.getCommerceQuote(actor, route[0], route[1]);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/commerce-quotes\/([^/]+)\/checkout$/u
          ))
        ) {
          result = await service.createCheckout(actor, route[0], {
            ...write,
            quoteId: route[1]
          });
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/checkout-intents$/u
          ))
        ) {
          invariant(
            !Object.hasOwn(write, "priceId"),
            "CLIENT_PRICE_AUTHORITY_REJECTED",
            "Checkout requires an authoritative server quote, not a browser price ID.",
            { status: 400 }
          );
          result = await service.createCheckout(actor, route[0], write);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/billing-portal-sessions$/u
          ))
        ) {
          result = await service.createBillingPortal(actor, route[0], write);
          status = 201;
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/subscription$/u
          ))
        ) {
          result = await service.getSubscription(actor, route[0]);
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/subscription\/cancellation-preview$/u
          ))
        ) {
          result = await service.getCancellationPreview(actor, route[0]);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/subscription\/cancel$/u
          ))
        ) {
          result = await service.cancelSubscription(actor, route[0], write);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/release-requests$/u
          ))
        ) {
          result = await service.requestRelease(actor, route[0], write);
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/versions\/([^/]+)\/rollback$/u
          ))
        ) {
          result = await service.rollbackRelease(
            actor,
            route[0],
            route[1],
            write
          );
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(pathname, /^\/api\/v1\/projects\/([^/]+)\/unpublish$/u))
        ) {
          result = await service.unpublish(actor, route[0], write);
          status = 202;
        } else if (
          method === "PUT" &&
          (route = match(pathname, /^\/api\/v1\/projects\/([^/]+)\/visibility$/u))
        ) {
          result = await service.setVisibility(actor, route[0], write);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/support-tickets$/u
          ))
        ) {
          result = await service.createSupportTicket(actor, route[0], write);
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(pathname, /^\/api\/v1\/projects\/([^/]+)\/exports$/u))
        ) {
          result = await service.requestExport(actor, route[0], write);
          status = 202;
          const exportId = result.export.exportId;
          queueMicrotask(() => {
            service.processExport(exportId).catch(() => {});
          });
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/exports\/([^/]+)$/u
          ))
        ) {
          result = await service.getExport(actor, route[0], route[1]);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/exports\/([^/]+)\/retry$/u
          ))
        ) {
          result = await service.retryExport(actor, route[0], route[1], write);
          status = 202;
          const exportId = result.export.exportId;
          queueMicrotask(() => {
            service.processExport(exportId).catch(() => {});
          });
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/exports\/([^/]+)\/download$/u
          ))
        ) {
          const download = await service.downloadExport(
            actor,
            route[0],
            route[1],
            url.searchParams.get("token")
          );
          return new Response(download.bytes, {
            status: 200,
            headers: {
              "Cache-Control": "no-store",
              "Content-Disposition": `attachment; filename="${download.filename.replace(/[^A-Za-z0-9._-]/gu, "_")}"`,
              "Content-Type": "application/zip",
              "Digest": `sha-256=${Buffer.from(download.sha256, "hex").toString("base64")}`,
              "Referrer-Policy": "no-referrer",
              "X-Content-Type-Options": "nosniff",
              "X-Request-Id": requestId
            }
          });
        } else if (
          method === "DELETE" &&
          (route = match(pathname, /^\/api\/v1\/projects\/([^/]+)$/u))
        ) {
          result = await service.deleteProject(actor, route[0], write);
        } else if (method === "GET" && pathname === "/api/v1/domains/search") {
          result = await service.searchDomains(actor, url.searchParams.get("query"));
        } else if (method === "POST" && pathname === "/api/v1/domain-quotes") {
          result = await service.createDomainQuote(actor, write);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/organizations\/([^/]+)\/registrant-contacts$/u
          ))
        ) {
          result = await service.saveRegistrantContact(actor, route[0], write);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domain-quotes\/([^/]+)\/consents$/u
          ))
        ) {
          result = await service.acceptDomainConsent(actor, route[0], write);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/domain-orders$/u
          ))
        ) {
          result = await service.createDomainOrder(actor, route[0], write);
          status = 201;
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domain-orders\/([^/]+)\/payment$/u
          ))
        ) {
          const redirect =
            await service.getDomainPaymentRedirect(
              actor,
              route[0],
              url.searchParams.get("projectId")
            );
          return new Response(null, {
            status: 303,
            headers: {
              "Cache-Control": "no-store",
              "Location": redirect.url,
              "Referrer-Policy": "no-referrer",
              "X-Content-Type-Options": "nosniff",
              "X-Request-Id": requestId
            }
          });
        } else if (
          method === "GET" &&
          (route = match(pathname, /^\/api\/v1\/domain-orders\/([^/]+)$/u))
        ) {
          result = await service.getDomainOrder(
            actor,
            route[0],
            url.searchParams.get("projectId")
          );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/domain-orders$/u
          ))
        ) {
          result = await service.listDomainOrders(actor, route[0]);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domain-orders\/([^/]+)\/price-checks$/u
          ))
        ) {
          result = await service.refreshDomainPrice(actor, route[0], write);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domain-orders\/([^/]+)\/registration-requests$/u
          ))
        ) {
          result = await service.requestDomainRegistration(actor, route[0], write);
          status = 202;
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/organizations\/([^/]+)\/domains$/u
          ))
        ) {
          result = await service.listDomains(
            actor,
            route[0],
            url.searchParams.get("projectId")
          );
        } else if (
          method === "GET" &&
          (route = match(pathname, /^\/api\/v1\/domains\/([^/]+)$/u))
        ) {
          result = await service.getDomain(
            actor,
            route[0],
            url.searchParams.get("projectId")
          );
        } else if (
          method === "GET" &&
          (route = match(pathname, /^\/api\/v1\/domains\/([^/]+)\/dns-records$/u))
        ) {
          result = await service.listDnsRecords(
            actor,
            route[0],
            url.searchParams.get("projectId")
          );
        } else if (
          method === "PUT" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domains\/([^/]+)\/dns-records\/([^/]+)$/u
          ))
        ) {
          result = await service.upsertDnsRecord(actor, route[0], route[1], write);
        } else if (
          method === "DELETE" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domains\/([^/]+)\/dns-records\/([^/]+)$/u
          ))
        ) {
          result = await service.deleteDnsRecord(actor, route[0], route[1], write);
        } else if (
          method === "PUT" &&
          (route = match(pathname, /^\/api\/v1\/domains\/([^/]+)\/auto-renew$/u))
        ) {
          result = await service.setDomainAutoRenew(actor, route[0], write);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domains\/([^/]+)\/renewal-quotes$/u
          ))
        ) {
          result = await service.requestDomainRenewalQuote(actor, route[0], write);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domains\/([^/]+)\/transfer-out-requests$/u
          ))
        ) {
          result = await service.requestDomainTransferOut(actor, route[0], write);
          status = 202;
        } else {
          throw new HostedError("NOT_FOUND", "The requested route was not found.", {
            status: 404
          });
        }

        return json(result, status, headers);
      } catch (error) {
        const presented = publicError(error, requestId);
        return json(presented.body, presented.status, {
          "X-Request-Id": requestId
        });
      }
    }
  });
}
