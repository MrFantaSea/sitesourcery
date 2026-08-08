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
    assert.match(analysis.visibleText, /call (?:Zack|me)/iu);
    assert.match(analysis.visibleText, /email (?:Zack|me)/iu);
  }
});

test("held privacy discloses Start chooser and Proton handling without restoring simulator claims", async () => {
  const [privacy, terms] = await Promise.all([
    readFile(path.join(SITE_ROOT, "legal/privacy/index.html"), "utf8"),
    readFile(path.join(SITE_ROOT, "legal/website-terms/index.html"), "utf8"),
  ]);
  assert.match(
    privacy,
    /The Start chooser uses selected buttons only to show a recommendation on the current page and does not send that selection\./u,
  );
  assert.match(privacy, /processed through Proton Mail/u);
  for (const source of [privacy, terms]) {
    assert.doesNotMatch(source, /local billing-lifecycle rehearsal/iu);
    assert.doesNotMatch(source, /Publish accepted version/iu);
    assert.doesNotMatch(source, /current tool (?:lets an owner create|stores a local hold)/iu);
    assert.doesNotMatch(source, /Terminal project deletion in this build|Project deletion is terminal in the current/iu);
  }
});

test("privacy separates guest work from retained Download records and discloses Cloudflare DNS preflight", async () => {
  const privacy = await readFile(
    path.join(SITE_ROOT, "legal/privacy/index.html"),
    "utf8",
  );
  for (const phrase of [
    "The free guest preview needs no account. Saving an editor project or using its $5 Download requires sign-in.",
    "Made versions are stored in this tab’s session storage so they can survive a refresh or a payment return.",
    "When you press the Domains page’s check button, the browser cleans the typed candidate and sends its .com, .net, and .org names in NS queries to Cloudflare’s public DNS-over-HTTPS resolver at cloudflare-dns.com.",
    "Cloudflare processes the query and connection data under its",
    "Site Sourcery’s preflight does not call a registrar availability, pricing, reservation, or purchase API.",
    "Alakazam has no active customer lifecycle or retention schedule under this notice.",
  ]) {
    assert.ok(privacy.includes(phrase), phrase);
  }
  for (const staleClaim of [
    /Before an Alakazam subscription exists there is no account, saved project/u,
    /14-day serving window/u,
    /day-15 suspension/u,
    /90-day retained exit period/u,
  ]) {
    assert.doesNotMatch(privacy, staleClaim);
  }
  assert.match(privacy, /Not effective — release identity pending/u);
  assert.match(
    privacy,
    /This copy is not published by an unsealed build\./u,
  );
  assert.doesNotMatch(
    privacy,
    /SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V3|<p class="card-kicker">Effective [A-Z][a-z]+ \d{1,2}, \d{4}<\/p>/u,
  );
});

test("website terms hold Alakazam, domains, lifecycle policy, and The Responder without inventing an offer", async () => {
  const terms = await readFile(
    path.join(SITE_ROOT, "legal/website-terms/index.html"),
    "utf8",
  );
  for (const phrase of [
    "The free guest maker makes temporary tab-only versions and previews. It offers no account, saved project, Checkout, or Download.",
    "Only the separate signed-in hosted account path can retain an editor project and unlock that project’s HTML Download after a completed one-time $5 payment.",
    "A signed-in retained project’s $5 Download likewise delivers an HTML file without publishing or hosting it.",
    "That maker provides no Download, and Desiderata Labs LLC does not receive or store the material merely because a guest preview is made.",
    "The planned $25, $35, and $50 Alakazam plans are not available.",
    "No Alakazam subscription, hosting activation, publication, or tier feature is offered.",
    "These terms establish no public Alakazam cancellation, grace, suspension, retention, deletion, or refund schedule.",
    "Customer-owned domain purchase or connection inside Alakazam remains undecided and is not offered by this page.",
    "The Responder remains held until its telephony, A2P registration, message delivery, opt-out handling, monitoring, lifecycle terms, and customer proof are complete.",
    "the final 50% becomes due only after completion and before final handoff. Completion does not authorize an automatic charge.",
    "The 30-day workmanship correction window begins only when final handoff is recorded after final payment. Completion or launch by itself does not start that clock.",
  ]) {
    assert.ok(terms.includes(phrase), phrase);
  }
  for (const staleClaim of [
    /Alakazam offers four ways to have an address/u,
    /Alakazam is \$25 per month for keeping a page online/u,
    /can be cancelled at any time/iu,
    /90-day retained exit period/u,
    /keeps serving for 14 days/u,
    /suspension begins on day 15/u,
    /Bought and self-managed/u,
    /Bought and looked after/u,
    /final balance sooner, before launch/u,
    /Make temporary versions, preview them, and download chosen HTML./u,
    /open a working preview, and download a chosen self-contained HTML file./u,
    /The browser may process, compile, display, and download that material on the customer’s device/u,
    /Alakazam has three plans/iu,
    /approved three-plan ladder/iu,
    /difference-only upgrade rule/iu,
  ]) {
    assert.doesNotMatch(terms, staleClaim);
  }
});

test("all public Custom surfaces preserve the same final-payment boundary", async () => {
  const files = [
    "custom/index.html",
    "custom/process/index.html",
    "custom/scope/index.html",
  ];
  const finalPaymentBoundary =
    "Site through Scale use half before work starts; the final half becomes due only after completion and before final handoff. Completion itself does not authorize an automatic charge.";
  for (const file of files) {
    const source = await readFile(path.join(SITE_ROOT, file), "utf8");
    assert.ok(source.includes(finalPaymentBoundary), `${file} must retain the exact final-payment boundary`);
    assert.doesNotMatch(source, /half on completion|half before, half on completion/iu);
  }
});

test("Responder and FAQ expose inquiry-only held status with no active service or price claim", async () => {
  const [responder, faq] = await Promise.all([
    readFile(path.join(SITE_ROOT, "responder/index.html"), "utf8"),
    readFile(path.join(SITE_ROOT, "faq/index.html"), "utf8"),
  ]);
  for (const phrase of [
    "The Responder is not currently connected to a phone number, sending messages, or operating for customers.",
    "No setup or monthly plan is for sale.",
    "This is an inquiry page only.",
  ]) {
    assert.ok(responder.includes(phrase), phrase);
  }
  assert.match(faq, /The Responder is also held: it sends no messages and this page cannot quote or start setup\./u);
  assert.match(faq, /the final 50% becomes due after completion and before final handoff\./u);
  assert.match(faq, /completion or launch by itself does not start the clock\./u);
  for (const source of [responder, faq]) {
    assert.doesNotMatch(
      source,
      /\$300|\$250|within seconds|Texts in seconds|switch it off whenever you like/iu,
    );
  }
});

test("legal-copy gate rejects a changed substantive clause", async () => {
  const errors = await routeErrors("/legal/privacy/", (source) =>
    source.replace(
      "Desiderata Labs LLC operates this website under the filed New Jersey alternate name ",
      "Desiderata Labs LLC runs this website under ",
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
