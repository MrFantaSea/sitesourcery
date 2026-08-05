begin;

-- One durable row is claimed before Stripe is contacted. The browser supplies
-- only the retained invoice identity and digest; price, tax behavior, customer,
-- quote, and disclosure authority are reconstructed server-side.
create table ss.service_assessment_checkout_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  invoice_id uuid not null,
  command_id text not null
    check (char_length(command_id) between 8 and 200),
  provider text not null check (provider = 'stripe'),
  purpose_digest ss.sha256_hex not null,
  invoice_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  expected_subtotal_minor bigint not null
    check (expected_subtotal_minor = 20000),
  currency text not null check (currency = 'USD'),
  tax_mode text not null check (tax_mode = 'automatic'),
  state text not null
    check (
      state in (
        'provider_pending',
        'ready',
        'failed',
        'persistence_unknown',
        'expired'
      )
    ),
  provider_effect_certainty text not null
    check (
      provider_effect_certainty in (
        'not_submitted',
        'confirmed',
        'ambiguous'
      )
    ),
  checkout_session_id text unique,
  checkout_url text,
  expires_at timestamptz,
  provider_error_code text
    check (
      provider_error_code is null
      or provider_error_code ~ '^[A-Za-z0-9._:-]{1,200}$'
    ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, invoice_id)
    references ss.service_invoices(organization_id, id),
  unique (organization_id, id),
  unique (invoice_id, command_id),
  check (
    (
      state = 'provider_pending'
      and provider_effect_certainty = 'not_submitted'
      and checkout_session_id is null
      and checkout_url is null
      and expires_at is null
      and provider_error_code is null
    )
    or (
      state = 'ready'
      and provider_effect_certainty = 'confirmed'
      and checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'
      and checkout_url like 'https://checkout.stripe.com/%'
      and expires_at > created_at
      and provider_error_code is null
    )
    or (
      state = 'expired'
      and provider_effect_certainty = 'confirmed'
      and checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'
      and checkout_url like 'https://checkout.stripe.com/%'
      and expires_at is not null
      and provider_error_code is null
    )
    or (
      state = 'failed'
      and provider_effect_certainty = 'not_submitted'
      and checkout_session_id is null
      and checkout_url is null
      and expires_at is null
      and provider_error_code is not null
    )
    or (
      state = 'persistence_unknown'
      and provider_effect_certainty = 'ambiguous'
      and checkout_session_id is null
      and checkout_url is null
      and expires_at is null
      and provider_error_code is not null
    )
  )
);

create unique index service_assessment_checkout_one_active
  on ss.service_assessment_checkout_attempts(invoice_id)
  where state in ('provider_pending', 'ready', 'persistence_unknown');

create function ss.guard_service_assessment_checkout_attempt()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() not in ('customer', 'system')
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or (
      ss.current_service_actor_kind() = 'customer'
      and ss.current_service_actor_user_id() is distinct from
        new.customer_user_id
    )
  then
    raise exception 'assessment Checkout mutation lacks exact service authority'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'provider_pending'
      or not exists (
        select 1
          from ss.service_invoices invoice
          join ss.service_payment_reservations reservation
            on reservation.organization_id = invoice.organization_id
           and reservation.invoice_id = invoice.id
         where invoice.organization_id = new.organization_id
           and invoice.project_id = new.project_id
           and invoice.customer_user_id = new.customer_user_id
           and invoice.id = new.invoice_id
           and invoice.purpose = 'assessment'
           and invoice.subtotal_minor = 20000
           and invoice.currency = 'USD'
           and invoice.state = 'tax_calculation_pending'
           and invoice.payable = false
           and invoice.charge_occurred = false
           and invoice.invoice_digest = new.invoice_digest
           and invoice.accepted_disclosure_digest =
             new.accepted_disclosure_digest
           and reservation.state = 'held'
           and reservation.provider_effect_certainty = 'not_submitted'
           and reservation.invoice_digest = invoice.invoice_digest
      )
    then
      raise exception 'assessment Checkout requires one exact held invoice'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.id,
    new.organization_id,
    new.project_id,
    new.customer_user_id,
    new.invoice_id,
    new.command_id,
    new.provider,
    new.purpose_digest,
    new.invoice_digest,
    new.accepted_disclosure_digest,
    new.expected_subtotal_minor,
    new.currency,
    new.tax_mode,
    new.created_at
  ) is distinct from row(
    old.id,
    old.organization_id,
    old.project_id,
    old.customer_user_id,
    old.invoice_id,
    old.command_id,
    old.provider,
    old.purpose_digest,
    old.invoice_digest,
    old.accepted_disclosure_digest,
    old.expected_subtotal_minor,
    old.currency,
    old.tax_mode,
    old.created_at
  ) then
    raise exception 'assessment Checkout identity is immutable'
      using errcode = '55000';
  end if;
  if not (
    (old.state = 'provider_pending'
      and new.state in ('ready', 'failed', 'persistence_unknown'))
    or (old.state = 'ready' and new.state = 'expired')
  ) then
    raise exception 'assessment Checkout state transition is invalid'
      using errcode = '55000';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger service_assessment_checkout_attempt_guard
before insert or update on ss.service_assessment_checkout_attempts
for each row execute function ss.guard_service_assessment_checkout_attempt();

create trigger service_assessment_checkout_attempt_no_delete
before delete on ss.service_assessment_checkout_attempts
for each row execute function ss.reject_update();

alter table ss.service_assessment_checkout_attempts
  enable row level security;
alter table ss.service_assessment_checkout_attempts
  force row level security;
revoke all on table ss.service_assessment_checkout_attempts
from public, anon, authenticated, service_role;
grant select, insert, update
on table ss.service_assessment_checkout_attempts
to service_role;

revoke all on function ss.guard_service_assessment_checkout_attempt()
from public, anon, authenticated, service_role;
grant execute on function ss.guard_service_assessment_checkout_attempt()
to service_role;

do $$
begin
  if has_table_privilege(
    'service_role',
    'ss.service_assessment_checkout_attempts',
    'DELETE'
  ) or has_table_privilege(
    'service_role',
    'ss.service_assessment_checkout_attempts',
    'TRUNCATE'
  ) or has_table_privilege(
    'authenticated',
    'ss.service_assessment_checkout_attempts',
    'SELECT'
  ) or has_table_privilege(
    'authenticated',
    'ss.service_assessment_checkout_attempts',
    'INSERT'
  ) or has_table_privilege(
    'authenticated',
    'ss.service_assessment_checkout_attempts',
    'UPDATE'
  ) or has_table_privilege(
    'authenticated',
    'ss.service_assessment_checkout_attempts',
    'DELETE'
  ) or has_table_privilege(
    'authenticated',
    'ss.service_assessment_checkout_attempts',
    'TRUNCATE'
  ) or has_table_privilege(
    'anon',
    'ss.service_assessment_checkout_attempts',
    'SELECT'
  ) or has_table_privilege(
    'anon',
    'ss.service_assessment_checkout_attempts',
    'INSERT'
  ) or has_table_privilege(
    'anon',
    'ss.service_assessment_checkout_attempts',
    'UPDATE'
  ) or has_table_privilege(
    'anon',
    'ss.service_assessment_checkout_attempts',
    'DELETE'
  ) or has_table_privilege(
    'anon',
    'ss.service_assessment_checkout_attempts',
    'TRUNCATE'
  ) then
    raise exception 'assessment Checkout privilege boundary is unsafe'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v38()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v38-custom-service-assessment-checkout'::text
$$;

revoke all on function ss.hosted_runtime_contract_v38()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v38()
to authenticated, service_role;

commit;
