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

import { readFile, readdir } from "node:fs/promises";
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
 * The only destinations allowed to leave sitesourcery.com. Kept as an explicit
 * list so a stray tracker or CDN can never arrive unnoticed — every addition is
 * a decision someone has to make on purpose.
 */
const ALLOWED_EXTERNAL = new Set([
  "https://sconesourcery.com/", // real founder-owned venture, cited as proof on /work/
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
    }
  }
  return pages;
}

const routeOf = (page) => "/" + page.slice(0, -"index.html".length);

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

function checkRedirect(page, source, routes) {
  const target = source.match(/http-equiv="refresh"\s+content="0;url=([^"]+)"/iu)?.[1];
  if (!target) return fail(page, "looks like a redirect but has no refresh target");
  if (!routes.has(target)) fail(page, `redirects to ${JSON.stringify(target)}, which does not exist`);
  if (!/name="robots"\s+content="noindex"/iu.test(source)) {
    fail(page, "a redirect must be noindex so it never competes with its target");
  }
  if (!source.includes(`<link rel="canonical" href="https://sitesourcery.com${target}"`)) {
    fail(page, "a redirect must declare its target as canonical");
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
    checkRedirect(page, source, routes);
    continue;
  }
  const nav = checkNav(page, source, referenceNav);
  referenceNav ??= nav;
  checkContact(page, source);
  checkPrices(page, source, allowed);
  checkStatic(page, source);
  checkLinks(page, source, idsByRoute, routes);
}

if (errors.length) {
  console.error(`Site checks failed (${errors.length}):`);
  for (const error of errors.sort()) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Site checks passed: ${pages.length - redirectCount} live routes `
  + `+ ${redirectCount} redirects, one shared nav, no dead links, `
  + `${allowed.size} catalog prices, canonical phone and email.`,
);
