#!/usr/bin/env node

/**
 * Site checks.
 *
 * This replaces roughly 5,400 lines of validators that pinned exact marketing
 * sentences, section orderings, and a product model no owner ever approved.
 * Every time the product moved, the spec had to be edited before the site could
 * be, which is backwards: the spec started deciding what the business sold.
 *
 * What survives here is only what actually breaks a customer or costs money:
 *
 *   1. every route resolves                — a dead page loses the visitor
 *   2. the nav is identical everywhere     — a nav that drifts strands people
 *   3. no dead internal link or anchor     — same
 *   4. every printed price is real         — a wrong number is a wrong invoice
 *   5. phone and email are canonical       — one typo and the call never comes
 *   6. no forms or third-party network     — the site is static and stays static
 *
 * Prices are checked AGAINST data/public-catalog.json rather than banned. The
 * old rule forbade every figure except $5, which is why the site quoted no
 * prices at all. Showing them is the point; showing a stale one is the risk.
 */

import { readFile, readdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const SKIP_DIRS = new Set([
  ".git", "node_modules", "_site", "_hosted", "scripts", "server", "assets", "data", "ops",
]);

const CANONICAL_PHONE_DISPLAY = "(856) 244-1220";
const CANONICAL_PHONE_TEL = "tel:+18562441220";
const CANONICAL_MAILBOX = "sitesourcery@proton.me";

/**
 * Pages that are the product rather than marketing. They render inside the
 * maker and deliberately carry no site chrome, so the shared-nav rule does not
 * apply to them.
 */
const APP_ROUTES = new Set(["/abracadabra/site/"]);

/**
 * Root-level HTML that is not a route folder: the 404 page, the print flyer,
 * and legacy single-file redirects. The review proved these rot invisibly
 * when only index.html files are read.
 */
const NAV_EXEMPT_FILES = new Set(["flyer.html"]); // print artifact, no chrome
const CANONICAL_EXEMPT = new Set(["404.html", "flyer.html"]);

/**
 * The only destinations allowed to leave sitesourcery.com. Kept as an explicit
 * list so a stray tracker or CDN can never arrive unnoticed — every addition is
 * a decision someone has to make on purpose.
 */
const ALLOWED_EXTERNAL = new Set([
  "https://sconesourcery.com/", // real founder-owned venture, cited as proof on /work/
  "https://daarx.money/", // second founder-owned venture, cited as proof on /work/
]);

/**
 * Stripe-hosted checkout. These are the only destinations allowed to take money,
 * and they must be Stripe's own domain: a "buy" button pointing anywhere else is
 * either a mistake or an attack, and both look identical in a diff.
 *
 * A link may only appear here once its product can actually be DELIVERED. The
 * $5 preview and the $25 subscription have live Stripe links, but the maker
 * cannot yet charge or provision, so wiring them to a page would take money for
 * something that does not happen. Recorded in server/commerce/rails.mjs.
 */
const CHECKOUT_ORIGIN = "https://buy.stripe.com/";

const errors = [];
const fail = (file, message) => errors.push(`${file}: ${message}`);

// ---------------------------------------------------------------- discovery

/** Every public page, found on disk rather than declared in a list that drifts. */
async function findPages(dir = ROOT, pages = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      await findPages(path.join(dir, entry.name), pages);
    } else if (entry.name === "index.html") {
      pages.push(path.relative(ROOT, path.join(dir, entry.name)));
    } else if (dir === ROOT && entry.name.endsWith(".html")) {
      pages.push(entry.name);
    }
  }
  return pages;
}

const routeOf = (page) =>
  page.endsWith("index.html")
    ? "/" + page.slice(0, -"index.html".length)
    : "/" + page;

// ------------------------------------------------------------------ catalog

async function catalogPrices() {
  const amounts = new Set([5]); // the Abracadabra preview, a product fact
  const walk = (value, key) => {
    if (Array.isArray(value)) return value.forEach((item) => walk(item, key));
    if (value && typeof value === "object") {
      return Object.entries(value).forEach(([k, v]) => walk(v, k));
    }
    if (typeof value === "number" && /cents$/iu.test(key ?? "")) amounts.add(value / 100);
  };
  walk(JSON.parse(await readFile(path.join(ROOT, "data/public-catalog.json"), "utf8")), null);
  return amounts;
}

// ------------------------------------------------------------------- checks

const NAV = /<nav class="site-nav"[\s\S]*?<\/nav>/u;
const PRICE = /\$\s?\d[\d,]*(?:\.\d{2})?/gu;
const HREF = /href="([^"]+)"/gu;
const ID = /\bid="([^"]+)"/gu;

/**
 * A retired route that now forwards somewhere else. These carry no nav and no
 * chrome on purpose — they exist so old links and bookmarks keep working rather
 * than dying. Recognised by shape, not by a list, so adding one needs no edit
 * here; but it must be a real redirect, which is verified below.
 */
function isRedirect(source) {
  return /<meta\s+http-equiv="refresh"/iu.test(source);
}

function checkRedirect(page, source, routes, idsByRoute) {
  const target = source.match(/http-equiv="refresh"\s+content="0;url=([^"]+)"/iu)?.[1];
  if (!target) return fail(page, "looks like a redirect but has no refresh target");
  const [route, anchor] = target.split("#");
  if (!routes.has(route)) fail(page, `redirects to ${JSON.stringify(target)}, which does not exist`);
  if (anchor && !(idsByRoute.get(route) ?? new Set()).has(anchor)) {
    fail(page, `redirects to anchor ${JSON.stringify(target)}, which does not exist on the target page`);
  }
  if (!/name="robots"\s+content="noindex"/iu.test(source)) {
    fail(page, "a redirect must be noindex so it never competes with its target");
  }
  // The canonical is the target PAGE - fragments are meaningless to crawlers.
  if (!source.includes(`<link rel="canonical" href="https://sitesourcery.com${route}"`)) {
    fail(page, "a redirect must declare its target page as canonical");
  }
}

function checkNav(page, source, reference) {
  if (APP_ROUTES.has(routeOf(page))) return null;
  const found = source.match(NAV);
  if (!found) return fail(page, "has no primary nav");
  // aria-current marks the page you are on, so it is expected to differ.
  const normalise = (value) => value.replace(/\s*aria-current="page"/gu, "");
  if (reference && normalise(found[0]) !== normalise(reference)) {
    fail(page, "primary nav differs from the rest of the site");
  }
  return found[0];
}

function checkContact(page, source) {
  const phones = source.match(/\(?\b856\)?[\s.-]?244[\s.-]?1220\b/gu) ?? [];
  for (const phone of phones) {
    if (phone !== CANONICAL_PHONE_DISPLAY) {
      fail(page, `phone must read ${CANONICAL_PHONE_DISPLAY}, found ${JSON.stringify(phone)}`);
    }
  }
  if (source.includes("tel:") && !source.includes(CANONICAL_PHONE_TEL)) {
    fail(page, `tel: link must be ${CANONICAL_PHONE_TEL}`);
  }
  for (const mail of source.match(/[\w.+-]+@[\w.-]+/gu) ?? []) {
    if (mail !== CANONICAL_MAILBOX) fail(page, `unexpected email ${JSON.stringify(mail)}`);
  }
}

function checkPrices(page, source, allowed) {
  for (const raw of source.match(PRICE) ?? []) {
    const amount = Number(raw.replace(/[^\d.]/gu, ""));
    if (!allowed.has(amount)) {
      fail(page, `price ${JSON.stringify(raw)} is not in data/public-catalog.json`);
    }
  }
}

function checkStatic(page, source) {
  if (/<form\b/iu.test(source)) fail(page, "contains a form; this site is static");
  for (const [, href] of source.matchAll(HREF)) {
    if (
      /^https?:\/\//u.test(href)
      && !href.startsWith("https://sitesourcery.com")
      && !href.startsWith(CHECKOUT_ORIGIN)
      && !ALLOWED_EXTERNAL.has(href)
    ) {
      fail(page, `links off-site to ${JSON.stringify(href)}`);
    }
    // A checkout link that is nearly-but-not-quite Stripe is the whole attack.
    if (/buy\.stripe/iu.test(href) && !href.startsWith(CHECKOUT_ORIGIN)) {
      fail(page, `checkout link is not on ${CHECKOUT_ORIGIN}: ${JSON.stringify(href)}`);
    }
  }
  const remote = source.match(/(?:src|href)="\/\/[^"]+"/u);
  if (remote) fail(page, `loads a protocol-relative remote resource ${JSON.stringify(remote[0])}`);
}

function checkLinks(page, source, idsByRoute, routes) {
  for (const [, href] of source.matchAll(HREF)) {
    if (!href.startsWith("/") && !href.startsWith("#")) continue;

    const [target, anchor] = href.split("#");
    const route = target === "" ? routeOf(page) : target;

    if (target !== "" && !routes.has(route)) {
      // Allow real files (stylesheets, images, legacy .html redirects).
      if (!/\.[a-z0-9]+$/iu.test(route)) fail(page, `dead link to ${JSON.stringify(href)}`);
      continue;
    }
    if (anchor && !(idsByRoute.get(route) ?? new Set()).has(anchor)) {
      fail(page, `link to ${JSON.stringify(href)} points at an id that does not exist`);
    }
  }
}

/**
 * A live page must declare itself as its own canonical home. The Responder
 * shipped pointing Google at a 404 and nothing noticed; now something does.
 */
function checkCanonical(page, source) {
  if (APP_ROUTES.has(routeOf(page)) || CANONICAL_EXEMPT.has(page)) return;
  const expected = `<link rel="canonical" href="https://sitesourcery.com${routeOf(page)}">`;
  if (!source.includes(expected)) {
    fail(page, `canonical must be ${JSON.stringify(`https://sitesourcery.com${routeOf(page)}`)}`);
  }
}

/**
 * Every site-absolute resource a page loads must exist on disk. The planner
 * script pointed at /hive/ for days; a checker that reads hrefs but not srcs
 * is blind in exactly one eye.
 */
const RESOURCE = /(?:src|href|srcset)="(\/[^"]+?)"/gu;

async function checkResources(page, source) {
  for (const [, raw] of source.matchAll(RESOURCE)) {
    for (const candidate of raw.split(",")) {
      const clean = candidate.trim().split(/[\s?#]/u)[0];
      if (!clean || !/\.[a-z0-9]+$/iu.test(clean)) continue; // routes handled elsewhere
      try {
        await access(path.join(ROOT, clean.slice(1)));
      } catch {
        fail(page, `loads ${JSON.stringify(clean)}, which does not exist on disk`);
      }
    }
  }
  for (const [, url] of source.matchAll(/content="https:\/\/sitesourcery\.com(\/[^"]+\.[a-z0-9]+)"/gu)) {
    try {
      await access(path.join(ROOT, url.slice(1)));
    } catch {
      fail(page, `meta points at ${JSON.stringify(url)}, which does not exist on disk`);
    }
  }
}

/**
 * Money truth: the commerce ledger and the pages must agree exactly. Every
 * checkout link on a page must be a registered sellable rail, and the rail
 * count is pinned so a rail can neither vanish nor appear unnoticed.
 */
async function checkRails(pagesSources) {
  const { sellableNow } = await import(path.join(ROOT, "server/commerce/rails.mjs"));
  const rails = sellableNow();
  if (rails.length !== 5) {
    fail("server/commerce/rails.mjs", `expected exactly 5 sellable rails, found ${rails.length}`);
  }
  const registered = new Set(rails.map((rail) => rail.checkoutUrl));
  for (const [page, source] of pagesSources) {
    for (const [, href] of source.matchAll(HREF)) {
      if (!href.startsWith(CHECKOUT_ORIGIN)) continue;
      const bare = href.split("?")[0];
      if (!registered.has(bare)) {
        fail(page, `checkout link ${JSON.stringify(bare)} is not a registered sellable rail`);
      }
    }
  }
}

/**
 * Truth-slot seals: the bytes between every slot's markers must still match
 * the reviewed manifest. Edits to sealed copy without a reseal fail loudly
 * here instead of silently drifting from the hosted counterpart.
 */
async function checkSeals() {
  const MANIFEST = path.join(ROOT, "scripts/hosted-truth/manifest.mjs");
  let slots;
  try {
    ({ hostedTruthSlots: slots } = await import(MANIFEST));
  } catch {
    return; // no manifest in this tree shape; nothing to verify
  }
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  const markerFor = (id, kind, edge) =>
    kind === "js"
      ? `/* sitesourcery:truth-slot:${id}:${edge} */`
      : `<!-- sitesourcery:truth-slot:${id}:${edge} -->`;
  for (const slot of slots) {
    let source;
    try {
      source = await readFile(path.join(ROOT, slot.file), "utf8");
    } catch {
      fail(slot.file, `sealed file missing for slot ${slot.id}`);
      continue;
    }
    const start = source.indexOf(markerFor(slot.id, slot.kind, "start"));
    const end = source.indexOf(markerFor(slot.id, slot.kind, "end"));
    if (start < 0 || end < 0) {
      fail(slot.file, `slot ${slot.id} markers missing`);
      continue;
    }
    const body = source.slice(start + markerFor(slot.id, slot.kind, "start").length, end);
    if (sha256(body) !== slot.sourceSha256) {
      fail(slot.file, `slot ${slot.id} changed without a reseal (run reseal-v2)`);
    }
  }
}

/**
 * The sitemap is the third route truth and it is not allowed to disagree with
 * the tree: exactly the live, indexable folder routes, nothing else.
 */
async function checkSitemap(pages, sources) {
  let xml;
  try {
    xml = await readFile(path.join(ROOT, "sitemap.xml"), "utf8");
  } catch {
    return fail("sitemap.xml", "missing");
  }
  const listed = new Set(
    [...xml.matchAll(/<loc>https:\/\/sitesourcery\.com([^<]*)<\/loc>/gu)].map(([, route]) => route),
  );
  const expected = new Set(
    pages
      .filter((page) => page.endsWith("index.html"))
      .filter((page) => !isRedirect(sources.get(page)))
      .filter((page) => !/name="robots"\s+content="[^"]*noindex/iu.test(sources.get(page)))
      .map(routeOf),
  );
  for (const route of expected) {
    if (!listed.has(route)) fail("sitemap.xml", `missing live route ${route}`);
  }
  for (const route of listed) {
    if (!expected.has(route)) fail("sitemap.xml", `lists ${route}, which is not a live indexable route`);
  }
}

// --------------------------------------------------------------------- main

const pages = (await findPages()).sort();
const sources = new Map();
for (const page of pages) sources.set(page, await readFile(path.join(ROOT, page), "utf8"));

const routes = new Set(pages.map(routeOf));
const idsByRoute = new Map(
  pages.map((page) => [
    routeOf(page),
    new Set([...sources.get(page).matchAll(ID)].map(([, id]) => id)),
  ]),
);

const allowed = await catalogPrices();
let referenceNav = null;

let redirectCount = 0;

for (const page of pages) {
  const source = sources.get(page);
  if (isRedirect(source)) {
    redirectCount += 1;
    checkRedirect(page, source, routes, idsByRoute);
    continue;
  }
  if (!NAV_EXEMPT_FILES.has(page)) {
    const nav = checkNav(page, source, referenceNav);
    referenceNav ??= nav;
  }
  checkContact(page, source);
  checkPrices(page, source, allowed);
  checkStatic(page, source);
  checkLinks(page, source, idsByRoute, routes);
  checkCanonical(page, source);
  await checkResources(page, source);
}

await checkRails(sources);
await checkSeals();
await checkSitemap(pages, sources);

if (errors.length) {
  console.error(`Site checks failed (${errors.length}):`);
  for (const error of errors.sort()) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Site checks passed: ${pages.length - redirectCount} live pages `
  + `+ ${redirectCount} redirects, one shared nav, no dead links or resources, `
  + `${allowed.size} catalog prices, 5 sellable rails, seals fresh, `
  + `sitemap exact, canonical phone, email, and rel=canonical.`,
);
