begin;

do $$
begin
  if to_regclass('ss.hosted_registration_requests') is null
  then
    raise exception
      'verified registration migration 017 must be installed first'
      using errcode = '55000';
  end if;
end
$$;

-- Migration 017 shipped before activation replay was bound to the original
-- command. Keep that migration immutable and upgrade every already-migrated
-- database here. A legacy marker deliberately cannot equal a browser command,
-- so an old completed link cannot mint another session; the customer signs in.
alter table ss.hosted_registration_requests
  add column if not exists activation_command_id text;

update ss.hosted_registration_requests
   set activation_command_id =
         'legacy-activation-' || id::text
 where state = 'activated'
   and activation_command_id is null;

alter table ss.hosted_registration_requests
  add constraint hosted_registration_activation_command_length_v18
  check (
    activation_command_id is null
    or char_length(activation_command_id) between 8 and 200
  ) not valid;

alter table ss.hosted_registration_requests
  validate constraint
    hosted_registration_activation_command_length_v18;

alter table ss.hosted_registration_requests
  add constraint hosted_registration_activation_consistency_v18
  check (
    (
      state = 'activated'
      and activated_at is not null
      and activated_user_id is not null
      and activated_organization_id is not null
      and activation_command_id is not null
    )
    or (
      state <> 'activated'
      and activated_at is null
      and activated_user_id is null
      and activated_organization_id is null
      and activation_command_id is null
    )
  ) not valid;

alter table ss.hosted_registration_requests
  validate constraint
    hosted_registration_activation_consistency_v18;

create function ss.hosted_runtime_contract_v18()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v18-verified-registration-upgrade'::text
$$;

revoke all on function ss.hosted_runtime_contract_v18()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v18()
to authenticated, service_role;

commit;
