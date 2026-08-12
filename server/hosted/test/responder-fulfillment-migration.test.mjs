import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../data-plane/supabase/migrations/202608120125_responder_fulfillment_queue.sql",
  import.meta.url
);

test("RESPONDER-FULFILLMENT-QUEUE-01 is held-default, leased, auditable, and forced-RLS", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(source, /^-- RESPONDER-FULFILLMENT-QUEUE-01\nbegin;/u);
  assert.match(source, /commit;\s*$/u);
  assert.match(
    source,
    /canonical-responder-fulfillment-queue-v1-held-default/u
  );
  for (const table of [
    "responder_delivery_operations",
    "responder_delivery_operation_events"
  ]) {
    assert.match(source, new RegExp(`create table ss\\.${table}\\b`, "u"));
    assert.match(
      source,
      new RegExp(`alter table ss\\.${table} force row level security`, "u")
    );
  }
  for (const contract of [
    "provider_effects_authorized",
    "idempotency_key",
    "attempt_count",
    "maximum_attempts",
    "lease_owner",
    "lease_expires_at",
    "retry_wait",
    "manual_review",
    "dead_letter",
    "global_kill_engaged",
    "release_evidence_digest",
    "responder_delivery_operation_digest",
    "responder_delivery_event_digest"
  ]) assert.match(source, new RegExp(contract, "u"));
  assert.match(
    source,
    /old\.state not in \('queued', 'retry_wait'\)[\s\S]*control\.state <> 'approved_live'[\s\S]*control\.global_kill_engaged/u
  );
  assert.match(
    source,
    /selected_kind <> 'system'[\s\S]*Responder delivery transition lacks system authority/u
  );
  assert.doesNotMatch(
    source,
    /phone_number|message_body|recording|provider_credentials|api_key|secret_key/iu
  );
  assert.doesNotMatch(
    source,
    /insert into ss\.responder_runtime_controls[\s\S]*'approved_live'/u
  );
});
