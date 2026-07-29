#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_ROUTES } from "./check-routes.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_ARTIFACT_ROOT = path.join(SITE_ROOT, "_site");
export const REVIEWED_CHROMIUM = Object.freeze({
  version: "Google Chrome for Testing 149.0.7827.55",
  archiveUrl: "https://storage.googleapis.com/chrome-for-testing-public/149.0.7827.55/linux64/chrome-headless-shell-linux64.zip",
  archiveSha256: "410c9407d5de3fea80d9398666be06f2aa09154a3fa7b327dc254e336bb4c4b7",
});
const DEFAULT_CHROMIUM = [
  "/home/simtech/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
  "/home/simtech/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell",
];
const VIEWPORTS = Object.freeze([
  Object.freeze({ label: "phone-320", width: 320, height: 720, mobile: true, phone: true }),
  Object.freeze({ label: "phone-360", width: 360, height: 800, mobile: true, phone: true }),
  Object.freeze({ label: "phone-390", width: 390, height: 844, mobile: true, phone: true }),
  Object.freeze({
    label: "desktop-200pct-reflow",
    width: 720,
    height: 500,
    mobile: false,
    reflowEquivalent: "1440px display at 200% browser zoom",
  }),
  Object.freeze({ label: "tablet-768", width: 768, height: 1024, mobile: false }),
  Object.freeze({ label: "desktop", width: 1440, height: 1000, mobile: false }),
]);
const NO_SCRIPT_VIEWPORT = Object.freeze({
  label: "phone-390-no-script",
  width: 390,
  height: 844,
  mobile: true,
});
const REDUCED_MOTION_VIEWPORT = Object.freeze({
  label: "phone-390-reduced-motion",
  width: 390,
  height: 844,
  mobile: true,
});
const HIVE_COMPONENT_VIEWPORTS = Object.freeze([
  Object.freeze({ label: "hive-767", width: 767, height: 1024, mobile: false, componentRoute: "/hive/" }),
  Object.freeze({ label: "hive-768", width: 768, height: 1024, mobile: false, componentRoute: "/hive/" }),
  Object.freeze({ label: "hive-769", width: 769, height: 1024, mobile: false, componentRoute: "/hive/" }),
  Object.freeze({ label: "hive-landscape", width: 844, height: 390, mobile: false, componentRoute: "/hive/" }),
]);
export const HIVE_CUSTOMER_EXAMPLES = Object.freeze([
  Object.freeze({
    id: "missed-call",
    label: "Missed-call responder",
    result: "A missed call becomes a clear follow-up for your team, so the reason for calling is less likely to get lost.",
  }),
  Object.freeze({
    id: "booking",
    label: "Booking guide",
    result: "A customer gets the right booking questions, then a person or booking tool confirms the details.",
  }),
  Object.freeze({
    id: "review-request",
    label: "Review request",
    result: "An eligible customer gets one fair request for honest feedback after the job is complete.",
  }),
  Object.freeze({
    id: "after-hours",
    label: "After-hours information",
    result: "A customer gets approved basic information and a clear way to reach a person.",
  }),
  Object.freeze({
    id: "follow-up",
    label: "Follow-up",
    result: "A promised next step gets a due time and owner, so it is less likely to be forgotten.",
  }),
  Object.freeze({
    id: "getting-paid",
    label: "Getting-paid reminder",
    result: "An overdue invoice gets a clear, respectful reminder and an easy path to ask about a problem.",
  }),
]);
export const HIVE_CUSTOMER_FIELDS = Object.freeze([
  "human",
  "limit",
  "pause",
  "permission",
  "result",
  "when",
]);
export const HIVE_FORBIDDEN_PUBLIC_FIELDS = Object.freeze([
  "allowedActions",
  "dataConsentConcern",
  "fallbackHumanHandoff",
  "hardBoundary",
  "killSwitch",
  "problem",
  "trigger",
]);
export const HOME_FIRST_PAINT_VIEWPORTS = Object.freeze([
  Object.freeze({ label: "cold-phone-390", width: 390, height: 844, mobile: true }),
  Object.freeze({ label: "cold-desktop", width: 1440, height: 1000, mobile: false }),
]);
export const HOME_FIRST_PAINT_CHECKPOINTS = Object.freeze([
  Object.freeze({ atMs: 300, label: "early", minimumOpacity: 0.05 }),
  Object.freeze({ atMs: 1000, label: "complete", minimumOpacity: 0.98 }),
]);
export const HOME_FIRST_PAINT_SCENARIOS = Object.freeze([
  "baseline",
  "hero-image-held",
  "hero-image-blocked",
  "javascript-disabled",
  "forced-early-javascript-failure",
]);
const HOME_FIRST_PAINT_TIMING_TOLERANCE_MS = 250;
const HOME_HERO_IMAGE_PATTERN = "*site-sourcery-storm-atelier-v4.webp*";
const HOME_FORCED_FAILURE_SENTINEL = "SITESOURCERY_FORCED_EARLY_JAVASCRIPT_FAILURE";
export const PROGRESSIVE_FAILURE_VIEWPORT = Object.freeze({
  label: "phone-390-progressive-failure",
  width: 390,
  height: 844,
  mobile: true,
});
export const PROGRESSIVE_FAILURE_SCENARIOS = Object.freeze([
  Object.freeze({
    key: "after-root-js",
    failureStage: "root-js-class",
    menuReady: false,
    revealReady: false,
  }),
  Object.freeze({
    key: "during-menu-initializer",
    failureStage: "menu-listener",
    menuReady: false,
    revealReady: false,
  }),
  Object.freeze({
    key: "during-reveal-initializer",
    failureStage: "reveal-query",
    menuReady: true,
    revealReady: false,
  }),
]);
export const PROGRESSIVE_REVEAL_ROUTES = Object.freeze([
  "/",
  "/custom/",
  "/custom/scope/",
  "/custom/process/",
  "/abracadabra/",
  "/abracadabra/how/",
  "/hive/",
  "/solutions/",
  "/about/",
  "/start/",
]);
export const PROGRESSIVE_DISCLOSURE_COUNTS = Object.freeze({
  "/custom/scope/": 4,
  "/custom/process/": 3,
  "/abracadabra/how/": 7,
  "/about/": 1,
  "/contact/": 2,
  "/faq/": 13,
  "/solutions/": 9,
  "/legal/": 1,
  "/legal/privacy/": 16,
  "/legal/website-terms/": 17,
});
export const PRIMARY_NAV_CONTRACT = Object.freeze([
  Object.freeze({ label: "Websites", href: "/custom/", className: "" }),
  Object.freeze({ label: "Calls & follow-up", href: "/hive/", className: "" }),
  Object.freeze({ label: "Services", href: "/solutions/", className: "" }),
  Object.freeze({ label: "Examples", href: "/work/", className: "" }),
  Object.freeze({ label: "About", href: "/about/", className: "" }),
  Object.freeze({ label: "FAQ", href: "/faq/", className: "" }),
  Object.freeze({ label: "Contact", href: "/contact/", className: "nav-start" }),
  Object.freeze({
    label: "Call Zack: (856) 244-1220",
    href: "tel:+18562441220",
    className: "nav-call",
  }),
]);
const PROGRESSIVE_FAILURE_SENTINEL = "SITESOURCERY_PROGRESSIVE_FAILURE_AUDIT";
const ROUTE_TRANSFER_BUDGET_BYTES = 1024 * 1024;
const PRIVATE_VIEWER_POPUP_URL = "https://cta.invalid/abracadabra-popup-proof";
const PRIVATE_VIEWER_POPUP_TIMEOUT_MS = 5000;
const PRIVATE_VIEWER_ATTACHMENT_TIMEOUT_MS = 5000;
const PRIVATE_VIEWER_ATTACHMENT_POLL_MS = 25;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function primaryNavContractFailures(
  entries,
  route,
  {
    current = "required",
    visibility = "ignore",
  } = {},
) {
  const failures = [];
  if (!Array.isArray(entries)) return ["primary navigation entries are missing"];
  if (!["required", "absent", "ignore"].includes(current)) {
    return [`unknown primary navigation current mode ${JSON.stringify(current)}`];
  }
  if (!["all", "closed", "desktop", "ignore"].includes(visibility)) {
    return [`unknown primary navigation visibility mode ${JSON.stringify(visibility)}`];
  }
  if (entries.length !== PRIMARY_NAV_CONTRACT.length) {
    failures.push(
      `primary navigation entry count is ${entries.length}; `
      + `expected ${PRIMARY_NAV_CONTRACT.length}`,
    );
  }
  for (const [index, expected] of PRIMARY_NAV_CONTRACT.entries()) {
    const actual = entries[index];
    if (!actual) {
      failures.push(`primary navigation entry ${index} is missing`);
      continue;
    }
    for (const field of ["label", "href", "className"]) {
      if (actual[field] !== expected[field]) {
        failures.push(
          `primary navigation entry ${index} ${field} is `
          + `${JSON.stringify(actual[field])}; expected ${JSON.stringify(expected[field])}`,
        );
      }
    }
    if (current !== "ignore") {
      const expectedCurrent = current === "required" && expected.href === route ? "page" : "";
      if (actual.ariaCurrent !== expectedCurrent) {
        failures.push(
          `primary navigation entry ${index} aria-current is `
          + `${JSON.stringify(actual.ariaCurrent)}; expected ${JSON.stringify(expectedCurrent)}`,
        );
      }
    }
    if (visibility !== "ignore") {
      const expectedVisible = visibility === "all"
        || (visibility === "desktop" && expected.className !== "nav-call");
      if (actual.visible !== expectedVisible) {
        failures.push(
          `primary navigation entry ${index} visibility is `
          + `${JSON.stringify(actual.visible)}; expected ${expectedVisible}`,
        );
      }
    }
  }
  return failures;
}

function privateViewerAttachmentPending(error) {
  const message = String(error?.message ?? error ?? "");
  return message.startsWith("published-site contentDocument was not attached")
    || message === "published-site frame target was not attached"
    || message === "exact compiled external CTA count was 0";
}

export async function waitForPrivateViewerAttachment(
  inspect,
  {
    now = Date.now,
    pollMs = PRIVATE_VIEWER_ATTACHMENT_POLL_MS,
    timeoutMs = PRIVATE_VIEWER_ATTACHMENT_TIMEOUT_MS,
    wait = delay,
  } = {},
) {
  if (typeof inspect !== "function") {
    throw new TypeError("private viewer attachment inspector must be a function");
  }
  const deadline = now() + timeoutMs;
  let lastError = null;
  do {
    try {
      return await inspect();
    } catch (error) {
      if (!privateViewerAttachmentPending(error)) throw error;
      lastError = error;
    }
    if (now() >= deadline) break;
    await wait(pollMs);
  } while (now() <= deadline);
  throw new Error(
    `${lastError?.message ?? "published-site attachment was unavailable"} `
    + `after waiting ${timeoutMs}ms`,
  );
}

export function homeFirstPaintFailures(snapshot, checkpoint, scenario) {
  const failures = [];
  if (!snapshot || typeof snapshot !== "object") return ["missing snapshot"];
  if (!checkpoint || typeof checkpoint !== "object") return ["missing checkpoint"];
  if (!HOME_FIRST_PAINT_SCENARIOS.includes(scenario)) {
    failures.push(`unknown scenario ${JSON.stringify(scenario)}`);
  }
  if (snapshot.path !== "/") failures.push(`wrong path ${JSON.stringify(snapshot.path)}`);
  if (
    !Number.isFinite(snapshot.elapsedMs)
    || snapshot.elapsedMs > checkpoint.atMs + HOME_FIRST_PAINT_TIMING_TOLERANCE_MS
  ) {
    failures.push(
      `checkpoint elapsed ${JSON.stringify(snapshot.elapsedMs)}ms exceeds `
      + `${checkpoint.atMs + HOME_FIRST_PAINT_TIMING_TOLERANCE_MS}ms`,
    );
  }
  for (const [name, expected] of Object.entries({
    h1: Object.freeze({
      href: null,
      minimumHeight: 24,
      minimumWidth: 44,
      text: "A clearer website for your small business.",
    }),
    primaryAction: Object.freeze({
      href: "/start/",
      minimumHeight: 44,
      minimumWidth: 44,
      text: "Find the right next step",
    }),
  })) {
    const element = snapshot[name];
    if (!element?.present) {
      failures.push(`${name} is missing`);
      continue;
    }
    if (element.text !== expected.text) {
      failures.push(`${name} text is ${JSON.stringify(element.text)}`);
    }
    if (expected.href !== null && element.href !== expected.href) {
      failures.push(`${name} href is ${JSON.stringify(element.href)}`);
    }
    if (!element.structurallyVisible) failures.push(`${name} is structurally hidden`);
    if (
      !Number.isFinite(element.effectiveOpacity)
      || element.effectiveOpacity < checkpoint.minimumOpacity
    ) {
      failures.push(
        `${name} effective opacity ${JSON.stringify(element.effectiveOpacity)} is below `
        + `${checkpoint.minimumOpacity}`,
      );
    }
    if (
      !Number.isFinite(element.width)
      || element.width < expected.minimumWidth
    ) {
      failures.push(`${name} width is below ${expected.minimumWidth}px`);
    }
    if (
      !Number.isFinite(element.height)
      || element.height < expected.minimumHeight
    ) {
      failures.push(`${name} height is below ${expected.minimumHeight}px`);
    }
    if (
      !Number.isFinite(element.viewportVisibleWidth)
      || element.viewportVisibleWidth < expected.minimumWidth
    ) {
      failures.push(`${name} is not meaningfully visible horizontally`);
    }
    if (
      !Number.isFinite(element.viewportVisibleHeight)
      || element.viewportVisibleHeight < expected.minimumHeight
    ) {
      failures.push(`${name} is not meaningfully visible vertically`);
    }
  }
  if (
    checkpoint.atMs === HOME_FIRST_PAINT_CHECKPOINTS.at(-1).atMs
    && (
      !Number.isFinite(snapshot.firstContentfulPaintMs)
      || snapshot.firstContentfulPaintMs
        > checkpoint.atMs + HOME_FIRST_PAINT_TIMING_TOLERANCE_MS
    )
  ) {
    failures.push(
      `first contentful paint ${JSON.stringify(snapshot.firstContentfulPaintMs)}ms exceeds `
      + `${checkpoint.atMs + HOME_FIRST_PAINT_TIMING_TOLERANCE_MS}ms`,
    );
  }
  if (
    ["hero-image-held", "hero-image-blocked"].includes(scenario)
    && snapshot.heroInterceptedRequests < 1
  ) {
    failures.push("hero image interception did not run");
  }
  if (
    ["hero-image-held", "hero-image-blocked"].includes(scenario)
    && snapshot.heroImage?.naturalWidth !== 0
  ) {
    failures.push("hero image unexpectedly rendered during its failure checkpoint");
  }
  if (scenario === "hero-image-held" && snapshot.heroHeldRequests < 1) {
    failures.push("hero image was not held through the checkpoint");
  }
  if (scenario === "javascript-disabled" && snapshot.hasJsClass) {
    failures.push("JavaScript-disabled document acquired the js class");
  }
  if (
    scenario === "forced-early-javascript-failure"
    && !snapshot.forcedFailureTriggered
  ) {
    failures.push("forced early JavaScript failure did not trigger");
  }
  return failures;
}

export function progressiveFailureFailures(snapshot, scenarioKey, route) {
  const failures = [];
  const scenario = PROGRESSIVE_FAILURE_SCENARIOS.find(({ key }) => key === scenarioKey);
  if (!scenario) return [`unknown progressive-failure scenario ${JSON.stringify(scenarioKey)}`];
  if (!CANONICAL_ROUTES.includes(route)) {
    failures.push(`unknown canonical route ${JSON.stringify(route)}`);
  }
  if (!snapshot || typeof snapshot !== "object") return [...failures, "missing snapshot"];
  if (snapshot.path !== route) failures.push(`wrong path ${JSON.stringify(snapshot.path)}`);
  if (snapshot.readyState !== "complete") {
    failures.push(`document state is ${JSON.stringify(snapshot.readyState)}`);
  }
  if (
    snapshot.failure?.scenario !== scenario.key
    || snapshot.failure?.stage !== scenario.failureStage
    || snapshot.failure?.jsAtFailure !== true
  ) {
    failures.push(`forced failure marker is ${JSON.stringify(snapshot.failure ?? null)}`);
  }
  if (!snapshot.hasJsClass) failures.push("root lost the js class before the audit");
  if (snapshot.menuReady !== scenario.menuReady) {
    failures.push(
      `menu-ready is ${JSON.stringify(snapshot.menuReady)}; expected ${scenario.menuReady}`,
    );
  }
  if (snapshot.revealReady !== scenario.revealReady) {
    failures.push(
      `reveal-ready is ${JSON.stringify(snapshot.revealReady)}; expected ${scenario.revealReady}`,
    );
  }
  if (
    snapshot.h1?.count !== 1
    || !snapshot.h1?.usable
    || typeof snapshot.h1?.text !== "string"
    || snapshot.h1.text.length < 4
  ) {
    failures.push(`route H1 is not usable ${JSON.stringify(snapshot.h1 ?? null)}`);
  }
  const navContractFailures = primaryNavContractFailures(snapshot.nav?.entries, route, {
    current: scenario.key === "after-root-js" ? "absent" : "required",
  });
  if (
    !snapshot.nav?.usable
    || snapshot.nav.mode !== (scenario.menuReady ? "enhanced-disclosure" : "fallback-links")
    || snapshot.nav.failures?.length
    || navContractFailures.length
  ) {
    failures.push(
      `primary navigation is not usable `
      + `${JSON.stringify({
        contractFailures: navContractFailures,
        snapshot: snapshot.nav ?? null,
      })}`,
    );
  }
  if (
    !Number.isInteger(snapshot.essential?.count)
    || snapshot.essential.count < 1
    || snapshot.essential.failures?.length
  ) {
    failures.push(
      `essential links/actions are not reachable ${JSON.stringify(snapshot.essential ?? null)}`,
    );
  }
  const expectedDisclosureCount = PROGRESSIVE_DISCLOSURE_COUNTS[route] ?? 0;
  if (
    snapshot.disclosures?.count !== expectedDisclosureCount
    || snapshot.disclosures?.failures?.length
  ) {
    failures.push(
      `native disclosures are not usable ${JSON.stringify(snapshot.disclosures ?? null)}`,
    );
  }
  if (
    !Number.isInteger(snapshot.reveals?.count)
    || snapshot.reveals.failures?.length
    || (
      PROGRESSIVE_REVEAL_ROUTES.includes(route)
      && snapshot.reveals.belowFoldCount < 1
    )
  ) {
    failures.push(
      `reveal content is not reachable ${JSON.stringify(snapshot.reveals ?? null)}`,
    );
  }
  if (
    !snapshot.belowFold?.present
    || !snapshot.belowFold?.initiallyBelowFold
    || !snapshot.belowFold?.usable
    || snapshot.belowFold.textLength < 40
  ) {
    failures.push(
      `below-fold route content is not reachable ${JSON.stringify(snapshot.belowFold ?? null)}`,
    );
  }
  return failures;
}

export function privateViewerPopupFailures(
  proof,
  expectedUrl = PRIVATE_VIEWER_POPUP_URL,
) {
  const failures = [];
  let parsedExpected;
  try {
    parsedExpected = new URL(expectedUrl);
  } catch {
    return [`unsafe popup fixture URL ${JSON.stringify(expectedUrl)}`];
  }
  if (
    parsedExpected.protocol !== "https:"
    || parsedExpected.hostname !== "cta.invalid"
  ) {
    failures.push(`unsafe popup fixture URL ${JSON.stringify(expectedUrl)}`);
  }
  if (!proof || typeof proof !== "object") return [...failures, "missing popup proof"];
  if (proof.error) failures.push(`popup exercise error ${JSON.stringify(proof.error)}`);

  const sandboxTokens = String(proof.frame?.sandbox ?? "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (
    sandboxTokens.length !== 1
    || sandboxTokens[0] !== "allow-popups"
  ) {
    failures.push(`source frame sandbox is ${JSON.stringify(proof.frame?.sandbox ?? null)}`);
  }
  if (
    ![
      "DOM.getDocument(pierce)",
      "Target.attachToTarget(flatten)",
    ].includes(proof.frame?.inspection)
    || !proof.frame?.ownerBackendNodeId
    || !proof.frame?.contentDocumentBackendNodeId
  ) {
    failures.push("published-site DOM attachment was not identified");
  }
  if (proof.frame?.sandboxRestrictsOriginAndScripts !== true) {
    failures.push("published-site sandbox did not retain opaque-origin and no-script restrictions");
  }
  if (
    proof.click?.href !== expectedUrl
    || proof.click?.target !== "_blank"
    || !String(proof.click?.rel ?? "").split(/\s+/u).includes("noopener")
    || proof.click?.interaction !== "Input.dispatchMouseEvent"
  ) {
    failures.push(`generated CTA click is ${JSON.stringify(proof.click ?? null)}`);
  }
  if (
    proof.windowOpen?.url !== expectedUrl
    || proof.windowOpen?.userGesture !== true
  ) {
    failures.push(`Page.windowOpen proof is ${JSON.stringify(proof.windowOpen ?? null)}`);
  }
  if (
    proof.popup?.createdEvent !== true
    || proof.popup?.type !== "page"
    || !proof.popup?.targetId
  ) {
    failures.push(`Target.targetCreated proof is ${JSON.stringify(proof.popup ?? null)}`);
  }
  if (
    proof.popup?.openerFrameId
    && proof.popup.openerFrameId !== proof.frame?.frameId
  ) {
    failures.push(
      `popup opener frame ${JSON.stringify(proof.popup.openerFrameId)} did not match `
      + `${JSON.stringify(proof.frame?.frameId ?? null)}`,
    );
  }
  if (
    !proof.outerAfter?.frameConnected
    || !proof.outerAfter?.sourceRetained
    || proof.outerAfter?.sandbox !== "allow-popups"
    || proof.outerAfter?.state !== "live"
    || proof.outerAfter?.siteHidden
  ) {
    failures.push(`opener page did not remain intact ${JSON.stringify(proof.outerAfter ?? null)}`);
  }
  if (
    !proof.innerAfter?.documentConnected
    || !proof.innerAfter?.linkConnected
    || proof.innerAfter?.href !== expectedUrl
    || proof.innerAfter?.target !== "_blank"
    || proof.innerAfter?.backendNodeId !== proof.click?.backendNodeId
  ) {
    failures.push(`opener iframe did not remain intact ${JSON.stringify(proof.innerAfter ?? null)}`);
  }

  const attemptedTargets = Array.isArray(proof.cleanup?.attemptedTargetIds)
    ? proof.cleanup.attemptedTargetIds
    : [];
  const remainingTargets = Array.isArray(proof.cleanup?.remainingTargetIds)
    ? proof.cleanup.remainingTargetIds
    : [];
  if (
    !proof.cleanup?.listenersRemoved
    || !proof.cleanup?.discoveryDisabled
    || !proof.cleanup?.domDisabled
    || !proof.cleanup?.frameSessionDetached
    || !Array.isArray(proof.cleanup?.remainingTargetIds)
    || (proof.cleanup?.closeErrors?.length ?? 0) > 0
    || remainingTargets.length
    || (proof.popup?.targetId && !attemptedTargets.includes(proof.popup.targetId))
  ) {
    failures.push(`popup cleanup is incomplete ${JSON.stringify(proof.cleanup ?? null)}`);
  }
  return failures;
}

export async function chromiumPath() {
  const requested = process.env.SITESOURCERY_CHROMIUM;
  const choices = requested ? [requested] : DEFAULT_CHROMIUM;
  const failures = [];
  for (const candidate of choices) {
    try {
      await access(candidate);
      const version = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        timeout: 5000,
      });
      const observed = version.stdout?.trim() ?? "";
      if (version.status !== 0 || observed !== REVIEWED_CHROMIUM.version) {
        failures.push(`${candidate}: expected ${REVIEWED_CHROMIUM.version}; observed ${observed || "no version"}`);
        continue;
      }
      return candidate;
    } catch {
      failures.push(`${candidate}: not executable`);
    }
  }
  throw new Error(`no exact reviewed Chromium binary was found (${failures.join("; ")})`);
}

const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
});

export function artifactPath(pathname, artifactRoot = DEFAULT_ARTIFACT_ROOT) {
  const absoluteArtifactRoot = path.resolve(artifactRoot);
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.endsWith("/")
    ? `${decoded.replace(/^\/+/u, "")}index.html`
    : decoded.replace(/^\/+/u, "");
  if (!relative || relative.includes("\0")) return null;
  const normalized = path.posix.normalize(relative);
  if (normalized === ".." || normalized.startsWith("../") || normalized !== relative) return null;
  const candidate = path.resolve(absoluteArtifactRoot, normalized);
  if (
    candidate !== absoluteArtifactRoot
    && !candidate.startsWith(`${absoluteArtifactRoot}${path.sep}`)
  ) return null;
  return candidate;
}

async function startArtifactServer(artifactRoot) {
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const file = artifactPath(pathname, artifactRoot);
    if (!file) {
      response.writeHead(400);
      response.end("Bad request");
      return;
    }
    try {
      const bytes = await readFile(file);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": bytes.byteLength,
        "Content-Type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500);
      response.end(error?.code === "ENOENT" ? "Not found" : "Artifact read failed");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("artifact server did not receive a loopback port");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function waitForTarget(port, processState) {
  const endpoint = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processState.exitCode !== null) {
      throw new Error(`Chromium exited before audit startup (${processState.exitCode})`);
    }
    try {
      const response = await fetch(endpoint);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
        if (target) return target.webSocketDebuggerUrl;
      }
    } catch {
      // The debugging endpoint is still starting.
    }
    await delay(50);
  }
  throw new Error("timed out waiting for Chromium debugging target");
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
  let sequence = 0;

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result);
      return;
    }
    const callbacks = listeners.get(message.method) ?? [];
    for (const callback of callbacks) callback(message.params ?? {});
  });

  function on(method, callback) {
    const callbacks = listeners.get(method) ?? [];
    callbacks.push(callback);
    listeners.set(method, callbacks);
    return () => {
      listeners.set(method, (listeners.get(method) ?? []).filter((entry) => entry !== callback));
    };
  }

  async function send(method, params = {}, sessionId = "") {
    await opened;
    sequence += 1;
    const id = sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { method, reject, resolve });
      const message = { id, method, params };
      if (sessionId) message.sessionId = sessionId;
      socket.send(JSON.stringify(message));
    });
  }

  async function close() {
    for (const request of pending.values()) request.reject(new Error("CDP connection closed"));
    pending.clear();
    socket.close();
  }

  return { close, on, send };
}

async function navigate(cdp, url) {
  const loaded = new Promise((resolve) => {
    const off = cdp.on("Page.loadEventFired", () => {
      off();
      resolve();
    });
  });
  await cdp.send("Page.navigate", { url });
  await Promise.race([
    loaded,
    delay(8000).then(() => {
      throw new Error(`timed out loading ${url}`);
    }),
  ]);
  await delay(250);
}

async function navigateToDomContent(cdp, url) {
  let loaderId = "";
  let resolveReady;
  const earlyEvents = [];
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const off = cdp.on("Page.lifecycleEvent", (event) => {
    if (event.name !== "DOMContentLoaded") return;
    if (!loaderId) {
      earlyEvents.push(event);
      return;
    }
    if (event.loaderId === loaderId) resolveReady(event);
  });
  try {
    const navigation = await cdp.send("Page.navigate", { url });
    if (navigation.errorText) {
      throw new Error(`failed to navigate ${url}: ${navigation.errorText}`);
    }
    loaderId = navigation.loaderId ?? "";
    if (!loaderId) throw new Error(`navigation did not produce a loader id for ${url}`);
    const alreadyReady = earlyEvents.find((event) => event.loaderId === loaderId);
    if (alreadyReady) resolveReady(alreadyReady);
    await Promise.race([
      ready,
      delay(4000).then(() => {
        throw new Error(`timed out before DOMContentLoaded for ${url}`);
      }),
    ]);
    return loaderId;
  } finally {
    off();
  }
}

const HOME_FORCED_FAILURE_SOURCE = `(() => {
  const nativeAdd = DOMTokenList.prototype.add;
  DOMTokenList.prototype.add = function (...tokens) {
    const targetsRoot = Boolean(
      document.documentElement
      && this === document.documentElement.classList
      && tokens.includes("js")
    );
    const result = nativeAdd.apply(this, tokens);
    if (!targetsRoot) return result;
    DOMTokenList.prototype.add = nativeAdd;
    globalThis.__siteSourceryForcedEarlyFailure = true;
    throw new Error("${HOME_FORCED_FAILURE_SENTINEL}");
  };
})()`;

function homeFirstPaintExpression(checkpoint, { asyncWait = true } = {}) {
  const waitForCheckpoint = asyncWait
    ? `const targetMs = ${JSON.stringify(checkpoint.atMs)};
      const remaining = targetMs - performance.now();
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });`
    : "";
  return `(${asyncWait ? "async " : ""}() => {
    ${waitForCheckpoint}
    const describe = (element) => {
      if (!element) return { present: false };
      let effectiveOpacity = 1;
      let structurallyVisible = true;
      for (
        let current = element;
        current && current.nodeType === Node.ELEMENT_NODE;
        current = current.parentElement
      ) {
        const style = getComputedStyle(current);
        const opacity = Number.parseFloat(style.opacity);
        effectiveOpacity *= Number.isFinite(opacity) ? opacity : 0;
        if (
          current.hidden
          || current.inert
          || current.getAttribute("aria-hidden") === "true"
          || style.display === "none"
          || style.visibility === "hidden"
          || style.contentVisibility === "hidden"
        ) {
          structurallyVisible = false;
        }
      }
      const rect = element.getBoundingClientRect();
      const viewportVisibleWidth = Math.max(
        0,
        Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)
      );
      const viewportVisibleHeight = Math.max(
        0,
        Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0)
      );
      return {
        effectiveOpacity,
        height: rect.height,
        href: element.getAttribute("href"),
        present: true,
        structurallyVisible: structurallyVisible
          && element.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
            contentVisibilityAuto: true
          })
          && rect.width > 0
          && rect.height > 0,
        text: (element.textContent || "").replace(/\\s+/gu, " ").trim(),
        viewportVisibleHeight,
        viewportVisibleWidth,
        width: rect.width
      };
    };
    const paintEntries = Object.fromEntries(
      performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime])
    );
    const heroImage = document.querySelector(".home-hero .hero-image");
    return {
      elapsedMs: performance.now(),
      firstContentfulPaintMs: paintEntries["first-contentful-paint"] ?? null,
      firstPaintMs: paintEntries["first-paint"] ?? null,
      forcedFailureTriggered: globalThis.__siteSourceryForcedEarlyFailure === true,
      h1: describe(document.querySelector(".home-hero h1")),
      hasJsClass: document.documentElement.classList.contains("js"),
      heroImage: heroImage
        ? {
          complete: heroImage.complete,
          naturalHeight: heroImage.naturalHeight,
          naturalWidth: heroImage.naturalWidth
        }
        : null,
      path: location.pathname,
      primaryAction: describe(
        document.querySelector('.home-hero .hero-actions .button-primary[href="/start/"]')
      ),
      readyState: document.readyState
    };
  })()`;
}

async function auditHomeFirstPaint(cdp, auditOrigin) {
  const errors = [];
  const results = [];
  let coldNavigationSequence = 0;
  await cdp.send("Page.setLifecycleEventsEnabled", { enabled: true });
  await cdp.send("Network.enable");
  try {
    for (const viewport of HOME_FIRST_PAINT_VIEWPORTS) {
      // A page-cache cold load should not also measure one-time renderer and
      // compositor startup. Prime those browser processes before each device
      // class, then clear the browser cache inside every measured scenario.
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.mobile,
      });
      const warmed = await cdp.send("Runtime.evaluate", {
        expression:
          "new Promise((resolve) => "
          + "requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        awaitPromise: true,
        returnByValue: true,
      });
      if (warmed.exceptionDetails) {
        throw new Error(
          `could not prime ${viewport.label} paint target `
          + `${JSON.stringify(warmed.exceptionDetails)}`,
        );
      }
      for (const scenario of HOME_FIRST_PAINT_SCENARIOS) {
        const auditLabel = `${viewport.label} / cold-home / ${scenario}`;
        const heldRequestIds = new Set();
        const fetchOperations = [];
        const fetchFailures = [];
        const runtimeMessages = [];
        let fetchEnabled = false;
        let forcedScriptIdentifier = "";
        let heroInterceptedRequests = 0;
        let resolveHeroIntercepted;
        const heroIntercepted = new Promise((resolve) => {
          resolveHeroIntercepted = resolve;
        });
        const offException = cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
          runtimeMessages.push(
            exceptionDetails?.exception?.description
            ?? exceptionDetails?.text
            ?? "browser exception",
          );
        });
        const offConsole = cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
          if (type !== "error" && type !== "assert") return;
          runtimeMessages.push(
            args?.map((entry) => entry.value ?? entry.description ?? "").join(" ")
            || type,
          );
        });
        let offFetch = () => {};
        try {
          await cdp.send("Emulation.setDeviceMetricsOverride", {
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: 1,
            mobile: viewport.mobile,
          });
          await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
          await cdp.send("Network.clearBrowserCache");
          await cdp.send("Emulation.setScriptExecutionDisabled", {
            value: scenario === "javascript-disabled",
          });
          if (scenario === "forced-early-javascript-failure") {
            const installed = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
              source: HOME_FORCED_FAILURE_SOURCE,
            });
            forcedScriptIdentifier = installed.identifier ?? "";
            if (!forcedScriptIdentifier) {
              throw new Error("forced-failure script did not receive an identifier");
            }
          }
          if (["hero-image-held", "hero-image-blocked"].includes(scenario)) {
            await cdp.send("Fetch.enable", {
              patterns: [{
                requestStage: "Request",
                resourceType: "Image",
                urlPattern: HOME_HERO_IMAGE_PATTERN,
              }],
            });
            fetchEnabled = true;
            offFetch = cdp.on("Fetch.requestPaused", (event) => {
              heroInterceptedRequests += 1;
              resolveHeroIntercepted();
              if (scenario === "hero-image-held") {
                heldRequestIds.add(event.requestId);
                return;
              }
              const failed = cdp.send("Fetch.failRequest", {
                errorReason: "Aborted",
                requestId: event.requestId,
              }).catch((error) => {
                fetchFailures.push(error.message);
              });
              fetchOperations.push(failed);
            });
          }

          const target = new URL("/", `${auditOrigin}/`);
          coldNavigationSequence += 1;
          target.searchParams.set(
            "browser-audit-cold",
            `${coldNavigationSequence}-${scenario}-${viewport.label}`,
          );
          await navigateToDomContent(cdp, target.href);
          if (fetchEnabled) {
            await Promise.race([
              heroIntercepted,
              delay(1000).then(() => {
                throw new Error("hero image request was not intercepted");
              }),
            ]);
            await Promise.all(fetchOperations);
          }

          const checkpoints = [];
          let previousCheckpointAtMs = 0;
          for (const checkpoint of HOME_FIRST_PAINT_CHECKPOINTS) {
            const pageScriptDisabled = scenario === "javascript-disabled";
            if (pageScriptDisabled) {
              await delay(Math.max(0, checkpoint.atMs - previousCheckpointAtMs));
            }
            previousCheckpointAtMs = checkpoint.atMs;
            const evaluated = await cdp.send("Runtime.evaluate", {
              expression: homeFirstPaintExpression(checkpoint, {
                asyncWait: !pageScriptDisabled,
              }),
              awaitPromise: !pageScriptDisabled,
              returnByValue: true,
            });
            const snapshot = evaluated.result?.value;
            if (evaluated.exceptionDetails || !snapshot) {
              errors.push(
                `${auditLabel} @ ${checkpoint.atMs}ms: checkpoint evaluation failed `
                + `${JSON.stringify(evaluated.exceptionDetails ?? null)}`,
              );
              continue;
            }
            snapshot.heroHeldRequests = heldRequestIds.size;
            snapshot.heroInterceptedRequests = heroInterceptedRequests;
            const failures = homeFirstPaintFailures(snapshot, checkpoint, scenario);
            for (const failure of failures) {
              errors.push(`${auditLabel} @ ${checkpoint.atMs}ms: ${failure}`);
            }
            checkpoints.push({
              atMs: checkpoint.atMs,
              effectiveOpacity: {
                h1: snapshot.h1?.effectiveOpacity ?? null,
                primaryAction: snapshot.primaryAction?.effectiveOpacity ?? null,
              },
              elapsedMs: snapshot.elapsedMs,
              firstContentfulPaintMs: snapshot.firstContentfulPaintMs,
            });
          }
          const unexpectedRuntimeMessages = runtimeMessages.filter((message) =>
            !(
              scenario === "forced-early-javascript-failure"
              && message.includes(HOME_FORCED_FAILURE_SENTINEL)
            )
          );
          for (const message of unexpectedRuntimeMessages) {
            errors.push(`${auditLabel}: browser error ${message}`);
          }
          for (const message of fetchFailures) {
            errors.push(`${auditLabel}: Fetch command failed ${message}`);
          }
          results.push({
            checkpoints,
            mode: "cold-first-paint",
            scenario,
            viewport: viewport.label,
          });
        } catch (error) {
          errors.push(`${auditLabel}: ${error.message}`);
        } finally {
          offFetch();
          offException();
          offConsole();
          for (const requestId of heldRequestIds) {
            fetchOperations.push(
              cdp.send("Fetch.continueRequest", { requestId }).catch((error) => {
                errors.push(`${auditLabel}: Fetch cleanup failed ${error.message}`);
              }),
            );
          }
          await Promise.all(fetchOperations);
          if (fetchEnabled) {
            try {
              await cdp.send("Fetch.disable");
            } catch (error) {
              errors.push(`${auditLabel}: Fetch cleanup failed ${error.message}`);
            }
          }
          if (forcedScriptIdentifier) {
            try {
              await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
                identifier: forcedScriptIdentifier,
              });
            } catch (error) {
              errors.push(`${auditLabel}: forced-failure cleanup failed ${error.message}`);
            }
          }
          try {
            await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });
            await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
            await navigate(cdp, "about:blank");
          } catch (error) {
            errors.push(`${auditLabel}: page-state cleanup failed ${error.message}`);
          }
        }
      }
    }
  } finally {
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
    await cdp.send("Network.disable");
  }
  return { errors, results };
}

function progressiveFailureSource(scenario) {
  const key = JSON.stringify(scenario.key);
  const stage = JSON.stringify(scenario.failureStage);
  return `(() => {
    const scenario = ${key};
    const stage = ${stage};
    const fail = () => {
      globalThis.__siteSourceryProgressiveFailure = {
        jsAtFailure: document.documentElement.classList.contains("js"),
        scenario,
        stage
      };
      throw new Error("${PROGRESSIVE_FAILURE_SENTINEL}:" + scenario + ":" + stage);
    };
    if (scenario === "after-root-js") {
      const nativeAdd = DOMTokenList.prototype.add;
      DOMTokenList.prototype.add = function (...tokens) {
        const targetsRoot = Boolean(
          document.documentElement
          && this === document.documentElement.classList
          && tokens.includes("js")
        );
        const result = nativeAdd.apply(this, tokens);
        if (!targetsRoot) return result;
        DOMTokenList.prototype.add = nativeAdd;
        fail();
      };
      return;
    }
    if (scenario === "during-menu-initializer") {
      const nativeAddEventListener = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        const result = nativeAddEventListener.call(this, type, listener, options);
        if (
          type !== "click"
          || !(this instanceof Element)
          || !this.hasAttribute("data-menu")
        ) return result;
        EventTarget.prototype.addEventListener = nativeAddEventListener;
        fail();
      };
      return;
    }
    if (scenario === "during-reveal-initializer") {
      const nativeQuerySelectorAll = Document.prototype.querySelectorAll;
      Document.prototype.querySelectorAll = function (selector) {
        const result = nativeQuerySelectorAll.call(this, selector);
        if (this !== document || selector !== ".reveal") return result;
        Document.prototype.querySelectorAll = nativeQuerySelectorAll;
        fail();
      };
      return;
    }
    throw new Error("Unknown progressive-failure scenario " + scenario);
  })()`;
}

const PROGRESSIVE_FAILURE_AUDIT_EXPRESSION = `(async () => {
  const root = document.documentElement;
  const main = document.querySelector("main");
  const originalScrollBehavior = root.style.getPropertyValue("scroll-behavior");
  const originalScrollBehaviorPriority = root.style.getPropertyPriority("scroll-behavior");
  root.style.setProperty("scroll-behavior", "auto", "important");
  const settle = () => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
  const semanticHidden = (element) => Boolean(
    element?.closest('[hidden], [inert], [aria-hidden="true"]')
  );
  const identity = (element) => {
    if (!element) return { label: "missing", tag: "" };
    return {
      label: (
        element.getAttribute("aria-label")
        || element.textContent
        || element.id
        || element.tagName
      ).replace(/\\s+/gu, " ").trim().slice(0, 100),
      tag: element.tagName.toLowerCase()
    };
  };
  const describe = (element) => {
    if (!element) return { ...identity(element), structurallyVisible: false, usable: false };
    let effectiveOpacity = 1;
    let structurallyVisible = true;
    for (
      let current = element;
      current && current.nodeType === Node.ELEMENT_NODE;
      current = current.parentElement
    ) {
      const style = getComputedStyle(current);
      const opacity = Number.parseFloat(style.opacity);
      effectiveOpacity *= Number.isFinite(opacity) ? opacity : 0;
      if (
        current.hidden
        || current.inert
        || current.getAttribute("aria-hidden") === "true"
        || style.display === "none"
        || style.visibility === "hidden"
        || style.contentVisibility === "hidden"
      ) {
        structurallyVisible = false;
      }
    }
    const rect = element.getBoundingClientRect();
    const viewportWidth = Math.max(
      0,
      Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)
    );
    const viewportHeight = Math.max(
      0,
      Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0)
    );
    let visibilityApi = true;
    if (typeof element.checkVisibility === "function") {
      try {
        visibilityApi = element.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
          contentVisibilityAuto: true
        });
      } catch {
        visibilityApi = false;
      }
    }
    return {
      ...identity(element),
      effectiveOpacity,
      height: rect.height,
      structurallyVisible,
      usable: structurallyVisible
        && visibilityApi
        && effectiveOpacity > 0.01
        && rect.width > 0
        && rect.height > 0
        && viewportWidth > 0
        && viewportHeight > 0,
      viewportHeight,
      viewportWidth,
      width: rect.width
    };
  };
  const reach = (element, { focus = false } = {}) => {
    if (!element) return { ...identity(element), focused: false, usable: false };
    element.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    if (focus) element.focus({ preventScroll: true });
    return {
      ...describe(element),
      focused: !focus || document.activeElement === element
    };
  };

  window.scrollTo(0, 0);
  const h1Elements = Array.from(document.querySelectorAll("h1"));
  const h1Element = h1Elements[0] || null;
  const h1State = reach(h1Element);
  const h1 = {
    count: h1Elements.length,
    text: (h1Element?.textContent || "").replace(/\\s+/gu, " ").trim(),
    usable: h1State.usable
  };

  window.scrollTo(0, 0);
  const menuReady = root.classList.contains("menu-ready");
  const menuButton = document.querySelector("[data-menu-button]");
  const menu = document.querySelector("[data-menu]");
  const navLinks = menu ? Array.from(menu.querySelectorAll("a[href]")) : [];
  const navFailures = [];
  const navMode = menuReady ? "enhanced-disclosure" : "fallback-links";
  if (!menuButton || !menu) {
    navFailures.push("missing menu button or primary navigation");
  } else if (menuReady) {
    menuButton.click();
    await settle();
    if (
      menuButton.getAttribute("aria-expanded") !== "true"
      || !menu.hasAttribute("data-open")
      || !describe(menu).usable
    ) {
      navFailures.push("enhanced disclosure did not open");
    }
    for (const link of navLinks) {
      const state = reach(link, { focus: true });
      if (!state.usable || !state.focused) navFailures.push(identity(link));
    }
    menuButton.click();
    await settle();
    if (
      menuButton.getAttribute("aria-expanded") !== "false"
      || menu.hasAttribute("data-open")
    ) {
      navFailures.push("enhanced disclosure did not close");
    }
  } else {
    if (describe(menuButton).structurallyVisible) {
      navFailures.push("uninitialized menu button remained visible");
    }
    if (!describe(menu).usable) navFailures.push("fallback navigation is hidden");
    for (const link of navLinks) {
      const state = reach(link, { focus: true });
      if (!state.usable || !state.focused) navFailures.push(identity(link));
    }
  }
  const nav = {
    entries: navLinks.map((link) => ({
      ariaCurrent: link.getAttribute("aria-current") || "",
      className: typeof link.className === "string" ? link.className : "",
      href: link.getAttribute("href") || "",
      label: (link.textContent || "").replace(/\\s+/gu, " ").trim()
    })),
    failures: navFailures.slice(0, 20),
    mode: navMode,
    usable: navFailures.length === 0
  };

  const disclosureFailures = [];
  const disclosures = main
    ? Array.from(main.querySelectorAll("details")).filter((details) => !semanticHidden(details))
    : [];
  for (const [index, details] of disclosures.entries()) {
    const summary = details.querySelector(":scope > summary");
    details.open = false;
    const summaryState = reach(summary, { focus: true });
    summary?.click();
    const body = Array.from(details.children).find((child) => child !== summary) || null;
    const bodyState = reach(body);
    if (
      !summary
      || !summaryState.usable
      || !summaryState.focused
      || !details.open
      || !bodyState.usable
      || (body?.innerText || "").trim().length < 20
    ) {
      disclosureFailures.push({
        body: bodyState,
        index,
        open: details.open,
        summary: summaryState
      });
    }
  }

  const controlSelector = [
    "a[href]",
    "button",
    "summary",
    "input:not([type='hidden'])",
    "select",
    "textarea"
  ].join(", ");
  const essentialControls = main
    ? Array.from(main.querySelectorAll(controlSelector)).filter((control) =>
      !semanticHidden(control)
      && !control.matches(":disabled")
      && control.getAttribute("aria-disabled") !== "true"
      && describe(control).structurallyVisible
    )
    : [];
  const essentialFailures = [];
  for (const control of essentialControls) {
    const state = reach(control, { focus: true });
    if (!state.usable || !state.focused) essentialFailures.push(state);
  }

  window.scrollTo(0, 0);
  const revealFailures = [];
  let belowFoldRevealCount = 0;
  const revealElements = Array.from(document.querySelectorAll(".reveal"))
    .filter((element) => !semanticHidden(element));
  const revealEntries = revealElements.map((element) => ({
    element,
    initialTop: element.getBoundingClientRect().top
  }));
  for (const { element, initialTop } of revealEntries) {
    if (initialTop >= innerHeight) belowFoldRevealCount += 1;
    const state = reach(element);
    if (!state.usable) {
      revealFailures.push({ ...state, initialTop: Math.round(initialTop) });
    }
  }

  window.scrollTo(0, 0);
  const belowFoldCandidates = main
    ? Array.from(main.querySelectorAll("section, article, h2, h3, p, li"))
      .filter((element) =>
        !semanticHidden(element)
        && element.getClientRects().length > 0
        && (element.innerText || "").trim().length >= 40
      )
      .map((element) => ({
        element,
        top: element.getBoundingClientRect().top
      }))
    : [];
  const belowFoldCandidate = belowFoldCandidates
    .filter(({ top }) => top >= innerHeight)
    .at(-1);
  const belowFoldState = belowFoldCandidate
    ? reach(belowFoldCandidate.element)
    : { usable: false };
  const belowFold = {
    ...identity(belowFoldCandidate?.element || null),
    initiallyBelowFold: Boolean(belowFoldCandidate),
    present: Boolean(belowFoldCandidate?.element),
    textLength: (belowFoldCandidate?.element?.innerText || "").trim().length,
    top: belowFoldCandidate ? Math.round(belowFoldCandidate.top) : null,
    usable: belowFoldState.usable === true
  };

  window.scrollTo(0, 0);
  await settle();
  const snapshot = {
    belowFold,
    disclosures: {
      count: disclosures.length,
      failures: disclosureFailures.slice(0, 20)
    },
    essential: {
      count: essentialControls.length,
      failures: essentialFailures.slice(0, 20)
    },
    failure: globalThis.__siteSourceryProgressiveFailure || null,
    h1,
    hasJsClass: root.classList.contains("js"),
    menuReady,
    nav,
    path: location.pathname,
    readyState: document.readyState,
    revealReady: root.classList.contains("reveal-ready"),
    reveals: {
      belowFoldCount: belowFoldRevealCount,
      count: revealElements.length,
      failures: revealFailures.slice(0, 20)
    }
  };
  if (originalScrollBehavior) {
    root.style.setProperty(
      "scroll-behavior",
      originalScrollBehavior,
      originalScrollBehaviorPriority
    );
  } else {
    root.style.removeProperty("scroll-behavior");
  }
  return snapshot;
})()`;

async function auditProgressiveEnhancementFailures(cdp, auditOrigin, routes) {
  const errors = [];
  const results = [];
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: PROGRESSIVE_FAILURE_VIEWPORT.width,
    height: PROGRESSIVE_FAILURE_VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: PROGRESSIVE_FAILURE_VIEWPORT.mobile,
  });
  for (const route of routes) {
    for (const scenario of PROGRESSIVE_FAILURE_SCENARIOS) {
      const auditLabel = `${PROGRESSIVE_FAILURE_VIEWPORT.label} ${route} / ${scenario.key}`;
      const runtimeMessages = [];
      let scriptIdentifier = "";
      const offException = cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
        runtimeMessages.push(
          exceptionDetails?.exception?.description
          ?? exceptionDetails?.text
          ?? "browser exception",
        );
      });
      const offConsole = cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
        if (type !== "error" && type !== "assert") return;
        runtimeMessages.push(
          args?.map((entry) => entry.value ?? entry.description ?? "").join(" ")
          || type,
        );
      });
      try {
        const installed = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
          source: progressiveFailureSource(scenario),
        });
        scriptIdentifier = installed.identifier ?? "";
        if (!scriptIdentifier) throw new Error("failure script did not receive an identifier");
        await navigate(cdp, new URL(route, `${auditOrigin}/`).href);
        const evaluated = await cdp.send("Runtime.evaluate", {
          expression: PROGRESSIVE_FAILURE_AUDIT_EXPRESSION,
          awaitPromise: true,
          returnByValue: true,
        });
        const snapshot = evaluated.result?.value;
        if (evaluated.exceptionDetails || !snapshot) {
          errors.push(
            `${auditLabel}: failure audit returned no value `
            + `${JSON.stringify(evaluated.exceptionDetails ?? null)}`,
          );
          continue;
        }
        for (const failure of progressiveFailureFailures(snapshot, scenario.key, route)) {
          errors.push(`${auditLabel}: ${failure}`);
        }
        if (!runtimeMessages.some((message) => message.includes(PROGRESSIVE_FAILURE_SENTINEL))) {
          errors.push(`${auditLabel}: forced exception was not observed by the browser`);
        }
        for (const message of runtimeMessages.filter((entry) =>
          !entry.includes(PROGRESSIVE_FAILURE_SENTINEL)
        )) {
          errors.push(`${auditLabel}: browser error ${message}`);
        }
        results.push({
          mode: "progressive-failure",
          route,
          scenario: scenario.key,
          viewport: PROGRESSIVE_FAILURE_VIEWPORT.label,
        });
      } catch (error) {
        errors.push(`${auditLabel}: ${error.message}`);
      } finally {
        offException();
        offConsole();
        if (scriptIdentifier) {
          try {
            await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
              identifier: scriptIdentifier,
            });
          } catch (error) {
            errors.push(`${auditLabel}: failure-script cleanup failed ${error.message}`);
          }
        }
        try {
          await navigate(cdp, "about:blank");
        } catch (error) {
          errors.push(`${auditLabel}: page-state cleanup failed ${error.message}`);
        }
      }
    }
  }
  return { errors, results };
}

const AUDIT_EXPRESSION = `(() => {
  const root = document.documentElement;
  const body = document.body;
  const originalX = window.scrollX;
  window.scrollTo(200, window.scrollY);
  const reachableX = window.scrollX;
  window.scrollTo(originalX, window.scrollY);
  const primary = document.querySelectorAll("[data-primary-nav]");
  const images = Array.from(document.images);
  const canonical = document.querySelector('link[rel="canonical"]');
  const path = location.pathname;
  const visible = (element) => {
    if (!element || element.hidden || element.closest("[hidden]")) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number.parseFloat(style.opacity) > 0
      && rect.width > 0
      && rect.height > 0;
  };
  const visibleHeaderDescendants = Array.from(
    document.querySelectorAll(".site-header, .site-header *")
  ).filter(visible);
  const renderedScale = (element) => {
    let scale = 1;
    for (let current = element; current && current.nodeType === Node.ELEMENT_NODE; current = current.parentElement) {
      const style = getComputedStyle(current);
      const zoom = Number.parseFloat(style.zoom);
      if (Number.isFinite(zoom) && zoom > 0) scale *= zoom;
      if (style.transform && style.transform !== "none") {
        try {
          const matrix = new DOMMatrixReadOnly(style.transform);
          const scaleX = Math.hypot(matrix.a, matrix.b);
          const scaleY = Math.hypot(matrix.c, matrix.d);
          scale *= Math.min(scaleX, scaleY);
        } catch {}
      }
    }
    return scale;
  };
  const smallText = Array.from(document.querySelectorAll("body *"))
    .filter((element) => Array.from(element.childNodes).some((node) =>
      node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0
    ))
    .map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || "",
        className: typeof element.className === "string" ? element.className : "",
        pixels: Number.parseFloat(style.fontSize) * renderedScale(element),
        computedPixels: Number.parseFloat(style.fontSize),
        source: "text",
        display: style.display,
        visibility: style.visibility,
        width: rect.width,
        height: rect.height
      };
    })
    .filter((entry) =>
      entry.display !== "none"
      && entry.visibility !== "hidden"
      && entry.width > 0
      && entry.height > 0
      && Number.isFinite(entry.pixels)
      && entry.pixels < 12
    );
  const smallPseudoText = Array.from(document.querySelectorAll("body *"))
    .flatMap((element) => ["::before", "::after"].map((pseudo) => {
      const style = getComputedStyle(element, pseudo);
      const content = style.content;
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || "",
        className: typeof element.className === "string" ? element.className : "",
        pixels: Number.parseFloat(style.fontSize) * renderedScale(element),
        computedPixels: Number.parseFloat(style.fontSize),
        source: pseudo,
        content,
        display: style.display,
        visibility: style.visibility,
        width: rect.width,
        height: rect.height
      };
    }))
    .filter((entry) =>
      entry.content
      && !["none", "normal", '""', "''"].includes(entry.content)
      && entry.display !== "none"
      && entry.visibility !== "hidden"
      && entry.width > 0
      && entry.height > 0
      && Number.isFinite(entry.pixels)
      && entry.pixels < 12
    );
  const typeFloorFailures = [...smallText, ...smallPseudoText]
    .slice(0, 20);
  const touchTargetFailures = Array.from(document.querySelectorAll(
    "a[href], button, summary, input:not([type='hidden']), select, textarea"
  ))
    .filter((element) =>
      !element.matches(".skip-link")
      && !element.disabled
      && element.getAttribute("aria-hidden") !== "true"
    )
    .map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        href: element.getAttribute("href") || "",
        id: element.id || "",
        className: typeof element.className === "string" ? element.className : "",
        text: (element.textContent || element.getAttribute("aria-label") || "").trim().slice(0, 80),
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        display: style.display,
        visibility: style.visibility
      };
    })
    .filter((entry) =>
      entry.display !== "none"
      && entry.visibility !== "hidden"
      && entry.width > 0
      && entry.height > 0
      && (entry.width < 44 || entry.height < 44)
    )
    .slice(0, 30);
  const result = {
    path,
    title: document.title,
    readyState: document.readyState,
    h1Count: document.querySelectorAll("h1").length,
    primaryNavCount: primary.length,
    viewportWidth: root.clientWidth,
    documentWidth: Math.max(root.scrollWidth, body ? body.scrollWidth : 0),
    reachableX,
    headerOverflow: {
      bounds: visibleHeaderDescendants
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            id: element.id || "",
            className: typeof element.className === "string" ? element.className : "",
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width)
          };
        })
        .filter((entry) => entry.left < -1 || entry.right > root.clientWidth + 1),
      internal: visibleHeaderDescendants
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          id: element.id || "",
          className: typeof element.className === "string" ? element.className : "",
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          overflowX: getComputedStyle(element).overflowX
        }))
        .filter((entry) => entry.scrollWidth > entry.clientWidth + 1)
    },
    widthChain: ["html", "body", ".site-header", ".header-inner", ".site-nav"]
      .map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return { selector, missing: true };
        const rect = element.getBoundingClientRect();
        return {
          selector,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          overflowX: getComputedStyle(element).overflowX
        };
      }),
    wideElements: Array.from(document.querySelectorAll("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || "",
          className: typeof element.className === "string" ? element.className : "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth
        };
      })
      .filter((entry) => entry.left < -1 || entry.right > root.clientWidth + 1)
      .slice(0, 12),
    brokenImages: images
      .filter((image) => !image.complete || image.naturalWidth === 0)
      .map((image) => image.getAttribute("src") || ""),
    smallText: typeFloorFailures,
    touchTargetFailures,
    loadedBytes: [
      ...performance.getEntriesByType("navigation"),
      ...performance.getEntriesByType("resource")
    ].reduce((total, entry) => total + (entry.decodedBodySize || 0), 0),
    canonical: canonical ? canonical.href : "",
    menuReady: null,
    hiveReady: null,
    sparkReady: null,
    startReady: null
  };
  const menuButton = document.querySelector("[data-menu-button]");
  const menu = document.querySelector("[data-menu]");
  if (menuButton || menu) {
    const links = menu ? Array.from(menu.querySelectorAll("a[href]")) : [];
    result.menuReady = {
      button: Boolean(menuButton),
      menu: Boolean(menu),
      buttonDisplay: menuButton ? getComputedStyle(menuButton).display : "",
      entries: links.map((link) => ({
        ariaCurrent: link.getAttribute("aria-current") || "",
        className: typeof link.className === "string" ? link.className : "",
        href: link.getAttribute("href") || "",
        label: (link.textContent || "").replace(/\\s+/gu, " ").trim(),
        visible: visible(link)
      })),
      expanded: menuButton ? menuButton.getAttribute("aria-expanded") : "",
      open: menu ? menu.hasAttribute("data-open") : false,
      links: links.length
    };
  }
  const hive = document.querySelector("[data-hive-planner]");
  if (hive) {
    const output = hive.querySelector("[data-hive-output]");
    const stageShell = hive.querySelector(".hive-stage-shell");
    const start = hive.querySelector("[data-hive-start]");
    const stages = Array.from(hive.querySelectorAll("[data-hive-stage]"));
    const live = hive.querySelector("[data-hive-live]");
    const back = hive.querySelector("[data-hive-back]");
    const cells = Array.from(hive.querySelectorAll("[data-hive-cell]"));
    result.hiveReady = {
      activation: hive.getAttribute("data-hive-activation"),
      enhanced: hive.getAttribute("data-hive-planner-ready"),
      controls: hive.querySelectorAll("[data-hive-cell]").length,
      choicesEnabled: cells.filter((control) => !control.disabled).length,
      radioGroupRole: hive.querySelector(".hive-controls")?.getAttribute("role") || "",
      radioCount: cells.filter((control) => control.getAttribute("role") === "radio").length,
      radioChecked: cells.filter((control) => control.getAttribute("aria-checked") === "true").length,
      radioPressedAttributes: cells.filter((control) => control.hasAttribute("aria-pressed")).length,
      rovingTabStops: cells.filter((control) => control.getAttribute("tabindex") === "0").length,
      backDisabled: back?.disabled ?? null,
      backHidden: back?.hidden ?? null,
      currentStage: hive.getAttribute("data-hive-stage-current"),
      downloadDisabled: hive.querySelector("[data-hive-download]")?.disabled ?? null,
      inertLaterStages: stages.slice(1).filter((stage) => stage.inert).length,
      nextButtons: hive.querySelectorAll("[data-hive-next]").length,
      nextButtonsDisabled: Array.from(hive.querySelectorAll("[data-hive-next]"))
        .filter((button) => button.disabled).length,
      outputLength: (output?.textContent || "").length,
      pauseDisabled: hive.querySelector("[data-hive-pause]")?.disabled ?? null,
      plannerColumns: getComputedStyle(hive).gridTemplateColumns.split(/\\s+/u).filter(Boolean).length,
      answerColumns: hive.querySelector(".hive-answer-grid")
        ? getComputedStyle(hive.querySelector(".hive-answer-grid")).gridTemplateColumns
          .split(/\\s+/u).filter(Boolean).length
        : 0,
      progressStates: Array.from(hive.querySelectorAll("[data-hive-step-indicator]"))
        .map((item) => item.getAttribute("data-hive-step-state")),
      startVisible: start
        ? !start.hidden && getComputedStyle(start).display !== "none"
        : null,
      stageShellWidth: stageShell ? Math.round(stageShell.getBoundingClientRect().width) : 0,
      visibleStages: stages.filter((stage) => !stage.hidden).length,
      plannerHeight: Math.round(hive.getBoundingClientRect().height),
      staticExamples: Array.from(document.querySelectorAll("[data-hive-static-cell]"))
        .map((card) => ({
          id: card.getAttribute("data-hive-static-cell") || "",
          label: card.querySelector("h3")?.textContent.trim() || "",
          result: card.querySelector("[data-hive-static-result]")?.textContent.trim() || ""
        })),
      outputLive: output?.hasAttribute("aria-live") || false,
      conciseLive: live
        ? {
          role: live.getAttribute("role"),
          politeness: live.getAttribute("aria-live"),
          atomic: live.getAttribute("aria-atomic"),
          text: live.textContent.trim()
        }
        : null
    };
  }
  const spark = document.querySelector("#spark-maker");
  if (spark) {
    const controlRoom = document.querySelector("#control-room");
    const controlMode = window.SiteSourceryAbracadabraControlMode;
    const configuredControlMode = controlMode
      && typeof controlMode.configuredMode === "function"
      ? controlMode.configuredMode(document)
      : "";
    result.sparkReady = {
      inert: spark.hasAttribute("inert"),
      disabled: spark.getAttribute("aria-disabled"),
      compiler: typeof window.AbracadabraCompiler,
      controlModeApi: typeof controlMode,
      configuredControlMode,
      controlModeMeta:
        document.querySelector('meta[name="sitesourcery-abracadabra-control-mode"]')
          ?.getAttribute("content") || "",
      controlRoomPresent: Boolean(controlRoom),
      hostedControlScriptPresent: Array.from(document.scripts).some((script) =>
        new URL(script.src, location.href).pathname
          === "/abracadabra/app/abracadabra-control.js"
      ),
      accountControlCount: document.querySelectorAll(
        "[data-create-account], [data-sign-in], [data-recover-account]"
      ).length,
      publishControlCount: document.querySelectorAll("[data-publish], [data-unpublish]").length,
      controlReady: controlRoom?.getAttribute("data-control-ready") || "",
      documentControlReady: root.getAttribute("data-abracadabra-control-ready") || ""
    };
  }
  const startChooser = document.querySelector("[data-start-chooser]");
  if (startChooser) {
    const visible = (element) => {
      if (!element || element.hidden) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const startPaths = Array.from(startChooser.querySelectorAll("[data-start-path]"));
    result.startReady = {
      visible: visible(startChooser),
      paths: startPaths.map((pathButton) => pathButton.getAttribute("data-start-path")),
      pathsVisible: startPaths.every(visible),
      detailVisible: visible(startChooser.querySelector('[data-start-step="detail"]')),
      resultVisible: visible(startChooser.querySelector("[data-start-result]"))
    };
  }
  result.helpHeadingLeading = Array.from(
    document.querySelectorAll(".help-flow-heading h2")
  ).map((heading) => {
    const style = getComputedStyle(heading);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight)
    };
  });
  result.aboutAccountabilitySizes = Array.from(
    document.querySelectorAll(".about-accountability p")
  ).map((paragraph) => Number.parseFloat(getComputedStyle(paragraph).fontSize));
  const abracadabraHeroAction = document.querySelector(
    ".abracadabra-hero .hero-actions .button-primary"
  );
  result.abracadabraHeroAction = abracadabraHeroAction
    ? (() => {
      const rect = abracadabraHeroAction.getBoundingClientRect();
      const style = getComputedStyle(abracadabraHeroAction);
      const visiblePixels = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      return {
        bottom: Math.round(rect.bottom * 10) / 10,
        meaningful: style.display !== "none"
          && style.visibility === "visible"
          && visiblePixels >= Math.min(rect.height, 44),
        top: Math.round(rect.top * 10) / 10,
        visiblePixels: Math.round(visiblePixels * 10) / 10
      };
    })()
    : null;
  result.flattenedCreativeSpecimens = document.querySelectorAll(
    ".creative-specimen [role='img']"
  ).length;
  result.workProofDisclosures = Array.from(
    document.querySelectorAll(".demonstration-card")
  ).map((card) => {
    const disclosure = card.querySelector(".artifact-disclosure");
    const screen = card.querySelector(".demonstration-screen");
    if (!disclosure || !screen) return { missing: true };
    const disclosureRect = disclosure.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    return {
      missing: false,
      text: disclosure.textContent.trim(),
      fontSize: Number.parseFloat(getComputedStyle(disclosure).fontSize),
      overlapsScreen: disclosureRect.bottom > screenRect.top + 1
        && disclosureRect.top < screenRect.bottom - 1
    };
  });
  return result;
})()`;

const NO_SCRIPT_AUDIT_EXPRESSION = `(() => {
  const root = document.documentElement;
  const body = document.body;
  const visible = (element) => {
    if (!element || element.hidden || element.closest("[hidden]")) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number.parseFloat(style.opacity) > 0
      && rect.width > 0
      && rect.height > 0;
  };
  const originalX = window.scrollX;
  window.scrollTo(200, window.scrollY);
  const reachableX = window.scrollX;
  window.scrollTo(originalX, window.scrollY);
  const main = document.querySelector("main");
  const nav = document.querySelector("[data-primary-nav]");
  const navLinks = nav ? Array.from(nav.querySelectorAll("a[href]")) : [];
  const menuButton = document.querySelector("[data-menu-button]");
  const startChooser = document.querySelector("[data-start-chooser]");
  const startFallback = document.querySelector(".start-noscript");
  const hive = document.querySelector("[data-hive-planner]");
  const hiveFallback = hive?.previousElementSibling?.matches(".boundary-note")
    ? hive.previousElementSibling
    : document.querySelector("#planner noscript .boundary-note");
  const sparkFallback = document.querySelector(".spark-noscript");
  const sparkMaker = document.querySelector("#spark-maker");
  const showcaseFallback = document.querySelector(".abracadabra-noscript");
  const showcaseFrames = Array.from(document.querySelectorAll("[data-abracadabra-showcase]"));
  const showcaseStatuses = Array.from(document.querySelectorAll("[data-showcase-status]"));
  return {
    brokenImages: Array.from(document.images)
      .filter((image) => !image.complete || image.naturalWidth === 0)
      .map((image) => image.getAttribute("src") || ""),
    documentWidth: Math.max(root.scrollWidth, body ? body.scrollWidth : 0),
    h1Count: document.querySelectorAll("h1").length,
    hasJsClass: root.classList.contains("js"),
    mainTextLength: (main?.innerText || "").trim().length,
    mainVisible: visible(main),
    menuButtonVisible: visible(menuButton),
    navEntries: navLinks.map((link) => ({
      ariaCurrent: link.getAttribute("aria-current") || "",
      className: typeof link.className === "string" ? link.className : "",
      href: link.getAttribute("href") || "",
      label: (link.textContent || "").replace(/\\s+/gu, " ").trim(),
      visible: visible(link)
    })),
    navVisibleLinks: navLinks.filter(visible).length,
    path: location.pathname,
    reachableX,
    start: startChooser || startFallback ? {
      chooserVisible: visible(startChooser),
      fallbackLinks: startFallback
        ? Array.from(startFallback.querySelectorAll("a[href]"))
          .map((link) => link.getAttribute("href") || "")
        : [],
      fallbackVisible: visible(startFallback)
    } : null,
    hive: hive ? {
      disabledCells: Array.from(hive.querySelectorAll("[data-hive-cell]"))
        .filter((control) => control.disabled).length,
      disabledOperationControls: Array.from(
        hive.querySelectorAll("[data-hive-pause], [data-hive-download]")
      ).filter((control) => control.disabled).length,
      fallbackChoices: hiveFallback
        ? hiveFallback.querySelectorAll("li").length
        : 0,
      fallbackExamples: hiveFallback
        ? Array.from(hiveFallback.querySelectorAll("[data-hive-noscript-cell]"))
          .map((item) => ({
            id: item.getAttribute("data-hive-noscript-cell") || "",
            label: item.querySelector("strong")?.textContent.trim() || "",
            result: item.querySelector("[data-hive-noscript-result]")?.textContent.trim() || ""
          }))
        : [],
      fallbackVisible: visible(hiveFallback),
      laterStagesHidden: Array.from(hive.querySelectorAll("[data-hive-stage]"))
        .slice(1)
        .filter((stage) => stage.hidden).length,
      laterStagesInert: Array.from(hive.querySelectorAll("[data-hive-stage]"))
        .slice(1)
        .filter((stage) => stage.inert).length
    } : null,
    spark: sparkMaker || sparkFallback ? {
      fallbackVisible: visible(sparkFallback),
      makerLocked: Boolean(
        sparkMaker
        && (sparkMaker.inert || sparkMaker.getAttribute("aria-disabled") === "true")
      )
    } : null,
    showcase: showcaseFrames.length ? {
      fallbackVisible: visible(showcaseFallback),
      frames: showcaseFrames.length,
      framesWithGeneratedSource: showcaseFrames.filter((frame) =>
        frame.hasAttribute("srcdoc") || frame.hasAttribute("src")
      ).length,
      guideHref:
        document.querySelector('a[href="/abracadabra/how/"]')?.getAttribute("href") || "",
      truthfulStaticStatuses: showcaseStatuses.filter((status) =>
        status.textContent.trim()
          === "Static fictional preview shown. JavaScript opens the generated example."
      ).length
    } : null,
    viewportWidth: root.clientWidth
  };
})()`;

const REDUCED_MOTION_AUDIT_EXPRESSION = `(() => {
  const milliseconds = (value) => String(value)
    .split(",")
    .map((part) => {
      const token = part.trim();
      const amount = Number.parseFloat(token);
      if (!Number.isFinite(amount)) return Infinity;
      return token.endsWith("ms") ? amount : amount * 1000;
    });
  const identityTransform = (value) => {
    if (value === "none") return true;
    try {
      return new DOMMatrixReadOnly(value).isIdentity;
    } catch {
      return false;
    }
  };
  const failures = Array.from(document.querySelectorAll("body *"))
    .map((element) => {
      const style = getComputedStyle(element);
      return {
        animationMs: Math.max(...milliseconds(style.animationDuration)),
        className: typeof element.className === "string" ? element.className : "",
        tag: element.tagName.toLowerCase(),
        transitionMs: Math.max(...milliseconds(style.transitionDuration))
      };
    })
    .filter((entry) => entry.animationMs > 1 || entry.transitionMs > 1)
    .slice(0, 20);
  const revealFailures = Array.from(document.querySelectorAll(".reveal"))
    .map((element) => {
      const style = getComputedStyle(element);
      return {
        identityTransform: identityTransform(style.transform),
        opacity: style.opacity,
        transform: style.transform
      };
    })
    .filter((entry) => entry.opacity !== "1" || !entry.identityTransform)
    .slice(0, 20);
  return {
    failures,
    h1Count: document.querySelectorAll("h1").length,
    path: location.pathname,
    revealFailures,
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior
  };
})()`;

const MENU_EXERCISE_EXPRESSION = `(async () => {
  const button = document.querySelector("[data-menu-button]");
  const menu = document.querySelector("[data-menu]");
  if (!button || !menu) return null;
  const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const root = document.documentElement;
  const describe = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || "",
      className: typeof element.className === "string" ? element.className : "",
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      overflowX: getComputedStyle(element).overflowX
    };
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && rect.width > 0
      && rect.height > 0;
  };
  button.click();
  await settle();
  const menuRect = menu.getBoundingClientRect();
  const headerDescendants = Array.from(
    document.querySelectorAll(".site-header, .site-header *")
  ).filter(visible);
  const headerOverflow = {
    bounds: headerDescendants
      .map(describe)
      .filter((entry) => entry.left < -1 || entry.right > root.clientWidth + 1),
    internal: headerDescendants
      .map(describe)
      .filter((entry) => entry.scrollWidth > entry.clientWidth + 1)
  };
  const destinations = [];
  for (const link of Array.from(menu.querySelectorAll("a[href]"))) {
    link.scrollIntoView({ block: "nearest", inline: "nearest" });
    await settle();
    const rect = link.getBoundingClientRect();
    const visibleTop = Math.max(0, menuRect.top);
    const visibleBottom = Math.min(window.innerHeight, menuRect.bottom);
    destinations.push({
      ariaCurrent: link.getAttribute("aria-current") || "",
      className: typeof link.className === "string" ? link.className : "",
      href: link.getAttribute("href") || "",
      label: (link.textContent || "").replace(/\\s+/gu, " ").trim(),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      horizontallyContained: rect.left >= -1 && rect.right <= root.clientWidth + 1,
      verticallyContained: rect.top >= visibleTop - 1 && rect.bottom <= visibleBottom + 1,
      visible: visible(link)
    });
  }
  const opened = {
    expanded: button.getAttribute("aria-expanded"),
    open: menu.hasAttribute("data-open"),
    firstLinkFocused: document.activeElement === menu.querySelector("a[href]"),
    rendered: visible(menu),
    menuLeft: Math.round(menuRect.left),
    menuRight: Math.round(menuRect.right),
    headerOverflow,
    destinations
  };
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  const escaped = {
    expanded: button.getAttribute("aria-expanded"),
    open: menu.hasAttribute("data-open"),
    buttonFocused: document.activeElement === button
  };
  button.click();
  await settle();
  const firstLink = menu.querySelector("a[href]");
  firstLink.addEventListener("click", (event) => event.preventDefault(), { once: true });
  firstLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await settle();
  const selected = {
    expanded: button.getAttribute("aria-expanded"),
    open: menu.hasAttribute("data-open")
  };
  return { escaped, opened, selected };
})()`;

const SOLUTIONS_PRIMARY_ANCHOR_EXERCISE_EXPRESSION = `(async () => {
  const target = document.querySelector("#assessment");
  const kicker = target?.querySelector(".solution-card-head .card-kicker");
  const heading = target?.querySelector(".solution-card-head h2");
  const header = document.querySelector(".site-header");
  if (!target || !kicker || !heading || !header) return null;
  history.replaceState(null, "", location.pathname + location.search);
  location.hash = "assessment";
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const headerRect = header.getBoundingClientRect();
  const kickerRect = kicker.getBoundingClientRect();
  const headingRect = heading.getBoundingClientRect();
  return {
    hash: location.hash,
    obstructionBottom: Math.round(headerRect.bottom),
    kickerTop: Math.round(kickerRect.top),
    headingTop: Math.round(headingRect.top),
    headingBottom: Math.round(headingRect.bottom)
  };
})()`;

const SETTLE_IMAGES_EXPRESSION = `(async () => {
  return Promise.all(Array.from(document.images).map(async (image) => {
    image.loading = "eager";
    if (!image.complete) {
      await Promise.race([
        new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        }),
        new Promise((resolve) => setTimeout(resolve, 5000))
      ]);
    }
    return {
      src: image.getAttribute("src") || "",
      complete: image.complete,
      naturalWidth: image.naturalWidth
    };
  }));
})()`;

const CONTROLLER_DRAFT_EXERCISE_EXPRESSION = `(async () => {
  const set = (name, value) => {
    const control = document.querySelector('[name="' + name + '"]');
    if (!control) throw new Error("Missing controller field " + name);
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const click = (selector) => {
    const control = document.querySelector(selector);
    if (!control) throw new Error("Missing controller action " + selector);
    control.click();
  };
  const width = String(window.innerWidth);
  set("accountName", "Draft Switch Audit");
  set("organizationName", "Draft Switch Audit " + width);
  set("accountEmail", "draft-switch-" + width + "@example.com");
  set("accountPassword", "correct horse battery staple");
  click("[data-create-account]");

  const createProject = (name, label) => {
    click("[data-new-project]");
    set("projectName", name);
    set("addressLabel", label);
    set("projectTermsAccepted", true);
    click("[data-create-project]");
  };
  createProject("First rapid-switch project", "rapid-first-" + width);
  createProject("Second rapid-switch project", "rapid-second-" + width);

  const buttons = Array.from(document.querySelectorAll("[data-project-id]"));
  const firstButton = buttons.find((button) => button.textContent.includes("First rapid-switch"));
  const secondButton = buttons.find((button) => button.textContent.includes("Second rapid-switch"));
  if (!firstButton || !secondButton) throw new Error("Rapid-switch projects were not created");
  firstButton.click();
  click("[data-toggle-settings]");
  set("manageAddressMode", "mode_b");
  set("manageAddressLabel", "unsaved-first-label");
  set("manageDomainPath", "byod");
  set("manageOwnedDomain", "unsaved-first.example");
  set("manageDomainProofMethod", "dns_challenge");
  set("manageDomainProofReference", "proof-must-not-cross-projects");
  set("manageVisibility", "private");
  set("manageAccessPassword", "private-must-not-cross-projects");
  set("supportSubject", "support subject must not cross");
  set("supportMessage", "support message must not cross selected project boundaries");
  set("safetyAppeal", "appeal must not cross selected project boundaries");
  window.dispatchEvent(new CustomEvent("abracadabra:draftchange", {
    detail: { raw: { businessName: "First sentinel", summary: "belongs-to-first-" + width } }
  }));
  secondButton.click();
  await new Promise((resolve) => setTimeout(resolve, 500));

  const key = window.SiteSourceryAbracadabraPlatform.STORE_KEY;
  let stored = JSON.parse(window.localStorage.getItem(key));
  let first = stored.projects.find((project) => project.id === firstButton.dataset.projectId);
  let second = stored.projects.find((project) => project.id === secondButton.dataset.projectId);
  const transientSecond = {
    activeProjectId: document.querySelector('[data-project-id][aria-current="true"]')?.dataset.projectId || "",
    addressLabel: document.querySelector('[name="manageAddressLabel"]')?.value || "",
    addressMode: document.querySelector('[name="manageAddressMode"]')?.value || "",
    domainPath: document.querySelector('[name="manageDomainPath"]')?.value || "",
    domainProofMethod: document.querySelector('[name="manageDomainProofMethod"]')?.value || "",
    domainProofReference: document.querySelector('[name="manageDomainProofReference"]')?.value || "",
    ownedDomain: document.querySelector('[name="manageOwnedDomain"]')?.value || "",
    passphrase: document.querySelector('[name="manageAccessPassword"]')?.value || "",
    safetyAppeal: document.querySelector('[name="safetyAppeal"]')?.value || "",
    settingsHidden: document.querySelector("[data-project-settings]")?.hidden === true,
    supportMessage: document.querySelector('[name="supportMessage"]')?.value || "",
    supportSubject: document.querySelector('[name="supportSubject"]')?.value || "",
    visibility: document.querySelector('[name="manageVisibility"]')?.value || ""
  };
  const afterSwitch = {
    activeSecond: document.querySelector('[data-project-id][aria-current="true"]')?.dataset.projectId
      === secondButton.dataset.projectId,
    firstSummary: first?.draft?.rawFacts?.summary || null,
    secondSummary: second?.draft?.rawFacts?.summary || null
  };

  click("[data-toggle-settings]");
  set("manageAddressLabel", "unsaved-second-label");
  set("supportSubject", "second project unsaved subject");
  set("supportMessage", "second project unsaved message must not cross");
  set("safetyAppeal", "second project unsaved appeal");
  firstButton.click();
  const transientFirst = {
    activeProjectId: document.querySelector('[data-project-id][aria-current="true"]')?.dataset.projectId || "",
    addressLabel: document.querySelector('[name="manageAddressLabel"]')?.value || "",
    addressMode: document.querySelector('[name="manageAddressMode"]')?.value || "",
    domainProofReference: document.querySelector('[name="manageDomainProofReference"]')?.value || "",
    ownedDomain: document.querySelector('[name="manageOwnedDomain"]')?.value || "",
    passphrase: document.querySelector('[name="manageAccessPassword"]')?.value || "",
    safetyAppeal: document.querySelector('[name="safetyAppeal"]')?.value || "",
    settingsHidden: document.querySelector("[data-project-settings]")?.hidden === true,
    supportMessage: document.querySelector('[name="supportMessage"]')?.value || "",
    supportSubject: document.querySelector('[name="supportSubject"]')?.value || "",
    visibility: document.querySelector('[name="manageVisibility"]')?.value || ""
  };
  secondButton.click();
  const originalConfirm = window.confirm;
  window.confirm = () => {
    firstButton.click();
    return true;
  };
  click("[data-delete-project]");
  window.confirm = originalConfirm;
  stored = JSON.parse(window.localStorage.getItem(key));
  const guardedAction = {
    activeProjectId: document.querySelector('[data-project-id][aria-current="true"]')?.dataset.projectId || "",
    firstLifecycle: stored.projects.find((project) => project.id === firstButton.dataset.projectId)?.lifecycle || "",
    secondLifecycle: stored.projects.find((project) => project.id === secondButton.dataset.projectId)?.lifecycle || "",
    status: document.querySelector("#platform-status")?.textContent || ""
  };
  secondButton.click();
  window.dispatchEvent(new CustomEvent("abracadabra:draftchange", {
    detail: { raw: { businessName: "Second sentinel", summary: "belongs-to-second-" + width } }
  }));
  await new Promise((resolve) => setTimeout(resolve, 500));
  stored = JSON.parse(window.localStorage.getItem(key));
  first = stored.projects.find((project) => project.id === firstButton.dataset.projectId);
  second = stored.projects.find((project) => project.id === secondButton.dataset.projectId);
  return {
    afterSwitch,
    guardedAction,
    sameProject: {
      firstSummary: first?.draft?.rawFacts?.summary || null,
      secondSummary: second?.draft?.rawFacts?.summary || null
    },
    transientFirst,
    transientSecond
  };
})()`;

const GUEST_FIRST_EXERCISE_EXPRESSION = `(async () => {
  const maker = document.querySelector("#spark-maker");
  const controlRoom = document.querySelector("#control-room");
  const workroom = document.querySelector("#workroom");
  const returning = document.querySelector("[data-open-account]");
  if (!maker || !controlRoom || !workroom || !returning) return null;
  const visible = (element) => {
    if (!element || element.hidden || element.closest("[hidden]")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const set = (root, name, value) => {
    const control = root.querySelector('[name="' + name + '"]');
    if (!control) throw new Error("Missing guest-first field " + name);
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const click = (root, selector) => {
    const control = root.querySelector(selector);
    if (!control) throw new Error("Missing guest-first action " + selector);
    control.click();
  };
  const waitUntil = async (predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return predicate();
  };
  const initial = {
    accountHidden: controlRoom.hidden,
    domOrderAligned: workroom.nextElementSibling === controlRoom,
    makerVisible: visible(maker),
    returningEnabled: !returning.disabled
  };

  set(maker, "businessName", "Guest First Studio");
  set(maker, "summary", "Makes careful website previews before account creation.");
  set(maker, "about", "A deterministic browser exercise for the guest-first Abracadabra path.");
  set(maker, "email", "guest-preview@example.com");
  click(maker, '[data-next="vibe"]');
  click(maker, '[data-next="truth"]');
  set(maker, "truthConfirmed", true);
  click(maker, "#make-preview");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const preview = {
    accountHidden: controlRoom.hidden,
    versionCount: maker.querySelectorAll("#spark-version-list li").length,
    srcdocLength: (maker.querySelector("#spark-preview").getAttribute("srcdoc") || "").length
  };

  click(maker, "[data-save-direction]");
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const saveChoice = {
    accountVisible: visible(controlRoom),
    createPanelVisible: visible(document.querySelector('[data-auth-panel="create"]')),
    domOrderAligned: Boolean(
      workroom.compareDocumentPosition(controlRoom) & Node.DOCUMENT_POSITION_FOLLOWING
    ),
    focusName: document.activeElement?.getAttribute("name") || "",
    renderedOrderAligned:
      workroom.getBoundingClientRect().top < controlRoom.getBoundingClientRect().top
  };

  const page = document;
  const width = String(window.innerWidth);
  set(page, "accountName", "Guest First Owner");
  set(page, "organizationName", "Guest First " + width);
  set(page, "accountEmail", "guest-first-" + width + "@example.com");
  set(page, "accountPassword", "correct horse battery staple");
  click(page, "[data-create-account]");
  const createButton = page.querySelector("[data-create-account]");
  await waitUntil(() => !createButton.disabled, 1000);
  return {
    initial,
    preview,
    saveChoice,
    providerHold: {
      authVisible: visible(document.querySelector("#platform-auth")),
      buttonEnabled: !createButton.disabled,
      dashboardHidden: document.querySelector("#platform-dashboard")?.hidden === true,
      previewStillVisible: visible(maker.querySelector("#spark-preview")),
      versionCount: maker.querySelectorAll("#spark-version-list li").length,
      status: document.querySelector("#platform-status")?.textContent || ""
    }
  };
})()`;

const PRIVATE_VIEWER_FIXTURE_EXPRESSION = `(() => {
  const module = window.SiteSourceryAbracadabraPlatform;
  const compiler = window.AbracadabraCompiler;
  if (
    !module
    || typeof module.createPlatform !== "function"
    || !compiler
    || typeof compiler.compileSite !== "function"
  ) {
    return { error: "platform or compiler module unavailable" };
  }
  window.localStorage.removeItem(module.STORE_KEY);
  window.sessionStorage.removeItem("sitesourcery.abracadabra.viewer-session.v1");
  const platform = module.createPlatform({ storage: window.localStorage });
  const account = platform.createAccount({
    name: "Private Viewer Audit Owner",
    organizationName: "Private Viewer Audit Studio",
    email: "private-viewer-audit@example.com",
    password: "correct horse battery staple"
  });
  const passphrase = "private opening phrase";
  const project = platform.createProject({
    accountId: account.id,
    name: "Private Viewer Audit Studio",
    address: { mode: "mode_a", label: "private-viewer-audit" },
    visibility: "private",
    accessPassword: passphrase,
    acceptedTerms: true
  });
  const rawFacts = {
    about: "A compiled customer-site fixture for one bounded browser interaction.",
    businessName: "Private Viewer Audit Studio",
    email: "",
    hours: "",
    location: "",
    offerings: ["One exact popup proof"],
    phone: "",
    primaryAction: "none",
    summary: "Exact compiler-produced private publication bytes.",
    theme: "clear",
    website: "${PRIVATE_VIEWER_POPUP_URL}"
  };
  const compiled = compiler.compileSite(rawFacts);
  const parsed = new DOMParser().parseFromString(compiled.html, "text/html");
  const cta = Array.from(parsed.querySelectorAll("a[href]"))
    .find((link) => link.href === "${PRIVATE_VIEWER_POPUP_URL}");
  const version = platform.saveVersion({
    accountId: account.id,
    projectId: project.id,
    rawFacts,
    artifact: {
      html: compiled.html,
      digest: module.sha256(compiled.html)
    },
    releaseAttestation: true
  });
  platform.markVersionReady({
    accountId: account.id,
    projectId: project.id,
    versionId: version.id
  });
  platform.acceptVersion({
    accountId: account.id,
    projectId: project.id,
    versionId: version.id
  });
  platform.activatePlan({
    accountId: account.id,
    projectId: project.id,
    localRehearsalAcknowledged: true
  });
  platform.publish({
    accountId: account.id,
    projectId: project.id,
    versionId: version.id
  });
  return {
    algorithm: project.access.credential.algorithm,
    artifactDigestMatches: compiled.artifactDigest === module.sha256(compiled.html),
    compilerSchema: compiled.schema,
    ctaHref: cta?.href || "",
    ctaRel: cta?.getAttribute("rel") || "",
    ctaTarget: cta?.target || "",
    projectId: project.id,
    rounds: project.access.credential.rounds,
    versionId: version.id
  };
})()`;

const PRIVATE_VIEWER_GATE_EXPRESSION = `(() => {
  const frame = document.querySelector("#published-site");
  const form = document.querySelector("#access-form");
  const passphrase = document.querySelector("#site-passphrase");
  const returnAction = document.querySelector('#status-actions a[href="/abracadabra/app/"]');
  const site = document.querySelector("#site-stage");
  return {
    accessFormVisible: Boolean(form && !form.hidden),
    frameHasSource: Boolean(frame && frame.hasAttribute("srcdoc")),
    passphraseFocused: document.activeElement === passphrase,
    returnActionVisible: Boolean(
      returnAction
      && returnAction.getClientRects().length
      && getComputedStyle(returnAction).visibility !== "hidden"
    ),
    returnHref: returnAction?.getAttribute("href") || "",
    siteHidden: Boolean(site && site.hidden),
    state: document.body.dataset.viewerState || ""
  };
})()`;

const PRIVATE_VIEWER_WRONG_PHRASE_EXPRESSION = `(async () => {
  const input = document.querySelector("#site-passphrase");
  const button = document.querySelector("[data-open-access]");
  const error = document.querySelector("#access-error");
  const frame = document.querySelector("#published-site");
  if (!input || !button || !error || !frame) return { missing: true };
  input.value = "incorrect opening phrase";
  button.click();
  const deadline = Date.now() + 30000;
  while (button.disabled && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return {
    completed: !button.disabled,
    error: error.hidden ? "" : error.textContent.trim(),
    frameHasSource: frame.hasAttribute("srcdoc"),
    state: document.body.dataset.viewerState || ""
  };
})()`;

const PRIVATE_VIEWER_CORRECT_PHRASE_EXPRESSION = `(async () => {
  const input = document.querySelector("#site-passphrase");
  const button = document.querySelector("[data-open-access]");
  const error = document.querySelector("#access-error");
  const frame = document.querySelector("#published-site");
  const site = document.querySelector("#site-stage");
  if (!input || !button || !error || !frame || !site) return { missing: true };
  input.value = "private opening phrase";
  button.click();
  const deadline = Date.now() + 30000;
  while (button.disabled && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const srcdoc = frame.getAttribute("srcdoc") || "";
  return {
    completed: !button.disabled,
    ctaPresent:
      srcdoc.includes('href="${PRIVATE_VIEWER_POPUP_URL}"')
      && srcdoc.includes('target="_blank"')
      && srcdoc.includes('rel="noopener noreferrer"'),
    errorHidden: error.hidden,
    proofPresent:
      srcdoc.includes("<title>Private Viewer Audit Studio</title>")
      && srcdoc.includes("Exact compiler-produced private publication bytes."),
    sandbox: frame.getAttribute("sandbox"),
    siteFocused: document.activeElement === site,
    siteVisible: !site.hidden,
    state: document.body.dataset.viewerState || ""
  };
})()`;

const PRIVATE_VIEWER_SESSION_EXPRESSION = `(async () => {
  const frame = document.querySelector("#published-site");
  const form = document.querySelector("#access-form");
  const site = document.querySelector("#site-stage");
  if (!frame || !form || !site) return { missing: true };
  const deadline = Date.now() + 10000;
  while (
    (document.body.dataset.viewerState !== "live" || site.hidden)
    && Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const srcdoc = frame.getAttribute("srcdoc") || "";
  return {
    accessFormHidden: form.hidden,
    proofPresent:
      srcdoc.includes("<title>Private Viewer Audit Studio</title>")
      && srcdoc.includes('href="${PRIVATE_VIEWER_POPUP_URL}"'),
    siteVisible: !site.hidden,
    state: document.body.dataset.viewerState || ""
  };
})()`;

const PRIVATE_VIEWER_STALE_GRACE_EXPRESSION = `(() => {
  const module = window.SiteSourceryAbracadabraPlatform;
  if (!module || !module.STORE_KEY) return { missing: true };
  const snapshot = JSON.parse(window.localStorage.getItem(module.STORE_KEY));
  const projectId = new URLSearchParams(location.search).get("project");
  const project = snapshot.projects.find((entry) => entry.id === projectId);
  if (!project) return { missing: true };
  project.billing.state = "grace";
  project.billing.firstFailedAt = "1999-12-18T00:00:00.000Z";
  project.billing.graceEndsAt = "2000-01-01T00:00:00.000Z";
  project.serving.state = "live";
  snapshot.revision += 1;
  snapshot.updatedAt = new Date().toISOString();
  window.localStorage.setItem(module.STORE_KEY, JSON.stringify(snapshot));
  return {
    billingState: project.billing.state,
    graceEndsAt: project.billing.graceEndsAt,
    servingState: project.serving.state
  };
})()`;

const PRIVATE_VIEWER_PLATFORM_MISSING_EXPRESSION = `(async () => {
  const frame = document.querySelector("#published-site");
  const site = document.querySelector("#site-stage");
  const status = document.querySelector("#status-stage");
  const title = document.querySelector("#status-title");
  const deadline = Date.now() + 10000;
  while (
    document.body.dataset.viewerState === "loading"
    && Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return {
    frameHasSource: Boolean(frame && frame.hasAttribute("srcdoc")),
    lifecyclePlatformType: typeof window.SiteSourceryAbracadabraPlatform,
    siteHidden: Boolean(site && site.hidden),
    state: document.body.dataset.viewerState || "",
    statusVisible: Boolean(status && !status.hidden),
    title: title?.textContent.trim() || ""
  };
})()`;

const PRIVATE_VIEWER_CLEANUP_EXPRESSION = `(() => {
  const module = window.SiteSourceryAbracadabraPlatform;
  window.localStorage.removeItem(
    module && module.STORE_KEY
      ? module.STORE_KEY
      : "sitesourcery.abracadabra.platform.v1"
  );
  window.sessionStorage.removeItem("sitesourcery.abracadabra.viewer-session.v1");
  return true;
})()`;

async function exercisePrivateViewerPopup(cdp) {
  const sendBounded = (
    checkpoint,
    method,
    params = {},
    timeoutMs = 3000,
    sessionId = "",
  ) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${checkpoint} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      cdp.send(method, params, sessionId).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  const proof = {
    cleanup: {
      attemptedTargetIds: [],
      closeErrors: [],
      discoveryDisabled: false,
      domDisabled: false,
      frameSessionDetached: false,
      listenersRemoved: false,
      remainingTargetIds: null,
    },
    click: null,
    error: "",
    frame: null,
    innerAfter: null,
    outerAfter: null,
    popup: null,
    windowOpen: null,
  };
  const baselineTargetIds = new Set();
  const createdTargets = new Map();
  const changedTargets = new Map();
  const destroyedTargetIds = new Set();
  const windowOpenEvents = [];
  let acceptPopupEvents = false;
  let attachedFrameSessionId = "";
  let discoveryEnabled = false;
  let domEnabled = false;
  let frameDomEnabled = false;
  let framePageEnabled = false;
  let offTargetCreated = () => {};
  let offTargetChanged = () => {};
  let offTargetDestroyed = () => {};
  let offWindowOpen = () => {};
  const nodeAttributes = (node) => {
    const attributes = {};
    for (let index = 0; index < (node?.attributes?.length ?? 0); index += 2) {
      attributes[node.attributes[index]] = node.attributes[index + 1] ?? "";
    }
    return attributes;
  };
  const collectDomNodes = (node, collection = []) => {
    if (!node) return collection;
    collection.push(node);
    for (const child of node.children ?? []) collectDomNodes(child, collection);
    for (const shadow of node.shadowRoots ?? []) collectDomNodes(shadow, collection);
    if (node.contentDocument) collectDomNodes(node.contentDocument, collection);
    return collection;
  };
  const inspectPublishedCta = async (checkpoint) => {
    const deep = await sendBounded(checkpoint, "DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    const owners = collectDomNodes(deep.root).filter((node) => {
      const attributes = nodeAttributes(node);
      return node.nodeName === "IFRAME" && attributes.id === "published-site";
    });
    if (owners.length !== 1) {
      throw new Error(`published-site owner count was ${owners.length}`);
    }
    const owner = owners[0];
    let contentDocument = owner.contentDocument;
    let domSessionId = "";
    let inspection = "DOM.getDocument(pierce)";
    if (!contentDocument) {
      const described = await sendBounded(
        `${checkpoint} owner content`,
        "DOM.describeNode",
        {
          backendNodeId: owner.backendNodeId,
          depth: -1,
          pierce: true,
        },
      );
      contentDocument = described.node.contentDocument;
    }
    if (!contentDocument) {
      if (!attachedFrameSessionId) {
        const targets = await sendBounded(
          `${checkpoint} frame targets`,
          "Target.getTargets",
        );
        const frameTargets = (targets.targetInfos ?? []).filter((target) =>
          target.type === "iframe"
          && target.url === "about:srcdoc"
        );
        if (frameTargets.length !== 1) {
          throw new Error("published-site frame target was not attached");
        }
        const attached = await sendBounded(
          `${checkpoint} attach frame target`,
          "Target.attachToTarget",
          {
            flatten: true,
            targetId: frameTargets[0].targetId,
          },
        );
        attachedFrameSessionId = attached.sessionId ?? "";
        if (!attachedFrameSessionId) {
          throw new Error("published-site frame target was not attached");
        }
        await sendBounded(
          `${checkpoint} enable frame page inspection`,
          "Page.enable",
          {},
          3000,
          attachedFrameSessionId,
        );
        framePageEnabled = true;
        await sendBounded(
          `${checkpoint} enable frame DOM inspection`,
          "DOM.enable",
          {},
          3000,
          attachedFrameSessionId,
        );
        frameDomEnabled = true;
      }
      const frameDocument = await sendBounded(
        `${checkpoint} attached frame document`,
        "DOM.getDocument",
        {
          depth: -1,
          pierce: true,
        },
        3000,
        attachedFrameSessionId,
      );
      contentDocument = frameDocument.root;
      domSessionId = attachedFrameSessionId;
      inspection = "Target.attachToTarget(flatten)";
    }
    if (!contentDocument) throw new Error("published-site contentDocument was not attached");
    const anchors = collectDomNodes(contentDocument).filter((node) => {
      const attributes = nodeAttributes(node);
      return node.nodeName === "A"
        && attributes.href === PRIVATE_VIEWER_POPUP_URL
        && attributes.target === "_blank"
        && attributes.rel === "noopener noreferrer";
    });
    if (anchors.length !== 1) {
      throw new Error(`exact compiled external CTA count was ${anchors.length}`);
    }
    return {
      anchor: anchors[0],
      anchorAttributes: nodeAttributes(anchors[0]),
      contentDocument,
      documentConnected: collectDomNodes(contentDocument)
        .some((node) => node.nodeName === "BODY"),
      domSessionId,
      inspection,
      owner,
      ownerAttributes: nodeAttributes(owner),
    };
  };

  try {
    await sendBounded("enable popup DOM inspection", "DOM.enable");
    domEnabled = true;
    let attachment = await waitForPrivateViewerAttachment(
      () => inspectPublishedCta("inspect compiled CTA attachment"),
    );
    const ownerEvaluation = await sendBounded("measure popup frame owner", "Runtime.evaluate", {
      expression: `(() => {
        const frame = document.querySelector("#published-site");
        if (!frame) return { missing: true };
        frame.scrollIntoView({ block: "nearest", inline: "nearest" });
        const rect = frame.getBoundingClientRect();
        return {
          rect: {
            height: rect.height,
            left: rect.left,
            top: rect.top,
            width: rect.width
          },
          sandbox: frame.getAttribute("sandbox") || "",
          sourceRetained: (frame.getAttribute("srcdoc") || "")
            .includes('href="${PRIVATE_VIEWER_POPUP_URL}"'),
          viewport: {
            height: window.innerHeight,
            width: window.innerWidth
          }
        };
      })()`,
      returnByValue: true,
    });
    const owner = ownerEvaluation.result?.value;
    if (ownerEvaluation.exceptionDetails || !owner || owner.missing) {
      throw new Error(
        `published-site frame owner was not measurable `
        + `${JSON.stringify(ownerEvaluation.exceptionDetails ?? owner ?? null)}`,
      );
    }
    await sendBounded(
      "scroll compiled CTA into view",
      "DOM.scrollIntoViewIfNeeded",
      { backendNodeId: attachment.anchor.backendNodeId },
      3000,
      attachment.domSessionId,
    );
    await delay(50);
    attachment = await waitForPrivateViewerAttachment(
      () => inspectPublishedCta("reinspect compiled CTA attachment"),
    );
    const box = await sendBounded("measure compiled CTA box", "DOM.getBoxModel", {
      backendNodeId: attachment.anchor.backendNodeId,
    }, 3000, attachment.domSessionId);
    const quad = box.model?.content;
    if (!Array.isArray(quad) || quad.length !== 8) {
      throw new Error(`compiled external CTA had no content quad ${JSON.stringify(quad ?? null)}`);
    }
    proof.frame = {
      contentDocumentBackendNodeId: attachment.contentDocument.backendNodeId,
      frameId: attachment.contentDocument.frameId || attachment.owner.frameId || "",
      inspection: attachment.inspection,
      ownerBackendNodeId: attachment.owner.backendNodeId,
      sandbox: owner.sandbox,
      sandboxRestrictsOriginAndScripts:
        owner.sandbox === "allow-popups"
        && !owner.sandbox.includes("allow-same-origin")
        && !owner.sandbox.includes("allow-scripts"),
    };

    const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
    const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
    const clickViewport = attachment.domSessionId
      ? owner.rect
      : owner.viewport;
    if (
      !Number.isFinite(x)
      || !Number.isFinite(y)
      || x < 0
      || y < 0
      || x > clickViewport.width
      || y > clickViewport.height
    ) {
      throw new Error(`compiled external CTA was not hit-testable at ${JSON.stringify({ x, y })}`);
    }

    const currentTarget = await sendBounded(
      "identify popup opener target",
      "Target.getTargetInfo",
    );
    if (currentTarget.targetInfo?.targetId) {
      baselineTargetIds.add(currentTarget.targetInfo.targetId);
    }
    const baseline = await sendBounded("record popup target baseline", "Target.getTargets");
    for (const target of baseline.targetInfos ?? []) baselineTargetIds.add(target.targetId);
    offTargetCreated = cdp.on("Target.targetCreated", ({ targetInfo }) => {
      if (!targetInfo?.targetId) return;
      if (!acceptPopupEvents) {
        baselineTargetIds.add(targetInfo.targetId);
        return;
      }
      createdTargets.set(targetInfo.targetId, targetInfo);
    });
    offTargetChanged = cdp.on("Target.targetInfoChanged", ({ targetInfo }) => {
      if (targetInfo?.targetId && createdTargets.has(targetInfo.targetId)) {
        changedTargets.set(targetInfo.targetId, targetInfo);
      }
    });
    offTargetDestroyed = cdp.on("Target.targetDestroyed", ({ targetId }) => {
      if (targetId) destroyedTargetIds.add(targetId);
    });
    offWindowOpen = cdp.on("Page.windowOpen", (event) => {
      windowOpenEvents.push(event);
    });
    await sendBounded(
      "enable popup target discovery",
      "Target.setDiscoverTargets",
      { discover: true },
    );
    discoveryEnabled = true;
    await delay(25);

    await sendBounded("move to compiled CTA", "Input.dispatchMouseEvent", {
      button: "none",
      buttons: 0,
      type: "mouseMoved",
      x,
      y,
    }, 3000, attachment.domSessionId);
    acceptPopupEvents = true;
    await sendBounded("press compiled CTA", "Input.dispatchMouseEvent", {
      button: "left",
      buttons: 1,
      clickCount: 1,
      type: "mousePressed",
      x,
      y,
    }, 3000, attachment.domSessionId);
    await sendBounded("release compiled CTA", "Input.dispatchMouseEvent", {
      button: "left",
      buttons: 0,
      clickCount: 1,
      type: "mouseReleased",
      x,
      y,
    }, 3000, attachment.domSessionId);
    proof.click = {
      backendNodeId: attachment.anchor.backendNodeId,
      coordinates: { x, y },
      href: attachment.anchorAttributes.href,
      interaction: "Input.dispatchMouseEvent",
      rel: attachment.anchorAttributes.rel,
      target: attachment.anchorAttributes.target,
    };

    const deadline = Date.now() + PRIVATE_VIEWER_POPUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const popupTarget = Array.from(createdTargets.values()).find((target) =>
        target.type === "page"
        && !baselineTargetIds.has(target.targetId)
      ) ?? null;
      const windowOpen = windowOpenEvents.find(({ url }) => url === PRIVATE_VIEWER_POPUP_URL);
      if (popupTarget && windowOpen) break;
      await delay(25);
    }
    proof.windowOpen = windowOpenEvents.find(({ url }) => url === PRIVATE_VIEWER_POPUP_URL)
      ?? windowOpenEvents[0]
      ?? null;
    const createdPopup = Array.from(createdTargets.values()).find((target) =>
      target.type === "page"
      && !baselineTargetIds.has(target.targetId)
    ) ?? null;
    const latestPopup = createdPopup?.targetId
      ? changedTargets.get(createdPopup.targetId) ?? createdPopup
      : null;
    proof.popup = latestPopup
      ? {
          createdEvent: Boolean(createdPopup),
          openerFrameId: latestPopup.openerFrameId ?? createdPopup?.openerFrameId ?? "",
          targetId: latestPopup.targetId,
          type: latestPopup.type,
          url: latestPopup.url,
        }
      : null;

    const outerAfterEvaluation = await sendBounded(
      "verify popup opener page",
      "Runtime.evaluate",
      {
      expression: `(() => {
        const frame = document.querySelector("#published-site");
        const site = document.querySelector("#site-stage");
        return {
          frameConnected: Boolean(frame?.isConnected),
          sandbox: frame?.getAttribute("sandbox") || "",
          siteHidden: Boolean(site?.hidden),
          sourceRetained: Boolean(
            frame
            && (frame.getAttribute("srcdoc") || "")
              .includes('href="${PRIVATE_VIEWER_POPUP_URL}"')
          ),
          state: document.body.dataset.viewerState || ""
        };
      })()`,
      returnByValue: true,
      },
    );
    proof.outerAfter = outerAfterEvaluation.result?.value ?? null;
    const innerAfter = await waitForPrivateViewerAttachment(
      () => inspectPublishedCta("verify popup opener DOM attachment"),
    );
    proof.innerAfter = {
      backendNodeId: innerAfter.anchor.backendNodeId,
      documentConnected: innerAfter.documentConnected,
      href: innerAfter.anchorAttributes.href,
      linkConnected: Boolean(innerAfter.anchor.backendNodeId),
      target: innerAfter.anchorAttributes.target,
    };
  } catch (error) {
    proof.error = error.message;
  } finally {
    try {
      const cleanupTargets = new Set(
        Array.from(createdTargets.values())
          .filter((target) =>
            target.type === "page"
            && !baselineTargetIds.has(target.targetId)
          )
          .map(({ targetId }) => targetId),
      );
      proof.cleanup.attemptedTargetIds = Array.from(cleanupTargets);
      for (const targetId of cleanupTargets) {
        try {
          await sendBounded(
            "close popup target",
            "Target.closeTarget",
            { targetId },
            2000,
          );
        } catch (error) {
          if (!destroyedTargetIds.has(targetId)) {
            proof.cleanup.closeErrors.push(`${targetId}: ${error.message}`);
          }
        }
      }
      const cleanupDeadline = Date.now() + 2000;
      let remainingTargetIds = [];
      do {
        const after = await sendBounded(
          "verify popup target cleanup",
          "Target.getTargets",
          {},
          2000,
        );
        remainingTargetIds = (after.targetInfos ?? [])
          .filter(({ targetId }) => cleanupTargets.has(targetId))
          .map(({ targetId }) => targetId);
        if (!remainingTargetIds.length) break;
        await delay(25);
      } while (Date.now() < cleanupDeadline);
      proof.cleanup.remainingTargetIds = remainingTargetIds;
    } catch (error) {
      proof.cleanup.closeErrors.push(error.message);
    }
    if (discoveryEnabled) {
      try {
        await sendBounded(
          "disable popup target discovery",
          "Target.setDiscoverTargets",
          { discover: false },
          2000,
        );
        proof.cleanup.discoveryDisabled = true;
      } catch (error) {
        proof.cleanup.closeErrors.push(`discovery cleanup: ${error.message}`);
      }
    }
    offTargetCreated();
    offTargetChanged();
    offTargetDestroyed();
    offWindowOpen();
    proof.cleanup.listenersRemoved = true;
    if (domEnabled) {
      try {
        await sendBounded("disable popup DOM inspection", "DOM.disable", {}, 2000);
        proof.cleanup.domDisabled = true;
      } catch (error) {
        proof.cleanup.closeErrors.push(`DOM cleanup: ${error.message}`);
      }
    }
    if (frameDomEnabled) {
      try {
        await sendBounded(
          "disable attached frame DOM inspection",
          "DOM.disable",
          {},
          2000,
          attachedFrameSessionId,
        );
      } catch (error) {
        proof.cleanup.closeErrors.push(`frame DOM cleanup: ${error.message}`);
      }
    }
    if (framePageEnabled) {
      try {
        await sendBounded(
          "disable attached frame page inspection",
          "Page.disable",
          {},
          2000,
          attachedFrameSessionId,
        );
      } catch (error) {
        proof.cleanup.closeErrors.push(`frame page cleanup: ${error.message}`);
      }
    }
    if (attachedFrameSessionId) {
      try {
        await sendBounded(
          "detach published-site frame target",
          "Target.detachFromTarget",
          { sessionId: attachedFrameSessionId },
          2000,
        );
        proof.cleanup.frameSessionDetached = true;
      } catch (error) {
        proof.cleanup.closeErrors.push(`frame target cleanup: ${error.message}`);
      }
    } else {
      proof.cleanup.frameSessionDetached = true;
    }
  }
  return proof;
}

const ABRACADABRA_REDUCED_MOTION_TRANSITION_EXPRESSION = `(async () => {
  const workroom = document.querySelector("#workroom");
  const controlRoom = document.querySelector("#control-room");
  const openAccount = document.querySelector("[data-open-account]");
  if (!workroom || !controlRoom || !openAccount) return null;
  const calls = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (options) {
    calls.push(options || null);
    return original.call(this, options);
  };
  try {
    openAccount.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  } finally {
    Element.prototype.scrollIntoView = original;
  }
  return {
    accountVisible: !controlRoom.hidden,
    behaviors: calls.map((options) => options && options.behavior || "auto"),
    domOrderAligned: workroom.nextElementSibling === controlRoom,
    focusName: document.activeElement?.getAttribute("name") || "",
    renderedOrderAligned:
      workroom.getBoundingClientRect().top < controlRoom.getBoundingClientRect().top
  };
})()`;

const SPARK_EXERCISE_EXPRESSION = `(async () => {
  const maker = document.querySelector("#spark-maker");
  const set = (name, value) => {
    const control = maker.querySelector('[name="' + name + '"]');
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const click = (selector) => {
    const control = maker.querySelector(selector);
    control.click();
  };
  const stepState = () => ({
    focused: document.activeElement?.getAttribute("data-step") || "",
    visible: Array.from(maker.querySelectorAll("[data-step]"))
      .filter((step) => !step.hidden)
      .map((step) => step.getAttribute("data-step"))
  });
  const progressive = { initial: stepState() };
  set("businessName", "Browser Audit Atelier");
  set("summary", "Builds carefully bounded digital places from supplied facts.");
  set("about", "A deterministic browser exercise for the working Spark path.");
  set("offerings", "Architecture\\nArt direction\\nImplementation");
  set("location", "New Jersey");
  set("email", "audit@example.com");
  set("primaryAction", "email");
  click('[data-next="vibe"]');
  progressive.vibe = stepState();
  const arcane = maker.querySelector('input[name="theme"][value="arcane"]');
  arcane.checked = true;
  arcane.dispatchEvent(new Event("input", { bubbles: true }));
  click('[data-next="truth"]');
  progressive.truth = stepState();
  const confirmation = maker.querySelector("#truth-confirmed");
  confirmation.checked = true;
  confirmation.dispatchEvent(new Event("input", { bubbles: true }));
  const hiddenSummary = maker.querySelector('[name="summary"]');
  hiddenSummary.value = "Builds carefully bounded digital places after a stale review check.";
  click("#make-preview");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const staleTruth = {
    previewVisible: !maker.querySelector('[data-step="preview"]').hidden,
    errorsVisible: !maker.querySelector("#spark-errors").hidden,
    confirmationChecked: confirmation.checked,
    reviewUpdated: maker.querySelector("#spark-truth-review").textContent.includes("stale review check")
  };
  confirmation.checked = true;
  confirmation.dispatchEvent(new Event("input", { bubbles: true }));
  click("#make-preview");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const first = {
    focused: document.activeElement?.getAttribute("data-step") || "",
    previewVisible: !maker.querySelector('[data-step="preview"]').hidden,
    srcdocLength: (maker.querySelector("#spark-preview").getAttribute("srcdoc") || "").length,
    primaryAction: (maker.querySelector("#spark-preview").getAttribute("srcdoc") || "")
      .includes('class="action primary" href="mailto:audit@example.com"'),
    versions: maker.querySelectorAll("#spark-version-list li").length,
    downloadEnabled: !maker.querySelector("#download-version").disabled
  };
  const originalOpen = window.open;
  let blockedOpen;
  try {
    window.open = () => null;
    click("#open-version");
    blockedOpen = {
      buttonEnabled: !maker.querySelector("#open-version").disabled,
      status: maker.querySelector("#spark-version-status").textContent
    };
  } finally {
    window.open = originalOpen;
  }
  click("[data-edit-facts]");
  progressive.factsAfterEdit = stepState();
  set("summary", "Builds memorable digital places from explicit reviewed facts.");
  click('[data-next="vibe"]');
  click('[data-next="truth"]');
  confirmation.checked = true;
  confirmation.dispatchEvent(new Event("input", { bubbles: true }));
  click("#make-preview");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const undo = maker.querySelector("#previous-version");
  const second = {
    versions: maker.querySelectorAll("#spark-version-list li").length,
    undoEnabled: !undo.disabled
  };
  undo.click();
  const afterUndo = {
    status: maker.querySelector("#spark-version-status").textContent,
    selected: maker.querySelectorAll('#spark-version-list button[aria-current="true"]').length
  };
  click("[data-edit-facts]");
  set("summary", "Builds a third branch without deleting either earlier version.");
  click('[data-next="vibe"]');
  click('[data-next="truth"]');
  confirmation.checked = true;
  confirmation.dispatchEvent(new Event("input", { bubbles: true }));
  click("#make-preview");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const branch = {
    versions: maker.querySelectorAll("#spark-version-list li").length,
    selected: maker.querySelectorAll('#spark-version-list button[aria-current="true"]').length
  };
  return { first, second, afterUndo, blockedOpen, branch, progressive, staleTruth };
})()`;

const HIVE_EXERCISE_EXPRESSION = `(() => {
  const root = document.querySelector("[data-hive-planner]");
  const stages = Array.from(root.querySelectorAll("[data-hive-stage]"));
  const customerFields = ${JSON.stringify(HIVE_CUSTOMER_FIELDS)};
  const forbiddenFields = ${JSON.stringify(HIVE_FORBIDDEN_PUBLIC_FIELDS)};
  const stageState = () => ({
    current: root.getAttribute("data-hive-stage-current"),
    hidden: stages.filter((stage) => stage.hidden)
      .map((stage) => Number(stage.getAttribute("data-hive-stage"))),
    inert: stages.filter((stage) => stage.inert)
      .map((stage) => Number(stage.getAttribute("data-hive-stage"))),
    startVisible: (() => {
      const start = root.querySelector("[data-hive-start]");
      return !start.hidden && getComputedStyle(start).display !== "none";
    })(),
    visible: stages.filter((stage) => !stage.hidden)
      .map((stage) => Number(stage.getAttribute("data-hive-stage")))
  });
  const nextEnabled = () => Array.from(root.querySelectorAll("[data-hive-next]"))
    .filter((button) => !button.disabled).length;
  return Array.from(root.querySelectorAll("[data-hive-cell]")).map((button, index) => {
    const priorStage = root.getAttribute("data-hive-stage-current");
    button.click();
    const output = root.querySelector("[data-hive-output]");
    const cellId = button.getAttribute("data-hive-cell");
    const blueprint = window.SiteSourceryHivePlanner.createBlueprint(cellId);
    const cell = window.SiteSourceryHivePlanner.cells.find((entry) => entry.id === cellId);
    const exported = window.SiteSourceryHivePlanner.exportBlueprint(cellId);
    const parsedExport = JSON.parse(exported);
    const afterChoice = stageState();
    const choiceFocus = document.activeElement === root.querySelector("#hive-result-title");
    const choiceNextEnabled = nextEnabled();
    const choiceBack = {
      disabled: root.querySelector("[data-hive-back]").disabled,
      hidden: root.querySelector("[data-hive-back]").hidden,
      label: root.querySelector("[data-hive-back]").textContent.trim()
    };
    root.querySelector('[data-hive-next="3"]').click();
    const afterTiming = stageState();
    const timingFocus = document.activeElement === root.querySelector("#hive-timing-title");
    const timingNextEnabled = nextEnabled();
    root.querySelector('[data-hive-next="4"]').click();
    const afterRules = stageState();
    const rulesFocus = document.activeElement === root.querySelector("#hive-rules-title");
    const rulesNextEnabled = nextEnabled();
    const pause = root.querySelector("[data-hive-pause]");
    pause.click();
    const paused = {
      root: root.getAttribute("data-hive-paused"),
      pressed: pause.getAttribute("aria-pressed"),
      label: pause.textContent,
      status: root.querySelector("[data-hive-pause-status]").textContent
    };
    pause.click();
    root.querySelector('[data-hive-next="5"]').click();
    const afterReview = stageState();
    const reviewFocus = document.activeElement === root.querySelector("#hive-review-title");
    const visibleCopy = document.body.innerText.replace(/\\s+/gu, " ").trim();
    return {
      requested: cellId,
      activationLocked: root.getAttribute("data-hive-activation") === "locked",
      priorStage,
      active: root.getAttribute("data-hive-active"),
      outputCell: output.getAttribute("data-hive-output-cell"),
      selected: root.querySelectorAll('[data-hive-selected="true"]').length,
      checked: root.querySelectorAll('[data-hive-cell][aria-checked="true"]').length,
      pressedAttributes: root.querySelectorAll("[data-hive-cell][aria-pressed]").length,
      radioGroup: root.querySelector(".hive-controls").getAttribute("role") === "radiogroup",
      radios: root.querySelectorAll('[data-hive-cell][role="radio"]').length,
      rovingTabStops: root.querySelectorAll('[data-hive-cell][tabindex="0"]').length,
      schema: blueprint.schema,
      status: blueprint.status,
      liveIntegration: blueprint.liveIntegration,
      noticeExact: blueprint.notice
        === "Planning only. This file did not send a message, change a calendar or invoice, save customer data, or connect another tool.",
      titleMatches: root.querySelector("[data-hive-title]").textContent === blueprint.cell.label,
      publicPlanComplete:
        Object.keys(blueprint).sort().join(",")
          === "cell,liveIntegration,notice,schema,status"
        && Object.keys(blueprint.cell).sort().join(",") === "customer,id,label"
        && Object.keys(blueprint.cell.customer).sort().join(",")
          === customerFields.join(",")
        && JSON.stringify(blueprint.cell.customer) === JSON.stringify(cell.customer)
        && Object.keys(cell).sort().join(",") === "customer,id,label",
      internalFieldsAbsent: forbiddenFields.every((field) =>
        !(field in blueprint)
        && !(field in blueprint.cell)
        && !(field in cell)
        && !exported.includes('"' + field + '"')
      ),
      exportMatches: exported.endsWith("\\n")
        && JSON.stringify(parsedExport) === JSON.stringify(blueprint),
      customerCopyMatches:
        root.querySelector("[data-hive-result]").textContent === cell.customer.result
        && root.querySelector("[data-hive-when]").textContent === cell.customer.when
        && root.querySelector("[data-hive-human]").textContent === cell.customer.human
        && root.querySelector("[data-hive-permission]").textContent === cell.customer.permission
        && root.querySelector("[data-hive-limit]").textContent === cell.customer.limit
        && root.querySelector("[data-hive-pause-copy]").textContent === cell.customer.pause,
      reviewMatches:
        root.querySelector("[data-hive-review-label]").textContent === cell.label
        && root.querySelector("[data-hive-review-result]").textContent === cell.customer.result
        && root.querySelector("[data-hive-review-when]").textContent === cell.customer.when
        && root.querySelector("[data-hive-review-human]").textContent === cell.customer.human
        && root.querySelector("[data-hive-review-permission]").textContent === cell.customer.permission
        && root.querySelector("[data-hive-review-limit]").textContent === cell.customer.limit
        && root.querySelector("[data-hive-review-pause]").textContent === cell.customer.pause,
      afterChoice,
      afterTiming,
      afterRules,
      afterReview,
      choiceFocus,
      timingFocus,
      rulesFocus,
      reviewFocus,
      choiceNextEnabled,
      timingNextEnabled,
      rulesNextEnabled,
      reviewNextEnabled: nextEnabled(),
      choiceBack,
      resetLaterProgress: (index === 0 || priorStage === "5")
        && afterChoice.current === "2"
        && afterChoice.hidden.includes(3)
        && afterChoice.hidden.includes(4)
        && afterChoice.hidden.includes(5),
      hashMatches: location.hash === "#" + cellId,
      downloadReady: root.querySelector("[data-hive-download]").disabled === false,
      writtenScopeLink:
        root.querySelector('a[href="/contact/#direct-contact"]')?.textContent.trim()
          === "Request written scope and price",
      plainVisibleCopy: !/\\b(?:bounded|artifact|authority|effects?|suppression)\\b|provider mutation/iu
        .test(visibleCopy),
      paused,
      resumed: root.getAttribute("data-hive-paused") === "false"
        && pause.getAttribute("aria-pressed") === "false"
    };
  });
})()`;

const HIVE_HISTORY_EXERCISE_EXPRESSION = `(async () => {
  const root = document.querySelector("[data-hive-planner]");
  const stage = () => root.getAttribute("data-hive-stage-current");
  const waitForStage = async (expected) => {
    const deadline = performance.now() + 1500;
    while (stage() !== expected && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (stage() === expected) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return stage() === expected;
  };
  const next = (target) => root.querySelector('[data-hive-next="' + target + '"]').click();
  const back = root.querySelector("[data-hive-back]");
  root.querySelector('[data-hive-cell="missed-call"]').click();
  next(3);
  next(4);
  next(5);
  const atReview = {
    stage: stage(),
    path: location.pathname,
    hash: location.hash,
    visible: !back.hidden,
    enabled: !back.disabled
  };
  back.click();
  const toolBackToRules = await waitForStage("4");
  const rulesFocus = document.activeElement === root.querySelector("#hive-rules-title");
  history.back();
  const browserBackToTiming = await waitForStage("3");
  const timingFocus = document.activeElement === root.querySelector("#hive-timing-title");
  back.click();
  const toolBackToResult = await waitForStage("2");
  back.click();
  const toolBackToChoose = await waitForStage("1");
  const startFocus = document.activeElement
    === root.querySelector("[data-hive-start] [data-hive-stage-heading]");
  const afterChoose = {
    active: root.hasAttribute("data-hive-active"),
    backDisabled: back.disabled,
    backHidden: back.hidden,
    checked: root.querySelectorAll('[data-hive-cell][aria-checked="true"]').length,
    hash: location.hash,
    path: location.pathname
  };
  const first = root.querySelector('[data-hive-cell="missed-call"]');
  const second = root.querySelector('[data-hive-cell="booking"]');
  first.focus();
  first.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    key: "ArrowDown"
  }));
  const keyboard = {
    active: root.getAttribute("data-hive-active"),
    checked: root.querySelectorAll('[data-hive-cell][aria-checked="true"]').length,
    focused: document.activeElement === second,
    pressedAttributes: root.querySelectorAll("[data-hive-cell][aria-pressed]").length,
    rovingTabStops: root.querySelectorAll('[data-hive-cell][tabindex="0"]').length,
    stage: stage()
  };
  return {
    afterChoose,
    atReview,
    browserBackToTiming,
    keyboard,
    rulesFocus,
    startFocus,
    timingFocus,
    toolBackToChoose,
    toolBackToResult,
    toolBackToRules
  };
})()`;

export const START_INITIAL_TABLE = Object.freeze([
  {
    key: "website",
    label: "A website",
    note: "Make a new site or replace one that already exists.",
  },
  {
    key: "system",
    label: "Calls and follow-up",
    note: "Stop missed calls, bookings, reviews, or payments from slipping.",
  },
  {
    key: "service",
    label: "Other website help",
    note: "Review an existing site, ask about upkeep, or solve one specific problem.",
  },
]);

export const START_BRANCH_TABLE = Object.freeze([
  {
    key: "website",
    question: "Is this a new website or a replacement?",
    options: [
      {
        key: "website-new",
        label: "A new website",
        note: "Nothing is being replaced. No old links or content need to move, and no host or domain switch is needed. You can still enter facts from a brochure or brand guide.",
      },
      {
        key: "website-replace",
        label: "Replace an existing site",
        note: "A site already exists, so links, content, tools, hosting, or the domain may need a safe move.",
      },
    ],
  },
  {
    key: "website-new",
    question: "How do you want the new website made?",
    options: [
      {
        key: "custom",
        label: "Make it for me",
        note: "I want professional planning, design, delivery, and human review.",
      },
      {
        key: "website-self-service",
        label: "Let me make one page",
        note: "I will type in the facts myself. No old links or content need to move, and no host or domain switch is needed.",
      },
    ],
  },
  {
    key: "website-self-service",
    question: "Does this one-page option fit?",
    options: [
      {
        key: "abracadabra",
        label: "Yes · nothing old needs replacing",
        note: "One page is enough. I can type the facts myself and do not need old links, content, outside tools, or human revisions.",
      },
      {
        key: "self-service-uncertain",
        label: "I am not completely sure",
        note: "I want a person to check before I risk losing content or links.",
      },
    ],
  },
  {
    key: "website-replace",
    question: "What must survive or change?",
    options: [
      {
        key: "replace-redirects",
        label: "Old links or search traffic",
        note: "Old page addresses need to keep working or point to the right new page.",
      },
      {
        key: "replace-migration",
        label: "Existing pages, words, or media",
        note: "Content must be reviewed, moved, reshaped, or preserved.",
      },
      {
        key: "replace-cutover",
        label: "Hosting, tools, or the switch",
        note: "The current host, domain, forms, tools, or launch timing matter.",
      },
      {
        key: "replace-uncertain",
        label: "I do not know what must survive",
        note: "I want a person to check the old site before I choose.",
      },
    ],
  },
  {
    key: "system",
    question: "Which handoff keeps falling through?",
    options: [
      {
        key: "hive-missed-call",
        label: "Missed calls",
        note: "A legitimate caller reaches nobody and the reason may disappear.",
      },
      {
        key: "hive-booking",
        label: "Booking",
        note: "Service, timing, location, or confirmation keeps getting lost.",
      },
      {
        key: "hive-review-request",
        label: "Review requests",
        note: "The right customers need one fair request at the right time.",
      },
      {
        key: "hive-after-hours",
        label: "After-hours questions",
        note: "People need approved facts without invented answers or urgency.",
      },
      {
        key: "hive-follow-up",
        label: "Follow-up",
        note: "A promised next step keeps disappearing during the day.",
      },
      {
        key: "hive-getting-paid",
        label: "Getting paid",
        note: "An unpaid invoice needs a clear reminder and a way to raise a problem.",
      },
      {
        key: "commission",
        label: "A different workflow",
        note: "The channels, rules, or handoff need to fit my business.",
      },
    ],
  },
  {
    key: "service",
    question: "Which supporting job is closest?",
    options: [
      {
        key: "assessment",
        label: "Website assessment",
        note: "I want evidence and ranked findings before choosing repairs.",
      },
      {
        key: "foundations",
        label: "Website foundations",
        note: "Structure, basic accessibility, speed, page information, or launch quality.",
      },
      {
        key: "care",
        label: "Care",
        note: "Maintenance, changes, monitoring, recovery, handoff, and exit.",
      },
      {
        key: "domains",
        label: "Domains",
        note: "Buy, connect, renew, or transfer an address.",
      },
      {
        key: "email",
        label: "Business email",
        note: "Addresses, delivery checks, routing, recovery, or moving mail.",
      },
      {
        key: "commerce",
        label: "Commerce",
        note: "Products, buying, delivery, receipts, refunds, or a payment service.",
      },
      {
        key: "interfaces",
        label: "Interfaces",
        note: "Focused controls for a phone, tablet, counter, kiosk, or screen.",
      },
      {
        key: "studio",
        label: "Studio",
        note: "Art direction, illustration, motion, editorial, or a campaign piece.",
      },
      {
        key: "network",
        label: "Connections",
        note: "Listings, directories, referrals, resources, or community discovery.",
      },
    ],
  },
]);

export const START_DECISION_TABLE = Object.freeze([
  { key: "website-custom", path: ["website", "website-new", "custom"], title: "Custom — made for you", action: "See Custom websites", href: "/custom/", copy: "Choose Custom when you want the site planned, designed, built, and reviewed with you, or when an old site must be replaced safely." },
  { key: "website-abracadabra", path: ["website", "website-new", "website-self-service", "abracadabra"], title: "Abracadabra — make it yourself", action: "Try Abracadabra", href: "/abracadabra/", copy: "Make and download one real web page from facts you type into this browser. It does not put the page online, replace an old site, move content, change a domain, connect outside tools, or include human revisions." },
  { key: "website-self-service-uncertain", path: ["website", "website-new", "website-self-service", "self-service-uncertain"], title: "Ask a human before choosing", action: "Contact the studio", href: "/contact/", copy: "If you are not sure one page and manual entry are enough, ask the studio to check first." },
  { key: "website-replace-redirects", path: ["website", "website-replace", "replace-redirects"], title: "Custom — protect old links", action: "See Custom websites", href: "/custom/", copy: "Old page addresses and search traffic need a careful list and redirect plan before the new site replaces the old one." },
  { key: "website-replace-migration", path: ["website", "website-replace", "replace-migration"], title: "Custom — move the content", action: "See Custom websites", href: "/custom/", copy: "Existing pages, words, or images need a person to review what stays, what changes, and where it belongs." },
  { key: "website-replace-cutover", path: ["website", "website-replace", "replace-cutover"], title: "Custom — plan the switch", action: "See Custom websites", href: "/custom/", copy: "Hosting, forms, outside tools, domains, and launch timing need a written moving plan." },
  { key: "website-replace-uncertain", path: ["website", "website-replace", "replace-uncertain"], title: "Start with a human review", action: "Contact the studio", href: "/contact/", copy: "Ask the studio to inspect the old links, content, hosting, tools, and domain before choosing how to replace the site." },
  { key: "system-missed-call", path: ["system", "hive-missed-call"], title: "Hive · Missed-call responder", action: "Inspect missed-call responder", href: "/hive/#missed-call", copy: "See a plan for recording a missed call, sending an allowed reply, handing it to a person, and stopping the system." },
  { key: "system-booking", path: ["system", "hive-booking"], title: "Hive · Booking guide", action: "Inspect booking guide", href: "/hive/#booking", copy: "See a booking plan that treats times as open until the booking service confirms them." },
  { key: "system-review-request", path: ["system", "hive-review-request"], title: "Hive · Review request", action: "Inspect review request", href: "/hive/#review-request", copy: "See a fair review-request plan with clear timing, permission, stop rules, and a path for problems." },
  { key: "system-after-hours", path: ["system", "hive-after-hours"], title: "Hive · After-hours information", action: "Inspect after-hours information", href: "/hive/#after-hours", copy: "See an after-hours plan that uses approved facts and sends unclear or urgent questions to a person." },
  { key: "system-follow-up", path: ["system", "hive-follow-up"], title: "Hive · Follow-up", action: "Inspect follow-up", href: "/hive/#follow-up", copy: "See a follow-up plan that keeps the reason, owner, due time, permission, and human decision clear." },
  { key: "system-getting-paid", path: ["system", "hive-getting-paid"], title: "Hive · Getting-paid reminder", action: "Inspect getting-paid reminder", href: "/hive/#getting-paid", copy: "See an invoice reminder plan that stops when the balance, identity, credit, or dispute is unclear." },
  { key: "system-commission", path: ["system", "commission"], title: "Ask about a working system", action: "Discuss the system", href: "/contact/", copy: "A separate project may fit when the messages, rules, outside services, controls, or handoff must match your business." },
  { key: "service-assessment", path: ["service", "assessment"], title: "Website assessment", action: "Explore the assessment", href: "/solutions/#assessment", copy: "Choose the assessment for written findings, screenshots, and a clear order of importance before deciding on fixes." },
  { key: "service-foundations", path: ["service", "foundations"], title: "Website foundations", action: "Explore foundations", href: "/solutions/#foundations", copy: "Ask about foundations for site structure, basic accessibility, speed, page information, measurement, or launch quality." },
  { key: "service-care", path: ["service", "care"], title: "Care", action: "Explore Care", href: "/solutions/#care", copy: "Ask about Care for a written maintenance, change, monitoring, recovery, handoff, and exit agreement." },
  { key: "service-domains", path: ["service", "domains"], title: "Domains", action: "See possible domain help", href: "/solutions/#domains", copy: "Ask whether help is available for registration, connection, renewal, or transfer. Ownership, price, and provider terms must be confirmed first." },
  { key: "service-email", path: ["service", "email"], title: "Business email", action: "Explore business email", href: "/solutions/#email", copy: "Ask about business email for role addresses, delivery checks, routing, recovery, moving mail, and exit notes." },
  { key: "service-commerce", path: ["service", "commerce"], title: "Commerce", action: "See possible commerce help", href: "/solutions/#commerce", copy: "Ask whether help is available for product pages and a path to a client-owned payment service." },
  { key: "service-interfaces", path: ["service", "interfaces"], title: "Interfaces", action: "Explore Interfaces", href: "/solutions/#interfaces", copy: "Ask about a focused screen with clear permissions, visible errors, and a manual backup." },
  { key: "service-studio", path: ["service", "studio"], title: "Studio", action: "Explore Studio", href: "/solutions/#studio", copy: "Ask about one focused design, illustration, motion, story, campaign, or printed-and-digital piece." },
  { key: "service-network", path: ["service", "network"], title: "Connections", action: "Explore Connections", href: "/solutions/#network", copy: "Ask about local listings, directories, referrals, shared resources, or community discovery." },
]);

export const START_BACK_TABLE = Object.freeze([
  { key: "website-to-need", path: ["website"], returnsToNeed: true },
  { key: "new-to-website", path: ["website", "website-new"], previousBranch: "website", previousQuestion: "Is this a new website or a replacement?" },
  { key: "self-service-to-new", path: ["website", "website-new", "website-self-service"], previousBranch: "website-new", previousQuestion: "How do you want the new website made?" },
  { key: "replacement-to-website", path: ["website", "website-replace"], previousBranch: "website", previousQuestion: "Is this a new website or a replacement?" },
  { key: "system-to-need", path: ["system"], returnsToNeed: true },
  { key: "service-to-need", path: ["service"], returnsToNeed: true },
]);

function startInitialControlsPass(snapshot) {
  return Boolean(
    snapshot
    && snapshot.humanHref === "tel:+18562441220"
    && snapshot.humanTag === "A"
    && snapshot.humanText === "call Zack at (856) 244-1220"
    && snapshot.humanControl?.usable
    && snapshot.pathsVisible
    && snapshot.pathsAreButtons
    && snapshot.pathControls?.length === START_INITIAL_TABLE.length
    && snapshot.pathControls.every(({ usable }) => usable)
    && JSON.stringify(snapshot.options) === JSON.stringify(START_INITIAL_TABLE)
    && snapshot.touchFailures?.length === 0
  );
}

const START_EXERCISE_EXPRESSION = `(async () => {
  const root = document.querySelector("[data-start-chooser]");
  if (!root) return null;
  const expectedBranches = ${JSON.stringify(START_BRANCH_TABLE)};
  const expectedLeaves = ${JSON.stringify(START_DECISION_TABLE)};
  const backCases = ${JSON.stringify(START_BACK_TABLE)};
  const settle = () => new Promise((resolve) => {
    let frames = 0;
    const inspect = () => {
      frames += 1;
      const revealState = root.getAttribute("data-start-reveal");
      if ((frames >= 2 && revealState !== "pending") || frames >= 24) {
        resolve();
        return;
      }
      requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
  });
  const visible = (element) => {
    if (!element || element.hidden) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const describeRenderedVisibility = (element) => {
    if (!element) {
      return {
        ancestorOpacityVisible: false,
        browserVisible: false,
        effectiveVisible: false,
        pointerEventsEnabled: false,
        rendered: false
      };
    }
    const rect = element.getBoundingClientRect();
    let ancestorOpacityVisible = true;
    let pointerEventsEnabled = true;
    for (let current = element; current; current = current.parentElement) {
      const currentStyle = getComputedStyle(current);
      if (Number.parseFloat(currentStyle.opacity || "0") <= 0) {
        ancestorOpacityVisible = false;
      }
      if (currentStyle.pointerEvents === "none") {
        pointerEventsEnabled = false;
      }
    }
    const hidden = Boolean(element.closest("[hidden]"));
    const ariaHidden = Boolean(element.closest('[aria-hidden="true"]'));
    const inert = Boolean(element.closest("[inert]"));
    const rendered = Boolean(
      element.getClientRects().length
      && rect.width > 0
      && rect.height > 0
    );
    const browserVisible = typeof element.checkVisibility === "function"
      ? element.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
        contentVisibilityAuto: true
      })
      : rendered && ancestorOpacityVisible;
    // This predicate covers effective rendered visibility, but does not claim
    // detection of visual occlusion or clipping by an overlapping/overflowing
    // element. Those require a separately specified and tested contract.
    return {
      ancestorOpacityVisible,
      ariaHidden,
      browserVisible,
      effectiveVisible: Boolean(
        browserVisible
        && ancestorOpacityVisible
        && !hidden
        && !ariaHidden
        && !inert
        && rendered
      ),
      hidden,
      inert,
      pointerEventsEnabled,
      rendered
    };
  };
  const touchFailures = () => Array.from(root.querySelectorAll(
    "a[href], button, summary, input:not([type='hidden']), select, textarea"
  ))
    .filter((element) =>
      !element.matches(".skip-link")
      && !element.disabled
      && element.getAttribute("aria-hidden") !== "true"
      && visible(element)
    )
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: Math.round(rect.height * 10) / 10,
        text: (element.textContent || element.getAttribute("aria-label") || "").trim().slice(0, 80),
        width: Math.round(rect.width * 10) / 10
      };
    })
    .filter((entry) =>
      entry.width > 0
      && entry.height > 0
      && (entry.width < 44 || entry.height < 44)
    );
  const focusVisibility = () => {
    const element = document.activeElement;
    const rect = element?.getBoundingClientRect();
    const rendering = describeRenderedVisibility(element);
    const header = document.querySelector("[data-header]");
    const headerBottom = header?.getBoundingClientRect().bottom || 0;
    if (!rect) return { meaningful: false };
    const visibleTop = Math.max(rect.top, headerBottom);
    const visibleBottom = Math.min(rect.bottom, window.innerHeight);
    const visiblePixels = Math.max(0, visibleBottom - visibleTop);
    return {
      bottom: Math.round(rect.bottom * 10) / 10,
      clearOfHeader: rect.top >= headerBottom + 8,
      effectiveVisibility: rendering,
      headerBottom: Math.round(headerBottom * 10) / 10,
      meaningful: rendering.effectiveVisible
        && rect.width > 0
        && rect.height > 0
        && rect.top >= headerBottom + 8
        && visiblePixels >= Math.min(rect.height, 88),
      tag: element?.tagName || "",
      top: Math.round(rect.top * 10) / 10,
      viewportHeight: window.innerHeight,
      visiblePixels: Math.round(visiblePixels * 10) / 10
    };
  };
  const pathButton = (path) => root.querySelector('[data-start-path="' + path + '"]');
  const answerButton = (answer) => root.querySelector('[data-start-answer="' + answer + '"]');
  const question = () => root.querySelector("[data-start-question]");
  const options = root.querySelector("[data-start-options]");
  const result = () => root.querySelector("[data-start-result]");
  const restart = () => root.querySelector("[data-start-restart]");
  const firstPath = pathButton("website");
  const describeUsableControl = (control) => {
    const rect = control?.getBoundingClientRect();
    const style = control ? getComputedStyle(control) : null;
    const rendering = describeRenderedVisibility(control);
    const displayVisible = style?.display !== "none";
    const visibilityVisible = style?.visibility === "visible";
    const opacityVisible = rendering.ancestorOpacityVisible;
    const contentVisible = style?.contentVisibility !== "hidden";
    const hidden = rendering.hidden;
    const ariaHidden = rendering.ariaHidden;
    const inert = rendering.inert;
    const ariaDisabled = Boolean(control?.closest('[aria-disabled="true"]'));
    const disabled = Boolean(
      control?.matches(":disabled")
      || control?.hasAttribute("disabled")
      || ariaDisabled
    );
    const rendered = rendering.rendered;
    const sequentiallyFocusable = Boolean(control && control.tabIndex >= 0);
    return {
      ancestorOpacityVisible: rendering.ancestorOpacityVisible,
      ariaDisabled,
      ariaHidden,
      browserVisible: rendering.browserVisible,
      contentVisible,
      disabled,
      displayVisible,
      height: Math.round((rect?.height || 0) * 10) / 10,
      hidden,
      inert,
      opacityVisible,
      pointerEventsEnabled: rendering.pointerEventsEnabled,
      rendered,
      sequentiallyFocusable,
      tabIndex: control?.tabIndex ?? -1,
      tag: control?.tagName || "",
      text: (control?.textContent || "").trim().replace(/\\s+/g, " "),
      top: Math.round((rect?.top || 0) * 10) / 10,
      type: control?.getAttribute("type") || "",
      usable: Boolean(
        control
        && displayVisible
        && visibilityVisible
        && opacityVisible
        && contentVisible
        && rendering.effectiveVisible
        && !hidden
        && !ariaHidden
        && !inert
        && !disabled
        && rendering.pointerEventsEnabled
        && rendered
        && sequentiallyFocusable
      ),
      viewportVisiblePixels: Math.round(
        Math.max(0, Math.min(rect?.bottom || 0, window.innerHeight) - Math.max(rect?.top || 0, 0))
          * 10
      ) / 10,
      visibilityVisible,
      width: Math.round((rect?.width || 0) * 10) / 10
    };
  };
  const probeUsableControlGuard = (control) => {
    if (!control) return { afterRestore: null, baseline: null, probes: [] };
    const originalStyle = control.getAttribute("style");
    const originalAncestorStyle = root.getAttribute("style");
    const originalAttributes = new Map(
      ["hidden", "aria-hidden", "aria-disabled", "inert", "disabled", "tabindex"]
        .map((name) => [name, control.getAttribute(name)])
    );
    const originalAncestorAttributes = new Map(
      ["hidden", "aria-hidden", "aria-disabled", "inert"]
        .map((name) => [name, root.getAttribute(name)])
    );
    const restore = () => {
      if (originalStyle == null) control.removeAttribute("style");
      else control.setAttribute("style", originalStyle);
      if (originalAncestorStyle == null) root.removeAttribute("style");
      else root.setAttribute("style", originalAncestorStyle);
      for (const [name, value] of originalAttributes) {
        if (value == null) control.removeAttribute(name);
        else control.setAttribute(name, value);
      }
      for (const [name, value] of originalAncestorAttributes) {
        if (value == null) root.removeAttribute(name);
        else root.setAttribute(name, value);
      }
    };
    const mutate = (name, apply) => {
      restore();
      apply();
      const description = describeUsableControl(control);
      return { name, rejected: !description.usable };
    };
    const baseline = describeUsableControl(control);
    const probes = [
      mutate("display-none", () => { control.style.display = "none"; }),
      mutate("ancestor-display-none", () => { root.style.display = "none"; }),
      mutate("visibility-hidden", () => { control.style.visibility = "hidden"; }),
      mutate("ancestor-visibility-hidden", () => { root.style.visibility = "hidden"; }),
      mutate("opacity-zero", () => { control.style.opacity = "0"; }),
      mutate("ancestor-opacity-zero", () => { root.style.opacity = "0"; }),
      mutate("hidden-attribute", () => { control.setAttribute("hidden", ""); }),
      mutate("ancestor-hidden-attribute", () => { root.setAttribute("hidden", ""); }),
      mutate("aria-hidden", () => { control.setAttribute("aria-hidden", "true"); }),
      mutate("ancestor-aria-hidden", () => { root.setAttribute("aria-hidden", "true"); }),
      mutate("aria-disabled", () => { control.setAttribute("aria-disabled", "true"); }),
      mutate("ancestor-aria-disabled", () => { root.setAttribute("aria-disabled", "true"); }),
      mutate("inert", () => { control.setAttribute("inert", ""); }),
      mutate("ancestor-inert", () => { root.setAttribute("inert", ""); }),
      mutate("disabled", () => { control.setAttribute("disabled", ""); }),
      mutate("negative-tabindex", () => { control.setAttribute("tabindex", "-1"); }),
      mutate("pointer-events-none", () => { control.style.pointerEvents = "none"; }),
      mutate("ancestor-pointer-events-none", () => { root.style.pointerEvents = "none"; }),
      mutate("zero-geometry", () => {
        for (const property of [
          "border",
          "height",
          "max-height",
          "max-width",
          "min-height",
          "min-width",
          "padding",
          "width"
        ]) {
          control.style.setProperty(property, "0px", "important");
        }
        control.style.setProperty("overflow", "hidden", "important");
      })
    ];
    restore();
    return {
      afterRestore: describeUsableControl(control),
      baseline,
      probes
    };
  };
  const branchSnapshot = (branchKey, stateKey) => {
    const answerControls = Array.from(options.querySelectorAll("[data-start-answer]"));
    return {
      answerControls: answerControls.map((answer) => ({
        ...describeUsableControl(answer),
        key: answer.getAttribute("data-start-answer") || ""
      })),
      answerControlsValid: answerControls.every((answer) =>
        answer.tagName === "BUTTON" && answer.getAttribute("type") === "button"
      ),
      answers: answerControls.map((answer) => ({
        key: answer.getAttribute("data-start-answer") || "",
        label: (answer.querySelector("strong")?.textContent || "").trim(),
        note: (answer.querySelector("small")?.textContent || "").trim()
      })),
      branchKey,
      backControl: describeUsableControl(root.querySelector("[data-start-back]")),
      exactFocus: document.activeElement === question(),
      focusVisibility: focusVisibility(),
      key: stateKey,
      questionText: (question()?.textContent || "").trim(),
      revealState: root.getAttribute("data-start-reveal") || "",
      touchFailures: touchFailures()
    };
  };
  const resultSnapshot = (stateKey) => ({
    branchKey: "",
    exactFocus: document.activeElement === result(),
    focusVisibility: focusVisibility(),
    key: stateKey,
    revealState: root.getAttribute("data-start-reveal") || "",
    touchFailures: touchFailures()
  });
  const rootStyle = getComputedStyle(root);
  const initialHumanLink = document.querySelector(".start-direct-link a");
  const initialControlSnapshot = () => ({
    humanControl: describeUsableControl(initialHumanLink),
    humanHref: initialHumanLink?.getAttribute("href") || "",
    humanTag: initialHumanLink?.tagName || "",
    humanText: (initialHumanLink?.textContent || "").trim(),
    options: Array.from(root.querySelectorAll("[data-start-path]")).map((path) => ({
      key: path.getAttribute("data-start-path") || "",
      label: (path.querySelector("strong")?.textContent || "").trim(),
      note: (path.querySelector("small")?.textContent || "").trim()
    })),
    pathControls: Array.from(root.querySelectorAll("[data-start-path]")).map((path) => ({
      ...describeUsableControl(path),
      key: path.getAttribute("data-start-path") || ""
    })),
    pathsAreButtons: ["website", "system", "service"].every((path) => {
      const control = pathButton(path);
      return control?.tagName === "BUTTON"
        && control.getAttribute("type") === "button"
        && !control.hasAttribute("href");
    }),
    pathsVisible: ["website", "system", "service"].every((path) => visible(pathButton(path))),
    touchFailures: touchFailures()
  });
  const controlGuardProbes = probeUsableControlGuard(firstPath);
  const initial = {
    ...initialControlSnapshot(),
    controlGuardProbes,
    motionStable: rootStyle.opacity === "1"
      && rootStyle.transform === "none"
      && rootStyle.transitionDuration.split(",").every((duration) => Number.parseFloat(duration) === 0),
    visible: visible(root),
    questionTabindex: question()?.getAttribute("tabindex") || "",
    resultAriaLive: result()?.getAttribute("aria-live") || "",
    resultRole: result()?.getAttribute("role") || "",
    resultTabindex: result()?.getAttribute("tabindex") || "",
    detailVisible: visible(root.querySelector('[data-start-step="detail"]')),
    resultVisible: visible(result()),
  };

  const drive = async (path) => {
    const missing = [];
    const states = [];
    const first = pathButton(path[0]);
    if (!first) return { missing: ["path:" + path[0]], states };
    first.click();
    await settle();
    states.push(branchSnapshot(path[0], path[0]));
    for (const [index, answer] of path.slice(1).entries()) {
      const button = answerButton(answer);
      if (!button) {
        missing.push("answer:" + answer);
        break;
      }
      button.scrollIntoView({ block: "center", behavior: "auto" });
      await settle();
      button.click();
      await settle();
      const stateKey = path.slice(0, index + 2).join(">");
      states.push(
        expectedBranches.some(({ key }) => key === answer)
          ? branchSnapshot(answer, stateKey)
          : resultSnapshot(stateKey)
      );
    }
    return { missing, states };
  };

  const reset = async () => {
    restart()?.click();
    await settle();
    return {
      initialControls: initialControlSnapshot(),
      needVisible: visible(root.querySelector('[data-start-step="need"]')),
      detailVisible: visible(root.querySelector('[data-start-step="detail"]')),
      focusVisibility: focusVisibility(),
      revealState: root.getAttribute("data-start-reveal") || "",
      resultVisible: visible(result()),
      firstPathFocused: document.activeElement === firstPath
    };
  };

  const leaves = [];
  for (const expected of expectedLeaves) {
    const driven = await drive(expected.path);
    const resultNode = result();
    const titleNode = root.querySelector("[data-start-result-title]");
    const copyNode = root.querySelector("[data-start-result-copy]");
    const actionNode = root.querySelector("[data-start-result-action]");
    const humanLink = root.querySelector(".chooser-human a");
    const outcome = {
      actionControl: describeUsableControl(actionNode),
      actionText: (actionNode?.textContent || "").trim(),
      actionTag: actionNode?.tagName || "",
      copy: (copyNode?.textContent || "").trim(),
      focused: document.activeElement === resultNode || document.activeElement === titleNode,
      href: actionNode?.getAttribute("href") || "",
      humanControl: describeUsableControl(humanLink),
      humanHref: humanLink?.getAttribute("href") || "",
      humanTag: humanLink?.tagName || "",
      humanText: (humanLink?.textContent || "").trim(),
      key: expected.key,
      missing: driven.missing,
      focusVisibility: focusVisibility(),
      revealState: root.getAttribute("data-start-reveal") || "",
      restartVisible: visible(restart()),
      restartControl: describeUsableControl(restart()),
      states: driven.states,
      title: (titleNode?.textContent || "").trim(),
      touchFailures: touchFailures(),
      visible: visible(resultNode)
    };
    outcome.afterRestart = await reset();
    leaves.push(outcome);
  }

  const backs = [];
  for (const backCase of backCases) {
    const driven = await drive(backCase.path);
    const beforeQuestion = (question()?.textContent || "").trim();
    const back = root.querySelector("[data-start-back]");
    const backVisible = visible(back);
    const backControl = describeUsableControl(back);
    back?.click();
    await settle();
    const returnedAnswerControls = Array.from(options.querySelectorAll("[data-start-answer]"));
    backs.push({
      answerControls: returnedAnswerControls.map((answer) => ({
        ...describeUsableControl(answer),
        key: answer.getAttribute("data-start-answer") || ""
      })),
      answerControlsValid: returnedAnswerControls
        .every((answer) => answer.tagName === "BUTTON" && answer.getAttribute("type") === "button"),
      answers: returnedAnswerControls.map((answer) => ({
        key: answer.getAttribute("data-start-answer") || "",
        label: (answer.querySelector("strong")?.textContent || "").trim(),
        note: (answer.querySelector("small")?.textContent || "").trim()
      })),
      backVisible,
      backControl,
      beforeQuestion,
      detailVisible: visible(root.querySelector('[data-start-step="detail"]')),
      firstPathFocused: document.activeElement === firstPath,
      focusedQuestion: document.activeElement === question(),
      focusVisibility: focusVisibility(),
      key: backCase.key,
      initialControls: backCase.returnsToNeed ? initialControlSnapshot() : null,
      missing: driven.missing,
      needVisible: visible(root.querySelector('[data-start-step="need"]')),
      previousQuestion: (question()?.textContent || "").trim(),
      revealState: root.getAttribute("data-start-reveal") || "",
      resultVisible: visible(result()),
      states: driven.states,
      touchFailures: touchFailures()
    });
    if (!backCase.returnsToNeed) await reset();
  }

  return { backs, initial, leaves };
})()`;

function expectedCanonical(route) {
  return new URL(route, "https://sitesourcery.com/").href;
}

export async function auditBrowser({
  artifactRoot = DEFAULT_ARTIFACT_ROOT,
  origin,
  profile = "vnext",
  routes = CANONICAL_ROUTES,
} = {}) {
  if (profile !== "vnext" && profile !== "generic") {
    throw new Error(`unknown browser-audit profile: ${profile}`);
  }
  const binary = await chromiumPath();
  const absoluteArtifactRoot = path.resolve(artifactRoot);
  await access(absoluteArtifactRoot);
  let abracadabraControlMode = "";
  if (routes.includes("/abracadabra/app/")) {
    const appSource = await readFile(
      path.join(absoluteArtifactRoot, "abracadabra", "app", "index.html"),
      "utf8",
    );
    abracadabraControlMode = appSource.match(
      /<meta\s+name="sitesourcery-abracadabra-control-mode"\s+content="([^"]+)"/u,
    )?.[1] ?? "";
  }
  const artifactServer = origin ? null : await startArtifactServer(absoluteArtifactRoot);
  const auditOrigin = origin ?? artifactServer.origin;
  const port = 19000 + (process.pid % 10000);
  const browser = spawn(binary, [
    "--headless",
    "--no-sandbox",
    "--hide-scrollbars",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-default-apps",
    "--host-resolver-rules=MAP cta.invalid ~NOTFOUND",
    "--no-first-run",
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ], {
    cwd: absoluteArtifactRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let browserErrors = "";
  browser.stderr.setEncoding("utf8");
  browser.stderr.on("data", (chunk) => {
    browserErrors += chunk;
  });

  let cdp;
  try {
    const socketUrl = await waitForTarget(port, browser);
    cdp = connectCdp(socketUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    const coldFirstPaint = profile === "vnext" && routes.includes("/")
      ? await auditHomeFirstPaint(cdp, auditOrigin)
      : { errors: [], results: [] };
    const progressiveFailures = profile === "vnext"
      ? await auditProgressiveEnhancementFailures(cdp, auditOrigin, routes)
      : { errors: [], results: [] };
    const runtimeErrors = [];
    cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      runtimeErrors.push(exceptionDetails?.text ?? "browser exception");
    });
    cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
      if (type !== "error" && type !== "assert") return;
      runtimeErrors.push(args?.map((entry) => entry.value ?? entry.description ?? "").join(" ") || type);
    });

    const errors = [...coldFirstPaint.errors, ...progressiveFailures.errors];
    const results = [...coldFirstPaint.results, ...progressiveFailures.results];
    const viewportPlans = profile === "vnext"
      ? [...VIEWPORTS, ...HIVE_COMPONENT_VIEWPORTS]
      : VIEWPORTS;
    for (const viewport of viewportPlans) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.mobile,
      });
      const viewportRoutes = viewport.componentRoute
        ? routes.filter((route) => route === viewport.componentRoute)
        : routes;
      for (const route of viewportRoutes) {
        const beforeErrors = runtimeErrors.length;
        await navigate(cdp, new URL(route, `${auditOrigin}/`).href);
        await cdp.send("Runtime.evaluate", {
          expression: SETTLE_IMAGES_EXPRESSION,
          awaitPromise: true,
          returnByValue: true,
        });
        const evaluated = await cdp.send("Runtime.evaluate", {
          expression: AUDIT_EXPRESSION,
          returnByValue: true,
        });
        const result = evaluated.result?.value;
        if (!result) {
          errors.push(
            `${viewport.label} ${route}: browser audit returned no value `
            + `${JSON.stringify(evaluated.exceptionDetails ?? null)}`,
          );
          continue;
        }
        const overflow = result.documentWidth - result.viewportWidth;
        if (result.readyState !== "complete") errors.push(`${viewport.label} ${route}: document did not complete`);
        if (result.h1Count !== 1) errors.push(`${viewport.label} ${route}: expected one h1; found ${result.h1Count}`);
        if (profile === "vnext") {
          if (result.smallText.length) {
            errors.push(
              `${viewport.label} ${route}: rendered text fell below 12px `
              + `${JSON.stringify(result.smallText)}`,
            );
          }
          if (
            ["phone-390", "tablet-768"].includes(viewport.label)
            && result.touchTargetFailures.length
          ) {
            errors.push(
              `${viewport.label} ${route}: visible actionable targets fell below 44px `
              + `${JSON.stringify(result.touchTargetFailures)}`,
            );
          }
          if (result.helpHeadingLeading.some((entry) =>
            !Number.isFinite(entry.fontSize)
            || !Number.isFinite(entry.lineHeight)
            || entry.lineHeight / entry.fontSize > 1.1
          )) {
            errors.push(
              `${viewport.label} ${route}: Abracadabra help heading leading is too loose `
              + `${JSON.stringify(result.helpHeadingLeading)}`,
            );
          }
          if (result.aboutAccountabilitySizes.some((size) =>
            !Number.isFinite(size) || size < 15.2
          )) {
            errors.push(
              `${viewport.label} ${route}: About accountability text is below its 15.2px body floor `
              + `${JSON.stringify(result.aboutAccountabilitySizes)}`,
            );
          }
          if (
            route === "/abracadabra/"
            && (!result.abracadabraHeroAction || !result.abracadabraHeroAction.meaningful)
          ) {
            errors.push(
              `${viewport.label} ${route}: primary hero action is not meaningfully visible in the first viewport `
              + `${JSON.stringify(result.abracadabraHeroAction)}`,
            );
          }
          if (result.flattenedCreativeSpecimens !== 0) {
            errors.push(
              `${viewport.label} ${route}: Custom comparison text is flattened by role=img`,
            );
          }
          if (
            route === "/work/"
            && (
              result.workProofDisclosures.length !== 2
              || result.workProofDisclosures.some((entry) =>
                entry.missing
                || entry.fontSize < 12
                || entry.overlapsScreen
                || !entry.text.startsWith("Fictional demonstration · ")
              )
            )
          ) {
            errors.push(
              `${viewport.label} ${route}: fictional proof disclosure obscures or weakens the proof `
              + `${JSON.stringify(result.workProofDisclosures)}`,
            );
          }
          if (result.primaryNavCount !== 1) {
            errors.push(`${viewport.label} ${route}: expected one primary nav; found ${result.primaryNavCount}`);
          }
          const usesDisclosureMenu = viewport.width <= 928;
          const closedNavContractFailures = result.menuReady
            ? primaryNavContractFailures(result.menuReady.entries, route, {
              visibility: usesDisclosureMenu ? "closed" : "desktop",
            })
            : ["shared menu snapshot is missing"];
          if (
            !result.menuReady
            || !result.menuReady.button
            || !result.menuReady.menu
            || result.menuReady.links !== PRIMARY_NAV_CONTRACT.length
            || closedNavContractFailures.length
          ) {
            errors.push(
              `${viewport.label} ${route}: shared menu controls are incomplete `
              + `${JSON.stringify({
                contractFailures: closedNavContractFailures,
                menuReady: result.menuReady,
              })}`,
            );
          } else if (usesDisclosureMenu) {
            if (
              result.menuReady.buttonDisplay === "none"
              || result.menuReady.expanded !== "false"
              || result.menuReady.open
            ) {
              errors.push(
                `${viewport.label} ${route}: mobile menu did not start as a closed visible disclosure`,
              );
            } else {
              const exercised = await cdp.send("Runtime.evaluate", {
                expression: MENU_EXERCISE_EXPRESSION,
                awaitPromise: true,
                returnByValue: true,
              });
              const menuFlow = exercised.result?.value;
              const openedNavContractFailures = menuFlow
                ? primaryNavContractFailures(menuFlow.opened?.destinations, route, {
                  visibility: "all",
                })
                : ["opened menu snapshot is missing"];
              if (
                exercised.exceptionDetails
                || !menuFlow
                || menuFlow.opened.expanded !== "true"
                || !menuFlow.opened.open
                || !menuFlow.opened.firstLinkFocused
                || !menuFlow.opened.rendered
                || menuFlow.escaped.expanded !== "false"
                || menuFlow.escaped.open
                || !menuFlow.escaped.buttonFocused
                || menuFlow.selected.expanded !== "false"
                || menuFlow.selected.open
                || openedNavContractFailures.length
              ) {
                errors.push(
                  `${viewport.label} ${route}: mobile menu open/Escape/select exercise failed `
                  + `${JSON.stringify({
                    contractFailures: openedNavContractFailures,
                    exercise: menuFlow ?? exercised.exceptionDetails ?? null,
                  })}`,
                );
              }
              if (viewport.phone && menuFlow) {
                if (
                  menuFlow.opened.menuLeft < -1
                  || menuFlow.opened.menuRight > result.viewportWidth + 1
                ) {
                  errors.push(
                    `${viewport.label} ${route}: opened primary menu escaped the viewport `
                    + `${JSON.stringify({
                      left: menuFlow.opened.menuLeft,
                      right: menuFlow.opened.menuRight,
                      viewportWidth: result.viewportWidth,
                    })}`,
                  );
                }
                if (
                  menuFlow.opened.headerOverflow.bounds.length
                  || menuFlow.opened.headerOverflow.internal.length
                ) {
                  errors.push(
                    `${viewport.label} ${route}: opened header descendant overflow `
                    + `${JSON.stringify(menuFlow.opened.headerOverflow)}`,
                  );
                }
                if (
                  menuFlow.opened.destinations.length !== result.menuReady.links
                  || menuFlow.opened.destinations.some((destination) =>
                    !destination.horizontallyContained
                    || !destination.verticallyContained
                  )
                ) {
                  errors.push(
                    `${viewport.label} ${route}: a primary-nav destination could not be `
                    + `contained in the opened menu viewport `
                    + `${JSON.stringify(menuFlow.opened.destinations)}`,
                  );
                }
              }
            }
          } else if (result.menuReady.buttonDisplay !== "none") {
            errors.push(`${viewport.label} ${route}: desktop menu button should be hidden`);
          }
          if (route === "/solutions/" && viewport.label === "phone-390") {
            const exercised = await cdp.send("Runtime.evaluate", {
              expression: SOLUTIONS_PRIMARY_ANCHOR_EXERCISE_EXPRESSION,
              awaitPromise: true,
              returnByValue: true,
            });
            const shelf = exercised.result?.value;
            if (
              exercised.exceptionDetails
              || !shelf
              || shelf.hash !== "#assessment"
              || shelf.kickerTop < shelf.obstructionBottom - 1
              || shelf.headingTop < shelf.obstructionBottom - 1
              || shelf.headingBottom <= shelf.headingTop
            ) {
              errors.push(
                `${viewport.label} ${route}: assessment primary anchor is obscured `
                + `${JSON.stringify(shelf ?? exercised.exceptionDetails ?? null)}`,
              );
            }
          }
        }
        if (
          viewport.phone
          && (result.headerOverflow.bounds.length || result.headerOverflow.internal.length)
        ) {
          errors.push(
            `${viewport.label} ${route}: closed header descendant overflow `
            + `${JSON.stringify(result.headerOverflow)}`,
          );
        }
        if (overflow > 1 && result.reachableX > 1) {
          errors.push(
            `${viewport.label} ${route}: horizontal document overflow is ${overflow}px; `
            + `chain ${JSON.stringify(result.widthChain)}; `
            + `wide elements ${JSON.stringify(result.wideElements)}`,
          );
        }
        if (result.brokenImages.length) {
          errors.push(`${viewport.label} ${route}: broken images ${result.brokenImages.join(", ")}`);
        }
        if (profile === "vnext" && result.loadedBytes > ROUTE_TRANSFER_BUDGET_BYTES) {
          errors.push(
            `${viewport.label} ${route}: loaded ${result.loadedBytes} bytes; `
            + `route budget is ${ROUTE_TRANSFER_BUDGET_BYTES}`,
          );
        }
        if (result.canonical !== expectedCanonical(route)) {
          errors.push(`${viewport.label} ${route}: wrong canonical ${result.canonical}`);
        }
        if (profile === "vnext" && result.hiveReady) {
          if (
            result.hiveReady.activation !== "locked"
            || result.hiveReady.enhanced !== "true"
            || result.hiveReady.controls !== 6
            || result.hiveReady.choicesEnabled !== 6
            || result.hiveReady.radioGroupRole !== "radiogroup"
            || result.hiveReady.radioCount !== 6
            || result.hiveReady.radioChecked !== 0
            || result.hiveReady.radioPressedAttributes !== 0
            || result.hiveReady.rovingTabStops !== 1
            || result.hiveReady.backDisabled !== true
            || result.hiveReady.backHidden !== true
            || result.hiveReady.currentStage !== "1"
            || result.hiveReady.visibleStages !== 1
            || result.hiveReady.inertLaterStages !== 4
            || result.hiveReady.nextButtons !== 3
            || result.hiveReady.nextButtonsDisabled !== 3
            || result.hiveReady.pauseDisabled !== true
            || result.hiveReady.downloadDisabled !== true
            || result.hiveReady.progressStates.join(",")
              !== "current,locked,locked,locked,locked"
            || result.hiveReady.startVisible !== true
            || result.hiveReady.outputLength < 100
            || JSON.stringify(result.hiveReady.staticExamples)
              !== JSON.stringify(HIVE_CUSTOMER_EXAMPLES)
          ) {
            errors.push(`${viewport.label} ${route}: Hive planner did not fully enhance`);
          }
          if (
            result.hiveReady.outputLive
            || !result.hiveReady.conciseLive
            || result.hiveReady.conciseLive.role !== "status"
            || result.hiveReady.conciseLive.politeness !== "polite"
            || result.hiveReady.conciseLive.atomic !== "true"
          ) {
            errors.push(
              `${viewport.label} ${route}: Hive selection announcement is not concise `
              + `${JSON.stringify(result.hiveReady)}`,
            );
          }
          if (
            viewport.componentRoute === "/hive/"
            && (
              result.hiveReady.plannerColumns !== 1
              || result.hiveReady.answerColumns !== 1
              || result.hiveReady.stageShellWidth < 200
              || result.hiveReady.plannerHeight > 4000
            )
          ) {
            errors.push(
              `${viewport.label} ${route}: Hive component did not collapse safely `
              + `${JSON.stringify(result.hiveReady)}`,
            );
          }
          const exercise = await cdp.send("Runtime.evaluate", {
            expression: HIVE_EXERCISE_EXPRESSION,
            returnByValue: true,
          });
          const cells = exercise.result?.value;
          if (
            exercise.exceptionDetails
            || !Array.isArray(cells)
            || cells.length !== 6
            || cells.some((cell) =>
              cell.requested !== cell.active
              || !cell.activationLocked
              || cell.requested !== cell.outputCell
              || cell.selected !== 1
              || cell.schema !== "sitesourcery.hive-blueprint.v1"
              || cell.status !== "planning_only"
              || cell.liveIntegration !== false
              || !cell.noticeExact
              || !cell.titleMatches
              || !cell.publicPlanComplete
              || !cell.internalFieldsAbsent
              || !cell.exportMatches
              || !cell.customerCopyMatches
              || !cell.reviewMatches
              || cell.checked !== 1
              || cell.pressedAttributes !== 0
              || !cell.radioGroup
              || cell.radios !== 6
              || cell.rovingTabStops !== 1
              || cell.afterChoice.current !== "2"
              || cell.afterChoice.startVisible
              || cell.afterChoice.visible.join(",") !== "1,2"
              || cell.afterChoice.inert.join(",") !== "3,4,5"
              || cell.afterTiming.current !== "3"
              || cell.afterTiming.startVisible
              || cell.afterTiming.visible.join(",") !== "1,3"
              || cell.afterRules.current !== "4"
              || cell.afterRules.startVisible
              || cell.afterRules.visible.join(",") !== "1,4"
              || cell.afterReview.current !== "5"
              || cell.afterReview.startVisible
              || cell.afterReview.visible.join(",") !== "1,5"
              || !cell.choiceFocus
              || !cell.timingFocus
              || !cell.rulesFocus
              || !cell.reviewFocus
              || cell.choiceNextEnabled !== 1
              || cell.timingNextEnabled !== 1
              || cell.rulesNextEnabled !== 1
              || cell.reviewNextEnabled !== 0
              || cell.choiceBack.disabled
              || cell.choiceBack.hidden
              || cell.choiceBack.label !== "← Back to choose"
              || !cell.resetLaterProgress
              || !cell.hashMatches
              || !cell.downloadReady
              || !cell.writtenScopeLink
              || !cell.plainVisibleCopy
              || cell.paused.root !== "true"
              || cell.paused.pressed !== "true"
              || cell.paused.label !== "End pause demo"
              || !cell.paused.status.includes("Pause demo on")
              || !cell.paused.status.includes("Nothing is connected")
              || !cell.resumed
            )
          ) {
            errors.push(
              `${viewport.label} ${route}: six-cell Hive exercise failed `
              + `${JSON.stringify(cells ?? exercise.exceptionDetails ?? null)}`,
            );
          }
          const historyExercise = await cdp.send("Runtime.evaluate", {
            expression: HIVE_HISTORY_EXERCISE_EXPRESSION,
            awaitPromise: true,
            returnByValue: true,
          });
          const historyFlow = historyExercise.result?.value;
          if (
            historyExercise.exceptionDetails
            || !historyFlow
            || historyFlow.atReview.stage !== "5"
            || historyFlow.atReview.path !== "/hive/"
            || historyFlow.atReview.hash !== "#missed-call"
            || !historyFlow.atReview.visible
            || !historyFlow.atReview.enabled
            || !historyFlow.toolBackToRules
            || !historyFlow.browserBackToTiming
            || !historyFlow.toolBackToResult
            || !historyFlow.toolBackToChoose
            || !historyFlow.rulesFocus
            || !historyFlow.timingFocus
            || !historyFlow.startFocus
            || historyFlow.afterChoose.active
            || !historyFlow.afterChoose.backDisabled
            || !historyFlow.afterChoose.backHidden
            || historyFlow.afterChoose.checked !== 0
            || historyFlow.afterChoose.hash !== ""
            || historyFlow.afterChoose.path !== "/hive/"
            || historyFlow.keyboard.active !== "booking"
            || historyFlow.keyboard.checked !== 1
            || !historyFlow.keyboard.focused
            || historyFlow.keyboard.pressedAttributes !== 0
            || historyFlow.keyboard.rovingTabStops !== 1
            || historyFlow.keyboard.stage !== "2"
          ) {
            errors.push(
              `${viewport.label} ${route}: Hive Back, browser history, or radio-keyboard flow failed `
              + `${JSON.stringify(historyFlow ?? historyExercise.exceptionDetails ?? null)}`,
            );
          }
        }
        if (profile === "vnext" && result.sparkReady) {
          const heldSource = result.sparkReady.configuredControlMode === "hold";
          const hostedArtifact = result.sparkReady.configuredControlMode === "hosted";
          if (
            result.sparkReady.inert
            || result.sparkReady.disabled !== "false"
            || result.sparkReady.compiler !== "object"
            || result.sparkReady.controlModeApi !== "object"
            || (
              heldSource
              && (
                result.sparkReady.controlModeMeta !== "hold"
                || result.sparkReady.controlRoomPresent
                || result.sparkReady.hostedControlScriptPresent
                || result.sparkReady.accountControlCount !== 0
                || result.sparkReady.publishControlCount !== 0
                || result.sparkReady.controlReady !== ""
                || result.sparkReady.documentControlReady !== ""
              )
            )
            || (
              hostedArtifact
              && (
                !result.sparkReady.controlRoomPresent
                || !result.sparkReady.hostedControlScriptPresent
                || result.sparkReady.controlReady !== "hosted"
                || result.sparkReady.documentControlReady !== "hosted"
              )
            )
            || (!heldSource && !hostedArtifact)
          ) {
            errors.push(
              `${viewport.label} ${route}: Abracadabra Spark boot or control-mode boundary failed `
              + `${JSON.stringify(result.sparkReady)}`,
            );
          }
          if (hostedArtifact) {
            const guestExercise = await cdp.send("Runtime.evaluate", {
              expression: GUEST_FIRST_EXERCISE_EXPRESSION,
              awaitPromise: true,
              returnByValue: true,
            });
            const guestFlow = guestExercise.result?.value;
            if (
              guestExercise.exceptionDetails
              || !guestFlow
              || !guestFlow.initial.accountHidden
              || !guestFlow.initial.domOrderAligned
              || !guestFlow.initial.makerVisible
              || !guestFlow.initial.returningEnabled
              || !guestFlow.preview.accountHidden
              || guestFlow.preview.versionCount !== 1
              || guestFlow.preview.srcdocLength < 1000
              || !guestFlow.saveChoice.accountVisible
              || !guestFlow.saveChoice.createPanelVisible
              || !guestFlow.saveChoice.domOrderAligned
              || guestFlow.saveChoice.focusName !== "accountName"
              || !guestFlow.saveChoice.renderedOrderAligned
              || !guestFlow.providerHold.authVisible
              || !guestFlow.providerHold.buttonEnabled
              || !guestFlow.providerHold.dashboardHidden
              || !guestFlow.providerHold.previewStillVisible
              || guestFlow.providerHold.versionCount !== 1
              || !guestFlow.providerHold.status.includes("could not complete this request")
            ) {
              errors.push(
                `${viewport.label} ${route}: guest preview or held-provider retry path failed `
                + `${JSON.stringify(guestFlow ?? guestExercise.exceptionDetails ?? null)}`,
              );
            }
            // The hosted artifact audit intentionally runs without an API service:
            // verify the safe provider hold above, then reload before testing the
            // independent in-browser maker so its version history starts clean.
            await navigate(cdp, new URL(route, `${auditOrigin}/`).href);
          }
          const exercise = await cdp.send("Runtime.evaluate", {
            expression: SPARK_EXERCISE_EXPRESSION,
            awaitPromise: true,
            returnByValue: true,
          });
          const flow = exercise.result?.value;
          if (
            exercise.exceptionDetails
            || !flow
            || flow.staleTruth.previewVisible
            || !flow.staleTruth.errorsVisible
            || flow.staleTruth.confirmationChecked
            || !flow.staleTruth.reviewUpdated
            || !flow.first.previewVisible
            || flow.first.srcdocLength < 1000
            || !flow.first.primaryAction
            || flow.first.versions !== 1
            || !flow.first.downloadEnabled
            || flow.first.focused !== "preview"
            || !flow.blockedOpen
            || !flow.blockedOpen.buttonEnabled
            || flow.blockedOpen.status
              !== "The working page could not open. Nothing was changed. Select Open again to retry."
            || flow.progressive.initial.visible.join(",") !== "facts"
            || flow.progressive.vibe.focused !== "vibe"
            || flow.progressive.vibe.visible.join(",") !== "vibe"
            || flow.progressive.truth.focused !== "truth"
            || flow.progressive.truth.visible.join(",") !== "truth"
            || flow.progressive.factsAfterEdit.focused !== "facts"
            || flow.progressive.factsAfterEdit.visible.join(",") !== "facts"
            || flow.second.versions !== 2
            || !flow.second.undoEnabled
            || !/^Undone\. Version 1/u.test(flow.afterUndo.status)
            || flow.afterUndo.selected !== 1
            || flow.branch.versions !== 3
            || flow.branch.selected !== 1
          ) {
            errors.push(
              `${viewport.label} ${route}: full Spark make/revise/undo exercise failed `
              + `${JSON.stringify(flow ?? exercise.exceptionDetails ?? null)}`,
            );
          }
        }
        if (profile === "vnext" && route === "/start/" && !result.startReady) {
          errors.push(`${viewport.label} ${route}: Start chooser did not initialize`);
        }
        if (profile === "vnext" && result.startReady) {
          if (
            !result.startReady.visible
            || result.startReady.paths.join(",") !== "website,system,service"
            || !result.startReady.pathsVisible
            || result.startReady.detailVisible
            || result.startReady.resultVisible
          ) {
            errors.push(
              `${viewport.label} ${route}: Start chooser did not begin on its complete path step `
              + `${JSON.stringify(result.startReady)}`,
            );
          }
          const exercise = await cdp.send("Runtime.evaluate", {
            expression: START_EXERCISE_EXPRESSION,
            awaitPromise: true,
            returnByValue: true,
          });
          const flow = exercise.result?.value;
          if (exercise.exceptionDetails || !flow) {
            errors.push(
              `${viewport.label} ${route}: Start decision-table exercise failed to run `
              + `${JSON.stringify(flow ?? exercise.exceptionDetails ?? null)}`,
            );
          } else {
            if (
              !flow.initial.visible
              || !startInitialControlsPass(flow.initial)
              || !flow.initial.motionStable
              || !flow.initial.controlGuardProbes.baseline.usable
              || !flow.initial.controlGuardProbes.afterRestore.usable
              || flow.initial.controlGuardProbes.probes.length !== 19
              || !flow.initial.controlGuardProbes.probes.every(({ rejected }) => rejected)
              || flow.initial.questionTabindex !== "-1"
              || flow.initial.resultTabindex !== "-1"
              || flow.initial.resultRole !== "status"
              || flow.initial.resultAriaLive !== "polite"
              || flow.initial.detailVisible
              || flow.initial.resultVisible
              || flow.initial.touchFailures.length
            ) {
              errors.push(
                `${viewport.label} ${route}: Start initial state failed `
                + `${JSON.stringify(flow.initial)}`,
              );
            }
            if (
              flow.leaves.length !== START_DECISION_TABLE.length
              || flow.leaves.map(({ key }) => key).join(",")
                !== START_DECISION_TABLE.map(({ key }) => key).join(",")
            ) {
              errors.push(
                `${viewport.label} ${route}: Start decision leaf ledger drifted `
                + `${JSON.stringify(flow.leaves.map(({ key }) => key))}`,
              );
            }
            for (const expected of START_DECISION_TABLE) {
              const actual = flow.leaves.find(({ key }) => key === expected.key);
              const stateTouchFailures = actual?.states
                ?.filter(({ touchFailures }) => touchFailures.length) ?? [];
              const stateVisibilityFailures = actual?.states
                ?.filter(({ focusVisibility }) => !focusVisibility.meaningful) ?? [];
              const stateRevealFailures = actual?.states
                ?.filter(({ revealState }) => revealState !== "ready") ?? [];
              const stateFocusFailures = actual?.states
                ?.filter(({ exactFocus }) => !exactFocus) ?? [];
              const stateControlFailures = actual?.states
                ?.filter((state) =>
                  state.branchKey
                  && (
                    !state.answerControlsValid
                    || !state.answerControls.every(({ usable }) => usable)
                    || !state.backControl.usable
                  )
                ) ?? [];
              const stateBranchFailures = actual?.states?.filter((state) => {
                if (!state.branchKey) return false;
                const branch = START_BRANCH_TABLE.find(({ key }) => key === state.branchKey);
                return !branch
                  || state.questionText !== branch.question
                  || JSON.stringify(state.answers) !== JSON.stringify(branch.options);
              }) ?? [];
              if (
                !actual
                || actual.missing.length
                || !actual.visible
                || !actual.focused
                || !actual.focusVisibility.meaningful
                || actual.revealState !== "ready"
                || actual.actionTag !== "A"
                || !actual.actionControl.usable
                || actual.actionControl.viewportVisiblePixels
                  < Math.min(actual.actionControl.height, 44)
                || actual.humanHref !== "/contact/"
                || actual.humanTag !== "A"
                || actual.humanText !== "See every contact option"
                || !actual.humanControl.usable
                || actual.restartControl.tag !== "BUTTON"
                || actual.restartControl.type !== "button"
                || actual.restartControl.text !== "Start over"
                || !actual.restartControl.usable
                || actual.title !== expected.title
                || actual.actionText !== expected.action
                || actual.href !== expected.href
                || actual.copy !== expected.copy
                || !actual.restartVisible
                || actual.touchFailures.length
                || stateTouchFailures.length
                || stateVisibilityFailures.length
                || stateRevealFailures.length
                || stateFocusFailures.length
                || stateControlFailures.length
                || stateBranchFailures.length
                || !actual.afterRestart.needVisible
                || actual.afterRestart.detailVisible
                || actual.afterRestart.resultVisible
                || !actual.afterRestart.firstPathFocused
                || !actual.afterRestart.focusVisibility.meaningful
                || actual.afterRestart.revealState !== "ready"
                || !startInitialControlsPass(actual.afterRestart.initialControls)
              ) {
                errors.push(
                  `${viewport.label} ${route}: Start leaf ${expected.key} failed `
                  + `${JSON.stringify({
                    actual,
                    expected,
                    stateBranchFailures,
                    stateControlFailures,
                    stateFocusFailures,
                    stateRevealFailures,
                    stateTouchFailures,
                    stateVisibilityFailures,
                  })}`,
                );
              }
            }
            if (
              flow.backs.length !== START_BACK_TABLE.length
              || flow.backs.map(({ key }) => key).join(",")
                !== START_BACK_TABLE.map(({ key }) => key).join(",")
            ) {
              errors.push(
                `${viewport.label} ${route}: Start Back-state ledger drifted `
                + `${JSON.stringify(flow.backs.map(({ key }) => key))}`,
              );
            }
            for (const expected of START_BACK_TABLE) {
              const actual = flow.backs.find(({ key }) => key === expected.key);
              const stateTouchFailures = actual?.states
                ?.filter(({ touchFailures }) => touchFailures.length) ?? [];
              const stateVisibilityFailures = actual?.states
                ?.filter(({ focusVisibility }) => !focusVisibility.meaningful) ?? [];
              const stateRevealFailures = actual?.states
                ?.filter(({ revealState }) => revealState !== "ready") ?? [];
              const stateFocusFailures = actual?.states
                ?.filter(({ exactFocus }) => !exactFocus) ?? [];
              const stateControlFailures = actual?.states
                ?.filter((state) =>
                  state.branchKey
                  && (
                    !state.answerControlsValid
                    || !state.answerControls.every(({ usable }) => usable)
                    || !state.backControl.usable
                  )
                ) ?? [];
              const stateBranchFailures = actual?.states?.filter((state) => {
                if (!state.branchKey) return false;
                const branch = START_BRANCH_TABLE.find(({ key }) => key === state.branchKey);
                return !branch
                  || state.questionText !== branch.question
                  || JSON.stringify(state.answers) !== JSON.stringify(branch.options);
              }) ?? [];
              const returnedBranch = expected.previousBranch
                ? START_BRANCH_TABLE.find(({ key }) => key === expected.previousBranch)
                : null;
              const returnedCorrectly = expected.returnsToNeed
                ? actual?.needVisible
                  && !actual.detailVisible
                  && !actual.resultVisible
                  && actual.firstPathFocused
                  && startInitialControlsPass(actual.initialControls)
                : !actual?.needVisible
                  && actual.detailVisible
                  && !actual.resultVisible
                  && actual.focusedQuestion
                  && actual.previousQuestion === expected.previousQuestion
                  && returnedBranch
                  && actual.answerControlsValid
                  && actual.answerControls.every(({ usable }) => usable)
                  && JSON.stringify(actual.answers) === JSON.stringify(returnedBranch.options);
              if (
                !actual
                || actual.missing.length
                || !actual.backVisible
                || actual.backControl.tag !== "BUTTON"
                || actual.backControl.type !== "button"
                || actual.backControl.text !== "← Back"
                || !actual.backControl.usable
                || !returnedCorrectly
                || !actual.focusVisibility.meaningful
                || actual.revealState !== "ready"
                || actual.touchFailures.length
                || stateTouchFailures.length
                || stateVisibilityFailures.length
                || stateRevealFailures.length
                || stateFocusFailures.length
                || stateControlFailures.length
                || stateBranchFailures.length
              ) {
                errors.push(
                  `${viewport.label} ${route}: Start Back case ${expected.key} failed `
                  + `${JSON.stringify({
                    actual,
                    expected,
                    stateBranchFailures,
                    stateControlFailures,
                    stateFocusFailures,
                    stateRevealFailures,
                    stateTouchFailures,
                    stateVisibilityFailures,
                  })}`,
                );
              }
            }
          }
        }
        for (const message of runtimeErrors.slice(beforeErrors)) {
          errors.push(`${viewport.label} ${route}: browser error ${message}`);
        }
        results.push({ overflow, route, viewport: viewport.label });
      }
    }
    if (
      profile === "vnext"
      && routes.includes("/abracadabra/app/")
      && abracadabraControlMode === "local-rehearsal"
    ) {
      const auditLabel = "private-viewer";
      const beforeErrors = runtimeErrors.length;
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      try {
        await navigate(cdp, new URL("/abracadabra/app/", `${auditOrigin}/`).href);
        const fixtureEvaluation = await cdp.send("Runtime.evaluate", {
          expression: PRIVATE_VIEWER_FIXTURE_EXPRESSION,
          returnByValue: true,
        });
        const fixture = fixtureEvaluation.result?.value;
        if (
          fixtureEvaluation.exceptionDetails
          || !fixture
          || fixture.error
          || fixture.algorithm !== "sha256-iterated-v2"
          || fixture.artifactDigestMatches !== true
          || fixture.compilerSchema !== "abracadabra.spark/v1"
          || fixture.ctaHref !== PRIVATE_VIEWER_POPUP_URL
          || fixture.ctaTarget !== "_blank"
          || fixture.ctaRel !== "noopener noreferrer"
          || fixture.rounds !== 12000
          || !fixture.projectId
          || !fixture.versionId
        ) {
          errors.push(
            `${auditLabel}: private platform fixture failed `
            + `${JSON.stringify(fixture ?? fixtureEvaluation.exceptionDetails ?? null)}`,
          );
        } else {
          const viewerUrl = new URL(
            `/abracadabra/site/?project=${encodeURIComponent(fixture.projectId)}`,
            `${auditOrigin}/`,
          ).href;
          await navigate(cdp, viewerUrl);
          const gateEvaluation = await cdp.send("Runtime.evaluate", {
            expression: PRIVATE_VIEWER_GATE_EXPRESSION,
            returnByValue: true,
          });
          const gate = gateEvaluation.result?.value;
          if (
            gateEvaluation.exceptionDetails
            || !gate
            || gate.state !== "access"
            || !gate.accessFormVisible
            || gate.frameHasSource
            || !gate.passphraseFocused
            || !gate.returnActionVisible
            || gate.returnHref !== "/abracadabra/app/"
            || !gate.siteHidden
          ) {
            errors.push(
              `${auditLabel}: private publication did not begin sealed `
              + `${JSON.stringify(gate ?? gateEvaluation.exceptionDetails ?? null)}`,
            );
          }

          const wrongEvaluation = await cdp.send("Runtime.evaluate", {
            expression: PRIVATE_VIEWER_WRONG_PHRASE_EXPRESSION,
            awaitPromise: true,
            returnByValue: true,
          });
          const wrong = wrongEvaluation.result?.value;
          if (
            wrongEvaluation.exceptionDetails
            || !wrong
            || wrong.missing
            || !wrong.completed
            || wrong.state !== "access"
            || wrong.frameHasSource
            || wrong.error !== "That passphrase did not open this website."
          ) {
            errors.push(
              `${auditLabel}: wrong passphrase did not remain sealed `
              + `${JSON.stringify(wrong ?? wrongEvaluation.exceptionDetails ?? null)}`,
            );
          }

          const correctEvaluation = await cdp.send("Runtime.evaluate", {
            expression: PRIVATE_VIEWER_CORRECT_PHRASE_EXPRESSION,
            awaitPromise: true,
            returnByValue: true,
          });
          const correct = correctEvaluation.result?.value;
          if (
            correctEvaluation.exceptionDetails
            || !correct
            || correct.missing
            || !correct.completed
            || correct.state !== "live"
            || !correct.ctaPresent
            || !correct.errorHidden
            || !correct.proofPresent
            || correct.sandbox !== "allow-popups"
            || !correct.siteFocused
            || !correct.siteVisible
          ) {
              errors.push(
                `${auditLabel}: correct passphrase did not reveal exact inert bytes `
                + `${JSON.stringify(correct ?? correctEvaluation.exceptionDetails ?? null)}`,
              );
            } else {
              const popupProof = await exercisePrivateViewerPopup(cdp);
              for (const failure of privateViewerPopupFailures(popupProof)) {
                errors.push(`${auditLabel}: external CTA popup ${failure}`);
              }
              results.push({
                mode: "private-viewer-popup",
                route: "/abracadabra/site/",
                viewport: auditLabel,
              });

              await navigate(cdp, viewerUrl);
            const sessionEvaluation = await cdp.send("Runtime.evaluate", {
              expression: PRIVATE_VIEWER_SESSION_EXPRESSION,
              awaitPromise: true,
              returnByValue: true,
            });
            const session = sessionEvaluation.result?.value;
            if (
              sessionEvaluation.exceptionDetails
              || !session
              || session.missing
              || session.state !== "live"
              || !session.accessFormHidden
              || !session.proofPresent
              || !session.siteVisible
            ) {
              errors.push(
                `${auditLabel}: verified session did not reopen the same publication `
                + `${JSON.stringify(session ?? sessionEvaluation.exceptionDetails ?? null)}`,
              );
            }

            const staleEvaluation = await cdp.send("Runtime.evaluate", {
              expression: PRIVATE_VIEWER_STALE_GRACE_EXPRESSION,
              returnByValue: true,
            });
            const stale = staleEvaluation.result?.value;
            if (
              staleEvaluation.exceptionDetails
              || !stale
              || stale.missing
              || stale.billingState !== "grace"
              || stale.servingState !== "live"
              || stale.graceEndsAt !== "2000-01-01T00:00:00.000Z"
            ) {
              errors.push(
                `${auditLabel}: stale grace fixture could not be armed `
                + `${JSON.stringify(stale ?? staleEvaluation.exceptionDetails ?? null)}`,
              );
            } else {
              let platformRequests = 0;
              const fulfillments = [];
              let fetchEnabled = false;
              let networkEnabled = false;
              let offPlatformFetch = () => {};
              try {
                await cdp.send("Network.enable");
                networkEnabled = true;
                await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
                await cdp.send("Network.clearBrowserCache");
                await cdp.send("Fetch.enable", {
                  patterns: [{
                    requestStage: "Request",
                    resourceType: "Script",
                    urlPattern: "*abracadabra/platform/abracadabra-platform.js*",
                  }],
                });
                fetchEnabled = true;
                offPlatformFetch = cdp.on("Fetch.requestPaused", (event) => {
                  platformRequests += 1;
                  fulfillments.push(cdp.send("Fetch.fulfillRequest", {
                    requestId: event.requestId,
                    responseCode: 200,
                    responseHeaders: [{
                      name: "Content-Type",
                      value: "application/javascript; charset=utf-8",
                    }],
                    body: Buffer.from(
                      '"use strict"; globalThis.SiteSourceryAbracadabraPlatform = undefined;',
                      "utf8",
                    ).toString("base64"),
                  }));
                });
                await navigate(cdp, viewerUrl);
                await Promise.all(fulfillments);
                const missingEvaluation = await cdp.send("Runtime.evaluate", {
                  expression: PRIVATE_VIEWER_PLATFORM_MISSING_EXPRESSION,
                  awaitPromise: true,
                  returnByValue: true,
                });
                const missing = missingEvaluation.result?.value;
                if (
                  missingEvaluation.exceptionDetails
                  || !missing
                  || platformRequests !== 1
                  || missing.lifecyclePlatformType !== "undefined"
                  || missing.state !== "missing"
                  || missing.frameHasSource
                  || !missing.siteHidden
                  || !missing.statusVisible
                  || missing.title !== "This published website could not be opened."
                ) {
                  errors.push(
                    `${auditLabel}: missing lifecycle platform exposed stale grace bytes `
                    + `${JSON.stringify({
                      missing: missing ?? missingEvaluation.exceptionDetails ?? null,
                      platformRequests,
                    })}`,
                  );
                }
              } finally {
                offPlatformFetch();
                try {
                  if (fetchEnabled) await cdp.send("Fetch.disable");
                } finally {
                  if (networkEnabled) {
                    try {
                      await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
                    } finally {
                      await cdp.send("Network.disable");
                    }
                  }
                }
              }
            }
          }
        }
      } finally {
        const cleanup = await cdp.send("Runtime.evaluate", {
          expression: PRIVATE_VIEWER_CLEANUP_EXPRESSION,
          returnByValue: true,
        });
        if (cleanup.exceptionDetails || cleanup.result?.value !== true) {
          errors.push(
            `${auditLabel}: local fixture cleanup failed `
            + `${JSON.stringify(cleanup.exceptionDetails ?? null)}`,
          );
        }
      }
      for (const message of runtimeErrors.slice(beforeErrors)) {
        errors.push(`${auditLabel}: browser error ${message}`);
      }
    }
    if (profile === "vnext") {
      await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
      try {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: NO_SCRIPT_VIEWPORT.width,
          height: NO_SCRIPT_VIEWPORT.height,
          deviceScaleFactor: 1,
          mobile: NO_SCRIPT_VIEWPORT.mobile,
        });
        for (const route of routes) {
          await navigate(cdp, new URL(route, `${auditOrigin}/`).href);
          const evaluated = await cdp.send("Runtime.evaluate", {
            expression: NO_SCRIPT_AUDIT_EXPRESSION,
            returnByValue: true,
          });
          const result = evaluated.result?.value;
          if (evaluated.exceptionDetails || !result) {
            errors.push(
              `${NO_SCRIPT_VIEWPORT.label} ${route}: no-script audit returned no value `
              + `${JSON.stringify(evaluated.exceptionDetails ?? null)}`,
            );
            continue;
          }
          const overflow = result.documentWidth - result.viewportWidth;
          if (result.hasJsClass) {
            errors.push(`${NO_SCRIPT_VIEWPORT.label} ${route}: page claimed JavaScript enhancement`);
          }
          if (!result.mainVisible || result.mainTextLength < 80) {
            errors.push(
              `${NO_SCRIPT_VIEWPORT.label} ${route}: primary content was not meaningfully available`,
            );
          }
          if (result.h1Count !== 1) {
            errors.push(
              `${NO_SCRIPT_VIEWPORT.label} ${route}: expected one h1; found ${result.h1Count}`,
            );
          }
          const noScriptNavContractFailures = primaryNavContractFailures(
            result.navEntries,
            route,
            { current: "absent", visibility: "all" },
          );
          if (
            result.navVisibleLinks !== PRIMARY_NAV_CONTRACT.length
            || result.menuButtonVisible
            || noScriptNavContractFailures.length
          ) {
            errors.push(
              `${NO_SCRIPT_VIEWPORT.label} ${route}: fallback navigation was not fully available `
              + `${JSON.stringify({
                contractFailures: noScriptNavContractFailures,
                menuButtonVisible: result.menuButtonVisible,
                navEntries: result.navEntries,
                navVisibleLinks: result.navVisibleLinks,
              })}`,
            );
          }
          if (overflow > 1 && result.reachableX > 1) {
            errors.push(
              `${NO_SCRIPT_VIEWPORT.label} ${route}: horizontal document overflow is ${overflow}px`,
            );
          }
          if (result.brokenImages.length) {
            errors.push(
              `${NO_SCRIPT_VIEWPORT.label} ${route}: broken images ${result.brokenImages.join(", ")}`,
            );
          }
          if (
            route === "/start/"
            && (
              !result.start
              || result.start.chooserVisible
              || !result.start.fallbackVisible
              || result.start.fallbackLinks.join(",")
                !== "/custom/,/hive/,/solutions/,tel:+18562441220"
            )
          ) {
            errors.push(
              `${NO_SCRIPT_VIEWPORT.label} ${route}: chooser did not expose its exact no-script routes `
              + `${JSON.stringify(result.start)}`,
            );
          }
          if (
            route === "/hive/"
            && (
              !result.hive
              || !result.hive.fallbackVisible
              || result.hive.fallbackChoices !== 6
              || JSON.stringify(result.hive.fallbackExamples)
                !== JSON.stringify(HIVE_CUSTOMER_EXAMPLES)
              || result.hive.disabledCells !== 6
              || result.hive.disabledOperationControls !== 2
              || result.hive.laterStagesHidden !== 4
              || result.hive.laterStagesInert !== 4
            )
          ) {
            errors.push(
              `${NO_SCRIPT_VIEWPORT.label} ${route}: Hive exposed inert controls without a fallback `
              + `${JSON.stringify(result.hive)}`,
            );
          }
          if (
            route === "/abracadabra/app/"
            && (
              !result.spark
              || !result.spark.fallbackVisible
              || !result.spark.makerLocked
            )
          ) {
            errors.push(
              `${NO_SCRIPT_VIEWPORT.label} ${route}: Abracadabra did not fail closed visibly `
              + `${JSON.stringify(result.spark)}`,
            );
          }
          if (
            route === "/abracadabra/"
            && (
              !result.showcase
              || !result.showcase.fallbackVisible
              || result.showcase.frames !== 4
              || result.showcase.framesWithGeneratedSource !== 0
              || result.showcase.guideHref !== "/abracadabra/how/"
              || result.showcase.truthfulStaticStatuses !== 4
            )
          ) {
            errors.push(
              `${NO_SCRIPT_VIEWPORT.label} ${route}: showcase fallback was not truthful and complete `
              + `${JSON.stringify(result.showcase)}`,
            );
          }
          results.push({
            mode: "no-script",
            overflow,
            route,
            viewport: NO_SCRIPT_VIEWPORT.label,
          });
        }
      } finally {
        await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });
      }
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
        media: "screen",
      });
      try {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: REDUCED_MOTION_VIEWPORT.width,
          height: REDUCED_MOTION_VIEWPORT.height,
          deviceScaleFactor: 1,
          mobile: REDUCED_MOTION_VIEWPORT.mobile,
        });
        for (const route of routes) {
          const beforeErrors = runtimeErrors.length;
          await navigate(cdp, new URL(route, `${auditOrigin}/`).href);
          const evaluated = await cdp.send("Runtime.evaluate", {
            expression: REDUCED_MOTION_AUDIT_EXPRESSION,
            returnByValue: true,
          });
          const result = evaluated.result?.value;
          if (
            evaluated.exceptionDetails
            || !result
            || result.h1Count !== 1
            || result.scrollBehavior !== "auto"
            || result.failures.length
            || result.revealFailures.length
          ) {
            errors.push(
              `${REDUCED_MOTION_VIEWPORT.label} ${route}: reduced-motion contract failed `
              + `${JSON.stringify(result ?? evaluated.exceptionDetails ?? null)}`,
            );
          }
          if (route === "/abracadabra/app/") {
            const controlModeAudit = await cdp.send("Runtime.evaluate", {
              expression:
                `document.querySelector('meta[name="sitesourcery-abracadabra-control-mode"]')`
                + `?.getAttribute("content") || ""`,
              returnByValue: true,
            });
            if (controlModeAudit.result?.value === "hosted") {
              const transitionAudit = await cdp.send("Runtime.evaluate", {
                expression: ABRACADABRA_REDUCED_MOTION_TRANSITION_EXPRESSION,
                awaitPromise: true,
                returnByValue: true,
              });
              const transition = transitionAudit.result?.value;
              if (
                transitionAudit.exceptionDetails
                || !transition
                || !transition.accountVisible
                || !transition.domOrderAligned
                || !transition.renderedOrderAligned
                || transition.focusName !== "signInEmail"
                || transition.behaviors.length === 0
                || transition.behaviors.some((behavior) => behavior !== "auto")
              ) {
                errors.push(
                  `${REDUCED_MOTION_VIEWPORT.label} ${route}: guest transition order, focus, or motion failed `
                  + `${JSON.stringify(transition ?? transitionAudit.exceptionDetails ?? null)}`,
                );
              }
            }
          }
          for (const message of runtimeErrors.slice(beforeErrors)) {
            errors.push(`${REDUCED_MOTION_VIEWPORT.label} ${route}: browser error ${message}`);
          }
          results.push({
            mode: "reduced-motion",
            route,
            viewport: REDUCED_MOTION_VIEWPORT.label,
          });
        }
      } finally {
        await cdp.send("Emulation.setEmulatedMedia", { features: [], media: "" });
      }
    }
    return { errors, results };
  } finally {
    if (cdp) await cdp.close();
    browser.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => browser.once("exit", resolve)),
      delay(2000),
    ]);
    if (browser.exitCode === null) browser.kill("SIGKILL");
    if (!cdp && browserErrors) {
      process.stderr.write(browserErrors.slice(-4000));
    }
    if (artifactServer) await artifactServer.close();
  }
}

async function auditRoutesIndependently({
  artifactRoot,
  origin,
  routes,
}) {
  const combined = {
    errors: [],
    results: [],
  };
  for (const route of routes) {
    try {
      const result = await auditBrowser({
        artifactRoot,
        origin,
        routes: [route],
      });
      combined.errors.push(...result.errors);
      combined.results.push(...result.results);
    } catch (error) {
      combined.errors.push(
        `${route}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return combined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const requestedArtifactRoot = process.env.SITESOURCERY_ARTIFACT_ROOT
      ? path.resolve(process.env.SITESOURCERY_ARTIFACT_ROOT)
      : DEFAULT_ARTIFACT_ROOT;
    const requestedOrigin = /^https?:\/\//u.test(process.argv[2] ?? "")
      ? process.argv[2]
      : undefined;
    const selectedRoutes = process.argv.slice(requestedOrigin ? 3 : 2);
    const routes = selectedRoutes.length ? selectedRoutes : CANONICAL_ROUTES;
    const result = await auditRoutesIndependently({
      artifactRoot: requestedArtifactRoot,
      origin: requestedOrigin,
      routes,
    });
    if (result.errors.length) {
      console.error(`Browser audit failed (${result.errors.length}):`);
      for (const error of result.errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      console.log(
        `Browser audit passed: ${routes.length} canonical routes at `
        + `${VIEWPORTS.length} primary viewports plus ${HIVE_COMPONENT_VIEWPORTS.length} `
        + `Hive breakpoint views, one no-script phone pass, and one reduced-motion phone pass; `
        + `one fresh reviewed browser target per route; `
        + `${routes.includes("/") ? "ten bounded homepage cold-load checks; " : ""}`
        + `${routes.length * PROGRESSIVE_FAILURE_SCENARIOS.length} bounded progressive-failure checks; `
        + `no console exceptions, broken images, `
        + `document overflow, or product boot failures; exact ${REVIEWED_CHROMIUM.version} `
        + `${requestedOrigin
          ? `audited ${requestedOrigin}`
          : `audited artifact ${requestedArtifactRoot}`}.`,
      );
    }
  } catch (error) {
    console.error(`browser-audit-vnext: ${error.message}`);
    process.exitCode = 1;
  }
}
