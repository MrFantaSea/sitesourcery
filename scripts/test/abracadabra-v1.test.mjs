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
const landingPath = path.join(projectRoot, "abracadabra/index.html");
const howPath = path.join(projectRoot, "abracadabra/how/index.html");
const showcasePath = path.join(projectRoot, "abracadabra/abracadabra-showcase.js");
const hostedControlFragmentPath = path.join(
  projectRoot,
  "scripts/hosted-truth/fragments/abracadabra-app-control.html",
);
const hostedHeroFragmentPath = path.join(
  projectRoot,
  "scripts/hosted-truth/fragments/abracadabra-app-hero.html",
);
const hostedHowFragmentPath = path.join(
  projectRoot,
  "scripts/hosted-truth/fragments/abracadabra-how-main.html",
);
const hostedLandingFragmentPath = path.join(
  projectRoot,
  "scripts/hosted-truth/fragments/abracadabra-landing-main.html",
);
const hostedReadyFragmentPath = path.join(
  projectRoot,
  "scripts/hosted-truth/fragments/abracadabra-app-ready.js",
);
const hostedDomPath = path.join(
  projectRoot,
  "abracadabra/app/abracadabra-hosted-control-dom.js",
);
const hostedCorePath = path.join(
  projectRoot,
  "abracadabra/app/abracadabra-hosted-control.js",
);
const [
  compilerSource,
  appSource,
  controlSource,
  pageHtml,
  landingHtml,
  howHtml,
  showcaseSource,
  hostedControlMarkup,
  hostedHeroMarkup,
  hostedHowMarkup,
  hostedLandingMarkup,
  hostedReadySource,
  hostedDomSource,
  hostedCoreSource,
] = await Promise.all([
  readFile(compilerPath, "utf8"),
  readFile(appPath, "utf8"),
  readFile(controlPath, "utf8"),
  readFile(htmlPath, "utf8"),
  readFile(landingPath, "utf8"),
  readFile(howPath, "utf8"),
  readFile(showcasePath, "utf8"),
  readFile(hostedControlFragmentPath, "utf8"),
  readFile(hostedHeroFragmentPath, "utf8"),
  readFile(hostedHowFragmentPath, "utf8"),
  readFile(hostedLandingFragmentPath, "utf8"),
  readFile(hostedReadyFragmentPath, "utf8"),
  readFile(hostedDomPath, "utf8"),
  readFile(hostedCorePath, "utf8"),
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

test("held maker stays account-free while hosted adoption code can carry a reviewed version", () => {
  assert.doesNotMatch(
    pageHtml,
    /class="platform-control"|data-open-account|data-save-direction|Save and continue/u,
    "the held maker must not expose hosted account or save controls",
  );
  assert.match(
    pageHtml,
    /<section class="spark-workroom" id="workroom"[^>]*\stabindex="-1"[^>]*>/u,
    "the guest maker must be available without an account gate",
  );
  assert.doesNotMatch(
    pageHtml,
    /<section class="spark-workroom" id="workroom"[^>]*\shidden>/u,
  );
  for (const marker of [
    "Your free preview stays in this tab.",
    "Refresh or close the tab and you will start over.",
    "No account is required to build and test the first version.",
    "Download is $5 once for this editor project.",
  ]) {
    assert.ok(pageHtml.includes(marker), marker);
  }
  assert.doesNotMatch(pageHtml, /id="download-version"|Download this HTML/u);
  assert.doesNotMatch(appSource, /function downloadCurrent\(|downloadButton\.addEventListener/u);
  assert.match(pageHtml, /abracadabra-control-mode\.js/u);
  assert.doesNotMatch(
    pageHtml,
    /abracadabra-control\.js|abracadabra-platform\.js/u,
  );
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

test("the shared held-and-hosted landing keeps a truthful generated-example fallback without JavaScript", () => {
  const fallbackCopy =
    "Static fictional preview shown. JavaScript opens the generated example.";
  const noScriptCopy =
    "The static fictional previews below are placeholders. Turn JavaScript on to open the generated examples or use the page maker.";
  for (const source of [landingHtml]) {
    assert.equal(source.split(fallbackCopy).length - 1, 4);
    assert.equal(source.split(noScriptCopy).length - 1, 1);
    assert.match(source, /<noscript>[\s\S]*class="site-shell abracadabra-noscript"/u);
    assert.match(source, /href="#plans">Compare what happens next/u);
    assert.match(source, /Six short steps/u);
    assert.doesNotMatch(source, />Opening (?:the example|Clear|Warm|Arcane)…</u);
  }
  assert.match(showcaseSource, /data-showcase-state", "loading"/u);
  assert.equal(showcaseSource.split('data-showcase-state", "failed"').length - 1, 2);
  assert.match(showcaseSource, /data-showcase-state", "ready"/u);
  assert.equal(
    showcaseSource.split(
      "The generated example did not open. Reload this page to try again.",
    ).length - 1,
    2,
  );
});

test("guest data-loss truth stays visible in both artifacts and hosted controls boot from complete markup", () => {
  assert.match(pageHtml, /<strong>Your free preview stays in this tab\.<\/strong>/u);
  assert.match(
    hostedHeroMarkup,
    /<strong>Your guest preview is not saved yet\.<\/strong>[\s\S]*before saving it to your account and you will start over/u,
  );
  assert.match(
    hostedReadySource,
    /Guest work stays only in this tab until you save it to your account\./u,
  );
  assert.match(hostedReadySource, /bootStatus\.hidden = false/u);
  assert.match(hostedControlMarkup, /data-billing-copy role="status" aria-live="polite"/u);
  assert.match(hostedDomSource, /one\("\[data-billing-copy\]"\)\.textContent/u);
  assert.doesNotMatch(hostedDomSource, /one\("\[data-billing-copy\]"\)\?\.textContent/u);
  assert.match(hostedDomSource, /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/u);
  assert.match(hostedDomSource, /firstField\.focus\(\{ preventScroll: true \}\)/u);
});

test("Abracadabra speaks as one operator instead of an invented team", () => {
  assert.match(howHtml, /tell Zack which device and browser you used/u);
  assert.match(hostedHowMarkup, /tell Zack which device and browser you used/u);
  for (const source of [
    hostedControlMarkup,
    hostedDomSource,
    hostedCoreSource,
    hostedHowMarkup,
  ]) {
    assert.doesNotMatch(source, /\b(?:we|us|our)\b|we[’'](?:ll|re)/iu);
  }
});

test("UI implements memory-only history, undo, and sandbox preview without a free Download path", () => {
  for (const marker of [
    "var versions = []",
    "currentVersionIndex",
    "renderHistory",
    "preview.srcdoc",
    "URL.createObjectURL",
    "URL.revokeObjectURL",
    "Previous version",
    "Open working preview",
  ]) {
    assert.ok(appSource.includes(marker) || pageHtml.includes(marker), marker);
  }
  assert.doesNotMatch(pageHtml, /id="download-version"|Download this HTML/u);
  assert.doesNotMatch(appSource, /function downloadCurrent\(|downloadButton\.addEventListener/u);
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

test("the hosted control keeps recognizable version selection for publication and rollback", () => {
  for (const marker of [
    "Selected for release",
    "Publish this version",
    "Return to any version you approved.",
    "selectPlatformVersion",
    "abracadabra:versionselected",
    "versionIdentity",
    "publishVersion(versionId, context)",
    "Roll back to Version ",
  ]) {
    assert.ok(
      appSource.includes(marker)
        || controlSource.includes(marker)
        || hostedControlMarkup.includes(marker)
        || pageHtml.includes(marker),
      marker,
    );
  }
  assert.match(
    controlSource,
    /var target = accepted\.find\(function \(version\) \{\s*return version\.id === versionId;/u,
    "publish must resolve only the explicitly selected accepted version",
  );
  assert.match(
    controlSource,
    /var versionId = state\.selectedVersionId;\s*publishVersion\(versionId, context\);/u,
    "publish must capture the recognizable maker selection with its project context",
  );
  assert.doesNotMatch(
    controlSource,
    /accepted\[accepted\.length - 1\][\s\S]{0,100}\.id/u,
    "the primary publication path must not silently fall back to the latest version",
  );
  assert.match(
    hostedControlMarkup,
    /role="tablist"[\s\S]*id="auth-create-tab"[\s\S]*role="tabpanel"/u,
  );
  assert.doesNotMatch(pageHtml, /role="tablist"|id="auth-create-tab"/u);
  assert.match(controlSource, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/u);
  assert.doesNotMatch(pageHtml, /payment connection remains the last held rail/iu);
  assert.doesNotMatch(controlSource, /support ticket could not be opened/iu);
});

test("the local test adapter stays isolated and captures delayed drafts to their origin project", () => {
  assert.doesNotMatch(
    pageHtml,
    /non-transactional|authoritative hosted persistence|Multi-tab writing is unsupported/iu,
  );
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
    "Send proof for review",
    "Ownership must be verified before this domain is connected.",
    "data-domain-review-status",
    "data-domain-review-receipt",
    "requestAddressVerification",
    "Domain-review handoff ",
    "No reviewer was contacted and the address remains pending.",
  ]) {
    assert.ok(hostedControlMarkup.includes(marker) || controlSource.includes(marker), marker);
  }
  assert.doesNotMatch(hostedControlMarkup, /no reviewer is contacted and no provider record changes/iu);
  assert.doesNotMatch(
    hostedControlMarkup,
    /review is rehearsed locally/iu,
  );
  assert.doesNotMatch(pageHtml, /data-domain-review-status|Send proof for review/u);
  assert.match(
    controlSource,
    /platform\.requestAddressVerification\(\{[\s\S]*method:[\s\S]*reference:/u,
  );
});

test("project setup unlocks three small accessible steps and keeps internal lifecycle controls out of the customer flow", () => {
  assert.deepEqual(
    [...hostedControlMarkup.matchAll(/data-project-create-step="(\d)"/gu)].map((match) => match[1]),
    ["1", "2", "3"],
  );
  for (const step of ["2", "3"]) {
    assert.match(
      hostedControlMarkup,
      new RegExp(`data-project-create-step="${step}"[^>]*\\shidden\\sinert>`, "u"),
    );
  }
  for (const marker of [
    "Finish one short step to open the next.",
    "data-project-step-next=\"2\"",
    "data-project-step-next=\"3\"",
    "data-project-step-back=\"1\"",
    "data-project-step-back=\"2\"",
    "data-project-step-status",
  ]) {
    assert.ok(hostedControlMarkup.includes(marker), marker);
  }
  for (const marker of [
    "projectStepError",
    "validAddressLabel",
    "validDomain",
    "data-abracadabra-progressive-ready",
    "aria-current\", \"step",
  ]) {
    assert.ok(controlSource.includes(marker), marker);
  }
  assert.doesNotMatch(
    hostedControlMarkup,
    /Internal lifecycle test|Test plan state|Test missed payment|Test suspension|Test deletion|data-internal-control/iu,
  );
  assert.doesNotMatch(pageHtml, /data-project-create-step|data-internal-control/u);
  assert.match(
    pageHtml,
    /<meta name="sitesourcery-abracadabra-control-mode" content="hold">/u,
  );
  assert.match(pageHtml, /abracadabra-control-mode\.js/u);
  assert.match(controlSource, /\{ held: true, localRehearsal: false \}/u);
  assert.doesNotMatch(controlSource, /\{ localRehearsal: true \}/u);
});

test("hosted domain purchase reveals only the next of four steps and blocks duplicate payment starts", async () => {
  const hostedDom = await readFile(
    new URL("../../abracadabra/app/abracadabra-hosted-control-dom.js", import.meta.url),
    "utf8",
  );
  for (const step of ["1", "2", "3", "4"]) {
    assert.match(hostedDom, new RegExp(`"data-domain-stage": "${step}"`, "u"));
  }
  for (const marker of [
    "Buy a domain without leaving Site Sourcery.",
    "You are the owner.",
    "Finish one step to open the next.",
    "Payment is authorized first.",
    "The name, price, and owner are checked again before the registration is submitted.",
    "paymentButton.disabled = !consentReady || !state.project || orderReady",
  ]) {
    assert.ok(hostedDom.includes(marker), marker);
  }
  assert.match(
    hostedDom,
    /stage\.hidden = !active;[\s\S]*stage\.setAttribute\("inert", ""\)/u,
  );
});

test("public page keeps current contact, legal identity, and only the accepted $5 amount", () => {
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
    /"@type"\s*:\s*"Offer"/iu,
    /\b(?:checkout|buy now|order now|live in minutes)\b/iu,
  ]) {
    assert.doesNotMatch(pageHtml, pattern);
  }
  assert.deepEqual(pageHtml.match(/\$\s*\d+(?:[.,]\d+)?/gu), ["$5"]);
});
