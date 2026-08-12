import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../data-plane/supabase/migrations/202608120128_responder_twilio_inbound.sql",
  import.meta.url
);

test("RESPONDER-TWILIO-INBOUND-01 is keyed, digest-only, and tenant-bound", async () => {
  const source = await readFile(MIGRATION, "utf8");
  for (const required of [
    /^-- RESPONDER-TWILIO-INBOUND-01\nbegin;/u,
    /hosted_responder_core_contract_v1/u,
    /hosted_responder_fulfillment_queue_contract_v1/u,
    /hosted_responder_private_material_contract_v1/u,
    /hosted_responder_twilio_delivery_events_contract_v1/u,
    /drop constraint responder_provider_events_provider_check/u,
    /provider in \('fake', 'twilio'\)/u,
    /create or replace function ss\.guard_responder_provider_event\(\)/u,
    /create table ss\.responder_provider_number_bindings/u,
    /number_lookup_digest ss\.sha256_hex not null/u,
    /lookup_key_version text not null/u,
    /phone_number_sid_digest ss\.sha256_hex not null/u,
    /provider_readback_digest ss\.sha256_hex not null/u,
    /create unique index responder_one_active_number_binding/u,
    /create unique index responder_one_active_number_resource/u,
    /create table ss\.responder_twilio_inbound_events/u,
    /provider_event_digest ss\.sha256_hex not null unique/u,
    /to_number_key_version text not null/u,
    /check \(provider_event_digest = payload_digest\)/u,
    /state in \('applied', 'recorded', 'unbound', 'superseded'\)/u,
    /create unique index responder_twilio_inbound_single_application/u,
    /create table ss\.responder_inbound_private_materials/u,
    /responder_inbound_material_envelope_digest/u,
    /alter table ss\.responder_provider_number_bindings force row level security/u,
    /alter table ss\.responder_twilio_inbound_events force row level security/u,
    /alter table ss\.responder_inbound_private_materials force row level security/u,
    /canonical-responder-twilio-inbound-v1-keyed-lookup-tenant-bound/u,
    /commit;\s*$/u
  ]) assert.match(source, required);
  for (const forbidden of [
    /phone_number text/iu,
    /from_number/iu,
    /caller_number/iu,
    /message_body/iu,
    /\bbody text\b/iu,
    /raw_payload/iu,
    /grant (?:select|insert|update|delete)[^;]*\b(?:anon|authenticated)\b/iu,
    /insert into ss\.responder_runtime_controls[\s\S]*'approved_live'/u
  ]) assert.doesNotMatch(source, forbidden);
});

test("tenant columns may be null only for the exact unbound quarantine states", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(
    source,
    /\(state = 'unbound'\s*and organization_id is null\s*and project_id is null\s*and core_provider_event_id is null/u
  );
  assert.match(
    source,
    /new\.organization_id is null and new\.state <> 'unbound'/u
  );
  for (const boundState of ["applied", "recorded", "superseded"]) {
    assert.match(
      source,
      new RegExp(
        `\\(state = '${boundState}'\\s*and organization_id is not null`,
        "u"
      )
    );
  }
  assert.match(
    source,
    /and event_kind <> 'call_received'/u,
    "an arrival can never be a structurally applied row"
  );
  assert.match(
    source,
    /and \(dial_call_status is null or dial_call_status in \(\s*'busy', 'no-answer', 'failed', 'canceled'\s*\)\)\)/u,
    "a completed dial can never be a structurally applied row"
  );
  assert.match(
    source,
    /'no_binding', 'retired_binding', 'account_mismatch',\s*'service_mismatch'/u
  );
});

test("inbound material seals exactly one applied event and only zeroing destruction", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(
    source,
    /inbound\.state = 'applied'/u
  );
  assert.match(
    source,
    /\(state = 'destroyed'\s*and key_version is null\s*and nonce is null\s*and authentication_tag is null\s*and ciphertext is null/u
  );
  assert.match(
    source,
    /Responder inbound material allows only guarded destruction/u
  );
});

test("bindings are operator-provisioned with retirement as the only transition", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(source, /selected_kind <> 'operator'/u);
  assert.match(source, /service_operator_has_capability/u);
  assert.match(
    source,
    /Responder number binding retirement is the only transition/u
  );
  assert.match(
    source,
    /'reprovisioned', 'customer_cancelled', 'number_released',\s*'operator_correction'/u
  );
});
