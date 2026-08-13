import {
  createCipheriv,
  createDecipheriv,
  randomBytes as systemRandomBytes
} from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson } from "./security.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const KEY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/u;
const BASE64URL_KEY = /^[A-Za-z0-9_-]{43}$/u;
const E164 = /^\+[1-9][0-9]{1,14}$/u;
const CHANNELS = new Set(["sms", "voice"]);

function exactObject(value, fields, code, message) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...fields].sort()),
    code,
    message,
    { status: 500 }
  );
  return value;
}

function configurationError(message) {
  return new HostedError(
    "RESPONDER_INBOUND_MATERIAL_CONFIGURATION_REQUIRED",
    message,
    { status: 500 }
  );
}

function keyVersion(value, field) {
  if (typeof value !== "string" || !KEY_VERSION.test(value)) {
    throw configurationError(`${field} is invalid.`);
  }
  return value;
}

function keyBytes(value, field) {
  if (Buffer.isBuffer(value) && value.length === 32) {
    return Buffer.from(value);
  }
  if (typeof value !== "string" || !BASE64URL_KEY.test(value)) {
    throw configurationError(`${field} is invalid.`);
  }
  const selected = Buffer.from(value, "base64url");
  if (
    selected.length !== 32 ||
    selected.toString("base64url") !== value
  ) {
    throw configurationError(`${field} is invalid.`);
  }
  return selected;
}

function authority(value) {
  exactObject(value, [
    "inboundEventId", "organizationId", "projectId", "channel",
    "fromRouteDigest", "payloadDigest"
  ], "RESPONDER_INBOUND_MATERIAL_INVALID",
  "Responder inbound material authority is invalid.");
  invariant(
    UUID.test(value.inboundEventId) &&
      UUID.test(value.organizationId) &&
      UUID.test(value.projectId) &&
      CHANNELS.has(value.channel) &&
      SHA256.test(value.fromRouteDigest) &&
      SHA256.test(value.payloadDigest),
    "RESPONDER_INBOUND_MATERIAL_INVALID",
    "Responder inbound material authority is invalid.",
    { status: 500 }
  );
  return value;
}

// The authority's caller-route digest was keyed under whichever identity
// pepper was current at seal time. Validation therefore accepts any digest
// the configured keyring can still produce, so a pepper rotation never
// strands previously sealed evidence.
function candidateMatch(fromRouteDigestCandidates, from, expectedDigest) {
  const candidates = fromRouteDigestCandidates(from, expectedDigest);
  return Array.isArray(candidates) &&
    candidates.length >= 1 &&
    candidates.length <= 8 &&
    candidates.every(
      (candidate) => typeof candidate === "string" &&
        SHA256.test(candidate)
    ) &&
    candidates.includes(expectedDigest);
}

function material(value, selectedAuthority, fromRouteDigestCandidates) {
  if (selectedAuthority.channel === "sms") {
    exactObject(value, ["from", "body"],
      "RESPONDER_INBOUND_MATERIAL_INVALID",
      "Responder inbound SMS material is invalid.");
    invariant(
      E164.test(value.from) &&
        typeof value.body === "string" &&
        value.body.length <= 1600 &&
        !value.body.includes("\u0000") &&
        !value.body.includes("\ufffd") &&
        candidateMatch(fromRouteDigestCandidates, value.from, selectedAuthority.fromRouteDigest),
      "RESPONDER_INBOUND_MATERIAL_INVALID",
      "Responder inbound SMS material does not match its authority.",
      { status: 500 }
    );
    return value;
  }
  exactObject(value, ["from", "forwardedFrom"],
    "RESPONDER_INBOUND_MATERIAL_INVALID",
    "Responder inbound voice material is invalid.");
  invariant(
    E164.test(value.from) &&
      (value.forwardedFrom === null || E164.test(value.forwardedFrom)) &&
      candidateMatch(fromRouteDigestCandidates, value.from, selectedAuthority.fromRouteDigest),
    "RESPONDER_INBOUND_MATERIAL_INVALID",
    "Responder inbound voice material does not match its authority.",
    { status: 500 }
  );
  return value;
}

function envelope(value) {
  exactObject(value, [
    "keyVersion", "nonce", "authenticationTag", "ciphertext"
  ], "RESPONDER_INBOUND_MATERIAL_INVALID",
  "Responder inbound material envelope is invalid.");
  invariant(
    KEY_VERSION.test(value.keyVersion ?? "") &&
      Buffer.isBuffer(value.nonce) && value.nonce.length === 12 &&
      Buffer.isBuffer(value.authenticationTag) &&
        value.authenticationTag.length === 16 &&
      Buffer.isBuffer(value.ciphertext) &&
        value.ciphertext.length >= 16 && value.ciphertext.length <= 8192,
    "RESPONDER_INBOUND_MATERIAL_INVALID",
    "Responder inbound material envelope is invalid.",
    { status: 500 }
  );
  return value;
}

function aad(selectedAuthority, selectedKeyVersion) {
  return Buffer.from(canonicalJson({
    ...selectedAuthority,
    keyVersion: selectedKeyVersion,
    schema: "sitesourcery.responder-inbound-material-aad/v1"
  }), "utf8");
}

function plaintext(selectedAuthority, selectedMaterial) {
  if (selectedAuthority.channel === "sms") {
    return Buffer.from(canonicalJson({
      schema: "sitesourcery.responder-inbound-sms-material/v1",
      from: selectedMaterial.from,
      body: selectedMaterial.body
    }), "utf8");
  }
  return Buffer.from(canonicalJson({
    schema: "sitesourcery.responder-inbound-voice-material/v1",
    from: selectedMaterial.from,
    forwardedFrom: selectedMaterial.forwardedFrom
  }), "utf8");
}

function openedMaterial(bytes, selectedAuthority, fromRouteDigestCandidates) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    parsed = null;
  }
  if (selectedAuthority.channel === "sms") {
    exactObject(parsed, ["schema", "from", "body"],
      "RESPONDER_INBOUND_MATERIAL_UNAVAILABLE",
      "Responder inbound material could not be opened.");
    invariant(
      parsed.schema === "sitesourcery.responder-inbound-sms-material/v1",
      "RESPONDER_INBOUND_MATERIAL_UNAVAILABLE",
      "Responder inbound material could not be opened.",
      { status: 503 }
    );
    material(
      { from: parsed.from, body: parsed.body },
      selectedAuthority,
      fromRouteDigestCandidates
    );
    return deepFreeze({ from: parsed.from, body: parsed.body });
  }
  exactObject(parsed, ["schema", "from", "forwardedFrom"],
    "RESPONDER_INBOUND_MATERIAL_UNAVAILABLE",
    "Responder inbound material could not be opened.");
  invariant(
    parsed.schema === "sitesourcery.responder-inbound-voice-material/v1",
    "RESPONDER_INBOUND_MATERIAL_UNAVAILABLE",
    "Responder inbound material could not be opened.",
    { status: 503 }
  );
  material(
    { from: parsed.from, forwardedFrom: parsed.forwardedFrom },
    selectedAuthority,
    fromRouteDigestCandidates
  );
  return deepFreeze({ from: parsed.from, forwardedFrom: parsed.forwardedFrom });
}

export function createResponderInboundMaterialVault({
  currentKeyVersion,
  currentKey,
  priorKeyVersion = null,
  priorKey = null,
  fromRouteDigestCandidates,
  randomBytes = systemRandomBytes
} = {}) {
  const currentVersion = keyVersion(
    currentKeyVersion,
    "Current Responder material key version"
  );
  const keyring = new Map([[currentVersion, keyBytes(
    currentKey,
    "Current Responder material key"
  )]]);
  invariant(
    (priorKeyVersion === null) === (priorKey === null) &&
      typeof fromRouteDigestCandidates === "function" &&
      typeof randomBytes === "function",
    "RESPONDER_INBOUND_MATERIAL_CONFIGURATION_REQUIRED",
    "Prior Responder material key configuration is incomplete.",
    { status: 500 }
  );
  if (priorKeyVersion !== null) {
    const priorVersion = keyVersion(
      priorKeyVersion,
      "Prior Responder material key version"
    );
    invariant(
      priorVersion !== currentVersion,
      "RESPONDER_INBOUND_MATERIAL_CONFIGURATION_REQUIRED",
      "Responder material key versions must be distinct.",
      { status: 500 }
    );
    keyring.set(priorVersion, keyBytes(
      priorKey,
      "Prior Responder material key"
    ));
  }

  return Object.freeze({
    kind: "responder-inbound-material-vault",
    providerEffects: false,
    async readiness() {
      return deepFreeze({
        ready: keyring.size >= 1 && keyring.size <= 2,
        verified: keyring.size >= 1 && keyring.size <= 2,
        kind: "responder-inbound-material-vault",
        providerEffects: false,
        currentKeyConfigured: true,
        priorKeyConfigured: keyring.size === 2
      });
    },
    async sealInboundMaterial(selectedAuthority, value) {
      const selected = authority(selectedAuthority);
      const selectedMaterial = material(value, selected, fromRouteDigestCandidates);
      const nonce = Buffer.from(randomBytes(12));
      invariant(
        nonce.length === 12,
        "RESPONDER_INBOUND_MATERIAL_UNAVAILABLE",
        "Responder inbound material encryption is unavailable.",
        { status: 503 }
      );
      const cleartext = plaintext(selected, selectedMaterial);
      try {
        const cipher = createCipheriv(
          "aes-256-gcm",
          keyring.get(currentVersion),
          nonce
        );
        cipher.setAAD(aad(selected, currentVersion));
        const ciphertext = Buffer.concat([
          cipher.update(cleartext),
          cipher.final()
        ]);
        return Object.freeze({
          keyVersion: currentVersion,
          nonce,
          authenticationTag: cipher.getAuthTag(),
          ciphertext
        });
      } finally {
        cleartext.fill(0);
      }
    },
    async openInboundMaterial(selectedAuthority, value) {
      const selected = authority(selectedAuthority);
      const selectedEnvelope = envelope(value);
      const selectedKey = keyring.get(selectedEnvelope.keyVersion);
      invariant(
        selectedKey,
        "RESPONDER_INBOUND_MATERIAL_UNAVAILABLE",
        "Responder inbound material key is unavailable.",
        { status: 503 }
      );
      let cleartext;
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          selectedKey,
          selectedEnvelope.nonce
        );
        decipher.setAAD(aad(selected, selectedEnvelope.keyVersion));
        decipher.setAuthTag(selectedEnvelope.authenticationTag);
        cleartext = Buffer.concat([
          decipher.update(selectedEnvelope.ciphertext),
          decipher.final()
        ]);
        return openedMaterial(cleartext, selected, fromRouteDigestCandidates);
      } catch (error) {
        if (
          error instanceof HostedError &&
          error.code === "RESPONDER_INBOUND_MATERIAL_UNAVAILABLE"
        ) throw error;
        throw new HostedError(
          "RESPONDER_INBOUND_MATERIAL_UNAVAILABLE",
          "Responder inbound material could not be opened.",
          { status: 503 }
        );
      } finally {
        cleartext?.fill(0);
      }
    }
  });
}

export function responderInboundMaterialVaultFromEnvironment(
  environment = process.env,
  { fromRouteDigestCandidates } = {}
) {
  const priorVersion = environment
    ?.SITESOURCERY_RESPONDER_MATERIAL_PRIOR_KEY_VERSION ?? null;
  const priorKey = environment
    ?.SITESOURCERY_RESPONDER_MATERIAL_PRIOR_KEY_BASE64URL ?? null;
  return createResponderInboundMaterialVault({
    currentKeyVersion:
      environment?.SITESOURCERY_RESPONDER_MATERIAL_KEY_VERSION,
    currentKey:
      environment?.SITESOURCERY_RESPONDER_MATERIAL_KEY_BASE64URL,
    priorKeyVersion: priorVersion || null,
    priorKey: priorKey || null,
    fromRouteDigestCandidates
  });
}
