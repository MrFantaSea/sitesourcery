#!/usr/bin/env node

import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  artifactPath,
  auditBrowser,
  REVIEWED_CHROMIUM,
} from "./browser-audit-vnext.mjs";

const SITE_ORIGIN = "https://sitesourcery.com";

export async function routesFromArtifactSitemap(artifactRoot) {
  const absoluteRoot = path.resolve(artifactRoot);
  const stat = await lstat(absoluteRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("artifact root must be a real directory");
  }
  const source = await readFile(path.join(absoluteRoot, "sitemap.xml"), "utf8");
  const routes = [...source.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => {
    const url = new URL(match[1]);
    if (
      url.origin !== SITE_ORIGIN
      || url.username
      || url.password
      || url.search
      || url.hash
      || !url.pathname.startsWith("/")
      || path.posix.normalize(url.pathname) !== url.pathname
    ) {
      throw new Error(`sitemap contains an invalid public route: ${match[1]}`);
    }
    return url.pathname;
  });
  if (!routes.length || routes.length > 100) {
    throw new Error("artifact sitemap must contain between 1 and 100 routes");
  }
  if (new Set(routes).size !== routes.length) {
    throw new Error("artifact sitemap routes must be unique");
  }
  return routes;
}

async function walkFiles(directory, root = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isSymbolicLink()) throw new Error(`artifact contains a symbolic link: ${relative}`);
    if (entry.isDirectory()) files.push(...await walkFiles(absolute, root));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`artifact contains an unsupported entry: ${relative}`);
  }
  return files.sort();
}

async function requireRegularFile(file, label) {
  let stat;
  try {
    stat = await lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${label} is missing`);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} is not a regular file`);
}

function routeForArtifactFile(file) {
  if (file === "index.html") return "/";
  if (file.endsWith("/index.html")) return `/${file.slice(0, -"index.html".length)}`;
  return `/${file}`;
}

export async function verifyArtifactLinkGraph(artifactRoot, expectedAbsentRoute) {
  const absoluteRoot = path.resolve(artifactRoot);
  if (!/^\/[a-z0-9][a-z0-9-]*\.html$/u.test(expectedAbsentRoute ?? "")) {
    throw new Error("expected absent route must be one exact lowercase root HTML route");
  }
  const absentFile = artifactPath(expectedAbsentRoute, absoluteRoot);
  try {
    await lstat(absentFile);
    throw new Error(`authorized removed route still exists: ${expectedAbsentRoute}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const files = await walkFiles(absoluteRoot);
  const htmlFiles = files.filter((file) => file.endsWith(".html"));
  let checkedReferences = 0;
  for (const file of htmlFiles) {
    const source = await readFile(path.join(absoluteRoot, file), "utf8");
    const sourceRoute = routeForArtifactFile(file);
    const base = new URL(sourceRoute, `${SITE_ORIGIN}/`);
    for (const match of source.matchAll(/\b(?:href|src)=["']([^"'<>]+)["']/giu)) {
      const reference = match[1].trim();
      if (!reference || /^(?:data|mailto|tel):/iu.test(reference)) continue;
      const resolved = new URL(reference, base);
      if (resolved.origin !== SITE_ORIGIN) continue;
      if (resolved.pathname === expectedAbsentRoute) {
        throw new Error(`${file} still references authorized removed route ${expectedAbsentRoute}`);
      }
      const target = artifactPath(resolved.pathname, absoluteRoot);
      if (!target) throw new Error(`${file} contains an escaping internal reference ${reference}`);
      await requireRegularFile(target, `${file} internal reference ${reference}`);
      if (resolved.hash && path.extname(target).toLowerCase() === ".html") {
        const fragment = decodeURIComponent(resolved.hash.slice(1));
        const targetSource = await readFile(target, "utf8");
        const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        if (!new RegExp(`\\b(?:id|name)=["']${escaped}["']`, "u").test(targetSource)) {
          throw new Error(`${file} internal fragment does not exist: ${reference}`);
        }
      }
      checkedReferences += 1;
    }
  }
  return Object.freeze({
    checkedReferences,
    files: files.length,
    htmlFiles: htmlFiles.length,
  });
}

export async function auditArtifactFromSitemap(artifactRoot, expectedAbsentRoute) {
  const absoluteRoot = path.resolve(artifactRoot);
  const routes = await routesFromArtifactSitemap(absoluteRoot);
  const linkGraph = expectedAbsentRoute
    ? await verifyArtifactLinkGraph(absoluteRoot, expectedAbsentRoute)
    : null;
  if (expectedAbsentRoute && routes.includes(expectedAbsentRoute)) {
    throw new Error(`artifact sitemap still contains authorized removed route ${expectedAbsentRoute}`);
  }
  const result = await auditBrowser({
    artifactRoot: absoluteRoot,
    profile: "generic",
    routes,
  });
  if (result.errors.length) {
    throw new Error(result.errors.join("\n"));
  }
  return Object.freeze({ linkGraph, routes, viewCount: result.results.length });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const artifactRoot = process.argv[2];
    const expectedAbsentRoute = process.argv[3];
    if (!artifactRoot) throw new Error("artifact root is required");
    const result = await auditArtifactFromSitemap(artifactRoot, expectedAbsentRoute);
    console.log(
      `Control-owned browser audit passed: ${result.routes.length} sitemap routes, `
      + `${result.viewCount} route/view combinations, exact ${REVIEWED_CHROMIUM.version}`
      + `${expectedAbsentRoute
        ? `; ${expectedAbsentRoute} absent and ${result.linkGraph.checkedReferences} internal references coherent`
        : ""}.`,
    );
  } catch (error) {
    console.error(`audit-artifact-from-sitemap: ${error.message}`);
    process.exitCode = 1;
  }
}
