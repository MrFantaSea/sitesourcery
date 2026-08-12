import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";
import { canonicalJson } from "./security.mjs";
import {
  createHeldTwilioResponderEvents,
  TWILIO_RESPONDER_EVENT_MAXIMUM_BYTES
} from "./twilio-responder-events.mjs";

export const TWILIO_RESPONDER_EVENT_PATH =
  "/api/v1/provider-events/twilio";
export { TWILIO_RESPONDER_EVENT_MAXIMUM_BYTES };

function exactObject(value, keys, field) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    "TWILIO_RESPONDER_EVENT_HTTP_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
}

export function createTwilioResponderEventsHttpAdapter({
  events = createHeldTwilioResponderEvents()
} = {}) {
  invariant(
    events?.kind === "twilio-responder-events" &&
      events.providerEffects === false &&
      typeof events.readiness === "function" &&
      typeof events.ingest === "function",
    "TWILIO_RESPONDER_EVENT_HTTP_CONFIGURATION_REQUIRED",
    "The Twilio callback HTTP adapter requires verified ingress.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "twilio-responder-events-http-adapter",
    mode: events.mode === "held" ? "held" : "raw-form",
    providerEffects: false,
    readiness: () => events.readiness(),
    async handle(input = {}) {
      exactObject(
        input,
        ["headers", "method", "pathname", "rawBody"],
        "Twilio callback HTTP request"
      );
      invariant(
        input.method === "POST" &&
          input.pathname === TWILIO_RESPONDER_EVENT_PATH &&
          Buffer.isBuffer(input.rawBody),
        "TWILIO_RESPONDER_EVENT_HTTP_INVALID",
        "The Twilio callback requires POST and exact raw request bytes.",
        { status: 400, details: { providerEffects: false } }
      );
      const receipt = await events.ingest({
        rawBody: input.rawBody,
        headers: input.headers
      });
      invariant(
        receipt?.schema ===
          "sitesourcery.responder-twilio-delivery-event-receipt/v1" &&
          ["pending", "applied", "stale", "conflict"]
            .includes(receipt.eventState) &&
          receipt.providerEffects === false,
        "TWILIO_RESPONDER_EVENT_HTTP_DURABILITY_REQUIRED",
        "HTTP success requires a durable Twilio callback receipt.",
        { status: 503, details: { providerEffects: false } }
      );
      return deepFreeze({
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8"
        },
        body: {
          received: true,
          eventState: receipt.eventState,
          messageStatus: receipt.messageStatus,
          currentStatus: receipt.currentStatus,
          attentionRequired: receipt.attentionRequired
        }
      });
    }
  });
}

export function createHeldTwilioResponderEventsHttpAdapter() {
  return createTwilioResponderEventsHttpAdapter();
}
