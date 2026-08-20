import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertPagesJointLegalV5Artifact,
  createPagesJointLegalV5Plan,
  pagesLegalV5Files,
} from "../hosted-truth/pages-legal-v5.mjs";
import {
  JOINT_LEGAL_V5_EFFECTIVE_AT,
  JOINT_LEGAL_V5_PRIVACY_VERSION,
  JOINT_LEGAL_V5_WEBSITE_TERMS_VERSION,
} from "../hosted-truth/finalize-joint-legal-v5.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("Pages V5 integration binds the exact held finalization", () => {
  const plan = createPagesJointLegalV5Plan({ root: ROOT });
  assert.equal(plan.v5.receipt.state, "owner-approved-finalization");
  assert.equal(plan.v5.receipt.published, false);
  assert.equal(plan.v5.receipt.deploymentAuthorized, false);
  assert.equal(plan.v5.receipt.integrationRequired, true);
  assert.equal(
    plan.v5.receipt.release.privacyVersion,
    JOINT_LEGAL_V5_PRIVACY_VERSION,
  );
  assert.equal(
    plan.v5.receipt.release.websiteTermsVersion,
    JOINT_LEGAL_V5_WEBSITE_TERMS_VERSION,
  );
  assert.equal(plan.v5.receipt.effectiveAt, JOINT_LEGAL_V5_EFFECTIVE_AT);
  assert.equal(
    plan.v5.receiptSha256,
    "5e51f126f19f635f712944ebbf80b7232c700df3e7b94c9a5396b9f66b5af82f",
  );
  assert.equal(plan.v5.artifacts.length, 5);
  assert.deepEqual(
    plan.publishedArtifacts.map(({ file }) => file),
    [
      "legal/index.html",
      "legal/privacy/index.html",
      "legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V3/index.html",
      "legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V4/index.html",
      "legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-20-V5/index.html",
      "legal/website-terms/index.html",
      "legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3/index.html",
      "legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4/index.html",
      "legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-20-V5/index.html",
    ],
  );
});

test("Pages V5 file merge is sorted and deduplicated", () => {
  const plan = {
    publishedArtifacts: [
      { file: "legal/privacy/index.html" },
      { file: "legal/index.html" },
    ],
  };
  assert.deepEqual(
    pagesLegalV5Files(["index.html", "legal/index.html"], plan),
    ["index.html", "legal/index.html", "legal/privacy/index.html"],
  );
});

test("Pages V5 output verification binds exact bytes", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-pages-v5-"));
  const bytes = Buffer.from("exact V5 artifact\n");
  const file = "legal/privacy/index.html";
  await mkdir(path.join(output, "legal/privacy"), { recursive: true });
  await writeFile(path.join(output, file), bytes);
  const plan = {
    publishedArtifacts: [{
      file,
      role: "privacy-current",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteCount: bytes.byteLength,
    }],
  };
  assert.equal(assertPagesJointLegalV5Artifact(output, plan), true);
  await writeFile(path.join(output, file), "changed\n");
  assert.throws(
    () => assertPagesJointLegalV5Artifact(output, plan),
    /artifact mismatch/u,
  );
});
