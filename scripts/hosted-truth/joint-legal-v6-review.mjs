import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const JOINT_LEGAL_V6_REVIEW_SCHEMA =
  "sitesourcery.joint-legal-v6-review/v1";
export const PRIVACY_V6_REVIEW_VERSION =
  "SS-HOSTED-PRIVACY-JOINT-REVIEW-DRAFT-V6";
export const WEBSITE_TERMS_V6_REVIEW_VERSION =
  "SS-HOSTED-WEBSITE-TERMS-JOINT-REVIEW-DRAFT-V6";

const REVIEW_LABEL = "Not effective — joint legal V6 review only";
const REVIEW_META =
  '  <meta name="robots" content="noindex,nofollow,noarchive">\n'
  + '  <meta name="sitesourcery-release-state" content="review-only-nondeployable">\n';

const SOURCE_FILES = Object.freeze({
  center: "legal/index.html",
  privacy: "legal/privacy/index.html",
  terms: "legal/website-terms/index.html",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function replaceExactlyOnce(source, before, after, label) {
  if (occurrences(source, before) !== 1) {
    throw new Error(`joint legal V6 ${label} anchor changed`);
  }
  return source.replace(before, after);
}

function replacePatternOnce(source, pattern, after, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
  if (matches.length !== 1) {
    throw new Error(`joint legal V6 ${label} anchor changed`);
  }
  return source.replace(pattern, after);
}

function reviewAside({ heading, body }) {
  return [
    '<aside class="quote-panel" data-joint-legal-v6-review-state="unsealed">',
    `<p class="card-kicker">${REVIEW_LABEL}</p>`,
    `<h2>${heading}</h2>`,
    `<p>${body}</p>`,
    "</aside>",
  ].join("");
}

function prepareSource({ root, file }) {
  let source = readFileSync(path.join(root, file), "utf8");
  source = source
    .replace(/^\s*<!-- sitesourcery:truth-slot:[^\n]+-->\n?/gmu, "")
    .replace(/^\s*<meta name="sitesourcery-(?:privacy-v3-source-state|terms-draft-state)" content="unsealed">\n?/gmu, "");
  source = replaceExactlyOnce(
    source,
    "</head>",
    `${REVIEW_META}</head>`,
    `${file} review metadata`,
  );
  source = replacePatternOnce(
    source,
    /<body class="([^"]+)">/u,
    '<body class="$1" data-joint-legal-v6-state="review-unsealed">',
    `${file} body state`,
  );
  return source;
}

function assertCommonReview(source, label) {
  if (
    !source.includes('name="robots" content="noindex,nofollow,noarchive"')
    || !source.includes('name="sitesourcery-release-state" content="review-only-nondeployable"')
    || !source.includes('data-joint-legal-v6-state="review-unsealed"')
    || !source.includes('data-joint-legal-v6-review-state="unsealed"')
    || !source.includes(REVIEW_LABEL)
    || source.includes("sitesourcery:truth-slot:")
    || source.includes("sitesourcery-privacy-v3-source-state")
    || source.includes("sitesourcery-terms-draft-state")
    || source.includes("data-privacy-v3-source-state")
    || source.includes("data-terms-draft-state")
    || source.includes("Draft for review")
    || /\$5(?!\d)/u.test(source)
    || /SS-HOSTED-(?:PRIVACY|WEBSITE-TERMS)-\d{4}-\d{2}-\d{2}-V6/u.test(source)
    || /\b(?:inquiry[- ]only|provider effects?|effect authority)\b/iu.test(source)
  ) {
    throw new Error(`joint legal V6 ${label} review is release-ambiguous`);
  }
}

export function renderPrivacyV6Review({ root = process.cwd() } = {}) {
  let source = prepareSource({ root, file: SOURCE_FILES.privacy });
  source = replacePatternOnce(
    source,
    /<aside class="quote-panel" data-privacy-v3-source-state="unsealed">[\s\S]*?<\/aside>/u,
    reviewAside({
      heading: `Notice ${PRIVACY_V6_REVIEW_VERSION}`,
      body: "This is the exact plain-English privacy candidate for owner review. It is not published or effective and has no release date yet.",
    }),
    "privacy identity",
  );
  assertPrivacyV6Review(source);
  return source;
}

export function renderWebsiteTermsV6Review({ root = process.cwd() } = {}) {
  let source = prepareSource({ root, file: SOURCE_FILES.terms });
  source = replacePatternOnce(
    source,
    /<aside class="quote-panel" data-terms-draft-state="unsealed">[\s\S]*?<\/aside>/u,
    reviewAside({
      heading: `Terms ${WEBSITE_TERMS_V6_REVIEW_VERSION}`,
      body: "This is the exact plain-English website-terms candidate for owner review. It is not published or effective and has no release date yet.",
    }),
    "website terms identity",
  );
  assertWebsiteTermsV6Review(source);
  return source;
}

export function renderLegalCenterV6Review({ root = process.cwd() } = {}) {
  let source = prepareSource({ root, file: SOURCE_FILES.center });
  source = replacePatternOnce(
    source,
    /<aside class="quote-panel">[\s\S]*?<\/aside>/u,
    reviewAside({
      heading: "Joint Legal V6 review candidate",
      body: `Review ${PRIVACY_V6_REVIEW_VERSION} and ${WEBSITE_TERMS_V6_REVIEW_VERSION}. Desiderata Labs LLC is the legal seller. Neither document is published or effective yet.`,
    }),
    "legal center identity",
  );
  assertLegalCenterV6Review(source);
  return source;
}

export function assertPrivacyV6Review(source) {
  assertCommonReview(source, "privacy");
  for (const phrase of [
    PRIVACY_V6_REVIEW_VERSION,
    "saved projects, $20 Download, Alakazam hosting, Care plans, and The Responder",
    "The free guest preview needs no account. Saving a project or using its $20 Download requires sign-in.",
    "The Responder uses phone numbers and text messages after setup.",
    "Cloudflare’s public DNS-over-HTTPS resolver",
    "Stripe handles the $20 Download",
    "does not ask for or store the full card number or card security code",
  ]) {
    if (!source.includes(phrase)) {
      throw new Error(`Privacy V6 is missing required review truth: ${phrase}`);
    }
  }
  return true;
}

export function assertWebsiteTermsV6Review(source) {
  assertCommonReview(source, "terms");
  for (const phrase of [
    WEBSITE_TERMS_V6_REVIEW_VERSION,
    "Make and test a preview without an account. Sign in only when you want to save the project or buy its $20 Download.",
    "Creating an account and signing in lets the customer save the project.",
    "A domain the customer owns is separate from Alakazam.",
    "Download costs $20 once per saved project. Alakazam monthly sign-up is not open yet.",
    "The Responder costs $300 to start and $250 each month.",
    "The one-time $300 setup and separate $250 monthly service begin only under a customer agreement.",
    "Ongoing Care requires a monthly plan or separate written agreement.",
  ]) {
    if (!source.includes(phrase)) {
      throw new Error(`Website Terms V6 is missing required review truth: ${phrase}`);
    }
  }
  return true;
}

export function assertLegalCenterV6Review(source) {
  assertCommonReview(source, "center");
  for (const phrase of [
    PRIVACY_V6_REVIEW_VERSION,
    WEBSITE_TERMS_V6_REVIEW_VERSION,
    "Joint Legal V6 review candidate",
    "Desiderata Labs LLC is the legal seller",
    "privacy notice and website terms",
  ]) {
    if (!source.includes(phrase)) {
      throw new Error(`Legal center V6 is missing required review truth: ${phrase}`);
    }
  }
  return true;
}

export function createJointLegalV6ReviewBundle({ root = process.cwd() } = {}) {
  const artifacts = Object.freeze([
    Object.freeze({
      role: "legal-center-review",
      file: SOURCE_FILES.center,
      bytes: renderLegalCenterV6Review({ root }),
    }),
    Object.freeze({
      role: "privacy-review",
      file: SOURCE_FILES.privacy,
      bytes: renderPrivacyV6Review({ root }),
    }),
    Object.freeze({
      role: "website-terms-review",
      file: SOURCE_FILES.terms,
      bytes: renderWebsiteTermsV6Review({ root }),
    }),
  ].map((artifact) => Object.freeze({
    ...artifact,
    sha256: sha256(artifact.bytes),
    byteCount: Buffer.byteLength(artifact.bytes),
  })));
  return Object.freeze({
    schema: JOINT_LEGAL_V6_REVIEW_SCHEMA,
    state: "review-candidate-unapproved",
    published: false,
    deployable: false,
    privacyVersion: null,
    websiteTermsVersion: null,
    effectiveAt: null,
    artifacts,
  });
}
