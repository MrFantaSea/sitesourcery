import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  LEGAL_COPY_ROUTES,
  analyzeLegalCopySource,
  inspectLegalCopy,
  validateLegalCopyAnalysis,
} from "../check-legal-copy.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(TEST_DIRECTORY, "../..");

async function routeErrors(route, mutate) {
  const routeConfig = LEGAL_COPY_ROUTES.find((entry) => entry.route === route);
  assert.ok(routeConfig, `Missing legal-copy route config for ${route}`);
  const source = await readFile(path.join(SITE_ROOT, routeConfig.file), "utf8");
  const changed = mutate(source);
  const analysis = analyzeLegalCopySource(routeConfig.file, changed, routeConfig);
  return validateLegalCopyAnalysis(analysis, routeConfig);
}

test("all legal routes preserve their clauses, links, summaries, and disclosure structure", async () => {
  const result = await inspectLegalCopy(SITE_ROOT);
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("legal-copy gate rejects a changed substantive clause", async () => {
  const errors = await routeErrors("/legal/privacy/", (source) =>
    source.replace(
      "Desiderata Labs LLC operates this website",
      "Desiderata Labs LLC runs this website",
    ));
  assert.match(errors.join("\n"), /substantive clause operator changed/u);
});

test("legal-copy gate rejects a missing required legal link", async () => {
  const errors = await routeErrors("/legal/", (source) =>
    source.replace('href="/legal/privacy/"', 'href="/privacy/"'));
  assert.match(errors.join("\n"), /main legal links changed/u);
});

test("legal-copy gate rejects an overlong plain-language summary", async () => {
  const longSummary = "This sentence keeps adding plain words until the short summary is much too long for a person who only wants to scan this page and find the right legal topic without reading every full clause first.";
  const errors = await routeErrors("/legal/website-terms/", (source) =>
    source.replace(
      /(<p class="legal-topic-summary" data-legal-summary="acceptance">)[\s\S]*?(<\/p>)/u,
      `$1${longSummary}$2`,
    ));
  assert.match(errors.join("\n"), /summary acceptance is \d+ words/u);
});

test("legal-copy gate keeps stable section IDs on visible h2 headings", async () => {
  const errors = await routeErrors("/legal/privacy/", (source) =>
    source.replace('<h2 id="operator">', '<h2 id="operator-changed">'));
  assert.match(errors.join("\n"), /stable legal section IDs must remain on h2 headings in order/u);
});

test("legal-copy gate rejects focus-changing disclosure attributes", async () => {
  const errors = await routeErrors("/legal/privacy/", (source) =>
    source.replace("<summary>Read full operator details</summary>", '<summary tabindex="-1">Read full operator details</summary>'));
  assert.match(errors.join("\n"), /contains focus-changing attributes/u);
});

test("legal-copy gate rejects nested interactive controls in a summary", async () => {
  const errors = await routeErrors("/legal/privacy/", (source) =>
    source.replace(
      "<summary>Read full operator details</summary>",
      "<summary>Read <button type=\"button\">full operator details</button></summary>",
    ));
  assert.match(errors.join("\n"), /nests an interactive control in summary/u);
});
