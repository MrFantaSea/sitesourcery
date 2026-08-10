import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../data-plane/supabase/migrations/202608100107_durable_mail_lifecycle.sql",
  import.meta.url
);

test("MAIL-01 migration is additive, digest-only, forced-RLS, and fail-closed", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(source, /^begin;/u);
  assert.match(source, /commit;\s*$/u);
  assert.match(
    source,
    /hosted_runtime_contract_v53\(\)[\s\S]*hosted_runtime_contract_v54\(\)/u
  );
  for (const table of [
    "hosted_mail_deliveries",
    "hosted_mail_provider_event_inbox",
    "hosted_mail_delivery_events",
    "hosted_mail_exception_projection",
    "hosted_mail_recipient_suppressions"
  ]) {
    assert.match(source, new RegExp(`create table ss\\.${table}\\b`, "u"));
    assert.match(
      source,
      new RegExp(`alter table ss\\.${table} force row level security`, "u")
    );
  }
  assert.match(
    source,
    /state in \(\s*'pending',\s*'provider_accepted',\s*'delivered',\s*'bounced',\s*'complained',\s*'suppressed',\s*'expired'/u
  );
  assert.match(source, /mail delivery event does not match the projection/u);
  assert.match(source, /mail recipient suppression lacks provider evidence/u);
  assert.match(
    source,
    /revoke all on\s+ss\.hosted_mail_deliveries,[\s\S]*from public, anon, authenticated, service_role/u
  );
  assert.doesNotMatch(
    source,
    /\b(?:recipient_email|email_address|message_body|subject_text|action_url|raw_payload|provider_message_id)\b/u
  );
  assert.doesNotMatch(
    source,
    /provider_effects_authorized\s*=\s*true|resend\.com|api[_-]?key|secret[_-]?key/iu
  );
});
