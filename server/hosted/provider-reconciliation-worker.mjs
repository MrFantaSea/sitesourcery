import { randomUUID } from "node:crypto";

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const WORKER_ID = /^provider-reconciliation-[A-Za-z0-9.-]{8,160}$/u;

function configurationError(message) {
  const error = new Error(message);
  error.name = "ProviderReconciliationWorkerConfigurationError";
  error.code = "PROVIDER_RECONCILIATION_WORKER_CONFIGURATION_INVALID";
  return error;
}

function integer(value, field, minimum, maximum) {
  if (
    !Number.isSafeInteger(value) || value < minimum || value > maximum
  ) {
    throw configurationError(`${field} is outside its bounded range.`);
  }
  return value;
}

function environmentInteger(environment, name, fallback, minimum, maximum) {
  const value = environment?.[name];
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw configurationError(`${name} must be a positive integer.`);
  }
  return integer(Number(value), name, minimum, maximum);
}

function safeFailureCode(error) {
  const code = error?.code;
  return typeof code === "string" && SAFE_ERROR_CODE.test(code)
    ? code
    : "PROVIDER_RECONCILIATION_UNCLASSIFIED_FAILURE";
}

function defaultWait(delayMs, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, delayMs);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

function validatePorts(repository, readback, clock, enabled) {
  if (
    repository?.kind !== "provider-reconciliation-postgres" ||
    repository.providerEffects !== false ||
    typeof repository.runDetection !== "function" ||
    typeof repository.escalateAbandonedClaim !== "function" ||
    typeof repository.recordReadback !== "function" ||
    typeof repository.listOpenCases !== "function"
  ) {
    throw configurationError("The reconciliation repository is invalid.");
  }
  // Readback is independently held; when absent the worker still detects,
  // self-heals the idempotent delivery projection, escalates abandoned
  // claims, and projects cases — it simply performs no provider readback.
  if (
    readback !== null &&
    (readback.providerEffects !== false ||
      readback.readOnly !== true ||
      typeof readback.readiness !== "function")
  ) {
    throw configurationError("The reconciliation readback port is invalid.");
  }
  if (typeof clock?.now !== "function") {
    throw configurationError("The reconciliation clock is invalid.");
  }
  if (typeof enabled !== "boolean") {
    throw configurationError("The reconciliation enable flag is invalid.");
  }
  return { repository, readback, clock, enabled };
}

export function createProviderReconciliationWorker({
  repository,
  readback = null,
  clock,
  enabled = false,
  workerId = `provider-reconciliation-${randomUUID()}`,
  intervalMs = 60_000,
  errorBackoffMs = 5_000,
  maximumBackoffMs = 300_000,
  wait = defaultWait,
  log = () => {}
} = {}) {
  const ports = validatePorts(repository, readback, clock, enabled);
  if (
    typeof workerId !== "string" || !WORKER_ID.test(workerId) ||
    typeof wait !== "function" || typeof log !== "function"
  ) {
    throw configurationError("The reconciliation worker config is invalid.");
  }
  integer(intervalMs, "Loop interval", 1_000, 3_600_000);
  integer(errorBackoffMs, "Error backoff", 100, 300_000);
  integer(maximumBackoffMs, "Maximum backoff", errorBackoffMs, 3_600_000);

  let controller = null;
  let loopPromise = null;
  let state = enabled ? "stopped" : "held";
  let cycles = 0;
  let consecutiveErrors = 0;
  let lastStatus = null;
  let lastErrorCode = null;

  function now() {
    const value = ports.clock.now();
    if (
      typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value
    ) {
      throw configurationError("The reconciliation clock returned no instant.");
    }
    return value;
  }

  function emit(entry) {
    try {
      log(Object.freeze({
        event: "sitesourcery.worker.provider-reconciliation",
        workerId,
        ...entry
      }));
    } catch {
      // Observability cannot change reconciliation authority or state.
    }
  }

  async function runOnce({ signal = null } = {}) {
    if (signal?.aborted) return Object.freeze({ status: "aborted" });
    if (!ports.enabled) return Object.freeze({ status: "held" });
    const observedAt = now();
    const detection = await ports.repository.runDetection({
      workerId,
      observedAt
    });

    // The only safe automatic transition beyond the idempotent projection
    // self-heal: move an abandoned dead-worker claim to manual review,
    // preserving its lease-owner identity. Everything else waits for an
    // operator through the projected queue.
    let escalated = 0;
    const open = await ports.repository.listOpenCases({ limit: 200 });
    for (const reconciliation of open.cases) {
      if (signal?.aborted) break;
      if (reconciliation.caseKind !== "abandoned_claim") continue;
      const result = await ports.repository.escalateAbandonedClaim({
        caseId: reconciliation.id,
        escalatedAt: now()
      });
      if (result.status === "escalated") escalated += 1;
    }

    return Object.freeze({
      status: "swept",
      observedAt,
      openedCases: detection.openedCases,
      selfHealedProjections: detection.counters.selfHealedProjections,
      escalatedClaims: escalated,
      readbackReady: ports.readback === null
        ? false
        : (await ports.readback.readiness()).ready === true
    });
  }

  async function loop(signal) {
    state = "running";
    emit({ state });
    try {
      while (!signal.aborted) {
        let delay = intervalMs;
        try {
          const result = await runOnce({ signal });
          cycles += 1;
          consecutiveErrors = 0;
          lastStatus = result.status;
          lastErrorCode = null;
          emit({
            state,
            cycle: cycles,
            resultStatus: lastStatus,
            openedCases: result.openedCases ?? 0,
            escalatedClaims: result.escalatedClaims ?? 0
          });
        } catch (error) {
          cycles += 1;
          consecutiveErrors += 1;
          lastStatus = "error";
          lastErrorCode = safeFailureCode(error);
          delay = Math.min(
            maximumBackoffMs,
            errorBackoffMs * 2 ** Math.min(consecutiveErrors - 1, 20)
          );
          emit({
            state,
            cycle: cycles,
            errorCode: lastErrorCode,
            nextDelayMs: delay
          });
        }
        if (!signal.aborted) await wait(delay, signal);
      }
    } finally {
      state = "stopped";
      emit({ state });
    }
  }

  return Object.freeze({
    kind: "provider-reconciliation-worker",
    runOnce,
    start({ signal = null } = {}) {
      if (!ports.enabled || state === "running" || controller !== null) {
        return false;
      }
      controller = new AbortController();
      if (signal !== null) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", () => controller.abort(), {
          once: true
        });
      }
      loopPromise = loop(controller.signal);
      return true;
    },
    async stop() {
      if (controller === null) return;
      controller.abort();
      try {
        await loopPromise;
      } finally {
        controller = null;
        loopPromise = null;
      }
    },
    snapshot() {
      return Object.freeze({
        kind: "provider-reconciliation-worker",
        state,
        workerId,
        enabled: ports.enabled,
        concurrency: 1,
        intervalMs,
        errorBackoffMs,
        maximumBackoffMs,
        cycles,
        consecutiveErrors,
        lastStatus,
        lastErrorCode,
        readbackComposed: ports.readback !== null
      });
    }
  });
}

export function providerReconciliationWorkerOptionsFromEnvironment(
  environment = process.env
) {
  return {
    intervalMs: environmentInteger(
      environment,
      "SITESOURCERY_PROVIDER_RECONCILIATION_WORKER_INTERVAL_MS",
      60_000, 1_000, 3_600_000
    ),
    errorBackoffMs: environmentInteger(
      environment,
      "SITESOURCERY_PROVIDER_RECONCILIATION_WORKER_ERROR_BACKOFF_MS",
      5_000, 100, 300_000
    ),
    maximumBackoffMs: environmentInteger(
      environment,
      "SITESOURCERY_PROVIDER_RECONCILIATION_WORKER_MAXIMUM_BACKOFF_MS",
      300_000, 100, 3_600_000
    )
  };
}
