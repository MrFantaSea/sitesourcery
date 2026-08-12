-- DOMAINS-LIFECYCLE-PERSISTENCE-04
-- Canonical provider-neutral expiry, renewal, transfer, replay, and ambiguity
-- state. This migration authorizes no registrar, payment, refund, DNS,
-- publication, or renewal effect.

begin;

create table ss.domain_provider_lifecycle_states (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  customer_id uuid not null,
  provider_pin_id uuid not null,
  domain_name ss.canonical_hostname not null,
  provider_code text not null
    check (provider_code ~ '^[a-z][a-z0-9_-]{1,63}$'),
  provider_pin_fingerprint ss.sha256_hex not null,
  lifecycle_schema text not null
    check (lifecycle_schema = 'sitesourcery.domain-provider-lifecycle/v1'),
  lifecycle_status text not null check (
    lifecycle_status in (
      'active', 'grace', 'redemption', 'expired', 'transferred_out'
    )
  ),
  expiration_date timestamptz not null,
  lifecycle_observed_at timestamptz not null,
  lifecycle_evidence_digest ss.sha256_hex not null,
  renewal_status text not null check (
    renewal_status in (
      'idle', 'quoted', 'dispatching', 'not_submitted', 'submitted',
      'uncertain', 'succeeded', 'reversal_review'
    )
  ),
  renewal_quote_digest ss.sha256_hex,
  renewal_operation_digest ss.sha256_hex,
  renewal_outcome_digest ss.sha256_hex,
  transfer_status text not null check (
    transfer_status in (
      'idle', 'dispatching', 'not_submitted', 'submitted', 'uncertain',
      'cancelled', 'completed', 'reversal_review',
      'external_pending_review', 'external_completion_review'
    )
  ),
  transfer_operation_digest ss.sha256_hex,
  transfer_outcome_digest ss.sha256_hex,
  review_reason text check (
    review_reason is null or char_length(review_reason) between 1 and 128
  ),
  state_document jsonb not null
    check (jsonb_typeof(state_document) = 'object'),
  state_digest ss.sha256_hex not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, provider_pin_id)
    references ss.domain_provider_pins(organization_id, id),
  unique (organization_id, id),
  unique (organization_id, project_id, domain_name),
  unique (provider_pin_id)
);

create table ss.domain_provider_lifecycle_commands (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  lifecycle_state_id uuid not null,
  command_id text not null
    check (char_length(command_id) between 1 and 200),
  command_fingerprint ss.sha256_hex not null,
  result_document jsonb not null
    check (jsonb_typeof(result_document) = 'object'),
  result_digest ss.sha256_hex not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, lifecycle_state_id)
    references ss.domain_provider_lifecycle_states(organization_id, id),
  unique (organization_id, id),
  unique (lifecycle_state_id, command_id)
);

create function ss.validate_domain_provider_lifecycle_state_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  prior_renewal text;
  prior_transfer text;
begin
  if not exists (
    select 1
      from ss.domain_provider_pins pin
     where pin.organization_id = new.organization_id
       and pin.project_id = new.project_id
       and pin.id = new.provider_pin_id
       and pin.domain_name = new.domain_name
       and pin.provider_code = new.provider_code
       and pin.registrar_of_record =
             new.state_document -> 'pin' ->> 'registrarOfRecord'
       and pin.pin_fingerprint = new.provider_pin_fingerprint
  ) then
    raise exception 'domain lifecycle state does not match its provider pin'
      using errcode = '23514';
  end if;

  if ss.project_legal_json_digest(new.state_document) <> new.state_digest
    or new.state_document ->> 'schema' <> new.lifecycle_schema
    or new.state_document -> 'scope' ->> 'organizationId' <>
         new.organization_id::text
    or new.state_document -> 'scope' ->> 'projectId' <>
         new.project_id::text
    or new.state_document -> 'scope' ->> 'customerId' <>
         new.customer_id::text
    or new.state_document -> 'scope' ->> 'actorId' <>
         new.customer_id::text
    or new.state_document -> 'pin' ->> 'domain' <> new.domain_name::text
    or new.state_document -> 'pin' ->> 'providerCode' <> new.provider_code
    or new.state_document -> 'pin' ->> 'fingerprint' <>
         new.provider_pin_fingerprint
    or new.state_document -> 'authoritative' ->> 'lifecycleStatus' <>
         new.lifecycle_status
    or (new.state_document -> 'authoritative' ->> 'expirationDate')::timestamptz <>
         new.expiration_date
    or (new.state_document -> 'authoritative' ->> 'observedAt')::timestamptz <>
         new.lifecycle_observed_at
    or new.state_document -> 'authoritative' ->> 'evidenceDigest' <>
         new.lifecycle_evidence_digest
    or new.state_document -> 'renewal' ->> 'status' <> new.renewal_status
    or (new.state_document -> 'renewal' -> 'quote' ->> 'quoteFingerprint')
         is distinct from new.renewal_quote_digest
    or (new.state_document -> 'renewal' -> 'attempt' ->> 'operationDigest')
         is distinct from new.renewal_operation_digest
    or (new.state_document -> 'renewal' -> 'attempt' ->> 'outcomeDigest')
         is distinct from new.renewal_outcome_digest
    or new.state_document -> 'transfer' ->> 'status' <> new.transfer_status
    or (new.state_document -> 'transfer' -> 'attempt' ->> 'operationDigest')
         is distinct from new.transfer_operation_digest
    or (new.state_document -> 'transfer' -> 'attempt' ->> 'outcomeDigest')
         is distinct from new.transfer_outcome_digest
    or (new.state_document -> 'review' ->> 'reason')
         is distinct from new.review_reason
  then
    raise exception 'domain lifecycle state digest or extracted fields changed'
      using errcode = '23514';
  end if;

  if new.state_document -> 'authoritative' ->> 'autoRenew' <> 'false'
    or jsonb_path_exists(new.state_document, '$.**.providerReference')
    or jsonb_path_exists(new.state_document, '$.**.providerQuoteRef')
    or jsonb_path_exists(new.state_document, '$.**.operationId')
    or new.state_document @? '$.**.providerEffectsAuthorized ? (@ == true)'
    or new.state_document @? '$.**.paymentEffectsAuthorized ? (@ == true)'
    or new.state_document @? '$.**.dnsEffectsAuthorized ? (@ == true)'
  then
    raise exception 'domain lifecycle state retained a raw provider reference or lifted a held effect'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.revision <> 1 then
      raise exception 'domain lifecycle initial revision must be one'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
    or new.project_id is distinct from old.project_id
    or new.customer_id is distinct from old.customer_id
    or new.provider_pin_id is distinct from old.provider_pin_id
    or new.domain_name is distinct from old.domain_name
    or new.provider_code is distinct from old.provider_code
    or new.provider_pin_fingerprint is distinct from
         old.provider_pin_fingerprint
    or new.lifecycle_schema is distinct from old.lifecycle_schema
    or new.created_at is distinct from old.created_at
  then
    raise exception 'domain lifecycle authority is immutable'
      using errcode = '55000';
  end if;
  if new.revision <> old.revision + 1
    or new.updated_at < old.updated_at
  then
    raise exception 'domain lifecycle revision is not monotonic'
      using errcode = '40001';
  end if;
  if new.expiration_date < old.expiration_date then
    raise exception 'domain lifecycle expiration cannot move backwards'
      using errcode = '23514';
  end if;
  if new.lifecycle_observed_at < old.lifecycle_observed_at
    or (
      new.lifecycle_observed_at = old.lifecycle_observed_at
      and new.lifecycle_evidence_digest <>
            old.lifecycle_evidence_digest
    )
  then
    raise exception 'domain lifecycle provider observation conflicts or regresses'
      using errcode = '23514';
  end if;
  if old.lifecycle_status = 'transferred_out'
    and new.lifecycle_status <> 'transferred_out'
  then
    raise exception 'transferred domain custody cannot be restored locally'
      using errcode = '23514';
  end if;

  prior_renewal := old.renewal_status;
  if not (
    new.renewal_status = prior_renewal
    or (prior_renewal in ('idle', 'not_submitted', 'succeeded')
        and new.renewal_status = 'quoted')
    or (prior_renewal = 'quoted' and new.renewal_status = 'dispatching')
    or (prior_renewal = 'dispatching'
        and new.renewal_status in ('not_submitted', 'submitted', 'uncertain'))
    or (prior_renewal in ('submitted', 'uncertain')
        and new.renewal_status = 'succeeded')
    or (prior_renewal = 'succeeded'
        and new.renewal_status = 'reversal_review')
  ) then
    raise exception 'invalid domain renewal lifecycle transition'
      using errcode = '23514';
  end if;

  prior_transfer := old.transfer_status;
  if not (
    new.transfer_status = prior_transfer
    or (prior_transfer in ('idle', 'not_submitted', 'cancelled')
        and new.transfer_status = 'dispatching')
    or (prior_transfer = 'idle'
        and new.transfer_status in (
          'external_pending_review', 'external_completion_review'
        ))
    or (prior_transfer = 'dispatching'
        and new.transfer_status in ('not_submitted', 'submitted', 'uncertain'))
    or (prior_transfer in ('submitted', 'uncertain')
        and new.transfer_status in ('cancelled', 'completed'))
    or (prior_transfer = 'cancelled'
        and new.transfer_status = 'reversal_review')
  ) then
    raise exception 'invalid domain transfer lifecycle transition'
      using errcode = '23514';
  end if;
  if old.transfer_status = 'completed'
    and new.transfer_status <> 'completed'
  then
    raise exception 'completed domain transfer is irreversible'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_provider_lifecycle_state_guard
before insert or update on ss.domain_provider_lifecycle_states
for each row execute function ss.validate_domain_provider_lifecycle_state_v1();

create function ss.validate_domain_provider_lifecycle_command_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
      from ss.domain_provider_lifecycle_states state
     where state.organization_id = new.organization_id
       and state.project_id = new.project_id
       and state.id = new.lifecycle_state_id
  ) then
    raise exception 'domain lifecycle command does not match its state'
      using errcode = '23514';
  end if;
  if ss.project_legal_json_digest(new.result_document) <>
       new.result_digest
  then
    raise exception 'domain lifecycle command result digest changed'
      using errcode = '23514';
  end if;
  if new.result_document @? '$.**.providerEffectsAuthorized ? (@ == true)'
    or jsonb_path_exists(new.result_document, '$.**.providerReference')
    or jsonb_path_exists(new.result_document, '$.**.providerQuoteRef')
    or jsonb_path_exists(new.result_document, '$.**.operationId')
    or new.result_document @? '$.**.paymentEffectsAuthorized ? (@ == true)'
    or new.result_document @? '$.**.dnsEffectsAuthorized ? (@ == true)'
    or new.result_document @? '$.**.captureAuthorized ? (@ == true)'
    or new.result_document @? '$.**.refundAuthorized ? (@ == true)'
  then
    raise exception 'domain lifecycle command retained a raw provider reference or authorized an effect'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger domain_provider_lifecycle_command_guard
before insert on ss.domain_provider_lifecycle_commands
for each row execute function ss.validate_domain_provider_lifecycle_command_v1();

create trigger domain_provider_lifecycle_commands_no_update
before update on ss.domain_provider_lifecycle_commands
for each row execute function ss.reject_update();

create function ss.reject_domain_provider_lifecycle_delete_v1()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception '% is retained lifecycle evidence',
    tg_table_schema || '.' || tg_table_name
    using errcode = '55000';
end
$$;

create trigger domain_provider_lifecycle_states_no_delete
before delete on ss.domain_provider_lifecycle_states
for each row execute function ss.reject_domain_provider_lifecycle_delete_v1();

create trigger domain_provider_lifecycle_commands_no_delete
before delete on ss.domain_provider_lifecycle_commands
for each row execute function ss.reject_domain_provider_lifecycle_delete_v1();

alter table ss.domain_provider_lifecycle_states enable row level security;
alter table ss.domain_provider_lifecycle_states force row level security;
alter table ss.domain_provider_lifecycle_commands enable row level security;
alter table ss.domain_provider_lifecycle_commands force row level security;

create policy domain_provider_lifecycle_states_service_read
on ss.domain_provider_lifecycle_states
for select using (ss.can_access_org(organization_id));

create policy domain_provider_lifecycle_states_service_insert
on ss.domain_provider_lifecycle_states
for insert with check (ss.can_access_org(organization_id));

create policy domain_provider_lifecycle_states_service_update
on ss.domain_provider_lifecycle_states
for update using (ss.can_access_org(organization_id))
with check (ss.can_access_org(organization_id));

create policy domain_provider_lifecycle_commands_service_read
on ss.domain_provider_lifecycle_commands
for select using (ss.can_access_org(organization_id));

create policy domain_provider_lifecycle_commands_service_insert
on ss.domain_provider_lifecycle_commands
for insert with check (ss.can_access_org(organization_id));

revoke all on
  ss.domain_provider_lifecycle_states,
  ss.domain_provider_lifecycle_commands
from public, anon, authenticated, service_role;

grant select, insert, update on ss.domain_provider_lifecycle_states
to service_role;
grant select, insert on ss.domain_provider_lifecycle_commands
to service_role;

revoke all on function
  ss.validate_domain_provider_lifecycle_state_v1(),
  ss.validate_domain_provider_lifecycle_command_v1(),
  ss.reject_domain_provider_lifecycle_delete_v1()
from public, anon, authenticated;

grant execute on function
  ss.validate_domain_provider_lifecycle_state_v1(),
  ss.validate_domain_provider_lifecycle_command_v1(),
  ss.reject_domain_provider_lifecycle_delete_v1()
to service_role;

create function ss.domain_provider_lifecycle_persistence_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-domain-provider-lifecycle-persistence-v1-held'::text
$$;

revoke all on function ss.domain_provider_lifecycle_persistence_contract_v1()
from public, anon, authenticated;
grant execute on function ss.domain_provider_lifecycle_persistence_contract_v1()
to service_role;

commit;
