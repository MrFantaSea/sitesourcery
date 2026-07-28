import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/*
 * This is intentionally an allowlist, not a recursive copy with exceptions.
 * Adding a source file does not make it public; publishing a new file requires
 * an explicit review of this ledger.
 */
export const publicFileAllowlist = Object.freeze([
  ".nojekyll",
  "404.html",
  "CNAME",
  "about.html",
  "about/index.html",
  "abracadabra/abracadabra-showcase.js",
  "abracadabra/app/abracadabra-app.css",
  "abracadabra/app/abracadabra-app.js",
  "abracadabra/app/abracadabra-compiler.js",
  "abracadabra/app/abracadabra-control.js",
  "abracadabra/app/index.html",
  "abracadabra/how/index.html",
  "abracadabra/index.html",
  "abracadabra/platform/abracadabra-platform.js",
  "abracadabra/site/index.html",
  "abracadabra/site/viewer.css",
  "abracadabra/site/viewer.js",
  "assets/cursor-wand-active.svg",
  "assets/cursor-wand.svg",
  "assets/portfolio-sconesourcery-v3-720.webp",
  "assets/portfolio-sconesourcery-v3.webp",
  "assets/site-sourcery-arcane-atelier-v3.webp",
  "assets/site-sourcery-hive-orchestra-v4.webp",
  "assets/site-sourcery-main-street-v2.webp",
  "assets/site-sourcery-storm-atelier-v4.webp",
  "assets/site-sourcery-two-doors-v3.webp",
  "assets/work-demo-bright-spark-1440.webp",
  "assets/work-demo-bright-spark-720.webp",
  "assets/work-demo-bright-spark.png",
  "assets/work-demo-trattoria-1440.webp",
  "assets/work-demo-trattoria-720.webp",
  "assets/work-demo-trattoria.png",
  "assets/work-scone-current-1440.webp",
  "assets/work-scone-current-720.webp",
  "assets/work-scone-current.png",
  "automation.html",
  "contact.html",
  "contact/index.html",
  "custom/index.html",
  "custom/process/index.html",
  "custom/scope/index.html",
  "faq.html",
  "faq/index.html",
  "hive/hive-planner.js",
  "hive/index.html",
  "how-it-works.html",
  "index.html",
  "legal/index.html",
  "legal/privacy/index.html",
  "legal/website-terms/index.html",
  "og.png",
  "pricing.html",
  "privacy.html",
  "robots.txt",
  "sitemap.xml",
  "solutions/index.html",
  "start/index.html",
  "terms.html",
  "the-difference.html",
  "the-meter.html",
  "the-moat.html",
  "the-responder.html",
  "vnext.css",
  "vnext.js",
  "work/index.html",
  "work/work.css",
]);

/*
 * Retained as an explicit source-boundary contract for the vNext validator.
 * The allowlist above is the stronger, authoritative publication boundary.
 */
export const excludedTopLevel = Object.freeze([
  ".git",
  ".github",
  ".gitignore",
  ".htmlvalidate.json",
  ".nvmrc",
  "_site",
  "data",
  "flyer.html",
  "node_modules",
  "package-lock.json",
  "package.json",
  "print-collateral",
  "QUALITY.md",
  "scripts",
]);

function lexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function assertSortedUniqueAllowlist() {
  const sorted = [...publicFileAllowlist].sort(lexical);
  if (JSON.stringify(publicFileAllowlist) !== JSON.stringify(sorted)) {
    throw new Error("public file allowlist must remain bytewise sorted");
  }
  if (new Set(publicFileAllowlist).size !== publicFileAllowlist.length) {
    throw new Error("public file allowlist must not contain duplicates");
  }
}

function assertPublicRelativePath(file) {
  if (
    typeof file !== "string"
    || file === ""
    || file.startsWith("/")
    || file.includes("\\")
    || path.posix.normalize(file) !== file
    || file.split("/").includes("..")
  ) {
    throw new Error(`invalid public allowlist path: ${JSON.stringify(file)}`);
  }
}

function assertRegularSource(root, file) {
  assertPublicRelativePath(file);
  const segments = file.split("/");
  let cursor = root;
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`allowlisted public source is missing: ${file}`);
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`allowlisted public source traverses a symbolic link: ${file}`);
    }
    const isLast = index === segments.length - 1;
    if (isLast && !stat.isFile()) {
      throw new Error(`allowlisted public source is not a regular file: ${file}`);
    }
    if (!isLast && !stat.isDirectory()) {
      throw new Error(`allowlisted public source parent is not a directory: ${file}`);
    }
  }
}

function resolveBuildPaths(root, output) {
  const absoluteRoot = path.resolve(root);
  const rootStat = lstatSync(absoluteRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`site root must be a real directory: ${absoluteRoot}`);
  }

  const exactSiteOutput = path.join(absoluteRoot, "_site");
  const absoluteOutput = path.resolve(output ?? exactSiteOutput);
  const isExactSiteOutput = absoluteOutput === exactSiteOutput;
  if (!isExactSiteOutput) {
    if (absoluteOutput === absoluteRoot || isInside(absoluteRoot, absoluteOutput)) {
      throw new Error("custom build output must be outside the source root");
    }
    if (existsSync(absoluteOutput)) {
      throw new Error("custom build output must not already exist");
    }
  }
  return { absoluteOutput, absoluteRoot, isExactSiteOutput };
}

function walkArtifact(directory, root = directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    lexical(left.name, right.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isSymbolicLink()) {
      throw new Error(`public artifact contains a symbolic link: ${relative}`);
    }
    if (entry.isDirectory()) {
      files.push(...walkArtifact(absolute, root));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`public artifact contains an unsupported entry: ${relative}`);
    }
  }
  return files;
}

export function buildPagesArtifact({
  root = process.cwd(),
  output,
} = {}) {
  assertSortedUniqueAllowlist();
  const { absoluteOutput, absoluteRoot, isExactSiteOutput } = resolveBuildPaths(root, output);

  /*
   * Validate every source before touching the existing artifact. A missing or
   * aliased source therefore leaves the last local build intact.
   */
  for (const file of publicFileAllowlist) assertRegularSource(absoluteRoot, file);

  if (isExactSiteOutput && existsSync(absoluteOutput)) {
    const outputStat = lstatSync(absoluteOutput);
    if (outputStat.isSymbolicLink()) {
      throw new Error(`refusing to remove symbolic-link build output: ${absoluteOutput}`);
    }
    rmSync(absoluteOutput, { recursive: true, force: true });
  }

  try {
    mkdirSync(absoluteOutput, { recursive: true });
    for (const file of publicFileAllowlist) {
      const destination = path.join(absoluteOutput, ...file.split("/"));
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(path.join(absoluteRoot, ...file.split("/")), destination);
    }
  } catch (error) {
    /*
     * A custom output is guaranteed not to pre-exist, so cleaning it cannot
     * destroy caller data. The default path is the exact _site directory.
     */
    rmSync(absoluteOutput, { recursive: true, force: true });
    throw error;
  }

  return absoluteOutput;
}

export function verifyPagesArtifact({
  root = process.cwd(),
  output = path.join(path.resolve(root), "_site"),
} = {}) {
  assertSortedUniqueAllowlist();
  const absoluteRoot = path.resolve(root);
  const absoluteOutput = path.resolve(output);
  const outputStat = lstatSync(absoluteOutput);
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) {
    throw new Error(`public artifact must be a real directory: ${absoluteOutput}`);
  }

  for (const file of publicFileAllowlist) assertRegularSource(absoluteRoot, file);
  const actual = walkArtifact(absoluteOutput).sort(lexical);
  if (JSON.stringify(actual) !== JSON.stringify(publicFileAllowlist)) {
    const expectedSet = new Set(publicFileAllowlist);
    const actualSet = new Set(actual);
    const missing = publicFileAllowlist.filter((file) => !actualSet.has(file));
    const unexpected = actual.filter((file) => !expectedSet.has(file));
    throw new Error(
      `public artifact ledger mismatch; missing: ${missing.join(", ") || "none"}; `
      + `unexpected: ${unexpected.join(", ") || "none"}`,
    );
  }

  for (const file of publicFileAllowlist) {
    const sourceBytes = readFileSync(path.join(absoluteRoot, ...file.split("/")));
    const artifactBytes = readFileSync(path.join(absoluteOutput, ...file.split("/")));
    if (!sourceBytes.equals(artifactBytes)) {
      throw new Error(`public artifact bytes differ from source: ${file}`);
    }
  }
  return { files: publicFileAllowlist.length, output: absoluteOutput };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 2) {
    const output = buildPagesArtifact();
    console.log(
      `Pages artifact built at ${output} from ${publicFileAllowlist.length} explicitly reviewed public files.`,
    );
  } else if (process.argv.length === 3 && process.argv[2] === "--check") {
    const result = verifyPagesArtifact();
    console.log(
      `Pages artifact verified at ${result.output}: ${result.files} allowlisted files, exact source bytes.`,
    );
  } else {
    console.error("Usage: node scripts/build-pages.mjs [--check]");
    process.exitCode = 2;
  }
}
