import assert from "node:assert/strict";
import test from "node:test";

import {
  createConfiguredTwilioResponderEventsHttp
} from "../twilio-responder-events-config.mjs";

const BASE = Object.freeze({
  SITESOURCERY_TWILIO_STATUS_CALLBACK_URL:
    "https://sitesourcery.com/api/v1/provider-events/twilio"
});
const AUTHORITY = Object.freeze({
  kind: "canonical-postgres",
  service: async () => ({})
});
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

test("verified Twilio callback configuration requires customer registry authority", async () => {
  const configured = createConfiguredTwilioResponderEventsHttp({
    environment: {
      ...BASE,
      SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE: "verified"
    },
    authority: AUTHORITY,
    repository: REPOSITORY,
    ...PROVIDER_FACTORIES
  });
  assert.equal(configured.mode, "raw-form");
  assert.equal((await configured.readiness()).ready, true);
  assert.throws(
    () => createConfiguredTwilioResponderEventsHttp({
      environment: {
        ...BASE,
        SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE: "verified",
        SITESOURCERY_TWILIO_WEBHOOK_AUTH_TOKEN: "2".repeat(32)
      },
      authority: AUTHORITY,
      repository: REPOSITORY,
      ...PROVIDER_FACTORIES
    }),
    (error) => error?.code ===
      "TWILIO_RESPONDER_EVENT_CONFIGURATION_REQUIRED"
  );
});
