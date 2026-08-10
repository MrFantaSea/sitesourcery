import { MAX_BODY_BYTES } from "./constants.mjs";
import { invariant } from "./errors.mjs";

function rateLimit(attempts, windowMs, blockMs) {
  return Object.freeze({ attempts, windowMs, blockMs });
}

export const DEFAULT_INGRESS_POLICY = Object.freeze({
  body: Object.freeze({
    jsonBytes: MAX_BODY_BYTES,
    webhookBytes: 256 * 1024
  }),
  node: Object.freeze({
    maxConcurrentRequests: 64,
    requestDeadlineMs: 15_000
  }),
  identity: Object.freeze({
    subject: rateLimit(6, 15 * 60 * 1000, 15 * 60 * 1000),
    perIp: rateLimit(12, 15 * 60 * 1000, 15 * 60 * 1000),
    global: rateLimit(120, 15 * 60 * 1000, 15 * 60 * 1000)
  }),
  writes: Object.freeze({
    perPrincipal: Object.freeze({
      attempts: 120,
      windowMs: 15 * 60 * 1000
    }),
    compile: Object.freeze({
      attempts: 20,
      windowMs: 15 * 60 * 1000
    })
  })
});

function integer(value, label, minimum, maximum) {
  invariant(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    "INGRESS_POLICY_INVALID",
    `${label} must be an integer from ${minimum} through ${maximum}.`,
    { status: 500 }
  );
  return value;
}

function validateRateLimit(value, label) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "INGRESS_POLICY_INVALID",
    `${label} is required.`,
    { status: 500 }
  );
  return rateLimit(
    integer(value.attempts, `${label} attempts`, 1, 10_000),
    integer(value.windowMs, `${label} window`, 1_000, 24 * 60 * 60 * 1000),
    integer(value.blockMs, `${label} block`, 1_000, 24 * 60 * 60 * 1000)
  );
}

function validateQuota(value, label) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "INGRESS_POLICY_INVALID",
    `${label} is required.`,
    { status: 500 }
  );
  return Object.freeze({
    attempts: integer(value.attempts, `${label} attempts`, 1, 10_000),
    windowMs: integer(value.windowMs, `${label} window`, 1_000, 24 * 60 * 60 * 1000)
  });
}

export function validateIngressPolicy(value = DEFAULT_INGRESS_POLICY) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "INGRESS_POLICY_INVALID",
    "Ingress policy is required.",
    { status: 500 }
  );
  return Object.freeze({
    body: Object.freeze({
      jsonBytes: integer(
        value.body?.jsonBytes,
        "JSON body bytes",
        1024,
        MAX_BODY_BYTES
      ),
      webhookBytes: integer(
        value.body?.webhookBytes,
        "Webhook body bytes",
        1024,
        MAX_BODY_BYTES
      )
    }),
    node: Object.freeze({
      maxConcurrentRequests: integer(
        value.node?.maxConcurrentRequests,
        "Maximum concurrent requests",
        1,
        1024
      ),
      requestDeadlineMs: integer(
        value.node?.requestDeadlineMs,
        "Request deadline",
        1_000,
        120_000
      )
    }),
    identity: Object.freeze({
      subject: validateRateLimit(value.identity?.subject, "Identity subject rate limit"),
      perIp: validateRateLimit(value.identity?.perIp, "Identity IP rate limit"),
      global: validateRateLimit(value.identity?.global, "Identity global rate limit")
    }),
    writes: Object.freeze({
      perPrincipal: validateQuota(
        value.writes?.perPrincipal,
        "Project write quota"
      ),
      compile: validateQuota(value.writes?.compile, "Compile quota")
    })
  });
}

function environmentInteger(environment, name, fallback) {
  const raw = environment?.[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  invariant(
    typeof raw === "string" && /^(?:0|[1-9][0-9]*)$/u.test(raw),
    "INGRESS_POLICY_INVALID",
    `${name} must be an unsigned decimal integer.`,
    { status: 500 }
  );
  return Number(raw);
}

function environmentRate(environment, prefix, fallback) {
  return {
    attempts: environmentInteger(environment, `${prefix}_ATTEMPTS`, fallback.attempts),
    windowMs: environmentInteger(environment, `${prefix}_WINDOW_MS`, fallback.windowMs),
    blockMs: environmentInteger(environment, `${prefix}_BLOCK_MS`, fallback.blockMs)
  };
}

function environmentQuota(environment, prefix, fallback) {
  return {
    attempts: environmentInteger(environment, `${prefix}_ATTEMPTS`, fallback.attempts),
    windowMs: environmentInteger(environment, `${prefix}_WINDOW_MS`, fallback.windowMs)
  };
}

export function ingressPolicyFromEnvironment(environment = process.env) {
  return validateIngressPolicy({
    body: {
      jsonBytes: environmentInteger(
        environment,
        "SITESOURCERY_MAX_JSON_BODY_BYTES",
        DEFAULT_INGRESS_POLICY.body.jsonBytes
      ),
      webhookBytes: environmentInteger(
        environment,
        "SITESOURCERY_MAX_WEBHOOK_BODY_BYTES",
        DEFAULT_INGRESS_POLICY.body.webhookBytes
      )
    },
    node: {
      maxConcurrentRequests: environmentInteger(
        environment,
        "SITESOURCERY_MAX_CONCURRENT_REQUESTS",
        DEFAULT_INGRESS_POLICY.node.maxConcurrentRequests
      ),
      requestDeadlineMs: environmentInteger(
        environment,
        "SITESOURCERY_REQUEST_DEADLINE_MS",
        DEFAULT_INGRESS_POLICY.node.requestDeadlineMs
      )
    },
    identity: {
      subject: environmentRate(
        environment,
        "SITESOURCERY_IDENTITY_SUBJECT",
        DEFAULT_INGRESS_POLICY.identity.subject
      ),
      perIp: environmentRate(
        environment,
        "SITESOURCERY_IDENTITY_IP",
        DEFAULT_INGRESS_POLICY.identity.perIp
      ),
      global: environmentRate(
        environment,
        "SITESOURCERY_IDENTITY_GLOBAL",
        DEFAULT_INGRESS_POLICY.identity.global
      )
    },
    writes: {
      perPrincipal: environmentQuota(
        environment,
        "SITESOURCERY_PROJECT_WRITE",
        DEFAULT_INGRESS_POLICY.writes.perPrincipal
      ),
      compile: environmentQuota(
        environment,
        "SITESOURCERY_COMPILE",
        DEFAULT_INGRESS_POLICY.writes.compile
      )
    }
  });
}
