import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  IMMUTABLE_V2_BLOBS,
  V2_RETIREMENT_POLICY_PATHS,
  V3_PROOF_IDENTITY_PATHS,
} from "../verify-public-truth-release-v3.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CAPSULE_ROOT =
  "ops/releases/public-truth-v2-retired-2026-08-11";
const MANIFEST_PATH = `${CAPSULE_ROOT}/manifest.json`;
const RETIRED_ACTIVE_PATHS = Object.freeze([
  ".github/workflows/public-truth-reconciliation-v2.yml",
  "scripts/test/public-truth-release-v2.test.mjs",
  "scripts/verify-public-truth-release-v2.mjs",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobSha1(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

test("V2 has no active workflow, verifier, or npm-executed historical test", async () => {
  for (const relative of RETIRED_ACTIVE_PATHS) {
    await assert.rejects(
      lstat(path.join(ROOT, relative)),
      { code: "ENOENT" },
      relative,
    );
  }

  const activeWorkflowNames = await readdir(
    path.join(ROOT, ".github/workflows"),
  );
  assert.equal(
    activeWorkflowNames.includes("public-truth-reconciliation-v2.yml"),
    false,
  );
  for (const name of activeWorkflowNames) {
    const source = await readFile(
      path.join(ROOT, ".github/workflows", name),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /verify-public-truth-release-v2\.mjs|Exact Legal V4 public-truth deployment/u,
      name,
    );
  }
});

test("the retirement capsule retains the exact K V2 historical blobs", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(ROOT, MANIFEST_PATH), "utf8"),
  );
  assert.equal(
    manifest.schema,
    "sitesourcery.retired-public-truth-v2-capsule/v1",
  );
  assert.equal(
    manifest.originCommit,
    "b03cccbdc5252db3bd5f90084dbfa27beca33f52",
  );
  assert.equal(
    manifest.retirementReason,
    "superseded_by_v3_and_invalid_duplicate_pages_permissions",
  );
  assert.equal(
    manifest.activeWorkflowPath,
    RETIRED_ACTIVE_PATHS[0],
  );
  assert.equal(
    manifest.successorWorkflowPath,
    ".github/workflows/public-truth-reconciliation-v3.yml",
  );
  assert.deepEqual(
    manifest.files.map(({ originalPath }) => originalPath).sort(),
    [...RETIRED_ACTIVE_PATHS].sort(),
  );

  const manifestBlobs = {};
  for (const entry of manifest.files) {
    const bytes = await readFile(path.join(ROOT, entry.archivePath));
    assert.equal(bytes.length, entry.byteCount, entry.archivePath);
    assert.equal(sha256(bytes), entry.sha256, entry.archivePath);
    assert.equal(
      gitBlobSha1(bytes),
      entry.gitBlobSha1,
      entry.archivePath,
    );
    manifestBlobs[entry.archivePath] = entry.gitBlobSha1;
  }
  assert.deepEqual(manifestBlobs, IMMUTABLE_V2_BLOBS);
});

test("npm and V3 retain the active V2 retirement policy", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(ROOT, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["test:public-truth:v2-retirement"],
    "node --test scripts/test/browser-release-gate.test.mjs "
      + "scripts/test/pages-legal-v4.test.mjs "
      + "scripts/test/public-truth-v2-retirement.test.mjs",
  );
  assert.equal(packageJson.scripts["test:public-truth:v2"], undefined);
  assert.match(
    packageJson.scripts.test,
    /npm run test:public-truth:v2-retirement/u,
  );
  assert.doesNotMatch(
    packageJson.scripts.test,
    /npm run test:public-truth:v2(?:\s|$)/u,
  );
  for (const relative of V2_RETIREMENT_POLICY_PATHS) {
    assert.equal(
      V3_PROOF_IDENTITY_PATHS.includes(relative),
      true,
      relative,
    );
  }
});
