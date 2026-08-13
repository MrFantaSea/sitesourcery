import { randomUUID } from "node:crypto";

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const WORKER_ID = /^responder-retention-[A-Za-z0-9.-]{8,160}$/u;

function configurationError(message) {
  const error = new Error(message);
  error.name = "ResponderRetentionWorkerConfigurationError";
  error.code = "RESPONDER_RETENTION_WORKER_CONFIGURATION_INVALID";
  return error;
}

function integer(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
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
    : "RESPONDER_RETENTION_UNCLASSIFIED_FAILURE";
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

function validatePorts(repository, clock, enabled) {
  if (
    repository?.kind !== "responder-private-material-retention-postgres" ||
    repository.providerEffects !== false ||
    repository.decryptsMaterial !== false ||
    typeof repository.readiness !== "function" ||
    typeof repository.discoverEligible !== "function" ||
    typeof repository.claimNext !== "function" ||
    typeof repository.destroyClaim !== "function" ||
    typeof repository.releaseClaim !== "function"
  ) {
    throw configurationError("The Responder retention repository is invalid.");
  }
  if (typeof clock?.now !== "function" || typeof enabled !== "boolean") {
    throw configurationError("The Responder retention worker ports are invalid.");
  }
  return { repository, clock, enabled };
}

export function createResponderPrivateMaterialRetentionWorker({
  repository,
  clock,
  enabled = false,
  workerId = `responder-retention-${randomUUID()}`,
  intervalMs = 60_000,
  errorBackoffMs = 5_000,
  maximumBackoffMs = 300_000,
  maximumDiscoveriesPerCycle = 100,
  maximumDestructionsPerCycle = 16,
  leaseSeconds = 120,
  wait = defaultWait,
  log = () => {}
} = {}) {
  const ports = validatePorts(repository, clock, enabled);
  if (
    typeof workerId !== "string" || !WORKER_ID.test(workerId) ||
    typeof wait !== "function" || typeof log !== "function"
  ) {
    throw configurationError("The Responder retention worker config is invalid.");
  }
  integer(intervalMs, "Loop interval", 1_000, 3_600_000);
  integer(errorBackoffMs, "Error backoff", 100, 300_000);
  integer(maximumBackoffMs, "Maximum backoff", errorBackoffMs, 3_600_000);
  integer(maximumDiscoveriesPerCycle, "Maximum discoveries", 1, 500);
  integer(maximumDestructionsPerCycle, "Maximum destructions", 1, 100);
  integer(leaseSeconds, "Lease seconds", 30, 600);

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
      throw configurationError("The Responder retention clock is invalid.");
    }
    return value;
  }

  function emit(entry) {
    try {
      log(Object.freeze({
        event: "sitesourcery.worker.responder-retention",
        workerId,
        ...entry
      }));
    } catch {
      // Observability cannot change cleanup authority or state.
    }
  }

  async function releaseAfterFailure(claim, error) {
    const failedAt = now();
    const retryDelay = Math.min(
      maximumBackoffMs,
      errorBackoffMs * 2 ** Math.min(claim.attemptCount - 1, 20)
    );
    await ports.repository.releaseClaim({
      jobId: claim.jobId,
      workerId,
      failureCode: safeFailureCode(error),
      observedAt: failedAt,
      retryAt: new Date(Date.parse(failedAt) + retryDelay).toISOString()
    });
  }

  async function runOnce({ signal = null } = {}) {
    if (signal?.aborted) return Object.freeze({ status: "aborted" });
    if (!ports.enabled) return Object.freeze({ status: "held" });
    const observedAt = now();
    const discovery = await ports.repository.discoverEligible({
      workerId,
      observedAt,
      limit: maximumDiscoveriesPerCycle
    });
    let claimed = 0;
    let destroyed = 0;
    let released = 0;
    for (
      let index = 0;
      index < maximumDestructionsPerCycle && !signal?.aborted;
      index += 1
    ) {
      const claim = await ports.repository.claimNext({
        workerId,
        observedAt: now(),
        leaseSeconds
      });
      if (claim === null) break;
      claimed += 1;
      try {
        const receipt = await ports.repository.destroyClaim({
          jobId: claim.jobId,
          workerId,
          observedAt: now()
        });
        if (receipt.primaryCiphertextZeroed === true) destroyed += 1;
      } catch (error) {
        await releaseAfterFailure(claim, error);
        released += 1;
      }
    }
    return Object.freeze({
      status: "swept",
      observedAt,
      discovered: discovery.discovered,
      claimed,
      destroyed,
      released,
      providerEffects: false,
      decryptsMaterial: false
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
            discovered: result.discovered ?? 0,
            destroyed: result.destroyed ?? 0,
            released: result.released ?? 0
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
    kind: "responder-private-material-retention-worker",
    providerEffects: false,
    decryptsMaterial: false,
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
        kind: "responder-private-material-retention-worker",
        state,
        workerId,
        enabled: ports.enabled,
        concurrency: 1,
        intervalMs,
        errorBackoffMs,
        maximumBackoffMs,
        maximumDiscoveriesPerCycle,
        maximumDestructionsPerCycle,
        leaseSeconds,
        cycles,
        consecutiveErrors,
        lastStatus,
        lastErrorCode,
        providerEffects: false,
        decryptsMaterial: false
      });
    }
  });
}

export function responderRetentionWorkerOptionsFromEnvironment(
  environment = process.env
) {
  return {
    intervalMs: environmentInteger(
      environment,
      "SITESOURCERY_RESPONDER_RETENTION_WORKER_INTERVAL_MS",
      60_000, 1_000, 3_600_000
    ),
    errorBackoffMs: environmentInteger(
      environment,
      "SITESOURCERY_RESPONDER_RETENTION_WORKER_ERROR_BACKOFF_MS",
      5_000, 100, 300_000
    ),
    maximumBackoffMs: environmentInteger(
      environment,
      "SITESOURCERY_RESPONDER_RETENTION_WORKER_MAXIMUM_BACKOFF_MS",
      300_000, 100, 3_600_000
    ),
    maximumDiscoveriesPerCycle: environmentInteger(
      environment,
      "SITESOURCERY_RESPONDER_RETENTION_MAXIMUM_DISCOVERIES_PER_CYCLE",
      100, 1, 500
    ),
    maximumDestructionsPerCycle: environmentInteger(
      environment,
      "SITESOURCERY_RESPONDER_RETENTION_MAXIMUM_DESTRUCTIONS_PER_CYCLE",
      16, 1, 100
    ),
    leaseSeconds: environmentInteger(
      environment,
      "SITESOURCERY_RESPONDER_RETENTION_LEASE_SECONDS",
      120, 30, 600
    )
  };
}
