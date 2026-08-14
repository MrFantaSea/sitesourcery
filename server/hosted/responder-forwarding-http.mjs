import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson } from "./security.mjs";

const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID = new RegExp(`^${UUID_SOURCE}$`, "u");
const SHA256 = /^[0-9a-f]{64}$/u;
const E164 = /^\+[1-9][0-9]{1,14}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const OBSERVATION_KINDS = new Set([
  "carrier_setup_attested",
  "unanswered_forwarding_reached",
  "answered_call_not_forwarded",
  "reply_path_confirmed",
  "stop_path_confirmed",
  "routing_ambiguous"
]);
const EVENT_OBSERVATIONS = new Set([
  "unanswered_forwarding_reached",
  "reply_path_confirmed",
  "stop_path_confirmed"
]);
const RETIRED_REASONS = new Set([
  "customer_cancelled", "binding_replaced", "operator_correction",
  "carrier_route_removed"
]);
const MAX_BODY_BYTES = 16 * 1024;

export const RESPONDER_FORWARDING_HTTP_ROUTES = deepFreeze([
  {
    method: "GET",
    pattern: "/api/v1/responder/projects/:projectId/forwarding",
    audience: "customer",
    operation: "list"
  },
  {
    method: "POST",
    pattern: "/api/v1/responder/projects/:projectId/forwarding",
    audience: "customer",
    operation: "create"
  },
  {
    method: "POST",
    pattern:
      "/api/v1/responder/projects/:projectId/forwarding/:onboardingId/retire",
    audience: "customer",
    operation: "retire"
  },
  {
    method: "GET",
    pattern:
      "/api/v1/operator/responder/organizations/:organizationId/projects/:projectId/forwarding",
    audience: "operator",
    operation: "list"
  },
  {
    method: "POST",
    pattern:
      "/api/v1/operator/responder/organizations/:organizationId/projects/:projectId/forwarding",
    audience: "operator",
    operation: "create"
  },
  {
    method: "POST",
    pattern:
      "/api/v1/operator/responder/organizations/:organizationId/projects/:projectId/forwarding/:onboardingId/observations",
    audience: "operator",
    operation: "observe"
  },
  {
    method: "POST",
    pattern:
      "/api/v1/operator/responder/organizations/:organizationId/projects/:projectId/forwarding/:onboardingId/retire",
    audience: "operator",
    operation: "retire"
  }
]);

const MATCHERS = RESPONDER_FORWARDING_HTTP_ROUTES.map((route) => {
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

export function matchResponderForwardingHttpRoute(method, pathname) {
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

function exactKeys(value, keys, message) {
  invariant(
    canonicalJson(Object.keys(value).sort()) ===
      canonicalJson([...keys].sort()),
    "RESPONDER_FORWARDING_INVALID",
    message,
    { status: 400 }
  );
  return value;
}

async function body(request) {
  invariant(
    String(request.headers.get("content-type") ?? "")
      .toLowerCase().startsWith("application/json"),
    "RESPONDER_FORWARDING_INVALID",
    "Responder forwarding commands require JSON.",
    { status: 415 }
  );
  const declared = request.headers.get("content-length");
  invariant(
    declared === null ||
      (/^\d{1,8}$/u.test(declared) && Number(declared) <= MAX_BODY_BYTES),
    "RESPONDER_FORWARDING_INVALID",
    "The Responder forwarding body is too large.",
    { status: 413 }
  );
  const text = await request.text();
  invariant(
    Buffer.byteLength(text, "utf8") <= MAX_BODY_BYTES,
    "RESPONDER_FORWARDING_INVALID",
    "The Responder forwarding body is too large.",
    { status: 413 }
  );
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  invariant(
    parsed !== null && typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.getPrototypeOf(parsed) === Object.prototype,
    "RESPONDER_FORWARDING_INVALID",
    "The Responder forwarding body is invalid.",
    { status: 400 }
  );
  return parsed;
}

function now(clock) {
  const value = clock?.now?.();
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "RESPONDER_FORWARDING_CONFIGURATION_REQUIRED",
    "The Responder forwarding clock is invalid.",
    { status: 500 }
  );
  return value;
}

function command(request) {
  const value = request.headers.get("idempotency-key");
  invariant(
    typeof value === "string" && COMMAND_ID.test(value),
    "IDEMPOTENCY_KEY_REQUIRED",
    "An idempotency key is required.",
    { status: 400 }
  );
  return value;
}

function createInput(route, actor, parsed, lookupDigests, randomUUID, clock) {
  const keys = route.audience === "operator"
    ? ["businessLine", "consentEvidenceDigest", "customerUserId",
        "numberBindingId"]
    : ["businessLine", "consentEvidenceDigest", "numberBindingId"];
  exactKeys(parsed, keys, "The forwarding onboarding body is invalid.");
  const customerUserId = route.audience === "operator"
    ? parsed.customerUserId
    : actor.userId;
  invariant(
    UUID.test(parsed.numberBindingId ?? "") &&
      UUID.test(customerUserId ?? "") &&
      typeof parsed.businessLine === "string" &&
      E164.test(parsed.businessLine) &&
      typeof parsed.consentEvidenceDigest === "string" &&
      SHA256.test(parsed.consentEvidenceDigest),
    "RESPONDER_FORWARDING_INVALID",
    "The forwarding onboarding body is invalid.",
    { status: 400 }
  );
  const candidates = lookupDigests.numberLookupCandidates(
    parsed.businessLine
  );
  return {
    onboardingId: randomUUID(),
    organizationId: actor.organizationId,
    projectId: route.params.projectId,
    customerUserId,
    numberBindingId: parsed.numberBindingId,
    businessLineLookupDigest: candidates[0].digest,
    businessLineLookupCandidateDigests:
      candidates.map((entry) => entry.digest),
    businessLineKeyVersion: candidates[0].keyVersion,
    consentEvidenceDigest: parsed.consentEvidenceDigest,
    recordedAt: now(clock)
  };
}

function observationInput(route, actor, parsed, clock) {
  exactKeys(parsed, [
    "expectedRevision", "observationKind", "inboundEventId",
    "evidenceDigest", "observedAt"
  ], "The forwarding observation body is invalid.");
  invariant(
    Number.isSafeInteger(parsed.expectedRevision) &&
      parsed.expectedRevision > 0 &&
      OBSERVATION_KINDS.has(parsed.observationKind) &&
      typeof parsed.evidenceDigest === "string" &&
      SHA256.test(parsed.evidenceDigest) &&
      typeof parsed.observedAt === "string" &&
      Number.isFinite(Date.parse(parsed.observedAt)) &&
      new Date(parsed.observedAt).toISOString() === parsed.observedAt &&
      (
        EVENT_OBSERVATIONS.has(parsed.observationKind)
          ? UUID.test(parsed.inboundEventId ?? "")
          : parsed.observationKind === "routing_ambiguous"
            ? parsed.inboundEventId === null ||
              UUID.test(parsed.inboundEventId ?? "")
            : parsed.inboundEventId === null
      ),
    "RESPONDER_FORWARDING_INVALID",
    "The forwarding observation body is invalid.",
    { status: 400 }
  );
  return {
    organizationId: actor.organizationId,
    projectId: route.params.projectId,
    onboardingId: route.params.onboardingId,
    expectedRevision: parsed.expectedRevision,
    observationKind: parsed.observationKind,
    inboundEventId: parsed.inboundEventId,
    evidenceDigest: parsed.evidenceDigest,
    observedAt: parsed.observedAt,
    recordedAt: now(clock)
  };
}

function retirementInput(route, actor, parsed, clock) {
  exactKeys(parsed, ["expectedRevision", "reason", "evidenceDigest"],
    "The forwarding retirement body is invalid.");
  invariant(
    Number.isSafeInteger(parsed.expectedRevision) &&
      parsed.expectedRevision > 0 &&
      RETIRED_REASONS.has(parsed.reason) &&
      typeof parsed.evidenceDigest === "string" &&
      SHA256.test(parsed.evidenceDigest) &&
      (route.audience === "operator" ||
        parsed.reason === "customer_cancelled"),
    "RESPONDER_FORWARDING_INVALID",
    "The forwarding retirement body is invalid.",
    { status: 400 }
  );
  return {
    organizationId: actor.organizationId,
    projectId: route.params.projectId,
    onboardingId: route.params.onboardingId,
    expectedRevision: parsed.expectedRevision,
    reason: parsed.reason,
    evidenceDigest: parsed.evidenceDigest,
    recordedAt: now(clock)
  };
}

export function createResponderForwardingHttpBoundary({
  repository,
  lookupDigests,
  authenticate,
  requireWriteGuard,
  randomUUID = systemRandomUUID,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  invariant(
    repository?.kind === "responder-forwarding-postgres" &&
      repository.mode === "held-local" &&
      repository.automaticCarrierCommands === false &&
      repository.remoteWriteEffects === false &&
      repository.providerEffects === false &&
      repository.messageSendEffects === false &&
      typeof repository.list === "function" &&
      typeof repository.create === "function" &&
      typeof repository.recordObservation === "function" &&
      typeof repository.retire === "function" &&
      lookupDigests?.kind === "responder-lookup-digests" &&
      typeof lookupDigests.numberLookupCandidates === "function" &&
      typeof authenticate === "function" &&
      typeof requireWriteGuard === "function" &&
      typeof randomUUID === "function" && typeof clock?.now === "function",
    "RESPONDER_FORWARDING_CONFIGURATION_REQUIRED",
    "Responder forwarding authentication and held storage are required.",
    { status: 500 }
  );

  return Object.freeze({
    kind: "responder-forwarding-http",
    mode: "held-local",
    automaticCarrierCommands: false,
    remoteWriteEffects: false,
    providerEffects: false,
    messageSendEffects: false,
    manifest: RESPONDER_FORWARDING_HTTP_ROUTES,
    match: matchResponderForwardingHttpRoute,
    async dispatch(request) {
      let url;
      try {
        url = new URL(request?.url);
      } catch {
        return null;
      }
      if (url.search || url.hash) return null;
      const route = matchResponderForwardingHttpRoute(
        request.method, url.pathname
      );
      if (!route) return null;
      const authenticated = await authenticate(request, route);
      invariant(
        authenticated !== null && authenticated !== undefined,
        "AUTHENTICATION_REQUIRED",
        "Sign in to continue.",
        { status: 401 }
      );
      const actor = Object.freeze({
        kind: route.audience,
        organizationId: route.audience === "operator"
          ? route.params.organizationId
          : authenticated.organizationId,
        userId: authenticated.userId
      });
      if (route.operation === "list") {
        return json(await repository.list(actor, {
          organizationId: actor.organizationId,
          projectId: route.params.projectId
        }));
      }
      invariant(
        await requireWriteGuard(request, authenticated) === true,
        "RESPONDER_FORWARDING_WRITE_GUARD_REQUIRED",
        "Responder forwarding write safety could not be verified.",
        { status: 403 }
      );
      const commandId = command(request);
      const parsed = await body(request);
      if (route.operation === "create") {
        return json(await repository.create(actor, {
          commandId,
          ...createInput(
            route, actor, parsed, lookupDigests, randomUUID, clock
          )
        }));
      }
      if (route.operation === "observe") {
        return json(await repository.recordObservation(actor, {
          commandId,
          ...observationInput(route, actor, parsed, clock)
        }));
      }
      return json(await repository.retire(actor, {
        commandId,
        ...retirementInput(route, actor, parsed, clock)
      }));
    }
  });
}

export function responderForwardingHttpError(error) {
  if (error instanceof HostedError) return error;
  return new HostedError(
    "RESPONDER_FORWARDING_UNAVAILABLE",
    "Responder forwarding is unavailable.",
    { status: 503 }
  );
}
