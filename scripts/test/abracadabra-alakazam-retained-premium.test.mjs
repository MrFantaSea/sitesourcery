import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const controls = require(
  "../../abracadabra/app/abracadabra-alakazam-retained-premium.js"
);
const PROJECT_ID = "30000000-0000-4000-8000-000000000006";

test("default retained-premium client binds to the ambient browser runtime", () => {
  assert.doesNotThrow(() => controls.createClient());
});

function snapshot(overrides = {}) {
  return {
    schema: "sitesourcery.alakazam-retained-premium-snapshot/v1",
    policyId: "SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1",
    state: "held",
    providerEffects: false,
    holdReason: "commercial_cutover_not_authorized",
    projectId: PROJECT_ID,
    lifecycle: {
      state: "active",
      retentionEndsAt: null,
      privateRead: true,
      customerExport: true,
      edit: true,
      publish: true,
      care: true
    },
    subscription: {
      tierId: "alakazam_35",
      status: "active",
      revision: 8,
      cancelAtPeriodEnd: false
    },
    premium: {
      configured: true,
      configurationRevision: 1,
      configurationDigest: "a".repeat(64),
      effectiveOutput: "masked",
      values: null
    },
    restoration: {
      required: false,
      available: false,
      sourceConfigurationRevision: null,
      sourceConfigurationDigest: null
    },
    actions: {
      edit: false,
      restore: false,
      export: true,
      publish: true,
      care: true
    },
    ...overrides
  };
}

test("browser verifier accepts masked lower-tier retained premium", () => {
  const selected = controls.verifiedSnapshot(snapshot(), PROJECT_ID);
  assert.ok(selected);
  assert.equal(selected.premium.values, null);
  assert.equal(selected.premium.effectiveOutput, "masked");
  assert.equal(selected.actions.edit, false);
});

test("browser verifier accepts read-only retained exit and exact restoration", () => {
  const values = {
    configurationRevision: 1,
    configurationDigest: "a".repeat(64),
    cashAppHandle: "cedar.shop",
    venmoHandle: "cedar_shop",
    fontChoiceId: "studio",
    borderChoiceId: "sharp",
    menu: [{ target: "contact", label: "Pay Cedar" }],
    configuredAt: "2026-08-09T12:00:00.000Z"
  };
  const retained = snapshot({
    lifecycle: {
      state: "retained_exit",
      retentionEndsAt: "2026-09-09T12:00:00.000Z",
      privateRead: true,
      customerExport: true,
      edit: false,
      publish: false,
      care: false
    },
    subscription: {
      tierId: "alakazam_50",
      status: "suspended",
      revision: 11,
      cancelAtPeriodEnd: false
    },
    premium: {
      configured: true,
      configurationRevision: 1,
      configurationDigest: "a".repeat(64),
      effectiveOutput: "masked",
      values
    },
    actions: {
      edit: false,
      restore: false,
      export: true,
      publish: false,
      care: false
    }
  });
  assert.ok(controls.verifiedSnapshot(retained, PROJECT_ID));
  const restore = snapshot({
    subscription: {
      tierId: "alakazam_50",
      status: "active",
      revision: 9,
      cancelAtPeriodEnd: false
    },
    premium: {
      configured: true,
      configurationRevision: 1,
      configurationDigest: "a".repeat(64),
      effectiveOutput: "masked",
      values
    },
    restoration: {
      required: true,
      available: true,
      sourceConfigurationRevision: 1,
      sourceConfigurationDigest: "a".repeat(64)
    },
    actions: {
      edit: false,
      restore: true,
      export: true,
      publish: true,
      care: true
    }
  });
  assert.equal(
    controls.verifiedSnapshot(restore, PROJECT_ID).restoration.available,
    true
  );
});

test("browser verifier rejects lower-tier value leaks and grace writes", () => {
  const leaked = snapshot();
  leaked.premium.values = {
    configurationRevision: 1,
    configurationDigest: "a".repeat(64),
    cashAppHandle: "leaked",
    venmoHandle: null,
    fontChoiceId: "studio",
    borderChoiceId: "sharp",
    menu: [{ target: "contact", label: "Contact" }],
    configuredAt: "2026-08-09T12:00:00.000Z"
  };
  assert.equal(controls.verifiedSnapshot(leaked, PROJECT_ID), false);
  const grace = snapshot({
    lifecycle: {
      state: "payment_grace",
      retentionEndsAt: "2026-08-16T12:00:00.000Z",
      privateRead: true,
      customerExport: true,
      edit: false,
      publish: false,
      care: false
    },
    actions: {
      edit: true,
      restore: false,
      export: true,
      publish: false,
      care: false
    }
  });
  assert.equal(controls.verifiedSnapshot(grace, PROJECT_ID), false);
});

test("dedicated client uses only held read, export, and restoration routes", async () => {
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
  await client.getExport(PROJECT_ID);
  await client.restoreConfiguration(PROJECT_ID, {
    commandId: "50000000-0000-4000-8000-000000000006",
    expectedSourceConfigurationDigest: "a".repeat(64),
    expectedSubscriptionRevision: 9
  });
  assert.deepEqual(calls.map((call) => [call.options.method, call.url]), [
    ["GET", `/api/v1/projects/${PROJECT_ID}/alakazam/premium`],
    ["GET", `/api/v1/projects/${PROJECT_ID}/alakazam/premium/export`],
    ["GET", "/api/v1/csrf"],
    ["POST", `/api/v1/projects/${PROJECT_ID}/alakazam/premium/restorations`]
  ]);
  assert.equal(
    calls[3].options.headers["Idempotency-Key"],
    "50000000-0000-4000-8000-000000000006"
  );
  assert.doesNotMatch(
    calls.map((call) => call.url).join(" "),
    /stripe|publish|care/u
  );
});

test("browser audit keeps exact widths, overflow, and 44px controls", async () => {
  const source = await readFile(
    new URL("../browser-audit-alakazam-retained-premium.mjs", import.meta.url),
    "utf8"
  );
  for (const viewport of ["320, height: 720", "390, height: 844", "1440, height: 1000"]) {
    assert.match(source, new RegExp(viewport.replace(" ", "\\s*"), "u"));
  }
  assert.match(source, /scrollWidth<=innerWidth/u);
  assert.match(source, /getBoundingClientRect\(\)\.height>=44/u);
  assert.match(
    source,
    /result\.masked===1&&result\.readOnly===1&&result\.restored===1/u
  );
});
