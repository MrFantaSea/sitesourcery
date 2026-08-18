-- FIN-006E2 native push-token retirement and Twilio Voice session authority
--
-- This migration keeps token and Voice evidence append-only. It permits the
-- same customer's physical app token across that customer's projects, denies
-- cross-customer reassignment, and stores only sealed Voice access tokens.
-- It performs no push, call, carrier, message, provider-network, public,
-- deployment, or cutover effect.

begin;

do $$
begin
  if to_regprocedure('ss.hosted_responder_native_client_contract_v1()') is null
    or ss.hosted_responder_native_client_contract_v1() <>
      'canonical-responder-native-client-v1-held-sealed-token-authority'
  then
    raise exception 'FIN-006E2 requires exact native-client authority'
      using errcode = '55000';
  end if;
end
$$;

create function ss.responder_native_token_retirement_payload_digest_v1(
  selected_actor_user_id uuid,
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_installation_id uuid,
  selected_expected_installation_revision bigint,
  selected_push_purpose text,
  selected_registration_id uuid,
  selected_replacement_registration_id uuid,
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
    'actorUserId', selected_actor_user_id,
    'evidenceDigest', selected_evidence_digest,
    'expectedInstallationRevision',
      selected_expected_installation_revision,
    'installationId', selected_installation_id,
    'organizationId', selected_organization_id,
    'projectId', selected_project_id,
    'pushPurpose', selected_push_purpose,
    'reason', selected_reason,
    'registrationId', selected_registration_id,
    'replacementRegistrationId', selected_replacement_registration_id,
    'schema', 'sitesourcery.responder-native-token-retirement/v1'
  ))
$$;

alter table ss.responder_native_commands
  add column token_retirement_id uuid;

do $$
declare
  selected_constraint record;
begin
  for selected_constraint in
    select constraint_record.conname
      from pg_constraint constraint_record
     where constraint_record.conrelid =
       'ss.responder_native_commands'::regclass
       and constraint_record.contype = 'c'
       and pg_get_expr(
         constraint_record.conbin, constraint_record.conrelid
       ) ~ '\moperation\M'
  loop
    execute format(
      'alter table ss.responder_native_commands drop constraint %I',
      selected_constraint.conname
    );
  end loop;
end
$$;

alter table ss.responder_native_commands
  add constraint responder_native_commands_operation_check check (
    operation in (
      'create_installation', 'register_token', 'retire_token',
      'suspend', 'resume', 'revoke'
    )
  ),
  add constraint responder_native_commands_revision_step_check check (
    resulting_revision = expected_revision + 1
  ),
  add constraint responder_native_commands_operation_shape_check check (
    (operation = 'create_installation' and expected_revision = 0
      and resulting_revision = 1 and resulting_state = 'active'
      and push_purpose is null and token_registration_id is null
      and token_retirement_id is null and state_transition_id is null)
    or (operation = 'register_token' and expected_revision > 0
      and resulting_state = 'active' and push_purpose is not null
      and token_registration_id is not null
      and state_transition_id is null)
    or (operation = 'retire_token' and expected_revision > 0
      and resulting_state = 'active' and push_purpose is not null
      and token_registration_id is null
      and token_retirement_id is not null and state_transition_id is null)
    or (operation = 'suspend' and expected_revision > 0
      and resulting_state = 'suspended' and push_purpose is null
      and token_registration_id is null
      and token_retirement_id is null and state_transition_id is not null)
    or (operation = 'resume' and expected_revision > 0
      and resulting_state = 'active' and push_purpose is null
      and token_registration_id is null
      and token_retirement_id is null and state_transition_id is not null)
    or (operation = 'revoke' and expected_revision > 0
      and resulting_state = 'revoked' and push_purpose is null
      and token_registration_id is null
      and token_retirement_id is null and state_transition_id is not null)
  );

do $$
declare
  selected_constraint_name text;
begin
  select constraint_row.conname
    into selected_constraint_name
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class table_row
      on table_row.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = table_row.relnamespace
    join pg_catalog.pg_attribute attribute_row
      on attribute_row.attrelid = table_row.oid
     and attribute_row.attname = 'token_lookup_digest'
   where namespace_row.nspname = 'ss'
     and table_row.relname =
       'responder_native_push_token_registrations'
     and constraint_row.contype = 'u'
     and constraint_row.conkey = array[attribute_row.attnum]::smallint[];
  if selected_constraint_name is null then
    raise exception using
      errcode = '23514',
      message = 'RESPONDER_NATIVE_TOKEN_UNIQUE_CONSTRAINT_MISSING';
  end if;
  execute format(
    'alter table ss.responder_native_push_token_registrations '
      || 'drop constraint %I',
    selected_constraint_name
  );
end;
$$;

create index responder_native_token_installation_lookup
  on ss.responder_native_push_token_registrations(
    installation_id, push_purpose, token_lookup_digest
  );

create table ss.responder_native_push_token_retirements (
  id uuid primary key,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  installation_id uuid not null,
  command_id text not null,
  registration_id uuid not null,
  replacement_registration_id uuid,
  actor_user_id uuid not null references auth.users(id),
  push_purpose text not null check (
    push_purpose in ('notification', 'voip')
  ),
  reason text not null check (
    reason in ('token_replaced', 'customer_request')
  ),
  expected_installation_revision bigint not null check (
    expected_installation_revision > 0
  ),
  evidence_digest ss.sha256_hex not null,
  created_at timestamptz not null,
  provider_effects boolean not null default false check (not provider_effects),
  push_delivery_effects boolean not null default false
    check (not push_delivery_effects),
  voice_call_effects boolean not null default false
    check (not voice_call_effects),
  carrier_command_effects boolean not null default false
    check (not carrier_command_effects),
  message_send_effects boolean not null default false
    check (not message_send_effects),
  unique (organization_id, id),
  unique (organization_id, command_id),
  unique (organization_id, registration_id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, installation_id)
    references ss.responder_native_installations(organization_id, id),
  foreign key (organization_id, command_id)
    references ss.responder_native_commands(organization_id, command_id),
  foreign key (organization_id, registration_id)
    references ss.responder_native_push_token_registrations(
      organization_id, id
    ),
  foreign key (organization_id, replacement_registration_id)
    references ss.responder_native_push_token_registrations(
      organization_id, id
    ),
  check (
    (reason = 'token_replaced' and replacement_registration_id is not null)
    or (reason <> 'token_replaced'
      and replacement_registration_id is null)
  ),
  check (replacement_registration_id is distinct from registration_id)
);

-- FIN-006E1 allowed a customer to register a newer token for the same
-- installation/purpose without a retirement row because that ledger did not
-- exist yet. Preserve that legal history by binding each superseded row to the
-- exact next registration command before the one-active-token invariant is
-- enabled. No provider call or token plaintext is involved.
create temporary table responder_native_token_retirement_backfill
on commit drop
as
with ordered_registrations as (
  select
    registration.organization_id,
    registration.project_id,
    registration.installation_id,
    registration.id as registration_id,
    registration.push_purpose,
    registration.token_lookup_digest,
    lead(registration.id) over registration_history
      as replacement_registration_id,
    lead(registration.token_lookup_digest) over registration_history
      as replacement_token_lookup_digest,
    lead(command.command_id) over registration_history
      as replacement_command_id,
    lead(command.actor_user_id) over registration_history
      as replacement_actor_user_id,
    lead(command.expected_revision) over registration_history
      as replacement_expected_revision,
    lead(command.created_at) over registration_history
      as replacement_created_at
  from ss.responder_native_push_token_registrations registration
  join ss.responder_native_commands command
    on command.organization_id = registration.organization_id
   and command.command_id = registration.command_id
  window registration_history as (
    partition by registration.organization_id,
      registration.installation_id, registration.push_purpose
    order by command.resulting_revision, command.command_id
  )
), selected_history as (
  select *, ss.service_json_digest(jsonb_build_object(
    'organizationId', organization_id,
    'registrationId', registration_id,
    'replacementRegistrationId', replacement_registration_id,
    'replacementCommandId', replacement_command_id,
    'schema', 'sitesourcery.responder-native-token-retirement-backfill/v1'
  )) as identity_digest
  from ordered_registrations
  where replacement_registration_id is not null
)
select
  (
    substr(identity_digest, 1, 8) || '-' ||
    substr(identity_digest, 9, 4) || '-5' ||
    substr(identity_digest, 14, 3) || '-8' ||
    substr(identity_digest, 18, 3) || '-' ||
    substr(identity_digest, 21, 12)
  )::uuid as id,
  organization_id,
  project_id,
  installation_id,
  replacement_command_id as command_id,
  registration_id,
  replacement_registration_id,
  replacement_actor_user_id as actor_user_id,
  push_purpose,
  'token_replaced'::text as reason,
  replacement_expected_revision as expected_installation_revision,
  ss.service_json_digest(jsonb_build_object(
    'newTokenReferenceDigest', replacement_token_lookup_digest,
    'oldTokenReferenceDigest', token_lookup_digest,
    'pushPurpose', push_purpose,
    'schema', 'sitesourcery.responder-native-token-rotation-evidence/v1'
  )) as evidence_digest,
  replacement_created_at as created_at
from selected_history;

insert into ss.responder_native_push_token_retirements (
  id, organization_id, project_id, installation_id, command_id,
  registration_id, replacement_registration_id, actor_user_id,
  push_purpose, reason, expected_installation_revision,
  evidence_digest, created_at
)
select
  id, organization_id, project_id, installation_id, command_id,
  registration_id, replacement_registration_id, actor_user_id,
  push_purpose, reason, expected_installation_revision,
  evidence_digest, created_at
from responder_native_token_retirement_backfill;

alter table ss.responder_native_commands
  disable trigger responder_native_commands_guard;
update ss.responder_native_commands command
set token_retirement_id = backfill.id
from responder_native_token_retirement_backfill backfill
where command.organization_id = backfill.organization_id
  and command.command_id = backfill.command_id
  and command.operation = 'register_token'
  and command.token_registration_id = backfill.replacement_registration_id
  and command.token_retirement_id is null;
alter table ss.responder_native_commands
  enable trigger responder_native_commands_guard;

do $$
begin
  if exists (
    select 1
    from responder_native_token_retirement_backfill backfill
    left join ss.responder_native_commands command
      on command.organization_id = backfill.organization_id
     and command.command_id = backfill.command_id
    left join ss.responder_native_push_token_retirements retirement
      on retirement.organization_id = backfill.organization_id
     and retirement.id = backfill.id
    where command.token_retirement_id is distinct from backfill.id
       or retirement.registration_id is distinct from backfill.registration_id
       or retirement.replacement_registration_id is distinct from
         backfill.replacement_registration_id
  ) then
    raise exception 'RESPONDER_NATIVE_E1_TOKEN_HISTORY_BACKFILL_FAILED'
      using errcode = '23514';
  end if;
end;
$$;

alter table ss.responder_native_commands
  add foreign key (organization_id, token_retirement_id)
    references ss.responder_native_push_token_retirements(organization_id, id)
    deferrable initially deferred,
  add constraint responder_native_commands_token_registration_once
    unique (organization_id, token_registration_id),
  add constraint responder_native_commands_state_transition_once
    unique (organization_id, state_transition_id),
  add constraint responder_native_commands_token_retirement_once
    unique (organization_id, token_retirement_id);

create function ss.responder_native_voice_session_request_digest_v1(
  selected_actor_user_id uuid,
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_installation_id uuid,
  selected_installation_revision bigint,
  selected_app_environment text,
  selected_voip_registration_reference_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'actorUserId', selected_actor_user_id,
    'appEnvironment', selected_app_environment,
    'installationId', selected_installation_id,
    'installationRevision', selected_installation_revision,
    'organizationId', selected_organization_id,
    'projectId', selected_project_id,
    'schema', 'sitesourcery.responder-native-voice-session-request/v1',
    'voipRegistrationReferenceDigest',
      selected_voip_registration_reference_digest
  ))
$$;

create function ss.responder_native_voice_session_envelope_digest_v1(
  selected_key_version text,
  selected_nonce bytea,
  selected_authentication_tag bytea,
  selected_ciphertext bytea,
  selected_token_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'authenticationTag', encode(selected_authentication_tag, 'hex'),
    'ciphertext', encode(selected_ciphertext, 'hex'),
    'keyVersion', selected_key_version,
    'nonce', encode(selected_nonce, 'hex'),
    'schema', 'sitesourcery.responder-native-voice-session-envelope/v1',
    'tokenDigest', selected_token_digest
  ))
$$;

create table ss.responder_native_voice_sessions (
  id uuid primary key,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  installation_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  request_digest ss.sha256_hex not null,
  installation_revision bigint not null check (installation_revision > 0),
  app_environment text not null check (
    app_environment in ('sandbox', 'production')
  ),
  voip_registration_reference_digest ss.sha256_hex not null,
  identity_digest ss.sha256_hex not null,
  endpoint_digest ss.sha256_hex not null,
  credential_digest ss.sha256_hex not null,
  jti_digest ss.sha256_hex not null,
  token_digest ss.sha256_hex not null,
  key_version text not null check (
    char_length(key_version) between 1 and 40
    and key_version ~ '^[a-z0-9][a-z0-9._-]{0,39}$'
  ),
  nonce bytea not null check (octet_length(nonce) = 12),
  authentication_tag bytea not null check (
    octet_length(authentication_tag) = 16
  ),
  ciphertext bytea not null check (
    octet_length(ciphertext) between 64 and 16384
  ),
  envelope_digest ss.sha256_hex not null unique,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  incoming_allowed boolean not null default true check (incoming_allowed),
  outgoing_allowed boolean not null default false check (not outgoing_allowed),
  provider_authorization_effects boolean not null default true
    check (provider_authorization_effects),
  provider_effects boolean not null default false check (not provider_effects),
  push_delivery_effects boolean not null default false
    check (not push_delivery_effects),
  voice_call_effects boolean not null default false
    check (not voice_call_effects),
  carrier_command_effects boolean not null default false
    check (not carrier_command_effects),
  message_send_effects boolean not null default false
    check (not message_send_effects),
  created_at timestamptz not null,
  unique (organization_id, id),
  unique (organization_id, command_id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, installation_id)
    references ss.responder_native_installations(organization_id, id),
  check (expires_at = issued_at + interval '5 minutes'),
  check (created_at = issued_at)
);

create index responder_native_voice_sessions_installation
  on ss.responder_native_voice_sessions(
    organization_id, installation_id, issued_at desc, id
  );
create index responder_native_token_retirements_current
  on ss.responder_native_push_token_retirements(
    organization_id, installation_id, push_purpose, created_at desc, id
  );

create or replace function ss.guard_responder_native_command_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_revision bigint;
  selected_state text;
  selected_customer uuid;
  selected_platform text;
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'customer'
    or ss.current_service_actor_user_id() is distinct from new.actor_user_id
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or new.created_at > clock_timestamp() + interval '5 minutes'
    or not exists (
      select 1 from ss.organization_memberships membership
       where membership.organization_id = new.organization_id
         and membership.user_id = new.actor_user_id
         and membership.state = 'active'
    )
    or new.request_digest is distinct from
      ss.responder_native_command_request_digest_v1(
        new.actor_user_id, new.organization_id, new.project_id,
        new.installation_id, new.operation, new.expected_revision,
        new.resulting_revision, new.push_purpose, new.payload_digest
      )
  then
    raise exception 'Responder native command authority conflicts'
      using errcode = '42501';
  end if;

  if new.operation = 'create_installation' then
    return new;
  end if;

  select installation.customer_user_id, installation.platform
    into strict selected_customer, selected_platform
    from ss.responder_native_installations installation
   where installation.id = new.installation_id
     and installation.organization_id = new.organization_id
     and installation.project_id = new.project_id;
  if selected_customer <> new.actor_user_id
    or (new.push_purpose = 'voip' and selected_platform <> 'ios')
  then
    raise exception 'Responder native installation authority conflicts'
      using errcode = '42501';
  end if;

  select command.resulting_revision, command.resulting_state
    into strict selected_revision, selected_state
    from ss.responder_native_commands command
   where command.organization_id = new.organization_id
     and command.installation_id = new.installation_id
   order by command.resulting_revision desc
   limit 1;
  if selected_revision <> new.expected_revision
    or (new.operation in ('register_token', 'retire_token', 'suspend')
      and selected_state <> 'active')
    or (new.operation = 'resume' and selected_state <> 'suspended')
    or (new.operation = 'revoke'
      and selected_state not in ('active', 'suspended'))
  then
    raise exception 'Responder native installation revision changed'
      using errcode = '40001';
  end if;
  return new;
end
$$;

create or replace function ss.guard_responder_native_push_token_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_command ss.responder_native_commands%rowtype;
  selected_installation ss.responder_native_installations%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Responder native push-token evidence is immutable'
      using errcode = '55000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'responder-native-token:' || new.token_lookup_digest, 0
  ));
  select * into strict selected_command
    from ss.responder_native_commands command
   where command.organization_id = new.organization_id
     and command.command_id = new.command_id;
  select * into strict selected_installation
    from ss.responder_native_installations installation
   where installation.organization_id = new.organization_id
     and installation.id = new.installation_id
     and installation.project_id = new.project_id;
  if selected_command.operation <> 'register_token'
    or selected_command.token_registration_id <> new.id
    or selected_command.installation_id <> new.installation_id
    or selected_command.project_id <> new.project_id
    or selected_command.push_purpose <> new.push_purpose
    or selected_command.created_at <> new.created_at
    or (new.push_purpose = 'voip'
      and selected_installation.platform <> 'ios')
    or new.envelope_digest is distinct from
      ss.responder_native_token_envelope_digest_v1(
        new.token_lookup_digest, new.key_version, new.nonce,
        new.authentication_tag, new.ciphertext
      )
    or selected_command.payload_digest is distinct from
      ss.responder_native_token_payload_digest_v1(
        new.push_purpose, new.token_lookup_digest
      )
    or exists (
      select 1
        from ss.responder_native_push_token_registrations prior
        join ss.responder_native_installations prior_installation
          on prior_installation.organization_id = prior.organization_id
         and prior_installation.id = prior.installation_id
       where prior.token_lookup_digest = new.token_lookup_digest
         and (
           prior_installation.customer_user_id <>
             selected_installation.customer_user_id
           or prior_installation.platform <> selected_installation.platform
           or prior_installation.bundle_id <> selected_installation.bundle_id
           or prior_installation.app_environment <>
             selected_installation.app_environment
           or prior.push_purpose <> new.push_purpose
         )
    )
  then
    raise exception 'Responder native push-token evidence conflicts'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create function ss.guard_responder_native_token_retirement_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_command ss.responder_native_commands%rowtype;
  selected_registration ss.responder_native_push_token_registrations%rowtype;
  selected_replacement ss.responder_native_push_token_registrations%rowtype;
  selected_latest_operation text;
  selected_latest_registration uuid;
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'customer'
    or ss.current_service_actor_user_id() is distinct from new.actor_user_id
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or new.created_at > clock_timestamp() + interval '5 minutes'
    or not exists (
      select 1 from ss.organization_memberships membership
       where membership.organization_id = new.organization_id
         and membership.user_id = new.actor_user_id
         and membership.state = 'active'
    )
  then
    raise exception 'Responder native token-retirement evidence is immutable'
      using errcode = '42501';
  end if;
  select * into strict selected_command
    from ss.responder_native_commands command
   where command.organization_id = new.organization_id
     and command.command_id = new.command_id;
  select * into strict selected_registration
    from ss.responder_native_push_token_registrations registration
   where registration.organization_id = new.organization_id
     and registration.id = new.registration_id
     and registration.installation_id = new.installation_id
     and registration.project_id = new.project_id
     and registration.push_purpose = new.push_purpose;
  if new.replacement_registration_id is not null then
    select * into strict selected_replacement
      from ss.responder_native_push_token_registrations registration
     where registration.organization_id = new.organization_id
       and registration.id = new.replacement_registration_id
       and registration.installation_id = new.installation_id
       and registration.project_id = new.project_id
       and registration.push_purpose = new.push_purpose;
  end if;
  select command.operation, command.token_registration_id
    into strict selected_latest_operation, selected_latest_registration
    from ss.responder_native_commands command
   where command.organization_id = new.organization_id
     and command.installation_id = new.installation_id
     and command.push_purpose = new.push_purpose
     and command.resulting_revision < selected_command.resulting_revision
   order by command.resulting_revision desc
   limit 1;
  if selected_command.operation not in ('register_token', 'retire_token')
    or selected_command.token_retirement_id <> new.id
    or selected_command.installation_id <> new.installation_id
    or selected_command.project_id <> new.project_id
    or selected_command.actor_user_id <> new.actor_user_id
    or selected_command.push_purpose <> new.push_purpose
    or selected_command.created_at <> new.created_at
    or selected_command.expected_revision <>
      new.expected_installation_revision
    or selected_latest_operation <> 'register_token'
    or selected_latest_registration <> new.registration_id
    or (selected_command.operation = 'register_token' and (
      new.reason <> 'token_replaced'
      or selected_command.token_registration_id <>
        new.replacement_registration_id
      or selected_replacement.command_id <> new.command_id
      or new.evidence_digest is distinct from ss.service_json_digest(
        jsonb_build_object(
          'newTokenReferenceDigest',
            selected_replacement.token_lookup_digest,
          'oldTokenReferenceDigest',
            selected_registration.token_lookup_digest,
          'pushPurpose', new.push_purpose,
          'schema',
            'sitesourcery.responder-native-token-rotation-evidence/v1'
        )
      )
    ))
    or (selected_command.operation = 'retire_token' and (
      new.replacement_registration_id is not null
      or selected_command.token_registration_id is not null
      or selected_command.payload_digest is distinct from
      ss.responder_native_token_retirement_payload_digest_v1(
        new.actor_user_id, new.organization_id, new.project_id,
        new.installation_id, new.expected_installation_revision,
        new.push_purpose, new.registration_id,
        new.replacement_registration_id, new.reason, new.evidence_digest
      )
    ))
  then
    raise exception 'Responder native token-retirement evidence conflicts'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger responder_native_token_retirements_guard
before insert or update or delete
on ss.responder_native_push_token_retirements
for each row execute function ss.guard_responder_native_token_retirement_v1();

create function ss.assert_responder_native_single_active_token_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if (
    select count(*)
      from ss.responder_native_push_token_registrations registration
      left join ss.responder_native_push_token_retirements retirement
        on retirement.organization_id = registration.organization_id
       and retirement.registration_id = registration.id
     where registration.organization_id = new.organization_id
       and registration.installation_id = new.installation_id
       and registration.push_purpose = new.push_purpose
       and retirement.id is null
  ) > 1 then
    raise exception 'Responder native active token authority conflicts'
      using errcode = '23514';
  end if;
  return null;
end
$$;

create constraint trigger responder_native_registration_single_active
after insert on ss.responder_native_push_token_registrations
deferrable initially deferred
for each row execute function ss.assert_responder_native_single_active_token_v1();

create constraint trigger responder_native_retirement_single_active
after insert on ss.responder_native_push_token_retirements
deferrable initially deferred
for each row execute function ss.assert_responder_native_single_active_token_v1();

create function ss.guard_responder_native_voice_session_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_installation ss.responder_native_installations%rowtype;
  selected_revision bigint;
  selected_state text;
  selected_token_operation text;
  selected_token_digest ss.sha256_hex;
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'customer'
    or ss.current_service_actor_user_id() is distinct from new.customer_user_id
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or new.issued_at > clock_timestamp() + interval '5 minutes'
    or new.issued_at < clock_timestamp() - interval '5 minutes'
    or not exists (
      select 1 from ss.organization_memberships membership
       where membership.organization_id = new.organization_id
         and membership.user_id = new.customer_user_id
         and membership.state = 'active'
    )
  then
    raise exception 'Responder native Voice-session authority conflicts'
      using errcode = '42501';
  end if;
  select * into strict selected_installation
    from ss.responder_native_installations installation
   where installation.organization_id = new.organization_id
     and installation.project_id = new.project_id
     and installation.id = new.installation_id
     and installation.customer_user_id = new.customer_user_id;
  select command.resulting_revision, command.resulting_state
    into strict selected_revision, selected_state
    from ss.responder_native_commands command
   where command.organization_id = new.organization_id
     and command.installation_id = new.installation_id
   order by command.resulting_revision desc
   limit 1;
  select command.operation, registration.token_lookup_digest
    into strict selected_token_operation, selected_token_digest
    from ss.responder_native_commands command
    left join ss.responder_native_push_token_registrations registration
      on registration.organization_id = command.organization_id
     and registration.id = command.token_registration_id
   where command.organization_id = new.organization_id
     and command.installation_id = new.installation_id
     and command.push_purpose = 'voip'
   order by command.resulting_revision desc
   limit 1;
  if selected_installation.platform <> 'ios'
    or selected_installation.app_environment <> new.app_environment
    or selected_revision <> new.installation_revision
    or selected_state <> 'active'
    or selected_token_operation <> 'register_token'
    or selected_token_digest is distinct from
      new.voip_registration_reference_digest
    or new.request_digest is distinct from
      ss.responder_native_voice_session_request_digest_v1(
        new.customer_user_id, new.organization_id, new.project_id,
        new.installation_id, new.installation_revision,
        new.app_environment, new.voip_registration_reference_digest
      )
    or new.envelope_digest is distinct from
      ss.responder_native_voice_session_envelope_digest_v1(
        new.key_version, new.nonce, new.authentication_tag,
        new.ciphertext, new.token_digest
      )
  then
    raise exception 'Responder native Voice-session evidence conflicts'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger responder_native_voice_sessions_guard
before insert or update or delete on ss.responder_native_voice_sessions
for each row execute function ss.guard_responder_native_voice_session_v1();

alter table ss.responder_native_push_token_retirements
  enable row level security;
alter table ss.responder_native_push_token_retirements
  force row level security;
alter table ss.responder_native_voice_sessions enable row level security;
alter table ss.responder_native_voice_sessions force row level security;

revoke all on
  ss.responder_native_push_token_retirements,
  ss.responder_native_voice_sessions
from public, anon, authenticated, service_role;
grant select, insert on
  ss.responder_native_push_token_retirements,
  ss.responder_native_voice_sessions
to service_role;

revoke all on function ss.responder_native_token_retirement_payload_digest_v1(
  uuid, uuid, uuid, uuid, bigint, text, uuid, uuid, text, ss.sha256_hex
) from public, anon, authenticated;
revoke all on function ss.responder_native_voice_session_request_digest_v1(
  uuid, uuid, uuid, uuid, bigint, text, ss.sha256_hex
) from public, anon, authenticated;
revoke all on function ss.responder_native_voice_session_envelope_digest_v1(
  text, bytea, bytea, bytea, ss.sha256_hex
) from public, anon, authenticated;
grant execute on function ss.responder_native_token_retirement_payload_digest_v1(
  uuid, uuid, uuid, uuid, bigint, text, uuid, uuid, text, ss.sha256_hex
) to service_role;
grant execute on function ss.responder_native_voice_session_request_digest_v1(
  uuid, uuid, uuid, uuid, bigint, text, ss.sha256_hex
) to service_role;
grant execute on function ss.responder_native_voice_session_envelope_digest_v1(
  text, bytea, bytea, bytea, ss.sha256_hex
) to service_role;

revoke all on function ss.guard_responder_native_token_retirement_v1()
from public, anon, authenticated, service_role;
revoke all on function ss.assert_responder_native_single_active_token_v1()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_native_voice_session_v1()
from public, anon, authenticated, service_role;

create function ss.hosted_responder_native_voice_session_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-responder-native-voice-session-v1-sealed-replay-held'
$$;

revoke all on function ss.hosted_responder_native_voice_session_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_responder_native_voice_session_contract_v1()
to service_role;

commit;
