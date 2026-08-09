#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildHostedArtifact } from "../build-hosted.mjs";
import { canonicalJson } from "../../server/hosted/security.mjs";
import {
  assertJointLegalV3Unsealed,
  JOINT_LEGAL_V3_CONTENT,
} from "./joint-legal-v3-artifacts.mjs";
import {
  createWebsiteTermsV3RenderPlan,
  reconcilePrivacyV3ForGoLive,
  renderWebsiteTermsV3,
} from "./joint-legal-v3-render.mjs";

export const JOINT_LEGAL_V3_APPROVAL_SCHEMA =
  "sitesourcery.hosted-joint-legal-v3-content-approval/v1";
export const JOINT_LEGAL_V3_APPROVAL_STATEMENT =
  "owner_delegated_approval_of_exact_joint_legal_v3_review_artifacts";
export const JOINT_LEGAL_V3_CONTENT_SEAL_SCHEMA =
  "sitesourcery.hosted-joint-legal-v3-content-seal/v1";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function exactCanonicalUtc(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && new Date(Date.parse(value)).toISOString() === value;
}

function assertIdentity(bytes, expected, label) {
  if (bytes.byteLength !== expected.byteCount || digest(bytes) !== expected.sha256) {
    throw new Error(`joint legal V3 ${label} identity changed without review`);
  }
}

function expectedIdentity(kind, role) {
  const source = JOINT_LEGAL_V3_CONTENT[kind];
  return Object.freeze({
    sha256: source[`${role}Sha256`],
    byteCount: source[`${role}ByteCount`],
  });
}

export function validateJointLegalV3Approval(value) {
  if (
    !exactKeys(value, ["approvedAt", "approvalReference", "documents", "schema", "statement"])
    || value.schema !== JOINT_LEGAL_V3_APPROVAL_SCHEMA
    || value.statement !== JOINT_LEGAL_V3_APPROVAL_STATEMENT
    || typeof value.approvalReference !== "string"
    || value.approvalReference.trim() === ""
    || !exactCanonicalUtc(value.approvedAt)
    || !exactKeys(value.documents, ["privacy", "websiteTerms"])
    || !exactKeys(value.documents.privacy, ["byteCount", "sha256"])
    || !exactKeys(value.documents.websiteTerms, ["byteCount", "sha256"])
  ) throw new Error("joint legal V3 approval receipt is invalid");
  for (const kind of ["privacy", "websiteTerms"]) {
    const expected = expectedIdentity(kind, "review");
    if (
      value.documents[kind].sha256 !== expected.sha256
      || value.documents[kind].byteCount !== expected.byteCount
    ) throw new Error(`joint legal V3 ${kind} approval does not bind exact review bytes`);
  }
  return Object.freeze({
    ...value,
    documents: Object.freeze({
      privacy: Object.freeze({ ...value.documents.privacy }),
      websiteTerms: Object.freeze({ ...value.documents.websiteTerms }),
    }),
  });
}

export function validateJointLegalV3ContentSeal(value) {
  if (
    !exactKeys(value, [
      "approvalReceipt", "approvalReceiptSha256", "artifacts", "contentSealSha256",
      "deployable", "published", "release", "releaseFinalizationRequired",
      "schema", "state",
    ])
    || value.schema !== JOINT_LEGAL_V3_CONTENT_SEAL_SCHEMA
    || value.state !== "content-approved-unreleased"
    || value.published !== false
    || value.deployable !== false
    || value.releaseFinalizationRequired !== true
    || !exactKeys(value.artifacts, ["privacy", "websiteTerms"])
  ) throw new Error("joint legal V3 content seal is invalid or release-ambiguous");
  const approval = validateJointLegalV3Approval(value.approvalReceipt);
  if (value.approvalReceiptSha256 !== digest(canonicalJson(approval))) {
    throw new Error("joint legal V3 approval receipt digest changed");
  }
  for (const kind of ["privacy", "websiteTerms"]) {
    const artifact = value.artifacts[kind];
    const expectedReview = expectedIdentity(kind, "review");
    const expectedTemplate = expectedIdentity(kind, "template");
    if (
      !exactKeys(artifact, ["review", "template"])
      || !exactKeys(artifact.review, ["byteCount", "sha256"])
      || !exactKeys(artifact.template, ["byteCount", "sha256"])
      || artifact.review.sha256 !== expectedReview.sha256
      || artifact.review.byteCount !== expectedReview.byteCount
      || artifact.template.sha256 !== expectedTemplate.sha256
      || artifact.template.byteCount !== expectedTemplate.byteCount
    ) throw new Error(`joint legal V3 ${kind} content binding changed`);
  }
  if (
    !exactKeys(value.release, [
      "authorityDigest", "effectiveAt", "privacyArtifactUri", "privacyByteCount",
      "privacySha256", "privacyVersion", "websiteTermsArtifactUri",
      "websiteTermsByteCount", "websiteTermsSha256", "websiteTermsVersion",
    ])
    || Object.values(value.release).some((field) => field !== null)
  ) throw new Error("joint legal V3 content seal contains release constants");
  const { contentSealSha256, ...body } = value;
  if (contentSealSha256 !== digest(canonicalJson(body))) {
    throw new Error("joint legal V3 content seal digest changed");
  }
  return Object.freeze({ ...value, approvalReceipt: approval });
}

async function readRegularJson(file, label) {
  const state = await lstat(file);
  if (!state.isFile() || state.isSymbolicLink()) {
    throw new Error(`${label} must be a regular unaliased file`);
  }
  return JSON.parse(await readFile(file, "utf8"));
}

export async function readJointLegalV3ContentSeal(file) {
  return validateJointLegalV3ContentSeal(
    await readRegularJson(path.resolve(file), "joint legal V3 content seal"),
  );
}

export async function sealJointLegalV3Content({
  root = process.cwd(), outputRoot, approvalReceipt, approvalReceiptFile,
} = {}) {
  assertJointLegalV3Unsealed();
  if (!outputRoot) throw new Error("joint legal V3 content seal requires a new output directory");
  if ((approvalReceipt === undefined) === (approvalReceiptFile === undefined)) {
    throw new Error("joint legal V3 content seal requires exactly one approval receipt source");
  }
  const absoluteRoot = path.resolve(root);
  const absoluteOutput = path.resolve(outputRoot);
  const relative = path.relative(absoluteRoot, absoluteOutput);
  if (absoluteOutput === absoluteRoot || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("joint legal V3 content seal output must remain outside the repository");
  }
  try {
    await lstat(absoluteOutput);
    throw new Error("joint legal V3 content seal output already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(absoluteOutput, { recursive: false });
  try {
    const supplied = approvalReceiptFile === undefined
      ? approvalReceipt
      : await readRegularJson(path.resolve(approvalReceiptFile), "joint legal V3 approval receipt");
    const approval = validateJointLegalV3Approval(supplied);
    const artifacts = {};
    for (const mode of ["review", "content-template"]) {
      const hostedRoot = path.join(absoluteOutput, `hosted-${mode}`);
      await buildHostedArtifact({ root: absoluteRoot, output: hostedRoot, privacyV3Render: { mode } });
      const privacyFile = path.join(hostedRoot, "legal/privacy/index.html");
      const privacy = Buffer.from(reconcilePrivacyV3ForGoLive(await readFile(privacyFile, "utf8")));
      await writeFile(privacyFile, privacy);
      const terms = Buffer.from(renderWebsiteTermsV3({
        root: absoluteRoot,
        plan: createWebsiteTermsV3RenderPlan({ mode }),
      }));
      await writeFile(path.join(hostedRoot, "legal/website-terms/index.html"), terms);
      for (const [kind, bytes] of [["privacy", privacy], ["websiteTerms", terms]]) {
        const role = mode === "review" ? "review" : "template";
        const expected = expectedIdentity(kind, role);
        assertIdentity(bytes, expected, `${kind} ${role}`);
        artifacts[kind] ??= {};
        artifacts[kind][role] = Object.freeze({ sha256: digest(bytes), byteCount: bytes.byteLength });
      }
    }
    const approvalReceiptSha256 = digest(canonicalJson(approval));
    const body = Object.freeze({
      schema: JOINT_LEGAL_V3_CONTENT_SEAL_SCHEMA,
      state: "content-approved-unreleased",
      published: false,
      deployable: false,
      releaseFinalizationRequired: true,
      approvalReceipt: approval,
      approvalReceiptSha256,
      artifacts: Object.freeze({
        privacy: Object.freeze(artifacts.privacy),
        websiteTerms: Object.freeze(artifacts.websiteTerms),
      }),
      release: Object.freeze({
        privacyVersion: null, privacySha256: null, privacyByteCount: null,
        privacyArtifactUri: null, websiteTermsVersion: null, websiteTermsSha256: null,
        websiteTermsByteCount: null, websiteTermsArtifactUri: null,
        effectiveAt: null, authorityDigest: null,
      }),
    });
    const receipt = Object.freeze({ ...body, contentSealSha256: digest(canonicalJson(body)) });
    validateJointLegalV3ContentSeal(receipt);
    await writeFile(
      path.join(absoluteOutput, "joint-legal-v3-content-seal.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
    return Object.freeze({ outputRoot: absoluteOutput, receipt });
  } catch (error) {
    await rm(absoluteOutput, { recursive: true, force: true });
    throw error;
  }
}

function parseCli(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--approval-receipt", "--output"].includes(argument)) {
      throw new Error(`unknown joint legal V3 content-seal argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    options[argument === "--output" ? "outputRoot" : "approvalReceiptFile"] = value;
    index += 1;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  sealJointLegalV3Content(parseCli(process.argv.slice(2)))
    .then(({ outputRoot }) => console.log(outputRoot))
    .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
