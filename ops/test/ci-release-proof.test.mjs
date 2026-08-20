import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  collectOriginRepositorySnapshot,
  collectOriginTreeManifest
} from "../origin-seal-repository.mjs";
import {
  canonicalJson,
  sha256Bytes
} from "../immutable-evidence.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
  createOriginReleaseInput
} from "../origin-seal-runtime.mjs";
import {
  CI_RELEASE_BROWSER_VERSION,
  CI_RELEASE_BROWSER_WIDTHS,
  CI_RELEASE_PROTECTED_IMPLEMENTATION_PATHS,
  ciReleaseDatabaseName,
  ciReleaseDatabaseNameSha256,
  createCiReleaseFinalReceipt,
  createCiReleaseStepReceipt,
  createCiReleaseSuccessorInput,
  validateCiReleaseFinalReceipt,
  validateCiReleaseSuccessorInput
} from "../ci-release-proof-runtime.mjs";
import {
  assertCiReleaseSafeEnvironment,
  ciReleaseGitArguments,
  ciReleaseSuccessorInputRelativePath,
  collectCiRollbackArtifactEvidence,
  createCiReleaseSuccessorInputFromRepository,
  requireCiReleaseContainedDirectory,
  verifyCiLegalV4Artifact,
  verifyCiReleaseCandidate,
  verifyCiReleaseGenerationState,
  verifyCiReleaseGitCheckout,
  verifyCiReleaseSuccessorControl
} from "../ci-release-proof-repository.mjs";
import {
  proveDatabaseAbsent,
  writeCiReleaseSuccessorInputAnchored
} from "../ci-release-proof.mjs";
import {
  resolveMigrationVerificationInventory
} from "../../server/data-plane/tests/migration-verification-inventory.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const executeFile = promisify(execFile);
const canonicalTemporaryRoot = await realpath(os.tmpdir());

function protectedImplementationPaths(workflow) {
  const selected = workflow.match(
    /for file in \\\n(?<paths>[\s\S]*?)\n\s+do\n/u
  );
  assert.ok(selected?.groups?.paths, "protected implementation loop is missing");
  return selected.groups.paths.trim().split("\n").map((line) => (
    line.trim().replace(/ \\$/u, "")
  ));
}

function assertProtectedImplementationPaths(workflow) {
  assert.deepEqual(
    protectedImplementationPaths(workflow),
    CI_RELEASE_PROTECTED_IMPLEMENTATION_PATHS
  );
}

async function git(root, arguments_) {
  const { stdout } = await executeFile("git", arguments_, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "CI security fixture",
      GIT_AUTHOR_EMAIL: "ci-security@example.invalid",
      GIT_COMMITTER_NAME: "CI security fixture",
      GIT_COMMITTER_EMAIL: "ci-security@example.invalid"
    }
  });
  return stdout.trim();
}

async function gitSecurityFixture() {
  const root = await mkdtemp(
    path.join(canonicalTemporaryRoot, "ss-ci-security-git-")
  );
  await git(root, ["init", "--initial-branch=main"]);
  await writeFile(path.join(root, "tracked.txt"), "first\n", "utf8");
  await git(root, ["add", "tracked.txt"]);
  await git(root, ["commit", "-m", "first"]);
  await writeFile(path.join(root, "tracked.txt"), "second\n", "utf8");
  await git(root, ["commit", "-am", "second"]);
  return {
    root,
    head: await git(root, ["rev-parse", "HEAD"]),
    tree: await git(root, ["rev-parse", "HEAD^{tree}"])
  };
}

async function waitForPath(selected) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      await access(selected);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${selected}.`);
}
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

function successorInput(
  legalManifestSha256 = "f".repeat(64),
  legalFileCount = 94
) {
  return createCiReleaseSuccessorInput({
    originReleaseInput: releaseInput(),
    migrationInventory: migrationInventory(),
    legalV4Pages: {
      fileCount: legalFileCount,
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
        viewCount: 90,
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
        fileCount: input.legalV4Pages.fileCount,
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
  assert.equal(input.legalV4Pages.fileCount, 94);

  const drift = structuredClone(input);
  drift.migrationInventory.count += 1;
  assert.throws(
    () => validateCiReleaseSuccessorInput(drift),
    /supplied count|digest/u
  );
});

test("successor input requires an explicit positive integer Legal file count and manifest", () => {
  const mutations = [
    (input) => { delete input.legalV4Pages.fileCount; },
    (input) => { delete input.legalV4Pages.manifestSha256; },
    (input) => { input.legalV4Pages.fileCount = 0; },
    (input) => { input.legalV4Pages.fileCount = 94.5; }
  ];
  for (const mutate of mutations) {
    const input = structuredClone(successorInput());
    mutate(input);
    assert.throws(
      () => validateCiReleaseSuccessorInput(input),
      /exact fields|positive safe integer/u
    );
  }
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
    const command = arguments_.join(" ");
    if (command === "for-each-ref --format=%(refname) refs/replace/") return "";
    if (command === "rev-parse --git-path info/grafts") {
      return path.join(projectRoot, ".nonexistent-ci-grafts");
    }
    if (command === "ls-files -v -z" || command === "ls-files -t -z") return "";
    if (command === "rev-parse HEAD") return SOURCE_COMMIT;
    if (command === "rev-parse HEAD^{tree}") return SOURCE_TREE;
    if (command === "status --porcelain=v1 --untracked-files=all") return "";
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
      gitRunner: async (arguments_) => {
        const command = arguments_.join(" ");
        if (command === "for-each-ref --format=%(refname) refs/replace/") return "";
        if (command === "rev-parse --git-path info/grafts") {
          return path.join(projectRoot, ".nonexistent-ci-grafts");
        }
        if (command === "ls-files -v -z" || command === "ls-files -t -z") return "";
        if (command === "rev-parse HEAD") return "2".repeat(40);
        if (command === "rev-parse HEAD^{tree}") return SOURCE_TREE;
        if (command === "status --porcelain=v1 --untracked-files=all") return "";
        throw new Error("unexpected drift fixture call");
      }
    }),
    /checkout identity or status drifted/u
  );
});

test("Git runner rejects ambient spoofing and forces no-replace semantics", () => {
  assert.equal(assertCiReleaseSafeEnvironment({ GIT_PAGER: "cat" }), true);
  for (const environment of [
    { GIT_DIR: "/tmp/rogue" },
    { GIT_CONFIG_COUNT: "1" },
    { GIT_CONFIG_KEY_0: "core.fsmonitor" },
    { GIT_REPLACE_REF_BASE: "refs/rogue/" },
    { NODE_OPTIONS: "--import=/tmp/rogue.mjs" },
    { NODE_PATH: "/tmp/rogue-modules" }
  ]) {
    assert.throws(
      () => assertCiReleaseSafeEnvironment(environment),
      /rejects ambient Git or Node overrides/u
    );
  }
  assert.deepEqual(
    ciReleaseGitArguments(["rev-list", "--parents", "-n", "1", SOURCE_COMMIT]),
    [
      "--no-replace-objects",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "rev-list",
      "--parents",
      "-n",
      "1",
      SOURCE_COMMIT
    ]
  );
});

test("checkout verifier rejects assume-unchanged without clearing it", async () => {
  const fixture = await gitSecurityFixture();
  try {
    await git(fixture.root, ["update-index", "--assume-unchanged", "tracked.txt"]);
    await writeFile(path.join(fixture.root, "tracked.txt"), "hidden mutation\n", "utf8");
    await assert.rejects(
      verifyCiReleaseGitCheckout({
        projectRoot: fixture.root,
        expectedHead: fixture.head,
        expectedTree: fixture.tree
      }),
      /rejects hidden Git index flags without mutating them/u
    );
    assert.match(
      await git(fixture.root, ["ls-files", "-v", "tracked.txt"]),
      /^h tracked\.txt$/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("checkout verifier rejects replace refs and graft files before graph use", async () => {
  const fixture = await gitSecurityFixture();
  try {
    await git(fixture.root, ["replace", fixture.head, `${fixture.head}^`]);
    await assert.rejects(
      verifyCiReleaseGitCheckout({
        projectRoot: fixture.root,
        expectedHead: fixture.head,
        expectedTree: fixture.tree
      }),
      /rejects Git replace refs/u
    );
    await git(fixture.root, ["replace", "-d", fixture.head]);
    const grafts = await git(fixture.root, ["rev-parse", "--git-path", "info/grafts"]);
    await mkdir(path.dirname(path.resolve(fixture.root, grafts)), { recursive: true });
    await writeFile(
      path.resolve(fixture.root, grafts),
      `${fixture.head} ${fixture.head}^\n`,
      "utf8"
    );
    await assert.rejects(
      verifyCiReleaseGitCheckout({
        projectRoot: fixture.root,
        expectedHead: fixture.head,
        expectedTree: fixture.tree
      }),
      /rejects Git graft files/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rollback artifact evidence is byte-derived and rejects digest injection or symlinks", async () => {
  const fixture = await mkdtemp(
    path.join(canonicalTemporaryRoot, "ss-ci-rollback-artifact-")
  );
  try {
    await writeFile(path.join(fixture, "index.html"), "first\n", "utf8");
    const first = await collectCiRollbackArtifactEvidence({
      artifactRoot: fixture
    });
    assert.equal(first.fileCount, 1);
    assert.equal(first.byteCount, Buffer.byteLength("first\n"));
    assert.equal(first.files[0].byteCount, Buffer.byteLength("first\n"));
    await writeFile(path.join(fixture, "index.html"), "second\n", "utf8");
    const second = await collectCiRollbackArtifactEvidence({
      artifactRoot: fixture
    });
    assert.notEqual(first.sha256, second.sha256);
    await assert.rejects(
      createCiReleaseSuccessorInputFromRepository({
        projectRoot,
        epochId: "ci-rollback-injection-fixture",
        rollback: {
          predecessorCommitSha: PREDECESSOR_COMMIT,
          predecessorTreeSha: PREDECESSOR_TREE,
          artifactRoot: fixture,
          predecessorArtifactManifestSha256: "e".repeat(64)
        }
      }),
      /only its exact fields/u
    );
    await symlink(path.join(fixture, "index.html"), path.join(fixture, "rogue-link"));
    await assert.rejects(
      collectCiRollbackArtifactEvidence({ artifactRoot: fixture }),
      /must not contain symbolic links/u
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("contained-directory verifier rejects a symlink ancestor", async () => {
  const fixture = await mkdtemp(
    path.join(canonicalTemporaryRoot, "ss-ci-contained-root-")
  );
  const outside = await mkdtemp(
    path.join(canonicalTemporaryRoot, "ss-ci-contained-outside-")
  );
  try {
    await mkdir(path.join(outside, "releases"));
    await symlink(outside, path.join(fixture, "ops"));
    await assert.rejects(
      requireCiReleaseContainedDirectory({
        root: fixture,
        selected: path.join(fixture, "ops/releases"),
        label: "CI symlink fixture"
      }),
      /every ancestor must be real non-symlink directories/u
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("generation-state verifier rejects head and status drift", async () => {
  const fixture = await gitSecurityFixture();
  try {
    await assert.rejects(
      verifyCiReleaseGenerationState({
        projectRoot: fixture.root,
        expectedHead: "f".repeat(40),
        expectedTree: fixture.tree
      }),
      /checkout identity or status drifted/u
    );
    await writeFile(path.join(fixture.root, "unexpected.txt"), "drift\n", "utf8");
    await assert.rejects(
      verifyCiReleaseGenerationState({
        projectRoot: fixture.root,
        expectedHead: fixture.head,
        expectedTree: fixture.tree
      }),
      /checkout identity or status drifted/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("anchored writer removes output when an approved ancestor is swapped", async () => {
  const fixture = await mkdtemp(
    path.join(canonicalTemporaryRoot, "ss-ci-anchored-swap-")
  );
  const relativePath = "ops/releases/ci-successor-inputs/candidate.json";
  const readyPath = path.join(fixture, "writer-ready");
  const continuePath = path.join(fixture, "writer-continue");
  try {
    await mkdir(
      path.join(fixture, "ops/releases/ci-successor-inputs"),
      { recursive: true }
    );
    const writing = writeCiReleaseSuccessorInputAnchored({
      projectRoot: fixture,
      relativePath,
      successorInput: { authority: "held" },
      testControl: { readyPath, continuePath }
    });
    await waitForPath(readyPath);
    await rename(path.join(fixture, "ops"), path.join(fixture, "moved-ops"));
    await mkdir(
      path.join(fixture, "ops/releases/ci-successor-inputs"),
      { recursive: true }
    );
    await writeFile(continuePath, "continue\n", "utf8");
    await assert.rejects(writing, /anchored successor write failed cleanly/u);
    for (const selected of [
      path.join(fixture, relativePath),
      path.join(
        fixture,
        "moved-ops/releases/ci-successor-inputs/candidate.json"
      )
    ]) {
      await assert.rejects(access(selected), /ENOENT/u);
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("anchored writer removes output when the post-write identity check fails", async () => {
  const fixture = await mkdtemp(
    path.join(canonicalTemporaryRoot, "ss-ci-anchored-postcheck-")
  );
  const relativePath = "ops/releases/ci-successor-inputs/candidate.json";
  try {
    await mkdir(
      path.join(fixture, "ops/releases/ci-successor-inputs"),
      { recursive: true }
    );
    await assert.rejects(
      writeCiReleaseSuccessorInputAnchored({
        projectRoot: fixture,
        relativePath,
        successorInput: { authority: "held" },
        postWriteCheck: async () => {
          throw new Error("synthetic HEAD drift");
        }
      }),
      /synthetic HEAD drift/u
    );
    await assert.rejects(access(path.join(fixture, relativePath)), /ENOENT/u);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("successor control requires the exact one-file C2-to-K2 graph", async () => {
  const fixture = await mkdtemp(
    path.join(canonicalTemporaryRoot, "ss-ci-successor-control-")
  );
  const candidateSha = SOURCE_COMMIT;
  const workflowSha = "1".repeat(40);
  const expectedPath = ciReleaseSuccessorInputRelativePath(candidateSha);
  const inputPath = path.join(fixture, ...expectedPath.split("/"));
  const input = successorInput();
  const bytes = Buffer.from(`${canonicalJson(input)}\n`, "utf8");
  await mkdir(path.dirname(inputPath), { recursive: true });
  await writeFile(inputPath, bytes);

  const baseline = Object.freeze({
    head: workflowSha,
    tree: "3".repeat(40),
    status: "",
    parents: `${workflowSha} ${candidateSha}`,
    changedPaths: `A\t${expectedPath}`,
    candidateInputs: "",
    workflowInputs: expectedPath
  });
  const runner = (mutations = {}) => async (arguments_) => {
    const selected = { ...baseline, ...mutations };
    const command = arguments_.join(" ");
    if (command === "for-each-ref --format=%(refname) refs/replace/") {
      return selected.replaceRefs ?? "";
    }
    if (command === "rev-parse --git-path info/grafts") {
      return path.join(fixture, ".git/info/grafts");
    }
    if (command === "ls-files -v -z") return selected.assumeEntries ?? "";
    if (command === "ls-files -t -z") return selected.skipEntries ?? "";
    if (command === "rev-parse HEAD") return selected.head;
    if (command === "rev-parse HEAD^{tree}") return selected.tree;
    if (arguments_[0] === "status") return selected.status;
    if (arguments_[0] === "rev-list") return selected.parents;
    if (arguments_[0] === "diff-tree") return selected.changedPaths;
    if (arguments_[0] === "ls-tree") {
      return arguments_[3] === candidateSha
        ? selected.candidateInputs
        : selected.workflowInputs;
    }
    throw new Error("unexpected CI successor graph fixture command");
  };
  const verify = (options = {}) => verifyCiReleaseSuccessorControl({
    controlRoot: fixture,
    inputPath,
    expectedInputSha256: sha256Bytes(bytes),
    candidateSha,
    workflowSha,
    gitRunner: runner(options)
  });

  try {
    const proof = await verify();
    assert.equal(proof.inputPath, expectedPath);
    assert.equal(proof.successorInput.digest, input.digest);

    await assert.rejects(
      verify({ parents: `${workflowSha} ${candidateSha} ${"2".repeat(40)}` }),
      /exact candidate as its sole parent/u
    );
    await assert.rejects(
      verify({ changedPaths: `A\t${expectedPath}\nM\tunexpected.txt` }),
      /add only its exact successor input/u
    );
    await assert.rejects(
      verify({
        candidateInputs:
          "ops/releases/ci-successor-inputs/stale-candidate.json"
      }),
      /candidate must contain zero successor-input files/u
    );
    await assert.rejects(
      verify({
        workflowInputs: `${expectedPath}\nops/releases/ci-successor-inputs/stale-workflow.json`
      }),
      /workflow must contain only the exact candidate successor input/u
    );
    await assert.rejects(
      verifyCiReleaseSuccessorControl({
        controlRoot: fixture,
        inputPath: path.join(fixture, "wrong-input.json"),
        expectedInputSha256: sha256Bytes(bytes),
        candidateSha,
        workflowSha,
        gitRunner: runner()
      }),
      /exact candidate-named control file/u
    );
    await assert.rejects(
      verifyCiReleaseSuccessorControl({
        controlRoot: fixture,
        inputPath,
        expectedInputSha256: "2".repeat(64),
        candidateSha,
        workflowSha,
        gitRunner: runner()
      }),
      /bytes drifted from their explicit digest/u
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
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

test("browser receipt binds the reviewed six widths and rejects count or width drift", () => {
  assert.deepEqual(
    CI_RELEASE_BROWSER_WIDTHS,
    [320, 360, 390, 720, 768, 1440]
  );
  assert.equal(
    CI_RELEASE_BROWSER_VERSION,
    "Google Chrome for Testing 149.0.7827.55"
  );
  const input = successorInput();
  const selectedContext = context(input);
  const details = {
    routeCount: 15,
    viewCount: 90,
    widths: [...CI_RELEASE_BROWSER_WIDTHS],
    browserVersion: CI_RELEASE_BROWSER_VERSION,
    artifactManifestSha256: input.legalV4Pages.manifestSha256
  };
  const receipt = createCiReleaseStepReceipt({
    step: "browser",
    context: selectedContext,
    observedAt: "2026-08-10T22:00:00.000Z",
    details
  });
  assert.equal(receipt.details.viewCount, 15 * 6);

  for (const drift of [
    { ...details, viewCount: 45 },
    { ...details, viewCount: 89 },
    { ...details, widths: [320, 390, 1440], viewCount: 45 },
    { ...details, browserVersion: "Google Chrome for Testing 149.0.7827.54" },
    {
      ...details,
      widths: [320, 360, 390, 768, 720, 1440]
    }
  ]) {
    assert.throws(
      () => createCiReleaseStepReceipt({
        step: "browser",
        context: selectedContext,
        observedAt: "2026-08-10T22:00:00.000Z",
        details: drift
      }),
      /browser proof dimensions or browser identity/u
    );
  }
});

test("final receipt rejects Legal count or manifest drift from successor authority", () => {
  const input = successorInput();
  const selectedContext = context(input);
  for (const details of [
    {
      fileCount: input.legalV4Pages.fileCount + 1,
      manifestSha256: input.legalV4Pages.manifestSha256
    },
    {
      fileCount: input.legalV4Pages.fileCount,
      manifestSha256: "a".repeat(64)
    }
  ]) {
    const proofReceipts = receipts(input).map((receipt) =>
      receipt.step === "legal-v4"
        ? createCiReleaseStepReceipt({
            step: "legal-v4",
            context: selectedContext,
            observedAt: "2026-08-10T22:00:00.000Z",
            details
          })
        : receipt
    );
    assert.throws(
      () => createCiReleaseFinalReceipt({
        successorInput: input,
        context: selectedContext,
        receipts: proofReceipts
      }),
      /evidence drifted from its successor authority/u
    );
  }
});

test("Legal V4 proof requires the current successor-authorized 94-file tree", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "ss-ci-legal-v4-"));
  try {
    const artifact = path.join(fixture, "_site");
    await mkdir(artifact);
    for (let index = 0; index < 94; index += 1) {
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
    const input = successorInput(manifest.sha256, 94);
    const verified = await verifyCiLegalV4Artifact({
      projectRoot: fixture,
      artifactRoot: artifact,
      successorInput: input
    });
    assert.equal(verified.fileCount, 94);

    await assert.rejects(
      verifyCiLegalV4Artifact({
        projectRoot: fixture,
        artifactRoot: artifact,
        successorInput: successorInput(manifest.sha256, 93)
      }),
      /drifted from exact successor authority/u
    );
    await assert.rejects(
      verifyCiLegalV4Artifact({
        projectRoot: fixture,
        artifactRoot: artifact,
        successorInput: successorInput("a".repeat(64), 94)
      }),
      /drifted from exact successor authority/u
    );
    await writeFile(path.join(artifact, "unexpected.html"), "drift\n", "utf8");
    await assert.rejects(
      verifyCiLegalV4Artifact({
        projectRoot: fixture,
        artifactRoot: artifact,
        successorInput: input
      }),
      /drifted from exact successor authority/u
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Legal V4 proof accepts a different exact successor file count", async () => {
  const fixture = await mkdtemp(
    path.join(os.tmpdir(), "ss-ci-legal-successor-")
  );
  try {
    const artifact = path.join(fixture, "_site");
    await mkdir(artifact);
    for (let index = 0; index < 7; index += 1) {
      await writeFile(
        path.join(artifact, `successor-${index}.html`),
        `successor fixture ${index}\n`,
        "utf8"
      );
    }
    const manifest = await collectOriginTreeManifest({
      projectRoot: fixture,
      domain: "ci-legal-v4-pages",
      relativeRoot: "_site"
    });
    const verified = await verifyCiLegalV4Artifact({
      projectRoot: fixture,
      artifactRoot: artifact,
      successorInput: successorInput(manifest.sha256, 7)
    });
    assert.equal(verified.fileCount, 7);
    assert.equal(verified.sha256, manifest.sha256);
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
  const [source, runbook, cliSource, repositorySource, wiringNotes] = await Promise.all([
    readFile(
      path.join(projectRoot, ".github/workflows/ci-release-proof-held.yml"),
      "utf8"
    ),
    readFile(
      path.join(projectRoot, "ops/SITESOURCERY-CI-RELEASE-PROOF-HELD.md"),
      "utf8"
    ),
    readFile(path.join(projectRoot, "ops/ci-release-proof.mjs"), "utf8"),
    readFile(
      path.join(projectRoot, "ops/ci-release-proof-repository.mjs"),
      "utf8"
    ),
    readFile(path.join(projectRoot, "WIRING-NOTES-CI-01.md"), "utf8")
  ]);
  for (const required of [
    "workflow_dispatch:",
    "environment: ci-release-proof-held",
    "permissions: {}",
    "node-version: 24.18.0",
    "successor_input_sha256:",
    "npm test",
    "npm run check:ops",
    "build:pages && npm run check:artifact",
    "record exact successor Pages and browser evidence",
    "Build and verify complete held current successor hosted projection",
    "run: npm run check:hosted",
    "ss_ci_release_[1-9][0-9]*_[1-9][0-9]*",
    "ci-release-proof.mjs absence",
    "--control-root control",
    "--candidate-sha \"$CI_RELEASE_CANDIDATE_SHA\"",
    "--workflow-sha \"$CI_RELEASE_WORKFLOW_SHA\"",
    "final --root target --control-root control",
    "Re-bind protected proof after full candidate npm",
    "git --no-replace-objects -c core.fsmonitor=false",
    "ls-files -v",
    "ls-files -t"
  ]) assert.ok(source.includes(required), required);
  assertProtectedImplementationPaths(source);
  assert.throws(
    () => assertProtectedImplementationPaths(
      source.replace("            scripts/browser-audit-vnext.mjs \\\n", "")
    ),
    /Expected values to be strictly deep-equal/u
  );
  assert.throws(
    () => assertProtectedImplementationPaths(
      source.replace(
        "scripts/install-reviewed-chromium.sh",
        "scripts/install-unreviewed-browser.sh"
      )
    ),
    /Expected values to be strictly deep-equal/u
  );
  assert.ok(
    source.indexOf("npm test") <
        source.indexOf("Build and verify complete held current successor hosted projection") &&
      source.indexOf("Build and verify complete held current successor hosted projection") <
        source.indexOf("ci-release-proof.mjs final"),
    "complete current successor hosted projection must precede origin verification",
  );
  assert.doesNotMatch(source, /\b(?:upload|deploy)-(?:pages-)?artifact@/u);
  assert.doesNotMatch(source, /\b(?:deploy-pages|configure-pages)@/u);
  assert.doesNotMatch(source, /\b(?:stripe|cloudflare|resend)\b/iu);
  assert.doesNotMatch(source, /migration(?:Count| count)[^\n]*63/u);
  assert.doesNotMatch(source, /node target\/ops\/ci-release-proof\.mjs/u);
  assert.equal(
    source.match(/for checkout in control target/gmu)?.length,
    5
  );
  assert.doesNotMatch(source, /GIT_\*\|NODE_OPTIONS\|NODE_PATH/u);
  assert.equal(
    source.match(/node control\/ops\/ci-release-proof\.mjs/gmu)?.length,
    12
  );
  assert.match(
    runbook,
    /320, 360, 390, 720, 768, and 1440 CSS[\s\S]*144 route\/view combinations/u
  );
  for (const required of [
    "if (command === \"generate\")",
    '"--epoch-id"',
    '"--rollback-commit"',
    '"--rollback-tree"',
    '"--rollback-artifact-root"',
    "createCiReleaseSuccessorInputFromRepository",
    "writeCiReleaseSuccessorInputAnchored",
    "verifyCiReleaseGeneratedOutput"
  ]) assert.ok(cliSource.includes(required), required);
  assert.doesNotMatch(cliSource, /--rollback-artifact-sha/u);
  for (const required of [
    "fileConstants.O_NOFOLLOW",
    "handle.readFile()",
    "before.mtimeNs !== after.mtimeNs",
    '"--no-replace-objects"',
    "rejects hidden Git index flags without mutating them"
  ]) assert.ok(repositorySource.includes(required), required);
  assert.doesNotMatch(repositorySource, /--no-assume-unchanged|--no-skip-worktree/u);
  assert.match(wiringNotes, /these nine proof implementation files/u);
  for (const relativePath of CI_RELEASE_PROTECTED_IMPLEMENTATION_PATHS) {
    assert.ok(wiringNotes.includes(`\`${relativePath}\``), relativePath);
  }
});

test("CI implementation contains no fixed Legal V4 file-count authority", async () => {
  const sources = await Promise.all([
    "ops/ci-release-proof-runtime.mjs",
    "ops/ci-release-proof-repository.mjs",
    ".github/workflows/ci-release-proof-held.yml"
  ].map((relativePath) => readFile(path.join(projectRoot, relativePath), "utf8")));
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /CI_RELEASE_LEGAL_V4_FILE_COUNT/u);
  assert.doesNotMatch(combined, /(?:80|94)-file|exactly (?:80|94) files/iu);
});
