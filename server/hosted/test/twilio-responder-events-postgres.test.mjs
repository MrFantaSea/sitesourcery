import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresTwilioResponderEventsRepository
} from "../twilio-responder-events-postgres.mjs";

const NOW = "2026-08-12T21:00:00.000Z";
const EVENT_ID = "10000000-0000-4000-8000-000000000001";

function evidence() {
  return {
    provider: "twilio",
    providerEventDigest: "5".repeat(64),
    providerMessageIdDigest: "2".repeat(64),
    accountSidDigest: "3".repeat(64),
    messageStatus: "delivered",
    errorCodeDigest: null,
    signatureVerificationDigest: "4".repeat(64),
    payloadDigest: "5".repeat(64),
    receivedAt: NOW
  };
}

function row(overrides = {}) {
  return {
    id: EVENT_ID,
    provider: "twilio",
    provider_event_digest: "5".repeat(64),
    provider_message_id_digest: "2".repeat(64),
    account_sid_digest: "3".repeat(64),
    message_status: "delivered",
    error_code_digest: null,
    signature_verification_digest: "4".repeat(64),
    payload_digest: "5".repeat(64),
    event_state: "pending",
    current_status: null,
    attention_required: null,
    ...overrides
  };
}

function authority(query) {
  const calls = [];
  return {
    calls,
    kind: "canonical-postgres",
    async service(context, work) {
      calls.push({ context });
      return work({
        async query(text, values = []) {
          calls.push({ text, values });
          return query(text, values, calls);
        }
      });
    }
  };
}

test("Twilio event repository proves the exact forced-RLS contract", async () => {
  const database = authority(() => ({
    rowCount: 1,
    rows: [{ contract_ready: true, tables_ready: true }]
  }));
  const repository = createPostgresTwilioResponderEventsRepository({
    authority: database
  });
  assert.deepEqual(await repository.readiness(), {
    ready: true,
    verified: true,
    kind: "twilio-responder-events-postgres",
    providerEffects: false,
    code: null
  });
  assert.equal(database.calls[0].context.readOnly, true);
});

test("one delivery status becomes durable pending evidence and replays exactly", async () => {
  let stored = null;
  const database = authority((text, values) => {
    if (text.includes("pg_advisory_xact_lock")) {
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("where event.provider_event_digest")) {
      return stored
        ? { rowCount: 1, rows: [stored] }
        : { rowCount: 0, rows: [] };
    }
    if (text.includes("insert into ss.responder_delivery_provider_events")) {
      stored = row();
      return { rowCount: 1, rows: [{ id: EVENT_ID }] };
    }
    if (text.includes("where event.id =")) {
      return { rowCount: 1, rows: [stored] };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  const repository = createPostgresTwilioResponderEventsRepository({
    authority: database,
    randomUUID: () => EVENT_ID
  });
  const first = await repository.ingestDeliveryStatus(evidence());
  assert.deepEqual(first, {
    schema: "sitesourcery.responder-twilio-delivery-event-receipt/v1",
    eventState: "pending",
    messageStatus: "delivered",
    currentStatus: null,
    attentionRequired: false,
    replayed: false,
    providerEffects: false
  });
  const replay = await repository.ingestDeliveryStatus(evidence());
  assert.equal(replay.replayed, true);
  assert.equal(
    database.calls.filter((call) =>
      call.text?.includes("insert into ss.responder_delivery_provider_events")
    ).length,
    1
  );
});

test("expanded or conflicting Twilio evidence fails before mutation", async () => {
  const database = authority((text) => {
    if (text.includes("pg_advisory_xact_lock")) {
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("where event.provider_event_digest")) {
      return { rowCount: 1, rows: [row()] };
    }
    throw new Error("unexpected mutation");
  });
  const repository = createPostgresTwilioResponderEventsRepository({
    authority: database
  });
  assert.throws(
    () => repository.ingestDeliveryStatus({
      ...evidence(),
      phoneNumber: "+15555550100"
    }),
    (error) => error?.code ===
      "TWILIO_RESPONDER_EVENT_REPOSITORY_INVALID"
  );
  await assert.rejects(
    repository.ingestDeliveryStatus({
      ...evidence(),
      messageStatus: "failed"
    }),
    (error) => error?.code ===
      "TWILIO_RESPONDER_EVENT_REPOSITORY_CONFLICT"
  );
});
