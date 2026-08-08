import {
  deepFreeze,
  invariant,
  requiredIso,
  requiredText
} from "../commerce-v2/canonical.mjs";
import {
  exactAlakazamBillingScope
} from "./alakazam-billing-invoice.mjs";

export const ALAKAZAM_BILLING_STATES_SCHEMA =
  "sitesourcery.alakazam-billing-states/v1";

const SUBSCRIPTION_STATES = new Set([
  "pending",
  "active",
  "grace",
  "suspended",
  "cancelled",
  "ended"
]);
const PAYMENT_STATES = Object.freeze({
  pending: "pending",
  active: "current",
  grace: "retrying",
  suspended: "suspended",
  cancelled: "ended",
  ended: "ended"
});
const RECONCILIATION_KINDS = new Set([
  "tier_change",
  "downgrade_schedule"
]);

function record(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value)
  );
}

function exactKeys(value, expected, field) {
  invariant(
    record(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return value;
}

function count(value, field) {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return value;
}

function nullableIso(value, field) {
  return value === null ? null : requiredIso(value, field);
}

function exactStoredSubscription(value) {
  if (value === null) return null;
  exactKeys(
    value,
    [
      "firstFailedAt",
      "graceEndsAt",
      "providerObservedAt",
      "revision",
      "status",
      "updatedAt"
    ],
    "billingStates.subscription"
  );
  const status = requiredText(
    value.status,
    "billingStates.subscription.status",
    50
  );
  invariant(
    SUBSCRIPTION_STATES.has(status) &&
      Number.isSafeInteger(value.revision) &&
      value.revision > 0,
    "repository_conflict",
    "the customer Alakazam subscription state changed",
    { status: 500 }
  );
  const firstFailedAt = nullableIso(
    value.firstFailedAt,
    "billingStates.subscription.firstFailedAt"
  );
  const graceEndsAt = nullableIso(
    value.graceEndsAt,
    "billingStates.subscription.graceEndsAt"
  );
  invariant(
    graceEndsAt === null || firstFailedAt !== null,
    "repository_conflict",
    "the customer Alakazam grace period changed",
    { status: 500 }
  );
  return Object.freeze({
    status,
    revision: value.revision,
    firstFailedAt,
    graceEndsAt,
    providerObservedAt: requiredIso(
      value.providerObservedAt,
      "billingStates.subscription.providerObservedAt"
    ),
    updatedAt: requiredIso(
      value.updatedAt,
      "billingStates.subscription.updatedAt"
    )
  });
}

function exactStoredEvents(value) {
  exactKeys(
    value,
    [
      "failed",
      "lastOccurredAt",
      "lastProcessedAt",
      "maximumAttemptCount",
      "outstanding",
      "total"
    ],
    "billingStates.events"
  );
  const total = count(
    value.total,
    "billingStates.events.total"
  );
  const outstanding = count(
    value.outstanding,
    "billingStates.events.outstanding"
  );
  const failed = count(
    value.failed,
    "billingStates.events.failed"
  );
  invariant(
    failed <= outstanding && outstanding <= total,
    "repository_conflict",
    "the customer Alakazam provider event counts changed",
    { status: 500 }
  );
  return Object.freeze({
    total,
    outstanding,
    failed,
    maximumAttemptCount: count(
      value.maximumAttemptCount,
      "billingStates.events.maximumAttemptCount"
    ),
    lastOccurredAt: nullableIso(
      value.lastOccurredAt,
      "billingStates.events.lastOccurredAt"
    ),
    lastProcessedAt: nullableIso(
      value.lastProcessedAt,
      "billingStates.events.lastProcessedAt"
    )
  });
}

function exactStoredReconciliation(value) {
  exactKeys(
    value,
    ["kind", "since"],
    "billingStates.reconciliation"
  );
  const kind = value.kind;
  invariant(
    kind === null || RECONCILIATION_KINDS.has(kind),
    "repository_conflict",
    "the customer Alakazam reconciliation state changed",
    { status: 500 }
  );
  const since = nullableIso(
    value.since,
    "billingStates.reconciliation.since"
  );
  invariant(
    (kind === null) === (since === null),
    "repository_conflict",
    "the customer Alakazam reconciliation binding changed",
    { status: 500 }
  );
  return Object.freeze({ kind, since });
}

/**
 * E-09. Projects the true retry, replay, and reconciliation state of one
 * customer's Alakazam billing.
 *
 * `observedAt` and `revision` are the anti-stale contract: a reader must never
 * render a payload whose `revision` is lower, or whose `observedAt` is older,
 * than one it has already shown. A webhook replay therefore cannot move the
 * account view backwards, and a payment retry is visible as soon as the
 * durable record carries it.
 */
export function projectAlakazamBillingStates(
  storedInput,
  scopeInput
) {
  const scope = exactAlakazamBillingScope(
    scopeInput,
    "scope"
  );
  exactKeys(
    storedInput,
    [
      "events",
      "observedAt",
      "projectId",
      "reconciliation",
      "subscription"
    ],
    "billingStates"
  );
  invariant(
    storedInput.projectId === scope.projectId,
    "repository_conflict",
    "the customer Alakazam billing state binding changed",
    { status: 500 }
  );
  const observedAt = requiredIso(
    storedInput.observedAt,
    "billingStates.observedAt"
  );
  const subscription = exactStoredSubscription(
    storedInput.subscription
  );
  const events = exactStoredEvents(storedInput.events);
  const reconciliation = exactStoredReconciliation(
    storedInput.reconciliation
  );
  invariant(
    subscription !== null || events.total === 0,
    "repository_conflict",
    "the customer Alakazam provider events are unbound",
    { status: 500 }
  );
  const paymentState = subscription
    ? PAYMENT_STATES[subscription.status]
    : "none";
  const retrying = paymentState === "retrying";
  const replayState = events.failed > 0
    ? "attention_required"
    : events.outstanding > 0
      ? "verifying"
      : "settled";
  return deepFreeze({
    schema: ALAKAZAM_BILLING_STATES_SCHEMA,
    projectId: scope.projectId,
    observedAt,
    revision: subscription ? subscription.revision : 0,
    providerObservedAt: subscription
      ? subscription.providerObservedAt
      : null,
    payment: {
      state: paymentState,
      subscriptionStatus: subscription
        ? subscription.status
        : null,
      retry: {
        active: retrying,
        startedAt: subscription
          ? subscription.firstFailedAt
          : null,
        graceEndsAt: subscription
          ? subscription.graceEndsAt
          : null
      }
    },
    replay: {
      state: replayState,
      outstanding: events.outstanding,
      failed: events.failed,
      processedThrough: events.lastProcessedAt,
      lastEventAt: events.lastOccurredAt,
      // ss.alakazam_stripe_events is unique on stripe_event_id, so a replayed
      // provider delivery is recorded once and re-processing raises the
      // attempt count instead of duplicating any settlement.
      duplicateSuppressed: true,
      maximumAttempts: events.maximumAttemptCount
    },
    reconciliation: {
      state: reconciliation.kind === null
        ? "none"
        : "required",
      kind: reconciliation.kind,
      since: reconciliation.since
    },
    display: {
      attentionRequired:
        retrying ||
        replayState === "attention_required" ||
        reconciliation.kind !== null ||
        paymentState === "suspended",
      settled:
        !retrying &&
        replayState === "settled" &&
        reconciliation.kind === null
    }
  });
}

/**
 * The anti-stale rule, exported so the account view and its tests share one
 * definition. `next` may replace `current` only when it is strictly newer.
 */
export function alakazamBillingStatesAreNewer(next, current) {
  if (!record(current)) return record(next);
  if (!record(next)) return false;
  if (next.revision !== current.revision) {
    return next.revision > current.revision;
  }
  return (
    Date.parse(next.observedAt) >
    Date.parse(current.observedAt)
  );
}
