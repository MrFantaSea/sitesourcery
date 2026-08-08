begin;

do $$
begin
  if to_regclass('ss.alakazam_subscriptions') is null
    or to_regclass('ss.alakazam_payment_receipts') is null
    or to_regclass('ss.alakazam_tier_change_events') is null
    or to_regclass('ss.alakazam_downgrade_schedules') is null
    or to_regprocedure(
      'ss.hosted_runtime_contract_v23()'
    ) is null
  then
    raise exception
      'Site Sourcery migration 023 must be applied before Alakazam renewal settlement'
      using errcode = '55000';
  end if;
end
$$;

-- One provider invoice may back at most one Alakazam receipt.
-- Stripe presents a paid subscription cycle through more than one
-- event alias; the alias must converge on the same receipt instead
-- of creating a second renewal evidence row.
create unique index alakazam_one_receipt_per_invoice
  on ss.alakazam_payment_receipts(stripe_invoice_id)
  where stripe_invoice_id is not null;

create table ss.alakazam_renewal_settlements (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  subscription_id uuid not null,
  payment_receipt_id uuid not null unique,
  stripe_event_row_id uuid not null unique,
  tier_change_event_id uuid not null unique,
  stripe_invoice_id text not null unique
    check (stripe_invoice_id ~ '^in_[A-Za-z0-9_]+$'),
  stripe_payment_intent_id text not null
    check (stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  billing_reason text not null
    check (billing_reason = 'subscription_cycle'),
  collection_method text not null
    check (collection_method = 'charge_automatically'),
  paid_amount_minor bigint not null
    check (paid_amount_minor > 0),
  currency text not null check (currency = 'USD'),
  prior_period_starts_at timestamptz not null,
  prior_period_ends_at timestamptz not null,
  period_starts_at timestamptz not null,
  period_ends_at timestamptz not null,
  result_subscription_revision bigint not null
    check (result_subscription_revision > 1),
  projected_next_renewal_at timestamptz not null,
  projected_next_tier_id text not null
    check (
      projected_next_tier_id in (
        'alakazam_25',
        'alakazam_35',
        'alakazam_50'
      )
    ),
  projected_next_amount_minor bigint not null,
  projection_basis text not null
    check (
      projection_basis in (
        'provider_confirmed_period',
        'scheduled_downgrade'
      )
    ),
  projection_certainty text not null
    check (
      projection_certainty = 'provider_confirmed_boundary'
    ),
  provider_facts jsonb not null
    check (
      jsonb_typeof(provider_facts) = 'object'
      and pg_column_size(provider_facts) <= 32768
    ),
  provider_facts_digest ss.sha256_hex not null,
  provider_observed_at timestamptz not null,
  settled_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (subscription_id, result_subscription_revision),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id)
    on delete cascade,
  foreign key (organization_id, payment_receipt_id)
    references ss.alakazam_payment_receipts(organization_id, id)
    on delete cascade,
  foreign key (organization_id, stripe_event_row_id)
    references ss.alakazam_stripe_events(organization_id, id)
    on delete cascade,
  foreign key (organization_id, tier_change_event_id)
    references ss.alakazam_tier_change_events(
      organization_id,
      id
    ) on delete cascade,
  check (prior_period_ends_at > prior_period_starts_at),
  check (period_ends_at > period_starts_at),
  -- A renewal continues the paid period. It never leaves a gap and
  -- never rewrites an already-paid boundary.
  check (period_starts_at = prior_period_ends_at),
  check (period_ends_at > prior_period_ends_at),
  -- The projection is the confirmed boundary, not a guessed date.
  check (projected_next_renewal_at = period_ends_at),
  check (
    projected_next_amount_minor =
      ss.alakazam_tier_amount_minor(projected_next_tier_id)
  ),
  check (paid_amount_minor = projected_next_amount_minor
         or projection_basis = 'scheduled_downgrade')
);

create function ss.validate_alakazam_renewal_settlement()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  subscription_record record;
  receipt_record record;
  scheduled_target text;
begin
  select * into subscription_record
  from ss.alakazam_subscriptions subscription
  where subscription.organization_id = new.organization_id
    and subscription.id = new.subscription_id;
  if not found
    or subscription_record.project_id <> new.project_id
    or subscription_record.status <> 'active'
    or subscription_record.revision <>
         new.result_subscription_revision
    or subscription_record.current_period_starts_at <>
         new.period_starts_at
    or subscription_record.current_period_ends_at <>
         new.period_ends_at
    or subscription_record.provider_facts_digest <>
         new.provider_facts_digest
    or subscription_record.provider_observed_at <>
         new.provider_observed_at
  then
    raise exception
      'Alakazam renewal settlement does not match its confirmed subscription period'
      using errcode = '23514';
  end if;

  select * into receipt_record
  from ss.alakazam_payment_receipts receipt
  where receipt.organization_id = new.organization_id
    and receipt.id = new.payment_receipt_id;
  if not found
    or receipt_record.project_id <> new.project_id
    or receipt_record.subscription_id <> new.subscription_id
    or receipt_record.receipt_kind <> 'renewal_payment'
    or receipt_record.quote_id is not null
    or receipt_record.stripe_invoice_id is distinct from
         new.stripe_invoice_id
    or receipt_record.stripe_payment_intent_id <>
         new.stripe_payment_intent_id
    or receipt_record.stripe_event_row_id <>
         new.stripe_event_row_id
    or receipt_record.currency <> new.currency
    or receipt_record.net_subtotal_minor <>
         new.paid_amount_minor
    or receipt_record.provider_discount_minor <> 0
  then
    raise exception
      'Alakazam renewal settlement lacks its exact renewal receipt'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from ss.alakazam_tier_change_events event
    where event.organization_id = new.organization_id
      and event.project_id = new.project_id
      and event.id = new.tier_change_event_id
      and event.subscription_id = new.subscription_id
      and event.event_kind = 'renewal_paid'
      and event.payment_receipt_id = new.payment_receipt_id
      and event.stripe_event_row_id = new.stripe_event_row_id
      and event.result_subscription_revision =
          new.result_subscription_revision
  ) then
    raise exception
      'Alakazam renewal settlement lacks its exact renewal event'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from ss.alakazam_stripe_events event
    where event.organization_id = new.organization_id
      and event.project_id = new.project_id
      and event.id = new.stripe_event_row_id
      and event.subscription_id = new.subscription_id
      and event.state = 'processed'
      and event.event_type in (
        'invoice.paid',
        'invoice.payment_succeeded'
      )
      and event.provider_object_id = new.stripe_invoice_id
  ) then
    raise exception
      'Alakazam renewal settlement lacks its processed invoice event'
      using errcode = '23514';
  end if;

  -- The projection is derived from committed local facts only:
  -- the confirmed provider boundary plus any accepted downgrade
  -- that is already scheduled to land on exactly that boundary.
  select schedule.target_tier_id into scheduled_target
  from ss.alakazam_downgrade_schedules schedule
  where schedule.organization_id = new.organization_id
    and schedule.subscription_id = new.subscription_id
    and schedule.state in ('dispatching', 'scheduled')
    and schedule.effective_at = new.period_ends_at;

  if scheduled_target is null then
    if new.projection_basis <> 'provider_confirmed_period'
      or new.projected_next_tier_id <>
           subscription_record.tier_id
    then
      raise exception
        'Alakazam renewal projection must restate the confirmed tier'
        using errcode = '23514';
    end if;
  elsif new.projection_basis <> 'scheduled_downgrade'
    or new.projected_next_tier_id <> scheduled_target
  then
    raise exception
      'Alakazam renewal projection must honour the accepted downgrade'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_renewal_settlements_validate
after insert on ss.alakazam_renewal_settlements
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_renewal_settlement();

create trigger alakazam_renewal_settlements_immutable
before update or delete on ss.alakazam_renewal_settlements
for each row execute function
  ss.reject_alakazam_evidence_mutation();

alter table ss.alakazam_renewal_settlements
  enable row level security;
alter table ss.alakazam_renewal_settlements
  force row level security;
revoke all on ss.alakazam_renewal_settlements
  from public, anon, authenticated;
grant all privileges on ss.alakazam_renewal_settlements
  to service_role;

revoke all on function
  ss.validate_alakazam_renewal_settlement()
from public, anon, authenticated;
grant execute on function
  ss.validate_alakazam_renewal_settlement()
to service_role;

do $$
begin
  if has_table_privilege(
      'authenticated',
      'ss.alakazam_renewal_settlements',
      'SELECT'
    )
    or has_table_privilege(
      'anon',
      'ss.alakazam_renewal_settlements',
      'SELECT'
    )
  then
    raise exception
      'Alakazam renewal settlement privilege boundary is unsafe'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v49()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v49-alakazam-renewal-settlement'::text
$$;

revoke all on function ss.hosted_runtime_contract_v49()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v49()
to service_role;

commit;
