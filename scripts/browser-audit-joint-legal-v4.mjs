#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";

const EXPECTED_BROWSER = "Google Chrome for Testing 149.0.7827.55";
const VIEWPORTS = Object.freeze([
  Object.freeze({ label: "phone-320", width: 320, height: 720, mobile: true }),
  Object.freeze({ label: "phone-390", width: 390, height: 844, mobile: true }),
  Object.freeze({ label: "desktop-1440", width: 1440, height: 1000, mobile: false }),
]);
const ROUTES = Object.freeze([
  Object.freeze({ label: "legal-center", path: "/legal/" }),
  Object.freeze({ label: "privacy-v4", path: "/legal/privacy/" }),
  Object.freeze({ label: "website-terms-v4", path: "/legal/website-terms/" }),
]);
const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
});
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--finalized-artifact-root") {
    throw new Error("usage: browser-audit-joint-legal-v4.mjs --finalized-artifact-root /absolute/path");
  }
  if (!path.isAbsolute(argv[1])) throw new Error("finalized artifact root must be absolute");
  return path.normalize(argv[1]);
}

async function browserPath() {
  const candidates = [
    process.env.SITESOURCERY_CHROMIUM,
    "/private/tmp/sitesourcery-chrome-149.0.7827.55-mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  ].filter(Boolean);
  const failures = [];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      const result = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 5000 });
      const observed = String(result.stdout ?? "").trim();
      if (result.status === 0 && observed === EXPECTED_BROWSER) return candidate;
      failures.push(`${candidate}: ${observed || "no version"}`);
    } catch {
      failures.push(`${candidate}: unavailable`);
    }
  }
  throw new Error(`exact reviewed browser unavailable: ${failures.join("; ")}`);
}

async function freePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function safeFile(hostedRoot, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const relative = decoded.endsWith("/")
    ? `${decoded.replace(/^\/+/, "")}index.html`
    : decoded.replace(/^\/+/, "");
  if (!relative || relative.includes("\0")) return null;
  const normalized = path.posix.normalize(relative);
  if (normalized !== relative || normalized.startsWith("../")) return null;
  const result = path.resolve(hostedRoot, normalized);
  return result.startsWith(`${path.resolve(hostedRoot)}${path.sep}`) ? result : null;
}

async function startServer(hostedRoot) {
  const missing = [];
  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const file = safeFile(hostedRoot, url.pathname);
    if (!file) {
      response.writeHead(400).end("Bad request");
      return;
    }
    try {
      const bytes = await readFile(file);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": bytes.byteLength,
        "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(bytes);
    } catch {
      missing.push(url.pathname);
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return Object.freeze({
    origin: `http://127.0.0.1:${address.port}`,
    missing,
    close: () => new Promise((resolve) => server.close(resolve)),
  });
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.sequence;
    const response = new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() { this.socket.close(); }
}

async function pageSocket(port, state) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (state.exited) throw new Error(`browser exited before CDP opened: ${state.stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {}
    await delay(100);
  }
  throw new Error(`timed out opening reviewed browser: ${state.stderr}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function waitFor(cdp, expression) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try { if (await evaluate(cdp, `Boolean(${expression})`)) return; } catch {}
    await delay(50);
  }
  throw new Error(`timed out waiting for ${expression}`);
}

async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width, height: viewport.height, deviceScaleFactor: 1,
    mobile: viewport.mobile, screenWidth: viewport.width, screenHeight: viewport.height,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: viewport.mobile, maxTouchPoints: viewport.mobile ? 5 : 1,
  });
}

const finalizedRoot = parseArguments(process.argv.slice(2));
const hostedRoot = path.join(finalizedRoot, "hosted");
const [rootState, hostedState, realRoot, realHosted] = await Promise.all([
  lstat(finalizedRoot), lstat(hostedRoot), realpath(finalizedRoot), realpath(hostedRoot),
]);
assert.ok(rootState.isDirectory() && !rootState.isSymbolicLink());
assert.ok(hostedState.isDirectory() && !hostedState.isSymbolicLink());
assert.equal(path.dirname(realHosted), realRoot);
const receiptBytes = await readFile(
  path.join(finalizedRoot, "joint-legal-v4-release-constants.json"),
);
const receipt = JSON.parse(receiptBytes);
assert.equal(receipt.schema, "sitesourcery.hosted-joint-legal-v4-finalization/v1");
assert.equal(receipt.published, false);
assert.equal(receipt.integrationRequired, true);
assert.match(receipt.authorityDigest, /^[a-f0-9]{64}$/u);
assert.ok(Array.isArray(receipt.artifacts) && receipt.artifacts.length === 5);
for (const artifact of receipt.artifacts) {
  const bytes = await readFile(path.join(finalizedRoot, artifact.file));
  assert.equal(bytes.byteLength, artifact.byteCount);
  assert.equal(sha256(bytes), artifact.sha256);
}

const browser = await browserPath();
const server = await startServer(hostedRoot);
const profile = await import("node:fs/promises").then(({ mkdtemp }) =>
  mkdtemp(path.join(os.tmpdir(), "sitesourcery-joint-v4-browser-")));
const port = await freePort();
const state = { exited: false, stderr: "" };
const child = spawn(browser, [
  "--headless", "--disable-background-networking", "--disable-component-update",
  "--disable-default-apps", "--disable-extensions", "--disable-sync",
  "--metrics-recording-only", "--no-default-browser-check", "--no-first-run",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { state.stderr += chunk; });
child.once("exit", () => { state.exited = true; });

let cdp;
try {
  cdp = new Cdp(await pageSocket(port, state));
  const requests = [];
  const responses = [];
  const browserErrors = [];
  cdp.on("Network.requestWillBeSent", ({ request }) => requests.push(request?.url ?? ""));
  cdp.on("Network.responseReceived", ({ response }) => responses.push({
    url: response?.url ?? "", status: response?.status ?? 0,
  }));
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    browserErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || "exception");
  });
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (entry?.level === "error") browserErrors.push(entry.text || "browser log error");
  });
  await Promise.all([
    cdp.send("Page.enable"), cdp.send("Runtime.enable"),
    cdp.send("Log.enable"), cdp.send("Network.enable"),
  ]);

  const proofRoot = path.join(finalizedRoot, "browser-proof");
  await mkdir(proofRoot, { recursive: false });
  const snapshots = [];
  for (const viewport of VIEWPORTS) {
    await setViewport(cdp, viewport);
    for (const route of ROUTES) {
      const url = `${server.origin}${route.path}`;
      await cdp.send("Page.navigate", { url });
      await waitFor(cdp, `document.readyState === "complete" && location.href === ${JSON.stringify(url)}`);
      const snapshot = await evaluate(cdp, `(() => {
        const main = document.querySelector("main");
        const h1 = document.querySelector("h1");
        const text = document.body.innerText;
        return {
          title: document.title,
          viewportWidth: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          mainVisible: Boolean(main && main.getBoundingClientRect().width > 0),
          h1Visible: Boolean(h1 && h1.getBoundingClientRect().height > 0),
          detailsCount: document.querySelectorAll("details.legal-topic").length,
          hasUnsealed: /unsealed|not effective|joint legal review|content-template/i.test(text)
            || Boolean(document.querySelector('meta[name="robots"][content*="noindex"]')),
          activeScope: text.includes("$5") && text.includes("$200") && text.includes("Custom"),
          heldScope: text.includes("Alakazam") && text.includes("held")
            && text.includes("Responder"),
        };
      })()`);
      assert.equal(snapshot.viewportWidth, viewport.width);
      assert.ok(snapshot.scrollWidth <= snapshot.viewportWidth);
      assert.equal(snapshot.mainVisible, true);
      assert.equal(snapshot.h1Visible, true);
      assert.equal(snapshot.hasUnsealed, false);
      assert.equal(snapshot.activeScope, true);
      assert.equal(snapshot.heldScope, true);
      if (route.path !== "/legal/") assert.ok(snapshot.detailsCount >= 10);
      const capture = await cdp.send("Page.captureScreenshot", {
        format: "png", captureBeyondViewport: true, fromSurface: true,
      });
      const screenshot = `${route.label}-${viewport.label}.png`;
      const screenshotBytes = Buffer.from(capture.data, "base64");
      await writeFile(path.join(proofRoot, screenshot), screenshotBytes);
      snapshots.push({
        route: route.path,
        viewport: viewport.label,
        screenshot,
        screenshotSha256: sha256(screenshotBytes),
        screenshotByteCount: screenshotBytes.byteLength,
        ...snapshot,
      });
    }
  }
  assert.deepEqual(server.missing, []);
  assert.deepEqual(browserErrors, []);
  for (const url of requests.filter((value) => /^https?:/u.test(value))) {
    assert.equal(new URL(url).origin, server.origin, `unexpected network origin: ${url}`);
  }
  for (const response of responses.filter(({ url }) => url.startsWith(server.origin))) {
    assert.ok(response.status >= 200 && response.status < 400, `failed browser response: ${JSON.stringify(response)}`);
  }
  const proof = {
    schema: "sitesourcery.joint-legal-v4-browser-proof/v1",
    browser: EXPECTED_BROWSER,
    finalizedReceiptSchema: receipt.schema,
    finalizedReceiptSha256: sha256(receiptBytes),
    effectiveAt: receipt.effectiveAt,
    authorityDigest: receipt.authorityDigest,
    artifacts: receipt.artifacts.map(
      ({ role, file, sha256: artifactSha256, byteCount }) => ({
        role, file, sha256: artifactSha256, byteCount,
      }),
    ),
    productionAuthority: false,
    productionTupleBound: true,
    viewports: VIEWPORTS,
    routes: ROUTES.map(({ path: route }) => route),
    network: { onlyLoopbackOrigin: true, missingFiles: [], responseFailures: [] },
    snapshots,
  };
  await writeFile(path.join(proofRoot, "browser-proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
  console.log(`Joint legal V4 browser audit passed: ${ROUTES.length} routes × ${VIEWPORTS.length} viewports; loopback-only network; 9 screenshots.`);
} finally {
  if (cdp) cdp.close();
  await server.close();
  if (!state.exited) child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2000)]);
  if (!state.exited) child.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
