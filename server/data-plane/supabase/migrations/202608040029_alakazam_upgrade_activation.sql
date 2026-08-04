begin;

do $$
begin
  if to_regprocedure(
       'ss.hosted_runtime_contract_v28()'
     ) is null
    or to_regclass('ss.alakazam_upgrade_applications') is null
    or to_regclass('ss.alakazam_tier_change_events') is null
  then
    raise exception
      'Site Sourcery migration 028 must be applied before Alakazam upgrade activation'
      using errcode = '55000';
  end if;
end
$$;

create unique index alakazam_one_upgrade_activation
  on ss.alakazam_tier_change_events(quote_id)
  where event_kind = 'upgrade_applied';

-- Provider confirmation and local entitlement application are deliberately
-- separate phases. At commit, an applied application must have one exact,
-- processed Subscription event and the matching new subscription revision.
create function ss.validate_alakazam_upgrade_activation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'applied'
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
       and tier_event.payment_receipt_id =
           new.payment_receipt_id
       and tier_event.event_kind = 'upgrade_applied'
      join ss.alakazam_stripe_events stripe_event
        on stripe_event.organization_id = quote.organization_id
       and stripe_event.id = tier_event.stripe_event_row_id
      where quote.organization_id = new.organization_id
        and quote.id = new.quote_id
        and quote.project_id = new.project_id
        and quote.customer_user_id = new.customer_user_id
        and quote.change_kind = 'upgrade'
        and quote.state = 'applied'
        and subscription.id = new.subscription_id
        and subscription.status = 'active'
        and subscription.revision =
            (new.purpose #>>
              '{currentSubscription,revision}')::bigint + 1
        and subscription.tier_id =
            new.purpose ->> 'targetTierId'
        and subscription.stripe_subscription_id =
            new.purpose #>>
              '{currentSubscription,stripeSubscriptionId}'
        and subscription.stripe_subscription_item_id =
            new.purpose #>>
              '{currentSubscription,stripeSubscriptionItemId}'
        and subscription.stripe_price_id =
            stripe_event.facts #>>
              '{subscription,stripePriceId}'
        and subscription.provider_facts_digest =
            stripe_event.facts ->>
              'subscriptionProviderFactsDigest'
        and subscription.current_period_starts_at =
            (
              new.purpose #>>
                '{currentSubscription,currentPeriodStartsAt}'
            )::timestamptz
        and subscription.current_period_ends_at =
            (
              new.purpose #>>
                '{currentSubscription,currentPeriodEndsAt}'
            )::timestamptz
        and not subscription.cancel_at_period_end
        and tier_event.result_subscription_revision =
            subscription.revision
        and tier_event.prior_tier_id =
            new.purpose #>> '{currentSubscription,tierId}'
        and tier_event.result_tier_id = subscription.tier_id
        and tier_event.facts ->> 'applicationId' =
            new.id::text
        and tier_event.facts ->> 'receiptId' =
            new.payment_receipt_id::text
        and tier_event.facts ->>
              'paymentProviderFactsDigest' =
            new.payment_provider_facts_digest
        and tier_event.facts ->>
              'subscriptionProviderFactsDigest' =
            subscription.provider_facts_digest
        and stripe_event.state = 'processed'
        and stripe_event.event_type =
            'customer.subscription.updated'
        and stripe_event.provider_object_id =
            subscription.stripe_subscription_id
        and stripe_event.facts ->> 'applicationId' =
            new.id::text
        and stripe_event.facts ->> 'paymentReceiptId' =
            new.payment_receipt_id::text
        and stripe_event.facts ->> 'purposeDigest' =
            new.purpose_digest
        and stripe_event.facts ->>
              'subscriptionProviderFactsDigest' =
            subscription.provider_facts_digest
        and stripe_event.facts #>>
              '{subscription,providerFactsDigest}' =
            subscription.provider_facts_digest
    )
  then
    raise exception
      'applied Alakazam upgrade lacks exact atomic activation evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_upgrade_activations_validate
after update on ss.alakazam_upgrade_applications
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_upgrade_activation();

revoke all on function
  ss.validate_alakazam_upgrade_activation()
from public, anon, authenticated;
grant execute on function
  ss.validate_alakazam_upgrade_activation()
to service_role;

create function ss.hosted_runtime_contract_v29()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-ss-v29-alakazam-upgrade-activation'
    ::text
$$;

revoke all on function ss.hosted_runtime_contract_v29()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v29()
to authenticated, service_role;

commit;
