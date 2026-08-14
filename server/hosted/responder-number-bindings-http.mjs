import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID = new RegExp(`^${UUID_SOURCE}$`, "u");
const SHA256 = /^[0-9a-f]{64}$/u;
const E164 = /^\+[1-9][0-9]{1,14}$/u;
const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/u;
const PHONE_NUMBER_SID = /^PN[0-9a-fA-F]{32}$/u;
const MESSAGING_SERVICE_SID = /^MG[0-9a-fA-F]{32}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const VOICE_INGRESS_ROLES = new Set([
  "managed_front_door", "conditional_forward_destination"
]);
const RETIRED_REASONS = new Set([
  "reprovisioned", "customer_cancelled", "number_released",
  "operator_correction"
]);
const MAX_BODY_BYTES = 16 * 1024;

export const RESPONDER_NUMBER_BINDING_HTTP_ROUTES = deepFreeze([
  {
    method: "GET",
    pattern:
      "/api/v1/operator/responder/organizations/:organizationId/number-bindings",
    audience: "operator",
    operation: "list"
  },
  {
    method: "POST",
    pattern:
      "/api/v1/operator/responder/organizations/:organizationId/number-bindings",
    audience: "operator",
    operation: "provision"
  },
  {
    method: "POST",
    pattern:
      "/api/v1/operator/responder/organizations/:organizationId/number-bindings/:bindingId/retire",
    audience: "operator",
    operation: "retire"
  }
]);

const MATCHERS = RESPONDER_NUMBER_BINDING_HTTP_ROUTES.map((route) => {
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

export function matchResponderNumberBindingHttpRoute(method, pathname) {
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

function invalid(message) {
  return new HostedError("RESPONDER_NUMBER_BINDING_INVALID", message, {
    status: 400
  });
}

async function body(request) {
  invariant(
    String(request.headers.get("content-type") ?? "")
      .toLowerCase().startsWith("application/json"),
    "RESPONDER_NUMBER_BINDING_INVALID",
    "Responder number binding commands require JSON.",
    { status: 415 }
  );
  const declared = request.headers.get("content-length");
  invariant(
    declared === null ||
      (/^\d{1,8}$/u.test(declared) && Number(declared) <= MAX_BODY_BYTES),
    "RESPONDER_NUMBER_BINDING_INVALID",
    "The Responder number binding body is too large.",
    { status: 413 }
  );
  const text = await request.text();
  invariant(
    Buffer.byteLength(text, "utf8") <= MAX_BODY_BYTES,
    "RESPONDER_NUMBER_BINDING_INVALID",
    "The Responder number binding body is too large.",
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
    "RESPONDER_NUMBER_BINDING_INVALID",
    "The Responder number binding body is invalid.",
    { status: 400 }
  );
  return parsed;
}

function exactKeys(value, keys, message) {
  invariant(
    canonicalJson(Object.keys(value).sort()) ===
      canonicalJson([...keys].sort()),
    "RESPONDER_NUMBER_BINDING_INVALID",
    message,
    { status: 400 }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "RESPONDER_NUMBER_BINDING_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function currentTime(clock) {
  const value = clock?.now?.();
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "RESPONDER_NUMBER_BINDING_CONFIGURATION_REQUIRED",
    "The Responder number binding clock is invalid.",
    { status: 500 }
  );
  return value;
}

export function createResponderNumberBindingsHttpBoundary({
  repository,
  lookupDigests,
  authenticate,
  requireWriteGuard,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  invariant(
    repository?.kind === "responder-number-bindings-postgres" &&
      repository.providerEffects === false &&
      typeof repository.provisionBinding === "function" &&
      typeof repository.retireBinding === "function" &&
      typeof repository.listBindings === "function" &&
      lookupDigests?.kind === "responder-lookup-digests" &&
      typeof lookupDigests.numberLookupDigest === "function" &&
      typeof lookupDigests.numberLookupCandidates === "function" &&
      typeof authenticate === "function" &&
      typeof requireWriteGuard === "function" &&
      typeof clock?.now === "function",
    "RESPONDER_NUMBER_BINDING_CONFIGURATION_REQUIRED",
    "Responder number binding authentication and storage are required.",
    { status: 500 }
  );

  // The raw phone number and provider SIDs exist only inside this request
  // scope. Every durable, logged, or echoed value is a digest; the number
  // lookup digest is keyed and versioned.
  function provisionCommand(actor, route, commandId, parsed) {
    exactKeys(parsed, [
      "projectId", "phoneNumber", "phoneNumberSid", "accountSid",
      "messagingServiceSid", "readbackAttestedAt", "evidenceDigest",
      "voiceIngressRole"
    ], "The Responder number binding provision body is invalid.");
    if (
      typeof parsed.projectId !== "string" || !UUID.test(parsed.projectId) ||
      typeof parsed.phoneNumber !== "string" ||
      !E164.test(parsed.phoneNumber) ||
      typeof parsed.phoneNumberSid !== "string" ||
      !PHONE_NUMBER_SID.test(parsed.phoneNumberSid) ||
      typeof parsed.accountSid !== "string" ||
      !ACCOUNT_SID.test(parsed.accountSid) ||
      (parsed.messagingServiceSid !== null &&
        (typeof parsed.messagingServiceSid !== "string" ||
          !MESSAGING_SERVICE_SID.test(parsed.messagingServiceSid))) ||
      !VOICE_INGRESS_ROLES.has(parsed.voiceIngressRole) ||
      typeof parsed.evidenceDigest !== "string" ||
      !SHA256.test(parsed.evidenceDigest)
    ) {
      throw invalid("The Responder number binding provision body is invalid.");
    }
    const attestedAt = instant(
      parsed.readbackAttestedAt,
      "The provider readback attestation time"
    );
    const lookup = lookupDigests.numberLookupDigest(parsed.phoneNumber);
    const lookupCandidates = lookupDigests
      .numberLookupCandidates(parsed.phoneNumber)
      .map((entry) => entry.digest);
    const phoneNumberSidDigest = digest(parsed.phoneNumberSid);
    const accountSidDigest = digest(parsed.accountSid);
    const messagingServiceSidDigest = parsed.messagingServiceSid === null
      ? null
      : digest(parsed.messagingServiceSid);
    const providerReadbackDigest = digest({
      schema: "sitesourcery.responder-number-readback/v1",
      provider: "twilio",
      accountSidDigest,
      phoneNumberSidDigest,
      numberLookupDigest: lookup.digest,
      lookupKeyVersion: lookup.keyVersion,
      messagingServiceSidDigest,
      attestedAt
    });
    const command = {
      commandId,
      organizationId: route.params.organizationId,
      projectId: parsed.projectId,
      voiceIngressRole: parsed.voiceIngressRole,
      numberLookupDigest: lookup.digest,
      numberLookupCandidateDigests: lookupCandidates,
      lookupKeyVersion: lookup.keyVersion,
      phoneNumberSidDigest,
      accountSidDigest,
      messagingServiceSidDigest,
      providerReadbackDigest,
      provisionEvidenceDigest: parsed.evidenceDigest,
      recordedAt: currentTime(clock)
    };
    return {
      ...command,
      requestDigest: digest({
        schema: "sitesourcery.responder-number-binding-command/v1",
        commandId: command.commandId,
        organizationId: command.organizationId,
        projectId: command.projectId,
        voiceIngressRole: command.voiceIngressRole,
        numberLookupDigest: command.numberLookupDigest,
        lookupKeyVersion: command.lookupKeyVersion,
        phoneNumberSidDigest: command.phoneNumberSidDigest,
        accountSidDigest: command.accountSidDigest,
        messagingServiceSidDigest: command.messagingServiceSidDigest,
        providerReadbackDigest: command.providerReadbackDigest,
        provisionEvidenceDigest: command.provisionEvidenceDigest
      })
    };
  }

  function retireCommand(actor, route, commandId, parsed) {
    exactKeys(parsed, ["reason", "evidenceDigest"],
      "The Responder number binding retirement body is invalid.");
    if (
      !RETIRED_REASONS.has(parsed.reason) ||
      typeof parsed.evidenceDigest !== "string" ||
      !SHA256.test(parsed.evidenceDigest)
    ) {
      throw invalid(
        "The Responder number binding retirement body is invalid."
      );
    }
    const command = {
      commandId,
      organizationId: route.params.organizationId,
      bindingId: route.params.bindingId,
      retiredReason: parsed.reason,
      retireEvidenceDigest: parsed.evidenceDigest,
      recordedAt: currentTime(clock)
    };
    return {
      ...command,
      requestDigest: digest({
        schema: "sitesourcery.responder-number-binding-retirement/v1",
        commandId: command.commandId,
        organizationId: command.organizationId,
        bindingId: command.bindingId,
        retiredReason: command.retiredReason,
        retireEvidenceDigest: command.retireEvidenceDigest
      })
    };
  }

  return Object.freeze({
    kind: "responder-number-bindings-http",
    mode: "held",
    providerEffects: false,
    manifest: RESPONDER_NUMBER_BINDING_HTTP_ROUTES,
    match: matchResponderNumberBindingHttpRoute,
    async dispatch(request) {
      let url;
      try {
        url = new URL(request?.url);
      } catch {
        return null;
      }
      if (url.search || url.hash) return null;
      const route = matchResponderNumberBindingHttpRoute(
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
      const actor = Object.freeze({
        kind: "operator",
        organizationId: route.params.organizationId,
        userId: authenticated.userId
      });
      if (route.operation === "list") {
        return json(await repository.listBindings(
          actor,
          route.params.organizationId
        ));
      }
      invariant(
        await requireWriteGuard(request, authenticated) === true,
        "RESPONDER_NUMBER_BINDING_WRITE_GUARD_REQUIRED",
        "Responder number binding write safety could not be verified.",
        { status: 403 }
      );
      const idempotencyKey = request.headers.get("idempotency-key");
      invariant(
        typeof idempotencyKey === "string" &&
          COMMAND_ID.test(idempotencyKey),
        "IDEMPOTENCY_KEY_REQUIRED",
        "An idempotency key is required.",
        { status: 400 }
      );
      const parsed = await body(request);
      if (route.operation === "provision") {
        return json(await repository.provisionBinding(
          actor,
          provisionCommand(actor, route, idempotencyKey, parsed)
        ));
      }
      return json(await repository.retireBinding(
        actor,
        retireCommand(actor, route, idempotencyKey, parsed)
      ));
    }
  });
}
