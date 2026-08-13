import assert from "node:assert/strict";
import test from "node:test";

import { createCareLifecycleExecutor } from
  "../care-lifecycle-worker-postgres.mjs";

const DIGEST = "a".repeat(64);
const claim = Object.freeze({
  action: "advance_period",
  organizationId: "10000000-0000-4000-8000-000000000001",
  projectId: "20000000-0000-4000-8000-000000000001",
  contractId: "30000000-0000-4000-8000-000000000001",
  periodId: "40000000-0000-4000-8000-000000000001",
  nextPeriodId: "50000000-0000-4000-8000-000000000001",
  currentPeriod: Object.freeze({
    revision: 1,
    providerScopeDigest: DIGEST,
    endsOn: "2026-09-01"
  }),
  nextPeriod: Object.freeze({
    startsOn: "2026-09-01",
    endsOn: "2026-10-01",
    includedUnits: 4,
    carriedUnits: 2,
    providerPeriodKey:
      "care.period.30000000-0000-4000-8000-000000000001.2026-09-01"
  })
});

test("Care lifecycle closes and opens with deterministic one-cycle rollover", async () => {
  const calls = [];
  const repository = {
    async readiness() { return { ready: true, verified: true }; },
    async closePeriod(input) {
      calls.push(["close", input]);
      return { id: input.periodId };
    },
    async openPeriod(input) {
      calls.push(["open", input]);
      return { id: input.periodId };
    }
  };
  const executor = createCareLifecycleExecutor({ careRepository: repository });
  const result = await executor.execute(claim);
  assert.equal(result.receiptKind, "period_advanced");
  assert.equal(result.result.carriedUnits, 2);
  assert.deepEqual(calls.map(([kind]) => kind), ["close", "open"]);
  assert.equal(calls[0][1].recordedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(calls[1][1].carriedFromPeriodId, claim.periodId);
  assert.equal(calls[1][1].providerEffects, false);
});

test("zero rollover never retains a prior-period authority", async () => {
  let opened;
  const executor = createCareLifecycleExecutor({
    careRepository: {
      async readiness() { return { ready: true, verified: true }; },
      async closePeriod() {},
      async openPeriod(input) {
        opened = input;
        return { id: input.periodId };
      }
    }
  });
  await executor.execute({
    ...claim,
    nextPeriod: { ...claim.nextPeriod, carriedUnits: 0 }
  });
  assert.equal(opened.carriedFromPeriodId, null);
});
