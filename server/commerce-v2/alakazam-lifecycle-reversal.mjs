import { createHash } from "node:crypto";

import {
  createAlakazamBillingRelease
} from "./alakazam-billing.mjs";
import {
  createAlakazamLifecyclePolicy,
  exactAlakazamLifecyclePolicy
} from "./alakazam-lifecycle-policy.mjs";
import {
  clone,
  deepFreeze,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_]+$/u;
const CHARGE_ID = /^ch_[A-Za-z0-9_]+$/u;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/u;
const REFUND_ID = /^re_[A-Za-z0-9_]+$/u;
const DISPUTE_ID = /^dp_[A-Za-z0-9_]+$/u;

export const ALAKAZAM_REVERSAL_FACTS_SCHEMA =
  "sitesourcery.stripe-alakazam-reversal/v1";
export const ALAKAZAM_REVERSAL_DECISION_SCHEMA =
  "sitesourcery.alakazam-reversal-decision/v1";
export const ALAKAZAM_REVERSAL_SUBSCRIPTION_SCHEMA =
  "sitesourcery.alakazam-reversal-subscription/v1";

export const ALAKAZAM_REVERSAL_EVENT_TYPES = Object.freeze([
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated"
]);

const REVERSAL_EVENT_TYPES = new Set(
  ALAKAZAM_REVERSAL_EVENT_TYPES
);

/**
 * How bad each observed outcome is for Site Sourcery, as one
 * monotonic ladder. The stored severity for a charge is the highest
 * value ever observed: a dispute won or funds reinstated is recorded
 * as recovery evidence but never lowers what already happened.
 */
export const ALAKAZAM_REVERSAL_SEVERITY = Object.freeze({
  refund_failed: 10,
  dispute_won: 20,
  dispute_open: 30,
  refund_partial: 40,
  dispute_funds_reinstated: 50,
  refund_full: 60,
  dispute_funds_withdrawn: 70,
  dispute_lost: 80
});

// Outcomes where money has actually left Site Sourcery. Only these
// carry the owner's ruled refund consequence.
const FUNDS_LEFT = new Set([
  "refund_partial",
  "refund_full",
  "dispute_funds_withdrawn",
  "dispute_lost"
]);

const DISPUTE_OUTCOMES = new Set([
  "dispute_open",
  "dispute_won",
  "dispute_lost",
  "dispute_funds_withdrawn",
  "dispute_funds_reinstated"
]);

const SUSPENDABLE_STATES = new Set([
  "active",
  "grace"
]);

function exactKeys(value, expected, code, message) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    code,
    message
  );
  return value;
}

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function exactClock(clock) {
  const value = clock.now();
  return requiredIso(
    value instanceof Date
      ? value.toISOString()
      : String(value ?? ""),
    "clock.now"
  );
}

function exactRelease(value) {
  const expected = createAlakazamBillingRelease({
    approved: value?.approved,
    taxMode: value?.taxMode ?? null
  });
  invariant(
    value && JSON.stringify(value) === JSON.stringify(expected),
    "invalid_configuration",
    "Alakazam reversal release does not match the reviewed billing contract",
    { status: 500 }
  );
  return expected;
}

const SERVICE_STATES = Object.freeze({
  record_only: "unchanged",
  owner_review: "unchanged",
  restrict_publication: "limited",
  suspend_service: "suspended"
});

/**
 * Decide the defensive consequence of one observed reversal.
 *
 * Three rules are absolute and hold whatever the owner rules:
 *
 *  1. Nothing here initiates, offers, or schedules a refund.
 *  2. A dispute won, a failed refund, or reinstated funds NEVER
 *     restores service on its own. Restoration has to prove the
 *     recurring account is current, which is the recovery path.
 *  3. Severity is monotonic per charge.
 *
 * With no dated ruling the decision is owner review and nothing else.
 */
export function decideAlakazamReversalConsequence({
  policy,
  outcome,
  subscriptionStatus,
  currentSeverity = 0
} = {}) {
  const authority = exactAlakazamLifecyclePolicy(policy);
  const severity = ALAKAZAM_REVERSAL_SEVERITY[outcome];
  invariant(
    Number.isSafeInteger(severity),
    "invalid_input",
    "the Alakazam reversal outcome is unknown"
  );
  invariant(
    Number.isSafeInteger(currentSeverity) &&
      currentSeverity >= 0,
    "invalid_input",
    "the current Alakazam reversal severity is invalid"
  );
  const kind = DISPUTE_OUTCOMES.has(outcome)
    ? "dispute"
    : "refund";
  const resultingSeverity = Math.max(
    severity,
    currentSeverity
  );
  const held = deepFreeze({
    schema: ALAKAZAM_REVERSAL_DECISION_SCHEMA,
    outcome,
    reversalKind: kind,
    severity: resultingSeverity,
    observedSeverity: severity,
    from: subscriptionStatus,
    to: subscriptionStatus,
    tierEventKind: null,
    consequence: "owner_review",
    serviceState: "unchanged",
    ownerReviewRequired: true,
    policyVersion: null,
    // There is no customer refund offer, control, or API anywhere in
    // this lane. The customer sees an account-attention fact only.
    customerRefundOffered: false,
    reason: "policy_decision_required"
  });
  if (!authority.approved) return held;

  const ruled =
    kind === "dispute"
      ? authority.disputeConsequence
      : authority.refundConsequence;
  // A refund only carries its consequence once money actually left.
  // An open dispute already carries the dispute consequence because
  // that is what the owner ruled a dispute means.
  const engaged =
    kind === "dispute" ? true : FUNDS_LEFT.has(outcome);
  const applies =
    engaged &&
    ruled === "suspend_service" &&
    SUSPENDABLE_STATES.has(subscriptionStatus);
  return deepFreeze({
    schema: ALAKAZAM_REVERSAL_DECISION_SCHEMA,
    outcome,
    reversalKind: kind,
    severity: resultingSeverity,
    observedSeverity: severity,
    from: subscriptionStatus,
    to: applies ? "suspended" : subscriptionStatus,
    tierEventKind: applies ? "suspended" : null,
    consequence: engaged ? ruled : "record_only",
    serviceState: engaged
      ? SERVICE_STATES[ruled]
      : "unchanged",
    // Owner review always stays on for anything worse than a failed
    // refund. A machine never closes a money dispute.
    ownerReviewRequired: severity > ALAKAZAM_REVERSAL_SEVERITY
      .refund_failed,
    policyVersion: authority.policyVersion,
    customerRefundOffered: false,
    reason: "policy_applied"
  });
}

export function isAlakazamReversalEvent(event) {
  const object = event?.data?.object;
  return (
    REVERSAL_EVENT_TYPES.has(event?.type) &&
    object &&
    typeof object === "object" &&
    !Array.isArray(object) &&
    reversalChargeId(object) !== null &&
    reversalPaymentIntentId(object) !== null
  );
}

function firstMatching(candidates, pattern) {
  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      pattern.test(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

function reversalChargeId(object) {
  return firstMatching(
    [object?.charge, object?.charge?.id, object?.id],
    CHARGE_ID
  );
}

// Used ONLY to find the durable local owner. It never decides money;
// every amount comes from the readback below.
function reversalPaymentIntentId(object) {
  return firstMatching(
    [
      object?.payment_intent,
      object?.payment_intent?.id,
      object?.charge?.payment_intent
    ],
    PAYMENT_INTENT_ID
  );
}

function exactEvent(value, verifiedAt) {
  invariant(
    value &&
      EVENT_ID.test(value.id) &&
      REVERSAL_EVENT_TYPES.has(value.type) &&
      typeof value.livemode === "boolean" &&
      typeof value.api_version === "string" &&
      value.api_version.length >= 3 &&
      value.api_version.length <= 100 &&
      Number.isSafeInteger(value.created) &&
      value.created > 0 &&
      value.data?.object &&
      typeof value.data.object === "object",
    "stripe_event_invalid",
    "The verified Alakazam reversal event is invalid",
    { status: 400 }
  );
  const stripeChargeId = reversalChargeId(value.data.object);
  const stripePaymentIntentId = reversalPaymentIntentId(
    value.data.object
  );
  invariant(
    stripeChargeId !== null &&
      stripePaymentIntentId !== null,
    "stripe_event_invalid",
    "The verified Alakazam reversal event has no Charge and PaymentIntent",
    { status: 400 }
  );
  return deepFreeze({
    stripeEventId: value.id,
    eventType: value.type,
    livemode: value.livemode,
    apiVersion: value.api_version,
    stripeChargeId,
    stripePaymentIntentId,
    payloadDigest: createHash("sha256")
      .update(JSON.stringify(value), "utf8")
      .digest("hex"),
    signatureVerifiedAt: verifiedAt,
    occurredAt: new Date(value.created * 1000).toISOString()
  });
}

export function exactReversalSubscription(value) {
  exactKeys(
    value,
    [
      "creditApplicationId",
      "currency",
      "customerId",
      "localSubscriptionId",
      "paymentReceiptId",
      "projectId",
      "receiptTotalMinor",
      "revision",
      "schema",
      "status",
      "stripePaymentIntentId",
      "tenantId",
      "tierId"
    ],
    "repository_conflict",
    "the durable Alakazam reversal subscription is invalid"
  );
  invariant(
    value.schema ===
        ALAKAZAM_REVERSAL_SUBSCRIPTION_SCHEMA &&
      UUID.test(value.localSubscriptionId) &&
      UUID.test(value.tenantId) &&
      UUID.test(value.customerId) &&
      UUID.test(value.projectId) &&
      Number.isSafeInteger(value.revision) &&
      value.revision > 0 &&
      typeof value.status === "string" &&
      value.currency === "USD" &&
      Number.isSafeInteger(value.receiptTotalMinor) &&
      value.receiptTotalMinor > 0 &&
      PAYMENT_INTENT_ID.test(value.stripePaymentIntentId) &&
      (value.paymentReceiptId === null ||
        UUID.test(value.paymentReceiptId)) &&
      (value.creditApplicationId === null ||
        UUID.test(value.creditApplicationId)),
    "repository_conflict",
    "the durable Alakazam reversal subscription changed",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactReversalFacts(value, resolved, event) {
  exactKeys(
    value,
    [
      "amountChargedMinor",
      "amountReversedMinor",
      "currency",
      "outcome",
      "provider",
      "providerFactsDigest",
      "providerObservedAt",
      "reversalKind",
      "schema",
      "stripeChargeId",
      "stripeDisputeId",
      "stripePaymentIntentId",
      "stripeRefundId"
    ],
    "stripe_alakazam_reversal_mismatch",
    "Stripe returned invalid Alakazam reversal evidence"
  );
  const local = resolved.subscription;
  invariant(
    value.schema === ALAKAZAM_REVERSAL_FACTS_SCHEMA &&
      value.provider === "stripe" &&
      value.stripeChargeId === event.stripeChargeId &&
      CHARGE_ID.test(value.stripeChargeId) &&
      value.stripePaymentIntentId ===
        local.stripePaymentIntentId &&
      PAYMENT_INTENT_ID.test(value.stripePaymentIntentId) &&
      ["refund", "dispute"].includes(value.reversalKind) &&
      Number.isSafeInteger(
        ALAKAZAM_REVERSAL_SEVERITY[value.outcome]
      ) &&
      value.currency === "USD" &&
      value.amountChargedMinor === local.receiptTotalMinor &&
      Number.isSafeInteger(value.amountReversedMinor) &&
      value.amountReversedMinor >= 0 &&
      value.amountReversedMinor <= value.amountChargedMinor &&
      requiredIso(
        value.providerObservedAt,
        "reversal.providerObservedAt"
      ) &&
      requiredDigest(
        value.providerFactsDigest,
        "reversal.providerFactsDigest"
      ),
    "stripe_alakazam_reversal_mismatch",
    "Stripe returned changed Alakazam reversal evidence",
    { status: 502 }
  );
  const isDispute = DISPUTE_OUTCOMES.has(value.outcome);
  invariant(
    isDispute === (value.reversalKind === "dispute") &&
      (isDispute
        ? typeof value.stripeDisputeId === "string" &&
          DISPUTE_ID.test(value.stripeDisputeId) &&
          value.stripeRefundId === null
        : value.stripeDisputeId === null &&
          (value.stripeRefundId === null ||
            REFUND_ID.test(value.stripeRefundId))) &&
      (value.outcome !== "refund_full" ||
        value.amountReversedMinor ===
          value.amountChargedMinor) &&
      (value.outcome !== "refund_failed" ||
        value.amountReversedMinor === 0),
    "stripe_alakazam_reversal_mismatch",
    "Stripe reversal evidence does not describe one coherent outcome",
    { status: 502 }
  );
  return deepFreeze(clone(value));
}

function exactReversalResult(value, expected = {}) {
  exactKeys(
    value,
    [
      "consequenceApplied",
      "decision",
      "next",
      "ownerReviewRequired",
      "projectId",
      "provider",
      "reversalId",
      "severity",
      "status",
      "stripeChargeId",
      "subscriptionId",
      "subscriptionStatus"
    ],
    "repository_conflict",
    "the durable Alakazam reversal result is invalid"
  );
  invariant(
    value.status === "reversal_recorded" &&
      value.provider === "stripe" &&
      UUID.test(value.reversalId) &&
      UUID.test(value.subscriptionId) &&
      UUID.test(value.projectId) &&
      CHARGE_ID.test(value.stripeChargeId) &&
      Number.isSafeInteger(value.severity) &&
      typeof value.consequenceApplied === "boolean" &&
      typeof value.ownerReviewRequired === "boolean" &&
      value.decision?.schema ===
        ALAKAZAM_REVERSAL_DECISION_SCHEMA &&
      value.decision.customerRefundOffered === false &&
      value.next === "owner_reconciliation" &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "repository_conflict",
    "the durable Alakazam reversal result changed",
    { status: 500 }
  );
  // No ruling means no service consequence, ever.
  invariant(
    value.decision.policyVersion !== null ||
      (value.consequenceApplied === false &&
        value.ownerReviewRequired === true &&
        value.subscriptionStatus === value.decision.from),
    "repository_conflict",
    "an unruled Alakazam reversal policy cannot change service",
    { status: 500 }
  );
  // A reversal never restores anything.
  invariant(
    value.consequenceApplied === false ||
      ["suspended", "cancelled", "ended"].includes(
        value.subscriptionStatus
      ),
    "repository_conflict",
    "an Alakazam reversal cannot restore service",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactResolvedReversal(value, event) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "repository_conflict",
    "the Alakazam reversal binding is invalid",
    { status: 500 }
  );
  if (value.status === "not_alakazam") {
    exactKeys(
      value,
      ["status"],
      "repository_conflict",
      "the Alakazam reversal binding is invalid"
    );
    return Object.freeze({ status: "not_alakazam" });
  }
  exactKeys(
    value,
    [
      "currentSeverity",
      "provider",
      "status",
      "stripeChargeId",
      "subscription"
    ].concat(value?.status === "recorded" ? ["reversal"] : []),
    "repository_conflict",
    "the Alakazam reversal binding is invalid"
  );
  const subscription = exactReversalSubscription(
    value.subscription
  );
  invariant(
    ["current", "recorded"].includes(value.status) &&
      value.provider === "stripe" &&
      value.stripeChargeId === event.stripeChargeId &&
      Number.isSafeInteger(value.currentSeverity) &&
      value.currentSeverity >= 0,
    "stripe_event_binding_invalid",
    "The Stripe event does not identify one durable Alakazam payment",
    { status: 400 }
  );
  return Object.freeze({
    status: value.status,
    subscription,
    currentSeverity: value.currentSeverity,
    reversal:
      value.status === "recorded"
        ? exactReversalResult(value.reversal, {
            subscriptionId: subscription.localSubscriptionId,
            projectId: subscription.projectId,
            stripeChargeId: event.stripeChargeId
          })
        : null
  });
}

function validatePorts(repository, provider, clock, ids) {
  for (const [name, value, methods] of [
    [
      "repository",
      repository,
      ["findReversalPaymentByCharge", "recordReversal"]
    ],
    [
      "provider",
      provider,
      ["readiness", "retrieveAlakazamReversal"]
    ],
    ["clock", clock, ["now"]],
    ["ids", ids, ["next"]]
  ]) {
    invariant(
      value &&
        methods.every(
          (method) => typeof value[method] === "function"
        ),
      "invalid_configuration",
      `${name} port is incomplete`,
      { status: 500 }
    );
  }
  invariant(
    typeof repository.issueRefund !== "function" &&
      typeof provider.issueRefund !== "function" &&
      typeof provider.createRefund !== "function",
    "invalid_configuration",
    "the Alakazam reversal lane must not be able to issue a refund",
    { status: 500 }
  );
  return { repository, provider, clock, ids };
}

function nextUuid(ids, label) {
  return exactUuid(ids.next(label), label);
}

export function createAlakazamReversalService({
  repository,
  provider,
  clock,
  ids,
  release = createAlakazamBillingRelease(),
  policy = createAlakazamLifecyclePolicy()
} = {}) {
  const ports = validatePorts(
    repository,
    provider,
    clock,
    ids
  );
  const authority = exactRelease(release);
  const lifecycle = exactAlakazamLifecyclePolicy(policy);

  async function readiness() {
    if (!authority.approved) {
      return deepFreeze({
        ready: false,
        reversal: false,
        state: "held",
        code: "alakazam_billing_release_held",
        customerRefundOffered: false
      });
    }
    let status;
    try {
      status = await ports.provider.readiness();
    } catch (error) {
      return deepFreeze({
        ready: false,
        reversal: false,
        state: "unavailable",
        code: error?.code ?? "stripe_not_ready",
        customerRefundOffered: false
      });
    }
    if (
      status?.ready !== true ||
      status.provider !== "stripe" ||
      status.alakazam !== true ||
      status.taxMode !== authority.taxMode ||
      typeof status.livemode !== "boolean"
    ) {
      return deepFreeze({
        ready: false,
        reversal: false,
        state: "unavailable",
        code: status?.code ?? "stripe_alakazam_not_ready",
        customerRefundOffered: false
      });
    }
    return deepFreeze({
      ready: true,
      // Defensive evidence capture runs before the owner rules
      // consequences, exactly like payment incidents.
      reversal: true,
      state: lifecycle.approved
        ? "reversal_policy_ready"
        : "reversal_evidence_only",
      provider: "stripe",
      livemode: status.livemode,
      taxMode: authority.taxMode,
      policyApproved: lifecycle.approved,
      customerRefundOffered: false
    });
  }

  return Object.freeze({
    readiness,

    async ingestStripeEvent(input) {
      if (!isAlakazamReversalEvent(input)) {
        return deepFreeze({ status: "not_alakazam_reversal" });
      }
      const status = await readiness();
      invariant(
        status.ready === true && status.reversal === true,
        "alakazam_reversal_reconciliation_unavailable",
        "Alakazam reversal defence is temporarily unavailable.",
        { status: 503 }
      );
      const event = exactEvent(
        input,
        exactClock(ports.clock)
      );
      invariant(
        event.livemode === status.livemode,
        "stripe_event_invalid",
        "The Alakazam reversal event mode is invalid",
        { status: 400 }
      );
      // Ownership comes from the durable PaymentIntent binding on an
      // Alakazam receipt. A Download reversal is evaluated by its own
      // processor; neither short-circuits the other.
      const resolved = exactResolvedReversal(
        await ports.repository.findReversalPaymentByCharge({
          stripeEventId: event.stripeEventId,
          stripeChargeId: event.stripeChargeId,
          stripePaymentIntentId: event.stripePaymentIntentId
        }),
        event
      );
      if (resolved.status === "not_alakazam") {
        return deepFreeze({ status: "not_alakazam_reversal" });
      }
      if (resolved.status === "recorded") {
        return resolved.reversal;
      }

      let facts;
      try {
        facts = await ports.provider.retrieveAlakazamReversal({
          stripeChargeId: event.stripeChargeId,
          stripePaymentIntentId:
            resolved.subscription.stripePaymentIntentId
        });
      } catch {
        invariant(
          false,
          "alakazam_reversal_reconciliation_unavailable",
          "Alakazam reversal defence is temporarily unavailable.",
          { status: 503 }
        );
      }
      const reversal = exactReversalFacts(
        facts,
        resolved,
        event
      );
      const decision = decideAlakazamReversalConsequence({
        policy: lifecycle,
        outcome: reversal.outcome,
        subscriptionStatus: resolved.subscription.status,
        currentSeverity: resolved.currentSeverity
      });
      const result = await ports.repository.recordReversal({
        subscription: clone(resolved.subscription),
        event,
        reversal: clone(reversal),
        decision: clone(decision),
        eventRowId: nextUuid(
          ports.ids,
          "alakazam_reversal_event"
        ),
        reversalId: nextUuid(
          ports.ids,
          "alakazam_reversal"
        ),
        tierEventId:
          decision.tierEventKind === null
            ? null
            : nextUuid(
                ports.ids,
                "alakazam_reversal_tier_event"
              )
      });
      return exactReversalResult(result, {
        subscriptionId:
          resolved.subscription.localSubscriptionId,
        projectId: resolved.subscription.projectId,
        stripeChargeId: event.stripeChargeId
      });
    }
  });
}
