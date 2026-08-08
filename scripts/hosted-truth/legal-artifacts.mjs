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

/*
 * Phase A deliberately owns no V3 authority constants. The exact version,
 * effective time, full-page digest, byte count, and bundle authority digest
 * are filled only after the rendered owner/legal review and cutover date are
 * frozen. Builders use this object to prove that a V3 archive has not entered
 * either publication allowlist early.
 */
export const HOSTED_PRIVACY_V3_RELEASE = Object.freeze({
  state: "unsealed",
  kind: "privacy",
  currentFile: "legal/privacy/index.html",
  version: null,
  versionedFile: null,
  effectiveAt: null,
  fullPageSha256: null,
  byteCount: null,
  authorityDigest: null,
});

export const immutableLegalArtifacts = Object.freeze([
  HOSTED_PRIVACY_V2_ARTIFACT,
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

export function assertPrivacyV3Unsealed() {
  const release = HOSTED_PRIVACY_V3_RELEASE;
  const unset = [
    release.version,
    release.versionedFile,
    release.effectiveAt,
    release.fullPageSha256,
    release.byteCount,
    release.authorityDigest,
  ];
  if (release.state !== "unsealed" || unset.some((value) => value !== null)) {
    throw new Error("hosted privacy V3 Phase A must remain explicitly unsealed");
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
