import assert from "node:assert/strict";
import test from "node:test";
import { createResponderNativeVoiceRouting, nativeVoiceRoutingModeFromEnvironment } from "../responder-native-voice-routing.mjs";
import { createTwilioResponderNativeVoiceDialPlan, isExactTwilioResponderVoiceTwiML, TWILIO_RESPONDER_HELD_VOICE_TWIML } from "../twilio-responder-voice-dial-plan.mjs";
import { createTwilioResponderInboundHttpAdapter } from "../twilio-responder-inbound-http.mjs";

const enabled = { SITESOURCERY_RESPONDER_NATIVE_VOICE_ROUTING_MODE: "verified",
  SITESOURCERY_TWILIO_INBOUND_EVENT_MODE: "verified", SITESOURCERY_TWILIO_VOICE_ACCESS_MODE: "verified" };
const receipt = { channel: "voice", eventKind: "call_received", eventState: "recorded", numberBindingId: "10000000-0000-4000-8000-000000000001" };
const dialResultUrl = "https://sitesourcery.com/api/v1/provider-events/twilio/voice/dial-result";

test("native incoming routing defaults held and cannot share carrier dialing or held ingress/issuance", async () => {
  assert.equal(nativeVoiceRoutingModeFromEnvironment({}), "held");
  assert.equal(nativeVoiceRoutingModeFromEnvironment(enabled), "verified");
  for (const delta of [ { SITESOURCERY_TWILIO_VOICE_DIAL_MODE: "verified" },
    { SITESOURCERY_TWILIO_INBOUND_EVENT_MODE: "held" }, { SITESOURCERY_TWILIO_VOICE_ACCESS_MODE: "held" },
    { SITESOURCERY_RESPONDER_NATIVE_VOICE_ROUTING_MODE: "live" } ]) {
    assert.throws(() => nativeVoiceRoutingModeFromEnvironment({ ...enabled, ...delta }));
  }
  const held = createResponderNativeVoiceRouting();
  assert.deepEqual(await held.resolveIdentities(receipt), []);
  assert.equal((await held.readiness()).operationalCalls, false);
});

test("native Dial requires fresh readiness, exact bounded opaque identities, and durable receipt", async () => {
  let ready = true, lookups = 0;
  let identities = Array.from({ length: 10 }, (_, i) => `ssr_${i.toString(16).repeat(48)}`);
  const routing = createResponderNativeVoiceRouting({ mode: "verified",
    voiceAccess: { mode: "verified", async readiness() { return { ready, verified: ready, issuanceEnabled: ready }; } },
    routes: { kind: "responder-native-voice-routes-postgres", providerEffects: false,
      async readiness() { return { ready: true, verified: true }; },
      async resolveIdentities() { lookups++; return identities; } } });
  const plan = createTwilioResponderNativeVoiceDialPlan({ routing, dialResultUrl });
  const rendered = await plan.twiml(receipt);
  assert.equal(isExactTwilioResponderVoiceTwiML(rendered), true);
  assert.equal((rendered.match(/<Client>/gu) ?? []).length, 10);
  assert.equal(lookups, 1);
  ready = false;
  assert.equal(await plan.twiml(receipt), TWILIO_RESPONDER_HELD_VOICE_TWIML);
  assert.equal(lookups, 1);
  ready = true;
  for (const values of [[], [...identities, `ssr_${"a".repeat(48)}`], [identities[0], identities[0]], ["evil</Client><Number>+123</Number>"]]) {
    identities = values;
    assert.equal(await plan.twiml(receipt), TWILIO_RESPONDER_HELD_VOICE_TWIML);
  }
  assert.equal(await plan.twiml({ ...receipt, eventState: "unbound" }), TWILIO_RESPONDER_HELD_VOICE_TWIML);
  assert.equal(isExactTwilioResponderVoiceTwiML(rendered.replace("</Dial>", "<Client>ssr_" + "a".repeat(48) + "</Client></Dial>")), false);
});

test("unavailable native devices do not reject durable inbound handling", async () => {
  const plan = createTwilioResponderNativeVoiceDialPlan({ dialResultUrl,
    routing: { kind: "responder-native-voice-routing", mode: "verified", async readiness() { return {}; },
      async resolveIdentities() { throw new Error("unavailable"); } } });
  assert.equal(await plan.twiml(receipt), TWILIO_RESPONDER_HELD_VOICE_TWIML);
  let persisted = false;
  const adapter = createTwilioResponderInboundHttpAdapter({ voiceDialPlan: plan,
    inbound: { kind: "twilio-responder-inbound", mode: "verified", providerEffects: false,
      async readiness() { return { ready: true, verified: true }; },
      async ingestInboundMessage() {}, async ingestDialResult() {},
      async ingestVoiceCall() { persisted = true; return { ...receipt,
        schema: "sitesourcery.responder-twilio-inbound-receipt/v1", providerEffects: false }; } } });
  const result = await adapter.handle({ method: "POST", pathname: "/api/v1/provider-events/twilio/voice", headers: {}, rawBody: Buffer.from("fixture") });
  assert.equal(persisted, true);
  assert.equal(result.status, 200);
  assert.equal(result.body, TWILIO_RESPONDER_HELD_VOICE_TWIML);
});
