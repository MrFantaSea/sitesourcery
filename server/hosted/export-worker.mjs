import { randomUUID } from "node:crypto";

const SAFE_WORKER_ID =
  /^hosted-export-[A-Za-z0-9.-]{8,180}$/u;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;

function workerError(message) {
  const error = new Error(message);
  error.name = "ExportWorkerConfigurationError";
  error.code = "EXPORT_WORKER_CONFIGURATION_INVALID";
  return error;
}

function integer(value, name, minimum, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw workerError(
      `${name} is outside the supported range.`
    );
  }
  return value;
}

function environmentInteger(
  environment,
  name,
  fallback,
  minimum,
  maximum
) {
  const value = environment?.[name];
  if (value === undefined || value === "") {
    return fallback;
  }
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]*$/u.test(value)
  ) {
    throw workerError(`${name} must be a positive integer.`);
  }
  return integer(
    Number(value),
    name,
    minimum,
    maximum
  );
}

function defaultWait(milliseconds, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    timer.unref?.();
    signal.addEventListener("abort", finish, {
      once: true
    });

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

function safeErrorCode(error) {
  return typeof error?.code === "string" &&
    SAFE_ERROR_CODE.test(error.code)
    ? error.code
    : "EXPORT_WORKER_CYCLE_FAILED";
}

function safeBatchResult(value) {
  if (!Array.isArray(value)) {
    throw workerError(
      "The export service returned an invalid batch."
    );
  }
  return Object.freeze({
    processed: value.length,
    ready: value.filter(
      (entry) => entry?.export?.status === "ready"
    ).length,
    failed: value.filter(
      (entry) =>
        entry?.export?.status === "failed" ||
        typeof entry?.errorCode === "string"
    ).length,
    aborted: value.some((entry) => entry?.aborted === true)
  });
}

export function createExportWorker({
  service,
  enabled = false,
  workerId = `hosted-export-${randomUUID()}`,
  batchLimit = 10,
  intervalMs = 5_000,
  errorBackoffMs = 5_000,
  maximumBackoffMs = 60_000,
  wait = defaultWait,
  log = () => {}
} = {}) {
  if (
    typeof service?.processQueuedExports !== "function" ||
    typeof enabled !== "boolean" ||
    typeof wait !== "function" ||
    typeof log !== "function" ||
    typeof workerId !== "string" ||
    !SAFE_WORKER_ID.test(workerId)
  ) {
    throw workerError(
      "Export worker requires the exact fenced service contract."
    );
  }
  integer(batchLimit, "batchLimit", 1, 100);
  integer(intervalMs, "intervalMs", 100, 300_000);
  integer(
    errorBackoffMs,
    "errorBackoffMs",
    100,
    300_000
  );
  integer(
    maximumBackoffMs,
    "maximumBackoffMs",
    errorBackoffMs,
    900_000
  );

  let controller = null;
  let loopPromise = null;
  let unlinkExternalAbort = null;
  let state = enabled ? "stopped" : "held";
  let cycles = 0;
  let consecutiveErrors = 0;
  let lastResult = null;
  let lastErrorCode = null;

  function emit(entry) {
    try {
      log(
        Object.freeze({
          event: "sitesourcery.worker.export",
          workerId,
          ...entry
        })
      );
    } catch {
      // Logging cannot alter claim ownership or worker state.
    }
  }

  async function loop(signal) {
    state = "running";
    emit({ state });
    try {
      while (!signal.aborted) {
        let delay = intervalMs;
        try {
          lastResult = safeBatchResult(
            await service.processQueuedExports({
              workerId,
              limit: batchLimit,
              signal
            })
          );
          cycles += 1;
          consecutiveErrors = 0;
          lastErrorCode = null;
          emit({
            state,
            cycle: cycles,
            result: lastResult,
            nextDelayMs: delay
          });
        } catch (error) {
          cycles += 1;
          consecutiveErrors += 1;
          lastErrorCode = safeErrorCode(error);
          const exponent = Math.min(
            consecutiveErrors - 1,
            20
          );
          delay = Math.min(
            maximumBackoffMs,
            errorBackoffMs * 2 ** exponent
          );
          emit({
            state,
            cycle: cycles,
            errorCode: lastErrorCode,
            nextDelayMs: delay
          });
        }
        if (!signal.aborted) {
          await wait(delay, signal);
        }
      }
    } finally {
      state = "stopped";
      emit({ state });
    }
  }

  return Object.freeze({
    start({ signal = null } = {}) {
      if (!enabled || loopPromise) return false;
      if (
        signal !== null &&
        !(
          typeof signal === "object" &&
          typeof signal.aborted === "boolean" &&
          typeof signal.addEventListener === "function"
        )
      ) {
        throw workerError(
          "Export worker shutdown signal is invalid."
        );
      }
      controller = new AbortController();
      if (signal) {
        const forwardAbort = () => controller?.abort();
        signal.addEventListener("abort", forwardAbort, {
          once: true
        });
        unlinkExternalAbort = () =>
          signal.removeEventListener(
            "abort",
            forwardAbort
          );
        if (signal.aborted) controller.abort();
      }
      loopPromise = loop(controller.signal).finally(() => {
        unlinkExternalAbort?.();
        unlinkExternalAbort = null;
        controller = null;
        loopPromise = null;
      });
      return true;
    },

    async stop() {
      if (!loopPromise) return false;
      state = "stopping";
      controller.abort();
      await loopPromise;
      return true;
    },

    snapshot() {
      return Object.freeze({
        kind: "fenced-export-queue",
        state,
        workerId,
        enabled,
        batchLimit,
        intervalMs,
        errorBackoffMs,
        maximumBackoffMs,
        cycles,
        consecutiveErrors,
        lastResult,
        lastErrorCode
      });
    }
  });
}

export function exportWorkerOptionsFromEnvironment(
  environment = process.env
) {
  const mode =
    environment?.SITESOURCERY_EXPORT_WORKER_MODE ??
    "held";
  if (mode !== "held" && mode !== "enabled") {
    throw workerError(
      "SITESOURCERY_EXPORT_WORKER_MODE must be exactly held or enabled."
    );
  }
  const errorBackoffMs = environmentInteger(
    environment,
    "SITESOURCERY_EXPORT_WORKER_ERROR_BACKOFF_MS",
    5_000,
    100,
    300_000
  );
  return Object.freeze({
    enabled: mode === "enabled",
    batchLimit: environmentInteger(
      environment,
      "SITESOURCERY_EXPORT_WORKER_BATCH_LIMIT",
      10,
      1,
      100
    ),
    intervalMs: environmentInteger(
      environment,
      "SITESOURCERY_EXPORT_WORKER_INTERVAL_MS",
      5_000,
      100,
      300_000
    ),
    errorBackoffMs,
    maximumBackoffMs: environmentInteger(
      environment,
      "SITESOURCERY_EXPORT_WORKER_MAXIMUM_BACKOFF_MS",
      60_000,
      errorBackoffMs,
      900_000
    )
  });
}
