import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { JOINT_LEGAL_V3_RELEASE } from "./joint-legal-v3-artifacts.mjs";
import {
  JOINT_LEGAL_V4_DOCUMENT_IDS,
  JOINT_LEGAL_V4_RELEASE,
} from "./joint-legal-v4-artifacts.mjs";

export const PAGES_JOINT_LEGAL_V3_ROOT =
  "ops/releases/joint-legal-v3-2026-08-09T152559Z";
export const PAGES_JOINT_LEGAL_V3_RECEIPT =
  "joint-legal-v3-release-constants.json";
export const PAGES_JOINT_LEGAL_V4_RECEIPT =
  "joint-legal-v4-release-constants.json";

const V3_SCHEMA = "sitesourcery.hosted-joint-legal-v3-finalization/v1";
const V4_SCHEMA = "sitesourcery.hosted-joint-legal-v4-finalization/v1";
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
  ) throw new Error(`unsafe retained legal artifact path: ${JSON.stringify(relative)}`);
  let cursor = root;
  for (const [index, segment] of relative.split("/").entries()) {
    cursor = path.join(cursor, segment);
    const state = lstatSync(cursor);
    if (state.isSymbolicLink()) {
      throw new Error(`retained legal artifact traverses a symbolic link: ${relative}`);
    }
    const final = index === relative.split("/").length - 1;
    if (final ? !state.isFile() : !state.isDirectory()) {
      throw new Error(`retained legal artifact has an invalid file type: ${relative}`);
    }
  }
  return cursor;
}

function receiptArtifact(root, artifact, role, file) {
  if (
    artifact?.role !== role
    || artifact.file !== `hosted/${file}`
    || !SHA256.test(artifact.sha256 ?? "")
    || !Number.isSafeInteger(artifact.byteCount)
    || artifact.byteCount < 1
  ) throw new Error(`retained legal receipt artifact is invalid: ${role}`);
  const source = assertRealFile(root, artifact.file);
  const bytes = readFileSync(source);
  if (sha256(bytes) !== artifact.sha256 || bytes.byteLength !== artifact.byteCount) {
    throw new Error(`retained legal artifact bytes changed: ${role}`);
  }
  return Object.freeze({
    byteCount: artifact.byteCount,
    file,
    role,
    sha256: artifact.sha256,
    source,
  });
}

function validateReceipt(root, {
  schema,
  release,
  version,
  documentBindings,
}) {
  const receiptName = version === 4
    ? PAGES_JOINT_LEGAL_V4_RECEIPT
    : PAGES_JOINT_LEGAL_V3_RECEIPT;
  const receiptBytes = readFileSync(assertRealFile(root, receiptName));
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  if (
    receipt?.schema !== schema
    || receipt.state !== "owner-approved-finalization"
    || receipt.sealable !== true
    || receipt.published !== false
    || receipt.integrationRequired !== true
    || receipt.effectiveAt !== release.effectiveAt
    || receipt.authorityDigest !== release.authorityDigest
    || !Array.isArray(receipt.documents)
    || receipt.documents.length !== 3
    || !Array.isArray(receipt.artifacts)
    || receipt.artifacts.length !== 5
    || JSON.stringify(receipt.artifacts.map(({ role }) => role)) !== JSON.stringify(ROLES)
  ) throw new Error(`joint legal V${version} finalization receipt is invalid`);
  if (documentBindings) {
    const expected = [
      { kind: "privacy", id: documentBindings.privacy },
      { kind: "product", id: documentBindings.product },
      { kind: "website", id: documentBindings.website },
    ];
    if (
      receipt.authoritySchema !== "sitesourcery.project-legal-authority/v4"
      || receipt.acceptanceSchema !== "sitesourcery.project-legal-acceptance/v4"
      || JSON.stringify(receipt.documentBindings) !== JSON.stringify(expected)
    ) throw new Error("joint legal V4 authority bindings are invalid");
  }
  const [privacy, product, website] = receipt.documents;
  if (
    privacy?.kind !== "privacy"
    || privacy.version !== release.privacyVersion
    || privacy.contentDigest !== release.privacySha256
    || privacy.effectiveAt !== release.effectiveAt
    || product?.kind !== "product"
    || product.version !== release.websiteTermsVersion
    || product.contentDigest !== release.websiteTermsSha256
    || product.effectiveAt !== release.effectiveAt
    || website?.kind !== "website"
    || website.version !== release.websiteTermsVersion
    || website.contentDigest !== release.websiteTermsSha256
    || website.effectiveAt !== release.effectiveAt
  ) throw new Error(`joint legal V${version} document tuple is invalid`);
  const files = [
    "legal/privacy/index.html",
    `legal/privacy/versions/${release.privacyVersion}/index.html`,
    "legal/website-terms/index.html",
    `legal/website-terms/versions/${release.websiteTermsVersion}/index.html`,
    "legal/index.html",
  ];
  const artifacts = receipt.artifacts.map((artifact, index) =>
    receiptArtifact(root, artifact, ROLES[index], files[index]));
  for (const [current, versioned] of [[0, 1], [2, 3]]) {
    if (
      artifacts[current].sha256 !== artifacts[versioned].sha256
      || artifacts[current].byteCount !== artifacts[versioned].byteCount
    ) throw new Error(`joint legal V${version} current and versioned bytes differ`);
  }
  return Object.freeze({
    artifacts: Object.freeze(artifacts),
    receipt,
    receiptSha256: sha256(receiptBytes),
    root,
  });
}

export function createPagesJointLegalV4Plan({
  root = process.cwd(),
  finalizationRoot,
} = {}) {
  if (typeof finalizationRoot !== "string" || finalizationRoot.trim() === "") {
    throw new Error("Pages joint legal V4 finalization requires one explicit directory");
  }
  const absoluteRoot = path.resolve(root);
  const v3Root = path.join(absoluteRoot, ...PAGES_JOINT_LEGAL_V3_ROOT.split("/"));
  const v4Root = path.resolve(absoluteRoot, finalizationRoot);
  for (const [candidate, label] of [[v3Root, "V3"], [v4Root, "V4"]]) {
    const state = lstatSync(candidate);
    if (!state.isDirectory() || state.isSymbolicLink()) {
      throw new Error(`Pages joint legal ${label} root must be one real directory`);
    }
  }
  const v3 = validateReceipt(v3Root, {
    release: JOINT_LEGAL_V3_RELEASE,
    schema: V3_SCHEMA,
    version: 3,
  });
  const v4 = validateReceipt(v4Root, {
    documentBindings: JOINT_LEGAL_V4_DOCUMENT_IDS,
    release: JOINT_LEGAL_V4_RELEASE,
    schema: V4_SCHEMA,
    version: 4,
  });
  const publishedArtifacts = Object.freeze([
    v4.artifacts[4],
    v4.artifacts[0],
    v3.artifacts[1],
    v4.artifacts[1],
    v4.artifacts[2],
    v3.artifacts[3],
    v4.artifacts[3],
  ].sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0));
  return Object.freeze({
    publishedArtifacts,
    sourceByFile: new Map(publishedArtifacts.map((artifact) => [artifact.file, artifact.source])),
    v3,
    v4,
  });
}

export function pagesLegalV4Files(publicFiles, plan) {
  return Object.freeze([
    ...new Set([
      ...publicFiles,
      ...plan.publishedArtifacts.map(({ file }) => file),
    ]),
  ].sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
}

export function assertPagesJointLegalV4Artifact(output, plan) {
  for (const artifact of plan.publishedArtifacts) {
    const bytes = readFileSync(assertRealFile(output, artifact.file));
    if (sha256(bytes) !== artifact.sha256 || bytes.byteLength !== artifact.byteCount) {
      throw new Error(`Pages joint legal artifact mismatch: ${artifact.role}`);
    }
  }
  return true;
}
