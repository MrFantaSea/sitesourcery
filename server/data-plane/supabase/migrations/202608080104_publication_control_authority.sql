begin;

do $$
begin
  if to_regclass('ss.alakazam_customer_publication_commands') is null
    or to_regclass('ss.alakazam_fulfillment_intents') is null
    or to_regclass('ss.alakazam_fulfillment_operations') is null
    or to_regclass('ss.alakazam_fulfillment_projection') is null
    or to_regclass('ss.project_addresses') is null
    or to_regclass('ss.release_screenings') is null
    or to_regclass('ss.version_state_events') is null
    or to_regprocedure('ss.hosted_alakazam_50_contract()') is null
  then
    raise exception
      'Site Sourcery migration 103 must be applied before generic publication-control authority'
      using errcode = '55000';
  end if;
end
$$;

create table ss.publication_control_commands (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  authority_kind text not null
    constraint publication_control_authority_kind_check
    check (authority_kind = 'alakazam'),
  action text not null
    constraint publication_control_action_check
    check (action in ('publish', 'rollback', 'unpublish')),
  entitlement_kind text not null
    constraint publication_control_entitlement_kind_check
    check (entitlement_kind = 'alakazam_subscription'),
  entitlement_id uuid not null,
  entitlement_revision bigint not null
    constraint publication_control_entitlement_revision_check
    check (entitlement_revision > 0),
  entitlement_tier_id text not null
    constraint publication_control_entitlement_tier_check
    check (
      entitlement_tier_id in (
        'alakazam_25',
        'alakazam_35',
        'alakazam_50'
      )
    ),
  entitlement_status text not null
    constraint publication_control_entitlement_status_check
    check (entitlement_status in ('active', 'grace')),
  entitlement_period_ends_at timestamptz not null,
  entitlement_grace_ends_at timestamptz,
  capability_schema text not null
    constraint publication_control_capability_schema_check
    check (
      capability_schema =
        'sitesourcery.alakazam-project-entitlement.v1'
    ),
  capability text not null
    constraint publication_control_capability_check
    check (capability = 'publish_accepted_project_version'),
  capability_authorized_at timestamptz not null,
  acceptance_event_id uuid not null,
  accepted_version_id uuid not null,
  accepted_artifact_id uuid not null,
  accepted_artifact_digest ss.sha256_hex not null,
  accepted_at timestamptz not null,
  screening_id uuid not null,
  screening_method text not null,
  screening_artifact_digest ss.sha256_hex not null,
  screening_checker_revision text not null,
  screening_checked_at timestamptz not null,
  licensed_address_id uuid not null,
  licensed_hostname ss.canonical_hostname not null,
  authority_operation_id uuid not null,
  authority_serving_revision bigint not null
    constraint publication_control_authority_revision_check
    check (authority_serving_revision >= 0),
  authority_decision_digest ss.sha256_hex not null,
  target_intent_id uuid not null,
  target_operation_id uuid not null,
  target_operation_kind text not null,
  target_operation_subscription_revision bigint not null
    constraint publication_control_target_subscription_revision_check
    check (target_operation_subscription_revision > 0),
  target_operation_tier_id text not null
    constraint publication_control_target_tier_check
    check (
      target_operation_tier_id in (
        'alakazam_25',
        'alakazam_35',
        'alakazam_50'
      )
    ),
  target_policy_digest ss.sha256_hex not null,
  target_serving_revision bigint not null
    constraint publication_control_target_serving_revision_check
    check (target_serving_revision >= 0),
  target_decision_digest ss.sha256_hex not null,
  projection_state text not null
    constraint publication_control_projection_state_check
    check (projection_state in ('live', 'dark', 'failed')),
  current_release_id uuid,
  current_version_id uuid,
  authorized_release_id uuid not null,
  target_release_id uuid,
  target_version_id uuid,
  snapshot_digest ss.sha256_hex not null,
  authority_digest ss.sha256_hex not null,
  command_digest ss.sha256_hex not null,
  state text not null default 'held'
    constraint publication_control_state_check
    check (state = 'held'),
  hold_reason text not null
    default 'privacy_v4_and_commercial_cutover_not_authorized'
    constraint publication_control_hold_reason_check
    check (
      hold_reason =
        'privacy_v4_and_commercial_cutover_not_authorized'
    ),
  requested_at timestamptz not null,
  constraint publication_control_customer_user_fk
    foreign key (customer_user_id)
    references auth.users(id),
  constraint publication_control_project_fk
    foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  constraint publication_control_membership_fk
    foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(
      organization_id,
      user_id
    ),
  constraint publication_control_entitlement_fk
    foreign key (organization_id, entitlement_id)
    references ss.alakazam_subscriptions(
      organization_id,
      id
    ),
  constraint publication_control_acceptance_event_fk
    foreign key (organization_id, acceptance_event_id)
    references ss.version_state_events(organization_id, id),
  constraint publication_control_accepted_version_fk
    foreign key (organization_id, accepted_version_id)
    references ss.site_versions(organization_id, id),
  constraint publication_control_accepted_artifact_fk
    foreign key (organization_id, accepted_artifact_id)
    references ss.artifacts(organization_id, id),
  constraint publication_control_screening_fk
    foreign key (organization_id, screening_id)
    references ss.release_screenings(organization_id, id),
  constraint publication_control_address_fk
    foreign key (organization_id, licensed_address_id)
    references ss.project_addresses(organization_id, id),
  constraint publication_control_authority_operation_fk
    foreign key (organization_id, authority_operation_id)
    references ss.alakazam_fulfillment_operations(
      organization_id,
      id
    ),
  constraint publication_control_target_intent_fk
    foreign key (organization_id, target_intent_id)
    references ss.alakazam_fulfillment_intents(
      organization_id,
      id
    ),
  constraint publication_control_target_operation_fk
    foreign key (organization_id, target_operation_id)
    references ss.alakazam_fulfillment_operations(
      organization_id,
      id
    ),
  constraint publication_control_current_release_fk
    foreign key (organization_id, current_release_id)
    references ss.releases(organization_id, id),
  constraint publication_control_current_version_fk
    foreign key (organization_id, current_version_id)
    references ss.site_versions(organization_id, id),
  constraint publication_control_authorized_release_fk
    foreign key (organization_id, authorized_release_id)
    references ss.releases(organization_id, id),
  constraint publication_control_target_release_fk
    foreign key (organization_id, target_release_id)
    references ss.releases(organization_id, id),
  constraint publication_control_target_version_fk
    foreign key (organization_id, target_version_id)
    references ss.site_versions(organization_id, id),
  constraint publication_control_command_scope_uniq
    unique (organization_id, id),
  constraint publication_control_command_digest_uniq
    unique (command_digest),
  constraint publication_control_entitlement_window_check
    check (
      entitlement_period_ends_at > requested_at
      and (
        entitlement_status = 'active'
        or entitlement_grace_ends_at > requested_at
      )
    ),
  constraint publication_control_capability_time_check
    check (capability_authorized_at = requested_at),
  constraint publication_control_current_release_check
    check (
      (current_release_id is null) = (current_version_id is null)
      and (
        projection_state <> 'live'
        or current_release_id is not null
      )
    ),
  constraint publication_control_action_target_check
    check (
      (
        action = 'publish'
        and projection_state in ('dark', 'failed')
        and current_release_id is null
        and target_release_id is null
        and target_version_id is not null
        and target_operation_id = authority_operation_id
      )
      or (
        action = 'rollback'
        and projection_state = 'live'
        and current_release_id is not null
        and target_release_id is not null
        and target_version_id is not null
        and authorized_release_id = target_release_id
        and target_release_id <> current_release_id
      )
      or (
        action = 'unpublish'
        and projection_state = 'live'
        and current_release_id is not null
        and target_release_id is null
        and target_version_id is null
        and authorized_release_id = current_release_id
        and target_operation_id = authority_operation_id
      )
    )
);

create index publication_control_commands_project
  on ss.publication_control_commands(
    organization_id,
    project_id,
    requested_at desc,
    id desc
  );

create function ss.validate_publication_control_command()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-publication-control:' || new.project_id::text,
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
       and operation.capability = new.capability
       and operation.effective_tier_id = subscription.tier_id
       and operation.state = 'published'
     where subscription.organization_id = new.organization_id
       and subscription.project_id = new.project_id
       and subscription.customer_user_id = new.customer_user_id
       and subscription.id = new.entitlement_id
       and subscription.revision = new.entitlement_revision
       and subscription.tier_id = new.entitlement_tier_id
       and subscription.status = new.entitlement_status
       and subscription.status in ('active', 'grace')
       and subscription.current_period_ends_at =
           new.entitlement_period_ends_at
       and subscription.grace_ends_at is not distinct from
           new.entitlement_grace_ends_at
       and subscription.current_period_ends_at > new.requested_at
       and (
         subscription.status <> 'grace'
         or subscription.grace_ends_at > new.requested_at
       )
       and projection.operation_id = new.authority_operation_id
       and projection.state = new.projection_state
       and projection.current_release_id is not distinct from
           new.current_release_id
       and operation.serving_revision =
           new.authority_serving_revision
       and operation.decision_digest =
           new.authority_decision_digest
  ) then
    raise exception
      'publication command lacks exact tier capability and entitlement revision authority'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
      from ss.alakazam_fulfillment_operations operation
      join ss.alakazam_fulfillment_intents intent
        on intent.organization_id = operation.organization_id
       and intent.project_id = operation.project_id
       and intent.id = operation.intent_id
      join ss.site_versions version
        on version.organization_id = intent.organization_id
       and version.project_id = intent.project_id
       and version.id = intent.version_id
      join ss.artifacts source_artifact
        on source_artifact.organization_id = version.organization_id
       and source_artifact.project_id = version.project_id
       and source_artifact.id = version.artifact_id
      join ss.version_state_projection version_state
        on version_state.organization_id = version.organization_id
       and version_state.project_id = version.project_id
       and version_state.version_id = version.id
       and version_state.state = 'accepted_release'
      join ss.version_state_events acceptance
        on acceptance.organization_id = version_state.organization_id
       and acceptance.project_id = version_state.project_id
       and acceptance.version_id = version_state.version_id
       and acceptance.id = version_state.last_event_id
       and acceptance.state = 'accepted_release'
      join ss.release_screenings screening
        on screening.organization_id = operation.organization_id
       and screening.project_id = operation.project_id
       and screening.id = operation.screening_id
       and screening.version_id = version.id
       and screening.stage = 'pre_publication'
       and screening.passed
       and screening.artifact_digest =
           operation.effective_artifact_digest
      join ss.project_addresses address
        on address.organization_id = intent.organization_id
       and address.project_id = intent.project_id
       and address.id = intent.address_id
       and address.kind = 'licensed'
       and address.ownership = 'licensed'
       and address.state = 'configured'
      join ss.project_address_projection address_projection
        on address_projection.organization_id = address.organization_id
       and address_projection.project_id = address.project_id
       and address_projection.current_address_id = address.id
      join ss.releases release
        on release.organization_id = operation.organization_id
       and release.project_id = operation.project_id
       and release.id = operation.result_release_id
       and release.version_id = version.id
       and release.artifact_id = operation.effective_artifact_id
       and release.artifact_digest =
           operation.effective_artifact_digest
       and release.hostname = address.serving_hostname
     where operation.organization_id = new.organization_id
       and operation.project_id = new.project_id
       and operation.customer_user_id = new.customer_user_id
       and operation.id = new.target_operation_id
       and operation.intent_id = new.target_intent_id
       and operation.subscription_id = new.entitlement_id
       and operation.subscription_revision =
           new.target_operation_subscription_revision
       and operation.operation_kind = new.target_operation_kind
       and operation.capability = new.capability
       and operation.effective_tier_id =
           new.target_operation_tier_id
       and operation.policy_digest = new.target_policy_digest
       and operation.state = 'published'
       and operation.serving_revision = new.target_serving_revision
       and operation.decision_digest = new.target_decision_digest
       and operation.result_release_id = new.authorized_release_id
       and (
         (new.action = 'unpublish' and new.target_version_id is null)
         or new.target_version_id = version.id
       )
       and intent.version_id = new.accepted_version_id
       and intent.artifact_digest = new.accepted_artifact_digest
       and intent.address_id = new.licensed_address_id
       and intent.hostname = new.licensed_hostname
       and version.artifact_id = new.accepted_artifact_id
       and source_artifact.artifact_digest =
           new.accepted_artifact_digest
       and acceptance.id = new.acceptance_event_id
       and acceptance.occurred_at = new.accepted_at
       and screening.id = new.screening_id
       and screening.method = new.screening_method
       and screening.artifact_digest =
           new.screening_artifact_digest
       and screening.checker_revision =
           new.screening_checker_revision
       and screening.checked_at = new.screening_checked_at
       and address.id = new.licensed_address_id
       and address.serving_hostname = new.licensed_hostname
  ) then
    raise exception
      'publication command lacks exact acceptance, screening, address, or fulfillment revision evidence'
      using errcode = '23514';
  end if;

  if new.current_release_id is not null and not exists (
    select 1
      from ss.releases release
     where release.organization_id = new.organization_id
       and release.project_id = new.project_id
       and release.id = new.current_release_id
       and release.version_id = new.current_version_id
  ) then
    raise exception
      'publication command current release evidence is inconsistent'
      using errcode = '23514';
  end if;

  return new;
end
$$;

create constraint trigger publication_control_commands_validate
after insert on ss.publication_control_commands
deferrable initially deferred
for each row execute function
  ss.validate_publication_control_command();

create function ss.reject_publication_control_command_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  raise exception
    'publication control commands are immutable held evidence'
    using errcode = '55000';
end
$$;

create trigger publication_control_commands_immutable
before update or delete on ss.publication_control_commands
for each row execute function
  ss.reject_publication_control_command_mutation();

alter table ss.publication_control_commands
  enable row level security;
alter table ss.publication_control_commands
  force row level security;

revoke all on table ss.publication_control_commands
from public, anon, authenticated, service_role;
grant select, insert on table ss.publication_control_commands
to service_role;

revoke all on function
  ss.validate_publication_control_command(),
  ss.reject_publication_control_command_mutation()
from public, anon, authenticated;
grant execute on function
  ss.validate_publication_control_command(),
  ss.reject_publication_control_command_mutation()
to service_role;

create function ss.hosted_publication_control_contract()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-publication-control-held-v1'::text
$$;

revoke all on function ss.hosted_publication_control_contract()
from public, anon, authenticated;
grant execute on function ss.hosted_publication_control_contract()
to service_role;

commit;
