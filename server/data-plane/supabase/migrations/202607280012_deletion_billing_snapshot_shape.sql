begin;

-- The terminal purge seals zero or more subscription lifecycle snapshots as
-- an ordered JSON array. The original tombstone constraint incorrectly
-- required a JSON object, which made finalization fail after a valid purge.
alter table ss.project_deletion_tombstones
  drop constraint if exists
    project_deletion_tombstones_billing_timestamps_check;

alter table ss.project_deletion_tombstones
  add constraint project_deletion_tombstones_billing_timestamps_check
  check (jsonb_typeof(billing_timestamps) = 'array');

create function ss.hosted_runtime_contract_v12()
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select true
$$;

revoke all on function ss.hosted_runtime_contract_v12()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v12()
to service_role;

commit;
