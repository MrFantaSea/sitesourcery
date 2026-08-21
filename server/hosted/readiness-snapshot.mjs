export const READINESS_CODES = Object.freeze({
  ready: "ready",
  notReady: "dependency_not_ready",
  failed: "dependency_check_failed",
  timeout: "dependency_check_timeout",
  stale: "readiness_snapshot_stale"
});

function requireDuration(value, name, minimum, maximum) {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${name} is invalid`);
  }
}

function latencyBucket(durationMs, timedOut = false) {
  if (timedOut) return "timeout";
  if (durationMs < 25) return "under_25_ms";
  if (durationMs < 100) return "25_to_99_ms";
  if (durationMs < 250) return "100_to_249_ms";
  if (durationMs < 1_000) return "250_to_999_ms";
  return "one_second_or_more";
}

export function createReadinessSnapshot({
  check,
  ttlMs = 1_000,
  timeoutMs = 750,
  staleAfterMs = 5_000,
  now = Date.now,
  timers = globalThis
}) {
  if (typeof check !== "function") {
    throw new TypeError("check is required");
  }
  requireDuration(ttlMs, "ttlMs", 1, 30_000);
  requireDuration(timeoutMs, "timeoutMs", 1, 12_000);
  requireDuration(
    staleAfterMs,
    "staleAfterMs",
    ttlMs + 1,
    120_000
  );
  if (
    typeof now !== "function" ||
    typeof timers?.setTimeout !== "function" ||
    typeof timers?.clearTimeout !== "function"
  ) {
    throw new TypeError("timing boundary is invalid");
  }

  let cached = null;
  let inFlight = null;

  function age(entry, at = now()) {
    return Math.max(0, Math.floor(at - entry.checkedAt));
  }

  function result(entry, at = now()) {
    return Object.freeze({
      ready: entry.ready,
      state: entry.state,
      code: entry.code,
      ageMs: age(entry, at),
      latencyBucket: entry.latencyBucket
    });
  }

  function start() {
    const startedAt = now();
    const run = {};
    run.promise = Promise.resolve()
      .then(check)
      .then(
        (value) => {
          const checkedAt = now();
          const timedOut =
            checkedAt - startedAt >= timeoutMs;
          const ready =
            !timedOut && value?.ready === true;
          cached = {
            ready,
            state: timedOut
              ? "timeout"
              : ready
                ? "ready"
                : "not_ready",
            code: timedOut
              ? READINESS_CODES.timeout
              : ready
                ? READINESS_CODES.ready
                : READINESS_CODES.notReady,
            latencyBucket: latencyBucket(
              checkedAt - startedAt,
              timedOut
            ),
            checkedAt
          };
          return cached;
        },
        () => {
          const checkedAt = now();
          const timedOut =
            checkedAt - startedAt >= timeoutMs;
          cached = {
            ready: false,
            state: timedOut ? "timeout" : "failed",
            code: timedOut
              ? READINESS_CODES.timeout
              : READINESS_CODES.failed,
            latencyBucket: latencyBucket(
              checkedAt - startedAt,
              timedOut
            ),
            checkedAt
          };
          return cached;
        }
      )
      .finally(() => {
        if (inFlight === run) inFlight = null;
      });
    run.startedAt = startedAt;
    inFlight = run;
    return run;
  }

  async function read() {
    const at = now();
    if (cached && age(cached, at) <= ttlMs) {
      return result(cached, at);
    }

    const previous = cached;
    const run = inFlight ?? start();
    const remainingMs = Math.max(
      0,
      timeoutMs - (now() - run.startedAt)
    );
    let timer = null;
    const settled = await Promise.race([
      run.promise.then((entry) => ({ entry })),
      new Promise((resolve) => {
        timer = timers.setTimeout(
          () => resolve(null),
          remainingMs
        );
      })
    ]);
    if (timer !== null) timers.clearTimeout(timer);
    if (settled) return result(settled.entry);

    const timedOutAt = now();
    if (
      previous &&
      age(previous, timedOutAt) <= staleAfterMs
    ) {
      return result({
        ready: false,
        state: "stale",
        code: READINESS_CODES.stale,
        latencyBucket: "timeout",
        checkedAt: previous.checkedAt
      }, timedOutAt);
    }
    return result({
      ready: false,
      state: "timeout",
      code: READINESS_CODES.timeout,
      latencyBucket: "timeout",
      checkedAt: timedOutAt
    }, timedOutAt);
  }

  return Object.freeze({ read });
}
