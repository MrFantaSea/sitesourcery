begin;

do $$
begin
  if to_regprocedure(
      'ss.direct_custom_reversal_normalization_contract_v1()'
    ) is null
    or ss.direct_custom_reversal_normalization_contract_v1() <>
      'canonical-direct-custom-reversal-normalization-v1-held'
    or to_regprocedure(
      'ss.service_operator_has_capability(uuid,text,timestamp with time zone)'
    ) is null
    or to_regclass('ss.organization_memberships') is null
    or to_regclass('ss.projects') is null
  then
    raise exception
      'the exact K identity, project, and operator foundations must precede RESPONDER-CORE-01'
      using errcode = '55000';
  end if;
end
$$;

-- This provider-neutral authority deliberately stores no raw contact,
-- correspondence, audio, credential, pricing, or payment facts.
-- Every external value is an opaque SHA-256/HMAC digest. The only accepted
-- provider is the deterministic fake adapter and every outbound command is
-- permanently held with provider_effects_authorized=false.
create table ss.responder_runtime_controls (
  organization_id uuid primary key references ss.organizations(id),
  global_kill_engaged boolean not null default true
    check (global_kill_engaged),
  state text not null default 'held' check (state = 'held'),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (updated_at >= created_at)
);

create table ss.responder_contact_authorities (
  id uuid primary key,
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  request_digest ss.sha256_hex not null,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  route_kind text not null check (route_kind = 'sms'),
  route_digest ss.sha256_hex not null,
  purpose text not null check (purpose = 'missed_call_response'),
  consent_basis text not null check (
    consent_basis in (
      'inbound_call', 'inbound_message', 'explicit_service_request'
    )
  ),
  consent_evidence_digest ss.sha256_hex not null,
  consented_at timestamptz not null,
  recorded_at timestamptz not null,
  state text not null check (state in ('active', 'opted_out', 'revoked')),
  opted_out_at timestamptz,
  opt_out_evidence_digest ss.sha256_hex,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  check (recorded_at >= consented_at),
  check (created_at = recorded_at),
  check (updated_at >= created_at),
  check (
    (state = 'active' and opted_out_at is null
      and opt_out_evidence_digest is null)
    or (state in ('opted_out', 'revoked') and opted_out_at is not null
      and opt_out_evidence_digest is not null)
  )
);

create unique index responder_one_active_contact_route
  on ss.responder_contact_authorities(
    organization_id, project_id, route_digest, purpose
  ) where state = 'active';

create table ss.responder_interactions (
  id uuid primary key,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  contact_authority_id uuid,
  route_digest ss.sha256_hex not null,
  source_kind text not null check (
    source_kind in ('missed_call', 'message_received')
  ),
  state text not null check (
    state in ('open', 'handoff_required', 'opted_out', 'closed')
  ),
  handoff_reason text check (
    handoff_reason is null or handoff_reason in (
      'missing_authority', 'customer_request', 'uncertain_intent',
      'urgent', 'operator_review'
    )
  ),
  opened_at timestamptz not null,
  last_event_at timestamptz not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, contact_authority_id)
    references ss.responder_contact_authorities(organization_id, id),
  unique (organization_id, id),
  check (last_event_at >= opened_at),
  check (updated_at >= created_at),
  check (
    (state = 'handoff_required' and handoff_reason is not null)
    or (state <> 'handoff_required' and handoff_reason is null)
  )
);

create index responder_interactions_account
  on ss.responder_interactions(organization_id, last_event_at desc, id);
create index responder_interactions_handoff
  on ss.responder_interactions(last_event_at, id)
  where state in ('handoff_required', 'opted_out');

create table ss.responder_provider_events (
  id uuid primary key,
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  request_digest ss.sha256_hex not null,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  interaction_id uuid not null,
  provider text not null check (provider = 'fake'),
  provider_event_id_digest ss.sha256_hex not null,
  route_digest ss.sha256_hex not null,
  event_kind text not null check (
    event_kind in ('missed_call', 'message_received')
  ),
  message_intent text not null check (
    message_intent in ('not_applicable', 'message', 'stop', 'handoff')
  ),
  payload_digest ss.sha256_hex not null,
  signature_verification_digest ss.sha256_hex not null,
  evidence_digest ss.sha256_hex not null,
  state text not null check (state = 'applied'),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, interaction_id)
    references ss.responder_interactions(organization_id, id),
  unique (provider, provider_event_id_digest),
  check (created_at = recorded_at),
  check (recorded_at >= occurred_at),
  check (
    (event_kind = 'missed_call' and message_intent = 'not_applicable')
    or (event_kind = 'message_received' and message_intent <> 'not_applicable')
  )
);

create table ss.responder_message_commands (
  id uuid primary key,
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  request_digest ss.sha256_hex not null,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  interaction_id uuid not null,
  contact_authority_id uuid not null,
  message_kind text not null check (
    message_kind in ('missed_call_ack', 'human_handoff_ack')
  ),
  content_digest ss.sha256_hex not null,
  state text not null check (state = 'held'),
  held_reason text not null check (
    held_reason in (
      'global_kill', 'production_hold', 'opted_out', 'human_handoff'
    )
  ),
  provider_effects_authorized boolean not null default false
    check (not provider_effects_authorized),
  delivery_claimed boolean not null default false check (not delivery_claimed),
  requested_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, interaction_id)
    references ss.responder_interactions(organization_id, id),
  foreign key (organization_id, contact_authority_id)
    references ss.responder_contact_authorities(organization_id, id),
  check (created_at = requested_at)
);

create table ss.responder_control_commands (
  id uuid primary key,
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  request_digest ss.sha256_hex not null,
  command_kind text not null check (
    command_kind in ('human_handoff', 'global_kill')
  ),
  organization_id uuid not null references ss.organizations(id),
  project_id uuid,
  interaction_id uuid,
  actor_kind text not null check (actor_kind in ('customer', 'operator')),
  actor_user_id uuid not null references auth.users(id),
  evidence_digest ss.sha256_hex not null,
  recorded_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, interaction_id)
    references ss.responder_interactions(organization_id, id),
  check (created_at = recorded_at),
  check (
    (command_kind = 'global_kill' and actor_kind = 'operator'
      and project_id is null and interaction_id is null)
    or (command_kind = 'human_handoff'
      and project_id is not null and interaction_id is not null)
  )
);

create function ss.guard_responder_runtime_control()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_kind text := ss.current_service_actor_kind();
  selected_user uuid := ss.current_service_actor_user_id();
  selected_org uuid := ss.current_service_actor_org_id();
begin
  if tg_op <> 'INSERT'
    or new.organization_id is distinct from selected_org
    or not new.global_kill_engaged
    or new.state <> 'held'
    or selected_kind not in ('customer', 'operator', 'system')
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
    raise exception 'Responder runtime control is held without exact authority'
      using errcode = '42501';
  end if;
  if new.revision <> 1 then
    raise exception 'Responder runtime control insert is invalid'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger responder_runtime_controls_guard
before insert or update or delete on ss.responder_runtime_controls
for each row execute function ss.guard_responder_runtime_control();

create function ss.guard_responder_contact_authority()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_kind text := ss.current_service_actor_kind();
  selected_user uuid := ss.current_service_actor_user_id();
  selected_org uuid := ss.current_service_actor_org_id();
begin
  if tg_op = 'DELETE' then
    raise exception 'Responder contact authority is durable'
      using errcode = '55000';
  end if;
  if new.organization_id is distinct from selected_org
    or selected_kind not in ('customer', 'operator', 'system')
    or (
      selected_kind = 'customer'
      and selected_user is distinct from new.customer_user_id
    )
    or (
      selected_kind = 'operator'
      and not ss.service_operator_has_capability(
        selected_user, 'service_management_manage', clock_timestamp()
      )
    )
  then
    raise exception 'Responder contact authority lacks exact tenant authority'
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if selected_kind = 'system' or new.state <> 'active' or new.revision <> 1
    then
      raise exception 'Responder consent must be explicit customer or operator authority'
        using errcode = '42501';
    end if;
  elsif selected_kind <> 'system'
    or row(
      new.id, new.command_id, new.request_digest, new.organization_id,
      new.project_id, new.customer_user_id, new.route_kind, new.route_digest,
      new.purpose, new.consent_basis, new.consent_evidence_digest,
      new.consented_at, new.recorded_at, new.created_at
    ) is distinct from row(
      old.id, old.command_id, old.request_digest, old.organization_id,
      old.project_id, old.customer_user_id, old.route_kind, old.route_digest,
      old.purpose, old.consent_basis, old.consent_evidence_digest,
      old.consented_at, old.recorded_at, old.created_at
    )
    or old.state <> 'active'
    or new.state not in ('opted_out', 'revoked')
    or new.revision <> old.revision + 1
  then
    raise exception 'Responder opt-out is the only mutable contact transition'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger responder_contact_authorities_guard
before insert or update or delete on ss.responder_contact_authorities
for each row execute function ss.guard_responder_contact_authority();

create function ss.guard_responder_interaction()
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
    or selected_kind not in ('customer', 'operator', 'system')
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
    raise exception 'Responder interaction lacks exact tenant authority'
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if selected_kind <> 'system' or new.revision <> 1 then
      raise exception 'Responder interaction must derive from verified evidence'
        using errcode = '42501';
    end if;
  elsif row(
      new.id, new.organization_id, new.project_id, new.contact_authority_id,
      new.route_digest, new.source_kind, new.opened_at, new.last_event_at,
      new.created_at
    ) is distinct from row(
      old.id, old.organization_id, old.project_id, old.contact_authority_id,
      old.route_digest, old.source_kind, old.opened_at, old.last_event_at,
      old.created_at
    )
    or old.state <> 'open'
    or new.state <> 'handoff_required'
    or new.revision <> old.revision + 1
  then
    raise exception 'Responder handoff transition is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger responder_interactions_guard
before insert or update or delete on ss.responder_interactions
for each row execute function ss.guard_responder_interaction();

create function ss.guard_responder_provider_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or new.provider <> 'fake'
    or new.state <> 'applied'
  then
    raise exception 'Responder provider event is immutable fake-provider evidence'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger responder_provider_events_guard
before insert or update or delete on ss.responder_provider_events
for each row execute function ss.guard_responder_provider_event();

create function ss.guard_responder_message_command()
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
    or selected_kind not in ('customer', 'operator')
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
    or new.state <> 'held'
    or new.provider_effects_authorized
    or new.delivery_claimed
  then
    raise exception 'Responder message commands are immutable and wholly held'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger responder_message_commands_guard
before insert or update or delete on ss.responder_message_commands
for each row execute function ss.guard_responder_message_command();

create function ss.guard_responder_control_command()
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
    or new.actor_kind <> selected_kind
    or new.actor_user_id is distinct from selected_user
    or selected_kind not in ('customer', 'operator')
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
    raise exception 'Responder control command lacks exact actor authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger responder_control_commands_guard
before insert or update or delete on ss.responder_control_commands
for each row execute function ss.guard_responder_control_command();

alter table ss.responder_runtime_controls enable row level security;
alter table ss.responder_runtime_controls force row level security;
alter table ss.responder_contact_authorities enable row level security;
alter table ss.responder_contact_authorities force row level security;
alter table ss.responder_interactions enable row level security;
alter table ss.responder_interactions force row level security;
alter table ss.responder_provider_events enable row level security;
alter table ss.responder_provider_events force row level security;
alter table ss.responder_message_commands enable row level security;
alter table ss.responder_message_commands force row level security;
alter table ss.responder_control_commands enable row level security;
alter table ss.responder_control_commands force row level security;

revoke all on
  ss.responder_runtime_controls,
  ss.responder_contact_authorities,
  ss.responder_interactions,
  ss.responder_provider_events,
  ss.responder_message_commands,
  ss.responder_control_commands
from public, anon, authenticated, service_role;

grant select, insert on ss.responder_runtime_controls to service_role;
grant select, insert, update on
  ss.responder_contact_authorities,
  ss.responder_interactions
to service_role;
grant select, insert on
  ss.responder_provider_events,
  ss.responder_message_commands,
  ss.responder_control_commands
to service_role;

revoke all on function ss.guard_responder_runtime_control()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_contact_authority()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_interaction()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_provider_event()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_message_command()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_control_command()
from public, anon, authenticated, service_role;

create function ss.hosted_responder_core_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-responder-core-v1-provider-neutral-held'
$$;

revoke all on function ss.hosted_responder_core_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_responder_core_contract_v1()
to service_role;

commit;
