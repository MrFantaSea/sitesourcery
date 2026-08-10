import { execFile } from "node:child_process";
import {
  lstat,
  readFile,
  readdir
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  parseJsonObject,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  collectOriginTreeManifest,
  verifyOriginReleaseRepository
} from "./origin-seal-repository.mjs";
import {
  CI_RELEASE_LEGAL_V4_FILE_COUNT,
  CI_RELEASE_PINNED_NODE,
  ciReleaseProofSteps,
  createCiReleaseFinalReceipt,
  validateCiReleaseStepReceipt,
  validateCiReleaseSuccessorInput
} from "./ci-release-proof-runtime.mjs";

const executeFile = promisify(execFile);

function fail(message) {
  throw new Error(message);
}

function inside(root, selected, label) {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(selected);
  const relation = path.relative(absoluteRoot, absolute);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  ) {
    fail(`${label} must remain below its exact root.`);
  }
  return absolute;
}

async function regularFile(selected, label) {
  const metadata = await lstat(selected);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`${label} must be a regular non-symlink file.`);
  }
  return metadata;
}

export async function readCiReleaseSuccessorInput({
  inputPath,
  expectedSha256
}) {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256 ?? "")) {
    fail("CI successor input requires an explicit lowercase SHA-256.");
  }
  await regularFile(inputPath, "CI successor input");
  const bytes = await readFile(inputPath);
  if (sha256Bytes(bytes) !== expectedSha256) {
    fail("CI successor input bytes drifted from their explicit digest.");
  }
  return validateCiReleaseSuccessorInput(
    parseJsonObject(bytes.toString("utf8"), "CI successor input")
  );
}

async function defaultGitRunner(arguments_, projectRoot) {
  const result = await executeFile("git", arguments_, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  return result.stdout.trim();
}

export async function verifyCiReleaseCandidate({
  projectRoot,
  successorInput,
  gitRunner = defaultGitRunner
}) {
  const input = validateCiReleaseSuccessorInput(successorInput);
  const expectedCommit = input.originReleaseInput.epoch.source.commitSha;
  const [head, status, nodeVersion] = await Promise.all([
    gitRunner(["rev-parse", "HEAD"], projectRoot),
    gitRunner(
      ["status", "--porcelain=v1", "--untracked-files=no"],
      projectRoot
    ),
    readFile(path.join(projectRoot, ".nvmrc"), "utf8")
  ]);
  if (head !== expectedCommit || status !== "") {
    fail("CI candidate Git identity is dirty or drifted.");
  }
  if (nodeVersion.trim() !== CI_RELEASE_PINNED_NODE) {
    fail("CI candidate Node version drifted from the pinned release runtime.");
  }

  const migrationRoot =
    input.originReleaseInput.epoch.layout.migrationRoot;
  const absoluteMigrationRoot = inside(
    projectRoot,
    path.join(projectRoot, migrationRoot),
    "CI migration root"
  );
  const entries = await readdir(absoluteMigrationRoot, {
    withFileTypes: true
  });
  if (entries.some((entry) => entry.isSymbolicLink())) {
    fail("CI migration inventory contains a symbolic link.");
  }
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const expectedNames = input.migrationInventory.files.map(
    (entry) => entry.name
  );
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    fail("CI candidate migration names drifted from the successor inventory.");
  }
  for (const expected of input.migrationInventory.files) {
    const selected = path.join(absoluteMigrationRoot, expected.name);
    const metadata = await regularFile(selected, `CI migration ${expected.name}`);
    const actualDigest = sha256Bytes(await readFile(selected));
    if (
      metadata.size !== expected.byteCount ||
      actualDigest !== expected.sha256
    ) {
      fail(`CI migration bytes drifted: ${expected.name}.`);
    }
  }
  return Object.freeze({
    candidateSha: head,
    migrationCount: names.length,
    latestMigration: names.at(-1)
  });
}

export async function verifyCiLegalV4Artifact({
  projectRoot,
  artifactRoot,
  successorInput
}) {
  const input = validateCiReleaseSuccessorInput(successorInput);
  const relativeRoot = path.relative(
    path.resolve(projectRoot),
    path.resolve(artifactRoot)
  ).split(path.sep).join("/");
  if (!relativeRoot || relativeRoot.startsWith("../")) {
    fail("CI Legal V4 artifact must remain inside the candidate checkout.");
  }
  const manifest = await collectOriginTreeManifest({
    projectRoot,
    domain: "ci-legal-v4-pages",
    relativeRoot
  });
  if (
    manifest.fileCount !== CI_RELEASE_LEGAL_V4_FILE_COUNT ||
    manifest.fileCount !== input.legalV4Pages.fileCount ||
    manifest.sha256 !== input.legalV4Pages.manifestSha256
  ) {
    fail("CI Legal V4 80-file artifact drifted from successor authority.");
  }
  return manifest;
}

export async function readCiStepReceipts({ evidenceRoot }) {
  const receipts = [];
  for (const step of ciReleaseProofSteps()) {
    const selected = inside(
      evidenceRoot,
      path.join(evidenceRoot, `${step}.json`),
      `CI ${step} receipt`
    );
    await regularFile(selected, `CI ${step} receipt`);
    receipts.push(
      validateCiReleaseStepReceipt(
        parseJsonObject(
          await readFile(selected, "utf8"),
          `CI ${step} receipt`
        )
      )
    );
  }
  return receipts;
}

export async function verifyCiReleaseFinal({
  projectRoot,
  successorInput,
  context,
  evidenceRoot,
  gitRunner = defaultGitRunner
}) {
  await verifyCiReleaseCandidate({
    projectRoot,
    successorInput,
    gitRunner
  });
  await verifyOriginReleaseRepository({
    projectRoot,
    releaseInput: successorInput.originReleaseInput,
    gitRunner
  });
  await verifyCiLegalV4Artifact({
    projectRoot,
    artifactRoot: path.join(projectRoot, "_site"),
    successorInput
  });
  const receipts = await readCiStepReceipts({ evidenceRoot });
  return createCiReleaseFinalReceipt({
    successorInput,
    context,
    receipts
  });
}
