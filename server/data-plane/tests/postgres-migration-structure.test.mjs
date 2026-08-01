import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);

async function migrations() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(new URL(name, migrationsDirectory), "utf8")
    }))
  );
}

function columns(list) {
  return list
    .split(",")
    .map((column) => column.trim().replaceAll('"', "").toLowerCase())
    .filter(Boolean);
}

test("PostgreSQL migrations never repeat a column inside one UNIQUE constraint", async () => {
  for (const migration of await migrations()) {
    for (const match of migration.sql.matchAll(/\bunique\s*\(([^)]+)\)/giu)) {
      const selected = columns(match[1]);
      assert.equal(
        new Set(selected).size,
        selected.length,
        `${migration.name} repeats a column in ${match[0]}`
      );
    }
  }
});

test("organizations relies on its primary key without a duplicate synthetic UNIQUE", async () => {
  const foundation = (await migrations()).find(
    ({ name }) => name === "202607280001_foundation.sql"
  );
  assert.ok(foundation);
  assert.match(
    foundation.sql,
    /create table ss\.organizations\s*\(\s*id uuid primary key/iu
  );
  assert.doesNotMatch(foundation.sql, /unique\s*\(\s*id\s*,\s*id\s*\)/iu);
});

test("hosted API migration is additive to the canonical ss schema", async () => {
  const hosted = (await migrations()).find(
    ({ name }) => name === "202607280007_hosted_api_edges.sql"
  );
  assert.ok(hosted);
  assert.doesNotMatch(hosted.sql, /\bss_hosted\b|runtime_state|runtime_revisions/iu);
  assert.doesNotMatch(
    hosted.sql,
    /create table ss\.(?:organizations|projects|project_drafts|site_versions|project_addresses|stripe_subscriptions|release_requests|support_tickets|export_requests|domain_quotes|domain_registrations)\b/iu
  );
  for (const table of [
    "hosted_account_profiles",
    "hosted_password_credentials",
    "hosted_sessions",
    "hosted_recovery_tokens",
    "catalog_offer_policies",
    "commerce_quotes",
    "checkout_quote_bindings",
    "subscription_cancellation_previews",
    "subscription_cancellation_acceptances",
    "export_download_authorizations"
  ]) {
    assert.match(hosted.sql, new RegExp(`create table ss\\.${table}\\b`, "iu"));
  }
  assert.match(
    hosted.sql,
    /tenure_id = 'own'[\s\S]*eligible_address_modes = array\['customer_owned'\]/iu
  );
  assert.match(
    hosted.sql,
    /tenure_id in \('rent', 'owned_managed'\)[\s\S]*array\['licensed', 'customer_owned'\]/iu
  );
});

test("first-party identity is explicit and does not require Supabase Auth", async () => {
  const all = await migrations();
  const identity = all.find(
    ({ name }) => name === "202607280000_first_party_identity.sql"
  );
  const machinery = all.find(
    ({ name }) =>
      name === "202607280008_first_party_runtime_machinery.sql"
  );
  assert.ok(identity);
  assert.ok(machinery);
  assert.match(identity.sql, /create table if not exists auth\.users/iu);
  assert.match(identity.sql, /auth_users_email_canonical/iu);
  assert.match(identity.sql, /force row level security/iu);
  assert.match(machinery.sql, /create table ss\.hosted_auth_rate_limits/iu);
  assert.match(machinery.sql, /reauthenticated_at timestamptz/iu);
  assert.doesNotMatch(
    `${identity.sql}\n${machinery.sql}`,
    /supabase auth|clerk/iu
  );
});

test("authenticated forced-RLS helpers have an explicit executable contract", async () => {
  const all = await migrations();
  const roleGrant = all.find(
    ({ name }) =>
      name === "202607280009_authenticated_rls_execution.sql"
  );
  assert.ok(roleGrant);
  for (const signature of [
    "ss.jwt_claims()",
    "ss.current_user_id()",
    "ss.current_org_id()",
    "ss.is_org_member(uuid)",
    "ss.has_org_role(uuid, text[])",
    "ss.can_access_org(uuid)"
  ]) {
    assert.match(
      roleGrant.sql,
      new RegExp(
        `grant execute on function ${signature
          .replaceAll(".", "\\.")
          .replaceAll("(", "\\(")
          .replaceAll(")", "\\)")
          .replaceAll("[", "\\[")
          .replaceAll("]", "\\]")}\\s+to authenticated`,
        "iu"
      )
    );
  }
});

test("hosted API edges participate in the sealed terminal purge boundary", async () => {
  const all = await migrations();
  const purge = all.find(
    ({ name }) =>
      name === "202607280010_hosted_edge_terminal_purge.sql"
  );
  assert.ok(purge);
  assert.match(purge.sql, /app\.terminal_purge_project_id/iu);
  assert.match(
    purge.sql,
    /request\.project_id = row_project_id[\s\S]*request\.state = 'purging'/iu
  );
  for (const table of [
    "subscription_cancellation_acceptances",
    "subscription_cancellation_previews",
    "checkout_quote_bindings",
    "commerce_quotes"
  ]) {
    assert.match(
      purge.sql,
      new RegExp(`delete from ss\\.${table}\\b`, "iu")
    );
  }
  assert.doesNotMatch(
    purge.sql,
    /disable trigger|session_replication_role/iu
  );
});

test("mixed one-time and recurring checkout uses normalized exact price lines", async () => {
  const all = await migrations();
  const pricing = all.find(
    ({ name }) =>
      name === "202607280011_multi_line_checkout_authority.sql"
  );
  assert.ok(pricing);
  for (const table of [
    "catalog_offer_price_lines",
    "commerce_quote_price_lines",
    "checkout_intent_price_lines"
  ]) {
    assert.match(
      pricing.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
  }
  assert.match(
    pricing.sql,
    /when 'owned_managed' then array\['one_time', 'recurring'\]/iu
  );
  assert.match(
    pricing.sql,
    /checkout does not bind the complete quote price set/iu
  );
  assert.match(
    pricing.sql,
    /checkout_record\.amount_minor <> amount_due_now/iu
  );
});

test("terminal deletion seals its ordered billing history as an array", async () => {
  const all = await migrations();
  const deletion = all.find(
    ({ name }) =>
      name === "202607280012_deletion_billing_snapshot_shape.sql"
  );
  assert.ok(deletion);
  assert.match(
    deletion.sql,
    /jsonb_typeof\(billing_timestamps\)\s*=\s*'array'/iu
  );
  assert.match(
    deletion.sql,
    /create function ss\.hosted_runtime_contract_v12\(\)/iu
  );
  assert.doesNotMatch(
    deletion.sql,
    /jsonb_typeof\(billing_timestamps\)\s*=\s*'object'/iu
  );
});

test("hosted payment control plane reconciles effects and models ownership without fake subscriptions", async () => {
  const all = await migrations();
  const payments = all.find(
    ({ name }) =>
      name ===
      "202607280013_hosted_payment_control_plane.sql"
  );
  assert.ok(payments);
  for (const table of [
    "site_ownership_entitlements",
    "site_ownership_entitlement_events",
    "billing_portal_sessions"
  ]) {
    assert.match(
      payments.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
  }
  assert.match(
    payments.sql,
    /provider_effect_certainty[\s\S]*'not_submitted'[\s\S]*'ambiguous'[\s\S]*'confirmed'/iu
  );
  assert.match(
    payments.sql,
    /subscription\.status in \('active', 'grace'\)[\s\S]*entitlement\.state = 'completed'/iu
  );
  assert.match(
    payments.sql,
    /create or replace function ss\.request_release/iu
  );
  assert.match(
    payments.sql,
    /create or replace function ss\.acknowledge_private_lifecycle/iu
  );
  assert.match(
    payments.sql,
    /create function ss\.hosted_runtime_contract_v13\(\)/iu
  );
  assert.doesNotMatch(
    payments.sql,
    /stripe_subscription_id[^;]*site_ownership_entitlements/iu
  );
});

test("export workers use one exact lease, attempt, fence, and bounded failure contract", async () => {
  const all = await migrations();
  const exports = all.find(
    ({ name }) =>
      name === "202607280015_export_worker_fencing.sql"
  );
  assert.ok(exports);
  for (const column of [
    "attempt_number",
    "fence_token",
    "worker_id",
    "lease_started_at",
    "lease_expires_at",
    "object_attempt_number",
    "object_fence_token",
    "failure_code",
    "failure_facts",
    "failed_at"
  ]) {
    assert.match(
      exports.sql,
      new RegExp(`add column ${column}\\b`, "iu")
    );
  }
  assert.match(
    exports.sql,
    /EXPORT_LEGACY_BUILD_ORPHANED[\s\S]*where state = 'building'/iu
  );
  assert.match(
    exports.sql,
    /pg_column_size\(failure_facts\)\s*<=\s*2048/iu
  );
  assert.match(
    exports.sql,
    /old\.lease_expires_at\s*>\s*new\.lease_started_at[\s\S]*active export lease cannot be stolen/iu
  );
  assert.match(
    exports.sql,
    /new\.attempt_number\s*<>\s*old\.attempt_number \+ 1[\s\S]*manual export retry must create one new attempt/iu
  );
  assert.match(
    exports.sql,
    /create function ss\.hosted_runtime_contract_v15\(\)/iu
  );
});

test("commerce v2 Download persistence is held, accepted-version-bound, service-only, and purge-safe", async () => {
  const all = await migrations();
  const commerce = all.find(
    ({ name }) =>
      name ===
      "202607280019_commerce_v2_download_preparation.sql"
  );
  assert.ok(commerce);

  for (const table of [
    "commerce_v2_commands",
    "commerce_v2_download_quotes",
    "commerce_v2_checkout_preparations"
  ]) {
    assert.match(
      commerce.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
    assert.match(
      commerce.sql,
      new RegExp(
        `alter table ss\\.${table}\\s+force row level security`,
        "iu"
      )
    );
  }

  assert.match(
    commerce.sql,
    /catalog_version\s+text not null[\s\S]*spark-actions\.2026-07-30\.v1/iu
  );
  assert.match(
    commerce.sql,
    /terms_version\s+text not null[\s\S]*spark-actions-held\.2026-07-30\.v1/iu
  );
  assert.match(
    commerce.sql,
    /amount_minor\s+integer not null[\s\S]*amount_minor = 500/iu
  );
  assert.match(
    commerce.sql,
    /state\s+text not null[\s\S]*state = 'held'/iu
  );
  assert.match(
    commerce.sql,
    /dispatch_authorized\s+boolean not null[\s\S]*dispatch_authorized = false/iu
  );
  assert.match(
    commerce.sql,
    /join ss\.fact_sets fact[\s\S]*fact\.content_digest\s*=\s*new\.version_content_digest/iu
  );
  assert.match(
    commerce.sql,
    /state\.state = 'accepted_release'/iu
  );
  assert.match(
    commerce.sql,
    /quote\.disclosure_digest\s*=\s*new\.accepted_disclosure_digest[\s\S]*quote\.snapshot_digest\s*=\s*new\.quote_snapshot_digest[\s\S]*new\.prepared_at < quote\.expires_at/iu
  );
  assert.match(
    commerce.sql,
    /from ss\.commerce_v2_download_quotes quote[\s\S]*project\.lifecycle = 'active'[\s\S]*organization\.state = 'active'[\s\S]*version_state\.state = 'accepted_release'[\s\S]*fact\.content_digest\s*=\s*quote\.version_content_digest/iu
  );
  assert.match(
    commerce.sql,
    /quote\.snapshot = new\.result[\s\S]*prep\.preparation = new\.result/iu
  );

  assert.match(
    commerce.sql,
    /create trigger deletion_requests_activate_commerce_v2_purge[\s\S]*before insert or update of state on ss\.deletion_requests/iu
  );
  assert.match(
    commerce.sql,
    /create trigger deletion_requests_purge_commerce_v2[\s\S]*after insert or update of state on ss\.deletion_requests/iu
  );
  assert.match(
    commerce.sql,
    /delete from ss\.commerce_v2_checkout_preparations[\s\S]*delete from ss\.commerce_v2_download_quotes[\s\S]*delete from ss\.commerce_v2_commands/iu
  );
  for (const count of [
    "commerceV2Commands",
    "commerceV2DownloadQuotes",
    "commerceV2CheckoutPreparations"
  ]) {
    assert.match(commerce.sql, new RegExp(`'${count}'`, "u"));
  }

  assert.match(
    commerce.sql,
    /revoke all on[\s\S]*ss\.commerce_v2_commands,[\s\S]*from public, anon, authenticated/iu
  );
  assert.match(
    commerce.sql,
    /grant all privileges on[\s\S]*ss\.commerce_v2_checkout_preparations[\s\S]*to service_role/iu
  );
  assert.match(
    commerce.sql,
    /create function ss\.hosted_runtime_contract_v19\(\)/iu
  );
  assert.doesNotMatch(
    commerce.sql,
    /\b(?:checkout_intents|stripe_[a-z_]+|provider_receipts|catalog_prices|site_ownership_entitlements|transactional_outbox)\b/iu
  );
  assert.doesNotMatch(
    commerce.sql,
    /\bprovider_(?:id|reference|receipt|url)\b/iu
  );
});

test("recovery delivery is reserved durably before a provider effect and terminal when ambiguous", async () => {
  const all = await migrations();
  const recovery = all.find(
    ({ name }) =>
      name ===
      "202607280020_recovery_delivery_fencing.sql"
  );
  assert.ok(recovery);
  assert.match(
    recovery.sql,
    /create table ss\.hosted_recovery_delivery_requests\b/iu
  );
  assert.match(
    recovery.sql,
    /state in \(\s*'pending_delivery',\s*'delivered',\s*'delivery_unknown'\s*\)/iu
  );
  assert.match(
    recovery.sql,
    /old\.state <> 'pending_delivery'[\s\S]*recovery delivery state is terminal/iu
  );
  assert.match(
    recovery.sql,
    /force row level security[\s\S]*revoke all on ss\.hosted_recovery_delivery_requests[\s\S]*from public, anon, authenticated/iu
  );
  assert.match(
    recovery.sql,
    /create function ss\.hosted_runtime_contract_v20\(\)/iu
  );
  assert.doesNotMatch(
    recovery.sql,
    /^\s*(?:recipient|recovery_url|token_digest|action_url)\s+[a-z]/imu
  );
});
