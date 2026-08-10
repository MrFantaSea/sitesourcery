import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildPagesArtifact,
  publicFileAllowlist,
  verifyPagesArtifact,
} from "../build-pages.mjs";
import {
  createPagesJointLegalV4Plan,
  pagesLegalV4Files,
  PAGES_JOINT_LEGAL_V3_ROOT,
} from "../hosted-truth/pages-legal-v4.mjs";
import { JOINT_LEGAL_V3_RELEASE } from "../hosted-truth/joint-legal-v3-artifacts.mjs";
import { JOINT_LEGAL_V4_RELEASE } from "../hosted-truth/joint-legal-v4-artifacts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const V4_ROOT = "ops/releases/joint-legal-v4-2026-08-09T214211Z";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("Pages Legal V4 plan is the exact 80-file V2/V3/V4 publication ledger", () => {
  const plan = createPagesJointLegalV4Plan({ root: ROOT, finalizationRoot: V4_ROOT });
  const files = pagesLegalV4Files(publicFileAllowlist, plan);
  assert.equal(files.length, 80);
  for (const file of [
    "legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/index.html",
    `legal/privacy/versions/${JOINT_LEGAL_V3_RELEASE.privacyVersion}/index.html`,
    `legal/privacy/versions/${JOINT_LEGAL_V4_RELEASE.privacyVersion}/index.html`,
    "legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2/index.html",
    `legal/website-terms/versions/${JOINT_LEGAL_V3_RELEASE.websiteTermsVersion}/index.html`,
    `legal/website-terms/versions/${JOINT_LEGAL_V4_RELEASE.websiteTermsVersion}/index.html`,
  ]) assert.ok(files.includes(file), file);
  assert.equal(plan.v3.receipt.authorityDigest, JOINT_LEGAL_V3_RELEASE.authorityDigest);
  assert.equal(plan.v4.receipt.authorityDigest, JOINT_LEGAL_V4_RELEASE.authorityDigest);
});

test("Pages Legal V4 build publishes V4 current aliases and preserves all versioned bytes", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-pages-v4-"));
  await rm(output, { recursive: true });
  try {
    buildPagesArtifact({ root: ROOT, output, jointLegalV4FinalizationRoot: V4_ROOT });
    assert.deepEqual(
      verifyPagesArtifact({ root: ROOT, output, jointLegalV4FinalizationRoot: V4_ROOT }),
      { files: 80, output },
    );
    const identities = [
      ["legal/privacy/index.html", JOINT_LEGAL_V4_RELEASE.privacySha256],
      [`legal/privacy/versions/${JOINT_LEGAL_V3_RELEASE.privacyVersion}/index.html`, JOINT_LEGAL_V3_RELEASE.privacySha256],
      [`legal/privacy/versions/${JOINT_LEGAL_V4_RELEASE.privacyVersion}/index.html`, JOINT_LEGAL_V4_RELEASE.privacySha256],
      ["legal/website-terms/index.html", JOINT_LEGAL_V4_RELEASE.websiteTermsSha256],
      [`legal/website-terms/versions/${JOINT_LEGAL_V3_RELEASE.websiteTermsVersion}/index.html`, JOINT_LEGAL_V3_RELEASE.websiteTermsSha256],
      [`legal/website-terms/versions/${JOINT_LEGAL_V4_RELEASE.websiteTermsVersion}/index.html`, JOINT_LEGAL_V4_RELEASE.websiteTermsSha256],
    ];
    for (const [file, expected] of identities) {
      assert.equal(sha256(await readFile(path.join(output, ...file.split("/")))), expected, file);
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("Pages Legal V4 finalization rejects mutated retained bytes", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-pages-v4-tamper-"));
  try {
    const v3 = path.join(fixture, ...PAGES_JOINT_LEGAL_V3_ROOT.split("/"));
    const v4 = path.join(fixture, V4_ROOT);
    await mkdir(path.dirname(v3), { recursive: true });
    await mkdir(path.dirname(v4), { recursive: true });
    await cp(path.join(ROOT, ...PAGES_JOINT_LEGAL_V3_ROOT.split("/")), v3, { recursive: true });
    await cp(path.join(ROOT, V4_ROOT), v4, { recursive: true });
    await writeFile(
      path.join(v4, "hosted/legal/privacy/index.html"),
      "tampered\n",
      "utf8",
    );
    assert.throws(
      () => createPagesJointLegalV4Plan({ root: fixture, finalizationRoot: V4_ROOT }),
      /retained legal artifact bytes changed/u,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
