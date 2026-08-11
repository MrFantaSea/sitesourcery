export const CAPABILITIES_SNAPSHOT_CODES = Object.freeze({
  failed: "capabilities_check_failed",
  timeout: "capabilities_check_timeout"
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

export function createCapabilitiesSnapshot({
  load,
  ttlMs = 1_000,
  timeoutMs = 750,
  now = Date.now,
  timers = globalThis
} = {}) {
  if (typeof load !== "function") {
    throw new TypeError("load is required");
  }
  requireDuration(ttlMs, "ttlMs", 1, 30_000);
  requireDuration(timeoutMs, "timeoutMs", 1, 5_000);
  if (
    typeof now !== "function" ||
    typeof timers?.setTimeout !== "function" ||
    typeof timers?.clearTimeout !== "function"
  ) {
    throw new TypeError("timing boundary is invalid");
  }

  let cached = null;
  let inFlight = null;

  function fresh(entry, at = now()) {
    return Math.max(0, Math.floor(at - entry.checkedAt)) <= ttlMs;
  }

  function result(entry) {
    return entry.ok
      ? Object.freeze({ ok: true, value: entry.value })
      : Object.freeze({ ok: false, code: entry.code });
  }

  function start() {
    const startedAt = now();
    const run = {};
    run.promise = Promise.resolve()
      .then(load)
      .then(
        (value) => {
          const checkedAt = now();
          const timedOut = run.timedOut === true ||
            checkedAt - startedAt >= timeoutMs;
          cached = timedOut
            ? {
                ok: false,
                code: CAPABILITIES_SNAPSHOT_CODES.timeout,
                checkedAt
              }
            : { ok: true, value, checkedAt };
          return cached;
        },
        () => {
          const checkedAt = now();
          const timedOut = run.timedOut === true ||
            checkedAt - startedAt >= timeoutMs;
          cached = {
            ok: false,
            code: timedOut
              ? CAPABILITIES_SNAPSHOT_CODES.timeout
              : CAPABILITIES_SNAPSHOT_CODES.failed,
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
    if (cached && fresh(cached, at)) {
      return result(cached);
    }
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
    run.timedOut = true;
    return Object.freeze({
      ok: false,
      code: CAPABILITIES_SNAPSHOT_CODES.timeout
    });
  }

  return Object.freeze({ read });
}
