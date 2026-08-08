#!/usr/bin/env node

import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildHostedArtifact } from "../build-hosted.mjs";
import { canonicalJson, digest } from "../../server/hosted/security.mjs";
import {
  assertPrivacyV3CandidateSources,
  assertPrivacyV3Unsealed,
  HOSTED_PRIVACY_V3_CANDIDATE,
} from "./legal-artifacts.mjs";
import {
  createPrivacyV3RenderPlan,
  PRIVACY_V3_ACCEPTANCE_STATEMENT,
  PRIVACY_V3_AUTHORITY_SCHEMA,
  PRIVACY_V3_OWNER_APPROVAL,
} from "./privacy-v3-render.mjs";

const PRODUCT_WEBSITE_VERSION =
  "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2";
const PRODUCT_WEBSITE_DIGEST =
  "bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196";
const PRODUCT_WEBSITE_EFFECTIVE_AT = "2026-07-30T00:00:00.000Z";
const CURRENT_URI = "https://sitesourcery.com/legal/privacy/";

function sha256(value) {
  return digest(value);
}

export { canonicalJson };

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
  throw new Error(`privacy V3 finalization output already exists: ${outputRoot}`);
}

export async function finalizePrivacyV3({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  outputRoot,
  version,
  effectiveAt,
  ownerApproval,
} = {}) {
  assertPrivacyV3Unsealed();
  assertPrivacyV3CandidateSources({ root });
  if (typeof outputRoot !== "string" || outputRoot === "") {
    throw new Error("privacy V3 finalization requires a new explicit output directory");
  }
  const plan = createPrivacyV3RenderPlan({
    mode: "final",
    version,
    effectiveAt,
    ownerApproval,
  });
  const absoluteRoot = path.resolve(root);
  const absoluteOutput = path.resolve(outputRoot);
  if (absoluteOutput === absoluteRoot || isInside(absoluteRoot, absoluteOutput)) {
    throw new Error("privacy V3 finalization output must remain outside the repository");
  }
  await assertOutputDoesNotExist(absoluteOutput);
  await mkdir(absoluteOutput, { recursive: false });

  const hostedRoot = path.join(absoluteOutput, "hosted");
  const currentFile = `hosted/${HOSTED_PRIVACY_V3_CANDIDATE.currentFile}`;
  const versionedFile = `hosted/${plan.versionedFile}`;
  const renderOptions = {
    mode: "final",
    version,
    effectiveAt,
    ownerApproval,
  };
  try {
    await buildHostedArtifact({
      root: absoluteRoot,
      output: hostedRoot,
      privacyV3Render: renderOptions,
    });
    const [currentBytes, versionedBytes] = await Promise.all([
      readFile(path.join(absoluteOutput, currentFile)),
      readFile(path.join(absoluteOutput, versionedFile)),
    ]);
    if (!currentBytes.equals(versionedBytes)) {
      throw new Error("privacy V3 final current and versioned bytes are not identical");
    }
    const contentDigest = sha256(currentBytes);
    const byteCount = currentBytes.byteLength;
    const artifactUri = `https://sitesourcery.com/legal/privacy/versions/${version}/`;
    const documents = Object.freeze([
      Object.freeze({
        kind: "privacy",
        version,
        contentDigest,
        contentUri: artifactUri,
        effectiveAt,
      }),
      Object.freeze({
        kind: "product",
        version: PRODUCT_WEBSITE_VERSION,
        contentDigest: PRODUCT_WEBSITE_DIGEST,
        contentUri:
          "https://sitesourcery.com/legal/website-terms/#self-service",
        effectiveAt: PRODUCT_WEBSITE_EFFECTIVE_AT,
      }),
      Object.freeze({
        kind: "website",
        version: PRODUCT_WEBSITE_VERSION,
        contentDigest: PRODUCT_WEBSITE_DIGEST,
        contentUri: "https://sitesourcery.com/legal/website-terms/",
        effectiveAt: PRODUCT_WEBSITE_EFFECTIVE_AT,
      }),
    ]);
    const authorityDigest = sha256(canonicalJson({
      documents,
      schema: PRIVACY_V3_AUTHORITY_SCHEMA,
    }));
    const receipt = Object.freeze({
      schema: "sitesourcery.hosted-privacy-v3-finalization/v1",
      state: "owner-approved-finalization",
      sealable: true,
      published: false,
      integrationRequired: true,
      renderPath: "real-hosted-builder",
      documentId: "00000000-0000-4000-8000-000000000048",
      kind: "privacy",
      version,
      effectiveAt,
      currentUri: CURRENT_URI,
      contentUri: artifactUri,
      artifactUri,
      fullPageSha256: contentDigest,
      byteCount,
      mediaType: "text/html; charset=utf-8",
      authoritySchema: PRIVACY_V3_AUTHORITY_SCHEMA,
      acceptanceStatement: PRIVACY_V3_ACCEPTANCE_STATEMENT,
      authorityDigest,
      documents,
      artifacts: Object.freeze([
        Object.freeze({ role: "current", file: currentFile, sha256: contentDigest, byteCount }),
        Object.freeze({ role: "versioned", file: versionedFile, sha256: contentDigest, byteCount }),
      ]),
      environment: Object.freeze({
        SITESOURCERY_HOSTED_PRIVACY_V3_VERSION: version,
        SITESOURCERY_HOSTED_PRIVACY_V3_SHA256: contentDigest,
        SITESOURCERY_HOSTED_PRIVACY_V3_URI: artifactUri,
        SITESOURCERY_HOSTED_PRIVACY_V3_EFFECTIVE_AT: effectiveAt,
        SITESOURCERY_HOSTED_PRIVACY_V3_BYTE_COUNT: String(byteCount),
        SITESOURCERY_HOSTED_PRIVACY_V3_ARTIFACT_URI: artifactUri,
        SITESOURCERY_HOSTED_PRIVACY_V3_AUTHORITY_SHA256: authorityDigest,
      }),
      cutoverPolicy: Object.freeze({
        existingV2ProjectReacceptanceRequired: false,
        projectCreationWriteHoldRequired: true,
        existingReadsAndCustomerRecoveryRemainAvailable: true,
      }),
    });
    await writeFile(
      path.join(absoluteOutput, "privacy-v3-release-constants.json"),
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
    if (argument === "--owner-approved") {
      if (options.ownerApproval) throw new Error("--owner-approved was supplied twice");
      options.ownerApproval = PRIVACY_V3_OWNER_APPROVAL;
      continue;
    }
    if (!["--output", "--version", "--effective-at"].includes(argument)) {
      throw new Error(`unknown privacy V3 finalizer argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    const key = argument === "--output"
      ? "outputRoot"
      : argument === "--effective-at"
        ? "effectiveAt"
        : "version";
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
  finalizePrivacyV3(parseCli(process.argv.slice(2)))
    .then(({ outputRoot: renderedRoot }) => console.log(renderedRoot))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
