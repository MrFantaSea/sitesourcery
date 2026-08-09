import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const controls = require(
  "../../abracadabra/app/abracadabra-alakazam-35.js"
);

const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const PHOTO_ID = "60000000-0000-4000-8000-000000000001";

function snapshot(overrides = {}) {
  const assetDigest = "a".repeat(64);
  return {
    schema: "sitesourcery.alakazam-35-snapshot/v1",
    state: "held",
    providerEffects: false,
    holdReason: "commercial_cutover_not_authorized",
    projectId: PROJECT_ID,
    subscription: {
      subscriptionId: "40000000-0000-4000-8000-000000000001",
      tierId: "alakazam_35",
      status: "active",
      revision: 3
    },
    controls: {
      photoHeader: {
        enabled: true,
        mediaTypes: ["image/jpeg", "image/png"],
        maxBytes: 2000000,
        photo: {
          assetId: PHOTO_ID,
          assetDigest,
          assetPath: `assets/alakazam-header-${assetDigest}.png`,
          mediaType: "image/png",
          byteCount: 1200,
          width: 1280,
          height: 640,
          uploadedAt: "2026-08-08T12:00:00.000Z"
        }
      },
      fonts: [
        { fontChoiceId: "standard", label: "Standard" },
        { fontChoiceId: "alt", label: "Alternate" }
      ],
      sections: ["about", "offerings", "practical", "contact"],
      versionHistoryLimit: 3,
      careClass: "modest"
    },
    configuration: null,
    history: [3, 2, 1].map((versionNumber) => ({
      versionId: `${versionNumber}0000000-0000-4000-8000-000000000001`,
      versionNumber,
      artifactDigest: String(versionNumber).repeat(64),
      acceptedAt: `2026-08-0${versionNumber}T12:00:00.000Z`,
      isCurrent: versionNumber === 3
    })),
    care: { state: "held", requestCount: 0, lastRequestedAt: null },
    ...overrides
  };
}

test("browser verifier accepts exact held $35 controls and three-version history", () => {
  const selected = controls.verifiedSnapshot(snapshot(), PROJECT_ID);
  assert.ok(selected);
  assert.equal(selected.controls.photo.assetId, PHOTO_ID);
  assert.equal(selected.controls.fonts.length, 2);
  assert.equal(selected.history.length, 3);
  assert.equal(selected.care.requestCount, 0);
});

test("browser verifier rejects released provider effects, rogue fonts, and four visible versions", () => {
  assert.equal(controls.verifiedSnapshot(snapshot({ providerEffects: true }), PROJECT_ID), false);
  const rogueFonts = snapshot();
  rogueFonts.controls.fonts[1].fontChoiceId = "rogue";
  assert.equal(controls.verifiedSnapshot(rogueFonts, PROJECT_ID), false);
  const tooMuchHistory = snapshot();
  tooMuchHistory.history.push({ ...tooMuchHistory.history[0] });
  assert.equal(controls.verifiedSnapshot(tooMuchHistory, PROJECT_ID), false);
});

test("dedicated API client uses exact routes, CSRF, and idempotency without provider endpoints", async () => {
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
    fontChoiceId: "alt",
    photoAssetId: PHOTO_ID,
    sections: {
      about: true,
      offerings: true,
      practical: false,
      contact: true
    }
  });
  assert.deepEqual(calls.map((call) => [call.options.method, call.url]), [
    ["GET", `/api/v1/projects/${PROJECT_ID}/alakazam/35`],
    ["GET", "/api/v1/csrf"],
    ["POST", `/api/v1/projects/${PROJECT_ID}/alakazam/35/configurations`]
  ]);
  assert.equal(
    calls[2].options.headers["Idempotency-Key"],
    "50000000-0000-4000-8000-000000000001"
  );
  assert.equal(calls[2].options.headers["X-CSRF-Token"], "csrf-token");
  assert.doesNotMatch(calls[2].url, /stripe|publish|provider/u);
});
