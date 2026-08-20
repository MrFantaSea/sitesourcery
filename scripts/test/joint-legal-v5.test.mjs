import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  JOINT_LEGAL_V5_CONTENT,
  JOINT_LEGAL_V5_RELEASE,
  assertJointLegalV5Held,
} from "../hosted-truth/joint-legal-v5-artifacts.mjs";
import {
  JOINT_LEGAL_V5_OWNER_APPROVAL,
  createPrivacyV5RenderPlan,
  createWebsiteTermsV5RenderPlan,
  normalizePrivacyV5Final,
  normalizeWebsiteTermsV5Final,
  renderLegalCenterV5,
  renderPrivacyV5,
  renderWebsiteTermsV5,
} from "../hosted-truth/joint-legal-v5-render.mjs";
import {
  createJointLegalV5ReviewBundle,
} from "../hosted-truth/render-joint-legal-v5-review.mjs";
import {
  JOINT_LEGAL_V5_APPROVAL_SCHEMA,
  JOINT_LEGAL_V5_APPROVAL_STATEMENT,
  validateJointLegalV5Approval,
} from "../hosted-truth/seal-joint-legal-v5-content.mjs";
import { finalizeJointLegalV5 } from
  "../hosted-truth/finalize-joint-legal-v5.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REVIEW_ROOT = path.join(
  ROOT,
  "ops/releases/final-successor-20260811/joint-legal-v5-review",
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("Joint Legal V5 release authority remains entirely unsealed", () => {
  assert.equal(assertJointLegalV5Held(), true);
  assert.equal(JOINT_LEGAL_V5_RELEASE.state, "unsealed");
  assert.ok(Object.entries(JOINT_LEGAL_V5_RELEASE).every(
    ([key, value]) => key === "state" || value === null,
  ));
  assert.throws(
    () => assertJointLegalV5Held({
      ...JOINT_LEGAL_V5_RELEASE,
      privacyVersion: "SS-HOSTED-PRIVACY-2026-08-20-V5",
    }),
    /must remain unsealed/u,
  );
});

test("review bundle is deterministic, exact, noindex, and non-effective", async () => {
  const bundle = createJointLegalV5ReviewBundle({ root: ROOT });
  assert.equal(bundle.manifest.state, "review-candidate-unapproved");
  assert.equal(bundle.manifest.effective, false);
  assert.equal(bundle.manifest.published, false);
  assert.equal(bundle.manifest.deployable, false);
  assert.equal(bundle.manifest.ownerApproved, false);
  assert.equal(bundle.manifest.release, null);
  for (const kind of ["center", "privacy", "websiteTerms"]) {
    const expected = JOINT_LEGAL_V5_CONTENT[kind];
    assert.equal(sha256(bundle.bytes[kind]), expected.reviewSha256);
    assert.equal(bundle.bytes[kind].byteLength, expected.reviewByteCount);
    const stored = await readFile(path.join(
      REVIEW_ROOT,
      bundle.manifest.artifacts[kind].file,
    ));
    assert.deepEqual(stored, bundle.bytes[kind]);
    const html = stored.toString("utf8");
    assert.match(html, /noindex,nofollow,noarchive/u);
    assert.match(html, /review-only-nondeployable/u);
    assert.match(html, /data-joint-legal-v5-review-state="unsealed"/u);
    assert.doesNotMatch(
      html,
      /SS-HOSTED-(?:PRIVACY|WEBSITE-TERMS)-\d{4}-\d{2}-\d{2}-V5/u,
    );
  }
});

test("V5 binds the selected catalog and complete held/effect truth", () => {
  const privacyPlan = createPrivacyV5RenderPlan({ mode: "review" });
  const termsPlan = createWebsiteTermsV5RenderPlan({ mode: "review" });
  const privacy = renderPrivacyV5({ root: ROOT, plan: privacyPlan });
  const terms = renderWebsiteTermsV5({ root: ROOT, plan: termsPlan });
  const center = renderLegalCenterV5({
    root: ROOT,
    privacyPlan,
    termsPlan,
  });
  for (const html of [privacy, terms, center]) {
    assert.match(html, /\$350 Website assessment/u);
    assert.doesNotMatch(html, /\$200 Website assessment|standard \$200 assessment/u);
  }
  assert.match(privacy, /Operational logs are normally retained for 90 days/u);
  assert.match(privacy, /support records for two years/u);
  assert.match(privacy, /normally retained for seven years/u);
  assert.match(privacy, /Spaceship registrar mutations and Twilio telephony or messaging remain held/u);
  assert.match(terms, /Card \$350, Card Plus \$600, Site \$1,000/u);
  assert.match(terms, /Signature \$2,400, Flagship \$3,600/u);
  assert.match(terms, /Host \$25 per month, Care Lite \$69 per month/u);
  assert.match(terms, /\$300 one-time setup amount and a separate \$250 monthly amount/u);
  assert.match(terms, /\$350 gross start, \$350 credit, and \$0 customer subtotal/u);
  assert.match(terms, /no Checkout, PaymentIntent, Charge, or payment receipt/u);
  assert.match(terms, /disabled_by_owner/u);
  assert.match(terms, /Ownership of agreed client deliverables transfers only after final payment/u);
  assert.match(terms, /all sales are final and all payments are non-refundable/u);
  assert.match(terms, /no refund, return, cancellation, cash redemption, or replacement credit/u);
  assert.match(terms, /assessment payment is final and non-refundable once assessment work begins/u);
  assert.match(terms, /Each Custom payment is final and non-refundable once the work/u);
  assert.match(terms, /defend, indemnify, and hold harmless Desiderata Labs LLC/u);
  assert.match(terms, /total aggregate liability for all claims arising from or related to a specific affected purchase/u);
  assert.match(terms, /governed by New Jersey law/u);
  assert.match(terms, /state court located in Gloucester County/u);
  assert.match(terms, /Nothing in these terms excludes liability or a right that applicable law does not permit/u);
});

test("content templates are exact but contain no release values", () => {
  const privacyPlan = createPrivacyV5RenderPlan({ mode: "content-template" });
  const termsPlan = createWebsiteTermsV5RenderPlan({ mode: "content-template" });
  const rendered = {
    center: Buffer.from(renderLegalCenterV5({
      root: ROOT,
      privacyPlan,
      termsPlan,
    })),
    privacy: Buffer.from(renderPrivacyV5({ root: ROOT, plan: privacyPlan })),
    websiteTerms: Buffer.from(renderWebsiteTermsV5({
      root: ROOT,
      plan: termsPlan,
    })),
  };
  for (const [kind, bytes] of Object.entries(rendered)) {
    assert.equal(sha256(bytes), JOINT_LEGAL_V5_CONTENT[kind].templateSha256);
    assert.equal(bytes.byteLength, JOINT_LEGAL_V5_CONTENT[kind].templateByteCount);
    assert.doesNotMatch(bytes.toString("utf8"), /noindex,nofollow/u);
  }
});

test("final rendering requires exact owner values and normalizes to the sealed templates", () => {
  assert.throws(
    () => createPrivacyV5RenderPlan({
      mode: "final",
      version: "SS-HOSTED-PRIVACY-2026-08-20-V5",
      effectiveAt: "2026-08-21T04:00:00.000Z",
      ownerApproval: "not-approved",
    }),
    /exact owner-approved release values/u,
  );
  const privacyPlan = createPrivacyV5RenderPlan({
    mode: "final",
    version: "SS-HOSTED-PRIVACY-2026-08-20-V5",
    effectiveAt: "2026-08-21T04:00:00.000Z",
    ownerApproval: JOINT_LEGAL_V5_OWNER_APPROVAL,
  });
  const termsPlan = createWebsiteTermsV5RenderPlan({
    mode: "final",
    version: "SS-HOSTED-WEBSITE-TERMS-2026-08-20-V5",
    effectiveAt: "2026-08-21T04:00:00.000Z",
    ownerApproval: JOINT_LEGAL_V5_OWNER_APPROVAL,
  });
  assert.equal(privacyPlan.effectiveLabel, "Effective August 21, 2026");
  assert.equal(termsPlan.effectiveLabel, "Effective August 21, 2026");
  assert.throws(
    () => createPrivacyV5RenderPlan({
      mode: "final",
      version: "SS-HOSTED-PRIVACY-2026-08-20-V5",
      effectiveAt: "2026-08-22T04:00:00.000Z",
      ownerApproval: JOINT_LEGAL_V5_OWNER_APPROVAL,
    }),
    /exact owner-approved release values/u,
  );
  const privacy = renderPrivacyV5({ root: ROOT, plan: privacyPlan });
  const terms = renderWebsiteTermsV5({ root: ROOT, plan: termsPlan });
  const privacyTemplate = Buffer.from(normalizePrivacyV5Final(
    privacy,
    privacyPlan,
  ));
  const termsTemplate = Buffer.from(normalizeWebsiteTermsV5Final(
    terms,
    termsPlan,
  ));
  assert.equal(
    sha256(privacyTemplate),
    JOINT_LEGAL_V5_CONTENT.privacy.templateSha256,
  );
  assert.equal(
    sha256(termsTemplate),
    JOINT_LEGAL_V5_CONTENT.websiteTerms.templateSha256,
  );
  assert.doesNotMatch(privacy, /noindex,nofollow/u);
  assert.doesNotMatch(terms, /noindex,nofollow/u);
});

test("content approval binds every exact review artifact", () => {
  const approval = {
    schema: JOINT_LEGAL_V5_APPROVAL_SCHEMA,
    statement: JOINT_LEGAL_V5_APPROVAL_STATEMENT,
    approvedAt: "2026-08-20T12:00:00.000Z",
    approvalReference: "owner-review-example",
    artifacts: Object.fromEntries(
      ["center", "privacy", "websiteTerms"].map((kind) => [kind, {
        sha256: JOINT_LEGAL_V5_CONTENT[kind].reviewSha256,
        byteCount: JOINT_LEGAL_V5_CONTENT[kind].reviewByteCount,
      }]),
    ),
  };
  assert.deepEqual(validateJointLegalV5Approval(approval), approval);
  assert.throws(
    () => validateJointLegalV5Approval({
      ...approval,
      artifacts: {
        ...approval.artifacts,
        privacy: { ...approval.artifacts.privacy, byteCount: 1 },
      },
    }),
    /exact review bytes/u,
  );
});

test("finalization remains fail-closed without the separate owner gate", async () => {
  await assert.rejects(
    finalizeJointLegalV5({}),
    /exact owner release approval/u,
  );
});
