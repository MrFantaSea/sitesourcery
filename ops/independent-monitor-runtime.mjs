import {
  canonicalJson,
  sha256Bytes
} from "./immutable-evidence.mjs";
import { validateReleaseEpoch } from "./release-epoch.mjs";

export const INDEPENDENT_RELEASE_IDENTITY_SCHEMA =
  "sitesourcery.independent-release-identity/v1";
export const INDEPENDENT_PROBE_RESULT_SCHEMA =
  "sitesourcery.independent-probe-result/v1";
export const INDEPENDENT_MONITOR_REPORT_SCHEMA =
  "sitesourcery.independent-monitor-report/v1";
export const INDEPENDENT_MONITOR_HEARTBEAT_SCHEMA =
  "sitesourcery.independent-monitor-heartbeat/v1";
export const INDEPENDENT_DEAD_MAN_REPORT_SCHEMA =
  "sitesourcery.independent-dead-man-report/v1";

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const PROBE_NAMES = Object.freeze([
  "apex",
  "content",
  "tls",
  "tunnel"
]);
const PROBE_CODES = Object.freeze({
  apex: new Set([
    "APEX_CANONICAL_RESPONSE_INVALID",
    "APEX_PROBE_UNAVAILABLE"
  ]),
  content: new Set([
    "CONTENT_ARTIFACT_MISMATCH",
    "CONTENT_PROBE_UNAVAILABLE"
  ]),
  tls: new Set([
    "TLS_AUTHORITY_INVALID",
    "TLS_PROBE_UNAVAILABLE"
  ]),
  tunnel: new Set([
    "TUNNEL_READINESS_INVALID",
    "TUNNEL_PROBE_UNAVAILABLE"
  ])
});

function fail(message) {
  throw new Error(message);
}

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...keys].sort())
  ) {
    fail(`${label} must contain only its exact fields.`);
  }
  return value;
}

function exactInstant(value, label) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    fail(`${label} is invalid.`);
  }
  return selected;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(`${label} is invalid.`);
  }
  return value;
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

export function releaseIdentityFromEpoch(value) {
  const epoch = validateReleaseEpoch(value);
  return freeze({
    schema: INDEPENDENT_RELEASE_IDENTITY_SCHEMA,
    epochId: epoch.epochId,
    bindingSha256: epoch.binding.sha256,
    publicArtifactCommitSha:
      epoch.binding.artifact.publicArtifactCommitSha
  });
}

export function validateIndependentReleaseIdentity(value) {
  exactObject(
    value,
    [
      "schema",
      "epochId",
      "bindingSha256",
      "publicArtifactCommitSha"
    ],
    "Independent release identity"
  );
  if (
    value.schema !== INDEPENDENT_RELEASE_IDENTITY_SCHEMA ||
    typeof value.epochId !== "string" ||
    !/^[a-z0-9][a-z0-9-]{2,79}$/u.test(value.epochId) ||
    !COMMIT_SHA.test(value.publicArtifactCommitSha)
  ) {
    fail("Independent release identity is invalid.");
  }
  digest(value.bindingSha256, "Independent release binding");
  return freeze({ ...value });
}

export function createIndependentProbeResult(
  name,
  { ok, code = null, evidence }
) {
  if (!PROBE_NAMES.includes(name) || typeof ok !== "boolean") {
    fail("Independent probe result identity is invalid.");
  }
  if (
    (ok && code !== null) ||
    (!ok && !PROBE_CODES[name].has(code))
  ) {
    fail("Independent probe result code is invalid.");
  }
  const evidenceSha256 = evidence === null || evidence === undefined
    ? null
    : sha256Bytes(
        Buffer.from(`${canonicalJson(evidence)}\n`, "utf8")
      );
  if (ok !== (evidenceSha256 !== null)) {
    fail("Independent probe evidence is invalid.");
  }
  return freeze({
    schema: INDEPENDENT_PROBE_RESULT_SCHEMA,
    name,
    ok,
    code,
    evidenceSha256
  });
}

export function validateIndependentProbeResult(value, expectedName) {
  exactObject(
    value,
    ["schema", "name", "ok", "code", "evidenceSha256"],
    "Independent probe result"
  );
  if (
    value.schema !== INDEPENDENT_PROBE_RESULT_SCHEMA ||
    value.name !== expectedName ||
    typeof value.ok !== "boolean" ||
    (value.ok && value.code !== null) ||
    (!value.ok && !PROBE_CODES[expectedName].has(value.code)) ||
    (value.ok && !SHA256.test(value.evidenceSha256)) ||
    (!value.ok && value.evidenceSha256 !== null)
  ) {
    fail("Independent probe result is invalid.");
  }
  return freeze({ ...value });
}

function reportPayload(value) {
  return {
    schema: value.schema,
    release: value.release,
    observedAt: value.observedAt,
    ok: value.ok,
    checks: value.checks,
    alerts: value.alerts
  };
}

export function validateIndependentMonitorReport(value) {
  exactObject(
    value,
    [
      "schema",
      "release",
      "observedAt",
      "ok",
      "checks",
      "alerts",
      "telemetrySha256"
    ],
    "Independent monitor report"
  );
  if (
    value.schema !== INDEPENDENT_MONITOR_REPORT_SCHEMA ||
    typeof value.ok !== "boolean" ||
    !Array.isArray(value.checks) ||
    value.checks.length !== PROBE_NAMES.length ||
    !Array.isArray(value.alerts) ||
    value.alerts.length > PROBE_NAMES.length
  ) {
    fail("Independent monitor report is invalid.");
  }
  const release = validateIndependentReleaseIdentity(value.release);
  exactInstant(value.observedAt, "Independent monitor observation");
  const checks = value.checks.map((item, index) =>
    validateIndependentProbeResult(item, PROBE_NAMES[index])
  );
  const expectedAlerts = checks
    .filter((item) => !item.ok)
    .map((item) => ({ code: item.code, severity: "critical" }))
    .sort((left, right) => left.code.localeCompare(right.code));
  if (
    canonicalJson(value.alerts) !== canonicalJson(expectedAlerts) ||
    value.ok !== (expectedAlerts.length === 0) ||
    digest(value.telemetrySha256, "Independent monitor telemetry") !==
      sha256Bytes(
        Buffer.from(`${canonicalJson(reportPayload(value))}\n`, "utf8")
      )
  ) {
    fail("Independent monitor report evidence is invalid.");
  }
  return freeze({
    ...value,
    release,
    checks,
    alerts: expectedAlerts
  });
}

function unavailableResult(name) {
  return createIndependentProbeResult(name, {
    ok: false,
    code: `${name.toUpperCase()}_PROBE_UNAVAILABLE`,
    evidence: null
  });
}

export async function runIndependentMonitor({
  probes,
  releaseIdentity,
  now = () => new Date()
}) {
  const release = validateIndependentReleaseIdentity(releaseIdentity);
  const observed = now();
  if (!(observed instanceof Date) || Number.isNaN(observed.valueOf())) {
    fail("Independent monitor clock is invalid.");
  }
  for (const name of PROBE_NAMES) {
    if (typeof probes?.[name] !== "function") {
      fail(`Independent ${name} probe is required.`);
    }
  }
  const checks = await Promise.all(
    PROBE_NAMES.map(async (name) => {
      try {
        return validateIndependentProbeResult(
          await probes[name](),
          name
        );
      } catch {
        return unavailableResult(name);
      }
    })
  );
  const alerts = checks
    .filter((item) => !item.ok)
    .map((item) => ({ code: item.code, severity: "critical" }))
    .sort((left, right) => left.code.localeCompare(right.code));
  const payload = {
    schema: INDEPENDENT_MONITOR_REPORT_SCHEMA,
    release,
    observedAt: observed.toISOString(),
    ok: alerts.length === 0,
    checks,
    alerts
  };
  return validateIndependentMonitorReport({
    ...payload,
    telemetrySha256: sha256Bytes(
      Buffer.from(`${canonicalJson(payload)}\n`, "utf8")
    )
  });
}

export function createIndependentMonitorHeartbeat(report, sequence) {
  const selected = validateIndependentMonitorReport(report);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    fail("Independent monitor heartbeat sequence is invalid.");
  }
  return freeze({
    schema: INDEPENDENT_MONITOR_HEARTBEAT_SCHEMA,
    release: selected.release,
    observedAt: selected.observedAt,
    sequence,
    monitorTelemetrySha256: selected.telemetrySha256,
    monitorOk: selected.ok
  });
}

export function validateIndependentMonitorHeartbeat(value) {
  exactObject(
    value,
    [
      "schema",
      "release",
      "observedAt",
      "sequence",
      "monitorTelemetrySha256",
      "monitorOk"
    ],
    "Independent monitor heartbeat"
  );
  if (
    value.schema !== INDEPENDENT_MONITOR_HEARTBEAT_SCHEMA ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    typeof value.monitorOk !== "boolean"
  ) {
    fail("Independent monitor heartbeat is invalid.");
  }
  const release = validateIndependentReleaseIdentity(value.release);
  exactInstant(value.observedAt, "Independent monitor heartbeat time");
  digest(
    value.monitorTelemetrySha256,
    "Independent monitor heartbeat telemetry"
  );
  return freeze({ ...value, release });
}

function deadManPayload(value) {
  return {
    schema: value.schema,
    release: value.release,
    observedAt: value.observedAt,
    ok: value.ok,
    code: value.code,
    heartbeatObservedAt: value.heartbeatObservedAt,
    heartbeatSequence: value.heartbeatSequence,
    monitorTelemetrySha256: value.monitorTelemetrySha256
  };
}

export function validateIndependentDeadManReport(value) {
  exactObject(
    value,
    [
      "schema",
      "release",
      "observedAt",
      "ok",
      "code",
      "heartbeatObservedAt",
      "heartbeatSequence",
      "monitorTelemetrySha256",
      "telemetrySha256"
    ],
    "Independent dead-man report"
  );
  const codes = new Set([
    null,
    "DEAD_MAN_HEARTBEAT_INVALID",
    "DEAD_MAN_HEARTBEAT_STALE",
    "DEAD_MAN_RELEASE_IDENTITY_DRIFT"
  ]);
  if (
    value.schema !== INDEPENDENT_DEAD_MAN_REPORT_SCHEMA ||
    typeof value.ok !== "boolean" ||
    !codes.has(value.code) ||
    value.ok !== (value.code === null)
  ) {
    fail("Independent dead-man report is invalid.");
  }
  const release = validateIndependentReleaseIdentity(value.release);
  exactInstant(value.observedAt, "Independent dead-man observation");
  if (value.code === "DEAD_MAN_HEARTBEAT_INVALID") {
    if (
      value.heartbeatObservedAt !== null ||
      value.heartbeatSequence !== null ||
      value.monitorTelemetrySha256 !== null
    ) {
      fail("Invalid dead-man heartbeat must expose no evidence fields.");
    }
  } else {
    exactInstant(
      value.heartbeatObservedAt,
      "Independent dead-man heartbeat observation"
    );
    if (
      !Number.isSafeInteger(value.heartbeatSequence) ||
      value.heartbeatSequence < 1
    ) {
      fail("Independent dead-man heartbeat sequence is invalid.");
    }
    digest(
      value.monitorTelemetrySha256,
      "Independent dead-man monitor telemetry"
    );
  }
  if (
    digest(value.telemetrySha256, "Independent dead-man telemetry") !==
      sha256Bytes(
        Buffer.from(`${canonicalJson(deadManPayload(value))}\n`, "utf8")
      )
  ) {
    fail("Independent dead-man telemetry digest is invalid.");
  }
  return freeze({ ...value, release });
}

export function evaluateIndependentDeadMan({
  heartbeat,
  releaseIdentity,
  maximumAgeMs,
  now = () => new Date()
}) {
  const release = validateIndependentReleaseIdentity(releaseIdentity);
  const observed = now();
  if (
    !(observed instanceof Date) ||
    Number.isNaN(observed.valueOf()) ||
    !Number.isSafeInteger(maximumAgeMs) ||
    maximumAgeMs < 60_000 ||
    maximumAgeMs > 24 * 60 * 60 * 1000
  ) {
    fail("Independent dead-man configuration is invalid.");
  }
  let selected = null;
  let code = null;
  try {
    selected = validateIndependentMonitorHeartbeat(heartbeat);
    if (canonicalJson(selected.release) !== canonicalJson(release)) {
      code = "DEAD_MAN_RELEASE_IDENTITY_DRIFT";
    } else {
      const heartbeatAt = new Date(selected.observedAt);
      if (
        heartbeatAt > observed ||
        observed - heartbeatAt > maximumAgeMs
      ) {
        code = "DEAD_MAN_HEARTBEAT_STALE";
      }
    }
  } catch {
    code = "DEAD_MAN_HEARTBEAT_INVALID";
  }
  const payload = {
    schema: INDEPENDENT_DEAD_MAN_REPORT_SCHEMA,
    release,
    observedAt: observed.toISOString(),
    ok: code === null,
    code,
    heartbeatObservedAt: selected?.observedAt ?? null,
    heartbeatSequence: selected?.sequence ?? null,
    monitorTelemetrySha256:
      selected?.monitorTelemetrySha256 ?? null
  };
  return validateIndependentDeadManReport({
    ...payload,
    telemetrySha256: sha256Bytes(
      Buffer.from(`${canonicalJson(deadManPayload(payload))}\n`, "utf8")
    )
  });
}

export { PROBE_NAMES as INDEPENDENT_PROBE_NAMES };
