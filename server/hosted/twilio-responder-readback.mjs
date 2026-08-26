import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";
import {
  twilioIsvProviderRegistryFromEnvironment
} from "./responder-twilio-provider-registry.mjs";
import {
  createPostgresResponderTwilioProviderTopologyRepository
} from "./responder-twilio-provider-topology-postgres.mjs";

const PROVIDER = "twilio";
const API_ORIGIN = "https://api.twilio.com";
const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/u;
const MESSAGING_SERVICE_SID = /^MG[0-9a-fA-F]{32}$/u;
const MESSAGE_SID = /^(?:SM|MM)[0-9a-fA-F]{32}$/u;
const API_KEY_SID = /^SK[0-9a-fA-F]{32}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const E164_US = /^\+1[2-9][0-9]{9}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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

async function boundedText(response) {
  const contentLength = response?.headers?.get?.("content-length");
  if (contentLength !== null && contentLength !== undefined &&
      /^[0-9]+$/u.test(contentLength) &&
      Number(contentLength) > MAXIMUM_LIST_RESPONSE_BYTES) {
    throw unavailable("The Twilio readback response is unreasonably large.");
  }
  if (typeof response?.body?.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAXIMUM_LIST_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw unavailable(
          "The Twilio readback response is unreasonably large."
        );
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  }
  invariant(
    typeof response?.text === "function",
    "TWILIO_RESPONDER_READBACK_UNAVAILABLE",
    "The Twilio readback response shape is invalid.",
    { status: 503 }
  );
  const text = await response.text();
  invariant(
    Buffer.byteLength(text, "utf8") <= MAXIMUM_LIST_RESPONSE_BYTES,
    "TWILIO_RESPONDER_READBACK_UNAVAILABLE",
    "The Twilio readback response is unreasonably large.",
    { status: 503 }
  );
  return text;
}

async function boundedJson(response) {
  const text = await boundedText(response);
  try {
    return JSON.parse(text);
  } catch {
    throw unavailable("The Twilio readback response is not JSON.");
  }
}

function exactKeys(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...fields].sort());
}

function target(value) {
  if (exactKeys(value, ["kind", "providerMessageIdDigest"]) &&
      value.kind === "provider_message_id" &&
      SHA256.test(value.providerMessageIdDigest)) {
    return deepFreeze({
      kind: value.kind,
      providerMessageIdDigest: value.providerMessageIdDigest
    });
  }
  if (exactKeys(value, ["kind", "routeDigest", "contentDigest"]) &&
      value.kind === "responder_message_shape" &&
      SHA256.test(value.routeDigest) && SHA256.test(value.contentDigest)) {
    return deepFreeze({
      kind: value.kind,
      routeDigest: value.routeDigest,
      contentDigest: value.contentDigest
    });
  }
  throw invalid("The Twilio readback target is invalid.");
}

function targetDigest(value) {
  return digest({
    schema: "sitesourcery.twilio-readback-target/v1",
    ...value
  });
}

function paginationUrl(value, accountSid) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 4096 ||
      !value.startsWith("/")) {
    throw unavailable("The Twilio readback pagination target is invalid.");
  }
  let selected;
  try {
    selected = new URL(value, API_ORIGIN);
  } catch {
    throw unavailable("The Twilio readback pagination target is invalid.");
  }
  if (selected.origin !== API_ORIGIN || selected.username ||
      selected.password || selected.hash ||
      selected.pathname !==
        `/2010-04-01/Accounts/${accountSid}/Messages.json`) {
    throw unavailable("The Twilio readback pagination target is invalid.");
  }
  return selected.href;
}

function responderRouteDigest(to) {
  return digest({ routeKind: "sms", address: to });
}

function responderContentDigest(body) {
  return digest({ contentKind: "sms", body });
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
  providerRegistry,
  providerTopologyRepository,
  fetchImpl = globalThis.fetch,
  clock = { now: () => new Date().toISOString() },
  timeoutMs = 5_000
} = {}) {
  invariant(
    [
      "SITESOURCERY_TWILIO_ACCOUNT_SID",
      "SITESOURCERY_TWILIO_MESSAGING_SERVICE_SID",
      "SITESOURCERY_TWILIO_API_KEY_SID",
      "SITESOURCERY_TWILIO_API_KEY_SECRET"
    ].every((name) => environment?.[name] === undefined ||
      environment[name] === "") &&
      providerRegistry?.kind === "twilio-isv-provider-registry" &&
      providerRegistry.providerEffects === false &&
      typeof providerRegistry.resolveOrganization === "function" &&
      typeof providerRegistry.readiness === "function" &&
      providerTopologyRepository?.kind ===
        "responder-twilio-provider-topology-postgres" &&
      providerTopologyRepository.providerEffects === false &&
      typeof providerTopologyRepository.requireActiveTopology === "function" &&
      typeof providerTopologyRepository.readiness === "function" &&
      typeof fetchImpl === "function" && typeof clock?.now === "function",
    "TWILIO_RESPONDER_READBACK_CONFIGURATION_REQUIRED",
    "The Twilio readback fetch implementation and clock are required.",
    { status: 500 }
  );
  const selectedTimeout = timeout(timeoutMs);

  async function listPage(url, signal, provider) {
    const { accountSid, authorization } = provider;
    let selectedUrl;
    try {
      selectedUrl = new URL(url);
    } catch {
      throw unavailable("The Twilio readback request target is invalid.");
    }
    if (selectedUrl.origin !== API_ORIGIN || selectedUrl.username ||
        selectedUrl.password || selectedUrl.hash ||
        selectedUrl.pathname !==
          `/2010-04-01/Accounts/${accountSid}/Messages.json`) {
      throw unavailable("The Twilio readback request target is invalid.");
    }
    let response;
    try {
      response = await fetchImpl(selectedUrl.href, {
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
      try {
        const [registry, topology] = await Promise.all([
          providerRegistry.readiness(),
          providerTopologyRepository.readiness()
        ]);
        const ready = registry?.ready === true && registry?.verified === true &&
          topology?.ready === true && topology?.verified === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "twilio-responder-readback",
          mode: "verified-read-only",
          providerEffects: false,
          code: ready ? null : "TWILIO_RESPONDER_READBACK_NOT_VERIFIED"
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "twilio-responder-readback",
          mode: "verified-read-only",
          providerEffects: false,
          code: "TWILIO_RESPONDER_READBACK_NOT_VERIFIED"
        });
      }
    },

    // Point readback by SID is impossible because only SID digests persist.
    // The account's Messages are enumerated over a bounded window. A known
    // SID is digest-matched; an ambiguous create is matched by the already
    // authorized route/content digests. Raw recipients, bodies, and SIDs
    // never leave this module.
    async findMessages({
      organizationId,
      targets,
      windowFromIso,
      windowToIso,
      pageSize = MAXIMUM_PAGE_SIZE,
      maximumPages = MAXIMUM_PAGES,
      signal = null
    } = {}) {
      invariant(
        typeof organizationId === "string" && UUID.test(organizationId) &&
          Array.isArray(targets) && targets.length >= 1 &&
          targets.length <= MAXIMUM_TARGETS,
        "TWILIO_RESPONDER_READBACK_INVALID",
        "Twilio readback targets must be bounded.",
        { status: 400 }
      );
      const providerAuthority = providerRegistry.resolveOrganization(
        organizationId
      );
      await providerTopologyRepository.requireActiveTopology(
        providerAuthority.topology
      );
      const accountSid = providerAuthority.accountSid;
      const messagingServiceSid = providerAuthority.messagingServiceSid;
      const authorization = `Basic ${Buffer.from(
        `${providerAuthority.messagingApiKeySid}:` +
          providerAuthority.messagingApiKeySecret,
        "utf8"
      ).toString("base64")}`;
      const provider = { accountSid, authorization };
      const selectedTargets = targets.map(target);
      const selectedTargetDigests = selectedTargets.map(targetDigest);
      invariant(
        new Set(selectedTargetDigests).size === selectedTargetDigests.length,
        "TWILIO_RESPONDER_READBACK_INVALID",
        "Twilio readback targets must be unique.",
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

      const matches = new Map(selectedTargetDigests.map(
        (selected) => [selected, new Map()]
      ));
      let scanned = 0;
      let pagesFetched = 0;
      const query = new URLSearchParams({
        PageSize: String(pageSize)
      });
      let nextUrl =
        `${API_ORIGIN}/2010-04-01/Accounts/${accountSid}` +
        `/Messages.json?${query.toString()}`;

      while (nextUrl !== null && pagesFetched < maximumPages) {
        const page = await listPage(nextUrl, signal, provider);
        pagesFetched += 1;
        const rows = Array.isArray(page?.messages) ? page.messages : null;
        if (rows === null || rows.length > pageSize) {
          throw unavailable("The Twilio readback page shape is invalid.");
        }
        for (const row of rows) {
          const sid = row?.sid;
          const status = row?.status;
          const to = row?.to;
          const body = row?.body;
          const createdAt = row?.date_created;
          if (
            typeof sid !== "string" || !MESSAGE_SID.test(sid) ||
            typeof status !== "string" || !MESSAGE_STATUSES.has(status) ||
            row?.account_sid !== accountSid ||
            row?.messaging_service_sid !== messagingServiceSid ||
            typeof to !== "string" || !E164_US.test(to) ||
            typeof body !== "string" || body.length < 1 ||
            body.length > 320 ||
            typeof createdAt !== "string" ||
            !Number.isFinite(Date.parse(createdAt))
          ) {
            throw unavailable("The Twilio readback row shape is invalid.");
          }
          scanned += 1;
          const createdTime = Date.parse(createdAt);
          if (createdTime < Date.parse(fromIso) ||
              createdTime > Date.parse(toIso)) continue;
          const sidDigest = digest(sid);
          const projected = deepFreeze({
            providerMessageIdDigest: sidDigest,
            status,
            errorCodeDigest: row.error_code === null ||
              row.error_code === undefined
              ? null
              : digest({
                  provider: PROVIDER,
                  errorCode: String(row.error_code)
                })
          });
          const routeDigest = responderRouteDigest(to);
          const contentDigest = responderContentDigest(body);
          for (let index = 0; index < selectedTargets.length; index += 1) {
            const selectedTarget = selectedTargets[index];
            const targetMatches = selectedTarget.kind ===
              "provider_message_id"
              ? selectedTarget.providerMessageIdDigest === sidDigest
              : selectedTarget.routeDigest === routeDigest &&
                selectedTarget.contentDigest === contentDigest;
            if (targetMatches) {
              matches.get(selectedTargetDigests[index]).set(
                sidDigest,
                projected
              );
            }
          }
        }
        nextUrl = paginationUrl(page.next_page_uri, accountSid);
      }

      const exhausted = nextUrl === null;
      const observedAt = instant(clock.now(), "The readback observation time");
      const results = selectedTargets.map((selectedTarget, index) => {
        const selectedTargetDigest = selectedTargetDigests[index];
        const found = [...matches.get(selectedTargetDigest).values()];
        const matchCount = found.length;
        const state = matchCount === 1
          ? selectedTarget.kind === "provider_message_id"
            ? "matched"
            : "single_candidate"
          : matchCount > 1
            ? "multiple_matches"
            : exhausted
              ? "not_found"
              : "incomplete";
        const only = matchCount === 1 ? found[0] : null;
        return deepFreeze({
          targetDigest: selectedTargetDigest,
          state,
          matchCount,
          providerMessageIdDigest:
            only?.providerMessageIdDigest ?? null,
          status: only?.status ?? null,
          errorCodeDigest: only?.errorCodeDigest ?? null,
          readbackEvidenceDigest: digest({
            schema: "sitesourcery.twilio-readback-evidence/v1",
            provider: PROVIDER,
            target: selectedTarget,
            state,
            matches: found,
            windowFromIso: fromIso,
            windowToIso: toIso,
            pagesFetched,
            scanned,
            exhausted,
            observedAt
          })
        });
      });
      return deepFreeze({
        schema: "sitesourcery.twilio-readback-result/v1",
        providerEffects: false,
        results,
        scanned,
        pagesFetched,
        exhausted,
        observedAt
      });
    }
  });
}

export function configuredTwilioResponderReadback({
  environment = process.env,
  authority = null,
  providerRegistryFactory = twilioIsvProviderRegistryFromEnvironment,
  providerTopologyRepositoryFactory =
    createPostgresResponderTwilioProviderTopologyRepository,
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
  if (mode === "held") {
    invariant(
      [
        "SITESOURCERY_TWILIO_ACCOUNT_SID",
        "SITESOURCERY_TWILIO_MESSAGING_SERVICE_SID",
        "SITESOURCERY_TWILIO_API_KEY_SID",
        "SITESOURCERY_TWILIO_API_KEY_SECRET"
      ].every((name) => environment?.[name] === undefined ||
        environment[name] === ""),
      "TWILIO_RESPONDER_READBACK_CONFIGURATION_REQUIRED",
      "Global Twilio readback credentials cannot be staged while held.",
      { status: 500 }
    );
    return createHeldTwilioResponderReadback();
  }
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof providerRegistryFactory === "function" &&
      typeof providerTopologyRepositoryFactory === "function",
    "TWILIO_RESPONDER_READBACK_CONFIGURATION_REQUIRED",
    "Verified Twilio readback requires customer registry and PostgreSQL authority.",
    { status: 500 }
  );
  return createTwilioResponderReadback({
    environment,
    providerRegistry: providerRegistryFactory(environment),
    providerTopologyRepository:
      providerTopologyRepositoryFactory({ authority }),
    fetchImpl,
    clock,
    timeoutMs
  });
}
