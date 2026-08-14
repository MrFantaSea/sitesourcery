import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { digest } from "./security.mjs";

export const RESPONDER_FORWARDING_CONTRACT = deepFreeze({
  schema: "sitesourcery.responder-forwarding-contract/v1",
  launchMode: "conditional_no_answer_forwarding",
  transportAuthority: "provider_neutral",
  initialAdapter: "twilio",
  retainedCarrier: true,
  instructionContract: "provider-assisted-conditional-no-answer-v1",
  setupAuthority: "customer_carrier_or_voip_administrator",
  setupEffect: "human_executed",
  setupSteps: [
    "Keep the existing business carrier and number.",
    "Ask the carrier or VoIP administrator to enable conditional forwarding only when a call is unanswered.",
    "Forward to the private managed destination assigned during provider activation.",
    "Do not enable unconditional forwarding and do not forward answered calls.",
    "Run the unanswered, answered, reply, and STOP verification checks before release."
  ],
  cancelSteps: [
    "Ask the carrier or VoIP administrator to remove the conditional no-answer route.",
    "Record cancellation evidence and retire the hosted onboarding before reusing the managed destination."
  ],
  verificationRequirements: [
    "carrier_setup_attested",
    "unanswered_forwarding_reached",
    "answered_call_not_forwarded",
    "reply_path_confirmed",
    "stop_path_confirmed"
  ],
  ambiguityBehavior: "manual_review",
  automaticCarrierCommands: false,
  remoteWriteEffects: false,
  providerEffects: false,
  messageSendEffects: false
});

export const RESPONDER_FORWARDING_CONTRACT_DIGEST =
  digest(RESPONDER_FORWARDING_CONTRACT);

export function responderForwardingInstructionPlan() {
  return deepFreeze({
    ...RESPONDER_FORWARDING_CONTRACT,
    contractDigest: RESPONDER_FORWARDING_CONTRACT_DIGEST,
    managedDestination: "assigned_after_provider_release",
    carrierCodes: "not_stored_or_automated"
  });
}
