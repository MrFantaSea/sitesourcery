import {
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

export const ALAKAZAM_POLICY_AUTHORITY_ID =
  "SS-ALAKAZAM-POLICY-2026-08-10-V1";
export const ALAKAZAM_POLICY_AUTHORITY_SCHEMA =
  "sitesourcery.alakazam-policy-authority/v1";
export const ALAKAZAM_POLICY_SNAPSHOT_SCHEMA =
  "sitesourcery.alakazam-policy-snapshot/v1";
export const ALAKAZAM_POLICY_HOLD_REASON =
  "commercial_and_publication_cutover_not_authorized";

export const ALAKAZAM_CANONICAL_CARE_LIFECYCLE = deepFreeze({
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

export const ALAKAZAM_CANONICAL_CARE = deepFreeze({
  businessCalendar: {
    timeZone: "America/New_York",
    businessWeekdays: [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday"
    ],
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
});

export const ALAKAZAM_POLICY_AUTHORITY = deepFreeze({
  schema: ALAKAZAM_POLICY_AUTHORITY_SCHEMA,
  policyId: ALAKAZAM_POLICY_AUTHORITY_ID,
  state: "held",
  holdReason: ALAKAZAM_POLICY_HOLD_REASON,
  effects: {
    commercial: false,
    provider: false,
    publication: false,
    automaticRecoveryFromReversalEvidence: false
  },
  subscription: {
    tiers: ["alakazam_25", "alakazam_35", "alakazam_50"],
    billingModel: "stripe_subscription",
    renewalEvidence: "exact_invoice_readback",
    cancellationEffectiveAt: "paid_through_boundary"
  },
  customerRights: {
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
  },
  tax: {
    authority: "purpose_bound_separate_activation",
    stripeTaxCode: "txcd_10701100",
    taxBehavior: "exclusive",
    collectionState: "held"
  },
  prerequisites: {
    fulfillment: "exact_paid_subscription_revision",
    publication: [
      "exact_fulfillment_operation",
      "accepted_release",
      "licensed_address",
      "separate_publication_cutover"
    ],
    reversal: "observation_and_owner_review_only"
  },
  lifecycle: ALAKAZAM_CANONICAL_CARE_LIFECYCLE,
  care: ALAKAZAM_CANONICAL_CARE
});

export const ALAKAZAM_POLICY_AUTHORITY_DIGEST =
  digest(ALAKAZAM_POLICY_AUTHORITY);
const EXPECTED_ALAKAZAM_POLICY_AUTHORITY_DIGEST =
  "8b7562daef4b3d91fff1bea04da5cdd982755b901e58f0e60a780fde17ce9bb1";

invariant(
  ALAKAZAM_POLICY_AUTHORITY_DIGEST ===
    EXPECTED_ALAKAZAM_POLICY_AUTHORITY_DIGEST,
  "invalid_configuration",
  "the canonical Alakazam policy authority digest changed",
  { status: 500 }
);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LIFECYCLE_STATES = new Set([
  "pending",
  "active",
  "scheduled_to_cancel_active",
  "payment_grace",
  "retained_exit",
  "terminal"
]);

function exactKeys(value, expected, field) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return value;
}

function uuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function optionalUuid(value, field) {
  return value === null ? null : uuid(value, field);
}

function optionalIso(value, field) {
  return value === null ? null : requiredIso(value, field);
}

export function exactAlakazamPolicyAuthority(value) {
  invariant(
    value &&
      digest(value) === ALAKAZAM_POLICY_AUTHORITY_DIGEST,
    "invalid_configuration",
    "the Alakazam policy authority is not canonical",
    { status: 500 }
  );
  return deepFreeze(clone(ALAKAZAM_POLICY_AUTHORITY));
}

export function createAlakazamPolicySnapshot(value) {
  exactKeys(
    value,
    [
      "authorityDigest",
      "automaticRecoveryFromReversalEvidence",
      "cancellationId",
      "commercialEffects",
      "customerId",
      "holdReason",
      "lifecycleState",
      "observedAt",
      "policyId",
      "projectId",
      "providerEffects",
      "publicationEffects",
      "retentionEndsAt",
      "retentionWindowId",
      "reversalEventId",
      "sourceSubscriptionRevision",
      "sourceSubscriptionStatus",
      "subscriptionId",
      "tenantId",
      "transitionEventId"
    ],
    "snapshot"
  );
  const lifecycleState = requiredText(
    value.lifecycleState,
    "snapshot.lifecycleState",
    40
  );
  invariant(
    LIFECYCLE_STATES.has(lifecycleState) &&
      Number.isSafeInteger(value.sourceSubscriptionRevision) &&
      value.sourceSubscriptionRevision > 0 &&
      value.policyId === ALAKAZAM_POLICY_AUTHORITY_ID &&
      value.holdReason === ALAKAZAM_POLICY_HOLD_REASON &&
      value.authorityDigest === ALAKAZAM_POLICY_AUTHORITY_DIGEST &&
      value.commercialEffects === false &&
      value.providerEffects === false &&
      value.publicationEffects === false &&
      value.automaticRecoveryFromReversalEvidence === false,
    "repository_conflict",
    "the Alakazam policy snapshot expanded held authority",
    { status: 500 }
  );
  const retentionWindowId = optionalUuid(
    value.retentionWindowId,
    "snapshot.retentionWindowId"
  );
  const retentionEndsAt = optionalIso(
    value.retentionEndsAt,
    "snapshot.retentionEndsAt"
  );
  invariant(
    lifecycleState === "retained_exit"
      ? retentionWindowId !== null && retentionEndsAt !== null
      : retentionWindowId === null && retentionEndsAt === null,
    "repository_conflict",
    "the Alakazam retained-exit evidence is inconsistent",
    { status: 500 }
  );
  return deepFreeze({
    schema: ALAKAZAM_POLICY_SNAPSHOT_SCHEMA,
    policyId: value.policyId,
    authorityDigest: requiredDigest(
      value.authorityDigest,
      "snapshot.authorityDigest"
    ),
    tenantId: uuid(value.tenantId, "snapshot.tenantId"),
    projectId: uuid(value.projectId, "snapshot.projectId"),
    customerId: uuid(value.customerId, "snapshot.customerId"),
    subscriptionId: uuid(
      value.subscriptionId,
      "snapshot.subscriptionId"
    ),
    sourceSubscriptionRevision: value.sourceSubscriptionRevision,
    sourceSubscriptionStatus: requiredText(
      value.sourceSubscriptionStatus,
      "snapshot.sourceSubscriptionStatus",
      40
    ),
    lifecycleState,
    transitionEventId: optionalUuid(
      value.transitionEventId,
      "snapshot.transitionEventId"
    ),
    cancellationId: optionalUuid(
      value.cancellationId,
      "snapshot.cancellationId"
    ),
    retentionWindowId,
    retentionEndsAt,
    reversalEventId: optionalUuid(
      value.reversalEventId,
      "snapshot.reversalEventId"
    ),
    commercialEffects: false,
    providerEffects: false,
    publicationEffects: false,
    automaticRecoveryFromReversalEvidence: false,
    holdReason: value.holdReason,
    observedAt: requiredIso(value.observedAt, "snapshot.observedAt")
  });
}
