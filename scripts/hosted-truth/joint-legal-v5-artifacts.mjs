export const JOINT_LEGAL_V5_DOCUMENT_IDS = Object.freeze({
  privacy: "00000000-0000-4000-8000-000000000149",
  product: "00000000-0000-4000-8000-000000000150",
  website: "00000000-0000-4000-8000-000000000151",
});

export const JOINT_LEGAL_V5_CONTENT = Object.freeze({
  schema: "sitesourcery.joint-legal-v5-content/v1",
  state: "review-candidate-unapproved",
  published: false,
  deployable: false,
  catalogVersion: "SS-COMMERCIAL-2026.6",
  catalogDigest:
    "3416befc73dccbf2f8dc0f40233d4cd7c1833e4e329bd1047ce8bf41fd2e4de0",
  center: Object.freeze({
    reviewSha256:
      "12cc8da033dac98c25eb78989736bdbdbaf1a8407c173f7863ff2b211ee03cae",
    reviewByteCount: 5_450,
    templateSha256:
      "935ca6b746c5ab178cf4a5db5e16a7be65203e5972c63aa948cbb2ef1a5ee97c",
    templateByteCount: 5_283,
  }),
  privacy: Object.freeze({
    reviewSha256:
      "aefdfbb5d734090fffd26dcd32767ba7f08fabf19c231cb9586fe783a367b572",
    reviewByteCount: 31_478,
    templateSha256:
      "fec8daa5a7115d843e925ae2afc7a266c76f3be4b7b9dc4a520db92e2d6211c2",
    templateByteCount: 31_353,
  }),
  websiteTerms: Object.freeze({
    reviewSha256:
      "31a1d3b057e09a883fa0ae46cedc63c9a01b32604fbfe199c7a33724b856a22b",
    reviewByteCount: 28_804,
    templateSha256:
      "c39c7df815508c09b19c9449a25e9895ea82cb07e100e54883a9da790cd05f65",
    templateByteCount: 28_621,
  }),
});

// Review content and release authority are deliberately separate. These values
// remain null until the owner approves the exact review bytes, document
// versions, and effective UTC time. Merely creating or inspecting the review
// bundle cannot fill this tuple.
export const JOINT_LEGAL_V5_RELEASE = Object.freeze({
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

export function assertJointLegalV5Held(release = JOINT_LEGAL_V5_RELEASE) {
  if (
    release.state !== "unsealed"
    || Object.entries(release).some(
      ([key, value]) => key !== "state" && value !== null,
    )
  ) throw new Error("joint legal V5 release constants must remain unsealed");
  return true;
}
