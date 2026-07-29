do $$
declare
  missing_rls integer;
  missing_force_rls integer;
begin
  if not exists (
    select 1
    from ss.commerce_control
    where singleton
      and not checkout_enabled
      and not live_mode
      and active_catalog_version is null
  ) then
    raise exception 'checkout must be disabled and unconfigured';
  end if;

  if exists (select 1 from ss.catalog_prices) then
    raise exception 'no catalog price may be seeded';
  end if;

  if exists (
    select 1 from ss.provider_receipts
    union all
    select 1 from ss.stripe_events
    union all
    select 1 from ss.stripe_customers
    union all
    select 1 from ss.stripe_subscriptions
  ) then
    raise exception 'no provider object may be seeded';
  end if;

  if not exists (
    select 1
    from ss.domain_procurement_control
    where singleton
      and not purchasing_enabled
      and not live_mode
      and active_provider_code is null
      and agent_legal_document_id is null
      and renewal_legal_document_id is null
  ) then
    raise exception 'domain procurement must be disabled and provider-neutral';
  end if;

  if exists (
    select 1 from ss.domain_quotes
    union all
    select 1 from ss.domain_payment_allocations
    union all
    select 1 from ss.domain_registration_intents
    union all
    select 1 from ss.domain_provider_operations
    union all
    select 1 from ss.domain_registrations
  ) then
    raise exception 'no domain provider or purchase object may be seeded';
  end if;

  if (
    select count(*)
    from information_schema.tables
    where table_schema = 'ss'
      and table_name in (
        'domain_procurement_control',
        'domain_quotes',
        'domain_registrant_snapshots',
        'domain_agent_consents',
        'domain_payment_allocations',
        'domain_registration_intents',
        'domain_irreversible_confirmations',
        'domain_provider_operations',
        'domain_provider_operation_events',
        'domain_registrar_debits',
        'domain_registrations',
        'domain_dns_change_sets',
        'domain_dns_records',
        'domain_renewal_intents',
        'domain_transfer_out_requests',
        'domain_transfer_exports',
        'domain_manual_reviews'
      )
  ) <> 17 then
    raise exception 'PostgreSQL domain procurement contract is incomplete';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'ss'
      and table_name = 'domain_registrant_snapshots'
      and is_nullable = 'NO'
      and column_name in (
        'encryption_algorithm',
        'encryption_key_version',
        'contact_ciphertext'
      )
  ) <> 3 then
    raise exception 'encrypted PostgreSQL registrant envelope is incomplete';
  end if;

  if not exists (
    select 1
    from ss.billing_policies
    where policy_key = 'abracadabra-hosted-14d-grace-90d-retention/v1'
      and grace_period = interval '14 days'
      and retention_period = interval '90 days'
  ) then
    raise exception 'billing lifecycle policy does not match reviewed behavior';
  end if;

  select count(*)
  into missing_rls
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  join pg_attribute attribute on attribute.attrelid = relation.oid
  where namespace.nspname = 'ss'
    and relation.relkind = 'r'
    and attribute.attname = 'organization_id'
    and not relation.relrowsecurity;

  if missing_rls <> 0 then
    raise exception '% tenant tables do not enable RLS', missing_rls;
  end if;

  select count(*)
  into missing_force_rls
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  join pg_attribute attribute on attribute.attrelid = relation.oid
  where namespace.nspname = 'ss'
    and relation.relkind = 'r'
    and attribute.attname = 'organization_id'
    and not relation.relforcerowsecurity;

  if missing_force_rls <> 0 then
    raise exception '% tenant tables do not force RLS', missing_force_rls;
  end if;

  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'ss'
      and relation.relname = 'domain_procurement_control'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) then
    raise exception 'domain procurement control must enable and force RLS';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger
    join pg_class relation on relation.oid = trigger.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'ss'
      and relation.relname = 'artifacts'
      and trigger.tgname = 'artifacts_no_update'
      and not trigger.tgisinternal
  ) then
    raise exception 'artifact immutability trigger is missing';
  end if;

  if (
    select count(*)
    from pg_trigger trigger
    join pg_class relation on relation.oid = trigger.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'ss'
      and not trigger.tgisinternal
      and trigger.tgname in (
        'domain_irreversible_confirmation_barrier',
        'domain_provider_operation_subject_barrier',
        'domain_registration_exact_provider_result',
        'domain_registrar_debit_not_stripe',
        'domain_transfer_export_ready'
      )
  ) <> 5 then
    raise exception 'PostgreSQL domain evidence barriers are incomplete';
  end if;
end
$$;

select
  'POSTGRES_INVARIANTS_PASS' as result,
  (select count(*) from information_schema.tables where table_schema = 'ss')
    as table_count;
