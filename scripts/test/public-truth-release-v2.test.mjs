import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  AUTHORITY_STATEMENT_V2,
  CONTROL_CHANGED_PATHS_V2,
  GITHUB_MAIN_SHA,
  OWNER_GITHUB_USER_ID_V2,
  OWNER_LOGIN_V2,
  PREPARATION_CHANGED_PATHS,
  PRODUCTION_PREDECESSOR_SHA_V2,
  PUBLIC_PROJECTION_DIGEST_V2,
  RECEIPT_SCHEMA_V2,
  RELEASE_BASE_SHA,
  REPOSITORY_FULL_NAME_V2,
  REPOSITORY_ID_V2,
  REVIEWED_PUBLIC_ARTIFACT_PATHS_V2,
  SOURCE_CATALOG_DIGEST_V2,
  V3_RECEIPT_SHA256,
  V4_RECEIPT_SHA256,
  computeReleaseEpochSha256V2,
  createAuthorityReceiptV2,
  createEnabledReleaseControlV2,
  expectedArtifactEntriesV2,
  parseCliV2,
  validateReceiptV2,
} from "../verify-public-truth-release-v2.mjs";
import { JOINT_LEGAL_V3_RELEASE } from "../hosted-truth/joint-legal-v3-artifacts.mjs";
import { JOINT_LEGAL_V4_RELEASE } from "../hosted-truth/joint-legal-v4-artifacts.mjs";
import {
  DOMAIN_HERO_ASSETS,
} from "../generate-domain-hero-assets.mjs";
import {
  sourceManifestFromGit,
  PublicTruthVerificationError,
  sha256,
  stableStringify,
} from "../verify-public-truth-release.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREPARED = "11".repeat(20);
const CANDIDATE = "22".repeat(20);
const NOW = Date.parse("2026-08-10T12:15:00.000Z");
const SOURCE = "33".repeat(32);
const ARTIFACT = "44".repeat(32);

async function candidateSourceManifest() {
  const manifest = sourceManifestFromGit(ROOT, "HEAD");
  const entries = manifest.entries.map((entry) => ({ ...entry }));
  const knownPaths = new Set(entries.map(({ path: file }) => file));
  for (const { file } of DOMAIN_HERO_ASSETS) {
    const source = `assets/${file}`;
    if (knownPaths.has(source)) continue;
    const bytes = await readFile(path.join(ROOT, source));
    entries.push({ mode: "100644", path: source, sha256: sha256(bytes), size: bytes.length });
  }
  entries.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  return {
    count: entries.length,
    entries,
    sha256: sha256(stableStringify(entries)),
  };
}

function receipt() {
  const value = {
    schema: RECEIPT_SCHEMA_V2,
    repository: { id: REPOSITORY_ID_V2, fullName: REPOSITORY_FULL_NAME_V2 },
    lineage: {
      releaseBase: RELEASE_BASE_SHA,
      preparedCandidate: PREPARED,
      githubMain: GITHUB_MAIN_SHA,
      candidate: CANDIDATE,
      pagesPredecessor: {
        deploymentId: "123456789",
        commit: PRODUCTION_PREDECESSOR_SHA_V2,
      },
    },
    changedPaths: {
      prepared: [...PREPARATION_CHANGED_PATHS],
      control: [...CONTROL_CHANGED_PATHS_V2],
    },
    manifests: { sourceSha256: SOURCE, artifactSha256: ARTIFACT },
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
      environment: "github-pages",
      issuer: { githubUserId: OWNER_GITHUB_USER_ID_V2, login: OWNER_LOGIN_V2 },
      issuedAt: "2026-08-10T12:10:00.000Z",
      notBefore: "2026-08-10T12:10:00.000Z",
      expiresAt: "2026-08-10T13:10:00.000Z",
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
  value.authority.epochSha256 = computeReleaseEpochSha256V2(value);
  return value;
}

function context() {
  return {
    actor: OWNER_LOGIN_V2,
    actorId: OWNER_GITHUB_USER_ID_V2,
    now: NOW,
    preparedSha: PREPARED,
    candidateSha: CANDIDATE,
    sourceManifestSha256: SOURCE,
    artifactManifestSha256: ARTIFACT,
  };
}

test("v2 receipt binds exact owner, merge topology, legal tuple, artifact, and held flags", () => {
  assert.equal(validateReceiptV2(receipt(), context()).schema, RECEIPT_SCHEMA_V2);
});

test("canonical v2 receipt and control constructors grant only the one-shot lane", () => {
  const generated = createAuthorityReceiptV2({
    preparedSha: PREPARED,
    candidateSha: CANDIDATE,
    deploymentId: "123456789",
    sourceManifestSha256: SOURCE,
    artifactManifestSha256: ARTIFACT,
    issuedAt: "2026-08-10T12:10:00.000Z",
    expiresAt: "2026-08-10T13:10:00.000Z",
  });
  validateReceiptV2(generated, context());
  const held = {
    version: 3,
    state: "hold",
    allowsDeployment: false,
    allowsCommercialDeployment: false,
    allowsContainmentDeployment: false,
    allowsPublicTruthReconciliationDeployment: false,
    publicTruthReconciliation: {
      state: "hold",
      requiredProductionPredecessor: PRODUCTION_PREDECESSOR_SHA_V2,
      approvedCandidateSha: null,
      authorityReceiptSha256: null,
      reason: "Held.",
    },
    reason: "Held.",
    containmentReason: "Held.",
    updatedAt: "2026-08-10",
  };
  const enabled = createEnabledReleaseControlV2(held, generated, "55".repeat(32));
  assert.equal(enabled.state, "hold");
  assert.equal(enabled.allowsDeployment, false);
  assert.equal(enabled.allowsCommercialDeployment, false);
  assert.equal(enabled.allowsContainmentDeployment, false);
  assert.equal(enabled.allowsPublicTruthReconciliationDeployment, true);
  assert.equal(enabled.publicTruthReconciliation.approvedCandidateSha, CANDIDATE);
});

test("v2 receipt denies broad or provider authority", () => {
  for (const flag of [
    "allowsDeployment",
    "allowsCommercialDeployment",
    "allowsContainmentDeployment",
    "allowsProviderEffects",
  ]) {
    const changed = receipt();
    changed.flags[flag] = true;
    changed.authority.epochSha256 = computeReleaseEpochSha256V2(changed);
    assert.throws(
      () => validateReceiptV2(changed, context()),
      PublicTruthVerificationError,
      flag,
    );
  }
});

test("v2 receipt is owner-only, one-shot, and short-lived", () => {
  for (const mutate of [
    (value) => { value.authority.oneShot = false; },
    (value) => { value.authority.issuer.githubUserId = "1"; },
    (value) => { value.authority.expiresAt = "2026-08-10T14:10:00.000Z"; },
  ]) {
    const changed = receipt();
    mutate(changed);
    changed.authority.epochSha256 = computeReleaseEpochSha256V2(changed);
    assert.throws(() => validateReceiptV2(changed, context()), PublicTruthVerificationError);
  }
});

test("v2 artifact projection is an exact 94-file V4-current and V2/V3/V4-versioned ledger", async () => {
  const source = await candidateSourceManifest();
  const entries = expectedArtifactEntriesV2(source);
  assert.equal(entries.length, 94);
  assert.deepEqual(entries.map(({ path: file }) => file), REVIEWED_PUBLIC_ARTIFACT_PATHS_V2);
  assert.equal(
    entries.find(({ path: file }) => file === "legal/privacy/index.html").sha256,
    JOINT_LEGAL_V4_RELEASE.privacySha256,
  );
  assert.equal(
    entries.find(({ path: file }) => file.includes(JOINT_LEGAL_V3_RELEASE.privacyVersion)).sha256,
    JOINT_LEGAL_V3_RELEASE.privacySha256,
  );
});

test("v2 workflow invokes only the exact sealed builder and v2 verifier", async () => {
  const workflow = await readFile(path.join(ROOT, ".github/workflows/public-truth-reconciliation-v2.yml"), "utf8");
  assert.match(workflow, /npm run build:pages:legal-v4/u);
  assert.match(workflow, /verify-public-truth-release-v2\.mjs --mode predeploy/u);
  assert.match(workflow, /allowsDeployment !== false/u);
  assert.match(workflow, /allowsCommercialDeployment !== false/u);
  assert.doesNotMatch(workflow, /stripe|cloudflare|dns|tunnel/iu);
});

test("v2 CLI rejects missing or additional authority inputs", () => {
  assert.deepEqual(parseCliV2([
    "--mode", "candidate",
    "--root", ROOT,
    "--candidate-sha", CANDIDATE,
  ]), { mode: "candidate", root: ROOT, candidateSha: CANDIDATE });
  assert.throws(() => parseCliV2([
    "--mode", "candidate",
    "--root", ROOT,
    "--candidate-sha", CANDIDATE,
    "--authority-receipt", "anything",
  ]), PublicTruthVerificationError);
});
