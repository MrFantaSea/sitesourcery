-- FIN-004V adjacent-system identity, snapshot, and reconciliation evidence.
-- This migration records operator-reviewed local evidence only. It grants no
-- remote command, provider, marketing-send, message, CRM, commercial, phone,
-- deployment, database, DNS, publication, or public effect authority.

begin;

do $$
begin
  if to_regprocedure('ss.operator_resolution_surfaces_contract_v1()') is null
    or ss.operator_resolution_surfaces_contract_v1() <>
      'canonical-fin-004u-operator-resolution-v1-digest-only-held'
    or to_regprocedure('ss.service_json_digest(jsonb)') is null
    or to_regprocedure(
      'ss.service_operator_has_capability(uuid,text,timestamp with time zone)'
    ) is null
    or to_regclass('ss.customer_engagements') is null
    or to_regclass('ss.service_custom_build_direct_opportunities') is null
  then
    raise exception 'FIN-004V requires the exact FIN-004U and identity contracts'
      using errcode = '55000';
  end if;
end
$$;

create function ss.adjacent_integration_reference_digest_v1(
  selected_reference text
)
returns ss.sha256_hex
language sql
immutable
strict
parallel safe
security definer
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'contract', 'adjacent-reference-v1',
    'remoteReference', selected_reference
  ))
$$;

create function ss.adjacent_integration_source_revision_digest_v1(
  selected_revision text
)
returns ss.sha256_hex
language sql
immutable
strict
parallel safe
security definer
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'contract', 'adjacent-source-revision-v1',
    'sourceRevision', selected_revision
  ))
$$;

create function ss.adjacent_integration_provenance_digest_v1(
  selected_system_key text,
  selected_source_revision text,
  selected_source_evidence_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
strict
parallel safe
security definer
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'contract', 'adjacent-provenance-v1',
    'systemKey', selected_system_key,
    'sourceRevision', selected_source_revision,
    'sourceRevisionDigest',
      ss.adjacent_integration_source_revision_digest_v1(
        selected_source_revision
      ),
    'sourceEvidenceDigest', selected_source_evidence_digest
  ))
$$;

create function ss.adjacent_integration_request_digest_v1(
  selected_command_kind text,
  selected_semantic_evidence_digest ss.sha256_hex,
  selected_operator_organization_id uuid,
  selected_operator_user_id uuid
)
returns ss.sha256_hex
language sql
immutable
strict
parallel safe
security definer
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'contract', 'adjacent-command-v1',
    'commandKind', selected_command_kind,
    'semanticEvidenceDigest', selected_semantic_evidence_digest,
    'operatorOrganizationId', selected_operator_organization_id,
    'operatorUserId', selected_operator_user_id
  ))
$$;

create table ss.adjacent_integration_system_contracts (
  system_key text primary key check (system_key in (
    'private_messenger', 'command_deck', 'phone_bridge',
    'client_profile_hub', 'marketing_desk', 'dell_commercial_engine'
  )),
  authority_owner text not null,
  read_event_direction text not null check (read_event_direction in (
    'adjacent_to_hosted_manual_evidence',
    'bidirectional_manual_identity_evidence'
  )),
  write_effect_direction text not null check (
    write_effect_direction = 'none_held'
  ),
  authentication_boundary text not null,
  identity_scope_policy text not null check (identity_scope_policy in (
    'tenant_crosswalk_and_global_snapshot',
    'global_snapshot_only',
    'tenant_crosswalk_only'
  )),
  semantic_idempotency_policy text not null check (
    semantic_idempotency_policy =
      'same_semantic_evidence_replays_prior_receipt_new_digest_conflicts'
  ),
  conflict_owner text not null,
  retry_policy text not null check (
    retry_policy = 'no_automatic_retry_operator_refresh_required'
  ),
  reconciliation_policy text not null check (
    reconciliation_policy =
      'append_only_operator_resolution_or_supersession'
  ),
  audit_policy text not null check (
    audit_policy = 'append_only_operator_source_and_provenance_digests'
  ),
  failure_behavior text not null check (
    failure_behavior = 'fail_closed_to_manual_review'
  ),
  held_behavior text not null check (
    held_behavior =
      'automatic_commands_remote_writes_and_provider_effects_false'
  ),
  adapter_mode text not null check (adapter_mode = 'manual_read_only'),
  automatic_commands boolean not null check (automatic_commands = false),
  remote_write_effects boolean not null check (remote_write_effects = false),
  provider_effects boolean not null check (provider_effects = false),
  contract_revision bigint not null check (contract_revision = 1)
);

insert into ss.adjacent_integration_system_contracts (
  system_key, authority_owner, read_event_direction,
  write_effect_direction, authentication_boundary, identity_scope_policy,
  semantic_idempotency_policy, conflict_owner, retry_policy,
  reconciliation_policy, audit_policy, failure_behavior, held_behavior,
  adapter_mode, automatic_commands, remote_write_effects, provider_effects,
  contract_revision
) values
  (
    'private_messenger', 'private_messenger_client_owned_plaintext',
    'adjacent_to_hosted_manual_evidence', 'none_held',
    'client_owned_e2e_passphrase_server_content_blind',
    'tenant_crosswalk_and_global_snapshot',
    'same_semantic_evidence_replays_prior_receipt_new_digest_conflicts',
    'private_messenger', 'no_automatic_retry_operator_refresh_required',
    'append_only_operator_resolution_or_supersession',
    'append_only_operator_source_and_provenance_digests',
    'fail_closed_to_manual_review',
    'automatic_commands_remote_writes_and_provider_effects_false',
    'manual_read_only', false, false, false, 1
  ),
  (
    'command_deck', 'command_deck_status',
    'adjacent_to_hosted_manual_evidence', 'none_held',
    'separate_operator_auth_optional_exact_tailscale_login',
    'global_snapshot_only',
    'same_semantic_evidence_replays_prior_receipt_new_digest_conflicts',
    'command_deck', 'no_automatic_retry_operator_refresh_required',
    'append_only_operator_resolution_or_supersession',
    'append_only_operator_source_and_provenance_digests',
    'fail_closed_to_manual_review',
    'automatic_commands_remote_writes_and_provider_effects_false',
    'manual_read_only', false, false, false, 1
  ),
  (
    'phone_bridge', 'phone_bridge_proxy_route',
    'adjacent_to_hosted_manual_evidence', 'none_held',
    'loopback_fixed_identity_proxy_to_command_deck',
    'global_snapshot_only',
    'same_semantic_evidence_replays_prior_receipt_new_digest_conflicts',
    'phone_bridge', 'no_automatic_retry_operator_refresh_required',
    'append_only_operator_resolution_or_supersession',
    'append_only_operator_source_and_provenance_digests',
    'fail_closed_to_manual_review',
    'automatic_commands_remote_writes_and_provider_effects_false',
    'manual_read_only', false, false, false, 1
  ),
  (
    'client_profile_hub',
    'hub_crm_hosted_acceptance_payment_fulfillment',
    'bidirectional_manual_identity_evidence', 'none_held',
    'loopback_get_only_adapter_no_csrf_mutation',
    'tenant_crosswalk_and_global_snapshot',
    'same_semantic_evidence_replays_prior_receipt_new_digest_conflicts',
    'hub_for_crm_hosted_for_fulfillment',
    'no_automatic_retry_operator_refresh_required',
    'append_only_operator_resolution_or_supersession',
    'append_only_operator_source_and_provenance_digests',
    'fail_closed_to_manual_review',
    'automatic_commands_remote_writes_and_provider_effects_false',
    'manual_read_only', false, false, false, 1
  ),
  (
    'marketing_desk', 'marketing_prospects_dnc_and_promotion_source',
    'adjacent_to_hosted_manual_evidence', 'none_held',
    'filesystem_cli_draft_only_no_send',
    'tenant_crosswalk_and_global_snapshot',
    'same_semantic_evidence_replays_prior_receipt_new_digest_conflicts',
    'marketing_desk', 'no_automatic_retry_operator_refresh_required',
    'append_only_operator_resolution_or_supersession',
    'append_only_operator_source_and_provenance_digests',
    'fail_closed_to_manual_review',
    'automatic_commands_remote_writes_and_provider_effects_false',
    'manual_read_only', false, false, false, 1
  ),
  (
    'dell_commercial_engine', 'dell_catalog_scope_and_quote_semantics',
    'adjacent_to_hosted_manual_evidence', 'none_held',
    'separate_source_digest_no_write_target',
    'tenant_crosswalk_and_global_snapshot',
    'same_semantic_evidence_replays_prior_receipt_new_digest_conflicts',
    'dell_commercial_engine',
    'no_automatic_retry_operator_refresh_required',
    'append_only_operator_resolution_or_supersession',
    'append_only_operator_source_and_provenance_digests',
    'fail_closed_to_manual_review',
    'automatic_commands_remote_writes_and_provider_effects_false',
    'manual_read_only', false, false, false, 1
  );

create table ss.adjacent_integration_identity_pairs (
  system_key text not null references
    ss.adjacent_integration_system_contracts(system_key),
  scope_kind text not null check (
    scope_kind in ('tenant_crosswalk', 'global_snapshot')
  ),
  local_entity_kind text not null check (local_entity_kind in (
    'platform', 'organization', 'project', 'engagement',
    'direct_opportunity'
  )),
  remote_entity_kind text not null,
  reference_policy text not null check (reference_policy in (
    'digest_only', 'hub_client_id', 'hub_project_id'
  )),
  primary key (
    system_key, scope_kind, local_entity_kind, remote_entity_kind,
    reference_policy
  ),
  check (
    (scope_kind = 'global_snapshot' and local_entity_kind = 'platform')
    or (scope_kind = 'tenant_crosswalk'
      and local_entity_kind <> 'platform')
  )
);

insert into ss.adjacent_integration_identity_pairs (
  system_key, scope_kind, local_entity_kind, remote_entity_kind,
  reference_policy
) values
  ('private_messenger', 'tenant_crosswalk', 'organization',
    'encrypted_session_digest', 'digest_only'),
  ('private_messenger', 'global_snapshot', 'platform',
    'relay_service', 'digest_only'),
  ('command_deck', 'global_snapshot', 'platform',
    'service', 'digest_only'),
  ('phone_bridge', 'global_snapshot', 'platform',
    'identity_route', 'digest_only'),
  ('client_profile_hub', 'tenant_crosswalk', 'organization',
    'client', 'hub_client_id'),
  ('client_profile_hub', 'tenant_crosswalk', 'project',
    'project', 'hub_project_id'),
  ('client_profile_hub', 'global_snapshot', 'platform',
    'service', 'digest_only'),
  ('marketing_desk', 'tenant_crosswalk', 'engagement',
    'qualified_promotion', 'digest_only'),
  ('marketing_desk', 'tenant_crosswalk', 'direct_opportunity',
    'qualified_promotion', 'digest_only'),
  ('marketing_desk', 'global_snapshot', 'platform',
    'prospect', 'digest_only'),
  ('marketing_desk', 'global_snapshot', 'platform',
    'campaign', 'digest_only'),
  ('marketing_desk', 'global_snapshot', 'platform',
    'suppression', 'digest_only'),
  ('dell_commercial_engine', 'global_snapshot', 'platform',
    'catalog', 'digest_only'),
  ('dell_commercial_engine', 'tenant_crosswalk', 'project',
    'scope', 'digest_only'),
  ('dell_commercial_engine', 'tenant_crosswalk', 'project',
    'quote', 'digest_only'),
  ('dell_commercial_engine', 'tenant_crosswalk', 'project',
    'work_receipt', 'digest_only');

create table ss.adjacent_integration_observation_contracts (
  system_key text not null references
    ss.adjacent_integration_system_contracts(system_key),
  scope_kind text not null check (
    scope_kind in ('tenant_crosswalk', 'global_snapshot')
  ),
  observation_kind text not null,
  primary key (system_key, scope_kind, observation_kind)
);

insert into ss.adjacent_integration_observation_contracts (
  system_key, scope_kind, observation_kind
) values
  ('private_messenger', 'global_snapshot', 'availability'),
  ('private_messenger', 'tenant_crosswalk',
    'encrypted_session_summary'),
  ('command_deck', 'global_snapshot', 'availability'),
  ('command_deck', 'global_snapshot', 'status_snapshot'),
  ('command_deck', 'global_snapshot', 'backup_verification'),
  ('phone_bridge', 'global_snapshot', 'availability'),
  ('phone_bridge', 'global_snapshot', 'identity_route'),
  ('phone_bridge', 'global_snapshot', 'proxy_transport_status'),
  ('client_profile_hub', 'tenant_crosswalk', 'identity_readback'),
  ('client_profile_hub', 'tenant_crosswalk', 'crm_revision'),
  ('client_profile_hub', 'tenant_crosswalk', 'activity_receipt'),
  ('client_profile_hub', 'global_snapshot', 'availability'),
  ('client_profile_hub', 'global_snapshot', 'registry_revision'),
  ('marketing_desk', 'global_snapshot', 'prospect_revision'),
  ('marketing_desk', 'global_snapshot', 'campaign_status'),
  ('marketing_desk', 'global_snapshot', 'suppression'),
  ('marketing_desk', 'tenant_crosswalk', 'promotion_receipt'),
  ('dell_commercial_engine', 'global_snapshot', 'catalog_readback'),
  ('dell_commercial_engine', 'tenant_crosswalk', 'scope_readback'),
  ('dell_commercial_engine', 'tenant_crosswalk', 'quote_readback'),
  ('dell_commercial_engine', 'tenant_crosswalk', 'work_receipt');

create function ss.adjacent_integration_crosswalk_link_digest_v1(
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_system_key text,
  selected_source_snapshot_id uuid,
  selected_local_entity_kind text,
  selected_local_entity_id uuid,
  selected_remote_entity_kind text,
  selected_remote_reference text,
  selected_source_revision text,
  selected_source_evidence_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
security definer
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'contract', 'adjacent-crosswalk-link-v1',
    'organizationId', selected_organization_id,
    'projectId', selected_project_id,
    'systemKey', selected_system_key,
    'sourceSnapshotId', selected_source_snapshot_id,
    'localEntityKind', selected_local_entity_kind,
    'localEntityId', selected_local_entity_id,
    'remoteEntityKind', selected_remote_entity_kind,
    'remoteReferenceDigest',
      ss.adjacent_integration_reference_digest_v1(
        selected_remote_reference
      ),
    'sourceRevision', selected_source_revision,
    'sourceEvidenceDigest', selected_source_evidence_digest
  ))
$$;

create function ss.adjacent_integration_crosswalk_semantic_digest_v1(
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_system_key text,
  selected_source_snapshot_id uuid,
  selected_local_entity_kind text,
  selected_local_entity_id uuid,
  selected_remote_entity_kind text,
  selected_remote_reference text,
  selected_source_revision text,
  selected_source_evidence_digest ss.sha256_hex,
  selected_supersedes_crosswalk_id uuid,
  selected_initial_state text
)
returns ss.sha256_hex
language sql
immutable
parallel safe
security definer
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'contract', 'adjacent-crosswalk-semantic-v1',
    'linkEvidenceDigest', ss.adjacent_integration_crosswalk_link_digest_v1(
      selected_organization_id, selected_project_id, selected_system_key,
      selected_source_snapshot_id, selected_local_entity_kind,
      selected_local_entity_id, selected_remote_entity_kind,
      selected_remote_reference, selected_source_revision,
      selected_source_evidence_digest
    ),
    'supersedesCrosswalkId', selected_supersedes_crosswalk_id,
    'initialState', selected_initial_state
  ))
$$;

create table ss.adjacent_integration_crosswalks (
  id uuid primary key,
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  organization_id uuid not null references ss.organizations(id),
  project_id uuid references ss.projects(id),
  system_key text not null references
    ss.adjacent_integration_system_contracts(system_key),
  source_snapshot_id uuid not null,
  scope_kind text not null default 'tenant_crosswalk' check (
    scope_kind = 'tenant_crosswalk'
  ),
  local_entity_kind text not null,
  local_entity_id uuid not null,
  remote_entity_kind text not null,
  reference_policy text not null,
  remote_reference text not null check (
    char_length(remote_reference) between 8 and 96
    and remote_reference !~ '[[:space:]@]'
    and ss.service_text_excludes_credentials(remote_reference)
  ),
  remote_reference_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_reference_digest_v1(remote_reference)
  ) stored,
  source_revision text not null check (
    source_revision ~
      '^(git:[0-9a-f]{40}|sha256:[0-9a-f]{64})$'
  ),
  source_revision_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_source_revision_digest_v1(source_revision)
  ) stored,
  source_evidence_digest ss.sha256_hex not null,
  provenance_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_provenance_digest_v1(
      system_key, source_revision, source_evidence_digest
    )
  ) stored,
  supersedes_crosswalk_id uuid unique,
  initial_state text not null check (initial_state in (
    'manual_review', 'conflict'
  )),
  state text not null check (state in (
    'linked', 'manual_review', 'conflict', 'superseded'
  )),
  semantic_evidence_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_crosswalk_semantic_digest_v1(
      organization_id, project_id, system_key, source_snapshot_id,
      local_entity_kind,
      local_entity_id, remote_entity_kind, remote_reference,
      source_revision, source_evidence_digest,
      supersedes_crosswalk_id, initial_state
    )
  ) stored,
  link_evidence_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_crosswalk_link_digest_v1(
      organization_id, project_id, system_key, source_snapshot_id,
      local_entity_kind, local_entity_id, remote_entity_kind,
      remote_reference, source_revision, source_evidence_digest
    )
  ) stored,
  operator_user_id uuid not null references auth.users(id),
  recorded_at timestamptz not null,
  updated_at timestamptz not null,
  request_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_request_digest_v1(
      'crosswalk',
      ss.adjacent_integration_crosswalk_semantic_digest_v1(
        organization_id, project_id, system_key, source_snapshot_id,
        local_entity_kind,
        local_entity_id, remote_entity_kind, remote_reference,
        source_revision, source_evidence_digest,
        supersedes_crosswalk_id, initial_state
      ),
      organization_id, operator_user_id
    )
  ) stored,
  automatic_commands boolean not null default false check (
    automatic_commands = false
  ),
  remote_write_effects boolean not null default false check (
    remote_write_effects = false
  ),
  provider_effects boolean not null default false check (
    provider_effects = false
  ),
  revision bigint not null default 1 check (revision > 0),
  foreign key (
    system_key, scope_kind, local_entity_kind, remote_entity_kind,
    reference_policy
  ) references ss.adjacent_integration_identity_pairs(
    system_key, scope_kind, local_entity_kind, remote_entity_kind,
    reference_policy
  ),
  unique (id, organization_id, system_key),
  unique (semantic_evidence_digest),
  unique (link_evidence_digest)
);

alter table ss.adjacent_integration_crosswalks
  add foreign key (supersedes_crosswalk_id, organization_id, system_key)
  references ss.adjacent_integration_crosswalks(
    id, organization_id, system_key
  );

create unique index adjacent_integration_crosswalks_remote_linked_unique
on ss.adjacent_integration_crosswalks (
  organization_id, system_key, remote_entity_kind, remote_reference_digest,
  local_entity_kind
) where state = 'linked';

create unique index adjacent_integration_crosswalks_local_linked_unique
on ss.adjacent_integration_crosswalks (
  organization_id, system_key, local_entity_kind, local_entity_id,
  remote_entity_kind
) where state = 'linked';

create function ss.guard_adjacent_integration_crosswalk_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_engagement record;
  selected_opportunity record;
  selected_superseded ss.adjacent_integration_crosswalks%rowtype;
begin
  if ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is not null
    or ss.current_service_actor_user_id() is distinct from new.operator_user_id
    or not ss.service_operator_has_capability(
      new.operator_user_id, 'service_management_manage', clock_timestamp()
    )
    or not exists (
      select 1
        from ss.organizations organization
        join ss.organization_memberships membership
          on membership.organization_id = organization.id
         and membership.user_id = new.operator_user_id
       where organization.id = new.organization_id
         and organization.state = 'active'
         and membership.state = 'active'
    )
    or new.recorded_at < clock_timestamp() - interval '5 minutes'
    or new.recorded_at > clock_timestamp() + interval '5 minutes'
    or new.updated_at <> new.recorded_at
    or new.revision <> 1
    or new.state not in ('manual_review', 'conflict')
    or new.state <> new.initial_state
  then
    raise exception 'adjacent crosswalk requires the exact current operator'
      using errcode = '42501';
  end if;

  if new.reference_policy = 'digest_only'
    and new.remote_reference !~ '^sha256:[0-9a-f]{64}$'
  then
    raise exception 'adjacent reference must be digest-only'
      using errcode = '23514';
  elsif new.reference_policy = 'hub_client_id'
    and new.remote_reference !~ '^SSC-[0-9]{4}-[0-9]{3,}$'
  then
    raise exception 'Hub client reference must use the canonical SSC identity'
      using errcode = '23514';
  elsif new.reference_policy = 'hub_project_id'
    and new.remote_reference !~ '^SS-[0-9]{4}-[0-9]{3,}$'
  then
    raise exception 'Hub project reference must use the canonical SS identity'
      using errcode = '23514';
  end if;

  if new.project_id is not null and not exists (
    select 1 from ss.projects project
     where project.id = new.project_id
       and project.organization_id = new.organization_id
  ) then
    raise exception 'adjacent crosswalk project is outside the organization'
      using errcode = '42501';
  end if;

  if new.local_entity_kind = 'organization' then
    if new.local_entity_id <> new.organization_id
      or new.project_id is not null
    then
      raise exception 'adjacent organization identity is not exact'
        using errcode = '23514';
    end if;
  elsif new.local_entity_kind = 'project' then
    if new.project_id is null or new.local_entity_id <> new.project_id then
      raise exception 'adjacent project identity is not exact'
        using errcode = '23514';
    end if;
  elsif new.local_entity_kind = 'engagement' then
    select engagement.organization_id, engagement.project_id
      into selected_engagement
      from ss.customer_engagements engagement
     where engagement.id = new.local_entity_id;
    if not found
      or selected_engagement.organization_id <> new.organization_id
      or selected_engagement.project_id is distinct from new.project_id
    then
      raise exception 'marketing promotion engagement identity is not exact'
        using errcode = '23514';
    end if;
  elsif new.local_entity_kind = 'direct_opportunity' then
    select opportunity.organization_id, opportunity.project_id
      into selected_opportunity
      from ss.service_custom_build_direct_opportunities opportunity
     where opportunity.id = new.local_entity_id;
    if not found
      or selected_opportunity.organization_id <> new.organization_id
      or selected_opportunity.project_id is distinct from new.project_id
    then
      raise exception 'marketing promotion opportunity identity is not exact'
        using errcode = '23514';
    end if;
  else
    raise exception 'adjacent tenant local identity kind is invalid'
      using errcode = '23514';
  end if;

  if new.supersedes_crosswalk_id is not null then
    select * into selected_superseded
      from ss.adjacent_integration_crosswalks prior
     where prior.id = new.supersedes_crosswalk_id
       and prior.organization_id = new.organization_id
       and prior.system_key = new.system_key;
    if not found
      or selected_superseded.state <> 'superseded'
      or not (
        (selected_superseded.local_entity_kind = new.local_entity_kind
          and selected_superseded.local_entity_id = new.local_entity_id)
        or (selected_superseded.remote_entity_kind = new.remote_entity_kind
          and selected_superseded.remote_reference_digest =
            ss.adjacent_integration_reference_digest_v1(
              new.remote_reference
            ))
      )
    then
      raise exception 'replacement crosswalk lacks exact superseded lineage'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger adjacent_integration_crosswalks_guard
before insert
on ss.adjacent_integration_crosswalks
for each row execute function ss.guard_adjacent_integration_crosswalk_v1();

create function ss.adjacent_integration_observation_payload_digest_v1(
  selected_observation_kind text,
  selected_observation_state text,
  selected_source_payload_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
strict
parallel safe
security definer
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'contract', 'adjacent-observation-payload-v1',
    'observationKind', selected_observation_kind,
    'observationState', selected_observation_state,
    'sourcePayloadDigest', selected_source_payload_digest
  ))
$$;

create function ss.adjacent_integration_tenant_observation_semantic_digest_v1(
  selected_crosswalk_id uuid,
  selected_source_snapshot_id uuid,
  selected_organization_id uuid,
  selected_system_key text,
  selected_observation_kind text,
  selected_observation_state text,
  selected_source_revision text,
  selected_source_payload_digest ss.sha256_hex,
  selected_source_observed_at timestamptz
)
returns ss.sha256_hex
language sql
immutable
strict
parallel safe
security definer
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'contract', 'adjacent-tenant-observation-semantic-v1',
    'crosswalkId', selected_crosswalk_id,
    'sourceSnapshotId', selected_source_snapshot_id,
    'organizationId', selected_organization_id,
    'systemKey', selected_system_key,
    'observationKind', selected_observation_kind,
    'observationState', selected_observation_state,
    'sourceRevision', selected_source_revision,
    'payloadDigest', ss.adjacent_integration_observation_payload_digest_v1(
      selected_observation_kind, selected_observation_state,
      selected_source_payload_digest
    ),
    'sourceObservedAt', selected_source_observed_at
  ))
$$;

create table ss.adjacent_integration_observations (
  id uuid primary key,
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  crosswalk_id uuid not null,
  source_snapshot_id uuid not null,
  organization_id uuid not null,
  project_id uuid references ss.projects(id),
  system_key text not null,
  scope_kind text not null default 'tenant_crosswalk' check (
    scope_kind = 'tenant_crosswalk'
  ),
  observation_kind text not null,
  observation_state text not null check (observation_state in (
    'available', 'unavailable', 'matched', 'changed', 'held',
    'manual_review'
  )),
  source_revision text not null check (
    source_revision ~
      '^(git:[0-9a-f]{40}|sha256:[0-9a-f]{64})$'
  ),
  source_payload_digest ss.sha256_hex not null,
  payload_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_observation_payload_digest_v1(
      observation_kind, observation_state, source_payload_digest
    )
  ) stored,
  provenance_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_provenance_digest_v1(
      system_key, source_revision, source_payload_digest
    )
  ) stored,
  source_observed_at timestamptz not null,
  semantic_evidence_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_tenant_observation_semantic_digest_v1(
      crosswalk_id, source_snapshot_id, organization_id, system_key,
      observation_kind,
      observation_state, source_revision, source_payload_digest,
      source_observed_at
    )
  ) stored,
  operator_user_id uuid not null references auth.users(id),
  recorded_at timestamptz not null,
  request_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_request_digest_v1(
      'tenant_observation',
      ss.adjacent_integration_tenant_observation_semantic_digest_v1(
        crosswalk_id, source_snapshot_id, organization_id, system_key,
        observation_kind,
        observation_state, source_revision, source_payload_digest,
        source_observed_at
      ),
      organization_id, operator_user_id
    )
  ) stored,
  automatic_commands boolean not null default false check (
    automatic_commands = false
  ),
  remote_write_effects boolean not null default false check (
    remote_write_effects = false
  ),
  provider_effects boolean not null default false check (
    provider_effects = false
  ),
  foreign key (crosswalk_id, organization_id, system_key)
    references ss.adjacent_integration_crosswalks(
      id, organization_id, system_key
    ),
  foreign key (system_key, scope_kind, observation_kind)
    references ss.adjacent_integration_observation_contracts(
      system_key, scope_kind, observation_kind
    ),
  unique (semantic_evidence_digest)
);

create function ss.guard_adjacent_integration_observation_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_crosswalk ss.adjacent_integration_crosswalks%rowtype;
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is not null
    or ss.current_service_actor_user_id() is distinct from new.operator_user_id
    or not ss.service_operator_has_capability(
      new.operator_user_id, 'service_management_manage', clock_timestamp()
    )
    or not exists (
      select 1 from ss.organization_memberships membership
       where membership.organization_id = new.organization_id
         and membership.user_id = new.operator_user_id
         and membership.state = 'active'
    )
    or new.recorded_at < clock_timestamp() - interval '5 minutes'
    or new.recorded_at > clock_timestamp() + interval '5 minutes'
    or new.source_observed_at > new.recorded_at + interval '5 minutes'
  then
    raise exception 'adjacent observation requires the exact current operator'
      using errcode = '42501';
  end if;

  select * into selected_crosswalk
    from ss.adjacent_integration_crosswalks selected
   where selected.id = new.crosswalk_id
     and selected.organization_id = new.organization_id
     and selected.system_key = new.system_key;
  if not found
    or new.project_id is distinct from selected_crosswalk.project_id
  then
    raise exception 'adjacent observation conflicts with its crosswalk'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger adjacent_integration_observations_guard
before insert or update or delete
on ss.adjacent_integration_observations
for each row execute function ss.guard_adjacent_integration_observation_v1();

create function ss.adjacent_integration_global_snapshot_semantic_digest_v1(
  selected_system_key text,
  selected_remote_entity_kind text,
  selected_remote_reference text,
  selected_observation_kind text,
  selected_observation_state text,
  selected_source_revision text,
  selected_source_payload_digest ss.sha256_hex,
  selected_source_observed_at timestamptz,
  selected_operator_organization_id uuid
)
returns ss.sha256_hex
language sql
immutable
strict
parallel safe
security definer
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'contract', 'adjacent-global-snapshot-semantic-v1',
    'systemKey', selected_system_key,
    'remoteEntityKind', selected_remote_entity_kind,
    'remoteReferenceDigest',
      ss.adjacent_integration_reference_digest_v1(
        selected_remote_reference
      ),
    'observationKind', selected_observation_kind,
    'observationState', selected_observation_state,
    'sourceRevision', selected_source_revision,
    'payloadDigest', ss.adjacent_integration_observation_payload_digest_v1(
      selected_observation_kind, selected_observation_state,
      selected_source_payload_digest
    ),
    'sourceObservedAt', selected_source_observed_at,
    'operatorOrganizationId', selected_operator_organization_id
  ))
$$;

create table ss.adjacent_integration_global_snapshots (
  id uuid primary key,
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  system_key text not null references
    ss.adjacent_integration_system_contracts(system_key),
  scope_kind text not null default 'global_snapshot' check (
    scope_kind = 'global_snapshot'
  ),
  local_entity_kind text not null default 'platform' check (
    local_entity_kind = 'platform'
  ),
  remote_entity_kind text not null,
  reference_policy text not null,
  remote_reference text not null check (
    remote_reference ~ '^sha256:[0-9a-f]{64}$'
  ),
  remote_reference_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_reference_digest_v1(remote_reference)
  ) stored,
  observation_kind text not null,
  observation_state text not null check (observation_state in (
    'available', 'unavailable', 'matched', 'changed', 'held',
    'manual_review'
  )),
  source_revision text not null check (
    source_revision ~
      '^(git:[0-9a-f]{40}|sha256:[0-9a-f]{64})$'
  ),
  source_payload_digest ss.sha256_hex not null,
  payload_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_observation_payload_digest_v1(
      observation_kind, observation_state, source_payload_digest
    )
  ) stored,
  provenance_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_provenance_digest_v1(
      system_key, source_revision, source_payload_digest
    )
  ) stored,
  source_observed_at timestamptz not null,
  semantic_evidence_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_global_snapshot_semantic_digest_v1(
      system_key, remote_entity_kind, remote_reference, observation_kind,
      observation_state, source_revision, source_payload_digest,
      source_observed_at, operator_organization_id
    )
  ) stored,
  operator_organization_id uuid not null references ss.organizations(id),
  operator_user_id uuid not null references auth.users(id),
  recorded_at timestamptz not null,
  request_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_request_digest_v1(
      'global_snapshot',
      ss.adjacent_integration_global_snapshot_semantic_digest_v1(
        system_key, remote_entity_kind, remote_reference, observation_kind,
        observation_state, source_revision, source_payload_digest,
        source_observed_at, operator_organization_id
      ),
      operator_organization_id, operator_user_id
    )
  ) stored,
  automatic_commands boolean not null default false check (
    automatic_commands = false
  ),
  remote_write_effects boolean not null default false check (
    remote_write_effects = false
  ),
  provider_effects boolean not null default false check (
    provider_effects = false
  ),
  foreign key (
    system_key, scope_kind, local_entity_kind, remote_entity_kind,
    reference_policy
  ) references ss.adjacent_integration_identity_pairs(
    system_key, scope_kind, local_entity_kind, remote_entity_kind,
    reference_policy
  ),
  foreign key (system_key, scope_kind, observation_kind)
    references ss.adjacent_integration_observation_contracts(
      system_key, scope_kind, observation_kind
    ),
  unique (semantic_evidence_digest),
  unique (
    id, system_key, source_revision, source_payload_digest,
    operator_organization_id
  )
);

alter table ss.adjacent_integration_crosswalks
  add foreign key (
    source_snapshot_id, system_key, source_revision,
    source_evidence_digest, organization_id
  ) references ss.adjacent_integration_global_snapshots(
    id, system_key, source_revision, source_payload_digest,
    operator_organization_id
  );

alter table ss.adjacent_integration_observations
  add foreign key (
    source_snapshot_id, system_key, source_revision, source_payload_digest,
    organization_id
  ) references ss.adjacent_integration_global_snapshots(
    id, system_key, source_revision, source_payload_digest,
    operator_organization_id
  );

create function ss.guard_adjacent_integration_global_snapshot_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is not null
    or ss.current_service_actor_user_id() is distinct from new.operator_user_id
    or not ss.service_operator_has_capability(
      new.operator_user_id, 'service_management_manage', clock_timestamp()
    )
    or not exists (
      select 1
        from ss.organizations organization
        join ss.organization_memberships membership
          on membership.organization_id = organization.id
         and membership.user_id = new.operator_user_id
       where organization.id = new.operator_organization_id
         and organization.state = 'active'
         and membership.state = 'active'
    )
    or new.recorded_at < clock_timestamp() - interval '5 minutes'
    or new.recorded_at > clock_timestamp() + interval '5 minutes'
    or new.source_observed_at > new.recorded_at + interval '5 minutes'
  then
    raise exception 'global snapshot requires the exact current operator'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger adjacent_integration_global_snapshots_guard
before insert or update or delete
on ss.adjacent_integration_global_snapshots
for each row execute function
  ss.guard_adjacent_integration_global_snapshot_v1();

create function ss.adjacent_integration_resolution_semantic_digest_v1(
  selected_crosswalk_id uuid,
  selected_expected_request_digest ss.sha256_hex,
  selected_expected_revision bigint,
  selected_prior_state text,
  selected_resolution_kind text,
  selected_resulting_state text,
  selected_resolution_evidence_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
security definer
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'contract', 'adjacent-resolution-semantic-v1',
    'crosswalkId', selected_crosswalk_id,
    'expectedRequestDigest', selected_expected_request_digest,
    'expectedRevision', selected_expected_revision,
    'priorState', selected_prior_state,
    'resolutionKind', selected_resolution_kind,
    'resultingState', selected_resulting_state,
    'resolutionEvidenceDigest', selected_resolution_evidence_digest
  ))
$$;

create table ss.adjacent_integration_crosswalk_resolutions (
  id uuid primary key,
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  crosswalk_id uuid not null,
  organization_id uuid not null,
  system_key text not null,
  expected_crosswalk_request_digest ss.sha256_hex not null,
  expected_crosswalk_revision bigint not null check (
    expected_crosswalk_revision > 0
  ),
  prior_state text not null check (prior_state in (
    'linked', 'manual_review', 'conflict'
  )),
  resolution_kind text not null check (resolution_kind in (
    'operator_confirm_link', 'operator_reject_link',
    'operator_supersede_link', 'operator_flag_conflict'
  )),
  resulting_state text not null check (resulting_state in (
    'linked', 'conflict', 'superseded'
  )),
  resolution_evidence_digest ss.sha256_hex not null,
  semantic_evidence_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_resolution_semantic_digest_v1(
      crosswalk_id, expected_crosswalk_request_digest,
      expected_crosswalk_revision, prior_state, resolution_kind,
      resulting_state, resolution_evidence_digest
    )
  ) stored,
  operator_user_id uuid not null references auth.users(id),
  recorded_at timestamptz not null,
  request_digest ss.sha256_hex generated always as (
    ss.adjacent_integration_request_digest_v1(
      'crosswalk_resolution',
      ss.adjacent_integration_resolution_semantic_digest_v1(
        crosswalk_id, expected_crosswalk_request_digest,
        expected_crosswalk_revision, prior_state, resolution_kind,
        resulting_state, resolution_evidence_digest
      ),
      organization_id, operator_user_id
    )
  ) stored,
  automatic_commands boolean not null default false check (
    automatic_commands = false
  ),
  remote_write_effects boolean not null default false check (
    remote_write_effects = false
  ),
  provider_effects boolean not null default false check (
    provider_effects = false
  ),
  foreign key (crosswalk_id, organization_id, system_key)
    references ss.adjacent_integration_crosswalks(
      id, organization_id, system_key
    ),
  unique (semantic_evidence_digest),
  unique (crosswalk_id, expected_crosswalk_revision),
  check (
    (resolution_kind = 'operator_confirm_link'
      and prior_state in ('manual_review', 'conflict')
      and resulting_state = 'linked')
    or (resolution_kind = 'operator_reject_link'
      and prior_state in ('manual_review', 'conflict')
      and resulting_state = 'superseded')
    or (resolution_kind = 'operator_supersede_link'
      and prior_state in ('linked', 'conflict')
      and resulting_state = 'superseded')
    or (resolution_kind = 'operator_flag_conflict'
      and prior_state = 'linked'
      and resulting_state = 'conflict')
  )
);

create function ss.guard_adjacent_integration_crosswalk_resolution_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_crosswalk ss.adjacent_integration_crosswalks%rowtype;
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is not null
    or ss.current_service_actor_user_id() is distinct from new.operator_user_id
    or not ss.service_operator_has_capability(
      new.operator_user_id, 'service_management_manage', clock_timestamp()
    )
    or not exists (
      select 1 from ss.organization_memberships membership
       where membership.organization_id = new.organization_id
         and membership.user_id = new.operator_user_id
         and membership.state = 'active'
    )
    or new.recorded_at < clock_timestamp() - interval '5 minutes'
    or new.recorded_at > clock_timestamp() + interval '5 minutes'
  then
    raise exception 'adjacent resolution requires the exact current operator'
      using errcode = '42501';
  end if;

  select * into selected_crosswalk
    from ss.adjacent_integration_crosswalks crosswalk
   where crosswalk.id = new.crosswalk_id
     and crosswalk.organization_id = new.organization_id
     and crosswalk.system_key = new.system_key
   for update;
  if not found
    or selected_crosswalk.request_digest <>
      new.expected_crosswalk_request_digest
    or selected_crosswalk.revision <> new.expected_crosswalk_revision
    or selected_crosswalk.state <> new.prior_state
  then
    raise exception 'adjacent crosswalk changed; refresh and retry'
      using errcode = '40001';
  end if;

  return new;
end
$$;

create trigger adjacent_integration_crosswalk_resolutions_guard
before insert
on ss.adjacent_integration_crosswalk_resolutions
for each row execute function
  ss.guard_adjacent_integration_crosswalk_resolution_v1();

create function ss.guard_adjacent_integration_crosswalk_transition_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_resolution_exists boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'adjacent crosswalk evidence cannot be deleted'
      using errcode = '55000';
  end if;
  select exists (
    select 1
      from ss.adjacent_integration_crosswalk_resolutions resolution
     where resolution.crosswalk_id = old.id
       and resolution.organization_id = old.organization_id
       and resolution.system_key = old.system_key
       and resolution.expected_crosswalk_request_digest = old.request_digest
       and resolution.expected_crosswalk_revision = old.revision
       and resolution.prior_state = old.state
       and resolution.resulting_state = new.state
       and resolution.operator_user_id =
         ss.current_service_actor_user_id()
       and resolution.recorded_at = new.updated_at
  ) into selected_resolution_exists;
  if (to_jsonb(new) - 'state' - 'revision' - 'updated_at'
        - 'remote_reference_digest' - 'source_revision_digest'
        - 'provenance_digest' - 'semantic_evidence_digest'
        - 'link_evidence_digest' - 'request_digest')
      is distinct from
      (to_jsonb(old) - 'state' - 'revision' - 'updated_at'
        - 'remote_reference_digest' - 'source_revision_digest'
        - 'provenance_digest' - 'semantic_evidence_digest'
        - 'link_evidence_digest' - 'request_digest')
    or new.revision <> old.revision + 1
    or new.updated_at < old.updated_at
    or not selected_resolution_exists
  then
    raise exception 'adjacent crosswalk transition lacks exact resolution evidence'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger adjacent_integration_crosswalks_transition_guard
before update or delete on ss.adjacent_integration_crosswalks
for each row execute function
  ss.guard_adjacent_integration_crosswalk_transition_v1();

create trigger adjacent_integration_crosswalk_resolutions_immutable
before update or delete on ss.adjacent_integration_crosswalk_resolutions
for each row execute function ss.reject_update();

create view ss.adjacent_integration_crosswalk_status_v1
with (security_invoker = true)
as
select
  crosswalk.id,
  crosswalk.organization_id,
  crosswalk.project_id,
  crosswalk.system_key,
  crosswalk.local_entity_kind,
  crosswalk.local_entity_id,
  crosswalk.remote_entity_kind,
  crosswalk.remote_reference_digest,
  crosswalk.source_revision_digest,
  crosswalk.provenance_digest,
  crosswalk.state as recorded_state,
  resolution.id as resolution_id,
  resolution.resolution_kind,
  crosswalk.supersedes_crosswalk_id,
  resolution.resolution_evidence_digest,
  crosswalk.state as effective_state,
  crosswalk.revision,
  crosswalk.operator_user_id,
  crosswalk.recorded_at,
  crosswalk.request_digest
from ss.adjacent_integration_crosswalks crosswalk
left join lateral (
  select selected.*
    from ss.adjacent_integration_crosswalk_resolutions selected
   where selected.crosswalk_id = crosswalk.id
   order by selected.expected_crosswalk_revision desc
   limit 1
) resolution on true;

create function ss.guard_adjacent_integration_contract_catalog_v1()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'adjacent integration contract catalog is immutable'
    using errcode = '55000';
end
$$;

create trigger adjacent_integration_system_contracts_immutable
before insert or update or delete
on ss.adjacent_integration_system_contracts
for each row execute function
  ss.guard_adjacent_integration_contract_catalog_v1();

create trigger adjacent_integration_identity_pairs_immutable
before insert or update or delete
on ss.adjacent_integration_identity_pairs
for each row execute function
  ss.guard_adjacent_integration_contract_catalog_v1();

create trigger adjacent_integration_observation_contracts_immutable
before insert or update or delete
on ss.adjacent_integration_observation_contracts
for each row execute function
  ss.guard_adjacent_integration_contract_catalog_v1();

alter table ss.adjacent_integration_system_contracts enable row level security;
alter table ss.adjacent_integration_system_contracts force row level security;
alter table ss.adjacent_integration_identity_pairs enable row level security;
alter table ss.adjacent_integration_identity_pairs force row level security;
alter table ss.adjacent_integration_observation_contracts
  enable row level security;
alter table ss.adjacent_integration_observation_contracts
  force row level security;
alter table ss.adjacent_integration_crosswalks enable row level security;
alter table ss.adjacent_integration_crosswalks force row level security;
alter table ss.adjacent_integration_observations enable row level security;
alter table ss.adjacent_integration_observations force row level security;
alter table ss.adjacent_integration_global_snapshots enable row level security;
alter table ss.adjacent_integration_global_snapshots force row level security;
alter table ss.adjacent_integration_crosswalk_resolutions
  enable row level security;
alter table ss.adjacent_integration_crosswalk_resolutions
  force row level security;

do $$
declare selected_table text;
begin
  foreach selected_table in array array[
    'adjacent_integration_system_contracts',
    'adjacent_integration_identity_pairs',
    'adjacent_integration_observation_contracts',
    'adjacent_integration_crosswalks',
    'adjacent_integration_observations',
    'adjacent_integration_global_snapshots',
    'adjacent_integration_crosswalk_resolutions'
  ] loop
    execute format(
      'create policy %I on ss.%I for select using (
        ss.current_service_actor_kind() = ''system''
        and ss.current_service_actor_org_id() is null
      )',
      selected_table || '_system_select', selected_table
    );
  end loop;
end
$$;

create policy adjacent_integration_crosswalks_system_insert
on ss.adjacent_integration_crosswalks for insert with check (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() is null
);
create policy adjacent_integration_observations_system_insert
on ss.adjacent_integration_observations for insert with check (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() is null
);
create policy adjacent_integration_global_snapshots_system_insert
on ss.adjacent_integration_global_snapshots for insert with check (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() is null
);
create policy adjacent_integration_crosswalk_resolutions_system_insert
on ss.adjacent_integration_crosswalk_resolutions for insert with check (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() is null
);

create function ss.operator_adjacent_integration_contracts_v1()
returns setof ss.adjacent_integration_system_contracts
language plpgsql
stable
security definer
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() <> 'operator'
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_management_manage', clock_timestamp()
    )
    or not exists (
      select 1
        from ss.organizations organization
        join ss.organization_memberships membership
          on membership.organization_id = organization.id
         and membership.user_id = ss.current_service_actor_user_id()
       where organization.id = ss.current_service_actor_org_id()
         and organization.state = 'active'
         and membership.state = 'active'
    )
  then
    raise exception 'adjacent contracts require exact operator authority'
      using errcode = '42501';
  end if;

  return query
  select contract.*
    from ss.adjacent_integration_system_contracts contract
   order by contract.system_key;
end
$$;

create function ss.operator_adjacent_integration_global_snapshots_v1(
  selected_system_key text,
  selected_source_snapshot_id uuid
)
returns table(
  id uuid, system_key text, remote_entity_kind text,
  remote_reference_digest ss.sha256_hex, observation_kind text,
  observation_state text, payload_digest ss.sha256_hex,
  provenance_digest ss.sha256_hex, source_observed_at timestamptz,
  recorded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() <> 'operator'
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_management_manage', clock_timestamp()
    )
    or not exists (
      select 1
        from ss.organizations organization
        join ss.organization_memberships membership
          on membership.organization_id = organization.id
         and membership.user_id = ss.current_service_actor_user_id()
       where organization.id = ss.current_service_actor_org_id()
         and organization.state = 'active'
         and membership.state = 'active'
    )
  then
    raise exception 'adjacent snapshots require exact operator authority'
      using errcode = '42501';
  end if;

  return query
  select snapshot.id, snapshot.system_key,
         snapshot.remote_entity_kind, snapshot.remote_reference_digest,
         snapshot.observation_kind, snapshot.observation_state,
         snapshot.payload_digest, snapshot.provenance_digest,
         snapshot.source_observed_at, snapshot.recorded_at
    from ss.adjacent_integration_global_snapshots snapshot
   where snapshot.operator_organization_id =
           ss.current_service_actor_org_id()
     and (selected_system_key is null
       or snapshot.system_key = selected_system_key)
     and (selected_source_snapshot_id is null
       or snapshot.id = selected_source_snapshot_id)
   order by snapshot.recorded_at desc, snapshot.id
   limit 100;
end
$$;

create function ss.operator_adjacent_integration_trace_v1(
  selected_project_id uuid,
  selected_system_key text,
  selected_crosswalk_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_organization_id uuid := ss.current_service_actor_org_id();
  selected_crosswalks jsonb;
  selected_observations jsonb;
begin
  if ss.current_service_actor_kind() <> 'operator'
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_management_manage', clock_timestamp()
    )
    or not exists (
      select 1
        from ss.organizations organization
        join ss.organization_memberships membership
          on membership.organization_id = organization.id
         and membership.user_id = ss.current_service_actor_user_id()
       where organization.id = selected_organization_id
         and organization.state = 'active'
         and membership.state = 'active'
    )
    or (
      selected_project_id is not null
      and not exists (
        select 1 from ss.projects project
         where project.id = selected_project_id
           and project.organization_id = selected_organization_id
      )
    )
  then
    raise exception 'adjacent trace requires exact operator authority'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(selected)
           order by selected.updated_at desc, selected.id), '[]'::jsonb)
    into selected_crosswalks
    from (
      select crosswalk.id, crosswalk.organization_id,
             crosswalk.project_id, crosswalk.system_key,
             crosswalk.source_snapshot_id,
             crosswalk.local_entity_kind, crosswalk.local_entity_id,
             crosswalk.remote_entity_kind,
             case when crosswalk.system_key = 'client_profile_hub'
               then crosswalk.remote_reference else null end
               as safe_remote_reference,
             crosswalk.remote_reference_digest,
             crosswalk.source_revision_digest,
             crosswalk.provenance_digest, crosswalk.state,
             crosswalk.supersedes_crosswalk_id, crosswalk.revision,
             crosswalk.request_digest, crosswalk.recorded_at,
             crosswalk.updated_at
        from ss.adjacent_integration_crosswalks crosswalk
       where crosswalk.organization_id = selected_organization_id
         and (selected_crosswalk_id is null
           or crosswalk.id = selected_crosswalk_id)
         and (selected_project_id is null
           or crosswalk.project_id is null
           or crosswalk.project_id = selected_project_id)
         and (selected_system_key is null
           or crosswalk.system_key = selected_system_key)
       limit 200
    ) selected;

  select coalesce(jsonb_agg(to_jsonb(selected)
           order by selected.recorded_at desc, selected.id), '[]'::jsonb)
    into selected_observations
    from (
      select observation.id, observation.crosswalk_id,
             observation.source_snapshot_id, observation.organization_id,
             observation.project_id, observation.system_key,
             observation.observation_kind,
             observation.observation_state, observation.payload_digest,
             observation.provenance_digest,
             observation.source_observed_at, observation.recorded_at
        from ss.adjacent_integration_observations observation
       where observation.organization_id = selected_organization_id
         and (selected_crosswalk_id is null
           or observation.crosswalk_id = selected_crosswalk_id)
         and (selected_project_id is null
           or observation.project_id is null
           or observation.project_id = selected_project_id)
         and (selected_system_key is null
           or observation.system_key = selected_system_key)
       limit 500
    ) selected;

  return jsonb_build_object(
    'crosswalks', selected_crosswalks,
    'observations', selected_observations
  );
end
$$;

create function ss.operator_adjacent_integration_review_queue_v1()
returns table(
  id uuid, source_table text, source_id text, source_revision bigint,
  source_digest ss.sha256_hex, source_state text, organization_id uuid,
  project_id uuid, item_kind text, severity text, status text,
  deadline_at timestamptz, repair_kind text, opened_at timestamptz,
  revision bigint, item_digest ss.sha256_hex, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() <> 'operator'
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_management_manage', clock_timestamp()
    )
    or not exists (
      select 1
        from ss.organizations organization
        join ss.organization_memberships membership
          on membership.organization_id = organization.id
         and membership.user_id = ss.current_service_actor_user_id()
       where organization.id = ss.current_service_actor_org_id()
         and organization.state = 'active'
         and membership.state = 'active'
    )
  then
    raise exception 'adjacent review queue requires exact operator authority'
      using errcode = '42501';
  end if;

  return query
  select crosswalk.id,
         'ss.adjacent_integration_crosswalks'::text,
         crosswalk.id::text, crosswalk.revision,
         crosswalk.request_digest, crosswalk.state,
         crosswalk.organization_id, crosswalk.project_id,
         'adjacent_identity_review'::text, 'normal'::text,
         'open'::text, null::timestamptz,
         'adjacent_crosswalk_resolution'::text,
         crosswalk.recorded_at, crosswalk.revision,
         crosswalk.semantic_evidence_digest, crosswalk.updated_at
    from ss.adjacent_integration_crosswalks crosswalk
   where crosswalk.organization_id = ss.current_service_actor_org_id()
     and crosswalk.state in ('manual_review', 'conflict')
   order by crosswalk.updated_at, crosswalk.id;
end
$$;

create function ss.assert_adjacent_integration_system_operator_v1(
  selected_operator_organization_id uuid,
  selected_operator_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is not null
    or ss.current_service_actor_user_id() is distinct from
      selected_operator_user_id
    or not ss.service_operator_has_capability(
      selected_operator_user_id,
      'service_management_manage', clock_timestamp()
    )
    or not exists (
      select 1
        from ss.organizations organization
        join ss.organization_memberships membership
          on membership.organization_id = organization.id
         and membership.user_id = selected_operator_user_id
       where organization.id = selected_operator_organization_id
         and organization.state = 'active'
         and membership.state = 'active'
    )
  then
    raise exception 'adjacent recording requires exact system operator'
      using errcode = '42501';
  end if;
end
$$;

create function ss.adjacent_integration_global_snapshot_digest_for_actor_v1(
  selected_system_key text,
  selected_remote_entity_kind text,
  selected_remote_reference text,
  selected_observation_kind text,
  selected_observation_state text,
  selected_source_revision text,
  selected_source_payload_digest ss.sha256_hex,
  selected_source_observed_at timestamptz,
  selected_operator_organization_id uuid,
  selected_operator_user_id uuid
)
returns ss.sha256_hex
language plpgsql
stable
security definer
set search_path = pg_catalog, ss
as $$
begin
  perform ss.assert_adjacent_integration_system_operator_v1(
    selected_operator_organization_id, selected_operator_user_id
  );
  return ss.adjacent_integration_global_snapshot_semantic_digest_v1(
    selected_system_key, selected_remote_entity_kind,
    selected_remote_reference, selected_observation_kind,
    selected_observation_state, selected_source_revision,
    selected_source_payload_digest, selected_source_observed_at,
    selected_operator_organization_id
  );
end
$$;

create function ss.adjacent_integration_crosswalk_digest_for_actor_v1(
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_system_key text,
  selected_source_snapshot_id uuid,
  selected_local_entity_kind text,
  selected_local_entity_id uuid,
  selected_remote_entity_kind text,
  selected_remote_reference text,
  selected_source_revision text,
  selected_source_evidence_digest ss.sha256_hex,
  selected_supersedes_crosswalk_id uuid,
  selected_initial_state text,
  selected_operator_user_id uuid
)
returns ss.sha256_hex
language plpgsql
stable
security definer
set search_path = pg_catalog, ss
as $$
begin
  perform ss.assert_adjacent_integration_system_operator_v1(
    selected_organization_id, selected_operator_user_id
  );
  return ss.adjacent_integration_crosswalk_semantic_digest_v1(
    selected_organization_id, selected_project_id, selected_system_key,
    selected_source_snapshot_id, selected_local_entity_kind,
    selected_local_entity_id, selected_remote_entity_kind,
    selected_remote_reference, selected_source_revision,
    selected_source_evidence_digest, selected_supersedes_crosswalk_id,
    selected_initial_state
  );
end
$$;

create function ss.adjacent_integration_observation_digest_for_actor_v1(
  selected_crosswalk_id uuid,
  selected_source_snapshot_id uuid,
  selected_organization_id uuid,
  selected_system_key text,
  selected_observation_kind text,
  selected_observation_state text,
  selected_source_revision text,
  selected_source_payload_digest ss.sha256_hex,
  selected_source_observed_at timestamptz,
  selected_operator_user_id uuid
)
returns ss.sha256_hex
language plpgsql
stable
security definer
set search_path = pg_catalog, ss
as $$
begin
  perform ss.assert_adjacent_integration_system_operator_v1(
    selected_organization_id, selected_operator_user_id
  );
  return ss.adjacent_integration_tenant_observation_semantic_digest_v1(
    selected_crosswalk_id, selected_source_snapshot_id,
    selected_organization_id, selected_system_key,
    selected_observation_kind, selected_observation_state,
    selected_source_revision, selected_source_payload_digest,
    selected_source_observed_at
  );
end
$$;

create function ss.adjacent_integration_resolution_digest_for_actor_v1(
  selected_crosswalk_id uuid,
  selected_expected_request_digest ss.sha256_hex,
  selected_expected_revision bigint,
  selected_prior_state text,
  selected_resolution_kind text,
  selected_resulting_state text,
  selected_resolution_evidence_digest ss.sha256_hex,
  selected_organization_id uuid,
  selected_operator_user_id uuid
)
returns ss.sha256_hex
language plpgsql
stable
security definer
set search_path = pg_catalog, ss
as $$
begin
  perform ss.assert_adjacent_integration_system_operator_v1(
    selected_organization_id, selected_operator_user_id
  );
  return ss.adjacent_integration_resolution_semantic_digest_v1(
    selected_crosswalk_id, selected_expected_request_digest,
    selected_expected_revision, selected_prior_state,
    selected_resolution_kind, selected_resulting_state,
    selected_resolution_evidence_digest
  );
end
$$;

create function ss.record_adjacent_integration_global_snapshot_v1(
  selected_id uuid, selected_command_id text, selected_system_key text,
  selected_remote_entity_kind text, selected_remote_reference text,
  selected_observation_kind text, selected_observation_state text,
  selected_source_revision text,
  selected_source_payload_digest ss.sha256_hex,
  selected_source_observed_at timestamptz,
  selected_operator_organization_id uuid,
  selected_operator_user_id uuid,
  selected_recorded_at timestamptz
)
returns ss.adjacent_integration_global_snapshots
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare selected ss.adjacent_integration_global_snapshots%rowtype;
begin
  perform ss.assert_adjacent_integration_system_operator_v1(
    selected_operator_organization_id, selected_operator_user_id
  );
  insert into ss.adjacent_integration_global_snapshots (
    id, command_id, system_key, remote_entity_kind, reference_policy,
    remote_reference, observation_kind, observation_state,
    source_revision, source_payload_digest, source_observed_at,
    operator_organization_id, operator_user_id, recorded_at
  ) values (
    selected_id, selected_command_id, selected_system_key,
    selected_remote_entity_kind, 'digest_only', selected_remote_reference,
    selected_observation_kind, selected_observation_state,
    selected_source_revision, selected_source_payload_digest,
    selected_source_observed_at, selected_operator_organization_id,
    selected_operator_user_id, selected_recorded_at
  ) returning * into selected;
  return selected;
end
$$;

create function ss.record_adjacent_integration_crosswalk_v1(
  selected_id uuid, selected_command_id text,
  selected_organization_id uuid, selected_project_id uuid,
  selected_system_key text, selected_source_snapshot_id uuid,
  selected_local_entity_kind text, selected_local_entity_id uuid,
  selected_remote_entity_kind text, selected_reference_policy text,
  selected_remote_reference text, selected_source_revision text,
  selected_source_evidence_digest ss.sha256_hex,
  selected_supersedes_crosswalk_id uuid, selected_state text,
  selected_operator_user_id uuid, selected_recorded_at timestamptz
)
returns ss.adjacent_integration_crosswalks
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare selected ss.adjacent_integration_crosswalks%rowtype;
begin
  perform ss.assert_adjacent_integration_system_operator_v1(
    selected_organization_id, selected_operator_user_id
  );
  insert into ss.adjacent_integration_crosswalks (
    id, command_id, organization_id, project_id, system_key,
    source_snapshot_id, local_entity_kind, local_entity_id,
    remote_entity_kind, reference_policy, remote_reference,
    source_revision, source_evidence_digest, supersedes_crosswalk_id,
    initial_state, state, operator_user_id, recorded_at, updated_at
  ) values (
    selected_id, selected_command_id, selected_organization_id,
    selected_project_id, selected_system_key, selected_source_snapshot_id,
    selected_local_entity_kind, selected_local_entity_id,
    selected_remote_entity_kind, selected_reference_policy,
    selected_remote_reference, selected_source_revision,
    selected_source_evidence_digest, selected_supersedes_crosswalk_id,
    selected_state, selected_state, selected_operator_user_id, selected_recorded_at,
    selected_recorded_at
  ) returning * into selected;
  return selected;
end
$$;

create function ss.record_adjacent_integration_observation_v1(
  selected_id uuid, selected_command_id text, selected_crosswalk_id uuid,
  selected_source_snapshot_id uuid, selected_organization_id uuid,
  selected_project_id uuid, selected_system_key text,
  selected_observation_kind text, selected_observation_state text,
  selected_source_revision text,
  selected_source_payload_digest ss.sha256_hex,
  selected_source_observed_at timestamptz,
  selected_operator_user_id uuid, selected_recorded_at timestamptz
)
returns ss.adjacent_integration_observations
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare selected ss.adjacent_integration_observations%rowtype;
begin
  perform ss.assert_adjacent_integration_system_operator_v1(
    selected_organization_id, selected_operator_user_id
  );
  insert into ss.adjacent_integration_observations (
    id, command_id, crosswalk_id, source_snapshot_id, organization_id,
    project_id, system_key, observation_kind, observation_state,
    source_revision, source_payload_digest, source_observed_at,
    operator_user_id, recorded_at
  ) values (
    selected_id, selected_command_id, selected_crosswalk_id,
    selected_source_snapshot_id, selected_organization_id,
    selected_project_id, selected_system_key, selected_observation_kind,
    selected_observation_state, selected_source_revision,
    selected_source_payload_digest, selected_source_observed_at,
    selected_operator_user_id, selected_recorded_at
  ) returning * into selected;
  return selected;
end
$$;

create function ss.record_adjacent_integration_resolution_v1(
  selected_id uuid, selected_command_id text, selected_crosswalk_id uuid,
  selected_organization_id uuid, selected_system_key text,
  selected_expected_request_digest ss.sha256_hex,
  selected_expected_revision bigint, selected_prior_state text,
  selected_resolution_kind text, selected_resulting_state text,
  selected_resolution_evidence_digest ss.sha256_hex,
  selected_operator_user_id uuid, selected_recorded_at timestamptz
)
returns ss.adjacent_integration_crosswalk_resolutions
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare selected ss.adjacent_integration_crosswalk_resolutions%rowtype;
begin
  perform ss.assert_adjacent_integration_system_operator_v1(
    selected_organization_id, selected_operator_user_id
  );
  insert into ss.adjacent_integration_crosswalk_resolutions (
    id, command_id, crosswalk_id, organization_id, system_key,
    expected_crosswalk_request_digest, expected_crosswalk_revision,
    prior_state, resolution_kind, resulting_state,
    resolution_evidence_digest, operator_user_id, recorded_at
  ) values (
    selected_id, selected_command_id, selected_crosswalk_id,
    selected_organization_id, selected_system_key,
    selected_expected_request_digest, selected_expected_revision,
    selected_prior_state, selected_resolution_kind,
    selected_resulting_state, selected_resolution_evidence_digest,
    selected_operator_user_id, selected_recorded_at
  ) returning * into selected;
  update ss.adjacent_integration_crosswalks crosswalk
     set state = selected.resulting_state,
         revision = crosswalk.revision + 1,
         updated_at = selected.recorded_at
   where crosswalk.id = selected.crosswalk_id
     and crosswalk.organization_id = selected.organization_id
     and crosswalk.system_key = selected.system_key
     and crosswalk.request_digest =
       selected.expected_crosswalk_request_digest
     and crosswalk.revision = selected.expected_crosswalk_revision
     and crosswalk.state = selected.prior_state;
  if not found then
    raise exception 'adjacent crosswalk changed during resolution'
      using errcode = '40001';
  end if;
  return selected;
end
$$;

revoke all on ss.adjacent_integration_system_contracts,
  ss.adjacent_integration_identity_pairs,
  ss.adjacent_integration_observation_contracts,
  ss.adjacent_integration_crosswalks,
  ss.adjacent_integration_observations,
  ss.adjacent_integration_global_snapshots,
  ss.adjacent_integration_crosswalk_resolutions
from public, anon, authenticated, service_role;
grant select on ss.adjacent_integration_system_contracts,
  ss.adjacent_integration_identity_pairs,
  ss.adjacent_integration_observation_contracts,
  ss.adjacent_integration_crosswalks,
  ss.adjacent_integration_observations,
  ss.adjacent_integration_global_snapshots,
  ss.adjacent_integration_crosswalk_resolutions
to service_role;
revoke all on ss.adjacent_integration_crosswalk_status_v1
from public, anon, authenticated, service_role;
grant select on ss.adjacent_integration_crosswalk_status_v1 to service_role;

create function ss.adjacent_integration_system_contracts_digest_v1()
returns ss.sha256_hex
language sql
stable
security definer
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_agg(
    to_jsonb(contract) order by contract.system_key
  ))
  from ss.adjacent_integration_system_contracts contract
$$;

create function ss.adjacent_integration_contract_count_v1()
returns bigint
language sql
stable
security definer
set search_path = pg_catalog, ss
as $$
  select count(*) from ss.adjacent_integration_system_contracts
$$;

create function ss.adjacent_integration_crosswalks_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select
    'canonical-fin-004v-six-system-identity-snapshot-resolution-v1-held'::text
$$;

revoke all on function
  ss.adjacent_integration_reference_digest_v1(text),
  ss.adjacent_integration_source_revision_digest_v1(text),
  ss.adjacent_integration_provenance_digest_v1(
    text, text, ss.sha256_hex
  ),
  ss.adjacent_integration_request_digest_v1(
    text, ss.sha256_hex, uuid, uuid
  ),
  ss.adjacent_integration_crosswalk_link_digest_v1(
    uuid, uuid, text, uuid, text, uuid, text, text, text,
    ss.sha256_hex
  ),
  ss.adjacent_integration_crosswalk_semantic_digest_v1(
    uuid, uuid, text, uuid, text, uuid, text, text, text,
    ss.sha256_hex, uuid, text
  ),
  ss.adjacent_integration_observation_payload_digest_v1(
    text, text, ss.sha256_hex
  ),
  ss.adjacent_integration_tenant_observation_semantic_digest_v1(
    uuid, uuid, uuid, text, text, text, text, ss.sha256_hex, timestamptz
  ),
  ss.adjacent_integration_global_snapshot_semantic_digest_v1(
    text, text, text, text, text, text, ss.sha256_hex, timestamptz,
    uuid
  ),
  ss.adjacent_integration_resolution_semantic_digest_v1(
    uuid, ss.sha256_hex, bigint, text, text, text, ss.sha256_hex
  ),
  ss.guard_adjacent_integration_crosswalk_v1(),
  ss.guard_adjacent_integration_observation_v1(),
  ss.guard_adjacent_integration_global_snapshot_v1(),
  ss.guard_adjacent_integration_crosswalk_resolution_v1(),
  ss.guard_adjacent_integration_crosswalk_transition_v1(),
  ss.guard_adjacent_integration_contract_catalog_v1(),
  ss.assert_adjacent_integration_system_operator_v1(uuid, uuid),
  ss.adjacent_integration_global_snapshot_digest_for_actor_v1(
    text, text, text, text, text, text, ss.sha256_hex, timestamptz,
    uuid, uuid
  ),
  ss.adjacent_integration_crosswalk_digest_for_actor_v1(
    uuid, uuid, text, uuid, text, uuid, text, text, text,
    ss.sha256_hex, uuid, text, uuid
  ),
  ss.adjacent_integration_observation_digest_for_actor_v1(
    uuid, uuid, uuid, text, text, text, text, ss.sha256_hex,
    timestamptz, uuid
  ),
  ss.adjacent_integration_resolution_digest_for_actor_v1(
    uuid, ss.sha256_hex, bigint, text, text, text, ss.sha256_hex,
    uuid, uuid
  ),
  ss.record_adjacent_integration_global_snapshot_v1(
    uuid, text, text, text, text, text, text, text, ss.sha256_hex,
    timestamptz, uuid, uuid, timestamptz
  ),
  ss.record_adjacent_integration_crosswalk_v1(
    uuid, text, uuid, uuid, text, uuid, text, uuid, text, text, text,
    text, ss.sha256_hex, uuid, text, uuid, timestamptz
  ),
  ss.record_adjacent_integration_observation_v1(
    uuid, text, uuid, uuid, uuid, uuid, text, text, text, text,
    ss.sha256_hex, timestamptz, uuid, timestamptz
  ),
  ss.record_adjacent_integration_resolution_v1(
    uuid, text, uuid, uuid, text, ss.sha256_hex, bigint, text, text,
    text, ss.sha256_hex, uuid, timestamptz
  ),
  ss.operator_adjacent_integration_contracts_v1(),
  ss.operator_adjacent_integration_global_snapshots_v1(text, uuid),
  ss.operator_adjacent_integration_trace_v1(uuid, text, uuid),
  ss.operator_adjacent_integration_review_queue_v1(),
  ss.adjacent_integration_system_contracts_digest_v1(),
  ss.adjacent_integration_contract_count_v1(),
  ss.adjacent_integration_crosswalks_contract_v1()
from public, anon, authenticated, service_role;

grant execute on function
  ss.adjacent_integration_global_snapshot_digest_for_actor_v1(
    text, text, text, text, text, text, ss.sha256_hex, timestamptz,
    uuid, uuid
  ),
  ss.adjacent_integration_crosswalk_digest_for_actor_v1(
    uuid, uuid, text, uuid, text, uuid, text, text, text,
    ss.sha256_hex, uuid, text, uuid
  ),
  ss.adjacent_integration_observation_digest_for_actor_v1(
    uuid, uuid, uuid, text, text, text, text, ss.sha256_hex,
    timestamptz, uuid
  ),
  ss.adjacent_integration_resolution_digest_for_actor_v1(
    uuid, ss.sha256_hex, bigint, text, text, text, ss.sha256_hex,
    uuid, uuid
  ),
  ss.record_adjacent_integration_global_snapshot_v1(
    uuid, text, text, text, text, text, text, text, ss.sha256_hex,
    timestamptz, uuid, uuid, timestamptz
  ),
  ss.record_adjacent_integration_crosswalk_v1(
    uuid, text, uuid, uuid, text, uuid, text, uuid, text, text, text,
    text, ss.sha256_hex, uuid, text, uuid, timestamptz
  ),
  ss.record_adjacent_integration_observation_v1(
    uuid, text, uuid, uuid, uuid, uuid, text, text, text, text,
    ss.sha256_hex, timestamptz, uuid, timestamptz
  ),
  ss.record_adjacent_integration_resolution_v1(
    uuid, text, uuid, uuid, text, ss.sha256_hex, bigint, text, text,
    text, ss.sha256_hex, uuid, timestamptz
  ),
  ss.operator_adjacent_integration_contracts_v1(),
  ss.operator_adjacent_integration_global_snapshots_v1(text, uuid),
  ss.operator_adjacent_integration_trace_v1(uuid, text, uuid),
  ss.operator_adjacent_integration_review_queue_v1(),
  ss.adjacent_integration_system_contracts_digest_v1(),
  ss.adjacent_integration_contract_count_v1(),
  ss.adjacent_integration_crosswalks_contract_v1()
to service_role;

do $$
begin
  if (select count(*) from ss.adjacent_integration_system_contracts) <> 6
    or (select count(*) from ss.adjacent_integration_identity_pairs) <> 16
    or (select count(*) from ss.adjacent_integration_observation_contracts)
      <> 21
  then
    raise exception 'FIN-004V exact contract catalog is incomplete'
      using errcode = '55000';
  end if;
end
$$;

commit;
