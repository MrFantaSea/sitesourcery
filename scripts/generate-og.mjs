import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(scriptDirectory);
const source = path.join(scriptDirectory, "assets", "sitesourcery-og-source.svg");
const output = path.join(root, "og.png");
const temporaryOutput = path.join(root, ".og.generated.png");
const defaultChromium = "/home/simtech/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell";
const chromium = process.env.SITESOURCERY_CHROMIUM_PATH || defaultChromium;

if (!existsSync(chromium)) {
  throw new Error("Pinned Chromium is unavailable; set SITESOURCERY_CHROMIUM_PATH to an exact reviewed binary");
}

rmSync(temporaryOutput, { force: true });
const result = spawnSync(chromium, [
  "--headless",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--window-size=1200,630",
  `--screenshot=${temporaryOutput}`,
  `file://${source}`,
], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (result.status !== 0) {
  rmSync(temporaryOutput, { force: true });
  throw new Error(`Chromium social-card render failed with exit ${result.status}: ${result.stderr.trim()}`);
}

const png = readFileSync(temporaryOutput);
if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
  rmSync(temporaryOutput, { force: true });
  throw new Error("Rendered social card is not a PNG");
}
if (png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) {
  rmSync(temporaryOutput, { force: true });
  throw new Error(`Rendered social card has unexpected dimensions ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
}

renameSync(temporaryOutput, output);
console.log(`Generated og.png ${createHash("sha256").update(png).digest("hex")} (${png.length} bytes)`);
