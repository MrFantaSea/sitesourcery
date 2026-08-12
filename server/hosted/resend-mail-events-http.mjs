import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";
import { canonicalJson } from "./security.mjs";
import { createHeldResendMailEventWebhook } from
  "./resend-mail-events.mjs";

export const RESEND_MAIL_EVENT_PATH = "/api/v1/webhooks/resend";
export const RESEND_MAIL_EVENT_MAXIMUM_BYTES = 64 * 1024;

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    "RESEND_WEBHOOK_HTTP_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

export function createResendMailEventHttpAdapter({
  webhook = createHeldResendMailEventWebhook()
} = {}) {
  invariant(
    webhook &&
      webhook.providerEffects === false &&
      typeof webhook.readiness === "function" &&
      typeof webhook.ingest === "function",
    "RESEND_WEBHOOK_HTTP_CONFIGURATION_REQUIRED",
    "The Resend webhook HTTP adapter requires verified held ingress.",
    { status: 500 }
  );

  return Object.freeze({
    kind: "resend-mail-event-http-adapter",
    mode: webhook.mode === "held" ? "held" : "raw-body",
    providerEffects: false,
    readiness: () => webhook.readiness(),

    async handle(input = {}) {
      exactObject(
        input,
        ["headers", "method", "pathname", "rawBody"],
        "Resend webhook HTTP request"
      );
      invariant(
        input.method === "POST" &&
          input.pathname === RESEND_MAIL_EVENT_PATH &&
          Buffer.isBuffer(input.rawBody),
        "RESEND_WEBHOOK_HTTP_INVALID",
        "The Resend webhook requires POST and exact raw request bytes.",
        { status: 400, details: { providerEffects: false } }
      );
      const receipt = await webhook.ingest({
        rawBody: input.rawBody,
        headers: input.headers
      });
      exactObject(
        receipt,
        [
          "currentState",
          "eventKind",
          "eventState",
          "httpStatus",
          "providerEffects",
          "schema"
        ],
        "Durable Resend webhook receipt"
      );
      invariant(
        receipt.schema === "sitesourcery.resend-mail-event-receipt/v1" &&
          receipt.httpStatus === 200 &&
          ["applied", "pending", "conflict"].includes(receipt.eventState) &&
          ["delivered", "bounced", "complained", "suppressed"].includes(
            receipt.eventKind
          ) &&
          receipt.providerEffects === false,
        "RESEND_WEBHOOK_HTTP_DURABILITY_REQUIRED",
        "HTTP success requires an explicit durable Resend event receipt.",
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
          eventKind: receipt.eventKind,
          currentState: receipt.currentState
        }
      });
    }
  });
}

export function createHeldResendMailEventHttpAdapter() {
  return createResendMailEventHttpAdapter();
}
