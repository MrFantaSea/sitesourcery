#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalJson } from "../../server/hosted/security.mjs";
import { JOINT_LEGAL_V5_DOCUMENT_IDS } from "./joint-legal-v5-artifacts.mjs";
import {
  JOINT_LEGAL_V5_EFFECTIVE_AT_TOKEN,
  JOINT_LEGAL_V5_EFFECTIVE_LABEL_TOKEN,
  JOINT_LEGAL_V5_OWNER_APPROVAL,
  PRIVACY_V5_VERSION_TOKEN,
  WEBSITE_TERMS_V5_VERSION_TOKEN,
  createPrivacyV5RenderPlan,
  createWebsiteTermsV5RenderPlan,
  normalizePrivacyV5Final,
  normalizeWebsiteTermsV5Final,
  renderLegalCenterV5,
  renderPrivacyV5,
  renderWebsiteTermsV5,
} from "./joint-legal-v5-render.mjs";
import {
  JOINT_LEGAL_V5_FINALIZATION_RELATIVE_ROOT,
  readJointLegalV5ContentSeal,
} from "./seal-joint-legal-v5-content.mjs";

export const JOINT_LEGAL_V5_FINALIZATION_SCHEMA =
  "sitesourcery.hosted-joint-legal-v5-finalization/v1";
export const JOINT_LEGAL_V5_AUTHORITY_SCHEMA =
  "sitesourcery.project-legal-authority/v5";
export const JOINT_LEGAL_V5_ACCEPTANCE_SCHEMA =
  "sitesourcery.project-legal-acceptance/v5";
export const JOINT_LEGAL_V5_PRIVACY_VERSION =
  "SS-HOSTED-PRIVACY-2026-08-19-V5";
export const JOINT_LEGAL_V5_WEBSITE_TERMS_VERSION =
  "SS-HOSTED-WEBSITE-TERMS-2026-08-19-V5";

const ACCEPTANCE_STATEMENT =
  "accepted_exact_project_terms_and_acknowledged_privacy";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function identity(bytes) {
  return Object.freeze({
    sha256: digest(bytes),
    byteCount: bytes.byteLength,
  });
}

function assertIdentity(actual, expected, label) {
  if (
    actual.sha256 !== expected.sha256
    || actual.byteCount !== expected.byteCount
  ) throw new Error(`joint legal V5 final ${label} changed from approved content`);
}

async function assertAbsent(file) {
  try {
    await lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`joint legal V5 finalization target already exists: ${file}`);
}

function normalizedCenter(source, privacyPlan, termsPlan) {
  return source
    .replace('data-joint-legal-v5-state="final"',
      'data-joint-legal-v5-state="content-template"')
    .replace(privacyPlan.effectiveLabel, JOINT_LEGAL_V5_EFFECTIVE_LABEL_TOKEN)
    .replace(privacyPlan.version, PRIVACY_V5_VERSION_TOKEN)
    .replace(termsPlan.version, WEBSITE_TERMS_V5_VERSION_TOKEN)
    .replace(privacyPlan.effectiveAt, JOINT_LEGAL_V5_EFFECTIVE_AT_TOKEN);
}

export async function finalizeJointLegalV5({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  outputRoot,
  privacyVersion,
  websiteTermsVersion,
  effectiveAt,
  ownerApproval,
  contentSealFile,
} = {}) {
  if (ownerApproval !== JOINT_LEGAL_V5_OWNER_APPROVAL) {
    throw new Error("joint legal V5 finalization requires exact owner release approval");
  }
  if (
    privacyVersion !== JOINT_LEGAL_V5_PRIVACY_VERSION
    || websiteTermsVersion !== JOINT_LEGAL_V5_WEBSITE_TERMS_VERSION
    || typeof effectiveAt !== "string"
    || !effectiveAt.startsWith("2026-08-19T")
  ) throw new Error("joint legal V5 finalization values do not match the frozen release paths");
  const absoluteRoot = path.resolve(root);
  const expectedOutput = path.join(
    absoluteRoot,
    JOINT_LEGAL_V5_FINALIZATION_RELATIVE_ROOT,
  );
  const absoluteOutput = path.resolve(outputRoot ?? expectedOutput);
  if (absoluteOutput !== expectedOutput) {
    throw new Error(`joint legal V5 finalization output must be ${expectedOutput}`);
  }
  const expectedSealFile = path.join(
    absoluteOutput,
    "joint-legal-v5-content-seal.json",
  );
  if (path.resolve(contentSealFile ?? expectedSealFile) !== expectedSealFile) {
    throw new Error("joint legal V5 finalization requires its exact local content seal");
  }
  const seal = await readJointLegalV5ContentSeal(expectedSealFile);
  const privacyPlan = createPrivacyV5RenderPlan({
    mode: "final",
    version: privacyVersion,
    effectiveAt,
    ownerApproval: JOINT_LEGAL_V5_OWNER_APPROVAL,
  });
  const termsPlan = createWebsiteTermsV5RenderPlan({
    mode: "final",
    version: websiteTermsVersion,
    effectiveAt,
    ownerApproval: JOINT_LEGAL_V5_OWNER_APPROVAL,
  });
  const privacy = Buffer.from(renderPrivacyV5({
    root: absoluteRoot,
    plan: privacyPlan,
  }));
  const websiteTerms = Buffer.from(renderWebsiteTermsV5({
    root: absoluteRoot,
    plan: termsPlan,
  }));
  const legalCenter = Buffer.from(renderLegalCenterV5({
    root: absoluteRoot,
    privacyPlan,
    termsPlan,
  }));
  assertIdentity(
    identity(Buffer.from(normalizePrivacyV5Final(
      privacy.toString("utf8"),
      privacyPlan,
    ))),
    seal.artifacts.privacy.template,
    "Privacy V5",
  );
  assertIdentity(
    identity(Buffer.from(normalizeWebsiteTermsV5Final(
      websiteTerms.toString("utf8"),
      termsPlan,
    ))),
    seal.artifacts.websiteTerms.template,
    "Website Terms V5",
  );
  assertIdentity(
    identity(Buffer.from(normalizedCenter(
      legalCenter.toString("utf8"),
      privacyPlan,
      termsPlan,
    ))),
    seal.artifacts.center.template,
    "legal center V5",
  );

  const privacyArtifactUri =
    `https://sitesourcery.com/legal/privacy/versions/${privacyVersion}/`;
  const websiteTermsArtifactUri =
    `https://sitesourcery.com/legal/website-terms/versions/${websiteTermsVersion}/`;
  const privacyIdentity = identity(privacy);
  const termsIdentity = identity(websiteTerms);
  const documents = Object.freeze([
    Object.freeze({
      kind: "privacy",
      version: privacyVersion,
      contentDigest: privacyIdentity.sha256,
      contentUri: privacyArtifactUri,
      effectiveAt,
    }),
    Object.freeze({
      kind: "product",
      version: websiteTermsVersion,
      contentDigest: termsIdentity.sha256,
      contentUri: "https://sitesourcery.com/legal/website-terms/#self-service",
      effectiveAt,
    }),
    Object.freeze({
      kind: "website",
      version: websiteTermsVersion,
      contentDigest: termsIdentity.sha256,
      contentUri: "https://sitesourcery.com/legal/website-terms/",
      effectiveAt,
    }),
  ]);
  const authorityDigest = digest(canonicalJson({
    documents,
    schema: JOINT_LEGAL_V5_AUTHORITY_SCHEMA,
  }));
  const files = Object.freeze([
    Object.freeze({
      role: "privacy-current",
      file: "hosted/legal/privacy/index.html",
      bytes: privacy,
    }),
    Object.freeze({
      role: "privacy-versioned",
      file: `hosted/legal/privacy/versions/${privacyVersion}/index.html`,
      bytes: privacy,
    }),
    Object.freeze({
      role: "website-terms-current",
      file: "hosted/legal/website-terms/index.html",
      bytes: websiteTerms,
    }),
    Object.freeze({
      role: "website-terms-versioned",
      file: `hosted/legal/website-terms/versions/${websiteTermsVersion}/index.html`,
      bytes: websiteTerms,
    }),
    Object.freeze({
      role: "legal-center-current",
      file: "hosted/legal/index.html",
      bytes: legalCenter,
    }),
  ]);
  const receipt = Object.freeze({
    schema: JOINT_LEGAL_V5_FINALIZATION_SCHEMA,
    state: "owner-approved-finalization",
    sealable: true,
    published: false,
    deploymentAuthorized: false,
    integrationRequired: true,
    effectiveAt,
    authoritySchema: JOINT_LEGAL_V5_AUTHORITY_SCHEMA,
    acceptanceSchema: JOINT_LEGAL_V5_ACCEPTANCE_SCHEMA,
    acceptanceStatement: ACCEPTANCE_STATEMENT,
    authorityDigest,
    documentBindings: Object.freeze([
      Object.freeze({ kind: "privacy", id: JOINT_LEGAL_V5_DOCUMENT_IDS.privacy }),
      Object.freeze({ kind: "product", id: JOINT_LEGAL_V5_DOCUMENT_IDS.product }),
      Object.freeze({ kind: "website", id: JOINT_LEGAL_V5_DOCUMENT_IDS.website }),
    ]),
    documents,
    contentSeal: Object.freeze({
      schema: seal.schema,
      contentSealSha256: seal.contentSealSha256,
      approvalSha256: seal.approvalSha256,
    }),
    artifacts: Object.freeze(files.map(({ role, file, bytes }) =>
      Object.freeze({ role, file, ...identity(bytes) }))),
    release: Object.freeze({
      privacyVersion,
      privacySha256: privacyIdentity.sha256,
      privacyByteCount: privacyIdentity.byteCount,
      privacyArtifactUri,
      websiteTermsVersion,
      websiteTermsSha256: termsIdentity.sha256,
      websiteTermsByteCount: termsIdentity.byteCount,
      websiteTermsArtifactUri,
      effectiveAt,
      authorityDigest,
    }),
    cutoverPolicy: Object.freeze({
      retainedV2V3V4EvidencePreserved: true,
      exactJointV5AcceptanceRequiredForNewProjects: true,
      heldProductsRemainHeldUntilSeparateRelease: true,
      deploymentAndPublicCutoverRequireSeparateOwnerApproval: true,
    }),
  });
  const receiptFile = path.join(
    absoluteOutput,
    "joint-legal-v5-release-constants.json",
  );
  await assertAbsent(receiptFile);
  for (const artifact of files) {
    await assertAbsent(path.join(absoluteOutput, artifact.file));
  }
  for (const artifact of files) {
    const target = path.join(absoluteOutput, artifact.file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, artifact.bytes);
  }
  await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
  return Object.freeze({ outputRoot: absoluteOutput, receipt });
}

function parseCli(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--owner-approved") {
      options.ownerApproval = JOINT_LEGAL_V5_OWNER_APPROVAL;
      continue;
    }
    const keys = {
      "--content-seal": "contentSealFile",
      "--output": "outputRoot",
      "--privacy-version": "privacyVersion",
      "--website-terms-version": "websiteTermsVersion",
      "--effective-at": "effectiveAt",
    };
    if (!(argument in keys)) {
      throw new Error(`unknown joint legal V5 finalization argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    options[keys[argument]] = value;
    index += 1;
  }
  return options;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  finalizeJointLegalV5(parseCli(process.argv.slice(2)))
    .then(({ outputRoot }) => console.log(outputRoot))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
