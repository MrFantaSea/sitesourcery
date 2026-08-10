#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_ROOT = path.join(ROOT, "_site");
const BROWSER = process.env.SITESOURCERY_CHROMIUM ||
  "/private/tmp/sitesourcery-chrome-149.0.7827.55-mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const EXPECTED_BROWSER = "Google Chrome for Testing 149.0.7827.55";
const VIEWPORTS = Object.freeze([
  Object.freeze({ width: 320, height: 720, asset: "site-sourcery-main-street-v2-portrait-360.avif", ceiling: 30_837 }),
  Object.freeze({ width: 390, height: 844, asset: "site-sourcery-main-street-v2-portrait-529.avif", ceiling: 56_018 }),
  Object.freeze({ width: 1440, height: 1000, asset: "site-sourcery-main-street-v2-landscape-1672.avif", ceiling: 194_925 }),
]);
const MIME_TYPES = Object.freeze({
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
});
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function freePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.sequence;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  close() {
    this.socket.close();
  }
}

async function pageSocket(port, processState) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (processState.exited) throw new Error(`Browser exited early: ${processState.stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      await delay(100);
      continue;
    }
    await delay(100);
  }
  throw new Error(`Timed out opening browser: ${processState.stderr}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
  }
  return result.result?.value;
}

async function waitFor(cdp, expression) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      if (await evaluate(cdp, `Boolean(${expression})`)) return;
    } catch {
      await delay(50);
      continue;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

const version = spawnSync(BROWSER, ["--version"], { encoding: "utf8" });
if (version.status !== 0 || version.stdout.trim() !== EXPECTED_BROWSER) {
  throw new Error(`Expected ${EXPECTED_BROWSER}; received ${version.stdout.trim() || version.stderr.trim()}`);
}

const server = createServer(async (request, response) => {
  try {
    const requestPath = new URL(request.url, "http://127.0.0.1").pathname;
    const relative = requestPath === "/domains/" || requestPath === "/domains" ? "domains/index.html" : requestPath.replace(/^\//u, "");
    const target = path.resolve(ARTIFACT_ROOT, relative || "index.html");
    if (target !== ARTIFACT_ROOT && !target.startsWith(`${ARTIFACT_ROOT}${path.sep}`)) throw new Error("invalid artifact path");
    const bytes = await readFile(target);
    response.writeHead(200, {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": MIME_TYPES[path.extname(target)] || "application/octet-stream",
    });
    response.end(bytes);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-perf-static-browser-"));
const screenshots = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-perf-static-screenshots-"));
const port = await freePort();
const processState = { exited: false, stderr: "" };
const child = spawn(BROWSER, [
  "--headless",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-sync",
  "--no-default-browser-check",
  "--no-first-run",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { processState.stderr += chunk; });
child.once("exit", () => { processState.exited = true; });

let cdp;
const results = [];
try {
  const address = server.address();
  cdp = new Cdp(await pageSocket(port, processState));
  await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable")]);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "globalThis.__sitesourceryLcp=[];new PerformanceObserver((list)=>{for(const entry of list.getEntries()){globalThis.__sitesourceryLcp.push({duration:entry.duration,elementTag:entry.element?.tagName||null,url:entry.url||null,size:entry.size})}}).observe({type:'largest-contentful-paint',buffered:true});",
  });
  for (const viewport of VIEWPORTS) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 600,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
    });
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${address.port}/domains/` });
    await waitFor(cdp, "document.readyState === 'complete' && document.querySelector('.domain-hero-art img')?.complete");
    await delay(250);
    const result = await evaluate(cdp, `(() => {
      const image = document.querySelector('.domain-hero-art img');
      const resource = performance.getEntriesByType('resource').find((entry) => entry.name === image.currentSrc);
      const ids = Array.from(document.querySelectorAll('[id]'), (element) => element.id);
      const input = document.querySelector('#domain-name');
      const status = document.querySelector('#domain-status');
      return {
        width: innerWidth,
        height: innerHeight,
        horizontal: document.documentElement.scrollWidth <= innerWidth,
        currentSrc: image.currentSrc,
        imageComplete: image.complete && image.naturalWidth > 0,
        imageAlt: image.alt,
        imageLoading: image.loading,
        imageFetchPriority: image.fetchPriority,
        imageDecoding: image.decoding,
        pictureWidth: image.getBoundingClientRect().width,
        pictureHeight: image.getBoundingClientRect().height,
        resourceCount: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('site-sourcery-main-street-v2-')).length,
        encodedBodySize: resource?.encodedBodySize ?? 0,
        transferSize: resource?.transferSize ?? 0,
        deliveryType: resource?.deliveryType ?? null,
        resourceDuration: resource?.duration ?? 0,
        oneH1: document.querySelectorAll('h1').length === 1,
        mainFocusable: document.querySelector('main#main')?.getAttribute('tabindex') === '-1',
        skipLink: document.querySelector('.skip-link')?.getAttribute('href') === '#main',
        inputLabelled: document.querySelector('label[for="domain-name"]') !== null && input?.getAttribute('aria-describedby')?.includes('domain-status'),
        liveStatus: status?.getAttribute('role') === 'status' && status?.getAttribute('aria-live') === 'polite',
        duplicateIds: ids.length !== new Set(ids).size,
        lcp: globalThis.__sitesourceryLcp.at(-1) ?? null,
      };
    })()`);
    if (result.width !== viewport.width || result.height !== viewport.height) throw new Error(`viewport mismatch: ${JSON.stringify(result)}`);
    if (!result.currentSrc.endsWith(viewport.asset)) throw new Error(`responsive source mismatch: ${JSON.stringify(result)}`);
    if (!result.horizontal || !result.imageComplete || result.imageAlt !== "A richly lit magical storefront used as a Site Sourcery visual-direction study.") throw new Error(`visual contract failed: ${JSON.stringify(result)}`);
    if (result.imageLoading !== "eager" || result.imageFetchPriority !== "high" || result.imageDecoding !== "async") throw new Error(`LCP priority contract failed: ${JSON.stringify(result)}`);
    if (result.pictureWidth !== viewport.width || result.pictureHeight !== viewport.height) throw new Error(`hero sizing failed: ${JSON.stringify(result)}`);
    if (result.resourceCount !== 1 || result.encodedBodySize !== viewport.ceiling || (result.transferSize !== 0 && result.transferSize < result.encodedBodySize) || result.resourceDuration <= 0) throw new Error(`resource evidence failed: ${JSON.stringify(result)}`);
    if (!result.oneH1 || !result.mainFocusable || !result.skipLink || !result.inputLabelled || !result.liveStatus || result.duplicateIds) throw new Error(`accessibility contract failed: ${JSON.stringify(result)}`);
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const screenshotPath = path.join(screenshots, `domains-${viewport.width}x${viewport.height}.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
    results.push({ ...result, screenshot: screenshotPath });
  }
} finally {
  cdp?.close();
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2000)]);
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}

console.log(JSON.stringify({ browser: EXPECTED_BROWSER, screenshots, results }, null, 2));
console.log("PERF-01A browser audit passed: 3/3 viewports, exact AVIF selection, one image request, intrinsic/eager/high-priority behavior, no overflow, and accessibility structure.");
