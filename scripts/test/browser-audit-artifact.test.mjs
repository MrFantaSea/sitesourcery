import assert from "node:assert/strict";
import {
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
  BROWSER_FINALIZED_ARTIFACT_ROOT_ENV,
  createBrowserAuditArtifactPlan,
  prepareBrowserAuditArtifact,
} from "../browser-audit-artifact.mjs";
import {
  canonicalJson,
  digest,
} from "../../server/hosted/security.mjs";
import {
  PRIVACY_V3_ACCEPTANCE_STATEMENT,
  PRIVACY_V3_AUTHORITY_SCHEMA,
  PRIVACY_V3_OWNER_APPROVAL,
} from "../hosted-truth/privacy-v3-render.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const VERSION = "SS-HOSTED-PRIVACY-2099-12-31-V3";
const EFFECTIVE_AT = "2099-12-31T00:00:00.000Z";

function receiptFor(bytes) {
  const fullPageSha256 = digest(bytes);
  const artifactUri =
    `https://sitesourcery.com/legal/privacy/versions/${VERSION}/`;
  const documents = [
    {
      kind: "privacy",
      version: VERSION,
      contentDigest: fullPageSha256,
      contentUri: artifactUri,
      effectiveAt: EFFECTIVE_AT,
    },
    {
      kind: "product",
      version: "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2",
      contentDigest: "a".repeat(64),
      contentUri: "https://sitesourcery.com/legal/website-terms/#self-service",
      effectiveAt: "2026-07-30T00:00:00.000Z",
    },
    {
      kind: "website",
      version: "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2",
      contentDigest: "a".repeat(64),
      contentUri: "https://sitesourcery.com/legal/website-terms/",
      effectiveAt: "2026-07-30T00:00:00.000Z",
    },
  ];
  const authorityDigest = digest(canonicalJson({
    documents,
    schema: PRIVACY_V3_AUTHORITY_SCHEMA,
  }));
  return {
    schema: "sitesourcery.hosted-privacy-v3-finalization/v1",
    state: "owner-approved-finalization",
    sealable: true,
    published: false,
    integrationRequired: true,
    renderPath: "real-hosted-builder",
    version: VERSION,
    effectiveAt: EFFECTIVE_AT,
    contentUri: artifactUri,
    artifactUri,
    fullPageSha256,
    byteCount: bytes.byteLength,
    mediaType: "text/html; charset=utf-8",
    authoritySchema: PRIVACY_V3_AUTHORITY_SCHEMA,
    acceptanceStatement: PRIVACY_V3_ACCEPTANCE_STATEMENT,
    authorityDigest,
    documents,
    artifacts: [
      {
        role: "current",
        file: "hosted/legal/privacy/index.html",
        sha256: fullPageSha256,
        byteCount: bytes.byteLength,
      },
      {
        role: "versioned",
        file: `hosted/legal/privacy/versions/${VERSION}/index.html`,
        sha256: fullPageSha256,
        byteCount: bytes.byteLength,
      },
    ],
    environment: {
      SITESOURCERY_HOSTED_PRIVACY_V3_VERSION: VERSION,
      SITESOURCERY_HOSTED_PRIVACY_V3_SHA256: fullPageSha256,
      SITESOURCERY_HOSTED_PRIVACY_V3_URI: artifactUri,
      SITESOURCERY_HOSTED_PRIVACY_V3_EFFECTIVE_AT: EFFECTIVE_AT,
      SITESOURCERY_HOSTED_PRIVACY_V3_BYTE_COUNT: String(bytes.byteLength),
      SITESOURCERY_HOSTED_PRIVACY_V3_ARTIFACT_URI: artifactUri,
      SITESOURCERY_HOSTED_PRIVACY_V3_AUTHORITY_SHA256: authorityDigest,
    },
  };
}

async function writeFinalizedFixture(outputRoot) {
  const bytes = Buffer.from("<!doctype html><title>Privacy V3 final</title>\n");
  const receipt = receiptFor(bytes);
  for (const { file } of receipt.artifacts) {
    const target = path.join(outputRoot, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await writeFile(
    path.join(outputRoot, "privacy-v3-release-constants.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
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
  const outputRoot = await mkdtemp(
    path.join(os.tmpdir(), "sitesourcery-finalized-browser-test-"),
  );
  t.after(async () => rm(outputRoot, { recursive: true, force: true }));
  const receipt = await writeFinalizedFixture(outputRoot);
  const plan = createBrowserAuditArtifactPlan({
    siteRoot: ROOT,
    environment: {},
    argv: ["--finalized-artifact-root", outputRoot],
  });
  const verifications = [];
  const prepared = await prepareBrowserAuditArtifact({
    plan,
    async buildHostedArtifactImpl() {
      throw new Error("finalized input must not rebuild a held artifact");
    },
    async verifyHostedArtifactImpl(options) {
      verifications.push(options);
    },
  });
  assert.equal(prepared.mode, "finalized");
  assert.equal(prepared.receipt.fullPageSha256, receipt.fullPageSha256);
  assert.deepEqual(verifications, [{
    root: ROOT,
    output: path.join(outputRoot, "hosted"),
    privacyV3Render: {
      mode: "final",
      version: VERSION,
      effectiveAt: EFFECTIVE_AT,
      ownerApproval: PRIVACY_V3_OWNER_APPROVAL,
    },
  }]);

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
});
