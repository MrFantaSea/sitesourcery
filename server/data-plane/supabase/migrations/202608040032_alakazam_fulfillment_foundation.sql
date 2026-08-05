begin;

do $$
begin
  if to_regclass('ss.alakazam_subscriptions') is null
    or to_regclass('ss.alakazam_change_quotes') is null
    or to_regclass('ss.site_versions') is null
    or to_regclass('ss.project_addresses') is null
    or to_regclass('ss.project_serving_projection') is null
    or to_regprocedure(
      'ss.hosted_runtime_contract_v31()'
    ) is null
  then
    raise exception
      'Site Sourcery migration 031 must be applied before Alakazam fulfillment'
      using errcode = '55000';
  end if;
end
$$;

create table ss.alakazam_fulfillment_intents (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  quote_id uuid not null,
  version_id uuid not null,
  artifact_digest ss.sha256_hex not null,
  address_id uuid not null,
  hostname ss.canonical_hostname not null,
  target_tier_id text not null
    check (
      target_tier_id in (
        'alakazam_25',
        'alakazam_35',
        'alakazam_50'
      )
    ),
  state text not null default 'prepared'
    check (
      state in (
        'prepared',
        'activated',
        'superseded',
        'completed'
      )
    ),
  intent_digest ss.sha256_hex not null,
  prepared_at timestamptz not null,
  activated_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(
      organization_id,
      user_id
    ),
  foreign key (organization_id, quote_id)
    references ss.alakazam_change_quotes(
      organization_id,
      id
    ) on delete cascade,
  foreign key (organization_id, version_id)
    references ss.site_versions(organization_id, id),
  foreign key (organization_id, address_id)
    references ss.project_addresses(organization_id, id),
  unique (organization_id, id),
  unique (quote_id),
  unique (intent_digest),
  check (
    (state in ('prepared', 'superseded')
      and activated_at is null)
    or (state in ('activated', 'completed')
      and activated_at is not null)
  ),
  check (
    (state = 'completed' and completed_at is not null)
    or (state <> 'completed' and completed_at is null)
  )
);

create unique index alakazam_one_open_fulfillment_intent
  on ss.alakazam_fulfillment_intents(
    organization_id,
    project_id
  )
  where state in ('prepared', 'activated');

create table ss.alakazam_fulfillment_operations (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  intent_id uuid not null,
  subscription_id uuid not null,
  subscription_revision bigint not null
    check (subscription_revision > 0),
  operation_kind text not null
    check (operation_kind = 'start_activation'),
  capability text not null
    check (
      capability = 'publish_accepted_project_version'
    ),
  effective_tier_id text not null
    check (
      effective_tier_id in (
        'alakazam_25',
        'alakazam_35',
        'alakazam_50'
      )
    ),
  policy_schema text not null
    check (
      policy_schema =
        'sitesourcery.alakazam-effective-policy/v1'
    ),
  policy_digest ss.sha256_hex not null,
  state text not null default 'queued'
    check (
      state in (
        'queued',
        'processing',
        'published',
        'dark',
        'failed'
      )
    ),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  serving_revision bigint not null default 0
    check (serving_revision >= 0),
  effective_artifact_id uuid,
  effective_artifact_digest ss.sha256_hex,
  screening_id uuid,
  release_request_id uuid,
  result_release_id uuid,
  decision_digest ss.sha256_hex,
  failure_code text,
  queued_at timestamptz not null,
  published_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(
      organization_id,
      user_id
    ),
  foreign key (organization_id, intent_id)
    references ss.alakazam_fulfillment_intents(
      organization_id,
      id
    ) on delete cascade,
  foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(
      organization_id,
      id
    ) on delete cascade,
  foreign key (organization_id, effective_artifact_id)
    references ss.artifacts(organization_id, id),
  foreign key (organization_id, screening_id)
    references ss.release_screenings(organization_id, id),
  foreign key (organization_id, release_request_id)
    references ss.release_requests(organization_id, id),
  foreign key (organization_id, result_release_id)
    references ss.releases(organization_id, id),
  unique (organization_id, id),
  unique (
    subscription_id,
    subscription_revision,
    operation_kind
  ),
  unique (release_request_id),
  check (
    (lease_owner is null) = (lease_expires_at is null)
  ),
  check (
    (state = 'published' and result_release_id is not null
      and effective_artifact_id is not null
      and effective_artifact_digest is not null
      and screening_id is not null
      and release_request_id is not null
      and decision_digest is not null
      and published_at is not null)
    or state <> 'published'
  ),
  check (
    (effective_artifact_id is null
      and effective_artifact_digest is null)
    or (effective_artifact_id is not null
      and effective_artifact_digest is not null)
  ),
  check (
    (screening_id is null
      and release_request_id is null
      and decision_digest is null)
    or (screening_id is not null
      and release_request_id is not null)
  ),
  check (
    screening_id is null
    or effective_artifact_id is not null
  ),
  check (
    failure_code is null
    or state in ('dark', 'failed')
  )
);

create index alakazam_fulfillment_operations_ready
  on ss.alakazam_fulfillment_operations(
    state,
    queued_at,
    id
  )
  where state in ('queued', 'processing', 'dark', 'failed');

create table ss.alakazam_fulfillment_projection (
  organization_id uuid not null,
  project_id uuid primary key,
  intent_id uuid not null,
  operation_id uuid,
  state text not null
    check (
      state in (
        'prepared',
        'pending',
        'live',
        'dark',
        'failed'
      )
    ),
  hostname ss.canonical_hostname not null,
  effective_tier_id text,
  subscription_revision bigint
    check (
      subscription_revision is null
      or subscription_revision > 0
    ),
  current_release_id uuid,
  last_failure_code text,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, intent_id)
    references ss.alakazam_fulfillment_intents(
      organization_id,
      id
    ) on delete cascade,
  foreign key (organization_id, operation_id)
    references ss.alakazam_fulfillment_operations(
      organization_id,
      id
    ),
  foreign key (organization_id, current_release_id)
    references ss.releases(organization_id, id),
  check (
    (state = 'prepared' and operation_id is null
      and effective_tier_id is null
      and subscription_revision is null)
    or (state <> 'prepared' and operation_id is not null
      and effective_tier_id is not null
      and subscription_revision is not null)
  ),
  check (
    (state = 'live' and current_release_id is not null)
    or state <> 'live'
  ),
  check (
    last_failure_code is null
    or state in ('dark', 'failed')
  )
);

create or replace function ss.validate_release_screening()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  expected_digest ss.sha256_hex;
  expected_project_id uuid;
begin
  select artifact.artifact_digest, version.project_id
  into expected_digest, expected_project_id
  from ss.site_versions version
  join ss.artifacts artifact
    on artifact.organization_id = version.organization_id
   and artifact.id = version.artifact_id
  where version.organization_id = new.organization_id
    and version.id = new.version_id;

  if found
    and expected_project_id = new.project_id
    and expected_digest = new.artifact_digest
  then
    return new;
  end if;

  if new.stage = 'pre_publication'
    and new.method = 'alakazam_effective_policy'
    and exists (
      select 1
        from ss.alakazam_fulfillment_operations operation
        join ss.alakazam_fulfillment_intents intent
          on intent.organization_id = operation.organization_id
         and intent.id = operation.intent_id
        join ss.version_state_projection version_state
          on version_state.organization_id = intent.organization_id
         and version_state.project_id = intent.project_id
         and version_state.version_id = intent.version_id
         and version_state.state = 'accepted_release'
        join ss.artifacts artifact
          on artifact.organization_id = operation.organization_id
         and artifact.id = operation.effective_artifact_id
       where operation.organization_id = new.organization_id
         and operation.project_id = new.project_id
         and operation.state = 'processing'
         and intent.version_id = new.version_id
         and operation.effective_artifact_digest =
             new.artifact_digest
         and artifact.artifact_digest = new.artifact_digest
    )
  then
    return new;
  end if;

  raise exception
    'release screening does not match exact version or policy-derived artifact'
    using errcode = '23514';
end
$$;

create function ss.validate_alakazam_fulfillment_intent()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
      from ss.alakazam_change_quotes quote
      join ss.site_versions version
        on version.organization_id = quote.organization_id
       and version.project_id = quote.project_id
       and version.id = new.version_id
      join ss.version_state_projection version_state
        on version_state.organization_id = version.organization_id
       and version_state.project_id = version.project_id
       and version_state.version_id = version.id
       and version_state.state = 'accepted_release'
      join ss.artifacts artifact
        on artifact.organization_id = version.organization_id
       and artifact.project_id = version.project_id
       and artifact.id = version.artifact_id
      join ss.project_addresses address
        on address.organization_id = quote.organization_id
       and address.project_id = quote.project_id
       and address.id = new.address_id
      join ss.project_address_projection address_projection
        on address_projection.organization_id = address.organization_id
       and address_projection.project_id = address.project_id
       and address_projection.current_address_id = address.id
     where quote.organization_id = new.organization_id
       and quote.project_id = new.project_id
       and quote.customer_user_id = new.customer_user_id
       and quote.id = new.quote_id
       and quote.change_kind = 'start'
       and quote.target_tier_id = new.target_tier_id
       and quote.provider_effects_authorized
       and new.prepared_at >= quote.issued_at
       and new.prepared_at < quote.expires_at
       and artifact.artifact_digest = new.artifact_digest
       and address.kind = 'licensed'
       and address.ownership = 'licensed'
       and address.state = 'configured'
       and address.serving_hostname = new.hostname
  ) then
    raise exception
      'Alakazam fulfillment intent lacks exact accepted platform-site evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_fulfillment_intents_validate
after insert on ss.alakazam_fulfillment_intents
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_fulfillment_intent();

create function ss.validate_alakazam_fulfillment_operation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
      from ss.alakazam_fulfillment_intents intent
      join ss.alakazam_change_quotes quote
        on quote.organization_id = intent.organization_id
       and quote.id = intent.quote_id
      join ss.alakazam_subscriptions subscription
        on subscription.organization_id = intent.organization_id
       and subscription.project_id = intent.project_id
       and subscription.customer_user_id = intent.customer_user_id
       and subscription.id = new.subscription_id
     where intent.organization_id = new.organization_id
       and intent.project_id = new.project_id
       and intent.customer_user_id = new.customer_user_id
       and intent.id = new.intent_id
       and intent.state in ('activated', 'completed')
       and quote.state = 'applied'
       and quote.target_tier_id = new.effective_tier_id
       and subscription.status in ('active', 'grace')
       and subscription.revision = new.subscription_revision
       and subscription.tier_id = new.effective_tier_id
  ) then
    raise exception
      'Alakazam fulfillment operation lacks exact active revision evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_fulfillment_operations_validate
after insert on ss.alakazam_fulfillment_operations
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_fulfillment_operation();

create function ss.guard_alakazam_fulfillment_intent_update()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if row(
    new.organization_id,
    new.project_id,
    new.customer_user_id,
    new.quote_id,
    new.version_id,
    new.artifact_digest,
    new.address_id,
    new.hostname,
    new.target_tier_id,
    new.intent_digest,
    new.prepared_at
  ) is distinct from row(
    old.organization_id,
    old.project_id,
    old.customer_user_id,
    old.quote_id,
    old.version_id,
    old.artifact_digest,
    old.address_id,
    old.hostname,
    old.target_tier_id,
    old.intent_digest,
    old.prepared_at
  ) then
    raise exception
      'Alakazam fulfillment intent evidence is immutable'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger alakazam_fulfillment_intents_guard
before update on ss.alakazam_fulfillment_intents
for each row execute function
  ss.guard_alakazam_fulfillment_intent_update();

create function ss.guard_alakazam_fulfillment_operation_update()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if row(
    new.organization_id,
    new.project_id,
    new.customer_user_id,
    new.intent_id,
    new.subscription_id,
    new.subscription_revision,
    new.operation_kind,
    new.capability,
    new.effective_tier_id,
    new.policy_schema,
    new.policy_digest,
    new.queued_at
  ) is distinct from row(
    old.organization_id,
    old.project_id,
    old.customer_user_id,
    old.intent_id,
    old.subscription_id,
    old.subscription_revision,
    old.operation_kind,
    old.capability,
    old.effective_tier_id,
    old.policy_schema,
    old.policy_digest,
    old.queued_at
  ) then
    raise exception
      'Alakazam fulfillment operation authority is immutable'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger alakazam_fulfillment_operations_guard
before update on ss.alakazam_fulfillment_operations
for each row execute function
  ss.guard_alakazam_fulfillment_operation_update();

do $$
declare
  table_name text;
  tables text[] := array[
    'alakazam_fulfillment_intents',
    'alakazam_fulfillment_operations',
    'alakazam_fulfillment_projection'
  ];
begin
  foreach table_name in array tables loop
    execute format(
      'alter table ss.%I enable row level security',
      table_name
    );
    execute format(
      'alter table ss.%I force row level security',
      table_name
    );
    execute format(
      'revoke all on ss.%I from public, anon, authenticated',
      table_name
    );
    execute format(
      'grant all privileges on ss.%I to service_role',
      table_name
    );
  end loop;
end
$$;

revoke all on function
  ss.validate_alakazam_fulfillment_intent(),
  ss.validate_alakazam_fulfillment_operation(),
  ss.guard_alakazam_fulfillment_intent_update(),
  ss.guard_alakazam_fulfillment_operation_update()
from public, anon, authenticated;

grant execute on function
  ss.validate_alakazam_fulfillment_intent(),
  ss.validate_alakazam_fulfillment_operation(),
  ss.guard_alakazam_fulfillment_intent_update(),
  ss.guard_alakazam_fulfillment_operation_update()
to service_role;

create function ss.hosted_runtime_contract_v32()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-ss-v32-alakazam-fulfillment-foundation'
    ::text
$$;

revoke all on function ss.hosted_runtime_contract_v32()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v32()
to authenticated, service_role;

commit;
