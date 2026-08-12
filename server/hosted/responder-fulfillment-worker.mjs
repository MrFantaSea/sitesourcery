import { randomUUID } from "node:crypto";

import { invariant } from "./errors.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const MESSAGE_KINDS = new Set([
  "missed_call_ack",
  "human_handoff_ack"
]);

function configurationError(message) {
  const error = new Error(message);
  error.name = "ResponderFulfillmentWorkerConfigurationError";
  error.code =
    "RESPONDER_FULFILLMENT_WORKER_CONFIGURATION_INVALID";
  return error;
}

function integer(value, field, minimum, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw configurationError(`${field} is outside its bounded range.`);
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
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw configurationError(`${name} must be a positive integer.`);
  }
  return integer(Number(value), name, minimum, maximum);
}

function iso(value, field) {
  const selected = value instanceof Date
    ? value.toISOString()
    : String(value ?? "");
  invariant(
    Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "RESPONDER_FULFILLMENT_WORKER_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "RESPONDER_FULFILLMENT_WORKER_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "RESPONDER_FULFILLMENT_WORKER_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function safeId(value, field) {
  invariant(
    typeof value === "string" && SAFE_ID.test(value),
    "RESPONDER_FULFILLMENT_WORKER_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function safeFailureCode(error) {
  return typeof error?.code === "string" &&
    SAFE_ERROR_CODE.test(error.code)
    ? error.code
    : "RESPONDER_FULFILLMENT_UNCLASSIFIED_FAILURE";
}

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

function shutdownSignal(value) {
  invariant(
    value === null ||
      (
        typeof value === "object" &&
        typeof value.aborted === "boolean" &&
        typeof value.addEventListener === "function"
      ),
    "RESPONDER_FULFILLMENT_WORKER_INVALID",
    "Responder fulfillment shutdown signal is invalid.",
    { status: 500 }
  );
  return value;
}

function claim(value, workerId) {
  if (value?.status === "idle") {
    return Object.freeze({ status: "idle" });
  }
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.status === "claimed" &&
      value.workerId === workerId &&
      Number.isSafeInteger(value.attemptCount) &&
      value.attemptCount >= 1 &&
      value.attemptCount <= 100 &&
      MESSAGE_KINDS.has(value.messageKind),
    "RESPONDER_FULFILLMENT_WORKER_INVALID",
    "The Responder fulfillment claim is invalid.",
    { status: 500 }
  );
  return Object.freeze({
    status: "claimed",
    operationId: uuid(value.operationId, "Operation ID"),
    commandId: safeId(value.commandId, "Command ID"),
    organizationId: uuid(value.organizationId, "Organization ID"),
    projectId: uuid(value.projectId, "Project ID"),
    interactionId: uuid(value.interactionId, "Interaction ID"),
    contactAuthorityId: uuid(
      value.contactAuthorityId,
      "Contact authority ID"
    ),
    routeDigest: sha256(value.routeDigest, "Route digest"),
    contentDigest: sha256(value.contentDigest, "Content digest"),
    messageKind: value.messageKind,
    idempotencyKey: safeId(
      value.idempotencyKey,
      "Provider idempotency key"
    ),
    attemptCount: value.attemptCount,
    workerId
  });
}

function acceptedReceipt(value, selectedClaim) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.status === "accepted" &&
      value.idempotencyKey === selectedClaim.idempotencyKey &&
      typeof value.provider === "string" &&
      /^[a-z][a-z0-9_-]{2,63}$/u.test(value.provider),
    "RESPONDER_FULFILLMENT_RECEIPT_INVALID",
    "The Responder fulfillment provider receipt is invalid.",
    { status: 502 }
  );
  return Object.freeze({
    status: "accepted",
    provider: value.provider,
    idempotencyKey: value.idempotencyKey,
    providerReceiptDigest: sha256(
      value.providerReceiptDigest,
      "Provider receipt digest"
    ),
    acceptedAt: iso(value.acceptedAt, "Provider acceptance time")
  });
}

function validatePorts(repository, fulfillmentPort, clock, enabled) {
  const providerReady = enabled
    ? fulfillmentPort?.kind === "responder-fulfillment-provider" &&
      fulfillmentPort.providerEffects === true &&
      fulfillmentPort.idempotency === "provider-unsupported" &&
      fulfillmentPort.effectCertainty === "receipt-or-manual-review"
    : fulfillmentPort?.kind === "responder-fulfillment-held-provider" &&
      fulfillmentPort.providerEffects === false &&
      fulfillmentPort.idempotency === "none" &&
      fulfillmentPort.effectCertainty === "none";
  invariant(
    repository &&
      [
        "claimNextDelivery",
        "recordDeliveryAccepted",
        "recordDeliveryManualReview",
        "recordDeliveryRetry"
      ].every((name) => typeof repository[name] === "function") &&
      providerReady &&
      typeof fulfillmentPort.sendMessage === "function" &&
      typeof clock?.now === "function",
    "RESPONDER_FULFILLMENT_WORKER_INVALID",
    "Responder fulfillment requires exact repository, provider, and clock ports.",
    { status: 500 }
  );
  return { repository, fulfillmentPort, clock };
}

export function createResponderFulfillmentWorker({
  repository,
  fulfillmentPort,
  clock,
  enabled = false,
  workerId = `responder-fulfillment-${randomUUID()}`,
  leaseMs = 120_000,
  intervalMs = 5_000,
  errorBackoffMs = 5_000,
  maximumBackoffMs = 60_000,
  wait = defaultWait,
  log = () => {}
} = {}) {
  const ports = validatePorts(
    repository,
    fulfillmentPort,
    clock,
    enabled
  );
  invariant(
    typeof enabled === "boolean" &&
      typeof workerId === "string" &&
      /^responder-fulfillment-[A-Za-z0-9.-]{8,160}$/u.test(workerId) &&
      typeof wait === "function" &&
      typeof log === "function",
    "RESPONDER_FULFILLMENT_WORKER_INVALID",
    "Responder fulfillment worker configuration is invalid.",
    { status: 500 }
  );
  integer(leaseMs, "Lease duration", 30_000, 600_000);
  integer(intervalMs, "Loop interval", 100, 300_000);
  integer(errorBackoffMs, "Error backoff", 100, 300_000);
  integer(
    maximumBackoffMs,
    "Maximum backoff",
    errorBackoffMs,
    900_000
  );

  let controller = null;
  let loopPromise = null;
  let unlinkExternalAbort = null;
  let state = enabled ? "stopped" : "held";
  let cycles = 0;
  let consecutiveErrors = 0;
  let lastStatus = null;
  let lastErrorCode = null;

  function now() {
    return iso(ports.clock.now(), "Responder fulfillment clock");
  }

  function emit(entry) {
    try {
      log(Object.freeze({
        event: "sitesourcery.worker.responder-fulfillment",
        workerId,
        ...entry
      }));
    } catch {
      // Observability cannot change delivery authority or queue state.
    }
  }

  async function runOnce({ signal = null } = {}) {
    shutdownSignal(signal);
    if (!enabled) return Object.freeze({ status: "held" });
    const claimedAt = now();
    const selected = claim(
      await ports.repository.claimNextDelivery({
        workerId,
        claimedAt,
        leaseExpiresAt: new Date(
          Date.parse(claimedAt) + leaseMs
        ).toISOString()
      }),
      workerId
    );
    if (selected.status === "idle") return selected;

    let providerAccepted = false;
    try {
      const receipt = acceptedReceipt(
        await ports.fulfillmentPort.sendMessage({
          schema: "sitesourcery.responder-fulfillment-request/v1",
          operationId: selected.operationId,
          commandId: selected.commandId,
          organizationId: selected.organizationId,
          projectId: selected.projectId,
          interactionId: selected.interactionId,
          contactAuthorityId: selected.contactAuthorityId,
          messageKind: selected.messageKind,
          routeDigest: selected.routeDigest,
          contentDigest: selected.contentDigest,
          idempotencyKey: selected.idempotencyKey,
          signal
        }),
        selected
      );
      providerAccepted = true;
      const result = await ports.repository.recordDeliveryAccepted({
        operationId: selected.operationId,
        workerId,
        attemptCount: selected.attemptCount,
        provider: receipt.provider,
        providerReceiptDigest: receipt.providerReceiptDigest,
        acceptedAt: receipt.acceptedAt
      });
      invariant(
        result?.status === "accepted" || result?.status === "replay",
        "RESPONDER_FULFILLMENT_WORKER_INVALID",
        "The accepted Responder delivery was not durably recorded.",
        { status: 500 }
      );
      return Object.freeze({
        status: result.status,
        operationId: selected.operationId
      });
    } catch (error) {
      if (providerAccepted) throw error;
      const failureCode = safeFailureCode(error);
      const failedAt = now();
      if (
        error?.deliveryDisposition === "retryable" &&
        error?.providerEffectCertainty === "none"
      ) {
        const result = await ports.repository.recordDeliveryRetry({
          operationId: selected.operationId,
          workerId,
          attemptCount: selected.attemptCount,
          failureCode,
          failedAt
        });
        invariant(
          result?.status === "retry_scheduled" ||
            result?.status === "manual_review",
          "RESPONDER_FULFILLMENT_WORKER_INVALID",
          "Responder retry state is invalid.",
          { status: 500 }
        );
        return Object.freeze({
          status: result.status,
          operationId: selected.operationId,
          failureCode
        });
      }
      const result = await ports.repository.recordDeliveryManualReview({
        operationId: selected.operationId,
        workerId,
        attemptCount: selected.attemptCount,
        failureCode,
        failedAt
      });
      invariant(
        result?.status === "manual_review",
        "RESPONDER_FULFILLMENT_WORKER_INVALID",
        "Responder manual-review state is invalid.",
        { status: 500 }
      );
      return Object.freeze({
        status: "manual_review",
        operationId: selected.operationId,
        failureCode
      });
    }
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
          emit({ state, cycle: cycles, resultStatus: lastStatus });
        } catch (error) {
          cycles += 1;
          consecutiveErrors += 1;
          lastStatus = "error";
          lastErrorCode = safeFailureCode(error);
          delay = Math.min(
            maximumBackoffMs,
            errorBackoffMs * 2 ** Math.min(consecutiveErrors - 1, 20)
          );
          emit({
            state,
            cycle: cycles,
            errorCode: lastErrorCode,
            nextDelayMs: delay
          });
        }
        if (!signal.aborted) await wait(delay, signal);
      }
    } finally {
      state = "stopped";
      emit({ state });
    }
  }

  return Object.freeze({
    kind: "responder-fulfillment-worker",
    runOnce,
    start({ signal = null } = {}) {
      if (!enabled || loopPromise) return false;
      shutdownSignal(signal);
      controller = new AbortController();
      if (signal) {
        const forwardAbort = () => controller?.abort();
        signal.addEventListener("abort", forwardAbort, { once: true });
        unlinkExternalAbort = () => signal.removeEventListener(
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
        kind: "responder-fulfillment-worker",
        state,
        workerId,
        enabled,
        concurrency: 1,
        leaseMs,
        intervalMs,
        errorBackoffMs,
        maximumBackoffMs,
        cycles,
        consecutiveErrors,
        lastStatus,
        lastErrorCode
      });
    }
  });
}

export function responderFulfillmentWorkerOptionsFromEnvironment(
  environment = process.env
) {
  const mode =
    environment?.SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MODE ??
    "held";
  if (mode !== "held" && mode !== "approved_live") {
    throw configurationError(
      "SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MODE must be held or approved_live."
    );
  }
  const errorBackoffMs = environmentInteger(
    environment,
    "SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_ERROR_BACKOFF_MS",
    5_000,
    100,
    300_000
  );
  return Object.freeze({
    mode,
    enabled: mode === "approved_live",
    leaseMs: environmentInteger(
      environment,
      "SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_LEASE_MS",
      120_000,
      30_000,
      600_000
    ),
    intervalMs: environmentInteger(
      environment,
      "SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_INTERVAL_MS",
      5_000,
      100,
      300_000
    ),
    errorBackoffMs,
    maximumBackoffMs: environmentInteger(
      environment,
      "SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MAXIMUM_BACKOFF_MS",
      60_000,
      errorBackoffMs,
      900_000
    )
  });
}
