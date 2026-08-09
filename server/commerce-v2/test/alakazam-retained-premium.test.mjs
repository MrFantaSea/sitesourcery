import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  createAlakazam50Configuration
} from "../alakazam-50.mjs";
import {
  ALAKAZAM_RETAINED_PREMIUM_EXPORT_SCHEMA,
  ALAKAZAM_RETAINED_PREMIUM_SNAPSHOT_SCHEMA,
  createAlakazamRetainedPremiumExport,
  createAlakazamRetainedPremiumRestoration,
  createAlakazamRetainedPremiumService,
  createAlakazamRetainedPremiumSnapshot
} from "../alakazam-retained-premium.mjs";

const ids = Object.freeze({
  actorId: randomUUID(),
  tenantId: randomUUID(),
  projectId: randomUUID(),
  subscriptionId: randomUUID(),
  sourceConfigurationId: randomUUID(),
  restoredConfigurationId: randomUUID(),
  downgradeEventId: randomUUID(),
  upgradeEventId: randomUUID()
});
const scope = Object.freeze({
  tenantId: ids.tenantId,
  projectId: ids.projectId,
  customerId: ids.actorId,
  actorId: ids.actorId
});
const source = createAlakazam50Configuration({
  scope,
  commandId: ids.sourceConfigurationId,
  subscription: {
    subscriptionId: ids.subscriptionId,
    tierId: "alakazam_50",
    status: "active",
    revision: 7
  },
  expectedCurrentRevision: 0,
  cashAppHandle: "cedar.shop",
  venmoHandle: "cedar_shop",
  fontChoiceId: "studio",
  borderChoiceId: "sharp",
  menu: [
    { target: "contact", label: "Pay Cedar" },
    { target: "about", label: "Our story" }
  ],
  configuredAt: "2026-08-09T12:00:00.000Z"
});

function authority(overrides = {}) {
  return {
    subscriptionId: ids.subscriptionId,
    revision: 8,
    tierId: "alakazam_35",
    status: "active",
    cancelAtPeriodEnd: false,
    providerFactsDigest: "a".repeat(64),
    providerObservedAt: "2026-08-09T13:00:00.000Z",
    firstFailedAt: null,
    graceEndsAt: null,
    retentionEndsAt: null,
    lifecycleState: "active",
    ...overrides
  };
}

test("downgraded active tiers retain only a masked premium marker", () => {
  const snapshot = createAlakazamRetainedPremiumSnapshot({
    scope,
    authority: authority(),
    configuration: source,
    restorationReadiness: {
      ready: false,
      downgradeEventId: null,
      upgradeEventId: null
    }
  });
  assert.equal(snapshot.schema, ALAKAZAM_RETAINED_PREMIUM_SNAPSHOT_SCHEMA);
  assert.equal(snapshot.premium.configured, true);
  assert.equal(snapshot.premium.effectiveOutput, "masked");
  assert.equal(snapshot.premium.values, null);
  assert.equal(snapshot.actions.edit, false);
  assert.equal(snapshot.actions.restore, false);
  assert.equal(snapshot.actions.export, true);
  assert.equal(snapshot.providerEffects, false);
});

test("retained premium rejects configuration from another subscription", () => {
  const otherSubscription = createAlakazam50Configuration({
    scope,
    commandId: randomUUID(),
    subscription: {
      subscriptionId: randomUUID(),
      tierId: "alakazam_50",
      status: "active",
      revision: 7
    },
    expectedCurrentRevision: 0,
    cashAppHandle: source.cashAppHandle,
    venmoHandle: source.venmoHandle,
    fontChoiceId: source.fontChoiceId,
    borderChoiceId: source.borderChoiceId,
    menu: source.menu,
    configuredAt: source.configuredAt
  });
  assert.throws(
    () => createAlakazamRetainedPremiumSnapshot({
      scope,
      authority: authority(),
      configuration: otherSubscription,
      restorationReadiness: {
        ready: false,
        downgradeEventId: null,
        upgradeEventId: null
      }
    }),
    { code: "repository_conflict", status: 500 }
  );
});

test("scheduled cancellation keeps exact active premium authority until period end", () => {
  const snapshot = createAlakazamRetainedPremiumSnapshot({
    scope,
    authority: authority({
      revision: 7,
      tierId: "alakazam_50",
      cancelAtPeriodEnd: true,
      lifecycleState: "scheduled_to_cancel_active"
    }),
    configuration: source,
    restorationReadiness: {
      ready: false,
      downgradeEventId: null,
      upgradeEventId: null
    }
  });
  assert.equal(snapshot.premium.effectiveOutput, "available");
  assert.equal(snapshot.premium.values.cashAppHandle, "cedar.shop");
  assert.equal(snapshot.actions.edit, true);
  assert.equal(snapshot.actions.export, true);
});

test("grace and retained exit expose no edit, publish, or care authority", () => {
  const grace = createAlakazamRetainedPremiumSnapshot({
    scope,
    authority: authority({
      revision: 9,
      tierId: "alakazam_50",
      status: "grace",
      firstFailedAt: "2026-08-09T14:00:00.000Z",
      graceEndsAt: "2026-08-16T14:00:00.000Z",
      retentionEndsAt: "2026-08-16T14:00:00.000Z",
      lifecycleState: "payment_grace"
    }),
    configuration: source,
    restorationReadiness: {
      ready: false,
      downgradeEventId: null,
      upgradeEventId: null
    }
  });
  assert.deepEqual(
    {
      edit: grace.actions.edit,
      restore: grace.actions.restore,
      publish: grace.actions.publish,
      care: grace.actions.care,
      export: grace.actions.export
    },
    {
      edit: false,
      restore: false,
      publish: false,
      care: false,
      export: true
    }
  );
  const retained = createAlakazamRetainedPremiumSnapshot({
    scope,
    authority: authority({
      revision: 10,
      tierId: "alakazam_50",
      status: "suspended",
      retentionEndsAt: "2026-09-15T14:00:00.000Z",
      lifecycleState: "retained_exit"
    }),
    configuration: source,
    restorationReadiness: {
      ready: false,
      downgradeEventId: null,
      upgradeEventId: null
    }
  });
  assert.equal(retained.lifecycle.state, "retained_exit");
  assert.equal(retained.premium.values.cashAppHandle, "cedar.shop");
  assert.equal(retained.actions.edit, false);
  assert.equal(retained.actions.publish, false);
  assert.equal(retained.actions.care, false);
});

test("customer export is bounded and excludes internal and provider identifiers", () => {
  const exported = createAlakazamRetainedPremiumExport({
    scope,
    authority: authority(),
    configuration: source,
    exportedAt: "2026-08-09T15:00:00.000Z"
  });
  assert.equal(exported.schema, ALAKAZAM_RETAINED_PREMIUM_EXPORT_SCHEMA);
  assert.equal(exported.configuration.cashAppHandle, "cedar.shop");
  assert.equal(exported.configuration.menu.length, 2);
  assert.ok(exported.byteCount > 0 && exported.byteCount <= 32768);
  assert.match(exported.exportDigest, /^[a-f0-9]{64}$/u);
  const serialized = JSON.stringify(exported);
  for (const forbidden of [
    "commandId",
    "subscriptionId",
    "providerFactsDigest",
    "customerId",
    "tenantId"
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("re-upgrade restoration copies values through exact provider and tier evidence", () => {
  const currentAuthority = authority({
    revision: 9,
    tierId: "alakazam_50"
  });
  const readiness = {
    ready: true,
    downgradeEventId: ids.downgradeEventId,
    upgradeEventId: ids.upgradeEventId
  };
  const before = createAlakazamRetainedPremiumSnapshot({
    scope,
    authority: currentAuthority,
    configuration: source,
    restorationReadiness: readiness
  });
  assert.equal(before.restoration.required, true);
  assert.equal(before.restoration.available, true);
  assert.equal(before.actions.edit, false);
  assert.equal(before.actions.restore, true);

  const restored = createAlakazam50Configuration({
    scope,
    commandId: ids.restoredConfigurationId,
    subscription: {
      subscriptionId: ids.subscriptionId,
      tierId: "alakazam_50",
      status: "active",
      revision: 9
    },
    expectedCurrentRevision: 1,
    cashAppHandle: source.cashAppHandle,
    venmoHandle: source.venmoHandle,
    fontChoiceId: source.fontChoiceId,
    borderChoiceId: source.borderChoiceId,
    menu: source.menu,
    configuredAt: "2026-08-09T16:00:00.000Z"
  });
  const evidence = createAlakazamRetainedPremiumRestoration({
    scope,
    restorationId: ids.restoredConfigurationId,
    authority: currentAuthority,
    sourceConfiguration: source,
    restoredConfiguration: restored,
    downgradeEvent: {
      eventId: ids.downgradeEventId,
      eventKind: "downgrade_applied",
      priorTierId: "alakazam_50",
      resultTierId: "alakazam_35",
      resultSubscriptionRevision: 8,
      factsDigest: "b".repeat(64)
    },
    upgradeEvent: {
      eventId: ids.upgradeEventId,
      eventKind: "upgrade_applied",
      priorTierId: "alakazam_35",
      resultTierId: "alakazam_50",
      resultSubscriptionRevision: 9,
      factsDigest: "c".repeat(64)
    },
    restoredAt: "2026-08-09T16:00:00.000Z"
  });
  assert.equal(evidence.sourceConfigurationDigest, source.configurationDigest);
  assert.equal(evidence.restoredConfigurationDigest, restored.configurationDigest);
  assert.equal(evidence.providerFactsDigest, "a".repeat(64));
  assert.match(evidence.evidenceDigest, /^[a-f0-9]{64}$/u);

  const after = createAlakazamRetainedPremiumSnapshot({
    scope,
    authority: currentAuthority,
    configuration: restored,
    restorationReadiness: {
      ready: false,
      downgradeEventId: null,
      upgradeEventId: null
    }
  });
  assert.equal(after.restoration.required, false);
  assert.equal(after.premium.effectiveOutput, "available");
  assert.equal(after.actions.edit, true);
});

test("restoration rejects missing canonical tier-change order", () => {
  const restored = createAlakazam50Configuration({
    scope,
    commandId: ids.restoredConfigurationId,
    subscription: {
      subscriptionId: ids.subscriptionId,
      tierId: "alakazam_50",
      status: "active",
      revision: 9
    },
    expectedCurrentRevision: 1,
    cashAppHandle: source.cashAppHandle,
    venmoHandle: source.venmoHandle,
    fontChoiceId: source.fontChoiceId,
    borderChoiceId: source.borderChoiceId,
    menu: source.menu,
    configuredAt: "2026-08-09T16:00:00.000Z"
  });
  assert.throws(
    () => createAlakazamRetainedPremiumRestoration({
      scope,
      restorationId: ids.restoredConfigurationId,
      authority: authority({ revision: 9, tierId: "alakazam_50" }),
      sourceConfiguration: source,
      restoredConfiguration: restored,
      downgradeEvent: {
        eventId: ids.downgradeEventId,
        eventKind: "downgrade_applied",
        priorTierId: "alakazam_50",
        resultTierId: "alakazam_35",
        resultSubscriptionRevision: 9,
        factsDigest: "b".repeat(64)
      },
      upgradeEvent: {
        eventId: ids.upgradeEventId,
        eventKind: "upgrade_applied",
        priorTierId: "alakazam_35",
        resultTierId: "alakazam_50",
        resultSubscriptionRevision: 9,
        factsDigest: "c".repeat(64)
      },
      restoredAt: "2026-08-09T16:00:00.000Z"
    }),
    { code: "alakazam_premium_restoration_invalid" }
  );
});

test("restoration rejects a command identity that differs from its configuration", () => {
  const restored = createAlakazam50Configuration({
    scope,
    commandId: ids.restoredConfigurationId,
    subscription: {
      subscriptionId: ids.subscriptionId,
      tierId: "alakazam_50",
      status: "active",
      revision: 9
    },
    expectedCurrentRevision: 1,
    cashAppHandle: source.cashAppHandle,
    venmoHandle: source.venmoHandle,
    fontChoiceId: source.fontChoiceId,
    borderChoiceId: source.borderChoiceId,
    menu: source.menu,
    configuredAt: "2026-08-09T16:00:00.000Z"
  });
  assert.throws(
    () => createAlakazamRetainedPremiumRestoration({
      scope,
      restorationId: randomUUID(),
      authority: authority({ revision: 9, tierId: "alakazam_50" }),
      sourceConfiguration: source,
      restoredConfiguration: restored,
      downgradeEvent: {
        eventId: ids.downgradeEventId,
        eventKind: "downgrade_applied",
        priorTierId: "alakazam_50",
        resultTierId: "alakazam_35",
        resultSubscriptionRevision: 8,
        factsDigest: "b".repeat(64)
      },
      upgradeEvent: {
        eventId: ids.upgradeEventId,
        eventKind: "upgrade_applied",
        priorTierId: "alakazam_35",
        resultTierId: "alakazam_50",
        resultSubscriptionRevision: 9,
        factsDigest: "c".repeat(64)
      },
      restoredAt: "2026-08-09T16:00:00.000Z"
    }),
    { code: "alakazam_premium_restoration_invalid" }
  );
});

test("service passes exact clocks and restore fences to its repository", async () => {
  const calls = [];
  const snapshot = createAlakazamRetainedPremiumSnapshot({
    scope,
    authority: authority(),
    configuration: source,
    restorationReadiness: {
      ready: false,
      downgradeEventId: null,
      upgradeEventId: null
    }
  });
  const repository = {
    readiness: async () => ({ ready: true }),
    read: async (selectedScope, observedAt) => {
      calls.push(["read", selectedScope, observedAt]);
      return snapshot;
    },
    exportConfiguration: async (selectedScope, exportedAt) => {
      calls.push(["export", selectedScope, exportedAt]);
      return { exported: true };
    },
    restore: async (selectedScope, command) => {
      calls.push(["restore", selectedScope, command]);
    }
  };
  const service = createAlakazamRetainedPremiumService({
    repository,
    clock: { now: () => "2026-08-09T17:00:00.000Z" }
  });
  assert.equal((await service.read(scope)).schema, snapshot.schema);
  assert.deepEqual(await service.exportConfiguration(scope), {
    exported: true
  });
  await service.restore(scope, {
    commandId: ids.restoredConfigurationId,
    expectedSourceConfigurationDigest: source.configurationDigest,
    expectedSubscriptionRevision: 9
  });
  assert.equal(calls.filter(([kind]) => kind === "read").length, 2);
  assert.equal(calls.filter(([kind]) => kind === "restore").length, 1);
  assert.equal(calls[2][2].restoredAt, "2026-08-09T17:00:00.000Z");
});
