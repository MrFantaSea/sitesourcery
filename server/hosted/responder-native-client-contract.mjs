import { deepFreeze } from "../commerce-v2/canonical.mjs";

export const RESPONDER_NATIVE_CLIENT_CONTRACT = deepFreeze({
  schema: "sitesourcery.responder-native-client-contract/v1",
  acceptedRegistrationPlatforms: ["ios", "android"],
  initialClient: "ios",
  pushPurposes: ["notification", "voip"],
  physicalTokenOwnership: "purpose-neutral-keyed-digest",
  androidFcmPurposes: ["notification", "voip"],
  launchMode: "conditional_no_answer_forwarding",
  retainedCarrier: true,
  authentication: "hosted-session-cookie-csrf",
  ordinaryPushPayload: "opaque-identifiers-only",
  voipPushPurpose: "real-authorized-voip-call-only",
  voipTransport: "replaceable",
  initialVoipAdapter: "twilio",
  voipTransports: ["twilio_voice_ios", "twilio_voice_android"],
  providerActivation: "owner-gated",
  pushDeliveryEffects: false,
  voiceCallEffects: false,
  carrierCommandEffects: false,
  messageSendEffects: false,
  providerEffects: false
});

export function responderNativeClientContract() {
  return RESPONDER_NATIVE_CLIENT_CONTRACT;
}
