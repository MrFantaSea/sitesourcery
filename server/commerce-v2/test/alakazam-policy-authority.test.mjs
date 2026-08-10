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
    commercialEffects: false,
    providerEffects: false,
    publicationEffects: false,
    automaticRecoveryFromReversalEvidence: false,
    holdReason: ALAKAZAM_POLICY_HOLD_REASON,
    observedAt: "2026-08-10T12:00:00.000Z",
    ...overrides
  };
}

test("one canonical Alakazam authority preserves exact customer rights while held", () => {
  assert.equal(
    ALAKAZAM_POLICY_AUTHORITY.policyId,
    "SS-ALAKAZAM-POLICY-2026-08-10-V1"
  );
  assert.equal(ALAKAZAM_POLICY_AUTHORITY.state, "held");
  assert.deepEqual(ALAKAZAM_POLICY_AUTHORITY.effects, {
    commercial: false,
    provider: false,
    publication: false,
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
    collectionState: "held"
  });
  assert.equal(
    ALAKAZAM_POLICY_AUTHORITY_DIGEST,
    "8b7562daef4b3d91fff1bea04da5cdd982755b901e58f0e60a780fde17ce9bb1"
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
  assert.equal(grace.providerEffects, false);
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

test("expanded effects, reversal recovery, and incomplete retention fail closed", () => {
  for (const candidate of [
    snapshot({ providerEffects: true }),
    snapshot({ commercialEffects: true }),
    snapshot({ publicationEffects: true }),
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
