-- RESPONDER-FULFILLMENT-QUEUE-01
begin;

do $$
begin
  if to_regprocedure('ss.hosted_responder_core_contract_v1()') is null
    or ss.hosted_responder_core_contract_v1() <>
      'canonical-responder-core-v1-provider-neutral-held'
  then
    raise exception 'RESPONDER-CORE-01 must be applied first'
      using errcode = '55000';
  end if;
end
$$;

-- The core remains held by default. This additive evolution records the exact
-- owner release evidence that a future provider composition must read back.
-- No migration statement lifts the hold.
alter table ss.responder_runtime_controls
  drop constraint responder_runtime_controls_global_kill_engaged_check,
  drop constraint responder_runtime_controls_state_check;

alter table ss.responder_runtime_controls
  add column release_evidence_digest ss.sha256_hex,
  add column released_at timestamptz,
  add column released_by_operator_user_id uuid references auth.users(id),
  add constraint responder_runtime_controls_state_v2_check check (
    state in ('held', 'approved_live')
  ),
  add constraint responder_runtime_controls_release_v2_check check (
    (state = 'held'
      and global_kill_engaged
      and release_evidence_digest is null
      and released_at is null
      and released_by_operator_user_id is null)
    or (state = 'approved_live'
      and release_evidence_digest is not null
      and released_at is not null
      and released_by_operator_user_id is not null
      and released_at >= created_at)
  );

create or replace function ss.guard_responder_runtime_control()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_kind text := ss.current_service_actor_kind();
  selected_user uuid := ss.current_service_actor_user_id();
  selected_org uuid := ss.current_service_actor_org_id();
begin
  if tg_op = 'DELETE'
    or new.organization_id is distinct from selected_org
  then
    raise exception 'Responder runtime control lacks exact authority'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if selected_kind not in ('customer', 'operator', 'system')
      or not new.global_kill_engaged
      or new.state <> 'held'
      or new.revision <> 1
      or new.release_evidence_digest is not null
      or new.released_at is not null
      or new.released_by_operator_user_id is not null
      or (
        selected_kind = 'customer'
        and not exists (
          select 1 from ss.organization_memberships membership
           where membership.organization_id = new.organization_id
             and membership.user_id = selected_user
             and membership.state = 'active'
        )
      )
      or (
        selected_kind = 'operator'
        and not ss.service_operator_has_capability(
          selected_user, 'service_management_manage', clock_timestamp()
        )
      )
    then
      raise exception 'Responder runtime control must begin held'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if selected_kind <> 'operator'
    or not ss.service_operator_has_capability(
      selected_user, 'service_management_manage', clock_timestamp()
    )
    or row(new.organization_id, new.created_at) is distinct from
      row(old.organization_id, old.created_at)
    or new.revision <> old.revision + 1
    or new.updated_at < old.updated_at
  then
    raise exception 'Responder runtime control update lacks owner authority'
      using errcode = '42501';
  end if;

  if old.state = 'held' then
    if new.state <> 'approved_live'
      or new.global_kill_engaged
      or new.release_evidence_digest is null
      or new.released_at is null
      or new.released_by_operator_user_id is distinct from selected_user
    then
      raise exception 'Responder release requires exact operator evidence'
        using errcode = '23514';
    end if;
  elsif old.state = 'approved_live' then
    if new.state <> 'approved_live'
      or row(
        new.release_evidence_digest,
        new.released_at,
        new.released_by_operator_user_id
      ) is distinct from row(
        old.release_evidence_digest,
        old.released_at,
        old.released_by_operator_user_id
      )
    then
      raise exception 'Responder release evidence is immutable'
        using errcode = '55000';
    end if;
  else
    raise exception 'Responder runtime control predecessor is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create table ss.responder_delivery_operations (
  id uuid primary key,
  command_id text not null unique
    references ss.responder_message_commands(command_id),
  request_digest ss.sha256_hex not null,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  interaction_id uuid not null,
  contact_authority_id uuid not null,
  message_kind text not null check (
    message_kind in ('missed_call_ack', 'human_handoff_ack')
  ),
  route_digest ss.sha256_hex not null,
  content_digest ss.sha256_hex not null,
  idempotency_key text not null unique check (
    char_length(idempotency_key) between 8 and 200
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  state text not null check (
    state in (
      'held', 'queued', 'claimed', 'retry_wait', 'accepted',
      'manual_review', 'dead_letter', 'cancelled'
    )
  ),
  provider_effects_authorized boolean not null default false,
  attempt_count integer not null default 0 check (
    attempt_count between 0 and 5
  ),
  maximum_attempts integer not null default 5 check (
    maximum_attempts = 5
  ),
  available_at timestamptz,
  lease_owner text check (
    lease_owner is null
    or (
      char_length(lease_owner) between 8 and 200
      and lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    )
  ),
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  last_worker_id text check (
    last_worker_id is null
    or (
      char_length(last_worker_id) between 8 and 200
      and last_worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    )
  ),
  failure_code text check (
    failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{0,127}$'
  ),
  provider text check (
    provider is null or provider ~ '^[a-z][a-z0-9_-]{2,63}$'
  ),
  provider_receipt_digest ss.sha256_hex,
  provider_accepted_at timestamptz,
  manual_review_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, interaction_id)
    references ss.responder_interactions(organization_id, id),
  foreign key (organization_id, contact_authority_id)
    references ss.responder_contact_authorities(organization_id, id),
  unique (organization_id, id),
  check (updated_at >= created_at),
  check (
    (state = 'held'
      and not provider_effects_authorized
      and attempt_count = 0
      and available_at is null
      and lease_owner is null and lease_started_at is null
      and lease_expires_at is null and last_worker_id is null
      and failure_code is null and provider is null
      and provider_receipt_digest is null and provider_accepted_at is null
      and manual_review_at is null)
    or (state = 'queued'
      and provider_effects_authorized
      and attempt_count = 0
      and available_at is not null
      and lease_owner is null and lease_started_at is null
      and lease_expires_at is null and last_worker_id is null
      and failure_code is null and provider is null
      and provider_receipt_digest is null and provider_accepted_at is null
      and manual_review_at is null)
    or (state = 'claimed'
      and provider_effects_authorized
      and attempt_count between 1 and maximum_attempts
      and available_at is null
      and lease_owner is not null and lease_started_at is not null
      and lease_expires_at >= lease_started_at + interval '30 seconds'
      and lease_expires_at <= lease_started_at + interval '10 minutes'
      and last_worker_id = lease_owner
      and failure_code is null and provider is null
      and provider_receipt_digest is null and provider_accepted_at is null
      and manual_review_at is null)
    or (state = 'retry_wait'
      and provider_effects_authorized
      and attempt_count between 1 and maximum_attempts - 1
      and available_at is not null
      and lease_owner is null and lease_started_at is null
      and lease_expires_at is null and last_worker_id is not null
      and failure_code is not null and provider is null
      and provider_receipt_digest is null and provider_accepted_at is null
      and manual_review_at is null)
    or (state = 'accepted'
      and provider_effects_authorized
      and attempt_count between 1 and maximum_attempts
      and available_at is null
      and lease_owner is null and lease_started_at is null
      and lease_expires_at is null and last_worker_id is not null
      and failure_code is null and provider is not null
      and provider_receipt_digest is not null
      and provider_accepted_at is not null
      and manual_review_at is null)
    or (state in ('manual_review', 'dead_letter')
      and not provider_effects_authorized
      and attempt_count between 1 and maximum_attempts
      and available_at is null
      and lease_owner is null and lease_started_at is null
      and lease_expires_at is null and last_worker_id is not null
      and failure_code is not null and provider is null
      and provider_receipt_digest is null and provider_accepted_at is null
      and manual_review_at is not null)
    or (state = 'cancelled'
      and not provider_effects_authorized
      and available_at is null
      and lease_owner is null and lease_started_at is null
      and lease_expires_at is null
      and failure_code is not null and provider is null
      and provider_receipt_digest is null and provider_accepted_at is null
      and manual_review_at is null)
  )
);

create index responder_delivery_operations_available
  on ss.responder_delivery_operations(available_at, created_at, id)
  where state in ('queued', 'retry_wait');
create index responder_delivery_operations_review
  on ss.responder_delivery_operations(manual_review_at, id)
  where state in ('manual_review', 'dead_letter');

create table ss.responder_delivery_operation_events (
  id uuid primary key,
  operation_id uuid not null,
  organization_id uuid not null,
  state text not null check (
    state in (
      'held', 'queued', 'claimed', 'retry_wait', 'accepted',
      'manual_review', 'dead_letter', 'cancelled'
    )
  ),
  attempt_count integer not null check (attempt_count between 0 and 5),
  worker_id text,
  event_digest ss.sha256_hex not null,
  occurred_at timestamptz not null,
  foreign key (organization_id, operation_id)
    references ss.responder_delivery_operations(organization_id, id),
  check (
    worker_id is null
    or (
      char_length(worker_id) between 8 and 200
      and worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    )
  )
);

create index responder_delivery_operation_events_history
  on ss.responder_delivery_operation_events(operation_id, occurred_at, id);

create function ss.responder_delivery_operation_digest(
  selected_command_id text,
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_interaction_id uuid,
  selected_contact_authority_id uuid,
  selected_message_kind text,
  selected_route_digest ss.sha256_hex,
  selected_content_digest ss.sha256_hex,
  selected_idempotency_key text
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'commandId', selected_command_id,
    'contactAuthorityId', selected_contact_authority_id,
    'contentDigest', selected_content_digest,
    'idempotencyKey', selected_idempotency_key,
    'interactionId', selected_interaction_id,
    'messageKind', selected_message_kind,
    'organizationId', selected_organization_id,
    'projectId', selected_project_id,
    'routeDigest', selected_route_digest,
    'schema', 'sitesourcery.responder-delivery-operation/v1'
  ))
$$;

create function ss.responder_delivery_event_digest(
  selected_operation_id uuid,
  selected_state text,
  selected_attempt_count integer,
  selected_worker_id text,
  selected_occurred_at timestamptz
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'attemptCount', selected_attempt_count,
    'occurredAt', selected_occurred_at,
    'operationId', selected_operation_id,
    'schema', 'sitesourcery.responder-delivery-operation-event/v1',
    'state', selected_state,
    'workerId', selected_worker_id
  ))
$$;

create function ss.guard_responder_delivery_operation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_kind text := ss.current_service_actor_kind();
  selected_user uuid := ss.current_service_actor_user_id();
  selected_org uuid := ss.current_service_actor_org_id();
  parent ss.responder_message_commands%rowtype;
  control ss.responder_runtime_controls%rowtype;
  authority_state text;
  authority_route_digest ss.sha256_hex;
  interaction_state text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Responder delivery operations are durable'
      using errcode = '55000';
  end if;

  select * into strict parent
    from ss.responder_message_commands command
   where command.command_id = new.command_id;
  select * into strict control
    from ss.responder_runtime_controls runtime
   where runtime.organization_id = new.organization_id;
  select authority.state, authority.route_digest
    into strict authority_state, authority_route_digest
    from ss.responder_contact_authorities authority
   where authority.id = new.contact_authority_id
     and authority.organization_id = new.organization_id;
  select interaction.state into strict interaction_state
    from ss.responder_interactions interaction
   where interaction.id = new.interaction_id
     and interaction.organization_id = new.organization_id;

  if tg_op = 'INSERT' then
    if selected_kind not in ('customer', 'operator')
      or selected_org is distinct from new.organization_id
      or row(
        new.organization_id, new.project_id, new.interaction_id,
        new.contact_authority_id, new.message_kind, new.content_digest
      ) is distinct from row(
        parent.organization_id, parent.project_id, parent.interaction_id,
        parent.contact_authority_id, parent.message_kind,
        parent.content_digest
      )
      or new.route_digest <> authority_route_digest
      or new.idempotency_key <>
        ('responder-delivery:' || parent.request_digest)
      or new.request_digest <> ss.responder_delivery_operation_digest(
        new.command_id, new.organization_id, new.project_id,
        new.interaction_id, new.contact_authority_id, new.message_kind,
        new.route_digest, new.content_digest, new.idempotency_key
      )
      or new.attempt_count <> 0
      or new.maximum_attempts <> 5
      or (
        selected_kind = 'customer'
        and not exists (
          select 1 from ss.organization_memberships membership
           where membership.organization_id = new.organization_id
             and membership.user_id = selected_user
             and membership.state = 'active'
        )
      )
      or (
        selected_kind = 'operator'
        and not ss.service_operator_has_capability(
          selected_user, 'service_management_manage', clock_timestamp()
        )
      )
    then
      raise exception 'Responder delivery reservation lacks exact authority'
        using errcode = '42501';
    end if;

    if authority_state <> 'active'
      or interaction_state <> 'open'
    then
      if new.state <> 'cancelled'
        or new.provider_effects_authorized
        or new.failure_code <> 'RESPONDER_DELIVERY_NOT_ELIGIBLE'
      then
        raise exception 'Ineligible Responder delivery must be cancelled'
          using errcode = '23514';
      end if;
    elsif control.state = 'approved_live'
      and not control.global_kill_engaged
    then
      if new.state <> 'queued'
        or not new.provider_effects_authorized
        or new.available_at is null
      then
        raise exception 'Released Responder delivery must be queued exactly'
          using errcode = '23514';
      end if;
    elsif new.state <> 'held'
      or new.provider_effects_authorized
    then
      raise exception 'Unreleased Responder delivery must remain held'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if selected_kind <> 'system'
    or row(
      new.id, new.command_id, new.request_digest, new.organization_id,
      new.project_id, new.interaction_id, new.contact_authority_id,
      new.message_kind, new.route_digest, new.content_digest,
      new.idempotency_key, new.maximum_attempts, new.created_at
    ) is distinct from row(
      old.id, old.command_id, old.request_digest, old.organization_id,
      old.project_id, old.interaction_id, old.contact_authority_id,
      old.message_kind, old.route_digest, old.content_digest,
      old.idempotency_key, old.maximum_attempts, old.created_at
    )
    or new.updated_at < old.updated_at
  then
    raise exception 'Responder delivery transition lacks system authority'
      using errcode = '42501';
  end if;

  if new.state = 'claimed' then
    if old.state not in ('queued', 'retry_wait')
      or old.available_at > new.lease_started_at
      or control.state <> 'approved_live'
      or control.global_kill_engaged
      or authority_state <> 'active'
      or interaction_state <> 'open'
      or new.attempt_count <> old.attempt_count + 1
      or new.lease_owner is null
      or new.last_worker_id <> new.lease_owner
    then
      raise exception 'Responder delivery claim is not eligible'
        using errcode = '23514';
    end if;
  elsif new.state = 'accepted' then
    if old.state <> 'claimed'
      or new.attempt_count <> old.attempt_count
      or new.last_worker_id <> old.lease_owner
      or new.provider is null
      or new.provider_receipt_digest is null
      or new.provider_accepted_at is null
    then
      raise exception 'Responder provider acceptance is invalid'
        using errcode = '23514';
    end if;
  elsif new.state = 'retry_wait' then
    if old.state <> 'claimed'
      or old.attempt_count >= old.maximum_attempts
      or new.attempt_count <> old.attempt_count
      or new.last_worker_id <> old.lease_owner
      or new.failure_code is null
      or new.available_at <= new.updated_at
    then
      raise exception 'Responder retry transition is invalid'
        using errcode = '23514';
    end if;
  elsif new.state in ('manual_review', 'dead_letter') then
    if old.state <> 'claimed'
      or new.attempt_count <> old.attempt_count
      or new.last_worker_id <> old.lease_owner
      or new.failure_code is null
      or new.manual_review_at is null
    then
      raise exception 'Responder review transition is invalid'
        using errcode = '23514';
    end if;
  elsif new.state = 'cancelled' then
    if old.state not in ('queued', 'retry_wait', 'claimed')
      or new.failure_code is null
    then
      raise exception 'Responder cancellation transition is invalid'
        using errcode = '23514';
    end if;
  else
    raise exception 'Responder delivery transition is not allowed'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger responder_delivery_operations_guard
before insert or update or delete on ss.responder_delivery_operations
for each row execute function ss.guard_responder_delivery_operation();

create function ss.record_responder_delivery_operation_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_worker text := coalesce(new.lease_owner, new.last_worker_id);
begin
  insert into ss.responder_delivery_operation_events (
    id, operation_id, organization_id, state, attempt_count,
    worker_id, event_digest, occurred_at
  ) values (
    gen_random_uuid(), new.id, new.organization_id, new.state,
    new.attempt_count, selected_worker,
    ss.responder_delivery_event_digest(
      new.id, new.state, new.attempt_count, selected_worker, new.updated_at
    ),
    new.updated_at
  );
  return new;
end
$$;

create trigger responder_delivery_operations_event
after insert or update on ss.responder_delivery_operations
for each row execute function ss.record_responder_delivery_operation_event();

create function ss.guard_responder_delivery_operation_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op <> 'INSERT'
    or new.event_digest <> ss.responder_delivery_event_digest(
      new.operation_id, new.state, new.attempt_count,
      new.worker_id, new.occurred_at
    )
  then
    raise exception 'Responder delivery events are immutable exact evidence'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger responder_delivery_operation_events_guard
before insert or update or delete on ss.responder_delivery_operation_events
for each row execute function ss.guard_responder_delivery_operation_event();

alter table ss.responder_delivery_operations enable row level security;
alter table ss.responder_delivery_operations force row level security;
alter table ss.responder_delivery_operation_events enable row level security;
alter table ss.responder_delivery_operation_events force row level security;

revoke all on
  ss.responder_delivery_operations,
  ss.responder_delivery_operation_events
from public, anon, authenticated, service_role;
grant select, insert, update on ss.responder_delivery_operations
to service_role;
grant select, insert on ss.responder_delivery_operation_events
to service_role;
grant update on ss.responder_runtime_controls to service_role;

revoke all on function ss.responder_delivery_operation_digest(
  text, uuid, uuid, uuid, uuid, text, ss.sha256_hex,
  ss.sha256_hex, text
) from public, anon, authenticated;
grant execute on function ss.responder_delivery_operation_digest(
  text, uuid, uuid, uuid, uuid, text, ss.sha256_hex,
  ss.sha256_hex, text
) to service_role;

revoke all on function ss.responder_delivery_event_digest(
  uuid, text, integer, text, timestamptz
) from public, anon, authenticated;
grant execute on function ss.responder_delivery_event_digest(
  uuid, text, integer, text, timestamptz
) to service_role;

revoke all on function ss.guard_responder_delivery_operation()
from public, anon, authenticated, service_role;
revoke all on function ss.record_responder_delivery_operation_event()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_delivery_operation_event()
from public, anon, authenticated, service_role;

create function ss.hosted_responder_fulfillment_queue_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-responder-fulfillment-queue-v1-held-default'
$$;

revoke all on function ss.hosted_responder_fulfillment_queue_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_responder_fulfillment_queue_contract_v1()
to service_role;

commit;
