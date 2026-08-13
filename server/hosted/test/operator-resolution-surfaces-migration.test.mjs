import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../data-plane/supabase/migrations/202608130133_operator_resolution_surfaces.sql",
  import.meta.url
);

test("FIN-004U adds an append-only evidence-bound resolution command", async () => {
  const source = await readFile(MIGRATION, "utf8");
  for (const required of [
    /create table ss\.provider_reconciliation_resolution_commands/u,
    /case_id uuid not null unique/u,
    /request_digest ss\.sha256_hex not null/u,
    /evidence_digest ss\.sha256_hex not null/u,
    /current_service_actor_user_id\(\) is distinct from new\.operator_user_id/u,
    /service_management_manage/u,
    /organization_memberships/u,
    /for update/u,
    /exact append-only operator command/u,
    /force row level security/u,
    /canonical-fin-004u-operator-resolution-v1-digest-only-held/u
  ]) assert.match(source, required);
  for (const forbidden of [
    /provider_effects_authorized\s*=\s*true/iu,
    /raw_payload|message_body|phone_number text|provider_message_id text/iu,
    /grant (?:select|insert|update|delete)[^;]*\b(?:anon|authenticated)\b/iu
  ]) assert.doesNotMatch(source, forbidden);
});
test("FIN-004U resolution kinds require exact retained evidence", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(
    source,
    /operator_confirmed_no_effect'[\s\S]*ambiguous_message_create'[\s\S]*readback_state = 'not_found'/u
  );
  assert.match(
    source,
    /operator_late_binding_applied'[\s\S]*responder_inbound_resolutions/u
  );
  assert.match(
    source,
    /operator_binding_retired'[\s\S]*ambiguous_number_binding/u
  );
  assert.match(source, /Resolution cannot rewrite readback evidence/u);
});

test("FIN-004U projects every retained manual-review worker source", async () => {
  const source = await readFile(MIGRATION, "utf8");
  for (const table of [
    "responder_delivery_operations",
    "responder_inbound_followup_jobs",
    "responder_private_material_cleanup_jobs",
    "lifecycle_jobs",
    "domain_lifecycle_worker_jobs",
    "care_lifecycle_worker_jobs"
  ]) assert.match(source, new RegExp(`ss\\.${table}`, "u"));
  assert.match(source, /operator_manual_review_queue_v1/u);
  assert.match(source, /repair_kind text/u);
  assert.match(source, /null::text, source\.opened_at/u);
});
