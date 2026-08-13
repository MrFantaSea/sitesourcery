-- FIN-004T Responder Voice and inbound-follow-up closure
-- Adds encrypted per-binding dial targets and a held, lease-fenced follow-up
-- queue. It does not approve a call, message, provider, or production effect.

begin;

do $$
begin
  if to_regprocedure(
       'ss.hosted_responder_twilio_inbound_contract_v1()'
     ) is null
    or to_regprocedure(
       'ss.hosted_responder_fulfillment_queue_contract_v1()'
     ) is null
    or to_regprocedure(
       'ss.hosted_responder_private_material_contract_v1()'
     ) is null
  then
    raise exception 'FIN-004T Voice closure requires the canonical Responder inbound, queue, and private-material contracts'
      using errcode = '55000';
  end if;
end
$$;

-- A Voice target is private material belonging to one exact, active provider
-- number binding. Only ciphertext and digest evidence cross this boundary.
alter table ss.responder_twilio_inbound_events
  add column number_binding_id uuid,
  add foreign key (organization_id, number_binding_id)
    references ss.responder_provider_number_bindings(organization_id, id),
  add constraint responder_inbound_binding_tenant_shape check (
    number_binding_id is null or organization_id is not null
  );

create table ss.responder_voice_dial_targets (
  id uuid primary key default extensions.gen_random_uuid(),
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  request_digest ss.sha256_hex not null,
  organization_id uuid not null,
  project_id uuid not null,
  number_binding_id uuid not null,
  key_version text not null check (
    char_length(key_version) between 2 and 64
    and key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$'
  ),
  nonce bytea not null check (octet_length(nonce) = 12),
  authentication_tag bytea not null check (
    octet_length(authentication_tag) = 16
  ),
  ciphertext bytea not null check (
    octet_length(ciphertext) between 16 and 512
  ),
  envelope_digest ss.sha256_hex not null,
  state text not null check (state in ('active', 'retired')),
  provision_evidence_digest ss.sha256_hex not null,
  provisioned_by_user_id uuid not null references auth.users(id),
  provisioned_at timestamptz not null,
  retired_by_user_id uuid references auth.users(id),
  retire_evidence_digest ss.sha256_hex,
  retired_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, number_binding_id)
    references ss.responder_provider_number_bindings(organization_id, id),
  unique (organization_id, id),
  check (created_at = provisioned_at),
  check (updated_at >= created_at),
  check (
    (state = 'active' and retired_by_user_id is null
      and retire_evidence_digest is null and retired_at is null)
    or (state = 'retired' and retired_by_user_id is not null
      and retire_evidence_digest is not null and retired_at is not null
      and retired_at >= provisioned_at)
  )
);

create unique index responder_one_active_voice_dial_target
  on ss.responder_voice_dial_targets(number_binding_id)
  where state = 'active';

create function ss.responder_voice_dial_target_envelope_digest(
  selected_id uuid,
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_number_binding_id uuid,
  selected_key_version text,
  selected_nonce bytea,
  selected_authentication_tag bytea,
  selected_ciphertext bytea
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'authenticationTag', encode(selected_authentication_tag, 'base64'),
    'ciphertext', encode(selected_ciphertext, 'base64'),
    'id', selected_id,
    'keyVersion', selected_key_version,
    'nonce', encode(selected_nonce, 'base64'),
    'numberBindingId', selected_number_binding_id,
    'organizationId', selected_organization_id,
    'projectId', selected_project_id,
    'schema', 'sitesourcery.responder-voice-dial-target-envelope/v1'
  ))
$$;

create function ss.guard_responder_voice_dial_target_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_user uuid := ss.current_service_actor_user_id();
  selected_org uuid := ss.current_service_actor_org_id();
begin
  if tg_op = 'DELETE'
    or ss.current_service_actor_kind() <> 'operator'
    or selected_org is distinct from new.organization_id
    or not ss.service_operator_has_capability(
      selected_user, 'service_management_manage', clock_timestamp()
    )
  then
    raise exception 'Responder Voice target requires exact operator authority'
      using errcode = '42501';
  end if;

  if new.envelope_digest <>
    ss.responder_voice_dial_target_envelope_digest(
      new.id, new.organization_id, new.project_id, new.number_binding_id,
      new.key_version, new.nonce, new.authentication_tag, new.ciphertext
    )
  then
    raise exception 'Responder Voice target envelope conflicts'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'active' or new.revision <> 1
      or new.provisioned_by_user_id is distinct from selected_user
      or not exists (
        select 1
          from ss.responder_provider_number_bindings binding
         where binding.id = new.number_binding_id
           and binding.organization_id = new.organization_id
           and binding.project_id = new.project_id
           and binding.provider = 'twilio'
           and binding.state = 'active'
      )
    then
      raise exception 'Responder Voice target must begin active on one active binding'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state <> 'active' or new.state <> 'retired'
    or new.revision <> old.revision + 1
    or new.retired_by_user_id is distinct from selected_user
    or row(
      new.id, new.command_id, new.request_digest, new.organization_id,
      new.project_id, new.number_binding_id, new.key_version, new.nonce,
      new.authentication_tag, new.ciphertext, new.envelope_digest,
      new.provision_evidence_digest, new.provisioned_by_user_id,
      new.provisioned_at, new.created_at
    ) is distinct from row(
      old.id, old.command_id, old.request_digest, old.organization_id,
      old.project_id, old.number_binding_id, old.key_version, old.nonce,
      old.authentication_tag, old.ciphertext, old.envelope_digest,
      old.provision_evidence_digest, old.provisioned_by_user_id,
      old.provisioned_at, old.created_at
    )
  then
    raise exception 'Responder Voice target retirement is the only transition'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger responder_voice_dial_targets_guard
before insert or update or delete on ss.responder_voice_dial_targets
for each row execute function ss.guard_responder_voice_dial_target_v1();

-- Every applied missed-call event receives one durable follow-up work item.
-- Eligibility is decided again under a lease immediately before material is
-- created; missing or revoked consent stops at manual review.
create table ss.responder_inbound_followup_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  inbound_event_id uuid not null unique,
  core_provider_event_id uuid not null,
  interaction_id uuid not null,
  contact_authority_id uuid,
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  delivery_operation_id uuid not null unique,
  message_kind text not null check (message_kind = 'missed_call_ack'),
  state text not null default 'scheduled' check (
    state in (
      'scheduled', 'running', 'retry_wait', 'succeeded',
      'manual_review', 'dead_letter'
    )
  ),
  run_at timestamptz not null,
  attempt_count integer not null default 0 check (
    attempt_count between 0 and 5
  ),
  maximum_attempts integer not null default 5 check (maximum_attempts = 5),
  lease_fence bigint not null default 0 check (
    lease_fence between 0 and 9007199254740991
  ),
  leased_by text,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  failure_code text check (
    failure_code is null or (
      char_length(failure_code) between 1 and 128
      and failure_code ~ '^[A-Z][A-Z0-9_]*$'
    )
  ),
  result_digest ss.sha256_hex,
  completed_at timestamptz,
  manual_review_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (inbound_event_id)
    references ss.responder_twilio_inbound_events(id),
  foreign key (core_provider_event_id)
    references ss.responder_provider_events(id),
  foreign key (organization_id, interaction_id)
    references ss.responder_interactions(organization_id, id),
  foreign key (organization_id, contact_authority_id)
    references ss.responder_contact_authorities(organization_id, id),
  unique (organization_id, id),
  check (updated_at >= created_at),
  check (
    (state = 'running' and leased_by is not null and leased_at is not null
      and lease_expires_at > leased_at
      and lease_expires_at <= leased_at + interval '10 minutes'
      and lease_fence > 0)
    or (state <> 'running' and leased_by is null and leased_at is null
      and lease_expires_at is null)
  ),
  check (
    (state in ('manual_review', 'dead_letter')) =
      (manual_review_at is not null)
  ),
  check ((state = 'succeeded') = (completed_at is not null))
);

create index responder_inbound_followup_jobs_ready
  on ss.responder_inbound_followup_jobs(run_at, lease_expires_at, id)
  where state in ('scheduled', 'retry_wait', 'running');

create function ss.enqueue_responder_inbound_followup_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss, extensions
as $$
declare
  core_event ss.responder_provider_events%rowtype;
  selected_contact uuid;
begin
  if new.provider <> 'twilio' or new.channel <> 'voice'
    or new.event_kind <> 'dial_result' or new.state <> 'applied'
    or new.core_provider_event_id is null
  then
    return new;
  end if;

  select * into strict core_event
    from ss.responder_provider_events event
   where event.id = new.core_provider_event_id
     and event.organization_id = new.organization_id
     and event.project_id = new.project_id
     and event.provider = 'twilio'
     and event.event_kind = 'missed_call';
  select interaction.contact_authority_id into selected_contact
    from ss.responder_interactions interaction
   where interaction.id = core_event.interaction_id
     and interaction.organization_id = new.organization_id;

  insert into ss.responder_inbound_followup_jobs (
    organization_id, project_id, inbound_event_id,
    core_provider_event_id, interaction_id, contact_authority_id,
    command_id, delivery_operation_id, message_kind, run_at,
    created_at, updated_at
  ) values (
    new.organization_id, new.project_id, new.id,
    core_event.id, core_event.interaction_id, selected_contact,
    'responder-followup:' || new.id::text, extensions.gen_random_uuid(),
    'missed_call_ack', new.received_at, new.received_at, new.received_at
  ) on conflict (inbound_event_id) do nothing;
  return new;
end
$$;

create trigger responder_twilio_inbound_enqueue_followup
after insert on ss.responder_twilio_inbound_events
for each row execute function ss.enqueue_responder_inbound_followup_v1();

-- Preserve the original actor-created command contract and add one narrowly
-- derived system path: a currently leased missed-call follow-up job whose
-- exact immutable authority matches the inserted command.
create or replace function ss.guard_responder_message_command()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_kind text := ss.current_service_actor_kind();
  selected_user uuid := ss.current_service_actor_user_id();
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or new.state <> 'held'
    or new.provider_effects_authorized
    or new.delivery_claimed
  then
    raise exception 'Responder message commands are immutable and wholly held'
      using errcode = '42501';
  end if;

  if selected_kind = 'system' then
    if not exists (
      select 1
        from ss.responder_inbound_followup_jobs job
       where job.organization_id = new.organization_id
         and job.project_id = new.project_id
         and job.interaction_id = new.interaction_id
         and job.contact_authority_id = new.contact_authority_id
         and job.command_id = new.command_id
         and job.message_kind = new.message_kind
         and job.state = 'running'
         and job.lease_expires_at > new.requested_at
    )
    then
      raise exception 'System Responder message lacks a leased follow-up job'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if selected_kind not in ('customer', 'operator')
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
    raise exception 'Responder message commands are immutable and wholly held'
      using errcode = '42501';
  end if;
  return new;
end
$$;

-- Insert behavior is otherwise identical to the queue contract. System
-- authority is admitted only for the exact claimed follow-up operation.
create or replace function ss.guard_responder_delivery_operation()
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
  system_followup boolean := false;
begin
  if tg_op = 'DELETE' then
    raise exception 'Responder delivery operations are durable'
      using errcode = '55000';
  end if;

  select * into strict parent from ss.responder_message_commands command
   where command.command_id = new.command_id;
  select * into strict control from ss.responder_runtime_controls runtime
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
    system_followup := selected_kind = 'system' and exists (
      select 1 from ss.responder_inbound_followup_jobs job
       where job.organization_id = new.organization_id
         and job.project_id = new.project_id
         and job.interaction_id = new.interaction_id
         and job.contact_authority_id = new.contact_authority_id
         and job.command_id = new.command_id
         and job.delivery_operation_id = new.id
         and job.message_kind = new.message_kind
         and job.state = 'running'
         and job.lease_expires_at > new.created_at
    );
    if selected_org is distinct from new.organization_id
      or (selected_kind not in ('customer', 'operator') and not system_followup)
      or row(
        new.organization_id, new.project_id, new.interaction_id,
        new.contact_authority_id, new.message_kind, new.content_digest
      ) is distinct from row(
        parent.organization_id, parent.project_id, parent.interaction_id,
        parent.contact_authority_id, parent.message_kind,
        parent.content_digest
      )
      or new.route_digest <> authority_route_digest
      or new.idempotency_key <> ('responder-delivery:' || parent.request_digest)
      or new.request_digest <> ss.responder_delivery_operation_digest(
        new.command_id, new.organization_id, new.project_id,
        new.interaction_id, new.contact_authority_id, new.message_kind,
        new.route_digest, new.content_digest, new.idempotency_key
      )
      or new.attempt_count <> 0 or new.maximum_attempts <> 5
      or (selected_kind = 'customer' and not exists (
        select 1 from ss.organization_memberships membership
         where membership.organization_id = new.organization_id
           and membership.user_id = selected_user
           and membership.state = 'active'
      ))
      or (selected_kind = 'operator' and not ss.service_operator_has_capability(
        selected_user, 'service_management_manage', clock_timestamp()
      ))
    then
      raise exception 'Responder delivery reservation lacks exact authority'
        using errcode = '42501';
    end if;

    if authority_state <> 'active' or interaction_state <> 'open' then
      if new.state <> 'cancelled' or new.provider_effects_authorized
        or new.failure_code <> 'RESPONDER_DELIVERY_NOT_ELIGIBLE'
      then
        raise exception 'Ineligible Responder delivery must be cancelled'
          using errcode = '23514';
      end if;
    elsif control.state = 'approved_live' and not control.global_kill_engaged then
      if new.state <> 'queued' or not new.provider_effects_authorized
        or new.available_at is null
      then
        raise exception 'Released Responder delivery must be queued exactly'
          using errcode = '23514';
      end if;
    elsif new.state <> 'held' or new.provider_effects_authorized then
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

alter table ss.responder_voice_dial_targets enable row level security;
alter table ss.responder_voice_dial_targets force row level security;
alter table ss.responder_inbound_followup_jobs enable row level security;
alter table ss.responder_inbound_followup_jobs force row level security;

create policy responder_voice_dial_targets_operator
on ss.responder_voice_dial_targets
for all using (
  ss.current_service_actor_kind() in ('operator', 'system')
  and ss.current_service_actor_org_id() = organization_id
) with check (
  ss.current_service_actor_kind() in ('operator', 'system')
  and ss.current_service_actor_org_id() = organization_id
);
create policy responder_inbound_followup_jobs_system
on ss.responder_inbound_followup_jobs
for all using (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() = organization_id
) with check (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() = organization_id
);

revoke all on ss.responder_voice_dial_targets,
  ss.responder_inbound_followup_jobs
from public, anon, authenticated, service_role;
grant select, insert, update on ss.responder_voice_dial_targets
to service_role;
grant select, insert, update on ss.responder_inbound_followup_jobs
to service_role;

revoke all on function
  ss.responder_voice_dial_target_envelope_digest(
    uuid, uuid, uuid, uuid, text, bytea, bytea, bytea
  ),
  ss.guard_responder_voice_dial_target_v1(),
  ss.enqueue_responder_inbound_followup_v1()
from public, anon, authenticated;
grant execute on function
  ss.responder_voice_dial_target_envelope_digest(
    uuid, uuid, uuid, uuid, text, bytea, bytea, bytea
  ),
  ss.guard_responder_voice_dial_target_v1(),
  ss.enqueue_responder_inbound_followup_v1()
to service_role;

create function ss.responder_voice_followup_closure_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-fin-004t-responder-voice-target-followup-v1-held'::text
$$;

revoke all on function ss.responder_voice_followup_closure_contract_v1()
from public, anon, authenticated;
grant execute on function ss.responder_voice_followup_closure_contract_v1()
to service_role;

commit;
