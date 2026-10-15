import assert from "node:assert/strict";
import test from "node:test";

import { createHostedApi } from "../http.mjs";
import { createResponderNativeVoiceRouting } from "../responder-native-voice-routing.mjs";
import { createTwilioResponderNativeVoiceDialPlan, TWILIO_RESPONDER_HELD_VOICE_TWIML } from "../twilio-responder-voice-dial-plan.mjs";
import { createTwilioResponderInboundHttpAdapter } from "../twilio-responder-inbound-http.mjs";

const noDelivery = Object.freeze({
  providerEffects: false,
  pushDeliveryEffects: false,
  voiceCallEffects: false,
  carrierCommandEffects: false,
  messageSendEffects: false
});
const enabled = Object.freeze({
  ready: true,
  verified: true,
  voiceRoutingMode: "verified-native-client",
  routingReady: true,
  operationalCalls: true
});

function fixture({ routing, issuerMode = "verified", ingressReady = true, inboundAdapter } = {}) {
  let now = 1_000;
  const repository = {
    kind: "responder-native-client-postgres",
    mode: "held-local",
    ...noDelivery,
    async readiness() {
      return { ready: true, verified: true, mode: "held-local", ...noDelivery };
    }
  };
  for (const method of [
    "createInstallation", "registerToken", "retireToken", "suspendInstallation",
    "resumeInstallation", "revokeInstallation", "listInstallations",
    "getInstallation", "issueVoipSession"
  ]) repository[method] = () => { throw new Error("Unexpected native write"); };
  const native = {
    repository,
    tokenAuthority: {
      kind: "responder-native-token-authority",
      ...noDelivery,
      async readiness() { return { ready: true, verified: true, ...noDelivery }; },
      tokenLookupCandidates() { throw new Error("Unexpected token access"); },
      sealToken() { throw new Error("Unexpected token access"); }
    },
    voiceAccess: {
      kind: "twilio-responder-voice-access",
      mode: issuerMode,
      transports: ["twilio_voice_ios", "twilio_voice_android"],
      ...noDelivery,
      issueSession() { throw new Error("Unexpected token issuance"); },
      openSession() { throw new Error("Unexpected token access"); },
      async readiness() {
        return {
          ready: true, verified: true, mode: issuerMode, ...noDelivery,
          transports: ["twilio_voice_ios", "twilio_voice_android"],
          providerAuthorizationEffects: issuerMode === "verified",
          routingReady: false, operationalCalls: false
        };
      }
    },
    ...(routing === undefined ? {} : { voiceRouting: routing })
  };
  const api = createHostedApi({
    async authenticate() { return null; },
    async readiness() {
      return {
        registration: { ready: true, verified: true },
        recovery: { ready: true, verified: true }
      };
    }
  }, {
    responderNativeClient: native,
    twilioResponderInbound: inboundAdapter ?? {
      kind: "twilio-responder-inbound-http-adapter",
      providerEffects: true,
      async readiness() {
        return {
          ready: ingressReady, verified: ingressReady,
          voiceOperational: ingressReady,
          voiceDialPlan: "verified-native-client"
        };
      },
      handle() { throw new Error("Unexpected provider webhook"); }
    },
    capabilitiesPolicy: { now: () => now, ttlMs: 1 }
  });
  return {
    async read() {
      now += 2;
      const response = await api.fetch(new Request(
        "https://sitesourcery.test/api/v1/capabilities"
      ));
      assert.equal(response.status, 200);
      return response.json();
    }
  };
}

test("legacy native composition keeps routing held without blocking accounts", async () => {
  const data = await fixture().read();
  assert.equal(data.accountRegistration, true);
  assert.equal(data.responderNativeClient.backendReady, true);
  assert.equal(data.responderNativeClient.voiceRoutingMode, "held");
  assert.equal(data.responderNativeClient.routingReady, false);
  assert.equal(data.responderNativeClient.operationalCalls, false);
});

test("fresh routing readiness changes without inventing delivery or distribution", async () => {
  let state = enabled;
  let reads = 0;
  const api = fixture({ routing: {
    kind: "responder-native-voice-routing",
    async readiness() { reads += 1; return state; }
  } });
  const available = (await api.read()).responderNativeClient;
  assert.equal(available.routingReady, true);
  assert.equal(available.operationalCalls, true);
  assert.equal(available.voiceRoutingMode, "verified-native-client");
  assert.equal(available.ready, false);
  assert.equal(available.clientsReady, false);
  assert.deepEqual(available.clientArtifacts, { ios: false, android: false });
  for (const key of Object.keys(noDelivery)) assert.equal(available[key], false);
  state = { ...enabled, ready: false, verified: false };
  const unavailable = (await api.read()).responderNativeClient;
  assert.equal(unavailable.backendReady, true);
  assert.equal(unavailable.routingReady, false);
  assert.equal(unavailable.operationalCalls, false);
  assert.equal(reads, 2);
});

test("route failure is contained and does not expose its private exception", async () => {
  const data = await fixture({ routing: {
    kind: "responder-native-voice-routing",
    readiness() { throw new Error("private-provider-secret"); }
  } }).read();
  assert.equal(data.accountRegistration, true);
  assert.equal(data.accountRecoveryEmail, true);
  assert.equal(data.responderNativeClient.backendReady, true);
  assert.equal(data.responderNativeClient.routingReady, false);
  assert.equal(data.responderNativeClient.operationalCalls, false);
  assert.equal(JSON.stringify(data).includes("private-provider-secret"), false);
});

test("inconsistent or unverified routing cannot bypass held token authority", async () => {
  const held = await fixture({
    issuerMode: "held",
    routing: { kind: "responder-native-voice-routing", readiness: async () => enabled }
  }).read();
  assert.equal(held.responderNativeClient.routingReady, false);
  for (const state of [
    { ...enabled, verified: false },
    { ...enabled, voiceRoutingMode: "unknown" },
    { ...enabled, routingReady: "true" },
    { ...enabled, operationalCalls: false }
  ]) {
    const data = await fixture({ routing: {
      kind: "responder-native-voice-routing", readiness: async () => state
    } }).read();
    assert.equal(data.responderNativeClient.routingReady, false);
    assert.equal(data.responderNativeClient.operationalCalls, false);
  }
});

test("invalid routing composition is rejected before serving capabilities", () => {
  for (const routing of [{ readiness() {} }, { kind: "responder-native-voice-routing" }]) {
    assert.throws(() => fixture({ routing }), { code: "RUNTIME_CONFIGURATION_ERROR" });
  }
});

test("ready signer and routes cannot claim calls while inbound ingress is unavailable", async () => {
  const data = await fixture({
    ingressReady: false,
    routing: { kind: "responder-native-voice-routing", readiness: async () => enabled }
  }).read();
  assert.equal(data.accountRegistration, true);
  assert.equal(data.responderNativeClient.backendReady, true);
  assert.equal(data.responderNativeClient.routingReady, false);
  assert.equal(data.responderNativeClient.operationalCalls, false);
});

test("combined native route, dial plan and inbound adapter agree with public availability", async () => {
  let signerReady = true;
  const identity = `ssr_${"a".repeat(48)}`;
  const routing = createResponderNativeVoiceRouting({
    mode: "verified",
    voiceAccess: {
      mode: "verified",
      async readiness() {
        return { ready: signerReady, verified: signerReady, issuanceEnabled: signerReady };
      }
    },
    routes: {
      kind: "responder-native-voice-routes-postgres", providerEffects: false,
      async readiness() { return { ready: true, verified: true }; },
      async resolveIdentities() { return [identity]; }
    }
  });
  const dialPlan = createTwilioResponderNativeVoiceDialPlan({
    routing,
    dialResultUrl: "https://sitesourcery.com/api/v1/provider-events/twilio/voice/dial-result"
  });
  const receipt = {
    schema: "sitesourcery.responder-twilio-inbound-receipt/v1", providerEffects: false,
    channel: "voice", eventKind: "call_received", eventState: "recorded",
    numberBindingId: "10000000-0000-4000-8000-000000000001"
  };
  const inboundAdapter = createTwilioResponderInboundHttpAdapter({
    voiceDialPlan: dialPlan,
    inbound: {
      kind: "twilio-responder-inbound", mode: "verified", providerEffects: false,
      async readiness() { return { ready: true, verified: true }; },
      async ingestInboundMessage() {}, async ingestDialResult() {},
      async ingestVoiceCall() { return receipt; }
    }
  });
  const api = fixture({ routing, inboundAdapter });
  const request = {
    method: "POST", pathname: "/api/v1/provider-events/twilio/voice",
    headers: {}, rawBody: Buffer.from("synthetic-inbound")
  };
  assert.equal((await api.read()).responderNativeClient.operationalCalls, true);
  assert.ok((await inboundAdapter.handle(request)).body.includes(`<Client>${identity}</Client>`));
  signerReady = false;
  const unavailable = (await api.read()).responderNativeClient;
  assert.equal(unavailable.routingReady, false);
  assert.equal(unavailable.operationalCalls, false);
  assert.equal((await inboundAdapter.handle(request)).body, TWILIO_RESPONDER_HELD_VOICE_TWIML);
});
