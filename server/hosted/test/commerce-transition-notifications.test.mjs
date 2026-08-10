import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMERCE_NOTIFICATION_AUTHORITIES,
  createCommerceTransitionNotifications,
  createHeldCommerceTransitionNotifications
} from "../commerce-transition-notifications.mjs";

const IDS = Object.freeze({
  actor: "10000000-0000-4000-8000-000000000001",
  organization: "20000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
  source: "40000000-0000-4000-8000-000000000001"
});
const NOW = "2026-08-10T18:00:00.000Z";
const DIGESTS = Object.freeze({
  source: "a".repeat(64),
  recipient: "b".repeat(64),
  subject: "c".repeat(64),
  content: "d".repeat(64)
});

function repositoryFixture() {
  const calls = [];
  const repository = {
    async readiness() { return { ready: true }; },
    async reserve(input) { calls.push(["reserve", input]); return input; },
    async listCustomer(input) { calls.push(["customer", input]); return { items: [] }; },
    async listOperator(input) { calls.push(["operator", input]); return { items: [] }; }
  };
  return {
    calls,
    service: createCommerceTransitionNotifications({
      repository,
      clock: { now: () => NOW }
    })
  };
}

function inputFor(notificationKind, commandIndex = 1) {
  const authority = COMMERCE_NOTIFICATION_AUTHORITIES[notificationKind];
  return {
    commandId: `commerce.notify.${String(commandIndex).padStart(4, "0")}`,
    audienceKind: authority.audience,
    notificationKind,
    source: {
      table: authority.table,
      id: authority.table.includes("stripe_events")
        ? "9".repeat(64)
        : IDS.source,
      revision: 1,
      digest: DIGESTS.source,
      state: authority.states[0]
    },
    recipientDigest: DIGESTS.recipient,
    subjectReferenceDigest: DIGESTS.subject,
    contentDigest: DIGESTS.content,
    templateVersion: "commerce_v1",
    expiresAt: "2026-08-10T19:00:00.000Z"
  };
}

test("held commerce notification interface performs no delivery or provider effect", async () => {
  const service = createHeldCommerceTransitionNotifications();
  assert.deepEqual(await service.readiness(), {
    ready: false,
    verified: false,
    kind: "commerce-transition-notifications",
    mode: "held",
    code: "COMMERCE_NOTIFICATION_HELD",
    providerEffects: false,
    deliveryClaimed: false,
    sourceAuthoritative: true
  });
  await assert.rejects(service.reserve({}), (error) =>
    error.code === "COMMERCE_NOTIFICATION_HELD" &&
    error.details.providerEffects === false &&
    error.details.deliveryClaimed === false);
});

test("every fixed customer/operator kind binds one exact source authority", async () => {
  const { calls, service } = repositoryFixture();
  let commandIndex = 0;
  for (const notificationKind of Object.keys(COMMERCE_NOTIFICATION_AUTHORITIES)) {
    commandIndex += 1;
    await service.reserve(inputFor(notificationKind, commandIndex));
  }
  assert.equal(calls.length, 21);
  for (const [, reservation] of calls) {
    assert.equal(reservation.requestedAt, NOW);
    assert.match(reservation.requestDigest, /^[0-9a-f]{64}$/u);
    assert.equal("body" in reservation, false);
    assert.equal("email" in reservation, false);
    assert.equal("providerPayload" in reservation, false);
  }
});

test("source/audience mismatch and raw content are rejected before repository access", () => {
  const { calls, service } = repositoryFixture();
  assert.throws(() => service.reserve({
    ...inputFor("assessment_payment_settled"),
    audienceKind: "operator"
  }), { code: "COMMERCE_NOTIFICATION_INVALID" });
  assert.throws(() => service.reserve({
    ...inputFor("invoice_finalization_failed"),
    source: {
      ...inputFor("invoice_finalization_failed").source,
      table: "ss.hosted_support_cases"
    }
  }), { code: "COMMERCE_NOTIFICATION_INVALID" });
  assert.throws(() => service.reserve({
    ...inputFor("assessment_report_delivered"),
    body: "not accepted"
  }), { code: "COMMERCE_NOTIFICATION_INVALID" });
  assert.equal(calls.length, 0);
});

test("customer and operator reads bind exact actor scopes", async () => {
  const { calls, service } = repositoryFixture();
  await service.listCustomer({
    actorId: IDS.actor,
    organizationId: IDS.organization,
    projectId: IDS.project
  });
  await service.listOperator({
    actorId: IDS.actor,
    operatorOrganizationId: IDS.organization
  });
  assert.deepEqual(calls, [
    ["customer", {
      actorId: IDS.actor,
      organizationId: IDS.organization,
      projectId: IDS.project
    }],
    ["operator", {
      actorId: IDS.actor,
      operatorOrganizationId: IDS.organization
    }]
  ]);
});
