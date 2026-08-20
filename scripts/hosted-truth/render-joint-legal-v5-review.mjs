#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  JOINT_LEGAL_V5_CONTENT,
  assertJointLegalV5Held,
} from "./joint-legal-v5-artifacts.mjs";
import {
  JOINT_LEGAL_V5_SOURCE_IDENTITIES,
  createPrivacyV5RenderPlan,
  createWebsiteTermsV5RenderPlan,
  renderLegalCenterV5,
  renderPrivacyV5,
  renderWebsiteTermsV5,
} from "./joint-legal-v5-render.mjs";

export const JOINT_LEGAL_V5_REVIEW_RELATIVE_ROOT =
  "ops/releases/final-successor-20260811/joint-legal-v5-review";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function assertNewOutput(output) {
  try {
    await lstat(output);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`joint legal V5 review output already exists: ${output}`);
}

function artifact(file, bytes) {
  return Object.freeze({
    file,
    sha256: digest(bytes),
    byteCount: bytes.byteLength,
  });
}

function assertIdentity(kind, bytes) {
  const expected = JOINT_LEGAL_V5_CONTENT[kind];
  if (
    digest(bytes) !== expected.reviewSha256
    || bytes.byteLength !== expected.reviewByteCount
  ) throw new Error(`joint legal V5 ${kind} review identity changed`);
}

export function createJointLegalV5ReviewBundle({ root = process.cwd() } = {}) {
  assertJointLegalV5Held();
  const privacyPlan = createPrivacyV5RenderPlan({ mode: "review" });
  const termsPlan = createWebsiteTermsV5RenderPlan({ mode: "review" });
  const bytes = Object.freeze({
    center: Buffer.from(renderLegalCenterV5({
      root,
      privacyPlan,
      termsPlan,
    })),
    privacy: Buffer.from(renderPrivacyV5({ root, plan: privacyPlan })),
    websiteTerms: Buffer.from(renderWebsiteTermsV5({
      root,
      plan: termsPlan,
    })),
  });
  for (const kind of Object.keys(bytes)) assertIdentity(kind, bytes[kind]);
  const artifacts = Object.freeze({
    center: artifact("legal/index.html", bytes.center),
    privacy: artifact("legal/privacy/index.html", bytes.privacy),
    websiteTerms: artifact(
      "legal/website-terms/index.html",
      bytes.websiteTerms,
    ),
  });
  const manifest = Object.freeze({
    schema: "sitesourcery.joint-legal-v5-review/v1",
    state: "review-candidate-unapproved",
    effective: false,
    published: false,
    deployable: false,
    indexed: false,
    ownerApproved: false,
    release: null,
    seller: "Desiderata Labs LLC",
    filedAlternateName: "SITESOURCERY",
    publicBrand: "Site Sourcery",
    jurisdiction: "New Jersey, United States",
    contact: Object.freeze({
      phone: "+18562441220",
      email: "sitesourcery@proton.me",
    }),
    catalog: Object.freeze({
      version: JOINT_LEGAL_V5_CONTENT.catalogVersion,
      digest: JOINT_LEGAL_V5_CONTENT.catalogDigest,
    }),
    artifacts,
    frozenSources: JOINT_LEGAL_V5_SOURCE_IDENTITIES,
    reviewBasis: Object.freeze([
      "https://www.ftc.gov/business-guidance/resources/com-disclosures-how-make-effective-disclosures-digital-advertising",
      "https://pub.njleg.state.nj.us/Bills/2022/PL22/96_.PDF",
      "https://developers.cloudflare.com/1.1.1.1/privacy/public-dns-resolver/",
      "https://stripe.com/privacy",
      "https://resend.com/legal/privacy-policy",
      "https://www.twilio.com/en-us/legal/privacy",
    ]),
    gates: Object.freeze([
      "owner review of these exact bytes",
      "owner approval of exact V5 document versions",
      "owner approval of one exact effective UTC time",
      "content seal and release receipt",
      "separate deployment and public-cutover authority",
    ]),
  });
  const readme = `# Joint Legal V5 review candidate

This directory is the deterministic, exact-byte review bundle for Joint Legal
V5. It is **not effective, published, deployable, indexed, or owner-approved**.
Every HTML document carries \`noindex,nofollow,noarchive\` and an explicit
unsealed review state.

The candidate binds the seller, brand, contact routes, catalog
\`${manifest.catalog.version}\` / \`${manifest.catalog.digest}\`, the $350
assessment and non-cash credit, credit-only $0 Card settlement, tax-exclusive
\`disabled_by_owner\` state, all-sales-final and product-specific earned-payment
boundaries, capped liability, customer-supplied-content responsibility, New
Jersey law and venue, exact retention schedule, provider disclosures, and held
product/effect matrix.

Review \`manifest.json\` for exact artifact identities and remaining gates.
Do not copy these files to a hosted or public root. Finalization requires a new
owner-approved content seal, exact V5 document versions, one effective UTC
time, and a separate release receipt. Deployment and public cutover remain
later, independent approvals.
`;
  return Object.freeze({ bytes, manifest, readme });
}

export async function renderJointLegalV5Review({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  outputRoot,
} = {}) {
  const absoluteRoot = path.resolve(root);
  const expectedOutput = path.join(
    absoluteRoot,
    JOINT_LEGAL_V5_REVIEW_RELATIVE_ROOT,
  );
  const absoluteOutput = path.resolve(outputRoot ?? expectedOutput);
  if (absoluteOutput !== expectedOutput) {
    throw new Error(
      `joint legal V5 review output must be ${expectedOutput}`,
    );
  }
  await assertNewOutput(absoluteOutput);
  const bundle = createJointLegalV5ReviewBundle({ root: absoluteRoot });
  await mkdir(absoluteOutput, { recursive: true });
  try {
    for (const [kind, artifactValue] of Object.entries(bundle.manifest.artifacts)) {
      const target = path.join(absoluteOutput, artifactValue.file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bundle.bytes[kind]);
    }
    await writeFile(
      path.join(absoluteOutput, "manifest.json"),
      `${JSON.stringify(bundle.manifest, null, 2)}\n`,
    );
    await writeFile(path.join(absoluteOutput, "README.md"), bundle.readme);
    return Object.freeze({ outputRoot: absoluteOutput, manifest: bundle.manifest });
  } catch (error) {
    await rm(absoluteOutput, { recursive: true, force: true });
    throw error;
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  renderJointLegalV5Review({ outputRoot: process.argv[2] })
    .then(({ outputRoot }) => console.log(outputRoot))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
