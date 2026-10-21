import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildHostedArtifact } from "../../scripts/build-hosted.mjs";
import { openReviewedBrowser } from "../../server/hosted/test/reviewed-browser-support.mjs";
import { PUBLIC_HTML_CONTENT_SECURITY_POLICY } from "../public-html-security-policy.mjs";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json" };
const NEGATIVE_HTML = `<!doctype html><html><head><title>CSP negative fixture</title>
<base href="https://blocked.invalid/"></head><body>
<button id="inline-handler" onclick="window.handlerRan=true">Probe</button>
<script>window.inlineRan=true</script><script src="/__csp-probe.js"></script>
</body></html>`;
const NEGATIVE_SCRIPT = `window.probe = {};
try { new Function("window.evalRan=true")(); } catch (error) { probe.evalBlocked = error.name === "EvalError"; }
document.querySelector("#inline-handler").click();
const script=document.createElement("script"); script.src="https://blocked.invalid/script.js"; document.head.append(script);
const frame=document.createElement("iframe"); frame.src="https://blocked.invalid/frame"; document.body.append(frame);
const object=document.createElement("object"); object.data="https://blocked.invalid/object"; document.body.append(object);
const form=document.createElement("form"); form.action="https://blocked.invalid/form"; form.method="post"; document.body.append(form); form.submit();
fetch("https://blocked.invalid/data").then(()=>probe.connectBlocked=false,()=>probe.connectBlocked=true);
probe.ready=true;`;

test("real browser enforces public CSP while current documents and inert previews work", { timeout: 120000 }, async t => {
  // Same reviewed Chrome contract as the existing mandatory browser fixtures;
  // CI installs that exact browser before npm test. No external browser download.
  const temporary = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-csp-browser-"));
  let server;
  let browser;
  let origin;
  const escapedRequests = [];
  const interceptedDns = [];
  const interceptionFailures = [];
  try {
    const artifact = path.join(temporary, "hosted");
    await buildHostedArtifact({ root: ROOT, output: artifact });
    const files = (await readdir(artifact, { recursive: true })).filter(name => name.endsWith(".html")).sort();
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, "http://fixture.invalid");
        let bytes;
        let type;
        let status = 200;
        if (url.pathname === "/__csp-negative") {
          bytes = NEGATIVE_HTML; type = "text/html";
        } else if (url.pathname === "/__csp-probe.js") {
          bytes = NEGATIVE_SCRIPT; type = "text/javascript";
        } else if (url.pathname.startsWith("/api/")) {
          type = "application/json";
          bytes = JSON.stringify(url.pathname === "/api/v1/me"
            ? { user: null, csrfToken: "csp-local-fixture" }
            : { error: { code: "CSP_FIXTURE_HELD", message: "Local read-only fixture." } });
          if (url.pathname !== "/api/v1/me") status = 503;
        } else {
          let relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
          if (!relative || relative.endsWith("/")) relative += "index.html";
          const selected = path.resolve(artifact, relative);
          assert.ok(selected.startsWith(`${artifact}${path.sep}`));
          type = TYPES[path.extname(selected)] ?? "application/octet-stream";
          try { bytes = await readFile(selected); }
          catch { bytes = await readFile(path.join(artifact, "404.html")); type = "text/html"; status = 404; }
        }
        response.writeHead(status, { "Content-Type": `${type}; charset=utf-8`,
          "Content-Security-Policy": PUBLIC_HTML_CONTENT_SECURITY_POLICY,
          "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        response.end(bytes);
      } catch {
        response.writeHead(500); response.end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await openReviewedBrowser({ origin, viewport: { width: 390, height: 844, mobile: true } });
    browser.cdp.on("Fetch.requestPaused", event => {
      (async () => {
        const target = new URL(event.request.url);
        if (target.origin === origin) {
          await browser.cdp.send("Fetch.continueRequest", { requestId: event.requestId });
        } else if (target.origin === "https://cloudflare-dns.com" && target.pathname === "/dns-query") {
          interceptedDns.push(target.pathname);
          await browser.cdp.send("Fetch.fulfillRequest", { requestId: event.requestId,
            responseCode: 200, responseHeaders: [
              { name: "Content-Type", value: "application/dns-json" },
              { name: "Access-Control-Allow-Origin", value: origin }
            ], body: Buffer.from(JSON.stringify({ Status: 3, Answer: [] })).toString("base64") });
        } else {
          escapedRequests.push({ origin: target.origin, path: target.pathname });
          await browser.cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
        }
      })().catch(error => interceptionFailures.push(error.message));
    });
    await browser.cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await browser.cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__cspViolations=[];addEventListener('securitypolicyviolation',event=>window.__cspViolations.push({directive:event.effectiveDirective,blocked:event.blockedURI}));`
    });
    let loaded = 0;
    let redirects = 0;
    for (const file of files) {
      const html = await readFile(path.join(artifact, file), "utf8");
      // Legacy aliases are pure meta redirects to the real site. Their complete
      // bytes/resources are covered by the static contract; never follow them
      // onto the public service from this local fixture.
      if (/<meta\b[^>]*http-equiv=["']refresh["']/iu.test(html)) {
        assert.doesNotMatch(html, /<script\b/iu); redirects += 1; continue;
      }
      await browser.navigate(`${origin}/${file}`);
      assert.deepEqual(await browser.evaluate("window.__cspViolations"), [], file);
      const observed = await browser.evaluate(`({title:document.title,
        styles:[...document.styleSheets].map(sheet=>Boolean(sheet.cssRules)),
        handlers:[...document.querySelectorAll('*')].flatMap(node=>[...node.attributes].filter(a=>/^on/i.test(a.name)).map(a=>a.name))})`);
      assert.ok(observed.title, file);
      assert.ok(observed.styles.length > 0 && observed.styles.every(Boolean), `${file}: styles loaded`);
      assert.deepEqual(observed.handlers, [], file);
      loaded += 1;
    }
    assert.equal(loaded + redirects, files.length);
    t.diagnostic(`${loaded} non-redirect documents loaded; ${redirects} inert legacy aliases statically checked; ${files.length} total HTML files`);

    await browser.navigate(`${origin}/abracadabra/app/`);
    await browser.evaluate(`document.querySelector('[data-load-sample]').click();
      document.querySelector('[data-next="truth"]').click();
      document.querySelector('#truth-confirmed').checked=true;
      document.querySelector('#truth-confirmed').dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('#make-preview').click();`);
    await browser.waitFor("document.querySelector('#spark-preview').src.startsWith('blob:')");
    assert.equal(await browser.evaluate("document.querySelector('#spark-preview').getAttribute('sandbox')"), "");
    const frameTree = await browser.cdp.send("Page.getFrameTree");
    const previewFrame = frameTree.frameTree.childFrames?.find(frame => frame.frame.url.startsWith("blob:"));
    assert.ok(previewFrame, "maker blob frame loaded");
    const context = await browser.cdp.send("Page.createIsolatedWorld", { frameId: previewFrame.frame.id, worldName: "csp-preview-read" });
    const preview = await browser.cdp.send("Runtime.evaluate", { contextId: context.executionContextId,
      expression: `({text:document.body.textContent.includes('Juniper'),background:getComputedStyle(document.body).backgroundColor,scripts:document.scripts.length})`, returnByValue: true });
    assert.equal(preview.result.value.text, true);
    assert.notEqual(preview.result.value.background, "rgba(0, 0, 0, 0)", "inherited CSP permits generated inline CSS");
    assert.equal(preview.result.value.scripts, 0);
    assert.deepEqual(await browser.evaluate("window.__cspViolations"), []);
    assert.match(await browser.evaluate("getComputedStyle(document.querySelector('.spark-swatch')).getPropertyValue('--sw')"), /^#[0-9a-f]{6}$/u);

    const sameOrigin = await browser.evaluate(`fetch('/api/v1/me').then(response=>response.json()).then(body=>body.user===null)`, true);
    assert.equal(sameOrigin, true);
    const dns = await browser.evaluate(`fetch('https://cloudflare-dns.com/dns-query?name=fixture.invalid&type=NS').then(response=>response.json()).then(body=>body.Status)`, true);
    assert.equal(dns, 3);
    assert.equal(interceptedDns.length, 1);
    const image = await browser.evaluate(`new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth);image.onerror=()=>resolve(0);image.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';document.body.append(image)})`, true);
    assert.equal(image, 1);
    assert.equal(browser.browserErrors.some(message => /content security policy|content-security-policy|violates.*directive/iu.test(message)), false,
      "no CSP violation before deliberate negative controls");

    await browser.navigate(`${origin}/__csp-negative`);
    await browser.waitFor("window.probe?.ready && window.probe.connectBlocked");
    const blocked = await browser.evaluate(`({inlineRan:!!window.inlineRan,handlerRan:!!window.handlerRan,evalRan:!!window.evalRan,
      evalBlocked:probe.evalBlocked,directives:window.__cspViolations.map(event=>event.directive),base:document.baseURI})`);
    assert.equal(blocked.inlineRan, false);
    assert.equal(blocked.handlerRan, false);
    assert.equal(blocked.evalRan, false);
    assert.equal(blocked.evalBlocked, true);
    assert.ok(blocked.base.startsWith(origin));
    for (const directive of ["script-src-elem", "script-src-attr", "script-src", "connect-src", "frame-src", "object-src", "base-uri", "form-action"]) {
      assert.ok(blocked.directives.includes(directive), `negative control: ${directive}`);
    }
    assert.deepEqual(escapedRequests, [], "CSP denied unwanted traffic before interception; no external requests sent");
    assert.deepEqual(interceptionFailures, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    await rm(temporary, { recursive: true, force: true });
  }
});
