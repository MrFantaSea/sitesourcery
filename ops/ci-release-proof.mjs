#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { auditArtifactFromSitemap } from
  "../scripts/audit-artifact-from-sitemap.mjs";
import {
  canonicalJson,
  sha256Bytes,
  writeImmutableEvidence
} from "./immutable-evidence.mjs";
import {
  CI_RELEASE_BROWSER_VERSION,
  CI_RELEASE_BROWSER_WIDTHS,
  ciReleaseContextFromEnvironment,
  ciReleaseDatabaseName,
  ciReleaseDatabaseNameSha256,
  createCiReleaseStepReceipt
} from "./ci-release-proof-runtime.mjs";
import {
  assertCiReleaseSafeEnvironment,
  createCiReleaseSuccessorInputFromRepository,
  readCiReleaseSuccessorInput,
  requireCiReleaseContainedDirectory,
  requireCiReleaseRealDirectory,
  verifyCiReleaseSuccessorControl,
  verifyCiReleaseGeneratedOutput,
  verifyCiReleaseGenerationState,
  verifyCiLegalV4Artifact,
  verifyCiReleaseCandidate,
  verifyCiReleaseFinal
} from "./ci-release-proof-repository.mjs";

const executeFile = promisify(execFile);
const OPENAT_WRITER_SOURCE = String.raw`
#define _DARWIN_C_SOURCE
#define _GNU_SOURCE
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static int same_inode(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino;
}

static int open_relative_directory(int root_fd, const char *relative) {
  char copy[PATH_MAX];
  char *save = NULL;
  char *component = NULL;
  int current = -1;
  if (strlen(relative) == 0 || strlen(relative) >= sizeof(copy)) return -1;
  memcpy(copy, relative, strlen(relative) + 1);
  current = dup(root_fd);
  if (current < 0) return -1;
  component = strtok_r(copy, "/", &save);
  while (component != NULL) {
    int next = -1;
    if (
      component[0] == '\0' ||
      strcmp(component, ".") == 0 ||
      strcmp(component, "..") == 0
    ) {
      close(current);
      return -1;
    }
    next = openat(current, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    close(current);
    if (next < 0) return -1;
    current = next;
    component = strtok_r(NULL, "/", &save);
  }
  return current;
}

static int wait_for_signal(const char *ready, const char *proceed, const char *abort_path) {
  int marker = open(ready, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  struct timespec delay = { .tv_sec = 0, .tv_nsec = 10000000 };
  int attempts = 0;
  if (marker < 0) return -1;
  close(marker);
  for (attempts = 0; attempts < 1000; attempts += 1) {
    if (access(proceed, F_OK) == 0) return 0;
    if (access(abort_path, F_OK) == 0) return -1;
    if (errno != ENOENT) return -1;
    nanosleep(&delay, NULL);
  }
  return -1;
}

int main(int argc, char **argv) {
  const char *root = NULL;
  const char *relative_directory = NULL;
  const char *filename = NULL;
  int root_fd = -1;
  int directory_fd = -1;
  int output_fd = -1;
  int check_root_fd = -1;
  int check_directory_fd = -1;
  int created = 0;
  int result = 1;
  struct stat root_before;
  struct stat directory_before;
  struct stat output_before;
  struct stat root_after;
  struct stat directory_after;
  struct stat output_after;
  char buffer[65536];
  ssize_t count = 0;
  unsigned long long total = 0;

  if (argc != 7) return 2;
  root = argv[1];
  relative_directory = argv[2];
  filename = argv[3];
  if (
    filename[0] == '\0' ||
    strchr(filename, '/') != NULL ||
    strcmp(filename, ".") == 0 ||
    strcmp(filename, "..") == 0
  ) return 3;

  root_fd = open(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (root_fd < 0 || fstat(root_fd, &root_before) != 0) goto cleanup;
  directory_fd = open_relative_directory(root_fd, relative_directory);
  if (directory_fd < 0 || fstat(directory_fd, &directory_before) != 0) goto cleanup;
  output_fd = openat(
    directory_fd,
    filename,
    O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,
    0644
  );
  if (output_fd < 0) goto cleanup;
  created = 1;
  while ((count = read(STDIN_FILENO, buffer, sizeof(buffer))) > 0) {
    ssize_t offset = 0;
    total += (unsigned long long)count;
    if (total > 16777216ULL) goto cleanup;
    while (offset < count) {
      ssize_t written = write(output_fd, buffer + offset, (size_t)(count - offset));
      if (written <= 0) goto cleanup;
      offset += written;
    }
  }
  if (
    count < 0 ||
    fchmod(output_fd, 0644) != 0 ||
    fsync(output_fd) != 0 ||
    fstat(output_fd, &output_before) != 0 ||
    (unsigned long long)output_before.st_size != total
  ) goto cleanup;
  if (wait_for_signal(argv[4], argv[5], argv[6]) != 0) goto cleanup;

  check_root_fd = open(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (check_root_fd < 0 || fstat(check_root_fd, &root_after) != 0) goto cleanup;
  check_directory_fd = open_relative_directory(check_root_fd, relative_directory);
  if (
    check_directory_fd < 0 ||
    fstat(check_directory_fd, &directory_after) != 0 ||
    fstatat(directory_fd, filename, &output_after, AT_SYMLINK_NOFOLLOW) != 0 ||
    !same_inode(&root_before, &root_after) ||
    !same_inode(&directory_before, &directory_after) ||
    !same_inode(&output_before, &output_after) ||
    !S_ISREG(output_after.st_mode) ||
    output_after.st_nlink != 1 ||
    fsync(directory_fd) != 0
  ) goto cleanup;
  result = 0;

cleanup:
  if (result != 0 && created != 0) {
    unlinkat(directory_fd, filename, 0);
    fsync(directory_fd);
  }
  if (check_directory_fd >= 0) close(check_directory_fd);
  if (check_root_fd >= 0) close(check_root_fd);
  if (output_fd >= 0) close(output_fd);
  if (directory_fd >= 0) close(directory_fd);
  if (root_fd >= 0) close(root_fd);
  return result;
}
`;

function fail(message) {
  throw new Error(message);
}

function startAnchoredWriter({
  binary,
  arguments_,
  bytes
}) {
  const child = spawn(binary, arguments_, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.stdin.end(bytes);
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).then((exitCode) => {
    if (exitCode !== 0) {
      fail(
        `CI anchored successor write failed cleanly (${exitCode}): ${Buffer.concat(stderr).toString("utf8").trim()}`
      );
    }
    if (Buffer.concat(stdout).length !== 0) {
      fail("CI anchored successor writer emitted unexpected output.");
    }
  });
  return { completion };
}

export async function writeCiReleaseSuccessorInputAnchored({
  projectRoot,
  relativePath,
  successorInput,
  postWriteCheck,
  testControl
}) {
  const absoluteRoot = await requireCiReleaseRealDirectory(
    projectRoot,
    "CI anchored candidate root"
  );
  const relativeDirectory = path.posix.dirname(relativePath);
  const filename = path.posix.basename(relativePath);
  const outputRoot = await requireCiReleaseContainedDirectory({
    root: absoluteRoot,
    selected: path.join(absoluteRoot, ...relativeDirectory.split("/")),
    label: "CI anchored output root"
  });
  if ((await readdir(outputRoot)).length !== 0) {
    fail("CI anchored output root must be empty.");
  }
  const bytes = Buffer.from(`${canonicalJson(successorInput)}\n`, "utf8");
  const scratch = await mkdtemp(path.join(os.tmpdir(), "ss-ci-openat-writer-"));
  try {
    const source = path.join(scratch, "writer.c");
    const binary = path.join(scratch, "writer");
    await writeFile(source, OPENAT_WRITER_SOURCE, { flag: "wx", mode: 0o600 });
    await executeFile(
      "/usr/bin/cc",
      ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-o", binary, source],
      {
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
          TMPDIR: scratch
        }
      }
    );
    const readyPath = testControl?.readyPath ?? path.join(scratch, "ready");
    const continuePath = testControl?.continuePath ?? path.join(scratch, "continue");
    const abortPath = testControl?.abortPath ?? path.join(scratch, "abort");
    const writer = startAnchoredWriter({
      binary,
      arguments_: [
        absoluteRoot,
        relativeDirectory,
        filename,
        readyPath,
        continuePath,
        abortPath
      ],
      bytes
    });
    if (postWriteCheck) {
      await waitForRegularFile(readyPath, "CI anchored writer readiness");
      try {
        await postWriteCheck();
        await writeFile(continuePath, "continue\n", { flag: "wx", mode: 0o600 });
      } catch (error) {
        await writeFile(abortPath, "abort\n", { flag: "wx", mode: 0o600 });
        await writer.completion.catch(() => {});
        throw error;
      }
    }
    await writer.completion;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return Object.freeze({
    path: relativePath,
    sha256: sha256Bytes(bytes),
    bytes: bytes.length
  });
}

function observedAt(environment) {
  return environment.CI_RELEASE_OBSERVED_AT ?? new Date().toISOString();
}

async function requireDirectory(selected, label) {
  return requireCiReleaseRealDirectory(selected, label);
}

async function waitForRegularFile(selected, label) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    try {
      await regularMarker(selected, label);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  fail(`${label} timed out.`);
}

async function regularMarker(selected, label) {
  const metadata = await lstat(selected);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`${label} must be a regular non-symlink file.`);
  }
}

async function requireEmptyOutputDirectory({ projectRoot, selected }) {
  try {
    const metadata = await lstat(selected);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      fail("CI successor output root must be a real non-symlink directory.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await requireCiReleaseContainedDirectory({
      root: projectRoot,
      selected: path.dirname(selected),
      label: "CI successor output parent"
    });
    await mkdir(selected);
  }
  const outputRoot = await requireCiReleaseContainedDirectory({
    root: projectRoot,
    selected,
    label: "CI successor output root"
  });
  if ((await readdir(outputRoot)).length !== 0) {
    fail("CI successor output root must be empty before generation.");
  }
  return outputRoot;
}

function parseArgs(arguments_) {
  const [command, ...rest] = arguments_;
  if (!command || rest.length % 2 !== 0) {
    fail("CI release proof requires one command and exact flag/value pairs.");
  }
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    if (!/^--[a-z][a-z-]*$/u.test(flag) || values.has(flag)) {
      fail("CI release proof contains an invalid or duplicate flag.");
    }
    values.set(flag, rest[index + 1]);
  }
  return { command, values };
}

function exactFlags(values, flags) {
  if (
    JSON.stringify([...values.keys()].sort()) !==
    JSON.stringify([...flags].sort())
  ) {
    fail("CI release proof command contains missing or unexpected flags.");
  }
}

async function loadContext(environment) {
  const successorInput = await readCiReleaseSuccessorInput({
    inputPath: environment.CI_RELEASE_SUCCESSOR_INPUT_PATH,
    expectedSha256: environment.CI_RELEASE_SUCCESSOR_INPUT_FILE_SHA256
  });
  const context = ciReleaseContextFromEnvironment(environment);
  if (
    context.candidateSha !==
      successorInput.originReleaseInput.epoch.source.commitSha ||
    context.successorInputDigest !== successorInput.digest
  ) {
    fail("CI release context drifted from the verified successor input.");
  }
  return { successorInput, context };
}

async function writeStep({
  step,
  details,
  context,
  environment
}) {
  const evidenceRoot = await requireDirectory(
    environment.CI_RELEASE_EVIDENCE_ROOT,
    "CI release evidence root"
  );
  const receipt = createCiReleaseStepReceipt({
    step,
    context,
    observedAt: observedAt(environment),
    details
  });
  await writeImmutableEvidence(
    path.join(evidenceRoot, `${step}.json`),
    receipt
  );
  return receipt;
}

function localAdminUrl(value) {
  let selected;
  try {
    selected = new URL(value);
  } catch {
    fail("CI PostgreSQL admin URL is invalid.");
  }
  if (
    !["postgres:", "postgresql:"].includes(selected.protocol) ||
    !["127.0.0.1", "localhost"].includes(selected.hostname) ||
    selected.password ||
    selected.search ||
    selected.hash ||
    decodeURIComponent(selected.pathname) !== "/postgres"
  ) {
    fail("CI PostgreSQL admin URL must be credential-free local PostgreSQL /postgres.");
  }
  return selected.href;
}

export async function proveDatabaseAbsent({
  adminUrl,
  databaseName,
  PoolImpl
}) {
  if (!PoolImpl) {
    const pg = await import("pg");
    PoolImpl = pg.default.Pool;
  }
  const pool = new PoolImpl({
    connectionString: localAdminUrl(adminUrl),
    max: 1
  });
  try {
    const result = await pool.query(
      `select not exists (
         select 1 from pg_database where datname = $1
       ) as database_absent`,
      [databaseName]
    );
    if (result.rows[0]?.database_absent !== true) {
      fail("CI disposable PostgreSQL database is not absent after cleanup.");
    }
    return true;
  } finally {
    await pool.end();
  }
}

export async function runCiReleaseProofCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  writeOutput = (value) => process.stdout.write(value)
} = {}) {
  assertCiReleaseSafeEnvironment(environment);
  const { command, values } = parseArgs(arguments_);

  if (command === "generate") {
    exactFlags(values, [
      "--root",
      "--epoch-id",
      "--rollback-commit",
      "--rollback-tree",
      "--rollback-artifact-root"
    ]);
    const projectRoot = await requireDirectory(
      values.get("--root"),
      "CI successor candidate root"
    );
    const generated = await createCiReleaseSuccessorInputFromRepository({
      projectRoot,
      epochId: values.get("--epoch-id"),
      rollback: {
        predecessorCommitSha: values.get("--rollback-commit"),
        predecessorTreeSha: values.get("--rollback-tree"),
        artifactRoot: values.get("--rollback-artifact-root")
      }
    });
    const outputPath = path.join(
      projectRoot,
      ...generated.relativePath.split("/")
    );
    const outputRoot = await requireEmptyOutputDirectory({
      projectRoot,
      selected: path.dirname(outputPath)
    });
    await verifyCiReleaseGenerationState({
      projectRoot,
      expectedHead: generated.candidateSha,
      expectedTree: generated.candidateTreeSha
    });
    const written = await writeCiReleaseSuccessorInputAnchored({
      projectRoot,
      relativePath: generated.relativePath,
      successorInput: generated.successorInput,
      postWriteCheck: () => verifyCiReleaseGeneratedOutput({
        projectRoot,
        candidateSha: generated.candidateSha,
        candidateTreeSha: generated.candidateTreeSha,
        relativePath: generated.relativePath
      })
    });
    if (
      JSON.stringify(await readdir(outputRoot)) !==
        JSON.stringify([path.basename(outputPath)])
    ) {
      fail("CI successor generation emitted an unexpected output inventory.");
    }
    writeOutput(`${JSON.stringify({
      path: generated.relativePath,
      sha256: written.sha256,
      digest: generated.successorInput.digest,
      rollbackArtifactManifestSha256:
        generated.rollbackArtifactManifestSha256
    })}\n`);
    return generated.successorInput;
  }

  if (command === "input") {
    exactFlags(values, [
      "--root",
      "--control-root",
      "--input",
      "--input-sha",
      "--candidate-sha",
      "--workflow-sha"
    ]);
    const control = await verifyCiReleaseSuccessorControl({
      controlRoot: values.get("--control-root"),
      inputPath: values.get("--input"),
      expectedInputSha256: values.get("--input-sha"),
      candidateSha: values.get("--candidate-sha"),
      workflowSha: values.get("--workflow-sha")
    });
    await verifyCiReleaseCandidate({
      projectRoot: values.get("--root"),
      successorInput: control.successorInput
    });
    writeOutput(`${control.successorInput.digest}\n`);
    return control.successorInput;
  }

  const { successorInput, context } = await loadContext(environment);

  if (command === "record") {
    exactFlags(values, ["--step"]);
    const step = values.get("--step");
    if (!new Set(["full-npm", "ops"]).has(step)) {
      fail("CI record command may record only full-npm or ops.");
    }
    return writeStep({
      step,
      details: {
        command: step === "full-npm" ? "npm test" : "npm run check:ops"
      },
      context,
      environment
    });
  }

  if (command === "legal-v4") {
    exactFlags(values, ["--root", "--artifact-root"]);
    const manifest = await verifyCiLegalV4Artifact({
      projectRoot: values.get("--root"),
      artifactRoot: values.get("--artifact-root"),
      successorInput
    });
    return writeStep({
      step: "legal-v4",
      details: {
        fileCount: manifest.fileCount,
        manifestSha256: manifest.sha256
      },
      context,
      environment
    });
  }

  if (command === "browser") {
    exactFlags(values, ["--root", "--artifact-root"]);
    const manifest = await verifyCiLegalV4Artifact({
      projectRoot: values.get("--root"),
      artifactRoot: values.get("--artifact-root"),
      successorInput
    });
    const result = await auditArtifactFromSitemap(
      values.get("--artifact-root")
    );
    return writeStep({
      step: "browser",
      details: {
        routeCount: result.routes.length,
        viewCount: result.viewCount,
        widths: [...CI_RELEASE_BROWSER_WIDTHS],
        browserVersion: CI_RELEASE_BROWSER_VERSION,
        artifactManifestSha256: manifest.sha256
      },
      context,
      environment
    });
  }

  if (command === "postgres") {
    exactFlags(values, []);
    const expectedDatabase = ciReleaseDatabaseName(context);
    const { runMigrationVerification } = await import(
      "../server/data-plane/tests/verify-empty-postgres-migrations.mjs"
    );
    const proof = await runMigrationVerification({
      environment,
      expectedMigrationNames:
        successorInput.migrationInventory.files.map((entry) => entry.name)
    });
    if (
      proof.ownership !== "caller" ||
      proof.databaseName !== expectedDatabase ||
      proof.postgresMajor !== 16 ||
      proof.migrationsApplied !== successorInput.migrationInventory.count
    ) {
      fail("CI PostgreSQL journey proof drifted from exact successor authority.");
    }
    return writeStep({
      step: "postgres",
      details: {
        databaseNameSha256: ciReleaseDatabaseNameSha256(expectedDatabase),
        postgresMajor: proof.postgresMajor,
        migrationCount: proof.migrationsApplied,
        migrationManifestSha256:
          successorInput.migrationInventory.manifestSha256
      },
      context,
      environment
    });
  }

  if (command === "absence") {
    exactFlags(values, []);
    const databaseName = ciReleaseDatabaseName(context);
    await proveDatabaseAbsent({
      adminUrl: environment.CI_RELEASE_PG_ADMIN_URL,
      databaseName
    });
    return writeStep({
      step: "cleanup",
      details: {
        databaseNameSha256: ciReleaseDatabaseNameSha256(databaseName),
        databaseAbsent: true
      },
      context,
      environment
    });
  }

  if (command === "final") {
    exactFlags(values, ["--root", "--control-root"]);
    const control = await verifyCiReleaseSuccessorControl({
      controlRoot: values.get("--control-root"),
      inputPath: environment.CI_RELEASE_SUCCESSOR_INPUT_PATH,
      expectedInputSha256:
        environment.CI_RELEASE_SUCCESSOR_INPUT_FILE_SHA256,
      candidateSha: environment.CI_RELEASE_CANDIDATE_SHA,
      workflowSha: environment.CI_RELEASE_WORKFLOW_SHA
    });
    if (control.successorInput.digest !== successorInput.digest) {
      fail("CI final proof successor control drifted after input verification.");
    }
    const evidenceRoot = await requireDirectory(
      environment.CI_RELEASE_EVIDENCE_ROOT,
      "CI release evidence root"
    );
    const receipt = await verifyCiReleaseFinal({
      projectRoot: values.get("--root"),
      successorInput,
      context,
      evidenceRoot
    });
    await writeImmutableEvidence(
      path.join(evidenceRoot, "final.json"),
      receipt
    );
    writeOutput(`${JSON.stringify(receipt)}\n`);
    return receipt;
  }

  fail("CI release proof command is invalid.");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCiReleaseProofCli().catch((error) => {
    process.stderr.write(`ci-release-proof: ${error.message}\n`);
    process.exitCode = 1;
  });
}
