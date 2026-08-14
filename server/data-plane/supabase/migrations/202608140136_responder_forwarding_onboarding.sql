-- FIN-006D carrier-preserving Responder forwarding onboarding
--
-- This migration adds local, digest-only authority for a customer retaining
-- their existing carrier/number while an operator verifies conditional
-- no-answer forwarding into an already-attested managed transport binding.
-- It performs no carrier, Twilio, message-send, payment, or public effect.

begin;

-- The managed number's Voice purpose is durable independently of an active
-- onboarding.  A conditional-forward destination must never fall back to the
-- managed-front-door Dial flow while carrier setup is pending or propagating
-- after retirement.
alter table ss.responder_provider_number_bindings
  add column voice_ingress_role text not null default 'managed_front_door'
    check (voice_ingress_role in (
      'managed_front_door', 'conditional_forward_destination'
    ));

create or replace function ss.guard_responder_provider_number_binding()
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
      or new.voice_ingress_role not in (
        'managed_front_door', 'conditional_forward_destination'
      )
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
    new.provision_evidence_digest, new.provisioned_at, new.created_at,
    new.voice_ingress_role
  ) is distinct from row(
    old.id, old.command_id, old.request_digest, old.organization_id,
    old.project_id, old.provider, old.number_lookup_digest,
    old.lookup_key_version, old.phone_number_sid_digest,
    old.account_sid_digest, old.messaging_service_sid_digest,
    old.provider_readback_digest, old.provisioned_by_user_id,
    old.provision_evidence_digest, old.provisioned_at, old.created_at,
    old.voice_ingress_role
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

do $$
begin
  if to_regprocedure(
       'ss.hosted_responder_twilio_inbound_contract_v1()'
     ) is null
    or ss.hosted_responder_twilio_inbound_contract_v1() <>
      'canonical-responder-twilio-inbound-v1-keyed-lookup-tenant-bound'
    or to_regprocedure(
       'ss.responder_voice_followup_closure_contract_v1()'
     ) is null
    or ss.responder_voice_followup_closure_contract_v1() <>
      'canonical-fin-004t-responder-voice-target-followup-v1-held'
  then
    raise exception
      'FIN-006D forwarding requires the exact Twilio inbound and Voice follow-up contracts'
      using errcode = '55000';
  end if;
end
$$;

create function ss.responder_forwarding_onboarding_payload_digest_v1(
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_customer_user_id uuid,
  selected_number_binding_id uuid,
  selected_business_line_lookup_digest ss.sha256_hex,
  selected_business_line_key_version text,
  selected_consent_evidence_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'businessLineKeyVersion', selected_business_line_key_version,
    'businessLineLookupDigest', selected_business_line_lookup_digest,
    'consentEvidenceDigest', selected_consent_evidence_digest,
    'customerUserId', selected_customer_user_id,
    'instructionContract',
      'provider-assisted-conditional-no-answer-v1',
    'launchMode', 'conditional_no_answer_forwarding',
    'numberBindingId', selected_number_binding_id,
    'organizationId', selected_organization_id,
    'projectId', selected_project_id,
    'schema', 'sitesourcery.responder-forwarding-onboarding-payload/v1',
    'transportAdapter', 'twilio'
  ))
$$;

create function ss.responder_forwarding_observation_digest_v1(
  selected_onboarding_id uuid,
  selected_observation_kind text,
  selected_inbound_event_id uuid,
  selected_evidence_digest ss.sha256_hex,
  selected_observed_at timestamptz
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'evidenceDigest', selected_evidence_digest,
    'inboundEventId', selected_inbound_event_id,
    'observationKind', selected_observation_kind,
    'observedAt', selected_observed_at,
    'onboardingId', selected_onboarding_id,
    'schema', 'sitesourcery.responder-forwarding-observation/v1'
  ))
$$;

create function ss.responder_forwarding_retirement_payload_digest_v1(
  selected_onboarding_id uuid,
  selected_reason text,
  selected_evidence_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'evidenceDigest', selected_evidence_digest,
    'onboardingId', selected_onboarding_id,
    'reason', selected_reason,
    'schema', 'sitesourcery.responder-forwarding-retirement/v1'
  ))
$$;

create function ss.responder_forwarding_command_request_digest_v1(
  selected_actor_kind text,
  selected_actor_user_id uuid,
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_onboarding_id uuid,
  selected_command_kind text,
  selected_expected_revision bigint,
  selected_resulting_state text,
  selected_payload_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'actorKind', selected_actor_kind,
    'actorUserId', selected_actor_user_id,
    'commandKind', selected_command_kind,
    'expectedRevision', selected_expected_revision,
    'onboardingId', selected_onboarding_id,
    'organizationId', selected_organization_id,
    'payloadDigest', selected_payload_digest,
    'projectId', selected_project_id,
    'resultingState', selected_resulting_state,
    'schema', 'sitesourcery.responder-forwarding-command/v1'
  ))
$$;

create table ss.responder_forwarding_commands (
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  request_digest ss.sha256_hex not null unique,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  onboarding_id uuid not null,
  actor_kind text not null check (actor_kind in ('customer', 'operator')),
  actor_user_id uuid not null references auth.users(id),
  command_kind text not null check (
    command_kind in ('create', 'record_observation', 'retire')
  ),
  expected_revision bigint not null check (expected_revision >= 0),
  resulting_state text not null check (
    resulting_state in (
      'setup_pending', 'ready_held', 'manual_review', 'retired'
    )
  ),
  payload_digest ss.sha256_hex not null,
  automatic_carrier_commands boolean not null default false
    check (not automatic_carrier_commands),
  remote_write_effects boolean not null default false
    check (not remote_write_effects),
  provider_effects boolean not null default false
    check (not provider_effects),
  message_send_effects boolean not null default false
    check (not message_send_effects),
  created_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  primary key (organization_id, command_id),
  unique (organization_id, onboarding_id, expected_revision),
  check (
    (command_kind = 'create' and expected_revision = 0
      and resulting_state = 'setup_pending')
    or (command_kind = 'record_observation' and expected_revision > 0
      and resulting_state <> 'retired')
    or (command_kind = 'retire' and expected_revision > 0
      and resulting_state = 'retired')
  )
);

create table ss.responder_forwarding_onboardings (
  id uuid primary key,
  create_command_id text not null,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  number_binding_id uuid not null,
  transport_adapter text not null check (transport_adapter = 'twilio'),
  launch_mode text not null check (
    launch_mode = 'conditional_no_answer_forwarding'
  ),
  instruction_contract text not null check (
    instruction_contract = 'provider-assisted-conditional-no-answer-v1'
  ),
  business_line_lookup_digest ss.sha256_hex not null,
  business_line_key_version text not null check (
    char_length(business_line_key_version) between 1 and 40
    and business_line_key_version ~ '^[a-z0-9][a-z0-9._-]{0,39}$'
  ),
  consent_evidence_digest ss.sha256_hex not null,
  state text not null check (
    state in ('setup_pending', 'ready_held', 'manual_review', 'retired')
  ),
  created_by_kind text not null check (
    created_by_kind in ('customer', 'operator')
  ),
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null,
  retired_reason text check (
    retired_reason is null or retired_reason in (
      'customer_cancelled', 'binding_replaced', 'operator_correction',
      'carrier_route_removed'
    )
  ),
  retire_evidence_digest ss.sha256_hex,
  retired_by_kind text check (
    retired_by_kind is null or retired_by_kind in ('customer', 'operator')
  ),
  retired_by_user_id uuid references auth.users(id),
  retired_at timestamptz,
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null,
  automatic_carrier_commands boolean not null default false
    check (not automatic_carrier_commands),
  remote_write_effects boolean not null default false
    check (not remote_write_effects),
  provider_effects boolean not null default false
    check (not provider_effects),
  message_send_effects boolean not null default false
    check (not message_send_effects),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, number_binding_id)
    references ss.responder_provider_number_bindings(organization_id, id),
  unique (organization_id, id),
  unique (organization_id, create_command_id),
  foreign key (organization_id, create_command_id)
    references ss.responder_forwarding_commands(
      organization_id, command_id
    ) deferrable initially deferred,
  check (created_at = updated_at or updated_at > created_at),
  check (
    (state <> 'retired' and retired_reason is null
      and retire_evidence_digest is null and retired_by_kind is null
      and retired_by_user_id is null and retired_at is null)
    or (state = 'retired' and retired_reason is not null
      and retire_evidence_digest is not null and retired_by_kind is not null
      and retired_by_user_id is not null and retired_at is not null
      and retired_at = updated_at and retired_at >= created_at)
  )
);

alter table ss.responder_forwarding_commands
  add foreign key (organization_id, onboarding_id)
    references ss.responder_forwarding_onboardings(organization_id, id)
    deferrable initially deferred;

create unique index responder_one_active_forwarding_per_binding
  on ss.responder_forwarding_onboardings(number_binding_id)
  where state <> 'retired';
create unique index responder_one_active_forwarding_per_business_line
  on ss.responder_forwarding_onboardings(
    transport_adapter, business_line_lookup_digest
  ) where state <> 'retired';
create index responder_forwarding_onboardings_project
  on ss.responder_forwarding_onboardings(
    organization_id, project_id, state, created_at desc, id
  );

create table ss.responder_forwarding_observations (
  id uuid primary key,
  command_id text not null,
  organization_id uuid not null,
  project_id uuid not null,
  onboarding_id uuid not null,
  observation_kind text not null check (
    observation_kind in (
      'carrier_setup_attested',
      'unanswered_forwarding_reached',
      'answered_call_not_forwarded',
      'reply_path_confirmed',
      'stop_path_confirmed',
      'routing_ambiguous'
    )
  ),
  inbound_event_id uuid references ss.responder_twilio_inbound_events(id),
  evidence_digest ss.sha256_hex not null,
  observation_digest ss.sha256_hex not null unique,
  observed_at timestamptz not null,
  recorded_by_kind text not null check (recorded_by_kind = 'operator'),
  recorded_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null,
  automatic_carrier_commands boolean not null default false
    check (not automatic_carrier_commands),
  remote_write_effects boolean not null default false
    check (not remote_write_effects),
  provider_effects boolean not null default false
    check (not provider_effects),
  message_send_effects boolean not null default false
    check (not message_send_effects),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, onboarding_id)
    references ss.responder_forwarding_onboardings(organization_id, id),
  foreign key (organization_id, command_id)
    references ss.responder_forwarding_commands(
      organization_id, command_id
    ),
  unique (organization_id, command_id),
  unique (onboarding_id, observation_kind),
  check (observed_at <= created_at + interval '5 minutes'),
  check (
    (observation_kind in (
      'unanswered_forwarding_reached',
      'reply_path_confirmed',
      'stop_path_confirmed'
    ) and inbound_event_id is not null)
    or (observation_kind in (
      'carrier_setup_attested', 'answered_call_not_forwarded'
    ) and inbound_event_id is null)
    or observation_kind = 'routing_ambiguous'
  )
);

create function ss.guard_responder_forwarding_command_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() is distinct from new.actor_kind
    or ss.current_service_actor_user_id() is distinct from new.actor_user_id
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or new.created_at > clock_timestamp() + interval '5 minutes'
    or new.request_digest is distinct from
      ss.responder_forwarding_command_request_digest_v1(
        new.actor_kind, new.actor_user_id, new.organization_id,
        new.project_id, new.onboarding_id, new.command_kind,
        new.expected_revision, new.resulting_state, new.payload_digest
      )
  then
    raise exception 'Responder forwarding command authority conflicts'
      using errcode = '42501';
  end if;

  if new.actor_kind = 'operator' then
    if not ss.service_operator_has_capability(
      new.actor_user_id, 'service_management_manage', clock_timestamp()
    ) then
      raise exception 'Responder forwarding operator authority is unavailable'
        using errcode = '42501';
    end if;
  elsif new.command_kind = 'record_observation' then
    raise exception 'Only operators may record forwarding observations'
      using errcode = '42501';
  elsif not exists (
    select 1 from ss.organization_memberships membership
     where membership.organization_id = new.organization_id
       and membership.user_id = new.actor_user_id
       and membership.state = 'active'
  ) then
    raise exception 'Responder forwarding customer authority is unavailable'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger responder_forwarding_commands_guard
before insert or update or delete on ss.responder_forwarding_commands
for each row execute function ss.guard_responder_forwarding_command_v1();

create function ss.guard_responder_forwarding_observation_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_command ss.responder_forwarding_commands%rowtype;
  selected_onboarding ss.responder_forwarding_onboardings%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Responder forwarding observations are immutable'
      using errcode = '55000';
  end if;

  select * into strict selected_command
    from ss.responder_forwarding_commands command
   where command.organization_id = new.organization_id
     and command.command_id = new.command_id;
  select * into strict selected_onboarding
    from ss.responder_forwarding_onboardings onboarding
   where onboarding.id = new.onboarding_id
     and onboarding.organization_id = new.organization_id
     and onboarding.project_id = new.project_id;

  if selected_command.command_kind <> 'record_observation'
    or selected_command.organization_id <> new.organization_id
    or selected_command.project_id <> new.project_id
    or selected_command.onboarding_id <> new.onboarding_id
    or selected_command.expected_revision <> selected_onboarding.revision
    or selected_onboarding.state = 'retired'
    or selected_command.payload_digest is distinct from new.observation_digest
    or selected_command.actor_kind <> 'operator'
    or selected_command.actor_kind is distinct from new.recorded_by_kind
    or selected_command.actor_user_id is distinct from new.recorded_by_user_id
    or selected_command.created_at is distinct from new.created_at
    or new.observation_digest is distinct from
      ss.responder_forwarding_observation_digest_v1(
        new.onboarding_id, new.observation_kind, new.inbound_event_id,
        new.evidence_digest, new.observed_at
      )
  then
    raise exception 'Responder forwarding observation evidence conflicts'
      using errcode = '23514';
  end if;

  if new.observation_kind = 'unanswered_forwarding_reached' then
    if not exists (
      select 1 from ss.responder_twilio_inbound_events inbound
       where inbound.id = new.inbound_event_id
         and inbound.organization_id = new.organization_id
         and inbound.project_id = new.project_id
         and inbound.number_binding_id = selected_onboarding.number_binding_id
         and inbound.forwarding_onboarding_id = new.onboarding_id
         and inbound.channel = 'voice'
         and inbound.event_kind = 'call_received'
         and inbound.state = 'recorded'
         and inbound.state_reason = 'forwarding_not_ready'
         and inbound.voice_arrival_policy =
           'conditional_no_answer_forwarding'
    ) then
      raise exception 'Unanswered forwarding proof lacks exact arrival evidence'
        using errcode = '23514';
    end if;
  elsif new.observation_kind = 'reply_path_confirmed' then
    if not exists (
      select 1 from ss.responder_twilio_inbound_events inbound
       where inbound.id = new.inbound_event_id
         and inbound.organization_id = new.organization_id
         and inbound.project_id = new.project_id
         and inbound.number_binding_id = selected_onboarding.number_binding_id
         and inbound.channel = 'sms'
         and inbound.event_kind = 'message_received'
         and inbound.state = 'applied'
         and inbound.classified_intent = 'message'
    ) then
      raise exception 'Reply-path proof lacks exact inbound message evidence'
        using errcode = '23514';
    end if;
  elsif new.observation_kind = 'stop_path_confirmed' then
    if not exists (
      select 1 from ss.responder_twilio_inbound_events inbound
       where inbound.id = new.inbound_event_id
         and inbound.organization_id = new.organization_id
         and inbound.project_id = new.project_id
         and inbound.number_binding_id = selected_onboarding.number_binding_id
         and inbound.channel = 'sms'
         and inbound.event_kind = 'message_received'
         and inbound.state = 'applied'
         and inbound.classified_intent = 'stop'
    ) then
      raise exception 'STOP-path proof lacks exact suppression evidence'
        using errcode = '23514';
    end if;
  elsif new.observation_kind = 'routing_ambiguous'
    and new.inbound_event_id is not null then
    if not exists (
      select 1 from ss.responder_twilio_inbound_events inbound
       where inbound.id = new.inbound_event_id
         and inbound.organization_id = new.organization_id
         and inbound.project_id = new.project_id
         and inbound.number_binding_id = selected_onboarding.number_binding_id
         and inbound.forwarding_onboarding_id = new.onboarding_id
         and inbound.channel = 'voice'
         and inbound.event_kind = 'call_received'
         and inbound.state = 'recorded'
         and inbound.state_reason = 'forwarding_source_mismatch'
         and inbound.voice_arrival_policy =
           'conditional_no_answer_forwarding'
    ) then
      raise exception 'Routing ambiguity lacks exact forwarding evidence'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger responder_forwarding_observations_guard
before insert or update or delete on ss.responder_forwarding_observations
for each row execute function ss.guard_responder_forwarding_observation_v1();

create function ss.guard_responder_forwarding_onboarding_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_command ss.responder_forwarding_commands%rowtype;
  selected_resulting_state text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Responder forwarding onboarding evidence is durable'
      using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    select * into strict selected_command
      from ss.responder_forwarding_commands command
     where command.organization_id = new.organization_id
       and command.command_id = new.create_command_id;
    if new.state <> 'setup_pending' or new.revision <> 1
      or selected_command.command_kind <> 'create'
      or selected_command.expected_revision <> 0
      or selected_command.resulting_state <> 'setup_pending'
      or selected_command.organization_id <> new.organization_id
      or selected_command.project_id <> new.project_id
      or selected_command.onboarding_id <> new.id
      or selected_command.actor_kind <> new.created_by_kind
      or selected_command.actor_user_id <> new.created_by_user_id
      or (selected_command.actor_kind = 'customer'
        and selected_command.actor_user_id <> new.customer_user_id)
      or selected_command.created_at <> new.created_at
      or selected_command.payload_digest is distinct from
        ss.responder_forwarding_onboarding_payload_digest_v1(
          new.organization_id, new.project_id, new.customer_user_id,
          new.number_binding_id, new.business_line_lookup_digest,
          new.business_line_key_version, new.consent_evidence_digest
        )
      or not exists (
        select 1 from ss.organization_memberships membership
         where membership.organization_id = new.organization_id
           and membership.user_id = new.customer_user_id
           and membership.state = 'active'
      )
      or not exists (
        select 1 from ss.responder_provider_number_bindings binding
         where binding.id = new.number_binding_id
           and binding.organization_id = new.organization_id
           and binding.project_id = new.project_id
           and binding.provider = 'twilio'
           and binding.state = 'active'
           and binding.voice_ingress_role =
             'conditional_forward_destination'
           and binding.number_lookup_digest <>
             new.business_line_lookup_digest
      )
    then
      raise exception 'Responder forwarding onboarding creation conflicts'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.id, new.create_command_id, new.organization_id, new.project_id,
    new.customer_user_id, new.number_binding_id, new.transport_adapter,
    new.launch_mode, new.instruction_contract,
    new.business_line_lookup_digest, new.business_line_key_version,
    new.consent_evidence_digest, new.created_by_kind,
    new.created_by_user_id, new.created_at,
    new.automatic_carrier_commands, new.remote_write_effects,
    new.provider_effects, new.message_send_effects
  ) is distinct from row(
    old.id, old.create_command_id, old.organization_id, old.project_id,
    old.customer_user_id, old.number_binding_id, old.transport_adapter,
    old.launch_mode, old.instruction_contract,
    old.business_line_lookup_digest, old.business_line_key_version,
    old.consent_evidence_digest, old.created_by_kind,
    old.created_by_user_id, old.created_at,
    old.automatic_carrier_commands, old.remote_write_effects,
    old.provider_effects, old.message_send_effects
  ) or new.revision <> old.revision + 1 or new.updated_at < old.updated_at
  then
    raise exception 'Responder forwarding history cannot be rewritten'
      using errcode = '55000';
  end if;

  select * into strict selected_command
    from ss.responder_forwarding_commands command
   where command.organization_id = old.organization_id
     and command.onboarding_id = old.id
     and command.expected_revision = old.revision;
  if selected_command.organization_id <> old.organization_id
    or selected_command.project_id <> old.project_id
    or selected_command.resulting_state <> new.state
    or selected_command.created_at <> new.updated_at
    or ss.current_service_actor_kind() <> selected_command.actor_kind
    or ss.current_service_actor_user_id() <> selected_command.actor_user_id
    or ss.current_service_actor_org_id() <> selected_command.organization_id
  then
    raise exception 'Responder forwarding transition lacks exact command authority'
      using errcode = '42501';
  end if;

  if selected_command.command_kind = 'record_observation' then
    if new.retired_reason is not null or new.retire_evidence_digest is not null
      or new.retired_by_kind is not null or new.retired_by_user_id is not null
      or new.retired_at is not null
      or not exists (
        select 1 from ss.responder_forwarding_observations observation
         where observation.organization_id = old.organization_id
           and observation.command_id = selected_command.command_id
           and observation.onboarding_id = old.id
      )
    then
      raise exception 'Responder forwarding observation transition conflicts'
        using errcode = '23514';
    end if;
    select case
      when bool_or(observation_kind = 'routing_ambiguous')
        then 'manual_review'
      when count(*) filter (where observation_kind in (
        'carrier_setup_attested',
        'unanswered_forwarding_reached',
        'answered_call_not_forwarded',
        'reply_path_confirmed',
        'stop_path_confirmed'
      )) = 5 then 'ready_held'
      else 'setup_pending'
    end into selected_resulting_state
      from ss.responder_forwarding_observations
     where onboarding_id = old.id;
    if new.state is distinct from selected_resulting_state then
      raise exception 'Responder forwarding state does not match evidence'
        using errcode = '23514';
    end if;
  elsif selected_command.command_kind = 'retire' then
    if new.state <> 'retired'
      or new.retired_reason is null
      or new.retire_evidence_digest is null
      or new.retired_by_kind <> selected_command.actor_kind
      or new.retired_by_user_id <> selected_command.actor_user_id
      or new.retired_at <> new.updated_at
      or selected_command.payload_digest is distinct from
        ss.responder_forwarding_retirement_payload_digest_v1(
          old.id, new.retired_reason, new.retire_evidence_digest
        )
      or (selected_command.actor_kind = 'customer' and (
        selected_command.actor_user_id <> old.customer_user_id
        or new.retired_reason <> 'customer_cancelled'
      ))
    then
      raise exception 'Responder forwarding retirement evidence conflicts'
        using errcode = '23514';
    end if;
  else
    raise exception 'Responder forwarding transition kind is invalid'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger responder_forwarding_onboardings_guard
before insert or update or delete on ss.responder_forwarding_onboardings
for each row execute function ss.guard_responder_forwarding_onboarding_v1();

-- Bind Voice arrivals to one explicit launch policy. Existing rows remain
-- valid historical evidence with null policy; every new tenant-bound Voice
-- insert is checked by the replaced guard below.
alter table ss.responder_twilio_inbound_events
  add column forwarding_onboarding_id uuid,
  add column voice_arrival_policy text check (
    voice_arrival_policy is null or voice_arrival_policy in (
      'managed_front_door', 'conditional_no_answer_forwarding'
    )
  ),
  add foreign key (organization_id, forwarding_onboarding_id)
    references ss.responder_forwarding_onboardings(organization_id, id);

do $$
declare
  selected_constraint text;
  selected_count integer := 0;
begin
  for selected_constraint in
    select constraint_record.conname
      from pg_constraint constraint_record
     where constraint_record.conrelid =
       'ss.responder_twilio_inbound_events'::regclass
       and constraint_record.contype = 'c'
       and pg_get_constraintdef(constraint_record.oid) like
         '%event_kind <> ''call_received''%'
  loop
    execute format(
      'alter table ss.responder_twilio_inbound_events drop constraint %I',
      selected_constraint
    );
    selected_count := selected_count + 1;
  end loop;
  if selected_count <> 1 then
    raise exception 'Expected one exact predecessor inbound state constraint'
      using errcode = '55000';
  end if;
end
$$;

do $$
declare
  selected_constraint text;
begin
  select constraint_record.conname into strict selected_constraint
    from pg_constraint constraint_record
   where constraint_record.conrelid =
     'ss.responder_twilio_inbound_events'::regclass
     and constraint_record.contype = 'c'
     and pg_get_constraintdef(constraint_record.oid) like
       '%duplicate_payload_variant%'
     and pg_get_constraintdef(constraint_record.oid) like '%no_binding%';
  execute format(
    'alter table ss.responder_twilio_inbound_events drop constraint %I',
    selected_constraint
  );
end
$$;

alter table ss.responder_twilio_inbound_events
  add constraint responder_twilio_inbound_state_reason_v2 check (
    state_reason is null or state_reason in (
      'no_binding', 'retired_binding', 'account_mismatch',
      'service_mismatch', 'anonymous_caller', 'ineligible_route',
      'call_arrival', 'call_answered', 'duplicate_payload_variant',
      'forwarding_not_ready', 'forwarding_source_mismatch',
      'forwarding_onboarding_unavailable'
    )
  ),
  add constraint responder_twilio_inbound_state_shape_v2 check (
    (state = 'applied'
      and organization_id is not null and project_id is not null
      and core_provider_event_id is not null
      and from_route_digest is not null and classified_intent is not null
      and state_reason is null
      and (
        event_kind = 'message_received'
        or (event_kind = 'dial_result' and dial_call_status in (
          'busy', 'no-answer', 'failed', 'canceled'
        ))
        or (event_kind = 'call_received'
          and voice_arrival_policy = 'conditional_no_answer_forwarding'
          and forwarding_onboarding_id is not null)
      ))
    or (state = 'recorded'
      and organization_id is not null and project_id is not null
      and core_provider_event_id is null
      and state_reason in (
        'anonymous_caller', 'ineligible_route', 'call_arrival',
        'call_answered', 'forwarding_not_ready',
        'forwarding_source_mismatch', 'forwarding_onboarding_unavailable'
      ))
    or (state = 'unbound'
      and organization_id is null and project_id is null
      and core_provider_event_id is null
      and state_reason in (
        'no_binding', 'retired_binding', 'account_mismatch',
        'service_mismatch'
      ))
    or (state = 'superseded'
      and organization_id is not null and project_id is not null
      and core_provider_event_id is null
      and state_reason = 'duplicate_payload_variant')
  );

create or replace function ss.guard_responder_twilio_inbound_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_forwarding_state text;
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
  then
    raise exception
      'Responder inbound events are immutable system-recorded evidence'
      using errcode = '42501';
  end if;
  if new.organization_id is null then
    if new.state <> 'unbound' or new.forwarding_onboarding_id is not null
      or new.voice_arrival_policy is not null
    then
      raise exception 'Only exact unbound inbound evidence may lack a tenant'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if new.channel = 'sms' then
    if new.forwarding_onboarding_id is not null
      or new.voice_arrival_policy is not null
    then
      raise exception 'SMS evidence cannot claim Voice forwarding authority'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if new.event_kind = 'dial_result' then
    if new.forwarding_onboarding_id is not null
      or new.voice_arrival_policy <> 'managed_front_door'
    then
      raise exception 'Dial results belong only to managed-front-door Voice'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if new.event_kind <> 'call_received' or new.voice_arrival_policy is null then
    raise exception 'Voice arrival policy is required'
      using errcode = '23514';
  end if;
  if new.voice_arrival_policy = 'managed_front_door' then
    if new.forwarding_onboarding_id is not null then
      raise exception 'Managed-front-door Voice cannot claim forwarding'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if new.forwarding_onboarding_id is null then
    if new.state <> 'recorded'
      or new.state_reason <> 'forwarding_onboarding_unavailable'
      or new.core_provider_event_id is not null
    then
      raise exception
        'Conditional-forward destination without onboarding must stay held'
        using errcode = '23514';
    end if;
    return new;
  end if;
  select onboarding.state into strict selected_forwarding_state
    from ss.responder_forwarding_onboardings onboarding
   where onboarding.id = new.forwarding_onboarding_id
     and onboarding.organization_id = new.organization_id
     and onboarding.project_id = new.project_id
     and onboarding.number_binding_id = new.number_binding_id
     and onboarding.state <> 'retired';
  if (new.state = 'applied' and selected_forwarding_state <> 'ready_held')
    or (new.state = 'recorded'
      and new.state_reason = 'forwarding_not_ready'
      and selected_forwarding_state = 'ready_held')
  then
    raise exception 'Conditional-forward arrival state conflicts with onboarding'
      using errcode = '23514';
  end if;
  return new;
end
$$;

-- An applied conditional-forward arrival is already authoritative missed-call
-- evidence; enqueue the proved follow-up without the managed-front-door Dial
-- callback. The original Dial-result path remains unchanged.
create or replace function ss.enqueue_responder_inbound_followup_v1()
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
    or new.state <> 'applied' or new.core_provider_event_id is null
    or not (
      (new.event_kind = 'dial_result'
        and (new.voice_arrival_policy = 'managed_front_door'
          or new.voice_arrival_policy is null))
      or (new.event_kind = 'call_received'
        and new.voice_arrival_policy =
          'conditional_no_answer_forwarding'
        and new.forwarding_onboarding_id is not null)
    )
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

alter table ss.responder_forwarding_commands enable row level security;
alter table ss.responder_forwarding_commands force row level security;
alter table ss.responder_forwarding_onboardings enable row level security;
alter table ss.responder_forwarding_onboardings force row level security;
alter table ss.responder_forwarding_observations enable row level security;
alter table ss.responder_forwarding_observations force row level security;

revoke all on
  ss.responder_forwarding_commands,
  ss.responder_forwarding_onboardings,
  ss.responder_forwarding_observations
from public, anon, authenticated, service_role;
grant select, insert on ss.responder_forwarding_commands to service_role;
grant select, insert, update on ss.responder_forwarding_onboardings
to service_role;
grant select, insert on ss.responder_forwarding_observations to service_role;

revoke all on function
  ss.responder_forwarding_onboarding_payload_digest_v1(
    uuid, uuid, uuid, uuid, ss.sha256_hex, text, ss.sha256_hex
  ) from public, anon, authenticated;
revoke all on function
  ss.responder_forwarding_observation_digest_v1(
    uuid, text, uuid, ss.sha256_hex, timestamptz
  ) from public, anon, authenticated;
revoke all on function
  ss.responder_forwarding_retirement_payload_digest_v1(
    uuid, text, ss.sha256_hex
  ) from public, anon, authenticated;
revoke all on function
  ss.responder_forwarding_command_request_digest_v1(
    text, uuid, uuid, uuid, uuid, text, bigint, text, ss.sha256_hex
  ) from public, anon, authenticated;
grant execute on function
  ss.responder_forwarding_onboarding_payload_digest_v1(
    uuid, uuid, uuid, uuid, ss.sha256_hex, text, ss.sha256_hex
  ) to service_role;
grant execute on function
  ss.responder_forwarding_observation_digest_v1(
    uuid, text, uuid, ss.sha256_hex, timestamptz
  ) to service_role;
grant execute on function
  ss.responder_forwarding_retirement_payload_digest_v1(
    uuid, text, ss.sha256_hex
  ) to service_role;
grant execute on function
  ss.responder_forwarding_command_request_digest_v1(
    text, uuid, uuid, uuid, uuid, text, bigint, text, ss.sha256_hex
  ) to service_role;

revoke all on function ss.guard_responder_forwarding_command_v1()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_forwarding_observation_v1()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_forwarding_onboarding_v1()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_twilio_inbound_event()
from public, anon, authenticated, service_role;
revoke all on function ss.enqueue_responder_inbound_followup_v1()
from public, anon, authenticated, service_role;

create function ss.hosted_responder_forwarding_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-responder-forwarding-v1-carrier-preserving-held-no-loop'
$$;

revoke all on function ss.hosted_responder_forwarding_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_responder_forwarding_contract_v1()
to service_role;

commit;
