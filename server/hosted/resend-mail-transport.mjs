import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const PROVIDER = "resend";
const API_ORIGIN = "https://api.resend.com";
const EXPECTED_DOMAIN = "sitesourcery.com";
const DEFAULT_APPLICATION_URL =
  "https://sitesourcery.com/abracadabra/app/";
const FROM =
  "Site Sourcery <accounts@sitesourcery.com>";
const REPLY_TO = "sitesourcery@proton.me";
const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NOTIFICATION_TYPES = new Set([
  "support_notification",
  "commerce_customer_notification",
  "commerce_operator_notification",
  "purpose_customer_notification"
]);

function configurationError(message) {
  return new HostedError(
    "RESEND_CONFIGURATION_REQUIRED",
    message,
    { status: 500 }
  );
}

function environmentValue(environment, name) {
  const value = environment?.[name];
  return typeof value === "string" && value.length > 0
    ? value
    : null;
}

function apiKey(value) {
  const selected = String(value ?? "");
  if (
    selected.length < 10 ||
    selected.length > 512 ||
    !selected.startsWith("re_") ||
    /\s/u.test(selected)
  ) {
    throw configurationError(
      "SITESOURCERY_RESEND_API_KEY is required."
    );
  }
  return selected;
}

function uuid(value, message) {
  const selected = String(value ?? "");
  invariant(
    UUID.test(selected),
    "RESEND_CONFIGURATION_REQUIRED",
    message,
    { status: 500 }
  );
  return selected;
}

function timeout(value) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) &&
      selected >= 100 &&
      selected <= 30_000,
    "RESEND_CONFIGURATION_REQUIRED",
    "Resend timeout must be between 100 and 30000 milliseconds.",
    { status: 500 }
  );
  return selected;
}

function text(value, field, maximum, minimum = 1) {
  const selected = String(value ?? "").trim();
  invariant(
    selected.length >= minimum &&
      selected.length <= maximum &&
      !/[\r\n]/u.test(selected),
    "RESEND_DELIVERY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function email(value) {
  const selected = text(value, "Recipient", 254).toLowerCase();
  invariant(
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(selected),
    "RESEND_DELIVERY_INVALID",
    "Recipient is invalid.",
    { status: 500 }
  );
  return selected;
}

function instant(value, field) {
  const selected = String(value ?? "");
  invariant(
    Number.isFinite(Date.parse(selected)),
    "RESEND_DELIVERY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return new Date(selected).toISOString();
}

function currentTime(clock) {
  const value =
    typeof clock === "function" ? clock() : clock?.now?.();
  return instant(value, "Provider acceptance time");
}

function payloadDigest(value) {
  const selected = String(value ?? "");
  invariant(
    /^[a-f0-9]{64}$/u.test(selected),
    "RESEND_DELIVERY_INVALID",
    "Payload digest is invalid.",
    { status: 500 }
  );
  return selected;
}

function actionBase(value) {
  let selected;
  try {
    selected = new URL(
      String(value ?? DEFAULT_APPLICATION_URL)
    );
  } catch {
    selected = null;
  }
  if (
    !selected ||
    selected.protocol !== "https:" ||
    selected.pathname !== "/abracadabra/app/" ||
    selected.username ||
    selected.password ||
    selected.search ||
    selected.hash
  ) {
    throw configurationError(
      "Account action base URLs must name the HTTPS Abracadabra application."
    );
  }
  return selected;
}

function actionUrl(value, expectedHashPrefix, expectedBase) {
  let selected;
  try {
    selected = new URL(String(value ?? ""));
  } catch {
    selected = null;
  }
  invariant(
    selected &&
      selected.origin === expectedBase.origin &&
      selected.pathname === expectedBase.pathname &&
      !selected.username &&
      !selected.password &&
      !selected.search &&
      selected.hash.startsWith(expectedHashPrefix) &&
      selected.hash.length > expectedHashPrefix.length,
    "RESEND_DELIVERY_INVALID",
    "Account action URL is invalid.",
    { status: 500 }
  );
  return selected.href;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function messageHtml({ heading, introduction, action, url, expiresAt }) {
  const safeUrl = escapeHtml(url);
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#111827;color:#f8fafc;font-family:Arial,sans-serif">
    <div style="max-width:600px;margin:0 auto;padding:40px 24px">
      <p style="color:#d6b86a;letter-spacing:.14em;text-transform:uppercase">Site Sourcery</p>
      <h1 style="font-size:28px;line-height:1.2">${escapeHtml(heading)}</h1>
      <p style="font-size:16px;line-height:1.6">${escapeHtml(introduction)}</p>
      <p style="margin:30px 0">
        <a href="${safeUrl}" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#d6b86a;color:#111827;font-weight:700;text-decoration:none">${escapeHtml(action)}</a>
      </p>
      <p style="font-size:13px;line-height:1.5;color:#cbd5e1">This private link expires at ${escapeHtml(expiresAt)}. If the button does not open, copy this address into your browser:</p>
      <p style="overflow-wrap:anywhere;font-size:13px;line-height:1.5"><a href="${safeUrl}" style="color:#f8d57e">${safeUrl}</a></p>
      <p style="font-size:13px;line-height:1.5;color:#cbd5e1">If you did not request this, you can safely ignore this message.</p>
    </div>
  </body>
</html>`;
}

function messageText({ heading, introduction, action, url, expiresAt }) {
  return [
    "SITE SOURCERY",
    "",
    heading,
    introduction,
    "",
    `${action}:`,
    url,
    "",
    `This private link expires at ${expiresAt}.`,
    "If you did not request this, you can safely ignore this message."
  ].join("\n");
}

function normalizeDelivery(input, kind, actionBases) {
  const registration = kind === "registration";
  const schema = registration
    ? "sitesourcery.registration-verification-email/v1"
    : "sitesourcery.recovery-email/v1";
  const template = registration
    ? "registration_verification"
    : "password_recovery";
  invariant(
    input?.schema === schema && input?.template === template,
    "RESEND_DELIVERY_INVALID",
    "Account email schema is invalid.",
    { status: 500 }
  );
  const requestedAt = instant(
    input.requestedAt,
    "Request time"
  );
  const expiresAt = instant(input.expiresAt, "Expiry");
  invariant(
    Date.parse(expiresAt) > Date.parse(requestedAt),
    "RESEND_DELIVERY_INVALID",
    "Account email lifetime is invalid.",
    { status: 500 }
  );
  const url = actionUrl(
    registration
      ? input.verificationUrl
      : input.recoveryUrl,
    registration
      ? "#verify-registration="
      : "#recovery=",
    registration
      ? actionBases.registration
      : actionBases.recovery
  );
  const content = registration
    ? {
        heading: "Verify your account",
        introduction:
          "Use this private link to finish creating your Site Sourcery account.",
        action: "Verify my account",
        subject: "Verify your Site Sourcery account"
      }
    : {
        heading: "Reset your password",
        introduction:
          "Use this private link to choose a new password for your Site Sourcery account.",
        action: "Reset my password",
        subject: "Reset your Site Sourcery password"
      };
  const message = {
    ...content,
    url,
    expiresAt
  };
  return {
    idempotencyKey: text(
      input.idempotencyKey,
      "Idempotency key",
      200,
      8
    ),
    payloadDigest: payloadDigest(input.payloadDigest),
    recipient: email(input.recipient),
    requestedAt,
    expiresAt,
    body: {
      from: FROM,
      to: [email(input.recipient)],
      reply_to: REPLY_TO,
      subject: content.subject,
      html: messageHtml(message),
      text: messageText(message),
      tags: [
        {
          name: "message_type",
          value: registration
            ? "account_verification"
            : "password_recovery"
        }
      ]
    }
  };
}

function normalizeNotification(input) {
  invariant(
    input !== null &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      Object.getPrototypeOf(input) === Object.prototype &&
      JSON.stringify(Object.keys(input).sort()) === JSON.stringify([
        "html",
        "idempotencyKey",
        "messageType",
        "subject",
        "templateVersion",
        "text",
        "to"
      ]),
    "RESEND_DELIVERY_INVALID",
    "Notification mail input is invalid.",
    { status: 500 }
  );
  const idempotencyKey = text(
    input.idempotencyKey,
    "Notification idempotency key",
    256,
    8
  );
  invariant(
    idempotencyKey.startsWith("sitesourcery-notification/") &&
      UUID.test(idempotencyKey.slice("sitesourcery-notification/".length)) &&
      NOTIFICATION_TYPES.has(input.messageType) &&
      /^[a-z0-9][a-z0-9._:-]{1,79}$/u.test(input.templateVersion),
    "RESEND_DELIVERY_INVALID",
    "Notification mail identity is invalid.",
    { status: 500 }
  );
  const recipient = email(input.to);
  const subject = text(input.subject, "Notification subject", 300);
  const bodyText = String(input.text ?? "");
  const html = input.html === null ? null : String(input.html ?? "");
  invariant(
    bodyText.length >= 1 && bodyText.length <= 100_000 &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(bodyText) &&
      (html === null || (
        html.length >= 1 && html.length <= 200_000 &&
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(html)
      )),
    "RESEND_DELIVERY_INVALID",
    "Notification mail content is invalid.",
    { status: 500 }
  );
  return {
    idempotencyKey,
    payloadDigest: digest(input),
    body: {
      from: FROM,
      to: [recipient],
      reply_to: REPLY_TO,
      subject,
      text: bodyText,
      ...(html === null ? {} : { html }),
      tags: [{
        name: "message_type",
        value: input.messageType
      }]
    }
  };
}

async function responseJson(response) {
  let raw;
  try {
    raw = await response.text();
  } catch {
    throw new HostedError(
      "RESEND_RESPONSE_INVALID",
      "Resend returned an unreadable response.",
      { status: 502 }
    );
  }
  invariant(
    raw.length > 0 && raw.length <= MAXIMUM_RESPONSE_BYTES,
    "RESEND_RESPONSE_INVALID",
    "Resend returned an invalid response.",
    { status: 502 }
  );
  try {
    return JSON.parse(raw);
  } catch {
    throw new HostedError(
      "RESEND_RESPONSE_INVALID",
      "Resend returned an invalid response.",
      { status: 502 }
    );
  }
}

async function apiRequest({
  fetchImpl,
  apiKey: selectedApiKey,
  timeoutMs,
  path,
  method,
  idempotencyKey = null,
  body = null
}) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${selectedApiKey}`,
    "User-Agent": "sitesourcery-hosted/1.0"
  };
  if (body) headers["Content-Type"] = "application/json";
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  let response;
  try {
    response = await fetchImpl(`${API_ORIGIN}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new HostedError(
      "RESEND_API_UNAVAILABLE",
      "Resend could not be reached.",
      { status: 502 }
    );
  }
  invariant(
    response && typeof response.ok === "boolean",
    "RESEND_RESPONSE_INVALID",
    "Resend returned an invalid response.",
    { status: 502 }
  );
  if (!response.ok) {
    throw new HostedError(
      "RESEND_API_REJECTED",
      "Resend rejected the account email request.",
      { status: 502 }
    );
  }
  return responseJson(response);
}

function verifiedAuthenticationRecords(domain) {
  if (!Array.isArray(domain?.records)) return false;
  const spf = domain.records.filter(
    (record) => record?.record === "SPF"
  );
  const dkim = domain.records.filter(
    (record) => record?.record === "DKIM"
  );
  return (
    spf.length > 0 &&
    dkim.length > 0 &&
    [...spf, ...dkim].every(
      (record) => record.status === "verified"
    )
  );
}

export function createResendMailTransport({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  clock = { now: () => new Date().toISOString() },
  timeoutMs = 5_000,
  readinessCacheMs = 5_000,
  cacheClock = () => Date.now()
} = {}) {
  const selectedApiKey = apiKey(
    environmentValue(
      environment,
      "SITESOURCERY_RESEND_API_KEY"
    )
  );
  const domainId = uuid(
    environmentValue(
      environment,
      "SITESOURCERY_RESEND_DOMAIN_ID"
    ),
    "SITESOURCERY_RESEND_DOMAIN_ID must be a Resend domain UUID."
  );
  const selectedTimeout = timeout(timeoutMs);
  const actionBases = Object.freeze({
    registration: actionBase(
      environmentValue(
        environment,
        "SITESOURCERY_REGISTRATION_BASE_URL"
      ) ?? DEFAULT_APPLICATION_URL
    ),
    recovery: actionBase(
      environmentValue(
        environment,
        "SITESOURCERY_RECOVERY_BASE_URL"
      ) ?? DEFAULT_APPLICATION_URL
    )
  });
  const selectedReadinessCacheMs = Number(
    readinessCacheMs
  );
  invariant(
    typeof fetchImpl === "function" &&
      typeof cacheClock === "function" &&
      Number.isSafeInteger(selectedReadinessCacheMs) &&
      selectedReadinessCacheMs >= 0 &&
      selectedReadinessCacheMs <= 60_000,
    "RESEND_CONFIGURATION_REQUIRED",
    "Resend fetch and readiness cache configuration is invalid.",
    { status: 500 }
  );

  let readyCache = null;
  let readinessInFlight = null;

  async function inspectReadiness() {
    let domain;
    try {
      domain = await apiRequest({
        fetchImpl,
        apiKey: selectedApiKey,
        timeoutMs: selectedTimeout,
        path: `/domains/${domainId}`,
        method: "GET"
      });
    } catch {
      return {
        ready: false,
        verified: false,
        provider: PROVIDER,
        code: "RESEND_READINESS_UNAVAILABLE"
      };
    }
    if (
      domain?.object !== "domain" ||
      domain.id !== domainId ||
      String(domain.name ?? "").toLowerCase() !==
        EXPECTED_DOMAIN
    ) {
      return {
        ready: false,
        verified: false,
        provider: PROVIDER,
        code: "RESEND_DOMAIN_MISMATCH"
      };
    }
    if (
      domain.status !== "verified" ||
      domain.capabilities?.sending !== "enabled" ||
      !verifiedAuthenticationRecords(domain)
    ) {
      return {
        ready: false,
        verified: false,
        provider: PROVIDER,
        code: "RESEND_DOMAIN_UNVERIFIED"
      };
    }
    if (
      domain.open_tracking !== false ||
      domain.click_tracking !== false
    ) {
      return {
        ready: false,
        verified: false,
        provider: PROVIDER,
        code: "RESEND_TRACKING_MUST_BE_DISABLED"
      };
    }
    return {
      ready: true,
      verified: true,
      provider: PROVIDER
    };
  }

  async function readiness() {
    const now = Number(cacheClock());
    invariant(
      Number.isFinite(now),
      "RESEND_CONFIGURATION_REQUIRED",
      "Resend readiness cache clock is invalid.",
      { status: 500 }
    );
    if (readyCache && now < readyCache.expiresAt) {
      return readyCache.status;
    }
    if (readinessInFlight) return readinessInFlight;
    readinessInFlight = inspectReadiness()
      .then((status) => {
        if (status.ready && selectedReadinessCacheMs > 0) {
          readyCache = {
            status: Object.freeze({ ...status }),
            expiresAt: now + selectedReadinessCacheMs
          };
          return readyCache.status;
        }
        return status;
      })
      .finally(() => {
        readinessInFlight = null;
      });
    return readinessInFlight;
  }

  async function send(input, kind) {
    const delivery = normalizeDelivery(
      input,
      kind,
      actionBases
    );
    const providerKey =
      `sitesourcery-${kind}/${delivery.idempotencyKey}`;
    invariant(
      providerKey.length <= 256,
      "RESEND_DELIVERY_INVALID",
      "Provider idempotency key is invalid.",
      { status: 500 }
    );
    const result = await apiRequest({
      fetchImpl,
      apiKey: selectedApiKey,
      timeoutMs: selectedTimeout,
      path: "/emails",
      method: "POST",
      idempotencyKey: providerKey,
      body: delivery.body
    });
    invariant(
      UUID.test(String(result?.id ?? "")),
      "RESEND_RESPONSE_INVALID",
      "Resend returned an invalid message receipt.",
      { status: 502 }
    );
    return Object.freeze({
      accepted: true,
      provider: PROVIDER,
      providerMessageId: result.id,
      idempotencyKey: delivery.idempotencyKey,
      payloadDigest: delivery.payloadDigest,
      acceptedAt: currentTime(clock)
    });
  }

  async function sendNotification(input) {
    const delivery = normalizeNotification(input);
    const result = await apiRequest({
      fetchImpl,
      apiKey: selectedApiKey,
      timeoutMs: selectedTimeout,
      path: "/emails",
      method: "POST",
      idempotencyKey: delivery.idempotencyKey,
      body: delivery.body
    });
    invariant(
      UUID.test(String(result?.id ?? "")),
      "RESEND_RESPONSE_INVALID",
      "Resend returned an invalid message receipt.",
      { status: 502 }
    );
    return Object.freeze({
      state: "provider_accepted",
      provider: PROVIDER,
      providerMessageId: result.id,
      idempotencyKey: delivery.idempotencyKey,
      payloadDigest: delivery.payloadDigest,
      acceptedAt: currentTime(clock)
    });
  }

  return Object.freeze({
    kind: "notification-mail-provider",
    mode: "production",
    provider: PROVIDER,
    providerEffects: true,
    readiness,
    sendRegistration(input) {
      return send(input, "registration");
    },
    sendRecovery(input) {
      return send(input, "recovery");
    },
    sendNotification
  });
}

export function createRegistrationTransport(options) {
  return createResendMailTransport(options);
}

export function createRecoveryTransport(options) {
  return createResendMailTransport(options);
}
