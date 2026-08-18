import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";
import { canonicalJson } from "./security.mjs";

const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID = new RegExp(`^${UUID_SOURCE}$`, "u");
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const APP_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/u;
const REVOCATION_REASONS = new Set([
  "logout", "customer_request", "device_lost", "token_compromise"
]);
const MAX_BODY_BYTES = 16 * 1024;

export const RESPONDER_NATIVE_CLIENT_HTTP_ROUTES = deepFreeze([
  {
    method: "GET",
    pattern: "/api/v1/responder/projects/:projectId/native-installations",
    operation: "list"
  },
  {
    method: "POST",
    pattern: "/api/v1/responder/projects/:projectId/native-installations",
    operation: "create"
  },
  {
    method: "POST",
    pattern:
      "/api/v1/responder/projects/:projectId/native-installations/:installationId/push-tokens",
    operation: "registerToken"
  },
  {
    method: "POST",
    pattern:
      "/api/v1/responder/projects/:projectId/native-installations/:installationId/push-tokens/retire",
    operation: "retireToken"
  },
  {
    method: "POST",
    pattern:
      "/api/v1/responder/projects/:projectId/native-installations/:installationId/revoke",
    operation: "revoke"
  },
  {
    method: "POST",
    pattern:
      "/api/v1/responder/projects/:projectId/native-installations/:installationId/resume",
    operation: "resume"
  },
  {
    method: "POST",
    pattern:
      "/api/v1/responder/projects/:projectId/native-installations/:installationId/voip-session",
    operation: "voipSession"
  }
]);

const MATCHERS = RESPONDER_NATIVE_CLIENT_HTTP_ROUTES.map((route) => {
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

export function matchResponderNativeClientHttpRoute(method, pathname) {
  if (
    typeof method !== "string" || typeof pathname !== "string" ||
    pathname.includes("?")
  ) return null;
  for (const { route, names, expression } of MATCHERS) {
    if (route.method !== method) continue;
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

function exactKeys(value, fields) {
  invariant(
    canonicalJson(Object.keys(value).sort()) ===
      canonicalJson([...fields].sort()),
    "RESPONDER_NATIVE_CLIENT_INVALID",
    "The native-client request body is invalid.",
    { status: 400 }
  );
  return value;
}

async function body(request) {
  invariant(
    String(request.headers.get("content-type") ?? "")
      .toLowerCase().startsWith("application/json"),
    "RESPONDER_NATIVE_CLIENT_INVALID",
    "Native-client commands require JSON.",
    { status: 415 }
  );
  const declared = request.headers.get("content-length");
  invariant(
    declared === null ||
      (/^\d{1,8}$/u.test(declared) && Number(declared) <= MAX_BODY_BYTES),
    "RESPONDER_NATIVE_CLIENT_INVALID",
    "The native-client request body is too large.",
    { status: 413 }
  );
  const text = await request.text();
  invariant(
    Buffer.byteLength(text, "utf8") <= MAX_BODY_BYTES,
    "RESPONDER_NATIVE_CLIENT_INVALID",
    "The native-client request body is too large.",
    { status: 413 }
  );
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  invariant(
    parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      Object.getPrototypeOf(parsed) === Object.prototype,
    "RESPONDER_NATIVE_CLIENT_INVALID",
    "The native-client request body is invalid.",
    { status: 400 }
  );
  return parsed;
}

function commandId(request) {
  const value = request.headers.get("idempotency-key");
  invariant(
    typeof value === "string" && COMMAND_ID.test(value),
    "IDEMPOTENCY_KEY_REQUIRED",
    "An idempotency key is required.",
    { status: 400 }
  );
  return value;
}

function now(clock) {
  const value = clock?.now?.();
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "RESPONDER_NATIVE_CLIENT_CONFIGURATION_REQUIRED",
    "The native-client clock is invalid.",
    { status: 500 }
  );
  return value;
}

export function createResponderNativeClientHttpBoundary({
  repository,
  tokenAuthority,
  authenticate,
  requireWriteGuard,
  randomUUID = systemRandomUUID,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  invariant(
    repository?.kind === "responder-native-client-postgres" &&
      repository.mode === "held-local" &&
      repository.providerEffects === false &&
      repository.pushDeliveryEffects === false &&
      repository.voiceCallEffects === false &&
      typeof repository.createInstallation === "function" &&
      typeof repository.registerToken === "function" &&
      typeof repository.retireToken === "function" &&
      typeof repository.suspendInstallation === "function" &&
      typeof repository.resumeInstallation === "function" &&
      typeof repository.revokeInstallation === "function" &&
      typeof repository.listInstallations === "function" &&
      typeof repository.getInstallation === "function" &&
      typeof repository.issueVoipSession === "function" &&
      tokenAuthority?.kind === "responder-native-token-authority" &&
      tokenAuthority.providerEffects === false &&
      tokenAuthority.pushDeliveryEffects === false &&
      typeof tokenAuthority.tokenLookupCandidates === "function" &&
      typeof tokenAuthority.sealToken === "function" &&
      typeof authenticate === "function" &&
      typeof requireWriteGuard === "function" &&
      typeof randomUUID === "function" && typeof clock?.now === "function",
    "RESPONDER_NATIVE_CLIENT_CONFIGURATION_REQUIRED",
    "Native-client authentication and held storage are required.",
    { status: 500 }
  );

  return Object.freeze({
    kind: "responder-native-client-http",
    mode: "held-local",
    providerEffects: false,
    pushDeliveryEffects: false,
    voiceCallEffects: false,
    carrierCommandEffects: false,
    messageSendEffects: false,
    manifest: RESPONDER_NATIVE_CLIENT_HTTP_ROUTES,
    match: matchResponderNativeClientHttpRoute,
    async dispatch(request) {
      let url;
      try {
        url = new URL(request?.url);
      } catch {
        return null;
      }
      if (url.search || url.hash) return null;
      const route = matchResponderNativeClientHttpRoute(
        request.method, url.pathname
      );
      if (!route) return null;
      const authenticated = await authenticate(request, {
        ...route,
        audience: "customer"
      });
      invariant(
        authenticated !== null && authenticated !== undefined,
        "AUTHENTICATION_REQUIRED",
        "Sign in to continue.",
        { status: 401 }
      );
      const actor = Object.freeze({
        kind: "customer",
        organizationId: authenticated.organizationId,
        userId: authenticated.userId
      });
      const scope = {
        organizationId: actor.organizationId,
        projectId: route.params.projectId
      };
      if (route.operation === "list") {
        return json(await repository.listInstallations(actor, scope));
      }
      invariant(
        await requireWriteGuard(request, authenticated) === true,
        "RESPONDER_NATIVE_CLIENT_WRITE_GUARD_REQUIRED",
        "Native-client write safety could not be verified.",
        { status: 403 }
      );
      const selectedCommandId = commandId(request);
      const parsed = await body(request);
      if (route.operation === "create") {
        exactKeys(parsed, [
          "platform", "bundleId", "appEnvironment", "appVersion",
          "buildNumber", "installationKeyDigest"
        ]);
        invariant(
          (parsed.platform === "ios" || parsed.platform === "android") &&
            parsed.bundleId === "com.sitesourcery.responder" &&
            (parsed.appEnvironment === "sandbox" ||
              parsed.appEnvironment === "production") &&
            typeof parsed.appVersion === "string" &&
            APP_VERSION.test(parsed.appVersion) &&
            typeof parsed.buildNumber === "string" &&
            APP_VERSION.test(parsed.buildNumber) &&
            typeof parsed.installationKeyDigest === "string" &&
            SHA256.test(parsed.installationKeyDigest),
          "RESPONDER_NATIVE_CLIENT_INVALID",
          "The native installation is invalid.",
          { status: 400 }
        );
        return json(await repository.createInstallation(actor, {
          ...scope,
          commandId: selectedCommandId,
          installationId: randomUUID(),
          ...parsed,
          recordedAt: now(clock)
        }), 201);
      }
      invariant(
        typeof route.params.installationId === "string" &&
          UUID.test(route.params.installationId),
        "RESPONDER_NATIVE_CLIENT_INVALID",
        "The native installation is invalid.",
        { status: 400 }
      );
      if (route.operation === "registerToken") {
        exactKeys(parsed, ["expectedRevision", "purpose", "token"]);
        invariant(
          Number.isSafeInteger(parsed.expectedRevision) &&
            parsed.expectedRevision > 0 &&
            (parsed.purpose === "notification" ||
              parsed.purpose === "voip") &&
            typeof parsed.token === "string",
          "RESPONDER_NATIVE_CLIENT_INVALID",
          "The native push-token registration is invalid.",
          { status: 400 }
        );
        const installed = await repository.getInstallation(actor, {
          ...scope,
          installationId: route.params.installationId
        });
        const tokenScope = {
          id: installed.id,
          organizationId: installed.organizationId,
          projectId: installed.projectId,
          userId: installed.customerUserId,
          platform: installed.platform,
          bundleId: installed.bundleId,
          environment: installed.appEnvironment
        };
        const candidates = tokenAuthority.tokenLookupCandidates(
          tokenScope, parsed.purpose, parsed.token
        );
        const collisionCandidates = installed.platform === "android"
          ? ["notification", "voip"].flatMap((purpose) =>
              tokenAuthority.tokenLookupCandidates(
                tokenScope, purpose, parsed.token
              ).map((entry) => entry.digest)
            )
          : candidates.map((entry) => entry.digest);
        const sealed = await tokenAuthority.sealToken(
          tokenScope, parsed.purpose, parsed.token
        );
        return json(await repository.registerToken(actor, {
          ...scope,
          installationId: route.params.installationId,
          commandId: selectedCommandId,
          registrationId: randomUUID(),
          expectedRevision: parsed.expectedRevision,
          pushPurpose: parsed.purpose,
          tokenLookupCandidateDigests:
            candidates.map((entry) => entry.digest),
          tokenCollisionCandidateDigests: [...new Set(collisionCandidates)],
          tokenOwnershipCandidateDigests:
            candidates.map((entry) => entry.ownershipDigest),
          envelope: sealed,
          recordedAt: now(clock)
        }));
      }
      if (route.operation === "retireToken") {
        exactKeys(parsed, ["expectedRevision", "purpose", "evidenceDigest"]);
        invariant(
          Number.isSafeInteger(parsed.expectedRevision) &&
            parsed.expectedRevision > 0 &&
            (parsed.purpose === "notification" ||
              parsed.purpose === "voip") &&
            typeof parsed.evidenceDigest === "string" &&
            SHA256.test(parsed.evidenceDigest),
          "RESPONDER_NATIVE_CLIENT_INVALID",
          "The native push-token retirement is invalid.",
          { status: 400 }
        );
        return json(await repository.retireToken(actor, {
          ...scope,
          installationId: route.params.installationId,
          commandId: selectedCommandId,
          retirementId: randomUUID(),
          expectedRevision: parsed.expectedRevision,
          pushPurpose: parsed.purpose,
          reason: "customer_request",
          evidenceDigest: parsed.evidenceDigest,
          recordedAt: now(clock)
        }));
      }
      if (route.operation === "revoke") {
        exactKeys(parsed, ["expectedRevision", "reason", "evidenceDigest"]);
        invariant(
          Number.isSafeInteger(parsed.expectedRevision) &&
            parsed.expectedRevision > 0 &&
            REVOCATION_REASONS.has(parsed.reason) &&
            typeof parsed.evidenceDigest === "string" &&
            SHA256.test(parsed.evidenceDigest),
          "RESPONDER_NATIVE_CLIENT_INVALID",
          "The native installation revocation is invalid.",
          { status: 400 }
        );
        const transition = parsed.reason === "logout"
          ? repository.suspendInstallation.bind(repository)
          : repository.revokeInstallation.bind(repository);
        return json(await transition(actor, {
          ...scope,
          installationId: route.params.installationId,
          commandId: selectedCommandId,
          transitionId: randomUUID(),
          ...parsed,
          recordedAt: now(clock)
        }));
      }
      if (route.operation === "resume") {
        exactKeys(parsed, ["expectedRevision", "evidenceDigest"]);
        invariant(
          Number.isSafeInteger(parsed.expectedRevision) &&
            parsed.expectedRevision > 0 &&
            typeof parsed.evidenceDigest === "string" &&
            SHA256.test(parsed.evidenceDigest),
          "RESPONDER_NATIVE_CLIENT_INVALID",
          "The native installation resume request is invalid.",
          { status: 400 }
        );
        return json(await repository.resumeInstallation(actor, {
          ...scope,
          installationId: route.params.installationId,
          commandId: selectedCommandId,
          transitionId: randomUUID(),
          expectedRevision: parsed.expectedRevision,
          reason: "login",
          evidenceDigest: parsed.evidenceDigest,
          recordedAt: now(clock)
        }));
      }
      exactKeys(parsed, ["expectedRevision"]);
      invariant(
        Number.isSafeInteger(parsed.expectedRevision) &&
          parsed.expectedRevision > 0,
        "RESPONDER_NATIVE_CLIENT_INVALID",
        "The native VoIP session request is invalid.",
        { status: 400 }
      );
      return json(await repository.issueVoipSession(actor, {
        ...scope,
        installationId: route.params.installationId,
        commandId: selectedCommandId,
        sessionId: randomUUID(),
        expectedRevision: parsed.expectedRevision
      }));
    }
  });
}
