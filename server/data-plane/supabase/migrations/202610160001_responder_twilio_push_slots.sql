-- Explicit optional platform/environment push slots; legacy four-slot rows remain intact.
-- Credential and secret material remain outside PostgreSQL. No provider effects.
begin;

do $$
begin
  if ss.hosted_responder_twilio_isv_topology_contract_v1() <>
    'canonical-responder-twilio-isv-topology-v1-customer-subaccount'
  then raise exception 'Exact prior Twilio topology authority required' using errcode = '55000';
  end if;
end
$$;

alter table ss.responder_twilio_provider_topologies
  alter column voice_sandbox_push_credential_sid_digest drop not null,
  alter column voice_production_push_credential_sid_digest drop not null,
  alter column voice_android_sandbox_push_credential_sid_digest drop not null,
  alter column voice_android_production_push_credential_sid_digest drop not null;

alter table ss.responder_twilio_provider_topologies
  add constraint responder_twilio_at_least_one_push_slot check (
    voice_sandbox_push_credential_sid_digest is not null
    or voice_production_push_credential_sid_digest is not null
    or voice_android_sandbox_push_credential_sid_digest is not null
    or voice_android_production_push_credential_sid_digest is not null
  );

create or replace function ss.guard_responder_twilio_provider_topology()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_kind text := ss.current_service_actor_kind();
  selected_user uuid := ss.current_service_actor_user_id();
  selected_org uuid := ss.current_service_actor_org_id();
  resource_digest ss.sha256_hex;
begin
  if tg_op = 'DELETE' then
    raise exception 'Responder Twilio provider topology is durable'
      using errcode = '55000';
  end if;
  if selected_kind <> 'operator'
    or new.organization_id is distinct from selected_org
    or not ss.service_operator_has_capability(
      selected_user, 'service_management_manage', clock_timestamp()
    )
  then
    raise exception 'Responder Twilio topology requires exact operator authority'
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'active'
      or new.revision <> 1
      or new.attested_by_user_id is distinct from selected_user
    then
      raise exception 'Responder Twilio topology must begin active'
        using errcode = '23514';
    end if;
    if new.messaging_api_key_sid_digest = new.voice_api_key_sid_digest
      or new.messaging_api_key_secret_digest in (
        new.webhook_auth_token_digest, new.voice_api_key_secret_digest
      )
      or new.webhook_auth_token_digest = new.voice_api_key_secret_digest
      or new.voice_sandbox_push_credential_sid_digest in (
        new.voice_production_push_credential_sid_digest,
        new.voice_android_sandbox_push_credential_sid_digest,
        new.voice_android_production_push_credential_sid_digest
      )
      or new.voice_production_push_credential_sid_digest in (
        new.voice_android_sandbox_push_credential_sid_digest,
        new.voice_android_production_push_credential_sid_digest
      )
      or new.voice_android_sandbox_push_credential_sid_digest =
        new.voice_android_production_push_credential_sid_digest
    then
      raise exception 'Twilio customer resources must be purpose-separated'
        using errcode = '23514';
    end if;

    -- Cross-column uniqueness needs one common lock namespace per resource
    -- family. The trigger owns these locks so every service-role writer, not
    -- only the hosted repository, is race-safe.
    for resource_digest in
      select distinct value
        from unnest(array[
          new.messaging_api_key_sid_digest,
          new.voice_api_key_sid_digest
        ]::ss.sha256_hex[]) value
       order by value
    loop
      perform pg_advisory_xact_lock(hashtextextended(
        'responder-twilio-api-key:' || resource_digest, 0
      ));
    end loop;
    for resource_digest in
      select distinct value
        from unnest(array[
          new.messaging_api_key_secret_digest,
          new.webhook_auth_token_digest,
          new.voice_api_key_secret_digest
        ]::ss.sha256_hex[]) value
       order by value
    loop
      perform pg_advisory_xact_lock(hashtextextended(
        'responder-twilio-secret:' || resource_digest, 0
      ));
    end loop;
    for resource_digest in
      select distinct value
        from unnest(array[
          new.voice_sandbox_push_credential_sid_digest,
          new.voice_production_push_credential_sid_digest,
          new.voice_android_sandbox_push_credential_sid_digest,
          new.voice_android_production_push_credential_sid_digest
        ]::ss.sha256_hex[]) value
       where value is not null
       order by value
    loop
      perform pg_advisory_xact_lock(hashtextextended(
        'responder-twilio-push-credential:' || resource_digest, 0
      ));
    end loop;
    if exists (
      select 1
        from ss.responder_twilio_provider_topologies topology
       where topology.state = 'active'
         and (
           topology.messaging_api_key_sid_digest in (
             new.messaging_api_key_sid_digest, new.voice_api_key_sid_digest
           )
           or topology.voice_api_key_sid_digest in (
             new.messaging_api_key_sid_digest, new.voice_api_key_sid_digest
           )
           or topology.messaging_api_key_secret_digest in (
             new.messaging_api_key_secret_digest,
             new.webhook_auth_token_digest,
             new.voice_api_key_secret_digest
           )
           or topology.webhook_auth_token_digest in (
             new.messaging_api_key_secret_digest,
             new.webhook_auth_token_digest,
             new.voice_api_key_secret_digest
           )
           or topology.voice_api_key_secret_digest in (
             new.messaging_api_key_secret_digest,
             new.webhook_auth_token_digest,
             new.voice_api_key_secret_digest
           )
           or topology.voice_sandbox_push_credential_sid_digest in (
             new.voice_sandbox_push_credential_sid_digest,
             new.voice_production_push_credential_sid_digest,
             new.voice_android_sandbox_push_credential_sid_digest,
             new.voice_android_production_push_credential_sid_digest
           )
           or topology.voice_production_push_credential_sid_digest in (
             new.voice_sandbox_push_credential_sid_digest,
             new.voice_production_push_credential_sid_digest,
             new.voice_android_sandbox_push_credential_sid_digest,
             new.voice_android_production_push_credential_sid_digest
           )
           or topology.voice_android_sandbox_push_credential_sid_digest in (
             new.voice_sandbox_push_credential_sid_digest,
             new.voice_production_push_credential_sid_digest,
             new.voice_android_sandbox_push_credential_sid_digest,
             new.voice_android_production_push_credential_sid_digest
           )
           or topology.voice_android_production_push_credential_sid_digest in (
             new.voice_sandbox_push_credential_sid_digest,
             new.voice_production_push_credential_sid_digest,
             new.voice_android_sandbox_push_credential_sid_digest,
             new.voice_android_production_push_credential_sid_digest
           )
         )
    ) then
      raise exception 'Twilio customer resource is already active elsewhere'
        using errcode = '23505';
    end if;
    return new;
  end if;
  if exists (
    select 1
      from ss.responder_provider_number_bindings binding
     where binding.organization_id = old.organization_id
       and binding.provider = old.provider
       and binding.state = 'active'
       and binding.account_sid_digest = old.account_sid_digest
       and (
         binding.messaging_service_sid_digest is null
         or binding.messaging_service_sid_digest =
           old.messaging_service_sid_digest
       )
  ) then
    raise exception 'Retire active customer number bindings before topology'
      using errcode = '23514';
  end if;
  if row(
    new.id, new.command_id, new.request_digest, new.organization_id,
    new.provider, new.account_sid_digest, new.messaging_service_sid_digest,
    new.customer_profile_sid_digest, new.brand_registration_sid_digest,
    new.campaign_sid_digest, new.messaging_api_key_sid_digest,
    new.messaging_api_key_secret_digest, new.webhook_auth_token_digest,
    new.voice_api_key_sid_digest, new.voice_api_key_secret_digest,
    new.voice_sandbox_push_credential_sid_digest,
    new.voice_production_push_credential_sid_digest,
    new.voice_android_sandbox_push_credential_sid_digest,
    new.voice_android_production_push_credential_sid_digest,
    new.registration_class, new.provider_brand_type,
    new.campaign_use_case, new.provider_readback_digest,
    new.topology_evidence_digest, new.attested_by_user_id,
    new.attested_at, new.created_at
  ) is distinct from row(
    old.id, old.command_id, old.request_digest, old.organization_id,
    old.provider, old.account_sid_digest, old.messaging_service_sid_digest,
    old.customer_profile_sid_digest, old.brand_registration_sid_digest,
    old.campaign_sid_digest, old.messaging_api_key_sid_digest,
    old.messaging_api_key_secret_digest, old.webhook_auth_token_digest,
    old.voice_api_key_sid_digest, old.voice_api_key_secret_digest,
    old.voice_sandbox_push_credential_sid_digest,
    old.voice_production_push_credential_sid_digest,
    old.voice_android_sandbox_push_credential_sid_digest,
    old.voice_android_production_push_credential_sid_digest,
    old.registration_class, old.provider_brand_type,
    old.campaign_use_case, old.provider_readback_digest,
    old.topology_evidence_digest, old.attested_by_user_id,
    old.attested_at, old.created_at
  )
    or old.state <> 'active'
    or new.state <> 'retired'
    or new.revision <> old.revision + 1
    or new.updated_at < old.updated_at
    or new.retired_by_user_id is distinct from selected_user
  then
    raise exception 'Responder Twilio topology retirement is the only transition'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create function ss.hosted_responder_twilio_isv_topology_contract_v2()
returns text language sql stable set search_path = pg_catalog
as $$ select 'canonical-responder-twilio-isv-topology-v2-explicit-push-slots' $$;
revoke all on function ss.hosted_responder_twilio_isv_topology_contract_v2()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_responder_twilio_isv_topology_contract_v2()
to service_role;

commit;
