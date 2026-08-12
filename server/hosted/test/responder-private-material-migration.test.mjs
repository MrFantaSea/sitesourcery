import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../data-plane/supabase/migrations/202608120126_responder_private_delivery_material.sql",
  import.meta.url
);

test("RESPONDER-PRIVATE-MATERIAL-01 is encrypted, operation-bound, forced-RLS, and system-only", async () => {
  const source = await readFile(MIGRATION, "utf8");
  for (const required of [
    /create table ss\.responder_private_delivery_materials/u,
    /operation_id uuid primary key/u,
    /nonce bytea/u,
    /authentication_tag bytea/u,
    /ciphertext bytea/u,
    /state text not null check \(state in \('active', 'destroyed'\)\)/u,
    /references ss\.responder_delivery_operations\(organization_id, id\)/u,
    /current_service_actor_kind\(\) <> 'system'/u,
    /current_service_actor_org_id\(\) is distinct from new\.organization_id/u,
    /alter table ss\.responder_private_delivery_materials force row level security/u,
    /revoke all on ss\.responder_private_delivery_materials\s+from public, anon, authenticated, service_role/iu,
    /canonical-responder-private-material-v1-operation-bound-aes-gcm/u
  ]) {
    assert.match(source, required);
  }
  for (const forbidden of [
    /phone_number/iu,
    /message_body/iu,
    /recipient text/iu,
    /body text/iu,
    /grant (?:select|insert|update|delete)[^;]*\b(?:anon|authenticated)\b/iu
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test("private material can only become cryptographically destroyed", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(source, /tg_op = 'DELETE'/u);
  assert.match(source, /old\.state <> 'active'/u);
  assert.match(source, /new\.state <> 'destroyed'/u);
  assert.match(source, /nonce is null and authentication_tag is null and ciphertext is null/u);
  assert.match(source, /destroy_reason is not null and destroyed_at is not null/u);
  assert.doesNotMatch(source, /or new\.state = 'active'/u);
});
