#!/usr/bin/env node

import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildHostedArtifact } from "../build-hosted.mjs";
import { canonicalJson, digest } from "../../server/hosted/security.mjs";
import {
  assertLegalArtifactRelativePath,
  assertPrivacyV3CandidateSources,
  assertPrivacyV3ContentInputs,
  assertPrivacyV3Unsealed,
  HOSTED_PRIVACY_V3_CANDIDATE,
  HOSTED_PRIVACY_V3_CONTENT,
} from "./legal-artifacts.mjs";
import {
  PRIVACY_V3_CONTENT_TEMPLATE_EFFECTIVE_LABEL_TOKEN,
  PRIVACY_V3_CONTENT_TEMPLATE_VERSION_TOKEN,
  createPrivacyV3RenderPlan,
} from "./privacy-v3-render.mjs";
import { renderPrivacyV3Review } from "./render-privacy-v3-review.mjs";

export const PRIVACY_V3_CONTENT_APPROVAL_SCHEMA =
  "sitesourcery.hosted-privacy-v3-content-approval/v1";
export const PRIVACY_V3_CONTENT_APPROVAL_STATEMENT =
  "owner_approved_exact_privacy_v3_review_artifact";
export const PRIVACY_V3_CONTENT_SEAL_SCHEMA =
  "sitesourcery.hosted-privacy-v3-content-seal/v1";

const MEDIA_TYPE = "text/html; charset=utf-8";

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function exactKeys(value, keys) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function exactCanonicalUtc(value) {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === value;
}

async function assertOutputDoesNotExist(outputRoot) {
  try {
    await lstat(outputRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`privacy V3 content-seal output already exists: ${outputRoot}`);
}

async function readRegularJson(file, label) {
  const absolute = path.resolve(file);
  const state = await lstat(absolute);
  if (!state.isFile() || state.isSymbolicLink()) {
    throw new Error(`${label} must be a regular unaliased file`);
  }
  let value;
  try {
    value = JSON.parse(await readFile(absolute, "utf8"));
  } catch (error) {
    throw new Error(`${label} must contain valid JSON`, { cause: error });
  }
  return value;
}

export function validatePrivacyV3ContentApproval(
  value,
  {
    reviewArtifactSha256 = HOSTED_PRIVACY_V3_CONTENT.reviewArtifactSha256,
    reviewArtifactByteCount = HOSTED_PRIVACY_V3_CONTENT.reviewArtifactByteCount,
  } = {},
) {
  if (
    !exactKeys(value, [
      "approvalReference",
      "approvedAt",
      "reviewArtifactByteCount",
      "reviewArtifactSha256",
      "schema",
      "statement",
    ])
    || value.schema !== PRIVACY_V3_CONTENT_APPROVAL_SCHEMA
    || value.statement !== PRIVACY_V3_CONTENT_APPROVAL_STATEMENT
    || typeof value.approvalReference !== "string"
    || value.approvalReference.trim() === ""
    || !exactCanonicalUtc(value.approvedAt)
    || value.reviewArtifactSha256 !== reviewArtifactSha256
    || value.reviewArtifactByteCount !== reviewArtifactByteCount
  ) {
    throw new Error(
      "privacy V3 content approval must bind exact owner approval to the exact review artifact",
    );
  }
  return Object.freeze({ ...value });
}

function validateArtifactBinding(value, expected, label) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    assertLegalArtifactRelativePath(value.file);
    assertLegalArtifactRelativePath(value.versionedFile);
  }
  if (
    !exactKeys(value, ["byteCount", "file", "mediaType", "sha256", "versionedFile"])
    || typeof value.file !== "string"
    || value.file === ""
    || typeof value.versionedFile !== "string"
    || value.versionedFile === ""
    || value.file !== expected.file
    || value.versionedFile !== expected.versionedFile
    || value.mediaType !== MEDIA_TYPE
    || value.sha256 !== expected.sha256
    || value.byteCount !== expected.byteCount
  ) {
    throw new Error(`privacy V3 ${label} binding is invalid`);
  }
}

export function validatePrivacyV3ContentSeal(value) {
  if (
    !exactKeys(value, [
      "approvalReceipt",
      "approvalReceiptSha256",
      "contentSealSha256",
      "contentTemplate",
      "deployable",
      "published",
      "release",
      "releaseFinalizationRequired",
      "renderPath",
      "reviewArtifact",
      "schema",
      "state",
    ])
    || value.schema !== PRIVACY_V3_CONTENT_SEAL_SCHEMA
    || value.state !== "content-approved-unreleased"
    || value.published !== false
    || value.deployable !== false
    || value.releaseFinalizationRequired !== true
    || value.renderPath !== "real-hosted-builder"
  ) {
    throw new Error("privacy V3 content seal is invalid or release-ambiguous");
  }
  const reviewPlan = createPrivacyV3RenderPlan({ mode: "review" });
  const templatePlan = createPrivacyV3RenderPlan({ mode: "content-template" });
  validateArtifactBinding(value.reviewArtifact, {
    file: `review/hosted/${HOSTED_PRIVACY_V3_CANDIDATE.currentFile}`,
    versionedFile: `review/hosted/${reviewPlan.versionedFile}`,
    sha256: HOSTED_PRIVACY_V3_CONTENT.reviewArtifactSha256,
    byteCount: HOSTED_PRIVACY_V3_CONTENT.reviewArtifactByteCount,
  }, "review artifact");
  validateArtifactBinding(value.contentTemplate, {
    file: `template-hosted/${HOSTED_PRIVACY_V3_CANDIDATE.currentFile}`,
    versionedFile: `template-hosted/${templatePlan.versionedFile}`,
    sha256: HOSTED_PRIVACY_V3_CONTENT.contentTemplateSha256,
    byteCount: HOSTED_PRIVACY_V3_CONTENT.contentTemplateByteCount,
  }, "content template");
  const approval = validatePrivacyV3ContentApproval(value.approvalReceipt);
  if (value.approvalReceiptSha256 !== digest(canonicalJson(approval))) {
    throw new Error("privacy V3 content approval receipt digest changed");
  }
  if (
    !exactKeys(value.release, [
      "artifactUri",
      "authorityDigest",
      "byteCount",
      "effectiveAt",
      "fullPageSha256",
      "version",
    ])
    || Object.values(value.release).some((field) => field !== null)
  ) {
    throw new Error("privacy V3 content seal must contain no release constants");
  }
  const { contentSealSha256, ...body } = value;
  if (contentSealSha256 !== digest(canonicalJson(body))) {
    throw new Error("privacy V3 content seal digest changed");
  }
  return Object.freeze({
    ...value,
    reviewArtifact: Object.freeze({ ...value.reviewArtifact }),
    contentTemplate: Object.freeze({ ...value.contentTemplate }),
    approvalReceipt: approval,
    release: Object.freeze({ ...value.release }),
  });
}

export async function readPrivacyV3ContentSeal(file) {
  return validatePrivacyV3ContentSeal(
    await readRegularJson(file, "privacy V3 content seal"),
  );
}

export async function sealPrivacyV3Content({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  outputRoot,
  approvalReceipt,
  approvalReceiptFile,
} = {}) {
  assertPrivacyV3Unsealed();
  assertPrivacyV3CandidateSources({ root });
  if (typeof outputRoot !== "string" || outputRoot === "") {
    throw new Error("privacy V3 content seal requires a new explicit output directory");
  }
  if ((approvalReceipt === undefined) === (approvalReceiptFile === undefined)) {
    throw new Error("privacy V3 content seal requires exactly one approval receipt source");
  }
  const absoluteRoot = path.resolve(root);
  const absoluteOutput = path.resolve(outputRoot);
  if (absoluteOutput === absoluteRoot || isInside(absoluteRoot, absoluteOutput)) {
    throw new Error("privacy V3 content-seal output must remain outside the repository");
  }
  await assertOutputDoesNotExist(absoluteOutput);
  await mkdir(absoluteOutput, { recursive: false });

  try {
    const review = await renderPrivacyV3Review({
      root: absoluteRoot,
      outputRoot: path.join(absoluteOutput, "review"),
    });
    const reviewBytes = await readFile(
      path.join(absoluteOutput, "review", review.receipt.currentFile),
    );
    assertPrivacyV3ContentInputs({ reviewBytes });
    const suppliedApproval = approvalReceiptFile === undefined
      ? approvalReceipt
      : await readRegularJson(
        approvalReceiptFile,
        "privacy V3 content approval receipt",
      );
    const approval = validatePrivacyV3ContentApproval(suppliedApproval, {
      reviewArtifactSha256: digest(reviewBytes),
      reviewArtifactByteCount: reviewBytes.byteLength,
    });

    const templateOutput = path.join(absoluteOutput, "template-hosted");
    await buildHostedArtifact({
      root: absoluteRoot,
      output: templateOutput,
      privacyV3Render: { mode: "content-template" },
    });
    const templatePlan = createPrivacyV3RenderPlan({ mode: "content-template" });
    const templateCurrentFile = path.join(
      templateOutput,
      HOSTED_PRIVACY_V3_CANDIDATE.currentFile,
    );
    const templateVersionedFile = path.join(
      templateOutput,
      templatePlan.versionedFile,
    );
    const [templateBytes, templateVersionedBytes] = await Promise.all([
      readFile(templateCurrentFile),
      readFile(templateVersionedFile),
    ]);
    if (!templateBytes.equals(templateVersionedBytes)) {
      throw new Error("privacy V3 content-template current and versioned bytes differ");
    }
    assertPrivacyV3ContentInputs({ contentTemplateBytes: templateBytes });

    const approvalReceiptSha256 = digest(canonicalJson(approval));
    const body = Object.freeze({
      schema: PRIVACY_V3_CONTENT_SEAL_SCHEMA,
      state: "content-approved-unreleased",
      published: false,
      deployable: false,
      releaseFinalizationRequired: true,
      renderPath: "real-hosted-builder",
      reviewArtifact: Object.freeze({
        file: `review/${review.receipt.currentFile}`,
        versionedFile: `review/${review.receipt.versionedFile}`,
        sha256: digest(reviewBytes),
        byteCount: reviewBytes.byteLength,
        mediaType: MEDIA_TYPE,
      }),
      contentTemplate: Object.freeze({
        file: `template-hosted/${HOSTED_PRIVACY_V3_CANDIDATE.currentFile}`,
        versionedFile: `template-hosted/${templatePlan.versionedFile}`,
        sha256: digest(templateBytes),
        byteCount: templateBytes.byteLength,
        mediaType: MEDIA_TYPE,
      }),
      approvalReceipt: approval,
      approvalReceiptSha256,
      release: Object.freeze({
        version: null,
        effectiveAt: null,
        fullPageSha256: null,
        byteCount: null,
        artifactUri: null,
        authorityDigest: null,
      }),
    });
    const receipt = Object.freeze({
      ...body,
      contentSealSha256: digest(canonicalJson(body)),
    });
    validatePrivacyV3ContentSeal(receipt);
    await writeFile(
      path.join(absoluteOutput, "privacy-v3-content-seal.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
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
      throw new Error(`unknown privacy V3 content-seal argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    const key = argument === "--output" ? "outputRoot" : "approvalReceiptFile";
    if (options[key]) throw new Error(`${argument} was supplied twice`);
    options[key] = value;
    index += 1;
  }
  return options;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  sealPrivacyV3Content(parseCli(process.argv.slice(2)))
    .then(({ outputRoot: sealedRoot }) => console.log(sealedRoot))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}

export const PRIVACY_V3_CONTENT_TEMPLATE_TOKENS = Object.freeze({
  effectiveLabel: PRIVACY_V3_CONTENT_TEMPLATE_EFFECTIVE_LABEL_TOKEN,
  version: PRIVACY_V3_CONTENT_TEMPLATE_VERSION_TOKEN,
});
