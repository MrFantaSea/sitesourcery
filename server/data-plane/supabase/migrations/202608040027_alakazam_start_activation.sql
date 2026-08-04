begin;

do $$
begin
  if to_regprocedure(
       'ss.hosted_runtime_contract_v26()'
     ) is null
    or to_regclass('ss.alakazam_subscriptions') is null
    or to_regclass('ss.alakazam_tier_change_events') is null
  then
    raise exception
      'Site Sourcery migration 026 must be applied before Alakazam start activation'
      using errcode = '55000';
  end if;
end
$$;

create unique index alakazam_one_start_activation
  on ss.alakazam_tier_change_events(subscription_id)
  where event_kind = 'start_applied';

create function ss.hosted_runtime_contract_v27()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-ss-v27-alakazam-start-activation'
    ::text
$$;

revoke all on function ss.hosted_runtime_contract_v27()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v27()
to authenticated, service_role;

commit;
