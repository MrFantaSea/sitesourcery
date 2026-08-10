import { invariant } from "./errors.mjs";
import {
  WORKER_PURPOSES,
  createWorkerConfiguration
} from "./worker-config.mjs";

const PURPOSE_SET = new Set(WORKER_PURPOSES);

function configurationError(code, message) {
  const error = new Error(message);
  error.name = "WorkerSupervisorError";
  error.code = code;
  return error;
}

function validateWorker(worker, purpose) {
  invariant(
    worker &&
      typeof worker.start === "function" &&
      typeof worker.stop === "function" &&
      typeof worker.snapshot === "function",
    "WORKER_DEPENDENCY_NOT_READY",
    `The ${purpose} worker contract is incomplete.`,
    { status: 503 }
  );
  return worker;
}

function withDeadline(work, milliseconds, timers) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = timers.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(configurationError(
        "WORKER_SHUTDOWN_TIMEOUT",
        "Worker shutdown exceeded its bounded deadline."
      ));
    }, milliseconds);
    timer.unref?.();
    Promise.resolve(work).then(
      (value) => {
        if (settled) return;
        settled = true;
        timers.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        timers.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function createWorkerSupervisor({
  configuration: suppliedConfiguration,
  factories = {},
  approvalExists = () => false,
  log = () => {},
  timers = {
    setTimeout,
    clearTimeout
  }
} = {}) {
  const configuration = createWorkerConfiguration({
    configurationJson: JSON.stringify(suppliedConfiguration)
  }).configuration;
  invariant(
    factories &&
      typeof factories === "object" &&
      !Array.isArray(factories) &&
      Object.keys(factories).every(
        (purpose) =>
          PURPOSE_SET.has(purpose) &&
          typeof factories[purpose] === "function"
      ) &&
      typeof approvalExists === "function" &&
      typeof log === "function" &&
      typeof timers?.setTimeout === "function" &&
      typeof timers?.clearTimeout === "function",
    "WORKER_CONFIGURATION_INVALID",
    "Worker supervisor dependencies are invalid.",
    { status: 500 }
  );

  let state = configuration.activation === "held"
    ? "held"
    : "stopped";
  let workers = [];
  let startPromise = null;
  let stopPromise = null;
  let unlinkAbort = null;

  function emit(entry) {
    try {
      log(Object.freeze({
        event: "sitesourcery.worker.supervisor",
        ...entry
      }));
    } catch {
      // Observability cannot change process authority or worker state.
    }
  }

  async function stopWorkers(selected) {
    const results = await Promise.allSettled(
      [...selected]
        .reverse()
        .map(({ worker }) => worker.stop())
    );
    if (results.some((result) => result.status === "rejected")) {
      throw configurationError(
        "WORKER_SHUTDOWN_FAILED",
        "One or more workers did not stop cleanly."
      );
    }
  }

  async function start({ signal = null } = {}) {
    if (configuration.activation === "held") return false;
    if (startPromise || workers.length > 0 || state !== "stopped") {
      return false;
    }
    startPromise = (async () => {
      state = "starting";
      emit({ state, purposes: configuration.purposes });
      try {
        invariant(
          approvalExists(configuration.approvalPath) === true,
          "WORKER_APPROVAL_REQUIRED",
          "The exact owner worker approval is absent.",
          { status: 503 }
        );
        for (const purpose of configuration.purposes) {
          invariant(
            typeof factories[purpose] === "function",
            "WORKER_PURPOSE_UNAVAILABLE",
            `The ${purpose} worker composition is unavailable.`,
            { status: 503 }
          );
        }
        const selected = await Promise.all(
          configuration.purposes.map(async (purpose) => {
            const composition = await factories[purpose]({
              loop: configuration.loop
            });
            invariant(
              composition &&
                typeof composition.readiness === "function",
              "WORKER_DEPENDENCY_NOT_READY",
              `The ${purpose} dependency readback is unavailable.`,
              { status: 503 }
            );
            return {
              purpose,
              worker: validateWorker(
                composition.worker,
                purpose
              ),
              readiness: composition.readiness
            };
          })
        );
        const readiness = await Promise.all(
          selected.map(({ readiness }) => readiness())
        );
        for (let index = 0; index < readiness.length; index += 1) {
          invariant(
            readiness[index]?.ready === true,
            "WORKER_DEPENDENCY_NOT_READY",
            `The ${selected[index].purpose} dependencies are not ready.`,
            { status: 503 }
          );
        }
        invariant(
          signal === null ||
            (
              typeof signal === "object" &&
              typeof signal.aborted === "boolean" &&
              typeof signal.addEventListener === "function"
            ),
          "WORKER_CONFIGURATION_INVALID",
          "Worker shutdown signal is invalid.",
          { status: 500 }
        );
        invariant(
          signal?.aborted !== true,
          "WORKER_START_ABORTED",
          "Worker startup was aborted before activation.",
          { status: 503 }
        );
        const started = [];
        try {
          for (const entry of selected) {
            invariant(
              entry.worker.start({ signal }) === true,
              "WORKER_START_FAILED",
              `The ${entry.purpose} worker refused activation.`,
              { status: 503 }
            );
            started.push(entry);
          }
        } catch (error) {
          await stopWorkers(started);
          throw error;
        }
        workers = selected;
        if (signal) {
          const forwardAbort = () => {
            void stop().catch(() => {
              // stop() emits the bounded failure; abort handlers must not
              // create an unhandled rejection outside the owner process.
            });
          };
          signal.addEventListener("abort", forwardAbort, {
            once: true
          });
          unlinkAbort = () => signal.removeEventListener(
            "abort",
            forwardAbort
          );
        }
        state = "running";
        emit({ state, purposes: configuration.purposes });
        return true;
      } catch (error) {
        state = "failed";
        emit({
          state,
          errorCode:
            typeof error?.code === "string"
              ? error.code
              : "WORKER_START_FAILED"
        });
        throw error;
      } finally {
        startPromise = null;
      }
    })();
    return startPromise;
  }

  async function stop() {
    if (stopPromise) return stopPromise;
    if (workers.length === 0) return false;
    const selected = workers;
    workers = [];
    state = "stopping";
    emit({ state, purposes: configuration.purposes });
    unlinkAbort?.();
    unlinkAbort = null;
    stopPromise = withDeadline(
      stopWorkers(selected),
      configuration.shutdownDeadlineMs,
      timers
    ).then(
      () => {
        state = "stopped";
        emit({ state, purposes: configuration.purposes });
        return true;
      },
      (error) => {
        state = "failed";
        emit({
          state,
          errorCode: error?.code ?? "WORKER_SHUTDOWN_FAILED"
        });
        throw error;
      }
    ).finally(() => {
      stopPromise = null;
    });
    return stopPromise;
  }

  return Object.freeze({
    start,
    stop,
    snapshot() {
      return Object.freeze({
        schema: "sitesourcery.worker-supervisor-state/v1",
        state,
        activation: configuration.activation,
        purposes: configuration.purposes,
        runningPurposes: Object.freeze(
          workers.map(({ purpose }) => purpose)
        ),
        credentials: "redacted"
      });
    }
  });
}
