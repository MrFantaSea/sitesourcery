import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../data-plane/supabase/migrations/202608110120_responder_core.sql",
  import.meta.url
);

test("RESPONDER-CORE-01 is tenant-scoped, digest-only, forced-RLS, and held", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(source, /^begin;/u);
  assert.match(source, /commit;\s*$/u);
  for (const table of [
    "responder_runtime_controls",
    "responder_contact_authorities",
    "responder_interactions",
    "responder_provider_events",
    "responder_message_commands",
    "responder_control_commands"
  ]) {
    assert.match(source, new RegExp(`create table ss\\.${table}\\b`, "u"));
    assert.match(
      source,
      new RegExp(`alter table ss\\.${table} force row level security`, "u")
    );
  }
  for (const control of [
    "consent_evidence_digest", "route_digest", "provider_event_id_digest",
    "global_kill_engaged", "opted_out", "human_handoff",
    "provider_effects_authorized", "delivery_claimed"
  ]) assert.match(source, new RegExp(control, "u"));
  assert.match(source, /provider text not null check \(provider = 'fake'\)/u);
  assert.match(source, /check \(not provider_effects_authorized\)/u);
  assert.match(source, /check \(not delivery_claimed\)/u);
  assert.doesNotMatch(
    source,
    /phone_number|message_body|recording|provider_credentials|api_key|secret_key/iu
  );
  assert.doesNotMatch(
    source,
    /provider_effects_authorized\s*=\s*true|delivery_claimed\s*=\s*true/iu
  );
});
