import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_35_HOLD_REASON,
  ALAKAZAM_35_MAX_PHOTO_BYTES,
  ALAKAZAM_35_SNAPSHOT_SCHEMA,
  applyAlakazam35EffectiveFacts,
  createAlakazam35CareRequest,
  createAlakazam35Configuration,
  createAlakazam35Service,
  createAlakazam35Snapshot,
  prepareAlakazam35PhotoUpload
} from "../alakazam-35.mjs";
import { digest } from "../canonical.mjs";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "20000000-0000-4000-8000-000000000001";
const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const SUBSCRIPTION_ID = "40000000-0000-4000-8000-000000000001";
const COMMAND_ID = "50000000-0000-4000-8000-000000000001";
const PHOTO_ID = "60000000-0000-4000-8000-000000000001";
const NOW = "2026-08-08T12:00:00.000Z";

function scope(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    customerId: CUSTOMER_ID,
    actorId: CUSTOMER_ID,
    ...overrides
  };
}

function subscription(overrides = {}) {
  return {
    subscriptionId: SUBSCRIPTION_ID,
    tierId: "alakazam_35",
    status: "active",
    revision: 3,
    ...overrides
  };
}

function sections(overrides = {}) {
  return {
    about: true,
    offerings: true,
    practical: true,
    contact: true,
    ...overrides
  };
}

function pngBase64({ width = 640, height = 320 } = {}) {
  const bytes = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 2;
  return bytes.toString("base64");
}

function photo() {
  return prepareAlakazam35PhotoUpload({
    assetId: PHOTO_ID,
    mediaType: "image/png",
    mediaBase64: pngBase64(),
    uploadedAt: NOW
  });
}

function photoMetadata(value = photo()) {
  const { mediaBytes, schema, state, holdReason, ...metadata } = value;
  assert.ok(mediaBytes);
  assert.equal(typeof schema, "string");
  assert.equal(state, "held");
  assert.equal(holdReason, ALAKAZAM_35_HOLD_REASON);
  return metadata;
}

function configuration(overrides = {}) {
  return createAlakazam35Configuration({
    scope: scope(),
    commandId: COMMAND_ID,
    subscription: subscription(),
    expectedCurrentRevision: 0,
    fontChoiceId: "alt",
    sections: sections({ practical: false }),
    photo: photoMetadata(),
    configuredAt: NOW,
    ...overrides
  });
}

function authority() {
  const policy = {
    schema: "sitesourcery.alakazam-effective-policy/v1",
    catalogVersion: "alakazam.2026-08-02.v1",
    tierId: "alakazam_35",
    capabilities: [
      "expanded_fonts",
      "photo_header",
      "section_toggles",
      "version_history"
    ],
    limits: {
      careClass: "modest",
      versionHistory: 3,
      fontControls: "expanded",
      borderControls: "base"
    }
  };
  return { policy, policyDigest: digest(policy) };
}

test("PNG photo preparation binds immutable bytes, dimensions, path, and held state", () => {
  const selected = photo();
  assert.equal(selected.byteCount, 33);
  assert.equal(selected.width, 640);
  assert.equal(selected.height, 320);
  assert.match(selected.assetDigest, /^[a-f0-9]{64}$/u);
  assert.equal(
    selected.assetPath,
    `assets/alakazam-header-${selected.assetDigest}.png`
  );
  assert.equal(selected.state, "held");
  assert.equal(selected.holdReason, ALAKAZAM_35_HOLD_REASON);
});

test("photo preparation rejects wrong signatures, unsafe dimensions, noncanonical base64, and oversized input", () => {
  for (const input of [
    {
      assetId: PHOTO_ID,
      mediaType: "image/png",
      mediaBase64: Buffer.from("not a png").toString("base64"),
      uploadedAt: NOW
    },
    {
      assetId: PHOTO_ID,
      mediaType: "image/png",
      mediaBase64: pngBase64({ width: 200, height: 100 }),
      uploadedAt: NOW
    },
    {
      assetId: PHOTO_ID,
      mediaType: "image/png",
      mediaBase64: "AAAA====",
      uploadedAt: NOW
    },
    {
      assetId: PHOTO_ID,
      mediaType: "image/png",
      mediaBase64: Buffer.alloc(ALAKAZAM_35_MAX_PHOTO_BYTES + 1).toString("base64"),
      uploadedAt: NOW
    }
  ]) {
    assert.throws(() => prepareAlakazam35PhotoUpload(input));
  }
});

test("configuration binds exact tier revision, photo, fonts, toggles, and digest", () => {
  const selected = configuration();
  assert.equal(selected.configurationRevision, 1);
  assert.equal(selected.subscriptionRevision, 3);
  assert.equal(selected.fontChoiceId, "alt");
  assert.equal(selected.sections.practical, false);
  assert.equal(selected.photo.assetId, PHOTO_ID);
  assert.match(selected.configurationDigest, /^[a-f0-9]{64}$/u);
  assert.ok(Object.isFrozen(selected));
});

test("configuration rejects $25, suspended authority, unknown fonts, and partial toggles", () => {
  for (const overrides of [
    { subscription: subscription({ tierId: "alakazam_25" }) },
    { subscription: subscription({ status: "suspended" }) },
    { fontChoiceId: "rogue-font" },
    { sections: { about: true } }
  ]) {
    assert.throws(() => configuration(overrides));
  }
});

test("modest care is an immutable held request with no SLA or provider effect", () => {
  const selected = createAlakazam35CareRequest({
    scope: scope(),
    commandId: COMMAND_ID,
    subscription: subscription(),
    message: "Please help me update the seasonal hours.",
    requestedAt: NOW
  });
  assert.equal(selected.careClass, "modest");
  assert.equal(selected.state, "held");
  assert.equal(selected.holdReason, ALAKAZAM_35_HOLD_REASON);
  assert.equal("sla" in selected, false);
  assert.equal("providerEffect" in selected, false);
});

test("snapshot exposes exactly three accepted versions without deleting older evidence", () => {
  const selected = createAlakazam35Snapshot({
    projectId: PROJECT_ID,
    subscription: subscription(),
    photo: photoMetadata(),
    configuration: configuration(),
    history: [3, 2, 1].map((versionNumber, index) => ({
      versionId: `${7 + index}0000000-0000-4000-8000-000000000001`,
      versionNumber,
      artifactDigest: String(versionNumber).repeat(64),
      acceptedAt: `2026-08-0${versionNumber}T12:00:00.000Z`,
      isCurrent: versionNumber === 3
    })),
    care: { requestCount: 2, lastRequestedAt: NOW }
  });
  assert.equal(selected.schema, ALAKAZAM_35_SNAPSHOT_SCHEMA);
  assert.equal(selected.providerEffects, false);
  assert.equal(selected.controls.versionHistoryLimit, 3);
  assert.equal(selected.history.length, 3);
  assert.equal(selected.care.requestCount, 2);
});

test("snapshot rejects more than three projected versions and multiple current versions", () => {
  const history = [1, 2, 3, 4].map((versionNumber) => ({
    versionId: `${versionNumber}0000000-0000-4000-8000-000000000001`,
    versionNumber,
    artifactDigest: String(versionNumber).repeat(64),
    acceptedAt: NOW,
    isCurrent: true
  }));
  assert.throws(() => createAlakazam35Snapshot({
    projectId: PROJECT_ID,
    subscription: subscription(),
    photo: null,
    configuration: null,
    history,
    care: { requestCount: 0, lastRequestedAt: null }
  }));
  assert.throws(() => createAlakazam35Snapshot({
    projectId: PROJECT_ID,
    subscription: subscription(),
    photo: null,
    configuration: null,
    history: history.slice(0, 2),
    care: { requestCount: 0, lastRequestedAt: null }
  }));
});

test("effective facts apply expanded font and toggles while rejecting rogue $50 fields", () => {
  const selected = applyAlakazam35EffectiveFacts({
    authority: authority(),
    configuration: configuration(),
    configuredFacts: {
      theme: "clear",
      businessName: "Cedar Workshop",
      summary: "Furniture made locally.",
      location: "Camden, New Jersey",
      hours: "Weekdays",
      cashapp: "rogue",
      venmo: "rogue",
      menu: ["rogue"]
    }
  });
  assert.equal(selected.effectiveFacts.fontPair, "alt");
  assert.equal(selected.effectiveFacts.borderStyle, "soft");
  assert.equal(selected.effectiveFacts.sectionVisibility.practical, false);
  assert.equal(selected.effectiveFacts.cashapp, undefined);
  assert.equal(selected.effectiveFacts.venmo, undefined);
  assert.equal(selected.effectiveFacts.menu, undefined);
});

test("effective facts reject changed configuration digests and incomplete authority", () => {
  assert.throws(() => applyAlakazam35EffectiveFacts({
    authority: authority(),
    configuration: {
      ...configuration(),
      configurationDigest: "f".repeat(64)
    },
    configuredFacts: {}
  }));
  assert.throws(() => applyAlakazam35EffectiveFacts({
    authority: {
      policy: { capabilities: [], limits: {} },
      policyDigest: "f".repeat(64)
    },
    configuration: configuration(),
    configuredFacts: {}
  }));
});

test("service records photo, configuration, and care then returns refreshed snapshots", async () => {
  const calls = [];
  const expectedSnapshot = Object.freeze({ schema: ALAKAZAM_35_SNAPSHOT_SCHEMA });
  const repository = {
    async readiness() { return { ready: true, state: "held" }; },
    async read(value) { calls.push(["read", value]); return expectedSnapshot; },
    async storePhoto(value, selected) { calls.push(["photo", value, selected]); },
    async saveConfiguration(value, selected) { calls.push(["config", value, selected]); },
    async recordCare(value, selected) { calls.push(["care", value, selected]); }
  };
  const service = createAlakazam35Service({
    repository,
    clock: { now: () => NOW }
  });
  assert.equal(await service.readiness().then((value) => value.ready), true);
  assert.equal(await service.uploadPhoto(scope(), {
    commandId: PHOTO_ID,
    mediaType: "image/png",
    mediaBase64: pngBase64()
  }), expectedSnapshot);
  assert.equal(await service.configure(scope(), {
    commandId: COMMAND_ID,
    expectedCurrentRevision: 0,
    fontChoiceId: "alt",
    photoAssetId: PHOTO_ID,
    sections: sections()
  }), expectedSnapshot);
  assert.equal(await service.requestCare(scope(), {
    commandId: "90000000-0000-4000-8000-000000000001",
    message: "Please review the updated hours."
  }), expectedSnapshot);
  assert.deepEqual(calls.map((entry) => entry[0]), [
    "photo", "read", "config", "read", "care", "read"
  ]);
});
