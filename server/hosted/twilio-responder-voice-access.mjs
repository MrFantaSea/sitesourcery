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
    "appEnvironment"
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
    schema: "sitesourcery.responder-native-voice-session-aad/v1",
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
    TWILIO_RESPONDER_VOICE_API_KEY_SID_ENVIRONMENT,
    TWILIO_RESPONDER_VOICE_API_KEY_SECRET_ENVIRONMENT,
    TWILIO_RESPONDER_VOICE_SANDBOX_PUSH_CREDENTIAL_ENVIRONMENT,
    TWILIO_RESPONDER_VOICE_PRODUCTION_PUSH_CREDENTIAL_ENVIRONMENT
  ];
  let provider = null;
  if (mode === "held") {
    invariant(
      dedicatedNames.every((name) => selectedValue(environment, name) === null),
      "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED",
      "Twilio Voice credentials cannot be staged while Voice access is held.",
      { status: 500 }
    );
  } else {
    provider = Object.freeze({
      accountSid: providerSid(environment, ACCOUNT_SID_ENVIRONMENT, ACCOUNT_SID),
      apiKeySid: providerSid(
        environment,
        TWILIO_RESPONDER_VOICE_API_KEY_SID_ENVIRONMENT,
        API_KEY_SID
      ),
      apiKeySecret: providerSecret(
        environment,
        TWILIO_RESPONDER_VOICE_API_KEY_SECRET_ENVIRONMENT
      ),
      pushCredentials: Object.freeze({
        sandbox: providerSid(
          environment,
          TWILIO_RESPONDER_VOICE_SANDBOX_PUSH_CREDENTIAL_ENVIRONMENT,
          PUSH_CREDENTIAL_SID
        ),
        production: providerSid(
          environment,
          TWILIO_RESPONDER_VOICE_PRODUCTION_PUSH_CREDENTIAL_ENVIRONMENT,
          PUSH_CREDENTIAL_SID
        )
      })
    });
    invariant(
      provider.pushCredentials.sandbox !== provider.pushCredentials.production,
      "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED",
      "Twilio Voice sandbox and production Push Credentials must be distinct.",
      { status: 500 }
    );
  }

  function opaqueAuthority(selected, selectedKeys) {
    const identityDigest = hmacHex(selectedKeys.identity, {
      schema: IDENTITY_PURPOSE,
      organizationId: selected.organizationId,
      projectId: selected.projectId,
      userId: selected.userId,
      appEnvironment: selected.appEnvironment
    });
    const endpointDigest = hmacHex(selectedKeys.endpoint, {
      schema: ENDPOINT_PURPOSE,
      installationId: selected.installationId,
      appEnvironment: selected.appEnvironment
    });
    return {
      identity: `ssr_${identityDigest.slice(0, 48)}`,
      endpointId: `ssr_ios_${endpointDigest.slice(0, 48)}`,
      identityDigest,
      endpointDigest
    };
  }

  function metadataFor(selected, decoded, opaque, pushCredentialSid) {
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

  return Object.freeze({
    kind: "twilio-responder-voice-access",
    mode,
    provider: "twilio",
    transport: "twilio_voice_ios",
    ttlSeconds: SESSION_TTL_SECONDS,
    writerVersion: currentVersion,
    verifierVersions,
    providerEffects: false,
    pushDeliveryEffects: false,
    voiceCallEffects: false,
    providerAuthorizationEffects: mode === "verified",
    async readiness() {
      return deepFreeze({
        ready: true,
        verified: true,
        kind: "twilio-responder-voice-access",
        mode,
        provider: "twilio",
        transport: "twilio_voice_ios",
        signerReady: provider !== null,
        issuanceEnabled: mode === "verified",
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
    issueSession(authorityValue) {
      const selected = sessionAuthority(authorityValue);
      if (mode !== "verified") {
        throw new HostedError(
          "RESPONDER_NATIVE_VOIP_HELD",
          "Native VoIP access remains held pending explicit provider activation.",
          { status: 409 }
        );
      }
      const keys = keyring.get(currentVersion);
      const opaque = opaqueAuthority(selected, keys);
      const pushCredentialSid = provider.pushCredentials[selected.appEnvironment];
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
        selected, decodeJwt(accessToken), opaque, pushCredentialSid
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
    openSession(authorityValue, metadataValue, envelopeValue) {
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
      return open(selected, metadata, envelopeValue);
    }
  });
}
