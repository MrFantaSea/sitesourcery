import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RESPONDER_NATIVE_CLIENT_CONTRACT
} from "../responder-native-client-contract.mjs";
import {
  createResponderNativeTokenAuthority
} from "../responder-native-token-authority.mjs";

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

function authority() {
  return createResponderNativeTokenAuthority({
    pepper: Buffer.alloc(32, 7),
    pepperVersion: "v2",
    previousPeppers: { v1: Buffer.alloc(32, 3) },
    randomBytes: () => Buffer.alloc(12, 9)
  });
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
  assert.doesNotMatch(JSON.stringify(candidates), new RegExp(TOKEN, "u"));

  const envelope = await selected.sealToken(AUTHORITY, "voip", TOKEN);
  assert.equal(envelope.keyVersion, "v2");
  assert.equal(envelope.tokenLookupDigest, candidates[0].digest);
  assert.equal(await selected.openToken(AUTHORITY, "voip", envelope), TOKEN);
  assert.doesNotMatch(JSON.stringify(envelope), new RegExp(TOKEN, "u"));
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

test("native token authority enforces platform-specific token and PushKit rules", async () => {
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
  await assert.rejects(
    selected.sealToken(
      { ...AUTHORITY, platform: "android" }, "voip", "a".repeat(40)
    ),
    { code: "RESPONDER_NATIVE_TOKEN_INVALID" }
  );
  const android = await selected.sealToken(
    { ...AUTHORITY, platform: "android" },
    "notification",
    "fcm:token_value-1234567890"
  );
  assert.equal(android.keyVersion, "v2");
});
