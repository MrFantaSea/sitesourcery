import { spawnSync } from "node:child_process";
import {
  lstat,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicFileAllowlist } from "./build-pages.mjs";
import {
  PAGES_JOINT_LEGAL_V3_ROOT,
  PAGES_JOINT_LEGAL_V3_RECEIPT,
  PAGES_JOINT_LEGAL_V4_RECEIPT,
} from "./hosted-truth/pages-legal-v4.mjs";
import { JOINT_LEGAL_V3_RELEASE } from "./hosted-truth/joint-legal-v3-artifacts.mjs";
import { JOINT_LEGAL_V4_RELEASE } from "./hosted-truth/joint-legal-v4-artifacts.mjs";
import {
  PublicTruthVerificationError,
  artifactManifest,
  gitDiffPaths,
  parseStrictJson,
  pollLiveProduction,
  sha256,
  sourceManifestFromGit,
  stableStringify,
  validateArtifactSafety,
  verifyProductionRouteContract,
} from "./verify-public-truth-release.mjs";

export const RECEIPT_SCHEMA_V2 = "sitesourcery.public-truth-authority/v2";
export const RECEIPT_PATH_V2 = "data/public-truth-authority-v2.json";
export const WORKFLOW_PATH_V2 =
  ".github/workflows/public-truth-reconciliation-v2.yml";
export const RELEASE_BASE_SHA = "84aca6b757a806b428ae0cce8115c12dcc6486cd";
export const GITHUB_MAIN_SHA = "614e971458ef5d14b9179c0fe17edcf3ce2acc09";
export const PRODUCTION_PREDECESSOR_SHA_V2 =
  "eff8195640db58390d03eefbe863248220994e37";
export const REPOSITORY_FULL_NAME_V2 = "MrFantaSea/sitesourcery";
export const REPOSITORY_ID_V2 = "1296712694";
export const OWNER_LOGIN_V2 = "MrFantaSea";
export const OWNER_GITHUB_USER_ID_V2 = "293072489";
export const RELEASE_ENVIRONMENT_V2 = "github-pages";
export const SOURCE_CATALOG_DIGEST_V2 =
  "0474cd8a48b0b28760e6aa1696eb0021de02f5420646a44efae625bba6a74bcc";
export const PUBLIC_PROJECTION_DIGEST_V2 =
  "5276e2f38096625428814677518ffaaf6063f07f78169be20b8bf4ac5d511225";
export const V3_RECEIPT_SHA256 =
  "d0038d91ad96f0b2c00c544fc4ad7fa9d2f0014114fba507715a8c5943430760";
export const V4_RECEIPT_SHA256 =
  "e31102f1b4b5603b00f404b2b0e1ee1f57cc73cab94b2f0f5f163f1f43d255c9";
export const AUTHORITY_STATEMENT_V2 =
  "Authorize one exact held, inquiry-only GitHub Pages publication with sealed Legal V4 and immutable V2/V3/V4 evidence; deny automated checkout, payment-provider, runtime, customer-data, containment, DNS, tunnel, and general deployment authority.";
export const MAX_AUTHORITY_LIFETIME_MS_V2 = 60 * 60 * 1000;
export const MIN_PREDEPLOY_REMAINING_MS_V2 = 5 * 60 * 1000;
export const MAX_CLOCK_SKEW_MS_V2 = 5 * 60 * 1000;
export const POSTDEPLOY_EVIDENCE_FILE_V2 =
  "public-truth-production-proof-v2.json";

export const PREPARATION_CHANGED_PATHS = Object.freeze([
  ".github/workflows/public-truth-reconciliation-v2.yml",
  "package.json",
  "scripts/browser-audit-vnext.mjs",
  "scripts/build-pages.mjs",
  "scripts/hosted-truth/pages-legal-v4.mjs",
  "scripts/test/browser-release-gate.test.mjs",
  "scripts/test/pages-legal-v4.test.mjs",
  "scripts/test/public-truth-release-v2.test.mjs",
  "scripts/verify-public-truth-release-v2.mjs",
  "scripts/verify-public-truth-release.mjs",
]);

export const CONTROL_CHANGED_PATHS_V2 = Object.freeze([
  RECEIPT_PATH_V2,
  "data/release-control.json",
].sort());

export const FROZEN_BASE_BLOBS_V2 = Object.freeze({
  "package-lock.json": "4e47a95cc23950e84e02a91d05e8476cdc30fc7a",
});

export const REVIEWED_PUBLIC_ARTIFACT_PATHS_V2 = Object.freeze([
  ...new Set([
    ...publicFileAllowlist,
    `legal/privacy/versions/${JOINT_LEGAL_V3_RELEASE.privacyVersion}/index.html`,
    `legal/privacy/versions/${JOINT_LEGAL_V4_RELEASE.privacyVersion}/index.html`,
    `legal/website-terms/versions/${JOINT_LEGAL_V3_RELEASE.websiteTermsVersion}/index.html`,
    `legal/website-terms/versions/${JOINT_LEGAL_V4_RELEASE.websiteTermsVersion}/index.html`,
  ]),
].sort());

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DECIMAL = /^[1-9][0-9]*$/u;
const EXACT_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u;
const GITHUB_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

function fail(message) {
  throw new PublicTruthVerificationError(message);
}

function exact(value, expected, label) {
  if (value !== expected) fail(`${label} must be ${expected}`);
  return value;
}

function digest(value, label, length = 64) {
  const expression = length === 40 ? SHA1 : SHA256;
  if (typeof value !== "string" || !expression.test(value)) {
    fail(`${label} must be one full lowercase ${length === 40 ? "commit" : "SHA-256"}`);
  }
  return value;
}

function decimal(value, label) {
  if (typeof value !== "string" || !DECIMAL.test(value)) fail(`${label} must be a decimal ID`);
  return value;
}

function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (stableStringify(actual) !== stableStringify(expected)) {
    fail(`${label} keys must be exactly ${expected.join(", ")}`);
  }
  return value;
}

function array(value, expected, label) {
  if (!Array.isArray(value) || stableStringify(value) !== stableStringify(expected)) {
    fail(`${label} must equal its exact reviewed ledger`);
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !EXACT_TIME.test(value)) fail(`${label} must be whole-second UTC`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail(`${label} is invalid`);
  return parsed;
}

function git(root, args, { binary = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: binary ? null : "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const stderr = binary ? result.stderr.toString("utf8") : result.stderr;
    fail(`git ${args.join(" ")} failed: ${stderr.trim()}`);
  }
  return binary ? result.stdout : result.stdout.trim();
}

function parents(root, revision) {
  digest(revision, "revision", 40);
  const words = git(root, ["rev-list", "--parents", "-n", "1", revision]).split(/\s+/u);
  if (words[0] !== revision) fail("commit identity changed during verification");
  return words.slice(1);
}

function readGit(root, revision, file) {
  return git(root, ["cat-file", "blob", `${revision}:${file}`], { binary: true });
}

function heldControl(control, label = "candidate") {
  object(control, [
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
    control.version !== 3
    || control.state !== "hold"
    || control.allowsDeployment !== false
    || control.allowsCommercialDeployment !== false
    || control.allowsContainmentDeployment !== false
    || control.allowsPublicTruthReconciliationDeployment !== false
  ) fail(`${label} must keep every deployment authority held`);
  const lane = object(control.publicTruthReconciliation, [
    "state",
    "requiredProductionPredecessor",
    "approvedCandidateSha",
    "authorityReceiptSha256",
    "reason",
  ], `${label} public-truth control`);
  if (
    lane.state !== "hold"
    || lane.requiredProductionPredecessor !== PRODUCTION_PREDECESSOR_SHA_V2
    || lane.approvedCandidateSha !== null
    || lane.authorityReceiptSha256 !== null
  ) fail(`${label} public-truth identity must remain held and unset`);
  return control;
}

function enabledControl(control, receipt, receiptSha256) {
  object(control, [
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
  ], "control release control");
  if (
    control.version !== 3
    || control.state !== "hold"
    || control.allowsDeployment !== false
    || control.allowsCommercialDeployment !== false
    || control.allowsContainmentDeployment !== false
    || control.allowsPublicTruthReconciliationDeployment !== true
  ) fail("control commit may grant only public-truth reconciliation");
  const lane = object(control.publicTruthReconciliation, [
    "state",
    "requiredProductionPredecessor",
    "approvedCandidateSha",
    "authorityReceiptSha256",
    "reason",
  ], "enabled public-truth control");
  if (
    lane?.state !== "cleared"
    || lane.requiredProductionPredecessor !== PRODUCTION_PREDECESSOR_SHA_V2
    || lane.approvedCandidateSha !== receipt.lineage.candidate
    || lane.authorityReceiptSha256 !== receiptSha256
    || control.updatedAt !== receipt.authority.issuedAt.slice(0, 10)
  ) fail("control commit does not exactly bind the one-shot receipt");
  return control;
}

export function computeReleaseEpochSha256V2(receipt) {
  const authority = receipt.authority ?? {};
  return sha256(stableStringify({
    schema: receipt.schema,
    repository: receipt.repository,
    lineage: receipt.lineage,
    changedPaths: receipt.changedPaths,
    manifests: receipt.manifests,
    catalog: receipt.catalog,
    legal: receipt.legal,
    authority: {
      scope: authority.scope,
      environment: authority.environment,
      issuer: authority.issuer,
      issuedAt: authority.issuedAt,
      notBefore: authority.notBefore,
      expiresAt: authority.expiresAt,
      oneShot: authority.oneShot,
      statement: authority.statement,
    },
    flags: receipt.flags,
  }));
}

export function createAuthorityReceiptV2({
  preparedSha,
  candidateSha,
  deploymentId,
  sourceManifestSha256,
  artifactManifestSha256,
  issuedAt,
  notBefore = issuedAt,
  expiresAt,
} = {}) {
  digest(preparedSha, "prepared SHA", 40);
  digest(candidateSha, "candidate SHA", 40);
  decimal(deploymentId, "Pages predecessor deployment ID");
  digest(sourceManifestSha256, "source manifest SHA-256");
  digest(artifactManifestSha256, "artifact manifest SHA-256");
  timestamp(issuedAt, "issuedAt");
  timestamp(notBefore, "notBefore");
  timestamp(expiresAt, "expiresAt");
  const receipt = {
    schema: RECEIPT_SCHEMA_V2,
    repository: { id: REPOSITORY_ID_V2, fullName: REPOSITORY_FULL_NAME_V2 },
    lineage: {
      releaseBase: RELEASE_BASE_SHA,
      preparedCandidate: preparedSha,
      githubMain: GITHUB_MAIN_SHA,
      candidate: candidateSha,
      pagesPredecessor: {
        deploymentId,
        commit: PRODUCTION_PREDECESSOR_SHA_V2,
      },
    },
    changedPaths: {
      prepared: [...PREPARATION_CHANGED_PATHS],
      control: [...CONTROL_CHANGED_PATHS_V2],
    },
    manifests: { sourceSha256: sourceManifestSha256, artifactSha256: artifactManifestSha256 },
    catalog: {
      sourceDigest: SOURCE_CATALOG_DIGEST_V2,
      projectionDigest: PUBLIC_PROJECTION_DIGEST_V2,
    },
    legal: {
      v3AuthorityDigest: JOINT_LEGAL_V3_RELEASE.authorityDigest,
      v3ReceiptSha256: V3_RECEIPT_SHA256,
      v4AuthorityDigest: JOINT_LEGAL_V4_RELEASE.authorityDigest,
      v4ReceiptSha256: V4_RECEIPT_SHA256,
    },
    authority: {
      scope: "public-truth-reconciliation-v2-only",
      environment: RELEASE_ENVIRONMENT_V2,
      issuer: { githubUserId: OWNER_GITHUB_USER_ID_V2, login: OWNER_LOGIN_V2 },
      issuedAt,
      notBefore,
      expiresAt,
      oneShot: true,
      statement: AUTHORITY_STATEMENT_V2,
      epochSha256: null,
    },
    flags: {
      allowsDeployment: false,
      allowsCommercialDeployment: false,
      allowsContainmentDeployment: false,
      allowsPublicTruthReconciliationDeployment: true,
      allowsProviderEffects: false,
    },
  };
  receipt.authority.epochSha256 = computeReleaseEpochSha256V2(receipt);
  return receipt;
}

export function createEnabledReleaseControlV2(candidateControl, receipt, receiptSha256) {
  heldControl(candidateControl);
  digest(receiptSha256, "authority receipt SHA-256");
  return {
    ...structuredClone(candidateControl),
    allowsPublicTruthReconciliationDeployment: true,
    publicTruthReconciliation: {
      state: "cleared",
      requiredProductionPredecessor: PRODUCTION_PREDECESSOR_SHA_V2,
      approvedCandidateSha: receipt.lineage.candidate,
      authorityReceiptSha256: receiptSha256,
      reason: "One exact held Legal V4 Pages artifact is authorized by the bound short-lived owner receipt; every commercial, provider, runtime, containment, and general deployment effect remains denied.",
    },
    reason: "General and commercial deployment remain held; only the exact one-shot public-truth reconciliation receipt is active.",
    updatedAt: receipt.authority.issuedAt.slice(0, 10),
  };
}

export function validateReceiptV2(receipt, context) {
  object(receipt, [
    "schema", "repository", "lineage", "changedPaths", "manifests",
    "catalog", "legal", "authority", "flags",
  ], "receipt");
  exact(receipt.schema, RECEIPT_SCHEMA_V2, "receipt schema");
  const repository = object(receipt.repository, ["id", "fullName"], "receipt repository");
  exact(repository.id, REPOSITORY_ID_V2, "repository ID");
  exact(repository.fullName, REPOSITORY_FULL_NAME_V2, "repository name");
  const lineage = object(receipt.lineage, [
    "releaseBase", "preparedCandidate", "githubMain", "candidate", "pagesPredecessor",
  ], "receipt lineage");
  exact(lineage.releaseBase, RELEASE_BASE_SHA, "release base");
  exact(lineage.preparedCandidate, context.preparedSha, "prepared candidate");
  exact(lineage.githubMain, GITHUB_MAIN_SHA, "GitHub main parent");
  exact(lineage.candidate, context.candidateSha, "merged candidate");
  const predecessor = object(lineage.pagesPredecessor, ["deploymentId", "commit"], "Pages predecessor");
  decimal(predecessor.deploymentId, "Pages predecessor deployment ID");
  exact(predecessor.commit, PRODUCTION_PREDECESSOR_SHA_V2, "Pages predecessor commit");
  const changed = object(receipt.changedPaths, ["prepared", "control"], "changed paths");
  array(changed.prepared, PREPARATION_CHANGED_PATHS, "prepared changed paths");
  array(changed.control, CONTROL_CHANGED_PATHS_V2, "control changed paths");
  const manifests = object(receipt.manifests, ["sourceSha256", "artifactSha256"], "manifests");
  exact(manifests.sourceSha256, context.sourceManifestSha256, "source manifest SHA-256");
  exact(manifests.artifactSha256, context.artifactManifestSha256, "artifact manifest SHA-256");
  const catalog = object(receipt.catalog, ["sourceDigest", "projectionDigest"], "catalog");
  exact(catalog.sourceDigest, SOURCE_CATALOG_DIGEST_V2, "catalog source digest");
  exact(catalog.projectionDigest, PUBLIC_PROJECTION_DIGEST_V2, "catalog projection digest");
  const legal = object(receipt.legal, [
    "v3AuthorityDigest", "v3ReceiptSha256", "v4AuthorityDigest", "v4ReceiptSha256",
  ], "legal bindings");
  exact(legal.v3AuthorityDigest, JOINT_LEGAL_V3_RELEASE.authorityDigest, "V3 authority digest");
  exact(legal.v3ReceiptSha256, V3_RECEIPT_SHA256, "V3 receipt SHA-256");
  exact(legal.v4AuthorityDigest, JOINT_LEGAL_V4_RELEASE.authorityDigest, "V4 authority digest");
  exact(legal.v4ReceiptSha256, V4_RECEIPT_SHA256, "V4 receipt SHA-256");
  const authority = object(receipt.authority, [
    "scope", "environment", "issuer", "issuedAt", "notBefore", "expiresAt",
    "oneShot", "statement", "epochSha256",
  ], "authority");
  exact(authority.scope, "public-truth-reconciliation-v2-only", "authority scope");
  exact(authority.environment, RELEASE_ENVIRONMENT_V2, "authority environment");
  exact(authority.oneShot, true, "authority oneShot");
  exact(authority.statement, AUTHORITY_STATEMENT_V2, "authority statement");
  const issuer = object(authority.issuer, ["githubUserId", "login"], "authority issuer");
  exact(issuer.githubUserId, OWNER_GITHUB_USER_ID_V2, "owner GitHub ID");
  exact(issuer.login, OWNER_LOGIN_V2, "owner GitHub login");
  exact(context.actorId, OWNER_GITHUB_USER_ID_V2, "workflow actor ID");
  exact(context.actor, OWNER_LOGIN_V2, "workflow actor login");
  const issuedAt = timestamp(authority.issuedAt, "issuedAt");
  const notBefore = timestamp(authority.notBefore, "notBefore");
  const expiresAt = timestamp(authority.expiresAt, "expiresAt");
  if (issuedAt > notBefore || notBefore - issuedAt > MAX_CLOCK_SKEW_MS_V2) {
    fail("notBefore must be at or within five minutes after issue");
  }
  if (issuedAt > context.now + MAX_CLOCK_SKEW_MS_V2 || notBefore > context.now || context.now >= expiresAt) {
    fail("authority is not currently valid");
  }
  if (expiresAt - issuedAt < 1 || expiresAt - issuedAt > MAX_AUTHORITY_LIFETIME_MS_V2) {
    fail("authority lifetime must be positive and no longer than one hour");
  }
  const flags = object(receipt.flags, [
    "allowsDeployment", "allowsCommercialDeployment", "allowsContainmentDeployment",
    "allowsPublicTruthReconciliationDeployment", "allowsProviderEffects",
  ], "authority flags");
  if (
    flags.allowsDeployment !== false
    || flags.allowsCommercialDeployment !== false
    || flags.allowsContainmentDeployment !== false
    || flags.allowsPublicTruthReconciliationDeployment !== true
    || flags.allowsProviderEffects !== false
  ) fail("receipt may grant only public-truth reconciliation and no provider effects");
  exact(authority.epochSha256, computeReleaseEpochSha256V2(receipt), "authority epoch SHA-256");
  return receipt;
}

function validatePreparedGraph(root, preparedSha) {
  digest(preparedSha, "prepared SHA", 40);
  array(parents(root, preparedSha), [RELEASE_BASE_SHA], "prepared parents");
  array(gitDiffPaths(root, RELEASE_BASE_SHA, preparedSha), PREPARATION_CHANGED_PATHS, "prepared delta");
  for (const [file, blob] of Object.entries(FROZEN_BASE_BLOBS_V2)) {
    exact(git(root, ["rev-parse", `${RELEASE_BASE_SHA}:${file}`]), blob, `${file} base blob`);
    exact(git(root, ["rev-parse", `${preparedSha}:${file}`]), blob, `${file} prepared blob`);
  }
  if (
    git(root, ["ls-tree", "--name-only", preparedSha, "--", RECEIPT_PATH_V2])
    !== ""
  ) {
    fail("prepared candidate must not contain an authority receipt");
  }
}

export function validateCandidateGraphV2(root, candidateSha) {
  digest(candidateSha, "candidate SHA", 40);
  const candidateParents = parents(root, candidateSha);
  if (candidateParents.length !== 2) fail("candidate must be the exact two-parent reviewed merge");
  const [preparedSha, githubMain] = candidateParents;
  exact(githubMain, GITHUB_MAIN_SHA, "candidate GitHub-main parent");
  validatePreparedGraph(root, preparedSha);
  exact(git(root, ["rev-parse", `${candidateSha}^{tree}`]), git(root, ["rev-parse", `${preparedSha}^{tree}`]), "candidate tree");
  array(gitDiffPaths(root, preparedSha, candidateSha), [], "candidate merge tree delta");
  return preparedSha;
}

function validateSourceSemantics(root, revision) {
  const control = parseStrictJson(readGit(root, revision, "data/release-control.json").toString("utf8"));
  heldControl(control);
  const catalog = parseStrictJson(readGit(root, revision, "data/public-catalog.json").toString("utf8"));
  if (
    catalog.offerState !== "inquiry-only"
    || catalog.sourceCatalogDigest !== SOURCE_CATALOG_DIGEST_V2
    || catalog.projectionDigest !== PUBLIC_PROJECTION_DIGEST_V2
  ) fail("candidate catalog must remain exact and inquiry-only");
  for (const [file, expected] of [
    [`${PAGES_JOINT_LEGAL_V3_ROOT}/${PAGES_JOINT_LEGAL_V3_RECEIPT}`, V3_RECEIPT_SHA256],
    [`ops/releases/joint-legal-v4-2026-08-09T214211Z/${PAGES_JOINT_LEGAL_V4_RECEIPT}`, V4_RECEIPT_SHA256],
  ]) exact(sha256(readGit(root, revision, file)), expected, `${file} SHA-256`);
  return control;
}

function sourcePathForArtifact(file) {
  const v3 = new Map([
    [`legal/privacy/versions/${JOINT_LEGAL_V3_RELEASE.privacyVersion}/index.html`, `${PAGES_JOINT_LEGAL_V3_ROOT}/hosted/legal/privacy/versions/${JOINT_LEGAL_V3_RELEASE.privacyVersion}/index.html`],
    [`legal/website-terms/versions/${JOINT_LEGAL_V3_RELEASE.websiteTermsVersion}/index.html`, `${PAGES_JOINT_LEGAL_V3_ROOT}/hosted/legal/website-terms/versions/${JOINT_LEGAL_V3_RELEASE.websiteTermsVersion}/index.html`],
  ]);
  const v4Root = "ops/releases/joint-legal-v4-2026-08-09T214211Z/hosted";
  const v4 = new Map([
    ["legal/index.html", `${v4Root}/legal/index.html`],
    ["legal/privacy/index.html", `${v4Root}/legal/privacy/index.html`],
    [`legal/privacy/versions/${JOINT_LEGAL_V4_RELEASE.privacyVersion}/index.html`, `${v4Root}/legal/privacy/versions/${JOINT_LEGAL_V4_RELEASE.privacyVersion}/index.html`],
    ["legal/website-terms/index.html", `${v4Root}/legal/website-terms/index.html`],
    [`legal/website-terms/versions/${JOINT_LEGAL_V4_RELEASE.websiteTermsVersion}/index.html`, `${v4Root}/legal/website-terms/versions/${JOINT_LEGAL_V4_RELEASE.websiteTermsVersion}/index.html`],
  ]);
  return v3.get(file) ?? v4.get(file) ?? file;
}

export function expectedArtifactEntriesV2(sourceManifest) {
  const byPath = new Map(sourceManifest.entries.map((entry) => [entry.path, entry]));
  return REVIEWED_PUBLIC_ARTIFACT_PATHS_V2.map((file) => {
    const source = sourcePathForArtifact(file);
    const entry = byPath.get(source);
    if (!entry) fail(`source manifest is missing reviewed source ${source}`);
    return Object.freeze({ path: file, sha256: entry.sha256, size: entry.size });
  });
}

async function canonicalRoot(root) {
  const resolved = await realpath(path.resolve(root));
  const state = await lstat(resolved);
  if (!state.isDirectory() || state.isSymbolicLink()) fail("root must be one real repository directory");
  exact(git(resolved, ["rev-parse", "--show-toplevel"]), resolved, "repository root");
  return resolved;
}

function cleanCheckout(root) {
  if (
    git(root, ["diff", "--name-only"]) !== ""
    || git(root, ["diff", "--cached", "--name-only"]) !== ""
  ) fail("checkout contains tracked bytes that differ from HEAD");
}

async function validateCandidateArtifact(root, revision, artifactRoot) {
  validateSourceSemantics(root, revision);
  const source = sourceManifestFromGit(root, revision);
  const artifact = await validateArtifactSafety(
    artifactRoot,
    source,
    { expectedEntries: expectedArtifactEntriesV2(source) },
  );
  return { artifact, source };
}

export async function verifyPreparedV2({ root, preparedSha } = {}) {
  const repositoryRoot = await canonicalRoot(root);
  exact(git(repositoryRoot, ["rev-parse", "HEAD"]), preparedSha, "prepared checkout HEAD");
  cleanCheckout(repositoryRoot);
  validatePreparedGraph(repositoryRoot, preparedSha);
  const { artifact, source } = await validateCandidateArtifact(
    repositoryRoot,
    preparedSha,
    path.join(repositoryRoot, "_site"),
  );
  return Object.freeze({
    mode: "prepared",
    preparedSha,
    sourceManifestSha256: source.sha256,
    artifactManifestSha256: artifact.sha256,
    artifactFileCount: artifact.count,
    authority: "HOLD",
  });
}

export async function verifyCandidateV2({ root, candidateSha } = {}) {
  const repositoryRoot = await canonicalRoot(root);
  exact(git(repositoryRoot, ["rev-parse", "HEAD"]), candidateSha, "candidate checkout HEAD");
  cleanCheckout(repositoryRoot);
  const preparedSha = validateCandidateGraphV2(repositoryRoot, candidateSha);
  const { artifact, source } = await validateCandidateArtifact(
    repositoryRoot,
    candidateSha,
    path.join(repositoryRoot, "_site"),
  );
  return Object.freeze({
    mode: "candidate",
    candidateSha,
    preparedSha,
    sourceManifestSha256: source.sha256,
    artifactManifestSha256: artifact.sha256,
    artifactFileCount: artifact.count,
    authority: "HOLD",
  });
}

function workflowContext(env, controlSha) {
  exact(env.GITHUB_EVENT_NAME, "workflow_dispatch", "event");
  exact(env.GITHUB_REF, "refs/heads/main", "Git ref");
  exact(env.GITHUB_RUN_ATTEMPT, "1", "run attempt");
  exact(env.GITHUB_REPOSITORY, REPOSITORY_FULL_NAME_V2, "repository");
  exact(env.GITHUB_REPOSITORY_ID, REPOSITORY_ID_V2, "repository ID");
  exact(env.GITHUB_ACTOR, OWNER_LOGIN_V2, "actor");
  exact(env.GITHUB_ACTOR_ID, OWNER_GITHUB_USER_ID_V2, "actor ID");
  exact(env.GITHUB_SHA, controlSha, "workflow SHA");
  exact(env.GITHUB_WORKFLOW_SHA, controlSha, "workflow definition SHA");
  decimal(env.GITHUB_RUN_ID, "run ID");
  return { actor: env.GITHUB_ACTOR, actorId: env.GITHUB_ACTOR_ID };
}

async function readReceipt(root, controlSha) {
  const receiptPath = path.join(root, ...RECEIPT_PATH_V2.split("/"));
  const state = await lstat(receiptPath);
  if (!state.isFile() || state.isSymbolicLink()) fail("authority receipt must be one real file");
  const raw = await readFile(receiptPath);
  if (!raw.equals(readGit(root, controlSha, RECEIPT_PATH_V2))) {
    fail("authority receipt bytes differ from the control commit");
  }
  return raw;
}

async function readPagesObservation(root) {
  return parseStrictJson(await readFile(path.join(root, "pages-latest.json"), "utf8"));
}

function validatePagesObservationV2(observation, receipt) {
  object(observation, ["url", "status", "error", "pusher", "commit", "duration", "created_at", "updated_at"], "Pages observation");
  if (observation.status !== "built" || observation.error?.message !== null) {
    fail("latest Pages build is not successful");
  }
  exact(observation.commit, PRODUCTION_PREDECESSOR_SHA_V2, "Pages predecessor commit");
  exact(
    observation.url,
    `https://api.github.com/repos/${REPOSITORY_FULL_NAME_V2}/pages/builds/${receipt.lineage.pagesPredecessor.deploymentId}`,
    "Pages predecessor URL",
  );
  if (!GITHUB_TIME.test(observation.updated_at ?? "")) fail("Pages observation time is invalid");
  if (Date.parse(observation.updated_at) > Date.parse(receipt.authority.issuedAt)) {
    fail("Pages predecessor observation must predate authority issuance");
  }
}

async function verifyAuthorizedState({
  root,
  artifactRoot,
  candidateSha,
  controlSha,
  env,
  now,
  requireRemaining,
  requirePagesObservation = true,
}) {
  const repositoryRoot = await canonicalRoot(root);
  exact(git(repositoryRoot, ["rev-parse", "HEAD"]), controlSha, "control checkout HEAD");
  cleanCheckout(repositoryRoot);
  const preparedSha = validateCandidateGraphV2(repositoryRoot, candidateSha);
  array(parents(repositoryRoot, controlSha), [candidateSha], "control parents");
  array(gitDiffPaths(repositoryRoot, candidateSha, controlSha), CONTROL_CHANGED_PATHS_V2, "control delta");
  const runtime = workflowContext(env, controlSha);
  const { artifact, source } = await validateCandidateArtifact(
    repositoryRoot,
    candidateSha,
    artifactRoot,
  );
  const raw = await readReceipt(repositoryRoot, controlSha);
  const receiptSha256 = sha256(raw);
  const receipt = parseStrictJson(raw.toString("utf8"));
  validateReceiptV2(receipt, {
    ...runtime,
    now,
    preparedSha,
    candidateSha,
    sourceManifestSha256: source.sha256,
    artifactManifestSha256: artifact.sha256,
  });
  const candidateControl = parseStrictJson(readGit(repositoryRoot, candidateSha, "data/release-control.json").toString("utf8"));
  heldControl(candidateControl);
  const control = parseStrictJson(readGit(repositoryRoot, controlSha, "data/release-control.json").toString("utf8"));
  enabledControl(control, receipt, receiptSha256);
  if (requirePagesObservation) {
    validatePagesObservationV2(await readPagesObservation(repositoryRoot), receipt);
  }
  if (requireRemaining && Date.parse(receipt.authority.expiresAt) - now < MIN_PREDEPLOY_REMAINING_MS_V2) {
    fail("predeploy authority has less than five minutes remaining");
  }
  return { artifact, preparedSha, receipt, receiptSha256, source };
}

export async function verifyControlV2(options = {}) {
  const state = await verifyAuthorizedState({
    ...options,
    artifactRoot: path.join(path.resolve(options.root), "_site"),
    now: options.now ?? Date.now(),
    requireRemaining: false,
  });
  return Object.freeze({
    mode: "control",
    candidateSha: options.candidateSha,
    controlSha: options.controlSha,
    receiptSha256: state.receiptSha256,
    sourceManifestSha256: state.source.sha256,
    artifactManifestSha256: state.artifact.sha256,
    artifactFileCount: state.artifact.count,
    authority: "PUBLIC_TRUTH_V2_ONLY",
  });
}

export async function verifyPredeployV2(options = {}) {
  const state = await verifyAuthorizedState({
    ...options,
    now: options.now ?? Date.now(),
    requireRemaining: true,
  });
  return Object.freeze({
    mode: "predeploy",
    candidateSha: options.candidateSha,
    controlSha: options.controlSha,
    receiptSha256: state.receiptSha256,
    artifactManifestSha256: state.artifact.sha256,
    authority: "PUBLIC_TRUTH_V2_ONLY",
  });
}

async function writeEvidence(file, body) {
  if (path.basename(file) !== POSTDEPLOY_EVIDENCE_FILE_V2 || !path.isAbsolute(file)) {
    fail(`evidence must be an absolute ${POSTDEPLOY_EVIDENCE_FILE_V2} path`);
  }
  await writeFile(file, `${stableStringify({
    ...body,
    proofSha256: sha256(stableStringify(body)),
  })}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export async function verifyPostdeployV2(options = {}) {
  const state = await verifyAuthorizedState({
    ...options,
    now: options.now ?? Date.now(),
    requireRemaining: false,
    requirePagesObservation: false,
  });
  exact(options.deploymentStatus, "succeed", "deployment status");
  exact(options.deploymentPageUrl, "https://sitesourcery.com/", "deployment page URL");
  const live = await pollLiveProduction({
    manifest: state.artifact,
    origin: "https://sitesourcery.com",
  });
  await verifyProductionRouteContract({
    artifactRoot: options.artifactRoot,
    manifest: state.artifact,
    finalSnapshot: live.finalSnapshot,
  });
  const evidence = {
    schema: "sitesourcery.postdeploy-production-proof/v2",
    result: "pass",
    generatedAt: new Date().toISOString(),
    candidateSha: options.candidateSha,
    controlSha: options.controlSha,
    receiptSha256: state.receiptSha256,
    artifactManifestSha256: state.artifact.sha256,
    artifactFileCount: state.artifact.count,
    live: {
      attempts: live.attempts,
      completedAtMs: live.completedAtMs,
      origin: live.origin,
    },
  };
  await writeEvidence(options.evidence, evidence);
  return Object.freeze({ mode: "postdeploy", ...evidence });
}

export function parseCliV2(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--") || values.has(flag)) {
      fail("CLI requires unique flag/value pairs");
    }
    values.set(flag, value);
  }
  const mode = values.get("--mode");
  const expected = mode === "prepared"
    ? ["--mode", "--root", "--prepared-sha"]
    : mode === "candidate"
      ? ["--mode", "--root", "--candidate-sha"]
      : [
          "--mode", "--root", "--candidate-sha", "--control-sha", "--artifact-root",
          ...(mode === "postdeploy" ? ["--deployment-page-url", "--deployment-status", "--evidence"] : []),
        ];
  if (!['prepared', 'candidate', 'control', 'predeploy', 'postdeploy'].includes(mode)) {
    fail("mode must be prepared, candidate, control, predeploy, or postdeploy");
  }
  array([...values.keys()].sort(), [...expected].sort(), `${mode} CLI flags`);
  return Object.fromEntries([...values].map(([key, value]) => [
    key.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase()), value,
  ]));
}

export async function runCliV2(argv = process.argv.slice(2), env = process.env) {
  const options = parseCliV2(argv);
  if (options.mode === "prepared") return verifyPreparedV2(options);
  if (options.mode === "candidate") return verifyCandidateV2(options);
  if (options.mode === "control") return verifyControlV2({ ...options, env });
  if (options.mode === "predeploy") return verifyPredeployV2({ ...options, env });
  try {
    return await verifyPostdeployV2({ ...options, env });
  } catch (error) {
    try {
      await writeEvidence(options.evidence, {
        schema: "sitesourcery.postdeploy-production-proof/v2",
        result: "fail",
        generatedAt: new Date().toISOString(),
        candidateSha: options.candidateSha ?? null,
        controlSha: options.controlSha ?? null,
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
  const result = await runCliV2();
  console.log(`PUBLIC_TRUTH_RELEASE_V2_${result.mode.toUpperCase()}_PASS ${JSON.stringify(result)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`PUBLIC_TRUTH_RELEASE_V2_DENIED ${error.message}`);
    process.exitCode = 1;
  });
}
