import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { publicFileAllowlist } from "../build-pages.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const compilerPath = path.join(projectRoot, "abracadabra/app/abracadabra-compiler.js");
const appPath = path.join(projectRoot, "abracadabra/app/abracadabra-app.js");
const controlPath = path.join(projectRoot, "abracadabra/app/abracadabra-control.js");
const accountPath = path.join(projectRoot, "abracadabra/app/abracadabra-account.js");
const paidDownloadPath = path.join(
  projectRoot,
  "abracadabra/app/abracadabra-paid-download.js",
);
const htmlPath = path.join(projectRoot, "abracadabra/app/index.html");
const landingPath = path.join(projectRoot, "abracadabra/index.html");
const hostedControlFragmentPath = path.join(
  projectRoot,
  "scripts/hosted-truth/fragments/abracadabra-app-customer-control.html",
);
const hostedHeroFragmentPath = path.join(
  projectRoot,
  "scripts/hosted-truth/fragments/abracadabra-app-hero.html",
);
const hostedReadyFragmentPath = path.join(
  projectRoot,
  "scripts/hosted-truth/fragments/abracadabra-app-ready.js",
);
const hostedScriptsFragmentPath = path.join(
  projectRoot,
  "scripts/hosted-truth/fragments/abracadabra-app-scripts.html",
);
const hostedDomPath = path.join(
  projectRoot,
  "abracadabra/app/abracadabra-customer-control-dom.js",
);
const hostedCorePath = path.join(
  projectRoot,
  "abracadabra/app/abracadabra-hosted-control.js",
);
const [
  compilerSource,
  appSource,
  controlSource,
  accountSource,
  paidDownloadSource,
  pageHtml,
  landingHtml,
  hostedControlMarkup,
  hostedHeroMarkup,
  hostedReadySource,
  hostedScriptsMarkup,
  hostedDomSource,
  hostedCoreSource,
] = await Promise.all([
  readFile(compilerPath, "utf8"),
  readFile(appPath, "utf8"),
  readFile(controlPath, "utf8"),
  readFile(accountPath, "utf8"),
  readFile(paidDownloadPath, "utf8"),
  readFile(htmlPath, "utf8"),
  readFile(landingPath, "utf8"),
  readFile(hostedControlFragmentPath, "utf8"),
  readFile(hostedHeroFragmentPath, "utf8"),
  readFile(hostedReadyFragmentPath, "utf8"),
  readFile(hostedScriptsFragmentPath, "utf8"),
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

function policyProvenance(policyDigest = "a".repeat(64)) {
  return {
    schema: "abracadabra.spark-policy-provenance/v1",
    policySchema: "sitesourcery.alakazam-effective-policy/v1",
    policyDigest,
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
  assert.equal(
    compiler.PROVENANCE_SCHEMA,
    "abracadabra.spark-policy-provenance/v1",
  );
  assert.deepEqual(Array.from(compiler.THEME_IDS), ["clear", "warm", "arcane"]);
  assert.deepEqual(Array.from(compiler.ACTION_IDS), ["none", "phone", "email", "website"]);
  assert.equal(typeof compiler.compileSiteWithProvenance, "function");
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

test("explicit policy provenance is deterministic and changes version identity only on the policy-aware path", () => {
  const configured = valid({
    offerings: ["Inspection", "Repair"],
    accent: "ocean",
  });
  const ordinary = compiler.compileSite(configured);
  const base = compiler.compileSiteWithProvenance(
    configured,
    policyProvenance("a".repeat(64)),
  );
  const replay = compiler.compileSiteWithProvenance(
    configured,
    policyProvenance("a".repeat(64)),
  );
  const changedPolicy = compiler.compileSiteWithProvenance(
    configured,
    policyProvenance("b".repeat(64)),
  );

  assert.equal(base.html, replay.html);
  assert.equal(base.artifactDigest, replay.artifactDigest);
  assert.equal(base.provenanceDigest, replay.provenanceDigest);
  assert.equal(base.contentDigest, ordinary.contentDigest);
  assert.equal(base.normalizedDigest, ordinary.normalizedDigest);
  assert.notEqual(base.provenanceDigest, changedPolicy.provenanceDigest);
  assert.notEqual(base.artifactDigest, changedPolicy.artifactDigest);
  assert.notEqual(base.versionId, changedPolicy.versionId);
  assert.doesNotMatch(ordinary.html, /sitesourcery-policy-provenance/u);
  assert.match(
    base.html,
    new RegExp(
      `<meta name="sitesourcery-policy-provenance" content="${base.provenanceDigest}">`,
      "u",
    ),
  );
  assert.equal(Object.isFrozen(base.provenance), true);

  assert.throws(
    () => compiler.compileSiteWithProvenance(configured, {
      ...policyProvenance(),
      tierId: "alakazam_50",
    }),
    (error) => error?.name === "SparkProvenanceError",
  );
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

test("maker stays guest-first while account and payment authority remain hosted-only", () => {
  assert.match(
    pageHtml,
    /<section class="spark-workroom" id="workroom"[^>]*\stabindex="-1"[^>]*>/u,
    "the guest maker must be available without an account gate",
  );
  assert.doesNotMatch(
    pageHtml,
    /<section class="spark-workroom" id="workroom"[^>]*\shidden>/u,
  );
  assert.deepEqual(
    [...pageHtml.matchAll(/data-progress-step="([^"]+)"/gu)].map((match) => match[1]),
    ["vibe", "facts", "truth", "preview"],
  );
  assert.match(pageHtml, /abracadabra-app\.js/u);
  assert.doesNotMatch(pageHtml, /abracadabra-account\.js|abracadabra-paid-download\.js/u);
  assert.equal(
    publicFileAllowlist.includes("abracadabra/app/abracadabra-account.js"),
    false,
  );
  assert.equal(
    publicFileAllowlist.includes("abracadabra/app/abracadabra-paid-download.js"),
    false,
  );
  for (const legacySource of [accountSource, paidDownloadSource]) {
    assert.match(legacySource, /Archived browser-(?:account|download) prototype/u);
    assert.match(legacySource, /executableAuthority: false/u);
    assert.doesNotMatch(
      legacySource,
      /URLSearchParams|location\.search|localStorage|sessionStorage|abracadabra\.(?:paid|alakazam)|ss-(?:paid|live)|buy\.stripe\.com/u,
    );
  }
  assert.doesNotMatch(
    appSource,
    /bootEntitled|abracadabra\.paid|abracadabra\.alakazam|abracadabra:entitlements/u,
  );
  assert.match(
    pageHtml,
    /class="spark-extras is-locked" data-tier="paid" aria-disabled="true"[\s\S]*?data-extra-controls inert/u,
  );
  assert.match(
    pageHtml,
    /Saving and payment are unavailable here\.[\s\S]*?<button[^>]*disabled[^>]*aria-disabled="true">Account path unavailable<\/button>/u,
  );
  assert.doesNotMatch(pageHtml, /data-save-direction/u);
  assert.doesNotMatch(hostedScriptsMarkup, /abracadabra-account\.js|abracadabra-paid-download\.js/u);
  assert.match(hostedScriptsMarkup, /abracadabra-app\.js/u);
  assert.match(hostedControlMarkup, /<legend>Create your account<\/legend>/u);
  assert.match(hostedControlMarkup, /name="accountPassword"/u);
  assert.doesNotMatch(appSource, /function downloadCurrent\(|downloadButton\.addEventListener/u);
});

test("the Abracadabra lane has a plain HTML door into the maker", () => {
  assert.match(
    landingHtml,
    /<a class="vessel-link" href="\/abracadabra\/app\/#workroom"[^>]*><\/a>/u,
  );
  assert.match(landingHtml, /Click[\s\S]*to[\s\S]*Conjure/u);
  assert.match(landingHtml, /Free to See-\$5 Account Download-Alakazam Plans Held/u);
  assert.match(
    landingHtml,
    /Alakazam plans are in development\. Public subscriptions and hosting activation are held/u,
  );
  assert.doesNotMatch(
    landingHtml,
    /\$25|Keeps It Live|Live at your own address|comes off your first month|leaving costs nothing|class="kd-live"><i><\/i>Live<\/span>/iu,
  );
  assert.doesNotMatch(landingHtml, /<form\b/iu);
});

test("guest data-loss truth stays visible in both artifacts and hosted controls boot from complete markup", () => {
  assert.match(pageHtml, /Lives in this tab only — close it and it's gone\./u);
  assert.match(appSource, /Abracadabra ready\. Your local draft stays in this tab\./u);
  assert.match(
    hostedHeroMarkup,
    /<strong>Your guest preview is not saved yet\.<\/strong>[\s\S]*before saving it to your account and you will start over/u,
  );
  assert.match(hostedHeroMarkup, /Sign in for the \$5 Download\./u);
  assert.match(
    hostedHeroMarkup,
    /Alakazam subscriptions and hosting activation remain held\./u,
  );
  assert.doesNotMatch(
    hostedHeroMarkup,
    /Alakazam is the service that keeps it and puts it online|Your \$5 comes off Alakazam/u,
  );
  assert.match(
    hostedReadySource,
    /Guest work stays only in this tab until you save it to your account\./u,
  );
  assert.match(hostedReadySource, /bootStatus\.hidden = false/u);
  assert.match(hostedControlMarkup, /id="platform-status" role="status" aria-live="polite"/u);
  assert.match(hostedControlMarkup, /data-registration-availability role="status"/u);
  assert.match(hostedControlMarkup, /data-create-account disabled/u);
  assert.match(
    hostedDomSource,
    /windowRef[\s\S]{0,100}?\.matchMedia\([\s\S]{0,100}?"\(prefers-reduced-motion: reduce\)"[\s\S]{0,100}?\.matches/u,
  );
  assert.match(hostedDomSource, /workroom\.after\(controlRoom\)/u);
});

test("account recovery and support stay tied to Site Sourcery instead of an invented team", () => {
  assert.match(
    hostedControlMarkup,
    /Contact Site Sourcery for account recovery/u,
  );
  assert.doesNotMatch(
    `${hostedControlMarkup}\n${hostedDomSource}\n${hostedCoreSource}`,
    /our (?:team|staff)|contact the team|support team/iu,
  );
});

test("UI keeps the free maker local while legacy download evidence remains unshipped", () => {
  for (const marker of [
    "var versions = []",
    "currentVersionIndex",
    "renderHistory",
    "URL.createObjectURL",
    "URL.revokeObjectURL",
    "Previous version",
    "Open working preview",
  ]) {
    assert.ok(appSource.includes(marker) || pageHtml.includes(marker), marker);
  }
  assert.doesNotMatch(appSource, /function downloadCurrent\(|downloadButton\.addEventListener/u);
  assert.equal(publicFileAllowlist.includes("abracadabra/app/abracadabra-paid-download.js"), false);
  assert.doesNotMatch(
    `${accountSource}\n${paidDownloadSource}`,
    /createObjectURL|\.download\s*=|SiteSourceryAccount|classList\.(?:add|remove|toggle)/u,
  );
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
    /\b(?:localStorage|indexedDB|serviceWorker)\b/u,
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

test("the current hosted customer room keeps domains and publishing outside the $5 Download", () => {
  assert.match(hostedControlMarkup, /Need publishing or a domain too\?/u);
  assert.match(hostedControlMarkup, /Those are separate from the \$5 file Download\./u);
  assert.doesNotMatch(
    hostedControlMarkup,
    /data-domain-stage|data-domain-submit|data-publish|Register domain|Publish this version/iu,
  );
  assert.match(hostedDomSource, /domainPurchase: false/u);
  assert.match(hostedDomSource, /publishing: false/u);
});

test("hosted account, project, quote, and Download remain four ordered stages", () => {
  assert.deepEqual(
    [...hostedControlMarkup.matchAll(/data-customer-stage="([^"]+)"/gu)].map((match) => match[1]),
    ["account", "project", "quote", "download"],
  );
  assert.deepEqual(
    [...hostedControlMarkup.matchAll(/data-customer-progress="([^"]+)"/gu)].map((match) => match[1]),
    ["account", "project", "quote", "download"],
  );
  for (const stage of ["project", "quote", "download"]) {
    assert.match(
      hostedControlMarkup,
      new RegExp(`data-customer-stage="${stage}"[^>]*\\shidden>`, "u"),
    );
  }
  assert.match(hostedDomSource, /function setStage\(name\)/u);
  assert.match(hostedDomSource, /data-customer-progress/u);
  assert.match(hostedDomSource, /aria-current",\s*"step"/u);
  assert.doesNotMatch(
    hostedControlMarkup,
    /Internal lifecycle test|Test plan state|Test missed payment|Test suspension|Test deletion|data-internal-control/iu,
  );
  assert.doesNotMatch(pageHtml, /data-customer-stage|data-internal-control/u);
  assert.match(
    pageHtml,
    /<meta name="sitesourcery-abracadabra-control-mode" content="hold">/u,
  );
  assert.match(pageHtml, /abracadabra-control-mode\.js/u);
  assert.match(controlSource, /\{ held: true, localRehearsal: false \}/u);
  assert.doesNotMatch(controlSource, /\{ localRehearsal: true \}/u);
});

test("hosted Download requires the exact server quote and exposes no direct checkout URL", () => {
  for (const marker of [
    'text(quote.offerId) !== "spark_download"',
    "quote.project && quote.project.projectId",
    "quote.version && quote.version.versionId",
    "data-request-download-quote",
    "data-accept-download-quote",
    "data-continue-download-payment",
  ]) {
    assert.ok(hostedDomSource.includes(marker) || hostedControlMarkup.includes(marker), marker);
  }
  assert.doesNotMatch(
    `${hostedControlMarkup}\n${hostedDomSource}`,
    /https:\/\/buy\.stripe\.com\//u,
  );
});

test("held maker keeps canonical identity while pricing stays on account-aware surfaces", () => {
  assert.match(pageHtml, /tel:\+18562441220/u);
  assert.match(pageHtml, /\(856\) 244-1220/u);
  assert.match(pageHtml, /mailto:sitesourcery@proton\.me/u);
  assert.match(
    pageHtml,
    /Desiderata Labs LLC · DBA Site Sourcery/u,
  );
  for (const pattern of [
    /\bcoming soon\b/iu,
    /\bpre-?launch\b/iu,
    /\bwaitlist\b/iu,
    /\bsubscribe\b/iu,
    /"@type"\s*:\s*"Offer"/iu,
    /\b(?:buy now|order now|live in minutes)\b/iu,
  ]) {
    assert.doesNotMatch(pageHtml, pattern);
  }
  assert.deepEqual(
    [...new Set(
      (pageHtml.match(/\$\s*\d+(?:[.,]\d+)?/gu) ?? [])
        .map((amount) => Number(amount.replace(/[^\d.]/gu, ""))),
    )].sort((left, right) => left - right),
    [],
  );
  assert.match(
    landingHtml,
    /sign in to review the one-time \$5 Download quote/u,
  );
  assert.match(hostedControlMarkup, /<strong>\$5 once<\/strong>/u);
  assert.equal(
    pageHtml.split("https://buy.stripe.com/8x2cN7e9y0wu6OW4fO7kc00").length - 1,
    0,
  );
  assert.doesNotMatch(pageHtml, /https:\/\/buy\.stripe\.com\//u);
});
