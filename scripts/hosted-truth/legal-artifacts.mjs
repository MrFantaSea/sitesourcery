import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

export const HOSTED_PRIVACY_V2_ARTIFACT = Object.freeze({
  documentId: "00000000-0000-4000-8000-000000000022",
  kind: "privacy",
  version: "SS-HOSTED-PRIVACY-2026-07-30-V2",
  file: "legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/index.html",
  evidenceUri:
    "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/",
  canonicalUri: "https://sitesourcery.com/legal/privacy/",
  sha256: "b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b",
  byteCount: 19_935,
  mediaType: "text/html; charset=utf-8",
});

export const HOSTED_WEBSITE_TERMS_V2_ARTIFACT = Object.freeze({
  documentIds: Object.freeze([
    "00000000-0000-4000-8000-000000000021",
    "00000000-0000-4000-8000-000000000023",
  ]),
  kinds: Object.freeze(["product", "website"]),
  version: "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2",
  file:
    "legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2/index.html",
  evidenceUri:
    "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2/",
  canonicalUri: "https://sitesourcery.com/legal/website-terms/",
  sha256: "bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196",
  byteCount: 21_380,
  mediaType: "text/html; charset=utf-8",
});

export const HOSTED_PRIVACY_V3_CANDIDATE = Object.freeze({
  state: "unsealed",
  currentFile: "legal/privacy/index.html",
  headFragment: "scripts/hosted-truth/fragments/legal-privacy-head.html",
  mainFragment: "scripts/hosted-truth/fragments/legal-privacy-main.html",
  sourceStateMeta:
    '<meta name="sitesourcery-privacy-v3-source-state" content="unsealed">',
  sourceStateAttribute: 'data-privacy-v3-source-state="unsealed"',
});

/*
 * These are review/content identities, not release authority. They freeze the
 * exact noindex review artifact and the release-normalized content template
 * while exact owner approval, release identity, and publication remain open.
 */
export const HOSTED_PRIVACY_V3_CONTENT = Object.freeze({
  state: "review-frozen-approval-pending",
  published: false,
  deployable: false,
  reviewArtifactSha256:
    "d051b6fbf3191b59a86863ff673cd1571cf2b117c2f8ee51bcaa693cfb4f69dc",
  reviewArtifactByteCount: 26_058,
  contentTemplateSha256:
    "1f80e120f6edc8be6c989aa34de7f6f2a8bde3db5027b31c045d7d89b935a129",
  contentTemplateByteCount: 25_827,
  approvalReceiptSha256: null,
  contentSealSha256: null,
});

/*
 * An unsealed branch deliberately owns no V3 authority constants. The exact version,
 * effective time, full-page digest, byte count, and bundle authority digest
 * are filled only after the rendered owner/legal review and cutover date are
 * frozen. Builders use this object to prove that a V3 archive has not entered
 * either publication allowlist early.
 */
export const HOSTED_PRIVACY_V3_RELEASE = Object.freeze({
  state: "unsealed",
  kind: "privacy",
  currentFile: HOSTED_PRIVACY_V3_CANDIDATE.currentFile,
  version: null,
  versionedFile: null,
  effectiveAt: null,
  fullPageSha256: null,
  byteCount: null,
  authorityDigest: null,
});

export const immutableLegalArtifacts = Object.freeze([
  HOSTED_PRIVACY_V2_ARTIFACT,
  HOSTED_WEBSITE_TERMS_V2_ARTIFACT,
]);

export const immutableLegalArtifactFiles = Object.freeze(
  immutableLegalArtifacts.map(({ file }) => file),
);

const FINAL_PRIVACY_V3_FILE =
  /^legal\/privacy\/versions\/SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V3\/index\.html$/u;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertLegalArtifactRelativePath(file) {
  if (
    typeof file !== "string"
    || file === ""
    || file.startsWith("/")
    || file.includes("\\")
    || path.posix.normalize(file) !== file
    || file.split("/").includes("..")
  ) {
    throw new Error(`invalid immutable legal artifact path: ${JSON.stringify(file)}`);
  }
  return true;
}

function assertRegularUnaliasedFile(root, file) {
  assertLegalArtifactRelativePath(file);
  const segments = file.split("/");
  let cursor = path.resolve(root);
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    let state;
    try {
      state = lstatSync(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`immutable legal artifact is missing: ${file}`);
      }
      throw error;
    }
    if (state.isSymbolicLink()) {
      throw new Error(`immutable legal artifact traverses a symbolic link: ${file}`);
    }
    const final = index === segments.length - 1;
    if (final && !state.isFile()) {
      throw new Error(`immutable legal artifact is not a regular file: ${file}`);
    }
    if (!final && !state.isDirectory()) {
      throw new Error(`immutable legal artifact parent is not a directory: ${file}`);
    }
  }
  return cursor;
}

export function assertPrivacyV3Unsealed(release = HOSTED_PRIVACY_V3_RELEASE) {
  const unset = [
    release.version,
    release.versionedFile,
    release.effectiveAt,
    release.fullPageSha256,
    release.byteCount,
    release.authorityDigest,
  ];
  if (release.state !== "unsealed" || unset.some((value) => value !== null)) {
    throw new Error("hosted privacy V3 must remain explicitly unsealed until owner freeze");
  }
  return true;
}

export function assertPrivacyV3ContentApprovalPending(
  content = HOSTED_PRIVACY_V3_CONTENT,
) {
  if (
    content.state !== "review-frozen-approval-pending"
    || content.published !== false
    || content.deployable !== false
    || content.approvalReceiptSha256 !== null
    || content.contentSealSha256 !== null
  ) {
    throw new Error(
      "hosted privacy V3 content must remain approval-pending in source control",
    );
  }
  return true;
}

function assertContentIdentity(bytes, sha256, byteCount, label) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error(`${label} bytes are required`);
  }
  if (bytes.byteLength !== byteCount || digest(bytes) !== sha256) {
    throw new Error(`${label} identity changed without a reviewed content update`);
  }
}

export function assertPrivacyV3ContentInputs({
  reviewBytes,
  contentTemplateBytes,
} = {}) {
  assertPrivacyV3ContentApprovalPending();
  if (reviewBytes !== undefined) {
    assertContentIdentity(
      reviewBytes,
      HOSTED_PRIVACY_V3_CONTENT.reviewArtifactSha256,
      HOSTED_PRIVACY_V3_CONTENT.reviewArtifactByteCount,
      "privacy V3 review artifact",
    );
  }
  if (contentTemplateBytes !== undefined) {
    assertContentIdentity(
      contentTemplateBytes,
      HOSTED_PRIVACY_V3_CONTENT.contentTemplateSha256,
      HOSTED_PRIVACY_V3_CONTENT.contentTemplateByteCount,
      "privacy V3 content template",
    );
  }
  if (reviewBytes === undefined && contentTemplateBytes === undefined) {
    throw new Error("privacy V3 content identity requires review or template bytes");
  }
  return true;
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function truthSlot(source, id) {
  const start = `<!-- sitesourcery:truth-slot:${id}:start -->`;
  const end = `<!-- sitesourcery:truth-slot:${id}:end -->`;
  if (occurrences(source, start) !== 1 || occurrences(source, end) !== 1) {
    throw new Error(`privacy V3 candidate truth slot is missing or duplicated: ${id}`);
  }
  const startIndex = source.indexOf(start) + start.length;
  const endIndex = source.indexOf(end);
  if (startIndex >= endIndex) {
    throw new Error(`privacy V3 candidate truth slot is out of order: ${id}`);
  }
  return source.slice(startIndex, endIndex).trim();
}

export function assertPrivacyV3CandidateSources({ root = process.cwd() } = {}) {
  assertPrivacyV3Unsealed();
  const candidate = HOSTED_PRIVACY_V3_CANDIDATE;
  const source = readFileSync(
    assertRegularUnaliasedFile(root, candidate.currentFile),
    "utf8",
  );
  const fragments = [
    ["legal-privacy-head", candidate.headFragment],
    ["legal-privacy-main", candidate.mainFragment],
  ];
  for (const [id, file] of fragments) {
    const fragment = readFileSync(assertRegularUnaliasedFile(root, file), "utf8");
    if (fragment.trim() !== truthSlot(source, id)) {
      throw new Error(`privacy V3 candidate fragment does not match source slot: ${file}`);
    }
  }
  if (
    occurrences(source, candidate.sourceStateMeta) !== 1
    || occurrences(source, candidate.sourceStateAttribute) !== 1
    || !source.includes("Not effective — release identity pending")
    || !source.includes("Privacy V3 clause-review source")
    || FINAL_PRIVACY_V3_FILE.test(candidate.currentFile)
    || /SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V3/u.test(source)
    || /<p class="card-kicker">Effective [A-Z][a-z]+ \d{1,2}, \d{4}<\/p>/u.test(source)
  ) {
    throw new Error("privacy V3 candidate source contains sealed or ambiguous release identity");
  }
  return true;
}

export function assertUnsealedPrivacyCurrentAlias({ root = process.cwd() } = {}) {
  assertPrivacyV3Unsealed();
  const current = readFileSync(
    assertRegularUnaliasedFile(root, HOSTED_PRIVACY_V3_CANDIDATE.currentFile),
  );
  const v2 = readFileSync(
    assertRegularUnaliasedFile(root, HOSTED_PRIVACY_V2_ARTIFACT.file),
  );
  if (!current.equals(v2)) {
    throw new Error(
      "unsealed privacy publication must keep the current alias byte-identical to V2",
    );
  }
  return true;
}

export function assertPrivacyV3NotPublished(files, label = "artifact allowlist") {
  assertPrivacyV3Unsealed();
  for (const file of files) {
    if (FINAL_PRIVACY_V3_FILE.test(file)) {
      throw new Error(`${label} contains an unsealed privacy V3 artifact: ${file}`);
    }
  }
  return true;
}

export function assertImmutableLegalArtifactSources({ root = process.cwd() } = {}) {
  assertPrivacyV3Unsealed();
  for (const artifact of immutableLegalArtifacts) {
    const absolute = assertRegularUnaliasedFile(root, artifact.file);
    const bytes = readFileSync(absolute);
    if (bytes.length !== artifact.byteCount) {
      throw new Error(
        `${artifact.file} byte count changed; expected ${artifact.byteCount}, received ${bytes.length}`,
      );
    }
    const actualDigest = digest(bytes);
    if (actualDigest !== artifact.sha256) {
      throw new Error(
        `${artifact.file} digest changed; expected ${artifact.sha256}, received ${actualDigest}`,
      );
    }
  }
  return true;
}
