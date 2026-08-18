import assert from "node:assert/strict";
import { createCipheriv, createHmac } from "node:crypto";
import { test } from "node:test";

import {
  RESPONDER_NATIVE_CLIENT_CONTRACT
} from "../responder-native-client-contract.mjs";
import {
  createResponderNativeTokenAuthority
} from "../responder-native-token-authority.mjs";
import { canonicalJson } from "../security.mjs";

const AUTHORITY = Object.freeze({
  id: "10000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000002",
  projectId: "10000000-0000-4000-8000-000000000003",
  userId: "10000000-0000-4000-8000-000000000004",
  platform: "ios",
  bundleId: "com.sitesourcery.responder",
  environment: "sandbox"
});
const TOKEN = "ab".repeat(32);
const LOOKUP_PURPOSE =
  "sitesourcery.responder-native-push-token-lookup/v1";
const ENCRYPTION_PURPOSE =
  "sitesourcery.responder-native-push-token-encryption/v1";

function authority() {
  return createResponderNativeTokenAuthority({
    pepper: Buffer.alloc(32, 7),
    pepperVersion: "v2",
    previousPeppers: { v1: Buffer.alloc(32, 3) },
    randomBytes: () => Buffer.alloc(12, 9)
  });
}

function purposeKey(pepper, purpose) {
  return createHmac("sha256", pepper).update(purpose, "utf8").digest();
}

function legacyEnvelope(selectedAuthority, purpose, token, pepper, version) {
  const tokenLookupDigest = createHmac(
    "sha256", purposeKey(pepper, LOOKUP_PURPOSE)
  ).update(canonicalJson({
    schema: LOOKUP_PURPOSE,
    platform: selectedAuthority.platform,
    bundleId: selectedAuthority.bundleId,
    environment: selectedAuthority.environment,
    purpose,
    token
  }), "utf8").digest("hex");
  const nonce = Buffer.alloc(12, 5);
  const cipher = createCipheriv(
    "aes-256-gcm", purposeKey(pepper, ENCRYPTION_PURPOSE), nonce
  );
  cipher.setAAD(Buffer.from(canonicalJson({
    schema: "sitesourcery.responder-native-push-token-aad/v1",
    ...selectedAuthority,
    purpose,
    keyVersion: version,
    tokenLookupDigest
  }), "utf8"));
  const cleartext = Buffer.from(canonicalJson({
    schema: "sitesourcery.responder-native-push-token/v1",
    token
  }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(cleartext), cipher.final()]);
  cleartext.fill(0);
  return {
    keyVersion: version,
    tokenLookupDigest,
    tokenOwnershipDigest: tokenLookupDigest,
    tokenReceiptDigest: null,
    nonce,
    authenticationTag: cipher.getAuthTag(),
    ciphertext
  };
}

test("native client contract keeps every external effect held", () => {
  assert.deepEqual(
    RESPONDER_NATIVE_CLIENT_CONTRACT.acceptedRegistrationPlatforms,
    ["ios", "android"]
  );
  assert.equal(RESPONDER_NATIVE_CLIENT_CONTRACT.retainedCarrier, true);
  assert.equal(RESPONDER_NATIVE_CLIENT_CONTRACT.pushDeliveryEffects, false);
  assert.equal(RESPONDER_NATIVE_CLIENT_CONTRACT.voiceCallEffects, false);
  assert.equal(RESPONDER_NATIVE_CLIENT_CONTRACT.carrierCommandEffects, false);
  assert.equal(RESPONDER_NATIVE_CLIENT_CONTRACT.messageSendEffects, false);
  assert.equal(RESPONDER_NATIVE_CLIENT_CONTRACT.providerEffects, false);
});

test("native token authority seals, opens, and rotates without raw readback", async () => {
  const selected = authority();
  const readiness = await selected.readiness();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.secretMaterial, "redacted");
  assert.deepEqual(readiness.verifierVersions, ["v2", "v1"]);

  const candidates = selected.tokenLookupCandidates(
    AUTHORITY, "voip", TOKEN
  );
  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0].digest, candidates[1].digest);
  assert.notEqual(
    candidates[0].ownershipDigest,
    candidates[1].ownershipDigest
  );
  assert.doesNotMatch(JSON.stringify(candidates), new RegExp(TOKEN, "u"));

  const envelope = await selected.sealToken(AUTHORITY, "voip", TOKEN);
  assert.equal(envelope.keyVersion, "v2");
  assert.equal(envelope.tokenLookupDigest, candidates[0].digest);
  assert.equal(
    envelope.tokenOwnershipDigest,
    candidates[0].ownershipDigest
  );
  assert.match(envelope.tokenReceiptDigest, /^[0-9a-f]{64}$/u);
  assert.equal(await selected.openToken(AUTHORITY, "voip", envelope), TOKEN);
  assert.doesNotMatch(JSON.stringify(envelope), new RegExp(TOKEN, "u"));
});

test("native token receipt is scope-bound and stable across resealing", async () => {
  const selected = authority();
  const first = await selected.sealToken(AUTHORITY, "voip", TOKEN);
  const second = await selected.sealToken(AUTHORITY, "voip", TOKEN);
  const rotatedWriter = createResponderNativeTokenAuthority({
    pepper: Buffer.alloc(32, 3),
    pepperVersion: "v1",
    randomBytes: () => Buffer.alloc(12, 8)
  });
  const rotated = await rotatedWriter.sealToken(AUTHORITY, "voip", TOKEN);
  assert.equal(first.tokenReceiptDigest, second.tokenReceiptDigest);
  assert.equal(first.tokenReceiptDigest, rotated.tokenReceiptDigest);
  assert.notEqual(
    first.tokenReceiptDigest,
    (await selected.sealToken(AUTHORITY, "notification", TOKEN))
      .tokenReceiptDigest
  );
  assert.notEqual(
    first.tokenReceiptDigest,
    (await selected.sealToken(
      { ...AUTHORITY, projectId: "20000000-0000-4000-8000-000000000003" },
      "voip",
      TOKEN
    )).tokenReceiptDigest
  );
  assert.notEqual(
    first.tokenReceiptDigest,
    (await selected.sealToken(AUTHORITY, "voip", "cd".repeat(32)))
      .tokenReceiptDigest
  );
  await assert.rejects(
    selected.openToken(AUTHORITY, "voip", {
      ...first,
      tokenReceiptDigest: "f".repeat(64)
    }),
    { code: "RESPONDER_NATIVE_TOKEN_UNAVAILABLE" }
  );
});

test("native token receipt matches the Android client fixed vector", async () => {
  const selected = authority();
  const vector = await selected.sealToken({
    id: "40000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000001",
    projectId: "20000000-0000-4000-8000-000000000001",
    userId: "30000000-0000-4000-8000-000000000001",
    platform: "android",
    bundleId: "com.sitesourcery.responder",
    environment: "sandbox"
  }, "voip", "fcm-token-aaaaaaaaaaaaaaaaaaaa");
  assert.equal(
    vector.tokenReceiptDigest,
    "2970ba920f5054b317897cce8b4a846ffa610b3200f7f6026bf4c63807ba0093"
  );
});

test("native token authority opens migrated legacy v1 ciphertext", async () => {
  const selected = authority();
  const migrated = legacyEnvelope(
    AUTHORITY, "notification", TOKEN, Buffer.alloc(32, 3), "v1"
  );
  assert.equal(
    await selected.openToken(AUTHORITY, "notification", migrated),
    TOKEN
  );
  await assert.rejects(
    selected.openToken(AUTHORITY, "notification", {
      ...migrated,
      tokenOwnershipDigest: "f".repeat(64)
    }),
    { code: "RESPONDER_NATIVE_TOKEN_INVALID" }
  );
});

test("native token authority binds ciphertext to tenant, purpose, and app", async () => {
  const selected = authority();
  const envelope = await selected.sealToken(AUTHORITY, "voip", TOKEN);
  await assert.rejects(
    selected.openToken(
      { ...AUTHORITY, organizationId: "20000000-0000-4000-8000-000000000002" },
      "voip",
      envelope
    ),
    { code: "RESPONDER_NATIVE_TOKEN_UNAVAILABLE" }
  );
  await assert.rejects(
    selected.openToken(AUTHORITY, "notification", envelope),
    { code: "RESPONDER_NATIVE_TOKEN_UNAVAILABLE" }
  );
  await assert.rejects(
    selected.openToken(
      { ...AUTHORITY, bundleId: "com.example.impostor" },
      "voip",
      envelope
    ),
    { code: "RESPONDER_NATIVE_TOKEN_UNAVAILABLE" }
  );
});

test("native token authority supports purpose-separated Android FCM Voice", async () => {
  const selected = authority();
  const variableLengthToken = "ab".repeat(17);
  const variableEnvelope = await selected.sealToken(
    AUTHORITY, "voip", variableLengthToken
  );
  assert.equal(
    await selected.openToken(AUTHORITY, "voip", variableEnvelope),
    variableLengthToken
  );
  await assert.rejects(
    selected.sealToken(AUTHORITY, "voip", "not-an-apns-token"),
    { code: "RESPONDER_NATIVE_TOKEN_INVALID" }
  );
  await assert.rejects(
    selected.sealToken(AUTHORITY, "voip", "abc"),
    { code: "RESPONDER_NATIVE_TOKEN_INVALID" }
  );
  const androidAuthority = { ...AUTHORITY, platform: "android" };
  const androidToken = "fcm:token_value-1234567890";
  const notificationCandidates = selected.tokenLookupCandidates(
    androidAuthority, "notification", androidToken
  );
  const voipCandidates = selected.tokenLookupCandidates(
    androidAuthority, "voip", androidToken
  );
  assert.notEqual(
    notificationCandidates[0].digest,
    voipCandidates[0].digest
  );
  assert.equal(
    notificationCandidates[0].ownershipDigest,
    voipCandidates[0].ownershipDigest
  );
  const androidNotification = await selected.sealToken(
    androidAuthority, "notification", androidToken
  );
  const androidVoip = await selected.sealToken(
    androidAuthority, "voip", androidToken
  );
  assert.equal(androidNotification.keyVersion, "v2");
  assert.equal(androidVoip.keyVersion, "v2");
  assert.notEqual(
    androidNotification.tokenLookupDigest,
    androidVoip.tokenLookupDigest
  );
  assert.equal(
    androidNotification.tokenOwnershipDigest,
    androidVoip.tokenOwnershipDigest
  );
  assert.equal(
    await selected.openToken(androidAuthority, "voip", androidVoip),
    androidToken
  );
});
