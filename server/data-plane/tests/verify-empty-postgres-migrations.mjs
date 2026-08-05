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

async function verifyPlatformSchema(pool) {
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
        as tier_fulfillment_runtime_contract,
      to_regclass('ss.service_catalog_policies') is not null
        as service_catalog_policies,
      to_regclass('ss.service_catalog_coverage') is not null
        as service_catalog_coverage,
      to_regclass('ss.service_project_profiles') is not null
        as service_project_profiles,
      to_regclass('ss.service_cases') is not null
        as service_cases,
      to_regclass('ss.service_case_offerings') is not null
        as service_case_offerings,
      to_regclass('ss.service_intakes') is not null
        as service_intakes,
      to_regclass('ss.service_documents') is not null
        as service_documents,
      to_regclass('ss.service_access_requests') is not null
        as service_access_requests,
      to_regclass('ss.operator_profiles') is not null
        as operator_profiles,
      to_regclass('ss.operator_permissions') is not null
        as operator_permissions,
      to_regprocedure('ss.hosted_runtime_contract_v34()') is not null
        as custom_services_foundation_runtime_contract
  `);
  for (const [name, exists] of Object.entries(result.rows[0])) {
    assert.equal(exists, true, `missing platform schema object: ${name}`);
  }

  const customServices = await pool.query(`
    select
      ss.hosted_runtime_contract_v34() =
        'canonical-ss-v34-custom-services-foundation'
        as exact_runtime_marker,
      (
        select count(*) = 1
          from ss.service_catalog_policies policy
          join ss.legal_documents document
            on document.id = policy.legal_document_id
         where policy.id = '00000000-0000-4000-8000-000000000341'
           and policy.service_key = 'website_assessment_standard'
           and policy.unit_amount_minor = 20000
           and policy.currency = 'USD'
           and policy.publication_state = 'held'
           and policy.scope_boundary = jsonb_build_object(
             'expandedAssessmentState', 'separately_quoted',
             'maximumFindings', 10,
             'maximumRepresentativePagesOrTypes', 5,
             'maximumWebsites', 1,
             'requiredViewports', jsonb_build_array('desktop', 'phone')
           )
           and policy.scope_boundary_digest =
             ss.service_json_digest(policy.scope_boundary)
           and document.kind = 'custom_services'
           and document.version = 'SS-CUSTOM-SERVICES-2026-08-05.1'
           and document.content_digest =
             '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8'
           and (
             select count(*) = 4
               from ss.service_catalog_coverage coverage
              where coverage.policy_id = policy.id
                and coverage.boundary_digest = policy.scope_boundary_digest
           )
      ) as exact_held_assessment,
      (
        select count(*) = 10
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            not has_table_privilege(
              'authenticated',
              format('ss.%I', relation.relname),
              'SELECT'
            )
            and not has_table_privilege(
              'anon',
              format('ss.%I', relation.relname),
              'INSERT'
            )
            and not has_table_privilege(
              'service_role',
              format('ss.%I', relation.relname),
              'DELETE'
            )
            and not has_table_privilege(
              'service_role',
              format('ss.%I', relation.relname),
              'TRUNCATE'
            )
          )
          from pg_class relation
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relname in (
             'service_catalog_policies',
             'service_catalog_coverage',
             'service_project_profiles',
             'operator_profiles',
             'operator_permissions',
             'service_cases',
             'service_case_offerings',
             'service_intakes',
             'service_documents',
             'service_access_requests'
           )
      ) as exact_security_boundary,
      not exists (
        select 1
          from information_schema.columns
         where table_schema = 'ss'
           and table_name = 'service_intakes'
           and data_type = 'jsonb'
      ) and exists (
        select 1
          from information_schema.columns
         where table_schema = 'ss'
           and table_name = 'service_intakes'
           and column_name = 'facts_digest'
           and is_generated = 'ALWAYS'
      ) as typed_database_digested_intake,
      not exists (
        select 1
          from pg_constraint constraint_record
          join pg_class relation
            on relation.oid = constraint_record.conrelid
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relname like 'service_%'
           and constraint_record.contype = 'f'
           and constraint_record.confdeltype = 'c'
      ) as retention_safe_foreign_keys,
      not has_table_privilege(
        'service_role',
        'ss.operator_profiles',
        'INSERT'
      ) and not has_table_privilege(
        'service_role',
        'ss.operator_permissions',
        'INSERT'
      ) and not has_table_privilege(
        'service_role',
        'ss.service_documents',
        'INSERT'
      ) and not has_table_privilege(
        'service_role',
        'ss.service_access_requests',
        'INSERT'
      ) as held_authority_is_read_only
  `);
  for (const [name, ready] of Object.entries(customServices.rows[0])) {
    assert.equal(
      ready,
      true,
      `custom-services migration contract failed: ${name}`
    );
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
    await verifyPlatformSchema(pool);
    process.stdout.write(
      `Applied ${names.length} migrations to ${
        identity.rows[0].database_name
      }; platform schema is present.\n`
    );
  } finally {
    await pool.end();
  }
}

await main();
