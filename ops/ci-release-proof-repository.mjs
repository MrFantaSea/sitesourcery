import { execFile } from "node:child_process";
import { constants as fileConstants } from "node:fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  parseJsonObject,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  collectOriginRepositorySnapshot,
  collectOriginTreeManifest,
  verifyOriginReleaseRepository
} from "./origin-seal-repository.mjs";
import {
  CI_RELEASE_PINNED_NODE,
  ciReleaseProofSteps,
  createCiReleaseSuccessorInput,
  createCiReleaseFinalReceipt,
  validateCiReleaseStepReceipt,
  validateCiReleaseSuccessorInput
} from "./ci-release-proof-runtime.mjs";
import {
  SHAPE_EPOCH_ID,
  releaseEpochBindingSha256
} from "./release-epoch.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
  ORIGIN_UNION_BASE_COMMIT,
  createOriginReleaseInput,
  originFileManifestSha256
} from "./origin-seal-runtime.mjs";

const executeFile = promisify(execFile);
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const MAXIMUM_ROLLBACK_ARTIFACT_FILES = 100_000;
const MAXIMUM_ROLLBACK_ARTIFACT_BYTES = 4 * 1024 * 1024 * 1024;

export const CI_RELEASE_SUCCESSOR_INPUT_DIRECTORY =
  "ops/releases/ci-successor-inputs";
export const CI_RELEASE_GENERATION_LAYOUT = Object.freeze({
  artifactRoot: "_hosted",
  migrationRoot: "server/data-plane/supabase/migrations",
  legalConstantsPath:
    "ops/releases/final-successor-20260811/joint-legal-v5-finalization/joint-legal-v5-release-constants.json"
});

function fail(message) {
  throw new Error(message);
}

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
  ) {
    fail(`${label} must contain only its exact fields.`);
  }
  return value;
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

export async function requireCiReleaseRealDirectory(selected, label) {
  const absolute = path.resolve(selected);
  const root = path.parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const metadata = await lstat(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      fail(`${label} and every ancestor must be real non-symlink directories.`);
    }
  }
  if (await realpath(absolute) !== absolute) {
    fail(`${label} must use its exact canonical real path.`);
  }
  return absolute;
}

export async function requireCiReleaseContainedDirectory({
  root,
  selected,
  label
}) {
  const absoluteRoot = await requireCiReleaseRealDirectory(root, `${label} root`);
  const absolute = await requireCiReleaseRealDirectory(selected, label);
  const relation = path.relative(absoluteRoot, absolute);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  ) {
    fail(`${label} must remain below its exact real root.`);
  }
  return absolute;
}

export function assertCiReleaseSafeEnvironment(environment = process.env) {
  const dangerous = Object.keys(environment).filter((name) =>
    [
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_CEILING_DIRECTORIES",
      "GIT_COMMON_DIR",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_NOSYSTEM",
      "GIT_CONFIG_PARAMETERS",
      "GIT_CONFIG_SYSTEM",
      "GIT_DIR",
      "GIT_DISCOVERY_ACROSS_FILESYSTEM",
      "GIT_GRAFT_FILE",
      "GIT_INDEX_FILE",
      "GIT_NAMESPACE",
      "GIT_OBJECT_DIRECTORY",
      "GIT_REPLACE_REF_BASE",
      "GIT_WORK_TREE",
      "NODE_OPTIONS",
      "NODE_PATH"
    ].includes(name) ||
    name.startsWith("GIT_CONFIG_KEY_") ||
    name.startsWith("GIT_CONFIG_VALUE_") ||
    name === "GIT_CONFIG_COUNT"
  );
  if (dangerous.length > 0) {
    fail(`CI release proof rejects ambient Git or Node overrides: ${dangerous.sort().join(", ")}.`);
  }
  return true;
}

export function ciReleaseGitArguments(arguments_) {
  return [
    "--no-replace-objects",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    ...arguments_
  ];
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
  assertCiReleaseSafeEnvironment();
  const result = await executeFile("git", ciReleaseGitArguments(arguments_), {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_CONFIG_NOSYSTEM: "1"
    }
  });
  return result.stdout.trim();
}

async function requireGit(gitRunner, projectRoot, arguments_, label) {
  try {
    return await gitRunner(arguments_, projectRoot);
  } catch {
    fail(`${label} is unavailable or invalid.`);
  }
}

function exactCommit(value, label) {
  if (typeof value !== "string" || !COMMIT_SHA.test(value)) {
    fail(`${label} must be an exact lowercase commit SHA.`);
  }
  return value;
}

function lines(value) {
  return value === "" ? [] : value.split("\n");
}

function exactSuccessorInputPaths(entries, label) {
  const prefix = `${CI_RELEASE_SUCCESSOR_INPUT_DIRECTORY}/`;
  const selected = [...entries];
  const sorted = [...selected].sort((left, right) => left.localeCompare(right));
  if (
    JSON.stringify(selected) !== JSON.stringify(sorted) ||
    new Set(selected).size !== selected.length ||
    selected.some((entry) => (
      !entry.startsWith(prefix) ||
      !COMMIT_SHA.test(entry.slice(prefix.length, -".json".length)) ||
      !entry.endsWith(".json") ||
      entry.slice(prefix.length, -".json".length).length !== 40
    ))
  ) {
    fail(`${label} must contain only sorted candidate-SHA JSON paths.`);
  }
  return selected;
}

async function requireSuccessorInputFiles(projectRoot, entries, label) {
  for (const entry of entries) {
    const selected = inside(
      projectRoot,
      path.join(projectRoot, ...entry.split("/")),
      label
    );
    const metadata = await regularFile(selected, label);
    if (metadata.nlink !== 1) {
      fail(`${label} files must have exactly one hard link.`);
    }
  }
}

function nulEntries(value) {
  return value === "" ? [] : value.split("\0").filter(Boolean);
}

async function rejectGitGraphOverrides({
  projectRoot,
  gitRunner
}) {
  assertCiReleaseSafeEnvironment();
  const [replaceRefs, graftsPath] = await Promise.all([
    requireGit(
      gitRunner,
      projectRoot,
      ["for-each-ref", "--format=%(refname)", "refs/replace/"],
      "CI Git replace-ref inventory"
    ),
    requireGit(
      gitRunner,
      projectRoot,
      ["rev-parse", "--git-path", "info/grafts"],
      "CI Git graft path"
    )
  ]);
  if (replaceRefs !== "") {
    fail("CI release proof rejects Git replace refs.");
  }
  const absoluteGraftsPath = path.isAbsolute(graftsPath)
    ? graftsPath
    : path.resolve(projectRoot, graftsPath);
  try {
    await lstat(absoluteGraftsPath);
    fail("CI release proof rejects Git graft files.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function rejectHiddenIndexFlags({ projectRoot, gitRunner }) {
  const [verboseEntries, taggedEntries] = await Promise.all([
    requireGit(
      gitRunner,
      projectRoot,
      ["ls-files", "-v", "-z"],
      "CI assume-unchanged inventory"
    ),
    requireGit(
      gitRunner,
      projectRoot,
      ["ls-files", "-t", "-z"],
      "CI skip-worktree inventory"
    )
  ]);
  const flagged = new Set();
  for (const entry of nulEntries(verboseEntries)) {
    if (/^[a-z] /u.test(entry)) flagged.add(entry.slice(2));
  }
  for (const entry of nulEntries(taggedEntries)) {
    if (entry.startsWith("S ")) flagged.add(entry.slice(2));
  }
  if (flagged.size > 0) {
    fail("CI release proof rejects hidden Git index flags without mutating them.");
  }
}

export async function verifyCiReleaseGitCheckout({
  projectRoot,
  expectedHead,
  expectedTree,
  expectedStatus = "",
  gitRunner = defaultGitRunner
}) {
  const absoluteRoot = await requireCiReleaseRealDirectory(
    projectRoot,
    "CI Git checkout"
  );
  await rejectGitGraphOverrides({ projectRoot: absoluteRoot, gitRunner });
  await rejectHiddenIndexFlags({ projectRoot: absoluteRoot, gitRunner });
  const [head, tree, status] = await Promise.all([
    requireGit(gitRunner, absoluteRoot, ["rev-parse", "HEAD"], "CI Git HEAD"),
    requireGit(
      gitRunner,
      absoluteRoot,
      ["rev-parse", "HEAD^{tree}"],
      "CI Git tree"
    ),
    requireGit(
      gitRunner,
      absoluteRoot,
      ["status", "--porcelain=v1", "--untracked-files=all"],
      "CI Git status"
    )
  ]);
  exactCommit(head, "CI Git HEAD");
  if (!COMMIT_SHA.test(tree)) fail("CI Git tree is invalid.");
  if (
    (expectedHead !== undefined && head !== expectedHead) ||
    (expectedTree !== undefined && tree !== expectedTree) ||
    status !== expectedStatus
  ) {
    fail("CI Git checkout identity or status drifted.");
  }
  return Object.freeze({ projectRoot: absoluteRoot, head, tree, status });
}

export async function collectCiRollbackArtifactEvidence({ artifactRoot }) {
  const absoluteRoot = await requireCiReleaseRealDirectory(
    artifactRoot,
    "CI rollback artifact evidence"
  );
  const pending = [{ absolute: absoluteRoot, relative: "" }];
  const files = [];
  let byteCount = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current.absolute, { withFileTypes: true });
    entries.sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        fail("CI rollback artifact evidence must not contain symbolic links.");
      }
      const absolute = path.join(current.absolute, entry.name);
      const relative = current.relative
        ? path.posix.join(current.relative, entry.name)
        : entry.name;
      if (entry.isDirectory()) {
        pending.push({ absolute, relative });
      } else if (entry.isFile()) {
        const handle = await open(
          absolute,
          fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW
        );
        try {
          const before = await handle.stat({ bigint: true });
          if (!before.isFile() || before.size > BigInt(MAXIMUM_ROLLBACK_ARTIFACT_BYTES)) {
            fail("CI rollback artifact evidence contains an invalid file.");
          }
          const expectedSize = Number(before.size);
          if (
            files.length + 1 > MAXIMUM_ROLLBACK_ARTIFACT_FILES ||
            byteCount + expectedSize > MAXIMUM_ROLLBACK_ARTIFACT_BYTES
          ) {
            fail("CI rollback artifact evidence exceeded its exact bounds.");
          }
          const bytes = await handle.readFile();
          const after = await handle.stat({ bigint: true });
          if (
            bytes.length !== expectedSize ||
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeNs !== after.mtimeNs ||
            before.ctimeNs !== after.ctimeNs
          ) {
            fail("CI rollback artifact evidence changed during its no-follow read.");
          }
          byteCount += expectedSize;
          files.push({
            path: path.posix.join(CI_RELEASE_GENERATION_LAYOUT.artifactRoot, relative),
            byteCount: expectedSize,
            sha256: sha256Bytes(bytes)
          });
        } finally {
          await handle.close();
        }
      } else {
        fail("CI rollback artifact evidence contains an unsupported entry.");
      }
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  if (files.length === 0) {
    fail("CI rollback artifact evidence must contain at least one file.");
  }
  const manifest = {
    domain: "origin-artifact",
    fileCount: files.length,
    byteCount,
    files
  };
  return Object.freeze({
    ...manifest,
    files: Object.freeze(files.map((entry) => Object.freeze(entry))),
    sha256: originFileManifestSha256(manifest)
  });
}

export function ciReleaseSuccessorInputRelativePath(candidateSha) {
  return path.posix.join(
    CI_RELEASE_SUCCESSOR_INPUT_DIRECTORY,
    `${exactCommit(candidateSha, "CI successor candidate")}.json`
  );
}

export async function verifyCiReleaseSuccessorControl({
  controlRoot,
  inputPath,
  expectedInputSha256,
  candidateSha,
  workflowSha,
  gitRunner = defaultGitRunner
}) {
  const candidate = exactCommit(candidateSha, "CI successor candidate");
  const workflow = exactCommit(workflowSha, "CI successor workflow");
  const expectedRelativePath = ciReleaseSuccessorInputRelativePath(candidate);
  const expectedInputPath = inside(
    controlRoot,
    path.join(controlRoot, ...expectedRelativePath.split("/")),
    "CI successor control input"
  );
  if (path.resolve(inputPath) !== expectedInputPath) {
    fail("CI successor input path is not the exact candidate-named control file.");
  }

  await verifyCiReleaseGitCheckout({
    projectRoot: controlRoot,
    expectedHead: workflow,
    gitRunner
  });

  const [
    parentLine,
    changedPaths,
    candidateInputs,
    workflowInputs
  ] = await Promise.all([
    requireGit(
      gitRunner,
      controlRoot,
      ["rev-list", "--parents", "-n", "1", workflow],
      "CI successor parent graph"
    ),
    requireGit(
      gitRunner,
      controlRoot,
      ["diff-tree", "--no-commit-id", "--name-status", "-r", candidate, workflow, "--"],
      "CI successor changed paths"
    ),
    requireGit(
      gitRunner,
      controlRoot,
      ["ls-tree", "-r", "--name-only", candidate, "--", CI_RELEASE_SUCCESSOR_INPUT_DIRECTORY],
      "CI candidate successor-input inventory"
    ),
    requireGit(
      gitRunner,
      controlRoot,
      ["ls-tree", "-r", "--name-only", workflow, "--", CI_RELEASE_SUCCESSOR_INPUT_DIRECTORY],
      "CI workflow successor-input inventory"
    )
  ]);
  if (parentLine !== `${workflow} ${candidate}`) {
    fail("CI successor workflow must have the exact candidate as its sole parent.");
  }
  if (changedPaths !== `A\t${expectedRelativePath}`) {
    fail("CI candidate-to-workflow change must add only its exact successor input.");
  }
  const candidateInputPaths = exactSuccessorInputPaths(
    lines(candidateInputs),
    "CI candidate successor-input inventory"
  );
  const workflowInputPaths = exactSuccessorInputPaths(
    lines(workflowInputs),
    "CI workflow successor-input inventory"
  );
  if (candidateInputPaths.includes(expectedRelativePath)) {
    fail("CI candidate already contains its candidate-named successor input.");
  }
  const expectedWorkflowInputPaths = [
    ...candidateInputPaths,
    expectedRelativePath
  ].sort((left, right) => left.localeCompare(right));
  if (
    JSON.stringify(workflowInputPaths) !==
      JSON.stringify(expectedWorkflowInputPaths)
  ) {
    fail("CI workflow must retain every historical input and add only the exact candidate input.");
  }
  await requireSuccessorInputFiles(
    controlRoot,
    workflowInputPaths,
    "CI workflow successor input"
  );

  const successorInput = await readCiReleaseSuccessorInput({
    inputPath: expectedInputPath,
    expectedSha256: expectedInputSha256
  });
  if (successorInput.originReleaseInput.epoch.source.commitSha !== candidate) {
    fail("CI successor input source does not match the exact candidate parent.");
  }
  return Object.freeze({
    candidateSha: candidate,
    workflowSha: workflow,
    inputPath: expectedRelativePath,
    successorInput
  });
}

export async function verifyCiReleaseGenerationState({
  projectRoot,
  expectedHead,
  expectedTree,
  expectedStatus = "",
  gitRunner = defaultGitRunner
}) {
  const checkout = await verifyCiReleaseGitCheckout({
    projectRoot,
    expectedHead,
    expectedTree,
    expectedStatus,
    gitRunner
  });
  const [repositoryRoot, existingInputs] = await Promise.all([
    requireGit(
      gitRunner,
      checkout.projectRoot,
      ["rev-parse", "--show-toplevel"],
      "CI candidate root"
    ),
    requireGit(
      gitRunner,
      checkout.projectRoot,
      [
        "ls-tree",
        "-r",
        "--name-only",
        "HEAD",
        "--",
        CI_RELEASE_SUCCESSOR_INPUT_DIRECTORY
      ],
      "CI candidate successor-input inventory"
    )
  ]);
  if (path.resolve(repositoryRoot) !== checkout.projectRoot) {
    fail("CI successor generation requires the exact candidate root.");
  }
  const existingInputPaths = exactSuccessorInputPaths(
    lines(existingInputs),
    "CI candidate successor-input inventory"
  );
  await requireSuccessorInputFiles(
    checkout.projectRoot,
    existingInputPaths,
    "CI retained successor input"
  );
  const candidateInputPath = ciReleaseSuccessorInputRelativePath(checkout.head);
  if (existingInputPaths.includes(candidateInputPath)) {
    fail("CI successor generation refuses a candidate-named input collision.");
  }
  return Object.freeze({
    projectRoot: checkout.projectRoot,
    head: checkout.head,
    tree: checkout.tree,
    existingInputPaths: Object.freeze([...existingInputPaths])
  });
}

export async function verifyCiReleaseGeneratedOutput({
  projectRoot,
  candidateSha,
  candidateTreeSha,
  relativePath,
  gitRunner = defaultGitRunner
}) {
  if (relativePath !== ciReleaseSuccessorInputRelativePath(candidateSha)) {
    fail("CI generated successor output path drifted from its candidate.");
  }
  const state = await verifyCiReleaseGenerationState({
    projectRoot,
    expectedHead: candidateSha,
    expectedTree: candidateTreeSha,
    expectedStatus: `?? ${relativePath}`,
    gitRunner
  });
  const selected = inside(
    state.projectRoot,
    path.join(state.projectRoot, ...relativePath.split("/")),
    "CI generated successor output"
  );
  await regularFile(selected, "CI generated successor output");
  return state;
}

export async function createCiReleaseSuccessorInputFromRepository({
  projectRoot,
  epochId,
  rollback,
  gitRunner = defaultGitRunner
}) {
  exactObject(
    rollback,
    ["predecessorCommitSha", "predecessorTreeSha", "artifactRoot"],
    "CI rollback evidence request"
  );
  const predecessorCommitSha = exactCommit(
    rollback.predecessorCommitSha,
    "CI rollback predecessor"
  );
  if (!COMMIT_SHA.test(rollback.predecessorTreeSha ?? "")) {
    fail("CI rollback predecessor tree must be an exact lowercase Git tree SHA.");
  }
  const initial = await verifyCiReleaseGenerationState({
    projectRoot,
    gitRunner
  });
  const absoluteRoot = initial.projectRoot;
  const [predecessorTree, rollbackArtifact] = await Promise.all([
    requireGit(
      gitRunner,
      absoluteRoot,
      ["rev-parse", `${predecessorCommitSha}^{tree}`],
      "CI rollback predecessor tree"
    ),
    collectCiRollbackArtifactEvidence({ artifactRoot: rollback.artifactRoot })
  ]);
  if (predecessorTree !== rollback.predecessorTreeSha) {
    fail("CI rollback predecessor commit and tree do not match.");
  }

  const snapshot = await collectOriginRepositorySnapshot({
    projectRoot: absoluteRoot,
    layout: CI_RELEASE_GENERATION_LAYOUT
  });
  const legalV4Pages = await collectOriginTreeManifest({
    projectRoot: absoluteRoot,
    domain: "ci-legal-v4-pages",
    relativeRoot: "_site"
  });
  const originReleaseInput = createOriginReleaseInput({
    releaseId: initial.head,
    epoch: {
      schema: ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
      epochId,
      supersedes: {
        epochId: SHAPE_EPOCH_ID,
        bindingSha256: releaseEpochBindingSha256()
      },
      basis: { unionBaseCommitSha: ORIGIN_UNION_BASE_COMMIT },
      layout: structuredClone(CI_RELEASE_GENERATION_LAYOUT),
      source: { commitSha: initial.head, treeSha: initial.tree },
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
        predecessorCommitSha,
        predecessorTreeSha: predecessorTree,
        predecessorArtifactManifestSha256: rollbackArtifact.sha256
      },
      authority: structuredClone(ORIGIN_HELD_AUTHORITY)
    }
  });
  const successorInput = createCiReleaseSuccessorInput({
    originReleaseInput,
    migrationInventory: {
      count: snapshot.migration.count,
      latest: snapshot.migration.latest,
      files: snapshot.migration.files.map((entry) => ({
        name: entry.path.split("/").at(-1),
        byteCount: entry.byteCount,
        sha256: entry.sha256
      })),
      manifestSha256: snapshot.migration.sha256
    },
    legalV4Pages: {
      fileCount: legalV4Pages.fileCount,
      manifestSha256: legalV4Pages.sha256
    }
  });
  await verifyOriginReleaseRepository({
    projectRoot: absoluteRoot,
    releaseInput: originReleaseInput,
    gitRunner
  });
  await verifyCiLegalV4Artifact({
    projectRoot: absoluteRoot,
    artifactRoot: path.join(absoluteRoot, "_site"),
    successorInput
  });
  return Object.freeze({
    candidateSha: initial.head,
    candidateTreeSha: initial.tree,
    existingInputPaths: initial.existingInputPaths,
    rollbackArtifactManifestSha256: rollbackArtifact.sha256,
    relativePath: ciReleaseSuccessorInputRelativePath(initial.head),
    successorInput
  });
}

export async function verifyCiReleaseCandidate({
  projectRoot,
  successorInput,
  gitRunner = defaultGitRunner
}) {
  const input = validateCiReleaseSuccessorInput(successorInput);
  const expectedCommit = input.originReleaseInput.epoch.source.commitSha;
  const checkout = await verifyCiReleaseGitCheckout({
    projectRoot,
    expectedHead: expectedCommit,
    expectedTree: input.originReleaseInput.epoch.source.treeSha,
    gitRunner
  });
  const nodeVersion = await readFile(path.join(projectRoot, ".nvmrc"), "utf8");
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
    candidateSha: checkout.head,
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
    manifest.fileCount !== input.legalV4Pages.fileCount ||
    manifest.sha256 !== input.legalV4Pages.manifestSha256
  ) {
    fail("CI Legal V4 artifact drifted from exact successor authority.");
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
