import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../data-plane/supabase/migrations/202608100112_operator_work_queue.sql",
  import.meta.url
);

test("OPS-QUEUE-01 is source-bound, forced-RLS, digest-only, and repair narrow", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const expected of [
    "create table ss.stripe_invoice_finalization_failures",
    "create table ss.operator_work_queue_items",
    "create function ss.reconcile_operator_work_queue_v1",
    "force row level security",
    "service_management_manage",
    "professional_reversal_reconcile",
    "source_revision",
    "source_digest",
    "invoice.finalization_failed"
  ]) assert.match(sql, new RegExp(expected.replaceAll(".", "\\."), "u"));

  assert.doesNotMatch(
    sql,
    /raw_payload|customer_email|customer_phone|provider_error_message|message_body/iu
  );
  assert.doesNotMatch(
    sql,
    /mark_paid|mark_complete|delete_account|generic_repair|provider_effects_authorized/iu
  );
  assert.match(
    sql,
    /grant select on ss\.operator_work_queue_items to service_role/iu
  );
  assert.doesNotMatch(
    sql,
    /grant (?:insert|update|delete).*operator_work_queue_items/iu
  );
});

test("every requested bounded source has an exact projection identity", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const source of [
    "service_assessment_stripe_events",
    "service_custom_build_stripe_events",
    "service_custom_build_change_stripe_events",
    "service_custom_build_final_stripe_events",
    "service_professional_payment_lifecycles",
    "service_assessment_jobs",
    "service_custom_build_jobs",
    "hosted_support_cases",
    "publication_control_commands",
    "domain_provider_operations",
    "alakazam_35_care_requests",
    "alakazam_50_care_requests",
    "hosted_mail_exception_projection",
    "stripe_invoice_finalization_failures"
  ]) assert.match(sql, new RegExp(source, "u"));
});
