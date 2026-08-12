import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  createFakeResponderProvider,
  createHeldResponderCore,
  createResponderCore
} from "../responder-core.mjs";

const IDS = Object.freeze({
  actor: randomUUID(),
  authority: randomUUID(),
  customer: randomUUID(),
  interaction: randomUUID(),
  organization: randomUUID(),
  project: randomUUID()
});
const TIME = "2026-08-11T16:00:00.000Z";

function repository() {
  const calls = [];
  const selected = {};
  for (const name of [
    "recordConsent", "ingestProviderEvent", "reserveHeldMessage",
    "requestHandoff", "engageGlobalKill", "accountProjection",
    "operatorProjection"
  ]) {
    selected[name] = (...args) => {
      calls.push({ name, args });
      return { name, args };
    };
  }
  selected.readiness = async () => ({ ready: true, verified: true });
  return { calls, selected };
}

function customer() {
  return {
    kind: "customer",
    userId: IDS.customer,
    organizationId: IDS.organization
  };
}

test("provider-neutral boundary accepts digest-only consent and holds output", async () => {
  const storage = repository();
  const service = createResponderCore({
    repository: storage.selected,
    provider: createFakeResponderProvider(),
    clock: { now: () => TIME }
  });
  assert.deepEqual(await service.readiness(), {
    schema: "sitesourcery.responder-core/v1",
    ready: true,
    verified: true,
    mode: "held",
    providerEffects: false,
    sellable: false,
    billingEffects: false,
    globalKillEngagedByDefault: true
  });

  service.recordConsent(customer(), {
    commandId: "responder-consent-001",
    organizationId: IDS.organization,
    projectId: IDS.project,
    customerUserId: IDS.customer,
    routeDigest: "a".repeat(64),
    consentBasis: "inbound_call",
    consentEvidenceDigest: "b".repeat(64),
    consentedAt: TIME
  });
  const consent = storage.calls.at(-1).args[1];
  assert.equal(consent.routeKind, "sms");
  assert.equal(consent.purpose, "missed_call_response");
  assert.match(consent.requestDigest, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(consent).includes("phone"), false);

  service.ingestProviderEvent({
    commandId: "responder-event-001",
    organizationId: IDS.organization,
    projectId: IDS.project,
    providerEventIdDigest: "c".repeat(64),
    routeDigest: "a".repeat(64),
    eventKind: "missed_call",
    payloadDigest: "d".repeat(64),
    occurredAt: TIME
  });
  const event = storage.calls.at(-1).args[0];
  assert.equal(event.provider, "fake");
  assert.equal(event.messageIntent, "not_applicable");
  assert.equal(Object.hasOwn(event, "body"), false);

  service.reserveHeldMessage(customer(), {
    commandId: "responder-message-001",
    organizationId: IDS.organization,
    projectId: IDS.project,
    interactionId: IDS.interaction,
    contactAuthorityId: IDS.authority,
    messageKind: "missed_call_ack",
    contentDigest: "e".repeat(64)
  });
  assert.equal(storage.calls.at(-1).name, "reserveHeldMessage");
  assert.equal(service.providerEffects, false);
  assert.equal(service.sellable, false);
});

test("fake provider deterministically classifies STOP without accepting content", () => {
  const storage = repository();
  const service = createResponderCore({
    repository: storage.selected,
    provider: createFakeResponderProvider({ classifyMessage: () => "stop" }),
    clock: () => TIME
  });
  service.ingestProviderEvent({
    commandId: "responder-stop-001",
    organizationId: IDS.organization,
    projectId: IDS.project,
    providerEventIdDigest: "1".repeat(64),
    routeDigest: "2".repeat(64),
    eventKind: "message_received",
    payloadDigest: "3".repeat(64),
    occurredAt: TIME
  });
  const normalized = storage.calls[0].args[0];
  assert.equal(normalized.messageIntent, "stop");
  assert.equal(normalized.provider, "fake");
  assert.equal(normalized.schema, "sitesourcery.responder-provider-event/v1");
});

test("global kill is operator-only and handoff is revision-bound", () => {
  const storage = repository();
  const service = createResponderCore({
    repository: storage.selected,
    provider: createFakeResponderProvider(),
    clock: () => TIME
  });
  assert.throws(
    () => service.engageGlobalKill(customer(), {
      commandId: "responder-kill-001",
      organizationId: IDS.organization,
      evidenceDigest: "4".repeat(64)
    }),
    (error) => error.code === "RESPONDER_CORE_UNAVAILABLE"
  );
  service.requestHandoff(customer(), {
    commandId: "responder-handoff-001",
    organizationId: IDS.organization,
    projectId: IDS.project,
    interactionId: IDS.interaction,
    expectedRevision: 1,
    reason: "customer_request",
    evidenceDigest: "5".repeat(64)
  });
  assert.equal(storage.calls.at(-1).args[1].expectedRevision, 1);
});

test("raw contact, message, and live-provider expansion fail before storage", () => {
  const storage = repository();
  const service = createResponderCore({
    repository: storage.selected,
    provider: createFakeResponderProvider(),
    clock: () => TIME
  });
  assert.throws(
    () => service.recordConsent(customer(), {
      commandId: "responder-consent-raw-001",
      organizationId: IDS.organization,
      projectId: IDS.project,
      customerUserId: IDS.customer,
      routeDigest: "6".repeat(64),
      consentBasis: "inbound_call",
      consentEvidenceDigest: "7".repeat(64),
      consentedAt: TIME,
      phoneNumber: "+15555550100"
    }),
    (error) => error.code === "RESPONDER_CORE_INVALID"
  );
  assert.throws(
    () => service.ingestProviderEvent({
      commandId: "responder-event-raw-001",
      organizationId: IDS.organization,
      projectId: IDS.project,
      providerEventIdDigest: "8".repeat(64),
      routeDigest: "9".repeat(64),
      eventKind: "message_received",
      payloadDigest: "a".repeat(64),
      occurredAt: TIME,
      messageBody: "STOP"
    }),
    (error) => error.code === "RESPONDER_CORE_INVALID"
  );
  assert.equal(storage.calls.length, 0);
  assert.throws(
    () => createResponderCore({
      repository: storage.selected,
      provider: { kind: "twilio", effects: true },
      clock: () => TIME
    }),
    (error) => error.code === "RESPONDER_CORE_CONFIGURATION_REQUIRED"
  );
});

test("uncomposed Responder boundary fails closed without effects", async () => {
  const held = createHeldResponderCore();
  assert.equal((await held.readiness()).providerEffects, false);
  assert.throws(
    () => held.ingestProviderEvent({}),
    (error) => error.code === "RESPONDER_CORE_HELD" &&
      error.details.providerEffects === false
  );
});
