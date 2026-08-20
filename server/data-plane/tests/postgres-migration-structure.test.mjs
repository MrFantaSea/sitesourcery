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

test("TAX-PURPOSE-01 is additive at migration 109 and fails closed for disabled tax receipts", async () => {
  const selected = await migrations();
  const migration = selected.find(
    ({ name }) =>
      name ===
      "202608100109_stripe_tax_purpose_authority.sql"
  );
  assert.ok(migration, "missing TAX-PURPOSE-01 migration 109");
  assert.match(migration.sql, /^-- TAX-PURPOSE-01[\s\S]*\bbegin;/iu);
  assert.match(migration.sql, /commit;\s*$/iu);
  for (const table of [
    "service_assessment_checkout_attempts",
    "service_assessment_payment_receipts",
    "service_custom_build_checkout_attempts",
    "service_custom_build_payment_receipts",
    "service_custom_build_change_checkout_attempts",
    "service_custom_build_change_payment_receipts",
    "service_custom_build_final_checkout_attempts",
    "service_custom_build_final_payment_receipts"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`alter table ss\\.${table}\\b`, "iu")
    );
  }
  assert.equal(
    [...migration.sql.matchAll(
      /check \(tax_mode in \('automatic', 'disabled_by_owner'\)\)/giu
    )].length,
    8
  );
  assert.equal(
    [...migration.sql.matchAll(
      /check \(tax_mode = 'automatic' or tax_minor = 0\)/giu
    )].length,
    4
  );
  assert.doesNotMatch(
    migration.sql,
    /create table|drop table|provider_effects_authorized|commercial_cutover/u
  );
  const names = selected.map(({ name }) => name);
  assert.equal(
    names.filter((name) =>
      /^20260810010[6-9]_/u.test(name)
    ).at(-1),
    "202608100109_stripe_tax_purpose_authority.sql"
  );
});

test("CUSTOM-DIRECT-01 is additive at migration 113 and preserves exact optional-credit authority", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name ===
      "202608100113_custom_direct_opportunity.sql"
  );
  assert.ok(migration, "missing CUSTOM-DIRECT-01 migration 113");
  assert.match(migration.sql, /^-- CUSTOM-DIRECT-01[\s\S]*\bbegin;/iu);
  assert.match(migration.sql, /commit;\s*$/iu);
  assert.match(
    migration.sql,
    /create table ss\.service_custom_build_direct_opportunities/iu
  );
  assert.match(
    migration.sql,
    /provenance = 'direct_custom_inquiry'/iu
  );
  assert.match(
    migration.sql,
    /credit_selection in \('no_credit', 'apply_assessment_credit'\)/iu
  );
  assert.match(
    migration.sql,
    /credit_amount_minor in \(0, 20000\)/iu
  );
  assert.match(
    migration.sql,
    /invoice\.credit_minor = 0 and application\.id is null/iu
  );
  assert.match(
    migration.sql,
    /create function ss\.lock_service_custom_build_checkout_invoice\([\s\S]*?security definer[\s\S]*?for update of quote/iu
  );
  assert.match(
    migration.sql,
    /revoke all on function ss\.lock_service_custom_build_checkout_invoice\([\s\S]*?from public, anon, authenticated, service_role;[\s\S]*?grant execute on function ss\.lock_service_custom_build_checkout_invoice\([\s\S]*?to service_role;/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /automatic_tax|provider_effects_authorized|commercial_cutover/iu
  );
});

test("Alakazam 35 migration is additive, held, append-only, and exact-authority bound", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name ===
      "202608080102_alakazam_35_fulfillment.sql"
  );
  assert.ok(migration, "missing F03 Alakazam 35 fulfillment migration");
  assert.match(migration.sql, /^begin;/iu);
  assert.match(migration.sql, /commit;\s*$/iu);
  assert.match(
    migration.sql,
    /hosted_runtime_contract_v33\(\)[\s\S]*hosted_runtime_contract_v47\(\)/iu
  );
  for (const table of [
    "alakazam_35_photo_assets",
    "alakazam_35_configurations",
    "alakazam_35_care_requests"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
  }
  for (const functionName of [
    "validate_alakazam_35_subscription_authority",
    "validate_alakazam_35_photo_asset",
    "validate_alakazam_35_configuration",
    "validate_alakazam_35_care_request",
    "reject_alakazam_35_evidence_mutation"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`create function ss\\.${functionName}\\(`, "iu")
    );
  }
  assert.match(
    migration.sql,
    /subscription\.status in \('active', 'grace'\)[\s\S]*alakazam_tier_rank\(subscription\.tier_id\) >= 2/iu
  );
  assert.match(
    migration.sql,
    /alter table ss\.%I enable row level security[\s\S]*alter table ss\.%I force row level security/iu
  );
  assert.match(
    migration.sql,
    /commercial_cutover_not_authorized/iu
  );
  assert.match(
    migration.sql,
    /grant select, insert on ss\.%I to service_role/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /grant[^;]*(?:update|delete|truncate)[^;]*to service_role/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /stripe\.com|provider_effects_authorized\s*=\s*true|state\s*=\s*'released'/iu
  );
});

test("Alakazam 50 migration is additive, held, append-only, and exact-tier bound", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name === "202608080103_alakazam_50_authority.sql"
  );
  assert.ok(migration, "missing F04 Alakazam 50 authority migration");
  assert.match(migration.sql, /^begin;/iu);
  assert.match(migration.sql, /commit;\s*$/iu);
  assert.match(
    migration.sql,
    /hosted_runtime_contract_v33\(\)[\s\S]*hosted_runtime_contract_v47\(\)/iu
  );
  for (const table of [
    "alakazam_50_configurations",
    "alakazam_50_care_requests"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
  }
  for (const functionName of [
    "valid_alakazam_50_menu",
    "validate_alakazam_50_subscription_authority",
    "validate_alakazam_50_configuration",
    "validate_alakazam_50_care_request",
    "reject_alakazam_50_evidence_mutation"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`create function ss\\.${functionName}\\(`, "iu")
    );
  }
  assert.match(
    migration.sql,
    /subscription\.status in \('active', 'grace'\)[\s\S]*subscription\.tier_id = 'alakazam_50'/iu
  );
  assert.match(
    migration.sql,
    /cash_app_handle[\s\S]*venmo_handle[\s\S]*font_choice_id[\s\S]*border_choice_id[\s\S]*menu jsonb/iu
  );
  assert.match(migration.sql, /commercial_cutover_not_authorized/iu);
  assert.match(
    migration.sql,
    /grant select, insert on ss\.%I to service_role/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /grant[^;]*(?:update|delete|truncate)[^;]*to service_role/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /stripe\.com|provider_effects_authorized\s*=\s*true|state\s*=\s*'released'/iu
  );
});

test("retained Alakazam premium state is fenced, held, and purge bounded", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name ===
      "202608090104_alakazam_retained_premium_state.sql"
  );
  assert.ok(migration, "missing F06 retained premium migration");
  assert.match(migration.sql, /^begin;/iu);
  assert.match(migration.sql, /commit;\s*$/iu);
  assert.match(
    migration.sql,
    /hosted_runtime_contract_v51\(\)[\s\S]*hosted_runtime_contract_v52\(\)[\s\S]*hosted_alakazam_35_contract\(\)[\s\S]*hosted_alakazam_50_contract\(\)/iu
  );
  for (const table of [
    "alakazam_premium_retention_windows",
    "alakazam_50_premium_restorations",
    "alakazam_premium_purge_receipts"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
  }
  assert.match(
    migration.sql,
    /SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1/iu
  );
  assert.match(
    migration.sql,
    /payment_grace_expired[\s\S]*interval '7 days'[\s\S]*interval '30 days'/iu
  );
  assert.match(
    migration.sql,
    /reason in \([\s\S]*'terminal_customer_deletion'[\s\S]*'retained_exit_expiry'[\s\S]*\)/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /reason in \([\s\S]*'payment_grace_expiry'/iu
  );
  assert.match(
    migration.sql,
    /source_configuration_digest[\s\S]*downgrade_event_digest[\s\S]*upgrade_event_digest[\s\S]*provider_facts_digest[\s\S]*evidence_digest/iu
  );
  assert.match(
    migration.sql,
    /constraint alakazam_premium_restore_command_binding_check[\s\S]*restored_configuration_id = id/iu
  );
  assert.match(
    migration.sql,
    /downgrade_record\.event_kind <> 'downgrade_applied'[\s\S]*upgrade_record\.event_kind <> 'upgrade_applied'[\s\S]*upgrade_record\.stripe_event_row_id is null/iu
  );
  assert.match(
    migration.sql,
    /create or replace function ss\.validate_alakazam_35_subscription_authority[\s\S]*subscription\.status = 'active'/iu
  );
  assert.match(
    migration.sql,
    /create or replace function ss\.validate_alakazam_50_subscription_authority[\s\S]*subscription\.status = 'active'/iu
  );
  assert.match(
    migration.sql,
    /create function ss\.reject_nonactive_alakazam_publication[\s\S]*subscription\.status = 'active'[\s\S]*alakazam_customer_publication_commands_00_active/iu
  );
  assert.match(
    migration.sql,
    /app\.terminal_purge_project_id[\s\S]*app\.alakazam_premium_purge_project_id[\s\S]*deletion_requests_00_purge_alakazam_tier_data/iu
  );
  assert.match(
    migration.sql,
    /grant select, insert on ss\.alakazam_50_premium_restorations[\s\S]*grant select on ss\.alakazam_premium_purge_receipts[\s\S]*grant select on ss\.alakazam_premium_retention_windows/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /grant[^;]*(?:update|delete|truncate)[^;]*to service_role|provider_effects_authorized\s*=\s*true|state\s*=\s*'released'/iu
  );
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

test("commerce v2 Download settlement fences one exact $5 Stripe effect and project entitlement", async () => {
  const all = await migrations();
  const settlement = all.find(
    ({ name }) =>
      name ===
      "202608020022_commerce_v2_download_settlement.sql"
  );
  assert.ok(settlement);

  for (const table of [
    "commerce_v2_download_dispatches",
    "commerce_v2_download_stripe_events",
    "commerce_v2_download_payment_receipts",
    "commerce_v2_project_entitlements",
    "commerce_v2_download_reversal_events"
  ]) {
    assert.match(
      settlement.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
    assert.match(
      settlement.sql,
      new RegExp(
        `alter table ss\\.${table}\\s+force row level security`,
        "iu"
      )
    );
  }

  assert.match(
    settlement.sql,
    /state in \(\s*'dispatching',[\s\S]*'effect_unknown',[\s\S]*'settled'/iu
  );
  assert.match(
    settlement.sql,
    /create unique index commerce_v2_download_one_open_payment[\s\S]*organization_id,[\s\S]*project_id[\s\S]*where state in/iu
  );
  assert.match(
    settlement.sql,
    /lease_expires_at <>[\s\S]*created_at \+ interval '2 minutes'/iu
  );
  assert.match(
    settlement.sql,
    /quote\.amount_minor = 500[\s\S]*quote\.currency = 'USD'[\s\S]*quote\.billing = 'one_time'/iu
  );
  assert.match(
    settlement.sql,
    /event_type text not null[\s\S]*checkout\.session\.completed/iu
  );
  assert.match(
    settlement.sql,
    /Download receipt requires provider readback for one pending verified event/iu
  );
  assert.match(
    settlement.sql,
    /payment_status text not null[\s\S]*payment_status = 'paid'[\s\S]*amount_minor integer not null[\s\S]*amount_minor = 500[\s\S]*tax_minor integer not null[\s\S]*total_minor = amount_minor \+ tax_minor[\s\S]*currency text not null check \(currency = 'USD'\)/iu
  );
  assert.match(
    settlement.sql,
    /kind text not null check \(kind = 'spark_download'\)[\s\S]*scope text not null check \(scope = 'editor_project'\)[\s\S]*state in \('active', 'suspended', 'revoked'\)[\s\S]*expires_at timestamptz[\s\S]*expires_at is null/iu
  );
  assert.match(
    settlement.sql,
    /unique \(organization_id, project_id, kind\)/iu
  );
  for (const count of [
    "commerceV2DownloadDispatches",
    "commerceV2DownloadStripeEvents",
    "commerceV2DownloadPaymentReceipts",
    "commerceV2ProjectEntitlements",
    "commerceV2DownloadReversalEvents"
  ]) {
    assert.match(
      settlement.sql,
      new RegExp(`'${count}'`, "u")
    );
  }
  assert.match(
    settlement.sql,
    /revoke all on[\s\S]*commerce_v2_download_dispatches,[\s\S]*commerce_v2_project_entitlements[\s\S]*from public, anon, authenticated/iu
  );
  assert.match(
    settlement.sql,
    /charge\.refunded[\s\S]*charge\.dispute\.created[\s\S]*payment_fully_refunded[\s\S]*payment_dispute_lost/iu
  );
  assert.match(
    settlement.sql,
    /entitlement\.state = new\.prior_state[\s\S]*entitlement\.state_reason = new\.prior_reason/iu
  );
  assert.match(
    settlement.sql,
    /when resulting_state = prior_state\s+then prior_reason\s+else reason/iu
  );
  assert.doesNotMatch(
    settlement.sql,
    /then result ->> 'reason'/iu
  );
  assert.match(
    settlement.sql,
    /create function ss\.hosted_runtime_contract_v22\(\)/iu
  );
  assert.doesNotMatch(
    settlement.sql,
    /recurring|monthly/iu
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

test("hosted legal authority is bound to the exact reviewed V2 artifacts", async () => {
  const all = await migrations();
  const legal = all.find(
    ({ name }) =>
      name ===
      "202608010021_hosted_legal_authority.sql"
  );
  assert.ok(legal);
  assert.match(
    legal.sql,
    /create function ss\.hosted_runtime_contract_v21\(\)/iu
  );
  assert.match(
    legal.sql,
    /SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2/iu
  );
  assert.match(
    legal.sql,
    /SS-HOSTED-PRIVACY-2026-07-30-V2/iu
  );
  assert.match(
    legal.sql,
    /bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196/iu
  );
  assert.match(
    legal.sql,
    /b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b/iu
  );
});

test("Alakazam billing stores exact tier value and evidence-gated transitions", async () => {
  const all = await migrations();
  const alakazam = all.find(
    ({ name }) =>
      name ===
      "202608020023_alakazam_subscription_contract.sql"
  );
  assert.ok(alakazam);

  for (const table of [
    "alakazam_subscriptions",
    "alakazam_change_quotes",
    "alakazam_checkout_dispatches",
    "alakazam_stripe_events",
    "alakazam_payment_receipts",
    "alakazam_credit_applications",
    "alakazam_downgrade_schedules",
    "alakazam_tier_change_events"
  ]) {
    assert.match(
      alakazam.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
  }

  assert.match(
    alakazam.sql,
    /tables text\[\] := array\[[\s\S]*'alakazam_subscriptions'[\s\S]*'alakazam_tier_change_events'/iu
  );
  assert.match(
    alakazam.sql,
    /alter table ss\.%I enable row level security[\s\S]*alter table ss\.%I force row level security[\s\S]*revoke all on ss\.%I from public, anon, authenticated/iu
  );

  assert.match(
    alakazam.sql,
    /when 'alakazam_25' then 2500::bigint[\s\S]*when 'alakazam_35' then 3500::bigint[\s\S]*when 'alakazam_50' then 5000::bigint/iu
  );
  assert.match(
    alakazam.sql,
    /due_now_subtotal_minor =\s*target_amount_minor - current_amount_minor/iu
  );
  assert.match(
    alakazam.sql,
    /change_kind = 'downgrade'[\s\S]*due_now_subtotal_minor = 0[\s\S]*effective_rule = 'current_period_end'[\s\S]*no_mid_period_refund[\s\S]*not provider_proration_enabled/iu
  );
  assert.match(
    alakazam.sql,
    /create unique index alakazam_one_event_per_revision/iu
  );
  assert.match(
    alakazam.sql,
    /Alakazam subscription change lacks exact revision evidence/iu
  );
  assert.match(
    alakazam.sql,
    /Alakazam credit reversal lacks exact defensive evidence/iu
  );
  assert.match(
    alakazam.sql,
    /create function ss\.hosted_runtime_contract_v23\(\)/iu
  );
  assert.doesNotMatch(
    alakazam.sql,
    /refund_(?:button|request|offer)|create_refund/iu
  );
});

test("Alakazam direct-start Customer creation is durably reserved and evidence-bound", async () => {
  const all = await migrations();
  const provisioning = all.find(
    ({ name }) =>
      name ===
      "202608020024_alakazam_customer_provisioning.sql"
  );
  assert.ok(provisioning);
  assert.match(
    provisioning.sql,
    /create table ss\.alakazam_customer_provisions\b/iu
  );
  assert.match(
    provisioning.sql,
    /state in \([\s\S]*'reserved'[\s\S]*'confirmed'[\s\S]*'reconciliation_required'/iu
  );
  assert.match(
    provisioning.sql,
    /create constraint trigger alakazam_customer_provisions_binding[\s\S]*deferrable initially deferred/iu
  );
  assert.match(
    provisioning.sql,
    /old\.state = 'reserved'[\s\S]*new\.state in \([\s\S]*'confirmed'[\s\S]*'reconciliation_required'/iu
  );
  assert.match(
    provisioning.sql,
    /old\.state = 'reconciliation_required'[\s\S]*new\.state = 'confirmed'/iu
  );
  assert.match(
    provisioning.sql,
    /lease_expires_at <>[\s\S]*created_at \+ interval '2 minutes'/iu
  );
  assert.match(
    provisioning.sql,
    /commerce_v2_download_dispatches_alakazam_customer_guard/iu
  );
  assert.match(
    provisioning.sql,
    /create function ss\.hosted_runtime_contract_v24\(\)/iu
  );
  assert.doesNotMatch(
    provisioning.sql,
    /\b(?:email|name|phone|address)\b/iu
  );
});

test("Alakazam Checkout dispatch is leased, exact-purpose-bound, and no-retry", async () => {
  const all = await migrations();
  const dispatch = all.find(
    ({ name }) =>
      name ===
      "202608020025_alakazam_checkout_dispatch.sql"
  );
  assert.ok(dispatch);
  assert.match(
    dispatch.sql,
    /add column lease_expires_at timestamptz/iu
  );
  assert.match(
    dispatch.sql,
    /create unique index alakazam_one_open_checkout_per_project[\s\S]*'reserved'[\s\S]*'ready'[\s\S]*'persistence_unknown'/iu
  );
  assert.match(
    dispatch.sql,
    /new\.purpose <> expected_purpose/iu
  );
  assert.match(
    dispatch.sql,
    /old\.state = 'reserved'[\s\S]*'ready', 'failed', 'persistence_unknown'/iu
  );
  assert.match(
    dispatch.sql,
    /durable Alakazam Checkout evidence is immutable/iu
  );
  assert.match(
    dispatch.sql,
    /create function ss\.hosted_runtime_contract_v25\(\)/iu
  );
});

test("Alakazam payment settlement permits one event, quote receipt, and PaymentIntent", async () => {
  const all = await migrations();
  const settlement = all.find(
    ({ name }) =>
      name ===
      "202608020026_alakazam_payment_settlement.sql"
  );
  assert.ok(settlement);
  assert.match(
    settlement.sql,
    /create unique index alakazam_one_checkout_completion_event[\s\S]*provider_object_id[\s\S]*event_type[\s\S]*checkout\.session\.completed/iu
  );
  assert.match(
    settlement.sql,
    /create unique index alakazam_one_quote_payment_receipt[\s\S]*organization_id[\s\S]*quote_id[\s\S]*where quote_id is not null/iu
  );
  assert.match(
    settlement.sql,
    /create unique index alakazam_one_payment_intent_receipt[\s\S]*stripe_payment_intent_id/iu
  );
  assert.match(
    settlement.sql,
    /create function ss\.hosted_runtime_contract_v26\(\)/iu
  );
});

test("Alakazam start activation is one exact subscription transition", async () => {
  const all = await migrations();
  const activation = all.find(
    ({ name }) =>
      name ===
      "202608040027_alakazam_start_activation.sql"
  );
  assert.ok(activation);
  assert.match(
    activation.sql,
    /create unique index alakazam_one_start_activation[\s\S]*alakazam_tier_change_events\(subscription_id\)[\s\S]*where event_kind = 'start_applied'/iu
  );
  assert.match(
    activation.sql,
    /create function ss\.hosted_runtime_contract_v27\(\)/iu
  );
});

test("Alakazam paid upgrade application is fenced before provider mutation", async () => {
  const all = await migrations();
  const upgrade = all.find(
    ({ name }) =>
      name ===
      "202608040028_alakazam_upgrade_application.sql"
  );
  assert.ok(upgrade);
  assert.match(
    upgrade.sql,
    /create table ss\.alakazam_upgrade_applications/iu
  );
  assert.match(
    upgrade.sql,
    /create unique index alakazam_one_open_upgrade_application[\s\S]*where state in/iu
  );
  assert.match(
    upgrade.sql,
    /provider_idempotency_key =[\s\S]*'alakazam:upgrade:apply:'/iu
  );
  assert.match(
    upgrade.sql,
    /create function ss\.hosted_runtime_contract_v28\(\)/iu
  );
});

test("Alakazam paid upgrade activation is one atomic local revision", async () => {
  const all = await migrations();
  const activation = all.find(
    ({ name }) =>
      name ===
      "202608040029_alakazam_upgrade_activation.sql"
  );
  assert.ok(activation);
  assert.match(
    activation.sql,
    /create unique index alakazam_one_upgrade_activation[\s\S]*alakazam_tier_change_events\(quote_id\)[\s\S]*where event_kind = 'upgrade_applied'/iu
  );
  assert.match(
    activation.sql,
    /create constraint trigger alakazam_upgrade_activations_validate[\s\S]*deferrable initially deferred/iu
  );
  assert.match(
    activation.sql,
    /create function ss\.hosted_runtime_contract_v29\(\)/iu
  );
});

test("Alakazam downgrade Schedule dispatch is durable and atomic", async () => {
  const all = await migrations();
  const downgrade = all.find(
    ({ name }) =>
      name ===
      "202608040030_alakazam_downgrade_schedule_dispatch.sql"
  );
  assert.ok(downgrade);
  assert.match(
    downgrade.sql,
    /provider_idempotency_key =[\s\S]*'alakazam:downgrade:schedule:'/iu
  );
  assert.match(
    downgrade.sql,
    /create unique index alakazam_one_downgrade_schedule_event[\s\S]*where event_kind = 'downgrade_scheduled'/iu
  );
  assert.match(
    downgrade.sql,
    /create constraint trigger alakazam_downgrade_dispatches_validate[\s\S]*deferrable initially deferred/iu
  );
  assert.match(
    downgrade.sql,
    /create function ss\.hosted_runtime_contract_v30\(\)/iu
  );
});

test("Alakazam downgrade activation is one atomic boundary revision", async () => {
  const all = await migrations();
  const activation = all.find(
    ({ name }) =>
      name ===
      "202608040031_alakazam_downgrade_activation.sql"
  );
  assert.ok(activation);
  assert.match(
    activation.sql,
    /create unique index alakazam_one_downgrade_activation[\s\S]*where event_kind = 'downgrade_applied'/iu
  );
  assert.match(
    activation.sql,
    /create constraint trigger alakazam_downgrade_activations_validate[\s\S]*deferrable initially deferred/iu
  );
  assert.match(
    activation.sql,
    /create function ss\.hosted_runtime_contract_v31\(\)/iu
  );
});

test("Alakazam fulfillment freezes intent and active-revision operation evidence", async () => {
  const all = await migrations();
  const fulfillment = all.find(
    ({ name }) =>
      name ===
      "202608040032_alakazam_fulfillment_foundation.sql"
  );
  assert.ok(fulfillment);
  assert.match(
    fulfillment.sql,
    /create table ss\.alakazam_fulfillment_intents[\s\S]*unique \(quote_id\)/iu
  );
  assert.match(
    fulfillment.sql,
    /create table ss\.alakazam_fulfillment_operations[\s\S]*unique \([\s\S]*subscription_id,[\s\S]*subscription_revision,[\s\S]*operation_kind[\s\S]*\)/iu
  );
  assert.match(
    fulfillment.sql,
    /create constraint trigger alakazam_fulfillment_intents_validate[\s\S]*deferrable initially deferred/iu
  );
  assert.match(
    fulfillment.sql,
    /quote\.provider_effects_authorized[\s\S]*new\.prepared_at >= quote\.issued_at[\s\S]*new\.prepared_at < quote\.expires_at/iu
  );
  assert.match(
    fulfillment.sql,
    /create or replace function ss\.validate_release_screening\(\)[\s\S]*new\.method = 'alakazam_effective_policy'[\s\S]*operation\.effective_artifact_digest[\s\S]*new\.artifact_digest/iu
  );
  assert.match(
    fulfillment.sql,
    /create constraint trigger alakazam_fulfillment_operations_validate[\s\S]*deferrable initially deferred/iu
  );
  assert.match(
    fulfillment.sql,
    /create function ss\.hosted_runtime_contract_v32\(\)/iu
  );
});

test("Alakazam tier fulfillment reuses one site with exact applied-revision evidence", async () => {
  const all = await migrations();
  const fulfillment = all.find(
    ({ name }) =>
      name ===
      "202608040033_alakazam_tier_fulfillment.sql"
  );
  assert.ok(fulfillment);
  assert.match(
    fulfillment.sql,
    /operation_kind in \([\s\S]*'start_activation',[\s\S]*'tier_transition'[\s\S]*\)/iu
  );
  assert.match(
    fulfillment.sql,
    /new\.operation_kind = 'tier_transition'[\s\S]*intent\.state = 'completed'[\s\S]*tier_event\.result_subscription_revision =[\s\S]*new\.subscription_revision/iu
  );
  assert.match(
    fulfillment.sql,
    /tier_event\.event_kind = 'upgrade_applied'[\s\S]*quote\.change_kind = 'upgrade'[\s\S]*tier_event\.event_kind = 'downgrade_applied'[\s\S]*quote\.change_kind = 'downgrade'/iu
  );
  assert.match(
    fulfillment.sql,
    /create function ss\.hosted_runtime_contract_v33\(\)/iu
  );
});

test("custom-services foundation is typed, pre-commerce, and actor-bound", async () => {
  const all = await migrations();
  const foundation = all.find(
    ({ name }) =>
      name ===
      "202608050034_custom_services_foundation.sql"
  );
  assert.ok(foundation);

  for (const table of [
    "service_catalog_policies",
    "service_catalog_coverage",
    "service_project_profiles",
    "operator_profiles",
    "operator_permissions",
    "service_cases",
    "service_case_offerings",
    "service_intakes",
    "service_documents",
    "service_access_requests"
  ]) {
    assert.ok(
      foundation.sql.includes("create table ss." + table + " ("),
      `migration 034 is missing ${table}`
    );
    assert.ok(
      foundation.sql.includes("'" + table + "'"),
      `migration 034 does not seal ${table}`
    );
  }

  assert.match(
    foundation.sql,
    /'website_assessment_standard'[\s\S]*20000[\s\S]*'held'/iu
  );
  assert.match(
    foundation.sql,
    /'custom_services'[\s\S]*'SS-CUSTOM-SERVICES-2026-08-05\.1'[\s\S]*9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8/iu
  );
  assert.match(
    foundation.sql,
    /'maximumFindings', 10[\s\S]*'maximumRepresentativePagesOrTypes', 5[\s\S]*'maximumWebsites', 1[\s\S]*jsonb_build_array\('desktop', 'phone'\)/iu
  );
  assert.match(
    foundation.sql,
    /origin = 'external'[\s\S]*takeover_required[\s\S]*takeover_state = 'review_required'[\s\S]*supportability_state = 'not_reviewed'/iu
  );
  assert.match(
    foundation.sql,
    /join ss\.projects project[\s\S]*organization\.state = 'active'[\s\S]*project\.lifecycle = 'active'[\s\S]*membership\.state = 'active'[\s\S]*account_profile\.state = 'active'/iu
  );
  assert.match(
    foundation.sql,
    /create function ss\.current_service_actor_kind\(\)[\s\S]*app\.service_actor_kind/iu
  );
  assert.match(
    foundation.sql,
    /create function ss\.validate_service_account_authority\(\)[\s\S]*current_service_actor_kind\(\) <> 'customer'[\s\S]*current_service_actor_user_id\(\)[\s\S]*current_service_actor_org_id\(\)/iu
  );

  const intakeTable = foundation.sql.match(
    /create table ss\.service_intakes \([\s\S]*?\n\);/iu
  )?.[0];
  const caseTable = foundation.sql.match(
    /create table ss\.service_cases \([\s\S]*?\n\);/iu
  )?.[0];
  const offeringTable = foundation.sql.match(
    /create table ss\.service_case_offerings \([\s\S]*?\n\);/iu
  )?.[0];
  const accessTable = foundation.sql.match(
    /create table ss\.service_access_requests \([\s\S]*?\n\);/iu
  )?.[0];
  assert.ok(intakeTable);
  assert.ok(caseTable);
  assert.ok(offeringTable);
  assert.ok(accessTable);

  assert.match(
    intakeTable,
    /site_display_name text[\s\S]*public_scheme text[\s\S]*public_hostname ss\.canonical_hostname[\s\S]*primary_goal text[\s\S]*complexity_flags text\[\][\s\S]*customer_ownership_affirmed boolean/iu
  );
  assert.doesNotMatch(intakeTable, /\bjsonb\b/iu);
  assert.doesNotMatch(intakeTable, /customer_asserted_facts/iu);
  assert.match(
    intakeTable,
    /facts_digest ss\.sha256_hex generated always as/iu
  );
  assert.match(caseTable, /state in \('draft', 'submitted', 'withdrawn'\)/iu);
  assert.doesNotMatch(caseTable, /\b(?:quoted|paid|active|completed)\b/iu);
  assert.match(offeringTable, /state in \('requested', 'removed'\)/iu);
  assert.doesNotMatch(offeringTable, /\b(?:accepted|quoted|paid|completed)\b/iu);
  assert.match(accessTable, /state = 'drafted'/iu);
  assert.doesNotMatch(
    accessTable,
    /\b(?:sent|customer_confirmed|operator_verified|revoked)\b/iu
  );
  assert.doesNotMatch(
    accessTable,
    /\b(?:password|passcode|secret|api_key|access_token|recovery_code|credential_payload)\s+(?:text|jsonb|bytea)\b/iu
  );

  assert.doesNotMatch(foundation.sql, /on delete cascade/iu);
  assert.doesNotMatch(foundation.sql, /grant all privileges/iu);
  assert.match(
    foundation.sql,
    /alter table ss\.%I enable row level security[\s\S]*alter table ss\.%I force row level security[\s\S]*revoke all on table ss\.%I from public, anon, authenticated, service_role/iu
  );
  assert.match(
    foundation.sql,
    /grant insert, update on table[\s\S]*service_project_profiles[\s\S]*service_cases[\s\S]*service_case_offerings[\s\S]*to service_role/iu
  );
  assert.match(
    foundation.sql,
    /grant insert on table ss\.service_intakes to service_role/iu
  );
  assert.match(
    foundation.sql,
    /has_table_privilege\([\s\S]*'service_role'[\s\S]*'TRUNCATE'[\s\S]*held custom-service authority is writable by service_role/iu
  );
  assert.match(
    foundation.sql,
    /'custom_services'[\s\S]*'outside_management'/iu
  );
  assert.match(
    foundation.sql,
    /create function ss\.hosted_runtime_contract_v34\(\)/iu
  );
});

test("custom-service assessment quotes are exact, append-only, and account-bound", async () => {
  const all = await migrations();
  const quotes = all.find(
    ({ name }) =>
      name === "202608050035_custom_service_quotes.sql"
  );
  assert.ok(quotes);

  const quoteTables = [
    "service_operator_authority_events",
    "service_quotes",
    "service_quote_revisions",
    "service_quote_lines",
    "service_quote_line_coverages",
    "service_quote_review_targets",
    "service_quote_installments",
    "service_quote_acceptances"
  ];
  for (const table of quoteTables) {
    assert.ok(
      quotes.sql.includes("create table ss." + table + " ("),
      `migration 035 is missing ${table}`
    );
    assert.ok(
      quotes.sql.includes("'" + table + "'"),
      `migration 035 does not seal ${table}`
    );
  }

  assert.doesNotMatch(quotes.sql, /on delete cascade/iu);
  assert.doesNotMatch(quotes.sql, /grant all privileges/iu);
  assert.match(
    quotes.sql,
    /alter table ss\.%I enable row level security[\s\S]*alter table ss\.%I force row level security[\s\S]*revoke all on table ss\.%I from public, anon, authenticated, service_role/iu
  );
  assert.match(
    quotes.sql,
    /grant select on table[\s\S]*service_operator_authority_events[\s\S]*service_quotes[\s\S]*service_quote_revisions[\s\S]*service_quote_lines[\s\S]*service_quote_line_coverages[\s\S]*service_quote_review_targets[\s\S]*service_quote_installments[\s\S]*service_quote_acceptances[\s\S]*to service_role/iu
  );
  assert.match(
    quotes.sql,
    /grant insert on table\s+ss\.service_quotes,\s+ss\.service_quote_revisions,\s+ss\.service_quote_acceptances\s+to service_role/iu
  );
  assert.match(
    quotes.sql,
    /has_table_privilege\([\s\S]*'service_role'[\s\S]*'UPDATE'[\s\S]*'DELETE'[\s\S]*'TRUNCATE'[\s\S]*service quote table has unsafe mutation privilege/iu
  );
  assert.match(
    quotes.sql,
    /'ss\.service_operator_authority_events'[\s\S]*'ss\.service_quote_lines'[\s\S]*'ss\.service_quote_line_coverages'[\s\S]*'ss\.service_quote_review_targets'[\s\S]*'ss\.service_quote_installments'[\s\S]*service quote derived or operator authority is directly writable/iu
  );

  const revisionTable = quotes.sql.match(
    /create table ss\.service_quote_revisions \([\s\S]*?\n\);/iu
  )?.[0];
  const acceptanceTable = quotes.sql.match(
    /create table ss\.service_quote_acceptances \([\s\S]*?\n\);/iu
  )?.[0];
  const authorityTable = quotes.sql.match(
    /create table ss\.service_operator_authority_events \([\s\S]*?\n\);/iu
  )?.[0];
  assert.ok(revisionTable);
  assert.ok(acceptanceTable);
  assert.ok(authorityTable);

  assert.match(
    revisionTable,
    /service_amount_minor bigint not null check \(service_amount_minor = 20000\)[\s\S]*subtotal_minor bigint not null check \(subtotal_minor = 20000\)[\s\S]*currency text not null check \(currency = 'USD'\)[\s\S]*tax_state text not null check \(tax_state = 'calculation_required'\)[\s\S]*payment_schedule text not null\s+check \(payment_schedule = 'full_before_work'\)/iu
  );
  assert.match(
    revisionTable,
    /maximum_websites integer not null check \(maximum_websites = 1\)[\s\S]*maximum_representative_pages_or_types integer not null\s+check \(maximum_representative_pages_or_types = 5\)[\s\S]*maximum_findings integer not null check \(maximum_findings = 10\)[\s\S]*desktop_review_included boolean not null check \(desktop_review_included\)[\s\S]*phone_review_included boolean not null check \(phone_review_included\)[\s\S]*expanded_assessment_state text not null\s+check \(expanded_assessment_state = 'separately_quoted'\)/iu
  );
  assert.match(
    revisionTable,
    /quote_digest ss\.sha256_hex generated always as \(\s*ss\.service_quote_digest\(\s*'snapshot'/iu
  );
  assert.match(
    revisionTable,
    /disclosure_digest ss\.sha256_hex generated always as \(\s*ss\.service_quote_digest\(\s*'customer_disclosure'/iu
  );
  assert.match(
    quotes.sql,
    /'website_assessment_standard'[\s\S]*'Website assessment'[\s\S]*'assessment'[\s\S]*20000[\s\S]*'full'[\s\S]*20000[\s\S]*'USD'[\s\S]*'before_work'/iu
  );

  assert.match(
    authorityTable,
    /event_sequence bigint not null check \(event_sequence > 0\)[\s\S]*event_kind text not null check \(event_kind in \('grant', 'revoke'\)\)[\s\S]*recorded_by_kind text not null default 'deployment_control'[\s\S]*event_digest ss\.sha256_hex generated always as/iu
  );
  assert.match(
    quotes.sql,
    /create function ss\.service_operator_has_capability\([\s\S]*operator_profile\.state = 'held'[\s\S]*permission\.capability = target_capability[\s\S]*permission\.state = 'held'[\s\S]*event\.event_kind = 'grant'[\s\S]*order by event\.event_sequence desc/iu
  );
  assert.match(
    quotes.sql,
    /current_service_actor_kind\(\) <> 'operator'[\s\S]*service_operator_has_capability\([\s\S]*'service_quote_author'/iu
  );
  assert.match(
    quotes.sql,
    /service_operator_authority_events_prepare[\s\S]*service_operator_authority_events_immutable/iu
  );

  assert.match(
    acceptanceTable,
    /source text not null default 'account' check \(source = 'account'\)[\s\S]*acceptance_statement text not null\s+check \(acceptance_statement = 'accepted_exact_quote_and_delivery_date'\)[\s\S]*accepted_quote_digest ss\.sha256_hex not null[\s\S]*accepted_disclosure_digest ss\.sha256_hex not null[\s\S]*check \(accepted_by_user_id = customer_user_id\)/iu
  );
  assert.match(
    quotes.sql,
    /claimed_quote_digest is distinct from revision_record\.quote_digest[\s\S]*claimed_disclosure_digest is distinct from revision_record\.disclosure_digest[\s\S]*current_service_actor_kind\(\) <> 'customer'[\s\S]*current_service_actor_user_id\(\) is distinct from\s+quote_record\.customer_user_id[\s\S]*current_service_actor_org_id\(\) is distinct from\s+quote_record\.organization_id/iu
  );
  assert.match(
    quotes.sql,
    /create function ss\.prepare_service_quote_acceptance\(\)\s+returns trigger\s+language plpgsql\s+security definer\s+set search_path = pg_catalog, ss/iu
  );
  assert.match(
    quotes.sql,
    /service_quote_acceptances_account_authority[\s\S]*execute function ss\.validate_service_account_authority\(\)/iu
  );
  assert.match(
    quotes.sql,
    /create function ss\.hosted_runtime_contract_v35\(\)[\s\S]*select 'canonical-ss-v35-custom-service-quotes'::text/iu
  );
});

test("custom-service customer commands close withdrawn quote authority", async () => {
  const all = await migrations();
  const commands = all.find(
    ({ name }) =>
      name === "202608050036_custom_service_customer_commands.sql"
  );
  assert.ok(commands);

  assert.match(
    commands.sql,
    /create unique index service_cases_one_current_assessment[\s\S]*where state in \('draft', 'submitted'\)/iu
  );
  const draftTable = commands.sql.match(
    /create table ss\.service_intake_drafts \([\s\S]*?\n\);/iu
  )?.[0];
  assert.ok(draftTable);
  assert.match(
    draftTable,
    /site_display_name text not null[\s\S]*public_scheme text not null[\s\S]*public_hostname ss\.canonical_hostname not null[\s\S]*primary_goal text not null[\s\S]*complexity_flags text\[\] not null[\s\S]*customer_ownership_affirmed boolean not null[\s\S]*facts_digest ss\.sha256_hex generated always as/iu
  );
  assert.doesNotMatch(draftTable, /\bjsonb\b|on delete cascade/iu);
  assert.match(
    commands.sql,
    /service_intake_drafts_insert_guard[\s\S]*service_intake_drafts_revision[\s\S]*service_intake_drafts_account_authority/iu
  );
  assert.match(
    commands.sql,
    /grant select, insert, update on table ss\.service_intake_drafts[\s\S]*to service_role/iu
  );
  assert.match(
    commands.sql,
    /create function ss\.validate_service_case_offering_terminal_state\(\)[\s\S]*service_case\.state = 'withdrawn'[\s\S]*offering\.state = 'requested'/iu
  );
  assert.match(
    commands.sql,
    /service_quote_acceptances acceptance[\s\S]*accepted service quote keeps its submitted request retained/iu
  );
  assert.match(
    commands.sql,
    /create constraint trigger service_cases_offering_terminal_state[\s\S]*deferrable initially deferred[\s\S]*create constraint trigger service_case_offerings_terminal_state[\s\S]*deferrable initially deferred/iu
  );
  assert.match(
    commands.sql,
    /create or replace function ss\.prepare_service_quote_acceptance\(\)[\s\S]*security definer[\s\S]*service_case\.state = 'submitted'[\s\S]*offering\.id = quote_record\.offering_id[\s\S]*offering\.state = 'requested'/iu
  );
  assert.match(
    commands.sql,
    /create function ss\.hosted_runtime_contract_v36\(\)[\s\S]*select 'canonical-ss-v36-custom-service-customer-commands'::text/iu
  );
  assert.doesNotMatch(commands.sql, /on delete cascade|grant all privileges/iu);
});

test("custom-service held invoices materialize exact accepted assessment truth", async () => {
  const all = await migrations();
  const invoices = all.find(
    ({ name }) =>
      name === "202608050037_custom_service_held_invoices.sql"
  );
  assert.ok(invoices);

  for (const table of [
    "service_invoices",
    "service_invoice_lines",
    "service_payment_reservations"
  ]) {
    assert.match(
      invoices.sql,
      new RegExp(`create table ss\\.${table} \\(`, "iu")
    );
  }
  assert.match(
    invoices.sql,
    /subtotal_minor bigint not null check \(subtotal_minor = 20000\)[\s\S]*tax_state text not null check \(tax_state = 'calculation_required'\)[\s\S]*tax_minor bigint check \(tax_minor is null\)[\s\S]*total_minor bigint check \(total_minor is null\)[\s\S]*state text not null check \(state = 'tax_calculation_pending'\)[\s\S]*payable boolean not null check \(payable = false\)[\s\S]*charge_occurred boolean not null check \(charge_occurred = false\)/iu
  );
  assert.match(
    invoices.sql,
    /state text not null check \(state = 'held'\)[\s\S]*hold_reason text not null check \(hold_reason = 'tax_calculation_required'\)[\s\S]*dispatch_authorized boolean not null check \(dispatch_authorized = false\)[\s\S]*provider_effect_certainty text not null[\s\S]*check \(provider_effect_certainty = 'not_submitted'\)/iu
  );
  assert.match(
    invoices.sql,
    /create trigger service_quote_acceptances_materialize_invoice[\s\S]*after insert on ss\.service_quote_acceptances[\s\S]*ensure_service_assessment_invoice/iu
  );
  assert.match(
    invoices.sql,
    /revoke all on table ss\.%I from public, anon, authenticated, service_role[\s\S]*grant select on table ss\.%I to service_role/iu
  );
  assert.match(
    invoices.sql,
    /create function ss\.hosted_runtime_contract_v37\(\)[\s\S]*select 'canonical-ss-v37-custom-service-held-invoices'::text/iu
  );
  assert.doesNotMatch(
    invoices.sql,
    /on delete cascade|grant all privileges|checkout_session|provider_checkout_url/iu
  );
});

test("custom-service assessment Checkout reserves one exact automatic-tax payment page", async () => {
  const all = await migrations();
  const checkout = all.find(
    ({ name }) =>
      name ===
        "202608050038_custom_service_assessment_checkout.sql"
  );
  assert.ok(checkout);
  assert.match(
    checkout.sql,
    /create table ss\.service_assessment_checkout_attempts \([\s\S]*expected_subtotal_minor bigint not null[\s\S]*check \(expected_subtotal_minor = 20000\)[\s\S]*tax_mode text not null check \(tax_mode = 'automatic'\)[\s\S]*checkout_session_id text unique/iu
  );
  assert.match(
    checkout.sql,
    /create unique index service_assessment_checkout_one_active[\s\S]*where state in \('provider_pending', 'ready', 'persistence_unknown'\)/iu
  );
  assert.match(
    checkout.sql,
    /create function ss\.guard_service_assessment_checkout_attempt\(\)[\s\S]*current_service_actor_kind\(\)[\s\S]*assessment Checkout requires one exact held invoice/iu
  );
  assert.match(
    checkout.sql,
    /grant select, insert, update[\s\S]*service_assessment_checkout_attempts[\s\S]*to service_role/iu
  );
  assert.match(
    checkout.sql,
    /has_table_privilege\([\s\S]*'authenticated'[\s\S]*'INSERT'[\s\S]*'authenticated'[\s\S]*'UPDATE'[\s\S]*'authenticated'[\s\S]*'DELETE'[\s\S]*'authenticated'[\s\S]*'TRUNCATE'[\s\S]*'anon'[\s\S]*'INSERT'[\s\S]*'anon'[\s\S]*'UPDATE'[\s\S]*'anon'[\s\S]*'DELETE'[\s\S]*'anon'[\s\S]*'TRUNCATE'/iu
  );
  assert.match(
    checkout.sql,
    /create function ss\.hosted_runtime_contract_v38\(\)[\s\S]*canonical-ss-v38-custom-service-assessment-checkout/iu
  );
  assert.doesNotMatch(
    checkout.sql,
    /on delete cascade|grant all privileges/iu
  );
});

test("paid assessment delivery freezes exact evidence, findings, report, and one Custom credit", async () => {
  const all = await migrations();
  const delivery = all.find(
    ({ name }) =>
      name ===
        "202608050040_custom_service_assessment_delivery.sql"
  );
  assert.ok(delivery);
  for (const table of [
    "service_document_payloads",
    "service_assessment_evidence",
    "service_assessment_finding_drafts",
    "service_assessment_reports",
    "service_assessment_report_findings",
    "service_credit_grants"
  ]) {
    assert.match(
      delivery.sql,
      new RegExp(`create table ss\\.${table} \\(`, "iu")
    );
  }
  assert.match(
    delivery.sql,
    /octet_length\(payload\) between 1 and 786432/iu
  );
  assert.match(
    delivery.sql,
    /request_digest ss\.sha256_hex not null[\s\S]*unique \(created_by_operator_user_id, job_id, command_id\)/iu
  );
  assert.match(
    delivery.sql,
    /delivery_command_id text not null[\s\S]*work_digest ss\.sha256_hex not null[\s\S]*delivery_digest ss\.sha256_hex not null[\s\S]*unique \(delivered_by_operator_user_id, job_id, delivery_command_id\)/iu
  );
  assert.match(
    delivery.sql,
    /cross join unnest\(array\['desktop', 'phone'\]::text\[\]\)[\s\S]*assessment report lacks exact coverage or finding proof/iu
  );
  assert.match(
    delivery.sql,
    /create function ss\.materialize_service_assessment_delivery\(\)[\s\S]*insert into ss\.service_assessment_report_findings[\s\S]*insert into ss\.service_credit_grants/iu
  );
  assert.match(
    delivery.sql,
    /create trigger service_assessment_reports_materialize[\s\S]*after insert on ss\.service_assessment_reports[\s\S]*materialize_service_assessment_delivery/iu
  );
  assert.match(
    delivery.sql,
    /amount_minor bigint not null check \(amount_minor = 20000\)[\s\S]*application_scope text not null check \(application_scope = 'custom_base_build'\)[\s\S]*maximum_applications integer not null check \(maximum_applications = 1\)[\s\S]*non_cash boolean not null check \(non_cash\)[\s\S]*acceptance_cutoff = delivered_at \+ interval '90 days'/iu
  );
  assert.match(
    delivery.sql,
    /revoke insert on table\s+ss\.service_assessment_report_findings,\s+ss\.service_credit_grants\s+from service_role/iu
  );
  assert.match(
    delivery.sql,
    /create function ss\.hosted_runtime_contract_v40\(\)[\s\S]*canonical-ss-v40-custom-service-assessment-delivery/iu
  );
  assert.doesNotMatch(
    delivery.sql,
    /on delete cascade|grant all privileges/iu
  );
});

test("Custom build catalog pins seven held tiers and derives Scale pricing from capacity", async () => {
  const customBuild = (await migrations()).find(
    ({ name }) =>
      name === "202608050041_custom_build_quote_credit.sql"
  );
  assert.ok(customBuild);

  const tiers = [
    ["411", "card", "Card", "fixed", 40000, 1, 5, 1, 500, 2],
    ["412", "card-plus", "Card Plus", "fixed", 65000, 1, 8, 1, 900, 8],
    ["413", "site", "Site", "fixed", 120000, 4, 16, 4, 1800, 12],
    ["414", "site-plus", "Site Plus", "fixed", 180000, 7, 28, 7, 3000, 24],
    ["415", "signature", "Signature", "fixed", 280000, 10, 40, 10, 4500, 36],
    ["416", "flagship", "Flagship", "fixed", 400000, 15, 60, 15, 7000, 60],
    ["417", "scale", "Scale", "banded", null, 30, 120, 30, 14500, 120]
  ];

  for (const [
    policySuffix,
    tierId,
    label,
    pricingMode,
    amountMinor,
    pages,
    sections,
    layouts,
    words,
    media
  ] of tiers) {
    const amountSql = amountMinor === null
      ? "null::bigint"
      : `${amountMinor}::bigint`;
    assert.match(
      customBuild.sql,
      new RegExp(
        String.raw`'00000000-0000-4000-8000-000000000${policySuffix}'::uuid,\s*'${tierId}',\s*'${label}',\s*'${pricingMode}',\s*${amountSql},\s*${pages},\s*${sections},\s*${layouts},\s*${words},\s*${media}`,
        "iu"
      ),
      `missing exact ${label} held-catalog row`
    );
  }

  for (const [tierId, amountMinor] of [
    ["card", 40000],
    ["card-plus", 65000],
    ["site", 120000],
    ["site-plus", 180000],
    ["signature", 280000],
    ["flagship", 400000]
  ]) {
    assert.match(
      customBuild.sql,
      new RegExp(`when '${tierId}' then ${amountMinor}`, "iu"),
      `missing database-authoritative ${tierId} price`
    );
  }

  assert.match(
    customBuild.sql,
    /when 'scale' then\s+case[\s\S]*selected_scale_units between 1 and 15[\s\S]*400000 \+ selected_scale_units::bigint \* 27000/iu
  );
  assert.match(
    customBuild.sql,
    /create function ss\.custom_build_scale_units\([\s\S]*greatest\(crafted_pages - 15, 0\)[\s\S]*greatest\(sections - 60, 0\) \+ 3\) \/ 4[\s\S]*greatest\(unique_layouts - 15, 0\)[\s\S]*greatest\(content_words - 7000, 0\) \+ 499\) \/ 500[\s\S]*greatest\(supplied_media - 60, 0\) \+ 3\) \/ 4/iu
  );
  assert.match(
    customBuild.sql,
    /when 'scale' then[\s\S]*selected_scale_units between 1 and 15[\s\S]*selected_scale_units = ss\.custom_build_scale_units\(/iu
  );
  assert.match(
    customBuild.sql,
    /'scale', case when tier\.tier_id = 'scale' then jsonb_build_object\([\s\S]*'baseAmountMinor', 400000[\s\S]*'maximumCapacityUnits', 15[\s\S]*'minimumCapacityUnits', 1[\s\S]*'unitAmountMinor', 27000/iu
  );
  assert.match(
    customBuild.sql,
    /'c1259ad9efe9fd0909bf431e2f008feb8e6f1fc1e53acd0b34304312358fe1a1'[\s\S]*'held'[\s\S]*where document\.id = '00000000-0000-4000-8000-000000000342'/iu
  );
});

test("Custom build acceptance atomically reserves one exact assessment credit without charging", async () => {
  const customBuild = (await migrations()).find(
    ({ name }) =>
      name === "202608050041_custom_build_quote_credit.sql"
  );
  assert.ok(customBuild);

  for (const table of [
    "service_custom_build_quotes",
    "service_custom_build_quote_revisions",
    "service_custom_build_quote_base_lines",
    "service_custom_build_quote_installments",
    "service_custom_build_quote_commands",
    "service_custom_build_quote_acceptances",
    "service_credit_applications",
    "service_custom_build_quote_voids"
  ]) {
    assert.match(
      customBuild.sql,
      new RegExp(`create table ss\\.${table} \\(`, "iu"),
      `missing ${table}`
    );
  }

  assert.match(
    customBuild.sql,
    /create table ss\.service_custom_build_quotes \([\s\S]*source_job_id uuid not null[\s\S]*source_report_id uuid not null[\s\S]*references ss\.service_assessment_reports\(organization_id, job_id, id\)/iu
  );
  assert.match(
    customBuild.sql,
    /create function ss\.prepare_service_custom_build_quote\(\)[\s\S]*from ss\.service_assessment_reports report[\s\S]*custom build quote requires one eligible delivered assessment/iu
  );
  assert.match(
    customBuild.sql,
    /quote_digest ss\.sha256_hex generated always as[\s\S]*disclosure_digest ss\.sha256_hex generated always as[\s\S]*check \(expires_at <= credit_acceptance_cutoff\)/iu
  );
  assert.match(
    customBuild.sql,
    /create trigger service_custom_build_quote_revisions_immutable[\s\S]*before update or delete on ss\.service_custom_build_quote_revisions[\s\S]*ss\.reject_update\(\)/iu
  );
  assert.match(
    customBuild.sql,
    /create function ss\.materialize_service_custom_build_quote\(\)[\s\S]*insert into ss\.service_custom_build_quote_base_lines[\s\S]*insert into ss\.service_custom_build_quote_installments/iu
  );
  assert.match(
    customBuild.sql,
    /create trigger service_custom_build_quote_revisions_materialize[\s\S]*after insert on ss\.service_custom_build_quote_revisions[\s\S]*materialize_service_custom_build_quote/iu
  );

  assert.match(
    customBuild.sql,
    /where credit\.organization_id = quote_record\.organization_id[\s\S]*credit\.project_id = quote_record\.project_id[\s\S]*credit\.credit_digest[\s\S]*credit\.acceptance_cutoff > recorded_at[\s\S]*for update of credit/iu
  );
  assert.match(
    customBuild.sql,
    /claimed_quote_digest is distinct from revision_record\.quote_digest[\s\S]*claimed_disclosure_digest is distinct from revision_record\.disclosure_digest[\s\S]*credit\.credit_digest = revision_record\.credit_digest[\s\S]*credit\.acceptance_cutoff = revision_record\.credit_acceptance_cutoff[\s\S]*for update of credit/iu
  );
  assert.match(
    customBuild.sql,
    /create trigger service_custom_build_quote_acceptances_materialize[\s\S]*after insert on ss\.service_custom_build_quote_acceptances[\s\S]*materialize_service_custom_build_acceptance/iu
  );
  assert.match(
    customBuild.sql,
    /create function ss\.materialize_service_custom_build_acceptance\(\)[\s\S]*insert into ss\.service_credit_applications[\s\S]*'reserved'[\s\S]*update ss\.service_custom_build_quotes[\s\S]*state = 'accepted'/iu
  );
  assert.match(
    customBuild.sql,
    /create unique index service_credit_applications_one_active_grant[\s\S]*on ss\.service_credit_applications\(credit_grant_id\)[\s\S]*where state in \('reserved', 'settled', 'reconciliation_required'\)/iu
  );
  assert.match(
    customBuild.sql,
    /create function ss\.prepare_service_custom_build_quote_void\(\)[\s\S]*service_operator_has_capability[\s\S]*application_record\.state <> 'reserved'[\s\S]*cannot release a consumed or uncertain credit/iu
  );
  assert.match(
    customBuild.sql,
    /create function ss\.materialize_service_custom_build_quote_void\(\)[\s\S]*update ss\.service_credit_applications[\s\S]*state = 'released'[\s\S]*where quote_id = new\.quote_id[\s\S]*and state = 'reserved'/iu
  );

  assert.match(
    customBuild.sql,
    /tax_state text not null check \(tax_state = 'calculation_required'\)/iu
  );
  assert.doesNotMatch(customBuild.sql, /\btax_minor\b|\btotal_minor\b/iu);
  assert.doesNotMatch(
    customBuild.sql,
    /\binsert into ss\.(?:service_invoices|service_invoice_lines|service_payment_reservations|service_assessment_jobs|alakazam_[a-z_]+)/iu
  );
  assert.doesNotMatch(
    customBuild.sql,
    /\bcreate table ss\.[a-z_]*(?:invoice|payment|checkout|provider|job)[a-z_]*\b/iu
  );
});

test("Custom build quote storage is forced-RLS, minimally writable, and exactly v41", async () => {
  const customBuild = (await migrations()).find(
    ({ name }) =>
      name === "202608050041_custom_build_quote_credit.sql"
  );
  assert.ok(customBuild);

  const tables = [
    "service_custom_build_quotes",
    "service_custom_build_quote_revisions",
    "service_custom_build_quote_base_lines",
    "service_custom_build_quote_installments",
    "service_custom_build_quote_commands",
    "service_custom_build_quote_acceptances",
    "service_credit_applications",
    "service_custom_build_quote_voids"
  ];
  const directlyInsertable = new Set([
    "service_custom_build_quotes",
    "service_custom_build_quote_revisions",
    "service_custom_build_quote_commands",
    "service_custom_build_quote_acceptances",
    "service_custom_build_quote_voids"
  ]);

  assert.match(
    customBuild.sql,
    /alter table ss\.%I enable row level security[\s\S]*alter table ss\.%I force row level security[\s\S]*revoke all on table ss\.%I from public, anon, authenticated, service_role/iu
  );

  const selectGrant = customBuild.sql.match(
    /grant select on table([\s\S]*?)to service_role;/iu
  );
  const insertGrant = customBuild.sql.match(
    /grant insert on table([\s\S]*?)to service_role;/iu
  );
  assert.ok(selectGrant, "missing explicit service_role SELECT grant");
  assert.ok(insertGrant, "missing explicit service_role INSERT grant");
  for (const table of tables) {
    assert.match(
      selectGrant[1],
      new RegExp(`ss\\.${table}\\b`, "iu"),
      `service_role cannot read ${table}`
    );
    const tablePattern = new RegExp(`ss\\.${table}\\b`, "iu");
    if (directlyInsertable.has(table)) {
      assert.match(
        insertGrant[1],
        tablePattern,
        `service_role cannot create ${table}`
      );
    } else {
      assert.doesNotMatch(
        insertGrant[1],
        tablePattern,
        `${table} must only be trigger-materialized`
      );
    }
  }

  assert.match(
    customBuild.sql,
    /custom build materialization is directly writable/iu
  );
  for (const materializer of [
    "materialize_service_custom_build_quote",
    "materialize_service_custom_build_acceptance",
    "materialize_service_custom_build_quote_void"
  ]) {
    assert.match(
      customBuild.sql,
      new RegExp(
        String.raw`revoke all on function ss\.${materializer}\(\)\s+from public, anon, authenticated, service_role`,
        "iu"
      )
    );
  }

  assert.doesNotMatch(
    customBuild.sql,
    /\bgrant\b[^;]*\b(?:update|delete|truncate)\b[^;]*\bto service_role\b/iu
  );
  assert.doesNotMatch(customBuild.sql, /on delete cascade|grant all privileges/iu);
  assert.match(
    customBuild.sql,
    /create function ss\.hosted_runtime_contract_v41\(\)[\s\S]*select 'canonical-ss-v41-custom-build-quote-credit'::text[\s\S]*grant execute on function ss\.hosted_runtime_contract_v41\(\)[\s\S]*to service_role/iu
  );
});

test("paid Custom build progress stays bounded and separate from billing", async () => {
  const progress = (await migrations()).find(
    ({ name }) => name === "202608060043_custom_build_progress.sql"
  );
  assert.ok(progress, "missing migration 43 Custom build progress boundary");

  for (const table of [
    "service_custom_build_progress_updates",
    "service_custom_build_work_requests"
  ]) {
    assert.match(
      progress.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
  }

  assert.match(
    progress.sql,
    /stage text not null[\s\S]*'preparing'[\s\S]*'building'[\s\S]*'checking'/iu
  );
  assert.match(
    progress.sql,
    /request_kind text not null[\s\S]*'customer_content'[\s\S]*'customer_decision'[\s\S]*'delegated_access'[\s\S]*'outside_dependency'/iu
  );
  assert.match(
    progress.sql,
    /where state in \('open', 'answered'\)/iu
  );
  assert.match(
    progress.sql,
    /create function ss\.prepare_service_custom_build_progress_update\(\)/iu
  );
  assert.match(
    progress.sql,
    /create function ss\.guard_service_custom_build_work_request\(\)/iu
  );
  assert.match(progress.sql, /service_text_excludes_credentials/iu);
  assert.match(progress.sql, /service_operator_has_capability/iu);
  assert.match(progress.sql, /'service_job_manage'/iu);
  assert.match(progress.sql, /expected_progress_revision/iu);
  assert.match(progress.sql, /response_command_id/iu);
  assert.match(progress.sql, /resolution_command_id/iu);
  assert.match(
    progress.sql,
    /before update or delete on ss\.service_custom_build_progress_updates[\s\S]*ss\.reject_update\(\)/iu
  );
  assert.match(
    progress.sql,
    /create function ss\.hosted_runtime_contract_v43\(\)[\s\S]*select 'canonical-ss-v43-custom-build-progress'[\s\S]*grant execute on function ss\.hosted_runtime_contract_v43\(\)[\s\S]*to service_role/iu
  );

  assert.doesNotMatch(
    progress.sql,
    /create table ss\.(?:workflow|workflows|tasks|task_events|kanban|gantt)/iu
  );
  assert.doesNotMatch(
    progress.sql,
    /service_custom_build_(?:invoices|checkout_attempts|payment_receipts)/iu
  );
  assert.doesNotMatch(
    progress.sql,
    /from ss\.service_custom_build_jobs[\s\S]{0,300}\bfor update\b/iu
  );
  assert.doesNotMatch(progress.sql, /\bpercent(?:age)?\b/iu);
  assert.doesNotMatch(progress.sql, /on delete cascade|grant all privileges/iu);
});

test("Custom build change orders and completion proof are bounded before payment and handoff", async () => {
  const changeCompletion = (await migrations()).find(
    ({ name }) =>
      name === "202608060044_custom_build_change_completion.sql"
  );
  assert.ok(
    changeCompletion,
    "missing migration 44 Custom build change/completion boundary"
  );

  for (const table of [
    "service_custom_build_change_orders",
    "service_custom_build_change_acceptances",
    "service_custom_build_change_declines",
    "service_custom_build_change_voids",
    "service_custom_build_change_expirations",
    "service_custom_build_completion_evidence",
    "service_custom_build_completion_packages"
  ]) {
    assert.match(
      changeCompletion.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu"),
      `missing ${table}`
    );
  }

  assert.match(
    changeCompletion.sql,
    /'custom_build_change_unit'[\s\S]*'USD'[\s\S]*12500[\s\S]*'added-work unit'[\s\S]*1,[\s\S]*40,/iu
  );
  assert.match(
    changeCompletion.sql,
    /'addedWorkOnly', true[\s\S]*'assessmentCreditApplied', false[\s\S]*'cashRefund', false[\s\S]*'negativeLine', false[\s\S]*'originalScopeRemains', true/iu
  );
  assert.match(
    changeCompletion.sql,
    /create unique index service_custom_build_change_orders_one_active[\s\S]*where state in \('issued', 'accepted_payment_required'\)/iu
  );
  assert.match(
    changeCompletion.sql,
    /target_completion_date >= current_effective_target_completion_date/iu
  );
  assert.match(
    changeCompletion.sql,
    /expires_at <= issued_at \+ interval '14 days'/iu
  );
  assert.match(
    changeCompletion.sql,
    /create table ss\.service_custom_build_change_expirations[\s\S]*unique \(change_order_id\)[\s\S]*create function ss\.prepare_service_custom_build_change_expiration[\s\S]*recorded_at < selected_change\.expires_at[\s\S]*set state = 'expired'/iu
  );
  assert.match(
    changeCompletion.sql,
    /acceptance_statement[\s\S]*accepted_exact_change_order_and_payment_requirement[\s\S]*accepted_quote_digest[\s\S]*accepted_disclosure_digest/iu
  );
  assert.match(
    changeCompletion.sql,
    /create function ss\.service_custom_build_change_has_payment_evidence[\s\S]*to_regclass\('ss\.service_custom_build_change_payment_receipts'\)[\s\S]*return false/iu
  );
  assert.doesNotMatch(
    changeCompletion.sql,
    /old\.state = 'accepted_payment_required'[\s\S]{0,500}new\.state = 'effective'/iu
  );

  assert.match(
    changeCompletion.sql,
    /document_kind = 'job_evidence'[\s\S]*'service_document_manage'[\s\S]*'service_job_manage'[\s\S]*\/custom-build-jobs\/[\s\S]*\/evidence\/%/iu
  );
  assert.doesNotMatch(
    changeCompletion.sql,
    /custom_build_completion_evidence'\s*,?\s*'handoff/iu
  );
  assert.match(
    changeCompletion.sql,
    /cardinality\(value\) between 2 and 12/iu
  );
  assert.match(
    changeCompletion.sql,
    /selected_progress\.stage <> 'checking'[\s\S]*structure_milestone <> 'done'[\s\S]*content_milestone <> 'done'[\s\S]*responsive_milestone <> 'done'[\s\S]*quality_milestone <> 'done'/iu
  );
  assert.match(
    changeCompletion.sql,
    /request\.state in \('open', 'answered'\)[\s\S]*change_order\.state in \([\s\S]*'issued', 'accepted_payment_required'/iu
  );
  assert.match(
    changeCompletion.sql,
    /not includes_desktop[\s\S]*not includes_phone/iu
  );
  assert.match(
    changeCompletion.sql,
    /progress_revision bigint not null[\s\S]*effective_scope_digest ss\.sha256_hex not null[\s\S]*content_digest ss\.sha256_hex not null[\s\S]*image_width integer not null[\s\S]*image_height integer not null[\s\S]*service-image-evidence\/v1/iu
  );
  assert.match(
    changeCompletion.sql,
    /document\.byte_count between 1 and 716800[\s\S]*new\.progress_revision := selected_progress\.revision[\s\S]*new\.effective_scope_digest := scope_snapshot\.effective_scope_digest/iu
  );
  assert.match(
    changeCompletion.sql,
    /evidence\.progress_revision = selected_progress\.revision[\s\S]*evidence\.effective_scope_digest = scope_snapshot\.effective_scope_digest[\s\S]*phone_evidence\.content_digest = desktop_evidence\.content_digest/iu
  );
  assert.match(
    changeCompletion.sql,
    /create function ss\.guard_service_custom_build_after_completion[\s\S]*ss-custom-build-h1m:[\s\S]*service_custom_build_completion_packages[\s\S]*service_custom_build_progress_updates_completion_guard[\s\S]*service_custom_build_work_requests_completion_guard[\s\S]*service_access_requests_custom_build_completion_guard/iu
  );
  for (const trigger of [
    "service_custom_build_progress_updates_completion_guard",
    "service_custom_build_work_requests_completion_guard",
    "service_access_requests_custom_build_completion_guard"
  ]) {
    assert.match(
      changeCompletion.sql,
      new RegExp(
        `create trigger ${trigger}[\\s\\S]*` +
          "execute function ss\\.guard_service_custom_build_after_completion",
        "iu"
      ),
      `missing ${trigger}`
    );
  }
  assert.match(
    changeCompletion.sql,
    /when selected_job\.final_due_minor > 0[\s\S]*'ready_for_final_payment'[\s\S]*'ready_for_delivery'/iu
  );

  assert.match(
    changeCompletion.sql,
    /alter table ss\.%I enable row level security[\s\S]*alter table ss\.%I force row level security[\s\S]*revoke all on table ss\.%I from public, anon, authenticated, service_role/iu
  );
  assert.match(
    changeCompletion.sql,
    /grant update on table ss\.service_custom_build_change_orders to service_role/iu
  );
  assert.doesNotMatch(
    changeCompletion.sql,
    /grant update on table ss\.service_custom_build_(?:change_acceptances|change_declines|change_voids|change_expirations|completion_evidence|completion_packages)/iu
  );
  assert.match(
    changeCompletion.sql,
    /create function ss\.hosted_runtime_contract_v44\(\)[\s\S]*canonical-ss-v44-custom-build-change-completion[\s\S]*grant execute on function ss\.hosted_runtime_contract_v44\(\)/iu
  );
  assert.doesNotMatch(
    changeCompletion.sql,
    /create table ss\.[a-z_]*(?:checkout|stripe|payment_receipt|handoff)[a-z_]*/iu
  );
  assert.doesNotMatch(
    changeCompletion.sql,
    /on delete cascade|grant all privileges/iu
  );
});

test("Custom build change payment is a distinct provider-confirmed financial purpose", async () => {
  const changePayment = (await migrations()).find(
    ({ name }) =>
      name === "202608060045_custom_build_change_payment.sql"
  );
  assert.ok(
    changePayment,
    "missing migration 45 Custom build change-payment boundary"
  );

  for (const table of [
    "service_custom_build_change_invoices",
    "service_custom_build_change_invoice_lines",
    "service_custom_build_change_checkout_attempts",
    "service_custom_build_change_reconciliation_commands",
    "service_custom_build_change_stripe_events",
    "service_custom_build_change_payment_receipts"
  ]) {
    assert.match(
      changePayment.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu"),
      `missing ${table}`
    );
  }

  assert.match(
    changePayment.sql,
    /purpose text not null check \(purpose = 'custom_build_change'\)/iu
  );
  assert.match(
    changePayment.sql,
    /change_acceptance_id uuid not null[\s\S]*unique \(change_order_id\)[\s\S]*unique \(change_acceptance_id\)/iu
  );
  assert.doesNotMatch(changePayment.sql, /payment_deadline|interval '7 days'/iu);
  assert.match(
    changePayment.sql,
    /component_key = 'custom_build_change_units'[\s\S]*unit_amount_minor bigint not null check \(unit_amount_minor = 12500\)/iu
  );
  assert.match(
    changePayment.sql,
    /create unique index service_custom_build_change_checkout_one_active[\s\S]*where state in \('provider_pending', 'ready', 'persistence_unknown', 'paid'\)/iu
  );
  assert.match(
    changePayment.sql,
    /provider_request_expires_at timestamptz not null[\s\S]*check \(provider_request_expires_at > created_at\)[\s\S]*expires_at is null or expires_at = provider_request_expires_at/iu
  );
  assert.match(
    changePayment.sql,
    /create table ss\.service_custom_build_change_reconciliation_commands[\s\S]*unique \(command_id\)[\s\S]*custom_build_change_reconciliation_request_digest/iu
  );
  assert.match(
    changePayment.sql,
    /create or replace function ss\.service_custom_build_change_has_payment_evidence[\s\S]*service_custom_build_change_checkout_attempts[\s\S]*'provider_pending', 'ready', 'persistence_unknown', 'paid'[\s\S]*service_custom_build_change_stripe_events[\s\S]*service_custom_build_change_payment_receipts/iu
  );
  assert.match(
    changePayment.sql,
    /old\.state = 'accepted_payment_required'[\s\S]{0,300}new\.state = 'effective'[\s\S]*service_custom_build_change_payment_receipts/iu
  );
  assert.match(
    changePayment.sql,
    /guard_service_custom_build_change_payment_receipt[\s\S]*jsonb_object_keys\(new\.provider_facts\)[\s\S]*<> 14[\s\S]*custom_build_change_provider_facts_digest[\s\S]*change_order\.state = 'accepted_payment_required'[\s\S]*attempt\.state = 'ready'[\s\S]*event\.state in \('pending', 'reconciliation_required'\)[\s\S]*receipt_source = 'provider_readback'/iu
  );
  assert.match(
    changePayment.sql,
    /create function ss\.materialize_service_custom_build_change_payment[\s\S]*set state = 'effective'[\s\S]*set state = 'paid'[\s\S]*state = 'processed'[\s\S]*create trigger service_custom_build_change_payment_materialize[\s\S]*after insert on ss\.service_custom_build_change_payment_receipts/iu
  );
  assert.match(
    changePayment.sql,
    /create or replace function ss\.prepare_service_custom_build_change_void[\s\S]*ss-custom-build-h1m:[\s\S]*service_custom_build_change_has_payment_evidence/iu
  );
  assert.match(
    changePayment.sql,
    /create function ss\.assert_service_custom_build_change_payment_lock[\s\S]*pg_locks[\s\S]*guard_service_custom_build_change_checkout_attempt[\s\S]*assert_service_custom_build_change_payment_lock\(new\.job_id\)[\s\S]*guard_service_custom_build_change_reconciliation_command[\s\S]*assert_service_custom_build_change_payment_lock\(new\.job_id\)[\s\S]*guard_service_custom_build_change_stripe_event[\s\S]*assert_service_custom_build_change_payment_lock\(new\.job_id\)[\s\S]*guard_service_custom_build_change_payment_receipt[\s\S]*assert_service_custom_build_change_payment_lock\(new\.job_id\)/iu
  );
  for (const guard of [
    "guard_service_custom_build_change_checkout_attempt",
    "guard_service_custom_build_change_reconciliation_command",
    "guard_service_custom_build_change_stripe_event",
    "guard_service_custom_build_change_payment_receipt"
  ]) {
    const start = changePayment.sql.indexOf(`create function ss.${guard}`);
    const end = changePayment.sql.indexOf("$$;", start);
    assert.ok(start >= 0 && end > start, `missing ${guard}`);
    assert.doesNotMatch(
      changePayment.sql.slice(start, end),
      /pg_advisory_xact_lock/iu,
      `${guard} must assert a pre-held lock, not acquire after its row lock`
    );
  }
  assert.match(
    changePayment.sql,
    /revoke all on function ss\.ensure_service_custom_build_change_invoice\(uuid\)[\s\S]*from public, anon, authenticated, service_role/iu
  );
  assert.match(
    changePayment.sql,
    /create function ss\.hosted_runtime_contract_v45\(\)[\s\S]*canonical-ss-v45-custom-build-change-payment[\s\S]*grant execute on function ss\.hosted_runtime_contract_v45\(\)/iu
  );
  assert.doesNotMatch(
    changePayment.sql,
    /service_custom_build_(?:invoices|checkout_attempts|payment_receipts)\b/iu
  );
  assert.doesNotMatch(
    changePayment.sql,
    /custom_build_final|handoff|on delete cascade|grant all privileges/iu
  );
});

test("Custom build final payment freezes completion-bound obligation and globally fences Stripe effects", async () => {
  const finalPayment = (await migrations()).find(
    ({ name }) =>
      name === "202608060046_custom_build_final_payment.sql"
  );
  assert.ok(
    finalPayment,
    "missing migration 46 Custom build final-payment boundary"
  );

  for (const table of [
    "service_custom_build_stripe_payment_claims",
    "service_custom_build_final_obligations",
    "service_custom_build_final_invoices",
    "service_custom_build_final_invoice_lines",
    "service_custom_build_final_zero_balance_clearances",
    "service_custom_build_final_checkout_attempts",
    "service_custom_build_final_reconciliation_commands",
    "service_custom_build_final_stripe_events",
    "service_custom_build_final_payment_receipts"
  ]) {
    assert.match(
      finalPayment.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu"),
      `missing ${table}`
    );
  }

  assert.match(
    finalPayment.sql,
    /unique \(provider, provider_object_kind, provider_object_id\)[\s\S]*unique \(purpose, authority_kind, authority_id, provider_object_kind\)/iu
  );
  const claimStart = finalPayment.sql.indexOf(
    "create function ss.claim_service_custom_build_stripe_payment_effect"
  );
  const claimEnd = finalPayment.sql.indexOf("$$;", claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  const claimFunction = finalPayment.sql.slice(claimStart, claimEnd);
  assert.match(
    claimFunction,
    /provider_object_id = selected_provider_object_id[\s\S]*authority_id = selected_authority_id/iu
  );
  assert.match(
    claimFunction,
    /when unique_violation[\s\S]*Re-resolve both axes once/iu
  );
  assert.doesNotMatch(claimFunction, /\bloop\b|on conflict/iu);

  for (const source of [
    "service_custom_build_checkout_attempts",
    "service_custom_build_change_checkout_attempts",
    "service_custom_build_stripe_events",
    "service_custom_build_change_stripe_events",
    "service_custom_build_payment_receipts",
    "service_custom_build_change_payment_receipts"
  ]) {
    assert.match(
      finalPayment.sql,
      new RegExp(`from ss\\.${source}\\b`, "iu"),
      `missing retained ${source} backfill`
    );
  }
  assert.match(
    finalPayment.sql,
    /create table ss\.service_custom_build_final_obligations[\s\S]*quote_id uuid not null[\s\S]*quote_revision_id uuid not null[\s\S]*quote_acceptance_id uuid not null[\s\S]*completion_package_digest ss\.sha256_hex not null[\s\S]*effective_change_order_digests ss\.sha256_hex\[\] not null[\s\S]*commercial_contract_digest ss\.sha256_hex not null[\s\S]*obligation_digest ss\.sha256_hex generated always/iu
  );
  const obligationDigestStart = finalPayment.sql.indexOf(
    "create function ss.custom_build_final_obligation_digest"
  );
  const obligationDigestEnd = finalPayment.sql.indexOf(
    "$$;",
    obligationDigestStart
  );
  assert.ok(
    obligationDigestStart >= 0 && obligationDigestEnd > obligationDigestStart
  );
  const obligationDigestFunction = finalPayment.sql.slice(
    obligationDigestStart,
    obligationDigestEnd
  );
  assert.match(
    obligationDigestFunction,
    /'customerUserId', customer_user_id/iu
  );
  assert.match(
    finalPayment.sql,
    /create function ss\.ensure_service_custom_build_final_obligation[\s\S]*select package\.job_id into discovered_job_id[\s\S]*pg_advisory_xact_lock[\s\S]*ss-custom-build-h1m:[\s\S]*revision_final_due_minor is distinct from source\.final_due_minor[\s\S]*installment_credit_minor <> 0[\s\S]*insert into ss\.service_custom_build_final_obligations/iu
  );
  assert.match(
    finalPayment.sql,
    /source\.final_due_minor > 0[\s\S]*insert into ss\.service_custom_build_final_invoices[\s\S]*custom_build_final_installment[\s\S]*source\.final_due_minor[\s\S]*else[\s\S]*insert into ss\.service_custom_build_final_zero_balance_clearances/iu
  );
  assert.match(
    finalPayment.sql,
    /subtotal_minor bigint not null check \(subtotal_minor > 0\)[\s\S]*credit_minor bigint not null check \(credit_minor = 0\)/iu
  );
  assert.doesNotMatch(
    finalPayment.sql,
    /assessment_build_credit|change_(?:unit|subtotal)_minor|final_due_minor\s*\+/iu
  );

  assert.match(
    finalPayment.sql,
    /create trigger service_custom_build_completion_final_obligation[\s\S]*after insert on ss\.service_custom_build_completion_packages/iu
  );
  assert.match(
    finalPayment.sql,
    /select id[\s\S]*from ss\.service_custom_build_completion_packages[\s\S]*ensure_service_custom_build_final_obligation\(retained\.id\)/iu
  );

  assert.match(
    finalPayment.sql,
    /create table ss\.service_custom_build_final_checkout_attempts[\s\S]*obligation_id uuid not null[\s\S]*obligation_digest ss\.sha256_hex not null[\s\S]*purpose text not null check \(purpose = 'custom_build_final'\)/iu
  );
  assert.match(
    finalPayment.sql,
    /create table ss\.service_custom_build_final_payment_receipts[\s\S]*charge_captured boolean not null check \(charge_captured\)[\s\S]*amount_refunded_minor bigint not null check \(amount_refunded_minor = 0\)[\s\S]*disputed boolean not null check \(not disputed\)/iu
  );
  assert.match(
    finalPayment.sql,
    /alter table ss\.stripe_customers[\s\S]*constraint stripe_customers_organization_stripe_customer_unique[\s\S]*unique \(organization_id, stripe_customer_id\)/iu
  );
  assert.match(
    finalPayment.sql,
    /constraint service_custom_build_final_receipt_stripe_customer_org_fk[\s\S]*foreign key \(organization_id, stripe_customer_id\)[\s\S]*references ss\.stripe_customers\([\s\S]*organization_id, stripe_customer_id[\s\S]*\)/iu
  );
  const receiptGuardStart = finalPayment.sql.indexOf(
    "create function ss.guard_service_custom_build_final_payment_receipt"
  );
  const receiptGuardEnd = finalPayment.sql.indexOf(
    "$$;",
    receiptGuardStart
  );
  assert.ok(receiptGuardStart >= 0 && receiptGuardEnd > receiptGuardStart);
  const receiptGuard = finalPayment.sql.slice(
    receiptGuardStart,
    receiptGuardEnd
  );
  for (const invariant of [
    /custom_build_final_provider_facts_digest/iu,
    /attempt\.state = 'ready'/iu,
    /line\.component_key = 'custom_build_final_installment'/iu,
    /new\.receipt_source = 'provider_readback'/iu
  ]) {
    assert.match(receiptGuard, invariant);
  }
  assert.match(
    finalPayment.sql,
    /create table ss\.service_custom_build_final_reconciliation_commands[\s\S]*unique \(command_id\)[\s\S]*custom_build_final_reconciliation_request_digest/iu
  );

  assert.match(
    finalPayment.sql,
    /alter table ss\.%I enable row level security[\s\S]*alter table ss\.%I force row level security[\s\S]*revoke all on table ss\.%I from public, anon, authenticated, service_role/iu
  );
  assert.match(
    finalPayment.sql,
    /revoke all on function ss\.ensure_service_custom_build_final_obligation\(uuid\)[\s\S]*from public, anon, authenticated, service_role/iu
  );
  assert.match(
    finalPayment.sql,
    /create function ss\.hosted_runtime_contract_v46\(\)[\s\S]*canonical-ss-v46-custom-build-final-payment[\s\S]*grant execute on function ss\.hosted_runtime_contract_v46\(\)/iu
  );
  assert.doesNotMatch(
    finalPayment.sql,
    /service_custom_build_handoff_receipts|workmanship_starts_at|workmanship_ends_at|hosted_runtime_contract_v4[78]|on delete cascade|grant all privileges/iu
  );
});

test("Custom build handoff atomically binds exact financial clearance to one immutable customer document", async () => {
  const handoff = (await migrations()).find(
    ({ name }) =>
      name === "202608060047_custom_build_handoff.sql"
  );
  assert.ok(handoff, "missing migration 47 Custom build handoff boundary");

  assert.match(
    handoff.sql,
    /create table ss\.service_custom_build_handoff_receipts\s*\([\s\S]*completion_package_id uuid not null[\s\S]*final_obligation_id uuid not null[\s\S]*final_payment_receipt_id uuid[\s\S]*zero_balance_clearance_id uuid[\s\S]*document_id uuid not null[\s\S]*completion_package_digest ss\.sha256_hex not null[\s\S]*final_obligation_digest ss\.sha256_hex not null[\s\S]*handoff_digest ss\.sha256_hex generated always/iu
  );
  assert.match(
    handoff.sql,
    /financial_clearance_kind in \([\s\S]*'provider_confirmed_final_payment'[\s\S]*'zero_balance_clearance'[\s\S]*final_due_minor > 0[\s\S]*final_payment_receipt_id is not null[\s\S]*final_due_minor = 0[\s\S]*zero_balance_clearance_id is not null/iu
  );
  const finalReceiptLockStart = handoff.sql.indexOf(
    "create function ss.lock_service_custom_build_final_payment_receipt_h1m"
  );
  const finalReceiptLockEnd = handoff.sql.indexOf(
    "$$;",
    finalReceiptLockStart
  );
  assert.ok(
    finalReceiptLockStart >= 0 && finalReceiptLockEnd > finalReceiptLockStart
  );
  const finalReceiptLock = handoff.sql.slice(
    finalReceiptLockStart,
    finalReceiptLockEnd
  );
  assert.match(
    finalReceiptLock,
    /pg_advisory_xact_lock\([\s\S]*hashtextextended\([\s\S]*'ss-custom-build-h1m:' \|\| new\.job_id::text/iu
  );
  assert.match(
    handoff.sql,
    /create trigger service_custom_build_final_payment_receipt_00_h1m_lock[\s\S]*before insert on ss\.service_custom_build_final_payment_receipts[\s\S]*execute function[\s\S]*ss\.lock_service_custom_build_final_payment_receipt_h1m\(\)/iu
  );
  assert.match(
    handoff.sql,
    /unique \(job_id\)[\s\S]*unique \(completion_package_id\)[\s\S]*unique \(final_obligation_id\)[\s\S]*unique \(final_payment_receipt_id\)[\s\S]*unique \(zero_balance_clearance_id\)[\s\S]*unique \(document_id\)[\s\S]*unique \(handed_off_by_operator_user_id, job_id, command_id\)/iu
  );
  assert.match(
    handoff.sql,
    /document_byte_count between 1 and 65536[\s\S]*document_media_type = 'application\/json'[\s\S]*references ss\.service_documents\([\s\S]*content_digest,[\s\S]*byte_count,[\s\S]*media_type[\s\S]*deferrable initially deferred[\s\S]*references ss\.service_document_payloads\(organization_id, document_id\)[\s\S]*deferrable initially deferred/iu
  );
  assert.match(
    handoff.sql,
    /workmanship_starts_at = handed_off_at[\s\S]*service_custom_build_workmanship_end\(handed_off_at\)[\s\S]*workmanship_ends_at - workmanship_starts_at = interval '720 hours'/iu
  );
  assert.match(
    handoff.sql,
    /at time zone 'UTC'\) \+ interval '30 days'[\s\S]*at time zone 'UTC'/iu
  );
  assert.match(
    handoff.sql,
    /create function ss\.service_custom_build_handoff_iso_millisecond\([\s\S]*selected_value timestamptz[\s\S]*to_char\([\s\S]*selected_value at time zone 'UTC',[\s\S]*YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"/iu
  );
  const manifestGuardStart = handoff.sql.indexOf(
    "create function ss.service_custom_build_handoff_manifest_is_valid"
  );
  const manifestGuardEnd = handoff.sql.indexOf(
    "$$;",
    manifestGuardStart
  );
  assert.ok(
    manifestGuardStart >= 0 && manifestGuardEnd > manifestGuardStart,
    "missing exact v47 delivery-manifest guard"
  );
  const manifestGuard = handoff.sql.slice(
    manifestGuardStart,
    manifestGuardEnd
  );
  for (const invariant of [
    /from pg_catalog\.jsonb_object_keys\(selected_manifest\)[\s\S]*selected_manifest_key_count <> 1/iu,
    /selected_manifest \? 'items'/iu,
    /jsonb_array_length\(selected_manifest -> 'items'\) not between 1 and 40/iu,
    /from pg_catalog\.jsonb_object_keys\(selected_item\)[\s\S]*selected_item_key_count <> 2/iu,
    /selected_item \?& array\['label', 'description'\]/iu,
    /service_custom_build_handoff_text_is_valid\(\s*selected_label,\s*2,\s*120\s*\)/iu,
    /service_custom_build_handoff_text_is_valid\(\s*selected_description,\s*2,\s*500\s*\)/iu,
    /pg_catalog\.translate\([\s\S]*selected_label,[\s\S]*'ABCDEFGHIJKLMNOPQRSTUVWXYZ',[\s\S]*'abcdefghijklmnopqrstuvwxyz'[\s\S]*\) = any \(retained_labels\)/iu,
    /pg_catalog\.octet_length\([\s\S]*service_custom_build_handoff_canonical_json\(selected_manifest\)[\s\S]*\) <= 30 \* 1024/iu
  ]) {
    assert.match(manifestGuard, invariant);
  }
  const canonicalGuardStart = handoff.sql.indexOf(
    "create function ss.service_custom_build_handoff_canonical_json"
  );
  const canonicalGuardEnd = handoff.sql.indexOf("$$;", canonicalGuardStart);
  assert.ok(canonicalGuardStart >= 0 && canonicalGuardEnd > canonicalGuardStart);
  const canonicalGuard = handoff.sql.slice(
    canonicalGuardStart,
    canonicalGuardEnd
  );
  for (const invariant of [
    /jsonb_typeof\(selected_value\)/iu,
    /string_agg\([\s\S]*',' order by entry\.key collate "C"\s*\)/iu,
    /from jsonb_each\(selected_value\) entry\(key, value\)/iu,
    /string_agg\([\s\S]*',' order by entry\.ordinality\s*\)/iu,
    /from jsonb_array_elements\(selected_value\)[\s\S]*with ordinality entry\(value, ordinality\)/iu
  ]) assert.match(canonicalGuard, invariant);
  const textGuardStart = handoff.sql.indexOf(
    "create function ss.service_custom_build_handoff_text_is_valid"
  );
  const textGuardEnd = handoff.sql.indexOf("$$;", textGuardStart);
  assert.ok(textGuardStart >= 0 && textGuardEnd > textGuardStart);
  const textGuard = handoff.sql.slice(textGuardStart, textGuardEnd);
  for (const invariant of [
    /char_length\(selected_value\) between minimum_length and maximum_length/iu,
    /selected_value = btrim\(/iu,
    /service_text_excludes_credentials\(selected_value\)/iu,
    /bearer\[\[:space:\]\]\+/iu,
    /\[\?&\]\(token\|key\|secret\|password\)=/iu,
    /\(cs\|pi\|ch\|cus\|evt\|pm\|seti\|src\|tok\|sub\|price\|prod\|re\)_/iu
  ]) assert.match(textGuard, invariant);
  assert.match(
    handoff.sql,
    /delivery_manifest jsonb not null check \([\s\S]*service_custom_build_handoff_manifest_is_valid\(delivery_manifest\)[\s\S]*\)/iu
  );
  assert.doesNotMatch(
    handoff.sql,
    /pg_column_size\((?:selected_)?delivery_manifest\)|32768/iu
  );
  assert.match(
    handoff.sql,
    /convert_to\(\s*ss\.service_custom_build_handoff_canonical_json\(decoded_payload\),\s*'UTF8'\s*\) <> new\.payload/iu
  );

  const callableStart = handoff.sql.indexOf(
    "create function ss.create_service_custom_build_handoff"
  );
  const callableEnd = handoff.sql.indexOf("$$;", callableStart);
  assert.ok(callableStart >= 0 && callableEnd > callableStart);
  const callable = handoff.sql.slice(callableStart, callableEnd);
  for (const allowedInput of [
    /target_job_id uuid/iu,
    /selected_command_id text/iu,
    /selected_organization_id uuid/iu,
    /expected_completion_package_digest ss\.sha256_hex/iu,
    /expected_final_obligation_digest ss\.sha256_hex/iu,
    /selected_customer_summary text/iu,
    /selected_delivery_manifest jsonb/iu
  ]) {
    assert.match(callable, allowedInput);
  }
  assert.match(
    callable,
    /returns table \([\s\S]*receipt_id uuid[\s\S]*document_id uuid[\s\S]*handoff_digest ss\.sha256_hex[\s\S]*handed_off_at timestamptz[\s\S]*workmanship_starts_at timestamptz[\s\S]*workmanship_ends_at timestamptz/iu
  );
  assert.match(
    callable,
    /service_custom_build_handoff_manifest_is_valid\([\s\S]*selected_delivery_manifest/iu
  );
  const discoveryIndex = callable.indexOf(
    "select job.id into discovered_job_id"
  );
  const lockIndex = callable.indexOf("pg_advisory_xact_lock");
  const capabilityIndex = callable.indexOf(
    "service_operator_has_capability"
  );
  const commandIndex = callable.indexOf(
    "from ss.service_custom_build_handoff_receipts receipt"
  );
  const sourceIndex = callable.indexOf(
    "from ss.service_custom_build_jobs job",
    callable.indexOf("from ss.service_custom_build_jobs job") + 1
  );
  assert.ok(
    discoveryIndex >= 0 &&
      discoveryIndex < lockIndex &&
      lockIndex < capabilityIndex &&
      capabilityIndex < commandIndex &&
      commandIndex < sourceIndex,
    "handoff callable must discover immutable job, lock H1M, then inspect command and source rows"
  );
  assert.doesNotMatch(
    callable.slice(discoveryIndex, lockIndex),
    /for update|\b(?:insert|update|delete)\b/iu
  );
  assert.match(
    callable,
    /service_job_manage[\s\S]*service_document_manage[\s\S]*request_digest is distinct from[\s\S]*command digest conflicts/iu
  );
  assert.match(
    callable,
    /state in \([\s\S]*'provider_pending', 'ready', 'persistence_unknown'[\s\S]*event\.state in \('pending', 'reconciliation_required'\)/iu
  );
  assert.match(
    callable,
    /service_custom_build_final_reconciliation_commands command[\s\S]*command\.job_id = discovered_job_id[\s\S]*command\.state = 'running'/iu
  );
  assert.match(
    callable,
    /final_due_minor > 0[\s\S]*final_payment_receipt_id is null[\s\S]*payment_status <> 'paid'[\s\S]*not source\.charge_captured[\s\S]*amount_refunded_minor <> 0[\s\S]*source\.disputed[\s\S]*attempt\.state = 'paid'/iu
  );
  assert.match(
    callable,
    /final_due_minor = 0[\s\S]*zero_balance_clearance_id is null[\s\S]*accepted_quote_has_no_final_balance[\s\S]*service_custom_build_final_checkout_attempts[\s\S]*service_custom_build_final_stripe_events/iu
  );
  assert.match(
    callable,
    /insert into ss\.service_custom_build_handoff_receipts[\s\S]*insert into ss\.service_documents[\s\S]*'handoff'[\s\S]*insert into ss\.service_document_payloads/iu
  );
  assert.match(
    callable,
    /service-documents\/[\s\S]*\/custom-build-jobs\/[\s\S]*\/handoff\/[\s\S]*\.json/iu
  );
  assert.match(
    callable,
    /financialClearance[\s\S]*provider_confirmed_final_payment[\s\S]*zero_balance_clearance/iu
  );
  assert.match(
    callable,
    /'clearedAt', ss\.service_custom_build_handoff_iso_millisecond\([\s\S]*'handedOffAt', ss\.service_custom_build_handoff_iso_millisecond\([\s\S]*'endsAt', ss\.service_custom_build_handoff_iso_millisecond\([\s\S]*'startsAt', ss\.service_custom_build_handoff_iso_millisecond\(/iu
  );
  assert.match(
    callable,
    /'schema', 'sitesourcery\.custom-build-handoff-document\/v1'/iu
  );
  assert.match(callable, /'coverage', '\[start,end\)'/iu);
  assert.doesNotMatch(
    callable,
    /checkout_session_id|payment_intent_id|charge_id|stripe_customer_id|on conflict/iu
  );

  assert.match(
    handoff.sql,
    /create or replace function ss\.guard_service_assessment_document[\s\S]*'assessment_evidence', 'assessment_report', 'job_evidence', 'handoff'[\s\S]*document_kind = 'job_evidence'[\s\S]*document_kind = 'handoff'[\s\S]*service_custom_build_handoff_receipts/iu
  );
  assert.match(
    handoff.sql,
    /create or replace function ss\.guard_service_custom_build_completion_payload[\s\S]*document_kind = 'job_evidence'[\s\S]*document_kind = 'handoff'[\s\S]*convert_from\(new\.payload, 'UTF8'\)::jsonb[\s\S]*service_custom_build_handoff_canonical_json\(decoded_payload\)[\s\S]*<> new\.payload/iu
  );
  const v44 = (await migrations()).find(
    ({ name }) =>
      name === "202608060044_custom_build_change_completion.sql"
  );
  assert.ok(v44);
  const functionBody = (sql, signature) => {
    const start = sql.indexOf(signature);
    const end = sql.indexOf("$$;", start);
    assert.ok(start >= 0 && end > start, `missing ${signature}`);
    return sql.slice(start, end).replace(/\s+/gu, " ").trim();
  };
  const v44DocumentGuard = functionBody(
    v44.sql,
    "create or replace function ss.guard_service_assessment_document"
  );
  const v47DocumentGuard = functionBody(
    handoff.sql,
    "create or replace function ss.guard_service_assessment_document"
  );
  const jobBranch = (body, endMarker) => {
    const start = body.indexOf(
      "or ( new.document_kind = 'job_evidence'"
    );
    const end = body.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start);
    return body.slice(start, end).trim();
  };
  assert.equal(
    jobBranch(v47DocumentGuard, "or ( new.document_kind = 'handoff'"),
    jobBranch(v44DocumentGuard, "then raise exception")
  );
  const assessmentPrefix = (body) => {
    const start = body.indexOf("if ss.current_service_actor_kind()");
    const end = body.indexOf(
      "or ( new.document_kind = 'job_evidence'",
      start
    );
    assert.ok(start >= 0 && end > start);
    return body
      .slice(start, end)
      .replace(", 'handoff'", "")
      .trim();
  };
  assert.equal(
    assessmentPrefix(v47DocumentGuard),
    assessmentPrefix(v44DocumentGuard)
  );
  const v44PayloadGuard = functionBody(
    v44.sql,
    "create function ss.guard_service_custom_build_completion_payload"
  );
  const v47PayloadGuard = functionBody(
    handoff.sql,
    "create or replace function ss.guard_service_custom_build_completion_payload"
  );
  const payloadJobBranch = (body) => {
    const start = body.indexOf(
      "if selected_document.document_kind = 'job_evidence'"
    );
    const end = body.indexOf(
      "then raise exception 'Custom build evidence payload lacks bounded authority'",
      start
    );
    assert.ok(start >= 0 && end > start);
    return body.slice(start, end).trim();
  };
  assert.equal(
    payloadJobBranch(v47PayloadGuard),
    payloadJobBranch(v44PayloadGuard)
  );
  for (const trigger of [
    "service_custom_build_progress_updates_00_handoff_guard",
    "service_custom_build_work_requests_00_handoff_guard",
    "service_access_requests_00_custom_build_handoff_guard",
    "service_custom_build_final_checkout_00_handoff_guard"
  ]) {
    assert.match(
      handoff.sql,
      new RegExp(`create trigger ${trigger}\\b`, "iu"),
      `missing post-handoff closure trigger ${trigger}`
    );
  }
  assert.match(
    handoff.sql,
    /alter table ss\.service_custom_build_handoff_receipts enable row level security[\s\S]*force row level security[\s\S]*revoke all on table ss\.service_custom_build_handoff_receipts[\s\S]*grant select on table ss\.service_custom_build_handoff_receipts/iu
  );
  assert.match(
    handoff.sql,
    /create function ss\.hosted_runtime_contract_v47\(\)[\s\S]*canonical-ss-v47-custom-build-handoff[\s\S]*grant execute on function ss\.hosted_runtime_contract_v47\(\)/iu
  );
  assert.doesNotMatch(
    handoff.sql,
    /hosted_runtime_contract_v48|privacy|on delete cascade|grant all privileges|create table ss\.service_custom_build_(?!handoff_receipts)/iu
  );
});

test("joint Privacy V3 and Website Terms V3 are additive, exact, and owner-sealed", async () => {
  const privacy = (await migrations()).find(
    ({ name }) => name === "202608060048_hosted_privacy_v3.sql"
  );
  assert.ok(privacy);
  assert.match(privacy.sql, /^begin;/iu);
  assert.match(privacy.sql, /commit;\s*$/iu);

  const releaseGuard = privacy.sql.indexOf(
    "Hosted joint Privacy V3 and Website Terms V3 constants are invalid or unsealed"
  );
  const firstPermanentDdl = privacy.sql.indexOf(
    "create function ss.reject_delete_v48"
  );
  assert.ok(releaseGuard >= 0 && releaseGuard < firstPermanentDdl);
  assert.match(
    privacy.sql,
    /to_regprocedure\('ss\.hosted_runtime_contract_v21\(\)'\)[\s\S]*to_regprocedure\('ss\.hosted_runtime_contract_v47\(\)'\)[\s\S]*canonical-ss-v47-custom-build-handoff[\s\S]*errcode = '55000'/iu
  );
  assert.match(
    privacy.sql,
    /create temporary table hosted_joint_legal_v3_release_constants[\s\S]*version text[\s\S]*content_digest text[\s\S]*content_uri text[\s\S]*effective_at timestamptz[\s\S]*byte_count bigint[\s\S]*artifact_uri text[\s\S]*website_terms_version text[\s\S]*website_terms_content_digest text[\s\S]*website_terms_artifact_uri text[\s\S]*website_terms_byte_count bigint[\s\S]*authority_digest text/iu
  );
  assert.match(
    privacy.sql,
    /'SS-HOSTED-PRIVACY-2026-08-09-V3',[\s\S]*'5713fd6776c6ba41dbbac1b4d1ac0d9f1b6857ba01128e5d74c4f3c5287a4967',[\s\S]*'2026-08-09T15:25:59\.000Z'::timestamptz[\s\S]*29610[\s\S]*'SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3',[\s\S]*'b179ee8b6ed713b6b19b20daf320e84a9e89f2ac166504942919f8c4e280a602',[\s\S]*26171[\s\S]*'ae52bb144a3cb9bd09709cd58ce43878ec2a03d650a19ff197532ea51cd4d1cf'/iu
  );
  const productionTupleStart = privacy.sql.indexOf(") values (");
  const productionTupleEnd = privacy.sql.indexOf("\n);", productionTupleStart);
  assert.ok(productionTupleStart >= 0 && productionTupleEnd > productionTupleStart);
  assert.doesNotMatch(
    privacy.sql.slice(productionTupleStart, productionTupleEnd),
    /V3-UNSEALED/iu
  );

  const preflight = privacy.sql.slice(0, firstPermanentDdl);
  for (const v2Fact of [
    /00000000-0000-4000-8000-000000000022/iu,
    /SS-HOSTED-PRIVACY-2026-07-30-V2/iu,
    /b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b/iu,
    /https:\/\/sitesourcery\.com\/legal\/privacy\//iu,
    /2026-07-30T00:00:00Z/iu,
    /retired_at is null/iu
  ]) assert.match(preflight, v2Fact);

  assert.match(
    privacy.sql,
    /create table ss\.legal_document_artifacts \([\s\S]*document_id uuid primary key references ss\.legal_documents\(id\)[\s\S]*artifact_uri text not null unique[\s\S]*artifact_sha256 ss\.sha256_hex not null[\s\S]*byte_count bigint not null check \(byte_count > 0\)[\s\S]*media_type text not null[\s\S]*text\/html; charset=utf-8[\s\S]*created_at timestamptz not null default clock_timestamp\(\)/iu
  );
  assert.match(
    privacy.sql,
    /00000000-0000-4000-8000-000000000022[\s\S]*privacy\/versions\/SS-HOSTED-PRIVACY-2026-07-30-V2\/[\s\S]*b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b[\s\S]*19935[\s\S]*text\/html; charset=utf-8/iu
  );
  assert.match(
    privacy.sql,
    /insert into ss\.legal_documents[\s\S]*00000000-0000-4000-8000-000000000048[\s\S]*release\.version[\s\S]*release\.content_digest::ss\.sha256_hex[\s\S]*release\.content_uri[\s\S]*release\.effective_at[\s\S]*on conflict \(kind, version\) do nothing/iu
  );
  assert.match(
    privacy.sql,
    /00000000-0000-4000-8000-000000000103[\s\S]*release\.website_terms_version[\s\S]*00000000-0000-4000-8000-000000000104[\s\S]*release\.website_terms_content_digest/iu
  );

  assert.match(
    privacy.sql,
    /create table ss\.project_legal_acceptance_receipts \([\s\S]*id uuid primary key[\s\S]*organization_id uuid not null[\s\S]*project_id uuid not null[\s\S]*user_id uuid not null references auth\.users\(id\)[\s\S]*request_id uuid not null[\s\S]*schema_version text not null[\s\S]*sitesourcery\.project-legal-acceptance\/v3[\s\S]*accepted_exact_project_terms_and_acknowledged_privacy[\s\S]*authority_digest ss\.sha256_hex not null[\s\S]*user_agent_digest ss\.sha256_hex[\s\S]*accepted_at timestamptz not null[\s\S]*created_at timestamptz not null default clock_timestamp\(\)[\s\S]*unique \(organization_id, id\)[\s\S]*unique \(project_id, request_id\)/iu
  );
  assert.match(
    privacy.sql,
    /alter table ss\.term_acceptances\s+add column legal_receipt_id uuid[\s\S]*foreign key \(organization_id, legal_receipt_id\)[\s\S]*references ss\.project_legal_acceptance_receipts\(organization_id, id\)/iu
  );

  const expectedTriggers = [
    ["legal_document_artifact_matches_document", "after insert or update on ss.legal_document_artifacts", "ss.validate_legal_document_artifact()"],
    ["legal_document_artifacts_no_update", "before update on ss.legal_document_artifacts", "ss.reject_update()"],
    ["legal_document_artifacts_no_delete", "before delete on ss.legal_document_artifacts", "ss.reject_delete_v48()"],
    ["project_legal_receipt_exact_bundle", "after insert or update on ss.project_legal_acceptance_receipts", "ss.validate_project_legal_acceptance_receipt()"],
    ["project_legal_receipts_no_update", "before update on ss.project_legal_acceptance_receipts", "ss.reject_update()"],
    ["project_legal_receipts_no_delete", "before delete on ss.project_legal_acceptance_receipts", "ss.reject_delete_v48()"],
    ["term_acceptance_legal_receipt_exact_bundle", "after insert on ss.term_acceptances", "ss.validate_project_legal_acceptance_receipt()"],
    ["term_acceptances_no_update_v48", "before update on ss.term_acceptances", "ss.reject_update()"],
    ["term_acceptances_no_delete_v48", "before delete on ss.term_acceptances", "ss.reject_delete_v48()"],
    ["legal_documents_no_delete_v48", "before delete on ss.legal_documents", "ss.reject_delete_v48()"],
    ["project_required_terms_no_delete_v48", "before delete on ss.project_required_terms", "ss.reject_delete_v48()"],
    ["project_required_terms_monotonic_v48", "before update on ss.project_required_terms", "ss.validate_project_required_term_monotonicity()"]
  ];
  for (const [name, timing, functionName] of expectedTriggers) {
    const exact = (value) => value.replaceAll(".", "\\.")
      .replaceAll("(", "\\(").replaceAll(")", "\\)");
    assert.match(
      privacy.sql,
      new RegExp(
        `create (?:constraint )?trigger ${name}[\\s\\S]*${exact(timing)}[\\s\\S]*execute function[\\s\\S]*${exact(functionName)}`,
        "iu"
      ),
      `missing exact ${name}`
    );
  }
  assert.match(
    privacy.sql,
    /project_legal_receipt_exact_bundle[\s\S]*deferrable initially deferred/iu
  );
  assert.match(
    privacy.sql,
    /term_acceptance_legal_receipt_exact_bundle[\s\S]*deferrable initially deferred/iu
  );
  assert.match(
    privacy.sql,
    /legal_document_artifact_matches_document[\s\S]*deferrable initially deferred/iu
  );

  const receiptGuardStart = privacy.sql.indexOf(
    "create function ss.validate_project_legal_acceptance_receipt"
  );
  const receiptGuardEnd = privacy.sql.indexOf("$$;", receiptGuardStart);
  const receiptGuard = privacy.sql.slice(receiptGuardStart, receiptGuardEnd);
  for (const invariant of [
    /count\(\*\) = 3/iu,
    /00000000-0000-4000-8000-000000000103/iu,
    /00000000-0000-4000-8000-000000000048/iu,
    /00000000-0000-4000-8000-000000000104/iu,
    /tg_relid = 'ss\.project_legal_acceptance_receipts'::regclass/iu,
    /tg_relid = 'ss\.term_acceptances'::regclass/iu,
    /acceptance\.organization_id = receipt_record\.organization_id/iu,
    /acceptance\.project_id = receipt_record\.project_id/iu,
    /acceptance\.user_id = receipt_record\.user_id/iu,
    /acceptance\.request_id = receipt_record\.request_id/iu,
    /acceptance\.accepted_at = receipt_record\.accepted_at/iu,
    /acceptance\.legal_receipt_id = receipt_record\.id/iu,
    /project_legal_json_digest\(jsonb_build_object/iu,
    /receipt_record\.authority_digest <> expected_authority_digest/iu
  ]) assert.match(receiptGuard, invariant);

  assert.match(
    privacy.sql,
    /create function ss\.project_legal_json_digest\(value jsonb\)[\s\S]*returns ss\.sha256_hex[\s\S]*immutable[\s\S]*strict[\s\S]*parallel safe[\s\S]*security definer[\s\S]*extensions\.digest[\s\S]*service_custom_build_handoff_canonical_json\(value\)[\s\S]*grant execute on function ss\.project_legal_json_digest\(jsonb\)\s+to service_role/iu
  );

  assert.match(
    privacy.sql,
    /to_jsonb\(new\) - 'acceptance_id' is distinct from[\s\S]*new_acceptance\.accepted_at < old_acceptance\.accepted_at[\s\S]*new_acceptance\.effective_at < old_acceptance\.effective_at/iu
  );
  assert.match(
    privacy.sql,
    /alter table ss\.legal_document_artifacts enable row level security[\s\S]*force row level security[\s\S]*legal_document_artifacts_authenticated_read[\s\S]*to authenticated[\s\S]*current_user_id\(\) is not null/iu
  );
  assert.match(
    privacy.sql,
    /alter table ss\.project_legal_acceptance_receipts enable row level security[\s\S]*force row level security[\s\S]*project_legal_acceptance_receipts_service_read[\s\S]*project_legal_acceptance_receipts_service_insert/iu
  );
  assert.match(
    privacy.sql,
    /revoke all on table ss\.legal_document_artifacts[\s\S]*grant select on table ss\.legal_document_artifacts\s+to authenticated, service_role/iu
  );
  assert.match(
    privacy.sql,
    /revoke all on table ss\.project_legal_acceptance_receipts[\s\S]*grant select, insert on table ss\.project_legal_acceptance_receipts\s+to service_role/iu
  );
  assert.match(
    privacy.sql,
    /create function ss\.hosted_runtime_contract_v48\(\)[\s\S]*returns text[\s\S]*language sql[\s\S]*stable[\s\S]*select 'canonical-ss-v48-hosted-joint-legal-v3'[\s\S]*revoke all on function ss\.hosted_runtime_contract_v48\(\)[\s\S]*grant execute on function ss\.hosted_runtime_contract_v48\(\)\s+to service_role/iu
  );
  assert.doesNotMatch(
    privacy.sql,
    /update ss\.legal_documents|delete from ss\.legal_documents|on delete cascade|grant all privileges/iu
  );
});

test("joint legal V4 authority is additive, paired, and exact-receipt released", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name ===
      "202608090105_hosted_joint_legal_v4_authority.sql"
  );
  assert.ok(migration, "missing joint legal V4 authority migration");
  assert.match(migration.sql, /^begin;/iu);
  assert.match(migration.sql, /commit;\s*$/iu);
  assert.match(
    migration.sql,
    /hosted_runtime_contract_v48\(\)[\s\S]*hosted_runtime_contract_v52\(\)[\s\S]*hosted_alakazam_retained_premium_contract\(\)[\s\S]*hosted_publication_control_contract\(\)/iu
  );
  assert.match(
    migration.sql,
    /drop constraint project_legal_acceptance_receipts_schema_version_check[\s\S]*schema_version in \([\s\S]*project-legal-acceptance\/v3[\s\S]*project-legal-acceptance\/v4/iu
  );
  assert.match(
    migration.sql,
    /create or replace function ss\.validate_project_legal_acceptance_receipt\(\)[\s\S]*project-legal-authority\/v3[\s\S]*project-legal-authority\/v4[\s\S]*00000000-0000-4000-8000-000000000049[\s\S]*00000000-0000-4000-8000-000000000105[\s\S]*00000000-0000-4000-8000-000000000106/iu
  );
  assert.match(
    migration.sql,
    /create function ss\.hosted_runtime_contract_v53\(\)[\s\S]*canonical-ss-v53-joint-legal-v4-authority[\s\S]*grant execute on function ss\.hosted_runtime_contract_v53\(\)\s+to service_role/iu
  );
  assert.match(
    migration.sql,
    /hosted_joint_legal_v4_v3_fingerprint[\s\S]*is distinct from[\s\S]*Released joint legal V4 migration changed V3 evidence or failed exact release authority/iu
  );
  assert.match(
    migration.sql,
    /hosted_joint_legal_v4_release_constants[\s\S]*SS-HOSTED-PRIVACY-2026-08-09-V4[\s\S]*2f9edca746f9bffc1dc4b6745613ae42c04813a3ac94cd2e8432e964cfa36e99[\s\S]*31451[\s\S]*SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4[\s\S]*4c937f54ae5805a15a9ae835d0266973fb8e8117065dbfce2030ff3f189ff642[\s\S]*26215[\s\S]*ba2871701541ca78e29a9fef313a3e335e7fed571590eb319667c763a7cd3968/iu
  );
  assert.match(
    migration.sql,
    /insert into ss\.legal_documents[\s\S]*00000000-0000-4000-8000-000000000049[\s\S]*00000000-0000-4000-8000-000000000105[\s\S]*00000000-0000-4000-8000-000000000106/iu
  );
  assert.match(
    migration.sql,
    /insert into ss\.legal_document_artifacts[\s\S]*00000000-0000-4000-8000-000000000049[\s\S]*00000000-0000-4000-8000-000000000106[\s\S]*artifact\.document_id =\s*'00000000-0000-4000-8000-000000000105'::uuid/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /update ss\.legal_documents|delete from ss\.legal_documents|update ss\.legal_document_artifacts|delete from ss\.legal_document_artifacts/iu
  );
});

test("customer engagement bootstrap is additive, actor-bound, and default-deny", async () => {
  const migration = (await migrations()).find(
    ({ name }) =>
      name === "202608100106_customer_engagement_bootstrap.sql"
  );
  assert.ok(migration, "missing customer engagement bootstrap migration");
  assert.match(migration.sql, /^begin;/iu);
  assert.match(migration.sql, /commit;\s*$/iu);
  assert.match(
    migration.sql,
    /hosted_runtime_contract_v53\(\)[\s\S]*canonical-ss-v53-joint-legal-v4-authority/iu
  );
  assert.match(
    migration.sql,
    /create table ss\.customer_engagement_invitations[\s\S]*direct_custom_inquiry[\s\S]*delivered_assessment_successor[\s\S]*legal_authority_digest ss\.sha256_hex[\s\S]*token_digest ss\.sha256_hex[\s\S]*issue_request_digest ss\.sha256_hex/iu
  );
  assert.match(
    migration.sql,
    /create table ss\.customer_engagements[\s\S]*project_legal_receipt_id uuid not null[\s\S]*engagement_digest ss\.sha256_hex[\s\S]*references ss\.project_legal_acceptance_receipts/iu
  );
  assert.match(
    migration.sql,
    /guard_customer_engagement_invitation[\s\S]*current_service_actor_kind\(\) not in \('operator', 'system'\)[\s\S]*service_case_manage[\s\S]*old\.state <> 'active'[\s\S]*new\.state <> 'claimed'/iu
  );
  assert.match(
    migration.sql,
    /enable row level security;[\s\S]*force row level security;[\s\S]*revoke all on[\s\S]*customer_engagement_invitations[\s\S]*from public, anon, authenticated, service_role/iu
  );
  assert.match(
    migration.sql,
    /create function ss\.hosted_runtime_contract_v106\(\)[\s\S]*canonical-ss-v106-customer-engagement-bootstrap[\s\S]*grant execute on function ss\.hosted_runtime_contract_v106\(\)\s+to service_role/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /alter table ss\.legal_documents|update ss\.legal_documents|delete from ss\.legal_documents|stripe|credit_application|amount_minor/iu
  );
});

test("Alakazam customer publication controls store only exact held revision-bound authorization", async () => {
  const migration = (await migrations()).find(
    ({ name }) =>
      name ===
        "202608080101_alakazam_customer_publication_controls.sql"
  );
  assert.ok(migration, "missing held Alakazam publication controls");
  assert.match(
    migration.sql,
    /begin;[\s\S]*hosted_runtime_contract_v33\(\)[\s\S]*hosted_runtime_contract_v47\(\)[\s\S]*commit;/iu
  );
  assert.match(
    migration.sql,
    /create table ss\.alakazam_customer_publication_commands[\s\S]*subscription_revision bigint not null[\s\S]*authority_operation_id uuid not null[\s\S]*action in \('publish', 'rollback', 'unpublish'\)[\s\S]*state text not null default 'held'[\s\S]*commercial_cutover_not_authorized/iu
  );
  for (const constraint of [
    "alakazam_publication_customer_user_fk",
    "alakazam_publication_project_fk",
    "alakazam_publication_membership_fk",
    "alakazam_publication_subscription_fk",
    "alakazam_publication_operation_fk",
    "alakazam_publication_current_release_fk",
    "alakazam_publication_target_release_fk",
    "alakazam_publication_target_version_fk",
    "alakazam_publication_command_scope_uniq",
    "alakazam_publication_command_digest_uniq",
    "alakazam_publication_revision_check",
    "alakazam_publication_action_check",
    "alakazam_publication_projection_check",
    "alakazam_publication_state_check",
    "alakazam_publication_hold_reason_check",
    "alakazam_publication_current_release_check",
    "alakazam_publication_action_target_check"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`constraint ${constraint}\\b`, "iu"),
      `missing exact held publication constraint ${constraint}`
    );
  }
  assert.match(
    migration.sql,
    /create constraint trigger alakazam_customer_publication_commands_validate[\s\S]*deferrable initially deferred[\s\S]*validate_alakazam_customer_publication_command/iu
  );
  assert.match(
    migration.sql,
    /subscription\.revision = new\.subscription_revision[\s\S]*subscription\.status in \('active', 'grace'\)[\s\S]*projection\.current_release_id is not distinct from[\s\S]*new\.current_release_id/iu
  );
  assert.match(
    migration.sql,
    /version_state\.state = 'accepted_release'[\s\S]*new\.target_artifact_digest <> accepted_artifact_digest[\s\S]*operation\.state = 'published'[\s\S]*release\.id = new\.target_release_id/iu
  );
  assert.match(
    migration.sql,
    /immutable held evidence[\s\S]*before update or delete on ss\.alakazam_customer_publication_commands/iu
  );
  assert.match(
    migration.sql,
    /enable row level security[\s\S]*force row level security[\s\S]*revoke all on table ss\.alakazam_customer_publication_commands[\s\S]*grant select, insert on table[\s\S]*to service_role/iu
  );
  assert.match(
    migration.sql,
    /create function ss\.hosted_alakazam_publication_contract\(\)[\s\S]*canonical-alakazam-customer-publication-held-v1/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /stripe|provider_effects_authorized\s*=\s*true|on delete cascade|create table ss\.alakazam_(?:subscriptions|fulfillment_operations|fulfillment_projection)/iu
  );
});

test("generic publication controls persist exact fulfilled authority and stay Privacy V4 held", async () => {
  const migration = (await migrations()).find(
    ({ name }) =>
      name === "202608080104_publication_control_authority.sql"
  );
  assert.ok(migration, "missing generic publication-control authority");
  assert.match(
    migration.sql,
    /begin;[\s\S]*hosted_alakazam_50_contract\(\)[\s\S]*create table ss\.publication_control_commands[\s\S]*commit;/iu
  );
  for (const fact of [
    "entitlement_revision",
    "entitlement_tier_id",
    "capability",
    "acceptance_event_id",
    "accepted_version_id",
    "accepted_artifact_id",
    "accepted_artifact_digest",
    "screening_id",
    "screening_artifact_digest",
    "licensed_address_id",
    "licensed_hostname",
    "authority_operation_id",
    "authority_serving_revision",
    "target_operation_id",
    "target_serving_revision",
    "authorized_release_id",
    "authority_digest",
    "command_digest"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`\\b${fact}\\b`, "iu"),
      `missing persisted publication fact ${fact}`
    );
  }
  assert.match(
    migration.sql,
    /action in \('publish', 'rollback', 'unpublish'\)[\s\S]*state text not null default 'held'[\s\S]*privacy_v4_and_commercial_cutover_not_authorized/iu
  );
  for (const invariant of [
    /subscription\.revision = new\.entitlement_revision/iu,
    /operation\.capability = new\.capability/iu,
    /operation\.effective_tier_id = subscription\.tier_id/iu
  ]) assert.match(migration.sql, invariant);
  assert.match(
    migration.sql,
    /version_state\.state = 'accepted_release'[\s\S]*acceptance\.state = 'accepted_release'[\s\S]*screening\.stage = 'pre_publication'[\s\S]*screening\.passed/iu
  );
  assert.match(
    migration.sql,
    /address\.kind = 'licensed'[\s\S]*address\.ownership = 'licensed'[\s\S]*address\.state = 'configured'[\s\S]*current_address_id = address\.id/iu
  );
  assert.match(
    migration.sql,
    /create constraint trigger publication_control_commands_validate[\s\S]*deferrable initially deferred[\s\S]*immutable held evidence[\s\S]*before update or delete/iu
  );
  assert.match(
    migration.sql,
    /enable row level security[\s\S]*force row level security[\s\S]*revoke all on table ss\.publication_control_commands[\s\S]*grant select, insert on table ss\.publication_control_commands\s+to service_role/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /on delete cascade|provider_effects_authorized\s*=\s*true|stripe|create table ss\.releases/iu
  );
});

test("professional reversals are additive, evidence-first, monotonic, and provider-effect free", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name ===
      "202608100108_professional_services_reversals.sql"
  );
  assert.ok(migration, "missing professional-services reversal migration");
  assert.match(migration.sql, /^begin;/iu);
  assert.match(migration.sql, /commit;\s*$/iu);
  assert.match(
    migration.sql,
    /hosted_runtime_contract_v47\(\)[\s\S]*hosted_runtime_contract_v53\(\)/iu
  );
  for (const paymentTable of [
    "service_assessment_payment_receipts",
    "service_custom_build_payment_receipts",
    "service_custom_build_change_payment_receipts",
    "service_custom_build_final_payment_receipts"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`references ss\\.${paymentTable}\\(`, "iu"),
      `missing exact receipt FK ${paymentTable}`
    );
  }
  for (const table of [
    "service_professional_payment_lifecycles",
    "service_professional_reversal_evidence",
    "service_professional_reversal_reconciliations"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
  }
  assert.match(
    migration.sql,
    /state text not null default 'active'[\s\S]*state in \('active', 'held', 'terminated'\)[\s\S]*revision bigint not null default 0/iu
  );
  assert.match(
    migration.sql,
    /new\.severity < old\.severity/iu
  );
  assert.match(
    migration.sql,
    /state_rank\(new\.state\)[\s\S]*< ss\.service_professional_state_rank\(old\.state\)/iu
  );
  assert.match(
    migration.sql,
    /evidence_certainty in \('verified', 'ambiguous'\)[\s\S]*reconciliation_required[\s\S]*expected_lifecycle_revision/iu
  );
  for (const consequence of [
    "preserve_records_hold_new_work",
    "preserve_records_terminate_new_work",
    "block_unapplied_credit",
    "freeze_reserved_credit_no_reissue",
    "preserve_settled_credit_no_reissue",
    "hold_effective_quote_authority",
    "terminate_effective_quote_authority"
  ]) {
    assert.match(migration.sql, new RegExp(consequence, "u"));
  }
  assert.match(
    migration.sql,
    /service_payment_reconcile/iu
  );
  assert.match(
    migration.sql,
    /unique \(evidence_id\)[\s\S]*unique \(operator_user_id, command_id\)/iu
  );
  assert.match(
    migration.sql,
    /provider_event_id text not null unique[\s\S]*event replay changed evidence/iu
  );
  assert.match(
    migration.sql,
    /left join lateral \([\s\S]*service_custom_build_quotes[\s\S]*order by selected\.created_at desc, selected\.id desc[\s\S]*limit 1[\s\S]*\) quote on true/iu
  );
  assert.match(
    migration.sql,
    /target_confirmed_outcome like 'refund_%'[\s\S]*evidence\.provider_event_type not in[\s\S]*target_confirmed_outcome like 'dispute_%'[\s\S]*evidence\.provider_event_type not like 'charge\.dispute\.%'/iu
  );
  assert.match(
    migration.sql,
    /enable row level security[\s\S]*force row level security[\s\S]*grant select on table ss\.%I to service_role/iu
  );
  assert.match(
    migration.sql,
    /create function ss\.hosted_runtime_contract_v108\(\)[\s\S]*canonical-ss-v108-professional-services-reversals[\s\S]*grant execute on function ss\.hosted_runtime_contract_v108\(\)\s+to service_role/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /refunds[.]create|charges[.]create|payment_intents[.]create|provider_effect_authorized\s*=\s*true|on delete cascade|grant all privileges/iu
  );
});

test("ACCOUNTING-01 reserves migration 115 as a held projection-only journal", async () => {
  const selected = await migrations();
  const migration = selected.find(
    ({ name }) => name ===
      "202608100115_accounting_purpose_journal.sql"
  );
  assert.ok(migration, "missing ACCOUNTING-01 migration 115");
  assert.match(migration.sql, /^-- ACCOUNTING-01[\s\S]*\bbegin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  assert.match(
    migration.sql,
    /create table ss\.accounting_purpose_journal[\s\S]*unique \(source_relation, source_receipt_id\)/u
  );
  assert.match(
    migration.sql,
    /create function ss\.project_accounting_purpose_journal_v1\(\)/u
  );
  assert.match(
    migration.sql,
    /accounting_purpose_journal_guard[\s\S]*before insert or update or delete/u
  );
  assert.match(
    migration.sql,
    /enable row level security[\s\S]*force row level security/u
  );
  assert.match(
    migration.sql,
    /grant select on table ss\.accounting_purpose_journal to service_role/u
  );
  assert.doesNotMatch(
    migration.sql,
    /grant (?:insert|update|delete).*accounting_purpose_journal|on delete cascade|provider_effects_authorized\s*=\s*true/iu
  );
});

test("MAIL-COMPOSE-FINAL-03 reserves migration 111 for possession-bound identity delivery", async () => {
  const selected = await migrations();
  const identityIndex = selected.findIndex(
    ({ name }) => name ===
      "202608100111_hosted_identity_delivery_acceptance.sql"
  );
  assert.ok(identityIndex > 0);
  assert.deepEqual(
    selected.slice(identityIndex - 1, identityIndex + 7).map(({ name }) => name),
    [
      "202608100110_support_privacy_case_lifecycle.sql",
      "202608100111_hosted_identity_delivery_acceptance.sql",
      "202608100112_operator_work_queue.sql",
      "202608100113_custom_direct_opportunity.sql",
      "202608100114_commerce_transition_notifications.sql",
      "202608100115_accounting_purpose_journal.sql",
      "202608100116_alakazam_policy_authority.sql",
      "202608100117_direct_custom_reversal_normalization.sql"
    ]
  );
  const migration = selected.find(
    ({ name }) =>
      name ===
      "202608100111_hosted_identity_delivery_acceptance.sql"
  );
  assert.ok(migration);
  assert.match(migration.sql, /^begin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  assert.match(
    migration.sql,
    /hosted_registration_requests[\s\S]*mail_delivery_id uuid unique[\s\S]*hosted_mail_deliveries\(id\)[\s\S]*state in \([\s\S]*'provider_accepted'/u
  );
  assert.match(
    migration.sql,
    /hosted_recovery_delivery_requests[\s\S]*recovery_token_id uuid unique[\s\S]*mail_delivery_id uuid unique/u
  );
  assert.match(
    migration.sql,
    /provider acceptance cannot claim registration delivery[\s\S]*provider acceptance cannot claim recovery delivery/u
  );
  assert.match(
    migration.sql,
    /registration activation lacks possession evidence[\s\S]*recovery completion lacks possession evidence/u
  );
  assert.match(
    migration.sql,
    /hosted_identity_delivery_acceptance_contract_v1\(\)[\s\S]*canonical-ss-hosted-identity-delivery-acceptance-v1/u
  );
  assert.doesNotMatch(
    migration.sql,
    /provider_effects_authorized\s*=\s*true|create table auth\.users|create table ss\.hosted_sessions/iu
  );
});

test("DOMAINS-COMPOSE-01 reserves migration 119 for held route and pin persistence", async () => {
  const selected = await migrations();
  const migration = selected.find(
    ({ name }) => name ===
      "202608110119_domain_provider_route_persistence.sql"
  );
  assert.ok(migration, "missing DOMAINS-COMPOSE-01 migration 119");
  assert.match(migration.sql, /^-- DOMAINS-COMPOSE-01[\s\S]*\bbegin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  for (const table of [
    "domain_provider_routes",
    "domain_provider_registration_attempts",
    "domain_provider_pins"
  ]) {
    assert.match(migration.sql, new RegExp(`create table ss\\.${table}`, "u"));
  }
  assert.match(
    migration.sql,
    /fallback_used[\s\S]*fallback_from_provider_code[\s\S]*provider_code <> primary_provider_code/u
  );
  assert.match(
    migration.sql,
    /domain_provider_registration_attempt_guard[\s\S]*domain_provider_pin_exact_route/u
  );
  assert.match(
    migration.sql,
    /project_legal_json_digest\(new\.route_evidence\)[\s\S]*submission outcome is immutable[\s\S]*project_legal_json_digest\(new\.pin_evidence\)/u
  );
  assert.match(
    migration.sql,
    /priceClass'[\s\S]*standard'[\s\S]*premium'[\s\S]*domain-final-charge-evidence\/v1[\s\S]*captureAuthorized'[\s\S]*refundAuthorized'[\s\S]*domain final registrar charge evidence is invalid/u
  );
  assert.match(
    migration.sql,
    /enable row level security[\s\S]*force row level security/u
  );
  assert.match(
    migration.sql,
    /canonical-domain-provider-route-persistence-v1-held/u
  );
  assert.doesNotMatch(
    migration.sql,
    /on delete cascade|grant all privileges|provider_effects_authorized\s*=\s*true|domain:renew|dnsrecords:write/iu
  );
});

test("DOMAINS-LIFECYCLE-PERSISTENCE-04 reserves migration 123 for held canonical lifecycle state", async () => {
  const selected = await migrations();
  const migration = selected.find(
    ({ name }) => name ===
      "202608110123_domain_lifecycle_persistence.sql"
  );
  assert.ok(migration, "missing DOMAINS-LIFECYCLE-PERSISTENCE-04 migration 123");
  assert.match(
    migration.sql,
    /^-- DOMAINS-LIFECYCLE-PERSISTENCE-04[\s\S]*\bbegin;/u
  );
  assert.match(migration.sql, /commit;\s*$/u);
  for (const table of [
    "domain_provider_lifecycle_states",
    "domain_provider_lifecycle_commands"
  ]) {
    assert.match(migration.sql, new RegExp(`create table ss\\.${table}`, "u"));
  }
  assert.match(
    migration.sql,
    /provider_pin_fingerprint[\s\S]*state_digest[\s\S]*command_fingerprint[\s\S]*result_digest/u
  );
  assert.match(
    migration.sql,
    /references ss\.domain_provider_pins\(organization_id, id\)/u
  );
  assert.match(
    migration.sql,
    /expiration cannot move backwards[\s\S]*provider observation conflicts or regresses[\s\S]*invalid domain renewal lifecycle transition[\s\S]*completed domain transfer is irreversible/u
  );
  assert.match(
    migration.sql,
    /providerReference[\s\S]*providerQuoteRef[\s\S]*operationId[\s\S]*providerEffectsAuthorized[\s\S]*paymentEffectsAuthorized[\s\S]*dnsEffectsAuthorized[\s\S]*captureAuthorized[\s\S]*refundAuthorized/u
  );
  assert.match(
    migration.sql,
    /enable row level security[\s\S]*force row level security[\s\S]*grant select, insert, update on ss\.domain_provider_lifecycle_states\s+to service_role/u
  );
  assert.match(
    migration.sql,
    /canonical-domain-provider-lifecycle-persistence-v1-held/u
  );
  assert.doesNotMatch(
    migration.sql,
    /on delete cascade|grant all privileges|provider_effects_authorized\s*=\s*true|payment_effects_authorized\s*=\s*true|dns_effects_authorized\s*=\s*true/iu
  );
});

test("ALAKAZAM-INVOICE-FINALIZATION-01 reserves migration 122 as a provider-readback held lifecycle", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name ===
      "202608110122_alakazam_invoice_finalization.sql"
  );
  assert.ok(migration, "missing Alakazam invoice finalization migration 122");
  assert.match(migration.sql, /^begin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  for (const table of [
    "alakazam_invoice_finalization_observations",
    "alakazam_invoice_finalization_projection"
  ]) {
    assert.match(migration.sql, new RegExp(`create table ss\\.${table}\\b`, "u"));
  }
  assert.match(
    migration.sql,
    /provider_effects_authorized boolean not null default false[\s\S]*check \(not provider_effects_authorized\)/u
  );
  assert.match(
    migration.sql,
    /alakazam_finalization_hold_renewal[\s\S]*alakazam_finalization_hold_fulfillment/u
  );
  assert.match(
    migration.sql,
    /enable row level security[\s\S]*force row level security/u
  );
  assert.doesNotMatch(
    migration.sql,
    /provider_effects_authorized\s*=\s*true|grant .* to (?:anon|authenticated)/iu
  );
});

test("CARE-CORE-01 reserves migration 121 as a wholly held shared ledger", async () => {
  const selected = await migrations();
  const migration = selected.find(
    ({ name }) => name === "202608110121_care_core.sql"
  );
  assert.ok(migration, "missing reserved CARE-CORE-01 migration 121");
  assert.match(migration.sql, /^-- CARE-CORE-01[\s\S]*\bbegin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  for (const relation of [
    "care_catalog_identities",
    "care_commands",
    "care_customer_contracts",
    "care_periods",
    "care_period_scope_claims",
    "care_tickets",
    "care_capacity_entries"
  ]) {
    assert.match(migration.sql, new RegExp(`create table ss\\.${relation}`, "u"));
  }
  assert.match(
    migration.sql,
    /commercial_authority_state in \('exact_held', 'owner_redline_required'\)[\s\S]*availability_state = 'held'/u
  );
  assert.match(
    migration.sql,
    /unique \([\s\S]*provider_scope_digest, starts_on, ends_on[\s\S]*\)/u
  );
  assert.match(
    migration.sql,
    /care_period_scope_one_primary[\s\S]*where claim_mode = 'primary'/u
  );
  assert.match(
    migration.sql,
    /used_carried <> period_record\.carried_units[\s\S]*used_included \+ new\.units > period_record\.included_units/u
  );
  assert.match(
    migration.sql,
    /service_assessment_report_findings[\s\S]*care ticket assessment basis is not authoritative/iu
  );
  assert.match(
    migration.sql,
    /enable row level security[\s\S]*force row level security[\s\S]*hosted_care_core_contract_v1/u
  );
  assert.match(
    migration.sql,
    /revoke all on function ss\.care_actor_is_authorized\(uuid\)[\s\S]*grant execute on function ss\.care_actor_is_authorized\(uuid\)\s+to service_role/u
  );
  assert.doesNotMatch(
    migration.sql,
    /provider_effects_authorized\s+boolean[^\n]*(?:default\s+true|check\s*\(\s*provider_effects_authorized)|grant all privileges|on delete cascade|charges[.]create|payment_intents[.]create/iu
  );
});

test("CARE-COMMERCE-PERSISTENCE-04 reserves migration 124 for held canonical evidence", async () => {
  const selected = await migrations();
  const migration = selected.find(
    ({ name }) => name === "202608110124_care_commerce_persistence.sql"
  );
  assert.ok(migration, "missing reserved CARE-COMMERCE migration 124");
  assert.match(migration.sql, /^-- CARE-COMMERCE-PERSISTENCE-04[\s\S]*\bbegin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  for (const relation of [
    "care_commerce_quotes", "care_commerce_reservations",
    "care_commerce_reservation_events"
  ]) {
    assert.match(migration.sql, new RegExp(`create table ss\\.${relation}`, "u"));
  }
  assert.match(
    migration.sql,
    /unique \(organization_id, quote_id\)[\s\S]*provider_request is null/u
  );
  assert.match(
    migration.sql,
    /alter table ss\.care_commands[\s\S]*'care_quote_create'[\s\S]*'commerce_reservation'/u
  );
  assert.doesNotMatch(
    migration.sql,
    /create table ss\.care_commerce_(?:commands|command_events)/u
  );
  assert.match(
    migration.sql,
    /care_commerce_terminal_purge_allowed[\s\S]*projects_purge_care_commerce/u
  );
  assert.match(
    migration.sql,
    /enable row level security[\s\S]*force row level security[\s\S]*hosted_care_commerce_persistence_contract_v1/u
  );
  assert.doesNotMatch(
    migration.sql,
    /provider_effects_authorized\s+boolean[^\n]*(?:default\s+true|check\s*\(\s*provider_effects_authorized)|grant all privileges|on delete cascade|payment_intents[.]create|charges[.]create/iu
  );
});

test("DIRECT-REVERSAL-02 additively normalizes only direct no-credit Custom receipts", async () => {
  const selected = await migrations();
  const migration = selected.find(
    ({ name }) => name ===
      "202608100117_direct_custom_reversal_normalization.sql"
  );
  assert.ok(migration, "missing DIRECT-REVERSAL-02 migration 117");
  assert.match(migration.sql, /^-- DIRECT-REVERSAL-02[\s\S]*\bbegin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  assert.match(
    migration.sql,
    /create or replace view ss\.service_professional_payment_bindings/iu
  );
  for (const purpose of [
    "custom_build_initial",
    "custom_build_change",
    "custom_build_final"
  ]) {
    assert.equal(
      [...migration.sql.matchAll(new RegExp(`'${purpose}'::text`, "gu"))]
        .length,
      2,
      `${purpose} must retain one credited and add one direct branch`
    );
  }
  assert.equal(
    [...migration.sql.matchAll(/quote\.origin = 'direct'/gu)].length,
    3
  );
  assert.equal(
    [...migration.sql.matchAll(/quote\.credit_selection = 'no_credit'/gu)]
      .length,
    3
  );
  assert.equal([...migration.sql.matchAll(/'none'::text/gu)].length, 3);
  const legacy = selected.find(
    ({ name }) => name ===
      "202608100108_professional_services_reversals.sql"
  );
  assert.ok(legacy);
  const legacyView = legacy.sql.match(
    /create view ss\.service_professional_payment_bindings as\n([\s\S]*?);\n\nrevoke all/u
  )?.[1];
  assert.ok(legacyView, "migration 108 normalized binding view is unavailable");
  const replacementView = migration.sql.match(
    /create or replace view ss\.service_professional_payment_bindings as\n([\s\S]*?);\n\nrevoke all/u
  )?.[1];
  assert.ok(replacementView, "migration 117 replacement binding view is unavailable");
  assert.ok(
    replacementView.startsWith(`${legacyView}\n\nunion all\n\nselect\n`),
    "all migration 108 assessment-backed binding branches must remain byte-stable"
  );
  assert.match(
    migration.sql,
    /invoice\.credit_minor = 0[\s\S]*job\.start_credit_minor = 0/iu
  );
  assert.match(
    migration.sql,
    /revoke all on ss\.service_professional_payment_bindings[\s\S]*from public, anon, authenticated, service_role/iu
  );
  assert.match(
    migration.sql,
    /canonical-direct-custom-reversal-normalization-v1-held/u
  );
  assert.doesNotMatch(
    migration.sql,
    /insert into ss\.service_credit_applications|update ss\.service_credit_applications|provider_effects_authorized\s*=\s*true|charges[.]create|payment_intents[.]create/iu
  );
});

test("commerce notifications are committed-source-bound, MAIL-reserved, and held", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name ===
      "202608100114_commerce_transition_notifications.sql"
  );
  assert.ok(migration, "missing commerce transition notification migration");
  assert.match(migration.sql, /^begin;/iu);
  assert.match(migration.sql, /commit;\s*$/iu);
  assert.match(
    migration.sql,
    /hosted_runtime_contract_v54\(\)[\s\S]*hosted_runtime_contract_v108\(\)[\s\S]*hosted_operator_work_queue_contract_v1\(\)/iu
  );
  assert.match(
    migration.sql,
    /create view ss\.commerce_transition_notification_sources[\s\S]*create table ss\.commerce_transition_notification_outbox/iu
  );
  assert.match(
    migration.sql,
    /new\.state <> 'held'[\s\S]*new\.provider_effects_authorized[\s\S]*new\.delivery_claimed/iu
  );
  assert.match(
    migration.sql,
    /mail\.request_digest = new\.mail_request_digest[\s\S]*mail\.state = 'pending'[\s\S]*mail\.message_type = 'commerce_customer_notification'[\s\S]*mail\.message_type = 'commerce_operator_notification'/iu
  );
  assert.match(
    migration.sql,
    /commerce_transition_notification_reservation_digest\([\s\S]*new\.reservation_digest <>[\s\S]*new\.mail_request_digest/iu
  );
  assert.match(
    migration.sql,
    /enable row level security[\s\S]*force row level security[\s\S]*grant select, insert on ss\.commerce_transition_notification_outbox\s+to service_role/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /provider_effects_authorized\s*=\s*true|delivery_claimed\s*=\s*true|on delete cascade|grant all privileges/iu
  );
});

test("ALAKAZAM-POLICY-01 reserves migration 116 as one held customer-right authority", async () => {
  const selected = await migrations();
  const migration = selected.find(
    ({ name }) => name ===
      "202608100116_alakazam_policy_authority.sql"
  );
  assert.ok(migration, "missing ALAKAZAM-POLICY-01 migration 116");
  assert.match(migration.sql, /^-- ALAKAZAM-POLICY-01[\s\S]*\bbegin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  assert.match(
    migration.sql,
    /create table ss\.alakazam_policy_authorities[\s\S]*SS-ALAKAZAM-POLICY-2026-08-10-V1/iu
  );
  assert.match(
    migration.sql,
    /paymentGraceHours[^\n]*168[\s\S]*retainedExitHours[^\n]*720[\s\S]*exportWindowHours[^\n]*720/iu
  );
  assert.match(
    migration.sql,
    /first_failed_at \+ interval '7 days'[\s\S]*starts_at \+ interval '30 days'/iu
  );
  assert.match(
    migration.sql,
    /provider_confirmed_effective_cancellation[\s\S]*paid_through_boundary_reached[\s\S]*available_export_grant/iu
  );
  assert.match(
    migration.sql,
    /payment_recovered[\s\S]*download_reversal_event_id is null/iu
  );
  assert.match(
    migration.sql,
    /create view ss\.alakazam_policy_subscription_authority_v1[\s\S]*security_invoker = true/iu
  );
  assert.match(
    migration.sql,
    /enable row level security[\s\S]*force row level security[\s\S]*grant select on table ss\.alakazam_policy_authorities to service_role/iu
  );
  assert.match(
    migration.sql,
    /canonical-alakazam-policy-authority-v1-held/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /provider_effects\s+boolean[^\n]*default\s+true|commercial_effects\s+boolean[^\n]*default\s+true|publication_effects\s+boolean[^\n]*default\s+true|charges[.]create|subscriptions[.]create|payment_intents[.]create/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /commerce_v2_download|service_custom|service_assessment/iu
  );
});

test("FIN-004V migration separates six held adjacent contracts, global snapshots, tenant links, and resolutions", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name ===
      "202608130134_adjacent_integration_crosswalks.sql"
  );
  assert.ok(migration, "missing FIN-004V adjacent integration migration");
  assert.match(migration.sql, /^-- FIN-004V[\s\S]*\bbegin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  for (const key of [
    "private_messenger",
    "command_deck",
    "phone_bridge",
    "client_profile_hub",
    "marketing_desk",
    "dell_commercial_engine"
  ]) {
    assert.match(migration.sql, new RegExp(`'${key}'`, "u"));
  }
  for (const column of [
    "read_event_direction",
    "write_effect_direction",
    "authentication_boundary",
    "semantic_idempotency_policy",
    "retry_policy",
    "reconciliation_policy",
    "audit_policy",
    "failure_behavior",
    "held_behavior"
  ]) {
    assert.match(migration.sql, new RegExp(`\\b${column}\\b`, "u"));
  }
  for (const table of [
    "adjacent_integration_system_contracts",
    "adjacent_integration_identity_pairs",
    "adjacent_integration_observation_contracts",
    "adjacent_integration_global_snapshots",
    "adjacent_integration_crosswalks",
    "adjacent_integration_observations",
    "adjacent_integration_crosswalk_resolutions"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
    assert.match(
      migration.sql,
      new RegExp(`alter table ss\\.${table}[\\s\\S]*enable row level security`, "iu")
    );
    assert.match(
      migration.sql,
      new RegExp(`alter table ss\\.${table}[\\s\\S]*force row level security`, "iu")
    );
  }
  assert.match(
    migration.sql,
    /source_snapshot_id[\s\S]*references ss\.adjacent_integration_global_snapshots/iu
  );
  assert.match(
    migration.sql,
    /operator_confirm_link[\s\S]*operator_reject_link[\s\S]*operator_supersede_link[\s\S]*operator_flag_conflict/iu
  );
  assert.match(
    migration.sql,
    /service_custom_build_direct_opportunities[\s\S]*customer_engagements/iu
  );
  assert.match(
    migration.sql,
    /remote_reference !~ '\[\[:space:\]@\]'[\s\S]*\^sha256:\[0-9a-f\]\{64\}\$[\s\S]*\^SSC-[\s\S]*\^SS-/iu
  );
  assert.match(
    migration.sql,
    /semantic_evidence_digest ss\.sha256_hex generated always as/iu
  );
  assert.match(
    migration.sql,
    /adjacent_integration_crosswalk_semantic_digest_v1\([\s\S]*selected_supersedes_crosswalk_id uuid,[\s\S]*selected_initial_state text[\s\S]*'supersedesCrosswalkId', selected_supersedes_crosswalk_id,[\s\S]*'initialState', selected_initial_state/iu
  );
  assert.match(
    migration.sql,
    /initial_state text not null[\s\S]*link_evidence_digest ss\.sha256_hex generated always as/iu
  );
  assert.match(
    migration.sql,
    /adjacent_integration_global_snapshot_semantic_digest_v1\([\s\S]*selected_operator_organization_id uuid[\s\S]*'operatorOrganizationId', selected_operator_organization_id/iu
  );
  assert.match(
    migration.sql,
    /adjacent_integration_crosswalks_remote_linked_unique[\s\S]*remote_entity_kind,[\s\S]*remote_reference_digest,[\s\S]*local_entity_kind[\s\S]*where state = 'linked'/iu
  );
  assert.match(
    migration.sql,
    /adjacent_integration_crosswalks_local_linked_unique[\s\S]*local_entity_kind,[\s\S]*local_entity_id,[\s\S]*remote_entity_kind[\s\S]*where state = 'linked'/iu
  );
  assert.match(
    migration.sql,
    /operator_adjacent_integration_global_snapshots_v1\(\s*selected_system_key text,\s*selected_source_snapshot_id uuid[\s\S]*snapshot\.id = selected_source_snapshot_id/iu
  );
  for (const name of [
    "record_adjacent_integration_global_snapshot_v1",
    "record_adjacent_integration_crosswalk_v1",
    "record_adjacent_integration_observation_v1",
    "record_adjacent_integration_resolution_v1",
    "operator_adjacent_integration_contracts_v1",
    "operator_adjacent_integration_global_snapshots_v1",
    "operator_adjacent_integration_trace_v1",
    "operator_adjacent_integration_review_queue_v1"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`create function ss\\.${name}\\b[\\s\\S]*security definer`, "iu")
    );
  }
  assert.doesNotMatch(
    migration.sql,
    /grant insert on ss\.adjacent_integration_/iu
  );
  assert.match(
    migration.sql,
    /automatic_commands boolean not null[\s\S]*automatic_commands = false[\s\S]*remote_write_effects boolean not null[\s\S]*remote_write_effects = false[\s\S]*provider_effects boolean not null[\s\S]*provider_effects = false/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /phone_number\s+(?:text|varchar)|email_address\s+(?:text|varchar)|message_body\s+(?:text|varchar)|provider_effects\s*=\s*true|remote_write_effects\s*=\s*true|automatic_commands\s*=\s*true/iu
  );
});

test("RESPONDER-COMMERCE-01 persists exact held setup and monthly billing authority", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name ===
      "202608140135_responder_commerce_persistence.sql"
  );
  assert.ok(migration, "missing RESPONDER-COMMERCE-01 migration 135");
  assert.match(migration.sql, /^-- RESPONDER-COMMERCE-01[\s\S]*\bbegin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  for (const table of [
    "responder_commerce_catalog",
    "responder_commerce_commands",
    "responder_commerce_quotes",
    "responder_commerce_reservations",
    "responder_commerce_reservation_events"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
    assert.match(migration.sql, new RegExp(`'${table}'`, "u"));
  }
  assert.match(
    migration.sql,
    /foreach table_name in array array\[[\s\S]*alter table ss\.%I enable row level security[\s\S]*alter table ss\.%I force row level security[\s\S]*revoke all on table ss\.%I from public, anon, authenticated, service_role/iu
  );
  assert.match(
    migration.sql,
    /setup_amount_minor integer not null check \(setup_amount_minor = 30000\)[\s\S]*monthly_amount_minor integer not null check \(monthly_amount_minor = 25000\)[\s\S]*initial_subtotal_minor integer not null check \(initial_subtotal_minor = 55000\)/iu
  );
  assert.match(
    migration.sql,
    /tax_state text not null check \(tax_state = 'disabled_by_owner'\)/iu
  );
  assert.match(
    migration.sql,
    /intended_provider text not null check \(intended_provider = 'stripe'\)/iu
  );
  assert.match(migration.sql, /responder_setup[\s\S]*responder_monthly/iu);
  assert.match(
    migration.sql,
    /responder_quote_create[\s\S]*responder_billing_reserve[\s\S]*responder_reservation_cancel[\s\S]*responder_reservation_ambiguity_hold/iu
  );
  assert.match(
    migration.sql,
    /provider_request jsonb check \(provider_request is null\)[\s\S]*provider_effect_certainty text not null/iu
  );
  assert.match(
    migration.sql,
    /customer_effects_authorized boolean not null[\s\S]*check \(not customer_effects_authorized\)[\s\S]*mail_delivery_effects_authorized boolean not null[\s\S]*payment_effects_authorized boolean not null[\s\S]*provider_effects_authorized boolean not null/iu
  );
  assert.match(
    migration.sql,
    /project_legal_json_digest\(new\.quote_document - 'quoteDigest'\)[\s\S]*project_legal_json_digest\([\s\S]*new\.reservation_document - 'reservationDigest'/iu
  );
  assert.match(
    migration.sql,
    /hosted_responder_commerce_contract_v1\(\)[\s\S]*canonical-responder-commerce-v1-held-30000-25000-no-provider-effect/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /provider_effects_authorized\s*=\s*true|payment_effects_authorized\s*=\s*true|customer_effects_authorized\s*=\s*true|charges[.]create|subscriptions[.]create|payment_intents[.]create|grant all privileges/iu
  );
});

test("FIN-006D persists carrier-preserving Responder forwarding without a loop or external effect", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name ===
      "202608140136_responder_forwarding_onboarding.sql"
  );
  assert.ok(migration, "missing FIN-006D forwarding migration 136");
  assert.match(migration.sql, /^-- FIN-006D[\s\S]*\bbegin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  for (const table of [
    "responder_forwarding_commands",
    "responder_forwarding_onboardings",
    "responder_forwarding_observations"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
    assert.match(
      migration.sql,
      new RegExp(
        `alter table ss\\.${table}\\s+force row level security`,
        "iu"
      )
    );
  }
  assert.match(
    migration.sql,
    /launch_mode text not null check \([\s\S]*conditional_no_answer_forwarding/iu
  );
  assert.match(
    migration.sql,
    /business_line_lookup_digest ss\.sha256_hex[\s\S]*business_line_key_version text/iu
  );
  assert.match(
    migration.sql,
    /carrier_setup_attested[\s\S]*unanswered_forwarding_reached[\s\S]*answered_call_not_forwarded[\s\S]*reply_path_confirmed[\s\S]*stop_path_confirmed[\s\S]*routing_ambiguous/iu
  );
  assert.match(
    migration.sql,
    /event_kind = 'call_received'[\s\S]*voice_arrival_policy =\s*'conditional_no_answer_forwarding'[\s\S]*event_kind = 'missed_call'/iu
  );
  assert.match(
    migration.sql,
    /hosted_responder_forwarding_contract_v1\(\)[\s\S]*canonical-responder-forwarding-v1-carrier-preserving-held-no-loop/iu
  );
  assert.match(
    migration.sql,
    /automatic_carrier_commands boolean not null default false[\s\S]*remote_write_effects boolean not null default false[\s\S]*provider_effects boolean not null default false[\s\S]*message_send_effects boolean not null default false/iu
  );
  assert.match(
    migration.sql,
    /binding[.]number_lookup_digest\s*<>\s*new[.]business_line_lookup_digest/iu
  );
  assert.match(
    migration.sql,
    /add column voice_ingress_role text not null default 'managed_front_door'[\s\S]*conditional_forward_destination/iu
  );
  assert.match(
    migration.sql,
    /binding[.]voice_ingress_role =\s*'conditional_forward_destination'[\s\S]*forwarding_onboarding_unavailable/iu
  );
  assert.match(
    migration.sql,
    /primary key \(organization_id, command_id\)[\s\S]*foreign key \(organization_id, command_id\)/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /phone_number\s+(?:text|varchar)|business_line\s+(?:text|varchar)|carrier_code\s+(?:text|varchar)|automatic_carrier_commands\s*=\s*true|remote_write_effects\s*=\s*true|provider_effects\s*=\s*true|message_send_effects\s*=\s*true|<Dial/iu
  );
});

test("FIN-006E1 persists sealed native-client authority without external effects", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name ===
      "202608140137_responder_native_client_authority.sql"
  );
  assert.ok(migration, "missing FIN-006E1 native-client migration 137");
  assert.match(migration.sql, /^-- FIN-006E1[\s\S]*\bbegin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  for (const table of [
    "responder_native_commands",
    "responder_native_installations",
    "responder_native_push_token_registrations",
    "responder_native_state_transitions"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
    assert.match(
      migration.sql,
      new RegExp(
        `alter table ss\\.${table}\\s+force row level security`,
        "iu"
      )
    );
  }
  assert.match(
    migration.sql,
    /primary key \(organization_id, command_id\)[\s\S]*unique \(organization_id, installation_id, resulting_revision\)/iu
  );
  assert.match(
    migration.sql,
    /token_lookup_digest ss\.sha256_hex not null unique[\s\S]*nonce bytea not null[\s\S]*authentication_tag bytea not null[\s\S]*ciphertext bytea not null/iu
  );
  assert.match(
    migration.sql,
    /responder_native_token_envelope_digest_v1[\s\S]*encode\(selected_ciphertext, 'base64'\)/iu
  );
  assert.match(
    migration.sql,
    /create_installation'[\s\S]*'register_token'[\s\S]*'suspend'[\s\S]*'resume'[\s\S]*'revoke'[\s\S]*resulting_revision = expected_revision \+ 1/iu
  );
  assert.match(
    migration.sql,
    /operation = 'suspend' and reason = 'logout'[\s\S]*operation = 'resume' and reason = 'login'[\s\S]*operation = 'revoke'[\s\S]*device_lost[\s\S]*token_compromise/iu
  );
  assert.match(
    migration.sql,
    /hosted_responder_native_client_contract_v1\(\)[\s\S]*canonical-responder-native-client-v1-held-sealed-token-authority/iu
  );
  assert.match(
    migration.sql,
    /provider_effects boolean not null default false[\s\S]*push_delivery_effects boolean not null default false[\s\S]*voice_call_effects boolean not null default false[\s\S]*carrier_command_effects boolean not null default false[\s\S]*message_send_effects boolean not null default false/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /push_token\s+(?:text|varchar)|device_token\s+(?:text|varchar)|provider_effects\s*=\s*true|push_delivery_effects\s*=\s*true|voice_call_effects\s*=\s*true|carrier_command_effects\s*=\s*true|message_send_effects\s*=\s*true|grant all privileges/iu
  );
});

test("FIN-006E2 seals replayable Voice sessions and retires app tokens safely", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name ===
      "202608160138_responder_native_voice_sessions.sql"
  );
  assert.ok(migration, "missing FIN-006E2 native Voice migration 138");
  assert.match(migration.sql, /^-- FIN-006E2[\s\S]*\bbegin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  for (const table of [
    "responder_native_push_token_retirements",
    "responder_native_voice_sessions"
  ]) {
    assert.match(
      migration.sql,
      new RegExp(`create table ss\\.${table}\\b`, "iu")
    );
    assert.match(
      migration.sql,
      new RegExp(
        `alter table ss\\.${table}\\s+force row level security`,
        "iu"
      )
    );
  }
  assert.match(
    migration.sql,
    /RESPONDER_NATIVE_TOKEN_UNIQUE_CONSTRAINT_MISSING[\s\S]*drop constraint %I[\s\S]*create index responder_native_token_installation_lookup/iu
  );
  assert.match(
    migration.sql,
    /create temporary table responder_native_token_retirement_backfill[\s\S]*lead\(registration\.id\)[\s\S]*insert into ss\.responder_native_push_token_retirements/iu
  );
  assert.match(
    migration.sql,
    /disable trigger responder_native_commands_guard[\s\S]*set token_retirement_id = backfill\.id[\s\S]*enable trigger responder_native_commands_guard[\s\S]*RESPONDER_NATIVE_E1_TOKEN_HISTORY_BACKFILL_FAILED/iu
  );
  assert.match(
    migration.sql,
    /pg_advisory_xact_lock\(hashtextextended\([\s\S]*responder-native-token:[\s\S]*prior_installation\.customer_user_id\s*<>\s*selected_installation\.customer_user_id/iu
  );
  assert.match(
    migration.sql,
    /'retire_token'[\s\S]*responder_native_token_retirement_payload_digest_v1/iu
  );
  assert.match(
    migration.sql,
    /reason in \('token_replaced', 'customer_request'\)/iu
  );
  assert.match(
    migration.sql,
    /responder_native_commands_revision_step_check[\s\S]*resulting_revision = expected_revision \+ 1/iu
  );
  assert.match(
    migration.sql,
    /selected_replacement\.token_lookup_digest[\s\S]*selected_registration\.token_lookup_digest[\s\S]*sitesourcery\.responder-native-token-rotation-evidence\/v1/iu
  );
  assert.match(
    migration.sql,
    /responder_native_voice_session_request_digest_v1[\s\S]*voipRegistrationReferenceDigest[\s\S]*responder_native_voice_session_envelope_digest_v1/iu
  );
  assert.match(
    migration.sql,
    /ciphertext bytea not null[\s\S]*provider_authorization_effects boolean not null default true/iu
  );
  assert.match(
    migration.sql,
    /expires_at = issued_at \+ interval '5 minutes'/iu
  );
  assert.match(
    migration.sql,
    /selected_installation\.platform <> 'ios'[\s\S]*selected_token_operation <> 'register_token'[\s\S]*new\.voip_registration_reference_digest/iu
  );
  assert.match(
    migration.sql,
    /hosted_responder_native_voice_session_contract_v1\(\)[\s\S]*canonical-responder-native-voice-session-v1-sealed-replay-held/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /access_token\s+(?:text|varchar)|push_token\s+(?:text|varchar)|device_token\s+(?:text|varchar)|outgoing_allowed boolean not null default true|provider_effects\s*=\s*true|push_delivery_effects\s*=\s*true|voice_call_effects\s*=\s*true|grant all privileges/iu
  );
});

test("FIN-006E3 binds Android dual-purpose FCM and Voice authority", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name ===
      "202608170139_responder_android_voice_authority.sql"
  );
  assert.ok(migration, "missing FIN-006E3 Android Voice migration 139");
  assert.match(migration.sql, /^-- FIN-006E3[\s\S]*\bbegin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  assert.match(
    migration.sql,
    /token_ownership_digest ss\.sha256_hex[\s\S]*legacy_purpose_bound[\s\S]*physical_v1/iu
  );
  assert.match(
    migration.sql,
    /responder_native_token_payload_digest_v2[\s\S]*tokenOwnershipDigest[\s\S]*responder_native_token_envelope_digest_v2/iu
  );
  assert.match(
    migration.sql,
    /responder-native-token-ownership:[\s\S]*prior\.token_ownership_digest = new\.token_ownership_digest[\s\S]*selected_installation\.platform <> 'android'/iu
  );
  assert.match(
    migration.sql,
    /client_platform text not null default 'ios'[\s\S]*transport text not null default 'twilio_voice_ios'[\s\S]*twilio_voice_android/iu
  );
  assert.match(
    migration.sql,
    /responder_native_voice_session_request_digest_v2[\s\S]*clientPlatform[\s\S]*transport[\s\S]*responder_native_voice_session_envelope_digest_v2/iu
  );
  assert.match(
    migration.sql,
    /lock table ss\.responder_native_voice_sessions in access exclusive mode[\s\S]*expires_at > clock_timestamp\(\)[\s\S]*requires expired FIN-006E2 Voice sessions/iu
  );
  assert.match(
    migration.sql,
    /hosted_responder_android_voice_contract_v1\(\)[\s\S]*canonical-responder-android-voice-v1-fcm-dual-purpose-receipt-bound-held/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /push_token\s+(?:text|varchar)|device_token\s+(?:text|varchar)|outgoing_allowed boolean not null default true|provider_effects\s*=\s*true|push_delivery_effects\s*=\s*true|voice_call_effects\s*=\s*true|grant all privileges/iu
  );
});

test("FIN-007 migration 141 converges held commercial identities without rewriting history", async () => {
  const migration = (await migrations()).find(
    ({ name }) => name ===
      "202608190141_commercial_catalog_convergence.sql"
  );
  assert.ok(migration, "missing FIN-007 commercial convergence migration 141");
  assert.match(migration.sql, /^-- FIN-007:[\s\S]*\bbegin;/u);
  assert.match(migration.sql, /commit;\s*$/u);
  for (const identity of [
    "SS-CUSTOM-SERVICES-2026-08-19.2",
    "SS-PROFESSIONAL-2026.2",
    "SS-TIERS-2026.6",
    "SS-CARE-CORE-2026.2",
    "SS-CARE-COMMERCE-2026.2",
    "SS-COMMERCIAL-2026.6"
  ]) {
    assert.match(migration.sql, new RegExp(identity.replaceAll(".", "\\."), "u"));
  }
  assert.match(
    migration.sql,
    /when 'card' then 35000[\s\S]*when 'card-plus' then 60000[\s\S]*when 'site' then 100000[\s\S]*when 'site-plus' then 160000[\s\S]*when 'signature' then 240000[\s\S]*when 'flagship' then 360000/iu
  );
  assert.match(
    migration.sql,
    /360000 \+ selected_scale_units::bigint \* 24000/iu
  );
  assert.match(
    migration.sql,
    /credit_amount_minor in \(0, 20000, 35000\)[\s\S]*commercial_contract_id = 'SS-CUSTOM-SERVICES-2026-08-19\.2'[\s\S]*tax_state = 'disabled_by_owner'/iu
  );
  assert.match(
    migration.sql,
    /catalog_version in \('SS-CARE-CORE-2026\.1', 'SS-CARE-CORE-2026\.2'\)[\s\S]*'plan_host'[\s\S]*'plan_care_lite'[\s\S]*'plan_care'[\s\S]*'plan_care_plus'[\s\S]*'plan_partner'/iu
  );
  assert.match(
    migration.sql,
    /commercial_catalog_convergence_contract_v1\(\)[\s\S]*canonical-ss-v141-commercial-2026\.6-credit-only-card-held-historical-compatible/iu
  );
  assert.match(
    migration.sql,
    /alter column payment_receipt_id drop not null[\s\S]*start_settlement_kind text generated always as[\s\S]*'credit_only'[\s\S]*start_paid_subtotal_minor = 0/iu
  );
  assert.match(
    migration.sql,
    /subtotal_minor = 0[\s\S]*state = 'credit_settled'[\s\S]*tier_id = 'card'[\s\S]*gross_start_minor = 35000[\s\S]*credit_minor = 35000/iu
  );
  assert.match(
    migration.sql,
    /create or replace function ss\.ensure_service_custom_build_invoice[\s\S]*revision\.start_due_minor = 0[\s\S]*insert into ss\.service_custom_build_jobs[\s\S]*update ss\.service_credit_applications[\s\S]*state = 'settled'/iu
  );
  assert.match(
    migration.sql,
    /not exists \([\s\S]*service_custom_build_checkout_attempts[\s\S]*not exists \([\s\S]*service_custom_build_stripe_events[\s\S]*not exists \([\s\S]*service_custom_build_payment_receipts/iu
  );
  assert.doesNotMatch(
    migration.sql,
    /publication_state\s*,?\s*'live'|availability_state\s*,?\s*'available'|customer_effects_authorized\s*=\s*true|payment_effects_authorized\s*=\s*true|provider_effects_authorized\s*=\s*true/iu
  );
});
