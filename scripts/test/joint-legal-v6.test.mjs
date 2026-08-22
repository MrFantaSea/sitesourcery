import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hostedFileAllowlist } from "../build-hosted.mjs";
import { publicFileAllowlist } from "../build-pages.mjs";
import {
  JOINT_LEGAL_V6_REVIEW_SCHEMA,
  PRIVACY_V6_REVIEW_VERSION,
  WEBSITE_TERMS_V6_REVIEW_VERSION,
  assertLegalCenterV6Review,
  assertPrivacyV6Review,
  assertWebsiteTermsV6Review,
  createJointLegalV6ReviewBundle,
} from "../hosted-truth/joint-legal-v6-review.mjs";
import { writeJointLegalV6Review } from
  "../hosted-truth/render-joint-legal-v6-review.mjs";
import { createPagesJointLegalV5Plan } from
  "../hosted-truth/pages-legal-v5.mjs";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);

test("Legal V6 is a deterministic noindex review bundle with no release authority", async (t) => {
  const first = createJointLegalV6ReviewBundle({ root: ROOT });
  const second = createJointLegalV6ReviewBundle({ root: ROOT });
  assert.equal(first.schema, JOINT_LEGAL_V6_REVIEW_SCHEMA);
  assert.equal(first.state, "review-candidate-unapproved");
  assert.equal(first.published, false);
  assert.equal(first.deployable, false);
  assert.equal(first.privacyVersion, null);
  assert.equal(first.websiteTermsVersion, null);
  assert.equal(first.effectiveAt, null);
  assert.deepEqual(
    first.artifacts.map(({ role, file, sha256, byteCount }) => ({
      role, file, sha256, byteCount,
    })),
    second.artifacts.map(({ role, file, sha256, byteCount }) => ({
      role, file, sha256, byteCount,
    })),
  );
  assert.deepEqual(first.artifacts.map(({ role }) => role), [
    "legal-center-review",
    "privacy-review",
    "website-terms-review",
  ]);
  assert.deepEqual(
    first.artifacts.map(({ role, file, sha256, byteCount }) => ({
      role, file, sha256, byteCount,
    })),
    [
      {
        role: "legal-center-review",
        file: "legal/index.html",
        sha256: "0b420e7ea4be57ca68c630a0f7c9023031832abbef2b032c4a5c64e0f7427405",
        byteCount: 5635,
      },
      {
        role: "privacy-review",
        file: "legal/privacy/index.html",
        sha256: "9a1cbf00be381f2c08cfd8fac3fb1e8a6b49484821d6d9a5d1512eb155a6072a",
        byteCount: 31771,
      },
      {
        role: "website-terms-review",
        file: "legal/website-terms/index.html",
        sha256: "267c4983659356fdc5a69e93d52b0cb9d3d5b6a9b547e9825f3cbf881618ffe2",
        byteCount: 33509,
      },
    ],
  );
  const center = first.artifacts[0].bytes;
  const privacy = first.artifacts[1].bytes;
  const terms = first.artifacts[2].bytes;
  assert.equal(assertLegalCenterV6Review(center), true);
  assert.equal(assertPrivacyV6Review(privacy), true);
  assert.equal(assertWebsiteTermsV6Review(terms), true);
  for (const source of [center, privacy, terms]) {
    assert.match(source, /noindex,nofollow,noarchive/u);
    assert.match(source, /review-only-nondeployable/u);
    assert.match(source, /Not effective — joint legal V6 review only/u);
    assert.doesNotMatch(source, /\$5(?!\d)/u);
    assert.doesNotMatch(
      source,
      /SS-HOSTED-(?:PRIVACY|WEBSITE-TERMS)-\d{4}-\d{2}-\d{2}-V6/u,
    );
    assert.doesNotMatch(source, /2026-08-21T04:00:00\.000Z/u);
  }
  assert.match(privacy, new RegExp(PRIVACY_V6_REVIEW_VERSION, "u"));
  assert.match(terms, new RegExp(WEBSITE_TERMS_V6_REVIEW_VERSION, "u"));

  const temporary = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-legal-v6-"));
  t.after(async () => rm(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, "review");
  const written = await writeJointLegalV6Review({ root: ROOT, output });
  assert.equal(written.output, output);
  const manifest = JSON.parse(await readFile(
    path.join(output, "joint-legal-v6-review-manifest.json"),
    "utf8",
  ));
  assert.equal(manifest.schema, JOINT_LEGAL_V6_REVIEW_SCHEMA);
  assert.equal(manifest.published, false);
  assert.equal(manifest.deployable, false);
  assert.equal(manifest.privacyVersion, null);
  assert.equal(manifest.websiteTermsVersion, null);
  assert.equal(manifest.effectiveAt, null);
  for (const artifact of first.artifacts) {
    assert.equal(
      await readFile(path.join(output, artifact.file), "utf8"),
      artifact.bytes,
    );
  }
});

test("Legal V6 review cannot replace or enter the sealed public Legal V5 plan", () => {
  const v5 = createPagesJointLegalV5Plan({ root: ROOT });
  assert.equal(v5.v5.receipt.state, "owner-approved-finalization");
  assert.equal(v5.v5.receipt.published, false);
  assert.equal(v5.v5.receipt.deploymentAuthorized, false);
  for (const file of [
    "scripts/hosted-truth/joint-legal-v6-review.mjs",
    "scripts/hosted-truth/render-joint-legal-v6-review.mjs",
    "scripts/test/joint-legal-v6.test.mjs",
  ]) {
    assert.equal(publicFileAllowlist.includes(file), false);
    assert.equal(hostedFileAllowlist.includes(file), false);
  }
});

test("Legal V6 review exposes the exact attainable protection boundary", () => {
  const { artifacts } = createJointLegalV6ReviewBundle({ root: ROOT });
  const privacy = artifacts.find(({ role }) => role === "privacy-review").bytes;
  const terms = artifacts.find(({ role }) => role === "website-terms-review").bytes;
  for (const phrase of [
    "full $20 creates one non-transferable, one-use, non-cash credit",
    "same account and project’s first separately released Alakazam invoice",
    "early fraud warning",
    "private dispute dossier",
    "authorized organization owner",
  ]) assert.ok(`${privacy}\n${terms}`.includes(phrase), phrase);
  for (const phrase of [
    "issuer controls whether authentication is required or succeeds",
    "not a waiver of any lawful dispute right",
    "issuing bank control the dispute process and outcome",
    "does not limit a remedy for non-delivery",
    "No term, 3D Secure result, receipt, or evidence package guarantees",
  ]) assert.ok(terms.includes(phrase), phrase);
  assert.doesNotMatch(
    `${privacy}\n${terms}`,
    /always win|chargeback-proof|cannot dispute|waive all disputes|guaranteed break-even/iu,
  );
});
