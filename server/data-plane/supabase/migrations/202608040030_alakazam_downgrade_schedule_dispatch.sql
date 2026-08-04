begin;

do $$
begin
  if to_regprocedure(
       'ss.hosted_runtime_contract_v29()'
     ) is null
    or to_regclass(
         'ss.alakazam_downgrade_schedules'
       ) is null
    or to_regclass(
         'ss.alakazam_tier_change_events'
       ) is null
  then
    raise exception
      'Site Sourcery migration 029 must be applied before Alakazam downgrade Schedule dispatch'
      using errcode = '55000';
  end if;

  -- No released runtime can create these rows yet. Refuse to invent the
  -- accepted purpose for any hand-written pre-release row.
  if exists (
    select 1 from ss.alakazam_downgrade_schedules
  ) then
    raise exception
      'pre-release Alakazam downgrade rows require owner reconciliation before migration 030'
      using errcode = '55000';
  end if;
end
$$;

alter table ss.alakazam_downgrade_schedules
  alter column target_stripe_price_id drop not null,
  add column purpose jsonb not null
    check (
      jsonb_typeof(purpose) = 'object'
      and pg_column_size(purpose) <= 32768
    ),
  add column provider_effect_certainty text not null
    check (
      provider_effect_certainty in (
        'not_submitted',
        'confirmed',
        'ambiguous'
      )
    ),
  add column provider_reconciliation text
    check (
      provider_reconciliation is null
      or provider_reconciliation in (
        'confirmed',
        'readback_after_ambiguity'
      )
    ),
  add column provider_error_code text
    check (
      provider_error_code is null
      or char_length(provider_error_code)
           between 1 and 200
    ),
  add column lease_expires_at timestamptz not null,
  add constraint alakazam_downgrade_idempotency_exact
    check (
      provider_idempotency_key =
        'alakazam:downgrade:schedule:' || id::text
    ),
  add constraint alakazam_downgrade_lease_exact
    check (
      lease_expires_at =
        created_at + interval '2 minutes'
    ),
  add constraint alakazam_downgrade_dispatch_evidence_exact
    check (
      (
        state = 'dispatching'
        and target_stripe_price_id is null
        and stripe_schedule_id is null
        and provider_effect_certainty = 'not_submitted'
        and provider_facts is null
        and provider_facts_digest is null
        and provider_reconciliation is null
        and provider_error_code is null
        and scheduled_at is null
      )
      or (
        state = 'reconciliation_required'
        and target_stripe_price_id is null
        and provider_effect_certainty = 'ambiguous'
        and provider_facts is null
        and provider_facts_digest is null
        and provider_reconciliation is null
        and provider_error_code is not null
        and scheduled_at is null
      )
      or (
        state in ('scheduled', 'applied', 'cancelled')
        and target_stripe_price_id is not null
        and target_stripe_price_id <>
            current_stripe_price_id
        and stripe_schedule_id is not null
        and provider_effect_certainty = 'confirmed'
        and provider_facts is not null
        and provider_facts_digest is not null
        and provider_reconciliation is not null
        and provider_error_code is null
        and scheduled_at is not null
      )
    );

create unique index alakazam_one_downgrade_schedule_event
  on ss.alakazam_tier_change_events(quote_id)
  where event_kind = 'downgrade_scheduled';

create or replace function
  ss.validate_alakazam_downgrade_schedule()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
  subscription_record record;
  customer_record record;
  purpose_current jsonb;
begin
  select quote.* into quote_record
  from ss.alakazam_change_quotes quote
  where quote.organization_id = new.organization_id
    and quote.id = new.quote_id
  for update;

  select subscription.* into subscription_record
  from ss.alakazam_subscriptions subscription
  where subscription.organization_id = new.organization_id
    and subscription.id = new.subscription_id
  for update;

  if subscription_record.id is not null then
    select customer.* into customer_record
    from ss.stripe_customers customer
    where customer.organization_id = new.organization_id
      and customer.id =
          subscription_record.stripe_customer_row_id
    for update;
  end if;

  purpose_current :=
    new.purpose -> 'currentSubscription';

  if quote_record.id is null
    or subscription_record.id is null
    or customer_record.id is null
    or new.state <> 'dispatching'
    or new.provider_effect_certainty <> 'not_submitted'
    or new.created_at <> new.updated_at
    or new.lease_expires_at <>
       new.created_at + interval '2 minutes'
    or new.created_at < quote_record.issued_at
    or new.created_at > quote_record.expires_at
    or quote_record.project_id <> new.project_id
    or quote_record.change_kind <> 'downgrade'
    or quote_record.state <> 'schedule_dispatching'
    or not quote_record.provider_effects_authorized
    or quote_record.current_subscription_id <>
         new.subscription_id
    or quote_record.current_subscription_revision <>
         subscription_record.revision
    or quote_record.current_tier_id <> new.current_tier_id
    or quote_record.target_tier_id <> new.target_tier_id
    or quote_record.effective_at <> new.effective_at
    or subscription_record.project_id <> new.project_id
    or subscription_record.customer_user_id <>
         quote_record.customer_user_id
    or subscription_record.status <> 'active'
    or subscription_record.tier_id <> new.current_tier_id
    or subscription_record.stripe_price_id <>
         new.current_stripe_price_id
    or subscription_record.current_period_ends_at <>
         new.effective_at
    or subscription_record.cancel_at_period_end
    or jsonb_typeof(new.purpose) <> 'object'
    or (
      select count(*)
      from jsonb_object_keys(new.purpose)
    ) <> 19
    or not new.purpose ?& array[
         'schema', 'catalogVersion', 'termsVersion',
         'organizationId', 'customerId', 'projectId',
         'quoteId', 'stripeCustomerId',
         'acceptedDisclosureDigest', 'quoteDigest',
         'changeKind', 'currentSubscription',
         'targetTierId', 'targetAmountMinor',
         'dueNowSubtotalMinor', 'nextRenewalAmountMinor',
         'currency', 'taxMode', 'downloadCredit'
       ]
    or new.purpose ->> 'schema' <>
         'sitesourcery.alakazam-stripe-purpose.v1'
    or new.purpose ->> 'catalogVersion' <>
         'alakazam.2026-08-02.v1'
    or new.purpose ->> 'termsVersion' <>
         'alakazam-owner-contract.2026-08-02.v1'
    or new.purpose ->> 'organizationId' <>
         new.organization_id::text
    or new.purpose ->> 'customerId' <>
         quote_record.customer_user_id::text
    or new.purpose ->> 'projectId' <> new.project_id::text
    or new.purpose ->> 'quoteId' <> new.quote_id::text
    or new.purpose ->> 'stripeCustomerId' <>
         customer_record.stripe_customer_id
    or new.purpose ->> 'acceptedDisclosureDigest' <>
         quote_record.disclosure_digest
    or new.purpose ->> 'quoteDigest' <>
         quote_record.quote_digest
    or new.purpose ->> 'changeKind' <> 'downgrade'
    or jsonb_typeof(purpose_current) <> 'object'
    or (
      select count(*)
      from jsonb_object_keys(purpose_current)
    ) <> 10
    or not purpose_current ?& array[
         'localSubscriptionId', 'revision', 'tierId',
         'amountMinor', 'stripeSubscriptionId',
         'stripeSubscriptionItemId', 'stripePriceId',
         'currentPeriodStartsAt', 'currentPeriodEndsAt',
         'providerFactsDigest'
       ]
    or purpose_current ->> 'localSubscriptionId' <>
         new.subscription_id::text
    or (purpose_current ->> 'revision')::bigint <>
         subscription_record.revision
    or purpose_current ->> 'tierId' <> new.current_tier_id
    or (purpose_current ->> 'amountMinor')::bigint <>
         subscription_record.amount_minor
    or purpose_current ->> 'stripeSubscriptionId' <>
         subscription_record.stripe_subscription_id
    or purpose_current ->> 'stripeSubscriptionItemId' <>
         subscription_record.stripe_subscription_item_id
    or purpose_current ->> 'stripePriceId' <>
         subscription_record.stripe_price_id
    or (purpose_current ->> 'currentPeriodStartsAt')
         ::timestamptz <>
         subscription_record.current_period_starts_at
    or (purpose_current ->> 'currentPeriodEndsAt')
         ::timestamptz <>
         subscription_record.current_period_ends_at
    or purpose_current ->> 'providerFactsDigest' <>
         subscription_record.provider_facts_digest
    or new.purpose ->> 'targetTierId' <>
         new.target_tier_id
    or (new.purpose ->> 'targetAmountMinor')::bigint <>
         quote_record.target_amount_minor
    or (new.purpose ->> 'dueNowSubtotalMinor')::bigint <> 0
    or (new.purpose ->> 'nextRenewalAmountMinor')::bigint <>
         quote_record.target_amount_minor
    or new.purpose ->> 'currency' <> 'USD'
    or new.purpose ->> 'taxMode' <> quote_record.tax_state
    or new.purpose -> 'downloadCredit' <> 'null'::jsonb
  then
    raise exception
      'Alakazam downgrade requires one exact accepted current-revision Schedule purpose'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function
  ss.guard_alakazam_downgrade_update()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
  subscription_record record;
  expected_facts jsonb;
begin
  if (
    to_jsonb(new) - array[
      'state',
      'target_stripe_price_id',
      'stripe_schedule_id',
      'provider_effect_certainty',
      'provider_facts',
      'provider_facts_digest',
      'provider_reconciliation',
      'provider_error_code',
      'scheduled_at',
      'applied_at',
      'cancelled_at',
      'updated_at'
    ]::text[]
  ) is distinct from (
    to_jsonb(old) - array[
      'state',
      'target_stripe_price_id',
      'stripe_schedule_id',
      'provider_effect_certainty',
      'provider_facts',
      'provider_facts_digest',
      'provider_reconciliation',
      'provider_error_code',
      'scheduled_at',
      'applied_at',
      'cancelled_at',
      'updated_at'
    ]::text[]
  ) then
    raise exception
      'Alakazam downgrade purpose is immutable'
      using errcode = '55000';
  end if;

  if new.state = old.state or not (
    (
      old.state = 'dispatching'
      and new.state in (
        'scheduled', 'reconciliation_required'
      )
    )
    or (
      old.state = 'reconciliation_required'
      and new.state = 'scheduled'
    )
    or (
      old.state = 'scheduled'
      and new.state in ('applied', 'cancelled')
    )
  ) then
    raise exception
      'invalid Alakazam downgrade transition'
      using errcode = '23514';
  end if;

  if old.state = 'scheduled'
    and new.state in ('applied', 'cancelled')
    and (
      new.target_stripe_price_id is distinct from
        old.target_stripe_price_id
      or new.stripe_schedule_id is distinct from
        old.stripe_schedule_id
      or new.provider_effect_certainty is distinct from
        old.provider_effect_certainty
      or new.provider_facts is distinct from
        old.provider_facts
      or new.provider_facts_digest is distinct from
        old.provider_facts_digest
      or new.provider_reconciliation is distinct from
        old.provider_reconciliation
      or new.provider_error_code is distinct from
        old.provider_error_code
      or new.scheduled_at is distinct from old.scheduled_at
    )
  then
    raise exception
      'confirmed Alakazam downgrade evidence is immutable'
      using errcode = '55000';
  end if;

  if new.state = 'scheduled' then
    select quote.* into quote_record
    from ss.alakazam_change_quotes quote
    where quote.organization_id = new.organization_id
      and quote.id = new.quote_id;

    select subscription.* into subscription_record
    from ss.alakazam_subscriptions subscription
    where subscription.organization_id = new.organization_id
      and subscription.id = new.subscription_id;

    expected_facts := jsonb_build_object(
      'schema',
        'sitesourcery.stripe-alakazam-downgrade-schedule/v1',
      'stripeScheduleId', new.stripe_schedule_id,
      'stripeSubscriptionId',
        new.purpose #>>
          '{currentSubscription,stripeSubscriptionId}',
      'stripeCustomerId',
        new.purpose ->> 'stripeCustomerId',
      'currentTierId', new.current_tier_id,
      'targetTierId', new.target_tier_id,
      'currentPriceId', new.current_stripe_price_id,
      'targetPriceId', new.target_stripe_price_id,
      'effectiveAt',
        new.provider_facts ->> 'effectiveAt',
      'endBehavior', 'release',
      'providerProration', false,
      'providerObservedAt',
        new.provider_facts ->> 'providerObservedAt',
      'providerFactsDigest', new.provider_facts_digest
    );

    if quote_record.id is null
      or subscription_record.id is null
      or quote_record.state not in (
           'schedule_dispatching',
           'reconciliation_required'
         )
      or subscription_record.status <> 'active'
      or subscription_record.revision <>
           (new.purpose #>>
             '{currentSubscription,revision}')::bigint
      or subscription_record.tier_id <> new.current_tier_id
      or subscription_record.stripe_price_id <>
           new.current_stripe_price_id
      or subscription_record.current_period_ends_at <>
           new.effective_at
      or subscription_record.cancel_at_period_end
      or new.target_stripe_price_id is null
      or new.target_stripe_price_id !~
           '^price_[A-Za-z0-9_]+$'
      or new.target_stripe_price_id =
           new.current_stripe_price_id
      or new.stripe_schedule_id is null
      or new.provider_effect_certainty <> 'confirmed'
      or new.provider_reconciliation is null
      or new.provider_error_code is not null
      or new.provider_facts is null
      or (
        select count(*)
        from jsonb_object_keys(new.provider_facts)
      ) <> 13
      or new.provider_facts <> expected_facts
      or new.provider_facts_digest <>
           new.provider_facts ->> 'providerFactsDigest'
      or (new.provider_facts ->> 'effectiveAt')
           ::timestamptz <> new.effective_at
      or (new.provider_facts ->> 'providerObservedAt')
           ::timestamptz < new.created_at
      or new.scheduled_at <
           (new.provider_facts ->> 'providerObservedAt')
             ::timestamptz
    then
      raise exception
        'scheduled Alakazam downgrade lacks exact provider Schedule evidence'
        using errcode = '23514';
    end if;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end
$$;

create function ss.validate_alakazam_downgrade_dispatch()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'scheduled'
    and old.state <> 'scheduled'
    and not exists (
      select 1
      from ss.alakazam_change_quotes quote
      join ss.alakazam_subscriptions subscription
        on subscription.organization_id = quote.organization_id
       and subscription.id = quote.current_subscription_id
      join ss.alakazam_tier_change_events tier_event
        on tier_event.organization_id = quote.organization_id
       and tier_event.subscription_id = subscription.id
       and tier_event.quote_id = quote.id
       and tier_event.downgrade_schedule_id = new.id
       and tier_event.event_kind = 'downgrade_scheduled'
      where quote.organization_id = new.organization_id
        and quote.id = new.quote_id
        and quote.project_id = new.project_id
        and quote.change_kind = 'downgrade'
        and quote.state = 'scheduled'
        and subscription.id = new.subscription_id
        and subscription.status = 'active'
        and subscription.revision =
            (new.purpose #>>
              '{currentSubscription,revision}')::bigint
        and subscription.tier_id = new.current_tier_id
        and subscription.stripe_price_id =
            new.current_stripe_price_id
        and subscription.current_period_ends_at =
            new.effective_at
        and not subscription.cancel_at_period_end
        and tier_event.stripe_event_row_id is null
        and tier_event.payment_receipt_id is null
        and tier_event.result_subscription_revision is null
        and tier_event.prior_tier_id = new.current_tier_id
        and tier_event.result_tier_id = new.target_tier_id
        and tier_event.occurred_at = new.scheduled_at
        and tier_event.facts ->> 'schema' =
            'sitesourcery.alakazam-tier-event/v1'
        and tier_event.facts ->> 'changeKind' = 'downgrade'
        and tier_event.facts ->> 'scheduleId' = new.id::text
        and tier_event.facts ->> 'stripeScheduleId' =
            new.stripe_schedule_id
        and tier_event.facts ->> 'purposeDigest' =
            new.purpose_digest
        and tier_event.facts ->> 'providerFactsDigest' =
            new.provider_facts_digest
        and tier_event.facts ->> 'reconciliation' =
            new.provider_reconciliation
        and tier_event.facts ->> 'priorTierId' =
            new.current_tier_id
        and tier_event.facts ->> 'targetTierId' =
            new.target_tier_id
        and (tier_event.facts ->> 'currentRevision')
              ::bigint = subscription.revision
        and (tier_event.facts ->> 'effectiveAt')
              ::timestamptz = new.effective_at
    )
  then
    raise exception
      'scheduled Alakazam downgrade lacks exact atomic local evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_downgrade_dispatches_validate
after update on ss.alakazam_downgrade_schedules
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_downgrade_dispatch();

revoke all on function
  ss.validate_alakazam_downgrade_dispatch()
from public, anon, authenticated;
grant execute on function
  ss.validate_alakazam_downgrade_dispatch()
to service_role;

create function ss.hosted_runtime_contract_v30()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-ss-v30-alakazam-downgrade-schedule-dispatch'
    ::text
$$;

revoke all on function ss.hosted_runtime_contract_v30()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v30()
to authenticated, service_role;

commit;
