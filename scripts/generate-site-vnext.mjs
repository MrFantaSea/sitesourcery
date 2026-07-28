#!/usr/bin/env node

import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_ROUTE_FILES,
  CANONICAL_ROUTES,
  LEGACY_REDIRECTS,
  SITE_ORIGIN,
} from "./check-routes.mjs";
import {
  SHARED_FOOTER,
  SHARED_HEADER,
} from "./sync-shared-chrome.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");

async function write(relative, source) {
  const target = path.join(SITE_ROOT, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source, "utf8");
}

function redirectPage(target) {
  const canonical = new URL(target, `${SITE_ORIGIN}/`).href;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <meta http-equiv="refresh" content="0;url=${target}">
  <link rel="canonical" href="${canonical}">
  <title>Moved · Site Sourcery</title>
</head>
<body>
  <p>This address has moved. <a href="${target}">Continue to the current page.</a></p>
</body>
</html>
`;
}

function notFoundPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#08070c">
  <title>Lost in the stacks · Site Sourcery</title>
  <meta name="description" content="That Site Sourcery address does not lead to a public page.">
  <link rel="stylesheet" href="/vnext.css">
  <script src="/vnext.js" defer></script>
</head>
<body class="vnext-page">
  <a class="skip-link" href="#main">Skip to the page</a>
  ${SHARED_HEADER}
  <main class="not-found site-shell" id="main">
    <div>
      <p class="eyebrow">A turn beyond the map</p>
      <h1>404</h1>
      <p>The page is not here, but the way back is still clear.</p>
      <div class="hero-actions">
        <a class="button button-primary" href="/">Return home</a>
        <a class="button" href="/start/">Choose a path</a>
      </div>
    </div>
  </main>
  ${SHARED_FOOTER}
</body>
</html>
`;
}

function sitemap() {
  const locations = CANONICAL_ROUTES
    .map((route) => `  <url><loc>${new URL(route, `${SITE_ORIGIN}/`).href}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locations}
</urlset>
`;
}

async function assertCanonicalPagesExist() {
  const missing = [];
  for (const file of Object.values(CANONICAL_ROUTE_FILES)) {
    try {
      await access(path.join(SITE_ROOT, file));
    } catch {
      missing.push(file);
    }
  }
  if (missing.length) {
    throw new Error(`canonical pages must exist before route generation: ${missing.join(", ")}`);
  }
}

export async function generateRouteInfrastructure() {
  await assertCanonicalPagesExist();
  for (const [file, target] of Object.entries(LEGACY_REDIRECTS)) {
    await write(file, redirectPage(target));
  }
  await write("404.html", notFoundPage());
  await write("sitemap.xml", sitemap());
  await write(
    "robots.txt",
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`,
  );
  return {
    canonicalRoutes: CANONICAL_ROUTES.length,
    redirects: Object.keys(LEGACY_REDIRECTS).length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await generateRouteInfrastructure();
    console.log(
      `Generated route infrastructure for ${result.canonicalRoutes} canonical routes `
      + `and ${result.redirects} source redirects.`,
    );
  } catch (error) {
    console.error(`generate-site-vnext: ${error.message}`);
    process.exitCode = 1;
  }
}
