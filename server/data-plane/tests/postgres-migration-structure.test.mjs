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
