import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../data-plane/supabase/migrations/202608120127_responder_twilio_delivery_events.sql",
  import.meta.url
);

test("RESPONDER-TWILIO-DELIVERY-EVENTS-01 is digest-only, forced-RLS, and race-safe", async () => {
  const source = await readFile(MIGRATION, "utf8");
  for (const required of [
    /^-- RESPONDER-TWILIO-DELIVERY-EVENTS-01\nbegin;/u,
    /add column provider_message_id_digest ss\.sha256_hex/u,
    /create table ss\.responder_delivery_provider_events/u,
    /create table ss\.responder_delivery_provider_statuses/u,
    /event_state in \('pending', 'applied', 'stale', 'conflict'\)/u,
    /current_status text not null/u,
    /attention_required boolean not null/u,
    /responder_delivery_provider_event_digest/u,
    /responder_delivery_status_rank/u,
    /reconcile_responder_delivery_provider_events/u,
    /after insert on ss\.responder_delivery_provider_events/u,
    /after update on ss\.responder_delivery_operations/u,
    /alter table ss\.responder_delivery_provider_events force row level security/u,
    /alter table ss\.responder_delivery_provider_statuses force row level security/u,
    /canonical-responder-twilio-delivery-events-v1-digest-only-race-safe/u,
    /commit;\s*$/u
  ]) assert.match(source, required);
  for (const forbidden of [
    /message_sid text/iu,
    /account_sid text/iu,
    /phone_number/iu,
    /message_body/iu,
    /recipient text/iu,
    /error_message/iu,
    /grant (?:select|insert|update|delete)[^;]*\b(?:anon|authenticated)\b/iu
  ]) assert.doesNotMatch(source, forbidden);
});

test("terminal provider status cannot regress and conflicting terminal evidence raises attention", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(
    source,
    /old\.terminal and new\.current_status <> old\.current_status/u
  );
  assert.match(
    source,
    /selected_event_state := 'conflict';[\s\S]*attention_required = true/u
  );
  assert.match(
    source,
    /event\.event_state = 'pending'[\s\S]*order by event\.received_at, event\.id/u
  );
});
