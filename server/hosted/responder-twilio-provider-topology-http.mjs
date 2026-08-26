import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID = new RegExp(`^${UUID_SOURCE}$`, "u");
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const SID = Object.freeze({
  account: /^AC[0-9a-fA-F]{32}$/u,
  apiKey: /^SK[0-9a-fA-F]{32}$/u,
  messagingService: /^MG[0-9a-fA-F]{32}$/u,
  customerProfile: /^BU[0-9a-fA-F]{32}$/u,
  brand: /^BN[0-9a-fA-F]{32}$/u,
  campaign: /^QE[0-9a-fA-F]{32}$/u,
  pushCredential: /^CR[0-9a-fA-F]{32}$/u
});
const REGISTRATION_CLASSES = new Set([
  "STANDARD", "LOW_VOLUME_STANDARD", "SOLE_PROPRIETOR"
]);
const RETIRED_REASONS = new Set([
  "customer_cancelled", "provider_replaced", "operator_correction"
]);
const MAX_BODY_BYTES = 24 * 1024;

export const RESPONDER_TWILIO_TOPOLOGY_HTTP_ROUTES = deepFreeze([
  {
    method: "GET",
    pattern:
      "/api/v1/operator/responder/organizations/:organizationId/twilio-topologies",
    audience: "operator",
    operation: "list"
  },
  {
    method: "POST",
    pattern:
      "/api/v1/operator/responder/organizations/:organizationId/twilio-topologies",
    audience: "operator",
    operation: "attest"
  },
  {
    method: "POST",
    pattern:
      "/api/v1/operator/responder/organizations/:organizationId/twilio-topologies/:topologyId/retire",
    audience: "operator",
    operation: "retire"
  }
]);

const MATCHERS = RESPONDER_TWILIO_TOPOLOGY_HTTP_ROUTES.map((route) => {
  const names = [];
  const source = route.pattern.replace(
    /:([A-Za-z][A-Za-z0-9]*)/gu,
    (_, name) => {
      names.push(name);
      return `(${UUID_SOURCE})`;
    }
  );
  return { route, names, expression: new RegExp(`^${source}$`, "u") };
});

export function matchResponderTwilioTopologyHttpRoute(method, pathname) {
  if (typeof method !== "string" || typeof pathname !== "string" ||
      pathname.includes("?")) return null;
  for (const { route, names, expression } of MATCHERS) {
    if (method !== route.method) continue;
    const match = expression.exec(pathname);
    if (!match) continue;
    return deepFreeze({
      ...route,
      params: Object.fromEntries(names.map((name, index) => [
        name, match[index + 1]
      ]))
    });
  }
  return null;
}

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function invalid(message) {
  return new HostedError("RESPONDER_TWILIO_TOPOLOGY_INVALID", message, {
    status: 400, details: { providerEffects: false }
  });
}

function exactKeys(value, keys, message) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort()),
    "RESPONDER_TWILIO_TOPOLOGY_INVALID",
    message,
    { status: 400, details: { providerEffects: false } }
  );
  return value;
}

async function body(request) {
  invariant(
    /^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(
      String(request.headers.get("content-type") ?? "").trim()
    ),
    "RESPONDER_TWILIO_TOPOLOGY_INVALID",
    "Responder Twilio topology commands require JSON.",
    { status: 415, details: { providerEffects: false } }
  );
  const text = await request.text();
  invariant(
    Buffer.byteLength(text, "utf8") <= MAX_BODY_BYTES,
    "RESPONDER_TWILIO_TOPOLOGY_INVALID",
    "The Responder Twilio topology body is too large.",
    { status: 413, details: { providerEffects: false } }
  );
  try {
    const parsed = JSON.parse(text);
    return exactKeys(parsed, Object.keys(parsed),
      "The Responder Twilio topology body is invalid.");
  } catch (error) {
    if (error instanceof HostedError) throw error;
    throw invalid("The Responder Twilio topology body is invalid.");
  }
}

function currentTime(clock) {
  const selected = clock?.now?.();
  invariant(
    typeof selected === "string" && Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "RESPONDER_TWILIO_TOPOLOGY_CONFIGURATION_REQUIRED",
    "The Responder Twilio topology clock is invalid.",
    { status: 500, details: { providerEffects: false } }
  );
  return selected;
}

function attestation(route, commandId, parsed, clock) {
  const fields = [
    "accountSid", "messagingServiceSid", "customerProfileSid",
    "brandRegistrationSid", "campaignSid", "messagingApiKeySid",
    "voiceApiKeySid", "voiceSandboxPushCredentialSid",
    "voiceProductionPushCredentialSid",
    "voiceAndroidSandboxPushCredentialSid",
    "voiceAndroidProductionPushCredentialSid", "registrationClass",
    "campaignUseCase", "messagingApiKeySecretDigest",
    "webhookAuthTokenDigest", "voiceApiKeySecretDigest",
    "readbackAttestedAt", "evidenceDigest"
  ];
  exactKeys(parsed, fields, "The Twilio topology attestation body is invalid.");
  const validators = [
    ["accountSid", SID.account],
    ["messagingServiceSid", SID.messagingService],
    ["customerProfileSid", SID.customerProfile],
    ["brandRegistrationSid", SID.brand],
    ["campaignSid", SID.campaign],
    ["messagingApiKeySid", SID.apiKey],
    ["voiceApiKeySid", SID.apiKey],
    ["voiceSandboxPushCredentialSid", SID.pushCredential],
    ["voiceProductionPushCredentialSid", SID.pushCredential],
    ["voiceAndroidSandboxPushCredentialSid", SID.pushCredential],
    ["voiceAndroidProductionPushCredentialSid", SID.pushCredential]
  ];
  if (validators.some(([field, pattern]) =>
    typeof parsed[field] !== "string" || !pattern.test(parsed[field])) ||
      parsed.messagingApiKeySid === parsed.voiceApiKeySid ||
      new Set([
        parsed.messagingApiKeySecretDigest,
        parsed.webhookAuthTokenDigest,
        parsed.voiceApiKeySecretDigest
      ]).size !== 3 ||
      new Set([
        parsed.voiceSandboxPushCredentialSid,
        parsed.voiceProductionPushCredentialSid,
        parsed.voiceAndroidSandboxPushCredentialSid,
        parsed.voiceAndroidProductionPushCredentialSid
      ]).size !== 4 ||
      !REGISTRATION_CLASSES.has(parsed.registrationClass) ||
      parsed.campaignUseCase !== "CUSTOMER_CARE" ||
      ![
        parsed.messagingApiKeySecretDigest,
        parsed.webhookAuthTokenDigest,
        parsed.voiceApiKeySecretDigest
      ].every((value) => typeof value === "string" && SHA256.test(value)) ||
      typeof parsed.evidenceDigest !== "string" ||
      !SHA256.test(parsed.evidenceDigest) ||
      typeof parsed.readbackAttestedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.readbackAttestedAt)) ||
      new Date(parsed.readbackAttestedAt).toISOString() !==
        parsed.readbackAttestedAt) {
    throw invalid("The Twilio topology attestation body is invalid.");
  }
  const topology = {
    organizationId: route.params.organizationId,
    registrationClass: parsed.registrationClass,
    providerBrandType: parsed.registrationClass === "SOLE_PROPRIETOR"
      ? "SOLE_PROPRIETOR"
      : "STANDARD",
    campaignUseCase: parsed.campaignUseCase,
    accountSidDigest: digest(parsed.accountSid),
    messagingServiceSidDigest: digest(parsed.messagingServiceSid),
    customerProfileSidDigest: digest(parsed.customerProfileSid),
    brandRegistrationSidDigest: digest(parsed.brandRegistrationSid),
    campaignSidDigest: digest(parsed.campaignSid),
    messagingApiKeySidDigest: digest(parsed.messagingApiKeySid),
    messagingApiKeySecretDigest: parsed.messagingApiKeySecretDigest,
    webhookAuthTokenDigest: parsed.webhookAuthTokenDigest,
    voiceApiKeySidDigest: digest(parsed.voiceApiKeySid),
    voiceApiKeySecretDigest: parsed.voiceApiKeySecretDigest,
    voiceSandboxPushCredentialSidDigest:
      digest(parsed.voiceSandboxPushCredentialSid),
    voiceProductionPushCredentialSidDigest:
      digest(parsed.voiceProductionPushCredentialSid),
    voiceAndroidSandboxPushCredentialSidDigest:
      digest(parsed.voiceAndroidSandboxPushCredentialSid),
    voiceAndroidProductionPushCredentialSidDigest:
      digest(parsed.voiceAndroidProductionPushCredentialSid)
  };
  const providerReadbackDigest = digest({
    schema: "sitesourcery.responder-twilio-isv-readback/v1",
    ...topology,
    readbackAttestedAt: parsed.readbackAttestedAt
  });
  const command = {
    commandId,
    ...topology,
    providerReadbackDigest,
    topologyEvidenceDigest: parsed.evidenceDigest,
    recordedAt: currentTime(clock)
  };
  return {
    ...command,
    requestDigest: digest({
      schema: "sitesourcery.responder-twilio-isv-attestation-command/v1",
      ...command
    })
  };
}

export function createResponderTwilioProviderTopologyHttpBoundary({
  repository,
  authenticate,
  requireWriteGuard,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  invariant(
    repository?.kind === "responder-twilio-provider-topology-postgres" &&
      repository.providerEffects === false &&
      typeof repository.attestTopology === "function" &&
      typeof repository.retireTopology === "function" &&
      typeof repository.listTopologies === "function" &&
      typeof authenticate === "function" &&
      typeof requireWriteGuard === "function" &&
      typeof clock?.now === "function",
    "RESPONDER_TWILIO_TOPOLOGY_CONFIGURATION_REQUIRED",
    "Responder Twilio topology authentication and storage are required.",
    { status: 500, details: { providerEffects: false } }
  );
  return Object.freeze({
    kind: "responder-twilio-provider-topology-http",
    mode: "held",
    providerEffects: false,
    manifest: RESPONDER_TWILIO_TOPOLOGY_HTTP_ROUTES,
    match: matchResponderTwilioTopologyHttpRoute,
    async dispatch(request) {
      let url;
      try { url = new URL(request?.url); } catch { return null; }
      if (url.search || url.hash) return null;
      const route = matchResponderTwilioTopologyHttpRoute(
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
        kind: "operator",
        organizationId: route.params.organizationId,
        userId: authenticated.userId
      });
      if (route.operation === "list") {
        return json(await repository.listTopologies(
          actor, route.params.organizationId
        ));
      }
      invariant(
        await requireWriteGuard(request, authenticated) === true,
        "RESPONDER_TWILIO_TOPOLOGY_WRITE_GUARD_REQUIRED",
        "Responder Twilio topology write safety could not be verified.",
        { status: 403 }
      );
      const idempotencyKey = request.headers.get("idempotency-key");
      invariant(
        typeof idempotencyKey === "string" && COMMAND_ID.test(idempotencyKey),
        "IDEMPOTENCY_KEY_REQUIRED",
        "An idempotency key is required.",
        { status: 400 }
      );
      const parsed = await body(request);
      if (route.operation === "attest") {
        return json(await repository.attestTopology(
          actor, attestation(route, idempotencyKey, parsed, clock)
        ));
      }
      exactKeys(parsed, ["reason", "evidenceDigest"],
        "The Twilio topology retirement body is invalid.");
      if (!RETIRED_REASONS.has(parsed.reason) ||
          typeof parsed.evidenceDigest !== "string" ||
          !SHA256.test(parsed.evidenceDigest) ||
          !UUID.test(route.params.topologyId)) {
        throw invalid("The Twilio topology retirement body is invalid.");
      }
      return json(await repository.retireTopology(actor, {
        organizationId: route.params.organizationId,
        topologyId: route.params.topologyId,
        reason: parsed.reason,
        retireEvidenceDigest: parsed.evidenceDigest,
        recordedAt: currentTime(clock)
      }));
    }
  });
}
