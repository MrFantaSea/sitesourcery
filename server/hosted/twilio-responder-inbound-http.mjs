import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";
import { canonicalJson } from "./security.mjs";
import {
  createHeldTwilioResponderInbound,
  TWILIO_RESPONDER_INBOUND_MAXIMUM_BYTES
} from "./twilio-responder-inbound.mjs";

export const TWILIO_RESPONDER_INBOUND_MESSAGE_PATH =
  "/api/v1/provider-events/twilio/inbound-messages";
export const TWILIO_RESPONDER_INBOUND_VOICE_PATH =
  "/api/v1/provider-events/twilio/voice";
export const TWILIO_RESPONDER_INBOUND_DIAL_RESULT_PATH =
  "/api/v1/provider-events/twilio/voice/dial-result";
export { TWILIO_RESPONDER_INBOUND_MAXIMUM_BYTES };

// Twilio requires a TwiML answer to incoming message and call webhooks.
// These fixed responses carry no data and command no provider effect:
// the empty <Response/> receives an inbound message without replying
// (Twilio's Advanced Opt-Out answers STOP/HELP itself; replying here would
// double-send), and <Reject reason="busy"/> is the only TwiML that declines
// a call without answering it. The private <Dial action> plan that produces
// real DialCallStatus evidence is deliberately not composed in this cohort;
// until FIN-004T/U supplies it, the Voice arrival route is an evidence
// recorder, not an operational missed-call path.
export const TWILIO_RESPONDER_INBOUND_MESSAGE_TWIML =
  "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>";
export const TWILIO_RESPONDER_INBOUND_VOICE_TWIML =
  "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
  "<Response><Reject reason=\"busy\"/></Response>";
export const TWILIO_RESPONDER_INBOUND_DIAL_RESULT_TWIML =
  "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Hangup/></Response>";

const OPERATIONS = deepFreeze({
  [TWILIO_RESPONDER_INBOUND_MESSAGE_PATH]: {
    method: "ingestInboundMessage",
    twiml: TWILIO_RESPONDER_INBOUND_MESSAGE_TWIML
  },
  [TWILIO_RESPONDER_INBOUND_VOICE_PATH]: {
    method: "ingestVoiceCall",
    twiml: TWILIO_RESPONDER_INBOUND_VOICE_TWIML
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
  inbound = createHeldTwilioResponderInbound()
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
  return Object.freeze({
    kind: "twilio-responder-inbound-http-adapter",
    mode: inbound.mode === "held" ? "held" : "raw-form",
    providerEffects: false,
    readiness: () => inbound.readiness(),
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
      return deepFreeze({
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/xml; charset=utf-8"
        },
        body: operation.twiml
      });
    }
  });
}

export function createHeldTwilioResponderInboundHttpAdapter() {
  return createTwilioResponderInboundHttpAdapter();
}
