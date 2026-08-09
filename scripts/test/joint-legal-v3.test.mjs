import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../../server/hosted/security.mjs";
import { buildHostedArtifact } from "../build-hosted.mjs";
import { JOINT_LEGAL_V3_CONTENT, JOINT_LEGAL_V3_RELEASE } from
  "../hosted-truth/joint-legal-v3-artifacts.mjs";
import {
  createWebsiteTermsV3RenderPlan,
  normalizeWebsiteTermsV3Final,
  renderLegalCenterV3,
  renderWebsiteTermsV3,
} from "../hosted-truth/joint-legal-v3-render.mjs";
import {
  JOINT_LEGAL_V3_APPROVAL_SCHEMA,
  JOINT_LEGAL_V3_APPROVAL_STATEMENT,
  JOINT_LEGAL_V3_CONTENT_SEAL_SCHEMA,
  validateJointLegalV3ContentSeal,
} from "../hosted-truth/seal-joint-legal-v3-content.mjs";
import {
  createPrivacyV3RenderPlan,
  PRIVACY_V3_OWNER_APPROVAL,
} from "../hosted-truth/privacy-v3-render.mjs";
import {
  finalizeJointLegalV3,
  JOINT_LEGAL_V3_OWNER_APPROVAL,
} from "../hosted-truth/finalize-joint-legal-v3.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function createJointContentSeal() {
  const approvalReceipt = {
    approvedAt: "2026-08-09T12:52:46.000Z",
    approvalReference: "owner-delegated-chat-2026-08-09-joint-legal-v3-go-live",
    documents: {
      privacy: {
        byteCount: JOINT_LEGAL_V3_CONTENT.privacy.reviewByteCount,
        sha256: JOINT_LEGAL_V3_CONTENT.privacy.reviewSha256,
      },
      websiteTerms: {
        byteCount: JOINT_LEGAL_V3_CONTENT.websiteTerms.reviewByteCount,
        sha256: JOINT_LEGAL_V3_CONTENT.websiteTerms.reviewSha256,
      },
    },
    schema: JOINT_LEGAL_V3_APPROVAL_SCHEMA,
    statement: JOINT_LEGAL_V3_APPROVAL_STATEMENT,
  };
  const body = {
    schema: JOINT_LEGAL_V3_CONTENT_SEAL_SCHEMA,
    state: "content-approved-unreleased",
    published: false,
    deployable: false,
    releaseFinalizationRequired: true,
    approvalReceipt,
    approvalReceiptSha256: sha256(canonicalJson(approvalReceipt)),
    artifacts: {
      privacy: {
        review: {
          sha256: JOINT_LEGAL_V3_CONTENT.privacy.reviewSha256,
          byteCount: JOINT_LEGAL_V3_CONTENT.privacy.reviewByteCount,
        },
        template: {
          sha256: JOINT_LEGAL_V3_CONTENT.privacy.templateSha256,
          byteCount: JOINT_LEGAL_V3_CONTENT.privacy.templateByteCount,
        },
      },
      websiteTerms: {
        review: {
          sha256: JOINT_LEGAL_V3_CONTENT.websiteTerms.reviewSha256,
          byteCount: JOINT_LEGAL_V3_CONTENT.websiteTerms.reviewByteCount,
        },
        template: {
          sha256: JOINT_LEGAL_V3_CONTENT.websiteTerms.templateSha256,
          byteCount: JOINT_LEGAL_V3_CONTENT.websiteTerms.templateByteCount,
        },
      },
    },
    release: {
      privacyVersion: null, privacySha256: null, privacyByteCount: null,
      privacyArtifactUri: null, websiteTermsVersion: null,
      websiteTermsSha256: null, websiteTermsByteCount: null,
      websiteTermsArtifactUri: null, effectiveAt: null, authorityDigest: null,
    },
  };
  return { ...body, contentSealSha256: sha256(canonicalJson(body)) };
}

test("joint V3 candidate owns content identities but no release tuple", () => {
  assert.equal(JOINT_LEGAL_V3_CONTENT.published, false);
  assert.equal(JOINT_LEGAL_V3_CONTENT.deployable, false);
  assert.deepEqual(JOINT_LEGAL_V3_RELEASE, {
    state: "unsealed",
    privacyVersion: null,
    privacySha256: null,
    privacyByteCount: null,
    privacyArtifactUri: null,
    websiteTermsVersion: null,
    websiteTermsSha256: null,
    websiteTermsByteCount: null,
    websiteTermsArtifactUri: null,
    effectiveAt: null,
    authorityDigest: null,
  });
});

test("Website Terms V3 review and normalized template bind exact approved bytes", () => {
  for (const mode of ["review", "content-template"]) {
    const bytes = Buffer.from(renderWebsiteTermsV3({
      root: ROOT,
      plan: createWebsiteTermsV3RenderPlan({ mode }),
    }));
    const role = mode === "review" ? "review" : "template";
    assert.equal(bytes.byteLength, JOINT_LEGAL_V3_CONTENT.websiteTerms[`${role}ByteCount`]);
    assert.equal(sha256(bytes), JOINT_LEGAL_V3_CONTENT.websiteTerms[`${role}Sha256`]);
    assert.match(bytes.toString(), /The standard Website assessment costs \$200/u);
    assert.match(bytes.toString(), /automatic[- ]tax/u);
    assert.match(bytes.toString(), /A later Alakazam release requires its separately approved Privacy V4/u);
  }
});

test("one exact UTC tuple finalizes both pages and normalizes back to the sealed Terms template", () => {
  const effectiveAt = "2099-12-31T00:00:00.000Z";
  const privacyPlan = createPrivacyV3RenderPlan({
    mode: "final",
    version: "SS-HOSTED-PRIVACY-2099-12-31-V3",
    effectiveAt,
    ownerApproval: PRIVACY_V3_OWNER_APPROVAL,
  });
  const termsPlan = createWebsiteTermsV3RenderPlan({
    mode: "final",
    version: "SS-HOSTED-WEBSITE-TERMS-2099-12-31-V3",
    effectiveAt,
    ownerApproval: JOINT_LEGAL_V3_OWNER_APPROVAL,
  });
  const finalTerms = renderWebsiteTermsV3({ root: ROOT, plan: termsPlan });
  const normalized = Buffer.from(normalizeWebsiteTermsV3Final(finalTerms, termsPlan));
  assert.equal(sha256(normalized), JOINT_LEGAL_V3_CONTENT.websiteTerms.templateSha256);
  const center = renderLegalCenterV3({ root: ROOT, privacyPlan, termsPlan });
  assert.match(center, /Current documents: SS-HOSTED-PRIVACY-2099-12-31-V3 and SS-HOSTED-WEBSITE-TERMS-2099-12-31-V3/u);
  assert.doesNotMatch(center, /unsealed|truth-slot/u);
  assert.throws(() => createWebsiteTermsV3RenderPlan({
    mode: "final",
    version: "SS-HOSTED-WEBSITE-TERMS-2099-12-30-V3",
    effectiveAt,
    ownerApproval: JOINT_LEGAL_V3_OWNER_APPROVAL,
  }), /matching version and canonical UTC/u);
});

test("content seal binds both reviews and templates while rejecting release facts", () => {
  const seal = createJointContentSeal();
  const { contentSealSha256: ignored, ...body } = seal;
  assert.ok(ignored);
  assert.equal(validateJointLegalV3ContentSeal(seal).published, false);
  const releasedBody = { ...body, release: { ...body.release, effectiveAt: "2099-12-31T00:00:00.000Z" } };
  assert.throws(() => validateJointLegalV3ContentSeal({
    ...releasedBody,
    contentSealSha256: sha256(canonicalJson(releasedBody)),
  }), /contains release constants/u);
});

test("standard hosted builder consumes and verifies all five finalized joint V3 artifacts", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "sitesourcery-joint-v3-builder-"),
  );
  const finalizedRoot = path.join(temporaryRoot, "finalized");
  const candidateRoot = path.join(temporaryRoot, "candidate");
  try {
    const { receipt } = await finalizeJointLegalV3({
      root: ROOT,
      outputRoot: finalizedRoot,
      privacyVersion: "SS-HOSTED-PRIVACY-2099-12-31-V3",
      websiteTermsVersion: "SS-HOSTED-WEBSITE-TERMS-2099-12-31-V3",
      effectiveAt: "2099-12-31T00:00:00.000Z",
      ownerApproval: JOINT_LEGAL_V3_OWNER_APPROVAL,
      contentSeal: createJointContentSeal(),
    });
    await buildHostedArtifact({
      root: ROOT,
      output: candidateRoot,
      jointLegalV3FinalizationRoot: finalizedRoot,
    });
    for (const artifact of receipt.artifacts) {
      const bytes = await readFile(
        path.join(candidateRoot, artifact.file.slice("hosted/".length)),
      );
      assert.equal(bytes.byteLength, artifact.byteCount);
      assert.equal(sha256(bytes), artifact.sha256);
    }
    assert.equal(JOINT_LEGAL_V3_RELEASE.effectiveAt, null);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("finalization stops before any write without the exact release approval", async () => {
  await assert.rejects(finalizeJointLegalV3({
    outputRoot: "/private/tmp/must-not-create-joint-legal-v3-test",
    ownerApproval: "not-approved",
  }), /exact owner release approval/u);
});
