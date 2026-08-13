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
const KEY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/u;
const BASE64URL_KEY = /^[A-Za-z0-9_-]{43}$/u;
const E164 = /^\+[1-9][0-9]{1,14}$/u;

function exactObject(value, fields, code) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...fields].sort()),
    code,
    "Responder Voice target material is invalid.",
    { status: 500 }
  );
  return value;
}

function configurationError() {
  return new HostedError(
    "RESPONDER_VOICE_DIAL_TARGET_CONFIGURATION_REQUIRED",
    "Responder Voice target key configuration is invalid.",
    { status: 500 }
  );
}

function keyVersion(value) {
  if (typeof value !== "string" || !KEY_VERSION.test(value)) {
    throw configurationError();
  }
  return value;
}

function keyBytes(value) {
  if (Buffer.isBuffer(value) && value.length === 32) return Buffer.from(value);
  if (typeof value !== "string" || !BASE64URL_KEY.test(value)) {
    throw configurationError();
  }
  const selected = Buffer.from(value, "base64url");
  if (selected.length !== 32 || selected.toString("base64url") !== value) {
    throw configurationError();
  }
  return selected;
}

function authority(value) {
  exactObject(value, [
    "id", "organizationId", "projectId", "numberBindingId"
  ], "RESPONDER_VOICE_DIAL_TARGET_INVALID");
  invariant(
    [
      value.id, value.organizationId, value.projectId, value.numberBindingId
    ].every((entry) => typeof entry === "string" && UUID.test(entry)),
    "RESPONDER_VOICE_DIAL_TARGET_INVALID",
    "Responder Voice target authority is invalid.",
    { status: 500 }
  );
  return value;
}

function target(value) {
  invariant(
    typeof value === "string" && E164.test(value),
    "RESPONDER_VOICE_DIAL_TARGET_INVALID",
    "Responder Voice target is invalid.",
    { status: 400 }
  );
  return value;
}

function envelope(value) {
  exactObject(value, [
    "keyVersion", "nonce", "authenticationTag", "ciphertext"
  ], "RESPONDER_VOICE_DIAL_TARGET_INVALID");
  invariant(
    KEY_VERSION.test(value.keyVersion ?? "") &&
      Buffer.isBuffer(value.nonce) && value.nonce.length === 12 &&
      Buffer.isBuffer(value.authenticationTag) &&
      value.authenticationTag.length === 16 &&
      Buffer.isBuffer(value.ciphertext) &&
      value.ciphertext.length >= 16 && value.ciphertext.length <= 512,
    "RESPONDER_VOICE_DIAL_TARGET_INVALID",
    "Responder Voice target envelope is invalid.",
    { status: 500 }
  );
  return value;
}

function aad(selectedAuthority, selectedKeyVersion) {
  return Buffer.from(canonicalJson({
    ...selectedAuthority,
    keyVersion: selectedKeyVersion,
    schema: "sitesourcery.responder-voice-dial-target-aad/v1"
  }), "utf8");
}

function plaintext(selectedTarget) {
  return Buffer.from(canonicalJson({
    schema: "sitesourcery.responder-voice-dial-target/v1",
    target: selectedTarget
  }), "utf8");
}

export function createResponderVoiceDialTargetVault({
  currentKeyVersion,
  currentKey,
  priorKeyVersion = null,
  priorKey = null,
  randomBytes = systemRandomBytes
} = {}) {
  const currentVersion = keyVersion(currentKeyVersion);
  const keyring = new Map([[currentVersion, keyBytes(currentKey)]]);
  invariant(
    (priorKeyVersion === null) === (priorKey === null) &&
      typeof randomBytes === "function",
    "RESPONDER_VOICE_DIAL_TARGET_CONFIGURATION_REQUIRED",
    "Responder Voice target key configuration is incomplete.",
    { status: 500 }
  );
  if (priorKeyVersion !== null) {
    const selectedPriorVersion = keyVersion(priorKeyVersion);
    invariant(
      selectedPriorVersion !== currentVersion,
      "RESPONDER_VOICE_DIAL_TARGET_CONFIGURATION_REQUIRED",
      "Responder Voice target key versions must be distinct.",
      { status: 500 }
    );
    keyring.set(selectedPriorVersion, keyBytes(priorKey));
  }

  return Object.freeze({
    kind: "responder-voice-dial-target-vault",
    providerEffects: false,
    async readiness() {
      return deepFreeze({
        ready: keyring.size >= 1 && keyring.size <= 2,
        verified: keyring.size >= 1 && keyring.size <= 2,
        kind: "responder-voice-dial-target-vault",
        providerEffects: false,
        currentKeyConfigured: true,
        priorKeyConfigured: keyring.size === 2
      });
    },
    async sealTarget(selectedAuthority, value) {
      const selected = authority(selectedAuthority);
      const selectedTarget = target(value);
      const nonce = Buffer.from(randomBytes(12));
      invariant(
        nonce.length === 12,
        "RESPONDER_VOICE_DIAL_TARGET_UNAVAILABLE",
        "Responder Voice target encryption is unavailable.",
        { status: 503 }
      );
      const cleartext = plaintext(selectedTarget);
      try {
        const cipher = createCipheriv(
          "aes-256-gcm", keyring.get(currentVersion), nonce
        );
        cipher.setAAD(aad(selected, currentVersion));
        const ciphertext = Buffer.concat([
          cipher.update(cleartext), cipher.final()
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
    async openTarget(selectedAuthority, value) {
      const selected = authority(selectedAuthority);
      const selectedEnvelope = envelope(value);
      const key = keyring.get(selectedEnvelope.keyVersion);
      invariant(
        key,
        "RESPONDER_VOICE_DIAL_TARGET_UNAVAILABLE",
        "Responder Voice target key is unavailable.",
        { status: 503 }
      );
      let cleartext;
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm", key, selectedEnvelope.nonce
        );
        decipher.setAAD(aad(selected, selectedEnvelope.keyVersion));
        decipher.setAuthTag(selectedEnvelope.authenticationTag);
        cleartext = Buffer.concat([
          decipher.update(selectedEnvelope.ciphertext), decipher.final()
        ]);
        const parsed = JSON.parse(cleartext.toString("utf8"));
        exactObject(
          parsed,
          ["schema", "target"],
          "RESPONDER_VOICE_DIAL_TARGET_UNAVAILABLE"
        );
        invariant(
          parsed.schema === "sitesourcery.responder-voice-dial-target/v1",
          "RESPONDER_VOICE_DIAL_TARGET_UNAVAILABLE",
          "Responder Voice target could not be opened.",
          { status: 503 }
        );
        return target(parsed.target);
      } catch (error) {
        if (error instanceof HostedError) throw error;
        throw new HostedError(
          "RESPONDER_VOICE_DIAL_TARGET_UNAVAILABLE",
          "Responder Voice target could not be opened.",
          { status: 503 }
        );
      } finally {
        cleartext?.fill(0);
      }
    }
  });
}

export function responderVoiceDialTargetVaultFromEnvironment(
  environment = process.env
) {
  return createResponderVoiceDialTargetVault({
    currentKeyVersion:
      environment?.SITESOURCERY_RESPONDER_MATERIAL_KEY_VERSION,
    currentKey:
      environment?.SITESOURCERY_RESPONDER_MATERIAL_KEY_BASE64URL,
    priorKeyVersion:
      environment?.SITESOURCERY_RESPONDER_MATERIAL_PRIOR_KEY_VERSION || null,
    priorKey:
      environment?.SITESOURCERY_RESPONDER_MATERIAL_PRIOR_KEY_BASE64URL || null
  });
}
