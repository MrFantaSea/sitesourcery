import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  buildHostedArtifact,
  verifyHostedArtifact,
} from "./build-hosted.mjs";
import {
  canonicalJson,
  digest,
} from "../server/hosted/security.mjs";
import {
  assertPrivacyV3ContentInputs,
  HOSTED_PRIVACY_V3_CANDIDATE,
  HOSTED_PRIVACY_V3_CONTENT,
  HOSTED_WEBSITE_TERMS_V2_ARTIFACT,
} from "./hosted-truth/legal-artifacts.mjs";
import {
  createPrivacyV3RenderPlan,
  normalizePrivacyV3FinalPage,
  PRIVACY_V3_ACCEPTANCE_STATEMENT,
  PRIVACY_V3_AUTHORITY_SCHEMA,
  PRIVACY_V3_OWNER_APPROVAL,
} from "./hosted-truth/privacy-v3-render.mjs";
import {
  PRIVACY_V3_CONTENT_APPROVAL_SCHEMA,
  PRIVACY_V3_CONTENT_APPROVAL_STATEMENT,
  PRIVACY_V3_CONTENT_SEAL_SCHEMA,
  validatePrivacyV3ContentApproval,
  validatePrivacyV3ContentSeal,
} from "./hosted-truth/seal-privacy-v3-content.mjs";

export const BROWSER_FINALIZED_ARTIFACT_ROOT_ENV =
  "SITESOURCERY_BROWSER_FINALIZED_ARTIFACT_ROOT";

const WEBSITE_TERMS_V2_EFFECTIVE_AT = "2026-07-30T00:00:00.000Z";

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function parseArguments(argv) {
  let finalizedRoot = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--finalized-artifact-root") {
      throw new Error(`unknown browser-audit argument: ${argument}`);
    }
    if (finalizedRoot !== null) {
      throw new Error("--finalized-artifact-root was supplied twice");
    }
    const value = argv[index + 1];
    if (!value) {
      throw new Error("--finalized-artifact-root requires an absolute path");
    }
    finalizedRoot = value;
    index += 1;
  }
  return finalizedRoot;
}

export function createBrowserAuditArtifactPlan({
  siteRoot,
  environment = process.env,
  argv = [],
} = {}) {
  if (typeof siteRoot !== "string" || siteRoot.length === 0) {
    throw new Error("browser audit requires the repository root");
  }
  const absoluteSiteRoot = path.resolve(siteRoot);
  const argumentRoot = parseArguments(argv);
  const environmentValue = environment?.[
    BROWSER_FINALIZED_ARTIFACT_ROOT_ENV
  ];
  const environmentRoot =
    typeof environmentValue === "string"
      && environmentValue.trim().length > 0
      ? environmentValue.trim()
      : null;
  if (argumentRoot && environmentRoot) {
    throw new Error(
      "choose either --finalized-artifact-root or "
        + BROWSER_FINALIZED_ARTIFACT_ROOT_ENV,
    );
  }
  const explicitRoot = argumentRoot || environmentRoot;
  if (!explicitRoot) {
    return Object.freeze({
      mode: "held-build",
      siteRoot: absoluteSiteRoot,
      outputRoot: null,
      hostedRoot: path.join(absoluteSiteRoot, "_hosted"),
      receiptFile: null,
    });
  }
  if (!path.isAbsolute(explicitRoot)) {
    throw new Error("finalized browser artifact root must be an absolute path");
  }
  const outputRoot = path.normalize(explicitRoot);
  if (
    outputRoot === absoluteSiteRoot
    || isInside(absoluteSiteRoot, outputRoot)
  ) {
    throw new Error(
      "finalized browser artifact root must remain outside the repository",
    );
  }
  return Object.freeze({
    mode: "finalized",
    siteRoot: absoluteSiteRoot,
    outputRoot,
    hostedRoot: path.join(outputRoot, "hosted"),
    receiptFile: path.join(
      outputRoot,
      "privacy-v3-release-constants.json",
    ),
  });
}

async function assertRealDirectory(value, label) {
  const state = await lstat(value);
  if (!state.isDirectory() || state.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${value}`);
  }
}

async function readFinalizationReceipt(plan) {
  await assertRealDirectory(plan.outputRoot, "finalized artifact root");
  await assertRealDirectory(plan.hostedRoot, "finalized hosted artifact");
  const [realSiteRoot, realOutputRoot, realHostedRoot] = await Promise.all([
    realpath(plan.siteRoot),
    realpath(plan.outputRoot),
    realpath(plan.hostedRoot),
  ]);
  if (
    realOutputRoot === realSiteRoot
    || isInside(realSiteRoot, realOutputRoot)
  ) {
    throw new Error(
      "finalized browser artifact root resolves inside the repository",
    );
  }
  if (path.dirname(realHostedRoot) !== realOutputRoot) {
    throw new Error(
      "finalized hosted artifact must be the direct hosted directory",
    );
  }
  const receiptState = await lstat(plan.receiptFile);
  if (!receiptState.isFile() || receiptState.isSymbolicLink()) {
    throw new Error("finalized artifact receipt must be a real file");
  }
  let receipt;
  try {
    receipt = JSON.parse(await readFile(plan.receiptFile, "utf8"));
  } catch (error) {
    throw new Error("finalized artifact receipt must be valid JSON", {
      cause: error,
    });
  }
  return receipt;
}

async function verifyFinalizationReceipt(plan, receipt) {
  assert.equal(
    receipt?.schema,
    "sitesourcery.hosted-privacy-v3-finalization/v2",
    "finalized artifact receipt schema mismatch",
  );
  assert.equal(
    receipt.state,
    "owner-approved-finalization",
    "browser audit requires an owner-approved finalization receipt",
  );
  assert.equal(receipt.sealable, true);
  assert.equal(receipt.published, false);
  assert.equal(receipt.integrationRequired, true);
  assert.equal(receipt.renderPath, "real-hosted-builder");
  assert.equal(receipt.documentId, "00000000-0000-4000-8000-000000000048");
  assert.equal(receipt.kind, "privacy");
  assert.equal(receipt.currentUri, "https://sitesourcery.com/legal/privacy/");
  assert.equal(receipt.authoritySchema, PRIVACY_V3_AUTHORITY_SCHEMA);
  assert.equal(
    receipt.acceptanceStatement,
    PRIVACY_V3_ACCEPTANCE_STATEMENT,
  );
  const expectedContentSealKeys = [
    "approvalReceiptSchema",
    "approvalReceiptSha256",
    "approvalReference",
    "approvalStatement",
    "approvedAt",
    "contentSealSha256",
    "contentTemplateByteCount",
    "contentTemplateSha256",
    "reviewArtifactByteCount",
    "reviewArtifactSha256",
    "schema",
    "state",
  ].sort();
  assert.deepEqual(
    Object.keys(receipt.contentSeal ?? {}).sort(),
    expectedContentSealKeys,
    "finalized artifact content-seal summary shape mismatch",
  );
  assert.equal(receipt.contentSeal.schema, PRIVACY_V3_CONTENT_SEAL_SCHEMA);
  assert.equal(receipt.contentSeal.state, "content-approved-unreleased");
  assert.match(receipt.contentSeal.contentSealSha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    receipt.contentSeal.approvalReceiptSchema,
    PRIVACY_V3_CONTENT_APPROVAL_SCHEMA,
  );
  assert.equal(
    receipt.contentSeal.approvalStatement,
    PRIVACY_V3_CONTENT_APPROVAL_STATEMENT,
  );
  const approvalReceipt = validatePrivacyV3ContentApproval({
    schema: receipt.contentSeal.approvalReceiptSchema,
    statement: receipt.contentSeal.approvalStatement,
    approvalReference: receipt.contentSeal.approvalReference,
    approvedAt: receipt.contentSeal.approvedAt,
    reviewArtifactSha256: receipt.contentSeal.reviewArtifactSha256,
    reviewArtifactByteCount: receipt.contentSeal.reviewArtifactByteCount,
  });
  assert.equal(
    receipt.contentSeal.approvalReceiptSha256,
    digest(canonicalJson(approvalReceipt)),
    "finalized artifact content approval digest mismatch",
  );
  assert.equal(
    receipt.contentSeal.reviewArtifactSha256,
    HOSTED_PRIVACY_V3_CONTENT.reviewArtifactSha256,
  );
  assert.equal(
    receipt.contentSeal.reviewArtifactByteCount,
    HOSTED_PRIVACY_V3_CONTENT.reviewArtifactByteCount,
  );
  assert.equal(
    receipt.contentSeal.contentTemplateSha256,
    HOSTED_PRIVACY_V3_CONTENT.contentTemplateSha256,
  );
  assert.equal(
    receipt.contentSeal.contentTemplateByteCount,
    HOSTED_PRIVACY_V3_CONTENT.contentTemplateByteCount,
  );
  const reviewPlan = createPrivacyV3RenderPlan({ mode: "review" });
  const templatePlan = createPrivacyV3RenderPlan({ mode: "content-template" });
  validatePrivacyV3ContentSeal({
    schema: receipt.contentSeal.schema,
    state: receipt.contentSeal.state,
    published: false,
    deployable: false,
    releaseFinalizationRequired: true,
    renderPath: "real-hosted-builder",
    reviewArtifact: {
      file: `review/hosted/${HOSTED_PRIVACY_V3_CANDIDATE.currentFile}`,
      versionedFile: `review/hosted/${reviewPlan.versionedFile}`,
      sha256: receipt.contentSeal.reviewArtifactSha256,
      byteCount: receipt.contentSeal.reviewArtifactByteCount,
      mediaType: "text/html; charset=utf-8",
    },
    contentTemplate: {
      file: `template-hosted/${HOSTED_PRIVACY_V3_CANDIDATE.currentFile}`,
      versionedFile: `template-hosted/${templatePlan.versionedFile}`,
      sha256: receipt.contentSeal.contentTemplateSha256,
      byteCount: receipt.contentSeal.contentTemplateByteCount,
      mediaType: "text/html; charset=utf-8",
    },
    approvalReceipt,
    approvalReceiptSha256: receipt.contentSeal.approvalReceiptSha256,
    release: {
      version: null,
      effectiveAt: null,
      fullPageSha256: null,
      byteCount: null,
      artifactUri: null,
      authorityDigest: null,
    },
    contentSealSha256: receipt.contentSeal.contentSealSha256,
  });
  const renderOptions = Object.freeze({
    mode: "final",
    version: receipt.version,
    effectiveAt: receipt.effectiveAt,
    ownerApproval: PRIVACY_V3_OWNER_APPROVAL,
  });
  const renderPlan = createPrivacyV3RenderPlan(renderOptions);
  const expectedArtifactUri =
    `https://sitesourcery.com/legal/privacy/versions/${receipt.version}/`;
  assert.equal(receipt.contentUri, expectedArtifactUri);
  assert.equal(receipt.artifactUri, expectedArtifactUri);
  assert.match(receipt.fullPageSha256, /^[a-f0-9]{64}$/u);
  assert.ok(Number.isSafeInteger(receipt.byteCount) && receipt.byteCount > 0);
  assert.equal(receipt.mediaType, "text/html; charset=utf-8");
  assert.equal(
    receipt.authorityDigest,
    digest(canonicalJson({
      documents: receipt.documents,
      schema: PRIVACY_V3_AUTHORITY_SCHEMA,
    })),
    "finalized artifact authority digest mismatch",
  );
  assert.deepEqual(receipt.documents, [
    {
      kind: "privacy",
      version: receipt.version,
      contentDigest: receipt.fullPageSha256,
      contentUri: expectedArtifactUri,
      effectiveAt: receipt.effectiveAt,
    },
    {
      kind: "product",
      version: HOSTED_WEBSITE_TERMS_V2_ARTIFACT.version,
      contentDigest: HOSTED_WEBSITE_TERMS_V2_ARTIFACT.sha256,
      contentUri:
        `${HOSTED_WEBSITE_TERMS_V2_ARTIFACT.canonicalUri}#self-service`,
      effectiveAt: WEBSITE_TERMS_V2_EFFECTIVE_AT,
    },
    {
      kind: "website",
      version: HOSTED_WEBSITE_TERMS_V2_ARTIFACT.version,
      contentDigest: HOSTED_WEBSITE_TERMS_V2_ARTIFACT.sha256,
      contentUri: HOSTED_WEBSITE_TERMS_V2_ARTIFACT.canonicalUri,
      effectiveAt: WEBSITE_TERMS_V2_EFFECTIVE_AT,
    },
  ]);
  assert.deepEqual(receipt.environment, {
    SITESOURCERY_HOSTED_PRIVACY_V3_VERSION: receipt.version,
    SITESOURCERY_HOSTED_PRIVACY_V3_SHA256: receipt.fullPageSha256,
    SITESOURCERY_HOSTED_PRIVACY_V3_URI: expectedArtifactUri,
    SITESOURCERY_HOSTED_PRIVACY_V3_EFFECTIVE_AT: receipt.effectiveAt,
    SITESOURCERY_HOSTED_PRIVACY_V3_BYTE_COUNT: String(receipt.byteCount),
    SITESOURCERY_HOSTED_PRIVACY_V3_ARTIFACT_URI: expectedArtifactUri,
    SITESOURCERY_HOSTED_PRIVACY_V3_AUTHORITY_SHA256:
      receipt.authorityDigest,
  });
  assert.deepEqual(receipt.cutoverPolicy, {
    existingV2ProjectReacceptanceRequired: false,
    projectCreationWriteHoldRequired: true,
    existingReadsAndCustomerRecoveryRemainAvailable: true,
  });
  const expectedArtifacts = [
    {
      role: "current",
      file: "hosted/legal/privacy/index.html",
    },
    {
      role: "versioned",
      file: `hosted/${renderPlan.versionedFile}`,
    },
  ];
  assert.equal(receipt.artifacts?.length, expectedArtifacts.length);
  for (let index = 0; index < expectedArtifacts.length; index += 1) {
    const expected = expectedArtifacts[index];
    const artifact = receipt.artifacts[index];
    assert.deepEqual(
      { role: artifact?.role, file: artifact?.file },
      expected,
    );
    assert.equal(artifact.sha256, receipt.fullPageSha256);
    assert.equal(artifact.byteCount, receipt.byteCount);
  }
  const bytes = await Promise.all(
    receipt.artifacts.map(async ({ file }) => {
      const artifactFile = path.join(plan.outputRoot, file);
      const state = await lstat(artifactFile);
      if (!state.isFile() || state.isSymbolicLink()) {
        throw new Error(`finalized receipt artifact must be a real file: ${file}`);
      }
      return readFile(artifactFile);
    }),
  );
  assert.equal(
    bytes[0].equals(bytes[1]),
    true,
    "finalized current and versioned Privacy V3 bytes differ",
  );
  assert.equal(bytes[0].byteLength, receipt.byteCount);
  assert.equal(
    digest(bytes[0]),
    receipt.fullPageSha256,
    "finalized Privacy V3 artifact digest mismatch",
  );
  const normalizedContent = Buffer.from(
    normalizePrivacyV3FinalPage(bytes[0].toString("utf8"), renderPlan),
    "utf8",
  );
  assertPrivacyV3ContentInputs({ contentTemplateBytes: normalizedContent });
  assert.equal(
    digest(normalizedContent),
    receipt.contentSeal.contentTemplateSha256,
    "finalized Privacy V3 content does not match its content seal",
  );
  assert.equal(
    normalizedContent.byteLength,
    receipt.contentSeal.contentTemplateByteCount,
    "finalized Privacy V3 content-template byte count mismatch",
  );
  return renderOptions;
}

export async function prepareBrowserAuditArtifact({
  plan,
  buildHostedArtifactImpl = buildHostedArtifact,
  verifyHostedArtifactImpl = verifyHostedArtifact,
} = {}) {
  if (!plan || plan.mode === "held-build") {
    if (!plan) throw new Error("browser audit artifact plan is required");
    const builtRoot = await buildHostedArtifactImpl({
      root: plan.siteRoot,
      output: plan.hostedRoot,
    });
    assert.equal(
      path.resolve(builtRoot),
      path.resolve(plan.hostedRoot),
      "hosted builder returned an unexpected artifact root",
    );
    return Object.freeze({
      mode: plan.mode,
      hostedRoot: plan.hostedRoot,
      receipt: null,
    });
  }
  if (plan.mode !== "finalized") {
    throw new Error(`unknown browser audit artifact mode: ${plan.mode}`);
  }
  const receipt = await readFinalizationReceipt(plan);
  const privacyV3Render = await verifyFinalizationReceipt(plan, receipt);
  await verifyHostedArtifactImpl({
    root: plan.siteRoot,
    output: plan.hostedRoot,
    privacyV3Render,
  });
  return Object.freeze({
    mode: plan.mode,
    hostedRoot: plan.hostedRoot,
    receipt,
  });
}
