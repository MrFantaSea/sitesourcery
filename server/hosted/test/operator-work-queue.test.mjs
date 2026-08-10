import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldOperatorWorkQueue,
  createOperatorWorkQueue
} from "../operator-work-queue.mjs";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const OPERATOR_ORG = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const EVIDENCE = "44444444-4444-4444-8444-444444444444";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const DIGEST_D = "d".repeat(64);
const NOW = "2026-08-10T16:00:00.000Z";

function fixture() {
  const calls = [];
  const queue = Object.freeze({
    schema: "sitesourcery.operator-work-queue/v1",
    sourceAuthoritative: true,
    genericRepair: false,
    items: []
  });
  const repository = {
    async readiness() { return { ready: true }; },
    async list(value) { calls.push(["list", value]); return queue; },
    async refresh(value) { calls.push(["refresh", value]); return queue; },
    async recordInvoiceFinalizationFailure(value) {
      calls.push(["record", value]);
      return { id: ITEM, state: "open" };
    },
    async prepareProfessionalReversalRepair(value) {
      calls.push(["prepare", value]);
      return {
        organizationId: OPERATOR_ORG,
        lifecycleId: ITEM,
        lifecycleRevision: 4,
        evidenceId: EVIDENCE
      };
    }
  };
  const reversalRepair = {
    async reconcileEvidence(actor, value) {
      calls.push(["repair", actor, value]);
      return { status: "reconciled", lifecycleRevision: 5 };
    }
  };
  return {
    calls,
    service: createOperatorWorkQueue({
      repository,
      reversalRepair,
      clock: { now: () => NOW }
    })
  };
}

test("held operator queue exposes no provider, alert, or generic repair effect", async () => {
  const service = createHeldOperatorWorkQueue();
  assert.deepEqual(await service.readiness(), {
    ready: false,
    verified: false,
    kind: "operator-work-queue",
    mode: "held",
    code: "OPERATOR_QUEUE_HELD",
    providerEffects: false,
    alertEffects: false,
    genericRepair: false
  });
  await assert.rejects(service.list({}), { code: "OPERATOR_QUEUE_HELD" });
  await assert.rejects(service.refresh({}), { code: "OPERATOR_QUEUE_HELD" });
  await assert.rejects(service.recordInvoiceFinalizationFailure({}), {
    code: "OPERATOR_QUEUE_HELD"
  });
});

test("queue read and refresh bind the exact operator and canonical clock", async () => {
  const { calls, service } = fixture();
  const scope = { actorId: ACTOR, operatorOrganizationId: OPERATOR_ORG };
  assert.equal((await service.list(scope)).sourceAuthoritative, true);
  await service.refresh(scope);
  assert.deepEqual(calls, [
    ["list", scope],
    ["refresh", { ...scope, observedAt: NOW }]
  ]);
  assert.throws(() => service.list({ ...scope, extra: true }), {
    code: "OPERATOR_QUEUE_INVALID"
  });
});

test("invoice.finalization_failed retains digests only and is exact-idempotent input", async () => {
  const { calls, service } = fixture();
  await service.recordInvoiceFinalizationFailure({
    commandId: "invoice-finalization-command-1",
    providerEventIdDigest: DIGEST_A,
    invoiceIdDigest: DIGEST_B,
    payloadDigest: DIGEST_C,
    signatureVerificationDigest: DIGEST_D,
    reasonCode: "automatic_tax",
    providerCreatedAt: "2026-08-10T15:59:00.000Z"
  });
  const recorded = calls[0][1];
  assert.equal(recorded.schema,
    "sitesourcery.invoice-finalization-failure-evidence/v1");
  assert.equal(recorded.recordedAt, NOW);
  assert.match(recorded.requestDigest, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(recorded).includes("invoice_"), false);
  assert.throws(() => service.recordInvoiceFinalizationFailure({
    commandId: "invoice-finalization-command-2",
    providerEventIdDigest: DIGEST_A,
    invoiceIdDigest: DIGEST_B,
    payloadDigest: DIGEST_C,
    signatureVerificationDigest: DIGEST_D,
    reasonCode: "unknown_review",
    providerCreatedAt: "2026-08-10T15:59:00.000Z",
    rawPayload: {}
  }), { code: "OPERATOR_QUEUE_INVALID" });
});

test("only the existing bounded professional reversal repair can dispatch", async () => {
  const { calls, service } = fixture();
  const output = await service.dispatchProfessionalReversalRepair({
    actorId: ACTOR,
    operatorOrganizationId: OPERATOR_ORG,
    queueItemId: ITEM,
    expectedQueueRevision: 3,
    commandId: "professional-reversal-command-1",
    resolution: "not_effective",
    confirmedOutcome: null,
    verifiedFacts: { outcome: "not_effective" },
    verifiedFactsDigest: DIGEST_A,
    verifiedObservedAt: "2026-08-10T15:58:00.000Z"
  });
  assert.equal(output.kind, "professional_reversal_reconcile");
  assert.equal(output.result.status, "reconciled");
  assert.deepEqual(calls.map(([kind]) => kind), ["prepare", "repair", "refresh"]);
  assert.deepEqual(calls[1][1], { userId: ACTOR });
  assert.deepEqual(calls[1][2], {
    organizationId: OPERATOR_ORG,
    evidenceId: EVIDENCE,
    commandId: "professional-reversal-command-1",
    expectedLifecycleRevision: 4,
    resolution: "not_effective",
    confirmedOutcome: null,
    verifiedFacts: { outcome: "not_effective" },
    verifiedFactsDigest: DIGEST_A,
    verifiedObservedAt: "2026-08-10T15:58:00.000Z"
  });
});

test("operator queue construction rejects a generic or incomplete repair surface", () => {
  assert.throws(() => createOperatorWorkQueue({
    repository: {}, reversalRepair: {}, clock: { now: () => NOW }
  }), { code: "OPERATOR_QUEUE_CONFIGURATION_REQUIRED" });
});
