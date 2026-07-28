#!/usr/bin/env node

import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SITE_ORIGIN = "https://sitesourcery.com";

export const CANONICAL_ROUTES = Object.freeze([
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

export const FUNCTIONAL_APP_ROUTES = Object.freeze([
  "/abracadabra/site/",
]);

export const PRIMARY_NAV = Object.freeze([
  Object.freeze({ label: "Websites", href: "/#websites" }),
  Object.freeze({ label: "Working systems", href: "/hive/" }),
  Object.freeze({ label: "Services", href: "/solutions/" }),
  Object.freeze({ label: "Work", href: "/work/" }),
  Object.freeze({ label: "About", href: "/about/" }),
  Object.freeze({ label: "Start", href: "/start/" }),
]);

export const LEGACY_REDIRECTS = Object.freeze({
  "about.html": "/about/",
  "automation.html": "/hive/",
  "contact.html": "/contact/",
  "faq.html": "/faq/",
  "how-it-works.html": "/custom/process/",
  "pricing.html": "/custom/scope/",
  "privacy.html": "/legal/privacy/",
  "terms.html": "/legal/website-terms/",
  "thanks.html": "/contact/",
  "the-difference.html": "/about/#the-difference",
  "the-meter.html": "/custom/process/#scope",
  "the-moat.html": "/about/#the-difference",
  "the-responder.html": "/hive/",
});

export const CANONICAL_PHONE = Object.freeze({
  display: "(856) 244-1220",
  tel: "tel:+18562441220",
});
export const CANONICAL_MAILBOX = "sitesourcery@proton.me";
export const FILED_ALTERNATE_NAME = "SITESOURCERY";
export const LEGAL_SELLER = "Desiderata Labs LLC · filed alternate name SITESOURCERY";
export const BRAND_IDENTITY_DISCLOSURE =
  "Site Sourcery is the brand presentation of the filed alternate name SITESOURCERY. Desiderata Labs LLC is the legal seller.";

const ALLOWED_EXTERNAL_REFERENCES = new Set([
  "work/index.html\u0000href\u0000https://sconesourcery.com/",
]);

const IGNORED_TOP_LEVEL = new Set([".git", "_site", "node_modules"]);
const NONDEPLOYED_HTML_TOP_LEVEL = new Set([".github", "data", "print-collateral", "scripts"]);
const HTML_ENTITY = Object.freeze({
  amp: "&",
  apos: "'",
  colon: ":",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
});

export function routeToFile(route) {
  if (route === "/") return "index.html";
  if (!/^\/(?:[a-z0-9-]+\/)+$/u.test(route)) {
    throw new TypeError(`Invalid canonical route ${JSON.stringify(route)}`);
  }
  return `${route.slice(1)}index.html`;
}

export const CANONICAL_ROUTE_FILES = Object.freeze(
  Object.fromEntries(CANONICAL_ROUTES.map((route) => [route, routeToFile(route)])),
);
export const FUNCTIONAL_APP_ROUTE_FILES = Object.freeze(
  Object.fromEntries(FUNCTIONAL_APP_ROUTES.map((route) => [route, routeToFile(route)])),
);

function lexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function posix(relative) {
  return relative.split(path.sep).join("/");
}

async function walkFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => lexical(left.name, right.name))) {
    if (directory === root && IGNORED_TOP_LEVEL.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = posix(path.relative(root, absolute));
    if (entry.isSymbolicLink()) {
      files.push({ relative, kind: "symlink" });
    } else if (entry.isDirectory()) {
      files.push(...await walkFiles(root, absolute));
    } else if (entry.isFile()) {
      files.push({ relative, kind: "file" });
    } else {
      files.push({ relative, kind: "other" });
    }
  }
  return files;
}

function decodeEntities(value) {
  return value.replace(
    /&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z]+));?/giu,
    (whole, hex, decimal, named) => {
      if (hex !== undefined) {
        const codePoint = Number.parseInt(hex, 16);
        return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : whole;
      }
      if (decimal !== undefined) {
        const codePoint = Number.parseInt(decimal, 10);
        return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : whole;
      }
      return HTML_ENTITY[named.toLowerCase()] ?? whole;
    },
  );
}

function visibleText(markup) {
  return decodeEntities(
    markup
      .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/giu, " ")
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<[^>]+>/gu, " "),
  )
    .replace(/\s+/gu, " ")
    .trim();
}

function parseAttributes(raw) {
  const attributes = new Map();
  const expression = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  for (const match of raw.matchAll(expression)) {
    const name = match[1].toLowerCase();
    if (attributes.has(name)) {
      throw new Error(`duplicate HTML attribute ${name}`);
    }
    attributes.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return attributes;
}

function tags(source, name) {
  const expression = new RegExp(`<${name}\\b([^>]*)>`, "giu");
  return [...source.matchAll(expression)].map((match) => ({
    attributes: parseAttributes(match[1]),
    raw: match[0],
  }));
}

function pairedTags(source, name) {
  const expression = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}>`, "giu");
  return [...source.matchAll(expression)].map((match) => ({
    attributes: parseAttributes(match[1]),
    inner: match[2],
    raw: match[0],
  }));
}

function idsIn(source) {
  const ids = new Set();
  for (const tag of source.matchAll(/<[a-z][^>]*>/giu)) {
    let attributes;
    try {
      const nameEnd = tag[0].search(/\s|>/u);
      attributes = parseAttributes(tag[0].slice(nameEnd, -1));
    } catch {
      continue;
    }
    const id = attributes.get("id");
    if (id) ids.add(id);
    if (tag[0].toLowerCase().startsWith("<a")) {
      const anchorName = attributes.get("name");
      if (anchorName) ids.add(anchorName);
    }
  }
  return ids;
}

function report(errors, file, message) {
  errors.push(`${file}: ${message}`);
}

function exactCanonicalUrl(route) {
  return new URL(route, `${SITE_ORIGIN}/`).href;
}

function checkPrimaryNav(file, source, errors) {
  let navs;
  try {
    navs = pairedTags(source, "nav");
  } catch (error) {
    report(errors, file, error.message);
    return;
  }
  const primary = navs.filter(({ attributes }) => attributes.has("data-primary-nav"));
  if (primary.length !== 1) {
    report(errors, file, `must contain exactly one primary nav; found ${primary.length}`);
    return;
  }
  let anchors;
  try {
    anchors = pairedTags(primary[0].inner, "a").map(({ attributes, inner }) => ({
      label: visibleText(inner),
      href: attributes.get("href") ?? "",
    }));
  } catch (error) {
    report(errors, file, error.message);
    return;
  }
  const expectedHrefs = new Set(PRIMARY_NAV.map(({ href }) => href));
  const selected = anchors.filter(({ href, label }) =>
    expectedHrefs.has(href) || PRIMARY_NAV.some((entry) => entry.label === label)
  );
  if (JSON.stringify(selected) !== JSON.stringify(PRIMARY_NAV)) {
    report(
      errors,
      file,
      `primary nav must be ${PRIMARY_NAV.map(({ label, href }) => `${label}:${href}`).join(", ")}`,
    );
  }
  let brandLinks = 0;
  for (const anchor of anchors) {
    if (selected.includes(anchor)) continue;
    const isBrand = anchor.href === "/" && /site\s*sourcery/iu.test(anchor.label);
    if (isBrand) {
      brandLinks += 1;
    } else {
      report(errors, file, `primary nav contains unexpected link ${anchor.label}:${anchor.href}`);
    }
  }
  if (brandLinks > 1) report(errors, file, `primary nav contains ${brandLinks} brand links; at most one is allowed`);
}

function checkCanonicalLink(file, route, source, errors) {
  let links;
  try {
    links = tags(source, "link");
  } catch (error) {
    report(errors, file, error.message);
    return;
  }
  const canonical = links.filter(({ attributes }) =>
    (attributes.get("rel") ?? "").toLowerCase().split(/\s+/u).includes("canonical")
  );
  if (canonical.length !== 1) {
    report(errors, file, `must contain exactly one canonical link; found ${canonical.length}`);
    return;
  }
  const expected = exactCanonicalUrl(route);
  if (canonical[0].attributes.get("href") !== expected) {
    report(errors, file, `canonical href must be ${expected}`);
  }
}

function checkOneH1(file, source, errors) {
  const count = (source.match(/<h1\b[^>]*>/giu) ?? []).length;
  if (count !== 1) report(errors, file, `must contain exactly one h1; found ${count}`);
}

function checkUniqueIds(file, source, errors) {
  const seen = new Set();
  for (const match of source.matchAll(/<[a-z][a-z0-9:-]*\b([^>]*)>/giu)) {
    let attributes;
    try {
      attributes = parseAttributes(match[1]);
    } catch (error) {
      report(errors, file, error.message);
      continue;
    }
    const id = attributes.get("id");
    if (!id) continue;
    if (seen.has(id)) report(errors, file, `duplicate id ${JSON.stringify(id)}`);
    seen.add(id);
  }
}

function checkCanonicalIndexability(file, source, errors) {
  let metas;
  try {
    metas = tags(source, "meta");
  } catch (error) {
    report(errors, file, error.message);
    return;
  }
  for (const { attributes } of metas) {
    if ((attributes.get("http-equiv") ?? "").toLowerCase() === "refresh") {
      report(errors, file, "canonical routes must not contain meta refresh");
    }
    if ((attributes.get("name") ?? "").toLowerCase() === "robots") {
      const directives = (attributes.get("content") ?? "").toLowerCase().split(/[\s,]+/u);
      if (directives.includes("noindex") || directives.includes("none")) {
        report(errors, file, "canonical routes must remain indexable");
      }
    }
  }
}

function resolveInternalReference(reference, sourceRoute) {
  if (reference.startsWith("//")) return { type: "external", value: reference };
  if (/^(?:tel|mailto|data):/iu.test(reference)) {
    return { type: reference.slice(0, reference.indexOf(":")).toLowerCase(), value: reference };
  }
  let url;
  try {
    url = new URL(reference, new URL(sourceRoute, `${SITE_ORIGIN}/`));
  } catch {
    return { type: "invalid", value: reference };
  }
  if (url.origin !== SITE_ORIGIN) return { type: "external", value: url.href };
  try {
    return {
      type: "internal",
      fragment: url.hash ? decodeURIComponent(url.hash.slice(1)) : "",
      pathname: decodeURIComponent(url.pathname),
      search: url.search,
      value: reference,
    };
  } catch {
    return { type: "invalid", value: reference };
  }
}

async function checkReferences({
  root,
  canonicalSources,
  additionalSources,
  allFiles,
  errors,
}) {
  const fileNames = new Set(allFiles.filter(({ kind }) => kind === "file").map(({ relative }) => relative));
  const ids = new Map(
    [...canonicalSources.entries()].map(([route, { source }]) => [route, idsIn(source)]),
  );
  const referenceSources = [
    ...[...canonicalSources.entries()].map(([route, { file, source }]) => ({ route, file, source })),
    ...additionalSources,
  ];
  for (const { route, file, source } of referenceSources) {
    const references = [];
    for (const tagName of ["a", "area", "image", "link", "use"]) {
      let found;
      try {
        found = tags(source, tagName);
      } catch (error) {
        report(errors, file, error.message);
        continue;
      }
      for (const tag of found) {
        if (tag.attributes.has("href")) references.push({ attribute: "href", value: tag.attributes.get("href") });
        if (tag.attributes.has("xlink:href")) references.push({ attribute: "xlink:href", value: tag.attributes.get("xlink:href") });
        if (tag.attributes.has("ping")) report(errors, file, "link ping endpoints are forbidden");
      }
    }
    for (const tagName of ["audio", "embed", "iframe", "img", "input", "script", "source", "track", "video"]) {
      let found;
      try {
        found = tags(source, tagName);
      } catch (error) {
        report(errors, file, error.message);
        continue;
      }
      for (const tag of found) {
        if (tag.attributes.has("src")) references.push({ attribute: "src", value: tag.attributes.get("src") });
        if (tag.attributes.has("srcset")) {
          for (const candidate of tag.attributes.get("srcset").split(",")) {
            const value = candidate.trim().split(/\s+/u)[0];
            if (value) references.push({ attribute: "srcset", value });
          }
        }
      }
    }
    for (const [tagName, attribute] of [
      ["button", "formaction"],
      ["form", "action"],
      ["input", "formaction"],
      ["object", "data"],
      ["video", "poster"],
    ]) {
      let found;
      try {
        found = tags(source, tagName);
      } catch (error) {
        report(errors, file, error.message);
        continue;
      }
      for (const tag of found) {
        if (tag.attributes.has(attribute)) {
          references.push({ attribute, value: tag.attributes.get(attribute) });
        }
      }
    }
    let metas = [];
    try {
      metas = tags(source, "meta");
    } catch (error) {
      report(errors, file, error.message);
    }
    for (const meta of metas) {
      const key = (meta.attributes.get("property") ?? meta.attributes.get("name") ?? "").toLowerCase();
      if (["og:image", "og:image:secure_url", "og:url", "twitter:image", "twitter:url"].includes(key)) {
        references.push({ attribute: `meta ${key}`, value: meta.attributes.get("content") ?? "" });
      }
    }
    try {
      if (tags(source, "base").length) report(errors, file, "base URL elements are forbidden");
    } catch (error) {
      report(errors, file, error.message);
    }

    for (const { attribute, value } of references) {
      if (!value) {
        report(errors, file, `${attribute} must not be empty`);
        continue;
      }
      const resolved = resolveInternalReference(value, route);
      if (resolved.type === "tel") {
        if (value !== CANONICAL_PHONE.tel) report(errors, file, `telephone link must be ${CANONICAL_PHONE.tel}`);
        continue;
      }
      if (resolved.type === "mailto") {
        if (value !== `mailto:${CANONICAL_MAILBOX}`) {
          report(errors, file, `mail link must be exactly mailto:${CANONICAL_MAILBOX}`);
        }
        continue;
      }
      if (resolved.type === "data") {
        if (attribute === "href" && !value.startsWith("data:image/")) {
          report(errors, file, "data: href is allowed only for an image icon");
        }
        continue;
      }
      if (
        resolved.type === "external"
        && ALLOWED_EXTERNAL_REFERENCES.has(`${file}\u0000${attribute}\u0000${value}`)
      ) {
        continue;
      }
      if (resolved.type !== "internal") {
        report(errors, file, `external or invalid ${attribute} is forbidden: ${value}`);
        continue;
      }
      if (resolved.search) {
        report(errors, file, `internal ${attribute} must not contain a query: ${value}`);
      }
      if (CANONICAL_ROUTES.includes(resolved.pathname)) {
        if (resolved.fragment && !ids.get(resolved.pathname)?.has(resolved.fragment)) {
          report(errors, file, `missing fragment ${resolved.pathname}#${resolved.fragment}`);
        }
        continue;
      }
      if (FUNCTIONAL_APP_ROUTES.includes(resolved.pathname)) continue;
      if (resolved.pathname.endsWith("/")) {
        report(errors, file, `link targets a noncanonical route: ${resolved.pathname}`);
        continue;
      }
      const targetFile = resolved.pathname.replace(/^\//u, "");
      if (!fileNames.has(targetFile)) {
        report(errors, file, `missing internal asset ${resolved.pathname}`);
      } else if (targetFile.endsWith(".html")) {
        report(errors, file, `link targets noncanonical HTML: ${resolved.pathname}`);
      }
    }
  }

  // Ensure route files themselves are regular files rather than path aliases.
  for (const { file } of canonicalSources.values()) {
    const stat = await lstat(path.join(root, file));
    if (!stat.isFile() || stat.isSymbolicLink()) report(errors, file, "canonical route must be a regular file");
  }
}

function parseSitemap(source, errors) {
  const locations = [];
  for (const match of source.matchAll(/<loc>([\s\S]*?)<\/loc>/giu)) {
    locations.push(decodeEntities(match[1].trim()));
  }
  const expected = CANONICAL_ROUTES.map(exactCanonicalUrl);
  if (JSON.stringify(locations) !== JSON.stringify(expected)) {
    report(
      errors,
      "sitemap.xml",
      `loc entries must exactly equal canonical routes in order; received ${JSON.stringify(locations)}`,
    );
  }
  if (new Set(locations).size !== locations.length) {
    report(errors, "sitemap.xml", "loc entries must be unique");
  }
  return locations;
}

function checkLegacyRedirect(file, target, source, errors) {
  let metas;
  let links;
  let anchors;
  try {
    metas = tags(source, "meta");
    links = tags(source, "link");
    anchors = pairedTags(source, "a");
  } catch (error) {
    report(errors, file, error.message);
    return;
  }
  const robots = metas
    .filter(({ attributes }) => (attributes.get("name") ?? "").toLowerCase() === "robots")
    .map(({ attributes }) => (attributes.get("content") ?? "").toLowerCase());
  if (robots.length !== 1 || !robots[0].split(/[\s,]+/u).includes("noindex")) {
    report(errors, file, "legacy redirect must carry one robots noindex directive");
  }
  const refresh = metas
    .filter(({ attributes }) => (attributes.get("http-equiv") ?? "").toLowerCase() === "refresh")
    .map(({ attributes }) => attributes.get("content") ?? "");
  const expectedRefresh = `0;url=${target}`;
  if (refresh.length !== 1 || refresh[0].replace(/\s+/gu, "") !== expectedRefresh) {
    report(errors, file, `legacy redirect refresh must be ${expectedRefresh}`);
  }
  const canonical = links.filter(({ attributes }) =>
    (attributes.get("rel") ?? "").toLowerCase().split(/\s+/u).includes("canonical")
  );
  const expectedCanonical = new URL(target, `${SITE_ORIGIN}/`).href;
  if (canonical.length !== 1 || canonical[0].attributes.get("href") !== expectedCanonical) {
    report(errors, file, `legacy redirect canonical must be ${expectedCanonical}`);
  }
  if (!anchors.some(({ attributes }) => attributes.get("href") === target)) {
    report(errors, file, `legacy redirect must include a fallback link to ${target}`);
  }
  if (/<form\b|<(?:script|iframe)\b/iu.test(source)) {
    report(errors, file, "legacy redirect must not contain forms, scripts, or frames");
  }
}

export async function validateRouteContract(root = process.cwd()) {
  const absoluteRoot = path.resolve(root);
  const errors = [];
  const allFiles = await walkFiles(absoluteRoot);
  const paths = new Set(allFiles.map(({ relative }) => relative));
  for (const entry of allFiles) {
    if (entry.kind !== "file") report(errors, entry.relative, `unsupported filesystem entry: ${entry.kind}`);
  }

  const expectedHtml = new Set([
    ...Object.values(CANONICAL_ROUTE_FILES),
    ...Object.values(FUNCTIONAL_APP_ROUTE_FILES),
    ...Object.keys(LEGACY_REDIRECTS),
    "404.html",
    "flyer.html",
  ]);
  const actualDeployableHtml = [...paths]
    .filter((file) => file.endsWith(".html"))
    .filter((file) => !NONDEPLOYED_HTML_TOP_LEVEL.has(file.split("/")[0]))
    .filter((file) => !file.startsWith("_site/"));
  for (const file of actualDeployableHtml) {
    if (!expectedHtml.has(file)) report(errors, file, "unexpected HTML route outside the vNext ledger");
  }

  const canonicalSources = new Map();
  const additionalReferenceSources = [];
  for (const route of CANONICAL_ROUTES) {
    const file = CANONICAL_ROUTE_FILES[route];
    if (!paths.has(file)) {
      report(errors, file, `missing canonical route ${route}`);
      continue;
    }
    const source = await readFile(path.join(absoluteRoot, file), "utf8");
    canonicalSources.set(route, { file, source });
    checkOneH1(file, source, errors);
    checkUniqueIds(file, source, errors);
    checkCanonicalLink(file, route, source, errors);
    checkCanonicalIndexability(file, source, errors);
    checkPrimaryNav(file, source, errors);
  }

  for (const route of FUNCTIONAL_APP_ROUTES) {
    const file = FUNCTIONAL_APP_ROUTE_FILES[route];
    if (!paths.has(file)) {
      report(errors, file, `missing functional app route ${route}`);
      continue;
    }
    const source = await readFile(path.join(absoluteRoot, file), "utf8");
    checkOneH1(file, source, errors);
    checkUniqueIds(file, source, errors);
    additionalReferenceSources.push({ route, file, source });
  }

  if (!paths.has("sitemap.xml")) {
    report(errors, "sitemap.xml", "missing sitemap");
  } else {
    parseSitemap(await readFile(path.join(absoluteRoot, "sitemap.xml"), "utf8"), errors);
  }

  for (const [file, target] of Object.entries(LEGACY_REDIRECTS)) {
    if (!paths.has(file)) {
      report(errors, file, `missing legacy redirect to ${target}`);
      continue;
    }
    const source = await readFile(path.join(absoluteRoot, file), "utf8");
    checkLegacyRedirect(file, target, source, errors);
    additionalReferenceSources.push({ route: "/", file, source });
  }

  if (paths.has("404.html")) {
    additionalReferenceSources.push({
      route: "/",
      file: "404.html",
      source: await readFile(path.join(absoluteRoot, "404.html"), "utf8"),
    });
  }
  await checkReferences({
    root: absoluteRoot,
    canonicalSources,
    additionalSources: additionalReferenceSources,
    allFiles,
    errors,
  });

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)].sort(lexical),
    counts: {
      canonicalRoutes: canonicalSources.size,
      legacyRedirects: Object.keys(LEGACY_REDIRECTS).filter((file) => paths.has(file)).length,
      sitemapRoutes: CANONICAL_ROUTES.length,
    },
    sources: canonicalSources,
    files: allFiles,
  };
}

export async function runRouteCli(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    console.log("Usage: node scripts/check-routes.mjs [site-root]");
    return 0;
  }
  if (argv.length > 1) {
    console.error("check-routes: expected zero or one site-root argument");
    return 2;
  }
  try {
    const result = await validateRouteContract(argv[0] ?? process.cwd());
    if (!result.ok) {
      console.error(`SiteSourcery vNext route checks failed (${result.errors.length}):`);
      for (const error of result.errors) console.error(`- ${error}`);
      return 1;
    }
    console.log(
      `SiteSourcery vNext route checks passed: ${result.counts.canonicalRoutes} canonical routes, `
      + `${result.counts.legacyRedirects} legacy noindex redirects, exact sitemap, nav, links, and fragments.`,
    );
    return 0;
  } catch (error) {
    console.error(`check-routes: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runRouteCli();
}
