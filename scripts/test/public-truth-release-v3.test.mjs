import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { CANONICAL_ROUTES } from "../check-routes.mjs";
import { readCiReleaseSuccessorInput } from "../../ops/ci-release-proof-repository.mjs";
import { artifactManifest } from "../verify-public-truth-release.mjs";
import {
  AUTHORITY_STATEMENT_V3,
  IMMUTABLE_V2_BLOBS,
  RECEIPT_PATH_V3,
  REVIEWED_BROWSER_V3,
  V3_PROOF_IDENTITY_PATHS,
  authorityDigestV3,
  browserProofDigestV3,
  canonicalRootV3,
  ciSuccessorInputPath,
  cleanCheckoutV3,
  collectWorkflowRunPagesV3,
  createAuthorityReceiptV3,
  parseCliV3,
  postdeployPublishedAtV3,
  validateAuthorityReceiptV3,
  validateBrowserProofV3,
  validateFirstUseWorkflowRuns,
  validatePagesObservationV3,
  validateSuccessorGraph,
} from "../verify-public-truth-release-v3.mjs";

const executeFile = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CANDIDATE = "1".repeat(40);
const TREE = "2".repeat(40);
const SUCCESSOR = "3".repeat(40);
const PUBLICATION = "4".repeat(40);
const CI_SHA = "5".repeat(64);
const CI_DIGEST = "6".repeat(64);
const SOURCE = "7".repeat(64);
const PAGES = "8".repeat(64);
const PREDECESSOR = "9".repeat(40);
const NOW = Date.parse("2026-08-11T11:00:00.000Z");

function receipt() {
  return createAuthorityReceiptV3({
    candidateSha: CANDIDATE,
    candidateTreeSha: TREE,
    successorControlSha: SUCCESSOR,
    pagesPredecessor: {
      deploymentId: "123456789",
      commitSha: PREDECESSOR,
    },
    ciInputSha256: CI_SHA,
    ciInputDigest: CI_DIGEST,
    sourceManifestSha256: SOURCE,
    pagesFileCount: 94,
    pagesManifestSha256: PAGES,
    issuedAt: "2026-08-11T10:55:00.000Z",
    expiresAt: "2026-08-11T11:55:00.000Z",
  });
}

function receiptContext() {
  return {
    actor: "MrFantaSea",
    actorId: "293072489",
    now: NOW,
    candidateSha: CANDIDATE,
    candidateTreeSha: TREE,
    successorControlSha: SUCCESSOR,
    publicationControlSha: PUBLICATION,
    ciInputSha256: CI_SHA,
    ciInput: {
      digest: CI_DIGEST,
      legalV4Pages: { fileCount: 94, manifestSha256: PAGES },
    },
    sourceManifestSha256: SOURCE,
  };
}

test("V3 receipt binds successor authority without inventing P' or publishedAt", () => {
  const selected = receipt();
  validateAuthorityReceiptV3(selected, receiptContext());
  assert.equal(selected.authority.statement, AUTHORITY_STATEMENT_V3);
  assert.equal(Object.hasOwn(selected.lineage, "publicationControlSha"), false);
  assert.equal(Object.hasOwn(selected, "publishedAt"), false);
  assert.deepEqual(selected.browser, REVIEWED_BROWSER_V3);
  assert.equal(selected.browser.routeCount, CANONICAL_ROUTES.length);
  assert.equal(selected.browser.viewCount, CANONICAL_ROUTES.length * 6);
});

test("V3 receipt rejects effect lift, timing, lineage, browser, and publishedAt tampering", () => {
  const mutations = [
    (value) => { value.flags.allowsProviderEffects = true; },
    (value) => { value.flags.allowsDnsMutation = true; },
    (value) => { value.authority.oneShot = false; },
    (value) => { value.authority.expiresAt = "2026-08-11T12:55:01.000Z"; },
    (value) => { value.lineage.successorControlSha = "a".repeat(40); },
    (value) => { value.browser.widths = [320, 390, 1440]; },
    (value) => { value.browser.viewCount = 45; },
    (value) => { value.publishedAt = "2026-08-11T11:01:00.000Z"; },
  ];
  for (const mutate of mutations) {
    const changed = receipt();
    mutate(changed);
    changed.authority.digest = authorityDigestV3(changed);
    assert.throws(
      () => validateAuthorityReceiptV3(changed, receiptContext()),
      /receipt|authority|browser|lineage|effect|fields/iu,
    );
  }
});

test("V3 receipt rejects candidate tree, source, and successor Pages drift", () => {
  for (const mutate of [
    (context) => { context.candidateTreeSha = "a".repeat(40); },
    (context) => { context.sourceManifestSha256 = "a".repeat(64); },
    (context) => { context.ciInput.legalV4Pages.fileCount = 95; },
    (context) => { context.ciInput.legalV4Pages.manifestSha256 = "a".repeat(64); },
  ]) {
    const context = structuredClone(receiptContext());
    mutate(context);
    assert.throws(() => validateAuthorityReceiptV3(receipt(), context));
  }
});

test("browser proof is machine-bound to candidate routes, six widths, and exact view count", () => {
  const manifest = { count: 94, sha256: "b".repeat(64) };
  const proof = {
    schema: "sitesourcery.public-truth-browser-proof/v3",
    result: "pass",
    artifact: {
      fileCount: manifest.count,
      manifestSha256: manifest.sha256,
    },
    browser: {
      version: REVIEWED_BROWSER_V3.version,
      widths: [...REVIEWED_BROWSER_V3.widths],
    },
    routes: [...CANONICAL_ROUTES],
    routeCount: CANONICAL_ROUTES.length,
    viewCount: CANONICAL_ROUTES.length * 6,
  };
  proof.digest = browserProofDigestV3(proof);
  validateBrowserProofV3(proof, { manifest });
  for (const mutate of [
    (value) => { value.viewCount -= 1; },
    (value) => { value.routes = value.routes.slice(1); },
    (value) => { value.browser.widths = [320, 390, 1440]; },
    (value) => { value.artifact.manifestSha256 = "c".repeat(64); },
  ]) {
    const changed = structuredClone(proof);
    mutate(changed);
    changed.digest = browserProofDigestV3(changed);
    assert.throws(() => validateBrowserProofV3(changed, { manifest }));
  }
});

test("one-shot gate rejects replay and binds the current workflow run", () => {
  const payload = {
    total_count: 1,
    workflow_runs: [{
      id: 123,
      run_attempt: 1,
      event: "workflow_dispatch",
      head_sha: PUBLICATION,
      path: ".github/workflows/public-truth-reconciliation-v3.yml",
      display_title: `public-truth-v3-${"d".repeat(64)}`,
    }],
  };
  validateFirstUseWorkflowRuns(payload, {
    publicationControlSha: PUBLICATION,
    runId: "123",
    authorityReceiptSha256: "d".repeat(64),
  });
  assert.throws(() => validateFirstUseWorkflowRuns({
    total_count: 2,
    workflow_runs: [...payload.workflow_runs, { ...payload.workflow_runs[0], id: 124 }],
  }, {
    publicationControlSha: PUBLICATION,
    runId: "123",
    authorityReceiptSha256: "d".repeat(64),
  }), /already been used|unique/iu);
  assert.throws(() => validateFirstUseWorkflowRuns({
    total_count: 2,
    workflow_runs: [
      payload.workflow_runs[0],
      {
        ...payload.workflow_runs[0],
        id: 124,
        head_sha: "e".repeat(40),
      },
    ],
  }, {
    publicationControlSha: PUBLICATION,
    runId: "123",
    authorityReceiptSha256: "d".repeat(64),
  }), /already been used|unique/iu);
  assert.throws(() => validateFirstUseWorkflowRuns([{
    total_count: 2,
    workflow_runs: payload.workflow_runs,
  }], {
    publicationControlSha: PUBLICATION,
    runId: "123",
    authorityReceiptSha256: "d".repeat(64),
  }), /incomplete/iu);
  assert.throws(() => validateFirstUseWorkflowRuns([
    payload,
    { total_count: 2, workflow_runs: [] },
  ], {
    publicationControlSha: PUBLICATION,
    runId: "123",
    authorityReceiptSha256: "d".repeat(64),
  }), /total changed/iu);
  assert.throws(() => validateFirstUseWorkflowRuns([
    { total_count: 2, workflow_runs: payload.workflow_runs },
    { total_count: 2, workflow_runs: payload.workflow_runs },
  ], {
    publicationControlSha: PUBLICATION,
    runId: "123",
    authorityReceiptSha256: "d".repeat(64),
  }), /duplicate run ID/iu);
});

test("workflow-run collector retrieves every declared page and fails closed", () => {
  const runs = Array.from({ length: 101 }, (_, index) => ({
    id: index + 1,
    display_title: `unrelated-${index + 1}`,
  }));
  const requested = [];
  const pages = collectWorkflowRunPagesV3((pageNumber, perPage) => {
    requested.push([pageNumber, perPage]);
    return {
      total_count: runs.length,
      workflow_runs: runs.slice((pageNumber - 1) * perPage, pageNumber * perPage),
    };
  });
  assert.deepEqual(requested, [[1, 100], [2, 100]]);
  assert.equal(pages.length, 2);
  assert.equal(pages.flatMap((page) => page.workflow_runs).length, 101);

  assert.throws(() => collectWorkflowRunPagesV3((pageNumber) => ({
    total_count: 101,
    workflow_runs: pageNumber === 1 ? runs.slice(0, 100) : [],
  })), /ended before|completely/iu);
  assert.throws(() => collectWorkflowRunPagesV3(() => ({
    total_count: 10_001,
    workflow_runs: runs.slice(0, 100),
  })), /exceeds/iu);
});

test("Pages predecessor timestamp is exact finite GitHub UTC", () => {
  const selected = receipt();
  const observation = {
    url: "https://api.github.com/repos/MrFantaSea/sitesourcery/pages/builds/123456789",
    status: "built",
    error: { message: null },
    pusher: { login: "MrFantaSea" },
    commit: PREDECESSOR,
    duration: 123,
    created_at: "2026-08-11T10:00:00Z",
    updated_at: "2026-08-11T10:01:00Z",
  };
  validatePagesObservationV3(observation, selected);
  for (const updatedAt of ["not-a-time", "2026-08-11T10:01:00.123Z", "9999-99-99T99:99:99Z"] ) {
    assert.throws(
      () => validatePagesObservationV3({ ...observation, updated_at: updatedAt }, selected),
      /observation/iu,
    );
  }
});

test("publishedAt is post-verification completion and must precede authority expiry", () => {
  assert.equal(postdeployPublishedAtV3({
    startedAt: NOW,
    completedAt: NOW + 30_000,
    expiresAt: "2026-08-11T11:55:00.000Z",
  }), "2026-08-11T11:00:30.000Z");
  assert.throws(() => postdeployPublishedAtV3({
    startedAt: NOW,
    completedAt: Date.parse("2026-08-11T11:55:00.000Z"),
    expiresAt: "2026-08-11T11:55:00.000Z",
  }), /outside/iu);
});

test("CLI separates machine browser proof from future P' control verification", () => {
  assert.deepEqual(parseCliV3([
    "--mode", "browser",
    "--artifact-root", "/tmp/site",
    "--evidence", "/tmp/public-truth-browser-proof-v3.json",
  ]), {
    mode: "browser",
    artifactRoot: "/tmp/site",
    evidence: "/tmp/public-truth-browser-proof-v3.json",
  });
  assert.deepEqual(parseCliV3([
    "--mode", "runs",
    "--evidence", "/tmp/public-truth-v3-runs.json",
  ]), {
    mode: "runs",
    evidence: "/tmp/public-truth-v3-runs.json",
  });
  assert.throws(() => parseCliV3([
    "--mode", "control",
    "--root", "/tmp/control",
  ]), /exact ordered contract/iu);
});

async function git(root, arguments_) {
  const { stdout } = await executeFile("git", arguments_, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "V3 test",
      GIT_AUTHOR_EMAIL: "v3@example.invalid",
      GIT_COMMITTER_NAME: "V3 test",
      GIT_COMMITTER_EMAIL: "v3@example.invalid",
    },
  });
  return stdout.trim();
}

async function put(root, relative, bytes) {
  const selected = path.join(root, ...relative.split("/"));
  await mkdir(path.dirname(selected), { recursive: true });
  if (Buffer.isBuffer(bytes) || typeof bytes === "string") {
    await writeFile(selected, bytes);
  } else {
    await copyFile(bytes, selected);
  }
}

async function graphFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "sitesourcery-public-truth-v3-graph-"));
  await git(root, ["init", "--initial-branch=main"]);
  for (const relative of new Set([
    ...V3_PROOF_IDENTITY_PATHS,
    "data/release-control.json",
  ])) {
    const destination = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(ROOT, ...relative.split("/")), destination);
  }
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "candidate"]);
  const candidateSha = await git(root, ["rev-parse", "HEAD"]);
  await put(root, ciSuccessorInputPath(candidateSha), "{}\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "successor control"]);
  const successorControlSha = await git(root, ["rev-parse", "HEAD"]);
  await put(root, RECEIPT_PATH_V3, "{}\n");
  await put(root, "data/release-control.json", "{\"state\":\"publication\"}\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "publication control"]);
  const publicationControlSha = await git(root, ["rev-parse", "HEAD"]);
  return { root, candidateSha, successorControlSha, publicationControlSha };
}

test("C' to K' to P' graph permits only one candidate-named K input and P control files", async () => {
  const fixture = await graphFixture();
  try {
    validateSuccessorGraph(fixture);
    await git(fixture.root, ["checkout", "-b", "bad", fixture.candidateSha]);
    await put(fixture.root, ciSuccessorInputPath(fixture.candidateSha), "{}\n");
    await put(fixture.root, "unexpected.txt", "drift\n");
    await git(fixture.root, ["add", "."]);
    await git(fixture.root, ["commit", "-m", "bad successor"]);
    const badSuccessor = await git(fixture.root, ["rev-parse", "HEAD"]);
    await put(fixture.root, RECEIPT_PATH_V3, "{}\n");
    await put(fixture.root, "data/release-control.json", "{\"state\":\"publication\"}\n");
    await git(fixture.root, ["add", "."]);
    await git(fixture.root, ["commit", "-m", "bad publication"]);
    const badPublication = await git(fixture.root, ["rev-parse", "HEAD"]);
    assert.throws(() => validateSuccessorGraph({
      root: fixture.root,
      candidateSha: fixture.candidateSha,
      successorControlSha: badSuccessor,
      publicationControlSha: badPublication,
    }), /K' changed paths/iu);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("repository root rejects an unresolved symlink", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "sitesourcery-public-truth-v3-root-"));
  try {
    const link = path.join(temporary, "repository-link");
    await symlink(ROOT, link, "dir");
    await assert.rejects(() => canonicalRootV3(link), /real directory/iu);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("candidate and publication tracked drift is rejected", async () => {
  const fixture = await graphFixture();
  try {
    cleanCheckoutV3(fixture.root);
    await writeFile(
      path.join(fixture.root, ".github/workflows/public-truth-reconciliation-v3.yml"),
      "tracked drift\n",
    );
    assert.throws(() => cleanCheckoutV3(fixture.root), /tracked bytes/iu);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("candidate-named K input rejects missing, wrong digest, and symlink files", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "sitesourcery-public-truth-v3-input-"));
  try {
    const selected = path.join(temporary, "successor.json");
    await assert.rejects(() => readCiReleaseSuccessorInput({
      inputPath: selected,
      expectedSha256: "a".repeat(64),
    }));
    await writeFile(selected, "{}\n");
    await assert.rejects(() => readCiReleaseSuccessorInput({
      inputPath: selected,
      expectedSha256: "a".repeat(64),
    }), /bytes drifted/iu);
    const link = path.join(temporary, "successor-link.json");
    await symlink(selected, link);
    await assert.rejects(() => readCiReleaseSuccessorInput({
      inputPath: link,
      expectedSha256: "a".repeat(64),
    }), /regular non-symlink/iu);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Pages artifact manifest rejects symlink traversal", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "sitesourcery-public-truth-v3-artifact-"));
  try {
    await writeFile(path.join(temporary, "index.html"), "safe\n");
    await symlink("/etc/passwd", path.join(temporary, "escape"));
    await assert.rejects(() => artifactManifest(temporary), /symbolic link/iu);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("V2 workflow, verifier, and tests retain exact historical blobs", async () => {
  for (const [file, expected] of Object.entries(IMMUTABLE_V2_BLOBS)) {
    assert.equal(await git(ROOT, ["hash-object", file]), expected, file);
  }
});

test("V3 workflow is manual, least-privilege, Pages-only, and receipt-free", async () => {
  const workflow = await readFile(
    path.join(ROOT, ".github/workflows/public-truth-reconciliation-v3.yml"),
    "utf8",
  );
  assert.match(workflow, /^on:\n  workflow_dispatch:/mu);
  assert.match(workflow, /^permissions: \{\}$/mu);
  assert.match(workflow, /actions: read/u);
  assert.match(workflow, /pages: write/u);
  assert.match(workflow, /PUBLIC_TRUTH_V3_FIRST_USE=verified/u);
  assert.match(workflow, /--mode browser/u);
  assert.match(workflow, /--browser-proof/u);
  assert.equal([...workflow.matchAll(/--mode runs/gu)].length, 3);
  const validateJob = workflow.slice(
    workflow.indexOf("  validate:"),
    workflow.indexOf("\n  deploy:"),
  );
  const checkoutIndex = validateJob.indexOf(
    "- name: Check out exact publication control P'",
  );
  const shellIdentityIndex = validateJob.indexOf(
    "- name: Reject publication workflow or ref substitution",
  );
  const pinnedNodeIndex = validateJob.indexOf(
    "node-version-file: control/.nvmrc",
  );
  const firstHistoryIndex = validateJob.indexOf("--mode runs");
  assert.ok(
    checkoutIndex >= 0 &&
      checkoutIndex < shellIdentityIndex &&
      shellIdentityIndex < pinnedNodeIndex &&
      pinnedNodeIndex < firstHistoryIndex,
    "validate must prove P' before pinning its Node and reading history",
  );
  assert.match(
    workflow,
    /concurrency:\n  group: public-truth-v3-\$\{\{ inputs\.authority_receipt_sha256 \}\}/u,
  );
  assert.doesNotMatch(workflow, /secrets\./u);
  assert.doesNotMatch(workflow, /stripe|resend|cloudflare|\bdig\b/iu);
  assert.equal(await readFile(path.join(ROOT, RECEIPT_PATH_V3)).catch(
    (error) => error.code,
  ), "ENOENT");
});
