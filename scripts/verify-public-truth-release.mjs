import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstat,
  readFile,
  readdir,
  realpath,
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
export const AUTHORITY_STATEMENT = "Authorize one exact inquiry-open, checkout-disabled public-truth reconciliation; deny automated checkout, payment-provider, containment, customer-data, and general deployment authority.";
export const OG_PNG_SHA256 = "1e1bca44c9b62a54ee79ec670913970b54ff8405adb8520a9d95ee7b887983bc";
export const OG_SOURCE_SHA256 = "61c324f7c5b18ac2eed19d65b3510b8730654e8718c490966c79ee3195751868";
export const CARD_V9_PDF_SHA256 = "8b27ed01cec1dc005718af350a19bbe87a77b824acd1d73caf99029c5b3605fc";

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
  "legal/website-terms/index.html",
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
 * This is intentionally duplicated from (rather than imported from) the build
 * script. A candidate cannot weaken its artifact boundary by changing one
 * shared allow/deny list.
 */
export const EXCLUDED_ARTIFACT_TOP_LEVEL = Object.freeze([
  ".git",
  ".github",
  ".gitignore",
  ".htmlvalidate.json",
  ".nvmrc",
  "_site",
  "data",
  "flyer.html",
  "node_modules",
  "package-lock.json",
  "package.json",
  "print-collateral",
  "QUALITY.md",
  "scripts",
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
const ENABLE_FORM = /(?:\.disabled\s*=\s*false\b|removeAttribute\s*\(\s*["']disabled["']|\.requestSubmit\s*\(|\.submit\s*\()/u;

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
  const excluded = new Set(EXCLUDED_ARTIFACT_TOP_LEVEL);
  return sourceManifest.entries
    .filter((entry) => {
      const top = entry.path.split("/")[0];
      const basename = entry.path.slice(entry.path.lastIndexOf("/") + 1);
      return !excluded.has(top) && !basename.endsWith(".md");
    })
    .map(({ path: file, sha256: fileSha256, size }) => ({ path: file, sha256: fileSha256, size }));
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

export async function validateArtifactSafety(artifactRoot, sourceManifest) {
  const actual = await artifactManifest(artifactRoot);
  const expectedEntries = artifactProjectionEntries(sourceManifest);
  for (const entry of actual.entries) {
    const segments = entry.path.split("/");
    if (
      segments.some((segment) => PRIVATE_ARTIFACT_SEGMENT.test(segment))
      || PRIVATE_ARTIFACT_FILE.test(entry.path)
      || (entry.path.startsWith(".") && entry.path !== ".nojekyll")
    ) fail(`artifact contains development, governance, or private path ${entry.path}`);
    const bytes = await readFile(path.join(artifactRoot, ...entry.path.split("/")));
    if (entry.path.endsWith(".html")) {
      const html = bytes.toString("utf8");
      assertHeldForms(entry.path, html);
      if (entry.path === "contact/index.html" || entry.path === "start/index.html") {
        assertDirectInquiryGuide(entry.path, html);
      }
    }
    if (entry.path.endsWith(".js")) {
      const source = decodeHtml(bytes.toString("utf8"));
      if (PAYMENT_ENDPOINT.test(source)) fail(`${entry.path} contains an active payment-provider endpoint`);
      if (NETWORK_SINK.test(source)) fail(`${entry.path} contains an active browser network sink`);
      if (ENABLE_FORM.test(source)) fail(`${entry.path} can enable or submit a held form`);
    }
  }
  if (stableStringify(actual.entries) !== stableStringify(expectedEntries)) {
    const actualPaths = actual.entries.map((entry) => entry.path);
    const expectedPaths = expectedEntries.map((entry) => entry.path);
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
    "The Hive workbench is planning-only.",
    "It does not activate an integration",
    "Care requires its own explicit written scope.",
    "Provider hosting, public Internet publication, real billing, DNS work, and provider-side storage require a separately released service",
  ]) requireVisible(terms, marker, "legal/website-terms/index.html", errors);
  for (const marker of [
    "Desiderata Labs LLC operates this website under the filed alternate name SITESOURCERY",
    "The ordinary marketing pages contain no inquiry form, visitor upload, advertising tracker, or page-level analytics code.",
    "The Hive planner selects from fixed planning blueprints already present in the downloaded page script.",
    "Abracadabra’s private build contains local billing-lifecycle rehearsal states but no real payment rail.",
    "If you call or email, Site Sourcery may retain the communication and reasonable business records needed to respond, scope work, document decisions, deliver accepted work, protect the service, and meet legal obligations.",
  ]) requireVisible(privacy, marker, "legal/privacy/index.html", errors);
  for (const marker of [
    "Project inquiries are open",
    "Site Sourcery is accepting inquiries for Custom websites, website assessments, separately scoped Care, and working-system projects.",
    "The links below open the communication tools already on your device",
    "This is the studio’s current public intake address.",
    "(856) 244-1220",
    "sitesourcery@proton.me",
  ]) requireVisible(contact, marker, "contact/index.html", errors);
  for (const [pattern, label, text] of [
    [/\bpayment alone (?:authorizes|starts|launches|transfers|activates|approves)\b/iu, "legal/website-terms/index.html", terms],
    [/\b(?:this public site|the public site) (?:accepts|takes|processes|collects) (?:orders|payments?|card details?)\b/iu, "legal/website-terms/index.html", terms],
    [/\bHive (?:runs|activates|operates) (?:an? )?(?:integration|automation|business process)\b/iu, "legal/website-terms/index.html", terms],
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
  if (!validateJob) errors.push("workflow must contain exactly one anchored validate job");
  if (!deployJob) errors.push("workflow must contain exactly one anchored deploy job");
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
  if (!["candidate", "control", "predeploy"].includes(mode)) fail("--mode must be exactly candidate, control, or predeploy");
  const expected = mode === "candidate"
    ? ["--mode", "--root", "--candidate-sha", "--production-predecessor"]
    : [
        "--mode",
        "--root",
        "--candidate-sha",
        "--production-predecessor",
        "--control-sha",
        "--authority-receipt",
        ...(mode === "predeploy" ? ["--artifact-root"] : []),
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
    ...(mode === "predeploy" ? { artifactRoot: values.get("--artifact-root") } : {}),
  });
}

export async function runCli(argv = process.argv.slice(2), env = process.env) {
  const options = parseCli(argv);
  if (options.mode === "candidate") return verifyCandidate(options);
  if (options.mode === "control") return verifyControl({ ...options, env });
  return verifyPredeploy({ ...options, env });
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
