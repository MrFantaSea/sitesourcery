import assert from "node:assert/strict";
import {
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
  BROWSER_FINALIZED_ARTIFACT_ROOT_ENV,
  createBrowserAuditArtifactPlan,
  prepareBrowserAuditArtifact,
} from "../browser-audit-artifact.mjs";
import {
  canonicalJson,
  digest,
} from "../../server/hosted/security.mjs";
import {
  finalizePrivacyV3,
} from "../hosted-truth/finalize-privacy-v3.mjs";
import {
  HOSTED_PRIVACY_V3_CONTENT,
} from "../hosted-truth/legal-artifacts.mjs";
import {
  PRIVACY_V3_AUTHORITY_SCHEMA,
  PRIVACY_V3_OWNER_APPROVAL,
} from "../hosted-truth/privacy-v3-render.mjs";
import {
  PRIVACY_V3_CONTENT_APPROVAL_SCHEMA,
  PRIVACY_V3_CONTENT_APPROVAL_STATEMENT,
  sealPrivacyV3Content,
} from "../hosted-truth/seal-privacy-v3-content.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const VERSION = "SS-HOSTED-PRIVACY-2099-12-31-V3";
const EFFECTIVE_AT = "2099-12-31T00:00:00.000Z";

async function writeFinalizedFixture(temporaryRoot) {
  const contentSeal = await sealPrivacyV3Content({
    root: ROOT,
    outputRoot: path.join(temporaryRoot, "content-seal"),
    approvalReceipt: {
      schema: PRIVACY_V3_CONTENT_APPROVAL_SCHEMA,
      statement: PRIVACY_V3_CONTENT_APPROVAL_STATEMENT,
      approvalReference: "TEST-ONLY-BROWSER-FINALIZER-COMPATIBILITY",
      approvedAt: "2099-12-30T12:34:56.000Z",
      reviewArtifactSha256: HOSTED_PRIVACY_V3_CONTENT.reviewArtifactSha256,
      reviewArtifactByteCount:
        HOSTED_PRIVACY_V3_CONTENT.reviewArtifactByteCount,
    },
  });
  const outputRoot = path.join(temporaryRoot, "finalized");
  const finalized = await finalizePrivacyV3({
    root: ROOT,
    outputRoot,
    version: VERSION,
    effectiveAt: EFFECTIVE_AT,
    ownerApproval: PRIVACY_V3_OWNER_APPROVAL,
    contentSeal: contentSeal.receipt,
  });
  return Object.freeze({ outputRoot, receipt: finalized.receipt });
}

test("held browser audit plan rebuilds only the repository _hosted artifact", async () => {
  const plan = createBrowserAuditArtifactPlan({
    siteRoot: ROOT,
    environment: {},
    argv: [],
  });
  assert.deepEqual(plan, {
    mode: "held-build",
    siteRoot: ROOT,
    outputRoot: null,
    hostedRoot: path.join(ROOT, "_hosted"),
    receiptFile: null,
  });
  const builds = [];
  const prepared = await prepareBrowserAuditArtifact({
    plan,
    async buildHostedArtifactImpl(options) {
      builds.push(options);
      return options.output;
    },
    async verifyHostedArtifactImpl() {
      throw new Error("default preparation delegates verification to the builder");
    },
  });
  assert.equal(prepared.mode, "held-build");
  assert.deepEqual(builds, [{ root: ROOT, output: path.join(ROOT, "_hosted") }]);
});

test("finalized browser audit input is explicit, external, and unambiguous", () => {
  const external = path.join(os.tmpdir(), "sitesourcery-finalized-plan");
  assert.equal(
    createBrowserAuditArtifactPlan({
      siteRoot: ROOT,
      environment: {
        [BROWSER_FINALIZED_ARTIFACT_ROOT_ENV]: external,
      },
    }).outputRoot,
    external,
  );
  assert.equal(
    createBrowserAuditArtifactPlan({
      siteRoot: ROOT,
      environment: {},
      argv: ["--finalized-artifact-root", external],
    }).hostedRoot,
    path.join(external, "hosted"),
  );
  assert.throws(
    () => createBrowserAuditArtifactPlan({
      siteRoot: ROOT,
      environment: {
        [BROWSER_FINALIZED_ARTIFACT_ROOT_ENV]: external,
      },
      argv: ["--finalized-artifact-root", external],
    }),
    /choose either/u,
  );
  assert.throws(
    () => createBrowserAuditArtifactPlan({
      siteRoot: ROOT,
      environment: {},
      argv: ["--finalized-artifact-root", "relative-output"],
    }),
    /absolute path/u,
  );
  assert.throws(
    () => createBrowserAuditArtifactPlan({
      siteRoot: ROOT,
      environment: {},
      argv: [
        "--finalized-artifact-root",
        path.join(ROOT, "release-output"),
      ],
    }),
    /outside the repository/u,
  );
});

test("finalized browser audit verifies the receipt and never rebuilds held defaults", async (t) => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "sitesourcery-finalized-browser-test-"),
  );
  t.after(async () => rm(temporaryRoot, { recursive: true, force: true }));
  const { outputRoot, receipt } = await writeFinalizedFixture(temporaryRoot);
  const plan = createBrowserAuditArtifactPlan({
    siteRoot: ROOT,
    environment: {},
    argv: ["--finalized-artifact-root", outputRoot],
  });
  const prepared = await prepareBrowserAuditArtifact({
    plan,
    async buildHostedArtifactImpl() {
      throw new Error("finalized input must not rebuild a held artifact");
    },
  });
  assert.equal(prepared.mode, "finalized");
  assert.equal(prepared.receipt.fullPageSha256, receipt.fullPageSha256);

  const receiptFile = path.join(
    outputRoot,
    "privacy-v3-release-constants.json",
  );
  const changed = JSON.parse(await readFile(receiptFile, "utf8"));
  changed.fullPageSha256 = "0".repeat(64);
  await writeFile(receiptFile, `${JSON.stringify(changed, null, 2)}\n`);
  await assert.rejects(
    prepareBrowserAuditArtifact({
      plan,
      async buildHostedArtifactImpl() {
        throw new Error("must not build");
      },
      async verifyHostedArtifactImpl() {
        throw new Error("tampered receipt must fail first");
      },
    }),
    /authority digest mismatch|artifact digest mismatch|deep-equal/u,
  );

  const legacy = JSON.parse(JSON.stringify(receipt));
  legacy.schema = "sitesourcery.hosted-privacy-v3-finalization/v1";
  await writeFile(receiptFile, `${JSON.stringify(legacy, null, 2)}\n`);
  await assert.rejects(
    prepareBrowserAuditArtifact({
      plan,
      async buildHostedArtifactImpl() {
        throw new Error("must not build");
      },
      async verifyHostedArtifactImpl() {
        throw new Error("legacy receipt must fail first");
      },
    }),
    /receipt schema mismatch/u,
  );

  const changedContentSealDigest = JSON.parse(JSON.stringify(receipt));
  changedContentSealDigest.contentSeal.contentSealSha256 = "a".repeat(64);
  await writeFile(
    receiptFile,
    `${JSON.stringify(changedContentSealDigest, null, 2)}\n`,
  );
  await assert.rejects(
    prepareBrowserAuditArtifact({
      plan,
      async buildHostedArtifactImpl() {
        throw new Error("must not build");
      },
      async verifyHostedArtifactImpl() {
        throw new Error("changed content-seal digest must fail first");
      },
    }),
    /content seal digest changed/u,
  );

  const changedTerms = JSON.parse(JSON.stringify(receipt));
  changedTerms.documents[1].contentDigest = "a".repeat(64);
  changedTerms.documents[2].contentDigest = "a".repeat(64);
  changedTerms.authorityDigest = digest(canonicalJson({
    documents: changedTerms.documents,
    schema: PRIVACY_V3_AUTHORITY_SCHEMA,
  }));
  await writeFile(receiptFile, `${JSON.stringify(changedTerms, null, 2)}\n`);
  await assert.rejects(
    prepareBrowserAuditArtifact({
      plan,
      async buildHostedArtifactImpl() {
        throw new Error("must not build");
      },
      async verifyHostedArtifactImpl() {
        throw new Error("substituted Terms must fail first");
      },
    }),
    /deep-equal/u,
  );

  const changedContentSeal = JSON.parse(JSON.stringify(receipt));
  changedContentSeal.contentSeal.approvalStatement = "not-owner-approved";
  await writeFile(
    receiptFile,
    `${JSON.stringify(changedContentSeal, null, 2)}\n`,
  );
  await assert.rejects(
    prepareBrowserAuditArtifact({
      plan,
      async buildHostedArtifactImpl() {
        throw new Error("must not build");
      },
      async verifyHostedArtifactImpl() {
        throw new Error("changed content seal must fail first");
      },
    }),
    /actual|content approval/u,
  );
});
