import assert from "node:assert/strict";
import test from "node:test";

import { createResponderSurfacesService } from "../responder-surfaces.mjs";

const IDS = Object.freeze({
  authority: "10000000-0000-4000-8000-000000000001",
  customer: "20000000-0000-4000-8000-000000000001",
  interaction: "30000000-0000-4000-8000-000000000001",
  operator: "40000000-0000-4000-8000-000000000001",
  organization: "50000000-0000-4000-8000-000000000001",
  project: "60000000-0000-4000-8000-000000000001"
});
const TIME = "2026-08-11T16:00:00.000Z";

function fixture() {
  const calls = [];
  const core = {
    providerEffects: false,
    sellable: false,
    readiness: async () => ({ ready: true, verified: true }),
    recordConsent(actor, input) {
      calls.push(["recordConsent", actor, input]);
      return { schema: "consent", providerEffects: false };
    },
    recordStop(actor, input) {
      calls.push(["recordStop", actor, input]);
      return { schema: "stop", providerEffects: false };
    },
    requestHandoff(actor, input) {
      calls.push(["requestHandoff", actor, input]);
      return { schema: "handoff", providerEffects: false };
    },
    reserveHeldMessage(actor, input) {
      calls.push(["reserveHeldMessage", actor, input]);
      return { schema: "held", providerEffects: false };
    },
    engageGlobalKill(actor, input) {
      calls.push(["engageGlobalKill", actor, input]);
      return { schema: "kill", providerEffects: false };
    }
  };
  const repository = {
    readiness: async () => ({ ready: true, verified: true }),
    readCustomer(input) {
      calls.push(["readCustomer", input]);
      return { audience: "customer", providerEffects: false };
    },
    readOperator(input) {
      calls.push(["readOperator", input]);
      return { audience: "operator", providerEffects: false };
    }
  };
  return {
    calls,
    service: createResponderSurfacesService({ core, repository })
  };
}

function customer() {
  return {
    userId: IDS.customer,
    organizationId: IDS.organization
  };
}

function context(body, commandId = "responder-surface-command-0001") {
  return {
    organizationId: IDS.organization,
    commandId,
    body
  };
}

test("surface readiness and customer/operator reads remain held and scoped", async () => {
  const { calls, service } = fixture();
  assert.deepEqual(await service.readiness(), {
    schema: "sitesourcery.responder-surface-readiness/v1",
    ready: true,
    verified: true,
    mode: "held",
    providerEffects: false,
    billingEffects: false,
    sellable: false
  });
  assert.deepEqual(service.readCustomer(customer()), {
    audience: "customer",
    providerEffects: false
  });
  assert.deepEqual(
    service.readOperator({
      userId: IDS.operator,
      organizationId: IDS.organization
    }, IDS.organization),
    { audience: "operator", providerEffects: false }
  );
  assert.deepEqual(calls, [
    ["readCustomer", {
      userId: IDS.customer,
      organizationId: IDS.organization
    }],
    ["readOperator", {
      userId: IDS.operator,
      organizationId: IDS.organization
    }]
  ]);
});

test("consent derives customer identity and operator consent stays explicit", () => {
  const { calls, service } = fixture();
  service.recordCustomerConsent(customer(), context({
    projectId: IDS.project,
    routeDigest: "a".repeat(64),
    consentBasis: "explicit_service_request",
    consentEvidenceDigest: "b".repeat(64),
    consentedAt: TIME
  }));
  assert.equal(calls[0][1].kind, "customer");
  assert.equal(calls[0][2].customerUserId, IDS.customer);
  assert.equal(Object.hasOwn(calls[0][2], "phoneNumber"), false);

  service.recordOperatorConsent({
    userId: IDS.operator,
    organizationId: IDS.organization
  }, context({
    customerUserId: IDS.customer,
    projectId: IDS.project,
    routeDigest: "a".repeat(64),
    consentBasis: "inbound_call",
    consentEvidenceDigest: "b".repeat(64),
    consentedAt: TIME
  }, "responder-surface-consent-operator-0001"));
  assert.equal(calls[1][1].kind, "operator");
  assert.equal(calls[1][2].customerUserId, IDS.customer);
});

test("STOP, handoff, held command, and kill bind exact path and tenant facts", () => {
  const { calls, service } = fixture();
  service.stop(customer(), "customer", IDS.authority, context({
    projectId: IDS.project,
    routeDigest: "a".repeat(64),
    providerEventIdDigest: "b".repeat(64),
    payloadDigest: "c".repeat(64),
    occurredAt: TIME
  }, "responder-surface-stop-0001"));
  assert.equal(calls[0][0], "recordStop");
  assert.equal(calls[0][2].contactAuthorityId, IDS.authority);

  service.requestHandoff(
    customer(),
    "customer",
    IDS.interaction,
    context({
      projectId: IDS.project,
      expectedRevision: 1,
      reason: "customer_request",
      evidenceDigest: "d".repeat(64)
    }, "responder-surface-handoff-0001")
  );
  assert.equal(calls[1][2].interactionId, IDS.interaction);

  service.reserveHeldMessage(
    customer(),
    "customer",
    IDS.interaction,
    context({
      projectId: IDS.project,
      contactAuthorityId: IDS.authority,
      messageKind: "human_handoff_ack",
      contentDigest: "e".repeat(64)
    }, "responder-surface-held-message-0001")
  );
  assert.equal(calls[2][0], "reserveHeldMessage");

  service.engageGlobalKill({
    userId: IDS.operator,
    organizationId: IDS.organization
  }, context({
    evidenceDigest: "f".repeat(64)
  }, "responder-surface-global-kill-0001"));
  assert.equal(calls[3][1].kind, "operator");
  assert.equal(calls[3][2].organizationId, IDS.organization);
  assert.equal(JSON.stringify(calls).includes("messageBody"), false);
});

test("surface inputs reject raw routes, bodies, extra fields, and effectful cores", () => {
  const { calls, service } = fixture();
  assert.throws(
    () => service.recordCustomerConsent(customer(), context({
      projectId: IDS.project,
      routeDigest: "a".repeat(64),
      consentBasis: "inbound_call",
      consentEvidenceDigest: "b".repeat(64),
      consentedAt: TIME,
      phoneNumber: "+15555550100"
    })),
    (error) => error.code === "RESPONDER_SURFACE_INVALID"
  );
  assert.throws(
    () => service.reserveHeldMessage(
      customer(),
      "customer",
      IDS.interaction,
      context({
        projectId: IDS.project,
        contactAuthorityId: IDS.authority,
        messageKind: "missed_call_ack",
        contentDigest: "not-a-digest",
        messageBody: "hello"
      })
    ),
    (error) => error.code === "RESPONDER_SURFACE_INVALID"
  );
  assert.equal(calls.length, 0);
  assert.throws(
    () => createResponderSurfacesService({
      core: { providerEffects: true, sellable: true },
      repository: {}
    }),
    (error) => error.code === "RESPONDER_SURFACE_CONFIGURATION_REQUIRED"
  );
});
