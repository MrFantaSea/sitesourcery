import { invariant } from "./errors.mjs";
import {
  createHeldTwilioResponderEventsHttpAdapter,
  createTwilioResponderEventsHttpAdapter
} from "./twilio-responder-events-http.mjs";
import {
  createTwilioResponderEvents
} from "./twilio-responder-events.mjs";

export const TWILIO_RESPONDER_EVENT_MODE_ENVIRONMENT =
  "SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE";
export const TWILIO_RESPONDER_WEBHOOK_AUTH_TOKEN_ENVIRONMENT =
  "SITESOURCERY_TWILIO_WEBHOOK_AUTH_TOKEN";

function value(environment, name) {
  const selected = environment?.[name];
  return typeof selected === "string" && selected.length > 0
    ? selected
    : null;
}

export function createConfiguredTwilioResponderEventsHttp({
  environment = process.env,
  repository,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const mode = value(
    environment,
    TWILIO_RESPONDER_EVENT_MODE_ENVIRONMENT
  ) ?? "held";
  const authToken = value(
    environment,
    TWILIO_RESPONDER_WEBHOOK_AUTH_TOKEN_ENVIRONMENT
  );
  invariant(
    mode === "held" || mode === "verified",
    "TWILIO_RESPONDER_EVENT_CONFIGURATION_REQUIRED",
    `${TWILIO_RESPONDER_EVENT_MODE_ENVIRONMENT} must be held or verified.`,
    { status: 500 }
  );
  if (mode === "held") {
    invariant(
      authToken === null,
      "TWILIO_RESPONDER_EVENT_CONFIGURATION_REQUIRED",
      "The Twilio webhook Auth Token cannot be staged while ingress is held.",
      { status: 500 }
    );
    return createHeldTwilioResponderEventsHttpAdapter();
  }
  invariant(
    authToken !== null,
    "TWILIO_RESPONDER_EVENT_CONFIGURATION_REQUIRED",
    `${TWILIO_RESPONDER_WEBHOOK_AUTH_TOKEN_ENVIRONMENT} is required.`,
    { status: 500 }
  );
  return createTwilioResponderEventsHttpAdapter({
    events: createTwilioResponderEvents({
      accountSid: value(environment, "SITESOURCERY_TWILIO_ACCOUNT_SID"),
      callbackUrl: value(
        environment,
        "SITESOURCERY_TWILIO_STATUS_CALLBACK_URL"
      ),
      webhookAuthToken: authToken,
      repository,
      clock
    })
  });
}
