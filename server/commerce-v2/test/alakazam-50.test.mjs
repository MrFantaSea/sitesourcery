import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_50_CONFIGURATION_SCHEMA,
  createAlakazam50CareRequest,
  createAlakazam50Configuration,
  createAlakazam50Service,
  createAlakazam50Snapshot,
  verifyAlakazam50Configuration
} from "../alakazam-50.mjs";

const IDS = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  customerId: "20000000-0000-4000-8000-000000000001",
  projectId: "30000000-0000-4000-8000-000000000001",
  subscriptionId: "40000000-0000-4000-8000-000000000001",
  commandId: "50000000-0000-4000-8000-000000000001"
};
const NOW = "2026-08-09T12:00:00.000Z";

function scope() {
  return {
    tenantId: IDS.tenantId,
    projectId: IDS.projectId,
    customerId: IDS.customerId,
    actorId: IDS.customerId
  };
}

function subscription(overrides = {}) {
  return {
    subscriptionId: IDS.subscriptionId,
    tierId: "alakazam_50",
    status: "active",
    revision: 7,
    ...overrides
  };
}

function command(overrides = {}) {
  return {
    scope: scope(),
    commandId: IDS.commandId,
    subscription: subscription(),
    expectedCurrentRevision: 2,
    cashAppHandle: "cedar.shop",
    venmoHandle: "cedar_shop",
    fontChoiceId: "editorial",
    borderChoiceId: "ornate",
    menu: [
      { target: "offerings", label: "Services" },
      { target: "about", label: "Our story" },
      { target: "contact", label: "Pay or contact" }
    ],
    configuredAt: NOW,
    ...overrides
  };
}

test("$50 configuration binds exact handles, menu order, extended style, and subscription revision", () => {
  const selected = createAlakazam50Configuration(command());
  assert.equal(selected.schema, ALAKAZAM_50_CONFIGURATION_SCHEMA);
  assert.equal(selected.configurationRevision, 3);
  assert.equal(selected.subscriptionRevision, 7);
  assert.equal(selected.cashAppHandle, "cedar.shop");
  assert.equal(selected.fontChoiceId, "editorial");
  assert.equal(selected.borderChoiceId, "ornate");
  assert.deepEqual(selected.menu.map((item) => item.target), [
    "offerings", "about", "contact"
  ]);
  assert.equal(selected.state, "held");
  assert.deepEqual(verifyAlakazam50Configuration(selected), selected);
});

test("$50 configuration rejects lower authority, prefixed handles, duplicate targets, and unknown style", () => {
  assert.throws(() => createAlakazam50Configuration(command({
    subscription: subscription({ tierId: "alakazam_35" })
  })), /exact current/u);
  assert.throws(() => createAlakazam50Configuration(command({
    cashAppHandle: "$cedar"
  })), /cashAppHandle/u);
  assert.throws(() => createAlakazam50Configuration(command({
    menu: [
      { target: "about", label: "About" },
      { target: "about", label: "Again" }
    ]
  })), /targets must be unique/u);
  assert.throws(() => createAlakazam50Configuration(command({
    fontChoiceId: "browser-injected"
  })), /unavailable/u);
});

test("more care records exact held accounting without an SLA, edit count, or provider effect", () => {
  const request = createAlakazam50CareRequest({
    scope: scope(),
    commandId: IDS.commandId,
    subscription: subscription(),
    message: "Please review the seasonal menu labels.",
    requestedAt: NOW
  });
  assert.equal(request.careClass, "more");
  assert.equal(request.state, "held");
  assert.equal("responseTime" in request, false);
  assert.equal("editCount" in request, false);
  assert.equal("providerEffects" in request, false);
});

test("$50 snapshot remains held and exact-current-revision bound", () => {
  const configuration = createAlakazam50Configuration(command());
  const selected = createAlakazam50Snapshot({
    scope: scope(),
    subscription: subscription(),
    configuration,
    care: { requestCount: 2, lastRequestedAt: NOW }
  });
  assert.equal(selected.providerEffects, false);
  assert.equal(selected.controls.fonts.length, 3);
  assert.equal(selected.controls.borders.length, 3);
  assert.equal(selected.controls.careClass, "more");
  assert.throws(() => createAlakazam50Snapshot({
    scope: scope(),
    subscription: subscription({ revision: 8 }),
    configuration,
    care: { requestCount: 0, lastRequestedAt: null }
  }), /authority changed/u);
});

test("service appends held configuration and care then refreshes the snapshot", async () => {
  const calls = [];
  const service = createAlakazam50Service({
    repository: {
      readiness() { return { state: "held" }; },
      read(input) { calls.push(["read", input]); return { state: "held" }; },
      saveConfiguration(input, value) {
        calls.push(["configuration", input, value]);
      },
      recordCare(input, value) { calls.push(["care", input, value]); }
    },
    clock: { now: () => NOW }
  });
  await service.configure(scope(), {
    commandId: IDS.commandId,
    expectedCurrentRevision: 0,
    cashAppHandle: null,
    venmoHandle: null,
    fontChoiceId: "inherit",
    borderChoiceId: "soft",
    menu: [{ target: "contact", label: "Contact" }]
  });
  await service.requestCare(scope(), {
    commandId: IDS.commandId,
    message: "Review this held request."
  });
  assert.deepEqual(calls.map((entry) => entry[0]), [
    "configuration", "read", "care", "read"
  ]);
  assert.equal(calls[0][2].configuredAt, NOW);
  assert.equal(calls[2][2].requestedAt, NOW);
});
