import { randomUUID } from "node:crypto";

import {
  createAlakazamFulfillmentDecision
} from "../commerce-v2/alakazam-fulfillment.mjs";
import { HostedError, invariant } from "./errors.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DEFAULT_LEASE_MS = 2 * 60 * 1000;

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
    "FULFILLMENT_WORKER_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function exactUuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "FULFILLMENT_WORKER_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function nextUuid(ids, label) {
  return exactUuid(ids.next(label), label);
}

function safeFailureCode(error) {
  const selected = String(
    error?.code ?? "fulfillment_unexpected_failure"
  )
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 128);
  return /^[a-z][a-z0-9_]{2,127}$/u.test(selected)
    ? selected
    : "fulfillment_unexpected_failure";
}

function validatePorts(repository, compiler, publicationPort, clock, ids) {
  for (const [name, value, methods] of [
    [
      "repository",
      repository,
      [
        "bindFulfillmentDecision",
        "claimNextFulfillment",
        "finalizeFulfillmentPublication",
        "markFulfillmentDark",
        "stageFulfillmentPublication"
      ]
    ],
    ["compiler", compiler, ["compileAlakazam"]],
    ["publicationPort", publicationPort, ["request", "unpublish"]],
    ["clock", clock, ["now"]],
    ["ids", ids, ["next"]]
  ]) {
    invariant(
      value && methods.every(
        (method) => typeof value[method] === "function"
      ),
      "FULFILLMENT_WORKER_INVALID",
      `${name} port is incomplete.`,
      { status: 500 }
    );
  }
  return { repository, compiler, publicationPort, clock, ids };
}

export function createAlakazamFulfillmentWorker({
  repository,
  compiler,
  publicationPort,
  clock,
  ids,
  workerId = `alakazam-fulfillment-${randomUUID()}`,
  leaseMs = DEFAULT_LEASE_MS,
  enabled = false,
  intervalMs = 5_000,
  errorBackoffMs = 5_000,
  maximumBackoffMs = 60_000,
  wait = defaultWait,
  log = () => {}
} = {}) {
  const ports = validatePorts(
    repository,
    compiler,
    publicationPort,
    clock,
    ids
  );
  invariant(
    typeof workerId === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/u.test(workerId) &&
      Number.isSafeInteger(leaseMs) &&
      leaseMs >= 30_000 &&
      leaseMs <= 10 * 60 * 1000 &&
      typeof enabled === "boolean" &&
      Number.isSafeInteger(intervalMs) &&
      intervalMs >= 100 &&
      intervalMs <= 300_000 &&
      Number.isSafeInteger(errorBackoffMs) &&
      errorBackoffMs >= 100 &&
      errorBackoffMs <= 300_000 &&
      Number.isSafeInteger(maximumBackoffMs) &&
      maximumBackoffMs >= errorBackoffMs &&
      maximumBackoffMs <= 900_000 &&
      typeof wait === "function" &&
      typeof log === "function",
    "FULFILLMENT_WORKER_INVALID",
    "The Alakazam fulfillment worker configuration is invalid.",
    { status: 500 }
  );

  function now() {
    return exactIso(ports.clock.now(), "clock.now");
  }

  let controller = null;
  let loopPromise = null;
  let state = enabled ? "stopped" : "held";
  let cycles = 0;
  let consecutiveErrors = 0;
  let lastStatus = null;
  let lastErrorCode = null;

  function emit(entry) {
    try {
      log(Object.freeze({
        event: "sitesourcery.worker.alakazam-fulfillment",
        workerId,
        ...entry
      }));
    } catch {
      // Logging cannot alter fulfillment state.
    }
  }

  async function runOnce() {
    const claimedAt = now();
    const claimed = await ports.repository.claimNextFulfillment({
      workerId,
      claimedAt,
      leaseExpiresAt: new Date(
        Date.parse(claimedAt) + leaseMs
      ).toISOString()
    });
    if (claimed?.status === "idle") {
      return Object.freeze({ status: "idle" });
    }
    invariant(
      claimed?.status === "claimed" &&
        claimed.workerId === workerId,
      "FULFILLMENT_WORKER_INVALID",
      "The Alakazam fulfillment claim is invalid.",
      { status: 500 }
    );

    let decision = null;
    let proof = null;
    try {
      const compiled = ports.compiler.compileAlakazam({
        configuredFacts: claimed.configuredFacts,
        authority: claimed.authority
      });
      const staged =
        await ports.repository.stageFulfillmentPublication({
          operationId: claimed.operationId,
          workerId,
          attemptCount: claimed.attemptCount,
          artifactId: nextUuid(
            ports.ids,
            "alakazam_fulfillment_artifact"
          ),
          screeningId: nextUuid(
            ports.ids,
            "alakazam_fulfillment_screening"
          ),
          releaseRequestId: nextUuid(
            ports.ids,
            "alakazam_fulfillment_release_request"
          ),
          stagedAt: now(),
          compiled: {
            compilerSchema: compiled.schema,
            compilerRevision: compiled.compilerRevision,
            policyDigest: compiled.policyDigest,
            artifactDigest: compiled.artifactDigest,
            htmlBytes: compiled.htmlBytes
          }
        });
      decision = createAlakazamFulfillmentDecision({
        operationId: claimed.operationId,
        authority: claimed.authority,
        capability: "publish_accepted_project_version",
        sourceVersion: claimed.sourceVersion,
        publicationArtifact: {
          artifactDigest: staged.artifactDigest,
          compilerSchema: staged.compilerSchema,
          compilerRevision: staged.compilerRevision,
          policyDigest: claimed.authority.policyDigest,
          screeningId: staged.screeningId,
          screeningStage: "pre_publication",
          screeningPassed: true,
          screeningArtifactDigest: staged.artifactDigest
        },
        address: claimed.address,
        servingRevision: claimed.servingRevision,
        now: now()
      });
      proof = await ports.repository.bindFulfillmentDecision({
        operationId: claimed.operationId,
        workerId,
        attemptCount: claimed.attemptCount,
        decision
      });
      const providerResult =
        await ports.publicationPort.request(proof);
      invariant(
        providerResult?.status === "released" &&
          providerResult.published === true &&
          providerResult.releaseId === claimed.operationId,
        "ALAKAZAM_PUBLICATION_HELD",
        "Alakazam publication is safely held.",
        { status: 503 }
      );
      return await ports.repository
        .finalizeFulfillmentPublication({
          operationId: claimed.operationId,
          workerId,
          attemptCount: claimed.attemptCount,
          decisionDigest: decision.decisionDigest,
          receiptId: nextUuid(
            ports.ids,
            "alakazam_fulfillment_receipt"
          ),
          releaseId: nextUuid(
            ports.ids,
            "alakazam_fulfillment_release"
          ),
          providerResult,
          completedAt: now()
        });
    } catch (error) {
      if (!decision || !proof) throw error;
      let compensation;
      try {
        compensation = await ports.publicationPort.unpublish({
          projectId: claimed.projectId,
          hostname: claimed.address.hostname
        });
      } catch {
        throw new HostedError(
          "ALAKAZAM_PUBLICATION_RECONCILIATION_REQUIRED",
          "Alakazam publication could not be made safely dark.",
          {
            status: 503,
            details: {
              operationId: claimed.operationId,
              projectId: claimed.projectId
            }
          }
        );
      }
      invariant(
        compensation?.status === "unpublished" &&
          compensation.published === false,
        "ALAKAZAM_PUBLICATION_RECONCILIATION_REQUIRED",
        "Alakazam publication could not be made safely dark.",
        { status: 503 }
      );
      return ports.repository.markFulfillmentDark({
        operationId: claimed.operationId,
        workerId,
        attemptCount: claimed.attemptCount,
        decisionDigest: decision.decisionDigest,
        failureCode: safeFailureCode(error),
        failedAt: now()
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
          const result = await runOnce();
          cycles += 1;
          consecutiveErrors = 0;
          lastStatus = result.status;
          lastErrorCode = null;
          emit({
            state,
            cycle: cycles,
            resultStatus: lastStatus
          });
        } catch (error) {
          cycles += 1;
          consecutiveErrors += 1;
          delay = Math.min(
            maximumBackoffMs,
            errorBackoffMs * 2 ** Math.min(
              consecutiveErrors - 1,
              20
            )
          );
          lastStatus = "error";
          lastErrorCode =
            String(error?.code ?? "FULFILLMENT_WORKER_CYCLE_FAILED")
              .slice(0, 128);
          emit({
            state,
            cycle: cycles,
            errorCode: lastErrorCode
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
    kind: "alakazam-fulfillment-worker",
    workerId,
    runOnce,
    start({ signal = null } = {}) {
      if (!enabled || loopPromise) return false;
      controller = new AbortController();
      if (signal) {
        invariant(
          typeof signal.addEventListener === "function" &&
            typeof signal.aborted === "boolean",
          "FULFILLMENT_WORKER_INVALID",
          "The Alakazam fulfillment shutdown signal is invalid.",
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
