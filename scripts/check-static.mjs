import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const ignoredDirectories = new Set([".git", "_site", "node_modules"]);
const errors = [];
const counts = { references: 0, fragments: 0, scripts: 0, jsonLd: 0, forms: 0 };

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const publicCatalog = JSON.parse(await readFile(path.join(root, "data/public-catalog.json"), "utf8"));
const releaseControl = JSON.parse(await readFile(path.join(root, "data/release-control.json"), "utf8"));
const pagesWorkflow = await readFile(path.join(root, ".github/workflows/pages.yml"), "utf8");
const containmentWorkflow = await readFile(path.join(root, ".github/workflows/containment.yml"), "utf8");
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
const cssFiles = files.filter((file) => file.endsWith(".css"));
const jsFiles = files.filter((file) => file.endsWith(".js"));
const htmlSources = new Map();

for (const file of htmlFiles) htmlSources.set(file, await readFile(path.join(root, file), "utf8"));

function report(file, message) {
  errors.push(`${file}: ${message}`);
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
if (typeof releaseControl.allowsContainmentDeployment !== "boolean") {
  report("data/release-control.json", "containment deployment authority must be an explicit boolean");
}
for (const marker of [
  "run: npm test",
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

function decodeHtmlAttribute(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#(?:x0*23|0*35);/gi, "#")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'");
}

function attribute(attributes, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\u0060]+))`, "i").exec(attributes);
  return match ? decodeHtmlAttribute(match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function hasAttribute(attributes, name) {
  return new RegExp(`(?:^|\\s)${name}(?:\\s|=|$)`, "i").test(attributes);
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
      if ((attribute(form[1], "onsubmit") ?? "").replace(/\s+/g, " ").trim() !== "return false") {
        report(file, `form ${index + 1} must block submit events while the public catalog is inquiry-only`);
      }
      if (/\bname\s*=\s*["']access_key["']/i.test(form[2])) {
        report(file, `form ${index + 1} exposes a provider access key field while submission is held`);
      }
      const submitControls = [
        ...form[2].matchAll(/<button\b([^>]*)>/gi),
        ...form[2].matchAll(/<input\b([^>]*)>/gi),
      ].map((match) => match[1]).filter((attrs) => {
        const type = (attribute(attrs, "type") ?? "submit").toLowerCase();
        return type === "submit";
      });
      if (submitControls.some((attrs) => !hasAttribute(attrs, "disabled"))) {
        report(file, `form ${index + 1} has an enabled submit control while the public catalog is inquiry-only`);
      }
    }
  }
}

for (const file of htmlFiles) {
  const html = htmlSources.get(file);
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
        JSON.parse(source);
        counts.jsonLd += 1;
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
