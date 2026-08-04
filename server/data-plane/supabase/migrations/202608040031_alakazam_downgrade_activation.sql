begin;

do $$
begin
  if to_regprocedure(
       'ss.hosted_runtime_contract_v30()'
     ) is null
    or to_regclass(
         'ss.alakazam_downgrade_schedules'
       ) is null
    or to_regclass(
         'ss.alakazam_tier_change_events'
       ) is null
  then
    raise exception
      'Site Sourcery migration 030 must be applied before Alakazam downgrade activation'
      using errcode = '55000';
  end if;
end
$$;

create unique index alakazam_one_downgrade_activation
  on ss.alakazam_tier_change_events(quote_id)
  where event_kind = 'downgrade_applied';

-- A provider Schedule reaching its lower phase and the local entitlement
-- changing tiers are separate facts. The applied Schedule cannot commit until
-- one exact processed Subscription event, target-period local revision, quote,
-- and tier event all agree.
create function ss.validate_alakazam_downgrade_activation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'applied'
    and old.state <> 'applied'
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
       and tier_event.event_kind = 'downgrade_applied'
      join ss.alakazam_stripe_events stripe_event
        on stripe_event.organization_id = quote.organization_id
       and stripe_event.id = tier_event.stripe_event_row_id
      where quote.organization_id = new.organization_id
        and quote.id = new.quote_id
        and quote.project_id = new.project_id
        and quote.change_kind = 'downgrade'
        and quote.state = 'applied'
        and quote.current_subscription_id = new.subscription_id
        and quote.current_subscription_revision =
            (new.purpose #>>
              '{currentSubscription,revision}')::bigint
        and quote.current_tier_id = new.current_tier_id
        and quote.target_tier_id = new.target_tier_id
        and quote.effective_at = new.effective_at
        and subscription.id = new.subscription_id
        and subscription.status = 'active'
        and subscription.revision =
            (new.purpose #>>
              '{currentSubscription,revision}')::bigint + 1
        and subscription.tier_id = new.target_tier_id
        and subscription.amount_minor =
            ss.alakazam_tier_amount_minor(new.target_tier_id)
        and subscription.stripe_subscription_id =
            new.purpose #>>
              '{currentSubscription,stripeSubscriptionId}'
        and subscription.stripe_subscription_item_id =
            new.purpose #>>
              '{currentSubscription,stripeSubscriptionItemId}'
        and subscription.stripe_price_id =
            new.target_stripe_price_id
        and subscription.current_period_starts_at =
            new.effective_at
        and subscription.current_period_ends_at >
            subscription.current_period_starts_at
        and not subscription.cancel_at_period_end
        and subscription.provider_facts_digest =
            stripe_event.facts ->>
              'subscriptionProviderFactsDigest'
        and new.applied_at = tier_event.occurred_at
        and new.applied_at = stripe_event.occurred_at
        and tier_event.result_subscription_revision =
            subscription.revision
        and tier_event.prior_tier_id = new.current_tier_id
        and tier_event.result_tier_id = new.target_tier_id
        and tier_event.payment_receipt_id is null
        and tier_event.facts ->> 'changeKind' = 'downgrade'
        and tier_event.facts ->> 'purposeDigest' =
            new.purpose_digest
        and tier_event.facts ->> 'scheduleId' = new.id::text
        and tier_event.facts ->> 'stripeScheduleId' =
            new.stripe_schedule_id
        and tier_event.facts ->>
              'scheduleProviderFactsDigest' =
            new.provider_facts_digest
        and tier_event.facts ->>
              'subscriptionProviderFactsDigest' =
            subscription.provider_facts_digest
        and (tier_event.facts ->> 'resultRevision')
              ::bigint = subscription.revision
        and (tier_event.facts ->> 'effectiveAt')
              ::timestamptz = new.effective_at
        and stripe_event.state = 'processed'
        and stripe_event.event_type =
            'customer.subscription.updated'
        and stripe_event.quote_id = new.quote_id
        and stripe_event.subscription_id = new.subscription_id
        and stripe_event.provider_object_id =
            subscription.stripe_subscription_id
        and stripe_event.facts ->> 'scheduleId' = new.id::text
        and stripe_event.facts ->> 'stripeScheduleId' =
            new.stripe_schedule_id
        and stripe_event.facts ->> 'purposeDigest' =
            new.purpose_digest
        and stripe_event.facts ->>
              'subscriptionProviderFactsDigest' =
            subscription.provider_facts_digest
        and stripe_event.facts #>>
              '{subscription,schema}' =
            'sitesourcery.stripe-alakazam-subscription/v1'
        and stripe_event.facts #>>
              '{subscription,stripeSubscriptionId}' =
            subscription.stripe_subscription_id
        and stripe_event.facts #>>
              '{subscription,stripeSubscriptionItemId}' =
            subscription.stripe_subscription_item_id
        and stripe_event.facts #>>
              '{subscription,stripePriceId}' =
            subscription.stripe_price_id
        and stripe_event.facts #>>
              '{subscription,stripeScheduleId}' =
            new.stripe_schedule_id
        and stripe_event.facts #>>
              '{subscription,tierId}' = subscription.tier_id
        and (stripe_event.facts #>>
              '{subscription,amountMinor}')::bigint =
            subscription.amount_minor
        and (stripe_event.facts #>>
              '{subscription,currentPeriodStartsAt}')
              ::timestamptz =
            subscription.current_period_starts_at
        and (stripe_event.facts #>>
              '{subscription,currentPeriodEndsAt}')
              ::timestamptz =
            subscription.current_period_ends_at
        and (stripe_event.facts #>>
              '{subscription,cancelAtPeriodEnd}')
              ::boolean = false
        and stripe_event.facts #>>
              '{subscription,providerStatus}' = 'active'
        and stripe_event.facts #>>
              '{subscription,providerFactsDigest}' =
            subscription.provider_facts_digest
        and stripe_event.facts #>>
              '{subscription,metadata,purpose_digest}' =
            new.purpose_digest
        and stripe_event.facts #>>
              '{subscription,metadata,change_kind}' =
            'downgrade'
        and stripe_event.facts #>>
              '{subscription,metadata,quote_id}' =
            new.quote_id::text
        and stripe_event.facts #>>
              '{subscription,metadata,local_subscription_id}' =
            new.subscription_id::text
        and stripe_event.facts #>>
              '{subscription,metadata,prior_tier_id}' =
            new.current_tier_id
        and stripe_event.facts #>>
              '{subscription,metadata,target_tier_id}' =
            new.target_tier_id
        and (stripe_event.facts #>>
              '{subscription,metadata,subscription_revision}')
              ::bigint =
            (new.purpose #>>
              '{currentSubscription,revision}')::bigint
    )
  then
    raise exception
      'applied Alakazam downgrade lacks exact atomic activation evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_downgrade_activations_validate
after update on ss.alakazam_downgrade_schedules
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_downgrade_activation();

revoke all on function
  ss.validate_alakazam_downgrade_activation()
from public, anon, authenticated;
grant execute on function
  ss.validate_alakazam_downgrade_activation()
to service_role;

create function ss.hosted_runtime_contract_v31()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-ss-v31-alakazam-downgrade-activation'
    ::text
$$;

revoke all on function ss.hosted_runtime_contract_v31()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v31()
to authenticated, service_role;

commit;
