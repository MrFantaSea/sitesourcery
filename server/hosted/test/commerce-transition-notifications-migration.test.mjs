import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../data-plane/supabase/migrations/202608100114_commerce_transition_notifications.sql",
  import.meta.url
);

test("COMMERCE-NOTIFY-01 is source-bound, mail-reserved, held, and default-deny", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const expected of [
    "create view ss.commerce_transition_notification_sources",
    "create table ss.commerce_transition_notification_outbox",
    "commerce_customer_notification",
    "commerce_operator_notification",
    "source_revision",
    "source_digest",
    "mail_request_digest",
    "state text not null default 'held'",
    "provider_effects_authorized boolean not null default false",
    "delivery_claimed boolean not null default false",
    "force row level security"
  ]) assert.match(sql, new RegExp(expected.replaceAll(".", "\\."), "u"));
  assert.match(
    sql,
    /grant select, insert on ss\.commerce_transition_notification_outbox\s+to service_role/iu
  );
  assert.doesNotMatch(
    sql,
    /grant (?:update|delete).*commerce_transition_notification_outbox/iu
  );
  assert.doesNotMatch(
    sql,
    /raw_payload|provider_error_message|message_body|email_address|phone_number/iu
  );
});

test("source registry contains only the bounded committed transition families", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const source of [
    "service_quote_revisions",
    "service_invoices",
    "service_assessment_payment_receipts",
    "service_assessment_reports",
    "service_custom_build_quote_revisions",
    "service_custom_build_invoices",
    "service_custom_build_payment_receipts",
    "service_custom_build_change_orders",
    "service_custom_build_change_invoices",
    "service_custom_build_change_payment_receipts",
    "service_custom_build_completion_packages",
    "service_custom_build_final_invoices",
    "service_custom_build_final_payment_receipts",
    "service_custom_build_handoff_receipts",
    "service_professional_payment_lifecycles",
    "service_professional_reversal_evidence",
    "service_assessment_stripe_events",
    "service_custom_build_stripe_events",
    "service_custom_build_change_stripe_events",
    "service_custom_build_final_stripe_events",
    "stripe_invoice_finalization_failures"
  ]) assert.match(sql, new RegExp(source, "u"));
  assert.match(
    sql,
    /service_json_digest\([\s\S]*commerce-notification-source-id\/v1/iu
  );
  assert.doesNotMatch(sql, /stripe_events', event\.id, 1::bigint/iu);
  assert.doesNotMatch(sql, /alakazam_|domain_provider|support_case/iu);
});
