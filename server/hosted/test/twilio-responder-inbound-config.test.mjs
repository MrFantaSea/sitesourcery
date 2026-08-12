import assert from "node:assert/strict";
import test from "node:test";

import {
  createConfiguredTwilioResponderInboundHttp
} from "../twilio-responder-inbound-config.mjs";

const AUTHORITY = { kind: "canonical-postgres", service: async () => ({}) };

function verifiedEnvironment(overrides = {}) {
  return {
    SITESOURCERY_TWILIO_INBOUND_EVENT_MODE: "verified",
    SITESOURCERY_TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
    SITESOURCERY_TWILIO_WEBHOOK_AUTH_TOKEN: "b".repeat(32),
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
    authority: AUTHORITY
  });
  assert.equal(verified.kind, "twilio-responder-inbound-http-adapter");
  assert.equal(verified.mode, "raw-form");
});

test("verified mode fails closed on any missing composition input", () => {
  assert.throws(
    () => createConfiguredTwilioResponderInboundHttp({
      environment: verifiedEnvironment(),
      authority: null
    }),
    (error) =>
      error?.code === "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED"
  );
  for (const missing of [
    "SITESOURCERY_TWILIO_ACCOUNT_SID",
    "SITESOURCERY_TWILIO_WEBHOOK_AUTH_TOKEN",
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
        authority: AUTHORITY
      }),
      (error) =>
        error?.code === "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED" ||
        error?.code === "RESPONDER_INBOUND_MATERIAL_CONFIGURATION_REQUIRED",
      `verified mode must fail without ${missing}`
    );
  }
});
