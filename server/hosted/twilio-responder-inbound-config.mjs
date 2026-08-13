import { HostedError, invariant } from "./errors.mjs";
import {
  createIdentityPepperConfiguration
} from "./identity-pepper-config.mjs";
import {
  createResponderLookupDigests
} from "./responder-lookup-digests.mjs";
import {
  responderInboundMaterialVaultFromEnvironment
} from "./responder-inbound-material-vault.mjs";
import {
  createPostgresTwilioResponderInboundRepository
} from "./twilio-responder-inbound-postgres.mjs";
import {
  createTwilioResponderInbound
} from "./twilio-responder-inbound.mjs";
import {
  createPostgresResponderVoiceDialTargets
} from "./responder-voice-dial-target-postgres.mjs";
import {
  responderVoiceDialTargetVaultFromEnvironment
} from "./responder-voice-dial-target-vault.mjs";
import {
  createHeldTwilioResponderVoiceDialPlan,
  createTwilioResponderVoiceDialPlan,
  voiceDialModeFromEnvironment
} from "./twilio-responder-voice-dial-plan.mjs";
import {
  createHeldTwilioResponderInboundHttpAdapter,
  createTwilioResponderInboundHttpAdapter
} from "./twilio-responder-inbound-http.mjs";

export const TWILIO_RESPONDER_INBOUND_MODE_ENVIRONMENT =
  "SITESOURCERY_TWILIO_INBOUND_EVENT_MODE";
export const TWILIO_RESPONDER_INBOUND_MESSAGE_URL_ENVIRONMENT =
  "SITESOURCERY_TWILIO_INBOUND_MESSAGE_URL";
export const TWILIO_RESPONDER_INBOUND_VOICE_URL_ENVIRONMENT =
  "SITESOURCERY_TWILIO_INBOUND_VOICE_URL";
export const TWILIO_RESPONDER_INBOUND_DIAL_RESULT_URL_ENVIRONMENT =
  "SITESOURCERY_TWILIO_INBOUND_DIAL_RESULT_URL";
export const TWILIO_RESPONDER_VOICE_DIAL_MODE_ENVIRONMENT =
  "SITESOURCERY_TWILIO_VOICE_DIAL_MODE";

function value(environment, name) {
  const selected = environment?.[name];
  return typeof selected === "string" && selected.length > 0
    ? selected
    : null;
}

export function composedResponderLookupDigests(environment = process.env) {
  try {
    return createIdentityPepperConfiguration({ environment })
      .compose(createResponderLookupDigests);
  } catch (error) {
    if (error instanceof HostedError) throw error;
    throw new HostedError(
      "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED",
      "The identity pepper composition for keyed Responder lookups failed.",
      { status: 500 }
    );
  }
}

export function createConfiguredTwilioResponderInboundHttp({
  environment = process.env,
  authority = null,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const mode = value(
    environment,
    TWILIO_RESPONDER_INBOUND_MODE_ENVIRONMENT
  ) ?? "held";
  invariant(
    mode === "held" || mode === "verified",
    "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED",
    `${TWILIO_RESPONDER_INBOUND_MODE_ENVIRONMENT} must be held or verified.`,
    { status: 500 }
  );
  const voiceDialMode = voiceDialModeFromEnvironment(environment);
  if (mode === "held") {
    invariant(
      voiceDialMode === "held",
      "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED",
      "Voice dialing cannot be verified while Twilio inbound ingress is held.",
      { status: 500 }
    );
    invariant(
      value(environment, "SITESOURCERY_RESPONDER_MATERIAL_KEY_BASE64URL") ===
        null &&
        value(
          environment,
          "SITESOURCERY_RESPONDER_MATERIAL_PRIOR_KEY_BASE64URL"
        ) === null,
      "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED",
      "Responder material keys cannot be staged while inbound is held.",
      { status: 500 }
    );
    return createHeldTwilioResponderInboundHttpAdapter();
  }
  invariant(
    authority?.kind === "canonical-postgres",
    "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED",
    "Verified Twilio inbound ingress requires the PostgreSQL authority.",
    { status: 500 }
  );
  const lookupDigests = composedResponderLookupDigests(environment);
  const vault = responderInboundMaterialVaultFromEnvironment(environment, {
    fromRouteDigestCandidates: (address) =>
      lookupDigests.callerRouteCandidates(address)
        .map((entry) => entry.digest)
  });
  const repository = createPostgresTwilioResponderInboundRepository({
    authority,
    verifierKeyVersions: [...lookupDigests.verifierVersions]
  });
  const dialResultUrl = value(
    environment,
    TWILIO_RESPONDER_INBOUND_DIAL_RESULT_URL_ENVIRONMENT
  );
  const voiceDialPlan = voiceDialMode === "held"
    ? createHeldTwilioResponderVoiceDialPlan()
    : createTwilioResponderVoiceDialPlan({
        targets: createPostgresResponderVoiceDialTargets({
          authority,
          vault: responderVoiceDialTargetVaultFromEnvironment(environment)
        }),
        dialResultUrl
      });
  return createTwilioResponderInboundHttpAdapter({
    inbound: createTwilioResponderInbound({
      accountSid: value(environment, "SITESOURCERY_TWILIO_ACCOUNT_SID"),
      webhookAuthToken: value(
        environment,
        "SITESOURCERY_TWILIO_WEBHOOK_AUTH_TOKEN"
      ),
      inboundMessageUrl: value(
        environment,
        TWILIO_RESPONDER_INBOUND_MESSAGE_URL_ENVIRONMENT
      ),
      voiceUrl: value(
        environment,
        TWILIO_RESPONDER_INBOUND_VOICE_URL_ENVIRONMENT
      ),
      dialResultUrl,
      repository,
      vault,
      lookupDigests,
      clock
    }),
    voiceDialPlan
  });
}
