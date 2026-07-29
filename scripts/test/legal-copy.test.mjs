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

test("held legal makes the operative layer and contact recourse visible by default", async () => {
  const result = await inspectLegalCopy(SITE_ROOT, { reportOnly: true });
  const privacy = result.analyses.find(({ route }) => route === "/legal/privacy/");
  const terms = result.analyses.find(({ route }) => route === "/legal/website-terms/");
  assert.match(privacy.visibleText, /full text under each topic is the privacy notice that controls/iu);
  assert.match(terms.visibleText, /full text under each topic contains the terms that control/iu);
  for (const analysis of [privacy, terms]) {
    assert.match(analysis.visibleText, /call Zack/iu);
    assert.match(analysis.visibleText, /email Zack/iu);
  }
});

test("held privacy discloses Start chooser and Proton handling without restoring simulator claims", async () => {
  const [privacy, terms] = await Promise.all([
    readFile(path.join(SITE_ROOT, "legal/privacy/index.html"), "utf8"),
    readFile(path.join(SITE_ROOT, "legal/website-terms/index.html"), "utf8"),
  ]);
  assert.match(
    privacy,
    /The Start chooser uses the buttons you select only to show a recommendation on the current page\./u,
  );
  assert.match(privacy, /processed through Proton Mail/u);
  for (const source of [privacy, terms]) {
    assert.doesNotMatch(source, /local billing-lifecycle rehearsal/iu);
    assert.doesNotMatch(source, /Publish accepted version/iu);
    assert.doesNotMatch(source, /current tool (?:lets an owner create|stores a local hold)/iu);
    assert.doesNotMatch(source, /Terminal project deletion in this build|Project deletion is terminal in the current/iu);
  }
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
