import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const PROVIDER = "twilio";
const API_ORIGIN = "https://api.twilio.com";
const MESSAGING_ORIGIN = "https://messaging.twilio.com";
const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const SID = Object.freeze({
  account: /^AC[0-9a-fA-F]{32}$/u,
  apiKey: /^SK[0-9a-fA-F]{32}$/u,
  messagingService: /^MG[0-9a-fA-F]{32}$/u,
  brand: /^BN[0-9a-fA-F]{32}$/u,
  campaign: /^QE[0-9a-fA-F]{32}$/u,
  message: /^(?:SM|MM)[0-9a-fA-F]{32}$/u
});
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const MESSAGE_KINDS = new Set([
  "missed_call_ack",
  "human_handoff_ack"
]);

function configurationError(message) {
  return new HostedError(
    "TWILIO_RESPONDER_CONFIGURATION_REQUIRED",
    message,
    { status: 500 }
  );
}

function value(environment, name, maximum = 512) {
  const selected = environment?.[name];
  if (
    typeof selected !== "string" ||
    selected.length < 1 ||
    selected.length > maximum ||
    /[\r\n]/u.test(selected)
  ) {
    throw configurationError(`${name} is required.`);
  }
  return selected;
}

function providerSid(environment, name, pattern) {
  const selected = value(environment, name, 64);
  if (!pattern.test(selected)) {
    throw configurationError(`${name} is invalid.`);
  }
  return selected;
}

function timeout(value) {
  invariant(
    Number.isSafeInteger(value) && value >= 100 && value <= 30_000,
    "TWILIO_RESPONDER_CONFIGURATION_REQUIRED",
    "Twilio timeout must be between 100 and 30000 milliseconds.",
    { status: 500 }
  );
  return value;
}

function callbackUrl(value) {
  let selected;
  try {
    selected = new URL(value);
  } catch {
    selected = null;
  }
  if (
    !selected ||
    selected.protocol !== "https:" ||
    selected.username ||
    selected.password ||
    selected.search ||
    selected.hash ||
    selected.pathname !== "/api/v1/provider-events/twilio" ||
    selected.hostname !== "sitesourcery.com"
  ) {
    throw configurationError(
      "SITESOURCERY_TWILIO_STATUS_CALLBACK_URL must be the exact production Twilio callback."
    );
  }
  return selected.href;
}

function exactObject(value, fields, code, message) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...fields].sort()),
    code,
    message,
    { status: 500 }
  );
  return value;
}

function instant(value, field) {
  const selected = String(value ?? "");
  invariant(
    Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "TWILIO_RESPONDER_RECEIPT_INVALID",
    `${field} is invalid.`,
    { status: 502 }
  );
  return selected;
}

function currentTime(clock) {
  return instant(clock?.now?.(), "Provider acceptance time");
}

function request(input) {
  exactObject(input, [
    "schema", "operationId", "commandId", "organizationId", "projectId",
    "interactionId", "contactAuthorityId", "messageKind", "routeDigest",
    "contentDigest", "idempotencyKey", "leaseOwner", "signal"
  ], "TWILIO_RESPONDER_DELIVERY_INVALID",
  "Twilio Responder delivery authority is invalid.");
  invariant(
    input.schema === "sitesourcery.responder-fulfillment-request/v1" &&
      UUID.test(input.operationId) &&
      SAFE_ID.test(input.commandId) &&
      UUID.test(input.organizationId) &&
      UUID.test(input.projectId) &&
      UUID.test(input.interactionId) &&
      UUID.test(input.contactAuthorityId) &&
      MESSAGE_KINDS.has(input.messageKind) &&
      SHA256.test(input.routeDigest) &&
      SHA256.test(input.contentDigest) &&
      SAFE_ID.test(input.idempotencyKey) &&
      SAFE_ID.test(input.leaseOwner) &&
      (
        input.signal === null ||
        (
          typeof input.signal === "object" &&
          typeof input.signal.aborted === "boolean" &&
          typeof input.signal.addEventListener === "function"
        )
      ),
    "TWILIO_RESPONDER_DELIVERY_INVALID",
    "Twilio Responder delivery authority is invalid.",
    { status: 500 }
  );
  return input;
}

export function responderSmsRouteDigest(address) {
  return digest({ routeKind: "sms", address: String(address ?? "") });
}

export function responderSmsContentDigest(body) {
  return digest({ contentKind: "sms", body: String(body ?? "") });
}

function material(value, selectedRequest) {
  exactObject(value, [
    "schema", "routeDigest", "contentDigest", "to", "body"
  ], "TWILIO_RESPONDER_MATERIAL_INVALID",
  "Private Responder delivery material is invalid.");
  invariant(
    value.schema === "sitesourcery.responder-private-sms-material/v1" &&
      value.routeDigest === selectedRequest.routeDigest &&
      value.contentDigest === selectedRequest.contentDigest &&
      /^\+1[2-9][0-9]{9}$/u.test(value.to) &&
      typeof value.body === "string" &&
      value.body.length >= 1 &&
      value.body.length <= 320 &&
      /^[\x20-\x7e\r\n]+$/u.test(value.body) &&
      !/[\r\n]{3,}/u.test(value.body) &&
      value.body.includes("Reply STOP to opt out.") &&
      responderSmsRouteDigest(value.to) === value.routeDigest &&
      responderSmsContentDigest(value.body) === value.contentDigest,
    "TWILIO_RESPONDER_MATERIAL_INVALID",
    "Private Responder delivery material does not match its authority.",
    { status: 500 }
  );
  return value;
}

async function responseJson(response) {
  let source;
  try {
    source = await response.text();
  } catch {
    source = null;
  }
  invariant(
    typeof source === "string" &&
      source.length >= 1 &&
      source.length <= MAXIMUM_RESPONSE_BYTES,
    "TWILIO_RESPONDER_RESPONSE_INVALID",
    "Twilio returned an invalid response.",
    { status: 502 }
  );
  try {
    return JSON.parse(source);
  } catch {
    throw new HostedError(
      "TWILIO_RESPONDER_RESPONSE_INVALID",
      "Twilio returned an invalid response.",
      { status: 502 }
    );
  }
}

function basicAuthorization(apiKeySid, apiKeySecret) {
  return `Basic ${Buffer.from(
    `${apiKeySid}:${apiKeySecret}`,
    "utf8"
  ).toString("base64")}`;
}

function providerFailure(code, message, certainty = "unknown") {
  const error = new HostedError(code, message, { status: 502 });
  error.deliveryDisposition = "manual_review";
  error.providerEffectCertainty = certainty;
  return error;
}

async function apiRequest({
  fetchImpl,
  url,
  method,
  authorization,
  timeoutMs,
  body = null,
  signal = null,
  effectful = false
}) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const selectedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        "User-Agent": "sitesourcery-hosted/1.0",
        ...(body === null
          ? {}
          : { "Content-Type": "application/x-www-form-urlencoded" })
      },
      ...(body === null ? {} : { body }),
      signal: selectedSignal
    });
  } catch {
    throw effectful
      ? providerFailure(
          "TWILIO_RESPONDER_DELIVERY_UNCERTAIN",
          "Twilio delivery requires manual reconciliation."
        )
      : new HostedError(
          "TWILIO_RESPONDER_READINESS_UNAVAILABLE",
          "Twilio readiness is unavailable.",
          { status: 503 }
        );
  }
  invariant(
    response &&
      typeof response.status === "number" &&
      typeof response.text === "function",
    "TWILIO_RESPONDER_RESPONSE_INVALID",
    "Twilio returned an invalid response.",
    { status: 502 }
  );
  if (response.status < 200 || response.status >= 300) {
    throw effectful
      ? providerFailure(
          "TWILIO_RESPONDER_DELIVERY_REJECTED",
          "Twilio delivery requires manual reconciliation.",
          response.status >= 400 && response.status < 500 &&
            ![408, 409, 425, 429].includes(response.status)
            ? "none"
            : "unknown"
        )
      : new HostedError(
          "TWILIO_RESPONDER_READINESS_UNAVAILABLE",
          "Twilio readiness is unavailable.",
          { status: 503 }
        );
  }
  return responseJson(response);
}

export function createTwilioResponderTransport({
  environment = process.env,
  providerRegistry,
  providerTopologyRepository,
  materialResolver,
  fetchImpl = globalThis.fetch,
  clock = { now: () => new Date().toISOString() },
  timeoutMs = 5_000,
  readinessCacheMs = 5_000,
  cacheClock = () => Date.now()
} = {}) {
  invariant(
    [
      "SITESOURCERY_TWILIO_ACCOUNT_SID",
      "SITESOURCERY_TWILIO_API_KEY_SID",
      "SITESOURCERY_TWILIO_API_KEY_SECRET",
      "SITESOURCERY_TWILIO_MESSAGING_SERVICE_SID",
      "SITESOURCERY_TWILIO_BRAND_REGISTRATION_SID",
      "SITESOURCERY_TWILIO_A2P_CAMPAIGN_SID"
    ].every((name) => environment?.[name] === undefined ||
      environment[name] === ""),
    "TWILIO_RESPONDER_CONFIGURATION_REQUIRED",
    "Global Twilio customer credentials are forbidden.",
    { status: 500 }
  );
  const statusCallback = callbackUrl(value(
    environment,
    "SITESOURCERY_TWILIO_STATUS_CALLBACK_URL"
  ));
  const selectedTimeout = timeout(timeoutMs);
  const selectedReadinessCacheMs = Number(readinessCacheMs);
  invariant(
    providerRegistry?.kind === "twilio-isv-provider-registry" &&
      providerRegistry.providerEffects === false &&
      Array.isArray(providerRegistry.organizationIds) &&
      providerRegistry.organizationIds.length >= 1 &&
      typeof providerRegistry.resolveOrganization === "function" &&
      typeof providerRegistry.readiness === "function" &&
      providerTopologyRepository?.kind ===
        "responder-twilio-provider-topology-postgres" &&
      providerTopologyRepository.providerEffects === false &&
      typeof providerTopologyRepository.readiness === "function" &&
      typeof providerTopologyRepository.requireActiveTopology === "function" &&
      materialResolver?.kind ===
        "responder-private-delivery-material-resolver" &&
      materialResolver.providerEffects === false &&
      typeof materialResolver.resolveSmsMaterial === "function" &&
      typeof materialResolver.readiness === "function" &&
      typeof fetchImpl === "function" &&
      typeof clock?.now === "function" &&
      typeof cacheClock === "function" &&
      Number.isSafeInteger(selectedReadinessCacheMs) &&
      selectedReadinessCacheMs >= 0 &&
      selectedReadinessCacheMs <= 60_000,
    "TWILIO_RESPONDER_CONFIGURATION_REQUIRED",
    "Twilio Responder requires exact private material and runtime ports.",
    { status: 500 }
  );

  let readyCache = null;
  let readinessInFlight = null;

  async function inspectCustomerReadiness(provider) {
    const accountSid = provider.accountSid;
    const messagingServiceSid = provider.messagingServiceSid;
    const brandSid = provider.brandRegistrationSid;
    const campaignSid = provider.campaignSid;
    const authorization = basicAuthorization(
      provider.messagingApiKeySid,
      provider.messagingApiKeySecret
    );
    await providerTopologyRepository.requireActiveTopology(provider.topology);
    const [account, service, brand, campaign] = await Promise.all([
      apiRequest({
        fetchImpl,
        url: `${API_ORIGIN}/2010-04-01/Accounts/${accountSid}.json`,
        method: "GET",
        authorization,
        timeoutMs: selectedTimeout
      }),
      apiRequest({
        fetchImpl,
        url: `${MESSAGING_ORIGIN}/v1/Services/${messagingServiceSid}`,
        method: "GET",
        authorization,
        timeoutMs: selectedTimeout
      }),
      apiRequest({
        fetchImpl,
        url: `${MESSAGING_ORIGIN}/v1/a2p/BrandRegistrations/${brandSid}`,
        method: "GET",
        authorization,
        timeoutMs: selectedTimeout
      }),
      apiRequest({
        fetchImpl,
        url: `${MESSAGING_ORIGIN}/v1/Services/${messagingServiceSid}/Compliance/Usa2p/${campaignSid}`,
        method: "GET",
        authorization,
        timeoutMs: selectedTimeout
      })
    ]);
    return account?.sid === accountSid &&
      account?.status === "active" &&
      account?.type === "Full" &&
      service?.sid === messagingServiceSid &&
      service?.account_sid === accountSid &&
      brand?.sid === brandSid &&
      brand?.account_sid === accountSid &&
      brand?.status === "APPROVED" &&
      brand?.identity_status === "VERIFIED" &&
      brand?.brand_type === provider.providerBrandType &&
      brand?.mock === false &&
      campaign?.sid === campaignSid &&
      campaign?.account_sid === accountSid &&
      campaign?.messaging_service_sid === messagingServiceSid &&
      campaign?.brand_registration_sid === brandSid &&
      campaign?.campaign_status === "VERIFIED" &&
      campaign?.usecase === provider.campaignUseCase;
  }

  async function inspectReadiness() {
    try {
      const [privateMaterial, registry, topologyStorage, ...customers] =
        await Promise.all([
          materialResolver.readiness(),
          providerRegistry.readiness(),
          providerTopologyRepository.readiness(),
          ...providerRegistry.organizationIds.map((organizationId) =>
            inspectCustomerReadiness(
              providerRegistry.resolveOrganization(organizationId)
            )
          )
        ]);
      const ready =
        privateMaterial?.ready === true &&
        privateMaterial?.verified === true &&
        registry?.ready === true && registry?.verified === true &&
        topologyStorage?.ready === true && topologyStorage?.verified === true &&
        customers.length === providerRegistry.organizationIds.length &&
        customers.every((customer) => customer === true);
      return Object.freeze({
        ready,
        verified: ready,
        provider: PROVIDER,
        code: ready ? null : "TWILIO_RESPONDER_NOT_VERIFIED"
      });
    } catch {
      return Object.freeze({
        ready: false,
        verified: false,
        provider: PROVIDER,
        code: "TWILIO_RESPONDER_READINESS_UNAVAILABLE"
      });
    }
  }

  async function inspectSelectedReadiness(provider) {
    try {
      const [privateMaterial, registry, topologyStorage, customer] =
        await Promise.all([
          materialResolver.readiness(),
          providerRegistry.readiness(),
          providerTopologyRepository.readiness(),
          inspectCustomerReadiness(provider)
        ]);
      return privateMaterial?.ready === true &&
        privateMaterial?.verified === true &&
        registry?.ready === true && registry?.verified === true &&
        topologyStorage?.ready === true && topologyStorage?.verified === true &&
        customer === true;
    } catch {
      return false;
    }
  }

  async function readiness() {
    const now = Number(cacheClock());
    invariant(
      Number.isFinite(now),
      "TWILIO_RESPONDER_CONFIGURATION_REQUIRED",
      "Twilio readiness cache clock is invalid.",
      { status: 500 }
    );
    if (readyCache && now < readyCache.expiresAt) return readyCache.status;
    if (readinessInFlight) return readinessInFlight;
    readinessInFlight = inspectReadiness().then((status) => {
      if (status.ready && selectedReadinessCacheMs > 0) {
        readyCache = Object.freeze({
          status,
          expiresAt: now + selectedReadinessCacheMs
        });
      }
      return status;
    }).finally(() => {
      readinessInFlight = null;
    });
    return readinessInFlight;
  }

  async function sendMessage(input) {
    const selectedRequest = request(input);
    // Select customer authority before any provider read. A missing customer
    // must fail without touching Twilio, and drift in one customer's
    // subaccount must not hold delivery for a different customer.
    const provider = providerRegistry.resolveOrganization(
      selectedRequest.organizationId
    );
    const selectedReady = await inspectSelectedReadiness(provider);
    invariant(
      selectedReady,
      "TWILIO_RESPONDER_NOT_READY",
      "Twilio Responder delivery is not verified.",
      { status: 503 }
    );
    // Reassert the digest-only topology immediately before resolving private
    // material and creating the provider effect.
    await providerTopologyRepository.requireActiveTopology(provider.topology);
    const accountSid = provider.accountSid;
    const messagingServiceSid = provider.messagingServiceSid;
    const authorization = basicAuthorization(
      provider.messagingApiKeySid,
      provider.messagingApiKeySecret
    );
    const selectedMaterial = material(
      await materialResolver.resolveSmsMaterial({
        schema: "sitesourcery.responder-private-sms-resolution/v1",
        operationId: selectedRequest.operationId,
        organizationId: selectedRequest.organizationId,
        projectId: selectedRequest.projectId,
        interactionId: selectedRequest.interactionId,
        contactAuthorityId: selectedRequest.contactAuthorityId,
        messageKind: selectedRequest.messageKind,
        routeDigest: selectedRequest.routeDigest,
        contentDigest: selectedRequest.contentDigest,
        leaseOwner: selectedRequest.leaseOwner
      }),
      selectedRequest
    );
    const form = new URLSearchParams({
      To: selectedMaterial.to,
      MessagingServiceSid: messagingServiceSid,
      Body: selectedMaterial.body,
      StatusCallback: statusCallback,
      ValidityPeriod: "300"
    });
    const response = await apiRequest({
      fetchImpl,
      url: `${API_ORIGIN}/2010-04-01/Accounts/${accountSid}/Messages.json`,
      method: "POST",
      authorization,
      timeoutMs: selectedTimeout,
      body: form,
      signal: selectedRequest.signal,
      effectful: true
    });
    invariant(
      SID.message.test(response?.sid ?? "") &&
        response?.account_sid === accountSid &&
        response?.messaging_service_sid === messagingServiceSid &&
        response?.to === selectedMaterial.to &&
        response?.body === selectedMaterial.body &&
        response?.status === "accepted",
      "TWILIO_RESPONDER_RECEIPT_INVALID",
      "Twilio did not return an exact message acceptance.",
      { status: 502 }
    );
    return Object.freeze({
      status: "accepted",
      provider: PROVIDER,
      idempotencyKey: selectedRequest.idempotencyKey,
      providerMessageIdDigest: digest(response.sid),
      providerReceiptDigest: digest({
        provider: PROVIDER,
        accountSid,
        messagingServiceSid,
        messageSid: response.sid
      }),
      acceptedAt: currentTime(clock)
    });
  }

  return Object.freeze({
    kind: "responder-fulfillment-provider",
    providerEffects: true,
    idempotency: "provider-unsupported",
    effectCertainty: "receipt-or-manual-review",
    readiness,
    sendMessage
  });
}
