import { randomUUID } from "node:crypto";

const SAFE_PURPOSE = /^[a-z][a-z0-9-]{2,63}$/u;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;

function configurationError(message) {
  const error = new Error(message);
  error.name = "LeasedLifecycleWorkerConfigurationError";
  error.code = "LIFECYCLE_WORKER_CONFIGURATION_INVALID";
  return error;
}

function integer(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw configurationError(`${field} is outside its bounded range.`);
  }
  return value;
}

function safeCode(error) {
  return typeof error?.code === "string" && SAFE_CODE.test(error.code)
    ? error.code
    : "LIFECYCLE_WORKER_UNCLASSIFIED_FAILURE";
}

function defaultWait(delayMs, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(finish, delayMs);
    timer.unref?.();
    signal?.addEventListener?.("abort", finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", finish);
      resolve();
    }
  });
}

export function lifecycleWorkerOptionsFromEnvironment(
  environment,
  {
    prefix,
    intervalMs = 60_000,
    errorBackoffMs = 5_000,
    maximumBackoffMs = 300_000,
    batchLimit = 10,
    leaseSeconds = 120
  }
) {
  function selectedInteger(name, fallback, minimum, maximum) {
    const raw = environment?.[`${prefix}_${name}`];
    if (raw === undefined || raw === "") return fallback;
    if (typeof raw !== "string" || !/^[1-9][0-9]*$/u.test(raw)) {
      throw configurationError(`${prefix}_${name} must be a positive integer.`);
    }
    return integer(Number(raw), `${prefix}_${name}`, minimum, maximum);
  }
  const mode = environment?.[`${prefix}_MODE`] ?? "held";
  if (mode !== "held" && mode !== "approved_live") {
    throw configurationError(`${prefix}_MODE must be held or approved_live.`);
  }
  const selectedErrorBackoff = selectedInteger(
    "ERROR_BACKOFF_MS",
    errorBackoffMs,
    100,
    300_000
  );
  return Object.freeze({
    enabled: mode === "approved_live",
    mode,
    intervalMs: selectedInteger("INTERVAL_MS", intervalMs, 1_000, 300_000),
    errorBackoffMs: selectedErrorBackoff,
    maximumBackoffMs: selectedInteger(
      "MAXIMUM_BACKOFF_MS",
      maximumBackoffMs,
      selectedErrorBackoff,
      900_000
    ),
    batchLimit: selectedInteger("BATCH_LIMIT", batchLimit, 1, 100),
    leaseSeconds: selectedInteger("LEASE_SECONDS", leaseSeconds, 30, 300)
  });
}

export function createLeasedLifecycleWorker({
  purpose,
  repository,
  executor,
  clock = { now: () => new Date().toISOString() },
  enabled = false,
  workerId = `${purpose}-${randomUUID()}`,
  intervalMs = 60_000,
  errorBackoffMs = 5_000,
  maximumBackoffMs = 300_000,
  batchLimit = 10,
  leaseSeconds = 120,
  wait = defaultWait,
  log = () => {}
} = {}) {
  if (
    !SAFE_PURPOSE.test(purpose ?? "") ||
    repository?.kind !== `${purpose}-postgres` ||
    typeof repository.claimNext !== "function" ||
    typeof repository.completeClaim !== "function" ||
    typeof repository.releaseClaim !== "function" ||
    typeof repository.readiness !== "function" ||
    executor?.kind !== `${purpose}-executor` ||
    typeof executor.execute !== "function" ||
    typeof executor.readiness !== "function" ||
    typeof clock?.now !== "function" ||
    typeof enabled !== "boolean" ||
    typeof workerId !== "string" ||
    !new RegExp(`^${purpose}-[A-Za-z0-9.-]{8,160}$`, "u").test(workerId) ||
    typeof wait !== "function" ||
    typeof log !== "function"
  ) {
    throw configurationError(`The ${purpose ?? "lifecycle"} worker ports are invalid.`);
  }
  integer(intervalMs, "Loop interval", 1_000, 300_000);
  integer(errorBackoffMs, "Error backoff", 100, 300_000);
  integer(maximumBackoffMs, "Maximum backoff", errorBackoffMs, 900_000);
  integer(batchLimit, "Batch limit", 1, 100);
  integer(leaseSeconds, "Lease seconds", 30, 300);

  let controller = null;
  let loopPromise = null;
  let state = enabled ? "stopped" : "held";
  let cycles = 0;
  let consecutiveErrors = 0;
  let lastStatus = null;
  let lastErrorCode = null;

  function now() {
    const value = clock.now();
    if (
      typeof value !== "string" ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value
    ) {
      throw configurationError("The lifecycle clock returned no exact instant.");
    }
    return value;
  }

  function emit(entry) {
    try {
      log(Object.freeze({
        event: `sitesourcery.worker.${purpose}`,
        workerId,
        ...entry
      }));
    } catch {
      // Observability cannot change lifecycle authority or lease ownership.
    }
  }

  async function release(claim, error) {
    const failedAt = now();
    const delay = Math.min(
      maximumBackoffMs,
      errorBackoffMs * 2 ** Math.min(Math.max(claim.attemptCount - 1, 0), 20)
    );
    return repository.releaseClaim({
      jobId: claim.jobId,
      fence: claim.fence,
      workerId,
      failureCode: safeCode(error),
      observedAt: failedAt,
      retryAt: new Date(Date.parse(failedAt) + delay).toISOString()
    });
  }

  async function runOnce({ signal = null } = {}) {
    if (signal?.aborted) return Object.freeze({ status: "aborted" });
    if (!enabled) return Object.freeze({ status: "held" });
    const observedAt = now();
    let claimed = 0;
    let completed = 0;
    let manualReview = 0;
    let released = 0;
    for (let index = 0; index < batchLimit && !signal?.aborted; index += 1) {
      const claim = await repository.claimNext({
        workerId,
        observedAt: now(),
        leaseSeconds
      });
      if (claim === null) break;
      claimed += 1;
      try {
        const result = await executor.execute(claim, { signal });
        const receipt = await repository.completeClaim({
          jobId: claim.jobId,
          fence: claim.fence,
          workerId,
          observedAt: now(),
          result
        });
        if (receipt?.status === "manual_review") manualReview += 1;
        else completed += 1;
      } catch (error) {
        const receipt = await release(claim, error);
        if (receipt?.status === "manual_review") manualReview += 1;
        else released += 1;
      }
    }
    return Object.freeze({
      status: "processed",
      observedAt,
      claimed,
      completed,
      manualReview,
      released
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
            resultStatus: result.status,
            claimed: result.claimed ?? 0,
            completed: result.completed ?? 0,
            manualReview: result.manualReview ?? 0,
            released: result.released ?? 0
          });
        } catch (error) {
          cycles += 1;
          consecutiveErrors += 1;
          lastStatus = "error";
          lastErrorCode = safeCode(error);
          delay = Math.min(
            maximumBackoffMs,
            errorBackoffMs * 2 ** Math.min(consecutiveErrors - 1, 20)
          );
          emit({ state, cycle: cycles, errorCode: lastErrorCode, nextDelayMs: delay });
        }
        if (!signal.aborted) await wait(delay, signal);
      }
    } finally {
      state = "stopped";
      emit({ state });
    }
  }

  return Object.freeze({
    kind: `${purpose}-worker`,
    runOnce,
    start({ signal = null } = {}) {
      if (!enabled || controller !== null || state === "running") return false;
      controller = new AbortController();
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", () => controller?.abort(), { once: true });
      }
      loopPromise = loop(controller.signal);
      return true;
    },
    async stop() {
      if (controller === null) return false;
      controller.abort();
      await loopPromise;
      controller = null;
      loopPromise = null;
      return true;
    },
    snapshot() {
      return Object.freeze({
        kind: `${purpose}-worker-state/v1`,
        purpose,
        state,
        enabled,
        workerId,
        cycles,
        consecutiveErrors,
        lastStatus,
        lastErrorCode
      });
    }
  });
}
