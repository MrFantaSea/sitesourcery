export const JOINT_LEGAL_V3_CONTENT = Object.freeze({
  state: "review-frozen-approval-pending",
  published: false,
  deployable: false,
  privacy: Object.freeze({
    reviewSha256: "f2e40058b8c34a5e5c6c9f4d4892ac5311ff0357ca71f84a0edd8199242ccef1",
    reviewByteCount: 29_874,
    templateSha256: "fa6c804bab0d5db93e5e30b76cea0e40e5158433d055907f637ee84366f9d29d",
    templateByteCount: 29_633,
  }),
  websiteTerms: Object.freeze({
    reviewSha256: "173b025f9a26d7cd7d491ac56a1ca3d6680a0df67cde95a8511642602b159d71",
    reviewByteCount: 26_224,
    templateSha256: "d5ec519061dbec41821bae7fc79e0220427cdeee8591c515120f3f17aaa6adc1",
    templateByteCount: 26_200,
  }),
});

export const JOINT_LEGAL_V3_RELEASE = Object.freeze({
  state: "unsealed",
  privacyVersion: null,
  privacySha256: null,
  privacyByteCount: null,
  privacyArtifactUri: null,
  websiteTermsVersion: null,
  websiteTermsSha256: null,
  websiteTermsByteCount: null,
  websiteTermsArtifactUri: null,
  effectiveAt: null,
  authorityDigest: null,
});

export function assertJointLegalV3Unsealed(release = JOINT_LEGAL_V3_RELEASE) {
  if (
    release.state !== "unsealed"
    || Object.entries(release).some(([key, value]) => key !== "state" && value !== null)
  ) {
    throw new Error("joint legal V3 release constants must remain unsealed");
  }
  return true;
}
