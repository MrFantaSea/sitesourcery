import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createReadinessSnapshot,
  READINESS_CODES
} from "../readiness-snapshot.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("readiness snapshot singleflights concurrent checks and caches within its TTL", async () => {
  let at = 1_000;
  let calls = 0;
  const pending = deferred();
  const snapshot = createReadinessSnapshot({
    check: async () => {
      calls += 1;
      return pending.promise;
    },
    ttlMs: 100,
    timeoutMs: 50,
    staleAfterMs: 500,
    now: () => at
  });

  const reads = Array.from(
    { length: 20 },
    () => snapshot.read()
  );
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve({
    ready: true,
    privateProviderDetail: "must-not-escape"
  });

  const results = await Promise.all(reads);
  assert.equal(calls, 1);
  assert.deepEqual(
    [...new Set(results.map(JSON.stringify))],
    [JSON.stringify({
      ready: true,
      state: "ready",
      code: READINESS_CODES.ready,
      ageMs: 0,
      latencyBucket: "under_25_ms"
    })]
  );
  assert.equal(
    JSON.stringify(results).includes("must-not-escape"),
    false
  );

  assert.equal((await snapshot.read()).ready, true);
  assert.equal(calls, 1);
  at += 101;
  assert.equal((await snapshot.read()).ready, true);
  assert.equal(calls, 2);
});

test("readiness snapshot exposes fixed not-ready and failure codes only", async () => {
  const at = 10_000;
  const notReady = createReadinessSnapshot({
    check: async () => ({
      ready: false,
      reason: "customer@example.test"
    }),
    now: () => at
  });
  assert.deepEqual(await notReady.read(), {
    ready: false,
    state: "not_ready",
    code: READINESS_CODES.notReady,
    ageMs: 0,
    latencyBucket: "under_25_ms"
  });

  const failed = createReadinessSnapshot({
    check: async () => {
      throw new Error("sk_live_must_not_escape");
    },
    now: () => at
  });
  const result = await failed.read();
  assert.deepEqual(result, {
    ready: false,
    state: "failed",
    code: READINESS_CODES.failed,
    ageMs: 0,
    latencyBucket: "under_25_ms"
  });
  assert.equal(
    JSON.stringify(result).includes("sk_live"),
    false
  );
});

test("readiness snapshot bounds hung checks without amplification", async () => {
  let calls = 0;
  const snapshot = createReadinessSnapshot({
    check: async () => {
      calls += 1;
      return new Promise(() => {});
    },
    ttlMs: 5,
    timeoutMs: 10,
    staleAfterMs: 50
  });

  const results = await Promise.all(
    Array.from({ length: 12 }, () => snapshot.read())
  );
  assert.equal(calls, 1);
  assert.equal(
    results.every((result) =>
      result.ready === false &&
      result.state === "timeout" &&
      result.code === READINESS_CODES.timeout &&
      result.latencyBucket === "timeout"
    ),
    true
  );

  await snapshot.read();
  assert.equal(calls, 1);
});

test("readiness snapshot labels an expired prior result stale when refresh hangs", async () => {
  let at = 20_000;
  let calls = 0;
  const snapshot = createReadinessSnapshot({
    check: async () => {
      calls += 1;
      if (calls === 1) return { ready: true };
      return new Promise(() => {});
    },
    ttlMs: 5,
    timeoutMs: 10,
    staleAfterMs: 50,
    now: () => at
  });

  assert.equal((await snapshot.read()).ready, true);
  at += 6;
  const result = await snapshot.read();
  assert.deepEqual(result, {
    ready: false,
    state: "stale",
    code: READINESS_CODES.stale,
    ageMs: 6,
    latencyBucket: "timeout"
  });
  assert.equal(calls, 2);
});

test("readiness snapshot has no direct database or provider imports", async () => {
  const source = await readFile(
    new URL("../readiness-snapshot.mjs", import.meta.url),
    "utf8"
  );
  assert.equal(/^import\s/m.test(source), false);
  assert.equal(/stripe|resend|postgres/i.test(source), false);
});

test("readiness snapshot rejects unbounded timing policies", () => {
  const check = async () => ({ ready: true });
  assert.throws(
    () => createReadinessSnapshot({
      check,
      ttlMs: 30_001
    }),
    /ttlMs is invalid/u
  );
  assert.throws(
    () => createReadinessSnapshot({
      check,
      timeoutMs: 5_001
    }),
    /timeoutMs is invalid/u
  );
  assert.throws(
    () => createReadinessSnapshot({
      check,
      staleAfterMs: 120_001
    }),
    /staleAfterMs is invalid/u
  );
});
