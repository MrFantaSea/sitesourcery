import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  JOINT_LEGAL_V5_ACCEPTANCE_SCHEMA,
  JOINT_LEGAL_V5_AUTHORITY_SCHEMA,
  JOINT_LEGAL_V5_FINALIZATION_SCHEMA,
  JOINT_LEGAL_V5_PRIVACY_VERSION,
  JOINT_LEGAL_V5_WEBSITE_TERMS_VERSION,
} from "./finalize-joint-legal-v5.mjs";
import {
  createPagesJointLegalV4Plan,
} from "./pages-legal-v4.mjs";

export const PAGES_JOINT_LEGAL_V4_ROOT =
  "ops/releases/joint-legal-v4-2026-08-09T214211Z";
export const PAGES_JOINT_LEGAL_V5_ROOT =
  "ops/releases/final-successor-20260811/joint-legal-v5-finalization";
export const PAGES_JOINT_LEGAL_V5_RECEIPT =
  "joint-legal-v5-release-constants.json";

const SHA256 = /^[0-9a-f]{64}$/u;
const ROLES = Object.freeze([
  "privacy-current",
  "privacy-versioned",
  "website-terms-current",
  "website-terms-versioned",
  "legal-center-current",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertRealFile(root, relative) {
  if (
    typeof relative !== "string"
    || relative === ""
    || relative.startsWith("/")
    || relative.includes("\\")
    || path.posix.normalize(relative) !== relative
    || relative.split("/").includes("..")
  ) throw new Error(`unsafe V5 legal artifact path: ${JSON.stringify(relative)}`);
  let cursor = root;
  const segments = relative.split("/");
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    const state = lstatSync(cursor);
    if (state.isSymbolicLink()) {
      throw new Error(`V5 legal artifact traverses a symbolic link: ${relative}`);
    }
    const final = index === segments.length - 1;
    if (final ? !state.isFile() : !state.isDirectory()) {
      throw new Error(`V5 legal artifact has an invalid file type: ${relative}`);
    }
  }
  return cursor;
}

function validateV5Artifact(root, artifact, role, file) {
  if (
    artifact?.role !== role
    || artifact.file !== file
    || !SHA256.test(artifact.sha256 ?? "")
    || !Number.isSafeInteger(artifact.byteCount)
    || artifact.byteCount < 1
  ) throw new Error(`joint legal V5 receipt artifact is invalid: ${role}`);
  const source = assertRealFile(root, artifact.file);
  const bytes = readFileSync(source);
  if (
    sha256(bytes) !== artifact.sha256
    || bytes.byteLength !== artifact.byteCount
  ) throw new Error(`joint legal V5 artifact bytes changed: ${role}`);
  return Object.freeze({
    role,
    file: file.replace(/^hosted\//u, ""),
    source,
    sha256: artifact.sha256,
    byteCount: artifact.byteCount,
  });
}

function validateV5Finalization(root) {
  const receiptFile = assertRealFile(root, PAGES_JOINT_LEGAL_V5_RECEIPT);
  const receiptBytes = readFileSync(receiptFile);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  if (
    receipt?.schema !== JOINT_LEGAL_V5_FINALIZATION_SCHEMA
    || receipt.state !== "owner-approved-finalization"
    || receipt.sealable !== true
    || receipt.published !== false
    || receipt.deploymentAuthorized !== false
    || receipt.integrationRequired !== true
    || receipt.authoritySchema !== JOINT_LEGAL_V5_AUTHORITY_SCHEMA
    || receipt.acceptanceSchema !== JOINT_LEGAL_V5_ACCEPTANCE_SCHEMA
    || !Array.isArray(receipt.documents)
    || receipt.documents.length !== 3
    || !Array.isArray(receipt.artifacts)
    || receipt.artifacts.length !== 5
    || JSON.stringify(receipt.artifacts.map(({ role }) => role))
      !== JSON.stringify(ROLES)
    || receipt.release?.privacyVersion !== JOINT_LEGAL_V5_PRIVACY_VERSION
    || receipt.release?.websiteTermsVersion
      !== JOINT_LEGAL_V5_WEBSITE_TERMS_VERSION
    || receipt.release?.effectiveAt !== receipt.effectiveAt
    || receipt.release?.authorityDigest !== receipt.authorityDigest
  ) throw new Error("joint legal V5 finalization receipt is invalid");
  const files = [
    "hosted/legal/privacy/index.html",
    `hosted/legal/privacy/versions/${JOINT_LEGAL_V5_PRIVACY_VERSION}/index.html`,
    "hosted/legal/website-terms/index.html",
    `hosted/legal/website-terms/versions/${JOINT_LEGAL_V5_WEBSITE_TERMS_VERSION}/index.html`,
    "hosted/legal/index.html",
  ];
  const artifacts = Object.freeze(receipt.artifacts.map((artifact, index) =>
    validateV5Artifact(root, artifact, ROLES[index], files[index])));
  for (const [current, versioned] of [[0, 1], [2, 3]]) {
    if (
      artifacts[current].sha256 !== artifacts[versioned].sha256
      || artifacts[current].byteCount !== artifacts[versioned].byteCount
    ) throw new Error("joint legal V5 current and versioned bytes differ");
  }
  return Object.freeze({
    root,
    receipt,
    receiptSha256: sha256(receiptBytes),
    artifacts,
  });
}

export function createPagesJointLegalV5Plan({ root = process.cwd() } = {}) {
  const absoluteRoot = path.resolve(root);
  const v4 = createPagesJointLegalV4Plan({
    root: absoluteRoot,
    finalizationRoot: PAGES_JOINT_LEGAL_V4_ROOT,
  });
  const v5Root = path.join(
    absoluteRoot,
    ...PAGES_JOINT_LEGAL_V5_ROOT.split("/"),
  );
  const state = lstatSync(v5Root);
  if (!state.isDirectory() || state.isSymbolicLink()) {
    throw new Error("Pages joint legal V5 root must be one real directory");
  }
  const v5 = validateV5Finalization(v5Root);
  const retainedVersioned = v4.publishedArtifacts.filter(({ role }) =>
    role.endsWith("-versioned"));
  const v5Published = [v5.artifacts[4], v5.artifacts[0], v5.artifacts[1],
    v5.artifacts[2], v5.artifacts[3]];
  const publishedArtifacts = Object.freeze([
    ...retainedVersioned,
    ...v5Published,
  ].sort((left, right) => left.file.localeCompare(right.file)));
  return Object.freeze({
    publishedArtifacts,
    sourceByFile: new Map(
      publishedArtifacts.map((artifact) => [artifact.file, artifact.source]),
    ),
    v4,
    v5,
  });
}

export function pagesLegalV5Files(publicFiles, plan) {
  return Object.freeze([...new Set([
    ...publicFiles,
    ...plan.publishedArtifacts.map(({ file }) => file),
  ])].sort((left, right) => left.localeCompare(right)));
}

export function assertPagesJointLegalV5Artifact(output, plan) {
  for (const artifact of plan.publishedArtifacts) {
    const bytes = readFileSync(assertRealFile(output, artifact.file));
    if (
      sha256(bytes) !== artifact.sha256
      || bytes.byteLength !== artifact.byteCount
    ) throw new Error(`Pages joint legal V5 artifact mismatch: ${artifact.role}`);
  }
  return true;
}
