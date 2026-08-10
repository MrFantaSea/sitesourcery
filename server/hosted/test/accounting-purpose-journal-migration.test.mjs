import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../data-plane/supabase/migrations/202608100115_accounting_purpose_journal.sql",
  import.meta.url
);

test("ACCOUNTING-01 is append-only, source-projected, forced-RLS, and held", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /^-- ACCOUNTING-01[\s\S]*\bbegin;/u);
  assert.match(sql, /commit;\s*$/u);
  for (const source of [
    "commerce_v2_download_payment_receipts",
    "service_assessment_payment_receipts",
    "service_custom_build_payment_receipts",
    "service_custom_build_change_payment_receipts",
    "service_custom_build_final_payment_receipts",
    "alakazam_payment_receipts",
    "domain_payment_allocations"
  ]) assert.match(sql, new RegExp(source, "u"));
  for (const fact of [
    "charged_amount_minor",
    "tax_evidence_state",
    "fee_evidence_state",
    "payout_aging_state",
    "evidence_digests",
    "idempotency_digest"
  ]) assert.match(sql, new RegExp(fact, "u"));
  assert.match(sql, /before insert or update or delete/u);
  assert.match(sql, /force row level security/u);
  assert.match(sql, /service_management_manage/u);
  assert.match(sql,
    /canonical-accounting-purpose-journal-v1-projection-only-held/u);
  assert.match(sql,
    /grant select on table ss\.accounting_purpose_journal to service_role/u);
  assert.doesNotMatch(sql,
    /grant (?:insert|update|delete).*accounting_purpose_journal/iu);
});

test("ACCOUNTING-01 does not invent fee, payout, or Domain tax facts", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql,
    /fee_evidence_state text not null check \([\s\S]*not_present_in_source/u);
  assert.match(sql,
    /payout_aging_state text not null check \([\s\S]*not_present_in_source/u);
  assert.match(sql,
    /'ss\.provider_receipts'[\s\S]*'domain_payment'[\s\S]*null, null,[\s\S]*'not_present_in_source'/u);
  assert.doesNotMatch(sql,
    /balance_transaction|payouts?\.|refunds?\.|charges?\.|provider[_ ]read|provider[_ ]write/iu);
  assert.doesNotMatch(sql,
    /authoritativeAccounting[^\n]*true|sourceAuthoritative[^\n]*true/iu);
});
