begin;

do $$
begin
  if to_regclass('ss.alakazam_subscriptions') is null
    or to_regclass('ss.site_versions') is null
    or to_regclass('ss.version_state_projection') is null
    or to_regprocedure('ss.hosted_runtime_contract_v33()') is null
    or to_regprocedure('ss.hosted_runtime_contract_v47()') is null
  then
    raise exception
      'Site Sourcery migrations through 047 must be applied before Alakazam 35 fulfillment'
      using errcode = '55000';
  end if;
end
$$;

create table ss.alakazam_35_photo_assets (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  subscription_id uuid not null,
  subscription_revision bigint not null
    constraint alakazam_35_photo_subscription_revision_check
    check (subscription_revision > 0),
  media_type text not null
    constraint alakazam_35_photo_media_type_check
    check (media_type in ('image/jpeg', 'image/png')),
  media_bytes bytea not null
    constraint alakazam_35_photo_byte_bounds_check
    check (octet_length(media_bytes) between 1 and 2000000),
  asset_digest ss.sha256_hex generated always as
    (encode(extensions.digest(media_bytes, 'sha256'), 'hex')) stored,
  byte_count integer generated always as
    (octet_length(media_bytes)) stored,
  width integer not null,
  height integer not null,
  asset_path text not null,
  state text not null default 'held'
    constraint alakazam_35_photo_state_check
    check (state = 'held'),
  hold_reason text not null
    default 'commercial_cutover_not_authorized'
    constraint alakazam_35_photo_hold_reason_check
    check (hold_reason = 'commercial_cutover_not_authorized'),
  uploaded_at timestamptz not null,
  constraint alakazam_35_photo_dimensions_check
    check (
      width between 320 and 4096
      and height between 160 and 2160
      and width::numeric / height::numeric between 1 and 4
    ),
  constraint alakazam_35_photo_signature_check
    check (
      (
        media_type = 'image/png'
        and substring(media_bytes from 1 for 8) =
          decode('89504e470d0a1a0a', 'hex')
      )
      or (
        media_type = 'image/jpeg'
        and substring(media_bytes from 1 for 3) =
          decode('ffd8ff', 'hex')
        and substring(media_bytes from octet_length(media_bytes) - 1 for 2) =
          decode('ffd9', 'hex')
      )
    ),
  constraint alakazam_35_photo_customer_user_fk
    foreign key (customer_user_id)
    references auth.users(id),
  constraint alakazam_35_photo_project_fk
    foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  constraint alakazam_35_photo_membership_fk
    foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(
      organization_id,
      user_id
    ),
  constraint alakazam_35_photo_subscription_fk
    foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id),
  constraint alakazam_35_photo_scope_uniq
    unique (organization_id, id),
  constraint alakazam_35_photo_digest_uniq
    unique (organization_id, project_id, asset_digest),
  constraint alakazam_35_photo_path_uniq
    unique (organization_id, project_id, asset_path)
);

create index alakazam_35_photo_project
  on ss.alakazam_35_photo_assets(
    organization_id,
    project_id,
    uploaded_at desc,
    id desc
  );

create table ss.alakazam_35_configurations (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  subscription_id uuid not null,
  subscription_revision bigint not null
    constraint alakazam_35_config_subscription_revision_check
    check (subscription_revision > 0),
  configuration_revision bigint not null
    constraint alakazam_35_config_revision_check
    check (configuration_revision > 0),
  font_choice_id text not null
    constraint alakazam_35_config_font_check
    check (font_choice_id in ('standard', 'alt')),
  section_visibility jsonb not null
    constraint alakazam_35_config_sections_check
    check (
      jsonb_typeof(section_visibility) = 'object'
      and section_visibility ?&
        array['about', 'offerings', 'practical', 'contact']
      and section_visibility
        - 'about'
        - 'offerings'
        - 'practical'
        - 'contact' = '{}'::jsonb
      and jsonb_typeof(section_visibility -> 'about') = 'boolean'
      and jsonb_typeof(section_visibility -> 'offerings') = 'boolean'
      and jsonb_typeof(section_visibility -> 'practical') = 'boolean'
      and jsonb_typeof(section_visibility -> 'contact') = 'boolean'
    ),
  photo_asset_id uuid,
  configuration_digest ss.sha256_hex not null,
  state text not null default 'held'
    constraint alakazam_35_config_state_check
    check (state = 'held'),
  hold_reason text not null
    default 'commercial_cutover_not_authorized'
    constraint alakazam_35_config_hold_reason_check
    check (hold_reason = 'commercial_cutover_not_authorized'),
  configured_at timestamptz not null,
  constraint alakazam_35_config_customer_user_fk
    foreign key (customer_user_id)
    references auth.users(id),
  constraint alakazam_35_config_project_fk
    foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  constraint alakazam_35_config_membership_fk
    foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(
      organization_id,
      user_id
    ),
  constraint alakazam_35_config_subscription_fk
    foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id),
  constraint alakazam_35_config_photo_fk
    foreign key (organization_id, photo_asset_id)
    references ss.alakazam_35_photo_assets(organization_id, id),
  constraint alakazam_35_config_scope_uniq
    unique (organization_id, id),
  constraint alakazam_35_config_project_revision_uniq
    unique (organization_id, project_id, configuration_revision),
  constraint alakazam_35_config_digest_uniq
    unique (configuration_digest)
);

create index alakazam_35_config_project
  on ss.alakazam_35_configurations(
    organization_id,
    project_id,
    configuration_revision desc
  );

create table ss.alakazam_35_care_requests (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  subscription_id uuid not null,
  subscription_revision bigint not null
    constraint alakazam_35_care_subscription_revision_check
    check (subscription_revision > 0),
  care_class text not null
    constraint alakazam_35_care_class_check
    check (care_class = 'modest'),
  request_message text not null
    constraint alakazam_35_care_message_check
    check (char_length(request_message) between 1 and 1000),
  request_digest ss.sha256_hex not null,
  state text not null default 'held'
    constraint alakazam_35_care_state_check
    check (state = 'held'),
  hold_reason text not null
    default 'commercial_cutover_not_authorized'
    constraint alakazam_35_care_hold_reason_check
    check (hold_reason = 'commercial_cutover_not_authorized'),
  requested_at timestamptz not null,
  constraint alakazam_35_care_customer_user_fk
    foreign key (customer_user_id)
    references auth.users(id),
  constraint alakazam_35_care_project_fk
    foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  constraint alakazam_35_care_membership_fk
    foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(
      organization_id,
      user_id
    ),
  constraint alakazam_35_care_subscription_fk
    foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id),
  constraint alakazam_35_care_scope_uniq
    unique (organization_id, id),
  constraint alakazam_35_care_digest_uniq
    unique (request_digest)
);

create index alakazam_35_care_project
  on ss.alakazam_35_care_requests(
    organization_id,
    project_id,
    requested_at desc,
    id desc
  );

create function ss.validate_alakazam_35_subscription_authority(
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
       and ss.alakazam_tier_rank(subscription.tier_id) >= 2
  )
$$;

create function ss.validate_alakazam_35_photo_asset()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  expected_path text;
begin
  if not ss.validate_alakazam_35_subscription_authority(
    new.organization_id,
    new.project_id,
    new.customer_user_id,
    new.subscription_id,
    new.subscription_revision
  ) then
    raise exception
      'Alakazam 35 photo lacks exact active subscription authority'
      using errcode = '23514';
  end if;

  expected_path :=
    'assets/alakazam-header-' || new.asset_digest ||
    case new.media_type
      when 'image/png' then '.png'
      when 'image/jpeg' then '.jpg'
    end;
  if new.asset_path <> expected_path then
    raise exception
      'Alakazam 35 photo path does not match exact immutable bytes'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_35_photo_assets_validate
after insert on ss.alakazam_35_photo_assets
deferrable initially deferred
for each row execute function ss.validate_alakazam_35_photo_asset();

create function ss.validate_alakazam_35_configuration()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  current_revision bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-alakazam-35-configuration:' || new.project_id::text,
      0
    )
  );
  if not ss.validate_alakazam_35_subscription_authority(
    new.organization_id,
    new.project_id,
    new.customer_user_id,
    new.subscription_id,
    new.subscription_revision
  ) then
    raise exception
      'Alakazam 35 configuration lacks exact active subscription authority'
      using errcode = '23514';
  end if;

  select coalesce(max(configuration.configuration_revision), 0)
    into current_revision
    from ss.alakazam_35_configurations configuration
   where configuration.organization_id = new.organization_id
     and configuration.project_id = new.project_id
     and configuration.id <> new.id;
  if new.configuration_revision <> current_revision + 1 then
    raise exception
      'Alakazam 35 configuration revision is stale'
      using errcode = '40001';
  end if;

  if new.photo_asset_id is not null and not exists (
    select 1
      from ss.alakazam_35_photo_assets photo
     where photo.organization_id = new.organization_id
       and photo.project_id = new.project_id
       and photo.customer_user_id = new.customer_user_id
       and photo.id = new.photo_asset_id
  ) then
    raise exception
      'Alakazam 35 configuration photo is outside the project authority'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_35_configurations_validate
after insert on ss.alakazam_35_configurations
deferrable initially deferred
for each row execute function ss.validate_alakazam_35_configuration();

create function ss.validate_alakazam_35_care_request()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not ss.validate_alakazam_35_subscription_authority(
    new.organization_id,
    new.project_id,
    new.customer_user_id,
    new.subscription_id,
    new.subscription_revision
  ) then
    raise exception
      'Alakazam 35 care request lacks exact active subscription authority'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_35_care_requests_validate
after insert on ss.alakazam_35_care_requests
deferrable initially deferred
for each row execute function ss.validate_alakazam_35_care_request();

create function ss.reject_alakazam_35_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  raise exception
    'Alakazam 35 fulfillment evidence is immutable'
    using errcode = '55000';
end
$$;

create trigger alakazam_35_photo_assets_immutable
before update or delete on ss.alakazam_35_photo_assets
for each row execute function ss.reject_alakazam_35_evidence_mutation();

create trigger alakazam_35_configurations_immutable
before update or delete on ss.alakazam_35_configurations
for each row execute function ss.reject_alakazam_35_evidence_mutation();

create trigger alakazam_35_care_requests_immutable
before update or delete on ss.alakazam_35_care_requests
for each row execute function ss.reject_alakazam_35_evidence_mutation();

do $$
declare
  table_name text;
  tables text[] := array[
    'alakazam_35_photo_assets',
    'alakazam_35_configurations',
    'alakazam_35_care_requests'
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
  ss.validate_alakazam_35_subscription_authority(uuid, uuid, uuid, uuid, bigint),
  ss.validate_alakazam_35_photo_asset(),
  ss.validate_alakazam_35_configuration(),
  ss.validate_alakazam_35_care_request(),
  ss.reject_alakazam_35_evidence_mutation()
from public, anon, authenticated, service_role;

grant execute on function
  ss.validate_alakazam_35_subscription_authority(uuid, uuid, uuid, uuid, bigint),
  ss.validate_alakazam_35_photo_asset(),
  ss.validate_alakazam_35_configuration(),
  ss.validate_alakazam_35_care_request(),
  ss.reject_alakazam_35_evidence_mutation()
to service_role;

create function ss.hosted_alakazam_35_contract()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-alakazam-35-held-v1'::text
$$;

revoke all on function ss.hosted_alakazam_35_contract()
from public, anon, authenticated;
grant execute on function ss.hosted_alakazam_35_contract()
to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'alakazam_35_photo_assets',
    'alakazam_35_configurations',
    'alakazam_35_care_requests'
  ] loop
    if has_table_privilege(
        'service_role',
        'ss.' || table_name,
        'UPDATE'
      )
      or has_table_privilege(
        'service_role',
        'ss.' || table_name,
        'DELETE'
      )
      or has_table_privilege(
        'service_role',
        'ss.' || table_name,
        'TRUNCATE'
      )
      or has_table_privilege(
        'authenticated',
        'ss.' || table_name,
        'SELECT'
      )
      or has_table_privilege(
        'anon',
        'ss.' || table_name,
        'SELECT'
      )
    then
      raise exception
        'Alakazam 35 privilege boundary is unsafe for %', table_name
        using errcode = '55000';
    end if;
  end loop;
end
$$;

commit;
