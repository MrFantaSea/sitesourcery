import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(scriptDirectory);
const source = path.join(scriptDirectory, "assets", "sitesourcery-og-source.svg");
const output = path.join(root, "og.png");
const renderOutput = path.join(root, `.og.rendered-${process.pid}.png`);
const optimizedOutput = path.join(root, `.og.optimized-${process.pid}.png`);
const defaultChromium = "/home/simtech/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell";
const chromium = process.env.SITESOURCERY_CHROMIUM_PATH || defaultChromium;

if (!existsSync(chromium)) {
  throw new Error("Pinned Chromium is unavailable; set SITESOURCERY_CHROMIUM_PATH to an exact reviewed binary");
}

const result = spawnSync(chromium, [
  "--headless",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-gpu",
  "--disable-sync",
  "--no-sandbox",
  "--no-default-browser-check",
  "--no-first-run",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--window-size=1200,630",
  `--screenshot=${renderOutput}`,
  `file://${source}`,
], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (result.status !== 0) {
  rmSync(renderOutput, { force: true });
  throw new Error(`Chromium social-card render failed with exit ${result.status}: ${result.stderr.trim()}`);
}

try {
  await sharp(renderOutput).png({
    compressionLevel: 9,
    adaptiveFiltering: true,
    effort: 10,
    palette: true,
    quality: 100,
    colours: 256,
    dither: 1,
  }).toFile(optimizedOutput);
  const png = readFileSync(optimizedOutput);
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Rendered social card is not a PNG");
  }
  if (png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) {
    throw new Error(`Rendered social card has unexpected dimensions ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
  }
  renameSync(optimizedOutput, output);
  console.log(`Generated og.png ${createHash("sha256").update(png).digest("hex")} (${png.length} bytes)`);
} finally {
  rmSync(renderOutput, { force: true });
  rmSync(optimizedOutput, { force: true });
}
