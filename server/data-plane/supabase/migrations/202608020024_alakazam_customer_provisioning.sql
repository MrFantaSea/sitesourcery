begin;

do $$
begin
  if to_regprocedure(
       'ss.hosted_runtime_contract_v23()'
     ) is null
    or to_regclass('ss.alakazam_change_quotes') is null
    or to_regclass('ss.commerce_v2_download_dispatches') is null
    or to_regclass('ss.stripe_customers') is null
  then
    raise exception
      'Site Sourcery migration 023 must be applied before Alakazam Customer provisioning'
      using errcode = '55000';
  end if;
end
$$;

-- A brand-new organization can start Alakazam directly. This reservation is
-- committed before Stripe is called, so an uncertain create response can never
-- be converted into an automatic second Customer creation.
create table ss.alakazam_customer_provisions (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null
    references auth.users(id),
  quote_id uuid not null unique,
  provider text not null check (provider = 'stripe'),
  provider_idempotency_key text not null unique
    check (
      char_length(provider_idempotency_key)
        between 8 and 255
    ),
  purpose jsonb not null
    check (
      jsonb_typeof(purpose) = 'object'
      and pg_column_size(purpose) <= 32768
    ),
  purpose_digest ss.sha256_hex not null unique,
  accepted_disclosure_digest ss.sha256_hex not null,
  quote_digest ss.sha256_hex not null,
  state text not null
    check (
      state in (
        'reserved',
        'confirmed',
        'reconciliation_required'
      )
    ),
  stripe_customer_id text unique
    check (
      stripe_customer_id is null
      or stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'
    ),
  provider_facts jsonb
    check (
      provider_facts is null
      or (
        jsonb_typeof(provider_facts) = 'object'
        and pg_column_size(provider_facts) <= 32768
      )
    ),
  provider_facts_digest ss.sha256_hex,
  provider_created_at timestamptz,
  provider_effect_certainty text not null
    check (
      provider_effect_certainty in (
        'not_submitted',
        'confirmed',
        'ambiguous'
      )
    ),
  provider_error_code text
    check (
      provider_error_code is null
      or char_length(provider_error_code)
           between 1 and 200
    ),
  lease_expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null
    default clock_timestamp(),
  updated_at timestamptz not null
    default clock_timestamp(),
  unique (organization_id),
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (
    organization_id,
    customer_user_id
  ) references ss.organization_memberships(
    organization_id,
    user_id
  ),
  foreign key (organization_id, quote_id)
    references ss.alakazam_change_quotes(
      organization_id,
      id
    ) on delete cascade,
  check (
    purpose = jsonb_build_object(
      'acceptedDisclosureDigest',
        accepted_disclosure_digest,
      'catalogVersion', 'alakazam.2026-08-02.v1',
      'customerId', customer_user_id::text,
      'organizationId', organization_id::text,
      'projectId', project_id::text,
      'provisionId', id::text,
      'quoteDigest', quote_digest,
      'quoteId', quote_id::text,
      'schema',
        'sitesourcery.alakazam-stripe-customer-purpose.v1',
      'termsVersion',
        'alakazam-owner-contract.2026-08-02.v1'
    )
  ),
  check (
    provider_facts is null
    or (
      provider_facts = jsonb_build_object(
        'customerId', customer_user_id::text,
        'organizationId', organization_id::text,
        'projectId', project_id::text,
        'providerCreatedAt',
          provider_facts ->> 'providerCreatedAt',
        'providerFactsDigest', provider_facts_digest,
        'provisionId', id::text,
        'purposeDigest', purpose_digest,
        'quoteId', quote_id::text,
        'schema',
          'sitesourcery.stripe-alakazam-customer/v1',
        'stripeCustomerId', stripe_customer_id
      )
      and (
        provider_facts ->> 'providerCreatedAt'
      )::timestamptz = provider_created_at
    )
  ),
  check (
    (
      state = 'reserved'
      and stripe_customer_id is null
      and provider_facts is null
      and provider_facts_digest is null
      and provider_created_at is null
      and provider_effect_certainty = 'not_submitted'
      and provider_error_code is null
      and confirmed_at is null
    )
    or (
      state = 'confirmed'
      and stripe_customer_id is not null
      and provider_facts is not null
      and provider_facts_digest is not null
      and provider_created_at is not null
      and provider_effect_certainty = 'confirmed'
      and provider_error_code is null
      and confirmed_at is not null
      and confirmed_at >= created_at
    )
    or (
      state = 'reconciliation_required'
      and provider_facts is null
      and provider_facts_digest is null
      and provider_created_at is null
      and provider_effect_certainty = 'ambiguous'
      and provider_error_code is not null
      and confirmed_at is null
    )
  ),
  check (lease_expires_at > created_at)
);

create function ss.validate_alakazam_customer_provision_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  -- Serialize the no-customer decision with the organization foreign-key row.
  perform 1
  from ss.organizations organization
  where organization.id = new.organization_id
    and organization.state = 'active'
  for update;

  if not found
    or new.state <> 'reserved'
    or new.provider_effect_certainty <> 'not_submitted'
    or new.created_at <> new.updated_at
    or new.lease_expires_at <>
       new.created_at + interval '2 minutes'
    or exists (
      select 1
      from ss.stripe_customers customer
      where customer.organization_id = new.organization_id
    )
    or exists (
      select 1
      from ss.commerce_v2_download_dispatches dispatch
      where dispatch.organization_id = new.organization_id
        and dispatch.state in (
          'dispatching',
          'ready',
          'effect_unknown'
        )
    )
    or not exists (
      select 1
      from ss.alakazam_change_quotes quote
      join ss.projects project
        on project.organization_id = quote.organization_id
       and project.id = quote.project_id
       and project.lifecycle = 'active'
      join ss.organization_memberships membership
        on membership.organization_id = quote.organization_id
       and membership.user_id = quote.customer_user_id
       and membership.state = 'active'
       and membership.role in ('owner', 'admin', 'editor')
      where quote.organization_id = new.organization_id
        and quote.id = new.quote_id
        and quote.project_id = new.project_id
        and quote.customer_user_id = new.customer_user_id
        and quote.change_kind = 'start'
        and quote.state = 'quoted'
        and quote.provider_effects_authorized
        and quote.due_now_subtotal_minor > 0
        and quote.expires_at > new.created_at
        and quote.catalog_version =
          new.purpose ->> 'catalogVersion'
        and quote.terms_version =
          new.purpose ->> 'termsVersion'
        and quote.disclosure_digest =
          new.accepted_disclosure_digest
        and quote.quote_digest = new.quote_digest
    )
  then
    raise exception
      'Alakazam Customer provisioning requires one exact unexpired start quote and no existing Customer effect'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger alakazam_customer_provisions_validate
before insert on ss.alakazam_customer_provisions
for each row execute function
  ss.validate_alakazam_customer_provision_insert();

create function ss.guard_alakazam_customer_provision_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if (
    to_jsonb(new) - array[
      'state',
      'stripe_customer_id',
      'provider_facts',
      'provider_facts_digest',
      'provider_created_at',
      'provider_effect_certainty',
      'provider_error_code',
      'confirmed_at',
      'updated_at'
    ]::text[]
  ) is distinct from (
    to_jsonb(old) - array[
      'state',
      'stripe_customer_id',
      'provider_facts',
      'provider_facts_digest',
      'provider_created_at',
      'provider_effect_certainty',
      'provider_error_code',
      'confirmed_at',
      'updated_at'
    ]::text[]
  ) then
    raise exception
      'Alakazam Customer provisioning purpose is immutable'
      using errcode = '55000';
  end if;

  if not (
    (
      old.state = 'reserved'
      and new.state in (
        'confirmed',
        'reconciliation_required'
      )
    )
    or (
      old.state = 'reconciliation_required'
      and new.state = 'confirmed'
    )
  )
  then
    raise exception
      'invalid Alakazam Customer provisioning transition'
      using errcode = '23514';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger alakazam_customer_provisions_guard_update
before update on ss.alakazam_customer_provisions
for each row execute function
  ss.guard_alakazam_customer_provision_update();

create function ss.validate_alakazam_customer_binding()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'confirmed'
    and not exists (
      select 1
      from ss.stripe_customers customer
      where customer.organization_id = new.organization_id
        and customer.stripe_customer_id =
          new.stripe_customer_id
    )
  then
    raise exception
      'confirmed Alakazam Customer provisioning lacks its exact organization binding'
      using errcode = '23514';
  end if;
  return null;
end
$$;

create constraint trigger alakazam_customer_provisions_binding
after insert or update on ss.alakazam_customer_provisions
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_customer_binding();

create function ss.guard_alakazam_customer_provision_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if old.state = 'reserved'
    and old.provider_effect_certainty = 'not_submitted'
  then
    return old;
  end if;
  if nullif(
       current_setting(
         'app.terminal_purge_project_id',
         true
       ),
       ''
     )::uuid = old.project_id
    and exists (
      select 1
      from ss.deletion_requests request
      where request.organization_id = old.organization_id
        and request.project_id = old.project_id
        and request.state = 'purging'
    )
  then
    return old;
  end if;
  raise exception
    'durable Alakazam Customer evidence is immutable'
    using errcode = '55000';
end
$$;

create trigger alakazam_customer_provisions_guard_delete
before delete on ss.alakazam_customer_provisions
for each row execute function
  ss.guard_alakazam_customer_provision_delete();

-- A new Download payment cannot open while the no-charge Customer effect is
-- in flight or ambiguous. Confirmed provisioning no longer blocks because the
-- canonical ss.stripe_customers binding then exists.
create function ss.prevent_download_during_alakazam_customer_provision()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if exists (
    select 1
    from ss.alakazam_customer_provisions provision
    where provision.organization_id = new.organization_id
      and provision.state in (
        'reserved',
        'reconciliation_required'
      )
  )
  then
    raise exception
      'Download Checkout waits for Alakazam Customer reconciliation'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger commerce_v2_download_dispatches_alakazam_customer_guard
before insert on ss.commerce_v2_download_dispatches
for each row execute function
  ss.prevent_download_during_alakazam_customer_provision();

create function ss.count_alakazam_customer_provision_purge()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'purging' then
    new.removal_counts :=
      coalesce(new.removal_counts, '{}'::jsonb)
      || jsonb_build_object(
        'alakazamCustomerProvisions', (
          select count(*)
          from ss.alakazam_customer_provisions
          where organization_id = new.organization_id
            and project_id = new.project_id
        )
      );
  end if;
  return new;
end
$$;

create trigger deletion_requests_count_alakazam_customer_provisions
before insert or update of state on ss.deletion_requests
for each row execute function
  ss.count_alakazam_customer_provision_purge();

alter table ss.alakazam_customer_provisions
  enable row level security;
alter table ss.alakazam_customer_provisions
  force row level security;
revoke all on ss.alakazam_customer_provisions
from public, anon, authenticated;
grant all privileges on ss.alakazam_customer_provisions
to service_role;

revoke all on function
  ss.validate_alakazam_customer_provision_insert(),
  ss.guard_alakazam_customer_provision_update(),
  ss.validate_alakazam_customer_binding(),
  ss.guard_alakazam_customer_provision_delete(),
  ss.prevent_download_during_alakazam_customer_provision(),
  ss.count_alakazam_customer_provision_purge()
from public, anon, authenticated;

grant execute on function
  ss.validate_alakazam_customer_provision_insert(),
  ss.guard_alakazam_customer_provision_update(),
  ss.validate_alakazam_customer_binding(),
  ss.guard_alakazam_customer_provision_delete(),
  ss.prevent_download_during_alakazam_customer_provision(),
  ss.count_alakazam_customer_provision_purge()
to service_role;

create function ss.hosted_runtime_contract_v24()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-ss-v24-alakazam-customer-provisioning'
    ::text
$$;

revoke all on function ss.hosted_runtime_contract_v24()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v24()
to authenticated, service_role;

commit;
