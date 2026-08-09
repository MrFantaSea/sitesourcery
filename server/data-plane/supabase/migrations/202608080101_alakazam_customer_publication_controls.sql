begin;

do $$
begin
  if to_regclass('ss.alakazam_subscriptions') is null
    or to_regclass('ss.alakazam_fulfillment_operations') is null
    or to_regclass('ss.alakazam_fulfillment_projection') is null
    or to_regclass('ss.releases') is null
    or to_regprocedure('ss.hosted_runtime_contract_v33()') is null
    or to_regprocedure('ss.hosted_runtime_contract_v47()') is null
  then
    raise exception
      'Site Sourcery migrations through 047 must be applied before Alakazam customer publication controls'
      using errcode = '55000';
  end if;
end
$$;

create table ss.alakazam_customer_publication_commands (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  subscription_id uuid not null,
  subscription_revision bigint not null
    constraint alakazam_publication_revision_check
    check (subscription_revision > 0),
  authority_operation_id uuid not null,
  action text not null
    constraint alakazam_publication_action_check
    check (action in ('publish', 'rollback', 'unpublish')),
  projection_state text not null
    constraint alakazam_publication_projection_check
    check (projection_state in ('live', 'dark', 'failed')),
  hostname ss.canonical_hostname not null,
  current_release_id uuid,
  target_release_id uuid,
  target_version_id uuid,
  target_artifact_digest ss.sha256_hex,
  snapshot_digest ss.sha256_hex not null,
  command_digest ss.sha256_hex not null,
  state text not null default 'held'
    constraint alakazam_publication_state_check
    check (state = 'held'),
  hold_reason text not null
    default 'commercial_cutover_not_authorized'
    constraint alakazam_publication_hold_reason_check
    check (
      hold_reason = 'commercial_cutover_not_authorized'
    ),
  requested_at timestamptz not null,
  constraint alakazam_publication_customer_user_fk
    foreign key (customer_user_id)
    references auth.users(id),
  constraint alakazam_publication_project_fk
    foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  constraint alakazam_publication_membership_fk
    foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(
      organization_id,
      user_id
    ),
  constraint alakazam_publication_subscription_fk
    foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(
      organization_id,
      id
    ),
  constraint alakazam_publication_operation_fk
    foreign key (organization_id, authority_operation_id)
    references ss.alakazam_fulfillment_operations(
      organization_id,
      id
    ),
  constraint alakazam_publication_current_release_fk
    foreign key (organization_id, current_release_id)
    references ss.releases(organization_id, id),
  constraint alakazam_publication_target_release_fk
    foreign key (organization_id, target_release_id)
    references ss.releases(organization_id, id),
  constraint alakazam_publication_target_version_fk
    foreign key (organization_id, target_version_id)
    references ss.site_versions(organization_id, id),
  constraint alakazam_publication_command_scope_uniq
    unique (organization_id, id),
  constraint alakazam_publication_command_digest_uniq
    unique (command_digest),
  constraint alakazam_publication_current_release_check
    check (
    (projection_state = 'live' and current_release_id is not null)
    or projection_state in ('dark', 'failed')
  ),
  constraint alakazam_publication_action_target_check
    check (
    (
      action = 'publish'
      and target_release_id is null
      and target_version_id is not null
      and target_artifact_digest is not null
    )
    or (
      action = 'rollback'
      and projection_state = 'live'
      and current_release_id is not null
      and target_release_id is not null
      and target_release_id <> current_release_id
      and target_version_id is not null
      and target_artifact_digest is not null
    )
    or (
      action = 'unpublish'
      and projection_state = 'live'
      and current_release_id is not null
      and target_release_id is null
      and target_version_id is null
      and target_artifact_digest is null
    )
  )
);

create index alakazam_customer_publication_commands_project
  on ss.alakazam_customer_publication_commands(
    organization_id,
    project_id,
    requested_at desc,
    id desc
  );

create function ss.validate_alakazam_customer_publication_command()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  accepted_version_id uuid;
  accepted_artifact_digest ss.sha256_hex;
  current_version_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-alakazam-customer-publication:' || new.project_id::text,
      0
    )
  );

  if not exists (
    select 1
      from ss.alakazam_subscriptions subscription
      join ss.organization_memberships membership
        on membership.organization_id = subscription.organization_id
       and membership.user_id = subscription.customer_user_id
       and membership.state = 'active'
       and membership.role in ('owner', 'admin', 'editor')
      join ss.alakazam_fulfillment_projection projection
        on projection.organization_id = subscription.organization_id
       and projection.project_id = subscription.project_id
      join ss.alakazam_fulfillment_operations operation
        on operation.organization_id = projection.organization_id
       and operation.project_id = projection.project_id
       and operation.id = projection.operation_id
       and operation.subscription_id = subscription.id
       and operation.subscription_revision = subscription.revision
       and operation.customer_user_id = subscription.customer_user_id
     where subscription.organization_id = new.organization_id
       and subscription.project_id = new.project_id
       and subscription.customer_user_id = new.customer_user_id
       and subscription.id = new.subscription_id
       and subscription.revision = new.subscription_revision
       and subscription.status in ('active', 'grace')
       and projection.operation_id = new.authority_operation_id
       and projection.state = new.projection_state
       and projection.hostname = new.hostname
       and projection.current_release_id is not distinct from
           new.current_release_id
  ) then
    raise exception
      'Alakazam customer publication command lacks exact active revision authority'
      using errcode = '23514';
  end if;

  select
    version.id,
    artifact.artifact_digest
  into
    accepted_version_id,
    accepted_artifact_digest
  from ss.site_versions version
  join ss.version_state_projection version_state
    on version_state.organization_id = version.organization_id
   and version_state.project_id = version.project_id
   and version_state.version_id = version.id
   and version_state.state = 'accepted_release'
  join ss.artifacts artifact
    on artifact.organization_id = version.organization_id
   and artifact.project_id = version.project_id
   and artifact.id = version.artifact_id
  where version.organization_id = new.organization_id
    and version.project_id = new.project_id
  order by version.created_at desc, version.id desc
  limit 1;

  if new.current_release_id is not null then
    select release.version_id
    into current_version_id
    from ss.releases release
    where release.organization_id = new.organization_id
      and release.project_id = new.project_id
      and release.id = new.current_release_id;
    if not found then
      raise exception
        'Alakazam customer publication current release is unavailable'
        using errcode = '23514';
    end if;
  end if;

  if new.action = 'publish' then
    if accepted_version_id is null
      or new.target_version_id <> accepted_version_id
      or new.target_artifact_digest <> accepted_artifact_digest
      or not (
        new.projection_state in ('dark', 'failed')
        or current_version_id is distinct from accepted_version_id
      )
    then
      raise exception
        'Alakazam publish command lacks exact accepted-version authority'
        using errcode = '23514';
    end if;
  elsif new.action = 'rollback' then
    if not exists (
      select 1
      from ss.alakazam_fulfillment_operations operation
      join ss.releases release
        on release.organization_id = operation.organization_id
       and release.project_id = operation.project_id
       and release.id = operation.result_release_id
      where operation.organization_id = new.organization_id
        and operation.project_id = new.project_id
        and operation.customer_user_id = new.customer_user_id
        and operation.state = 'published'
        and release.id = new.target_release_id
        and release.version_id = new.target_version_id
        and release.artifact_digest = new.target_artifact_digest
    ) then
      raise exception
        'Alakazam rollback command lacks eligible release history'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$$;

create constraint trigger alakazam_customer_publication_commands_validate
after insert on ss.alakazam_customer_publication_commands
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_customer_publication_command();

create function ss.reject_alakazam_customer_publication_command_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  raise exception
    'Alakazam customer publication commands are immutable held evidence'
    using errcode = '55000';
end
$$;

create trigger alakazam_customer_publication_commands_immutable
before update or delete on ss.alakazam_customer_publication_commands
for each row execute function
  ss.reject_alakazam_customer_publication_command_mutation();

alter table ss.alakazam_customer_publication_commands
  enable row level security;
alter table ss.alakazam_customer_publication_commands
  force row level security;
revoke all on table ss.alakazam_customer_publication_commands
from public, anon, authenticated, service_role;
grant select, insert on table
  ss.alakazam_customer_publication_commands
to service_role;

revoke all on function
  ss.validate_alakazam_customer_publication_command(),
  ss.reject_alakazam_customer_publication_command_mutation()
from public, anon, authenticated, service_role;
grant execute on function
  ss.validate_alakazam_customer_publication_command(),
  ss.reject_alakazam_customer_publication_command_mutation()
to service_role;

create function ss.hosted_alakazam_publication_contract()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-alakazam-customer-publication-held-v1'
    ::text
$$;

revoke all on function ss.hosted_alakazam_publication_contract()
from public, anon, authenticated;
grant execute on function ss.hosted_alakazam_publication_contract()
to service_role;

do $$
begin
  if has_table_privilege(
      'service_role',
      'ss.alakazam_customer_publication_commands',
      'UPDATE'
    )
    or has_table_privilege(
      'service_role',
      'ss.alakazam_customer_publication_commands',
      'DELETE'
    )
    or has_table_privilege(
      'service_role',
      'ss.alakazam_customer_publication_commands',
      'TRUNCATE'
    )
    or has_table_privilege(
      'authenticated',
      'ss.alakazam_customer_publication_commands',
      'SELECT'
    )
    or has_table_privilege(
      'anon',
      'ss.alakazam_customer_publication_commands',
      'SELECT'
    )
  then
    raise exception
      'Alakazam customer publication privilege boundary is unsafe'
      using errcode = '55000';
  end if;
end
$$;

commit;
