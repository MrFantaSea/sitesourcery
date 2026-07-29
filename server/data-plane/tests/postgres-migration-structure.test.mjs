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
