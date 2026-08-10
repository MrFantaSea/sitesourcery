import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const OPERATOR_WORK_QUEUE_SCHEMA =
  "sitesourcery.operator-work-queue/v1";
export const INVOICE_FINALIZATION_FAILURE_SCHEMA =
  "sitesourcery.invoice-finalization-failure-evidence/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const FINALIZATION_REASONS = new Set([
  "automatic_tax",
  "invoice_settings",
  "provider_rejected",
  "unknown_review"
]);
const REVERSAL_OUTCOMES = new Set([
  "refund_failed",
  "dispute_won",
  "dispute_funds_reinstated",
  "dispute_open",
  "refund_partial",
  "dispute_funds_withdrawn",
  "refund_full",
  "dispute_lost"
]);

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    "OPERATOR_QUEUE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "OPERATOR_QUEUE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "OPERATOR_QUEUE_INVALID",
    `${field} must be an opaque lowercase SHA-256 or HMAC digest.`,
    { status: 400 }
  );
  return value;
}

function commandId(value) {
  invariant(
    typeof value === "string" && SAFE_ID.test(value),
    "OPERATOR_QUEUE_INVALID",
    "Command ID is invalid.",
    { status: 400 }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "OPERATOR_QUEUE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function now(clock) {
  const value = typeof clock === "function" ? clock() : clock?.now?.();
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "OPERATOR_QUEUE_CONFIGURATION_REQUIRED",
    "The operator queue clock is invalid.",
    { status: 500 }
  );
  return value;
}

function operatorScope(value, field) {
  exactObject(value, ["actorId", "operatorOrganizationId"], field);
  return deepFreeze({
    actorId: uuid(value.actorId, "Operator actor ID"),
    operatorOrganizationId: uuid(
      value.operatorOrganizationId,
      "Operator organization ID"
    )
  });
}

function finalizationEvidence(value, recordedAt) {
  exactObject(
    value,
    [
      "commandId",
      "invoiceIdDigest",
      "payloadDigest",
      "providerCreatedAt",
      "providerEventIdDigest",
      "reasonCode",
      "signatureVerificationDigest"
    ],
    "Invoice finalization failure evidence"
  );
  invariant(
    FINALIZATION_REASONS.has(value.reasonCode),
    "OPERATOR_QUEUE_INVALID",
    "Invoice finalization failure reason is invalid.",
    { status: 400 }
  );
  const selected = {
    schema: INVOICE_FINALIZATION_FAILURE_SCHEMA,
    commandId: commandId(value.commandId),
    providerEventIdDigest: sha256(
      value.providerEventIdDigest,
      "Provider event ID digest"
    ),
    invoiceIdDigest: sha256(value.invoiceIdDigest, "Invoice ID digest"),
    payloadDigest: sha256(value.payloadDigest, "Payload digest"),
    signatureVerificationDigest: sha256(
      value.signatureVerificationDigest,
      "Signature verification digest"
    ),
    reasonCode: value.reasonCode,
    providerCreatedAt: instant(value.providerCreatedAt, "Provider event time"),
    recordedAt
  };
  invariant(
    Date.parse(selected.recordedAt) >= Date.parse(selected.providerCreatedAt),
    "OPERATOR_QUEUE_INVALID",
    "Invoice finalization evidence predates its provider event.",
    { status: 400 }
  );
  const requestFact = { ...selected };
  delete requestFact.recordedAt;
  return deepFreeze({ ...selected, requestDigest: digest(requestFact) });
}

function repairInput(value) {
  exactObject(
    value,
    [
      "actorId",
      "commandId",
      "confirmedOutcome",
      "expectedQueueRevision",
      "operatorOrganizationId",
      "queueItemId",
      "resolution",
      "verifiedFacts",
      "verifiedFactsDigest",
      "verifiedObservedAt"
    ],
    "Operator queue repair"
  );
  invariant(
    Number.isSafeInteger(value.expectedQueueRevision) &&
      value.expectedQueueRevision > 0,
    "OPERATOR_QUEUE_INVALID",
    "Expected queue revision is invalid.",
    { status: 400 }
  );
  invariant(
    ["confirmed", "not_effective"].includes(value.resolution) &&
      ((value.resolution === "confirmed" &&
        REVERSAL_OUTCOMES.has(value.confirmedOutcome)) ||
        (value.resolution === "not_effective" &&
          value.confirmedOutcome === null)),
    "OPERATOR_QUEUE_INVALID",
    "Professional reversal resolution is invalid.",
    { status: 400 }
  );
  exactObject(
    value.verifiedFacts,
    Object.keys(value.verifiedFacts ?? {}),
    "Verified reversal facts"
  );
  invariant(
    Buffer.byteLength(canonicalJson(value.verifiedFacts), "utf8") <= 32768,
    "OPERATOR_QUEUE_INVALID",
    "Verified reversal facts exceed the existing bounded repair contract.",
    { status: 400 }
  );
  return deepFreeze({
    actorId: uuid(value.actorId, "Operator actor ID"),
    operatorOrganizationId: uuid(
      value.operatorOrganizationId,
      "Operator organization ID"
    ),
    queueItemId: uuid(value.queueItemId, "Queue item ID"),
    expectedQueueRevision: value.expectedQueueRevision,
    commandId: commandId(value.commandId),
    resolution: value.resolution,
    confirmedOutcome: value.confirmedOutcome,
    verifiedFacts: structuredClone(value.verifiedFacts),
    verifiedFactsDigest: sha256(
      value.verifiedFactsDigest,
      "Verified facts digest"
    ),
    verifiedObservedAt: instant(
      value.verifiedObservedAt,
      "Verified facts observation time"
    )
  });
}

function heldError() {
  return new HostedError(
    "OPERATOR_QUEUE_HELD",
    "The operator work queue is not connected to production composition.",
    {
      status: 503,
      details: {
        providerEffects: false,
        alertEffects: false,
        genericRepair: false
      }
    }
  );
}

const METHODS = Object.freeze([
  "list",
  "refresh",
  "recordInvoiceFinalizationFailure",
  "dispatchProfessionalReversalRepair"
]);

export function createHeldOperatorWorkQueue() {
  const service = {
    kind: "operator-work-queue",
    mode: "held",
    providerEffects: false,
    alertEffects: false,
    genericRepair: false,
    async readiness() {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "operator-work-queue",
        mode: "held",
        code: "OPERATOR_QUEUE_HELD",
        providerEffects: false,
        alertEffects: false,
        genericRepair: false
      });
    }
  };
  for (const method of METHODS) {
    service[method] = async () => { throw heldError(); };
  }
  return Object.freeze(service);
}

export function createOperatorWorkQueue({ repository, reversalRepair, clock } = {}) {
  invariant(
    repository &&
      [
        "readiness",
        "list",
        "refresh",
        "recordInvoiceFinalizationFailure",
        "prepareProfessionalReversalRepair"
      ].every((method) => typeof repository[method] === "function"),
    "OPERATOR_QUEUE_CONFIGURATION_REQUIRED",
    "A complete operator work queue repository is required.",
    { status: 500 }
  );
  invariant(
    reversalRepair &&
      typeof reversalRepair.reconcileEvidence === "function",
    "OPERATOR_QUEUE_CONFIGURATION_REQUIRED",
    "The existing bounded professional reversal repair port is required.",
    { status: 500 }
  );

  return Object.freeze({
    kind: "operator-work-queue",
    mode: "repository",
    providerEffects: false,
    alertEffects: false,
    genericRepair: false,
    readiness: () => repository.readiness(),
    list: (input) => repository.list(operatorScope(input, "Operator queue read")),
    refresh(input) {
      return repository.refresh({
        ...operatorScope(input, "Operator queue refresh"),
        observedAt: now(clock)
      });
    },
    recordInvoiceFinalizationFailure(input) {
      return repository.recordInvoiceFinalizationFailure(
        finalizationEvidence(input, now(clock))
      );
    },
    async dispatchProfessionalReversalRepair(value) {
      const input = repairInput(value);
      const binding = await repository.prepareProfessionalReversalRepair(input);
      const result = await reversalRepair.reconcileEvidence(
        { userId: input.actorId },
        {
          organizationId: binding.organizationId,
          evidenceId: binding.evidenceId,
          commandId: input.commandId,
          expectedLifecycleRevision: binding.lifecycleRevision,
          resolution: input.resolution,
          confirmedOutcome: input.confirmedOutcome,
          verifiedFacts: input.verifiedFacts,
          verifiedFactsDigest: input.verifiedFactsDigest,
          verifiedObservedAt: input.verifiedObservedAt
        }
      );
      const queue = await repository.refresh({
        actorId: input.actorId,
        operatorOrganizationId: input.operatorOrganizationId,
        observedAt: now(clock)
      });
      return deepFreeze({
        schema: "sitesourcery.operator-work-queue-repair-result/v1",
        kind: "professional_reversal_reconcile",
        queueItemId: input.queueItemId,
        result,
        queue
      });
    }
  });
}
