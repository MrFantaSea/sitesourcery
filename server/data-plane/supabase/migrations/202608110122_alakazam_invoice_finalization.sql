begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v50()') is null
    or to_regprocedure('ss.hosted_operator_work_queue_contract_v1()') is null
    or to_regclass('ss.alakazam_fulfillment_operations') is null
  then
    raise exception
      'Alakazam lifecycle, fulfillment, and operator foundations must precede invoice finalization'
      using errcode = '55000';
  end if;
end
$$;

-- The verified event is only a wake-up signal. Each immutable observation is
-- bound to a fresh provider read of the exact locally-owned Invoice,
-- Subscription, Customer, Price, and amount before it can affect a hold.
create table ss.alakazam_invoice_finalization_observations (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  subscription_id uuid not null,
  projection_id uuid not null,
  projection_revision bigint not null check (projection_revision > 0),
  stripe_event_id text not null unique
    check (stripe_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  event_type text not null check (
    event_type in (
      'invoice.finalization_failed',
      'invoice.finalized',
      'invoice.paid',
      'invoice.payment_succeeded'
    )
  ),
  stripe_invoice_id text not null
    check (stripe_invoice_id ~ '^in_[A-Za-z0-9_]+$'),
  stripe_subscription_id text not null
    check (stripe_subscription_id ~ '^sub_[A-Za-z0-9_]+$'),
  provider_state text not null
    check (provider_state in ('failed', 'recovered')),
  provider_invoice_status text not null
    check (provider_invoice_status in ('draft', 'open', 'paid', 'uncollectible', 'void')),
  reason_code text check (
    reason_code is null or reason_code in (
      'automatic_tax', 'invoice_settings',
      'provider_rejected', 'unknown_review'
    )
  ),
  payload_digest ss.sha256_hex not null,
  request_digest ss.sha256_hex not null,
  provider_facts jsonb not null check (
    jsonb_typeof(provider_facts) = 'object'
    and pg_column_size(provider_facts) <= 32768
  ),
  provider_facts_digest ss.sha256_hex not null,
  livemode boolean not null,
  api_version text not null
    check (char_length(api_version) between 3 and 100),
  signature_verified_at timestamptz not null,
  provider_observed_at timestamptz not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null,
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id) on delete cascade,
  check (recorded_at >= signature_verified_at),
  check (
    (provider_state = 'failed' and provider_invoice_status = 'draft'
      and reason_code is not null)
    or (provider_state = 'recovered' and provider_invoice_status <> 'draft'
      and reason_code is null)
  )
);

create index alakazam_finalization_observations_invoice
  on ss.alakazam_invoice_finalization_observations(
    organization_id, subscription_id, stripe_invoice_id,
    provider_observed_at, id
  );

-- Mutable source-authoritative projection. It can only move to the state of a
-- newer exact readback. An open row is the fulfillment/renewal hold; it does
-- not change paid entitlement status or perform any provider/customer effect.
create table ss.alakazam_invoice_finalization_projection (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  subscription_id uuid not null,
  stripe_invoice_id text not null unique
    check (stripe_invoice_id ~ '^in_[A-Za-z0-9_]+$'),
  first_observation_id uuid not null unique,
  latest_observation_id uuid not null unique,
  state text not null check (state in ('failed', 'recovered')),
  reason_code text check (
    reason_code is null or reason_code in (
      'automatic_tax', 'invoice_settings',
      'provider_rejected', 'unknown_review'
    )
  ),
  renewal_held boolean not null,
  fulfillment_held boolean not null,
  provider_effects_authorized boolean not null default false
    check (not provider_effects_authorized),
  customer_message_code text not null check (
    customer_message_code in (
      'alakazam_invoice_preparation_attention',
      'alakazam_invoice_preparation_current'
    )
  ),
  invoice_id_digest ss.sha256_hex not null,
  evidence_digest ss.sha256_hex not null,
  first_observed_at timestamptz not null,
  recovered_at timestamptz,
  provider_observed_at timestamptz not null,
  revision bigint not null check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id) on delete cascade,
  foreign key (organization_id, first_observation_id)
    references ss.alakazam_invoice_finalization_observations(organization_id, id)
    on delete cascade,
  foreign key (organization_id, latest_observation_id)
    references ss.alakazam_invoice_finalization_observations(organization_id, id)
    on delete cascade,
  check (updated_at >= created_at),
  check (
    (state = 'failed' and reason_code is not null
      and renewal_held and fulfillment_held and recovered_at is null
      and customer_message_code = 'alakazam_invoice_preparation_attention')
    or (state = 'recovered' and reason_code is null
      and not renewal_held and not fulfillment_held and recovered_at is not null
      and customer_message_code = 'alakazam_invoice_preparation_current')
  )
);

create index alakazam_finalization_open_holds
  on ss.alakazam_invoice_finalization_projection(
    organization_id, subscription_id, first_observed_at, id
  ) where state = 'failed';

create function ss.alakazam_finalization_purge_allowed(
  selected_organization_id uuid,
  selected_project_id uuid
)
returns boolean
language sql
stable
set search_path = pg_catalog, ss
as $$
  select nullif(
    current_setting('app.terminal_purge_project_id', true), ''
  )::uuid = selected_project_id
  and exists (
    select 1 from ss.deletion_requests request
     where request.organization_id = selected_organization_id
       and request.project_id = selected_project_id
       and request.state = 'purging'
  )
$$;

create function ss.guard_alakazam_finalization_observation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE'
    and ss.alakazam_finalization_purge_allowed(
      old.organization_id, old.project_id
    )
  then
    return old;
  end if;
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'system'
    or new.recorded_at < clock_timestamp() - interval '5 minutes'
    or new.recorded_at > clock_timestamp() + interval '5 minutes'
  then
    raise exception 'Alakazam finalization observation is immutable system authority'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
      from ss.alakazam_subscriptions subscription
      join ss.stripe_customers customer
        on customer.organization_id = subscription.organization_id
       and customer.id = subscription.stripe_customer_row_id
     where subscription.organization_id = new.organization_id
       and subscription.project_id = new.project_id
       and subscription.id = new.subscription_id
       and subscription.stripe_subscription_id = new.stripe_subscription_id
       and new.provider_facts ->> 'stripeSubscriptionId' =
             subscription.stripe_subscription_id
       and new.provider_facts ->> 'stripeCustomerId' = customer.stripe_customer_id
       and new.provider_facts ->> 'stripeInvoiceId' = new.stripe_invoice_id
       and new.provider_facts ->> 'finalizationState' = new.provider_state
       and new.provider_facts ->> 'status' = new.provider_invoice_status
  ) then
    raise exception 'Alakazam finalization observation is not tenant-bound provider evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger alakazam_finalization_observations_guard
before insert or update or delete
on ss.alakazam_invoice_finalization_observations
for each row execute function ss.guard_alakazam_finalization_observation();

create function ss.guard_alakazam_finalization_projection()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  latest record;
begin
  if tg_op = 'DELETE'
    and ss.alakazam_finalization_purge_allowed(
      old.organization_id, old.project_id
    )
  then
    return old;
  end if;
  if ss.current_service_actor_kind() <> 'system' or tg_op = 'DELETE' then
    raise exception 'Alakazam finalization projection lacks system authority'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if row(new.id, new.organization_id, new.project_id, new.subscription_id,
           new.stripe_invoice_id, new.first_observation_id,
           new.first_observed_at, new.created_at)
       is distinct from
       row(old.id, old.organization_id, old.project_id, old.subscription_id,
           old.stripe_invoice_id, old.first_observation_id,
           old.first_observed_at, old.created_at)
      or new.revision <> old.revision + 1
      or new.provider_observed_at < old.provider_observed_at
    then
      raise exception 'Alakazam finalization projection moved or regressed'
        using errcode = '55000';
    end if;
  elsif new.revision <> 1 or new.created_at <> new.first_observed_at then
    raise exception 'Alakazam finalization projection insert is invalid'
      using errcode = '23514';
  end if;
  select observation.* into latest
    from ss.alakazam_invoice_finalization_observations observation
   where observation.organization_id = new.organization_id
     and observation.id = new.latest_observation_id;
  if not found
    or latest.project_id <> new.project_id
    or latest.subscription_id <> new.subscription_id
    or latest.projection_id <> new.id
    or latest.projection_revision <> new.revision
    or latest.stripe_invoice_id <> new.stripe_invoice_id
    or latest.provider_state <> new.state
    or latest.provider_facts_digest <> new.evidence_digest
    or latest.provider_observed_at <> new.provider_observed_at
    or latest.reason_code is distinct from new.reason_code
  then
    raise exception 'Alakazam finalization projection lacks exact latest evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger alakazam_finalization_projection_guard
before insert or update or delete
on ss.alakazam_invoice_finalization_projection
for each row execute function ss.guard_alakazam_finalization_projection();

-- Defense in depth: direct repository writes cannot create a renewal or move a
-- fulfillment operation into an effect-capable state while a finalization hold
-- is open. Recovery must commit first from a later provider readback.
create function ss.reject_alakazam_finalization_held_effect()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if exists (
    select 1 from ss.alakazam_invoice_finalization_projection hold
     where hold.organization_id = new.organization_id
       and hold.subscription_id = new.subscription_id
       and hold.state = 'failed'
  ) then
    raise exception 'Alakazam invoice finalization hold prevents this transition'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger alakazam_finalization_hold_renewal
before insert on ss.alakazam_renewal_settlements
for each row execute function ss.reject_alakazam_finalization_held_effect();

create trigger alakazam_finalization_hold_fulfillment
before insert or update on ss.alakazam_fulfillment_operations
for each row
when (new.state in ('queued', 'processing', 'published'))
execute function ss.reject_alakazam_finalization_held_effect();

create function ss.activate_alakazam_finalization_purge()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'purging' then
    perform set_config(
      'app.terminal_purge_project_id', new.project_id::text, true
    );
    new.removal_counts := coalesce(new.removal_counts, '{}'::jsonb)
      || jsonb_build_object(
        'alakazamInvoiceFinalizationObservations', (
          select count(*)
            from ss.alakazam_invoice_finalization_observations observation
           where observation.organization_id = new.organization_id
             and observation.project_id = new.project_id
        ),
        'alakazamInvoiceFinalizationProjections', (
          select count(*)
            from ss.alakazam_invoice_finalization_projection projection
           where projection.organization_id = new.organization_id
             and projection.project_id = new.project_id
        )
      );
  end if;
  return new;
end
$$;

create trigger deletion_requests_activate_alakazam_finalization_purge
before insert or update of state on ss.deletion_requests
for each row execute function ss.activate_alakazam_finalization_purge();

alter table ss.alakazam_invoice_finalization_observations
  enable row level security;
alter table ss.alakazam_invoice_finalization_observations
  force row level security;
alter table ss.alakazam_invoice_finalization_projection
  enable row level security;
alter table ss.alakazam_invoice_finalization_projection
  force row level security;

revoke all on
  ss.alakazam_invoice_finalization_observations,
  ss.alakazam_invoice_finalization_projection
from public, anon, authenticated, service_role;
grant select, insert on ss.alakazam_invoice_finalization_observations
to service_role;
grant select, insert, update on ss.alakazam_invoice_finalization_projection
to service_role;

revoke all on function
  ss.guard_alakazam_finalization_observation(),
  ss.guard_alakazam_finalization_projection(),
  ss.reject_alakazam_finalization_held_effect(),
  ss.activate_alakazam_finalization_purge()
from public, anon, authenticated, service_role;
revoke all on function ss.alakazam_finalization_purge_allowed(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function ss.alakazam_finalization_purge_allowed(uuid, uuid)
to service_role;

create function ss.hosted_alakazam_finalization_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-alakazam-finalization-v1-provider-readback-held'::text
$$;

revoke all on function ss.hosted_alakazam_finalization_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_alakazam_finalization_contract_v1()
to service_role;

commit;
