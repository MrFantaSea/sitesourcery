import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const DIAL_RESULT_URL =
  "https://sitesourcery.com/api/v1/provider-events/twilio/voice/dial-result";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const E164 = /^\+[1-9][0-9]{1,14}$/u;

export const TWILIO_RESPONDER_HELD_VOICE_TWIML =
  "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
  "<Response><Reject reason=\"busy\"/></Response>";

function dialResultUrl(value) {
  let selected;
  try {
    selected = new URL(value);
  } catch {
    selected = null;
  }
  invariant(
    selected && selected.href === DIAL_RESULT_URL,
    "RESPONDER_VOICE_DIAL_PLAN_CONFIGURATION_REQUIRED",
    "The Responder Voice dial-result URL is invalid.",
    { status: 500 }
  );
  return selected.href;
}

function render(target, actionUrl) {
  invariant(
    typeof target === "string" && E164.test(target),
    "RESPONDER_VOICE_DIAL_PLAN_UNAVAILABLE",
    "The private Responder Voice target is unavailable.",
    { status: 503 }
  );
  return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
    `<Response><Dial action="${actionUrl}" method="POST" ` +
    "answerOnBridge=\"true\" timeout=\"20\">" +
    `<Number>${target}</Number></Dial></Response>`;
}

export function isExactTwilioResponderVoiceTwiML(value) {
  if (value === TWILIO_RESPONDER_HELD_VOICE_TWIML) return true;
  const match = /^<\?xml version="1\.0" encoding="UTF-8"\?><Response><Dial action="([^"]+)" method="POST" answerOnBridge="true" timeout="20"><Number>(\+[1-9][0-9]{1,14})<\/Number><\/Dial><\/Response>$/u.exec(value);
  if (!match) return false;
  try {
    return dialResultUrl(match[1]) === match[1] && E164.test(match[2]);
  } catch {
    return false;
  }
}

export function createHeldTwilioResponderVoiceDialPlan() {
  return Object.freeze({
    kind: "twilio-responder-voice-dial-plan",
    mode: "held",
    providerEffects: false,
    async readiness() {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "twilio-responder-voice-dial-plan",
        mode: "held",
        providerEffects: false,
        voiceOperational: false,
        voiceDialPlan: "held",
        code: "RESPONDER_VOICE_DIAL_PLAN_HELD"
      });
    },
    async twiml() {
      return TWILIO_RESPONDER_HELD_VOICE_TWIML;
    }
  });
}

export function createTwilioResponderVoiceDialPlan({
  targets,
  dialResultUrl: selectedDialResultUrl
} = {}) {
  invariant(
    targets?.kind === "responder-voice-dial-targets-postgres" &&
      targets.providerEffects === false &&
      typeof targets.readiness === "function" &&
      typeof targets.resolveTarget === "function",
    "RESPONDER_VOICE_DIAL_PLAN_CONFIGURATION_REQUIRED",
    "The Responder Voice dial plan requires private target resolution.",
    { status: 500 }
  );
  const actionUrl = dialResultUrl(selectedDialResultUrl);
  return Object.freeze({
    kind: "twilio-responder-voice-dial-plan",
    mode: "verified-private-forward",
    providerEffects: true,
    async readiness() {
      const targetStatus = await targets.readiness();
      const ready = targetStatus?.ready === true &&
        targetStatus?.verified === true;
      return deepFreeze({
        ready,
        verified: ready,
        kind: "twilio-responder-voice-dial-plan",
        mode: "verified-private-forward",
        providerEffects: ready,
        voiceOperational: ready,
        voiceDialPlan: ready ? "verified-private-forward" : "not-ready",
        code: ready ? null : targetStatus?.code ??
          "RESPONDER_VOICE_DIAL_PLAN_NOT_READY"
      });
    },
    async twiml(receipt = {}) {
      invariant(
        receipt.channel === "voice" && receipt.eventKind === "call_received" &&
          receipt.eventState === "recorded" &&
          typeof receipt.numberBindingId === "string" &&
          UUID.test(receipt.numberBindingId),
        "RESPONDER_VOICE_DIAL_PLAN_UNAVAILABLE",
        "Durable bound Voice arrival evidence is required before dialing.",
        { status: 503 }
      );
      const target = await targets.resolveTarget({
        numberBindingId: receipt.numberBindingId
      });
      return render(target, actionUrl);
    }
  });
}

export function voiceDialModeFromEnvironment(environment = process.env) {
  const mode = environment?.SITESOURCERY_TWILIO_VOICE_DIAL_MODE ?? "held";
  if (mode !== "held" && mode !== "verified") {
    throw new HostedError(
      "RESPONDER_VOICE_DIAL_PLAN_CONFIGURATION_REQUIRED",
      "SITESOURCERY_TWILIO_VOICE_DIAL_MODE must be held or verified.",
      { status: 500 }
    );
  }
  return mode;
}
