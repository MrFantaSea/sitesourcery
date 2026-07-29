#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REVIEWED_CHROMIUM,
  chromiumPath,
} from "./browser-audit-vnext.mjs";
import { buildHostedArtifact } from "./build-hosted.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const ARTIFACT_ROOT = path.join(ROOT, "_hosted");
const BROWSER = await chromiumPath();
const PROJECT_ID = "project_browser_domain";
const ORGANIZATION_ID = "org_browser_domain";
const ORDER_ID = "order_browser_domain";
const DOMAIN_ID = "domain_browser_domain";
const PRICE_CHECK_ID = "price_browser_domain";
const QUOTE_ID = "quote_browser_domain";
const CONTACT_ID = "contact_browser_domain";
const CONSENT_ID = "consent_browser_domain";
const HOSTNAME = "clear-customer-path.example";
const NOW = new Date();
const FUTURE = new Date(NOW.getTime() + 30 * 60 * 1000).toISOString();
const LATER = new Date(NOW.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

const contentTypes = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > 1024 * 1024) throw new Error("browser proof request body was too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function replyJson(response, status, payload) {
  const bytes = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": bytes.byteLength,
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": "browser-domain-proof",
  });
  response.end(bytes);
}

function project() {
  return {
    id: PROJECT_ID,
    projectId: PROJECT_ID,
    organizationId: ORGANIZATION_ID,
    name: "Browser domain journey",
    revision: 1,
    address: {
      kind: "custom",
      hostname: HOSTNAME,
      revision: "address-browser-domain-1",
    },
    versions: [],
    visibility: "private",
  };
}

function quote() {
  return {
    id: QUOTE_ID,
    quoteId: QUOTE_ID,
    projectId: PROJECT_ID,
    hostname: HOSTNAME,
    years: 1,
    purpose: "register",
    registrar: "Site Sourcery domain service",
    price: { amountMinor: 1800, currency: "USD" },
    renewal: { amountMinor: 1800, currency: "USD" },
    expiresAt: FUTURE,
    termsVersion: "domain-terms-browser-1",
    terms: {
      registrar: "Site Sourcery domain service",
      renewal: "Renewal is offered before the current term ends.",
      cancellation: "A completed registration cannot be cancelled.",
      ownership: "The customer is the registrant and owner.",
    },
  };
}

function contact() {
  return {
    id: CONTACT_ID,
    registrantContactId: CONTACT_ID,
    projectId: PROJECT_ID,
    name: "Customer Owner",
    organization: "Customer Company",
    email: "owner@example.test",
    phone: "+1 856 555 0199",
    addressLine1: "100 Customer Way",
    addressLine2: null,
    city: "Camden",
    region: "NJ",
    postalCode: "08103",
    countryCode: "US",
  };
}

function consent() {
  return {
    id: CONSENT_ID,
    consentId: CONSENT_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    registrantContactId: CONTACT_ID,
    termsVersion: "domain-terms-browser-1",
    autoRenewRequested: true,
  };
}

function order(status = "authorized") {
  return {
    id: ORDER_ID,
    orderId: ORDER_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    consentId: CONSENT_ID,
    hostname: HOSTNAME,
    status,
    paymentUrl:
      `/api/v1/domain-orders/${ORDER_ID}/payment?projectId=${PROJECT_ID}`,
  };
}

function managedDomain() {
  return {
    id: DOMAIN_ID,
    domainId: DOMAIN_ID,
    projectId: PROJECT_ID,
    hostname: HOSTNAME,
    status: "active",
    state: "active",
    expiresAt: LATER,
    autoRenew: true,
  };
}

function browserPathVersion() {
  const result = spawnSync(BROWSER, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, `reviewed browser did not start: ${result.stderr || ""}`);
  const observed = String(result.stdout || "").trim();
  assert.equal(observed, REVIEWED_CHROMIUM.version);
  return observed;
}

function safeArtifactPath(pathname) {
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
  if (
    normalized !== relative
    || normalized === ".."
    || normalized.startsWith("../")
  ) return null;
  const file = path.resolve(ARTIFACT_ROOT, normalized);
  return file.startsWith(`${path.resolve(ARTIFACT_ROOT)}${path.sep}`)
    ? file
    : null;
}

async function startProofServer() {
  const requests = [];
  let failDomainEnhancer = false;
  let dnsRecords = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (
      failDomainEnhancer
      && url.pathname === "/abracadabra/app/abracadabra-hosted-control-dom.js"
    ) {
      response.writeHead(503, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Forced hosted enhancer failure");
      return;
    }

    if (url.pathname.startsWith("/api/v1/")) {
      let body = null;
      try {
        body = await requestBody(request);
      } catch (error) {
        replyJson(response, 400, { code: "INVALID_BODY", message: error.message });
        return;
      }
      const route = url.pathname.slice("/api/v1".length);
      requests.push({
        method: request.method,
        route,
        query: Object.fromEntries(url.searchParams),
        body,
        csrf: request.headers["x-csrf-token"] || null,
        idempotencyKey: request.headers["idempotency-key"] || null,
      });

      if (request.method === "GET" && route === "/me") {
        replyJson(response, 200, {
          user: {
            id: "user_browser_domain",
            name: "Browser Proof",
            email: "browser-proof@example.test",
          },
          csrfToken: "csrf_browser_domain",
        });
        return;
      }
      if (request.method === "GET" && route === "/csrf") {
        replyJson(response, 200, { csrfToken: "csrf_browser_domain" });
        return;
      }
      if (request.method === "GET" && route === "/organizations") {
        replyJson(response, 200, {
          organizations: [{ id: ORGANIZATION_ID, name: "Browser Proof Company" }],
        });
        return;
      }
      if (
        request.method === "GET"
        && route === `/organizations/${ORGANIZATION_ID}/projects`
      ) {
        replyJson(response, 200, { projects: [project()] });
        return;
      }
      if (request.method === "GET" && route === `/projects/${PROJECT_ID}`) {
        replyJson(response, 200, { project: project() });
        return;
      }
      if (
        request.method === "GET"
        && route === `/projects/${PROJECT_ID}/subscription`
      ) {
        replyJson(response, 200, { subscription: null });
        return;
      }
      if (request.method === "GET" && route === "/domains/search") {
        replyJson(response, 200, {
          results: [{ hostname: HOSTNAME, available: true }],
        });
        return;
      }
      if (request.method === "POST" && route === "/domain-quotes") {
        replyJson(response, 201, { quote: quote() });
        return;
      }
      if (
        request.method === "POST"
        && route === `/organizations/${ORGANIZATION_ID}/registrant-contacts`
      ) {
        replyJson(response, 201, { registrantContact: contact() });
        return;
      }
      if (
        request.method === "POST"
        && route === `/domain-quotes/${QUOTE_ID}/consents`
      ) {
        replyJson(response, 201, { consent: consent() });
        return;
      }
      if (
        request.method === "POST"
        && route === `/projects/${PROJECT_ID}/domain-orders`
      ) {
        replyJson(response, 201, { domainOrder: order() });
        return;
      }
      if (
        request.method === "GET"
        && route === `/projects/${PROJECT_ID}/domain-orders`
      ) {
        replyJson(response, 200, { domainOrders: [order()] });
        return;
      }
      if (request.method === "GET" && route === `/domain-orders/${ORDER_ID}`) {
        replyJson(response, 200, { domainOrder: order() });
        return;
      }
      if (
        request.method === "POST"
        && route === `/domain-orders/${ORDER_ID}/price-checks`
      ) {
        replyJson(response, 201, {
          priceCheck: {
            id: PRICE_CHECK_ID,
            priceCheckId: PRICE_CHECK_ID,
            projectId: PROJECT_ID,
            orderId: ORDER_ID,
            status: "ready_to_confirm",
            available: true,
            finalPrice: { amountMinor: 1800, currency: "USD" },
            checkedAt: NOW.toISOString(),
            expiresAt: FUTURE,
          },
        });
        return;
      }
      if (
        request.method === "POST"
        && route === `/domain-orders/${ORDER_ID}/registration-requests`
      ) {
        replyJson(response, 202, {
          domainOrder: order("registration_submitted"),
        });
        return;
      }
      if (
        request.method === "GET"
        && route === `/organizations/${ORGANIZATION_ID}/domains`
      ) {
        replyJson(response, 200, { domains: [managedDomain()] });
        return;
      }
      if (request.method === "GET" && route === `/domains/${DOMAIN_ID}`) {
        replyJson(response, 200, { domain: managedDomain() });
        return;
      }
      if (
        request.method === "GET"
        && route === `/domains/${DOMAIN_ID}/dns-records`
      ) {
        replyJson(response, 200, { records: dnsRecords });
        return;
      }
      if (
        request.method === "PUT"
        && route === `/domains/${DOMAIN_ID}/dns-records/new`
      ) {
        dnsRecords = [{
          id: "dns_browser_domain",
          recordId: "dns_browser_domain",
          projectId: PROJECT_ID,
          domainId: DOMAIN_ID,
          type: body.type,
          name: body.name,
          content: body.content,
          ttl: body.ttl,
          state: "applied",
        }];
        replyJson(response, 200, {
          projectId: PROJECT_ID,
          record: dnsRecords[0],
        });
        return;
      }
      if (
        request.method === "DELETE"
        && route === `/domains/${DOMAIN_ID}/dns-records/dns_browser_domain`
      ) {
        dnsRecords = [];
        replyJson(response, 200, {
          projectId: PROJECT_ID,
          deleted: true,
        });
        return;
      }
      if (
        request.method === "GET"
        && route === `/domain-orders/${ORDER_ID}/payment`
      ) {
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "text/html; charset=utf-8",
        });
        response.end("<!doctype html><title>Same-origin payment relay proof</title>");
        return;
      }
      replyJson(response, 404, {
        code: "NOT_FOUND",
        message: `No browser proof route for ${request.method} ${route}`,
      });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    const file = safeArtifactPath(url.pathname);
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
        "Content-Type":
          contentTypes[path.extname(file).toLowerCase()]
          || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500);
      response.end(error?.code === "ENOENT" ? "Not found" : "Read failed");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    failEnhancer() {
      failDomainEnhancer = true;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

function connectCdp(socketUrl) {
  const socket = new WebSocket(socketUrl);
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
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) || []) {
      listener(message.params || {});
    }
  });
  return {
    async close() {
      for (const request of pending.values()) {
        request.reject(new Error("browser proof CDP connection closed"));
      }
      pending.clear();
      socket.close();
    },
    on(method, listener) {
      const entries = listeners.get(method) || [];
      entries.push(listener);
      listeners.set(method, entries);
      return () => {
        listeners.set(
          method,
          (listeners.get(method) || []).filter((entry) => entry !== listener),
        );
      };
    },
    async send(method, params = {}) {
      await opened;
      sequence += 1;
      return new Promise((resolve, reject) => {
        pending.set(sequence, { reject, resolve });
        socket.send(JSON.stringify({ id: sequence, method, params }));
      });
    },
  };
}

async function waitForTarget(port, browser, browserError) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (browser.exitCode !== null) {
      throw new Error(
        `reviewed browser exited ${browser.exitCode}: ${browserError()}`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(
          (entry) => entry.type === "page" && entry.webSocketDebuggerUrl,
        );
        if (target) return target.webSocketDebuggerUrl;
      }
    } catch {
      // The local debugging endpoint is still starting.
    }
    await delay(50);
  }
  throw new Error(`reviewed browser debugger did not start: ${browserError()}`);
}

async function navigate(cdp, url) {
  const loaded = new Promise((resolve) => {
    const off = cdp.on("Page.loadEventFired", () => {
      off();
      resolve();
    });
  });
  const result = await cdp.send("Page.navigate", { url });
  if (result.errorText) throw new Error(`navigation failed: ${result.errorText}`);
  await Promise.race([
    loaded,
    delay(8000).then(() => {
      throw new Error(`timed out loading ${url}`);
    }),
  ]);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || "browser proof expression failed",
    );
  }
  return result.result.value;
}

function domainRequest(entry) {
  return (
    entry.route.startsWith("/domain-quotes")
    || entry.route.includes("/registrant-contacts")
    || entry.route.startsWith("/domain-orders")
    || /\/projects\/[^/]+\/domain-orders$/u.test(entry.route)
    || (
      entry.route.startsWith("/domains/")
      && entry.route !== "/domains/search"
    )
    || /\/organizations\/[^/]+\/domains$/u.test(entry.route)
  );
}

const forbiddenBrowserAuthority = new Set([
  "amount",
  "amountminor",
  "available",
  "availability",
  "currency",
  "externalcheckoutref",
  "externalsubscriptionref",
  "lineitems",
  "paymentreceipt",
  "price",
  "priceid",
  "providerreference",
  "providerreceipt",
  "registered",
  "registrarreference",
  "registrationstate",
  "stripepriceid",
  "stripepricerefs",
  "totals",
]);

function claimedAuthority(value, pathParts = []) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      claimedAuthority(entry, [...pathParts, String(index)]));
  }
  const failures = [];
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = [...pathParts, key];
    if (forbiddenBrowserAuthority.has(key.toLowerCase())) {
      failures.push(nextPath.join("."));
    }
    failures.push(...claimedAuthority(nested, nextPath));
  }
  return failures;
}

const reviewedBrowserVersion = browserPathVersion();
await buildHostedArtifact({ root: ROOT, output: ARTIFACT_ROOT });
await readFile(path.join(ARTIFACT_ROOT, "abracadabra/app/index.html"));
const proofServer = await startProofServer();
const debuggingPort = 30000 + (process.pid % 15000);
const userDataDirectory = await mkdtemp(
  path.join(os.tmpdir(), "sitesourcery-hosted-domain-browser-"),
);
const browser = spawn(BROWSER, [
  "--headless",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-gpu",
  "--no-first-run",
  "--remote-debugging-address=127.0.0.1",
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${userDataDirectory}`,
  "about:blank",
], {
  stdio: ["ignore", "ignore", "pipe"],
});
let browserErrors = "";
browser.stderr.setEncoding("utf8");
browser.stderr.on("data", (chunk) => {
  browserErrors += chunk;
});
let cdp = null;

try {
  cdp = connectCdp(
    await waitForTarget(debuggingPort, browser, () => browserErrors),
  );
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const runtimeExceptions = [];
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    runtimeExceptions.push(
      exceptionDetails?.exception?.description
      || exceptionDetails?.text
      || "unknown browser exception",
    );
  });

  await navigate(cdp, `${proofServer.origin}/abracadabra/app/`);
  const journey = await evaluate(cdp, `(async () => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 5000;
      while (!predicate() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!predicate()) throw new Error("Timed out waiting for " + label);
    };
    await waitFor(
      () => window.SiteSourceryAbracadabraHostedSession
        && window.SiteSourceryAbracadabraHostedSession.getState().phase === "ready",
      "hosted session"
    );
    const control = window.SiteSourceryAbracadabraHostedSession;
    const tick = () => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    const snapshot = () => {
      const state = control.getState();
      const projectState = document.querySelector("[data-hosted-domain-project-state]");
      const stages = [...document.querySelectorAll("[data-domain-stage]")].map((stage) => ({
        step: stage.getAttribute("data-domain-stage"),
        hidden: stage.hidden,
        inert: stage.hasAttribute("inert")
      }));
      const current = document.querySelector('[data-domain-progress][aria-current="step"]');
      return {
        selectedProjectId: state.project && (state.project.id || state.project.projectId) || "",
        quoteId: state.domainQuote && (state.domainQuote.id || state.domainQuote.quoteId) || "",
        contactId: state.registrantContact
          && (state.registrantContact.id || state.registrantContact.registrantContactId) || "",
        consentId: state.domainConsent
          && (state.domainConsent.id || state.domainConsent.consentId) || "",
        orderId: state.domainOrder
          && (state.domainOrder.id || state.domainOrder.orderId) || "",
        priceCheckId: state.domainPriceCheck
          && (state.domainPriceCheck.id || state.domainPriceCheck.priceCheckId) || "",
        domainId: state.selectedDomain
          && (state.selectedDomain.id || state.selectedDomain.domainId) || "",
        dnsCount: state.dnsRecords.length,
        paymentUrl: state.domainOrder && state.domainOrder.paymentUrl || "",
        projectCopy: projectState && projectState.textContent || "",
        currentStep: current && current.getAttribute("data-domain-progress") || "",
        stages
      };
    };

    const proof = { initial: snapshot() };
    try {
      await control.createDomainQuote({
        hostname: ${JSON.stringify(HOSTNAME)},
        years: 1,
        purpose: "register"
      });
      proof.missingProjectError = null;
    } catch (error) {
      proof.missingProjectError = error && error.code || error && error.message || "unknown";
    }

    await control.selectProject(${JSON.stringify(PROJECT_ID)});
    await tick();
    proof.selected = snapshot();
    await control.searchDomains(${JSON.stringify(HOSTNAME)});
    await control.createDomainQuote({
      hostname: ${JSON.stringify(HOSTNAME)},
      years: 1,
      purpose: "register"
    });
    await tick();
    proof.quoted = snapshot();
    await control.saveRegistrantContact({
      name: "Customer Owner",
      organization: "Customer Company",
      email: "owner@example.test",
      phone: "+1 856 555 0199",
      addressLine1: "100 Customer Way",
      addressLine2: "",
      city: "Camden",
      region: "NJ",
      postalCode: "08103",
      countryCode: "US"
    });
    await tick();
    proof.ownerSaved = snapshot();
    await control.acceptDomainConsent({
      termsVersion: "domain-terms-browser-1",
      registrationAgreementAccepted: true,
      registrantCertificationAccepted: true,
      autoRenewRequested: true
    });
    await tick();
    proof.reviewed = snapshot();
    await control.createDomainOrder();
    await tick();
    proof.paymentOrder = snapshot();
    await control.listDomainOrders();
    await control.pollDomainOrder();
    await control.refreshDomainPrice();
    await tick();
    proof.finalPrice = snapshot();
    await control.requestDomainRegistration({
      irreversibleRegistrationAccepted: true
    });
    await control.listDomains();
    await control.selectDomain(${JSON.stringify(DOMAIN_ID)});
    await control.upsertDnsRecord({
      type: "TXT",
      name: "_sitesourcery",
      content: "browser-domain-proof",
      ttl: 300
    });
    await tick();
    proof.dnsAdded = snapshot();
    await control.deleteDnsRecord("dns_browser_domain");
    await tick();
    proof.completed = snapshot();
    proof.controlReady = document.documentElement.getAttribute(
      "data-abracadabra-control-ready"
    );
    proof.mode = document.querySelector(
      'meta[name="sitesourcery-abracadabra-control-mode"]'
    )?.content || "";
    return proof;
  })()`);

  assert.equal(journey.mode, "hosted");
  assert.equal(journey.controlReady, "hosted");
  assert.equal(journey.missingProjectError, "PROJECT_REQUIRED");
  assert.equal(journey.initial.selectedProjectId, "");
  assert.equal(journey.initial.currentStep, "1");
  assert.match(journey.initial.projectCopy, /Choose a project/iu);
  assert.equal(journey.selected.selectedProjectId, PROJECT_ID);
  assert.equal(journey.selected.currentStep, "1");
  assert.equal(journey.quoted.quoteId, QUOTE_ID);
  assert.equal(journey.quoted.currentStep, "2");
  assert.equal(journey.ownerSaved.contactId, CONTACT_ID);
  assert.equal(journey.ownerSaved.currentStep, "3");
  assert.equal(journey.reviewed.consentId, CONSENT_ID);
  assert.equal(journey.reviewed.currentStep, "4");
  assert.equal(journey.paymentOrder.orderId, ORDER_ID);
  assert.equal(
    journey.paymentOrder.paymentUrl,
    `/api/v1/domain-orders/${ORDER_ID}/payment?projectId=${PROJECT_ID}`,
  );
  assert.equal(journey.finalPrice.priceCheckId, PRICE_CHECK_ID);
  assert.equal(journey.dnsAdded.domainId, DOMAIN_ID);
  assert.equal(journey.dnsAdded.dnsCount, 1);
  assert.equal(journey.completed.dnsCount, 0);
  for (const [key, expectedStep] of Object.entries({
    initial: "1",
    selected: "1",
    quoted: "2",
    ownerSaved: "3",
    reviewed: "4",
    paymentOrder: "4",
    finalPrice: "4",
  })) {
    const visible = journey[key].stages.filter((stage) => !stage.hidden);
    assert.deepEqual(
      visible.map(({ step }) => step),
      [expectedStep],
      `${key} must expose exactly domain step ${expectedStep}`,
    );
    assert.equal(
      journey[key].stages
        .filter(({ step }) => step !== expectedStep)
        .every(({ hidden, inert }) => hidden && inert),
      true,
      `${key} must hold later or completed domain steps`,
    );
  }
  assert.deepEqual(runtimeExceptions, []);

  await navigate(
    cdp,
    `${proofServer.origin}/abracadabra/app/?domain-payment-click-proof=1`,
  );
  const paymentLoaded = new Promise((resolve) => {
    const off = cdp.on("Page.loadEventFired", () => {
      off();
      resolve();
    });
  });
  const paymentClickSetup = await evaluate(cdp, `(async () => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 5000;
      while (!predicate() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!predicate()) throw new Error("Timed out waiting for " + label);
    };
    await waitFor(
      () => window.SiteSourceryAbracadabraHostedSession
        && window.SiteSourceryAbracadabraHostedSession.getState().phase === "ready",
      "hosted payment-click session"
    );
    const control = window.SiteSourceryAbracadabraHostedSession;
    await control.selectProject(${JSON.stringify(PROJECT_ID)});
    await control.searchDomains(${JSON.stringify(HOSTNAME)});
    await control.createDomainQuote({
      hostname: ${JSON.stringify(HOSTNAME)},
      years: 1,
      purpose: "register"
    });
    await control.saveRegistrantContact({
      name: "Customer Owner",
      organization: "Customer Company",
      email: "owner@example.test",
      phone: "+1 856 555 0199",
      addressLine1: "100 Customer Way",
      addressLine2: "",
      city: "Camden",
      region: "NJ",
      postalCode: "08103",
      countryCode: "US"
    });
    await control.acceptDomainConsent({
      termsVersion: "domain-terms-browser-1",
      registrationAgreementAccepted: true,
      registrantCertificationAccepted: true,
      autoRenewRequested: true
    });
    const button = [...document.querySelectorAll(
      '[data-domain-stage="4"] button'
    )].find((candidate) =>
      candidate.textContent.trim() === "Continue to domain payment"
    );
    if (!button || button.disabled) {
      throw new Error("The customer domain payment action was unavailable");
    }
    button.click();
    return {
      clicked: true,
      beforePath: location.pathname,
      buttonText: button.textContent.trim()
    };
  })()`);
  await Promise.race([
    paymentLoaded,
    delay(8000).then(() => {
      throw new Error("timed out following the same-origin domain payment relay");
    }),
  ]);
  const paymentClick = await evaluate(cdp, `(() => ({
    path: location.pathname,
    search: location.search,
    origin: location.origin,
    title: document.title
  }))()`);
  assert.deepEqual(paymentClickSetup, {
    clicked: true,
    beforePath: "/abracadabra/app/",
    buttonText: "Continue to domain payment",
  });
  assert.deepEqual(paymentClick, {
    path: `/api/v1/domain-orders/${ORDER_ID}/payment`,
    search: `?projectId=${PROJECT_ID}`,
    origin: proofServer.origin,
    title: "Same-origin payment relay proof",
  });
  assert.deepEqual(runtimeExceptions, []);

  const boundRequests = proofServer.requests.filter(domainRequest);
  assert.ok(boundRequests.length >= 21);
  for (const entry of boundRequests) {
    const pathProject = entry.route.startsWith(`/projects/${PROJECT_ID}/domain-orders`)
      ? PROJECT_ID
      : null;
    assert.equal(
      entry.body?.projectId || entry.query.projectId || pathProject,
      PROJECT_ID,
      `${entry.method} ${entry.route} was not bound to the selected project`,
    );
    assert.deepEqual(
      claimedAuthority(entry.body),
      [],
      `${entry.method} ${entry.route} carried browser authority`,
    );
    if (["POST", "PUT", "PATCH", "DELETE"].includes(entry.method)) {
      assert.equal(entry.csrf, "csrf_browser_domain");
      assert.ok(entry.idempotencyKey);
    }
  }

  proofServer.failEnhancer();
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await navigate(
    cdp,
    `${proofServer.origin}/abracadabra/app/?forced-hosted-enhancer-failure=1`,
  );
  const fallback = await evaluate(cdp, `(async () => {
    const deadline = Date.now() + 5000;
    while (
      document.documentElement.getAttribute("data-abracadabra-progressive-ready") !== "true"
      && Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const businessName = document.querySelector('[name="businessName"]');
    const next = document.querySelector('[data-next="vibe"]');
    const rect = businessName && businessName.getBoundingClientRect();
    return {
      mode: document.querySelector(
        'meta[name="sitesourcery-abracadabra-control-mode"]'
      )?.content || "",
      makerReady: document.documentElement.getAttribute(
        "data-abracadabra-progressive-ready"
      ),
      businessNamePresent: Boolean(businessName),
      businessNameVisible: Boolean(
        rect && rect.width > 0 && rect.height > 0
        && getComputedStyle(businessName).display !== "none"
      ),
      nextPresent: Boolean(next),
      storefrontPresent: Boolean(
        document.querySelector("[data-hosted-domain-storefront]")
      ),
      hostedSessionPresent: Boolean(
        window.SiteSourceryAbracadabraHostedSession
      ),
      controlReady: document.documentElement.getAttribute(
        "data-abracadabra-control-ready"
      )
    };
  })()`);
  assert.deepEqual(fallback, {
    mode: "hosted",
    makerReady: "true",
    businessNamePresent: true,
    businessNameVisible: true,
    nextPresent: true,
    storefrontPresent: false,
    hostedSessionPresent: false,
    controlReady: null,
  });

  process.stdout.write(`${JSON.stringify({
    pass: true,
    reviewedBrowserVersion,
    projectId: PROJECT_ID,
    journey,
    paymentClick,
    fallback,
    domainRequestCount: boundRequests.length,
    domainRequests: boundRequests.map(({ method, route, query, body }) => ({
      method,
      route,
      query,
      body,
    })),
  }, null, 2)}\n`);
} finally {
  if (cdp) await cdp.close().catch(() => {});
  browser.kill("SIGTERM");
  await proofServer.close().catch(() => {});
  await rm(userDataDirectory, { recursive: true, force: true });
}
