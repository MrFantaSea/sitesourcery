import {
  deepFreeze,
  invariant,
  requiredText
} from "./canonical.mjs";

export const ALAKAZAM_LIFECYCLE_POLICY_SCHEMA =
  "sitesourcery.alakazam-lifecycle-policy/v1";

/**
 * The exact rulings the owner still has to make before any Alakazam
 * lifecycle consequence may reach a customer. Nothing in this module
 * supplies a default for these; an unapproved policy records evidence
 * and changes nothing.
 *
 * The legacy hosted system's 14-day grace and 90-day retention are
 * NOT inherited here. `server/hosted/constants.mjs` RETENTION_DAYS and
 * the older billing migration belong to a different product.
 */
export const ALAKAZAM_LIFECYCLE_OPEN_DECISIONS = deepFreeze([
  {
    decision: "failed_payment_access",
    question:
      "Does service change the moment a renewal payment fails, and what does the customer see?"
  },
  {
    decision: "grace_duration",
    question:
      "Is there a grace period at all, and if so exactly how long does it run from the first failure?"
  },
  {
    decision: "suspension_trigger",
    question:
      "What exactly suspends a site, what stops, what stays visible, and what happens to an attached domain?"
  },
  {
    decision: "restoration_evidence",
    question:
      "What proof restores service, and is restoration automatic or owner-reviewed?"
  },
  {
    decision: "cancellation_timing",
    question:
      "Does cancellation take effect at the period end, can it be undone, and until when?"
  },
  {
    decision: "retention_and_export",
    question:
      "How long is work retained after service ends, and how long can it be exported?"
  },
  {
    decision: "reversal_consequence",
    question:
      "What happens to access on a partial refund, a full refund, and an open, lost, or won dispute?"
  }
]);

const CONSEQUENCES = new Set([
  "record_only",
  "owner_review",
  "restrict_publication",
  "suspend_service"
]);

const HOUR_MS = 60 * 60 * 1000;
const MAX_HOURS = 24 * 400;

function exactHours(value, field) {
  invariant(
    Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= MAX_HOURS,
    "invalid_configuration",
    `${field} must be an exact whole number of hours the owner approved`,
    { status: 500 }
  );
  return value;
}

function exactConsequence(value, field) {
  const selected = requiredText(value, field, 60);
  invariant(
    CONSEQUENCES.has(selected),
    "invalid_configuration",
    `${field} is not a reviewed Alakazam consequence`,
    { status: 500 }
  );
  return selected;
}

/**
 * Build the Alakazam lifecycle policy.
 *
 * The default is held: no grace, no suspension, no retention window,
 * and no reversal consequence. A held policy is not "zero days" — it
 * is "the owner has not ruled", and every consumer must treat it as a
 * refusal to act rather than an instruction to act immediately.
 */
export function createAlakazamLifecyclePolicy({
  approved = false,
  policyVersion = null,
  graceHours = null,
  suspendAfterGraceHours = null,
  retentionHours = null,
  exportWindowHours = null,
  graceConsequence = null,
  suspensionConsequence = null,
  refundConsequence = null,
  disputeConsequence = null
} = {}) {
  if (approved !== true) {
    invariant(
      approved === false &&
        policyVersion === null &&
        graceHours === null &&
        suspendAfterGraceHours === null &&
        retentionHours === null &&
        exportWindowHours === null &&
        graceConsequence === null &&
        suspensionConsequence === null &&
        refundConsequence === null &&
        disputeConsequence === null,
      "invalid_configuration",
      "an unapproved Alakazam lifecycle policy cannot carry durations or consequences",
      { status: 500 }
    );
    return deepFreeze({
      schema: ALAKAZAM_LIFECYCLE_POLICY_SCHEMA,
      approved: false,
      policyVersion: null,
      graceHours: null,
      suspendAfterGraceHours: null,
      retentionHours: null,
      exportWindowHours: null,
      graceConsequence: null,
      suspensionConsequence: null,
      refundConsequence: null,
      disputeConsequence: null,
      openDecisions: ALAKAZAM_LIFECYCLE_OPEN_DECISIONS.map(
        (entry) => entry.decision
      )
    });
  }
  const version = requiredText(
    policyVersion,
    "policyVersion",
    120
  );
  invariant(
    /^alakazam-lifecycle\.\d{4}-\d{2}-\d{2}\.v\d+$/u.test(
      version
    ),
    "invalid_configuration",
    "an approved Alakazam lifecycle policy needs a dated owner version",
    { status: 500 }
  );
  return deepFreeze({
    schema: ALAKAZAM_LIFECYCLE_POLICY_SCHEMA,
    approved: true,
    policyVersion: version,
    graceHours: exactHours(graceHours, "graceHours"),
    suspendAfterGraceHours: exactHours(
      suspendAfterGraceHours,
      "suspendAfterGraceHours"
    ),
    retentionHours: exactHours(
      retentionHours,
      "retentionHours"
    ),
    exportWindowHours: exactHours(
      exportWindowHours,
      "exportWindowHours"
    ),
    graceConsequence: exactConsequence(
      graceConsequence,
      "graceConsequence"
    ),
    suspensionConsequence: exactConsequence(
      suspensionConsequence,
      "suspensionConsequence"
    ),
    refundConsequence: exactConsequence(
      refundConsequence,
      "refundConsequence"
    ),
    disputeConsequence: exactConsequence(
      disputeConsequence,
      "disputeConsequence"
    ),
    openDecisions: []
  });
}

export function exactAlakazamLifecyclePolicy(value) {
  const expected = createAlakazamLifecyclePolicy(
    value?.approved === true
      ? {
          approved: true,
          policyVersion: value.policyVersion,
          graceHours: value.graceHours,
          suspendAfterGraceHours:
            value.suspendAfterGraceHours,
          retentionHours: value.retentionHours,
          exportWindowHours: value.exportWindowHours,
          graceConsequence: value.graceConsequence,
          suspensionConsequence: value.suspensionConsequence,
          refundConsequence: value.refundConsequence,
          disputeConsequence: value.disputeConsequence
        }
      : {}
  );
  invariant(
    value &&
      JSON.stringify(value) === JSON.stringify(expected),
    "invalid_configuration",
    "the Alakazam lifecycle policy does not match a reviewed owner ruling",
    { status: 500 }
  );
  return expected;
}

/**
 * Add an owner-approved number of hours to an exact instant. Returns
 * null whenever the policy has not been ruled, so a caller can never
 * turn "undecided" into a deadline.
 */
export function alakazamPolicyDeadline(from, hours) {
  if (hours === null || hours === undefined) return null;
  invariant(
    Number.isSafeInteger(hours) && hours >= 0,
    "invalid_configuration",
    "an Alakazam policy deadline needs approved whole hours",
    { status: 500 }
  );
  const base = Date.parse(from);
  invariant(
    Number.isFinite(base),
    "invalid_input",
    "an Alakazam policy deadline needs an exact instant"
  );
  return new Date(base + hours * HOUR_MS).toISOString();
}
