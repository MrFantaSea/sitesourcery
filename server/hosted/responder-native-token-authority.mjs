import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes as systemRandomBytes,
  timingSafeEqual
} from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson } from "./security.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,39}$/u;
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{2,199}$/u;
const IOS_TOKEN = /^(?:[0-9a-f]{2}){1,512}$/u;
const ANDROID_TOKEN = /^[A-Za-z0-9_:-]{20,4096}$/u;
const PLATFORMS = new Set(["ios", "android"]);
const ENVIRONMENTS = new Set(["sandbox", "production"]);
const PURPOSES = new Set(["notification", "voip"]);
const LOOKUP_PURPOSE =
  "sitesourcery.responder-native-push-token-lookup/v1";
const ENCRYPTION_PURPOSE =
  "sitesourcery.responder-native-push-token-encryption/v1";

function exactObject(value, fields, code) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...fields].sort()),
    code,
    "Responder native token authority is invalid.",
    { status: 500 }
  );
  return value;
}
function configurationError() {
  return new HostedError(
    "RESPONDER_NATIVE_TOKEN_CONFIGURATION_REQUIRED",
    "Responder native token key configuration is invalid.",
    { status: 500 }
  );
}

function keyVersion(value) {
  if (typeof value !== "string" || !VERSION.test(value)) {
    throw configurationError();
  }
  return value;
}

function pepperBytes(value) {
  if (
    !Buffer.isBuffer(value) || value.byteLength < 32 ||
    value.byteLength > 128
  ) throw configurationError();
  return Buffer.from(value);
}

function purposeKey(pepper, purpose) {
  return createHmac("sha256", pepper).update(purpose, "utf8").digest();
}

function installationAuthority(value) {
  exactObject(value, [
    "id", "organizationId", "projectId", "userId", "platform",
    "bundleId", "environment"
  ], "RESPONDER_NATIVE_TOKEN_INVALID");
  invariant(
    [value.id, value.organizationId, value.projectId, value.userId]
      .every((entry) => typeof entry === "string" && UUID.test(entry)) &&
      PLATFORMS.has(value.platform) &&
      typeof value.bundleId === "string" && BUNDLE_ID.test(value.bundleId) &&
      ENVIRONMENTS.has(value.environment),
    "RESPONDER_NATIVE_TOKEN_INVALID",
    "Responder native installation authority is invalid.",
    { status: 400 }
  );
  return value;
}

function purpose(value, platform) {
  invariant(
    PURPOSES.has(value) && (value !== "voip" || platform === "ios"),
    "RESPONDER_NATIVE_TOKEN_INVALID",
    "Responder native push purpose is invalid.",
    { status: 400 }
  );
  return value;
}

function token(value, platform) {
  invariant(
    typeof value === "string" &&
      (platform === "ios" ? IOS_TOKEN.test(value) : ANDROID_TOKEN.test(value)),
    "RESPONDER_NATIVE_TOKEN_INVALID",
    "Responder native push token is invalid.",
    { status: 400 }
  );
  return value;
}

function digestFor(key, selectedAuthority, selectedPurpose, selectedToken) {
  return createHmac("sha256", key)
    .update(canonicalJson({
      schema: LOOKUP_PURPOSE,
      platform: selectedAuthority.platform,
      bundleId: selectedAuthority.bundleId,
      environment: selectedAuthority.environment,
      purpose: selectedPurpose,
      token: selectedToken
    }), "utf8")
    .digest("hex");
}

function aad(
  selectedAuthority,
  selectedPurpose,
  selectedKeyVersion,
  tokenLookupDigest
) {
  return Buffer.from(canonicalJson({
    schema: "sitesourcery.responder-native-push-token-aad/v1",
    ...selectedAuthority,
    purpose: selectedPurpose,
    keyVersion: selectedKeyVersion,
    tokenLookupDigest
  }), "utf8");
}

function plaintext(selectedToken) {
  return Buffer.from(canonicalJson({
    schema: "sitesourcery.responder-native-push-token/v1",
    token: selectedToken
  }), "utf8");
}

function envelope(value) {
  exactObject(value, [
    "keyVersion", "tokenLookupDigest", "nonce", "authenticationTag",
    "ciphertext"
  ], "RESPONDER_NATIVE_TOKEN_INVALID");
  invariant(
    VERSION.test(value.keyVersion ?? "") &&
      SHA256.test(value.tokenLookupDigest ?? "") &&
      Buffer.isBuffer(value.nonce) && value.nonce.length === 12 &&
      Buffer.isBuffer(value.authenticationTag) &&
      value.authenticationTag.length === 16 &&
      Buffer.isBuffer(value.ciphertext) &&
      value.ciphertext.length >= 16 && value.ciphertext.length <= 8192,
    "RESPONDER_NATIVE_TOKEN_INVALID",
    "Responder native token envelope is invalid.",
    { status: 500 }
  );
  return value;
}

export function createResponderNativeTokenAuthority({
  pepper,
  pepperVersion,
  previousPeppers = {},
  randomBytes = systemRandomBytes
} = {}) {
  const currentVersion = keyVersion(pepperVersion);
  const currentPepper = pepperBytes(pepper);
  invariant(
    previousPeppers !== null && typeof previousPeppers === "object" &&
      !Array.isArray(previousPeppers) && typeof randomBytes === "function",
    "RESPONDER_NATIVE_TOKEN_CONFIGURATION_REQUIRED",
    "Responder native token key configuration is incomplete.",
    { status: 500 }
  );
  const keyring = new Map();
  keyring.set(currentVersion, {
    lookup: purposeKey(currentPepper, LOOKUP_PURPOSE),
    encryption: purposeKey(currentPepper, ENCRYPTION_PURPOSE)
  });
  for (const [version, priorPepper] of Object.entries(previousPeppers)) {
    const selectedVersion = keyVersion(version);
    invariant(
      selectedVersion !== currentVersion && !keyring.has(selectedVersion),
      "RESPONDER_NATIVE_TOKEN_CONFIGURATION_REQUIRED",
      "Responder native token key versions must be distinct.",
      { status: 500 }
    );
    const bytes = pepperBytes(priorPepper);
    invariant(
      !timingSafeEqual(
        purposeKey(bytes, LOOKUP_PURPOSE),
        keyring.get(currentVersion).lookup
      ),
      "RESPONDER_NATIVE_TOKEN_CONFIGURATION_REQUIRED",
      "Responder native token keys must be distinct.",
      { status: 500 }
    );
    keyring.set(selectedVersion, {
      lookup: purposeKey(bytes, LOOKUP_PURPOSE),
      encryption: purposeKey(bytes, ENCRYPTION_PURPOSE)
    });
  }
  const verifierVersions = Object.freeze([...keyring.keys()]);

  return Object.freeze({
    kind: "responder-native-token-authority",
    providerEffects: false,
    pushDeliveryEffects: false,
    writerVersion: currentVersion,
    verifierVersions,
    async readiness() {
      return deepFreeze({
        ready: keyring.size >= 1 && keyring.size <= 4,
        verified: keyring.size >= 1 && keyring.size <= 4,
        kind: "responder-native-token-authority",
        providerEffects: false,
        pushDeliveryEffects: false,
        writerVersion: currentVersion,
        verifierVersions,
        secretMaterial: "redacted"
      });
    },
    tokenLookupCandidates(authorityValue, purposeValue, tokenValue) {
      const selectedAuthority = installationAuthority(authorityValue);
      const selectedPurpose = purpose(purposeValue, selectedAuthority.platform);
      const selectedToken = token(tokenValue, selectedAuthority.platform);
      return deepFreeze([...keyring.entries()].map(([version, keys]) => ({
        keyVersion: version,
        digest: digestFor(
          keys.lookup,
          selectedAuthority,
          selectedPurpose,
          selectedToken
        )
      })));
    },
    async sealToken(authorityValue, purposeValue, tokenValue) {
      const selectedAuthority = installationAuthority(authorityValue);
      const selectedPurpose = purpose(purposeValue, selectedAuthority.platform);
      const selectedToken = token(tokenValue, selectedAuthority.platform);
      const keys = keyring.get(currentVersion);
      const tokenLookupDigest = digestFor(
        keys.lookup,
        selectedAuthority,
        selectedPurpose,
        selectedToken
      );
      const nonce = Buffer.from(randomBytes(12));
      invariant(
        nonce.length === 12,
        "RESPONDER_NATIVE_TOKEN_UNAVAILABLE",
        "Responder native token encryption is unavailable.",
        { status: 503 }
      );
      const cleartext = plaintext(selectedToken);
      try {
        const cipher = createCipheriv("aes-256-gcm", keys.encryption, nonce);
        cipher.setAAD(aad(
          selectedAuthority,
          selectedPurpose,
          currentVersion,
          tokenLookupDigest
        ));
        const ciphertext = Buffer.concat([
          cipher.update(cleartext), cipher.final()
        ]);
        return Object.freeze({
          keyVersion: currentVersion,
          tokenLookupDigest,
          nonce,
          authenticationTag: cipher.getAuthTag(),
          ciphertext
        });
      } finally {
        cleartext.fill(0);
      }
    },
    async openToken(authorityValue, purposeValue, envelopeValue) {
      const selectedAuthority = installationAuthority(authorityValue);
      const selectedPurpose = purpose(purposeValue, selectedAuthority.platform);
      const selectedEnvelope = envelope(envelopeValue);
      const keys = keyring.get(selectedEnvelope.keyVersion);
      invariant(
        keys,
        "RESPONDER_NATIVE_TOKEN_UNAVAILABLE",
        "Responder native token key is unavailable.",
        { status: 503 }
      );
      let cleartext;
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm", keys.encryption, selectedEnvelope.nonce
        );
        decipher.setAAD(aad(
          selectedAuthority,
          selectedPurpose,
          selectedEnvelope.keyVersion,
          selectedEnvelope.tokenLookupDigest
        ));
        decipher.setAuthTag(selectedEnvelope.authenticationTag);
        cleartext = Buffer.concat([
          decipher.update(selectedEnvelope.ciphertext), decipher.final()
        ]);
        const parsed = JSON.parse(cleartext.toString("utf8"));
        exactObject(
          parsed,
          ["schema", "token"],
          "RESPONDER_NATIVE_TOKEN_UNAVAILABLE"
        );
        invariant(
          parsed.schema === "sitesourcery.responder-native-push-token/v1",
          "RESPONDER_NATIVE_TOKEN_UNAVAILABLE",
          "Responder native token could not be opened.",
          { status: 503 }
        );
        const selectedToken = token(parsed.token, selectedAuthority.platform);
        const expectedDigest = digestFor(
          keys.lookup,
          selectedAuthority,
          selectedPurpose,
          selectedToken
        );
        invariant(
          expectedDigest === selectedEnvelope.tokenLookupDigest,
          "RESPONDER_NATIVE_TOKEN_UNAVAILABLE",
          "Responder native token could not be opened.",
          { status: 503 }
        );
        return selectedToken;
      } catch (error) {
        if (error instanceof HostedError) throw error;
        throw new HostedError(
          "RESPONDER_NATIVE_TOKEN_UNAVAILABLE",
          "Responder native token could not be opened.",
          { status: 503 }
        );
      } finally {
        cleartext?.fill(0);
      }
    }
  });
}
