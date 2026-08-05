begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v38()') is null
    or to_regclass('ss.service_assessment_checkout_attempts') is null
  then
    raise exception
      'Site Sourcery migration 038 must be applied before assessment settlement'
      using errcode = '55000';
  end if;
end
$$;

-- A verified event only wakes reconciliation. No amount from its payload is
-- payment authority; exact money is read back from Stripe before settlement.
create table ss.service_assessment_stripe_events (
  id text primary key
    check (id ~ '^evt_[A-Za-z0-9_]+$'),
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  invoice_id uuid not null,
  checkout_attempt_id uuid not null,
  event_type text not null
    check (event_type = 'checkout.session.completed'),
  livemode boolean not null,
  api_version text not null
    check (char_length(api_version) between 3 and 100),
  checkout_session_id text not null
    check (checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  payload_digest ss.sha256_hex not null,
  provider_created_at timestamptz not null,
  signature_verified_at timestamptz not null,
  state text not null
    check (state in ('pending', 'processed', 'reconciliation_required')),
  reconciliation_code text
    check (
      reconciliation_code is null
      or reconciliation_code ~ '^[A-Za-z0-9._:-]{1,200}$'
    ),
  result jsonb
    check (
      result is null
      or (
        jsonb_typeof(result) = 'object'
        and pg_column_size(result) <= 16384
      )
    ),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, invoice_id)
    references ss.service_invoices(organization_id, id),
  foreign key (organization_id, checkout_attempt_id)
    references ss.service_assessment_checkout_attempts(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  check (signature_verified_at >= provider_created_at),
  check (
    (
      state = 'pending'
      and result is null
      and reconciliation_code is null
      and completed_at is null
    )
    or (
      state = 'processed'
      and result is not null
      and reconciliation_code is null
      and completed_at is not null
    )
    or (
      state = 'reconciliation_required'
      and result is null
      and reconciliation_code is not null
      and completed_at is not null
    )
  )
);

create function ss.guard_service_assessment_stripe_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
  then
    raise exception 'assessment Stripe event mutation lacks system authority'
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'pending'
      or new.result is not null
      or new.reconciliation_code is not null
      or new.completed_at is not null
    then
      raise exception 'assessment Stripe event must begin pending'
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
    new.checkout_attempt_id,
    new.event_type,
    new.livemode,
    new.api_version,
    new.checkout_session_id,
    new.payload_digest,
    new.provider_created_at,
    new.signature_verified_at,
    new.created_at
  ) is distinct from row(
    old.id,
    old.organization_id,
    old.project_id,
    old.customer_user_id,
    old.invoice_id,
    old.checkout_attempt_id,
    old.event_type,
    old.livemode,
    old.api_version,
    old.checkout_session_id,
    old.payload_digest,
    old.provider_created_at,
    old.signature_verified_at,
    old.created_at
  ) or old.state <> 'pending'
    or new.state not in ('processed', 'reconciliation_required')
  then
    raise exception 'assessment Stripe event transition is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger service_assessment_stripe_event_guard
before insert or update on ss.service_assessment_stripe_events
for each row execute function ss.guard_service_assessment_stripe_event();

create trigger service_assessment_stripe_event_no_delete
before delete on ss.service_assessment_stripe_events
for each row execute function ss.reject_update();

create table ss.service_assessment_payment_receipts (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  invoice_id uuid not null,
  checkout_attempt_id uuid not null,
  stripe_event_id text not null,
  provider text not null check (provider = 'stripe'),
  checkout_session_id text not null unique
    check (checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  payment_intent_id text not null unique
    check (payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  stripe_customer_id text not null
    references ss.stripe_customers(stripe_customer_id)
    check (stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  payment_status text not null check (payment_status = 'paid'),
  subtotal_minor bigint not null check (subtotal_minor = 20000),
  tax_minor bigint not null check (tax_minor between 0 and 99999999),
  total_minor bigint not null check (total_minor = subtotal_minor + tax_minor),
  tax_mode text not null check (tax_mode = 'automatic'),
  currency text not null check (currency = 'USD'),
  purpose_digest ss.sha256_hex not null,
  invoice_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  provider_facts jsonb not null
    check (
      jsonb_typeof(provider_facts) = 'object'
      and pg_column_size(provider_facts) <= 16384
    ),
  provider_facts_digest ss.sha256_hex not null,
  provider_paid_at timestamptz not null,
  settled_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, invoice_id)
    references ss.service_invoices(organization_id, id),
  foreign key (organization_id, checkout_attempt_id)
    references ss.service_assessment_checkout_attempts(organization_id, id),
  foreign key (organization_id, stripe_event_id)
    references ss.service_assessment_stripe_events(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (invoice_id),
  unique (checkout_attempt_id),
  unique (stripe_event_id),
  check (settled_at >= provider_paid_at)
);

create table ss.service_assessment_jobs (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  invoice_id uuid not null,
  payment_receipt_id uuid not null,
  quote_id uuid not null,
  quote_revision bigint not null check (quote_revision > 0),
  quote_revision_id uuid not null,
  policy_id uuid not null,
  scope_boundary_digest ss.sha256_hex not null,
  accepted_quote_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  review_targets text[] not null
    check (ss.service_quote_review_targets_are_canonical(review_targets)),
  maximum_websites integer not null check (maximum_websites = 1),
  maximum_representative_pages_or_types integer not null
    check (maximum_representative_pages_or_types = 5),
  maximum_findings integer not null check (maximum_findings = 10),
  desktop_review_included boolean not null check (desktop_review_included),
  phone_review_included boolean not null check (phone_review_included),
  delivery_date date not null,
  purpose text not null check (purpose = 'assessment'),
  state text not null check (state = 'open'),
  opened_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, invoice_id)
    references ss.service_invoices(organization_id, id),
  foreign key (organization_id, payment_receipt_id)
    references ss.service_assessment_payment_receipts(organization_id, id),
  foreign key (
    organization_id,
    quote_id,
    quote_revision,
    quote_revision_id
  ) references ss.service_quote_revisions(
    organization_id,
    quote_id,
    quote_revision,
    id
  ),
  foreign key (policy_id, scope_boundary_digest)
    references ss.service_catalog_policies(id, scope_boundary_digest),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (case_id),
  unique (invoice_id),
  unique (payment_receipt_id),
  check (created_at >= opened_at)
);

create function ss.guard_service_assessment_settlement_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
  then
    raise exception 'assessment settlement mutation lacks system authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger service_assessment_payment_receipt_guard
before insert on ss.service_assessment_payment_receipts
for each row execute function ss.guard_service_assessment_settlement_insert();

create trigger service_assessment_payment_receipt_immutable
before update or delete on ss.service_assessment_payment_receipts
for each row execute function ss.reject_update();

create trigger service_assessment_job_guard
before insert on ss.service_assessment_jobs
for each row execute function ss.guard_service_assessment_settlement_insert();

create trigger service_assessment_job_immutable
before update or delete on ss.service_assessment_jobs
for each row execute function ss.reject_update();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_assessment_stripe_events',
    'service_assessment_payment_receipts',
    'service_assessment_jobs'
  ]
  loop
    execute format('alter table ss.%I enable row level security', table_name);
    execute format('alter table ss.%I force row level security', table_name);
    execute format(
      'revoke all on table ss.%I from public, anon, authenticated, service_role',
      table_name
    );
    execute format('grant select, insert on table ss.%I to service_role', table_name);
  end loop;
end
$$;

grant update on ss.service_assessment_stripe_events to service_role;

revoke all on function ss.guard_service_assessment_stripe_event()
from public, anon, authenticated, service_role;
grant execute on function ss.guard_service_assessment_stripe_event()
to service_role;

revoke all on function ss.guard_service_assessment_settlement_insert()
from public, anon, authenticated, service_role;
grant execute on function ss.guard_service_assessment_settlement_insert()
to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_assessment_stripe_events',
    'service_assessment_payment_receipts',
    'service_assessment_jobs'
  ]
  loop
    if has_table_privilege(
      'service_role', format('ss.%I', table_name), 'DELETE'
    ) or has_table_privilege(
      'service_role', format('ss.%I', table_name), 'TRUNCATE'
    ) or has_table_privilege(
      'authenticated', format('ss.%I', table_name), 'SELECT'
    ) or has_table_privilege(
      'authenticated', format('ss.%I', table_name), 'INSERT'
    ) or has_table_privilege(
      'authenticated', format('ss.%I', table_name), 'UPDATE'
    ) or has_table_privilege(
      'anon', format('ss.%I', table_name), 'SELECT'
    ) or has_table_privilege(
      'anon', format('ss.%I', table_name), 'INSERT'
    ) or has_table_privilege(
      'anon', format('ss.%I', table_name), 'UPDATE'
    ) then
      raise exception 'assessment settlement privilege boundary is unsafe: %',
        table_name using errcode = '55000';
    end if;
  end loop;

  if has_table_privilege(
    'service_role',
    'ss.service_assessment_payment_receipts',
    'UPDATE'
  ) or has_table_privilege(
    'service_role',
    'ss.service_assessment_jobs',
    'UPDATE'
  ) then
    raise exception 'immutable assessment settlement tables allow update'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v39()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v39-custom-service-assessment-settlement'::text
$$;

revoke all on function ss.hosted_runtime_contract_v39()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v39()
to authenticated, service_role;

commit;
