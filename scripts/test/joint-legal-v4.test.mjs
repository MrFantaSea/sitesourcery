import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { finalizeJointLegalV4 } from
  "../hosted-truth/finalize-joint-legal-v4.mjs";
import {
  JOINT_LEGAL_V4_CONTENT,
  JOINT_LEGAL_V4_DOCUMENT_IDS,
  JOINT_LEGAL_V4_RELEASE,
  assertJointLegalV4Held,
} from "../hosted-truth/joint-legal-v4-artifacts.mjs";
import {
  PRIVACY_V4_VERSION_TOKEN,
  WEBSITE_TERMS_V4_VERSION_TOKEN,
  createPrivacyV4RenderPlan,
  createWebsiteTermsV4RenderPlan,
  renderPrivacyV4,
  renderWebsiteTermsV4,
} from "../hosted-truth/joint-legal-v4-render.mjs";
import { renderJointLegalV4Review } from
  "../hosted-truth/render-joint-legal-v4-review.mjs";
import {
  JOINT_LEGAL_V4_APPROVAL_SCHEMA,
  JOINT_LEGAL_V4_APPROVAL_STATEMENT,
  sealJointLegalV4Content,
  validateJointLegalV4ContentSeal,
} from "../hosted-truth/seal-joint-legal-v4-content.mjs";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
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

test("held joint legal V4 has new IDs and no production tuple", () => {
  assert.equal(assertJointLegalV4Held(), true);
  assert.equal(JOINT_LEGAL_V4_CONTENT.state, "content-approved-release-held");
  assert.deepEqual(JOINT_LEGAL_V4_DOCUMENT_IDS, {
    privacy: "00000000-0000-4000-8000-000000000049",
    product: "00000000-0000-4000-8000-000000000105",
    website: "00000000-0000-4000-8000-000000000106",
  });
  assert.equal(JOINT_LEGAL_V4_RELEASE.state, "unsealed");
  assert.ok(Object.entries(JOINT_LEGAL_V4_RELEASE).every(
    ([key, value]) => key === "state" || value === null,
  ));
});

test("V4 review and template identities are exact and preserve V3 source bytes", async () => {
  for (const artifact of V3_ARTIFACTS) {
    const bytes = await readFile(path.join(ROOT, artifact.file));
    assert.equal(bytes.byteLength, artifact.byteCount);
    assert.equal(digest(bytes), artifact.sha256);
  }
  for (const [kind, render, createPlan, token] of [
    ["privacy", renderPrivacyV4, createPrivacyV4RenderPlan, PRIVACY_V4_VERSION_TOKEN],
    ["websiteTerms", renderWebsiteTermsV4, createWebsiteTermsV4RenderPlan, WEBSITE_TERMS_V4_VERSION_TOKEN],
  ]) {
    const review = Buffer.from(render({ root: ROOT, plan: createPlan({ mode: "review" }) }));
    const template = Buffer.from(render({
      root: ROOT,
      plan: createPlan({ mode: "content-template" }),
    }));
    assert.equal(digest(review), JOINT_LEGAL_V4_CONTENT[kind].reviewSha256);
    assert.equal(review.byteLength, JOINT_LEGAL_V4_CONTENT[kind].reviewByteCount);
    assert.equal(digest(template), JOINT_LEGAL_V4_CONTENT[kind].templateSha256);
    assert.equal(template.byteLength, JOINT_LEGAL_V4_CONTENT[kind].templateByteCount);
    assert.ok(review.includes(Buffer.from("noindex,nofollow")));
    assert.ok(template.includes(Buffer.from(token)));
  }
});

test("Privacy V4 states the bounded Cloudflare architecture and exact exclusions", () => {
  const privacy = renderPrivacyV4({
    root: ROOT,
    plan: createPrivacyV4RenderPlan({ mode: "content-template" }),
  });
  for (const truth of [
    "authoritative DNS provider and its HTTPS reverse-proxy and security edge",
    "HTTPS connection terminates at Cloudflare",
    "encrypted, outbound-only Cloudflare Tunnel connection to the Dell origin",
    "cookies and session data carried in a request",
    "does not use Cloudflare advertising, Cloudflare Web Analytics, Workers, email routing, Turnstile",
    "does not promise that every static asset or Cloudflare security record is uncached or kept for a fixed period",
  ]) assert.ok(privacy.includes(truth), truth);
  assert.ok(privacy.includes(
    "Alakazam, Care plans, customer-domain purchase, Site Sourcery-managed publication, and Responder service remain held",
  ));
});

test("Website Terms V4 carries commercial terms forward without stale Privacy V4 identity", () => {
  const terms = renderWebsiteTermsV4({
    root: ROOT,
    plan: createWebsiteTermsV4RenderPlan({ mode: "content-template" }),
  });
  for (const truth of [
    "The standard Website assessment costs $200",
    "Card and Card Plus are paid in full before work starts.",
    "The included 30-day workmanship correction window",
    "A later Alakazam release requires a separately approved later privacy notice",
  ]) assert.ok(terms.includes(truth), truth);
  assert.equal(terms.includes("requires its separately approved Privacy V4"), false);
});

test("V4 review and content seal stay outside the repository with null release fields", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "sitesourcery-joint-legal-v4-test-"));
  try {
    const review = await renderJointLegalV4Review({
      root: ROOT,
      outputRoot: path.join(temporary, "review"),
    });
    assert.equal(review.receipt.release, null);
    const approval = {
      schema: JOINT_LEGAL_V4_APPROVAL_SCHEMA,
      statement: JOINT_LEGAL_V4_APPROVAL_STATEMENT,
      approvalReference: "test-only-exact-review-binding",
      approvedAt: "2026-08-09T18:30:00.000Z",
      documents: {
        privacy: {
          sha256: JOINT_LEGAL_V4_CONTENT.privacy.reviewSha256,
          byteCount: JOINT_LEGAL_V4_CONTENT.privacy.reviewByteCount,
        },
        websiteTerms: {
          sha256: JOINT_LEGAL_V4_CONTENT.websiteTerms.reviewSha256,
          byteCount: JOINT_LEGAL_V4_CONTENT.websiteTerms.reviewByteCount,
        },
      },
    };
    const sealed = await sealJointLegalV4Content({
      root: ROOT,
      outputRoot: path.join(temporary, "seal"),
      approvalReceipt: approval,
    });
    assert.equal(validateJointLegalV4ContentSeal(sealed.receipt).deployable, false);
    assert.ok(Object.values(sealed.receipt.release).every((value) => value === null));
    await assert.rejects(
      finalizeJointLegalV4({
        root: ROOT,
        outputRoot: path.join(temporary, "final"),
        contentSeal: sealed.receipt,
      }),
      /requires exact owner release approval/u,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
