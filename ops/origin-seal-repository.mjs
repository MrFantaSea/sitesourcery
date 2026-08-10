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
  SHAPE_EPOCH_BINDING
} from "./release-epoch.mjs";
import {
  ORIGIN_UNION_BASE_COMMIT,
  createOriginSeal,
  originFileManifestSha256,
  validateOriginReleaseInput
} from "./origin-seal-runtime.mjs";

const executeFile = promisify(execFile);
const MAXIMUM_FILES = 100_000;
const MAXIMUM_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;

export const ORIGIN_UNIT_PATHS = Object.freeze([
  "ops/production-rehearsal/sitesourcery-cloudflared.user.service",
  "ops/production-rehearsal/sitesourcery-origin-cloudflare.user.service",
  "ops/sitesourcery-hosted.service.held"
]);

export const ORIGIN_ENVIRONMENT_SCHEMA_PATHS = Object.freeze([
  "ops/caddy.env.example",
  "ops/hosted.env.example"
]);

export const ORIGIN_INGRESS_PATHS = Object.freeze([
  "ops/Caddyfile.cloudflare-tunnel.candidate.held",
  "ops/cloudflared-sitesourcery-production-dell.yml",
  "ops/production-rehearsal/sitesourcery-cloudflared.user.service",
  "ops/production-rehearsal/sitesourcery-origin-cloudflare.user.service"
]);

function fail(message) {
  throw new Error(message);
}

function inside(projectRoot, relativePath, label) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) {
    fail(`${label} must be repository-relative.`);
  }
  const root = path.resolve(projectRoot);
  const selected = path.resolve(root, relativePath);
  const relation = path.relative(root, selected);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  ) {
    fail(`${label} must remain below the repository root.`);
  }
  return selected;
}

async function regularFile(projectRoot, relativePath, label) {
  const selected = inside(projectRoot, relativePath, label);
  const metadata = await lstat(selected);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`${label} must be a regular non-symlink file.`);
  }
  return { selected, metadata };
}

export async function collectOriginPathManifest({
  projectRoot,
  domain,
  relativePaths
}) {
  if (
    typeof domain !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{2,127}$/u.test(domain) ||
    !Array.isArray(relativePaths) ||
    relativePaths.length < 1 ||
    relativePaths.length > MAXIMUM_FILES
  ) {
    fail("Origin file-manifest request is invalid.");
  }
  const unique = [...new Set(relativePaths)].sort((left, right) =>
    left.localeCompare(right)
  );
  if (unique.length !== relativePaths.length) {
    fail("Origin file-manifest paths must be unique.");
  }
  const files = [];
  let byteCount = 0;
  for (const relativePath of unique) {
    const { selected, metadata } = await regularFile(
      projectRoot,
      relativePath,
      `Origin ${domain} file`
    );
    byteCount += metadata.size;
    if (byteCount > MAXIMUM_TOTAL_BYTES) {
      fail("Origin file manifest exceeded its reviewed byte bound.");
    }
    files.push({
      path: relativePath.split(path.sep).join("/"),
      byteCount: metadata.size,
      sha256: sha256Bytes(await readFile(selected))
    });
  }
  return Object.freeze({
    domain,
    fileCount: files.length,
    byteCount,
    files: Object.freeze(files.map((entry) => Object.freeze(entry))),
    sha256: originFileManifestSha256({ domain, files })
  });
}

async function treeFiles(projectRoot, relativeRoot) {
  const absoluteRoot = inside(projectRoot, relativeRoot, "Origin tree root");
  const rootMetadata = await lstat(absoluteRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    fail("Origin tree root must be a real directory.");
  }
  const pending = [relativeRoot];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(
      inside(projectRoot, current, "Origin tree directory"),
      { withFileTypes: true }
    );
    entries.sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(
        current.split(path.sep).join("/"),
        entry.name
      );
      if (entry.isSymbolicLink()) {
        fail("Origin tree must not contain symbolic links.");
      }
      if (entry.isDirectory()) pending.push(relativePath);
      else if (entry.isFile()) files.push(relativePath);
      else fail("Origin tree contains an unsupported filesystem entry.");
      if (files.length + pending.length > MAXIMUM_FILES) {
        fail("Origin tree exceeded its reviewed file bound.");
      }
    }
  }
  files.sort((left, right) => left.localeCompare(right));
  if (files.length === 0) fail("Origin tree must contain at least one file.");
  return files;
}

export async function collectOriginTreeManifest({
  projectRoot,
  domain,
  relativeRoot
}) {
  return collectOriginPathManifest({
    projectRoot,
    domain,
    relativePaths: await treeFiles(projectRoot, relativeRoot)
  });
}

async function collectMigrations(projectRoot, migrationRoot) {
  const entries = await readdir(
    inside(projectRoot, migrationRoot, "Origin migration root"),
    { withFileTypes: true }
  );
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (
    names.length < 1 ||
    entries.some((entry) => entry.isSymbolicLink()) ||
    names.some((name) => !/^[0-9]{12}_[a-z0-9_]+\.sql$/u.test(name))
  ) {
    fail("Origin migration directory is invalid.");
  }
  const manifest = await collectOriginPathManifest({
    projectRoot,
    domain: "origin-migrations",
    relativePaths: names.map((name) => path.posix.join(migrationRoot, name))
  });
  return Object.freeze({
    ...manifest,
    root: migrationRoot,
    count: names.length,
    latest: names.at(-1)
  });
}

function uniqueEntry(entries, field, expected, label) {
  const matches = entries.filter((entry) => entry?.[field] === expected);
  if (matches.length !== 1) fail(`${label} must be unique.`);
  return matches[0];
}

async function collectLegal(projectRoot, constantsPath) {
  const { selected } = await regularFile(
    projectRoot,
    constantsPath,
    "Origin legal constants"
  );
  const constants = parseJsonObject(
    await readFile(selected, "utf8"),
    "Origin legal constants"
  );
  if (
    constants.published !== false ||
    constants.integrationRequired !== true ||
    !Array.isArray(constants.documents) ||
    !Array.isArray(constants.artifacts)
  ) {
    fail("Origin legal authority must remain held and complete.");
  }
  const privacy = uniqueEntry(
    constants.documents,
    "kind",
    "privacy",
    "Origin privacy authority"
  );
  const website = uniqueEntry(
    constants.documents,
    "kind",
    "website",
    "Origin website terms authority"
  );
  const privacyArtifact = uniqueEntry(
    constants.artifacts,
    "role",
    "privacy-versioned",
    "Origin privacy artifact"
  );
  const termsArtifact = uniqueEntry(
    constants.artifacts,
    "role",
    "website-terms-versioned",
    "Origin website terms artifact"
  );
  const releaseRoot = path.posix.dirname(constantsPath);
  const artifactPaths = constants.artifacts.map((entry) => {
    if (
      typeof entry?.file !== "string" ||
      typeof entry?.sha256 !== "string" ||
      !Number.isSafeInteger(entry?.byteCount) ||
      entry.byteCount < 1
    ) {
      fail("Origin legal artifact declaration is invalid.");
    }
    return path.posix.join(releaseRoot, entry.file);
  });
  const manifest = await collectOriginPathManifest({
    projectRoot,
    domain: "origin-legal",
    relativePaths: [constantsPath, ...artifactPaths]
  });
  for (const entry of constants.artifacts) {
    const file = manifest.files.find(
      (candidate) => candidate.path === path.posix.join(releaseRoot, entry.file)
    );
    if (!file || file.sha256 !== entry.sha256 || file.byteCount !== entry.byteCount) {
      fail("Origin legal artifact bytes drifted from their constants.");
    }
  }
  if (
    privacy.contentDigest !== privacyArtifact.sha256 ||
    website.contentDigest !== termsArtifact.sha256
  ) {
    fail("Origin legal document and artifact digests disagree.");
  }
  return Object.freeze({
    ...manifest,
    constantsPath,
    authorityDigest: constants.authorityDigest,
    privacyVersion: privacy.version,
    privacySha256: privacyArtifact.sha256,
    privacyByteCount: privacyArtifact.byteCount,
    websiteTermsVersion: website.version,
    websiteTermsSha256: termsArtifact.sha256,
    websiteTermsByteCount: termsArtifact.byteCount
  });
}

async function verifyIngressAndHolds(projectRoot) {
  const read = async (relativePath) =>
    readFile(inside(projectRoot, relativePath, "Origin authority file"), "utf8");
  const [
    caddy,
    tunnelConfiguration,
    originUnit,
    tunnelUnit,
    hostedEnvironment,
    releaseControlSource,
    commercialControlSource
  ] = await Promise.all([
    read("ops/Caddyfile.cloudflare-tunnel.candidate.held"),
    read("ops/cloudflared-sitesourcery-production-dell.yml"),
    read("ops/production-rehearsal/sitesourcery-origin-cloudflare.user.service"),
    read("ops/production-rehearsal/sitesourcery-cloudflared.user.service"),
    read("ops/hosted.env.example"),
    read("data/release-control.json"),
    read("data/abracadabra-commercial-control.json")
  ]);
  const requiredCaddy = [
    ":8081 {",
    "bind 127.0.0.1",
    "reverse_proxy 127.0.0.1:8788",
    "root * /opt/sitesourcery/current/_hosted",
    "@wrong_host not host sitesourcery.com www.sitesourcery.com",
    "request_body {",
    "max_size 1MB",
    "Cache-Control \"no-store\""
  ];
  if (
    requiredCaddy.some((token) => !caddy.includes(token)) ||
    /(^|\s):(?:80|443)\b/u.test(caddy) ||
    /\btls\s*\{/u.test(caddy)
  ) {
    fail("Origin Caddy ingress is not exactly loopback-only and bounded.");
  }
  for (const token of [
    "service: http://127.0.0.1:8081",
    "service: http_status:404"
  ]) {
    if (!tunnelConfiguration.includes(token)) {
      fail("Origin tunnel ingress is incomplete.");
    }
  }
  if (
    !originUnit.includes("http://127.0.0.1:8788/api/v1/ready") ||
    !originUnit.includes("CLOUDFLARE_TUNNEL_APPROVED") ||
    !tunnelUnit.includes("http://127.0.0.1:8081/api/v1/ready") ||
    !tunnelUnit.includes("--metrics 127.0.0.1:20241") ||
    !tunnelUnit.includes("CLOUDFLARE_TUNNEL_APPROVED")
  ) {
    fail("Origin service ingress or tunnel hold drifted.");
  }
  for (const line of [
    "SITESOURCERY_HOSTED_HOST=127.0.0.1",
    "SITESOURCERY_HOSTED_PORT=8788",
    "SITESOURCERY_TENANT_PORT=8080",
    "SITESOURCERY_REGISTRATION_MAIL_MODE=held",
    "SITESOURCERY_RECOVERY_MAIL_MODE=held",
    "SITESOURCERY_STRIPE_MODE=held"
  ]) {
    if (!hostedEnvironment.includes(line)) {
      fail("Origin environment schema lost a loopback or held fence.");
    }
  }
  const releaseControl = parseJsonObject(
    releaseControlSource,
    "Origin release control"
  );
  const commercialControl = parseJsonObject(
    commercialControlSource,
    "Origin commercial control"
  );
  if (
    releaseControl.state !== "hold" ||
    releaseControl.allowsDeployment !== false ||
    releaseControl.allowsCommercialDeployment !== false ||
    commercialControl.state !== "hold" ||
    commercialControl.checkout?.enabled !== false ||
    commercialControl.domainCheckout?.enabled !== false ||
    commercialControl.costPolicy?.providerPurchasesAuthorized !== false
  ) {
    fail("Origin repository authority is not exactly held.");
  }
}

export async function collectOriginRepositorySnapshot({
  projectRoot,
  layout
}) {
  await verifyIngressAndHolds(projectRoot);
  const [artifact, units, environmentSchema, migration, legal, ingress] =
    await Promise.all([
      collectOriginTreeManifest({
        projectRoot,
        domain: "origin-artifact",
        relativeRoot: layout.artifactRoot
      }),
      collectOriginPathManifest({
        projectRoot,
        domain: "origin-units",
        relativePaths: [...ORIGIN_UNIT_PATHS]
      }),
      collectOriginPathManifest({
        projectRoot,
        domain: "origin-environment-schema",
        relativePaths: [...ORIGIN_ENVIRONMENT_SCHEMA_PATHS]
      }),
      collectMigrations(projectRoot, layout.migrationRoot),
      collectLegal(projectRoot, layout.legalConstantsPath),
      collectOriginPathManifest({
        projectRoot,
        domain: "origin-ingress",
        relativePaths: [...ORIGIN_INGRESS_PATHS]
      })
    ]);
  return Object.freeze({
    artifact,
    units,
    environmentSchema,
    migration,
    legal,
    ingress
  });
}

async function defaultGitRunner(arguments_, projectRoot) {
  const result = await executeFile("git", arguments_, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
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

export async function verifyOriginReleaseRepository({
  projectRoot,
  releaseInput,
  gitRunner = defaultGitRunner
}) {
  const input = validateOriginReleaseInput(releaseInput);
  const source = input.epoch.source;
  const rollback = input.epoch.rollback;
  await requireGit(
    gitRunner,
    projectRoot,
    ["cat-file", "-e", `${source.commitSha}^{commit}`],
    "Origin source commit"
  );
  await requireGit(
    gitRunner,
    projectRoot,
    ["cat-file", "-e", `${rollback.predecessorCommitSha}^{commit}`],
    "Origin rollback predecessor"
  );
  const [head, tree, predecessorTree, status] = await Promise.all([
    requireGit(gitRunner, projectRoot, ["rev-parse", "HEAD"], "Origin HEAD"),
    requireGit(
      gitRunner,
      projectRoot,
      ["rev-parse", `${source.commitSha}^{tree}`],
      "Origin source tree"
    ),
    requireGit(
      gitRunner,
      projectRoot,
      ["rev-parse", `${rollback.predecessorCommitSha}^{tree}`],
      "Origin rollback tree"
    ),
    requireGit(
      gitRunner,
      projectRoot,
      ["status", "--porcelain=v1", "--untracked-files=no"],
      "Origin tracked status"
    )
  ]);
  if (
    head !== source.commitSha ||
    tree !== source.treeSha ||
    predecessorTree !== rollback.predecessorTreeSha ||
    status !== ""
  ) {
    fail("Origin Git identity is dirty or drifted from the successor release input.");
  }
  await requireGit(
    gitRunner,
    projectRoot,
    [
      "merge-base",
      "--is-ancestor",
      SHAPE_EPOCH_BINDING.source.legalCandidateCommitSha,
      source.commitSha
    ],
    "Origin release-epoch ancestry"
  );
  await requireGit(
    gitRunner,
    projectRoot,
    [
      "merge-base",
      "--is-ancestor",
      ORIGIN_UNION_BASE_COMMIT,
      source.commitSha
    ],
    "Origin union-base ancestry"
  );
  await requireGit(
    gitRunner,
    projectRoot,
    [
      "merge-base",
      "--is-ancestor",
      rollback.predecessorCommitSha,
      source.commitSha
    ],
    "Origin rollback ancestry"
  );
  const snapshot = await collectOriginRepositorySnapshot({
    projectRoot,
    layout: input.epoch.layout
  });
  return createOriginSeal({
    releaseInput: input,
    observed: {
      source: structuredClone(source),
      ...structuredClone(snapshot)
    }
  });
}
