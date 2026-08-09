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
const PROJECTS = Object.freeze([
  "30000000-0000-4000-8000-000000000061",
  "30000000-0000-4000-8000-000000000062",
  "30000000-0000-4000-8000-000000000063"
]);
const moduleBytes = await readFile(
  path.join(
    ROOT,
    "abracadabra/app/abracadabra-alakazam-retained-premium.js"
  )
);
const cssBytes = await readFile(
  path.join(
    ROOT,
    "abracadabra/app/abracadabra-alakazam-retained-premium.css"
  )
);

function fixture() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/module.css"><style>
*{box-sizing:border-box}:root{--spark-text:#f8f4ff;--spark-muted:#c8bed4;--spark-mint:#82e7c4;--spark-gold:#f1cf89}
body{margin:0;color:var(--spark-text);background:#100b19;font:16px/1.5 Inter,system-ui,sans-serif}.shell{width:min(100% - 1rem,72rem);margin:1rem auto}.spark-button{min-height:44px;border:1px solid #82e7c4;border-radius:.6rem;color:#f8f4ff;background:#20152d;font:inherit}.spark-button-primary{color:#100b19;background:#82e7c4}
</style><script src="/module.js"></script></head><body><main class="shell" id="mount"></main><pre id="audit" hidden></pre>
<script>
const projects=${JSON.stringify(PROJECTS)};
const values={configurationRevision:1,configurationDigest:"a".repeat(64),cashAppHandle:"cedar.shop",venmoHandle:"cedar_shop",fontChoiceId:"studio",borderChoiceId:"sharp",menu:[{target:"contact",label:"Pay Cedar"},{target:"about",label:"Our story"}],configuredAt:"2026-08-09T12:00:00.000Z"};
function base(projectId){return {schema:"sitesourcery.alakazam-retained-premium-snapshot/v1",policyId:"SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1",state:"held",providerEffects:false,holdReason:"commercial_cutover_not_authorized",projectId,lifecycle:{state:"active",retentionEndsAt:null,privateRead:true,customerExport:true,edit:true,publish:true,care:true},subscription:{tierId:"alakazam_35",status:"active",revision:8,cancelAtPeriodEnd:false},premium:{configured:true,configurationRevision:1,configurationDigest:"a".repeat(64),effectiveOutput:"masked",values:null},restoration:{required:false,available:false,sourceConfigurationRevision:null,sourceConfigurationDigest:null},actions:{edit:false,restore:false,export:true,publish:true,care:true}}}
function lower(projectId){return base(projectId)}
function grace(projectId){const result=base(projectId);result.lifecycle={state:"payment_grace",retentionEndsAt:"2026-08-16T12:00:00.000Z",privateRead:true,customerExport:true,edit:false,publish:false,care:false};result.subscription={tierId:"alakazam_50",status:"grace",revision:10,cancelAtPeriodEnd:false};result.premium={configured:true,configurationRevision:1,configurationDigest:"a".repeat(64),effectiveOutput:"masked",values};result.actions={edit:false,restore:false,export:true,publish:false,care:false};return result}
function upgrade(projectId,restored){const result=base(projectId);result.subscription={tierId:"alakazam_50",status:"active",revision:9,cancelAtPeriodEnd:false};result.premium={configured:true,configurationRevision:restored?2:1,configurationDigest:(restored?"b":"a").repeat(64),effectiveOutput:restored?"available":"masked",values:Object.assign({},values,{configurationRevision:restored?2:1,configurationDigest:(restored?"b":"a").repeat(64)})};result.restoration=restored?{required:false,available:false,sourceConfigurationRevision:null,sourceConfigurationDigest:null}:{required:true,available:true,sourceConfigurationRevision:1,sourceConfigurationDigest:"a".repeat(64)};result.actions={edit:restored,restore:!restored,export:true,publish:true,care:true};return result}
function customerExport(projectId){return {schema:"sitesourcery.alakazam-retained-premium-export/v1",policyId:"SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1",projectId,exportedAt:"2026-08-09T13:00:00.000Z",configuration:values,state:"held",providerEffects:false,exportDigest:"e".repeat(64),byteCount:512}}
let exportsPrepared=0;let restorations=0;
const mount=document.querySelector("#mount");
const snapshots=[lower(projects[0]),grace(projects[1]),upgrade(projects[2],false)];
snapshots.forEach((snapshot,index)=>{const container=document.createElement("div");mount.append(container);const projectId=projects[index];const client={getSnapshot:async()=>snapshot,getExport:async()=>customerExport(projectId),restoreConfiguration:async()=>{restorations+=1;snapshot=upgrade(projectId,true);snapshots[index]=snapshot;return snapshot}};SiteSourceryAlakazamRetainedPremium.mount({container,projectId,client,cryptoObject:{randomUUID:()=>"50000000-0000-4000-8000-000000000061"},onExport:()=>{exportsPrepared+=1}})});
setTimeout(()=>{const restore=Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Restore retained"));restore.click();setTimeout(()=>{Array.from(document.querySelectorAll("button")).filter((button)=>button.textContent.includes("Export my")).forEach((button)=>button.click());setTimeout(()=>{const targets=Array.from(document.querySelectorAll("button"));const result={width:innerWidth,height:innerHeight,horizontal:document.documentElement.scrollWidth<=innerWidth,targets:targets.length===3&&targets.every((target)=>target.getBoundingClientRect().height>=44),panels:document.querySelectorAll("[data-alakazam-retained-premium]").length,masked:document.querySelectorAll(".is-masked").length,readOnly:document.querySelectorAll(".is-read-only").length,restored:document.querySelectorAll(".is-restored").length,exportsPrepared,restorations,held:document.body.textContent.includes("Commercial release remains held")&&document.body.textContent.includes("No provider effect ran")};const passed=result.horizontal&&result.targets&&result.panels===3&&result.masked===1&&result.readOnly===1&&result.restored===1&&result.exportsPrepared===3&&result.restorations===1&&result.held;document.documentElement.dataset.browserAudit=passed?"passed":"failed";document.querySelector("#audit").textContent=JSON.stringify(result)},80)},80)},80);
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
  close() {
    this.socket.close();
  }
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
      await delay(100);
      continue;
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
      await delay(50);
      continue;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

const version = spawnSync(BROWSER, ["--version"], { encoding: "utf8" });
if (version.status !== 0 || version.stdout.trim() !== EXPECTED_BROWSER) {
  throw new Error(
    `Expected ${EXPECTED_BROWSER}; received ${
      version.stdout.trim() || version.stderr.trim()
    }`
  );
}

const server = createServer((request, response) => {
  if (request.url === "/module.js") {
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8"
    });
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
const profile = await mkdtemp(
  path.join(os.tmpdir(), "sitesourcery-f06-browser-")
);
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
child.stderr.on("data", (chunk) => {
  processState.stderr += chunk;
});
child.once("exit", () => {
  processState.exited = true;
});
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
    const result = await evaluate(
      cdp,
      'JSON.parse(document.querySelector("#audit").textContent)'
    );
    const state = await evaluate(
      cdp,
      "document.documentElement.dataset.browserAudit"
    );
    if (state !== "passed") {
      throw new Error(
        `Retained premium browser audit failed at ${
          viewport.width
        }x${viewport.height}: ${JSON.stringify(result)}`
      );
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

console.log(
  "Retained Alakazam premium browser audit passed: 3 held panels × 3 viewports, one masked downgrade, one read-only grace state, one evidence-restored re-upgrade, 3 bounded exports and 1 held restoration per viewport, exact widths, no horizontal overflow, and 44px controls at 320×720, 390×844, and 1440×1000."
);
