import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { publicFileAllowlist } from "../build-pages.mjs";
import {
  CANONICAL_ROUTES,
  BRAND_IDENTITY_DISCLOSURE,
  LEGAL_SELLER,
  LEGACY_REDIRECTS,
  PRIMARY_NAV,
  SITE_ORIGIN,
  routeToFile,
  validateRouteContract,
} from "../check-routes.mjs";
import {
  ARTIFACT_SIZE_BUDGETS,
  ABOUT_PROOFS,
  ABOUT_TRUST_FACTS,
  ABRACADABRA_PRODUCT_COPY,
  ABRACADABRA_STATE_BADGE,
  BUSINESS_EMAIL_COPY,
  CUSTOM_COMPONENTS,
  CUSTOM_CREATIVE_PROOFS,
  CUSTOM_CREATIVITY,
  CUSTOM_PROCESS_PHASES,
  CUSTOM_QUOTE_FIELDS,
  CUSTOM_TIERS,
  FAQ_ANCHORS,
  HIVE_CELLS,
  HOME_ABRACADABRA_COPY,
  HOME_HIVE_COPY,
  HOME_DOORS,
  PRIVACY_SECTION_IDS,
  PUBLIC_TRUTH_COPY,
  SOLUTION_ANCHORS,
  START_DECISION_COPY,
  START_PATHS,
  TERMS_SECTION_IDS,
  validateSiteVnext,
} from "../check-site-vnext.mjs";
import {
  BUILD_ADDONS,
  BUILD_TIERS,
  CREATIVITY_LEVELS,
  SCALE_RULE,
} from "../../../commercial/catalog.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(TEST_DIRECTORY, "../..");
const EXPECTED_ROUTES = Object.freeze([
  "/",
  "/custom/",
  "/custom/scope/",
  "/custom/process/",
  "/abracadabra/",
  "/abracadabra/how/",
  "/abracadabra/app/",
  "/hive/",
  "/solutions/",
  "/work/",
  "/about/",
  "/faq/",
  "/contact/",
  "/start/",
  "/legal/",
  "/legal/privacy/",
  "/legal/website-terms/",
]);

async function put(root, file, source) {
  const destination = path.join(root, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, source);
}

async function putIfMissing(root, file, source) {
  const destination = path.join(root, file);
  try {
    const stat = await lstat(destination);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`fixture path exists but is not a regular file: ${file}`);
    }
    return false;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await put(root, file, source);
  return true;
}

function safeAllowlistPlaceholder(file) {
  const extension = path.extname(file).toLowerCase();
  if (file === ".nojekyll") return "";
  if (file === "CNAME") return "sitesourcery.com\n";
  if (file === "robots.txt") return "User-agent: *\nAllow: /\n";
  if (file === "vnext.css") {
    return [
      "html.start-chooser-page { overflow-anchor: none; }",
      ".js .start-chooser.reveal { transition: none; }",
      "",
    ].join("\n");
  }
  if (extension === ".css") return "/* allowlisted fixture asset */\n";
  if (file === "vnext.js") return `${START_DECISION_COPY.join("\n")}\n`;
  if (file === "abracadabra/abracadabra-showcase.js") {
    return [
      '"use strict";',
      '"The generated example did not open. Reload this page to try again.";',
      '"The generated example did not open. Reload this page to try again.";',
      '"Warm generated example ready.";',
      "",
    ].join("\n");
  }
  if (extension === ".js") return '"use strict";\n';
  if (extension === ".svg") {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"></path></svg>';
  }
  if (extension === ".html") {
    return "<!doctype html><html><body><h1>Allowlisted fixture page</h1></body></html>";
  }
  return "allowlisted fixture bytes\n";
}

function primaryNav() {
  return [
    '<nav data-primary-nav aria-label="Primary">',
    '<a href="/">Site Sourcery</a>',
    ...PRIMARY_NAV.map(({ label, href }) => `<a href="${href}">${label}</a>`),
    "</nav>",
  ].join("");
}

function routeFeature(route) {
  if (route === "/") {
    return [
      '<section id="websites">',
      ...HOME_DOORS
        .map((door) => `<a data-home-door="${door}" href="/${door}/">${door}</a>`),
      ...HOME_HIVE_COPY.map((phrase) => `<p>${phrase}</p>`),
      ...HOME_ABRACADABRA_COPY.map((phrase) => `<p>${phrase}</p>`),
      "</section>",
    ].join("");
  }
  if (route === "/hive/") {
    return HIVE_CELLS
      .map((cell) => `<button type="button" data-hive-cell="${cell}">${cell}</button>`)
      .join("");
  }
  if (route === "/solutions/") {
    return SOLUTION_ANCHORS
      .map((anchor) => `<section id="${anchor}" data-solution-anchor="${anchor}">${anchor}</section>`)
      .join("");
  }
  if (route === "/start/") {
    return [
      ...START_PATHS
        .map((startPath) => `<button type="button" data-start-path="${startPath}">${startPath}</button>`),
      '<h2 data-start-question tabindex="-1">Question</h2>',
      '<div data-start-result role="status" aria-live="polite" tabindex="-1"></div>',
    ].join("");
  }
  if (route === "/custom/scope/") {
    return [
      ...CUSTOM_TIERS.map((id) => id === "scale"
        ? '<article data-custom-tier="scale" data-pages="30" data-scale-base="flagship" data-scale-min-units="1" data-scale-max-units="15" data-scale-unit-pages="1" data-scale-unit-sections="4" data-scale-unit-layouts="1" data-scale-unit-words="500" data-scale-unit-media="4">scale</article>'
        : `<article data-custom-tier="${id}">${id}</article>`),
      ...CUSTOM_CREATIVITY.map((id) => `<article data-creative-level="${id}">${id}</article>`),
      ...CUSTOM_CREATIVE_PROOFS.map((id) => `<article data-creative-proof="${id}">${id}</article>`),
      ...CUSTOM_COMPONENTS.map((id) => `<article data-custom-component="${id}">${id}</article>`),
    ].join("");
  }
  if (route === "/legal/privacy/") {
    return PRIVACY_SECTION_IDS.map((id) => `<h2 id="${id}">${id}</h2>`).join("");
  }
  if (route === "/legal/website-terms/") {
    return TERMS_SECTION_IDS.map((id) => `<h2 id="${id}">${id}</h2>`).join("");
  }
  if (route === "/faq/") {
    return FAQ_ANCHORS
      .map((id) => `<details id="${id}" data-faq-anchor="${id}"><summary>${id}</summary></details>`)
      .join("");
  }
  if (route === "/about/") {
    const hrefs = {
      work: "/work/",
      scope: "/custom/scope/",
      abracadabra: "/abracadabra/app/",
      hive: "/hive/",
    };
    return [
      '<section id="the-difference">Difference</section>',
      ...ABOUT_TRUST_FACTS.map((id) => `<div data-about-trust="${id}">${id}</div>`),
      ...ABOUT_PROOFS.map((id) => `<a href="${hrefs[id]}" data-about-proof="${id}">${id}</a>`),
    ].join("");
  }
  if (route === "/work/") {
    return [
      '<div data-external-proof="scone-sourcery" data-proof-state="verified-founder-owned">',
      "<strong>Explore the live venture</strong>",
      "<span>Scone Sourcery is a separate founder-owned venture, not a client engagement. Its public site shows the current interface and current business state.</span>",
      '<a data-external-proof-link="scone-sourcery" href="https://sconesourcery.com/" rel="external">Visit Scone Sourcery</a>',
      "</div>",
    ].join("");
  }
  if (route === "/custom/process/") {
    return [
      '<section id="scope">Scope</section>',
      ...CUSTOM_PROCESS_PHASES.map((id) => `<article data-process-phase="${id}">${id}</article>`),
      '<section data-process-mechanics="review-change-schedule">',
      ...CUSTOM_QUOTE_FIELDS.map((id) => `<div data-receipt-field="${id}">${id}</div>`),
      "</section>",
    ].join("");
  }
  if (route === "/abracadabra/") {
    return [
      '<section data-abracadabra-state-model="session-only">',
      "<h2>One-page website maker</h2>",
      "Make a working page in this browser.",
      "This build does not create an online account, take payment, register or connect a domain, or publish.",
      "No account. No payment. No domain changes. No publishing.",
      "Fictional example made with Abracadabra.",
      '<a href="/abracadabra/app/#workroom">Open</a>',
      "</section>",
      '<section data-abracadabra-journey="local-download">',
      "Finish one step, then open the next.",
      "Business. Look. Review. Test &amp; download.",
      "Build and download.",
      "Build it, review it, test it, and download the HTML.",
      "</section>",
      '<section class="section abracadabra-looks"></section>',
    ].join("");
  }
  if (route === "/abracadabra/how/") {
    return [
      '<section data-abracadabra-state-model="session-only">',
      "From business details to a downloadable page.",
      "Use four short steps: Business, Look, Review, then Test &amp; download.",
      "No account, payment, domain, or publishing step is part of this build.",
      "</section>",
      '<section data-abracadabra-journey="local-download">',
      "What leaves the browser. Only the file you choose to download.",
      "Build the first version now.",
      "</section>",
    ].join("");
  }
  if (route === "/abracadabra/app/") {
    return [
      '<section id="workroom"></section>',
      "<p>Build, test, and download one page.</p>",
      "<p>This build does not create an online account, take payment, register or connect a domain, or publish.</p>",
      "<p>No online account.</p>",
      "<p>No account is required to build and test the first version.</p>",
      "<p>Your page is not saved.</p>",
      "<p>If you refresh this page or close the tab, you will start over.</p>",
      "<h2>Project versions</h2>",
      "<p>Download the version you approved.</p>",
      "<button>Download this HTML</button>",
      '<label>Project title <input type="text" name="project-title"></label>',
    ].join("");
  }
  return "";
}

function canonicalHtml(route) {
  const title = route === "/" ? "Home" : route.split("/").filter(Boolean).join(" ");
  return [
    "<!doctype html><html><head>",
    '<meta charset="utf-8">',
    `<link rel="canonical" href="${new URL(route, `${SITE_ORIGIN}/`).href}">`,
    `<title>${title}</title>`,
    "</head><body>",
    primaryNav(),
    `<main><h1>${title}</h1>${routeFeature(route)}${[...(PUBLIC_TRUTH_COPY[route] ?? []), ...(BUSINESS_EMAIL_COPY[route] ?? [])].map((phrase) => `<p>${phrase}</p>`).join("")}</main>`,
    "<footer>",
    '<a href="tel:+18562441220">(856) 244-1220</a>',
    '<a href="mailto:sitesourcery@proton.me">sitesourcery@proton.me</a>',
    `<span>${LEGAL_SELLER}</span>`,
    `<span>${BRAND_IDENTITY_DISCLOSURE}</span>`,
    "</footer></body></html>",
  ].join("");
}

function legacyHtml(target) {
  const canonical = new URL(target, `${SITE_ORIGIN}/`).href;
  return [
    "<!doctype html><html><head>",
    '<meta name="robots" content="noindex">',
    `<meta http-equiv="refresh" content="0;url=${target}">`,
    `<link rel="canonical" href="${canonical}">`,
    "</head><body>",
    `<a href="${target}">Continue</a>`,
    "</body></html>",
  ].join("");
}

function releaseControl(overrides = "") {
  return `{
    "version": 3,
    "state": "hold",
    "allowsDeployment": false,
    "allowsCommercialDeployment": false,
    "allowsContainmentDeployment": false,
    "allowsPublicTruthReconciliationDeployment": false,
    "publicTruthReconciliation": {
      "state": "hold",
      "approvedCandidateSha": null,
      "authorityReceiptSha256": null
    }${overrides}
  }`;
}

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "site-vnext-test-"));
  for (const route of CANONICAL_ROUTES) {
    await put(root, routeToFile(route), canonicalHtml(route));
  }
  for (const [file, target] of Object.entries(LEGACY_REDIRECTS)) {
    await put(root, file, legacyHtml(target));
  }
  await put(
    root,
    "sitemap.xml",
    `<urlset>${CANONICAL_ROUTES.map((route) =>
      `<url><loc>${new URL(route, `${SITE_ORIGIN}/`).href}</loc></url>`
    ).join("")}</urlset>`,
  );
  await put(
    root,
    "404.html",
    '<!doctype html><html><head><meta content="noindex" name="robots"></head><body><h1>Not found</h1></body></html>',
  );
  for (const file of publicFileAllowlist) {
    await putIfMissing(root, file, safeAllowlistPlaceholder(file));
  }
  await put(root, "data/release-control.json", releaseControl());

  // These intentionally unsafe development-only files prove the build boundary.
  await put(root, "scripts/private.mjs", 'fetch("https://provider.invalid");');
  await put(root, "scripts/private.html", "<form><h1>Internal $999 offer</h1></form>");
  await put(root, "data/private.json", '{"private":true}');
  await put(root, "print-collateral/internal.html", "<h1>Internal $999 offer</h1>");
  await put(root, "flyer.html", "<h1>Internal unavailable draft</h1>");
  await put(root, ".github/workflows/private.yml", "name: private");
  await put(root, "node_modules/private/index.js", "localStorage.value = 1;");
  await put(root, "package.json", '{"private":true}');
  await put(root, "QUALITY.md", "private notes");
  return root;
}

async function modify(root, file, transform) {
  const target = path.join(root, file);
  const source = await readFile(target, "utf8");
  const changed = await transform(source);
  assert.notEqual(changed, source, `mutation must change bytes: ${file}`);
  await writeFile(target, changed);
}

function replaceRequired(source, before, after) {
  assert.ok(source.includes(before), `mutation target must exist: ${before}`);
  const changed = source.replace(before, after);
  assert.notEqual(changed, source, `mutation must change bytes: ${before}`);
  return changed;
}

async function inject(root, file, markup) {
  await modify(root, file, (source) => source.replace("</main>", `${markup}</main>`));
}

async function inFixture(callback) {
  const root = await makeFixture();
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function expectRouteFailure(mutate, expression) {
  await inFixture(async (root) => {
    await mutate(root);
    const result = await validateRouteContract(root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), expression);
  });
}

async function expectSiteFailure(mutate, expression) {
  await inFixture(async (root) => {
    await mutate(root);
    const result = await validateSiteVnext(root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), expression);
  });
}

test("canonical route ledger is exact and stable", () => {
  assert.deepEqual(CANONICAL_ROUTES, EXPECTED_ROUTES);
  assert.equal(publicFileAllowlist.length, 66);
  assert.deepEqual(publicFileAllowlist, [...publicFileAllowlist].sort());
  assert.equal(publicFileAllowlist.includes("thanks.html"), false);
  assert.equal(publicFileAllowlist.includes("data/release-control.json"), false);
  for (const route of CANONICAL_ROUTES) {
    assert.equal(publicFileAllowlist.includes(routeToFile(route)), true);
  }
  assert.deepEqual(HOME_DOORS, ["custom", "abracadabra", "hive"]);
  assert.deepEqual(
    HIVE_CELLS,
    ["missed-call", "booking", "review-request", "after-hours", "follow-up", "getting-paid"],
  );
  assert.deepEqual(
    SOLUTION_ANCHORS,
    ["assessment", "foundations", "care", "domains", "email", "commerce", "interfaces", "studio", "network"],
  );
  assert.deepEqual(START_PATHS, ["website", "system", "service"]);
  assert.deepEqual(ARTIFACT_SIZE_BUDGETS, {
    total: 4 * 1024 * 1024,
    html: 48 * 1024,
    css: 96 * 1024,
    javascript: 96 * 1024,
    image: 640 * 1024,
  });
  assert.deepEqual(ABOUT_TRUST_FACTS, ["base", "established", "operator", "seller"]);
  assert.deepEqual(ABOUT_PROOFS, ["work", "scope", "abracadabra", "hive"]);
  assert.deepEqual(CUSTOM_TIERS, ["card", "card-plus", "site", "site-plus", "signature", "flagship", "scale"]);
  assert.deepEqual(CUSTOM_CREATIVITY, ["essential", "distinctive", "atelier"]);
  assert.deepEqual(CUSTOM_CREATIVE_PROOFS, ["essential", "distinctive", "atelier"]);
  assert.deepEqual(CUSTOM_COMPONENTS, [
    "basic_form",
    "standard_tool",
    "hosted_provider",
    "static_collection",
    "copy_expansion",
    "additional_connection",
    "extra_revision_round",
    "priority_production_window",
  ]);
  assert.deepEqual(CUSTOM_PROCESS_PHASES, ["intake", "scope", "direction", "production", "release", "closeout"]);
  assert.deepEqual(CUSTOM_QUOTE_FIELDS, [
    "outcome",
    "footprint",
    "direction",
    "systems",
    "transition",
    "responsibilities",
    "schedule",
    "commercial",
    "handoff",
  ]);
  assert.equal(HOME_HIVE_COPY.length, 2);
  assert.equal(HOME_ABRACADABRA_COPY.length, 3);
  assert.equal(PRIVACY_SECTION_IDS.length, 16);
  assert.equal(TERMS_SECTION_IDS.length, 17);
  assert.equal(FAQ_ANCHORS.length, 13);
  assert.deepEqual(Object.keys(ABRACADABRA_PRODUCT_COPY), [
    "/abracadabra/",
    "/abracadabra/how/",
    "/abracadabra/app/",
  ]);
});

test("vNext enforces explicit artifact performance budgets", async () => {
  await expectSiteFailure(
    (root) => put(
      root,
      "assets/site-sourcery-main-street-v2.webp",
      Buffer.alloc(ARTIFACT_SIZE_BUDGETS.image + 1, 0x61),
    ),
    /image performance budget is 655360 bytes; received 655361/u,
  );
});

test("valid fixture satisfies routes, nav, sitemap, redirects, and references", async () => {
  await inFixture(async (root) => {
    const result = await validateRouteContract(root);
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.equal(result.counts.canonicalRoutes, 17);
    assert.equal(result.counts.legacyRedirects, 13);
  });
});

test("valid fixture satisfies provider-free vNext and artifact boundary", async () => {
  await inFixture(async (root) => {
    const result = await validateSiteVnext(root);
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.equal(result.counts.homeDoors, 3);
    assert.equal(result.counts.hiveCells, 6);
    assert.equal(result.counts.solutionAnchors, 9);
    assert.equal(result.counts.artifactFiles, 66);
  });
});

test("an unreviewed root file cannot enter the allowlisted public ledger", async () => {
  await inFixture(async (root) => {
    await put(root, "rogue.js", 'fetch("https://provider.invalid"); // unavailable $999');
    const result = await validateSiteVnext(root);
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.equal(result.counts.artifactFiles, 66);
  });
});

test("route contract rejects a missing canonical route", async () => {
  await expectRouteFailure(
    (root) => rm(path.join(root, "custom/scope/index.html")),
    /missing canonical route \/custom\/scope\//u,
  );
});

test("route contract rejects non-exact primary navigation", async () => {
  await expectRouteFailure(
    (root) => modify(root, "index.html", (source) => source.replace(">Websites</a>", ">Bespoke</a>")),
    /primary nav must be/u,
  );
});

test("route contract rejects a non-exact sitemap", async () => {
  await expectRouteFailure(
    (root) => modify(root, "sitemap.xml", (source) =>
      source.replace(
        "<url><loc>https://sitesourcery.com/</loc></url>",
        "<url><loc>https://sitesourcery.com/extra/</loc></url>",
      )),
    /loc entries must exactly equal canonical routes/u,
  );
});

test("route contract rejects a weakened legacy redirect", async () => {
  await expectRouteFailure(
    (root) => modify(root, "pricing.html", (source) => source.replace("noindex", "index")),
    /legacy redirect must carry one robots noindex/u,
  );
});

test("source route contract still requires the source-only thanks redirect", async () => {
  await expectRouteFailure(
    (root) => rm(path.join(root, "thanks.html")),
    /thanks\.html: missing legacy redirect to \/contact\//u,
  );
});

test("source-only thanks redirect is validated but excluded from public content and artifact", async () => {
  await inFixture(async (root) => {
    await modify(root, "thanks.html", (source) =>
      source.replace("</body>", "<p>unavailable future $999</p></body>"));
    const routes = await validateRouteContract(root);
    assert.equal(routes.ok, true, routes.errors.join("\n"));
    const site = await validateSiteVnext(root);
    assert.equal(site.ok, true, site.errors.join("\n"));
    assert.equal(site.counts.artifactFiles, 66);
  });
});

test("route contract rejects broken routes and fragments", async (t) => {
  await t.test("route", () => expectRouteFailure(
    (root) => inject(root, "index.html", '<a href="/missing/">Broken</a>'),
    /link targets a noncanonical route/u,
  ));
  await t.test("fragment", () => expectRouteFailure(
    (root) => inject(root, "index.html", '<a href="/about/#absent">Broken fragment</a>'),
    /missing fragment/u,
  ));
});

test("route contract requires one h1 and an exact canonical link", async (t) => {
  await t.test("h1", () => expectRouteFailure(
    (root) => inject(root, "faq/index.html", "<h1>Second</h1>"),
    /must contain exactly one h1/u,
  ));
  await t.test("canonical", () => expectRouteFailure(
    (root) => modify(root, "faq/index.html", (source) =>
      source.replace("https://sitesourcery.com/faq/", "https://sitesourcery.com/about/")),
    /canonical href must be/u,
  ));
  await t.test("indexability", () => expectRouteFailure(
    (root) => modify(root, "faq/index.html", (source) =>
      source.replace("</head>", '<meta name="robots" content="noindex"></head>')),
    /canonical routes must remain indexable/u,
  ));
  await t.test("duplicate fragment id", () => expectRouteFailure(
    (root) => inject(root, "about/index.html", '<span id="the-difference"></span>'),
    /duplicate id "the-difference"/u,
  ));
});

test("vNext rejects retired and not-live language", async (t) => {
  for (const phrase of [
    "DAARX",
    "Pride Pot",
    "Hive Heart Home",
    "coming soon",
    "future",
    "pre-launch",
    "waitlist",
    "unavailable",
  ]) {
    await t.test(phrase, () => expectSiteFailure(
      (root) => inject(root, "about/index.html", `<p>${phrase}</p>`),
      /contains (?:excluded|retired|coming-soon|future-state|pre-launch|waitlist|unavailable)/u,
    ));
  }
});

test("vNext rejects prices, Offer data, and payment endpoints", async (t) => {
  await t.test("price", () => expectSiteFailure(
    (root) => inject(root, "custom/scope/index.html", "<p>$999</p>"),
    /contains public price/u,
  ));
  await t.test("Offer", () => expectSiteFailure(
    (root) => inject(root, "custom/scope/index.html", '<script type="application/ld+json">{"@type":"Offer"}</script>'),
    /contains active Offer data/u,
  ));
  await t.test("payment", () => expectSiteFailure(
    (root) => inject(root, "custom/scope/index.html", "<code>https://checkout.stripe.com/pay/x</code>"),
    /contains payment endpoint/u,
  ));
});

test("vNext rejects network, submission, storage, and dynamic resource sinks", async (t) => {
  for (const [label, script, expression] of [
    ["network", 'fetch("/contact/")', /contains network sink/u],
    ["external module", 'import("https://example.com/module.js")', /contains external module sink/u],
    ["submission", "element.requestSubmit()", /contains submission sink/u],
    ["storage", 'localStorage.setItem("x", "y")', /contains client storage sink/u],
    ["dynamic", 'document.createElement("script")', /contains dynamic resource sink/u],
  ]) {
    await t.test(label, () => expectSiteFailure(
      (root) => inject(root, "abracadabra/app/index.html", `<script>${script}</script>`),
      expression,
    ));
  }
});

test("vNext allows local app controls only on reviewed Abracadabra app routes", async (t) => {
  await t.test("other page input", () => expectSiteFailure(
    (root) => inject(root, "contact/index.html", '<input type="text">'),
    /allowed only on reviewed Abracadabra app routes/u,
  ));
  await t.test("app form", () => expectSiteFailure(
    (root) => inject(root, "abracadabra/app/index.html", "<form></form>"),
    /form elements are forbidden/u,
  ));
  await t.test("app file access", () => expectSiteFailure(
    (root) => inject(root, "abracadabra/app/index.html", '<input type="file">'),
    /contains file\/upload access/u,
  ));
});

test("vNext requires exact global contact and legal truth", async (t) => {
  await t.test("seller", () => expectSiteFailure(
    (root) => modify(root, "legal/index.html", (source) =>
      source.replace(LEGAL_SELLER, "Alternate Seller LLC")),
    /missing exact global marker/u,
  ));
  await t.test("filed name", () => expectSiteFailure(
    (root) => modify(root, "legal/index.html", (source) =>
      source.replace(BRAND_IDENTITY_DISCLOSURE, "Site Sourcery is a brand.")),
    /missing exact global marker/u,
  ));
  await t.test("phone", () => expectSiteFailure(
    (root) => inject(root, "contact/index.html", "<p>(555) 555-5555</p>"),
    /alternate phone display/u,
  ));
  await t.test("email", () => expectSiteFailure(
    (root) => inject(root, "contact/index.html", "<p>sales@example.com</p>"),
    /alternate public email/u,
  ));
});

test("vNext requires exact home doors, Hive cells, and solution anchors", async (t) => {
  await t.test("doors", () => expectSiteFailure(
    (root) => modify(root, "index.html", (source) =>
      source.replace('data-home-door="hive"', 'data-home-door="hive-extra"')),
    /home doors must exactly equal/u,
  ));
  await t.test("cells", () => expectSiteFailure(
    (root) => modify(root, "hive/index.html", (source) =>
      source.replace(' data-hive-cell="getting-paid"', "")),
    /Hive planner cells must exactly equal/u,
  ));
  await t.test("solutions", () => expectSiteFailure(
    (root) => modify(root, "solutions/index.html", (source) =>
      source.replace('id="network" data-solution-anchor="network"', 'id="networking" data-solution-anchor="network"')),
    /must carry matching id/u,
  ));
});

test("vNext requires Start path controls to remain non-navigating buttons", async () => {
  await expectSiteFailure(
    (root) => modify(root, "start/index.html", (source) =>
      source.replace(
        '<button type="button" data-start-path="system">system</button>',
        '<a href="/hive/" data-start-path="system">system</a>',
      )),
    /Start chooser path system must be a button without navigation fallback/u,
  );
});

test("vNext locks Start question and result accessibility semantics", async (t) => {
  await t.test("question focus target", () => expectSiteFailure(
    (root) => modify(root, "start/index.html", (source) =>
      source.replace('data-start-question tabindex="-1"', "data-start-question")),
    /missing Start focus or live-region semantics/u,
  ));
  await t.test("result live region", () => expectSiteFailure(
    (root) => modify(root, "start/index.html", (source) =>
      source.replace('role="status" aria-live="polite"', 'role="region" aria-live="off"')),
    /missing Start focus or live-region semantics/u,
  ));
});

test("vNext locks fail-closed Start replacement and migration routing", async (t) => {
  await t.test("replacement branch", () => expectSiteFailure(
    (root) => modify(root, "vnext.js", (source) =>
      source.replace("website-replace", "website-direct")),
    /missing fail-closed Start decision marker "website-replace"/u,
  ));
  await t.test("redirect branch", () => expectSiteFailure(
    (root) => modify(root, "vnext.js", (source) =>
      source.replace("replace-redirects", "replace-simple")),
    /missing fail-closed Start decision marker "replace-redirects"/u,
  ));
  await t.test("Abracadabra local boundary", () => expectSiteFailure(
    (root) => modify(root, "vnext.js", (source) =>
      source.replace(
        "It does not put the page online, replace an old site, move content",
        "puts the replacement online",
      )),
    /missing fail-closed Start decision marker/u,
  ));
  await t.test("net-new path permits manually entered source material", () => expectSiteFailure(
    (root) => modify(root, "vnext.js", (source) =>
      source.replace("I will type in the facts myself", "no prior material is allowed")),
    /missing fail-closed Start decision marker/u,
  ));
  await t.test("chooser is exempt from decorative reveal motion", () => expectSiteFailure(
    (root) => modify(root, "vnext.css", (source) =>
      source.replace("transition: none", "transition: transform 520ms ease")),
    /missing layout-stable Start chooser marker "transition: none"/u,
  ));
});

test("vNext locks exact filed identity and local-versus-hosted public truth", async (t) => {
  await t.test("FAQ current scope leads", () => expectSiteFailure(
    (root) => modify(root, "faq/index.html", (source) =>
      source.replace("Abracadabra currently works only in this browser.", "Yes.")),
    /missing filed-name or local-versus-hosted truth/u,
  ));
  await t.test("first FAQ path answer stands alone", () => expectSiteFailure(
    (root) => modify(root, "faq/index.html", (source) =>
      source.replace("Abracadabra works only in this browser", "Abracadabra is self-service")),
    /missing filed-name or local-versus-hosted truth/u,
  ));
  await t.test("terms retain local safety boundary", () => expectSiteFailure(
    (root) => modify(root, "legal/website-terms/index.html", (source) =>
      source.replace("does not contact a reviewer, suspend a provider site", "uses a review operator")),
    /missing filed-name or local-versus-hosted truth/u,
  ));
  await t.test("privacy retains local safety boundary", () => expectSiteFailure(
    (root) => modify(root, "legal/privacy/index.html", (source) =>
      source.replace("Local rehearsal history is not provider or reviewer history", "The history is reviewed")),
    /missing filed-name or local-versus-hosted truth/u,
  ));
  await t.test("terms reject browsewrap claim", () => expectSiteFailure(
    (root) => inject(root, "legal/website-terms/index.html",
      "<p>Using the ordinary public pages accepts these terms for that use.</p>"),
    /contains retired public-truth statement/u,
  ));
  await t.test("terms retain on-device custody boundary", () => expectSiteFailure(
    (root) => modify(root, "legal/website-terms/index.html", (source) =>
      source.replace(
        "Desiderata Labs LLC does not receive or store it through the current on-device maker",
        "Desiderata Labs LLC stores it",
      )),
    /missing filed-name or local-versus-hosted truth/u,
  ));
  await t.test("spaced styling cannot replace filed name", () => expectSiteFailure(
    (root) => modify(root, "about/index.html", (source) =>
      source.replaceAll("SITESOURCERY", "Site Sourcery")),
    /(?:missing exact global marker|missing filed-name or local-versus-hosted truth)/u,
  ));
});

test("vNext keeps business-email value congruent with the studio mailbox", async (t) => {
  await t.test("custody value", () => expectSiteFailure(
    (root) => modify(root, "solutions/index.html", (source) =>
      source.replace("controlled routing", "generic setup")),
    /missing business-email custody copy/u,
  ));
  await t.test("judgmental mailbox framing", () => expectSiteFailure(
    (root) => inject(root, "solutions/index.html",
      "<p>Stop presenting a personal mailbox as its public identity.</p>"),
    /contains judgmental personal-mailbox copy/u,
  ));
  await t.test("current intake label", () => expectSiteFailure(
    (root) => modify(root, "contact/index.html", (source) =>
      source.replace('data-business-email="public-intake"', 'data-business-email="generic"')),
    /missing business-email custody copy/u,
  ));
});

test("About retains a verifiable no-invention trust package", async (t) => {
  const source = await readFile(path.join(SITE_ROOT, "about/index.html"), "utf8");
  for (const fact of ABOUT_TRUST_FACTS) {
    assert.ok(source.includes(`data-about-trust="${fact}"`), `${fact} trust fact must remain visible`);
  }
  for (const proof of ABOUT_PROOFS) {
    assert.ok(source.includes(`data-about-proof="${proof}"`), `${proof} proof route must remain visible`);
  }
  assert.match(source, /Client work is shown only after a real engagement and recorded permission\./u);
  assert.doesNotMatch(source, /data-founder-name|data-founder-portrait/u);

  await t.test("missing trust fact fails closed", () => expectSiteFailure(
    (root) => modify(root, "about/index.html", (fixture) =>
      fixture.replace(' data-about-trust="operator"', "")),
    /About verified trust facts must exactly equal/u,
  ));
  await t.test("missing proof route fails closed", () => expectSiteFailure(
    (root) => modify(root, "about/index.html", (fixture) =>
      fixture.replace(' data-about-proof="abracadabra"', "")),
    /About inspectable proof routes must exactly equal/u,
  ));
  await t.test("misrouted proof fails closed", () => expectSiteFailure(
    (root) => modify(root, "about/index.html", (fixture) =>
      fixture.replace('href="/work/" data-about-proof="work"', 'href="/custom/" data-about-proof="work"')),
    /About proof work must link to/u,
  ));
});

test("Custom keeps the complete quote-only catalog surface and exact internal footprint limits", async (t) => {
  const source = await readFile(path.join(SITE_ROOT, "custom/scope/index.html"), "utf8");
  const processSource = await readFile(path.join(SITE_ROOT, "custom/process/index.html"), "utf8");
  const expectedIds = BUILD_TIERS.map((tier) => tier.id).concat(SCALE_RULE.id);
  assert.deepEqual([...CUSTOM_TIERS], expectedIds);
  for (const tier of BUILD_TIERS) {
    const limits = tier.limits;
    const marker = [
      `data-custom-tier="${tier.id}"`,
      `data-pages="${limits.craftedPages}"`,
      `data-sections="${limits.sections}"`,
      `data-layouts="${limits.uniqueLayouts}"`,
      `data-words="${limits.contentWords}"`,
      `data-media="${limits.suppliedMedia}"`,
      `data-forms="${limits.includedForms}"`,
      `data-revisions="${limits.revisions}"`,
    ].join(" ");
    assert.ok(source.includes(marker), `${tier.id} public limits must match the private catalog`);
    assert.equal(source.includes(String(tier.priceCents)), false, `${tier.id} price cents must remain private`);
  }
  const scaleMarker = [
    `data-custom-tier="${SCALE_RULE.id}"`,
    `data-pages="${SCALE_RULE.maximumCraftedPages}"`,
    `data-scale-base="${SCALE_RULE.baseTierId}"`,
    `data-scale-min-units="${SCALE_RULE.minimumCapacityUnits}"`,
    `data-scale-max-units="${SCALE_RULE.maximumCapacityUnits}"`,
    `data-scale-unit-pages="${SCALE_RULE.allowancePerUnit.craftedPages}"`,
    `data-scale-unit-sections="${SCALE_RULE.allowancePerUnit.sections}"`,
    `data-scale-unit-layouts="${SCALE_RULE.allowancePerUnit.uniqueLayouts}"`,
    `data-scale-unit-words="${SCALE_RULE.allowancePerUnit.contentWords}"`,
    `data-scale-unit-media="${SCALE_RULE.allowancePerUnit.suppliedMedia}"`,
  ].join(" ");
  assert.ok(source.includes(scaleMarker), "public Scale formula must exactly match the private non-price rule");
  assert.equal(source.includes(String(SCALE_RULE.unitPriceCents)), false, "Scale unit price cents must remain private");
  assert.deepEqual(
    [...CUSTOM_CREATIVITY],
    CREATIVITY_LEVELS.map((level) => level.id),
  );
  for (const level of CREATIVITY_LEVELS) {
    assert.ok(
      source.includes(`data-creative-level="${level.id}" data-motion="${level.maximumMotionComponents}"`),
      `${level.id} motion boundary must match the private catalog`,
    );
  }
  assert.deepEqual([...CUSTOM_CREATIVE_PROOFS], CREATIVITY_LEVELS.map((level) => level.id));
  for (const level of CREATIVITY_LEVELS) {
    assert.ok(
      source.includes(`data-creative-proof="${level.id}"`),
      `${level.id} must retain a same-brief visual proof`,
    );
  }
  assert.deepEqual([...CUSTOM_COMPONENTS], Object.keys(BUILD_ADDONS));
  for (const phase of CUSTOM_PROCESS_PHASES) {
    assert.ok(processSource.includes(`data-process-phase="${phase}"`), `${phase} process phase must stay visible`);
  }
  for (const field of CUSTOM_QUOTE_FIELDS) {
    assert.ok(processSource.includes(`data-receipt-field="${field}"`), `${field} quote field must stay visible`);
  }
  assert.match(processSource, /data-process-mechanics="review-change-schedule"/u);

  await t.test("missing tier fails closed", () => expectSiteFailure(
    (root) => modify(root, "custom/scope/index.html", (fixture) =>
      fixture.replace(' data-custom-tier="flagship"', "")),
    /Custom footprint tiers must exactly equal/u,
  ));
  await t.test("missing creative level fails closed", () => expectSiteFailure(
    (root) => modify(root, "custom/scope/index.html", (fixture) =>
      fixture.replace(' data-creative-level="atelier"', "")),
    /Custom creative levels must exactly equal/u,
  ));
  await t.test("missing creative proof fails closed", () => expectSiteFailure(
    (root) => modify(root, "custom/scope/index.html", (fixture) =>
      fixture.replace(' data-creative-proof="atelier"', "")),
    /Custom creative proof variants must exactly equal/u,
  ));
  await t.test("missing component fails closed", () => expectSiteFailure(
    (root) => modify(root, "custom/scope/index.html", (fixture) =>
      fixture.replace(' data-custom-component="priority_production_window"', "")),
    /Custom component shelf must exactly equal/u,
  ));
  await t.test("changed Scale formula fails closed", () => expectSiteFailure(
    (root) => modify(root, "custom/scope/index.html", (fixture) =>
      fixture.replace(' data-scale-unit-sections="4"', ' data-scale-unit-sections="5"')),
    /Scale must expose the exact non-price/u,
  ));
  await t.test("missing process phase fails closed", () => expectSiteFailure(
    (root) => modify(root, "custom/process/index.html", (fixture) =>
      fixture.replace(' data-process-phase="release"', "")),
    /Custom process phases must exactly equal/u,
  ));
  await t.test("missing quote field fails closed", () => expectSiteFailure(
    (root) => modify(root, "custom/process/index.html", (fixture) =>
      fixture.replace(' data-receipt-field="handoff"', "")),
    /Custom quote anatomy fields must exactly equal/u,
  ));
  await t.test("missing review/change/schedule mechanics fails closed", () => expectSiteFailure(
    (root) => modify(root, "custom/process/index.html", (fixture) =>
      fixture.replace('data-process-mechanics="review-change-schedule"', 'data-process-mechanics="review-only"')),
    /must retain explicit review, change, and schedule mechanics/u,
  ));
});

test("vNext locks Hive planning truth and long-page deep links", async (t) => {
  await t.test("Hive planning truth", () => expectSiteFailure(
    (root) => modify(root, "index.html", (source) =>
      source.replace(
        "The planner does not turn anything on. A separate project is required to build a working system.",
        "Ready-made and commissioned systems",
      )),
    /(?:missing Hive planning-versus-commission copy|contains retired Hive product model)/u,
  ));
  await t.test("privacy sections", () => expectSiteFailure(
    (root) => modify(root, "legal/privacy/index.html", (source) =>
      source.replace('id="retention"', 'id="retention-policy"')),
    /stable legal section ids must exactly equal/u,
  ));
  await t.test("terms sections", () => expectSiteFailure(
    (root) => modify(root, "legal/website-terms/index.html", (source) =>
      source.replace('id="publication"', 'id="publishing"')),
    /stable legal section ids must exactly equal/u,
  ));
  await t.test("FAQ anchors", () => expectSiteFailure(
    (root) => modify(root, "faq/index.html", (source) =>
      source.replace('id="hive-planner" data-faq-anchor="hive-planner"', 'id="hive-planner"')),
    /stable FAQ anchors must exactly equal/u,
  ));
});

test("vNext keeps every held Abracadabra route on the local-download product model", async (t) => {
  await t.test("landing copy", () => expectSiteFailure(
    (root) => modify(root, "abracadabra/index.html", (source) =>
      source.replace("Finish one step, then open the next.", "Open everything.")),
    /missing Abracadabra product-coherence copy "Finish one step, then open the next\."/u,
  ));
  await t.test("session-only marker", () => expectSiteFailure(
    (root) => modify(root, "abracadabra/how/index.html", (source) =>
      source.replace('data-abracadabra-state-model="session-only"', "")),
    /session-only state markers must exactly equal/u,
  ));
  await t.test("landing truth precedes the first app action", () => expectSiteFailure(
    (root) => modify(root, "abracadabra/index.html", (source) =>
      source.replace("One-page website maker", "Website maker")),
    /missing above-fold Abracadabra product truth/u,
  ));
  await t.test("landing hero keeps exact local-state boundary", () => expectSiteFailure(
    (root) => modify(root, "abracadabra/index.html", (source) =>
      source.replace(
        "This build does not create an online account, take payment, register or connect a domain, or publish.",
        "This is only a preview.",
      )),
    /missing above-fold Abracadabra product truth/u,
  ));
  await t.test("generated example is not called live", () => expectSiteFailure(
    (root) => modify(root, "abracadabra/index.html", (source) =>
      replaceRequired(
        source,
        "Fictional example made with Abracadabra.",
        "Live example.",
      )),
    /contains retired live-example wording/u,
  ));
  await t.test("runtime showcase status is not called live", () => expectSiteFailure(
    (root) => modify(root, "abracadabra/abracadabra-showcase.js", (source) =>
      replaceRequired(
        source,
        "The generated example did not open. Reload this page to try again.",
        "The live example did not open. Reload this page to try again.",
      )),
    /(?:contains retired live-example runtime status|generated-example failure status must remain exact)/u,
  ));
  await t.test("path-card proof paragraph appears once", () => expectSiteFailure(
    (root) => modify(root, "abracadabra/index.html", (source) => {
      const paragraph = "Build it, review it, test it, and download the HTML.";
      return source.replace("</main>", `<p>${paragraph}</p></main>`);
    }),
    /path-card proof paragraph must appear exactly once/u,
  ));
  await t.test("app route", () => expectSiteFailure(
    (root) => modify(root, "abracadabra/app/index.html", (source) =>
      source.replace("Download the version you approved.", "Save this version.")),
    /missing Abracadabra product-coherence copy "Download the version you approved\."/u,
  ));
});

test("vNext requires all release gates to remain held", async (t) => {
  await t.test("allows flag", () => expectSiteFailure(
    (root) => modify(root, "data/release-control.json", (source) =>
      source.replace('"allowsDeployment": false', '"allowsDeployment": true')),
    /allowsDeployment must/u,
  ));
  await t.test("state", () => expectSiteFailure(
    (root) => modify(root, "data/release-control.json", (source) =>
      source.replace('"state": "hold"', '"state": "release"')),
    /state must be hold/u,
  ));
  await t.test("candidate", () => expectSiteFailure(
    (root) => modify(root, "data/release-control.json", (source) =>
      source.replace('"approvedCandidateSha": null', '"approvedCandidateSha": "abc"')),
    /approvedCandidateSha must be null/u,
  ));
  await t.test("duplicate key", () => expectSiteFailure(
    (root) => modify(root, "data/release-control.json", (source) =>
      source.replace('"version": 3,', '"version": 3, "version": 4,')),
    /duplicate JSON key/u,
  ));
});

test("vNext rejects external public references and CSS resources", async (t) => {
  await t.test("anchor", () => expectSiteFailure(
    (root) => inject(root, "work/index.html", '<a href="https://example.com/">External</a>'),
    /external or invalid href is forbidden/u,
  ));
  await t.test("nearby founder property URL", () => expectSiteFailure(
    (root) => modify(root, "work/index.html", (source) =>
      source.replace("https://sconesourcery.com/", "https://www.sconesourcery.com/")),
    /(?:external or invalid href is forbidden|featured founder-owned proof link must be the exact)/u,
  ));
  await t.test("CSS", async () => expectSiteFailure(
    async (root) => {
      await put(root, "vnext.css", '.hero { background: url("https://example.com/a.png"); }');
    },
    /external CSS resource is forbidden/u,
  ));
  await t.test("SVG", async () => expectSiteFailure(
    async (root) => {
      await put(
        root,
        "assets/cursor-wand.svg",
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"></image></svg>',
      );
    },
    /external SVG href is forbidden/u,
  ));
  await t.test("unallowlisted dependency", async () => expectSiteFailure(
    async (root) => {
      await put(root, "rogue.css", "body { color: inherit; }");
      await modify(root, "index.html", (source) =>
        source.replace("</head>", '<link rel="stylesheet" href="/rogue.css"></head>'));
    },
    /_site: index\.html: missing internal asset \/rogue\.css/u,
  ));
});

test("vNext requires exact, bounded founder-owned Scone Sourcery proof", async (t) => {
  await t.test("authority label", () => expectSiteFailure(
    (root) => modify(root, "work/index.html", (source) =>
      source.replace('data-proof-state="verified-founder-owned"', 'data-proof-state="client-work"')),
    /must remain labeled as verified founder-owned work/u,
  ));
  await t.test("external relationship", () => expectSiteFailure(
    (root) => modify(root, "work/index.html", (source) =>
      source.replace('rel="external"', 'rel="sponsored"')),
    /must be the exact Scone Sourcery external anchor/u,
  ));
});

test("vNext enforces the public 12px type floor", async (t) => {
  await t.test("font-size declaration", () => expectSiteFailure(
    (root) => modify(root, "vnext.css", (source) =>
      `${source}\n.type-floor-regression { font-size: 0.74rem; }\n`),
    /public text size "0\.74rem" is below the 12px floor/u,
  ));
  await t.test("font shorthand declaration", () => expectSiteFailure(
    (root) => modify(root, "vnext.css", (source) =>
      `${source}\n.type-floor-regression { font: 700 0.7rem\/1.4 sans-serif; }\n`),
    /public text size "0\.7rem" is below the 12px floor/u,
  ));
  await t.test("pixel declaration", () => expectSiteFailure(
    (root) => modify(root, "vnext.css", (source) =>
      `${source}\n.type-floor-regression { font-size: 11px; }\n`),
    /public text size "11px" is below the 12px floor/u,
  ));
  await t.test("em declaration", () => expectSiteFailure(
    (root) => modify(root, "vnext.css", (source) =>
      `${source}\n.type-floor-regression { font-size: 0.7em; }\n`),
    /public text size "0\.7em" is below the 12px floor/u,
  ));
  await t.test("percentage declaration", () => expectSiteFailure(
    (root) => modify(root, "vnext.css", (source) =>
      `${source}\n.type-floor-regression { font-size: 70%; }\n`),
    /public text size "70%" is below the 12px floor/u,
  ));
  await t.test("clamp minimum", () => expectSiteFailure(
    (root) => modify(root, "vnext.css", (source) =>
      `${source}\n.type-floor-regression { font-size: clamp(0.7rem, 2vw, 1rem); }\n`),
    /public text size "clamp\(0\.7rem, 2vw, 1rem\)" is below the 12px floor/u,
  ));
  await t.test("variable-driven declaration", () => expectSiteFailure(
    (root) => modify(root, "vnext.css", (source) =>
      `${source}\n:root { --type-regression: 11px; }\n.type-floor-regression { font-size: var(--type-regression); }\n`),
    /public text size "var\(--type-regression\)" is below the 12px floor/u,
  ));
  await t.test("font shorthand without line-height", () => expectSiteFailure(
    (root) => modify(root, "vnext.css", (source) =>
      `${source}\n.type-floor-regression { font: 700 11px sans-serif; }\n`),
    /public text size "11px" is below the 12px floor/u,
  ));
  await t.test("root size reduction", () => expectSiteFailure(
    (root) => modify(root, "vnext.css", (source) =>
      `${source}\nhtml { font-size: 11px; }\n`),
    /public text size "11px" is below the 12px floor/u,
  ));
  await t.test("embedded style", () => expectSiteFailure(
    (root) => modify(root, "index.html", (source) =>
      source.replace("</head>", "<style>.type-floor-regression{font-size:11px}</style></head>")),
    /public text size "11px" is below the 12px floor/u,
  ));
  await t.test("inline style", () => expectSiteFailure(
    (root) => modify(root, "index.html", (source) =>
      source.replace("<h1>", '<h1 style="font-size:11px">')),
    /public text size "11px" is below the 12px floor/u,
  ));
  await t.test("SVG presentation attribute", () => expectSiteFailure(
    (root) => modify(root, "assets/cursor-wand.svg", (source) =>
      source.replace("</svg>", '<text font-size="11px">tiny</text></svg>')),
    /public text size "11px" is below the 12px floor/u,
  ));
});

test("repository site satisfies the vNext release contract", async () => {
  const result = await validateSiteVnext(SITE_ROOT);
  assert.equal(result.ok, true, result.errors.join("\n"));
});
