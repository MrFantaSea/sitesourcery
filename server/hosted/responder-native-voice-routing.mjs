import { twilioPushSlotMap } from "./responder-twilio-provider-registry.mjs";
import { invariant } from "./errors.mjs";

export function nativeVoiceRoutingModeFromEnvironment(environment = process.env) {
  const mode = environment.SITESOURCERY_RESPONDER_NATIVE_VOICE_ROUTING_MODE ?? "held";
  invariant(mode === "held" || mode === "verified", "RESPONDER_NATIVE_VOICE_ROUTING_CONFIGURATION_REQUIRED",
    "Native Voice routing mode must be held or verified.", { status: 500 });
  if (mode === "verified") invariant(
    environment.SITESOURCERY_TWILIO_INBOUND_EVENT_MODE === "verified" &&
    environment.SITESOURCERY_TWILIO_VOICE_ACCESS_MODE === "verified" &&
    (environment.SITESOURCERY_TWILIO_VOICE_DIAL_MODE ?? "held") === "held",
    "RESPONDER_NATIVE_VOICE_ROUTING_CONFIGURATION_REQUIRED",
    "Native Voice routing requires verified ingress and issuance, with carrier dialing held.", { status: 500 });
  return mode;
}

export function createResponderNativeVoiceRouting({ mode = "held", routes, voiceAccess } = {}) {
  invariant(["held", "verified"].includes(mode) && (mode === "held" || (
    routes?.kind === "responder-native-voice-routes-postgres" && routes.providerEffects === false &&
    typeof routes.resolveIdentities === "function" && typeof routes.readiness === "function" &&
    voiceAccess?.mode === "verified" && typeof voiceAccess.readiness === "function")),
  "RESPONDER_NATIVE_VOICE_ROUTING_CONFIGURATION_REQUIRED", "Native Voice routing authority is unavailable.", { status: 500 });
  return Object.freeze({
    kind: "responder-native-voice-routing", mode, providerEffects: false,
    async readiness() {
      let ready = false;
      let signer = null;
      if (mode === "verified") {
        try {
          const [storage, selectedSigner] = await Promise.all([routes.readiness(), voiceAccess.readiness()]);
          signer = selectedSigner;
          ready = storage.ready === true && storage.verified === true && signer.ready === true &&
            signer.verified === true && signer.issuanceEnabled === true;
        } catch { /* readiness fails closed */ }
      }
      const anyRoutingReady = ready && signer?.hasConfiguredPushSlot === true;
      const legacyReady = anyRoutingReady && signer?.legacyRoutingCompatible === true;
      const routingSlots = twilioPushSlotMap((slot) => {
        const [platform, environment] = slot.split(".");
        return anyRoutingReady && signer?.pushSlots?.[platform]?.[environment] === true;
      });
      return { ready, verified: ready, anyRoutingReady, routingSlots,
        routingReady: anyRoutingReady, operationalCalls: anyRoutingReady, legacyRoutingReady: legacyReady,
        voiceRoutingMode: mode === "verified" ? "verified-native-client" : "held",
        providerEffects: false };
    },
    async resolveIdentities(input) {
      if (mode !== "verified" || !(await this.readiness()).anyRoutingReady) return [];
      return routes.resolveIdentities(input);
    }
  });
}
