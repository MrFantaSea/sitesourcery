-- RESPONDER-TWILIO-DELIVERY-EVENTS-01
begin;

do $$
begin
  if to_regprocedure(
      'ss.hosted_responder_fulfillment_queue_contract_v1()'
    ) is null
    or ss.hosted_responder_fulfillment_queue_contract_v1() <>
      'canonical-responder-fulfillment-queue-v1-held-default'
    or to_regprocedure(
      'ss.hosted_responder_private_material_contract_v1()'
    ) is null
    or ss.hosted_responder_private_material_contract_v1() <>
      'canonical-responder-private-material-v1-operation-bound-aes-gcm'
  then
    raise exception
      'the exact Responder queue and private-material contracts must precede RESPONDER-TWILIO-DELIVERY-EVENTS-01'
      using errcode = '55000';
  end if;
end
$$;

-- The provider resource identifier remains private. Only its one-way digest
-- crosses into the durable delivery and callback boundary.
alter table ss.responder_delivery_operations
  add column provider_message_id_digest ss.sha256_hex,
  add column provider_mapping_recorded_at timestamptz,
  add constraint responder_delivery_provider_mapping_check check (
    (provider_message_id_digest is null
      and provider_mapping_recorded_at is null)
    or (state = 'accepted'
      and provider = 'twilio'
      and provider_message_id_digest is not null
      and provider_mapping_recorded_at is not null
      and provider_mapping_recorded_at = provider_accepted_at)
  );

create unique index responder_delivery_provider_message
  on ss.responder_delivery_operations(provider, provider_message_id_digest)
  where provider_message_id_digest is not null;

create table ss.responder_delivery_provider_events (
  id uuid primary key,
  provider text not null check (provider = 'twilio'),
  provider_event_digest ss.sha256_hex not null unique,
  provider_message_id_digest ss.sha256_hex not null,
  account_sid_digest ss.sha256_hex not null,
  message_status text not null check (
    message_status in (
      'queued', 'sending', 'sent', 'delivered',
      'undelivered', 'failed', 'canceled'
    )
  ),
  error_code_digest ss.sha256_hex,
  signature_verification_digest ss.sha256_hex not null,
  payload_digest ss.sha256_hex not null,
  received_at timestamptz not null,
  operation_id uuid,
  organization_id uuid,
  event_state text not null check (
    event_state in ('pending', 'applied', 'stale', 'conflict')
  ),
  reconciled_at timestamptz,
  created_at timestamptz not null,
  foreign key (organization_id, operation_id)
    references ss.responder_delivery_operations(organization_id, id),
  check (created_at = received_at),
  check (
    (event_state = 'pending'
      and operation_id is null
      and organization_id is null
      and reconciled_at is null)
    or (event_state in ('applied', 'stale', 'conflict')
      and operation_id is not null
      and organization_id is not null
      and reconciled_at is not null
      and reconciled_at >= received_at)
  )
);

create index responder_delivery_provider_events_pending
  on ss.responder_delivery_provider_events(
    provider_message_id_digest, received_at, id
  ) where event_state = 'pending';
create index responder_delivery_provider_events_operation
  on ss.responder_delivery_provider_events(
    operation_id, received_at, id
  ) where operation_id is not null;

create table ss.responder_delivery_provider_statuses (
  operation_id uuid primary key,
  organization_id uuid not null,
  provider text not null check (provider = 'twilio'),
  provider_message_id_digest ss.sha256_hex not null unique,
  current_status text not null check (
    current_status in (
      'accepted', 'queued', 'sending', 'sent', 'delivered',
      'undelivered', 'failed', 'canceled'
    )
  ),
  terminal boolean not null,
  attention_required boolean not null default false,
  current_provider_event_id uuid
    references ss.responder_delivery_provider_events(id),
  accepted_at timestamptz not null,
  provider_status_received_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, operation_id)
    references ss.responder_delivery_operations(organization_id, id),
  check (created_at = accepted_at),
  check (updated_at >= created_at),
  check (
    terminal = (current_status in (
      'delivered', 'undelivered', 'failed', 'canceled'
    ))
  ),
  check (
    (current_status = 'accepted'
      and current_provider_event_id is null
      and provider_status_received_at is null)
    or (current_status <> 'accepted'
      and current_provider_event_id is not null
      and provider_status_received_at is not null)
  )
);

create index responder_delivery_provider_statuses_attention
  on ss.responder_delivery_provider_statuses(updated_at, operation_id)
  where attention_required;

create function ss.responder_delivery_provider_event_digest(
  selected_provider_message_id_digest ss.sha256_hex,
  selected_account_sid_digest ss.sha256_hex,
  selected_message_status text,
  selected_error_code_digest ss.sha256_hex,
  selected_signature_verification_digest ss.sha256_hex,
  selected_payload_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  -- Twilio status callbacks have no separate provider event identifier. The
  -- exact authenticated raw form bytes are therefore the stable event
  -- identity. The remaining digests are independently constrained columns.
  select selected_payload_digest
$$;

create function ss.responder_delivery_status_rank(selected_status text)
returns integer
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case selected_status
    when 'accepted' then 0
    when 'queued' then 10
    when 'sending' then 20
    when 'sent' then 30
    when 'delivered' then 40
    when 'undelivered' then 40
    when 'failed' then 40
    when 'canceled' then 40
    else -1
  end
$$;

create function ss.guard_responder_delivery_provider_mapping()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'INSERT' then
    if new.provider_message_id_digest is not null
      or new.provider_mapping_recorded_at is not null
    then
      raise exception 'Responder provider mapping cannot precede acceptance'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is not null
  then
    raise exception 'Responder provider mapping requires system authority'
      using errcode = '42501';
  end if;

  if old.state = 'claimed' and new.state = 'accepted' then
    if new.provider <> 'twilio'
      or new.provider_message_id_digest is null
      or new.provider_mapping_recorded_at is distinct from
        new.provider_accepted_at
    then
      raise exception 'Responder acceptance requires exact provider mapping'
        using errcode = '23514';
    end if;
  elsif row(
    new.provider_message_id_digest,
    new.provider_mapping_recorded_at
  ) is distinct from row(
    old.provider_message_id_digest,
    old.provider_mapping_recorded_at
  ) then
    raise exception 'Responder provider mapping is immutable'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger responder_delivery_provider_mapping_guard
before insert or update or delete on ss.responder_delivery_operations
for each row execute function ss.guard_responder_delivery_provider_mapping();

create function ss.guard_responder_delivery_provider_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is not null
  then
    raise exception 'Responder provider event requires system authority'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.event_state <> 'pending'
      or new.operation_id is not null
      or new.organization_id is not null
      or new.reconciled_at is not null
      or new.provider_event_digest <>
        ss.responder_delivery_provider_event_digest(
          new.provider_message_id_digest,
          new.account_sid_digest,
          new.message_status,
          new.error_code_digest,
          new.signature_verification_digest,
          new.payload_digest
        )
    then
      raise exception 'Responder provider event must begin pending and exact'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.event_state <> 'pending'
    or new.event_state not in ('applied', 'stale', 'conflict')
    or row(
      new.id, new.provider, new.provider_event_digest,
      new.provider_message_id_digest, new.account_sid_digest,
      new.message_status, new.error_code_digest,
      new.signature_verification_digest, new.payload_digest,
      new.received_at, new.created_at
    ) is distinct from row(
      old.id, old.provider, old.provider_event_digest,
      old.provider_message_id_digest, old.account_sid_digest,
      old.message_status, old.error_code_digest,
      old.signature_verification_digest, old.payload_digest,
      old.received_at, old.created_at
    )
    or not exists (
      select 1
        from ss.responder_delivery_operations operation
       where operation.id = new.operation_id
         and operation.organization_id = new.organization_id
         and operation.state = 'accepted'
         and operation.provider = 'twilio'
         and operation.provider_message_id_digest =
           new.provider_message_id_digest
    )
  then
    raise exception 'Responder provider reconciliation is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger responder_delivery_provider_events_guard
before insert or update or delete on ss.responder_delivery_provider_events
for each row execute function ss.guard_responder_delivery_provider_event();

create function ss.guard_responder_delivery_provider_status()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is not null
  then
    raise exception 'Responder provider status requires system authority'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.current_status <> 'accepted'
      or new.terminal
      or new.attention_required
      or new.current_provider_event_id is not null
      or new.provider_status_received_at is not null
      or not exists (
        select 1
          from ss.responder_delivery_operations operation
         where operation.id = new.operation_id
           and operation.organization_id = new.organization_id
           and operation.state = 'accepted'
           and operation.provider = 'twilio'
           and operation.provider_message_id_digest =
             new.provider_message_id_digest
      )
    then
      raise exception 'Responder provider status must begin at acceptance'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.operation_id, new.organization_id, new.provider,
    new.provider_message_id_digest, new.accepted_at, new.created_at
  ) is distinct from row(
    old.operation_id, old.organization_id, old.provider,
    old.provider_message_id_digest, old.accepted_at, old.created_at
  )
    or new.updated_at < old.updated_at
    or (old.attention_required and not new.attention_required)
    or (old.terminal and new.current_status <> old.current_status)
    or (
      not old.terminal
      and ss.responder_delivery_status_rank(new.current_status) <
        ss.responder_delivery_status_rank(old.current_status)
    )
  then
    raise exception 'Responder provider status transition is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger responder_delivery_provider_statuses_guard
before insert or update or delete on ss.responder_delivery_provider_statuses
for each row execute function ss.guard_responder_delivery_provider_status();

create function ss.reconcile_responder_delivery_provider_events(
  selected_provider_message_id_digest ss.sha256_hex
)
returns void
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  operation_row ss.responder_delivery_operations%rowtype;
  projection_row ss.responder_delivery_provider_statuses%rowtype;
  event_row ss.responder_delivery_provider_events%rowtype;
  selected_event_state text;
begin
  select * into operation_row
    from ss.responder_delivery_operations operation
   where operation.state = 'accepted'
     and operation.provider = 'twilio'
     and operation.provider_message_id_digest =
       selected_provider_message_id_digest
   for update;
  if not found then return; end if;

  insert into ss.responder_delivery_provider_statuses (
    operation_id, organization_id, provider,
    provider_message_id_digest, current_status, terminal,
    attention_required, current_provider_event_id,
    accepted_at, provider_status_received_at, created_at, updated_at
  ) values (
    operation_row.id, operation_row.organization_id, 'twilio',
    operation_row.provider_message_id_digest, 'accepted', false,
    false, null, operation_row.provider_accepted_at, null,
    operation_row.provider_accepted_at, operation_row.provider_accepted_at
  ) on conflict (operation_id) do nothing;

  for event_row in
    select *
      from ss.responder_delivery_provider_events event
     where event.provider_message_id_digest =
       selected_provider_message_id_digest
       and event.event_state = 'pending'
     order by event.received_at, event.id
     for update
  loop
    select * into strict projection_row
      from ss.responder_delivery_provider_statuses projection
     where projection.operation_id = operation_row.id
     for update;

    if projection_row.terminal then
      if event_row.message_status = projection_row.current_status then
        selected_event_state := 'applied';
      elsif event_row.message_status in (
        'delivered', 'undelivered', 'failed', 'canceled'
      ) then
        selected_event_state := 'conflict';
        update ss.responder_delivery_provider_statuses
           set attention_required = true,
               updated_at = greatest(updated_at, event_row.received_at)
         where operation_id = operation_row.id;
      else
        selected_event_state := 'stale';
      end if;
    elsif ss.responder_delivery_status_rank(event_row.message_status) <
      ss.responder_delivery_status_rank(projection_row.current_status)
    then
      selected_event_state := 'stale';
    else
      selected_event_state := 'applied';
      update ss.responder_delivery_provider_statuses
         set current_status = event_row.message_status,
             terminal = event_row.message_status in (
               'delivered', 'undelivered', 'failed', 'canceled'
             ),
             current_provider_event_id = event_row.id,
             provider_status_received_at = event_row.received_at,
             updated_at = greatest(updated_at, event_row.received_at)
       where operation_id = operation_row.id;
    end if;

    update ss.responder_delivery_provider_events
       set operation_id = operation_row.id,
           organization_id = operation_row.organization_id,
           event_state = selected_event_state,
           reconciled_at = greatest(
             event_row.received_at,
             operation_row.provider_accepted_at
           )
     where id = event_row.id and event_state = 'pending';
  end loop;
end
$$;

create function ss.reconcile_responder_delivery_provider_event_after_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  perform ss.reconcile_responder_delivery_provider_events(
    new.provider_message_id_digest
  );
  return new;
end
$$;

create trigger responder_delivery_provider_event_reconcile
after insert on ss.responder_delivery_provider_events
for each row execute function
  ss.reconcile_responder_delivery_provider_event_after_insert();

create function ss.reconcile_responder_delivery_provider_mapping_after_update()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if old.provider_message_id_digest is null
    and new.provider_message_id_digest is not null
  then
    perform ss.reconcile_responder_delivery_provider_events(
      new.provider_message_id_digest
    );
  end if;
  return new;
end
$$;

create trigger responder_delivery_provider_mapping_reconcile
after update on ss.responder_delivery_operations
for each row execute function
  ss.reconcile_responder_delivery_provider_mapping_after_update();

alter table ss.responder_delivery_provider_events enable row level security;
alter table ss.responder_delivery_provider_events force row level security;
alter table ss.responder_delivery_provider_statuses enable row level security;
alter table ss.responder_delivery_provider_statuses force row level security;

revoke all on
  ss.responder_delivery_provider_events,
  ss.responder_delivery_provider_statuses
from public, anon, authenticated, service_role;
grant select, insert, update on ss.responder_delivery_provider_events
to service_role;
grant select, insert, update on ss.responder_delivery_provider_statuses
to service_role;

revoke all on function ss.responder_delivery_provider_event_digest(
  ss.sha256_hex, ss.sha256_hex, text, ss.sha256_hex,
  ss.sha256_hex, ss.sha256_hex
) from public, anon, authenticated;
grant execute on function ss.responder_delivery_provider_event_digest(
  ss.sha256_hex, ss.sha256_hex, text, ss.sha256_hex,
  ss.sha256_hex, ss.sha256_hex
) to service_role;
revoke all on function ss.responder_delivery_status_rank(text)
from public, anon, authenticated;
grant execute on function ss.responder_delivery_status_rank(text)
to service_role;

revoke all on function ss.guard_responder_delivery_provider_mapping()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_delivery_provider_event()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_delivery_provider_status()
from public, anon, authenticated, service_role;
revoke all on function ss.reconcile_responder_delivery_provider_events(
  ss.sha256_hex
) from public, anon, authenticated;
grant execute on function ss.reconcile_responder_delivery_provider_events(
  ss.sha256_hex
) to service_role;
revoke all on function
  ss.reconcile_responder_delivery_provider_event_after_insert()
from public, anon, authenticated, service_role;
revoke all on function
  ss.reconcile_responder_delivery_provider_mapping_after_update()
from public, anon, authenticated, service_role;

create function ss.hosted_responder_twilio_delivery_events_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-responder-twilio-delivery-events-v1-digest-only-race-safe'
$$;

revoke all on function
  ss.hosted_responder_twilio_delivery_events_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function
  ss.hosted_responder_twilio_delivery_events_contract_v1()
to service_role;

commit;
