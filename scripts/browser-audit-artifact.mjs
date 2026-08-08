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
  createPrivacyV3RenderPlan,
  PRIVACY_V3_ACCEPTANCE_STATEMENT,
  PRIVACY_V3_AUTHORITY_SCHEMA,
  PRIVACY_V3_OWNER_APPROVAL,
} from "./hosted-truth/privacy-v3-render.mjs";

export const BROWSER_FINALIZED_ARTIFACT_ROOT_ENV =
  "SITESOURCERY_BROWSER_FINALIZED_ARTIFACT_ROOT";

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
    "sitesourcery.hosted-privacy-v3-finalization/v1",
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
  assert.equal(receipt.authoritySchema, PRIVACY_V3_AUTHORITY_SCHEMA);
  assert.equal(
    receipt.acceptanceStatement,
    PRIVACY_V3_ACCEPTANCE_STATEMENT,
  );
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
  assert.deepEqual(receipt.documents?.[0], {
    kind: "privacy",
    version: receipt.version,
    contentDigest: receipt.fullPageSha256,
    contentUri: expectedArtifactUri,
    effectiveAt: receipt.effectiveAt,
  });
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
