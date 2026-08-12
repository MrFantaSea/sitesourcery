import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../canonical.mjs";
import {
  createMemoryDomainLifecycleRepository,
  createHeldDomainProviderLifecycle,
  DOMAIN_PROVIDER_LIFECYCLE_OUTCOME_SCHEMA,
  DOMAIN_PROVIDER_LIFECYCLE_READBACK_SCHEMA,
  DOMAIN_PROVIDER_RENEWAL_QUOTE_SCHEMA,
  DOMAIN_PROVIDER_PIN_SCHEMA
} from "../index.mjs";

const DOMAIN = "lifecycle-proof.example";
const EXPIRY = "2027-08-11T12:00:00.000Z";
const RENEWED_EXPIRY = "2028-08-11T12:00:00.000Z";

function pin() {
  const body = {
    schema: DOMAIN_PROVIDER_PIN_SCHEMA,
    providerCode: "secondary",
    registrarOfRecord: "Secondary Registrar",
    domain: DOMAIN
  };
  return Object.freeze({ ...body, fingerprint: digest(body) });
}

function scope() {
  return Object.freeze({
    organizationId: "organization_lifecycle",
    projectId: "project_lifecycle",
    customerId: "customer_lifecycle",
    actorId: "customer_lifecycle"
  });
}

function harness() {
  let now = "2026-08-11T12:00:00.000Z";
  const calls = { lifecycle: 0, quote: 0 };
  const state = {
    lifecycle: {
      schema: DOMAIN_PROVIDER_LIFECYCLE_READBACK_SCHEMA,
      providerCode: "secondary",
      domain: DOMAIN,
      authoritative: true,
      lifecycleStatus: "active",
      expirationDate: EXPIRY,
      autoRenew: false,
      transferStatus: "none",
      transferEligible: true,
      transferLocked: true,
      observedAt: now,
      providerReference: "raw-provider-domain-reference",
      renewalOperationId: null,
      transferOperationId: null
    },
    quote: {
      schema: DOMAIN_PROVIDER_RENEWAL_QUOTE_SCHEMA,
      status: "confirmation_required",
      noCharge: true,
      providerCode: "secondary",
      domain: DOMAIN,
      currentExpirationDate: EXPIRY,
      priceClass: "standard",
      price: { amountMinor: 1600, currency: "USD" },
      quoteId: "raw-renewal-quote-reference",
      observedAt: "2026-08-11T12:01:00.000Z",
      expiresAt: "2026-08-11T12:05:00.000Z"
    }
  };
  const repository = createMemoryDomainLifecycleRepository();
  const providerReadPort = {
    async readLifecycle() {
      calls.lifecycle += 1;
      return structuredClone(state.lifecycle);
    },
    async previewRenewal() {
      calls.quote += 1;
      return structuredClone(state.quote);
    }
  };
  const service = createHeldDomainProviderLifecycle({
    repository,
    providerReadPort,
    clock: { now: () => now }
  });
  let sequence = 0;
  function command(label) {
    sequence += 1;
    return `${label}-${sequence}`;
  }
  function setNow(value) {
    now = value;
  }
  function outcome(kind, effect, attemptId, operationId) {
    return {
      schema: DOMAIN_PROVIDER_LIFECYCLE_OUTCOME_SCHEMA,
      kind,
      providerCode: "secondary",
      domain: DOMAIN,
      attemptId,
      effect,
      operationId,
      observedAt: now,
      reason: `${kind}_${effect}_fake`
    };
  }
  return {
    calls,
    state,
    repository,
    service,
    command,
    setNow,
    outcome,
    scope: scope(),
    pin: pin()
  };
}

async function refresh(context, label = "refresh") {
  return context.service.refreshAuthoritative({
    scope: context.scope,
    pin: context.pin,
    commandId: context.command(label)
  });
}

async function quote(context) {
  context.setNow("2026-08-11T12:01:00.000Z");
  return context.service.quoteRenewal({
    scope: context.scope,
    pin: context.pin,
    commandId: context.command("quote"),
    years: 1
  });
}

test("authoritative renewal advances expiry once and financial reversal never reverses custody", async () => {
  const context = harness();
  let projected = await refresh(context);
  assert.equal(projected.customer.lifecycleStatus, "active");
  assert.equal(projected.customer.expirationDate, EXPIRY);
  projected = await quote(context);
  const quoteFingerprint = projected.operator.renewal.quote.quoteFingerprint;
  assert.equal(projected.customer.renewal.quote.price.amountMinor, 1600);

  context.setNow("2026-08-11T12:02:00.000Z");
  const reserveInput = {
    scope: context.scope,
    pin: context.pin,
    commandId: "renewal-reservation-command",
    attemptId: "renewal-attempt-001",
    quoteFingerprint,
    consentDigest: "a".repeat(64)
  };
  const reserved = await context.service.reserveRenewal(reserveInput);
  assert.equal(reserved.replayed, false);
  assert.equal(reserved.customer.renewal.status, "dispatching");
  assert.equal(reserved.reservation.providerEffectsAuthorized, false);
  assert.equal(reserved.reservation.paymentEffectsAuthorized, false);
  assert.equal(
    (await context.service.reserveRenewal(reserveInput)).replayed,
    true
  );
  await assert.rejects(
    context.service.reserveRenewal({
      ...reserveInput,
      consentDigest: "b".repeat(64)
    }),
    (error) => error?.code === "lifecycle_idempotency_conflict"
  );

  const recorded = await context.service.recordRenewalOutcome({
    scope: context.scope,
    pin: context.pin,
    commandId: "renewal-outcome-command",
    outcome: context.outcome(
      "renewal",
      "submitted",
      "renewal-attempt-001",
      "raw-renewal-operation-reference"
    )
  });
  assert.equal(recorded.customer.renewal.status, "submitted");

  context.setNow("2026-08-11T12:03:00.000Z");
  context.state.lifecycle = {
    ...context.state.lifecycle,
    expirationDate: RENEWED_EXPIRY,
    observedAt: "2026-08-11T12:03:00.000Z",
    renewalOperationId: "raw-renewal-operation-reference"
  };
  projected = await refresh(context, "renewal-readback");
  assert.equal(projected.customer.renewal.status, "succeeded");
  assert.equal(projected.customer.expirationDate, RENEWED_EXPIRY);

  const reversed = await context.service.recordReversal({
    scope: context.scope,
    pin: context.pin,
    commandId: context.command("renewal-reversal"),
    kind: "renewal",
    sourceDigest: "c".repeat(64),
    reason: "provider_credit_requires_financial_review"
  });
  assert.equal(reversed.customer.renewal.status, "reversal_review");
  assert.equal(reversed.customer.renewal.custodyUnchanged, true);
  assert.equal(reversed.customer.expirationDate, RENEWED_EXPIRY);
  await assert.rejects(
    quote(context),
    (error) => error?.code === "renewal_not_available"
  );
});

test("ambiguous renewal is replayed and cannot be automatically re-reserved", async () => {
  const context = harness();
  await refresh(context);
  const quoted = await quote(context);
  context.setNow("2026-08-11T12:02:00.000Z");
  await context.service.reserveRenewal({
    scope: context.scope,
    pin: context.pin,
    commandId: context.command("reserve"),
    attemptId: "renewal-attempt-ambiguous",
    quoteFingerprint: quoted.operator.renewal.quote.quoteFingerprint,
    consentDigest: "d".repeat(64)
  });
  const outcomeInput = {
    scope: context.scope,
    pin: context.pin,
    commandId: "renewal-ambiguous-outcome",
    outcome: context.outcome(
      "renewal",
      "uncertain",
      "renewal-attempt-ambiguous",
      "raw-ambiguous-renewal-operation"
    )
  };
  const ambiguous = await context.service.recordRenewalOutcome(outcomeInput);
  assert.equal(ambiguous.customer.renewal.status, "uncertain");
  assert.equal(ambiguous.customer.review.automaticRetry, false);
  assert.equal(
    (await context.service.recordRenewalOutcome(outcomeInput)).replayed,
    true
  );
  await assert.rejects(
    context.service.reserveRenewal({
      scope: context.scope,
      pin: context.pin,
      commandId: context.command("unsafe-second-reserve"),
      attemptId: "renewal-attempt-second",
      quoteFingerprint: quoted.operator.renewal.quote.quoteFingerprint,
      consentDigest: "d".repeat(64)
    }),
    (error) => error?.code === "renewal_quote_mismatch"
  );
});

test("renewal expiry movement without the reserved operation is held for review", async () => {
  const context = harness();
  await refresh(context);
  const quoted = await quote(context);
  context.setNow("2026-08-11T12:02:00.000Z");
  await context.service.reserveRenewal({
    scope: context.scope,
    pin: context.pin,
    commandId: context.command("reserve"),
    attemptId: "renewal-attempt-mismatch",
    quoteFingerprint: quoted.operator.renewal.quote.quoteFingerprint,
    consentDigest: "9".repeat(64)
  });
  await context.service.recordRenewalOutcome({
    scope: context.scope,
    pin: context.pin,
    commandId: context.command("outcome"),
    outcome: context.outcome(
      "renewal",
      "submitted",
      "renewal-attempt-mismatch",
      "expected-renewal-operation"
    )
  });
  context.setNow("2026-08-11T12:03:00.000Z");
  context.state.lifecycle = {
    ...context.state.lifecycle,
    expirationDate: RENEWED_EXPIRY,
    observedAt: "2026-08-11T12:03:00.000Z",
    renewalOperationId: "different-renewal-operation"
  };
  const projected = await refresh(context, "mismatched-renewal-readback");
  assert.equal(projected.customer.renewal.status, "submitted");
  assert.equal(
    projected.operator.review.reason,
    "renewal_expiry_changed_without_matching_operation"
  );
});

test("transfer ambiguity retains the pin until matching authoritative cancellation", async () => {
  const context = harness();
  await refresh(context);
  context.setNow("2026-08-11T12:01:00.000Z");
  const reserved = await context.service.reserveTransfer({
    scope: context.scope,
    pin: context.pin,
    commandId: context.command("transfer-reserve"),
    attemptId: "transfer-attempt-001",
    consentDigest: "e".repeat(64)
  });
  assert.equal(reserved.customer.transfer.status, "dispatching");
  const uncertain = await context.service.recordTransferOutcome({
    scope: context.scope,
    pin: context.pin,
    commandId: context.command("transfer-outcome"),
    outcome: context.outcome(
      "transfer",
      "uncertain",
      "transfer-attempt-001",
      "raw-transfer-operation-reference"
    )
  });
  assert.equal(uncertain.customer.transfer.status, "uncertain");
  assert.equal(uncertain.customer.transfer.providerPinRetained, true);
  await assert.rejects(
    context.service.recordReversal({
      scope: context.scope,
      pin: context.pin,
      commandId: context.command("premature-reversal"),
      kind: "transfer",
      sourceDigest: "f".repeat(64),
      reason: "customer_requested_cancel"
    }),
    (error) => error?.code === "transfer_cancellation_readback_required"
  );

  context.setNow("2026-08-11T12:02:00.000Z");
  context.state.lifecycle = {
    ...context.state.lifecycle,
    transferStatus: "cancelled",
    transferOperationId: "raw-transfer-operation-reference",
    observedAt: "2026-08-11T12:02:00.000Z"
  };
  const cancelled = await refresh(context, "transfer-cancel-readback");
  assert.equal(cancelled.customer.transfer.status, "cancelled");
  assert.equal(cancelled.customer.transfer.providerPinRetained, true);
  const reversed = await context.service.recordReversal({
    scope: context.scope,
    pin: context.pin,
    commandId: context.command("transfer-reversal"),
    kind: "transfer",
    sourceDigest: "f".repeat(64),
    reason: "provider_confirmed_transfer_cancellation"
  });
  assert.equal(reversed.customer.transfer.status, "reversal_review");
});

test("completed transfer is irreversible and the old pin remains historical evidence", async () => {
  const context = harness();
  await refresh(context);
  context.setNow("2026-08-11T12:01:00.000Z");
  await context.service.reserveTransfer({
    scope: context.scope,
    pin: context.pin,
    commandId: context.command("reserve"),
    attemptId: "transfer-attempt-complete",
    consentDigest: "1".repeat(64)
  });
  await context.service.recordTransferOutcome({
    scope: context.scope,
    pin: context.pin,
    commandId: context.command("outcome"),
    outcome: context.outcome(
      "transfer",
      "submitted",
      "transfer-attempt-complete",
      "raw-completed-transfer-operation"
    )
  });
  context.setNow("2026-08-11T12:02:00.000Z");
  context.state.lifecycle = {
    ...context.state.lifecycle,
    lifecycleStatus: "transferred_out",
    transferStatus: "completed",
    transferOperationId: "raw-completed-transfer-operation",
    observedAt: "2026-08-11T12:02:00.000Z"
  };
  const completed = await refresh(context, "complete-readback");
  assert.equal(completed.customer.transfer.status, "completed");
  assert.equal(completed.operator.transfer.providerPinRetainedAsHistory, true);
  await assert.rejects(
    context.service.recordReversal({
      scope: context.scope,
      pin: context.pin,
      commandId: context.command("illegal-reversal"),
      kind: "transfer",
      sourceDigest: "2".repeat(64),
      reason: "local_restore_attempt"
    }),
    (error) => error?.code === "transfer_reversal_forbidden"
  );
});

test("unrecognized provider transfer state is retained as an operator review, never a local pin switch", async () => {
  const context = harness();
  context.state.lifecycle = {
    ...context.state.lifecycle,
    lifecycleStatus: "transferred_out",
    transferStatus: "completed",
    transferOperationId: "unknown-external-transfer",
    observedAt: "2026-08-11T12:00:00.000Z"
  };
  const projected = await refresh(context, "external-transfer");
  assert.equal(
    projected.customer.transfer.status,
    "external_completion_review"
  );
  assert.equal(
    projected.operator.review.reason,
    "unrecognized_external_transfer_completion"
  );
  assert.equal(
    projected.operator.transfer.providerPinRetainedAsHistory,
    true
  );
});

test("expiry rollback and same-time provider conflicts fail without changing retained state", async () => {
  const context = harness();
  await refresh(context);
  context.setNow("2026-08-11T12:01:00.000Z");
  context.state.lifecycle = {
    ...context.state.lifecycle,
    expirationDate: "2027-08-10T12:00:00.000Z",
    observedAt: "2026-08-11T12:01:00.000Z"
  };
  await assert.rejects(
    refresh(context, "expiry-rollback"),
    (error) => error?.code === "lifecycle_expiry_reversal_forbidden"
  );
  let retained = await context.repository.inspect({
    organizationId: context.scope.organizationId,
    projectId: context.scope.projectId,
    domain: DOMAIN
  });
  assert.equal(retained.authoritative.expirationDate, EXPIRY);

  context.state.lifecycle = {
    ...context.state.lifecycle,
    expirationDate: EXPIRY,
    observedAt: "2026-08-11T12:00:00.000Z",
    providerReference: "conflicting-provider-reference"
  };
  await assert.rejects(
    refresh(context, "same-time-conflict"),
    (error) => error?.code === "conflicting_lifecycle_readback"
  );
  retained = await context.repository.inspect({
    organizationId: context.scope.organizationId,
    projectId: context.scope.projectId,
    domain: DOMAIN
  });
  assert.equal(retained.authoritative.providerReferenceDigest, digest(
    "raw-provider-domain-reference"
  ));
});

test("customer and operator projections expose digests, not provider references or effects", async () => {
  const context = harness();
  assert.deepEqual(await context.repository.readiness(), {
    ready: true,
    mode: "memory_test_only",
    canonicalPersistence: false,
    providerEffects: false,
    paymentEffects: false,
    dnsEffects: false
  });
  await refresh(context);
  await quote(context);
  const retained = await context.repository.inspect({
    organizationId: context.scope.organizationId,
    projectId: context.scope.projectId,
    domain: context.pin.domain
  });
  assert.doesNotMatch(
    JSON.stringify(retained),
    /raw-provider-domain-reference|raw-renewal-quote-reference/u
  );
  const customer = await context.service.readProjection({
    scope: context.scope,
    pin: context.pin,
    audience: "customer"
  });
  const operator = await context.service.readProjection({
    scope: context.scope,
    pin: context.pin,
    audience: "operator"
  });
  const serialized = JSON.stringify({ customer, operator });
  assert.doesNotMatch(
    serialized,
    /raw-provider-domain-reference|raw-renewal-quote-reference/u
  );
  assert.match(operator.providerReferenceDigest, /^[a-f0-9]{64}$/u);
  assert.match(
    operator.renewal.quote.providerQuoteDigest,
    /^[a-f0-9]{64}$/u
  );
  assert.equal(customer.providerEffectsAuthorized, false);
  assert.equal(operator.paymentEffectsAuthorized, false);
  assert.deepEqual(Object.keys(context.service).sort(), [
    "quoteRenewal",
    "readProjection",
    "recordRenewalOutcome",
    "recordReversal",
    "recordTransferOutcome",
    "refreshAuthoritative",
    "reserveRenewal",
    "reserveTransfer"
  ]);
});
