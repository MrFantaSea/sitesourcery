begin;

do $$
begin
  if to_regclass('ss.alakazam_cancellations') is null
    or to_regprocedure(
      'ss.hosted_runtime_contract_v51()'
    ) is null
  then
    raise exception
      'Site Sourcery migration 051 must be applied before Alakazam reversal defence'
      using errcode = '55000';
  end if;
end
$$;

-- Defensive record of money leaving an Alakazam payment.
--
-- This table exists to PROTECT access and surface evidence. It is not
-- a refund product: there is no column that could request, authorise,
-- or schedule a refund, and no Site Sourcery surface may offer one.
-- Every row is an observation of something the provider already did.
create table ss.alakazam_reversal_events (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  subscription_id uuid not null,
  payment_receipt_id uuid,
  credit_application_id uuid,
  stripe_event_row_id uuid not null unique,
  reversal_kind text not null
    check (reversal_kind in ('refund', 'dispute')),
  outcome text not null
    check (
      outcome in (
        'refund_failed',
        'refund_partial',
        'refund_full',
        'dispute_open',
        'dispute_won',
        'dispute_lost',
        'dispute_funds_withdrawn',
        'dispute_funds_reinstated'
      )
    ),
  stripe_charge_id text not null
    check (stripe_charge_id ~ '^ch_[A-Za-z0-9_]+$'),
  stripe_payment_intent_id text not null
    check (stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  stripe_refund_id text
    check (
      stripe_refund_id is null
      or stripe_refund_id ~ '^re_[A-Za-z0-9_]+$'
    ),
  stripe_dispute_id text
    check (
      stripe_dispute_id is null
      or stripe_dispute_id ~ '^dp_[A-Za-z0-9_]+$'
    ),
  -- Monotonic. A later, milder observation never lowers the record.
  severity smallint not null
    check (severity between 0 and 100),
  amount_charged_minor bigint not null
    check (amount_charged_minor > 0),
  amount_reversed_minor bigint not null
    check (amount_reversed_minor >= 0),
  currency text not null check (currency = 'USD'),
  observed_status text not null
    check (
      observed_status in (
        'pending', 'active', 'grace',
        'suspended', 'cancelled', 'ended'
      )
    ),
  resulting_status text not null
    check (
      resulting_status in (
        'pending', 'active', 'grace',
        'suspended', 'cancelled', 'ended'
      )
    ),
  policy_version text
    check (
      policy_version is null
      or policy_version ~
        '^alakazam-lifecycle[.][0-9]{4}-[0-9]{2}-[0-9]{2}[.]v[0-9]+$'
    ),
  decided_consequence text not null
    check (
      decided_consequence in (
        'record_only',
        'owner_review',
        'restrict_publication',
        'suspend_service'
      )
    ),
  service_state text not null
    check (
      service_state in ('unchanged', 'limited', 'suspended')
    ),
  consequence_applied boolean not null,
  owner_review_required boolean not null,
  tier_change_event_id uuid unique,
  provider_facts jsonb not null
    check (
      jsonb_typeof(provider_facts) = 'object'
      and pg_column_size(provider_facts) <= 32768
    ),
  provider_facts_digest ss.sha256_hex not null,
  provider_observed_at timestamptz not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id)
    on delete cascade,
  foreign key (organization_id, payment_receipt_id)
    references ss.alakazam_payment_receipts(organization_id, id)
    on delete cascade,
  foreign key (organization_id, credit_application_id)
    references ss.alakazam_credit_applications(
      organization_id,
      id
    ) on delete cascade,
  foreign key (organization_id, stripe_event_row_id)
    references ss.alakazam_stripe_events(organization_id, id)
    on delete cascade,
  foreign key (organization_id, tier_change_event_id)
    references ss.alakazam_tier_change_events(
      organization_id,
      id
    ) on delete cascade,
  check (
    (reversal_kind = 'refund' and (
      outcome in (
        'refund_failed', 'refund_partial', 'refund_full'
      )
      and stripe_dispute_id is null
    ))
    or (reversal_kind = 'dispute' and (
      outcome in (
        'dispute_open',
        'dispute_won',
        'dispute_lost',
        'dispute_funds_withdrawn',
        'dispute_funds_reinstated'
      )
      and stripe_dispute_id is not null
      and stripe_refund_id is null
    ))
  ),
  check (amount_reversed_minor <= amount_charged_minor),
  check (
    outcome <> 'refund_full'
    or amount_reversed_minor = amount_charged_minor
  ),
  check (
    outcome <> 'refund_failed'
    or amount_reversed_minor = 0
  ),
  -- FAIL CLOSED. With no dated owner ruling on reversal defence the
  -- row is evidence plus an owner-review flag, never a service change.
  check (
    policy_version is not null
    or (
      decided_consequence = 'owner_review'
      and service_state = 'unchanged'
      and consequence_applied = false
      and owner_review_required = true
      and resulting_status = observed_status
      and tier_change_event_id is null
    )
  ),
  check (
    consequence_applied = (tier_change_event_id is not null)
  ),
  check (
    consequence_applied
    or resulting_status = observed_status
  ),
  -- A restored subscription is never a consequence of a reversal.
  check (
    not consequence_applied
    or resulting_status in ('suspended', 'cancelled', 'ended')
  )
);

create index alakazam_reversals_by_charge
  on ss.alakazam_reversal_events(
    organization_id,
    stripe_charge_id,
    severity desc
  );

create index alakazam_reversals_awaiting_owner
  on ss.alakazam_reversal_events(
    organization_id,
    subscription_id,
    occurred_at
  )
  where owner_review_required;

create function ss.validate_alakazam_reversal_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  subscription_record record;
  highest smallint;
begin
  select * into subscription_record
  from ss.alakazam_subscriptions subscription
  where subscription.organization_id = new.organization_id
    and subscription.id = new.subscription_id;
  if not found
    or subscription_record.project_id <> new.project_id
    or subscription_record.status <> new.resulting_status
  then
    raise exception
      'Alakazam reversal does not match its subscription'
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
        'charge.refunded',
        'refund.created',
        'refund.updated',
        'refund.failed',
        'charge.dispute.created',
        'charge.dispute.updated',
        'charge.dispute.closed',
        'charge.dispute.funds_withdrawn',
        'charge.dispute.funds_reinstated'
      )
  ) then
    raise exception
      'Alakazam reversal lacks its processed provider event'
      using errcode = '23514';
  end if;

  -- The reversal must bind to a real Alakazam payment.
  if new.payment_receipt_id is not null
    and not exists (
      select 1
      from ss.alakazam_payment_receipts receipt
      where receipt.organization_id = new.organization_id
        and receipt.project_id = new.project_id
        and receipt.id = new.payment_receipt_id
        and receipt.subscription_id = new.subscription_id
        and receipt.stripe_payment_intent_id =
            new.stripe_payment_intent_id
        and receipt.currency = new.currency
        and receipt.total_minor = new.amount_charged_minor
    )
  then
    raise exception
      'Alakazam reversal does not bind its exact payment receipt'
      using errcode = '23514';
  end if;

  -- Severity is monotonic per charge. A dispute won or funds
  -- reinstated is recorded, but it never lowers what already happened.
  select max(existing.severity) into highest
  from ss.alakazam_reversal_events existing
  where existing.organization_id = new.organization_id
    and existing.stripe_charge_id = new.stripe_charge_id
    and existing.id <> new.id;
  if highest is not null and new.severity < highest then
    raise exception
      'Alakazam reversal severity cannot decrease'
      using errcode = '23514';
  end if;

  if new.tier_change_event_id is not null
    and not exists (
      select 1
      from ss.alakazam_tier_change_events event
      where event.organization_id = new.organization_id
        and event.id = new.tier_change_event_id
        and event.subscription_id = new.subscription_id
        and event.stripe_event_row_id =
            new.stripe_event_row_id
        and event.event_kind = 'suspended'
    )
  then
    raise exception
      'Alakazam reversal consequence lacks exact tier evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_reversal_events_validate
after insert on ss.alakazam_reversal_events
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_reversal_event();

create trigger alakazam_reversal_events_immutable
before update or delete on ss.alakazam_reversal_events
for each row execute function
  ss.reject_alakazam_evidence_mutation();

alter table ss.alakazam_reversal_events
  enable row level security;
alter table ss.alakazam_reversal_events
  force row level security;
revoke all on ss.alakazam_reversal_events
  from public, anon, authenticated;
grant all privileges on ss.alakazam_reversal_events
  to service_role;

revoke all on function
  ss.validate_alakazam_reversal_event()
from public, anon, authenticated;
grant execute on function
  ss.validate_alakazam_reversal_event()
to service_role;

do $$
begin
  if has_table_privilege(
      'authenticated',
      'ss.alakazam_reversal_events',
      'SELECT'
    )
    or has_table_privilege(
      'anon',
      'ss.alakazam_reversal_events',
      'SELECT'
    )
  then
    raise exception
      'Alakazam reversal privilege boundary is unsafe'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v52()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v52-alakazam-reversal-defence'::text
$$;

revoke all on function ss.hosted_runtime_contract_v52()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v52()
to service_role;

commit;
