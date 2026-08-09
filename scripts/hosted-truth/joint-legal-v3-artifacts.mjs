export const JOINT_LEGAL_V3_CONTENT = Object.freeze({
  state: "content-approved",
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
  state: "finalized",
  privacyVersion: "SS-HOSTED-PRIVACY-2026-08-09-V3",
  privacySha256: "5713fd6776c6ba41dbbac1b4d1ac0d9f1b6857ba01128e5d74c4f3c5287a4967",
  privacyByteCount: 29_610,
  privacyArtifactUri:
    "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V3/",
  websiteTermsVersion: "SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3",
  websiteTermsSha256: "b179ee8b6ed713b6b19b20daf320e84a9e89f2ac166504942919f8c4e280a602",
  websiteTermsByteCount: 26_171,
  websiteTermsArtifactUri:
    "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3/",
  effectiveAt: "2026-08-09T15:25:59.000Z",
  authorityDigest: "ae52bb144a3cb9bd09709cd58ce43878ec2a03d650a19ff197532ea51cd4d1cf",
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
