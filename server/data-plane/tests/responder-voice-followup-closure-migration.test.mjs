import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../supabase/migrations/202608130132_responder_voice_followup_closure.sql",
  import.meta.url
);

test("FIN-004T Voice closure is private, lease-fenced, and held", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  for (const pattern of [
    /create table ss\.responder_voice_dial_targets/iu,
    /create unique index responder_one_active_voice_dial_target/iu,
    /responder_voice_dial_target_envelope_digest/iu,
    /create table ss\.responder_inbound_followup_jobs/iu,
    /lease_fence bigint/iu,
    /responder_inbound_followup_jobs_ready/iu,
    /create trigger responder_twilio_inbound_enqueue_followup/iu,
    /system Responder message lacks a leased follow-up job/iu,
    /system_followup.*job\.lease_expires_at > new\.created_at/isu,
    /force row level security/iu,
    /canonical-fin-004t-responder-voice-target-followup-v1-held/iu
  ]) {
    assert.match(sql, pattern);
  }
  assert.doesNotMatch(
    sql,
    /create extension|http_post|net\.http|twilio\.com|api\.stripe/iu
  );
});
