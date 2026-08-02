begin;

do $$
begin
  if to_regprocedure(
       'ss.hosted_runtime_contract_v24()'
     ) is null
    or to_regclass('ss.alakazam_checkout_dispatches') is null
    or to_regclass('ss.alakazam_customer_provisions') is null
  then
    raise exception
      'Site Sourcery migration 024 must be applied before Alakazam Checkout dispatch'
      using errcode = '55000';
  end if;
end
$$;

alter table ss.alakazam_checkout_dispatches
  add column lease_expires_at timestamptz;

update ss.alakazam_checkout_dispatches
set lease_expires_at = created_at + interval '2 minutes';

alter table ss.alakazam_checkout_dispatches
  alter column lease_expires_at set not null;

alter table ss.alakazam_checkout_dispatches
  add constraint alakazam_checkout_dispatch_lease
  check (lease_expires_at > created_at);

alter table ss.alakazam_checkout_dispatches
  add constraint alakazam_checkout_dispatch_url
  check (
    provider_checkout_url is null
    or (
      char_length(provider_checkout_url)
        between 1 and 4096
      and provider_checkout_url ~
        '^https://checkout[.]stripe[.]com/'
      and provider_checkout_url !~ '[#]'
    )
  );

create unique index alakazam_one_open_checkout_per_project
  on ss.alakazam_checkout_dispatches(
    organization_id,
    project_id
  )
  where state in (
    'reserved',
    'ready',
    'persistence_unknown'
  );

create or replace function ss.validate_alakazam_dispatch()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
  subscription_record record;
  expected_current jsonb := 'null'::jsonb;
  expected_credit jsonb := 'null'::jsonb;
  expected_purpose jsonb;
begin
  select quote.* into quote_record
  from ss.alakazam_change_quotes quote
  where quote.organization_id = new.organization_id
    and quote.id = new.quote_id;

  if not found
    or quote_record.project_id <> new.project_id
    or quote_record.customer_user_id <>
         new.customer_user_id
    or quote_record.state <> 'checkout_dispatching'
    or not quote_record.provider_effects_authorized
    or quote_record.change_kind not in ('start', 'upgrade')
    or quote_record.due_now_subtotal_minor <= 0
    or quote_record.expires_at <= new.created_at
    or new.state <> 'reserved'
    or new.provider_effect_certainty <> 'not_submitted'
    or new.provider_error_code is not null
    or new.created_at <> new.updated_at
    or new.lease_expires_at <>
       new.created_at + interval '2 minutes'
    or new.expected_subtotal_minor <>
         quote_record.due_now_subtotal_minor
    or new.currency <> quote_record.currency
    or new.provider_idempotency_key <>
         'alakazam:' || quote_record.change_kind ||
         ':checkout:' || new.id::text
    or not exists (
      select 1
      from ss.stripe_customers customer
      where customer.organization_id = new.organization_id
        and customer.stripe_customer_id =
          new.stripe_customer_id
    )
  then
    raise exception
      'Alakazam Checkout dispatch does not match its quote and Customer binding'
      using errcode = '23514';
  end if;

  if quote_record.change_kind = 'start' then
    if quote_record.current_subscription_id is not null
      or new.mode <> 'subscription_start'
    then
      raise exception
        'Alakazam start Checkout cannot bind a current subscription'
        using errcode = '23514';
    end if;
    if quote_record.applied_value_kind =
         'download_purchase'
    then
      expected_credit := jsonb_build_object(
        'amountMinor', 500,
        'entitlementId',
          quote_record.download_entitlement_id::text
      );
      if new.expected_credit_minor <> 500 then
        raise exception
          'Alakazam start Checkout lacks its exact Download credit'
          using errcode = '23514';
      end if;
    elsif quote_record.applied_value_kind = 'none' then
      if new.expected_credit_minor <> 0 then
        raise exception
          'Alakazam start Checkout invented Download credit'
          using errcode = '23514';
      end if;
    else
      raise exception
        'Alakazam start Checkout has an invalid credit source'
        using errcode = '23514';
    end if;
  else
    if quote_record.current_subscription_id is null
      or new.mode <> 'upgrade_difference'
      or new.expected_credit_minor <> 0
      or quote_record.applied_value_kind <>
           'current_paid_tier'
    then
      raise exception
        'Alakazam upgrade Checkout lacks its current paid tier'
        using errcode = '23514';
    end if;

    select subscription.* into subscription_record
    from ss.alakazam_subscriptions subscription
    where subscription.organization_id =
            new.organization_id
      and subscription.id =
            quote_record.current_subscription_id;

    if not found
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
    then
      raise exception
        'Alakazam upgrade Checkout subscription binding is stale'
        using errcode = '23514';
    end if;

    expected_current := jsonb_build_object(
      'amountMinor', subscription_record.amount_minor,
      'currentPeriodEndsAt', to_char(
        subscription_record.current_period_ends_at
          at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'currentPeriodStartsAt', to_char(
        subscription_record.current_period_starts_at
          at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'localSubscriptionId', subscription_record.id::text,
      'providerFactsDigest',
        subscription_record.provider_facts_digest,
      'revision', subscription_record.revision,
      'stripePriceId', subscription_record.stripe_price_id,
      'stripeSubscriptionId',
        subscription_record.stripe_subscription_id,
      'stripeSubscriptionItemId',
        subscription_record.stripe_subscription_item_id,
      'tierId', subscription_record.tier_id
    );
  end if;

  expected_purpose := jsonb_build_object(
    'acceptedDisclosureDigest',
      quote_record.disclosure_digest,
    'catalogVersion', quote_record.catalog_version,
    'changeKind', quote_record.change_kind,
    'currency', quote_record.currency,
    'currentSubscription', expected_current,
    'customerId', new.customer_user_id::text,
    'downloadCredit', expected_credit,
    'dueNowSubtotalMinor',
      quote_record.due_now_subtotal_minor,
    'nextRenewalAmountMinor',
      quote_record.next_renewal_amount_minor,
    'organizationId', new.organization_id::text,
    'projectId', new.project_id::text,
    'quoteDigest', quote_record.quote_digest,
    'quoteId', new.quote_id::text,
    'schema',
      'sitesourcery.alakazam-stripe-purpose.v1',
    'stripeCustomerId', new.stripe_customer_id,
    'taxMode', quote_record.tax_state,
    'targetAmountMinor',
      quote_record.target_amount_minor,
    'targetTierId', quote_record.target_tier_id,
    'termsVersion', quote_record.terms_version
  );

  if new.purpose <> expected_purpose then
    raise exception
      'Alakazam Checkout purpose does not match exact durable quote evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function ss.guard_alakazam_dispatch_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if (
    to_jsonb(new) - array[
      'state',
      'stripe_checkout_session_id',
      'provider_checkout_url',
      'provider_expires_at',
      'dispatched_at',
      'settled_at',
      'provider_effect_certainty',
      'provider_error_code',
      'updated_at'
    ]::text[]
  ) is distinct from (
    to_jsonb(old) - array[
      'state',
      'stripe_checkout_session_id',
      'provider_checkout_url',
      'provider_expires_at',
      'dispatched_at',
      'settled_at',
      'provider_effect_certainty',
      'provider_error_code',
      'updated_at'
    ]::text[]
  ) then
    raise exception
      'Alakazam Checkout purpose is immutable'
      using errcode = '55000';
  end if;

  if not (
    (old.state = 'reserved' and new.state in (
      'ready', 'failed', 'persistence_unknown'
    ))
    or (old.state = 'ready' and new.state in (
      'settled', 'expired', 'persistence_unknown'
    ))
    or (old.state = 'persistence_unknown' and new.state in (
      'ready', 'settled', 'expired', 'failed'
    ))
  ) then
    raise exception 'invalid Alakazam Checkout transition'
      using errcode = '23514';
  end if;

  if new.state = 'ready' and (
    new.stripe_checkout_session_id is null
    or new.provider_checkout_url is null
    or new.provider_expires_at is null
    or new.dispatched_at is null
    or new.provider_expires_at <= new.dispatched_at
    or new.provider_effect_certainty <> 'confirmed'
    or new.provider_error_code is not null
  ) then
    raise exception
      'ready Alakazam Checkout lacks exact provider confirmation'
      using errcode = '23514';
  end if;

  if new.state = 'failed' and (
    new.stripe_checkout_session_id is not null
    or new.provider_checkout_url is not null
    or new.provider_expires_at is not null
    or new.dispatched_at is not null
    or new.provider_effect_certainty <> 'not_submitted'
    or new.provider_error_code is null
  ) then
    raise exception
      'failed Alakazam Checkout contains provider effect evidence'
      using errcode = '23514';
  end if;

  if new.state = 'persistence_unknown' and (
    new.provider_effect_certainty <> 'ambiguous'
    or new.provider_error_code is null
  ) then
    raise exception
      'unknown Alakazam Checkout lacks ambiguity evidence'
      using errcode = '23514';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end
$$;

create function ss.guard_alakazam_dispatch_delete()
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
    'durable Alakazam Checkout evidence is immutable'
    using errcode = '55000';
end
$$;

create trigger alakazam_dispatches_guard_delete
before delete on ss.alakazam_checkout_dispatches
for each row execute function
  ss.guard_alakazam_dispatch_delete();

revoke all on function
  ss.guard_alakazam_dispatch_delete()
from public, anon, authenticated;
grant execute on function
  ss.guard_alakazam_dispatch_delete()
to service_role;

create function ss.hosted_runtime_contract_v25()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-ss-v25-alakazam-checkout-dispatch'
    ::text
$$;

revoke all on function ss.hosted_runtime_contract_v25()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v25()
to authenticated, service_role;

commit;
