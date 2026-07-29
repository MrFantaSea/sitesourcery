#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_ROUTE_FILES } from "./check-routes.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");

export const SHARED_HEADER = `<header class="site-header" data-header>
    <div class="site-shell header-inner">
      <a class="site-brand" href="/" aria-label="Site Sourcery home">Site Sourcery</a>
      <button class="menu-button" type="button" aria-expanded="false" aria-controls="primary-menu" data-menu-button>
        <span>Menu</span>
        <i aria-hidden="true"></i>
      </button>
      <nav class="site-nav" id="primary-menu" data-primary-nav data-menu aria-label="Primary">
        <a href="/custom/">Websites</a>
        <a href="/hive/">Calls &amp; follow-up</a>
        <a href="/solutions/">Services</a>
        <a href="/work/">Examples</a>
        <a href="/about/">About</a>
        <a href="/faq/">FAQ</a>
        <a class="nav-start" href="/contact/">Contact</a>
        <a class="nav-call" href="tel:+18562441220">Call Zack: (856) 244-1220</a>
      </nav>
    </div>
  </header>`;

export const SHARED_FOOTER = `<footer class="site-footer">
    <div class="site-shell footer-grid">
      <div class="footer-intro">
        <strong>Site Sourcery</strong>
        <p>Websites and practical help for small businesses.</p>
      </div>
      <nav class="footer-links" aria-label="Footer">
        <strong>Helpful links</strong>
        <a href="/start/">Find the right next step</a>
        <a href="/custom/process/">How website projects work</a>
        <a href="/faq/">FAQ</a>
        <a href="/contact/">Contact</a>
        <a href="/legal/">Legal</a>
        <a href="/legal/privacy/">Privacy</a>
        <a href="/legal/website-terms/">Website terms</a>
      </nav>
      <address class="footer-contact">
        <strong>Contact Zack</strong>
        <a href="tel:+18562441220">(856) 244-1220</a>
        <a href="mailto:sitesourcery@proton.me">sitesourcery@proton.me</a>
      </address>
    </div>
    <div class="site-shell footer-legal">
      <p>© 2026 Desiderata Labs LLC · filed alternate name SITESOURCERY</p>
      <p>Site Sourcery is the brand presentation of the filed alternate name SITESOURCERY. Desiderata Labs LLC is the legal seller.</p>
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
  const withHeader = replaceExactlyOne(source, HEADER_PATTERN, SHARED_HEADER, "site header", file);
  return replaceExactlyOne(withHeader, FOOTER_PATTERN, SHARED_FOOTER, "site footer", file);
}

export async function syncSharedChrome(root = SITE_ROOT) {
  const files = [
    ...Object.values(CANONICAL_ROUTE_FILES),
    "404.html",
  ];
  const changed = [];
  for (const file of files) {
    const target = path.join(root, file);
    const source = await readFile(target, "utf8");
    const next = applySharedChrome(source, file);
    if (next === source) continue;
    await writeFile(target, next, "utf8");
    changed.push(file);
  }
  return { changed, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await syncSharedChrome();
    console.log(
      `Shared chrome synchronized across ${result.files.length} source pages; `
      + `${result.changed.length} file${result.changed.length === 1 ? "" : "s"} changed.`,
    );
  } catch (error) {
    console.error(`sync-shared-chrome: ${error.message}`);
    process.exitCode = 1;
  }
}
