import assert from "node:assert/strict";
import test from "node:test";

import {
  createAlakazamBillingRelease
} from "../alakazam-billing.mjs";
import {
  createAlakazamLifecyclePolicy
} from "../alakazam-lifecycle-policy.mjs";
import {
  ALAKAZAM_CANCELLATION_FACTS_SCHEMA,
  ALAKAZAM_CANCELLATION_PREVIEW_SCHEMA,
  ALAKAZAM_CANCELLATION_REQUEST_SCHEMA,
  ALAKAZAM_CANCELLATION_SUBSCRIPTION_SCHEMA,
  ALAKAZAM_EXPORT_GRANT_SCHEMA,
  createAlakazamCancellationService,
  isAlakazamCancellationConfirmationEvent,
  previewAlakazamCancellation,
  projectAlakazamExportGrant
} from "../alakazam-lifecycle-cancellation.mjs";
import { digest } from "../canonical.mjs";

const TENANT_ID = "80000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "80000000-0000-4000-8000-000000000002";
const PROJECT_ID = "80000000-0000-4000-8000-000000000003";
const SUBSCRIPTION_ID = "80000000-0000-4000-8000-000000000004";
const CANCELLATION_ID = "90000000-0000-4000-8000-000000000001";
const EVENT_ROW_ID = "90000000-0000-4000-8000-000000000002";
const TIER_EVENT_ID = "90000000-0000-4000-8000-000000000003";
const GRANT_ID = "90000000-0000-4000-8000-000000000004";

const PERIOD_START = "2026-08-02T12:00:00.000Z";
const PERIOD_END = "2026-09-02T12:00:00.000Z";
const REQUESTED_AT = "2026-08-10T09:00:00.000Z";
const VERIFIED_AT = "2026-08-10T09:00:05.000Z";
const OBSERVED_AT = "2026-08-10T09:00:08.000Z";

const APPROVED_RELEASE = createAlakazamBillingRelease({
  approved: true,
  taxMode: "disabled_by_owner"
});

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

function cancellationSubscription(overrides = {}) {
  return {
    schema: ALAKAZAM_CANCELLATION_SUBSCRIPTION_SCHEMA,
    localSubscriptionId: SUBSCRIPTION_ID,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    revision: 4,
    tierId: "alakazam_35",
    amountMinor: 3500,
    currency: "USD",
    status: "active",
    stripeCustomerId: "cus_alakazam_cancel_1",
    stripeSubscriptionId: "sub_alakazam_cancel_1",
    currentPeriodStartsAt: PERIOD_START,
    currentPeriodEndsAt: PERIOD_END,
    cancelAtPeriodEnd: false,
    hasOpenDowngrade: false,
    ...overrides
  };
}

function cancellationFacts(overrides = {}) {
  const facts = {
    schema: ALAKAZAM_CANCELLATION_FACTS_SCHEMA,
    provider: "stripe",
    stripeSubscriptionId: "sub_alakazam_cancel_1",
    stripeCustomerId: "cus_alakazam_cancel_1",
    tierId: "alakazam_35",
    currency: "USD",
    providerStatus: "active",
    cancelAtPeriodEnd: true,
    cancelAt: PERIOD_END,
    currentPeriodStartsAt: PERIOD_START,
    currentPeriodEndsAt: PERIOD_END,
    providerObservedAt: OBSERVED_AT,
    ...overrides
  };
  return { ...facts, providerFactsDigest: digest(facts) };
}

function confirmationEvent(overrides = {}) {
  return {
    id: "evt_alakazam_cancel_1",
    type: "customer.subscription.updated",
    livemode: false,
    api_version: "2026-07-30.basil",
    created: Math.floor(Date.parse(REQUESTED_AT) / 1000),
    data: {
      object: {
        id: "sub_alakazam_cancel_1",
        cancel_at_period_end: true
      }
    },
    ...overrides
  };
}

function harness({
  resolved,
  facts,
  result,
  subscription,
  claim,
  scheduled,
  release = APPROVED_RELEASE,
  policy = createAlakazamLifecyclePolicy()
} = {}) {
  const calls = {
    claims: [],
    readbacks: [],
    schedules: [],
    writes: []
  };
  const service = createAlakazamCancellationService({
    repository: {
      async readCancellationSubscription() {
        return subscription ?? null;
      },
      async claimCancellationRequest(input) {
        calls.claims.push(input);
        return claim ?? {
          status: "reserved",
          cancellationId: input.cancellationId,
          state: "dispatching"
        };
      },
      async findCancellationBySubscription() {
        return resolved;
      },
      async confirmCancellationSchedule(input) {
        calls.writes.push(input);
        return result;
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
      async retrieveAlakazamCancellation(input) {
        calls.readbacks.push(input);
        return facts;
      },
      async scheduleCancellation(input) {
        calls.schedules.push(input);
        return scheduled ?? {
          subscriptionId:
            "sub_alakazam_cancel_1",
          providerStatus: "active",
          cancelAtPeriodEnd: true,
          effectiveAt: PERIOD_END
        };
      }
    },
    clock: { now: () => VERIFIED_AT },
    ids: {
      next(label) {
        return {
          alakazam_cancellation: CANCELLATION_ID,
          alakazam_cancellation_event: EVENT_ROW_ID,
          alakazam_cancellation_tier_event: TIER_EVENT_ID,
          alakazam_export_grant: GRANT_ID
        }[label];
      }
    },
    release,
    policy
  });
  return { service, calls };
}

test(
  "a cancelling customer keeps the period they paid for",
  () => {
    const preview = previewAlakazamCancellation({
      policy: createAlakazamLifecyclePolicy(),
      subscription: cancellationSubscription(),
      now: REQUESTED_AT,
      effectsAuthorized: false
    });
    assert.equal(
      preview.schema,
      ALAKAZAM_CANCELLATION_PREVIEW_SCHEMA
    );
    assert.equal(preview.eligible, true);
    assert.equal(preview.effectiveAt, PERIOD_END);
    assert.equal(preview.servesUntil, PERIOD_END);
    assert.equal(
      preview.furtherChargesAfterEffective,
      false
    );
    // Export runs through the paid period regardless of policy.
    assert.equal(preview.export.state, "available");
    assert.equal(preview.export.paidThroughAt, PERIOD_END);
    assert.equal(preview.export.availableFrom, REQUESTED_AT);
    // A held lifecycle authority cannot invent a retention window.
    assert.equal(
      preview.export.retentionState,
      "policy_decision_required"
    );
    assert.equal(preview.export.retentionEndsAt, null);
    assert.equal(preview.export.exportWindowEndsAt, null);
    assert.equal(
      preview.refundTreatment,
      "no_partial_period_refund_or_proration"
    );
    assert.deepEqual(preview.refundExceptions, [
      "required_by_law",
      "duplicate_or_unauthorized_charge",
      "proven_service_failure"
    ]);
    assert.equal(preview.cancellationFeeMinor, 0);
    assert.equal(preview.undoAvailable, false);
    assert.equal(
      preview.undoTreatment,
      "resubscribe_separately"
    );
    assert.match(preview.disclosureDigest, /^[a-f0-9]{64}$/u);
    assert.equal(preview.actions.requestCancellation, false);
  }
);

test(
  "an approved retention ruling states an exact export window",
  () => {
    const grant = projectAlakazamExportGrant({
      policy: EXAMPLE_POLICY,
      availableFrom: REQUESTED_AT,
      paidThroughAt: PERIOD_END
    });
    assert.equal(grant.schema, ALAKAZAM_EXPORT_GRANT_SCHEMA);
    assert.equal(grant.retentionState, "granted");
    assert.equal(
      grant.policyVersion,
      "alakazam-lifecycle.2026-08-08.v1"
    );
    assert.equal(
      grant.exportWindowEndsAt,
      "2026-09-16T12:00:00.000Z"
    );
    assert.equal(
      grant.retentionEndsAt,
      "2026-10-02T12:00:00.000Z"
    );
    // Export can never outlast the retention that backs it.
    assert.throws(
      () =>
        projectAlakazamExportGrant({
          policy: createAlakazamLifecyclePolicy({
            approved: true,
            policyVersion:
              "alakazam-lifecycle.2026-08-08.v2",
            graceHours: 0,
            suspendAfterGraceHours: 0,
            retentionHours: 24,
            exportWindowHours: 48,
            graceConsequence: "record_only",
            suspensionConsequence: "suspend_service",
            refundConsequence: "owner_review",
            disputeConsequence: "owner_review"
          }),
          availableFrom: REQUESTED_AT,
          paidThroughAt: PERIOD_END
        }),
      { code: "invalid_configuration" }
    );
  }
);

test(
  "cancellation is refused when the subscription is not current",
  () => {
    for (const [overrides, reason] of [
      [{ cancelAtPeriodEnd: true }, "already_scheduled_to_end"],
      [{ hasOpenDowngrade: true }, "open_tier_change"],
      [{ status: "ended" }, "subscription_not_current"],
      [
        { currentPeriodEndsAt: "2026-08-09T09:00:00.000Z" },
        "period_boundary_passed"
      ]
    ]) {
      const preview = previewAlakazamCancellation({
        policy: createAlakazamLifecyclePolicy(),
        subscription: cancellationSubscription(overrides),
        now: REQUESTED_AT
      });
      assert.equal(preview.eligible, false);
      assert.equal(preview.ineligibleReason, reason);
    }
  }
);

test(
  "only an unbranded period-end subscription update is a cancellation",
  () => {
    assert.equal(
      isAlakazamCancellationConfirmationEvent(
        confirmationEvent()
      ),
      true
    );
    assert.equal(
      isAlakazamCancellationConfirmationEvent(
        confirmationEvent({
          data: {
            object: {
              id: "sub_alakazam_cancel_1",
              cancel_at_period_end: false
            }
          }
        })
      ),
      false
    );
    // A start/upgrade/downgrade transition belongs to its own service.
    assert.equal(
      isAlakazamCancellationConfirmationEvent(
        confirmationEvent({
          data: {
            object: {
              id: "sub_alakazam_cancel_1",
              cancel_at_period_end: true,
              metadata: {
                schema: "sitesourcery_alakazam_change_v1",
                change_kind: "downgrade"
              }
            }
          }
        })
      ),
      false
    );
  }
);

test(
  "an approved customer request schedules only the paid-period boundary",
  async () => {
    const current = cancellationSubscription();
    const { service, calls } = harness({
      subscription: current,
      policy: EXAMPLE_POLICY
    });
    const preview = await service.preview({
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      projectId: PROJECT_ID
    });
    assert.equal(preview.actions.requestCancellation, true);
    assert.equal(preview.actions.reason, null);
    assert.equal(preview.disclosure.cancellationFeeMinor, 0);
    assert.equal(preview.disclosure.retainedExitHours, 720);
    assert.equal(preview.disclosure.exportWindowHours, 336);

    const result = await service.request(
      {
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
        projectId: PROJECT_ID
      },
      {
        acceptedDisclosureDigest: preview.disclosureDigest
      }
    );
    assert.equal(
      result.schema,
      ALAKAZAM_CANCELLATION_REQUEST_SCHEMA
    );
    assert.equal(result.status, "provider_confirmation_pending");
    assert.equal(result.effectiveAt, PERIOD_END);
    assert.equal(result.servesUntil, PERIOD_END);
    assert.equal(result.cancellationFeeMinor, 0);
    assert.equal(result.furtherChargesAfterEffective, false);
    assert.equal(result.next, "verified_provider_confirmation");
    assert.equal(calls.claims.length, 1);
    assert.equal(calls.schedules.length, 1);
    assert.deepEqual(calls.schedules[0], {
      stripeSubscriptionId: "sub_alakazam_cancel_1",
      idempotencyKey:
        `alakazam:cancel:${CANCELLATION_ID}`,
      cancellationDigest: preview.disclosureDigest
    });
  }
);

test(
  "a changed disclosure and a held release never reach Stripe",
  async () => {
    const approved = harness({
      subscription: cancellationSubscription(),
      policy: EXAMPLE_POLICY
    });
    await assert.rejects(
      () => approved.service.request(
        {
          tenantId: TENANT_ID,
          customerId: CUSTOMER_ID,
          projectId: PROJECT_ID
        },
        { acceptedDisclosureDigest: "a".repeat(64) }
      ),
      { code: "alakazam_cancellation_disclosure_changed" }
    );
    assert.deepEqual(approved.calls.claims, []);
    assert.deepEqual(approved.calls.schedules, []);

    const held = harness({
      subscription: cancellationSubscription(),
      policy: EXAMPLE_POLICY,
      release: createAlakazamBillingRelease()
    });
    const heldPreview = await held.service.preview({
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      projectId: PROJECT_ID
    });
    assert.equal(
      heldPreview.actions.requestCancellation,
      false
    );
    await assert.rejects(
      () => held.service.request(
        {
          tenantId: TENANT_ID,
          customerId: CUSTOMER_ID,
          projectId: PROJECT_ID
        },
        {
          acceptedDisclosureDigest:
            heldPreview.disclosureDigest
        }
      ),
      { code: "alakazam_cancellation_unavailable" }
    );
    assert.deepEqual(held.calls.claims, []);
    assert.deepEqual(held.calls.schedules, []);
  }
);

test(
  "a retry reuses the durable cancellation ID as Stripe idempotency",
  async () => {
    const { service, calls } = harness({
      subscription: cancellationSubscription(),
      policy: EXAMPLE_POLICY,
      claim: {
        status: "existing",
        cancellationId: CANCELLATION_ID,
        state: "dispatching"
      }
    });
    const preview = await service.preview({
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      projectId: PROJECT_ID
    });
    const result = await service.request(
      {
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
        projectId: PROJECT_ID
      },
      {
        acceptedDisclosureDigest: preview.disclosureDigest
      }
    );
    assert.equal(result.cancellationId, CANCELLATION_ID);
    assert.equal(
      calls.schedules[0].idempotencyKey,
      `alakazam:cancel:${CANCELLATION_ID}`
    );
  }
);

test(
  "a confirmed cancellation grants the paid-period export",
  async () => {
    const grant = projectAlakazamExportGrant({
      policy: createAlakazamLifecyclePolicy(),
      availableFrom: REQUESTED_AT,
      paidThroughAt: PERIOD_END
    });
    const { service, calls } = harness({
      resolved: {
        status: "requested",
        provider: "stripe",
        subscription: cancellationSubscription(),
        cancellation: {
          cancellationId: CANCELLATION_ID,
          state: "dispatching",
          effectiveAt: PERIOD_END,
          subscriptionRevisionAtRequest: 4
        }
      },
      facts: cancellationFacts(),
      result: {
        status: "cancellation_scheduled",
        provider: "stripe",
        state: "scheduled",
        cancellationId: CANCELLATION_ID,
        subscriptionId: SUBSCRIPTION_ID,
        projectId: PROJECT_ID,
        effectiveAt: PERIOD_END,
        revision: 5,
        export: grant,
        next: "boundary_confirmation"
      }
    });
    const result = await service.ingestStripeEvent(
      confirmationEvent()
    );
    assert.equal(result.status, "cancellation_scheduled");
    assert.equal(result.effectiveAt, PERIOD_END);
    assert.equal(result.export.state, "available");
    assert.equal(
      result.export.retentionState,
      "policy_decision_required"
    );
    assert.equal(calls.writes.length, 1);
    assert.equal(
      calls.writes[0].grant.paidThroughAt,
      PERIOD_END
    );
  }
);

test(
  "a stop that does not land on the paid boundary is refused",
  async () => {
    for (const override of [
      { cancelAt: "2026-08-15T12:00:00.000Z" },
      { currentPeriodEndsAt: "2026-10-02T12:00:00.000Z" }
    ]) {
      const { service, calls } = harness({
        resolved: {
          status: "requested",
          provider: "stripe",
          subscription: cancellationSubscription(),
          cancellation: {
            cancellationId: CANCELLATION_ID,
            state: "dispatching",
            effectiveAt: PERIOD_END,
            subscriptionRevisionAtRequest: 4
          }
        },
        facts: cancellationFacts(override)
      });
      await assert.rejects(
        () => service.ingestStripeEvent(confirmationEvent()),
        { code: "stripe_alakazam_cancellation_mismatch" }
      );
      assert.deepEqual(calls.writes, []);
    }
  }
);

test(
  "an unrequested provider stop is never confirmed as a cancellation",
  async () => {
    const { service, calls } = harness({
      resolved: { status: "not_alakazam" }
    });
    assert.deepEqual(
      await service.ingestStripeEvent(confirmationEvent()),
      { status: "not_alakazam_cancellation" }
    );
    assert.deepEqual(calls.readbacks, []);
    assert.deepEqual(calls.writes, []);
  }
);

test(
  "the cancellation effect stays held while the preview stays truthful",
  async () => {
    const { service, calls } = harness({
      release: createAlakazamBillingRelease(),
      subscription: cancellationSubscription(),
      resolved: {
        status: "requested",
        provider: "stripe",
        subscription: cancellationSubscription(),
        cancellation: {
          cancellationId: CANCELLATION_ID,
          state: "dispatching",
          effectiveAt: PERIOD_END,
          subscriptionRevisionAtRequest: 4
        }
      }
    });
    assert.deepEqual(await service.readiness(), {
      ready: false,
      cancellation: false,
      state: "held",
      code: "alakazam_billing_release_held"
    });
    // The customer can still be told the truth about stopping.
    const preview = await service.preview({
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      projectId: PROJECT_ID
    });
    assert.equal(preview.eligible, true);
    assert.equal(preview.export.paidThroughAt, PERIOD_END);
    assert.equal(preview.actions.requestCancellation, false);

    await assert.rejects(
      () => service.ingestStripeEvent(confirmationEvent()),
      { code: "alakazam_cancellation_reconciliation_unavailable" }
    );
    assert.deepEqual(calls.readbacks, []);
    assert.deepEqual(calls.writes, []);
  }
);

test(
  "a repository that promises an unruled retention window is refused",
  async () => {
    const { service } = harness({
      resolved: {
        status: "requested",
        provider: "stripe",
        subscription: cancellationSubscription(),
        cancellation: {
          cancellationId: CANCELLATION_ID,
          state: "dispatching",
          effectiveAt: PERIOD_END,
          subscriptionRevisionAtRequest: 4
        }
      },
      facts: cancellationFacts(),
      result: {
        status: "cancellation_scheduled",
        provider: "stripe",
        state: "scheduled",
        cancellationId: CANCELLATION_ID,
        subscriptionId: SUBSCRIPTION_ID,
        projectId: PROJECT_ID,
        effectiveAt: PERIOD_END,
        revision: 5,
        export: {
          schema: ALAKAZAM_EXPORT_GRANT_SCHEMA,
          state: "available",
          availableFrom: REQUESTED_AT,
          paidThroughAt: PERIOD_END,
          retentionState: "policy_decision_required",
          policyVersion: null,
          // An invented window with no ruling behind it.
          retentionEndsAt: "2026-12-01T12:00:00.000Z",
          exportWindowEndsAt: "2026-11-01T12:00:00.000Z"
        },
        next: "boundary_confirmation"
      }
    });
    await assert.rejects(
      () => service.ingestStripeEvent(confirmationEvent()),
      { code: "repository_conflict" }
    );
  }
);
