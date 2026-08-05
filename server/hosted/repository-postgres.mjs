import pg from "pg";

import { HostedError, invariant } from "./errors.mjs";

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
      and to_regprocedure(
        'ss.service_operator_has_capability(uuid,text,timestamp with time zone)'
      ) is not null
      and to_regprocedure('ss.prepare_service_quote_acceptance()') is not null
      as custom_service_quotes_schema_ready,
    to_regclass('ss.release_requests') is not null as releases_ready,
    to_regclass('ss.export_requests') is not null as exports_ready,
    to_regclass('ss.export_download_authorizations') is not null as export_grants_ready,
    to_regclass('ss.audit_events') is not null as audit_ready,
    to_regclass('ss.idempotency_keys') is not null as idempotency_ready
`;

const CUSTOM_SERVICES_READINESS_QUERY = `
  select
    (
      select count(*) = 1
        from ss.service_catalog_policies policy
        join ss.legal_documents document
          on document.id = policy.legal_document_id
       where policy.id = '00000000-0000-4000-8000-000000000341'
         and policy.catalog_version = 'SS-PROFESSIONAL-2026.1'
         and policy.service_key = 'website_assessment_standard'
         and policy.pricing_mode = 'fixed'
         and policy.billing_cadence = 'one_time'
         and policy.currency = 'USD'
         and policy.unit_amount_minor = 20000
         and policy.minimum_quantity = 1
         and policy.maximum_quantity = 1
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
         and document.retired_at is null
         and (
           select count(*) = 4
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
              'service_intakes'
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
    (
      select count(*) = 8
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
           'service_quote_acceptances'
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
           'service_quote_acceptances'
         )
         and constraint_record.contype = 'f'
         and constraint_record.confdeltype = 'c'
    ) as custom_service_quotes_retention_ready,
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
        contract.definitions ~ 'service_amount_minor = 20000'
        and contract.definitions ~ 'subtotal_minor = 20000'
        and contract.definitions ~ 'currency = ''USD'''
        and contract.definitions ~
          'tax_state = ''calculation_required'''
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
        and contract.definitions ~ 'unit_amount_minor = 20000'
        and contract.definitions ~ 'amount_minor = 20000'
        and contract.definitions ~ 'due_trigger = ''before_work'''
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
    ) as custom_service_quotes_acceptance_ready
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
    allowExitOnIdle: options.allowExitOnIdle ?? false,
    ssl: options.ssl
  });
}

export function createCanonicalPostgresAuthority({ pool } = {}) {
  invariant(
    pool &&
      typeof pool.connect === "function" &&
      typeof pool.query === "function",
    "DATABASE_CONFIGURATION_REQUIRED",
    "PostgreSQL pool is required.",
    { status: 500 }
  );

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
          custom_service_quotes_security_ready: false,
          custom_service_quotes_retention_ready: false,
          custom_service_quotes_digests_ready: false,
          custom_service_quotes_terms_ready: false,
          custom_service_quotes_operator_authority_ready: false,
          custom_service_quotes_acceptance_ready: false
        });
      } else {
        Object.assign(row, {
          custom_service_quotes_contract_marker_ready: false,
          custom_service_quotes_security_ready: false,
          custom_service_quotes_retention_ready: false,
          custom_service_quotes_digests_ready: false,
          custom_service_quotes_terms_ready: false,
          custom_service_quotes_operator_authority_ready: false,
          custom_service_quotes_acceptance_ready: false
        });
      }
      const missing = Object.entries(row)
        .filter(
          ([key, value]) =>
            key.endsWith("_ready") && value !== true
        )
        .map(([key]) => key.replace(/_ready$/u, ""))
        .sort();
      if (missing.length > 0) {
        return {
          ready: false,
          kind: "canonical-postgres",
          code: "DATABASE_NOT_MIGRATED",
          database: row.database_name,
          missing
        };
      }
      return {
        ready: true,
        kind: "canonical-postgres",
        database: row.database_name,
        authoritySchema: "ss"
      };
    } catch {
      return {
        ready: false,
        kind: "canonical-postgres",
        code: "DATABASE_UNAVAILABLE",
        database: null
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
        : "Canonical PostgreSQL migrations 000 through 015 plus migrations 017 through 035 are required.",
      { status: 503, details: status }
    );
    return status;
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

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `set transaction isolation level ${selectedIsolation}${
          readOnly ? " read only" : ""
        }`
      );
      await client.query(`set local role ${selectedRole}`);
      await client.query(
        "select set_config('request.jwt.claim.sub', $1, true)",
        [userId ?? ""]
      );
      await client.query(
        "select set_config('request.jwt.claims', $1, true)",
        [
          JSON.stringify({
            ...(userId ? { sub: userId } : {}),
            ...(organizationId
              ? { organization_id: organizationId }
              : {})
          })
        ]
      );
      await client.query(
        "select set_config('app.organization_id', $1, true)",
        [organizationId ?? ""]
      );
      await client.query(
        "select set_config('app.service_actor_kind', $1, true)",
        [selectedActorKind ?? ""]
      );
      await client.query(
        "select set_config('app.service_actor_user_id', $1, true)",
        [selectedActorKind && userId ? userId : ""]
      );
      await client.query(
        "select set_config('app.service_actor_organization_id', $1, true)",
        [selectedActorKind && organizationId ? organizationId : ""]
      );
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  return Object.freeze({
    kind: "canonical-postgres",
    pool,
    readiness,
    assertReady,

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
