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
  clientPlatform: "ios",
  transport: "twilio_voice_ios",
  appEnvironment: "sandbox"
});

const VERIFIED = Object.freeze({
  SITESOURCERY_TWILIO_VOICE_ACCESS_MODE: "verified"
});

const PROVIDER = Object.freeze({
  accountSid: `AC${"1".repeat(32)}`,
  voiceApiKeySid: `SK${"2".repeat(32)}`,
  voiceApiKeySecret: "voice-secret-".padEnd(40, "3"),
  voiceSandboxPushCredentialSid: `CR${"4".repeat(32)}`,
  voiceProductionPushCredentialSid: `CR${"5".repeat(32)}`,
  voiceAndroidSandboxPushCredentialSid: `CR${"6".repeat(32)}`,
  voiceAndroidProductionPushCredentialSid: `CR${"7".repeat(32)}`,
  topology: Object.freeze({
    organizationId: AUTHORITY.organizationId,
    accountSidDigest: "a".repeat(64)
  })
});

function providerDependencies(provider = PROVIDER) {
  return {
    providerRegistry: {
      kind: "twilio-isv-provider-registry",
      providerEffects: false,
      async readiness() { return { ready: true, verified: true }; },
      resolveOrganization(organizationId) {
        if (organizationId !== AUTHORITY.organizationId) {
          throw new Error("unknown customer");
        }
        return provider;
      }
    },
    providerTopologyRepository: {
      kind: "responder-twilio-provider-topology-postgres",
      providerEffects: false,
      async readiness() { return { ready: true, verified: true }; },
      async requireActiveTopology(topology) {
        assert.equal(topology, provider.topology);
        return topology;
      }
    }
  };
}

function authority(environment = {}, dependencies = null, overrides = {}) {
  return createTwilioResponderVoiceAccess({
    pepper: Buffer.alloc(32, 7),
    pepperVersion: "v2",
    previousPeppers: { v1: Buffer.alloc(32, 6) },
    environment,
    ...(dependencies ??
      (environment.SITESOURCERY_TWILIO_VOICE_ACCESS_MODE === "verified"
        ? providerDependencies()
        : {})),
    randomBytes: () => Buffer.alloc(12, 9),
    ...overrides
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
    transports: ["twilio_voice_ios", "twilio_voice_android"],
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
  await assert.rejects(
    selected.issueSession(AUTHORITY),
    { code: "RESPONDER_NATIVE_VOIP_HELD" }
  );
});

test("verified Twilio Voice access selects Android FCM authority exactly", async () => {
  const selected = authority(VERIFIED);
  const androidAuthority = {
    ...AUTHORITY,
    clientPlatform: "android",
    transport: "twilio_voice_android"
  };
  const issued = await selected.issueSession(androidAuthority);
  const payload = JSON.parse(Buffer.from(
    issued.accessToken.split(".")[1], "base64url"
  ));
  assert.match(
    payload.grants.voice.endpoint_id,
    /^ssr_android_[0-9a-f]{48}$/u
  );
  assert.equal(
    payload.grants.voice.push_credential_sid,
    PROVIDER.voiceAndroidSandboxPushCredentialSid
  );
  assert.equal(payload.grants.voice.outgoing, undefined);
  assert.equal(issued.providerEffects, false);
  assert.equal(issued.pushDeliveryEffects, false);
  assert.equal(issued.voiceCallEffects, false);
});

test("verified Twilio Voice access issues only an incoming opaque grant", async () => {
  const selected = authority(VERIFIED);
  const issued = await selected.issueSession(AUTHORITY);
  const [encodedHeader, encodedPayload] = issued.accessToken.split(".");
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url"));
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url"));
  assert.equal(header.alg, "HS256");
  assert.equal(payload.iss, PROVIDER.voiceApiKeySid);
  assert.equal(payload.sub, PROVIDER.accountSid);
  assert.match(payload.grants.identity, /^ssr_[0-9a-f]{48}$/u);
  assert.equal(payload.grants.identity.includes(AUTHORITY.userId), false);
  assert.deepEqual(payload.grants.voice.incoming, { allow: true });
  assert.equal(payload.grants.voice.outgoing, undefined);
  assert.match(payload.grants.voice.endpoint_id, /^ssr_ios_[0-9a-f]{48}$/u);
  assert.equal(
    payload.grants.voice.push_credential_sid,
    PROVIDER.voiceSandboxPushCredentialSid
  );
  assert.equal(payload.exp - 300, Date.parse(issued.issuedAt) / 1000);
  assert.equal(payload.exp, Date.parse(issued.expiresAt) / 1000);
  assert.equal(issued.incomingAllowed, true);
  assert.equal(issued.outgoingAllowed, false);
  assert.equal(issued.providerAuthorizationEffects, true);
  assert.doesNotMatch(
    JSON.stringify({ ...issued, accessToken: "redacted" }),
    new RegExp(PROVIDER.voiceApiKeySecret, "u")
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

test("unknown customer authority fails before Voice token generation", async () => {
  let tokenFactoryCalls = 0;
  const selected = authority(VERIFIED, null, {
    tokenFactory() {
      tokenFactoryCalls += 1;
      throw new Error("token factory must not be called");
    }
  });
  await assert.rejects(
    selected.issueSession({
      ...AUTHORITY,
      organizationId: "20000000-0000-4000-8000-000000000002"
    }),
    /unknown customer/u
  );
  assert.equal(tokenFactoryCalls, 0);
});

test("Twilio Voice access rejects ambiguous credential staging", async () => {
  assert.throws(
    () => authority({
      SITESOURCERY_TWILIO_VOICE_API_KEY_SID: `SK${"2".repeat(32)}`
    }),
    { code: "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED" }
  );
  assert.throws(
    () => authority(VERIFIED, {}),
    { code: "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED" }
  );
  const duplicate = {
    ...PROVIDER,
    voiceProductionPushCredentialSid:
      PROVIDER.voiceSandboxPushCredentialSid
  };
  const selected = authority(VERIFIED, providerDependencies(duplicate));
  await assert.rejects(
    selected.issueSession(AUTHORITY),
    { code: "TWILIO_RESPONDER_VOICE_ACCESS_CONFIGURATION_REQUIRED" }
  );
});
