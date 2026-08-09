import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const controls = require(
  "../../abracadabra/app/abracadabra-alakazam-50.js"
);

const PROJECT_ID = "30000000-0000-4000-8000-000000000001";

test("default $50 client binds to the ambient browser runtime", () => {
  assert.doesNotThrow(() => controls.createClient());
});

function snapshot(overrides = {}) {
  return {
    schema: "sitesourcery.alakazam-50-snapshot/v1",
    state: "held",
    providerEffects: false,
    holdReason: "commercial_cutover_not_authorized",
    projectId: PROJECT_ID,
    subscription: {
      subscriptionId: "40000000-0000-4000-8000-000000000001",
      tierId: "alakazam_50",
      status: "active",
      revision: 7
    },
    controls: {
      cashApp: true,
      venmo: true,
      menuTargets: ["about", "offerings", "practical", "contact"],
      fonts: [
        { fontChoiceId: "inherit", label: "Use $35 font" },
        { fontChoiceId: "editorial", label: "Editorial" },
        { fontChoiceId: "studio", label: "Studio" }
      ],
      borders: [
        { borderChoiceId: "soft", label: "Soft" },
        { borderChoiceId: "sharp", label: "Sharp" },
        { borderChoiceId: "ornate", label: "Ornate" }
      ],
      careClass: "more"
    },
    configuration: null,
    care: { state: "held", requestCount: 0, lastRequestedAt: null },
    ...overrides
  };
}

test("browser verifier accepts exact held $50 controls", () => {
  const selected = controls.verifiedSnapshot(snapshot(), PROJECT_ID);
  assert.ok(selected);
  assert.equal(selected.controls.fonts.length, 3);
  assert.equal(selected.controls.borders.length, 3);
});

test("browser verifier rejects provider effects, lower tiers, and rogue controls", () => {
  assert.equal(controls.verifiedSnapshot(snapshot({ providerEffects: true }), PROJECT_ID), false);
  const lower = snapshot();
  lower.subscription.tierId = "alakazam_35";
  assert.equal(controls.verifiedSnapshot(lower, PROJECT_ID), false);
  const rogue = snapshot();
  rogue.controls.fonts[2].fontChoiceId = "browser-claimed";
  assert.equal(controls.verifiedSnapshot(rogue, PROJECT_ID), false);
});

test("dedicated API client uses exact held routes, CSRF, and idempotency only", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return url.endsWith("/csrf")
          ? { csrfToken: "csrf-token" }
          : snapshot();
      }
    };
  };
  const client = controls.createClient({ fetchImpl });
  await client.getSnapshot(PROJECT_ID);
  await client.saveConfiguration(PROJECT_ID, {
    commandId: "50000000-0000-4000-8000-000000000001",
    expectedCurrentRevision: 0,
    cashAppHandle: "cedar",
    venmoHandle: null,
    fontChoiceId: "studio",
    borderChoiceId: "sharp",
    menu: [{ target: "contact", label: "Pay" }]
  });
  assert.deepEqual(calls.map((call) => [call.options.method, call.url]), [
    ["GET", `/api/v1/projects/${PROJECT_ID}/alakazam/50`],
    ["GET", "/api/v1/csrf"],
    ["POST", `/api/v1/projects/${PROJECT_ID}/alakazam/50/configurations`]
  ]);
  assert.equal(calls[2].options.headers["Idempotency-Key"],
    "50000000-0000-4000-8000-000000000001");
  assert.doesNotMatch(calls[2].url, /stripe|publish|provider/u);
});

test("browser audit measures four checkbox labels as effective 44px targets", async () => {
  const source = await readFile(
    new URL("../browser-audit-alakazam-50.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /input\.closest\("label\.alakazam-50-check"\)/u
  );
  assert.match(
    source,
    /checkboxLabels\.length===4&&checkboxLabels\.every\(Boolean\)&&effectiveTargets\.every/u
  );
  assert.match(
    source,
    /button,input:not\(\[type="checkbox"\]\),select,textarea/u
  );
  assert.doesNotMatch(
    source,
    /const targets=Array\.from\(document\.querySelectorAll\("button,input,select,textarea"\)\)/u
  );
});

test("hosted customer composition mounts F03 before exact F04 under the unchanged hold", async () => {
  const source = await readFile(
    new URL(
      "../../abracadabra/app/abracadabra-customer-control-dom.js",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(
    source,
    /var ALAKAZAM_PUBLIC_OFFER_STATE = "held";/u
  );
  assert.match(
    source,
    /syncAlakazam35Panel\(lastState\);\s*syncAlakazam50Panel\(lastState\);/u
  );
  assert.match(
    source,
    /function syncAlakazam50Panel\(state\)[\s\S]*?var module = windowRef\.SiteSourceryAlakazam50;[\s\S]*?ALAKAZAM_PUBLIC_OFFER_STATE !== "released"[\s\S]*?subscription\.status !== "active"[\s\S]*?tierId !== "alakazam_50"[\s\S]*?alakazam50Panel = windowRef\.SiteSourceryAlakazam50\.mount/u
  );
  assert.doesNotMatch(
    source.match(/function syncAlakazam50Panel\(state\)[\s\S]*?\n    \}\n/u)?.[0] ?? "",
    /stripe|publicationPort|providerEffect/u
  );
});
