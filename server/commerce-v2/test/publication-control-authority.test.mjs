import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeAlakazamCapability
} from "../alakazam.mjs";
import {
  PUBLICATION_CONTROL_HOLD_REASON,
  createHeldPublicationControlCommand
} from "../publication-control-authority.mjs";

const IDS = Object.freeze({
  tenant: "10000000-0000-4000-8000-000000000001",
  customer: "10000000-0000-4000-8000-000000000002",
  project: "10000000-0000-4000-8000-000000000003",
  subscription: "10000000-0000-4000-8000-000000000004",
  acceptance: "10000000-0000-4000-8000-000000000005",
  version: "10000000-0000-4000-8000-000000000006",
  artifact: "10000000-0000-4000-8000-000000000007",
  screening: "10000000-0000-4000-8000-000000000008",
  address: "10000000-0000-4000-8000-000000000009",
  intent: "10000000-0000-4000-8000-000000000010",
  currentOperation: "10000000-0000-4000-8000-000000000011",
  targetOperation: "10000000-0000-4000-8000-000000000012",
  currentRelease: "10000000-0000-4000-8000-000000000013",
  targetRelease: "10000000-0000-4000-8000-000000000014",
  command: "10000000-0000-4000-8000-000000000015"
});
const NOW = "2026-08-09T16:00:00.000Z";
const SOURCE_DIGEST = "a".repeat(64);
const SCREENING_DIGEST = "b".repeat(64);
const DECISION_DIGEST = "c".repeat(64);
const POLICY_DIGEST = "d".repeat(64);

function subscription(overrides = {}) {
  return {
    tenantId: IDS.tenant,
    customerId: IDS.customer,
    projectId: IDS.project,
    subscriptionId: IDS.subscription,
    tierId: "alakazam_35",
    status: "active",
    revision: 7,
    currentPeriodStartsAt: "2026-08-01T00:00:00.000Z",
    currentPeriodEndsAt: "2026-09-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    graceEndsAt: null,
    scheduledTierId: null,
    scheduledEffectiveAt: null,
    ...overrides
  };
}

function operation({
  id = IDS.currentOperation,
  releaseId = IDS.currentRelease,
  subscriptionRevision = 7
} = {}) {
  return {
    id,
    intentId: IDS.intent,
    subscriptionId: IDS.subscription,
    subscriptionRevision,
    operationKind: "start_activation",
    capability: "publish_accepted_project_version",
    effectiveTierId: "alakazam_35",
    policyDigest: POLICY_DIGEST,
    state: "published",
    servingRevision: 3,
    resultReleaseId: releaseId,
    decisionDigest: DECISION_DIGEST
  };
}

function authority({
  projectionState = "live",
  currentReleaseId = IDS.currentRelease,
  currentVersionId = IDS.version,
  targetOperation = operation()
} = {}) {
  const selectedSubscription = subscription();
  const grant = authorizeAlakazamCapability(
    selectedSubscription,
    {
      capability: "publish_accepted_project_version",
      now: NOW
    }
  );
  return {
    authorityKind: "alakazam",
    entitlement: {
      kind: "alakazam_subscription",
      subscriptionId: IDS.subscription,
      revision: 7,
      tierId: "alakazam_35",
      status: "active",
      currentPeriodEndsAt: "2026-09-01T00:00:00.000Z",
      graceEndsAt: null
    },
    capabilityGrant: {
      schema: grant.schema,
      subscriptionId: grant.subscriptionId,
      projectId: grant.projectId,
      tierId: grant.tierId,
      capability: grant.capability,
      authorizedAt: grant.authorizedAt
    },
    acceptance: {
      eventId: IDS.acceptance,
      versionId: IDS.version,
      artifactId: IDS.artifact,
      artifactDigest: SOURCE_DIGEST,
      state: "accepted_release",
      acceptedAt: "2026-08-09T14:00:00.000Z"
    },
    screening: {
      id: IDS.screening,
      versionId: IDS.version,
      stage: "pre_publication",
      method: "alakazam_effective_policy",
      passed: true,
      artifactDigest: SCREENING_DIGEST,
      checkerRevision: "alakazam-policy-test-v1",
      checkedAt: "2026-08-09T14:05:00.000Z"
    },
    address: {
      id: IDS.address,
      kind: "licensed",
      ownership: "licensed",
      state: "configured",
      hostname: "cedar.sitesourcery.me"
    },
    authorityOperation: operation(),
    targetOperation,
    projection: {
      state: projectionState,
      currentReleaseId,
      currentVersionId
    }
  };
}

function command(overrides = {}) {
  return createHeldPublicationControlCommand({
    scope: {
      tenantId: IDS.tenant,
      customerId: IDS.customer,
      actorId: IDS.customer,
      projectId: IDS.project
    },
    commandId: IDS.command,
    action: "unpublish",
    snapshotDigest: "e".repeat(64),
    targetReleaseId: null,
    authority: authority(),
    requestedAt: NOW,
    ...overrides
  });
}

test("generic unpublish authority persists every exact proof while remaining held", () => {
  const result = command();
  assert.equal(result.state, "held");
  assert.equal(result.holdReason, PUBLICATION_CONTROL_HOLD_REASON);
  assert.equal(result.authority.acceptance.eventId, IDS.acceptance);
  assert.equal(result.authority.screening.id, IDS.screening);
  assert.equal(
    result.authority.capabilityGrant.capability,
    "publish_accepted_project_version"
  );
  assert.equal(result.authority.entitlement.revision, 7);
  assert.equal(result.authority.address.hostname, "cedar.sitesourcery.me");
  assert.equal(
    result.authority.authorityOperation.servingRevision,
    3
  );
  assert.match(result.authorityDigest, /^[a-f0-9]{64}$/u);
  assert.match(result.commandDigest, /^[a-f0-9]{64}$/u);
});

test("publish and rollback require their exact fulfilled target release", () => {
  const republish = command({
    action: "publish",
    targetReleaseId: null,
    authority: authority({
      projectionState: "dark",
      currentReleaseId: null,
      currentVersionId: null
    })
  });
  assert.equal(republish.targetReleaseId, null);
  assert.equal(
    republish.authority.targetOperation.resultReleaseId,
    IDS.currentRelease
  );

  const rollbackOperation = operation({
    id: IDS.targetOperation,
    releaseId: IDS.targetRelease,
    subscriptionRevision: 5
  });
  const rollback = command({
    action: "rollback",
    targetReleaseId: IDS.targetRelease,
    authority: authority({ targetOperation: rollbackOperation })
  });
  assert.equal(
    rollback.authority.targetOperation.subscriptionRevision,
    5
  );
  assert.equal(rollback.targetReleaseId, IDS.targetRelease);

  assert.throws(
    () => command({
      action: "rollback",
      targetReleaseId: IDS.currentRelease,
      authority: authority({ targetOperation: rollbackOperation })
    }),
    (error) => error.code === "publication_action_unavailable"
  );
});

test("authority rejects inferred entitlement, capability, screening, address, and revision drift", () => {
  const mutations = [
    (value) => { value.entitlement.tierId = "alakazam_50"; },
    (value) => { value.capabilityGrant.capability = "version_history"; },
    (value) => { value.screening.passed = false; },
    (value) => { value.address.kind = "customer_byod"; },
    (value) => { value.authorityOperation.subscriptionRevision = 8; },
    (value) => { value.acceptance.state = "ready"; }
  ];
  for (const mutate of mutations) {
    const selected = structuredClone(authority());
    mutate(selected);
    assert.throws(
      () => command({ authority: selected }),
      (error) => error.status === 409
    );
  }
});

test("expired grace never becomes publication entitlement", () => {
  const selected = authority();
  selected.entitlement.status = "grace";
  selected.entitlement.graceEndsAt = "2026-08-09T15:59:59.000Z";
  assert.throws(
    () => command({ authority: selected }),
    (error) => error.code === "publication_entitlement_unavailable"
  );
});
