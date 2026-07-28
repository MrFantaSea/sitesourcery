import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { buildPagesArtifact, excludedTopLevel } from "./build-pages.mjs";

const root = process.cwd();
const ignoredDirectories = new Set([".git", "_site", "node_modules"]);
const errors = [];
const counts = { references: 0, fragments: 0, scripts: 0, jsonLd: 0, forms: 0 };
const canonicalCustomerMailbox = "sitesourcery@proton.me";
const canonicalCustomerPhone = Object.freeze({
  digits: "8562441220",
  tel: "tel:+18562441220",
  jsonLd: "+1-856-244-1220",
  display: "(856) 244-1220",
});
const prohibitedLegacyMailbox = "hello@sitesourcery.com";
const filedNameLegend = "Site Sourcery is an alternate name of Desiderata Labs LLC. Desiderata Labs LLC is the legal seller.";
const privacyControllerLegend = "Site Sourcery is an alternate name of Desiderata Labs LLC. Desiderata Labs LLC is the legal seller and controller responsible for information covered by this notice.";
const productionPredecessor = "eff8195640db58390d03eefbe863248220994e37";
const writableCardFile = "print-collateral/sitesourcery-card-finalist-v9.html";
const writableCardPdfFile = "print-collateral/sitesourcery-card-finalist-v9.pdf";
const writableCardPdfDigest = "8b27ed01cec1dc005718af350a19bbe87a77b824acd1d73caf99029c5b3605fc";
const frozenPrintCollateral = Object.freeze({
  "print-collateral/sitesourcery-card-finalist-v8.html": "84fd4b4b1d782b50b42d65b1539898a6e52af29eca31377f1e44c8f41ceee51b",
  "print-collateral/sitesourcery-card-finalist-v8.pdf": "579b8cec150205000008c7f919b7569b604c190175f47808e97f9dcf0ffff3ad",
  "print-collateral/assets/qr-start.svg": "044f1f0148e4c848c8708c4cba8dce8f7696a5b09151f4ae38c11561592ae8f3",
});
const mailboxSurfaces = new Set([
  "404.html",
  "about.html",
  "automation.html",
  "contact.html",
  "faq.html",
  "how-it-works.html",
  "index.html",
  "pricing.html",
  "privacy.html",
  "start/index.html",
  "terms.html",
  "thanks.html",
]);
const fullFooterSurfaces = new Set([
  "404.html",
  "about.html",
  "automation.html",
  "contact.html",
  "faq.html",
  "how-it-works.html",
  "index.html",
  "pricing.html",
  "privacy.html",
  "start/index.html",
  "terms.html",
]);
const zeroEntryGuideSurfaces = new Set(["contact.html", "start/index.html"]);

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const publicCatalog = JSON.parse(await readFile(path.join(root, "data/public-catalog.json"), "utf8"));
const expectedCatalogIdentity = Object.freeze({
  version: "SS-COMMERCIAL-2026.5",
  tierCatalogId: "SS-TIERS-2026.5",
  addonCatalogId: "SS-ADDONS-2026.5",
  careCatalogId: "SS-CARE-2026.5",
  professionalServiceCatalogId: "SS-PROFESSIONAL-2026.1",
  sourceCatalogDigest: "0474cd8a48b0b28760e6aa1696eb0021de02f5420646a44efae625bba6a74bcc",
  projectionDigest: "17f141f964fe604d87e4021ce6b209f04562b5c174ad7e480b7b62bfc103021a",
});
const releaseControl = JSON.parse(await readFile(path.join(root, "data/release-control.json"), "utf8"));
const pagesWorkflow = await readFile(path.join(root, ".github/workflows/pages.yml"), "utf8");
const containmentWorkflow = await readFile(path.join(root, ".github/workflows/containment.yml"), "utf8");
const publicTruthWorkflow = await readFile(path.join(root, ".github/workflows/public-truth-reconciliation.yml"), "utf8");
const atelierCommerceJavaScript = await readFile(path.join(root, "atelier-commerce.js"), "utf8");
const quality = packageJson.siteQuality ?? {};
const siteOrigin = String(quality.origin ?? "").replace(/\/$/, "");
const allowedFormActions = new Set(quality.allowedFormActions ?? []);
const inquiryOnly = publicCatalog.offerState === "inquiry-only";

async function walk(directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return files;
}

const files = await walk();
const fileSet = new Set(files);
const htmlFiles = files.filter((file) => file.endsWith(".html"));
const deployableHtmlFiles = htmlFiles.filter((file) => !file.startsWith("print-collateral/"));
const deployableHtmlFileSet = new Set(deployableHtmlFiles);
const cssFiles = files.filter((file) => file.endsWith(".css"));
const jsFiles = files.filter((file) => file.endsWith(".js"));
const htmlSources = new Map();

for (const file of htmlFiles) htmlSources.set(file, await readFile(path.join(root, file), "utf8"));

function report(file, message) {
  errors.push(`${file}: ${message}`);
}

for (const [file, expectedDigest] of Object.entries(frozenPrintCollateral)) {
  if (!fileSet.has(file)) {
    report(file, "frozen print-collateral dependency is missing");
    continue;
  }
  const actualDigest = createHash("sha256").update(await readFile(path.join(root, file))).digest("hex");
  if (actualDigest !== expectedDigest) {
    report(file, `frozen print-collateral dependency changed: expected ${expectedDigest}, received ${actualDigest}`);
  }
}

if (!fileSet.has(writableCardPdfFile)) {
  report(writableCardPdfFile, "generated writable-back V9 print artifact is missing");
} else {
  const pdf = await readFile(path.join(root, writableCardPdfFile));
  if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    report(writableCardPdfFile, "generated writable-back V9 print artifact is not a PDF");
  }
  const actualDigest = createHash("sha256").update(pdf).digest("hex");
  if (actualDigest !== writableCardPdfDigest) {
    report(writableCardPdfFile, `generated writable-back V9 print artifact must match the reviewed exact bytes ${writableCardPdfDigest}; received ${actualDigest}`);
  }
}

const writableCard = htmlSources.get(writableCardFile);
if (writableCard === undefined) {
  report(writableCardFile, "writable-back V9 card source is missing");
} else {
  const requiredMarkers = [
    '<section class="page back" aria-label="Site Sourcery writable contact side" data-print-side="writable-back" data-back-stock="uncoated-writable" data-back-finishes="none">',
    '<p class="demo-label">Client Demo URL</p>',
    '<span class="scheme">https://</span>',
    'data-writable-width-in="2.62"',
    'data-writable-height-in="0.50"',
    'data-print-width-in="0.80"',
    ".back{background:#fff}",
    ".back::before{content:\"\";position:absolute;left:0;top:0;bottom:0;width:.19in;",
    ".qr img{display:block;width:.8in;height:.8in;background:#fff}",
    ".write-space{width:2.62in;height:.50in;background:#fff;",
    "@page{size:3.75in 2.25in;margin:0}",
    "uncoated and writable",
    "no gloss, UV, aqueous coating, soft-touch, or laminate",
    "physical blue/black ballpoint dry-and-smudge test",
    canonicalCustomerMailbox,
    canonicalCustomerPhone.tel,
    canonicalCustomerPhone.display,
  ];
  for (const marker of requiredMarkers) {
    if (!writableCard.includes(marker)) report(writableCardFile, `missing writable-back print marker ${JSON.stringify(marker)}`);
  }
  if (!writableCard.includes("<h1>Web Studio</h1>") || !writableCard.includes("<span>EST. 2026<br>SOUTH JERSEY</span>")) {
    report(writableCardFile, "must preserve the V8 front identity");
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

for (const [field, expected] of Object.entries(expectedCatalogIdentity)) {
  if (publicCatalog[field] !== expected) {
    report("data/public-catalog.json", `${field} must be ${expected}; received ${publicCatalog[field] ?? "missing"}`);
  }
}
const { projectionDigest: ignoredProjectionDigest, ...projectionPayload } = publicCatalog;
const recomputedProjectionDigest = createHash("sha256").update(stableStringify(projectionPayload)).digest("hex");
if (publicCatalog.projectionDigest !== recomputedProjectionDigest) {
  report("data/public-catalog.json", `projectionDigest does not match the independently recomputed semantic projection digest ${recomputedProjectionDigest}`);
}

if (inquiryOnly && (releaseControl.state !== "hold" || releaseControl.allowsDeployment !== false)) {
  report("data/release-control.json", "inquiry-only catalog requires a held deployment state");
}
if (releaseControl.allowsDeployment === true && releaseControl.state !== "cleared") {
  report("data/release-control.json", "deployment authority requires state=cleared");
}
if (releaseControl.allowsCommercialDeployment !== releaseControl.allowsDeployment) {
  report("data/release-control.json", "commercial deployment flags must agree");
}
if (excludedTopLevel.filter((entry) => entry === "print-collateral").length !== 1) {
  report("scripts/build-pages.mjs", "Pages artifact must actively exclude print-collateral exactly once");
}
if (excludedTopLevel.filter((entry) => entry === "flyer.html").length !== 1) {
  report("scripts/build-pages.mjs", "Pages artifact must actively exclude the stale print flyer exactly once");
}
const scratchBuildRoot = await mkdtemp(path.join(tmpdir(), "sitesourcery-pages-check-"));
try {
  const scratchArtifact = path.join(scratchBuildRoot, "_site");
  buildPagesArtifact({ root, output: scratchArtifact });
  try {
    await lstat(path.join(scratchArtifact, "print-collateral"));
    report("scripts/build-pages.mjs", "built Pages artifact contains excluded print-collateral");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await lstat(path.join(scratchArtifact, "flyer.html"));
    report("scripts/build-pages.mjs", "built Pages artifact contains excluded stale print flyer");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
} finally {
  await rm(scratchBuildRoot, { recursive: true, force: true });
}
if (typeof releaseControl.allowsContainmentDeployment !== "boolean") {
  report("data/release-control.json", "containment deployment authority must be an explicit boolean");
}
if (typeof releaseControl.allowsPublicTruthReconciliationDeployment !== "boolean") {
  report("data/release-control.json", "public-truth reconciliation authority must be an explicit boolean");
}
const publicTruthControl = releaseControl.publicTruthReconciliation;
if (!publicTruthControl || typeof publicTruthControl !== "object" || Array.isArray(publicTruthControl)) {
  report("data/release-control.json", "public-truth reconciliation control must be an explicit object");
} else {
  if (publicTruthControl.requiredProductionPredecessor !== productionPredecessor) {
    report("data/release-control.json", `public-truth reconciliation predecessor must be ${productionPredecessor}`);
  }
  if (releaseControl.allowsPublicTruthReconciliationDeployment === false) {
    if (
      publicTruthControl.state !== "hold"
      || publicTruthControl.approvedCandidateSha !== null
      || publicTruthControl.authorityReceiptSha256 !== null
    ) {
      report("data/release-control.json", "held public-truth control must have hold state and null candidate/receipt");
    }
  } else {
    if (
      releaseControl.state !== "hold"
      || releaseControl.allowsDeployment !== false
      || releaseControl.allowsCommercialDeployment !== false
      || releaseControl.allowsContainmentDeployment !== false
    ) {
      report("data/release-control.json", "public-truth-only authority cannot combine with general, commercial, or containment authority");
    }
    if (publicTruthControl.state !== "cleared") {
      report("data/release-control.json", "enabled public-truth control requires state=cleared");
    }
    if (
      !/^[0-9a-f]{40}$/u.test(publicTruthControl.approvedCandidateSha ?? "")
      || /^([0-9a-f])\1{39}$/u.test(publicTruthControl.approvedCandidateSha ?? "")
    ) {
      report("data/release-control.json", "enabled public-truth control requires one exact non-degenerate lowercase candidate commit");
    }
    if (
      !/^[0-9a-f]{64}$/u.test(publicTruthControl.authorityReceiptSha256 ?? "")
      || /^([0-9a-f])\1{63}$/u.test(publicTruthControl.authorityReceiptSha256 ?? "")
    ) {
      report("data/release-control.json", "enabled public-truth control requires one exact non-degenerate authority receipt SHA-256");
    }
  }
}
for (const marker of [
  "run: npm test",
  "--require-root-lineage",
  "data/release-control.json",
  "run: npm run build:pages",
  "path: _site",
]) {
  if (!pagesWorkflow.includes(marker)) report(".github/workflows/pages.yml", `missing controlled-release marker ${JSON.stringify(marker)}`);
}
for (const marker of [
  "production_sha",
  "remove_path",
  "allowsContainmentDeployment",
  "prepare-containment.mjs",
  "target/_site",
]) {
  if (!containmentWorkflow.includes(marker)) report(".github/workflows/containment.yml", `missing containment marker ${JSON.stringify(marker)}`);
}
for (const marker of [
  "workflow_dispatch:",
  "control_sha:",
  "candidate_sha:",
  "production_predecessor:",
  "authority_receipt_sha256:",
  productionPredecessor,
  "allowsPublicTruthReconciliationDeployment !== true",
  "allowsCommercialDeployment !== false",
  'catalog.offerState !== "inquiry-only"',
  'git rev-parse HEAD',
  "run: npm test",
  "--require-root-lineage",
  "run: npm run build:pages",
  "--directory target/_site",
  "pages: read",
  "actions: read",
  'Authorization: Bearer $GH_TOKEN',
  "--mode predeploy",
  "name: github-pages",
  "artifact_id: ${{ steps.pages-artifact.outputs.artifact-id }}",
  "ARTIFACT_ID: ${{ needs.validate.outputs.artifact_id }}",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "/actions/runs/$GITHUB_RUN_ID/artifacts?name=github-pages",
  "unzip -Z1",
  "unzip -p",
  "python3 -",
  "artifact_name: github-pages",
]) {
  if (!publicTruthWorkflow.includes(marker)) {
    report(".github/workflows/public-truth-reconciliation.yml", `missing exact public-truth marker ${JSON.stringify(marker)}`);
  }
}
if (publicTruthWorkflow.includes("actions/upload-pages-artifact@")) {
  report(".github/workflows/public-truth-reconciliation.yml", "public-truth workflow must not hide a mutable transitive uploader");
}
if ((publicTruthWorkflow.match(/pages\/builds\/latest/gu) ?? []).length !== 2) {
  report(".github/workflows/public-truth-reconciliation.yml", "public-truth workflow must observe the Pages predecessor before upload and immediately before deployment");
}
if (/(?:^|\n)\s+(?:push|pull_request|schedule)\s*:/u.test(publicTruthWorkflow)) {
  report(".github/workflows/public-truth-reconciliation.yml", "public-truth deployment must be manual workflow_dispatch only");
}

function decodeHtmlAttribute(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#x([0-9a-f]+);?/gi, (_, digits) => decodeCodePoint(digits, 16))
    .replace(/&#([0-9]+);?/g, (_, digits) => decodeCodePoint(digits, 10))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&colon;/gi, ":")
    .replace(/&lpar;/gi, "(")
    .replace(/&rpar;/gi, ")")
    .replace(/&plus;/gi, "+")
    .replace(/&hyphen;|&minus;/gi, "-")
    .replace(/&period;/gi, ".")
    .replace(/&nbsp;/gi, " ");
}

function decodeCodePoint(digits, radix) {
  const value = Number.parseInt(digits, radix);
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
    return "\ufffd";
  }
  return String.fromCodePoint(value);
}

const publicPhonePattern = /(?:\+?1[-.\s]*)?\(?\d{3}\)?[-.\s]+\d{3}[-.\s]+\d{4}/i;
const publicPhonePatternGlobal = /(?:\+?1[-.\s]*)?\(?\d{3}\)?[-.\s]+\d{3}[-.\s]+\d{4}/gi;

function normalizedNorthAmericanPhone(value) {
  const digits = String(value).replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function checkJsonLdContactValues(file, value, trail = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => checkJsonLdContactValues(file, entry, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    const nextTrail = `${trail}.${key}`;
    if (key.toLowerCase() === "telephone" && (
      typeof entry !== "string"
      || normalizedNorthAmericanPhone(entry) !== canonicalCustomerPhone.digits
    )) {
      report(file, `deployable JSON-LD telephone must be the designated Google Voice number ${canonicalCustomerPhone.jsonLd} at ${nextTrail}`);
    }
    if (key.toLowerCase() === "email" && (
      typeof entry !== "string"
      || entry.toLowerCase() !== canonicalCustomerMailbox
    )) {
      report(file, `deployable JSON-LD email must be ${canonicalCustomerMailbox} at ${nextTrail}`);
    }
    if (typeof entry === "string") {
      const decoded = decodeHtmlAttribute(entry);
      if (/\bsms:/i.test(decoded)) {
        report(file, `deployable JSON-LD must not publish an SMS route at ${nextTrail}`);
      }
      for (const match of decoded.matchAll(/\btel:[^"',\s<]+/gi)) {
        if (match[0].toLowerCase() !== canonicalCustomerPhone.tel) {
          report(file, `deployable JSON-LD phone route must be ${canonicalCustomerPhone.tel} at ${nextTrail}`);
        }
      }
      if (decoded.toLowerCase().includes(prohibitedLegacyMailbox)) {
        report(file, `deployable JSON-LD contains prohibited mailbox ${prohibitedLegacyMailbox} at ${nextTrail}`);
      }
      const publicPhone = decoded.match(publicPhonePattern)?.[0];
      if (publicPhone && normalizedNorthAmericanPhone(publicPhone) !== canonicalCustomerPhone.digits) {
        report(file, `deployable JSON-LD contains a phone number other than the designated Google Voice route at ${nextTrail}`);
      }
    } else {
      checkJsonLdContactValues(file, entry, nextTrail);
    }
  }
}

function attribute(attributes, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\u0060]+))`, "i").exec(attributes);
  return match ? decodeHtmlAttribute(match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function hasAttribute(attributes, name) {
  return new RegExp(`(?:^|\\s)${name}(?:\\s|=|$)`, "i").test(attributes);
}

function fieldsetRanges(markup) {
  const ranges = [];
  const stack = [];
  const pattern = /<\/?fieldset\b[^>]*>/gi;
  for (const match of markup.matchAll(pattern)) {
    if (/^<\//.test(match[0])) {
      const opened = stack.pop();
      if (opened) {
        ranges.push({
          ...opened,
          closeStart: match.index,
          end: match.index + match[0].length,
        });
      }
      continue;
    }
    const attributes = /^<fieldset\b([^>]*)>$/i.exec(match[0])?.[1] ?? "";
    stack.push({
      attributes,
      openStart: match.index,
      contentStart: match.index + match[0].length,
      depth: stack.length,
    });
  }
  return ranges;
}

function localizeReference(rawValue) {
  let value = decodeHtmlAttribute(String(rawValue)).trim();
  if (!value) return null;
  if (siteOrigin && (value === siteOrigin || value.startsWith(`${siteOrigin}/`) || value.startsWith(`${siteOrigin}#`) || value.startsWith(`${siteOrigin}?`))) {
    try {
      const url = new URL(value);
      value = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return { invalid: `invalid URL ${JSON.stringify(value)}` };
    }
  } else if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) {
    return null;
  }
  return { value };
}

function candidatesFor(sourceFile, pathname) {
  if (pathname === "") return { candidates: [sourceFile] };
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { invalid: `invalid percent-encoding in ${JSON.stringify(pathname)}` };
  }
  const sourceDirectory = path.posix.dirname(sourceFile);
  const relative = decoded.startsWith("/")
    ? path.posix.normalize(decoded.slice(1))
    : path.posix.normalize(path.posix.join(sourceDirectory, decoded));
  if (relative === ".." || relative.startsWith("../")) {
    return { invalid: `reference escapes the repository root: ${JSON.stringify(pathname)}` };
  }
  const normalized = relative === "." ? "" : relative.replace(/^\.\//, "");
  const candidates = [];
  if (!normalized || decoded.endsWith("/")) candidates.push(path.posix.join(normalized, "index.html"));
  else {
    candidates.push(normalized);
    if (!path.posix.extname(normalized)) {
      candidates.push(`${normalized}.html`);
      candidates.push(path.posix.join(normalized, "index.html"));
    }
  }
  return { candidates: [...new Set(candidates)] };
}

function idsIn(file) {
  const source = htmlSources.get(file);
  if (source === undefined) return new Set();
  const markup = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, "<script$1></script>")
    .replace(/<style\b([^>]*)>[\s\S]*?<\/style\s*>/gi, "<style$1></style>");
  const ids = new Set();
  const pattern = /\b(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>\u0060]+))/gi;
  for (const match of markup.matchAll(pattern)) ids.add(decodeHtmlAttribute(match[1] ?? match[2] ?? match[3]));
  return ids;
}

function checkReference(sourceFile, rawValue) {
  const localized = localizeReference(rawValue);
  if (!localized) return;
  if (localized.invalid) {
    report(sourceFile, localized.invalid);
    return;
  }
  const value = localized.value;
  const hashAt = value.indexOf("#");
  const rawFragment = hashAt >= 0 ? value.slice(hashAt + 1) : null;
  const withoutFragment = hashAt >= 0 ? value.slice(0, hashAt) : value;
  const pathname = withoutFragment.split("?", 1)[0];
  const targetResult = candidatesFor(sourceFile, pathname);
  if (targetResult.invalid) {
    report(sourceFile, targetResult.invalid);
    return;
  }
  const target = targetResult.candidates.find((candidate) => fileSet.has(candidate));
  counts.references += 1;
  if (!target) {
    report(sourceFile, `missing local target ${JSON.stringify(value)} (tried ${targetResult.candidates.join(", ")})`);
    return;
  }
  if (rawFragment && target.endsWith(".html")) {
    let fragment;
    try {
      fragment = decodeURIComponent(rawFragment);
    } catch {
      report(sourceFile, `invalid fragment encoding in ${JSON.stringify(value)}`);
      return;
    }
    counts.fragments += 1;
    if (!idsIn(target).has(fragment)) report(sourceFile, `missing fragment #${fragment} in ${target}`);
  }
}

function checkCssReferences(file, css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'"\s][^)]*?))\s*\)/gi;
  for (const match of source.matchAll(pattern)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (value && !value.startsWith("#")) checkReference(file, value);
  }
}

function checkJavaScript(file, source, label = file) {
  try {
    new vm.Script(source, { filename: label, displayErrors: true });
    counts.scripts += 1;
  } catch (error) {
    report(file, `JavaScript parse error in ${label}: ${error.message}`);
  }
}

function checkForms(file, html) {
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)];
  for (const [index, form] of forms.entries()) {
    const formBody = form[2].replace(/<!--[\s\S]*?-->/g, (comment) => " ".repeat(comment.length));
    counts.forms += 1;
    const action = attribute(form[1], "action") ?? "";
    const method = (attribute(form[1], "method") ?? "get").toLowerCase();
    const remote = /^https?:\/\//i.test(action);
    if (/^http:\/\//i.test(action)) report(file, `form ${index + 1} uses an insecure action`);
    if (remote && method !== "post") report(file, `remote form ${index + 1} must use POST`);
    if (remote && !allowedFormActions.has(action)) {
      report(file, `remote form ${index + 1} has an unapproved action ${JSON.stringify(action)}`);
    }
    if (inquiryOnly) {
      if (action) report(file, `form ${index + 1} must not have an action while the public catalog is inquiry-only`);
      if (attribute(form[1], "data-commercial-state") !== "hold") {
        report(file, `form ${index + 1} must declare data-commercial-state="hold" while the public catalog is inquiry-only`);
      }
      if (attribute(form[1], "data-no-entry") !== "true") {
        report(file, `form ${index + 1} must declare data-no-entry="true" while the public catalog is inquiry-only`);
      }
      if (attribute(form[1], "aria-disabled") !== "true") {
        report(file, `form ${index + 1} must declare aria-disabled="true" while the public catalog is inquiry-only`);
      }
      if ((attribute(form[1], "onsubmit") ?? "").replace(/\s+/g, " ").trim() !== "return false") {
        report(file, `form ${index + 1} must block submit events while the public catalog is inquiry-only`);
      }
      if (/\bname\s*=\s*["']access_key["']/i.test(formBody)) {
        report(file, `form ${index + 1} exposes a provider access key field while submission is held`);
      }
      const fieldsets = fieldsetRanges(formBody);
      const barrierCandidates = fieldsets.filter((fieldset) =>
        attribute(fieldset.attributes, "data-no-entry-barrier") === "true"
      );
      const barrier = barrierCandidates.length === 1 ? barrierCandidates[0] : null;
      const hasNoEntryBarrier = barrier
        && barrier.depth === 0
        && hasAttribute(barrier.attributes, "disabled")
        && attribute(barrier.attributes, "aria-disabled") === "true";
      if (!hasNoEntryBarrier) {
        report(file, `form ${index + 1} must contain exactly one outer disabled data-no-entry-barrier fieldset`);
      }
      const controls = [...formBody.matchAll(/<(?:button|input|select|textarea)\b/gi)];
      if (!barrier || controls.some((control) =>
        control.index < barrier.contentStart || control.index >= barrier.closeStart
      )) {
        report(file, `form ${index + 1} has an interactive control outside its no-entry barrier`);
      }
      if (!formBody.includes("Do not enter any information in these fields.")) {
        report(file, `form ${index + 1} must explicitly tell visitors not to enter information`);
      }
      const submitControls = [
        ...formBody.matchAll(/<button\b([^>]*)>/gi),
        ...formBody.matchAll(/<input\b([^>]*)>/gi),
      ].map((match) => match[1]).filter((attrs) => {
        const type = (attribute(attrs, "type") ?? "submit").toLowerCase();
        return type === "submit";
      });
      if (submitControls.some((attrs) => !hasAttribute(attrs, "disabled"))) {
        report(file, `form ${index + 1} has an enabled submit control while the public catalog is inquiry-only`);
      }
    }
    if (file === "start/index.html" && attribute(form[1], "id") === "brief") {
      const expectedAttributes = {
        "data-commercial-catalog-id": publicCatalog.version,
        "data-tier-catalog-id": publicCatalog.tierCatalogId,
        "data-addon-catalog-id": publicCatalog.addonCatalogId,
        "data-care-catalog-id": publicCatalog.careCatalogId,
        "data-source-catalog-digest": publicCatalog.sourceCatalogDigest,
        "data-projection-digest": publicCatalog.projectionDigest,
      };
      for (const [name, expected] of Object.entries(expectedAttributes)) {
        if (attribute(form[1], name) !== expected) {
          report(file, `brief form must bind ${name}=${JSON.stringify(expected)}`);
        }
      }
      const hiddenInputs = [...formBody.matchAll(/<input\b([^>]*)>/gi)]
        .map((match) => match[1])
        .filter((attrs) => (attribute(attrs, "type") ?? "text").toLowerCase() === "hidden");
      const expectedInputs = {
        "Website commercial catalog ID": publicCatalog.version,
        "Website tier catalog ID": publicCatalog.tierCatalogId,
        "Website add-on catalog ID": publicCatalog.addonCatalogId,
        "Website Care catalog ID": publicCatalog.careCatalogId,
        "Website source catalog digest": publicCatalog.sourceCatalogDigest,
        "Website projection digest": publicCatalog.projectionDigest,
      };
      for (const [name, expected] of Object.entries(expectedInputs)) {
        const matches = hiddenInputs.filter((attrs) => attribute(attrs, "name") === name);
        if (matches.length !== 1 || attribute(matches[0] ?? "", "value") !== expected) {
          report(file, `brief form must submit exactly one ${JSON.stringify(name)} value bound to ${JSON.stringify(expected)}`);
        }
      }
    }
  }
}

for (const file of htmlFiles) {
  const html = htmlSources.get(file);
  const decodedHtml = decodeHtmlAttribute(html);
  if (decodedHtml.toLowerCase().includes(prohibitedLegacyMailbox)) {
    report(file, `prohibited legacy mailbox ${prohibitedLegacyMailbox} remains`);
  }
  if (mailboxSurfaces.has(file) && !decodedHtml.toLowerCase().includes(canonicalCustomerMailbox)) {
    report(file, `canonical customer mailbox ${canonicalCustomerMailbox} is missing`);
  }
  if (fullFooterSurfaces.has(file)) {
    const footer = /<footer\b[^>]*class\s*=\s*(?:"[^"]*\bfooter\b[^"]*"|'[^']*\bfooter\b[^']*')[^>]*>([\s\S]*?)<\/footer\s*>/iu.exec(decodedHtml)?.[1] ?? "";
    if (!footer) {
      report(file, "shared footer is missing");
    } else {
      if (!footer.includes(canonicalCustomerPhone.tel) || !footer.includes(canonicalCustomerPhone.display)) {
        report(file, `shared footer must include the canonical call route ${canonicalCustomerPhone.display}`);
      }
      if (!footer.toLowerCase().includes(`mailto:${canonicalCustomerMailbox}`)) {
        report(file, `shared footer must include the canonical mailbox ${canonicalCustomerMailbox}`);
      }
      if (!/href\s*=\s*(?:"\/start\/"|'\/start\/')/iu.test(footer)) {
        report(file, "shared footer must link to /start/");
      }
      if (!footer.includes("Site Sourcery is an alternate name of Desiderata Labs LLC")) {
        report(file, "shared footer must identify the filed alternate name and Desiderata Labs LLC");
      }
    }
  }
  for (const match of html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const href = decodeHtmlAttribute(match[1] ?? match[2]);
    if (!href.toLowerCase().startsWith("mailto:")) continue;
    const destination = href.slice("mailto:".length).split("?", 1)[0].toLowerCase();
    if (destination !== canonicalCustomerMailbox) {
      report(file, `mailto link must use canonical customer mailbox ${canonicalCustomerMailbox}; received ${destination}`);
    }
  }
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, "<script$1></script>")
    .replace(/<style\b([^>]*)>[\s\S]*?<\/style\s*>/gi, "<style$1></style>");
  const referencePattern = /\b(?:href|src|poster|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\u0060]+))/gi;
  for (const match of markup.matchAll(referencePattern)) checkReference(file, match[1] ?? match[2] ?? match[3]);
  const srcsetPattern = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const match of markup.matchAll(srcsetPattern)) {
    for (const part of (match[1] ?? match[2]).split(",")) checkReference(file, part.trim().split(/\s+/, 1)[0]);
  }
  for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) checkCssReferences(file, style[1]);
  let inlineNumber = 0;
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (attribute(script[1], "src")) continue;
    const type = (attribute(script[1], "type") ?? "text/javascript").toLowerCase();
    const source = script[2].trim();
    if (!source) continue;
    inlineNumber += 1;
    if (type === "application/ld+json") {
      try {
        const parsed = JSON.parse(source);
        counts.jsonLd += 1;
        if (deployableHtmlFileSet.has(file)) checkJsonLdContactValues(file, parsed);
      } catch (error) {
        report(file, `JSON-LD block ${inlineNumber} is invalid: ${error.message}`);
      }
    } else if (["text/javascript", "application/javascript", "module"].includes(type)) {
      if (type === "module" && /\b(?:import|export)\b/.test(source)) {
        report(file, `inline module ${inlineNumber} uses import/export, which this lightweight parser does not support`);
      } else checkJavaScript(file, source, `${file}:inline-script-${inlineNumber}`);
    }
  }
  checkForms(file, html);
  if (zeroEntryGuideSurfaces.has(file)) {
    if (/<(?:form|input|select|textarea)\b/iu.test(markup)) {
      report(file, "static inquiry guide must not contain a form or data-entry control");
    }
    if (/<button\b[^>]*\btype\s*=\s*(?:"submit"|'submit'|submit)(?:\s|>)/iu.test(markup)) {
      report(file, "static inquiry guide must not contain a submit control");
    }
    if (/\bcontenteditable\s*=/iu.test(markup)) {
      report(file, "static inquiry guide must not contain an editable region");
    }
    if (
      !html.includes('data-commercial-state="hold"')
      || !html.includes('data-no-entry="true"')
    ) {
      report(file, "static inquiry guide must preserve explicit HOLD and no-entry state");
    }
    if (!decodedHtml.includes(canonicalCustomerPhone.tel) || !decodedHtml.toLowerCase().includes(`mailto:${canonicalCustomerMailbox}`)) {
      report(file, "static inquiry guide must retain the direct canonical call and email routes");
    }
  }
}

for (const file of deployableHtmlFiles) {
  const html = decodeHtmlAttribute(htmlSources.get(file));
  if (/\bsms:/i.test(html)) {
    report(file, "deployable HTML must not publish an SMS route");
  }
  for (const match of html.matchAll(/\btel:[^"',\s<]+/gi)) {
    if (match[0].toLowerCase() !== canonicalCustomerPhone.tel) {
      report(file, `deployable HTML phone route must be ${canonicalCustomerPhone.tel}; received ${match[0]}`);
    }
  }
  for (const match of html.matchAll(publicPhonePatternGlobal)) {
    if (normalizedNorthAmericanPhone(match[0]) !== canonicalCustomerPhone.digits) {
      report(file, `deployable HTML contains a phone number other than the designated Google Voice number: ${match[0]}`);
    }
  }
  if (/New Jersey alternate-name registration is pending/i.test(html)) {
    report(file, "must not retain pending alternate-name wording after the filed certificate");
  }
  if (/(?:same business day|guaranteed response|always answers|answered immediately)/i.test(html)) {
    report(file, "deployable HTML contains an unsupported phone or response-time promise");
  }
  for (const staleClaim of [
    "register non-binding interest",
    "monthly care explanation",
    "monthly care note",
    "Everything here is work I actually built",
    "Everything here is work we actually built",
    "Everything shown here is work we actually built",
    "Every site we show as ours",
  ]) {
    if (html.includes(staleClaim)) report(file, `deployable HTML contains stale or universal proof wording ${JSON.stringify(staleClaim)}`);
  }
}

const automationHtml = htmlSources.get("automation.html") ?? "";
for (const marker of [
  ".invitation-actions .hive-call{min-width:0;flex-direction:column",
  "An unsupported question could follow an approved human handoff path",
]) {
  if (!automationHtml.includes(marker)) report("automation.html", `missing narrow-screen or pre-launch Hive safeguard ${JSON.stringify(marker)}`);
}
const hiveCellLinks = [...automationHtml.matchAll(/<a\b[^>]*class=["'][^"']*\bhive-cell\b[^"']*["'][^>]*>/giu)];
if (hiveCellLinks.length !== 6) {
  report("automation.html", `expected six progressively enhanced Hive cell links, found ${hiveCellLinks.length}`);
}
for (const link of hiveCellLinks) {
  if (/\b(?:role|tabindex|aria-selected|aria-controls)\s*=/iu.test(link[0])) {
    report("automation.html", "Hive cells must remain ordinary keyboard-reachable links until JavaScript upgrades the chamber");
  }
}
if (!/<nav\b[^>]*class=["'][^"']*\bhive-constellation\b[^"']*["'][^>]*aria-label=/iu.test(automationHtml)) {
  report("automation.html", "no-JavaScript Hive constellation must remain a labeled navigation region");
}
for (const marker of [
  "querySelectorAll('[data-cell]')",
  "tablist.setAttribute('role', 'tablist')",
  "tab.setAttribute('role', 'tab')",
  "panel.setAttribute('role', 'tabpanel')",
  "candidate.setAttribute('tabindex', active ? '0' : '-1')",
]) {
  if (!atelierCommerceJavaScript.includes(marker)) {
    report("atelier-commerce.js", `missing progressive Hive tab-upgrade marker ${JSON.stringify(marker)}`);
  }
}
const faqHtml = htmlSources.get("faq.html") ?? "";
if (!faqHtml.includes(".archive-query-line:focus-within")) {
  report("faq.html", "FAQ archive query must expose a visible focus-within state");
}
if (faqHtml.includes("capped 500-word units")) {
  report("faq.html", "FAQ structured data must not drift from the visible content-shaping answer");
}

const termsHtml = htmlSources.get("terms.html") ?? "";
const privacyHtml = htmlSources.get("privacy.html") ?? "";
const contactHtml = htmlSources.get("contact.html") ?? "";
if (!termsHtml.includes(filedNameLegend)) {
  report("terms.html", `missing exact filed-name/legal-seller legend ${JSON.stringify(filedNameLegend)}`);
}
if (!privacyHtml.includes(privacyControllerLegend)) {
  report("privacy.html", `missing exact filed-name/controller legend ${JSON.stringify(privacyControllerLegend)}`);
}
for (const [file, html] of [["terms.html", termsHtml], ["privacy.html", privacyHtml]]) {
  if (/(?:Site\s*Sourcery|SiteSourcery)\s+LLC/iu.test(html)) {
    report(file, "must not identify SiteSourcery as a standalone LLC");
  }
  if (/service brand operated by/iu.test(html)) {
    report(file, "must use the exact filed-name legend rather than the superseded service-brand wording");
  }
}
for (const marker of [
  "the exact accepted document chain: the released MSA, SOW/order, current manifest and scope digest, plus every applicable change and acceptance record",
  "this public site neither computes nor collects tax",
  "Website Care is currently unavailable.",
  "Care cannot inherit from a website build.",
  "Hive is separate pre-launch research/product scope.",
  "It is not Website Care, not a website add-on",
  "This public planning page does not promise a refund amount, deadline, or eligibility result.",
  "controlled by the exact accepted MSA/SOW/order/change chain",
]) {
  if (!termsHtml.includes(marker)) report("terms.html", `missing public-truth boundary ${JSON.stringify(marker)}`);
}
for (const forbidden of [
  "Cancel before work begins and we return the initial payment.",
  "A current Care month is not partly refunded.",
  "New Jersey alternate-name registration is pending",
]) {
  if (termsHtml.includes(forbidden)) report("terms.html", `forbidden superseded public promise ${JSON.stringify(forbidden)}`);
}
for (const marker of [
  "This notice is limited to the public Site Sourcery website and direct phone or email inquiries.",
  "Client-project data requires the exact accepted project data schedule",
  "Hive is separate pre-launch research/product scope",
  "remains outside Site Sourcery&rsquo;s current production and data-processing scope",
]) {
  if (!privacyHtml.includes(marker)) report("privacy.html", `missing privacy-scope boundary ${JSON.stringify(marker)}`);
}
for (const marker of [
  "The designated public call route is Google Voice.",
  "One designated call route and one designated email route",
  "This is the designated public Google Voice route",
  "no response time is promised.",
]) {
  if (!contactHtml.includes(marker)) report("contact.html", `missing designated-contact marker ${JSON.stringify(marker)}`);
}
if (/verified public (?:contact )?route/iu.test(contactHtml)) {
  report("contact.html", "must not overclaim the designated phone or mailbox as evidence-verified");
}

for (const file of cssFiles) checkCssReferences(file, await readFile(path.join(root, file), "utf8"));
for (const file of jsFiles) checkJavaScript(file, await readFile(path.join(root, file), "utf8"));

if (fileSet.has("sitemap.xml")) {
  const sitemap = await readFile(path.join(root, "sitemap.xml"), "utf8");
  for (const match of sitemap.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) checkReference("sitemap.xml", match[1]);
}

if (siteOrigin && fileSet.has("CNAME")) {
  const cname = (await readFile(path.join(root, "CNAME"), "utf8")).trim().toLowerCase();
  const expected = new URL(siteOrigin).hostname.toLowerCase();
  if (cname !== expected) report("CNAME", `expected ${expected}, found ${cname || "an empty file"}`);
}

if (Number.isInteger(quality.expectedForms) && counts.forms !== quality.expectedForms) {
  report("package.json", `expected ${quality.expectedForms} form(s), found ${counts.forms}`);
}

if (errors.length) {
  console.error(`Static quality checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Static quality checks passed: ${htmlFiles.length} HTML, ${counts.references} local references, ${counts.fragments} fragments, ${counts.scripts} JavaScript sources, ${counts.jsonLd} JSON-LD blocks, ${counts.forms} forms.`);
}
