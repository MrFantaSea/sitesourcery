begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists ss;

create domain ss.sha256_hex as text
  check (value ~ '^[0-9a-f]{64}$');

create domain ss.canonical_hostname as text
  check (
    value = lower(value)
    and value !~ '\.$'
    and length(value) <= 253
    and value ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  );

create function ss.jwt_claims()
returns jsonb
language sql
stable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when nullif(current_setting('request.jwt.claims', true), '') is null
      then '{}'::jsonb
    else nullif(current_setting('request.jwt.claims', true), '')::jsonb
  end
$$;

create function ss.current_user_id()
returns uuid
language sql
stable
parallel safe
set search_path = pg_catalog, ss
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
    nullif(ss.jwt_claims() ->> 'sub', '')::uuid
  )
$$;

create function ss.current_org_id()
returns uuid
language sql
stable
parallel safe
set search_path = pg_catalog, ss
as $$
  select coalesce(
    nullif(current_setting('app.organization_id', true), '')::uuid,
    nullif(ss.jwt_claims() ->> 'organization_id', '')::uuid,
    nullif(ss.jwt_claims() ->> 'org_id', '')::uuid,
    nullif(ss.jwt_claims() #>> '{app_metadata,organization_id}', '')::uuid,
    nullif(ss.jwt_claims() #>> '{app_metadata,org_id}', '')::uuid
  )
$$;

create function ss.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create function ss.reject_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception '% is immutable', tg_table_schema || '.' || tg_table_name
    using errcode = '55000';
end
$$;

create table ss.organizations (
  id uuid primary key default extensions.gen_random_uuid(),
  created_by_user_id uuid not null references auth.users(id),
  name text not null check (char_length(name) between 2 and 120),
  state text not null default 'active'
    check (state in ('active', 'suspended', 'deleting', 'deleted')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (id, id)
);

create trigger organizations_updated_at
before update on ss.organizations
for each row execute function ss.set_updated_at();

create table ss.organization_memberships (
  organization_id uuid not null references ss.organizations(id),
  user_id uuid not null references auth.users(id),
  role text not null
    check (role in ('owner', 'admin', 'editor', 'billing', 'viewer')),
  state text not null default 'active'
    check (state in ('invited', 'active', 'suspended', 'removed')),
  invited_at timestamptz,
  accepted_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, user_id)
);

create index organization_memberships_user
  on ss.organization_memberships(user_id, organization_id)
  where state = 'active';

create trigger organization_memberships_updated_at
before update on ss.organization_memberships
for each row execute function ss.set_updated_at();

create function ss.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, ss
as $$
  select exists (
    select 1
    from ss.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = ss.current_user_id()
      and membership.state = 'active'
  )
$$;

create function ss.has_org_role(target_organization_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, ss
as $$
  select exists (
    select 1
    from ss.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = ss.current_user_id()
      and membership.state = 'active'
      and membership.role = any(allowed_roles)
  )
$$;

create function ss.can_access_org(target_organization_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, ss
as $$
  select target_organization_id = ss.current_org_id()
    and ss.is_org_member(target_organization_id)
$$;

create table ss.legal_documents (
  id uuid primary key default extensions.gen_random_uuid(),
  kind text not null
    check (kind in ('product', 'privacy', 'website', 'domain_agent', 'domain_renewal')),
  version text not null check (char_length(version) between 3 and 120),
  content_digest ss.sha256_hex not null,
  content_uri text not null,
  effective_at timestamptz not null,
  retired_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (kind, version),
  check (retired_at is null or retired_at >= effective_at)
);

create table ss.billing_policies (
  id uuid primary key default extensions.gen_random_uuid(),
  policy_key text not null unique,
  grace_period interval not null check (grace_period > interval '0'),
  retention_period interval not null check (retention_period > interval '0'),
  effective_at timestamptz not null,
  retired_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (retired_at is null or retired_at >= effective_at)
);

create table ss.catalog_plans (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_key text not null,
  catalog_version text not null,
  display_name text not null,
  active_from timestamptz not null,
  active_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (plan_key, catalog_version),
  check (active_until is null or active_until >= active_from)
);

create table ss.catalog_prices (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_id uuid not null references ss.catalog_plans(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  unit_amount_minor bigint not null check (unit_amount_minor >= 0),
  cadence text not null check (cadence in ('one_time', 'month', 'year')),
  approved_at timestamptz not null,
  active_from timestamptz not null,
  active_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (active_until is null or active_until >= active_from)
);

create table ss.commerce_control (
  singleton boolean primary key default true check (singleton),
  checkout_enabled boolean not null default false,
  live_mode boolean not null default false,
  active_catalog_version text,
  enabled_at timestamptz,
  enabled_by_user_id uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    not checkout_enabled
    or (
      active_catalog_version is not null
      and enabled_at is not null
      and enabled_by_user_id is not null
    )
  )
);

insert into ss.commerce_control (
  singleton,
  checkout_enabled,
  live_mode,
  active_catalog_version
) values (true, false, false, null);

create table ss.audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid references ss.organizations(id),
  project_id uuid,
  actor_kind text not null
    check (actor_kind in ('user', 'operator', 'system', 'provider')),
  actor_id text,
  action text not null,
  target_type text not null,
  target_id text not null,
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  previous_hash ss.sha256_hex,
  event_hash ss.sha256_hex not null,
  occurred_at timestamptz not null default clock_timestamp()
);

create index audit_events_org_time
  on ss.audit_events(organization_id, occurred_at desc);

create trigger audit_events_no_update
before update on ss.audit_events
for each row execute function ss.reject_update();

create table ss.idempotency_keys (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid references ss.organizations(id),
  principal_id uuid not null references auth.users(id),
  route_key text not null,
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 200),
  request_digest ss.sha256_hex not null,
  state text not null check (state in ('running', 'completed', 'failed')),
  response_status integer check (
    response_status is null or response_status between 100 and 599
  ),
  response_body jsonb,
  resource_type text,
  resource_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  unique (principal_id, route_key, idempotency_key),
  check (expires_at > created_at)
);

create table ss.transactional_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid references ss.organizations(id),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  dedupe_key text not null unique,
  available_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  locked_at timestamptz,
  locked_by text,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default clock_timestamp()
);

create index transactional_outbox_ready
  on ss.transactional_outbox(available_at, id)
  where published_at is null;

create table ss.lifecycle_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid references ss.organizations(id),
  project_id uuid,
  job_type text not null
    check (
      job_type in (
        'deploy_release',
        'verify_domain',
        'grace_expiry',
        'retention_expiry',
        'delete_blob',
        'finalize_deletion',
        'build_export',
        'expire_session'
      )
    ),
  dedupe_key text not null unique,
  state text not null default 'scheduled'
    check (state in ('scheduled', 'running', 'succeeded', 'failed', 'cancelled')),
  run_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 12 check (max_attempts > 0),
  locked_at timestamptz,
  locked_by text,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

create index lifecycle_jobs_ready
  on ss.lifecycle_jobs(run_at, id)
  where state in ('scheduled', 'failed');

create function ss.create_organization(organization_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  actor_id uuid := ss.current_user_id();
  organization_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if char_length(btrim(organization_name)) not between 2 and 120 then
    raise exception 'organization name must be between 2 and 120 characters'
      using errcode = '22023';
  end if;

  insert into ss.organizations (created_by_user_id, name)
  values (actor_id, btrim(organization_name))
  returning id into organization_id;

  insert into ss.organization_memberships (
    organization_id,
    user_id,
    role,
    state,
    accepted_at
  ) values (
    organization_id,
    actor_id,
    'owner',
    'active',
    clock_timestamp()
  );

  return organization_id;
end
$$;

revoke all on function ss.create_organization(text) from public;

commit;
