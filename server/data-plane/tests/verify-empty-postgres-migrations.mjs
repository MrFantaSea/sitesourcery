import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

import pg from "pg";

const { Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_MIGRATION_TEST_URL ?? null;
const MIGRATIONS = new URL(
  "../supabase/migrations/",
  import.meta.url
);

async function applyMigrations(pool) {
  const namespace = await pool.query(
    "select to_regnamespace('ss') is not null as migrated"
  );
  assert.equal(
    namespace.rows[0].migrated,
    false,
    "migration verification requires an empty database without ss"
  );

  const names = (await readdir(MIGRATIONS))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const name of names) {
    try {
      await pool.query(
        await readFile(new URL(name, MIGRATIONS), "utf8")
      );
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    }
  }

  return names;
}

async function verifyAlakazamSchema(pool) {
  const result = await pool.query(`
    select
      to_regclass('ss.alakazam_subscriptions') is not null
        as subscriptions,
      to_regclass('ss.alakazam_change_quotes') is not null
        as change_quotes,
      to_regclass('ss.alakazam_checkout_dispatches') is not null
        as checkout_dispatches,
      to_regclass('ss.alakazam_payment_receipts') is not null
        as payment_receipts,
      to_regclass('ss.alakazam_downgrade_schedules') is not null
        as downgrade_schedules,
      to_regprocedure('ss.hosted_runtime_contract_v23()') is not null
        as subscription_runtime_contract,
      to_regclass('ss.alakazam_customer_provisions') is not null
        as customer_provisions,
      to_regprocedure('ss.hosted_runtime_contract_v24()') is not null
        as customer_runtime_contract,
      to_regprocedure('ss.hosted_runtime_contract_v25()') is not null
        as checkout_runtime_contract,
      to_regprocedure('ss.hosted_runtime_contract_v26()') is not null
        as payment_runtime_contract,
      to_regprocedure('ss.hosted_runtime_contract_v27()') is not null
        as activation_runtime_contract,
      to_regclass('ss.alakazam_upgrade_applications') is not null
        as upgrade_applications,
      to_regprocedure('ss.hosted_runtime_contract_v28()') is not null
        as upgrade_runtime_contract,
      to_regclass('ss.alakazam_one_upgrade_activation') is not null
        as upgrade_activation_index,
      to_regprocedure('ss.hosted_runtime_contract_v29()') is not null
        as upgrade_activation_runtime_contract,
      to_regclass('ss.alakazam_one_downgrade_schedule_event')
        is not null as downgrade_schedule_event_index,
      to_regprocedure('ss.hosted_runtime_contract_v30()') is not null
        as downgrade_dispatch_runtime_contract,
      to_regclass('ss.alakazam_one_downgrade_activation')
        is not null as downgrade_activation_index,
      to_regprocedure('ss.hosted_runtime_contract_v31()') is not null
        as downgrade_activation_runtime_contract,
      to_regclass('ss.alakazam_fulfillment_intents') is not null
        as fulfillment_intents,
      to_regclass('ss.alakazam_fulfillment_operations') is not null
        as fulfillment_operations,
      to_regclass('ss.alakazam_fulfillment_projection') is not null
        as fulfillment_projection,
      to_regprocedure('ss.hosted_runtime_contract_v32()') is not null
        as fulfillment_runtime_contract,
      to_regprocedure('ss.hosted_runtime_contract_v33()') is not null
        as tier_fulfillment_runtime_contract
  `);
  for (const [name, exists] of Object.entries(result.rows[0])) {
    assert.equal(exists, true, `missing Alakazam schema object: ${name}`);
  }
}

async function main() {
  assert.ok(
    DATABASE_URL,
    "SITESOURCERY_PG_MIGRATION_TEST_URL is required"
  );
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 1
  });
  try {
    const identity = await pool.query(
      "select current_database() as database_name"
    );
    const names = await applyMigrations(pool);
    await verifyAlakazamSchema(pool);
    process.stdout.write(
      `Applied ${names.length} migrations to ${
        identity.rows[0].database_name
      }; Alakazam schema is present.\n`
    );
  } finally {
    await pool.end();
  }
}

await main();
