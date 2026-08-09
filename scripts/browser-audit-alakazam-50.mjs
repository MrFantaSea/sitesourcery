#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BROWSER = process.env.SITESOURCERY_CHROMIUM ||
  "/private/tmp/sitesourcery-chrome-149.0.7827.55-mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const EXPECTED_BROWSER = "Google Chrome for Testing 149.0.7827.55";
const VIEWPORTS = Object.freeze([
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 1440, height: 1000 }
]);
const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const moduleBytes = await readFile(
  path.join(ROOT, "abracadabra/app/abracadabra-alakazam-50.js")
);
const cssBytes = await readFile(
  path.join(ROOT, "abracadabra/app/abracadabra-alakazam-50.css")
);

function fixture() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/module.css"><style>
*{box-sizing:border-box}:root{--spark-text:#f8f4ff;--spark-muted:#c8bed4;--spark-mint:#82e7c4;--spark-gold:#f1cf89}
body{margin:0;color:var(--spark-text);background:#100b19;font:16px/1.5 Inter,system-ui,sans-serif}.shell{width:min(100% - 1rem,64rem);margin:1rem auto}.spark-button{min-height:44px;padding:.65rem .8rem;border:1px solid #f1cf89;border-radius:.6rem;color:#f8f4ff;background:#20152d;font:inherit}.spark-button-primary{color:#100b19;background:#f1cf89}
</style><script src="/module.js"></script></head><body><main class="shell" id="mount"></main><pre id="audit" hidden></pre>
<script>
const projectId=${JSON.stringify(PROJECT_ID)};
function configuration(revision){return {schema:"sitesourcery.alakazam-50-configuration/v1",commandId:"50000000-0000-4000-8000-000000000001",projectId,subscriptionId:"40000000-0000-4000-8000-000000000001",subscriptionRevision:7,configurationRevision:revision,cashAppHandle:"cedar.shop",venmoHandle:"cedar_shop",fontChoiceId:"editorial",borderChoiceId:"ornate",menu:[{target:"contact",label:"Pay Cedar"},{target:"about",label:"Our story"}],state:"held",holdReason:"commercial_cutover_not_authorized",configuredAt:"2026-08-09T12:00:00.000Z",configurationDigest:"a".repeat(64)}}
function snapshot(revision=1,care=0){return {schema:"sitesourcery.alakazam-50-snapshot/v1",state:"held",providerEffects:false,holdReason:"commercial_cutover_not_authorized",projectId,subscription:{subscriptionId:"40000000-0000-4000-8000-000000000001",tierId:"alakazam_50",status:"active",revision:7},controls:{cashApp:true,venmo:true,menuTargets:["about","offerings","practical","contact"],fonts:[{fontChoiceId:"inherit",label:"Use $35 font"},{fontChoiceId:"editorial",label:"Editorial"},{fontChoiceId:"studio",label:"Studio"}],borders:[{borderChoiceId:"soft",label:"Soft"},{borderChoiceId:"sharp",label:"Sharp"},{borderChoiceId:"ornate",label:"Ornate"}],careClass:"more"},configuration:configuration(revision),care:{state:"held",requestCount:care,lastRequestedAt:care?"2026-08-09T12:00:00.000Z":null}}}
let writes=0;
const client={getSnapshot:async()=>snapshot(),saveConfiguration:async()=>{writes+=1;return snapshot(2)},requestCare:async()=>{writes+=1;return snapshot(2,1)}};
const ids=["60000000-0000-4000-8000-000000000001","70000000-0000-4000-8000-000000000001"];
SiteSourceryAlakazam50.mount({container:document.querySelector("#mount"),projectId,client,cryptoObject:{randomUUID:()=>ids.shift()}});
setTimeout(()=>{document.querySelector(".spark-button-primary").click();setTimeout(()=>{const textarea=document.querySelector(".alakazam-50-care");textarea.value="Please review the premium menu.";Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("more-care")).click();setTimeout(()=>{const checkboxLabels=Array.from(document.querySelectorAll('input[type="checkbox"]')).map((input)=>input.closest("label.alakazam-50-check"));const directTargets=Array.from(document.querySelectorAll('button,input:not([type="checkbox"]),select,textarea'));const effectiveTargets=directTargets.concat(checkboxLabels);const result={width:innerWidth,height:innerHeight,horizontal:document.documentElement.scrollWidth<=innerWidth,checkboxLabels:checkboxLabels.length,targets:checkboxLabels.length===4&&checkboxLabels.every(Boolean)&&effectiveTargets.every((target)=>target.getBoundingClientRect().height>=44),blocks:document.querySelectorAll(".alakazam-50-block").length,menuRows:document.querySelectorAll(".alakazam-50-menu-row").length,writes,held:document.body.textContent.includes("No provider effect")||document.body.textContent.includes("no Stripe, publication, or provider effect")};const passed=result.horizontal&&result.checkboxLabels===4&&result.targets&&result.blocks===4&&result.menuRows===4&&result.writes===2&&result.held;document.documentElement.dataset.browserAudit=passed?"passed":"failed";document.querySelector("#audit").textContent=JSON.stringify(result)},40)},40)},40);
</script></body></html>`;
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }
  close() { this.socket.close(); }
}

async function pageSocket(port, state) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (state.exited) throw new Error(`Browser exited early: ${state.stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) =>
          target.type === "page" && target.webSocketDebuggerUrl
        );
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      // The browser is still opening its local debugger.
    }
    await delay(100);
  }
  throw new Error(`Timed out opening browser: ${state.stderr}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      "Browser evaluation failed"
    );
  }
  return result.result?.value;
}

async function waitFor(cdp, expression) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      if (await evaluate(cdp, `Boolean(${expression})`)) return;
    } catch {
      // Navigation may replace the execution context.
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

const version = spawnSync(BROWSER, ["--version"], { encoding: "utf8" });
if (version.status !== 0 || version.stdout.trim() !== EXPECTED_BROWSER) {
  throw new Error(`Expected ${EXPECTED_BROWSER}; received ${version.stdout.trim() || version.stderr.trim()}`);
}

const server = createServer((request, response) => {
  if (request.url === "/module.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(moduleBytes);
  } else if (request.url === "/module.css") {
    response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    response.end(cssBytes);
  } else {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixture());
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-f04-browser-"));
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
  "about:blank"
], { stdio: ["ignore", "ignore", "pipe"] });
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { processState.stderr += chunk; });
child.once("exit", () => { processState.exited = true; });
let cdp;
try {
  const address = server.address();
  cdp = new Cdp(await pageSocket(port, processState));
  await Promise.all([
    cdp.send("Page.enable"),
    cdp.send("Runtime.enable")
  ]);
  for (const viewport of VIEWPORTS) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 600,
      screenWidth: viewport.width,
      screenHeight: viewport.height
    });
    await cdp.send("Page.navigate", {
      url: `http://127.0.0.1:${address.port}/`
    });
    await waitFor(cdp, "document.documentElement.dataset.browserAudit");
    const result = await evaluate(cdp,
      'JSON.parse(document.querySelector("#audit").textContent)');
    const state = await evaluate(cdp,
      "document.documentElement.dataset.browserAudit");
    if (state !== "passed") {
      throw new Error(`Alakazam $50 browser audit failed at ${viewport.width}x${viewport.height}: ${JSON.stringify(result)}`);
    }
    if (result.width !== viewport.width || result.height !== viewport.height) {
      throw new Error(`Browser viewport mismatch: ${JSON.stringify(result)}`);
    }
  }
} finally {
  cdp?.close();
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2000)
  ]);
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}

console.log("Alakazam $50 browser audit passed: 1 held panel × 3 viewports, 4 fulfillment blocks, 4 configurable menu rows, 2 held commands per viewport, exact widths, no horizontal overflow, and 44px controls at 320×720, 390×844, and 1440×1000.");
