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
      to_regclass('ss.service_assessment_checkout_attempts') is not null
        as service_assessment_checkout_attempts,
      to_regprocedure('ss.hosted_runtime_contract_v38()') is not null
        as custom_service_assessment_checkout_runtime_contract,
      to_regprocedure(
        'ss.guard_service_assessment_checkout_attempt()'
      ) is not null as service_assessment_checkout_guard,
      to_regclass('ss.service_assessment_stripe_events') is not null
        as service_assessment_stripe_events,
      to_regclass('ss.service_assessment_payment_receipts') is not null
        as service_assessment_payment_receipts,
      to_regclass('ss.service_assessment_jobs') is not null
        as service_assessment_jobs,
      to_regprocedure('ss.hosted_runtime_contract_v39()') is not null
        as custom_service_assessment_settlement_runtime_contract,
      to_regprocedure(
        'ss.guard_service_assessment_stripe_event()'
      ) is not null as service_assessment_stripe_event_guard,
      to_regprocedure(
        'ss.guard_service_assessment_settlement_insert()'
      ) is not null as service_assessment_settlement_insert_guard,
      to_regclass('ss.service_document_payloads') is not null
        as service_document_payloads,
      to_regclass('ss.service_assessment_evidence') is not null
        as service_assessment_evidence,
      to_regclass('ss.service_assessment_finding_drafts') is not null
        as service_assessment_finding_drafts,
      to_regclass('ss.service_assessment_reports') is not null
        as service_assessment_reports,
      to_regclass('ss.service_assessment_report_findings') is not null
        as service_assessment_report_findings,
      to_regclass('ss.service_credit_grants') is not null
        as service_credit_grants,
      to_regprocedure('ss.hosted_runtime_contract_v40()') is not null
        as custom_service_assessment_delivery_runtime_contract,
      to_regprocedure(
        'ss.materialize_service_assessment_delivery()'
      ) is not null as service_assessment_delivery_materializer,
      to_regclass('ss.service_custom_build_quotes') is not null
        as service_custom_build_quotes,
      to_regclass('ss.service_custom_build_quote_revisions') is not null
        as service_custom_build_quote_revisions,
      to_regclass('ss.service_custom_build_quote_base_lines') is not null
        as service_custom_build_quote_base_lines,
      to_regclass('ss.service_custom_build_quote_installments') is not null
        as service_custom_build_quote_installments,
      to_regclass('ss.service_custom_build_quote_commands') is not null
        as service_custom_build_quote_commands,
      to_regclass('ss.service_custom_build_quote_acceptances') is not null
        as service_custom_build_quote_acceptances,
      to_regclass('ss.service_credit_applications') is not null
        as service_credit_applications,
      to_regclass('ss.service_custom_build_quote_voids') is not null
        as service_custom_build_quote_voids,
      to_regprocedure('ss.hosted_runtime_contract_v41()') is not null
        as custom_build_quote_credit_runtime_contract,
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
        'UPDATE'
      ) and has_table_privilege(
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
      ss.hosted_runtime_contract_v38() =
        'canonical-ss-v38-custom-service-assessment-checkout'
        as exact_assessment_checkout_runtime_marker,
      ss.hosted_runtime_contract_v39() =
        'canonical-ss-v39-custom-service-assessment-settlement'
        as exact_assessment_settlement_runtime_marker,
      (
        select count(*) = 1
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege(
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
              'authenticated', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'UPDATE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'TRUNCATE'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'SELECT'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'UPDATE'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'TRUNCATE'
            )
          )
          from pg_class relation
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relkind = 'r'
           and relation.relname =
             'service_assessment_checkout_attempts'
      )
        and (
          select count(*) = 2
            and array_agg(
              trigger_record.tgname
              order by trigger_record.tgname
            ) = array[
              'service_assessment_checkout_attempt_guard',
              'service_assessment_checkout_attempt_no_delete'
            ]::name[]
            and bool_and(trigger_record.tgenabled = 'O')
            and bool_and(
              case trigger_record.tgname
                when 'service_assessment_checkout_attempt_guard' then
                  trigger_record.tgfoid = to_regprocedure(
                    'ss.guard_service_assessment_checkout_attempt()'
                  )
                  and trigger_record.tgtype = 23
                  and pg_get_triggerdef(
                    trigger_record.oid, false
                  ) =
                    'CREATE TRIGGER service_assessment_checkout_attempt_guard BEFORE INSERT OR UPDATE ON ss.service_assessment_checkout_attempts FOR EACH ROW EXECUTE FUNCTION ss.guard_service_assessment_checkout_attempt()'
                when 'service_assessment_checkout_attempt_no_delete' then
                  trigger_record.tgfoid = to_regprocedure(
                    'ss.reject_update()'
                  )
                  and trigger_record.tgtype = 11
                  and pg_get_triggerdef(
                    trigger_record.oid, false
                  ) =
                    'CREATE TRIGGER service_assessment_checkout_attempt_no_delete BEFORE DELETE ON ss.service_assessment_checkout_attempts FOR EACH ROW EXECUTE FUNCTION ss.reject_update()'
                else false
              end
            )
            from pg_trigger trigger_record
            join pg_class trigger_relation
              on trigger_relation.oid = trigger_record.tgrelid
            join pg_namespace trigger_namespace
              on trigger_namespace.oid =
                trigger_relation.relnamespace
           where trigger_namespace.nspname = 'ss'
             and trigger_relation.relname =
               'service_assessment_checkout_attempts'
             and not trigger_record.tgisinternal
        )
        and exists (
          select 1
            from pg_constraint constraint_record
            join pg_class constraint_relation
              on constraint_relation.oid =
                constraint_record.conrelid
            join pg_namespace constraint_namespace
              on constraint_namespace.oid =
                constraint_relation.relnamespace
           where constraint_namespace.nspname = 'ss'
             and constraint_relation.relname =
               'service_assessment_checkout_attempts'
             and constraint_record.contype = 'u'
             and pg_get_constraintdef(
               constraint_record.oid
             ) = 'UNIQUE (checkout_session_id)'
        )
        and (
          select count(*) = 1
            and bool_and(index_record.indisunique)
            and bool_and(index_record.indisvalid)
            and bool_and(index_record.indisready)
            and bool_and(index_record.indislive)
            and bool_and(not index_record.indnullsnotdistinct)
            and bool_and(index_record.indnkeyatts = 1)
            and bool_and(index_record.indnatts = 1)
            and bool_and(index_record.indexprs is null)
            and bool_and(
              index_record.indkey[0] =
                indexed_attribute.attnum
            )
            and bool_and(index_method.amname = 'btree')
            and bool_and(
              pg_get_expr(
                index_record.indpred,
                index_record.indrelid,
                false
              ) =
                '(state = ANY (ARRAY[''provider_pending''::text, ''ready''::text, ''persistence_unknown''::text]))'
            )
            from pg_index index_record
            join pg_class index_relation
              on index_relation.oid = index_record.indexrelid
            join pg_class indexed_relation
              on indexed_relation.oid = index_record.indrelid
            join pg_namespace index_namespace
              on index_namespace.oid =
                index_relation.relnamespace
            join pg_am index_method
              on index_method.oid = index_relation.relam
            join pg_attribute indexed_attribute
              on indexed_attribute.attrelid =
                indexed_relation.oid
             and indexed_attribute.attname = 'invoice_id'
             and not indexed_attribute.attisdropped
           where index_namespace.nspname = 'ss'
             and indexed_relation.relnamespace =
               index_namespace.oid
             and indexed_relation.relname =
               'service_assessment_checkout_attempts'
             and index_relation.relname =
               'service_assessment_checkout_one_active'
        ) as exact_assessment_checkout_security,
      (
        select count(*) = 3
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege(
              'service_role', relation.oid, 'SELECT'
            )
            and has_table_privilege(
              'service_role', relation.oid, 'INSERT'
            )
            and has_table_privilege(
              'service_role', relation.oid, 'UPDATE'
            ) = (
              relation.relname =
                'service_assessment_stripe_events'
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
              'authenticated', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'UPDATE'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'SELECT'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'UPDATE'
            )
          )
          from pg_class relation
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relkind = 'r'
           and relation.relname in (
             'service_assessment_stripe_events',
             'service_assessment_payment_receipts',
             'service_assessment_jobs'
           )
      )
        and (
          select count(*) = 6
            from pg_trigger trigger_record
            join pg_class trigger_relation
              on trigger_relation.oid = trigger_record.tgrelid
            join pg_namespace trigger_namespace
              on trigger_namespace.oid =
                trigger_relation.relnamespace
           where trigger_namespace.nspname = 'ss'
             and trigger_relation.relname in (
               'service_assessment_stripe_events',
               'service_assessment_payment_receipts',
               'service_assessment_jobs'
             )
             and not trigger_record.tgisinternal
        )
        and not exists (
          select 1
            from pg_constraint constraint_record
            join pg_class constraint_relation
              on constraint_relation.oid =
                constraint_record.conrelid
            join pg_namespace constraint_namespace
              on constraint_namespace.oid =
                constraint_relation.relnamespace
           where constraint_namespace.nspname = 'ss'
             and constraint_relation.relname in (
               'service_assessment_stripe_events',
               'service_assessment_payment_receipts',
               'service_assessment_jobs'
             )
             and constraint_record.contype = 'f'
             and constraint_record.confdeltype = 'c'
        ) as exact_assessment_settlement_security,
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

  const assessmentDelivery = await pool.query(`
    select
      ss.hosted_runtime_contract_v40() =
        'canonical-ss-v40-custom-service-assessment-delivery'
        as exact_runtime_marker,
      (
        select count(*) = 6
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege('service_role', relation.oid, 'SELECT')
            and not has_table_privilege('service_role', relation.oid, 'DELETE')
            and not has_table_privilege('service_role', relation.oid, 'TRUNCATE')
            and not has_table_privilege('authenticated', relation.oid, 'SELECT')
            and not has_table_privilege('authenticated', relation.oid, 'INSERT')
            and not has_table_privilege('anon', relation.oid, 'SELECT')
            and not has_table_privilege('anon', relation.oid, 'INSERT')
            and has_table_privilege('service_role', relation.oid, 'INSERT') =
              relation.relname in (
                'service_document_payloads',
                'service_assessment_evidence',
                'service_assessment_finding_drafts',
                'service_assessment_reports'
              )
            and has_table_privilege('service_role', relation.oid, 'UPDATE') =
              (relation.relname = 'service_assessment_finding_drafts')
          )
          from pg_class relation
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relkind = 'r'
           and relation.relname in (
             'service_document_payloads',
             'service_assessment_evidence',
             'service_assessment_finding_drafts',
             'service_assessment_reports',
             'service_assessment_report_findings',
             'service_credit_grants'
           )
      ) as exact_security_boundary,
      has_table_privilege(
        'service_role', 'ss.service_documents', 'INSERT'
      )
        and not has_table_privilege(
          'service_role', 'ss.service_documents', 'UPDATE'
        )
        and not has_table_privilege(
          'service_role', 'ss.service_documents', 'DELETE'
        )
        and not has_table_privilege(
          'service_role', 'ss.service_documents', 'TRUNCATE'
        ) as append_only_document_authority,
      (
        select count(*) = 2
          and bool_and(column_record.is_generated = 'ALWAYS')
          from information_schema.columns column_record
         where column_record.table_schema = 'ss'
           and column_record.table_name = 'service_document_payloads'
           and column_record.column_name in ('content_digest', 'byte_count')
      ) as payload_facts_are_database_generated,
      (
        select count(*) = 15
          from pg_trigger trigger_record
          join pg_class relation on relation.oid = trigger_record.tgrelid
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relname in (
             'service_documents',
             'service_document_payloads',
             'service_assessment_evidence',
             'service_assessment_finding_drafts',
             'service_assessment_reports',
             'service_assessment_report_findings',
             'service_credit_grants'
           )
           and trigger_record.tgname in (
             'service_documents_immutable',
             'service_documents_assessment_guard',
             'service_document_payloads_immutable',
             'service_document_payloads_guard',
             'service_assessment_evidence_guard',
             'service_assessment_evidence_immutable',
             'service_assessment_finding_drafts_guard',
             'service_assessment_finding_drafts_no_delete',
             'service_assessment_reports_guard',
             'service_assessment_reports_immutable',
             'service_assessment_reports_materialize',
             'service_assessment_report_findings_immutable',
             'service_assessment_report_findings_guard',
             'service_credit_grants_guard',
             'service_credit_grants_immutable'
           )
           and not trigger_record.tgisinternal
      ) as retained_work_triggers,
      (
        select procedure_record.prosecdef
          and not has_function_privilege(
            'service_role',
            'ss.materialize_service_assessment_delivery()',
            'EXECUTE'
          )
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%insert into ss.service_credit_grants%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%insert into ss.service_assessment_report_findings%'
          from pg_proc procedure_record
         where procedure_record.oid =
           'ss.materialize_service_assessment_delivery()'::regprocedure
      ) as atomic_report_credit_materializer,
      not exists (
        select 1
          from pg_constraint constraint_record
          join pg_class relation on relation.oid = constraint_record.conrelid
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relname in (
             'service_document_payloads',
             'service_assessment_evidence',
             'service_assessment_finding_drafts',
             'service_assessment_reports',
             'service_assessment_report_findings',
             'service_credit_grants'
           )
           and constraint_record.contype = 'f'
           and constraint_record.confdeltype = 'c'
      ) as retention_safe_foreign_keys
  `);
  for (const [name, ready] of Object.entries(assessmentDelivery.rows[0])) {
    assert.equal(
      ready,
      true,
      `assessment delivery migration contract failed: ${name}`
    );
  }

  const customBuildQuoteCredit = await pool.query(`
    with
    expected_tables(table_name, directly_insertable) as (
      values
        ('service_custom_build_quotes', true),
        ('service_custom_build_quote_revisions', true),
        ('service_custom_build_quote_base_lines', false),
        ('service_custom_build_quote_installments', false),
        ('service_custom_build_quote_commands', true),
        ('service_custom_build_quote_acceptances', true),
        ('service_credit_applications', false),
        ('service_custom_build_quote_voids', true)
    ),
    expected_functions(function_signature, service_role_execute) as (
      values
        ('ss.custom_build_amount_minor(text,integer)', true),
        ('ss.custom_build_payment_schedule(text)', true),
        ('ss.custom_build_scale_units(integer,integer,integer,integer,integer)', true),
        ('ss.custom_build_footprint_is_valid(text,integer,integer,integer,integer,integer,integer)', true),
        ('ss.custom_build_policy_id(text)', true),
        ('ss.custom_build_tier_label(text)', true),
        ('ss.prepare_service_custom_build_quote()', true),
        ('ss.guard_service_custom_build_quote_update()', true),
        ('ss.prepare_service_custom_build_quote_revision()', true),
        ('ss.materialize_service_custom_build_quote()', false),
        ('ss.prepare_service_custom_build_quote_command()', true),
        ('ss.validate_service_custom_build_quote_revision()', true),
        ('ss.prepare_service_custom_build_quote_acceptance()', true),
        ('ss.guard_service_credit_application()', true),
        ('ss.materialize_service_custom_build_acceptance()', false),
        ('ss.prepare_service_custom_build_quote_void()', true),
        ('ss.materialize_service_custom_build_quote_void()', false),
        ('ss.hosted_runtime_contract_v41()', true)
    ),
    expected_triggers(
      table_name,
      trigger_name,
      function_signature,
      is_deferrable
    ) as (
      values
        ('service_custom_build_quotes', 'service_custom_build_quotes_prepare', 'ss.prepare_service_custom_build_quote()', false),
        ('service_custom_build_quotes', 'service_custom_build_quotes_update_guard', 'ss.guard_service_custom_build_quote_update()', false),
        ('service_custom_build_quotes', 'service_custom_build_quotes_no_delete', 'ss.reject_update()', false),
        ('service_custom_build_quotes', 'service_custom_build_quotes_exact_revision', 'ss.validate_service_custom_build_quote_revision()', true),
        ('service_custom_build_quote_revisions', 'service_custom_build_quote_revisions_prepare', 'ss.prepare_service_custom_build_quote_revision()', false),
        ('service_custom_build_quote_revisions', 'service_custom_build_quote_revisions_immutable', 'ss.reject_update()', false),
        ('service_custom_build_quote_revisions', 'service_custom_build_quote_revisions_materialize', 'ss.materialize_service_custom_build_quote()', false),
        ('service_custom_build_quote_revisions', 'service_custom_build_quote_revisions_exact_append', 'ss.validate_service_custom_build_quote_revision()', true),
        ('service_custom_build_quote_base_lines', 'service_custom_build_quote_base_lines_immutable', 'ss.reject_update()', false),
        ('service_custom_build_quote_installments', 'service_custom_build_quote_installments_immutable', 'ss.reject_update()', false),
        ('service_custom_build_quote_commands', 'service_custom_build_quote_commands_prepare', 'ss.prepare_service_custom_build_quote_command()', false),
        ('service_custom_build_quote_commands', 'service_custom_build_quote_commands_immutable', 'ss.reject_update()', false),
        ('service_custom_build_quote_acceptances', 'service_custom_build_quote_acceptances_prepare', 'ss.prepare_service_custom_build_quote_acceptance()', false),
        ('service_custom_build_quote_acceptances', 'service_custom_build_quote_acceptances_account_authority', 'ss.validate_service_account_authority()', false),
        ('service_custom_build_quote_acceptances', 'service_custom_build_quote_acceptances_materialize', 'ss.materialize_service_custom_build_acceptance()', false),
        ('service_custom_build_quote_acceptances', 'service_custom_build_quote_acceptances_immutable', 'ss.reject_update()', false),
        ('service_credit_applications', 'service_credit_applications_guard', 'ss.guard_service_credit_application()', false),
        ('service_custom_build_quote_voids', 'service_custom_build_quote_voids_prepare', 'ss.prepare_service_custom_build_quote_void()', false),
        ('service_custom_build_quote_voids', 'service_custom_build_quote_voids_materialize', 'ss.materialize_service_custom_build_quote_void()', false),
        ('service_custom_build_quote_voids', 'service_custom_build_quote_voids_immutable', 'ss.reject_update()', false)
    ),
    expected_policies(
      policy_id,
      tier_id,
      display_name,
      pricing_mode,
      amount_minor,
      maximum_pages,
      maximum_sections,
      maximum_layouts,
      maximum_words,
      maximum_media
    ) as (
      values
        ('00000000-0000-4000-8000-000000000411'::uuid, 'card', 'Card Custom website build', 'fixed', 40000::bigint, 1, 5, 1, 500, 2),
        ('00000000-0000-4000-8000-000000000412'::uuid, 'card-plus', 'Card Plus Custom website build', 'fixed', 65000::bigint, 1, 8, 1, 900, 8),
        ('00000000-0000-4000-8000-000000000413'::uuid, 'site', 'Site Custom website build', 'fixed', 120000::bigint, 4, 16, 4, 1800, 12),
        ('00000000-0000-4000-8000-000000000414'::uuid, 'site-plus', 'Site Plus Custom website build', 'fixed', 180000::bigint, 7, 28, 7, 3000, 24),
        ('00000000-0000-4000-8000-000000000415'::uuid, 'signature', 'Signature Custom website build', 'fixed', 280000::bigint, 10, 40, 10, 4500, 36),
        ('00000000-0000-4000-8000-000000000416'::uuid, 'flagship', 'Flagship Custom website build', 'fixed', 400000::bigint, 15, 60, 15, 7000, 60),
        ('00000000-0000-4000-8000-000000000417'::uuid, 'scale', 'Scale Custom website build', 'banded', null::bigint, 30, 120, 30, 14500, 120)
    )
    select
      ss.hosted_runtime_contract_v40() =
        'canonical-ss-v40-custom-service-assessment-delivery'
        as retained_v40_runtime_marker,
      ss.hosted_runtime_contract_v41() =
        'canonical-ss-v41-custom-build-quote-credit'
        as exact_v41_runtime_marker,
      (
        select count(*) = 8
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege('service_role', relation.oid, 'SELECT')
            and has_table_privilege(
              'service_role', relation.oid, 'INSERT'
            ) = expected.directly_insertable
            and not has_table_privilege(
              'service_role', relation.oid, 'UPDATE'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'TRUNCATE'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'REFERENCES'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'TRIGGER'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'SELECT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'UPDATE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'TRUNCATE'
            )
            and not has_table_privilege('anon', relation.oid, 'SELECT')
            and not has_table_privilege('anon', relation.oid, 'INSERT')
            and not has_table_privilege('anon', relation.oid, 'UPDATE')
            and not has_table_privilege('anon', relation.oid, 'DELETE')
            and not has_table_privilege('anon', relation.oid, 'TRUNCATE')
          )
          from expected_tables expected
          join pg_class relation
            on relation.oid = format(
              'ss.%I', expected.table_name
            )::regclass
           and relation.relkind = 'r'
      ) as exact_table_security_boundary,
      (
        select count(*) = 18
          and bool_and(procedure_record.oid is not null)
          and bool_and(
            has_function_privilege(
              'service_role', procedure_record.oid, 'EXECUTE'
            ) = expected.service_role_execute
          )
          and bool_and(not has_function_privilege(
            'authenticated', procedure_record.oid, 'EXECUTE'
          ))
          and bool_and(not has_function_privilege(
            'anon', procedure_record.oid, 'EXECUTE'
          ))
          from expected_functions expected
          join pg_proc procedure_record
            on procedure_record.oid =
              to_regprocedure(expected.function_signature)
      ) as exact_function_boundary,
      (
        select count(*) = 20
          and bool_and(not trigger_record.tgisinternal)
          and bool_and(
            trigger_record.tgdeferrable = expected.is_deferrable
          )
          and bool_and(
            trigger_record.tginitdeferred = expected.is_deferrable
          )
          and (
            select count(*)
              from pg_trigger all_trigger
             where not all_trigger.tgisinternal
               and all_trigger.tgrelid in (
                 select format(
                   'ss.%I', table_record.table_name
                 )::regclass
                   from expected_tables table_record
               )
          ) = 20
          from expected_triggers expected
          join pg_trigger trigger_record
            on trigger_record.tgrelid = format(
              'ss.%I', expected.table_name
            )::regclass
           and trigger_record.tgname = expected.trigger_name
           and trigger_record.tgfoid =
             to_regprocedure(expected.function_signature)
      ) as exact_trigger_boundary,
      (
        select count(*) = 7
          and bool_and(policy.catalog_version = 'SS-PROFESSIONAL-2026.2')
          and bool_and(
            policy.service_key =
              'custom_build_' || replace(expected.tier_id, '-', '_')
          )
          and bool_and(policy.display_name = expected.display_name)
          and bool_and(policy.pricing_mode = expected.pricing_mode)
          and bool_and(policy.billing_cadence = 'one_time')
          and bool_and(policy.currency = 'USD')
          and bool_and(
            policy.unit_amount_minor is not distinct from expected.amount_minor
          )
          and bool_and(policy.unit_label = 'base build')
          and bool_and(policy.minimum_quantity = 1)
          and bool_and(policy.maximum_quantity = 1)
          and bool_and(policy.publication_state = 'held')
          and bool_and(
            policy.scope_boundary_digest =
              ss.service_json_digest(policy.scope_boundary)
          )
          and bool_and(
            policy.scope_boundary #>> '{baseBuild,tierId}' =
              expected.tier_id
          )
          and bool_and(
            policy.scope_boundary #>> '{baseBuild,amountMinor}'
              is not distinct from expected.amount_minor::text
          )
          and bool_and(
            (policy.scope_boundary #>>
              '{baseBuild,limits,craftedPages}')::integer =
                expected.maximum_pages
          )
          and bool_and(
            (policy.scope_boundary #>>
              '{baseBuild,limits,sections}')::integer =
                expected.maximum_sections
          )
          and bool_and(
            (policy.scope_boundary #>>
              '{baseBuild,limits,uniqueLayouts}')::integer =
                expected.maximum_layouts
          )
          and bool_and(
            (policy.scope_boundary #>>
              '{baseBuild,limits,contentWords}')::integer =
                expected.maximum_words
          )
          and bool_and(
            (policy.scope_boundary #>>
              '{baseBuild,limits,suppliedMedia}')::integer =
                expected.maximum_media
          )
          and bool_and(
            policy.scope_boundary -> 'assessmentCredit' =
              jsonb_build_object(
                'amountMinor', 20000,
                'applicationScope', 'custom_base_build',
                'currency', 'USD',
                'maximumApplications', 1,
                'nonCash', true,
                'sameOrganizationAndProjectOnly', true
              )
          )
          and bool_and(
            policy.scope_boundary ->> 'publicCatalogDigest' =
              'c1259ad9efe9fd0909bf431e2f008feb8e6f1fc1e53acd0b34304312358fe1a1'
          )
          and bool_and(
            (policy.scope_boundary ->> 'workmanshipCorrectionDays')::integer = 30
          )
          and bool_and(
            policy.commercial_contract_id =
              'SS-CUSTOM-SERVICES-2026-08-05.1'
          )
          and bool_and(
            policy.commercial_contract_digest =
              '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8'
          )
          and bool_and((
            select count(*) = 4
              from ss.service_catalog_coverage coverage
             where coverage.policy_id = policy.id
               and coverage.boundary_digest = policy.scope_boundary_digest
               and coverage.coverage_mode = 'includes'
               and coverage.scope_identity_kind = 'project'
          ))
          and (
            select count(*) = 7
              from ss.service_catalog_policies custom_policy
             where custom_policy.service_key like 'custom_build_%'
          )
          from expected_policies expected
          join ss.service_catalog_policies policy
            on policy.id = expected.policy_id
      ) as exact_held_catalog,
      ss.custom_build_amount_minor('card', null) = 40000
        and ss.custom_build_amount_minor('card-plus', null) = 65000
        and ss.custom_build_amount_minor('site', null) = 120000
        and ss.custom_build_amount_minor('site-plus', null) = 180000
        and ss.custom_build_amount_minor('signature', null) = 280000
        and ss.custom_build_amount_minor('flagship', null) = 400000
        and ss.custom_build_amount_minor('scale', 1) = 427000
        and ss.custom_build_amount_minor('scale', 15) = 805000
        and ss.custom_build_amount_minor('scale', 0) is null
        and ss.custom_build_amount_minor('scale', 16) is null
        as exact_database_pricing,
      ss.custom_build_scale_units(16, 60, 15, 7000, 60) = 1
        and ss.custom_build_scale_units(15, 64, 15, 7000, 60) = 1
        and ss.custom_build_scale_units(15, 60, 15, 7500, 60) = 1
        and ss.custom_build_scale_units(30, 120, 30, 14500, 120) = 15
        and ss.custom_build_footprint_is_valid(
          'scale', 15, 30, 120, 30, 14500, 120
        )
        and not ss.custom_build_footprint_is_valid(
          'scale', 1, 30, 120, 30, 14500, 120
        )
        and ss.custom_build_payment_schedule('card') = 'full_before_work'
        and ss.custom_build_payment_schedule('site') =
          'half_before_work_half_before_handoff'
        as independently_derived_scale_authority,
      (
        select count(*) = 2
          and bool_and(column_record.is_nullable = 'NO')
          from information_schema.columns column_record
         where column_record.table_schema = 'ss'
           and column_record.table_name = 'service_custom_build_quotes'
           and column_record.column_name in (
             'source_job_id', 'source_report_id'
           )
      )
        and exists (
          select 1
            from pg_constraint constraint_record
           where constraint_record.conrelid =
             'ss.service_custom_build_quotes'::regclass
             and constraint_record.confrelid =
               'ss.service_assessment_reports'::regclass
             and constraint_record.contype = 'f'
             and pg_get_constraintdef(constraint_record.oid) like
               '%organization_id, source_job_id, source_report_id%'
        )
        and (
          select procedure_record.prosecdef
            and lower(pg_get_functiondef(procedure_record.oid)) like
              '%from ss.service_assessment_reports report%'
            and lower(pg_get_functiondef(procedure_record.oid)) like
              '%service_quote_author%'
            and lower(pg_get_functiondef(procedure_record.oid)) like
              '%eligible delivered assessment%'
            from pg_proc procedure_record
           where procedure_record.oid =
             'ss.prepare_service_custom_build_quote()'::regprocedure
        ) as assessment_backed_quote_only,
      (
        select count(*) = 2
          and bool_and(column_record.is_generated = 'ALWAYS')
          from information_schema.columns column_record
         where column_record.table_schema = 'ss'
           and column_record.table_name =
             'service_custom_build_quote_revisions'
           and column_record.column_name in (
             'quote_digest', 'disclosure_digest'
           )
      ) as immutable_revision_digests,
      (
        select procedure_record.prosecdef
          and not has_function_privilege(
            'service_role', procedure_record.oid, 'EXECUTE'
          )
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%insert into ss.service_custom_build_quote_base_lines%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%insert into ss.service_custom_build_quote_installments%'
          from pg_proc procedure_record
         where procedure_record.oid =
           'ss.materialize_service_custom_build_quote()'::regprocedure
      ) as normalized_line_installment_materializer,
      (
        select acceptance_materializer.prosecdef
          and acceptance_preparer.prosecdef
          and not has_function_privilege(
            'service_role', acceptance_materializer.oid, 'EXECUTE'
          )
          and lower(pg_get_functiondef(acceptance_preparer.oid)) like
            '%claimed_quote_digest is distinct from revision_record.quote_digest%'
          and lower(pg_get_functiondef(acceptance_preparer.oid)) like
            '%claimed_disclosure_digest is distinct from revision_record.disclosure_digest%'
          and lower(pg_get_functiondef(acceptance_preparer.oid)) like
            '%credit.organization_id = revision_record.organization_id%'
          and lower(pg_get_functiondef(acceptance_preparer.oid)) like
            '%credit.project_id = revision_record.project_id%'
          and lower(pg_get_functiondef(acceptance_preparer.oid)) like
            '%credit.credit_digest = revision_record.credit_digest%'
          and lower(pg_get_functiondef(acceptance_preparer.oid)) like
            '%credit.acceptance_cutoff = revision_record.credit_acceptance_cutoff%'
          and lower(pg_get_functiondef(acceptance_preparer.oid)) like
            '%for update of credit%'
          and lower(pg_get_functiondef(acceptance_materializer.oid)) like
            '%insert into ss.service_credit_applications%'
          and lower(pg_get_functiondef(acceptance_materializer.oid)) like
            '%''reserved''%'
          and lower(pg_get_functiondef(acceptance_materializer.oid)) like
            '%update ss.service_custom_build_quotes%'
          from pg_proc acceptance_preparer
          cross join pg_proc acceptance_materializer
         where acceptance_preparer.oid =
           'ss.prepare_service_custom_build_quote_acceptance()'::regprocedure
           and acceptance_materializer.oid =
             'ss.materialize_service_custom_build_acceptance()'::regprocedure
      ) as exact_atomic_customer_reservation,
      exists (
        select 1
          from pg_index index_record
          join pg_class index_relation
            on index_relation.oid = index_record.indexrelid
         where index_relation.relnamespace = 'ss'::regnamespace
           and index_relation.relname =
             'service_credit_applications_one_active_grant'
           and index_record.indrelid =
             'ss.service_credit_applications'::regclass
           and index_record.indisunique
           and pg_get_expr(
             index_record.indpred,
             index_record.indrelid
           ) like '%reserved%'
           and pg_get_expr(
             index_record.indpred,
             index_record.indrelid
           ) like '%settled%'
           and pg_get_expr(
             index_record.indpred,
             index_record.indrelid
           ) like '%reconciliation_required%'
      ) as one_active_credit_application,
      (
        select void_preparer.prosecdef
          and void_materializer.prosecdef
          and credit_guard.prosecdef is false
          and lower(pg_get_functiondef(void_preparer.oid)) like
            '%application_record.state <> ''reserved''%'
          and lower(pg_get_functiondef(void_preparer.oid)) like
            '%cannot release a consumed or uncertain credit%'
          and lower(pg_get_functiondef(void_materializer.oid)) like
            '%state = ''released''%'
          and lower(pg_get_functiondef(void_materializer.oid)) like
            '%and state = ''reserved''%'
          and lower(pg_get_functiondef(credit_guard.oid)) like
            '%service_operator_has_capability%'
          and lower(pg_get_functiondef(credit_guard.oid)) like
            '%service_custom_build_quote_voids%'
          from pg_proc void_preparer
          cross join pg_proc void_materializer
          cross join pg_proc credit_guard
         where void_preparer.oid =
           'ss.prepare_service_custom_build_quote_void()'::regprocedure
           and void_materializer.oid =
             'ss.materialize_service_custom_build_quote_void()'::regprocedure
           and credit_guard.oid =
             'ss.guard_service_credit_application()'::regprocedure
      ) as safe_operator_void_release,
      (
        select count(*) = 1
          from information_schema.columns column_record
         where column_record.table_schema = 'ss'
           and column_record.table_name =
             'service_custom_build_quote_revisions'
           and column_record.column_name = 'tax_state'
           and column_record.column_default is null
      )
        and exists (
          select 1
            from pg_constraint constraint_record
           where constraint_record.conrelid =
             'ss.service_custom_build_quote_revisions'::regclass
             and constraint_record.contype = 'c'
             and pg_get_constraintdef(constraint_record.oid) like
               '%tax_state%calculation_required%'
        )
        and not exists (
          select 1
            from information_schema.columns column_record
           where column_record.table_schema = 'ss'
             and column_record.table_name in (
               select table_name from expected_tables
             )
             and column_record.column_name in ('tax_minor', 'total_minor')
        )
        and not exists (
          select 1
            from expected_functions expected
            join pg_proc procedure_record
              on procedure_record.oid =
                to_regprocedure(expected.function_signature)
           where lower(pg_get_functiondef(procedure_record.oid)) ~
             '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+ss\\.(service_invoices|service_invoice_lines|service_payment_reservations|service_assessment_jobs|alakazam_[a-z_]+)'
        ) as no_tax_job_payment_or_provider_effect,
      not exists (
        select 1
          from pg_constraint constraint_record
         where constraint_record.conrelid in (
           select format('ss.%I', table_name)::regclass
             from expected_tables
         )
           and constraint_record.contype = 'f'
           and constraint_record.confdeltype = 'c'
      ) as retention_safe_foreign_keys
  `);
  for (const [name, ready] of Object.entries(customBuildQuoteCredit.rows[0])) {
    assert.equal(
      ready,
      true,
      `custom build quote/credit migration contract failed: ${name}`
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
