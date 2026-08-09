export const JOINT_LEGAL_V4_DOCUMENT_IDS = Object.freeze({
  privacy: "00000000-0000-4000-8000-000000000049",
  product: "00000000-0000-4000-8000-000000000105",
  website: "00000000-0000-4000-8000-000000000106",
});

export const JOINT_LEGAL_V4_CONTENT = Object.freeze({
  state: "content-approved-release-held",
  published: false,
  deployable: false,
  privacy: Object.freeze({
    reviewSha256: "eeec62ecb84fe42c8a8e3c7fa207f8b35479fceab998db925d49de4bf64126db",
    reviewByteCount: 31_481,
    templateSha256: "43598d6f67a4a06c994663eda261862310b3d3b61f80b4ce70aa2beec6634239",
    templateByteCount: 31_478,
  }),
  websiteTerms: Object.freeze({
    reviewSha256: "986e4f3cb73b522cea11557f5a5fa819ecf050d98daa93f875264c1a692e13e4",
    reviewByteCount: 26_250,
    templateSha256: "8f75c6b94cb962638c40b88462c9e0ec515ca2b7726a73e1564e444aaf1a520c",
    templateByteCount: 26_242,
  }),
});

// Content review and release authority are separate. No production V4 tuple
// exists until the later finalizer receives exact owner approval after the
// real Cloudflare configuration has been captured and reviewed.
export const JOINT_LEGAL_V4_RELEASE = Object.freeze({
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

export function assertJointLegalV4Held(
  release = JOINT_LEGAL_V4_RELEASE,
) {
  if (
    release.state !== "unsealed"
    || Object.entries(release).some(
      ([key, value]) => key !== "state" && value !== null,
    )
  ) {
    throw new Error("joint legal V4 release constants must remain held");
  }
  return true;
}
