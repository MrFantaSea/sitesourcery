#!/usr/bin/env node

import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildHostedArtifact } from "../build-hosted.mjs";
import { canonicalJson, digest } from "../../server/hosted/security.mjs";
import { JOINT_LEGAL_V4_DOCUMENT_IDS } from "./joint-legal-v4-artifacts.mjs";
import {
  JOINT_LEGAL_V4_OWNER_APPROVAL,
  createPrivacyV4RenderPlan,
  createWebsiteTermsV4RenderPlan,
  normalizePrivacyV4Final,
  normalizeWebsiteTermsV4Final,
  renderLegalCenterV4,
  renderPrivacyV4,
  renderWebsiteTermsV4,
} from "./joint-legal-v4-render.mjs";
import {
  readJointLegalV4ContentSeal,
  validateJointLegalV4ContentSeal,
} from "./seal-joint-legal-v4-content.mjs";

export const JOINT_LEGAL_V4_FINALIZATION_SCHEMA =
  "sitesourcery.hosted-joint-legal-v4-finalization/v1";
export const JOINT_LEGAL_V4_AUTHORITY_SCHEMA =
  "sitesourcery.project-legal-authority/v4";
export const JOINT_LEGAL_V4_ACCEPTANCE_SCHEMA =
  "sitesourcery.project-legal-acceptance/v4";
const ACCEPTANCE_STATEMENT =
  "accepted_exact_project_terms_and_acknowledged_privacy";

function identity(bytes) {
  return Object.freeze({ sha256: digest(bytes), byteCount: bytes.byteLength });
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
  throw new Error(`joint legal V4 finalization output already exists: ${output}`);
}

function assertIdentity(actual, expected, label) {
  if (actual.sha256 !== expected.sha256 || actual.byteCount !== expected.byteCount) {
    throw new Error(`joint legal V4 final ${label} does not match approved content`);
  }
}

export async function finalizeJointLegalV4({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  outputRoot,
  privacyVersion,
  websiteTermsVersion,
  effectiveAt,
  ownerApproval,
  contentSeal,
  contentSealFile,
} = {}) {
  if (!outputRoot) throw new Error("joint legal V4 finalization requires a new output directory");
  if (ownerApproval !== JOINT_LEGAL_V4_OWNER_APPROVAL) {
    throw new Error("joint legal V4 finalization requires exact owner release approval");
  }
  if ((contentSeal === undefined) === (contentSealFile === undefined)) {
    throw new Error("joint legal V4 finalization requires exactly one content seal source");
  }
  const seal = contentSealFile === undefined
    ? validateJointLegalV4ContentSeal(contentSeal)
    : await readJointLegalV4ContentSeal(contentSealFile);
  const privacyPlan = createPrivacyV4RenderPlan({
    mode: "final", version: privacyVersion, effectiveAt,
    ownerApproval: JOINT_LEGAL_V4_OWNER_APPROVAL,
  });
  const termsPlan = createWebsiteTermsV4RenderPlan({
    mode: "final", version: websiteTermsVersion, effectiveAt,
    ownerApproval: JOINT_LEGAL_V4_OWNER_APPROVAL,
  });
  if (privacyPlan.effectiveAt !== termsPlan.effectiveAt) {
    throw new Error("joint legal V4 requires one shared final effective UTC time");
  }
  const absoluteRoot = path.resolve(root);
  const absoluteOutput = path.resolve(outputRoot);
  if (absoluteOutput === absoluteRoot || isInside(absoluteRoot, absoluteOutput)) {
    throw new Error("joint legal V4 finalization output must remain outside the repository");
  }
  await assertNewOutput(absoluteOutput);
  await mkdir(absoluteOutput, { recursive: false });
  try {
    const hostedRoot = path.join(absoluteOutput, "hosted");
    await buildHostedArtifact({ root: absoluteRoot, output: hostedRoot });
    const privacy = Buffer.from(renderPrivacyV4({ root: absoluteRoot, plan: privacyPlan }));
    const websiteTerms = Buffer.from(renderWebsiteTermsV4({
      root: absoluteRoot,
      plan: termsPlan,
    }));
    const legalCenter = Buffer.from(renderLegalCenterV4({
      root: absoluteRoot,
      privacyPlan,
      termsPlan,
    }));
    assertIdentity(
      identity(Buffer.from(normalizePrivacyV4Final(privacy.toString("utf8"), privacyPlan))),
      seal.artifacts.privacy.template,
      "Privacy V4",
    );
    assertIdentity(
      identity(Buffer.from(normalizeWebsiteTermsV4Final(
        websiteTerms.toString("utf8"),
        termsPlan,
      ))),
      seal.artifacts.websiteTerms.template,
      "Website Terms V4",
    );
    const files = Object.freeze([
      Object.freeze({ role: "privacy-current", file: "hosted/legal/privacy/index.html", bytes: privacy }),
      Object.freeze({ role: "privacy-versioned", file: `hosted/${privacyPlan.versionedFile}`, bytes: privacy }),
      Object.freeze({ role: "website-terms-current", file: "hosted/legal/website-terms/index.html", bytes: websiteTerms }),
      Object.freeze({ role: "website-terms-versioned", file: `hosted/${termsPlan.versionedFile}`, bytes: websiteTerms }),
      Object.freeze({ role: "legal-center-current", file: "hosted/legal/index.html", bytes: legalCenter }),
    ]);
    for (const artifact of files) {
      const file = path.join(absoluteOutput, artifact.file);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, artifact.bytes);
    }
    const privacyIdentity = identity(privacy);
    const termsIdentity = identity(websiteTerms);
    const privacyArtifactUri =
      `https://sitesourcery.com/legal/privacy/versions/${privacyVersion}/`;
    const websiteTermsArtifactUri =
      `https://sitesourcery.com/legal/website-terms/versions/${websiteTermsVersion}/`;
    const documents = Object.freeze([
      Object.freeze({
        kind: "privacy", version: privacyVersion,
        contentDigest: privacyIdentity.sha256,
        contentUri: privacyArtifactUri, effectiveAt,
      }),
      Object.freeze({
        kind: "product", version: websiteTermsVersion,
        contentDigest: termsIdentity.sha256,
        contentUri: "https://sitesourcery.com/legal/website-terms/#self-service",
        effectiveAt,
      }),
      Object.freeze({
        kind: "website", version: websiteTermsVersion,
        contentDigest: termsIdentity.sha256,
        contentUri: "https://sitesourcery.com/legal/website-terms/",
        effectiveAt,
      }),
    ]);
    const authorityDigest = digest(canonicalJson({
      documents,
      schema: JOINT_LEGAL_V4_AUTHORITY_SCHEMA,
    }));
    const receipt = Object.freeze({
      schema: JOINT_LEGAL_V4_FINALIZATION_SCHEMA,
      state: "owner-approved-finalization",
      sealable: true,
      published: false,
      integrationRequired: true,
      renderPath: "real-hosted-builder-plus-joint-legal-v4-overlay",
      effectiveAt,
      authoritySchema: JOINT_LEGAL_V4_AUTHORITY_SCHEMA,
      acceptanceSchema: JOINT_LEGAL_V4_ACCEPTANCE_SCHEMA,
      acceptanceStatement: ACCEPTANCE_STATEMENT,
      authorityDigest,
      documentBindings: Object.freeze([
        Object.freeze({ kind: "privacy", id: JOINT_LEGAL_V4_DOCUMENT_IDS.privacy }),
        Object.freeze({ kind: "product", id: JOINT_LEGAL_V4_DOCUMENT_IDS.product }),
        Object.freeze({ kind: "website", id: JOINT_LEGAL_V4_DOCUMENT_IDS.website }),
      ]),
      documents,
      contentSeal: Object.freeze({
        schema: seal.schema,
        contentSealSha256: seal.contentSealSha256,
        approvalReceiptSha256: seal.approvalReceiptSha256,
      }),
      artifacts: Object.freeze(files.map(({ role, file, bytes }) =>
        Object.freeze({ role, file, ...identity(bytes) }))),
      environment: Object.freeze({
        SITESOURCERY_HOSTED_PRIVACY_V4_VERSION: privacyVersion,
        SITESOURCERY_HOSTED_PRIVACY_V4_SHA256: privacyIdentity.sha256,
        SITESOURCERY_HOSTED_PRIVACY_V4_URI: privacyArtifactUri,
        SITESOURCERY_HOSTED_PRIVACY_V4_EFFECTIVE_AT: effectiveAt,
        SITESOURCERY_HOSTED_PRIVACY_V4_BYTE_COUNT: String(privacyIdentity.byteCount),
        SITESOURCERY_HOSTED_PRIVACY_V4_ARTIFACT_URI: privacyArtifactUri,
        SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_VERSION: websiteTermsVersion,
        SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_SHA256: termsIdentity.sha256,
        SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_URI: websiteTermsArtifactUri,
        SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_EFFECTIVE_AT: effectiveAt,
        SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_BYTE_COUNT: String(termsIdentity.byteCount),
        SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_ARTIFACT_URI: websiteTermsArtifactUri,
        SITESOURCERY_HOSTED_LEGAL_V4_AUTHORITY_SHA256: authorityDigest,
      }),
      cutoverPolicy: Object.freeze({
        existingV2AndV3EvidencePreserved: true,
        newProjectExactJointV4AcceptanceRequired: true,
        projectCreationWriteHoldRequiredUntilIntegrated: true,
        cloudflareConfigurationMustMatchApprovedDisclosure: true,
      }),
    });
    await writeFile(
      path.join(absoluteOutput, "joint-legal-v4-release-constants.json"),
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
    if (argument === "--owner-approved") {
      options.ownerApproval = JOINT_LEGAL_V4_OWNER_APPROVAL;
      continue;
    }
    const allowed = [
      "--content-seal", "--output", "--privacy-version",
      "--website-terms-version", "--effective-at",
    ];
    if (!allowed.includes(argument)) throw new Error(`unknown joint legal V4 argument: ${argument}`);
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    const keys = {
      "--content-seal": "contentSealFile", "--output": "outputRoot",
      "--privacy-version": "privacyVersion",
      "--website-terms-version": "websiteTermsVersion",
      "--effective-at": "effectiveAt",
    };
    options[keys[argument]] = value;
    index += 1;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  finalizeJointLegalV4(parseCli(process.argv.slice(2)))
    .then(({ outputRoot }) => console.log(outputRoot))
    .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
