begin;

do $$
begin
  if to_regclass('ss.alakazam_fulfillment_operations') is null
    or to_regclass('ss.alakazam_fulfillment_projection') is null
    or to_regclass('ss.alakazam_tier_change_events') is null
    or to_regprocedure(
      'ss.hosted_runtime_contract_v32()'
    ) is null
  then
    raise exception
      'Site Sourcery migration 032 must be applied before Alakazam tier fulfillment'
      using errcode = '55000';
  end if;
end
$$;

alter table ss.alakazam_fulfillment_operations
  drop constraint
    alakazam_fulfillment_operations_operation_kind_check;

alter table ss.alakazam_fulfillment_operations
  add constraint
    alakazam_fulfillment_operations_operation_kind_check
  check (
    operation_kind in (
      'start_activation',
      'tier_transition'
    )
  );

create or replace function
  ss.validate_alakazam_fulfillment_operation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
      from ss.alakazam_fulfillment_intents intent
      join ss.alakazam_subscriptions subscription
        on subscription.organization_id = intent.organization_id
       and subscription.project_id = intent.project_id
       and subscription.customer_user_id = intent.customer_user_id
       and subscription.id = new.subscription_id
     where intent.organization_id = new.organization_id
       and intent.project_id = new.project_id
       and intent.customer_user_id = new.customer_user_id
       and intent.id = new.intent_id
       and subscription.status in ('active', 'grace')
       and subscription.revision = new.subscription_revision
       and subscription.tier_id = new.effective_tier_id
       and (
         (
           new.operation_kind = 'start_activation'
           and intent.state in ('activated', 'completed')
           and exists (
             select 1
               from ss.alakazam_change_quotes quote
              where quote.organization_id = intent.organization_id
                and quote.id = intent.quote_id
                and quote.change_kind = 'start'
                and quote.state = 'applied'
                and quote.target_tier_id =
                    new.effective_tier_id
           )
         )
         or (
           new.operation_kind = 'tier_transition'
           and intent.state = 'completed'
           and exists (
             select 1
               from ss.alakazam_tier_change_events tier_event
               join ss.alakazam_change_quotes quote
                 on quote.organization_id =
                    tier_event.organization_id
                and quote.id = tier_event.quote_id
              where tier_event.organization_id =
                    new.organization_id
                and tier_event.project_id = new.project_id
                and tier_event.subscription_id =
                    new.subscription_id
                and tier_event.result_subscription_revision =
                    new.subscription_revision
                and tier_event.result_tier_id =
                    new.effective_tier_id
                and tier_event.prior_tier_id =
                    quote.current_tier_id
                and tier_event.result_tier_id =
                    quote.target_tier_id
                and quote.state = 'applied'
                and (
                  (
                    tier_event.event_kind = 'upgrade_applied'
                    and quote.change_kind = 'upgrade'
                  )
                  or (
                    tier_event.event_kind = 'downgrade_applied'
                    and quote.change_kind = 'downgrade'
                  )
                )
           )
         )
       )
  ) then
    raise exception
      'Alakazam fulfillment operation lacks exact active revision evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function
  ss.validate_alakazam_fulfillment_operation()
from public, anon, authenticated;
grant execute on function
  ss.validate_alakazam_fulfillment_operation()
to service_role;

create function ss.hosted_runtime_contract_v33()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-ss-v33-alakazam-tier-fulfillment'
    ::text
$$;

revoke all on function ss.hosted_runtime_contract_v33()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v33()
to authenticated, service_role;

commit;
