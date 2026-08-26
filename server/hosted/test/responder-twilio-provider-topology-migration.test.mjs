import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../data-plane/supabase/migrations/202608260146_responder_twilio_isv_provider_topology.sql",
  import.meta.url
);

test("FIN-013 topology is digest-only, customer-isolated, and durable", async () => {
  const source = await readFile(MIGRATION, "utf8");
  for (const required of [
    /^-- FIN-013-RESPONDER-TWILIO-ISV-TOPOLOGY-01[\s\S]*\nbegin;/u,
    /create table ss\.responder_twilio_provider_topologies/u,
    /account_sid_digest ss\.sha256_hex not null/u,
    /customer_profile_sid_digest ss\.sha256_hex not null/u,
    /brand_registration_sid_digest ss\.sha256_hex not null/u,
    /campaign_sid_digest ss\.sha256_hex not null/u,
    /messaging_api_key_sid_digest ss\.sha256_hex not null/u,
    /messaging_api_key_secret_digest ss\.sha256_hex not null/u,
    /webhook_auth_token_digest ss\.sha256_hex not null/u,
    /voice_api_key_sid_digest ss\.sha256_hex not null/u,
    /voice_api_key_secret_digest ss\.sha256_hex not null/u,
    /registration_class in \(\s*'STANDARD', 'LOW_VOLUME_STANDARD', 'SOLE_PROPRIETOR'/u,
    /responder_twilio_one_active_topology_per_customer/u,
    /responder_twilio_one_active_subaccount/u,
    /responder_twilio_one_active_messaging_service/u,
    /responder_twilio_one_active_customer_profile/u,
    /responder_twilio_one_active_brand/u,
    /responder_twilio_one_active_campaign/u,
    /responder_twilio_one_active_messaging_api_key/u,
    /responder_twilio_one_active_webhook_token/u,
    /responder_twilio_one_active_voice_api_key/u,
    /responder-twilio-api-key:/u,
    /Twilio customer resource is already active elsewhere/u,
    /Retire active customer number bindings before topology/u,
    /selected_kind <> 'operator'/u,
    /service_operator_has_capability/u,
    /topology\.account_sid_digest = new\.account_sid_digest/u,
    /matching active customer topology/u,
    /Existing active Responder number binding lacks customer topology/u,
    /force row level security/u,
    /canonical-responder-twilio-isv-topology-v1-customer-subaccount/u,
    /commit;\s*$/u
  ]) assert.match(source, required);
  for (const forbidden of [
    /\baccount_sid text\b/iu,
    /\bauth_token\b/iu,
    /\bapi_key_secret\b/iu,
    /\bphone_number text\b/iu,
    /grant (?:select|insert|update|delete)[^;]*\b(?:anon|authenticated)\b/iu,
    /insert into ss\.responder_runtime_controls[\s\S]*approved_live/u
  ]) assert.doesNotMatch(source, forbidden);
});

test("only exact retirement can mutate a topology", async () => {
  const source = await readFile(MIGRATION, "utf8");
  assert.match(source, /state in \('active', 'retired'\)/u);
  assert.match(source, /Responder Twilio provider topology is durable/u);
  assert.match(source, /Responder Twilio topology retirement is the only transition/u);
  assert.match(source, /new\.revision <> old\.revision \+ 1/u);
});
