import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createHostedApi } from "../http.mjs";
import {
  createTwilioResponderInboundHttpAdapter,
  TWILIO_RESPONDER_CONDITIONAL_FORWARD_TWIML,
  TWILIO_RESPONDER_INBOUND_DIAL_RESULT_PATH,
  TWILIO_RESPONDER_INBOUND_DIAL_RESULT_TWIML,
  TWILIO_RESPONDER_INBOUND_MAXIMUM_BYTES,
  TWILIO_RESPONDER_INBOUND_MESSAGE_PATH,
  TWILIO_RESPONDER_INBOUND_MESSAGE_TWIML,
  TWILIO_RESPONDER_INBOUND_VOICE_PATH,
  TWILIO_RESPONDER_INBOUND_VOICE_TWIML
} from "../twilio-responder-inbound-http.mjs";

const ORIGIN = "https://sitesourcery.com";
const RAW = Buffer.from(
  "AccountSid=AC11111111111111111111111111111111&" +
  "MessageSid=SM22222222222222222222222222222222&Body=hello"
);

function service() {
  return {
    async authenticate() {
      throw new Error("Twilio inbound reached browser authentication");
    }
  };
}

function boundary(calls) {
  return {
    kind: "twilio-responder-inbound-http-adapter",
    mode: "raw-form",
    providerEffects: false,
    async readiness() {
      return { ready: true, verified: true, providerEffects: false };
    },
    async handle(input) {
      calls.push(input);
      const twiml = {
        [TWILIO_RESPONDER_INBOUND_MESSAGE_PATH]:
          TWILIO_RESPONDER_INBOUND_MESSAGE_TWIML,
        [TWILIO_RESPONDER_INBOUND_VOICE_PATH]:
          TWILIO_RESPONDER_INBOUND_VOICE_TWIML,
        [TWILIO_RESPONDER_INBOUND_DIAL_RESULT_PATH]:
          TWILIO_RESPONDER_INBOUND_DIAL_RESULT_TWIML
      }[input.pathname];
      return {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/xml; charset=utf-8"
        },
        body: twiml
      };
    }
  };
}

function request(pathname, {
  method = "POST",
  body = RAW,
  contentType = "application/x-www-form-urlencoded",
  contentLength = body?.byteLength
} = {}) {
  return new Request(`${ORIGIN}${pathname}`, {
    method,
    headers: {
      "content-type": contentType,
      ...(contentLength === null
        ? {}
        : { "content-length": String(contentLength) }),
      "x-twilio-signature": "A".repeat(27) + "="
    },
    ...(method === "GET" || method === "HEAD" ? {} : { body })
  });
}

test("each inbound route answers its exact fixed TwiML and nothing else", async () => {
  for (const [pathname, twiml] of [
    [TWILIO_RESPONDER_INBOUND_MESSAGE_PATH,
      TWILIO_RESPONDER_INBOUND_MESSAGE_TWIML],
    [TWILIO_RESPONDER_INBOUND_VOICE_PATH,
      TWILIO_RESPONDER_INBOUND_VOICE_TWIML],
    [TWILIO_RESPONDER_INBOUND_DIAL_RESULT_PATH,
      TWILIO_RESPONDER_INBOUND_DIAL_RESULT_TWIML]
  ]) {
    const calls = [];
    const api = createHostedApi(service(), {
      twilioResponderInbound: boundary(calls)
    });
    const response = await api.fetch(request(pathname));
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("content-type"),
      "text/xml; charset=utf-8"
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), twiml);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].rawBody, RAW);
    assert.equal(calls[0].pathname, pathname);
  }
  assert.match(
    TWILIO_RESPONDER_INBOUND_MESSAGE_TWIML,
    /<Response\/>/u,
    "the message ack must never contain a reply body"
  );
  assert.match(
    TWILIO_RESPONDER_INBOUND_VOICE_TWIML,
    /<Reject reason="busy"\/>/u,
    "the arrival route declines without answering; it is not a dial plan"
  );
  assert.doesNotMatch(
    TWILIO_RESPONDER_INBOUND_VOICE_TWIML +
      TWILIO_RESPONDER_INBOUND_MESSAGE_TWIML +
      TWILIO_RESPONDER_INBOUND_DIAL_RESULT_TWIML,
    /<Dial|<Say|<Message|<Play|<Redirect/u,
    "no held TwiML acknowledgement commands a provider effect"
  );
});

test("verified Voice resolves a private Dial target only after durable bound arrival", async () => {
  const order = [];
  const adapter = createTwilioResponderInboundHttpAdapter({
    inbound: {
      kind: "twilio-responder-inbound",
      mode: "verified-inbound",
      providerEffects: false,
      async readiness() {
        return { ready: true, verified: true, providerEffects: false };
      },
      async ingestInboundMessage() {
        throw new Error("wrong route");
      },
      async ingestDialResult() {
        throw new Error("wrong route");
      },
      async ingestVoiceCall() {
        order.push("durable");
        return {
          schema: "sitesourcery.responder-twilio-inbound-receipt/v1",
          channel: "voice",
          eventKind: "call_received",
          eventState: "recorded",
          numberBindingId: "10000000-0000-4000-8000-000000000001",
          replayed: false,
          coreApplied: false,
          providerEffects: false
        };
      }
    },
    voiceDialPlan: {
      kind: "twilio-responder-voice-dial-plan",
      mode: "verified-private-forward",
      providerEffects: true,
      async readiness() {
        return {
          ready: true,
          verified: true,
          providerEffects: true,
          voiceOperational: true,
          voiceDialPlan: "verified-private-forward"
        };
      },
      async twiml(receipt) {
        order.push("target");
        assert.equal(receipt.eventState, "recorded");
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
          "<Response><Dial action=\"https://sitesourcery.com/api/v1/provider-events/twilio/voice/dial-result\" method=\"POST\" answerOnBridge=\"true\" timeout=\"20\"><Number>+18565550123</Number></Dial></Response>";
      }
    }
  });
  assert.equal(adapter.providerEffects, true);
  assert.equal((await adapter.readiness()).voiceOperational, true);
  const response = await adapter.handle({
    method: "POST",
    pathname: TWILIO_RESPONDER_INBOUND_VOICE_PATH,
    headers: {},
    rawBody: RAW
  });
  assert.deepEqual(order, ["durable", "target"]);
  assert.match(response.body, /<Dial action=/u);
});

test("conditional no-answer arrivals and ambiguous sources never dial the retained line", async () => {
  let dialCalls = 0;
  let eventState = "applied";
  let stateReason = null;
  let forwardingOnboardingId =
    "10000000-0000-4000-8000-000000000002";
  const adapter = createTwilioResponderInboundHttpAdapter({
    inbound: {
      kind: "twilio-responder-inbound",
      mode: "verified-inbound",
      providerEffects: false,
      async readiness() {
        return { ready: true, verified: true, providerEffects: false };
      },
      async ingestInboundMessage() {
        throw new Error("wrong route");
      },
      async ingestDialResult() {
        throw new Error("wrong route");
      },
      async ingestVoiceCall() {
        return {
          schema: "sitesourcery.responder-twilio-inbound-receipt/v1",
          channel: "voice",
          eventKind: "call_received",
          eventState,
          stateReason,
          numberBindingId: "10000000-0000-4000-8000-000000000001",
          forwardingOnboardingId,
          voiceArrivalPolicy: "conditional_no_answer_forwarding",
          replayed: false,
          coreApplied: eventState === "applied",
          providerEffects: false
        };
      }
    },
    voiceDialPlan: {
      kind: "twilio-responder-voice-dial-plan",
      mode: "verified-private-forward",
      providerEffects: true,
      async readiness() {
        return { ready: true, verified: true };
      },
      async twiml() {
        dialCalls += 1;
        throw new Error("conditional forwarding must never dial");
      }
    }
  });
  const response = await adapter.handle({
    method: "POST",
    pathname: TWILIO_RESPONDER_INBOUND_VOICE_PATH,
    headers: {},
    rawBody: RAW
  });
  assert.equal(response.body, TWILIO_RESPONDER_CONDITIONAL_FORWARD_TWIML);
  eventState = "recorded";
  stateReason = "forwarding_source_mismatch";
  const ambiguousResponse = await adapter.handle({
    method: "POST",
    pathname: TWILIO_RESPONDER_INBOUND_VOICE_PATH,
    headers: {},
    rawBody: RAW
  });
  assert.equal(
    ambiguousResponse.body,
    TWILIO_RESPONDER_CONDITIONAL_FORWARD_TWIML
  );
  forwardingOnboardingId = null;
  stateReason = "forwarding_onboarding_unavailable";
  const lifecycleGapResponse = await adapter.handle({
    method: "POST",
    pathname: TWILIO_RESPONDER_INBOUND_VOICE_PATH,
    headers: {},
    rawBody: RAW
  });
  assert.equal(
    lifecycleGapResponse.body,
    TWILIO_RESPONDER_CONDITIONAL_FORWARD_TWIML
  );
  assert.equal(dialCalls, 0);
  assert.doesNotMatch(
    response.body + ambiguousResponse.body + lifecycleGapResponse.body,
    /<Dial/u
  );
});

test("inbound routes reject method, media, and length before ingress", async () => {
  for (const [input, status, code] of [
    [{ method: "GET", body: null, contentLength: null }, 405,
      "METHOD_NOT_ALLOWED"],
    [{ contentType: "application/json" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    [{ contentLength: RAW.byteLength + 1 }, 400, "INVALID_CONTENT_LENGTH"],
    [{ contentLength: TWILIO_RESPONDER_INBOUND_MAXIMUM_BYTES + 1 }, 413,
      "REQUEST_TOO_LARGE"],
    [{ body: Buffer.alloc(0), contentLength: 0 }, 400,
      "TWILIO_RESPONDER_INBOUND_BODY_REQUIRED"]
  ]) {
    const calls = [];
    const api = createHostedApi(service(), {
      twilioResponderInbound: boundary(calls)
    });
    const response = await api.fetch(
      request(TWILIO_RESPONDER_INBOUND_MESSAGE_PATH, input)
    );
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
    assert.equal(calls.length, 0);
  }
});

test("unconfigured inbound routes stay held and raw evidence is never logged", async () => {
  for (const pathname of [
    TWILIO_RESPONDER_INBOUND_MESSAGE_PATH,
    TWILIO_RESPONDER_INBOUND_VOICE_PATH,
    TWILIO_RESPONDER_INBOUND_DIAL_RESULT_PATH
  ]) {
    const response = await createHostedApi(service()).fetch(
      request(pathname)
    );
    assert.equal(response.status, 503);
    assert.equal(
      (await response.json()).error.code,
      "TWILIO_RESPONDER_INBOUND_HELD"
    );
  }
  const sources = await Promise.all([
    "../http.mjs",
    "../bin/server.mjs",
    "../twilio-responder-inbound.mjs",
    "../twilio-responder-inbound-postgres.mjs",
    "../twilio-responder-inbound-http.mjs",
    "../twilio-responder-inbound-config.mjs",
    "../twilio-responder-voice-dial-plan.mjs",
    "../responder-voice-dial-target-postgres.mjs",
    "../responder-voice-dial-target-vault.mjs",
    "../responder-inbound-followup-worker-postgres.mjs",
    "../responder-inbound-material-vault.mjs",
    "../responder-lookup-digests.mjs",
    "../responder-number-bindings-postgres.mjs",
    "../responder-number-bindings-http.mjs"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.doesNotMatch(
    sources.join("\n"),
    /(?:console|stdout|stderr|log)\s*\([^)]*(?:rawBody|MessageSid|CallSid|From|To|Body|phoneNumber)/u
  );
});

test("a non-exact TwiML acknowledgement fails closed instead of leaking", async () => {
  const api = createHostedApi(service(), {
    twilioResponderInbound: {
      kind: "twilio-responder-inbound-http-adapter",
      mode: "raw-form",
      providerEffects: false,
      readiness: async () => ({ ready: true, verified: true }),
      handle: async () => ({
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/xml; charset=utf-8"
        },
        body: "<Response><Message>leaky reply</Message></Response>"
      })
    }
  });
  const response = await api.fetch(
    request(TWILIO_RESPONDER_INBOUND_MESSAGE_PATH)
  );
  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).error.code,
    "TWILIO_RESPONDER_INBOUND_HTTP_DURABILITY_REQUIRED"
  );
});

test("capabilities project the inbound boundary truthfully", async () => {
  const capableService = () => ({
    ...service(),
    async readiness() {
      return {};
    }
  });
  const heldApi = createHostedApi(capableService());
  const heldResponse = await heldApi.fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(
    (await heldResponse.json()).responderInboundEvents,
    false
  );
  const readyApi = createHostedApi(capableService(), {
    twilioResponderInbound: boundary([])
  });
  const readyResponse = await readyApi.fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(
    (await readyResponse.json()).responderInboundEvents,
    true
  );
});
