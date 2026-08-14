import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";
import { canonicalJson } from "./security.mjs";
import {
  createHeldTwilioResponderInbound,
  TWILIO_RESPONDER_INBOUND_MAXIMUM_BYTES
} from "./twilio-responder-inbound.mjs";
import {
  createHeldTwilioResponderVoiceDialPlan,
  TWILIO_RESPONDER_HELD_VOICE_TWIML
} from "./twilio-responder-voice-dial-plan.mjs";

export const TWILIO_RESPONDER_INBOUND_MESSAGE_PATH =
  "/api/v1/provider-events/twilio/inbound-messages";
export const TWILIO_RESPONDER_INBOUND_VOICE_PATH =
  "/api/v1/provider-events/twilio/voice";
export const TWILIO_RESPONDER_INBOUND_DIAL_RESULT_PATH =
  "/api/v1/provider-events/twilio/voice/dial-result";
export { TWILIO_RESPONDER_INBOUND_MAXIMUM_BYTES };

// Twilio requires a TwiML answer to incoming message and call webhooks.
// These held responses carry no data and command no provider effect:
// the empty <Response/> receives an inbound message without replying
// (Twilio's Advanced Opt-Out answers STOP/HELP itself; replying here would
// double-send), and <Reject reason="busy"/> declines a call without answering
// it. Verified Voice independently replaces only that response with the exact
// per-binding private <Dial action> plan after durable arrival evidence.
export const TWILIO_RESPONDER_INBOUND_MESSAGE_TWIML =
  "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>";
export const TWILIO_RESPONDER_INBOUND_VOICE_TWIML =
  TWILIO_RESPONDER_HELD_VOICE_TWIML;
export const TWILIO_RESPONDER_INBOUND_DIAL_RESULT_TWIML =
  "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Hangup/></Response>";
export const TWILIO_RESPONDER_CONDITIONAL_FORWARD_TWIML =
  TWILIO_RESPONDER_INBOUND_DIAL_RESULT_TWIML;

const OPERATIONS = deepFreeze({
  [TWILIO_RESPONDER_INBOUND_MESSAGE_PATH]: {
    method: "ingestInboundMessage",
    twiml: TWILIO_RESPONDER_INBOUND_MESSAGE_TWIML
  },
  [TWILIO_RESPONDER_INBOUND_VOICE_PATH]: {
    method: "ingestVoiceCall"
  },
  [TWILIO_RESPONDER_INBOUND_DIAL_RESULT_PATH]: {
    method: "ingestDialResult",
    twiml: TWILIO_RESPONDER_INBOUND_DIAL_RESULT_TWIML
  }
});

export const TWILIO_RESPONDER_INBOUND_PATHS = deepFreeze(
  Object.keys(OPERATIONS)
);

function exactObject(value, keys, field) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    "TWILIO_RESPONDER_INBOUND_HTTP_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
}

export function createTwilioResponderInboundHttpAdapter({
  inbound = createHeldTwilioResponderInbound(),
  voiceDialPlan = createHeldTwilioResponderVoiceDialPlan()
} = {}) {
  invariant(
    inbound?.kind === "twilio-responder-inbound" &&
      inbound.providerEffects === false &&
      typeof inbound.readiness === "function" &&
      typeof inbound.ingestInboundMessage === "function" &&
      typeof inbound.ingestVoiceCall === "function" &&
      typeof inbound.ingestDialResult === "function",
    "TWILIO_RESPONDER_INBOUND_HTTP_CONFIGURATION_REQUIRED",
    "The Twilio inbound HTTP adapter requires verified ingress.",
    { status: 500 }
  );
  invariant(
    voiceDialPlan?.kind === "twilio-responder-voice-dial-plan" &&
      typeof voiceDialPlan.providerEffects === "boolean" &&
      typeof voiceDialPlan.readiness === "function" &&
      typeof voiceDialPlan.twiml === "function",
    "TWILIO_RESPONDER_INBOUND_HTTP_CONFIGURATION_REQUIRED",
    "The Twilio inbound HTTP adapter requires an exact Voice dial plan.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "twilio-responder-inbound-http-adapter",
    mode: inbound.mode === "held" ? "held" : "raw-form",
    providerEffects: voiceDialPlan.providerEffects,
    async readiness() {
      const [ingress, voice] = await Promise.all([
        inbound.readiness(),
        voiceDialPlan.readiness()
      ]);
      const voiceRequired = voiceDialPlan.mode !== "held";
      const ready = ingress?.ready === true && ingress?.verified === true &&
        (!voiceRequired || (voice?.ready === true && voice?.verified === true));
      return deepFreeze({
        ...ingress,
        ready,
        verified: ready,
        providerEffects: voice?.ready === true &&
          voiceDialPlan.providerEffects === true,
        ingressProviderEffects: false,
        voiceOperational: voice?.voiceOperational === true,
        voiceDialPlan: voice?.voiceDialPlan ?? "held",
        voiceCode: voice?.code ?? null,
        code: ready ? null : ingress?.code ?? voice?.code ??
          "TWILIO_RESPONDER_INBOUND_NOT_READY"
      });
    },
    async handle(input = {}) {
      exactObject(
        input,
        ["headers", "method", "pathname", "rawBody"],
        "Twilio inbound HTTP request"
      );
      const operation = OPERATIONS[input.pathname];
      invariant(
        input.method === "POST" &&
          operation !== undefined &&
          Buffer.isBuffer(input.rawBody),
        "TWILIO_RESPONDER_INBOUND_HTTP_INVALID",
        "The Twilio inbound event requires POST and exact raw bytes.",
        { status: 400, details: { providerEffects: false } }
      );
      const receipt = await inbound[operation.method]({
        rawBody: input.rawBody,
        headers: input.headers
      });
      invariant(
        receipt?.schema ===
          "sitesourcery.responder-twilio-inbound-receipt/v1" &&
          ["applied", "recorded", "unbound", "superseded"]
            .includes(receipt.eventState) &&
          receipt.providerEffects === false,
        "TWILIO_RESPONDER_INBOUND_HTTP_DURABILITY_REQUIRED",
        "HTTP success requires a durable Twilio inbound receipt.",
        { status: 503, details: { providerEffects: false } }
      );
      let twiml = operation.twiml;
      if (input.pathname === TWILIO_RESPONDER_INBOUND_VOICE_PATH) {
        if (
          receipt.voiceArrivalPolicy ===
            "conditional_no_answer_forwarding"
        ) {
          invariant(
            receipt.channel === "voice" &&
              receipt.eventKind === "call_received" &&
              (receipt.eventState === "applied" ||
                receipt.eventState === "recorded") &&
              (receipt.eventState === "applied") ===
                (receipt.coreApplied === true) &&
              (receipt.eventState !== "applied" ||
                typeof receipt.forwardingOnboardingId === "string") &&
              (receipt.forwardingOnboardingId !== null ||
                (receipt.eventState === "recorded" &&
                  receipt.stateReason ===
                    "forwarding_onboarding_unavailable")),
            "TWILIO_RESPONDER_INBOUND_HTTP_DURABILITY_REQUIRED",
            "Conditional forwarding requires exact durable evidence.",
            { status: 503, details: { providerEffects: false } }
          );
          // The original carrier already decided that this call was
          // unanswered. Dialing the retained line here would create a
          // forwarding loop, so conditional mode can only terminate the
          // managed leg after durable evidence is recorded.
          twiml = TWILIO_RESPONDER_CONDITIONAL_FORWARD_TWIML;
        } else {
          twiml = await voiceDialPlan.twiml(receipt);
        }
      }
      return deepFreeze({
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/xml; charset=utf-8"
        },
        body: twiml
      });
    }
  });
}

export function createHeldTwilioResponderInboundHttpAdapter() {
  return createTwilioResponderInboundHttpAdapter();
}
