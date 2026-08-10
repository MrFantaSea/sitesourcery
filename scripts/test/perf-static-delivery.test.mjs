import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { publicFileAllowlist } from "../build-pages.mjs";
import {
  DOMAIN_HERO_ASSETS,
  DOMAIN_HERO_SOURCE_SHA256,
} from "../generate-domain-hero-assets.mjs";
import {
  OG_PNG_SHA256,
  REVIEWED_PUBLIC_ARTIFACT_PATHS,
  validateReviewedOgAssets,
} from "../verify-public-truth-release.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ORIGINAL_HERO = "assets/site-sourcery-main-street-v2.webp";
const HERO_ALT = "A richly lit magical storefront used as a Site Sourcery visual-direction study.";
const OG_ALT = "Site Sourcery social card reading ‘Your source for websites’ over a purple-lit website workshop.";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function metadataContent(html, attribute, value) {
  const expression = new RegExp(`<meta ${attribute}="${value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}" content="([^"]+)">`, "u");
  return html.match(expression)?.[1] ?? null;
}

function jsonLd(html) {
  const source = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/u)?.[1];
  assert.ok(source, "JSON-LD block is required");
  return JSON.parse(source);
}

test("responsive domain hero assets are exact, bounded source derivatives", async () => {
  assert.equal(DOMAIN_HERO_ASSETS.length, 15);
  assert.equal(new Set(DOMAIN_HERO_ASSETS.map(({ file }) => file)).size, 15);
  assert.deepEqual(
    Object.fromEntries(["avif", "jpg", "webp"].map((format) => [
      format,
      DOMAIN_HERO_ASSETS.filter((asset) => asset.format === format).length,
    ])),
    { avif: 5, jpg: 5, webp: 5 },
  );
  const originalBytes = await readFile(path.join(ROOT, ORIGINAL_HERO));
  assert.equal(originalBytes.length, 616_960);
  assert.equal(sha256(originalBytes), DOMAIN_HERO_SOURCE_SHA256);
  let responsiveBytes = 0;
  for (const asset of DOMAIN_HERO_ASSETS) {
    const file = path.join(ROOT, "assets", asset.file);
    const [bytes, image] = await Promise.all([readFile(file), sharp(file).metadata()]);
    responsiveBytes += bytes.length;
    assert.ok(bytes.length < originalBytes.length, `${asset.file} must be smaller than the original`);
    assert.ok(bytes.length <= 320_000, `${asset.file} exceeds its static-delivery ceiling`);
    assert.equal(image.width, asset.width);
    assert.equal(image.height, asset.height);
    assert.equal(image.hasAlpha, false);
    assert.equal(image.format, asset.format === "avif" ? "heif" : asset.format === "jpg" ? "jpeg" : "webp");
  }
  assert.ok(responsiveBytes <= 1_950_000);
});

test("Domains uses responsive art direction and one eager high-priority LCP image", async () => {
  const [html, css] = await Promise.all([
    readFile(path.join(ROOT, "domains/index.html"), "utf8"),
    readFile(path.join(ROOT, "vnext.css"), "utf8"),
  ]);
  assert.doesNotMatch(html, /\/assets\/site-sourcery-main-street-v2\.webp/u);
  assert.doesNotMatch(css, /\/assets\/site-sourcery-main-street-v2\.webp/u);
  assert.equal((html.match(/<picture class="domain-hero-art">/gu) ?? []).length, 1);
  assert.equal((html.match(/<source media="\(max-width: 600px\)" type="image\/(?:avif|webp|jpeg)"/gu) ?? []).length, 3);
  assert.equal((html.match(/<source type="image\/(?:avif|webp)"/gu) ?? []).length, 2);
  assert.equal((html.match(/<link rel="preload" as="image"[^>]+type="image\/avif"[^>]+fetchpriority="high">/gu) ?? []).length, 2);
  assert.match(html, new RegExp(`<img[^>]+width="1672"[^>]+height="941"[^>]+alt="${HERO_ALT.replace(".", "\\.")}"[^>]+loading="eager"[^>]+decoding="async"[^>]+fetchpriority="high">`, "u"));
  for (const { file } of DOMAIN_HERO_ASSETS) assert.match(html, new RegExp(file.replaceAll(".", "\\."), "u"));
  assert.match(css, /\.domains-page \.domain-hero-art \{[\s\S]*position: fixed;[\s\S]*z-index: -3;[\s\S]*pointer-events: none;/u);
  assert.match(css, /\.domains-page \.domain-hero-art img \{[\s\S]*object-fit: cover;[\s\S]*object-position: center top;/u);
});

test("Domains and home metadata reuse only exact visible source facts", async () => {
  const [domains, home] = await Promise.all([
    readFile(path.join(ROOT, "domains/index.html"), "utf8"),
    readFile(path.join(ROOT, "index.html"), "utf8"),
  ]);
  const domainsTitle = domains.match(/<title>([^<]+)<\/title>/u)?.[1];
  const domainsDescription = metadataContent(domains, "name", "description");
  assert.equal(metadataContent(domains, "property", "og:title"), domainsTitle);
  assert.equal(metadataContent(domains, "property", "og:description"), domainsDescription);
  assert.equal(metadataContent(domains, "property", "og:image:width"), "1200");
  assert.equal(metadataContent(domains, "property", "og:image:height"), "630");
  assert.equal(metadataContent(domains, "property", "og:image:alt"), OG_ALT);
  assert.equal(metadataContent(domains, "name", "twitter:image:alt"), OG_ALT);
  assert.deepEqual(jsonLd(domains), {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: domainsTitle,
    description: domainsDescription,
    url: "https://sitesourcery.com/domains/",
    isPartOf: { "@type": "WebSite", name: "Site Sourcery", url: "https://sitesourcery.com/" },
  });
  assert.equal(metadataContent(home, "property", "og:image:alt"), OG_ALT);
  assert.equal(metadataContent(home, "name", "twitter:image:alt"), OG_ALT);
  const homeStructuredData = jsonLd(home);
  assert.equal(homeStructuredData["@type"], "WebSite");
  assert.equal(homeStructuredData.name, "Site Sourcery");
  assert.equal(homeStructuredData.url, "https://sitesourcery.com/");
  for (const structuredData of [jsonLd(domains), homeStructuredData]) {
    const source = JSON.stringify(structuredData);
    assert.doesNotMatch(source, /"(?:Offer|Product)"|priceCurrency|"price"/u);
  }
});

test("optimized OG and held artifact ledgers remain exact", async () => {
  const [source, png] = await Promise.all([
    readFile(path.join(ROOT, "scripts/assets/sitesourcery-og-source.svg")),
    readFile(path.join(ROOT, "og.png")),
  ]);
  const image = await sharp(png).metadata();
  assert.equal(png.length, 384_846);
  assert.ok(png.length < 976_066 * 0.4);
  assert.equal(sha256(png), OG_PNG_SHA256);
  assert.deepEqual(validateReviewedOgAssets(source, png), []);
  assert.equal(image.width, 1200);
  assert.equal(image.height, 630);
  assert.equal(image.isPalette, true);
  const reviewedAssets = DOMAIN_HERO_ASSETS.map(({ file }) => `assets/${file}`);
  for (const manifest of [publicFileAllowlist, REVIEWED_PUBLIC_ARTIFACT_PATHS]) {
    assert.equal(manifest.length, 90);
    assert.equal(manifest.includes(ORIGINAL_HERO), false);
    assert.deepEqual(manifest.filter((file) => reviewedAssets.includes(file)), reviewedAssets.toSorted());
  }
});
