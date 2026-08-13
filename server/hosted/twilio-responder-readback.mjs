import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const PROVIDER = "twilio";
const API_ORIGIN = "https://api.twilio.com";
const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/u;
const MESSAGE_SID = /^(?:SM|MM)[0-9a-fA-F]{32}$/u;
const API_KEY_SID = /^SK[0-9a-fA-F]{32}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MESSAGE_STATUSES = new Set([
  "accepted", "scheduled", "canceled", "queued", "sending", "sent",
  "receiving", "received", "delivered", "undelivered", "failed", "read"
]);
// A Messages list page carries raw recipients and bodies, so pages are
// bounded tightly, projected immediately to digests and statuses, and the
// parsed rows never leave this module.
const MAXIMUM_LIST_RESPONSE_BYTES = 1024 * 1024;
const MAXIMUM_PAGE_SIZE = 100;
const MAXIMUM_PAGES = 5;
const MAXIMUM_TARGETS = 64;
const MAXIMUM_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function configuration(message) {
  return new HostedError(
    "TWILIO_RESPONDER_READBACK_CONFIGURATION_REQUIRED",
    message,
    { status: 500, details: { providerEffects: false } }
  );
}

function unavailable(message = "Twilio readback is unavailable.") {
  return new HostedError(
    "TWILIO_RESPONDER_READBACK_UNAVAILABLE",
    message,
    { status: 503, details: { providerEffects: false } }
  );
}

function invalid(message) {
  return new HostedError(
    "TWILIO_RESPONDER_READBACK_INVALID",
    message,
    { status: 400, details: { providerEffects: false } }
  );
}

function instant(value, field) {
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "TWILIO_RESPONDER_READBACK_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function timeout(value) {
  invariant(
    Number.isSafeInteger(value) && value >= 100 && value <= 30_000,
    "TWILIO_RESPONDER_READBACK_CONFIGURATION_REQUIRED",
    "The Twilio readback timeout is invalid.",
    { status: 500 }
  );
  return value;
}

async function boundedJson(response) {
  const text = await response.text();
  invariant(
    text.length <= MAXIMUM_LIST_RESPONSE_BYTES,
    "TWILIO_RESPONDER_READBACK_UNAVAILABLE",
    "The Twilio readback response is unreasonably large.",
    { status: 503 }
  );
  try {
    return JSON.parse(text);
  } catch {
    throw unavailable("The Twilio readback response is not JSON.");
  }
}

function dateOnly(iso) {
  return iso.slice(0, 10);
}

export function createHeldTwilioResponderReadback() {
  return Object.freeze({
    kind: "twilio-responder-readback",
    mode: "held",
    providerEffects: false,
    readOnly: true,
    async readiness() {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "twilio-responder-readback",
        mode: "held",
        providerEffects: false,
        code: "TWILIO_RESPONDER_READBACK_HELD"
      });
    },
    async findMessages() {
      throw new HostedError(
        "TWILIO_RESPONDER_READBACK_HELD",
        "Twilio readback is held.",
        { status: 503, details: { providerEffects: false } }
      );
    }
  });
}

export function createTwilioResponderReadback({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  clock = { now: () => new Date().toISOString() },
  timeoutMs = 5_000
} = {}) {
  const accountSid = environment?.SITESOURCERY_TWILIO_ACCOUNT_SID;
  const apiKeySid = environment?.SITESOURCERY_TWILIO_API_KEY_SID;
  const apiKeySecret = environment?.SITESOURCERY_TWILIO_API_KEY_SECRET;
  if (typeof accountSid !== "string" || !ACCOUNT_SID.test(accountSid)) {
    throw configuration("The Twilio readback account binding is invalid.");
  }
  if (
    typeof apiKeySid !== "string" || !API_KEY_SID.test(apiKeySid) ||
    typeof apiKeySecret !== "string" || apiKeySecret.length < 16 ||
    apiKeySecret.length > 256
  ) {
    throw configuration("The Twilio readback API key binding is invalid.");
  }
  invariant(
    typeof fetchImpl === "function" && typeof clock?.now === "function",
    "TWILIO_RESPONDER_READBACK_CONFIGURATION_REQUIRED",
    "The Twilio readback fetch implementation and clock are required.",
    { status: 500 }
  );
  const selectedTimeout = timeout(timeoutMs);
  const authorization = `Basic ${Buffer.from(
    `${apiKeySid}:${apiKeySecret}`,
    "utf8"
  ).toString("base64")}`;

  async function listPage(url, signal) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: authorization,
          "User-Agent": "sitesourcery-hosted/1.0"
        },
        signal: signal === null
          ? AbortSignal.timeout(selectedTimeout)
          : AbortSignal.any([signal, AbortSignal.timeout(selectedTimeout)])
      });
    } catch {
      throw unavailable("The Twilio readback request did not complete.");
    }
    if (response.status !== 200) {
      throw unavailable(
        "The Twilio readback request was not accepted."
      );
    }
    return boundedJson(response);
  }

  return Object.freeze({
    kind: "twilio-responder-readback",
    mode: "verified-read-only",
    providerEffects: false,
    readOnly: true,
    async readiness() {
      return deepFreeze({
        ready: true,
        verified: true,
        kind: "twilio-responder-readback",
        mode: "verified-read-only",
        providerEffects: false,
        code: null
      });
    },

    // Point readback by SID is impossible: only SID digests persist. The
    // account's Messages are therefore enumerated over a bounded DateSent
    // window and each listed SID is digest-matched in memory. Raw
    // recipients and bodies from the list are discarded immediately and
    // are never returned, stored, or logged.
    async findMessages({
      targetDigests,
      windowFromIso,
      windowToIso,
      pageSize = MAXIMUM_PAGE_SIZE,
      maximumPages = MAXIMUM_PAGES,
      signal = null
    } = {}) {
      invariant(
        Array.isArray(targetDigests) &&
          targetDigests.length >= 1 &&
          targetDigests.length <= MAXIMUM_TARGETS &&
          targetDigests.every(
            (target) => typeof target === "string" && SHA256.test(target)
          ),
        "TWILIO_RESPONDER_READBACK_INVALID",
        "Twilio readback targets must be bounded SHA-256 digests.",
        { status: 400 }
      );
      const fromIso = instant(windowFromIso, "The readback window start");
      const toIso = instant(windowToIso, "The readback window end");
      invariant(
        Date.parse(toIso) >= Date.parse(fromIso) &&
          Date.parse(toIso) - Date.parse(fromIso) <= MAXIMUM_WINDOW_MS,
        "TWILIO_RESPONDER_READBACK_INVALID",
        "The Twilio readback window is invalid.",
        { status: 400 }
      );
      invariant(
        Number.isSafeInteger(pageSize) && pageSize >= 1 &&
          pageSize <= MAXIMUM_PAGE_SIZE &&
          Number.isSafeInteger(maximumPages) && maximumPages >= 1 &&
          maximumPages <= MAXIMUM_PAGES,
        "TWILIO_RESPONDER_READBACK_INVALID",
        "The Twilio readback page bounds are invalid.",
        { status: 400 }
      );

      const remaining = new Set(targetDigests);
      const matches = [];
      let scanned = 0;
      let pagesFetched = 0;
      const query = new URLSearchParams({
        PageSize: String(pageSize),
        "DateSent>": dateOnly(fromIso),
        "DateSent<": dateOnly(
          new Date(Date.parse(toIso) + 24 * 60 * 60 * 1000).toISOString()
        )
      });
      let nextUrl =
        `${API_ORIGIN}/2010-04-01/Accounts/${accountSid}` +
        `/Messages.json?${query.toString()}`;

      while (nextUrl !== null && pagesFetched < maximumPages) {
        const page = await listPage(nextUrl, signal);
        pagesFetched += 1;
        const rows = Array.isArray(page?.messages) ? page.messages : null;
        if (rows === null) {
          throw unavailable("The Twilio readback page shape is invalid.");
        }
        for (const row of rows) {
          const sid = row?.sid;
          const status = row?.status;
          if (
            typeof sid !== "string" || !MESSAGE_SID.test(sid) ||
            typeof status !== "string" || !MESSAGE_STATUSES.has(status)
          ) {
            throw unavailable("The Twilio readback row shape is invalid.");
          }
          scanned += 1;
          const sidDigest = digest(sid);
          if (!remaining.has(sidDigest)) continue;
          remaining.delete(sidDigest);
          matches.push(deepFreeze({
            providerMessageIdDigest: sidDigest,
            status,
            errorCodeDigest: row.error_code === null ||
              row.error_code === undefined
              ? null
              : digest({
                  provider: PROVIDER,
                  errorCode: String(row.error_code)
                }),
            readbackEvidenceDigest: digest({
              schema: "sitesourcery.twilio-readback-evidence/v1",
              provider: PROVIDER,
              providerMessageIdDigest: sidDigest,
              status,
              observedAt: clock.now()
            })
          }));
        }
        nextUrl = typeof page.next_page_uri === "string" &&
          page.next_page_uri.length > 0
          ? `${API_ORIGIN}${page.next_page_uri}`
          : null;
        if (remaining.size === 0) break;
      }

      return deepFreeze({
        schema: "sitesourcery.twilio-readback-result/v1",
        providerEffects: false,
        matches,
        unmatchedDigests: deepFreeze([...remaining]),
        scanned,
        pagesFetched,
        exhausted: nextUrl === null
      });
    }
  });
}

export function configuredTwilioResponderReadback({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  clock = { now: () => new Date().toISOString() },
  timeoutMs = 5_000
} = {}) {
  const mode = environment?.SITESOURCERY_TWILIO_READBACK_MODE ?? "held";
  invariant(
    mode === "held" || mode === "verified",
    "TWILIO_RESPONDER_READBACK_CONFIGURATION_REQUIRED",
    "SITESOURCERY_TWILIO_READBACK_MODE must be held or verified.",
    { status: 500 }
  );
  if (mode === "held") return createHeldTwilioResponderReadback();
  return createTwilioResponderReadback({
    environment,
    fetchImpl,
    clock,
    timeoutMs
  });
}
