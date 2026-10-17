import { TWILIO_PUSH_SLOTS, normalizeTwilioPushSlots, twilioPushSlotMap } from "./responder-twilio-provider-registry.mjs";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes as systemRandomBytes
} from "node:crypto";

import twilio from "twilio";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const TWILIO_RESPONDER_VOICE_ACCESS_MODE_ENVIRONMENT =
  "SITESOURCERY_TWILIO_VOICE_ACCESS_MODE";
export const TWILIO_RESPONDER_VOICE_API_KEY_SID_ENVIRONMENT =
  "SITESOURCERY_TWILIO_VOICE_API_KEY_SID";
export const TWILIO_RESPONDER_VOICE_API_KEY_SECRET_ENVIRONMENT =
  "SITESOURCERY_TWILIO_VOICE_API_KEY_SECRET";
export const TWILIO_RESPONDER_VOICE_SANDBOX_PUSH_CREDENTIAL_ENVIRONMENT =
  "SITESOURCERY_TWILIO_VOICE_SANDBOX_PUSH_CREDENTIAL_SID";
export const TWILIO_RESPONDER_VOICE_PRODUCTION_PUSH_CREDENTIAL_ENVIRONMENT =
  "SITESOURCERY_TWILIO_VOICE_PRODUCTION_PUSH_CREDENTIAL_SID";
export const TWILIO_RESPONDER_VOICE_ANDROID_SANDBOX_PUSH_CREDENTIAL_ENVIRONMENT =
  "SITESOURCERY_TWILIO_VOICE_ANDROID_SANDBOX_PUSH_CREDENTIAL_SID";
export const TWILIO_RESPONDER_VOICE_ANDROID_PRODUCTION_PUSH_CREDENTIAL_ENVIRONMENT =
  "SITESOURCERY_TWILIO_VOICE_ANDROID_PRODUCTION_PUSH_CREDENTIAL_SID";

const ACCOUNT_SID_ENVIRONMENT = "SITESOURCERY_TWILIO_ACCOUNT_SID";
const SESSION_TTL_SECONDS = 300;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,39}$/u;
const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/u;
const API_KEY_SID = /^SK[0-9a-fA-F]{32}$/u;
const PUSH_CREDENTIAL_SID = /^CR[0-9a-fA-F]{32}$/u;
const APP_ENVIRONMENTS = new Set(["sandbox", "production"]);
const CLIENT_PLATFORMS = new Set(["ios", "android"]);
const IDENTITY_PURPOSE =
  "sitesourcery.responder-twilio-voice-identity/v1";
const ENDPOINT_PURPOSE =
  "sitesourcery.responder-twilio-voice-endpoint/v1";
const ENCRYPTION_PURPOSE =
  "sitesourcery.responder-twilio-voice-session-encryption/v1";

function configurationError(message = "Twilio Voice access configuration is invalid.") {
  return new HostedError(
    "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED",
    message,
    { status: 500 }
  );
}

function exactObject(value, fields, code, message, status = 500) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...fields].sort()),
    code,
    message,
    { status }
  );
  return value;
}

function selectedValue(environment, name) {
  const value = environment?.[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function providerSid(environment, name, pattern) {
  const value = selectedValue(environment, name);
  if (value === null || !pattern.test(value)) {
    throw configurationError(`${name} is invalid.`);
  }
  return value;
}

function providerSecret(environment, name) {
  const value = selectedValue(environment, name);
  if (
    value === null || value.length < 32 || value.length > 512 ||
    /[^\x21-\x7e]/u.test(value)
  ) throw configurationError(`${name} is invalid.`);
  return value;
}

function keyVersion(value) {
  if (typeof value !== "string" || !VERSION.test(value)) {
    throw configurationError();
  }
  return value;
}

function pepperBytes(value) {
  if (!Buffer.isBuffer(value) || value.length < 32 || value.length > 128) {
    throw configurationError();
  }
  return Buffer.from(value);
}

function purposeKey(pepper, purpose) {
  return createHmac("sha256", pepper).update(purpose, "utf8").digest();
}

function hmacHex(key, value) {
  return createHmac("sha256", key)
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function instant(value, field) {
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "TWILIO_RESPONDER_VOICE_ACCESS_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function sessionAuthority(value) {
  exactObject(value, [
    "sessionId", "commandId", "requestDigest", "organizationId",
    "projectId", "userId", "installationId", "installationRevision",
    "clientPlatform", "transport", "appEnvironment"
  ], "TWILIO_RESPONDER_VOICE_ACCESS_INVALID",
  "Twilio Voice session authority is invalid.");
  invariant(
    [
      value.sessionId, value.organizationId, value.projectId, value.userId,
      value.installationId
    ].every((entry) => typeof entry === "string" && UUID.test(entry)) &&
      typeof value.commandId === "string" && COMMAND_ID.test(value.commandId) &&
      typeof value.requestDigest === "string" && SHA256.test(value.requestDigest) &&
      Number.isSafeInteger(value.installationRevision) &&
      value.installationRevision > 0 &&
      CLIENT_PLATFORMS.has(value.clientPlatform) &&
      value.transport === `twilio_voice_${value.clientPlatform}` &&
      APP_ENVIRONMENTS.has(value.appEnvironment),
    "TWILIO_RESPONDER_VOICE_ACCESS_INVALID",
    "Twilio Voice session authority is invalid.",
    { status: 500 }
  );
  return value;
}

function decodeJwt(token) {
  const parts = String(token ?? "").split(".");
  invariant(
    parts.length === 3 && parts.every((entry) => entry.length > 0),
    "TWILIO_RESPONDER_VOICE_ACCESS_UNAVAILABLE",
    "Twilio Voice access token generation failed.",
    { status: 503 }
  );
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")),
      payload: JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
    };
  } catch {
    throw new HostedError(
      "TWILIO_RESPONDER_VOICE_ACCESS_UNAVAILABLE",
      "Twilio Voice access token generation failed.",
      { status: 503 }
    );
  }
}

function defaultTokenFactory({
  accountSid,
  apiKeySid,
  apiKeySecret,
  identity,
  endpointId,
  pushCredentialSid,
  ttlSeconds
}) {
  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: ttlSeconds
  });
  token.addGrant(new AccessToken.VoiceGrant({
    incomingAllow: true,
    pushCredentialSid,
    endpointId
  }));
  return token.toJwt("HS256");
}

function envelopeAad(authority, metadata, key) {
  return Buffer.from(canonicalJson({
    schema: "sitesourcery.responder-native-voice-session-aad/v2",
    ...authority,
    ...metadata,
    keyVersion: key
  }), "utf8");
}

function envelope(value) {
  exactObject(value, [
    "keyVersion", "nonce", "authenticationTag", "ciphertext"
  ], "TWILIO_RESPONDER_VOICE_ACCESS_INVALID",
  "Twilio Voice session envelope is invalid.");
  invariant(
    VERSION.test(value.keyVersion ?? "") &&
      Buffer.isBuffer(value.nonce) && value.nonce.length === 12 &&
      Buffer.isBuffer(value.authenticationTag) &&
      value.authenticationTag.length === 16 &&
      Buffer.isBuffer(value.ciphertext) &&
      value.ciphertext.length >= 64 && value.ciphertext.length <= 16_384,
    "TWILIO_RESPONDER_VOICE_ACCESS_INVALID",
    "Twilio Voice session envelope is invalid.",
    { status: 500 }
  );
  return value;
}

export function createTwilioResponderVoiceAccess({
  pepper,
  pepperVersion,
  previousPeppers = {},
  environment = {},
  providerRegistry = null,
  providerTopologyRepository = null,
  randomBytes = systemRandomBytes,
  tokenFactory = defaultTokenFactory
} = {}) {
  const mode = selectedValue(
    environment,
    TWILIO_RESPONDER_VOICE_ACCESS_MODE_ENVIRONMENT
  ) ?? "held";
  invariant(
    mode === "held" || mode === "verified",
    "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED",
    `${TWILIO_RESPONDER_VOICE_ACCESS_MODE_ENVIRONMENT} must be held or verified.`,
    { status: 500 }
  );
  const currentVersion = keyVersion(pepperVersion);
  const currentPepper = pepperBytes(pepper);
  invariant(
    previousPeppers && typeof previousPeppers === "object" &&
      !Array.isArray(previousPeppers) && typeof randomBytes === "function" &&
      typeof tokenFactory === "function",
    "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED",
    "Twilio Voice access key configuration is invalid.",
    { status: 500 }
  );
  const keyring = new Map();
  const addKeys = (version, secret) => {
    invariant(
      !keyring.has(version),
      "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED",
      "Twilio Voice access key versions must be distinct.",
      { status: 500 }
    );
    keyring.set(version, {
      identity: purposeKey(secret, IDENTITY_PURPOSE),
      endpoint: purposeKey(secret, ENDPOINT_PURPOSE),
      encryption: purposeKey(secret, ENCRYPTION_PURPOSE)
    });
  };
  addKeys(currentVersion, currentPepper);
  for (const [version, secret] of Object.entries(previousPeppers)) {
    addKeys(keyVersion(version), pepperBytes(secret));
  }
  const verifierVersions = Object.freeze([...keyring.keys()]);

  const dedicatedNames = [
    ACCOUNT_SID_ENVIRONMENT,
    TWILIO_RESPONDER_VOICE_API_KEY_SID_ENVIRONMENT,
    TWILIO_RESPONDER_VOICE_API_KEY_SECRET_ENVIRONMENT,
    TWILIO_RESPONDER_VOICE_SANDBOX_PUSH_CREDENTIAL_ENVIRONMENT,
    TWILIO_RESPONDER_VOICE_PRODUCTION_PUSH_CREDENTIAL_ENVIRONMENT,
    TWILIO_RESPONDER_VOICE_ANDROID_SANDBOX_PUSH_CREDENTIAL_ENVIRONMENT,
    TWILIO_RESPONDER_VOICE_ANDROID_PRODUCTION_PUSH_CREDENTIAL_ENVIRONMENT
  ];
  invariant(
    dedicatedNames.every((name) => selectedValue(environment, name) === null),
    "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED",
    "Global Twilio Voice customer credentials are forbidden.",
    { status: 500 }
  );
  if (mode === "held") {
    invariant(
      providerRegistry === null && providerTopologyRepository === null,
      "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED",
      "Twilio customer provider authority cannot be staged while Voice access is held.",
      { status: 500 }
    );
  } else {
    invariant(
      providerRegistry?.kind === "twilio-isv-provider-registry" &&
        providerRegistry.providerEffects === false &&
        typeof providerRegistry.resolveOrganization === "function" &&
        typeof providerRegistry.readiness === "function" &&
        providerTopologyRepository?.kind ===
          "responder-twilio-provider-topology-postgres" &&
        providerTopologyRepository.providerEffects === false &&
        typeof providerTopologyRepository.requireActiveTopology === "function" &&
        typeof providerTopologyRepository.readiness === "function",
      "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED",
      "Verified Voice access requires customer-isolated Twilio authority.",
      { status: 500 }
    );
  }

  function opaqueAuthority(selected, selectedKeys) {
    const identityDigest = hmacHex(selectedKeys.identity, {
      schema: IDENTITY_PURPOSE,
      organizationId: selected.organizationId,
      projectId: selected.projectId,
      userId: selected.userId,
      installationId: selected.installationId,
      installationRevision: selected.installationRevision,
      clientPlatform: selected.clientPlatform,
      transport: selected.transport,
      appEnvironment: selected.appEnvironment
    });
    const endpointDigest = hmacHex(selectedKeys.endpoint, {
      schema: ENDPOINT_PURPOSE,
      installationId: selected.installationId,
      clientPlatform: selected.clientPlatform,
      transport: selected.transport,
      appEnvironment: selected.appEnvironment
    });
    return {
      identity: `ssr_${identityDigest.slice(0, 48)}`,
      endpointId:
        `ssr_${selected.clientPlatform}_${endpointDigest.slice(0, 48)}`,
      identityDigest,
      endpointDigest
    };
  }

  function metadataFor(
    selected,
    decoded,
    opaque,
    pushCredentialSid,
    provider
  ) {
    invariant(
      decoded.header?.alg === "HS256" &&
        decoded.header?.cty === "twilio-fpa;v=1" &&
        decoded.payload?.iss === provider.apiKeySid &&
        decoded.payload?.sub === provider.accountSid &&
        decoded.payload?.grants?.identity === opaque.identity &&
        decoded.payload?.grants?.voice?.incoming?.allow === true &&
        decoded.payload?.grants?.voice?.push_credential_sid ===
          pushCredentialSid &&
        decoded.payload?.grants?.voice?.endpoint_id === opaque.endpointId &&
        decoded.payload?.grants?.voice?.outgoing === undefined &&
        typeof decoded.payload?.jti === "string" &&
        Number.isSafeInteger(decoded.payload?.iat) &&
        Number.isSafeInteger(decoded.payload?.exp) &&
        decoded.payload.exp - SESSION_TTL_SECONDS === decoded.payload.iat,
      "TWILIO_RESPONDER_VOICE_ACCESS_UNAVAILABLE",
      "Twilio Voice access token generation failed.",
      { status: 503 }
    );
    const expiresAt = new Date(decoded.payload.exp * 1000).toISOString();
    const issuedAt = new Date(
      (decoded.payload.exp - SESSION_TTL_SECONDS) * 1000
    ).toISOString();
    return Object.freeze({
      issuedAt,
      expiresAt,
      identityDigest: opaque.identityDigest,
      endpointDigest: opaque.endpointDigest,
      credentialDigest: digest({
        schema: "sitesourcery.responder-twilio-voice-credential/v1",
        accountSid: provider.accountSid,
        apiKeySid: provider.apiKeySid,
        pushCredentialSid,
        clientPlatform: selected.clientPlatform,
        transport: selected.transport,
        appEnvironment: selected.appEnvironment
      }),
      jtiDigest: digest(decoded.payload.jti)
    });
  }

  function seal(selected, metadata, accessToken) {
    const keys = keyring.get(currentVersion);
    const tokenDigest = digest(accessToken);
    const bound = { ...metadata, tokenDigest };
    const nonce = Buffer.from(randomBytes(12));
    invariant(
      nonce.length === 12,
      "TWILIO_RESPONDER_VOICE_ACCESS_UNAVAILABLE",
      "Twilio Voice access token sealing failed.",
      { status: 503 }
    );
    const cleartext = Buffer.from(canonicalJson({
      schema: "sitesourcery.responder-native-voice-access-token/v1",
      accessToken
    }), "utf8");
    try {
      const cipher = createCipheriv("aes-256-gcm", keys.encryption, nonce);
      cipher.setAAD(envelopeAad(selected, bound, currentVersion));
      const ciphertext = Buffer.concat([cipher.update(cleartext), cipher.final()]);
      const authenticationTag = cipher.getAuthTag();
      return {
        ...bound,
        envelope: Object.freeze({
          keyVersion: currentVersion,
          nonce,
          authenticationTag,
          ciphertext
        })
      };
    } finally {
      cleartext.fill(0);
    }
  }

  function open(selected, metadata, envelopeValue) {
    const selectedEnvelope = envelope(envelopeValue);
    const keys = keyring.get(selectedEnvelope.keyVersion);
    invariant(
      keys,
      "TWILIO_RESPONDER_VOICE_ACCESS_UNAVAILABLE",
      "Twilio Voice access token key is unavailable.",
      { status: 503 }
    );
    let cleartext;
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm", keys.encryption, selectedEnvelope.nonce
      );
      decipher.setAAD(envelopeAad(
        selected,
        metadata,
        selectedEnvelope.keyVersion
      ));
      decipher.setAuthTag(selectedEnvelope.authenticationTag);
      cleartext = Buffer.concat([
        decipher.update(selectedEnvelope.ciphertext), decipher.final()
      ]);
      const parsed = JSON.parse(cleartext.toString("utf8"));
      exactObject(parsed, ["schema", "accessToken"],
        "TWILIO_RESPONDER_VOICE_ACCESS_UNAVAILABLE",
        "Twilio Voice access token could not be opened.", 503);
      invariant(
        parsed.schema ===
          "sitesourcery.responder-native-voice-access-token/v1" &&
          typeof parsed.accessToken === "string" &&
          digest(parsed.accessToken) === metadata.tokenDigest,
        "TWILIO_RESPONDER_VOICE_ACCESS_UNAVAILABLE",
        "Twilio Voice access token could not be opened.",
        { status: 503 }
      );
      return parsed.accessToken;
    } catch (error) {
      if (error instanceof HostedError) throw error;
      throw new HostedError(
        "TWILIO_RESPONDER_VOICE_ACCESS_UNAVAILABLE",
        "Twilio Voice access token could not be opened.",
        { status: 503 }
      );
    } finally {
      cleartext?.fill(0);
    }
  }

  async function currentProvider(selected) {
    const providerAuthority = providerRegistry.resolveOrganization(
      selected.organizationId
    );
    await providerTopologyRepository.requireActiveTopology(
      providerAuthority.topology
    );
    const slotAware = providerAuthority.topology.schema === "sitesourcery.twilio-isv-provider-topology/v2";
    if (slotAware) {
      try {
        normalizeTwilioPushSlots({
          enabledPushSlots: providerAuthority.topology.enabledPushSlots,
          ...Object.fromEntries(Object.values(TWILIO_PUSH_SLOTS).map((field) => [field, providerAuthority[field]]))
        });
      } catch { throw configurationError("Twilio Voice push slots are invalid."); }
      invariant(providerAuthority.topology.enabledPushSlots.includes(
        `${selected.clientPlatform}.${selected.appEnvironment}`
      ), "RESPONDER_NATIVE_VOIP_HELD", "This native Voice platform/environment remains held.",
      { status: 409, details: { providerEffects: false } });
    }
    const provider = Object.freeze({
      accountSid: providerSid(
        { value: providerAuthority.accountSid }, "value", ACCOUNT_SID
      ),
      apiKeySid: providerSid(
        { value: providerAuthority.voiceApiKeySid }, "value", API_KEY_SID
      ),
      apiKeySecret: providerSecret(
        { value: providerAuthority.voiceApiKeySecret }, "value"
      ),
      pushCredentials: Object.freeze(Object.fromEntries(["ios", "android"].map((platform) => [
        platform, Object.freeze(Object.fromEntries(["sandbox", "production"].map((environment) => {
          const value = providerAuthority[TWILIO_PUSH_SLOTS[`${platform}.${environment}`]];
          return [environment, slotAware && value === null ? null : providerSid({ value }, "value", PUSH_CREDENTIAL_SID)];
        })))
      ])))
    });
    const configured = Object.values(provider.pushCredentials).flatMap((platform) => Object.values(platform))
      .filter((value) => value !== null);
    invariant(configured.length > 0 && new Set(configured).size === configured.length,
      "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED",
      "Twilio Voice platform Push Credentials must be distinct.", { status: 500 });
    invariant(provider.pushCredentials[selected.clientPlatform][selected.appEnvironment] !== null,
      "RESPONDER_NATIVE_VOIP_HELD", "This native Voice platform/environment remains held.",
      { status: 409, details: { providerEffects: false } });
    return { provider, topology: providerAuthority.topology };
  }

  return Object.freeze({
    kind: "twilio-responder-voice-access",
    mode,
    provider: "twilio",
    transports: Object.freeze(["twilio_voice_ios", "twilio_voice_android"]),
    ttlSeconds: SESSION_TTL_SECONDS,
    writerVersion: currentVersion,
    verifierVersions,
    providerEffects: false,
    pushDeliveryEffects: false,
    voiceCallEffects: false,
    providerAuthorizationEffects: mode === "verified",
    async readiness() {
      const [registry, topology] = mode === "verified"
        ? await Promise.all([
            providerRegistry.readiness(),
            providerTopologyRepository.readiness()
          ])
        : [null, null];
      const signerReady = mode === "verified" &&
        registry?.ready === true && registry?.verified === true &&
        registry?.hasConfiguredPushSlot === true &&
        topology?.ready === true && topology?.verified === true;
      return deepFreeze({
        ready: mode === "held" || signerReady,
        verified: mode === "held" || signerReady,
        kind: "twilio-responder-voice-access",
        mode,
        provider: "twilio",
        transports: Object.freeze([
          "twilio_voice_ios", "twilio_voice_android"
        ]),
        signerReady,
        issuanceEnabled: mode === "verified" && signerReady,
        pushSlots: twilioPushSlotMap((slot) => {
          const [platform, environment] = slot.split(".");
          return signerReady && registry?.pushSlots?.[platform]?.[environment] === true;
        }),
        hasConfiguredPushSlot: signerReady && registry?.hasConfiguredPushSlot === true,
        legacyRoutingCompatible: signerReady && registry?.legacyRoutingCompatible === true,
        ttlSeconds: SESSION_TTL_SECONDS,
        writerVersion: currentVersion,
        verifierVersions,
        routingReady: false,
        operationalCalls: false,
        providerEffects: false,
        pushDeliveryEffects: false,
        voiceCallEffects: false,
        providerAuthorizationEffects: mode === "verified",
        secretMaterial: "redacted"
      });
    },
    async issueSession(authorityValue) {
      const selected = sessionAuthority(authorityValue);
      if (mode !== "verified") {
        throw new HostedError(
          "RESPONDER_NATIVE_VOIP_HELD",
          "Native VoIP access remains held pending explicit provider activation.",
          { status: 409 }
        );
      }
      const { provider } = await currentProvider(selected);
      const keys = keyring.get(currentVersion);
      const opaque = opaqueAuthority(selected, keys);
      const pushCredentialSid =
        provider.pushCredentials[selected.clientPlatform][selected.appEnvironment];
      let accessToken;
      try {
        accessToken = tokenFactory({
          accountSid: provider.accountSid,
          apiKeySid: provider.apiKeySid,
          apiKeySecret: provider.apiKeySecret,
          identity: opaque.identity,
          endpointId: opaque.endpointId,
          pushCredentialSid,
          ttlSeconds: SESSION_TTL_SECONDS
        });
      } catch {
        throw new HostedError(
          "TWILIO_RESPONDER_VOICE_ACCESS_UNAVAILABLE",
          "Twilio Voice access token generation failed.",
          { status: 503 }
        );
      }
      const metadata = metadataFor(
        selected, decodeJwt(accessToken), opaque, pushCredentialSid, provider
      );
      return deepFreeze({
        schema: "sitesourcery.responder-native-voice-session-internal/v1",
        ...seal(selected, metadata, accessToken),
        accessToken,
        incomingAllowed: true,
        outgoingAllowed: false,
        providerEffects: false,
        pushDeliveryEffects: false,
        voiceCallEffects: false,
        providerAuthorizationEffects: true
      });
    },
    // SDK device registration outlives the short JWT. Authenticate its sealed
    // provenance and current provider/installation authority, not exp as a route TTL.
    async resolveRoutingIdentity(authorityValue, metadataValue, envelopeValue, accountSidDigest) {
      const selected = sessionAuthority(authorityValue);
      invariant(mode === "verified" && envelopeValue.keyVersion === currentVersion,
        "RESPONDER_NATIVE_VOICE_ROUTE_UNAVAILABLE", "Native Voice route is unavailable.", { status: 503 });
      const { provider, topology } = await currentProvider(selected);
      invariant(topology.accountSidDigest === accountSidDigest,
        "RESPONDER_NATIVE_VOICE_ROUTE_UNAVAILABLE", "Native Voice route is unavailable.", { status: 503 });
      const accessToken = open(selected, metadataValue, envelopeValue);
      const opaque = opaqueAuthority(selected, keyring.get(currentVersion));
      const metadata = metadataFor(selected, decodeJwt(accessToken), opaque,
        provider.pushCredentials[selected.clientPlatform][selected.appEnvironment], provider);
      invariant(Object.entries(metadata).every(([key, value]) => metadataValue[key] === value),
        "RESPONDER_NATIVE_VOICE_ROUTE_UNAVAILABLE", "Native Voice route is unavailable.", { status: 503 });
      return opaque.identity;
    },
    async openSession(authorityValue, metadataValue, envelopeValue) {
      const selected = sessionAuthority(authorityValue);
      const metadata = exactObject(metadataValue, [
        "issuedAt", "expiresAt", "identityDigest", "endpointDigest",
        "credentialDigest", "jtiDigest", "tokenDigest"
      ], "TWILIO_RESPONDER_VOICE_ACCESS_INVALID",
      "Twilio Voice session metadata is invalid.");
      for (const field of [
        "identityDigest", "endpointDigest", "credentialDigest", "jtiDigest",
        "tokenDigest"
      ]) {
        invariant(
          typeof metadata[field] === "string" && SHA256.test(metadata[field]),
          "TWILIO_RESPONDER_VOICE_ACCESS_INVALID",
          "Twilio Voice session metadata is invalid.",
          { status: 500 }
        );
      }
      instant(metadata.issuedAt, "Voice session issue time");
      instant(metadata.expiresAt, "Voice session expiry time");
      invariant(mode === "verified", "RESPONDER_NATIVE_VOIP_HELD", "Native VoIP access remains held.", { status: 409 });
      const { provider } = await currentProvider(selected);
      const accessToken = open(selected, metadata, envelopeValue);
      const opaque = opaqueAuthority(selected, keyring.get(envelopeValue.keyVersion));
      const currentMetadata = metadataFor(selected, decodeJwt(accessToken), opaque,
        provider.pushCredentials[selected.clientPlatform][selected.appEnvironment], provider);
      invariant(Object.entries(currentMetadata).every(([key, value]) => metadata[key] === value),
        "TWILIO_RESPONDER_VOICE_ACCESS_UNAVAILABLE", "Native Voice authority changed.", { status: 503 });
      return accessToken;
    }
  });
}
