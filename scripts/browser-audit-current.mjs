#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHostedArtifact } from "./build-hosted.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACT_ROOT = path.join(ROOT, "_hosted");
const EXPECTED_BROWSER =
  "Google Chrome for Testing 149.0.7827.55";
const BROWSER_CANDIDATES = Object.freeze([
  process.env.SITESOURCERY_CHROMIUM,
  "/private/tmp/sitesourcery-chrome-149.0.7827.55-mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  "/home/simtech/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
  "/home/simtech/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell",
].filter(Boolean));
const VIEWPORTS = Object.freeze([
  Object.freeze({ label: "phone-320", width: 320, height: 720, mobile: true }),
  Object.freeze({ label: "phone-390", width: 390, height: 844, mobile: true }),
  Object.freeze({ label: "desktop", width: 1440, height: 1000, mobile: false }),
]);
const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
});

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function browserPath() {
  const failures = [];
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await access(candidate);
      const result = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        timeout: 5000,
      });
      const observed = String(result.stdout ?? "").trim();
      if (result.status === 0 && observed === EXPECTED_BROWSER) {
        return candidate;
      }
      failures.push(`${candidate}: ${observed || "no version"}`);
    } catch {
      failures.push(`${candidate}: unavailable`);
    }
  }
  throw new Error(
    `No exact reviewed browser was found. Expected ${EXPECTED_BROWSER}. `
      + failures.join("; "),
  );
}

async function freePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port =
    address && typeof address === "object"
      ? address.port
      : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function json(response, status, payload) {
  const bytes = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": bytes.byteLength,
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": "current-browser-audit",
  });
  response.end(bytes);
}

function safeArtifactPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.endsWith("/")
    ? `${decoded.replace(/^\/+/, "")}index.html`
    : decoded.replace(/^\/+/, "");
  if (!relative || relative.includes("\0")) return null;
  const normalized = path.posix.normalize(relative);
  if (
    normalized !== relative
    || normalized === ".."
    || normalized.startsWith("../")
  ) return null;
  const resolved = path.resolve(ARTIFACT_ROOT, normalized);
  const rootPrefix = `${path.resolve(ARTIFACT_ROOT)}${path.sep}`;
  return resolved.startsWith(rootPrefix) ? resolved : null;
}

async function startServer() {
  const apiRequests = [];
  const missingFiles = [];
  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/v1/")) {
      apiRequests.push({
        method: request.method || "GET",
        pathname: url.pathname,
      });
      if (request.method === "GET" && url.pathname === "/api/v1/me") {
        json(response, 200, { user: null });
        return;
      }
      if (
        request.method === "GET"
        && url.pathname === "/api/v1/capabilities"
      ) {
        json(response, 200, {
          accountRegistration: false,
          accountRecoveryEmail: false,
          downloadQuote: false,
          downloadPayment: false,
          domainPurchase: false,
          publishing: false,
        });
        return;
      }
      json(response, 404, {
        code: "NOT_FOUND",
        message: "The browser audit does not simulate this API route.",
      });
      return;
    }

    const file = safeArtifactPath(url.pathname);
    if (!file) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Bad request");
      return;
    }
    try {
      const bytes = await readFile(file);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": bytes.byteLength,
        "Content-Type":
          CONTENT_TYPES[path.extname(file).toLowerCase()]
          ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(bytes);
    } catch {
      missingFiles.push(url.pathname);
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port =
    address && typeof address === "object"
      ? address.port
      : 0;
  return Object.freeze({
    apiRequests,
    missingFiles,
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => server.close(resolve)),
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
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.error) {
          request.reject(
            new Error(`${request.method}: ${message.error.message}`),
          );
        } else {
          request.resolve(message.result);
        }
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) {
        listener(message.params ?? {});
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.sequence;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { method, reject, resolve });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.socket.close();
  }
}

async function pageSocket(port, state) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (state.exited) {
      throw new Error(
        `Reviewed browser exited before CDP opened: ${state.stderr}`,
      );
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/json/list`,
      );
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(
          (target) =>
            target.type === "page"
            && target.webSocketDebuggerUrl,
        );
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      // Browser is still starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out opening reviewed browser: ${state.stderr}`);
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || "Browser evaluation failed.",
    );
  }
  return result.result?.value;
}

async function waitFor(cdp, expression, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, `Boolean(${expression})`)) return;
    } catch {
      // Navigation can briefly destroy the execution context.
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: viewport.mobile,
    maxTouchPoints: viewport.mobile ? 5 : 1,
  });
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitFor(
    cdp,
    `document.readyState === "complete" && location.href === ${JSON.stringify(url)}`,
  );
  await evaluate(
    cdp,
    `(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const step = Math.max(500, innerHeight - 80);
      for (let y = 0; y < height; y += step) {
        scrollTo(0, y);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 150));
      return true;
    })()`,
    true,
  );
}

async function openHostedAccount(cdp) {
  const hasButton = await evaluate(
    cdp,
    `Boolean(document.querySelector("[data-open-account]"))`,
  );
  if (!hasButton) return;
  await waitFor(
    cdp,
    `document.documentElement.getAttribute("data-abracadabra-control-ready") === "hosted"`,
  );
  await evaluate(
    cdp,
    `document.querySelector("[data-open-account]").click()`,
  );
  await waitFor(cdp, `document.getElementById("control-room").hidden === false`);
}

async function inspect(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return !element.hidden
          && style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) > 0
          && rect.width > 0
          && rect.height > 0;
      };
      const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const scrollWidth = Math.max(
        document.body.scrollWidth,
        document.documentElement.scrollWidth
      );
      const overflow = [...document.body.querySelectorAll("*")]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            selector: element.id
              ? "#" + element.id
              : element.tagName.toLowerCase() + (element.classList.length ? "." + [...element.classList].slice(0, 2).join(".") : ""),
            left: Math.round(rect.left * 10) / 10,
            right: Math.round(rect.right * 10) / 10,
            text: clean(element.textContent).slice(0, 60),
          };
        })
        .filter((entry) => entry.left < -1 || entry.right > innerWidth + 1)
        .slice(0, 12);
      const accountFields = [...document.querySelectorAll(
        '#control-room input:not([type="hidden"]), #control-room button'
      )].filter(visible).map((element) => ({
        label: element.getAttribute("name") || clean(element.textContent) || element.type,
        height: Math.round(element.getBoundingClientRect().height * 10) / 10,
      }));
      return {
        path: location.pathname,
        title: document.title,
        lang: document.documentElement.lang,
        canonical: document.querySelector('link[rel="canonical"]')?.href || "",
        main: Boolean(document.querySelector("main")),
        mainTextLength: clean(document.querySelector("main")?.innerText).length,
        h1: [...document.querySelectorAll("h1")].map((node) => clean(node.textContent)),
        viewportWidth: innerWidth,
        scrollWidth,
        overflow,
        brokenImages: [...document.images]
          .filter((image) => image.complete && image.naturalWidth === 0)
          .map((image) => image.getAttribute("src")),
        app: location.pathname === "/abracadabra/app/" ? {
          mode: document.querySelector('meta[name="sitesourcery-abracadabra-control-mode"]')?.content || "",
          controlReady: document.documentElement.getAttribute("data-abracadabra-control-ready"),
          controlVisible: document.getElementById("control-room")?.hidden === false,
          stages: [...document.querySelectorAll("[data-customer-stage]")].map((node) => node.getAttribute("data-customer-stage")),
          prototypeGlobal: typeof globalThis.SiteSourceryAccount !== "undefined",
          prototypeScripts: [...document.scripts]
            .map((script) => script.getAttribute("src") || "")
            .filter((src) => /abracadabra-(?:account|paid-download)\\.js$/.test(src)),
          directStripeLinks: document.querySelectorAll('a[href^="https://buy.stripe.com/"]').length,
          accountFields,
        } : null,
      };
    })()`,
  );
}

function snapshotFailures(snapshot, route, viewport) {
  const failures = [];
  const label = `${viewport.label} ${route}`;
  if (snapshot.path !== route) {
    failures.push(`${label}: landed on ${snapshot.path}`);
  }
  if (!snapshot.title) failures.push(`${label}: document title is empty`);
  if (snapshot.lang !== "en") failures.push(`${label}: html lang is not en`);
  if (!snapshot.main || snapshot.mainTextLength < 20) {
    failures.push(`${label}: main content is missing or empty`);
  }
  if (snapshot.h1.length !== 1 || !snapshot.h1[0]) {
    failures.push(`${label}: expected one nonempty h1, found ${snapshot.h1.length}`);
  }
  if (snapshot.scrollWidth !== snapshot.viewportWidth) {
    failures.push(
      `${label}: horizontal overflow ${snapshot.scrollWidth}px > ${snapshot.viewportWidth}px `
      + JSON.stringify(snapshot.overflow),
    );
  }
  if (snapshot.brokenImages.length) {
    failures.push(`${label}: broken images ${JSON.stringify(snapshot.brokenImages)}`);
  }
  if (!snapshot.canonical.startsWith("https://sitesourcery.com/")) {
    failures.push(`${label}: canonical is ${JSON.stringify(snapshot.canonical)}`);
  }
  if (snapshot.app) {
    if (snapshot.app.mode !== "hosted") {
      failures.push(`${label}: hosted control mode is ${JSON.stringify(snapshot.app.mode)}`);
    }
    if (
      snapshot.app.controlReady !== "hosted"
      || !snapshot.app.controlVisible
    ) {
      failures.push(`${label}: hosted account room did not become ready and visible`);
    }
    if (
      JSON.stringify(snapshot.app.stages)
      !== JSON.stringify(["account", "project", "quote", "download"])
    ) {
      failures.push(`${label}: customer stages are ${JSON.stringify(snapshot.app.stages)}`);
    }
    if (
      snapshot.app.prototypeGlobal
      || snapshot.app.prototypeScripts.length
      || snapshot.app.directStripeLinks
    ) {
      failures.push(`${label}: browser-only account or direct Stripe bridge leaked into hosted mode`);
    }
    const shortFields = snapshot.app.accountFields.filter(
      (field) => field.height < 44,
    );
    if (shortFields.length) {
      failures.push(`${label}: visible account controls below 44px ${JSON.stringify(shortFields)}`);
    }
  }
  return failures;
}

async function makerJourney(cdp, origin) {
  await cdp.send("Storage.clearDataForOrigin", {
    origin,
    storageTypes: "all",
  });
  await setViewport(cdp, VIEWPORTS[1]);
  await navigate(cdp, `${origin}/abracadabra/app/`);
  await waitFor(cdp, `document.getElementById("spark-maker")?.inert === false`);
  await evaluate(
    cdp,
    `(() => {
      const setValue = (name, value) => {
        const field = document.querySelector('[name="' + name + '"]');
        const prototype = field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : field instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      };
      document.querySelector('[data-next="facts"]').click();
      setValue("businessName", "Browser Audit Workshop");
      setValue("summary", "Repairs practical equipment for nearby small businesses.");
      setValue("about", "Owner-operated and available by appointment.");
      setValue("email", "owner@example.test");
      document.querySelector('[data-next="truth"]').click();
      return true;
    })()`,
  );
  await waitFor(cdp, `document.querySelector('[data-step="truth"]').hidden === false`);
  await evaluate(
    cdp,
    `(() => {
      const checkbox = document.getElementById("truth-confirmed");
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("make-preview").click();
      return true;
    })()`,
  );
  await waitFor(
    cdp,
    `document.querySelector('[data-step="preview"]').hidden === false
      && document.getElementById("spark-preview").getAttribute("src")?.startsWith("blob:")`,
  );
  await evaluate(cdp, `document.querySelector("[data-save-direction]").click()`);
  await waitFor(cdp, `document.getElementById("control-room").hidden === false`);
  return evaluate(
    cdp,
    `(() => ({
      currentStep: document.getElementById("spark-maker").getAttribute("data-current-step"),
      previewSource: document.getElementById("spark-preview").getAttribute("src"),
      openEnabled: !document.getElementById("open-version").disabled,
      controlReady: document.documentElement.getAttribute("data-abracadabra-control-ready"),
      accountStageVisible: document.querySelector('[data-customer-stage="account"]').hidden === false,
      status: document.getElementById("platform-status").textContent.trim(),
    }))()`,
  );
}

await buildHostedArtifact({ root: ROOT });
const browser = await browserPath();
const server = await startServer();
const profile = await mkdtemp(
  path.join(os.tmpdir(), "sitesourcery-current-browser-"),
);
const port = await freePort();
const processState = { exited: false, stderr: "" };
const child = spawn(browser, [
  "--headless",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-sync",
  "--metrics-recording-only",
  "--no-default-browser-check",
  "--no-first-run",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  processState.stderr += chunk;
});
child.once("exit", () => {
  processState.exited = true;
});

let cdp;
const failures = [];
const browserErrors = [];
try {
  cdp = new Cdp(await pageSocket(port, processState));
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    browserErrors.push(
      exceptionDetails?.exception?.description
      || exceptionDetails?.text
      || "Unknown browser exception",
    );
  });
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (entry?.level === "error") {
      browserErrors.push(entry.text || "Unknown browser log error");
    }
  });
  await Promise.all([
    cdp.send("Page.enable"),
    cdp.send("Runtime.enable"),
    cdp.send("Log.enable"),
    cdp.send("Network.enable"),
  ]);

  const sitemap = await readFile(
    path.join(ARTIFACT_ROOT, "sitemap.xml"),
    "utf8",
  );
  const routes = [
    ...new Set([
      ...[...sitemap.matchAll(/<loc>https:\/\/sitesourcery\.com([^<]*)<\/loc>/gu)]
        .map((match) => match[1]),
      "/abracadabra/app/",
    ]),
  ];

  for (const viewport of VIEWPORTS) {
    await setViewport(cdp, viewport);
    for (const route of routes) {
      if (route === "/abracadabra/app/") {
        await cdp.send("Storage.clearDataForOrigin", {
          origin: server.origin,
          storageTypes: "all",
        });
      }
      await navigate(cdp, new URL(route, server.origin).href);
      if (route === "/abracadabra/app/") await openHostedAccount(cdp);
      failures.push(
        ...snapshotFailures(
          await inspect(cdp),
          route,
          viewport,
        ),
      );
    }
  }

  await setViewport(cdp, VIEWPORTS[1]);
  await navigate(cdp, `${server.origin}/`);
  const menu = await evaluate(
    cdp,
    `(() => {
      const button = document.querySelector("[data-menu-button]");
      button.click();
      const nav = document.querySelector("[data-menu]");
      const style = getComputedStyle(nav);
      const open = {
        expanded: button.getAttribute("aria-expanded"),
        visible: style.display !== "none" && style.visibility !== "hidden" && nav.getBoundingClientRect().height > 0,
      };
      button.click();
      return { ...open, closed: button.getAttribute("aria-expanded") };
    })()`,
  );
  if (
    menu.expanded !== "true"
    || !menu.visible
    || menu.closed !== "false"
  ) {
    failures.push(`phone menu did not open and close: ${JSON.stringify(menu)}`);
  }

  const journey = await makerJourney(cdp, server.origin);
  if (
    journey.currentStep !== "preview"
    || !String(journey.previewSource).startsWith("blob:")
    || !journey.openEnabled
    || journey.controlReady !== "hosted"
    || !journey.accountStageVisible
  ) {
    failures.push(`four-step maker journey failed: ${JSON.stringify(journey)}`);
  }

  if (server.missingFiles.length) {
    failures.push(
      `artifact requested missing files: ${JSON.stringify([...new Set(server.missingFiles)])}`,
    );
  }
  const writes = server.apiRequests.filter(
    ({ method }) => method !== "GET" && method !== "HEAD",
  );
  if (writes.length) {
    failures.push(
      `guest browser audit made unexpected API writes: ${JSON.stringify(writes)}`,
    );
  }
  if (browserErrors.length) {
    failures.push(
      `browser errors: ${JSON.stringify([...new Set(browserErrors)])}`,
    );
  }

  if (failures.length) {
    throw new Error(
      `Current browser audit failed (${failures.length}):\n- ${failures.join("\n- ")}`,
    );
  }
  console.log(
    `Current browser audit passed: ${routes.length} hosted routes × ${VIEWPORTS.length} viewports, `
      + "exact-width layout, four-stage account room, mobile menu, and a complete four-step maker preview.",
  );
} finally {
  if (cdp) cdp.close();
  await server.close();
  if (!processState.exited) child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2000),
  ]);
  if (!processState.exited) child.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
