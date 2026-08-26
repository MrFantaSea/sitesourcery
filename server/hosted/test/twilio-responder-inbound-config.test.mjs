import assert from "node:assert/strict";
import test from "node:test";

import {
  createConfiguredTwilioResponderInboundHttp
} from "../twilio-responder-inbound-config.mjs";

const AUTHORITY = { kind: "canonical-postgres", service: async () => ({}) };
const PROVIDER_REGISTRY = Object.freeze({
  kind: "twilio-isv-provider-registry",
  providerEffects: false,
  async readiness() { return { ready: true, verified: true }; },
  resolveAccountSid() { throw new Error("not called"); }
});
const TOPOLOGY = Object.freeze({
  kind: "responder-twilio-provider-topology-postgres",
  providerEffects: false,
  async readiness() { return { ready: true, verified: true }; },
  async requireActiveTopology() { throw new Error("not called"); }
});
const PROVIDER_FACTORIES = Object.freeze({
  providerRegistryFactory: () => PROVIDER_REGISTRY,
  providerTopologyRepositoryFactory: () => TOPOLOGY
});

function verifiedEnvironment(overrides = {}) {
  return {
    SITESOURCERY_TWILIO_INBOUND_EVENT_MODE: "verified",
    SITESOURCERY_TWILIO_ISV_PROVIDER_REGISTRY_PATH:
      "/run/sitesourcery/twilio-isv-registry.json",
    SITESOURCERY_TWILIO_INBOUND_MESSAGE_URL:
      "https://sitesourcery.com/api/v1/provider-events/twilio/inbound-messages",
    SITESOURCERY_TWILIO_INBOUND_VOICE_URL:
      "https://sitesourcery.com/api/v1/provider-events/twilio/voice",
    SITESOURCERY_TWILIO_INBOUND_DIAL_RESULT_URL:
      "https://sitesourcery.com/api/v1/provider-events/twilio/voice/dial-result",
    SITESOURCERY_RESPONDER_MATERIAL_KEY_VERSION: "2026-08",
    SITESOURCERY_RESPONDER_MATERIAL_KEY_BASE64URL:
      Buffer.alloc(32, 3).toString("base64url"),
    SITESOURCERY_IDENTITY_PEPPER_CONFIG: JSON.stringify({
      schema: "sitesourcery.identity-pepper-config/v1",
      current: {
        version: "v2",
        secretEnvironment: "SITESOURCERY_IDENTITY_PEPPER"
      },
      prior: []
    }),
    SITESOURCERY_IDENTITY_PEPPER: Buffer.alloc(32, 8).toString("base64"),
    ...overrides
  };
}

test("inbound ingress defaults to held and forbids staged material keys", () => {
  const held = createConfiguredTwilioResponderInboundHttp({
    environment: {}
  });
  assert.equal(held.kind, "twilio-responder-inbound-http-adapter");
  assert.equal(held.mode, "held");
  assert.throws(
    () => createConfiguredTwilioResponderInboundHttp({
      environment: {
        SITESOURCERY_RESPONDER_MATERIAL_KEY_BASE64URL:
          Buffer.alloc(32, 3).toString("base64url")
      }
    }),
    (error) =>
      error?.code === "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED"
  );
  assert.throws(
    () => createConfiguredTwilioResponderInboundHttp({
      environment: {
        SITESOURCERY_RESPONDER_MATERIAL_PRIOR_KEY_BASE64URL:
          Buffer.alloc(32, 5).toString("base64url")
      }
    }),
    (error) =>
      error?.code === "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED",
    "a staged prior key is equally forbidden while inbound is held"
  );
  assert.throws(
    () => createConfiguredTwilioResponderInboundHttp({
      environment: { SITESOURCERY_TWILIO_INBOUND_EVENT_MODE: "live" }
    }),
    (error) =>
      error?.code === "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED"
  );
});

test("verified inbound ingress composes keys, vault, and repository exactly", () => {
  const verified = createConfiguredTwilioResponderInboundHttp({
    environment: verifiedEnvironment(),
    authority: AUTHORITY,
    ...PROVIDER_FACTORIES
  });
  assert.equal(verified.kind, "twilio-responder-inbound-http-adapter");
  assert.equal(verified.mode, "raw-form");
  assert.equal(verified.providerEffects, false);
  const voiceVerified = createConfiguredTwilioResponderInboundHttp({
    environment: verifiedEnvironment({
      SITESOURCERY_TWILIO_VOICE_DIAL_MODE: "verified"
    }),
    authority: AUTHORITY,
    ...PROVIDER_FACTORIES
  });
  assert.equal(voiceVerified.mode, "raw-form");
  assert.equal(voiceVerified.providerEffects, true);
});

test("verified mode fails closed on any missing composition input", () => {
  assert.throws(
    () => createConfiguredTwilioResponderInboundHttp({
      environment: verifiedEnvironment(),
      authority: null,
      ...PROVIDER_FACTORIES
    }),
    (error) =>
      error?.code === "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED"
  );
  assert.throws(
    () => createConfiguredTwilioResponderInboundHttp({
      environment: { SITESOURCERY_TWILIO_VOICE_DIAL_MODE: "verified" }
    }),
    (error) =>
      error?.code === "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED"
  );
  for (const missing of [
    "SITESOURCERY_TWILIO_INBOUND_MESSAGE_URL",
    "SITESOURCERY_TWILIO_INBOUND_VOICE_URL",
    "SITESOURCERY_TWILIO_INBOUND_DIAL_RESULT_URL",
    "SITESOURCERY_RESPONDER_MATERIAL_KEY_BASE64URL",
    "SITESOURCERY_IDENTITY_PEPPER_CONFIG"
  ]) {
    const environment = verifiedEnvironment();
    delete environment[missing];
    assert.throws(
      () => createConfiguredTwilioResponderInboundHttp({
        environment,
        authority: AUTHORITY,
        ...PROVIDER_FACTORIES
      }),
      (error) =>
        error?.code === "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED" ||
        error?.code === "RESPONDER_INBOUND_MATERIAL_CONFIGURATION_REQUIRED",
      `verified mode must fail without ${missing}`
    );
  }
  assert.throws(
    () => createConfiguredTwilioResponderInboundHttp({
      environment: {
        ...verifiedEnvironment(),
        SITESOURCERY_TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`
      },
      authority: AUTHORITY,
      ...PROVIDER_FACTORIES
    }),
    (error) =>
      error?.code === "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED"
  );
});
