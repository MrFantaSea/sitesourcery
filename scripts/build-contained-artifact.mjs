#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertContainmentTarget } from "./containment-contract.mjs";

const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const PUBLIC_EXTENSION = new Set([
  ".css",
  ".html",
  ".ico",
  ".js",
  ".png",
  ".svg",
  ".txt",
  ".webp",
  ".xml",
]);
const PUBLIC_EXACT = new Set([".nojekyll", "CNAME", "robots.txt"]);
const PRIVATE_TOP_LEVEL = new Set([
  ".git",
  ".github",
  ".gitignore",
  ".htmlvalidate.json",
  ".nvmrc",
  "_site",
  "data",
  "node_modules",
  "package-lock.json",
  "package.json",
  "print-collateral",
  "scripts",
  "QUALITY.md",
]);
const PRIVATE_EXACT = new Set(["flyer.html"]);

function fail(message) {
  throw new Error(message);
}

function git(repositoryRoot, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: options.encoding,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : result.stderr;
    fail(`git ${args[0]} failed: ${(detail || "unknown error").trim()}`);
  }
  return result.stdout;
}

function assertPublicPath(file) {
  if (
    !file
    || file.startsWith("/")
    || file.includes("\\")
    || path.posix.normalize(file) !== file
    || file.split("/").includes("..")
  ) {
    fail(`invalid tracked path: ${JSON.stringify(file)}`);
  }
}

function isPublicFile(file) {
  assertPublicPath(file);
  const topLevel = file.split("/")[0];
  if (PRIVATE_TOP_LEVEL.has(topLevel) || PRIVATE_EXACT.has(file)) return false;
  return PUBLIC_EXACT.has(file) || PUBLIC_EXTENSION.has(path.posix.extname(file).toLowerCase());
}

function trackedEntries(repositoryRoot, productionSha) {
  const output = git(repositoryRoot, ["ls-tree", "-r", "-z", productionSha]);
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(record);
      if (!match) fail(`production tree contains a non-regular tracked entry: ${record}`);
      return { blob: match[2], file: match[3], mode: match[1] };
    });
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

export function buildContainedArtifact({
  output,
  productionSha,
  removePath,
  repositoryRoot,
} = {}) {
  const absoluteRepositoryRoot = path.resolve(repositoryRoot ?? "");
  const absoluteOutput = path.resolve(output ?? "");
  if (!repositoryRoot || !output) fail("repository root and output are required");
  if (!FULL_COMMIT.test(productionSha ?? "")) fail("production SHA must be one full lowercase commit");
  if (removePath !== undefined) assertContainmentTarget(productionSha, removePath);
  const repositoryStat = lstatSync(absoluteRepositoryRoot);
  if (!repositoryStat.isDirectory() || repositoryStat.isSymbolicLink()) {
    fail("repository root must be a real directory");
  }
  const exactCommit = git(
    absoluteRepositoryRoot,
    ["rev-parse", "--verify", `${productionSha}^{commit}`],
    { encoding: "utf8" },
  ).trim();
  if (exactCommit !== productionSha) fail("production SHA did not resolve exactly");
  if (
    absoluteOutput === absoluteRepositoryRoot
    || !isInside(absoluteRepositoryRoot, absoluteOutput)
    || absoluteOutput !== path.join(absoluteRepositoryRoot, "_site")
  ) {
    fail("containment output must be the target checkout's exact _site directory");
  }
  if (existsSync(absoluteOutput)) fail("containment artifact must be built exactly once");

  const entries = trackedEntries(absoluteRepositoryRoot, productionSha);
  const publicEntries = entries.filter(({ file }) => isPublicFile(file));
  if (!publicEntries.some(({ file }) => file === "index.html")) fail("production tree has no public index");
  if (!publicEntries.some(({ file }) => file === "sitemap.xml")) fail("production tree has no public sitemap");

  let removedEntries = [];
  if (removePath !== undefined) {
    removedEntries = publicEntries.filter(({ file }) => file === removePath);
    if (!removedEntries.length) {
      fail(`authorized containment route is not public in ${productionSha}: ${removePath}`);
    }
  }
  const artifactEntries = publicEntries
    .filter(({ file }) => !removedEntries.some((removed) => removed.file === file))
    .sort((left, right) => left.file.localeCompare(right.file, "en"));

  try {
    mkdirSync(absoluteOutput, { recursive: false });
    for (const entry of artifactEntries) {
      const destination = path.join(absoluteOutput, ...entry.file.split("/"));
      mkdirSync(path.dirname(destination), { recursive: true });
      const bytes = git(absoluteRepositoryRoot, ["cat-file", "blob", entry.blob]);
      writeFileSync(destination, bytes, { mode: entry.mode === "100755" ? 0o755 : 0o644 });
    }
  } catch (error) {
    rmSync(absoluteOutput, { recursive: true, force: true });
    throw error;
  }

  return Object.freeze({
    files: artifactEntries.map(({ file }) => file),
    output: absoluteOutput,
    removed: removedEntries.map(({ file }) => file).sort(),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [repositoryRoot, productionSha, requestedPath, output] = process.argv.slice(2);
    const removePath = requestedPath === "--baseline" ? undefined : requestedPath;
    const result = buildContainedArtifact({
      output,
      productionSha,
      removePath,
      repositoryRoot,
    });
    console.log(
      removePath === undefined
        ? `Built exact baseline public projection from ${productionSha}: ${result.files.length} files.`
        : `Built exact containment artifact from ${productionSha}: `
          + `${result.files.length} public files; removed exact route ${removePath}.`,
    );
  } catch (error) {
    console.error(`build-contained-artifact: ${error.message}`);
    process.exitCode = 1;
  }
}
