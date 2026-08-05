import {
  ALAKAZAM_CATALOG_VERSION,
  resolveAlakazamTier
} from "../commerce-v2/alakazam.mjs";
import {
  ALAKAZAM_EFFECTIVE_POLICY_SCHEMA,
  ALAKAZAM_FULFILLMENT_AUTHORITY_SCHEMA
} from "../commerce-v2/alakazam-fulfillment.mjs";
import {
  canonicalJson,
  clone,
  deepFreeze,
  digest
} from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const LOOK_CAPABILITIES = Object.freeze({
  clear: "look_crystal",
  warm: "look_hearth",
  arcane: "look_midnight"
});
const ORDINARY_FACT_FIELDS = Object.freeze([
  "accent",
  "businessName",
  "summary",
  "about",
  "offerings",
  "location",
  "hours",
  "phone",
  "email",
  "website",
  "primaryAction"
]);

function rejectAuthority() {
  throw new HostedError(
    "ALAKAZAM_COMPILER_AUTHORITY_INVALID",
    "The Alakazam compiler authority is invalid or changed.",
    { status: 409 }
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  return (
    isPlainObject(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort())
  );
}

function isExactIso(value) {
  if (typeof value !== "string" || value.length > 40) return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function exactAuthority(authority) {
  if (
    !hasExactKeys(authority, [
      "authorizedAt",
      "customerId",
      "policy",
      "policyDigest",
      "projectId",
      "schema",
      "subscriptionId",
      "subscriptionRevision",
      "tenantId"
    ]) ||
    !hasExactKeys(authority.policy, [
      "capabilities",
      "catalogVersion",
      "limits",
      "schema",
      "tierId"
    ]) ||
    authority.schema !== ALAKAZAM_FULFILLMENT_AUTHORITY_SCHEMA ||
    authority.policy.schema !== ALAKAZAM_EFFECTIVE_POLICY_SCHEMA ||
    authority.policy.catalogVersion !== ALAKAZAM_CATALOG_VERSION ||
    !UUID.test(authority.tenantId) ||
    !UUID.test(authority.customerId) ||
    !UUID.test(authority.projectId) ||
    !UUID.test(authority.subscriptionId) ||
    !Number.isSafeInteger(authority.subscriptionRevision) ||
    authority.subscriptionRevision < 1 ||
    !isExactIso(authority.authorizedAt) ||
    !DIGEST.test(authority.policyDigest)
  ) {
    rejectAuthority();
  }

  let canonicalPolicy;
  let selectedPolicyJson;
  let selectedPolicyDigest;
  try {
    const tier = resolveAlakazamTier(authority.policy.tierId);
    canonicalPolicy = {
      schema: ALAKAZAM_EFFECTIVE_POLICY_SCHEMA,
      catalogVersion: ALAKAZAM_CATALOG_VERSION,
      tierId: tier.tierId,
      capabilities: clone(tier.capabilities),
      limits: clone(tier.limits)
    };
    selectedPolicyJson = canonicalJson(authority.policy);
    selectedPolicyDigest = digest(authority.policy);
  } catch {
    rejectAuthority();
  }

  if (
    selectedPolicyJson !== canonicalJson(canonicalPolicy) ||
    selectedPolicyDigest !== authority.policyDigest
  ) {
    rejectAuthority();
  }

  return deepFreeze({
    policy: clone(canonicalPolicy),
    policyDigest: authority.policyDigest
  });
}

function cloneFact(value, field) {
  try {
    const serialized = JSON.stringify(value);
    invariant(
      serialized !== undefined,
      "ALAKAZAM_CONFIGURED_FACTS_INVALID",
      `${field} is not a JSON fact`,
      { status: 400 }
    );
    return JSON.parse(serialized);
  } catch (error) {
    if (error instanceof HostedError) throw error;
    throw new HostedError(
      "ALAKAZAM_CONFIGURED_FACTS_INVALID",
      `${field} is not a JSON fact`,
      { status: 400 }
    );
  }
}

function copyFact(configuredFacts, effectiveFacts, field) {
  if (
    Object.prototype.hasOwnProperty.call(configuredFacts, field) &&
    configuredFacts[field] !== undefined
  ) {
    effectiveFacts[field] = cloneFact(
      configuredFacts[field],
      `configuredFacts.${field}`
    );
  }
}

function exactLook(configuredFacts, policy) {
  const look =
    typeof configuredFacts.theme === "string"
      ? configuredFacts.theme.normalize("NFC").trim().toLowerCase()
      : "";
  const capability = LOOK_CAPABILITIES[look];
  invariant(
    Boolean(capability) && policy.capabilities.includes(capability),
    "ALAKAZAM_LOOK_UNAVAILABLE",
    "The selected Alakazam look is unavailable.",
    { status: 409 }
  );
  return look;
}

export function applyAlakazamCompilerPolicy(input) {
  invariant(
    hasExactKeys(input, ["authority", "configuredFacts"]),
    "ALAKAZAM_COMPILER_INPUT_INVALID",
    "The Alakazam compiler input is invalid.",
    { status: 400 }
  );
  invariant(
    isPlainObject(input.configuredFacts),
    "ALAKAZAM_CONFIGURED_FACTS_INVALID",
    "The configured website facts are invalid.",
    { status: 400 }
  );

  const selected = exactAuthority(input.authority);
  const effectiveFacts = {
    theme: exactLook(input.configuredFacts, selected.policy)
  };
  for (const field of ORDINARY_FACT_FIELDS) {
    copyFact(input.configuredFacts, effectiveFacts, field);
  }

  // The owner has not frozen expanded/extended font or border sets yet.
  // Preserve those configured values outside this clone and fail closed here.
  effectiveFacts.fontPair = "standard";
  effectiveFacts.borderStyle = "soft";

  if (selected.policy.capabilities.includes("cash_app_link")) {
    copyFact(input.configuredFacts, effectiveFacts, "cashapp");
  }
  if (selected.policy.capabilities.includes("venmo_link")) {
    copyFact(input.configuredFacts, effectiveFacts, "venmo");
  }

  return deepFreeze({
    policy: clone(selected.policy),
    policyDigest: selected.policyDigest,
    effectiveFacts
  });
}
