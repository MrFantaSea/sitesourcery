import {
  OPERATIONS_REPORT_SCHEMA,
  validateOperationsAlertTransition
} from "./alert-adapter.mjs";

const PROVIDER = "resend";
const API_ORIGIN = "https://api.resend.com";
const EXPECTED_DOMAIN = "sitesourcery.com";
const FROM =
  "Site Sourcery Alerts <alerts@sitesourcery.com>";
const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const ALERT_CODE = /^[A-Z][A-Z0-9_]{2,127}$/u;

function exactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((field) =>
      Object.hasOwn(value, field)
    )
  );
}

function exactInstant(value) {
  const selected = new Date(value);
  return (
    typeof value === "string" &&
    !Number.isNaN(selected.valueOf()) &&
    selected.toISOString() === value
  );
}

function configured(environment, field) {
  const value = environment?.[field];
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    throw new Error(
      "Operations alert transport configuration is incomplete."
    );
  }
  return value;
}

function apiKey(value) {
  if (
    value.length < 10 ||
    value.length > 512 ||
    !value.startsWith("re_") ||
    /\s/u.test(value)
  ) {
    throw new Error(
      "Operations alert transport API configuration is invalid."
    );
  }
  return value;
}

function email(value) {
  const selected = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    selected.length < 3 ||
    selected.length > 254 ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(
      selected
    ) ||
    /[\r\n]/u.test(selected)
  ) {
    throw new Error(
      "Operations alert recipient configuration is invalid."
    );
  }
  return selected;
}

function timeout(value) {
  const selected = Number(value);
  if (
    !Number.isSafeInteger(selected) ||
    selected < 100 ||
    selected > 30_000
  ) {
    throw new Error(
      "Operations alert provider timeout is invalid."
    );
  }
  return selected;
}

function safeIdentity(value, expected, label) {
  if (
    typeof value !== "string" ||
    value !== expected
  ) {
    throw new Error(
      `Operations alert ${label} is invalid.`
    );
  }
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function responseJson(response) {
  let raw;
  try {
    raw = await response.text();
  } catch {
    throw new Error(
      "Operations alert provider response was unreadable."
    );
  }
  if (
    raw.length < 1 ||
    raw.length > MAXIMUM_RESPONSE_BYTES
  ) {
    throw new Error(
      "Operations alert provider response was invalid."
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      "Operations alert provider response was invalid."
    );
  }
}

async function apiRequest({
  fetchImpl,
  selectedApiKey,
  selectedTimeout,
  path,
  method,
  idempotencyKey = null,
  body = null
}) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${selectedApiKey}`,
    "User-Agent": "sitesourcery-operations/1.0"
  };
  if (body) headers["Content-Type"] = "application/json";
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  let response;
  try {
    response = await fetchImpl(
      `${API_ORIGIN}${path}`,
      {
        method,
        headers,
        ...(body
          ? { body: JSON.stringify(body) }
          : {}),
        signal: AbortSignal.timeout(
          selectedTimeout
        )
      }
    );
  } catch {
    throw new Error(
      "Operations alert provider is unavailable."
    );
  }
  if (
    !response ||
    typeof response.ok !== "boolean" ||
    !response.ok
  ) {
    throw new Error(
      "Operations alert provider rejected the request."
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

function validateEnvelope(
  envelope,
  { adapterId, destinationRef }
) {
  if (
    !exactKeys(envelope, [
      "adapterId",
      "approvalDigest",
      "destinationRef",
      "report",
      "schema",
      "transition"
    ]) ||
    envelope.schema !==
      "sitesourcery.outbound-alert-envelope/v1" ||
    envelope.adapterId !== adapterId ||
    envelope.destinationRef !== destinationRef ||
    typeof envelope.approvalDigest !== "string" ||
    !SHA256.test(envelope.approvalDigest) ||
    !exactKeys(envelope.report, [
      "alerts",
      "checks",
      "observedAt",
      "ok",
      "providerEgress",
      "schema",
      "sourceOperations"
    ]) ||
    envelope.report.schema !==
      OPERATIONS_REPORT_SCHEMA ||
    !exactInstant(envelope.report.observedAt) ||
    envelope.report.providerEgress !== "held" ||
    typeof envelope.report.ok !== "boolean" ||
    !Array.isArray(envelope.report.alerts) ||
    envelope.report.alerts.length > 64 ||
    !Array.isArray(envelope.report.checks) ||
    envelope.report.checks.length > 64 ||
    !envelope.report.sourceOperations ||
    typeof envelope.report.sourceOperations !==
      "object"
  ) {
    throw new Error(
      "Operations alert envelope is invalid."
    );
  }
  const transition =
    validateOperationsAlertTransition(
      envelope.transition
    );
  const seen = new Set();
  for (const item of envelope.report.alerts) {
    if (
      !exactKeys(item, [
        "code",
        "severity",
        "summary"
      ]) ||
      typeof item.code !== "string" ||
      !ALERT_CODE.test(item.code) ||
      seen.has(item.code) ||
      !["critical", "warning"].includes(
        item.severity
      ) ||
      typeof item.summary !== "string" ||
      item.summary.length < 1 ||
      item.summary.length > 500
    ) {
      throw new Error(
        "Operations alert report content is invalid."
      );
    }
    seen.add(item.code);
  }
  const reportCodes = envelope.report.alerts.map(
    (item) => item?.code
  );
  if (
    reportCodes.length !==
      transition.alertCodes.length ||
    reportCodes.some(
      (code, index) =>
        code !== transition.alertCodes[index]
    ) ||
    envelope.report.ok !==
      (envelope.report.alerts.length === 0) ||
    (transition.kind === "recovery") !==
      (envelope.report.alerts.length === 0)
  ) {
    throw new Error(
      "Operations alert envelope drifted from its transition."
    );
  }
  return Object.freeze({
    report: envelope.report,
    transition
  });
}

function subjectFor(report, transition) {
  if (transition.kind === "recovery") {
    return "[RECOVERED] Site Sourcery operations";
  }
  const critical = report.alerts.some(
    ({ severity }) => severity === "critical"
  );
  const level = critical ? "CRITICAL" : "WARNING";
  const suffix =
    transition.kind === "reminder"
      ? "alert reminder"
      : transition.kind === "changed"
        ? "alert changed"
        : "operations alert";
  return `[${level}] Site Sourcery ${suffix}`;
}

function messageLines(report, transition) {
  const heading =
    transition.kind === "recovery"
      ? "Site Sourcery recovered"
      : "Site Sourcery needs attention";
  const status =
    transition.kind === "recovery"
      ? "The previously reported operational checks are healthy again."
      : transition.kind === "reminder"
        ? "This incident is still active."
        : transition.kind === "changed"
          ? "The active incident changed."
          : "A new operational incident was detected.";
  const alerts =
    transition.kind === "recovery"
      ? transition.previousAlertCodes.map(
          (code) => `- ${code}`
        )
      : report.alerts.map(
          ({ code, severity, summary }) =>
            `- ${code} (${severity}): ${summary}`
        );
  return {
    heading,
    lines: [
      status,
      `Observed: ${report.observedAt}`,
      `Transition: ${transition.kind}`,
      "",
      transition.kind === "recovery"
        ? "Recovered alert codes:"
        : "Current alerts:",
      ...alerts,
      "",
      "This is an internal Site Sourcery operations message."
    ]
  };
}

function messageBody(report, transition) {
  const { heading, lines } = messageLines(
    report,
    transition
  );
  const text = [
    "SITE SOURCERY OPERATIONS",
    "",
    heading,
    ...lines
  ].join("\n");
  const htmlLines = lines
    .map((line) =>
      line === ""
        ? "<br>"
        : `<div>${escapeHtml(line)}</div>`
    )
    .join("\n");
  return {
    text,
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#111827;color:#f8fafc;font-family:Arial,sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:40px 24px">
      <p style="color:#d6b86a;letter-spacing:.14em;text-transform:uppercase">Site Sourcery Operations</p>
      <h1 style="font-size:26px;line-height:1.2">${escapeHtml(heading)}</h1>
      <div style="font-size:15px;line-height:1.65">${htmlLines}</div>
    </div>
  </body>
</html>`
  };
}

function acceptedAt(clock) {
  const selected = clock();
  const date =
    selected instanceof Date
      ? selected
      : new Date(selected);
  if (Number.isNaN(date.valueOf())) {
    throw new Error(
      "Operations alert receipt clock is invalid."
    );
  }
  return date.toISOString();
}

export function createResendOperationsAlertTransport({
  environment = process.env,
  adapterId,
  destinationRef,
  fetchImpl = globalThis.fetch,
  clock = () => new Date(),
  timeoutMs = 5_000
} = {}) {
  const selectedApiKey = apiKey(
    configured(
      environment,
      "SITESOURCERY_RESEND_API_KEY"
    )
  );
  const domainId = configured(
    environment,
    "SITESOURCERY_RESEND_DOMAIN_ID"
  );
  if (!UUID.test(domainId)) {
    throw new Error(
      "Operations alert transport domain configuration is invalid."
    );
  }
  const recipient = email(
    configured(
      environment,
      "SITESOURCERY_ALERT_RECIPIENT"
    )
  );
  const selectedAdapterId = safeIdentity(
    configured(
      environment,
      "SITESOURCERY_ALERT_ADAPTER_ID"
    ),
    adapterId,
    "adapter identity"
  );
  const selectedDestinationRef = safeIdentity(
    configured(
      environment,
      "SITESOURCERY_ALERT_DESTINATION_REF"
    ),
    destinationRef,
    "destination identity"
  );
  const selectedTimeout = timeout(timeoutMs);
  if (
    typeof fetchImpl !== "function" ||
    typeof clock !== "function"
  ) {
    throw new Error(
      "Operations alert transport interface is invalid."
    );
  }

  async function readiness() {
    let domain;
    try {
      domain = await apiRequest({
        fetchImpl,
        selectedApiKey,
        selectedTimeout,
        path: `/domains/${domainId}`,
        method: "GET"
      });
    } catch {
      return Object.freeze({
        ready: false,
        verified: false,
        provider: PROVIDER,
        code: "RESEND_READINESS_UNAVAILABLE"
      });
    }
    if (
      domain?.object !== "domain" ||
      domain.id !== domainId ||
      String(domain.name ?? "").toLowerCase() !==
        EXPECTED_DOMAIN
    ) {
      return Object.freeze({
        ready: false,
        verified: false,
        provider: PROVIDER,
        code: "RESEND_DOMAIN_MISMATCH"
      });
    }
    if (
      domain.status !== "verified" ||
      domain.capabilities?.sending !== "enabled" ||
      !verifiedAuthenticationRecords(domain)
    ) {
      return Object.freeze({
        ready: false,
        verified: false,
        provider: PROVIDER,
        code: "RESEND_DOMAIN_UNVERIFIED"
      });
    }
    if (
      domain.open_tracking !== false ||
      domain.click_tracking !== false
    ) {
      return Object.freeze({
        ready: false,
        verified: false,
        provider: PROVIDER,
        code: "RESEND_TRACKING_MUST_BE_DISABLED"
      });
    }
    return Object.freeze({
      ready: true,
      verified: true,
      provider: PROVIDER
    });
  }

  async function deliver(envelope) {
    const { report, transition } =
      validateEnvelope(envelope, {
        adapterId: selectedAdapterId,
        destinationRef:
          selectedDestinationRef
      });
    const ready = await readiness();
    if (!ready.ready) {
      throw new Error(
        "Operations alert transport is not ready."
      );
    }
    const content = messageBody(
      report,
      transition
    );
    const providerKey =
      `sitesourcery-operations/${transition.transitionId}`;
    const result = await apiRequest({
      fetchImpl,
      selectedApiKey,
      selectedTimeout,
      path: "/emails",
      method: "POST",
      idempotencyKey: providerKey,
      body: {
        from: FROM,
        to: [recipient],
        subject: subjectFor(report, transition),
        html: content.html,
        text: content.text,
        tags: [
          {
            name: "message_type",
            value: "operations_alert"
          },
          {
            name: "transition",
            value: transition.kind
          }
        ]
      }
    });
    if (!UUID.test(String(result?.id ?? ""))) {
      throw new Error(
        "Operations alert provider receipt is invalid."
      );
    }
    return Object.freeze({
      accepted: true,
      provider: PROVIDER,
      providerMessageId: result.id,
      transitionId: transition.transitionId,
      acceptedAt: acceptedAt(clock)
    });
  }

  return Object.freeze({
    provider: PROVIDER,
    from: FROM,
    readiness,
    deliver
  });
}
