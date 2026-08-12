import {
  createCipheriv,
  createDecipheriv,
  randomBytes as systemRandomBytes
} from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const KEY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/u;
const BASE64URL_KEY = /^[A-Za-z0-9_-]{43}$/u;
const MESSAGE_KINDS = new Set([
  "missed_call_ack",
  "human_handoff_ack"
]);

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
    "RESPONDER_PRIVATE_MATERIAL_CONFIGURATION_REQUIRED",
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
    "operationId", "organizationId", "projectId", "interactionId",
    "contactAuthorityId", "messageKind", "routeDigest", "contentDigest"
  ], "RESPONDER_PRIVATE_MATERIAL_INVALID",
  "Responder private material authority is invalid.");
  invariant(
    UUID.test(value.operationId) &&
      UUID.test(value.organizationId) &&
      UUID.test(value.projectId) &&
      UUID.test(value.interactionId) &&
      UUID.test(value.contactAuthorityId) &&
      MESSAGE_KINDS.has(value.messageKind) &&
      SHA256.test(value.routeDigest) &&
      SHA256.test(value.contentDigest),
    "RESPONDER_PRIVATE_MATERIAL_INVALID",
    "Responder private material authority is invalid.",
    { status: 500 }
  );
  return value;
}

function smsRouteDigest(address) {
  return digest({ routeKind: "sms", address });
}

function smsContentDigest(body) {
  return digest({ contentKind: "sms", body });
}

function material(value, selectedAuthority) {
  exactObject(value, ["to", "body"],
    "RESPONDER_PRIVATE_MATERIAL_INVALID",
    "Responder private SMS material is invalid.");
  invariant(
    /^\+1[2-9][0-9]{9}$/u.test(value.to) &&
      typeof value.body === "string" &&
      value.body.length >= 1 &&
      value.body.length <= 320 &&
      /^[\x20-\x7e\r\n]+$/u.test(value.body) &&
      !/[\r\n]{3,}/u.test(value.body) &&
      value.body.includes("Reply STOP to opt out.") &&
      smsRouteDigest(value.to) === selectedAuthority.routeDigest &&
      smsContentDigest(value.body) === selectedAuthority.contentDigest,
    "RESPONDER_PRIVATE_MATERIAL_INVALID",
    "Responder private SMS material does not match its authority.",
    { status: 500 }
  );
  return value;
}

function envelope(value) {
  exactObject(value, [
    "keyVersion", "nonce", "authenticationTag", "ciphertext"
  ], "RESPONDER_PRIVATE_MATERIAL_INVALID",
  "Responder private material envelope is invalid.");
  invariant(
    KEY_VERSION.test(value.keyVersion ?? "") &&
      Buffer.isBuffer(value.nonce) && value.nonce.length === 12 &&
      Buffer.isBuffer(value.authenticationTag) &&
        value.authenticationTag.length === 16 &&
      Buffer.isBuffer(value.ciphertext) &&
        value.ciphertext.length >= 16 && value.ciphertext.length <= 1024,
    "RESPONDER_PRIVATE_MATERIAL_INVALID",
    "Responder private material envelope is invalid.",
    { status: 500 }
  );
  return value;
}

function aad(selectedAuthority, selectedKeyVersion) {
  return Buffer.from(canonicalJson({
    ...selectedAuthority,
    keyVersion: selectedKeyVersion,
    schema: "sitesourcery.responder-private-material-aad/v1"
  }), "utf8");
}

function plaintext(selectedMaterial) {
  return Buffer.from(canonicalJson({
    schema: "sitesourcery.responder-private-sms-material/v1",
    to: selectedMaterial.to,
    body: selectedMaterial.body
  }), "utf8");
}

function openedMaterial(bytes, selectedAuthority) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    parsed = null;
  }
  exactObject(parsed, ["schema", "to", "body"],
    "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE",
    "Responder private material could not be opened.");
  invariant(
    parsed.schema === "sitesourcery.responder-private-sms-material/v1",
    "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE",
    "Responder private material could not be opened.",
    { status: 503 }
  );
  material({ to: parsed.to, body: parsed.body }, selectedAuthority);
  return deepFreeze({ to: parsed.to, body: parsed.body });
}

export function createResponderPrivateMaterialVault({
  currentKeyVersion,
  currentKey,
  priorKeyVersion = null,
  priorKey = null,
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
      typeof randomBytes === "function",
    "RESPONDER_PRIVATE_MATERIAL_CONFIGURATION_REQUIRED",
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
      "RESPONDER_PRIVATE_MATERIAL_CONFIGURATION_REQUIRED",
      "Responder material key versions must be distinct.",
      { status: 500 }
    );
    keyring.set(priorVersion, keyBytes(
      priorKey,
      "Prior Responder material key"
    ));
  }

  return Object.freeze({
    kind: "responder-private-material-vault",
    providerEffects: false,
    async readiness() {
      return deepFreeze({
        ready: keyring.size >= 1 && keyring.size <= 2,
        verified: keyring.size >= 1 && keyring.size <= 2,
        kind: "responder-private-material-vault",
        providerEffects: false,
        currentKeyConfigured: true,
        priorKeyConfigured: keyring.size === 2
      });
    },
    async sealSmsMaterial(selectedAuthority, value) {
      const selected = authority(selectedAuthority);
      const selectedMaterial = material(value, selected);
      const nonce = Buffer.from(randomBytes(12));
      invariant(
        nonce.length === 12,
        "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE",
        "Responder private material encryption is unavailable.",
        { status: 503 }
      );
      const cleartext = plaintext(selectedMaterial);
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
    async openSmsMaterial(selectedAuthority, value) {
      const selected = authority(selectedAuthority);
      const selectedEnvelope = envelope(value);
      const selectedKey = keyring.get(selectedEnvelope.keyVersion);
      invariant(
        selectedKey,
        "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE",
        "Responder private material key is unavailable.",
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
        return openedMaterial(cleartext, selected);
      } catch (error) {
        if (
          error instanceof HostedError &&
          error.code === "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE"
        ) throw error;
        throw new HostedError(
          "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE",
          "Responder private material could not be opened.",
          { status: 503 }
        );
      } finally {
        cleartext?.fill(0);
      }
    }
  });
}

export function responderPrivateMaterialVaultFromEnvironment(
  environment = process.env
) {
  const priorVersion = environment
    ?.SITESOURCERY_RESPONDER_MATERIAL_PRIOR_KEY_VERSION ?? null;
  const priorKey = environment
    ?.SITESOURCERY_RESPONDER_MATERIAL_PRIOR_KEY_BASE64URL ?? null;
  return createResponderPrivateMaterialVault({
    currentKeyVersion:
      environment?.SITESOURCERY_RESPONDER_MATERIAL_KEY_VERSION,
    currentKey:
      environment?.SITESOURCERY_RESPONDER_MATERIAL_KEY_BASE64URL,
    priorKeyVersion: priorVersion || null,
    priorKey: priorKey || null
  });
}
