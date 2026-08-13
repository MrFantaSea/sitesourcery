import { invariant } from "./errors.mjs";

export const WORKER_CONFIG_ENVIRONMENT =
  "SITESOURCERY_WORKER_CONFIG";
export const WORKER_CONFIG_SCHEMA =
  "sitesourcery.worker-process-config/v1";
export const WORKER_READINESS_SCHEMA =
  "sitesourcery.worker-process-readiness/v1";
export const WORKER_PURPOSES = Object.freeze([
  "export",
  "cancellation",
  "notification-mail",
  "alakazam-fulfillment",
  "alakazam-retained-lifecycle",
  "responder-fulfillment",
  "provider-reconciliation"
]);

const MAXIMUM_CONFIG_BYTES = 2_048;
const PURPOSE_SET = new Set(WORKER_PURPOSES);
const ACTIVATIONS = new Set(["held", "owner-approved"]);

function fail(message) {
  invariant(
    false,
    "WORKER_CONFIGURATION_INVALID",
    message,
    { status: 500 }
  );
}

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  ) {
    fail(`${label} must contain only its exact fields.`);
  }
  return value;
}

function integer(value, label, minimum, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(`${label} is outside its bounded range.`);
  }
  return value;
}

function purposes(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > WORKER_PURPOSES.length ||
    value.some((purpose) => !PURPOSE_SET.has(purpose)) ||
    new Set(value).size !== value.length
  ) {
    fail("Worker purposes must be a nonempty unique exact allowlist.");
  }
  const selected = WORKER_PURPOSES.filter((purpose) =>
    value.includes(purpose)
  );
  if (JSON.stringify(selected) !== JSON.stringify(value)) {
    fail("Worker purposes must use canonical order.");
  }
  return Object.freeze(selected);
}

export function createWorkerConfiguration({ configurationJson } = {}) {
  if (
    typeof configurationJson !== "string" ||
    configurationJson.length === 0 ||
    Buffer.byteLength(configurationJson, "utf8") > MAXIMUM_CONFIG_BYTES
  ) {
    fail("Versioned worker configuration is required.");
  }
  let parsed;
  try {
    parsed = JSON.parse(configurationJson);
  } catch {
    fail("Versioned worker configuration is invalid JSON.");
  }
  exactObject(
    parsed,
    [
      "schema",
      "activation",
      "purposes",
      "approvalPath",
      "shutdownDeadlineMs",
      "loop"
    ],
    "Worker configuration"
  );
  if (
    parsed.schema !== WORKER_CONFIG_SCHEMA ||
    !ACTIVATIONS.has(parsed.activation)
  ) {
    fail("Worker configuration schema or activation is invalid.");
  }
  if (
    typeof parsed.approvalPath !== "string" ||
    !parsed.approvalPath.startsWith("/etc/sitesourcery/") ||
    !/^\/[A-Za-z0-9._/-]{8,200}$/u.test(parsed.approvalPath)
  ) {
    fail("Worker approval path must be an exact /etc/sitesourcery path.");
  }
  exactObject(
    parsed.loop,
    ["intervalMs", "errorBackoffMs", "maximumBackoffMs"],
    "Worker loop configuration"
  );
  const intervalMs = integer(
    parsed.loop.intervalMs,
    "Worker interval",
    100,
    300_000
  );
  const errorBackoffMs = integer(
    parsed.loop.errorBackoffMs,
    "Worker error backoff",
    100,
    300_000
  );
  const maximumBackoffMs = integer(
    parsed.loop.maximumBackoffMs,
    "Worker maximum backoff",
    errorBackoffMs,
    900_000
  );
  const selectedPurposes = purposes(parsed.purposes);
  const configuration = Object.freeze({
    schema: WORKER_CONFIG_SCHEMA,
    activation: parsed.activation,
    purposes: selectedPurposes,
    approvalPath: parsed.approvalPath,
    shutdownDeadlineMs: integer(
      parsed.shutdownDeadlineMs,
      "Worker shutdown deadline",
      1_000,
      120_000
    ),
    loop: Object.freeze({
      intervalMs,
      errorBackoffMs,
      maximumBackoffMs
    })
  });
  return Object.freeze({
    configuration,
    readiness: Object.freeze({
      schema: WORKER_READINESS_SCHEMA,
      ready: parsed.activation === "owner-approved",
      activation: parsed.activation,
      purposes: selectedPurposes,
      dependencyState:
        parsed.activation === "owner-approved"
          ? "requires-readback"
          : "held",
      credentials: "redacted"
    })
  });
}

export function workerConfigurationFromEnvironment(
  environment = process.env
) {
  return createWorkerConfiguration({
    configurationJson: environment?.[WORKER_CONFIG_ENVIRONMENT]
  });
}
