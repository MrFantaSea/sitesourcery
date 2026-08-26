-- FIN-013-RESPONDER-TWILIO-ISV-TOPOLOGY-01
--
-- Stores only customer-scoped Twilio authority digests and immutable operator
-- evidence. Provider identifiers and secrets stay outside PostgreSQL. Every
-- active number binding must agree with the same organization's active
-- subaccount topology. This migration performs no provider or customer effect.

begin;

do $$
begin
  if to_regprocedure('ss.hosted_responder_twilio_inbound_contract_v1()') is null
    or ss.hosted_responder_twilio_inbound_contract_v1() <>
      'canonical-responder-twilio-inbound-v1-keyed-lookup-tenant-bound'
  then
    raise exception 'FIN-013 requires exact Twilio inbound authority'
      using errcode = '55000';
  end if;
end
$$;

create table ss.responder_twilio_provider_topologies (
  id uuid primary key,
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  request_digest ss.sha256_hex not null,
  organization_id uuid not null references ss.organizations(id),
  provider text not null check (provider = 'twilio'),
  account_sid_digest ss.sha256_hex not null,
  messaging_service_sid_digest ss.sha256_hex not null,
  customer_profile_sid_digest ss.sha256_hex not null,
  brand_registration_sid_digest ss.sha256_hex not null,
  campaign_sid_digest ss.sha256_hex not null,
  messaging_api_key_sid_digest ss.sha256_hex not null,
  messaging_api_key_secret_digest ss.sha256_hex not null,
  webhook_auth_token_digest ss.sha256_hex not null,
  voice_api_key_sid_digest ss.sha256_hex not null,
  voice_api_key_secret_digest ss.sha256_hex not null,
  voice_sandbox_push_credential_sid_digest ss.sha256_hex not null,
  voice_production_push_credential_sid_digest ss.sha256_hex not null,
  voice_android_sandbox_push_credential_sid_digest ss.sha256_hex not null,
  voice_android_production_push_credential_sid_digest ss.sha256_hex not null,
  registration_class text not null check (
    registration_class in (
      'STANDARD', 'LOW_VOLUME_STANDARD', 'SOLE_PROPRIETOR'
    )
  ),
  provider_brand_type text not null check (
    provider_brand_type in ('STANDARD', 'SOLE_PROPRIETOR')
  ),
  campaign_use_case text not null check (campaign_use_case = 'CUSTOMER_CARE'),
  provider_readback_digest ss.sha256_hex not null,
  topology_evidence_digest ss.sha256_hex not null,
  state text not null check (state in ('active', 'retired')),
  attested_by_user_id uuid not null references auth.users(id),
  attested_at timestamptz not null,
  retired_at timestamptz,
  retired_by_user_id uuid references auth.users(id),
  retire_evidence_digest ss.sha256_hex,
  retired_reason text check (
    retired_reason is null or retired_reason in (
      'customer_cancelled', 'provider_replaced', 'operator_correction'
    )
  ),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (organization_id, id),
  check (created_at = attested_at),
  check (updated_at >= created_at),
  check (
    (registration_class = 'SOLE_PROPRIETOR'
      and provider_brand_type = 'SOLE_PROPRIETOR')
    or (registration_class in ('STANDARD', 'LOW_VOLUME_STANDARD')
      and provider_brand_type = 'STANDARD')
  ),
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
      and retired_at >= attested_at)
  )
);

create unique index responder_twilio_one_active_topology_per_customer
  on ss.responder_twilio_provider_topologies(organization_id)
  where state = 'active';
create unique index responder_twilio_one_active_subaccount
  on ss.responder_twilio_provider_topologies(account_sid_digest)
  where state = 'active';
create unique index responder_twilio_one_active_messaging_service
  on ss.responder_twilio_provider_topologies(messaging_service_sid_digest)
  where state = 'active';
create unique index responder_twilio_one_active_customer_profile
  on ss.responder_twilio_provider_topologies(customer_profile_sid_digest)
  where state = 'active';
create unique index responder_twilio_one_active_brand
  on ss.responder_twilio_provider_topologies(brand_registration_sid_digest)
  where state = 'active';
create unique index responder_twilio_one_active_campaign
  on ss.responder_twilio_provider_topologies(campaign_sid_digest)
  where state = 'active';
create unique index responder_twilio_one_active_messaging_api_key
  on ss.responder_twilio_provider_topologies(messaging_api_key_sid_digest)
  where state = 'active';
create unique index responder_twilio_one_active_messaging_api_secret
  on ss.responder_twilio_provider_topologies(messaging_api_key_secret_digest)
  where state = 'active';
create unique index responder_twilio_one_active_webhook_token
  on ss.responder_twilio_provider_topologies(webhook_auth_token_digest)
  where state = 'active';
create unique index responder_twilio_one_active_voice_api_key
  on ss.responder_twilio_provider_topologies(voice_api_key_sid_digest)
  where state = 'active';
create unique index responder_twilio_one_active_voice_api_secret
  on ss.responder_twilio_provider_topologies(voice_api_key_secret_digest)
  where state = 'active';
create unique index responder_twilio_one_active_ios_sandbox_push
  on ss.responder_twilio_provider_topologies(
    voice_sandbox_push_credential_sid_digest
  ) where state = 'active';
create unique index responder_twilio_one_active_ios_production_push
  on ss.responder_twilio_provider_topologies(
    voice_production_push_credential_sid_digest
  ) where state = 'active';
create unique index responder_twilio_one_active_android_sandbox_push
  on ss.responder_twilio_provider_topologies(
    voice_android_sandbox_push_credential_sid_digest
  ) where state = 'active';
create unique index responder_twilio_one_active_android_production_push
  on ss.responder_twilio_provider_topologies(
    voice_android_production_push_credential_sid_digest
  ) where state = 'active';

create function ss.guard_responder_twilio_provider_topology()
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

create trigger responder_twilio_provider_topologies_guard
before insert or update or delete on ss.responder_twilio_provider_topologies
for each row execute function ss.guard_responder_twilio_provider_topology();

-- Upgrade the existing number-binding guard so a raw number can never be
-- attached to a different customer subaccount or Messaging Service.
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
    then
      raise exception 'Responder number binding must begin active'
        using errcode = '23514';
    end if;
    if not exists (
      select 1
        from ss.responder_twilio_provider_topologies topology
       where topology.organization_id = new.organization_id
         and topology.provider = new.provider
         and topology.state = 'active'
         and topology.account_sid_digest = new.account_sid_digest
         and (
           new.messaging_service_sid_digest is null
           or topology.messaging_service_sid_digest =
             new.messaging_service_sid_digest
         )
    ) then
      raise exception 'Responder number binding requires matching active customer topology'
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

do $$
begin
  if exists (
    select 1
      from ss.responder_provider_number_bindings binding
     where binding.state = 'active'
       and not exists (
         select 1
           from ss.responder_twilio_provider_topologies topology
          where topology.organization_id = binding.organization_id
            and topology.provider = binding.provider
            and topology.state = 'active'
            and topology.account_sid_digest = binding.account_sid_digest
            and (
              binding.messaging_service_sid_digest is null
              or topology.messaging_service_sid_digest =
                binding.messaging_service_sid_digest
            )
       )
  ) then
    raise exception 'Existing active Responder number binding lacks customer topology'
      using errcode = '55000';
  end if;
end
$$;

alter table ss.responder_twilio_provider_topologies enable row level security;
alter table ss.responder_twilio_provider_topologies force row level security;
revoke all on ss.responder_twilio_provider_topologies
from public, anon, authenticated, service_role;
grant select, insert, update on ss.responder_twilio_provider_topologies
to service_role;
revoke all on function ss.guard_responder_twilio_provider_topology()
from public, anon, authenticated, service_role;

create function ss.hosted_responder_twilio_isv_topology_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-responder-twilio-isv-topology-v1-customer-subaccount'
$$;

revoke all on function ss.hosted_responder_twilio_isv_topology_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_responder_twilio_isv_topology_contract_v1()
to service_role;

commit;
