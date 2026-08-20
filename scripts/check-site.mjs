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
 *   7. Work labels match public truth       — a study must never read as client proof
 *   8. live pages keep basic semantics      — skip targets and headings remain usable
 *
 * Prices are checked AGAINST data/public-catalog.json rather than banned. The
 * old rule forbade every figure except $5, which is why the site quoted no
 * prices at all. Showing them is the point; showing a stale one is the risk.
 */

import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicFileAllowlist } from "./build-pages.mjs";
import {
  heldAlakazamArtifactExcludedFiles,
  heldAlakazamExecutableSemantics,
} from "./hosted-truth/manifest.mjs";
import {
  assertImmutableLegalArtifactSources,
  assertPrivacyV3CandidateSources,
  immutableLegalArtifacts,
  immutableLegalArtifactFiles,
} from "./hosted-truth/legal-artifacts.mjs";
import { validateWorkPublicTruth } from "./work-public-truth.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const CANONICAL_PHONE_DISPLAY = "(856) 244-1220";
const CANONICAL_PHONE_TEL = "tel:+18562441220";
const CANONICAL_MAILBOX = "sitesourcery@proton.me";
const HELD_ALAKAZAM_PRICE_DISCLOSURE =
  "The planned $25, $35, and $50 Alakazam plans are not available.";
const HELD_ALAKAZAM_PRICE_DISCLOSURE_FILES = new Set([
  "faq/index.html",
  "legal/website-terms/index.html",
]);

/**
 * Root-level HTML that is not a route folder: the 404 page, the print flyer,
 * and legacy single-file redirects. The review proved these rot invisibly
 * when only index.html files are read.
 */
const NAV_EXEMPT_FILES = new Set([
  "404.html", // noncanonical fallback; not part of the 24-route successor nav
  "flyer.html", // print artifact, no chrome
]);
const CANONICAL_EXEMPT = new Set(["404.html", "flyer.html"]);

/**
 * The only destinations allowed to leave sitesourcery.com. Kept as an explicit
 * list so a stray tracker or CDN can never arrive unnoticed — every addition is
 * a decision someone has to make on purpose.
 */
const ALLOWED_EXTERNAL = new Set([
  "https://sconesourcery.com/", // real founder-owned venture, cited as proof on /work/
  "https://daarx.money/", // second founder-owned venture, cited as proof on /work/
  "https://developers.cloudflare.com/1.1.1.1/privacy/public-dns-resolver/", // exact resolver privacy notice cited by /legal/privacy/
]);

/**
 * Direct public Payment Links are forbidden. The $5 Download uses authenticated
 * server Checkout, while Alakazam remains held. Keep the origin constant only
 * so malformed lookalike links and any accidental public release fail loudly.
 */
const CHECKOUT_ORIGIN = "https://buy.stripe.com/";

const errors = [];
const fail = (file, message) => errors.push(`${file}: ${message}`);
const IMMUTABLE_LEGAL_ARTIFACTS = new Map(
  immutableLegalArtifacts.map((artifact) => [artifact.file, artifact]),
);
const IMMUTABLE_LEGAL_ARTIFACT_FILES = new Set(immutableLegalArtifactFiles);

// ---------------------------------------------------------------- discovery

/** Every published page, derived from the same positive artifact ledger. */
async function findPages() {
  return publicFileAllowlist.filter((file) => file.endsWith(".html"));
}

const routeOf = (page) =>
  page.endsWith("index.html")
    ? "/" + page.slice(0, -"index.html".length)
    : "/" + page;

// ------------------------------------------------------------------ catalog

function catalogPrices(catalog, commerce) {
  const amounts = new Set();
  const walk = (value, key) => {
    if (Array.isArray(value)) return value.forEach((item) => walk(item, key));
    if (value && typeof value === "object") {
      return Object.entries(value).forEach(([k, v]) => walk(v, k));
    }
    if (typeof value === "number" && /cents$/iu.test(key ?? "")) amounts.add(value / 100);
  };
  walk({
    buildTiers: catalog.buildTiers,
    customPaymentTerms: catalog.customPaymentTerms,
    scaleRule: catalog.scaleRule,
    creativityLevels: catalog.creativityLevels,
    buildAddons: catalog.buildAddons,
    architectureBands: catalog.architectureBands,
    migration: catalog.migration,
    professionalServices: catalog.professionalServices,
  }, null);
  for (const offer of commerce.SELLABLE) {
    if (
      offer.amountCents !== null
      && offer.availability !== commerce.OFFER_AVAILABILITY.HELD
    ) amounts.add(offer.amountCents / 100);
  }
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
  // The frozen compatibility contract binds refresh, canonical, and fallback
  // to the same exact route-plus-fragment target.
  if (!source.includes(`<link rel="canonical" href="https://sitesourcery.com${target}"`)) {
    fail(page, "a redirect must declare its target page as canonical");
  }
}

function checkNav(page, source, reference) {
  const found = source.match(NAV);
  if (!found) return fail(page, "has no primary nav");
  // aria-current marks the page you are on, so it is expected to differ.
  const normalise = (value) => value
    .replace(/\s*aria-current="page"/gu, "")
    .replace(/>\s+</gu, "><")
    .trim();
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
  let priceSource = source;
  if (HELD_ALAKAZAM_PRICE_DISCLOSURE_FILES.has(page)) {
    const disclosureCount = source.split(
      HELD_ALAKAZAM_PRICE_DISCLOSURE
    ).length - 1;
    if (disclosureCount !== 1) {
      fail(
        page,
        `held Alakazam price disclosure must appear exactly once, found ${disclosureCount}`
      );
    } else {
      priceSource = source.replace(HELD_ALAKAZAM_PRICE_DISCLOSURE, "");
    }
  }
  for (const raw of priceSource.match(PRICE) ?? []) {
    const amount = Number(raw.replace(/[^\d.]/gu, ""));
    if (!allowed.has(amount)) {
      fail(
        page,
        `price ${JSON.stringify(raw)} is not released for public display by the availability-aware catalog`
      );
    }
  }
}

function checkOfferClaims(page, source, commerce) {
  const offers = new Map(commerce.SELLABLE.map((offer) => [offer.id, offer]));
  const rules = [
    {
      id: "alacazam.hosting",
      state: commerce.OFFER_AVAILABILITY.HELD,
      label: "held Alakazam sale",
      patterns: [
        /Abracadabra builds it\. Alakazam keeps it live/iu,
        /Free to See-\$5 to Download-\$25 a Month Keeps It Live/iu,
        /Alakazam is the service that keeps it and puts it online/iu,
        /Live at your own address/iu,
        /\$25[^<\n]{0,40}(?:month|mo)\b/iu,
        /(?:the\s+)?\$5 comes off (?:your first month|Alakazam)/iu,
        /leaving costs nothing/iu,
        /Alakazam is (?:active|on)\b/iu,
      ],
    },
    {
      id: "responder",
      state: commerce.OFFER_AVAILABILITY.HELD,
      label: "held Responder sale",
      patterns: [
        /\$300\s+setup/iu,
        /\$250\s+(?:a|per)\s+month/iu,
        /The Responder[^<\n]{0,80}texts them back/iu,
        /Answers in seconds|Sent 4 seconds|Switch it off any time/iu,
      ],
    },
    {
      id: "domain.purchase",
      state: commerce.OFFER_AVAILABILITY.INQUIRY_ONLY,
      label: "inquiry-only domain sale",
      patterns: [/Buy a domain/iu, /rent an address instead/iu],
    },
    {
      id: "assessment",
      state: commerce.OFFER_AVAILABILITY.ACCOUNT_ONLY,
      label: "account-only assessment sale",
      patterns: [
        /assessment that comes off any build/iu,
        /full \$200 comes off any build/iu,
        /Book (?:the|an|your) assessment/iu,
      ],
    },
  ];
  for (const rule of rules) {
    if (offers.get(rule.id)?.availability !== rule.state) continue;
    for (const pattern of rule.patterns) {
      const match = source.match(pattern);
      if (match) fail(page, `contains ${rule.label} claim ${JSON.stringify(match[0])}`);
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
  if (CANONICAL_EXEMPT.has(page)) return;
  const expectedUri = IMMUTABLE_LEGAL_ARTIFACTS.get(page)?.canonicalUri
    ?? `https://sitesourcery.com${routeOf(page)}`;
  const expected = `<link rel="canonical" href="${expectedUri}">`;
  if (!source.includes(expected)) {
    fail(page, `canonical must be ${JSON.stringify(expectedUri)}`);
  }
}

/**
 * Small structural accessibility/SEO protections retained from the archived
 * checker without freezing page layout or copy.
 */
function checkDocumentSemantics(page, source) {
  if (!/<main\b(?=[^>]*\bid="main")(?=[^>]*\btabindex="-1")[^>]*>/iu.test(source)) {
    fail(page, 'must contain <main id="main" tabindex="-1"> for the skip link');
  }
  const headings = source.match(/<h1\b[^>]*>/giu) ?? [];
  if (headings.length !== 1) fail(page, `must contain exactly one h1; found ${headings.length}`);
  if (
    page === "404.html"
    && !/<meta\b(?=[^>]*\bname="robots")(?=[^>]*\bcontent="[^"]*\bnoindex\b[^"]*")[^>]*>/iu.test(source)
  ) {
    fail(page, "must carry a robots noindex directive");
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
      if (!publicFileAllowlist.includes(clean.slice(1))) {
        fail(page, `loads ${JSON.stringify(clean)}, which is not in the public artifact ledger`);
        continue;
      }
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
 * checkout link on a page must be a specifically released public-checkout
 * rail. Provider references and fixed amounts do not imply availability.
 */
async function checkRails(pagesSources, commerce, publicCatalog) {
  const { SELLABLE, OFFER_AVAILABILITY, RAIL_NEEDS_SERVER, sellableNow } = commerce;
  const rails = sellableNow();
  if (publicCatalog.offerState === "inquiry-only" && rails.length !== 0) {
    fail(
      "server/commerce/rails.mjs",
      `inquiry-only public catalog cannot release ${rails.length} public checkout rails`
    );
  }
  const availabilityValues = new Set(Object.values(OFFER_AVAILABILITY));
  const ids = new Set();
  for (const offer of SELLABLE) {
    if (ids.has(offer.id)) {
      fail("server/commerce/rails.mjs", `duplicate offer id ${JSON.stringify(offer.id)}`);
    }
    ids.add(offer.id);
    if (!availabilityValues.has(offer.availability)) {
      fail(
        "server/commerce/rails.mjs",
        `offer ${JSON.stringify(offer.id)} has invalid availability ${JSON.stringify(offer.availability)}`
      );
    }
    if (
      offer.availability !== OFFER_AVAILABILITY.PUBLIC_CHECKOUT
      && offer.checkoutUrl !== null
    ) {
      fail(
        "server/commerce/rails.mjs",
        `non-public offer ${JSON.stringify(offer.id)} cannot retain a direct Checkout URL`
      );
    }
    if (
      offer.availability === OFFER_AVAILABILITY.ACCOUNT_ONLY
      && RAIL_NEEDS_SERVER[offer.rail] !== true
    ) {
      fail(
        "server/commerce/rails.mjs",
        `account-only offer ${JSON.stringify(offer.id)} must use a server Checkout rail`
      );
    }
    if (
      offer.availability === OFFER_AVAILABILITY.HELD
      && offer.amountCents !== null
    ) {
      fail(
        "server/commerce/rails.mjs",
        `held offer ${JSON.stringify(offer.id)} cannot expose active price authority`
      );
    }
  }
  const expectedOfferAvailability = {
    "abracadabra.preview": OFFER_AVAILABILITY.ACCOUNT_ONLY,
    "alacazam.hosting": OFFER_AVAILABILITY.HELD,
    "domain.purchase": OFFER_AVAILABILITY.INQUIRY_ONLY,
    "domain.purchase.plus": OFFER_AVAILABILITY.INQUIRY_ONLY,
    assessment: OFFER_AVAILABILITY.ACCOUNT_ONLY,
    responder: OFFER_AVAILABILITY.HELD,
    "custom.build": OFFER_AVAILABILITY.INQUIRY_ONLY,
  };
  const actualOfferAvailability = Object.fromEntries(
    SELLABLE.map((offer) => [offer.id, offer.availability])
  );
  if (JSON.stringify(actualOfferAvailability) !== JSON.stringify(expectedOfferAvailability)) {
    fail(
      "server/commerce/rails.mjs",
      `exact offer availability mapping changed; received ${JSON.stringify(actualOfferAvailability)}`
    );
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
  for (const file of heldAlakazamArtifactExcludedFiles) {
    if (publicFileAllowlist.includes(file)) {
      fail(file, "held Alakazam source entered the public artifact ledger");
    }
  }
  for (const file of publicFileAllowlist.filter((candidate) =>
    /\.(?:html|js|json|xml|txt)$/u.test(candidate))) {
    const source = await readFile(path.join(ROOT, file), "utf8");
    if (source.includes(CHECKOUT_ORIGIN) && registered.size === 0) {
      fail(file, "contains direct Stripe Checkout authority while no public checkout rail is released");
    }
    if (file.endsWith(".js")) {
      for (const semantic of heldAlakazamExecutableSemantics) {
        const match = source.match(new RegExp(semantic.pattern, "u"));
        if (match) {
          fail(
            file,
            `contains held Alakazam executable semantics ${semantic.id} ${JSON.stringify(match[0])}`,
          );
        }
      }
    }
  }
  return Object.freeze({ direct: rails.length, classified: SELLABLE.length });
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
      .filter((page) => !IMMUTABLE_LEGAL_ARTIFACT_FILES.has(page))
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
try {
  assertImmutableLegalArtifactSources({ root: ROOT });
  assertPrivacyV3CandidateSources({ root: ROOT });
} catch (error) {
  fail("legal artifact truth", error.message);
}
const sources = new Map();
for (const page of pages) sources.set(page, await readFile(path.join(ROOT, page), "utf8"));

const routes = new Set(pages.map(routeOf));
const idsByRoute = new Map(
  pages.map((page) => [
    routeOf(page),
    new Set([...sources.get(page).matchAll(ID)].map(([, id]) => id)),
  ]),
);

const publicCatalog = JSON.parse(
  await readFile(path.join(ROOT, "data/public-catalog.json"), "utf8")
);
const commerce = await import(path.join(ROOT, "server/commerce/rails.mjs"));
const allowed = catalogPrices(publicCatalog, commerce);
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
    if (!IMMUTABLE_LEGAL_ARTIFACT_FILES.has(page)) {
      const nav = checkNav(page, source, referenceNav);
      referenceNav ??= nav;
    }
    checkDocumentSemantics(page, source);
  }
  checkContact(page, source);
  checkPrices(page, source, allowed);
  checkOfferClaims(page, source, commerce);
  checkStatic(page, source);
  checkLinks(page, source, idsByRoute, routes);
  checkCanonical(page, source);
  await checkResources(page, source);
}

const workFile = "work/index.html";
const workSource = sources.get(workFile);
if (!workSource) {
  fail(workFile, "missing from the public page ledger");
} else {
  for (const message of validateWorkPublicTruth(workSource)) fail(workFile, message);
}

const railCounts = await checkRails(sources, commerce, publicCatalog);
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
  + `${allowed.size} catalog prices, ${railCounts.direct} public checkout rails `
  + `across ${railCounts.classified} explicitly classified offers, seals fresh, `
  + `sitemap exact, Work truth exact, one h1 and focusable main per live page, `
  + `canonical phone, email, and rel=canonical.`,
);
