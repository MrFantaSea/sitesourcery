import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../data-plane/supabase/migrations/202608120129_provider_reconciliation.sql",
  import.meta.url
);

test("PROVIDER-RECONCILIATION-01 is digest-only, forced-RLS, and authority-bound", async () => {
  const source = await readFile(MIGRATION, "utf8");
  for (const required of [
    /^-- PROVIDER-RECONCILIATION-01\nbegin;/u,
    /hosted_responder_fulfillment_queue_contract_v1/u,
    /hosted_responder_twilio_delivery_events_contract_v1/u,
    /hosted_responder_twilio_inbound_contract_v1/u,
    /reconcile_operator_work_queue_v1\(timestamptz\)/u,
    /create table ss\.provider_reconciliation_cases/u,
    /case_kind in \(\s*'abandoned_claim', 'stale_delivery_status',/u,
    /case_digest ss\.sha256_hex not null unique/u,
    /create table ss\.responder_inbound_resolutions/u,
    /create index responder_delivery_operations_abandoned_claims/u,
    /create index responder_delivery_provider_statuses_nonterminal/u,
    /create or replace function ss\.reconcile_operator_work_queue_v1/u,
    /'ss\.provider_reconciliation_cases', reconciliation\.id::text/u,
    /'provider_reconciliation_case'/u,
    /alter table ss\.provider_reconciliation_cases force row level security/u,
    /alter table ss\.responder_inbound_resolutions force row level security/u,
    /canonical-provider-reconciliation-v1-readback-evidence-bound/u,
    /commit;\s*$/u
  ]) assert.match(source, required);
  for (const forbidden of [
    /raw_payload|message_sid text|phone_number text|message_body|caller_number/iu,
    /grant (?:select|insert|update|delete)[^;]*\b(?:anon|authenticated)\b/iu,
    // Reconciliation must not fabricate provider dispatch authority.
    /provider_effects_authorized\s*=\s*true/iu
  ]) assert.doesNotMatch(source, forbidden);
});

test("self-healed closure is the only closure without operator authority", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(
    source,
    /resolution_kind = 'self_healed'\s*and resolved_by_operator_user_id is null/u
  );
  assert.match(
    source,
    /resolution_kind <> 'self_healed'\s*and resolved_by_operator_user_id is not null/u
  );
  assert.match(
    source,
    /Provider reconciliation closure requires named operator authority/u
  );
  assert.match(
    source,
    /service_operator_has_capability\(\s*new\.resolved_by_operator_user_id/u
  );
});

test("cases begin open with exactly one readback and immutable identity", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(
    source,
    /Provider reconciliation cases must begin open and exact/u
  );
  assert.match(
    source,
    /An open reconciliation case accepts exactly one readback record/u
  );
  assert.match(
    source,
    /Provider reconciliation case identity is immutable/u
  );
  assert.match(
    source,
    /Resolution cannot rewrite readback evidence/u
  );
});

test("inbound resolution requires an unbound event, active binding, and operator authority", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(source, /inbound\.state = 'unbound'/u);
  assert.match(source, /binding\.state = 'active'/u);
  assert.match(
    source,
    /reconciliation\.case_kind = 'unbound_inbound_event'/u
  );
  assert.match(
    source,
    /Responder inbound resolution requires exact operator-backed evidence/u
  );
});

test("the operator queue gains exactly the reconciliation source and item kind", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(
    source,
    /operator_work_queue_items_source_table_v2_check/u
  );
  assert.match(
    source,
    /operator_work_queue_items_item_kind_v2_check/u
  );
  assert.match(
    source,
    /'ss\.provider_reconciliation_cases'\s*\)/u
  );
  assert.match(
    source,
    /'provider_reconciliation_case'\s*\)/u
  );
  assert.doesNotMatch(
    source,
    /grant (?:insert|update|delete)[^;]*operator_work_queue_items/iu
  );
});
