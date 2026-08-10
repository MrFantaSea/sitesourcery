import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectOriginRepositorySnapshot,
  collectOriginTreeManifest
} from "../origin-seal-repository.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
  createOriginReleaseInput
} from "../origin-seal-runtime.mjs";
import {
  CI_RELEASE_BROWSER_VERSION,
  CI_RELEASE_BROWSER_WIDTHS,
  ciReleaseDatabaseName,
  ciReleaseDatabaseNameSha256,
  createCiReleaseFinalReceipt,
  createCiReleaseStepReceipt,
  createCiReleaseSuccessorInput,
  validateCiReleaseFinalReceipt,
  validateCiReleaseSuccessorInput
} from "../ci-release-proof-runtime.mjs";
import {
  verifyCiLegalV4Artifact,
  verifyCiReleaseCandidate
} from "../ci-release-proof-repository.mjs";
import { proveDatabaseAbsent } from "../ci-release-proof.mjs";
import {
  resolveMigrationVerificationInventory
} from "../../server/data-plane/tests/migration-verification-inventory.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const layout = Object.freeze({
  artifactRoot:
    "ops/releases/joint-legal-v4-2026-08-09T214211Z/hosted",
  migrationRoot: "server/data-plane/supabase/migrations",
  legalConstantsPath:
    "ops/releases/joint-legal-v4-2026-08-09T214211Z/joint-legal-v4-release-constants.json"
});
const SOURCE_COMMIT = "a".repeat(40);
const SOURCE_TREE = "b".repeat(40);
const PREDECESSOR_COMMIT = "c".repeat(40);
const PREDECESSOR_TREE = "d".repeat(40);
const snapshot = await collectOriginRepositorySnapshot({
  projectRoot,
  layout
});

function releaseInput() {
  return createOriginReleaseInput({
    releaseId: "ci-release-successor-fixture",
    epoch: {
      schema: ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
      epochId: "ci-release-successor-fixture",
      supersedes: {
        epochId: "shape-epoch-20260810",
        bindingSha256:
          "50e1bb83a8e2258d35c27e8d33d69757efd2eb9331c312283ae08d99c56c1bc6"
      },
      basis: {
        unionBaseCommitSha:
          "5458d9641fd42c9a1b436c6af6bb6600b60bce74"
      },
      layout: structuredClone(layout),
      source: {
        commitSha: SOURCE_COMMIT,
        treeSha: SOURCE_TREE
      },
      artifact: { manifestSha256: snapshot.artifact.sha256 },
      units: { manifestSha256: snapshot.units.sha256 },
      environmentSchema: {
        manifestSha256: snapshot.environmentSchema.sha256,
        classificationSha256:
          snapshot.environmentSchema.classificationSha256
      },
      worker: {
        manifestSha256: snapshot.worker.sha256,
        contractSha256: snapshot.worker.contractSha256
      },
      migration: {
        count: snapshot.migration.count,
        latest: snapshot.migration.latest,
        manifestSha256: snapshot.migration.sha256
      },
      legal: {
        authorityDigest: snapshot.legal.authorityDigest,
        privacyVersion: snapshot.legal.privacyVersion,
        privacySha256: snapshot.legal.privacySha256,
        privacyByteCount: snapshot.legal.privacyByteCount,
        websiteTermsVersion: snapshot.legal.websiteTermsVersion,
        websiteTermsSha256: snapshot.legal.websiteTermsSha256,
        websiteTermsByteCount: snapshot.legal.websiteTermsByteCount,
        manifestSha256: snapshot.legal.sha256
      },
      ingress: { manifestSha256: snapshot.ingress.sha256 },
      rollback: {
        predecessorCommitSha: PREDECESSOR_COMMIT,
        predecessorTreeSha: PREDECESSOR_TREE,
        predecessorArtifactManifestSha256: "e".repeat(64)
      },
      authority: structuredClone(ORIGIN_HELD_AUTHORITY)
    }
  });
}

function migrationInventory() {
  return {
    count: snapshot.migration.count,
    latest: snapshot.migration.latest,
    files: snapshot.migration.files.map((entry) => ({
      name: entry.path.split("/").at(-1),
      byteCount: entry.byteCount,
      sha256: entry.sha256
    })),
    manifestSha256: snapshot.migration.sha256
  };
}

function successorInput(legalManifestSha256 = "f".repeat(64)) {
  return createCiReleaseSuccessorInput({
    originReleaseInput: releaseInput(),
    migrationInventory: migrationInventory(),
    legalV4Pages: {
      fileCount: 80,
      manifestSha256: legalManifestSha256
    }
  });
}

function context(input) {
  return {
    candidateSha: SOURCE_COMMIT,
    workflowSha: "1".repeat(40),
    successorInputDigest: input.digest,
    runId: "482731",
    runAttempt: "1"
  };
}

function receipts(input) {
  const selectedContext = context(input);
  const common = {
    context: selectedContext,
    observedAt: "2026-08-10T22:00:00.000Z"
  };
  const databaseName = ciReleaseDatabaseName(selectedContext);
  const databaseNameSha256 = ciReleaseDatabaseNameSha256(databaseName);
  return [
    createCiReleaseStepReceipt({
      ...common,
      step: "browser",
      details: {
        routeCount: 15,
        viewCount: 45,
        widths: [...CI_RELEASE_BROWSER_WIDTHS],
        browserVersion: CI_RELEASE_BROWSER_VERSION,
        artifactManifestSha256: input.legalV4Pages.manifestSha256
      }
    }),
    createCiReleaseStepReceipt({
      ...common,
      step: "cleanup",
      details: { databaseNameSha256, databaseAbsent: true }
    }),
    createCiReleaseStepReceipt({
      ...common,
      step: "full-npm",
      details: { command: "npm test" }
    }),
    createCiReleaseStepReceipt({
      ...common,
      step: "legal-v4",
      details: {
        fileCount: 80,
        manifestSha256: input.legalV4Pages.manifestSha256
      }
    }),
    createCiReleaseStepReceipt({
      ...common,
      step: "ops",
      details: { command: "npm run check:ops" }
    }),
    createCiReleaseStepReceipt({
      ...common,
      step: "postgres",
      details: {
        databaseNameSha256,
        postgresMajor: 16,
        migrationCount: input.migrationInventory.count,
        migrationManifestSha256: input.migrationInventory.manifestSha256
      }
    })
  ];
}

test("successor input binds exact dynamic migrations and held authority", () => {
  const input = successorInput();
  assert.deepEqual(validateCiReleaseSuccessorInput(input), input);
  assert.equal(input.migrationInventory.count, snapshot.migration.count);
  assert.equal(input.nodeVersion, "24.18.0");
  assert.deepEqual(input.authority, ORIGIN_HELD_AUTHORITY);

  const drift = structuredClone(input);
  drift.migrationInventory.count += 1;
  assert.throws(
    () => validateCiReleaseSuccessorInput(drift),
    /supplied count|digest/u
  );
});

test("successor inventory admits later migrations without a count constant", () => {
  const names = migrationInventory().files.map((entry) => entry.name);
  const successorNames = [
    ...names,
    "202608100112_ci_fixture_successor.sql",
    "202608100113_ci_fixture_successor_two.sql"
  ];
  const selected = resolveMigrationVerificationInventory(
    successorNames,
    successorNames
  );
  assert.deepEqual(selected.postPrivacyNames.slice(-2), successorNames.slice(-2));
  assert.throws(
    () => resolveMigrationVerificationInventory(successorNames),
    /retained checkpoint migration proof/u
  );
});

test("candidate verifier rejects Git and migration-byte drift", async () => {
  const input = successorInput();
  const gitRunner = async (arguments_) => {
    if (arguments_.join(" ") === "rev-parse HEAD") return SOURCE_COMMIT;
    if (
      arguments_.join(" ") ===
      "status --porcelain=v1 --untracked-files=no"
    ) return "";
    throw new Error("unexpected Git fixture call");
  };
  const proof = await verifyCiReleaseCandidate({
    projectRoot,
    successorInput: input,
    gitRunner
  });
  assert.equal(proof.migrationCount, snapshot.migration.count);

  await assert.rejects(
    verifyCiReleaseCandidate({
      projectRoot,
      successorInput: input,
      gitRunner: async (arguments_) =>
        arguments_.join(" ") === "rev-parse HEAD" ? "2".repeat(40) : ""
    }),
    /Git identity is dirty or drifted/u
  );
});

test("final receipt requires every exact proof and grants no authority", async () => {
  const input = successorInput();
  const proofReceipts = receipts(input);
  const final = createCiReleaseFinalReceipt({
    successorInput: input,
    context: context(input),
    receipts: proofReceipts
  });
  assert.deepEqual(validateCiReleaseFinalReceipt(final), final);
  assert.equal(final.state, "verified_held");
  assert.deepEqual(final.authority, ORIGIN_HELD_AUTHORITY);
  assert.throws(
    () => createCiReleaseFinalReceipt({
      successorInput: input,
      context: context(input),
      receipts: proofReceipts.slice(1)
    }),
    /every exact proof receipt/u
  );
});

test("Legal V4 proof requires the exact successor-authorized 80-file tree", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "ss-ci-legal-v4-"));
  try {
    const artifact = path.join(fixture, "_site");
    await mkdir(artifact);
    for (let index = 0; index < 80; index += 1) {
      await writeFile(
        path.join(artifact, `legal-${String(index).padStart(2, "0")}.html`),
        `legal fixture ${index}\n`,
        "utf8"
      );
    }
    const manifest = await collectOriginTreeManifest({
      projectRoot: fixture,
      domain: "ci-legal-v4-pages",
      relativeRoot: "_site"
    });
    const input = successorInput(manifest.sha256);
    const verified = await verifyCiLegalV4Artifact({
      projectRoot: fixture,
      artifactRoot: artifact,
      successorInput: input
    });
    assert.equal(verified.fileCount, 80);
    await writeFile(path.join(artifact, "unexpected.html"), "drift\n", "utf8");
    await assert.rejects(
      verifyCiLegalV4Artifact({
        projectRoot: fixture,
        artifactRoot: artifact,
        successorInput: input
      }),
      /80-file artifact drifted/u
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("database-absence proof is read-only local and injectable", async () => {
  const calls = [];
  class PoolFixture {
    async query(statement, parameters) {
      calls.push({ statement, parameters });
      return { rows: [{ database_absent: true }] };
    }
    async end() {
      calls.push({ end: true });
    }
  }
  assert.equal(
    await proveDatabaseAbsent({
      adminUrl: "postgresql://postgres@127.0.0.1:55432/postgres",
      databaseName: "ss_ci_release_482731_1",
      PoolImpl: PoolFixture
    }),
    true
  );
  assert.match(calls[0].statement, /^select not exists/u);
  assert.deepEqual(calls[0].parameters, ["ss_ci_release_482731_1"]);
  await assert.rejects(
    proveDatabaseAbsent({
      adminUrl: "postgresql://example.com/postgres",
      databaseName: "ss_ci_release_482731_1",
      PoolImpl: PoolFixture
    }),
    /credential-free local PostgreSQL/u
  );
});

test("workflow is manual protected held and has no effect-bearing action", async () => {
  const source = await readFile(
    path.join(projectRoot, ".github/workflows/ci-release-proof-held.yml"),
    "utf8"
  );
  for (const required of [
    "workflow_dispatch:",
    "environment: ci-release-proof-held",
    "permissions: {}",
    "node-version: 24.18.0",
    "successor_input_sha256:",
    "npm test",
    "npm run check:ops",
    "build:pages:legal-v4",
    "ss_ci_release_[1-9][0-9]*_[1-9][0-9]*",
    "ci-release-proof.mjs absence"
  ]) assert.ok(source.includes(required), required);
  assert.doesNotMatch(source, /\b(?:upload|deploy)-(?:pages-)?artifact@/u);
  assert.doesNotMatch(source, /\b(?:deploy-pages|configure-pages)@/u);
  assert.doesNotMatch(source, /\b(?:stripe|cloudflare|resend)\b/iu);
  assert.doesNotMatch(source, /migration(?:Count| count)[^\n]*63/u);
});
