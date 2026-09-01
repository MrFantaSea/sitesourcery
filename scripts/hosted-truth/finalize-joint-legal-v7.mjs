#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalJson } from "../../server/hosted/security.mjs";
import { createJointLegalV7ReviewBundle } from "./joint-legal-v7-review.mjs";

export const JOINT_LEGAL_V7_FINALIZATION_SCHEMA =
  "sitesourcery.hosted-joint-legal-v7-finalization/v1";
export const JOINT_LEGAL_V7_AUTHORITY_SCHEMA =
  "sitesourcery.project-legal-authority/v7";
export const JOINT_LEGAL_V7_ACCEPTANCE_SCHEMA =
  "sitesourcery.project-legal-acceptance/v7";
export const JOINT_LEGAL_V7_PRIVACY_VERSION =
  "SS-HOSTED-PRIVACY-2026-08-31-V7";
export const JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION =
  "SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7";
export const JOINT_LEGAL_V7_EFFECTIVE_AT =
  "2026-09-01T04:00:00.000Z";
export const JOINT_LEGAL_V7_EFFECTIVE_LABEL =
  "September 1, 2026";
export const JOINT_LEGAL_V7_OWNER_APPROVAL =
  "OWNER_APPROVED_EXACT_JOINT_LEGAL_V7_AFTER_CONDITIONAL_REVIEW";
export const JOINT_LEGAL_V7_ROOT =
  "ops/releases/legal-v7-20260831";
export const JOINT_LEGAL_V7_RECEIPT =
  "joint-legal-v7-release-constants.json";

export const JOINT_LEGAL_V7_DOCUMENT_IDS = Object.freeze({
  privacy: "00000000-0000-4000-8000-000000000152",
  product: "00000000-0000-4000-8000-000000000153",
  website: "00000000-0000-4000-8000-000000000154",
});

const ACCEPTANCE_STATEMENT =
  "accepted_exact_project_terms_and_acknowledged_privacy";
const SOURCE_FILES = Object.freeze({
  center: "legal/index.html",
  privacy: "legal/privacy/index.html",
  terms: "legal/website-terms/index.html",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function identity(bytes) {
  return Object.freeze({
    sha256: sha256(bytes),
    byteCount: bytes.byteLength,
  });
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function replaceExactlyOnce(source, before, after, label) {
  if (occurrences(source, before) !== 1) {
    throw new Error(`joint legal V7 final ${label} anchor changed`);
  }
  return source.replace(before, after);
}

function replacePatternOnce(source, pattern, after, label) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  if ([...source.matchAll(new RegExp(pattern.source, flags))].length !== 1) {
    throw new Error(`joint legal V7 final ${label} anchor changed`);
  }
  return source.replace(pattern, after);
}

function cleanSource(source) {
  return source
    .replace(/^\s*<!-- sitesourcery:truth-slot:[^\n]+-->\n?/gmu, "")
    .replace(/^\s*<meta name="sitesourcery-(?:privacy-v3-source-state|terms-draft-state)" content="unsealed">\n?/gmu, "");
}

function effectiveAside({ kind, version }) {
  const heading = kind === "privacy" ? "Privacy notice" : "Website terms";
  return [
    `<aside class="quote-panel" data-legal-version="${version}">`,
    `<p class="card-kicker">Effective ${JOINT_LEGAL_V7_EFFECTIVE_LABEL}</p>`,
    `<h2>${heading} ${version}</h2>`,
    `<p>Effective <time datetime="${JOINT_LEGAL_V7_EFFECTIVE_AT}">${JOINT_LEGAL_V7_EFFECTIVE_LABEL}</time>. The versioned copy stays available at the permanent link below.</p>`,
    "</aside>",
  ].join("");
}

function assertPublished(source, { label, version }) {
  for (const phrase of [
    version,
    JOINT_LEGAL_V7_EFFECTIVE_AT,
    JOINT_LEGAL_V7_EFFECTIVE_LABEL,
    "Desiderata Labs LLC",
    "sitesourcery@proton.me",
  ]) {
    if (!source.includes(phrase)) {
      throw new Error(`joint legal V7 final ${label} is missing ${phrase}`);
    }
  }
  if (
    source.includes("sitesourcery:truth-slot:")
    || source.includes("Draft for review")
    || source.includes("not effective or published")
    || source.includes("review-only-nondeployable")
    || source.includes("review-unsealed")
    || source.includes("source-state=\"unsealed\"")
    || /<meta name="robots" content="noindex/iu.test(source)
    || /\$5(?!\d)/u.test(source)
    || /\b(?:coming soon|not open yet|inquiry[- ]only|remain held)\b/iu.test(source)
  ) {
    throw new Error(`joint legal V7 final ${label} contains draft or stale truth`);
  }
}

async function source(root, file) {
  return cleanSource(await readFile(path.join(root, file), "utf8"));
}

async function renderPrivacy(root) {
  let value = await source(root, SOURCE_FILES.privacy);
  value = replacePatternOnce(
    value,
    /<aside class="quote-panel" data-privacy-v3-source-state="unsealed">[\s\S]*?<\/aside>/u,
    effectiveAside({ kind: "privacy", version: JOINT_LEGAL_V7_PRIVACY_VERSION }),
    "Privacy identity",
  );
  assertPublished(value, {
    label: "Privacy",
    version: JOINT_LEGAL_V7_PRIVACY_VERSION,
  });
  return Buffer.from(value);
}

async function renderWebsiteTerms(root) {
  let value = await source(root, SOURCE_FILES.terms);
  value = replacePatternOnce(
    value,
    /<aside class="quote-panel" data-terms-draft-state="unsealed">[\s\S]*?<\/aside>/u,
    effectiveAside({
      kind: "terms",
      version: JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION,
    }),
    "Website Terms identity",
  );
  assertPublished(value, {
    label: "Website Terms",
    version: JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION,
  });
  return Buffer.from(value);
}

async function renderCenter(root) {
  let value = await source(root, SOURCE_FILES.center);
  value = replacePatternOnce(
    value,
    /<aside class="quote-panel">[\s\S]*?<\/aside>/u,
    [
      `<aside class="quote-panel" data-legal-version="${JOINT_LEGAL_V7_PRIVACY_VERSION}">`,
      `<p class="card-kicker">Effective ${JOINT_LEGAL_V7_EFFECTIVE_LABEL}</p>`,
      "<h2>Site Sourcery is run by Desiderata Labs LLC.</h2>",
      `<p>Current documents: ${JOINT_LEGAL_V7_PRIVACY_VERSION} and ${JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION}. Desiderata Labs LLC is the legal seller.</p>`,
      `<time datetime="${JOINT_LEGAL_V7_EFFECTIVE_AT}">${JOINT_LEGAL_V7_EFFECTIVE_LABEL}</time>`,
      "</aside>",
    ].join(""),
    "legal center identity",
  );
  assertPublished(value, {
    label: "legal center",
    version: JOINT_LEGAL_V7_PRIVACY_VERSION,
  });
  if (!value.includes(JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION)) {
    throw new Error("joint legal V7 final legal center is missing Terms version");
  }
  return Buffer.from(value);
}

export async function createJointLegalV7Finalization({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
} = {}) {
  const absoluteRoot = path.resolve(root);
  const [legalCenter, privacy, websiteTerms] = await Promise.all([
    renderCenter(absoluteRoot),
    renderPrivacy(absoluteRoot),
    renderWebsiteTerms(absoluteRoot),
  ]);
  const privacyIdentity = identity(privacy);
  const termsIdentity = identity(websiteTerms);
  const privacyUri = `https://sitesourcery.com/legal/privacy/versions/${JOINT_LEGAL_V7_PRIVACY_VERSION}/`;
  const termsUri = `https://sitesourcery.com/legal/website-terms/versions/${JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION}/`;
  const documents = Object.freeze([
    Object.freeze({
      kind: "privacy",
      version: JOINT_LEGAL_V7_PRIVACY_VERSION,
      contentDigest: privacyIdentity.sha256,
      contentUri: privacyUri,
      effectiveAt: JOINT_LEGAL_V7_EFFECTIVE_AT,
    }),
    Object.freeze({
      kind: "product",
      version: JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION,
      contentDigest: termsIdentity.sha256,
      contentUri: "https://sitesourcery.com/legal/website-terms/#self-service",
      effectiveAt: JOINT_LEGAL_V7_EFFECTIVE_AT,
    }),
    Object.freeze({
      kind: "website",
      version: JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION,
      contentDigest: termsIdentity.sha256,
      contentUri: "https://sitesourcery.com/legal/website-terms/",
      effectiveAt: JOINT_LEGAL_V7_EFFECTIVE_AT,
    }),
  ]);
  const authorityDigest = sha256(canonicalJson({
    documents,
    schema: JOINT_LEGAL_V7_AUTHORITY_SCHEMA,
  }));
  const artifacts = Object.freeze([
    Object.freeze({ role: "privacy-current", file: "hosted/legal/privacy/index.html", bytes: privacy }),
    Object.freeze({ role: "privacy-versioned", file: `hosted/legal/privacy/versions/${JOINT_LEGAL_V7_PRIVACY_VERSION}/index.html`, bytes: privacy }),
    Object.freeze({ role: "website-terms-current", file: "hosted/legal/website-terms/index.html", bytes: websiteTerms }),
    Object.freeze({ role: "website-terms-versioned", file: `hosted/legal/website-terms/versions/${JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION}/index.html`, bytes: websiteTerms }),
    Object.freeze({ role: "legal-center-current", file: "hosted/legal/index.html", bytes: legalCenter }),
  ]);
  const review = createJointLegalV7ReviewBundle({ root: absoluteRoot });
  const receipt = Object.freeze({
    schema: JOINT_LEGAL_V7_FINALIZATION_SCHEMA,
    state: "owner-approved-finalization",
    sealable: true,
    published: false,
    deploymentAuthorized: false,
    integrationRequired: true,
    effectiveAt: JOINT_LEGAL_V7_EFFECTIVE_AT,
    authoritySchema: JOINT_LEGAL_V7_AUTHORITY_SCHEMA,
    acceptanceSchema: JOINT_LEGAL_V7_ACCEPTANCE_SCHEMA,
    acceptanceStatement: ACCEPTANCE_STATEMENT,
    authorityDigest,
    approval: Object.freeze({
      value: JOINT_LEGAL_V7_OWNER_APPROVAL,
      basis: "owner conditional approval after source, business, implementation, and authoritative-source review",
      reviewManifestSha256: sha256(canonicalJson(review)),
    }),
    documentBindings: Object.freeze([
      Object.freeze({ kind: "privacy", id: JOINT_LEGAL_V7_DOCUMENT_IDS.privacy }),
      Object.freeze({ kind: "product", id: JOINT_LEGAL_V7_DOCUMENT_IDS.product }),
      Object.freeze({ kind: "website", id: JOINT_LEGAL_V7_DOCUMENT_IDS.website }),
    ]),
    documents,
    artifacts: Object.freeze(artifacts.map(({ role, file, bytes }) =>
      Object.freeze({ role, file, ...identity(bytes) }))),
    release: Object.freeze({
      privacyVersion: JOINT_LEGAL_V7_PRIVACY_VERSION,
      privacySha256: privacyIdentity.sha256,
      privacyByteCount: privacyIdentity.byteCount,
      privacyArtifactUri: privacyUri,
      websiteTermsVersion: JOINT_LEGAL_V7_WEBSITE_TERMS_VERSION,
      websiteTermsSha256: termsIdentity.sha256,
      websiteTermsByteCount: termsIdentity.byteCount,
      websiteTermsArtifactUri: termsUri,
      effectiveAt: JOINT_LEGAL_V7_EFFECTIVE_AT,
      authorityDigest,
    }),
    cutoverPolicy: Object.freeze({
      retainedV2V3V4V5EvidencePreserved: true,
      exactJointV7AcceptanceRequiredForNewProjects: true,
      deploymentAndPublicCutoverRequireSeparateApproval: true,
    }),
  });
  return Object.freeze({ absoluteRoot, artifacts, receipt });
}

async function assertAbsent(file) {
  try {
    await lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`joint legal V7 finalization target already exists: ${file}`);
}

export async function finalizeJointLegalV7({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  ownerApproval,
} = {}) {
  if (ownerApproval !== JOINT_LEGAL_V7_OWNER_APPROVAL) {
    throw new Error("joint legal V7 finalization requires exact owner approval");
  }
  const plan = await createJointLegalV7Finalization({ root });
  const outputRoot = path.join(plan.absoluteRoot, ...JOINT_LEGAL_V7_ROOT.split("/"));
  const receiptFile = path.join(outputRoot, JOINT_LEGAL_V7_RECEIPT);
  await assertAbsent(receiptFile);
  for (const artifact of plan.artifacts) {
    await assertAbsent(path.join(outputRoot, artifact.file));
  }
  for (const artifact of plan.artifacts) {
    const target = path.join(outputRoot, artifact.file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, artifact.bytes);
  }
  await writeFile(receiptFile, `${JSON.stringify(plan.receipt, null, 2)}\n`);
  return Object.freeze({ outputRoot, receipt: plan.receipt });
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const approved = process.argv.slice(2).includes("--owner-approved");
  finalizeJointLegalV7({
    ownerApproval: approved ? JOINT_LEGAL_V7_OWNER_APPROVAL : null,
  })
    .then(({ outputRoot }) => console.log(outputRoot))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
