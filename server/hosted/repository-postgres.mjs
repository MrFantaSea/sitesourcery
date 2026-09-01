import pg from "pg";

import { HostedError, invariant } from "./errors.mjs";
import {
  DEFAULT_POSTGRES_BUDGET_POLICY,
  POSTGRES_BUDGET_READINESS_SCHEMA,
  validatePostgresBudgetPolicy
} from "./postgres-budget-config.mjs";

const { Pool } = pg;

const TRANSACTION_ROLES = Object.freeze({
  authenticated: "authenticated",
  service: "service_role"
});
const ISOLATION_LEVELS = Object.freeze({
  "read-committed": "READ COMMITTED",
  "repeatable-read": "REPEATABLE READ",
  serializable: "SERIALIZABLE"
});
const SERVICE_ACTOR_KINDS = new Set(["customer", "operator", "system"]);
const PROJECT_LEGAL_V3_HOLD_FLAGS = new Set([
  "legal_privacy_v3_contract_ready",
  "legal_privacy_v2_artifact_ready",
  "legal_privacy_v3_artifact_ready",
  "legal_acceptance_receipts_ready",
  "legal_privacy_v3_authority_ready"
]);

const READINESS_QUERY = `
  select
    current_database() as database_name,
    to_regnamespace('ss_hosted') is null as shadow_schema_absent,
    to_regclass('auth.users') is not null as users_ready,
    to_regclass('ss.hosted_account_profiles') is not null as identity_ready,
    to_regclass('ss.hosted_password_credentials') is not null as passwords_ready,
    to_regclass('ss.hosted_sessions') is not null as sessions_ready,
    to_regclass('ss.hosted_auth_rate_limits') is not null as auth_limits_ready,
    to_regclass('ss.hosted_registration_requests') is not null
      as registration_ready,
    (
      select count(*) = 4
        from information_schema.columns
       where table_schema = 'ss'
         and table_name = 'hosted_registration_requests'
         and column_name in (
           'token_digest',
           'state',
           'activation_command_id',
           'delivery_receipt_digest'
         )
    ) as registration_contract_ready,
    to_regclass('ss.organizations') is not null as organizations_ready,
    to_regclass('ss.organization_memberships') is not null as memberships_ready,
    to_regclass('ss.projects') is not null as projects_ready,
    to_regclass('ss.project_drafts') is not null as drafts_ready,
    to_regclass('ss.site_versions') is not null as versions_ready,
    to_regclass('ss.project_addresses') is not null as addresses_ready,
    to_regclass('ss.commerce_quotes') is not null as commerce_ready,
    to_regclass('ss.catalog_offer_price_lines') is not null as offer_prices_ready,
    to_regclass('ss.commerce_quote_price_lines') is not null as quote_prices_ready,
    to_regclass('ss.checkout_intent_price_lines') is not null as checkout_prices_ready,
    (
      to_regprocedure('ss.hosted_runtime_contract_v13()') is not null
      and to_regprocedure('ss.hosted_runtime_contract_v14()') is not null
      and to_regprocedure('ss.hosted_runtime_contract_v15()') is not null
    )
      as runtime_contract_ready,
    to_regprocedure('ss.hosted_runtime_contract_v18()') is not null
      as verified_registration_contract_ready,
    to_regclass('ss.hosted_recovery_delivery_requests') is not null
      as recovery_deliveries_ready,
    to_regprocedure('ss.hosted_runtime_contract_v20()') is not null
      as recovery_delivery_contract_ready,
    to_regprocedure('ss.hosted_runtime_contract_v21()') is not null
      as legal_contract_ready,
    (
      select count(*) = 3
        from ss.legal_documents
       where retired_at is null
         and (
           (
             kind = 'product'
             and version = 'SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2'
             and content_digest = 'bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196'
           )
           or (
             kind = 'privacy'
             and version = 'SS-HOSTED-PRIVACY-2026-07-30-V2'
             and content_digest = 'b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b'
           )
           or (
             kind = 'website'
             and version = 'SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2'
             and content_digest = 'bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196'
           )
         )
    ) as legal_authority_ready,
    to_regclass('ss.commerce_v2_commands') is not null
      as commerce_v2_commands_ready,
    to_regclass('ss.commerce_v2_download_quotes') is not null
      as commerce_v2_quotes_ready,
    to_regclass('ss.commerce_v2_checkout_preparations') is not null
      as commerce_v2_preparations_ready,
    to_regprocedure('ss.hosted_runtime_contract_v19()') is not null
      as commerce_v2_contract_ready,
    to_regclass('ss.commerce_v2_download_dispatches') is not null
      as commerce_v2_dispatches_ready,
    to_regclass('ss.commerce_v2_download_stripe_events') is not null
      as commerce_v2_download_events_ready,
    to_regclass('ss.commerce_v2_download_payment_receipts') is not null
      as commerce_v2_download_receipts_ready,
    to_regclass('ss.commerce_v2_project_entitlements') is not null
      as commerce_v2_entitlements_ready,
    to_regclass('ss.commerce_v2_download_reversal_events') is not null
      as commerce_v2_reversals_ready,
    to_regprocedure('ss.hosted_runtime_contract_v22()') is not null
      as commerce_v2_settlement_contract_ready,
    to_regclass('ss.alakazam_subscriptions') is not null
      as alakazam_subscriptions_ready,
    to_regclass('ss.alakazam_change_quotes') is not null
      as alakazam_quotes_ready,
    to_regclass('ss.alakazam_checkout_dispatches') is not null
      as alakazam_dispatches_ready,
    to_regclass('ss.alakazam_stripe_events') is not null
      as alakazam_events_ready,
    to_regclass('ss.alakazam_payment_receipts') is not null
      as alakazam_receipts_ready,
    to_regclass('ss.alakazam_credit_applications') is not null
      as alakazam_credits_ready,
    to_regclass('ss.alakazam_downgrade_schedules') is not null
      as alakazam_downgrades_ready,
    to_regclass('ss.alakazam_tier_change_events') is not null
      as alakazam_tier_events_ready,
    to_regprocedure('ss.hosted_runtime_contract_v23()') is not null
      as alakazam_contract_ready,
    to_regclass('ss.alakazam_customer_provisions') is not null
      as alakazam_customer_provisions_ready,
    to_regprocedure('ss.hosted_runtime_contract_v24()') is not null
      as alakazam_customer_contract_ready,
    to_regprocedure('ss.hosted_runtime_contract_v25()') is not null
      as alakazam_checkout_contract_ready,
    to_regprocedure('ss.hosted_runtime_contract_v26()') is not null
      as alakazam_payment_contract_ready,
    to_regprocedure('ss.hosted_runtime_contract_v27()') is not null
      as alakazam_activation_contract_ready,
    to_regprocedure('ss.hosted_runtime_contract_v28()') is not null
      as alakazam_upgrade_contract_ready,
    to_regprocedure('ss.hosted_runtime_contract_v29()') is not null
      as alakazam_upgrade_activation_contract_ready,
    to_regprocedure('ss.hosted_runtime_contract_v30()') is not null
      as alakazam_downgrade_dispatch_contract_ready,
    to_regprocedure('ss.hosted_runtime_contract_v31()') is not null
      as alakazam_downgrade_activation_contract_ready,
    to_regclass('ss.alakazam_fulfillment_intents') is not null
      as alakazam_fulfillment_intents_ready,
    to_regclass('ss.alakazam_fulfillment_operations') is not null
      as alakazam_fulfillment_operations_ready,
    to_regclass('ss.alakazam_fulfillment_projection') is not null
      as alakazam_fulfillment_projection_ready,
    to_regprocedure('ss.hosted_runtime_contract_v32()') is not null
      as alakazam_fulfillment_contract_ready,
    to_regprocedure('ss.hosted_runtime_contract_v33()') is not null
      as alakazam_tier_fulfillment_contract_ready,
    (
      select count(*) = 10
        from pg_class relation
        join pg_namespace namespace
          on namespace.oid = relation.relnamespace
       where namespace.nspname = 'ss'
         and relation.relkind = 'r'
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
    )
      and to_regprocedure('ss.hosted_runtime_contract_v34()') is not null
      and to_regprocedure('ss.current_service_actor_kind()') is not null
      and to_regprocedure('ss.current_service_actor_user_id()') is not null
      and to_regprocedure('ss.current_service_actor_org_id()') is not null
      as custom_services_schema_ready,
    (
      select count(*) = 8
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
           'service_quote_acceptances'
         )
    )
      and to_regprocedure('ss.hosted_runtime_contract_v35()') is not null
      and to_regprocedure('ss.hosted_runtime_contract_v36()') is not null
      and to_regprocedure('ss.hosted_runtime_contract_v37()') is not null
      and to_regprocedure('ss.hosted_runtime_contract_v38()') is not null
      and to_regprocedure(
        'ss.service_operator_has_capability(uuid,text,timestamp with time zone)'
      ) is not null
      and to_regprocedure('ss.prepare_service_quote_acceptance()') is not null
      and to_regprocedure(
        'ss.validate_service_case_offering_terminal_state()'
      ) is not null
      and to_regclass('ss.service_intake_drafts') is not null
      and to_regprocedure('ss.guard_service_intake_draft_insert()') is not null
      and to_regprocedure('ss.bump_service_intake_draft_revision()') is not null
      and (
        select count(*) = 3
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
      and to_regclass(
        'ss.service_assessment_checkout_attempts'
      ) is not null
      and to_regclass(
        'ss.service_assessment_stripe_events'
      ) is not null
      and to_regclass(
        'ss.service_assessment_payment_receipts'
      ) is not null
      and to_regclass(
        'ss.service_assessment_jobs'
      ) is not null
      and to_regprocedure(
        'ss.hosted_runtime_contract_v39()'
      ) is not null
      and to_regclass('ss.service_document_payloads') is not null
      and to_regclass('ss.service_assessment_evidence') is not null
      and to_regclass('ss.service_assessment_finding_drafts') is not null
      and to_regclass('ss.service_assessment_reports') is not null
      and to_regclass('ss.service_assessment_report_findings') is not null
      and to_regclass('ss.service_credit_grants') is not null
      and to_regprocedure('ss.hosted_runtime_contract_v40()') is not null
      and (
        select count(*) = 8
        from pg_class relation
        join pg_namespace namespace
          on namespace.oid = relation.relnamespace
        where namespace.nspname = 'ss'
          and relation.relkind = 'r'
          and relation.relname in (
            'service_custom_build_quotes',
            'service_custom_build_quote_revisions',
            'service_custom_build_quote_base_lines',
            'service_custom_build_quote_installments',
            'service_custom_build_quote_commands',
            'service_custom_build_quote_acceptances',
            'service_credit_applications',
            'service_custom_build_quote_voids'
          )
      )
      and to_regprocedure('ss.hosted_runtime_contract_v41()') is not null
      as custom_service_quotes_schema_ready,
    to_regclass('ss.release_requests') is not null as releases_ready,
    to_regclass('ss.export_requests') is not null as exports_ready,
    to_regclass('ss.export_download_authorizations') is not null as export_grants_ready,
    to_regclass('ss.audit_events') is not null as audit_ready,
    to_regclass('ss.idempotency_keys') is not null as idempotency_ready
`;

// These two queries are intentionally separate from READINESS_QUERY. The
// global boot query must parse on a pre-v48 database. Only catalog references
// are used until the v48 relations/functions are proven to exist.
const PROJECT_LEGAL_CATALOG_QUERY = `
  select
    case when to_regprocedure('ss.hosted_runtime_contract_v48()') is null
      or to_regprocedure('ss.hosted_runtime_contract_v53()') is null
      or to_regprocedure('ss.hosted_joint_legal_v7_contract()') is null
      or to_regprocedure('ss.project_legal_json_digest(jsonb)') is null
      then false else exists (
        select 1 from pg_proc procedure_row
         where procedure_row.oid =
           to_regprocedure('ss.hosted_runtime_contract_v48()')
           and procedure_row.prokind = 'f'
           and procedure_row.pronargs = 0
           and procedure_row.provolatile = 's'
           and not procedure_row.prosecdef
           and procedure_row.prorettype = 'text'::regtype
           and btrim(procedure_row.prosrc, E' \\t\\n\\r') =
             'select ''canonical-ss-v48-hosted-joint-legal-v3'''
           and not exists (
             select 1
               from aclexplode(coalesce(
                 procedure_row.proacl,
                 acldefault('f', procedure_row.proowner)
               )) privilege
              where privilege.grantee = 0
                and privilege.privilege_type = 'EXECUTE'
           )
           and not has_function_privilege(
             'anon', procedure_row.oid, 'EXECUTE'
           )
           and not has_function_privilege(
             'authenticated', procedure_row.oid, 'EXECUTE'
           )
           and has_function_privilege(
             'service_role', procedure_row.oid, 'EXECUTE'
           )
           and not exists (
             select 1
               from aclexplode(coalesce(
                 procedure_row.proacl,
                 acldefault('f', procedure_row.proowner)
               )) privilege
               left join pg_roles grantee
                 on grantee.oid = privilege.grantee
              where privilege.grantee <> procedure_row.proowner
                and not (
                  grantee.rolname = 'service_role'
                  and privilege.privilege_type = 'EXECUTE'
                  and not privilege.is_grantable
                )
           )
           and (
             select count(*) = 1
               from aclexplode(coalesce(
                 procedure_row.proacl,
                 acldefault('f', procedure_row.proowner)
               )) privilege
              where privilege.grantee <> procedure_row.proowner
           )
      ) and exists (
        select 1 from pg_proc procedure_row
         where procedure_row.oid =
           to_regprocedure('ss.hosted_joint_legal_v7_contract()')
           and procedure_row.prokind = 'f'
           and procedure_row.pronargs = 0
           and procedure_row.provolatile = 's'
           and not procedure_row.prosecdef
           and procedure_row.prorettype = 'text'::regtype
           and btrim(procedure_row.prosrc, E' \\t\\n\\r') =
             'select ''canonical-hosted-joint-legal-v7-authority'''
           and not exists (
             select 1
               from aclexplode(coalesce(
                 procedure_row.proacl,
                 acldefault('f', procedure_row.proowner)
               )) privilege
              where privilege.grantee = 0
                and privilege.privilege_type = 'EXECUTE'
           )
           and not has_function_privilege(
             'anon', procedure_row.oid, 'EXECUTE'
           )
           and not has_function_privilege(
             'authenticated', procedure_row.oid, 'EXECUTE'
           )
           and has_function_privilege(
             'service_role', procedure_row.oid, 'EXECUTE'
           )
           and (
             select count(*) = 1
               from aclexplode(coalesce(
                 procedure_row.proacl,
                 acldefault('f', procedure_row.proowner)
               )) privilege
              where privilege.grantee <> procedure_row.proowner
           )
      ) and exists (
        select 1 from pg_proc procedure_row
         where procedure_row.oid =
           to_regprocedure('ss.hosted_runtime_contract_v53()')
           and procedure_row.prokind = 'f'
           and procedure_row.pronargs = 0
           and procedure_row.provolatile = 's'
           and not procedure_row.prosecdef
           and procedure_row.prorettype = 'text'::regtype
           and btrim(procedure_row.prosrc, E' \\t\\n\\r') =
             'select ''canonical-ss-v53-joint-legal-v4-authority'''
           and not exists (
             select 1
               from aclexplode(coalesce(
                 procedure_row.proacl,
                 acldefault('f', procedure_row.proowner)
               )) privilege
              where privilege.grantee = 0
                and privilege.privilege_type = 'EXECUTE'
           )
           and not has_function_privilege(
             'anon', procedure_row.oid, 'EXECUTE'
           )
           and not has_function_privilege(
             'authenticated', procedure_row.oid, 'EXECUTE'
           )
           and has_function_privilege(
             'service_role', procedure_row.oid, 'EXECUTE'
           )
           and (
             select count(*) = 1
               from aclexplode(coalesce(
                 procedure_row.proacl,
                 acldefault('f', procedure_row.proowner)
               )) privilege
              where privilege.grantee <> procedure_row.proowner
           )
      ) and exists (
        select 1 from pg_proc procedure_row
         where procedure_row.oid =
           to_regprocedure('ss.project_legal_json_digest(jsonb)')
           and procedure_row.prokind = 'f'
           and procedure_row.pronargs = 1
           and procedure_row.provolatile = 'i'
           and procedure_row.prosecdef
           and procedure_row.proisstrict
           and procedure_row.proparallel = 's'
           and procedure_row.prorettype = to_regtype('ss.sha256_hex')
           and lower(pg_get_functiondef(procedure_row.oid)) like
             '%service_custom_build_handoff_canonical_json(value)%'
           and lower(pg_get_functiondef(procedure_row.oid)) like
             '%extensions.digest%'
           and not has_function_privilege(
             'anon', procedure_row.oid, 'EXECUTE'
           )
           and not has_function_privilege(
             'authenticated', procedure_row.oid, 'EXECUTE'
           )
           and has_function_privilege(
             'service_role', procedure_row.oid, 'EXECUTE'
           )
           and not exists (
             select 1
               from aclexplode(coalesce(
                 procedure_row.proacl,
                 acldefault('f', procedure_row.proowner)
               )) privilege
               left join pg_roles grantee
                 on grantee.oid = privilege.grantee
              where privilege.grantee <> procedure_row.proowner
                and not (
                  grantee.rolname = 'service_role'
                  and privilege.privilege_type = 'EXECUTE'
                  and not privilege.is_grantable
                )
           )
           and (
             select count(*) = 1
               from aclexplode(coalesce(
                 procedure_row.proacl,
                 acldefault('f', procedure_row.proowner)
               )) privilege
              where privilege.grantee <> procedure_row.proowner
           )
      ) end as v48_catalog_contract,
    to_regclass('ss.legal_document_artifacts') is not null
      and to_regclass('ss.project_legal_acceptance_receipts') is not null
      as v48_catalog_tables,
    (
      (
        select count(*) = 11
        and bool_and(coalesce(
          attribute_row.attgenerated = ''
          and attribute_row.attidentity = ''
          and case attribute_row.attname
            when 'id' then
              attribute_row.atttypid = 'uuid'::regtype
              and attribute_row.attnotnull and default_row.oid is null
            when 'organization_id' then
              attribute_row.atttypid = 'uuid'::regtype
              and attribute_row.attnotnull and default_row.oid is null
            when 'project_id' then
              attribute_row.atttypid = 'uuid'::regtype
              and attribute_row.attnotnull and default_row.oid is null
            when 'user_id' then
              attribute_row.atttypid = 'uuid'::regtype
              and attribute_row.attnotnull and default_row.oid is null
            when 'request_id' then
              attribute_row.atttypid = 'uuid'::regtype
              and attribute_row.attnotnull and default_row.oid is null
            when 'schema_version' then
              attribute_row.atttypid = 'text'::regtype
              and attribute_row.attnotnull and default_row.oid is null
            when 'acceptance_statement' then
              attribute_row.atttypid = 'text'::regtype
              and attribute_row.attnotnull and default_row.oid is null
            when 'authority_digest' then
              attribute_row.atttypid = to_regtype('ss.sha256_hex')
              and attribute_row.attnotnull and default_row.oid is null
            when 'user_agent_digest' then
              attribute_row.atttypid = to_regtype('ss.sha256_hex')
              and not attribute_row.attnotnull and default_row.oid is null
            when 'accepted_at' then
              attribute_row.atttypid = 'timestamptz'::regtype
              and attribute_row.attnotnull and default_row.oid is null
            when 'created_at' then
              attribute_row.atttypid = 'timestamptz'::regtype
              and attribute_row.attnotnull
              and pg_get_expr(
                default_row.adbin, default_row.adrelid, false
              ) = 'clock_timestamp()'
            else false
          end,
          false
        ))
        from pg_attribute attribute_row
        join pg_class relation on relation.oid = attribute_row.attrelid
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        left join pg_attrdef default_row
          on default_row.adrelid = attribute_row.attrelid
         and default_row.adnum = attribute_row.attnum
       where namespace.nspname = 'ss'
         and relation.relname = 'project_legal_acceptance_receipts'
         and attribute_row.attnum > 0
         and not attribute_row.attisdropped
      )
      and (
        select count(*) = 1
          and bool_and(coalesce(
            attribute_row.atttypid = 'uuid'::regtype
            and not attribute_row.attnotnull
            and attribute_row.attgenerated = ''
            and attribute_row.attidentity = ''
            and default_row.oid is null,
            false
          ))
          from pg_attribute attribute_row
          join pg_class relation on relation.oid = attribute_row.attrelid
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
          left join pg_attrdef default_row
            on default_row.adrelid = attribute_row.attrelid
           and default_row.adnum = attribute_row.attnum
         where namespace.nspname = 'ss'
           and relation.relname = 'term_acceptances'
           and attribute_row.attnum > 0
           and not attribute_row.attisdropped
           and attribute_row.attname = 'legal_receipt_id'
      )
    ) as v48_catalog_receipt_columns,
    (
      select count(*) = 6
        and bool_and(coalesce(
          attribute_row.attgenerated = ''
          and attribute_row.attidentity = ''
          and case attribute_row.attname
            when 'document_id' then
              attribute_row.atttypid = 'uuid'::regtype
              and attribute_row.attnotnull and default_row.oid is null
            when 'artifact_uri' then
              attribute_row.atttypid = 'text'::regtype
              and attribute_row.attnotnull and default_row.oid is null
            when 'artifact_sha256' then
              attribute_row.atttypid = to_regtype('ss.sha256_hex')
              and attribute_row.attnotnull and default_row.oid is null
            when 'byte_count' then
              attribute_row.atttypid = 'bigint'::regtype
              and attribute_row.attnotnull and default_row.oid is null
            when 'media_type' then
              attribute_row.atttypid = 'text'::regtype
              and attribute_row.attnotnull and default_row.oid is null
            when 'created_at' then
              attribute_row.atttypid = 'timestamptz'::regtype
              and attribute_row.attnotnull
              and pg_get_expr(
                default_row.adbin, default_row.adrelid, false
              ) = 'clock_timestamp()'
            else false
          end,
          false
        ))
        from pg_attribute attribute_row
        join pg_class relation on relation.oid = attribute_row.attrelid
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        left join pg_attrdef default_row
          on default_row.adrelid = attribute_row.attrelid
         and default_row.adnum = attribute_row.attnum
       where namespace.nspname = 'ss'
         and relation.relname = 'legal_document_artifacts'
         and attribute_row.attnum > 0
         and not attribute_row.attisdropped
    ) as v48_catalog_artifact_columns,
    (
      select count(*) = 12
        and bool_and(trigger_row.oid is not null)
        and bool_and(trigger_row.tgenabled = 'O')
        and bool_and(trigger_row.tgtype = expected.type_code)
        and bool_and(
          trigger_row.tgdeferrable = expected.is_deferrable
        )
        and bool_and(
          trigger_row.tginitdeferred = expected.initially_deferred
        )
        and bool_and(coalesce(
          trigger_row.tgfoid =
            to_regprocedure(expected.function_signature),
          false
        ))
        from (values
          ('legal_document_artifact_matches_document', 'legal_document_artifacts', 'ss.validate_legal_document_artifact()', 21, true, true),
          ('legal_document_artifacts_no_update', 'legal_document_artifacts', 'ss.reject_update()', 19, false, false),
          ('legal_document_artifacts_no_delete', 'legal_document_artifacts', 'ss.reject_delete_v48()', 11, false, false),
          ('project_legal_receipt_exact_bundle', 'project_legal_acceptance_receipts', 'ss.validate_project_legal_acceptance_receipt()', 21, true, true),
          ('project_legal_receipts_no_update', 'project_legal_acceptance_receipts', 'ss.reject_update()', 19, false, false),
          ('project_legal_receipts_no_delete', 'project_legal_acceptance_receipts', 'ss.reject_delete_v48()', 11, false, false),
          ('term_acceptance_legal_receipt_exact_bundle', 'term_acceptances', 'ss.validate_project_legal_acceptance_receipt()', 5, true, true),
          ('term_acceptances_no_update_v48', 'term_acceptances', 'ss.reject_update()', 19, false, false),
          ('term_acceptances_no_delete_v48', 'term_acceptances', 'ss.reject_delete_v48()', 11, false, false),
          ('legal_documents_no_delete_v48', 'legal_documents', 'ss.reject_delete_v48()', 11, false, false),
          ('project_required_terms_no_delete_v48', 'project_required_terms', 'ss.reject_delete_v48()', 11, false, false),
          ('project_required_terms_monotonic_v48', 'project_required_terms', 'ss.validate_project_required_term_monotonicity()', 19, false, false)
        ) expected(
          name, relation_name, function_signature, type_code,
          is_deferrable, initially_deferred
        )
        left join pg_namespace namespace on namespace.nspname = 'ss'
        left join pg_class relation
          on relation.relnamespace = namespace.oid
         and relation.relname = expected.relation_name
        left join pg_trigger trigger_row
         on trigger_row.tgrelid = relation.oid
         and trigger_row.tgname = expected.name
         and not trigger_row.tgisinternal
       having (
         select count(*) = 14
           and count(*) filter (
             where relation.relname = 'legal_documents'
               and trigger_row.tgname = 'legal_documents_no_update'
               and trigger_row.tgenabled = 'O'
               and trigger_row.tgtype = 19
               and not trigger_row.tgdeferrable
               and not trigger_row.tginitdeferred
               and trigger_row.tgfoid =
                 to_regprocedure('ss.reject_update()')
           ) = 1
           and count(*) filter (
             where relation.relname = 'project_required_terms'
               and trigger_row.tgname = 'project_required_terms_match'
               and trigger_row.tgenabled = 'O'
               and trigger_row.tgtype = 21
               and trigger_row.tgdeferrable
               and trigger_row.tginitdeferred
               and trigger_row.tgfoid =
                 to_regprocedure('ss.validate_project_term()')
           ) = 1
           from pg_trigger trigger_row
           join pg_class relation on relation.oid = trigger_row.tgrelid
           join pg_namespace namespace
             on namespace.oid = relation.relnamespace
          where namespace.nspname = 'ss'
            and relation.relname in (
              'legal_document_artifacts',
              'project_legal_acceptance_receipts',
              'term_acceptances',
              'legal_documents',
              'project_required_terms'
            )
            and not trigger_row.tgisinternal
       )
    ) as v48_catalog_immutability_triggers,
    (
      select count(*) = 2
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'ss'
         and relation.relname in (
           'legal_document_artifacts',
           'project_legal_acceptance_receipts'
         )
         and relation.relrowsecurity
         and relation.relforcerowsecurity
    ) as v48_catalog_rls,
    (
      (
        select count(*) = 7
          and bool_and(constraint_row.oid is not null)
          from (values
            ('PRIMARY KEY (id)'),
            ('UNIQUE (organization_id, id)'),
            ('UNIQUE (project_id, request_id)'),
            ('FOREIGN KEY (user_id) REFERENCES auth.users(id)'),
            ('FOREIGN KEY (organization_id, project_id) REFERENCES ss.projects(organization_id, id)'),
            ('CHECK ((schema_version = ANY (ARRAY[''sitesourcery.project-legal-acceptance/v3''::text, ''sitesourcery.project-legal-acceptance/v4''::text, ''sitesourcery.project-legal-acceptance/v5''::text, ''sitesourcery.project-legal-acceptance/v7''::text])))'),
            ('CHECK ((acceptance_statement = ''accepted_exact_project_terms_and_acknowledged_privacy''::text))')
          ) expected(definition)
          left join pg_namespace namespace on namespace.nspname = 'ss'
          left join pg_class relation
            on relation.relnamespace = namespace.oid
           and relation.relname = 'project_legal_acceptance_receipts'
          left join pg_constraint constraint_row
            on constraint_row.conrelid = relation.oid
           and constraint_row.contype <> 't'
           and pg_get_constraintdef(constraint_row.oid, false) =
             expected.definition
      )
      and (
        select count(*) = 7
          from pg_constraint constraint_row
          join pg_class relation on relation.oid = constraint_row.conrelid
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relname = 'project_legal_acceptance_receipts'
           and constraint_row.contype <> 't'
      )
      and (
        select count(*) = 7
          and bool_and(constraint_row.oid is not null)
          from (values
            ('PRIMARY KEY (id)'),
            ('UNIQUE (project_id, document_id, user_id, request_id)'),
            ('UNIQUE (organization_id, id)'),
            ('FOREIGN KEY (user_id) REFERENCES auth.users(id)'),
            ('FOREIGN KEY (document_id) REFERENCES ss.legal_documents(id)'),
            ('FOREIGN KEY (organization_id, project_id) REFERENCES ss.projects(organization_id, id)'),
            ('FOREIGN KEY (organization_id, legal_receipt_id) REFERENCES ss.project_legal_acceptance_receipts(organization_id, id)')
          ) expected(definition)
          left join pg_namespace namespace on namespace.nspname = 'ss'
          left join pg_class relation
            on relation.relnamespace = namespace.oid
           and relation.relname = 'term_acceptances'
          left join pg_constraint constraint_row
            on constraint_row.conrelid = relation.oid
           and constraint_row.contype <> 't'
           and pg_get_constraintdef(constraint_row.oid, false) =
             expected.definition
      )
      and (
        select count(*) = 7
          from pg_constraint constraint_row
          join pg_class relation on relation.oid = constraint_row.conrelid
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relname = 'term_acceptances'
           and constraint_row.contype <> 't'
      )
    ) as v48_catalog_receipt_constraints,
    (
      select count(*) = 5
        and bool_and(constraint_row.oid is not null)
        from (values
          ('PRIMARY KEY (document_id)'),
          ('UNIQUE (artifact_uri)'),
          ('FOREIGN KEY (document_id) REFERENCES ss.legal_documents(id)'),
          ('CHECK ((byte_count > 0))'),
          ('CHECK ((media_type = ''text/html; charset=utf-8''::text))')
        ) expected(definition)
        left join pg_namespace namespace on namespace.nspname = 'ss'
        left join pg_class relation
          on relation.relnamespace = namespace.oid
         and relation.relname = 'legal_document_artifacts'
        left join pg_constraint constraint_row
          on constraint_row.conrelid = relation.oid
         and constraint_row.contype <> 't'
         and pg_get_constraintdef(constraint_row.oid, false) =
           expected.definition
       having (
         select count(*) = 5
           from pg_constraint constraint_row
           join pg_class relation on relation.oid = constraint_row.conrelid
           join pg_namespace namespace
             on namespace.oid = relation.relnamespace
          where namespace.nspname = 'ss'
            and relation.relname = 'legal_document_artifacts'
            and constraint_row.contype <> 't'
       )
    ) as v48_catalog_artifact_constraints,
    (
      select count(*) = 3
        and bool_and(policy_row.polpermissive)
        and bool_and(coalesce(
          case policy_row.polname
            when 'legal_document_artifacts_authenticated_read' then
              relation.relname = 'legal_document_artifacts'
              and policy_row.polcmd = 'r'
              and policy_row.polroles = array[
                (select oid from pg_roles where rolname = 'authenticated')
              ]::oid[]
              and lower(pg_get_expr(
                policy_row.polqual, policy_row.polrelid, false
              )) = '(ss.current_user_id() is not null)'
              and policy_row.polwithcheck is null
            when 'project_legal_acceptance_receipts_service_read' then
              relation.relname = 'project_legal_acceptance_receipts'
              and policy_row.polcmd = 'r'
              and policy_row.polroles = array[
                (select oid from pg_roles where rolname = 'service_role')
              ]::oid[]
              and pg_get_expr(
                policy_row.polqual, policy_row.polrelid, false
              ) = 'true'
              and policy_row.polwithcheck is null
            when 'project_legal_acceptance_receipts_service_insert' then
              relation.relname = 'project_legal_acceptance_receipts'
              and policy_row.polcmd = 'a'
              and policy_row.polroles = array[
                (select oid from pg_roles where rolname = 'service_role')
              ]::oid[]
              and policy_row.polqual is null
              and pg_get_expr(
                policy_row.polwithcheck, policy_row.polrelid, false
              ) = 'true'
            else false
          end,
          false
        ))
        from pg_policy policy_row
        join pg_class relation on relation.oid = policy_row.polrelid
        join pg_namespace namespace
          on namespace.oid = relation.relnamespace
       where namespace.nspname = 'ss'
         and (
           relation.relname, policy_row.polname
         ) in (
           ('legal_document_artifacts', 'legal_document_artifacts_authenticated_read'),
           ('project_legal_acceptance_receipts', 'project_legal_acceptance_receipts_service_read'),
           ('project_legal_acceptance_receipts', 'project_legal_acceptance_receipts_service_insert')
         )
       having (
         select count(*) = 3
           from pg_policy policy_row
           join pg_class relation on relation.oid = policy_row.polrelid
           join pg_namespace namespace
             on namespace.oid = relation.relnamespace
          where namespace.nspname = 'ss'
            and relation.relname in (
              'legal_document_artifacts',
              'project_legal_acceptance_receipts'
            )
       )
    ) as v48_catalog_policies,
    case when to_regclass('ss.legal_document_artifacts') is null
      or to_regclass('ss.project_legal_acceptance_receipts') is null
      then false else (
      not exists (
        select 1
          from information_schema.table_privileges privilege
         where privilege.table_schema = 'ss'
           and privilege.table_name in (
             'legal_document_artifacts',
             'project_legal_acceptance_receipts'
           )
           and privilege.grantee = 'PUBLIC'
      )
      and not exists (
        select 1
          from pg_class relation
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
          cross join lateral aclexplode(coalesce(
            relation.relacl,
            acldefault('r', relation.relowner)
          )) privilege
          left join pg_roles grantee on grantee.oid = privilege.grantee
         where namespace.nspname = 'ss'
           and relation.relname in (
             'legal_document_artifacts',
             'project_legal_acceptance_receipts'
           )
           and privilege.grantee <> relation.relowner
           and not (
             relation.relname = 'legal_document_artifacts'
             and grantee.rolname in ('authenticated', 'service_role')
             and privilege.privilege_type = 'SELECT'
             and not privilege.is_grantable
           )
           and not (
             relation.relname = 'project_legal_acceptance_receipts'
             and grantee.rolname = 'service_role'
             and privilege.privilege_type in ('SELECT', 'INSERT')
             and not privilege.is_grantable
           )
      )
      and (
        select count(*) = 4
          from pg_class relation
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
          cross join lateral aclexplode(coalesce(
            relation.relacl,
            acldefault('r', relation.relowner)
          )) privilege
         where namespace.nspname = 'ss'
           and relation.relname in (
             'legal_document_artifacts',
             'project_legal_acceptance_receipts'
           )
           and privilege.grantee <> relation.relowner
      )
      and not exists (
        select 1
          from pg_attribute attribute_row
          join pg_class relation on relation.oid = attribute_row.attrelid
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relname in (
             'legal_document_artifacts',
             'project_legal_acceptance_receipts'
           )
           and attribute_row.attnum > 0
           and not attribute_row.attisdropped
           and attribute_row.attacl is not null
           and cardinality(attribute_row.attacl) > 0
      )
      and
      has_table_privilege('authenticated', 'ss.legal_document_artifacts', 'SELECT')
      and not has_table_privilege('authenticated', 'ss.legal_document_artifacts', 'INSERT')
      and not has_table_privilege('authenticated', 'ss.legal_document_artifacts', 'UPDATE')
      and not has_table_privilege('authenticated', 'ss.legal_document_artifacts', 'DELETE')
      and not has_table_privilege('authenticated', 'ss.legal_document_artifacts', 'TRUNCATE')
      and not has_table_privilege('authenticated', 'ss.legal_document_artifacts', 'REFERENCES')
      and not has_table_privilege('authenticated', 'ss.legal_document_artifacts', 'TRIGGER')
      and not has_table_privilege('anon', 'ss.legal_document_artifacts', 'SELECT')
      and not has_table_privilege('anon', 'ss.legal_document_artifacts', 'INSERT')
      and not has_table_privilege('anon', 'ss.legal_document_artifacts', 'UPDATE')
      and not has_table_privilege('anon', 'ss.legal_document_artifacts', 'DELETE')
      and not has_table_privilege('anon', 'ss.legal_document_artifacts', 'TRUNCATE')
      and not has_table_privilege('anon', 'ss.legal_document_artifacts', 'REFERENCES')
      and not has_table_privilege('anon', 'ss.legal_document_artifacts', 'TRIGGER')
      and has_table_privilege('service_role', 'ss.legal_document_artifacts', 'SELECT')
      and not has_table_privilege('service_role', 'ss.legal_document_artifacts', 'INSERT')
      and not has_table_privilege('service_role', 'ss.legal_document_artifacts', 'UPDATE')
      and not has_table_privilege('service_role', 'ss.legal_document_artifacts', 'DELETE')
      and not has_table_privilege('service_role', 'ss.legal_document_artifacts', 'TRUNCATE')
      and not has_table_privilege('service_role', 'ss.legal_document_artifacts', 'REFERENCES')
      and not has_table_privilege('service_role', 'ss.legal_document_artifacts', 'TRIGGER')
      and has_table_privilege('service_role', 'ss.project_legal_acceptance_receipts', 'SELECT')
      and has_table_privilege('service_role', 'ss.project_legal_acceptance_receipts', 'INSERT')
      and not has_table_privilege('service_role', 'ss.project_legal_acceptance_receipts', 'UPDATE')
      and not has_table_privilege('service_role', 'ss.project_legal_acceptance_receipts', 'DELETE')
      and not has_table_privilege('service_role', 'ss.project_legal_acceptance_receipts', 'TRUNCATE')
      and not has_table_privilege('service_role', 'ss.project_legal_acceptance_receipts', 'REFERENCES')
      and not has_table_privilege('service_role', 'ss.project_legal_acceptance_receipts', 'TRIGGER')
      and not has_table_privilege('anon', 'ss.project_legal_acceptance_receipts', 'SELECT')
      and not has_table_privilege('anon', 'ss.project_legal_acceptance_receipts', 'INSERT')
      and not has_table_privilege('anon', 'ss.project_legal_acceptance_receipts', 'UPDATE')
      and not has_table_privilege('anon', 'ss.project_legal_acceptance_receipts', 'DELETE')
      and not has_table_privilege('anon', 'ss.project_legal_acceptance_receipts', 'TRUNCATE')
      and not has_table_privilege('anon', 'ss.project_legal_acceptance_receipts', 'REFERENCES')
      and not has_table_privilege('anon', 'ss.project_legal_acceptance_receipts', 'TRIGGER')
      and not has_table_privilege('authenticated', 'ss.project_legal_acceptance_receipts', 'SELECT')
      and not has_table_privilege('authenticated', 'ss.project_legal_acceptance_receipts', 'INSERT')
      and not has_table_privilege('authenticated', 'ss.project_legal_acceptance_receipts', 'UPDATE')
      and not has_table_privilege('authenticated', 'ss.project_legal_acceptance_receipts', 'DELETE')
      and not has_table_privilege('authenticated', 'ss.project_legal_acceptance_receipts', 'TRUNCATE')
      and not has_table_privilege('authenticated', 'ss.project_legal_acceptance_receipts', 'REFERENCES')
      and not has_table_privilege('authenticated', 'ss.project_legal_acceptance_receipts', 'TRIGGER')
    ) end as v48_catalog_privileges
`;

const PROJECT_LEGAL_DATA_QUERY = `
  select
    ss.hosted_runtime_contract_v48() =
      'canonical-ss-v48-hosted-joint-legal-v3'
    and ss.hosted_runtime_contract_v53() =
      'canonical-ss-v53-joint-legal-v4-authority'
    and ss.hosted_joint_legal_v7_contract() =
      'canonical-hosted-joint-legal-v7-authority'
      as contract_marker_ready,
    (
      select count(*) = 2
        from ss.legal_document_artifacts artifact
        join ss.legal_documents document
          on document.id = artifact.document_id
       where (
         document.id = '00000000-0000-4000-8000-000000000022'
         and document.kind = 'privacy'
         and document.version = 'SS-HOSTED-PRIVACY-2026-07-30-V2'
         and document.content_digest =
           'b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b'
         and document.content_uri = 'https://sitesourcery.com/legal/privacy/'
         and document.effective_at = '2026-07-30T00:00:00Z'::timestamptz
         and document.retired_at is null
         and artifact.artifact_uri =
           'https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/'
         and artifact.artifact_sha256 = document.content_digest
         and artifact.byte_count = 19935
         and artifact.media_type = 'text/html; charset=utf-8'
       ) or (
         document.id = '00000000-0000-4000-8000-000000000023'
         and document.kind = 'website'
         and document.version = 'SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2'
         and document.content_digest =
           'bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196'
         and document.content_uri = 'https://sitesourcery.com/legal/website-terms/'
         and document.effective_at = '2026-07-30T00:00:00Z'::timestamptz
         and document.retired_at is null
         and artifact.artifact_uri =
           'https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2/'
         and artifact.artifact_sha256 = document.content_digest
         and artifact.byte_count = 21380
         and artifact.media_type = 'text/html; charset=utf-8'
       )
    ) as v2_artifact_ready,
    (
      select count(*) = 2
        from ss.legal_documents document
        join ss.legal_document_artifacts artifact
          on artifact.document_id = document.id
       where (
         (
           document.id = '00000000-0000-4000-8000-000000000048'
           and document.kind = 'privacy'
           and document.version <> 'SS-HOSTED-PRIVACY-V3-UNSEALED'
         ) or (
           document.id = '00000000-0000-4000-8000-000000000104'
           and document.kind = 'website'
           and document.version <>
             'SS-HOSTED-WEBSITE-TERMS-V3-UNSEALED'
         )
       )
       and document.retired_at is null
       and artifact.artifact_sha256 = document.content_digest
       and artifact.byte_count > 0
       and artifact.media_type = 'text/html; charset=utf-8'
    ) and not exists (
      select 1 from ss.legal_document_artifacts artifact
       where artifact.document_id =
         '00000000-0000-4000-8000-000000000103'::uuid
    ) as v3_artifact_ready,
    (
      select count(*) = 3
        from ss.legal_documents document
       where (
         (
           document.id = '00000000-0000-4000-8000-000000000048'
           and document.kind = 'privacy'
           and document.version <> 'SS-HOSTED-PRIVACY-V3-UNSEALED'
         ) or (
           document.id = '00000000-0000-4000-8000-000000000103'
           and document.kind = 'product'
           and document.version <>
             'SS-HOSTED-WEBSITE-TERMS-V3-UNSEALED'
         ) or (
           document.id = '00000000-0000-4000-8000-000000000104'
           and document.kind = 'website'
           and document.version <>
             'SS-HOSTED-WEBSITE-TERMS-V3-UNSEALED'
         )
       )
       and document.retired_at is null
       and document.content_digest ~ '^[a-f0-9]{64}$'
    ) as authority_ready
`;

const PROJECT_LEGAL_CONSTANTS_QUERY = `
  select
    ss.hosted_runtime_contract_v48() =
      'canonical-ss-v48-hosted-joint-legal-v3'
    and ss.hosted_runtime_contract_v53() =
      'canonical-ss-v53-joint-legal-v4-authority'
    and ss.hosted_joint_legal_v7_contract() =
      'canonical-hosted-joint-legal-v7-authority'
      as contract_marker_ready,
    (
      select count(*) = 3
        from ss.legal_documents document
       where (
         document.id = $1::uuid and document.kind = $2::text
         and document.version = $3::text
         and document.content_digest = $4::text
         and document.content_uri = $5::text
         and document.effective_at = $6::timestamptz
         and document.retired_at is null
       ) or (
         document.id = $7::uuid and document.kind = $8::text
         and document.version = $9::text
         and document.content_digest = $10::text
         and document.content_uri = $11::text
         and document.effective_at = $12::timestamptz
         and document.retired_at is null
       ) or (
         document.id = $13::uuid and document.kind = $14::text
         and document.version = $15::text
         and document.content_digest = $16::text
         and document.content_uri = $17::text
         and document.effective_at = $18::timestamptz
         and document.retired_at is null
       )
    ) as exact_documents_ready,
    (
      select count(*) = 2
        and bool_and(
          (
            artifact.document_id = $19::uuid
            and artifact.artifact_uri = $20::text
            and artifact.artifact_sha256 = $21::text
            and artifact.byte_count = $22::bigint
            and artifact.media_type = $23::text
          ) or (
            artifact.document_id = $24::uuid
            and artifact.artifact_uri = $25::text
            and artifact.artifact_sha256 = $26::text
            and artifact.byte_count = $27::bigint
            and artifact.media_type = $28::text
          )
        )
        from ss.legal_document_artifacts artifact
       where artifact.document_id in ($1::uuid, $7::uuid, $13::uuid)
    ) as exact_artifacts_ready,
    ss.project_legal_json_digest(jsonb_build_object(
      'documents', jsonb_build_array(
        jsonb_build_object(
          'kind', $2::text, 'version', $3::text,
          'contentDigest', $4::text, 'contentUri', $5::text,
          'effectiveAt', to_char(
            $6::timestamptz at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        ),
        jsonb_build_object(
          'kind', $8::text, 'version', $9::text,
          'contentDigest', $10::text, 'contentUri', $11::text,
          'effectiveAt', to_char(
            $12::timestamptz at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        ),
        jsonb_build_object(
          'kind', $14::text, 'version', $15::text,
          'contentDigest', $16::text, 'contentUri', $17::text,
          'effectiveAt', to_char(
            $18::timestamptz at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        )
      ),
      'schema', $29::text
    )) = $30::text as authority_digest_ready
`;

const CUSTOM_SERVICES_READINESS_QUERY = `
  select
    (
      select count(*) = 1
        from ss.service_catalog_policies policy
        join ss.legal_documents document
          on document.id = policy.legal_document_id
       where policy.id = '00000000-0000-4000-8000-000000001411'
         and policy.catalog_version = 'SS-PROFESSIONAL-2026.2'
         and policy.service_key = 'website_assessment_standard'
         and policy.pricing_mode = 'fixed'
         and policy.billing_cadence = 'one_time'
         and policy.currency = 'USD'
         and policy.unit_amount_minor = 35000
         and policy.minimum_quantity = 1
         and policy.maximum_quantity = 1
         and policy.publication_state = 'held'
         and policy.scope_boundary = jsonb_build_object(
           'catalogDigest',
             '3416befc73dccbf2f8dc0f40233d4cd7c1833e4e329bd1047ce8bf41fd2e4de0',
           'credit', jsonb_build_object(
             'amountMinor', 35000,
             'applicationScope', 'custom_base_build',
             'maximumApplications', 1,
             'nonCash', true,
             'sameOrganizationAndProjectOnly', true
           ),
           'deliverable',
             'written assessment with screenshot evidence and real findings ranked by severity',
           'expandedAssessmentState', 'separately_quoted',
           'maximumFindings', 10,
           'maximumRepresentativePagesOrTypes', 5,
           'maximumWebsites', 1,
           'requiredViewports', jsonb_build_array('desktop', 'phone'),
           'scopeState', 'must_be_stated_before_sale',
           'turnaroundState', 'must_be_stated_before_sale',
           'taxDisplay', 'exclusive',
           'taxState', 'disabled_by_owner'
         )
         and policy.scope_boundary_digest =
           ss.service_json_digest(policy.scope_boundary)
         and document.kind = 'custom_services'
         and document.version = 'SS-CUSTOM-SERVICES-2026-08-19.2'
         and document.content_digest =
           '0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d'
         and document.retired_at is null
         and (
           select count(*) = 3
             from ss.service_catalog_coverage coverage
            where coverage.policy_id = policy.id
              and coverage.boundary_digest = policy.scope_boundary_digest
         )
    ) as custom_services_policy_ready,
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
            'authenticated',
            format('ss.%I', relation.relname),
            'INSERT'
          )
          and not has_table_privilege(
            'anon',
            format('ss.%I', relation.relname),
            'SELECT'
          )
          and not has_table_privilege(
            'anon',
            format('ss.%I', relation.relname),
            'INSERT'
          )
          and has_table_privilege(
            'service_role',
            format('ss.%I', relation.relname),
            'SELECT'
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
              'service_project_profiles',
              'service_cases',
              'service_case_offerings',
              'service_intakes',
              'service_documents',
              'service_access_requests'
            )
          )
          and has_table_privilege(
            'service_role',
            format('ss.%I', relation.relname),
            'UPDATE'
          ) = (
            relation.relname in (
              'service_project_profiles',
              'service_cases',
              'service_case_offerings'
            )
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
    ) as custom_services_security_ready,
    ss.hosted_runtime_contract_v34() =
      'canonical-ss-v34-custom-services-foundation'
      as custom_services_contract_marker_ready
`;

const CUSTOM_SERVICE_QUOTES_READINESS_QUERY = `
  select
    ss.hosted_runtime_contract_v35() =
      'canonical-ss-v35-custom-service-quotes'
      as custom_service_quotes_contract_marker_ready,
    ss.hosted_runtime_contract_v36() =
      'canonical-ss-v36-custom-service-customer-commands'
      as custom_service_customer_commands_contract_marker_ready,
    ss.hosted_runtime_contract_v37() =
      'canonical-ss-v37-custom-service-held-invoices'
      as custom_service_invoices_contract_marker_ready,
    ss.hosted_runtime_contract_v38() =
      'canonical-ss-v38-custom-service-assessment-checkout'
      as custom_service_assessment_checkout_contract_marker_ready,
    ss.hosted_runtime_contract_v39() =
      'canonical-ss-v39-custom-service-assessment-settlement'
      as custom_service_assessment_settlement_contract_marker_ready,
    ss.hosted_runtime_contract_v40() =
      'canonical-ss-v40-custom-service-assessment-delivery'
      as custom_service_assessment_delivery_contract_marker_ready,
    ss.hosted_runtime_contract_v41() =
      'canonical-ss-v41-custom-build-quote-credit'
      and (
        to_regprocedure(
          'ss.commercial_catalog_convergence_contract_v1()'
        ) is null
        or exists (
          select 1
          from pg_proc procedure_record
          where procedure_record.oid = to_regprocedure(
            'ss.commercial_catalog_convergence_contract_v1()'
          )
            and pg_get_functiondef(procedure_record.oid) like
              '%canonical-ss-v141-commercial-2026.6-credit-only-card-held-historical-compatible%'
            and exists (
              select 1
              from pg_attribute attribute_record
              where attribute_record.attrelid =
                'ss.service_custom_build_jobs'::regclass
                and attribute_record.attname = 'start_settlement_kind'
                and attribute_record.attgenerated = 's'
                and not attribute_record.attisdropped
            )
            and exists (
              select 1
              from pg_constraint constraint_record
              where constraint_record.conrelid =
                'ss.service_custom_build_jobs'::regclass
                and constraint_record.conname =
                  'service_custom_build_jobs_start_settlement_kind_check'
                and pg_get_constraintdef(constraint_record.oid) like
                  '%credit_only%start_paid_subtotal_minor = 0%'
            )
            and exists (
              select 1
              from pg_constraint constraint_record
              where constraint_record.conrelid =
                'ss.service_custom_build_invoices'::regclass
                and constraint_record.conname =
                  'service_custom_build_invoices_settlement_state_check'
                and pg_get_constraintdef(constraint_record.oid) like
                  '%credit_settled%'
                and pg_get_constraintdef(constraint_record.oid) like
                  '%subtotal_minor = 0%'
            )
        )
      )
      as custom_build_quote_credit_contract_marker_ready,
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
      and to_regprocedure(
        'ss.guard_service_assessment_checkout_attempt()'
      ) is not null
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
            on trigger_relation.oid =
              trigger_record.tgrelid
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
      )
      as custom_service_assessment_checkout_ready,
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
      and to_regprocedure(
        'ss.guard_service_assessment_stripe_event()'
      ) is not null
      and to_regprocedure(
        'ss.guard_service_assessment_settlement_insert()'
      ) is not null
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
      )
      as custom_service_assessment_settlement_ready,
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
    )
      and has_table_privilege(
        'service_role', 'ss.service_documents', 'INSERT'
      )
      and not has_table_privilege(
        'service_role', 'ss.service_documents', 'UPDATE'
      )
      and (
        select procedure_record.prosecdef
          and not has_function_privilege(
            'service_role',
            'ss.materialize_service_assessment_delivery()',
            'EXECUTE'
          )
          from pg_proc procedure_record
         where procedure_record.oid =
           'ss.materialize_service_assessment_delivery()'::regprocedure
      )
      as custom_service_assessment_delivery_ready,
    (
      select count(*) = 11
        and bool_and(relation.relrowsecurity)
        and bool_and(relation.relforcerowsecurity)
        and bool_and(
          not has_table_privilege(
            'authenticated',
            format('ss.%I', relation.relname),
            'SELECT'
          )
          and not has_table_privilege(
            'authenticated',
            format('ss.%I', relation.relname),
            'INSERT'
          )
          and not has_table_privilege(
            'anon',
            format('ss.%I', relation.relname),
            'SELECT'
          )
          and not has_table_privilege(
            'anon',
            format('ss.%I', relation.relname),
            'INSERT'
          )
          and has_table_privilege(
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
    ) as custom_service_quotes_security_ready,
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
    ) as custom_service_quotes_retention_ready,
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
          and not has_table_privilege(
            'authenticated', format('ss.%I', relation.relname), 'SELECT'
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
      )
      as custom_service_invoices_held_ready,
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
    ) as custom_service_quotes_digests_ready,
    (
      select
        contract.definitions like '%SS-CUSTOM-SERVICES-2026-08-19.2%'
        and contract.definitions like
          '%0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d%'
        and contract.definitions ~ 'service_amount_minor = 35000'
        and contract.definitions ~ 'subtotal_minor = 35000'
        and contract.definitions ~ 'currency = ''USD'''
        and contract.definitions ~
          'tax_state = ''disabled_by_owner'''
        and contract.definitions ~
          'payment_schedule = ''full_before_work'''
        and contract.definitions ~ 'maximum_websites = 1'
        and contract.definitions ~
          'maximum_representative_pages_or_types = 5'
        and contract.definitions ~ 'maximum_findings = 10'
        and contract.definitions like
          '%CHECK (desktop_review_included)%'
        and contract.definitions like
          '%CHECK (phone_review_included)%'
        and contract.definitions ~
          'expanded_assessment_state = ''separately_quoted'''
        and contract.definitions ~
          'component_key = ''website_assessment_standard'''
        and contract.definitions ~ 'unit_amount_minor.*35000'
        and contract.definitions ~ 'amount_minor.*35000'
        and contract.definitions ~ 'due_trigger = ''before_work'''
        and lower(
          pg_get_functiondef(
            'ss.prepare_service_quote_revision()'::regprocedure
          )
        ) like '%new.service_amount_minor := 35000%'
        and lower(
          pg_get_functiondef(
            'ss.prepare_service_quote_revision()'::regprocedure
          )
        ) like '%new.tax_state := ''disabled_by_owner''%'
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
        ) like
          '%new.maximum_representative_pages_or_types := 5%'
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
           where constraint_record.conrelid in (
             'ss.service_quote_revisions'::regclass,
             'ss.service_quote_lines'::regclass,
             'ss.service_quote_installments'::regclass
           )
             and constraint_record.contype = 'c'
        ) contract
    ) as custom_service_quotes_terms_ready,
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
            from information_schema.columns column_record
           where column_record.table_schema = 'ss'
             and column_record.table_name =
               'service_operator_authority_events'
             and column_record.column_name = 'event_digest'
             and column_record.is_generated = 'ALWAYS'
        )
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
    ) as custom_service_quotes_operator_authority_ready,
    (
      select
        acceptance_contract.definitions ~ 'source = ''account'''
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
        ) like
          '%claimed_quote_digest is distinct from revision_record.quote_digest%'
        and lower(
          pg_get_functiondef(
            'ss.prepare_service_quote_acceptance()'::regprocedure
          )
        ) like
          '%claimed_disclosure_digest is distinct from revision_record.disclosure_digest%'
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
    ) as custom_service_quotes_acceptance_ready,
    (
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
      )
      and (
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
      )
      and exists (
        select 1
          from pg_class relation
         where relation.oid = 'ss.service_intake_drafts'::regclass
           and relation.relrowsecurity
           and relation.relforcerowsecurity
           and has_table_privilege(
             'service_role',
             relation.oid,
             'SELECT'
           )
           and has_table_privilege(
             'service_role',
             relation.oid,
             'INSERT'
           )
           and has_table_privilege(
             'service_role',
             relation.oid,
             'UPDATE'
           )
           and not has_table_privilege(
             'service_role',
             relation.oid,
             'DELETE'
           )
           and not has_table_privilege(
             'service_role',
             relation.oid,
             'TRUNCATE'
           )
           and not has_table_privilege(
             'authenticated',
             relation.oid,
             'SELECT'
           )
           and not has_table_privilege(
             'anon',
             relation.oid,
             'SELECT'
           )
      )
      and (
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
      )
      and exists (
        select 1
          from information_schema.columns column_record
         where column_record.table_schema = 'ss'
           and column_record.table_name = 'service_intake_drafts'
           and column_record.column_name = 'facts_digest'
           and column_record.is_generated = 'ALWAYS'
           and column_record.generation_expression like
             '%service_intake_facts_digest%'
      )
    ) as custom_service_customer_commands_fences_ready,
    (
      (
        select count(*) = 8
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege('service_role', relation.oid, 'SELECT')
            and has_table_privilege(
              'service_role', relation.oid, 'UPDATE'
            ) = (
              relation.relname = 'service_credit_applications'
            )
            and not has_table_privilege('service_role', relation.oid, 'DELETE')
            and not has_table_privilege('service_role', relation.oid, 'TRUNCATE')
            and not has_table_privilege('authenticated', relation.oid, 'SELECT')
            and not has_table_privilege('anon', relation.oid, 'SELECT')
            and has_table_privilege('service_role', relation.oid, 'INSERT') =
              (relation.relname in (
                'service_custom_build_quotes',
                'service_custom_build_quote_revisions',
                'service_custom_build_quote_commands',
                'service_custom_build_quote_acceptances',
                'service_custom_build_quote_voids'
              ))
          )
        from pg_class relation
        join pg_namespace namespace
          on namespace.oid = relation.relnamespace
        where namespace.nspname = 'ss'
          and relation.relkind = 'r'
          and relation.relname in (
            'service_custom_build_quotes',
            'service_custom_build_quote_revisions',
            'service_custom_build_quote_base_lines',
            'service_custom_build_quote_installments',
            'service_custom_build_quote_commands',
            'service_custom_build_quote_acceptances',
            'service_credit_applications',
            'service_custom_build_quote_voids'
          )
      )
      and (
        select count(*) = 7
        from ss.service_catalog_policies policy
        where policy.catalog_version = 'SS-PROFESSIONAL-2026.2'
          and policy.service_key like 'custom_build_%'
          and policy.publication_state = 'held'
          and policy.currency = 'USD'
      )
      and to_regclass(
        'ss.service_credit_applications_one_active_grant'
      ) is not null
      and to_regclass(
        'ss.service_custom_build_quotes_one_active_report'
      ) is not null
      and to_regclass(
        'ss.service_custom_build_quotes_one_active_project'
      ) is not null
      and not has_function_privilege(
        'service_role',
        'ss.materialize_service_custom_build_quote()',
        'EXECUTE'
      )
      and not has_function_privilege(
        'service_role',
        'ss.materialize_service_custom_build_acceptance()',
        'EXECUTE'
      )
      and not has_function_privilege(
        'service_role',
        'ss.materialize_service_custom_build_quote_void()',
        'EXECUTE'
      )
    ) as custom_build_quote_credit_ready
`;

function requiredString(value, code, message) {
  invariant(
    typeof value === "string" && value.length > 0,
    code,
    message,
    { status: 500 }
  );
  return value;
}

function transactionRole(value) {
  const role = TRANSACTION_ROLES[value];
  invariant(
    role,
    "DATABASE_TRANSACTION_INVALID",
    "PostgreSQL transaction role is invalid.",
    { status: 500 }
  );
  return role;
}

function isolationLevel(value) {
  const isolation = ISOLATION_LEVELS[value];
  invariant(
    isolation,
    "DATABASE_TRANSACTION_INVALID",
    "PostgreSQL isolation level is invalid.",
    { status: 500 }
  );
  return isolation;
}

function serviceActorKind(value) {
  if (value === null || value === undefined) {
    return null;
  }
  invariant(
    SERVICE_ACTOR_KINDS.has(value),
    "DATABASE_SERVICE_ACTOR_INVALID",
    "PostgreSQL service actor kind is invalid.",
    { status: 500 }
  );
  return value;
}

async function rollback(client) {
  try {
    await client.query("rollback");
  } catch {
    // The original transaction failure remains authoritative.
  }
}

function acquisitionTimeout() {
  return new HostedError(
    "DATABASE_ACQUISITION_TIMEOUT",
    "PostgreSQL capacity was not available before the bounded deadline.",
    { status: 503 }
  );
}

function metric(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function createPoolBudgetRuntime({
  pool,
  policy,
  workload,
  timers = {}
}) {
  const now = timers.now ?? Date.now;
  const schedule = timers.setTimeout ?? setTimeout;
  const cancel = timers.clearTimeout ?? clearTimeout;
  invariant(
    typeof now === "function" &&
      typeof schedule === "function" &&
      typeof cancel === "function",
    "POSTGRES_BUDGET_CONFIGURATION_INVALID",
    "PostgreSQL budget timers are invalid.",
    { status: 500 }
  );

  let active = 0;
  let queued = 0;
  const waiters = [];
  const counters = {
    requested: 0,
    acquired: 0,
    waited: 0,
    timedOut: 0,
    saturated: 0,
    totalWaitMs: 0,
    maximumWaitMs: 0
  };
  const processConnectionBudget = workload === "worker"
    ? policy.pool.workerReservedConnections
    : policy.pool.apiConnections;

  function releaseSlot() {
    active -= 1;
    while (waiters.length > 0) {
      const next = waiters.shift();
      if (next.settled) continue;
      if (next.deadlineAt <= now()) {
        next.settled = true;
        cancel(next.timer);
        queued -= 1;
        next.reject(acquisitionTimeout());
        continue;
      }
      next.settled = true;
      cancel(next.timer);
      queued -= 1;
      active += 1;
      next.resolve({ queued: true, release: releaseSlot });
      break;
    }
  }

  function acquireSlot(deadlineAt) {
    if (active < processConnectionBudget) {
      active += 1;
      return Promise.resolve({ queued: false, release: releaseSlot });
    }
    counters.saturated += 1;
    queued += 1;
    return new Promise((resolve, reject) => {
      const waiter = {
        settled: false,
        resolve,
        reject,
        deadlineAt,
        timer: null
      };
      const remainingMs = Math.max(0, deadlineAt - now());
      waiter.timer = schedule(() => {
        if (waiter.settled) return;
        waiter.settled = true;
        queued -= 1;
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(acquisitionTimeout());
      }, remainingMs);
      waiters.push(waiter);
    });
  }

  function connectBefore(deadlineAt) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const remainingMs = deadlineAt - now();
      if (remainingMs <= 0) {
        reject(acquisitionTimeout());
        return;
      }
      const timer = schedule(() => {
        settled = true;
        reject(acquisitionTimeout());
      }, remainingMs);
      Promise.resolve()
        .then(() => pool.connect())
        .then(
          (client) => {
            if (settled) {
              client.release();
              return;
            }
            settled = true;
            cancel(timer);
            resolve(client);
          },
          (error) => {
            if (settled) return;
            settled = true;
            cancel(timer);
            reject(error);
          }
        );
    });
  }

  async function acquireClient() {
    const startedAt = now();
    const deadlineAt = startedAt + policy.timeouts.acquisitionMs;
    counters.requested += 1;
    let slot;
    try {
      slot = await acquireSlot(deadlineAt);
      const client = await connectBefore(deadlineAt);
      const waitMs = Math.max(0, now() - startedAt);
      counters.acquired += 1;
      counters.totalWaitMs += waitMs;
      counters.maximumWaitMs = Math.max(counters.maximumWaitMs, waitMs);
      if (slot.queued || waitMs > 0) counters.waited += 1;
      let released = false;
      return {
        client,
        release() {
          if (released) return;
          released = true;
          try {
            client.release();
          } finally {
            slot.release();
          }
        }
      };
    } catch (error) {
      slot?.release();
      if (error?.code === "DATABASE_ACQUISITION_TIMEOUT") {
        counters.timedOut += 1;
      }
      throw error;
    }
  }

  function readiness() {
    return Object.freeze({
      schema: POSTGRES_BUDGET_READINESS_SCHEMA,
      ready: true,
      connection: "redacted",
      timeouts: Object.freeze({
        statement: "transaction-local",
        lock: "transaction-local",
        idleInTransaction: "transaction-local",
        acquisition: "bounded"
      }),
      pool: Object.freeze({
        totalConnections: policy.pool.totalConnections,
        apiConnections: policy.pool.apiConnections,
        workerReservedConnections:
          policy.pool.workerReservedConnections,
        processConnectionBudget,
        workload,
        connectionIncrease: policy.pool.connectionIncrease,
        workerScope: workload === "worker"
          ? "dedicated-process"
          : "external-process"
      }),
      telemetry: Object.freeze({
        schema: "sitesourcery.postgres-pool-telemetry/v1",
        pii: "none",
        activeTransactions: active,
        queuedAcquisitions: queued,
        activeApiTransactions: active,
        queuedApiAcquisitions: queued,
        requestedAcquisitions: counters.requested,
        successfulAcquisitions: counters.acquired,
        waitedAcquisitions: counters.waited,
        timedOutAcquisitions: counters.timedOut,
        saturationEvents: counters.saturated,
        totalWaitMs: counters.totalWaitMs,
        maximumWaitMs: counters.maximumWaitMs,
        physicalConnections: metric(pool.totalCount),
        idleConnections: metric(pool.idleCount),
        driverWaiters: metric(pool.waitingCount)
      })
    });
  }

  return Object.freeze({ acquireClient, readiness });
}

export function createPostgresPool(options = {}) {
  const connectionString =
    options.connectionString ?? process.env.SITESOURCERY_DATABASE_URL;
  requiredString(
    connectionString,
    "DATABASE_CONFIGURATION_REQUIRED",
    "SITESOURCERY_DATABASE_URL is required."
  );
  return new Pool({
    connectionString,
    application_name: "sitesourcery-hosted",
    max: options.max ?? 10,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    statement_timeout: options.statementTimeoutMillis,
    lock_timeout: options.lockTimeoutMillis,
    idle_in_transaction_session_timeout:
      options.idleInTransactionTimeoutMillis,
    query_timeout: options.queryTimeoutMillis,
    allowExitOnIdle: options.allowExitOnIdle ?? false,
    ssl: options.ssl
  });
}

export function createCanonicalPostgresAuthority({
  pool,
  budgetPolicy = DEFAULT_POSTGRES_BUDGET_POLICY,
  workload = "api",
  budgetTimers
} = {}) {
  invariant(
    pool &&
      typeof pool.connect === "function" &&
      typeof pool.query === "function",
    "DATABASE_CONFIGURATION_REQUIRED",
    "PostgreSQL pool is required.",
    { status: 500 }
  );
  invariant(
    workload === "api" || workload === "worker",
    "POSTGRES_BUDGET_CONFIGURATION_INVALID",
    "PostgreSQL workload scope is invalid.",
    { status: 500 }
  );
  const selectedBudgetPolicy = validatePostgresBudgetPolicy(budgetPolicy);
  const budgetRuntime = createPoolBudgetRuntime({
    pool,
    policy: selectedBudgetPolicy,
    workload,
    timers: budgetTimers
  });

  async function readiness() {
    try {
      const result = await pool.query(READINESS_QUERY);
      const row = result.rows[0];
      if (!row?.shadow_schema_absent) {
        return {
          ready: false,
          kind: "canonical-postgres",
          code: "SHADOW_SCHEMA_PRESENT",
          database: row?.database_name ?? null
        };
      }
      const legalCatalog = (
        await pool.query(PROJECT_LEGAL_CATALOG_QUERY)
      ).rows[0] ?? {};
      let legalData = {};
      const legalCatalogReady = [
        "v48_catalog_contract",
        "v48_catalog_tables",
    "v48_catalog_receipt_columns",
        "v48_catalog_artifact_columns",
        "v48_catalog_immutability_triggers",
        "v48_catalog_rls",
        "v48_catalog_receipt_constraints",
        "v48_catalog_artifact_constraints",
        "v48_catalog_policies",
        "v48_catalog_privileges"
      ].every((key) => legalCatalog[key] === true);
      if (legalCatalogReady) {
        legalData = (await pool.query(PROJECT_LEGAL_DATA_QUERY)).rows[0] ?? {};
      }
      Object.assign(row, {
        legal_privacy_v3_contract_ready: legalCatalogReady &&
          legalData.contract_marker_ready === true,
        legal_privacy_v2_artifact_ready: legalCatalogReady &&
          legalData.v2_artifact_ready === true,
        legal_privacy_v3_artifact_ready: legalCatalogReady &&
          legalData.v3_artifact_ready === true,
        legal_acceptance_receipts_ready: legalCatalogReady,
        legal_privacy_v3_authority_ready: legalCatalogReady &&
          legalData.authority_ready === true
      });
      if (row.custom_services_schema_ready) {
        const customServices = await pool.query(
          CUSTOM_SERVICES_READINESS_QUERY
        );
        Object.assign(row, customServices.rows[0] ?? {
          custom_services_policy_ready: false,
          custom_services_security_ready: false,
          custom_services_contract_marker_ready: false
        });
      } else {
        Object.assign(row, {
          custom_services_policy_ready: false,
          custom_services_security_ready: false,
          custom_services_contract_marker_ready: false
        });
      }
      if (row.custom_service_quotes_schema_ready) {
        const customServiceQuotes = await pool.query(
          CUSTOM_SERVICE_QUOTES_READINESS_QUERY
        );
        Object.assign(row, customServiceQuotes.rows[0] ?? {
          custom_service_quotes_contract_marker_ready: false,
          custom_service_customer_commands_contract_marker_ready: false,
          custom_service_invoices_contract_marker_ready: false,
          custom_service_assessment_checkout_contract_marker_ready: false,
          custom_service_assessment_settlement_contract_marker_ready: false,
          custom_service_assessment_delivery_contract_marker_ready: false,
          custom_build_quote_credit_contract_marker_ready: false,
          custom_service_assessment_checkout_ready: false,
          custom_service_assessment_settlement_ready: false,
          custom_service_assessment_delivery_ready: false,
          custom_service_invoices_held_ready: false,
          custom_service_quotes_security_ready: false,
          custom_service_quotes_retention_ready: false,
          custom_service_quotes_digests_ready: false,
          custom_service_quotes_terms_ready: false,
          custom_service_quotes_operator_authority_ready: false,
          custom_service_quotes_acceptance_ready: false,
          custom_service_customer_commands_fences_ready: false,
          custom_build_quote_credit_ready: false
        });
      } else {
        Object.assign(row, {
          custom_service_quotes_contract_marker_ready: false,
          custom_service_customer_commands_contract_marker_ready: false,
          custom_service_invoices_contract_marker_ready: false,
          custom_service_assessment_checkout_contract_marker_ready: false,
          custom_service_assessment_settlement_contract_marker_ready: false,
          custom_service_assessment_delivery_contract_marker_ready: false,
          custom_build_quote_credit_contract_marker_ready: false,
          custom_service_assessment_checkout_ready: false,
          custom_service_assessment_settlement_ready: false,
          custom_service_assessment_delivery_ready: false,
          custom_service_invoices_held_ready: false,
          custom_service_quotes_security_ready: false,
          custom_service_quotes_retention_ready: false,
          custom_service_quotes_digests_ready: false,
          custom_service_quotes_terms_ready: false,
          custom_service_quotes_operator_authority_ready: false,
          custom_service_quotes_acceptance_ready: false,
          custom_service_customer_commands_fences_ready: false,
          custom_build_quote_credit_ready: false
        });
      }
      const missing = Object.entries(row)
        .filter(
          ([key, value]) =>
            key.endsWith("_ready") &&
            !PROJECT_LEGAL_V3_HOLD_FLAGS.has(key) &&
            value !== true
        )
        .map(([key]) => key.replace(/_ready$/u, ""))
        .sort();
      const projectCreationLegal = {
        ready: [...PROJECT_LEGAL_V3_HOLD_FLAGS].every(
          (key) => row[key] === true
        ),
        contract: row.legal_privacy_v3_contract_ready === true,
        v2Artifact: row.legal_privacy_v2_artifact_ready === true,
        v3Artifact: row.legal_privacy_v3_artifact_ready === true,
        receipts: row.legal_acceptance_receipts_ready === true,
        authority: row.legal_privacy_v3_authority_ready === true
      };
      if (missing.length > 0) {
        return {
          ready: false,
          kind: "canonical-postgres",
          code: "DATABASE_NOT_MIGRATED",
          database: row.database_name,
          missing,
          projectCreationLegal
        };
      }
      return {
        ready: true,
        kind: "canonical-postgres",
        database: row.database_name,
        authoritySchema: "ss",
        missing: [],
        projectCreationLegal
      };
    } catch {
      return {
        ready: false,
        kind: "canonical-postgres",
        code: "DATABASE_UNAVAILABLE",
        database: null,
        projectCreationLegal: { ready: false }
      };
    }
  }

  async function assertReady() {
    const status = await readiness();
    invariant(
      status.ready,
      status.code,
      status.code === "SHADOW_SCHEMA_PRESENT"
        ? "The unsupported ss_hosted shadow schema must be removed before startup."
        : "Canonical PostgreSQL migrations through FIN-007 commercial convergence v141 are required.",
      { status: 503, details: status }
    );
    return status;
  }

  async function projectLegalAuthorityMatches(expected) {
    const status = await readiness();
    if (status.projectCreationLegal?.ready !== true) return false;
    const documents = expected?.documents ?? [];
    const ids = expected?.documentBindings ?? [];
    const privacyArtifact = expected?.artifactBindings?.[0];
    const websiteArtifact = expected?.artifactBindings?.[2];
    if (
      documents.length !== 3 ||
      ids.length !== 3 ||
      !privacyArtifact?.artifactUri ||
      !websiteArtifact?.artifactUri
    ) {
      return false;
    }
    const values = [];
    for (let index = 0; index < 3; index += 1) {
      values.push(
        ids[index].id,
        documents[index].kind,
        documents[index].version,
        documents[index].contentDigest,
        documents[index].contentUri,
        documents[index].effectiveAt
      );
    }
    values.push(
      ids[0].id,
      privacyArtifact.artifactUri,
      privacyArtifact.artifactSha256,
      privacyArtifact.byteCount,
      privacyArtifact.mediaType,
      ids[2].id,
      websiteArtifact.artifactUri,
      websiteArtifact.artifactSha256,
      websiteArtifact.byteCount,
      websiteArtifact.mediaType,
      expected.schema,
      expected.authorityDigest
    );
    const result = await pool.query(PROJECT_LEGAL_CONSTANTS_QUERY, values);
    const row = result.rows[0] ?? {};
    return row.contract_marker_ready === true &&
      row.exact_documents_ready === true &&
      row.exact_artifacts_ready === true &&
      row.authority_digest_ready === true;
  }

  async function transaction(
    {
      role = "authenticated",
      userId = null,
      organizationId = null,
      actorKind = null,
      isolation = "serializable",
      readOnly = false
    },
    work
  ) {
    const selectedRole = transactionRole(role);
    const selectedIsolation = isolationLevel(isolation);
    const selectedActorKind = serviceActorKind(actorKind);
    invariant(
      typeof work === "function",
      "DATABASE_TRANSACTION_INVALID",
      "PostgreSQL transaction work is required.",
      { status: 500 }
    );
    if (selectedRole === "authenticated") {
      requiredString(
        userId,
        "DATABASE_PRINCIPAL_REQUIRED",
        "An authenticated PostgreSQL user principal is required."
      );
      requiredString(
        organizationId,
        "DATABASE_TENANT_REQUIRED",
        "An authenticated PostgreSQL organization scope is required."
      );
    }
    invariant(
      selectedActorKind === null || selectedRole === "service_role",
      "DATABASE_SERVICE_ACTOR_INVALID",
      "A service actor can only be used by a service-role transaction.",
      { status: 500 }
    );
    if (
      selectedActorKind === "customer" ||
      selectedActorKind === "operator"
    ) {
      requiredString(
        userId,
        "DATABASE_SERVICE_ACTOR_REQUIRED",
        "A customer or operator service actor requires a user principal."
      );
      requiredString(
        organizationId,
        "DATABASE_SERVICE_ACTOR_REQUIRED",
        "A customer or operator service actor requires an organization scope."
      );
    }

    const acquired = await budgetRuntime.acquireClient();
    const client = acquired.client;
    try {
      await client.query(
        `begin isolation level ${selectedIsolation}${
          readOnly ? " read only" : ""
        }`
      );
      await client.query(`set local role ${selectedRole}`);
      await client.query(
        `select
          set_config('statement_timeout', $1, true),
          set_config('lock_timeout', $2, true),
          set_config('idle_in_transaction_session_timeout', $3, true),
          set_config('request.jwt.claim.sub', $4, true),
          set_config('request.jwt.claims', $5, true),
          set_config('app.organization_id', $6, true),
          set_config('app.service_actor_kind', $7, true),
          set_config('app.service_actor_user_id', $8, true),
          set_config('app.service_actor_organization_id', $9, true)`,
        [
          `${selectedBudgetPolicy.timeouts.statementMs}ms`,
          `${selectedBudgetPolicy.timeouts.lockMs}ms`,
          `${selectedBudgetPolicy.timeouts.idleInTransactionMs}ms`,
          userId ?? "",
          JSON.stringify({
            ...(userId ? { sub: userId } : {}),
            ...(organizationId
              ? { organization_id: organizationId }
              : {})
          }),
          organizationId ?? "",
          selectedActorKind ?? "",
          selectedActorKind && userId ? userId : "",
          selectedActorKind && organizationId ? organizationId : ""
        ]
      );
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      acquired.release();
    }
  }

  return Object.freeze({
    kind: "canonical-postgres",
    pool,
    readiness,
    projectLegalAuthorityMatches,
    assertReady,
    budgetReadiness: budgetRuntime.readiness,

    tenant({ userId, organizationId, isolation, readOnly = false }, work) {
      return transaction(
        {
          role: "authenticated",
          userId,
          organizationId,
          isolation,
          readOnly
        },
        work
      );
    },

    service(
      {
        actorKind = null,
        userId = null,
        organizationId = null,
        isolation,
        readOnly = false
      } = {},
      work
    ) {
      return transaction(
        {
          role: "service",
          actorKind,
          userId,
          organizationId,
          isolation,
          readOnly
        },
        work
      );
    },

    async close() {
      await pool.end();
    }
  });
}

// Kept as an explicit failure for stale imports. The aggregate JSON repository
// was a prototype and is not a production persistence option.
export function createPostgresHostedRepository() {
  throw new HostedError(
    "AGGREGATE_POSTGRES_REMOVED",
    "Use createCanonicalPostgresAuthority; production data belongs in normalized ss tables.",
    { status: 500 }
  );
}
