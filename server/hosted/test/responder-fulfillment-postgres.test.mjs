import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresResponderFulfillmentRepository
} from "../responder-fulfillment-postgres.mjs";

const IDS = Object.freeze({
  operation: "10000000-0000-4000-8000-000000000001",
  organization: "10000000-0000-4000-8000-000000000002",
  project: "10000000-0000-4000-8000-000000000003",
  interaction: "10000000-0000-4000-8000-000000000004",
  authority: "10000000-0000-4000-8000-000000000005"
});
const WORKER_ID = "responder-fulfillment-worker-test-0001";
const NOW = "2026-08-12T19:00:00.000Z";

function operation(overrides = {}) {
  return {
    id: IDS.operation,
    command_id: "responder-message-command-0001",
    organization_id: IDS.organization,
    project_id: IDS.project,
    interaction_id: IDS.interaction,
    contact_authority_id: IDS.authority,
    route_digest: "a".repeat(64),
    content_digest: "b".repeat(64),
    message_kind: "missed_call_ack",
    idempotency_key: "responder-delivery-command-0001",
    state: "claimed",
    attempt_count: 1,
    maximum_attempts: 5,
    lease_owner: WORKER_ID,
    last_worker_id: WORKER_ID,
    ...overrides
  };
}

function fakeAuthority(query) {
  const calls = [];
  return {
    calls,
    kind: "canonical-postgres",
    async readiness() { return { ready: true }; },
    async service(context, work) {
      calls.push({ context });
      return work({
        async query(text, values = []) {
          calls.push({ text, values });
          return query(text, values, calls);
        }
      });
    }
  };
}

test("PostgreSQL Responder fulfillment readiness proves the exact held queue contract", async () => {
  const authority = fakeAuthority(() => ({
    rowCount: 1,
    rows: [{
      contract_ready: true,
      tables_ready: true,
      release_ready: true
    }]
  }));
  const repository = createPostgresResponderFulfillmentRepository({
    authority
  });
  assert.deepEqual(await repository.readiness(), {
    schema: "sitesourcery.responder-fulfillment-postgres-readiness/v1",
    ready: true,
    verified: true,
    kind: "responder-fulfillment-postgres",
    state: "held-capable",
    providerEffects: false
  });
  assert.equal(repository.providerEffects, false);
  assert.equal(authority.calls[0].context.readOnly, true);
});

test("claim selects one eligible operation with SKIP LOCKED and returns digest-only authority", async () => {
  const queued = operation({
    state: "queued",
    attempt_count: 0,
    lease_owner: null,
    last_worker_id: null
  });
  const claimed = operation();
  const authority = fakeAuthority((text) => {
    if (text.includes("for update of operation skip locked")) {
      return { rowCount: 1, rows: [queued] };
    }
    if (text.includes("set state = 'claimed'")) {
      return { rowCount: 1, rows: [claimed] };
    }
    throw new Error("unexpected query");
  });
  const repository = createPostgresResponderFulfillmentRepository({
    authority
  });
  assert.deepEqual(await repository.claimNextDelivery({
    workerId: WORKER_ID,
    claimedAt: NOW,
    leaseExpiresAt: "2026-08-12T19:02:00.000Z"
  }), {
    status: "claimed",
    operationId: IDS.operation,
    commandId: queued.command_id,
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
  });
  assert.equal(authority.calls[0].context.actorKind, "system");
  const source = authority.calls.map((call) => call.text ?? "").join("\n");
  assert.match(source, /control\.state = 'approved_live'/u);
  assert.match(source, /not control\.global_kill_engaged/u);
  assert.match(source, /authority\.state = 'active'/u);
  assert.match(source, /interaction\.state = 'open'/u);
});

test("provider acceptance is exact, durable, and replayable", async () => {
  const accepted = operation({
    state: "accepted",
    provider: "twilio",
    provider_receipt_digest: "c".repeat(64),
    provider_accepted_at: NOW
  });
  let state = operation();
  const authority = fakeAuthority((text) => {
    if (text.startsWith("select *")) {
      return { rowCount: 1, rows: [state] };
    }
    if (text.includes("set state = 'accepted'")) {
      state = accepted;
      return { rowCount: 1, rows: [{ id: IDS.operation }] };
    }
    throw new Error("unexpected query");
  });
  const repository = createPostgresResponderFulfillmentRepository({
    authority
  });
  const input = {
    operationId: IDS.operation,
    workerId: WORKER_ID,
    attemptCount: 1,
    provider: "twilio",
    providerReceiptDigest: "c".repeat(64),
    acceptedAt: NOW
  };
  assert.deepEqual(await repository.recordDeliveryAccepted(input), {
    status: "accepted"
  });
  assert.deepEqual(await repository.recordDeliveryAccepted(input), {
    status: "replay"
  });
});

test("retry backoff is bounded and the fifth failed attempt dead-letters for review", async () => {
  let state = operation();
  const authority = fakeAuthority((text, values) => {
    if (text.startsWith("select *")) {
      return { rowCount: 1, rows: [state] };
    }
    if (text.includes("set state = 'retry_wait'")) {
      assert.equal(values[1], "2026-08-12T19:00:05.000Z");
      return { rowCount: 1, rows: [{ id: IDS.operation }] };
    }
    if (text.includes("set state = 'dead_letter'")) {
      return { rowCount: 1, rows: [{ id: IDS.operation }] };
    }
    throw new Error("unexpected query");
  });
  const repository = createPostgresResponderFulfillmentRepository({
    authority
  });
  const base = {
    operationId: IDS.operation,
    workerId: WORKER_ID,
    attemptCount: 1,
    failureCode: "RESPONDER_PROVIDER_TEMPORARY",
    failedAt: NOW
  };
  assert.deepEqual(await repository.recordDeliveryRetry(base), {
    status: "retry_scheduled"
  });
  state = operation({ attempt_count: 5, maximum_attempts: 5 });
  assert.deepEqual(await repository.recordDeliveryRetry({
    ...base,
    attemptCount: 5
  }), {
    status: "manual_review"
  });
});

test("ambiguous delivery moves directly to manual review without retry authority", async () => {
  const authority = fakeAuthority((text) => {
    if (text.startsWith("select *")) {
      return { rowCount: 1, rows: [operation()] };
    }
    if (text.includes("set state = 'manual_review'")) {
      return { rowCount: 1, rows: [{ id: IDS.operation }] };
    }
    throw new Error("unexpected query");
  });
  const repository = createPostgresResponderFulfillmentRepository({
    authority
  });
  assert.deepEqual(await repository.recordDeliveryManualReview({
    operationId: IDS.operation,
    workerId: WORKER_ID,
    attemptCount: 1,
    failureCode: "RESPONDER_FULFILLMENT_UNCLASSIFIED_FAILURE",
    failedAt: NOW
  }), { status: "manual_review" });
  const source = authority.calls.map((call) => call.text ?? "").join("\n");
  assert.match(source, /provider_effects_authorized = false/u);
  assert.doesNotMatch(source, /retry_wait/u);
});

test("repository rejects expanded claims and stale lease ownership before mutation", async () => {
  const authority = fakeAuthority((text) => {
    if (text.startsWith("select *")) {
      return {
        rowCount: 1,
        rows: [operation({ lease_owner: "responder-fulfillment-other-0001" })]
      };
    }
    throw new Error("unexpected mutation");
  });
  const repository = createPostgresResponderFulfillmentRepository({
    authority
  });
  assert.throws(
    () => repository.claimNextDelivery({
      workerId: WORKER_ID,
      claimedAt: NOW,
      leaseExpiresAt: "2026-08-12T19:02:00.000Z",
      organizationId: IDS.organization
    }),
    (error) => error?.code ===
      "RESPONDER_FULFILLMENT_REPOSITORY_INVALID"
  );
  await assert.rejects(
    repository.recordDeliveryManualReview({
      operationId: IDS.operation,
      workerId: WORKER_ID,
      attemptCount: 1,
      failureCode: "RESPONDER_PROVIDER_UNKNOWN",
      failedAt: NOW
    }),
    (error) => error?.code === "RESPONDER_FULFILLMENT_RETRY_REQUIRED"
  );
});
