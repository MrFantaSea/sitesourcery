import { deploymentProfileFields } from "./origin-deployment-profiles.mjs";
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
    "ops/releases/legal-v7-20260831/joint-legal-v7-release-constants.json"
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
  return arguments_[0] === "cat-file" ? result.stdout : result.stdout.trim();
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

async function readCiReleaseSuccessorControlGraph({
  projectRoot,
  candidate,
  workflow,
  gitRunner
}) {
  const expectedRelativePath = ciReleaseSuccessorInputRelativePath(candidate);
  const [
    parentLine,
    changedPaths,
    candidateInputs,
    workflowInputs
  ] = await Promise.all([
    requireGit(
      gitRunner,
      projectRoot,
      ["rev-list", "--parents", "-n", "1", workflow],
      "CI successor parent graph"
    ),
    requireGit(
      gitRunner,
      projectRoot,
      ["diff-tree", "--no-commit-id", "--name-status", "-r", candidate, workflow, "--"],
      "CI successor changed paths"
    ),
    requireGit(
      gitRunner,
      projectRoot,
      ["ls-tree", "-r", "--name-only", candidate, "--", CI_RELEASE_SUCCESSOR_INPUT_DIRECTORY],
      "CI candidate successor-input inventory"
    ),
    requireGit(
      gitRunner,
      projectRoot,
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
  return { expectedRelativePath, workflowInputPaths };
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

  const { workflowInputPaths } = await readCiReleaseSuccessorControlGraph({
    projectRoot: controlRoot,
    candidate,
    workflow,
    gitRunner
  });
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

export const CI_PROVENANCE_DIRECTORY = "ops/releases/ci-provenance";
export const CI_PROVENANCE_LEDGER =
  "ops/releases/final-successor-20260811/BUILD-LEDGER.md";
const PROVENANCE_BASELINE = Object.freeze({
  commit: "d180bbcbdda786c3988c9f3fa6704558d42581f6",
  tree: "57bda0977042aa88e38b69f78cbcfd3d7993eb0f"
});

function proofText(value, label) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 4096) {
    fail(`${label} requires nonempty bounded text.`);
  }
}

function proofDigest(value, label) {
  if (!/^[a-f0-9]{64}$/u.test(value ?? "")) {
    fail(`${label} requires an exact SHA-256.`);
  }
}

function validateCandidateProof(record) {
  exactObject(record, [
    "schema", "implementation", "provenanceSha256", "ledger", "proofs", "disposables"
  ], "Candidate provenance");
  if (record.schema !== "sitesourcery.candidate-provenance/v1") {
    fail("Candidate provenance schema is invalid.");
  }
  exactObject(record.implementation, ["commitSha", "treeSha", "baseCommitSha"], "Implementation");
  for (const [key, value] of Object.entries(record.implementation)) exactCommit(value, key);
  proofDigest(record.provenanceSha256, "Canonical provenance");
  exactObject(record.ledger, ["previousByteCount", "previousSha256", "appendSha256"], "Ledger proof");
  if (!Number.isSafeInteger(record.ledger.previousByteCount) || record.ledger.previousByteCount <= 0) {
    fail("Ledger prefix byte count must be positive.");
  }
  proofDigest(record.ledger.previousSha256, "Ledger prefix");
  proofDigest(record.ledger.appendSha256, "Ledger append");
  exactObject(record.proofs, ["focused", "fullNpm", "review", "postgres"], "Candidate proofs");
  for (const step of ["focused", "fullNpm"]) {
    const proof = exactObject(record.proofs[step], ["command", "exitCode", "logSha256"], step);
    proofText(proof.command, `${step} command`);
    proofDigest(proof.logSha256, `${step} log`);
    if (proof.exitCode !== 0) fail(`${step} proof must have passed.`);
  }
  if (record.proofs.fullNpm.command !== "npm test") fail("Complete npm test proof is required.");
  exactObject(record.proofs.review, ["status", "summary"], "Review proof");
  if (record.proofs.review.status !== "passed") fail("Candidate review must have passed.");
  proofText(record.proofs.review.summary, "Review summary");
  const pg = record.proofs.postgres;
  if (pg?.status === "not_applicable") {
    exactObject(pg, ["status", "reason"], "PostgreSQL disposition");
    proofText(pg.reason, "PostgreSQL inapplicability reason");
  } else {
    exactObject(pg, ["status", "receiptSha256"], "PostgreSQL proof");
    if (pg.status !== "passed") fail("Applicable PostgreSQL proof must have passed.");
    proofDigest(pg.receiptSha256, "PostgreSQL receipt");
  }
  exactObject(record.disposables, ["status", "summary"], "Disposable cleanup");
  if (!["none_created", "removed"].includes(record.disposables.status)) {
    fail("Disposable resources must be absent or removed.");
  }
  proofText(record.disposables.summary, "Disposable cleanup summary");
  return record;
}

// Evidence describes earlier implementation I, never its own enclosing commit.
// A protected squash need not contain I in its ancestry, but I must be retained.
export async function verifyCiCandidateProvenance({
  projectRoot,
  gitRunner = defaultGitRunner
}) {
  const checkout = await verifyCiReleaseGitCheckout({ projectRoot, gitRunner });
  const run = (args, label) => requireGit(gitRunner, checkout.projectRoot, args, label);
  const parents = async (commit) => {
    const graph = (await run(["rev-list", "--parents", "-n", "1", commit], "Provenance parent graph")).split(" ");
    if (graph[0] !== commit || graph.length < 2 || graph.length > 3) {
      fail("Candidate must have one parent or an exact two-parent PR merge.");
    }
    graph.forEach((entry) => exactCommit(entry, "Provenance graph commit"));
    return graph.slice(1);
  };
  const tree = (commit) => run(["rev-parse", `${commit}^{tree}`], "Provenance tree");
  const diff = (from, to) => run([
    "diff-tree", "--no-commit-id", "--no-renames", "--name-status", "-r", from, to, "--"
  ], "Provenance changed paths");
  const blob = async (commit, selected) => {
    const entry = await run(["ls-tree", commit, "--", selected], "Provenance file mode");
    const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/u.exec(entry);
    if (!match || match[2] !== selected) fail("Provenance must use exact regular Git files.");
    return Buffer.from(await run(["cat-file", "blob", match[1]], "Provenance file bytes"), "utf8");
  };

  let candidate = checkout.head;
  let prBase;
  let candidateParents = await parents(candidate);
  if (candidateParents.length === 2) {
    [prBase, candidate] = candidateParents;
    if (await tree(candidate) !== checkout.tree) fail("PR merge must preserve the exact source evidence tree.");
    candidateParents = await parents(candidate);
  }
  if (candidateParents.length !== 1) fail("Evidence candidate must have a sole parent.");
  let controlSha;
  const controlPath = ciReleaseSuccessorInputRelativePath(candidateParents[0]);
  if (await diff(candidateParents[0], candidate) === `A\t${controlPath}`) {
    controlSha = candidate;
    candidate = candidateParents[0];
    await readCiReleaseSuccessorControlGraph({
      projectRoot: checkout.projectRoot, candidate, workflow: controlSha, gitRunner
    });
    const input = validateCiReleaseSuccessorInput(parseJsonObject(
      (await blob(controlSha, controlPath)).toString("utf8"), "Provenance successor input"
    ));
    if (input.originReleaseInput.epoch.source.commitSha !== candidate ||
        input.originReleaseInput.epoch.source.treeSha !== await tree(candidate)) {
      fail("Provenance successor input must bind its exact candidate.");
    }
    if (prBase && prBase !== candidate) fail("Control PR base must be its exact candidate.");
    candidateParents = await parents(candidate);
  }
  if (candidate === PROVENANCE_BASELINE.commit && await tree(candidate) === PROVENANCE_BASELINE.tree) {
    if (prBase || controlSha) fail("Historical baseline cannot authorize a new merge or control.");
    return Object.freeze({ status: "historical_baseline", candidateSha: candidate });
  }
  if (candidateParents.length !== 1) fail("Evidence candidate must have a sole parent.");
  const changed = lines(await diff(candidateParents[0], candidate));
  const proofPaths = changed.filter((entry) => new RegExp(
    `^A\\t${CI_PROVENANCE_DIRECTORY}/[a-f0-9]{40}/proof\\.json$`, "u"
  ).test(entry));
  if (proofPaths.length !== 1) fail("Candidate requires exactly one new canonical provenance proof.");
  const proofPath = proofPaths[0].slice(2);
  const implementationSha = proofPath.split("/").at(-2);
  const markdownPath = `${CI_PROVENANCE_DIRECTORY}/${implementationSha}/provenance.md`;
  const record = validateCandidateProof(parseJsonObject(
    (await blob(candidate, proofPath)).toString("utf8"), "Candidate provenance"
  ));
  const implementation = record.implementation;
  if (implementation.commitSha !== implementationSha || implementationSha === candidate) {
    fail("Provenance must name its earlier implementation, without circular identity.");
  }
  const implementationParents = await parents(implementationSha);
  if (implementationParents.length !== 1 || implementationParents[0] !== implementation.baseCommitSha ||
      await tree(implementationSha) !== implementation.treeSha) {
    fail("Implementation base or tree drifted from provenance.");
  }
  if (![implementationSha, implementation.baseCommitSha].includes(candidateParents[0])) {
    fail("Evidence candidate must directly follow its implementation or protected squash base.");
  }
  if (prBase && !controlSha && prBase !== implementation.baseCommitSha) {
    fail("PR merge base differs from the proved implementation base.");
  }
  const implementationChanges = lines(await diff(implementation.baseCommitSha, implementationSha));
  if (implementationChanges.length === 0 || implementationChanges.some((entry) => {
    const selected = entry.slice(2);
    return selected === CI_PROVENANCE_LEDGER ||
      selected.startsWith(`${CI_PROVENANCE_DIRECTORY}/`) ||
      selected.startsWith(`${CI_RELEASE_SUCCESSOR_INPUT_DIRECTORY}/`);
  })) fail("Implementation must be nonempty and separate from preserved proof/control evidence.");
  const expectedDelta = [`A\t${markdownPath}`, `A\t${proofPath}`, `M\t${CI_PROVENANCE_LEDGER}`].sort();
  if (JSON.stringify(lines(await diff(implementationSha, candidate)).sort()) !== JSON.stringify(expectedDelta)) {
    fail("Implementation-to-candidate delta must contain only two evidence files and the ledger append.");
  }
  const [markdown, previousLedger, ledger] = await Promise.all([
    blob(candidate, markdownPath), blob(implementationSha, CI_PROVENANCE_LEDGER), blob(candidate, CI_PROVENANCE_LEDGER)
  ]);
  if (sha256Bytes(markdown) !== record.provenanceSha256 ||
      ![implementationSha, implementation.treeSha, implementation.baseCommitSha].every(
        (identity) => markdown.toString("utf8").includes(identity)
      )) fail("Canonical provenance bytes or implementation identities drifted.");
  const append = ledger.subarray(previousLedger.length);
  if (record.ledger.previousByteCount !== previousLedger.length ||
      sha256Bytes(previousLedger) !== record.ledger.previousSha256 ||
      !ledger.subarray(0, previousLedger.length).equals(previousLedger) || append.length === 0 ||
      sha256Bytes(append) !== record.ledger.appendSha256 ||
      !["provenance.md", "proof.json"].every((name) => append.toString("utf8").includes(
        `(../ci-provenance/${implementationSha}/${name})`
      ))) fail("Build Ledger must preserve its exact prefix and link both new evidence files.");
  return Object.freeze({
    status: "verified", headSha: checkout.head, candidateSha: candidate,
    implementationSha, implementationTreeSha: implementation.treeSha,
    baseSha: implementation.baseCommitSha, controlSha: controlSha ?? null, proofPath
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
  deploymentProfile,
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
    layout: CI_RELEASE_GENERATION_LAYOUT,
    deploymentProfile
  });
  const legalV4Pages = await collectOriginTreeManifest({
    projectRoot: absoluteRoot,
    domain: "ci-legal-v4-pages",
    relativeRoot: "_site"
  });
  const originReleaseInput = createOriginReleaseInput({
    releaseId: initial.head,
    epoch: {
      ...(deploymentProfile === undefined ? {} : deploymentProfileFields({ deploymentProfile })),
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
