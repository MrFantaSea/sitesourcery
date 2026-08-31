import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_POLICY_AUTHORITY,
  ALAKAZAM_POLICY_AUTHORITY_DIGEST,
  ALAKAZAM_POLICY_AUTHORITY_ID,
  ALAKAZAM_POLICY_HOLD_REASON,
  createAlakazamPolicySnapshot,
  exactAlakazamPolicyAuthority
} from "../alakazam-policy-authority.mjs";

const IDS = Object.freeze({
  tenantId: "10000000-0000-4000-8000-000000000001",
  projectId: "10000000-0000-4000-8000-000000000002",
  customerId: "10000000-0000-4000-8000-000000000003",
  subscriptionId: "10000000-0000-4000-8000-000000000004",
  transitionEventId: "10000000-0000-4000-8000-000000000005",
  retentionWindowId: "10000000-0000-4000-8000-000000000006"
});

function snapshot(overrides = {}) {
  return {
    policyId: ALAKAZAM_POLICY_AUTHORITY_ID,
    authorityDigest: ALAKAZAM_POLICY_AUTHORITY_DIGEST,
    ...IDS,
    cancellationId: null,
    reversalEventId: null,
    sourceSubscriptionRevision: 8,
    sourceSubscriptionStatus: "grace",
    lifecycleState: "payment_grace",
    retentionWindowId: null,
    retentionEndsAt: null,
    commercialEffects: true,
    providerEffects: true,
    publicationEffects: true,
    automaticRecoveryFromReversalEvidence: false,
    holdReason: ALAKAZAM_POLICY_HOLD_REASON,
    observedAt: "2026-08-10T12:00:00.000Z",
    ...overrides
  };
}

test("one canonical released Alakazam authority preserves exact customer rights", () => {
  assert.equal(
    ALAKAZAM_POLICY_AUTHORITY.policyId,
    "SS-ALAKAZAM-POLICY-2026-08-31-V2"
  );
  assert.equal(ALAKAZAM_POLICY_AUTHORITY.state, "released");
  assert.equal(ALAKAZAM_POLICY_AUTHORITY.holdReason, null);
  assert.deepEqual(ALAKAZAM_POLICY_AUTHORITY.effects, {
    commercial: true,
    provider: true,
    publication: true,
    automaticRecoveryFromReversalEvidence: false
  });
  assert.deepEqual(ALAKAZAM_POLICY_AUTHORITY.customerRights, {
    paymentGraceHours: 168,
    retainedExitHours: 720,
    exportWindowHours: 720,
    cancellationExitRequires: [
      "provider_confirmed_effective_cancellation",
      "paid_through_boundary_reached",
      "available_export_grant"
    ],
    purgeOnlyAt: [
      "retained_exit_expiry",
      "terminal_customer_deletion"
    ]
  });
  assert.deepEqual(ALAKAZAM_POLICY_AUTHORITY.tax, {
    authority: "purpose_bound_separate_activation",
    stripeTaxCode: "txcd_10701100",
    taxBehavior: "exclusive",
    collectionState: "automatic"
  });
  assert.deepEqual(ALAKAZAM_POLICY_AUTHORITY.subscription, {
    tiers: ["alakazam_25", "alakazam_35", "alakazam_50"],
    billingModel: "stripe_subscription",
    renewalEvidence: "exact_invoice_readback",
    cancellationPolicyVersion:
      "alakazam-cancellation.2026-08-31.v1",
    cancellationEffectiveAt: "paid_through_boundary",
    cancellationFeeMinor: 0,
    cancellationRefundTreatment:
      "no_partial_period_refund_or_proration",
    cancellationRefundExceptions: [
      "required_by_law",
      "duplicate_or_unauthorized_charge",
      "proven_service_failure"
    ],
    cancellationUndoTreatment: "resubscribe_separately"
  });
  assert.equal(
    ALAKAZAM_POLICY_AUTHORITY_DIGEST,
    "145892e43ab6f4a03ebbed84fd148633f9a4de9727ce4294a0eb9b08f329c320"
  );
  assert.deepEqual(
    exactAlakazamPolicyAuthority(ALAKAZAM_POLICY_AUTHORITY),
    ALAKAZAM_POLICY_AUTHORITY
  );
});

test("canonical snapshots retain legacy evidence without creating authority", () => {
  const grace = createAlakazamPolicySnapshot(snapshot());
  assert.equal(grace.lifecycleState, "payment_grace");
  assert.equal(grace.sourceSubscriptionRevision, 8);
  assert.equal(grace.providerEffects, true);
  assert.equal(grace.automaticRecoveryFromReversalEvidence, false);

  const retained = createAlakazamPolicySnapshot(snapshot({
    sourceSubscriptionRevision: 9,
    sourceSubscriptionStatus: "suspended",
    lifecycleState: "retained_exit",
    retentionWindowId: IDS.retentionWindowId,
    retentionEndsAt: "2026-09-09T12:00:00.000Z"
  }));
  assert.equal(retained.lifecycleState, "retained_exit");
  assert.equal(retained.retentionWindowId, IDS.retentionWindowId);
});

test("reduced effects, reversal recovery, and incomplete retention fail closed", () => {
  for (const candidate of [
    snapshot({ providerEffects: false }),
    snapshot({ commercialEffects: false }),
    snapshot({ publicationEffects: false }),
    snapshot({ holdReason: "commercial_cutover_not_authorized" }),
    snapshot({ automaticRecoveryFromReversalEvidence: true }),
    snapshot({
      lifecycleState: "retained_exit",
      retentionWindowId: null,
      retentionEndsAt: null
    }),
    snapshot({ retentionWindowId: IDS.retentionWindowId })
  ]) {
    assert.throws(
      () => createAlakazamPolicySnapshot(candidate),
      { code: "repository_conflict" }
    );
  }
  assert.throws(
    () => exactAlakazamPolicyAuthority({
      ...ALAKAZAM_POLICY_AUTHORITY,
      state: "approved"
    }),
    { code: "invalid_configuration" }
  );
});
