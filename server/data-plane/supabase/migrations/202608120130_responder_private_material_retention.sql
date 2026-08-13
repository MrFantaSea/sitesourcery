-- RESPONDER-PRIVATE-MATERIAL-RETENTION-01
begin;

do $$
begin
  if to_regprocedure('ss.hosted_responder_private_material_contract_v1()')
      is null
    or ss.hosted_responder_private_material_contract_v1() <>
      'canonical-responder-private-material-v1-operation-bound-aes-gcm'
    or to_regprocedure('ss.hosted_responder_twilio_inbound_contract_v1()')
      is null
    or ss.hosted_responder_twilio_inbound_contract_v1() <>
      'canonical-responder-twilio-inbound-v1-keyed-lookup-tenant-bound'
    or to_regprocedure(
      'ss.hosted_provider_reconciliation_contract_v1()'
    ) is null
    or ss.hosted_provider_reconciliation_contract_v1() <>
      'canonical-provider-reconciliation-v1-readback-evidence-bound'
  then
    raise exception
      'the exact private-material, inbound, and reconciliation contracts must precede RESPONDER-PRIVATE-MATERIAL-RETENTION-01'
      using errcode = '55000';
  end if;
end
$$;

-- A named operator may delay destruction for a legal obligation or an exact
-- bounded retention need. Holds retain digests and authority only; they never
-- contain or expose private material. Expired bounded holds stop blocking
-- automatically but remain immutable evidence until explicitly released.
create table ss.responder_private_material_holds (
  id uuid primary key,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  scope_kind text not null check (
    scope_kind in ('project', 'delivery_material', 'inbound_material')
  ),
  subject_id uuid not null,
  hold_kind text not null check (hold_kind in ('legal', 'retention')),
  evidence_digest ss.sha256_hex not null,
  state text not null check (state in ('active', 'released')),
  hold_until timestamptz,
  placed_by_operator_user_id uuid not null references auth.users(id),
  released_by_operator_user_id uuid references auth.users(id),
  release_evidence_digest ss.sha256_hex,
  placed_at timestamptz not null,
  released_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  check (created_at = placed_at),
  check (updated_at >= created_at),
  check (
    (hold_kind = 'legal' and hold_until is null)
    or (hold_kind = 'retention' and hold_until is not null
      and hold_until > placed_at)
  ),
  check (
    (state = 'active'
      and released_by_operator_user_id is null
      and release_evidence_digest is null
      and released_at is null)
    or (state = 'released'
      and released_by_operator_user_id is not null
      and release_evidence_digest is not null
      and released_at is not null
      and released_at >= placed_at)
  )
);

create unique index responder_private_material_one_active_hold
  on ss.responder_private_material_holds(
    organization_id, scope_kind, subject_id, hold_kind
  ) where state = 'active';
create index responder_private_material_holds_project
  on ss.responder_private_material_holds(
    organization_id, project_id, state, hold_until
  );

create function ss.guard_responder_private_material_hold()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_user uuid := ss.current_service_actor_user_id();
begin
  if tg_op = 'DELETE'
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or not ss.service_operator_has_capability(
      selected_user, 'service_management_manage', clock_timestamp()
    )
  then
    raise exception
      'Responder private-material hold requires exact operator authority'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat(
      'sitesourcery.responder-private-material.project:',
      new.organization_id::text, ':', new.project_id::text
    ), 0
  ));
  if new.scope_kind <> 'project' then
    perform pg_advisory_xact_lock(hashtextextended(
      concat(
        'sitesourcery.responder-private-material.subject:',
        new.organization_id::text, ':', new.scope_kind, ':',
        new.subject_id::text
      ), 0
    ));
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'active'
      or new.revision <> 1
      or new.placed_by_operator_user_id is distinct from selected_user
      or (
        new.scope_kind = 'project'
        and new.subject_id is distinct from new.project_id
      )
      or (
        new.scope_kind = 'delivery_material'
        and not exists (
          select 1 from ss.responder_private_delivery_materials material
           where material.operation_id = new.subject_id
             and material.organization_id = new.organization_id
             and material.project_id = new.project_id
        )
      )
      or (
        new.scope_kind = 'inbound_material'
        and not exists (
          select 1 from ss.responder_inbound_private_materials material
           where material.inbound_event_id = new.subject_id
             and material.organization_id = new.organization_id
             and material.project_id = new.project_id
        )
      )
    then
      raise exception 'Responder private-material hold is invalid'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state <> 'active'
    or new.state <> 'released'
    or new.revision <> old.revision + 1
    or new.released_by_operator_user_id is distinct from selected_user
    or row(
      new.id, new.organization_id, new.project_id, new.scope_kind,
      new.subject_id, new.hold_kind, new.evidence_digest, new.hold_until,
      new.placed_by_operator_user_id, new.placed_at, new.created_at
    ) is distinct from row(
      old.id, old.organization_id, old.project_id, old.scope_kind,
      old.subject_id, old.hold_kind, old.evidence_digest, old.hold_until,
      old.placed_by_operator_user_id, old.placed_at, old.created_at
    )
    or new.updated_at < old.updated_at
  then
    raise exception
      'Responder private-material hold release is the only transition'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger responder_private_material_holds_guard
before insert or update or delete on ss.responder_private_material_holds
for each row execute function ss.guard_responder_private_material_hold();

-- Eligibility is deliberately digest/lifecycle-only. It never selects,
-- returns, decrypts, or hashes nonce, authentication-tag, or ciphertext
-- columns. The result is re-evaluated under lock immediately before zeroing.
create function ss.responder_private_material_destroy_reason(
  selected_material_kind text,
  selected_subject_id uuid,
  selected_observed_at timestamptz
)
returns text
language plpgsql
stable
set search_path = pg_catalog, ss
as $$
declare
  selected record;
begin
  if selected_observed_at is null
    or selected_material_kind not in ('delivery_material', 'inbound_material')
  then
    raise exception 'Responder private-material eligibility input is invalid'
      using errcode = '22023';
  end if;

  if selected_material_kind = 'delivery_material' then
    select material.state as material_state, material.created_at,
           operation.state as operation_state,
           operation.provider_effects_authorized,
           operation.provider_accepted_at, operation.updated_at as operation_at,
           contact.state as contact_state,
           interaction.state as interaction_state,
           interaction.updated_at as interaction_at,
           project.lifecycle, project.retention_ends_at
      into selected
      from ss.responder_private_delivery_materials material
      join ss.responder_delivery_operations operation
        on operation.id = material.operation_id
       and operation.organization_id = material.organization_id
      join ss.responder_contact_authorities contact
        on contact.id = material.contact_authority_id
       and contact.organization_id = material.organization_id
      join ss.responder_interactions interaction
        on interaction.id = material.interaction_id
       and interaction.organization_id = material.organization_id
      join ss.projects project
        on project.id = material.project_id
       and project.organization_id = material.organization_id
     where material.operation_id = selected_subject_id;

    if not found or selected.material_state <> 'active' then return null; end if;
    if selected.lifecycle in ('deleting', 'deleted') then
      return 'account_deletion';
    end if;
    if (selected.contact_state in ('opted_out', 'revoked')
        or selected.interaction_state = 'opted_out')
      and not selected.provider_effects_authorized
      and selected.operation_state <> 'claimed'
    then
      return 'opt_out';
    end if;
    if selected.operation_state = 'cancelled' then return 'cancellation'; end if;
    if selected.lifecycle = 'cancelled'
      and selected.retention_ends_at is not null
      and selected.retention_ends_at <= selected_observed_at
      and not selected.provider_effects_authorized
    then
      return 'cancellation';
    end if;
    if selected.operation_state = 'accepted'
      and selected.provider_accepted_at is not null
      and selected.provider_accepted_at <=
        selected_observed_at - interval '24 hours'
    then
      return 'accepted_retention';
    end if;
    if selected.operation_state in ('manual_review', 'dead_letter')
      and exists (
        select 1 from ss.provider_reconciliation_cases reconciliation
         where reconciliation.subject_operation_id = selected_subject_id
           and reconciliation.state = 'resolved'
      )
      and not exists (
        select 1 from ss.provider_reconciliation_cases reconciliation
         where reconciliation.subject_operation_id = selected_subject_id
           and reconciliation.state = 'open'
      )
    then
      return 'manual_reconciliation_closed';
    end if;
    if selected.interaction_state = 'closed'
      and not selected.provider_effects_authorized
      and selected.operation_state not in ('manual_review', 'dead_letter')
      and selected.interaction_at <=
        selected_observed_at - interval '24 hours'
    then
      return 'accepted_retention';
    end if;
    return null;
  end if;

  select material.state as material_state, material.created_at,
         interaction.state as interaction_state,
         interaction.updated_at as interaction_at,
         project.lifecycle, project.retention_ends_at
    into selected
    from ss.responder_inbound_private_materials material
    join ss.responder_twilio_inbound_events inbound
      on inbound.id = material.inbound_event_id
     and inbound.organization_id = material.organization_id
     and inbound.project_id = material.project_id
    join ss.responder_provider_events core
      on core.id = inbound.core_provider_event_id
     and core.organization_id = material.organization_id
     and core.project_id = material.project_id
    join ss.responder_interactions interaction
      on interaction.id = core.interaction_id
     and interaction.organization_id = material.organization_id
    join ss.projects project
      on project.id = material.project_id
     and project.organization_id = material.organization_id
   where material.inbound_event_id = selected_subject_id;

  if not found or selected.material_state <> 'active' then return null; end if;
  if selected.lifecycle in ('deleting', 'deleted') then
    return 'account_deletion';
  end if;
  if selected.interaction_state = 'opted_out' then return 'opt_out'; end if;
  if selected.lifecycle = 'cancelled'
    and selected.retention_ends_at is not null
    and selected.retention_ends_at <= selected_observed_at
  then
    return 'cancellation';
  end if;
  if selected.interaction_state = 'closed'
    and selected.interaction_at <= selected_observed_at - interval '24 hours'
  then
    return 'accepted_retention';
  end if;
  if selected.created_at <= selected_observed_at - interval '30 days' then
    return 'accepted_retention';
  end if;
  return null;
end
$$;

-- Discovery and claiming are separate from destruction so a crashed worker
-- leaves a bounded, recoverable lease rather than an ambiguous mutation.
create table ss.responder_private_material_cleanup_jobs (
  id uuid primary key,
  material_kind text not null check (
    material_kind in ('delivery_material', 'inbound_material')
  ),
  subject_id uuid not null,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  source_envelope_digest ss.sha256_hex not null,
  discovered_reason text not null check (
    discovered_reason in (
      'accepted_retention', 'opt_out', 'cancellation',
      'account_deletion', 'manual_reconciliation_closed'
    )
  ),
  state text not null check (
    state in ('pending', 'claimed', 'succeeded', 'manual_review')
  ),
  attempt_count integer not null default 0 check (
    attempt_count between 0 and 100
  ),
  failure_count integer not null default 0 check (
    failure_count between 0 and 100
  ),
  available_at timestamptz not null,
  lease_owner text check (
    lease_owner is null or (
      char_length(lease_owner) between 8 and 200
      and lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    )
  ),
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  last_failure_code text check (
    last_failure_code is null
      or last_failure_code ~ '^[A-Z][A-Z0-9_]{0,127}$'
  ),
  final_destroy_reason text check (
    final_destroy_reason is null or final_destroy_reason in (
      'accepted_retention', 'opt_out', 'cancellation',
      'account_deletion', 'manual_reconciliation_closed'
    )
  ),
  receipt_digest ss.sha256_hex,
  destroyed_at timestamptz,
  manual_review_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  discovered_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (material_kind, subject_id),
  check (created_at = discovered_at),
  check (updated_at >= created_at),
  check (
    (state = 'pending'
      and lease_owner is null and lease_started_at is null
      and lease_expires_at is null and final_destroy_reason is null
      and receipt_digest is null and destroyed_at is null
      and manual_review_at is null)
    or (state = 'claimed'
      and attempt_count > 0
      and lease_owner is not null and lease_started_at is not null
      and lease_expires_at >= lease_started_at + interval '30 seconds'
      and lease_expires_at <= lease_started_at + interval '10 minutes'
      and final_destroy_reason is null
      and receipt_digest is null and destroyed_at is null
      and manual_review_at is null)
    or (state = 'succeeded'
      and lease_owner is null and lease_started_at is null
      and lease_expires_at is null and final_destroy_reason is not null
      and receipt_digest is not null and destroyed_at is not null
      and manual_review_at is null)
    or (state = 'manual_review'
      and failure_count = 100
      and lease_owner is null and lease_started_at is null
      and lease_expires_at is null and final_destroy_reason is null
      and receipt_digest is null and destroyed_at is null
      and last_failure_code is not null and manual_review_at is not null)
  )
);

create index responder_private_material_cleanup_available
  on ss.responder_private_material_cleanup_jobs(available_at, discovered_at, id)
  where state = 'pending';
create index responder_private_material_cleanup_expired_lease
  on ss.responder_private_material_cleanup_jobs(lease_expires_at, id)
  where state = 'claimed';

create function ss.guard_responder_private_material_cleanup_job()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_org uuid := ss.current_service_actor_org_id();
begin
  if tg_op = 'DELETE'
    or ss.current_service_actor_kind() <> 'system'
    or (selected_org is not null
      and selected_org is distinct from new.organization_id)
  then
    raise exception
      'Responder private-material cleanup jobs require system authority'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if selected_org is not null
      or new.state <> 'pending'
      or new.revision <> 1
      or new.attempt_count <> 0
      or new.failure_count <> 0
    then
      raise exception 'Responder private-material cleanup job is invalid'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.id, new.material_kind, new.subject_id, new.organization_id,
    new.project_id, new.source_envelope_digest, new.discovered_reason,
    new.discovered_at, new.created_at
  ) is distinct from row(
    old.id, old.material_kind, old.subject_id, old.organization_id,
    old.project_id, old.source_envelope_digest, old.discovered_reason,
    old.discovered_at, old.created_at
  )
    or new.revision <> old.revision + 1
    or new.updated_at < old.updated_at
  then
    raise exception 'Responder private-material cleanup identity is immutable'
      using errcode = '55000';
  end if;

  if old.state = 'pending' and new.state = 'claimed' then
    if selected_org is not null
      or new.attempt_count <> old.attempt_count + 1
      or new.failure_count <> old.failure_count
      or new.available_at is distinct from old.available_at
      or new.last_failure_code is distinct from old.last_failure_code
    then
      raise exception 'Responder private-material cleanup claim is invalid'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state = 'claimed' and new.state = 'pending' then
    if new.attempt_count <> old.attempt_count
      or new.failure_count <> old.failure_count + 1
      or new.last_failure_code is null
      or new.available_at < new.updated_at
    then
      raise exception 'Responder private-material cleanup release is invalid'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state = 'claimed' and new.state = 'manual_review' then
    if selected_org is not null
      or new.attempt_count <> old.attempt_count
      or old.failure_count <> 99
      or new.failure_count <> 100
      or new.last_failure_code is null
      or new.manual_review_at is distinct from new.updated_at
    then
      raise exception
        'Responder private-material cleanup review escalation is invalid'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state = 'claimed' and new.state = 'succeeded' then
    if selected_org is distinct from new.organization_id
      or new.attempt_count <> old.attempt_count
      or new.failure_count <> old.failure_count
      or new.available_at is distinct from old.available_at
      or new.last_failure_code is distinct from old.last_failure_code
      or new.destroyed_at < old.lease_started_at
    then
      raise exception 'Responder private-material cleanup completion is invalid'
        using errcode = '23514';
    end if;
    return new;
  end if;

  raise exception 'Responder private-material cleanup transition is invalid'
    using errcode = '55000';
end
$$;

create trigger responder_private_material_cleanup_jobs_guard
before insert or update or delete on ss.responder_private_material_cleanup_jobs
for each row execute function ss.guard_responder_private_material_cleanup_job();

-- The receipt preserves only identity/evidence digests and the honest horizon
-- during which an older encrypted backup may still contain pre-destruction
-- bytes. A restored backup must replay these receipts before serving data.
create table ss.responder_private_material_destruction_receipts (
  id uuid primary key,
  cleanup_job_id uuid not null unique
    references ss.responder_private_material_cleanup_jobs(id),
  material_kind text not null check (
    material_kind in ('delivery_material', 'inbound_material')
  ),
  subject_id uuid not null,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  source_envelope_digest ss.sha256_hex not null,
  destroy_reason text not null check (
    destroy_reason in (
      'accepted_retention', 'opt_out', 'cancellation',
      'account_deletion', 'manual_reconciliation_closed'
    )
  ),
  worker_id_digest ss.sha256_hex not null,
  primary_ciphertext_zeroed boolean not null check (primary_ciphertext_zeroed),
  backup_retention_until timestamptz not null,
  receipt_digest ss.sha256_hex not null unique,
  destroyed_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  check (created_at = destroyed_at),
  check (backup_retention_until = destroyed_at + interval '30 days')
);

create function ss.responder_private_material_destruction_receipt_digest(
  selected_cleanup_job_id uuid,
  selected_material_kind text,
  selected_subject_id uuid,
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_source_envelope_digest ss.sha256_hex,
  selected_destroy_reason text,
  selected_worker_id_digest ss.sha256_hex,
  selected_destroyed_at timestamptz
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'backupRetentionUntil',
      selected_destroyed_at + interval '30 days',
    'cleanupJobId', selected_cleanup_job_id,
    'destroyReason', selected_destroy_reason,
    'destroyedAt', selected_destroyed_at,
    'materialKind', selected_material_kind,
    'organizationId', selected_organization_id,
    'primaryCiphertextZeroed', true,
    'projectId', selected_project_id,
    'schema', 'sitesourcery.responder-private-material-destruction/v1',
    'sourceEnvelopeDigest', selected_source_envelope_digest,
    'subjectId', selected_subject_id,
    'workerIdDigest', selected_worker_id_digest
  ))
$$;

create function ss.guard_responder_private_material_destruction_receipt()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or new.receipt_digest <>
      ss.responder_private_material_destruction_receipt_digest(
        new.cleanup_job_id, new.material_kind, new.subject_id,
        new.organization_id, new.project_id, new.source_envelope_digest,
        new.destroy_reason, new.worker_id_digest, new.destroyed_at
      )
  then
    raise exception
      'Responder private-material destruction receipt is immutable exact evidence'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger responder_private_material_destruction_receipts_guard
before insert or update or delete
on ss.responder_private_material_destruction_receipts
for each row execute function
  ss.guard_responder_private_material_destruction_receipt();

alter table ss.responder_private_material_holds enable row level security;
alter table ss.responder_private_material_holds force row level security;
alter table ss.responder_private_material_cleanup_jobs enable row level security;
alter table ss.responder_private_material_cleanup_jobs force row level security;
alter table ss.responder_private_material_destruction_receipts
  enable row level security;
alter table ss.responder_private_material_destruction_receipts
  force row level security;

revoke all on
  ss.responder_private_material_holds,
  ss.responder_private_material_cleanup_jobs,
  ss.responder_private_material_destruction_receipts
from public, anon, authenticated, service_role;
grant select, insert, update on ss.responder_private_material_holds
to service_role;
grant select, insert, update on ss.responder_private_material_cleanup_jobs
to service_role;
grant select, insert on ss.responder_private_material_destruction_receipts
to service_role;

revoke all on function ss.responder_private_material_destroy_reason(
  text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function ss.responder_private_material_destroy_reason(
  text, uuid, timestamptz
) to service_role;
revoke all on function
  ss.responder_private_material_destruction_receipt_digest(
    uuid, text, uuid, uuid, uuid, ss.sha256_hex, text,
    ss.sha256_hex, timestamptz
  ) from public, anon, authenticated;
grant execute on function
  ss.responder_private_material_destruction_receipt_digest(
    uuid, text, uuid, uuid, uuid, ss.sha256_hex, text,
    ss.sha256_hex, timestamptz
  ) to service_role;
revoke all on function ss.guard_responder_private_material_hold()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_private_material_cleanup_job()
from public, anon, authenticated, service_role;
revoke all on function
  ss.guard_responder_private_material_destruction_receipt()
from public, anon, authenticated, service_role;

create function ss.hosted_responder_private_material_retention_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-responder-private-material-retention-v1-held-leased-zeroing'
$$;

revoke all on function
  ss.hosted_responder_private_material_retention_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function
  ss.hosted_responder_private_material_retention_contract_v1()
to service_role;

commit;
