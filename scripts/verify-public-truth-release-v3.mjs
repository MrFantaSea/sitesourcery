import { spawnSync } from "node:child_process";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  sha256Bytes,
} from "../ops/immutable-evidence.mjs";
import {
  readCiReleaseSuccessorInput,
  verifyCiLegalV4Artifact,
  verifyCiReleaseCandidate,
} from "../ops/ci-release-proof-repository.mjs";
import {
  PRIMARY_BROWSER_AUDIT_VIEWPORTS,
  REVIEWED_CHROMIUM,
} from "./browser-audit-vnext.mjs";
import { auditArtifactFromSitemap } from "./audit-artifact-from-sitemap.mjs";
import { CANONICAL_ROUTES } from "./check-routes.mjs";
import {
  artifactManifest,
  gitDiffPaths,
  parseStrictJson,
  pollLiveProduction,
  PublicTruthVerificationError,
  sha256,
  sourceManifestFromGit,
  stableStringify,
  verifyProductionRouteContract,
} from "./verify-public-truth-release.mjs";

export const RECEIPT_SCHEMA_V3 = "sitesourcery.public-truth-authority/v3";
export const RECEIPT_PATH_V3 = "data/public-truth-authority-v3.json";
export const WORKFLOW_PATH_V3 =
  ".github/workflows/public-truth-reconciliation-v3.yml";
export const CI_SUCCESSOR_INPUT_ROOT = "ops/releases/ci-successor-inputs";
export const RELEASE_ENVIRONMENT_V3 = "github-pages";
export const REPOSITORY_FULL_NAME_V3 = "MrFantaSea/sitesourcery";
export const REPOSITORY_ID_V3 = "1296712694";
export const OWNER_LOGIN_V3 = "MrFantaSea";
export const OWNER_GITHUB_USER_ID_V3 = "293072489";
export const MAX_AUTHORITY_LIFETIME_MS_V3 = 60 * 60 * 1000;
export const PUBLIC_TRUTH_V3_DEPLOY_JOB_TIMEOUT_MINUTES = 20;
export const PUBLIC_TRUTH_V3_PROVE_JOB_TIMEOUT_MINUTES = 20;
export const PUBLIC_TRUTH_V3_AUTHORITY_SAFETY_MINUTES = 5;
export const MIN_PREDEPLOY_REMAINING_MS_V3 = (
  PUBLIC_TRUTH_V3_DEPLOY_JOB_TIMEOUT_MINUTES
  + PUBLIC_TRUTH_V3_PROVE_JOB_TIMEOUT_MINUTES
  + PUBLIC_TRUTH_V3_AUTHORITY_SAFETY_MINUTES
) * 60 * 1000;
export const MAX_CLOCK_SKEW_MS_V3 = 5 * 60 * 1000;
export const REVIEWED_BROWSER_V3 = Object.freeze({
  version: REVIEWED_CHROMIUM.version,
  widths: Object.freeze(
    PRIMARY_BROWSER_AUDIT_VIEWPORTS.map((viewport) => viewport.width),
  ),
  routeCount: CANONICAL_ROUTES.length,
  viewCount: CANONICAL_ROUTES.length * PRIMARY_BROWSER_AUDIT_VIEWPORTS.length,
});
export const AUTHORITY_STATEMENT_V3 =
  "Authorize one exact held, inquiry-only GitHub Pages publication from a successor-bound candidate; deny hosted runtime, customer data, commerce, provider, DNS, tunnel, containment, and general deployment authority.";
export const POSTDEPLOY_EVIDENCE_FILE_V3 =
  "public-truth-production-proof-v3.json";
export const IMMUTABLE_V2_BLOBS = Object.freeze({
  ".github/workflows/public-truth-reconciliation-v2.yml":
    "10eb1a5e912fd9633cee3c9476d934b6be2964f0",
  "scripts/test/public-truth-release-v2.test.mjs":
    "182c0ebe546b7fea791536ad503583da01839940",
  "scripts/verify-public-truth-release-v2.mjs":
    "62e57317f2321b9d17e4d80893626a9c8f18f4c4",
});
export const V3_PROOF_IDENTITY_PATHS = Object.freeze([
  WORKFLOW_PATH_V3,
  "scripts/verify-public-truth-release-v3.mjs",
  "scripts/test/public-truth-release-v3.test.mjs",
  "ops/ci-release-proof-repository.mjs",
  "ops/ci-release-proof-runtime.mjs",
  "ops/origin-seal-runtime.mjs",
  "scripts/build-pages.mjs",
  "scripts/browser-audit-vnext.mjs",
  "scripts/audit-artifact-from-sitemap.mjs",
  "scripts/check-routes.mjs",
  "scripts/hosted-truth/pages-legal-v4.mjs",
  ...Object.keys(IMMUTABLE_V2_BLOBS),
].sort());

const COMMIT = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const DECIMAL = /^[1-9][0-9]*$/u;
const GITHUB_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const BROWSER_PROOF_SCHEMA = "sitesourcery.public-truth-browser-proof/v3";

function fail(message) {
  throw new PublicTruthVerificationError(message);
}

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())
  ) {
    fail(`${label} must contain only its exact fields.`);
  }
  return value;
}

function exactCommit(value, label) {
  if (typeof value !== "string" || !COMMIT.test(value)) {
    fail(`${label} must be one exact lowercase commit SHA.`);
  }
  return value;
}

function exactDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail(`${label} must be one exact lowercase SHA-256.`);
  }
  return value;
}

function exactInstant(value, label) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    fail(`${label} must be one exact UTC instant.`);
  }
  return value;
}

function git(root, arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) fail(`git ${arguments_[0]} failed closed.`);
  return result.stdout.trim();
}

export function ciSuccessorInputPath(candidateSha) {
  exactCommit(candidateSha, "candidate");
  return `${CI_SUCCESSOR_INPUT_ROOT}/${candidateSha}.json`;
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || canonicalJson(value) !== canonicalJson(expected)) {
    fail(`${label} must match its exact ordered contract.`);
  }
  return value;
}

function parents(root, revision) {
  exactCommit(revision, "revision");
  const words = git(root, ["rev-list", "--parents", "-n", "1", revision])
    .split(/\s+/u);
  if (words[0] !== revision) fail("commit identity changed during verification.");
  return words.slice(1);
}

function gitBlob(root, revision, file) {
  return git(root, ["rev-parse", `${revision}:${file}`]);
}

function gitFile(root, revision, file) {
  const result = spawnSync("git", ["cat-file", "blob", `${revision}:${file}`], {
    cwd: root,
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) fail(`git blob ${file} is unavailable.`);
  return result.stdout;
}

function gitPathExists(root, revision, file) {
  const result = spawnSync("git", ["cat-file", "-e", `${revision}:${file}`], {
    cwd: root,
    stdio: "ignore",
  });
  return result.status === 0;
}

export async function canonicalRootV3(root) {
  const unresolved = path.resolve(root);
  const unresolvedMetadata = await lstat(unresolved);
  if (!unresolvedMetadata.isDirectory() || unresolvedMetadata.isSymbolicLink()) {
    fail("repository root must be one real directory.");
  }
  const selected = await realpath(unresolved);
  const metadata = await lstat(selected);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("resolved repository root must be one real directory.");
  }
  if (git(selected, ["rev-parse", "--show-toplevel"]) !== selected) {
    fail("repository root identity drifted.");
  }
  return selected;
}

export function cleanCheckoutV3(root) {
  if (
    git(root, ["diff", "--name-only"]) !== "" ||
    git(root, ["diff", "--cached", "--name-only"]) !== ""
  ) {
    fail("checkout contains tracked bytes that differ from HEAD.");
  }
}

function heldControl(control, label) {
  exactObject(control, [
    "version",
    "state",
    "allowsDeployment",
    "allowsCommercialDeployment",
    "allowsContainmentDeployment",
    "allowsPublicTruthReconciliationDeployment",
    "publicTruthReconciliation",
    "reason",
    "containmentReason",
    "updatedAt",
  ], `${label} release control`);
  if (
    control.version !== 3 ||
    control.state !== "hold" ||
    control.allowsDeployment !== false ||
    control.allowsCommercialDeployment !== false ||
    control.allowsContainmentDeployment !== false ||
    control.allowsPublicTruthReconciliationDeployment !== false
  ) {
    fail(`${label} must retain every broad deployment hold.`);
  }
  const lane = exactObject(control.publicTruthReconciliation, [
    "state",
    "requiredProductionPredecessor",
    "approvedCandidateSha",
    "authorityReceiptSha256",
    "reason",
  ], `${label} public-truth control`);
  if (
    lane.state !== "hold" ||
    !COMMIT.test(lane.requiredProductionPredecessor ?? "") ||
    lane.approvedCandidateSha !== null ||
    lane.authorityReceiptSha256 !== null
  ) {
    fail(`${label} public-truth authority must remain held and unset.`);
  }
  return control;
}

function enabledControl(control, receipt, receiptSha256) {
  exactObject(control, [
    "version",
    "state",
    "allowsDeployment",
    "allowsCommercialDeployment",
    "allowsContainmentDeployment",
    "allowsPublicTruthReconciliationDeployment",
    "publicTruthReconciliation",
    "reason",
    "containmentReason",
    "updatedAt",
  ], "publication release control");
  if (
    control.version !== 3 ||
    control.state !== "hold" ||
    control.allowsDeployment !== false ||
    control.allowsCommercialDeployment !== false ||
    control.allowsContainmentDeployment !== false ||
    control.allowsPublicTruthReconciliationDeployment !== true
  ) {
    fail("publication control may grant only public-truth Pages authority.");
  }
  const lane = exactObject(control.publicTruthReconciliation, [
    "state",
    "requiredProductionPredecessor",
    "approvedCandidateSha",
    "authorityReceiptSha256",
    "reason",
  ], "publication public-truth control");
  if (
    lane.state !== "cleared" ||
    lane.requiredProductionPredecessor !==
      receipt.lineage.pagesPredecessor.commitSha ||
    lane.approvedCandidateSha !== receipt.lineage.candidate.commitSha ||
    lane.authorityReceiptSha256 !== receiptSha256 ||
    control.updatedAt !== receipt.authority.issuedAt.slice(0, 10)
  ) {
    fail("publication control does not exactly bind the one-shot receipt.");
  }
  return control;
}

export function validateSuccessorGraph({
  root,
  candidateSha,
  successorControlSha,
  publicationControlSha,
}) {
  for (const [value, label] of [
    [candidateSha, "candidate"],
    [successorControlSha, "successor control"],
    [publicationControlSha, "publication control"],
  ]) exactCommit(value, label);

  exactArray(parents(root, successorControlSha), [candidateSha], "K' parents");
  exactArray(
    parents(root, publicationControlSha),
    [successorControlSha],
    "P' parents",
  );
  const successorPaths = [
    ciSuccessorInputPath(candidateSha),
  ].sort();
  exactArray(
    gitDiffPaths(root, candidateSha, successorControlSha),
    successorPaths,
    "K' changed paths",
  );
  exactArray(
    gitDiffPaths(root, successorControlSha, publicationControlSha),
    [RECEIPT_PATH_V3, "data/release-control.json"].sort(),
    "P' changed paths",
  );
  for (const selected of successorPaths) {
    if (gitPathExists(root, candidateSha, selected)) {
      fail("candidate must not contain candidate-specific successor evidence.");
    }
    if (!gitPathExists(root, successorControlSha, selected)) {
      fail("K' is missing exact candidate-specific successor evidence.");
    }
  }
  if (
    gitPathExists(root, candidateSha, RECEIPT_PATH_V3) ||
    gitPathExists(root, successorControlSha, RECEIPT_PATH_V3)
  ) {
    fail("C' and K' must not contain a publication authority receipt.");
  }
  for (const [file, expectedBlob] of Object.entries(IMMUTABLE_V2_BLOBS)) {
    if (gitBlob(root, candidateSha, file) !== expectedBlob) {
      fail(`immutable V2 bytes drifted: ${file}.`);
    }
  }
  for (const file of V3_PROOF_IDENTITY_PATHS) {
    const candidateBlob = gitBlob(root, candidateSha, file);
    if (
      gitBlob(root, successorControlSha, file) !== candidateBlob ||
      gitBlob(root, publicationControlSha, file) !== candidateBlob
    ) {
      fail(`candidate/control proof bytes drifted: ${file}.`);
    }
  }
  return Object.freeze({ successorPaths });
}

function authorityPayload(receipt) {
  return {
    schema: receipt.schema,
    repository: receipt.repository,
    lineage: receipt.lineage,
    successor: receipt.successor,
    manifests: receipt.manifests,
    browser: receipt.browser,
    authority: {
      scope: receipt.authority?.scope,
      environment: receipt.authority?.environment,
      issuer: receipt.authority?.issuer,
      issuedAt: receipt.authority?.issuedAt,
      notBefore: receipt.authority?.notBefore,
      expiresAt: receipt.authority?.expiresAt,
      oneShot: receipt.authority?.oneShot,
      statement: receipt.authority?.statement,
    },
    flags: receipt.flags,
  };
}

export function authorityDigestV3(receipt) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(authorityPayload(receipt))}\n`, "utf8"),
  );
}

export function createAuthorityReceiptV3({
  candidateSha,
  candidateTreeSha,
  successorControlSha,
  pagesPredecessor,
  ciInputSha256,
  ciInputDigest,
  sourceManifestSha256,
  pagesFileCount,
  pagesManifestSha256,
  issuedAt,
  notBefore = issuedAt,
  expiresAt,
} = {}) {
  const receipt = {
    schema: RECEIPT_SCHEMA_V3,
    repository: {
      id: REPOSITORY_ID_V3,
      fullName: REPOSITORY_FULL_NAME_V3,
    },
    lineage: {
      candidate: {
        commitSha: candidateSha,
        treeSha: candidateTreeSha,
      },
      successorControlSha,
      pagesPredecessor: structuredClone(pagesPredecessor),
    },
    successor: {
      ciInput: {
        path: ciSuccessorInputPath(candidateSha),
        sha256: ciInputSha256,
        digest: ciInputDigest,
      },
    },
    manifests: {
      sourceSha256: sourceManifestSha256,
      pages: {
        fileCount: pagesFileCount,
        manifestSha256: pagesManifestSha256,
      },
    },
    browser: structuredClone(REVIEWED_BROWSER_V3),
    authority: {
      scope: "public-truth-reconciliation-v3-only",
      environment: RELEASE_ENVIRONMENT_V3,
      issuer: {
        githubUserId: OWNER_GITHUB_USER_ID_V3,
        login: OWNER_LOGIN_V3,
      },
      issuedAt,
      notBefore,
      expiresAt,
      oneShot: true,
      statement: AUTHORITY_STATEMENT_V3,
      digest: null,
    },
    flags: {
      allowsGeneralDeployment: false,
      allowsHostedRuntime: false,
      allowsCommercialDeployment: false,
      allowsProviderEffects: false,
      allowsDnsMutation: false,
      allowsTunnelEffect: false,
      allowsPublicTruthPages: true,
    },
  };
  receipt.authority.digest = authorityDigestV3(receipt);
  return receipt;
}

export function createEnabledReleaseControlV3(
  held,
  receipt,
  receiptSha256,
) {
  heldControl(held, "candidate");
  exactDigest(receiptSha256, "authority receipt");
  return {
    ...structuredClone(held),
    allowsPublicTruthReconciliationDeployment: true,
    publicTruthReconciliation: {
      state: "cleared",
      requiredProductionPredecessor:
        receipt.lineage.pagesPredecessor.commitSha,
      approvedCandidateSha: receipt.lineage.candidate.commitSha,
      authorityReceiptSha256: receiptSha256,
      reason:
        "One exact successor-bound inquiry-only Pages publication is cleared; every hosted, commercial, provider, DNS, tunnel, containment, and general effect remains held.",
    },
    reason:
      "General and commercial deployment remain held; only the exact one-shot successor public-truth Pages lane is cleared.",
    updatedAt: receipt.authority.issuedAt.slice(0, 10),
  };
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${label} must be a positive safe integer.`);
  }
  return value;
}

export function validateAuthorityReceiptV3(receipt, context) {
  exactObject(receipt, [
    "schema",
    "repository",
    "lineage",
    "successor",
    "manifests",
    "browser",
    "authority",
    "flags",
  ], "V3 owner authority receipt");
  if (receipt.schema !== RECEIPT_SCHEMA_V3) {
    fail("V3 owner authority receipt schema is invalid.");
  }
  const repository = exactObject(
    receipt.repository,
    ["id", "fullName"],
    "receipt repository",
  );
  if (
    repository.id !== REPOSITORY_ID_V3 ||
    repository.fullName !== REPOSITORY_FULL_NAME_V3
  ) fail("receipt repository identity drifted.");

  const lineage = exactObject(receipt.lineage, [
    "candidate",
    "successorControlSha",
    "pagesPredecessor",
  ], "receipt lineage");
  const candidate = exactObject(
    lineage.candidate,
    ["commitSha", "treeSha"],
    "receipt candidate",
  );
  if (
    candidate.commitSha !== context.candidateSha ||
    candidate.treeSha !== context.candidateTreeSha ||
    lineage.successorControlSha !== context.successorControlSha
  ) fail("receipt C'/K'/P' lineage drifted.");
  const predecessor = exactObject(
    lineage.pagesPredecessor,
    ["deploymentId", "commitSha"],
    "Pages predecessor",
  );
  if (
    typeof predecessor.deploymentId !== "string" ||
    !DECIMAL.test(predecessor.deploymentId)
  ) fail("Pages predecessor deployment ID must be decimal.");
  exactCommit(predecessor.commitSha, "Pages predecessor");

  const successor = exactObject(
    receipt.successor,
    ["ciInput"],
    "receipt successor",
  );
  const ciInput = exactObject(
    successor.ciInput,
    ["path", "sha256", "digest"],
    "receipt CI input",
  );
  if (
    ciInput.path !== ciSuccessorInputPath(context.candidateSha) ||
    ciInput.sha256 !== context.ciInputSha256 ||
    ciInput.digest !== context.ciInput.digest
  ) fail("receipt successor evidence drifted.");

  const manifests = exactObject(
    receipt.manifests,
    ["sourceSha256", "pages"],
    "receipt manifests",
  );
  const pages = exactObject(
    manifests.pages,
    ["fileCount", "manifestSha256"],
    "receipt Pages manifest",
  );
  if (
    manifests.sourceSha256 !== context.sourceManifestSha256 ||
    pages.fileCount !== context.ciInput.legalV4Pages.fileCount ||
    pages.manifestSha256 !==
      context.ciInput.legalV4Pages.manifestSha256
  ) fail("receipt source or successor-derived Pages manifest drifted.");
  exactDigest(manifests.sourceSha256, "source manifest");
  positiveInteger(pages.fileCount, "Pages file count");
  exactDigest(pages.manifestSha256, "Pages manifest");

  const browser = exactObject(
    receipt.browser,
    ["version", "widths", "routeCount", "viewCount"],
    "receipt browser",
  );
  if (
    browser.version !== REVIEWED_BROWSER_V3.version ||
    canonicalJson(browser.widths) !== canonicalJson(REVIEWED_BROWSER_V3.widths) ||
    browser.routeCount !== REVIEWED_BROWSER_V3.routeCount ||
    browser.viewCount !== REVIEWED_BROWSER_V3.viewCount ||
    browser.widths.length !== 6 ||
    browser.viewCount !== browser.routeCount * browser.widths.length
  ) fail("receipt browser identity or six-width contract drifted.");

  const authority = exactObject(receipt.authority, [
    "scope",
    "environment",
    "issuer",
    "issuedAt",
    "notBefore",
    "expiresAt",
    "oneShot",
    "statement",
    "digest",
  ], "receipt authority");
  const issuer = exactObject(
    authority.issuer,
    ["githubUserId", "login"],
    "receipt issuer",
  );
  if (
    authority.scope !== "public-truth-reconciliation-v3-only" ||
    authority.environment !== RELEASE_ENVIRONMENT_V3 ||
    authority.oneShot !== true ||
    authority.statement !== AUTHORITY_STATEMENT_V3 ||
    issuer.githubUserId !== OWNER_GITHUB_USER_ID_V3 ||
    issuer.login !== OWNER_LOGIN_V3 ||
    context.actorId !== OWNER_GITHUB_USER_ID_V3 ||
    context.actor !== OWNER_LOGIN_V3
  ) fail("receipt owner or one-shot authority is invalid.");
  const issuedAt = Date.parse(exactInstant(authority.issuedAt, "issuedAt"));
  const notBefore = Date.parse(exactInstant(authority.notBefore, "notBefore"));
  const expiresAt = Date.parse(exactInstant(authority.expiresAt, "expiresAt"));
  if (
    issuedAt > notBefore ||
    notBefore - issuedAt > MAX_CLOCK_SKEW_MS_V3 ||
    issuedAt > context.now + MAX_CLOCK_SKEW_MS_V3 ||
    notBefore > context.now ||
    context.now >= expiresAt ||
    expiresAt - issuedAt < 1 ||
    expiresAt - issuedAt > MAX_AUTHORITY_LIFETIME_MS_V3
  ) fail("receipt authority is not valid within its exact one-hour window.");

  const flags = exactObject(receipt.flags, [
    "allowsGeneralDeployment",
    "allowsHostedRuntime",
    "allowsCommercialDeployment",
    "allowsProviderEffects",
    "allowsDnsMutation",
    "allowsTunnelEffect",
    "allowsPublicTruthPages",
  ], "receipt authority flags");
  if (
    flags.allowsGeneralDeployment !== false ||
    flags.allowsHostedRuntime !== false ||
    flags.allowsCommercialDeployment !== false ||
    flags.allowsProviderEffects !== false ||
    flags.allowsDnsMutation !== false ||
    flags.allowsTunnelEffect !== false ||
    flags.allowsPublicTruthPages !== true
  ) fail("receipt attempted to lift an effect outside inquiry-only Pages.");
  if (authority.digest !== authorityDigestV3(receipt)) {
    fail("receipt authority digest is invalid.");
  }
  return Object.freeze(structuredClone(receipt));
}

function browserProofPayload(value) {
  return {
    schema: value.schema,
    result: value.result,
    artifact: value.artifact,
    browser: value.browser,
    routes: value.routes,
    routeCount: value.routeCount,
    viewCount: value.viewCount,
  };
}

export function browserProofDigestV3(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(browserProofPayload(value))}\n`, "utf8"),
  );
}

export function validateBrowserProofV3(value, { manifest } = {}) {
  exactObject(value, [
    "schema",
    "result",
    "artifact",
    "browser",
    "routes",
    "routeCount",
    "viewCount",
    "digest",
  ], "V3 browser proof");
  if (value.schema !== BROWSER_PROOF_SCHEMA || value.result !== "pass") {
    fail("V3 browser proof result is invalid.");
  }
  const artifact = exactObject(
    value.artifact,
    ["fileCount", "manifestSha256"],
    "browser proof artifact",
  );
  if (
    artifact.fileCount !== manifest?.count ||
    artifact.manifestSha256 !== manifest?.sha256
  ) fail("browser proof artifact identity drifted.");
  const browser = exactObject(
    value.browser,
    ["version", "widths"],
    "browser proof browser",
  );
  if (
    browser.version !== REVIEWED_BROWSER_V3.version ||
    canonicalJson(browser.widths) !== canonicalJson(REVIEWED_BROWSER_V3.widths) ||
    browser.widths.length !== 6 ||
    canonicalJson(value.routes) !== canonicalJson(CANONICAL_ROUTES) ||
    value.routeCount !== value.routes.length ||
    value.routeCount !== REVIEWED_BROWSER_V3.routeCount ||
    value.viewCount !== value.routeCount * browser.widths.length ||
    value.viewCount !== REVIEWED_BROWSER_V3.viewCount
  ) fail("browser proof route, width, or view count drifted.");
  if (value.digest !== browserProofDigestV3(value)) {
    fail("browser proof digest is invalid.");
  }
  return Object.freeze(structuredClone(value));
}

export async function createBrowserProofV3({ artifactRoot } = {}) {
  const manifest = await artifactManifest(path.resolve(artifactRoot));
  const result = await auditArtifactFromSitemap(path.resolve(artifactRoot));
  const value = {
    schema: BROWSER_PROOF_SCHEMA,
    result: "pass",
    artifact: {
      fileCount: manifest.count,
      manifestSha256: manifest.sha256,
    },
    browser: {
      version: REVIEWED_BROWSER_V3.version,
      widths: [...REVIEWED_BROWSER_V3.widths],
    },
    routes: [...result.routes],
    routeCount: result.routes.length,
    viewCount: result.viewCount,
  };
  value.digest = browserProofDigestV3(value);
  return validateBrowserProofV3(value, { manifest });
}

async function writeBrowserProof(selected, proof) {
  if (!path.isAbsolute(selected) || path.basename(selected) !== "public-truth-browser-proof-v3.json") {
    fail("browser proof path must be absolute public-truth-browser-proof-v3.json.");
  }
  await writeFile(selected, `${canonicalJson(proof)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function workflowContext(environment, publicationControlSha) {
  if (
    environment.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    environment.GITHUB_REF !== "refs/heads/main" ||
    environment.GITHUB_RUN_ATTEMPT !== "1" ||
    environment.GITHUB_REPOSITORY !== REPOSITORY_FULL_NAME_V3 ||
    environment.GITHUB_REPOSITORY_ID !== REPOSITORY_ID_V3 ||
    environment.GITHUB_ACTOR !== OWNER_LOGIN_V3 ||
    environment.GITHUB_ACTOR_ID !== OWNER_GITHUB_USER_ID_V3 ||
    environment.GITHUB_SHA !== publicationControlSha ||
    environment.GITHUB_WORKFLOW_SHA !== publicationControlSha ||
    environment.PUBLIC_TRUTH_V3_FIRST_USE !== "verified" ||
    !DECIMAL.test(environment.GITHUB_RUN_ID ?? "")
  ) {
    fail("workflow identity, first-use gate, or owner context is invalid.");
  }
  return {
    actor: environment.GITHUB_ACTOR,
    actorId: environment.GITHUB_ACTOR_ID,
    runId: environment.GITHUB_RUN_ID,
  };
}

export function validateFirstUseWorkflowRuns(payload, {
  publicationControlSha,
  runId,
  authorityReceiptSha256,
} = {}) {
  exactCommit(publicationControlSha, "publication control");
  exactDigest(authorityReceiptSha256, "authority receipt");
  if (typeof runId !== "string" || !DECIMAL.test(runId)) {
    fail("current workflow run ID must be decimal.");
  }
  const pages = Array.isArray(payload) ? payload : [payload];
  if (pages.length === 0) fail("workflow-run inventory has no pages.");
  const allRuns = [];
  let totalCount = null;
  for (const page of pages) {
    if (
      !page ||
      typeof page !== "object" ||
      !Number.isSafeInteger(page.total_count) ||
      page.total_count < 0 ||
      !Array.isArray(page.workflow_runs)
    ) fail("workflow-run inventory is malformed.");
    if (totalCount === null) totalCount = page.total_count;
    if (page.total_count !== totalCount) {
      fail("workflow-run inventory total changed between pages.");
    }
    allRuns.push(...page.workflow_runs);
  }
  if (allRuns.length !== totalCount) {
    fail("workflow-run inventory is incomplete.");
  }
  const runIds = new Set();
  for (const run of allRuns) {
    if (!Number.isSafeInteger(run?.id) || run.id <= 0 || runIds.has(run.id)) {
      fail("workflow-run inventory contains an invalid or duplicate run ID.");
    }
    runIds.add(run.id);
  }
  const expectedTitle = `public-truth-v3-${authorityReceiptSha256}`;
  const matching = allRuns.filter((run) => run?.display_title === expectedTitle);
  if (matching.length !== 1) {
    fail("one-shot authority has already been used or cannot be proven unique.");
  }
  const [selected] = matching;
  if (
    String(selected?.id) !== runId ||
    selected?.run_attempt !== 1 ||
    selected?.event !== "workflow_dispatch" ||
    selected?.head_sha !== publicationControlSha ||
    selected?.path !== WORKFLOW_PATH_V3 ||
    selected?.display_title !== expectedTitle
  ) fail("current run is not the unique first use of P'.");
  return Object.freeze({
    publicationControlSha,
    runId,
    authorityReceiptSha256,
    firstUse: true,
  });
}

export function collectWorkflowRunPagesV3(fetchPage, {
  perPage = 100,
  maxPages = 100,
} = {}) {
  if (
    typeof fetchPage !== "function" ||
    !Number.isSafeInteger(perPage) ||
    perPage < 1 ||
    perPage > 100 ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 100
  ) fail("workflow-run page collector bounds are invalid.");

  const pages = [];
  let collected = 0;
  let totalCount = null;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = fetchPage(pageNumber, perPage);
    if (
      !page ||
      typeof page !== "object" ||
      !Number.isSafeInteger(page.total_count) ||
      page.total_count < 0 ||
      !Array.isArray(page.workflow_runs) ||
      page.workflow_runs.length > perPage
    ) fail("workflow-run page response is malformed.");
    if (totalCount === null) {
      totalCount = page.total_count;
      if (totalCount > perPage * maxPages) {
        fail("workflow-run inventory exceeds the bounded page collector.");
      }
    }
    pages.push(page);
    collected += page.workflow_runs.length;
    if (collected >= totalCount) break;
    if (page.workflow_runs.length !== perPage) {
      fail("workflow-run page response ended before the declared total.");
    }
  }
  if (collected !== totalCount) {
    fail("workflow-run inventory could not be collected completely.");
  }
  return Object.freeze(pages);
}

function fetchGitHubWorkflowRunsPageV3(pageNumber, perPage, environment) {
  const endpoint =
    `repos/${REPOSITORY_FULL_NAME_V3}/actions/workflows/`
    + `public-truth-reconciliation-v3.yml/runs?event=workflow_dispatch`
    + `&per_page=${perPage}&page=${pageNumber}`;
  const result = spawnSync("gh", [
    "api",
    "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2022-11-28",
    endpoint,
  ], {
    encoding: "utf8",
    env: environment,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    fail("GitHub workflow-run page could not be read.");
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail("GitHub workflow-run page is not valid JSON.");
  }
}

async function writeWorkflowRunPagesV3(selected, pages) {
  if (!path.isAbsolute(selected) || path.basename(selected) !== "public-truth-v3-runs.json") {
    fail("workflow-run inventory path must be absolute public-truth-v3-runs.json.");
  }
  await writeFile(selected, `${canonicalJson(pages)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

async function readRegularAnchoredFile(selected, expectedSha256, label) {
  exactDigest(expectedSha256, `${label} digest`);
  const metadata = await lstat(selected);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`${label} must be one regular non-symlink file.`);
  }
  const bytes = await readFile(selected);
  if (sha256Bytes(bytes) !== expectedSha256) {
    fail(`${label} bytes drifted from their explicit digest.`);
  }
  return bytes;
}

export function validatePagesObservationV3(observation, receipt) {
  exactObject(observation, [
    "url",
    "status",
    "error",
    "pusher",
    "commit",
    "duration",
    "created_at",
    "updated_at",
  ], "Pages predecessor observation");
  const observedAt = Date.parse(observation.updated_at ?? "");
  const normalizedObservedAt = Number.isFinite(observedAt)
    ? new Date(observedAt).toISOString().replace(".000Z", "Z")
    : null;
  if (
    observation.status !== "built" ||
    observation.error?.message !== null ||
    observation.commit !== receipt.lineage.pagesPredecessor.commitSha ||
    observation.url !==
      `https://api.github.com/repos/${REPOSITORY_FULL_NAME_V3}/pages/builds/${receipt.lineage.pagesPredecessor.deploymentId}` ||
    typeof observation.updated_at !== "string" ||
    !GITHUB_TIME.test(observation.updated_at) ||
    normalizedObservedAt !== observation.updated_at ||
    observedAt > Date.parse(receipt.authority.issuedAt)
  ) {
    fail("Pages predecessor observation drifted or postdates owner authority.");
  }
  return observation;
}

async function verifyAuthorizedState({
  root,
  candidateRoot,
  artifactRoot,
  candidateSha,
  successorControlSha,
  publicationControlSha,
  successorInputSha256,
  authorityReceiptSha256,
  browserProof,
  browserProofSha256,
  environment,
  now = Date.now(),
  requireRemaining = false,
  requirePagesObservation = true,
}) {
  const publicationRoot = await canonicalRootV3(root);
  const exactCandidateRoot = await canonicalRootV3(candidateRoot);
  if (
    git(publicationRoot, ["rev-parse", "HEAD"]) !== publicationControlSha ||
    git(exactCandidateRoot, ["rev-parse", "HEAD"]) !== candidateSha
  ) fail("publication or candidate checkout HEAD drifted.");
  cleanCheckoutV3(publicationRoot);
  cleanCheckoutV3(exactCandidateRoot);
  validateSuccessorGraph({
    root: publicationRoot,
    candidateSha,
    successorControlSha,
    publicationControlSha,
  });
  const runtime = workflowContext(environment, publicationControlSha);

  const receiptPath = path.join(
    publicationRoot,
    ...RECEIPT_PATH_V3.split("/"),
  );
  const receiptBytes = await readRegularAnchoredFile(
    receiptPath,
    authorityReceiptSha256,
    "V3 owner authority receipt",
  );
  if (!receiptBytes.equals(gitFile(
    publicationRoot,
    publicationControlSha,
    RECEIPT_PATH_V3,
  ))) fail("owner authority receipt differs from P' bytes.");
  const receipt = parseStrictJson(receiptBytes.toString("utf8"));

  const ciPath = path.join(
    publicationRoot,
    ...ciSuccessorInputPath(candidateSha).split("/"),
  );
  const ciInput = await readCiReleaseSuccessorInput({
    inputPath: ciPath,
    expectedSha256: successorInputSha256,
  });
  await verifyCiReleaseCandidate({
    projectRoot: exactCandidateRoot,
    successorInput: ciInput,
  });
  const candidateTreeSha = git(
    exactCandidateRoot,
    ["rev-parse", `${candidateSha}^{tree}`],
  );
  if (
    candidateTreeSha !== ciInput.originReleaseInput.epoch.source.treeSha ||
    candidateSha !== ciInput.originReleaseInput.epoch.source.commitSha
  ) fail("candidate source identity drifted from successor authority.");
  const selectedArtifactRoot = path.resolve(artifactRoot);
  await verifyCiLegalV4Artifact({
    projectRoot: exactCandidateRoot,
    artifactRoot: selectedArtifactRoot,
    successorInput: ciInput,
  });
  const publicManifest = await artifactManifest(selectedArtifactRoot);
  let selectedBrowserProof = null;
  if (browserProof !== undefined) {
    const browserBytes = await readRegularAnchoredFile(
      path.resolve(browserProof),
      browserProofSha256,
      "V3 browser proof",
    );
    selectedBrowserProof = validateBrowserProofV3(
      parseStrictJson(browserBytes.toString("utf8")),
      { manifest: publicManifest },
    );
  }
  const sourceManifest = sourceManifestFromGit(exactCandidateRoot, candidateSha);
  validateAuthorityReceiptV3(receipt, {
    ...runtime,
    now,
    candidateSha,
    candidateTreeSha,
    successorControlSha,
    publicationControlSha,
    ciInput,
    ciInputSha256: successorInputSha256,
    sourceManifestSha256: sourceManifest.sha256,
  });

  const candidateControl = parseStrictJson(
    gitFile(
      publicationRoot,
      candidateSha,
      "data/release-control.json",
    ).toString("utf8"),
  );
  const successorControl = parseStrictJson(
    gitFile(
      publicationRoot,
      successorControlSha,
      "data/release-control.json",
    ).toString("utf8"),
  );
  const publicationControl = parseStrictJson(
    gitFile(
      publicationRoot,
      publicationControlSha,
      "data/release-control.json",
    ).toString("utf8"),
  );
  heldControl(candidateControl, "candidate");
  heldControl(successorControl, "successor control");
  enabledControl(publicationControl, receipt, authorityReceiptSha256);
  if (requirePagesObservation) {
    validatePagesObservationV3(
      parseStrictJson(
        await readFile(path.join(publicationRoot, "pages-latest.json"), "utf8"),
      ),
      receipt,
    );
  }
  if (requireRemaining) {
    requirePredeployAuthorityBudgetV3({
      expiresAt: receipt.authority.expiresAt,
      now,
    });
  }
  return {
    candidateTreeSha,
    ciInput,
    publicManifest,
    browserProof: selectedBrowserProof,
    receipt,
    receiptSha256: authorityReceiptSha256,
    sourceManifest,
    runtime,
  };
}

export async function verifyControlV3(options = {}) {
  const state = await verifyAuthorizedState({
    ...options,
    requireRemaining: false,
  });
  if (!state.browserProof) fail("control verification requires machine-bound browser proof.");
  return Object.freeze({
    mode: "control",
    candidateSha: options.candidateSha,
    successorControlSha: options.successorControlSha,
    publicationControlSha: options.publicationControlSha,
    authorityReceiptSha256: state.receiptSha256,
    pagesFileCount: state.ciInput.legalV4Pages.fileCount,
    pagesManifestSha256: state.ciInput.legalV4Pages.manifestSha256,
    browser: structuredClone(REVIEWED_BROWSER_V3),
    authority: "PUBLIC_TRUTH_V3_ONLY",
  });
}

export async function verifyPredeployV3(options = {}) {
  const state = await verifyAuthorizedState({
    ...options,
    requireRemaining: true,
  });
  return Object.freeze({
    mode: "predeploy",
    candidateSha: options.candidateSha,
    successorControlSha: options.successorControlSha,
    publicationControlSha: options.publicationControlSha,
    authorityReceiptSha256: state.receiptSha256,
    pagesManifestSha256: state.ciInput.legalV4Pages.manifestSha256,
    authority: "PUBLIC_TRUTH_V3_ONLY",
  });
}

async function writePostdeployEvidence(selected, body) {
  if (
    !path.isAbsolute(selected) ||
    path.basename(selected) !== POSTDEPLOY_EVIDENCE_FILE_V3
  ) fail(`evidence path must end in ${POSTDEPLOY_EVIDENCE_FILE_V3}.`);
  const proof = {
    ...body,
    proofSha256: sha256(stableStringify(body)),
  };
  await writeFile(selected, `${stableStringify(proof)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

export async function verifyPostdeployV3(options = {}) {
  const now = options.now ?? Date.now();
  const state = await verifyAuthorizedState({
    ...options,
    now,
    requireRemaining: false,
    requirePagesObservation: false,
  });
  if (
    options.deploymentStatus !== "succeed" ||
    options.deploymentPageUrl !== "https://sitesourcery.com/"
  ) fail("Pages deployment result or canonical URL is invalid.");
  const poll = options.pollLive ?? pollLiveProduction;
  const verifyRoutes =
    options.verifyRoutes ?? verifyProductionRouteContract;
  const live = await poll({
    manifest: state.publicManifest,
    origin: "https://sitesourcery.com",
  });
  await verifyRoutes({
    artifactRoot: options.artifactRoot,
    manifest: state.publicManifest,
    finalSnapshot: live.finalSnapshot,
  });
  const publishedAt = postdeployPublishedAtV3({
    startedAt: now,
    completedAt: options.clock?.() ?? Date.now(),
    expiresAt: state.receipt.authority.expiresAt,
  });
  const evidence = {
    schema: "sitesourcery.postdeploy-production-proof/v3",
    result: "pass",
    generatedAt: publishedAt,
    publishedAt,
    candidateSha: options.candidateSha,
    candidateTreeSha: state.candidateTreeSha,
    successorControlSha: options.successorControlSha,
    publicationControlSha: options.publicationControlSha,
    authorityReceiptSha256: state.receiptSha256,
    successorInputDigest: state.ciInput.digest,
    pagesManifestSha256: state.ciInput.legalV4Pages.manifestSha256,
    pagesFileCount: state.ciInput.legalV4Pages.fileCount,
    live: {
      attempts: live.attempts,
      completedAtMs: live.completedAtMs,
      origin: live.origin,
    },
  };
  await writePostdeployEvidence(options.evidence, evidence);
  return Object.freeze({ mode: "postdeploy", ...evidence });
}

export function postdeployPublishedAtV3({ startedAt, completedAt, expiresAt }) {
  const expiry = Date.parse(exactInstant(expiresAt, "authority expiry"));
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(completedAt) ||
    completedAt < startedAt ||
    completedAt >= expiry
  ) fail("successful live proof completed outside the owner authority window.");
  return new Date(completedAt).toISOString();
}

export function requirePredeployAuthorityBudgetV3({ expiresAt, now }) {
  const expiry = Date.parse(exactInstant(expiresAt, "authority expiry"));
  if (
    !Number.isFinite(now)
    || expiry - now < MIN_PREDEPLOY_REMAINING_MS_V3
  ) {
    fail(
      "predeploy authority has less than the required "
      + `${MIN_PREDEPLOY_REMAINING_MS_V3 / (60 * 1000)}-minute `
      + "deploy, live-proof, and safety budget.",
    );
  }
  return expiry - now;
}

export function parseCliV3(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !flag?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--") ||
      values.has(flag)
    ) fail("CLI requires unique flag/value pairs.");
    values.set(flag, value);
  }
  const mode = values.get("--mode");
  if (!["browser", "runs", "control", "predeploy", "postdeploy"].includes(mode)) {
    fail("mode must be browser, runs, control, predeploy, or postdeploy.");
  }
  const expected = (mode === "browser" || mode === "runs" ? [
    "--mode",
    ...(mode === "browser" ? ["--artifact-root"] : []),
    "--evidence",
  ] : [
    "--mode",
    "--root",
    "--candidate-root",
    "--artifact-root",
    "--candidate-sha",
    "--successor-control-sha",
    "--publication-control-sha",
    "--successor-input-sha256",
    "--authority-receipt-sha256",
    ...(mode === "control" ? [
      "--browser-proof",
      "--browser-proof-sha256",
    ] : []),
    ...(mode === "postdeploy" ? [
      "--deployment-page-url",
      "--deployment-status",
      "--evidence",
    ] : []),
  ]).sort();
  exactArray([...values.keys()].sort(), expected, `${mode} CLI flags`);
  return Object.fromEntries([...values].map(([key, value]) => [
    key.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase()),
    value,
  ]));
}

export async function runCliV3(
  argv = process.argv.slice(2),
  environment = process.env,
) {
  const options = parseCliV3(argv);
  if (options.mode === "browser") {
    const proof = await createBrowserProofV3(options);
    await writeBrowserProof(options.evidence, proof);
    return Object.freeze({ mode: "browser", ...proof });
  }
  if (options.mode === "runs") {
    const pages = collectWorkflowRunPagesV3((pageNumber, perPage) => (
      fetchGitHubWorkflowRunsPageV3(pageNumber, perPage, environment)
    ));
    await writeWorkflowRunPagesV3(options.evidence, pages);
    return Object.freeze({ mode: "runs", pageCount: pages.length });
  }
  const selected = { ...options, environment };
  if (options.mode === "control") return verifyControlV3(selected);
  if (options.mode === "predeploy") return verifyPredeployV3(selected);
  try {
    return await verifyPostdeployV3(selected);
  } catch (error) {
    try {
      await writePostdeployEvidence(options.evidence, {
        schema: "sitesourcery.postdeploy-production-proof/v3",
        result: "fail",
        generatedAt: new Date().toISOString(),
        publishedAt: null,
        candidateSha: options.candidateSha ?? null,
        successorControlSha: options.successorControlSha ?? null,
        publicationControlSha: options.publicationControlSha ?? null,
        error: String(error?.message ?? error).replace(/\s+/gu, " ").slice(0, 500),
      });
    } catch (evidenceError) {
      fail(
        `${error.message}; failure evidence could not be preserved: `
        + String(evidenceError?.message ?? evidenceError).slice(0, 300),
      );
    }
    throw error;
  }
}

async function main() {
  const result = await runCliV3();
  console.log(
    `PUBLIC_TRUTH_RELEASE_V3_${result.mode.toUpperCase()}_PASS ${JSON.stringify(result)}`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`PUBLIC_TRUTH_RELEASE_V3_DENIED ${error.message}`);
    process.exitCode = 1;
  });
}
