import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildHostedArtifact } from "../build-hosted.mjs";
import {
  JOINT_LEGAL_V4_CONTENT,
  JOINT_LEGAL_V4_DOCUMENT_IDS,
  JOINT_LEGAL_V4_RELEASE,
  assertJointLegalV4Held,
} from "../hosted-truth/joint-legal-v4-artifacts.mjs";
import {
  createPrivacyV4RenderPlan,
  createWebsiteTermsV4RenderPlan,
} from "../hosted-truth/joint-legal-v4-render.mjs";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const RELEASE_ROOT = path.join(
  ROOT,
  "ops/releases/joint-legal-v4-2026-08-09T214211Z",
);
const RECEIPT_SHA256 =
  "e31102f1b4b5603b00f404b2b0e1ee1f57cc73cab94b2f0f5f163f1f43d255c9";
const V3_ARTIFACTS = Object.freeze([
  Object.freeze({
    file: "ops/releases/joint-legal-v3-2026-08-09T152559Z/hosted/legal/privacy/index.html",
    sha256: "5713fd6776c6ba41dbbac1b4d1ac0d9f1b6857ba01128e5d74c4f3c5287a4967",
    byteCount: 29_610,
  }),
  Object.freeze({
    file: "ops/releases/joint-legal-v3-2026-08-09T152559Z/hosted/legal/website-terms/index.html",
    sha256: "b179ee8b6ed713b6b19b20daf320e84a9e89f2ac166504942919f8c4e280a602",
    byteCount: 26_171,
  }),
  Object.freeze({
    file: "ops/releases/joint-legal-v3-2026-08-09T152559Z/hosted/legal/index.html",
    sha256: "1f8babe61f13ce74085b23027a7e30bcfb8191bf36d2e0de4166c441acf145c8",
    byteCount: 4_980,
  }),
]);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("joint Legal V4 owns the exact owner-approved production tuple", () => {
  assert.deepEqual(JOINT_LEGAL_V4_DOCUMENT_IDS, {
    privacy: "00000000-0000-4000-8000-000000000049",
    product: "00000000-0000-4000-8000-000000000105",
    website: "00000000-0000-4000-8000-000000000106",
  });
  assert.deepEqual(JOINT_LEGAL_V4_RELEASE, {
    state: "finalized",
    privacyVersion: "SS-HOSTED-PRIVACY-2026-08-09-V4",
    privacySha256: "2f9edca746f9bffc1dc4b6745613ae42c04813a3ac94cd2e8432e964cfa36e99",
    privacyByteCount: 31_451,
    privacyArtifactUri:
      "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V4/",
    websiteTermsVersion: "SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4",
    websiteTermsSha256: "4c937f54ae5805a15a9ae835d0266973fb8e8117065dbfce2030ff3f189ff642",
    websiteTermsByteCount: 26_215,
    websiteTermsArtifactUri:
      "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4/",
    effectiveAt: "2026-08-09T21:42:11.000Z",
    authorityDigest: "ba2871701541ca78e29a9fef313a3e335e7fed571590eb319667c763a7cd3968",
  });
  assert.throws(
    () => assertJointLegalV4Held(),
    /release constants must remain held/u,
  );
});

test("retained V4 receipt binds migration, runtime environment, and exact artifacts", async () => {
  const receiptBytes = await readFile(
    path.join(RELEASE_ROOT, "joint-legal-v4-release-constants.json"),
  );
  assert.equal(digest(receiptBytes), RECEIPT_SHA256);
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.state, "owner-approved-finalization");
  assert.equal(receipt.published, false);
  assert.equal(receipt.integrationRequired, true);
  assert.equal(receipt.effectiveAt, JOINT_LEGAL_V4_RELEASE.effectiveAt);
  assert.equal(receipt.authorityDigest, JOINT_LEGAL_V4_RELEASE.authorityDigest);
  assert.deepEqual(receipt.documentBindings, [
    { kind: "privacy", id: JOINT_LEGAL_V4_DOCUMENT_IDS.privacy },
    { kind: "product", id: JOINT_LEGAL_V4_DOCUMENT_IDS.product },
    { kind: "website", id: JOINT_LEGAL_V4_DOCUMENT_IDS.website },
  ]);

  const [migration, environmentExample] = await Promise.all([
    readFile(path.join(
      ROOT,
      "server/data-plane/supabase/migrations/202608090105_hosted_joint_legal_v4_authority.sql",
    ), "utf8"),
    readFile(path.join(ROOT, "ops/hosted.env.example"), "utf8"),
  ]);
  for (const value of Object.values(JOINT_LEGAL_V4_RELEASE).filter(
    (candidate) => typeof candidate === "string" && candidate !== "finalized",
  )) assert.ok(migration.includes(value), value);
  for (const [name, value] of Object.entries(receipt.environment)) {
    assert.ok(environmentExample.includes(`${name}=${value}`), name);
  }
  for (const artifact of receipt.artifacts) {
    const bytes = await readFile(path.join(RELEASE_ROOT, artifact.file));
    assert.equal(bytes.byteLength, artifact.byteCount, artifact.role);
    assert.equal(digest(bytes), artifact.sha256, artifact.role);
  }
});

test("V4 release states the bounded Cloudflare architecture and exact exclusions", async () => {
  const [privacy, terms, center] = await Promise.all([
    readFile(path.join(RELEASE_ROOT, "hosted/legal/privacy/index.html"), "utf8"),
    readFile(path.join(RELEASE_ROOT, "hosted/legal/website-terms/index.html"), "utf8"),
    readFile(path.join(RELEASE_ROOT, "hosted/legal/index.html"), "utf8"),
  ]);
  for (const truth of [
    "authoritative DNS provider and its HTTPS reverse-proxy and security edge",
    "HTTPS connection terminates at Cloudflare",
    "encrypted, outbound-only Cloudflare Tunnel connection to the Dell origin",
    "cookies and session data carried in a request",
    "does not use Cloudflare advertising, Cloudflare Web Analytics, Workers, email routing, Turnstile",
    "does not promise that every static asset or Cloudflare security record is uncached or kept for a fixed period",
  ]) assert.ok(privacy.includes(truth), truth);
  for (const truth of [
    "The standard Website assessment costs $200",
    "Card and Card Plus are paid in full before work starts.",
    "The included 30-day workmanship correction window",
    "A later Alakazam release requires a separately approved later privacy notice",
  ]) assert.ok(terms.includes(truth), truth);
  assert.ok(center.includes(
    "Current documents: SS-HOSTED-PRIVACY-2026-08-09-V4 and SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4",
  ));
  for (const source of [privacy, terms, center]) {
    assert.doesNotMatch(source, /noindex|review only|CONTENT-TEMPLATE|UNSEALED/u);
  }
});

test("V3 release evidence remains byte-identical after V4 finalization", async () => {
  for (const artifact of V3_ARTIFACTS) {
    const bytes = await readFile(path.join(ROOT, artifact.file));
    assert.equal(bytes.byteLength, artifact.byteCount);
    assert.equal(digest(bytes), artifact.sha256);
  }
  assert.equal(JOINT_LEGAL_V4_CONTENT.privacy.reviewSha256,
    "eeec62ecb84fe42c8a8e3c7fa207f8b35479fceab998db925d49de4bf64126db");
  assert.equal(JOINT_LEGAL_V4_CONTENT.websiteTerms.reviewSha256,
    "986e4f3cb73b522cea11557f5a5fa819ecf050d98daa93f875264c1a692e13e4");
});

test("hosted builder consumes only the retained exact V4 finalization", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "sitesourcery-joint-legal-v4-release-"));
  try {
    const output = path.join(temporary, "hosted");
    await buildHostedArtifact({
      root: ROOT,
      output,
      jointLegalV4FinalizationRoot: RELEASE_ROOT,
    });
    for (const [relative, sha256, byteCount] of [
      ["legal/privacy/index.html", JOINT_LEGAL_V4_RELEASE.privacySha256, 31_451],
      [
        `legal/privacy/versions/${JOINT_LEGAL_V4_RELEASE.privacyVersion}/index.html`,
        JOINT_LEGAL_V4_RELEASE.privacySha256,
        31_451,
      ],
      ["legal/website-terms/index.html", JOINT_LEGAL_V4_RELEASE.websiteTermsSha256, 26_215],
      [
        `legal/website-terms/versions/${JOINT_LEGAL_V4_RELEASE.websiteTermsVersion}/index.html`,
        JOINT_LEGAL_V4_RELEASE.websiteTermsSha256,
        26_215,
      ],
    ]) {
      const bytes = await readFile(path.join(output, relative));
      assert.equal(bytes.byteLength, byteCount, relative);
      assert.equal(digest(bytes), sha256, relative);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("review and content-seal tooling fail closed after production finalization", () => {
  assert.throws(
    () => createPrivacyV4RenderPlan({ mode: "review" }),
    /release constants must remain held/u,
  );
  assert.throws(
    () => createWebsiteTermsV4RenderPlan({ mode: "content-template" }),
    /release constants must remain held/u,
  );
});
