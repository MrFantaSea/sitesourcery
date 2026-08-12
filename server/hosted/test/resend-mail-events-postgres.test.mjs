import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { createMailLifecycle } from "../mail-lifecycle.mjs";
import {
  createPostgresMailLifecycleRepository
} from "../mail-lifecycle-postgres.mjs";
import { createResendMailEventWebhook } from "../resend-mail-events.mjs";

const NOW = "2026-08-11T16:00:00.000Z";
const EARLIER = "2026-08-11T15:59:00.000Z";
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const PROVIDER_MESSAGE_ID = "49f9f02a-93f5-4ddf-9e84-01df500701d4";
const KEY = Buffer.from("fixed-test-resend-webhook-key-02", "utf8");
const SECRET = `whsec_${KEY.toString("base64")}`;

function signed(type, { webhookId, occurredAt = NOW }) {
  const timestamp = String(Date.parse(NOW) / 1000);
  const rawBody = Buffer.from(JSON.stringify({
    type,
    created_at: occurredAt,
    data: { email_id: PROVIDER_MESSAGE_ID }
  }));
  const signature = createHmac("sha256", KEY)
    .update(Buffer.from(`${webhookId}.${timestamp}.`, "utf8"))
    .update(rawBody)
    .digest("base64");
  return {
    rawBody,
    headers: {
      "content-type": "application/json",
      "svix-id": webhookId,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`
    }
  };
}

function durableAuthority() {
  const inboxByEventDigest = new Map();
  const sqlLog = [];
  const delivery = {
    id: MESSAGE_ID,
    message_type: "support_notification",
    organization_id: "20000000-0000-4000-8000-000000000001",
    project_id: "30000000-0000-4000-8000-000000000001",
    customer_user_id: "10000000-0000-4000-8000-000000000001",
    recipient_digest: "a".repeat(64),
    state: "provider_accepted",
    provider: "resend",
    provider_accepted_at: new Date(EARLIER),
    terminal_at: null,
    requested_at: new Date(EARLIER),
    expires_at: new Date("2026-08-11T17:00:00.000Z"),
    revision: "1"
  };
  let eventSequence = 0;
  const authority = {
    async service(context, work) {
      assert.deepEqual(context, {
        actorKind: "system",
        isolation: "serializable"
      });
      return work({
        async query(sql, values = []) {
          sqlLog.push(sql);
          if (/pg_advisory_xact_lock/u.test(sql)) return { rows: [], rowCount: 1 };
          if (
            /select \* from ss\.hosted_mail_provider_event_inbox/u.test(sql)
          ) {
            const row = inboxByEventDigest.get(values[1]);
            return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (/insert into ss\.hosted_mail_provider_event_inbox/u.test(sql)) {
            const row = {
              id: values[0],
              provider: values[1],
              provider_event_id_digest: values[2],
              provider_message_id_digest: values[3],
              event_kind: values[4],
              normalized_event_digest: values[5],
              signature_verification_digest: values[6],
              evidence_digest: values[7],
              occurred_at: new Date(values[8]),
              ingested_at: new Date(values[9]),
              state: "pending"
            };
            inboxByEventDigest.set(values[2], row);
            return { rows: [row], rowCount: 1 };
          }
          if (/select \* from ss\.hosted_mail_deliveries/u.test(sql)) {
            return { rows: [delivery], rowCount: 1 };
          }
          if (/update ss\.hosted_mail_deliveries/u.test(sql)) {
            delivery.state = values[1];
            delivery.terminal_at = new Date(values[2]);
            delivery.revision = String(Number(delivery.revision) + 1);
            return { rows: [{ ...delivery }], rowCount: 1 };
          }
          if (/insert into ss\.hosted_mail_delivery_events/u.test(sql)) {
            eventSequence += 1;
            return { rows: [], rowCount: 1 };
          }
          if (/update ss\.hosted_mail_provider_event_inbox/u.test(sql)) {
            const row = [...inboxByEventDigest.values()].find(
              (entry) => entry.id === values[0]
            );
            if (/set state = 'applied'/u.test(sql)) row.state = "applied";
            if (/set state = 'conflict'/u.test(sql)) row.state = "conflict";
            return { rows: [], rowCount: 1 };
          }
          if (
            /hosted_mail_exception_projection/u.test(sql) ||
            /hosted_mail_recipient_suppressions/u.test(sql)
          ) return { rows: [], rowCount: 1 };
          throw new Error(`Unexpected SQL in deterministic mail event proof: ${sql}`);
        }
      });
    }
  };
  return { authority, delivery, inboxByEventDigest, sqlLog, events: () => eventSequence };
}

test("signed complaint is durable, suppresses, replays idempotently, and older events cannot roll state back", async () => {
  const durable = durableAuthority();
  const repository = createPostgresMailLifecycleRepository({
    authority: durable.authority
  });
  const lifecycle = createMailLifecycle({
    repository,
    clock: { now: () => NOW }
  });
  const webhook = createResendMailEventWebhook({
    signingSecret: SECRET,
    lifecycle,
    clock: { now: () => NOW }
  });

  const complaint = signed("email.complained", {
    webhookId: "mail_event_complaint_0001"
  });
  const first = await webhook.ingest(complaint);
  assert.equal(first.httpStatus, 200);
  assert.equal(first.eventState, "applied");
  assert.equal(first.currentState, "complained");
  assert.equal(durable.delivery.state, "complained");
  assert.equal(durable.events(), 1);
  assert.ok(durable.sqlLog.some((sql) =>
    /insert into ss\.hosted_mail_recipient_suppressions/u.test(sql)
  ));
  assert.ok(durable.sqlLog.some((sql) =>
    /insert into ss\.hosted_mail_exception_projection/u.test(sql)
  ));

  const beforeReplay = durable.sqlLog.length;
  const replay = await webhook.ingest(complaint);
  assert.equal(replay.httpStatus, 200);
  assert.equal(replay.eventState, "applied");
  assert.equal(durable.events(), 1);
  assert.equal(durable.sqlLog.length, beforeReplay + 2);

  const olderDelivery = await webhook.ingest(signed("email.delivered", {
    webhookId: "mail_event_delivery_0002",
    occurredAt: EARLIER
  }));
  assert.equal(olderDelivery.httpStatus, 200);
  assert.equal(olderDelivery.eventState, "conflict");
  assert.equal(olderDelivery.currentState, "complained");
  assert.equal(durable.delivery.state, "complained");
  assert.equal(durable.events(), 1);
  assert.equal(durable.inboxByEventDigest.size, 2);
});

test("signed bounce, failed, and suppression events reach durable projections", async () => {
  for (const [providerType, state, expectsSuppression] of [
    ["email.bounced", "bounced", false],
    ["email.failed", "bounced", false],
    ["email.suppressed", "suppressed", true]
  ]) {
    const durable = durableAuthority();
    const lifecycle = createMailLifecycle({
      repository: createPostgresMailLifecycleRepository({
        authority: durable.authority
      }),
      clock: { now: () => NOW }
    });
    const webhook = createResendMailEventWebhook({
      signingSecret: SECRET,
      lifecycle,
      clock: { now: () => NOW }
    });
    const receipt = await webhook.ingest(signed(providerType, {
      webhookId: `mail_event_${state}_0003`
    }));
    assert.equal(receipt.httpStatus, 200);
    assert.equal(receipt.eventState, "applied");
    assert.equal(receipt.currentState, state);
    assert.equal(durable.delivery.state, state);
    assert.ok(durable.sqlLog.some((sql) =>
      /insert into ss\.hosted_mail_exception_projection/u.test(sql)
    ));
    assert.equal(
      durable.sqlLog.some((sql) =>
        /insert into ss\.hosted_mail_recipient_suppressions/u.test(sql)
      ),
      expectsSuppression
    );
  }
});
