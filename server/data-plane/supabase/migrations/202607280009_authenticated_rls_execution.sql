begin;

do $$
begin
  if to_regprocedure('ss.jwt_claims()') is null
    or to_regprocedure('ss.current_user_id()') is null
    or to_regprocedure('ss.current_org_id()') is null
    or to_regprocedure('ss.is_org_member(uuid)') is null
    or to_regprocedure('ss.has_org_role(uuid,text[])') is null
    or to_regprocedure('ss.can_access_org(uuid)') is null
  then
    raise exception 'canonical tenancy helpers must be installed first'
      using errcode = '55000';
  end if;
end
$$;

-- Forced-RLS policies execute these helpers as the querying role. Migration
-- 005 granted authenticated table reads but intentionally revoked every
-- function first; without these exact grants, legitimate tenant reads fail
-- before the policy can evaluate.
revoke all on function ss.jwt_claims() from public, anon;
revoke all on function ss.current_user_id() from public, anon;
revoke all on function ss.current_org_id() from public, anon;
revoke all on function ss.is_org_member(uuid) from public, anon;
revoke all on function ss.has_org_role(uuid, text[]) from public, anon;
revoke all on function ss.can_access_org(uuid) from public, anon;

grant execute on function ss.jwt_claims() to authenticated, service_role;
grant execute on function ss.current_user_id() to authenticated, service_role;
grant execute on function ss.current_org_id() to authenticated, service_role;
grant execute on function ss.is_org_member(uuid) to authenticated, service_role;
grant execute on function ss.has_org_role(uuid, text[])
  to authenticated, service_role;
grant execute on function ss.can_access_org(uuid)
  to authenticated, service_role;

commit;
