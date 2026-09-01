import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createJointLegalV7Finalization,
  JOINT_LEGAL_V7_ACCEPTANCE_SCHEMA,
  JOINT_LEGAL_V7_AUTHORITY_SCHEMA,
  JOINT_LEGAL_V7_EFFECTIVE_AT,
  JOINT_LEGAL_V7_FINALIZATION_SCHEMA,
  JOINT_LEGAL_V7_PRIVACY_VERSION,
  JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION,
} from "../hosted-truth/finalize-joint-legal-v7.mjs";
import {
  createPagesJointLegalV7Plan,
  pagesLegalV7Files,
} from "../hosted-truth/pages-legal-v7.mjs";
import { publicFileAllowlist } from "../build-pages.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("Legal V7 finalization is exact, owner-approved, and still deployment-disabled", async () => {
  const generated = await createJointLegalV7Finalization({ root: ROOT });
  const plan = createPagesJointLegalV7Plan({ root: ROOT });
  const { receipt } = plan.v7;
  assert.equal(receipt.schema, JOINT_LEGAL_V7_FINALIZATION_SCHEMA);
  assert.equal(receipt.state, "owner-approved-finalization");
  assert.equal(receipt.published, false);
  assert.equal(receipt.deploymentAuthorized, false);
  assert.equal(receipt.integrationRequired, true);
  assert.equal(receipt.authoritySchema, JOINT_LEGAL_V7_AUTHORITY_SCHEMA);
  assert.equal(receipt.acceptanceSchema, JOINT_LEGAL_V7_ACCEPTANCE_SCHEMA);
  assert.equal(receipt.effectiveAt, JOINT_LEGAL_V7_EFFECTIVE_AT);
  assert.equal(receipt.release.privacyVersion, JOINT_LEGAL_V7_PRIVACY_VERSION);
  assert.equal(
    receipt.release.websiteTermsVersion,
    JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION,
  );
  assert.deepEqual(
    generated.receipt.artifacts,
    receipt.artifacts,
    "checked-in artifacts must match a fresh deterministic render",
  );
  assert.equal(generated.receipt.authorityDigest, receipt.authorityDigest);
});

test("Legal V7 current and versioned documents are identical and contain current service truth", async () => {
  const plan = createPagesJointLegalV7Plan({ root: ROOT });
  const byRole = new Map(plan.v7.artifacts.map((artifact) => [artifact.role, artifact]));
  for (const [currentRole, versionedRole] of [
    ["privacy-current", "privacy-versioned"],
    ["website-terms-current", "website-terms-versioned"],
  ]) {
    const current = await readFile(byRole.get(currentRole).source);
    const versioned = await readFile(byRole.get(versionedRole).source);
    assert.deepEqual(current, versioned);
    assert.equal(sha256(current), byRole.get(currentRole).sha256);
  }
  const privacy = await readFile(byRole.get("privacy-current").source, "utf8");
  const terms = await readFile(byRole.get("website-terms-current").source, "utf8");
  const center = await readFile(byRole.get("legal-center-current").source, "utf8");
  for (const source of [privacy, terms, center]) {
    assert.doesNotMatch(
      source,
      /Draft for review|not effective or published|noindex|sitesourcery:truth-slot:|coming soon|not open yet|inquiry[ -]only|remain held/iu,
    );
    assert.match(source, /September 1, 2026/u);
  }
  for (const phrase of [
    "Download costs $20 once. Alakazam is $25, $35, or $50 a month and renews until you cancel.",
    "The customer may cancel Alakazam at any time with no cancellation fee.",
    "seven-day payment grace period",
    "30-day exit window",
    "Site Sourcery can search for, register, connect, renew, transfer, and manage DNS for a customer domain.",
    "The one-time $300 setup and separate $250 monthly service begin only under a customer agreement.",
    "Care plans are Host $25, Care Lite $69, Care $119, Care Plus $199, and Partner $349 per month",
  ]) assert.ok(terms.includes(phrase), phrase);
  assert.match(
    privacy,
    /saved projects, \$20 Download, Alakazam hosting, Care plans, and The Responder/u,
  );
  assert.match(center, /Privacy and terms in plain English\./u);
});

test("Legal V7 preserves every older versioned legal artifact while replacing only current aliases", () => {
  const plan = createPagesJointLegalV7Plan({ root: ROOT });
  const files = pagesLegalV7Files(publicFileAllowlist, plan);
  for (const version of [
    "SS-HOSTED-PRIVACY-2026-07-30-V2",
    "SS-HOSTED-PRIVACY-2026-08-09-V3",
    "SS-HOSTED-PRIVACY-2026-08-09-V4",
    "SS-HOSTED-PRIVACY-2026-08-20-V5",
    JOINT_LEGAL_V7_PRIVACY_VERSION,
  ]) assert.ok(files.includes(`legal/privacy/versions/${version}/index.html`), version);
  for (const version of [
    "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2",
    "SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3",
    "SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4",
    "SS-HOSTED-WEBSITE-TERMS-2026-08-20-V5",
    JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION,
  ]) assert.ok(files.includes(`legal/website-terms/versions/${version}/index.html`), version);
  assert.equal(files.filter((file) => file === "legal/privacy/index.html").length, 1);
  assert.equal(files.filter((file) => file === "legal/website-terms/index.html").length, 1);
  assert.equal(files.filter((file) => file === "legal/index.html").length, 1);
});
