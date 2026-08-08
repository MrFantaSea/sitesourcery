#!/usr/bin/env node

import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildHostedArtifact } from "../build-hosted.mjs";
import { digest } from "../../server/hosted/security.mjs";
import {
  assertPrivacyV3ContentInputs,
  assertPrivacyV3CandidateSources,
  assertPrivacyV3Unsealed,
  HOSTED_PRIVACY_V3_CONTENT,
  HOSTED_PRIVACY_V3_CANDIDATE,
} from "./legal-artifacts.mjs";
import {
  createPrivacyV3RenderPlan,
  PRIVACY_V3_REVIEW_EFFECTIVE_LABEL,
  PRIVACY_V3_REVIEW_VERSION,
} from "./privacy-v3-render.mjs";

export {
  PRIVACY_V3_REVIEW_EFFECTIVE_LABEL,
  PRIVACY_V3_REVIEW_VERSION,
};

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function assertOutputDoesNotExist(outputRoot) {
  try {
    await lstat(outputRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`privacy V3 review output already exists: ${outputRoot}`);
}

export async function renderPrivacyV3Review({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  outputRoot,
} = {}) {
  assertPrivacyV3Unsealed();
  assertPrivacyV3CandidateSources({ root });
  const absoluteRoot = path.resolve(root);
  const absoluteOutput = outputRoot
    ? path.resolve(outputRoot)
    : await mkdtemp(path.join(tmpdir(), "sitesourcery-privacy-v3-hosted-review-"));
  if (absoluteOutput === absoluteRoot || isInside(absoluteRoot, absoluteOutput)) {
    throw new Error("privacy V3 review output must remain outside the repository");
  }
  if (outputRoot) {
    await assertOutputDoesNotExist(absoluteOutput);
    await mkdir(absoluteOutput, { recursive: false });
  }

  const plan = createPrivacyV3RenderPlan({ mode: "review" });
  const hostedRoot = path.join(absoluteOutput, "hosted");
  const currentFile = `hosted/${HOSTED_PRIVACY_V3_CANDIDATE.currentFile}`;
  const versionedFile = `hosted/${plan.versionedFile}`;
  try {
    await buildHostedArtifact({
      root: absoluteRoot,
      output: hostedRoot,
      privacyV3Render: { mode: "review" },
    });
    const [currentBytes, versionedBytes] = await Promise.all([
      readFile(path.join(absoluteOutput, currentFile)),
      readFile(path.join(absoluteOutput, versionedFile)),
    ]);
    if (!currentBytes.equals(versionedBytes)) {
      throw new Error("privacy V3 review current and versioned bytes are not identical");
    }
    assertPrivacyV3ContentInputs({ reviewBytes: currentBytes });
    const receipt = Object.freeze({
      schema: "sitesourcery.hosted-privacy-v3-clause-layout-review/v3",
      state: "unsealed",
      sealable: false,
      deployable: false,
      approvalState: "exact-review-artifact-approval-pending",
      renderPath: "real-hosted-builder",
      version: null,
      effectiveAt: null,
      fullPageSha256: null,
      byteCount: null,
      authorityDigest: null,
      reviewArtifactSha256: digest(currentBytes),
      reviewArtifactByteCount: currentBytes.byteLength,
      expectedReviewArtifactSha256:
        HOSTED_PRIVACY_V3_CONTENT.reviewArtifactSha256,
      expectedReviewArtifactByteCount:
        HOSTED_PRIVACY_V3_CONTENT.reviewArtifactByteCount,
      reviewLabel: PRIVACY_V3_REVIEW_VERSION,
      limitation:
        "Real hosted clause/layout review only. Exact owner approval of this review digest and byte count is required before the nondeployable content seal; owner-approved exact release values must later pass the separate finalizer before release constants exist.",
      currentFile,
      versionedFile,
    });
    await writeFile(
      path.join(absoluteOutput, "review.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );
    return Object.freeze({
      outputRoot: absoluteOutput,
      rendered: currentBytes.toString("utf8"),
      receipt,
    });
  } catch (error) {
    await rm(absoluteOutput, { recursive: true, force: true });
    throw error;
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const outputArgument = process.argv[2];
  if (process.argv.length > 3) {
    console.error("Usage: node scripts/hosted-truth/render-privacy-v3-review.mjs [new-output-directory]");
    process.exitCode = 2;
  } else {
    renderPrivacyV3Review({ outputRoot: outputArgument })
      .then(({ outputRoot: renderedRoot }) => console.log(renderedRoot))
      .catch((error) => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
      });
  }
}
