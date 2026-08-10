import {
  clone, deepFreeze, digest, invariant
} from "./canonical.mjs";
import {
  ALAKAZAM_CANONICAL_CARE,
  ALAKAZAM_CANONICAL_CARE_LIFECYCLE
} from "./alakazam-policy-authority.mjs";

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
  lifecycle: ALAKAZAM_CANONICAL_CARE_LIFECYCLE,
  care: ALAKAZAM_CANONICAL_CARE
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
