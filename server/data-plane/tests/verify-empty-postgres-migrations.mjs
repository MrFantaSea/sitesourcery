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
        as custom_services_foundation_runtime_contract,
      to_regclass('ss.service_operator_authority_events') is not null
        as service_operator_authority_events,
      to_regclass('ss.service_quotes') is not null
        as service_quotes,
      to_regclass('ss.service_quote_revisions') is not null
        as service_quote_revisions,
      to_regclass('ss.service_quote_lines') is not null
        as service_quote_lines,
      to_regclass('ss.service_quote_line_coverages') is not null
        as service_quote_line_coverages,
      to_regclass('ss.service_quote_review_targets') is not null
        as service_quote_review_targets,
      to_regclass('ss.service_quote_installments') is not null
        as service_quote_installments,
      to_regclass('ss.service_quote_acceptances') is not null
        as service_quote_acceptances,
      to_regprocedure('ss.hosted_runtime_contract_v35()') is not null
        as custom_service_quotes_runtime_contract,
      to_regprocedure('ss.hosted_runtime_contract_v36()') is not null
        as custom_service_customer_commands_runtime_contract,
      to_regclass('ss.service_invoices') is not null
        as service_invoices,
      to_regclass('ss.service_invoice_lines') is not null
        as service_invoice_lines,
      to_regclass('ss.service_payment_reservations') is not null
        as service_payment_reservations,
      to_regprocedure('ss.hosted_runtime_contract_v37()') is not null
        as custom_service_invoices_runtime_contract,
      to_regprocedure(
        'ss.validate_service_case_offering_terminal_state()'
      ) is not null as custom_service_terminal_state_validator,
      to_regclass('ss.service_intake_drafts') is not null
        as service_intake_drafts,
      to_regprocedure('ss.guard_service_intake_draft_insert()') is not null
        as service_intake_draft_insert_guard,
      to_regprocedure('ss.bump_service_intake_draft_revision()') is not null
        as service_intake_draft_revision_guard
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

  const customServiceQuotes = await pool.query(`
    select
      ss.hosted_runtime_contract_v35() =
        'canonical-ss-v35-custom-service-quotes'
        as exact_runtime_marker,
      ss.hosted_runtime_contract_v36() =
        'canonical-ss-v36-custom-service-customer-commands'
        as exact_customer_commands_runtime_marker,
      ss.hosted_runtime_contract_v37() =
        'canonical-ss-v37-custom-service-held-invoices'
        as exact_held_invoice_runtime_marker,
      (
        select count(*) = 11
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege(
              'service_role',
              format('ss.%I', relation.relname),
              'SELECT'
            )
            and not has_table_privilege(
              'service_role',
              format('ss.%I', relation.relname),
              'UPDATE'
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
            and has_table_privilege(
              'service_role',
              format('ss.%I', relation.relname),
              'INSERT'
            ) = (
              relation.relname in (
                'service_quotes',
                'service_quote_revisions',
                'service_quote_acceptances'
              )
            )
          )
          from pg_class relation
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relkind = 'r'
           and relation.relname in (
             'service_operator_authority_events',
             'service_quotes',
             'service_quote_revisions',
             'service_quote_lines',
             'service_quote_line_coverages',
             'service_quote_review_targets',
             'service_quote_installments',
             'service_quote_acceptances',
             'service_invoices',
             'service_invoice_lines',
             'service_payment_reservations'
           )
      ) as exact_security_boundary,
      not exists (
        select 1
          from pg_constraint constraint_record
          join pg_class relation
            on relation.oid = constraint_record.conrelid
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relname in (
             'service_operator_authority_events',
             'service_quotes',
             'service_quote_revisions',
             'service_quote_lines',
             'service_quote_line_coverages',
             'service_quote_review_targets',
             'service_quote_installments',
             'service_quote_acceptances',
             'service_invoices',
             'service_invoice_lines',
             'service_payment_reservations'
           )
           and constraint_record.contype = 'f'
           and constraint_record.confdeltype = 'c'
      ) as retention_safe_foreign_keys,
      (
        select count(*) = 3
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege(
              'service_role', format('ss.%I', relation.relname), 'SELECT'
            )
            and not has_table_privilege(
              'service_role', format('ss.%I', relation.relname), 'INSERT'
            )
            and not has_table_privilege(
              'service_role', format('ss.%I', relation.relname), 'UPDATE'
            )
            and not has_table_privilege(
              'service_role', format('ss.%I', relation.relname), 'DELETE'
            )
          )
          from pg_class relation
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relkind = 'r'
           and relation.relname in (
             'service_invoices',
             'service_invoice_lines',
             'service_payment_reservations'
           )
      )
        and not has_function_privilege(
          'service_role',
          'ss.ensure_service_assessment_invoice(uuid)',
          'EXECUTE'
        )
        and not has_function_privilege(
          'service_role',
          'ss.materialize_service_assessment_invoice()',
          'EXECUTE'
        ) as held_invoice_authority,
      (
        select count(*) = 2
          and bool_and(column_record.is_generated = 'ALWAYS')
          and bool_and(
            column_record.generation_expression like
              '%service_quote_digest%'
          )
          and bool_or(
            column_record.column_name = 'quote_digest'
            and column_record.generation_expression like '%snapshot%'
          )
          and bool_or(
            column_record.column_name = 'disclosure_digest'
            and column_record.generation_expression like
              '%customer_disclosure%'
          )
          from information_schema.columns column_record
         where column_record.table_schema = 'ss'
           and column_record.table_name = 'service_quote_revisions'
           and column_record.column_name in (
             'quote_digest',
             'disclosure_digest'
           )
      ) as database_generated_quote_digests,
      (
        select
          constraint_contract.definitions ~
            'service_amount_minor = 20000'
          and constraint_contract.definitions ~
            'subtotal_minor = 20000'
          and constraint_contract.definitions ~
            'currency = ''USD'''
          and constraint_contract.definitions ~
            'tax_state = ''calculation_required'''
          and constraint_contract.definitions ~
            'payment_schedule = ''full_before_work'''
          and constraint_contract.definitions ~
            'maximum_websites = 1'
          and constraint_contract.definitions ~
            'maximum_representative_pages_or_types = 5'
          and constraint_contract.definitions ~
            'maximum_findings = 10'
          and constraint_contract.definitions like
            '%CHECK (desktop_review_included)%'
          and constraint_contract.definitions like
            '%CHECK (phone_review_included)%'
          and constraint_contract.definitions ~
            'expanded_assessment_state = ''separately_quoted'''
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.service_amount_minor := 20000%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.tax_state := ''calculation_required''%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.payment_schedule := ''full_before_work''%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.maximum_websites := 1%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.maximum_representative_pages_or_types := 5%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.maximum_findings := 10%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.desktop_review_included := true%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.phone_review_included := true%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like
            '%new.expanded_assessment_state := ''separately_quoted''%'
          and lower(
            pg_get_functiondef(
              'ss.materialize_standard_assessment_quote()'::regprocedure
            )
          ) like '%''website_assessment_standard''%'
          and lower(
            pg_get_functiondef(
              'ss.materialize_standard_assessment_quote()'::regprocedure
            )
          ) like '%''before_work''%'
          and lower(
            pg_get_functiondef(
              'ss.service_quote_review_targets_are_canonical(text[])'::regprocedure
            )
          ) like '%cardinality(value) between 1 and 5%'
          from (
            select string_agg(
              pg_get_constraintdef(constraint_record.oid),
              E'\n'
              order by constraint_record.oid
            ) as definitions
              from pg_constraint constraint_record
             where constraint_record.conrelid =
               'ss.service_quote_revisions'::regclass
               and constraint_record.contype = 'c'
          ) constraint_contract
      ) as exact_standard_assessment_terms,
      (
        select
          procedure_record.prosecdef
          and not has_function_privilege(
            'service_role',
            'ss.prepare_service_operator_authority_event()',
            'EXECUTE'
          )
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%event.event_kind = ''grant''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%order by event.event_sequence desc%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote()'::regprocedure
            )
          ) like '%''service_quote_author''%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%''service_quote_author''%'
          and exists (
            select 1
              from pg_trigger trigger_record
             where trigger_record.tgrelid =
               'ss.service_operator_authority_events'::regclass
               and trigger_record.tgname =
                 'service_operator_authority_events_prepare'
               and not trigger_record.tgisinternal
          )
          and exists (
            select 1
              from pg_trigger trigger_record
             where trigger_record.tgrelid =
               'ss.service_operator_authority_events'::regclass
               and trigger_record.tgname =
                 'service_operator_authority_events_immutable'
               and not trigger_record.tgisinternal
          )
          from pg_proc procedure_record
         where procedure_record.oid =
           'ss.service_operator_has_capability(uuid,text,timestamp with time zone)'::regprocedure
      ) as deployment_controlled_operator_authority,
      (
        select
          acceptance_contract.definitions ~
            'source = ''account'''
          and acceptance_contract.definitions ~
            'acceptance_statement = ''accepted_exact_quote_and_delivery_date'''
          and acceptance_contract.definitions ~
            'accepted_by_user_id = customer_user_id'
          and (
            select procedure_record.prosecdef
              from pg_proc procedure_record
             where procedure_record.oid =
               'ss.prepare_service_quote_acceptance()'::regprocedure
          )
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_acceptance()'::regprocedure
            )
          ) like '%claimed_quote_digest is distinct from revision_record.quote_digest%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_acceptance()'::regprocedure
            )
          ) like '%claimed_disclosure_digest is distinct from revision_record.disclosure_digest%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_acceptance()'::regprocedure
            )
          ) like '%ss.current_service_actor_kind() <> ''customer''%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_acceptance()'::regprocedure
            )
          ) like '%service_case.state = ''submitted''%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_acceptance()'::regprocedure
            )
          ) like '%offering.state = ''requested''%'
          and exists (
            select 1
              from pg_trigger trigger_record
             where trigger_record.tgrelid =
               'ss.service_quote_acceptances'::regclass
               and trigger_record.tgname =
                 'service_quote_acceptances_account_authority'
               and trigger_record.tgfoid =
                 'ss.validate_service_account_authority()'::regprocedure
               and not trigger_record.tgisinternal
          )
          from (
            select string_agg(
              pg_get_constraintdef(constraint_record.oid),
              E'\n'
              order by constraint_record.oid
            ) as definitions
              from pg_constraint constraint_record
             where constraint_record.conrelid =
               'ss.service_quote_acceptances'::regclass
               and constraint_record.contype in ('c', 'u')
          ) acceptance_contract
      ) as exact_account_bound_acceptance,
      exists (
        select 1
          from pg_index index_record
          join pg_class index_relation
            on index_relation.oid = index_record.indexrelid
         where index_relation.relnamespace = 'ss'::regnamespace
           and index_relation.relname =
             'service_cases_one_current_assessment'
           and index_record.indrelid = 'ss.service_cases'::regclass
           and index_record.indisunique
           and index_record.indpred is not null
           and pg_get_expr(
             index_record.indpred,
             index_record.indrelid
           ) like '%draft%'
           and pg_get_expr(
             index_record.indpred,
             index_record.indrelid
           ) like '%submitted%'
      ) as one_current_assessment_case,
      (
        select count(*) = 2
          and bool_and(trigger_record.tgdeferrable)
          and bool_and(trigger_record.tginitdeferred)
          and bool_and(
            trigger_record.tgfoid =
              'ss.validate_service_case_offering_terminal_state()'::regprocedure
          )
          from pg_trigger trigger_record
         where trigger_record.tgname in (
           'service_cases_offering_terminal_state',
           'service_case_offerings_terminal_state'
         )
           and not trigger_record.tgisinternal
      ) as withdrawn_offering_fence,
      exists (
        select 1
          from pg_class relation
         where relation.oid = 'ss.service_intake_drafts'::regclass
           and relation.relrowsecurity
           and relation.relforcerowsecurity
           and has_table_privilege(
             'service_role', relation.oid, 'SELECT'
           )
           and has_table_privilege(
             'service_role', relation.oid, 'INSERT'
           )
           and has_table_privilege(
             'service_role', relation.oid, 'UPDATE'
           )
           and not has_table_privilege(
             'service_role', relation.oid, 'DELETE'
           )
           and not has_table_privilege(
             'service_role', relation.oid, 'TRUNCATE'
           )
           and not has_table_privilege(
             'authenticated', relation.oid, 'SELECT'
           )
           and not has_table_privilege(
             'anon', relation.oid, 'SELECT'
           )
      ) as intake_draft_security,
      (
        select count(*) = 3
          and bool_and(not trigger_record.tgisinternal)
          from pg_trigger trigger_record
         where trigger_record.tgrelid =
           'ss.service_intake_drafts'::regclass
           and trigger_record.tgname in (
             'service_intake_drafts_insert_guard',
             'service_intake_drafts_revision',
             'service_intake_drafts_account_authority'
           )
      ) as intake_draft_triggers,
      exists (
        select 1
          from information_schema.columns column_record
         where column_record.table_schema = 'ss'
           and column_record.table_name = 'service_intake_drafts'
           and column_record.column_name = 'facts_digest'
           and column_record.is_generated = 'ALWAYS'
           and column_record.generation_expression like
             '%service_intake_facts_digest%'
      ) as intake_draft_digest
  `);
  for (const [name, ready] of Object.entries(customServiceQuotes.rows[0])) {
    assert.equal(
      ready,
      true,
      `custom-service quote migration contract failed: ${name}`
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
