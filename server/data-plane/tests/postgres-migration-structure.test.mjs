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
