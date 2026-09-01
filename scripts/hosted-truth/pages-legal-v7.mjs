import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  JOINT_LEGAL_V7_ACCEPTANCE_SCHEMA,
  JOINT_LEGAL_V7_AUTHORITY_SCHEMA,
  JOINT_LEGAL_V7_EFFECTIVE_AT,
  JOINT_LEGAL_V7_FINALIZATION_SCHEMA,
  JOINT_LEGAL_V7_PRIVACY_VERSION,
  JOINT_LEGAL_V7_RECEIPT,
  JOINT_LEGAL_V7_ROOT,
  JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION,
} from "./finalize-joint-legal-v7.mjs";
import { createPagesJointLegalV5Plan } from "./pages-legal-v5.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const ROLES = Object.freeze([
  "privacy-current",
  "privacy-versioned",
  "website-terms-current",
  "website-terms-versioned",
  "legal-center-current",
]);

function lexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

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
  ) throw new Error(`unsafe V7 legal artifact path: ${JSON.stringify(relative)}`);
  let cursor = root;
  const segments = relative.split("/");
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    const state = lstatSync(cursor);
    if (state.isSymbolicLink()) {
      throw new Error(`V7 legal artifact traverses a symbolic link: ${relative}`);
    }
    const final = index === segments.length - 1;
    if (final ? !state.isFile() : !state.isDirectory()) {
      throw new Error(`V7 legal artifact has an invalid file type: ${relative}`);
    }
  }
  return cursor;
}

function validateArtifact(root, artifact, role, file) {
  if (
    artifact?.role !== role
    || artifact.file !== file
    || !SHA256.test(artifact.sha256 ?? "")
    || !Number.isSafeInteger(artifact.byteCount)
    || artifact.byteCount < 1
  ) throw new Error(`joint legal V7 receipt artifact is invalid: ${role}`);
  const source = assertRealFile(root, file);
  const bytes = readFileSync(source);
  if (
    sha256(bytes) !== artifact.sha256
    || bytes.byteLength !== artifact.byteCount
  ) throw new Error(`joint legal V7 artifact bytes changed: ${role}`);
  return Object.freeze({
    role,
    file: file.replace(/^hosted\//u, ""),
    source,
    sha256: artifact.sha256,
    byteCount: artifact.byteCount,
  });
}

function validateFinalization(root) {
  const receiptFile = assertRealFile(root, JOINT_LEGAL_V7_RECEIPT);
  const receiptBytes = readFileSync(receiptFile);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  if (
    receipt?.schema !== JOINT_LEGAL_V7_FINALIZATION_SCHEMA
    || receipt.state !== "owner-approved-finalization"
    || receipt.sealable !== true
    || receipt.published !== false
    || receipt.deploymentAuthorized !== false
    || receipt.integrationRequired !== true
    || receipt.effectiveAt !== JOINT_LEGAL_V7_EFFECTIVE_AT
    || receipt.authoritySchema !== JOINT_LEGAL_V7_AUTHORITY_SCHEMA
    || receipt.acceptanceSchema !== JOINT_LEGAL_V7_ACCEPTANCE_SCHEMA
    || receipt.release?.privacyVersion !== JOINT_LEGAL_V7_PRIVACY_VERSION
    || receipt.release?.websiteTermsVersion !== JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION
    || receipt.release?.effectiveAt !== JOINT_LEGAL_V7_EFFECTIVE_AT
    || receipt.release?.authorityDigest !== receipt.authorityDigest
    || !Array.isArray(receipt.documents)
    || receipt.documents.length !== 3
    || !Array.isArray(receipt.artifacts)
    || receipt.artifacts.length !== ROLES.length
    || JSON.stringify(receipt.artifacts.map(({ role }) => role)) !== JSON.stringify(ROLES)
  ) throw new Error("joint legal V7 finalization receipt is invalid");
  const files = [
    "hosted/legal/privacy/index.html",
    `hosted/legal/privacy/versions/${JOINT_LEGAL_V7_PRIVACY_VERSION}/index.html`,
    "hosted/legal/website-terms/index.html",
    `hosted/legal/website-terms/versions/${JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION}/index.html`,
    "hosted/legal/index.html",
  ];
  const artifacts = Object.freeze(receipt.artifacts.map((artifact, index) =>
    validateArtifact(root, artifact, ROLES[index], files[index])));
  for (const [current, versioned] of [[0, 1], [2, 3]]) {
    if (
      artifacts[current].sha256 !== artifacts[versioned].sha256
      || artifacts[current].byteCount !== artifacts[versioned].byteCount
    ) throw new Error("joint legal V7 current and versioned bytes differ");
  }
  return Object.freeze({
    root,
    receipt,
    receiptSha256: sha256(receiptBytes),
    artifacts,
  });
}

export function createPagesJointLegalV7Plan({ root = process.cwd() } = {}) {
  const absoluteRoot = path.resolve(root);
  const v5 = createPagesJointLegalV5Plan({ root: absoluteRoot });
  const v7Root = path.join(absoluteRoot, ...JOINT_LEGAL_V7_ROOT.split("/"));
  const state = lstatSync(v7Root);
  if (!state.isDirectory() || state.isSymbolicLink()) {
    throw new Error("Pages joint legal V7 root must be one real directory");
  }
  const v7 = validateFinalization(v7Root);
  const retainedVersioned = v5.publishedArtifacts.filter(({ role }) =>
    role.endsWith("-versioned"));
  const v7Published = [
    v7.artifacts[4],
    v7.artifacts[0],
    v7.artifacts[1],
    v7.artifacts[2],
    v7.artifacts[3],
  ];
  const publishedArtifacts = Object.freeze([
    ...retainedVersioned,
    ...v7Published,
  ].sort((left, right) => lexical(left.file, right.file)));
  return Object.freeze({
    publishedArtifacts,
    sourceByFile: new Map(
      publishedArtifacts.map((artifact) => [artifact.file, artifact.source]),
    ),
    v5,
    v7,
  });
}

export function pagesLegalV7Files(publicFiles, plan) {
  return Object.freeze([...new Set([
    ...publicFiles,
    ...plan.publishedArtifacts.map(({ file }) => file),
  ])].sort(lexical));
}

export function assertPagesJointLegalV7Artifact(output, plan) {
  for (const artifact of plan.publishedArtifacts) {
    const bytes = readFileSync(assertRealFile(output, artifact.file));
    if (
      sha256(bytes) !== artifact.sha256
      || bytes.byteLength !== artifact.byteCount
    ) throw new Error(`Pages joint legal V7 artifact mismatch: ${artifact.role}`);
  }
  return true;
}
