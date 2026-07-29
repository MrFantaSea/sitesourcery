begin;

set local row_security = off;

insert into auth.users (id, email) values
  (
    '00000000-0000-4000-8000-000000009001',
    'rls-owner@example.test'
  ),
  (
    '00000000-0000-4000-8000-000000009002',
    'rls-other@example.test'
  );

insert into ss.organizations (
  id,
  created_by_user_id,
  name
) values
  (
    '00000000-0000-4000-8000-000000009101',
    '00000000-0000-4000-8000-000000009001',
    'Visible tenant'
  ),
  (
    '00000000-0000-4000-8000-000000009102',
    '00000000-0000-4000-8000-000000009002',
    'Hidden tenant'
  );

insert into ss.organization_memberships (
  organization_id,
  user_id,
  role,
  state,
  accepted_at
) values (
  '00000000-0000-4000-8000-000000009101',
  '00000000-0000-4000-8000-000000009001',
  'owner',
  'active',
  clock_timestamp()
);

set local role authenticated;
set local row_security = on;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000009001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000009001","organization_id":"00000000-0000-4000-8000-000000009101"}',
  true
);
select set_config(
  'app.organization_id',
  '00000000-0000-4000-8000-000000009101',
  true
);

do $$
declare
  visible_count integer;
begin
  if ss.current_user_id() <>
    '00000000-0000-4000-8000-000000009001'::uuid
    or ss.current_org_id() <>
      '00000000-0000-4000-8000-000000009101'::uuid
  then
    raise exception 'authenticated transaction principal was not installed';
  end if;

  select count(*)
  into visible_count
  from ss.organizations;

  if visible_count <> 1 then
    raise exception
      'forced RLS exposed % organizations instead of exactly one',
      visible_count;
  end if;

  if not exists (
    select 1
    from ss.organizations
    where id = '00000000-0000-4000-8000-000000009101'
  ) then
    raise exception 'authenticated tenant cannot read its own organization';
  end if;

  if exists (
    select 1
    from ss.organizations
    where id = '00000000-0000-4000-8000-000000009102'
  ) then
    raise exception 'authenticated tenant can read another organization';
  end if;
end
$$;

select 'AUTHENTICATED_ROLE_INVARIANTS_PASS' as result;

rollback;
