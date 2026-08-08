begin;

do $$
begin
  if to_regclass('ss.alakazam_payment_incidents') is null
    or to_regprocedure(
      'ss.hosted_runtime_contract_v50()'
    ) is null
  then
    raise exception
      'Site Sourcery migration 050 must be applied before Alakazam cancellation'
      using errcode = '55000';
  end if;
end
$$;

-- One customer request to stop at the end of the period they paid for.
create table ss.alakazam_cancellations (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  subscription_id uuid not null,
  customer_user_id uuid not null
    references auth.users(id),
  requested_by_user_id uuid not null
    references auth.users(id),
  accepted_disclosure_digest ss.sha256_hex not null,
  provider_idempotency_key text not null unique
    check (
      char_length(provider_idempotency_key) between 8 and 255
    ),
  subscription_revision_at_request bigint not null
    check (subscription_revision_at_request > 0),
  -- The confirmed end of the paid period. Never a guessed date.
  effective_at timestamptz not null,
  state text not null
    check (
      state in (
        'dispatching',
        'scheduled',
        'effective',
        'revoked',
        'reconciliation_required'
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
  stripe_event_row_id uuid,
  tier_change_event_id uuid unique,
  provider_facts jsonb
    check (
      provider_facts is null
      or (
        jsonb_typeof(provider_facts) = 'object'
        and pg_column_size(provider_facts) <= 32768
      )
    ),
  provider_facts_digest ss.sha256_hex,
  provider_observed_at timestamptz,
  requested_at timestamptz not null,
  scheduled_at timestamptz,
  effective_confirmed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
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
  check (
    (state = 'dispatching' and (
      stripe_event_row_id is null
      and tier_change_event_id is null
      and provider_facts is null
      and provider_facts_digest is null
      and provider_observed_at is null
      and scheduled_at is null
      and provider_effect_certainty = 'not_submitted'
    ))
    or (state in ('scheduled', 'effective') and (
      stripe_event_row_id is not null
      and tier_change_event_id is not null
      and provider_facts is not null
      and provider_facts_digest is not null
      and provider_observed_at is not null
      and scheduled_at is not null
      and provider_effect_certainty = 'confirmed'
    ))
    or state in ('revoked', 'reconciliation_required')
  ),
  check (
    (state = 'effective' and effective_confirmed_at is not null)
    or (state <> 'effective' and effective_confirmed_at is null)
  ),
  check (
    (state = 'revoked' and revoked_at is not null)
    or (state <> 'revoked' and revoked_at is null)
  ),
  check (effective_at > requested_at)
);

create unique index alakazam_one_open_cancellation
  on ss.alakazam_cancellations(subscription_id)
  where state in (
    'dispatching',
    'scheduled',
    'reconciliation_required'
  );

-- What a cancelling customer may still take with them.
--
-- The period they already paid for is a FACT and is granted here. How
-- long anything is retained BEYOND that period is an owner ruling that
-- does not exist yet, so this table refuses to state one.
create table ss.alakazam_export_grants (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  subscription_id uuid not null,
  cancellation_id uuid not null unique,
  state text not null
    check (state in ('available', 'expired', 'revoked')),
  available_from timestamptz not null,
  -- The confirmed end of the paid period.
  paid_through_at timestamptz not null,
  retention_state text not null
    check (
      retention_state in (
        'policy_decision_required',
        'granted'
      )
    ),
  policy_version text
    check (
      policy_version is null
      or policy_version ~
        '^alakazam-lifecycle[.][0-9]{4}-[0-9]{2}-[0-9]{2}[.]v[0-9]+$'
    ),
  retention_ends_at timestamptz,
  export_window_ends_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id)
    on delete cascade,
  foreign key (organization_id, cancellation_id)
    references ss.alakazam_cancellations(organization_id, id)
    on delete cascade,
  check (paid_through_at > available_from),
  -- FAIL CLOSED on retention: with no dated ruling the record says
  -- "undecided" and promises no window at all.
  check (
    (
      policy_version is null
      and retention_state = 'policy_decision_required'
      and retention_ends_at is null
      and export_window_ends_at is null
    )
    or (
      policy_version is not null
      and retention_state = 'granted'
      and retention_ends_at is not null
      and export_window_ends_at is not null
      and retention_ends_at >= paid_through_at
      and export_window_ends_at >= paid_through_at
      and export_window_ends_at <= retention_ends_at
    )
  )
);

create function ss.validate_alakazam_cancellation()
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
    or subscription_record.customer_user_id <>
         new.customer_user_id
    or subscription_record.current_period_ends_at <>
         new.effective_at
  then
    raise exception
      'Alakazam cancellation does not match its subscription period'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    -- The request preconditions bind only while the request is still
    -- open. Once a confirmation has landed, the update branch below is
    -- the authority and this deferred check must not re-litigate a
    -- subscription the confirmation legitimately advanced.
    if not exists (
      select 1
      from ss.alakazam_cancellations open_request
      where open_request.organization_id = new.organization_id
        and open_request.id = new.id
        and open_request.state = 'dispatching'
    ) then
      return new;
    end if;
    if new.state <> 'dispatching'
      or subscription_record.status not in (
        'active', 'grace', 'suspended'
      )
      or subscription_record.cancel_at_period_end
      or subscription_record.revision <>
           new.subscription_revision_at_request
      or exists (
        select 1
        from ss.alakazam_downgrade_schedules schedule
        where schedule.subscription_id = new.subscription_id
          and schedule.state in (
            'dispatching', 'scheduled', 'reconciliation_required'
          )
      )
    then
      raise exception
        'Alakazam cancellation requires one current uncancelled subscription'
        using errcode = '23514';
    end if;
  end if;
  if new.state in ('scheduled', 'effective') then
    if not subscription_record.cancel_at_period_end
      or not exists (
        select 1
        from ss.alakazam_stripe_events event
        where event.organization_id = new.organization_id
          and event.project_id = new.project_id
          and event.id = new.stripe_event_row_id
          and event.subscription_id = new.subscription_id
          and event.state = 'processed'
          and event.event_type =
              'customer.subscription.updated'
          and event.provider_object_id =
              subscription_record.stripe_subscription_id
      )
      or not exists (
        select 1
        from ss.alakazam_tier_change_events event
        where event.organization_id = new.organization_id
          and event.id = new.tier_change_event_id
          and event.subscription_id = new.subscription_id
          and event.event_kind = 'cancellation_scheduled'
          and event.stripe_event_row_id =
              new.stripe_event_row_id
      )
    then
      raise exception
        'Alakazam cancellation lacks confirmed provider evidence'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create constraint trigger alakazam_cancellations_validate
after insert or update on ss.alakazam_cancellations
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_cancellation();

create function ss.guard_alakazam_cancellation_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if (
    to_jsonb(new) - array[
      'state',
      'stripe_event_row_id',
      'tier_change_event_id',
      'provider_facts',
      'provider_facts_digest',
      'provider_observed_at',
      'provider_effect_certainty',
      'scheduled_at',
      'effective_confirmed_at',
      'revoked_at',
      'updated_at'
    ]::text[]
  ) is distinct from (
    to_jsonb(old) - array[
      'state',
      'stripe_event_row_id',
      'tier_change_event_id',
      'provider_facts',
      'provider_facts_digest',
      'provider_observed_at',
      'provider_effect_certainty',
      'scheduled_at',
      'effective_confirmed_at',
      'revoked_at',
      'updated_at'
    ]::text[]
  ) then
    raise exception
      'Alakazam cancellation purpose is immutable'
      using errcode = '55000';
  end if;
  if new.state <> old.state and not (
    (old.state = 'dispatching' and new.state in (
      'scheduled', 'revoked', 'reconciliation_required'
    ))
    or (old.state = 'scheduled' and new.state in (
      'effective', 'revoked', 'reconciliation_required'
    ))
    or (
      old.state = 'reconciliation_required'
      and new.state in ('scheduled', 'effective', 'revoked')
    )
  ) then
    raise exception 'invalid Alakazam cancellation transition'
      using errcode = '23514';
  end if;
  -- Confirmed provider evidence never changes after the fact.
  if old.state in ('scheduled', 'effective')
    and (
      new.stripe_event_row_id is distinct from
        old.stripe_event_row_id
      or new.tier_change_event_id is distinct from
        old.tier_change_event_id
      or new.provider_facts_digest is distinct from
        old.provider_facts_digest
      or new.scheduled_at is distinct from old.scheduled_at
    )
  then
    raise exception
      'confirmed Alakazam cancellation evidence is immutable'
      using errcode = '55000';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger alakazam_cancellations_guard_update
before update on ss.alakazam_cancellations
for each row execute function
  ss.guard_alakazam_cancellation_update();

create function ss.validate_alakazam_export_grant()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  cancellation_record record;
begin
  select * into cancellation_record
  from ss.alakazam_cancellations cancellation
  where cancellation.organization_id = new.organization_id
    and cancellation.id = new.cancellation_id;
  if not found
    or cancellation_record.project_id <> new.project_id
    or cancellation_record.subscription_id <>
         new.subscription_id
    or cancellation_record.state not in (
      'scheduled', 'effective'
    )
    or cancellation_record.effective_at <>
         new.paid_through_at
  then
    raise exception
      'Alakazam export grant requires its confirmed cancellation'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_export_grants_validate
after insert or update on ss.alakazam_export_grants
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_export_grant();

create function ss.guard_alakazam_export_grant_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if (
    to_jsonb(new) - array[
      'state',
      'retention_state',
      'policy_version',
      'retention_ends_at',
      'export_window_ends_at',
      'updated_at'
    ]::text[]
  ) is distinct from (
    to_jsonb(old) - array[
      'state',
      'retention_state',
      'policy_version',
      'retention_ends_at',
      'export_window_ends_at',
      'updated_at'
    ]::text[]
  ) then
    raise exception
      'Alakazam export grant identity is immutable'
      using errcode = '55000';
  end if;
  -- A granted retention window is a promise the customer relies on.
  -- It may never be shortened or withdrawn once stated.
  if old.retention_state = 'granted'
    and (
      new.retention_state <> 'granted'
      or new.policy_version is distinct from old.policy_version
      or new.retention_ends_at < old.retention_ends_at
      or new.export_window_ends_at < old.export_window_ends_at
    )
  then
    raise exception
      'a granted Alakazam export window cannot be reduced'
      using errcode = '55000';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger alakazam_export_grants_guard_update
before update on ss.alakazam_export_grants
for each row execute function
  ss.guard_alakazam_export_grant_update();

create trigger alakazam_cancellations_immutable
before delete on ss.alakazam_cancellations
for each row execute function
  ss.reject_alakazam_evidence_mutation();

create trigger alakazam_export_grants_immutable
before delete on ss.alakazam_export_grants
for each row execute function
  ss.reject_alakazam_evidence_mutation();

do $$
declare
  table_name text;
  tables text[] := array[
    'alakazam_cancellations',
    'alakazam_export_grants'
  ];
begin
  foreach table_name in array tables loop
    execute format(
      'alter table ss.%I enable row level security',
      table_name
    );
    execute format(
      'alter table ss.%I force row level security',
      table_name
    );
    execute format(
      'revoke all on ss.%I from public, anon, authenticated',
      table_name
    );
    execute format(
      'grant all privileges on ss.%I to service_role',
      table_name
    );
  end loop;
end
$$;

revoke all on function
  ss.validate_alakazam_cancellation(),
  ss.guard_alakazam_cancellation_update(),
  ss.validate_alakazam_export_grant(),
  ss.guard_alakazam_export_grant_update()
from public, anon, authenticated;

grant execute on function
  ss.validate_alakazam_cancellation(),
  ss.guard_alakazam_cancellation_update(),
  ss.validate_alakazam_export_grant(),
  ss.guard_alakazam_export_grant_update()
to service_role;

do $$
begin
  if has_table_privilege(
      'authenticated',
      'ss.alakazam_cancellations',
      'SELECT'
    )
    or has_table_privilege(
      'anon',
      'ss.alakazam_export_grants',
      'SELECT'
    )
  then
    raise exception
      'Alakazam cancellation privilege boundary is unsafe'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v51()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v51-alakazam-cancellation-export'::text
$$;

revoke all on function ss.hosted_runtime_contract_v51()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v51()
to service_role;

commit;
