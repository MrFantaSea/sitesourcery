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
  binding: "b0000000-0000-4000-8000-000000000001",
  snapshot: "c0000000-0000-4000-8000-000000000001",
  crosswalk: "d0000000-0000-4000-8000-000000000001",
  observation: "e0000000-0000-4000-8000-000000000001",
  resolution: "f0000000-0000-4000-8000-000000000001"
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

function adjacentContracts() {
  const keys = [
    "private_messenger", "command_deck", "phone_bridge",
    "client_profile_hub", "marketing_desk", "dell_commercial_engine"
  ];
  return {
    schema: "sitesourcery.adjacent-contracts/v1",
    systems: keys.map((systemKey) => ({
      systemKey,
      authorityOwner: `${systemKey}_authority`,
      readEventDirection: "adjacent_to_hosted_manual_evidence",
      writeEffectDirection: "none_held",
      authenticationBoundary: `${systemKey}_private_authentication`,
      identityScopePolicy: "tenant_crosswalk_and_global_snapshot",
      semanticIdempotencyPolicy:
        "same_semantic_evidence_replays_prior_receipt_new_digest_conflicts",
      conflictOwner: systemKey,
      retryPolicy: "no_automatic_retry_operator_refresh_required",
      reconciliationPolicy: "append_only_operator_resolution_or_supersession",
      auditPolicy: "append_only_operator_source_and_provenance_digests",
      failureBehavior: "fail_closed_to_manual_review",
      heldBehavior: "automatic_commands_remote_writes_and_provider_effects_false",
      adapterMode: "manual_read_only",
      automaticCommands: false,
      remoteWrites: false,
      providerEffects: false,
      contractRevision: 1
    })),
    mode: "manual-read-only",
    remoteWrites: false,
    providerEffects: false,
    automaticCommands: false
  };
}

function adjacentTrace(resolved) {
  return {
    schema: "sitesourcery.adjacent-trace/v1",
    organizationId: IDS.organization,
    projectId: null,
    systemKey: null,
    crosswalks: [{
      id: IDS.crosswalk,
      organizationId: IDS.organization,
      projectId: IDS.project,
      systemKey: "client_profile_hub",
      sourceSnapshotId: IDS.snapshot,
      localEntityKind: "project",
      localEntityId: IDS.project,
      remoteEntityKind: "project",
      safeRemoteReference: "SS-2026-001",
      remoteReferenceDigest: "2".repeat(64),
      sourceRevisionDigest: "3".repeat(64),
      provenanceDigest: "4".repeat(64),
      state: resolved ? "linked" : "manual_review",
      supersedesCrosswalkId: null,
      revision: resolved ? 2 : 1,
      requestDigest: "5".repeat(64),
      recordedAt: NOW,
      updatedAt: NOW
    }],
    observations: [{
      id: IDS.observation,
      crosswalkId: IDS.crosswalk,
      sourceSnapshotId: IDS.snapshot,
      organizationId: IDS.organization,
      projectId: IDS.project,
      systemKey: "client_profile_hub",
      observationKind: "identity_readback",
      observationState: "matched",
      payloadDigest: "6".repeat(64),
      provenanceDigest: "7".repeat(64),
      sourceObservedAt: NOW,
      recordedAt: NOW
    }],
    sourceSnapshots: [{
      id: IDS.snapshot,
      systemKey: "client_profile_hub",
      remoteEntityKind: "service",
      remoteReferenceDigest: "8".repeat(64),
      observationKind: "availability",
      observationState: "available",
      payloadDigest: "9".repeat(64),
      provenanceDigest: "a".repeat(64),
      sourceObservedAt: NOW,
      recordedAt: NOW
    }],
    remoteWrites: false,
    providerEffects: false,
    automaticCommands: false
  };
}

function adjacentQueue(resolved) {
  return {
    schema: "sitesourcery.operator-work-queue/v1",
    sourceAuthoritative: true,
    genericRepair: false,
    items: resolved ? [] : [{
      schema: "sitesourcery.operator-work-queue-item/v1",
      id: IDS.crosswalk,
      source: {
        table: "ss.adjacent_integration_crosswalks",
        id: IDS.crosswalk,
        revision: 1,
        digest: "5".repeat(64),
        state: "manual_review"
      },
      organizationId: IDS.organization,
      projectId: IDS.project,
      kind: "adjacent_identity_review",
      severity: "normal",
      status: "open",
      deadlineAt: null,
      repair: { kind: "adjacent_crosswalk_resolution" },
      openedAt: NOW,
      revision: 1,
      digest: "b".repeat(64),
      updatedAt: NOW
    }]
  };
}

async function requestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
  let resolved = false;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const recorded = { method: request.method, pathname: url.pathname };
    requests.push(recorded);
    if (url.pathname.startsWith("/api/v1/")) {
      if (
        request.method === "POST" && url.pathname ===
          "/api/v1/operator/adjacent-integrations/resolutions"
      ) {
        recorded.body = await requestJson(request);
        recorded.csrf = request.headers["x-csrf-token"] || null;
        recorded.idempotency = request.headers["idempotency-key"] || null;
        resolved = true;
        json(response, {
          schema: "sitesourcery.adjacent-resolution-receipt/v1",
          id: IDS.resolution,
          commandId: recorded.idempotency,
          requestDigest: "c".repeat(64),
          semanticEvidenceDigest: "d".repeat(64),
          systemKey: "client_profile_hub",
          organizationId: IDS.organization,
          projectId: null,
          state: "linked",
          revision: null,
          recordedAt: NOW,
          replay: false,
          remoteWrites: false,
          providerEffects: false,
          automaticCommands: false,
          crosswalkState: "linked",
          crosswalkRevision: 2,
          crosswalkUpdatedAt: NOW
        });
        return;
      }
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
        json(response, adjacentQueue(resolved));
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
      if (url.pathname === `${base}/adjacent-integrations/contracts`) {
        json(response, adjacentContracts());
        return;
      }
      if (url.pathname === `${base}/adjacent-integrations/trace`) {
        json(response, adjacentTrace(resolved));
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
        const result = await browser.evaluate(`(async () => {
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
          button("Review identity crosswalk").click();
          await new Promise((resolve, reject) => {
            const started = Date.now();
            const check = () => {
              if (
                document.querySelector("#operator-board")
                  .getAttribute("aria-busy") === "false" &&
                !document.querySelector("#operator-adjacent-detail").hidden
              ) return resolve();
              if (Date.now() - started > 5000) {
                return reject(new Error("adjacent detail did not open"));
              }
              setTimeout(check, 20);
            };
            check();
          });
          const resolutionForm = document.querySelector(
            "#operator-adjacent-resolution-form"
          );
          const resolutionControls = [...resolutionForm.querySelectorAll(
            "input, select"
          )].map((entry) => entry.name);
          resolutionForm.elements.evidenceDigest.value = "e".repeat(64);
          resolutionForm.requestSubmit();
          await new Promise((resolve, reject) => {
            const started = Date.now();
            const check = () => {
              if (
                document.querySelector("#operator-board")
                  .getAttribute("aria-busy") === "false" &&
                !button("Review identity crosswalk")
              ) return resolve();
              if (Date.now() - started > 5000) {
                return reject(new Error(
                  "adjacent resolution did not settle · busy=" +
                  document.querySelector("#operator-board")
                    .getAttribute("aria-busy") + " · error=" +
                  document.querySelector("#operator-error").textContent +
                  " · notice=" +
                  document.querySelector("#operator-notice").textContent
                ));
              }
              setTimeout(check, 20);
            };
            check();
          });
          button("Record reviewed crosswalk").click();
          const crosswalkControls = [...document.querySelectorAll(
            "#operator-adjacent-crosswalk-form input, #operator-adjacent-crosswalk-form select"
          )].map((entry) => entry.name);
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
            adjacentContracts: document.querySelectorAll(
              "#operator-adjacent-contracts .operator-card"
            ).length,
            adjacentTrace: document.querySelectorAll(
              "#operator-adjacent-trace .operator-card"
            ).length,
            careForm,
            consentForm,
            bindingControls,
            resolutionControls,
            crosswalkControls,
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
            ),
            adjacentHeldCopy: document.body.textContent.includes(
              "No remote or provider effect was executed"
            ) && document.body.textContent.includes(
              "This does not update the adjacent source"
            )
          };
        })()`, true);
        assert.equal(result.width, viewport.width);
        assert.equal(result.height, viewport.height);
        assert.equal(result.overflow, 0);
        assert.equal(result.wide, 0);
        assert.equal(result.care, 1);
        assert.equal(result.responder, 1);
        assert.equal(result.bindings, 1);
        assert.equal(result.adjacentContracts, 6);
        assert.equal(result.adjacentTrace, 3);
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
        assert.deepEqual(result.resolutionControls, [
          "resolutionKind", "evidenceDigest"
        ]);
        assert.deepEqual(result.crosswalkControls, [
          "identityPair", "sourceSnapshotId", "localEntityId", "projectId",
          "remoteReference", "sourceRevision", "sourceEvidenceDigest",
          "state", "supersedesCrosswalkId"
        ]);
        assert.equal(result.targets, true);
        assert.equal(result.rawProviderValueVisible, false);
        assert.equal(result.heldCopy, true);
        assert.equal(result.adjacentHeldCopy, true);
        assert.deepEqual(
          browser.browserErrors,
          [],
          `unexpected browser errors for ${JSON.stringify(site.requests)}`
        );
        const writes = site.requests.filter((entry) => entry.method !== "GET");
        assert.equal(writes.length, 1);
        assert.equal(
          writes[0].pathname,
          "/api/v1/operator/adjacent-integrations/resolutions"
        );
        assert.equal(writes[0].csrf, "fin004u-browser-csrf-token");
        assert.match(writes[0].idempotency, /^[0-9a-f-]{36}$/u);
        assert.deepEqual(writes[0].body, {
          crosswalkId: IDS.crosswalk,
          expectedCrosswalkRequestDigest: "5".repeat(64),
          expectedCrosswalkRevision: 1,
          operatorOrganizationId: IDS.organization,
          priorState: "manual_review",
          resolutionEvidenceDigest: "e".repeat(64),
          resolutionKind: "operator_confirm_link",
          resultingState: "linked",
          systemKey: "client_profile_hub"
        });
      } finally {
        await browser?.close();
        await site.close();
      }
    }
  );
}
