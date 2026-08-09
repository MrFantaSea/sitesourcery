begin;

do $$
begin
  if to_regclass('ss.alakazam_subscriptions') is null
    or to_regprocedure('ss.hosted_runtime_contract_v33()') is null
    or to_regprocedure('ss.hosted_runtime_contract_v47()') is null
  then
    raise exception
      'Site Sourcery migrations through 047 must be applied before Alakazam 50 authority'
      using errcode = '55000';
  end if;
end
$$;

create table ss.alakazam_50_configurations (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  subscription_id uuid not null,
  subscription_revision bigint not null
    constraint alakazam_50_config_subscription_revision_check
    check (subscription_revision > 0),
  configuration_revision bigint not null
    constraint alakazam_50_config_revision_check
    check (configuration_revision > 0),
  cash_app_handle text
    constraint alakazam_50_config_cash_app_check
    check (
      cash_app_handle is null
      or cash_app_handle ~ '^[A-Za-z0-9_.-]{1,30}$'
    ),
  venmo_handle text
    constraint alakazam_50_config_venmo_check
    check (
      venmo_handle is null
      or venmo_handle ~ '^[A-Za-z0-9_.-]{1,30}$'
    ),
  font_choice_id text not null
    constraint alakazam_50_config_font_check
    check (font_choice_id in ('inherit', 'editorial', 'studio')),
  border_choice_id text not null
    constraint alakazam_50_config_border_check
    check (border_choice_id in ('soft', 'sharp', 'ornate')),
  menu jsonb not null,
  configuration_digest ss.sha256_hex not null,
  state text not null default 'held'
    constraint alakazam_50_config_state_check
    check (state = 'held'),
  hold_reason text not null
    default 'commercial_cutover_not_authorized'
    constraint alakazam_50_config_hold_reason_check
    check (hold_reason = 'commercial_cutover_not_authorized'),
  configured_at timestamptz not null,
  constraint alakazam_50_config_customer_user_fk
    foreign key (customer_user_id)
    references auth.users(id),
  constraint alakazam_50_config_project_fk
    foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  constraint alakazam_50_config_membership_fk
    foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  constraint alakazam_50_config_subscription_fk
    foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id),
  constraint alakazam_50_config_scope_uniq
    unique (organization_id, id),
  constraint alakazam_50_config_project_revision_uniq
    unique (organization_id, project_id, configuration_revision),
  constraint alakazam_50_config_digest_uniq
    unique (organization_id, configuration_digest)
);

create index alakazam_50_config_project
  on ss.alakazam_50_configurations(
    organization_id,
    project_id,
    configuration_revision desc
  );

create table ss.alakazam_50_care_requests (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  subscription_id uuid not null,
  subscription_revision bigint not null
    constraint alakazam_50_care_subscription_revision_check
    check (subscription_revision > 0),
  care_class text not null
    constraint alakazam_50_care_class_check
    check (care_class = 'more'),
  request_message text not null
    constraint alakazam_50_care_message_check
    check (
      char_length(request_message) between 1 and 1000
      and request_message = btrim(request_message)
    ),
  request_digest ss.sha256_hex not null,
  state text not null default 'held'
    constraint alakazam_50_care_state_check
    check (state = 'held'),
  hold_reason text not null
    default 'commercial_cutover_not_authorized'
    constraint alakazam_50_care_hold_reason_check
    check (hold_reason = 'commercial_cutover_not_authorized'),
  requested_at timestamptz not null,
  constraint alakazam_50_care_customer_user_fk
    foreign key (customer_user_id)
    references auth.users(id),
  constraint alakazam_50_care_project_fk
    foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  constraint alakazam_50_care_membership_fk
    foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  constraint alakazam_50_care_subscription_fk
    foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id),
  constraint alakazam_50_care_scope_uniq
    unique (organization_id, id),
  constraint alakazam_50_care_digest_uniq
    unique (organization_id, request_digest)
);

create index alakazam_50_care_project
  on ss.alakazam_50_care_requests(
    organization_id,
    project_id,
    requested_at desc,
    id desc
  );

create function ss.valid_alakazam_50_menu(selected_menu jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select
    jsonb_typeof(selected_menu) = 'array'
    and jsonb_array_length(selected_menu) between 1 and 4
    and (
      select count(*) = jsonb_array_length(selected_menu)
        and count(distinct item ->> 'target') = count(*)
        and bool_and(
          jsonb_typeof(item) = 'object'
          and item ?& array['label', 'target']
          and item - 'label' - 'target' = '{}'::jsonb
          and jsonb_typeof(item -> 'label') = 'string'
          and char_length(item ->> 'label') between 1 and 32
          and item ->> 'label' = btrim(item ->> 'label')
          and item ->> 'target' in (
            'about', 'offerings', 'practical', 'contact'
          )
        )
      from jsonb_array_elements(selected_menu) item
    )
$$;

alter table ss.alakazam_50_configurations
  add constraint alakazam_50_config_menu_check
  check (ss.valid_alakazam_50_menu(menu));

create function ss.validate_alakazam_50_subscription_authority(
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_customer_user_id uuid,
  selected_subscription_id uuid,
  selected_subscription_revision bigint
)
returns boolean
language sql
stable
set search_path = pg_catalog, ss
as $$
  select exists (
    select 1
      from ss.alakazam_subscriptions subscription
      join ss.organization_memberships membership
        on membership.organization_id = subscription.organization_id
       and membership.user_id = subscription.customer_user_id
       and membership.state = 'active'
       and membership.role in ('owner', 'admin', 'editor')
     where subscription.organization_id = selected_organization_id
       and subscription.project_id = selected_project_id
       and subscription.customer_user_id = selected_customer_user_id
       and subscription.id = selected_subscription_id
       and subscription.revision = selected_subscription_revision
       and subscription.status in ('active', 'grace')
       and subscription.tier_id = 'alakazam_50'
  )
$$;

create function ss.validate_alakazam_50_configuration()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  current_revision bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-alakazam-50-configuration:' || new.project_id::text,
      0
    )
  );
  if not ss.validate_alakazam_50_subscription_authority(
    new.organization_id,
    new.project_id,
    new.customer_user_id,
    new.subscription_id,
    new.subscription_revision
  ) then
    raise exception
      'Alakazam 50 configuration lacks exact active subscription authority'
      using errcode = '23514';
  end if;

  select coalesce(max(configuration.configuration_revision), 0)
    into current_revision
    from ss.alakazam_50_configurations configuration
   where configuration.organization_id = new.organization_id
     and configuration.project_id = new.project_id
     and configuration.id <> new.id;
  if new.configuration_revision <> current_revision + 1 then
    raise exception
      'Alakazam 50 configuration revision is stale'
      using errcode = '40001';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_50_configurations_validate
after insert on ss.alakazam_50_configurations
deferrable initially deferred
for each row execute function ss.validate_alakazam_50_configuration();

create function ss.validate_alakazam_50_care_request()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not ss.validate_alakazam_50_subscription_authority(
    new.organization_id,
    new.project_id,
    new.customer_user_id,
    new.subscription_id,
    new.subscription_revision
  ) then
    raise exception
      'Alakazam 50 care request lacks exact active subscription authority'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_50_care_requests_validate
after insert on ss.alakazam_50_care_requests
deferrable initially deferred
for each row execute function ss.validate_alakazam_50_care_request();

create function ss.reject_alakazam_50_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  raise exception
    'Alakazam 50 authority evidence is immutable'
    using errcode = '55000';
end
$$;

create trigger alakazam_50_configurations_immutable
before update or delete on ss.alakazam_50_configurations
for each row execute function ss.reject_alakazam_50_evidence_mutation();

create trigger alakazam_50_care_requests_immutable
before update or delete on ss.alakazam_50_care_requests
for each row execute function ss.reject_alakazam_50_evidence_mutation();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'alakazam_50_configurations',
    'alakazam_50_care_requests'
  ] loop
    execute format('alter table ss.%I enable row level security', table_name);
    execute format('alter table ss.%I force row level security', table_name);
    execute format(
      'revoke all on ss.%I from public, anon, authenticated, service_role',
      table_name
    );
    execute format(
      'grant select, insert on ss.%I to service_role',
      table_name
    );
  end loop;
end
$$;

revoke all on function
  ss.valid_alakazam_50_menu(jsonb),
  ss.validate_alakazam_50_subscription_authority(uuid, uuid, uuid, uuid, bigint),
  ss.validate_alakazam_50_configuration(),
  ss.validate_alakazam_50_care_request(),
  ss.reject_alakazam_50_evidence_mutation()
from public, anon, authenticated, service_role;

grant execute on function
  ss.valid_alakazam_50_menu(jsonb),
  ss.validate_alakazam_50_subscription_authority(uuid, uuid, uuid, uuid, bigint),
  ss.validate_alakazam_50_configuration(),
  ss.validate_alakazam_50_care_request(),
  ss.reject_alakazam_50_evidence_mutation()
to service_role;

create function ss.hosted_alakazam_50_contract()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-alakazam-50-held-v1'::text
$$;

revoke all on function ss.hosted_alakazam_50_contract()
from public, anon, authenticated;
grant execute on function ss.hosted_alakazam_50_contract()
to service_role;

commit;
