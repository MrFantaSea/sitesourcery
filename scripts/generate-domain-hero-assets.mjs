#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const SOURCE = path.join(ROOT, "assets/site-sourcery-main-street-v2.webp");
export const DOMAIN_HERO_SOURCE_SHA256 = "5c3e35438fdfbd73e1f035a09c39ebe012a8b7708f61a4ef5adaedd39b19528a";

const FORMAT_OPTIONS = Object.freeze({
  avif: Object.freeze({ quality: 58, effort: 8, chromaSubsampling: "4:2:0" }),
  webp: Object.freeze({ quality: 78, effort: 6, smartSubsample: true }),
  jpg: Object.freeze({ quality: 82, mozjpeg: true, progressive: true, chromaSubsampling: "4:2:0" }),
});

export const DOMAIN_HERO_ASSETS = Object.freeze([
  ...[960, 1280, 1672].flatMap((width) => Object.keys(FORMAT_OPTIONS).map((format) => Object.freeze({
    file: `site-sourcery-main-street-v2-landscape-${width}.${format}`,
    format,
    width,
    height: width === 1672 ? 941 : Math.round(width * 941 / 1672),
    portrait: false,
  }))),
  ...[360, 529].flatMap((width) => Object.keys(FORMAT_OPTIONS).map((format) => Object.freeze({
    file: `site-sourcery-main-street-v2-portrait-${width}.${format}`,
    format,
    width,
    height: Math.round(width * 16 / 9),
    portrait: true,
  }))),
]);

async function assertTargetAbsent(target) {
  try {
    await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`refusing to overwrite domain hero asset ${target}`);
}

export async function generateDomainHeroAssets({ outputDirectory } = {}) {
  if (typeof outputDirectory !== "string" || outputDirectory === "") {
    throw new Error("an output directory is required");
  }
  const sourceBytes = await readFile(SOURCE);
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (sourceSha256 !== DOMAIN_HERO_SOURCE_SHA256) {
    throw new Error("domain hero source identity changed");
  }
  const destination = path.resolve(outputDirectory);
  await mkdir(destination, { recursive: true });
  const destinationState = await lstat(destination);
  if (!destinationState.isDirectory() || destinationState.isSymbolicLink()) {
    throw new Error("domain hero output must be one real directory");
  }
  for (const asset of DOMAIN_HERO_ASSETS) {
    const target = path.join(destination, asset.file);
    await assertTargetAbsent(target);
    let pipeline = asset.portrait
      ? sharp(sourceBytes).resize({ width: asset.width, height: asset.height, fit: "cover", position: "top" })
      : sharp(sourceBytes).resize({ width: asset.width, withoutEnlargement: true });
    pipeline = asset.format === "avif"
      ? pipeline.avif(FORMAT_OPTIONS.avif)
      : asset.format === "webp"
        ? pipeline.webp(FORMAT_OPTIONS.webp)
        : pipeline.jpeg(FORMAT_OPTIONS.jpg);
    await pipeline.toFile(target);
  }
  return DOMAIN_HERO_ASSETS;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4 || process.argv[2] !== "--output-dir") {
    throw new Error("usage: node scripts/generate-domain-hero-assets.mjs --output-dir <new-directory>");
  }
  const assets = await generateDomainHeroAssets({ outputDirectory: process.argv[3] });
  console.log(`Generated ${assets.length} domain hero assets in ${path.resolve(process.argv[3])}.`);
}
