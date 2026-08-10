import assert from "node:assert/strict";
import test from "node:test";

import {
  createAlakazamRetainedPremiumLifecycle
} from "../alakazam-retained-premium-lifecycle.mjs";

const IDS = Object.freeze({
  tenantId: "10000000-0000-4000-8000-000000000001",
  projectId: "10000000-0000-4000-8000-000000000002",
  subscriptionId: "10000000-0000-4000-8000-000000000003",
  sourceEventId: "10000000-0000-4000-8000-000000000004",
  stripeEventRowId: "10000000-0000-4000-8000-000000000005",
  retentionWindowId: "10000000-0000-4000-8000-000000000006",
  cancellationId: "10000000-0000-4000-8000-000000000007",
  exportGrantId: "10000000-0000-4000-8000-000000000008"
});
const FIRST_FAILED_AT = "2026-08-01T12:00:00.000Z";
const GRACE_ENDS_AT = "2026-08-08T12:00:00.000Z";
const NOW = "2026-08-09T12:00:00.000Z";
const DIGEST = "a".repeat(64);

function graceCandidate(overrides = {}) {
  return {
    kind: "payment_grace_expired",
    tenantId: IDS.tenantId,
    projectId: IDS.projectId,
    subscriptionId: IDS.subscriptionId,
    status: "suspended",
    revision: 8,
    firstFailedAt: FIRST_FAILED_AT,
    graceEndsAt: GRACE_ENDS_AT,
    providerFactsDigest: DIGEST,
    providerObservedAt: "2026-08-08T12:00:01.000Z",
    sourceEventId: IDS.sourceEventId,
    sourceEventKind: "suspended",
    sourceEventRevision: 8,
    sourceStripeEventRowId: IDS.stripeEventRowId,
    ...overrides
  };
}

function retentionCandidate(overrides = {}) {
  return {
    kind: "retained_exit_expiry",
    tenantId: IDS.tenantId,
    projectId: IDS.projectId,
    subscriptionId: IDS.subscriptionId,
    retentionWindowId: IDS.retentionWindowId,
    state: "active",
    endsAt: "2026-08-09T11:59:59.000Z",
    ...overrides
  };
}

function cancellationCandidate(overrides = {}) {
  return {
    kind: "period_end_cancellation",
    tenantId: IDS.tenantId,
    projectId: IDS.projectId,
    subscriptionId: IDS.subscriptionId,
    subscriptionStatus: "ended",
    subscriptionRevision: 9,
    providerFactsDigest: DIGEST,
    providerObservedAt: "2026-08-09T11:59:58.000Z",
    cancellationId: IDS.cancellationId,
    cancellationState: "effective",
    providerEffectCertainty: "confirmed",
    effectiveConfirmedAt: NOW,
    exportGrantId: IDS.exportGrantId,
    exportState: "available",
    paidThroughAt: "2026-08-09T11:59:59.000Z",
    sourceEventId: IDS.sourceEventId,
    sourceEventKind: "ended",
    sourceEventRevision: 9,
    sourceStripeEventRowId: IDS.stripeEventRowId,
    ...overrides
  };
}

function fixture({
  grace = null,
  retention = null,
  cancellation = null,
  enabled = false,
  graceLookupFailures = 0,
  workerOptions = {}
} = {}) {
  const calls = {
    graceLookups: [],
    retentionLookups: [],
    cancellationLookups: [],
    retainedExits: [],
    purges: []
  };
  const repository = {
    async findNextGraceRetainedExit(input) {
      calls.graceLookups.push(structuredClone(input));
      if (graceLookupFailures > 0) {
        graceLookupFailures -= 1;
        const error = new Error("injected lifecycle failure");
        error.code = "DATABASE_UNAVAILABLE";
        throw error;
      }
      return grace === null ? null : structuredClone(grace);
    },
    async findNextRetentionExpiry(input) {
      calls.retentionLookups.push(structuredClone(input));
      return retention === null
        ? null
        : structuredClone(retention);
    },
    async findConfirmedCancellationRetainedExit(input) {
      calls.cancellationLookups.push(structuredClone(input));
      return cancellation === null
        ? null
        : structuredClone(cancellation);
    },
    async applyRetainedExitPolicy(input) {
      calls.retainedExits.push(structuredClone(input));
      return { id: input.windowId, state: "active" };
    },
    async purgeExpired(input) {
      calls.purges.push(structuredClone(input));
      return {
        id: input.receiptId,
        reason: "retained_exit_expiry"
      };
    }
  };
  const lifecycle = createAlakazamRetainedPremiumLifecycle({
    repository,
    clock: { now: () => NOW },
    workerId: "retained-lifecycle-test",
    enabled,
    ...workerOptions
  });
  return { calls, lifecycle };
}

test("the held lifecycle never starts a background mutation loop", () => {
  const { lifecycle } = fixture();
  assert.equal(lifecycle.start(), false);
  assert.deepEqual(lifecycle.snapshot(), {
    state: "held",
    enabled: false,
    intervalMs: 5_000,
    errorBackoffMs: 5_000,
    maximumBackoffMs: 60_000,
    cycles: 0,
    consecutiveErrors: 0,
    lastStatus: null,
    lastErrorCode: null
  });
});

test("retained lifecycle uses bounded error backoff and resets after success", async () => {
  const waits = [];
  const pending = [];
  const { lifecycle } = fixture({
    enabled: true,
    graceLookupFailures: 2,
    workerOptions: {
      intervalMs: 150,
      errorBackoffMs: 100,
      maximumBackoffMs: 175,
      wait(milliseconds, signal) {
        waits.push(milliseconds);
        return new Promise((resolve) => {
          pending.push(() => {
            if (!signal.aborted) resolve();
            else resolve();
          });
        });
      }
    }
  });
  lifecycle.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waits[0], 100);
  pending.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waits[1], 175);
  pending.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waits[2], 150);
  assert.equal(lifecycle.snapshot().consecutiveErrors, 0);
  const stopping = lifecycle.stop();
  pending.shift()();
  await stopping;
});

test("the grace worker applies retained exit only after exact seven-day canonical evidence", async () => {
  const { calls, lifecycle } = fixture({
    grace: graceCandidate()
  });
  const result = await lifecycle.runGraceDeadlineOnce();
  assert.equal(result.status, "retained_exit_applied");
  assert.equal(result.source, "payment_grace_expired");
  assert.equal(calls.retainedExits.length, 1);
  assert.deepEqual(calls.retainedExits[0], {
    tenantId: IDS.tenantId,
    projectId: IDS.projectId,
    subscriptionId: IDS.subscriptionId,
    windowId: result.windowId,
    observedAt: NOW
  });

  const replay = await lifecycle.runGraceDeadlineOnce();
  assert.equal(replay.windowId, result.windowId);
  assert.equal(calls.retainedExits.length, 2);
});

test("the grace worker rejects deadline or provider-evidence drift before mutation", async () => {
  for (const candidate of [
    graceCandidate({
      graceEndsAt: "2026-08-07T12:00:00.000Z"
    }),
    graceCandidate({
      providerObservedAt: "2026-08-08T11:59:59.000Z"
    }),
    graceCandidate({ sourceEventKind: "payment_failed" })
  ]) {
    const { calls, lifecycle } = fixture({ grace: candidate });
    await assert.rejects(
      lifecycle.runGraceDeadlineOnce(),
      { code: "ALAKAZAM_RETAINED_LIFECYCLE_FENCE_FAILED" }
    );
    assert.deepEqual(calls.retainedExits, []);
    assert.deepEqual(calls.purges, []);
  }
});

test("the retention worker calls only the retained-exit expiry purge", async () => {
  const { calls, lifecycle } = fixture({
    retention: retentionCandidate()
  });
  const result = await lifecycle.runRetentionExpiryOnce();
  assert.equal(result.status, "retained_exit_purged");
  assert.equal(result.source, "retained_exit_expiry");
  assert.deepEqual(calls.purges, [
    {
      tenantId: IDS.tenantId,
      projectId: IDS.projectId,
      subscriptionId: IDS.subscriptionId,
      receiptId: result.receiptId,
      observedAt: NOW
    }
  ]);
  assert.deepEqual(calls.retainedExits, []);
});

test("the retention worker refuses early or non-active purge authority", async () => {
  for (const candidate of [
    retentionCandidate({ endsAt: "2026-08-09T12:00:01.000Z" }),
    retentionCandidate({ state: "expired" })
  ]) {
    const { calls, lifecycle } = fixture({ retention: candidate });
    await assert.rejects(
      lifecycle.runRetentionExpiryOnce(),
      { code: "ALAKAZAM_RETAINED_LIFECYCLE_FENCE_FAILED" }
    );
    assert.deepEqual(calls.purges, []);
  }
});

test("the cancellation hook requires effective confirmation and exact export evidence", async () => {
  const { calls, lifecycle } = fixture({
    cancellation: cancellationCandidate()
  });
  const result = await lifecycle.applyCancellationConfirmation({
    tenantId: IDS.tenantId,
    projectId: IDS.projectId,
    subscriptionId: IDS.subscriptionId
  });
  assert.equal(result.source, "period_end_cancellation");
  assert.deepEqual(result.exportEvidence, {
    cancellationId: IDS.cancellationId,
    exportGrantId: IDS.exportGrantId,
    paidThroughAt: "2026-08-09T11:59:59.000Z",
    providerFactsDigest: DIGEST,
    providerObservedAt: "2026-08-09T11:59:58.000Z"
  });
  assert.equal(calls.retainedExits.length, 1);
  assert.deepEqual(calls.purges, []);
});

test("the cancellation hook rejects every unconfirmed or missing-export state", async () => {
  for (const candidate of [
    null,
    cancellationCandidate({ cancellationState: "scheduled" }),
    cancellationCandidate({ providerEffectCertainty: "ambiguous" }),
    cancellationCandidate({ exportState: "expired" }),
    cancellationCandidate({ sourceEventKind: "cancelled" })
  ]) {
    const { calls, lifecycle } = fixture({
      cancellation: candidate
    });
    await assert.rejects(
      lifecycle.applyCancellationConfirmation({
        tenantId: IDS.tenantId,
        projectId: IDS.projectId,
        subscriptionId: IDS.subscriptionId
      }),
      { code: "ALAKAZAM_RETAINED_LIFECYCLE_FENCE_FAILED" }
    );
    assert.deepEqual(calls.retainedExits, []);
    assert.deepEqual(calls.purges, []);
  }
});
