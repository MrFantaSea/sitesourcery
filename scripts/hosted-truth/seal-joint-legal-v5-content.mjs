#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalJson } from "../../server/hosted/security.mjs";
import {
  JOINT_LEGAL_V5_CONTENT,
  assertJointLegalV5Held,
} from "./joint-legal-v5-artifacts.mjs";
import {
  createPrivacyV5RenderPlan,
  createWebsiteTermsV5RenderPlan,
  renderLegalCenterV5,
  renderPrivacyV5,
  renderWebsiteTermsV5,
} from "./joint-legal-v5-render.mjs";

export const JOINT_LEGAL_V5_APPROVAL_SCHEMA =
  "sitesourcery.hosted-joint-legal-v5-content-approval/v1";
export const JOINT_LEGAL_V5_APPROVAL_STATEMENT =
  "owner_approved_exact_joint_legal_v5_review_artifacts";
export const JOINT_LEGAL_V5_CONTENT_SEAL_SCHEMA =
  "sitesourcery.hosted-joint-legal-v5-content-seal/v1";
export const JOINT_LEGAL_V5_FINALIZATION_RELATIVE_ROOT =
  "ops/releases/final-successor-20260811/joint-legal-v5-finalization";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}

function canonicalUtc(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && new Date(Date.parse(value)).toISOString() === value;
}

function expectedIdentity(kind, role) {
  return Object.freeze({
    sha256: JOINT_LEGAL_V5_CONTENT[kind][`${role}Sha256`],
    byteCount: JOINT_LEGAL_V5_CONTENT[kind][`${role}ByteCount`],
  });
}

function exactIdentity(value, expected) {
  return exactKeys(value, ["byteCount", "sha256"])
    && value.sha256 === expected.sha256
    && value.byteCount === expected.byteCount;
}

export function validateJointLegalV5Approval(value) {
  if (
    !exactKeys(value, [
      "approvedAt", "approvalReference", "artifacts", "schema", "statement",
    ])
    || value.schema !== JOINT_LEGAL_V5_APPROVAL_SCHEMA
    || value.statement !== JOINT_LEGAL_V5_APPROVAL_STATEMENT
    || !canonicalUtc(value.approvedAt)
    || typeof value.approvalReference !== "string"
    || value.approvalReference.trim() === ""
    || !exactKeys(value.artifacts, ["center", "privacy", "websiteTerms"])
  ) throw new Error("joint legal V5 content approval is invalid");
  for (const kind of ["center", "privacy", "websiteTerms"]) {
    if (!exactIdentity(value.artifacts[kind], expectedIdentity(kind, "review"))) {
      throw new Error(
        `joint legal V5 ${kind} approval does not bind exact review bytes`,
      );
    }
  }
  return Object.freeze({
    ...value,
    artifacts: Object.freeze(Object.fromEntries(
      Object.entries(value.artifacts).map(([kind, identity]) =>
        [kind, Object.freeze({ ...identity })]),
    )),
  });
}

export function validateJointLegalV5ContentSeal(value) {
  if (
    !exactKeys(value, [
      "approval", "approvalSha256", "artifacts", "contentSealSha256",
      "deployable", "published", "release", "releaseFinalizationRequired",
      "schema", "state",
    ])
    || value.schema !== JOINT_LEGAL_V5_CONTENT_SEAL_SCHEMA
    || value.state !== "content-approved-release-held"
    || value.published !== false
    || value.deployable !== false
    || value.releaseFinalizationRequired !== true
    || !exactKeys(value.artifacts, ["center", "privacy", "websiteTerms"])
  ) throw new Error("joint legal V5 content seal is invalid or release-ambiguous");
  const approval = validateJointLegalV5Approval(value.approval);
  if (value.approvalSha256 !== digest(canonicalJson(approval))) {
    throw new Error("joint legal V5 approval digest changed");
  }
  for (const kind of ["center", "privacy", "websiteTerms"]) {
    const artifact = value.artifacts[kind];
    if (
      !exactKeys(artifact, ["review", "template"])
      || !exactIdentity(artifact.review, expectedIdentity(kind, "review"))
      || !exactIdentity(artifact.template, expectedIdentity(kind, "template"))
    ) throw new Error(`joint legal V5 ${kind} seal binding changed`);
  }
  if (
    !exactKeys(value.release, [
      "authorityDigest", "effectiveAt", "privacyArtifactUri",
      "privacyByteCount", "privacySha256", "privacyVersion",
      "websiteTermsArtifactUri", "websiteTermsByteCount",
      "websiteTermsSha256", "websiteTermsVersion",
    ])
    || Object.values(value.release).some((field) => field !== null)
  ) throw new Error("joint legal V5 content seal contains release constants");
  const { contentSealSha256, ...body } = value;
  if (contentSealSha256 !== digest(canonicalJson(body))) {
    throw new Error("joint legal V5 content seal digest changed");
  }
  return Object.freeze({ ...value, approval });
}

async function readRegularJson(file, label) {
  const state = await lstat(file);
  if (!state.isFile() || state.isSymbolicLink()) {
    throw new Error(`${label} must be one regular unaliased file`);
  }
  return JSON.parse(await readFile(file, "utf8"));
}

export async function readJointLegalV5ContentSeal(file) {
  return validateJointLegalV5ContentSeal(
    await readRegularJson(path.resolve(file), "joint legal V5 content seal"),
  );
}

function renderedTemplates(root) {
  const privacyPlan = createPrivacyV5RenderPlan({ mode: "content-template" });
  const termsPlan = createWebsiteTermsV5RenderPlan({ mode: "content-template" });
  return Object.freeze({
    center: Buffer.from(renderLegalCenterV5({
      root,
      privacyPlan,
      termsPlan,
    })),
    privacy: Buffer.from(renderPrivacyV5({ root, plan: privacyPlan })),
    websiteTerms: Buffer.from(renderWebsiteTermsV5({
      root,
      plan: termsPlan,
    })),
  });
}

export async function sealJointLegalV5Content({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  outputRoot,
  approval,
  approvalFile,
} = {}) {
  assertJointLegalV5Held();
  if ((approval === undefined) === (approvalFile === undefined)) {
    throw new Error("joint legal V5 content seal requires exactly one approval source");
  }
  const absoluteRoot = path.resolve(root);
  const expectedOutput = path.join(
    absoluteRoot,
    JOINT_LEGAL_V5_FINALIZATION_RELATIVE_ROOT,
  );
  const absoluteOutput = path.resolve(outputRoot ?? expectedOutput);
  if (absoluteOutput !== expectedOutput) {
    throw new Error(`joint legal V5 content seal output must be ${expectedOutput}`);
  }
  try {
    await lstat(absoluteOutput);
    throw new Error("joint legal V5 finalization directory already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const supplied = approvalFile === undefined
    ? approval
    : await readRegularJson(
      path.resolve(approvalFile),
      "joint legal V5 content approval",
    );
  const validatedApproval = validateJointLegalV5Approval(supplied);
  const templates = renderedTemplates(absoluteRoot);
  const artifacts = {};
  for (const kind of ["center", "privacy", "websiteTerms"]) {
    const expected = expectedIdentity(kind, "template");
    if (
      digest(templates[kind]) !== expected.sha256
      || templates[kind].byteLength !== expected.byteCount
    ) throw new Error(`joint legal V5 ${kind} content template changed`);
    artifacts[kind] = Object.freeze({
      review: expectedIdentity(kind, "review"),
      template: expected,
    });
  }
  const body = Object.freeze({
    schema: JOINT_LEGAL_V5_CONTENT_SEAL_SCHEMA,
    state: "content-approved-release-held",
    published: false,
    deployable: false,
    releaseFinalizationRequired: true,
    approval: validatedApproval,
    approvalSha256: digest(canonicalJson(validatedApproval)),
    artifacts: Object.freeze(artifacts),
    release: Object.freeze({
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
    }),
  });
  const receipt = Object.freeze({
    ...body,
    contentSealSha256: digest(canonicalJson(body)),
  });
  validateJointLegalV5ContentSeal(receipt);
  await mkdir(absoluteOutput, { recursive: true });
  try {
    await writeFile(
      path.join(absoluteOutput, "joint-legal-v5-content-seal.json"),
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
    if (!['--approval', '--output'].includes(argument)) {
      throw new Error(`unknown joint legal V5 content-seal argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    options[argument === "--output" ? "outputRoot" : "approvalFile"] = value;
    index += 1;
  }
  return options;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  sealJointLegalV5Content(parseCli(process.argv.slice(2)))
    .then(({ outputRoot }) => console.log(outputRoot))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
