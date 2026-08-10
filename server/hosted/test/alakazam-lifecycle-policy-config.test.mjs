import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_LIFECYCLE_POLICY_VARIABLES,
  createConfiguredAlakazamLifecyclePolicy
} from "../alakazam-lifecycle-policy-config.mjs";

const COMPLETE = Object.freeze({
  SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE: "approved",
  SITESOURCERY_ALAKAZAM_LIFECYCLE_VERSION:
    "alakazam-lifecycle.2026-08-10.v1",
  SITESOURCERY_ALAKAZAM_LIFECYCLE_GRACE_HOURS: "168",
  SITESOURCERY_ALAKAZAM_LIFECYCLE_SUSPEND_AFTER_GRACE_HOURS: "0",
  SITESOURCERY_ALAKAZAM_LIFECYCLE_RETENTION_HOURS: "720",
  SITESOURCERY_ALAKAZAM_LIFECYCLE_EXPORT_WINDOW_HOURS: "720",
  SITESOURCERY_ALAKAZAM_LIFECYCLE_GRACE_CONSEQUENCE:
    "restrict_publication",
  SITESOURCERY_ALAKAZAM_LIFECYCLE_SUSPENSION_CONSEQUENCE:
    "suspend_service",
  SITESOURCERY_ALAKAZAM_LIFECYCLE_REFUND_CONSEQUENCE:
    "owner_review",
  SITESOURCERY_ALAKAZAM_LIFECYCLE_DISPUTE_CONSEQUENCE:
    "owner_review"
});

test(
  "the Alakazam lifecycle policy is held by default",
  () => {
    const composition =
      createConfiguredAlakazamLifecyclePolicy({
        environment: {}
      });
    assert.equal(composition.mode, "held");
    assert.equal(composition.policy.approved, false);
    assert.equal(composition.policy.graceHours, null);
    assert.equal(composition.policy.retentionHours, null);
    assert.ok(composition.openDecisions.length >= 7);
  }
);

test(
  "a held policy refuses any duration left in configuration",
  () => {
    for (const name of Object.values(
      ALAKAZAM_LIFECYCLE_POLICY_VARIABLES
    )) {
      assert.throws(
        () =>
          createConfiguredAlakazamLifecyclePolicy({
            environment: { [name]: "72" }
          }),
        {
          code: "ALAKAZAM_LIFECYCLE_RULING_WITHOUT_APPROVAL"
        },
        `${name} must not be honoured while held`
      );
    }
  }
);

test(
  "an approved policy needs every owner ruling and an exact version",
  () => {
    for (const name of Object.values(
      ALAKAZAM_LIFECYCLE_POLICY_VARIABLES
    )) {
      const partial = { ...COMPLETE };
      delete partial[name];
      assert.throws(
        () =>
          createConfiguredAlakazamLifecyclePolicy({
            environment: partial
          }),
        { code: "ALAKAZAM_LIFECYCLE_RULING_INCOMPLETE" },
        `${name} must be required`
      );
    }
    assert.throws(
      () =>
        createConfiguredAlakazamLifecyclePolicy({
          environment: {
            ...COMPLETE,
            SITESOURCERY_ALAKAZAM_LIFECYCLE_GRACE_HOURS: "3 days"
          }
        }),
      { code: "ALAKAZAM_LIFECYCLE_HOURS_INVALID" }
    );
    assert.throws(
      () =>
        createConfiguredAlakazamLifecyclePolicy({
          environment: {
            ...COMPLETE,
            SITESOURCERY_ALAKAZAM_LIFECYCLE_GRACE_HOURS: "72"
          }
        }),
      { code: "ALAKAZAM_LIFECYCLE_POLICY_NOT_CANONICAL" }
    );
    assert.throws(
      () =>
        createConfiguredAlakazamLifecyclePolicy({
          environment: {
            SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE: "maybe"
          }
        }),
      { code: "ALAKAZAM_LIFECYCLE_MODE_INVALID" }
    );
  }
);

test(
  "a complete owner ruling composes one exact versioned policy",
  () => {
    const composition =
      createConfiguredAlakazamLifecyclePolicy({
        environment: COMPLETE
      });
    assert.equal(composition.mode, "approved");
    assert.deepEqual(composition.policy, {
      schema: "sitesourcery.alakazam-lifecycle-policy/v1",
      approved: true,
      policyVersion: "alakazam-lifecycle.2026-08-10.v1",
      graceHours: 168,
      suspendAfterGraceHours: 0,
      retentionHours: 720,
      exportWindowHours: 720,
      graceConsequence: "restrict_publication",
      suspensionConsequence: "suspend_service",
      refundConsequence: "owner_review",
      disputeConsequence: "owner_review",
      openDecisions: []
    });
  }
);
