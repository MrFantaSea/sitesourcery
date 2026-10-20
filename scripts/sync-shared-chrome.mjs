#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_ROUTE_FILES } from "./check-routes.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");

// The canonical public chrome. Legal render inputs and retained versions are sealed
// separately and must never be rewritten by this synchronizer.
export const SHARED_CHROME_FILES = Object.freeze([
  ...Object.entries(CANONICAL_ROUTE_FILES)
    .filter(([route]) => !route.startsWith("/legal/"))
    .map(([, file]) => file),
  "404.html",
]);

export const SHARED_HEADER = `<header class="site-header" data-header>
    <div class="site-shell header-inner">
      <a class="site-brand" href="/" aria-label="Site Sourcery home">Site Sourcery</a>
      <button class="menu-button" type="button" aria-label="Menu" aria-expanded="false" aria-controls="primary-menu" data-menu-button>
        <span>Menu</span>
        <i aria-hidden="true"></i>
      </button>
      <nav class="site-nav" id="primary-menu" data-primary-nav data-menu aria-label="Primary">
        <a href="/abracadabra/">Abracadabra</a>
        <a href="/alakazam/">Alakazam</a>
        <a href="/custom/">Sorcery</a>
        <a href="/care/">Care</a>
        <a href="/responder/">The Responder</a>
        <a href="/work/">Spell book</a>
        <a href="/about/">About</a>
      </nav>
      <a class="nav-call" href="tel:+18562441220" aria-label="Call Site Sourcery"><span>(856) 244-1220</span></a>
    </div>
  </header>`;

export const SHARED_FOOTER = `<footer class="site-footer">
    <div class="site-shell footer-stack">
      <strong class="footer-brand">Site Sourcery</strong>
      <p class="footer-tag">Websites and practical help for small businesses everywhere.</p>
      <nav class="footer-row" aria-label="Services">
        <a href="/abracadabra/">Abracadabra — build a one-page website</a>
        <a href="/alakazam/">Alakazam — host your Abracadabra page</a>
        <a href="/custom/">Sorcery — custom websites</a>
        <a href="/care/">Care — website upkeep</a>
        <a href="/responder/">The Responder — missed-call texts</a>
      </nav>
      <nav class="footer-row" aria-label="Footer">
        <a href="/abracadabra/app/">Customer account</a>
        <span aria-hidden="true">·</span>
        <a href="/faq/">FAQ</a>
        <span aria-hidden="true">·</span>
        <a href="/legal/">Legal</a>
        <span aria-hidden="true">·</span>
        <a href="tel:+18562441220">(856) 244-1220</a>
        <span aria-hidden="true">·</span>
        <a href="mailto:sitesourcery@proton.me">sitesourcery@proton.me</a>
      </nav>
      <p class="footer-copyright">© 2026 Desiderata Labs LLC · DBA Site Sourcery</p>
    </div>
  </footer>`;

const HEADER_PATTERN = /<header\b[^>]*class="[^"]*\bsite-header\b[^"]*"[^>]*>[\s\S]*?<\/header>/giu;
const FOOTER_PATTERN = /<footer\b[^>]*class="[^"]*\bsite-footer\b[^"]*"[^>]*>[\s\S]*?<\/footer>/giu;

function replaceExactlyOne(source, pattern, replacement, label, file) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${file} must contain exactly one ${label}; found ${matches.length}`);
  }
  const match = matches[0];
  return source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length);
}

export function applySharedChrome(source, file = "document") {
  const currentRoute = Object.entries(CANONICAL_ROUTE_FILES)
    .find(([, routeFile]) => routeFile === file)?.[0];
  const header = currentRoute
    ? SHARED_HEADER.replace(`href="${currentRoute}">`, `href="${currentRoute}" aria-current="page">`)
    : SHARED_HEADER;
  const withHeader = replaceExactlyOne(source, HEADER_PATTERN, header, "site header", file);
  return replaceExactlyOne(withHeader, FOOTER_PATTERN, SHARED_FOOTER, "site footer", file);
}

export async function syncSharedChrome(root = SITE_ROOT, { checkOnly = false } = {}) {
  // Read and validate every target before the first write. Redirects, operator
  // tools, and legal render inputs are outside this public chrome scope.
  const updates = [];
  for (const file of SHARED_CHROME_FILES) {
    const target = path.join(root, file);
    const source = await readFile(target, "utf8");
    const next = applySharedChrome(source, file);
    if (next !== source) updates.push({ file, target, next });
  }
  if (!checkOnly) {
    for (const { target, next } of updates) await writeFile(target, next, "utf8");
  }
  return { changed: updates.map(({ file }) => file), files: SHARED_CHROME_FILES };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
      throw new Error("usage: node scripts/sync-shared-chrome.mjs [--check]");
    }
    const checkOnly = args[0] === "--check";
    const result = await syncSharedChrome(SITE_ROOT, { checkOnly });
    if (checkOnly && result.changed.length) {
      throw new Error(`shared chrome differs in: ${result.changed.join(", ")}`);
    }
    console.log(
      `Shared chrome ${checkOnly ? "checked" : "synchronized"} across ${result.files.length} source pages; `
      + `${result.changed.length} file${result.changed.length === 1 ? "" : "s"} changed.`,
    );
  } catch (error) {
    console.error(`sync-shared-chrome: ${error.message}`);
    process.exitCode = 1;
  }
}
