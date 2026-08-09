import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_CARE_LIFECYCLE_POLICY,
  ALAKAZAM_CARE_LIFECYCLE_POLICY_DIGEST,
  ALAKAZAM_CARE_LIFECYCLE_POLICY_ID,
  exactAlakazamCareLifecyclePolicy
} from "../alakazam-care-lifecycle-policy.mjs";

test("the accepted care and lifecycle policy is exact and held", () => {
  assert.equal(
    ALAKAZAM_CARE_LIFECYCLE_POLICY.policyId,
    "SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1"
  );
  assert.equal(ALAKAZAM_CARE_LIFECYCLE_POLICY_ID, ALAKAZAM_CARE_LIFECYCLE_POLICY.policyId);
  assert.equal(ALAKAZAM_CARE_LIFECYCLE_POLICY.commercialState, "held");
  assert.equal(ALAKAZAM_CARE_LIFECYCLE_POLICY.providerEffects, false);
  assert.equal(
    ALAKAZAM_CARE_LIFECYCLE_POLICY_DIGEST,
    "d44a49dde586042c6a3b8f84d12df8079d30c87d9824a6c2ddbeb9ffad5f31c4"
  );
  assert.deepEqual(ALAKAZAM_CARE_LIFECYCLE_POLICY.lifecycle, {
    paymentGraceDays: 7,
    retainedExitDays: 30,
    paymentGraceExpiryTransition: "retained_exit",
    retainPremiumConfigurationDuring: [
      "active",
      "scheduled_to_cancel_active",
      "payment_grace",
      "retained_exit"
    ],
    activeAccess: {
      privateRead: true,
      customerExport: true,
      edit: true,
      publish: true,
      care: true
    },
    paymentGraceAccess: {
      privateRead: true,
      customerExport: true,
      edit: false,
      publish: false,
      care: false
    },
    retainedExitAccess: {
      privateRead: true,
      customerExport: true,
      edit: false,
      publish: false,
      care: false
    },
    lowerTierEffectiveOutput: "masked",
    restoreRequires: [
      "exact_provider_readback",
      "canonical_tier_change_evidence",
      "current_membership",
      "exact_subscription_revision"
    ],
    purgeAt: [
      "terminal_customer_deletion",
      "retained_exit_expiry"
    ],
    restoreAfterTerminalDeletion: false,
    exportProjection: [
      "borderChoiceId",
      "cashAppHandle",
      "configurationDigest",
      "configurationRevision",
      "configuredAt",
      "fontChoiceId",
      "menu",
      "venmoHandle"
    ]
  });
});

test("care promises are bounded by class and business calendar", () => {
  assert.deepEqual(ALAKAZAM_CARE_LIFECYCLE_POLICY.care.modest, {
    tasksPerProviderBillingPeriod: 1,
    maximumSecondsPerTask: 900,
    maximumSecondsPerPeriod: 900,
    acknowledgeWithinBusinessDays: 3
  });
  assert.deepEqual(ALAKAZAM_CARE_LIFECYCLE_POLICY.care.more, {
    tasksPerProviderBillingPeriod: 2,
    maximumSecondsPerTask: 900,
    maximumSecondsPerPeriod: 1800,
    acknowledgeWithinBusinessDays: 2
  });
  assert.deepEqual(ALAKAZAM_CARE_LIFECYCLE_POLICY.care.businessCalendar, {
    timeZone: "America/New_York",
    businessWeekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    excludedHolidays: "us_federal_observed",
    nextBusinessDayAfterLocalHour: 17
  });
  assert.deepEqual(ALAKAZAM_CARE_LIFECYCLE_POLICY.care.nonConsumingClasses, [
    "billing",
    "access",
    "security",
    "service_defect"
  ]);
  assert.deepEqual(ALAKAZAM_CARE_LIFECYCLE_POLICY.care.promisesNotMade, [
    "rollover",
    "completion_sla",
    "continuous_availability",
    "emergency_service",
    "unlimited_work"
  ]);
});

test("non-canonical policy input fails closed", () => {
  assert.deepEqual(
    exactAlakazamCareLifecyclePolicy(ALAKAZAM_CARE_LIFECYCLE_POLICY),
    ALAKAZAM_CARE_LIFECYCLE_POLICY
  );
  assert.throws(
    () => exactAlakazamCareLifecyclePolicy({
      ...ALAKAZAM_CARE_LIFECYCLE_POLICY,
      providerEffects: true
    }),
    { code: "invalid_configuration" }
  );
});
