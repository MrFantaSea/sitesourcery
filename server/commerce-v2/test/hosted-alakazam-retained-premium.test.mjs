import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  createHeldHostedAlakazamRetainedPremium,
  createHostedAlakazamRetainedPremium
} from "../hosted-alakazam-retained-premium.mjs";

test("default retained-premium boundary is held without provider effects", async () => {
  const held = createHeldHostedAlakazamRetainedPremium();
  assert.deepEqual(await held.readiness(), {
    ready: false,
    authorization: false,
    providerEffects: false,
    state: "held"
  });
  await assert.rejects(
    held.getSnapshot({ userId: randomUUID() }, randomUUID()),
    { code: "ALAKAZAM_RETAINED_PREMIUM_HELD", status: 503 }
  );
});

test("hosted retained-premium boundary binds read, export, and restore", async () => {
  const actor = { userId: randomUUID() };
  const projectId = randomUUID();
  const tenantId = randomUUID();
  const calls = [];
  const controls = {
    readiness: async () => ({ ready: true }),
    read: async (scope) => {
      calls.push(["read", scope]);
      return { snapshot: true };
    },
    exportConfiguration: async (scope) => {
      calls.push(["export", scope]);
      return { export: true };
    },
    restore: async (scope, input) => {
      calls.push(["restore", scope, input]);
      return { restored: true };
    }
  };
  const hosted = createHostedAlakazamRetainedPremium({
    controls,
    resolveSession: async () => ({
      tenantId,
      projectId,
      customerId: actor.userId,
      actorId: actor.userId
    })
  });
  assert.deepEqual(await hosted.getSnapshot(actor, projectId), {
    snapshot: true
  });
  assert.deepEqual(await hosted.getExport(actor, projectId), {
    export: true
  });
  const command = { commandId: randomUUID() };
  assert.deepEqual(
    await hosted.restoreConfiguration(actor, projectId, command),
    { restored: true }
  );
  assert.deepEqual(calls.map(([kind]) => kind), [
    "read",
    "export",
    "restore"
  ]);
  assert.equal(calls[2][1].tenantId, tenantId);
  assert.equal(calls[2][2], command);
});

test("hosted retained-premium boundary rejects identity drift", async () => {
  const actor = { userId: randomUUID() };
  const hosted = createHostedAlakazamRetainedPremium({
    controls: {
      readiness: async () => ({ ready: true }),
      read: async () => null,
      exportConfiguration: async () => null,
      restore: async () => null
    },
    resolveSession: async ({ projectId }) => ({
      tenantId: randomUUID(),
      projectId,
      customerId: randomUUID(),
      actorId: actor.userId
    })
  });
  await assert.rejects(
    hosted.getSnapshot(actor, randomUUID()),
    { code: "ALAKAZAM_PROJECT_UNAVAILABLE", status: 404 }
  );
});
