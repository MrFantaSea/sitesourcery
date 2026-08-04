begin;

do $$
begin
  if to_regprocedure(
       'ss.hosted_runtime_contract_v25()'
     ) is null
    or to_regclass('ss.alakazam_stripe_events') is null
    or to_regclass('ss.alakazam_payment_receipts') is null
  then
    raise exception
      'Site Sourcery migration 025 must be applied before Alakazam payment settlement'
      using errcode = '55000';
  end if;
end
$$;

create unique index alakazam_one_checkout_completion_event
  on ss.alakazam_stripe_events(
    provider_object_id,
    event_type
  )
  where event_type = 'checkout.session.completed';

create unique index alakazam_one_quote_payment_receipt
  on ss.alakazam_payment_receipts(
    organization_id,
    quote_id
  )
  where quote_id is not null;

create unique index alakazam_one_payment_intent_receipt
  on ss.alakazam_payment_receipts(
    stripe_payment_intent_id
  );

create function ss.hosted_runtime_contract_v26()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-ss-v26-alakazam-payment-settlement'
    ::text
$$;

revoke all on function ss.hosted_runtime_contract_v26()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v26()
to authenticated, service_role;

commit;
