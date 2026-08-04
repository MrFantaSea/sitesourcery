begin;

do $$
begin
  if to_regprocedure(
       'ss.hosted_runtime_contract_v27()'
     ) is null
    or to_regclass('ss.alakazam_subscriptions') is null
    or to_regclass('ss.alakazam_payment_receipts') is null
    or to_regclass('ss.alakazam_checkout_dispatches') is null
  then
    raise exception
      'Site Sourcery migration 027 must be applied before Alakazam upgrade application'
      using errcode = '55000';
  end if;
end
$$;

-- The one-time difference is already paid before this row can exist. This
-- application is committed before Stripe is asked to replace the recurring
-- Price, so a crash or ambiguous provider response can only enter read-only
-- reconciliation and can never submit another paid upgrade automatically.
create table ss.alakazam_upgrade_applications (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null
    references auth.users(id),
  subscription_id uuid not null,
  quote_id uuid not null unique,
  checkout_dispatch_id uuid not null unique,
  payment_receipt_id uuid not null unique,
  provider text not null check (provider = 'stripe'),
  provider_idempotency_key text not null unique
    check (
      char_length(provider_idempotency_key)
        between 8 and 255
    ),
  purpose jsonb not null
    check (
      jsonb_typeof(purpose) = 'object'
      and pg_column_size(purpose) <= 32768
    ),
  purpose_digest ss.sha256_hex not null,
  payment_provider_facts_digest ss.sha256_hex not null,
  state text not null
    check (
      state in (
        'dispatching',
        'provider_confirmed',
        'reconciliation_required',
        'applied'
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
  provider_facts jsonb
    check (
      provider_facts is null
      or (
        jsonb_typeof(provider_facts) = 'object'
        and pg_column_size(provider_facts) <= 32768
      )
    ),
  provider_facts_digest ss.sha256_hex,
  provider_reconciliation text
    check (
      provider_reconciliation is null
      or provider_reconciliation in (
        'confirmed',
        'confirmed_before_submit',
        'confirmed_after_ambiguous_submit',
        'readback_after_ambiguity'
      )
    ),
  provider_error_code text
    check (
      provider_error_code is null
      or char_length(provider_error_code)
           between 1 and 200
    ),
  lease_expires_at timestamptz not null,
  provider_confirmed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null
    default clock_timestamp(),
  updated_at timestamptz not null
    default clock_timestamp(),
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (
    organization_id,
    customer_user_id
  ) references ss.organization_memberships(
    organization_id,
    user_id
  ),
  foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(
      organization_id,
      id
    ) on delete cascade,
  foreign key (organization_id, quote_id)
    references ss.alakazam_change_quotes(
      organization_id,
      id
    ) on delete cascade,
  foreign key (
    organization_id,
    checkout_dispatch_id
  ) references ss.alakazam_checkout_dispatches(
    organization_id,
    id
  ) on delete cascade,
  foreign key (
    organization_id,
    payment_receipt_id
  ) references ss.alakazam_payment_receipts(
    organization_id,
    id
  ) on delete cascade,
  check (
    provider_idempotency_key =
      'alakazam:upgrade:apply:' || id::text
  ),
  check (lease_expires_at > created_at),
  check (
    (
      state = 'dispatching'
      and provider_effect_certainty = 'not_submitted'
      and provider_facts is null
      and provider_facts_digest is null
      and provider_reconciliation is null
      and provider_error_code is null
      and provider_confirmed_at is null
      and applied_at is null
    )
    or (
      state = 'provider_confirmed'
      and provider_effect_certainty = 'confirmed'
      and provider_facts is not null
      and provider_facts_digest is not null
      and provider_reconciliation is not null
      and provider_error_code is null
      and provider_confirmed_at is not null
      and applied_at is null
    )
    or (
      state = 'reconciliation_required'
      and provider_effect_certainty = 'ambiguous'
      and provider_facts is null
      and provider_facts_digest is null
      and provider_reconciliation is null
      and provider_error_code is not null
      and provider_confirmed_at is null
      and applied_at is null
    )
    or (
      state = 'applied'
      and provider_effect_certainty = 'confirmed'
      and provider_facts is not null
      and provider_facts_digest is not null
      and provider_reconciliation is not null
      and provider_error_code is null
      and provider_confirmed_at is not null
      and applied_at is not null
      and applied_at >= provider_confirmed_at
    )
  )
);

create unique index alakazam_one_open_upgrade_application
  on ss.alakazam_upgrade_applications(subscription_id)
  where state in (
    'dispatching',
    'provider_confirmed',
    'reconciliation_required'
  );

create function ss.validate_alakazam_upgrade_application_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
  dispatch_record record;
  subscription_record record;
  receipt_record record;
begin
  select quote.* into quote_record
  from ss.alakazam_change_quotes quote
  where quote.organization_id = new.organization_id
    and quote.id = new.quote_id
  for update;

  select dispatch.* into dispatch_record
  from ss.alakazam_checkout_dispatches dispatch
  where dispatch.organization_id = new.organization_id
    and dispatch.id = new.checkout_dispatch_id
  for update;

  select subscription.* into subscription_record
  from ss.alakazam_subscriptions subscription
  where subscription.organization_id = new.organization_id
    and subscription.id = new.subscription_id
  for update;

  select receipt.* into receipt_record
  from ss.alakazam_payment_receipts receipt
  where receipt.organization_id = new.organization_id
    and receipt.id = new.payment_receipt_id
  for update;

  if quote_record.id is null
    or dispatch_record.id is null
    or subscription_record.id is null
    or receipt_record.id is null
    or new.state <> 'dispatching'
    or new.provider_effect_certainty <> 'not_submitted'
    or new.created_at <> new.updated_at
    or new.lease_expires_at <>
       new.created_at + interval '2 minutes'
    or quote_record.project_id <> new.project_id
    or quote_record.customer_user_id <>
         new.customer_user_id
    or quote_record.change_kind <> 'upgrade'
    or quote_record.state <> 'provider_change_pending'
    or not quote_record.provider_effects_authorized
    or quote_record.current_subscription_id <>
         new.subscription_id
    or subscription_record.project_id <> new.project_id
    or subscription_record.customer_user_id <>
         new.customer_user_id
    or subscription_record.status <> 'active'
    or subscription_record.revision <>
         quote_record.current_subscription_revision
    or subscription_record.tier_id <>
         quote_record.current_tier_id
    or subscription_record.amount_minor <>
         quote_record.current_amount_minor
    or subscription_record.current_period_ends_at <>
         quote_record.current_period_ends_at
    or subscription_record.cancel_at_period_end
    or dispatch_record.project_id <> new.project_id
    or dispatch_record.customer_user_id <>
         new.customer_user_id
    or dispatch_record.quote_id <> new.quote_id
    or dispatch_record.mode <> 'upgrade_difference'
    or dispatch_record.state <> 'settled'
    or dispatch_record.provider_effect_certainty <>
         'confirmed'
    or dispatch_record.purpose <> new.purpose
    or dispatch_record.purpose_digest <>
         new.purpose_digest
    or receipt_record.project_id <> new.project_id
    or receipt_record.customer_user_id <>
         new.customer_user_id
    or receipt_record.subscription_id <>
         new.subscription_id
    or receipt_record.quote_id <> new.quote_id
    or receipt_record.receipt_kind <>
         'upgrade_difference'
    or receipt_record.provider_facts_digest <>
         new.payment_provider_facts_digest
    or not exists (
      select 1
      from ss.alakazam_stripe_events payment_event
      where payment_event.organization_id =
              new.organization_id
        and payment_event.id =
              receipt_record.stripe_event_row_id
        and payment_event.subscription_id =
              new.subscription_id
        and payment_event.state = 'processed'
    )
    or not exists (
      select 1
      from ss.alakazam_tier_change_events tier_event
      where tier_event.organization_id =
              new.organization_id
        and tier_event.subscription_id =
              new.subscription_id
        and tier_event.quote_id = new.quote_id
        and tier_event.payment_receipt_id =
              new.payment_receipt_id
        and tier_event.event_kind =
              'upgrade_payment_settled'
    )
    or not exists (
      select 1
      from ss.stripe_customers customer
      where customer.organization_id = new.organization_id
        and customer.id =
              subscription_record.stripe_customer_row_id
        and customer.stripe_customer_id =
              new.purpose ->> 'stripeCustomerId'
    )
  then
    raise exception
      'Alakazam upgrade application requires one exact paid current-revision handoff'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger alakazam_upgrade_applications_validate_insert
before insert on ss.alakazam_upgrade_applications
for each row execute function
  ss.validate_alakazam_upgrade_application_insert();

create function ss.guard_alakazam_upgrade_application_update()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  expected_metadata jsonb;
  expected_facts jsonb;
  subscription_record record;
  quote_record record;
  receipt_record record;
begin
  if (
    to_jsonb(new) - array[
      'state',
      'provider_effect_certainty',
      'provider_facts',
      'provider_facts_digest',
      'provider_reconciliation',
      'provider_error_code',
      'provider_confirmed_at',
      'applied_at',
      'updated_at'
    ]::text[]
  ) is distinct from (
    to_jsonb(old) - array[
      'state',
      'provider_effect_certainty',
      'provider_facts',
      'provider_facts_digest',
      'provider_reconciliation',
      'provider_error_code',
      'provider_confirmed_at',
      'applied_at',
      'updated_at'
    ]::text[]
  ) then
    raise exception
      'Alakazam upgrade application purpose is immutable'
      using errcode = '55000';
  end if;

  if new.state = old.state or not (
    (old.state = 'dispatching' and new.state in (
      'provider_confirmed',
      'reconciliation_required'
    ))
    or (
      old.state = 'reconciliation_required'
      and new.state = 'provider_confirmed'
    )
    or (
      old.state = 'provider_confirmed'
      and new.state = 'applied'
    )
  ) then
    raise exception
      'invalid Alakazam upgrade application transition'
      using errcode = '23514';
  end if;

  if old.state = 'provider_confirmed'
    and new.state = 'applied'
    and (
      new.provider_effect_certainty is distinct from
        old.provider_effect_certainty
      or new.provider_facts is distinct from
        old.provider_facts
      or new.provider_facts_digest is distinct from
        old.provider_facts_digest
      or new.provider_reconciliation is distinct from
        old.provider_reconciliation
      or new.provider_error_code is distinct from
        old.provider_error_code
      or new.provider_confirmed_at is distinct from
        old.provider_confirmed_at
    )
  then
    raise exception
      'confirmed Alakazam upgrade provider evidence is immutable'
      using errcode = '55000';
  end if;

  if new.state = 'provider_confirmed' then
    select subscription.* into subscription_record
    from ss.alakazam_subscriptions subscription
    where subscription.organization_id = new.organization_id
      and subscription.id = new.subscription_id;

    select quote.* into quote_record
    from ss.alakazam_change_quotes quote
    where quote.organization_id = new.organization_id
      and quote.id = new.quote_id;

    select receipt.* into receipt_record
    from ss.alakazam_payment_receipts receipt
    where receipt.organization_id = new.organization_id
      and receipt.id = new.payment_receipt_id;

    expected_metadata := jsonb_build_object(
      'accepted_disclosure_digest',
        new.purpose ->> 'acceptedDisclosureDigest',
      'catalog_version',
        new.purpose ->> 'catalogVersion',
      'change_kind', 'upgrade',
      'customer_id',
        new.purpose ->> 'customerId',
      'local_subscription_id',
        new.purpose #>> '{currentSubscription,localSubscriptionId}',
      'organization_id',
        new.purpose ->> 'organizationId',
      'payment_facts_digest',
        new.payment_provider_facts_digest,
      'payment_receipt_id',
        new.payment_receipt_id::text,
      'prior_tier_id',
        new.purpose #>> '{currentSubscription,tierId}',
      'project_id',
        new.purpose ->> 'projectId',
      'purpose_digest', new.purpose_digest,
      'quote_digest',
        new.purpose ->> 'quoteDigest',
      'quote_id', new.purpose ->> 'quoteId',
      'schema', 'sitesourcery_alakazam_change_v1',
      'subscription_revision',
        new.purpose #>> '{currentSubscription,revision}',
      'target_tier_id',
        new.purpose ->> 'targetTierId',
      'tax_mode', new.purpose ->> 'taxMode',
      'terms_version', new.purpose ->> 'termsVersion'
    );

    expected_facts := jsonb_build_object(
      'amountMinor',
        ss.alakazam_tier_amount_minor(
          new.purpose ->> 'targetTierId'
        ),
      'billingCycleAnchor',
        new.provider_facts ->> 'billingCycleAnchor',
      'cancelAtPeriodEnd', false,
      'currency', 'USD',
      'currentPeriodEndsAt',
        new.purpose #>>
          '{currentSubscription,currentPeriodEndsAt}',
      'currentPeriodStartsAt',
        new.purpose #>>
          '{currentSubscription,currentPeriodStartsAt}',
      'metadata', expected_metadata,
      'providerFactsDigest',
        new.provider_facts_digest,
      'providerObservedAt',
        new.provider_facts ->> 'providerObservedAt',
      'providerStatus', 'active',
      'schema',
        'sitesourcery.stripe-alakazam-subscription/v1',
      'stripeCustomerId',
        new.purpose ->> 'stripeCustomerId',
      'stripePriceId',
        new.provider_facts ->> 'stripePriceId',
      'stripeScheduleId', null,
      'stripeSubscriptionId',
        new.purpose #>>
          '{currentSubscription,stripeSubscriptionId}',
      'stripeSubscriptionItemId',
        new.purpose #>>
          '{currentSubscription,stripeSubscriptionItemId}',
      'tierId', new.purpose ->> 'targetTierId'
    );

    if subscription_record.id is null
      or quote_record.id is null
      or receipt_record.id is null
      or subscription_record.status <> 'active'
      or subscription_record.revision <>
           quote_record.current_subscription_revision
      or subscription_record.tier_id <>
           quote_record.current_tier_id
      or subscription_record.id <> new.subscription_id
      or quote_record.state not in (
           'provider_change_pending',
           'reconciliation_required'
         )
      or receipt_record.provider_facts_digest <>
           new.payment_provider_facts_digest
      or new.provider_effect_certainty <> 'confirmed'
      or new.provider_error_code is not null
      or new.provider_facts is null
      or new.provider_facts <> expected_facts
      or new.provider_facts_digest <>
           new.provider_facts ->> 'providerFactsDigest'
      or new.provider_facts ->> 'stripePriceId' =
           new.purpose #>>
             '{currentSubscription,stripePriceId}'
      or new.provider_facts ->> 'stripePriceId'
           !~ '^price_[A-Za-z0-9_]+$'
      or (
        new.provider_facts ->> 'billingCycleAnchor'
      )::timestamptz is null
      or (
        new.provider_facts ->> 'providerObservedAt'
      )::timestamptz < new.created_at
      or new.provider_confirmed_at <
           (
             new.provider_facts ->> 'providerObservedAt'
           )::timestamptz
      or new.provider_reconciliation is null
    then
      raise exception
        'confirmed Alakazam upgrade application lacks exact provider evidence'
        using errcode = '23514';
    end if;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger alakazam_upgrade_applications_guard_update
before update on ss.alakazam_upgrade_applications
for each row execute function
  ss.guard_alakazam_upgrade_application_update();

create function ss.guard_alakazam_upgrade_application_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if nullif(
       current_setting(
         'app.terminal_purge_project_id',
         true
       ),
       ''
     )::uuid = old.project_id
    and exists (
      select 1
      from ss.deletion_requests request
      where request.organization_id = old.organization_id
        and request.project_id = old.project_id
        and request.state = 'purging'
    )
  then
    return old;
  end if;
  raise exception
    'durable Alakazam upgrade application evidence is immutable'
    using errcode = '55000';
end
$$;

create trigger alakazam_upgrade_applications_guard_delete
before delete on ss.alakazam_upgrade_applications
for each row execute function
  ss.guard_alakazam_upgrade_application_delete();

create function ss.count_alakazam_upgrade_application_purge()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'purging' then
    new.removal_counts :=
      coalesce(new.removal_counts, '{}'::jsonb)
      || jsonb_build_object(
        'alakazamUpgradeApplications', (
          select count(*)
          from ss.alakazam_upgrade_applications
          where organization_id = new.organization_id
            and project_id = new.project_id
        )
      );
  end if;
  return new;
end
$$;

create trigger deletion_requests_count_alakazam_upgrade_applications
before insert or update of state on ss.deletion_requests
for each row execute function
  ss.count_alakazam_upgrade_application_purge();

alter table ss.alakazam_upgrade_applications
  enable row level security;
alter table ss.alakazam_upgrade_applications
  force row level security;
revoke all on ss.alakazam_upgrade_applications
from public, anon, authenticated;
grant all privileges on ss.alakazam_upgrade_applications
to service_role;

revoke all on function
  ss.validate_alakazam_upgrade_application_insert(),
  ss.guard_alakazam_upgrade_application_update(),
  ss.guard_alakazam_upgrade_application_delete(),
  ss.count_alakazam_upgrade_application_purge()
from public, anon, authenticated;

grant execute on function
  ss.validate_alakazam_upgrade_application_insert(),
  ss.guard_alakazam_upgrade_application_update(),
  ss.guard_alakazam_upgrade_application_delete(),
  ss.count_alakazam_upgrade_application_purge()
to service_role;

create function ss.hosted_runtime_contract_v28()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-ss-v28-alakazam-upgrade-application'
    ::text
$$;

revoke all on function ss.hosted_runtime_contract_v28()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v28()
to authenticated, service_role;

commit;
