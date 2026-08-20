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
      "f37164a83492bcaa72472d83c775239eb8c430d6b73632cf593a82879c1b1702",
    reviewByteCount: 5_489,
    templateSha256:
      "d968e865e73cf56232dd532f9c1a201dc1b0890f323073794c4dd80fa3971380",
    templateByteCount: 5_322,
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
      "42d8d9cb767fcd2b6b01edc69dd55b00ba63f2e03288ad4d3ed66f1d1005942e",
    reviewByteCount: 31_984,
    templateSha256:
      "ad6af15bfbe641ac37b560ba5341085390e71d804babb1b846b492ad2e9485e2",
    templateByteCount: 31_801,
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
