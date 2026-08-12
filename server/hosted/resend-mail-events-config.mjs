import { invariant } from "./errors.mjs";
import {
  createResendMailEventHttpAdapter,
  createHeldResendMailEventHttpAdapter
} from "./resend-mail-events-http.mjs";
import {
  createResendMailEventWebhook
} from "./resend-mail-events.mjs";

export const RESEND_WEBHOOK_MODE_ENVIRONMENT =
  "SITESOURCERY_RESEND_WEBHOOK_MODE";
export const RESEND_WEBHOOK_SECRET_ENVIRONMENT =
  "SITESOURCERY_RESEND_WEBHOOK_SIGNING_SECRET";

function value(environment, name) {
  const selected = environment?.[name];
  return typeof selected === "string" && selected.length > 0
    ? selected
    : null;
}

export function createConfiguredResendMailEventHttp({
  environment = process.env,
  lifecycle,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const mode = value(environment, RESEND_WEBHOOK_MODE_ENVIRONMENT) ?? "held";
  const signingSecret = value(
    environment,
    RESEND_WEBHOOK_SECRET_ENVIRONMENT
  );
  invariant(
    mode === "held" || mode === "verified",
    "RESEND_WEBHOOK_CONFIGURATION_REQUIRED",
    `${RESEND_WEBHOOK_MODE_ENVIRONMENT} must be exactly held or verified.`,
    { status: 500 }
  );
  if (mode === "held") {
    invariant(
      signingSecret === null,
      "RESEND_WEBHOOK_CONFIGURATION_REQUIRED",
      "A Resend webhook secret cannot be staged while ingress remains held.",
      { status: 500 }
    );
    return createHeldResendMailEventHttpAdapter();
  }
  invariant(
    signingSecret !== null,
    "RESEND_WEBHOOK_CONFIGURATION_REQUIRED",
    `${RESEND_WEBHOOK_SECRET_ENVIRONMENT} is required for verified ingress.`,
    { status: 500 }
  );
  return createResendMailEventHttpAdapter({
    webhook: createResendMailEventWebhook({
      signingSecret,
      lifecycle,
      clock
    })
  });
}
