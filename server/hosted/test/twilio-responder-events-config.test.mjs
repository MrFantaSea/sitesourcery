import assert from "node:assert/strict";
import test from "node:test";

import {
  createConfiguredTwilioResponderEventsHttp
} from "../twilio-responder-events-config.mjs";

const BASE = Object.freeze({
  SITESOURCERY_TWILIO_ACCOUNT_SID: `AC${"1".repeat(32)}`,
  SITESOURCERY_TWILIO_STATUS_CALLBACK_URL:
    "https://sitesourcery.com/api/v1/provider-events/twilio"
});
const REPOSITORY = Object.freeze({
  kind: "twilio-responder-events-postgres",
  providerEffects: false,
  async readiness() { return { ready: true, verified: true }; },
  async ingestDeliveryStatus() { throw new Error("not called"); }
});

test("Twilio callback configuration is independently held by default", async () => {
  const held = createConfiguredTwilioResponderEventsHttp({ environment: {} });
  assert.equal(held.mode, "held");
  assert.equal((await held.readiness()).ready, false);
  assert.throws(
    () => createConfiguredTwilioResponderEventsHttp({
      environment: {
        SITESOURCERY_TWILIO_WEBHOOK_AUTH_TOKEN: "2".repeat(32)
      }
    }),
    (error) => error?.code ===
      "TWILIO_RESPONDER_EVENT_CONFIGURATION_REQUIRED"
  );
});

test("verified Twilio callback configuration requires an independent Auth Token", async () => {
  const configured = createConfiguredTwilioResponderEventsHttp({
    environment: {
      ...BASE,
      SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE: "verified",
      SITESOURCERY_TWILIO_WEBHOOK_AUTH_TOKEN: "2".repeat(32)
    },
    repository: REPOSITORY
  });
  assert.equal(configured.mode, "raw-form");
  assert.equal((await configured.readiness()).ready, true);
  assert.throws(
    () => createConfiguredTwilioResponderEventsHttp({
      environment: {
        ...BASE,
        SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE: "verified"
      },
      repository: REPOSITORY
    }),
    (error) => error?.code ===
      "TWILIO_RESPONDER_EVENT_CONFIGURATION_REQUIRED"
  );
});
