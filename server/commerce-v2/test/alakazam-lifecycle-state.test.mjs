import assert from "node:assert/strict";
import test from "node:test";

import {
  createAlakazamBillingRelease
} from "../alakazam-billing.mjs";
import {
  ALAKAZAM_LIFECYCLE_OPEN_DECISIONS,
  ALAKAZAM_LIFECYCLE_POLICY_SCHEMA,
  alakazamPolicyDeadline,
  createAlakazamLifecyclePolicy
} from "../alakazam-lifecycle-policy.mjs";
import {
  ALAKAZAM_INCIDENT_INVOICE_FACTS_SCHEMA,
  ALAKAZAM_INCIDENT_SUBSCRIPTION_SCHEMA,
  ALAKAZAM_LIFECYCLE_DECISION_SCHEMA,
  createAlakazamPaymentIncidentService,
  createAlakazamPaymentRecoveryService,
  decideAlakazamLifecycleTransition,
  isAlakazamPaymentIncidentEvent
} from "../alakazam-lifecycle-state.mjs";
import { digest } from "../canonical.mjs";

const TENANT_ID = "50000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "50000000-0000-4000-8000-000000000002";
const PROJECT_ID = "50000000-0000-4000-8000-000000000003";
const SUBSCRIPTION_ID = "50000000-0000-4000-8000-000000000004";
const EVENT_ROW_ID = "60000000-0000-4000-8000-000000000001";
const INCIDENT_ID = "60000000-0000-4000-8000-000000000002";
const TIER_EVENT_ID = "60000000-0000-4000-8000-000000000003";

const PERIOD_START = "2026-08-02T12:00:00.000Z";
const PERIOD_END = "2026-09-02T12:00:00.000Z";
const FAILED_AT = "2026-09-02T12:00:06.000Z";
const VERIFIED_AT = "2026-09-02T12:00:11.000Z";
const OBSERVED_AT = "2026-09-02T12:00:14.000Z";
const INVOICE_ID = "in_alakazam_incident_1";

const APPROVED_RELEASE = createAlakazamBillingRelease({
  approved: true,
  taxMode: "disabled_by_owner"
});

// A hypothetical ruling used only to prove the machinery. It is NOT
// the owner's policy; nothing in the source ships this.
const EXAMPLE_POLICY = createAlakazamLifecyclePolicy({
  approved: true,
  policyVersion: "alakazam-lifecycle.2026-08-08.v1",
  graceHours: 72,
  suspendAfterGraceHours: 0,
  retentionHours: 720,
  exportWindowHours: 336,
  graceConsequence: "restrict_publication",
  suspensionConsequence: "suspend_service",
  refundConsequence: "owner_review",
  disputeConsequence: "suspend_service"
});

function incidentSubscription(overrides = {}) {
  return {
    schema: ALAKAZAM_INCIDENT_SUBSCRIPTION_SCHEMA,
    localSubscriptionId: SUBSCRIPTION_ID,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    revision: 5,
    tierId: "alakazam_25",
    amountMinor: 2500,
    currency: "USD",
    status: "active",
    stripeCustomerId: "cus_alakazam_incident_1",
    stripeSubscriptionId: "sub_alakazam_incident_1",
    currentPeriodStartsAt: PERIOD_START,
    currentPeriodEndsAt: PERIOD_END,
    firstFailedAt: null,
    graceEndsAt: null,
    ...overrides
  };
}

function incidentInvoice(overrides = {}) {
  const facts = {
    schema: ALAKAZAM_INCIDENT_INVOICE_FACTS_SCHEMA,
    provider: "stripe",
    stripeInvoiceId: INVOICE_ID,
    stripeSubscriptionId: "sub_alakazam_incident_1",
    stripeCustomerId: "cus_alakazam_incident_1",
    stripePaymentIntentId: "pi_alakazam_incident_1",
    tierId: "alakazam_25",
    status: "open",
    subscriptionStatus: "past_due",
    paymentIntentStatus: "requires_payment_method",
    attemptCount: 1,
    amountDueMinor: 2500,
    amountPaidMinor: 0,
    currency: "USD",
    nextPaymentAttemptAt: "2026-09-05T12:00:00.000Z",
    providerObservedAt: OBSERVED_AT,
    ...overrides
  };
  return { ...facts, providerFactsDigest: digest(facts) };
}

function incidentEvent(overrides = {}) {
  return {
    id: "evt_alakazam_incident_1",
    type: "invoice.payment_failed",
    livemode: false,
    api_version: "2026-07-30.basil",
    created: Math.floor(Date.parse(FAILED_AT) / 1000),
    data: {
      object: {
        id: INVOICE_ID,
        object: "invoice",
        subscription: "sub_alakazam_incident_1"
      }
    },
    ...overrides
  };
}

function harness({
  resolved,
  invoice,
  incident,
  policy = createAlakazamLifecyclePolicy(),
  release = APPROVED_RELEASE
} = {}) {
  const calls = { lookups: [], readbacks: [], writes: [], ids: [] };
  const service = createAlakazamPaymentIncidentService({
    repository: {
      async findIncidentSubscriptionByInvoice(input) {
        calls.lookups.push(input);
        return resolved;
      },
      async recordPaymentIncident(input) {
        calls.writes.push(input);
        return incident;
      }
    },
    provider: {
      async readiness() {
        return {
          ready: true,
          provider: "stripe",
          alakazam: true,
          taxModes: { alakazam: "disabled_by_owner" },
          livemode: false
        };
      },
      async retrieveAlakazamIncidentInvoice(input) {
        calls.readbacks.push(input);
        return invoice;
      }
    },
    clock: { now: () => VERIFIED_AT },
    ids: {
      next(label) {
        calls.ids.push(label);
        return {
          alakazam_incident_event: EVENT_ROW_ID,
          alakazam_payment_incident: INCIDENT_ID,
          alakazam_incident_tier_event: TIER_EVENT_ID
        }[label];
      }
    },
    release,
    policy
  });
  return { service, calls };
}

function incidentResult(overrides = {}) {
  return {
    status: "incident_recorded",
    provider: "stripe",
    incidentId: INCIDENT_ID,
    subscriptionId: SUBSCRIPTION_ID,
    projectId: PROJECT_ID,
    stripeInvoiceId: INVOICE_ID,
    incidentKind: "payment_failed",
    subscriptionStatus: "active",
    consequenceApplied: false,
    decision: decideAlakazamLifecycleTransition({
      policy: createAlakazamLifecyclePolicy(),
      from: "active",
      signal: "payment_failed",
      observedAt: FAILED_AT
    }),
    next: "complete",
    ...overrides
  };
}

test(
  "an unruled Alakazam lifecycle policy carries no duration at all",
  () => {
    const held = createAlakazamLifecyclePolicy();
    assert.equal(held.schema, ALAKAZAM_LIFECYCLE_POLICY_SCHEMA);
    assert.equal(held.approved, false);
    assert.equal(held.graceHours, null);
    assert.equal(held.suspendAfterGraceHours, null);
    assert.equal(held.retentionHours, null);
    assert.equal(held.exportWindowHours, null);
    assert.equal(held.policyVersion, null);
    assert.deepEqual(
      held.openDecisions,
      ALAKAZAM_LIFECYCLE_OPEN_DECISIONS.map(
        (entry) => entry.decision
      )
    );
    // The legacy 14-day grace and 90-day retention are not inherited.
    assert.equal(alakazamPolicyDeadline(FAILED_AT, null), null);
    assert.throws(
      () =>
        createAlakazamLifecyclePolicy({ graceHours: 336 }),
      { code: "invalid_configuration" }
    );
    assert.throws(
      () =>
        createAlakazamLifecyclePolicy({
          approved: true,
          policyVersion: "whenever",
          graceHours: 72,
          suspendAfterGraceHours: 0,
          retentionHours: 720,
          exportWindowHours: 336,
          graceConsequence: "restrict_publication",
          suspensionConsequence: "suspend_service",
          refundConsequence: "owner_review",
          disputeConsequence: "suspend_service"
        }),
      { code: "invalid_configuration" }
    );
  }
);

test(
  "without an owner ruling a failed payment changes nothing",
  () => {
    const decision = decideAlakazamLifecycleTransition({
      policy: createAlakazamLifecyclePolicy(),
      from: "active",
      signal: "payment_failed",
      observedAt: FAILED_AT
    });
    assert.equal(
      decision.schema,
      ALAKAZAM_LIFECYCLE_DECISION_SCHEMA
    );
    assert.equal(decision.to, "active");
    assert.equal(decision.tierEventKind, null);
    assert.equal(decision.graceEndsAt, null);
    assert.equal(decision.policyVersion, null);
    assert.equal(decision.serviceState, "unchanged");
    assert.equal(decision.consequence, "record_only");
    assert.equal(decision.ownerState, "policy_decision_required");
    assert.equal(decision.reason, "policy_decision_required");
    assert.equal(
      decision.customerMessageCode,
      "alakazam_billing_attention"
    );
  }
);

test(
  "an approved ruling drives grace, suspension, and restoration",
  () => {
    const grace = decideAlakazamLifecycleTransition({
      policy: EXAMPLE_POLICY,
      from: "active",
      signal: "payment_failed",
      observedAt: FAILED_AT
    });
    assert.equal(grace.to, "grace");
    assert.equal(grace.tierEventKind, "payment_failed");
    assert.equal(grace.policyVersion, EXAMPLE_POLICY.policyVersion);
    assert.equal(grace.serviceState, "limited");
    assert.equal(
      grace.graceEndsAt,
      "2026-09-05T12:00:06.000Z"
    );

    // Suspension may not land before the ruled boundary passes.
    const early = decideAlakazamLifecycleTransition({
      policy: EXAMPLE_POLICY,
      from: "grace",
      signal: "grace_expired",
      observedAt: "2026-09-04T12:00:00.000Z",
      firstFailedAt: FAILED_AT,
      graceEndsAt: grace.graceEndsAt
    });
    assert.equal(early.to, "grace");
    assert.equal(early.tierEventKind, null);
    assert.equal(early.reason, "policy_boundary_not_reached");

    const suspended = decideAlakazamLifecycleTransition({
      policy: EXAMPLE_POLICY,
      from: "grace",
      signal: "grace_expired",
      observedAt: "2026-09-05T12:00:07.000Z",
      firstFailedAt: FAILED_AT,
      graceEndsAt: grace.graceEndsAt
    });
    assert.equal(suspended.to, "suspended");
    assert.equal(suspended.tierEventKind, "suspended");
    assert.equal(suspended.serviceState, "suspended");

    for (const from of ["grace", "suspended"]) {
      const restored = decideAlakazamLifecycleTransition({
        policy: EXAMPLE_POLICY,
        from,
        signal: "payment_recovered",
        observedAt: "2026-09-06T12:00:00.000Z",
        firstFailedAt: FAILED_AT,
        graceEndsAt: grace.graceEndsAt
      });
      assert.equal(restored.to, "active");
      assert.equal(
        restored.tierEventKind,
        "payment_recovered"
      );
      assert.equal(restored.graceEndsAt, null);
      assert.equal(
        restored.customerMessageCode,
        "alakazam_billing_current"
      );
    }
  }
);

test(
  "terminal and unrelated states are never moved by a billing signal",
  () => {
    for (const from of ["pending", "cancelled", "ended"]) {
      const decision = decideAlakazamLifecycleTransition({
        policy: EXAMPLE_POLICY,
        from,
        signal: "payment_failed",
        observedAt: FAILED_AT
      });
      assert.equal(decision.to, from);
      assert.equal(decision.tierEventKind, null);
      assert.equal(decision.reason, "no_transition_defined");
    }
    assert.throws(
      () =>
        decideAlakazamLifecycleTransition({
          policy: EXAMPLE_POLICY,
          from: "invented",
          signal: "payment_failed",
          observedAt: FAILED_AT
        }),
      { code: "invalid_input" }
    );
  }
);

test(
  "only failed and action-required invoice events are incidents",
  () => {
    assert.equal(
      isAlakazamPaymentIncidentEvent(incidentEvent()),
      true
    );
    assert.equal(
      isAlakazamPaymentIncidentEvent(
        incidentEvent({
          type: "invoice.payment_action_required"
        })
      ),
      true
    );
    assert.equal(
      isAlakazamPaymentIncidentEvent(
        incidentEvent({ type: "invoice.paid" })
      ),
      false
    );
  }
);

test(
  "incident evidence is captured while the consequence stays held",
  async () => {
    const { service, calls } = harness({
      resolved: {
        status: "current",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: incidentSubscription()
      },
      invoice: incidentInvoice(),
      incident: incidentResult()
    });
    const ready = await service.readiness();
    assert.equal(ready.ready, true);
    assert.equal(ready.incident, true);
    assert.equal(ready.state, "incident_evidence_only");
    assert.equal(ready.policyApproved, false);
    assert.ok(ready.openDecisions.includes("grace_duration"));

    const result = await service.ingestStripeEvent(
      incidentEvent()
    );
    assert.equal(result.status, "incident_recorded");
    assert.equal(result.consequenceApplied, false);
    assert.equal(result.subscriptionStatus, "active");
    assert.equal(calls.writes.length, 1);
    assert.equal(calls.writes[0].tierEventId, null);
    assert.equal(
      calls.writes[0].decision.policyVersion,
      null
    );
    // No tier-event id is even minted while the policy is unruled.
    assert.deepEqual(calls.ids, [
      "alakazam_incident_event",
      "alakazam_payment_incident"
    ]);
  }
);

test(
  "an approved policy mints the consequence evidence it will commit",
  async () => {
    const decision = decideAlakazamLifecycleTransition({
      policy: EXAMPLE_POLICY,
      from: "active",
      signal: "payment_failed",
      observedAt: FAILED_AT
    });
    const { service, calls } = harness({
      policy: EXAMPLE_POLICY,
      resolved: {
        status: "current",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: incidentSubscription()
      },
      invoice: incidentInvoice(),
      incident: incidentResult({
        consequenceApplied: true,
        subscriptionStatus: "grace",
        decision
      })
    });
    assert.equal(
      (await service.readiness()).state,
      "incident_policy_ready"
    );
    const result = await service.ingestStripeEvent(
      incidentEvent()
    );
    assert.equal(result.consequenceApplied, true);
    assert.equal(result.subscriptionStatus, "grace");
    assert.equal(calls.writes[0].tierEventId, TIER_EVENT_ID);
    assert.equal(
      calls.writes[0].decision.graceEndsAt,
      "2026-09-05T12:00:06.000Z"
    );
    assert.deepEqual(calls.ids, [
      "alakazam_incident_event",
      "alakazam_payment_incident",
      "alakazam_incident_tier_event"
    ]);
  }
);

test(
  "a held release, an unowned invoice, and a replay write nothing new",
  async () => {
    const heldRelease = harness({
      release: createAlakazamBillingRelease(),
      resolved: {
        status: "current",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: incidentSubscription()
      }
    });
    await assert.rejects(
      () =>
        heldRelease.service.ingestStripeEvent(incidentEvent()),
      { code: "alakazam_incident_reconciliation_unavailable" }
    );
    assert.deepEqual(heldRelease.calls.lookups, []);

    const unowned = harness({
      resolved: { status: "not_alakazam" }
    });
    assert.deepEqual(
      await unowned.service.ingestStripeEvent(incidentEvent()),
      { status: "not_alakazam_incident" }
    );
    assert.deepEqual(unowned.calls.readbacks, []);
    assert.deepEqual(unowned.calls.writes, []);

    const replay = harness({
      resolved: {
        status: "recorded",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: incidentSubscription(),
        incident: incidentResult()
      }
    });
    const replayed = await replay.service.ingestStripeEvent(
      incidentEvent()
    );
    assert.equal(replayed.incidentId, INCIDENT_ID);
    assert.deepEqual(replay.calls.readbacks, []);
    assert.deepEqual(replay.calls.writes, []);
  }
);

test(
  "an invoice that is already paid is not a payment incident",
  async () => {
    for (const override of [
      { status: "paid" },
      { amountPaidMinor: 2500 },
      { attemptCount: 0 }
    ]) {
      const { service, calls } = harness({
        resolved: {
          status: "current",
          provider: "stripe",
          stripeInvoiceId: INVOICE_ID,
          subscription: incidentSubscription()
        },
        invoice: incidentInvoice(override)
      });
      await assert.rejects(
        () => service.ingestStripeEvent(incidentEvent()),
        { code: "stripe_alakazam_incident_mismatch" }
      );
      assert.deepEqual(calls.writes, []);
    }
  }
);

test(
  "an unruled policy can never report a service consequence",
  async () => {
    const { service } = harness({
      resolved: {
        status: "current",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: incidentSubscription()
      },
      invoice: incidentInvoice(),
      // A repository that claims it suspended service without a ruling.
      incident: incidentResult({
        consequenceApplied: true,
        subscriptionStatus: "suspended"
      })
    });
    await assert.rejects(
      () => service.ingestStripeEvent(incidentEvent()),
      { code: "repository_conflict" }
    );
  }
);

function recoveryHarness({
  resolved,
  invoice,
  recovery,
  policy = EXAMPLE_POLICY
} = {}) {
  const calls = { lookups: [], readbacks: [], writes: [] };
  const service = createAlakazamPaymentRecoveryService({
    repository: {
      async findIncidentSubscriptionByInvoice() {
        throw new Error("unused");
      },
      async recordPaymentIncident() {
        throw new Error("unused");
      },
      async findRecoverySubscriptionByInvoice(input) {
        calls.lookups.push(input);
        return resolved;
      },
      async recordPaymentRecovery(input) {
        calls.writes.push(input);
        return recovery;
      }
    },
    provider: {
      async readiness() {
        return {
          ready: true,
          provider: "stripe",
          alakazam: true,
          taxModes: { alakazam: "disabled_by_owner" },
          livemode: false
        };
      },
      async retrieveAlakazamIncidentInvoice() {
        throw new Error("unused");
      },
      async retrieveAlakazamRenewalInvoice(input) {
        calls.readbacks.push(input);
        return invoice;
      }
    },
    clock: { now: () => VERIFIED_AT },
    ids: { next: () => "70000000-0000-4000-8000-000000000001" },
    release: APPROVED_RELEASE,
    policy
  });
  return { service, calls };
}

test(
  "restoration refuses to run until the owner rules what restores service",
  async () => {
    const { service, calls } = recoveryHarness({
      policy: createAlakazamLifecyclePolicy(),
      resolved: {
        status: "current",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: incidentSubscription({ status: "suspended" })
      }
    });
    const ready = await service.readiness();
    assert.equal(ready.ready, false);
    assert.equal(ready.state, "policy_decision_required");
    assert.equal(ready.code, "alakazam_lifecycle_policy_held");
    await assert.rejects(
      () =>
        service.ingestStripeEvent(
          incidentEvent({ type: "invoice.paid" })
        ),
      { code: "alakazam_recovery_reconciliation_unavailable" }
    );
    assert.deepEqual(calls.lookups, []);
    assert.deepEqual(calls.writes, []);
  }
);

test(
  "a paid invoice on an active subscription is renewal, not restoration",
  async () => {
    const { service, calls } = recoveryHarness({
      resolved: {
        status: "current",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: incidentSubscription({ status: "active" })
      }
    });
    assert.deepEqual(
      await service.ingestStripeEvent(
        incidentEvent({ type: "invoice.paid" })
      ),
      { status: "not_alakazam_recovery" }
    );
    assert.deepEqual(calls.readbacks, []);
    assert.deepEqual(calls.writes, []);
  }
);
