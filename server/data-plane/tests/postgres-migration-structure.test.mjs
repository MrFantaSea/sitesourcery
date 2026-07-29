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
