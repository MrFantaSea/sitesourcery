import { execFile as execFileCallback } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const GIT_SHA = /^[a-f0-9]{40}$/u;
const SAFE_LABEL = /^[a-z0-9-]{1,80}$/u;

export async function materializeHistoricalCandidate({
  projectRoot,
  commitSha,
  treeSha,
  label
}) {
  if (
    !path.isAbsolute(projectRoot) ||
    !GIT_SHA.test(commitSha ?? "") ||
    !GIT_SHA.test(treeSha ?? "") ||
    !SAFE_LABEL.test(label ?? "")
  ) {
    throw new Error("Historical candidate fixture identity is invalid.");
  }
  const canonicalTemporaryRoot = await realpath(os.tmpdir());
  const temporaryRoot = await mkdtemp(
    path.join(canonicalTemporaryRoot, `ss-${label}-`)
  );
  const archivePath = path.join(temporaryRoot, "candidate.tar");
  const candidateRoot = path.join(temporaryRoot, "candidate");
  try {
    const observed = await execFile(
      "git",
      [
        "--no-replace-objects",
        "-c",
        "core.fsmonitor=false",
        "-C",
        projectRoot,
        "rev-parse",
        `${commitSha}^{tree}`
      ],
      { timeout: 60_000 }
    );
    if (observed.stdout.trim() !== treeSha) {
      throw new Error("Historical candidate fixture tree drifted.");
    }
    await mkdir(candidateRoot, { mode: 0o700 });
    await execFile(
      "git",
      [
        "--no-replace-objects",
        "-c",
        "core.fsmonitor=false",
        "-C",
        projectRoot,
        "archive",
        "--format=tar",
        `--output=${archivePath}`,
        commitSha
      ],
      { timeout: 60_000 }
    );
    await execFile(
      "tar",
      ["-xf", archivePath, "-C", candidateRoot],
      { timeout: 60_000 }
    );
    await rm(archivePath);
    return Object.freeze({
      candidateRoot,
      async cleanup() {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    });
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}
