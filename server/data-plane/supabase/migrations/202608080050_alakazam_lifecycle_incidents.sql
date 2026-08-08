begin;

do $$
begin
  if to_regclass('ss.alakazam_renewal_settlements') is null
    or to_regprocedure(
      'ss.hosted_runtime_contract_v49()'
    ) is null
  then
    raise exception
      'Site Sourcery migration 049 must be applied before Alakazam payment incidents'
      using errcode = '55000';
  end if;
end
$$;

-- A confirmed failed or action-required payment attempt.
--
-- This table is an evidence ledger first. Until the owner has ruled on
-- grace, suspension, and restoration, an incident records exactly what
-- the provider proved and changes nothing about the subscription or
-- the customer's service.
create table ss.alakazam_payment_incidents (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  subscription_id uuid not null,
  stripe_event_row_id uuid not null unique,
  tier_change_event_id uuid unique,
  incident_kind text not null
    check (
      incident_kind in ('payment_failed', 'action_required')
    ),
  stripe_invoice_id text not null
    check (stripe_invoice_id ~ '^in_[A-Za-z0-9_]+$'),
  stripe_payment_intent_id text not null
    check (stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  provider_invoice_status text not null
    check (
      provider_invoice_status in ('open', 'uncollectible')
    ),
  provider_attempt_count integer not null
    check (provider_attempt_count >= 1),
  next_provider_attempt_at timestamptz,
  amount_due_minor bigint not null
    check (amount_due_minor > 0),
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
  customer_message_code text not null
    check (
      customer_message_code in (
        'alakazam_billing_attention',
        'alakazam_billing_action_required',
        'alakazam_billing_current',
        'alakazam_service_paused'
      )
    ),
  consequence_applied boolean not null,
  grace_ends_at timestamptz,
  decision jsonb not null
    check (
      jsonb_typeof(decision) = 'object'
      and pg_column_size(decision) <= 32768
    ),
  decision_digest ss.sha256_hex not null,
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
  foreign key (organization_id, stripe_event_row_id)
    references ss.alakazam_stripe_events(organization_id, id)
    on delete cascade,
  foreign key (organization_id, tier_change_event_id)
    references ss.alakazam_tier_change_events(
      organization_id,
      id
    ) on delete cascade,
  -- FAIL CLOSED. With no dated owner ruling attached, an incident is
  -- evidence only: the status does not move, no service consequence is
  -- claimed, no deadline is invented, and no tier event exists.
  check (
    policy_version is not null
    or (
      decided_consequence = 'record_only'
      and service_state = 'unchanged'
      and consequence_applied = false
      and grace_ends_at is null
      and resulting_status = observed_status
      and tier_change_event_id is null
    )
  ),
  -- A consequence is only real when it committed a subscription
  -- transition with its own immutable tier evidence.
  check (
    consequence_applied =
      (tier_change_event_id is not null)
  ),
  check (
    consequence_applied
    or resulting_status = observed_status
  ),
  check (
    not consequence_applied
    or resulting_status <> observed_status
  ),
  -- A grace deadline may exist only where the ruling put the
  -- subscription into grace.
  check (
    grace_ends_at is null
    or resulting_status in ('grace', 'suspended')
  ),
  check (
    resulting_status <> 'grace'
    or grace_ends_at is not null
  )
);

-- The owner's queue: every confirmed incident still waiting on a
-- lifecycle ruling.
create index alakazam_incidents_awaiting_policy
  on ss.alakazam_payment_incidents(
    organization_id,
    subscription_id,
    occurred_at
  )
  where policy_version is null;

create function ss.validate_alakazam_payment_incident()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  subscription_record record;
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
      'Alakazam payment incident does not match its subscription'
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
        'invoice.payment_failed',
        'invoice.payment_action_required'
      )
      and event.provider_object_id = new.stripe_invoice_id
  ) then
    raise exception
      'Alakazam payment incident lacks its processed invoice event'
      using errcode = '23514';
  end if;

  if new.tier_change_event_id is not null
    and not exists (
      select 1
      from ss.alakazam_tier_change_events event
      where event.organization_id = new.organization_id
        and event.project_id = new.project_id
        and event.id = new.tier_change_event_id
        and event.subscription_id = new.subscription_id
        and event.stripe_event_row_id =
            new.stripe_event_row_id
        and event.event_kind in (
          'payment_failed', 'suspended'
        )
        and event.result_subscription_revision =
            subscription_record.revision
    )
  then
    raise exception
      'Alakazam payment incident consequence lacks exact tier evidence'
      using errcode = '23514';
  end if;

  -- A grace deadline must be the ruled boundary, never a value that
  -- disagrees with the committed subscription.
  if new.resulting_status = 'grace'
    and (
      subscription_record.grace_ends_at is distinct from
        new.grace_ends_at
      or subscription_record.first_failed_at is null
    )
  then
    raise exception
      'Alakazam grace evidence disagrees with its subscription'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_payment_incidents_validate
after insert on ss.alakazam_payment_incidents
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_payment_incident();

create trigger alakazam_payment_incidents_immutable
before update or delete on ss.alakazam_payment_incidents
for each row execute function
  ss.reject_alakazam_evidence_mutation();

alter table ss.alakazam_payment_incidents
  enable row level security;
alter table ss.alakazam_payment_incidents
  force row level security;
revoke all on ss.alakazam_payment_incidents
  from public, anon, authenticated;
grant all privileges on ss.alakazam_payment_incidents
  to service_role;

revoke all on function
  ss.validate_alakazam_payment_incident()
from public, anon, authenticated;
grant execute on function
  ss.validate_alakazam_payment_incident()
to service_role;

do $$
begin
  if has_table_privilege(
      'authenticated',
      'ss.alakazam_payment_incidents',
      'SELECT'
    )
    or has_table_privilege(
      'anon',
      'ss.alakazam_payment_incidents',
      'SELECT'
    )
  then
    raise exception
      'Alakazam payment incident privilege boundary is unsafe'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v50()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v50-alakazam-payment-incidents'::text
$$;

revoke all on function ss.hosted_runtime_contract_v50()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v50()
to service_role;

commit;
