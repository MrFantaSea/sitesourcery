#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && relative !== ".."
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function assertNewOutput(output) {
  try {
    await lstat(output);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`joint legal V4 review output already exists: ${output}`);
}

export async function renderJointLegalV4Review({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  outputRoot,
} = {}) {
  assertJointLegalV4Held();
  if (!outputRoot) throw new Error("joint legal V4 review requires a new output directory");
  const absoluteRoot = path.resolve(root);
  const absoluteOutput = path.resolve(outputRoot);
  if (absoluteOutput === absoluteRoot || isInside(absoluteRoot, absoluteOutput)) {
    throw new Error("joint legal V4 review output must remain outside the repository");
  }
  await assertNewOutput(absoluteOutput);
  await mkdir(absoluteOutput, { recursive: false });
  try {
    const plans = Object.freeze({
      privacy: createPrivacyV4RenderPlan({ mode: "review" }),
      websiteTerms: createWebsiteTermsV4RenderPlan({ mode: "review" }),
    });
    const bytes = Object.freeze({
      privacy: Buffer.from(renderPrivacyV4({ root: absoluteRoot, plan: plans.privacy })),
      websiteTerms: Buffer.from(renderWebsiteTermsV4({
        root: absoluteRoot,
        plan: plans.websiteTerms,
      })),
    });
    const files = Object.freeze({
      privacy: "hosted/legal/privacy/index.html",
      websiteTerms: "hosted/legal/website-terms/index.html",
    });
    for (const kind of ["privacy", "websiteTerms"]) {
      const expected = JOINT_LEGAL_V4_CONTENT[kind];
      if (
        digest(bytes[kind]) !== expected.reviewSha256
        || bytes[kind].byteLength !== expected.reviewByteCount
      ) throw new Error(`joint legal V4 ${kind} review identity changed`);
      const current = path.join(absoluteOutput, files[kind]);
      const versioned = path.join(
        absoluteOutput,
        "hosted",
        plans[kind].versionedFile,
      );
      await mkdir(path.dirname(current), { recursive: true });
      await mkdir(path.dirname(versioned), { recursive: true });
      await Promise.all([writeFile(current, bytes[kind]), writeFile(versioned, bytes[kind])]);
    }
    const receipt = Object.freeze({
      schema: "sitesourcery.hosted-joint-legal-v4-review/v1",
      state: "content-approved-release-held",
      published: false,
      deployable: false,
      release: null,
      artifacts: Object.freeze({
        privacy: Object.freeze({
          file: files.privacy,
          versionedFile: `hosted/${plans.privacy.versionedFile}`,
          sha256: digest(bytes.privacy),
          byteCount: bytes.privacy.byteLength,
        }),
        websiteTerms: Object.freeze({
          file: files.websiteTerms,
          versionedFile: `hosted/${plans.websiteTerms.versionedFile}`,
          sha256: digest(bytes.websiteTerms),
          byteCount: bytes.websiteTerms.byteLength,
        }),
      }),
    });
    await writeFile(
      path.join(absoluteOutput, "joint-legal-v4-review.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
    return Object.freeze({ outputRoot: absoluteOutput, receipt });
  } catch (error) {
    await rm(absoluteOutput, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  renderJointLegalV4Review({ outputRoot: process.argv[2] })
    .then(({ outputRoot }) => console.log(outputRoot))
    .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
