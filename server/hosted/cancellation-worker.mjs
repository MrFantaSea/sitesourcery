import { randomUUID } from "node:crypto";

const SAFE_CODE = /^[A-Za-z0-9._:-]{1,200}$/u;
const SENSITIVE_CODE =
  /^(?:approval|pk_|price_|rk_|sk_(?:live|test)|whsec_)/iu;

function workerError(code, message) {
  const error = new Error(message);
  error.name = "CancellationWorkerConfigurationError";
  error.code = code;
  return error;
}

function integer(value, name, minimum, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw workerError(
      "CANCELLATION_WORKER_CONFIGURATION_INVALID",
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
    throw workerError(
      "CANCELLATION_WORKER_CONFIGURATION_INVALID",
      `${name} must be a positive integer.`
    );
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

function safeCode(value, fallback) {
  return typeof value === "string" &&
    SAFE_CODE.test(value) &&
    !SENSITIVE_CODE.test(value)
    ? value
    : fallback;
}

function safeResult(value) {
  const result =
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? value
      : {};
  return Object.freeze({
    processed: Number.isSafeInteger(result.processed)
      ? result.processed
      : 0,
    failed: Number.isSafeInteger(result.failed)
      ? result.failed
      : 0,
    ambiguous: Number.isSafeInteger(result.ambiguous)
      ? result.ambiguous
      : 0,
    held: result.held === true,
    provider:
      result.provider === "stripe"
        ? "stripe"
        : "unknown",
    mode:
      result.mode === "approved_live" ||
      result.mode === "held"
        ? result.mode
        : "unknown"
  });
}

export function createCancellationWorker({
  service,
  workerId = `hosted-cancel-${randomUUID()}`,
  batchLimit = 10,
  intervalMs = 5_000,
  errorBackoffMs = 5_000,
  maximumBackoffMs = 60_000,
  wait = defaultWait,
  log = () => {}
} = {}) {
  if (
    typeof service?.processPaymentOutbox !== "function" ||
    typeof wait !== "function" ||
    typeof log !== "function" ||
    typeof workerId !== "string" ||
    !/^hosted-cancel-[A-Za-z0-9.-]{8,180}$/u.test(
      workerId
    )
  ) {
    throw workerError(
      "CANCELLATION_WORKER_CONFIGURATION_INVALID",
      "Cancellation worker requires the exact leased service contract."
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
  let state = "stopped";
  let cycles = 0;
  let consecutiveErrors = 0;
  let lastResult = null;
  let lastErrorCode = null;

  function emit(entry) {
    try {
      log(
        Object.freeze({
          event: "sitesourcery.worker.cancellation",
          workerId,
          ...entry
        })
      );
    } catch {
      // Logging cannot change worker state or provider certainty.
    }
  }

  async function loop(signal) {
    state = "running";
    emit({ state });
    try {
      while (!signal.aborted) {
        let delay = intervalMs;
        try {
          const result =
            await service.processPaymentOutbox({
              limit: batchLimit,
              workerId
            });
          cycles += 1;
          consecutiveErrors = 0;
          lastErrorCode = null;
          lastResult = safeResult(result);
          emit({
            state,
            cycle: cycles,
            result: lastResult,
            nextDelayMs: delay
          });
        } catch (error) {
          cycles += 1;
          consecutiveErrors += 1;
          lastErrorCode = safeCode(
            error?.code,
            "CANCELLATION_WORKER_CYCLE_FAILED"
          );
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
    start() {
      if (loopPromise) return false;
      controller = new AbortController();
      loopPromise = loop(controller.signal).finally(() => {
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
        kind: "leased-cancellation-outbox",
        state,
        workerId,
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

export function cancellationWorkerOptionsFromEnvironment(
  environment = process.env
) {
  const errorBackoffMs = environmentInteger(
    environment,
    "SITESOURCERY_PAYMENT_WORKER_ERROR_BACKOFF_MS",
    5_000,
    100,
    300_000
  );
  return Object.freeze({
    batchLimit: environmentInteger(
      environment,
      "SITESOURCERY_PAYMENT_WORKER_BATCH_LIMIT",
      10,
      1,
      100
    ),
    intervalMs: environmentInteger(
      environment,
      "SITESOURCERY_PAYMENT_WORKER_INTERVAL_MS",
      5_000,
      100,
      300_000
    ),
    errorBackoffMs,
    maximumBackoffMs: environmentInteger(
      environment,
      "SITESOURCERY_PAYMENT_WORKER_MAXIMUM_BACKOFF_MS",
      60_000,
      errorBackoffMs,
      900_000
    )
  });
}
