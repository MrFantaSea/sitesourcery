#!/usr/bin/env node

import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildHostedArtifact } from "../build-hosted.mjs";
import { canonicalJson, digest } from "../../server/hosted/security.mjs";
import {
  createPrivacyV3RenderPlan,
  PRIVACY_V3_ACCEPTANCE_STATEMENT,
  PRIVACY_V3_AUTHORITY_SCHEMA,
  PRIVACY_V3_OWNER_APPROVAL,
} from "./privacy-v3-render.mjs";
import {
  createWebsiteTermsV3RenderPlan,
  normalizePrivacyV3GoLiveFinal,
  normalizeWebsiteTermsV3Final,
  reconcilePrivacyV3ForGoLive,
  renderLegalCenterV3,
  renderWebsiteTermsV3,
} from "./joint-legal-v3-render.mjs";
import {
  readJointLegalV3ContentSeal,
  validateJointLegalV3ContentSeal,
} from "./seal-joint-legal-v3-content.mjs";

export const JOINT_LEGAL_V3_OWNER_APPROVAL =
  "owner-approved-exact-joint-legal-v3-release-values";
export const JOINT_LEGAL_V3_FINALIZATION_SCHEMA =
  "sitesourcery.hosted-joint-legal-v3-finalization/v1";

const PRIVACY_ID = "00000000-0000-4000-8000-000000000048";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000103";
const WEBSITE_ID = "00000000-0000-4000-8000-000000000104";

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && relative !== ".."
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function assertNewOutput(outputRoot) {
  try {
    await lstat(outputRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`joint legal V3 finalization output already exists: ${outputRoot}`);
}

function identity(bytes) {
  return Object.freeze({ sha256: digest(bytes), byteCount: bytes.byteLength });
}

function assertIdentity(actual, expected, label) {
  if (actual.sha256 !== expected.sha256 || actual.byteCount !== expected.byteCount) {
    throw new Error(`joint legal V3 final ${label} does not match approved content`);
  }
}

export async function finalizeJointLegalV3({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  outputRoot,
  privacyVersion,
  websiteTermsVersion,
  effectiveAt,
  ownerApproval,
  contentSeal,
  contentSealFile,
} = {}) {
  if (!outputRoot) throw new Error("joint legal V3 finalization requires a new output directory");
  if (ownerApproval !== JOINT_LEGAL_V3_OWNER_APPROVAL) {
    throw new Error("joint legal V3 finalization requires exact owner release approval");
  }
  if ((contentSeal === undefined) === (contentSealFile === undefined)) {
    throw new Error("joint legal V3 finalization requires exactly one content seal source");
  }
  const seal = contentSealFile === undefined
    ? validateJointLegalV3ContentSeal(contentSeal)
    : await readJointLegalV3ContentSeal(contentSealFile);
  const privacyPlan = createPrivacyV3RenderPlan({
    mode: "final", version: privacyVersion, effectiveAt,
    ownerApproval: PRIVACY_V3_OWNER_APPROVAL,
  });
  const termsPlan = createWebsiteTermsV3RenderPlan({
    mode: "final", version: websiteTermsVersion, effectiveAt,
    ownerApproval: JOINT_LEGAL_V3_OWNER_APPROVAL,
  });
  const absoluteRoot = path.resolve(root);
  const absoluteOutput = path.resolve(outputRoot);
  if (absoluteOutput === absoluteRoot || isInside(absoluteRoot, absoluteOutput)) {
    throw new Error("joint legal V3 finalization output must remain outside the repository");
  }
  await assertNewOutput(absoluteOutput);
  await mkdir(absoluteOutput, { recursive: false });
  try {
    const hostedRoot = path.join(absoluteOutput, "hosted");
    await buildHostedArtifact({
      root: absoluteRoot,
      output: hostedRoot,
      privacyV3Render: {
        mode: "final", version: privacyVersion, effectiveAt,
        ownerApproval: PRIVACY_V3_OWNER_APPROVAL,
      },
    });

    const privacyCurrentPath = path.join(hostedRoot, "legal/privacy/index.html");
    const privacyVersionedPath = path.join(hostedRoot, privacyPlan.versionedFile);
    const privacyFinal = Buffer.from(reconcilePrivacyV3ForGoLive(
      await readFile(privacyCurrentPath, "utf8"),
    ));
    await Promise.all([
      writeFile(privacyCurrentPath, privacyFinal),
      writeFile(privacyVersionedPath, privacyFinal),
    ]);
    const normalizedPrivacy = Buffer.from(
      normalizePrivacyV3GoLiveFinal(privacyFinal.toString("utf8"), privacyPlan),
    );
    assertIdentity(identity(normalizedPrivacy), seal.artifacts.privacy.template, "Privacy V3");

    const websiteTermsFinal = Buffer.from(renderWebsiteTermsV3({
      root: absoluteRoot,
      plan: termsPlan,
    }));
    const websiteTermsCurrentPath = path.join(hostedRoot, "legal/website-terms/index.html");
    const websiteTermsVersionedPath = path.join(hostedRoot, termsPlan.versionedFile);
    await mkdir(path.dirname(websiteTermsVersionedPath), { recursive: true });
    await Promise.all([
      writeFile(websiteTermsCurrentPath, websiteTermsFinal),
      writeFile(websiteTermsVersionedPath, websiteTermsFinal),
    ]);
    const normalizedTerms = Buffer.from(
      normalizeWebsiteTermsV3Final(websiteTermsFinal.toString("utf8"), termsPlan),
    );
    assertIdentity(identity(normalizedTerms), seal.artifacts.websiteTerms.template, "Website Terms V3");

    const legalCenter = Buffer.from(renderLegalCenterV3({
      root: absoluteRoot, privacyPlan, termsPlan,
    }));
    await writeFile(path.join(hostedRoot, "legal/index.html"), legalCenter);

    const privacyArtifactUri =
      `https://sitesourcery.com/legal/privacy/versions/${privacyVersion}/`;
    const websiteTermsArtifactUri =
      `https://sitesourcery.com/legal/website-terms/versions/${websiteTermsVersion}/`;
    const privacyIdentity = identity(privacyFinal);
    const termsIdentity = identity(websiteTermsFinal);
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
      documents, schema: PRIVACY_V3_AUTHORITY_SCHEMA,
    }));
    const receipt = Object.freeze({
      schema: JOINT_LEGAL_V3_FINALIZATION_SCHEMA,
      state: "owner-approved-finalization",
      sealable: true,
      published: false,
      integrationRequired: true,
      renderPath: "real-hosted-builder-plus-joint-legal-v3-overlay",
      effectiveAt,
      authoritySchema: PRIVACY_V3_AUTHORITY_SCHEMA,
      acceptanceStatement: PRIVACY_V3_ACCEPTANCE_STATEMENT,
      authorityDigest,
      documentBindings: Object.freeze([
        Object.freeze({ kind: "privacy", id: PRIVACY_ID }),
        Object.freeze({ kind: "product", id: PRODUCT_ID }),
        Object.freeze({ kind: "website", id: WEBSITE_ID }),
      ]),
      documents,
      contentSeal: Object.freeze({
        schema: seal.schema,
        contentSealSha256: seal.contentSealSha256,
        approvalReceiptSchema: seal.approvalReceipt.schema,
        approvalStatement: seal.approvalReceipt.statement,
        approvalReceiptSha256: seal.approvalReceiptSha256,
        approvalReference: seal.approvalReceipt.approvalReference,
        approvedAt: seal.approvalReceipt.approvedAt,
        artifacts: seal.artifacts,
      }),
      artifacts: Object.freeze([
        Object.freeze({ role: "privacy-current", file: "hosted/legal/privacy/index.html", ...privacyIdentity }),
        Object.freeze({ role: "privacy-versioned", file: `hosted/${privacyPlan.versionedFile}`, ...privacyIdentity }),
        Object.freeze({ role: "website-terms-current", file: "hosted/legal/website-terms/index.html", ...termsIdentity }),
        Object.freeze({ role: "website-terms-versioned", file: `hosted/${termsPlan.versionedFile}`, ...termsIdentity }),
        Object.freeze({ role: "legal-center-current", file: "hosted/legal/index.html", ...identity(legalCenter) }),
      ]),
      environment: Object.freeze({
        SITESOURCERY_HOSTED_PRIVACY_V3_VERSION: privacyVersion,
        SITESOURCERY_HOSTED_PRIVACY_V3_SHA256: privacyIdentity.sha256,
        SITESOURCERY_HOSTED_PRIVACY_V3_URI: privacyArtifactUri,
        SITESOURCERY_HOSTED_PRIVACY_V3_EFFECTIVE_AT: effectiveAt,
        SITESOURCERY_HOSTED_PRIVACY_V3_BYTE_COUNT: String(privacyIdentity.byteCount),
        SITESOURCERY_HOSTED_PRIVACY_V3_ARTIFACT_URI: privacyArtifactUri,
        SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_VERSION: websiteTermsVersion,
        SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_SHA256: termsIdentity.sha256,
        SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_URI: websiteTermsArtifactUri,
        SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_EFFECTIVE_AT: effectiveAt,
        SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_BYTE_COUNT: String(termsIdentity.byteCount),
        SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_ARTIFACT_URI: websiteTermsArtifactUri,
        SITESOURCERY_HOSTED_LEGAL_V3_AUTHORITY_SHA256: authorityDigest,
        SITESOURCERY_HOSTED_PRIVACY_V3_AUTHORITY_SHA256: authorityDigest,
      }),
      cutoverPolicy: Object.freeze({
        existingV2EvidencePreserved: true,
        newProjectExactJointV3AcceptanceRequired: true,
        projectCreationWriteHoldRequiredUntilIntegrated: true,
        existingReadsAndCustomerRecoveryRemainAvailable: true,
      }),
    });
    await writeFile(
      path.join(absoluteOutput, "joint-legal-v3-release-constants.json"),
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
      if (options.ownerApproval) throw new Error("--owner-approved was supplied twice");
      options.ownerApproval = JOINT_LEGAL_V3_OWNER_APPROVAL;
      continue;
    }
    const allowed = ["--content-seal", "--output", "--privacy-version", "--website-terms-version", "--effective-at"];
    if (!allowed.includes(argument)) throw new Error(`unknown joint legal V3 argument: ${argument}`);
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    const keys = {
      "--content-seal": "contentSealFile", "--output": "outputRoot",
      "--privacy-version": "privacyVersion", "--website-terms-version": "websiteTermsVersion",
      "--effective-at": "effectiveAt",
    };
    if (options[keys[argument]]) throw new Error(`${argument} was supplied twice`);
    options[keys[argument]] = value;
    index += 1;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  finalizeJointLegalV3(parseCli(process.argv.slice(2)))
    .then(({ outputRoot }) => console.log(outputRoot))
    .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
