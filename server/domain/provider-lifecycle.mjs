import {
  digest,
  exactMoney,
  normalizeDomain,
  requiredInteger,
  requiredString
} from "./canonical.mjs";
import { invariant } from "./errors.mjs";
import { DOMAIN_PROVIDER_PIN_SCHEMA } from "./provider-contingency.mjs";

export const DOMAIN_PROVIDER_LIFECYCLE_SCHEMA =
  "sitesourcery.domain-provider-lifecycle/v1";
export const DOMAIN_PROVIDER_LIFECYCLE_READBACK_SCHEMA =
  "sitesourcery.domain-provider-lifecycle-readback/v1";
export const DOMAIN_PROVIDER_RENEWAL_QUOTE_SCHEMA =
  "sitesourcery.domain-provider-renewal-quote/v1";
export const DOMAIN_PROVIDER_LIFECYCLE_OUTCOME_SCHEMA =
  "sitesourcery.domain-provider-lifecycle-outcome/v1";
export const DOMAIN_PROVIDER_LIFECYCLE_CUSTOMER_SCHEMA =
  "sitesourcery.domain-provider-lifecycle-customer/v1";
export const DOMAIN_PROVIDER_LIFECYCLE_OPERATOR_SCHEMA =
  "sitesourcery.domain-provider-lifecycle-operator/v1";

const PROVIDER_CODE = /^[a-z][a-z0-9_-]{1,63}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PRICE_CLASSES = new Set(["standard", "premium"]);
const LIFECYCLE_STATUSES = new Set([
  "active",
  "grace",
  "redemption",
  "expired",
  "transferred_out"
]);
const TRANSFER_STATUSES = new Set([
  "none",
  "pending",
  "cancelled",
  "completed"
]);
const OUTCOME_EFFECTS = new Set([
  "not_submitted",
  "submitted",
  "uncertain"
]);

function clone(value) {
  return value === null || value === undefined
    ? value
    : structuredClone(value);
}

function instant(value, field) {
  requiredString(value, field, 40);
  const milliseconds = Date.parse(value);
  invariant(
    Number.isFinite(milliseconds),
    "invalid_lifecycle_evidence",
    `${field} is invalid`,
    { status: 409 }
  );
  return new Date(milliseconds).toISOString();
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "invalid_lifecycle_evidence",
    `${field} is invalid`,
    { status: 409 }
  );
  return value;
}

function scopeOf(value) {
  invariant(
    value && typeof value === "object" &&
      value.actorId === value.customerId,
    "invalid_lifecycle_scope",
    "customer lifecycle scope is invalid",
    { status: 400 }
  );
  return Object.freeze({
    organizationId: requiredString(
      value.organizationId,
      "organizationId",
      128
    ),
    projectId: requiredString(value.projectId, "projectId", 128),
    customerId: requiredString(value.customerId, "customerId", 128),
    actorId: requiredString(value.actorId, "actorId", 128)
  });
}

function pinOf(value) {
  invariant(
    value?.schema === DOMAIN_PROVIDER_PIN_SCHEMA,
    "invalid_domain_provider_pin",
    "provider pin is required",
    { status: 409 }
  );
  const body = {
    schema: DOMAIN_PROVIDER_PIN_SCHEMA,
    providerCode: requiredString(value.providerCode, "pin.providerCode", 64),
    registrarOfRecord: requiredString(
      value.registrarOfRecord,
      "pin.registrarOfRecord",
      128
    ),
    domain: normalizeDomain(value.domain)
  };
  invariant(
    PROVIDER_CODE.test(body.providerCode) && value.fingerprint === digest(body),
    "invalid_domain_provider_pin",
    "provider pin evidence changed",
    { status: 409 }
  );
  return Object.freeze({ ...body, fingerprint: value.fingerprint });
}

function sameScope(left, right) {
  return left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.customerId === right.customerId;
}

function assertAggregate(aggregate, scope, pin) {
  invariant(
    aggregate?.schema === DOMAIN_PROVIDER_LIFECYCLE_SCHEMA &&
      sameScope(aggregate.scope, scope) &&
      aggregate.pin.fingerprint === pin.fingerprint &&
      aggregate.pin.domain === pin.domain &&
      aggregate.pin.providerCode === pin.providerCode,
    "domain_lifecycle_binding_mismatch",
    "lifecycle state does not match its customer and provider pin",
    { status: 409 }
  );
}

function initialAggregate(scope, pin, now) {
  return {
    schema: DOMAIN_PROVIDER_LIFECYCLE_SCHEMA,
    scope: clone(scope),
    pin: clone(pin),
    authoritative: null,
    renewal: {
      status: "idle",
      quote: null,
      attempt: null,
      reversal: null
    },
    transfer: {
      status: "idle",
      attempt: null,
      reversal: null
    },
    review: null,
    updatedAt: now
  };
}

function operationDigest(value, field) {
  if (value === undefined || value === null) return null;
  return digest(requiredString(value, field, 256));
}

function lifecycleReadback(value, pin, now) {
  invariant(
    value?.schema === DOMAIN_PROVIDER_LIFECYCLE_READBACK_SCHEMA &&
      value.authoritative === true &&
      value.providerCode === pin.providerCode &&
      normalizeDomain(value.domain) === pin.domain &&
      value.autoRenew === false &&
      LIFECYCLE_STATUSES.has(value.lifecycleStatus) &&
      TRANSFER_STATUSES.has(value.transferStatus),
    "invalid_lifecycle_readback",
    "provider lifecycle readback is not authoritative or pin-bound",
    { status: 409 }
  );
  const observedAt = instant(value.observedAt, "readback.observedAt");
  invariant(
    Date.parse(observedAt) <= Date.parse(now),
    "invalid_lifecycle_readback",
    "provider lifecycle readback is future-dated",
    { status: 409 }
  );
  const expirationDate = instant(
    value.expirationDate,
    "readback.expirationDate"
  );
  invariant(
    value.transferStatus !== "completed" ||
      value.lifecycleStatus === "transferred_out",
    "invalid_lifecycle_readback",
    "completed transfer readback must show transferred-out custody",
    { status: 409 }
  );
  const body = {
    schema: DOMAIN_PROVIDER_LIFECYCLE_READBACK_SCHEMA,
    providerCode: pin.providerCode,
    domain: pin.domain,
    authoritative: true,
    lifecycleStatus: value.lifecycleStatus,
    expirationDate,
    autoRenew: false,
    transferStatus: value.transferStatus,
    transferEligible: value.transferEligible === true,
    transferLocked: value.transferLocked === true,
    observedAt,
    providerReferenceDigest: digest(
      requiredString(value.providerReference, "providerReference", 256)
    ),
    renewalOperationDigest: operationDigest(
      value.renewalOperationId,
      "renewalOperationId"
    ),
    transferOperationDigest: operationDigest(
      value.transferOperationId,
      "transferOperationId"
    )
  };
  return Object.freeze({ ...body, evidenceDigest: digest(body) });
}

function renewalQuote(value, aggregate, years, now) {
  const authority = aggregate.authoritative;
  invariant(
    value?.schema === DOMAIN_PROVIDER_RENEWAL_QUOTE_SCHEMA &&
      value.status === "confirmation_required" &&
      value.noCharge === true &&
      value.providerCode === aggregate.pin.providerCode &&
      normalizeDomain(value.domain) === aggregate.pin.domain &&
      value.currentExpirationDate === authority.expirationDate,
    "invalid_renewal_quote",
    "provider renewal quote is not exact and lifecycle-bound",
    { status: 409 }
  );
  const observedAt = instant(value.observedAt, "renewalQuote.observedAt");
  const expiresAt = instant(value.expiresAt, "renewalQuote.expiresAt");
  invariant(
    Date.parse(observedAt) >= Date.parse(authority.observedAt) &&
      Date.parse(observedAt) <= Date.parse(now) &&
      Date.parse(expiresAt) > Date.parse(now),
    "renewal_quote_expired",
    "provider renewal quote is stale, future-dated, or expired",
    { status: 409 }
  );
  invariant(
    PRICE_CLASSES.has(value.priceClass),
    "invalid_renewal_quote",
    "provider renewal price class is not standard or premium",
    { status: 409 }
  );
  const body = {
    schema: DOMAIN_PROVIDER_RENEWAL_QUOTE_SCHEMA,
    providerCode: aggregate.pin.providerCode,
    domain: aggregate.pin.domain,
    years,
    currentExpirationDate: authority.expirationDate,
    priceClass: value.priceClass,
    price: exactMoney(value.price, "renewal quote"),
    providerQuoteDigest: digest(
      requiredString(value.quoteId, "renewalQuote.quoteId", 256)
    ),
    observedAt,
    expiresAt,
    noCharge: true,
    providerEffectsAuthorized: false,
    paymentEffectsAuthorized: false
  };
  return Object.freeze({ ...body, quoteFingerprint: digest(body) });
}

function lifecycleOutcome(value, kind, aggregate) {
  invariant(
    value?.schema === DOMAIN_PROVIDER_LIFECYCLE_OUTCOME_SCHEMA &&
      value.kind === kind &&
      value.providerCode === aggregate.pin.providerCode &&
      normalizeDomain(value.domain) === aggregate.pin.domain &&
      OUTCOME_EFFECTS.has(value.effect),
    "invalid_lifecycle_outcome",
    `provider ${kind} outcome is invalid`,
    { status: 409 }
  );
  const operationId = value.operationId === undefined || value.operationId === null
    ? null
    : requiredString(value.operationId, "outcome.operationId", 256);
  invariant(
    value.effect === "not_submitted" ? operationId === null : operationId !== null,
    "invalid_lifecycle_outcome",
    "provider lifecycle outcome operation evidence is inconsistent",
    { status: 409 }
  );
  const body = {
    schema: DOMAIN_PROVIDER_LIFECYCLE_OUTCOME_SCHEMA,
    kind,
    providerCode: aggregate.pin.providerCode,
    domain: aggregate.pin.domain,
    attemptId: requiredString(value.attemptId, "outcome.attemptId", 200),
    effect: value.effect,
    operationDigest: operationId === null ? null : digest(operationId),
    observedAt: instant(value.observedAt, "outcome.observedAt"),
    reason: requiredString(value.reason, "outcome.reason", 128)
  };
  return Object.freeze({ ...body, outcomeDigest: digest(body) });
}

function reconcileAggregate(aggregate, readback, now) {
  const prior = aggregate.authoritative;
  if (prior) {
    invariant(
      Date.parse(readback.observedAt) >= Date.parse(prior.observedAt),
      "stale_lifecycle_readback",
      "provider lifecycle readback is older than retained evidence",
      { status: 409 }
    );
    invariant(
      readback.observedAt !== prior.observedAt ||
        readback.evidenceDigest === prior.evidenceDigest,
      "conflicting_lifecycle_readback",
      "provider changed lifecycle evidence at the same observation time",
      { status: 409 }
    );
    invariant(
      Date.parse(readback.expirationDate) >= Date.parse(prior.expirationDate),
      "lifecycle_expiry_reversal_forbidden",
      "provider expiry moved backwards; manual reconciliation is required",
      { status: 409 }
    );
    invariant(
      prior.lifecycleStatus !== "transferred_out" ||
        readback.lifecycleStatus === "transferred_out",
      "lifecycle_custody_reversal_forbidden",
      "transferred-out custody cannot be locally restored",
      { status: 409 }
    );
  }
  const next = clone(aggregate);
  next.authoritative = clone(readback);
  next.updatedAt = now;
  next.review = null;

  const renewal = next.renewal;
  if (["submitted", "uncertain"].includes(renewal.status)) {
    const expiryAdvanced = Date.parse(readback.expirationDate) >
      Date.parse(renewal.attempt.baselineExpirationDate);
    if (expiryAdvanced) {
      if (
        readback.renewalOperationDigest ===
          renewal.attempt.operationDigest
      ) {
        renewal.status = "succeeded";
        renewal.attempt.completedAt = now;
        renewal.attempt.completionEvidenceDigest = readback.evidenceDigest;
      } else {
        next.review = {
          reason: "renewal_expiry_changed_without_matching_operation",
          custodyUnchanged: true
        };
      }
    }
  }

  const transfer = next.transfer;
  if (["submitted", "uncertain"].includes(transfer.status)) {
    const matches = readback.transferOperationDigest ===
      transfer.attempt.operationDigest;
    if (readback.transferStatus === "completed") {
      if (matches) {
        transfer.status = "completed";
        transfer.attempt.completedAt = now;
        transfer.attempt.completionEvidenceDigest = readback.evidenceDigest;
      } else {
        next.review = {
          reason: "transfer_completed_without_matching_operation",
          providerPinRetainedAsHistory: true
        };
      }
    } else if (readback.transferStatus === "cancelled") {
      if (matches) {
        transfer.status = "cancelled";
        transfer.attempt.completedAt = now;
        transfer.attempt.completionEvidenceDigest = readback.evidenceDigest;
      } else {
        next.review = {
          reason: "transfer_cancelled_without_matching_operation",
          providerPinRetained: true
        };
      }
    }
  }
  if (
    readback.transferStatus === "pending" &&
    transfer.status === "idle"
  ) {
    transfer.status = "external_pending_review";
    next.review = {
      reason: "unrecognized_external_transfer_pending",
      providerPinRetained: true,
      automaticRetry: false
    };
  }
  if (
    readback.transferStatus === "completed" &&
    transfer.status !== "completed"
  ) {
    transfer.status = "external_completion_review";
    next.review = {
      reason: "unrecognized_external_transfer_completion",
      providerPinRetainedAsHistory: true,
      automaticRetry: false
    };
  }
  return next;
}

function safeQuote(value) {
  if (!value) return null;
  return Object.freeze({
    years: value.years,
    currentExpirationDate: value.currentExpirationDate,
    priceClass: value.priceClass,
    price: clone(value.price),
    observedAt: value.observedAt,
    expiresAt: value.expiresAt,
    quoteFingerprint: value.quoteFingerprint,
    providerQuoteDigest: value.providerQuoteDigest
  });
}

function safeAttempt(value) {
  if (!value) return null;
  return Object.freeze({
    attemptId: value.attemptId,
    commandFingerprint: value.commandFingerprint,
    outcomeDigest: value.outcomeDigest ?? null,
    operationDigest: value.operationDigest ?? null,
    baselineExpirationDate: value.baselineExpirationDate,
    reservedAt: value.reservedAt,
    completedAt: value.completedAt ?? null,
    completionEvidenceDigest: value.completionEvidenceDigest ?? null
  });
}

function customerProjection(aggregate) {
  const body = {
    schema: DOMAIN_PROVIDER_LIFECYCLE_CUSTOMER_SCHEMA,
    domain: aggregate.pin.domain,
    registrarOfRecord: aggregate.pin.registrarOfRecord,
    lifecycleStatus: aggregate.authoritative?.lifecycleStatus ?? "unverified",
    expirationDate: aggregate.authoritative?.expirationDate ?? null,
    autoRenew: false,
    renewal: {
      status: aggregate.renewal.status,
      quote: safeQuote(aggregate.renewal.quote),
      custodyUnchanged:
        aggregate.renewal.reversal?.custodyUnchanged ?? true
    },
    transfer: {
      status: aggregate.transfer.status,
      eligible: aggregate.authoritative?.transferEligible ?? false,
      locked: aggregate.authoritative?.transferLocked ?? true,
      providerPinRetained:
        aggregate.transfer.status !== "completed"
    },
    review: clone(aggregate.review),
    providerEffectsAuthorized: false,
    paymentEffectsAuthorized: false,
    dnsEffectsAuthorized: false
  };
  return Object.freeze({ ...body, projectionDigest: digest(body) });
}

function operatorProjection(aggregate) {
  const body = {
    schema: DOMAIN_PROVIDER_LIFECYCLE_OPERATOR_SCHEMA,
    domain: aggregate.pin.domain,
    providerCode: aggregate.pin.providerCode,
    registrarOfRecord: aggregate.pin.registrarOfRecord,
    providerPinFingerprint: aggregate.pin.fingerprint,
    lifecycleStatus: aggregate.authoritative?.lifecycleStatus ?? "unverified",
    expirationDate: aggregate.authoritative?.expirationDate ?? null,
    lifecycleEvidenceDigest:
      aggregate.authoritative?.evidenceDigest ?? null,
    lifecycleObservedAt: aggregate.authoritative?.observedAt ?? null,
    providerReferenceDigest:
      aggregate.authoritative?.providerReferenceDigest ?? null,
    renewal: {
      status: aggregate.renewal.status,
      quote: safeQuote(aggregate.renewal.quote),
      attempt: safeAttempt(aggregate.renewal.attempt),
      reversal: clone(aggregate.renewal.reversal)
    },
    transfer: {
      status: aggregate.transfer.status,
      attempt: safeAttempt(aggregate.transfer.attempt),
      reversal: clone(aggregate.transfer.reversal),
      providerPinRetainedAsHistory: true
    },
    review: clone(aggregate.review),
    providerEffectsAuthorized: false,
    paymentEffectsAuthorized: false,
    dnsEffectsAuthorized: false
  };
  return Object.freeze({ ...body, projectionDigest: digest(body) });
}

function resultOf(aggregate, replayed = false) {
  return Object.freeze({
    replayed,
    customer: customerProjection(aggregate),
    operator: operatorProjection(aggregate)
  });
}

function commandFingerprint(kind, input) {
  return digest({ schema: "sitesourcery.domain-lifecycle-command/v1", kind, ...input });
}

export function createHeldDomainProviderLifecycle({
  repository,
  providerReadPort,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  invariant(
    repository &&
      typeof repository.transact === "function" &&
      typeof repository.read === "function" &&
      providerReadPort &&
      typeof providerReadPort.readLifecycle === "function" &&
      typeof providerReadPort.previewRenewal === "function" &&
      typeof clock?.now === "function",
    "invalid_lifecycle_configuration",
    "held provider lifecycle boundary is not configured",
    { status: 500 }
  );

  async function refreshAuthoritative({ scope, pin, commandId } = {}) {
    const selectedScope = scopeOf(scope);
    const selectedPin = pinOf(pin);
    const now = instant(clock.now(), "current time");
    const raw = await providerReadPort.readLifecycle({
      providerCode: selectedPin.providerCode,
      domain: selectedPin.domain
    });
    const readback = lifecycleReadback(raw, selectedPin, now);
    const fingerprint = commandFingerprint("refresh", {
      scope: selectedScope,
      pinFingerprint: selectedPin.fingerprint
    });
    const executed = await repository.transact({
      scope: selectedScope,
      domain: selectedPin.domain,
      commandId,
      commandFingerprint: fingerprint,
      initialize: () => initialAggregate(selectedScope, selectedPin, now),
      apply(current) {
        const aggregate = current ?? initialAggregate(selectedScope, selectedPin, now);
        assertAggregate(aggregate, selectedScope, selectedPin);
        const next = reconcileAggregate(aggregate, readback, now);
        return { state: next, result: resultOf(next) };
      }
    });
    return Object.freeze({
      ...executed.result,
      replayed: executed.replayed
    });
  }

  async function quoteRenewal({
    scope,
    pin,
    commandId,
    years = 1
  } = {}) {
    const selectedScope = scopeOf(scope);
    const selectedPin = pinOf(pin);
    const period = requiredInteger(years, "years", { minimum: 1, maximum: 10 });
    const current = await repository.read({
      scope: selectedScope,
      domain: selectedPin.domain
    });
    assertAggregate(current, selectedScope, selectedPin);
    invariant(
      current.authoritative &&
        ["active", "grace"].includes(current.authoritative.lifecycleStatus) &&
        !["dispatching", "submitted", "uncertain", "reversal_review"].includes(
          current.renewal.status
        ) &&
        !["dispatching", "submitted", "uncertain"].includes(
          current.transfer.status
        ),
      "renewal_not_available",
      "renewal quote is held by current lifecycle state",
      { status: 409 }
    );
    const now = instant(clock.now(), "current time");
    const raw = await providerReadPort.previewRenewal({
      providerCode: selectedPin.providerCode,
      domain: selectedPin.domain,
      years: period,
      currentExpirationDate: current.authoritative.expirationDate
    });
    const quote = renewalQuote(raw, current, period, now);
    const fingerprint = commandFingerprint("quote_renewal", {
      scope: selectedScope,
      pinFingerprint: selectedPin.fingerprint,
      years: period
    });
    const executed = await repository.transact({
      scope: selectedScope,
      domain: selectedPin.domain,
      commandId,
      commandFingerprint: fingerprint,
      apply(aggregate) {
        assertAggregate(aggregate, selectedScope, selectedPin);
        const next = clone(aggregate);
        next.renewal = {
          status: "quoted",
          quote: clone(quote),
          attempt: null,
          reversal: null
        };
        next.updatedAt = now;
        next.review = null;
        return { state: next, result: resultOf(next) };
      }
    });
    return Object.freeze({ ...executed.result, replayed: executed.replayed });
  }

  async function reserveRenewal({
    scope,
    pin,
    commandId,
    attemptId,
    quoteFingerprint,
    consentDigest
  } = {}) {
    const selectedScope = scopeOf(scope);
    const selectedPin = pinOf(pin);
    const attempt = requiredString(attemptId, "attemptId", 200);
    const acceptedQuote = sha256(quoteFingerprint, "quoteFingerprint");
    const consent = sha256(consentDigest, "consentDigest");
    const now = instant(clock.now(), "current time");
    const fingerprint = commandFingerprint("reserve_renewal", {
      scope: selectedScope,
      pinFingerprint: selectedPin.fingerprint,
      attemptId: attempt,
      quoteFingerprint: acceptedQuote,
      consentDigest: consent
    });
    const executed = await repository.transact({
      scope: selectedScope,
      domain: selectedPin.domain,
      commandId,
      commandFingerprint: fingerprint,
      apply(aggregate) {
        assertAggregate(aggregate, selectedScope, selectedPin);
        invariant(
          aggregate.renewal.status === "quoted" &&
            aggregate.renewal.quote.quoteFingerprint === acceptedQuote &&
            Date.parse(aggregate.renewal.quote.expiresAt) > Date.parse(now),
          "renewal_quote_mismatch",
          "renewal reservation requires the exact fresh quote",
          { status: 409 }
        );
        const next = clone(aggregate);
        next.renewal.status = "dispatching";
        next.renewal.attempt = {
          attemptId: attempt,
          commandFingerprint: fingerprint,
          consentDigest: consent,
          quoteFingerprint: acceptedQuote,
          baselineExpirationDate: aggregate.authoritative.expirationDate,
          reservedAt: now,
          operationDigest: null,
          outcomeDigest: null,
          completedAt: null,
          completionEvidenceDigest: null
        };
        next.updatedAt = now;
        const result = {
          ...resultOf(next),
          reservation: Object.freeze({
            schema: "sitesourcery.domain-renewal-reservation/v1",
            kind: "renewal",
            attemptId: attempt,
            domain: selectedPin.domain,
            providerCode: selectedPin.providerCode,
            quoteFingerprint: acceptedQuote,
            consentDigest: consent,
            providerEffectsAuthorized: false,
            paymentEffectsAuthorized: false
          })
        };
        return { state: next, result };
      }
    });
    return Object.freeze({ ...executed.result, replayed: executed.replayed });
  }

  async function recordOutcome(kind, {
    scope,
    pin,
    commandId,
    outcome
  } = {}) {
    const selectedScope = scopeOf(scope);
    const selectedPin = pinOf(pin);
    const current = await repository.read({
      scope: selectedScope,
      domain: selectedPin.domain
    });
    assertAggregate(current, selectedScope, selectedPin);
    const selectedOutcome = lifecycleOutcome(outcome, kind, current);
    const fingerprint = commandFingerprint(`record_${kind}_outcome`, {
      scope: selectedScope,
      pinFingerprint: selectedPin.fingerprint,
      outcomeDigest: selectedOutcome.outcomeDigest
    });
    const now = instant(clock.now(), "current time");
    const executed = await repository.transact({
      scope: selectedScope,
      domain: selectedPin.domain,
      commandId,
      commandFingerprint: fingerprint,
      apply(aggregate) {
        assertAggregate(aggregate, selectedScope, selectedPin);
        const target = aggregate[kind];
        invariant(
          target.status === "dispatching" &&
            target.attempt?.attemptId === selectedOutcome.attemptId,
          "lifecycle_attempt_mismatch",
          `${kind} outcome does not match the reserved attempt`,
          { status: 409 }
        );
        invariant(
          Date.parse(selectedOutcome.observedAt) >=
              Date.parse(target.attempt.reservedAt) &&
            Date.parse(selectedOutcome.observedAt) <= Date.parse(now),
          "invalid_lifecycle_outcome",
          `${kind} outcome is stale or future-dated`,
          { status: 409 }
        );
        const next = clone(aggregate);
        next[kind].status = selectedOutcome.effect;
        next[kind].attempt.operationDigest = selectedOutcome.operationDigest;
        next[kind].attempt.outcomeDigest = selectedOutcome.outcomeDigest;
        if (selectedOutcome.effect === "not_submitted") {
          next[kind].attempt.completedAt = now;
        }
        next.updatedAt = now;
        next.review = selectedOutcome.effect === "uncertain"
          ? {
              reason: `${kind}_provider_effect_ambiguous`,
              automaticRetry: false,
              providerPinRetained: true
            }
          : null;
        return { state: next, result: resultOf(next) };
      }
    });
    return Object.freeze({ ...executed.result, replayed: executed.replayed });
  }

  async function reserveTransfer({
    scope,
    pin,
    commandId,
    attemptId,
    consentDigest
  } = {}) {
    const selectedScope = scopeOf(scope);
    const selectedPin = pinOf(pin);
    const attempt = requiredString(attemptId, "attemptId", 200);
    const consent = sha256(consentDigest, "consentDigest");
    const now = instant(clock.now(), "current time");
    const fingerprint = commandFingerprint("reserve_transfer", {
      scope: selectedScope,
      pinFingerprint: selectedPin.fingerprint,
      attemptId: attempt,
      consentDigest: consent
    });
    const executed = await repository.transact({
      scope: selectedScope,
      domain: selectedPin.domain,
      commandId,
      commandFingerprint: fingerprint,
      apply(aggregate) {
        assertAggregate(aggregate, selectedScope, selectedPin);
        invariant(
          aggregate.authoritative &&
            ["active", "grace"].includes(
              aggregate.authoritative.lifecycleStatus
            ) &&
            aggregate.authoritative.transferEligible === true &&
            ["none", "cancelled"].includes(
              aggregate.authoritative.transferStatus
            ) &&
            ["idle", "cancelled", "not_submitted"].includes(
              aggregate.transfer.status
            ) &&
            !["dispatching", "submitted", "uncertain"].includes(
              aggregate.renewal.status
            ),
          "transfer_not_available",
          "transfer is held by authoritative lifecycle state",
          { status: 409 }
        );
        const next = clone(aggregate);
        next.transfer = {
          status: "dispatching",
          attempt: {
            attemptId: attempt,
            commandFingerprint: fingerprint,
            consentDigest: consent,
            baselineExpirationDate: aggregate.authoritative.expirationDate,
            reservedAt: now,
            operationDigest: null,
            outcomeDigest: null,
            completedAt: null,
            completionEvidenceDigest: null
          },
          reversal: null
        };
        next.updatedAt = now;
        const result = {
          ...resultOf(next),
          reservation: Object.freeze({
            schema: "sitesourcery.domain-transfer-reservation/v1",
            kind: "transfer",
            attemptId: attempt,
            domain: selectedPin.domain,
            providerCode: selectedPin.providerCode,
            consentDigest: consent,
            providerEffectsAuthorized: false,
            paymentEffectsAuthorized: false
          })
        };
        return { state: next, result };
      }
    });
    return Object.freeze({ ...executed.result, replayed: executed.replayed });
  }

  async function recordReversal({
    scope,
    pin,
    commandId,
    kind,
    sourceDigest,
    reason
  } = {}) {
    invariant(
      ["renewal", "transfer"].includes(kind),
      "invalid_lifecycle_reversal",
      "lifecycle reversal kind is invalid",
      { status: 400 }
    );
    const selectedScope = scopeOf(scope);
    const selectedPin = pinOf(pin);
    const source = sha256(sourceDigest, "sourceDigest");
    const selectedReason = requiredString(reason, "reason", 128);
    const now = instant(clock.now(), "current time");
    const fingerprint = commandFingerprint("record_reversal", {
      scope: selectedScope,
      pinFingerprint: selectedPin.fingerprint,
      kind,
      sourceDigest: source,
      reason: selectedReason
    });
    const executed = await repository.transact({
      scope: selectedScope,
      domain: selectedPin.domain,
      commandId,
      commandFingerprint: fingerprint,
      apply(aggregate) {
        assertAggregate(aggregate, selectedScope, selectedPin);
        if (kind === "renewal") {
          invariant(
            aggregate.renewal.status === "succeeded",
            "renewal_reversal_not_available",
            "only an authoritatively completed renewal can enter reversal review",
            { status: 409 }
          );
        } else {
          invariant(
            aggregate.transfer.status !== "completed",
            "transfer_reversal_forbidden",
            "completed transfer custody cannot be locally reversed",
            { status: 409 }
          );
          invariant(
            aggregate.transfer.status === "cancelled",
            "transfer_cancellation_readback_required",
            "authoritative provider cancellation is required before transfer reversal",
            { status: 409 }
          );
        }
        const next = clone(aggregate);
        next[kind].status = "reversal_review";
        next[kind].reversal = {
          sourceDigest: source,
          reason: selectedReason,
          recordedAt: now,
          custodyUnchanged: true,
          expiryUnchanged: true
        };
        next.review = {
          reason: `${kind}_financial_reversal_requires_manual_resolution`,
          automaticRetry: false,
          providerPinRetained: true
        };
        next.updatedAt = now;
        return { state: next, result: resultOf(next) };
      }
    });
    return Object.freeze({ ...executed.result, replayed: executed.replayed });
  }

  async function readProjection({ scope, pin, audience } = {}) {
    const selectedScope = scopeOf(scope);
    const selectedPin = pinOf(pin);
    const aggregate = await repository.read({
      scope: selectedScope,
      domain: selectedPin.domain
    });
    assertAggregate(aggregate, selectedScope, selectedPin);
    invariant(
      audience === "customer" || audience === "operator",
      "invalid_lifecycle_audience",
      "lifecycle projection audience is invalid",
      { status: 400 }
    );
    return audience === "customer"
      ? customerProjection(aggregate)
      : operatorProjection(aggregate);
  }

  return Object.freeze({
    refreshAuthoritative,
    quoteRenewal,
    reserveRenewal,
    recordRenewalOutcome: (input) => recordOutcome("renewal", input),
    reserveTransfer,
    recordTransferOutcome: (input) => recordOutcome("transfer", input),
    recordReversal,
    readProjection
  });
}
