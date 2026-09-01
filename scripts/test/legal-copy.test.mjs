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

test("legal drafts plainly show their review status and direct contact routes", async () => {
  const result = await inspectLegalCopy(SITE_ROOT, { reportOnly: true });
  const privacy = result.analyses.find(({ route }) => route === "/legal/privacy/");
  const terms = result.analyses.find(({ route }) => route === "/legal/website-terms/");
  assert.match(privacy.visibleText, /Draft for review/iu);
  assert.match(terms.visibleText, /Draft for review/iu);
  assert.match(privacy.visibleText, /not effective or published yet/iu);
  assert.match(terms.visibleText, /not effective or published yet/iu);
  for (const analysis of [privacy, terms]) {
    assert.match(analysis.visibleText, /call (?:Zack|me)/iu);
    assert.match(analysis.visibleText, /email (?:Zack|me)/iu);
  }
});

test("privacy draft discloses Start chooser and Proton handling without simulator claims", async () => {
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

test("privacy separates guest work and discloses hosted, domain, billing, and Responder data", async () => {
  const privacy = await readFile(
    path.join(SITE_ROOT, "legal/privacy/index.html"),
    "utf8",
  );
  for (const phrase of [
    "The free guest preview needs no account. Saving a project or using its $20 Download requires sign-in.",
    "Made versions are stored in this tab’s session storage so they can survive a refresh or a payment return.",
    "When you press the Domains page’s check button, the browser cleans the typed candidate and sends its .com, .net, and .org names in NS queries to Cloudflare’s public DNS-over-HTTPS resolver at cloudflare-dns.com.",
    "Cloudflare processes the query and connection data under its",
    "The quick check does not call a registrar and does not prove availability, show a final price, reserve a name, or place an order.",
    "Alakazam is Site Sourcery’s monthly hosting option.",
    "Site Sourcery shares those details only after the customer approves the name, price, and job.",
    "consent records, opt-outs, routing details, replies, and human handoff records",
    "After Alakazam service ends, the customer has 30 days to read and export saved work.",
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
  assert.match(privacy, /Draft for review/u);
  assert.match(
    privacy,
    /This draft is not effective or published yet\./u,
  );
  assert.doesNotMatch(
    privacy,
    /SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V3|<p class="card-kicker">Effective [A-Z][a-z]+ \d{1,2}, \d{4}<\/p>/u,
  );
});

test("website terms draft explains every current service, price, renewal, and exit boundary", async () => {
  const terms = await readFile(
    path.join(SITE_ROOT, "legal/website-terms/index.html"),
    "utf8",
  );
  for (const phrase of [
    "Creating an account and signing in lets the customer save the project. A completed one-time $20 payment unlocks its HTML Download.",
    "A domain the customer owns is separate from Alakazam. Site Sourcery can register or connect it under written domain terms.",
    "Download costs $20 once. Alakazam is $25, $35, or $50 a month and renews until you cancel.",
    "A prior $20 Download purchase creates one $20 credit toward the same project's first Alakazam bill.",
    "The customer may cancel Alakazam at any time with no cancellation fee.",
    "If a renewal payment fails, Alakazam gives a seven-day payment grace period.",
    "An active Alakazam customer can publish, roll back, or unpublish a saved page.",
    "Site Sourcery can search for, register, connect, renew, transfer, and manage DNS for a customer domain.",
    "The one-time $300 setup and separate $250 monthly service begin only under a customer agreement.",
    "standard requests such as STOP, CANCEL, END, QUIT, REVOKE, OPTOUT, and UNSUBSCRIBE stop later messages",
    "Care plans are Host $25, Care Lite $69, Care $119, Care Plus $199, and Partner $349 per month",
    "The Download sale is final when the accepted HTML file is available through the signed-in Download control.",
    "the customer will cover reasonable losses and costs from a third-party claim",
    "A Custom payment becomes final when the work, reserved production time, or milestone tied to it begins.",
    "Care renews monthly until the customer cancels through the method in the written plan.",
    "the final 50% becomes due only after completion and before final handoff. Completion does not authorize an automatic charge.",
    "The 30-day workmanship correction window begins only when final handoff is recorded after final payment. Completion or launch by itself does not start that clock.",
  ]) {
    assert.ok(terms.includes(phrase), phrase);
  }
  for (const staleClaim of [
    /Alakazam offers four ways to have an address/u,
    /coming soon|not open yet/iu,
    /90-day retained exit period/u,
    /keeps serving for 14 days/u,
    /suspension begins on day 15/u,
    /Bought and self-managed/u,
    /Bought and looked after/u,
    /final balance sooner, before launch/u,
    /Make temporary versions, preview them, and download chosen HTML./u,
    /open a working preview, and download a chosen self-contained HTML file./u,
    /The browser may process, compile, display, and download that material on the customer’s device/u,
    /\bheld\b/iu,
    /\$5(?!\d)/u,
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
  for (const file of files) {
    const source = await readFile(path.join(SITE_ROOT, file), "utf8");
    assert.match(source, /(?:Larger builds use half before work and half after completion, before the final handoff\. Completion does not trigger an automatic charge\.|Site through Scale use half before work starts; the final half becomes due only after completion and before final handoff\. Completion itself does not authorize an automatic charge\.)/u, `${file} must retain the final-payment boundary`);
    assert.doesNotMatch(source, /half on completion|half before, half on completion/iu);
  }
});

test("Responder and FAQ show the owner-approved contact-to-start service and prices", async () => {
  const [responder, faq] = await Promise.all([
    readFile(path.join(SITE_ROOT, "responder/index.html"), "utf8"),
    readFile(path.join(SITE_ROOT, "faq/index.html"), "utf8"),
  ]);
  assert.match(responder, /\$300 setup \+ \$250 a month\./u);
  assert.match(responder, /Nothing goes live until you approve the wording and we test the handoff with you\./u);
  assert.match(faq, /The Responder is \$300 to set up and \$250 a month\./u);
  assert.match(faq, /the final 50% becomes due after completion and before final handoff\./u);
  for (const source of [responder, faq]) {
    assert.doesNotMatch(source, /\bheld\b|inquiry[ -]only|buy\.stripe\.com/iu);
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
