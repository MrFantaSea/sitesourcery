import { createHash } from "node:crypto";

import {
  ALAKAZAM_PROVIDER_METADATA_SCHEMA,
  resolveAlakazamTier
} from "./alakazam.mjs";
import {
  createAlakazamBillingRelease
} from "./alakazam-billing.mjs";
import {
  alakazamPolicyDeadline,
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
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]+$/u;
const CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;
const CANCELLATION_EVENT_TYPE = "customer.subscription.updated";

export const ALAKAZAM_CANCELLATION_PREVIEW_SCHEMA =
  "sitesourcery.alakazam-cancellation-preview/v1";
export const ALAKAZAM_CANCELLATION_SUBSCRIPTION_SCHEMA =
  "sitesourcery.alakazam-cancellation-subscription/v1";
export const ALAKAZAM_EXPORT_GRANT_SCHEMA =
  "sitesourcery.alakazam-export-grant/v1";
export const ALAKAZAM_CANCELLATION_FACTS_SCHEMA =
  "sitesourcery.stripe-alakazam-cancellation/v1";

const CANCELLABLE_STATES = new Set([
  "active",
  "grace",
  "suspended"
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
    "Alakazam cancellation release does not match the reviewed billing contract",
    { status: 500 }
  );
  return expected;
}

export function exactCancellationSubscription(value) {
  exactKeys(
    value,
    [
      "amountMinor",
      "cancelAtPeriodEnd",
      "currency",
      "currentPeriodEndsAt",
      "currentPeriodStartsAt",
      "customerId",
      "hasOpenDowngrade",
      "localSubscriptionId",
      "projectId",
      "revision",
      "schema",
      "status",
      "stripeCustomerId",
      "stripeSubscriptionId",
      "tenantId",
      "tierId"
    ],
    "repository_conflict",
    "the durable Alakazam cancellation subscription is invalid"
  );
  const tier = resolveAlakazamTier(value.tierId);
  invariant(
    value.schema ===
        ALAKAZAM_CANCELLATION_SUBSCRIPTION_SCHEMA &&
      UUID.test(value.localSubscriptionId) &&
      UUID.test(value.tenantId) &&
      UUID.test(value.customerId) &&
      UUID.test(value.projectId) &&
      Number.isSafeInteger(value.revision) &&
      value.revision > 0 &&
      value.amountMinor === tier.price.amountMinor &&
      value.currency === "USD" &&
      typeof value.status === "string" &&
      typeof value.cancelAtPeriodEnd === "boolean" &&
      typeof value.hasOpenDowngrade === "boolean" &&
      CUSTOMER_ID.test(value.stripeCustomerId) &&
      SUBSCRIPTION_ID.test(value.stripeSubscriptionId) &&
      requiredIso(
        value.currentPeriodStartsAt,
        "subscription.currentPeriodStartsAt"
      ) &&
      requiredIso(
        value.currentPeriodEndsAt,
        "subscription.currentPeriodEndsAt"
      ),
    "repository_conflict",
    "the durable Alakazam cancellation subscription changed",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

/**
 * Project what a cancelling customer actually keeps.
 *
 * The period already paid for is a fact, not a policy: service and
 * export run to the confirmed period end. Anything BEYOND that end —
 * how long work is retained, how long it can still be exported — is an
 * owner ruling. Until it exists this returns
 * `retentionState: "policy_decision_required"` and no dates.
 */
export function projectAlakazamExportGrant({
  policy,
  availableFrom,
  paidThroughAt
} = {}) {
  const authority = exactAlakazamLifecyclePolicy(policy);
  const from = requiredIso(availableFrom, "availableFrom");
  const through = requiredIso(paidThroughAt, "paidThroughAt");
  invariant(
    Date.parse(through) > Date.parse(from),
    "invalid_input",
    "the Alakazam paid period must end after it started"
  );
  if (!authority.approved) {
    return deepFreeze({
      schema: ALAKAZAM_EXPORT_GRANT_SCHEMA,
      state: "available",
      availableFrom: from,
      paidThroughAt: through,
      retentionState: "policy_decision_required",
      policyVersion: null,
      retentionEndsAt: null,
      exportWindowEndsAt: null
    });
  }
  const retentionEndsAt = alakazamPolicyDeadline(
    through,
    authority.retentionHours
  );
  const exportWindowEndsAt = alakazamPolicyDeadline(
    through,
    authority.exportWindowHours
  );
  invariant(
    Date.parse(exportWindowEndsAt) <=
      Date.parse(retentionEndsAt),
    "invalid_configuration",
    "an approved Alakazam export window cannot outlast its retention",
    { status: 500 }
  );
  return deepFreeze({
    schema: ALAKAZAM_EXPORT_GRANT_SCHEMA,
    state: "available",
    availableFrom: from,
    paidThroughAt: through,
    retentionState: "granted",
    policyVersion: authority.policyVersion,
    retentionEndsAt,
    exportWindowEndsAt
  });
}

/**
 * The exact truth a customer sees before confirming a cancellation.
 *
 * Every field is either a committed fact or an explicit
 * `policy_decision_required`. The downgrade contract's zero-refund
 * rule belongs to downgrade alone and is deliberately NOT generalised
 * here: refund treatment on cancellation is still the owner's call.
 */
export function previewAlakazamCancellation({
  policy,
  subscription,
  now
} = {}) {
  const authority = exactAlakazamLifecyclePolicy(policy);
  const current = exactCancellationSubscription(subscription);
  const at = requiredIso(now, "now");
  const eligible =
    CANCELLABLE_STATES.has(current.status) &&
    current.cancelAtPeriodEnd === false &&
    current.hasOpenDowngrade === false &&
    Date.parse(current.currentPeriodEndsAt) > Date.parse(at);
  const ineligibleReason = !CANCELLABLE_STATES.has(
    current.status
  )
    ? "subscription_not_current"
    : current.cancelAtPeriodEnd
      ? "already_scheduled_to_end"
      : current.hasOpenDowngrade
        ? "open_tier_change"
        : Date.parse(current.currentPeriodEndsAt) <=
            Date.parse(at)
          ? "period_boundary_passed"
          : null;
  return deepFreeze({
    schema: ALAKAZAM_CANCELLATION_PREVIEW_SCHEMA,
    projectId: current.projectId,
    eligible,
    ineligibleReason,
    tierId: current.tierId,
    amountMinor: current.amountMinor,
    currency: "USD",
    // Service continues to the end of the period already paid for.
    effectiveAt: current.currentPeriodEndsAt,
    servesUntil: current.currentPeriodEndsAt,
    // No further charge is made once the provider confirms the stop.
    furtherChargesAfterEffective: false,
    // OPEN RULING: whether any part of the current period is refunded.
    refundTreatment: "policy_decision_required",
    // OPEN RULING: whether a scheduled cancellation may be undone.
    undoAvailable: false,
    undoTreatment: "policy_decision_required",
    // Once the paid period has already ended there is no remaining
    // paid window to grant, and what survives is purely the open
    // retention ruling.
    export:
      Date.parse(current.currentPeriodEndsAt) >
      Date.parse(at)
        ? projectAlakazamExportGrant({
            policy: authority,
            availableFrom: at,
            paidThroughAt: current.currentPeriodEndsAt
          })
        : null,
    actions: {
      // The provider effect is held. A preview never implies a button.
      requestCancellation: false,
      reason: "alakazam_cancellation_effect_held"
    }
  });
}

export function isAlakazamCancellationConfirmationEvent(
  event
) {
  const object = event?.data?.object;
  return (
    event?.type === CANCELLATION_EVENT_TYPE &&
    object &&
    typeof object === "object" &&
    !Array.isArray(object) &&
    typeof object.id === "string" &&
    SUBSCRIPTION_ID.test(object.id) &&
    object.cancel_at_period_end === true &&
    // A start/upgrade/downgrade transition carries its own change
    // metadata and belongs to that specialised processor.
    object.metadata?.schema !==
      ALAKAZAM_PROVIDER_METADATA_SCHEMA
  );
}

function exactConfirmationEvent(value, verifiedAt) {
  invariant(
    value &&
      EVENT_ID.test(value.id) &&
      value.type === CANCELLATION_EVENT_TYPE &&
      typeof value.livemode === "boolean" &&
      typeof value.api_version === "string" &&
      value.api_version.length >= 3 &&
      value.api_version.length <= 100 &&
      Number.isSafeInteger(value.created) &&
      value.created > 0 &&
      value.data?.object &&
      typeof value.data.object === "object",
    "stripe_event_invalid",
    "The verified Alakazam cancellation event is invalid",
    { status: 400 }
  );
  const stripeSubscriptionId = requiredText(
    value.data.object.id,
    "event.data.object.id",
    255
  );
  invariant(
    SUBSCRIPTION_ID.test(stripeSubscriptionId),
    "stripe_event_invalid",
    "The verified Alakazam cancellation event has no Subscription",
    { status: 400 }
  );
  return deepFreeze({
    stripeEventId: value.id,
    eventType: value.type,
    livemode: value.livemode,
    apiVersion: value.api_version,
    stripeSubscriptionId,
    payloadDigest: createHash("sha256")
      .update(JSON.stringify(value), "utf8")
      .digest("hex"),
    signatureVerifiedAt: verifiedAt,
    occurredAt: new Date(value.created * 1000).toISOString()
  });
}

function exactCancellationFacts(value, resolved, event) {
  exactKeys(
    value,
    [
      "cancelAt",
      "cancelAtPeriodEnd",
      "currency",
      "currentPeriodEndsAt",
      "currentPeriodStartsAt",
      "provider",
      "providerFactsDigest",
      "providerObservedAt",
      "providerStatus",
      "schema",
      "stripeCustomerId",
      "stripeSubscriptionId",
      "tierId"
    ],
    "stripe_alakazam_cancellation_mismatch",
    "Stripe returned invalid Alakazam cancellation evidence"
  );
  const local = resolved.subscription;
  invariant(
    value.schema === ALAKAZAM_CANCELLATION_FACTS_SCHEMA &&
      value.provider === "stripe" &&
      value.stripeSubscriptionId ===
        local.stripeSubscriptionId &&
      value.stripeSubscriptionId ===
        event.stripeSubscriptionId &&
      value.stripeCustomerId === local.stripeCustomerId &&
      value.tierId === local.tierId &&
      value.currency === "USD" &&
      value.cancelAtPeriodEnd === true &&
      // The stop lands on the exact boundary of the paid period.
      value.currentPeriodEndsAt ===
        local.currentPeriodEndsAt &&
      value.currentPeriodStartsAt ===
        local.currentPeriodStartsAt &&
      value.cancelAt === local.currentPeriodEndsAt &&
      requiredIso(
        value.providerObservedAt,
        "cancellation.providerObservedAt"
      ) &&
      requiredDigest(
        value.providerFactsDigest,
        "cancellation.providerFactsDigest"
      ),
    "stripe_alakazam_cancellation_mismatch",
    "Stripe did not confirm a period-end Alakazam cancellation",
    { status: 502 }
  );
  // A provider that has already terminated the subscription is a
  // different lifecycle fact and needs owner reconciliation.
  invariant(
    ["active", "past_due", "unpaid"].includes(
      value.providerStatus
    ),
    "alakazam_cancellation_reconciliation_required",
    "The Alakazam subscription is no longer in a period-end cancellation state.",
    { status: 409 }
  );
  return deepFreeze(clone(value));
}

function exactScheduledResult(value, expected = {}) {
  exactKeys(
    value,
    [
      "cancellationId",
      "effectiveAt",
      "export",
      "next",
      "projectId",
      "provider",
      "revision",
      "state",
      "status",
      "subscriptionId"
    ],
    "repository_conflict",
    "the durable Alakazam cancellation result is invalid"
  );
  invariant(
    value.status === "cancellation_scheduled" &&
      value.provider === "stripe" &&
      value.state === "scheduled" &&
      UUID.test(value.cancellationId) &&
      UUID.test(value.subscriptionId) &&
      UUID.test(value.projectId) &&
      Number.isSafeInteger(value.revision) &&
      value.revision > 1 &&
      requiredIso(
        value.effectiveAt,
        "cancellation.effectiveAt"
      ) &&
      value.export?.schema === ALAKAZAM_EXPORT_GRANT_SCHEMA &&
      value.export.state === "available" &&
      value.export.paidThroughAt === value.effectiveAt &&
      value.next === "boundary_confirmation" &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "repository_conflict",
    "the durable Alakazam cancellation result changed",
    { status: 500 }
  );
  // The export grant may never state a retention window the owner has
  // not ruled.
  invariant(
    value.export.retentionState === "granted"
      ? value.export.policyVersion !== null &&
          value.export.retentionEndsAt !== null
      : value.export.policyVersion === null &&
          value.export.retentionEndsAt === null &&
          value.export.exportWindowEndsAt === null,
    "repository_conflict",
    "the Alakazam export grant promises an unruled retention window",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactResolvedCancellation(value, event) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "repository_conflict",
    "the Alakazam cancellation binding is invalid",
    { status: 500 }
  );
  if (value.status === "not_alakazam") {
    exactKeys(
      value,
      ["status"],
      "repository_conflict",
      "the Alakazam cancellation binding is invalid"
    );
    return Object.freeze({ status: "not_alakazam" });
  }
  exactKeys(
    value,
    ["cancellation", "provider", "status", "subscription"],
    "repository_conflict",
    "the Alakazam cancellation binding is invalid"
  );
  const subscription = exactCancellationSubscription(
    value.subscription
  );
  invariant(
    ["requested", "scheduled"].includes(value.status) &&
      value.provider === "stripe" &&
      subscription.stripeSubscriptionId ===
        event.stripeSubscriptionId,
    "stripe_event_binding_invalid",
    "The Stripe event does not identify one durable Alakazam cancellation",
    { status: 400 }
  );
  return Object.freeze({
    status: value.status,
    subscription,
    cancellation:
      value.status === "scheduled"
        ? exactScheduledResult(value.cancellation, {
            subscriptionId: subscription.localSubscriptionId,
            projectId: subscription.projectId
          })
        : deepFreeze(clone(value.cancellation))
  });
}

function validatePorts(repository, provider, clock, ids) {
  for (const [name, value, methods] of [
    [
      "repository",
      repository,
      [
        "readCancellationSubscription",
        "findCancellationBySubscription",
        "confirmCancellationSchedule"
      ]
    ],
    [
      "provider",
      provider,
      ["readiness", "retrieveAlakazamCancellation"]
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
  return { repository, provider, clock, ids };
}

function nextUuid(ids, label) {
  return exactUuid(ids.next(label), label);
}

export function createAlakazamCancellationService({
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
        cancellation: false,
        state: "held",
        code: "alakazam_billing_release_held"
      });
    }
    let status;
    try {
      status = await ports.provider.readiness();
    } catch (error) {
      return deepFreeze({
        ready: false,
        cancellation: false,
        state: "unavailable",
        code: error?.code ?? "stripe_not_ready"
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
        cancellation: false,
        state: "unavailable",
        code: status?.code ?? "stripe_alakazam_not_ready"
      });
    }
    return deepFreeze({
      ready: true,
      cancellation: true,
      state: "cancellation_ready",
      provider: "stripe",
      livemode: status.livemode,
      taxMode: authority.taxMode
    });
  }

  return Object.freeze({
    readiness,

    /**
     * Read-only. A customer may always be told exactly what stopping
     * would mean, including while the effect itself is held.
     */
    async preview(scope) {
      const subscription =
        await ports.repository.readCancellationSubscription({
          tenantId: exactUuid(scope?.tenantId, "tenantId"),
          customerId: exactUuid(
            scope?.customerId,
            "customerId"
          ),
          projectId: exactUuid(scope?.projectId, "projectId")
        });
      if (subscription === null) {
        return deepFreeze({
          schema: ALAKAZAM_CANCELLATION_PREVIEW_SCHEMA,
          projectId: exactUuid(
            scope?.projectId,
            "projectId"
          ),
          eligible: false,
          ineligibleReason: "no_current_subscription",
          tierId: null,
          amountMinor: 0,
          currency: "USD",
          effectiveAt: null,
          servesUntil: null,
          furtherChargesAfterEffective: false,
          refundTreatment: "policy_decision_required",
          undoAvailable: false,
          undoTreatment: "policy_decision_required",
          export: null,
          actions: {
            requestCancellation: false,
            reason: "alakazam_cancellation_effect_held"
          }
        });
      }
      return previewAlakazamCancellation({
        policy: lifecycle,
        subscription,
        now: exactClock(ports.clock)
      });
    },

    /**
     * Confirm a period-end cancellation from provider readback and
     * grant the export the customer already paid for.
     */
    async ingestStripeEvent(input) {
      if (!isAlakazamCancellationConfirmationEvent(input)) {
        return deepFreeze({
          status: "not_alakazam_cancellation"
        });
      }
      const status = await readiness();
      invariant(
        status.ready === true && status.cancellation === true,
        "alakazam_cancellation_reconciliation_unavailable",
        "Alakazam cancellation confirmation is temporarily unavailable.",
        { status: 503 }
      );
      const event = exactConfirmationEvent(
        input,
        exactClock(ports.clock)
      );
      invariant(
        event.livemode === status.livemode,
        "stripe_event_invalid",
        "The Alakazam cancellation event mode is invalid",
        { status: 400 }
      );
      const resolved = exactResolvedCancellation(
        await ports.repository
          .findCancellationBySubscription({
            stripeEventId: event.stripeEventId,
            stripeSubscriptionId: event.stripeSubscriptionId
          }),
        event
      );
      if (resolved.status === "not_alakazam") {
        return deepFreeze({
          status: "not_alakazam_cancellation"
        });
      }
      if (resolved.status === "scheduled") {
        return resolved.cancellation;
      }

      let facts;
      try {
        facts = await ports.provider
          .retrieveAlakazamCancellation({
            stripeSubscriptionId:
              resolved.subscription.stripeSubscriptionId,
            stripeCustomerId:
              resolved.subscription.stripeCustomerId
          });
      } catch {
        invariant(
          false,
          "alakazam_cancellation_reconciliation_unavailable",
          "Alakazam cancellation confirmation is temporarily unavailable.",
          { status: 503 }
        );
      }
      const cancellation = exactCancellationFacts(
        facts,
        resolved,
        event
      );
      const grant = projectAlakazamExportGrant({
        policy: lifecycle,
        availableFrom: event.occurredAt,
        paidThroughAt:
          resolved.subscription.currentPeriodEndsAt
      });
      const result =
        await ports.repository.confirmCancellationSchedule({
          subscription: clone(resolved.subscription),
          request: clone(resolved.cancellation),
          event,
          cancellation: clone(cancellation),
          grant: clone(grant),
          eventRowId: nextUuid(
            ports.ids,
            "alakazam_cancellation_event"
          ),
          tierEventId: nextUuid(
            ports.ids,
            "alakazam_cancellation_tier_event"
          ),
          exportGrantId: nextUuid(
            ports.ids,
            "alakazam_export_grant"
          )
        });
      return exactScheduledResult(result, {
        subscriptionId:
          resolved.subscription.localSubscriptionId,
        projectId: resolved.subscription.projectId,
        effectiveAt:
          resolved.subscription.currentPeriodEndsAt
      });
    }
  });
}
