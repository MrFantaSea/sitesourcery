import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../data-plane/supabase/migrations/202608100110_support_privacy_case_lifecycle.sql",
  import.meta.url
);

test("SUPPORT-CASE-01 is additive, digest-only, append-audited, and default-deny", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(source, /^begin;/u);
  assert.match(source, /commit;\s*$/u);
  assert.match(source, /hosted_runtime_contract_v54\(\)/u);
  assert.match(source, /hosted_support_case_contract_v1\(\)/u);
  for (const table of [
    "hosted_support_cases", "hosted_support_case_commands",
    "hosted_support_case_evidence", "hosted_support_case_events",
    "hosted_support_case_mail_reservations"
  ]) {
    assert.match(source, new RegExp(`create table ss\\.${table}\\b`, "u"));
    assert.match(source,
      new RegExp(`alter table ss\\.${table} force row level security`, "u"));
  }
  assert.match(source, /delivery\.state = 'pending'/u);
  assert.match(source, /support notification lacks one pending MAIL-01 reservation/u);
  assert.match(source, /support case projections cannot be deleted/u);
  assert.match(source, /hosted_support_case_events_immutable/u);
  assert.doesNotMatch(
    source,
    /\b(?:email_address|phone_number|message_body|subject_text|raw_payload|identity_document|export_bytes|deletion_instruction)\b/iu
  );
  assert.doesNotMatch(
    source,
    /provider_effects_authorized\s*=\s*true|delete\s+from\s+auth\.users|insert\s+into\s+ss\.export_requests/iu
  );
});
