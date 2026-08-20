import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RECEIPT_SCHEMA = "sitesourcery.public-truth-authority/v1";
export const RECEIPT_PATH = "data/public-truth-authority.json";
export const PAGES_OBSERVATION_FILE = "pages-latest.json";
export const WORKFLOW_PATH = ".github/workflows/public-truth-reconciliation.yml";
export const REPOSITORY_FULL_NAME = "MrFantaSea/sitesourcery";
export const RELEASE_ENVIRONMENT = "github-pages";
export const CANDIDATE_BASE_SHA = "181922184afb55b044569b34cf345bf079ecf998";
export const PRODUCTION_PREDECESSOR_SHA = "eff8195640db58390d03eefbe863248220994e37";
export const SOURCE_CATALOG_DIGEST = "0474cd8a48b0b28760e6aa1696eb0021de02f5420646a44efae625bba6a74bcc";
export const PUBLIC_PROJECTION_DIGEST = "17f141f964fe604d87e4021ce6b209f04562b5c174ad7e480b7b62bfc103021a";
export const MAX_AUTHORITY_LIFETIME_MS = 60 * 60 * 1000;
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const MIN_PREDEPLOY_AUTHORITY_REMAINING_MS = 5 * 60 * 1000;
export const POSTDEPLOY_EVIDENCE_SCHEMA = "sitesourcery.postdeploy-production-proof/v1";
export const POSTDEPLOY_EVIDENCE_FILE = "public-truth-production-proof.json";
export const POSTDEPLOY_EVIDENCE_RETENTION_DAYS = 90;
export const POSTDEPLOY_PROPAGATION_WINDOW_MS = 10 * 60 * 1000;
export const POSTDEPLOY_POLL_INTERVAL_MS = 15 * 1000;
export const POSTDEPLOY_REQUEST_TIMEOUT_MS = 15 * 1000;
export const POSTDEPLOY_REQUEST_CONCURRENCY = 8;
export const POSTDEPLOY_REQUIRED_EXACT_SNAPSHOTS = 2;
export const PRODUCTION_ORIGIN = "https://sitesourcery.com";
export const AUTHORITY_STATEMENT = "Authorize one exact inquiry-open, checkout-disabled public-truth reconciliation; deny automated checkout, payment-provider, containment, customer-data, and general deployment authority.";
export const OG_PNG_SHA256 = "be7dce2ece4f570f1cdcd48f0288f95c490d19462dfcb55c18c47757a66c2e36";
export const OG_SOURCE_SHA256 = "61c324f7c5b18ac2eed19d65b3510b8730654e8718c490966c79ee3195751868";
export const CARD_V9_PDF_SHA256 = "8b27ed01cec1dc005718af350a19bbe87a77b824acd1d73caf99029c5b3605fc";
export const REVIEWED_DOMAIN_PREFLIGHT_SHA256 = "50c2b271a8a879f27b9b10f4580196c27df3714ed2d2f3766b5b76ea538d1c5f";

/*
 * The live-route proof deliberately duplicates the reviewed route contract.
 * It must not inherit a candidate-side route-list weakening through a shared
 * import.
 */
export const PRODUCTION_CANONICAL_ROUTE_FILES = Object.freeze({
  "/": "index.html",
  "/websites/": "websites/index.html",
  "/websites/made-for-you/": "websites/made-for-you/index.html",
  "/custom/": "custom/index.html",
  "/custom/scope/": "custom/scope/index.html",
  "/custom/process/": "custom/process/index.html",
  "/abracadabra/": "abracadabra/index.html",
  "/abracadabra/how/": "abracadabra/how/index.html",
  "/abracadabra/app/": "abracadabra/app/index.html",
  "/hive/": "hive/index.html",
  "/solutions/": "solutions/index.html",
  "/domains/": "domains/index.html",
  "/work/": "work/index.html",
  "/about/": "about/index.html",
  "/faq/": "faq/index.html",
  "/contact/": "contact/index.html",
  "/start/": "start/index.html",
  "/legal/": "legal/index.html",
  "/legal/privacy/": "legal/privacy/index.html",
  "/legal/website-terms/": "legal/website-terms/index.html",
  "/alakazam/": "alakazam/index.html",
  "/care/": "care/index.html",
  "/responder/": "responder/index.html",
  "/services/": "services/index.html",
});

export const PRODUCTION_LEGACY_REDIRECTS = Object.freeze({
  "about.html": "/about/",
  "alacazam/index.html": "/alakazam/",
  "automation.html": "/hive/",
  "contact.html": "/contact/",
  "faq.html": "/faq/",
  "how-it-works.html": "/custom/process/",
  "pricing.html": "/custom/scope/",
  "privacy.html": "/legal/privacy/",
  "terms.html": "/legal/website-terms/",
  "thanks.html": "/contact/",
  "the-difference.html": "/about/#the-difference",
  "the-meter.html": "/custom/process/#scope",
  "the-moat.html": "/about/#the-difference",
  "the-responder.html": "/responder/",
});

// Retained for report-schema compatibility. FIN-007's reviewed artifact carries
// every legacy redirect above, so there is no source-only redirect exception.
export const SOURCE_ONLY_LEGACY_REDIRECT = null;

/*
 * This is the complete candidate delta relative to CANDIDATE_BASE_SHA. It is
 * deliberately explicit: adding, deleting, renaming, or substituting even one
 * path requires a reviewed verifier update.
 */
export const CANDIDATE_CHANGED_PATHS = Object.freeze([
  ".github/workflows/containment.yml",
  ".github/workflows/pages.yml",
  ".github/workflows/public-truth-reconciliation.yml",
  ".github/workflows/site-quality.yml",
  "404.html",
  "about.html",
  "about/index.html",
  "abracadabra/abracadabra-showcase.js",
  "abracadabra/app/abracadabra-app.css",
  "abracadabra/app/abracadabra-app.js",
  "abracadabra/app/abracadabra-compiler.js",
  "abracadabra/app/abracadabra-control.js",
  "abracadabra/app/index.html",
  "abracadabra/how/index.html",
  "abracadabra/index.html",
  "abracadabra/platform/abracadabra-platform.js",
  "abracadabra/site/index.html",
  "abracadabra/site/viewer.css",
  "abracadabra/site/viewer.js",
  "assets/portfolio-sconesourcery-v3-720.webp",
  "assets/site-sourcery-hive-orchestra-v4.webp",
  "assets/site-sourcery-storm-atelier-v4.webp",
  "assets/work-demo-bright-spark-1440.webp",
  "assets/work-demo-bright-spark-720.webp",
  "assets/work-demo-bright-spark.png",
  "assets/work-demo-trattoria-1440.webp",
  "assets/work-demo-trattoria-720.webp",
  "assets/work-demo-trattoria.png",
  "assets/work-scone-current-1440.webp",
  "assets/work-scone-current-720.webp",
  "assets/work-scone-current.png",
  "atelier-commerce.js",
  "atelier-story.css",
  "automation.html",
  "contact.html",
  "contact/index.html",
  "custom/index.html",
  "custom/process/index.html",
  "custom/scope/index.html",
  "data/public-catalog.json",
  "data/release-control.json",
  "faq.html",
  "faq/index.html",
  "hive/hive-planner.js",
  "hive/index.html",
  "how-it-works.html",
  "index.html",
  "legal/index.html",
  "legal/privacy/index.html",
  "legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/index.html",
  "legal/website-terms/index.html",
  "legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2/index.html",
  "og.png",
  "package.json",
  "pricing.html",
  "print-collateral/sitesourcery-card-finalist-v9.html",
  "print-collateral/sitesourcery-card-finalist-v9.pdf",
  "privacy.html",
  "scripts/assets/sitesourcery-og-source.svg",
  "scripts/audit-artifact-from-sitemap.mjs",
  "scripts/browser-audit-vnext.mjs",
  "scripts/build-contained-artifact.mjs",
  "scripts/build-pages.mjs",
  "scripts/check-abracadabra-v1.mjs",
  "scripts/check-pricing.mjs",
  "scripts/check-routes.mjs",
  "scripts/check-site-vnext.mjs",
  "scripts/check-static.mjs",
  "scripts/containment-contract.mjs",
  "scripts/generate-og.mjs",
  "scripts/generate-site-vnext.mjs",
  "scripts/install-reviewed-chromium.sh",
  "scripts/payment-provider-placeholder.mjs",
  "scripts/prepare-containment.mjs",
  "scripts/private-preview/design-system.css",
  "scripts/private-preview/index.html",
  "scripts/private-preview/preview.js",
  "scripts/sync-shared-chrome.mjs",
  "scripts/test/abracadabra-platform.test.mjs",
  "scripts/test/abracadabra-v1.test.mjs",
  "scripts/test/browser-release-gate.test.mjs",
  "scripts/test/hive-planner.test.mjs",
  "scripts/test/payment-provider-placeholder.test.mjs",
  "scripts/test/public-truth-release.test.mjs",
  "scripts/test/site-vnext.test.mjs",
  "scripts/verify-public-truth-release.mjs",
  "scripts/visual-contact-sheet.html",
  "sitemap.xml",
  "solutions/index.html",
  "start/index.html",
  "style.css",
  "terms.html",
  "thanks.html",
  "the-difference.html",
  "the-meter.html",
  "the-moat.html",
  "the-responder.html",
  "vnext.css",
  "vnext.js",
  "work/index.html",
  "work/work.css",
]);

export const CONTROL_CHANGED_PATHS = Object.freeze([
  "data/public-truth-authority.json",
  "data/release-control.json",
]);

/*
 * These unchanged governance inputs receive an independent base-blob check in
 * addition to the exact changed-path check.
 */
export const FROZEN_BASE_BLOBS = Object.freeze({
  "package-lock.json": "4f7258d82d117541eedb3bf925e524772a6166ab",
});

/*
 * This is intentionally duplicated from (rather than imported from) the
 * reviewed Pages builder. The verifier must project only these exact public
 * source bytes; a legacy file or a newly added source file never becomes
 * deployable merely because it is present in the candidate tree.
 */
export const REVIEWED_PUBLIC_ARTIFACT_PATHS = Object.freeze([
  ".nojekyll",
  "404.html",
  "CNAME",
  "about.html",
  "about/index.html",
  "abracadabra/abracadabra-showcase.js",
  "abracadabra/app/abracadabra-app.css",
  "abracadabra/app/abracadabra-app.js",
  "abracadabra/app/abracadabra-compiler.js",
  "abracadabra/app/abracadabra-control-mode.js",
  "abracadabra/app/index.html",
  "abracadabra/how/index.html",
  "abracadabra/index.html",
  "alacazam/index.html",
  "alakazam/index.html",
  "assets/cursor-wand-active.svg",
  "assets/cursor-wand.svg",
  "assets/portfolio-sconesourcery-v3-720.webp",
  "assets/portfolio-sconesourcery-v3.webp",
  "assets/site-sourcery-arcane-atelier-v3.webp",
  "assets/site-sourcery-archive-room-v1.webp",
  "assets/site-sourcery-hive-orchestra-v4.webp",
  "assets/site-sourcery-index-room-v1.webp",
  "assets/site-sourcery-main-street-v2-landscape-1280.avif",
  "assets/site-sourcery-main-street-v2-landscape-1280.jpg",
  "assets/site-sourcery-main-street-v2-landscape-1280.webp",
  "assets/site-sourcery-main-street-v2-landscape-1672.avif",
  "assets/site-sourcery-main-street-v2-landscape-1672.jpg",
  "assets/site-sourcery-main-street-v2-landscape-1672.webp",
  "assets/site-sourcery-main-street-v2-landscape-960.avif",
  "assets/site-sourcery-main-street-v2-landscape-960.jpg",
  "assets/site-sourcery-main-street-v2-landscape-960.webp",
  "assets/site-sourcery-main-street-v2-portrait-360.avif",
  "assets/site-sourcery-main-street-v2-portrait-360.jpg",
  "assets/site-sourcery-main-street-v2-portrait-360.webp",
  "assets/site-sourcery-main-street-v2-portrait-529.avif",
  "assets/site-sourcery-main-street-v2-portrait-529.jpg",
  "assets/site-sourcery-main-street-v2-portrait-529.webp",
  "assets/site-sourcery-one-person-studio-v1.webp",
  "assets/site-sourcery-signal-room-v1.webp",
  "assets/site-sourcery-storm-atelier-v4.webp",
  "assets/site-sourcery-two-doors-v3.webp",
  "assets/work-daarx-current.jpg",
  "assets/work-demo-bright-spark-1440.webp",
  "assets/work-demo-bright-spark-720.webp",
  "assets/work-demo-bright-spark.png",
  "assets/work-demo-trattoria-1440.webp",
  "assets/work-demo-trattoria-720.webp",
  "assets/work-demo-trattoria.png",
  "assets/work-scone-current-1440.webp",
  "assets/work-scone-current-720.webp",
  "assets/work-scone-current.png",
  "automation.html",
  "care/index.html",
  "contact.html",
  "contact/index.html",
  "custom/index.html",
  "custom/process/index.html",
  "custom/scope/index.html",
  "domains/domain-search.js",
  "domains/index.html",
  "faq.html",
  "faq/index.html",
  "hive/index.html",
  "how-it-works.html",
  "index.html",
  "legal/index.html",
  "legal/privacy/index.html",
  "legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/index.html",
  "legal/website-terms/index.html",
  "legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2/index.html",
  "og.png",
  "pricing.html",
  "privacy.html",
  "responder/hive-planner.js",
  "responder/index.html",
  "robots.txt",
  "services/index.html",
  "sitemap.xml",
  "solutions/index.html",
  "start/index.html",
  "terms.html",
  "thanks.html",
  "the-difference.html",
  "the-meter.html",
  "the-moat.html",
  "the-responder.html",
  "vnext.css",
  "vnext.js",
  "websites/index.html",
  "websites/made-for-you/index.html",
  "work/index.html",
  "work/work.css",
]);

/*
 * Retained as a second, broad leakage boundary. It is not the publication
 * projection: REVIEWED_PUBLIC_ARTIFACT_PATHS is the sole positive ledger.
 */
export const EXCLUDED_ARTIFACT_TOP_LEVEL = Object.freeze([
  ".git",
  ".github",
  ".gitignore",
  ".htmlvalidate.json",
  ".nvmrc",
  "_hosted",
  "_site",
  "data",
  "flyer.html",
  "node_modules",
  "package-lock.json",
  "package.json",
  "print-collateral",
  "QUALITY.md",
  "scripts",
  "server",
]);

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DECIMAL_ID = /^[1-9][0-9]*$/u;
const EXACT_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u;
const GITHUB_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const PROHIBITED_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_JSON_BYTES = 128 * 1024;
const MAX_JSON_DEPTH = 32;
const PRIVATE_ARTIFACT_SEGMENT = /^(?:\.git|\.github|\.env(?:\..*)?|node_modules|scripts?|data|print-collateral|private|secrets?|credentials?)$/iu;
const PRIVATE_ARTIFACT_FILE = /(?:^|\/)(?:AGENTS\.md|QUALITY\.md|README(?:\.[^/]*)?|package(?:-lock)?\.json|release-control\.json|public-truth-authority\.json|[^/]+\.(?:pem|key|p12|pfx|crt|csr|log|map|mjs|cjs|ts|tsx|jsx|sh|py))$/iu;
const PAYMENT_ENDPOINT = /(?:buy\.stripe\.com|checkout\.stripe\.com|js\.stripe\.com|api\.stripe\.com|paypal\.com|paypalobjects\.com|braintreegateway\.com|checkout\.com|squareup\.com|square\.link|payment_intent|createCheckoutSession|apple-pay|google-pay)/iu;
const NETWORK_SINK = /\b(?:fetch\s*\(|XMLHttpRequest\b|sendBeacon\s*\(|WebSocket\s*\(|EventSource\s*\()/u;
const REVIEWED_DOMAIN_PREFLIGHT_PATH = "domains/domain-search.js";
const ENABLE_FORM = /(?:\.disabled\s*=\s*false\b|removeAttribute\s*\(\s*["']disabled["']|\.requestSubmit\s*\(|\.submit\s*\()/u;
const REVIEWED_NON_FORM_CONTROL_SHA256 = Object.freeze({
  "abracadabra/app/abracadabra-app.js":
    "09c250033e308c2f8c995eddff72ce050eeb7cd13b5897cf0f087e719f49f4eb",
  "domains/domain-search.js": REVIEWED_DOMAIN_PREFLIGHT_SHA256,
  "responder/hive-planner.js":
    "3f31972e1ba2342158694c5925208857d8c55692d51170fbe2c9489c80634eb6",
});
const HELD_ALAKAZAM_EXECUTABLE_SEMANTICS = Object.freeze([
  /\b(?:GRACE_DAYS|RETENTION_DAYS)\b|\b(?:graceDays|retentionDays)\s*:/u,
  /\[\s*["']purchase["']\s*,\s*["']byod["']\s*\]|\.path\s*===\s*["']purchase["']/u,
  /\.serving\.state\s*=\s*["']live["']|function\s+publish\s*\(|\bpublish\s*:\s*publish\b/u,
  /URLSearchParams\s*\([^)]*location\.search|sessionStorage\.getItem\s*\(\s*["']abracadabra\.(?:paid|alakazam)["']/u,
]);
const WEB3FORMS_MARKER = /web3forms/iu;
const ACCESS_KEY_MARKER = /(?:\bname\s*=\s*(?:"access_key"|'access_key'|access_key)|(?:"access_key"|'access_key'|\baccess_key\b)\s*[:=])/iu;
const RETIRED_321_IDENTITY = /(?:^|[^\d])(?:\+?1[\s().-]*)?321[\s().-]*788[\s.-]*2555(?:[^\d]|$)/iu;
const TEXT_PUBLIC_FILE = /(?:^|\.)(?:css|html|js|json|svg|txt|xml)$/iu;
const POSTDEPLOY_OBSERVATION_MAX_BYTES = 16 * 1024;

export class PublicTruthVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PublicTruthVerificationError";
  }
}

function fail(message) {
  throw new PublicTruthVerificationError(message);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseStringToken(text, cursor) {
  const start = cursor.index;
  cursor.index += 1;
  let escaped = false;
  while (cursor.index < text.length) {
    const character = text[cursor.index];
    cursor.index += 1;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') return JSON.parse(text.slice(start, cursor.index));
  }
  fail("JSON string is unterminated");
}

function skipWhitespace(text, cursor) {
  while (cursor.index < text.length && /\s/u.test(text[cursor.index])) cursor.index += 1;
}

function scanJsonValue(text, cursor, depth = 0) {
  if (depth > MAX_JSON_DEPTH) fail("JSON is too deeply nested");
  skipWhitespace(text, cursor);
  const character = text[cursor.index];
  if (character === "{") {
    cursor.index += 1;
    const keys = new Set();
    skipWhitespace(text, cursor);
    if (text[cursor.index] === "}") {
      cursor.index += 1;
      return;
    }
    while (cursor.index < text.length) {
      skipWhitespace(text, cursor);
      if (text[cursor.index] !== '"') fail("JSON object key syntax is invalid");
      const key = parseStringToken(text, cursor);
      if (keys.has(key)) fail(`duplicate JSON key: ${key}`);
      if (PROHIBITED_JSON_KEYS.has(key)) fail(`prohibited JSON key: ${key}`);
      keys.add(key);
      skipWhitespace(text, cursor);
      if (text[cursor.index] !== ":") fail("JSON object is missing a colon");
      cursor.index += 1;
      scanJsonValue(text, cursor, depth + 1);
      skipWhitespace(text, cursor);
      if (text[cursor.index] === "}") {
        cursor.index += 1;
        return;
      }
      if (text[cursor.index] !== ",") fail("JSON object separator is invalid");
      cursor.index += 1;
    }
    fail("JSON object is unterminated");
  }
  if (character === "[") {
    cursor.index += 1;
    skipWhitespace(text, cursor);
    if (text[cursor.index] === "]") {
      cursor.index += 1;
      return;
    }
    while (cursor.index < text.length) {
      scanJsonValue(text, cursor, depth + 1);
      skipWhitespace(text, cursor);
      if (text[cursor.index] === "]") {
        cursor.index += 1;
        return;
      }
      if (text[cursor.index] !== ",") fail("JSON array separator is invalid");
      cursor.index += 1;
    }
    fail("JSON array is unterminated");
  }
  if (character === '"') {
    parseStringToken(text, cursor);
    return;
  }
  const start = cursor.index;
  while (cursor.index < text.length && !/[\s,\]}]/u.test(text[cursor.index])) cursor.index += 1;
  if (cursor.index === start) fail("JSON value syntax is invalid");
  const token = text.slice(start, cursor.index);
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(token)) {
    const number = Number(token);
    if (!Number.isFinite(number)) fail("JSON contains a non-finite numeric literal");
  }
  JSON.parse(token);
}

function scanPlainJson(value, trail = "$", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) fail(`${trail} must be a finite safe integer`);
    return;
  }
  if (!value || typeof value !== "object") fail(`${trail} contains a non-JSON value`);
  if (seen.has(value)) fail(`${trail} contains a cycle`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanPlainJson(entry, `${trail}[${index}]`, seen));
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) fail(`${trail} must be a plain object`);
    for (const [key, child] of Object.entries(value)) {
      if (PROHIBITED_JSON_KEYS.has(key)) fail(`${trail} contains prohibited key ${key}`);
      scanPlainJson(child, `${trail}.${key}`, seen);
    }
  }
  seen.delete(value);
}

export function parseStrictJson(text) {
  if (typeof text !== "string") fail("JSON input must be text");
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) fail("JSON input is too large");
  const cursor = { index: 0 };
  try {
    scanJsonValue(text, cursor);
    skipWhitespace(text, cursor);
    if (cursor.index !== text.length) fail("JSON has trailing syntax");
    const value = JSON.parse(text);
    scanPlainJson(value);
    return value;
  } catch (error) {
    if (error instanceof PublicTruthVerificationError) throw error;
    fail(`JSON syntax is invalid: ${error.message}`);
  }
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (stableStringify(actual) !== stableStringify(expected)) {
    fail(`${label} keys must be exactly ${expected.join(", ")}`);
  }
  return value;
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || stableStringify(value) !== stableStringify(expected)) {
    fail(`${label} must equal the exact ordered allowlist`);
  }
  if (new Set(value).size !== value.length) fail(`${label} contains a duplicate`);
  return value;
}

function exactString(value, expected, label) {
  if (value !== expected) fail(`${label} must be ${expected}`);
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > 1000) {
    fail(`${label} must be one bounded nonempty trimmed string`);
  }
  return value;
}

function digest(value, label, width = 64) {
  const pattern = width === 40 ? SHA1 : SHA256;
  if (typeof value !== "string" || !pattern.test(value) || new Set(value).size === 1) {
    fail(`${label} must be one non-degenerate lowercase ${width === 40 ? "commit SHA" : "SHA-256"}`);
  }
  return value;
}

function decimalId(value, label) {
  if (typeof value !== "string" || !DECIMAL_ID.test(value)) fail(`${label} must be a canonical decimal string`);
  return value;
}

function exactTimestamp(value, label) {
  if (typeof value !== "string" || !EXACT_TIME.test(value)) fail(`${label} must be an exact whole-second UTC timestamp`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail(`${label} is not a real round-tripping timestamp`);
  }
  return milliseconds;
}

function safeRepositoryPath(file, label = "repository path") {
  if (
    typeof file !== "string"
    || file.length === 0
    || file.startsWith("/")
    || file.endsWith("/")
    || file.includes("\\")
    || /[\u0000-\u001f\u007f]/u.test(file)
    || file.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    || path.posix.normalize(file) !== file
  ) fail(`${label} is unsafe: ${JSON.stringify(file)}`);
  return file;
}

function git(cwd, args, { binary = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: binary ? null : "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const stderr = binary ? result.stderr.toString("utf8") : result.stderr;
    fail(`git ${args.join(" ")} failed: ${stderr.trim()}`);
  }
  return binary ? result.stdout : result.stdout.trim();
}

function verifyCommit(root, revision, label) {
  digest(revision, label, 40);
  exactString(git(root, ["rev-parse", "--verify", `${revision}^{commit}`]), revision, label);
  return revision;
}

function gitParent(root, revision, label) {
  const words = git(root, ["rev-list", "--parents", "-n", "1", revision]).split(/\s+/u);
  if (words.length !== 2 || words[0] !== revision) fail(`${label} must be one single-parent commit`);
  return words[1];
}

export function gitDiffPaths(root, from, to) {
  verifyCommit(root, from, "diff base");
  verifyCommit(root, to, "diff target");
  const output = git(root, ["diff", "--name-only", "-z", "--no-renames", from, to], { binary: true });
  const files = output.toString("utf8").split("\0").filter(Boolean);
  files.forEach((file) => safeRepositoryPath(file, "changed path"));
  return files.sort(lexicalCompare);
}

function readGitFile(root, revision, file) {
  verifyCommit(root, revision, "Git file revision");
  safeRepositoryPath(file);
  return git(root, ["cat-file", "blob", `${revision}:${file}`], { binary: true });
}

export function sourceManifestFromGit(root, revision = "HEAD") {
  const resolved = git(root, ["rev-parse", "--verify", `${revision}^{commit}`]);
  const tree = git(root, ["ls-tree", "-rz", "-r", "--full-tree", resolved], { binary: true });
  const entries = [];
  for (const record of tree.toString("utf8").split("\0")) {
    if (!record) continue;
    const match = /^([0-9]{6}) (blob|commit) ([0-9a-f]{40})\t([\s\S]+)$/u.exec(record);
    if (!match) fail(`unrecognized Git tree record ${JSON.stringify(record)}`);
    const [, mode, type, objectId, file] = match;
    safeRepositoryPath(file, "source-tree path");
    if (type !== "blob" || !["100644", "100755"].includes(mode)) {
      fail(`source tree contains forbidden ${type} or mode ${mode} at ${file}`);
    }
    const bytes = git(root, ["cat-file", "blob", objectId], { binary: true });
    entries.push(Object.freeze({ mode, path: file, sha256: sha256(bytes), size: bytes.length }));
  }
  entries.sort((left, right) => lexicalCompare(left.path, right.path));
  return Object.freeze({
    count: entries.length,
    entries: Object.freeze(entries),
    sha256: sha256(stableStringify(entries)),
  });
}

function artifactProjectionEntries(sourceManifest) {
  exactObject(sourceManifest, ["count", "entries", "sha256"], "source manifest");
  if (!Array.isArray(sourceManifest.entries)) fail("source manifest entries must be an array");
  if (
    !Number.isSafeInteger(sourceManifest.count)
    || sourceManifest.count !== sourceManifest.entries.length
  ) fail("source manifest count must exactly describe its entries");
  digest(sourceManifest.sha256, "source manifest SHA-256");

  const byPath = new Map();
  let previous = null;
  for (const [index, entry] of sourceManifest.entries.entries()) {
    exactObject(entry, ["mode", "path", "sha256", "size"], `source manifest entry ${index}`);
    if (!["100644", "100755"].includes(entry.mode)) {
      fail(`source manifest entry ${index} has a forbidden mode`);
    }
    safeRepositoryPath(entry.path, `source manifest entry ${index} path`);
    digest(entry.sha256, `source manifest entry ${index} SHA-256`);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      fail(`source manifest entry ${index} has an invalid size`);
    }
    if (previous !== null && lexicalCompare(previous, entry.path) >= 0) {
      fail("source manifest paths must be bytewise sorted and unique");
    }
    previous = entry.path;
    byPath.set(entry.path, entry);
  }
  if (sourceManifest.sha256 !== sha256(stableStringify(sourceManifest.entries))) {
    fail("source manifest SHA-256 does not match its entries");
  }

  const missing = REVIEWED_PUBLIC_ARTIFACT_PATHS.filter((file) => !byPath.has(file));
  if (missing.length > 0) {
    fail(`source manifest is missing reviewed public artifact path${missing.length === 1 ? "" : "s"} ${missing.join(", ")}`);
  }
  return REVIEWED_PUBLIC_ARTIFACT_PATHS.map((file) => {
    const { sha256: fileSha256, size } = byPath.get(file);
    return { path: file, sha256: fileSha256, size };
  });
}

async function walkArtifact(directory, base = directory, entries = []) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => lexicalCompare(a.name, b.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(base, absolute).split(path.sep).join("/");
    safeRepositoryPath(relative, "artifact path");
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) fail(`artifact contains a symbolic link at ${relative}`);
    if (stat.isDirectory()) {
      await walkArtifact(absolute, base, entries);
      continue;
    }
    if (!stat.isFile()) fail(`artifact contains a non-regular file at ${relative}`);
    const bytes = await readFile(absolute);
    entries.push(Object.freeze({ path: relative, sha256: sha256(bytes), size: bytes.length }));
  }
  return entries;
}

export async function artifactManifest(artifactRoot) {
  let rootStat;
  try {
    rootStat = await lstat(artifactRoot);
  } catch (error) {
    if (error?.code === "ENOENT") fail("artifact root is missing");
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("artifact root must be one real directory");
  const entries = await walkArtifact(artifactRoot);
  entries.sort((left, right) => lexicalCompare(left.path, right.path));
  if (entries.length === 0) fail("artifact must not be empty");
  return Object.freeze({
    count: entries.length,
    entries: Object.freeze(entries),
    sha256: sha256(stableStringify(entries)),
  });
}

function decodeHtml(value) {
  return value
    .replace(/&#x([0-9a-f]+);?/giu, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);?/gu, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&colon;/giu, ":")
    .replace(/&equals;/giu, "=")
    .replace(/&quot;/giu, '"')
    .replace(/&apos;|&#39;/giu, "'")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
}

export function forbiddenPublicMarkers(file, bytes) {
  safeRepositoryPath(file, "public marker path");
  if (!Buffer.isBuffer(bytes)) fail(`public marker bytes for ${file} must be a Buffer`);
  if (!TEXT_PUBLIC_FILE.test(file) && file !== "CNAME") return [];
  const source = decodeHtml(bytes.toString("utf8"));
  const markers = [];
  if (WEB3FORMS_MARKER.test(source)) markers.push("Web3Forms");
  if (ACCESS_KEY_MARKER.test(source)) markers.push("access_key");
  if (RETIRED_321_IDENTITY.test(source)) markers.push("retired 321 identity");
  return markers;
}

function hasExactHtmlAttribute(attributes, name, expected = null) {
  const expression = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=\u0060<>]+))`, "iu");
  const match = expression.exec(attributes);
  if (!match) return false;
  if (expected === null) return true;
  return (match[1] ?? match[2] ?? match[3] ?? "").trim().toLowerCase() === expected;
}

function assertHeldForms(file, html) {
  const decoded = decodeHtml(html);
  const forms = [...decoded.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/giu)];
  const openCount = [...decoded.matchAll(/<form\b/giu)].length;
  if (forms.length !== openCount) fail(`${file} contains malformed or nested form markup`);
  for (const [, attributes, body] of forms) {
    if (
      hasExactHtmlAttribute(attributes, "action")
      || hasExactHtmlAttribute(attributes, "method")
      || hasExactHtmlAttribute(attributes, "target")
      || hasExactHtmlAttribute(attributes, "enctype")
      || hasExactHtmlAttribute(attributes, "formaction")
    ) fail(`${file} contains an active form transport attribute`);
    if (
      !hasExactHtmlAttribute(attributes, "data-commercial-state", "hold")
      || !hasExactHtmlAttribute(attributes, "data-no-entry", "true")
      || !hasExactHtmlAttribute(attributes, "aria-disabled", "true")
      || !hasExactHtmlAttribute(attributes, "onsubmit", "return false")
    ) fail(`${file} contains a form without the exact held/non-transmitting boundary`);
    const barrier = /<fieldset\b([^>]*)>/iu.exec(body);
    if (
      !barrier
      || !hasExactHtmlAttribute(barrier[1], "data-no-entry-barrier", "true")
      || !/(?:^|\s)disabled(?:\s|=|$)/iu.test(barrier[1])
      || !hasExactHtmlAttribute(barrier[1], "aria-disabled", "true")
    ) fail(`${file} contains a form without one disabled no-entry fieldset`);
    const firstBarrier = barrier.index + barrier[0].length;
    const lastBarrier = body.toLowerCase().lastIndexOf("</fieldset");
    if (lastBarrier < firstBarrier) fail(`${file} contains an unclosed no-entry fieldset`);
    const outsideBarrier = `${body.slice(0, barrier.index)}${body.slice(lastBarrier + "</fieldset".length)}`;
    if (/<(?:input|textarea|select|button)\b/iu.test(outsideBarrier)) {
      fail(`${file} contains a form control outside the disabled no-entry fieldset`);
    }
    for (const button of body.matchAll(/<(?:button|input)\b([^>]*)>/giu)) {
      const type = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=\u0060<>]+))/iu.exec(button[1]);
      if ((type?.[1] ?? type?.[2] ?? type?.[3] ?? "").toLowerCase() === "submit" && !/(?:^|\s)disabled(?:\s|=|$)/iu.test(button[1])) {
        fail(`${file} contains an enabled submit control`);
      }
      if (hasExactHtmlAttribute(button[1], "formaction")) fail(`${file} contains a submit-control formaction`);
    }
  }
  if (/<[^>]+\bcontenteditable(?:\s*=\s*(?:"true"|'true'|true))?[^>]*>/iu.test(decoded)) {
    fail(`${file} contains an editable public input surface`);
  }
  if (PAYMENT_ENDPOINT.test(decoded)) fail(`${file} contains an active payment-provider endpoint`);
  for (const match of decoded.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=\u0060<>]+))/giu)) {
    const target = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (
      !target.startsWith("#")
      && /(?:^|\/)(?:checkout|cart|pay|payment|purchase|order)(?:[/?#.]|$)/iu.test(target)
    ) fail(`${file} contains an active payment or ordering route`);
  }
  if (NETWORK_SINK.test(decoded)) fail(`${file} contains an active inline browser network sink`);
  if (ENABLE_FORM.test(decoded)) fail(`${file} can enable or submit a held form`);
}

function assertDirectInquiryGuide(file, html) {
  const decoded = decodeHtml(html);
  const markup = decoded
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<(?:script|style|template)\b[\s\S]*?<\/(?:script|style|template)\s*>/giu, "");
  const forbiddenSurface = /<(form|input|select|textarea)\b/iu.exec(markup);
  if (forbiddenSurface) {
    fail(`${file} direct-inquiry guide contains forbidden <${forbiddenSurface[1].toLowerCase()}> markup`);
  }
  if (/<[^>]*\bcontenteditable\b[^>]*>/iu.test(markup)) {
    fail(`${file} direct-inquiry guide contains a contenteditable surface`);
  }
  for (const button of markup.matchAll(/<button\b([^>]*)>/giu)) {
    const type = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=\u0060<>]+))/iu.exec(button[1]);
    const buttonType = (type?.[1] ?? type?.[2] ?? type?.[3] ?? "").trim().toLowerCase();
    if (buttonType === "submit" || hasExactHtmlAttribute(button[1], "formaction")) {
      fail(`${file} direct-inquiry guide contains a submit control`);
    }
  }
  const hasBoundary = [...markup.matchAll(/<(?:article|section)\b([^>]*)>/giu)].some((match) => (
    hasExactHtmlAttribute(match[1], "data-intake-state", "open")
  ));
  if (!hasBoundary) fail(`${file} lacks the exact open-intake boundary`);
  const hrefs = [...markup.matchAll(/<a\b([^>]*)>/giu)]
    .map((match) => {
      const href = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=\u0060<>]+))/iu.exec(match[1]);
      return (href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
    });
  if (!hrefs.includes("tel:+18562441220")) {
    fail(`${file} lacks the exact public call route`);
  }
  if (!hrefs.some((href) => href === "mailto:sitesourcery@proton.me" || href.startsWith("mailto:sitesourcery@proton.me?"))) {
    fail(`${file} lacks the exact designated studio email route`);
  }
}

function assertReviewedDomainPreflight(file, source, bytes) {
  const requiredFragments = Object.freeze([
    ["Cloudflare resolver", 'var RESOLVER = "https://cloudflare-dns.com/dns-query";'],
    ["three reviewed candidates", 'var ENDINGS = ["com", "net", "org"];'],
    ["NS-only query", 'var url = RESOLVER + "?name=" + encodeURIComponent(domain) + "&type=NS";'],
    ["explicit GET request", 'return fetch(url, { method: "GET", headers: { accept: "application/dns-json" } })'],
    ["candidate projection", 'var domains = ENDINGS.map(function (ending) { return name + "." + ending; });'],
    ["one preflight per candidate", "Promise.all(domains.map(check)).then(function (states) {"],
    ["click trigger", 'button.addEventListener("click", run);'],
  ]);
  for (const [label, fragment] of requiredFragments) {
    if (!source.includes(fragment)) {
      fail(`${file} reviewed DNS preflight changed its ${label}`);
    }
  }
  if ((source.match(/\bfetch\s*\(/gu) ?? []).length !== 1) {
    fail(`${file} reviewed DNS preflight must contain exactly one fetch call`);
  }
  if (
    /addEventListener\s*\(\s*["'](?:DOMContentLoaded|load)["']/u.test(source)
    || /\b(?:window|document)\.onload\s*=/u.test(source)
  ) {
    fail(`${file} reviewed DNS preflight must remain user-triggered and cannot run on load`);
  }
  if (sha256(bytes) !== REVIEWED_DOMAIN_PREFLIGHT_SHA256) {
    fail(`${file} must match the exact reviewed DNS preflight digest ${REVIEWED_DOMAIN_PREFLIGHT_SHA256}`);
  }
}

export async function validateArtifactSafety(
  artifactRoot,
  sourceManifest,
  { expectedEntries } = {},
) {
  const actual = await artifactManifest(artifactRoot);
  const projection = expectedEntries === undefined
    ? artifactProjectionEntries(sourceManifest)
    : validateArtifactManifestShape({
        count: expectedEntries.length,
        entries: expectedEntries,
        sha256: sha256(stableStringify(expectedEntries)),
      }).entries;
  for (const entry of actual.entries) {
    const segments = entry.path.split("/");
    if (
      segments.some((segment) => PRIVATE_ARTIFACT_SEGMENT.test(segment))
      || PRIVATE_ARTIFACT_FILE.test(entry.path)
      || (entry.path.startsWith(".") && entry.path !== ".nojekyll")
    ) fail(`artifact contains development, governance, or private path ${entry.path}`);
    const bytes = await readFile(path.join(artifactRoot, ...entry.path.split("/")));
    const forbidden = forbiddenPublicMarkers(entry.path, bytes);
    if (forbidden.length > 0) {
      fail(`${entry.path} contains forbidden public marker${forbidden.length === 1 ? "" : "s"} ${forbidden.join(", ")}`);
    }
    if (entry.path.endsWith(".html")) {
      const html = bytes.toString("utf8");
      assertHeldForms(entry.path, html);
      if (entry.path === "contact/index.html") {
        assertDirectInquiryGuide(entry.path, html);
      }
    }
    if (entry.path.endsWith(".js")) {
      const source = decodeHtml(bytes.toString("utf8"));
      if (PAYMENT_ENDPOINT.test(source)) fail(`${entry.path} contains an active payment-provider endpoint`);
      if (entry.path === REVIEWED_DOMAIN_PREFLIGHT_PATH) {
        assertReviewedDomainPreflight(entry.path, source, bytes);
      } else if (NETWORK_SINK.test(source)) {
        fail(`${entry.path} contains an active browser network sink`);
      }
      for (const semantic of HELD_ALAKAZAM_EXECUTABLE_SEMANTICS) {
        if (semantic.test(source)) {
          fail(`${entry.path} contains held Alakazam executable semantics ${semantic}`);
        }
      }
      if (
        ENABLE_FORM.test(source)
        && REVIEWED_NON_FORM_CONTROL_SHA256[entry.path] !== sha256(bytes)
      ) {
        fail(`${entry.path} can enable or submit a held form`);
      }
    }
  }
  if (stableStringify(actual.entries) !== stableStringify(projection)) {
    const actualPaths = actual.entries.map((entry) => entry.path);
    const expectedPaths = projection.map((entry) => entry.path);
    const extra = actualPaths.filter((file) => !expectedPaths.includes(file));
    const missing = expectedPaths.filter((file) => !actualPaths.includes(file));
    fail(`artifact is not the exact candidate projection (extra: ${extra.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}; content mutation is also denied)`);
  }
  const finalManifest = await artifactManifest(artifactRoot);
  if (stableStringify(finalManifest.entries) !== stableStringify(actual.entries)) {
    fail("artifact changed while it was being verified");
  }
  return finalManifest;
}

export function validateArtifactManifestShape(manifest) {
  exactObject(manifest, ["count", "entries", "sha256"], "artifact manifest");
  if (
    !Number.isSafeInteger(manifest.count)
    || manifest.count < 1
    || manifest.count > 1024
    || !Array.isArray(manifest.entries)
    || manifest.entries.length !== manifest.count
  ) fail("artifact manifest count must exactly describe one to 1024 entries");
  digest(manifest.sha256, "artifact manifest SHA-256");
  const paths = [];
  for (const [index, entry] of manifest.entries.entries()) {
    exactObject(entry, ["path", "sha256", "size"], `artifact manifest entry ${index}`);
    safeRepositoryPath(entry.path, `artifact manifest entry ${index} path`);
    digest(entry.sha256, `artifact manifest entry ${index} SHA-256`);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 128 * 1024 * 1024) {
      fail(`artifact manifest entry ${index} size is outside the allowed bound`);
    }
    paths.push(entry.path);
  }
  const sorted = [...paths].sort(lexicalCompare);
  if (stableStringify(paths) !== stableStringify(sorted) || new Set(paths).size !== paths.length) {
    fail("artifact manifest paths must be bytewise sorted and unique");
  }
  exactString(
    manifest.sha256,
    sha256(stableStringify(manifest.entries)),
    "artifact manifest recomputed SHA-256",
  );
  return manifest;
}

export function normalizeLiveOrigin(origin) {
  if (typeof origin !== "string" || origin.trim() !== origin || origin.length === 0 || origin.length > 2048) {
    fail("live origin must be one bounded trimmed URL");
  }
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    fail("live origin must be one absolute URL");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
    || parsed.port !== ""
  ) fail("live origin must be one credential-free default-port HTTPS origin with no path, query, or fragment");
  return parsed.origin;
}

export function artifactPublicPath(file) {
  safeRepositoryPath(file, "artifact public path");
  if (file === "index.html") return "/";
  if (file.endsWith("/index.html")) return `/${file.slice(0, -"index.html".length)}`;
  return `/${file}`;
}

function validatePostdeployDurations({
  propagationWindowMs,
  pollIntervalMs,
  requestTimeoutMs,
}) {
  for (const [value, label, maximum] of [
    [propagationWindowMs, "postdeploy propagation window", 30 * 60 * 1000],
    [pollIntervalMs, "postdeploy poll interval", 5 * 60 * 1000],
    [requestTimeoutMs, "postdeploy request timeout", 60 * 1000],
  ]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      fail(`${label} must be a positive safe integer no greater than ${maximum}ms`);
    }
  }
  if (pollIntervalMs > propagationWindowMs) {
    fail("postdeploy poll interval must not exceed the propagation window");
  }
}

export function validateProductionRouteManifest(manifest) {
  validateArtifactManifestShape(manifest);
  const paths = new Set(manifest.entries.map((entry) => entry.path));
  for (const [route, file] of Object.entries(PRODUCTION_CANONICAL_ROUTE_FILES)) {
    if (!paths.has(file)) fail(`production artifact is missing canonical route ${route} at ${file}`);
    if (artifactPublicPath(file) !== route) {
      fail(`production canonical route ${route} does not map exactly to ${file}`);
    }
  }
  if (!paths.has("404.html")) fail("production artifact is missing the custom 404 document");
  for (const file of Object.keys(PRODUCTION_LEGACY_REDIRECTS)) {
    if (SOURCE_ONLY_LEGACY_REDIRECT && file === SOURCE_ONLY_LEGACY_REDIRECT) {
      if (paths.has(file)) fail(`${SOURCE_ONLY_LEGACY_REDIRECT} must remain absent from the production artifact`);
    } else if (!paths.has(file)) {
      fail(`production artifact is missing legacy redirect ${file}`);
    }
  }
  const publicPaths = manifest.entries.map((entry) => artifactPublicPath(entry.path));
  if (new Set(publicPaths).size !== publicPaths.length) {
    fail("two production artifact files resolve to the same public path");
  }
  return manifest;
}

function custom404ProbePath(manifest) {
  return `/sitesourcery-production-proof-${manifest.sha256.slice(0, 24)}-missing/`;
}

function productionResourcePlan(manifest, origin) {
  validateProductionRouteManifest(manifest);
  const normalizedOrigin = normalizeLiveOrigin(origin);
  const missing = manifest.entries.find((entry) => entry.path === "404.html");
  const resources = manifest.entries.map((entry) => {
    const pathname = artifactPublicPath(entry.path);
    return Object.freeze({
      expectedSha256: entry.sha256,
      expectedSize: entry.size,
      expectedStatus: 200,
      file: entry.path,
      key: `artifact:${entry.path}`,
      kind: "artifact",
      pathname,
      url: new URL(pathname, `${normalizedOrigin}/`).href,
    });
  });
  const absenceProbes = [["custom-404", custom404ProbePath(manifest)]];
  if (SOURCE_ONLY_LEGACY_REDIRECT) {
    absenceProbes.push(["source-only-redirect", `/${SOURCE_ONLY_LEGACY_REDIRECT}`]);
  }
  for (const [key, pathname] of absenceProbes) {
    resources.push(Object.freeze({
      expectedSha256: missing.sha256,
      expectedSize: missing.size,
      expectedStatus: 404,
      file: "404.html",
      key: `absence:${key}`,
      kind: key,
      pathname,
      url: new URL(pathname, `${normalizedOrigin}/`).href,
    }));
  }
  return Object.freeze(resources);
}

async function readBoundedResponse(response, maximumBytes, controller) {
  if (!response.body) return { bytes: Buffer.alloc(0), overflow: false };
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      length += chunk.length;
      if (length > maximumBytes) {
        controller.abort();
        return {
          bytes: Buffer.concat([...chunks, chunk], Math.min(length, maximumBytes + 1)),
          overflow: true,
        };
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes: Buffer.concat(chunks, length), overflow: false };
}

function boundedErrorMessage(error) {
  const message = typeof error?.message === "string" ? error.message : String(error);
  return message.replace(/\s+/gu, " ").trim().slice(0, 500) || "unknown request failure";
}

async function requestProductionHead({
  fetchImpl,
  requestTimeoutMs,
  resource,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetchImpl(resource.url, {
      cache: "no-store",
      credentials: "omit",
      headers: Object.freeze({
        "accept": "*/*",
        "cache-control": "no-cache",
        "pragma": "no-cache",
      }),
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
    });
    if (
      !response
      || !Number.isSafeInteger(response.status)
      || response.status < 100
      || response.status > 599
    ) throw new Error(`postdeploy HEAD returned an invalid response for ${resource.pathname}`);
    const finalUrl = typeof response.url === "string" && response.url !== ""
      ? response.url
      : resource.url;
    const location = typeof response.headers?.get === "function"
      ? response.headers.get("location")
      : null;
    const failures = [];
    if (response.status !== resource.expectedStatus) {
      failures.push(`status ${response.status} != ${resource.expectedStatus}`);
    }
    if (finalUrl !== resource.url || response.redirected === true || location !== null) {
      failures.push("redirect observed");
    }
    return Object.freeze({
      error: null,
      exact: failures.length === 0,
      failures: Object.freeze(failures),
      status: response.status,
    });
  } catch (error) {
    return Object.freeze({
      error: boundedErrorMessage(error),
      exact: false,
      failures: Object.freeze(["request failed"]),
      status: null,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestProductionResource({
  fetchImpl,
  requestTimeoutMs,
  resource,
}) {
  if (typeof fetchImpl !== "function") fail("postdeploy proof requires a fetch implementation");
  const head = await requestProductionHead({
    fetchImpl,
    requestTimeoutMs,
    resource,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetchImpl(resource.url, {
      cache: "no-store",
      credentials: "omit",
      headers: Object.freeze({
        "accept": "*/*",
        "cache-control": "no-cache",
        "pragma": "no-cache",
      }),
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    if (
      !response
      || !Number.isSafeInteger(response.status)
      || response.status < 100
      || response.status > 599
      || typeof response.arrayBuffer !== "function"
    ) throw new Error(`postdeploy GET returned an invalid response for ${resource.pathname}`);
    const { bytes, overflow } = await readBoundedResponse(
      response,
      resource.expectedSize,
      controller,
    );
    const finalUrl = typeof response.url === "string" && response.url !== ""
      ? response.url
      : resource.url;
    const location = typeof response.headers?.get === "function"
      ? response.headers.get("location")
      : null;
    const markers = forbiddenPublicMarkers(resource.file, bytes);
    const actualSha256 = overflow ? null : sha256(bytes);
    const exact = (
      head.exact
      && !overflow
      && response.status === resource.expectedStatus
      && finalUrl === resource.url
      && response.redirected !== true
      && location === null
      && bytes.length === resource.expectedSize
      && actualSha256 === resource.expectedSha256
      && markers.length === 0
    );
    const failures = head.failures.map((failure) => `HEAD ${failure}`);
    if (overflow) failures.push("body exceeds expected size");
    if (response.status !== resource.expectedStatus) {
      failures.push(`status ${response.status} != ${resource.expectedStatus}`);
    }
    if (finalUrl !== resource.url || response.redirected === true || location !== null) {
      failures.push("redirect observed");
    }
    if (!overflow && bytes.length !== resource.expectedSize) {
      failures.push(`size ${bytes.length} != ${resource.expectedSize}`);
    }
    if (!overflow && actualSha256 !== resource.expectedSha256) failures.push("SHA-256 mismatch");
    if (markers.length > 0) failures.push(`forbidden markers: ${markers.join(", ")}`);
    return {
      body: bytes,
      evidence: Object.freeze({
        actualSha256,
        actualSize: overflow ? resource.expectedSize + 1 : bytes.length,
        error: null,
        exact,
        expectedSha256: resource.expectedSha256,
        expectedSize: resource.expectedSize,
        expectedStatus: resource.expectedStatus,
        failures: Object.freeze(failures),
        file: resource.file,
        forbiddenMarkers: Object.freeze(markers),
        headError: head.error,
        headFailures: head.failures,
        headStatus: head.status,
        key: resource.key,
        kind: resource.kind,
        pathname: resource.pathname,
        status: response.status,
        url: resource.url,
      }),
    };
  } catch (error) {
    return {
      body: null,
      evidence: Object.freeze({
        actualSha256: null,
        actualSize: null,
        error: boundedErrorMessage(error),
        exact: false,
        expectedSha256: resource.expectedSha256,
        expectedSize: resource.expectedSize,
        expectedStatus: resource.expectedStatus,
        failures: Object.freeze([
          ...head.failures.map((failure) => `HEAD ${failure}`),
          "GET failed",
        ]),
        file: resource.file,
        forbiddenMarkers: Object.freeze([]),
        headError: head.error,
        headFailures: head.failures,
        headStatus: head.status,
        key: resource.key,
        kind: resource.kind,
        pathname: resource.pathname,
        status: null,
        url: resource.url,
      }),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency(values, concurrency, callback) {
  if (
    !Array.isArray(values)
    || !Number.isSafeInteger(concurrency)
    || concurrency < 1
    || typeof callback !== "function"
  ) fail("postdeploy request scheduler received an invalid plan");
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await callback(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function inspectLiveProductionSnapshot({
  manifest,
  origin,
  resourceKeys,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = POSTDEPLOY_REQUEST_TIMEOUT_MS,
} = {}) {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 60 * 1000) {
    fail("postdeploy request timeout is outside the allowed bound");
  }
  const plan = productionResourcePlan(manifest, origin);
  const allowed = new Set(plan.map((resource) => resource.key));
  const selected = resourceKeys === undefined
    ? plan
    : (() => {
        if (
          !Array.isArray(resourceKeys)
          || resourceKeys.length === 0
          || new Set(resourceKeys).size !== resourceKeys.length
          || resourceKeys.some((key) => !allowed.has(key))
        ) fail("postdeploy resource keys must be one nonempty unique subset of the production plan");
        const requested = new Set(resourceKeys);
        return plan.filter((resource) => requested.has(resource.key));
      })();
  const results = await mapWithConcurrency(
    selected,
    POSTDEPLOY_REQUEST_CONCURRENCY,
    (resource) => requestProductionResource({
      fetchImpl,
      requestTimeoutMs,
      resource,
    }),
  );
  const resources = [];
  const bodies = new Map();
  for (const [index, result] of results.entries()) {
    const resource = selected[index];
    resources.push(result.evidence);
    if (result.body) bodies.set(resource.key, result.body);
  }
  const mismatchKeys = resources.filter((resource) => !resource.exact).map((resource) => resource.key);
  const forbidden = resources.flatMap((resource) => (
    resource.forbiddenMarkers.map((marker) => `${resource.pathname}: ${marker}`)
  ));
  return Object.freeze({
    bodies,
    checkedCount: resources.length,
    exact: mismatchKeys.length === 0,
    exactCount: resources.length - mismatchKeys.length,
    forbidden: Object.freeze(forbidden),
    full: selected.length === plan.length,
    mismatchKeys: Object.freeze(mismatchKeys),
    resources: Object.freeze(resources),
    totalResourceCount: plan.length,
  });
}

function postdeployFailure(message, details) {
  const error = new PublicTruthVerificationError(message);
  error.postdeployEvidence = details;
  throw error;
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function pollLiveProduction({
  manifest,
  origin,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = defaultSleep,
  propagationWindowMs = POSTDEPLOY_PROPAGATION_WINDOW_MS,
  pollIntervalMs = POSTDEPLOY_POLL_INTERVAL_MS,
  requestTimeoutMs = POSTDEPLOY_REQUEST_TIMEOUT_MS,
} = {}) {
  validatePostdeployDurations({
    propagationWindowMs,
    pollIntervalMs,
    requestTimeoutMs,
  });
  validateProductionRouteManifest(manifest);
  const normalizedOrigin = normalizeLiveOrigin(origin);
  if (typeof now !== "function" || typeof sleep !== "function") {
    fail("postdeploy proof requires clock and sleep functions");
  }
  const startedAtMs = now();
  if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0) {
    fail("postdeploy clock must return a nonnegative safe integer");
  }
  const maximumAttempts = Math.ceil(propagationWindowMs / pollIntervalMs)
    + POSTDEPLOY_REQUIRED_EXACT_SNAPSHOTS + 2;
  const attempts = [];
  let consecutiveExactFullSnapshots = 0;
  let pendingKeys;
  let finalSnapshot = null;

  for (let sequence = 1; sequence <= maximumAttempts; sequence += 1) {
    const snapshot = await inspectLiveProductionSnapshot({
      manifest,
      origin: normalizedOrigin,
      resourceKeys: pendingKeys,
      fetchImpl,
      requestTimeoutMs,
    });
    const observedAtMs = now();
    if (!Number.isSafeInteger(observedAtMs) || observedAtMs < startedAtMs) {
      fail("postdeploy clock moved backwards or returned an invalid time");
    }
    const elapsedMs = observedAtMs - startedAtMs;
    attempts.push(Object.freeze({
      checkedCount: snapshot.checkedCount,
      elapsedMs,
      exactCount: snapshot.exactCount,
      forbidden: snapshot.forbidden,
      full: snapshot.full,
      mismatchKeys: snapshot.mismatchKeys,
      sequence,
    }));
    if (snapshot.exact && snapshot.full) {
      consecutiveExactFullSnapshots += 1;
      finalSnapshot = snapshot;
      pendingKeys = undefined;
      if (
        consecutiveExactFullSnapshots >= POSTDEPLOY_REQUIRED_EXACT_SNAPSHOTS
        && elapsedMs <= propagationWindowMs
      ) {
        return Object.freeze({
          attempts: Object.freeze(attempts),
          completedAtMs: observedAtMs,
          consecutiveExactFullSnapshots,
          finalSnapshot,
          origin: normalizedOrigin,
          propagationWindowMs,
          startedAtMs,
        });
      }
    } else if (snapshot.exact) {
      consecutiveExactFullSnapshots = 0;
      pendingKeys = undefined;
    } else {
      consecutiveExactFullSnapshots = 0;
      pendingKeys = [...snapshot.mismatchKeys];
    }
    if (elapsedMs >= propagationWindowMs || sequence === maximumAttempts) {
      const mismatches = snapshot.mismatchKeys.join(", ") || "no two consecutive full exact snapshots";
      const forbidden = snapshot.forbidden.length > 0
        ? `; forbidden markers: ${snapshot.forbidden.join("; ")}`
        : "";
      postdeployFailure(
        `postdeploy propagation timed out after ${elapsedMs}ms; unresolved: ${mismatches}${forbidden}`,
        Object.freeze({
          attempts: Object.freeze(attempts),
          completedAtMs: observedAtMs,
          origin: normalizedOrigin,
          resources: snapshot.resources,
          result: "fail",
          startedAtMs,
        }),
      );
    }
    await sleep(Math.min(pollIntervalMs, propagationWindowMs - elapsedMs));
  }
  fail("postdeploy propagation loop exhausted its deterministic bound");
}

function htmlAttributeValue(attributes, name) {
  const expression = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=\u0060<>]+))`,
    "iu",
  );
  const match = expression.exec(attributes);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function htmlTags(source, name) {
  const expression = new RegExp(`<${name}\\b([^>]*)>`, "giu");
  return [...source.matchAll(expression)].map((match) => match[1]);
}

function htmlTagsWithAttribute(source, name, attribute, expected) {
  return htmlTags(source, name).filter((attributes) => (
    (htmlAttributeValue(attributes, attribute) ?? "").toLowerCase() === expected
  ));
}

async function exactArtifactText(artifactRoot, manifest, file) {
  const entry = manifest.entries.find((candidate) => candidate.path === file);
  if (!entry) fail(`production route contract is missing ${file}`);
  const bytes = await readFile(path.join(artifactRoot, ...file.split("/")));
  if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) {
    fail(`production route contract bytes differ from the manifest at ${file}`);
  }
  return bytes.toString("utf8");
}

function assertCanonicalProductionHtml(route, file, source) {
  const canonical = htmlTags(source, "link").filter((attributes) => (
    (htmlAttributeValue(attributes, "rel") ?? "").toLowerCase().split(/\s+/u).includes("canonical")
  ));
  const expected = new URL(route, `${PRODUCTION_ORIGIN}/`).href;
  if (canonical.length !== 1 || htmlAttributeValue(canonical[0], "href") !== expected) {
    fail(`live canonical route ${route} must carry exactly ${expected}`);
  }
  if (htmlTagsWithAttribute(source, "meta", "http-equiv", "refresh").length > 0) {
    fail(`live canonical route ${route} must not contain a meta refresh`);
  }
  const noindex = htmlTagsWithAttribute(source, "meta", "name", "robots").some((attributes) => (
    (htmlAttributeValue(attributes, "content") ?? "").toLowerCase().split(/[\s,]+/u).includes("noindex")
  ));
  if (noindex) fail(`live canonical route ${route} must remain indexable`);
  if (!file.endsWith("index.html")) fail(`live canonical route ${route} has a non-index artifact file`);
}

function assertLegacyProductionRedirect(file, target, source) {
  const robots = htmlTagsWithAttribute(source, "meta", "name", "robots");
  if (
    robots.length !== 1
    || !(htmlAttributeValue(robots[0], "content") ?? "").toLowerCase().split(/[\s,]+/u).includes("noindex")
  ) fail(`live legacy redirect ${file} must carry one robots noindex directive`);
  const refresh = htmlTagsWithAttribute(source, "meta", "http-equiv", "refresh");
  const expectedRefresh = `0;url=${target}`;
  if (
    refresh.length !== 1
    || (htmlAttributeValue(refresh[0], "content") ?? "").replace(/\s+/gu, "") !== expectedRefresh
  ) fail(`live legacy redirect ${file} refresh must be ${expectedRefresh}`);
  const canonical = htmlTags(source, "link").filter((attributes) => (
    (htmlAttributeValue(attributes, "rel") ?? "").toLowerCase().split(/\s+/u).includes("canonical")
  ));
  const expectedCanonical = new URL(target, `${PRODUCTION_ORIGIN}/`).href;
  if (canonical.length !== 1 || htmlAttributeValue(canonical[0], "href") !== expectedCanonical) {
    fail(`live legacy redirect ${file} canonical must be ${expectedCanonical}`);
  }
  if (!htmlTags(source, "a").some((attributes) => htmlAttributeValue(attributes, "href") === target)) {
    fail(`live legacy redirect ${file} must include a fallback link to ${target}`);
  }
  if (/<form\b|<(?:script|iframe)\b/iu.test(source)) {
    fail(`live legacy redirect ${file} must not contain forms, scripts, or frames`);
  }
}

export async function verifyProductionRouteContract({
  artifactRoot,
  manifest,
  finalSnapshot,
} = {}) {
  validateProductionRouteManifest(manifest);
  if (
    typeof artifactRoot !== "string"
    || artifactRoot.length === 0
    || !finalSnapshot
    || finalSnapshot.full !== true
    || finalSnapshot.exact !== true
  ) fail("production route contract requires one exact full live snapshot and artifact root");
  const byKey = new Map(finalSnapshot.resources.map((resource) => [resource.key, resource]));
  for (const entry of manifest.entries) {
    if (byKey.get(`artifact:${entry.path}`)?.exact !== true) {
      fail(`production route contract lacks an exact live result for ${entry.path}`);
    }
  }
  if (byKey.get("absence:custom-404")?.exact !== true) {
    fail("production custom 404 route did not return the exact 404 document and status");
  }
  if (
    SOURCE_ONLY_LEGACY_REDIRECT
    && byKey.get("absence:source-only-redirect")?.exact !== true
  ) {
    fail(`${SOURCE_ONLY_LEGACY_REDIRECT} did not resolve through the exact custom 404 contract`);
  }
  for (const [route, file] of Object.entries(PRODUCTION_CANONICAL_ROUTE_FILES)) {
    assertCanonicalProductionHtml(
      route,
      file,
      await exactArtifactText(artifactRoot, manifest, file),
    );
  }
  const notFound = await exactArtifactText(artifactRoot, manifest, "404.html");
  const notFoundRobots = htmlTagsWithAttribute(notFound, "meta", "name", "robots");
  const notFoundNoindex = notFoundRobots.some((attributes) => (
    (htmlAttributeValue(attributes, "content") ?? "").toLowerCase().split(/[\s,]+/u).includes("noindex")
  ));
  if (!notFoundNoindex || htmlTags(notFound, "h1").length !== 1) {
    fail("production custom 404 document must carry noindex and exactly one h1");
  }
  for (const [file, target] of Object.entries(PRODUCTION_LEGACY_REDIRECTS)) {
    if (SOURCE_ONLY_LEGACY_REDIRECT && file === SOURCE_ONLY_LEGACY_REDIRECT) continue;
    assertLegacyProductionRedirect(
      file,
      target,
      await exactArtifactText(artifactRoot, manifest, file),
    );
  }
  return Object.freeze({
    canonicalRoutes: Object.freeze(Object.keys(PRODUCTION_CANONICAL_ROUTE_FILES)),
    custom404Path: custom404ProbePath(manifest),
    legacyRedirects: Object.freeze(
      Object.keys(PRODUCTION_LEGACY_REDIRECTS).filter((file) => file !== SOURCE_ONLY_LEGACY_REDIRECT),
    ),
    sourceOnlyRedirectAbsence: SOURCE_ONLY_LEGACY_REDIRECT,
  });
}

function htmlToText(html) {
  return decodeHtml(html)
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/giu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&rsquo;|&#8217;|&#x2019;/giu, "’")
    .replace(/&ldquo;|&#8220;|&#x201c;/giu, "“")
    .replace(/&rdquo;|&#8221;|&#x201d;/giu, "”")
    .replace(/&nbsp;/giu, " ")
    .replace(/&mdash;/giu, "—")
    .replace(/&ndash;/giu, "–")
    .replace(/\s+/gu, " ")
    .trim();
}

function requireVisible(text, marker, label, errors) {
  if (!text.includes(marker)) errors.push(`${label} missing visible boundary ${JSON.stringify(marker)}`);
}

function workflowJobBody(workflowText, jobName) {
  const lines = workflowText.replace(/\r\n?/gu, "\n").split("\n");
  const header = `  ${jobName}:`;
  const indexes = lines
    .map((line, index) => (line === header ? index : -1))
    .filter((index) => index >= 0);
  if (indexes.length !== 1) return null;
  const start = indexes[0] + 1;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function workflowStepBody(jobBody, stepId) {
  if (typeof jobBody !== "string") return null;
  const lines = jobBody.split("\n");
  const idLine = `        id: ${stepId}`;
  const indexes = lines
    .map((line, index) => (line === idLine ? index : -1))
    .filter((index) => index >= 0);
  if (indexes.length !== 1) return null;
  let start = indexes[0];
  while (start >= 0 && !/^ {6}-\s/u.test(lines[start])) start -= 1;
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {6}-\s/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function requireWorkflowPattern(text, pattern, label, errors) {
  if (typeof text !== "string" || !pattern.test(text)) {
    errors.push(`workflow missing exact ${label}`);
  }
}

export function validatePublicTruthTextSet({
  termsHtml,
  privacyHtml,
  contactHtml,
  workflowText,
  ogSourceText,
}) {
  const errors = [];
  const terms = htmlToText(termsHtml);
  const privacy = htmlToText(privacyHtml);
  const contact = htmlToText(contactHtml);
  const ogSource = htmlToText(ogSourceText);
  for (const marker of [
    "Site Sourcery is the brand presentation of the filed alternate name SITESOURCERY. Desiderata Labs LLC is the legal seller.",
    "Site Sourcery accepts inquiries for Custom websites, website assessments, separately scoped Care, and working-system projects.",
    "Custom work begins only through a written quote or scope and a separately accepted agreement.",
    "Payment alone does not authorize work or publication.",
    "Ownership of the agreed client deliverables transfers only after final payment",
    "The Responder page is planning only. It sends no messages, takes no payment, and starts no setup or service.",
    "The Responder remains held until its telephony, A2P registration, message delivery, opt-out handling, monitoring, lifecycle terms, and customer proof are complete.",
    "Ongoing Care requires its own written scope, and optional Custom Care plan details and prices remain held.",
    "Provider hosting, public Internet publication, real billing, DNS work, and provider-side storage require a separately released service",
    "Using the current maker does not create an account, control room, project record, or saved acceptance.",
    "Facts and made versions stay only in the current tab; refreshing the page or closing the tab clears them.",
    "The free guest maker makes temporary tab-only versions and previews. It offers no account, saved project, Checkout, or Download.",
    "This maker has no Publish button or publication state.",
    "The current maker does not record a safety hold, report, appeal, restoration, review history, or enforcement state.",
  ]) requireVisible(terms, marker, "legal/website-terms/index.html", errors);
  for (const marker of [
    "Desiderata Labs LLC operates this website under the filed New Jersey alternate name SITESOURCERY.",
    "The public pages in this release are built without an inquiry form, visitor upload, advertising tracker, or page-level analytics.",
    "The Start chooser uses selected buttons only to show a recommendation on the current page and does not send that selection.",
    "The Responder is held from sale. Its public page describes an intended flow already present in the page and does not ask for customer data, store a setup, contact a provider, create a quote, take payment, or activate a message, booking, review request, invoice action, or other integration.",
    "A guest may build, revise, and test a private preview without an account. Choosing to retain it as an editor project requires the signed-in account path and accepted project documents.",
    "Made versions are stored in this tab’s session storage so they can survive a refresh or a payment return.",
    "Download does not create a public Internet address or an ongoing website-hosting service.",
    "Site Sourcery’s preflight does not call a registrar availability, pricing, reservation, or purchase API.",
    "Secure card entry belongs to Stripe at checkout.",
    "Alakazam has no active customer lifecycle or retention schedule under this notice.",
    "The ordinary public pages and guest preview do not submit a safety report or support ticket.",
    "Email sent to sitesourcery@proton.me is processed through Proton Mail",
    "If you call or email, Site Sourcery may retain the communication and reasonable business records needed to respond, scope work, document decisions, deliver accepted work, protect the service, and meet legal obligations.",
  ]) requireVisible(privacy, marker, "legal/privacy/index.html", errors);
  for (const marker of [
    "Project inquiries are open",
    "You do not need to know the service name or prepare a formal brief.",
    "If the work is a fit, you see the full scope and price in writing before paying.",
    "This is Site Sourcery’s current public email address.",
    "If the email link does not open an app, copy the address above.",
    "Do not send passwords, full payment-card details, health information, or sensitive customer records.",
    "(856) 244-1220",
    "sitesourcery@proton.me",
  ]) requireVisible(contact, marker, "contact/index.html", errors);
  for (const [pattern, label, text] of [
    [/\bpayment alone (?:authorizes|starts|launches|transfers|activates|approves)\b/iu, "legal/website-terms/index.html", terms],
    [/\b(?:this public site|the public site) (?:accepts|takes|processes|collects) (?:orders|payments?|card details?)\b/iu, "legal/website-terms/index.html", terms],
    [/\bHive (?:runs|activates|operates) (?:an? )?(?:integration|automation|business process)\b/iu, "legal/website-terms/index.html", terms],
    [/\bCreating a project in the current private tool requires explicit acceptance\b/iu, "legal/website-terms/index.html", terms],
    [/\bThe current tool lets an owner create a local account and project\b/iu, "legal/website-terms/index.html", terms],
    [/\bThe current owner-side activation control changes only local rehearsal state\b/iu, "legal/website-terms/index.html", terms],
    [/\bPublish accepted version\b/iu, "legal/website-terms/index.html", terms],
    [/\bAbracadabra records the account holder’s name\b/iu, "legal/privacy/index.html", privacy],
    [/\bAbracadabra’s private build contains local billing-lifecycle rehearsal states\b/iu, "legal/privacy/index.html", privacy],
    [/\bTerminal project deletion in this build acts only on this browser’s local project store\b/iu, "legal/privacy/index.html", privacy],
    [/\bNew Jersey alternate-name registration is pending\b/iu, "legal/website-terms/index.html", terms],
    [/\bSite ?Sourcery LLC\b/iu, "legal/website-terms/index.html", terms],
    [/\bverified public (?:contact )?route\b/iu, "contact/index.html", contact],
    [/\b(?:same business day|guaranteed response|always answers|answered immediately)\b/iu, "contact/index.html", contact],
  ]) {
    if (pattern.test(text)) errors.push(`${label} contains forbidden visible semantics ${pattern}`);
  }
  for (const marker of [
    "Custom websites, scoped to fit.",
    "Footprint and creative direction priced separately.",
    "Personalized scope · (856) 244-1220",
  ]) requireVisible(ogSource, marker, "social-card source", errors);
  if (/(?:open for commissions|from\s*\$|for sale)/iu.test(ogSource)) {
    errors.push("social-card source contains stale availability or price copy");
  }
  const onMatch = /\non:\s*\n([\s\S]*?)\npermissions:/u.exec(`\n${workflowText}`);
  if (!onMatch) {
    errors.push("workflow must contain an explicit on block followed by permissions");
  } else {
    const triggers = [...onMatch[1].matchAll(/^ {2}([a-zA-Z0-9_-]+):\s*$/gmu)].map((match) => match[1]);
    if (stableStringify(triggers) !== stableStringify(["workflow_dispatch"])) {
      errors.push("workflow must expose exactly workflow_dispatch and no other top-level trigger");
    }
  }
  for (const marker of [
    "verify-public-truth-release.mjs",
    "--mode candidate",
    "--mode control",
    "--mode predeploy",
    "--mode postdeploy",
    "GITHUB_EVENT_NAME",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_WORKFLOW_SHA",
    "permissions: {}",
    "persist-credentials: false",
    "cancel-in-progress: false",
  ]) {
    if (!workflowText.includes(marker)) errors.push(`workflow missing release invariant ${JSON.stringify(marker)}`);
  }
  const validateJob = workflowJobBody(workflowText, "validate");
  const deployJob = workflowJobBody(workflowText, "deploy");
  const postdeployJob = workflowJobBody(workflowText, "postdeploy");
  if (!validateJob) errors.push("workflow must contain exactly one anchored validate job");
  if (!deployJob) errors.push("workflow must contain exactly one anchored deploy job");
  if (!postdeployJob) errors.push("workflow must contain exactly one anchored postdeploy job");
  const environmentHeaders = typeof deployJob === "string"
    ? [...deployJob.matchAll(/^ {4}environment:\s*$/gmu)].length
    : 0;
  if (
    environmentHeaders !== 1
    || !/^ {4}environment:\s*$\n^ {6}name: github-pages\s*$\n^ {6}url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}\s*$/mu.test(deployJob ?? "")
  ) {
    errors.push("workflow deploy job must structurally target the exact github-pages environment and deployment URL output");
  }
  requireWorkflowPattern(
    validateJob,
    /^ {4}outputs:\s*$\n^ {6}artifact_id: \$\{\{ steps\.pages-artifact\.outputs\.artifact-id \}\}\s*$/mu,
    "validated artifact-id job output",
    errors,
  );
  requireWorkflowPattern(
    validateJob,
    /^ {12}--file "\$RUNNER_TEMP\/artifact\.tar" \\\s*$/mu,
    "artifact.tar package destination",
    errors,
  );
  requireWorkflowPattern(
    validateJob,
    /^ {12}--directory target\/_site \\\s*$/mu,
    "candidate artifact package source",
    errors,
  );
  requireWorkflowPattern(
    validateJob,
    /^ {10}test -s "\$RUNNER_TEMP\/artifact\.tar"\s*$/mu,
    "nonempty artifact.tar package check",
    errors,
  );
  const uploadStep = workflowStepBody(validateJob, "pages-artifact");
  requireWorkflowPattern(
    uploadStep,
    /^ {8}uses: actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a(?:\s+#.*)?$/mu,
    "direct pinned actions/upload-artifact v7.0.1 step",
    errors,
  );
  requireWorkflowPattern(
    uploadStep,
    /^ {8}with:\s*$\n^ {10}name: github-pages\s*$\n^ {10}path: \$\{\{ runner\.temp \}\}\/artifact\.tar\s*$\n^ {10}retention-days: 1\s*$\n^ {10}if-no-files-found: error\s*$/mu,
    "github-pages artifact upload contract",
    errors,
  );
  if (/actions\/upload-pages-artifact@/u.test(workflowText)) {
    errors.push("workflow must not use the composite upload-pages-artifact action");
  }
  requireWorkflowPattern(
    deployJob,
    /^ {10}ARTIFACT_ID: \$\{\{ needs\.validate\.outputs\.artifact_id \}\}\s*$/mu,
    "artifact-id handoff to predeploy",
    errors,
  );
  requireWorkflowPattern(
    deployJob,
    /^ {10}CONTROL_SHA: \$\{\{ inputs\.control_sha \}\}\s*$/mu,
    "control SHA handoff to artifact metadata validation",
    errors,
  );
  requireWorkflowPattern(
    deployJob,
    /^ {4}outputs:\s*$\n^ {6}page_url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}\s*$/mu,
    "deployment page URL job output",
    errors,
  );
  requireWorkflowPattern(
    deployJob,
    /^ {12}"https:\/\/api\.github\.com\/repos\/\$GITHUB_REPOSITORY\/actions\/artifacts\/\$ARTIFACT_ID" \\\s*$/mu,
    "exact artifact metadata request",
    errors,
  );
  requireWorkflowPattern(
    deployJob,
    /^ {12}"https:\/\/api\.github\.com\/repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$GITHUB_RUN_ID\/artifacts\?name=github-pages&per_page=100" \\\s*$/mu,
    "current-run github-pages artifact query",
    errors,
  );
  for (const [pattern, label] of [
    [/^ {10}if \(String\(artifact\.id\) !== id\) throw new Error\("artifact metadata ID mismatch"\);\s*$/mu, "artifact metadata ID binding"],
    [/^ {10}if \(artifact\.name !== "github-pages"\) throw new Error\("artifact metadata name mismatch"\);\s*$/mu, "artifact metadata name binding"],
    [/^ {10}if \(artifact\.expired !== false\) throw new Error\("artifact is expired"\);\s*$/mu, "artifact expiry rejection"],
    [/^ {10}if \(!artifact\.workflow_run \|\| String\(artifact\.workflow_run\.id\) !== runId\) \{\s*$/mu, "artifact workflow-run binding"],
    [/^ {10}if \(artifact\.workflow_run\.head_sha !== controlSha\) throw new Error\("artifact control-head mismatch"\);\s*$/mu, "artifact control-head binding"],
    [/^ {10}if \(run\.total_count !== 1 \|\| !Array\.isArray\(run\.artifacts\) \|\| run\.artifacts\.length !== 1\) \{\s*$/mu, "unique current-run artifact check"],
    [/^ {10}if \(String\(run\.artifacts\[0\]\.id\) !== id \|\| run\.artifacts\[0\]\.name !== "github-pages"\) \{\s*$/mu, "current-run artifact identity binding"],
  ]) requireWorkflowPattern(deployJob, pattern, label, errors);
  requireWorkflowPattern(
    deployJob,
    /^ {12}"https:\/\/api\.github\.com\/repos\/\$GITHUB_REPOSITORY\/actions\/artifacts\/\$ARTIFACT_ID\/zip" \\\s*$/mu,
    "exact artifact ZIP download",
    errors,
  );
  for (const [pattern, label] of [
    [/^ {10}unzip -Z1 "\$archive" > "\$zip_inventory"\s*$/mu, "ZIP inventory before extraction"],
    [/^ {10}test "\$\(wc -l < "\$zip_inventory"\)" -eq 1\s*$/mu, "single-entry ZIP bound"],
    [/^ {10}test "\$\(sed -n '1p' "\$zip_inventory"\)" = "artifact\.tar"\s*$/mu, "exact artifact.tar ZIP member"],
    [/^ {10}unzip -p "\$archive" artifact\.tar > "\$artifact_tar"\s*$/mu, "streamed artifact.tar extraction"],
    [/^ {10}max_members = 1024\s*$/mu, "safe extractor member bound"],
    [/^ {10}max_expanded_bytes = 128 \* 1024 \* 1024\s*$/mu, "safe extractor expanded-byte bound"],
    [/^ {10,}if any\(ord\(char\) < 32 or ord\(char\) == 127 for char in raw\):\s*$/mu, "safe extractor control-character rejection"],
    [/^ {10,}or path\.is_absolute\(\)\s*$/mu, "safe extractor absolute-path rejection"],
    [/^ {10,}or normalized != name\s*$/mu, "safe extractor normalized-path rejection"],
    [/^ {10,}or "\.\." in path\.parts\s*$/mu, "safe extractor traversal rejection"],
    [/^ {10,}or member\.issym\(\)\s*$/mu, "safe extractor symbolic-link rejection"],
    [/^ {10,}or member\.islnk\(\)\s*$/mu, "safe extractor hard-link rejection"],
    [/^ {10,}or not \(member\.isdir\(\) or member\.isreg\(\)\)\s*$/mu, "safe extractor special-file rejection"],
    [/^ {10,}if normalized in seen:\s*$/mu, "safe extractor duplicate-path rejection"],
    [/^ {10,}if total > max_expanded_bytes:\s*$/mu, "safe extractor expanded-size enforcement"],
    [/^ {10,}if site != target and site not in target\.parents:\s*$/mu, "safe extractor root-containment enforcement"],
    [/^ {10,}with source, target\.open\("xb"\) as output:\s*$/mu, "safe extractor exclusive file creation"],
  ]) requireWorkflowPattern(deployJob, pattern, label, errors);
  if (/^\s*unzip\b[^\n]*\s-d(?:\s|$)/mu.test(workflowText)) {
    errors.push("workflow must not extract the artifact ZIP directly into a directory");
  }
  requireWorkflowPattern(
    deployJob,
    /^ {12}--artifact-root "\$SITE_ARTIFACT_ROOT" \\\s*$/mu,
    "predeploy extracted-artifact root",
    errors,
  );
  const deploymentStep = workflowStepBody(deployJob, "deployment");
  requireWorkflowPattern(
    deploymentStep,
    /^ {8}uses: actions\/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e(?:\s+#.*)?$/mu,
    "pinned deploy-pages step",
    errors,
  );
  requireWorkflowPattern(
    deploymentStep,
    /^ {8}with:\s*$\n^ {10}artifact_name: github-pages\s*$/mu,
    "explicit deploy-pages artifact name",
    errors,
  );
  requireWorkflowPattern(
    deployJob,
    /^ {4}timeout-minutes: 8\s*$/mu,
    "bounded mutation-capable deploy timeout",
    errors,
  );
  for (const [pattern, label] of [
    [/^ {4}if: \$\{\{ always\(\) && needs\.validate\.result == 'success' \}\}\s*$/mu, "postdeploy job execution after every deploy outcome"],
    [/^ {4}permissions:\s*$\n^ {6}actions: read\s*$\n^ {6}contents: read\s*$\n^ {6}pages: read\s*$/mu, "read-only postdeploy job permissions"],
    [/^ {4}timeout-minutes: 40\s*$/mu, "bounded postdeploy timeout"],
    [/^ {4}needs:\s*$\n^ {6}- validate\s*$\n^ {6}- deploy\s*$/mu, "postdeploy lineage dependencies"],
  ]) requireWorkflowPattern(postdeployJob, pattern, label, errors);
  if (
    typeof postdeployJob === "string"
    && (
      /^ {6}(?:id-token|pages): write\s*$/mu.test(postdeployJob)
      || /actions\/deploy-pages@/u.test(postdeployJob)
      || /^ {4}environment:\s*$/mu.test(postdeployJob)
    )
  ) errors.push("postdeploy job must remain read-only and outside the deployment environment");
  for (const [pattern, label] of [
    [/^ {10}ref: \$\{\{ inputs\.control_sha \}\}\s*$/mu, "postdeploy exact control checkout"],
    [/^ {10}node-version-file: control\/\.nvmrc\s*$/mu, "postdeploy control-pinned Node runtime"],
    [/^ {8}if: \$\{\{ needs\.deploy\.result == 'success' \}\}\s*$/mu, "successful-deployment reconstruction guard"],
    [/^ {10}ref: \$\{\{ inputs\.candidate_sha \}\}\s*$/mu, "postdeploy exact candidate checkout"],
    [/^ {8}run: npm ci --ignore-scripts\s*$/mu, "postdeploy locked dependency installation"],
    [/^ {8}run: npm run build:pages\s*$/mu, "postdeploy deterministic artifact reconstruction"],
  ]) requireWorkflowPattern(postdeployJob, pattern, label, errors);
  requireWorkflowPattern(
    postdeployJob,
    /^ {6}- name: Install exact reviewed Chromium for the live proof\s*$\n^ {8}if: \$\{\{ needs\.deploy\.result == 'success' \}\}\s*$\n^ {8}working-directory: control\s*$\n^ {8}run: bash \.\/scripts\/install-reviewed-chromium\.sh "\$RUNNER_TEMP\/postdeploy-reviewed-chromium" "\$GITHUB_ENV"\s*$/mu,
    "reviewed Chromium installation for the live proof",
    errors,
  );
  const postdeployStep = workflowStepBody(postdeployJob, "postdeploy-proof");
  for (const [pattern, label] of [
    [/^ {10}node --experimental-websocket scripts\/verify-public-truth-release\.mjs \\\s*$/mu, "postdeploy Node browser runtime"],
    [/^ {8}if: \$\{\{ always\(\) \}\}\s*$/mu, "fail-closed postdeploy execution and evidence after every deployment outcome"],
    [/^ {10}ARTIFACT_ID: \$\{\{ needs\.validate\.outputs\.artifact_id \}\}\s*$/mu, "postdeploy artifact identity handoff"],
    [/^ {10}DEPLOYMENT_PAGE_URL: \$\{\{ needs\.deploy\.outputs\.page_url \}\}\s*$/mu, "postdeploy page URL identity"],
    [/^ {10}DEPLOYMENT_STATUS: \$\{\{ needs\.deploy\.result \}\}\s*$/mu, "postdeploy action outcome identity"],
    [/^ {10}GH_TOKEN: \$\{\{ github\.token \}\}\s*$/mu, "postdeploy read token"],
    [/^ {10}LIVE_ORIGIN: https:\/\/sitesourcery\.com\s*$/mu, "exact production origin"],
    [/^ {10}PRODUCTION_PROOF_EVIDENCE: \$\{\{ runner\.temp \}\}\/public-truth-production-proof\.json\s*$/mu, "private evidence path"],
    [/^ {12}--mode postdeploy \\\s*$/mu, "postdeploy verifier mode"],
    [/^ {12}--artifact-root "\$\{\{ github\.workspace \}\}\/target\/_site" \\\s*$/mu, "postdeploy reconstructed artifact root"],
    [/^ {12}--artifact-id "\$ARTIFACT_ID" \\\s*$/mu, "postdeploy artifact ID"],
    [/^ {12}--origin "\$LIVE_ORIGIN" \\\s*$/mu, "postdeploy live origin"],
    [/^ {12}--deployment-page-url "\$DEPLOYMENT_PAGE_URL" \\\s*$/mu, "postdeploy deployment page URL"],
    [/^ {12}--deployment-status "\$DEPLOYMENT_STATUS" \\\s*$/mu, "postdeploy deployment outcome"],
    [/^ {12}--evidence "\$PRODUCTION_PROOF_EVIDENCE"\s*$/mu, "postdeploy evidence output"],
  ]) requireWorkflowPattern(postdeployStep, pattern, label, errors);
  const evidenceStep = workflowStepBody(postdeployJob, "production-proof-evidence");
  requireWorkflowPattern(
    evidenceStep,
    /^ {8}if: \$\{\{ always\(\) \}\}\s*$/mu,
    "always-retained postdeploy evidence",
    errors,
  );
  requireWorkflowPattern(
    evidenceStep,
    /^ {8}uses: actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a(?:\s+#.*)?$/mu,
    "pinned postdeploy evidence upload",
    errors,
  );
  requireWorkflowPattern(
    evidenceStep,
    /^ {8}with:\s*$\n^ {10}name: public-truth-production-proof-\$\{\{ github\.run_id \}\}\s*$\n^ {10}path: \$\{\{ runner\.temp \}\}\/public-truth-production-proof\.json\s*$\n^ {10}retention-days: 90\s*$\n^ {10}if-no-files-found: error\s*$\n^ {10}overwrite: false\s*$\n^ {10}include-hidden-files: false\s*$/mu,
    "90-day private postdeploy evidence contract",
    errors,
  );
  if (
    typeof postdeployJob === "string"
    && !(
      postdeployJob.indexOf("        id: postdeploy-proof") >= 0
      && postdeployJob.indexOf("        id: postdeploy-proof") < postdeployJob.indexOf("        id: production-proof-evidence")
    )
  ) errors.push("workflow retained evidence must follow the postdeploy proof");
  if (/(?:^|\n)\s+(?:push|pull_request|schedule|repository_dispatch)\s*:/u.test(workflowText)) {
    errors.push("workflow contains a non-manual trigger");
  }
  if (/(?:^|\n)\s*continue-on-error:\s*true\s*(?:#.*)?$/imu.test(workflowText)) {
    errors.push("workflow must not continue after a failed release check");
  }
  for (const match of workflowText.matchAll(/(?:^|\n)\s*(?:-\s*)?uses:\s*([^\s#]+)/gmu)) {
    if (!/@[0-9a-f]{40}$/u.test(match[1])) {
      errors.push(`workflow action must be pinned to an exact commit: ${match[1]}`);
    }
  }
  return errors;
}

export function validateReviewedOgAssets(ogSource, ogPng) {
  const errors = [];
  if (!Buffer.isBuffer(ogSource) || sha256(ogSource) !== OG_SOURCE_SHA256) {
    errors.push(`social-card source must match reviewed digest ${OG_SOURCE_SHA256}`);
  }
  if (!Buffer.isBuffer(ogPng) || sha256(ogPng) !== OG_PNG_SHA256) {
    errors.push(`og.png must match reviewed digest ${OG_PNG_SHA256}`);
  }
  if (
    !Buffer.isBuffer(ogPng)
    || ogPng.length < 24
    || !ogPng.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    errors.push("og.png is not a PNG");
  } else if (ogPng.readUInt32BE(16) !== 1200 || ogPng.readUInt32BE(20) !== 630) {
    errors.push("og.png must be exactly 1200x630");
  }
  return errors;
}

function candidateControlKeys() {
  return [
    "version",
    "state",
    "allowsDeployment",
    "allowsCommercialDeployment",
    "allowsContainmentDeployment",
    "allowsPublicTruthReconciliationDeployment",
    "publicTruthReconciliation",
    "reason",
    "containmentReason",
    "updatedAt",
  ];
}

export function validateCandidateControl(control) {
  exactObject(control, candidateControlKeys(), "candidate release control");
  if (
    control.version !== 3
    || control.state !== "hold"
    || control.allowsDeployment !== false
    || control.allowsCommercialDeployment !== false
    || control.allowsContainmentDeployment !== false
    || control.allowsPublicTruthReconciliationDeployment !== false
  ) fail("candidate release control must be version 3 with every deployment authority held");
  const publicTruth = exactObject(control.publicTruthReconciliation, [
    "state",
    "requiredProductionPredecessor",
    "approvedCandidateSha",
    "authorityReceiptSha256",
    "reason",
  ], "candidate public-truth control");
  if (
    publicTruth.state !== "hold"
    || publicTruth.requiredProductionPredecessor !== PRODUCTION_PREDECESSOR_SHA
    || publicTruth.approvedCandidateSha !== null
    || publicTruth.authorityReceiptSha256 !== null
  ) fail("candidate public-truth control must preserve the exact held identity");
  nonemptyString(publicTruth.reason, "candidate public-truth reason");
  nonemptyString(control.reason, "candidate reason");
  nonemptyString(control.containmentReason, "candidate containment reason");
  if (typeof control.updatedAt !== "string" || !ISO_DATE.test(control.updatedAt)) {
    fail("candidate updatedAt must be an ISO date");
  }
  return publicTruth;
}

export function computeReleaseEpochSha256(receipt) {
  const authority = receipt.authority ?? {};
  return sha256(stableStringify({
    schema: receipt.schema,
    repository: receipt.repository,
    lineage: receipt.lineage,
    changedPaths: receipt.changedPaths,
    manifests: receipt.manifests,
    catalog: receipt.catalog,
    authority: {
      scope: authority.scope,
      environment: authority.environment,
      issuer: authority.issuer,
      issuedAt: authority.issuedAt,
      notBefore: authority.notBefore,
      expiresAt: authority.expiresAt,
      oneShot: authority.oneShot,
      statement: authority.statement,
    },
    flags: receipt.flags,
  }));
}

export function validateReceipt(receipt, context) {
  if (!context || typeof context !== "object" || !Number.isSafeInteger(context.now) || context.now < 0) {
    fail("receipt validation context requires a nonnegative safe-integer current time");
  }
  exactObject(receipt, [
    "schema",
    "repository",
    "lineage",
    "changedPaths",
    "manifests",
    "catalog",
    "authority",
    "flags",
  ], "receipt");
  exactString(receipt.schema, RECEIPT_SCHEMA, "receipt.schema");
  const repository = exactObject(receipt.repository, ["id", "fullName"], "receipt.repository");
  decimalId(repository.id, "receipt.repository.id");
  exactString(repository.fullName, REPOSITORY_FULL_NAME, "receipt.repository.fullName");
  const lineage = exactObject(receipt.lineage, ["candidateBase", "candidate", "pagesPredecessor"], "receipt.lineage");
  digest(lineage.candidateBase, "receipt.lineage.candidateBase", 40);
  digest(lineage.candidate, "receipt.lineage.candidate", 40);
  const predecessor = exactObject(lineage.pagesPredecessor, ["deploymentId", "commit"], "receipt.lineage.pagesPredecessor");
  decimalId(predecessor.deploymentId, "receipt.lineage.pagesPredecessor.deploymentId");
  digest(predecessor.commit, "receipt.lineage.pagesPredecessor.commit", 40);
  const changedPaths = exactObject(receipt.changedPaths, ["candidate", "control"], "receipt.changedPaths");
  exactArray(changedPaths.candidate, CANDIDATE_CHANGED_PATHS, "receipt.changedPaths.candidate");
  exactArray(changedPaths.control, CONTROL_CHANGED_PATHS, "receipt.changedPaths.control");
  const manifests = exactObject(receipt.manifests, ["sourceSha256", "artifactSha256"], "receipt.manifests");
  digest(manifests.sourceSha256, "receipt.manifests.sourceSha256");
  digest(manifests.artifactSha256, "receipt.manifests.artifactSha256");
  const catalog = exactObject(receipt.catalog, ["sourceDigest", "projectionDigest", "frozenBaseBlobs"], "receipt.catalog");
  exactString(catalog.sourceDigest, SOURCE_CATALOG_DIGEST, "receipt.catalog.sourceDigest");
  exactString(catalog.projectionDigest, PUBLIC_PROJECTION_DIGEST, "receipt.catalog.projectionDigest");
  exactObject(catalog.frozenBaseBlobs, Object.keys(FROZEN_BASE_BLOBS), "receipt.catalog.frozenBaseBlobs");
  for (const [file, objectId] of Object.entries(FROZEN_BASE_BLOBS)) {
    exactString(catalog.frozenBaseBlobs[file], objectId, `receipt.catalog.frozenBaseBlobs.${file}`);
  }
  const authority = exactObject(receipt.authority, [
    "scope",
    "environment",
    "issuer",
    "issuedAt",
    "notBefore",
    "expiresAt",
    "oneShot",
    "statement",
    "epochSha256",
  ], "receipt.authority");
  exactString(authority.scope, "public-truth-reconciliation-only", "receipt.authority.scope");
  exactString(authority.environment, RELEASE_ENVIRONMENT, "receipt.authority.environment");
  if (authority.oneShot !== true) fail("receipt.authority.oneShot must be true");
  exactString(authority.statement, AUTHORITY_STATEMENT, "receipt.authority.statement");
  const issuer = exactObject(authority.issuer, ["githubUserId", "login"], "receipt.authority.issuer");
  decimalId(issuer.githubUserId, "receipt.authority.issuer.githubUserId");
  if (typeof issuer.login !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(issuer.login)) {
    fail("receipt.authority.issuer.login must be one canonical GitHub login");
  }
  const issuedAt = exactTimestamp(authority.issuedAt, "receipt.authority.issuedAt");
  const notBefore = exactTimestamp(authority.notBefore, "receipt.authority.notBefore");
  const expiresAt = exactTimestamp(authority.expiresAt, "receipt.authority.expiresAt");
  if (issuedAt > notBefore || notBefore - issuedAt > MAX_CLOCK_SKEW_MS) {
    fail("receipt authority notBefore must be at or within five minutes after issuance");
  }
  if (issuedAt > context.now + MAX_CLOCK_SKEW_MS || notBefore > context.now || context.now >= expiresAt) {
    fail("receipt authority time window is not currently valid");
  }
  if (expiresAt - issuedAt <= 0 || expiresAt - issuedAt > MAX_AUTHORITY_LIFETIME_MS) {
    fail("receipt authority lifetime must be positive and no longer than one hour");
  }
  const flags = exactObject(receipt.flags, [
    "allowsDeployment",
    "allowsCommercialDeployment",
    "allowsContainmentDeployment",
    "allowsPublicTruthReconciliationDeployment",
  ], "receipt.flags");
  if (
    flags.allowsDeployment !== false
    || flags.allowsCommercialDeployment !== false
    || flags.allowsContainmentDeployment !== false
    || flags.allowsPublicTruthReconciliationDeployment !== true
  ) fail("receipt flags must grant only public-truth reconciliation");
  exactString(authority.epochSha256, computeReleaseEpochSha256(receipt), "receipt.authority.epochSha256");

  exactString(lineage.candidateBase, CANDIDATE_BASE_SHA, "receipt.lineage.candidateBase");
  exactString(lineage.candidate, context.candidateSha, "receipt.lineage.candidate");
  exactString(predecessor.commit, context.productionPredecessor, "receipt.lineage.pagesPredecessor.commit");
  exactString(repository.id, context.repositoryId, "receipt.repository.id");
  exactString(repository.fullName, context.repository, "receipt.repository.fullName");
  exactString(issuer.githubUserId, context.actorId, "receipt.authority.issuer.githubUserId");
  exactString(issuer.login, context.actor, "receipt.authority.issuer.login");
  exactString(manifests.sourceSha256, context.sourceManifestSha256, "receipt.manifests.sourceSha256");
  exactString(manifests.artifactSha256, context.artifactManifestSha256, "receipt.manifests.artifactSha256");
  return receipt;
}

export function validateEnabledControl(control, receipt, receiptSha256, context) {
  exactObject(control, candidateControlKeys(), "enabled release control");
  if (
    control.version !== 3
    || control.state !== "hold"
    || control.allowsDeployment !== false
    || control.allowsCommercialDeployment !== false
    || control.allowsContainmentDeployment !== false
    || control.allowsPublicTruthReconciliationDeployment !== true
  ) fail("enabled control must grant only public-truth reconciliation");
  const publicTruth = exactObject(control.publicTruthReconciliation, [
    "state",
    "requiredProductionPredecessor",
    "approvedCandidateSha",
    "authorityReceiptSha256",
    "reason",
  ], "enabled public-truth control");
  if (
    publicTruth.state !== "cleared"
    || publicTruth.requiredProductionPredecessor !== receipt.lineage.pagesPredecessor.commit
    || publicTruth.requiredProductionPredecessor !== context.productionPredecessor
    || publicTruth.approvedCandidateSha !== receipt.lineage.candidate
    || publicTruth.approvedCandidateSha !== context.candidateSha
    || publicTruth.authorityReceiptSha256 !== receiptSha256
  ) fail("enabled public-truth control does not exactly bind the receipt, candidate, and predecessor");
  nonemptyString(publicTruth.reason, "enabled public-truth reason");
  nonemptyString(control.reason, "enabled control reason");
  nonemptyString(control.containmentReason, "enabled containment reason");
  if (control.updatedAt !== receipt.authority.issuedAt.slice(0, 10)) {
    fail("enabled control updatedAt must equal the authority issuance date");
  }
  return publicTruth;
}

export function validatePagesObservation(observation, receipt) {
  exactObject(observation, [
    "url",
    "status",
    "error",
    "pusher",
    "commit",
    "duration",
    "created_at",
    "updated_at",
  ], "latest Pages build observation");
  const error = exactObject(observation.error, ["message"], "latest Pages build error");
  if (observation.status !== "built" || error.message !== null) {
    fail("latest Pages build is not one successful built predecessor");
  }
  exactString(observation.commit, receipt.lineage.pagesPredecessor.commit, "latest Pages build commit");
  const expectedUrl = `https://api.github.com/repos/${REPOSITORY_FULL_NAME}/pages/builds/${receipt.lineage.pagesPredecessor.deploymentId}`;
  exactString(observation.url, expectedUrl, "latest Pages build URL");
  if (!observation.pusher || typeof observation.pusher !== "object" || Array.isArray(observation.pusher)) {
    fail("latest Pages build pusher must be an object");
  }
  if (!Number.isSafeInteger(observation.duration) || observation.duration < 0) {
    fail("latest Pages build duration must be a nonnegative safe integer");
  }
  if (!GITHUB_TIME.test(observation.created_at) || !GITHUB_TIME.test(observation.updated_at)) {
    fail("latest Pages build timestamps must be exact whole-second GitHub UTC timestamps");
  }
  const createdAt = Date.parse(observation.created_at);
  const updatedAt = Date.parse(observation.updated_at);
  const issuedAt = Date.parse(receipt.authority.issuedAt);
  if (
    !Number.isFinite(createdAt)
    || !Number.isFinite(updatedAt)
    || new Date(createdAt).toISOString().replace(".000Z", "Z") !== observation.created_at
    || new Date(updatedAt).toISOString().replace(".000Z", "Z") !== observation.updated_at
    || createdAt > updatedAt
    || updatedAt > issuedAt
  ) fail("latest Pages build timestamps do not precede the authority epoch");
  return observation;
}

export function validatePredeployState({
  candidateControl,
  enabledControl,
  receiptRaw,
  context,
  pagesObservation,
}) {
  validateCandidateControl(candidateControl);
  if (!Buffer.isBuffer(receiptRaw)) fail("predeploy authority receipt must be raw bytes");
  const receiptSha256 = sha256(receiptRaw);
  const receipt = validateReceipt(parseStrictJson(receiptRaw.toString("utf8")), context);
  const remainingAuthorityMs = Date.parse(receipt.authority.expiresAt) - context.now;
  if (remainingAuthorityMs < MIN_PREDEPLOY_AUTHORITY_REMAINING_MS) {
    fail(`predeploy authority must have at least ${MIN_PREDEPLOY_AUTHORITY_REMAINING_MS}ms remaining`);
  }
  validateEnabledControl(enabledControl, receipt, receiptSha256, context);
  validatePagesObservation(pagesObservation, receipt);
  return Object.freeze({ receipt, receiptSha256 });
}

async function validateCandidateSourceRevision(root, candidateSha) {
  const files = [
    "legal/website-terms/index.html",
    "legal/privacy/index.html",
    "contact/index.html",
    WORKFLOW_PATH,
    "scripts/assets/sitesourcery-og-source.svg",
    "og.png",
    "data/release-control.json",
    "data/public-catalog.json",
    "print-collateral/sitesourcery-card-finalist-v9.html",
    "print-collateral/sitesourcery-card-finalist-v9.pdf",
  ];
  const bytes = Object.fromEntries(files.map((file) => [file, readGitFile(root, candidateSha, file)]));
  const errors = validatePublicTruthTextSet({
    termsHtml: bytes["legal/website-terms/index.html"].toString("utf8"),
    privacyHtml: bytes["legal/privacy/index.html"].toString("utf8"),
    contactHtml: bytes["contact/index.html"].toString("utf8"),
    workflowText: bytes[WORKFLOW_PATH].toString("utf8"),
    ogSourceText: bytes["scripts/assets/sitesourcery-og-source.svg"].toString("utf8"),
  });
  errors.push(...validateReviewedOgAssets(
    bytes["scripts/assets/sitesourcery-og-source.svg"],
    bytes["og.png"],
  ));
  const cardSource = bytes["print-collateral/sitesourcery-card-finalist-v9.html"].toString("utf8");
  for (const marker of [
    "sitesourcery.com",
    "sitesourcery@proton.me",
    'href="tel:+18562441220"',
    "(856) 244-1220",
    'data-print-side="writable-back"',
  ]) {
    if (!cardSource.includes(marker)) errors.push(`V9 card source missing exact reviewed marker ${JSON.stringify(marker)}`);
  }
  const cardPdf = bytes["print-collateral/sitesourcery-card-finalist-v9.pdf"];
  if (!cardPdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) errors.push("V9 card artifact is not a PDF");
  if (sha256(cardPdf) !== CARD_V9_PDF_SHA256) {
    errors.push(`V9 card PDF must match reviewed digest ${CARD_V9_PDF_SHA256}`);
  }
  const catalog = parseStrictJson(bytes["data/public-catalog.json"].toString("utf8"));
  if (
    catalog.offerState !== "inquiry-only"
    || catalog.sourceCatalogDigest !== SOURCE_CATALOG_DIGEST
    || catalog.projectionDigest !== PUBLIC_PROJECTION_DIGEST
  ) errors.push("public catalog must preserve the exact inquiry-only reviewed identity");
  const control = parseStrictJson(bytes["data/release-control.json"].toString("utf8"));
  try {
    validateCandidateControl(control);
  } catch (error) {
    errors.push(error.message);
  }
  if (errors.length > 0) fail(`candidate source semantics failed: ${errors.join("; ")}`);
  return {
    control,
    workflowSha256: sha256(bytes[WORKFLOW_PATH]),
  };
}

async function validateRoot(root) {
  let canonical;
  try {
    canonical = await realpath(path.resolve(root));
  } catch {
    fail("root must identify an existing repository directory");
  }
  const stat = await lstat(canonical);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("root must identify one real directory");
  exactString(git(canonical, ["rev-parse", "--show-toplevel"]), canonical, "root repository top level");
  return canonical;
}

function validateCandidateGraph(root, candidateSha) {
  verifyCommit(root, candidateSha, "candidate SHA");
  exactString(gitParent(root, candidateSha, "candidate"), CANDIDATE_BASE_SHA, "candidate parent");
  exactArray(gitDiffPaths(root, CANDIDATE_BASE_SHA, candidateSha), CANDIDATE_CHANGED_PATHS, "candidate changed paths");
  for (const file of CANDIDATE_CHANGED_PATHS) {
    exactString(git(root, ["cat-file", "-t", `${candidateSha}:${file}`]), "blob", `${file} candidate object type`);
  }
  for (const [file, expectedBlob] of Object.entries(FROZEN_BASE_BLOBS)) {
    exactString(git(root, ["rev-parse", `${CANDIDATE_BASE_SHA}:${file}`]), expectedBlob, `${file} base blob`);
    exactString(git(root, ["rev-parse", `${candidateSha}:${file}`]), expectedBlob, `${file} candidate blob`);
  }
}

function validateCleanTrackedCheckout(root) {
  const worktree = git(root, ["diff", "--name-only", "-z"], { binary: true });
  const index = git(root, ["diff", "--cached", "--name-only", "-z"], { binary: true });
  if (worktree.length !== 0 || index.length !== 0) {
    fail("checkout contains tracked or staged bytes that differ from HEAD");
  }
}

export async function verifyCandidate({
  root,
  candidateSha,
  productionPredecessor,
  requireHead = true,
} = {}) {
  const repositoryRoot = await validateRoot(root);
  digest(candidateSha, "candidate SHA", 40);
  digest(productionPredecessor, "production predecessor", 40);
  exactString(productionPredecessor, PRODUCTION_PREDECESSOR_SHA, "production predecessor");
  if (requireHead) exactString(git(repositoryRoot, ["rev-parse", "HEAD"]), candidateSha, "candidate checkout HEAD");
  if (requireHead) validateCleanTrackedCheckout(repositoryRoot);
  validateCandidateGraph(repositoryRoot, candidateSha);
  await validateCandidateSourceRevision(repositoryRoot, candidateSha);
  const sourceManifest = sourceManifestFromGit(repositoryRoot, candidateSha);
  const artifact = await validateArtifactSafety(path.join(repositoryRoot, "_site"), sourceManifest);
  return Object.freeze({
    mode: "candidate",
    candidateSha,
    productionPredecessor,
    sourceManifestSha256: sourceManifest.sha256,
    artifactManifestSha256: artifact.sha256,
    changedPathCount: CANDIDATE_CHANGED_PATHS.length,
    artifactFileCount: artifact.count,
    authority: "HOLD",
  });
}

export function validateRuntimeAuthorityEnvironment(env, controlSha) {
  digest(controlSha, "control SHA", 40);
  exactString(env.GITHUB_EVENT_NAME, "workflow_dispatch", "GITHUB_EVENT_NAME");
  exactString(env.GITHUB_REF, "refs/heads/main", "GITHUB_REF");
  exactString(env.GITHUB_RUN_ATTEMPT, "1", "GITHUB_RUN_ATTEMPT");
  exactString(env.GITHUB_REPOSITORY, REPOSITORY_FULL_NAME, "GITHUB_REPOSITORY");
  exactString(env.GITHUB_SHA, controlSha, "GITHUB_SHA");
  exactString(env.GITHUB_WORKFLOW_SHA, controlSha, "GITHUB_WORKFLOW_SHA");
  decimalId(env.GITHUB_REPOSITORY_ID, "GITHUB_REPOSITORY_ID");
  decimalId(env.GITHUB_ACTOR_ID, "GITHUB_ACTOR_ID");
  decimalId(env.GITHUB_RUN_ID, "GITHUB_RUN_ID");
  if (typeof env.GITHUB_ACTOR !== "string" || env.GITHUB_ACTOR.length === 0) fail("GITHUB_ACTOR is required");
  return {
    repository: env.GITHUB_REPOSITORY,
    repositoryId: env.GITHUB_REPOSITORY_ID,
    actor: env.GITHUB_ACTOR,
    actorId: env.GITHUB_ACTOR_ID,
  };
}

export function resolveAuthorityReceiptPath(root, authorityReceipt) {
  const expected = path.join(root, ...RECEIPT_PATH.split("/"));
  if (
    typeof authorityReceipt !== "string"
    || (path.isAbsolute(authorityReceipt)
      ? authorityReceipt !== expected
      : authorityReceipt !== RECEIPT_PATH)
  ) fail(`authority receipt path must be exactly ${RECEIPT_PATH}`);
  const supplied = path.isAbsolute(authorityReceipt) ? authorityReceipt : expected;
  if (supplied !== expected) fail(`authority receipt path must be exactly ${RECEIPT_PATH}`);
  return supplied;
}

async function readExactReceipt(root, authorityReceipt, controlSha) {
  const supplied = resolveAuthorityReceiptPath(root, authorityReceipt);
  const stat = await lstat(supplied);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("authority receipt must be one regular file");
  exactString(await realpath(supplied), supplied, "authority receipt canonical path");
  const raw = await readFile(supplied);
  const committed = readGitFile(root, controlSha, RECEIPT_PATH);
  if (!raw.equals(committed)) fail("authority receipt working-tree bytes differ from the control commit");
  return raw;
}

async function readPagesObservation(root) {
  const observationPath = path.join(root, PAGES_OBSERVATION_FILE);
  const stat = await lstat(observationPath);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${PAGES_OBSERVATION_FILE} must be one regular file`);
  exactString(await realpath(observationPath), observationPath, "Pages observation canonical path");
  return parseStrictJson(await readFile(observationPath, "utf8"));
}

export async function verifyControl({
  root,
  candidateSha,
  controlSha,
  productionPredecessor,
  authorityReceipt,
  env = process.env,
  now = Date.now(),
} = {}) {
  const repositoryRoot = await validateRoot(root);
  digest(candidateSha, "candidate SHA", 40);
  digest(controlSha, "control SHA", 40);
  digest(productionPredecessor, "production predecessor", 40);
  exactString(productionPredecessor, PRODUCTION_PREDECESSOR_SHA, "production predecessor");
  exactString(git(repositoryRoot, ["rev-parse", "HEAD"]), controlSha, "control checkout HEAD");
  validateCleanTrackedCheckout(repositoryRoot);
  validateCandidateGraph(repositoryRoot, candidateSha);
  exactString(gitParent(repositoryRoot, controlSha, "control"), candidateSha, "control parent");
  exactArray(gitDiffPaths(repositoryRoot, candidateSha, controlSha), CONTROL_CHANGED_PATHS, "control changed paths");
  const runtime = validateRuntimeAuthorityEnvironment(env, controlSha);
  const { control: candidateControl } = await validateCandidateSourceRevision(repositoryRoot, candidateSha);
  validateCandidateControl(candidateControl);
  const sourceManifest = sourceManifestFromGit(repositoryRoot, candidateSha);
  const artifact = await validateArtifactSafety(path.join(repositoryRoot, "_site"), sourceManifest);
  const receiptRaw = await readExactReceipt(repositoryRoot, authorityReceipt, controlSha);
  const receiptSha256 = sha256(receiptRaw);
  const receipt = parseStrictJson(receiptRaw.toString("utf8"));
  const context = {
    ...runtime,
    now,
    candidateSha,
    productionPredecessor,
    sourceManifestSha256: sourceManifest.sha256,
    artifactManifestSha256: artifact.sha256,
  };
  validateReceipt(receipt, context);
  validatePagesObservation(await readPagesObservation(repositoryRoot), receipt);
  const enabledRaw = readGitFile(repositoryRoot, controlSha, "data/release-control.json");
  const enabledControl = parseStrictJson(enabledRaw.toString("utf8"));
  validateEnabledControl(enabledControl, receipt, receiptSha256, context);
  return Object.freeze({
    mode: "control",
    candidateSha,
    controlSha,
    productionPredecessor,
    receiptSha256,
    releaseEpochSha256: receipt.authority.epochSha256,
    sourceManifestSha256: sourceManifest.sha256,
    artifactManifestSha256: artifact.sha256,
    changedPathCount: CONTROL_CHANGED_PATHS.length,
    artifactFileCount: artifact.count,
    authority: "PUBLIC_TRUTH_ONLY",
  });
}

export async function verifyPredeploy({
  root,
  artifactRoot,
  candidateSha,
  controlSha,
  productionPredecessor,
  authorityReceipt,
  env = process.env,
  now = Date.now(),
} = {}) {
  const repositoryRoot = await validateRoot(root);
  digest(candidateSha, "candidate SHA", 40);
  digest(controlSha, "control SHA", 40);
  digest(productionPredecessor, "production predecessor", 40);
  exactString(productionPredecessor, PRODUCTION_PREDECESSOR_SHA, "production predecessor");
  exactString(git(repositoryRoot, ["rev-parse", "HEAD"]), controlSha, "predeploy control checkout HEAD");
  validateCleanTrackedCheckout(repositoryRoot);
  validateCandidateGraph(repositoryRoot, candidateSha);
  exactString(gitParent(repositoryRoot, controlSha, "predeploy control"), candidateSha, "predeploy control parent");
  exactArray(gitDiffPaths(repositoryRoot, candidateSha, controlSha), CONTROL_CHANGED_PATHS, "predeploy control changed paths");
  const runtime = validateRuntimeAuthorityEnvironment(env, controlSha);
  const { control: candidateControl } = await validateCandidateSourceRevision(repositoryRoot, candidateSha);
  const sourceManifest = sourceManifestFromGit(repositoryRoot, candidateSha);
  if (typeof artifactRoot !== "string" || artifactRoot.length === 0) {
    fail("predeploy artifact root is required");
  }
  const resolvedArtifactRoot = path.isAbsolute(artifactRoot)
    ? path.normalize(artifactRoot)
    : path.resolve(repositoryRoot, artifactRoot);
  const artifact = await validateArtifactSafety(resolvedArtifactRoot, sourceManifest);
  const receiptRaw = await readExactReceipt(repositoryRoot, authorityReceipt, controlSha);
  const enabledControl = parseStrictJson(readGitFile(repositoryRoot, controlSha, "data/release-control.json").toString("utf8"));
  const context = {
    ...runtime,
    now,
    candidateSha,
    productionPredecessor,
    sourceManifestSha256: sourceManifest.sha256,
    artifactManifestSha256: artifact.sha256,
  };
  const { receipt, receiptSha256 } = validatePredeployState({
    candidateControl,
    enabledControl,
    receiptRaw,
    context,
    pagesObservation: await readPagesObservation(repositoryRoot),
  });
  return Object.freeze({
    mode: "predeploy",
    candidateSha,
    controlSha,
    productionPredecessor,
    receiptSha256,
    releaseEpochSha256: receipt.authority.epochSha256,
    sourceManifestSha256: sourceManifest.sha256,
    artifactManifestSha256: artifact.sha256,
    artifactFileCount: artifact.count,
    authority: "PUBLIC_TRUTH_ONLY",
  });
}

export function validatePagesDeploymentObservation(observation, controlSha) {
  digest(controlSha, "postdeploy control SHA", 40);
  exactObject(observation, ["status"], "Pages deployment observation");
  exactString(observation.status, "succeed", "Pages deployment status");
  return Object.freeze({
    buildVersion: controlSha,
    status: observation.status,
  });
}

export function validatePostdeployIdentity(identity) {
  exactObject(identity, [
    "actor",
    "actorId",
    "artifactFileCount",
    "artifactId",
    "artifactManifestSha256",
    "candidateSha",
    "controlSha",
    "deploymentPageUrl",
    "deploymentStatus",
    "origin",
    "pagesDeploymentBuildVersion",
    "pagesDeploymentStatus",
    "pagesDeploymentUrl",
    "repository",
    "repositoryId",
    "runAttempt",
    "runId",
    "sourceManifestSha256",
    "workflowSha",
  ], "postdeploy identity");
  digest(identity.candidateSha, "postdeploy candidate SHA", 40);
  digest(identity.controlSha, "postdeploy control SHA", 40);
  if (identity.candidateSha === identity.controlSha) {
    fail("postdeploy candidate and control identities must remain distinct");
  }
  digest(identity.artifactManifestSha256, "postdeploy artifact manifest SHA-256");
  digest(identity.sourceManifestSha256, "postdeploy source manifest SHA-256");
  if (!Number.isSafeInteger(identity.artifactFileCount) || identity.artifactFileCount < 1) {
    fail("postdeploy artifact file count must be a positive safe integer");
  }
  decimalId(identity.artifactId, "postdeploy artifact ID");
  exactString(identity.repository, REPOSITORY_FULL_NAME, "postdeploy repository");
  decimalId(identity.repositoryId, "postdeploy repository ID");
  decimalId(identity.actorId, "postdeploy actor ID");
  decimalId(identity.runId, "postdeploy run ID");
  exactString(identity.runAttempt, "1", "postdeploy run attempt");
  if (typeof identity.actor !== "string" || identity.actor.length === 0) {
    fail("postdeploy actor is required");
  }
  exactString(identity.workflowSha, identity.controlSha, "postdeploy workflow SHA");
  exactString(
    identity.pagesDeploymentBuildVersion,
    identity.controlSha,
    "Pages deployment build version",
  );
  exactString(
    identity.pagesDeploymentUrl,
    `https://api.github.com/repos/${REPOSITORY_FULL_NAME}/pages/deployments/${identity.controlSha}`,
    "Pages deployment observation URL",
  );
  exactString(identity.deploymentStatus, "success", "deploy-pages action outcome");
  exactString(identity.pagesDeploymentStatus, "succeed", "Pages deployment observation status");
  const origin = normalizeLiveOrigin(identity.origin);
  exactString(normalizeLiveOrigin(identity.deploymentPageUrl), origin, "deployed Pages URL");
  return Object.freeze({ ...identity, origin });
}

async function observePagesDeployment({
  controlSha,
  env,
  fetchImpl,
  requestTimeoutMs,
}) {
  const token = env.GH_TOKEN;
  if (
    typeof token !== "string"
    || token.length < 20
    || token.length > 4096
    || /\s/u.test(token)
  ) fail("postdeploy Pages observation requires one bounded GitHub token");
  const url = `https://api.github.com/repos/${REPOSITORY_FULL_NAME}/pages/deployments/${controlSha}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      credentials: "omit",
      headers: Object.freeze({
        "accept": "application/vnd.github+json",
        "authorization": `Bearer ${token}`,
        "user-agent": "sitesourcery-public-truth-postdeploy",
        "x-github-api-version": "2022-11-28",
      }),
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    if (
      !response
      || response.status !== 200
      || response.redirected === true
      || (response.url !== "" && response.url !== url)
      || response.headers?.get?.("location") !== null
    ) fail("exact GitHub Pages deployment observation GET did not return a direct 200 response");
    const { bytes, overflow } = await readBoundedResponse(
      response,
      POSTDEPLOY_OBSERVATION_MAX_BYTES,
      controller,
    );
    if (overflow) fail("GitHub Pages deployment observation exceeded its byte bound");
    return Object.freeze({
      ...validatePagesDeploymentObservation(
        parseStrictJson(bytes.toString("utf8")),
        controlSha,
      ),
      url,
    });
  } catch (error) {
    if (error instanceof PublicTruthVerificationError) throw error;
    fail(`GitHub Pages deployment observation GET failed: ${boundedErrorMessage(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultBrowserAudit(options) {
  const { auditBrowser } = await import("./browser-audit-vnext.mjs");
  return auditBrowser(options);
}

async function writePostdeployEvidence(evidencePath, evidence) {
  if (
    typeof evidencePath !== "string"
    || !path.isAbsolute(evidencePath)
    || path.basename(evidencePath) !== POSTDEPLOY_EVIDENCE_FILE
  ) fail(`postdeploy evidence path must be absolute and end in ${POSTDEPLOY_EVIDENCE_FILE}`);
  const parent = path.dirname(evidencePath);
  const parentStat = await lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    fail("postdeploy evidence parent must be one real directory");
  }
  exactString(await realpath(parent), parent, "postdeploy evidence parent canonical path");
  scanPlainJson(evidence);
  try {
    await writeFile(evidencePath, `${stableStringify(evidence)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code === "EEXIST") fail("postdeploy evidence file must not already exist");
    throw error;
  }
}

function sealPostdeployEvidence(evidence) {
  const proofSha256 = sha256(stableStringify(evidence));
  return Object.freeze({ ...evidence, proofSha256 });
}

function postdeployContext({
  artifact,
  identity,
  receipt,
  receiptSha256,
}) {
  return Object.freeze({
    artifactFileCount: artifact.count,
    artifactManifestSha256: artifact.sha256,
    identity,
    receiptSha256,
    releaseEpochSha256: receipt.authority.epochSha256,
  });
}

export async function verifyPostdeploy({
  root,
  artifactRoot,
  artifactId,
  candidateSha,
  controlSha,
  productionPredecessor,
  authorityReceipt,
  origin,
  deploymentPageUrl,
  deploymentStatus,
  evidence,
  env = process.env,
  now = Date.now,
  sleep = defaultSleep,
  fetchImpl = globalThis.fetch,
  browserAudit = defaultBrowserAudit,
  propagationWindowMs = POSTDEPLOY_PROPAGATION_WINDOW_MS,
  pollIntervalMs = POSTDEPLOY_POLL_INTERVAL_MS,
  requestTimeoutMs = POSTDEPLOY_REQUEST_TIMEOUT_MS,
} = {}) {
  const repositoryRoot = await validateRoot(root);
  digest(candidateSha, "postdeploy candidate SHA", 40);
  digest(controlSha, "postdeploy control SHA", 40);
  digest(productionPredecessor, "postdeploy production predecessor", 40);
  exactString(productionPredecessor, PRODUCTION_PREDECESSOR_SHA, "postdeploy production predecessor");
  if (deploymentStatus !== "success") {
    fail(`postdeploy proof requires a successful deploy-pages outcome, received ${JSON.stringify(deploymentStatus)}`);
  }
  exactString(git(repositoryRoot, ["rev-parse", "HEAD"]), controlSha, "postdeploy control checkout HEAD");
  validateCleanTrackedCheckout(repositoryRoot);
  validateCandidateGraph(repositoryRoot, candidateSha);
  exactString(gitParent(repositoryRoot, controlSha, "postdeploy control"), candidateSha, "postdeploy control parent");
  exactArray(
    gitDiffPaths(repositoryRoot, candidateSha, controlSha),
    CONTROL_CHANGED_PATHS,
    "postdeploy control changed paths",
  );
  const runtime = validateRuntimeAuthorityEnvironment(env, controlSha);
  const { control: candidateControl } = await validateCandidateSourceRevision(repositoryRoot, candidateSha);
  const sourceManifest = sourceManifestFromGit(repositoryRoot, candidateSha);
  if (typeof artifactRoot !== "string" || artifactRoot.length === 0) {
    fail("postdeploy artifact root is required");
  }
  const resolvedArtifactRoot = path.isAbsolute(artifactRoot)
    ? path.normalize(artifactRoot)
    : path.resolve(repositoryRoot, artifactRoot);
  const artifact = await validateArtifactSafety(resolvedArtifactRoot, sourceManifest);
  validateProductionRouteManifest(artifact);
  const receiptRaw = await readExactReceipt(repositoryRoot, authorityReceipt, controlSha);
  const receiptSha256 = sha256(receiptRaw);
  const currentTime = now();
  if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
    fail("postdeploy clock must return a nonnegative safe integer");
  }
  const parsedReceipt = parseStrictJson(receiptRaw.toString("utf8"));
  const receiptIdentityTime = Date.parse(parsedReceipt?.authority?.notBefore);
  if (!Number.isSafeInteger(receiptIdentityTime) || receiptIdentityTime < 0) {
    fail("postdeploy receipt notBefore must identify a valid nonnegative time");
  }
  /*
   * Predeploy already proves that authority is live immediately before the
   * mutation. Postdeploy is read-only and may outlast that one-shot window, so
   * it revalidates the receipt's immutable identity at its own notBefore rather
   * than treating later CDN propagation as new deployment authority.
   */
  const receipt = validateReceipt(parsedReceipt, {
    ...runtime,
    now: receiptIdentityTime,
    candidateSha,
    productionPredecessor,
    sourceManifestSha256: sourceManifest.sha256,
    artifactManifestSha256: artifact.sha256,
  });
  const enabledControl = parseStrictJson(
    readGitFile(repositoryRoot, controlSha, "data/release-control.json").toString("utf8"),
  );
  validateEnabledControl(enabledControl, receipt, receiptSha256, {
    ...runtime,
    now: receiptIdentityTime,
    candidateSha,
    productionPredecessor,
    sourceManifestSha256: sourceManifest.sha256,
    artifactManifestSha256: artifact.sha256,
  });
  validateCandidateControl(candidateControl);
  const pagesDeployment = await observePagesDeployment({
    controlSha,
    env,
    fetchImpl,
    requestTimeoutMs,
  });
  const identity = validatePostdeployIdentity({
    actor: runtime.actor,
    actorId: runtime.actorId,
    artifactFileCount: artifact.count,
    artifactId,
    artifactManifestSha256: artifact.sha256,
    candidateSha,
    controlSha,
    deploymentPageUrl,
    deploymentStatus,
    origin,
    pagesDeploymentBuildVersion: pagesDeployment.buildVersion,
    pagesDeploymentStatus: pagesDeployment.status,
    pagesDeploymentUrl: pagesDeployment.url,
    repository: runtime.repository,
    repositoryId: runtime.repositoryId,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    runId: env.GITHUB_RUN_ID,
    sourceManifestSha256: sourceManifest.sha256,
    workflowSha: env.GITHUB_WORKFLOW_SHA,
  });
  const context = postdeployContext({
    artifact,
    identity,
    receipt,
    receiptSha256,
  });

  try {
    const live = await pollLiveProduction({
      manifest: artifact,
      origin: identity.origin,
      fetchImpl,
      now,
      sleep,
      propagationWindowMs,
      pollIntervalMs,
      requestTimeoutMs,
    });
    const routes = await verifyProductionRouteContract({
      artifactRoot: resolvedArtifactRoot,
      manifest: artifact,
      finalSnapshot: live.finalSnapshot,
    });
    if (typeof browserAudit !== "function") fail("postdeploy exact browser audit is unavailable");
    const browser = await browserAudit({
      artifactRoot: resolvedArtifactRoot,
      origin: identity.origin,
      profile: "vnext",
      routes: Object.keys(PRODUCTION_CANONICAL_ROUTE_FILES),
    });
    if (
      !browser
      || !Array.isArray(browser.errors)
      || !Array.isArray(browser.results)
    ) fail("postdeploy exact browser audit returned an invalid result");
    if (browser.errors.length > 0) {
      postdeployFailure(
        `postdeploy exact browser audit failed: ${browser.errors.map(boundedErrorMessage).join("; ")}`,
        Object.freeze({
          ...context,
          browserErrorCount: browser.errors.length,
          result: "fail",
        }),
      );
    }
    const auditedRoutes = Object.keys(PRODUCTION_CANONICAL_ROUTE_FILES);
    const missingBrowserRoutes = auditedRoutes.filter((route) => (
      !browser.results.some((result) => result?.route === route)
    ));
    if (browser.results.length < auditedRoutes.length || missingBrowserRoutes.length > 0) {
      postdeployFailure(
        `postdeploy exact browser audit omitted required routes: ${missingBrowserRoutes.join(", ") || "result set is too small"}`,
        Object.freeze({
          ...context,
          browserResultCount: browser.results.length,
          missingBrowserRoutes: Object.freeze(missingBrowserRoutes),
          result: "fail",
        }),
      );
    }
    const artifactResources = live.finalSnapshot.resources.filter((resource) => resource.kind === "artifact");
    const absenceResources = live.finalSnapshot.resources.filter((resource) => resource.kind !== "artifact");
    const evidenceBody = {
      authority: {
        productionPredecessor,
        receiptSha256,
        releaseEpochSha256: receipt.authority.epochSha256,
      },
      browserAudit: {
        errorCount: 0,
        profile: "vnext",
        resultCount: browser.results.length,
        resultsSha256: sha256(stableStringify(browser.results)),
        routeCount: auditedRoutes.length,
      },
      candidateArtifact: {
        candidateSha,
        fileCount: artifact.count,
        files: artifactResources,
        manifestSha256: artifact.sha256,
        sourceManifestSha256: sourceManifest.sha256,
      },
      generatedAt: new Date(live.completedAtMs).toISOString(),
      github: {
        actor: identity.actor,
        actorId: identity.actorId,
        artifactId: identity.artifactId,
        controlSha: identity.controlSha,
        deploymentActionOutcome: identity.deploymentStatus,
        deploymentPageUrl: identity.deploymentPageUrl,
        pagesDeploymentBuildVersion: identity.pagesDeploymentBuildVersion,
        pagesDeploymentStatus: identity.pagesDeploymentStatus,
        pagesDeploymentUrl: identity.pagesDeploymentUrl,
        repository: identity.repository,
        repositoryId: identity.repositoryId,
        runAttempt: identity.runAttempt,
        runId: identity.runId,
        workflowSha: identity.workflowSha,
      },
      production: {
        absenceProofs: absenceResources,
        attempts: live.attempts,
        canonicalRoutes: routes.canonicalRoutes,
        completedAt: new Date(live.completedAtMs).toISOString(),
        consecutiveExactFullSnapshots: live.consecutiveExactFullSnapshots,
        custom404Path: routes.custom404Path,
        legacyRedirects: routes.legacyRedirects,
        origin: identity.origin,
        propagationWindowMs: live.propagationWindowMs,
        sourceOnlyRedirectAbsence: routes.sourceOnlyRedirectAbsence,
        startedAt: new Date(live.startedAtMs).toISOString(),
      },
      result: "pass",
      schema: POSTDEPLOY_EVIDENCE_SCHEMA,
    };
    const sealedEvidence = sealPostdeployEvidence(evidenceBody);
    await writePostdeployEvidence(evidence, sealedEvidence);
    return Object.freeze({
      mode: "postdeploy",
      authority: "PUBLIC_TRUTH_ONLY",
      artifactFileCount: artifact.count,
      artifactId,
      artifactManifestSha256: artifact.sha256,
      browserAuditResultCount: browser.results.length,
      candidateSha,
      controlSha,
      evidencePath: evidence,
      origin: identity.origin,
      productionResourceCount: live.finalSnapshot.totalResourceCount,
      proofSha256: sealedEvidence.proofSha256,
      releaseEpochSha256: receipt.authority.epochSha256,
      runId: identity.runId,
    });
  } catch (error) {
    if (error && typeof error === "object" && !error.postdeployContext) {
      error.postdeployContext = context;
    }
    throw error;
  }
}

function failureEvidence(options, env, error) {
  const body = {
    candidateArtifact: {
      candidateSha: options.candidateSha ?? null,
      context: error?.postdeployContext ?? null,
    },
    error: {
      message: boundedErrorMessage(error),
      name: error?.name ?? "Error",
    },
    generatedAt: new Date().toISOString(),
    github: {
      artifactId: options.artifactId ?? null,
      controlSha: options.controlSha ?? null,
      deploymentActionOutcome: options.deploymentStatus ?? null,
      deploymentPageUrl: options.deploymentPageUrl ?? null,
      repository: env.GITHUB_REPOSITORY ?? null,
      repositoryId: env.GITHUB_REPOSITORY_ID ?? null,
      runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
      runId: env.GITHUB_RUN_ID ?? null,
      workflowSha: env.GITHUB_WORKFLOW_SHA ?? null,
    },
    production: {
      details: error?.postdeployEvidence ?? null,
      origin: options.origin ?? null,
    },
    result: "fail",
    schema: POSTDEPLOY_EVIDENCE_SCHEMA,
  };
  return sealPostdeployEvidence(body);
}

export function parseCli(argv) {
  if (!Array.isArray(argv)) fail("CLI arguments must be an array");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (typeof flag !== "string" || !flag.startsWith("--")) fail(`unexpected positional argument ${JSON.stringify(flag)}`);
    if (value === undefined || value.startsWith("--")) fail(`flag ${flag} requires one explicit value`);
    if (values.has(flag)) fail(`duplicate flag ${flag}`);
    values.set(flag, value);
  }
  const mode = values.get("--mode");
  if (!["candidate", "control", "predeploy", "postdeploy"].includes(mode)) {
    fail("--mode must be exactly candidate, control, predeploy, or postdeploy");
  }
  const expected = mode === "candidate"
    ? ["--mode", "--root", "--candidate-sha", "--production-predecessor"]
    : [
        "--mode",
        "--root",
        "--candidate-sha",
        "--production-predecessor",
        "--control-sha",
        "--authority-receipt",
        ...(["predeploy", "postdeploy"].includes(mode) ? ["--artifact-root"] : []),
        ...(mode === "postdeploy" ? [
          "--artifact-id",
          "--deployment-page-url",
          "--deployment-status",
          "--evidence",
          "--origin",
        ] : []),
      ];
  const actual = [...values.keys()].sort();
  if (stableStringify(actual) !== stableStringify([...expected].sort())) {
    fail(`${mode} mode flags must be exactly ${expected.join(", ")}`);
  }
  return Object.freeze({
    mode,
    root: values.get("--root"),
    candidateSha: values.get("--candidate-sha"),
    productionPredecessor: values.get("--production-predecessor"),
    ...(mode !== "candidate" ? {
      controlSha: values.get("--control-sha"),
      authorityReceipt: values.get("--authority-receipt"),
    } : {}),
    ...(["predeploy", "postdeploy"].includes(mode)
      ? { artifactRoot: values.get("--artifact-root") }
      : {}),
    ...(mode === "postdeploy" ? {
      artifactId: values.get("--artifact-id"),
      deploymentPageUrl: values.get("--deployment-page-url"),
      deploymentStatus: values.get("--deployment-status"),
      evidence: values.get("--evidence"),
      origin: values.get("--origin"),
    } : {}),
  });
}

export async function runCli(argv = process.argv.slice(2), env = process.env) {
  const options = parseCli(argv);
  if (options.mode === "candidate") return verifyCandidate(options);
  if (options.mode === "control") return verifyControl({ ...options, env });
  if (options.mode === "predeploy") return verifyPredeploy({ ...options, env });
  try {
    return await verifyPostdeploy({ ...options, env });
  } catch (error) {
    try {
      await writePostdeployEvidence(options.evidence, failureEvidence(options, env, error));
    } catch (evidenceError) {
      throw new PublicTruthVerificationError(
        `${boundedErrorMessage(error)}; postdeploy failure evidence could not be preserved: `
        + boundedErrorMessage(evidenceError),
      );
    }
    throw error;
  }
}

async function main() {
  const result = await runCli();
  console.log(`PUBLIC_TRUTH_RELEASE_${result.mode.toUpperCase()}_PASS ${JSON.stringify(result)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`PUBLIC_TRUTH_RELEASE_DENIED ${error.message}`);
    process.exitCode = 1;
  });
}
