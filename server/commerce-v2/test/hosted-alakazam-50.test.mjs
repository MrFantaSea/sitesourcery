import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldHostedAlakazam50,
  createHostedAlakazam50
} from "../hosted-alakazam-50.mjs";

const USER_ID = "20000000-0000-4000-8000-000000000001";
const PROJECT_ID = "30000000-0000-4000-8000-000000000001";

test("default hosted $50 boundary is held and never authorizes provider effects", async () => {
  const boundary = createHeldHostedAlakazam50();
  assert.deepEqual(await boundary.readiness(), {
    ready: false,
    authorization: false,
    providerEffects: false,
    state: "held"
  });
  await assert.rejects(
    boundary.getSnapshot({ userId: USER_ID }, PROJECT_ID),
    (error) => error.code === "ALAKAZAM_50_HELD" && error.status === 503
  );
});

test("hosted $50 boundary requires authentication before resolving scope", async () => {
  let resolutions = 0;
  const boundary = createHostedAlakazam50({
    controls: {
      readiness() {}, read() {}, configure() {}, requestCare() {}
    },
    async resolveSession() { resolutions += 1; }
  });
  await assert.rejects(
    boundary.getSnapshot(null, PROJECT_ID),
    (error) => error.code === "AUTHENTICATION_REQUIRED"
  );
  assert.equal(resolutions, 0);
});

test("hosted $50 boundary binds reads and writes to one resolved customer project", async () => {
  const calls = [];
  const scope = {
    tenantId: "10000000-0000-4000-8000-000000000001",
    customerId: USER_ID,
    actorId: USER_ID,
    projectId: PROJECT_ID
  };
  const boundary = createHostedAlakazam50({
    controls: {
      readiness() { return { state: "held" }; },
      read(input) { calls.push(["read", input]); return { kind: "read" }; },
      configure(input, command) {
        calls.push(["configure", input, command]);
        return { kind: "configure" };
      },
      requestCare(input, command) {
        calls.push(["care", input, command]);
        return { kind: "care" };
      }
    },
    async resolveSession() { return scope; }
  });
  const actor = { userId: USER_ID };
  assert.deepEqual(await boundary.getSnapshot(actor, PROJECT_ID), { kind: "read" });
  assert.deepEqual(await boundary.saveConfiguration(actor, PROJECT_ID, { x: 1 }), {
    kind: "configure"
  });
  assert.deepEqual(await boundary.requestCare(actor, PROJECT_ID, { y: 2 }), {
    kind: "care"
  });
  assert.deepEqual(calls.map((entry) => entry[0]), ["read", "configure", "care"]);
  for (const entry of calls) assert.deepEqual(entry[1], scope);
});

test("hosted $50 boundary rejects resolver identity drift", async () => {
  const boundary = createHostedAlakazam50({
    controls: {
      readiness() {}, read() {}, configure() {}, requestCare() {}
    },
    async resolveSession() {
      return {
        tenantId: "10000000-0000-4000-8000-000000000001",
        customerId: "90000000-0000-4000-8000-000000000001",
        actorId: "90000000-0000-4000-8000-000000000001",
        projectId: PROJECT_ID
      };
    }
  });
  await assert.rejects(
    boundary.getSnapshot({ userId: USER_ID }, PROJECT_ID),
    (error) => error.code === "ALAKAZAM_PROJECT_UNAVAILABLE"
  );
});
