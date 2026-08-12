-- RESPONDER-TWILIO-INBOUND-01
begin;

do $$
begin
  if to_regprocedure('ss.hosted_responder_core_contract_v1()') is null
    or ss.hosted_responder_core_contract_v1() <>
      'canonical-responder-core-v1-provider-neutral-held'
    or to_regprocedure(
      'ss.hosted_responder_fulfillment_queue_contract_v1()'
    ) is null
    or ss.hosted_responder_fulfillment_queue_contract_v1() <>
      'canonical-responder-fulfillment-queue-v1-held-default'
    or to_regprocedure(
      'ss.hosted_responder_private_material_contract_v1()'
    ) is null
    or ss.hosted_responder_private_material_contract_v1() <>
      'canonical-responder-private-material-v1-operation-bound-aes-gcm'
    or to_regprocedure(
      'ss.hosted_responder_twilio_delivery_events_contract_v1()'
    ) is null
    or ss.hosted_responder_twilio_delivery_events_contract_v1() <>
      'canonical-responder-twilio-delivery-events-v1-digest-only-race-safe'
  then
    raise exception
      'the exact Responder core, queue, material, and delivery-event contracts must precede RESPONDER-TWILIO-INBOUND-01'
      using errcode = '55000';
  end if;
end
$$;

-- The provider-neutral core accepted only the deterministic fake adapter.
-- Verified Twilio inbound evidence now shares the same single event, consent,
-- and interaction authority instead of creating a parallel one. Every other
-- rule of the core contract is unchanged; no raw contact, body, or provider
-- identifier crosses this boundary.
alter table ss.responder_provider_events
  drop constraint responder_provider_events_provider_check,
  add constraint responder_provider_events_provider_v2_check check (
    provider in ('fake', 'twilio')
  );

create or replace function ss.guard_responder_provider_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or new.provider not in ('fake', 'twilio')
    or new.state <> 'applied'
  then
    raise exception 'Responder provider event is immutable verified evidence'
      using errcode = '42501';
  end if;
  return new;
end
$$;

-- One provisioned provider number resolves inbound traffic to exactly one
-- hosted organization/project Responder authority. Phone-derived lookup
-- identities are keyed, versioned HMAC digests, never raw E.164 and never
-- unkeyed SHA-256 of a small keyspace. The provisioned Twilio
-- IncomingPhoneNumber resource is bound by the exact digest of its PN SID
-- plus a structured provider-readback evidence digest.
create table ss.responder_provider_number_bindings (
  id uuid primary key,
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  request_digest ss.sha256_hex not null,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  provider text not null check (provider = 'twilio'),
  number_lookup_digest ss.sha256_hex not null,
  lookup_key_version text not null check (
    char_length(lookup_key_version) between 1 and 40
    and lookup_key_version ~ '^[a-z0-9][a-z0-9._-]{0,39}$'
  ),
  phone_number_sid_digest ss.sha256_hex not null,
  account_sid_digest ss.sha256_hex not null,
  messaging_service_sid_digest ss.sha256_hex,
  provider_readback_digest ss.sha256_hex not null,
  state text not null check (state in ('active', 'retired')),
  provisioned_by_user_id uuid not null references auth.users(id),
  provision_evidence_digest ss.sha256_hex not null,
  provisioned_at timestamptz not null,
  retired_at timestamptz,
  retired_by_user_id uuid references auth.users(id),
  retire_evidence_digest ss.sha256_hex,
  retired_reason text check (
    retired_reason is null or retired_reason in (
      'reprovisioned', 'customer_cancelled', 'number_released',
      'operator_correction'
    )
  ),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (organization_id, id),
  check (created_at = provisioned_at),
  check (updated_at >= created_at),
  check (
    (state = 'active'
      and retired_at is null
      and retired_by_user_id is null
      and retire_evidence_digest is null
      and retired_reason is null)
    or (state = 'retired'
      and retired_at is not null
      and retired_by_user_id is not null
      and retire_evidence_digest is not null
      and retired_reason is not null
      and retired_at >= provisioned_at)
  )
);

create unique index responder_one_active_number_binding
  on ss.responder_provider_number_bindings(provider, number_lookup_digest)
  where state = 'active';
create unique index responder_one_active_number_resource
  on ss.responder_provider_number_bindings(provider, phone_number_sid_digest)
  where state = 'active';
create index responder_number_bindings_organization
  on ss.responder_provider_number_bindings(
    organization_id, state, provisioned_at desc, id
  );

create function ss.guard_responder_provider_number_binding()
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
    raise exception 'Responder number bindings are durable'
      using errcode = '55000';
  end if;

  if selected_kind <> 'operator'
    or new.organization_id is distinct from selected_org
    or not ss.service_operator_has_capability(
      selected_user, 'service_management_manage', clock_timestamp()
    )
  then
    raise exception 'Responder number binding requires exact operator authority'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'active'
      or new.revision <> 1
      or new.provisioned_by_user_id is distinct from selected_user
    then
      raise exception 'Responder number binding must begin active'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.id, new.command_id, new.request_digest, new.organization_id,
    new.project_id, new.provider, new.number_lookup_digest,
    new.lookup_key_version, new.phone_number_sid_digest,
    new.account_sid_digest, new.messaging_service_sid_digest,
    new.provider_readback_digest, new.provisioned_by_user_id,
    new.provision_evidence_digest, new.provisioned_at, new.created_at
  ) is distinct from row(
    old.id, old.command_id, old.request_digest, old.organization_id,
    old.project_id, old.provider, old.number_lookup_digest,
    old.lookup_key_version, old.phone_number_sid_digest,
    old.account_sid_digest, old.messaging_service_sid_digest,
    old.provider_readback_digest, old.provisioned_by_user_id,
    old.provision_evidence_digest, old.provisioned_at, old.created_at
  )
    or old.state <> 'active'
    or new.state <> 'retired'
    or new.revision <> old.revision + 1
    or new.updated_at < old.updated_at
    or new.retired_by_user_id is distinct from selected_user
  then
    raise exception 'Responder number binding retirement is the only transition'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger responder_provider_number_bindings_guard
before insert or update or delete on ss.responder_provider_number_bindings
for each row execute function ss.guard_responder_provider_number_binding();

-- Immutable digest-only ledger of every authenticated Twilio inbound webhook.
-- The exact raw form bytes are the ledger identity; the provider resource
-- SID digest is the single-application key into the shared core evidence.
-- Tenant columns may be null only for the exact unbound quarantine states.
create table ss.responder_twilio_inbound_events (
  id uuid primary key,
  provider text not null check (provider = 'twilio'),
  channel text not null check (channel in ('sms', 'voice')),
  event_kind text not null check (
    event_kind in ('message_received', 'call_received', 'dial_result')
  ),
  provider_event_digest ss.sha256_hex not null unique,
  provider_event_id_digest ss.sha256_hex not null,
  account_sid_digest ss.sha256_hex not null,
  messaging_service_sid_digest ss.sha256_hex,
  to_number_lookup_digest ss.sha256_hex not null,
  to_number_key_version text not null check (
    char_length(to_number_key_version) between 1 and 40
    and to_number_key_version ~ '^[a-z0-9][a-z0-9._-]{0,39}$'
  ),
  from_route_digest ss.sha256_hex,
  from_route_key_version text check (
    from_route_key_version is null or (
      char_length(from_route_key_version) between 1 and 40
      and from_route_key_version ~ '^[a-z0-9][a-z0-9._-]{0,39}$'
    )
  ),
  dial_call_status text check (
    dial_call_status is null or dial_call_status in (
      'completed', 'busy', 'no-answer', 'failed', 'canceled'
    )
  ),
  opt_out_type text check (
    opt_out_type is null or opt_out_type in ('START', 'STOP', 'HELP')
  ),
  classified_intent text check (
    classified_intent is null
    or classified_intent in ('not_applicable', 'message', 'stop')
  ),
  signature_verification_digest ss.sha256_hex not null,
  payload_digest ss.sha256_hex not null,
  state text not null check (
    state in ('applied', 'recorded', 'unbound', 'superseded')
  ),
  state_reason text check (
    state_reason is null or state_reason in (
      'no_binding', 'retired_binding', 'account_mismatch',
      'service_mismatch', 'anonymous_caller', 'ineligible_route',
      'call_arrival', 'call_answered', 'duplicate_payload_variant'
    )
  ),
  organization_id uuid,
  project_id uuid,
  core_provider_event_id uuid references ss.responder_provider_events(id),
  received_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  check (created_at = received_at),
  check (provider_event_digest = payload_digest),
  check ((from_route_digest is null) = (from_route_key_version is null)),
  check (
    (channel = 'sms' and event_kind = 'message_received'
      and dial_call_status is null)
    or (channel = 'voice'
      and event_kind in ('call_received', 'dial_result')
      and opt_out_type is null)
  ),
  check (
    (event_kind = 'dial_result' and dial_call_status is not null)
    or (event_kind <> 'dial_result' and dial_call_status is null)
  ),
  check (
    (state = 'applied'
      and organization_id is not null
      and project_id is not null
      and core_provider_event_id is not null
      and from_route_digest is not null
      and classified_intent is not null
      and state_reason is null
      and event_kind <> 'call_received'
      and (dial_call_status is null or dial_call_status in (
        'busy', 'no-answer', 'failed', 'canceled'
      )))
    or (state = 'recorded'
      and organization_id is not null
      and project_id is not null
      and core_provider_event_id is null
      and state_reason in (
        'anonymous_caller', 'ineligible_route', 'call_arrival',
        'call_answered'
      ))
    or (state = 'unbound'
      and organization_id is null
      and project_id is null
      and core_provider_event_id is null
      and state_reason in (
        'no_binding', 'retired_binding', 'account_mismatch',
        'service_mismatch'
      ))
    or (state = 'superseded'
      and organization_id is not null
      and project_id is not null
      and core_provider_event_id is null
      and state_reason = 'duplicate_payload_variant')
  )
);

create unique index responder_twilio_inbound_single_application
  on ss.responder_twilio_inbound_events(event_kind, provider_event_id_digest)
  where state = 'applied';
create index responder_twilio_inbound_unbound
  on ss.responder_twilio_inbound_events(received_at, id)
  where state = 'unbound';
create index responder_twilio_inbound_number
  on ss.responder_twilio_inbound_events(
    to_number_lookup_digest, received_at, id
  );
create index responder_twilio_inbound_organization
  on ss.responder_twilio_inbound_events(organization_id, received_at, id)
  where organization_id is not null;

create function ss.guard_responder_twilio_inbound_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
  then
    raise exception
      'Responder inbound events are immutable system-recorded evidence'
      using errcode = '42501';
  end if;
  if new.organization_id is null and new.state <> 'unbound' then
    raise exception
      'Only unbound Responder inbound evidence may lack a tenant'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger responder_twilio_inbound_events_guard
before insert or update or delete on ss.responder_twilio_inbound_events
for each row execute function ss.guard_responder_twilio_inbound_event();

-- Inbound caller evidence is sealed with AES-256-GCM and bound to its exact
-- inbound event. Durable operational tables stay digest-only; only this
-- guarded ciphertext row can ever carry the caller route or message body,
-- and destruction zeroes every ciphertext-bearing column.
create table ss.responder_inbound_private_materials (
  inbound_event_id uuid primary key
    references ss.responder_twilio_inbound_events(id),
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  channel text not null check (channel in ('sms', 'voice')),
  from_route_digest ss.sha256_hex not null,
  payload_digest ss.sha256_hex not null,
  key_version text check (
    key_version is null or (
      char_length(key_version) between 1 and 64
      and key_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    )
  ),
  nonce bytea check (nonce is null or octet_length(nonce) = 12),
  authentication_tag bytea check (
    authentication_tag is null or octet_length(authentication_tag) = 16
  ),
  ciphertext bytea check (
    ciphertext is null or octet_length(ciphertext) between 16 and 8192
  ),
  envelope_digest ss.sha256_hex,
  state text not null check (state in ('active', 'destroyed')),
  destroy_reason text check (
    destroy_reason is null or destroy_reason in (
      'accepted_retention', 'opt_out', 'cancellation',
      'account_deletion', 'manual_reconciliation_closed'
    )
  ),
  destroyed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  check (updated_at >= created_at),
  check (
    (state = 'active'
      and key_version is not null
      and nonce is not null
      and authentication_tag is not null
      and ciphertext is not null
      and envelope_digest is not null
      and destroy_reason is null
      and destroyed_at is null)
    or (state = 'destroyed'
      and key_version is null
      and nonce is null
      and authentication_tag is null
      and ciphertext is null
      and envelope_digest is null
      and destroy_reason is not null
      and destroyed_at is not null
      and destroyed_at >= created_at)
  )
);

create index responder_inbound_private_materials_organization
  on ss.responder_inbound_private_materials(
    organization_id, created_at desc, inbound_event_id
  );

create function ss.responder_inbound_material_envelope_digest(
  selected_inbound_event_id uuid,
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_channel text,
  selected_from_route_digest ss.sha256_hex,
  selected_payload_digest ss.sha256_hex,
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
    'authenticationTagDigest', encode(
      sha256(selected_authentication_tag), 'hex'
    ),
    'channel', selected_channel,
    'ciphertextDigest', encode(sha256(selected_ciphertext), 'hex'),
    'fromRouteDigest', selected_from_route_digest,
    'inboundEventId', selected_inbound_event_id,
    'keyVersion', selected_key_version,
    'nonceDigest', encode(sha256(selected_nonce), 'hex'),
    'organizationId', selected_organization_id,
    'payloadDigest', selected_payload_digest,
    'projectId', selected_project_id,
    'schema', 'sitesourcery.responder-inbound-private-material/v1'
  ))
$$;

create function ss.guard_responder_inbound_private_material()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
  then
    raise exception
      'Responder inbound material requires exact system tenant authority'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'active'
      or new.envelope_digest is distinct from
        ss.responder_inbound_material_envelope_digest(
          new.inbound_event_id, new.organization_id, new.project_id,
          new.channel, new.from_route_digest, new.payload_digest,
          new.key_version, new.nonce, new.authentication_tag,
          new.ciphertext
        )
      or not exists (
        select 1
          from ss.responder_twilio_inbound_events inbound
         where inbound.id = new.inbound_event_id
           and inbound.organization_id = new.organization_id
           and inbound.project_id = new.project_id
           and inbound.channel = new.channel
           and inbound.from_route_digest = new.from_route_digest
           and inbound.payload_digest = new.payload_digest
           and inbound.state = 'applied'
      )
    then
      raise exception
        'Responder inbound material must seal exactly one applied event'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state <> 'active'
    or new.state <> 'destroyed'
    or row(
      new.inbound_event_id, new.organization_id, new.project_id,
      new.channel, new.from_route_digest, new.payload_digest,
      new.created_at
    ) is distinct from row(
      old.inbound_event_id, old.organization_id, old.project_id,
      old.channel, old.from_route_digest, old.payload_digest,
      old.created_at
    )
    or new.updated_at < old.updated_at
  then
    raise exception
      'Responder inbound material allows only guarded destruction'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger responder_inbound_private_materials_guard
before insert or update or delete on ss.responder_inbound_private_materials
for each row execute function ss.guard_responder_inbound_private_material();

alter table ss.responder_provider_number_bindings enable row level security;
alter table ss.responder_provider_number_bindings force row level security;
alter table ss.responder_twilio_inbound_events enable row level security;
alter table ss.responder_twilio_inbound_events force row level security;
alter table ss.responder_inbound_private_materials enable row level security;
alter table ss.responder_inbound_private_materials force row level security;

revoke all on
  ss.responder_provider_number_bindings,
  ss.responder_twilio_inbound_events,
  ss.responder_inbound_private_materials
from public, anon, authenticated, service_role;

grant select, insert, update on ss.responder_provider_number_bindings
to service_role;
grant select, insert on ss.responder_twilio_inbound_events to service_role;
grant select, insert, update on ss.responder_inbound_private_materials
to service_role;

revoke all on function ss.responder_inbound_material_envelope_digest(
  uuid, uuid, uuid, text, ss.sha256_hex, ss.sha256_hex, text,
  bytea, bytea, bytea
) from public, anon, authenticated;
grant execute on function ss.responder_inbound_material_envelope_digest(
  uuid, uuid, uuid, text, ss.sha256_hex, ss.sha256_hex, text,
  bytea, bytea, bytea
) to service_role;

revoke all on function ss.guard_responder_provider_number_binding()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_twilio_inbound_event()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_inbound_private_material()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_provider_event()
from public, anon, authenticated, service_role;

create function ss.hosted_responder_twilio_inbound_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-responder-twilio-inbound-v1-keyed-lookup-tenant-bound'
$$;

revoke all on function ss.hosted_responder_twilio_inbound_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_responder_twilio_inbound_contract_v1()
to service_role;

commit;
