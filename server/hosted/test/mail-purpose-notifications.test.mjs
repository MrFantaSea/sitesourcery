import assert from "node:assert/strict";
import test from "node:test";

import {
  MAIL_PURPOSE_NOTIFICATION_AUTHORITIES,
  createHeldMailPurposeNotifications,
  createMailPurposeNotifications,
  normalizeMailPurposeNotification
} from "../mail-purpose-notifications.mjs";

const NOW = "2026-08-18T18:00:00.000Z";
const LATER = "2026-08-18T19:00:00.000Z";
const ACTOR = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const SOURCE = "30000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);

function input(overrides = {}) {
  return {
    actorId: ACTOR,
    commandId: "mail-purpose-command-0001",
    contentDigest: "b".repeat(64),
    expiresAt: LATER,
    notificationKind: "domain_lifecycle_updated",
    operatorOrganizationId: ORG,
    purposeKind: "publication_domain",
    recipientDigest: "c".repeat(64),
    source: {
      table: "ss.domain_provider_lifecycle_states",
      id: SOURCE,
      revision: 4,
      digest: SHA,
      state: "active"
    },
    subjectReferenceDigest: "d".repeat(64),
    templateVersion: "domain-lifecycle-updated.v1",
    ...overrides
  };
}

test("mail-purpose authority freezes five families and the exact 14 reviewed sources", () => {
  assert.equal(Object.keys(MAIL_PURPOSE_NOTIFICATION_AUTHORITIES).length, 14);
  assert.deepEqual(
    MAIL_PURPOSE_NOTIFICATION_AUTHORITIES.publication_state_changed,
    {
      purposeKind: "publication_domain",
      table: "ss.publication_control_commands",
      states: ["publish", "rollback", "unpublish"],
      templateVersion: "publication-state-changed.v1"
    }
  );
  assert.deepEqual(
    MAIL_PURPOSE_NOTIFICATION_AUTHORITIES.domain_lifecycle_updated,
    {
      purposeKind: "publication_domain",
      table: "ss.domain_provider_lifecycle_states",
      states: ["active", "grace", "redemption", "expired", "transferred_out"],
      templateVersion: "domain-lifecycle-updated.v1"
    }
  );
  assert.deepEqual(
    new Set(Object.values(MAIL_PURPOSE_NOTIFICATION_AUTHORITIES)
      .map((authority) => authority.purposeKind)),
    new Set([
      "project_progress", "publication_domain", "care", "responder",
      "marketing_followup"
    ])
  );
});

test("normalization binds exact source evidence without accepting private content", () => {
  const normalized = normalizeMailPurposeNotification(input(), NOW);
  assert.equal(normalized.requestedAt, NOW);
  assert.match(normalized.requestDigest, /^[0-9a-f]{64}$/u);
  assert.equal(normalized.source.table, "ss.domain_provider_lifecycle_states");
  assert.equal(normalized.source.revision, 4);
  assert.equal("recipient" in normalized, false);
  assert.equal("subject" in normalized, false);
  assert.equal("body" in normalized, false);
  assert.equal("provider" in normalized, false);

  for (const invalid of [
    input({ purposeKind: "care" }),
    input({ templateVersion: "domain-lifecycle-updated.v2" }),
    input({ source: { ...input().source, state: "unknown" } }),
    input({ expiresAt: NOW }),
    { ...input(), body: "private text" }
  ]) {
    assert.throws(
      () => normalizeMailPurposeNotification(invalid, NOW),
      (error) => error?.code === "MAIL_PURPOSE_NOTIFICATION_INVALID"
    );
  }
});

test("repository composition delegates normalized evidence and held mode has zero effects", async () => {
  const calls = [];
  const repository = {
    async readiness() { return { ready: true, verified: true }; },
    async reserveOperator(value) { calls.push(value); return { ok: true }; },
    async listCustomer(value) { return { value }; },
    async listOperator(value) { return { value }; }
  };
  const service = createMailPurposeNotifications({
    repository,
    clock: { now: () => NOW }
  });
  assert.deepEqual(await service.reserveOperator(input()), { ok: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].requestDigest, /^[0-9a-f]{64}$/u);
  assert.equal(service.providerEffects, false);
  assert.equal(service.deliveryClaimed, false);

  const held = createHeldMailPurposeNotifications();
  assert.equal((await held.readiness()).ready, false);
  await assert.rejects(
    held.reserveOperator(input()),
    (error) => error?.code === "MAIL_PURPOSE_NOTIFICATION_HELD" &&
      error.details.providerEffects === false &&
      error.details.deliveryClaimed === false
  );
});
