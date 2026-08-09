import {
  clone,
  deepFreeze,
  digest,
  invariant
} from "./canonical.mjs";

export const ALAKAZAM_CARE_LIFECYCLE_POLICY_ID =
  "SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1";
export const ALAKAZAM_CARE_LIFECYCLE_POLICY_SCHEMA =
  "sitesourcery.alakazam-care-lifecycle-policy/v1";
const EXPECTED_ALAKAZAM_CARE_LIFECYCLE_POLICY_DIGEST =
  "d44a49dde586042c6a3b8f84d12df8079d30c87d9824a6c2ddbeb9ffad5f31c4";

export const ALAKAZAM_CARE_LIFECYCLE_POLICY = deepFreeze({
  schema: ALAKAZAM_CARE_LIFECYCLE_POLICY_SCHEMA,
  policyId: ALAKAZAM_CARE_LIFECYCLE_POLICY_ID,
  commercialState: "held",
  providerEffects: false,
  lifecycle: {
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
  },
  care: {
    businessCalendar: {
      timeZone: "America/New_York",
      businessWeekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      excludedHolidays: "us_federal_observed",
      nextBusinessDayAfterLocalHour: 17
    },
    modest: {
      tasksPerProviderBillingPeriod: 1,
      maximumSecondsPerTask: 900,
      maximumSecondsPerPeriod: 900,
      acknowledgeWithinBusinessDays: 3
    },
    more: {
      tasksPerProviderBillingPeriod: 2,
      maximumSecondsPerTask: 900,
      maximumSecondsPerPeriod: 1800,
      acknowledgeWithinBusinessDays: 2
    },
    nonConsumingClasses: [
      "billing",
      "access",
      "security",
      "service_defect"
    ],
    promisesNotMade: [
      "rollover",
      "completion_sla",
      "continuous_availability",
      "emergency_service",
      "unlimited_work"
    ]
  }
});

export const ALAKAZAM_CARE_LIFECYCLE_POLICY_DIGEST =
  digest(ALAKAZAM_CARE_LIFECYCLE_POLICY);

invariant(
  ALAKAZAM_CARE_LIFECYCLE_POLICY_DIGEST ===
    EXPECTED_ALAKAZAM_CARE_LIFECYCLE_POLICY_DIGEST,
  "invalid_configuration",
  "the accepted Alakazam care and lifecycle policy digest changed",
  { status: 500 }
);

export function exactAlakazamCareLifecyclePolicy(value) {
  invariant(
    value &&
      JSON.stringify(value) ===
        JSON.stringify(ALAKAZAM_CARE_LIFECYCLE_POLICY),
    "invalid_configuration",
    "the Alakazam care and lifecycle policy is not canonical",
    { status: 500 }
  );
  return deepFreeze(clone(ALAKAZAM_CARE_LIFECYCLE_POLICY));
}
