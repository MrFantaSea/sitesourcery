#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const BROWSER = process.env.SITESOURCERY_CHROMIUM ||
  "/private/tmp/sitesourcery-chrome-149.0.7827.55-mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const EXPECTED_BROWSER = "Google Chrome for Testing 149.0.7827.55";
const EXPECTED_PANEL_SOURCE_SHA256 =
  "abc8a93995f32a74424dcf946af3bc0f7ff0aec17d877d6785936f25174e5d14";
const VIEWPORTS = Object.freeze([
  { width: 320, height: 720, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 1440, height: 1000, mobile: false }
]);
const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const CURRENT_VERSION_ID =
  "31000000-0000-4000-8000-000000000001";
const PRIOR_VERSION_ID =
  "31000000-0000-4000-8000-000000000002";
const CURRENT_RELEASE_ID =
  "32000000-0000-4000-8000-000000000001";
const PRIOR_RELEASE_ID =
  "32000000-0000-4000-8000-000000000002";
const PANEL_EXPORT_NEEDLE = `    confirmedAlakazamDowngradeProjection:
      confirmedAlakazamDowngradeProjection,
    alakazamAccountPresentation:`;
const PANEL_EXPORT_REPLACEMENT = `    confirmedAlakazamDowngradeProjection:
      confirmedAlakazamDowngradeProjection,
    createAlakazamPublicationPanel:
      createAlakazamPublicationPanel,
    alakazamAccountPresentation:`;
const sourceBytes = await readFile(
  path.join(
    ROOT,
    "abracadabra/app/abracadabra-customer-control-dom.js"
  )
);
const sourceDigest = createHash("sha256")
  .update(sourceBytes)
  .digest("hex");
const source = sourceBytes.toString("utf8");
let moduleSource;
if (sourceDigest === EXPECTED_PANEL_SOURCE_SHA256) {
  if (
    !source.includes(PANEL_EXPORT_NEEDLE) ||
    source.indexOf(PANEL_EXPORT_NEEDLE) !==
      source.lastIndexOf(PANEL_EXPORT_NEEDLE)
  ) {
    throw new Error("Publication panel export seam is not exact");
  }
  moduleSource = source.replace(
    PANEL_EXPORT_NEEDLE,
    PANEL_EXPORT_REPLACEMENT
  );
} else if (
  source.includes(PANEL_EXPORT_REPLACEMENT) &&
  source.indexOf(PANEL_EXPORT_REPLACEMENT) ===
    source.lastIndexOf(PANEL_EXPORT_REPLACEMENT) &&
  createHash("sha256")
    .update(source.replace(
      PANEL_EXPORT_REPLACEMENT,
      PANEL_EXPORT_NEEDLE
    ))
    .digest("hex") === EXPECTED_PANEL_SOURCE_SHA256
) {
  moduleSource = source;
} else {
  throw new Error(
    `Publication panel source drifted: ${sourceDigest}`
  );
}
const moduleBytes = Buffer.from(moduleSource, "utf8");
const cssBytes = await readFile(
  path.join(ROOT, "abracadabra/app/abracadabra-app.css")
);

function fixture() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/module.css"><style>
*{box-sizing:border-box}:root{--spark-text:#f8f4ff;--spark-muted:#c8bed4;--spark-mint:#82e7c4;--spark-gold:#f1cf89;--spark-line:rgba(255,255,255,.18)}body{margin:0;color:var(--spark-text);background:#100b19;font:16px/1.5 Inter,system-ui,sans-serif}.shell{width:min(100% - 1rem,64rem);margin:1rem auto}.spark-button{min-height:44px;padding:.65rem .8rem;border:1px solid #f1cf89;border-radius:.6rem;color:#f8f4ff;background:#20152d;font:inherit}.spark-button:disabled{opacity:.45}
</style><script src="/module.js"></script></head><body><main class="shell" id="mount"></main><pre id="audit" hidden></pre>
<script>
const projectId=${JSON.stringify(PROJECT_ID)};
const currentVersionId=${JSON.stringify(CURRENT_VERSION_ID)};
const priorVersionId=${JSON.stringify(PRIOR_VERSION_ID)};
const currentReleaseId=${JSON.stringify(CURRENT_RELEASE_ID)};
const priorReleaseId=${JSON.stringify(PRIOR_RELEASE_ID)};
let commands=[];
let sequence=0;
function command(action,snapshot){sequence+=1;return {commandId:"40000000-0000-4000-8000-"+String(sequence).padStart(12,"0"),action,state:"held",holdReason:"commercial_cutover_not_authorized",snapshotDigest:snapshot.snapshotDigest,commandDigest:String(sequence).repeat(64).slice(0,64),targetReleaseId:action==="rollback"?priorReleaseId:null,targetVersionId:action==="unpublish"?null:(action==="rollback"?priorVersionId:currentVersionId),requestedAt:"2026-08-09T16:00:0"+sequence+".000Z"};}
function snapshot(mode,recorded=null){const live=mode==="live";return {schema:"sitesourcery.alakazam-publication/v1",projectId,state:"held",holdReason:"commercial_cutover_not_authorized",subscription:{subscriptionId:"33000000-0000-4000-8000-000000000001",revision:7,tierId:"alakazam_35",status:"active"},site:{hostname:"cedar.sitesourcery.me",state:live?"live":"dark",acceptedVersionId:currentVersionId,acceptedArtifactDigest:"6".repeat(64),currentReleaseId:live?currentReleaseId:null,currentVersionId:live?currentVersionId:null,updatedAt:"2026-08-09T15:55:00.000Z"},history:[{releaseId:currentReleaseId,versionId:currentVersionId,artifactDigest:"7".repeat(64),releasedAt:"2026-08-09T15:30:00.000Z",isCurrent:live},{releaseId:priorReleaseId,versionId:priorVersionId,artifactDigest:"8".repeat(64),releasedAt:"2026-08-01T15:30:00.000Z",isCurrent:false}],actions:{publish:!live,rollback:live,unpublish:live,rollbackTargetReleaseId:live?priorReleaseId:null},snapshotDigest:"4".repeat(64),command:recorded};}
let mode="live";
const panel=SiteSourceryAbracadabraCustomerControl.createAlakazamPublicationPanel(document,{command(action,current){const recorded=command(action,current);commands.push(action);panel.render({projectId,phase:"ready",capability:true,snapshot:snapshot(mode,recorded)});panel.focusStatus();}});
document.querySelector("#mount").append(panel.element);
globalThis.renderPublication=(next)=>{mode=next;panel.render({projectId,phase:"ready",capability:true,snapshot:snapshot(mode)});};
globalThis.publicationCommands=()=>commands.slice();
globalThis.resetPublication=()=>{commands=[];sequence=0;renderPublication("live");};
resetPublication();document.documentElement.dataset.browserAudit="ready";
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
  const port = address && typeof address === "object"
    ? address.port
    : 0;
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
    if (state.exited) {
      throw new Error(`Browser exited early: ${state.stderr}`);
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/json/list`
      );
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) =>
          target.type === "page" && target.webSocketDebuggerUrl
        );
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      // The self-spawned browser debugger is still opening.
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

async function activate(cdp, action) {
  const selector = `[data-alakazam-publication-action="${action}"]`;
  const focused = await evaluate(
    cdp,
    `(() => {const button=document.querySelector(${JSON.stringify(selector)});if(!button||button.disabled)return false;button.focus();return document.activeElement===button;})()`
  );
  if (!focused) return false;
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: " ",
    code: "Space",
    text: " ",
    unmodifiedText: " ",
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32
  });
  return true;
}

const version = spawnSync(BROWSER, ["--version"], {
  encoding: "utf8"
});
if (
  version.status !== 0 ||
  version.stdout.trim() !== EXPECTED_BROWSER
) {
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
    response.writeHead(200, {
      "content-type": "text/css; charset=utf-8"
    });
    response.end(cssBytes);
  } else {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8"
    });
    response.end(fixture());
  }
});
await new Promise((resolve) =>
  server.listen(0, "127.0.0.1", resolve)
);
const profile = await mkdtemp(
  path.join(os.tmpdir(), "sitesourcery-f08-browser-")
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
      mobile: viewport.mobile,
      screenWidth: viewport.width,
      screenHeight: viewport.height
    });
    await cdp.send("Page.navigate", {
      url: `http://127.0.0.1:${address.port}/`
    });
    await waitFor(
      cdp,
      "document.documentElement.dataset.browserAudit === 'ready'"
    );
    const live = await evaluate(cdp, `(() => {const buttons=[...document.querySelectorAll("[data-alakazam-publication-action]")];return {width:innerWidth,scrollWidth:Math.max(document.body.scrollWidth,document.documentElement.scrollWidth),history:document.querySelectorAll(".customer-alakazam-publication-list li").length,text:document.querySelector("[data-alakazam-publication]").textContent.replace(/\\s+/g," ").trim(),buttons:buttons.map((button)=>({action:button.dataset.alakazamPublicationAction,disabled:button.disabled,height:button.getBoundingClientRect().height}))};})()`);
    if (
      live.width !== viewport.width ||
      live.scrollWidth !== viewport.width ||
      live.history !== 2 ||
      live.buttons.some(({ height }) => height < 44) ||
      JSON.stringify(live.buttons.map(({ action, disabled }) => [action, disabled])) !==
        JSON.stringify([["publish", true], ["rollback", false], ["unpublish", false]]) ||
      !live.text.includes("Alakazam publication remains held") ||
      !live.text.includes("no live provider effect")
    ) {
      throw new Error(
        `Live publication panel failed at ${viewport.width}x${viewport.height}: ${JSON.stringify(live)}`
      );
    }
    if (!await activate(cdp, "rollback")) {
      throw new Error("Rollback was not keyboard operable");
    }
    await waitFor(cdp, "publicationCommands().length === 1");
    await evaluate(cdp, "renderPublication('live')");
    if (!await activate(cdp, "unpublish")) {
      throw new Error("Unpublish was not keyboard operable");
    }
    await waitFor(cdp, "publicationCommands().length === 2");
    await evaluate(cdp, "renderPublication('dark')");
    const dark = await evaluate(cdp, `(() => {const buttons=[...document.querySelectorAll("[data-alakazam-publication-action]")];return {scrollWidth:Math.max(document.body.scrollWidth,document.documentElement.scrollWidth),buttons:buttons.map((button)=>({action:button.dataset.alakazamPublicationAction,disabled:button.disabled,height:button.getBoundingClientRect().height}))};})()`);
    if (
      dark.scrollWidth !== viewport.width ||
      dark.buttons.some(({ height }) => height < 44) ||
      JSON.stringify(dark.buttons.map(({ action, disabled }) => [action, disabled])) !==
        JSON.stringify([["publish", false], ["rollback", true], ["unpublish", true]])
    ) {
      throw new Error(
        `Dark publication panel failed at ${viewport.width}x${viewport.height}: ${JSON.stringify(dark)}`
      );
    }
    if (!await activate(cdp, "publish")) {
      throw new Error("Publish was not keyboard operable");
    }
    await waitFor(cdp, "publicationCommands().length === 3");
    const commands = await evaluate(cdp, "publicationCommands()");
    if (
      JSON.stringify(commands) !==
        JSON.stringify(["rollback", "unpublish", "publish"])
    ) {
      throw new Error(`Publication commands drifted: ${JSON.stringify(commands)}`);
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
  "F-08 publication controls browser audit passed: 1 existing held panel × 3 viewports, exact live/dark publish/rollback/unpublish authority, keyboard operation, 44px controls, no horizontal overflow, and no provider effect at 320x720, 390x844, and 1440x1000."
);
