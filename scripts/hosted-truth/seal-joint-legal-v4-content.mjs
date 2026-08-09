#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalJson } from "../../server/hosted/security.mjs";
import {
  JOINT_LEGAL_V4_CONTENT,
  assertJointLegalV4Held,
} from "./joint-legal-v4-artifacts.mjs";
import {
  createPrivacyV4RenderPlan,
  createWebsiteTermsV4RenderPlan,
  renderPrivacyV4,
  renderWebsiteTermsV4,
} from "./joint-legal-v4-render.mjs";

export const JOINT_LEGAL_V4_APPROVAL_SCHEMA =
  "sitesourcery.hosted-joint-legal-v4-content-approval/v1";
export const JOINT_LEGAL_V4_APPROVAL_STATEMENT =
  "owner_approved_exact_joint_legal_v4_review_artifacts";
export const JOINT_LEGAL_V4_CONTENT_SEAL_SCHEMA =
  "sitesourcery.hosted-joint-legal-v4-content-seal/v1";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function canonicalUtc(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && new Date(Date.parse(value)).toISOString() === value;
}

function expectedIdentity(kind, role) {
  return Object.freeze({
    sha256: JOINT_LEGAL_V4_CONTENT[kind][`${role}Sha256`],
    byteCount: JOINT_LEGAL_V4_CONTENT[kind][`${role}ByteCount`],
  });
}

export function validateJointLegalV4Approval(value) {
  if (
    !exactKeys(value, ["approvedAt", "approvalReference", "documents", "schema", "statement"])
    || value.schema !== JOINT_LEGAL_V4_APPROVAL_SCHEMA
    || value.statement !== JOINT_LEGAL_V4_APPROVAL_STATEMENT
    || !canonicalUtc(value.approvedAt)
    || typeof value.approvalReference !== "string"
    || value.approvalReference.trim() === ""
    || !exactKeys(value.documents, ["privacy", "websiteTerms"])
  ) throw new Error("joint legal V4 approval receipt is invalid");
  for (const kind of ["privacy", "websiteTerms"]) {
    if (!exactKeys(value.documents[kind], ["byteCount", "sha256"])) {
      throw new Error(`joint legal V4 ${kind} approval identity is invalid`);
    }
    const expected = expectedIdentity(kind, "review");
    if (
      value.documents[kind].sha256 !== expected.sha256
      || value.documents[kind].byteCount !== expected.byteCount
    ) throw new Error(`joint legal V4 ${kind} approval does not bind exact review bytes`);
  }
  return Object.freeze({
    ...value,
    documents: Object.freeze({
      privacy: Object.freeze({ ...value.documents.privacy }),
      websiteTerms: Object.freeze({ ...value.documents.websiteTerms }),
    }),
  });
}

export function validateJointLegalV4ContentSeal(value) {
  if (
    !exactKeys(value, [
      "approvalReceipt", "approvalReceiptSha256", "artifacts",
      "contentSealSha256", "deployable", "published", "release",
      "releaseFinalizationRequired", "schema", "state",
    ])
    || value.schema !== JOINT_LEGAL_V4_CONTENT_SEAL_SCHEMA
    || value.state !== "content-approved-release-held"
    || value.published !== false
    || value.deployable !== false
    || value.releaseFinalizationRequired !== true
    || !exactKeys(value.artifacts, ["privacy", "websiteTerms"])
  ) throw new Error("joint legal V4 content seal is invalid or release-ambiguous");
  const approval = validateJointLegalV4Approval(value.approvalReceipt);
  if (value.approvalReceiptSha256 !== digest(canonicalJson(approval))) {
    throw new Error("joint legal V4 approval receipt digest changed");
  }
  for (const kind of ["privacy", "websiteTerms"]) {
    const artifact = value.artifacts[kind];
    if (!exactKeys(artifact, ["review", "template"])) {
      throw new Error(`joint legal V4 ${kind} seal is invalid`);
    }
    for (const role of ["review", "template"]) {
      const expected = expectedIdentity(kind, role);
      if (
        !exactKeys(artifact[role], ["byteCount", "sha256"])
        || artifact[role].sha256 !== expected.sha256
        || artifact[role].byteCount !== expected.byteCount
      ) throw new Error(`joint legal V4 ${kind} ${role} binding changed`);
    }
  }
  if (
    !exactKeys(value.release, [
      "authorityDigest", "effectiveAt", "privacyArtifactUri", "privacyByteCount",
      "privacySha256", "privacyVersion", "websiteTermsArtifactUri",
      "websiteTermsByteCount", "websiteTermsSha256", "websiteTermsVersion",
    ])
    || Object.values(value.release).some((field) => field !== null)
  ) throw new Error("joint legal V4 content seal contains production release constants");
  const { contentSealSha256, ...body } = value;
  if (contentSealSha256 !== digest(canonicalJson(body))) {
    throw new Error("joint legal V4 content seal digest changed");
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

export async function readJointLegalV4ContentSeal(file) {
  return validateJointLegalV4ContentSeal(
    await readRegularJson(path.resolve(file), "joint legal V4 content seal"),
  );
}

export async function sealJointLegalV4Content({
  root = process.cwd(), outputRoot, approvalReceipt, approvalReceiptFile,
} = {}) {
  assertJointLegalV4Held();
  if (!outputRoot) throw new Error("joint legal V4 content seal requires a new output directory");
  if ((approvalReceipt === undefined) === (approvalReceiptFile === undefined)) {
    throw new Error("joint legal V4 content seal requires exactly one approval receipt source");
  }
  const absoluteRoot = path.resolve(root);
  const absoluteOutput = path.resolve(outputRoot);
  const relative = path.relative(absoluteRoot, absoluteOutput);
  if (absoluteOutput === absoluteRoot || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("joint legal V4 content seal output must remain outside the repository");
  }
  try {
    await lstat(absoluteOutput);
    throw new Error("joint legal V4 content seal output already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(absoluteOutput, { recursive: false });
  try {
    const supplied = approvalReceiptFile === undefined
      ? approvalReceipt
      : await readRegularJson(path.resolve(approvalReceiptFile), "joint legal V4 approval receipt");
    const approval = validateJointLegalV4Approval(supplied);
    const artifacts = { privacy: {}, websiteTerms: {} };
    for (const mode of ["review", "content-template"]) {
      const role = mode === "review" ? "review" : "template";
      const privacy = Buffer.from(renderPrivacyV4({
        root: absoluteRoot,
        plan: createPrivacyV4RenderPlan({ mode }),
      }));
      const websiteTerms = Buffer.from(renderWebsiteTermsV4({
        root: absoluteRoot,
        plan: createWebsiteTermsV4RenderPlan({ mode }),
      }));
      for (const [kind, bytes] of [["privacy", privacy], ["websiteTerms", websiteTerms]]) {
        const expected = expectedIdentity(kind, role);
        if (digest(bytes) !== expected.sha256 || bytes.byteLength !== expected.byteCount) {
          throw new Error(`joint legal V4 ${kind} ${role} identity changed`);
        }
        const file = path.join(absoluteOutput, role, `${kind}.html`);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, bytes);
        artifacts[kind][role] = expected;
      }
    }
    const body = Object.freeze({
      schema: JOINT_LEGAL_V4_CONTENT_SEAL_SCHEMA,
      state: "content-approved-release-held",
      published: false,
      deployable: false,
      releaseFinalizationRequired: true,
      approvalReceipt: approval,
      approvalReceiptSha256: digest(canonicalJson(approval)),
      artifacts: Object.freeze({
        privacy: Object.freeze(artifacts.privacy),
        websiteTerms: Object.freeze(artifacts.websiteTerms),
      }),
      release: Object.freeze({
        privacyVersion: null, privacySha256: null, privacyByteCount: null,
        privacyArtifactUri: null, websiteTermsVersion: null,
        websiteTermsSha256: null, websiteTermsByteCount: null,
        websiteTermsArtifactUri: null, effectiveAt: null, authorityDigest: null,
      }),
    });
    const receipt = Object.freeze({ ...body, contentSealSha256: digest(canonicalJson(body)) });
    validateJointLegalV4ContentSeal(receipt);
    await writeFile(
      path.join(absoluteOutput, "joint-legal-v4-content-seal.json"),
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
      throw new Error(`unknown joint legal V4 content-seal argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    options[argument === "--output" ? "outputRoot" : "approvalReceiptFile"] = value;
    index += 1;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  sealJointLegalV4Content(parseCli(process.argv.slice(2)))
    .then(({ outputRoot }) => console.log(outputRoot))
    .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
