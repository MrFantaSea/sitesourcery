-- FIN-006E3 Android dual-purpose FCM ownership and Voice authority
--
-- Android uses one physical FCM token for ordinary and Voice delivery. This
-- migration keeps purpose-bound lookup/ciphertext evidence while adding a
-- purpose-neutral keyed ownership digest, then binds Voice sessions to the
-- exact client platform and transport. It performs no provider, push, call,
-- carrier, message, public, deployment, or cutover effect.

begin;

do $$
begin
  if to_regprocedure('ss.hosted_responder_native_client_contract_v1()') is null
    or ss.hosted_responder_native_client_contract_v1() <>
      'canonical-responder-native-client-v1-held-sealed-token-authority'
    or to_regprocedure(
      'ss.hosted_responder_native_voice_session_contract_v1()'
    ) is null
    or ss.hosted_responder_native_voice_session_contract_v1() <>
      'canonical-responder-native-voice-session-v1-sealed-replay-held'
  then
    raise exception 'FIN-006E3 requires exact native Voice authority'
      using errcode = '55000';
  end if;
end
$$;

-- FIN-006E2 Voice envelopes were bound to an authority shape that did not
-- include platform or transport.  Do not silently reinterpret an unexpired
-- v1 envelope under the v2 authority below.  The five-minute sessions are
-- deliberately drained before this migration and the table lock prevents a
-- new v1 session from racing the check.
lock table ss.responder_native_voice_sessions in access exclusive mode;
do $$
begin
  if exists (
    select 1
      from ss.responder_native_voice_sessions voice_session
     where voice_session.expires_at > clock_timestamp()
  ) then
    raise exception 'FIN-006E3 requires expired FIN-006E2 Voice sessions'
      using errcode = '55000';
  end if;
end
$$;

alter table ss.responder_native_push_token_registrations
  add column token_ownership_digest ss.sha256_hex,
  add column token_ownership_kind text,
  add column token_receipt_digest ss.sha256_hex;

-- Migrations 137/138 contain only purpose-bound lookup evidence. Preserve it
-- as a conservative legacy ownership reference without claiming that the raw
-- physical token was re-observed.
alter table ss.responder_native_push_token_registrations
  disable trigger responder_native_push_tokens_guard;
update ss.responder_native_push_token_registrations
   set token_ownership_digest = token_lookup_digest,
       token_ownership_kind = 'legacy_purpose_bound';
alter table ss.responder_native_push_token_registrations
  enable trigger responder_native_push_tokens_guard;

alter table ss.responder_native_push_token_registrations
  alter column token_ownership_digest set not null,
  alter column token_ownership_kind set not null,
  add constraint responder_native_token_ownership_kind_check check (
    token_ownership_kind in ('legacy_purpose_bound', 'physical_v1')
  ),
  add constraint responder_native_token_receipt_posture_check check (
    (token_ownership_kind = 'legacy_purpose_bound'
      and token_receipt_digest is null)
    or (token_ownership_kind = 'physical_v1'
      and token_receipt_digest is not null)
  );

create index responder_native_token_ownership_lookup
  on ss.responder_native_push_token_registrations(
    token_ownership_digest, push_purpose, created_at desc, id
  );

create function ss.responder_native_token_payload_digest_v2(
  selected_push_purpose text,
  selected_token_lookup_digest ss.sha256_hex,
  selected_token_ownership_digest ss.sha256_hex,
  selected_token_receipt_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'pushPurpose', selected_push_purpose,
    'schema', 'sitesourcery.responder-native-token-registration/v2',
    'tokenLookupDigest', selected_token_lookup_digest,
    'tokenOwnershipDigest', selected_token_ownership_digest,
    'tokenReceiptDigest', selected_token_receipt_digest
  ))
$$;

create function ss.responder_native_token_envelope_digest_v2(
  selected_token_lookup_digest ss.sha256_hex,
  selected_token_ownership_digest ss.sha256_hex,
  selected_token_receipt_digest ss.sha256_hex,
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
    'authenticationTag', encode(selected_authentication_tag, 'hex'),
    'ciphertext', encode(selected_ciphertext, 'hex'),
    'keyVersion', selected_key_version,
    'nonce', encode(selected_nonce, 'hex'),
    'schema', 'sitesourcery.responder-native-token-envelope/v2',
    'tokenLookupDigest', selected_token_lookup_digest,
    'tokenOwnershipDigest', selected_token_ownership_digest,
    'tokenReceiptDigest', selected_token_receipt_digest
  ))
$$;

alter table ss.responder_native_voice_sessions
  add column client_platform text not null default 'ios',
  add column transport text not null default 'twilio_voice_ios';
alter table ss.responder_native_voice_sessions
  alter column client_platform drop default,
  alter column transport drop default,
  add constraint responder_native_voice_platform_transport_check check (
    (client_platform = 'ios' and transport = 'twilio_voice_ios')
    or (client_platform = 'android' and transport = 'twilio_voice_android')
  );

create function ss.responder_native_voice_session_request_digest_v2(
  selected_actor_user_id uuid,
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_installation_id uuid,
  selected_installation_revision bigint,
  selected_client_platform text,
  selected_transport text,
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
    'clientPlatform', selected_client_platform,
    'installationId', selected_installation_id,
    'installationRevision', selected_installation_revision,
    'organizationId', selected_organization_id,
    'projectId', selected_project_id,
    'schema', 'sitesourcery.responder-native-voice-session-request/v2',
    'transport', selected_transport,
    'voipRegistrationReferenceDigest',
      selected_voip_registration_reference_digest
  ))
$$;

create function ss.responder_native_voice_session_envelope_digest_v2(
  selected_client_platform text,
  selected_transport text,
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
    'clientPlatform', selected_client_platform,
    'keyVersion', selected_key_version,
    'nonce', encode(selected_nonce, 'hex'),
    'schema', 'sitesourcery.responder-native-voice-session-envelope/v2',
    'tokenDigest', selected_token_digest,
    'transport', selected_transport
  ))
$$;

create or replace function ss.guard_responder_native_command_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_revision bigint;
  selected_state text;
  selected_customer uuid;
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

  select installation.customer_user_id into strict selected_customer
    from ss.responder_native_installations installation
   where installation.id = new.installation_id
     and installation.organization_id = new.organization_id
     and installation.project_id = new.project_id;
  if selected_customer <> new.actor_user_id then
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
    'responder-native-token-ownership:' || new.token_ownership_digest, 0
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
    or new.token_ownership_kind <> 'physical_v1'
    or new.envelope_digest is distinct from
      ss.responder_native_token_envelope_digest_v2(
        new.token_lookup_digest, new.token_ownership_digest,
        new.token_receipt_digest,
        new.key_version, new.nonce, new.authentication_tag, new.ciphertext
      )
    or selected_command.payload_digest is distinct from
      ss.responder_native_token_payload_digest_v2(
        new.push_purpose, new.token_lookup_digest,
        new.token_ownership_digest, new.token_receipt_digest
      )
    or exists (
      select 1
        from ss.responder_native_push_token_registrations prior
        join ss.responder_native_installations prior_installation
          on prior_installation.organization_id = prior.organization_id
         and prior_installation.id = prior.installation_id
       where (
         prior.token_ownership_digest = new.token_ownership_digest
         or prior.token_lookup_digest = new.token_lookup_digest
       )
         and (
           prior_installation.customer_user_id <>
             selected_installation.customer_user_id
           or prior_installation.platform <> selected_installation.platform
           or prior_installation.bundle_id <> selected_installation.bundle_id
           or prior_installation.app_environment <>
             selected_installation.app_environment
           or (
             prior.token_ownership_digest = new.token_ownership_digest
             and prior.push_purpose <> new.push_purpose
             and selected_installation.platform <> 'android'
           )
         )
    )
  then
    raise exception 'Responder native push-token evidence conflicts'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function ss.guard_responder_native_voice_session_v1()
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
  if selected_installation.platform <> new.client_platform
    or new.transport <> 'twilio_voice_' || new.client_platform
    or selected_installation.app_environment <> new.app_environment
    or selected_revision <> new.installation_revision
    or selected_state <> 'active'
    or selected_token_operation <> 'register_token'
    or selected_token_digest is distinct from
      new.voip_registration_reference_digest
    or new.request_digest is distinct from
      ss.responder_native_voice_session_request_digest_v2(
        new.customer_user_id, new.organization_id, new.project_id,
        new.installation_id, new.installation_revision,
        new.client_platform, new.transport, new.app_environment,
        new.voip_registration_reference_digest
      )
    or new.envelope_digest is distinct from
      ss.responder_native_voice_session_envelope_digest_v2(
        new.client_platform, new.transport, new.key_version, new.nonce,
        new.authentication_tag, new.ciphertext, new.token_digest
      )
  then
    raise exception 'Responder native Voice-session evidence conflicts'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function ss.responder_native_token_payload_digest_v2(
  text, ss.sha256_hex, ss.sha256_hex, ss.sha256_hex
) from public, anon, authenticated;
revoke all on function ss.responder_native_token_envelope_digest_v2(
  ss.sha256_hex, ss.sha256_hex, ss.sha256_hex, text, bytea, bytea, bytea
) from public, anon, authenticated;
revoke all on function ss.responder_native_voice_session_request_digest_v2(
  uuid, uuid, uuid, uuid, bigint, text, text, text, ss.sha256_hex
) from public, anon, authenticated;
revoke all on function ss.responder_native_voice_session_envelope_digest_v2(
  text, text, text, bytea, bytea, bytea, ss.sha256_hex
) from public, anon, authenticated;

grant execute on function ss.responder_native_token_payload_digest_v2(
  text, ss.sha256_hex, ss.sha256_hex, ss.sha256_hex
) to service_role;
grant execute on function ss.responder_native_token_envelope_digest_v2(
  ss.sha256_hex, ss.sha256_hex, ss.sha256_hex, text, bytea, bytea, bytea
) to service_role;
grant execute on function ss.responder_native_voice_session_request_digest_v2(
  uuid, uuid, uuid, uuid, bigint, text, text, text, ss.sha256_hex
) to service_role;
grant execute on function ss.responder_native_voice_session_envelope_digest_v2(
  text, text, text, bytea, bytea, bytea, ss.sha256_hex
) to service_role;

create function ss.hosted_responder_android_voice_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-responder-android-voice-v1-fcm-dual-purpose-receipt-bound-held'
$$;

revoke all on function ss.hosted_responder_android_voice_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_responder_android_voice_contract_v1()
to service_role;

commit;
