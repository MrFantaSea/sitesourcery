import {
  canonicalJson,
  safeIdentifier,
  sha256Bytes
} from "./immutable-evidence.mjs";

export const HOSTED_LOAD_SLO_PROFILE_SCHEMA =
  "sitesourcery.hosted-load-slo-profile/v1";
export const HOSTED_LOAD_SLO_RECEIPT_SCHEMA =
  "sitesourcery.hosted-load-slo-receipt/v1";

const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const NODE_VERSION = "24.18.0";

export const LOCAL_HOSTED_LOAD_SLO_PROFILE = deepFreeze({
  schema: HOSTED_LOAD_SLO_PROFILE_SCHEMA,
  scope: "local_fixture_only",
  productionSloAuthority: "absent",
  ingress: {
    maxConcurrentRequests: 4,
    excessRequests: 3,
    requestDeadlineMs: 1_000
  },
  postgres: {
    totalConnections: 3,
    apiConnections: 1,
    workerReservedConnections: 2,
    acquisitionMs: 100
  },
  readiness: {
    concurrentReads: 20,
    ttlMs: 100,
    timeoutMs: 50,
    staleAfterMs: 500
  },
  shutdown: {
    purposes: ["export", "cancellation"],
    deadlineMs: 1_000
  }
});

export const HOSTED_LOAD_SLO_HELD_AUTHORITY = deepFreeze({
  mode: "held",
  customer: "held",
  payment: "held",
  mail: "held",
  dns: "held",
  provider: "held",
  publication: "held",
  networkEffects: "none",
  externalEffects: "none",
  productionSloAuthority: "absent",
  productionReady: false
});

export const HOSTED_LOAD_SLO_OPEN_GATES = deepFreeze({
  productionQueueDepth: "open",
  productionQueueOldestAge: "open",
  productionQueueBackpressure: "open",
  productionTrafficSlo: "owner_required",
  deployedReleaseLoad: "not_proven"
});

function fail(message) {
  throw new Error(message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
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

function exactInteger(value, expected, label) {
  if (!Number.isSafeInteger(value) || value !== expected) {
    fail(`${label} drifted from the local acceptance profile.`);
  }
  return value;
}

function exactBoolean(value, expected, label) {
  if (value !== expected) {
    fail(`${label} drifted from the local acceptance contract.`);
  }
  return value;
}

function exactString(value, expected, label) {
  if (value !== expected) {
    fail(`${label} drifted from the local acceptance contract.`);
  }
  return value;
}

function exactArray(value, expected, label) {
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail(`${label} drifted from the local acceptance contract.`);
  }
  return value;
}

function exactIso(value, label) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    fail(`${label} must be an exact ISO timestamp.`);
  }
  return value;
}

function validateSource(value) {
  exactObject(
    value,
    ["commitSha", "treeSha", "nodeVersion", "classification"],
    "Load source"
  );
  if (!COMMIT_SHA.test(value.commitSha) || !COMMIT_SHA.test(value.treeSha)) {
    fail("Load source requires exact lowercase Git commit and tree SHAs.");
  }
  exactString(value.nodeVersion, NODE_VERSION, "Load source Node version");
  exactString(
    value.classification,
    "caller_supplied_local_fixture_identity",
    "Load source classification"
  );
  return value;
}

export function validateHostedLoadSloProfile(value) {
  if (canonicalJson(value) !== canonicalJson(LOCAL_HOSTED_LOAD_SLO_PROFILE)) {
    fail("Hosted load acceptance requires the exact local-only profile.");
  }
  return LOCAL_HOSTED_LOAD_SLO_PROFILE;
}

function validateIngress(value, profile) {
  exactObject(
    value,
    [
      "attemptedRequests",
      "admittedRequests",
      "busyRequests",
      "busyStatus",
      "busyCode",
      "retryAfterSeconds",
      "deadlineStatus",
      "deadlineCode",
      "activeAfter"
    ],
    "Ingress observation"
  );
  exactInteger(
    value.attemptedRequests,
    profile.maxConcurrentRequests + profile.excessRequests,
    "Ingress attempted requests"
  );
  exactInteger(
    value.admittedRequests,
    profile.maxConcurrentRequests,
    "Ingress admitted requests"
  );
  exactInteger(value.busyRequests, profile.excessRequests, "Ingress busy requests");
  exactInteger(value.busyStatus, 503, "Ingress busy status");
  exactString(value.busyCode, "SERVER_BUSY", "Ingress busy code");
  exactInteger(value.retryAfterSeconds, 1, "Ingress retry delay");
  exactInteger(value.deadlineStatus, 504, "Ingress deadline status");
  exactString(
    value.deadlineCode,
    "REQUEST_DEADLINE_EXCEEDED",
    "Ingress deadline code"
  );
  exactInteger(value.activeAfter, 0, "Ingress active requests after proof");
  return value;
}

function validatePool(value, profile, workload) {
  exactObject(
    value,
    [
      "workload",
      "totalConnections",
      "apiConnections",
      "workerReservedConnections",
      "processConnectionBudget",
      "requestedAcquisitions",
      "successfulAcquisitions",
      "saturationEvents",
      "timedOutAcquisitions",
      "queuedAfter",
      "activeAfter",
      "pii"
    ],
    `${workload} pool observation`
  );
  const processBudget = workload === "api"
    ? profile.apiConnections
    : profile.workerReservedConnections;
  exactString(value.workload, workload, `${workload} pool workload`);
  exactInteger(
    value.totalConnections,
    profile.totalConnections,
    `${workload} total pool budget`
  );
  exactInteger(
    value.apiConnections,
    profile.apiConnections,
    `${workload} API pool budget`
  );
  exactInteger(
    value.workerReservedConnections,
    profile.workerReservedConnections,
    `${workload} worker pool reserve`
  );
  exactInteger(
    value.processConnectionBudget,
    processBudget,
    `${workload} process pool budget`
  );
  exactInteger(
    value.requestedAcquisitions,
    processBudget + 1,
    `${workload} requested acquisitions`
  );
  exactInteger(
    value.successfulAcquisitions,
    processBudget,
    `${workload} successful acquisitions`
  );
  exactInteger(value.saturationEvents, 1, `${workload} saturation events`);
  exactInteger(value.timedOutAcquisitions, 1, `${workload} timed-out acquisitions`);
  exactInteger(value.queuedAfter, 0, `${workload} queued acquisitions after proof`);
  exactInteger(value.activeAfter, 0, `${workload} active transactions after proof`);
  exactString(value.pii, "none", `${workload} telemetry PII state`);
  return value;
}

function validateReadiness(value, profile) {
  exactObject(
    value,
    [
      "concurrentReads",
      "totalReads",
      "dependencyCalls",
      "readyReads",
      "cacheHit",
      "singleflight",
      "escapedPrivateDetail"
    ],
    "Readiness observation"
  );
  exactInteger(value.concurrentReads, profile.concurrentReads, "Readiness concurrent reads");
  exactInteger(value.totalReads, profile.concurrentReads + 1, "Readiness total reads");
  exactInteger(value.dependencyCalls, 1, "Readiness dependency calls");
  exactInteger(value.readyReads, profile.concurrentReads + 1, "Readiness ready reads");
  exactBoolean(value.cacheHit, true, "Readiness cache hit");
  exactBoolean(value.singleflight, true, "Readiness singleflight");
  exactBoolean(
    value.escapedPrivateDetail,
    false,
    "Readiness private-detail projection"
  );
  return value;
}

function validateShutdown(value, profile) {
  exactObject(
    value,
    [
      "startedPurposes",
      "stoppedPurposes",
      "reverseOrder",
      "stateAfter",
      "secondStop",
      "deadlineEnforced",
      "deadlineFailureCode"
    ],
    "Shutdown observation"
  );
  exactArray(value.startedPurposes, profile.purposes, "Started worker purposes");
  exactArray(
    value.stoppedPurposes,
    [...profile.purposes].reverse(),
    "Stopped worker purposes"
  );
  exactBoolean(value.reverseOrder, true, "Worker reverse shutdown order");
  exactString(value.stateAfter, "stopped", "Worker state after shutdown");
  exactBoolean(value.secondStop, false, "Worker repeated stop result");
  exactBoolean(value.deadlineEnforced, true, "Worker shutdown deadline enforcement");
  exactString(
    value.deadlineFailureCode,
    "WORKER_SHUTDOWN_TIMEOUT",
    "Worker shutdown deadline failure code"
  );
  return value;
}

function validateObservations(value, profile) {
  exactObject(
    value,
    ["ingress", "apiPool", "workerPool", "readiness", "shutdown"],
    "Load observations"
  );
  validateIngress(value.ingress, profile.ingress);
  validatePool(value.apiPool, profile.postgres, "api");
  validatePool(value.workerPool, profile.postgres, "worker");
  validateReadiness(value.readiness, profile.readiness);
  validateShutdown(value.shutdown, profile.shutdown);
  return value;
}

function receiptPayload(value) {
  return {
    schema: value.schema,
    runId: value.runId,
    observedAt: value.observedAt,
    source: value.source,
    profile: value.profile,
    observations: value.observations,
    authority: value.authority,
    openGates: value.openGates,
    result: value.result
  };
}

export function validateHostedLoadSloReceipt(value) {
  exactObject(
    value,
    [
      "schema",
      "runId",
      "observedAt",
      "source",
      "profile",
      "observations",
      "authority",
      "openGates",
      "result",
      "digest"
    ],
    "Hosted load receipt"
  );
  exactString(value.schema, HOSTED_LOAD_SLO_RECEIPT_SCHEMA, "Hosted load receipt schema");
  safeIdentifier(value.runId, "Hosted load receipt run ID");
  exactIso(value.observedAt, "Hosted load receipt observation");
  validateSource(value.source);
  const profile = validateHostedLoadSloProfile(value.profile);
  validateObservations(value.observations, profile);
  if (canonicalJson(value.authority) !== canonicalJson(HOSTED_LOAD_SLO_HELD_AUTHORITY)) {
    fail("Hosted load receipt authority must remain wholly held.");
  }
  if (canonicalJson(value.openGates) !== canonicalJson(HOSTED_LOAD_SLO_OPEN_GATES)) {
    fail("Hosted load receipt must keep production queue and deployment gates open.");
  }
  exactObject(
    value.result,
    ["localContractAccepted", "productionReady", "claim"],
    "Hosted load result"
  );
  exactBoolean(value.result.localContractAccepted, true, "Local load acceptance result");
  exactBoolean(value.result.productionReady, false, "Production load readiness result");
  exactString(value.result.claim, "local_contract_only", "Hosted load receipt claim");
  if (
    typeof value.digest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.digest) ||
    value.digest !== sha256Bytes(
      Buffer.from(`${canonicalJson(receiptPayload(value))}\n`, "utf8")
    )
  ) {
    fail("Hosted load receipt digest is invalid.");
  }
  return deepFreeze(structuredClone(value));
}

export function createHostedLoadSloReceipt({
  runId,
  observedAt,
  source,
  observations,
  profile = LOCAL_HOSTED_LOAD_SLO_PROFILE
}) {
  const payload = {
    schema: HOSTED_LOAD_SLO_RECEIPT_SCHEMA,
    runId,
    observedAt,
    source,
    profile,
    observations,
    authority: HOSTED_LOAD_SLO_HELD_AUTHORITY,
    openGates: HOSTED_LOAD_SLO_OPEN_GATES,
    result: {
      localContractAccepted: true,
      productionReady: false,
      claim: "local_contract_only"
    }
  };
  return validateHostedLoadSloReceipt({
    ...payload,
    digest: sha256Bytes(
      Buffer.from(`${canonicalJson(payload)}\n`, "utf8")
    )
  });
}
