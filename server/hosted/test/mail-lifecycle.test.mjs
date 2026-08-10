import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldMailLifecycle,
  createMailLifecycle
} from "../mail-lifecycle.mjs";

const IDS = Object.freeze({
  actorId: "10000000-0000-4000-8000-000000000001",
  organizationId: "20000000-0000-4000-8000-000000000001",
  projectId: "30000000-0000-4000-8000-000000000001",
  messageId: "40000000-0000-4000-8000-000000000001"
});
const DIGESTS = Object.freeze({
  recipient: "1".repeat(64),
  subject: "2".repeat(64),
  content: "3".repeat(64),
  providerMessage: "4".repeat(64),
  event: "5".repeat(64),
  signature: "6".repeat(64),
  evidence: "7".repeat(64)
});
const NOW = "2026-08-10T14:00:00.000Z";

function fakeRepository() {
  const calls = [];
  return {
    calls,
    async readiness() { return { ready: true }; },
    async reserve(value) { calls.push(["reserve", value]); return value; },
    async recordProviderAcceptance(value) {
      calls.push(["accept", value]);
      return { acceptanceState: "provider_accepted" };
    },
    async ingestProviderEvent(value) {
      calls.push(["event", value]);
      return { eventState: "applied" };
    },
    async expire(value) { calls.push(["expire", value]); return value; },
    async listOwnerExceptions(value) {
      calls.push(["exceptions", value]);
      return { items: [] };
    }
  };
}

test("held mail lifecycle is explicit and performs no provider effects", async () => {
  const lifecycle = createHeldMailLifecycle();
  assert.equal(lifecycle.mode, "held");
  assert.equal(lifecycle.providerEffects, false);
  assert.deepEqual(await lifecycle.readiness(), {
    ready: false,
    verified: false,
    kind: "durable-mail-lifecycle",
    mode: "held",
    code: "MAIL_LIFECYCLE_HELD",
    providerEffects: false
  });
  await assert.rejects(
    lifecycle.recordProviderAcceptance({}),
    (error) => error.code === "MAIL_LIFECYCLE_HELD" &&
      error.details.providerEffects === false
  );
});

test("activation, recovery, and support reservations carry digests and exact scope only", async () => {
  const repository = fakeRepository();
  const lifecycle = createMailLifecycle({
    repository,
    clock: { now: () => NOW }
  });
  const messages = [
    {
      messageType: "account_activation",
      organizationId: null,
      projectId: null,
      customerUserId: null
    },
    {
      messageType: "account_recovery",
      organizationId: null,
      projectId: null,
      customerUserId: IDS.actorId
    },
    {
      messageType: "support_notification",
      organizationId: IDS.organizationId,
      projectId: IDS.projectId,
      customerUserId: IDS.actorId
    }
  ];
  for (const [index, scope] of messages.entries()) {
    await lifecycle.reserve({
      commandId: `mail.reserve.000${index}`,
      ...scope,
      recipientDigest: DIGESTS.recipient,
      subjectReferenceDigest: DIGESTS.subject,
      contentDigest: DIGESTS.content,
      templateVersion: "mail_v1",
      expiresAt: "2026-08-10T15:00:00.000Z"
    });
  }
  assert.equal(repository.calls.length, 3);
  for (const [, command] of repository.calls) {
    assert.equal(command.requestedAt, NOW);
    assert.match(command.requestDigest, /^[0-9a-f]{64}$/u);
    assert.equal("recipient" in command, false);
    assert.equal("subject" in command, false);
    assert.equal("body" in command, false);
    assert.equal("token" in command, false);
  }
});

test("provider acceptance remains distinct from delivery and events require verified digests", async () => {
  const repository = fakeRepository();
  const lifecycle = createMailLifecycle({
    repository,
    clock: { now: () => NOW }
  });
  const accepted = await lifecycle.recordProviderAcceptance({
    commandId: "mail.accept.0001",
    messageId: IDS.messageId,
    provider: "resend",
    providerMessageIdDigest: DIGESTS.providerMessage,
    evidenceDigest: DIGESTS.evidence,
    acceptedAt: NOW
  });
  assert.deepEqual(accepted, { acceptanceState: "provider_accepted" });
  assert.equal(repository.calls[0][1].state, undefined);
  assert.match(repository.calls[0][1].requestDigest, /^[0-9a-f]{64}$/u);

  await lifecycle.ingestProviderEvent({
    provider: "resend",
    providerEventIdDigest: DIGESTS.event,
    providerMessageIdDigest: DIGESTS.providerMessage,
    eventKind: "delivered",
    signatureVerificationDigest: DIGESTS.signature,
    evidenceDigest: DIGESTS.evidence,
    occurredAt: NOW
  });
  const normalized = repository.calls[1][1];
  assert.equal(normalized.eventKind, "delivered");
  assert.match(normalized.normalizedEventDigest, /^[0-9a-f]{64}$/u);
  assert.equal("payload" in normalized, false);
  assert.equal("providerMessageId" in normalized, false);
});

test("exact inputs reject bodies, tokens, addresses, and raw provider identifiers", async () => {
  const lifecycle = createMailLifecycle({
    repository: fakeRepository(),
    clock: { now: () => NOW }
  });
  assert.throws(
    () => lifecycle.reserve({
      commandId: "mail.reserve.0009",
      messageType: "account_activation",
      organizationId: null,
      projectId: null,
      customerUserId: null,
      recipientDigest: DIGESTS.recipient,
      subjectReferenceDigest: DIGESTS.subject,
      contentDigest: DIGESTS.content,
      templateVersion: "mail_v1",
      expiresAt: "2026-08-10T15:00:00.000Z",
      body: "private"
    }),
    (error) => error.code === "MAIL_LIFECYCLE_INVALID"
  );
  assert.throws(
    () => lifecycle.ingestProviderEvent({
      provider: "resend",
      providerEventIdDigest: "provider-event-raw",
      providerMessageIdDigest: DIGESTS.providerMessage,
      eventKind: "delivered",
      signatureVerificationDigest: DIGESTS.signature,
      evidenceDigest: DIGESTS.evidence,
      occurredAt: NOW
    }),
    (error) => error.code === "MAIL_LIFECYCLE_INVALID"
  );
});

test("owner exception reads preserve operator and organization authority", async () => {
  const repository = fakeRepository();
  const lifecycle = createMailLifecycle({
    repository,
    clock: { now: () => NOW }
  });
  await lifecycle.listOwnerExceptions({
    actorId: IDS.actorId,
    organizationId: IDS.organizationId
  });
  assert.deepEqual(repository.calls[0], [
    "exceptions",
    {
      actorId: IDS.actorId,
      organizationId: IDS.organizationId,
      observedAt: NOW
    }
  ]);
});
