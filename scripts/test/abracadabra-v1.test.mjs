import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const compilerPath = path.join(projectRoot, "abracadabra/app/abracadabra-compiler.js");
const appPath = path.join(projectRoot, "abracadabra/app/abracadabra-app.js");
const controlPath = path.join(projectRoot, "abracadabra/app/abracadabra-control.js");
const htmlPath = path.join(projectRoot, "abracadabra/app/index.html");
const [compilerSource, appSource, controlSource, pageHtml] = await Promise.all([
  readFile(compilerPath, "utf8"),
  readFile(appPath, "utf8"),
  readFile(controlPath, "utf8"),
  readFile(htmlPath, "utf8"),
]);

function loadCompiler() {
  const context = vm.createContext({
    module: { exports: {} },
    exports: {},
    URL,
  });
  new vm.Script(compilerSource, { filename: compilerPath }).runInContext(context);
  return context.module.exports;
}

function valid(overrides = {}) {
  return {
    theme: "clear",
    businessName: "Factual Workshop",
    summary: "Repairs supplied equipment for local workshops.",
    about: "Owner-operated and appointment based.",
    email: "owner@example.com",
    ...overrides,
  };
}

function errorFields(callback) {
  try {
    callback();
  } catch (error) {
    return Array.from(error.errors || [], (entry) => entry.field);
  }
  assert.fail("expected compiler validation to fail");
}

const compiler = loadCompiler();

test("compiler exposes one frozen Spark V1 contract", () => {
  assert.equal(compiler.SCHEMA, "abracadabra.spark/v1");
  assert.deepEqual(Array.from(compiler.THEME_IDS), ["clear", "warm", "arcane"]);
  assert.deepEqual(Array.from(compiler.ACTION_IDS), ["none", "phone", "email", "website"]);
  assert.equal(Object.isFrozen(compiler), true);
  assert.equal(Object.isFrozen(compiler.THEME_IDS), true);
});

test("pure JavaScript SHA-256 matches Node for ASCII and Unicode", () => {
  for (const value of ["", "abc", "Abracadabra", "café", "Arcane ✦", "𐐷", "\ud800", "\udc00"]) {
    const expected = createHash("sha256").update(value).digest("hex");
    assert.equal(compiler.sha256(value), expected, value);
  }
});

test("required facts and theme fail closed", () => {
  const fields = errorFields(() => compiler.compileSite({}));
  assert.deepEqual(
    [...new Set(fields)].sort(),
    ["businessName", "contact", "pageDetails", "summary", "theme"],
  );
  assert.ok(errorFields(() => compiler.compileSite(valid({ theme: "unknown" }))).includes("theme"));
});

test("a useful page requires supporting detail and a visitor next step", () => {
  const sparseFields = errorFields(() => compiler.compileSite({
    theme: "clear",
    businessName: "Sparse Workshop",
    summary: "Repairs supplied equipment.",
  }));
  assert.deepEqual([...new Set(sparseFields)].sort(), ["contact", "pageDetails"]);
  assert.ok(errorFields(() => compiler.compileSite(valid({
    about: "",
    offerings: "",
    location: "",
    hours: "",
  }))).includes("pageDetails"));
  assert.ok(errorFields(() => compiler.compileSite(valid({
    phone: "",
    email: "",
    website: "",
  }))).includes("contact"));
});

test("normalization is bounded, stable, and preserves only explicit facts", () => {
  const normalized = compiler.normalizeFacts(valid({
    businessName: "  Factual\u00a0Workshop  ",
    summary: " Repairs \r\n supplied equipment. ",
    about: "",
    offerings: "\nInspection\n\nRepair\n",
  }));
  assert.equal(normalized.businessName, "Factual Workshop");
  assert.equal(normalized.summary, "Repairs supplied equipment.");
  assert.equal(normalized.about, "");
  assert.deepEqual(Array.from(normalized.offerings), ["Inspection", "Repair"]);
  assert.equal(normalized.location, "");
  assert.equal(normalized.phone, null);
  assert.equal(Object.isFrozen(normalized), true);
});

test("length and offering cardinality boundaries fail closed", () => {
  assert.ok(errorFields(() => compiler.compileSite(valid({ businessName: "x".repeat(81) }))).includes("businessName"));
  assert.ok(errorFields(() => compiler.compileSite(valid({ summary: "x".repeat(181) }))).includes("summary"));
  assert.ok(errorFields(() => compiler.compileSite(valid({
    offerings: "one\ntwo\nthree\nfour\nfive\nsix\nseven",
  }))).includes("offerings"));
  assert.ok(errorFields(() => compiler.compileSite(valid({
    offerings: "x".repeat(101),
  }))).includes("offerings"));
});

test("the same normalized facts always create exact same bytes and identity", () => {
  const first = compiler.compileSite(valid({
    businessName: " Factual Workshop ",
    offerings: "Inspection\nRepair",
    email: "hello@example.com",
  }));
  const second = compiler.compileSite(valid({
    offerings: ["Inspection", "Repair"],
    email: "hello@example.com",
  }));
  assert.equal(first.html, second.html);
  assert.equal(first.normalizedDigest, second.normalizedDigest);
  assert.equal(first.artifactDigest, second.artifactDigest);
  assert.equal(first.versionId, second.versionId);
  assert.equal(first.artifactDigest, createHash("sha256").update(first.html).digest("hex"));
});

test("themes alter presentation but never facts or content identity", () => {
  const results = ["clear", "warm", "arcane"].map((theme) => compiler.compileSite(valid({
    theme,
    about: "One supplied paragraph.",
    offerings: "Inspection\nRepair",
  })));
  assert.equal(new Set(results.map((result) => result.contentDigest)).size, 1);
  assert.equal(new Set(results.map((result) => result.artifactDigest)).size, 3);
  for (const result of results) {
    assert.equal(result.facts.businessName, "Factual Workshop");
    assert.equal(result.facts.about, "One supplied paragraph.");
    assert.deepEqual(Array.from(result.facts.offerings), ["Inspection", "Repair"]);
  }
});

test("about copy preserves supplied paragraph breaks", () => {
  const result = compiler.compileSite(valid({
    about: "First supplied paragraph.\n\nSecond supplied paragraph.",
  }));
  assert.equal(result.facts.about, "First supplied paragraph.\n\nSecond supplied paragraph.");
  assert.match(
    result.html,
    /<p class="prose">First supplied paragraph\.<\/p><p class="prose">Second supplied paragraph\.<\/p>/u,
  );
});

test("long business names receive an adaptive title treatment", () => {
  const result = compiler.compileSite(valid({
    businessName: "A Very Long Supplied Business Name That Still Needs A Composed Website Heading",
  }));
  assert.match(result.html, /<h1 class="long-title">/u);
  assert.match(result.html, /overflow-wrap:anywhere/u);
});

test("unused optional fields create no empty or invented sections", () => {
  const result = compiler.compileSite(valid());
  assert.doesNotMatch(result.html, /<h2>What we do<\/h2>/u);
  assert.doesNotMatch(result.html, /<h2>Plan your visit or call<\/h2>/u);
  assert.doesNotMatch(result.html, /<section class="section offerings"/u);
  assert.doesNotMatch(result.html, /<section class="section practical"/u);
  for (const invented of ["licensed", "insured", "five-star", "award-winning", "guaranteed", "24/7"]) {
    assert.doesNotMatch(result.html, new RegExp(invented, "iu"));
  }
});

test("HTML, attribute, and closing-tag injection remains text", () => {
  const result = compiler.compileSite(valid({
    businessName: '</title><script id="attack">alert(1)</script>',
    summary: '" autofocus onfocus="alert(2)"><img src=x onerror=alert(3)>',
    about: "</style><style>body{display:none}</style>",
    offerings: "<svg onload=alert(4)>\n<a href=javascript:alert(5)>bad</a>",
    location: "<iframe srcdoc='<script>alert(6)</script>'>",
  }));
  assert.doesNotMatch(result.html, /<script\b|<img\b|<svg\b|<iframe\b|<style>body|<a href=javascript/iu);
  assert.match(result.html, /&lt;script/u);
  assert.match(result.html, /&lt;img/u);
  assert.match(result.html, /&lt;svg/u);
  assert.match(result.html, /&lt;iframe/u);
});

test("only ordinary contact and http/https link schemes compile", () => {
  const result = compiler.compileSite(valid({
    phone: "+1 (856) 555-0100",
    email: "owner@example.com",
    website: "example.com/path?q=one",
    primaryAction: "email",
  }));
  assert.equal(result.facts.phone.href, "tel:+18565550100");
  assert.equal(result.facts.email.href, "mailto:owner@example.com");
  assert.equal(result.facts.website.href, "https://example.com/path?q=one");
  assert.match(result.html, /href="tel:\+18565550100"/u);
  assert.match(result.html, /href="mailto:owner@example\.com"/u);
  assert.match(result.html, /href="https:\/\/example\.com\/path\?q=one"/u);
  assert.match(result.html, /class="action primary" href="mailto:owner@example\.com"/u);
  assert.ok(errorFields(() => compiler.compileSite(valid({ primaryAction: "phone" }))).includes("primaryAction"));

  for (const website of [
    "javascript:alert(1)",
    "data:text/html,<h1>bad</h1>",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "https://user:pass@example.com/",
  ]) {
    assert.ok(errorFields(() => compiler.compileSite(valid({ website }))).includes("website"), website);
  }
  assert.ok(errorFields(() => compiler.compileSite(valid({ phone: "CALL-NOW" }))).includes("phone"));
  assert.ok(errorFields(() => compiler.compileSite(valid({ email: "not-an-email" }))).includes("email"));
});

test("export is one self-contained inert HTML document", () => {
  const result = compiler.compileSite(valid({
    theme: "arcane",
    about: "A supplied description.",
    offerings: "One\nTwo",
    location: "South Jersey",
    hours: "By appointment",
    phone: "(856) 555-0100",
    email: "owner@example.com",
    website: "https://example.com/",
  }));
  assert.match(result.html, /^<!DOCTYPE html><html lang="en"/u);
  assert.doesNotMatch(result.html, /<meta name="robots" content="noindex">/u);
  assert.doesNotMatch(result.html, /<meta name="generator"/u);
  assert.match(result.html, /<style>[\s\S]+<\/style>/u);
  assert.match(result.html, /<a class="skip" href="#main">Skip to content<\/a>/u);
  assert.doesNotMatch(result.html, /<(?:form|input|textarea|select|button|script|img|video|audio|iframe|object|embed|link)\b/iu);
  assert.doesNotMatch(result.html, /\b(?:action|src|poster)\s*=/iu);
  assert.doesNotMatch(result.html, /@import|url\s*\(/iu);
  assert.doesNotMatch(result.html, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
  assert.doesNotMatch(result.html, /confirmed facts|private preview|not a hosted or published website/iu);
  assert.doesNotMatch(result.html, /data-(?:abracadabra-schema|content-digest)/u);
  assert.match(result.html, /target="_blank" rel="noopener noreferrer"/u);
  assert.match(result.html, /<footer class="footer"><div class="wrap"><strong>Factual Workshop<\/strong>/u);
});

test("compiler source has no DOM, side-effect, clock, random, or browser-storage capability", () => {
  for (const pattern of [
    /\b(?:document|window|navigator)\b/u,
    /\bfetch\s*\(/u,
    /\bXMLHttpRequest\b/u,
    /\bsendBeacon\s*\(/u,
    /\bWebSocket\s*\(/u,
    /\bEventSource\s*\(/u,
    /\b(?:localStorage|sessionStorage|indexedDB|serviceWorker)\b/u,
    /\bdocument\.cookie\b/u,
    /\b(?:Date\.now|new Date|Math\.random)\b/u,
  ]) {
    assert.doesNotMatch(compilerSource, pattern);
  }
});

test("application page has zero forms and fails closed before its local compiler boots", () => {
  assert.doesNotMatch(pageHtml, /<form\b/iu);
  assert.doesNotMatch(pageHtml, /\b(?:action|method)\s*=/iu);
  assert.doesNotMatch(pageHtml, /<button\b[^>]*\btype="submit"/iu);
  assert.doesNotMatch(pageHtml, /<input\b[^>]*\btype="file"/iu);
  assert.match(pageHtml, /id="spark-maker"[\s\S]*?\sinert/u);
  assert.match(pageHtml, /<iframe\b[^>]*id="spark-preview"[^>]*\ssandbox>/u);
  assert.doesNotMatch(pageHtml, /<iframe\b[^>]*sandbox="[^"]+"/u);
});

test("guest preview precedes account access and carries its reviewed version into the first project", () => {
  assert.match(
    pageHtml,
    /<section class="platform-control" id="control-room"[^>]*\shidden>/u,
    "the account control room must remain hidden until the visitor elects to save or sign in",
  );
  assert.match(
    pageHtml,
    /<section class="spark-workroom" id="workroom"[^>]*\stabindex="-1"[^>]*>/u,
    "the guest maker must be available without an account gate",
  );
  assert.match(
    pageHtml,
    /<section class="platform-project"[^>]*\bdata-active-project\b[^>]*\stabindex="-1"[^>]*>/u,
    "the revealed project region must accept programmatic focus after adoption",
  );
  assert.doesNotMatch(
    pageHtml,
    /<section class="spark-workroom" id="workroom"[^>]*\shidden>/u,
  );
  for (const marker of [
    "No account is required.",
    "data-save-direction",
    "data-open-account",
    "Save this direction and choose an address",
  ]) {
    assert.ok(pageHtml.includes(marker), marker);
  }
  for (const marker of [
    "pendingGuestCandidate",
    "if (!state.account || !state.project)",
    "acceptMadeVersion(state.pendingGuestCandidate)",
    "Project created and the reviewed guest preview was carried into it.",
    "workroom.after(controlRoom)",
    "window.matchMedia(\"(prefers-reduced-motion: reduce)\")",
    "focusAndScroll(one(\"[data-active-project]\"))",
  ]) {
    assert.ok(controlSource.includes(marker), marker);
  }
  assert.doesNotMatch(
    controlSource,
    /scrollIntoView\(\{\s*behavior:\s*"smooth"/u,
    "journey transitions must not force smooth scrolling when reduced motion is requested",
  );
});

test("UI implements memory-only history, undo, sandbox preview, and local download without egress or storage", () => {
  for (const marker of [
    "var versions = []",
    "currentVersionIndex",
    "renderHistory",
    "preview.srcdoc",
    "URL.createObjectURL",
    "URL.revokeObjectURL",
    "Previous version",
    "Download this HTML",
  ]) {
    assert.ok(appSource.includes(marker) || pageHtml.includes(marker), marker);
  }
  assert.match(
    appSource,
    /currentStep === "truth" && event\.target !== truthConfirmed/u,
    "checking the truth confirmation must not immediately clear itself",
  );
  assert.match(
    appSource,
    /reviewAttested:\s*reviewAttested === true/u,
    "the maker must carry the user’s reviewed-details confirmation into the version event",
  );
  assert.match(
    controlSource,
    /releaseAttestation:\s*detail\.reviewAttested === true/u,
    "the platform release screen must receive the user’s actual review act",
  );
  assert.doesNotMatch(
    controlSource,
    /releaseAttestation:\s*true/u,
    "the control must not manufacture the release confirmation",
  );
  const executable = `${compilerSource}\n${appSource}`;
  for (const pattern of [
    /\bfetch\s*\(/u,
    /\bXMLHttpRequest\b/u,
    /\bsendBeacon\s*\(/u,
    /\bWebSocket\s*\(/u,
    /\bEventSource\s*\(/u,
    /\b(?:localStorage|sessionStorage|indexedDB|serviceWorker)\b/u,
    /\bdocument\.cookie\b/u,
  ]) {
    assert.doesNotMatch(executable, pattern);
  }
});

test("the exact recognizable maker selection controls publication and rollback", () => {
  for (const marker of [
    "Selected for release",
    "Publish selected version",
    "Choose the exact accepted release to preview, download, or publish.",
    "selectPlatformVersion",
    "abracadabra:versionselected",
    "versionIdentity",
    "publishVersion(state.selectedVersionId)",
    "Roll back to Version ",
  ]) {
    assert.ok(appSource.includes(marker) || controlSource.includes(marker) || pageHtml.includes(marker), marker);
  }
  assert.match(
    controlSource,
    /var target = accepted\.find\(function \(version\) \{\s*return version\.id === versionId;/u,
    "publish must resolve only the explicitly selected accepted version",
  );
  assert.doesNotMatch(
    controlSource,
    /accepted\[accepted\.length - 1\][\s\S]{0,100}\.id/u,
    "the primary publication path must not silently fall back to the latest version",
  );
  assert.match(pageHtml, /role="tablist"[\s\S]*id="auth-create-tab"[\s\S]*role="tabpanel"/u);
  assert.match(controlSource, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/u);
  assert.doesNotMatch(pageHtml, /payment connection remains the last held rail/iu);
  assert.doesNotMatch(controlSource, /support ticket could not be opened/iu);
});

test("the local product disclaims multi-tab enforcement and captures delayed drafts to their origin project", () => {
  for (const marker of [
    "non-transactional local rehearsal",
    "Multi-tab writing is unsupported and not prevented",
    "not durable or authoritative hosted persistence",
  ]) {
    assert.match(pageHtml, new RegExp(marker, "u"), marker);
  }
  assert.match(controlSource, /var accountId = state\.account\.id;\s*var projectId = state\.project\.id;/u);
  assert.match(controlSource, /state\.draftTimers\[projectId\] = window\.setTimeout/u);
  assert.match(
    controlSource,
    /platform\.saveDraft\(\{\s*accountId: accountId,\s*projectId: projectId,/u,
  );
  assert.match(
    controlSource,
    /state\.account\.id === accountId[\s\S]*state\.project\.id === projectId/u,
  );
  assert.match(controlSource, /localRehearsalAcknowledged:\s*true/u);
  for (const source of [pageHtml, controlSource]) {
    assert.doesNotMatch(source, /supports one active writer|enforces one writer|cross-tab lock/iu);
  }
});

test("customer-domain proof creates a local owner handoff without claiming reviewer or provider effects", () => {
  for (const marker of [
    "Save domain-review handoff",
    "data-domain-review-status",
    "data-domain-review-receipt",
    "requestAddressVerification",
    "Domain-review handoff ",
    "No reviewer was contacted and the address remains pending.",
  ]) {
    assert.ok(pageHtml.includes(marker) || controlSource.includes(marker), marker);
  }
  assert.match(
    pageHtml,
    /no reviewer is contacted and no provider record changes/iu,
  );
  assert.doesNotMatch(
    pageHtml,
    /review is rehearsed locally/iu,
  );
  assert.match(
    controlSource,
    /platform\.requestAddressVerification\(\{[\s\S]*method:[\s\S]*reference:/u,
  );
});

test("public page keeps current contact and legal identity without placeholder or sales claims", () => {
  assert.match(pageHtml, /tel:\+18562441220/u);
  assert.match(pageHtml, /\(856\) 244-1220/u);
  assert.match(pageHtml, /mailto:sitesourcery@proton\.me/u);
  assert.match(
    pageHtml,
    /Site Sourcery is the brand presentation of the filed alternate name SITESOURCERY\. Desiderata Labs LLC is the legal seller\./u,
  );
  for (const pattern of [
    /\bcoming soon\b/iu,
    /\bpre-?launch\b/iu,
    /\bwaitlist\b/iu,
    /\bsubscribe\b/iu,
    /\$\s*\d/iu,
    /"@type"\s*:\s*"Offer"/iu,
    /\b(?:checkout|buy now|order now|live in minutes)\b/iu,
  ]) {
    assert.doesNotMatch(pageHtml, pattern);
  }
});
