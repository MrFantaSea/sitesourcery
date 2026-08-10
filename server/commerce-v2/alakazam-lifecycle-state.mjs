import { createHash } from "node:crypto";

import { resolveAlakazamTier } from "./alakazam.mjs";
import {
  createAlakazamBillingRelease
} from "./alakazam-billing.mjs";
import {
  ALAKAZAM_RENEWAL_EVENT_TYPES,
  ALAKAZAM_RENEWAL_INVOICE_FACTS_SCHEMA
} from "./alakazam-lifecycle-renewal.mjs";
import {
  alakazamPolicyDeadline,
  createAlakazamLifecyclePolicy,
  exactAlakazamLifecyclePolicy
} from "./alakazam-lifecycle-policy.mjs";
import {
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_]+$/u;
const CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]+$/u;
const INVOICE_ID = /^in_[A-Za-z0-9_]+$/u;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/u;

export const ALAKAZAM_INCIDENT_INVOICE_FACTS_SCHEMA =
  "sitesourcery.stripe-alakazam-incident-invoice/v1";
export const ALAKAZAM_LIFECYCLE_DECISION_SCHEMA =
  "sitesourcery.alakazam-lifecycle-decision/v1";
export const ALAKAZAM_INCIDENT_SUBSCRIPTION_SCHEMA =
  "sitesourcery.alakazam-incident-subscription/v1";

export const ALAKAZAM_LIFECYCLE_STATES = Object.freeze([
  "pending",
  "active",
  "grace",
  "suspended",
  "cancelled",
  "ended"
]);

export const ALAKAZAM_LIFECYCLE_SIGNALS = Object.freeze([
  "payment_failed",
  "payment_action_required",
  "payment_recovered",
  "grace_expired"
]);

export const ALAKAZAM_INCIDENT_EVENT_TYPES = Object.freeze([
  "invoice.payment_failed",
  "invoice.payment_action_required"
]);

const INCIDENT_EVENT_TYPES = new Set(
  ALAKAZAM_INCIDENT_EVENT_TYPES
);
const STATES = new Set(ALAKAZAM_LIFECYCLE_STATES);
const SIGNALS = new Set(ALAKAZAM_LIFECYCLE_SIGNALS);

const INCIDENT_KINDS = Object.freeze({
  "invoice.payment_failed": "payment_failed",
  "invoice.payment_action_required": "action_required"
});

// Which local state a signal may reach once, and only once, the owner
// has ruled. These are the engineering-permitted edges taken straight
// from the migration 023 status guard; they are not a policy.
const TRANSITIONS = Object.freeze({
  payment_failed: Object.freeze({
    active: Object.freeze({
      to: "grace",
      tierEventKind: "payment_failed"
    }),
    grace: Object.freeze({ to: "grace", tierEventKind: null }),
    suspended: Object.freeze({
      to: "suspended",
      tierEventKind: null
    })
  }),
  payment_action_required: Object.freeze({
    active: Object.freeze({ to: "active", tierEventKind: null }),
    grace: Object.freeze({ to: "grace", tierEventKind: null }),
    suspended: Object.freeze({
      to: "suspended",
      tierEventKind: null
    })
  }),
  payment_recovered: Object.freeze({
    active: Object.freeze({ to: "active", tierEventKind: null }),
    grace: Object.freeze({
      to: "active",
      tierEventKind: "payment_recovered"
    }),
    suspended: Object.freeze({
      to: "active",
      tierEventKind: "payment_recovered"
    })
  }),
  grace_expired: Object.freeze({
    grace: Object.freeze({
      to: "suspended",
      tierEventKind: "suspended"
    }),
    suspended: Object.freeze({
      to: "suspended",
      tierEventKind: null
    })
  })
});

const SERVICE_STATES = Object.freeze({
  record_only: "unchanged",
  owner_review: "unchanged",
  restrict_publication: "limited",
  suspend_service: "suspended"
});

// Reviewed, generic customer message codes. They state a fact and
// promise nothing: no deadline, no outcome, no decline reason.
const MESSAGE_CODES = Object.freeze({
  payment_failed: "alakazam_billing_attention",
  payment_action_required:
    "alakazam_billing_action_required",
  payment_recovered: "alakazam_billing_current",
  grace_expired: "alakazam_service_paused"
});

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
    "Alakazam lifecycle release does not match the reviewed billing contract",
    { status: 500 }
  );
  return expected;
}

/**
 * Decide one Alakazam lifecycle transition.
 *
 * The decision is fail-closed in the exact sense the owner needs: with
 * no approved policy the local status does not move, no tier event is
 * written, no deadline is invented, and the customer sees a factual
 * billing-attention state instead of a promise.
 */
export function decideAlakazamLifecycleTransition({
  policy,
  from,
  signal,
  observedAt,
  firstFailedAt = null,
  graceEndsAt = null
} = {}) {
  const authority = exactAlakazamLifecyclePolicy(policy);
  invariant(
    STATES.has(from),
    "invalid_input",
    "the Alakazam lifecycle state is unknown"
  );
  invariant(
    SIGNALS.has(signal),
    "invalid_input",
    "the Alakazam lifecycle signal is unknown"
  );
  const at = requiredIso(observedAt, "observedAt");
  if (firstFailedAt !== null) {
    requiredIso(firstFailedAt, "firstFailedAt");
  }
  if (graceEndsAt !== null) {
    requiredIso(graceEndsAt, "graceEndsAt");
  }

  const held = deepFreeze({
    schema: ALAKAZAM_LIFECYCLE_DECISION_SCHEMA,
    from,
    signal,
    to: from,
    tierEventKind: null,
    consequence: "record_only",
    serviceState: "unchanged",
    graceEndsAt: null,
    policyVersion: null,
    customerMessageCode: MESSAGE_CODES[signal],
    ownerState: "policy_decision_required",
    reason: "policy_decision_required",
    observedAt: at
  });

  // A terminal or not-yet-started subscription is never moved by a
  // billing signal.
  const edge = TRANSITIONS[signal]?.[from];
  if (!edge) {
    return deepFreeze({
      ...held,
      consequence: "record_only",
      ownerState: authority.approved
        ? "no_transition"
        : "policy_decision_required",
      reason: "no_transition_defined"
    });
  }
  if (!authority.approved) return held;

  // Grace is only entered when the owner actually granted one. A
  // zero-hour approved grace is a real ruling and is honoured as an
  // immediate boundary, not silently skipped.
  const consequence =
    edge.to === "grace"
      ? authority.graceConsequence
      : edge.to === "suspended"
        ? authority.suspensionConsequence
        : "record_only";
  const deadlineFrom = firstFailedAt ?? at;
  const nextGraceEndsAt =
    edge.to === "grace"
      ? alakazamPolicyDeadline(
          deadlineFrom,
          authority.graceHours
        )
      : edge.to === "suspended"
        ? graceEndsAt
        : null;

  if (signal === "grace_expired" && edge.tierEventKind) {
    // Suspension only lands once the approved grace boundary has
    // actually passed on the committed clock.
    const boundary =
      graceEndsAt ??
      alakazamPolicyDeadline(
        deadlineFrom,
        authority.graceHours
      );
    const suspendAt = alakazamPolicyDeadline(
      boundary,
      authority.suspendAfterGraceHours
    );
    if (
      boundary === null ||
      suspendAt === null ||
      Date.parse(at) < Date.parse(suspendAt)
    ) {
      return deepFreeze({
        ...held,
        to: from,
        tierEventKind: null,
        consequence: authority.graceConsequence,
        serviceState:
          SERVICE_STATES[authority.graceConsequence],
        graceEndsAt: boundary,
        policyVersion: authority.policyVersion,
        ownerState: "waiting_for_policy_boundary",
        reason: "policy_boundary_not_reached"
      });
    }
  }

  return deepFreeze({
    schema: ALAKAZAM_LIFECYCLE_DECISION_SCHEMA,
    from,
    signal,
    to: edge.to,
    tierEventKind: edge.tierEventKind,
    consequence,
    serviceState: SERVICE_STATES[consequence],
    graceEndsAt: nextGraceEndsAt,
    policyVersion: authority.policyVersion,
    customerMessageCode: MESSAGE_CODES[signal],
    ownerState:
      edge.tierEventKind === null ? "no_transition" : "applied",
    reason: "policy_applied",
    observedAt: at
  });
}

function invoiceSubscriptionId(object) {
  const candidates = [
    object?.subscription,
    object?.subscription?.id,
    object?.parent?.subscription_details?.subscription,
    object?.parent?.subscription_details?.subscription?.id
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      SUBSCRIPTION_ID.test(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

export function isAlakazamPaymentIncidentEvent(event) {
  const object = event?.data?.object;
  return (
    INCIDENT_EVENT_TYPES.has(event?.type) &&
    object &&
    typeof object === "object" &&
    !Array.isArray(object) &&
    object.object === "invoice" &&
    typeof object.id === "string" &&
    INVOICE_ID.test(object.id) &&
    invoiceSubscriptionId(object) !== null
  );
}

function validatePorts(repository, provider, clock, ids) {
  for (const [name, value, methods] of [
    [
      "repository",
      repository,
      [
        "findIncidentSubscriptionByInvoice",
        "recordPaymentIncident"
      ]
    ],
    [
      "provider",
      provider,
      ["readiness", "retrieveAlakazamIncidentInvoice"]
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

function exactEvent(value, verifiedAt) {
  invariant(
    value &&
      EVENT_ID.test(value.id) &&
      INCIDENT_EVENT_TYPES.has(value.type) &&
      typeof value.livemode === "boolean" &&
      typeof value.api_version === "string" &&
      value.api_version.length >= 3 &&
      value.api_version.length <= 100 &&
      Number.isSafeInteger(value.created) &&
      value.created > 0 &&
      value.data?.object &&
      typeof value.data.object === "object" &&
      !Array.isArray(value.data.object),
    "stripe_event_invalid",
    "The verified Alakazam incident event is invalid",
    { status: 400 }
  );
  const stripeInvoiceId = requiredText(
    value.data.object.id,
    "event.data.object.id",
    255
  );
  const stripeSubscriptionId = invoiceSubscriptionId(
    value.data.object
  );
  invariant(
    INVOICE_ID.test(stripeInvoiceId) &&
      stripeSubscriptionId !== null,
    "stripe_event_invalid",
    "The verified Alakazam incident event has no invoiced Subscription",
    { status: 400 }
  );
  return deepFreeze({
    stripeEventId: value.id,
    eventType: value.type,
    incidentKind: INCIDENT_KINDS[value.type],
    livemode: value.livemode,
    apiVersion: value.api_version,
    stripeInvoiceId,
    stripeSubscriptionId,
    payloadDigest: createHash("sha256")
      .update(JSON.stringify(value), "utf8")
      .digest("hex"),
    signatureVerifiedAt: verifiedAt,
    occurredAt: new Date(value.created * 1000).toISOString()
  });
}

function exactIncidentSubscription(value, event) {
  exactKeys(
    value,
    [
      "amountMinor",
      "currency",
      "currentPeriodEndsAt",
      "currentPeriodStartsAt",
      "customerId",
      "firstFailedAt",
      "graceEndsAt",
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
    "the durable Alakazam incident subscription is invalid"
  );
  const tier = resolveAlakazamTier(value.tierId);
  invariant(
    value.schema === ALAKAZAM_INCIDENT_SUBSCRIPTION_SCHEMA &&
      UUID.test(value.localSubscriptionId) &&
      UUID.test(value.tenantId) &&
      UUID.test(value.customerId) &&
      UUID.test(value.projectId) &&
      Number.isSafeInteger(value.revision) &&
      value.revision > 0 &&
      value.amountMinor === tier.price.amountMinor &&
      value.currency === "USD" &&
      STATES.has(value.status) &&
      CUSTOMER_ID.test(value.stripeCustomerId) &&
      value.stripeSubscriptionId ===
        event.stripeSubscriptionId &&
      requiredIso(
        value.currentPeriodStartsAt,
        "subscription.currentPeriodStartsAt"
      ) &&
      requiredIso(
        value.currentPeriodEndsAt,
        "subscription.currentPeriodEndsAt"
      ),
    "repository_conflict",
    "the durable Alakazam incident subscription changed",
    { status: 500 }
  );
  if (value.firstFailedAt !== null) {
    requiredIso(
      value.firstFailedAt,
      "subscription.firstFailedAt"
    );
  }
  if (value.graceEndsAt !== null) {
    requiredIso(value.graceEndsAt, "subscription.graceEndsAt");
  }
  return deepFreeze(clone(value));
}

function exactIncidentResult(value, expected = {}) {
  exactKeys(
    value,
    [
      "consequenceApplied",
      "decision",
      "incidentId",
      "incidentKind",
      "next",
      "projectId",
      "provider",
      "status",
      "stripeInvoiceId",
      "subscriptionId",
      "subscriptionStatus"
    ],
    "repository_conflict",
    "the durable Alakazam incident result is invalid"
  );
  invariant(
    value.status === "incident_recorded" &&
      value.provider === "stripe" &&
      UUID.test(value.incidentId) &&
      UUID.test(value.subscriptionId) &&
      UUID.test(value.projectId) &&
      INVOICE_ID.test(value.stripeInvoiceId) &&
      ["payment_failed", "action_required"].includes(
        value.incidentKind
      ) &&
      STATES.has(value.subscriptionStatus) &&
      typeof value.consequenceApplied === "boolean" &&
      value.decision?.schema ===
        ALAKAZAM_LIFECYCLE_DECISION_SCHEMA &&
      value.next === "complete" &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "repository_conflict",
    "the durable Alakazam incident result changed",
    { status: 500 }
  );
  // An unruled policy can never report that something happened to the
  // customer's service.
  invariant(
    value.decision.policyVersion !== null ||
      (value.consequenceApplied === false &&
        value.subscriptionStatus === value.decision.from &&
        value.decision.serviceState === "unchanged"),
    "repository_conflict",
    "an unruled Alakazam policy cannot report a service consequence",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactResolvedIncident(value, event) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "repository_conflict",
    "the Alakazam incident binding is invalid",
    { status: 500 }
  );
  if (value.status === "not_alakazam") {
    exactKeys(
      value,
      ["status"],
      "repository_conflict",
      "the Alakazam incident binding is invalid"
    );
    return Object.freeze({ status: "not_alakazam" });
  }
  exactKeys(
    value,
    ["provider", "status", "stripeInvoiceId", "subscription"].concat(
      value?.status === "recorded" ? ["incident"] : []
    ),
    "repository_conflict",
    "the Alakazam incident binding is invalid"
  );
  const subscription = exactIncidentSubscription(
    value.subscription,
    event
  );
  invariant(
    ["current", "recorded"].includes(value.status) &&
      value.provider === "stripe" &&
      value.stripeInvoiceId === event.stripeInvoiceId,
    "stripe_event_binding_invalid",
    "The Stripe event does not identify one durable Alakazam subscription",
    { status: 400 }
  );
  return Object.freeze({
    status: value.status,
    subscription,
    incident:
      value.status === "recorded"
        ? exactIncidentResult(value.incident, {
            subscriptionId: subscription.localSubscriptionId,
            projectId: subscription.projectId,
            stripeInvoiceId: event.stripeInvoiceId
          })
        : null
  });
}

function exactIncidentInvoiceFacts(value, resolved, event) {
  exactKeys(
    value,
    [
      "amountDueMinor",
      "amountPaidMinor",
      "attemptCount",
      "currency",
      "nextPaymentAttemptAt",
      "paymentIntentStatus",
      "provider",
      "providerFactsDigest",
      "providerObservedAt",
      "schema",
      "status",
      "stripeCustomerId",
      "stripeInvoiceId",
      "stripePaymentIntentId",
      "stripeSubscriptionId",
      "subscriptionStatus",
      "tierId"
    ],
    "stripe_alakazam_incident_mismatch",
    "Stripe returned invalid Alakazam incident evidence"
  );
  const local = resolved.subscription;
  const facts = clone(value);
  delete facts.providerFactsDigest;
  requiredIso(
    value.providerObservedAt,
    "incident.providerObservedAt"
  );
  if (value.nextPaymentAttemptAt !== null) {
    requiredIso(
      value.nextPaymentAttemptAt,
      "incident.nextPaymentAttemptAt"
    );
  }
  invariant(
    value.schema ===
        ALAKAZAM_INCIDENT_INVOICE_FACTS_SCHEMA &&
      value.provider === "stripe" &&
      value.stripeInvoiceId === event.stripeInvoiceId &&
      value.stripeSubscriptionId ===
        local.stripeSubscriptionId &&
      value.stripeCustomerId === local.stripeCustomerId &&
      CUSTOMER_ID.test(value.stripeCustomerId) &&
      PAYMENT_INTENT_ID.test(value.stripePaymentIntentId) &&
      value.tierId === local.tierId &&
      // The failure must still be unpaid at readback. A late success
      // belongs to the renewal path, never to an incident.
      ["open", "uncollectible"].includes(value.status) &&
      Number.isSafeInteger(value.amountDueMinor) &&
      value.amountDueMinor > 0 &&
      value.amountPaidMinor === 0 &&
      value.currency === "USD" &&
      Number.isSafeInteger(value.attemptCount) &&
      value.attemptCount >= 1 &&
      requiredText(
        value.paymentIntentStatus,
        "incident.paymentIntentStatus",
        60
      ) &&
      requiredText(
        value.subscriptionStatus,
        "incident.subscriptionStatus",
        60
      ) &&
      requiredDigest(
        value.providerFactsDigest,
        "incident.providerFactsDigest"
      ) === digest(facts),
    "stripe_alakazam_incident_mismatch",
    "Stripe did not confirm the exact Alakazam payment incident",
    { status: 502 }
  );
  return deepFreeze(clone(value));
}

function nextUuid(ids, label) {
  return exactUuid(ids.next(label), label);
}

export function createAlakazamPaymentIncidentService({
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
        incident: false,
        state: "held",
        code: "alakazam_billing_release_held",
        policyApproved: lifecycle.approved,
        openDecisions: clone(lifecycle.openDecisions)
      });
    }
    let status;
    try {
      status = await ports.provider.readiness();
    } catch (error) {
      return deepFreeze({
        ready: false,
        incident: false,
        state: "unavailable",
        code: error?.code ?? "stripe_not_ready",
        policyApproved: lifecycle.approved,
        openDecisions: clone(lifecycle.openDecisions)
      });
    }
    if (
      status?.ready !== true ||
      status.provider !== "stripe" ||
      status.alakazam !== true ||
      status.taxModes?.alakazam !== authority.taxMode ||
      typeof status.livemode !== "boolean"
    ) {
      return deepFreeze({
        ready: false,
        incident: false,
        state: "unavailable",
        code: status?.code ?? "stripe_alakazam_not_ready",
        policyApproved: lifecycle.approved,
        openDecisions: clone(lifecycle.openDecisions)
      });
    }
    return deepFreeze({
      ready: true,
      // Evidence capture is deliberately available before the owner
      // rules. Consequences are not.
      incident: true,
      state: lifecycle.approved
        ? "incident_policy_ready"
        : "incident_evidence_only",
      provider: "stripe",
      livemode: status.livemode,
      taxMode: authority.taxMode,
      policyApproved: lifecycle.approved,
      openDecisions: clone(lifecycle.openDecisions)
    });
  }

  return Object.freeze({
    readiness,
    policy: lifecycle,

    async ingestStripeEvent(input) {
      if (!isAlakazamPaymentIncidentEvent(input)) {
        return deepFreeze({ status: "not_alakazam_incident" });
      }
      const status = await readiness();
      invariant(
        status.ready === true && status.incident === true,
        "alakazam_incident_reconciliation_unavailable",
        "Alakazam billing incident recording is temporarily unavailable.",
        { status: 503 }
      );
      const event = exactEvent(
        input,
        exactClock(ports.clock)
      );
      invariant(
        event.livemode === status.livemode,
        "stripe_event_invalid",
        "The Alakazam incident event mode is invalid",
        { status: 400 }
      );
      const resolved = exactResolvedIncident(
        await ports.repository
          .findIncidentSubscriptionByInvoice({
            stripeEventId: event.stripeEventId,
            stripeInvoiceId: event.stripeInvoiceId,
            stripeSubscriptionId: event.stripeSubscriptionId
          }),
        event
      );
      if (resolved.status === "not_alakazam") {
        return deepFreeze({ status: "not_alakazam_incident" });
      }
      if (resolved.status === "recorded") {
        return resolved.incident;
      }

      let invoice;
      try {
        invoice = await ports.provider
          .retrieveAlakazamIncidentInvoice({
            stripeInvoiceId: event.stripeInvoiceId,
            stripeSubscriptionId:
              resolved.subscription.stripeSubscriptionId,
            stripeCustomerId:
              resolved.subscription.stripeCustomerId
          });
      } catch {
        invariant(
          false,
          "alakazam_incident_reconciliation_unavailable",
          "Alakazam billing incident recording is temporarily unavailable.",
          { status: 503 }
        );
      }
      const facts = exactIncidentInvoiceFacts(
        invoice,
        resolved,
        event
      );
      const decision = decideAlakazamLifecycleTransition({
        policy: lifecycle,
        from: resolved.subscription.status,
        signal: event.incidentKind === "payment_failed"
          ? "payment_failed"
          : "payment_action_required",
        observedAt: event.occurredAt,
        firstFailedAt: resolved.subscription.firstFailedAt,
        graceEndsAt: resolved.subscription.graceEndsAt
      });
      const result =
        await ports.repository.recordPaymentIncident({
          subscription: clone(resolved.subscription),
          event,
          invoice: clone(facts),
          decision: clone(decision),
          eventRowId: nextUuid(
            ports.ids,
            "alakazam_incident_event"
          ),
          incidentId: nextUuid(
            ports.ids,
            "alakazam_payment_incident"
          ),
          tierEventId:
            decision.tierEventKind === null
              ? null
              : nextUuid(
                  ports.ids,
                  "alakazam_incident_tier_event"
                )
        });
      return exactIncidentResult(result, {
        subscriptionId:
          resolved.subscription.localSubscriptionId,
        projectId: resolved.subscription.projectId,
        stripeInvoiceId: event.stripeInvoiceId,
        incidentKind: event.incidentKind
      });
    }
  });
}

const RECOVERY_EVENT_TYPES = new Set(
  ALAKAZAM_RENEWAL_EVENT_TYPES
);
const RECOVERABLE_STATES = new Set(["grace", "suspended"]);

/**
 * A paid invoice on a subscription that is NOT active.
 *
 * Renewal (G-02) owns paid invoices for active subscriptions. This
 * owns the same provider signal for a subscription the owner's policy
 * previously moved into grace or suspension. The two are disjoint by
 * committed local status, so one paid invoice can only ever reach one
 * of them.
 */
export function isAlakazamPaymentRecoveryEvent(event) {
  const object = event?.data?.object;
  return (
    RECOVERY_EVENT_TYPES.has(event?.type) &&
    object &&
    typeof object === "object" &&
    !Array.isArray(object) &&
    object.object === "invoice" &&
    typeof object.id === "string" &&
    INVOICE_ID.test(object.id) &&
    invoiceSubscriptionId(object) !== null
  );
}

function exactRecoveryEvent(value, verifiedAt) {
  invariant(
    value &&
      EVENT_ID.test(value.id) &&
      RECOVERY_EVENT_TYPES.has(value.type) &&
      typeof value.livemode === "boolean" &&
      typeof value.api_version === "string" &&
      value.api_version.length >= 3 &&
      value.api_version.length <= 100 &&
      Number.isSafeInteger(value.created) &&
      value.created > 0,
    "stripe_event_invalid",
    "The verified Alakazam recovery event is invalid",
    { status: 400 }
  );
  const stripeInvoiceId = requiredText(
    value.data?.object?.id,
    "event.data.object.id",
    255
  );
  const stripeSubscriptionId = invoiceSubscriptionId(
    value.data.object
  );
  invariant(
    INVOICE_ID.test(stripeInvoiceId) &&
      stripeSubscriptionId !== null,
    "stripe_event_invalid",
    "The verified Alakazam recovery event has no invoiced Subscription",
    { status: 400 }
  );
  return deepFreeze({
    stripeEventId: value.id,
    eventType: value.type,
    livemode: value.livemode,
    apiVersion: value.api_version,
    stripeInvoiceId,
    stripeSubscriptionId,
    payloadDigest: createHash("sha256")
      .update(JSON.stringify(value), "utf8")
      .digest("hex"),
    signatureVerifiedAt: verifiedAt,
    occurredAt: new Date(value.created * 1000).toISOString()
  });
}

function exactRecoveryInvoiceFacts(value, resolved, event) {
  const local = resolved.subscription;
  invariant(
    value?.schema === ALAKAZAM_RENEWAL_INVOICE_FACTS_SCHEMA &&
      value.provider === "stripe" &&
      value.stripeInvoiceId === event.stripeInvoiceId &&
      value.stripeSubscriptionId ===
        local.stripeSubscriptionId &&
      value.stripeCustomerId === local.stripeCustomerId &&
      PAYMENT_INTENT_ID.test(value.stripePaymentIntentId) &&
      value.tierId === local.tierId &&
      value.status === "paid" &&
      value.listSubtotalMinor === local.amountMinor &&
      value.netSubtotalMinor === local.amountMinor &&
      Number.isSafeInteger(value.taxMinor) &&
      value.taxMinor >= 0 &&
      value.totalMinor ===
        value.netSubtotalMinor + value.taxMinor &&
      value.amountPaidMinor === value.totalMinor &&
      value.amountRemainingMinor === 0 &&
      value.currency === "USD" &&
      requiredIso(
        value.periodStartsAt,
        "invoice.periodStartsAt"
      ) &&
      requiredIso(value.periodEndsAt, "invoice.periodEndsAt") &&
      requiredIso(
        value.providerPaymentTime,
        "invoice.providerPaymentTime"
      ) &&
      requiredDigest(
        value.providerFactsDigest,
        "invoice.providerFactsDigest"
      ),
    "stripe_alakazam_recovery_mismatch",
    "Stripe did not confirm the exact recovered Alakazam payment",
    { status: 502 }
  );
  invariant(
    value.billingReason === "subscription_cycle" &&
      value.collectionMethod === "charge_automatically" &&
      value.paidOutOfBand === false,
    "alakazam_recovery_reconciliation_required",
    "The paid Alakazam invoice is not an automatically collected cycle.",
    { status: 409 }
  );
  // Restoration proves the subscription is current at the provider,
  // not merely that one charge succeeded.
  invariant(
    value.subscription?.providerStatus === "active" &&
      value.subscription.cancelAtPeriodEnd === false &&
      Date.parse(
        requiredIso(
          value.subscription.currentPeriodEndsAt,
          "subscription.currentPeriodEndsAt"
        )
      ) >
        Date.parse(
          requiredIso(
            value.subscription.currentPeriodStartsAt,
            "subscription.currentPeriodStartsAt"
          )
        ),
    "alakazam_recovery_reconciliation_required",
    "The recovered Alakazam subscription is not current at the provider.",
    { status: 409 }
  );
  return deepFreeze(clone(value));
}

function exactRecoveryResult(value, expected = {}) {
  exactKeys(
    value,
    [
      "decision",
      "next",
      "periodEndsAt",
      "periodStartsAt",
      "projectId",
      "provider",
      "receiptId",
      "revision",
      "status",
      "stripeInvoiceId",
      "subscriptionId",
      "subscriptionStatus"
    ],
    "repository_conflict",
    "the durable Alakazam recovery result is invalid"
  );
  invariant(
    value.status === "recovery_recorded" &&
      value.provider === "stripe" &&
      UUID.test(value.subscriptionId) &&
      UUID.test(value.projectId) &&
      UUID.test(value.receiptId) &&
      INVOICE_ID.test(value.stripeInvoiceId) &&
      Number.isSafeInteger(value.revision) &&
      value.revision > 1 &&
      value.subscriptionStatus === "active" &&
      requiredIso(
        value.periodStartsAt,
        "recovery.periodStartsAt"
      ) &&
      requiredIso(
        value.periodEndsAt,
        "recovery.periodEndsAt"
      ) &&
      value.decision?.schema ===
        ALAKAZAM_LIFECYCLE_DECISION_SCHEMA &&
      value.decision.tierEventKind === "payment_recovered" &&
      value.decision.policyVersion !== null &&
      value.next === "complete" &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "repository_conflict",
    "the durable Alakazam recovery result changed",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactResolvedRecovery(value, event) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "repository_conflict",
    "the Alakazam recovery binding is invalid",
    { status: 500 }
  );
  if (value.status === "not_alakazam") {
    exactKeys(
      value,
      ["status"],
      "repository_conflict",
      "the Alakazam recovery binding is invalid"
    );
    return Object.freeze({ status: "not_alakazam" });
  }
  exactKeys(
    value,
    ["provider", "status", "stripeInvoiceId", "subscription"].concat(
      value?.status === "recorded" ? ["recovery"] : []
    ),
    "repository_conflict",
    "the Alakazam recovery binding is invalid"
  );
  const subscription = exactIncidentSubscription(
    value.subscription,
    event
  );
  invariant(
    ["current", "recorded"].includes(value.status) &&
      value.provider === "stripe" &&
      value.stripeInvoiceId === event.stripeInvoiceId,
    "stripe_event_binding_invalid",
    "The Stripe event does not identify one durable Alakazam subscription",
    { status: 400 }
  );
  return Object.freeze({
    status: value.status,
    subscription,
    recovery:
      value.status === "recorded"
        ? exactRecoveryResult(value.recovery, {
            subscriptionId: subscription.localSubscriptionId,
            projectId: subscription.projectId,
            stripeInvoiceId: event.stripeInvoiceId
          })
        : null
  });
}

export function createAlakazamPaymentRecoveryService({
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
  invariant(
    typeof repository.findRecoverySubscriptionByInvoice ===
        "function" &&
      typeof repository.recordPaymentRecovery === "function" &&
      typeof provider.retrieveAlakazamRenewalInvoice ===
        "function",
    "invalid_configuration",
    "the Alakazam recovery ports are incomplete",
    { status: 500 }
  );
  const authority = exactRelease(release);
  const lifecycle = exactAlakazamLifecyclePolicy(policy);

  async function readiness() {
    if (!authority.approved) {
      return deepFreeze({
        ready: false,
        recovery: false,
        state: "held",
        code: "alakazam_billing_release_held"
      });
    }
    // Restoration is a consequence, not evidence. It cannot run until
    // the owner has ruled what restores service.
    if (!lifecycle.approved) {
      return deepFreeze({
        ready: false,
        recovery: false,
        state: "policy_decision_required",
        code: "alakazam_lifecycle_policy_held"
      });
    }
    let status;
    try {
      status = await ports.provider.readiness();
    } catch (error) {
      return deepFreeze({
        ready: false,
        recovery: false,
        state: "unavailable",
        code: error?.code ?? "stripe_not_ready"
      });
    }
    if (
      status?.ready !== true ||
      status.provider !== "stripe" ||
      status.alakazam !== true ||
      status.taxModes?.alakazam !== authority.taxMode ||
      typeof status.livemode !== "boolean"
    ) {
      return deepFreeze({
        ready: false,
        recovery: false,
        state: "unavailable",
        code: status?.code ?? "stripe_alakazam_not_ready"
      });
    }
    return deepFreeze({
      ready: true,
      recovery: true,
      state: "recovery_ready",
      provider: "stripe",
      livemode: status.livemode,
      taxMode: authority.taxMode,
      policyVersion: lifecycle.policyVersion
    });
  }

  return Object.freeze({
    readiness,

    async ingestStripeEvent(input) {
      if (!isAlakazamPaymentRecoveryEvent(input)) {
        return deepFreeze({ status: "not_alakazam_recovery" });
      }
      const status = await readiness();
      invariant(
        status.ready === true && status.recovery === true,
        "alakazam_recovery_reconciliation_unavailable",
        "Alakazam service restoration is temporarily unavailable.",
        { status: 503 }
      );
      const event = exactRecoveryEvent(
        input,
        exactClock(ports.clock)
      );
      invariant(
        event.livemode === status.livemode,
        "stripe_event_invalid",
        "The Alakazam recovery event mode is invalid",
        { status: 400 }
      );
      const resolved = exactResolvedRecovery(
        await ports.repository
          .findRecoverySubscriptionByInvoice({
            stripeEventId: event.stripeEventId,
            stripeInvoiceId: event.stripeInvoiceId,
            stripeSubscriptionId: event.stripeSubscriptionId
          }),
        event
      );
      if (resolved.status === "not_alakazam") {
        return deepFreeze({ status: "not_alakazam_recovery" });
      }
      if (resolved.status === "recorded") {
        return resolved.recovery;
      }
      // An active subscription's paid invoice belongs to renewal.
      if (!RECOVERABLE_STATES.has(resolved.subscription.status)) {
        return deepFreeze({ status: "not_alakazam_recovery" });
      }

      let invoice;
      try {
        invoice = await ports.provider
          .retrieveAlakazamRenewalInvoice({
            stripeInvoiceId: event.stripeInvoiceId,
            stripeSubscriptionId:
              resolved.subscription.stripeSubscriptionId,
            stripeCustomerId:
              resolved.subscription.stripeCustomerId
          });
      } catch {
        invariant(
          false,
          "alakazam_recovery_reconciliation_unavailable",
          "Alakazam service restoration is temporarily unavailable.",
          { status: 503 }
        );
      }
      const facts = exactRecoveryInvoiceFacts(
        invoice,
        resolved,
        event
      );
      const decision = decideAlakazamLifecycleTransition({
        policy: lifecycle,
        from: resolved.subscription.status,
        signal: "payment_recovered",
        observedAt: event.occurredAt,
        firstFailedAt: resolved.subscription.firstFailedAt,
        graceEndsAt: resolved.subscription.graceEndsAt
      });
      invariant(
        decision.tierEventKind === "payment_recovered",
        "alakazam_recovery_reconciliation_required",
        "The Alakazam subscription cannot be restored from its committed state.",
        { status: 409 }
      );
      const result =
        await ports.repository.recordPaymentRecovery({
          subscription: clone(resolved.subscription),
          event,
          invoice: clone(facts),
          decision: clone(decision),
          eventRowId: nextUuid(
            ports.ids,
            "alakazam_recovery_event"
          ),
          receiptId: nextUuid(
            ports.ids,
            "alakazam_recovery_receipt"
          ),
          tierEventId: nextUuid(
            ports.ids,
            "alakazam_recovery_tier_event"
          )
        });
      return exactRecoveryResult(result, {
        subscriptionId:
          resolved.subscription.localSubscriptionId,
        projectId: resolved.subscription.projectId,
        stripeInvoiceId: event.stripeInvoiceId
      });
    }
  });
}
