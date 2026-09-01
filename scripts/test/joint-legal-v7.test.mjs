import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hostedFileAllowlist } from "../build-hosted.mjs";
import { publicFileAllowlist } from "../build-pages.mjs";
import {
  JOINT_LEGAL_V7_REVIEW_SCHEMA,
  PRIVACY_V7_REVIEW_VERSION,
  WEBSITE_TERMS_V7_REVIEW_VERSION,
  assertLegalCenterV7Review,
  assertPrivacyV7Review,
  assertWebsiteTermsV7Review,
  createJointLegalV7ReviewBundle,
} from "../hosted-truth/joint-legal-v7-review.mjs";
import { writeJointLegalV7Review } from
  "../hosted-truth/render-joint-legal-v7-review.mjs";
import { createPagesJointLegalV5Plan } from
  "../hosted-truth/pages-legal-v5.mjs";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const IDENTITIES = Object.freeze([
  Object.freeze({
    role: "legal-center-review",
    file: "legal/index.html",
    sha256: "a090beaef267c8d596283ecfefc211ef00bf274dcadaf003fa4a7aefad7c01e7",
    byteCount: 4925,
  }),
  Object.freeze({
    role: "privacy-review",
    file: "legal/privacy/index.html",
    sha256: "fd5dcaaa93f8952cd40413d0b461f901b7b017101c947cf919c17012d448ef0d",
    byteCount: 24318,
  }),
  Object.freeze({
    role: "website-terms-review",
    file: "legal/website-terms/index.html",
    sha256: "91ab95b657046cb8a8813de1d94bcdeb50461ae738bb443fcfd83ebc3ac8b05e",
    byteCount: 27537,
  }),
]);

test("Legal V7 is one deterministic noindex review with no release authority", async (t) => {
  const first = createJointLegalV7ReviewBundle({ root: ROOT });
  const second = createJointLegalV7ReviewBundle({ root: ROOT });
  assert.equal(first.schema, JOINT_LEGAL_V7_REVIEW_SCHEMA);
  assert.equal(first.state, "review-candidate-unapproved");
  assert.equal(first.published, false);
  assert.equal(first.deployable, false);
  assert.equal(first.privacyVersion, null);
  assert.equal(first.websiteTermsVersion, null);
  assert.equal(first.effectiveAt, null);
  const identities = (bundle) => bundle.artifacts.map(
    ({ role, file, sha256, byteCount }) => ({ role, file, sha256, byteCount }),
  );
  assert.deepEqual(identities(first), identities(second));
  assert.deepEqual(identities(first), IDENTITIES);

  const center = first.artifacts[0].bytes;
  const privacy = first.artifacts[1].bytes;
  const terms = first.artifacts[2].bytes;
  assert.equal(assertLegalCenterV7Review(center), true);
  assert.equal(assertPrivacyV7Review(privacy), true);
  assert.equal(assertWebsiteTermsV7Review(terms), true);
  for (const source of [center, privacy, terms]) {
    assert.match(source, /noindex,nofollow,noarchive/u);
    assert.match(source, /review-only-nondeployable/u);
    assert.match(source, /Not effective — joint legal V7 review only/u);
    assert.doesNotMatch(source, /\$5(?!\d)|\bheld\b|inquiry[ -]only/iu);
    assert.doesNotMatch(source, /coming soon|not open yet/iu);
    assert.doesNotMatch(
      source,
      /SS-HOSTED-(?:PRIVACY|WEBSITE-TERMS)-\d{4}-\d{2}-\d{2}-V7/u,
    );
  }
  assert.match(privacy, new RegExp(PRIVACY_V7_REVIEW_VERSION, "u"));
  assert.match(terms, new RegExp(WEBSITE_TERMS_V7_REVIEW_VERSION, "u"));

  const temporary = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-legal-v7-"));
  t.after(async () => rm(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, "review");
  const written = await writeJointLegalV7Review({ root: ROOT, output });
  assert.equal(written.output, output);
  const manifest = JSON.parse(await readFile(
    path.join(output, "joint-legal-v7-review-manifest.json"),
    "utf8",
  ));
  assert.equal(manifest.schema, JOINT_LEGAL_V7_REVIEW_SCHEMA);
  assert.equal(manifest.published, false);
  assert.equal(manifest.deployable, false);
  assert.equal(manifest.privacyVersion, null);
  assert.equal(manifest.websiteTermsVersion, null);
  assert.equal(manifest.effectiveAt, null);
  assert.deepEqual(manifest.artifacts, IDENTITIES);
  for (const artifact of first.artifacts) {
    assert.equal(
      await readFile(path.join(output, artifact.file), "utf8"),
      artifact.bytes,
    );
  }
});

test("Legal V7 review cannot replace or enter the sealed public Legal V5 plan", () => {
  const v5 = createPagesJointLegalV5Plan({ root: ROOT });
  assert.equal(v5.v5.receipt.state, "owner-approved-finalization");
  assert.equal(v5.v5.receipt.published, false);
  assert.equal(v5.v5.receipt.deploymentAuthorized, false);
  for (const file of [
    "scripts/hosted-truth/joint-legal-v7-review.mjs",
    "scripts/hosted-truth/render-joint-legal-v7-review.mjs",
    "scripts/test/joint-legal-v7.test.mjs",
  ]) {
    assert.equal(publicFileAllowlist.includes(file), false);
    assert.equal(hostedFileAllowlist.includes(file), false);
  }
});

test("Legal V7 matches the current complete service contract", () => {
  const { artifacts } = createJointLegalV7ReviewBundle({ root: ROOT });
  const privacy = artifacts.find(({ role }) => role === "privacy-review").bytes;
  const terms = artifacts.find(({ role }) => role === "website-terms-review").bytes;
  for (const phrase of [
    "$20 Download",
    "$25, $35, and $50 monthly plans",
    "seven-day payment grace period",
    "30-day exit window",
    "publish an accepted project version",
    "roll back to an accepted earlier version",
    "register, connect, renew, transfer, and manage DNS",
    "$300 setup and separate $250 monthly service",
    "STOP, CANCEL, END, QUIT, REVOKE, OPTOUT, and UNSUBSCRIBE",
    "Partner $349 per month",
    "The Download sale is final when the accepted HTML file is available",
    "the customer will cover reasonable losses and costs from a third-party claim",
    "Care renews monthly until the customer cancels",
  ]) assert.ok(`${privacy}\n${terms}`.includes(phrase), phrase);
  assert.doesNotMatch(
    `${privacy}\n${terms}`,
    /\$5(?!\d)|\bheld\b|inquiry[ -]only|coming soon|not open yet|provider effects?/iu,
  );
});
