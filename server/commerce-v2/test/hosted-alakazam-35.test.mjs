import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldHostedAlakazam35,
  createHostedAlakazam35
} from "../hosted-alakazam-35.mjs";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const TENANT_ID = "20000000-0000-4000-8000-000000000001";
const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const COMMAND_ID = "40000000-0000-4000-8000-000000000001";

function boundary() {
  const calls = [];
  return {
    calls,
    hosted: createHostedAlakazam35({
      controls: {
        async readiness() {
          calls.push(["readiness"]);
          return { ready: true, state: "held", providerEffects: false };
        },
        async read(scope) {
          calls.push(["read", scope]);
          return { kind: "snapshot" };
        },
        async uploadPhoto(scope, input) {
          calls.push(["photo", scope, input]);
          return { kind: "photo" };
        },
        async configure(scope, input) {
          calls.push(["configuration", scope, input]);
          return { kind: "configuration" };
        },
        async requestCare(scope, input) {
          calls.push(["care", scope, input]);
          return { kind: "care" };
        }
      },
      async resolveSession({ actor, projectId }) {
        calls.push(["scope", actor.userId, projectId]);
        return {
          tenantId: TENANT_ID,
          projectId,
          customerId: actor.userId,
          actorId: actor.userId
        };
      }
    })
  };
}

test("default hosted F03 boundary is held and never authorizes provider effects", async () => {
  const held = createHeldHostedAlakazam35();
  assert.deepEqual(await held.readiness(), {
    ready: false,
    authorization: false,
    providerEffects: false,
    state: "held"
  });
  for (const method of [
    "getSnapshot",
    "uploadPhoto",
    "saveConfiguration",
    "requestCare"
  ]) {
    await assert.rejects(
      held[method]({ userId: USER_ID }),
      (error) => error.code === "ALAKAZAM_35_HELD" && error.status === 503
    );
  }
});

test("hosted F03 boundary requires authentication before scope resolution", async () => {
  const context = boundary();
  await assert.rejects(
    context.hosted.getSnapshot(null, PROJECT_ID),
    (error) => error.code === "AUTHENTICATION_REQUIRED"
  );
  assert.deepEqual(context.calls, []);
});

test("hosted F03 boundary binds every read and write to the resolved customer project", async () => {
  const context = boundary();
  const actor = { userId: USER_ID };
  assert.deepEqual(await context.hosted.getSnapshot(actor, PROJECT_ID), {
    kind: "snapshot"
  });
  assert.deepEqual(await context.hosted.uploadPhoto(actor, PROJECT_ID, {
    commandId: COMMAND_ID
  }), { kind: "photo" });
  assert.deepEqual(await context.hosted.saveConfiguration(actor, PROJECT_ID, {
    commandId: COMMAND_ID
  }), { kind: "configuration" });
  assert.deepEqual(await context.hosted.requestCare(actor, PROJECT_ID, {
    commandId: COMMAND_ID
  }), { kind: "care" });
  assert.equal(context.calls.filter((entry) => entry[0] === "scope").length, 4);
  for (const entry of context.calls.filter((item) =>
    ["read", "photo", "configuration", "care"].includes(item[0])
  )) {
    assert.deepEqual(entry[1], {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      customerId: USER_ID,
      actorId: USER_ID
    });
  }
});

test("hosted F03 boundary rejects a resolver that crosses actor identity", async () => {
  const hosted = createHostedAlakazam35({
    controls: {
      readiness() {}, read() {}, uploadPhoto() {}, configure() {}, requestCare() {}
    },
    async resolveSession() {
      return {
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        customerId: "90000000-0000-4000-8000-000000000001",
        actorId: USER_ID
      };
    }
  });
  await assert.rejects(
    hosted.getSnapshot({ userId: USER_ID }, PROJECT_ID),
    (error) => error.code === "ALAKAZAM_PROJECT_UNAVAILABLE"
  );
});
