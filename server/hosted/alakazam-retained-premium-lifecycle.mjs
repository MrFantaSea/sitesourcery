import { createHash, randomUUID } from "node:crypto";

import { invariant } from "./errors.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const DAY_MS = 24 * 60 * 60 * 1000;

function defaultWait(milliseconds, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    timer.unref?.();
    signal.addEventListener("abort", finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

function exactIso(value, field) {
  const selected = value instanceof Date
    ? value.toISOString()
    : String(value ?? "");
  invariant(
    Number.isFinite(Date.parse(selected)) &&
      new Date(Date.parse(selected)).toISOString() === selected,
    "ALAKAZAM_RETAINED_LIFECYCLE_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function exactUuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "ALAKAZAM_RETAINED_LIFECYCLE_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function exactPositiveInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "ALAKAZAM_RETAINED_LIFECYCLE_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function exactDigest(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "ALAKAZAM_RETAINED_LIFECYCLE_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function exactKeys(value, expected, field) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "ALAKAZAM_RETAINED_LIFECYCLE_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function deterministicUuid(label, ...parts) {
  const bytes = createHash("sha256")
    .update([label, ...parts].join("\u0000"), "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function exactScope(candidate, field) {
  return Object.freeze({
    tenantId: exactUuid(candidate.tenantId, `${field}.tenantId`),
    projectId: exactUuid(candidate.projectId, `${field}.projectId`),
    subscriptionId: exactUuid(
      candidate.subscriptionId,
      `${field}.subscriptionId`
    )
  });
}

function exactGraceCandidate(value, observedAt) {
  const candidate = exactKeys(
    value,
    [
      "firstFailedAt",
      "graceEndsAt",
      "kind",
      "projectId",
      "providerFactsDigest",
      "providerObservedAt",
      "revision",
      "sourceEventId",
      "sourceEventKind",
      "sourceEventRevision",
      "sourceStripeEventRowId",
      "status",
      "subscriptionId",
      "tenantId"
    ],
    "graceCandidate"
  );
  const scope = exactScope(candidate, "graceCandidate");
  const firstFailedAt = exactIso(
    candidate.firstFailedAt,
    "graceCandidate.firstFailedAt"
  );
  const graceEndsAt = exactIso(
    candidate.graceEndsAt,
    "graceCandidate.graceEndsAt"
  );
  const providerObservedAt = exactIso(
    candidate.providerObservedAt,
    "graceCandidate.providerObservedAt"
  );
  const revision = exactPositiveInteger(
    candidate.revision,
    "graceCandidate.revision"
  );
  invariant(
    candidate.kind === "payment_grace_expired" &&
      candidate.status === "suspended" &&
      candidate.sourceEventKind === "suspended" &&
      candidate.sourceEventRevision === revision &&
      Date.parse(graceEndsAt) ===
        Date.parse(firstFailedAt) + 7 * DAY_MS &&
      Date.parse(observedAt) >= Date.parse(graceEndsAt) &&
      Date.parse(providerObservedAt) >= Date.parse(graceEndsAt),
    "ALAKAZAM_RETAINED_LIFECYCLE_FENCE_FAILED",
    "A retained exit requires the exact completed seven-day grace transition.",
    { status: 409 }
  );
  return Object.freeze({
    ...scope,
    firstFailedAt,
    graceEndsAt,
    providerObservedAt,
    providerFactsDigest: exactDigest(
      candidate.providerFactsDigest,
      "graceCandidate.providerFactsDigest"
    ),
    revision,
    sourceEventId: exactUuid(
      candidate.sourceEventId,
      "graceCandidate.sourceEventId"
    ),
    sourceStripeEventRowId: exactUuid(
      candidate.sourceStripeEventRowId,
      "graceCandidate.sourceStripeEventRowId"
    )
  });
}

function exactRetentionCandidate(value, observedAt) {
  const candidate = exactKeys(
    value,
    [
      "endsAt",
      "kind",
      "projectId",
      "retentionWindowId",
      "state",
      "subscriptionId",
      "tenantId"
    ],
    "retentionCandidate"
  );
  const scope = exactScope(candidate, "retentionCandidate");
  const endsAt = exactIso(
    candidate.endsAt,
    "retentionCandidate.endsAt"
  );
  invariant(
    candidate.kind === "retained_exit_expiry" &&
      candidate.state === "active" &&
      Date.parse(observedAt) >= Date.parse(endsAt),
    "ALAKAZAM_RETAINED_LIFECYCLE_FENCE_FAILED",
    "Premium data may be purged only after retained-exit expiry.",
    { status: 409 }
  );
  return Object.freeze({
    ...scope,
    endsAt,
    retentionWindowId: exactUuid(
      candidate.retentionWindowId,
      "retentionCandidate.retentionWindowId"
    )
  });
}

function exactCancellationCandidate(value, observedAt) {
  const candidate = exactKeys(
    value,
    [
      "cancellationId",
      "cancellationState",
      "effectiveConfirmedAt",
      "exportGrantId",
      "exportState",
      "kind",
      "paidThroughAt",
      "projectId",
      "providerEffectCertainty",
      "providerFactsDigest",
      "providerObservedAt",
      "sourceEventId",
      "sourceEventKind",
      "sourceEventRevision",
      "sourceStripeEventRowId",
      "subscriptionId",
      "subscriptionRevision",
      "subscriptionStatus",
      "tenantId"
    ],
    "cancellationCandidate"
  );
  const scope = exactScope(candidate, "cancellationCandidate");
  const paidThroughAt = exactIso(
    candidate.paidThroughAt,
    "cancellationCandidate.paidThroughAt"
  );
  const effectiveConfirmedAt = exactIso(
    candidate.effectiveConfirmedAt,
    "cancellationCandidate.effectiveConfirmedAt"
  );
  const providerObservedAt = exactIso(
    candidate.providerObservedAt,
    "cancellationCandidate.providerObservedAt"
  );
  const subscriptionRevision = exactPositiveInteger(
    candidate.subscriptionRevision,
    "cancellationCandidate.subscriptionRevision"
  );
  invariant(
    candidate.kind === "period_end_cancellation" &&
      candidate.cancellationState === "effective" &&
      candidate.providerEffectCertainty === "confirmed" &&
      ["cancelled", "ended"].includes(
        candidate.subscriptionStatus
      ) &&
      candidate.sourceEventKind === candidate.subscriptionStatus &&
      candidate.sourceEventRevision === subscriptionRevision &&
      candidate.exportState === "available" &&
      Date.parse(observedAt) >= Date.parse(paidThroughAt) &&
      Date.parse(effectiveConfirmedAt) >= Date.parse(paidThroughAt),
    "ALAKAZAM_RETAINED_LIFECYCLE_FENCE_FAILED",
    "A cancellation retained exit requires confirmed cancellation and its exact export grant.",
    { status: 409 }
  );
  return Object.freeze({
    ...scope,
    cancellationId: exactUuid(
      candidate.cancellationId,
      "cancellationCandidate.cancellationId"
    ),
    exportGrantId: exactUuid(
      candidate.exportGrantId,
      "cancellationCandidate.exportGrantId"
    ),
    paidThroughAt,
    effectiveConfirmedAt,
    providerObservedAt,
    providerFactsDigest: exactDigest(
      candidate.providerFactsDigest,
      "cancellationCandidate.providerFactsDigest"
    ),
    sourceEventId: exactUuid(
      candidate.sourceEventId,
      "cancellationCandidate.sourceEventId"
    ),
    sourceStripeEventRowId: exactUuid(
      candidate.sourceStripeEventRowId,
      "cancellationCandidate.sourceStripeEventRowId"
    ),
    subscriptionRevision,
    subscriptionStatus: candidate.subscriptionStatus
  });
}

function validatePorts(repository, clock) {
  const methods = [
    "applyRetainedExitPolicy",
    "findConfirmedCancellationRetainedExit",
    "findNextGraceRetainedExit",
    "findNextRetentionExpiry",
    "purgeExpired"
  ];
  invariant(
    repository &&
      methods.every(
        (method) => typeof repository[method] === "function"
      ) &&
      clock &&
      typeof clock.now === "function",
    "ALAKAZAM_RETAINED_LIFECYCLE_INVALID",
    "The retained Alakazam lifecycle ports are incomplete.",
    { status: 500 }
  );
  return { repository, clock };
}

export function createAlakazamRetainedPremiumLifecycle({
  repository,
  clock,
  workerId = `alakazam-retained-lifecycle-${randomUUID()}`,
  enabled = false,
  intervalMs = 5_000,
  wait = defaultWait,
  log = () => {}
} = {}) {
  const ports = validatePorts(repository, clock);
  invariant(
    typeof workerId === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/u.test(workerId) &&
      typeof enabled === "boolean" &&
      Number.isSafeInteger(intervalMs) &&
      intervalMs >= 100 &&
      intervalMs <= 300_000 &&
      typeof wait === "function" &&
      typeof log === "function",
    "ALAKAZAM_RETAINED_LIFECYCLE_INVALID",
    "The retained Alakazam lifecycle worker configuration is invalid.",
    { status: 500 }
  );

  let controller = null;
  let loopPromise = null;
  let state = enabled ? "stopped" : "held";
  let cycles = 0;
  let lastStatus = null;
  let lastErrorCode = null;

  function now() {
    return exactIso(ports.clock.now(), "clock.now");
  }

  function emit(entry) {
    try {
      log(Object.freeze({
        event: "sitesourcery.worker.alakazam-retained-lifecycle",
        workerId,
        ...entry
      }));
    } catch {
      // Observability cannot change lifecycle authority.
    }
  }

  async function runGraceDeadlineOnce() {
    const observedAt = now();
    const selected =
      await ports.repository.findNextGraceRetainedExit({
        observedAt
      });
    if (selected === null) {
      return Object.freeze({ status: "idle" });
    }
    const candidate = exactGraceCandidate(selected, observedAt);
    const windowId = deterministicUuid(
      "alakazam-retained-exit",
      candidate.tenantId,
      candidate.subscriptionId,
      candidate.graceEndsAt,
      candidate.sourceEventId
    );
    const window = await ports.repository.applyRetainedExitPolicy({
      tenantId: candidate.tenantId,
      projectId: candidate.projectId,
      subscriptionId: candidate.subscriptionId,
      windowId,
      observedAt
    });
    return Object.freeze({
      status: "retained_exit_applied",
      source: "payment_grace_expired",
      subscriptionId: candidate.subscriptionId,
      windowId,
      window
    });
  }

  async function runRetentionExpiryOnce() {
    const observedAt = now();
    const selected =
      await ports.repository.findNextRetentionExpiry({
        observedAt
      });
    if (selected === null) {
      return Object.freeze({ status: "idle" });
    }
    const candidate = exactRetentionCandidate(
      selected,
      observedAt
    );
    const receiptId = deterministicUuid(
      "alakazam-retained-purge",
      candidate.tenantId,
      candidate.subscriptionId,
      candidate.retentionWindowId,
      candidate.endsAt
    );
    const receipt = await ports.repository.purgeExpired({
      tenantId: candidate.tenantId,
      projectId: candidate.projectId,
      subscriptionId: candidate.subscriptionId,
      receiptId,
      observedAt
    });
    return Object.freeze({
      status: "retained_exit_purged",
      source: "retained_exit_expiry",
      subscriptionId: candidate.subscriptionId,
      receiptId,
      receipt
    });
  }

  async function applyCancellationConfirmation(value) {
    const input = exactKeys(
      value,
      ["projectId", "subscriptionId", "tenantId"],
      "cancellationConfirmation"
    );
    const scope = exactScope(input, "cancellationConfirmation");
    const observedAt = now();
    const selected =
      await ports.repository.findConfirmedCancellationRetainedExit({
        ...scope,
        observedAt
      });
    invariant(
      selected !== null,
      "ALAKAZAM_RETAINED_LIFECYCLE_FENCE_FAILED",
      "No confirmed cancellation export authority exists.",
      { status: 409 }
    );
    const candidate = exactCancellationCandidate(
      selected,
      observedAt
    );
    invariant(
      candidate.tenantId === scope.tenantId &&
        candidate.projectId === scope.projectId &&
        candidate.subscriptionId === scope.subscriptionId,
      "ALAKAZAM_RETAINED_LIFECYCLE_FENCE_FAILED",
      "The confirmed cancellation authority changed scope.",
      { status: 409 }
    );
    const windowId = deterministicUuid(
      "alakazam-retained-exit",
      candidate.tenantId,
      candidate.subscriptionId,
      candidate.paidThroughAt,
      candidate.sourceEventId
    );
    const window = await ports.repository.applyRetainedExitPolicy({
      tenantId: candidate.tenantId,
      projectId: candidate.projectId,
      subscriptionId: candidate.subscriptionId,
      windowId,
      observedAt
    });
    return Object.freeze({
      status: "retained_exit_applied",
      source: "period_end_cancellation",
      subscriptionId: candidate.subscriptionId,
      windowId,
      exportEvidence: Object.freeze({
        cancellationId: candidate.cancellationId,
        exportGrantId: candidate.exportGrantId,
        paidThroughAt: candidate.paidThroughAt,
        providerFactsDigest: candidate.providerFactsDigest,
        providerObservedAt: candidate.providerObservedAt
      }),
      window
    });
  }

  async function runOnce() {
    const grace = await runGraceDeadlineOnce();
    const retention = await runRetentionExpiryOnce();
    return Object.freeze({
      status:
        grace.status === "idle" && retention.status === "idle"
          ? "idle"
          : "processed",
      grace,
      retention
    });
  }

  async function loop(signal) {
    state = "running";
    emit({ state });
    try {
      while (!signal.aborted) {
        try {
          const result = await runOnce();
          cycles += 1;
          lastStatus = result.status;
          lastErrorCode = null;
          emit({ state, cycle: cycles, resultStatus: lastStatus });
        } catch (error) {
          cycles += 1;
          lastStatus = "error";
          lastErrorCode = String(
            error?.code ?? "ALAKAZAM_RETAINED_LIFECYCLE_CYCLE_FAILED"
          ).slice(0, 128);
          emit({ state, cycle: cycles, errorCode: lastErrorCode });
        }
        if (!signal.aborted) await wait(intervalMs, signal);
      }
    } finally {
      state = "stopped";
      emit({ state });
    }
  }

  return Object.freeze({
    kind: "alakazam-retained-premium-lifecycle",
    runGraceDeadlineOnce,
    runRetentionExpiryOnce,
    applyCancellationConfirmation,
    runOnce,
    start({ signal = null } = {}) {
      if (!enabled || loopPromise) return false;
      controller = new AbortController();
      if (signal) {
        invariant(
          typeof signal.addEventListener === "function" &&
            typeof signal.aborted === "boolean",
          "ALAKAZAM_RETAINED_LIFECYCLE_INVALID",
          "The retained lifecycle shutdown signal is invalid.",
          { status: 500 }
        );
        if (signal.aborted) controller.abort();
        else signal.addEventListener(
          "abort",
          () => controller?.abort(),
          { once: true }
        );
      }
      loopPromise = loop(controller.signal).finally(() => {
        controller = null;
        loopPromise = null;
      });
      return true;
    },
    async stop() {
      controller?.abort();
      await (loopPromise ?? Promise.resolve());
    },
    snapshot() {
      return Object.freeze({
        state,
        enabled,
        cycles,
        lastStatus,
        lastErrorCode
      });
    }
  });
}
