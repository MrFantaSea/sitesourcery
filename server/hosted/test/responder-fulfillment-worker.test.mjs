import assert from "node:assert/strict";
import test from "node:test";

import {
  createResponderFulfillmentWorker,
  responderFulfillmentWorkerOptionsFromEnvironment
} from "../responder-fulfillment-worker.mjs";

const IDS = Object.freeze({
  operation: "10000000-0000-4000-8000-000000000001",
  organization: "10000000-0000-4000-8000-000000000002",
  project: "10000000-0000-4000-8000-000000000003",
  interaction: "10000000-0000-4000-8000-000000000004",
  authority: "10000000-0000-4000-8000-000000000005"
});
const NOW = "2026-08-12T18:00:00.000Z";
const WORKER_ID = "responder-fulfillment-worker-test-0001";

function turn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fixture({
  enabled = true,
  deliveryError = null,
  acceptedRecordingError = null,
  claimResult = null,
  wait = undefined,
  log = undefined
} = {}) {
  const calls = {
    claims: [],
    sends: [],
    accepted: [],
    retries: [],
    reviews: []
  };
  const selectedClaim = claimResult ?? {
    status: "claimed",
    operationId: IDS.operation,
    commandId: "responder-message-command-0001",
    organizationId: IDS.organization,
    projectId: IDS.project,
    interactionId: IDS.interaction,
    contactAuthorityId: IDS.authority,
    routeDigest: "a".repeat(64),
    contentDigest: "b".repeat(64),
    messageKind: "missed_call_ack",
    idempotencyKey: "responder-delivery-command-0001",
    attemptCount: 1,
    workerId: WORKER_ID
  };
  const repository = {
    async claimNextDelivery(input) {
      calls.claims.push(structuredClone(input));
      return structuredClone(selectedClaim);
    },
    async recordDeliveryAccepted(input) {
      calls.accepted.push(structuredClone(input));
      if (acceptedRecordingError) throw acceptedRecordingError;
      return { status: "accepted" };
    },
    async recordDeliveryRetry(input) {
      calls.retries.push(structuredClone(input));
      return { status: "retry_scheduled" };
    },
    async recordDeliveryManualReview(input) {
      calls.reviews.push(structuredClone(input));
      return { status: "manual_review" };
    }
  };
  const fulfillmentPort = {
    kind: enabled
      ? "responder-fulfillment-provider"
      : "responder-fulfillment-held-provider",
    providerEffects: enabled,
    idempotency: enabled ? "provider-enforced" : "none",
    async sendMessage(input) {
      if (!enabled) throw new Error("held provider called");
      calls.sends.push({ ...input, signal: input.signal });
      if (deliveryError) throw deliveryError;
      return {
        status: "accepted",
        provider: "phone_bridge",
        idempotencyKey: input.idempotencyKey,
        providerReceiptDigest: "c".repeat(64),
        acceptedAt: NOW
      };
    }
  };
  const worker = createResponderFulfillmentWorker({
    repository,
    fulfillmentPort,
    clock: { now: () => NOW },
    enabled,
    workerId: WORKER_ID,
    intervalMs: 100,
    errorBackoffMs: 100,
    maximumBackoffMs: 400,
    ...(wait ? { wait } : {}),
    ...(log ? { log } : {})
  });
  return { calls, worker };
}

test("held Responder fulfillment starts no loop and performs no provider effect", async () => {
  const { calls, worker } = fixture({ enabled: false });
  assert.equal(worker.start(), false);
  assert.deepEqual(await worker.runOnce(), { status: "held" });
  assert.equal(await worker.stop(), false);
  assert.equal(worker.snapshot().state, "held");
  assert.equal(worker.snapshot().concurrency, 1);
  assert.deepEqual(calls.claims, []);
  assert.deepEqual(calls.sends, []);
});

test("one lease-bound claim reaches the provider with digests and stable idempotency only", async () => {
  const { calls, worker } = fixture();
  assert.deepEqual(await worker.runOnce(), {
    status: "accepted",
    operationId: IDS.operation
  });
  assert.deepEqual(calls.claims, [{
    workerId: WORKER_ID,
    claimedAt: NOW,
    leaseExpiresAt: "2026-08-12T18:02:00.000Z"
  }]);
  assert.equal(calls.sends.length, 1);
  assert.deepEqual(
    Object.keys(calls.sends[0]).sort(),
    [
      "commandId", "contactAuthorityId", "contentDigest", "idempotencyKey",
      "interactionId", "messageKind", "operationId", "organizationId",
      "projectId", "routeDigest", "schema", "signal"
    ].sort()
  );
  assert.equal(
    JSON.stringify(calls.sends[0]).includes("phone"),
    false
  );
  assert.equal(calls.accepted[0].provider, "phone_bridge");
  assert.equal(calls.accepted[0].providerReceiptDigest, "c".repeat(64));
  assert.deepEqual(calls.retries, []);
  assert.deepEqual(calls.reviews, []);
});

test("only explicitly retryable pre-acceptance failures retry automatically", async () => {
  const retryable = new Error("private provider detail");
  retryable.code = "RESPONDER_PROVIDER_TEMPORARY";
  retryable.deliveryDisposition = "retryable";
  const retry = fixture({ deliveryError: retryable });
  assert.deepEqual(await retry.worker.runOnce(), {
    status: "retry_scheduled",
    operationId: IDS.operation,
    failureCode: "RESPONDER_PROVIDER_TEMPORARY"
  });
  assert.equal(retry.calls.retries.length, 1);
  assert.deepEqual(retry.calls.reviews, []);

  const ambiguous = new Error("unknown effect containing +15555550100");
  ambiguous.code = "provider_unknown";
  const review = fixture({ deliveryError: ambiguous });
  assert.deepEqual(await review.worker.runOnce(), {
    status: "manual_review",
    operationId: IDS.operation,
    failureCode: "RESPONDER_FULFILLMENT_UNCLASSIFIED_FAILURE"
  });
  assert.deepEqual(review.calls.retries, []);
  assert.equal(review.calls.reviews.length, 1);
});

test("post-acceptance persistence uncertainty never creates a blind retry transition", async () => {
  const failure = new Error("database uncertain after provider acceptance");
  failure.code = "DATABASE_UNAVAILABLE";
  const { calls, worker } = fixture({ acceptedRecordingError: failure });
  await assert.rejects(
    worker.runOnce(),
    (error) => error === failure
  );
  assert.equal(calls.sends.length, 1);
  assert.deepEqual(calls.retries, []);
  assert.deepEqual(calls.reviews, []);
});

test("the loop is single-flight, shuts down cleanly, and logs no provider detail", async () => {
  const waits = [];
  const logs = [];
  const { calls, worker } = fixture({
    wait(milliseconds, signal) {
      return new Promise((resolve) => {
        const release = () => resolve();
        signal.addEventListener("abort", release, { once: true });
        waits.push({ milliseconds, release });
      });
    },
    log(entry) {
      logs.push(entry);
    }
  });
  assert.equal(worker.start(), true);
  assert.equal(worker.start(), false);
  await turn();
  assert.equal(calls.sends.length, 1);
  assert.equal(waits[0].milliseconds, 100);
  assert.equal(await worker.stop(), true);
  assert.equal(worker.snapshot().state, "stopped");
  assert.doesNotMatch(
    JSON.stringify(logs),
    /routeDigest|contentDigest|phone_bridge|10000000/u
  );
});

test("Responder fulfillment environment is independently held and bounded", () => {
  assert.deepEqual(responderFulfillmentWorkerOptionsFromEnvironment({}), {
    mode: "held",
    enabled: false,
    leaseMs: 120_000,
    intervalMs: 5_000,
    errorBackoffMs: 5_000,
    maximumBackoffMs: 60_000
  });
  assert.deepEqual(responderFulfillmentWorkerOptionsFromEnvironment({
    SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MODE: "approved_live",
    SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_LEASE_MS: "30000",
    SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_INTERVAL_MS: "250",
    SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_ERROR_BACKOFF_MS: "300",
    SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MAXIMUM_BACKOFF_MS: "1200"
  }), {
    mode: "approved_live",
    enabled: true,
    leaseMs: 30_000,
    intervalMs: 250,
    errorBackoffMs: 300,
    maximumBackoffMs: 1_200
  });
  for (const environment of [
    { SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MODE: "enabled" },
    { SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_LEASE_MS: "29999" },
    { SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_INTERVAL_MS: "99" },
    {
      SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_ERROR_BACKOFF_MS: "1000",
      SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MAXIMUM_BACKOFF_MS: "999"
    }
  ]) {
    assert.throws(
      () => responderFulfillmentWorkerOptionsFromEnvironment(environment),
      (error) => error?.code ===
        "RESPONDER_FULFILLMENT_WORKER_CONFIGURATION_INVALID"
    );
  }
});
