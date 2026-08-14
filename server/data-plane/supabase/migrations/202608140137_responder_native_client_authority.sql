-- FIN-006E1 held native-client installation and push-token authority
--
-- This migration records tenant-scoped iOS/Android installations and sealed
-- APNs/FCM token registrations. It performs no push, Voice, carrier, message,
-- payment, provider, public, or deployment effect.

begin;

do $$
begin
  if to_regprocedure('ss.hosted_responder_forwarding_contract_v1()') is null
    or ss.hosted_responder_forwarding_contract_v1() <>
      'canonical-responder-forwarding-v1-carrier-preserving-held-no-loop'
  then
    raise exception
      'FIN-006E1 native clients require exact carrier-preserving forwarding'
      using errcode = '55000';
  end if;
end
$$;

create function ss.responder_native_installation_payload_digest_v1(
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_customer_user_id uuid,
  selected_platform text,
  selected_bundle_id text,
  selected_app_environment text,
  selected_app_version text,
  selected_build_number text,
  selected_installation_key_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'appEnvironment', selected_app_environment,
    'appVersion', selected_app_version,
    'buildNumber', selected_build_number,
    'bundleId', selected_bundle_id,
    'customerUserId', selected_customer_user_id,
    'installationKeyDigest', selected_installation_key_digest,
    'organizationId', selected_organization_id,
    'platform', selected_platform,
    'projectId', selected_project_id,
    'schema', 'sitesourcery.responder-native-installation/v1'
  ))
$$;

create function ss.responder_native_token_envelope_digest_v1(
  selected_token_lookup_digest ss.sha256_hex,
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
    'keyVersion', selected_key_version,
    'nonce', encode(selected_nonce, 'base64'),
    'schema', 'sitesourcery.responder-native-push-token-envelope/v1',
    'tokenLookupDigest', selected_token_lookup_digest
  ))
$$;

create function ss.responder_native_token_payload_digest_v1(
  selected_push_purpose text,
  selected_token_lookup_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'pushPurpose', selected_push_purpose,
    'schema', 'sitesourcery.responder-native-token-registration/v1',
    'tokenLookupDigest', selected_token_lookup_digest
  ))
$$;

create function ss.responder_native_state_transition_payload_digest_v1(
  selected_operation text,
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
    'operation', selected_operation,
    'reason', selected_reason,
    'schema', 'sitesourcery.responder-native-state-transition/v1'
  ))
$$;

create function ss.responder_native_command_request_digest_v1(
  selected_actor_user_id uuid,
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_installation_id uuid,
  selected_operation text,
  selected_expected_revision bigint,
  selected_resulting_revision bigint,
  selected_push_purpose text,
  selected_payload_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'actorUserId', selected_actor_user_id,
    'expectedRevision', selected_expected_revision,
    'operation', selected_operation,
    'organizationId', selected_organization_id,
    'payloadDigest', selected_payload_digest,
    'projectId', selected_project_id,
    'pushPurpose', selected_push_purpose,
    'resultingRevision', selected_resulting_revision,
    'schema', 'sitesourcery.responder-native-command/v1',
    'targetInstallationId', case
      when selected_operation = 'create_installation' then null
      else selected_installation_id
    end
  ))
$$;

create table ss.responder_native_commands (
  organization_id uuid not null references ss.organizations(id),
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  request_digest ss.sha256_hex not null unique,
  project_id uuid not null,
  installation_id uuid not null,
  token_registration_id uuid,
  state_transition_id uuid,
  actor_user_id uuid not null references auth.users(id),
  operation text not null check (
    operation in (
      'create_installation', 'register_token', 'suspend', 'resume', 'revoke'
    )
  ),
  expected_revision bigint not null check (expected_revision >= 0),
  resulting_revision bigint not null check (resulting_revision > 0),
  resulting_state text not null check (
    resulting_state in ('active', 'suspended', 'revoked')
  ),
  push_purpose text check (
    push_purpose is null or push_purpose in ('notification', 'voip')
  ),
  payload_digest ss.sha256_hex not null,
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
  primary key (organization_id, command_id),
  unique (organization_id, installation_id, resulting_revision),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  check (resulting_revision = expected_revision + 1),
  check (
    (operation = 'create_installation' and expected_revision = 0
      and resulting_revision = 1 and resulting_state = 'active'
      and push_purpose is null and token_registration_id is null
      and state_transition_id is null)
    or (operation = 'register_token' and expected_revision > 0
      and resulting_state = 'active' and push_purpose is not null
      and token_registration_id is not null and state_transition_id is null)
    or (operation = 'suspend' and expected_revision > 0
      and resulting_state = 'suspended' and push_purpose is null
      and token_registration_id is null and state_transition_id is not null)
    or (operation = 'resume' and expected_revision > 0
      and resulting_state = 'active' and push_purpose is null
      and token_registration_id is null and state_transition_id is not null)
    or (operation = 'revoke' and expected_revision > 0
      and resulting_state = 'revoked' and push_purpose is null
      and token_registration_id is null and state_transition_id is not null)
  )
);

create table ss.responder_native_installations (
  id uuid primary key,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  create_command_id text not null,
  platform text not null check (platform in ('ios', 'android')),
  bundle_id text not null check (
    char_length(bundle_id) between 3 and 200
    and bundle_id ~ '^[A-Za-z0-9][A-Za-z0-9.-]{2,199}$'
  ),
  app_environment text not null check (
    app_environment in ('sandbox', 'production')
  ),
  app_version text not null check (
    char_length(app_version) between 1 and 40
    and app_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$'
  ),
  build_number text not null check (
    char_length(build_number) between 1 and 40
    and build_number ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$'
  ),
  installation_key_digest ss.sha256_hex not null,
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
  unique (
    organization_id, project_id, customer_user_id, installation_key_digest
  ),
  unique (organization_id, create_command_id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, create_command_id)
    references ss.responder_native_commands(organization_id, command_id)
    deferrable initially deferred
);

alter table ss.responder_native_commands
  add foreign key (organization_id, installation_id)
    references ss.responder_native_installations(organization_id, id)
    deferrable initially deferred;

create table ss.responder_native_push_token_registrations (
  id uuid primary key,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  installation_id uuid not null,
  command_id text not null,
  push_purpose text not null check (
    push_purpose in ('notification', 'voip')
  ),
  token_lookup_digest ss.sha256_hex not null unique,
  key_version text not null check (
    char_length(key_version) between 1 and 40
    and key_version ~ '^[a-z0-9][a-z0-9._-]{0,39}$'
  ),
  nonce bytea not null check (octet_length(nonce) = 12),
  authentication_tag bytea not null check (
    octet_length(authentication_tag) = 16
  ),
  ciphertext bytea not null check (
    octet_length(ciphertext) between 16 and 8192
  ),
  envelope_digest ss.sha256_hex not null unique,
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
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, installation_id)
    references ss.responder_native_installations(organization_id, id),
  foreign key (organization_id, command_id)
    references ss.responder_native_commands(organization_id, command_id)
);

create table ss.responder_native_state_transitions (
  id uuid primary key,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  installation_id uuid not null,
  command_id text not null,
  operation text not null check (operation in ('suspend', 'resume', 'revoke')),
  prior_state text not null check (prior_state in ('active', 'suspended')),
  resulting_state text not null check (
    resulting_state in ('active', 'suspended', 'revoked')
  ),
  reason text not null check (
    (operation = 'suspend' and reason = 'logout'
      and prior_state = 'active' and resulting_state = 'suspended')
    or (operation = 'resume' and reason = 'login'
      and prior_state = 'suspended' and resulting_state = 'active')
    or (operation = 'revoke'
      and reason in ('customer_request', 'device_lost', 'token_compromise')
      and prior_state in ('active', 'suspended')
      and resulting_state = 'revoked')
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
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, installation_id)
    references ss.responder_native_installations(organization_id, id),
  foreign key (organization_id, command_id)
    references ss.responder_native_commands(organization_id, command_id)
);

alter table ss.responder_native_commands
  add foreign key (organization_id, token_registration_id)
    references ss.responder_native_push_token_registrations(
      organization_id, id
    )
    deferrable initially deferred,
  add foreign key (organization_id, state_transition_id)
    references ss.responder_native_state_transitions(organization_id, id)
    deferrable initially deferred;

create index responder_native_installations_customer
  on ss.responder_native_installations(
    organization_id, project_id, customer_user_id, created_at desc, id
  );
create index responder_native_commands_current
  on ss.responder_native_commands(
    organization_id, installation_id, resulting_revision desc
  );
create index responder_native_tokens_current
  on ss.responder_native_push_token_registrations(
    organization_id, installation_id, push_purpose, created_at desc, id
  );

create function ss.guard_responder_native_command_v1()
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
    or (new.operation in ('register_token', 'suspend')
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

create trigger responder_native_commands_guard
before insert or update or delete on ss.responder_native_commands
for each row execute function ss.guard_responder_native_command_v1();

create function ss.guard_responder_native_installation_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_command ss.responder_native_commands%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Responder native installations are immutable'
      using errcode = '55000';
  end if;
  select * into strict selected_command
    from ss.responder_native_commands command
   where command.organization_id = new.organization_id
     and command.command_id = new.create_command_id;
  if selected_command.operation <> 'create_installation'
    or selected_command.installation_id <> new.id
    or selected_command.project_id <> new.project_id
    or selected_command.actor_user_id <> new.customer_user_id
    or selected_command.created_at <> new.created_at
    or selected_command.payload_digest is distinct from
      ss.responder_native_installation_payload_digest_v1(
        new.organization_id, new.project_id, new.customer_user_id,
        new.platform, new.bundle_id, new.app_environment,
        new.app_version, new.build_number, new.installation_key_digest
      )
  then
    raise exception 'Responder native installation evidence conflicts'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger responder_native_installations_guard
before insert or update or delete on ss.responder_native_installations
for each row execute function ss.guard_responder_native_installation_v1();

create function ss.guard_responder_native_push_token_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_command ss.responder_native_commands%rowtype;
  selected_platform text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Responder native push-token evidence is immutable'
      using errcode = '55000';
  end if;
  select * into strict selected_command
    from ss.responder_native_commands command
   where command.organization_id = new.organization_id
     and command.command_id = new.command_id;
  select installation.platform into strict selected_platform
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
    or (new.push_purpose = 'voip' and selected_platform <> 'ios')
    or new.envelope_digest is distinct from
      ss.responder_native_token_envelope_digest_v1(
        new.token_lookup_digest, new.key_version, new.nonce,
        new.authentication_tag, new.ciphertext
      )
    or selected_command.payload_digest is distinct from
      ss.responder_native_token_payload_digest_v1(
        new.push_purpose, new.token_lookup_digest
      )
  then
    raise exception 'Responder native push-token evidence conflicts'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger responder_native_push_tokens_guard
before insert or update or delete
on ss.responder_native_push_token_registrations
for each row execute function ss.guard_responder_native_push_token_v1();

create function ss.guard_responder_native_state_transition_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_command ss.responder_native_commands%rowtype;
  selected_prior_state text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Responder native state-transition evidence is immutable'
      using errcode = '55000';
  end if;
  select * into strict selected_command
    from ss.responder_native_commands command
   where command.organization_id = new.organization_id
     and command.command_id = new.command_id;
  select command.resulting_state into strict selected_prior_state
    from ss.responder_native_commands command
   where command.organization_id = new.organization_id
     and command.installation_id = new.installation_id
     and command.resulting_revision = selected_command.expected_revision;
  if selected_command.operation <> new.operation
    or selected_command.state_transition_id <> new.id
    or selected_command.installation_id <> new.installation_id
    or selected_command.project_id <> new.project_id
    or selected_prior_state <> new.prior_state
    or selected_command.resulting_state <> new.resulting_state
    or selected_command.created_at <> new.created_at
    or selected_command.payload_digest is distinct from
      ss.responder_native_state_transition_payload_digest_v1(
        new.operation, new.reason, new.evidence_digest
      )
  then
    raise exception 'Responder native state-transition evidence conflicts'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger responder_native_state_transitions_guard
before insert or update or delete on ss.responder_native_state_transitions
for each row execute function ss.guard_responder_native_state_transition_v1();

alter table ss.responder_native_commands enable row level security;
alter table ss.responder_native_commands force row level security;
alter table ss.responder_native_installations enable row level security;
alter table ss.responder_native_installations force row level security;
alter table ss.responder_native_push_token_registrations
  enable row level security;
alter table ss.responder_native_push_token_registrations
  force row level security;
alter table ss.responder_native_state_transitions enable row level security;
alter table ss.responder_native_state_transitions force row level security;

revoke all on
  ss.responder_native_commands,
  ss.responder_native_installations,
  ss.responder_native_push_token_registrations,
  ss.responder_native_state_transitions
from public, anon, authenticated, service_role;
grant select, insert on
  ss.responder_native_commands,
  ss.responder_native_installations,
  ss.responder_native_push_token_registrations,
  ss.responder_native_state_transitions
to service_role;

revoke all on function ss.responder_native_installation_payload_digest_v1(
  uuid, uuid, uuid, text, text, text, text, text, ss.sha256_hex
) from public, anon, authenticated;
revoke all on function ss.responder_native_token_envelope_digest_v1(
  ss.sha256_hex, text, bytea, bytea, bytea
) from public, anon, authenticated;
revoke all on function ss.responder_native_token_payload_digest_v1(
  text, ss.sha256_hex
) from public, anon, authenticated;
revoke all on function ss.responder_native_state_transition_payload_digest_v1(
  text, text, ss.sha256_hex
) from public, anon, authenticated;
revoke all on function ss.responder_native_command_request_digest_v1(
  uuid, uuid, uuid, uuid, text, bigint, bigint, text, ss.sha256_hex
) from public, anon, authenticated;
grant execute on function ss.responder_native_installation_payload_digest_v1(
  uuid, uuid, uuid, text, text, text, text, text, ss.sha256_hex
) to service_role;
grant execute on function ss.responder_native_token_envelope_digest_v1(
  ss.sha256_hex, text, bytea, bytea, bytea
) to service_role;
grant execute on function ss.responder_native_token_payload_digest_v1(
  text, ss.sha256_hex
) to service_role;
grant execute on function ss.responder_native_state_transition_payload_digest_v1(
  text, text, ss.sha256_hex
) to service_role;
grant execute on function ss.responder_native_command_request_digest_v1(
  uuid, uuid, uuid, uuid, text, bigint, bigint, text, ss.sha256_hex
) to service_role;

revoke all on function ss.guard_responder_native_command_v1()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_native_installation_v1()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_native_push_token_v1()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_responder_native_state_transition_v1()
from public, anon, authenticated, service_role;

create function ss.hosted_responder_native_client_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-responder-native-client-v1-held-sealed-token-authority'
$$;

revoke all on function ss.hosted_responder_native_client_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_responder_native_client_contract_v1()
to service_role;

commit;
