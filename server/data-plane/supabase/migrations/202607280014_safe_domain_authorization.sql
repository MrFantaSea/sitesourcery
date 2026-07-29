begin;

-- Migration 006 originally required a captured domain payment before the
-- registrar operation. That ordering can charge a customer for a name the
-- registrar never creates. Domain purchases instead use:
--
--   manual authorization -> exact price recheck -> registrar create/readback
--   -> capture -> active registration projection
--
-- Provider receipts remain immutable. The allocation projection may advance
-- through the narrow payment state machine below while its quote, currency,
-- amount, and PaymentIntent reference remain fixed.

alter table ss.domain_payment_allocations
  drop constraint domain_payment_allocations_state_check;

alter table ss.domain_payment_allocations
  add column authorized_at timestamptz,
  add column authorization_expires_at timestamptz,
  add column captured_at timestamptz,
  add constraint domain_payment_allocations_state_check
    check (
      state in (
        'authorized',
        'captured',
        'voided',
        'refunded',
        'manual_review'
      )
    ),
  add constraint domain_payment_allocations_timestamps_check
    check (
      (
        state = 'authorized'
        and authorized_at is not null
        and authorization_expires_at > authorized_at
        and captured_at is null
      )
      or (
        state in ('captured', 'refunded')
        and authorized_at is not null
        and authorization_expires_at > authorized_at
        and captured_at is not null
        and captured_at >= authorized_at
      )
      or state in ('voided', 'manual_review')
    );

drop trigger domain_payment_allocations_no_update
on ss.domain_payment_allocations;

drop trigger domain_payment_is_stripe_not_registrar
on ss.domain_payment_allocations;

create or replace function ss.validate_domain_payment()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  expected_receipt_kind text;
begin
  expected_receipt_kind := case new.state
    when 'authorized' then 'domain_payment_authorized'
    when 'captured' then 'domain_payment_captured'
    when 'voided' then 'domain_payment_voided'
    when 'refunded' then 'domain_payment_refunded'
    else 'domain_payment_manual_review'
  end;

  if not exists (
    select 1
    from ss.domain_quotes quote
    join ss.provider_receipts receipt
      on receipt.organization_id = quote.organization_id
     and receipt.project_id = quote.project_id
    join ss.domain_procurement_control control
      on control.singleton
    where quote.organization_id = new.organization_id
      and quote.project_id = new.project_id
      and quote.id = new.quote_id
      and receipt.id = new.stripe_provider_receipt_id
      and receipt.provider_code = 'stripe'
      and receipt.receipt_kind = expected_receipt_kind
      and receipt.external_object_ref = new.stripe_payment_reference
      and control.purchasing_enabled
      and control.active_provider_code = quote.provider_code
      and quote.currency = new.currency
      and quote.customer_price_minor = new.amount_minor
      and receipt.facts ->> 'quoteId' = new.quote_id::text
      and receipt.facts ->> 'currency' = new.currency
      and (receipt.facts ->> 'amountMinor')::bigint = new.amount_minor
  ) then
    raise exception 'domain payment must be separate exact Stripe evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create function ss.validate_domain_payment_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.project_id is distinct from old.project_id
    or new.quote_id is distinct from old.quote_id
    or new.stripe_payment_reference is distinct from old.stripe_payment_reference
    or new.currency is distinct from old.currency
    or new.amount_minor is distinct from old.amount_minor
    or new.recorded_at is distinct from old.recorded_at
    or new.authorized_at is distinct from old.authorized_at
    or new.authorization_expires_at is distinct from old.authorization_expires_at
  then
    raise exception 'domain payment authority is immutable'
      using errcode = '55000';
  end if;

  if not (
    old.state = new.state
    or (
      old.state = 'authorized'
      and new.state in ('captured', 'voided', 'manual_review')
    )
    or (
      old.state = 'captured'
      and new.state in ('refunded', 'manual_review')
    )
    or (
      old.state = 'manual_review'
      and new.state in ('captured', 'voided', 'refunded')
    )
  ) then
    raise exception 'invalid domain payment transition'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_payment_exact_stripe_evidence
before insert or update on ss.domain_payment_allocations
for each row execute function ss.validate_domain_payment();

create trigger domain_payment_safe_transition
before update on ss.domain_payment_allocations
for each row execute function ss.validate_domain_payment_transition();

create or replace function ss.validate_domain_registration_intent()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.projects project
    join ss.organization_memberships membership
      on membership.organization_id = project.organization_id
    join ss.domain_quotes quote
      on quote.organization_id = project.organization_id
     and quote.project_id = project.id
    join ss.domain_registrant_snapshots registrant
      on registrant.organization_id = project.organization_id
     and registrant.project_id = project.id
    join ss.domain_agent_consents consent
      on consent.organization_id = project.organization_id
     and consent.project_id = project.id
    join ss.domain_payment_allocations payment
      on payment.organization_id = project.organization_id
     and payment.project_id = project.id
    join ss.domain_procurement_control control
      on control.singleton
    where project.organization_id = new.organization_id
      and project.id = new.project_id
      and project.lifecycle = 'active'
      and control.purchasing_enabled
      and control.active_provider_code = new.provider_code
      and membership.user_id = new.requested_by_user_id
      and membership.state = 'active'
      and membership.role in ('owner', 'admin', 'billing')
      and quote.id = new.quote_id
      and quote.quote_kind = 'registration'
      and quote.status = 'open'
      and quote.expires_at > new.created_at
      and quote.domain_name = new.domain_name
      and quote.provider_code = new.provider_code
      and registrant.id = new.registrant_snapshot_id
      and registrant.user_id = new.requested_by_user_id
      and registrant.customer_is_registrant
      and consent.id = new.agent_consent_id
      and consent.user_id = new.requested_by_user_id
      and consent.quote_id = new.quote_id
      and consent.registrant_snapshot_id = new.registrant_snapshot_id
      and consent.customer_remains_registrant
      and payment.id = new.payment_allocation_id
      and payment.quote_id = new.quote_id
      and payment.state in ('authorized', 'captured')
  ) then
    raise exception 'registration intent prerequisites do not match'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function ss.validate_domain_confirmation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.domain_registration_intents intent
    join ss.domain_quotes quote
      on quote.organization_id = intent.organization_id
     and quote.id = intent.quote_id
    join ss.domain_payment_allocations payment
      on payment.organization_id = intent.organization_id
     and payment.id = intent.payment_allocation_id
    join ss.domain_procurement_control control
      on control.singleton
    where intent.organization_id = new.organization_id
      and intent.project_id = new.project_id
      and intent.id = new.registration_intent_id
      and intent.requested_by_user_id = new.confirmed_by_user_id
      and intent.state = 'awaiting_confirmation'
      and quote.status = 'open'
      and quote.expires_at > new.confirmed_at
      and control.purchasing_enabled
      and control.active_provider_code = intent.provider_code
      and quote.quote_digest = new.quote_digest
      and payment.state in ('authorized', 'captured')
      and payment.authorization_expires_at > new.confirmed_at
  ) then
    raise exception 'irreversible confirmation barrier is not satisfied'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function ss.validate_domain_registration()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.domain_registration_intents intent
    join ss.domain_quotes quote
      on quote.organization_id = intent.organization_id
     and quote.id = intent.quote_id
    join ss.domain_payment_allocations payment
      on payment.organization_id = intent.organization_id
     and payment.id = intent.payment_allocation_id
    join ss.domain_provider_operations operation
      on operation.organization_id = intent.organization_id
     and operation.project_id = intent.project_id
     and operation.subject_kind = 'registration'
     and operation.subject_id = intent.id
     and operation.operation_kind = 'register'
    join ss.provider_receipts receipt
      on receipt.organization_id = operation.organization_id
     and receipt.project_id = operation.project_id
     and receipt.id = operation.provider_receipt_id
    where intent.organization_id = new.organization_id
      and intent.project_id = new.project_id
      and intent.id = new.registration_intent_id
      and intent.registrant_snapshot_id = new.registrant_snapshot_id
      and intent.domain_name = new.domain_name
      and intent.provider_code = new.provider_code
      and intent.irreversible_confirmed_at is not null
      and payment.state = 'captured'
      and operation.id = new.provider_operation_id
      and operation.state = 'succeeded'
      and receipt.id = new.current_provider_receipt_id
      and receipt.receipt_kind = 'domain_operation_result'
      and receipt.facts ->> 'operationId' = operation.id::text
      and receipt.facts ->> 'state' = 'succeeded'
      and receipt.facts ->> 'domainName' = new.domain_name::text
      and receipt.facts ->> 'providerDomainRef' = new.provider_domain_ref
      and (receipt.facts ->> 'registeredAt')::timestamptz = new.registered_at
      and (receipt.facts ->> 'expiresAt')::timestamptz = new.expires_at
      and new.customer_is_registrant
      and new.site_sourcery_role = 'authorized_agent'
      and new.renewal_disclosure_digest = quote.renewal_disclosure_digest
  ) then
    raise exception 'domain registration must match provider result and captured payment'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create table ss.domain_payment_authorization_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  requested_by_user_id uuid not null references auth.users(id),
  quote_id uuid not null,
  agent_consent_id uuid not null,
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 200),
  request_digest ss.sha256_hex not null,
  state text not null check (
    state in (
      'dispatching',
      'checkout_created',
      'awaiting_customer',
      'authorized',
      'not_submitted',
      'manual_review',
      'completed'
    )
  ),
  stripe_checkout_session_ref text unique,
  provider_checkout_url text check (
    provider_checkout_url is null
    or (
      provider_checkout_url like 'https://checkout.stripe.com/%'
      and char_length(provider_checkout_url) <= 2000
    )
  ),
  checkout_expires_at timestamptz,
  stripe_payment_reference text,
  stripe_provider_receipt_id uuid,
  registration_intent_id uuid,
  failure_code text,
  requested_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, quote_id)
    references ss.domain_quotes(organization_id, id),
  foreign key (organization_id, agent_consent_id)
    references ss.domain_agent_consents(organization_id, id),
  foreign key (organization_id, stripe_provider_receipt_id)
    references ss.provider_receipts(organization_id, id),
  foreign key (organization_id, registration_intent_id)
    references ss.domain_registration_intents(organization_id, id),
  unique (organization_id, idempotency_key),
  unique (organization_id, id)
);

alter table ss.domain_provider_operations
  add column provider_price_minor bigint
    check (
      provider_price_minor is null
      or provider_price_minor >= 0
    ),
  add column provider_currency text
    check (
      provider_currency is null
      or provider_currency ~ '^[A-Z]{3}$'
    ),
  add constraint domain_provider_operation_price_pair_check
    check (
      (provider_price_minor is null) =
      (provider_currency is null)
    );

alter table ss.domain_transfer_out_requests
  add column secret_delivery_receipt_ref text
    check (
      secret_delivery_receipt_ref is null
      or char_length(secret_delivery_receipt_ref)
        between 1 and 256
    );

create table ss.domain_price_checks (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  registration_intent_id uuid not null,
  provider_receipt_id uuid not null,
  provider_quote_ref text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  registrar_cost_minor bigint not null check (registrar_cost_minor >= 0),
  quote_digest ss.sha256_hex not null,
  status text not null check (
    status in ('ready', 'changed', 'unavailable')
  ),
  checked_at timestamptz not null,
  expires_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, registration_intent_id)
    references ss.domain_registration_intents(organization_id, id),
  foreign key (organization_id, provider_receipt_id)
    references ss.provider_receipts(organization_id, id),
  unique (registration_intent_id, provider_quote_ref),
  unique (organization_id, id),
  check (expires_at > checked_at)
);

create table ss.domain_provider_contact_sets (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  registrant_snapshot_id uuid not null,
  provider_code text not null,
  provider_receipt_id uuid not null,
  contact_references jsonb not null
    check (jsonb_typeof(contact_references) = 'object'),
  contact_references_digest ss.sha256_hex not null,
  created_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, registrant_snapshot_id)
    references ss.domain_registrant_snapshots(organization_id, id),
  foreign key (organization_id, provider_receipt_id)
    references ss.provider_receipts(organization_id, id),
  unique (registrant_snapshot_id, provider_code),
  unique (organization_id, id)
);

create trigger domain_price_checks_no_update
before update on ss.domain_price_checks
for each row execute function ss.reject_update();

create trigger domain_provider_contact_sets_no_update
before update on ss.domain_provider_contact_sets
for each row execute function ss.reject_update();

alter table ss.domain_dns_change_sets
  add column change_kind text not null default 'upsert'
    check (change_kind in ('upsert', 'delete'));

alter table ss.domain_dns_records
  drop constraint domain_dns_records_state_check;

alter table ss.domain_dns_records
  add constraint domain_dns_records_state_check
    check (state in ('desired', 'applied', 'deleted', 'failed'));

alter table ss.domain_payment_authorization_attempts
  enable row level security;
alter table ss.domain_payment_authorization_attempts
  force row level security;
alter table ss.domain_price_checks enable row level security;
alter table ss.domain_price_checks force row level security;
alter table ss.domain_provider_contact_sets
  enable row level security;
alter table ss.domain_provider_contact_sets
  force row level security;

create policy domain_payment_authorization_attempts_tenant_read
on ss.domain_payment_authorization_attempts
for select using (ss.can_access_org(organization_id));

create policy domain_price_checks_tenant_read
on ss.domain_price_checks
for select using (ss.can_access_org(organization_id));

create policy domain_provider_contact_sets_tenant_read
on ss.domain_provider_contact_sets
for select using (ss.can_access_org(organization_id));

revoke all on
  ss.domain_payment_authorization_attempts,
  ss.domain_price_checks,
  ss.domain_provider_contact_sets
from public;

grant select on
  ss.domain_payment_authorization_attempts,
  ss.domain_price_checks,
  ss.domain_provider_contact_sets
to authenticated;

grant all privileges on
  ss.domain_payment_authorization_attempts,
  ss.domain_price_checks,
  ss.domain_provider_contact_sets
to service_role;

grant execute on function
  ss.validate_domain_payment(),
  ss.validate_domain_payment_transition()
to service_role;

create function ss.hosted_runtime_contract_v14()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v14-safe-domain-authorization'::text
$$;

revoke all on function ss.hosted_runtime_contract_v14()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v14()
to authenticated, service_role;

commit;
