-- FIN-004U operator resolution surfaces
-- Makes every retained manual-review source visible and permits only an
-- evidence-bound closure of provider reconciliation cases. It grants no
-- provider retry, billing, DNS, publication, or deletion authority.

begin;

do $$
begin
  if to_regprocedure('ss.hosted_provider_reconciliation_contract_v1()')
      is null
    or ss.hosted_provider_reconciliation_contract_v1() <>
      'canonical-provider-reconciliation-v1-readback-evidence-bound'
    or to_regprocedure('ss.worker_lifecycle_closure_contract_v1()') is null
    or ss.worker_lifecycle_closure_contract_v1() <>
      'canonical-fin-004t-project-domain-care-leases-v1-held'
    or to_regprocedure('ss.responder_voice_followup_closure_contract_v1()')
      is null
    or ss.responder_voice_followup_closure_contract_v1() <>
      'canonical-fin-004t-responder-voice-target-followup-v1-held'
  then
    raise exception 'FIN-004U requires the exact FIN-004R and FIN-004T contracts'
      using errcode = '55000';
  end if;
end
$$;

create table ss.provider_reconciliation_resolution_commands (
  id uuid primary key,
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  request_digest ss.sha256_hex not null,
  case_id uuid not null unique
    references ss.provider_reconciliation_cases(id),
  expected_case_revision bigint not null check (expected_case_revision > 0),
  operator_organization_id uuid not null references ss.organizations(id),
  operator_user_id uuid not null references auth.users(id),
  resolution_kind text not null check (resolution_kind in (
    'operator_confirmed_effect', 'operator_confirmed_no_effect',
    'operator_late_binding_applied', 'operator_binding_retired',
    'operator_closed'
  )),
  evidence_digest ss.sha256_hex not null,
  resolved_at timestamptz not null,
  created_at timestamptz not null,
  check (created_at = resolved_at)
);

create function ss.guard_provider_reconciliation_resolution_command_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_case ss.provider_reconciliation_cases%rowtype;
  allowed boolean := false;
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
    or new.resolved_at < clock_timestamp() - interval '5 minutes'
    or new.resolved_at > clock_timestamp() + interval '5 minutes'
  then
    raise exception 'reconciliation resolution requires the exact current operator'
      using errcode = '42501';
  end if;

  select * into selected_case
    from ss.provider_reconciliation_cases reconciliation
   where reconciliation.id = new.case_id
   for update;
  if not found
    or selected_case.state <> 'open'
    or selected_case.revision <> new.expected_case_revision
  then
    raise exception 'reconciliation case changed; refresh and retry'
      using errcode = '40001';
  end if;

  allowed :=
    (new.resolution_kind = 'operator_confirmed_effect'
      and (
        selected_case.case_kind = 'suppression_conflict'
        or (selected_case.case_kind in (
          'abandoned_claim', 'stale_delivery_status',
          'ambiguous_message_create'
        ) and selected_case.readback_state in ('matched', 'single_candidate'))
      ))
    or (new.resolution_kind = 'operator_confirmed_no_effect'
      and selected_case.case_kind in (
        'abandoned_claim', 'ambiguous_message_create'
      )
      and selected_case.readback_state = 'not_found')
    or (new.resolution_kind = 'operator_late_binding_applied'
      and selected_case.case_kind = 'unbound_inbound_event'
      and exists (
        select 1 from ss.responder_inbound_resolutions resolution
         where resolution.case_id = selected_case.id
      ))
    or (new.resolution_kind = 'operator_binding_retired'
      and selected_case.case_kind = 'ambiguous_number_binding')
    or (new.resolution_kind = 'operator_closed'
      and (
        selected_case.case_kind = 'unmatched_provider_event'
        or selected_case.readback_state = 'multiple_matches'
      ));

  if not allowed then
    raise exception 'resolution kind is not proved by retained case evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger provider_reconciliation_resolution_commands_guard
before insert or update or delete
on ss.provider_reconciliation_resolution_commands
for each row execute function
  ss.guard_provider_reconciliation_resolution_command_v1();

-- Tighten the original guard so naming an operator is insufficient: the
-- current service principal must be that operator, and an exact immutable
-- command must already exist in the same transaction.
create or replace function ss.guard_provider_reconciliation_case()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is not null
  then
    raise exception 'Provider reconciliation cases require global system authority'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'open'
      or new.revision <> 1
      or new.readback_state <> 'none'
      or new.case_digest <> ss.provider_reconciliation_case_digest(
        new.provider, new.case_kind,
        ss.provider_reconciliation_case_subject(new)
      )
    then
      raise exception 'Provider reconciliation cases must begin open and exact'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.id, new.provider, new.case_kind, new.case_digest,
    new.subject_operation_id, new.subject_inbound_event_id,
    new.subject_provider_message_id_digest,
    new.subject_phone_number_sid_digest, new.subject_operation_attempt,
    new.subject_lease_owner_digest, new.organization_id, new.project_id,
    new.evidence_digest, new.detected_by_worker_id,
    new.opened_at, new.created_at
  ) is distinct from row(
    old.id, old.provider, old.case_kind, old.case_digest,
    old.subject_operation_id, old.subject_inbound_event_id,
    old.subject_provider_message_id_digest,
    old.subject_phone_number_sid_digest, old.subject_operation_attempt,
    old.subject_lease_owner_digest, old.organization_id, old.project_id,
    old.evidence_digest, old.detected_by_worker_id,
    old.opened_at, old.created_at
  )
    or old.state <> 'open'
    or new.revision <> old.revision + 1
    or new.updated_at < old.updated_at
  then
    raise exception 'Provider reconciliation case identity is immutable'
      using errcode = '55000';
  end if;

  if new.state = 'open' then
    if old.readback_state <> 'none' or new.readback_state = 'none' then
      raise exception 'An open reconciliation case accepts exactly one readback record'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.readback_state, new.readback_evidence_digest,
    new.readback_matched_provider_message_id_digest,
    new.readback_match_count, new.readback_at
  ) is distinct from row(
    old.readback_state, old.readback_evidence_digest,
    old.readback_matched_provider_message_id_digest,
    old.readback_match_count, old.readback_at
  )
  then
    raise exception 'Resolution cannot rewrite readback evidence'
      using errcode = '55000';
  end if;

  if new.resolution_kind = 'self_healed' then
    if new.resolved_by_operator_user_id is not null then
      raise exception 'self-healing cannot impersonate an operator'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if ss.current_service_actor_user_id()
      is distinct from new.resolved_by_operator_user_id
    or not ss.service_operator_has_capability(
      new.resolved_by_operator_user_id,
      'service_management_manage', clock_timestamp()
    )
    or not exists (
      select 1
        from ss.provider_reconciliation_resolution_commands command
       where command.case_id = new.id
         and command.expected_case_revision = old.revision
         and command.operator_user_id = new.resolved_by_operator_user_id
         and command.resolution_kind = new.resolution_kind
         and command.evidence_digest = new.resolution_evidence_digest
         and command.resolved_at = new.resolved_at
    )
  then
    raise exception 'closure requires the exact append-only operator command'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create function ss.operator_manual_review_item_id_v1(
  selected_table text,
  selected_id text
)
returns uuid
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  with raw as (
    select overlay(overlay(
      md5('sitesourcery.operator-manual-review/v1:' ||
          selected_table || ':' || selected_id)
      placing '5' from 13 for 1) placing '8' from 17 for 1) as value
  )
  select (
    substring(value, 1, 8) || '-' || substring(value, 9, 4) || '-' ||
    substring(value, 13, 4) || '-' || substring(value, 17, 4) || '-' ||
    substring(value, 21, 12)
  )::uuid from raw
$$;

create function ss.operator_manual_review_queue_v1()
returns table(
  id uuid, source_table text, source_id text, source_revision bigint,
  source_digest ss.sha256_hex, source_state text, organization_id uuid,
  project_id uuid, item_kind text, severity text, status text,
  deadline_at timestamptz, repair_kind text, opened_at timestamptz,
  revision bigint, item_digest ss.sha256_hex, updated_at timestamptz
)
language plpgsql
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
    raise exception 'operator manual-review projection lacks exact authority'
      using errcode = '42501';
  end if;

  return query
  with sources as (
    select 'ss.responder_delivery_operations'::text as source_table,
      operation.id::text as source_id,
      greatest(operation.attempt_count, 1)::bigint as source_revision,
      operation.request_digest as source_digest, operation.state as source_state,
      operation.organization_id, operation.project_id,
      'responder_delivery_manual_review'::text as item_kind,
      'high'::text as severity, operation.manual_review_at as opened_at,
      operation.updated_at
    from ss.responder_delivery_operations operation
    where operation.state in ('manual_review', 'dead_letter')
    union all
    select 'ss.responder_inbound_followup_jobs', job.id::text,
      greatest(job.attempt_count, 1)::bigint,
      ss.service_json_digest(jsonb_build_object(
        'failureCode', job.failure_code, 'id', job.id,
        'schema', 'sitesourcery.responder-followup-review/v1',
        'state', job.state
      )), job.state, job.organization_id, job.project_id,
      'responder_followup_manual_review', 'high', job.manual_review_at,
      job.updated_at
    from ss.responder_inbound_followup_jobs job
    where job.state in ('manual_review', 'dead_letter')
    union all
    select 'ss.responder_private_material_cleanup_jobs', job.id::text,
      job.revision, job.source_envelope_digest, job.state,
      job.organization_id, job.project_id,
      'responder_cleanup_manual_review', 'critical', job.manual_review_at,
      job.updated_at
    from ss.responder_private_material_cleanup_jobs job
    where job.state = 'manual_review'
    union all
    select 'ss.lifecycle_jobs', job.id::text,
      greatest(job.attempt_count, 1)::bigint,
      ss.service_json_digest(jsonb_build_object(
        'failureCode', job.failure_code, 'id', job.id,
        'jobType', job.job_type,
        'schema', 'sitesourcery.project-lifecycle-review/v1',
        'state', job.state
      )), job.state, job.organization_id, job.project_id,
      'project_lifecycle_manual_review', 'high', job.manual_review_at,
      coalesce(job.manual_review_at, job.run_at)
    from ss.lifecycle_jobs job
    where job.state in ('manual_review', 'dead_letter')
    union all
    select 'ss.domain_lifecycle_worker_jobs', job.id::text,
      greatest(job.attempt_count, 1)::bigint,
      coalesce(job.result_digest, ss.service_json_digest(jsonb_build_object(
        'action', job.action, 'failureCode', job.failure_code, 'id', job.id,
        'schema', 'sitesourcery.domain-lifecycle-review/v1',
        'state', job.state
      ))), job.state, job.organization_id, job.project_id,
      'domain_lifecycle_manual_review', 'high', job.manual_review_at,
      job.updated_at
    from ss.domain_lifecycle_worker_jobs job
    where job.state in ('manual_review', 'dead_letter')
    union all
    select 'ss.care_lifecycle_worker_jobs', job.id::text,
      greatest(job.attempt_count, 1)::bigint,
      coalesce(job.result_digest, ss.service_json_digest(jsonb_build_object(
        'action', job.action, 'failureCode', job.failure_code, 'id', job.id,
        'schema', 'sitesourcery.care-lifecycle-review/v1',
        'state', job.state
      ))), job.state, job.organization_id, job.project_id,
      'care_lifecycle_manual_review', 'high', job.manual_review_at,
      job.updated_at
    from ss.care_lifecycle_worker_jobs job
    where job.state in ('manual_review', 'dead_letter')
  )
  select ss.operator_manual_review_item_id_v1(
      source.source_table, source.source_id
    ), source.source_table, source.source_id, source.source_revision,
    source.source_digest, source.source_state, source.organization_id,
    source.project_id, source.item_kind, source.severity, 'blocked'::text,
    null::timestamptz, null::text, source.opened_at,
    source.source_revision, source.source_digest, source.updated_at
  from sources source
  order by source.opened_at, source.source_table, source.source_id;
end
$$;

create function ss.operator_provider_reconciliation_case_v1(selected_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected ss.provider_reconciliation_cases%rowtype;
  allowed_resolutions jsonb;
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
    raise exception 'operator reconciliation projection lacks exact authority'
      using errcode = '42501';
  end if;

  select * into selected
    from ss.provider_reconciliation_cases reconciliation
   where reconciliation.id = selected_case_id;
  if not found then return null; end if;

  select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
    into allowed_resolutions
    from (values
      ('operator_confirmed_effect', selected.state = 'open' and (
        selected.case_kind = 'suppression_conflict'
        or (selected.case_kind in (
          'abandoned_claim', 'stale_delivery_status',
          'ambiguous_message_create'
        ) and selected.readback_state in ('matched', 'single_candidate'))
      )),
      ('operator_confirmed_no_effect', selected.state = 'open'
        and selected.case_kind in ('abandoned_claim', 'ambiguous_message_create')
        and selected.readback_state = 'not_found'),
      ('operator_late_binding_applied', selected.state = 'open'
        and selected.case_kind = 'unbound_inbound_event'
        and exists (select 1 from ss.responder_inbound_resolutions resolution
          where resolution.case_id = selected.id)),
      ('operator_binding_retired', selected.state = 'open'
        and selected.case_kind = 'ambiguous_number_binding'),
      ('operator_closed', selected.state = 'open' and (
        selected.case_kind = 'unmatched_provider_event'
        or selected.readback_state = 'multiple_matches'))
    ) option(value, allowed)
   where allowed;

  return jsonb_build_object(
    'schema', 'sitesourcery.operator-provider-reconciliation-case/v1',
    'id', selected.id, 'provider', selected.provider,
    'caseKind', selected.case_kind, 'caseDigest', selected.case_digest,
    'state', selected.state, 'organizationId', selected.organization_id,
    'projectId', selected.project_id,
    'evidenceDigest', selected.evidence_digest,
    'readbackState', selected.readback_state,
    'readbackEvidenceDigest', selected.readback_evidence_digest,
    'matchedProviderMessageIdDigest',
      selected.readback_matched_provider_message_id_digest,
    'readbackMatchCount', selected.readback_match_count,
    'readbackAt', selected.readback_at,
    'resolutionKind', selected.resolution_kind,
    'resolutionEvidenceDigest', selected.resolution_evidence_digest,
    'resolvedAt', selected.resolved_at,
    'openedAt', selected.opened_at, 'revision', selected.revision,
    'allowedResolutions', allowed_resolutions,
    'providerEffects', false, 'genericRepair', false
  );
end
$$;

alter table ss.provider_reconciliation_resolution_commands
  enable row level security;
alter table ss.provider_reconciliation_resolution_commands
  force row level security;
create policy provider_reconciliation_resolution_commands_system
on ss.provider_reconciliation_resolution_commands
for all using (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() is null
) with check (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() is null
);

revoke all on ss.provider_reconciliation_resolution_commands
from public, anon, authenticated, service_role;
grant select, insert on ss.provider_reconciliation_resolution_commands
to service_role;
revoke all on function
  ss.guard_provider_reconciliation_resolution_command_v1(),
  ss.guard_provider_reconciliation_case()
from public, anon, authenticated, service_role;
revoke all on function ss.operator_manual_review_item_id_v1(text, text)
from public, anon, authenticated;
grant execute on function ss.operator_manual_review_item_id_v1(text, text)
to service_role;
revoke all on function ss.operator_manual_review_queue_v1()
from public, anon, authenticated;
grant execute on function ss.operator_manual_review_queue_v1()
to service_role;
revoke all on function ss.operator_provider_reconciliation_case_v1(uuid)
from public, anon, authenticated;
grant execute on function ss.operator_provider_reconciliation_case_v1(uuid)
to service_role;

create function ss.operator_resolution_surfaces_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-fin-004u-operator-resolution-v1-digest-only-held'::text
$$;

revoke all on function ss.operator_resolution_surfaces_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.operator_resolution_surfaces_contract_v1()
to service_role;

commit;
