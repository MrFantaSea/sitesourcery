#!/usr/bin/env node

/*
 * ARCHIVED SPARK V1 INSPECTOR — NOT A CURRENT RELEASE GATE
 *
 * Five source assumptions predate the account-aware current architecture.
 * Current $5/held authority is mutation-tested by the commerce and hosted
 * control suites. Use --historical-inspection only for old diagnostics.
 */

if (!process.argv.includes("--historical-inspection")) {
  console.error(
    "check-abracadabra-v1 is retired and is not a current release gate. "
    + "Run npm test, or pass --historical-inspection to inspect the obsolete contract.",
  );
  process.exit(2);
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const paths = Object.freeze({
  html: "abracadabra/app/index.html",
  compiler: "abracadabra/app/abracadabra-compiler.js",
  app: "abracadabra/app/abracadabra-app.js",
  css: "abracadabra/app/abracadabra-app.css",
});
const errors = [];

const sources = Object.fromEntries(await Promise.all(
  Object.entries(paths).map(async ([key, file]) => [
    key,
    await readFile(path.join(root, file), "utf8"),
  ]),
));

function check(condition, message) {
  if (!condition) errors.push(message);
}

function count(source, expression) {
  return [...source.matchAll(expression)].length;
}

function loadCompiler() {
  const context = vm.createContext({
    module: { exports: {} },
    exports: {},
    URL,
  });
  new vm.Script(sources.compiler, { filename: paths.compiler }).runInContext(context);
  return context.module.exports;
}

check(/<link\s+rel="stylesheet"\s+href="\/vnext\.css">/u.test(sources.html), "app page must use /vnext.css");
check(/<link\s+rel="stylesheet"\s+href="\/abracadabra\/app\/abracadabra-app\.css">/u.test(sources.html), "app page must use its owned CSS");
check(sources.html.includes('src="/abracadabra/app/abracadabra-compiler.js"'), "compiler script is missing");
check(sources.html.includes('src="/abracadabra/app/abracadabra-app.js"'), "app script is missing");
check(/<iframe\b[^>]*\bid="spark-preview"[^>]*\bsandbox(?:\s|>)/u.test(sources.html), "preview iframe must have an empty sandbox");
check(!/<iframe\b[^>]*\bsandbox="[^"]+"/u.test(sources.html), "preview iframe sandbox must grant no capabilities");
check(!/<form\b/iu.test(sources.html), "app page must contain zero form elements");
check(!/\b(?:action|method)\s*=/iu.test(sources.html), "app page must contain no form action or method");
check(!/<button\b[^>]*\btype="submit"/iu.test(sources.html), "app page must contain no submit button");
check(!/<input\b[^>]*\btype="file"/iu.test(sources.html), "app page must contain no upload control");
check(sources.html.includes('id="spark-maker"') && sources.html.includes(" inert"), "maker must fail closed as inert until JavaScript boots");
check(sources.html.includes("(856) 244-1220") && sources.html.includes("tel:+18562441220"), "canonical phone is missing");
check(sources.html.includes("sitesourcery@proton.me") && sources.html.includes("mailto:sitesourcery@proton.me"), "canonical email is missing");
check(
  sources.html.includes("Site Sourcery is the brand presentation of the filed alternate name SITESOURCERY. Desiderata Labs LLC is the legal seller."),
  "exact legal-seller legend is missing",
);
check(count(sources.html, /<h1\b/giu) === 1, "app page must contain exactly one h1");

for (const [pattern, label] of [
  [/\bcoming soon\b/iu, "coming-soon copy"],
  [/\bpre-?launch\b/iu, "pre-launch copy"],
  [/\bwaitlist\b/iu, "waitlist copy"],
  [/\bsubscribe\b/iu, "subscription copy"],
  [/"@type"\s*:\s*"Offer"/iu, "Offer structured data"],
  [/\b(?:checkout|buy now|order now|live in minutes)\b/iu, "purchase or instant-publication claim"],
]) {
  check(!pattern.test(sources.html), `app page contains ${label}`);
}
const publicAmounts = sources.html.match(/\$\s*\d+(?:[.,]\d+)?/gu) || [];
check(
  publicAmounts.length === 1 && publicAmounts[0].replace(/\s+/gu, "") === "$5",
  "app page must contain only the accepted one-time $5 Download amount",
);

const executableSources = `${sources.compiler}\n${sources.app}`;
for (const [pattern, label] of [
  [/\bfetch\s*\(/u, "fetch"],
  [/\bXMLHttpRequest\b/u, "XMLHttpRequest"],
  [/\bsendBeacon\s*\(/u, "sendBeacon"],
  [/\bWebSocket\s*\(/u, "WebSocket"],
  [/\bEventSource\s*\(/u, "EventSource"],
  [/\bserviceWorker\b/u, "service worker"],
  [/\blocalStorage\b/u, "localStorage"],
  [/\bsessionStorage\b/u, "sessionStorage"],
  [/\bindexedDB\b/u, "IndexedDB"],
  [/\bdocument\.cookie\b/u, "cookies"],
  [/\bcaches\.(?:open|match|put|delete)\b/u, "Cache Storage"],
]) {
  check(!pattern.test(executableSources), `executable source contains forbidden ${label} capability`);
}
check(!/\b(?:Date\.now|new Date|Math\.random)\b/u.test(sources.compiler), "compiler identity must not depend on clock or randomness");
check(!/\b(?:document|window|navigator)\b/u.test(sources.compiler), "compiler must remain isolated from browser globals");
for (const marker of [
  "AbracadabraCompiler",
  "normalizeFacts",
  "compileSite",
  "stableStringify",
  "sha256",
  "SparkValidationError",
]) {
  check(sources.compiler.includes(marker), `compiler API marker ${marker} is missing`);
}
for (const marker of [
  "versions",
  "currentVersionIndex",
  "renderCurrentVersion",
  "Previous version",
  "URL.createObjectURL",
  "URL.revokeObjectURL",
  "preview.srcdoc",
]) {
  check(executableSources.includes(marker) || sources.html.includes(marker), `working-flow marker ${marker} is missing`);
}

try {
  const compiler = loadCompiler();
  assert.equal(compiler.SCHEMA, "abracadabra.spark/v1");
  assert.deepEqual(Array.from(compiler.THEME_IDS), ["clear", "warm", "arcane"]);
  assert.deepEqual(Array.from(compiler.ACTION_IDS), ["none", "phone", "email", "website"]);
  assert.equal(compiler.sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  const base = {
    theme: "clear",
    businessName: "South Jersey Repair",
    summary: "Repairs supplied equipment for local workshops.",
    about: "Owner-operated and appointment based.",
    offerings: "Inspection\nRepair\nMaintenance",
    location: "Camden County, New Jersey",
    hours: "Monday–Friday, 9–5",
    phone: "(856) 555-0100",
    email: "hello@example.com",
    website: "example.com/services",
  };
  const first = compiler.compileSite(base);
  const second = compiler.compileSite({ ...base });
  assert.equal(first.html, second.html);
  assert.equal(first.artifactDigest, second.artifactDigest);
  assert.equal(first.versionId, second.versionId);
  assert.equal(first.artifactDigest, compiler.sha256(first.html));
  assert.doesNotMatch(first.html, /<meta name="robots" content="noindex">/u);
  assert.doesNotMatch(first.html, /<meta name="generator"/u);
  assert.doesNotMatch(first.html, /<(?:form|input|textarea|select|button|script)\b/iu);
  assert.doesNotMatch(first.html, /<(?:img|video|audio|iframe|object|embed|link)\b/iu);
  assert.doesNotMatch(first.html, /@import|url\s*\(/iu);
  assert.doesNotMatch(first.html, /\b(?:action|src|poster)\s*=/iu);
  assert.doesNotMatch(first.html, /confirmed facts|private preview|not a hosted or published website/iu);
  assert.match(first.html, /<footer class="footer"><div class="wrap"><strong>South Jersey Repair<\/strong>/u);

  const themeResults = compiler.THEME_IDS.map((theme) => compiler.compileSite({ ...base, theme }));
  assert.equal(new Set(themeResults.map((result) => result.contentDigest)).size, 1);
  assert.equal(new Set(themeResults.map((result) => result.artifactDigest)).size, 3);
  assert.equal(new Set(themeResults.map((result) => result.html)).size, 3);

  assert.throws(
    () => compiler.compileSite({
      theme: "warm",
      businessName: "Plain Facts",
      summary: "One supplied sentence.",
    }),
    (error) => {
      const fields = new Set((error.errors || []).map((entry) => entry.field));
      return fields.has("pageDetails") && fields.has("contact");
    },
  );

  const attack = compiler.compileSite({
    theme: "arcane",
    businessName: '</title><script id="owned">alert(1)</script>',
    summary: '" onmouseover="alert(2)"><img src=x onerror=alert(3)>',
    about: "<style>body{display:none}</style>",
    offerings: "<svg onload=alert(4)>",
    email: "safe@example.com",
  });
  assert.doesNotMatch(attack.html, /<script\b|<img\b|<svg\b|<style>body/iu);
  assert.match(attack.html, /&lt;script/u);
  assert.match(attack.html, /&lt;img/u);

  for (const website of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "https://user:pass@example.com/",
  ]) {
    assert.throws(
      () => compiler.compileSite({
        theme: "clear",
        businessName: "Unsafe Link Test",
        summary: "Only safe links should compile.",
        website,
      }),
      (error) => Array.isArray(error.errors) && error.errors.some((entry) => entry.field === "website"),
    );
  }
} catch (error) {
  errors.push(`compiler behavior check failed: ${error.stack || error.message}`);
}

if (errors.length) {
  console.error(`Abracadabra Spark V1 checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Abracadabra Spark V1 checks passed: zero forms/network/storage/uploads; deterministic fact-only compiler, three themes, sandboxed free preview, in-session history, and accepted $5 Download boundary verified.");
}
