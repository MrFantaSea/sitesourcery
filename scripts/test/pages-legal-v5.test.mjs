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

const ROOT = path.resolve(import.meta.dirname, "../..");

test("Pages V5 integration stays closed while finalization is absent", () => {
  assert.throws(
    () => createPagesJointLegalV5Plan({ root: ROOT }),
    /joint-legal-v5-finalization|no such file|ENOENT/u,
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
