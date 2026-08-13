import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";

import { openReviewedBrowser } from
  "../../server/hosted/test/reviewed-browser-support.mjs";

const IDS = Object.freeze({
  user: "10000000-0000-4000-8000-000000000001",
  organization: "20000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
  customer: "40000000-0000-4000-8000-000000000001",
  contract: "50000000-0000-4000-8000-000000000001",
  period: "60000000-0000-4000-8000-000000000001",
  ticket: "70000000-0000-4000-8000-000000000001",
  contact: "80000000-0000-4000-8000-000000000001",
  interaction: "90000000-0000-4000-8000-000000000001",
  event: "a0000000-0000-4000-8000-000000000001",
  binding: "b0000000-0000-4000-8000-000000000001"
});
const NOW = "2026-08-13T18:00:00.000Z";
const VIEWPORTS = Object.freeze([
  { width: 320, height: 720, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 1440, height: 1000, mobile: false }
]);

function careSnapshot() {
  return {
    schema: "sitesourcery.care-surface-dashboard/v1",
    audience: "operator",
    organizationId: IDS.organization,
    observedAt: NOW,
    held: {
      commercialRelease: true,
      customerEffects: true,
      mailDelivery: true,
      paymentEffects: true,
      providerEffects: true
    },
    contracts: [{
      id: IDS.contract,
      projectId: IDS.project,
      customerId: IDS.customer,
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
        startsOn: "2026-08-13",
        endsOn: "2026-09-13",
        state: "open",
        revision: 1,
        authorityState: "held",
        capacity: {
          carried: 1,
          included: 4,
          usedCarried: 0,
          usedIncluded: 1,
          remaining: 4
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
        allocatedUnits: 1,
        effects: { mail: false, provider: false },
        openedAt: NOW,
        resolvedAt: null,
        closedAt: null
      }]
    }]
  };
}

function responderSnapshot() {
  return {
    schema: "sitesourcery.responder-surface-dashboard/v1",
    audience: "operator",
    organizationId: IDS.organization,
    observedAt: NOW,
    mode: "held",
    globalKillEngaged: true,
    sellable: false,
    billingEffects: false,
    providerEffects: false,
    contacts: [{
      id: IDS.contact,
      projectId: IDS.project,
      customerUserId: IDS.customer,
      routeKind: "sms",
      routeDigest: "c".repeat(64),
      purpose: "missed_call_response",
      consentBasis: "explicit_service_request",
      state: "active",
      consentedAt: NOW,
      optedOutAt: null,
      revision: 1
    }],
    interactions: [{
      id: IDS.interaction,
      projectId: IDS.project,
      contactAuthorityId: IDS.contact,
      routeDigest: "c".repeat(64),
      sourceKind: "missed_call",
      state: "open",
      handoffReason: null,
      openedAt: NOW,
      lastEventAt: NOW,
      revision: 1,
      events: [{
        id: IDS.event,
        interactionId: IDS.interaction,
        eventKind: "missed_call",
        messageIntent: "not_applicable",
        state: "applied",
        occurredAt: NOW,
        recordedAt: NOW,
        providerEffects: false
      }],
      heldCommands: []
    }]
  };
}

function numberBindings() {
  return {
    schema: "sitesourcery.responder-number-binding-list/v1",
    organizationId: IDS.organization,
    providerEffects: false,
    bindings: [{
      schema: "sitesourcery.responder-number-binding-receipt/v1",
      id: IDS.binding,
      organizationId: IDS.organization,
      projectId: IDS.project,
      provider: "twilio",
      numberLookupDigest: "d".repeat(64),
      lookupKeyVersion: "v2",
      phoneNumberSidDigest: "e".repeat(64),
      providerReadbackDigest: "f".repeat(64),
      accountSidDigest: "1".repeat(64),
      messagingServiceSidDigest: null,
      state: "active",
      provisionedAt: NOW,
      retiredAt: null,
      retiredReason: null,
      revision: 1,
      replayed: false,
      providerEffects: false
    }]
  };
}

function json(response, value) {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(value));
}

async function fixtureServer() {
  const paths = Object.freeze({
    "/": "../../operator/index.html",
    "/operator/": "../../operator/index.html",
    "/operator/operator.css": "../../operator/operator.css",
    "/operator/operator.js": "../../operator/operator.js",
    "/vnext.css": "../../vnext.css",
    "/assets/cursor-wand.svg": "../../assets/cursor-wand.svg",
    "/assets/cursor-wand-active.svg": "../../assets/cursor-wand-active.svg",
    "/assets/site-sourcery-storm-atelier-v4.webp":
      "../../assets/site-sourcery-storm-atelier-v4.webp",
    "/abracadabra/app/abracadabra-api.js":
      "../../abracadabra/app/abracadabra-api.js",
    "/abracadabra/app/abracadabra-care-surfaces.css":
      "../../abracadabra/app/abracadabra-care-surfaces.css",
    "/abracadabra/app/abracadabra-care-surfaces.js":
      "../../abracadabra/app/abracadabra-care-surfaces.js",
    "/abracadabra/app/abracadabra-responder-surfaces.css":
      "../../abracadabra/app/abracadabra-responder-surfaces.css",
    "/abracadabra/app/abracadabra-responder-surfaces.js":
      "../../abracadabra/app/abracadabra-responder-surfaces.js"
  });
  const assets = new Map(await Promise.all(Object.entries(paths).map(
    async ([pathname, relative]) => [
      pathname,
      await readFile(new URL(relative, import.meta.url))
    ]
  )));
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    requests.push({ method: request.method, pathname: url.pathname });
    if (url.pathname.startsWith("/api/v1/")) {
      if (request.method !== "GET") {
        response.writeHead(405).end();
        return;
      }
      if (url.pathname === "/api/v1/me") {
        json(response, {
          user: {
            id: IDS.user,
            name: "FIN004U Operator",
            email: "operator@example.test"
          },
          csrfToken: "fin004u-browser-csrf-token"
        });
        return;
      }
      if (url.pathname === "/api/v1/organizations") {
        json(response, { organizations: [{
          id: IDS.organization,
          name: "FIN004U Operations",
          role: "owner",
          state: "active",
          createdAt: NOW
        }] });
        return;
      }
      if (url.pathname === "/api/v1/operator/work-queue") {
        json(response, {
          schema: "sitesourcery.operator-work-queue/v1",
          sourceAuthoritative: true,
          genericRepair: false,
          items: []
        });
        return;
      }
      if (url.pathname === "/api/v1/operator/support-cases") {
        json(response, {
          schema: "sitesourcery.support-case-operator-list/v1",
          cases: []
        });
        return;
      }
      const base = `/api/v1/operator`;
      if (url.pathname === `${base}/care/organizations/${IDS.organization}`) {
        json(response, careSnapshot());
        return;
      }
      if (
        url.pathname ===
          `${base}/responder/organizations/${IDS.organization}`
      ) {
        json(response, responderSnapshot());
        return;
      }
      if (
        url.pathname ===
          `${base}/responder/organizations/${IDS.organization}/number-bindings`
      ) {
        json(response, numberBindings());
        return;
      }
      response.writeHead(404).end();
      return;
    }
    const asset = assets.get(url.pathname);
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    const type = url.pathname.endsWith(".css")
      ? "text/css; charset=utf-8"
      : url.pathname.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : url.pathname.endsWith(".svg")
          ? "image/svg+xml"
          : url.pathname.endsWith(".webp")
            ? "image/webp"
            : "text/html; charset=utf-8";
    response.writeHead(200, { "content-type": type });
    response.end(asset);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

for (const viewport of VIEWPORTS) {
  test(
    `operator service desk is usable at ${viewport.width}x${viewport.height}`,
    async () => {
      const site = await fixtureServer();
      let browser;
      try {
        browser = await openReviewedBrowser({ origin: site.origin, viewport });
        await browser.navigate(`${site.origin}/operator/`);
        await browser.waitFor(
          'document.querySelector("#operator-board").getAttribute("aria-busy") === "false" && document.querySelectorAll("[data-care-surface=operator]").length === 1 && document.querySelectorAll("[data-responder-surface=operator]").length === 1'
        );
        const result = await browser.evaluate(`(() => {
          const button = (copy) => [...document.querySelectorAll("button")]
            .find((entry) => entry.textContent.trim() === copy);
          button("Prepare new held Care record").click();
          const careForm = [...document.querySelectorAll(
            "#operator-service-command-form input, #operator-service-command-form select"
          )].map((entry) => entry.name);
          button("Record consent evidence").click();
          const consentForm = [...document.querySelectorAll(
            "#operator-service-command-form input, #operator-service-command-form select"
          )].map((entry) => entry.name);
          button("Provision attested binding").click();
          const bindingControls = [...document.querySelectorAll(
            "#operator-service-command-form input"
          )].map((entry) => ({ name: entry.name, type: entry.type }));
          const buttons = [...document.querySelectorAll("button")]
            .filter((entry) => entry.getClientRects().length > 0);
          return {
            width: innerWidth,
            height: innerHeight,
            overflow: document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
            wide: [...document.querySelectorAll("*")].filter((entry) =>
              entry.getBoundingClientRect().right >
                document.documentElement.clientWidth + 1
            ).length,
            care: document.querySelectorAll("[data-care-surface=operator]").length,
            responder:
              document.querySelectorAll("[data-responder-surface=operator]").length,
            bindings: document.querySelectorAll(
              "#operator-number-bindings .operator-card"
            ).length,
            careForm,
            consentForm,
            bindingControls,
            targets: buttons.every((entry) =>
              entry.getBoundingClientRect().height >= 44
            ),
            rawProviderValueVisible:
              document.body.textContent.includes("+15555550100") ||
              document.body.textContent.includes("PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            heldCopy: document.body.textContent.includes(
              "No provider or billing effect was opened"
            ) || document.body.textContent.includes(
              "Provider delivery, billing, and commercial release remain held"
            )
          };
        })()`);
        assert.equal(result.width, viewport.width);
        assert.equal(result.height, viewport.height);
        assert.equal(result.overflow, 0);
        assert.equal(result.wide, 0);
        assert.equal(result.care, 1);
        assert.equal(result.responder, 1);
        assert.equal(result.bindings, 1);
        assert.equal(result.careForm.includes("careCommandKind"), true);
        assert.equal(result.consentForm.includes("consentEvidenceDigest"), true);
        assert.deepEqual(result.bindingControls, [
          { name: "projectId", type: "text" },
          { name: "phoneNumber", type: "tel" },
          { name: "phoneNumberSid", type: "password" },
          { name: "accountSid", type: "password" },
          { name: "messagingServiceSid", type: "password" },
          { name: "readbackAttestedAt", type: "datetime-local" },
          { name: "evidenceDigest", type: "text" }
        ]);
        assert.equal(result.targets, true);
        assert.equal(result.rawProviderValueVisible, false);
        assert.equal(result.heldCopy, true);
        assert.deepEqual(
          browser.browserErrors,
          [],
          `unexpected browser errors for ${JSON.stringify(site.requests)}`
        );
        assert.deepEqual(
          site.requests.filter((entry) => entry.method !== "GET"),
          []
        );
      } finally {
        await browser?.close();
        await site.close();
      }
    }
  );
}
