import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../data-plane/supabase/migrations/202608120130_responder_private_material_retention.sql",
  import.meta.url
);

test("RESPONDER-PRIVATE-MATERIAL-RETENTION-01 is held, leased, digest-only, and forced-RLS", async () => {
  const source = await readFile(MIGRATION, "utf8");
  for (const required of [
    /^-- RESPONDER-PRIVATE-MATERIAL-RETENTION-01\nbegin;/u,
    /hosted_responder_private_material_contract_v1/u,
    /hosted_responder_twilio_inbound_contract_v1/u,
    /hosted_provider_reconciliation_contract_v1/u,
    /create table ss\.responder_private_material_holds/u,
    /hold_kind in \('legal', 'retention'\)/u,
    /service_operator_has_capability/u,
    /create table ss\.responder_private_material_cleanup_jobs/u,
    /state in \('pending', 'claimed', 'succeeded', 'manual_review'\)/u,
    /create table ss\.responder_private_material_destruction_receipts/u,
    /primary_ciphertext_zeroed boolean not null check \(primary_ciphertext_zeroed\)/u,
    /backup_retention_until = destroyed_at \+ interval '30 days'/u,
    /alter table ss\.responder_private_material_holds force row level security/u,
    /alter table ss\.responder_private_material_cleanup_jobs force row level security/u,
    /alter table ss\.responder_private_material_destruction_receipts\s+force row level security/u,
    /canonical-responder-private-material-retention-v1-held-leased-zeroing/u,
    /commit;\s*$/u
  ]) assert.match(source, required);
  for (const forbidden of [
    /phone_number text/iu,
    /message_body/iu,
    /recipient text/iu,
    /body text/iu,
    /grant (?:select|insert|update|delete)[^;]*\b(?:anon|authenticated)\b/iu
  ]) assert.doesNotMatch(source, forbidden);
});

test("destruction rechecks lifecycle and holds while preserving envelope evidence", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(source, /responder_private_material_destroy_reason/u);
  assert.match(source, /operation\.state as operation_state/u);
  assert.match(source, /contact\.state as contact_state/u);
  assert.match(source, /interaction\.state as interaction_state/u);
  assert.match(source, /project\.lifecycle/u);
  assert.match(source, /hold_kind text not null check \(hold_kind in \('legal', 'retention'\)\)/u);
  assert.match(source, /hold_until > placed_at/u);
  assert.match(source, /source_envelope_digest ss\.sha256_hex not null/u);
  assert.match(source, /worker_id_digest ss\.sha256_hex not null/u);
  assert.match(source, /old\.failure_count <> 99/u);
  assert.match(source, /new\.failure_count <> 100/u);
  assert.doesNotMatch(
    source.slice(
      source.indexOf("create function ss.responder_private_material_destroy_reason"),
      source.indexOf("create table ss.responder_private_material_cleanup_jobs")
    ),
    /selected_(?:nonce|ciphertext|authentication_tag)/u
  );
});

test("the existing guards still require one-way zeroing of every ciphertext-bearing column", async () => {
  const [delivery, inbound] = await Promise.all([
    readFile(new URL(
      "../../data-plane/supabase/migrations/202608120126_responder_private_delivery_material.sql",
      import.meta.url
    ), "utf8"),
    readFile(new URL(
      "../../data-plane/supabase/migrations/202608120128_responder_twilio_inbound.sql",
      import.meta.url
    ), "utf8")
  ]);
  assert.match(
    delivery,
    /nonce is null and authentication_tag is null and ciphertext is null/u
  );
  assert.match(delivery, /old\.state <> 'active'/u);
  assert.match(delivery, /new\.state <> 'destroyed'/u);
  assert.match(
    inbound,
    /state = 'destroyed'\s*and key_version is null\s*and nonce is null\s*and authentication_tag is null\s*and ciphertext is null/u
  );
  assert.match(inbound, /Responder inbound material allows only guarded destruction/u);
});
