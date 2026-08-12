import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { openReviewedBrowser } from
  "../../server/hosted/test/reviewed-browser-support.mjs";

const IDS = Object.freeze({
  organization: "20000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
  customer: "40000000-0000-4000-8000-000000000001",
  contract: "50000000-0000-4000-8000-000000000001",
  period: "60000000-0000-4000-8000-000000000001",
  ticket: "70000000-0000-4000-8000-000000000001"
});
const VIEWPORTS = Object.freeze([
  { width: 320, height: 720, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 1440, height: 1000, mobile: false }
]);

function snapshot(audience) {
  const contract = {
    id: IDS.contract,
    projectId: IDS.project,
    contractKind: "custom_care",
    catalog: {
      serviceKey: "custom_care",
      catalogVersion: "SS-CARE-CORE-2026.1",
      billingCadence: "month",
      capacityUnitKind: "care_request",
      commercialAuthorityState: "owner_redline_required"
    },
    authorityState: "held",
    effects: { customer: false, payment: false, provider: false },
    periods: [{
      id: IDS.period,
      projectId: IDS.project,
      startsOn: "2026-08-11",
      endsOn: "2026-09-11",
      state: "open",
      revision: 1,
      authorityState: "held",
      capacity: {
        carried: 1,
        included: 4,
        usedCarried: 1,
        usedIncluded: 1,
        remaining: 3
      },
      providerEffects: false
    }],
    tickets: [{
      id: IDS.ticket,
      projectId: IDS.project,
      periodId: IDS.period,
      basis: {
        kind: "assessment_finding",
        referenceDigest: "a".repeat(64)
      },
      workScopeDigest: "b".repeat(64),
      state: "in_progress",
      revision: 2,
      allocatedUnits: 2,
      effects: { mail: false, provider: false },
      openedAt: "2026-08-11T16:00:00.000Z",
      resolvedAt: null,
      closedAt: null
    }]
  };
  if (audience === "operator") contract.customerId = IDS.customer;
  return {
    schema: "sitesourcery.care-surface-dashboard/v1",
    audience,
    organizationId: IDS.organization,
    observedAt: "2026-08-11T16:00:00.000Z",
    held: {
      commercialRelease: true,
      customerEffects: true,
      mailDelivery: true,
      paymentEffects: true,
      providerEffects: true
    },
    contracts: [contract]
  };
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Held Care surfaces</title>
<link rel="stylesheet" href="/care.css">
<style>*{box-sizing:border-box}:root{--spark-text:#f8f4ff;--spark-muted:#c8bed4;--spark-mint:#82e7c4;--spark-gold:#f1cf89}body{margin:0;background:#100b19;font:16px/1.5 system-ui,sans-serif}.shell{display:grid;gap:1rem;width:min(calc(100% - 1rem),72rem);margin:1rem auto}</style>
<script src="/care.js"></script></head><body><main class="shell"><div id="customer"></div><div id="operator"></div></main><pre id="result" hidden></pre>
<script>
const customer=${JSON.stringify(snapshot("customer"))};
const operator=${JSON.stringify(snapshot("operator"))};
const actions=[];
SiteSourceryCareSurfaces.mount({audience:"customer",container:document.querySelector("#customer"),snapshot:customer});
SiteSourceryCareSurfaces.mount({audience:"operator",container:document.querySelector("#operator"),snapshot:operator,onCommand:(value)=>actions.push(value)});
document.querySelector('[data-care-surface="operator"] button').click();
const buttons=[...document.querySelectorAll("button")];
const result={
  width:innerWidth,
  height:innerHeight,
  overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
  wide:[...document.querySelectorAll("*")].filter((node)=>node.getBoundingClientRect().right>document.documentElement.clientWidth+1).length,
  panels:document.querySelectorAll("[data-care-surface]").length,
  headings:document.querySelectorAll("[data-care-surface] h2").length,
  status:document.querySelectorAll('[role="status"]').length,
  targets:buttons.every((button)=>button.getBoundingClientRect().height>=44),
  customerHeld:document.querySelector('[data-care-surface="customer"] button').disabled,
  heldCopy:document.body.textContent.includes("payment, mail delivery, customer release, and provider work remain held"),
  actionCount:actions.length,
  errors:[]
};
document.querySelector("#result").textContent=JSON.stringify(result);
document.documentElement.dataset.ready="true";
</script></body></html>`;

async function fixtureServer() {
  const [module, css] = await Promise.all([
    readFile(new URL(
      "../../abracadabra/app/abracadabra-care-surfaces.js",
      import.meta.url
    )),
    readFile(new URL(
      "../../abracadabra/app/abracadabra-care-surfaces.css",
      import.meta.url
    ))
  ]);
  const server = createServer((request, response) => {
    if (request.url === "/care.js") {
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8"
      });
      response.end(module);
      return;
    }
    if (request.url === "/care.css") {
      response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      response.end(css);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PAGE);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}

for (const viewport of VIEWPORTS) {
  test(
    `held Care surfaces are usable at ${viewport.width}x${viewport.height}`,
    async () => {
      const site = await fixtureServer();
      let browser;
      try {
        browser = await openReviewedBrowser({ origin: site.origin, viewport });
        await browser.navigate(`${site.origin}/`);
        await browser.waitFor(
          'document.documentElement.dataset.ready === "true"'
        );
        const result = await browser.evaluate(
          'JSON.parse(document.querySelector("#result").textContent)'
        );
        assert.deepEqual(result, {
          width: viewport.width,
          height: viewport.height,
          overflow: 0,
          wide: 0,
          panels: 2,
          headings: 2,
          status: 2,
          targets: true,
          customerHeld: true,
          heldCopy: true,
          actionCount: 1,
          errors: []
        });
        assert.deepEqual(browser.browserErrors, []);
      } finally {
        await browser?.close();
        await site.close();
      }
    }
  );
}
