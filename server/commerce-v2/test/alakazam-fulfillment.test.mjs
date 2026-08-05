import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_EFFECTIVE_POLICY_SCHEMA,
  ALAKAZAM_FULFILLMENT_AUTHORITY_SCHEMA,
  ALAKAZAM_FULFILLMENT_DECISION_SCHEMA,
  createAlakazamFulfillmentAuthority,
  createAlakazamFulfillmentDecision
} from "../alakazam-fulfillment.mjs";
import { deepFreeze, digest } from "../canonical.mjs";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "10000000-0000-4000-8000-000000000002";
const PROJECT_ID = "10000000-0000-4000-8000-000000000003";
const SUBSCRIPTION_ID = "10000000-0000-4000-8000-000000000004";
const OPERATION_ID = "10000000-0000-4000-8000-000000000005";
const VERSION_ID = "10000000-0000-4000-8000-000000000006";
const SCREENING_ID = "10000000-0000-4000-8000-000000000007";
const ADDRESS_ID = "10000000-0000-4000-8000-000000000008";
const NOW = "2026-08-04T17:00:00.000Z";
const PERIOD_START = "2026-08-01T12:00:00.000Z";
const PERIOD_END = "2026-09-01T12:00:00.000Z";
const SOURCE_ARTIFACT_DIGEST = digest("accepted source artifact");
const PUBLICATION_ARTIFACT_DIGEST = digest("policy publication artifact");

function subscription(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    subscriptionId: SUBSCRIPTION_ID,
    tierId: "alakazam_25",
    status: "active",
    revision: 2,
    currentPeriodStartsAt: PERIOD_START,
    currentPeriodEndsAt: PERIOD_END,
    cancelAtPeriodEnd: false,
    graceEndsAt: null,
    scheduledTierId: null,
    scheduledEffectiveAt: null,
    ...overrides
  };
}

function authority(overrides = {}) {
  return createAlakazamFulfillmentAuthority({
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    subscription: subscription(),
    expectedSubscriptionRevision: 2,
    now: NOW,
    ...overrides
  });
}

function version(overrides = {}) {
  return {
    versionId: VERSION_ID,
    state: "accepted_release",
    artifactDigest: SOURCE_ARTIFACT_DIGEST,
    compilerSchema: "abracadabra.spark/v1",
    compilerRevision: `sha256:${digest("compiler")}`,
    ...overrides
  };
}

function publicationArtifact(overrides = {}) {
  return {
    artifactDigest: PUBLICATION_ARTIFACT_DIGEST,
    compilerSchema: "abracadabra.spark/v1",
    compilerRevision: `sha256:${digest("policy compiler")}`,
    policyDigest: authority().policyDigest,
    screeningId: SCREENING_ID,
    screeningStage: "pre_publication",
    screeningPassed: true,
    screeningArtifactDigest: PUBLICATION_ARTIFACT_DIGEST,
    ...overrides
  };
}

function address(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    addressId: ADDRESS_ID,
    kind: "licensed",
    state: "configured",
    hostname: "moon-shop.sitesourcery.me",
    ...overrides
  };
}

test("deep evidence freezing preserves checksum-bound binary views", () => {
  const bytes = Buffer.from("exact publication bytes", "utf8");
  const checksum = digest("exact publication bytes");
  const proof = deepFreeze({ bytes, digest: checksum });
  assert.ok(Object.isFrozen(proof));
  assert.equal(proof.bytes, bytes);
  assert.equal(proof.digest, checksum);
});

test("an exact active subscription produces one canonical effective policy", () => {
  const selected = authority();
  assert.equal(
    selected.schema,
    ALAKAZAM_FULFILLMENT_AUTHORITY_SCHEMA
  );
  assert.equal(
    selected.policy.schema,
    ALAKAZAM_EFFECTIVE_POLICY_SCHEMA
  );
  assert.equal(selected.policy.tierId, "alakazam_25");
  assert.equal(selected.subscriptionRevision, 2);
  assert.equal(selected.policyDigest, digest(selected.policy));
  assert.deepEqual(selected.policy.limits, {
    careClass: "none",
    versionHistory: 0,
    fontControls: "base",
    borderControls: "base"
  });
  assert.ok(
    selected.policy.capabilities.includes(
      "publish_accepted_project_version"
    )
  );
  assert.ok(Object.isFrozen(selected));
});

test("effective authority follows a scheduled downgrade only at its boundary", () => {
  const before = authority({
    subscription: subscription({
      tierId: "alakazam_50",
      scheduledTierId: "alakazam_25",
      scheduledEffectiveAt: PERIOD_END
    })
  });
  assert.equal(before.policy.tierId, "alakazam_50");

  const atBoundary = authority({
    subscription: subscription({
      tierId: "alakazam_50",
      scheduledTierId: "alakazam_25",
      scheduledEffectiveAt: PERIOD_END
    }),
    now: PERIOD_END
  });
  assert.equal(atBoundary.policy.tierId, "alakazam_25");
});

test("authority fails closed on stale, cross-project, inactive, or claimed input", () => {
  assert.throws(
    () => authority({ expectedSubscriptionRevision: 1 }),
    (error) =>
      error.code ===
        "alakazam_fulfillment_revision_changed" &&
      error.status === 409
  );
  assert.throws(
    () => authority({
      subscription: subscription({
        projectId:
          "20000000-0000-4000-8000-000000000001"
      })
    }),
    (error) =>
      error.code === "alakazam_fulfillment_scope_changed"
  );
  assert.throws(
    () => authority({
      subscription: subscription({ status: "suspended" })
    }),
    (error) =>
      error.code === "alakazam_entitlement_unavailable"
  );
  assert.throws(
    () => authority({
      subscription: {
        ...subscription(),
        browserClaimedTier: "alakazam_50"
      }
    }),
    (error) => error.code === "invalid_input"
  );
});

test("a publication decision separately binds accepted source and policy-derived publication bytes", () => {
  const selected = createAlakazamFulfillmentDecision({
    operationId: OPERATION_ID,
    authority: authority(),
    capability: "publish_accepted_project_version",
    sourceVersion: version(),
    publicationArtifact: publicationArtifact(),
    address: address(),
    servingRevision: 0,
    now: NOW
  });
  assert.equal(
    selected.schema,
    ALAKAZAM_FULFILLMENT_DECISION_SCHEMA
  );
  assert.equal(
    selected.sourceVersion.artifactDigest,
    SOURCE_ARTIFACT_DIGEST
  );
  assert.equal(
    selected.publicationArtifact.artifactDigest,
    PUBLICATION_ARTIFACT_DIGEST
  );
  assert.equal(
    selected.address.hostname,
    "moon-shop.sitesourcery.me"
  );
  const { decisionDigest, ...decision } = selected;
  assert.equal(
    decisionDigest,
    digest(decision)
  );
});

test("publication decisions reject unproved bytes, custom addresses, unavailable capabilities, and changed policy", () => {
  assert.throws(
    () => createAlakazamFulfillmentDecision({
      operationId: OPERATION_ID,
      authority: authority(),
      capability: "publish_accepted_project_version",
      sourceVersion: version(),
      publicationArtifact: publicationArtifact({
        screeningArtifactDigest: digest("other")
      }),
      address: address(),
      servingRevision: 0,
      now: NOW
    }),
    (error) =>
      error.code === "alakazam_fulfillment_version_unavailable"
  );
  assert.throws(
    () => createAlakazamFulfillmentDecision({
      operationId: OPERATION_ID,
      authority: authority(),
      capability: "publish_accepted_project_version",
      sourceVersion: version(),
      publicationArtifact: publicationArtifact(),
      address: address({ kind: "customer_byod" }),
      servingRevision: 0,
      now: NOW
    }),
    (error) =>
      error.code === "alakazam_fulfillment_address_unavailable"
  );
  assert.throws(
    () => createAlakazamFulfillmentDecision({
      operationId: OPERATION_ID,
      authority: authority(),
      capability: "cash_app_link",
      sourceVersion: version(),
      publicationArtifact: publicationArtifact(),
      address: address(),
      servingRevision: 0,
      now: NOW
    }),
    (error) =>
      error.code === "alakazam_capability_unavailable"
  );
  const changed = structuredClone(authority());
  changed.policy.tierId = "alakazam_50";
  assert.throws(
    () => createAlakazamFulfillmentDecision({
      operationId: OPERATION_ID,
      authority: changed,
      capability: "publish_accepted_project_version",
      sourceVersion: version(),
      publicationArtifact: publicationArtifact(),
      address: address(),
      servingRevision: 0,
      now: NOW
    }),
    (error) =>
      error.code === "alakazam_fulfillment_authority_invalid"
  );
});
