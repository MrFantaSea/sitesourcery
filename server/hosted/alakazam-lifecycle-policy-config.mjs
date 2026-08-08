import {
  ALAKAZAM_LIFECYCLE_OPEN_DECISIONS,
  createAlakazamLifecyclePolicy
} from "../commerce-v2/alakazam-lifecycle-policy.mjs";

const MODES = new Set(["held", "approved"]);

/**
 * Every duration and consequence the owner must set before an approved
 * Alakazam lifecycle policy can exist. There is no default for any of
 * them: the held mode carries none, and the approved mode requires all.
 */
export const ALAKAZAM_LIFECYCLE_POLICY_VARIABLES = Object.freeze({
  policyVersion: "SITESOURCERY_ALAKAZAM_LIFECYCLE_VERSION",
  graceHours: "SITESOURCERY_ALAKAZAM_LIFECYCLE_GRACE_HOURS",
  suspendAfterGraceHours:
    "SITESOURCERY_ALAKAZAM_LIFECYCLE_SUSPEND_AFTER_GRACE_HOURS",
  retentionHours:
    "SITESOURCERY_ALAKAZAM_LIFECYCLE_RETENTION_HOURS",
  exportWindowHours:
    "SITESOURCERY_ALAKAZAM_LIFECYCLE_EXPORT_WINDOW_HOURS",
  graceConsequence:
    "SITESOURCERY_ALAKAZAM_LIFECYCLE_GRACE_CONSEQUENCE",
  suspensionConsequence:
    "SITESOURCERY_ALAKAZAM_LIFECYCLE_SUSPENSION_CONSEQUENCE",
  refundConsequence:
    "SITESOURCERY_ALAKAZAM_LIFECYCLE_REFUND_CONSEQUENCE",
  disputeConsequence:
    "SITESOURCERY_ALAKAZAM_LIFECYCLE_DISPUTE_CONSEQUENCE"
});

const HOUR_VARIABLES = Object.freeze([
  "graceHours",
  "suspendAfterGraceHours",
  "retentionHours",
  "exportWindowHours"
]);

const TEXT_VARIABLES = Object.freeze([
  "policyVersion",
  "graceConsequence",
  "suspensionConsequence",
  "refundConsequence",
  "disputeConsequence"
]);

function configurationError(code, message) {
  const error = new Error(message);
  error.name = "AlakazamLifecyclePolicyConfigurationError";
  error.code = code;
  return error;
}

function exactHours(name, raw) {
  if (!/^(0|[1-9][0-9]{0,4})$/u.test(raw ?? "")) {
    throw configurationError(
      "ALAKAZAM_LIFECYCLE_HOURS_INVALID",
      `${name} must be a whole number of hours the owner approved.`
    );
  }
  return Number(raw);
}

/**
 * Read the Alakazam lifecycle policy from configuration.
 *
 * Held is the default and the safe state. A held policy refuses to
 * carry any duration at all, so nobody can leave half a ruling in the
 * environment and have the runtime act on it.
 */
export function createConfiguredAlakazamLifecyclePolicy({
  environment = process.env
} = {}) {
  const mode =
    environment?.SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE ?? "held";
  if (!MODES.has(mode)) {
    throw configurationError(
      "ALAKAZAM_LIFECYCLE_MODE_INVALID",
      "SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE must be exactly held or approved."
    );
  }
  const supplied = Object.entries(
    ALAKAZAM_LIFECYCLE_POLICY_VARIABLES
  ).filter(([, name]) => {
    const value = environment?.[name];
    return value !== undefined && value !== "";
  });

  if (mode === "held") {
    if (supplied.length > 0) {
      throw configurationError(
        "ALAKAZAM_LIFECYCLE_RULING_WITHOUT_APPROVAL",
        `Alakazam lifecycle durations cannot be configured while the policy is held: ${supplied
          .map(([, name]) => name)
          .join(", ")}.`
      );
    }
    return Object.freeze({
      mode,
      policy: createAlakazamLifecyclePolicy(),
      openDecisions: ALAKAZAM_LIFECYCLE_OPEN_DECISIONS
    });
  }

  const missing = Object.entries(
    ALAKAZAM_LIFECYCLE_POLICY_VARIABLES
  )
    .filter(([, name]) => {
      const value = environment?.[name];
      return value === undefined || value === "";
    })
    .map(([, name]) => name);
  if (missing.length > 0) {
    throw configurationError(
      "ALAKAZAM_LIFECYCLE_RULING_INCOMPLETE",
      `An approved Alakazam lifecycle policy needs every owner ruling: ${missing.join(
        ", "
      )}.`
    );
  }

  const input = { approved: true };
  for (const field of HOUR_VARIABLES) {
    const name = ALAKAZAM_LIFECYCLE_POLICY_VARIABLES[field];
    input[field] = exactHours(name, environment[name]);
  }
  for (const field of TEXT_VARIABLES) {
    const name = ALAKAZAM_LIFECYCLE_POLICY_VARIABLES[field];
    input[field] = environment[name];
  }
  return Object.freeze({
    mode,
    policy: createAlakazamLifecyclePolicy(input),
    openDecisions: Object.freeze([])
  });
}
