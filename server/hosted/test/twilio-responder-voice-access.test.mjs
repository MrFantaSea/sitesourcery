import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTwilioResponderVoiceAccess
} from "../twilio-responder-voice-access.mjs";

const AUTHORITY = Object.freeze({
  sessionId: "10000000-0000-4000-8000-000000000001",
  commandId: "native-voice-session-0001",
  requestDigest: "1".repeat(64),
  organizationId: "10000000-0000-4000-8000-000000000002",
  projectId: "10000000-0000-4000-8000-000000000003",
  userId: "10000000-0000-4000-8000-000000000004",
  installationId: "10000000-0000-4000-8000-000000000005",
  installationRevision: 3,
  appEnvironment: "sandbox"
});

const VERIFIED = Object.freeze({
  SITESOURCERY_TWILIO_VOICE_ACCESS_MODE: "verified",
  SITESOURCERY_TWILIO_ACCOUNT_SID: `AC${"1".repeat(32)}`,
  SITESOURCERY_TWILIO_VOICE_API_KEY_SID: `SK${"2".repeat(32)}`,
  SITESOURCERY_TWILIO_VOICE_API_KEY_SECRET: "voice-secret-".padEnd(40, "3"),
  SITESOURCERY_TWILIO_VOICE_SANDBOX_PUSH_CREDENTIAL_SID:
    `CR${"4".repeat(32)}`,
  SITESOURCERY_TWILIO_VOICE_PRODUCTION_PUSH_CREDENTIAL_SID:
    `CR${"5".repeat(32)}`
});

function authority(environment = {}) {
  return createTwilioResponderVoiceAccess({
    pepper: Buffer.alloc(32, 7),
    pepperVersion: "v2",
    previousPeppers: { v1: Buffer.alloc(32, 6) },
    environment,
    randomBytes: () => Buffer.alloc(12, 9)
  });
}

test("Twilio Voice access is held by default without staged credentials", async () => {
  const selected = authority();
  assert.deepEqual(await selected.readiness(), {
    ready: true,
    verified: true,
    kind: "twilio-responder-voice-access",
    mode: "held",
    provider: "twilio",
    transport: "twilio_voice_ios",
    signerReady: false,
    issuanceEnabled: false,
    ttlSeconds: 300,
    writerVersion: "v2",
    verifierVersions: ["v2", "v1"],
    routingReady: false,
    operationalCalls: false,
    providerEffects: false,
    pushDeliveryEffects: false,
    voiceCallEffects: false,
    providerAuthorizationEffects: false,
    secretMaterial: "redacted"
  });
  assert.throws(
    () => selected.issueSession(AUTHORITY),
    { code: "RESPONDER_NATIVE_VOIP_HELD" }
  );
});

test("verified Twilio Voice access issues only an incoming opaque grant", async () => {
  const selected = authority(VERIFIED);
  const issued = selected.issueSession(AUTHORITY);
  const [encodedHeader, encodedPayload] = issued.accessToken.split(".");
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url"));
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url"));
  assert.equal(header.alg, "HS256");
  assert.equal(payload.iss, VERIFIED.SITESOURCERY_TWILIO_VOICE_API_KEY_SID);
  assert.equal(payload.sub, VERIFIED.SITESOURCERY_TWILIO_ACCOUNT_SID);
  assert.match(payload.grants.identity, /^ssr_[0-9a-f]{48}$/u);
  assert.equal(payload.grants.identity.includes(AUTHORITY.userId), false);
  assert.deepEqual(payload.grants.voice.incoming, { allow: true });
  assert.equal(payload.grants.voice.outgoing, undefined);
  assert.match(payload.grants.voice.endpoint_id, /^ssr_ios_[0-9a-f]{48}$/u);
  assert.equal(
    payload.grants.voice.push_credential_sid,
    VERIFIED.SITESOURCERY_TWILIO_VOICE_SANDBOX_PUSH_CREDENTIAL_SID
  );
  assert.equal(payload.exp - 300, Date.parse(issued.issuedAt) / 1000);
  assert.equal(payload.exp, Date.parse(issued.expiresAt) / 1000);
  assert.equal(issued.incomingAllowed, true);
  assert.equal(issued.outgoingAllowed, false);
  assert.equal(issued.providerAuthorizationEffects, true);
  assert.doesNotMatch(
    JSON.stringify({ ...issued, accessToken: "redacted" }),
    new RegExp(VERIFIED.SITESOURCERY_TWILIO_VOICE_API_KEY_SECRET, "u")
  );

  const metadata = {
    issuedAt: issued.issuedAt,
    expiresAt: issued.expiresAt,
    identityDigest: issued.identityDigest,
    endpointDigest: issued.endpointDigest,
    credentialDigest: issued.credentialDigest,
    jtiDigest: issued.jtiDigest,
    tokenDigest: issued.tokenDigest
  };
  assert.equal(
    selected.openSession(AUTHORITY, metadata, issued.envelope),
    issued.accessToken
  );
  assert.throws(
    () => selected.openSession(
      { ...AUTHORITY, projectId: "20000000-0000-4000-8000-000000000003" },
      metadata,
      issued.envelope
    ),
    { code: "TWILIO_RESPONDER_VOICE_ACCESS_UNAVAILABLE" }
  );
});

test("Twilio Voice access rejects ambiguous credential staging", () => {
  assert.throws(
    () => authority({
      SITESOURCERY_TWILIO_VOICE_API_KEY_SID: `SK${"2".repeat(32)}`
    }),
    { code: "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED" }
  );
  assert.throws(
    () => authority({
      ...VERIFIED,
      SITESOURCERY_TWILIO_VOICE_PRODUCTION_PUSH_CREDENTIAL_SID:
        VERIFIED.SITESOURCERY_TWILIO_VOICE_SANDBOX_PUSH_CREDENTIAL_SID
    }),
    { code: "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED" }
  );
});
